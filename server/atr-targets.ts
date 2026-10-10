/**
 * ATR-Based Target/Stop Calculator
 * =================================
 * Replaces fixed % targets (3%/8%) across all scanners.
 * Uses Average True Range for dynamic, volatility-aware levels.
 */

import { calculateATR } from './technical-indicators';

export interface ATRTargets {
  target: number;
  stop: number;
  riskRewardRatio: number;
  atr: number;
  targetPct: number;
  stopPct: number;
}

type HoldingPeriod = 'day' | 'swing' | 'position';

// ATR multipliers by holding period
const MULTIPLIERS: Record<HoldingPeriod, { target: number; stop: number }> = {
  day:      { target: 1.5, stop: 0.75 },   // 2:1 R:R
  swing:    { target: 2.5, stop: 1.0 },     // 2.5:1 R:R
  position: { target: 4.0, stop: 1.5 },     // 2.67:1 R:R
};

/**
 * Calculate target and stop from ATR
 */
export function calculateATRTargets(params: {
  currentPrice: number;
  highs: number[];
  lows: number[];
  closes: number[];
  direction: 'long' | 'short' | 'bullish' | 'bearish';
  holdingPeriod?: HoldingPeriod;
  atrPeriod?: number;
}): ATRTargets {
  const { currentPrice, highs, lows, closes, atrPeriod = 14 } = params;
  const holdingPeriod = params.holdingPeriod || 'swing';
  const isLong = params.direction === 'long' || params.direction === 'bullish';

  const atr = calculateATR(highs, lows, closes, atrPeriod);

  // Fallback if ATR is 0 or insufficient data
  if (!atr || atr <= 0) {
    const fallbackPct = holdingPeriod === 'day' ? 0.03 : holdingPeriod === 'swing' ? 0.08 : 0.15;
    const stopPct = holdingPeriod === 'day' ? 0.015 : holdingPeriod === 'swing' ? 0.04 : 0.06;
    return {
      target: +(isLong ? currentPrice * (1 + fallbackPct) : currentPrice * (1 - fallbackPct)).toFixed(2),
      stop: +(isLong ? currentPrice * (1 - stopPct) : currentPrice * (1 + stopPct)).toFixed(2),
      riskRewardRatio: +(fallbackPct / stopPct).toFixed(1),
      atr: 0,
      targetPct: +(fallbackPct * 100).toFixed(1),
      stopPct: +(stopPct * 100).toFixed(1),
    };
  }

  const mult = MULTIPLIERS[holdingPeriod];
  const targetMove = atr * mult.target;
  const stopMove = atr * mult.stop;

  const target = isLong ? currentPrice + targetMove : currentPrice - targetMove;
  const stop = isLong ? currentPrice - stopMove : currentPrice + stopMove;
  const rr = stopMove > 0 ? targetMove / stopMove : 2.0;

  return {
    target: +target.toFixed(2),
    stop: +stop.toFixed(2),
    riskRewardRatio: +rr.toFixed(1),
    atr: +atr.toFixed(2),
    targetPct: +((targetMove / currentPrice) * 100).toFixed(1),
    stopPct: +((stopMove / currentPrice) * 100).toFixed(1),
  };
}

/**
 * Simple version when you don't have full OHLC data
 * Estimates ATR from close prices only (less accurate but works)
 */
export function calculateSimpleTargets(params: {
  currentPrice: number;
  closes: number[];
  direction: 'long' | 'short' | 'bullish' | 'bearish';
  holdingPeriod?: HoldingPeriod;
}): ATRTargets {
  const { currentPrice, closes, holdingPeriod = 'swing' } = params;
  const isLong = params.direction === 'long' || params.direction === 'bullish';

  // Estimate volatility from close-to-close changes
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(Math.abs(closes[i] - closes[i - 1]));
  }

  const avgChange = changes.length > 0
    ? changes.reduce((a, b) => a + b, 0) / changes.length
    : currentPrice * 0.02; // 2% fallback

  const mult = MULTIPLIERS[holdingPeriod];
  const targetMove = avgChange * mult.target;
  const stopMove = avgChange * mult.stop;

  const target = isLong ? currentPrice + targetMove : currentPrice - targetMove;
  const stop = isLong ? currentPrice - stopMove : currentPrice + stopMove;
  const rr = stopMove > 0 ? targetMove / stopMove : 2.0;

  return {
    target: +target.toFixed(2),
    stop: +stop.toFixed(2),
    riskRewardRatio: +rr.toFixed(1),
    atr: +avgChange.toFixed(2),
    targetPct: +((targetMove / currentPrice) * 100).toFixed(1),
    stopPct: +((stopMove / currentPrice) * 100).toFixed(1),
  };
}
