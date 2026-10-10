/**
 * Unified Pattern Domain Service
 * 
 * Single source of truth for pattern detection algorithms used across:
 * - Pattern Scanner tab
 * - Visual Analysis tab  
 * - Pattern Search/Library
 * - Backtesting
 * 
 * DELEGATES to pattern-intelligence.ts for actual detection (full pattern coverage)
 * ADDS unified scoring, response formatting, and real trade data access
 */

import { db } from './db';
import { patternSignals, tradeIdeas, type PatternSignal, type PatternType } from '@shared/schema';
import { eq, desc, and, gte, sql, inArray } from 'drizzle-orm';
import { logger } from './logger';
import { fetchOHLCData, type OHLCData } from './chart-analysis';

// Import existing pattern detection engine for full coverage
import { 
  analyzeSymbolPatterns as legacyAnalyzeSymbol,
  PATTERN_DISPLAY_NAMES as LEGACY_PATTERN_NAMES,
  BULLISH_PATTERNS as LEGACY_BULLISH_PATTERNS
} from './pattern-intelligence';

// ============================================
// SHARED PATTERN DEFINITIONS
// ============================================

export const PATTERN_TYPES = {
  bull_flag: 'bull_flag',
  ascending_triangle: 'ascending_triangle',
  cup_and_handle: 'cup_and_handle',
  vcp: 'vcp',
  parabolic_move: 'parabolic_move',
  momentum_surge: 'momentum_surge',
  base_breakout: 'base_breakout',
  channel_breakout: 'channel_breakout',
  double_bottom: 'double_bottom',
  falling_wedge: 'falling_wedge',
  inverse_head_shoulders: 'inverse_head_shoulders',
} as const;

export const PATTERN_DISPLAY_NAMES: Record<string, string> = {
  bull_flag: 'Bull Flag',
  ascending_triangle: 'Ascending Triangle',
  cup_and_handle: 'Cup & Handle',
  vcp: 'VCP (Volatility Contraction)',
  parabolic_move: 'Parabolic Move',
  momentum_surge: 'Momentum Surge',
  base_breakout: 'Base Breakout',
  channel_breakout: 'Channel Breakout',
  double_bottom: 'Double Bottom',
  falling_wedge: 'Falling Wedge',
  inverse_head_shoulders: 'Inverse H&S',
};

export const BULLISH_PATTERNS: PatternType[] = [
  'bull_flag', 'ascending_triangle', 'cup_and_handle', 'vcp', 
  'parabolic_move', 'momentum_surge', 'base_breakout', 'channel_breakout',
  'double_bottom', 'falling_wedge', 'inverse_head_shoulders'
];

// ============================================
// UNIFIED SCORING SYSTEM
// ============================================

export interface UnifiedPatternScore {
  score: number;
  confidence: number;
  urgency: 'imminent' | 'soon' | 'developing';
  signals: string[];
  warnings: string[];
}

/**
 * Calculate unified pattern score from raw metrics
 * This is THE source of truth for scoring across all tabs
 */
export function calculateUnifiedScore(params: {
  baseScore: number;
  volumeConfirmation: boolean;
  priceConfirmation: boolean;
  trendAlignment: boolean;
  distanceToBreakout: number;
  rsiValue?: number;
  vwapAlignment?: boolean;
}): UnifiedPatternScore {
  let score = params.baseScore;
  const signals: string[] = [];
  const warnings: string[] = [];

  if (params.volumeConfirmation) {
    score += 10;
    signals.push('Volume confirming');
  } else {
    warnings.push('Low volume');
  }

  if (params.priceConfirmation) {
    score += 8;
    signals.push('Price at key level');
  }

  if (params.trendAlignment) {
    score += 7;
    signals.push('Trend aligned');
  } else {
    warnings.push('Counter-trend');
  }

  if (params.vwapAlignment) {
    score += 5;
    signals.push('Above VWAP');
  }

  if (params.rsiValue !== undefined) {
    if (params.rsiValue < 70) {
      score += 5;
      signals.push(`RSI healthy (${params.rsiValue.toFixed(0)})`);
    } else {
      score -= 5;
      warnings.push(`RSI overbought (${params.rsiValue.toFixed(0)})`);
    }
  }

  score = Math.min(100, Math.max(0, score));

  let urgency: 'imminent' | 'soon' | 'developing';
  if (params.distanceToBreakout < 1) {
    urgency = 'imminent';
  } else if (params.distanceToBreakout < 3) {
    urgency = 'soon';
  } else {
    urgency = 'developing';
  }

  const confidence = Math.min(100, score + (signals.length * 2) - (warnings.length * 3));

  return {
    score: Math.round(score),
    confidence: Math.round(Math.max(0, confidence)),
    urgency,
    signals,
    warnings,
  };
}

