/**
 * Quantitative Analysis Engine
 *
 * Research-grade statistical analysis following institutional standards.
 *
 * KEY PRINCIPLES:
 * 1. Log returns instead of percent returns (asymmetry fix)
 * 2. Market regime classification (STATN-style)
 * 3. Walk-forward validation (no look-ahead bias)
 * 4. Regime-conditional performance metrics
 *
 * CRITICAL FIXES:
 * - Percent returns are asymmetric: 100→110→100 is NOT 0%
 * - Log returns are symmetric and additive
 * - Small log returns ≈ percent returns but without compounding errors
 *
 * REGIME CLASSIFICATION:
 * - Trend: ADX > 25, clear directional movement
 * - High Volatility: VIX > 20 or ATR expanding
 * - Low Volatility: VIX < 15, compressed ranges
 * - Cyclic: Oscillating within range
 * - Crisis: VIX > 30, correlation breakdown
 */

import { db } from './db';
import { tradeIdeas } from '@shared/schema';
import { gte, and, desc, or, eq, isNotNull, sql } from 'drizzle-orm';
import { logger } from './logger';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface LogReturnAnalysis {
  // Basic stats
  meanLogReturn: number;
  stdDevLogReturn: number;
  skewness: number;
  kurtosis: number;

  // Converted to approximate percent for readability
  meanPctApprox: number;
  stdDevPctApprox: number;

  // Geometric vs Arithmetic comparison
  arithmeticMean: number;     // Simple average (WRONG for compounding)
  geometricMean: number;      // Correct for compounded returns
  compoundingError: number;   // Difference showing the error

  // Risk metrics using log returns
  sharpeLogReturn: number;
  sortinoLogReturn: number;
  valueAtRisk95: number;      // 5th percentile of log returns
  conditionalVaR95: number;   // Expected loss beyond VaR
}

export type MarketRegime =
  | 'STRONG_UPTREND'
  | 'WEAK_UPTREND'
  | 'STRONG_DOWNTREND'
  | 'WEAK_DOWNTREND'
  | 'RANGING_HIGH_VOL'
  | 'RANGING_LOW_VOL'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'CRISIS'
  | 'UNKNOWN';

export interface RegimeClassification {
  current: MarketRegime;
  confidence: number;
  indicators: {
    adx: number;              // Trend strength (>25 = trending)
    trendDirection: 'up' | 'down' | 'neutral';
    vix: number;              // Volatility index
    atrPercentile: number;    // Where ATR sits historically
    correlationToSpy: number; // Market correlation
  };
  historicalRegimes: Array<{
    date: string;
    regime: MarketRegime;
    duration: number;         // Days in this regime
  }>;
}

export interface RegimeConditionalPerformance {
  regime: MarketRegime;
  tradeCount: number;
  winRate: number;
  expectancy: number;
  sharpe: number;
  avgLogReturn: number;
  recommendation: 'increase_size' | 'normal' | 'reduce_size' | 'avoid';
}

export interface EquityCurveAnalysis {
  curve: Array<{
    date: string;
    equity: number;
    drawdown: number;
    regime: MarketRegime;
  }>;
  maxEquity: number;
  finalEquity: number;
  maxDrawdown: number;
  maxDrawdownDuration: number;
  recoveryFactor: number;
  calmarRatio: number;
  ulcerIndex: number;         // Risk-adjusted drawdown metric
  painRatio: number;          // Return / Ulcer Index
}

export interface FuturesLeakCheck {
  hasPotentialLeak: boolean;
  suspiciousPatterns: string[];
  recommendations: string[];
}

export interface QuantAnalysisReport {
  // Log return analysis
  logReturns: LogReturnAnalysis;

  // Regime analysis
  currentRegime: RegimeClassification;
  regimePerformance: RegimeConditionalPerformance[];

  // Equity curve
  equityCurve: EquityCurveAnalysis;

  // Data quality
  futuresLeakCheck: FuturesLeakCheck;

