// Technical Indicators for Trading Analysis

/**
 * Calculate RSI (Relative Strength Index)
 * RSI measures momentum on a scale of 0-100
 * - Above 70: Overbought (potential sell signal)
 * - Below 30: Oversold (potential buy signal)
 * 
 * @param prices - Array of closing prices (most recent last)
 * @param period - Period for RSI calculation (default: 14)
 * @returns RSI value (0-100)
 */
export function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) {
    return 50; // Neutral if not enough data
  }

  const gains: number[] = [];
  const losses: number[] = [];

  // Calculate price changes
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // Calculate initial average gain/loss
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Calculate smoothed averages (Wilder's smoothing)
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  // Calculate RSI
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return Number(rsi.toFixed(2));
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * MACD shows trend direction and momentum
 * - Positive MACD: Bullish signal
 * - Negative MACD: Bearish signal
 * - MACD crossing above signal line: Buy signal
 * - MACD crossing below signal line: Sell signal
 * 
 * @param prices - Array of closing prices (most recent last)
 * @param fastPeriod - Fast EMA period (default: 12)
 * @param slowPeriod - Slow EMA period (default: 26)
 * @param signalPeriod - Signal line EMA period (default: 9)
 * @returns MACD values {macd, signal, histogram}
 */
export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number; signal: number; histogram: number } {
  if (prices.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 }; // Not enough data
  }

  // Calculate EMA (Exponential Moving Average)
  const calculateEMA = (data: number[], period: number): number[] => {
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);
    
    // Start with SMA for first value
    const sma = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    ema.push(sma);

    // Calculate EMA for remaining values
    for (let i = period; i < data.length; i++) {
      const value = (data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
      ema.push(value);
    }

    return ema;
  };

  // Calculate fast and slow EMAs
  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);

  // Calculate MACD line
  const macdLine: number[] = [];
  const offset = slowPeriod - fastPeriod;
  for (let i = 0; i < slowEMA.length; i++) {
    macdLine.push(fastEMA[i + offset] - slowEMA[i]);
  }

  // Calculate signal line (EMA of MACD)
  const signalLine = calculateEMA(macdLine, signalPeriod);

  // Get most recent values
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  const histogram = macd - signal;

  return {
    macd: Number(macd.toFixed(4)),
    signal: Number(signal.toFixed(4)),
    histogram: Number(histogram.toFixed(4))
  };
}

/**
 * Calculate Simple Moving Average
 * @param prices - Array of closing prices
 * @param period - Period for SMA
 * @returns SMA value
 */
export function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) {
    return prices[prices.length - 1] || 0;
  }

  const slice = prices.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return Number((sum / period).toFixed(2));
}

/**
 * Analyze RSI signal strength
 * @param rsi - RSI value (0-100)
 * @returns Signal interpretation
 */
export function analyzeRSI(rsi: number): {
  signal: 'strong_oversold' | 'oversold' | 'neutral' | 'overbought' | 'strong_overbought';
  strength: 'strong' | 'moderate' | 'weak';
  direction: 'long' | 'short' | 'neutral';
} {
  if (rsi <= 20) {
    return { signal: 'strong_oversold', strength: 'strong', direction: 'long' };
  } else if (rsi <= 30) {
    return { signal: 'oversold', strength: 'moderate', direction: 'long' };
  } else if (rsi >= 80) {
    return { signal: 'strong_overbought', strength: 'strong', direction: 'short' };
  } else if (rsi >= 70) {
    return { signal: 'overbought', strength: 'moderate', direction: 'short' };
  } else {
    return { signal: 'neutral', strength: 'weak', direction: 'neutral' };
  }
}

/**
 * Analyze MACD signal strength
 * @param macd - MACD values
 * @returns Signal interpretation
 */
export function analyzeMACD(macd: { macd: number; signal: number; histogram: number }): {
  signal: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
  strength: 'strong' | 'moderate' | 'weak';
  direction: 'long' | 'short' | 'neutral';
  crossover: boolean; // True if potential crossover
} {
  const { macd: macdValue, signal: signalValue, histogram } = macd;
  const isBullish = macdValue > signalValue;
  const histogramAbs = Math.abs(histogram);
  
  // Strong divergence
  if (histogramAbs > 0.5) {
    if (isBullish) {
      return { signal: 'strong_bullish', strength: 'strong', direction: 'long', crossover: false };
    } else {
      return { signal: 'strong_bearish', strength: 'strong', direction: 'short', crossover: false };
    }
  }
  
  // Moderate divergence
  if (histogramAbs > 0.1) {
    if (isBullish) {
      return { signal: 'bullish', strength: 'moderate', direction: 'long', crossover: false };
    } else {
      return { signal: 'bearish', strength: 'moderate', direction: 'short', crossover: false };
    }
  }
  
  // Near crossover
  if (histogramAbs < 0.05) {
    return { 
      signal: 'neutral', 
      strength: 'weak', 
      direction: 'neutral', 
      crossover: true // Potential crossover imminent
    };
  }
  
  return { signal: 'neutral', strength: 'weak', direction: 'neutral', crossover: false };
}

/**
 * Calculate Bollinger Bands
 * @param prices - Array of closing prices
 * @param period - Period for calculation (default: 20)
 * @param stdDev - Number of standard deviations (default: 2)
 * @returns Bollinger Band values
 */
export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number } {
  if (prices.length < period) {
    const current = prices[prices.length - 1] || 0;
    return { upper: current, middle: current, lower: current };
  }

  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  
  // Calculate standard deviation
  const variance = slice.reduce((sum, price) => sum + Math.pow(price - middle, 2), 0) / period;
  const standardDeviation = Math.sqrt(variance);
  
  const upper = middle + (stdDev * standardDeviation);
  const lower = middle - (stdDev * standardDeviation);
  
  return {
    upper: Number(upper.toFixed(2)),
    middle: Number(middle.toFixed(2)),
    lower: Number(lower.toFixed(2))
  };
}

/**
 * Calculate Simple VWAP (Volume-Weighted Average Price)
 * VWAP is the average price weighted by volume - used by institutional traders
 * @param prices - Array of closing prices (most recent last)
 * @param volumes - Array of volumes (same length as prices)
 * @returns VWAP value
 */
export function calculateSimpleVWAP(prices: number[], volumes: number[]): number {
  if (prices.length === 0 || volumes.length === 0 || prices.length !== volumes.length) {
    return prices[prices.length - 1] || 0;
  }

  let totalPV = 0;
  let totalVolume = 0;

  for (let i = 0; i < prices.length; i++) {
    totalPV += prices[i] * volumes[i];
    totalVolume += volumes[i];
  }

  if (totalVolume === 0) {
    return prices[prices.length - 1] || 0;
  }

  return Number((totalPV / totalVolume).toFixed(2));
}

/**
 * Analyze RSI(2) mean reversion signal (targeting 55-65% live win rate)
 * Based on Larry Connors' research: RSI(2) < 10 with 200-day MA trend filter
 * @param rsi2 - RSI value with 2-period
 * @param currentPrice - Current price
 * @param sma200 - 200-day simple moving average
 * @returns Mean reversion signal
 */
export function analyzeRSI2MeanReversion(
  rsi2: number,
  currentPrice: number,
  sma200: number
): {
  signal: 'strong_buy' | 'buy' | 'none';
  strength: 'strong' | 'moderate' | 'weak';
} {
  // CRITICAL: Only trade WITH the trend (price above 200 MA for longs)
  const aboveTrend = currentPrice > sma200;

  // RSI(2) < 5 = Strong oversold (Connors' extreme threshold)
  if (rsi2 < 5 && aboveTrend) {
    return { signal: 'strong_buy', strength: 'strong' };
  }

  // RSI(2) < 10 = Standard oversold (targeting 55-65% live)
  if (rsi2 < 10 && aboveTrend) {
    return { signal: 'buy', strength: 'moderate' };
  }

  return { signal: 'none', strength: 'weak' };
}

