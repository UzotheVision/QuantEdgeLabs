/**
 * GEX DTE Bucketing — splits a flat options chain into time-horizon buckets
 * so each trader workflow gets its own snapshot:
 *
 *   today    → 0DTE pin levels
 *   week     → swing setups (1-7d)
 *   month    → monthly opex positioning (7-30d)
 *   quarter  → 30-90d
 *   leaps    → 90+d institutional positioning
 *
 * Plus the single most actionable GEX number:
 *   dealerFlowPer1Pct = totalGamma × spot² × 0.01 × 100
 *   "Dealers must buy/sell $X notional per 1% spot move."
 */
import type { GEXBucketSummary } from '../shared/gex-types';

export interface BucketContract {
  expirationDate: string;     // YYYY-MM-DD
  strike: number;
  cp: 'C' | 'P';
  oi: number;
  gamma: number;
}

const DTE_BUCKETS = [
  { key: 'today',   min: 0,  max: 1   },
  { key: 'week',    min: 1,  max: 7   },
  { key: 'month',   min: 7,  max: 30  },
  { key: 'quarter', min: 30, max: 90  },
  { key: 'leaps',   min: 90, max: 9999 },
] as const;

type BucketKey = typeof DTE_BUCKETS[number]['key'];

/** Days between an ISO date string and now. */
export function dteFromIso(iso: string, now = Date.now()): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 9999;
  return Math.max(0, Math.round((t - now) / 86_400_000));
}

/**
 * Convert raw gamma sum → dollar dealer flow per 1% move.
 * Formula: gammaSum × spot² × 0.01 × 100 (× 100 = per-contract multiplier)
 */
export function dealerFlowPer1PctFromGamma(gammaSum: number, spot: number): number {
  return gammaSum * spot * spot * 0.01 * 100;
}

/**
 * Convert totalGEX (billions, $/1.0 move) → dollar dealer flow per 1% move.
 * GEX in $B per full move × 1e9 × 0.01 = dollars per 1% move.
 */
export function dealerFlowFromTotalGEX(totalGEXBillions: number): number {
  return totalGEXBillions * 1e9 * 0.01;
}

/**
 * Bucket a per-expiration matrix (strike × expiry) into DTE summaries.
 * Used by the Tradier path where we already have aggregated cells, not raw contracts.
 */
export function bucketizeMatrix(
  matrix: Array<{ strike: number; dte: number; netGEX: number }>,
  spot: number,
): Partial<Record<BucketKey, GEXBucketSummary>> {
  const out: Partial<Record<BucketKey, GEXBucketSummary>> = {};
  for (const b of DTE_BUCKETS) {
    const cells = matrix.filter(c => c.dte >= b.min && c.dte <= b.max);
    if (cells.length === 0) continue;

    // Aggregate by strike within bucket
    const byStrike = new Map<number, number>();
    for (const c of cells) {
      byStrike.set(c.strike, (byStrike.get(c.strike) ?? 0) + c.netGEX);
    }
    const strikes = Array.from(byStrike.entries())
      .map(([strike, netGEX]) => ({ strike, netGEX }))
      .sort((a, b) => a.strike - b.strike);

    let callWall: number | null = null, callWallGEX = 0;
    let putWall: number | null = null, putWallGEX = 0;
    let maxGammaStrike: number | null = null, maxAbs = 0;
    for (const s of strikes) {
      if (s.strike > spot && s.netGEX > callWallGEX) { callWallGEX = s.netGEX; callWall = s.strike; }
      if (s.strike < spot && s.netGEX < putWallGEX) { putWallGEX = s.netGEX; putWall = s.strike; }
      if (Math.abs(s.netGEX) > maxAbs) { maxAbs = Math.abs(s.netGEX); maxGammaStrike = s.strike; }
    }

    let gammaFlipPrice: number | null = null;
    let cum = 0;
    for (const s of strikes) {
      const prev = cum;
      cum += s.netGEX;
      if ((prev <= 0 && cum > 0) || (prev >= 0 && cum < 0)) { gammaFlipPrice = s.strike; break; }
    }

    const totalGEXBillions = strikes.reduce((sum, s) => sum + s.netGEX, 0);
    const expsCount = new Set(cells.map(c => c.dte)).size;

    out[b.key] = {
      expirationsCount: expsCount,
      totalGEX: totalGEXBillions,
      callWall,
      putWall,
      maxGammaStrike,
      gammaFlipPrice,
      dealerFlowPer1Pct: dealerFlowFromTotalGEX(totalGEXBillions),
    };
  }
  return out;
}