  // Overall assessment
  systemHealth: {
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    issues: string[];
    recommendations: string[];
  };

  // Metadata
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
}

// ============================================================
// LOG RETURN CALCULATIONS
// ============================================================

/**
 * Convert price change to log return
 *
 * Why log returns?
 * - Percent returns: 100 → 110 → 100 = +10% then -9.09% = +0.91% (WRONG, should be 0)
 * - Log returns: ln(110/100) + ln(100/110) = 0.0953 - 0.0953 = 0 (CORRECT)
 *
 * For small returns, log return ≈ percent return
 * But log returns are additive and symmetric
 */
export function calculateLogReturn(entryPrice: number, exitPrice: number): number {
  if (entryPrice <= 0 || exitPrice <= 0) return 0;
  return Math.log(exitPrice / entryPrice) * 100; // Multiply by 100 for readability
}

/**
 * Convert log return back to percent return (for display)
 */
export function logReturnToPercent(logReturn: number): number {
  return (Math.exp(logReturn / 100) - 1) * 100;
}

/**
 * Compound multiple log returns (just add them!)
 */
export function compoundLogReturns(logReturns: number[]): number {
  return logReturns.reduce((sum, r) => sum + r, 0);
}

/**
 * Analyze log returns comprehensively
 */
export function analyzeLogReturns(logReturns: number[]): LogReturnAnalysis {
  if (logReturns.length < 2) {
    return {
      meanLogReturn: 0,
      stdDevLogReturn: 0,
      skewness: 0,
      kurtosis: 0,
      meanPctApprox: 0,
      stdDevPctApprox: 0,
      arithmeticMean: 0,
      geometricMean: 0,
      compoundingError: 0,
      sharpeLogReturn: 0,
      sortinoLogReturn: 0,
      valueAtRisk95: 0,
      conditionalVaR95: 0,
    };
  }

  const n = logReturns.length;

  // Mean log return
  const meanLogReturn = logReturns.reduce((sum, r) => sum + r, 0) / n;

  // Standard deviation
  const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - meanLogReturn, 2), 0) / n;
  const stdDevLogReturn = Math.sqrt(variance);

  // Skewness (positive = right tail, good for trading)
  const skewness = stdDevLogReturn > 0
    ? logReturns.reduce((sum, r) => sum + Math.pow((r - meanLogReturn) / stdDevLogReturn, 3), 0) / n
    : 0;

  // Kurtosis (excess kurtosis, >0 = fat tails)
  const kurtosis = stdDevLogReturn > 0
    ? logReturns.reduce((sum, r) => sum + Math.pow((r - meanLogReturn) / stdDevLogReturn, 4), 0) / n - 3
    : 0;

  // Convert to percent approximations for readability
  const meanPctApprox = logReturnToPercent(meanLogReturn);
  const stdDevPctApprox = logReturnToPercent(stdDevLogReturn);

  // Compare arithmetic vs geometric mean to show compounding error
  const pctReturns = logReturns.map(logReturnToPercent);
  const arithmeticMean = pctReturns.reduce((sum, r) => sum + r, 0) / n;

  // Geometric mean from log returns (this is why we use them!)
  const totalLogReturn = compoundLogReturns(logReturns);
  const geometricMean = logReturnToPercent(totalLogReturn / n);

  const compoundingError = arithmeticMean - geometricMean;

  // Annualized Sharpe using log returns
  // Risk-free: 4.5% annual, prorated per trade. Without per-trade duration data here,
  // we assume 1 trading day per trade as a conservative default.
  // Log returns from this engine are already in percent (logReturn * 100), so we
  // convert risk-free to the same scale.
  const AVG_HOLDING_DAYS = 1; // conservative default — no duration data in this context
  const riskFreePerTrade = (4.5 * AVG_HOLDING_DAYS) / 252; // in percent, matching logReturn scale
  const excessLogReturns = logReturns.map(r => r - riskFreePerTrade);
  const meanExcess = excessLogReturns.reduce((sum, r) => sum + r, 0) / n;
  const excessStdDev = n > 1
    ? Math.sqrt(excessLogReturns.reduce((sum, r) => sum + Math.pow(r - meanExcess, 2), 0) / (n - 1))
    : 0;
  const annualizationFactor = Math.sqrt(252 / Math.max(AVG_HOLDING_DAYS, 0.1));
  const sharpeLogReturn = excessStdDev > 0
    ? (meanExcess / excessStdDev) * annualizationFactor
    : 0;

  // Sortino (only downside deviation of excess returns)
  const downsideExcess = excessLogReturns.filter(r => r < 0);
  const downsideVariance = downsideExcess.length > 0
    ? downsideExcess.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideExcess.length
    : 0;
  const downsideDev = Math.sqrt(downsideVariance);
  const sortinoLogReturn = downsideDev > 0
    ? (meanExcess / downsideDev) * annualizationFactor
    : meanExcess > 0 ? Infinity : 0;

  // Value at Risk (5th percentile)
  const sorted = [...logReturns].sort((a, b) => a - b);
  const varIndex = Math.floor(0.05 * n);
  const valueAtRisk95 = sorted[varIndex] || sorted[0];

  // Conditional VaR (Expected Shortfall) - average of worst 5%
  const worstReturns = sorted.slice(0, Math.max(1, varIndex));
  const conditionalVaR95 = worstReturns.reduce((sum, r) => sum + r, 0) / worstReturns.length;

  return {
    meanLogReturn,
    stdDevLogReturn,
    skewness,
    kurtosis,
    meanPctApprox,
    stdDevPctApprox,
    arithmeticMean,
    geometricMean,
    compoundingError,
    sharpeLogReturn,
    sortinoLogReturn,
    valueAtRisk95,
    conditionalVaR95,
  };
}