// ============================================
// UNIFIED PATTERN ANALYSIS
// ============================================

export interface UnifiedPatternResult {
  symbol: string;
  patternType: PatternType;
  patternName: string;
  score: UnifiedPatternScore;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  riskRewardRatio: number;
  breakoutLevel: number;
  distanceToBreakout: number;
  technicalContext: {
    rsi: number | null;
    macd: { value: number; signal: number; histogram: number } | null;
    vwap: number | null;
    atr: number | null;
    volume20DayAvg: number | null;
    currentVolume: number | null;
  };
  timestamp: string;
  source: 'scanner' | 'visual' | 'manual';
}

/**
 * Analyze a symbol for patterns using the FULL detection engine
 * Delegates to pattern-intelligence.ts for complete pattern coverage
 * This is called by both Pattern Scanner and Visual Analysis
 */
export async function analyzeSymbolPatterns(
  symbol: string,
  assetType: string = 'stock',
  source: 'scanner' | 'visual' | 'manual' = 'scanner'
): Promise<UnifiedPatternResult[]> {
  try {
    // Use legacy engine for full pattern detection coverage
    const legacyAnalysis = await legacyAnalyzeSymbol(symbol);
    
    if (!legacyAnalysis || !legacyAnalysis.patterns || legacyAnalysis.patterns.length === 0) {
      return [];
    }

    const results: UnifiedPatternResult[] = [];
    
    // Get technical context for unified scoring
    const ohlcData = await fetchOHLCData(symbol, assetType, 60);
    const technicalContext = ohlcData ? calculateTechnicalContext(ohlcData) : {
      rsi: null, macd: null, vwap: null, atr: null, volume20DayAvg: null, currentVolume: null
    };

    // Convert legacy patterns to unified format with consistent scoring
    for (const pattern of legacyAnalysis.patterns) {
      const unifiedScore = calculateUnifiedScore({
        baseScore: pattern.score || 50,
        volumeConfirmation: pattern.volumeConfirmed || false,
        priceConfirmation: pattern.priceConfirmed || false,
        trendAlignment: true, // Legacy patterns are pre-filtered for trend
        distanceToBreakout: pattern.distanceToBreakout || 5,
        rsiValue: technicalContext.rsi || undefined,
        vwapAlignment: technicalContext.vwap && legacyAnalysis.currentPrice 
          ? legacyAnalysis.currentPrice > technicalContext.vwap 
          : undefined,
      });

      results.push({
        symbol,
        patternType: pattern.type as PatternType,
        patternName: PATTERN_DISPLAY_NAMES[pattern.type] || LEGACY_PATTERN_NAMES[pattern.type] || pattern.type,
        score: unifiedScore,
        entryPrice: legacyAnalysis.currentPrice || 0,
        targetPrice: pattern.target || 0,
        stopLoss: pattern.stopLoss || 0,
        riskRewardRatio: pattern.riskReward || 0,
        breakoutLevel: pattern.breakoutLevel || pattern.target || 0,
        distanceToBreakout: pattern.distanceToBreakout || 0,
        technicalContext,
        timestamp: new Date().toISOString(),
        source,
      });
    }

    return results;
  } catch (error) {
    logger.error(`Error analyzing patterns for ${symbol}:`, error);
    return [];
  }
}

// ============================================
// PATTERN DETECTION FUNCTIONS (using OHLCData arrays)
// ============================================

interface PatternDetection {
  detected: boolean;
  baseScore: number;
  volumeConfirmed: boolean;
  priceConfirmed: boolean;
  trendAligned: boolean;
  distanceToBreakout: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  breakoutLevel: number;
  riskReward: number;
}

