import { logger } from "./logger";
import { storage } from "./storage";
import { InsertTradeIdea } from "@shared/schema";
import { v4 as uuidv4 } from "uuid";
import { getTradierQuote } from "./tradier-api";
import { getLetterGrade } from "./grading";
import { getNewsContext, NewsContext } from "./trading-engine";

// ML Module Integration - Apply learned calibration and regime multipliers
import {
  calibrateConfidence,
  detectRegime,
  applyRegimeMultiplier,
  getEngineWeight,
  type RegimeAnalysis,
} from "./ml";
// Canonical option-selection engine — turns a stock thesis into a concrete
// option contract (strike/expiry/greeks) so every idea carries a real option.
import {
  selectFromChain,
  type PriceActionThesis,
  type SetupType,
  type ExpiryTier,
  type ContractCandidate,
} from "./option-selection-engine";
import { fetchCboeChain, findContractMid } from "./contract-analyzer/cboe-chain";
import { isApprovedTicker, isSkipTicker } from "@shared/approved-tickers";

/**
 * UNIVERSAL TRADE IDEA GENERATOR
 * 
 * This module provides a unified interface for generating trade ideas with confidence scores
 * from ANY source across the platform - watchlists, scanners, flow alerts, social sentiment,
 * chart analysis, manual submission, etc.
 * 
 * Each source contributes signals that are combined to produce a final confidence score.
 * 
 * ENHANCEMENTS (v4.1):
 * - ML Intelligence integration for direction confirmation (±10 points)
 * - VIX-based signal filtering (weakens signals in high-volatility regimes)
 * - ADX momentum detection (trend accelerating vs decaying)
 */

// Kill switch environment variables
const ML_PREDICTIONS_ENABLED = process.env.ENABLE_ML_PREDICTIONS !== 'false';
const VIX_FILTERING_ENABLED = process.env.ENABLE_VIX_FILTERING !== 'false';

// Log kill switch status at startup
if (!ML_PREDICTIONS_ENABLED) {
  logger.info('[UNIVERSAL-IDEA] ⛔ ML predictions DISABLED via ENABLE_ML_PREDICTIONS=false');
}
if (!VIX_FILTERING_ENABLED) {
  logger.info('[UNIVERSAL-IDEA] ⛔ VIX filtering DISABLED via ENABLE_VIX_FILTERING=false');
}

// Cache for VIX to avoid repeated API calls
let cachedVIX: { value: number; expires: number } | null = null;
const VIX_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache for ML regime analysis
let cachedRegime: { data: RegimeAnalysis; expires: number } | null = null;
const REGIME_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ML Calibration and Regime Integration
const ML_CALIBRATION_ENABLED = process.env.ENABLE_ML_CALIBRATION !== 'false';
const ML_REGIME_ENABLED = process.env.ENABLE_ML_REGIME !== 'false';

if (ML_CALIBRATION_ENABLED) {
  logger.info('[UNIVERSAL-IDEA] ✅ ML confidence calibration ENABLED');
}
if (ML_REGIME_ENABLED) {
  logger.info('[UNIVERSAL-IDEA] ✅ ML regime-based signal multipliers ENABLED');
}

/**
 * Get current market regime with caching
 */
async function getCurrentRegime(): Promise<RegimeAnalysis | null> {
  if (!ML_REGIME_ENABLED) return null;

  if (cachedRegime && cachedRegime.expires > Date.now()) {
    return cachedRegime.data;
  }

  try {
    const regime = await detectRegime();
    cachedRegime = { data: regime, expires: Date.now() + REGIME_CACHE_TTL };
    logger.debug(`[UNIVERSAL-IDEA] Regime detected: ${regime.regime} (${regime.confidence}% confidence)`);
    return regime;
  } catch (error) {
    logger.warn('[UNIVERSAL-IDEA] Regime detection failed, using defaults');
    return null;
  }
}

/**
 * Apply ML calibration to adjust confidence based on historical accuracy
 */
function applyMLCalibration(rawConfidence: number): number {
  if (!ML_CALIBRATION_ENABLED) return rawConfidence;

  try {
    const calibration = calibrateConfidence(rawConfidence);
    // Only apply adjustment if it's meaningful (not default 1.0)
    if (calibration.adjustmentFactor !== 1.0) {
      const adjusted = Math.round(rawConfidence * calibration.adjustmentFactor);
      logger.debug(`[UNIVERSAL-IDEA] Calibration: ${rawConfidence}% -> ${adjusted}%`);
      return Math.max(40, Math.min(94, adjusted)); // Keep within bounds
    }
    return rawConfidence;
  } catch (error) {
    return rawConfidence;
  }
}

/**
 * Get regime-adjusted signal multiplier for a signal type
 */
function getRegimeSignalMultiplier(regime: RegimeAnalysis | null, signalType: string): number {
  if (!regime || !ML_REGIME_ENABLED) return 1.0;

  // Map signal types to regime multiplier categories
  const signalCategoryMap: Record<string, keyof RegimeAnalysis['signalMultipliers']> = {
    // Momentum signals
    'MOMENTUM_STRONG': 'momentum',
    'TREND_UP': 'momentum',
    'TREND_DOWN': 'momentum',
    'MA_CROSSOVER_BULLISH': 'momentum',
    'MA_CROSSOVER_BEARISH': 'momentum',
    'ADX_STRONG_TREND': 'momentum',

    // Mean reversion signals
    'RSI_OVERSOLD': 'meanReversion',
    'RSI_OVERBOUGHT': 'meanReversion',
    'STOCHASTIC_OVERSOLD': 'meanReversion',
    'STOCHASTIC_OVERBOUGHT': 'meanReversion',
    'SUPPORT_BOUNCE': 'meanReversion',
    'RESISTANCE_REJECTION': 'meanReversion',

    // Breakout signals
    'BREAKOUT': 'breakout',
    'BREAKDOWN': 'breakout',
    'RANGE_BREAKOUT': 'breakout',
    'CHANNEL_BREAK': 'breakout',

    // Options flow signals
    'UNUSUAL_OPTIONS_ACTIVITY': 'optionsFlow',
    'SWEEP_DETECTED': 'optionsFlow',
    'LARGE_PREMIUM': 'optionsFlow',
    'CALL_FLOW_BULLISH': 'optionsFlow',
    'PUT_FLOW_BEARISH': 'optionsFlow',

    // Sentiment signals
    'BULLISH_SENTIMENT': 'sentiment',
    'BEARISH_SENTIMENT': 'sentiment',
    'NEWS_CATALYST': 'sentiment',
    'SOCIAL_BUZZ': 'sentiment',

    // Volume signals
    'VOLUME_SURGE': 'volume',
    'UNUSUAL_VOLUME': 'volume',
    'ACCUMULATION': 'volume',
    'DISTRIBUTION': 'volume',
  };

  const category = signalCategoryMap[signalType];
  if (category && regime.signalMultipliers[category]) {
    return regime.signalMultipliers[category];
  }

  return 1.0; // Default multiplier
}

/**
 * Fetch current VIX level with caching
 */
async function getCurrentVIX(): Promise<number> {
  if (cachedVIX && cachedVIX.expires > Date.now()) {
    return cachedVIX.value;
  }
  
  try {
    const vixQuote = await getTradierQuote('VIX');
    const vixValue = vixQuote?.last || 20;
    cachedVIX = { value: vixValue, expires: Date.now() + VIX_CACHE_TTL };
    return vixValue;
  } catch (error) {
    const fallbackVIX = cachedVIX?.value || 20;
    logger.warn(`[UNIVERSAL-IDEA] VIX fetch failed, using fallback value: ${fallbackVIX}`);
    return fallbackVIX;
  }
}

/**
 * VIX-based signal strength multiplier
 * High VIX = weaker mean reversion signals, stronger volatility plays
 */
function getVIXSignalMultiplier(vix: number, signalType: string): number {
  const meanReversionSignals = ['RSI_OVERSOLD', 'RSI_OVERBOUGHT', 'STOCHASTIC_OVERSOLD', 'STOCHASTIC_OVERBOUGHT', 'SUPPORT_BOUNCE', 'RESISTANCE_REJECTION'];
  const volatilitySignals = ['VOLUME_SURGE', 'UNUSUAL_VOLUME', 'SWEEP_DETECTED', 'BREAKOUT', 'BREAKDOWN'];
  
  if (vix <= 15) {
    // Low VIX: Mean reversion works well, volatility plays may lack juice
    if (meanReversionSignals.includes(signalType)) return 1.1;
    if (volatilitySignals.includes(signalType)) return 0.9;
  } else if (vix <= 20) {
    // Normal VIX: All signals at full strength
    return 1.0;
  } else if (vix <= 30) {
    // Elevated VIX: Weaken mean reversion (choppy), boost volatility plays
    if (meanReversionSignals.includes(signalType)) return 0.7;
    if (volatilitySignals.includes(signalType)) return 1.15;
  } else {
    // High VIX (>30): Strongly weaken mean reversion, modest volatility boost
    if (meanReversionSignals.includes(signalType)) return 0.5;
    if (volatilitySignals.includes(signalType)) return 1.1;
  }
  
  return 1.0;
}

