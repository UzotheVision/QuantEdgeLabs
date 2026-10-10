/**
 * LADDER PLAN — scale into a thesis instead of betting one price.
 *
 * Reverse-engineered from how the accounts that look uncannily accurate actually
 * structure a position. The published BTC short is the clearest example:
 *
 *   BASE_ENTRY    95,400          ENTRY_STYLE   10-TIER LADDER
 *   ADD 1/10 PER  $1,000          ENTRY_CAP     102,000
 *   REMAINING     HELD IN RESERVE RISK_THRESHOLD > 105,000 DAILY CLOSE
 *   T1 74,000  ·  T2 55,000  ·  T3 30,000   ·   HORIZON 6-9 MONTHS
 *
 * Read that structurally and the apparent accuracy stops being mysterious. Four
 * choices do the work, and none of them is prediction:
 *
 *   1. THE LADDER MAKES BEING EARLY SURVIVABLE. A single short at 95,400 is
 *      badly underwater at 102,000. The same thesis laddered across ten tiers
 *      averages in near 98,700 — a position that is roughly flat where the
 *      single entry has already been stopped out. Being early stops being fatal,
 *      and almost every "wrong" call is really an early one.
 *
 *   2. INVALIDATION IS A DAILY CLOSE, NOT AN INTRADAY TOUCH. Noise cannot remove
 *      the position. Compare this platform's own B band, whose stops sat 1.2%
 *      away and were being taken by ordinary intraday range.
 *
 *   3. THREE TARGETS MEAN PARTIAL CREDIT. T1 at 74,000 is a win on its own. You
 *      do not need 30,000 to have been right.
 *
 *   4. THE HORIZON IS 6-9 MONTHS. A thesis that resolves slowly cannot be
 *      falsified quickly, and there is time for the ladder to fill.
 *
 * Every one of those is copyable engineering rather than better foresight. What
 * it costs is capital committed over time and the discipline to hold reserve —
 * so this module reports the honest arithmetic too: how much is at risk at each
 * fill depth, and what the average entry actually becomes.
 */

export interface LadderInput {
  direction: 'long' | 'short';
  /** First tier goes on here. */
  baseEntry: number;
  /** Ladder stops adding beyond this price. */
  entryCap: number;
  tiers: number;
  /** Total premium or notional the full ladder would commit. */
  totalBudget: number;
  /** Fraction never deployed by the ladder, kept for a better price. */
  reserveFrac?: number;
  /** Invalidation, evaluated on a CLOSE — not an intraday touch. */
  riskThresholdClose: number;
  targets: number[];
  /** Fraction of the position taken at each target. Defaults to front-loaded. */
  targetAllocation?: number[];
  horizonLabel?: string;
}

export interface LadderTier {
  n: number;
  price: number;
  /** Capital committed at this tier. */
  size: number;
  /** Blended entry once this tier has filled. */
  avgEntry: number;
  /** Committed so far, including this tier. */
  cumulative: number;
}