function detectBullFlag(data: OHLCData): PatternDetection | null {
  if (data.closes.length < 30) return null;

  const closes = data.closes.slice(-30);
  
  const poleStart = closes[0];
  const poleEnd = closes[9];
  const poleGain = (poleEnd - poleStart) / poleStart;

  if (poleGain < 0.05) return null;

  const flagBars = closes.slice(10);
  const flagHigh = Math.max(...flagBars);
  const flagLow = Math.min(...flagBars);
  const flagRange = (flagHigh - flagLow) / flagLow;

  if (flagRange > 0.08) return null;

  const currentPrice = closes[closes.length - 1];
  const breakoutLevel = flagHigh;
  const distanceToBreakout = ((breakoutLevel - currentPrice) / currentPrice) * 100;

  const targetPrice = currentPrice + (flagHigh - flagLow) * 2;
  const stopLoss = flagLow * 0.98;
  const riskReward = (targetPrice - currentPrice) / (currentPrice - stopLoss);

  return {
    detected: true,
    baseScore: 60 + Math.min(20, poleGain * 100),
    volumeConfirmed: true,
    priceConfirmed: currentPrice > (flagLow + (flagHigh - flagLow) * 0.5),
    trendAligned: poleGain > 0,
    distanceToBreakout,
    entryPrice: currentPrice,
    targetPrice,
    stopLoss,
    breakoutLevel,
    riskReward: Math.max(1, riskReward),
  };
}

function detectAscendingTriangle(data: OHLCData): PatternDetection | null {
  if (data.highs.length < 20) return null;

  const highs = data.highs.slice(-20);
  const lows = data.lows.slice(-20);
  const closes = data.closes.slice(-20);
  
  const resistanceAvg = highs.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const resistanceVariance = highs.slice(-10).reduce((sum, h) => sum + Math.abs(h - resistanceAvg), 0) / 10;
  
  if (resistanceVariance / resistanceAvg > 0.02) return null;

  let risingSupport = true;
  for (let i = 5; i < lows.length; i++) {
    if (lows[i] < lows[i - 5] * 0.98) {
      risingSupport = false;
      break;
    }
  }

  if (!risingSupport) return null;

  const currentPrice = closes[closes.length - 1];
  const breakoutLevel = resistanceAvg;
  const distanceToBreakout = ((breakoutLevel - currentPrice) / currentPrice) * 100;
  const support = Math.min(...lows.slice(-5));

  const targetPrice = breakoutLevel + (breakoutLevel - support);
  const stopLoss = support * 0.98;
  const riskReward = (targetPrice - currentPrice) / (currentPrice - stopLoss);

  return {
    detected: true,
    baseScore: 65,
    volumeConfirmed: true,
    priceConfirmed: currentPrice > support + (breakoutLevel - support) * 0.7,
    trendAligned: true,
    distanceToBreakout,
    entryPrice: currentPrice,
    targetPrice,
    stopLoss,
    breakoutLevel,
    riskReward: Math.max(1, riskReward),
  };
}

function detectVCP(data: OHLCData): PatternDetection | null {
  if (data.highs.length < 40) return null;

  const highs = data.highs.slice(-40);
  const lows = data.lows.slice(-40);
  const closes = data.closes.slice(-40);
  
  const ranges: number[] = [];
  for (let i = 0; i < 4; i++) {
    const segmentHighs = highs.slice(i * 10, (i + 1) * 10);
    const segmentLows = lows.slice(i * 10, (i + 1) * 10);
    const high = Math.max(...segmentHighs);
    const low = Math.min(...segmentLows);
    ranges.push((high - low) / low);
  }

  let contracting = true;
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i] > ranges[i - 1] * 1.1) {
      contracting = false;
      break;
    }
  }

  if (!contracting) return null;

  const currentPrice = closes[closes.length - 1];
  const pivotHigh = Math.max(...highs.slice(-10));
  const breakoutLevel = pivotHigh;
  const distanceToBreakout = ((breakoutLevel - currentPrice) / currentPrice) * 100;

  const lastRange = ranges[ranges.length - 1];
  const stopLoss = currentPrice * (1 - lastRange - 0.01);
  const targetPrice = breakoutLevel * (1 + ranges[0]);
  const riskReward = (targetPrice - currentPrice) / (currentPrice - stopLoss);

  return {
    detected: true,
    baseScore: 70 + Math.min(15, (1 - lastRange / ranges[0]) * 30),
    volumeConfirmed: true,
    priceConfirmed: distanceToBreakout < 3,
    trendAligned: currentPrice > closes[0],
    distanceToBreakout,
    entryPrice: currentPrice,
    targetPrice,
    stopLoss,
    breakoutLevel,
    riskReward: Math.max(1, riskReward),
  };
}

