/**
 * MARKET BREADTH SERVICE
 * ======================
 * Computes the breadth indicators that the conviction engine has been
 * missing: advance/decline, new highs/lows, and % above 200/50-day MA.
 *
 * Why this matters:
 *   A name flagged "S band" during a deteriorating breadth tape is a
 *   very different trade than the same name in a thrust day. Without
 *   breadth, regime detection is just VIX + SPY direction — half-blind.
 *
 * Universe:
 *   ~120 large-cap representative names spanning every major sector.
 *   This is a proxy for the broader market — not the whole S&P 500 —
 *   so first-call latency is bounded and we don't hammer Tradier.
 *
 * Cache:
 *   - 30 minutes during market hours
 *   - 4 hours outside market hours (data barely changes overnight)
 *   - Background refresh kicks in via worker scheduler
 */

import { logger } from "./logger";
import { getRealtimeBatchQuotes, type RealtimeQuote } from "./realtime-pricing-service";
import { fetchHistoricalPrices } from "./market-api";
import {
  MEGA_CAP_TECH,
  FINANCIALS,
  HEALTHCARE,
  INDUSTRIALS,
  CONSUMER_DISCRETIONARY,
  CONSUMER_STAPLES,
  ENERGY,
  SEMICONDUCTORS,
  COMMUNICATION_SERVICES,
} from "./ticker-universe";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface MarketBreadthSnapshot {
  /** ISO timestamp this snapshot was computed. */
  generatedAt: string;
  /** How many tickers we successfully sampled. */
  sampleSize: number;

  // ── Daily participation ──
  advances: number;
  declines: number;
  unchanged: number;
  /** advances - declines */
  advanceDecline: number;
  /** advances / (advances + declines), 0..1 */
  advanceDeclineRatio: number;

  // ── New highs / lows (rolling 200-day) ──
  newHighs: number;
  newLows: number;
  newHighsLows: number;

  // ── Trend participation ──
  /** % of names above their 200-day SMA, 0..100 */
  percentAbove200MA: number;
  /** % of names above their 50-day SMA, 0..100 */
  percentAbove50MA: number;

  // ── Synthesised regime ──
  /** "thrust" | "expanding" | "neutral" | "deteriorating" | "washout" */
  regime: BreadthRegime;
  /** -10..+10 — positive favors longs, negative favors shorts. */
  bias: number;
  /** One-line human summary the conviction layer can quote. */
  interpretation: string;
}

export type BreadthRegime =
  | "thrust"          // strong broad participation, longs heavily favored
  | "expanding"       // healthy uptrend, slight long bias
  | "neutral"         // mixed, no edge
  | "deteriorating"   // breadth weakening under price, caution
  | "washout";        // broad selling, shorts favored OR oversold bounce setup

// ─────────────────────────────────────────────────────────────
// Universe — ~120 large-cap representative names
// ─────────────────────────────────────────────────────────────

const BREADTH_UNIVERSE: string[] = (() => {
  // Take the top names from each major sector. Bias toward S&P 500
  // membership so this is a true broad-market breadth proxy.
  const set = new Set<string>([
    ...MEGA_CAP_TECH.slice(0, 25),
    ...FINANCIALS.slice(0, 15),
    ...HEALTHCARE.slice(0, 15),
    ...INDUSTRIALS.slice(0, 12),
    ...CONSUMER_DISCRETIONARY.slice(0, 12),
    ...CONSUMER_STAPLES.slice(0, 10),
    ...ENERGY.slice(0, 10),
    ...SEMICONDUCTORS.slice(0, 12),
    ...COMMUNICATION_SERVICES.slice(0, 10),
  ]);
  return Array.from(set);
})();

// ─────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────