/**
 * Calculate ATR (Average True Range) - volatility indicator
 * Higher ATR = higher volatility
 * @param highs - Array of high prices
 * @param lows - Array of low prices
 * @param closes - Array of closing prices
 * @param period - Period for ATR (default: 14)
 * @returns ATR value
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
    return 0;
  }

  const trueRanges: number[] = [];

  // Calculate True Range for each period
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  // Calculate initial ATR (SMA of first 'period' true ranges)
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Smooth ATR using Wilder's method
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return Number(atr.toFixed(2));
}

/**
 * Calculate ADX (Average Directional Index) - trend strength indicator
 * ADX measures trend strength (NOT direction)
 * - ADX < 20: Weak trend (ranging/choppy) - GOOD for mean reversion
 * - ADX 20-25: Developing trend
 * - ADX > 25: Strong trend - BAD for mean reversion, GOOD for momentum
 * 
 * @param highs - Array of high prices
 * @param lows - Array of low prices
 * @param closes - Array of closing prices
 * @param period - Period for ADX (default: 14)
 * @returns ADX value (0-100)
 */
export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
    return 50; // Neutral if not enough data
  }

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trueRanges: number[] = [];

  // Calculate directional movement and true range
  for (let i = 1; i < highs.length; i++) {
    const highDiff = highs[i] - highs[i - 1];
    const lowDiff = lows[i - 1] - lows[i];

    // +DM and -DM
    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

    // True Range
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  // Wilder smoothing for +DM, -DM, and TR
  let smoothedPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);

  // Calculate DX values for ADX smoothing
  const dxValues: number[] = [];

  for (let i = period; i < plusDM.length; i++) {
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];
    smoothedTR = smoothedTR - (smoothedTR / period) + trueRanges[i];

    // Calculate +DI and -DI at this point
    const plusDI = smoothedTR !== 0 ? (smoothedPlusDM / smoothedTR) * 100 : 0;
    const minusDI = smoothedTR !== 0 ? (smoothedMinusDM / smoothedTR) * 100 : 0;

    // Calculate DX
    const diSum = plusDI + minusDI;
    const dx = diSum !== 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    dxValues.push(dx);
  }

  // ADX is the Wilder-smoothed average of DX values
  if (dxValues.length < period) {
    // Not enough DX values for proper ADX smoothing, return simple average
    const avgDx = dxValues.length > 0 
      ? dxValues.reduce((a, b) => a + b, 0) / dxValues.length 
      : 50;
    return Number(avgDx.toFixed(2));
  }

  // Initial ADX is SMA of first 'period' DX values
  let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Apply Wilder smoothing to subsequent DX values
  for (let i = period; i < dxValues.length; i++) {
    adx = ((adx * (period - 1)) + dxValues[i]) / period;
  }

  return Number(adx.toFixed(2));
}

/**
 * Determine market regime based on ADX
 * @param adx - ADX value
 * @returns Market regime classification
 */
export function determineMarketRegime(adx: number): {
  regime: 'ranging' | 'developing' | 'trending';
  suitableFor: 'mean_reversion' | 'mixed' | 'momentum';
  confidence: 'high' | 'medium' | 'low';
} {
  if (adx < 20) {
    return {
      regime: 'ranging',
      suitableFor: 'mean_reversion',
      confidence: 'high'
    };
  } else if (adx < 25) {
    return {
      regime: 'developing',
      suitableFor: 'mixed',
      confidence: 'medium'
    };
  } else {
    return {
      regime: 'trending',
      suitableFor: 'momentum',
      confidence: adx > 40 ? 'high' : 'medium'
    };
  }
}

/**
 * ADX Momentum Detection - Determines if trend is accelerating or decaying
 * Uses ADX slope analysis over the lookback period
 * 
 * @param highs - Array of high prices
 * @param lows - Array of low prices
 * @param closes - Array of close prices
 * @param period - ADX calculation period (default 14)
 * @param lookback - Number of periods to compare ADX values (default 5)
 * @returns Momentum state and trading recommendation
 */
export function detectADXMomentum(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
  lookback: number = 5
): {
  momentum: 'accelerating' | 'decaying' | 'stable' | 'insufficient_data';
  adxCurrent: number;
  adxPrevious: number;
  adxDelta: number;
  recommendation: 'enter_trend' | 'hold' | 'exit_trend' | 'wait';
  confidenceMultiplier: number;
} {
  const minDataPoints = period + lookback + 15;
  if (highs.length < minDataPoints || lows.length < minDataPoints || closes.length < minDataPoints) {
    return {
      momentum: 'insufficient_data',
      adxCurrent: 50,
      adxPrevious: 50,
      adxDelta: 0,
      recommendation: 'wait',
      confidenceMultiplier: 1.0
    };
  }
  
  const adxCurrent = calculateADX(highs, lows, closes, period);
  const adxPrevious = calculateADX(
    highs.slice(0, -lookback),
    lows.slice(0, -lookback),
    closes.slice(0, -lookback),
    period
  );
  
  const adxDelta = adxCurrent - adxPrevious;
  const deltaThreshold = 3; // Min change to consider momentum shift
  
  let momentum: 'accelerating' | 'decaying' | 'stable' | 'insufficient_data';
  let recommendation: 'enter_trend' | 'hold' | 'exit_trend' | 'wait';
  let confidenceMultiplier: number;
  
  if (adxDelta > deltaThreshold) {
    momentum = 'accelerating';
    if (adxCurrent > 25) {
      recommendation = 'enter_trend';
      confidenceMultiplier = 1.15; // +15% confidence for accelerating trends
    } else if (adxCurrent > 20) {
      recommendation = 'hold';
      confidenceMultiplier = 1.05;
    } else {
      recommendation = 'wait';
      confidenceMultiplier = 1.0;
    }
  } else if (adxDelta < -deltaThreshold) {
    momentum = 'decaying';
    if (adxCurrent < 20) {
      recommendation = 'exit_trend';
      confidenceMultiplier = 0.8; // -20% confidence for decaying trends
    } else {
      recommendation = 'exit_trend';
      confidenceMultiplier = 0.9;
    }
  } else {
    momentum = 'stable';
    recommendation = adxCurrent > 25 ? 'hold' : 'wait';
    confidenceMultiplier = 1.0;
  }
  
  return {
    momentum,
    adxCurrent,
    adxPrevious,
    adxDelta: Number(adxDelta.toFixed(2)),
    recommendation,
    confidenceMultiplier
  };
}

// ============================================
// ADVANCED PATTERN DETECTION (technicalindicators)
// ============================================

import * as TI from 'technicalindicators';

export interface CandleData {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
}

export interface PatternResult {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak';
  detected: boolean;
}

/**
 * Detect all candlestick patterns using technicalindicators library
 * Returns an array of detected patterns with their strength
 */
