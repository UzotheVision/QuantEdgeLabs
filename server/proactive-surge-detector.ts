/**
 * PROACTIVE SURGE DETECTOR
 * 
 * Detects stocks BEFORE they make big moves using:
 * 1. MA Setup Detection (20 MA above 50 MA, both rising, pullback to 20 MA)
 * 2. Consolidation Breakout Detection (tight range before explosion)
 * 3. Volume Accumulation (smart money building positions)
 * 4. Candlestick Reversal Patterns
 * 
 * Goal: Be PROACTIVE not REACTIVE - catch stocks before they surge
 */

import { getStockHistory } from './multi-source-market-data';
import { logger } from './logger';

// Logger prefix for proactive surge detection
const logPrefix = '[PROACTIVE]';

export interface ProactiveSetup {
  symbol: string;
  setupType: 'MA_PULLBACK' | 'CONSOLIDATION_BREAKOUT' | 'VOLUME_ACCUMULATION' | 'REVERSAL_PATTERN';
  direction: 'bullish' | 'bearish';
  confidence: number; // 0-100
  signals: string[];
  currentPrice: number;
  entryZone: { low: number; high: number };
  targetPrice: number;
  stopLoss: number;
  riskReward: number;
  timeframe: 'immediate' | 'within_hours' | 'within_days';
  detectedAt: Date;
}

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(0, period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate if MA is rising (slope positive)
 */
function isMARising(prices: number[], period: number, lookback: number = 5): boolean {
  if (prices.length < period + lookback) return false;
  
  const currentSMA = calculateSMA(prices, period);
  const pastSMA = calculateSMA(prices.slice(lookback), period);
  
  if (!currentSMA || !pastSMA) return false;
  return currentSMA > pastSMA;
}

/**
 * Calculate Average True Range for volatility
 */
function calculateATR(data: PriceData[], period: number = 14): number {
  if (data.length < period + 1) return 0;
  
  let atrSum = 0;
  for (let i = 0; i < period; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i + 1]?.close || data[i].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    atrSum += tr;
  }
  return atrSum / period;
}

/**
 * Detect MA Pullback Setup (from the image)
 * Key criteria:
 * - 20 MA above 50 MA
 * - Both 20 MA and 50 MA are rising
 * - Price pulls back to 20 MA (or between 20/50)
 * - Pullback doesn't reach 50 MA
 */
function detectMAPullbackSetup(data: PriceData[]): { isSetup: boolean; signals: string[]; confidence: number } {
  const signals: string[] = [];
  let confidence = 0;
  
  if (data.length < 55) {
    return { isSetup: false, signals: [], confidence: 0 };
  }
  
  const closes = data.map(d => d.close);
  
  // Calculate MAs
  const ma20 = calculateSMA(closes, 20);
  const ma50 = calculateSMA(closes, 50);
  const ma20_5dAgo = calculateSMA(closes.slice(5), 20);
  const ma50_5dAgo = calculateSMA(closes.slice(5), 50);
  
  if (!ma20 || !ma50 || !ma20_5dAgo || !ma50_5dAgo) {
    return { isSetup: false, signals: [], confidence: 0 };
  }
  
  const currentPrice = closes[0];
  
  // Criterion 1: 20 MA above 50 MA
  if (ma20 > ma50) {
    signals.push('MA20_ABOVE_MA50');
    confidence += 20;
  } else {
    return { isSetup: false, signals: [], confidence: 0 }; // Required condition
  }
  
  // Criterion 2: Both MAs rising
  const ma20Rising = ma20 > ma20_5dAgo;
  const ma50Rising = ma50 > ma50_5dAgo;
  
  if (ma20Rising && ma50Rising) {
    signals.push('BOTH_MA_RISING');
    confidence += 25;
  } else if (ma20Rising) {
    signals.push('MA20_RISING');
    confidence += 10;
  }
  
  // Criterion 3: Distance between MAs is healthy (not too compressed)
  const maSpread = ((ma20 - ma50) / ma50) * 100;
  if (maSpread > 2 && maSpread < 15) {
    signals.push('HEALTHY_MA_SPREAD');
    confidence += 15;
  }
  
  // Criterion 4: Price at or near 20 MA (pullback entry zone)
  const distanceFrom20MA = ((currentPrice - ma20) / ma20) * 100;
  if (distanceFrom20MA >= -3 && distanceFrom20MA <= 2) {
    signals.push('PRICE_AT_20MA_SUPPORT');
    confidence += 25;
  } else if (distanceFrom20MA > -5 && distanceFrom20MA < -3) {
    signals.push('PRICE_BETWEEN_MAS');
    confidence += 15;
  }
  
  // Criterion 5: Price has NOT broken below 50 MA
  if (currentPrice > ma50) {
    signals.push('ABOVE_50MA_SUPPORT');
    confidence += 15;
  } else {
    // Failed the support test
    return { isSetup: false, signals: [], confidence: 0 };
  }
  
  // Bonus: Recent pullback from high (not just flat consolidation)
  const recentHigh = Math.max(...closes.slice(0, 10));
  const pullbackPercent = ((recentHigh - currentPrice) / recentHigh) * 100;
  if (pullbackPercent >= 3 && pullbackPercent <= 12) {
    signals.push('HEALTHY_PULLBACK');
    confidence += 10;
  }
  
  return { 
    isSetup: confidence >= 60, 
    signals, 
    confidence: Math.min(confidence, 100) 
  };
}

