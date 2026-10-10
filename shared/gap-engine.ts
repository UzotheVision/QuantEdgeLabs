/**
 * GAP ENGINE — unfilled gaps, and how this ticker has historically treated them.
 *
 * A gap is a price region where NO trading occurred: yesterday's high is below
 * today's low (gap up), or yesterday's low is above today's high (gap down). Those
 * empty zones matter because there are no trapped positions inside them — nobody
 * bought there, so there is no supply or demand shelf to slow price down. Price
 * often travels back through them quickly, which is why an unfilled gap below acts
 * as a downside magnet and one above acts as an upside one.
 *
 * The honest part is the base rate. "Gaps always fill" is folklore; the fill rate
 * is a property of the individual name and the size of the gap, so this measures
 * it from the ticker's own history rather than asserting it. A ticker that has
 * filled 8 of its last 10 gaps within 20 sessions tells you something. One with
 * three samples tells you almost nothing, and the output says so.
 *
 * Pure functions over OHLC — no fetching, so client and server share one answer.
 */

export interface Bar { time: number; open: number; high: number; low: number; close: number; volume?: number }

export type GapDirection = 'up' | 'down';

export interface Gap {
  direction: GapDirection;
  /** Edges of the untraded zone. */
  from: number;
  to: number;
  /** Midpoint — the level most people quote as "the gap". */
  mid: number;
  /** Size as a % of price. Small gaps are noise; large ones are structural. */
  sizePct: number;
  /** Bar index and timestamp where it opened. */
  index: number;
  time: number;
  /** Sessions since it formed. */
  ageBars: number;
  filled: boolean;
  /** Sessions it took to fill, when it did. */
  barsToFill: number | null;
  /** The edge price reaches FIRST on its way to this gap. */
  nearEdge: number;
  /** Distance from current price to that near edge, signed % (negative = below). */
  distancePct: number | null;
}

export interface GapReport {
  symbol?: string;
  spot: number;
  /** Every unfilled gap, nearest first. */
  unfilled: Gap[];
  /** The closest unfilled gap below and above — the magnets that matter now. */
  nearestBelow: Gap | null;
  nearestAbove: Gap | null;
  /** Historical base rate from THIS ticker's own gaps. */
  stats: {
    total: number;
    filled: number;
    fillRate: number | null;
    medianBarsToFill: number | null;
    /** Below ~8 closed samples, treat the rate as indicative only. */
    sampleConfidence: 'low' | 'moderate' | 'good';
  };
  notes: string[];
}

/** Gaps smaller than this are intrabar noise, not structure. */
const MIN_GAP_PCT = 0.35;
/** A gap is counted as "resolved" for base-rate purposes only within this window. */
const FILL_WINDOW = 60;

/**
 * A gap fills when price later trades back through it. We require the CLOSE-side
 * penetration to reach the far edge, i.e. the untraded zone is fully retraced —
 * a wick that clips the near edge has not filled anything meaningful.
 */
export function findGaps(bars: Bar[]): Gap[] {
  const gaps: Gap[] = [];
  if (bars.length < 3) return gaps;

  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    if (![prev.high, prev.low, cur.high, cur.low].every((v) => Number.isFinite(v) && v > 0)) continue;

    let direction: GapDirection | null = null;
    let from = 0;
    let to = 0;

    if (cur.low > prev.high) {
      direction = 'up';
      from = prev.high;
      to = cur.low;
    } else if (cur.high < prev.low) {
      direction = 'down';
      from = cur.high;
      to = prev.low;
    }
    if (!direction) continue;

    const mid = (from + to) / 2;
    const sizePct = (Math.abs(to - from) / mid) * 100;
    if (sizePct < MIN_GAP_PCT) continue;

    // Walk forward to see whether — and how fast — it filled.
    let filled = false;
    let barsToFill: number | null = null;
    for (let j = i + 1; j < bars.length; j++) {
      const b = bars[j];
      // Up gap fills when price trades back DOWN to the lower edge; down gap when
      // it trades back UP to the upper edge.
      const reached = direction === 'up' ? b.low <= from : b.high >= to;
      if (reached) {
        filled = true;
        barsToFill = j - i;
        break;
      }
    }

    gaps.push({
      direction, from, to, mid, sizePct,
      index: i, time: cur.time,
      ageBars: bars.length - 1 - i,
      filled, barsToFill,
      nearEdge: mid, // recomputed against spot in analyzeGaps
      distancePct: null,
    });
  }

  return gaps;
}