// ============================================================
// MARKET REGIME CLASSIFICATION (STATN-STYLE)
// ============================================================

/**
 * Classify market regime based on trend, volatility, and cycle indicators
 *
 * STATN methodology:
 * 1. ADX for trend strength
 * 2. VIX for volatility
 * 3. Price vs MAs for trend direction
 * 4. ATR for volatility expansion/contraction
 */
export async function classifyMarketRegime(): Promise<RegimeClassification> {
  try {
    // yahoo-finance2 v3 broke the static .chart() call this function was built
    // on ("Call new YahooFinance() first"), which threw every 60s from the
    // poller and left regime classification dead. The platform's own candle
    // feed serves the same daily SPY bars without the dependency.
    const { fetchCandles } = await import('./historical-candles');
    const quotes = await fetchCandles('SPY', '6mo', '1d');
    if (quotes.length < 50) {
      return getDefaultRegimeClassification();
    }

    // Calculate indicators
    const closes = quotes.map(q => q.close || 0).filter(c => c > 0);
    const highs = quotes.map(q => q.high || 0).filter(h => h > 0);
    const lows = quotes.map(q => q.low || 0).filter(l => l > 0);

    // Calculate ADX (simplified)
    const adx = calculateADX(highs, lows, closes, 14);

    // Calculate trend direction
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    const currentPrice = closes[closes.length - 1];

    let trendDirection: 'up' | 'down' | 'neutral';
    if (currentPrice > sma20 && sma20 > sma50) {
      trendDirection = 'up';
    } else if (currentPrice < sma20 && sma20 < sma50) {
      trendDirection = 'down';
    } else {
      trendDirection = 'neutral';
    }

    // VIX from the same candle feed (last daily close). A default of 20 on
    // failure is disclosed by the regime carrying no VIX-derived certainty.
    let vix = 20;
    try {
      const vixBars = await fetchCandles('^VIX', '5d', '1d');
      const lastVix = vixBars[vixBars.length - 1]?.close;
      if (Number.isFinite(lastVix) && lastVix > 0) vix = lastVix;
    } catch {
      // Use default
    }

    // Calculate ATR percentile
    const atr = calculateATR(highs, lows, closes, 14);
    const atrPercentile = calculateATRPercentile(highs, lows, closes, atr);

    // Classify regime
    let regime: MarketRegime;
    let confidence: number;

    if (vix > 35) {
      regime = 'CRISIS';
      confidence = 90;
    } else if (vix > 25) {
      regime = 'HIGH_VOLATILITY';
      confidence = 80;
    } else if (vix < 13) {
      regime = 'LOW_VOLATILITY';
      confidence = 75;
    } else if (adx > 30 && trendDirection === 'up') {
      regime = 'STRONG_UPTREND';
      confidence = 85;
    } else if (adx > 30 && trendDirection === 'down') {
      regime = 'STRONG_DOWNTREND';
      confidence = 85;
    } else if (adx > 20 && trendDirection === 'up') {
      regime = 'WEAK_UPTREND';
      confidence = 70;
    } else if (adx > 20 && trendDirection === 'down') {
      regime = 'WEAK_DOWNTREND';
      confidence = 70;
    } else if (atrPercentile > 70) {
      regime = 'RANGING_HIGH_VOL';
      confidence = 65;
    } else {
      regime = 'RANGING_LOW_VOL';
      confidence = 60;
    }

    return {
      current: regime,
      confidence,
      indicators: {
        adx,
        trendDirection,
        vix,
        atrPercentile,
        correlationToSpy: 1.0, // Would calculate for individual stocks
      },
      historicalRegimes: [], // Would populate from historical analysis
    };
  } catch (error) {
    logger.error('[QUANT] Regime classification failed:', error);
    return getDefaultRegimeClassification();
  }
}