/**
 * Detect Consolidation Before Breakout
 * Tight range + decreasing volume = coiling for move
 */
function detectConsolidationSetup(data: PriceData[]): { isSetup: boolean; signals: string[]; confidence: number; direction: 'bullish' | 'bearish' } {
  const signals: string[] = [];
  let confidence = 0;
  let direction: 'bullish' | 'bearish' = 'bullish';
  
  if (data.length < 20) {
    return { isSetup: false, signals: [], confidence: 0, direction };
  }
  
  const recent = data.slice(0, 10);
  const older = data.slice(10, 20);
  
  // Calculate range contraction
  const recentRange = Math.max(...recent.map(d => d.high)) - Math.min(...recent.map(d => d.low));
  const olderRange = Math.max(...older.map(d => d.high)) - Math.min(...older.map(d => d.low));
  
  const rangeContraction = recentRange / olderRange;
  
  if (rangeContraction < 0.6) {
    signals.push('TIGHT_CONSOLIDATION');
    confidence += 30;
  } else if (rangeContraction < 0.8) {
    signals.push('MODERATE_CONSOLIDATION');
    confidence += 15;
  }
  
  // Volume analysis - decreasing volume during consolidation
  const recentAvgVol = recent.reduce((sum, d) => sum + d.volume, 0) / recent.length;
  const olderAvgVol = older.reduce((sum, d) => sum + d.volume, 0) / older.length;
  
  if (recentAvgVol < olderAvgVol * 0.7) {
    signals.push('VOLUME_CONTRACTION');
    confidence += 20;
  }
  
  // Determine direction based on trend before consolidation
  const closes = data.map(d => d.close);
  const ma20 = calculateSMA(closes, 20);
  const ma50 = calculateSMA(closes.slice(0, 50).length >= 50 ? closes : closes, Math.min(50, closes.length));
  
  if (ma20 && ma50 && ma20 > ma50) {
    direction = 'bullish';
    signals.push('BULLISH_TREND_CONTEXT');
    confidence += 20;
  } else if (ma20 && ma50 && ma20 < ma50) {
    direction = 'bearish';
    signals.push('BEARISH_TREND_CONTEXT');
    confidence += 20;
  }
  
  // Price near top of consolidation range (ready to break out)
  const consolidationHigh = Math.max(...recent.map(d => d.high));
  const consolidationLow = Math.min(...recent.map(d => d.low));
  const currentPrice = recent[0].close;
  const positionInRange = (currentPrice - consolidationLow) / (consolidationHigh - consolidationLow);
  
  if (direction === 'bullish' && positionInRange > 0.7) {
    signals.push('NEAR_BREAKOUT_LEVEL');
    confidence += 15;
  } else if (direction === 'bearish' && positionInRange < 0.3) {
    signals.push('NEAR_BREAKDOWN_LEVEL');
    confidence += 15;
  }
  
  return { 
    isSetup: confidence >= 50, 
    signals, 
    confidence: Math.min(confidence, 100),
    direction
  };
}

