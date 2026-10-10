/**
 * HISTORICAL CANDLES — one callable source of daily bars.
 *
 * This logic lived inline inside the /api/historical-prices route, which meant
 * the only way for other server code to reach it was to make an HTTP request
 * back to its own process. early-rotation did exactly that, once per candidate
 * symbol, sequentially — so every name cost a full request/response cycle
 * (socket, routing, JSON serialise, JSON parse) stacked on top of the upstream
 * fetch it was actually there to do. That endpoint measured 13.8 seconds to
 * produce two kilobytes.
 *
 * The fan-out is the bug, not the fetching. Extracting the body into a function
 * lets in-process callers call it, and lets them do so concurrently, while the
 * route keeps serving the same shape to the browser. The provider cache still
 * coalesces concurrent callers for the same symbol into one upstream request, so
 * parallelism here costs no extra load on Yahoo.
 */
import { cachedFetchWithStale } from './provider-cache';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const RANGE_MAP: Record<string, string> = {
  '1D': '1d', '5D': '5d', '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y', '5Y': '5y',
  '1d': '1d', '5d': '5d', '1mo': '1mo', '3mo': '3mo', '6mo': '6mo', '1y': '1y', '5y': '5y',
};

export function normalizeRange(raw: string | undefined, fallback = '1mo'): string {
  return RANGE_MAP[raw ?? ''] ?? fallback;
}

function startDateFor(range: string): Date {
  const now = Date.now();
  const DAY = 86_400_000;
  switch (range) {
    case '1d': return new Date(now - 2 * DAY);
    case '5d': return new Date(now - 7 * DAY);
    case '1mo': return new Date(now - 32 * DAY);
    case '3mo': return new Date(now - 95 * DAY);
    case '6mo': return new Date(now - 190 * DAY);
    case '1y': return new Date(now - 370 * DAY);
    case '5y': return new Date(now - 5 * 370 * DAY);
    default: return new Date(now - 32 * DAY);
  }
}

/**
 * Daily (or intraday) bars for one symbol, already filtered to complete rows.
 * Returns an empty array rather than throwing — a missing chart must degrade one
 * panel, never take down a caller that is fetching twenty other things.
 */
export async function fetchCandles(
  symbol: string,
  range = '6mo',
  interval = '1d',
): Promise<Candle[]> {
  const r = normalizeRange(range, '6mo');
  const includeExtended =
    interval === '1h' || interval === '5m' || interval === '15m' || interval === '1d';
  const period1 = Math.floor(startDateFor(r).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  try {
    const result: any = await cachedFetchWithStale(
      `yahoo:chart:${symbol}:${r}:${interval}`,
      // Daily bars only change once a day apart from the forming last candle, so
      // a 60s TTL meant a scan over 80 symbols re-fetched the whole set every
      // minute for data that had not moved. Intraday intervals keep the short TTL.
      interval === '1d' ? 10 * 60_000 : 60_000,
      30 * 60_000,
      async () => {
        const url =
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
          `?period1=${period1}&period2=${period2}&interval=${interval}` +
          `&includePrePost=${includeExtended}`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!resp.ok) throw new Error(`yahoo chart ${resp.status}`);
        const body: any = await resp.json();
        const res = body?.chart?.result?.[0];
        if (!res) throw new Error('yahoo chart: empty result');

        const stamps: number[] = res.timestamp || [];
        const q = res.indicators?.quote?.[0] || {};
        const adj: Array<number | null> = res.indicators?.adjclose?.[0]?.adjclose ?? [];
        const meta = res.meta ?? {};
        const quotes = stamps.map((t: number, i: number) => ({
          date: new Date(t * 1000),
          open: q.open?.[i], high: q.high?.[i], low: q.low?.[i],
          close: q.close?.[i], volume: q.volume?.[i], adjclose: adj?.[i],
        }));
        return { quotes, meta };
      },
    );

    // Yahoo quirk (found 2026-09-22): for hours after each close, the just-
    // completed session's daily bar comes back with close=null and the old
    // null-filter DROPPED THE WHOLE BAR — every chart (and the TA engine)
    // was missing the latest session, worst on the biggest-move days. Repair
    // the close from adjclose, or for the final bar from Yahoo's own
    // meta.regularMarketPrice, which is the official close of that session.
    const meta: any = (result as any)?.meta ?? {};
    const rows: any[] = result?.quotes ?? [];
    const lastIdx = rows.length - 1;
    return rows
      .map((q: any, i: number) => {
        let close = q.close ?? q.adjclose ?? null;
        if (
          close == null && i === lastIdx &&
          Number.isFinite(meta.regularMarketPrice) &&
          Number.isFinite(meta.regularMarketTime) &&
          Math.abs(meta.regularMarketTime * 1000 - new Date(q.date).getTime()) < 24 * 3600_000
        ) {
          close = meta.regularMarketPrice;
        }
        return { ...q, close };
      })
      .filter((q: any) => q.open != null && q.high != null && q.low != null && q.close != null)
      .map((q: any) => ({
        time: Math.floor(new Date(q.date).getTime() / 1000),
        open: q.open, high: q.high, low: q.low, close: q.close,
        volume: q.volume || 0,
      }));
  } catch {
    return [];
  }
}

/**
 * Bars for many symbols at once, bounded so a large fan-out cannot open an
 * unlimited number of sockets. Concurrency is safe here because the provider
 * cache collapses duplicate in-flight requests and the rate limiter still
 * governs what actually reaches the upstream.
 */
export async function fetchCandlesBatch(
  symbols: string[],
  range = '6mo',
  interval = '1d',
  concurrency = 8,
): Promise<Map<string, Candle[]>> {
  const out = new Map<string, Candle[]>();
  for (let i = 0; i < symbols.length; i += concurrency) {
    const slice = symbols.slice(i, i + concurrency);
    const rows = await Promise.all(slice.map((s) => fetchCandles(s, range, interval)));
    slice.forEach((s, n) => out.set(s, rows[n]));
  }
  return out;
}