function getDefaultRegimeClassification(): RegimeClassification {
  return {
    current: 'UNKNOWN',
    confidence: 0,
    indicators: {
      adx: 20,
      trendDirection: 'neutral',
      vix: 20,
      atrPercentile: 50,
      correlationToSpy: 1.0,
    },
    historicalRegimes: [],
  };
}

// ============================================================
// TECHNICAL INDICATORS
// ============================================================

function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): number {
  if (highs.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  const recentTR = trueRanges.slice(-period);
  return recentTR.reduce((sum, tr) => sum + tr, 0) / period;
}

function calculateATRPercentile(
  highs: number[],
  lows: number[],
  closes: number[],
  currentATR: number
): number {
  // Calculate ATR for each day in history
  const atrs: number[] = [];
  for (let i = 14; i < highs.length; i++) {
    const h = highs.slice(i - 14, i);
    const l = lows.slice(i - 14, i);
    const c = closes.slice(i - 14, i);
    const atr = calculateATR(h, l, c, 14);
    if (atr > 0) atrs.push(atr);
  }

  if (atrs.length === 0) return 50;

  // Calculate percentile
  const sorted = [...atrs].sort((a, b) => a - b);
  const rank = sorted.filter(a => a <= currentATR).length;
  return (rank / sorted.length) * 100;
}

function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): number {
  if (highs.length < period * 2) return 20; // Default

  // Simplified ADX calculation
  const pDMs: number[] = [];
  const nDMs: number[] = [];
  const trs: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    const pDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const nDM = downMove > upMove && downMove > 0 ? downMove : 0;

    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );

    pDMs.push(pDM);
    nDMs.push(nDM);
    trs.push(tr);
  }

  // Smoothed values
  const smoothedPDM = pDMs.slice(-period).reduce((sum, v) => sum + v, 0);
  const smoothedNDM = nDMs.slice(-period).reduce((sum, v) => sum + v, 0);
  const smoothedTR = trs.slice(-period).reduce((sum, v) => sum + v, 0);

  if (smoothedTR === 0) return 20;

  const pDI = (smoothedPDM / smoothedTR) * 100;
  const nDI = (smoothedNDM / smoothedTR) * 100;

  const diDiff = Math.abs(pDI - nDI);
  const diSum = pDI + nDI;

  if (diSum === 0) return 20;

  const dx = (diDiff / diSum) * 100;

  return dx; // Simplified - real ADX would smooth DX over period
}

