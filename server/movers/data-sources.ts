/**
 * MOVERS — Data Sources
 * =======================
 * Fetches pre-market / after-hours / overnight quotes from Yahoo Finance
 * (free, no auth) and CoinGecko (for overnight crypto).
 *
 * Yahoo v8 chart endpoint exposes:
 *   meta.regularMarketPrice    — last RTH close (baseline)
 *   meta.preMarketPrice        — pre-market last
 *   meta.postMarketPrice       — after-hours last
 *   meta.regularMarketVolume   — yesterday's RTH volume
 *
 * Rate limit: ~50 req/min sustained. We batch with 200ms delay between
 * calls and cap concurrency at 4 to stay polite.
 *
 * Cache: 60s on quote, 5min on full universe scan results.
 */

import { logger } from '../logger';

interface YahooQuote {
  symbol: string;
  regularMarketPrice: number;
  regularMarketVolume?: number;
  preMarketPrice?: number;
  preMarketChangePercent?: number;
  postMarketPrice?: number;
  postMarketChangePercent?: number;
  marketState?: string;
  chartPreviousClose?: number;
}

const UA = 'Mozilla/5.0 (compatible; QuantEdge/1.0)';
const _quoteCache = new Map<string, { quote: YahooQuote; fetchedAt: number }>();
const QUOTE_TTL_MS = 60_000;

/**
 * Fetch a single Yahoo Finance quote including PM/AH fields.
 * Falls back gracefully (returns null) if the request fails — never throws.
 */
export async function fetchYahooQuote(symbol: string): Promise<YahooQuote | null> {
  // Cache check
  const cached = _quoteCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < QUOTE_TTL_MS) return cached.quote;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d&includePrePost=true`;
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) {
      logger.warn(`[MOVERS] Yahoo ${symbol}: HTTP ${r.status}`);
      return null;
    }
    const j = (await r.json()) as { chart?: { result?: any[] } };
    const result = j.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta ?? {};
    const quote: YahooQuote = {
      symbol: meta.symbol ?? symbol,
      regularMarketPrice: Number(meta.regularMarketPrice ?? 0),
      regularMarketVolume: Number(meta.regularMarketVolume ?? 0),
      preMarketPrice: meta.preMarketPrice ? Number(meta.preMarketPrice) : undefined,
      preMarketChangePercent: meta.preMarketChangePercent ? Number(meta.preMarketChangePercent) : undefined,
      postMarketPrice: meta.postMarketPrice ? Number(meta.postMarketPrice) : undefined,
      postMarketChangePercent: meta.postMarketChangePercent ? Number(meta.postMarketChangePercent) : undefined,
      marketState: meta.marketState ?? undefined,
      chartPreviousClose: Number(meta.chartPreviousClose ?? meta.previousClose ?? 0),
    };
    _quoteCache.set(symbol, { quote, fetchedAt: Date.now() });
    return quote;
  } catch (e) {
    logger.warn(`[MOVERS] Yahoo quote failed for ${symbol}: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Concurrency-limited batch fetcher.
 * Returns Map<symbol, YahooQuote> for the symbols that responded.
 */
export async function batchYahooQuotes(
  symbols: string[],
  concurrency = 4,
  delayMs = 200,
): Promise<Map<string, YahooQuote>> {
  const result = new Map<string, YahooQuote>();
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    const quotes = await Promise.all(batch.map(s => fetchYahooQuote(s)));
    quotes.forEach((q, idx) => {
      if (q) result.set(batch[idx], q);
    });
    if (i + concurrency < symbols.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return result;
}

// ─── Futures + crypto for overnight window ─────────────────────────

export interface OvernightSnapshot {
  futures: { symbol: string; price: number; changePct: number }[];
  crypto: { symbol: string; price: number; changePct: number }[];
  asOf: string;
}

/** Fetch ES/NQ/RTY/YM futures via Yahoo + BTC/ETH/SOL via CoinGecko */
export async function fetchOvernightSnapshot(): Promise<OvernightSnapshot> {
  const futureSymbols = ['ES=F', 'NQ=F', 'RTY=F', 'YM=F'];
  const futuresQuotes = await batchYahooQuotes(futureSymbols);
  const futures = Array.from(futuresQuotes.values()).map(q => ({
    symbol: q.symbol.replace('=F', ''),
    price: q.regularMarketPrice,
    changePct: q.chartPreviousClose
      ? ((q.regularMarketPrice - q.chartPreviousClose) / q.chartPreviousClose) * 100
      : 0,
  }));

  let crypto: { symbol: string; price: number; changePct: number }[] = [];
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) },
    );
    if (r.ok) {
      const j = (await r.json()) as Record<string, { usd: number; usd_24h_change: number }>;
      crypto = [
        { symbol: 'BTC', price: j.bitcoin?.usd ?? 0,  changePct: j.bitcoin?.usd_24h_change ?? 0 },
        { symbol: 'ETH', price: j.ethereum?.usd ?? 0, changePct: j.ethereum?.usd_24h_change ?? 0 },
        { symbol: 'SOL', price: j.solana?.usd ?? 0,   changePct: j.solana?.usd_24h_change ?? 0 },
      ].filter(c => c.price > 0);
    }
  } catch (e) {
    logger.warn(`[MOVERS] crypto snapshot failed: ${(e as Error).message}`);
  }

  return { futures, crypto, asOf: new Date().toISOString() };
}