function detectMomentumSurge(data: OHLCData): PatternDetection | null {
  if (data.closes.length < 10) return null;

  const closes = data.closes.slice(-10);
  
  const gain5d = (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6];
  const gain10d = (closes[closes.length - 1] - closes[0]) / closes[0];

  if (gain5d < 0.05 || gain10d < 0.08) return null;

  const currentPrice = closes[closes.length - 1];
  const breakoutLevel = currentPrice;
  const stopLoss = Math.min(...closes.slice(-5)) * 0.97;
  const targetPrice = currentPrice * (1 + gain5d);
  const riskReward = (targetPrice - currentPrice) / (currentPrice - stopLoss);

  return {
    detected: true,
    baseScore: 60 + Math.min(25, gain5d * 200),
    volumeConfirmed: true,
    priceConfirmed: true,
    trendAligned: gain10d > 0,
    distanceToBreakout: 0,
    entryPrice: currentPrice,
    targetPrice,
    stopLoss,
    breakoutLevel,
    riskReward: Math.max(1, riskReward),
  };
}

// ============================================
// TECHNICAL CONTEXT CALCULATION
// ============================================

function calculateTechnicalContext(data: OHLCData): UnifiedPatternResult['technicalContext'] {
  const closes = data.closes;
  
  let rsi: number | null = null;
  if (closes.length >= 15) {
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }
    const avgGain = gains.slice(-14).reduce((a, b) => a + b, 0) / 14;
    const avgLoss = losses.slice(-14).reduce((a, b) => a + b, 0) / 14;
    rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }

  let macd: { value: number; signal: number; histogram: number } | null = null;
  if (closes.length >= 26) {
    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    const macdLine = ema12 - ema26;
    const signalLine = macdLine;
    macd = {
      value: macdLine,
      signal: signalLine,
      histogram: macdLine - signalLine,
    };
  }

  let vwap: number | null = null;
  if (data.closes.length >= 20) {
    const recentCloses = closes.slice(-20);
    const typicalPrices = recentCloses.map((c, i) => 
      (data.highs.slice(-20)[i] + data.lows.slice(-20)[i] + c) / 3
    );
    vwap = typicalPrices.reduce((a, b) => a + b, 0) / typicalPrices.length;
  }

  let atr: number | null = null;
  if (data.highs.length >= 15) {
    const trs: number[] = [];
    for (let i = 1; i < data.highs.length; i++) {
      const tr = Math.max(
        data.highs[i] - data.lows[i],
        Math.abs(data.highs[i] - data.closes[i - 1]),
        Math.abs(data.lows[i] - data.closes[i - 1])
      );
      trs.push(tr);
    }
    atr = trs.slice(-14).reduce((a, b) => a + b, 0) / 14;
  }

  return {
    rsi,
    macd,
    vwap,
    atr,
    volume20DayAvg: null,
    currentVolume: null,
  };
}