// Source types for trade ideas
export type IdeaSource = 
  | 'watchlist'           // From user's watchlist
  | 'market_scanner'      // From market scanner movers
  | 'bullish_trend'       // From bullish trend scanner
  | 'options_flow'        // From unusual options activity
  | 'social_sentiment'    // From CT Tracker / social mentions
  | 'chart_analysis'      // From technical chart patterns
  | 'quant_signal'        // From quantitative engine
  | 'ai_analysis'         // From AI engine
  | 'manual'              // User-submitted idea
  | 'crypto_scanner'      // From crypto scanner
  | 'news_catalyst'       // From news/catalyst detection
  | 'earnings_play'       // From earnings calendar
  | 'sector_rotation'     // From sector analysis
  | 'bot_screener'        // From Auto-Lotto Bot screener (high-conviction ideas)
  | 'surge_detection'     // From Surge Detection Engine (price/volume breakouts)
  | 'tradingview';        // From TradingView webhook (user's backtested strategies)

// Signal types that contribute to confidence
export interface IdeaSignal {
  type: string;
  weight: number;     // 0-20 points per signal
  description: string;
  data?: Record<string, any>;
}

// Input for generating a trade idea from any source
export interface UniversalIdeaInput {
  symbol: string;
  source: IdeaSource;
  assetType: 'stock' | 'option' | 'crypto' | 'future';
  direction: 'bullish' | 'bearish' | 'neutral';
  
  // Optional price data (will be fetched if not provided)
  currentPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  
  // Option-specific fields
  optionType?: 'call' | 'put';
  strikePrice?: number;
  expiryDate?: string;
  /** Exact option mark captured by the caller at signal time. */
  entryPremium?: number;
  /** Original signal time; required for historical/replay publication. */
  signalTimestamp?: string;
  /** Venue/feed that produced the price used for this idea. */
  dataSourceUsed?: string;
  
  // Signals contributing to confidence
  signals: IdeaSignal[];
  
  // Source-specific metadata
  sourceMetadata?: {
    scannerTimeframe?: 'day' | 'week' | 'month' | 'year';
    flowPremium?: number;
    sentimentScore?: number;
    patternType?: string;
    rsiBand?: 'oversold' | 'neutral' | 'overbought';
    volumeRatio?: number;
    influencerName?: string;
    mentionCount?: number;
    unusualActivityScore?: number;
  };
  
  // Holding period suggestion
  holdingPeriod?: 'day' | 'swing' | 'position';

  // Analysis text
  catalyst?: string;
  analysis?: string;
  technicalSignals?: string[];

  // 🎯 Deep Analysis - Full signal breakdown for Trade Desk
  convergenceAnalysis?: {
    signals: Array<{
      source: string;
      type: string;
      direction: 'bullish' | 'bearish' | 'neutral';
      weight: number;
      confidence: number;
      description: string;
      data?: Record<string, any>;
      timestamp?: string;
    }>;
    convergenceScore: number;
    signalCount: number;
    primaryThesis: string;
    technicalSummary?: string;
    flowSummary?: string;
    newsSummary?: string;
    sentimentSummary?: string;
    riskFactors?: string[];
    keyLevels?: Array<{ type: string; price: number; label: string }>;
    generatedAt: string;
  };
}

// Base confidence by source (starting points) - CALIBRATED for realistic distribution
// Target: Most ideas should be in 60-85% range, with tradeable grades (B- or higher)
const SOURCE_BASE_CONFIDENCE: Record<IdeaSource, number> = {
  'ai_analysis': 52,        // AI analysis - moderate-high
  'quant_signal': 55,       // Quant signals - decent base
  'options_flow': 50,       // Options flow - moderate
  'market_scanner': 48,     // Market movers - moderate
  'bullish_trend': 50,      // Bullish trends - moderate
  'chart_analysis': 52,     // Chart patterns - moderate
  'social_sentiment': 40,   // Social - speculative, low base
  'watchlist': 48,          // Watchlist - needs signals
  'crypto_scanner': 45,     // Crypto - volatile, lower base
  'news_catalyst': 50,      // News - moderate
  'earnings_play': 48,      // Earnings - risky events
  'sector_rotation': 50,    // Sector - moderate
  'manual': 35,             // Manual - minimal base
  'bot_screener': 58,       // Bot screener - higher base
  'surge_detection': 55,    // Surge detection - momentum-based, higher base
  'tradingview': 52,        // Chart-derived evidence, not a trade by itself
};

// Signal type weights
const SIGNAL_WEIGHTS: Record<string, number> = {
  // Technical signals
  'RSI_OVERSOLD': 12,
  'RSI_OVERBOUGHT': 10,
  'MACD_BULLISH_CROSS': 10,
  'MACD_BEARISH_CROSS': 10,
  'GOLDEN_CROSS': 15,
  'DEATH_CROSS': 12,
  'ABOVE_VWAP': 8,
  'BELOW_VWAP': 8,
  'VOLUME_SURGE': 10,
  'BREAKOUT': 12,
  'BREAKDOWN': 10,
  'SUPPORT_BOUNCE': 12,
  'RESISTANCE_REJECTION': 10,
  
  // Momentum signals
  'MARKET_SCANNER_MOVER': 8,
  'TOP_GAINER': 10,
  'TOP_LOSER': 8,
  'UNUSUAL_VOLUME': 10,
  'SECTOR_LEADER': 8,
  
  // Options flow signals
  'UNUSUAL_CALL_FLOW': 12,
  'UNUSUAL_PUT_FLOW': 10,
  'SWEEP_DETECTED': 15,
  'LARGE_PREMIUM': 12,
  'DARK_POOL_PRINT': 14,
  
  // Social/sentiment signals
  'TRENDING_TICKER': 8,
  'INFLUENCER_MENTION': 10,
  'SENTIMENT_BULLISH': 8,
  'SENTIMENT_BEARISH': 6,
  'HIGH_ENGAGEMENT': 6,
  
  // Chart pattern signals
  'BULL_FLAG': 10,
  'BEAR_FLAG': 8,
  'HEAD_SHOULDERS': 12,
  'DOUBLE_BOTTOM': 12,
  'DOUBLE_TOP': 10,
  'ASCENDING_TRIANGLE': 10,
  'DESCENDING_TRIANGLE': 8,
  'CUP_HANDLE': 14,
  
  // Fundamental signals
  'EARNINGS_BEAT': 10,
  'REVENUE_BEAT': 8,
  'UPGRADE': 12,
  'DOWNGRADE': 8,
  'INSIDER_BUYING': 15,
  'INSTITUTIONAL_ACCUMULATION': 12,
  
  // Risk signals (negative)
  'HIGH_IV': -5,
  'LOW_LIQUIDITY': -8,
  'PENNY_STOCK': -3,
  'EARNINGS_SOON': -6,
  
  // Convergence signals
  'MULTI_SIGNAL_CONFLUENCE': 15,
  'CROSS_ENGINE_AGREEMENT': 12,
};

/**
 * Signal Correlation Groups
 * Signals in the same group are considered redundant - only the highest-weight one gets full value
 * Others in the group get 50% penalty regardless of arrival order
 */
const SIGNAL_CORRELATION_GROUPS: string[][] = [
  ['RSI_OVERSOLD', 'STOCHASTIC_OVERSOLD', 'SUPPORT_BOUNCE'],
  ['RSI_OVERBOUGHT', 'STOCHASTIC_OVERBOUGHT', 'RESISTANCE_REJECTION'],
  ['VOLUME_SURGE', 'UNUSUAL_VOLUME', 'LARGE_PREMIUM'],
  ['MACD_BULLISH_CROSS', 'GOLDEN_CROSS'],
  ['MACD_BEARISH_CROSS', 'DEATH_CROSS'],
  ['BREAKOUT', 'ASCENDING_TRIANGLE', 'BULL_FLAG', 'CUP_HANDLE'],
  ['BREAKDOWN', 'DESCENDING_TRIANGLE', 'BEAR_FLAG', 'HEAD_SHOULDERS'],
  ['UNUSUAL_CALL_FLOW', 'SWEEP_DETECTED'],
  ['UNUSUAL_PUT_FLOW', 'SWEEP_DETECTED'],
  ['TOP_GAINER', 'MARKET_SCANNER_MOVER'],
  ['TOP_LOSER', 'MARKET_SCANNER_MOVER'],
];