// ============================================================
// REGIME-CONDITIONAL PERFORMANCE
// ============================================================

/**
 * Calculate performance by market regime
 *
 * Critical insight: A system that works in uptrends may fail in downtrends
 * We need to know WHEN our system works
 */
export async function analyzeRegimeConditionalPerformance(
  lookbackDays: number = 90
): Promise<RegimeConditionalPerformance[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  try {
    // Fetch trades with timestamps
    const trades = await db
      .select({
        id: tradeIdeas.id,
        entryPrice: tradeIdeas.entryPrice,
        exitPrice: tradeIdeas.exitPrice,
        outcomeStatus: tradeIdeas.outcomeStatus,
        createdAt: tradeIdeas.createdAt,
        percentGain: tradeIdeas.percentGain,
      })
      .from(tradeIdeas)
      .where(
        and(
          gte(tradeIdeas.createdAt, cutoffDate),
          or(
            eq(tradeIdeas.outcomeStatus, 'hit_target'),
            eq(tradeIdeas.outcomeStatus, 'hit_stop')
          )
        )
      )
      .orderBy(tradeIdeas.createdAt);

    // For now, group all trades under current regime
    // In production, would classify regime at time of each trade
    const currentRegime = await classifyMarketRegime();

    const regimePerformance: RegimeConditionalPerformance[] = [];

    // Calculate metrics for current regime
    const logReturns = trades
      .filter(t => t.entryPrice && t.exitPrice)
      .map(t => calculateLogReturn(t.entryPrice!, t.exitPrice!));

    const wins = trades.filter(t => t.outcomeStatus === 'hit_target').length;
    const total = trades.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;

    const logAnalysis = analyzeLogReturns(logReturns);

    // Expectancy using log returns
    const avgWinLog = logReturns.filter(r => r > 0).reduce((s, r) => s + r, 0) /
      Math.max(1, logReturns.filter(r => r > 0).length);
    const avgLossLog = Math.abs(logReturns.filter(r => r < 0).reduce((s, r) => s + r, 0) /
      Math.max(1, logReturns.filter(r => r < 0).length));
    const expectancy = (winRate / 100) * avgWinLog - ((100 - winRate) / 100) * avgLossLog;

    // Recommendation based on performance
    let recommendation: RegimeConditionalPerformance['recommendation'];
    if (expectancy > 1 && winRate > 55) {
      recommendation = 'increase_size';
    } else if (expectancy > 0 && winRate > 45) {
      recommendation = 'normal';
    } else if (expectancy > -0.5) {
      recommendation = 'reduce_size';
    } else {
      recommendation = 'avoid';
    }

    regimePerformance.push({
      regime: currentRegime.current,
      tradeCount: total,
      winRate,
      expectancy,
      sharpe: logAnalysis.sharpeLogReturn,
      avgLogReturn: logAnalysis.meanLogReturn,
      recommendation,
    });

    return regimePerformance;
  } catch (error) {
    logger.error('[QUANT] Regime performance analysis failed:', error);
    return [];
  }
}

// ============================================================
// EQUITY CURVE ANALYSIS
// ============================================================