export function detectCandlestickPatterns(candles: CandleData): PatternResult[] {
  const patterns: PatternResult[] = [];
  
  // Bullish patterns
  const bullishPatterns = [
    { fn: TI.bullishengulfingpattern, name: 'Bullish Engulfing', strength: 'strong' as const },
    { fn: TI.bullishhammerstick, name: 'Hammer', strength: 'moderate' as const },
    { fn: TI.morningstar, name: 'Morning Star', strength: 'strong' as const },
    { fn: TI.threewhitesoldiers, name: 'Three White Soldiers', strength: 'strong' as const },
    { fn: TI.piercingline, name: 'Piercing Line', strength: 'moderate' as const },
    { fn: TI.tweezerbottom, name: 'Tweezer Bottom', strength: 'moderate' as const },
  ];
  
  // Bearish patterns
  const bearishPatterns = [
    { fn: TI.bearishengulfingpattern, name: 'Bearish Engulfing', strength: 'strong' as const },
    { fn: TI.shootingstar, name: 'Shooting Star', strength: 'moderate' as const },
    { fn: TI.eveningstar, name: 'Evening Star', strength: 'strong' as const },
    { fn: TI.threeblackcrows, name: 'Three Black Crows', strength: 'strong' as const },
    { fn: TI.hangingman, name: 'Hanging Man', strength: 'moderate' as const },
    { fn: TI.tweezertop, name: 'Tweezer Top', strength: 'moderate' as const },
  ];
  
  // Neutral patterns
  const neutralPatterns = [
    { fn: TI.doji, name: 'Doji', strength: 'weak' as const },
    { fn: TI.dragonflydoji, name: 'Dragonfly Doji', strength: 'moderate' as const },
    { fn: TI.gravestonedoji, name: 'Gravestone Doji', strength: 'moderate' as const },
  ];
  
  // Check bullish patterns
  for (const pattern of bullishPatterns) {
    if (pattern.fn) {
      try {
        const result = pattern.fn(candles);
        if (result === true || (Array.isArray(result) && result[result.length - 1])) {
          patterns.push({ name: pattern.name, type: 'bullish', strength: pattern.strength, detected: true });
        }
      } catch (e) { /* Pattern not applicable */ }
    }
  }
  
  // Check bearish patterns
  for (const pattern of bearishPatterns) {
    if (pattern.fn) {
      try {
        const result = pattern.fn(candles);
        if (result === true || (Array.isArray(result) && result[result.length - 1])) {
          patterns.push({ name: pattern.name, type: 'bearish', strength: pattern.strength, detected: true });
        }
      } catch (e) { /* Pattern not applicable */ }
    }
  }
  
  // Check neutral patterns
  for (const pattern of neutralPatterns) {
    if (pattern.fn) {
      try {
        const result = pattern.fn(candles);
        if (result === true || (Array.isArray(result) && result[result.length - 1])) {
          patterns.push({ name: pattern.name, type: 'neutral', strength: pattern.strength, detected: true });
        }
      } catch (e) { /* Pattern not applicable */ }
    }
  }
  
  return patterns;
}

/**
 * Calculate Stochastic RSI - More sensitive than regular RSI
 */
export function calculateStochRSI(
  prices: number[],
  rsiPeriod: number = 14,
  stochPeriod: number = 14,
  kPeriod: number = 3,
  dPeriod: number = 3
): { k: number; d: number } | null {
  if (prices.length < rsiPeriod + stochPeriod) {
    return null;
  }
  
  try {
    const result = TI.StochasticRSI.calculate({
      values: prices,
      rsiPeriod,
      stochasticPeriod: stochPeriod,
      kPeriod,
      dPeriod
    });
    
    if (result.length > 0) {
      const last = result[result.length - 1];
      return { k: last.k, d: last.d };
    }
  } catch (e) {
    return null;
  }
  
  return null;
}

/**
 * Calculate Ichimoku Cloud components
 */
export function calculateIchimoku(
  high: number[],
  low: number[],
  close: number[],
  conversionPeriod: number = 9,
  basePeriod: number = 26,
  spanPeriod: number = 52,
  displacement: number = 26
): { tenkan: number; kijun: number; senkouA: number; senkouB: number; chikou: number } | null {
  if (high.length < spanPeriod) {
    return null;
  }
  
  try {
    const result = TI.IchimokuCloud.calculate({
      high,
      low,
      conversionPeriod,
      basePeriod,
      spanPeriod,
      displacement
    });
    
    if (result.length > 0) {
      const last = result[result.length - 1];
      return {
        tenkan: last.conversion,
        kijun: last.base,
        senkouA: last.spanA,
        senkouB: last.spanB,
        chikou: close[close.length - displacement] || close[close.length - 1]
      };
    }
  } catch (e) {
    return null;
  }
  
  return null;
}

/**
 * Enhanced signal scoring using multiple indicators
 * This is the "Qbot-style" multi-indicator approach
 * 
 * Based on 2024 research for 73% win rate:
 * - Combine RSI + MACD + Support/Resistance + Momentum
 * - Use optimized RSI thresholds (45-70 buy, 30-55 sell momentum zones)
 * - Multi-indicator confluence = higher confidence
 */