const CORRELATION_PENALTY = 0.5; // Reduce correlated signal weight by 50%

/**
 * Build a lookup map: signal -> group index
 */
function getSignalGroupMap(): Map<string, number> {
  const map = new Map<string, number>();
  SIGNAL_CORRELATION_GROUPS.forEach((group, idx) => {
    group.forEach(signal => map.set(signal, idx));
  });
  return map;
}

const SIGNAL_GROUP_MAP = getSignalGroupMap();

/**
 * Calculate confidence score from signals with:
 * - Saturation curve & correlation penalties
 * - VIX filtering
 * - ML regime-based signal multipliers (NEW)
 * - ML calibration adjustment (NEW)
 */
async function calculateConfidenceWithVIX(source: IdeaSource, signals: IdeaSignal[], vix: number = 20): Promise<number> {
  let confidence = SOURCE_BASE_CONFIDENCE[source] || 50;

  // Get current market regime for ML-based signal adjustments
  const regime = await getCurrentRegime();

  // Track which correlation groups have been used and their highest weight
  const groupHighestWeight = new Map<number, number>();
  const signalWeights: { type: string; weight: number; groupIdx: number | undefined }[] = [];

  // First pass: collect all signals and their groups, apply VIX + regime multipliers
  for (const signal of signals) {
    let weight = signal.weight || SIGNAL_WEIGHTS[signal.type] || 5;

    // Apply VIX-based signal strength multiplier (legacy)
    if (VIX_FILTERING_ENABLED && vix !== 20) {
      const vixMultiplier = getVIXSignalMultiplier(vix, signal.type);
      weight = Math.round(weight * vixMultiplier);
    }

    // Apply ML regime-based signal multiplier (NEW - uses learned regime patterns)
    if (regime) {
      const regimeMultiplier = getRegimeSignalMultiplier(regime, signal.type);
      weight = Math.round(weight * regimeMultiplier);
    }

    const groupIdx = SIGNAL_GROUP_MAP.get(signal.type);
    signalWeights.push({ type: signal.type, weight, groupIdx });

    if (groupIdx !== undefined) {
      const currentMax = groupHighestWeight.get(groupIdx) || 0;
      if (weight > currentMax) {
        groupHighestWeight.set(groupIdx, weight);
      }
    }
  }

  // Second pass: apply correlation penalties (only highest in each group gets full weight)
  let totalSignalWeight = 0;
  const groupUsed = new Set<number>();

  for (const { type, weight, groupIdx } of signalWeights) {
    let adjustedWeight = weight;

    if (groupIdx !== undefined) {
      const highestInGroup = groupHighestWeight.get(groupIdx) || weight;
      if (groupUsed.has(groupIdx)) {
        adjustedWeight *= CORRELATION_PENALTY;
      } else if (weight < highestInGroup) {
        adjustedWeight *= CORRELATION_PENALTY;
      }
      groupUsed.add(groupIdx);
    }

    totalSignalWeight += adjustedWeight;
  }

  // Apply saturation curve: diminishing returns beyond 3 signals
  const signalCount = signals.filter(s => (s.weight || SIGNAL_WEIGHTS[s.type] || 0) > 0).length;
  const saturationFactor = signalCount <= 2 ? 0.9 :
                           signalCount === 3 ? 0.85 :
                           signalCount === 4 ? 0.75 :
                           signalCount >= 5 ? 0.65 : 0.8;

  // Apply saturation to signal weight contribution
  confidence += totalSignalWeight * saturationFactor;

  // Confluence bonus only for 3-4 signals
  if (signals.length >= 3 && signals.length <= 4) {
    confidence += 3;
  }

  // Apply regime-based confidence adjustment (crisis mode reduces all confidence)
  if (regime && regime.regime === 'CRISIS') {
    confidence *= 0.8; // 20% reduction in crisis mode
    logger.debug(`[UNIVERSAL-IDEA] Crisis regime: confidence reduced by 20%`);
  } else if (regime && regime.regime === 'HIGH_VOLATILITY') {
    confidence *= 0.9; // 10% reduction in high volatility
  }

  // HARD CAP: Apply a soft ceiling at 92%
  if (confidence > 70) {
    const excessConfidence = confidence - 70;
    const dampenedExcess = excessConfidence * (1 - excessConfidence / 100);
    confidence = 70 + dampenedExcess;
  }

  // NaN protection: if any calculation produced NaN, fall back to base confidence
  if (isNaN(confidence)) {
    logger.warn(`[UNIVERSAL-IDEA] NaN confidence detected for ${source}, using base confidence`);
    confidence = SOURCE_BASE_CONFIDENCE[source] || 60;
  }

  // Clamp to valid range
  let rawConfidence = Math.max(0, Math.min(94, Math.round(confidence)));

  // Apply ML calibration adjustment based on historical accuracy (NEW)
  const calibratedConfidence = applyMLCalibration(rawConfidence);

  // Final NaN check
  if (isNaN(calibratedConfidence)) {
    logger.warn(`[UNIVERSAL-IDEA] NaN after calibration for ${source}, using raw confidence`);
    return rawConfidence;
  }

  return calibratedConfidence;
}

/**
 * Sync version for backward compatibility
 */
function calculateConfidence(source: IdeaSource, signals: IdeaSignal[]): number {
  let confidence = SOURCE_BASE_CONFIDENCE[source] || 50;
  
  const groupHighestWeight = new Map<number, number>();
  const signalWeights: { type: string; weight: number; groupIdx: number | undefined }[] = [];
  
  for (const signal of signals) {
    const weight = signal.weight || SIGNAL_WEIGHTS[signal.type] || 5;
    const groupIdx = SIGNAL_GROUP_MAP.get(signal.type);
    signalWeights.push({ type: signal.type, weight, groupIdx });
    
    if (groupIdx !== undefined) {
      const currentMax = groupHighestWeight.get(groupIdx) || 0;
      if (weight > currentMax) {
        groupHighestWeight.set(groupIdx, weight);
      }
    }
  }
  
  let totalSignalWeight = 0;
  const groupUsed = new Set<number>();
  
  for (const { type, weight, groupIdx } of signalWeights) {
    let adjustedWeight = weight;
    
    if (groupIdx !== undefined) {
      const highestInGroup = groupHighestWeight.get(groupIdx) || weight;
      if (groupUsed.has(groupIdx)) {
        adjustedWeight *= CORRELATION_PENALTY;
      } else if (weight < highestInGroup) {
        adjustedWeight *= CORRELATION_PENALTY;
      }
      groupUsed.add(groupIdx);
    }
    
    totalSignalWeight += adjustedWeight;
  }
  
  const signalCount = signals.filter(s => (s.weight || SIGNAL_WEIGHTS[s.type] || 0) > 0).length;
  const saturationFactor = signalCount <= 2 ? 0.9 :
                           signalCount === 3 ? 0.85 :
                           signalCount === 4 ? 0.75 :
                           signalCount >= 5 ? 0.65 : 0.8;

  confidence += totalSignalWeight * saturationFactor;

  if (signals.length >= 3 && signals.length <= 4) {
    confidence += 3;
  }

  // Soft ceiling at 92% with dampening above 70%
  if (confidence > 70) {
    const excessConfidence = confidence - 70;
    const dampenedExcess = excessConfidence * (1 - excessConfidence / 100);
    confidence = 70 + dampenedExcess;
  }

  return Math.max(0, Math.min(94, Math.round(confidence)));
}

/**
 * Enhance confidence with ML Intelligence prediction
 * Returns boost/penalty and signal description
 */
async function getMLConfidenceEnhancement(
  symbol: string, 
  direction: 'bullish' | 'bearish' | 'neutral',
  prices?: number[]
): Promise<{ boost: number; signal: string | null }> {
  if (!ML_PREDICTIONS_ENABLED) {
    logger.debug(`[UNIVERSAL-IDEA] ML enhancement skipped for ${symbol} - kill switch active`);
    return { boost: 0, signal: null };
  }
  
  // The optional prediction module is absent in this deployment.  A failed
  // dynamic import was neither evidence nor a prediction; it was just an
  // opaque runtime failure. Keep it neutral until a real model is installed
  // and validated against execution-proven outcomes.
  void symbol;
  void direction;
  void prices;
  return { boost: 0, signal: null };
}

