/**
 * Mathematical Pattern Predictor
 * 
 * Uses statistical models to predict chart pattern completions:
 * - Hurst Exponent: Trending vs mean-reverting detection
 * - Harmonic Patterns: Gartley, Butterfly, Crab, Bat with Fibonacci precision
 * - Elliott Wave Math: Wave completion probabilities
 * - Fibonacci Levels: Support/resistance predictions
 * 
 * Integrates with Chart Analysis, ML System, and Trade Desk
 */

import { logger } from './logger';

export interface PriceBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HurstResult {
  exponent: number;
  interpretation: 'trending' | 'mean_reverting' | 'random_walk';
  confidence: number;
  tradingImplication: string;
}

export interface HarmonicPattern {
  name: string;
  type: 'bullish' | 'bearish';
  completionPercent: number;
  priceTarget: number;
  stopLoss: number;
  potentialReversalZone: { low: number; high: number };
  fibRatios: { XA: number; AB: number; BC: number; CD: number };
  confidence: number;
}

export interface ElliottWaveAnalysis {
  currentWave: number;
  waveType: 'impulse' | 'corrective';
  nextWaveDirection: 'up' | 'down';
  completionPercent: number;
  priceProjections: { wave3?: number; wave5?: number; waveC?: number };
  confidence: number;
}

export interface FibonacciLevels {
  retracements: { level: number; price: number; strength: string }[];
  extensions: { level: number; price: number; strength: string }[];
  pivotHigh: number;
  pivotLow: number;
}

export interface PatternPrediction {
  symbol: string;
  timestamp: string;
  hurst: HurstResult;
  harmonicPatterns: HarmonicPattern[];
  elliottWave: ElliottWaveAnalysis | null;
  fibonacci: FibonacciLevels;
  overallSignal: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
  confidenceScore: number;
  tradingRecommendation: string;
}

const FIB_RATIOS = {
  0.236: 'weak',
  0.382: 'moderate',
  0.5: 'moderate',
  0.618: 'strong',
  0.786: 'strong',
  1.0: 'moderate',
  1.272: 'moderate',
  1.618: 'strong',
  2.618: 'strong',
};

const HARMONIC_PATTERNS = {
  gartley: {
    name: 'Gartley',
    XA: { min: 0.618, max: 0.618 },
    AB: { min: 0.382, max: 0.886 },
    BC: { min: 0.382, max: 0.886 },
    CD: { min: 1.13, max: 1.618 },
  },
  butterfly: {
    name: 'Butterfly',
    XA: { min: 0.786, max: 0.786 },
    AB: { min: 0.382, max: 0.886 },
    BC: { min: 0.382, max: 0.886 },
    CD: { min: 1.618, max: 2.618 },
  },
  crab: {
    name: 'Crab',
    XA: { min: 0.382, max: 0.618 },
    AB: { min: 0.382, max: 0.886 },
    BC: { min: 0.382, max: 0.886 },
    CD: { min: 2.24, max: 3.618 },
  },
  bat: {
    name: 'Bat',
    XA: { min: 0.382, max: 0.5 },
    AB: { min: 0.382, max: 0.886 },
    BC: { min: 0.382, max: 0.886 },
    CD: { min: 1.618, max: 2.618 },
  },
};

/**
 * Calculate Hurst Exponent using Rescaled Range (R/S) Analysis
 * H > 0.5: Trending (persistent)
 * H < 0.5: Mean-reverting (anti-persistent)
 * H = 0.5: Random walk
 */