export function calculateEnhancedSignalScore(
  prices: number[],
  high: number[],
  low: number[],
  volume: number[]
): {
  score: number;
  signals: string[];
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  supportLevel: number;
  resistanceLevel: number;
  atr: number;
} {
  const signals: string[] = [];
  let bullishScore = 0;
  let bearishScore = 0;
  const currentPrice = prices[prices.length - 1];
  
  // 1. RSI Analysis (optimized thresholds from 2024 research)
  const rsi = calculateRSI(prices, 14);
  const rsi2 = calculateRSI(prices, 2);
  
  // Traditional oversold/overbought
  if (rsi < 30) { bullishScore += 20; signals.push(`RSI14 Oversold (${rsi.toFixed(0)})`); }
  else if (rsi > 70) { bearishScore += 20; signals.push(`RSI14 Overbought (${rsi.toFixed(0)})`); }
  // Momentum zones (45-70 bullish momentum, 30-55 bearish momentum)
  else if (rsi >= 45 && rsi <= 70) { bullishScore += 8; signals.push(`RSI14 Bullish Zone (${rsi.toFixed(0)})`); }
  else if (rsi >= 30 && rsi <= 55) { bearishScore += 8; signals.push(`RSI14 Bearish Zone (${rsi.toFixed(0)})`); }
  
  // RSI(2) mean reversion
  if (rsi2 < 10) { bullishScore += 25; signals.push(`RSI2 Extreme Oversold (${rsi2.toFixed(0)})`); }
  else if (rsi2 > 90) { bearishScore += 25; signals.push(`RSI2 Extreme Overbought (${rsi2.toFixed(0)})`); }
  else if (rsi2 < 25) { bullishScore += 12; signals.push(`RSI2 Oversold (${rsi2.toFixed(0)})`); }
  else if (rsi2 > 75) { bearishScore += 12; signals.push(`RSI2 Overbought (${rsi2.toFixed(0)})`); }
  
  // 2. MACD Analysis (trend confirmation)
  const macd = calculateMACD(prices);
  const prevMacd = prices.length > 30 ? calculateMACD(prices.slice(0, -1)) : null;
  
  // MACD crossover detection (strongest signal)
  if (prevMacd && macd.macd > macd.signal && prevMacd.macd <= prevMacd.signal) {
    bullishScore += 20; signals.push('MACD Golden Cross');
  } else if (prevMacd && macd.macd < macd.signal && prevMacd.macd >= prevMacd.signal) {
    bearishScore += 20; signals.push('MACD Death Cross');
  }
  // MACD trend
  if (macd.histogram > 0 && macd.macd > 0) { bullishScore += 10; signals.push('MACD Bullish'); }
  else if (macd.histogram < 0 && macd.macd < 0) { bearishScore += 10; signals.push('MACD Bearish'); }
  // Histogram momentum
  if (prevMacd && macd.histogram > prevMacd.histogram && macd.histogram > 0) {
    bullishScore += 5; signals.push('MACD Momentum Rising');
  } else if (prevMacd && macd.histogram < prevMacd.histogram && macd.histogram < 0) {
    bearishScore += 5; signals.push('MACD Momentum Falling');
  }
  
  // 3. Bollinger Bands (mean reversion + breakout)
  const bb = calculateBollingerBands(prices);
  const bbWidth = (bb.upper - bb.lower) / bb.middle * 100;
  if (currentPrice < bb.lower) { bullishScore += 18; signals.push('Below Lower BB (Oversold)'); }
  else if (currentPrice > bb.upper) { bearishScore += 18; signals.push('Above Upper BB (Overbought)'); }
  // Squeeze detection (low volatility = impending move)
  if (bbWidth < 5) { signals.push(`BB Squeeze (${bbWidth.toFixed(1)}% width)`); }
  
  // 4. Support/Resistance Levels (key for entries)
  const recentLows = low.slice(-20);
  const recentHighs = high.slice(-20);
  const supportLevel = Math.min(...recentLows);
  const resistanceLevel = Math.max(...recentHighs);
  const distanceToSupport = ((currentPrice - supportLevel) / currentPrice) * 100;
  const distanceToResistance = ((resistanceLevel - currentPrice) / currentPrice) * 100;
  
  // Near support = bullish, near resistance = bearish
  if (distanceToSupport < 3) { bullishScore += 15; signals.push(`Near Support ($${supportLevel.toFixed(2)})`); }
  if (distanceToResistance < 3) { bearishScore += 15; signals.push(`Near Resistance ($${resistanceLevel.toFixed(2)})`); }
  
  // 5. ATR (Average True Range) for volatility
  const atr = calculateATR(high, low, prices, 14);
  const atrPercent = (atr / currentPrice) * 100;
  if (atrPercent > 5) { signals.push(`High Volatility (ATR ${atrPercent.toFixed(1)}%)`); }
  else if (atrPercent < 2) { signals.push(`Low Volatility (ATR ${atrPercent.toFixed(1)}%)`); }
  
  // 6. Price Momentum (Rate of Change)
  if (prices.length >= 10) {
    const roc5 = ((currentPrice - prices[prices.length - 6]) / prices[prices.length - 6]) * 100;
    const roc10 = ((currentPrice - prices[prices.length - 11]) / prices[prices.length - 11]) * 100;
    
    if (roc5 > 5) { bullishScore += 12; signals.push(`Strong 5d Momentum (+${roc5.toFixed(1)}%)`); }
    else if (roc5 < -5) { bearishScore += 12; signals.push(`Weak 5d Momentum (${roc5.toFixed(1)}%)`); }
    
    // Trend alignment (both timeframes agree)
    if (roc5 > 2 && roc10 > 3) { bullishScore += 8; signals.push('Aligned Uptrend'); }
    else if (roc5 < -2 && roc10 < -3) { bearishScore += 8; signals.push('Aligned Downtrend'); }
  }
  
  // 7. Moving Average Analysis
  const sma20 = calculateSMA(prices, 20);
  const sma50 = prices.length >= 50 ? calculateSMA(prices, 50) : sma20;
  
  if (currentPrice > sma20 && sma20 > sma50) { bullishScore += 10; signals.push('Above Rising MAs'); }
  else if (currentPrice < sma20 && sma20 < sma50) { bearishScore += 10; signals.push('Below Falling MAs'); }
  
  // 8. Volume Spike Analysis
  if (volume.length >= 20) {
    const avgVolume = volume.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVolume = volume[volume.length - 1];
    const volumeRatio = currentVolume / avgVolume;
    if (volumeRatio > 2) {
      const priceChange = (prices[prices.length - 1] - prices[prices.length - 2]) / prices[prices.length - 2];
      if (priceChange > 0) { bullishScore += 12; signals.push(`Volume Surge (${volumeRatio.toFixed(1)}x) on Green`); }
      else { bearishScore += 12; signals.push(`Volume Surge (${volumeRatio.toFixed(1)}x) on Red`); }
    }
  }
  
  // 9. ADX Trend Strength (amplifies other signals)
  const adx = calculateADX(high, low, prices);
  if (adx > 25) {
    const boost = adx > 40 ? 1.2 : 1.1; // Strong trend = amplify signals
    if (bullishScore > bearishScore) bullishScore = Math.round(bullishScore * boost);
    else bearishScore = Math.round(bearishScore * boost);
    signals.push(`Strong Trend (ADX ${adx.toFixed(0)})`);
  } else if (adx < 20) {
    signals.push(`Weak Trend (ADX ${adx.toFixed(0)}) - Choppy`);
  }
  
  // 10. Candlestick Patterns
  if (prices.length >= 5) {
    const candles: CandleData = {
      open: prices.slice(-5, -1),
      high: high.slice(-5),
      low: low.slice(-5),
      close: prices.slice(-5)
    };
    const patterns = detectCandlestickPatterns(candles);
    for (const p of patterns) {
      if (p.type === 'bullish') { bullishScore += p.strength === 'strong' ? 15 : 8; signals.push(p.name); }
      else if (p.type === 'bearish') { bearishScore += p.strength === 'strong' ? 15 : 8; signals.push(p.name); }
    }
  }
  
  // Calculate final score and direction with confluence bonus
  const confluenceBonus = Math.min(20, signals.length * 3); // More signals = higher confidence
  const netScore = bullishScore - bearishScore;
  const direction = netScore > 15 ? 'bullish' : netScore < -15 ? 'bearish' : 'neutral';
  const baseConfidence = Math.abs(netScore) + confluenceBonus;
  const confidence = Math.min(95, Math.max(10, baseConfidence)); // Cap at 95%, floor at 10%
  
  return {
    score: Math.max(bullishScore, bearishScore),
    signals,
    direction,
    confidence,
    supportLevel,
    resistanceLevel,
    atr
  };
}

// =====================================================
// ENHANCED MULTI-LAYER ANALYSIS FUNCTIONS
// =====================================================

/**
 * Calculate Williams %R - Momentum oscillator
 * Ranges from -100 to 0
 * - Above -20: Overbought
 * - Below -80: Oversold
 */
export function calculateWilliamsR(high: number[], low: number[], close: number[], period: number = 14): number {
  if (high.length < period || low.length < period || close.length < period) {
    return -50; // Neutral
  }
  
  const highestHigh = Math.max(...high.slice(-period));
  const lowestLow = Math.min(...low.slice(-period));
  const currentClose = close[close.length - 1];
  
  if (highestHigh === lowestLow) return -50;
  
  const williamsR = ((highestHigh - currentClose) / (highestHigh - lowestLow)) * -100;
  return Number(williamsR.toFixed(2));
}

/**
 * Calculate CCI (Commodity Channel Index)
 * Measures deviation from the statistical mean
 * - Above +100: Overbought
 * - Below -100: Oversold
 */
export function calculateCCI(high: number[], low: number[], close: number[], period: number = 20): number {
  if (high.length < period || low.length < period || close.length < period) {
    return 0;
  }
  
  // Calculate Typical Price
  const typicalPrices: number[] = [];
  for (let i = 0; i < close.length; i++) {
    typicalPrices.push((high[i] + low[i] + close[i]) / 3);
  }
  
  // Get recent typical prices
  const recentTP = typicalPrices.slice(-period);
  const smaTP = recentTP.reduce((a, b) => a + b, 0) / period;
  
  // Calculate Mean Deviation
  const meanDeviation = recentTP.reduce((sum, tp) => sum + Math.abs(tp - smaTP), 0) / period;
  
  if (meanDeviation === 0) return 0;
  
  const currentTP = typicalPrices[typicalPrices.length - 1];
  const cci = (currentTP - smaTP) / (0.015 * meanDeviation);
  
  return Number(cci.toFixed(2));
}