// getLetterGrade imported from ./grading (shared/grading.ts contract)

/**
 * Determine holding period based on signals and source
 */
function determineHoldingPeriod(input: UniversalIdeaInput): 'day' | 'swing' | 'position' {
  if (input.holdingPeriod) return input.holdingPeriod;
  
  // Check for day trade signals
  const hasDayTradeSignals = input.signals.some(s => 
    ['RSI_OVERSOLD', 'RSI_OVERBOUGHT', 'VOLUME_SURGE', 'SWEEP_DETECTED'].includes(s.type)
  );
  
  // Check for swing signals
  const hasSwingSignals = input.signals.some(s =>
    ['BREAKOUT', 'SUPPORT_BOUNCE', 'BULL_FLAG', 'CUP_HANDLE'].includes(s.type)
  );
  
  // Check for position signals
  const hasPositionSignals = input.signals.some(s =>
    ['GOLDEN_CROSS', 'INSTITUTIONAL_ACCUMULATION', 'INSIDER_BUYING'].includes(s.type)
  );
  
  if (hasPositionSignals) return 'position';
  if (hasSwingSignals) return 'swing';
  if (hasDayTradeSignals) return 'day';
  
  // Default based on source
  if (input.source === 'options_flow' || input.source === 'social_sentiment') return 'day';
  if (input.source === 'chart_analysis' || input.source === 'quant_signal') return 'swing';
  
  return 'swing';
}

/**
 * Generate engine type label based on source
 */
function getEngineType(source: IdeaSource): string {
  switch (source) {
    case 'ai_analysis': return 'AI';
    case 'quant_signal': return 'Quant';
    case 'options_flow': return 'Flow';
    case 'market_scanner': return 'Scanner';
    case 'chart_analysis': return 'Chart';
    case 'social_sentiment': return 'Social';
    case 'watchlist': return 'Watchlist';
    case 'crypto_scanner': return 'Crypto';
    case 'news_catalyst': return 'News';
    case 'earnings_play': return 'Earnings';
    case 'sector_rotation': return 'Sector';
    case 'manual': return 'Manual';
    default: return 'Hybrid';
  }
}

/** Map our holding-period vocabulary to the engine's setup/DTE window. */
function holdingToSetup(holdingPeriod: string): SetupType {
  if (holdingPeriod === 'day') return 'scalp';
  if (holdingPeriod === 'position') return 'position';
  return 'swing';
}

/**
 * Map the holding horizon to an explicit expiry tier. This is what keeps the
 * contract's expiry aligned with the stated hold: a 'day' trade gets DAILY
 * expiries, a 'swing' gets WEEKLY, a 'position' gets MONTHLY. (LEAP/0DTE are
 * opt-in per idea, not auto-derived.)
 */
function holdingToTier(holdingPeriod: string): ExpiryTier {
  if (holdingPeriod === 'day') return 'DAILY';
  if (holdingPeriod === 'position') return 'MONTHLY';
  return 'WEEKLY';
}

interface AttachedContract {
  optionType: 'call' | 'put';
  strikePrice: number;
  expiryDate: string;
  optionDelta: number;
  optionGamma: number;
  optionTheta: number;
  optionVega: number;
  optionIV: number; // stored as percent to match the schema column comment
  entryPremium: number; // option mid premium at idea creation (for real P&L tracking)
  openInterest: number; // contract open interest at selection (liquidity)
  volume: number;       // contract day volume at selection (liquidity)
  expiryTier: ExpiryTier; // 0DTE|DAILY|WEEKLY|MONTHLY|LEAP — horizon the expiry was bound to
  dte: number;            // days-to-expiry of the chosen contract
  isLottoPlay: boolean;
  tradeType: 'lotto' | 'swing' | 'mover' | 'scalp';
  summary: string;
}

/**
 * Run a directional stock thesis through the canonical option engine and return
 * a concrete contract to attach to the idea. Returns null when no live CBOE
 * chain / liquid contract is found — callers keep the stock-only thesis rather
 * than fabricate a strike (honesty contract).
 */
async function attachOptionContract(args: {
  symbol: string;
  direction: 'bullish' | 'bearish';
  entry: number;
  stop: number;
  t1: number;
  confidence: number;
  holdingPeriod: string;
  /** Optional explicit expiry tier (user-selected); else derived from holdingPeriod. */
  expiryTier?: ExpiryTier;
}): Promise<AttachedContract | null> {
  try {
    const chain = await fetchCboeChain(args.symbol);
    if (!chain) return null;
    const thesis: PriceActionThesis = {
      symbol: args.symbol,
      direction: args.direction,
      setup: holdingToSetup(args.holdingPeriod),
      expiryTier: args.expiryTier ?? holdingToTier(args.holdingPeriod),
      entry: args.entry,
      stop: args.stop,
      t1: args.t1,
      conviction: args.confidence,
      asOfSpot: chain.spot,
    };
    const sel = selectFromChain(thesis, chain.spot, chain.rawChain);
    if (sel.status !== 'ok' || sel.picks.length === 0) return null;
    const pick: ContractCandidate =
      sel.picks.find((p) => p.tier === sel.recommendedTier) ?? sel.picks[0];
    const isLotto = pick.delta < 0.30;
    const tradeType: AttachedContract['tradeType'] = isLotto
      ? 'lotto'
      : args.holdingPeriod === 'day'
        ? 'scalp'
        : 'swing';
    const expFmt = pick.expiry.slice(5).replace('-', '/'); // MM/DD
    const cp = pick.optionType === 'call' ? 'C' : 'P';
    // Stamped as the contract AT SIGNAL TIME, not as a live recommendation.
    // The Contract Engine re-picks against the current chain every time the signal
    // is opened, so this frozen string was appearing beside a different strike and
    // expiry — a BMY signal showed "$66C 08/28, 8DTE" in the thesis while the engine
    // recommended $65C 09/18, 28DTE. Two contracts on one screen, with nothing
    // saying which to trade. Dating it resolves that: this is what the setup looked
    // like when it fired, and the engine is the authority on what to buy now.
    const summary =
      `At signal: $${pick.strike}${cp} ${expFmt} @ $${pick.entryPremium.toFixed(2)} ` +
      `(Δ${pick.delta.toFixed(2)}, ${pick.dte}DTE, contract quality ${pick.grade}) — ` +
      `ROI@T1 ${pick.roiAtT1Pct >= 0 ? '+' : ''}${pick.roiAtT1Pct.toFixed(0)}%, R:R ${pick.riskRewardRatio.toFixed(1)}:1. ` +
      `The Contract Engine re-picks against the live chain.`;
    return {
      optionType: pick.optionType,
      strikePrice: pick.strike,
      expiryDate: pick.expiry,
      optionDelta: Math.round(pick.delta * 1000) / 1000,
      optionGamma: Math.round(pick.gamma * 10000) / 10000,
      optionTheta: Math.round(pick.theta * 1000) / 1000,
      optionVega: Math.round(pick.vega * 1000) / 1000,
      optionIV: Math.round(pick.iv * 100),
      entryPremium: Math.round(pick.entryPremium * 100) / 100,
      openInterest: Math.round(pick.openInterest ?? 0),
      volume: Math.round(pick.volume ?? 0),
      expiryTier: sel.expiryTier,
      dte: pick.dte,
      isLottoPlay: isLotto,
      tradeType,
      summary,
    };
  } catch {
    return null;
  }
}

/**
 * Universal Trade Idea Generator
 * Creates a trade idea from ANY source with calculated confidence
 */