/**
 * Detect Volume Accumulation (Smart Money)
 * Rising volume with price holding steady = accumulation
 */
function detectVolumeAccumulation(data: PriceData[]): { isSetup: boolean; signals: string[]; confidence: number } {
  const signals: string[] = [];
  let confidence = 0;
  
  if (data.length < 20) {
    return { isSetup: false, signals: [], confidence: 0 };
  }
  
  const recent5 = data.slice(0, 5);
  const prev5 = data.slice(5, 10);
  const older10 = data.slice(10, 20);
  
  // Volume increasing
  const recentAvgVol = recent5.reduce((sum, d) => sum + d.volume, 0) / 5;
  const prevAvgVol = prev5.reduce((sum, d) => sum + d.volume, 0) / 5;
  const olderAvgVol = older10.reduce((sum, d) => sum + d.volume, 0) / 10;
  
  const volIncreasing = recentAvgVol > prevAvgVol * 1.2 && recentAvgVol > olderAvgVol * 1.5;
  
  if (volIncreasing) {
    signals.push('VOLUME_SURGE');
    confidence += 30;
  }
  
  // Price relatively stable during accumulation
  const priceRange = (Math.max(...recent5.map(d => d.high)) - Math.min(...recent5.map(d => d.low))) / recent5[0].close * 100;
  if (priceRange < 5) {
    signals.push('TIGHT_PRICE_ACTION');
    confidence += 20;
  }
  
  // Closes near highs (buyers in control)
  const avgClosePosition = recent5.reduce((sum, d) => {
    const range = d.high - d.low;
    if (range === 0) return sum + 0.5;
    return sum + (d.close - d.low) / range;
  }, 0) / 5;
  
  if (avgClosePosition > 0.6) {
    signals.push('CLOSES_NEAR_HIGHS');
    confidence += 25;
  }
  
  // Higher lows pattern
  const lows = recent5.map(d => d.low);
  let higherLows = 0;
  for (let i = 0; i < lows.length - 1; i++) {
    if (lows[i] >= lows[i + 1]) higherLows++;
  }
  if (higherLows >= 3) {
    signals.push('HIGHER_LOWS_PATTERN');
    confidence += 15;
  }
  
  return { 
    isSetup: confidence >= 50, 
    signals, 
    confidence: Math.min(confidence, 100) 
  };
}

/**
 * Detect Candlestick Reversal Patterns
 */