export function calculateHurstExponent(prices: number[]): HurstResult {
  if (prices.length < 20) {
    return {
      exponent: 0.5,
      interpretation: 'random_walk',
      confidence: 0,
      tradingImplication: 'Insufficient data for Hurst calculation',
    };
  }

  try {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }

    const n = returns.length;
    const subsetSizes = [8, 16, 32, 64, 128].filter(s => s <= n / 2);
    
    if (subsetSizes.length < 2) {
      return {
        exponent: 0.5,
        interpretation: 'random_walk',
        confidence: 30,
        tradingImplication: 'Limited data - treating as random walk',
      };
    }

    const rsValues: { logN: number; logRS: number }[] = [];

    for (const size of subsetSizes) {
      const numSubsets = Math.floor(n / size);
      let totalRS = 0;

      for (let i = 0; i < numSubsets; i++) {
        const subset = returns.slice(i * size, (i + 1) * size);
        const mean = subset.reduce((a, b) => a + b, 0) / subset.length;
        const deviations = subset.map(r => r - mean);
        
        let cumSum = 0;
        const cumDeviations: number[] = [];
        for (const d of deviations) {
          cumSum += d;
          cumDeviations.push(cumSum);
        }
        
        const range = Math.max(...cumDeviations) - Math.min(...cumDeviations);
        const stdDev = Math.sqrt(subset.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / subset.length);
        
        if (stdDev > 0) {
          totalRS += range / stdDev;
        }
      }

      const avgRS = totalRS / numSubsets;
      if (avgRS > 0) {
        rsValues.push({ logN: Math.log(size), logRS: Math.log(avgRS) });
      }
    }

    if (rsValues.length < 2) {
      return {
        exponent: 0.5,
        interpretation: 'random_walk',
        confidence: 30,
        tradingImplication: 'Unable to calculate Hurst - treating as random walk',
      };
    }

    const sumX = rsValues.reduce((s, p) => s + p.logN, 0);
    const sumY = rsValues.reduce((s, p) => s + p.logRS, 0);
    const sumXY = rsValues.reduce((s, p) => s + p.logN * p.logRS, 0);
    const sumX2 = rsValues.reduce((s, p) => s + p.logN * p.logN, 0);
    const count = rsValues.length;

    const slope = (count * sumXY - sumX * sumY) / (count * sumX2 - sumX * sumX);
    const hurst = Math.max(0, Math.min(1, slope));

    let interpretation: 'trending' | 'mean_reverting' | 'random_walk';
    let tradingImplication: string;
    let confidence: number;

    if (hurst > 0.6) {
      interpretation = 'trending';
      tradingImplication = 'Strong trend persistence - follow momentum, use trend-following strategies';
      confidence = Math.min(95, 60 + (hurst - 0.5) * 70);
    } else if (hurst < 0.4) {
      interpretation = 'mean_reverting';
      tradingImplication = 'Mean-reverting behavior - fade extremes, use RSI oversold/overbought';
      confidence = Math.min(95, 60 + (0.5 - hurst) * 70);
    } else {
      interpretation = 'random_walk';
      tradingImplication = 'No clear pattern - reduce position size, wait for regime change';
      confidence = 40 + Math.abs(0.5 - hurst) * 40;
    }

    return { exponent: hurst, interpretation, confidence, tradingImplication };
  } catch (error) {
    logger.error('[PATTERN] Hurst calculation error:', error);
    return {
      exponent: 0.5,
      interpretation: 'random_walk',
      confidence: 0,
      tradingImplication: 'Error calculating Hurst exponent',
    };
  }
}

/**
 * Detect harmonic patterns (Gartley, Butterfly, Crab, Bat)
 */
export function detectHarmonicPatterns(bars: PriceBar[]): HarmonicPattern[] {
  if (bars.length < 50) return [];

  const patterns: HarmonicPattern[] = [];
  
  try {
    const pivots = findPivotPoints(bars);
    if (pivots.length < 5) return [];

    for (let i = 0; i <= pivots.length - 5; i++) {
      const [X, A, B, C, D] = pivots.slice(i, i + 5);
      
      const XA = Math.abs(A.price - X.price);
      const AB = Math.abs(B.price - A.price);
      const BC = Math.abs(C.price - B.price);
      const CD = Math.abs(D.price - C.price);

      if (XA === 0) continue;

      const ratioAB = AB / XA;
      const ratioBC = BC / AB;
      const ratioCD = CD / BC;

      for (const [key, pattern] of Object.entries(HARMONIC_PATTERNS)) {
        const tolerance = 0.15;
        
        const abMatch = ratioAB >= pattern.AB.min - tolerance && ratioAB <= pattern.AB.max + tolerance;
        const bcMatch = ratioBC >= pattern.BC.min - tolerance && ratioBC <= pattern.BC.max + tolerance;
        const cdMatch = ratioCD >= pattern.CD.min - tolerance && ratioCD <= pattern.CD.max + tolerance;

        if (abMatch && bcMatch && cdMatch) {
          const isBullish = D.price < X.price && A.price > X.price;
          const currentPrice = bars[bars.length - 1].close;
          
          const completionPercent = calculatePatternCompletion(X, A, B, C, D, currentPrice);
          
          const przRange = {
            low: D.price * 0.98,
            high: D.price * 1.02,
          };

          const priceTarget = isBullish 
            ? D.price + (XA * 0.618)
            : D.price - (XA * 0.618);
          
          const stopLoss = isBullish
            ? D.price - (XA * 0.236)
            : D.price + (XA * 0.236);

          patterns.push({
            name: pattern.name,
            type: isBullish ? 'bullish' : 'bearish',
            completionPercent,
            priceTarget,
            stopLoss,
            potentialReversalZone: przRange,
            fibRatios: { XA: 1, AB: ratioAB, BC: ratioBC, CD: ratioCD },
            confidence: Math.min(90, 60 + (100 - Math.abs(completionPercent - 100)) * 0.3),
          });
        }
      }
    }

    return patterns.slice(0, 3);
  } catch (error) {
    logger.error('[PATTERN] Harmonic pattern detection error:', error);
    return [];
  }
}

