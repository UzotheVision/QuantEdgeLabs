/**
 * Yahoo Finance Service - Shared instance for all Yahoo Finance API calls
 *
 * yahoo-finance2 v3+ requires instantiation before use.
 * This service provides a properly initialized singleton instance.
 */

import { logger } from './logger';

let yahooFinanceInstance: any = null;
let initPromise: Promise<any> | null = null;

/**
 * Get the Yahoo Finance instance (lazy initialization)
 * This ensures only one instance is created and shared across the app.
 */
export async function getYahooFinance() {
  if (yahooFinanceInstance) {
    return yahooFinanceInstance;
  }

  // Prevent multiple simultaneous initializations
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const { default: YahooFinance } = await import('yahoo-finance2');
      yahooFinanceInstance = new YahooFinance({
        suppressNotices: ['ripHistorical', 'yahooSurvey'],
      });
      logger.info('[YAHOO] Yahoo Finance v3 instance initialized');
      return yahooFinanceInstance;
    } catch (error: any) {
      logger.error('[YAHOO] Failed to initialize Yahoo Finance:', error.message);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Safe quote fetch - handles errors gracefully
 */
export async function safeQuote(symbol: string): Promise<any | null> {
  try {
    const yf = await getYahooFinance();
    return await yf.quote(symbol);
  } catch (error: any) {
    logger.debug(`[YAHOO] Quote failed for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Get the best available price — uses post-market, pre-market, or regular market price
 * depending on which is most current. Essential for after-hours and pre-market moves.
 */
export function getBestPrice(quote: any): number {
  if (!quote) return 0;
  const state = quote.marketState;
  // During post-market session, use postMarketPrice if available
  if ((state === 'POST' || state === 'POSTPOST') && quote.postMarketPrice > 0) {
    return quote.postMarketPrice;
  }
  // During pre-market session, use preMarketPrice if available
  if ((state === 'PRE' || state === 'PREPRE') && quote.preMarketPrice > 0) {
    return quote.preMarketPrice;
  }
  return quote.regularMarketPrice || 0;
}

/**
 * Safe batch quote fetch - returns whatever succeeds
 */
export async function safeBatchQuotes(symbols: string[]): Promise<Record<string, any>> {
  const yf = await getYahooFinance();
  const results: Record<string, any> = {};

  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const quote = await yf.quote(symbol);
        if (quote) {
          results[symbol] = quote;
        }
      } catch (error: any) {
        logger.debug(`[YAHOO] Batch quote failed for ${symbol}:`, error.message);
      }
    })
  );

  return results;
}

/**
 * Safe screener fetch
 */
export async function safeScreener(params: { scrIds: string; count?: number }): Promise<any | null> {
  try {
    const yf = await getYahooFinance();
    return await yf.screener(params);
  } catch (error: any) {
    logger.debug(`[YAHOO] Screener failed:`, error.message);
    return null;
  }
}

/**
 * Get the most recent price from Yahoo chart API (1-minute candles).
 * This is more reliable than quote().regularMarketPrice which can be stale.
 */
export async function getChartLastPrice(symbol: string): Promise<number> {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return 0;

    // Get last valid close from candle data
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null && closes[i]! > 0) return closes[i]!;
    }

    // Fallback to meta
    return result.meta?.regularMarketPrice || 0;
  } catch {
    return 0;
  }
}

/**
 * Daily closing prices, oldest first.
 *
 * The raw query1 chart endpoint rate-limits hard once several scanners are
 * running — it answers 429 and callers that treat that as "no data" silently
 * lose their entire candidate pool. The library path carries the cookie/crumb
 * the rest of this service maintains, so it survives where a bare fetch does
 * not. Returns [] on failure; callers must not fabricate prices from it.
 */
export async function safeChartCloses(symbol: string, days: number): Promise<number[]> {
  const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    const yf = await getYahooFinance();
    const res = await yf.chart(symbol, { period1, interval: '1d' });
    const closes = (res?.quotes ?? [])
      .map((q: any) => q?.close)
      .filter((c: unknown): c is number => typeof c === 'number' && Number.isFinite(c) && c > 0);
    if (closes.length > 0) return closes;
    logger.debug(`[YAHOO] chart returned no closes for ${symbol}`);
  } catch (error: any) {
    logger.debug(`[YAHOO] chart failed for ${symbol}: ${error?.message ?? 'unknown'}`);
  }
  return [];
}

/**
 * Safe quote summary fetch
 */
export async function safeQuoteSummary(symbol: string, modules: string[]): Promise<any | null> {
  try {
    const yf = await getYahooFinance();
    const r = await yf.quoteSummary(symbol, { modules });
    if (r) return r;
  } catch (error: any) {
    logger.debug(`[YAHOO] Quote summary (lib) failed for ${symbol}:`, error.message);
  }
  // Library path can fail on schema validation / crumb — fall back to a raw
  // crumb-authenticated v10 fetch (same auth that keeps the options chain alive).
  return await quoteSummaryRaw(symbol, modules);
}

// ─── Crumb-authenticated raw quoteSummary fallback ─────────────────────
let _qsCrumb: string | null = null;
let _qsCookie: string | null = null;
let _qsCrumbAt = 0;
const QS_CRUMB_TTL = 30 * 60_000;
const QS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

async function getQsCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (_qsCrumb && _qsCookie && Date.now() - _qsCrumbAt < QS_CRUMB_TTL) {
    return { crumb: _qsCrumb, cookie: _qsCookie };
  }
  try {
    const initRes = await fetch('https://fc.yahoo.com', { redirect: 'manual', headers: { 'User-Agent': QS_UA } });
    const cookieStr = (initRes.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': QS_UA, 'Cookie': cookieStr },
    });
    if (!crumbRes.ok) return null;
    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes('<') || crumb.length > 50) return null;
    _qsCrumb = crumb; _qsCookie = cookieStr; _qsCrumbAt = Date.now();
    return { crumb, cookie: cookieStr };
  } catch {
    return null;
  }
}

export async function quoteSummaryRaw(symbol: string, modules: string[]): Promise<any | null> {
  const auth = await getQsCrumb();
  if (!auth) return null;
  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules.join(',')}&crumb=${encodeURIComponent(auth.crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': QS_UA, 'Cookie': auth.cookie } });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) { _qsCrumb = null; _qsCookie = null; }
      logger.debug(`[YAHOO] Raw quoteSummary ${res.status} for ${symbol}`);
      return null;
    }
    const data: any = await res.json();
    return data?.quoteSummary?.result?.[0] ?? null;
  } catch (e: any) {
    logger.debug(`[YAHOO] Raw quoteSummary error for ${symbol}: ${e.message}`);
    return null;
  }
}
