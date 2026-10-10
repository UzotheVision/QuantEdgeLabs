/**
 * INTRADAY SCANNER — Pattern Detectors
 * ======================================
 * Pure functions over OHLC data that return scored setups.
 *
 *   detectBullFlag       — pole + flag pattern (Qullamaggie-style)
 *   detectBreakout20d    — close > 20d high on above-avg volume
 *   detectGapAndGo       — opening gap held + trend up
 *
 * No I/O — caller supplies OHLC. Keeps detectors testable in isolation.
 */

import type { ExtendedGrade } from '@shared/thesis-radar-types';
import { scoreToExtendedGrade } from '../thesis-radar/conviction-agent';

interface OHLCBar {
  date?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function maxIn(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return Math.max(...values.slice(-period));
}

function pctChange(curr: number, prev: number): number {
  if (prev === 0) return 0;
  return ((curr - prev) / prev) * 100;
}

// ─── Bull Flag detector ────────────────────────────────────────────

export interface BullFlagResult {
  pattern: 'bull_flag';
  score: number;
  grade: ExtendedGrade;
  metrics: {
    poleStartIdx: number;
    poleEndIdx: number;
    poleGainPct: number;
    flagLowPct: number;
    flagBars: number;
    consolidationRangePct: number;
    breakoutLevel: number;
  };
}

/**
 * Bull flag = sharp upward move (the pole) followed by tight consolidation
 * (the flag). Looking for:
 *   - Pole: ≥15% gain over 5-15 days
 *   - Flag: 3-10 bar pullback with ≤8% retracement
 *   - Flag range ≤6% (tight consolidation)
 *   - Currently within 2% of flag highs (about to break)
 */
export function detectBullFlag(bars: OHLCBar[]): BullFlagResult | null {
  if (bars.length < 25) return null;

  // Look for the pole: scan back 5-15 bars and find the biggest sustained move
  let bestPole = { startIdx: -1, endIdx: -1, gainPct: 0 };
  const N = bars.length;
  for (let poleBars = 5; poleBars <= 15; poleBars++) {
    for (let endOffset = 3; endOffset <= 12; endOffset++) {
      const endIdx = N - 1 - endOffset;
      const startIdx = endIdx - poleBars;
      if (startIdx < 0) continue;
      const gain = pctChange(bars[endIdx].close, bars[startIdx].close);
      if (gain > bestPole.gainPct) {
        bestPole = { startIdx, endIdx, gainPct: gain };
      }
    }
  }
  if (bestPole.gainPct < 15) return null; // need real pole

  // Flag = bars from poleEnd to current
  const flagBars = N - 1 - bestPole.endIdx;
  if (flagBars < 3 || flagBars > 12) return null;

  const flagSlice = bars.slice(bestPole.endIdx, N);
  const flagHigh = Math.max(...flagSlice.map(b => b.high));
  const flagLow = Math.min(...flagSlice.map(b => b.low));
  const flagRange = pctChange(flagHigh, flagLow);
  if (flagRange > 8) return null; // too wide = not a flag

  const flagLowPct = pctChange(bars[N - 1].close, bars[bestPole.endIdx].close);
  if (flagLowPct < -10) return null; // gave back too much

  // Currently within 2% of flag high = setup ripe
  const distanceToBreak = pctChange(flagHigh, bars[N - 1].close);
  if (distanceToBreak < 0) return null; // already broke out
  if (distanceToBreak > 3) return null; // not ripe yet

  // Score: bigger pole + tighter flag + closer to breakout = higher
  let score = 50;
  score += Math.min(25, bestPole.gainPct * 0.8);    // up to +25 for pole
  score += (8 - flagRange) * 3;                     // up to +24 for tight flag
  score += (3 - distanceToBreak) * 5;               // up to +15 for ripeness
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    pattern: 'bull_flag',
    score,
    grade: scoreToExtendedGrade(score),
    metrics: {
      poleStartIdx: bestPole.startIdx,
      poleEndIdx: bestPole.endIdx,
      poleGainPct: bestPole.gainPct,
      flagLowPct,
      flagBars,
      consolidationRangePct: flagRange,
      breakoutLevel: flagHigh,
    },
  };
}

