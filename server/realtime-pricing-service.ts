import { logger } from './logger';
import { fetchStockPrice, fetchCryptoPrice, fetchYahooFinancePrice } from './market-api';
import { getTradierQuote, getOptionMark } from './tradier-api';
import { yahooQuote } from './yahoo-client';
import { getFuturesPrice, getFuturesPrices } from './futures-data-service';

export interface RealtimeQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  lastUpdate: Date;
  assetType: string;
  /** Market-data provenance for consumers that must distinguish a mark from a fill. */
  source?: string;
  /** True when the venue reports a delayed chain rather than a realtime mark. */
  delayed?: boolean;
}

export type AssetType = 'stock' | 'crypto' | 'option' | 'futures';

interface CacheEntry {
  quote: RealtimeQuote;
  timestamp: number;
}

const CACHE_TTL: Record<AssetType, number> = {
  stock: 10 * 1000,     // 10 seconds (Tradier real-time)
  crypto: 30 * 1000,    // 30 seconds (CoinGecko rate limits)
  option: 15 * 1000,    // 15 seconds (Tradier)
  futures: 5 * 1000,    // 5 seconds (Yahoo Finance)
};

const quoteCache = new Map<string, CacheEntry>();

function getCacheKey(symbol: string, assetType: AssetType): string {
  return `${assetType}:${symbol.toUpperCase()}`;
}

function isCacheValid(entry: CacheEntry | undefined, assetType: AssetType): boolean {
  if (!entry) return false;
  const ttl = CACHE_TTL[assetType];
  return Date.now() - entry.timestamp < ttl;
}

async function fetchStockQuote(symbol: string): Promise<RealtimeQuote | null> {
  const tradierKey = process.env.TRADIER_API_KEY;
  
  if (tradierKey) {
    const quote = await getTradierQuote(symbol, tradierKey);
    if (quote) {
      return {
        symbol: quote.symbol.toUpperCase(),
        name: quote.description || quote.symbol,
        price: quote.last,
        change: quote.change,
        changePercent: quote.change_percentage,
        high: quote.high,
        low: quote.low,
        volume: quote.volume,
        lastUpdate: new Date(),
        assetType: 'stock',
      };
    }
  }

  // Tradier is 401 on an unfunded account, so Yahoo is not a fallback here — it is
  // the only source. It was being called from 37 unthrottled places at once, which
  // earned us a 429 and froze every price on the board. Everything now goes through
  // the one throttled client with a short cache and a real back-off.
  const yq = await yahooQuote(symbol);
  if (yq) {
    return {
      symbol: yq.symbol,
      name: yq.symbol,
      price: yq.price,
      change: yq.change,
      changePercent: yq.changePercent,
      high: yq.price,
      low: yq.price,
      volume: yq.volume,
      lastUpdate: new Date(yq.at),
      assetType: 'stock',
    };
  }

  /**
   * Cash indices are not equities, so no equity path can ever price them.
   *
   * SPX, NDX, RUT and VIX have no shares to quote — Tradier, Yahoo and the
   * legacy path all return nothing, forever. An open SPX idea therefore never
   * got a live price, the lifecycle reconciler could never observe its trigger,
   * and it sat at PENDING TRIGGER indefinitely regardless of where the index
   * actually went.
   *
   * CBOE serves index levels free under an underscore-prefixed symbol
   * (`_SPX.json`), 15-minute delayed. Delayed is fine here: the reconciler also
   * consults persisted highs/lows, so a trigger that traded between polls is
   * still caught.
   */
  const idx = await fetchIndexQuote(symbol);
  if (idx) return idx;

  // Last resort: the legacy multi-source path. Kept because it reaches providers
  // the client does not, but it is no longer the first thing tried.
  const marketData = await fetchStockPrice(symbol);
  if (marketData) {
    return {
      symbol: marketData.symbol,
      name: marketData.symbol,
      price: marketData.currentPrice,
      change: (marketData.currentPrice * marketData.changePercent) / 100,
      changePercent: marketData.changePercent,
      high: marketData.high24h || marketData.currentPrice,
      low: marketData.low24h || marketData.currentPrice,
      volume: marketData.volume,
      lastUpdate: new Date(),
      assetType: 'stock',
    };
  }

  return null;
}

/** Cash indices CBOE publishes under an underscore prefix. Not tradeable equities. */
const CASH_INDICES = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'DJX', 'XSP']);

