/**
 * INTRADAY SCANNER — Shared Types
 * =================================
 * Three real-time setup detectors that complement Thesis Radar
 * (which is more strategic / multi-day) by surfacing intraday plays.
 *
 *   1. Bull Flag         — 3-7 day pullback after a strong move, low-vol consolidation
 *   2. 20-Day Breakout   — close above 20-day high on above-average volume
 *   3. Unusual Flow      — aggregates options-flow-scanner output, ranks by score
 *
 * Output: rankable list of tickers with grade + setup data + suggested action.
 */

import type { ExtendedGrade } from './thesis-radar-types';

export type IntradayPattern = 'bull_flag' | 'breakout_20d' | 'unusual_flow';

export interface IntradaySetup {
  /** Unique ID for this detection */
  id: string;
  /** Pattern detected */
  pattern: IntradayPattern;
  /** Symbol */
  symbol: string;
  /** Spot at detection */
  spot: number;
  /** When detected */
  detectedAt: string;
  /** Letter grade A+ → F */
  grade: ExtendedGrade;
  /** Numeric score 0-100 */
  score: number;
  /** Pattern-specific data */
  metrics: Record<string, number | string | boolean>;
  /** Human-readable summary */
  summary: string;
  /** Suggested trade direction */
  direction: 'long' | 'short' | 'neutral';
  /** Optional suggested entry / stop / target */
  plan?: {
    entry?: number;
    stop?: number;
    target?: number;
  };
  /** Whether ticker is on user's watchlist */
  onWatchlist?: boolean;
}

export interface IntradayScanResult {
  pattern: IntradayPattern;
  asOf: string;
  /** Sorted by score desc */
  setups: IntradaySetup[];
  summary: {
    totalScanned: number;
    setupsFound: number;
    averageScore: number;
  };
}
