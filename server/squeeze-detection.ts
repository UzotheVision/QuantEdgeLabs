/**
 * Bollinger Band Squeeze Detection
 * =================================
 * Reusable module for detecting volatility coils (Bollinger squeezes)
 * across any ticker. Extracted from index-lotto-scanner.ts.
 *
 * A squeeze = bands tightening = big move coming (direction unknown).
 * The tighter the coil, the more explosive the breakout.
 */

import { logger } from './logger';

export interface SqueezeResult {
  isSqueezing: boolean;
  strength: number;       // 0-100
  bandwidth: number;      // Current bandwidth as % of price
  avgBandwidth: number;   // Historical avg bandwidth
  coilRatio: number;      // How much tighter than normal (>1 = squeezing)
  phase: 'building' | 'firing' | 'none';
}

/**
 * Calculate Bollinger Bands for a price series
 */
export function calculateBollingerBandSeries(
  closes: number[],
  period: number = 20,
  stdDev: number = 2.0
): { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[] } {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const std = Math.sqrt(variance);

    const u = mean + stdDev * std;
    const l = mean - stdDev * std;
    upper.push(u);
    middle.push(mean);
    lower.push(l);
    bandwidth.push(mean > 0 ? ((u - l) / mean) * 100 : 0);
  }

  return { upper, middle, lower, bandwidth };
}

/**
 * Calculate bandwidth as percentage of price
 */
export function calculateBandwidth(upper: number, lower: number, middle: number): number {
  if (middle <= 0) return 0;
  return ((upper - lower) / middle) * 100;
}

/**
 * Detect Bollinger squeeze from band series
 * Compares recent bandwidth to historical average
 */
export function detectBollingerSqueeze(
  bbands: { upper: number[]; middle: number[]; lower: number[] },
  recentBars: number = 5,
  historicalBars: number = 15
): SqueezeResult {
  const minLen = recentBars + historicalBars;
  if (bbands.upper.length < minLen) {
    return { isSqueezing: false, strength: 0, bandwidth: 0, avgBandwidth: 0, coilRatio: 0, phase: 'none' };
  }

  // Recent bandwidth (last N bars)
  const recentWidth = bbands.upper.slice(-recentBars).map((u, i) =>
    u - bbands.lower.slice(-recentBars)[i]
  );
  const recentMiddle = bbands.middle.slice(-recentBars);
  const avgRecentWidth = recentWidth.reduce((a, b) => a + b, 0) / recentWidth.length;
  const avgRecentMiddle = recentMiddle.reduce((a, b) => a + b, 0) / recentMiddle.length;

  // Historical bandwidth (N bars before recent)
  const histWidth = bbands.upper.slice(-minLen, -recentBars).map((u, i) =>
    u - bbands.lower.slice(-minLen, -recentBars)[i]
  );
  const avgHistWidth = histWidth.reduce((a, b) => a + b, 0) / histWidth.length;

  // Coil ratio: how much tighter than historical
  const coilRatio = avgHistWidth > 0 ? avgHistWidth / avgRecentWidth : 0;
  const isSqueezing = coilRatio > 1.3;

  // Current bandwidth as % of price
  const currentBandwidth = avgRecentMiddle > 0 ? (avgRecentWidth / avgRecentMiddle) * 100 : 0;
  const avgBandwidth = avgRecentMiddle > 0 ? (avgHistWidth / avgRecentMiddle) * 100 : 0;

  // Phase detection
  let phase: SqueezeResult['phase'] = 'none';
  if (isSqueezing) {
    // Check if bands are starting to expand (firing)
    const lastWidth = recentWidth[recentWidth.length - 1];
    const prevWidth = recentWidth[recentWidth.length - 2] || lastWidth;
    phase = lastWidth > prevWidth * 1.05 ? 'firing' : 'building';
  }

  // Strength: 0-100 based on how tight the coil is
  const strength = isSqueezing ? Math.min(95, Math.round(50 + (coilRatio - 1) * 30)) : 0;

  return {
    isSqueezing,
    strength,
    bandwidth: +currentBandwidth.toFixed(2),
    avgBandwidth: +avgBandwidth.toFixed(2),
    coilRatio: +coilRatio.toFixed(2),
    phase,
  };
}

/**
 * Quick classify: is this ticker in a squeeze?
 */
export function classifySqueeze(
  closes: number[],
  period: number = 20,
  stdDev: number = 2.0
): SqueezeResult {
  const bbands = calculateBollingerBandSeries(closes, period, stdDev);
  return detectBollingerSqueeze(bbands);
}

logger.info('[SQUEEZE] Squeeze detection module loaded');