/**
 * Calculate VWAP (Volume Weighted Average Price)
 * Key institutional level for day trading
 */
export function calculateVWAP(high: number[], low: number[], close: number[], volume: number[]): number {
  if (high.length < 1 || volume.length < 1) {
    return close[close.length - 1] || 0;
  }
  
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (let i = 0; i < close.length; i++) {
    const typicalPrice = (high[i] + low[i] + close[i]) / 3;
    cumulativeTPV += typicalPrice * volume[i];
    cumulativeVolume += volume[i];
  }
  
  if (cumulativeVolume === 0) return close[close.length - 1];
  
  return Number((cumulativeTPV / cumulativeVolume).toFixed(4));
}

/**
 * Calculate EMA (Exponential Moving Average)
 * Returns the most recent EMA value
 */
export function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) {
    return prices[prices.length - 1] || 0;
  }
  
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return Number(ema.toFixed(4));
}

/**
 * Calculate multiple EMAs for confluence analysis
 * Returns null values for EMAs that don't have enough data
 */
export function calculateEMABundle(prices: number[]): {
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
  trend: 'bullish' | 'bearish' | 'neutral';
  alignment: number;
  availableEMAs: number;
} {
  const currentPrice = prices[prices.length - 1];
  
  // Only calculate EMAs when we have enough data
  const ema9 = prices.length >= 9 ? calculateEMA(prices, 9) : null;
  const ema21 = prices.length >= 21 ? calculateEMA(prices, 21) : null;
  const ema50 = prices.length >= 50 ? calculateEMA(prices, 50) : null;
  const ema200 = prices.length >= 200 ? calculateEMA(prices, 200) : null;
  
  // Count how many EMAs we have available
  const availableEMAs = [ema9, ema21, ema50, ema200].filter(e => e !== null).length;
  
  // If we don't have at least 2 EMAs, return neutral
  if (availableEMAs < 2) {
    return { 
      ema9, ema21, ema50, ema200, 
      trend: 'neutral', 
      alignment: 50, // Neutral alignment when insufficient data
      availableEMAs 
    };
  }
  
  // Count EMAs in bullish/bearish alignment (only for available EMAs)
  let bullishCount = 0;
  let bearishCount = 0;
  let totalChecks = 0;
  
  // Check price vs available EMAs
  if (ema9 !== null) {
    if (currentPrice > ema9) bullishCount++; else bearishCount++;
    totalChecks++;
  }
  if (ema21 !== null) {
    if (currentPrice > ema21) bullishCount++; else bearishCount++;
    totalChecks++;
  }
  if (ema50 !== null) {
    if (currentPrice > ema50) bullishCount++; else bearishCount++;
    totalChecks++;
  }
  if (ema200 !== null) {
    if (currentPrice > ema200) bullishCount++; else bearishCount++;
    totalChecks++;
  }
  
  // Check EMA stacking (only for available pairs)
  if (ema9 !== null && ema21 !== null) {
    if (ema9 > ema21) bullishCount++; else bearishCount++;
    totalChecks++;
  }
  if (ema21 !== null && ema50 !== null) {
    if (ema21 > ema50) bullishCount++; else bearishCount++;
    totalChecks++;
  }
  if (ema50 !== null && ema200 !== null) {
    if (ema50 > ema200) bullishCount++; else bearishCount++;
    totalChecks++;
  }
  
  // Calculate raw alignment score based on available checks
  const rawAlignment = totalChecks > 0 
    ? Math.round((Math.max(bullishCount, bearishCount) / totalChecks) * 100)
    : 50;
  
  // Cap alignment when not all EMAs available (scale by data availability)
  // With 2 EMAs: max 70%, with 3 EMAs: max 85%, with 4 EMAs: max 100%
  const alignmentCap = 50 + (availableEMAs / 4) * 50;
  const alignment = Math.min(rawAlignment, Math.round(alignmentCap));
    
  // Determine trend (require majority for direction)
  const trend = bullishCount > totalChecks / 2 + 1 ? 'bullish' 
    : bearishCount > totalChecks / 2 + 1 ? 'bearish' 
    : 'neutral';
  
  return { ema9, ema21, ema50, ema200, trend, alignment, availableEMAs };
}

/**
 * Detect Support and Resistance Levels
 * Uses pivot point detection and clustering
 */
export function detectSupportResistanceLevels(high: number[], low: number[], close: number[], lookback: number = 50): {
  support: number[];
  resistance: number[];
  nearestSupport: number;
  nearestResistance: number;
  pricePosition: 'near_support' | 'near_resistance' | 'middle';
} {
  const recentHigh = high.slice(-lookback);
  const recentLow = low.slice(-lookback);
  const currentPrice = close[close.length - 1];
  
  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];
  
  // Find pivot highs and lows (local maxima/minima)
  for (let i = 2; i < recentHigh.length - 2; i++) {
    // Pivot high
    if (recentHigh[i] > recentHigh[i-1] && recentHigh[i] > recentHigh[i-2] &&
        recentHigh[i] > recentHigh[i+1] && recentHigh[i] > recentHigh[i+2]) {
      pivotHighs.push(recentHigh[i]);
    }
    // Pivot low
    if (recentLow[i] < recentLow[i-1] && recentLow[i] < recentLow[i-2] &&
        recentLow[i] < recentLow[i+1] && recentLow[i] < recentLow[i+2]) {
      pivotLows.push(recentLow[i]);
    }
  }
  
  // Cluster similar levels (within 1% of each other)
  const clusterLevels = (levels: number[]): number[] => {
    if (levels.length === 0) return [];
    
    levels.sort((a, b) => a - b);
    const clustered: number[] = [];
    let cluster = [levels[0]];
    
    for (let i = 1; i < levels.length; i++) {
      const prevAvg = cluster.reduce((a, b) => a + b, 0) / cluster.length;
      if ((levels[i] - prevAvg) / prevAvg < 0.01) {
        cluster.push(levels[i]);
      } else {
        clustered.push(cluster.reduce((a, b) => a + b, 0) / cluster.length);
        cluster = [levels[i]];
      }
    }
    clustered.push(cluster.reduce((a, b) => a + b, 0) / cluster.length);
    
    return clustered;
  };
  
  const resistance = clusterLevels(pivotHighs).filter(l => l > currentPrice).slice(0, 3);
  const support = clusterLevels(pivotLows).filter(l => l < currentPrice).slice(-3);
  
  // If not enough levels found, use recent high/low
  if (resistance.length === 0) resistance.push(Math.max(...recentHigh));
  if (support.length === 0) support.push(Math.min(...recentLow));
  
  const nearestResistance = Math.min(...resistance);
  const nearestSupport = Math.max(...support);
  
  // Determine price position
  const distToSupport = ((currentPrice - nearestSupport) / currentPrice) * 100;
  const distToResistance = ((nearestResistance - currentPrice) / currentPrice) * 100;
  
  let pricePosition: 'near_support' | 'near_resistance' | 'middle' = 'middle';
  if (distToSupport < 2) pricePosition = 'near_support';
  else if (distToResistance < 2) pricePosition = 'near_resistance';
  
  return {
    support: support.map(s => Number(s.toFixed(2))),
    resistance: resistance.map(r => Number(r.toFixed(2))),
    nearestSupport: Number(nearestSupport.toFixed(2)),
    nearestResistance: Number(nearestResistance.toFixed(2)),
    pricePosition
  };
}

