/**
 * PRE-MARKET SERVICE
 * ==================
 * Reusable batch fetcher for pre-market / opening-gap data, used by:
 *   - convictions-engine (pre-market layer + freshness rescue)
 *   - trade-desk gappers card
 *   - weekly-tracker auto-alerts
 *
 * Concept of "gap":
 *   - During pre-market hours (4:00am–9:30am ET): preMarketPrice vs prevClose
 *   - During regular hours (9:30am–4:00pm ET): today's open vs prevClose
 *   - After hours: postMarketPrice vs regular close (still useful as next-day signal)
 *
 * Source: Yahoo Finance chart endpoint with `includePrePost=true`. Yahoo
 * exposes `meta.preMarketPrice`, `meta.regularMarketPrice`,
 * `meta.regularMarketOpen`, `meta.previousClose`, `meta.postMarketPrice` —
 * everything we need without auth.
 *
 * Cached for 60s (pre-market data updates roughly minute-by-minute).
 */

import { logger } from "./logger";

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const CACHE_TTL_MS = 60 * 1000; // 60s
const REQUEST_TIMEOUT_MS = 4000;

export type GapPhase = "pre_market" | "regular" | "post_market" | "closed";

export interface PreMarketSnapshot {
  symbol: string;
  /** Most relevant "now" price — pre-market price during PM, regular during RTH, post during AH. */
  price: number;
  /** Yesterday's regular close. The "yesterday's anchor". */
  previousClose: number;
  /** Pre-market gap %: (preMarketPrice - prevClose) / prevClose * 100. Null if no PM trade yet. */
  preMarketGapPct: number | null;
  /** Opening gap %: (regularOpen - prevClose) / prevClose * 100. Null until market opens. */
  openingGapPct: number | null;
  /** Direction of the gap: 'up' if >0.5%, 'down' if <-0.5%, 'flat' otherwise. */
  gapDirection: "up" | "down" | "flat";
  /** Magnitude of the active gap (whichever is most relevant for current phase). */
  gapPct: number;
  /** Which trading phase the gap was sampled in. */
  phase: GapPhase;
  /** Server timestamp of fetch. */
  fetchedAt: string;
}

interface CacheEntry {
  snap: PreMarketSnapshot;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

function isFresh(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.cachedAt < CACHE_TTL_MS;
}

/**
 * Determine current US market phase based on Eastern time.
 * Pre-market: 04:00–09:30 ET, Regular: 09:30–16:00 ET, Post: 16:00–20:00 ET.
 * Weekends and holidays return "closed". Holiday detection is best-effort.
 */
export function currentMarketPhase(now = new Date()): GapPhase {
  const day = now.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  });
  if (day === "Sat" || day === "Sun") return "closed";

  const hm = now.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const [h, m] = hm.split(":").map(Number);
  const mins = h * 60 + m;

  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return "pre_market";
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "regular";
  if (mins >= 16 * 60 && mins < 20 * 60) return "post_market";
  return "closed";
}

async function fetchYahooMeta(symbol: string): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; QuantEdge/1.0)" },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.chart?.result?.[0]?.meta ?? null;
  } catch (err) {
    logger.debug(`[PRE-MARKET] Yahoo fetch failed for ${symbol}: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function metaToSnapshot(symbol: string, meta: any, phase: GapPhase): PreMarketSnapshot | null {
  if (!meta) return null;
  const previousClose = Number(meta.previousClose ?? meta.chartPreviousClose);
  if (!Number.isFinite(previousClose) || previousClose <= 0) return null;

  const preMarketPrice = Number(meta.preMarketPrice);
  const regularOpen = Number(meta.regularMarketOpen);
  const regularPrice = Number(meta.regularMarketPrice);
  const postMarketPrice = Number(meta.postMarketPrice);

  const preMarketGapPct = Number.isFinite(preMarketPrice) && preMarketPrice > 0
    ? ((preMarketPrice - previousClose) / previousClose) * 100
    : null;

  const openingGapPct = Number.isFinite(regularOpen) && regularOpen > 0
    ? ((regularOpen - previousClose) / previousClose) * 100
    : null;

  // Choose the active price by phase
  let price: number;
  let activeGap: number;
  if (phase === "pre_market" && Number.isFinite(preMarketPrice) && preMarketPrice > 0) {
    price = preMarketPrice;
    activeGap = preMarketGapPct ?? 0;
  } else if (phase === "post_market" && Number.isFinite(postMarketPrice) && postMarketPrice > 0) {
    price = postMarketPrice;
    activeGap = ((postMarketPrice - (Number.isFinite(regularPrice) ? regularPrice : previousClose)) /
      (Number.isFinite(regularPrice) ? regularPrice : previousClose)) * 100;
  } else if (Number.isFinite(regularPrice) && regularPrice > 0) {
    price = regularPrice;
    // Prefer the actual opening gap when available; fall back to the
    // full session change (regularPrice vs previousClose) so closed-phase
    // and post-close snapshots still surface meaningful movement.
    activeGap = openingGapPct ?? ((regularPrice - previousClose) / previousClose) * 100;
  } else if (Number.isFinite(preMarketPrice) && preMarketPrice > 0) {
    price = preMarketPrice;
    activeGap = preMarketGapPct ?? 0;
  } else {
    return null;
  }

  const gapDirection: "up" | "down" | "flat" =
    activeGap > 0.5 ? "up" : activeGap < -0.5 ? "down" : "flat";

  return {
    symbol: symbol.toUpperCase(),
    price,
    previousClose,
    preMarketGapPct,
    openingGapPct,
    gapDirection,
    gapPct: activeGap,
    phase,
    fetchedAt: new Date().toISOString(),
  };
}

/** Fetch a single symbol's pre-market snapshot (cached). */
export async function getPreMarketSnapshot(symbol: string): Promise<PreMarketSnapshot | null> {
  const key = symbol.toUpperCase();
  const cached = cache.get(key);
  if (isFresh(cached)) return cached!.snap;

  const phase = currentMarketPhase();
  const meta = await fetchYahooMeta(key);
  const snap = metaToSnapshot(key, meta, phase);
  if (snap) cache.set(key, { snap, cachedAt: Date.now() });
  return snap;
}

/**
 * Batch fetch with bounded concurrency. Returns a Map keyed by uppercase symbol.
 * Symbols not present in the map failed to fetch.
 */
export async function getPreMarketBatch(
  symbols: string[],
  concurrency = 6,
): Promise<Map<string, PreMarketSnapshot>> {
  const out = new Map<string, PreMarketSnapshot>();
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  if (unique.length === 0) return out;

  // Serve from cache first
  const remaining: string[] = [];
  for (const sym of unique) {
    const c = cache.get(sym);
    if (isFresh(c)) {
      out.set(sym, c!.snap);
    } else {
      remaining.push(sym);
    }
  }

  const phase = currentMarketPhase();
  // Worker pool
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, remaining.length) }, async () => {
    while (i < remaining.length) {
      const idx = i++;
      const sym = remaining[idx];
      const meta = await fetchYahooMeta(sym);
      const snap = metaToSnapshot(sym, meta, phase);
      if (snap) {
        cache.set(sym, { snap, cachedAt: Date.now() });
        out.set(sym, snap);
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/** Clear cache (used by tests / manual refresh). */
export function clearPreMarketCache(): void {
  cache.clear();
}