export interface LadderPlan {
  tiers: LadderTier[];
  /** Blended entry if every tier fills. */
  fullAvgEntry: number;
  /** Single-entry price this ladder is being compared against. */
  singleEntry: number;
  /**
   * How much further the market can go against you before the FULL ladder is
   * underwater by as much as a single entry already is at the cap. The whole
   * point of laddering, expressed as one number.
   */
  edgeVsSingleEntryPct: number;
  reserve: number;
  riskThresholdClose: number;
  targets: { n: number; price: number; allocation: number; gainPct: number }[];
  /** Blended return if every target fills, on the full-ladder average entry. */
  blendedTargetGainPct: number;
  horizonLabel: string;
  summary: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Front-loaded default: most of the position comes off at the nearest target. */
function defaultAllocation(n: number): number[] {
  if (n <= 1) return [1];
  if (n === 2) return [0.6, 0.4];
  if (n === 3) return [0.5, 0.3, 0.2];
  const even = 1 / n;
  return Array.from({ length: n }, () => even);
}

export function buildLadder(i: LadderInput): LadderPlan {
  const short = i.direction === 'short';
  const tiers = Math.max(1, Math.floor(i.tiers));
  const reserveFrac = Math.min(0.9, Math.max(0, i.reserveFrac ?? 0));
  const deployable = i.totalBudget * (1 - reserveFrac);
  const perTier = deployable / tiers;

  // A short ladders UP into strength, a long ladders DOWN into weakness. Either
  // way each rung is a price the market has to reach to take your money, so the
  // step always runs from base toward the cap.
  const step = tiers > 1 ? (i.entryCap - i.baseEntry) / (tiers - 1) : 0;

  const rows: LadderTier[] = [];
  let notional = 0;
  let cumulative = 0;
  for (let n = 1; n <= tiers; n++) {
    const price = i.baseEntry + step * (n - 1);
    notional += perTier * price;
    cumulative += perTier;
    rows.push({
      n, price: round2(price), size: round2(perTier),
      avgEntry: round2(notional / cumulative),
      cumulative: round2(cumulative),
    });
  }

  const fullAvgEntry = rows[rows.length - 1].avgEntry;

  // At the cap: how far offside is a single entry, versus the full ladder?
  const singleOffside = short
    ? (i.entryCap - i.baseEntry) / i.baseEntry
    : (i.baseEntry - i.entryCap) / i.baseEntry;
  const ladderOffside = short
    ? (i.entryCap - fullAvgEntry) / fullAvgEntry
    : (fullAvgEntry - i.entryCap) / fullAvgEntry;
  const edgeVsSingleEntryPct = round2((singleOffside - ladderOffside) * 100);

  const alloc = i.targetAllocation ?? defaultAllocation(i.targets.length);
  const targets = i.targets.map((price, idx) => {
    const gain = short
      ? (fullAvgEntry - price) / fullAvgEntry
      : (price - fullAvgEntry) / fullAvgEntry;
    return {
      n: idx + 1, price: round2(price),
      allocation: alloc[idx] ?? 0,
      gainPct: round2(gain * 100),
    };
  });

  const blendedTargetGainPct = round2(
    targets.reduce((s, t) => s + t.gainPct * t.allocation, 0),
  );

  const horizonLabel = i.horizonLabel ?? 'unspecified horizon';
  const summary =
    `${tiers} tiers from ${round2(i.baseEntry)} to ${round2(i.entryCap)}, averaging ${fullAvgEntry} if fully filled — ` +
    `${edgeVsSingleEntryPct.toFixed(1)} points better off at the cap than a single entry at ${round2(i.baseEntry)}. ` +
    `Invalidated on a close ${short ? 'above' : 'below'} ${round2(i.riskThresholdClose)}, not on an intraday touch. ` +
    `T1 ${targets[0]?.price ?? '—'} takes ${Math.round((targets[0]?.allocation ?? 0) * 100)}% off; ` +
    `blended ${blendedTargetGainPct >= 0 ? '+' : ''}${blendedTargetGainPct}% if the full ladder plays out over ${horizonLabel}.`;

  return {
    tiers: rows, fullAvgEntry, singleEntry: round2(i.baseEntry),
    edgeVsSingleEntryPct, reserve: round2(i.totalBudget * reserveFrac),
    riskThresholdClose: round2(i.riskThresholdClose),
    targets, blendedTargetGainPct, horizonLabel, summary,
  };
}

/** Has a CLOSE invalidated the thesis? Intraday excursions deliberately do not. */
export function ladderInvalidated(
  plan: Pick<LadderPlan, 'riskThresholdClose'>,
  direction: 'long' | 'short',
  dailyClose: number,
): boolean {
  return direction === 'short'
    ? dailyClose > plan.riskThresholdClose
    : dailyClose < plan.riskThresholdClose;
}