/**
 * Analyze Market Structure (Higher Highs/Lows, Trend Changes)
 */
export function analyzeMarketStructure(high: number[], low: number[], close: number[]): {
  trend: 'uptrend' | 'downtrend' | 'ranging';
  structure: string[];
  higherHighs: number;
  higherLows: number;
  lowerHighs: number;
  lowerLows: number;
  trendStrength: number;
  breakOfStructure: boolean;
} {
  const lookback = Math.min(20, high.length);
  const recentHigh = high.slice(-lookback);
  const recentLow = low.slice(-lookback);
  
  // Find swing highs and lows
  const swingHighs: { index: number; price: number }[] = [];
  const swingLows: { index: number; price: number }[] = [];
  
  for (let i = 2; i < lookback - 2; i++) {
    if (recentHigh[i] > recentHigh[i-1] && recentHigh[i] > recentHigh[i+1]) {
      swingHighs.push({ index: i, price: recentHigh[i] });
    }
    if (recentLow[i] < recentLow[i-1] && recentLow[i] < recentLow[i+1]) {
      swingLows.push({ index: i, price: recentLow[i] });
    }
  }
  
  // Count higher highs/lows and lower highs/lows
  let higherHighs = 0, higherLows = 0, lowerHighs = 0, lowerLows = 0;
  
  for (let i = 1; i < swingHighs.length; i++) {
    if (swingHighs[i].price > swingHighs[i-1].price) higherHighs++;
    else lowerHighs++;
  }
  
  for (let i = 1; i < swingLows.length; i++) {
    if (swingLows[i].price > swingLows[i-1].price) higherLows++;
    else lowerLows++;
  }
  
  const structure: string[] = [];
  
  // Determine trend
  let trend: 'uptrend' | 'downtrend' | 'ranging' = 'ranging';
  let trendStrength = 50;
  
  if (higherHighs >= 2 && higherLows >= 2) {
    trend = 'uptrend';
    trendStrength = Math.min(100, 50 + (higherHighs + higherLows) * 10);
    structure.push(`Uptrend: ${higherHighs} HH, ${higherLows} HL`);
  } else if (lowerHighs >= 2 && lowerLows >= 2) {
    trend = 'downtrend';
    trendStrength = Math.min(100, 50 + (lowerHighs + lowerLows) * 10);
    structure.push(`Downtrend: ${lowerHighs} LH, ${lowerLows} LL`);
  } else {
    structure.push('Ranging/Consolidation');
  }
  
  // Check for break of structure (trend change signal)
  const currentPrice = close[close.length - 1];
  let breakOfStructure = false;
  
  if (trend === 'uptrend' && swingLows.length >= 2) {
    const lastSwingLow = swingLows[swingLows.length - 1];
    if (currentPrice < lastSwingLow.price) {
      breakOfStructure = true;
      structure.push('⚠️ Break of Structure (BOS) - Potential Reversal');
    }
  } else if (trend === 'downtrend' && swingHighs.length >= 2) {
    const lastSwingHigh = swingHighs[swingHighs.length - 1];
    if (currentPrice > lastSwingHigh.price) {
      breakOfStructure = true;
      structure.push('⚠️ Break of Structure (BOS) - Potential Reversal');
    }
  }
  
  return {
    trend,
    structure,
    higherHighs,
    higherLows,
    lowerHighs,
    lowerLows,
    trendStrength,
    breakOfStructure
  };
}

/**
 * Calculate Multi-Timeframe Confluence Score
 * Combines signals from multiple timeframes for higher accuracy
 */
export interface TimeframeAnalysis {
  timeframe: string;
  trend: 'bullish' | 'bearish' | 'neutral';
  momentum: number; // -100 to 100
  rsi: number;
  macdSignal: 'bullish' | 'bearish' | 'neutral';
  priceVsVwap: 'above' | 'below' | 'at';
  emaAlignment: number; // 0-100
  signals: string[];
}

export function calculateMultiTimeframeConfluence(timeframes: TimeframeAnalysis[]): {
  overallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  confluenceScore: number;
  alignedTimeframes: number;
  totalTimeframes: number;
  reasoning: string[];
  confidence: number;
} {
  if (timeframes.length === 0) {
    return {
      overallSignal: 'neutral',
      confluenceScore: 50,
      alignedTimeframes: 0,
      totalTimeframes: 0,
      reasoning: ['No timeframe data available'],
      confidence: 0
    };
  }
  
  let bullishCount = 0;
  let bearishCount = 0;
  let totalScore = 0;
  const reasoning: string[] = [];
  
  // Weight higher timeframes more heavily
  const weights: Record<string, number> = {
    '5m': 1,
    '15m': 1.2,
    '1h': 1.5,
    '4h': 1.8,
    '1d': 2.0,
    'daily': 2.0
  };
  
  let totalWeight = 0;
  
  for (const tf of timeframes) {
    const weight = weights[tf.timeframe] || 1;
    totalWeight += weight;
    
    if (tf.trend === 'bullish') {
      bullishCount++;
      totalScore += 10 * weight;
    } else if (tf.trend === 'bearish') {
      bearishCount++;
      totalScore -= 10 * weight;
    }
    
    // Add momentum influence
    totalScore += (tf.momentum / 10) * weight;
    
    // Add EMA alignment influence
    if (tf.emaAlignment > 70) {
      totalScore += 5 * weight * (tf.trend === 'bullish' ? 1 : -1);
    }
    
    // Log significant signals
    if (tf.signals.length > 0) {
      reasoning.push(`${tf.timeframe}: ${tf.trend.toUpperCase()} - ${tf.signals.slice(0, 2).join(', ')}`);
    }
  }
  
  // Normalize score to -100 to 100
  const normalizedScore = Math.round((totalScore / totalWeight) * 5);
  const boundedScore = Math.max(-100, Math.min(100, normalizedScore));
  
  // Confluence bonus for alignment
  const alignedTimeframes = Math.max(bullishCount, bearishCount);
  const alignmentBonus = alignedTimeframes >= 3 ? 15 : alignedTimeframes >= 2 ? 8 : 0;
  
  // Apply alignment bonus
  const finalScore = bullishCount > bearishCount 
    ? boundedScore + alignmentBonus 
    : boundedScore - alignmentBonus;
  
  // Determine signal
  let overallSignal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  if (finalScore >= 50 && alignedTimeframes >= 3) overallSignal = 'strong_buy';
  else if (finalScore >= 25) overallSignal = 'buy';
  else if (finalScore <= -50 && alignedTimeframes >= 3) overallSignal = 'strong_sell';
  else if (finalScore <= -25) overallSignal = 'sell';
  else overallSignal = 'neutral';
  
  // Calculate confidence based on alignment and score strength
  const confidence = Math.min(95, Math.abs(finalScore) + (alignedTimeframes * 10));
  
  if (alignedTimeframes >= 3) {
    reasoning.unshift(`✅ ${alignedTimeframes}/${timeframes.length} timeframes aligned`);
  } else {
    reasoning.unshift(`⚠️ Mixed signals across timeframes`);
  }
  
  return {
    overallSignal,
    confluenceScore: 50 + (finalScore / 2), // Convert to 0-100 scale
    alignedTimeframes,
    totalTimeframes: timeframes.length,
    reasoning,
    confidence
  };
}

/**
 * Volume Flow Analysis - Detect institutional activity
 */
