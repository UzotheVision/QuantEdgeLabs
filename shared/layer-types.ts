/**
 * Shared types for the Layer Cycle Engine — server computes, client consumes.
 */

export type CycleStage = 'pre' | 'early' | 'mid' | 'late' | 'topped' | 'rolling' | 'unknown';

export interface TickerSnapshot {
  symbol: string;
  cap: 'mega' | 'large' | 'mid' | 'small' | 'micro';
  spot: number;
  ret5d: number;
  ret20d: number;
  ret60d: number;
  /** % above 50dma — 1 = above, 0 = below (computed per ticker, then averaged for breadth) */
  above50dma: 0 | 1;
  above200dma: 0 | 1;
  /** Relative strength vs SPY over last 60d (negative = underperforming) */
  rs60d: number;
}

export interface LayerMetrics {
  /** Avg returns across all tickers in layer */
  avgRet5d: number;
  avgRet20d: number;
  avgRet60d: number;
  /** % of tickers above 50/200 dma */
  breadth50: number;
  breadth200: number;
  /** Layer's avg RS vs SPY */
  rsVsSpy60d: number;
  /** Mean(small_ret) - Mean(mega_ret) — POSITIVE = small-caps leading = broadening = late-cycle */
  smallVsMegaSpread20d: number;
  /** Tickers in layer that have data */
  tickerCount: number;
  /** Names with data */
  topMovers: TickerSnapshot[];
}

export interface LayerCycle {
  id: string;
  label: string;
  description: string;
  derivativeOrder: 1 | 2 | 3;
  rank: number;
  stage: CycleStage;
  /** "Why" string — e.g. "breadth 71%, broadening" */
  stageReason: string;
  metrics: LayerMetrics;
  /** ISO timestamp this snapshot was computed */
  computedAt: string;
}

export interface LayerCycleResponse {
  layers: LayerCycle[];
  /** Snapshot date */
  asOf: string;
  /** Total tickers scanned */
  tickersScanned: number;
  /** Time taken */
  durationMs: number;
}

export interface LayerTransition {
  layerId: string;
  layerLabel: string;
  fromStage: CycleStage;
  toStage: CycleStage;
  detectedAt: string;
  /** "rotation type" classification */
  kind: 'heating' | 'cooling' | 'broadening' | 'topping' | 'reset';
}

// ─── Pure helpers (used both server + client) ──────────────────────

/** Cycle-stage classifier — snapshot rules, no historical comparison needed. */
export function classifyStage(m: LayerMetrics): { stage: CycleStage; reason: string } {
  if (m.tickerCount === 0) return { stage: 'unknown', reason: 'no data' };

  const breadth = m.breadth50 * 100;
  const ret20 = m.avgRet20d;
  const ret5 = m.avgRet5d;
  const spread = m.smallVsMegaSpread20d;
  const rs = m.rsVsSpy60d;

  // ROLLING — broad weakness
  if (breadth < 35 && ret20 < -2) {
    return { stage: 'rolling', reason: `breadth ${breadth.toFixed(0)}%, 20d ${ret20.toFixed(1)}%` };
  }

  // TOPPED — high breadth but mega-caps weaker than small-caps for too long
  // (spread positive AND ret5 negative = small still up, big leading down)
  if (breadth > 65 && ret5 < 0 && spread > 1) {
    return { stage: 'topped', reason: `breadth ${breadth.toFixed(0)}%, 5d cooling (${ret5.toFixed(1)}%)` };
  }

  // LATE / BROADENING — high breadth + small-caps outperforming megas (the tell)
  if (breadth > 65 && spread > 1.5) {
    return { stage: 'late', reason: `breadth ${breadth.toFixed(0)}%, broadening (small +${spread.toFixed(1)}% vs mega)` };
  }

  // MID — high breadth, mega-led
  if (breadth > 50 && ret20 > 2) {
    return { stage: 'mid', reason: `breadth ${breadth.toFixed(0)}%, 20d +${ret20.toFixed(1)}%` };
  }

  // EARLY — breadth turning, modest gains
  if (breadth >= 30 && breadth <= 65 && ret20 > 0) {
    return { stage: 'early', reason: `breadth ${breadth.toFixed(0)}%, 20d +${ret20.toFixed(1)}%, RS ${rs >= 0 ? '+' : ''}${rs.toFixed(1)}` };
  }

  // PRE — flat / inactive
  return { stage: 'pre', reason: `breadth ${breadth.toFixed(0)}%, 20d ${ret20 >= 0 ? '+' : ''}${ret20.toFixed(1)}%` };
}

export const STAGES: CycleStage[] = ['pre', 'early', 'mid', 'late', 'topped', 'rolling'];
