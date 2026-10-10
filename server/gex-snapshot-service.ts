/**
 * GEX SNAPSHOT SERVICE
 * ====================
 * Lightweight wrapper around `calculateAggregateGammaExposure` that exposes
 * just the few fields the convictions engine needs to score directional
 * confluence (calls vs puts), with batch + caching so a build doesn't fan
 * out 50 expensive options-chain fetches.
 *
 * The full GEX result is heavy (every strike × every expiration). For
 * confluence scoring we only care about:
 *   - regime (positive_gamma / negative_gamma / neutral / transitioning)
 *   - flipPoint vs spot (distance + direction)
 *   - call wall / put wall (pin levels)
 *   - vexRegime (vol tailwind/headwind)
 *
 * Cached for 5 minutes — GEX doesn't move that fast intraday, and the user
 * sees the score, not the raw GEX.
 */

import { logger } from "./logger";
import { calculateAggregateGammaExposure } from "./gamma-exposure";

export interface GexSnapshot {
  symbol: string;
  spot: number;
  flipPoint: number | null;
  callWall: number | null;
  putWall: number | null;
  /** Distance from spot to flip, signed (positive = flip is above spot). */
  flipDistancePct: number | null;
  regime: "positive_gamma" | "negative_gamma" | "neutral" | "transitioning" | null;
  vexRegime: "vol_tailwind" | "vol_headwind" | "vol_neutral" | null;
  /** Sign of total net GEX (positive = pinned, negative = volatile). */
  netGexSign: "positive" | "negative" | "neutral";
  fetchedAt: string;
}

interface CacheEntry {
  snap: GexSnapshot | null;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;

function isFresh(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.cachedAt < CACHE_TTL_MS;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(null);
    });
  });
}

async function fetchOne(symbol: string): Promise<GexSnapshot | null> {
  const result = await withTimeout(
    calculateAggregateGammaExposure(symbol),
    REQUEST_TIMEOUT_MS,
  );
  if (!result || !Number.isFinite(result.spotPrice) || result.spotPrice <= 0) return null;

  const spot = result.spotPrice;
  const flip = typeof result.flipPoint === "number" ? result.flipPoint : null;
  const flipDistancePct = flip !== null ? ((flip - spot) / spot) * 100 : null;

  const netSign: GexSnapshot["netGexSign"] =
    result.totalNetGEX > 0.05
      ? "positive"
      : result.totalNetGEX < -0.05
        ? "negative"
        : "neutral";

  return {
    symbol: symbol.toUpperCase(),
    spot,
    flipPoint: flip,
    callWall: result.callWall ?? null,
    putWall: result.putWall ?? null,
    flipDistancePct: flipDistancePct !== null ? Number(flipDistancePct.toFixed(2)) : null,
    regime: (result.regime as GexSnapshot["regime"]) ?? null,
    vexRegime: (result.vexRegime as GexSnapshot["vexRegime"]) ?? null,
    netGexSign: netSign,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Batch fetch GEX snapshots with bounded concurrency (4 parallel requests
 * by default — options chains are heavy and we don't want to flood Tradier).
 * Returns a Map keyed by uppercase symbol; failed fetches are simply absent.
 */
export async function getGexSnapshotBatch(
  symbols: string[],
  concurrency = 4,
): Promise<Map<string, GexSnapshot>> {
  const out = new Map<string, GexSnapshot>();
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  if (unique.length === 0) return out;

  // Serve from cache
  const remaining: string[] = [];
  for (const sym of unique) {
    const c = cache.get(sym);
    if (isFresh(c)) {
      if (c!.snap) out.set(sym, c!.snap);
    } else {
      remaining.push(sym);
    }
  }

  if (remaining.length === 0) return out;

  let i = 0;
  let okCount = 0;
  let errCount = 0;
  const workers = Array.from({ length: Math.min(concurrency, remaining.length) }, async () => {
    while (i < remaining.length) {
      const idx = i++;
      const sym = remaining[idx];
      try {
        const snap = await fetchOne(sym);
        cache.set(sym, { snap, cachedAt: Date.now() });
        if (snap) {
          out.set(sym, snap);
          okCount++;
        } else {
          errCount++;
        }
      } catch (err) {
        errCount++;
        cache.set(sym, { snap: null, cachedAt: Date.now() });
      }
    }
  });
  await Promise.all(workers);

  if (okCount + errCount > 0) {
    logger.debug(
      `[GEX-SNAPSHOT] batch fetched ${okCount} ok / ${errCount} fail of ${remaining.length}`,
    );
  }
  return out;
}

export async function getGexSnapshot(symbol: string): Promise<GexSnapshot | null> {
  const m = await getGexSnapshotBatch([symbol]);
  return m.get(symbol.toUpperCase()) ?? null;
}

export function clearGexSnapshotCache(): void {
  cache.clear();
}