export async function generateUniversalTradeIdea(input: UniversalIdeaInput): Promise<InsertTradeIdea | null> {
  try {
    // 🛡️ LOSS ANALYZER CHECK - Block avoided symbols and apply confidence adjustments
    let lossAdjustment = 0;
    let lossWarningSignal: string | null = null;
    try {
      const { getSymbolAdjustment } = await import("./loss-analyzer-service");
      const symbolAdj = await getSymbolAdjustment(input.symbol.toUpperCase());
      
      if (symbolAdj.shouldAvoid) {
        // 🚫 HARD BLOCK - Do NOT generate ideas for symbols on loss cooldown
        logger.warn(`[UNIVERSAL] ⛔ BLOCKED ${input.symbol}: Symbol on loss cooldown (${symbolAdj.lossStreak} consecutive losses) - idea generation prevented`);
        return null; // Return null to prevent idea generation entirely
      } else if (symbolAdj.lossStreak > 0) {
        logger.info(`[UNIVERSAL] ⚠️ ${input.symbol}: Loss history detected (${symbolAdj.lossStreak} losses, adj: ${symbolAdj.confidenceBoost})`);
        lossWarningSignal = `LOSS_HISTORY (${symbolAdj.lossStreak}L, adj: ${symbolAdj.confidenceBoost})`;
        lossAdjustment = symbolAdj.confidenceBoost; // Apply the loss analyzer adjustment
      } else if (symbolAdj.confidenceBoost > 0) {
        logger.debug(`[UNIVERSAL] ✅ ${input.symbol}: Winning symbol boost +${symbolAdj.confidenceBoost}`);
        lossAdjustment = symbolAdj.confidenceBoost;
      }
    } catch (err) {
      // Loss analyzer not available, continue without adjustment
      logger.debug(`[UNIVERSAL] Loss analyzer check skipped for ${input.symbol}`);
    }
    
    // Fetch FRESH price — never trust stale input price
    let price = 0;
    try {
      const quote = await getTradierQuote(input.symbol);
      if (quote?.last && quote.last > 0) {
        price = quote.last;
      }
    } catch {}
    // Fallback: Yahoo Finance
    if (!price) {
      try {
        const yahooRes = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${input.symbol}?range=5d&interval=1d`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (yahooRes.ok) {
          const yahooData = await yahooRes.json();
          price = yahooData?.chart?.result?.[0]?.meta?.regularMarketPrice || 0;
        }
      } catch {}
    }
    // Last fallback: use input price
    if (!price && input.currentPrice) {
      price = input.currentPrice;
    }
    if (!price) {
      logger.warn(`[UNIVERSAL] Could not fetch price for ${input.symbol}`);
      return null;
    }

    /**
     * ── LEVELS ARE A MATCHED SET ─────────────────────────────────────────
     *
     * A scanner that supplies targetPrice/stopLoss computed them FROM its own
     * currentPrice. Re-fetching a price here and writing THAT as the entry,
     * while passing the scanner's target through untouched, splits one trade
     * across two price sources and two moments.
     *
     * Measured in the live book on 2026-08-27 — bull-flag caps its target at
     * entry x 1.25, so the stored target divided by 1.25 recovers the entry the
     * scanner actually used:
     *
     *   WDC    stored entry $20.60   target $127.22  → scanner entry was $101.78
     *   SWKS   stored entry  $1.52   target  $70.98  → scanner entry was  $56.78
     *   AEIS   stored entry $14.30   target $326.22  → scanner entry was $260.98
     *
     * which published as 133R, 91R and 44R — targets needing +517%, +4554% and
     * +2181%. 20 of 122 open ideas carried R:R above 5 from this alone.
     *
     * So when a scanner hands us a complete set, its own price wins: the levels
     * are only coherent against the price they were derived from. And if that
     * price has since drifted materially from the live one, the setup is STALE
     * — publishing it would put a real stop at a fictional distance — so it is
     * rejected rather than silently re-anchored.
     */
    const scannerPrice = Number(input.currentPrice);
    const hasMatchedLevels =
      Number.isFinite(scannerPrice) && scannerPrice > 0 &&
      (input.targetPrice != null || input.stopLoss != null);

    if (hasMatchedLevels) {
      const drift = Math.abs(price - scannerPrice) / scannerPrice;
      if (drift > 0.15) {
        logger.warn(
          `[UNIVERSAL] ${input.symbol}: REJECTED — scanner priced this at ` +
          `$${scannerPrice.toFixed(2)} but live is $${price.toFixed(2)} ` +
          `(${(drift * 100).toFixed(0)}% drift). Levels would not match the entry.`,
        );
        return null;
      }
      price = scannerPrice;
    }

    // Ensure we have a valid price
    const currentPrice: number = price;
    
    // Fetch current VIX for signal filtering
    let currentVIX = 20;
    if (VIX_FILTERING_ENABLED) {
      currentVIX = await getCurrentVIX();
    } else {
      logger.debug(`[UNIVERSAL-IDEA] VIX filtering skipped for ${input.symbol} - kill switch active, using default VIX=20`);
    }
    
    // Calculate confidence from all signals with VIX filtering and loss adjustment
    let confidence = await calculateConfidenceWithVIX(input.source, input.signals, currentVIX);
    confidence = Math.max(0, Math.min(94, confidence + lossAdjustment));

    // Apply ML Intelligence enhancement (±10 points)
    const mlEnhancement = await getMLConfidenceEnhancement(input.symbol, input.direction);
    confidence = Math.max(0, Math.min(94, confidence + mlEnhancement.boost));
    
    // Fetch news context for stocks (not options/crypto/futures)
    let newsContext: NewsContext | null = null;
    let newsCatalyst: string | null = null;
    let newsAdjustment = 0;
    if (input.assetType === 'stock') {
      try {
        newsContext = await getNewsContext(input.symbol);
        if (newsContext.hasRecentNews) {
          // DIRECTIONAL RECONCILIATION: Only boost when news aligns with trade direction
          const tradeIsBullish = input.direction === 'bullish';
          const newsIsBullish = newsContext.newsBias === 'bullish';
          const newsIsBearish = newsContext.newsBias === 'bearish';
          
          // Special handling for earnings: use beat/miss directly
          if (newsContext.earningsDetected && newsContext.earningsBeat !== null) {
            if (newsContext.earningsBeat && tradeIsBullish) {
              // Earnings beat + long trade = strong alignment
              newsAdjustment = 15;
              logger.info(`[UNIVERSAL] ${input.symbol}: Earnings BEAT aligns with LONG trade → +15 confidence`);
            } else if (newsContext.earningsBeat && !tradeIsBullish) {
              // Earnings beat + short trade = conflict
              newsAdjustment = -15;
              logger.warn(`[UNIVERSAL] ${input.symbol}: Earnings BEAT conflicts with SHORT trade → -15 confidence`);
            } else if (!newsContext.earningsBeat && !tradeIsBullish) {
              // Earnings miss + short trade = alignment
              newsAdjustment = 15;
              logger.info(`[UNIVERSAL] ${input.symbol}: Earnings MISS aligns with SHORT trade → +15 confidence`);
            } else if (!newsContext.earningsBeat && tradeIsBullish) {
              // Earnings miss + long trade = conflict
              newsAdjustment = -15;
              logger.warn(`[UNIVERSAL] ${input.symbol}: Earnings MISS conflicts with LONG trade → -15 confidence`);
            }
          } else {
            // General news sentiment reconciliation
            if (tradeIsBullish && newsIsBullish) {
              newsAdjustment = newsContext.convictionAdjustment; // Positive adjustment
              logger.debug(`[UNIVERSAL] ${input.symbol}: Bullish news aligns with LONG → +${newsAdjustment}`);
            } else if (tradeIsBullish && newsIsBearish) {
              newsAdjustment = -Math.abs(newsContext.convictionAdjustment); // Penalty
              logger.debug(`[UNIVERSAL] ${input.symbol}: Bearish news conflicts with LONG → ${newsAdjustment}`);
            } else if (!tradeIsBullish && newsIsBearish) {
              newsAdjustment = Math.abs(newsContext.convictionAdjustment); // Boost for alignment
              logger.debug(`[UNIVERSAL] ${input.symbol}: Bearish news aligns with SHORT → +${newsAdjustment}`);
            } else if (!tradeIsBullish && newsIsBullish) {
              newsAdjustment = -Math.abs(newsContext.convictionAdjustment); // Penalty
              logger.debug(`[UNIVERSAL] ${input.symbol}: Bullish news conflicts with SHORT → ${newsAdjustment}`);
            }
          }
          
          // Apply the reconciled adjustment (maintain 94% cap)
          confidence = Math.max(0, Math.min(94, confidence + newsAdjustment));
          
          // Use real news catalysts and headlines
          if (newsContext.catalysts.length > 0) {
            newsCatalyst = newsContext.catalysts.slice(0, 2).join('; ');
          }
          if (newsContext.topHeadlines.length > 0) {
            // Add first headline as context (truncated)
            const headline = newsContext.topHeadlines[0].slice(0, 100);
            newsCatalyst = newsCatalyst ? `${newsCatalyst} | ${headline}` : headline;
          }
          
          logger.debug(`[UNIVERSAL] News context for ${input.symbol}: bias=${newsContext.newsBias}, earnings=${newsContext.earningsDetected}, adj=${newsAdjustment}`);
        }
      } catch (err) {
        logger.debug(`[UNIVERSAL] News context fetch skipped for ${input.symbol}`);
      }
    }
    
    const grade = getLetterGrade(confidence);
    
    // Determine holding period
    const holdingPeriod = determineHoldingPeriod(input);
    
    // A scanner can discover a ticker without discovering a trade. Fixed
    // percentage target/stop defaults made that distinction disappear: every
    // name received a plausible-looking 2R ladder whether or not the chart had
    // an actual destination or invalidation. Discovery stays useful, but it
    // cannot be published as an Oracle plan until a source supplies both levels.
    if (typeof input.targetPrice !== 'number' || typeof input.stopLoss !== 'number') {
      logger.info(`[IDEA] ${input.symbol}: coverage only — missing structural target or invalidation`);
      return null;
    }

    const targetPrice = input.targetPrice;
    const stopLoss = input.stopLoss;

    // ── Sanity clamp ────────────────────────────────────────────────
    // A source-provided target/stop must imply a realistic move for its
    // timeframe. Reject an absurd upstream level — do not quietly replace it
    // with another invented percentage.
    const MAX_TARGET_MOVE: Record<string, number> = { day: 0.25, swing: 0.60, position: 1.50 };
    const MAX_STOP_MOVE: Record<string, number> = { day: 0.15, swing: 0.25, position: 0.40 };
    const maxT = MAX_TARGET_MOVE[holdingPeriod] ?? 0.60;
    const maxS = MAX_STOP_MOVE[holdingPeriod] ?? 0.25;
    if (currentPrice > 0) {
      const tMove = Math.abs(targetPrice - currentPrice) / currentPrice;
      if (tMove > maxT) {
        logger.warn(`[IDEA] ${input.symbol}: target implies ${(tMove * 100).toFixed(0)}% (> ${(maxT * 100).toFixed(0)}% ${holdingPeriod} cap)`);
        return null;
      }
      const sMove = Math.abs(stopLoss - currentPrice) / currentPrice;
      if (sMove > maxS) {
        logger.warn(`[IDEA] ${input.symbol}: stop implies ${(sMove * 100).toFixed(0)}% (> ${(maxS * 100).toFixed(0)}% ${holdingPeriod} cap)`);
        return null;
      }
    }

    const levelsPointCorrectly = input.direction === 'bullish'
      ? targetPrice > currentPrice && stopLoss < currentPrice
      : input.direction === 'bearish'
        ? targetPrice < currentPrice && stopLoss > currentPrice
        : false;
    if (!levelsPointCorrectly) {
      logger.warn(`[IDEA] ${input.symbol}: target/stop do not agree with ${input.direction} direction`);
      return null;
    }

    // Calculate risk/reward ratio
    const potentialGain = input.direction === 'bullish' 
      ? targetPrice - currentPrice 
      : currentPrice - targetPrice;
    const potentialRisk = input.direction === 'bullish' 
      ? currentPrice - stopLoss 
      : stopLoss - currentPrice;
    const riskRewardRatio = potentialRisk > 0 ? potentialGain / potentialRisk : 2.0;
    
    // Build signal descriptions (include loss warning, ML signal, VIX info if applicable)
    const signalDescriptions = input.signals.map(s => s.description || s.type);
    if (lossWarningSignal) {
      signalDescriptions.push(lossWarningSignal);
    }
    if (mlEnhancement.signal) {
      signalDescriptions.push(mlEnhancement.signal);
    }
    if (VIX_FILTERING_ENABLED && currentVIX !== 20) {
      signalDescriptions.push(`VIX: ${currentVIX.toFixed(1)}`);
    }
    // Earnings surprise magnitude — survives via the catalyst string in
    // a parseable form so the convictions catalyst layer can score it
    // without a schema migration. Format: "[surprise=+12.4%]".
    if (typeof newsContext?.earningsSurprisePct === 'number') {
      const sp = newsContext.earningsSurprisePct;
      signalDescriptions.push(`Earnings surprise ${sp >= 0 ? '+' : ''}${sp.toFixed(1)}%`);
    }
    
    // Generate analysis text
    const analysis = input.analysis || `${getEngineType(input.source)} signal detected: ${signalDescriptions.slice(0, 3).join(', ')}. ` +
      `${input.direction === 'bullish' ? 'Bullish' : 'Bearish'} setup with ${confidence}% confidence.`;
    
    // ── Attach a concrete option contract ──────────────────────────
    // Every directional equity idea should carry a REAL option (strike/expiry/
    // greeks) picked by the canonical engine — not just stock key levels.
    // If the caller already specified an exact contract (e.g. the Contract
    // Analyzer or a flow alert), keep it; otherwise derive one from the chain.
    let optionType: 'call' | 'put' | null =
      (input.optionType as 'call' | 'put' | undefined) || null;
    let strikePrice: number | null = input.strikePrice || null;
    let expiryDate: string | null = input.expiryDate || null;
    let optionDelta: number | null = null;
    let optionGamma: number | null = null;
    let optionTheta: number | null = null;
    let optionVega: number | null = null;
    let optionIV: number | null = null;
    let entryPremium: number | null =
      Number.isFinite(input.entryPremium) && Number(input.entryPremium) > 0
        ? Number(input.entryPremium)
        : null;
    let optionOpenInterest: number | null = null;
    let optionVolume: number | null = null;
    let expiryTier: ExpiryTier | null = null;
    let optionDte: number | null = null;
    let isLottoPlay = false;
    let tradeType: 'lotto' | 'swing' | 'mover' | 'scalp' = 'swing';
    let contractSummary: string | null = null;
    let resolvedAssetType = input.assetType;

    const callerSpecifiedContract = !!(input.optionType && input.strikePrice && input.expiryDate);
    if (!callerSpecifiedContract && input.assetType !== 'crypto' && input.direction !== 'neutral') {
      const attached = await attachOptionContract({
        symbol: input.symbol,
        direction: input.direction,
        entry: currentPrice,
        stop: stopLoss,
        t1: targetPrice,
        confidence,
        holdingPeriod,
      });
      if (attached) {
        optionType = attached.optionType;
        strikePrice = attached.strikePrice;
        expiryDate = attached.expiryDate;
        optionDelta = attached.optionDelta;
        optionGamma = attached.optionGamma;
        optionTheta = attached.optionTheta;
        optionVega = attached.optionVega;
        optionIV = attached.optionIV;
        entryPremium = attached.entryPremium;
        optionOpenInterest = attached.openInterest;
        optionVolume = attached.volume;
        expiryTier = attached.expiryTier;
        optionDte = attached.dte;
        isLottoPlay = attached.isLottoPlay;
        tradeType = attached.tradeType;
        contractSummary = attached.summary;
        resolvedAssetType = 'option';
        logger.info(`[UNIVERSAL] Attached contract for ${input.symbol}: ${optionType} $${strikePrice} ${expiryDate} (Δ${optionDelta})`);
      }
    } else if (callerSpecifiedContract && optionType && strikePrice && expiryDate && entryPremium == null) {
      // Caller already named the exact contract (Contract Analyzer / flow alert).
      // Capture its live mid as the entry premium so the P&L tracker has a real
      // cost basis. Never fabricate — leave null if the chain/contract isn't found.
      try {
        const chain = await fetchCboeChain(input.symbol);
        if (chain) {
          const mid = findContractMid(chain, optionType, strikePrice, expiryDate);
          if (mid != null) {
            entryPremium = Math.round(mid * 100) / 100;
            logger.info(`[UNIVERSAL] Captured entry premium for ${input.symbol} ${optionType} $${strikePrice} ${expiryDate}: $${entryPremium}`);
          }
        }
      } catch (e) {
        logger.warn(`[UNIVERSAL] Could not capture entry premium for ${input.symbol}: ${e}`);
      }
    }

    // SAVE-AS-STOCK FALLBACK: if this was meant to be an option but no concrete
    // contract could be attached (e.g. CBOE chain unavailable / 429), downgrade to
    // a stock thesis rather than persisting a contract-less "option". The next scan
    // for this symbol re-attempts attachment once the chain is reachable.
    if (resolvedAssetType === 'option' && !(optionType && strikePrice && expiryDate)) {
      logger.info(`[UNIVERSAL] ${input.symbol}: no option contract attached (chain unavailable) — saving as stock, will retry next cycle`);
      resolvedAssetType = 'stock';
    }

    // Determine session context based on current time
    const hour = new Date().getHours();
    const sessionContext = hour < 9 ? 'pre-market' : hour < 16 ? 'regular' : 'after-hours';

    const idea: InsertTradeIdea = {
      symbol: input.symbol.toUpperCase(),
      assetType: resolvedAssetType,
      direction: input.direction === 'bullish' ? 'long' : 'short',
      /**
       * SOURCE WAS NEVER WRITTEN.
       *
       * This object omitted `source`, so the schema default ('quant') applied to
       * every idea from every producer — bull-flag, GEX, spx-session, manual
       * operator adds, all of them stored as 'quant'. The column has been
       * uniform since it was added, which means:
       *   • no producer could ever be graded separately
       *   • the ingestion dedup keys on (symbol, source), so it was really
       *     keying on symbol alone and could not tell a manual add from a
       *     scanner republish
       *   • "82 duplicate rows, all source=quant" read as one scanner
       *     misbehaving when it was actually every scanner sharing one label
       */
      source: input.source,
      entryPrice: currentPrice,
      targetPrice,
      stopLoss,
      riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
      confidenceScore: confidence,
      probabilityBand: grade,
      holdingPeriod,
      timestamp: input.signalTimestamp ?? new Date().toISOString(),
      sessionContext,

      // Option fields — concrete contract from the canonical engine
      optionType,
      strikePrice,
      expiryDate,
      optionDelta,
      optionGamma,
      optionTheta,
      optionVega,
      optionIV,
      entryPremium,
      optionOpenInterest,
      optionVolume,
      expiryTier,
      optionDte,
      isLottoPlay,
      tradeType,

      // Analysis - use real news catalysts when available. If we have an
      // earnings surprise magnitude, append it in a machine-parseable tag
      // so the convictions catalyst layer can score it.
      catalyst: (() => {
        const base =
          input.catalyst ||
          newsCatalyst ||
          `${getEngineType(input.source)} detected ${input.direction} signal`;
        if (typeof newsContext?.earningsSurprisePct === 'number') {
          const sp = newsContext.earningsSurprisePct;
          return `${base} [surprise=${sp >= 0 ? '+' : ''}${sp.toFixed(1)}%]`;
        }
        return base;
      })(),
      analysis: contractSummary ? `${analysis} ${contractSummary}` : analysis,
      qualitySignals: contractSummary ? [...signalDescriptions, contractSummary] : signalDescriptions,

      // Outcome tracking
      outcomeStatus: 'open',
      
      // Source metadata
      dataSourceUsed: input.dataSourceUsed ?? input.source,

      // News sentiment fields
      newsBias: newsContext?.newsBias || null,
      earningsBeat: newsContext?.earningsBeat ?? null,

      // 🎯 Deep Analysis - Store full signal breakdown for Trade Desk
      convergenceSignalsJson: input.convergenceAnalysis || null,
    };

    logger.info(`[UNIVERSAL] Generated ${input.symbol} idea from ${input.source}: ${confidence}% (${grade})`);
    
    return idea;
    
  } catch (error) {
    logger.error(`[UNIVERSAL] Error generating idea for ${input.symbol}:`, error);
    return null;
  }
}

/**
 * Generate and save a trade idea from any source
 * Includes database-level deduplication to prevent duplicate ideas
 */
export async function createAndSaveUniversalIdea(input: UniversalIdeaInput): Promise<boolean> {
  const symbol = input.symbol.toUpperCase();

  // WATCHLIST GATE — SINGLE SOURCE OF TRUTH.
  // Use the SAME broad list the GEX Hub scans (@shared/approved-tickers:
  // semis + software + quantum + space + nuclear + defense + indices + crypto).
  // Previously this used a separate narrow ~60-ticker semis-only copy, which
  // silently blocked every quantum/space/software name the GEX Hub surfaced.
  /**
   * The whitelist gates SCANNERS, not the operator.
   *
   * A person naming a symbol is a stronger signal than a 197-row static list —
   * and that list is why the board could not publish W, ETSY, ASML, IRDM or S
   * even after the bull-flag scanner started finding them. The skip list below
   * still applies to everything: it holds names that are broken or untradeable,
   * which is a different claim from "not on our list".
   */
  const isOperatorAdd = String((input as any).source ?? '') === 'manual';
  // Measured aggressor flow earns candidacy on its own: an options_flow idea
  // exists because dollars were counted at the ask, and a hand-curated list
  // must not veto that (2026-09-23: whole-market Bullflow leaders were being
  // silently dropped here — the POET/NNE class could never publish).
  const isMeasuredFlow = String((input as any).source ?? '') === 'options_flow';
  const isTradingView = String((input as any).source ?? '') === 'tradingview';
  // Benchmark-complex names (shared/leadership-universe) also skip the
  // hand-curated list: the operator's doctrine is leaders-first, and the
  // index-swing scanner was being vetoed on IGV (2026-09-23).
  let isBenchmark = false;
  try {
    const { isLeadershipName } = await import('@shared/leadership-universe');
    isBenchmark = isLeadershipName(symbol);
  } catch { /* module unavailable — curated list rules */ }
  if (!isOperatorAdd && !isMeasuredFlow && !isTradingView && !isBenchmark && !isApprovedTicker(symbol)) {
    logger.debug(`[UNIVERSAL] Blocked ${symbol} — not on approved watchlist`);
    return false;
  }
  if (isSkipTicker(symbol)) {
    logger.debug(`[UNIVERSAL] Blocked ${symbol} — on skip list`);
    return false;
  }

  // DATABASE-LEVEL DEDUPLICATION: Check for recent idea with same symbol/direction
  try {
    const existingIdeas = await storage.getAllTradeIdeas();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // Stored rows say long/short while callers say bullish/bearish — compare
    // in one spelling or this window never matches anything (found 2026-09-23:
    // 'long' !== 'bullish' made this dedup dead code since it shipped).
    const wantDir = input.direction === 'bullish' ? 'long' : 'short';
    const normDir = (d: string | null | undefined) =>
      d === 'bullish' ? 'long' : d === 'bearish' ? 'short' : (d ?? '');
    const recentDuplicate = existingIdeas.find(idea =>
      idea.symbol === symbol &&
      normDir(idea.direction) === wantDir &&
      idea.timestamp && new Date(idea.timestamp) > twoHoursAgo
    );

    if (recentDuplicate) {
      logger.debug(`[UNIVERSAL] Skipped duplicate: ${symbol} ${input.direction} already exists from ${Math.round((Date.now() - new Date(recentDuplicate.timestamp!).getTime()) / 60000)}min ago`);
      return false;
    }
  } catch (err) {
    // Continue if check fails
  }

  const idea = await generateUniversalTradeIdea(input);

  if (!idea) {
    return false;
  }

  try {
    await storage.createTradeIdea(idea);
    logger.info(`[UNIVERSAL] Saved trade idea: ${idea.symbol} from ${input.source}`);
    return true;
  } catch (error) {
    logger.error(`[UNIVERSAL] Failed to save idea for ${input.symbol}:`, error);
    return false;
  }
}

/**
 * CONTRACT BACKFILL — the "retry later" half of the save-as-stock fallback.
 *
 * When an option-intent idea can't attach a contract at creation (CBOE chain
 * unavailable / 429), it's persisted as a bare stock thesis. The 2-hour dedup
 * then blocks the symbol from regenerating, so the idea would otherwise stay
 * contract-less for hours. This pass re-attempts attachment IN PLACE: it scans
 * open, directional, contract-less ideas and upgrades them to real option
 * contracts via the canonical engine once the chain is reachable again.
 *
 * Surgical scope (avoid touching deliberately-stock or user-authored ideas):
 *   - outcomeStatus 'open' (don't rewrite resolved trades)
 *   - assetType 'stock' AND no optionType yet
 *   - direction long/short (engine needs a directional thesis)
 *   - source NOT manual/chart_analysis (respect explicit user choices)
 *   - has entry + stop + target (engine inputs)
 *
 * Runs sequentially; the fetchCboeChain TTL cache absorbs duplicate symbols.
 */
export async function backfillContractlessIdeas(): Promise<{ scanned: number; upgraded: number }> {
  let scanned = 0;
  let upgraded = 0;
  try {
    const ideas = await storage.getAllTradeIdeas();
    const candidates = ideas.filter(i =>
      (i.outcomeStatus ?? 'open') === 'open' &&
      i.assetType === 'stock' &&
      !i.optionType &&
      (i.direction === 'long' || i.direction === 'short') &&
      i.source !== 'manual' && i.source !== 'chart_analysis' &&
      typeof i.entryPrice === 'number' &&
      typeof i.stopLoss === 'number' &&
      typeof i.targetPrice === 'number'
    );

    if (candidates.length === 0) return { scanned: 0, upgraded: 0 };
    logger.info(`[BACKFILL] ${candidates.length} contract-less option-intent idea(s) to retry`);

    for (const idea of candidates) {
      scanned++;
      try {
        const attached = await attachOptionContract({
          symbol: idea.symbol,
          direction: idea.direction === 'long' ? 'bullish' : 'bearish',
          entry: idea.entryPrice as number,
          stop: idea.stopLoss as number,
          t1: idea.targetPrice as number,
          confidence: idea.confidenceScore ?? 60,
          holdingPeriod: idea.holdingPeriod ?? 'swing',
        });
        if (!attached) {
          logger.debug(`[BACKFILL] ${idea.symbol}: chain still unavailable — leaving as stock`);
          continue;
        }
        await storage.updateTradeIdea(idea.id, {
          assetType: 'option',
          optionType: attached.optionType,
          strikePrice: attached.strikePrice,
          expiryDate: attached.expiryDate,
          optionDelta: attached.optionDelta,
          optionGamma: attached.optionGamma,
          optionTheta: attached.optionTheta,
          optionVega: attached.optionVega,
          optionIV: attached.optionIV,
          entryPremium: attached.entryPremium,
          optionOpenInterest: attached.openInterest,
          optionVolume: attached.volume,
          expiryTier: attached.expiryTier,
          optionDte: attached.dte,
          isLottoPlay: attached.isLottoPlay,
          tradeType: attached.tradeType,
          analysis: `${idea.analysis} ${attached.summary}`,
        });
        upgraded++;
        logger.info(`[BACKFILL] ✅ ${idea.symbol}: upgraded to ${attached.optionType} $${attached.strikePrice} ${attached.expiryDate} @ $${attached.entryPremium}`);
      } catch (e) {
        logger.warn(`[BACKFILL] ${idea.symbol}: upgrade failed — ${(e as Error).message}`);
      }
    }
  } catch (err) {
    logger.error('[BACKFILL] Pass failed:', err);
  }
  if (upgraded > 0) logger.info(`[BACKFILL] Upgraded ${upgraded}/${scanned} idea(s) to real contracts`);
  return { scanned, upgraded };
}

/**
 * Generate idea from watchlist item when setup is detected
 */
export async function generateIdeaFromWatchlist(
  symbol: string,
  signals: IdeaSignal[],
  assetType: 'stock' | 'option' | 'crypto' = 'stock'
): Promise<InsertTradeIdea | null> {
  const direction = signals.some(s => 
    ['RSI_OVERSOLD', 'SUPPORT_BOUNCE', 'BULL_FLAG', 'GOLDEN_CROSS'].includes(s.type)
  ) ? 'bullish' : 'bearish';
  
  return generateUniversalTradeIdea({
    symbol,
    source: 'watchlist',
    assetType,
    direction,
    signals,
  });
}

/**
 * Generate idea from market scanner mover
 */
export async function generateIdeaFromScanner(
  symbol: string,
  changePercent: number,
  timeframe: 'day' | 'week' | 'month' | 'year',
  additionalSignals: IdeaSignal[] = []
): Promise<InsertTradeIdea | null> {
  const isGainer = changePercent > 0;
  
  const signals: IdeaSignal[] = [
    {
      type: isGainer ? 'TOP_GAINER' : 'TOP_LOSER',
      weight: 10,
      description: `${Math.abs(changePercent).toFixed(1)}% ${isGainer ? 'gainer' : 'loser'} (${timeframe})`,
    },
    {
      type: 'MARKET_SCANNER_MOVER',
      weight: 8,
      description: `Top mover from market scanner`,
    },
    ...additionalSignals,
  ];
  
  return generateUniversalTradeIdea({
    symbol,
    source: 'market_scanner',
    assetType: 'stock',
    direction: isGainer ? 'bullish' : 'bearish',
    signals,
    holdingPeriod: timeframe === 'day' ? 'day' : 'swing',
    sourceMetadata: { scannerTimeframe: timeframe },
  });
}

/**
 * Generate idea from options flow alert
 */
export async function generateIdeaFromFlow(
  symbol: string,
  optionType: 'call' | 'put',
  strikePrice: number,
  expiryDate: string,
  premium: number,
  unusualScore: number,
  additionalSignals: IdeaSignal[] = []
): Promise<InsertTradeIdea | null> {
  const isCall = optionType === 'call';
  
  const signals: IdeaSignal[] = [
    {
      type: isCall ? 'UNUSUAL_CALL_FLOW' : 'UNUSUAL_PUT_FLOW',
      weight: 12,
      description: `Unusual ${optionType} activity detected`,
    },
    {
      type: 'LARGE_PREMIUM',
      weight: premium > 500000 ? 15 : premium > 100000 ? 10 : 5,
      description: `$${(premium / 1000).toFixed(0)}k premium`,
    },
    ...additionalSignals,
  ];
  
  if (unusualScore >= 80) {
    signals.push({
      type: 'SWEEP_DETECTED',
      weight: 15,
      description: `High unusual score: ${unusualScore}`,
    });
  }
  
  return generateUniversalTradeIdea({
    symbol,
    source: 'options_flow',
    assetType: 'option',
    direction: isCall ? 'bullish' : 'bearish',
    optionType,
    strikePrice,
    expiryDate,
    signals,
    holdingPeriod: 'day',
    sourceMetadata: { flowPremium: premium, unusualActivityScore: unusualScore },
  });
}

/**
 * Generate idea from social sentiment / CT Tracker
 */
export async function generateIdeaFromSocial(
  symbol: string,
  sentiment: 'bullish' | 'bearish' | 'neutral',
  mentionCount: number,
  influencerName?: string,
  additionalSignals: IdeaSignal[] = []
): Promise<InsertTradeIdea | null> {
  const signals: IdeaSignal[] = [
    {
      type: 'TRENDING_TICKER',
      weight: 8,
      description: `${mentionCount} mentions detected`,
    },
    {
      type: sentiment === 'bullish' ? 'SENTIMENT_BULLISH' : 'SENTIMENT_BEARISH',
      weight: 8,
      description: `${sentiment} sentiment from social sources`,
    },
    ...additionalSignals,
  ];
  
  if (influencerName) {
    signals.push({
      type: 'INFLUENCER_MENTION',
      weight: 10,
      description: `Mentioned by ${influencerName}`,
    });
  }
  
  if (mentionCount >= 10) {
    signals.push({
      type: 'HIGH_ENGAGEMENT',
      weight: 6,
      description: `High mention volume`,
    });
  }
  
  return generateUniversalTradeIdea({
    symbol,
    source: 'social_sentiment',
    assetType: 'crypto', // Social often tracks crypto
    direction: sentiment === 'neutral' ? 'bullish' : sentiment,
    signals,
    holdingPeriod: 'day',
    sourceMetadata: { mentionCount, influencerName },
  });
}

/**
 * Generate idea from chart pattern detection
 */
export async function generateIdeaFromChart(
  symbol: string,
  patternType: string,
  direction: 'bullish' | 'bearish',
  supportLevel?: number,
  resistanceLevel?: number,
  additionalSignals: IdeaSignal[] = []
): Promise<InsertTradeIdea | null> {
  const signals: IdeaSignal[] = [
    {
      type: patternType.toUpperCase().replace(/\s+/g, '_'),
      weight: SIGNAL_WEIGHTS[patternType.toUpperCase().replace(/\s+/g, '_')] || 10,
      description: `${patternType} pattern detected`,
    },
    ...additionalSignals,
  ];
  
  if (supportLevel) {
    signals.push({
      type: 'SUPPORT_BOUNCE',
      weight: 8,
      description: `Support at $${supportLevel.toFixed(2)}`,
    });
  }
  
  if (resistanceLevel) {
    signals.push({
      type: 'RESISTANCE_REJECTION',
      weight: 8,
      description: `Resistance at $${resistanceLevel.toFixed(2)}`,
    });
  }
  
  return generateUniversalTradeIdea({
    symbol,
    source: 'chart_analysis',
    assetType: 'stock',
    direction,
    signals,
    holdingPeriod: 'swing',
    sourceMetadata: { patternType },
  });
}

// Export signal weights for external use
export { SIGNAL_WEIGHTS, SOURCE_BASE_CONFIDENCE };