export function analyzeVolumeFlow(volume: number[], close: number[], high: number[], low: number[]): {
  trend: 'accumulation' | 'distribution' | 'neutral';
  volumeProfile: 'increasing' | 'decreasing' | 'stable';
  averageVolume: number;
  relativeVolume: number;
  moneyFlow: number; // Positive = buying pressure, Negative = selling pressure
  signals: string[];
} {
  if (volume.length < 20) {
    return {
      trend: 'neutral',
      volumeProfile: 'stable',
      averageVolume: 0,
      relativeVolume: 1,
      moneyFlow: 0,
      signals: []
    };
  }
  
  const recentVolume = volume.slice(-20);
  const currentVolume = volume[volume.length - 1];
  const averageVolume = recentVolume.reduce((a, b) => a + b, 0) / 20;
  const relativeVolume = currentVolume / averageVolume;
  
  // Calculate Money Flow (simplified On-Balance Volume concept)
  let moneyFlow = 0;
  for (let i = 1; i < Math.min(20, close.length); i++) {
    const idx = close.length - 20 + i;
    if (idx < 0) continue;
    
    const typicalPrice = (high[idx] + low[idx] + close[idx]) / 3;
    const prevTypicalPrice = (high[idx-1] + low[idx-1] + close[idx-1]) / 3;
    
    if (typicalPrice > prevTypicalPrice) {
      moneyFlow += volume[idx];
    } else if (typicalPrice < prevTypicalPrice) {
      moneyFlow -= volume[idx];
    }
  }
  
  // Normalize money flow to -100 to 100
  const normalizedMF = (moneyFlow / (averageVolume * 20)) * 100;
  
  // Determine volume trend
  const recentHalf = recentVolume.slice(-10);
  const oldHalf = recentVolume.slice(0, 10);
  const recentAvg = recentHalf.reduce((a, b) => a + b, 0) / 10;
  const oldAvg = oldHalf.reduce((a, b) => a + b, 0) / 10;
  
  let volumeProfile: 'increasing' | 'decreasing' | 'stable' = 'stable';
  if (recentAvg > oldAvg * 1.2) volumeProfile = 'increasing';
  else if (recentAvg < oldAvg * 0.8) volumeProfile = 'decreasing';
  
  // Determine accumulation/distribution
  let trend: 'accumulation' | 'distribution' | 'neutral' = 'neutral';
  if (normalizedMF > 30 && volumeProfile !== 'decreasing') trend = 'accumulation';
  else if (normalizedMF < -30 && volumeProfile !== 'decreasing') trend = 'distribution';
  
  const signals: string[] = [];
  if (relativeVolume > 2) signals.push(`Volume Surge (${relativeVolume.toFixed(1)}x avg)`);
  if (trend === 'accumulation') signals.push('Accumulation Pattern');
  if (trend === 'distribution') signals.push('Distribution Pattern');
  if (volumeProfile === 'increasing') signals.push('Rising Volume');
  if (volumeProfile === 'decreasing') signals.push('Declining Volume');
  
  return {
    trend,
    volumeProfile,
    averageVolume: Math.round(averageVolume),
    relativeVolume: Number(relativeVolume.toFixed(2)),
    moneyFlow: Number(normalizedMF.toFixed(2)),
    signals
  };
}

// =====================================================
// FIBONACCI RETRACEMENT & SWING TRADE VALIDATION
// Based on professional swing trading methodology
// =====================================================

/**
 * Calculate Fibonacci Retracement Levels
 * Key levels: 0.236, 0.382, 0.5, 0.618, 0.786
 * Used for identifying potential support/resistance zones
 */
export function calculateFibonacciLevels(
  high: number[],
  low: number[],
  close: number[],
  lookback: number = 50
): {
  swingHigh: number;
  swingLow: number;
  levels: { ratio: number; price: number; label: string }[];
  currentLevel: string;
  trend: 'uptrend' | 'downtrend';
} {
  const recentHigh = high.slice(-lookback);
  const recentLow = low.slice(-lookback);
  const currentPrice = close[close.length - 1];
  
  const swingHigh = Math.max(...recentHigh);
  const swingLow = Math.min(...recentLow);
  const range = swingHigh - swingLow;
  
  // Find most recent trend direction based on swing high/low positions
  const highIdx = recentHigh.indexOf(swingHigh);
  const lowIdx = recentLow.indexOf(swingLow);
  const trend = highIdx > lowIdx ? 'uptrend' : 'downtrend';
  
  // Calculate Fibonacci retracement levels
  const fibRatios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const fibLabels = ['0%', '23.6%', '38.2%', '50%', '61.8%', '78.6%', '100%'];
  
  const levels = fibRatios.map((ratio, i) => {
    // In uptrend, levels go down from high; in downtrend, up from low
    const price = trend === 'uptrend'
      ? swingHigh - (range * ratio)
      : swingLow + (range * ratio);
    return { ratio, price: Number(price.toFixed(2)), label: fibLabels[i] };
  });
  
  // Determine which Fib level the current price is near
  let currentLevel = 'middle';
  for (let i = 0; i < levels.length - 1; i++) {
    const lower = Math.min(levels[i].price, levels[i + 1].price);
    const upper = Math.max(levels[i].price, levels[i + 1].price);
    if (currentPrice >= lower && currentPrice <= upper) {
      currentLevel = `${fibLabels[i]}-${fibLabels[i + 1]}`;
      break;
    }
  }
  
  return { swingHigh, swingLow, levels, currentLevel, trend };
}

/**
 * Swing Trade Validation
 * Validates if current setup meets quality swing trade criteria
 * Based on professional methodology:
 * - Support/resistance confirmation
 * - Volume confirmation on bounce
 * - Momentum shift (higher low)
 * - RSI/MACD divergence
 */
