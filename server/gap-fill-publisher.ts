/**
 * GAP FILL PUBLISHER — the one edge on this platform that was already measured.
 * ===========================================================================
 * gap-scanner.ts computes, per symbol, how often unfilled gaps have actually
 * been filled and how long it took. That number was rendered in the UI
 * ("fills 92% · 33/36 · median 4 bars") and published nowhere. Live scan:
 *
 *   BIDU  98% of 100 gaps filled, median 4 sessions, magnet 2.3% away
 *   FCX   97% of  72          "          4      "            1.8%
 *   MPWR  95% of  42          "          3      "            1.2%
 *
 * Every other scanner here asserts a pattern and hopes. This one carries a base
 * rate measured on that symbol's own history, which is the strongest evidence
 * the platform produces about anything.
 *
 * DIRECTION — verified against the scanner, not assumed
 * `direction` describes the move that CREATED the gap, so it inverts the trade:
 *
 *   direction 'up'   → magnet sits BELOW spot → price must fall → SHORT
 *   direction 'down' → magnet sits ABOVE spot → price must rise → LONG
 *
 * Inverting this would publish a short as a long on a 98%-base-rate setup, so
 * the side is derived from edge-vs-spot rather than from the label.
 *
 * WHAT THIS IS NOT
 * A gap is a magnet, not a forecast. A 98% historical fill rate says price has
 * unfinished business at that level, not that it goes there next. Targets are
 * the gap edge — never beyond it — because the measured evidence covers
 * reaching the edge and nothing further.
 */
import { logger } from './logger';
import type { GapCandidate } from './gap-scanner';

/** Evidence floor. Below this the rate is anecdote. */
const MIN_FILL_RATE = 0.80;
const MIN_SAMPLES = 20;
/** Closer than this and the fill is already happening; further and it is a wish. */
const MIN_DISTANCE_PCT = 0.8;
const MAX_DISTANCE_PCT = 8;
/**
 * Stop distance as a multiple of the distance to the magnet.
 *
 * This FIXES R:R at 1/0.75 = 1.33 for every gap idea, which is below the 1.5
 * floor the tiered ingest policy applies elsewhere. That is deliberate here and
 * nowhere else, because this is the only setup on the platform with a measured
 * base rate: at a 95% fill rate a 1.33:1 trade needs 43% to break even.
 *
 * THE CAVEAT THAT MATTERS
 * The measured rate is "this gap EVENTUALLY filled", not "filled before a
 * 0.75x stop would have triggered". Those are different numbers and only the
 * first one has been measured. Realised win rate will be lower than the base
 * rate by however often price ran the other way first — which is exactly what
 * the stop exists to catch.
 *
 * So treat 95% as an upper bound on the hit rate, not an estimate of it. The
 * honest version of this edge needs a replay that walks each historical gap
 * bar-by-bar and asks which barrier was touched first. Until that exists these
 * ideas carry real evidence about the destination and no evidence about the
 * path.
 */
const STOP_MULTIPLE = 0.75;

export interface GapIdea {
  symbol: string;
  side: 'long' | 'short';
  entry: number;
  target: number;
  stop: number;
  rr: number;
  fillRate: number;
  samples: number;
  medianSessions: number | null;
  score: number;
  read: string;
}

export function toGapIdea(c: GapCandidate): GapIdea | null {
  if (c.fillRate < MIN_FILL_RATE) return null;
  if (c.samples < MIN_SAMPLES) return null;

  const dist = Math.abs(c.distancePct);
  if (dist < MIN_DISTANCE_PCT || dist > MAX_DISTANCE_PCT) return null;

  // Side from geometry, never from the label. See the header.
  const side: 'long' | 'short' = c.edge > c.spot ? 'long' : 'short';
  const entry = c.spot;
  const target = c.edge;

  /**
   * The stop sits on the far side of entry, proportional to the trip.
   *
   * A fixed percentage stop makes no sense here: the trade is "price travels
   * 1.2% to a magnet", and a 5% stop on that is 4:1 against you before the
   * setup has said anything. Scaling the stop to the distance keeps R:R
   * roughly constant whatever the gap size.
   */
  const travel = Math.abs(target - entry);
  const stop = side === 'long' ? entry - travel * STOP_MULTIPLE : entry + travel * STOP_MULTIPLE;

  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  const rr = Math.abs(target - entry) / risk;

  return {
    symbol: c.symbol,
    side, entry, target, stop, rr,
    fillRate: c.fillRate,
    samples: c.samples,
    medianSessions: c.medianSessions,
    score: c.score,
    read: c.read,
  };
}

