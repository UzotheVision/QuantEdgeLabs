/**
 * GAP-AWARE EXITS — take the gain before the magnet pulls it back.
 *
 * The bot held MARA $11C from +159% down to +74% in a few hours. The information
 * needed to act was already computed and simply never consulted: MARA had an
 * unfilled gap at $9.96, and MARA fills 100% of its past gaps, typically within
 * two sessions. Price was extended, a high-confidence downside magnet sat below,
 * and the exit logic only knew about a static premium stop and target.
 *
 * This adds the missing link. Two decisions, both mechanical:
 *
 *   SCALE OUT — the position is meaningfully green, the underlying is extended,
 *   and an unfilled gap sits below with a fill rate this ticker actually honours.
 *   That is the moment to bank rather than to hope.
 *
 *   RE-ENTRY WATCH — once that gap fills, the magnet is gone and the reason for
 *   leaving no longer applies. The name goes back on the list.
 *
 * Deliberately conservative about what counts as evidence. A gap only argues for
 * an exit when the ticker has ENOUGH history to have earned its fill rate; a name
 * with three prior gaps tells you nothing, however clean those three were.
 */
import { logger } from './logger';
import { analyzeGaps, type Bar } from '@shared/gap-engine';

/** Minimum completed gaps before a fill rate means anything. */
const MIN_SAMPLES = 8;
/** Fill rate at or above this is treated as a real tendency for the name. */
const STRONG_FILL_RATE = 0.75;
/** Only bank a position that is actually worth banking. */
const MIN_GAIN_PCT = 40;
/** A gap further away than this is not a near-term threat to the trade. */
const MAX_GAP_DISTANCE_PCT = 15;

export interface GapExitSignal {
  action: 'scale_out' | 'hold';
  reason: string;
  gapLevel: number | null;
  gapDistancePct: number | null;
  fillRate: number | null;
  medianSessionsToFill: number | null;
}

/**
 * Should an open, profitable option position be trimmed because a gap below is
 * likely to pull the underlying back?
 *
 * `gainPct` is the position's gain on PREMIUM, not the underlying move — a
 * contract can be up 150% on a 6% stock move, and it is the contract that is
 * being risked back.
 */
export function evaluateGapExit(
  bars: Bar[],
  gainPct: number,
  direction: 'long' | 'short' = 'long',
): GapExitSignal {
  const hold = (reason: string): GapExitSignal => ({
    action: 'hold', reason, gapLevel: null, gapDistancePct: null, fillRate: null, medianSessionsToFill: null,
  });

  if (gainPct < MIN_GAIN_PCT) return hold(`Only ${gainPct.toFixed(0)}% up — not enough to bank`);

  const report = analyzeGaps(bars);
  if (!report) return hold('Not enough price history to read gaps');

  const { stats } = report;
  if (stats.total < MIN_SAMPLES || stats.fillRate == null) {
    return hold(`Only ${stats.total} completed gaps — fill rate has not earned trust`);
  }
  if (stats.fillRate < STRONG_FILL_RATE) {
    return hold(`Fills only ${(stats.fillRate * 100).toFixed(0)}% of gaps — not a reliable magnet`);
  }

  // A long call is threatened by a gap BELOW; a long put by one above.
  const threat = direction === 'long' ? report.nearestBelow : report.nearestAbove;
  if (!threat || threat.distancePct == null) return hold('No unfilled gap on the threatening side');

  const dist = Math.abs(threat.distancePct);
  if (dist > MAX_GAP_DISTANCE_PCT) {
    return hold(`Nearest gap is ${dist.toFixed(1)}% away — not a near-term threat`);
  }

  return {
    action: 'scale_out',
    reason:
      `Up ${gainPct.toFixed(0)}% with an unfilled gap ${dist.toFixed(1)}% ${direction === 'long' ? 'below' : 'above'} ` +
      `at $${threat.nearEdge.toFixed(2)}. This name has filled ${(stats.fillRate * 100).toFixed(0)}% of ` +
      `${stats.total} past gaps, typically in ${stats.medianBarsToFill ?? '—'} sessions.`,
    gapLevel: threat.nearEdge,
    gapDistancePct: threat.distancePct,
    fillRate: stats.fillRate,
    medianSessionsToFill: stats.medianBarsToFill,
  };
}

export interface ReEntrySignal {
  ready: boolean;
  reason: string;
}

/**
 * Has the gap that caused an exit since filled? If so the reason for leaving is
 * gone and the name is a re-entry candidate — which is the other half of the
 * trade the bot was missing. It does NOT assert the setup is good again; the
 * conviction engine still has to publish a signal. This only clears the block.
 */
export function checkGapFilled(bars: Bar[], exitGapLevel: number, direction: 'long' | 'short' = 'long'): ReEntrySignal {
  const report = analyzeGaps(bars);
  if (!report) return { ready: false, reason: 'No price history' };

  const stillOpen = report.unfilled.some(
    (g) => Math.abs(Math.min(g.from, g.to) - exitGapLevel) < 0.01 || Math.abs(Math.max(g.from, g.to) - exitGapLevel) < 0.01,
  );

  if (stillOpen) {
    const away = ((exitGapLevel - report.spot) / report.spot) * 100;
    return { ready: false, reason: `Gap at $${exitGapLevel.toFixed(2)} still open, ${Math.abs(away).toFixed(1)}% away` };
  }

  return {
    ready: true,
    reason: `Gap at $${exitGapLevel.toFixed(2)} has filled — the reason for exiting is gone. Re-entry needs a fresh signal.`,
  };
}

/** Convenience for logging a decision without duplicating the format. */
export function describeGapExit(symbol: string, s: GapExitSignal): string {
  return `[GAP-EXIT] ${symbol}: ${s.action.toUpperCase()} — ${s.reason}`;
}

/* ─────────────────────────────────────────────────────────────────────────
   RE-ENTRY WATCH

   Held in memory rather than a table: the watch only matters for as long as the
   gap is open, it is rebuilt from position history on restart, and a schema
   migration for a list that is usually empty is the wrong trade. If this grows
   past a handful of names it should move to the database.
   ───────────────────────────────────────────────────────────────────────── */

let _gapWatch: { symbol: string; level: number; since: number }[] = [];

export async function setBotGapWatch(entries: { symbol: string; level: number }[]): Promise<void> {
  const now = Date.now();
  for (const e of entries) {
    if (!e.symbol || !(e.level > 0)) continue;
    if (_gapWatch.some((w) => w.symbol === e.symbol && Math.abs(w.level - e.level) < 0.01)) continue;
    _gapWatch.push({ ...e, since: now });
  }
}

export function getBotGapWatch(): { symbol: string; level: number; since: number }[] {
  return [..._gapWatch];
}

/** Drop a watch once its gap has filled — the block is cleared. */
export function clearGapWatch(symbol: string, level: number): void {
  _gapWatch = _gapWatch.filter((w) => !(w.symbol === symbol && Math.abs(w.level - level) < 0.01));
}
