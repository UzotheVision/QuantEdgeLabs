import { getTradierQuote } from "./tradier-api";
import { logger } from "./logger";
import { isUSMarketOpen } from "@shared/market-calendar";

export interface MarketContext {
  regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile';
  riskSentiment: 'risk_on' | 'risk_off' | 'neutral';
  preferredDirection: 'LONG' | 'SHORT' | 'BOTH';  // Timing-aware directional bias
  score: number;
  shouldTrade: boolean;
  reasons: string[];
  spyData: { price: number; change: number; relativeVolume: number } | null;
  vixLevel: number | null;
  timestamp: Date;
}

interface QuoteData {
  last: number;
  change_percentage: number;
  volume: number;
  average_volume: number;
  high: number;
  low: number;
  week_52_high: number;
  week_52_low: number;
}

let cachedContext: MarketContext | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getMarketContext(forceRefresh = false): Promise<MarketContext> {
  const now = Date.now();
  
  if (!forceRefresh && cachedContext && (now - lastFetchTime) < CACHE_TTL_MS) {
    return cachedContext;
  }

  try {
    const [spyQuote, qqqQuote, vixQuote] = await Promise.all([
      getTradierQuote('SPY').catch(() => null),
      getTradierQuote('QQQ').catch(() => null),
      getTradierQuote('VIX').catch(() => null),
    ]) as [QuoteData | null, QuoteData | null, QuoteData | null];

    const context = analyzeMarketConditions(spyQuote, qqqQuote, vixQuote);
    
    cachedContext = context;
    lastFetchTime = now;
    
    logger.info(`📊 [MARKET] Regime: ${context.regime}, Sentiment: ${context.riskSentiment}, Score: ${context.score}, Trade: ${context.shouldTrade}`);
    
    return context;
  } catch (error) {
    logger.error("📊 [MARKET] Failed to fetch market context:", error);
    
    const marketStatus = isUSMarketOpen();
    return {
      regime: 'ranging',
      riskSentiment: 'neutral',
      preferredDirection: 'BOTH',
      score: 50,
      shouldTrade: marketStatus.isOpen,
      reasons: marketStatus.isOpen ? ['Market data unavailable - using neutral defaults'] : [`⛔ Market closed: ${marketStatus.reason}`],
      spyData: null,
      vixLevel: null,
      timestamp: new Date(),
    };
  }
}

function analyzeMarketConditions(
  spy: QuoteData | null,
  qqq: QuoteData | null,
  vix: QuoteData | null
): MarketContext {
  const reasons: string[] = [];
  let score = 50;
  let regime: MarketContext['regime'] = 'ranging';
  let riskSentiment: MarketContext['riskSentiment'] = 'neutral';

  if (!spy) {
    const marketStatus = isUSMarketOpen();
    return {
      regime: 'ranging',
      riskSentiment: 'neutral',
      preferredDirection: 'BOTH',
      score: 50,
      shouldTrade: marketStatus.isOpen,
      reasons: marketStatus.isOpen ? ['SPY data unavailable'] : [`⛔ Market closed: ${marketStatus.reason}`],
      spyData: null,
      vixLevel: null,
      timestamp: new Date(),
    };
  }

  const spyChange = spy.change_percentage || 0;
  const qqqChange = qqq?.change_percentage || 0;
  const spyRelVol = spy.average_volume > 0 ? spy.volume / spy.average_volume : 1;
  const vixLevel = vix?.last || null;
  const spyRange = spy.high > 0 && spy.low > 0 ? ((spy.high - spy.low) / spy.low) * 100 : 0;

  if (spyChange > 0.8 && qqqChange > 0.8) {
    regime = 'trending_up';
    score += 20;
    reasons.push(`Strong uptrend: SPY +${spyChange.toFixed(1)}%, QQQ +${qqqChange.toFixed(1)}%`);
  } else if (spyChange < -0.8 && qqqChange < -0.8) {
    regime = 'trending_down';
    score += 10;
    reasons.push(`Downtrend: SPY ${spyChange.toFixed(1)}%, QQQ ${qqqChange.toFixed(1)}%`);
  } else if (Math.abs(spyChange) < 0.3 && Math.abs(qqqChange) < 0.3) {
    regime = 'ranging';
    score -= 10;
    reasons.push(`Low movement: SPY ${spyChange.toFixed(2)}%, QQQ ${qqqChange.toFixed(2)}%`);
  }

  if (spyRange > 1.5 || (vixLevel && vixLevel > 25)) {
    regime = 'volatile';
    reasons.push(`High volatility: Range ${spyRange.toFixed(1)}%${vixLevel ? `, VIX ${vixLevel.toFixed(1)}` : ''}`);
  }

  if (vixLevel) {
    if (vixLevel < 15) {
      riskSentiment = 'risk_on';
      score += 15;
      reasons.push(`Low VIX (${vixLevel.toFixed(1)}) = Risk-on environment`);
    } else if (vixLevel > 25) {
      riskSentiment = 'risk_off';
      score -= 15;
      reasons.push(`High VIX (${vixLevel.toFixed(1)}) = Risk-off/Fear`);
    } else if (vixLevel > 20) {
      score -= 5;
      reasons.push(`Elevated VIX (${vixLevel.toFixed(1)})`);
    }
  }

  if (spyRelVol > 1.5) {
    score += 10;
    reasons.push(`High SPY volume (${spyRelVol.toFixed(1)}x avg)`);
  } else if (spyRelVol < 0.7) {
    score -= 10;
    reasons.push(`Low SPY volume (${spyRelVol.toFixed(1)}x avg) - thin market`);
  }

  const correlation = (spyChange > 0 && qqqChange > 0) || (spyChange < 0 && qqqChange < 0);
  if (correlation && Math.abs(spyChange) > 0.5) {
    score += 5;
    reasons.push('SPY/QQQ correlated - clear direction');
  } else if (!correlation && Math.abs(spyChange - qqqChange) > 1) {
    score -= 10;
    reasons.push('SPY/QQQ diverging - mixed signals');
  }

  // 🛡️ PROPER TRADING GATE - Only trade in favorable conditions
  // Require: market open, score >= 30, and not extreme volatility
  const marketStatus = isUSMarketOpen();
  const shouldTrade = marketStatus.isOpen && score >= 30 && regime !== 'volatile';

  if (!marketStatus.isOpen) {
    reasons.push(`⛔ Market closed: ${marketStatus.reason}`);
  } else if (!shouldTrade) {
    reasons.push(`⛔ Skip trading: Score ${score} < 30 or volatile regime (${regime})`);
  }

  // 🎯 TIMING-AWARE DIRECTIONAL BIAS
  // Determines which direction trades are relevant RIGHT NOW based on market conditions
  let preferredDirection: MarketContext['preferredDirection'] = 'BOTH';
  
  if (regime === 'trending_up' && riskSentiment === 'risk_on') {
    // Strong bullish conditions - only show LONG plays
    preferredDirection = 'LONG';
    reasons.push('📈 Bullish bias: Showing LONG plays only');
  } else if (regime === 'trending_down' && riskSentiment === 'risk_off') {
    // Strong bearish conditions - prioritize SHORT plays
    preferredDirection = 'SHORT';
    reasons.push('📉 Bearish bias: SHORT plays prioritized');
  } else if (regime === 'trending_down' || riskSentiment === 'risk_off') {
    // Moderate bearish - show both but SHORTs are valid
    preferredDirection = 'BOTH';
    reasons.push('📉 Bearish lean: SHORT plays now relevant');
  } else if (regime === 'volatile') {
    // Volatile - both directions valid for hedging
    preferredDirection = 'BOTH';
    reasons.push('⚡ Volatile: Both directions valid');
  } else if (spyChange > 0.3) {
    // Mild bullish lean - prefer LONG
    preferredDirection = 'LONG';
    reasons.push('📈 Mild bullish: Preferring LONG plays');
  } else if (spyChange < -0.3) {
    // Mild bearish lean - prefer SHORT
    preferredDirection = 'SHORT';
    reasons.push('📉 Mild bearish: Preferring SHORT plays');
  }

  return {
    regime,
    riskSentiment,
    preferredDirection,
    score: Math.max(0, Math.min(100, score)),
    shouldTrade,
    reasons,
    spyData: {
      price: spy.last,
      change: spyChange,
      relativeVolume: spyRelVol,
    },
    vixLevel,
    timestamp: new Date(),
  };
}