function findPivotPoints(bars: PriceBar[]): { price: number; index: number; type: 'high' | 'low' }[] {
  const pivots: { price: number; index: number; type: 'high' | 'low' }[] = [];
  const lookback = 5;

  for (let i = lookback; i < bars.length - lookback; i++) {
    const current = bars[i];
    let isHigh = true;
    let isLow = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].high >= current.high) isHigh = false;
      if (bars[j].low <= current.low) isLow = false;
    }

    if (isHigh) {
      pivots.push({ price: current.high, index: i, type: 'high' });
    } else if (isLow) {
      pivots.push({ price: current.low, index: i, type: 'low' });
    }
  }

  return pivots;
}

function calculatePatternCompletion(
  X: { price: number },
  A: { price: number },
  B: { price: number },
  C: { price: number },
  D: { price: number },
  currentPrice: number
): number {
  const totalMove = Math.abs(X.price - D.price);
  const currentMove = Math.abs(X.price - currentPrice);
  
  if (totalMove === 0) return 0;
  
  return Math.min(100, (currentMove / totalMove) * 100);
}

/**
 * Elliott Wave Analysis
 */
export function analyzeElliottWaves(bars: PriceBar[]): ElliottWaveAnalysis | null {
  if (bars.length < 100) return null;

  try {
    const pivots = findPivotPoints(bars);
    if (pivots.length < 5) return null;

    const recentPivots = pivots.slice(-8);
    
    let upMoves = 0;
    let downMoves = 0;
    
    for (let i = 1; i < recentPivots.length; i++) {
      if (recentPivots[i].price > recentPivots[i - 1].price) {
        upMoves++;
      } else {
        downMoves++;
      }
    }

    const isImpulse = upMoves >= 3 || downMoves >= 3;
    const waveType = isImpulse ? 'impulse' : 'corrective';
    
    let currentWave = 1;
    let completionPercent = 20;
    
    if (recentPivots.length >= 3) {
      const recentTrend = recentPivots[recentPivots.length - 1].price > recentPivots[0].price;
      
      if (isImpulse) {
        if (recentPivots.length >= 5) {
          currentWave = 5;
          completionPercent = 90;
        } else if (recentPivots.length >= 3) {
          currentWave = 3;
          completionPercent = 60;
        }
      } else {
        currentWave = recentPivots.length >= 3 ? 3 : 1;
        completionPercent = currentWave * 33;
      }
    }

    const lastPrice = bars[bars.length - 1].close;
    const firstPivot = recentPivots[0]?.price || lastPrice;
    const range = Math.abs(lastPrice - firstPivot);

    const projections: { wave3?: number; wave5?: number; waveC?: number } = {};
    
    if (waveType === 'impulse') {
      projections.wave3 = lastPrice + range * 1.618;
      projections.wave5 = lastPrice + range * 2.618;
    } else {
      projections.waveC = lastPrice - range * 0.618;
    }

    return {
      currentWave,
      waveType,
      nextWaveDirection: upMoves > downMoves ? 'up' : 'down',
      completionPercent,
      priceProjections: projections,
      confidence: Math.min(80, 40 + recentPivots.length * 5),
    };
  } catch (error) {
    logger.error('[PATTERN] Elliott wave analysis error:', error);
    return null;
  }
}

/**
 * Calculate Fibonacci retracement and extension levels
 */
export function calculateFibonacciLevels(bars: PriceBar[]): FibonacciLevels {
  if (bars.length < 20) {
    return {
      retracements: [],
      extensions: [],
      pivotHigh: 0,
      pivotLow: 0,
    };
  }

  try {
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    
    const pivotHigh = Math.max(...highs);
    const pivotLow = Math.min(...lows);
    const range = pivotHigh - pivotLow;

    const retracementLevels = [0.236, 0.382, 0.5, 0.618, 0.786];
    const extensionLevels = [1.0, 1.272, 1.618, 2.0, 2.618];

    const retracements = retracementLevels.map(level => ({
      level,
      price: pivotHigh - (range * level),
      strength: FIB_RATIOS[level as keyof typeof FIB_RATIOS] || 'moderate',
    }));

    const extensions = extensionLevels.map(level => ({
      level,
      price: pivotLow + (range * level),
      strength: FIB_RATIOS[level as keyof typeof FIB_RATIOS] || 'moderate',
    }));

    return { retracements, extensions, pivotHigh, pivotLow };
  } catch (error) {
    logger.error('[PATTERN] Fibonacci calculation error:', error);
    return { retracements: [], extensions: [], pivotHigh: 0, pivotLow: 0 };
  }
}