// ─── 20-Day Breakout ───────────────────────────────────────────────

export interface BreakoutResult {
  pattern: 'breakout_20d';
  score: number;
  grade: ExtendedGrade;
  metrics: {
    breakoutLevel: number;
    daysSinceLastHigh: number;
    pctAboveLevel: number;
    volumeRatio: number;
    rsi14: number;
  };
}

/**
 * 20-day breakout = close ABOVE the 20-day high on above-average volume.
 * Qullamaggie's classic momentum entry.
 */
export function detectBreakout20d(bars: OHLCBar[]): BreakoutResult | null {
  if (bars.length < 25) return null;

  const N = bars.length;
  const current = bars[N - 1];
  // 20-day high of the prior 20 bars (excluding today)
  const prior20Highs = bars.slice(N - 21, N - 1).map(b => b.high);
  const prior20High = Math.max(...prior20Highs);
  if (current.close <= prior20High) return null; // not a breakout

  // Volume confirmation: current vol vs 20-day average
  const avgVol20 = bars
    .slice(N - 21, N - 1)
    .map(b => b.volume ?? 0)
    .reduce((a, b) => a + b, 0) / 20;
  const volRatio = avgVol20 > 0 ? (current.volume ?? 0) / avgVol20 : 1;
  if (volRatio < 1.2) return null; // weak breakout — skip

  // RSI for context
  const closes = bars.map(b => b.close);
  let gains = 0, losses = 0;
  for (let i = N - 14; i < N; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) gains += ch; else losses -= ch;
  }
  const rsi = 100 - 100 / (1 + gains / (losses || 1));

  // Days since prior 20-high (how long it took to break)
  let daysSinceLastHigh = 0;
  for (let i = N - 2; i >= 0; i--) {
    if (bars[i].high >= prior20High) { daysSinceLastHigh = N - 1 - i; break; }
  }

  const pctAbove = pctChange(current.close, prior20High);

  // Score: bigger volume + cleaner RSI + larger breakout %
  let score = 60;
  if (volRatio >= 2.0) score += 15;
  else if (volRatio >= 1.5) score += 8;
  if (rsi >= 55 && rsi <= 70) score += 12;
  else if (rsi > 75) score -= 8;     // overbought = late
  if (pctAbove >= 2) score += 10;
  else if (pctAbove >= 1) score += 5;
  if (daysSinceLastHigh >= 10) score += 5; // longer base = better breakout
  score = Math.max(0, Math.min(100, score));

  return {
    pattern: 'breakout_20d',
    score,
    grade: scoreToExtendedGrade(score),
    metrics: {
      breakoutLevel: prior20High,
      daysSinceLastHigh,
      pctAboveLevel: pctAbove,
      volumeRatio: volRatio,
      rsi14: rsi,
    },
  };
}

// ─── Gap-and-Go ────────────────────────────────────────────────────

export interface GapAndGoResult {
  pattern: 'gap_and_go';
  score: number;
  grade: ExtendedGrade;
  metrics: {
    gapPct: number;
    intradayPct: number;
    closeAboveOpen: boolean;
  };
}

/**
 * Gap-and-go = opens >3% above prior close AND closes near intraday high
 * (i.e. didn't fill the gap). Reserved for next-day continuation play.
 */
export function detectGapAndGo(bars: OHLCBar[]): GapAndGoResult | null {
  if (bars.length < 2) return null;
  const N = bars.length;
  const today = bars[N - 1];
  const yest = bars[N - 2];

  const gapPct = pctChange(today.open, yest.close);
  if (gapPct < 3) return null;

  const intradayPct = pctChange(today.close, today.open);
  const range = today.high - today.low;
  const distFromHigh = range > 0 ? (today.high - today.close) / range : 1;
  if (distFromHigh > 0.3) return null; // closed too far from high

  let score = 60;
  score += Math.min(20, gapPct * 2);
  if (intradayPct > 0) score += 10;
  if (distFromHigh < 0.1) score += 10;
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    pattern: 'gap_and_go',
    score,
    grade: scoreToExtendedGrade(score),
    metrics: {
      gapPct,
      intradayPct,
      closeAboveOpen: today.close >= today.open,
    },
  };
}