export function getEntryTiming(
  quote: QuoteData,
  optionType: 'call' | 'put',
  marketContext: MarketContext
): { shouldEnterNow: boolean; reason: string } {
  // 🛡️ PROPER ENTRY TIMING - Require momentum alignment and volume
  const priceChange = quote.change_percentage || 0;
  const relVol = quote.average_volume > 0 ? quote.volume / quote.average_volume : 1;
  const isCall = optionType === 'call';
  
  const momentumAligned = isCall ? priceChange > 0 : priceChange < 0;
  
  // 🛑 GATE 1: Counter-momentum trades need strong conviction
  if (!momentumAligned && Math.abs(priceChange) > 1) {
    return { 
      shouldEnterNow: false, 
      reason: `Counter-momentum: ${priceChange.toFixed(1)}% move against ${optionType}` 
    };
  }

  // 🛑 GATE 2: Volume confirmation required
  if (relVol < 0.8) {
    return { 
      shouldEnterNow: false, 
      reason: `Low volume (${relVol.toFixed(1)}x) - wait for confirmation` 
    };
  }

  // 🛑 GATE 3: Avoid volatile regime with large moves
  if (marketContext.regime === 'volatile' && Math.abs(priceChange) > 3) {
    return { 
      shouldEnterNow: false, 
      reason: `Volatile market with ${priceChange.toFixed(1)}% move - wait for stabilization` 
    };
  }

  // ✅ ENTRY 1: Strong momentum with volume confirmation
  if (momentumAligned && Math.abs(priceChange) >= 1 && relVol >= 1.2) {
    return { 
      shouldEnterNow: true, 
      reason: `✅ Entry: ${optionType.toUpperCase()} aligned with ${priceChange.toFixed(1)}% move, ${relVol.toFixed(1)}x volume` 
    };
  }

  // ✅ ENTRY 2: Uptrend regime favors calls
  if (marketContext.regime === 'trending_up' && isCall) {
    return { 
      shouldEnterNow: true, 
      reason: `✅ Entry: Uptrend regime favors calls` 
    };
  }
  
  // ✅ ENTRY 3: Downtrend regime favors puts
  if (marketContext.regime === 'trending_down' && !isCall) {
    return { 
      shouldEnterNow: true, 
      reason: `✅ Entry: Downtrend regime favors puts` 
    };
  }

  // Default: Allow entry only with decent volume and favorable market conditions
  return { 
    shouldEnterNow: relVol >= 1.0 && marketContext.shouldTrade, 
    reason: relVol >= 1.0 && marketContext.shouldTrade 
      ? `✅ Entry: Neutral conditions with ${relVol.toFixed(1)}x volume` 
      : `⏸️ Wait: Need higher volume or better market conditions` 
  };
}