interface CacheEntry {
  snapshot: MarketBreadthSnapshot;
  computedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<MarketBreadthSnapshot> | null = null;

function isMarketHours(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  // 13:30–21:00 UTC ≈ 09:30–17:00 ET (incl. extended)
  return minutes >= 13 * 60 + 30 && minutes <= 21 * 60;
}

function cacheTtlMs(): number {
  return isMarketHours() ? 30 * 60 * 1000 : 4 * 60 * 60 * 1000;
}

function isCacheFresh(): boolean {
  if (!cache) return false;
  return Date.now() - cache.computedAt < cacheTtlMs();
}

// ─────────────────────────────────────────────────────────────
// Per-ticker historical price store (200-day window)
// We cache historicals separately at 24h to avoid hammering on every
// breadth refresh — only the latest close changes intraday.
// ─────────────────────────────────────────────────────────────

interface HistoryEntry {
  closes: number[];
  fetchedAt: number;
}

const historyCache = new Map<string, HistoryEntry>();
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function getHistoryFor(symbol: string): Promise<number[] | null> {
  const cached = historyCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < HISTORY_TTL_MS) {
    return cached.closes;
  }
  try {
    const closes = await fetchHistoricalPrices(symbol, "stock", 220);
    if (closes && closes.length >= 50) {
      historyCache.set(symbol, { closes, fetchedAt: Date.now() });
      return closes;
    }
  } catch (err) {
    logger.debug(`[BREADTH] history fetch failed for ${symbol}: ${err}`);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Breadth math
// ─────────────────────────────────────────────────────────────

function sma(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function classifyRegime(snap: Pick<
  MarketBreadthSnapshot,
  "advanceDeclineRatio" | "percentAbove200MA" | "percentAbove50MA" | "newHighsLows" | "sampleSize"
>): { regime: BreadthRegime; bias: number; interpretation: string } {
  const ad = snap.advanceDeclineRatio; // 0..1
  const p200 = snap.percentAbove200MA; // 0..100
  const p50 = snap.percentAbove50MA;
  const hl = snap.newHighsLows;

  // Thrust: broad rally (>=80% advancing) + healthy trend participation
  if (ad >= 0.8 && p50 >= 65 && p200 >= 55) {
    return {
      regime: "thrust",
      bias: 8,
      interpretation: `Breadth thrust — ${(ad * 100).toFixed(0)}% advancing, ${p200.toFixed(0)}% above 200MA. Strong long tape.`,
    };
  }

  // Washout: broad selloff or oversold extreme
  if (ad <= 0.2 && p50 <= 30) {
    return {
      regime: "washout",
      bias: -6,
      interpretation: `Washout — ${(ad * 100).toFixed(0)}% advancing, ${p50.toFixed(0)}% above 50MA. Short tape (or contrarian bounce setup).`,
    };
  }

  // Deteriorating: price holding but breadth eroding (classic divergence)
  if (p200 >= 50 && p50 <= 45 && hl <= 0) {
    return {
      regime: "deteriorating",
      bias: -3,
      interpretation: `Breadth weakening — ${p50.toFixed(0)}% above 50MA but ${hl} new highs vs lows. Caution on longs.`,
    };
  }

  // Expanding: healthy uptrend
  if (p200 >= 55 && ad >= 0.55) {
    return {
      regime: "expanding",
      bias: 4,
      interpretation: `Healthy expansion — ${p200.toFixed(0)}% above 200MA, ${(ad * 100).toFixed(0)}% advancing today.`,
    };
  }

  // Default: neutral/mixed
  return {
    regime: "neutral",
    bias: 0,
    interpretation: `Mixed breadth — ${(ad * 100).toFixed(0)}% advancing, ${p200.toFixed(0)}% above 200MA. No clear edge.`,
  };
}

// ─────────────────────────────────────────────────────────────
// Main computation
// ─────────────────────────────────────────────────────────────

async function computeBreadthSnapshot(): Promise<MarketBreadthSnapshot> {
  const startedAt = Date.now();
  logger.info(`[BREADTH] computing snapshot for ${BREADTH_UNIVERSE.length} symbols`);

  // 1. Quotes (current price + change %)
  const quoteRequests = BREADTH_UNIVERSE.map((symbol) => ({
    symbol,
    assetType: "stock" as const,
  }));
  const quotes = await getRealtimeBatchQuotes(quoteRequests);

  // 2. Historicals — parallel but capped to avoid Tradier saturation
  const concurrency = 8;
  const histories = new Map<string, number[]>();
  let cursor = 0;
  async function worker() {
    while (cursor < BREADTH_UNIVERSE.length) {
      const i = cursor++;
      const sym = BREADTH_UNIVERSE[i];
      if (!quotes.has(sym)) continue;
      const closes = await getHistoryFor(sym);
      if (closes) histories.set(sym, closes);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // 3. Tally
  let advances = 0;
  let declines = 0;
  let unchanged = 0;
  let newHighs = 0;
  let newLows = 0;
  let above200 = 0;
  let above50 = 0;
  let withTrend200 = 0;
  let withTrend50 = 0;
  let sampleSize = 0;

  for (const symbol of BREADTH_UNIVERSE) {
    const q: RealtimeQuote | undefined = quotes.get(symbol);
    if (!q || !Number.isFinite(q.price)) continue;
    sampleSize++;

    if (q.changePercent > 0.05) advances++;
    else if (q.changePercent < -0.05) declines++;
    else unchanged++;

    const closes = histories.get(symbol);
    if (closes && closes.length >= 50) {
      const last200 = closes.slice(-200);
      const last50 = closes.slice(-50);

      if (last200.length >= 100) {
        const sma200 = sma(last200);
        if (sma200 > 0) {
          withTrend200++;
          if (q.price > sma200) above200++;
        }

        // 200-day high/low check
        const maxClose = Math.max(...last200);
        const minClose = Math.min(...last200);
        if (q.price >= maxClose * 0.999) newHighs++;
        else if (q.price <= minClose * 1.001) newLows++;
      }

      const sma50 = sma(last50);
      if (sma50 > 0) {
        withTrend50++;
        if (q.price > sma50) above50++;
      }
    }
  }

  const advanceDecline = advances - declines;
  const advanceDeclineRatio =
    advances + declines > 0 ? advances / (advances + declines) : 0.5;
  const percentAbove200MA = withTrend200 > 0 ? (above200 / withTrend200) * 100 : 50;
  const percentAbove50MA = withTrend50 > 0 ? (above50 / withTrend50) * 100 : 50;

  const partial: Pick<
    MarketBreadthSnapshot,
    "advanceDeclineRatio" | "percentAbove200MA" | "percentAbove50MA" | "newHighsLows" | "sampleSize"
  > = {
    advanceDeclineRatio,
    percentAbove200MA,
    percentAbove50MA,
    newHighsLows: newHighs - newLows,
    sampleSize,
  };
  const { regime, bias, interpretation } = classifyRegime(partial);

  const snapshot: MarketBreadthSnapshot = {
    generatedAt: new Date().toISOString(),
    sampleSize,
    advances,
    declines,
    unchanged,
    advanceDecline,
    advanceDeclineRatio,
    newHighs,
    newLows,
    newHighsLows: newHighs - newLows,
    percentAbove200MA,
    percentAbove50MA,
    regime,
    bias,
    interpretation,
  };

  const elapsedMs = Date.now() - startedAt;
  logger.info(
    `[BREADTH] snapshot ready in ${elapsedMs}ms — sample=${sampleSize} regime=${regime} bias=${bias} adv=${advances}/${declines} >200MA=${percentAbove200MA.toFixed(0)}% >50MA=${percentAbove50MA.toFixed(0)}%`,
  );

  return snapshot;
}

// ─────────────────────────────────────────────────────────────
// Public entry
// ─────────────────────────────────────────────────────────────

/**
 * Get the current market breadth snapshot. Cached aggressively
 * (30min during RTH, 4h overnight). Safe to call from any layer.
 */
export async function getMarketBreadth(): Promise<MarketBreadthSnapshot> {
  if (isCacheFresh() && cache) return cache.snapshot;
  if (inflight) return inflight;

  inflight = computeBreadthSnapshot()
    .then((snapshot) => {
      cache = { snapshot, computedAt: Date.now() };
      return snapshot;
    })
    .catch((err) => {
      logger.error("[BREADTH] compute failed:", err);
      // Serve stale-on-error if we have anything in the cache
      if (cache) return cache.snapshot;
      // Last-resort empty snapshot so callers don't blow up
      return {
        generatedAt: new Date().toISOString(),
        sampleSize: 0,
        advances: 0,
        declines: 0,
        unchanged: 0,
        advanceDecline: 0,
        advanceDeclineRatio: 0.5,
        newHighs: 0,
        newLows: 0,
        newHighsLows: 0,
        percentAbove200MA: 50,
        percentAbove50MA: 50,
        regime: "neutral" as BreadthRegime,
        bias: 0,
        interpretation: "Breadth unavailable",
      };
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** For diagnostics / admin endpoints. */
export function getBreadthCacheInfo(): { hasCache: boolean; ageMs: number | null } {
  return {
    hasCache: cache !== null,
    ageMs: cache ? Date.now() - cache.computedAt : null,
  };
}