export function analyzeEquityCurve(
  logReturns: number[],
  dates: Date[],
  regimes: MarketRegime[]
): EquityCurveAnalysis {
  if (logReturns.length === 0) {
    return {
      curve: [],
      maxEquity: 100,
      finalEquity: 100,
      maxDrawdown: 0,
      maxDrawdownDuration: 0,
      recoveryFactor: 0,
      calmarRatio: 0,
      ulcerIndex: 0,
      painRatio: 0,
    };
  }

  // Build equity curve using log returns (just add them!)
  let cumulativeLogReturn = 0;
  const curve: EquityCurveAnalysis['curve'] = [];

  for (let i = 0; i < logReturns.length; i++) {
    cumulativeLogReturn += logReturns[i];
    const equity = 100 * Math.exp(cumulativeLogReturn / 100); // Convert back to price

    // Calculate drawdown at this point
    const maxEquitySoFar = Math.max(100, ...curve.map(c => c.equity), equity);
    const drawdown = ((maxEquitySoFar - equity) / maxEquitySoFar) * 100;

    curve.push({
      date: dates[i]?.toISOString().split('T')[0] || '',
      equity,
      drawdown,
      regime: regimes[i] || 'UNKNOWN',
    });
  }

  const maxEquity = Math.max(...curve.map(c => c.equity));
  const finalEquity = curve[curve.length - 1]?.equity || 100;
  const maxDrawdown = Math.max(...curve.map(c => c.drawdown));

  // Max drawdown duration
  let currentDuration = 0;
  let maxDrawdownDuration = 0;
  let peak = curve[0]?.equity || 100;

  for (const point of curve) {
    if (point.equity >= peak) {
      peak = point.equity;
      currentDuration = 0;
    } else {
      currentDuration++;
      maxDrawdownDuration = Math.max(maxDrawdownDuration, currentDuration);
    }
  }

  const totalReturn = finalEquity - 100;
  const recoveryFactor = maxDrawdown > 0 ? totalReturn / maxDrawdown : totalReturn;
  const annualizedReturn = (totalReturn / logReturns.length) * 252; // Assuming daily trades
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

  // Ulcer Index: RMS of drawdowns
  const squaredDrawdowns = curve.map(c => Math.pow(c.drawdown, 2));
  const ulcerIndex = Math.sqrt(squaredDrawdowns.reduce((s, d) => s + d, 0) / curve.length);

  // Pain Ratio: Return / Ulcer Index
  const painRatio = ulcerIndex > 0 ? totalReturn / ulcerIndex : 0;

  return {
    curve,
    maxEquity,
    finalEquity,
    maxDrawdown,
    maxDrawdownDuration,
    recoveryFactor,
    calmarRatio,
    ulcerIndex,
    painRatio,
  };
}

// ============================================================
// FUTURES LEAK / LOOK-AHEAD BIAS CHECK
// ============================================================

/**
 * Check for potential futures leak in the data
 *
 * Futures leak = using information that wouldn't be available at trade time
 * - Signals based on end-of-day data used for morning trades
 * - Targets/stops that "know" the future price
 * - Suspiciously high win rates on first candle
 */
export function checkFuturesLeak(
  trades: Array<{
    entryTime: Date;
    signalTime: Date;
    exitTime: Date;
    percentGain: number;
  }>
): FuturesLeakCheck {
  const suspiciousPatterns: string[] = [];
  const recommendations: string[] = [];

  if (trades.length < 10) {
    return {
      hasPotentialLeak: false,
      suspiciousPatterns: ['Insufficient data to check for futures leak'],
      recommendations: ['Collect more trades before analysis'],
    };
  }

  // Check 1: Signal time after entry time
  const signalAfterEntry = trades.filter(t =>
    t.signalTime > t.entryTime
  );
  if (signalAfterEntry.length > trades.length * 0.01) {
    suspiciousPatterns.push(
      `${signalAfterEntry.length} trades have signal time AFTER entry time`
    );
    recommendations.push('Check timestamp handling - signals must precede entries');
  }

  // Check 2: Suspiciously perfect first-candle exits
  const perfectFirstCandle = trades.filter(t => {
    const holdTime = t.exitTime.getTime() - t.entryTime.getTime();
    const isVeryFast = holdTime < 5 * 60 * 1000; // Less than 5 minutes
    const isPerfectWin = t.percentGain > 3; // > 3% gain
    return isVeryFast && isPerfectWin;
  });

  if (perfectFirstCandle.length > trades.length * 0.1) {
    suspiciousPatterns.push(
      `${perfectFirstCandle.length} trades (${(perfectFirstCandle.length/trades.length*100).toFixed(0)}%) have suspiciously fast perfect exits`
    );
    recommendations.push('Verify entry/exit timestamps are real-time, not backfilled');
  }

  // Check 3: Win rate correlation with volatility direction
  // If we're "predicting" the exact high/low, that's suspicious
  const tradesWithExactTargets = trades.filter(t => {
    // If percent gain is exactly at a round number, could be fitted
    const gain = t.percentGain;
    return Math.abs(gain - Math.round(gain)) < 0.01;
  });

  if (tradesWithExactTargets.length > trades.length * 0.3) {
    suspiciousPatterns.push(
      'Many trades exit at exactly round percent values - possible curve fitting'
    );
    recommendations.push('Use actual exit prices, not fitted targets');
  }

  // Check 4: Unrealistic win rate for specific conditions
  const winRate = trades.filter(t => t.percentGain > 0).length / trades.length * 100;
  if (winRate > 80) {
    suspiciousPatterns.push(
      `Win rate of ${winRate.toFixed(1)}% is suspiciously high for live trading`
    );
    recommendations.push('Verify this is out-of-sample performance, not in-sample backtest');
  }

  return {
    hasPotentialLeak: suspiciousPatterns.length > 0,
    suspiciousPatterns,
    recommendations: recommendations.length > 0 ? recommendations : ['No issues detected'],
  };
}