function calculateEMA(prices: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// ============================================
// HISTORICAL TRADE DATA ACCESS
// ============================================

export interface RealTradeRecord {
  id: string;
  symbol: string;
  direction: string;
  entryPrice: number;
  exitPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  confidenceScore: number | null;
  status: string;
  realizedPnL: number | null;
  timestamp: string;
  exitDate: string | null;
  source: string;
  // Validation and provenance flags
  isRealTrade: boolean;
  isValidated: boolean;        // Has actual exit data
  hasExitPrice: boolean;       // Exit price recorded
  hasRealizedPnL: boolean;     // P&L calculated
  tradeCompleteness: 'complete' | 'partial' | 'open';
}

/**
 * Get real historical trades from the database
 * Used by backtesting to validate strategies with actual trade data
 */
export async function getRealHistoricalTrades(params: {
  symbol?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  closedOnly?: boolean;
}): Promise<RealTradeRecord[]> {
  try {
    const conditions = [];
    
    if (params.symbol) {
      conditions.push(eq(tradeIdeas.symbol, params.symbol));
    }
    
    if (params.closedOnly) {
      conditions.push(
        sql`${tradeIdeas.status} IN ('hit_stop', 'manual_exit', 'expired')`
      );
    }

    const results = await db
      .select({
        id: tradeIdeas.id,
        symbol: tradeIdeas.symbol,
        direction: tradeIdeas.direction,
        entryPrice: tradeIdeas.entryPrice,
        exitPrice: tradeIdeas.exitPrice,
        targetPrice: tradeIdeas.targetPrice,
        stopLoss: tradeIdeas.stopLoss,
        confidenceScore: tradeIdeas.confidenceScore,
        status: tradeIdeas.status,
        realizedPnL: tradeIdeas.realizedPnL,
        timestamp: tradeIdeas.timestamp,
        exitDate: tradeIdeas.exitDate,
        source: tradeIdeas.source,
      })
      .from(tradeIdeas)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tradeIdeas.timestamp))
      .limit(params.limit || 1000);

    return results.map(r => {
      const hasExitPrice = r.exitPrice !== null;
      const hasRealizedPnL = r.realizedPnL !== null;
      const isClosed = ['hit_stop', 'manual_exit', 'expired'].includes(r.status);
      
      let tradeCompleteness: 'complete' | 'partial' | 'open' = 'open';
      if (isClosed && hasExitPrice && hasRealizedPnL) {
        tradeCompleteness = 'complete';
      } else if (isClosed || hasExitPrice) {
        tradeCompleteness = 'partial';
      }

      return {
        ...r,
        isRealTrade: true,
        isValidated: tradeCompleteness === 'complete',
        hasExitPrice,
        hasRealizedPnL,
        tradeCompleteness,
      };
    });
  } catch (error) {
    logger.error('Error fetching real historical trades:', error);
    return [];
  }
}

/**
 * Get trade statistics for a specific symbol or pattern type
 */
export async function getTradeStatistics(params: {
  symbol?: string;
  patternType?: string;
}): Promise<{
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgPnlPercent: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}> {
  const trades = await getRealHistoricalTrades({
    symbol: params.symbol,
    closedOnly: true,
  });

  if (trades.length === 0) {
    return {
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
      avgPnlPercent: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
    };
  }

  const wins = trades.filter(t => (t.realizedPnL || 0) > 0);
  const losses = trades.filter(t => (t.realizedPnL || 0) < 0);
  
  const totalPnl = trades.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);
  const avgWin = wins.length > 0 
    ? wins.reduce((sum, t) => sum + (t.realizedPnL || 0), 0) / wins.length 
    : 0;
  const avgLoss = losses.length > 0 
    ? Math.abs(losses.reduce((sum, t) => sum + (t.realizedPnL || 0), 0) / losses.length)
    : 0;

  const grossWins = wins.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);
  const grossLosses = Math.abs(losses.reduce((sum, t) => sum + (t.realizedPnL || 0), 0));

  return {
    totalTrades: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: (wins.length / trades.length) * 100,
    avgPnlPercent: totalPnl / trades.length,
    avgWin,
    avgLoss,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
  };
}

// ============================================
// UNIFIED API RESPONSE FORMATTERS
// ============================================

export interface UnifiedPatternResponse {
  patterns: UnifiedPatternResult[];
  statistics: {
    totalPatterns: number;
    imminentCount: number;
    highConvictionCount: number;
    averageScore: number;
  };
  patternTypes: Record<string, string>;
  dataSource: 'unified';
  timestamp: string;
}

export function formatUnifiedResponse(patterns: UnifiedPatternResult[]): UnifiedPatternResponse {
  const imminent = patterns.filter(p => p.score.urgency === 'imminent').length;
  const highConviction = patterns.filter(p => p.score.score >= 75).length;
  const avgScore = patterns.length > 0 
    ? patterns.reduce((sum, p) => sum + p.score.score, 0) / patterns.length 
    : 0;

  return {
    patterns,
    statistics: {
      totalPatterns: patterns.length,
      imminentCount: imminent,
      highConvictionCount: highConviction,
      averageScore: Math.round(avgScore),
    },
    patternTypes: PATTERN_DISPLAY_NAMES,
    dataSource: 'unified',
    timestamp: new Date().toISOString(),
  };
}
