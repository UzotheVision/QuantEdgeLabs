/**
 * ANALYST DATA SERVICE
 * ====================
 * Lightweight per-symbol analyst snapshot used by the conviction engine.
 *
 * The full FundamentalDataProvider already pulls Yahoo's `financialData`
 * module (which contains analyst recommendations) but discards the analyst
 * fields. Re-pulling the entire fundamentals payload just to get four
 * numbers is wasteful, so this service hits the same endpoint with only
 * the modules we need and caches at 6h.
 *
 * Returns:
 *   - recommendationKey   "strong_buy" | "buy" | "hold" | "underperform" | "sell"
 *   - recommendationMean  1.0 (strong buy) → 5.0 (sell)
 *   - targetMeanPrice     consensus 12mo target
 *   - numberOfAnalysts    sample size
 *   - upsidePct           (target − current) / current × 100, computed at score time
 */

import { logger } from "./logger";
import { safeQuoteSummary } from "./yahoo-finance-service";

export interface AnalystSnapshot {
  symbol: string;
  recommendationKey: string | null;
  recommendationMean: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  numberOfAnalysts: number | null;
  fetchedAt: string;
}

interface CacheEntry {
  snapshot: AnalystSnapshot;
  fetchedAt: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const cache = new Map<string, CacheEntry>();

function isFresh(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

/**
 * Fetch analyst snapshot from Yahoo for a single symbol.
 *
 * Uses the shared yahoo-finance2 client (which manages cookies/crumbs).
 * The raw query2 endpoint rate-limits aggressively, but the library
 * handles auth properly. Returns null on any failure.
 *
 * We pull `financialData` (target prices + mean rec) and `recommendationTrend`
 * (analyst count + breakdown) — both are needed because financialData's
 * `numberOfAnalystOpinions` is sometimes missing for less-covered names.
 */
async function fetchFromYahoo(symbol: string): Promise<AnalystSnapshot | null> {
  try {
    const data = await safeQuoteSummary(symbol, ["financialData", "recommendationTrend"]);
    if (!data) {
      logger.debug(`[ANALYST] no data returned for ${symbol}`);
      return null;
    }

    const fd = data.financialData ?? {};
    const rt = data.recommendationTrend?.trend?.[0] ?? null;

    // yahoo-finance2 returns parsed numbers directly (no .raw wrapper)
    const num = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: any): string | null => (typeof v === "string" && v.length > 0 ? v : null);

    let analystCount = num(fd.numberOfAnalystOpinions);
    if (analystCount === null && rt) {
      analystCount =
        (rt.strongBuy ?? 0) + (rt.buy ?? 0) + (rt.hold ?? 0) + (rt.sell ?? 0) + (rt.strongSell ?? 0);
      if (analystCount === 0) analystCount = null;
    }

    const snap: AnalystSnapshot = {
      symbol,
      recommendationKey: str(fd.recommendationKey),
      recommendationMean: num(fd.recommendationMean),
      targetMeanPrice: num(fd.targetMeanPrice),
      targetHighPrice: num(fd.targetHighPrice),
      targetLowPrice: num(fd.targetLowPrice),
      numberOfAnalysts: analystCount,
      fetchedAt: new Date().toISOString(),
    };

    if (
      snap.recommendationMean === null &&
      snap.targetMeanPrice === null &&
      snap.numberOfAnalysts === null
    ) {
      // Symbol has no analyst coverage at all (small caps, ETFs, crypto, etc.)
      return null;
    }

    return snap;
  } catch (err) {
    logger.debug(`[ANALYST] yahoo fetch failed for ${symbol}: ${err}`);
    return null;
  }
}

/**
 * Get a cached analyst snapshot. Returns null if Yahoo refuses or
 * the symbol has no analyst coverage.
 */
export async function getAnalystSnapshot(symbol: string): Promise<AnalystSnapshot | null> {
  const cached = cache.get(symbol);
  if (isFresh(cached)) return cached!.snapshot;

  const snap = await fetchFromYahoo(symbol);
  if (snap) {
    cache.set(symbol, { snapshot: snap, fetchedAt: Date.now() });
  }
  return snap;
}

/**
 * Batch helper — fetches multiple symbols with bounded concurrency.
 * Yahoo has no documented batch endpoint for this module, so we
 * parallelize at concurrency=4 to stay polite.
 */
export async function getAnalystSnapshots(symbols: string[]): Promise<Map<string, AnalystSnapshot>> {
  const results = new Map<string, AnalystSnapshot>();
  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < symbols.length) {
      const i = cursor++;
      const sym = symbols[i];
      const snap = await getAnalystSnapshot(sym);
      if (snap) results.set(sym, snap);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export function clearAnalystCache(): void {
  cache.clear();
}