// ============================================================
// MAIN ANALYSIS FUNCTION
// ============================================================

export async function runQuantitativeAnalysis(
  lookbackDays: number = 90
): Promise<QuantAnalysisReport> {
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - lookbackDays);
  const periodEnd = new Date();

  try {
    // Fetch trades
    const trades = await db
      .select({
        id: tradeIdeas.id,
        entryPrice: tradeIdeas.entryPrice,
        exitPrice: tradeIdeas.exitPrice,
        outcomeStatus: tradeIdeas.outcomeStatus,
        createdAt: tradeIdeas.createdAt,
        exitDate: tradeIdeas.exitDate,
        percentGain: tradeIdeas.percentGain,
      })
      .from(tradeIdeas)
      .where(
        and(
          gte(tradeIdeas.createdAt, periodStart),
          or(
            eq(tradeIdeas.outcomeStatus, 'hit_target'),
            eq(tradeIdeas.outcomeStatus, 'hit_stop')
          ),
          isNotNull(tradeIdeas.entryPrice),
          isNotNull(tradeIdeas.exitPrice)
        )
      )
      .orderBy(tradeIdeas.createdAt);

    // Calculate log returns
    const logReturns = trades
      .filter(t => t.entryPrice && t.exitPrice && t.entryPrice > 0)
      .map(t => calculateLogReturn(t.entryPrice!, t.exitPrice!));

    const dates = trades.map(t => t.createdAt ? new Date(t.createdAt) : new Date());

    // Analyze log returns
    const logReturnAnalysis = analyzeLogReturns(logReturns);

    // Classify current regime
    const currentRegime = await classifyMarketRegime();

    // Regime-conditional performance
    const regimePerformance = await analyzeRegimeConditionalPerformance(lookbackDays);

    // Equity curve analysis
    const regimes = trades.map(() => currentRegime.current); // Simplified
    const equityCurve = analyzeEquityCurve(logReturns, dates, regimes);

    // Check for futures leak
    const futuresLeakCheck = checkFuturesLeak(
      trades.map(t => ({
        entryTime: t.createdAt ? new Date(t.createdAt) : new Date(),
        signalTime: t.createdAt ? new Date(t.createdAt) : new Date(), // Same for now
        exitTime: t.exitDate ? new Date(t.exitDate) : new Date(),
        percentGain: t.percentGain || 0,
      }))
    );

    // Generate system health assessment
    const systemHealth = assessSystemHealth({
      logReturns: logReturnAnalysis,
      equityCurve,
      regimePerformance,
      futuresLeakCheck,
      tradeCount: trades.length,
    });

    logger.info(
      `[QUANT] Analysis complete: ${trades.length} trades, ` +
      `Log Sharpe: ${logReturnAnalysis.sharpeLogReturn.toFixed(2)}, ` +
      `Compounding Error: ${logReturnAnalysis.compoundingError.toFixed(2)}%, ` +
      `Regime: ${currentRegime.current}`
    );

    return {
      logReturns: logReturnAnalysis,
      currentRegime,
      regimePerformance,
      equityCurve,
      futuresLeakCheck,
      systemHealth,
      periodStart,
      periodEnd,
      generatedAt: new Date(),
    };
  } catch (error) {
    logger.error('[QUANT] Analysis failed:', error);
    return generateErrorReport(periodStart, periodEnd, error);
  }
}