function detectReversalPatterns(data: PriceData[]): { isSetup: boolean; signals: string[]; confidence: number; direction: 'bullish' | 'bearish' } {
  const signals: string[] = [];
  let confidence = 0;
  let direction: 'bullish' | 'bearish' = 'bullish';
  
  if (data.length < 5) {
    return { isSetup: false, signals: [], confidence: 0, direction };
  }
  
  const [today, yesterday, twoDaysAgo] = data;
  
  // Hammer / Bullish Engulfing at support
  const todayBody = Math.abs(today.close - today.open);
  const todayRange = today.high - today.low;
  const todayLowerWick = Math.min(today.open, today.close) - today.low;
  const todayUpperWick = today.high - Math.max(today.open, today.close);
  
  // Hammer: Small body at top, long lower wick
  if (todayLowerWick > todayBody * 2 && todayUpperWick < todayBody * 0.5 && today.close > today.open) {
    signals.push('HAMMER_CANDLE');
    confidence += 30;
    direction = 'bullish';
  }
  
  // Bullish Engulfing
  if (yesterday.close < yesterday.open && // Yesterday red
      today.close > today.open && // Today green
      today.open < yesterday.close && // Opens below yesterday close
      today.close > yesterday.open) { // Closes above yesterday open
    signals.push('BULLISH_ENGULFING');
    confidence += 35;
    direction = 'bullish';
  }
  
  // Morning Star (3-candle pattern)
  if (twoDaysAgo.close < twoDaysAgo.open && // Day 1: big red
      Math.abs(yesterday.close - yesterday.open) < (twoDaysAgo.high - twoDaysAgo.low) * 0.3 && // Day 2: small body
      today.close > today.open && // Day 3: big green
      today.close > (twoDaysAgo.open + twoDaysAgo.close) / 2) { // Closes above midpoint of day 1
    signals.push('MORNING_STAR');
    confidence += 40;
    direction = 'bullish';
  }
  
  // Shooting Star / Bearish Engulfing
  if (todayUpperWick > todayBody * 2 && todayLowerWick < todayBody * 0.5 && today.close < today.open) {
    signals.push('SHOOTING_STAR');
    confidence += 30;
    direction = 'bearish';
  }
  
  // Bearish Engulfing
  if (yesterday.close > yesterday.open && // Yesterday green
      today.close < today.open && // Today red
      today.open > yesterday.close && // Opens above yesterday close
      today.close < yesterday.open) { // Closes below yesterday open
    signals.push('BEARISH_ENGULFING');
    confidence += 35;
    direction = 'bearish';
  }
  
  // Doji at resistance/support (indecision)
  if (todayBody < todayRange * 0.1) {
    signals.push('DOJI_INDECISION');
    confidence += 15;
  }
  
  return { 
    isSetup: confidence >= 30, 
    signals, 
    confidence: Math.min(confidence, 100),
    direction
  };
}

/**
 * Main function: Scan a symbol for proactive setups
 */