async function fetchIndexQuote(symbol: string): Promise<RealtimeQuote | null> {
  const sym = symbol.toUpperCase().replace(/^\^/, '');
  if (!CASH_INDICES.has(sym)) return null;
  try {
    const res = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/_${sym}.json`);
    if (!res.ok) return null;
    const j: any = await res.json();
    const d = j?.data;
    const price = Number(d?.current_price);
    if (!Number.isFinite(price) || price <= 0) return null;
    const prev = Number(d?.prev_day_close);
    const change = Number.isFinite(prev) && prev > 0 ? price - prev : 0;
    logger.info(`[REALTIME-PRICING] Index quote for ${sym}: ${price} (CBOE, delayed)`);
    return {
      symbol: sym,
      name: sym,
      price,
      change,
      changePercent: Number.isFinite(prev) && prev > 0 ? (change / prev) * 100 : 0,
      high: price,
      low: price,
      volume: 0,
      lastUpdate: new Date(),
      assetType: 'stock',
    };
  } catch {
    return null;
  }
}

async function fetchCryptoQuote(symbol: string): Promise<RealtimeQuote | null> {
  const marketData = await fetchCryptoPrice(symbol);
  if (marketData) {
    return {
      symbol: marketData.symbol,
      name: marketData.symbol,
      price: marketData.currentPrice,
      change: (marketData.currentPrice * marketData.changePercent) / 100,
      changePercent: marketData.changePercent,
      high: marketData.high24h || marketData.currentPrice,
      low: marketData.low24h || marketData.currentPrice,
      volume: marketData.volume,
      lastUpdate: new Date(),
      assetType: 'crypto',
    };
  }
  return null;
}

/** OCC symbol: root + YYMMDD + C/P + 8-digit strike, e.g. NVDA260918C00220000. */
const OCC_RE = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;

async function fetchOptionQuote(symbol: string): Promise<RealtimeQuote | null> {
  // Callers were passing bare underlyings ("AMZN") with assetType 'option', so every
  // lookup asked the quote API for a contract that doesn't exist — 411 of 412 in one
  // batch — and logged "No data returned", which reads like a provider outage rather
  // than a malformed request. A bare ticker names no strike and no expiry, so there is
  // no contract to price: fail immediately and say why, instead of burning a network
  // call per position and blaming the vendor.
  if (!OCC_RE.test(symbol.toUpperCase())) {
    logger.warn(
      `[REALTIME-PRICING] "${symbol}" is not an OCC option symbol (expected e.g. NVDA260918C00220000). ` +
      `Something upstream classified an underlying as an option — pass the contract symbol, ` +
      `or route it as a stock quote.`,
    );
    return null;
  }

  const quote = await getOptionMark({ occSymbol: symbol });
  if (quote) {
    return {
      symbol: symbol.toUpperCase(),
      name: symbol,
      price: quote.last || quote.mid,
      change: 0,
      changePercent: 0,
      high: quote.ask,
      low: quote.bid,
      volume: 0,
      lastUpdate: new Date(),
      assetType: 'option',
      source: quote.source,
      delayed: quote.delayed,
    };
  }
  return null;
}

async function fetchFuturesQuote(symbol: string): Promise<RealtimeQuote | null> {
  try {
    const yahooData = await fetchYahooFinancePrice(symbol);
    if (yahooData) {
      return {
        symbol: yahooData.symbol,
        name: yahooData.symbol,
        price: yahooData.currentPrice,
        change: (yahooData.currentPrice * yahooData.changePercent) / 100,
        changePercent: yahooData.changePercent,
        high: yahooData.high24h || yahooData.currentPrice,
        low: yahooData.low24h || yahooData.currentPrice,
        volume: yahooData.volume,
        lastUpdate: new Date(),
        assetType: 'futures',
      };
    }
  } catch (error) {
    logger.debug(`Yahoo Finance futures fetch failed for ${symbol}, trying futures-data-service`);
  }

  try {
    const price = await getFuturesPrice(symbol);
    return {
      symbol: symbol.toUpperCase(),
      name: symbol,
      price: price,
      change: 0,
      changePercent: 0,
      high: price,
      low: price,
      volume: 0,
      lastUpdate: new Date(),
      assetType: 'futures',
    };
  } catch (error) {
    logger.warn(`Failed to fetch futures price for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function getRealtimeQuote(
  symbol: string,
  assetType: AssetType
): Promise<RealtimeQuote | null> {
  const cacheKey = getCacheKey(symbol, assetType);
  const cached = quoteCache.get(cacheKey);

  if (isCacheValid(cached, assetType)) {
    logger.debug(`[REALTIME-PRICING] Cache hit for ${cacheKey}`);
    return cached!.quote;
  }

  logger.debug(`[REALTIME-PRICING] Fetching ${assetType} quote for ${symbol}`);

  let quote: RealtimeQuote | null = null;

  try {
    switch (assetType) {
      case 'stock':
        quote = await fetchStockQuote(symbol);
        break;
      case 'crypto':
        quote = await fetchCryptoQuote(symbol);
        break;
      case 'option':
        quote = await fetchOptionQuote(symbol);
        break;
      case 'futures':
        quote = await fetchFuturesQuote(symbol);
        break;
      default:
        logger.error(`[REALTIME-PRICING] Unknown asset type: ${assetType}`);
        return null;
    }

    if (quote) {
      quoteCache.set(cacheKey, {
        quote,
        timestamp: Date.now(),
      });
      logger.info(`[REALTIME-PRICING] Fetched ${assetType} quote for ${symbol}: $${quote.price.toFixed(2)}`);
    } else if (cached) {
      // Live fetch returned nothing (provider rate-limit/outage). Serve the last
      // known price rather than dropping the symbol — keeps the UI consistent
      // (no disappearing rows / divergent prices) instead of showing a gap.
      logger.warn(`[REALTIME-PRICING] No fresh data for ${assetType} ${symbol}, serving stale cache (${Math.round((Date.now() - cached.timestamp) / 1000)}s old)`);
      return cached.quote;
    } else {
      logger.warn(`[REALTIME-PRICING] No data returned for ${assetType} ${symbol}`);
    }
  } catch (error) {
    logger.error(`[REALTIME-PRICING] Error fetching ${assetType} quote for ${symbol}:`, error);
    // Fall back to stale cache on hard error too.
    if (cached) return cached.quote;
    return null;
  }

  return quote;
}

export async function getRealtimeBatchQuotes(
  requests: Array<{ symbol: string; assetType: AssetType }>
): Promise<Map<string, RealtimeQuote>> {
  const results = new Map<string, RealtimeQuote>();
  
  if (requests.length === 0) {
    return results;
  }

  logger.info(`[REALTIME-PRICING] Batch fetching ${requests.length} quotes`);

  const grouped: Record<AssetType, string[]> = {
    stock: [],
    crypto: [],
    option: [],
    futures: [],
  };

  const uncachedRequests: Array<{ symbol: string; assetType: AssetType }> = [];

  for (const req of requests) {
    const cacheKey = getCacheKey(req.symbol, req.assetType);
    const cached = quoteCache.get(cacheKey);

    if (isCacheValid(cached, req.assetType)) {
      results.set(req.symbol, cached!.quote);
    } else {
      uncachedRequests.push(req);
      grouped[req.assetType].push(req.symbol);
    }
  }

  logger.debug(`[REALTIME-PRICING] Cache hits: ${results.size}, fetching: ${uncachedRequests.length}`);

  if (grouped.futures.length > 0) {
    try {
      const futuresPrices = await getFuturesPrices(grouped.futures);
      for (const [contractCode, price] of Array.from(futuresPrices.entries())) {
        const quote: RealtimeQuote = {
          symbol: contractCode,
          name: contractCode,
          price,
          change: 0,
          changePercent: 0,
          high: price,
          low: price,
          volume: 0,
          lastUpdate: new Date(),
          assetType: 'futures',
        };
        results.set(contractCode, quote);
        quoteCache.set(getCacheKey(contractCode, 'futures'), {
          quote,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      logger.error('[REALTIME-PRICING] Batch futures fetch error:', error);
    }
  }

  const otherRequests = uncachedRequests.filter(r => r.assetType !== 'futures');
  
  await Promise.all(
    otherRequests.map(async (req) => {
      try {
        const quote = await getRealtimeQuote(req.symbol, req.assetType);
        if (quote) {
          results.set(req.symbol, quote);
        }
      } catch (error) {
        logger.error(`[REALTIME-PRICING] Batch fetch error for ${req.assetType}:${req.symbol}:`, error);
      }
    })
  );

  logger.info(`[REALTIME-PRICING] Batch complete: ${results.size}/${requests.length} quotes fetched`);

  return results;
}

export function clearCache(): void {
  const size = quoteCache.size;
  quoteCache.clear();
  logger.info(`[REALTIME-PRICING] Cleared cache (${size} entries)`);
}

export function getCacheStats(): {
  size: number;
  entries: Array<{ key: string; price: number; age: number }>;
} {
  const now = Date.now();
  const entries = Array.from(quoteCache.entries()).map(([key, entry]) => ({
    key,
    price: entry.quote.price,
    age: Math.floor((now - entry.timestamp) / 1000),
  }));

  return {
    size: quoteCache.size,
    entries,
  };
}