export interface DynamicExitSignal {
  shouldExit: boolean;
  exitType: 'trailing_stop' | 'time_decay' | 'momentum_fade' | 'regime_shift' | 'partial_profit' | 'none';
  reason: string;
  suggestedExitPrice?: number;
  partialExitPercent?: number; // For partial profit taking (e.g., 50% of position)
  confluenceScore?: number; // Number of signals confirming exit (higher = more confident)
  holdSignals?: string[]; // Reasons to HOLD instead of exit
  exitSignals?: string[]; // Reasons to EXIT
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🧠 MULTI-CONFLUENCE EXIT INTELLIGENCE
// Requires multiple confirmations before triggering exits to maximize gains
// ═══════════════════════════════════════════════════════════════════════════════

export interface ExitConfluenceData {
  rsi?: number;           // Current RSI value
  volumeRatio?: number;   // Current volume vs average
  priceChange5m?: number; // 5-minute price change %
  priceChange15m?: number;// 15-minute price change %
}

// Time-of-day trading session awareness
export type TradingSession = 'pre_market' | 'opening_drive' | 'mid_morning' | 'lunch_lull' | 'afternoon' | 'power_hour' | 'after_hours';

export function getTradingSession(): TradingSession {
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = etTime.getHours();
  const minute = etTime.getMinutes();
  const totalMinutes = hour * 60 + minute;
  
  if (totalMinutes < 9 * 60 + 30) return 'pre_market';
  if (totalMinutes < 10 * 60) return 'opening_drive';      // 9:30-10:00 - volatile, momentum plays
  if (totalMinutes < 11 * 60 + 30) return 'mid_morning';   // 10:00-11:30 - trend continuation
  if (totalMinutes < 14 * 60) return 'lunch_lull';         // 11:30-2:00 - low volume, chop
  if (totalMinutes < 15 * 60 + 30) return 'afternoon';     // 2:00-3:30 - resumption
  if (totalMinutes < 16 * 60) return 'power_hour';         // 3:30-4:00 - high volume, big moves
  return 'after_hours';
}

// Session-specific exit behavior (reduced weights to prevent single-factor dominance)
function getSessionExitBias(session: TradingSession): { 
  holdBias: number;  // Positive = bias towards holding, negative = bias towards exiting
  description: string;
} {
  switch (session) {
    case 'opening_drive':
      return { holdBias: 5, description: '🚀 Opening drive - momentum tends to continue' };
    case 'mid_morning':
      return { holdBias: 3, description: '📈 Mid-morning trend continuation' };
    case 'lunch_lull':
      return { holdBias: -5, description: '😴 Lunch lull - lower volume, choppier' };
    case 'afternoon':
      return { holdBias: 0, description: '⏰ Afternoon - neutral session' };
    case 'power_hour':
      return { holdBias: 8, description: '⚡ Power hour - increased volume' };
    case 'pre_market':
    case 'after_hours':
      return { holdBias: -8, description: '🌙 Extended hours - reduce risk' };
    default:
      return { holdBias: 0, description: 'Regular session' };
  }
}

// RSI-based momentum check for exits
function getRsiExitSignal(rsi: number | undefined, direction: 'long' | 'short', pnlPercent: number): {
  signal: 'hold' | 'exit' | 'neutral';
  reason: string;
  weight: number;
} {
  if (rsi === undefined) {
    return { signal: 'neutral', reason: 'RSI unavailable', weight: 0 };
  }
  
  const isLong = direction === 'long';
  
  // For LONGS with profits
  if (isLong && pnlPercent > 0) {
    if (rsi >= 70) {
      // Overbought but momentum still strong - be cautious but don't panic
      return { signal: 'neutral', reason: `RSI ${rsi.toFixed(0)} overbought - momentum may continue`, weight: 0 };
    }
    if (rsi >= 55) {
      // Strong momentum - HOLD
      return { signal: 'hold', reason: `RSI ${rsi.toFixed(0)} shows strong momentum - HOLD`, weight: 15 };
    }
    if (rsi < 45) {
      // Momentum fading - consider exit
      return { signal: 'exit', reason: `RSI ${rsi.toFixed(0)} momentum fading`, weight: 10 };
    }
  }
  
  // For SHORTS with profits
  if (!isLong && pnlPercent > 0) {
    if (rsi <= 30) {
      return { signal: 'neutral', reason: `RSI ${rsi.toFixed(0)} oversold - bounce may come`, weight: 0 };
    }
    if (rsi <= 45) {
      return { signal: 'hold', reason: `RSI ${rsi.toFixed(0)} bearish momentum - HOLD`, weight: 15 };
    }
    if (rsi > 55) {
      return { signal: 'exit', reason: `RSI ${rsi.toFixed(0)} turning bullish`, weight: 10 };
    }
  }
  
  return { signal: 'neutral', reason: `RSI ${rsi?.toFixed(0) || 'N/A'} neutral`, weight: 0 };
}

// Volume-based exit signal
function getVolumeExitSignal(volumeRatio: number | undefined, pnlPercent: number): {
  signal: 'hold' | 'exit' | 'neutral';
  reason: string;
  weight: number;
} {
  if (volumeRatio === undefined) {
    return { signal: 'neutral', reason: 'Volume data unavailable', weight: 0 };
  }
  
  // High volume = real move, more conviction to hold
  if (volumeRatio >= 2.0 && pnlPercent > 0) {
    return { signal: 'hold', reason: `📊 ${volumeRatio.toFixed(1)}x volume confirms move - HOLD`, weight: 20 };
  }
  
  if (volumeRatio >= 1.5 && pnlPercent > 0) {
    return { signal: 'hold', reason: `📊 ${volumeRatio.toFixed(1)}x volume supports trend`, weight: 10 };
  }
  
  // Low volume pullback in profit = weak selling, hold
  if (volumeRatio < 0.7 && pnlPercent > 10) {
    return { signal: 'hold', reason: `📊 Low volume pullback (${volumeRatio.toFixed(1)}x) - weak sellers`, weight: 8 };
  }
  
  // Low volume while losing = weak support, consider exit
  if (volumeRatio < 0.8 && pnlPercent < -10) {
    return { signal: 'exit', reason: `📊 Low volume decline - no buyers`, weight: 5 };
  }
  
  return { signal: 'neutral', reason: `Volume ${volumeRatio?.toFixed(1) || 'N/A'}x`, weight: 0 };
}

// Short-term momentum check (5m/15m price changes)
function getMomentumExitSignal(
  priceChange5m: number | undefined,
  priceChange15m: number | undefined,
  direction: 'long' | 'short',
  pnlPercent: number
): { signal: 'hold' | 'exit' | 'neutral'; reason: string; weight: number } {
  if (priceChange5m === undefined && priceChange15m === undefined) {
    return { signal: 'neutral', reason: 'Momentum data unavailable', weight: 0 };
  }
  
  const isLong = direction === 'long';
  const change5m = priceChange5m || 0;
  const change15m = priceChange15m || 0;
  
  // For profitable longs
  if (isLong && pnlPercent > 0) {
    // Still moving up strongly
    if (change5m > 0.5 && change15m > 1.0) {
      return { signal: 'hold', reason: `🔥 +${change5m.toFixed(1)}% 5m, +${change15m.toFixed(1)}% 15m - momentum hot`, weight: 20 };
    }
    if (change5m > 0.2) {
      return { signal: 'hold', reason: `📈 +${change5m.toFixed(1)}% 5m - still moving`, weight: 10 };
    }
    // Momentum stalling
    if (change5m < -0.3 && change15m < 0) {
      return { signal: 'exit', reason: `📉 ${change5m.toFixed(1)}% 5m - momentum reversing`, weight: 12 };
    }
  }
  
  // For profitable shorts
  if (!isLong && pnlPercent > 0) {
    if (change5m < -0.5 && change15m < -1.0) {
      return { signal: 'hold', reason: `🔥 ${change5m.toFixed(1)}% 5m - bearish momentum hot`, weight: 20 };
    }
    if (change5m < -0.2) {
      return { signal: 'hold', reason: `📉 ${change5m.toFixed(1)}% 5m - still falling`, weight: 10 };
    }
    if (change5m > 0.3 && change15m > 0) {
      return { signal: 'exit', reason: `📈 Bouncing +${change5m.toFixed(1)}% 5m`, weight: 12 };
    }
  }
  
  return { signal: 'neutral', reason: `5m: ${change5m.toFixed(1)}%, 15m: ${change15m.toFixed(1)}%`, weight: 0 };
}

// Calculate overall exit confluence score
export function calculateExitConfluence(
  pnlPercent: number,
  fromHigh: number,
  daysToExpiry: number,
  direction: 'long' | 'short',
  marketContext: MarketContext,
  confluenceData?: ExitConfluenceData
): {
  shouldExit: boolean;
  exitScore: number;     // Higher = more exit signals (0-100)
  holdScore: number;     // Higher = more hold signals (0-100)
  netScore: number;      // Positive = hold, Negative = exit
  exitSignals: string[];
  holdSignals: string[];
  recommendation: string;
  telemetrySignalCount: number; // Count of actual telemetry-based signals (RSI, volume, momentum)
} {
  const exitSignals: string[] = [];
  const holdSignals: string[] = [];
  let exitScore = 0;
  let holdScore = 0;
  let telemetryExitCount = 0; // Count telemetry-derived exit signals (not time/regime)
  
  const isCall = direction === 'long';
  const regimeBad = (isCall && marketContext.regime === 'trending_down') || 
                    (!isCall && marketContext.regime === 'trending_up');
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MANDATORY EXITS (bypass ALL scoring - these ALWAYS trigger)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Hard stop at -60% (absolute floor for options - they can recover!)
  if (pnlPercent <= -60) {
    return {
      shouldExit: true, exitScore: 100, holdScore: 0, netScore: -100,
      exitSignals: ['⛔ HARD STOP: -60% capital protection'],
      holdSignals: [],
      recommendation: 'MANDATORY EXIT: Capital protection',
      telemetrySignalCount: 0
    };
  }
  
  // Deep loser threshold: -45% (options can swing 30-40% easily and recover)
  if (pnlPercent <= -45) {
    return {
      shouldExit: true, exitScore: 80, holdScore: 0, netScore: -80,
      exitSignals: [`⛔ LOSS STOP: Down ${Math.abs(pnlPercent).toFixed(0)}%`],
      holdSignals: [],
      recommendation: 'MANDATORY EXIT: Significant loss',
      telemetrySignalCount: 0
    };
  }
  
  // Expiring today - must exit
  if (daysToExpiry <= 0) {
    return {
      shouldExit: true, exitScore: 100, holdScore: 0, netScore: -100,
      exitSignals: ['🚨 EXPIRING TODAY'],
      holdSignals: [],
      recommendation: 'MANDATORY EXIT: Option expiring',
      telemetrySignalCount: 0
    };
  }
  
  // Time decay risk: ≤1 DTE with any profit - exit to avoid overnight theta
  if (daysToExpiry <= 1 && pnlPercent > 5) {
    return {
      shouldExit: true, exitScore: 90, holdScore: 0, netScore: -90,
      exitSignals: [`⏰ ${daysToExpiry}DTE EXIT: Lock in +${pnlPercent.toFixed(0)}% before theta decay`],
      holdSignals: [],
      recommendation: 'MANDATORY EXIT: Theta decay risk',
      telemetrySignalCount: 0
    };
  }
  
  // Regime against position while in profit - take profits
  if (regimeBad && pnlPercent > 10) {
    return {
      shouldExit: true, exitScore: 80, holdScore: 0, netScore: -80,
      exitSignals: [`⚠️ REGIME EXIT: Market ${marketContext.regime} against position, take +${pnlPercent.toFixed(0)}%`],
      holdSignals: [],
      recommendation: 'MANDATORY EXIT: Regime shift',
      telemetrySignalCount: 0
    };
  }
  
  // Regime against position while losing significantly - cut losses (raised from -15% to -35%)
  if (regimeBad && pnlPercent <= -35) {
    return {
      shouldExit: true, exitScore: 75, holdScore: 0, netScore: -75,
      exitSignals: [`⚠️ REGIME STOP: Market ${marketContext.regime} + down ${Math.abs(pnlPercent).toFixed(0)}%`],
      holdSignals: [],
      recommendation: 'MANDATORY EXIT: Regime against losing position',
      telemetrySignalCount: 0
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CONFLUENCE SIGNALS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // 1. Time-of-day session bias (low weight, never dominates)
  const session = getTradingSession();
  const sessionBias = getSessionExitBias(session);
  if (sessionBias.holdBias > 0) {
    holdSignals.push(sessionBias.description);
    holdScore += sessionBias.holdBias;
  } else if (sessionBias.holdBias < 0) {
    exitSignals.push(sessionBias.description);
    exitScore += Math.abs(sessionBias.holdBias);
  }
  
  // 2. RSI momentum (TELEMETRY SIGNAL)
  if (confluenceData?.rsi !== undefined) {
    const rsiSignal = getRsiExitSignal(confluenceData.rsi, direction, pnlPercent);
    if (rsiSignal.signal === 'hold') {
      holdSignals.push(rsiSignal.reason);
      holdScore += rsiSignal.weight;
    } else if (rsiSignal.signal === 'exit') {
      exitSignals.push(rsiSignal.reason);
      exitScore += rsiSignal.weight;
      telemetryExitCount++; // Count as telemetry-based exit
    }
  }
  
  // 3. Volume confirmation (TELEMETRY SIGNAL)
  if (confluenceData?.volumeRatio !== undefined) {
    const volSignal = getVolumeExitSignal(confluenceData.volumeRatio, pnlPercent);
    if (volSignal.signal === 'hold') {
      holdSignals.push(volSignal.reason);
      holdScore += volSignal.weight;
    } else if (volSignal.signal === 'exit') {
      exitSignals.push(volSignal.reason);
      exitScore += volSignal.weight;
      telemetryExitCount++; // Count as telemetry-based exit
    }
  }
  
  // 4. Short-term momentum (TELEMETRY SIGNAL)
  const momSignal = getMomentumExitSignal(
    confluenceData?.priceChange5m, 
    confluenceData?.priceChange15m, 
    direction, 
    pnlPercent
  );
  if (momSignal.signal === 'hold') {
    holdSignals.push(momSignal.reason);
    holdScore += momSignal.weight;
  } else if (momSignal.signal === 'exit') {
    exitSignals.push(momSignal.reason);
    exitScore += momSignal.weight;
    telemetryExitCount++; // Count as telemetry-based exit
  }
  
  // 5. Market regime (STRONG signal - can trigger exit alone if severe enough)
  if (regimeBad) {
    exitSignals.push(`⚠️ Market regime (${marketContext.regime}) against position`);
    exitScore += 20; // Increased from 15 to enable regime-only exits
  } else if (marketContext.regime === 'trending_up' && isCall) {
    holdSignals.push(`✅ Market trending up - calls favored`);
    holdScore += 10;
  } else if (marketContext.regime === 'trending_down' && !isCall) {
    holdSignals.push(`✅ Market trending down - puts favored`);
    holdScore += 10;
  }
  
  // 6. P&L momentum / price action (COUNTS AS CONFIRMATION for trailing stops)
  if (pnlPercent > 30 && fromHigh > -5) {
    holdSignals.push(`💪 Strong gains (+${pnlPercent.toFixed(0)}%) near highs`);
    holdScore += 15;
  } else if (pnlPercent > 20 && fromHigh < -15) {
    exitSignals.push(`📉 Gave back gains: was higher, now +${pnlPercent.toFixed(0)}%`);
    exitScore += 12;
    telemetryExitCount++; // Price pullback counts as confirmation (it's real market data)
  } else if (pnlPercent > 10 && fromHigh < -20) {
    exitSignals.push(`📉 Significant pullback: ${fromHigh.toFixed(0)}% from peak`);
    exitScore += 10;
    telemetryExitCount++; // Large pullback is strong confirmation
  }
  
  // 7. Theta decay pressure
  if (daysToExpiry <= 1 && pnlPercent > 5) {
    exitSignals.push(`⏰ ${daysToExpiry} DTE - theta risk with +${pnlPercent.toFixed(0)}%`);
    exitScore += 20;
  } else if (daysToExpiry <= 3 && pnlPercent > 15) {
    exitSignals.push(`⏰ ${daysToExpiry} DTE approaching - consider locking gains`);
    exitScore += 10;
  }
  
  // Calculate net score
  const netScore = holdScore - exitScore;
  
  // Decision thresholds:
  // FINAL SIMPLIFIED LOGIC:
  // - Session hold bias max is +8 (power hour)
  // - Single strong exit signal (regime=20, time-decay=20) results in netScore = 8-20 = -12
  // - Therefore winner threshold must be -12 to allow single-factor exits
  // - Loser threshold is easier at -10 to protect capital quickly
  
  const isLoser = pnlPercent < 0;
  
  // Thresholds adjusted so single strong signals CAN trigger exits:
  // - Regime shift (20 points) with power hour (8 hold) = -12 net → EXIT at -12
  // - Time decay (20 points) = same math
  // - Multiple smaller signals (pullback 12 + regime 20) = -32 + bias → EXIT
  const shouldExit = isLoser 
    ? (netScore <= -10)  // Losers: exit at -10 (faster capital protection)
    : (netScore <= -12); // Winners: exit at -12 (single strong signal can trigger)
  
  let recommendation: string;
  if (netScore > 25) {
    recommendation = `🚀 STRONG HOLD: ${holdSignals.length} hold signals vs ${exitSignals.length} exit signals`;
  } else if (netScore > 10) {
    recommendation = `📊 HOLD: Confluence favors holding (+${netScore})`;
  } else if (netScore < -25) {
    recommendation = `⛔ EXIT: Strong exit confluence (${netScore})`;
  } else if (netScore < -10) {
    recommendation = `⚠️ CONSIDER EXIT: ${exitSignals.length} exit signals`;
  } else {
    recommendation = `🤔 NEUTRAL: Mixed signals, monitor closely`;
  }
  
  return {
    shouldExit,
    exitScore: Math.min(100, exitScore),
    holdScore: Math.min(100, holdScore),
    netScore,
    exitSignals,
    holdSignals,
    recommendation,
    telemetrySignalCount: telemetryExitCount
  };
}

// Trade lifecycle phases for smarter exits
type TradePhase = 'discovery' | 'expansion' | 'distribution' | 'decline';

function getTradePhase(pnlPercent: number, fromHigh: number): TradePhase {
  // Discovery: Just entered, small gains/losses
  if (pnlPercent >= -10 && pnlPercent <= 20) return 'discovery';
  // Expansion: Solid gains, still near highs
  if (pnlPercent > 20 && fromHigh > -10) return 'expansion';
  // Distribution: High gains but pulling back from peak
  if (pnlPercent > 15 && fromHigh <= -10) return 'distribution';
  // Decline: Losing or gave back most gains
  return 'decline';
}

// Adaptive trailing stop based on profit level and volatility
function getAdaptiveTrailingStop(pnlPercent: number, daysToExpiry: number, isVolatile: boolean): number {
  // Base trailing stop percentage (how much pullback from high triggers exit)
  let trailingStop: number;
  
  if (pnlPercent >= 100) {
    // 100%+ gains: Very tight stop to lock in massive gains
    trailingStop = isVolatile ? -15 : -12;
  } else if (pnlPercent >= 75) {
    // 75%+ gains: Tight stop
    trailingStop = isVolatile ? -18 : -15;
  } else if (pnlPercent >= 50) {
    // 50%+ gains: Moderate stop
    trailingStop = isVolatile ? -22 : -18;
  } else if (pnlPercent >= 30) {
    // 30%+ gains: Looser stop to let winners run
    trailingStop = isVolatile ? -28 : -25;
  } else {
    // Under 30%: Wide stop, still in discovery phase
    trailingStop = isVolatile ? -35 : -30;
  }
  
  // Tighten stops as expiry approaches (theta risk)
  if (daysToExpiry <= 1) {
    trailingStop = trailingStop * 0.6; // 40% tighter
  } else if (daysToExpiry <= 3) {
    trailingStop = trailingStop * 0.8; // 20% tighter
  }
  
  return trailingStop;
}

// Get profit milestone for partial exits
function shouldTakePartialProfit(pnlPercent: number, fromHigh: number, daysToExpiry: number): { take: boolean; percent: number; reason: string } | null {
  // Take 50% off at 100%+ gains if pulling back
  if (pnlPercent >= 100 && fromHigh <= -8) {
    return { take: true, percent: 50, reason: `💰 PARTIAL: +${pnlPercent.toFixed(0)}% gains, take 50% off to lock in profits` };
  }
  
  // Take 30% off at 75%+ gains with 2 DTE or less
  if (pnlPercent >= 75 && daysToExpiry <= 2) {
    return { take: true, percent: 30, reason: `⏰ PARTIAL: +${pnlPercent.toFixed(0)}% with ${daysToExpiry} DTE, take 30% off` };
  }
  
  // Take 25% off at 50%+ gains if momentum fading
  if (pnlPercent >= 50 && fromHigh <= -12) {
    return { take: true, percent: 25, reason: `📉 PARTIAL: Momentum fading from peak, take 25% off` };
  }
  
  return null;
}

export function checkDynamicExit(
  currentPrice: number,
  entryPrice: number,
  highestPrice: number,
  daysToExpiry: number,
  optionType: 'call' | 'put',
  marketContext: MarketContext
): DynamicExitSignal {
  const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  const fromHigh = highestPrice > 0 ? ((currentPrice - highestPrice) / highestPrice) * 100 : 0;
  const peakGain = highestPrice > 0 ? ((highestPrice - entryPrice) / entryPrice) * 100 : 0;
  
  const isCall = optionType === 'call';
  const regimeBad = (isCall && marketContext.regime === 'trending_down') || 
                    (!isCall && marketContext.regime === 'trending_up');
  const isVolatile = marketContext.regime === 'volatile';
  const phase = getTradePhase(pnlPercent, fromHigh);

  // ═══════════════════════════════════════════════════════════════════════════
  // 🛑 STOP LOSS RULES (protect capital)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Hard stop: -40% (absolute floor)
  if (pnlPercent <= -40) {
    return {
      shouldExit: true,
      exitType: 'trailing_stop',
      reason: `⛔ HARD STOP: Down ${Math.abs(pnlPercent).toFixed(0)}% - cutting loss`,
      suggestedExitPrice: currentPrice,
    };
  }

  // Time-based stop: Exit losers before expiry accelerates losses
  if (pnlPercent <= -20 && daysToExpiry <= 2) {
    return {
      shouldExit: true,
      exitType: 'time_decay',
      reason: `⛔ TIME STOP: Down ${Math.abs(pnlPercent).toFixed(0)}% with ${daysToExpiry} DTE - theta risk`,
      suggestedExitPrice: currentPrice,
    };
  }

  // Regime stop: Market turned against us while losing
  if (regimeBad && pnlPercent <= -15) {
    return {
      shouldExit: true,
      exitType: 'regime_shift',
      reason: `⛔ REGIME STOP: ${marketContext.regime} + down ${Math.abs(pnlPercent).toFixed(0)}%`,
      suggestedExitPrice: currentPrice,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 💰 PROFIT PROTECTION RULES (maximize gains)
  // ═══════════════════════════════════════════════════════════════════════════

  // Check for partial profit opportunity - for now, treat as full exit recommendation
  // Future: implement position scaling to only exit partialExitPercent of position
  const partialProfit = shouldTakePartialProfit(pnlPercent, fromHigh, daysToExpiry);
  if (partialProfit) {
    return {
      shouldExit: true,
      exitType: 'trailing_stop', // Use existing exit type until execution layer supports partial
      reason: `${partialProfit.reason} (recommend ${partialProfit.percent}% exit)`,
      suggestedExitPrice: currentPrice,
      partialExitPercent: partialProfit.percent, // Future: use for scaling
    };
  }

  // ADAPTIVE TRAILING STOP: Tighter as gains increase, tighter near expiry
  const trailingThreshold = getAdaptiveTrailingStop(pnlPercent, daysToExpiry, isVolatile);
  
  if (pnlPercent > 25 && fromHigh < trailingThreshold) {
    return {
      shouldExit: true,
      exitType: 'trailing_stop',
      reason: `🎯 TRAILING STOP: Was +${peakGain.toFixed(0)}%, now +${pnlPercent.toFixed(0)}% (${fromHigh.toFixed(0)}% pullback, threshold ${trailingThreshold.toFixed(0)}%)`,
      suggestedExitPrice: currentPrice,
    };
  }

  // 0DTE/1DTE: Take any meaningful profit to avoid overnight/expiry risk
  if (daysToExpiry <= 1 && pnlPercent > 10) {
    return {
      shouldExit: true,
      exitType: 'time_decay',
      reason: `⏰ ${daysToExpiry}DTE EXIT: Lock in +${pnlPercent.toFixed(0)}% before theta decay`,
      suggestedExitPrice: currentPrice,
    };
  }

  // Expiring today with any gains - exit immediately
  if (daysToExpiry <= 0 && pnlPercent > 0) {
    return {
      shouldExit: true,
      exitType: 'time_decay',
      reason: `🚨 0DTE: Expiring today, taking +${pnlPercent.toFixed(0)}%`,
      suggestedExitPrice: currentPrice,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 📉 MOMENTUM FADE DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  // Distribution phase with regime shift - take profits
  if (phase === 'distribution' && regimeBad && pnlPercent > 15) {
    return {
      shouldExit: true,
      exitType: 'momentum_fade',
      reason: `📉 DISTRIBUTION + REGIME: Market turned ${marketContext.regime}, take +${pnlPercent.toFixed(0)}%`,
      suggestedExitPrice: currentPrice,
    };
  }

  // Gave back 50%+ of peak gains - momentum clearly fading
  if (peakGain >= 40 && pnlPercent < peakGain * 0.5 && pnlPercent > 15) {
    return {
      shouldExit: true,
      exitType: 'momentum_fade',
      reason: `📉 MOMENTUM FADE: Peaked at +${peakGain.toFixed(0)}%, now only +${pnlPercent.toFixed(0)}%`,
      suggestedExitPrice: currentPrice,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ✅ HOLD - LET WINNERS RUN
  // ═══════════════════════════════════════════════════════════════════════════

  // Still in expansion phase with momentum - let it ride
  if (phase === 'expansion' && !regimeBad) {
    return {
      shouldExit: false,
      exitType: 'none',
      reason: `🚀 EXPANSION: +${pnlPercent.toFixed(0)}%, ${Math.abs(fromHigh).toFixed(0)}% off high - let it run`,
    };
  }

  return {
    shouldExit: false,
    exitType: 'none',
    reason: `📊 HOLD: Phase=${phase}, PnL=+${pnlPercent.toFixed(0)}%, ${daysToExpiry} DTE`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🧠 ENHANCED EXIT WITH MULTI-CONFLUENCE
// Combines rule-based exits with confluence scoring for smarter decisions
// ═══════════════════════════════════════════════════════════════════════════════

export function checkDynamicExitEnhanced(
  currentPrice: number,
  entryPrice: number,
  highestPrice: number,
  daysToExpiry: number,
  optionType: 'call' | 'put',
  marketContext: MarketContext,
  confluenceData?: ExitConfluenceData
): DynamicExitSignal {
  const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  const fromHigh = highestPrice > 0 ? ((currentPrice - highestPrice) / highestPrice) * 100 : 0;
  const direction = optionType === 'call' ? 'long' : 'short';
  
  // Pre-compute regime check for mandatory exits
  const isCall = optionType === 'call';
  const regimeBad = (isCall && marketContext.regime === 'trending_down') || 
                    (!isCall && marketContext.regime === 'trending_up');
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Check mandatory exit conditions (bypass confluence)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Hard stop: -40% (no confluence needed - capital protection)
  if (pnlPercent <= -40) {
    return {
      shouldExit: true,
      exitType: 'trailing_stop',
      reason: `⛔ HARD STOP: Down ${Math.abs(pnlPercent).toFixed(0)}% - protecting capital`,
      suggestedExitPrice: currentPrice,
      confluenceScore: 100,
      exitSignals: ['Capital protection hard stop'],
      holdSignals: [],
    };
  }
  
  // Time-based stop for losers: Exit before expiry accelerates losses
  if (pnlPercent <= -20 && daysToExpiry <= 2) {
    return {
      shouldExit: true,
      exitType: 'time_decay',
      reason: `⛔ TIME STOP: Down ${Math.abs(pnlPercent).toFixed(0)}% with ${daysToExpiry} DTE - theta risk`,
      suggestedExitPrice: currentPrice,
      confluenceScore: 80,
      exitSignals: ['Losing position with theta decay'],
      holdSignals: [],
    };
  }
  
  // Expiring today - must exit
  if (daysToExpiry <= 0) {
    return {
      shouldExit: true,
      exitType: 'time_decay',
      reason: `🚨 EXPIRING TODAY: Must exit, P&L: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(0)}%`,
      suggestedExitPrice: currentPrice,
      confluenceScore: 100,
      exitSignals: ['Option expiring'],
      holdSignals: [],
    };
  }
  
  // 1DTE with meaningful profit - take it before overnight theta
  if (daysToExpiry === 1 && pnlPercent > 10) {
    return {
      shouldExit: true,
      exitType: 'time_decay',
      reason: `⏰ 1DTE EXIT: Lock in +${pnlPercent.toFixed(0)}% before theta decay`,
      suggestedExitPrice: currentPrice,
      confluenceScore: 85,
      exitSignals: ['1 DTE with meaningful profit'],
      holdSignals: [],
    };
  }
  
  // Regime against position while profitable - take profits
  if (regimeBad && pnlPercent > 10) {
    return {
      shouldExit: true,
      exitType: 'regime_shift',
      reason: `⚠️ REGIME EXIT: Market ${marketContext.regime} against position, take +${pnlPercent.toFixed(0)}%`,
      suggestedExitPrice: currentPrice,
      confluenceScore: 80,
      exitSignals: ['Regime shift with profit'],
      holdSignals: [],
    };
  }
  
  // Regime against position while losing moderately - cut losses
  if (regimeBad && pnlPercent <= -15) {
    return {
      shouldExit: true,
      exitType: 'regime_shift',
      reason: `⚠️ REGIME STOP: Market ${marketContext.regime} + down ${Math.abs(pnlPercent).toFixed(0)}%`,
      suggestedExitPrice: currentPrice,
      confluenceScore: 75,
      exitSignals: ['Regime shift with loss'],
      holdSignals: [],
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Calculate confluence score (only if no mandatory exit triggered)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const confluence = calculateExitConfluence(
    pnlPercent,
    fromHigh,
    daysToExpiry,
    direction,
    marketContext,
    confluenceData
  );
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Apply confluence-based decision
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Strong hold signals override weaker exit signals
  if (confluence.netScore > 10 && pnlPercent > 0) {
    return {
      shouldExit: false,
      exitType: 'none',
      reason: `🚀 CONFLUENCE HOLD: ${confluence.recommendation} (net: +${confluence.netScore})`,
      confluenceScore: confluence.holdScore,
      holdSignals: confluence.holdSignals,
      exitSignals: confluence.exitSignals,
    };
  }
  
  // Strong exit signals (requires MULTIPLE confirmations - at least 2 signals and net score <= -30)
  // Previously -20 was too sensitive, causing premature exits on single signals
  if ((confluence.shouldExit && confluence.exitSignals.length >= 2) || confluence.netScore <= -30) {
    let exitType: DynamicExitSignal['exitType'] = 'momentum_fade';
    
    // Categorize exit type based on signals
    if (confluence.exitSignals.some(s => s.includes('DTE') || s.includes('theta'))) {
      exitType = 'time_decay';
    } else if (confluence.exitSignals.some(s => s.includes('regime'))) {
      exitType = 'regime_shift';
    }
    
    return {
      shouldExit: true,
      exitType,
      reason: `⛔ CONFLUENCE EXIT: ${confluence.recommendation} (net: ${confluence.netScore}, ${confluence.exitSignals.length} signals)`,
      suggestedExitPrice: currentPrice,
      confluenceScore: confluence.exitScore,
      holdSignals: confluence.holdSignals,
      exitSignals: confluence.exitSignals,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Additional rules (only for positions not caught by mandatory/confluence)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const peakGain = highestPrice > 0 ? ((highestPrice - entryPrice) / entryPrice) * 100 : 0;
  
  // Distribution phase: Take profits if gave back significant gains
  if (peakGain >= 40 && pnlPercent < peakGain * 0.5 && pnlPercent > 15) {
    return {
      shouldExit: true,
      exitType: 'momentum_fade',
      reason: `📉 MOMENTUM FADE: Peaked at +${peakGain.toFixed(0)}%, now +${pnlPercent.toFixed(0)}%`,
      suggestedExitPrice: currentPrice,
      confluenceScore: confluence.exitScore,
      holdSignals: confluence.holdSignals,
      exitSignals: [...confluence.exitSignals, 'Gave back 50%+ of peak gains'],
    };
  }
  
  // Default: HOLD with confluence data
  return {
    shouldExit: false,
    exitType: 'none',
    reason: `📊 HOLD: Net score ${confluence.netScore >= 0 ? '+' : ''}${confluence.netScore}, ${confluence.holdSignals.length} hold / ${confluence.exitSignals.length} exit signals`,
    confluenceScore: confluence.holdScore,
    holdSignals: confluence.holdSignals,
    exitSignals: confluence.exitSignals,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎯 WIN RATE IMPROVEMENT: SESSION-BASED ENTRY GATING
// Prevents entries during unfavorable trading sessions
// ═══════════════════════════════════════════════════════════════════════════════

export interface SessionEntryResult {
  allowed: boolean;
  session: TradingSession;
  reason: string;
  confidenceMultiplier: number; // 1.0 = normal, <1 = reduce confidence, >1 = boost
}

export type StrategyType = 'lotto' | 'daytrade' | 'swing' | 'mean_reversion' | 'momentum';

// Strategy-specific session preferences
const STRATEGY_SESSION_RULES: Record<StrategyType, {
  allowedSessions: TradingSession[];
  preferredSessions: TradingSession[];
  blockedSessions: TradingSession[];
}> = {
  lotto: {
    // PAPER TRADING: Allow all sessions to collect data - apply confidence penalty instead
    allowedSessions: ['opening_drive', 'mid_morning', 'lunch_lull', 'afternoon', 'power_hour'],
    preferredSessions: ['opening_drive', 'power_hour'],
    blockedSessions: [], // Removed lunch_lull block for paper trading data collection
  },
  daytrade: {
    allowedSessions: ['opening_drive', 'mid_morning', 'afternoon', 'power_hour'],
    preferredSessions: ['opening_drive', 'mid_morning'],
    blockedSessions: ['lunch_lull', 'after_hours'],
  },
  swing: {
    allowedSessions: ['opening_drive', 'mid_morning', 'lunch_lull', 'afternoon', 'power_hour'],
    preferredSessions: ['mid_morning', 'afternoon'],
    blockedSessions: [], // Swings are less session-sensitive
  },
  mean_reversion: {
    allowedSessions: ['opening_drive', 'mid_morning', 'afternoon', 'power_hour'],
    preferredSessions: ['opening_drive'], // Best for catching extremes
    blockedSessions: ['lunch_lull'], // Chop kills mean reversion
  },
  momentum: {
    allowedSessions: ['opening_drive', 'mid_morning', 'power_hour'],
    preferredSessions: ['opening_drive', 'power_hour'],
    blockedSessions: ['lunch_lull', 'after_hours'],
  },
};

export function shouldAllowSessionEntry(
  strategy: StrategyType,
  overrideAllow: boolean = false
): SessionEntryResult {
  const session = getTradingSession();
  const rules = STRATEGY_SESSION_RULES[strategy];
  
  // Handle unknown strategy types gracefully
  if (!rules) {
    console.warn(`[ENTRY GATE] Unknown strategy type: ${strategy}, defaulting to allowed`);
    return {
      allowed: true,
      session,
      reason: `Unknown strategy ${strategy}, allowing entry`,
      confidenceMultiplier: 1.0,
    };
  }
  
  // Override allows entry in any session (for high-conviction plays)
  if (overrideAllow) {
    return {
      allowed: true,
      session,
      reason: `Override: Entry allowed in ${session} session`,
      confidenceMultiplier: session === 'lunch_lull' ? 0.8 : 1.0,
    };
  }
  
  // Check blocked sessions first
  if (rules.blockedSessions.includes(session)) {
    return {
      allowed: false,
      session,
      reason: `⛔ ${strategy.toUpperCase()} blocked in ${session} - low win rate expected`,
      confidenceMultiplier: 0,
    };
  }
  
  // Check if session is allowed
  if (!rules.allowedSessions.includes(session)) {
    return {
      allowed: false,
      session,
      reason: `⛔ ${strategy.toUpperCase()} not allowed in ${session}`,
      confidenceMultiplier: 0,
    };
  }
  
  // Preferred sessions get confidence boost
  if (rules.preferredSessions.includes(session)) {
    return {
      allowed: true,
      session,
      reason: `✅ ${session} is preferred for ${strategy} - boosted confidence`,
      confidenceMultiplier: 1.15,
    };
  }
  
  // Regular allowed session
  return {
    allowed: true,
    session,
    reason: `✅ ${session} is acceptable for ${strategy}`,
    confidenceMultiplier: 1.0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📊 WIN RATE IMPROVEMENT: ATR-NORMALIZED RISK BANDS
// Replaces fixed-point stops with volatility-adjusted levels
// ═══════════════════════════════════════════════════════════════════════════════

export interface AtrRiskBands {
  atr: number;
  stopDistance: number;
  targetDistance: number;
  stopPrice: number;
  targetPrice: number;
  riskRewardRatio: number;
  positionSizeForRisk: number; // How many shares/contracts for given $ risk
}

// ATR multipliers by strategy (tuned for win rate)
const STRATEGY_ATR_MULTIPLIERS: Record<StrategyType, { stop: number; target: number }> = {
  lotto: { stop: 1.2, target: 2.4 }, // Tighter stops, 2:1 target
  daytrade: { stop: 0.7, target: 1.4 }, // Very tight for intraday
  swing: { stop: 2.0, target: 4.0 }, // Wider for multi-day holds
  mean_reversion: { stop: 1.0, target: 2.0 }, // Standard for reversals
  momentum: { stop: 1.5, target: 3.0 }, // Let winners run
};

export function calculateAtrRiskBands(
  entryPrice: number,
  atr: number,
  direction: 'long' | 'short',
  strategy: StrategyType,
  maxRiskDollars: number = 50
): AtrRiskBands {
  const multipliers = STRATEGY_ATR_MULTIPLIERS[strategy];
  
  const stopDistance = atr * multipliers.stop;
  const targetDistance = atr * multipliers.target;
  
  let stopPrice: number;
  let targetPrice: number;
  
  if (direction === 'long') {
    stopPrice = entryPrice - stopDistance;
    targetPrice = entryPrice + targetDistance;
  } else {
    stopPrice = entryPrice + stopDistance;
    targetPrice = entryPrice - targetDistance;
  }
  
  const riskRewardRatio = targetDistance / stopDistance;
  const positionSizeForRisk = Math.floor(maxRiskDollars / stopDistance);
  
  return {
    atr,
    stopDistance,
    targetDistance,
    stopPrice: Number(stopPrice.toFixed(2)),
    targetPrice: Number(targetPrice.toFixed(2)),
    riskRewardRatio: Number(riskRewardRatio.toFixed(2)),
    positionSizeForRisk: Math.max(1, positionSizeForRisk),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🚫 WIN RATE IMPROVEMENT: EXIT INTELLIGENCE ENTRY VETO
// Blocks entries on exhausted moves by simulating exit intelligence
// ═══════════════════════════════════════════════════════════════════════════════

export interface EntryVetoResult {
  blocked: boolean;
  reason: string;
  exhaustionScore: number; // 0-100, higher = more exhausted
  signals: string[];
}

export async function shouldBlockEntry(
  symbol: string,
  direction: 'long' | 'short',
  entryPrice: number,
  targetPrice: number,
  marketContext: MarketContext
): Promise<EntryVetoResult> {
  const signals: string[] = [];
  let exhaustionScore = 0;
  
  // Check 1: Counter-trend entries in strong trends
  if (marketContext.regime === 'trending_up' && direction === 'short') {
    exhaustionScore += 30;
    signals.push('Counter-trend SHORT in uptrend');
  }
  if (marketContext.regime === 'trending_down' && direction === 'long') {
    exhaustionScore += 30;
    signals.push('Counter-trend LONG in downtrend');
  }
  
  // Check 2: Volatile regime = higher exhaustion risk
  if (marketContext.regime === 'volatile') {
    exhaustionScore += 20;
    signals.push('Volatile market regime');
  }
  
  // Check 3: Low volume = thin market, harder to exit
  if (marketContext.spyData && marketContext.spyData.relativeVolume < 0.8) {
    exhaustionScore += 15;
    signals.push(`Low market volume (${marketContext.spyData.relativeVolume.toFixed(1)}x)`);
  }
  
  // Check 4: High VIX = elevated fear, mean reversion likely
  if (marketContext.vixLevel && marketContext.vixLevel > 25) {
    if (direction === 'long') {
      exhaustionScore += 15;
      signals.push(`High VIX (${marketContext.vixLevel.toFixed(1)}) - fear elevated`);
    }
  }
  
  // Check 5: Extended move already in progress
  if (marketContext.spyData) {
    const spyMove = Math.abs(marketContext.spyData.change);
    if (spyMove > 1.5) {
      exhaustionScore += 20;
      signals.push(`Large SPY move (${marketContext.spyData.change.toFixed(1)}%) - may be extended`);
    }
  }
  
  // Check 6: Session-based exhaustion
  const session = getTradingSession();
  if (session === 'lunch_lull') {
    exhaustionScore += 15;
    signals.push('Lunch lull session - moves often stall');
  }
  if (session === 'power_hour') {
    // Power hour can be good but also exhausting for existing trends
    exhaustionScore += 5;
    signals.push('Power hour - late entry risk');
  }
  
  // Decision: Block if exhaustion score is too high
  const blocked = exhaustionScore >= 50;
  
  return {
    blocked,
    reason: blocked 
      ? `⛔ ENTRY BLOCKED: Exhaustion score ${exhaustionScore}/100 - ${signals.slice(0, 2).join(', ')}`
      : `✅ Entry allowed: Exhaustion score ${exhaustionScore}/100`,
    exhaustionScore,
    signals,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎯 UNIFIED ENTRY GATE: Combines all win-rate checks
// ═══════════════════════════════════════════════════════════════════════════════

export interface UnifiedEntryGate {
  allowed: boolean;
  reasons: string[];
  adjustedConfidence: number; // Original confidence * multipliers
  sessionResult: SessionEntryResult;
  vetoResult: EntryVetoResult;
  marketContext: MarketContext;
}

export async function checkUnifiedEntryGate(
  symbol: string,
  direction: 'long' | 'short',
  entryPrice: number,
  targetPrice: number,
  originalConfidence: number,
  strategy: StrategyType,
  overrideSession: boolean = false
): Promise<UnifiedEntryGate> {
  const reasons: string[] = [];
  let confidenceMultiplier = 1.0;
  
  // Get market context
  const marketContext = await getMarketContext();
  
  // Check 1: Market conditions
  if (!marketContext.shouldTrade) {
    return {
      allowed: false,
      reasons: ['Market conditions unfavorable', ...marketContext.reasons],
      adjustedConfidence: 0,
      sessionResult: shouldAllowSessionEntry(strategy, overrideSession),
      vetoResult: { blocked: true, reason: 'Market gate failed', exhaustionScore: 100, signals: marketContext.reasons },
      marketContext,
    };
  }
  reasons.push(`Market: ${marketContext.regime}, score ${marketContext.score}`);
  
  // Check 2: Session gating
  const sessionResult = shouldAllowSessionEntry(strategy, overrideSession);
  if (!sessionResult.allowed) {
    return {
      allowed: false,
      reasons: [sessionResult.reason],
      adjustedConfidence: 0,
      sessionResult,
      vetoResult: { blocked: true, reason: sessionResult.reason, exhaustionScore: 100, signals: [sessionResult.reason] },
      marketContext,
    };
  }
  confidenceMultiplier *= sessionResult.confidenceMultiplier;
  reasons.push(sessionResult.reason);
  
  // Check 3: Exit intelligence veto
  const vetoResult = await shouldBlockEntry(symbol, direction, entryPrice, targetPrice, marketContext);
  if (vetoResult.blocked) {
    return {
      allowed: false,
      reasons: [vetoResult.reason, ...vetoResult.signals],
      adjustedConfidence: 0,
      sessionResult,
      vetoResult,
      marketContext,
    };
  }
  
  // Apply exhaustion-based confidence reduction
  if (vetoResult.exhaustionScore > 30) {
    const reduction = (vetoResult.exhaustionScore - 30) / 100; // 0-0.2 reduction
    confidenceMultiplier *= (1 - reduction);
    reasons.push(`Exhaustion adj: -${(reduction * 100).toFixed(0)}%`);
  }
  
  const adjustedConfidence = Math.round(originalConfidence * confidenceMultiplier);
  reasons.push(`Confidence: ${originalConfidence}% → ${adjustedConfidence}%`);
  
  return {
    allowed: true,
    reasons,
    adjustedConfidence,
    sessionResult,
    vetoResult,
    marketContext,
  };
}