export function analyzeGaps(bars: Bar[], symbol?: string): GapReport | null {
  if (!bars || bars.length < 30) return null;
  const spot = bars[bars.length - 1].close;
  if (!(spot > 0)) return null;

  const all = findGaps(bars);

  // Base rate only over gaps old enough to have had a fair chance to fill.
  const resolved = all.filter((g) => g.ageBars >= FILL_WINDOW || g.filled);
  const filledCount = resolved.filter((g) => g.filled).length;
  const fillTimes = resolved.filter((g) => g.barsToFill != null).map((g) => g.barsToFill!).sort((a, b) => a - b);
  const medianBarsToFill = fillTimes.length ? fillTimes[Math.floor(fillTimes.length / 2)] : null;

  const unfilled = all
    .filter((g) => !g.filled)
    .map((g) => {
      // The near edge is simply whichever end of the untraded zone is closest to
      // spot — NOT a fixed end per direction. An unfilled gap-up sitting below
      // price is entered at its TOP; keying off direction reported the far edge
      // and overstated how far price had to travel (5.6% when it was 3.4%).
      const lo = Math.min(g.from, g.to);
      const hi = Math.max(g.from, g.to);
      const nearEdge = spot > hi ? hi : spot < lo ? lo : spot;
      return { ...g, nearEdge, distancePct: ((nearEdge - spot) / spot) * 100 };
    })
    .sort((a, b) => Math.abs(a.distancePct!) - Math.abs(b.distancePct!));

  const below = unfilled.filter((g) => (g.distancePct ?? 0) < 0);
  const above = unfilled.filter((g) => (g.distancePct ?? 0) > 0);

  const sampleConfidence: GapReport['stats']['sampleConfidence'] =
    resolved.length >= 15 ? 'good' : resolved.length >= 8 ? 'moderate' : 'low';

  const fillRate = resolved.length ? filledCount / resolved.length : null;

  const notes: string[] = [];
  if (fillRate != null) {
    notes.push(
      `${filledCount} of ${resolved.length} past gaps eventually filled (${(fillRate * 100).toFixed(0)}%)` +
      (medianBarsToFill != null ? `, typically in ${medianBarsToFill} sessions` : ''),
    );
  }
  if (sampleConfidence === 'low') {
    notes.push('Few completed samples — treat the fill rate as indicative, not a base rate');
  }
  if (below[0]) {
    const g = below[0];
    notes.push(`Nearest unfilled gap below: $${Math.min(g.from, g.to).toFixed(2)}–$${Math.max(g.from, g.to).toFixed(2)}, entered at $${g.nearEdge.toFixed(2)} (${Math.abs(g.distancePct!).toFixed(1)}% down, ${g.ageBars} sessions old)`);
  }
  if (above[0]) {
    const g = above[0];
    notes.push(`Nearest unfilled gap above: $${Math.min(g.from, g.to).toFixed(2)}–$${Math.max(g.from, g.to).toFixed(2)}, entered at $${g.nearEdge.toFixed(2)} (${g.distancePct!.toFixed(1)}% up)`);
  }
  if (!below.length && !above.length) {
    notes.push('No unfilled gaps of significance — nothing acting as a gap magnet either way');
  }

  return {
    symbol,
    spot,
    unfilled: unfilled.slice(0, 8),
    nearestBelow: below[0] ?? null,
    nearestAbove: above[0] ?? null,
    stats: {
      total: resolved.length,
      filled: filledCount,
      fillRate,
      medianBarsToFill,
      sampleConfidence,
    },
    notes,
  };
}
