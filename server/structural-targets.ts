/**
 * STRUCTURAL TARGETS — a destination price actually trades to, instead of arithmetic.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ════════════════════════════════════════════════════════════════════════════
 * Measured across 593 published ideas:
 *
 *     target sits at exactly 1.5R  →  62
 *     target sits at exactly 2.0R  → 144
 *     target sits at exactly 2.5R  → 286
 *     organic (non-round) ratio    → 101
 *
 * 492 of 593 — 83% — carry a target at an exact round R multiple. That target was
 * not found on a chart. It was computed as `risk × 2.5`, which level-engine.ts
 * admits in its own note: "T1 pushed to the 1.5R minimum — nearest structure was
 * too close to pay for the risk".
 *
 * The cost is measurable. The 2.5R+ cohort is 245 measured trades returning
 * +0.023R — effectively nothing — while 62% of all ideas expire without resolving.
 * A trade walking toward a number nobody is defending runs out of time, because
 * there was never anything at the destination to pull price there.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT A REAL DESTINATION LOOKS LIKE
 * ════════════════════════════════════════════════════════════════════════════
 * Two kinds of level in this platform have an actual base rate behind them:
 *
 *   • UNFILLED GAPS — /api/gaps/:symbol reports each symbol's own fill history.
 *     Measured: AAOI 91% (30/33), QCOM 97% (33/34), FLNC 97% (33/34), CRCL 95%
 *     (21/22), GOOGL 83% (25/30) — with a median bars-to-fill of 3-4. That is a
 *     probability attached to a price, which is exactly what a target needs and
 *     what `risk × 2.5` can never have.
 *
 *   • GAMMA WALLS — call wall / put wall from /api/gex/buckets/:symbol. Dealers
 *     hedge into these, so they behave as levels. They carry no base rate here
 *     yet; level-hit-rate.ts exists to measure whether lit levels get traded to,
 *     but has no history for most symbols. So walls are returned WITHOUT a
 *     confidence number rather than with an invented one.
 *
 * Gaps are preferred over walls precisely because a gap comes with its own
 * measured hit rate and a wall does not. Ranking a level with evidence above a
 * level without it is the whole point.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SCOPE — READ ONLY
 * ════════════════════════════════════════════════════════════════════════════
 * This module proposes. It does not publish. Nothing here writes an idea or
 * changes a live target: it exists to be compared against what the engine is
 * already doing, on the same symbols, before anything switches. Given 83% of the
 * book would change, swapping the target source without that comparison would be
 * the largest unverified change in the system.
 */

export type StructuralSource = 'gap' | 'call_wall' | 'put_wall' | 'max_gamma';

export interface StructuralTarget {
  price: number;
  source: StructuralSource;
  label: string;
  /** Signed % from spot. Positive is above. */
  distancePct: number;
  /** Measured probability this KIND of level gets reached, 0-1. Null when unmeasured. */
  baseRate: number | null;
  /** e.g. "33/34 gaps filled" — the sample behind baseRate, so it can be judged. */
  baseRateSample: string | null;
  medianBarsToReach: number | null;
}

export interface StructuralTargetReport {
  symbol: string;
  spot: number;
  direction: 'long' | 'short';
  /** Nearest qualifying level in the direction of the trade. */
  primary: StructuralTarget | null;
  /** Everything found, nearest first — the second one is usually T2. */
  candidates: StructuralTarget[];
  /** Set when nothing qualifies. A trade with no destination is a real finding. */
  note?: string;
}

interface GapLike {
  from: number; to: number; mid: number; sizePct: number;
  ageBars: number; nearEdge: number; distancePct: number;
}

/**
 * Levels only count when price can plausibly reach them inside a swing horizon.
 * The raw gap feed returns every unfilled gap on the chart — on CRCL that included
 * one 141.9% away, which is a historical artifact, not a destination.
 */
const MAX_REACH_PCT = 25;

/** Below this the "target" is inside the noise and cannot pay for a stop. */
const MIN_REACH_PCT = 1.0;

export async function findStructuralTargets(
  symbol: string,
  spot: number,
  direction: 'long' | 'short',
  deps: {
    fetchGaps: (s: string) => Promise<{ unfilled?: GapLike[]; stats?: { fillRate?: number; filled?: number; total?: number; medianBarsToFill?: number | null } } | null>;
    fetchGamma: (s: string) => Promise<{ byDte?: Record<string, { callWall?: number | null; putWall?: number | null }> } | null>;
  },
): Promise<StructuralTargetReport> {
  const wantAbove = direction === 'long';
  const candidates: StructuralTarget[] = [];

  // ── gaps: the only levels here carrying a measured base rate ──
  try {
    const g = await deps.fetchGaps(symbol);
    const fillRate = g?.stats?.fillRate ?? null;
    const sample =
      g?.stats && g.stats.filled != null && g.stats.total != null
        ? `${g.stats.filled}/${g.stats.total} gaps filled`
        : null;

    for (const gap of g?.unfilled ?? []) {
      const above = gap.distancePct > 0;
      if (above !== wantAbove) continue;
      const reach = Math.abs(gap.distancePct);
      if (reach > MAX_REACH_PCT || reach < MIN_REACH_PCT) continue;

      // The NEAR edge is the honest target: price only has to reach the start of
      // the gap for the thesis to be working. Using the midpoint would quietly
      // add distance the level does not justify.
      candidates.push({
        price: gap.nearEdge,
        source: 'gap',
        label: `gap ${gap.from.toFixed(2)}–${gap.to.toFixed(2)} (${gap.sizePct.toFixed(1)}%, ${gap.ageBars}b old)`,
        distancePct: gap.distancePct,
        baseRate: fillRate,
        baseRateSample: sample,
        medianBarsToReach: g?.stats?.medianBarsToFill ?? null,
      });
    }
  } catch {
    // A missing gap history is not an error — plenty of symbols have none.
  }

  // ── gamma walls: real levels, no measured hit rate yet ──
  try {
    const gx = await deps.fetchGamma(symbol);
    const seen = new Set<number>();
    for (const [bucket, v] of Object.entries(gx?.byDte ?? {})) {
      const wall = wantAbove ? v?.callWall : v?.putWall;
      if (wall == null || seen.has(wall)) continue;
      seen.add(wall);

      const distancePct = ((wall - spot) / spot) * 100;
      const above = distancePct > 0;
      if (above !== wantAbove) continue;
      const reach = Math.abs(distancePct);
      if (reach > MAX_REACH_PCT || reach < MIN_REACH_PCT) continue;

      candidates.push({
        price: wall,
        source: wantAbove ? 'call_wall' : 'put_wall',
        label: `${wantAbove ? 'call' : 'put'} wall ${wall} (${bucket})`,
        distancePct,
        baseRate: null,               // deliberately null — see header
        baseRateSample: null,
        medianBarsToReach: null,
      });
    }
  } catch {
    // no chain / no GEX for this symbol
  }

  candidates.sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));

  // Prefer the nearest level that HAS a base rate. A gap at 97% beats a wall with
  // no measured history even when the wall is slightly closer, because the whole
  // reason to move off `risk × 2.5` is to get evidence attached to the number.
  const measured = candidates.filter((c) => c.baseRate != null);
  const primary = measured[0] ?? candidates[0] ?? null;

  return {
    symbol,
    spot,
    direction,
    primary,
    candidates,
    note: primary
      ? undefined
      : `No unfilled gap or gamma wall ${wantAbove ? 'above' : 'below'} ${symbol} within ${MAX_REACH_PCT}%. ` +
        `There is no structural destination for this trade — which is itself the finding, and a reason to pass rather than to invent a target.`,
  };
}