/**
 * Generate comprehensive pattern prediction for a symbol
 */
export async function generatePatternPrediction(
  symbol: string,
  bars: PriceBar[]
): Promise<PatternPrediction> {
  const prices = bars.map(b => b.close);
  
  const hurst = calculateHurstExponent(prices);
  const harmonicPatterns = detectHarmonicPatterns(bars);
  const elliottWave = analyzeElliottWaves(bars);
  const fibonacci = calculateFibonacciLevels(bars);

  let bullishSignals = 0;
  let bearishSignals = 0;
  let totalWeight = 0;

  if (hurst.interpretation === 'trending') {
    const lastPrice = bars[bars.length - 1].close;
    const firstPrice = bars[0].close;
    if (lastPrice > firstPrice) {
      bullishSignals += 2;
    } else {
      bearishSignals += 2;
    }
    totalWeight += 2;
  }

  for (const pattern of harmonicPatterns) {
    if (pattern.completionPercent > 80) {
      if (pattern.type === 'bullish') {
        bullishSignals += 1.5;
      } else {
        bearishSignals += 1.5;
      }
      totalWeight += 1.5;
    }
  }

  if (elliottWave) {
    if (elliottWave.nextWaveDirection === 'up') {
      bullishSignals += 1;
    } else {
      bearishSignals += 1;
    }
    totalWeight += 1;
  }

  let overallSignal: PatternPrediction['overallSignal'] = 'neutral';
  if (totalWeight > 0) {
    const netScore = (bullishSignals - bearishSignals) / totalWeight;
    if (netScore > 0.6) overallSignal = 'strong_bullish';
    else if (netScore > 0.2) overallSignal = 'bullish';
    else if (netScore < -0.6) overallSignal = 'strong_bearish';
    else if (netScore < -0.2) overallSignal = 'bearish';
  }

  const confidenceScore = Math.round(
    (hurst.confidence * 0.3) +
    (harmonicPatterns.length > 0 ? harmonicPatterns[0].confidence * 0.4 : 40) +
    (elliottWave ? elliottWave.confidence * 0.3 : 30)
  );

  const tradingRecommendation = generateTradingRecommendation(
    hurst,
    harmonicPatterns,
    elliottWave,
    overallSignal
  );

  return {
    symbol,
    timestamp: new Date().toISOString(),
    hurst,
    harmonicPatterns,
    elliottWave,
    fibonacci,
    overallSignal,
    confidenceScore,
    tradingRecommendation,
  };
}

function generateTradingRecommendation(
  hurst: HurstResult,
  patterns: HarmonicPattern[],
  elliott: ElliottWaveAnalysis | null,
  signal: PatternPrediction['overallSignal']
): string {
  const parts: string[] = [];

  if (hurst.interpretation === 'trending') {
    parts.push(`Trending market (H=${hurst.exponent.toFixed(2)}) - favor trend-following entries`);
  } else if (hurst.interpretation === 'mean_reverting') {
    parts.push(`Mean-reverting (H=${hurst.exponent.toFixed(2)}) - fade extremes, use RSI divergences`);
  }

  if (patterns.length > 0) {
    const topPattern = patterns[0];
    parts.push(`${topPattern.name} ${topPattern.type} pattern ${topPattern.completionPercent.toFixed(0)}% complete - PRZ: $${topPattern.potentialReversalZone.low.toFixed(2)}-$${topPattern.potentialReversalZone.high.toFixed(2)}`);
  }

  if (elliott) {
    parts.push(`Elliott Wave ${elliott.currentWave} (${elliott.waveType}) - expect ${elliott.nextWaveDirection} movement`);
  }

  if (parts.length === 0) {
    return 'No clear pattern signals - wait for setup confirmation';
  }

  return parts.join('. ');
}

export const PatternPredictor = {
  calculateHurstExponent,
  detectHarmonicPatterns,
  analyzeElliottWaves,
  calculateFibonacciLevels,
  generatePatternPrediction,
};