/**
 * Build per-DTE bucket summaries from a flat list of contracts.
 * Each bucket gets its own walls + flip + dealer flow.
 */
export function bucketizeChain(
  contracts: BucketContract[],
  spot: number,
  now = Date.now(),
): Partial<Record<BucketKey, GEXBucketSummary>> {
  const buckets: Partial<Record<BucketKey, BucketContract[]>> = {};
  const expsByBucket: Partial<Record<BucketKey, Set<string>>> = {};

  for (const c of contracts) {
    if (!c.oi || c.oi <= 0) continue;
    const dte = dteFromIso(c.expirationDate, now);
    const b = DTE_BUCKETS.find(b => dte >= b.min && dte <= b.max);
    if (!b) continue;
    (buckets[b.key] ??= []).push(c);
    (expsByBucket[b.key] ??= new Set()).add(c.expirationDate);
  }

  const out: Partial<Record<BucketKey, GEXBucketSummary>> = {};
  for (const [key, list] of Object.entries(buckets) as [BucketKey, BucketContract[]][]) {
    if (!list?.length) continue;
    out[key] = summarizeBucket(list, spot, expsByBucket[key]?.size ?? 0);
  }
  return out;
}

function summarizeBucket(
  contracts: BucketContract[],
  spot: number,
  expirationsCount: number,
): GEXBucketSummary {
  // Aggregate by strike
  const byStrike = new Map<number, { netGEX: number; callGEX: number; putGEX: number; callOI: number; putOI: number }>();
  let gammaSum = 0;

  for (const c of contracts) {
    const gex = c.oi * c.gamma * spot * spot * 100;
    gammaSum += c.oi * c.gamma * (c.cp === 'P' ? -1 : 1);
    const e = byStrike.get(c.strike) ?? { netGEX: 0, callGEX: 0, putGEX: 0, callOI: 0, putOI: 0 };
    if (c.cp === 'C') {
      e.callGEX += gex;
      e.callOI += c.oi;
    } else {
      e.putGEX += gex;
      e.putOI += c.oi;
    }
    e.netGEX = e.callGEX - e.putGEX;
    byStrike.set(c.strike, e);
  }

  const strikes = Array.from(byStrike.entries())
    .map(([strike, v]) => ({ strike, ...v }))
    .sort((a, b) => a.strike - b.strike);

  // Walls
  let callWall: number | null = null;
  let callWallGEX = 0;
  let putWall: number | null = null;
  let putWallGEX = 0;
  let maxGammaStrike: number | null = null;
  let maxAbs = 0;

  for (const s of strikes) {
    if (s.strike > spot && s.netGEX > callWallGEX && s.callOI > 50) {
      callWallGEX = s.netGEX; callWall = s.strike;
    }
    if (s.strike < spot && s.netGEX < putWallGEX && s.putOI > 50) {
      putWallGEX = s.netGEX; putWall = s.strike;
    }
    if (Math.abs(s.netGEX) > maxAbs) {
      maxAbs = Math.abs(s.netGEX);
      maxGammaStrike = s.strike;
    }
  }

  // Gamma flip — cumulative netGEX sign change
  let gammaFlipPrice: number | null = null;
  let cum = 0;
  for (const s of strikes) {
    const prev = cum;
    cum += s.netGEX;
    if ((prev <= 0 && cum > 0) || (prev >= 0 && cum < 0)) {
      gammaFlipPrice = s.strike;
      break;
    }
  }

  // Total GEX (billions) and dealer flow
  const totalGEX = strikes.reduce((sum, s) => sum + s.netGEX, 0) / 1e9;
  const dealerFlow = dealerFlowPer1PctFromGamma(gammaSum, spot);

  return {
    expirationsCount,
    totalGEX,
    callWall,
    putWall,
    maxGammaStrike,
    gammaFlipPrice,
    dealerFlowPer1Pct: dealerFlow,
  };
}