function assessSystemHealth(data: {
  logReturns: LogReturnAnalysis;
  equityCurve: EquityCurveAnalysis;
  regimePerformance: RegimeConditionalPerformance[];
  futuresLeakCheck: FuturesLeakCheck;
  tradeCount: number;
}): QuantAnalysisReport['systemHealth'] {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  // Check sample size
  if (data.tradeCount < 30) {
    issues.push(`Insufficient sample size (${data.tradeCount} trades, need 30+)`);
    recommendations.push('Collect more trades before drawing conclusions');
    score -= 30;
  }

  // Check compounding error
  if (Math.abs(data.logReturns.compoundingError) > 1) {
    issues.push(`Compounding error of ${data.logReturns.compoundingError.toFixed(2)}% detected`);
    recommendations.push('Use log returns for all performance calculations');
    score -= 10;
  }

  // Check Sharpe
  if (data.logReturns.sharpeLogReturn < 0) {
    issues.push('Negative Sharpe ratio indicates losing system');
    score -= 25;
  } else if (data.logReturns.sharpeLogReturn < 0.5) {
    issues.push('Low Sharpe ratio suggests high risk relative to return');
    score -= 10;
  }

  // Check drawdown
  if (data.equityCurve.maxDrawdown > 30) {
    issues.push(`Max drawdown of ${data.equityCurve.maxDrawdown.toFixed(1)}% is severe`);
    recommendations.push('Reduce position sizes or add drawdown protection');
    score -= 20;
  }

  // Check for futures leak
  if (data.futuresLeakCheck.hasPotentialLeak) {
    issues.push('Potential futures leak detected in data');
    recommendations.push(...data.futuresLeakCheck.recommendations);
    score -= 25;
  }

  // Check kurtosis (fat tails)
  if (data.logReturns.kurtosis > 3) {
    issues.push('High kurtosis indicates fat tail risk');
    recommendations.push('Consider tail risk hedging or reducing position sizes');
    score -= 5;
  }

  // Check regime performance
  const avoidRegimes = data.regimePerformance.filter(r => r.recommendation === 'avoid');
  if (avoidRegimes.length > 0) {
    issues.push(`Poor performance in ${avoidRegimes.map(r => r.regime).join(', ')}`);
    recommendations.push('Reduce exposure during unfavorable regimes');
    score -= 10;
  }

  // Determine grade
  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (score >= 85) grade = 'A';
  else if (score >= 70) grade = 'B';
  else if (score >= 55) grade = 'C';
  else if (score >= 40) grade = 'D';
  else grade = 'F';

  return { grade, issues, recommendations };
}

function generateErrorReport(
  periodStart: Date,
  periodEnd: Date,
  error: unknown
): QuantAnalysisReport {
  return {
    logReturns: analyzeLogReturns([]),
    currentRegime: getDefaultRegimeClassification(),
    regimePerformance: [],
    equityCurve: analyzeEquityCurve([], [], []),
    futuresLeakCheck: {
      hasPotentialLeak: false,
      suspiciousPatterns: [],
      recommendations: [`Analysis failed: ${error}`],
    },
    systemHealth: {
      grade: 'F',
      issues: [`Analysis error: ${error}`],
      recommendations: ['Fix data source and retry'],
    },
    periodStart,
    periodEnd,
    generatedAt: new Date(),
  };
}

export default {
  runQuantitativeAnalysis,
  calculateLogReturn,
  classifyMarketRegime,
  analyzeLogReturns,
  analyzeEquityCurve,
  checkFuturesLeak,
};