/** Scan, convert, and publish gap-fill ideas through the normal ingest gates. */
export async function ingestGapFillIdeas(): Promise<number> {
  try {
    const { scanGaps } = await import('./gap-scanner');
    const { candidates } = await scanGaps({ limit: 200 });

    // One idea per symbol. A symbol can carry a magnet above AND below; taking
    // both would publish a long and a short on the same name in the same sweep.
    const best = new Map<string, GapIdea>();
    for (const c of candidates) {
      const idea = toGapIdea(c);
      if (!idea) continue;
      const prev = best.get(idea.symbol);
      if (!prev || idea.score > prev.score) best.set(idea.symbol, idea);
    }

    const ideas = Array.from(best.values()).sort((a, b) => b.score - a.score).slice(0, 12);
    logger.info(
      `[GAP-FILL] ${candidates.length} magnets → ${best.size} qualified ` +
      `(fill>=${MIN_FILL_RATE * 100}%, n>=${MIN_SAMPLES}, ${MIN_DISTANCE_PCT}-${MAX_DISTANCE_PCT}% away) → ${ideas.length} for ingest`,
    );
    if (ideas.length === 0) return 0;

    const { ingestTradeIdea } = await import('./trade-idea-ingestion');
    let ingested = 0;

    for (const g of ideas) {
      try {
        const med = g.medianSessions != null ? `${g.medianSessions} sessions` : 'unknown';
        const result = await ingestTradeIdea({
          source: 'market_scanner',
          symbol: g.symbol,
          assetType: 'stock',
          direction: g.side === 'long' ? 'bullish' : 'bearish',
          signals: [
            { type: 'gap_fill_rate', weight: 15, description: `${(g.fillRate * 100).toFixed(0)}% of ${g.samples} past gaps filled` },
            { type: 'gap_distance', weight: 10, description: `magnet ${Math.abs(((g.target - g.entry) / g.entry) * 100).toFixed(1)}% away` },
            { type: 'gap_speed', weight: 8, description: `median fill ${med}` },
          ],
          holdingPeriod: 'swing',
          currentPrice: g.entry,
          targetPrice: g.target,
          stopLoss: g.stop,
          catalyst:
            `⬜ Gap Fill · ${(g.fillRate * 100).toFixed(0)}% fill rate on ${g.samples} prior gaps · R:R ${g.rr.toFixed(2)}:1. ` +
            `Magnet at $${g.target.toFixed(2)}, median fill ${med}.`,
          analysis:
            `${g.read} A gap is a magnet, not a forecast: the base rate says price has unfinished ` +
            `business at $${g.target.toFixed(2)}, not that it trades there next. Target is the gap edge and ` +
            `nothing beyond it, because the measured evidence covers reaching the edge only. ` +
            `Stop is ${(STOP_MULTIPLE * 100).toFixed(0)}% of the trip on the far side of entry. ` +
            `NOTE: the fill rate measures whether the gap eventually filled, not whether it filled ` +
            `before this stop would have triggered — treat it as an upper bound on the hit rate.`,
        } as any);
        if (result.success) ingested++;
      } catch { /* dedup gate — expected */ }
    }

    if (ingested > 0) logger.info(`[GAP-FILL] 📥 Ingested ${ingested} gap-fill idea(s)`);
    return ingested;
  } catch (err: any) {
    logger.error(`[GAP-FILL] ingest failed: ${err?.message ?? err}`);
    return 0;
  }
}
