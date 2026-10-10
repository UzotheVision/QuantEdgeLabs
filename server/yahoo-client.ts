/**
 * YAHOO CLIENT — one throttled door to a provider we were kicking down.
 *
 * 37 files called query1/query2.finance.yahoo.com directly and two of them went
 * through the shared rate limiter. The result was predictable: scanners, the
 * conviction rebuild, the rotation map and the quote service all bursting at once,
 * Yahoo returning 429, and then EVERY price on the platform freezing — because
 * Tradier is 401 on an unfunded account, so Yahoo is not a fallback, it is the
 * only source. A user watching a live board sees numbers that never move and
 * concludes the app is broken. It is, and we broke it ourselves.
 *
 * Everything goes through here now: one global limiter, a short cache so repeated
 * asks for the same symbol cost one request, host failover, and one retry on a
 * 429 rather than a burst of them.
 */
import { logger } from './logger';
import { rateLimited, cachedFetch } from './provider-cache';

const HOSTS = ['query2', 'query1'] as const;

/** Yahoo tolerates roughly this cadence before it starts refusing. */
const MIN_GAP_MS = 350;

/** Same symbol asked for twice inside this window costs one request. */
const QUOTE_TTL_MS = 8_000;

let _throttled429Until = 0;

/**
 * Raw throttled GET against Yahoo's chart API. Returns null rather than throwing:
 * a missing quote must degrade a panel, never take down a request that was
 * fetching twenty other things.
 */
export async function yahooChart(
  symbol: string,
  opts: { range?: string; interval?: string; includePrePost?: boolean } = {},
): Promise<any | null> {
  const range = opts.range ?? '1d';
  const interval = opts.interval ?? '1m';
  const pre = opts.includePrePost ? '&includePrePost=true' : '';
  const key = `yahoo:${symbol}:${range}:${interval}:${pre}`;

  // While Yahoo is actively refusing, stop asking. Continuing to hammer a host
  // that just 429'd is what turns a brief throttle into a long one.
  if (Date.now() < _throttled429Until) {
    logger.debug(`[YAHOO] backing off, skipping ${symbol}`);
    return null;
  }

  return cachedFetch(key, QUOTE_TTL_MS, async () =>
    rateLimited('yahoo', MIN_GAP_MS, async () => {
      for (const host of HOSTS) {
        try {
          const r = await fetch(
            `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}${pre}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } },
          );
          if (r.status === 429) {
            // Sit out a window rather than rotating hosts into the same wall.
            _throttled429Until = Date.now() + 30_000;
            logger.warn(`[YAHOO] 429 on ${symbol} — backing off 30s`);
            return null;
          }
          if (!r.ok) continue;
          const j = await r.json();
          if (j?.chart?.result?.[0]) return j;
        } catch {
          // try the other host
        }
      }
      return null;
    }),
  );
}

export interface YahooQuote {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  at: number;
}

/** A single current quote, or null when the provider genuinely has nothing. */
export async function yahooQuote(symbol: string): Promise<YahooQuote | null> {
  const j = await yahooChart(symbol, { range: '1d', interval: '1m', includePrePost: true });
  const res = j?.chart?.result?.[0];
  const m = res?.meta;
  if (!m) return null;

  // `regularMarketPrice` freezes at yesterday's close outside regular hours.
  // The final non-null 1m chart bar is the real latest print in pre/post market;
  // use it so the terminal does not pretend a moving tape is static.
  const closes: unknown[] = res.indicators?.quote?.[0]?.close ?? [];
  const timestamps: unknown[] = res.timestamp ?? [];
  const volumes: unknown[] = res.indicators?.quote?.[0]?.volume ?? [];
  let index = closes.length - 1;
  while (index >= 0 && !Number.isFinite(Number(closes[index]))) index--;

  const chartPrice = index >= 0 ? Number(closes[index]) : NaN;
  const price = Number.isFinite(chartPrice) && chartPrice > 0
    ? chartPrice
    : Number(m.regularMarketPrice ?? m.previousClose);
  const prev = Number(m.chartPreviousClose ?? m.previousClose ?? price);
  if (!(price > 0)) return null;

  const barAt = Number(timestamps[index]);
  const barVolume = Number(volumes[index]);

  return {
    symbol: symbol.toUpperCase(),
    price,
    previousClose: prev,
    change: price - prev,
    changePercent: prev > 0 ? ((price - prev) / prev) * 100 : 0,
    volume: Number.isFinite(barVolume) ? barVolume : Number(m.regularMarketVolume ?? 0),
    // Preserve the market's timestamp. Consumer UI uses this to distinguish a
    // fresh print from a fresh HTTP response that happened to contain old data.
    at: Number.isFinite(barAt) && barAt > 0 ? barAt * 1000 : Date.now(),
  };
}

/** Are we currently in a back-off window? Surfaced so the UI can say "stale". */
export function yahooBackoffRemainingMs(): number {
  return Math.max(0, _throttled429Until - Date.now());
}

/**
 * Yahoo's predefined screeners — the only candidate source on hand that returns
 * names we have NOT already thought of. Everything else in the platform reads
 * from a curated allowlist, which by construction can only re-rank what someone
 * already added. Discovery has to begin somewhere outside that.
 *
 * Uses the same limiter, cache and 429 back-off as every other call here.
 */
export async function yahooScreener(
  screenId: string,
  count = 50,
): Promise<Array<{ symbol: string; price: number; changePct: number; volume: number; marketCap: number | null }>> {
  if (Date.now() < _throttled429Until) {
    logger.debug(`[YAHOO] backing off, skipping screener ${screenId}`);
    return [];
  }

  const key = `yahoo:screener:${screenId}:${count}`;
  const j = await cachedFetch(key, 5 * 60_000, async () =>
    rateLimited('yahoo', MIN_GAP_MS, async () => {
      for (const host of HOSTS) {
        try {
          const r = await fetch(
            `https://${host}.finance.yahoo.com/v1/finance/screener/predefined/saved`
              + `?scrIds=${encodeURIComponent(screenId)}&count=${count}`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } },
          );
          if (r.status === 429) {
            _throttled429Until = Date.now() + 30_000;
            logger.warn(`[YAHOO] 429 on screener ${screenId} — backing off 30s`);
            return null;
          }
          if (!r.ok) continue;
          const body = await r.json();
          if (body?.finance?.result?.[0]) return body;
        } catch {
          // try the other host
        }
      }
      return null;
    }),
  );

  const quotes = j?.finance?.result?.[0]?.quotes ?? [];
  return quotes
    .filter((q: any) => q?.symbol)
    .map((q: any) => ({
      symbol: String(q.symbol).toUpperCase(),
      price: Number(q.regularMarketPrice ?? 0),
      changePct: Number(q.regularMarketChangePercent ?? 0),
      volume: Number(q.regularMarketVolume ?? 0),
      marketCap: Number.isFinite(q.marketCap) ? Number(q.marketCap) : null,
    }));
}
