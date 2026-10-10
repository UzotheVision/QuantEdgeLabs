/**
 * LEVEL HIT-RATE — does a "lit up" gamma level actually get traded to?
 *
 * From the MomoEdge walkthrough, repeatedly:
 *   "740 was lit up since yesterday. It hit 740 in the morning."
 *   "Yesterday, 750 was lit. We hit 750 yesterday."
 *   "the ones that are lit up have the higher chances of hitting."
 *
 * That last line is a claim, and claims about hit rates are measurable. Rather
 * than repeat it in the UI as received wisdom, this measures it: take the levels
 * that were lit at a past snapshot, look at what price actually did in the
 * sessions after, and report the fraction that traded to. If the claim holds for
 * a ticker, the number says so; if it doesn't, the number says that too.
 *
 * "Hit" means price TRADED THROUGH the level — the session's high reached up to it
 * or the low reached down to it. Not "closed near", not "got within a percent".
 * A magnet either pulled price to it or it didn't.
 */
import { db } from './db';
import { sql } from 'drizzle-orm';
import { logger } from './logger';

export interface LevelOutcome {
  snapshotDate: string;
  level: number;
  role: 'call_wall' | 'put_wall' | 'flip' | 'max_gamma';
  spotAtSnapshot: number;
  distancePctAtSnapshot: number;
  hit: boolean;
  /** Sessions until it traded there, when it did. */
  sessionsToHit: number | null;
}

export interface HitRateReport {
  symbol: string;
  /** Sessions of GEX history available. */
  snapshotsUsed: number;
  outcomes: LevelOutcome[];
  byRole: Record<string, { tested: number; hit: number; rate: number | null; medianSessions: number | null }>;
  overall: { tested: number; hit: number; rate: number | null };
  /** Under ~20 tested levels the rate is noise. */
  confidence: 'none' | 'low' | 'moderate' | 'good';
  note: string;
}

/** How many sessions forward a level gets to prove itself. */
const HORIZON = 5;

export async function getLevelHitRate(symbol: string, bars: { time: number; high: number; low: number }[]): Promise<HitRateReport> {
  const sym = symbol.toUpperCase();

  const res: any = await db.execute(sql`
    select distinct on (created_at::date)
      created_at::date::text  as d,
      spot_price, flip_point, call_wall, put_wall, max_gamma_strike
    from gex_snapshots
    where symbol = ${sym}
    order by created_at::date desc, created_at desc
    limit 120
  `);
  const snaps = (res.rows ?? res) as any[];

  const outcomes: LevelOutcome[] = [];

  for (const snap of snaps) {
    const spot = Number(snap.spot_price);
    if (!(spot > 0)) continue;

    // Bars strictly AFTER the snapshot date — a level cannot be "hit" by the
    // session that produced it, or every level would look prescient.
    const cutoff = new Date(`${snap.d}T23:59:59Z`).getTime() / 1000;
    const forward = bars.filter((b) => b.time > cutoff).slice(0, HORIZON);
    if (forward.length < HORIZON) continue; // not enough future to judge it fairly

    const candidates: [number | null, LevelOutcome['role']][] = [
      [snap.call_wall != null ? Number(snap.call_wall) : null, 'call_wall'],
      [snap.put_wall != null ? Number(snap.put_wall) : null, 'put_wall'],
      [snap.flip_point != null ? Number(snap.flip_point) : null, 'flip'],
      [snap.max_gamma_strike != null ? Number(snap.max_gamma_strike) : null, 'max_gamma'],
    ];

    for (const [level, role] of candidates) {
      if (level == null || !(level > 0)) continue;
      // A level already at spot is not a prediction — skip anything inside 0.25%.
      const distPct = ((level - spot) / spot) * 100;
      if (Math.abs(distPct) < 0.25) continue;

      let sessionsToHit: number | null = null;
      for (let i = 0; i < forward.length; i++) {
        const b = forward[i];
        const reached = level > spot ? b.high >= level : b.low <= level;
        if (reached) { sessionsToHit = i + 1; break; }
      }

      outcomes.push({
        snapshotDate: snap.d,
        level,
        role,
        spotAtSnapshot: spot,
        distancePctAtSnapshot: distPct,
        hit: sessionsToHit != null,
        sessionsToHit,
      });
    }
  }

  const byRole: HitRateReport['byRole'] = {};
  for (const role of ['call_wall', 'put_wall', 'flip', 'max_gamma']) {
    const set = outcomes.filter((o) => o.role === role);
    const hit = set.filter((o) => o.hit);
    const times = hit.map((o) => o.sessionsToHit!).sort((a, b) => a - b);
    byRole[role] = {
      tested: set.length,
      hit: hit.length,
      rate: set.length ? hit.length / set.length : null,
      medianSessions: times.length ? times[Math.floor(times.length / 2)] : null,
    };
  }

  const tested = outcomes.length;
  const hit = outcomes.filter((o) => o.hit).length;
  const confidence: HitRateReport['confidence'] =
    tested === 0 ? 'none' : tested >= 60 ? 'good' : tested >= 20 ? 'moderate' : 'low';

  const note =
    tested === 0
      ? 'No GEX history for this symbol yet. Snapshots are archived hourly during market hours; this fills in as sessions accumulate.'
      : confidence === 'low'
        ? `Only ${tested} levels tested — too few to call a rate. Treat as a running tally, not a base rate.`
        : `${hit} of ${tested} lit levels traded to within ${HORIZON} sessions.`;

  if (tested === 0) logger.debug(`[LEVEL-HITS] no snapshots for ${sym}`);

  return {
    symbol: sym,
    snapshotsUsed: snaps.length,
    outcomes: outcomes.slice(0, 100),
    byRole,
    overall: { tested, hit, rate: tested ? hit / tested : null },
    confidence,
    note,
  };
}
