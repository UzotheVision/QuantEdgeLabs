/**
 * BTC TRACKER — Data Feed
 * =========================
 * Fetches BTC price (current + historical) and stock prices for beta calc.
 *
 * Data sources (free, no auth required):
 *   - BTC current:    CoinGecko simple/price endpoint
 *   - BTC historical: CoinGecko market_chart endpoint (90d daily candles)
 *   - Stock historical: yahoo-finance2 (already in package.json)
 *   - Stock current: existing tradier-api (re-uses platform's quote layer)
 *
 * Cached aggressively (5 min for current price, 1 hour for historical).
 * If a fetch fails, returns null and lets the caller decide — never throws.
 */

import { logger } from '../logger';

// ─── Types ──────────────────────────────────────────────────────────

export interface PriceBar {
  /** Unix timestamp ms */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const CACHE_TTL_CURRENT = 5 * 60 * 1000;   // 5 min for current price
const CACHE_TTL_HISTORY = 60 * 60 * 1000;  // 1 hour for historical
const _currentCache = new Map<string, CacheEntry<number>>();
const _historyCache = new Map<string, CacheEntry<PriceBar[]>>();

// ─── Current BTC price (CoinGecko) ──────────────────────────────────

export async function fetchBTCCurrent(): Promise<{
  price: number;
  change24h: number;
  change1h: number;
} | null> {
  const cached = _currentCache.get('btc');
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_CURRENT) {
    // Return last known price; for change pct we re-fetch on cache miss only
  }
  try {
    const url =
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_1hr_change=true';
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      logger.warn(`[BTC-FEED] CoinGecko current failed: ${res.status}`);
      return null;
    }
    const json = (await res.json()) as {
      bitcoin?: { usd?: number; usd_24h_change?: number; usd_1h_change?: number };
    };
    const btc = json.bitcoin;
    if (!btc?.usd) return null;
    _currentCache.set('btc', { data: btc.usd, fetchedAt: Date.now() });
    return {
      price: btc.usd,
      change24h: btc.usd_24h_change ?? 0,
      change1h: btc.usd_1h_change ?? 0,
    };
  } catch (e) {
    logger.warn(`[BTC-FEED] BTC current threw: ${(e as Error).message}`);
    return null;
  }
}

// ─── Historical BTC daily candles ───────────────────────────────────

export async function fetchBTCHistorical(days = 90): Promise<PriceBar[] | null> {
  const cacheKey = `btc-${days}d`;
  const cached = _historyCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_HISTORY) {
    return cached.data;
  }
  try {
    const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      logger.warn(`[BTC-FEED] CoinGecko history failed: ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { prices?: [number, number][] };
    if (!Array.isArray(json.prices)) return null;
    // CoinGecko gives [timestamp, price] pairs with daily granularity
    const bars: PriceBar[] = json.prices.map(([ts, p]) => ({
      timestamp: ts,
      open: p,
      high: p,
      low: p,
      close: p,
    }));
    _historyCache.set(cacheKey, { data: bars, fetchedAt: Date.now() });
    return bars;
  } catch (e) {
    logger.warn(`[BTC-FEED] BTC history threw: ${(e as Error).message}`);
    return null;
  }
}

// ─── Stock historical (Yahoo Finance via yahoo-finance2) ────────────

/**
 * Fetch daily closes for a stock symbol over the last `days` days.
 * Uses yahoo-finance2 if available, falls back to a stub if not installed.
 */
export async function fetchStockHistorical(
  symbol: string,
  days = 90,
): Promise<PriceBar[] | null> {
  const cacheKey = `${symbol}-${days}d`;
  const cached = _historyCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_HISTORY) {
    return cached.data;
  }
  try {
    // Dynamic import so missing package doesn't break the build
    const yfMod: any = await import('yahoo-finance2' as any).catch(() => null);
    if (!yfMod) {
      logger.warn('[BTC-FEED] yahoo-finance2 not installed — cannot fetch stock history');
      return null;
    }
    const yf = yfMod.default ?? yfMod;
    const period2 = new Date();
    const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await yf.historical(symbol, {
      period1,
      period2,
      interval: '1d' as const,
    });
    if (!Array.isArray(result) || result.length === 0) return null;
    const bars: PriceBar[] = result.map((r: any) => ({
      timestamp: new Date(r.date).getTime(),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
    _historyCache.set(cacheKey, { data: bars, fetchedAt: Date.now() });
    return bars;
  } catch (e) {
    logger.warn(`[BTC-FEED] Stock history failed for ${symbol}: ${(e as Error).message}`);
    return null;
  }
}

// ─── Pair alignment ─────────────────────────────────────────────────

/**
 * Align two price series by timestamp. Returns the closes from both series
 * for dates that appear in both — required for clean beta computation.
 */
export function alignByDate(
  a: PriceBar[],
  b: PriceBar[],
  toleranceHours = 24,
): { aClose: number[]; bClose: number[] } {
  const toleranceMs = toleranceHours * 60 * 60 * 1000;
  const aClose: number[] = [];
  const bClose: number[] = [];
  let bIdx = 0;
  for (const aBar of a) {
    while (bIdx < b.length && b[bIdx].timestamp < aBar.timestamp - toleranceMs) bIdx++;
    if (bIdx >= b.length) break;
    if (Math.abs(b[bIdx].timestamp - aBar.timestamp) <= toleranceMs) {
      aClose.push(aBar.close);
      bClose.push(b[bIdx].close);
    }
  }
  return { aClose, bClose };
}

// ─── Convenience: fetch BTC + stock pair ready for beta calc ───────

export async function fetchPairForBeta(
  stockSymbol: string,
  days = 90,
): Promise<{ stockCloses: number[]; btcCloses: number[]; bars: number } | null> {
  const [btc, stock] = await Promise.all([
    fetchBTCHistorical(days),
    fetchStockHistorical(stockSymbol, days),
  ]);
  if (!btc || !stock) return null;
  const { aClose: stockCloses, bClose: btcCloses } = alignByDate(stock, btc);
  if (stockCloses.length < 5) {
    logger.warn(`[BTC-FEED] Insufficient aligned bars for ${stockSymbol}: ${stockCloses.length}`);
    return null;
  }
  return { stockCloses, btcCloses, bars: stockCloses.length };
}