export async function scanForProactiveSetups(symbol: string): Promise<ProactiveSetup[]> {
  const setups: ProactiveSetup[] = [];
  
  try {
    // Fetch historical data using multi-source market data
    const historicalData = await getStockHistory(symbol, 60);
    if (!historicalData || historicalData.length < 20) {
      return setups;
    }
    
    // Data is already in correct format from getStockHistory
    const data: PriceData[] = historicalData;
    
    const currentPrice = data[0].close;
    const atr = calculateATR(data);
    
    // 1. Check MA Pullback Setup
    const maPullback = detectMAPullbackSetup(data);
    if (maPullback.isSetup) {
      const closes = data.map(d => d.close);
      const ma20 = calculateSMA(closes, 20) || currentPrice;
      const ma50 = calculateSMA(closes, 50) || currentPrice * 0.95;
      
      setups.push({
        symbol,
        setupType: 'MA_PULLBACK',
        direction: 'bullish',
        confidence: maPullback.confidence,
        signals: maPullback.signals,
        currentPrice,
        entryZone: { low: ma20 * 0.98, high: ma20 * 1.02 },
        targetPrice: currentPrice * 1.08, // 8% target
        stopLoss: ma50 * 0.98, // Below 50 MA
        riskReward: 0,
        timeframe: 'within_days',
        detectedAt: new Date()
      });
      // Calculate R:R
      const lastSetup = setups[setups.length - 1];
      const risk = currentPrice - lastSetup.stopLoss;
      const reward = lastSetup.targetPrice - currentPrice;
      lastSetup.riskReward = risk > 0 ? reward / risk : 0;
    }
    
    // 2. Check Consolidation Breakout
    const consolidation = detectConsolidationSetup(data);
    if (consolidation.isSetup) {
      const recent10High = Math.max(...data.slice(0, 10).map(d => d.high));
      const recent10Low = Math.min(...data.slice(0, 10).map(d => d.low));
      
      setups.push({
        symbol,
        setupType: 'CONSOLIDATION_BREAKOUT',
        direction: consolidation.direction,
        confidence: consolidation.confidence,
        signals: consolidation.signals,
        currentPrice,
        entryZone: consolidation.direction === 'bullish' 
          ? { low: recent10High * 0.99, high: recent10High * 1.01 }
          : { low: recent10Low * 0.99, high: recent10Low * 1.01 },
        targetPrice: consolidation.direction === 'bullish' 
          ? currentPrice * 1.10 
          : currentPrice * 0.90,
        stopLoss: consolidation.direction === 'bullish' 
          ? recent10Low * 0.98 
          : recent10High * 1.02,
        riskReward: 0,
        timeframe: 'within_hours',
        detectedAt: new Date()
      });
      const lastSetup = setups[setups.length - 1];
      const risk = Math.abs(currentPrice - lastSetup.stopLoss);
      const reward = Math.abs(lastSetup.targetPrice - currentPrice);
      lastSetup.riskReward = risk > 0 ? reward / risk : 0;
    }
    
    // 3. Check Volume Accumulation
    const accumulation = detectVolumeAccumulation(data);
    if (accumulation.isSetup) {
      setups.push({
        symbol,
        setupType: 'VOLUME_ACCUMULATION',
        direction: 'bullish',
        confidence: accumulation.confidence,
        signals: accumulation.signals,
        currentPrice,
        entryZone: { low: currentPrice * 0.98, high: currentPrice * 1.01 },
        targetPrice: currentPrice * 1.12, // 12% target for accumulation plays
        stopLoss: currentPrice * 0.94, // 6% stop
        riskReward: 2.0,
        timeframe: 'within_days',
        detectedAt: new Date()
      });
    }
    
    // 4. Check Reversal Patterns
    const reversal = detectReversalPatterns(data);
    if (reversal.isSetup) {
      setups.push({
        symbol,
        setupType: 'REVERSAL_PATTERN',
        direction: reversal.direction,
        confidence: reversal.confidence,
        signals: reversal.signals,
        currentPrice,
        entryZone: { low: currentPrice * 0.99, high: currentPrice * 1.01 },
        targetPrice: reversal.direction === 'bullish' 
          ? currentPrice * 1.06 
          : currentPrice * 0.94,
        stopLoss: reversal.direction === 'bullish' 
          ? data[0].low * 0.98 
          : data[0].high * 1.02,
        riskReward: 0,
        timeframe: 'immediate',
        detectedAt: new Date()
      });
      const lastSetup = setups[setups.length - 1];
      const risk = Math.abs(currentPrice - lastSetup.stopLoss);
      const reward = Math.abs(lastSetup.targetPrice - currentPrice);
      lastSetup.riskReward = risk > 0 ? reward / risk : 0;
    }
    
    // Sort by confidence
    setups.sort((a, b) => b.confidence - a.confidence);
    
    if (setups.length > 0) {
      logger.info(`${logPrefix} ${symbol}: Found ${setups.length} setup(s) - ${setups.map(s => `${s.setupType}(${s.confidence}%)`).join(', ')}`);
    }
    
  } catch (error) {
    logger.error(`${logPrefix} Error scanning ${symbol}:`, error);
  }
  
  return setups;
}

/**
 * Scan multiple symbols for proactive setups
 */
export async function runProactiveScan(symbols: string[]): Promise<ProactiveSetup[]> {
  logger.info(`${logPrefix} Starting proactive scan on ${symbols.length} symbols...`);
  
  const allSetups: ProactiveSetup[] = [];
  
  // Process in batches to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(s => scanForProactiveSetups(s)));
    
    for (const setupList of results) {
      allSetups.push(...setupList);
    }
    
    // Small delay between batches
    if (i + batchSize < symbols.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  // Sort all setups by confidence
  allSetups.sort((a, b) => b.confidence - a.confidence);
  
  logger.info(`${logPrefix} Scan complete: ${allSetups.length} setups found across ${symbols.length} symbols`);
  
  // Log top setups
  const topSetups = allSetups.slice(0, 10);
  for (const setup of topSetups) {
    logger.info(`${logPrefix} TOP: ${setup.symbol} ${setup.setupType} ${setup.direction.toUpperCase()} - ${setup.confidence}% confidence, R:R ${setup.riskReward.toFixed(1)}:1`);
  }
  
  return allSetups;
}