export function validateSwingSetup(
  prices: number[],
  high: number[],
  low: number[],
  volume: number[]
): {
  isValid: boolean;
  score: number;
  direction: 'long' | 'short' | 'none';
  signals: string[];
  entry: { price: number; trigger: string } | null;
  invalidation: number;
  targets: number[];
  warnings: string[];
} {
  const signals: string[] = [];
  const warnings: string[] = [];
  let bullScore = 0;
  let bearScore = 0;
  const currentPrice = prices[prices.length - 1];
  
  // 1. Support/Resistance Analysis
  const srLevels = detectSupportResistanceLevels(high, low, prices);
  if (srLevels.pricePosition === 'near_support') {
    bullScore += 25;
    signals.push(`Near Support ($${srLevels.nearestSupport})`);
  } else if (srLevels.pricePosition === 'near_resistance') {
    bearScore += 25;
    signals.push(`Near Resistance ($${srLevels.nearestResistance})`);
  }
  
  // 2. Fibonacci Level Analysis
  const fib = calculateFibonacciLevels(high, low, prices);
  const nearFib382 = fib.levels.find(l => l.ratio === 0.382);
  const nearFib618 = fib.levels.find(l => l.ratio === 0.618);
  
  if (nearFib382 && Math.abs(currentPrice - nearFib382.price) / currentPrice < 0.02) {
    bullScore += 20;
    signals.push(`At Fib 38.2% ($${nearFib382.price})`);
  }
  if (nearFib618 && Math.abs(currentPrice - nearFib618.price) / currentPrice < 0.02) {
    bullScore += 15;
    signals.push(`At Fib 61.8% ($${nearFib618.price})`);
  }
  
  // 3. Market Structure (Higher Lows for Long, Lower Highs for Short)
  const structure = analyzeMarketStructure(high, low, prices);
  if (structure.higherLows >= 1 && fib.trend === 'downtrend') {
    bullScore += 25;
    signals.push('Higher Low Formed (Reversal Signal)');
  }
  if (structure.lowerHighs >= 1 && fib.trend === 'uptrend') {
    bearScore += 25;
    signals.push('Lower High Formed (Reversal Signal)');
  }
  
  // 4. RSI Oversold/Overbought with Divergence
  const rsi = calculateRSI(prices, 14);
  const prevRsi = prices.length > 20 ? calculateRSI(prices.slice(0, -5), 14) : rsi;
  
  if (rsi < 35 && rsi > prevRsi) {
    bullScore += 20;
    signals.push(`RSI Oversold Bounce (${rsi.toFixed(0)})`);
  }
  if (rsi > 65 && rsi < prevRsi) {
    bearScore += 20;
    signals.push(`RSI Overbought Rejection (${rsi.toFixed(0)})`);
  }
  
  // 5. Volume Confirmation (Volume spike on reversal candle)
  if (volume.length >= 20) {
    const avgVol = volume.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const lastVol = volume[volume.length - 1];
    const priceChange = prices[prices.length - 1] - prices[prices.length - 2];
    
    if (lastVol > avgVol * 1.5 && priceChange > 0 && srLevels.pricePosition === 'near_support') {
      bullScore += 20;
      signals.push('Volume Surge at Support (Buyers Stepped In)');
    }
    if (lastVol > avgVol * 1.5 && priceChange < 0 && srLevels.pricePosition === 'near_resistance') {
      bearScore += 20;
      signals.push('Volume Surge at Resistance (Sellers Stepped In)');
    }
  }
  
  // 6. MACD Momentum Shift
  const macd = calculateMACD(prices);
  const prevMacd = prices.length > 30 ? calculateMACD(prices.slice(0, -3)) : macd;
  
  if (macd.histogram > 0 && prevMacd.histogram < 0) {
    bullScore += 15;
    signals.push('MACD Histogram Turned Positive');
  }
  if (macd.histogram < 0 && prevMacd.histogram > 0) {
    bearScore += 15;
    signals.push('MACD Histogram Turned Negative');
  }
  
  // 7. Candlestick Pattern Confirmation
  // Note: Using close prices for both open/close since we may not have OHLC data
  // The pattern detection still works for momentum/reversal signals
  if (prices.length >= 6 && high.length >= 5 && low.length >= 5) {
    const candles: CandleData = {
      open: prices.slice(-6, -1),  // Previous 5 closes as proxy for opens
      high: high.slice(-5),
      low: low.slice(-5),
      close: prices.slice(-5)
    };
    try {
      const patterns = detectCandlestickPatterns(candles);
      for (const p of patterns) {
        if (p.type === 'bullish' && p.strength === 'strong') {
          bullScore += 20;
          signals.push(`${p.name} (Bullish Reversal)`);
        } else if (p.type === 'bearish' && p.strength === 'strong') {
          bearScore += 20;
          signals.push(`${p.name} (Bearish Reversal)`);
        }
      }
    } catch (patternError) {
      // Pattern detection failed - continue without candlestick patterns
    }
  }
  
  // Determine direction and validity
  const totalScore = Math.max(bullScore, bearScore);
  const direction = bullScore > bearScore + 20 ? 'long' 
    : bearScore > bullScore + 20 ? 'short' 
    : 'none';
  
  // Swing trade requires at least 60 points of confluence
  const isValid = totalScore >= 60 && direction !== 'none';
  
  // Calculate entry, invalidation, and targets
  let entry: { price: number; trigger: string } | null = null;
  let invalidation = 0;
  let targets: number[] = [];
  
  if (direction === 'long') {
    // Entry on strength - reclaim of key level
    const entryLevel = nearFib382 ? nearFib382.price : srLevels.nearestSupport;
    entry = {
      price: Number((entryLevel * 1.01).toFixed(2)), // Enter slightly above level
      trigger: `Reclaim of $${entryLevel.toFixed(2)}`
    };
    invalidation = Number((srLevels.nearestSupport * 0.98).toFixed(2)); // 2% below support
    // Targets: resistance levels and Fib extensions
    targets = [
      srLevels.nearestResistance,
      fib.swingHigh,
      Number((fib.swingHigh * 1.1).toFixed(2))
    ];
    
    // Warnings
    if (fib.trend === 'downtrend') {
      warnings.push('Counter-trend trade (downtrend) - use smaller size');
    }
    if (structure.breakOfStructure) {
      warnings.push('Recent break of structure - volatility expected');
    }
  } else if (direction === 'short') {
    const entryLevel = nearFib382 ? nearFib382.price : srLevels.nearestResistance;
    entry = {
      price: Number((entryLevel * 0.99).toFixed(2)), // Enter slightly below level
      trigger: `Breakdown of $${entryLevel.toFixed(2)}`
    };
    invalidation = Number((srLevels.nearestResistance * 1.02).toFixed(2)); // 2% above resistance
    targets = [
      srLevels.nearestSupport,
      fib.swingLow,
      Number((fib.swingLow * 0.9).toFixed(2))
    ];
    
    if (fib.trend === 'uptrend') {
      warnings.push('Counter-trend trade (uptrend) - use smaller size');
    }
  }
  
  return {
    isValid,
    score: totalScore,
    direction,
    signals,
    entry,
    invalidation,
    targets,
    warnings
  };
}

/**
 * Options Strike Selection Helper
 * Based on professional options trading methodology:
 * - Slightly ITM or ATM for higher probability
 * - Avoid far OTM "lottery" plays for swing trades
 * - Consider IV rank for strategy selection
 */
export function recommendStrikeSelection(
  currentPrice: number,
  direction: 'long' | 'short',
  ivRank: number,
  daysToExpiry: number
): {
  recommendedStrike: 'ITM' | 'ATM' | 'OTM';
  strikeOffset: number; // Percentage from current price
  reasoning: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  let recommendedStrike: 'ITM' | 'ATM' | 'OTM' = 'ATM';
  let strikeOffset = 0;
  let reasoning = '';
  
  // High IV = sell premium (OTM credit spreads)
  // Low IV = buy premium (ITM/ATM directional)
  
  if (ivRank > 50) {
    // High IV environment
    recommendedStrike = 'OTM';
    strikeOffset = direction === 'long' ? -5 : 5; // OTM puts for shorts, OTM calls for longs
    reasoning = 'High IV - consider selling premium or OTM for cheaper entry';
    warnings.push('High IV - premium is expensive, consider spreads');
  } else if (ivRank > 25) {
    // Medium IV
    recommendedStrike = 'ATM';
    strikeOffset = 0;
    reasoning = 'Medium IV - ATM provides balance of delta and cost';
  } else {
    // Low IV - buy premium, go ITM for higher delta
    recommendedStrike = 'ITM';
    strikeOffset = direction === 'long' ? 3 : -3; // ITM calls for longs, ITM puts for shorts
    reasoning = 'Low IV - premium is cheap, ITM for higher probability';
  }
  
  // DTE considerations
  if (daysToExpiry < 7) {
    warnings.push('Less than 7 DTE - theta decay accelerating');
    if (recommendedStrike !== 'ITM') {
      recommendedStrike = 'ITM';
      strikeOffset = direction === 'long' ? 5 : -5;
      reasoning += '. Short DTE - go deeper ITM for higher delta';
    }
  } else if (daysToExpiry > 45) {
    warnings.push('Long-dated option - consider LEAPS strategy');
  }
  
  return { recommendedStrike, strikeOffset, reasoning, warnings };
}
