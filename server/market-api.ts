import type { AssetType } from "@shared/schema";
import { getTradierQuote, getTradierHistory } from './tradier-api';
import { logger } from './logger';
import { massiveEnabled, fetchDailyCloses as fetchMassiveDailyCloses } from './massive-market-data';
import { logAPIError, logAPISuccess } from './monitoring-service';
import { getCryptoPrice as getRealtimeCryptoPrice, getFuturesPrice as getRealtimeFuturesPrice } from './realtime-price-service';
import { marketData as multiSourceMarketData, getStockPrice as getMultiSourcePrice } from './multi-source-market-data';

export interface ExternalMarketData {
  symbol: string;
  assetType: AssetType;
  currentPrice: number;
  changePercent: number;
  volume: number;
  avgVolume?: number;
  marketCap?: number;
  high24h?: number;
  low24h?: number;
}

const COINGECKO_API = "https://api.coingecko.com/api/v3";
const ALPHA_VANTAGE_API = "https://www.alphavantage.co/query";
const YAHOO_FINANCE_API = "https://query1.finance.yahoo.com/v8/finance/chart";

// Fallback cache for crypto prices when rate limited (stores last known good prices)
const cryptoPriceCache = new Map<string, { data: ExternalMarketData; timestamp: number }>();
const CRYPTO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for normal operations
const CRYPTO_FALLBACK_CACHE_TTL = 30 * 60 * 1000; // 30 minutes when rate limited (extended fallback)

// Yahoo Finance crypto symbols for backup data source
const YAHOO_CRYPTO_MAP: Record<string, string> = {
  'BTC': 'BTC-USD', 'ETH': 'ETH-USD', 'SOL': 'SOL-USD', 'BNB': 'BNB-USD',
  'XRP': 'XRP-USD', 'ADA': 'ADA-USD', 'DOGE': 'DOGE-USD', 'DOT': 'DOT-USD',
  'AVAX': 'AVAX-USD', 'LINK': 'LINK-USD', 'MATIC': 'MATIC-USD', 'SHIB': 'SHIB-USD',
  'LTC': 'LTC-USD', 'UNI': 'UNI-USD', 'AAVE': 'AAVE-USD', 'ATOM': 'ATOM-USD',
  'NEAR': 'NEAR-USD', 'APT': 'APT-USD', 'FIL': 'FIL-USD', 'INJ': 'INJ-USD'
};

// Track CoinGecko rate limit status
let coinGeckoRateLimited = false;
let rateLimitResetTime = 0;

// Dynamic crypto symbol map with common coins pre-cached
const CRYPTO_SYMBOL_MAP: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  XRP: "ripple",
  SOL: "solana",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  LINK: "chainlink",
  UNI: "uniswap",
  AVAX: "avalanche-2",
  ATOM: "cosmos",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  ALGO: "algorand",
  XLM: "stellar",
  NEAR: "near",
  APT: "aptos",
  FIL: "filecoin",
  IMX: "immutable-x",
};

/**
 * Dynamically search CoinGecko for a crypto symbol and return the coin ID
 * Uses the highest market cap ranked result to avoid ambiguity
 */
async function searchCryptoSymbol(symbol: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${COINGECKO_API}/search?query=${symbol.toLowerCase()}`
    );

    if (!response.ok) {
      logger.warn(`CoinGecko search failed for ${symbol}: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const coins = data.coins as Array<{
      id: string;
      symbol: string;
      name: string;
      market_cap_rank: number | null;
    }>;

    if (!coins || coins.length === 0) {
      logger.warn(`No CoinGecko results found for symbol: ${symbol}`);
      return null;
    }

    // Filter for exact symbol match (case-insensitive)
    const exactMatches = coins.filter(
      (coin) => coin.symbol.toLowerCase() === symbol.toLowerCase()
    );

    if (exactMatches.length === 0) {
      logger.warn(`No exact symbol match found for: ${symbol}`);
      return null;
    }

    // Sort by market cap rank (lower number = higher rank = more likely the right coin)
    // Filter out coins without rank and use the highest ranked one
    const rankedCoins = exactMatches
      .filter((coin) => coin.market_cap_rank !== null)
      .sort((a, b) => a.market_cap_rank! - b.market_cap_rank!);

    if (rankedCoins.length > 0) {
      const topCoin = rankedCoins[0];
      logger.info(`✅ Discovered crypto: ${symbol} → ${topCoin.id} (${topCoin.name}, rank #${topCoin.market_cap_rank})`);
      
      // Cache the result for future use
      CRYPTO_SYMBOL_MAP[symbol.toUpperCase()] = topCoin.id;
      
      return topCoin.id;
    }

    // If no ranked coins, use the first exact match as fallback
    const fallbackCoin = exactMatches[0];
    logger.info(`⚠️ Using unranked crypto: ${symbol} → ${fallbackCoin.id} (${fallbackCoin.name})`);
    CRYPTO_SYMBOL_MAP[symbol.toUpperCase()] = fallbackCoin.id;
    
    return fallbackCoin.id;
  } catch (error) {
    logger.error(`Error searching CoinGecko for ${symbol}:`, error);
    return null;
  }
}

export async function fetchCryptoPrice(symbol: string): Promise<ExternalMarketData | null> {
  const startTime = Date.now();
  const upperSymbol = symbol.toUpperCase();
  
  // PRIORITY 1: Try real-time Coinbase WebSocket price (sub-second latency)
  const realtimePrice = getRealtimeCryptoPrice(upperSymbol);
  if (realtimePrice) {
    const ageMs = Date.now() - realtimePrice.timestamp.getTime();
    logger.debug(`[CRYPTO-RT] ${symbol}: $${realtimePrice.price} (${ageMs}ms old, source: ${realtimePrice.source})`);
    
    // Use real-time price with cached market data for other fields
    const cached = cryptoPriceCache.get(upperSymbol);
    return {
      symbol: upperSymbol,
      assetType: 'crypto',
      currentPrice: realtimePrice.price,
      changePercent: cached?.data.changePercent || 0,
      volume: cached?.data.volume || 0,
      marketCap: cached?.data.marketCap,
      high24h: cached?.data.high24h,
      low24h: cached?.data.low24h,
    };
  }
  
  // Check if rate limit window has expired - reset flag if so
  if (coinGeckoRateLimited && Date.now() >= rateLimitResetTime) {
    coinGeckoRateLimited = false;
    logger.info('[CRYPTO] CoinGecko rate limit window expired, resuming normal requests');
  }
  
  // Check if we're still rate limited - use extended cache TTL and Yahoo fallback
  if (coinGeckoRateLimited) {
    // Try extended cache first (30 min instead of 5 min when rate limited)
    const cached = cryptoPriceCache.get(upperSymbol);
    if (cached && Date.now() - cached.timestamp < CRYPTO_FALLBACK_CACHE_TTL) {
      logger.debug(`[CRYPTO] Using cached price for ${symbol} (rate limited): $${cached.data.currentPrice}`);
      return cached.data;
    }
    // Try Yahoo Finance as backup for major cryptos
    const yahooResult = await fetchCryptoPriceFromYahoo(symbol);
    if (yahooResult) {
      logger.info(`[CRYPTO] Using Yahoo backup for ${symbol} (CoinGecko rate limited)`);
      return yahooResult;
    }
    // If Yahoo also fails, still try CoinGecko (might be back online)
    logger.info(`[CRYPTO] Yahoo fallback unavailable for ${symbol}, attempting CoinGecko anyway`);
  }
  
  try {
    // Try hardcoded map first (fast path for common coins)
    let coinId: string | undefined = CRYPTO_SYMBOL_MAP[upperSymbol];
    
    // If not in map, search dynamically
    if (!coinId) {
      logger.info(`Crypto ${symbol} not in cache, searching CoinGecko...`);
      const searchResult = await searchCryptoSymbol(symbol);
      
      if (!searchResult) {
        logger.warn(`❌ Could not find CoinGecko ID for symbol: ${symbol}`);
        return null;
      }
      
      coinId = searchResult;
    }

    const response = await fetch(
      `${COINGECKO_API}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    );

    // Handle rate limiting with backoff
    if (response.status === 429) {
      coinGeckoRateLimited = true;
      rateLimitResetTime = Date.now() + 60 * 1000; // Wait 60 seconds before trying again
      logger.warn(`[CRYPTO] CoinGecko rate limited, backing off for 60s`);
      
      // Return cached data if available (use extended TTL when rate limited)
      const cached = cryptoPriceCache.get(upperSymbol);
      if (cached && Date.now() - cached.timestamp < CRYPTO_FALLBACK_CACHE_TTL) {
        logger.info(`[CRYPTO] Returning cached price for ${symbol}: $${cached.data.currentPrice} (${Math.floor((Date.now() - cached.timestamp) / 1000)}s old)`);
        return cached.data;
      }
      
      // Try Yahoo Finance as backup for major cryptos
      const yahooBackup = await fetchCryptoPriceFromYahoo(symbol);
      if (yahooBackup) {
        logger.info(`[CRYPTO] Using Yahoo backup for ${symbol} after rate limit`);
        return yahooBackup;
      }
      
      logAPIError('CoinGecko', `/coins/${coinId}`, new Error('HTTP 429 - Rate Limited'));
      return null;
    }

    if (!response.ok) {
      logAPIError('CoinGecko', `/coins/${coinId}`, new Error(`HTTP ${response.status}`));
      return null;
    }

    // Reset rate limit flag on successful request
    coinGeckoRateLimited = false;

    const data = await response.json();
    const marketData = data.market_data;

    logAPISuccess('CoinGecko', `/coins/${coinId}`, Date.now() - startTime);

    const result: ExternalMarketData = {
      symbol: upperSymbol,
      assetType: "crypto",
      currentPrice: marketData.current_price.usd,
      changePercent: marketData.price_change_percentage_24h || 0,
      volume: marketData.total_volume.usd,
      marketCap: marketData.market_cap.usd,
      high24h: marketData.high_24h.usd,
      low24h: marketData.low_24h.usd,
    };
    
    // Cache the successful result for fallback
    cryptoPriceCache.set(upperSymbol, { data: result, timestamp: Date.now() });
    
    return result;
  } catch (error) {
    logger.error(`Error fetching crypto price for ${symbol}`, { error: error instanceof Error ? error.message : String(error) });
    logAPIError('CoinGecko', `/coins/${symbol}`, error);
    
    // Try to return cached data on error (use extended TTL)
    const cached = cryptoPriceCache.get(upperSymbol);
    if (cached && Date.now() - cached.timestamp < CRYPTO_FALLBACK_CACHE_TTL) {
      logger.info(`[CRYPTO] Returning cached price for ${symbol} after error: $${cached.data.currentPrice}`);
      return cached.data;
    }
    
    // Last resort: try Yahoo Finance for major cryptos
    const yahooFallback = await fetchCryptoPriceFromYahoo(symbol);
    if (yahooFallback) return yahooFallback;
    
    return null;
  }
}

// Yahoo Finance backup for crypto when CoinGecko is rate limited
export async function fetchCryptoPriceFromYahoo(symbol: string): Promise<ExternalMarketData | null> {
  const upperSymbol = symbol.toUpperCase();
  const yahooSymbol = YAHOO_CRYPTO_MAP[upperSymbol];
  if (!yahooSymbol) return null;
  
  try {
    const response = await fetch(`${YAHOO_FINANCE_API}/${yahooSymbol}?interval=1d&range=1d`);
    if (!response.ok) return null;
    
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result?.meta) return null;
    
    const meta = result.meta;
    const previousClose = meta.chartPreviousClose || meta.previousClose;
    const changePercent = previousClose 
      ? ((meta.regularMarketPrice - previousClose) / previousClose) * 100 
      : 0;
    
    const marketData: ExternalMarketData = {
      symbol: upperSymbol,
      assetType: 'crypto',
      currentPrice: meta.regularMarketPrice,
      changePercent,
      volume: meta.regularMarketVolume || 0,
      high24h: meta.regularMarketDayHigh,
      low24h: meta.regularMarketDayLow,
    };
    
    // Cache this result too for future fallback
    cryptoPriceCache.set(upperSymbol, { data: marketData, timestamp: Date.now() });
    logger.info(`[CRYPTO-YAHOO] Backup fetch ${symbol}: $${marketData.currentPrice.toFixed(2)}`);
    
    return marketData;
  } catch (error) {
    return null;
  }
}

// Uncached, this is called per-surface for the same handful of index symbols
// (^VIX, VIX, SPX) many times a minute. Yahoo answers 429, and because the 429s
// come from this endpoint they also poison the historical fetches that share the
// host. A short TTL collapses the storm without making any price staler than the
// quote cadence the UI already polls at.
// Two separate maps on purpose. `yahooQuoteCache` is the fresh-price cache;
// `yahooQuoteCooldown` records when a symbol last failed. A failure must NOT
// evict the last good price — VIX going to 0.0 on the footer is worse than VIX
// being 30 seconds old — so on a throttle we suppress the retry but keep serving
// the last real quote we actually received.
const yahooQuoteCache = new Map<string, { data: ExternalMarketData; timestamp: number }>();
const yahooQuoteCooldown = new Map<string, number>();
const YAHOO_QUOTE_TTL = 30 * 1000;
const YAHOO_QUOTE_ERROR_TTL = 60 * 1000;
/** Beyond this a cached quote is too old to pass off as a price. */
const YAHOO_QUOTE_STALE_MAX = 10 * 60 * 1000;

export async function fetchYahooFinancePrice(
  symbol: string
): Promise<ExternalMarketData | null> {
  const startTime = Date.now();
  const cacheKey = symbol.toUpperCase();
  const memo = yahooQuoteCache.get(cacheKey);
  if (memo && Date.now() - memo.timestamp < YAHOO_QUOTE_TTL) return memo.data;

  // Inside the cooldown after a failure: do not re-hit Yahoo. Serve the last good
  // price if it is still recent enough to be meaningful, otherwise admit we have
  // nothing rather than inventing a number.
  const failedAt = yahooQuoteCooldown.get(cacheKey);
  if (failedAt && Date.now() - failedAt < YAHOO_QUOTE_ERROR_TTL) {
    if (memo && Date.now() - memo.timestamp < YAHOO_QUOTE_STALE_MAX) return memo.data;
    return null;
  }

  try {
    const response = await fetch(
      `${YAHOO_FINANCE_API}/${symbol}?interval=1d&range=1d`
    );

    if (!response.ok) {
      // Retrying a 429 immediately is what turned one throttled symbol into a
      // sustained error stream — and the noise starved the historical fetches
      // that share this host.
      yahooQuoteCooldown.set(cacheKey, Date.now());
      logAPIError('Yahoo Finance', `/chart/${symbol}`, new Error(`HTTP ${response.status}`));
      if (memo && Date.now() - memo.timestamp < YAHOO_QUOTE_STALE_MAX) return memo.data;
      return null;
    }

    const jsonData = await response.json();
    const result = jsonData?.chart?.result?.[0];
    
    if (!result || !result.meta) {
      yahooQuoteCooldown.set(cacheKey, Date.now());
      logAPIError('Yahoo Finance', `/chart/${symbol}`, new Error('No data returned'));
      return null;
    }

    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];
    const regularMarketPrice = meta.regularMarketPrice;
    const previousClose = meta.chartPreviousClose || meta.previousClose;
    const changePercent = previousClose 
      ? ((regularMarketPrice - previousClose) / previousClose) * 100 
      : 0;

    logAPISuccess('Yahoo Finance', `/chart/${symbol}`, Date.now() - startTime);

    const marketData: ExternalMarketData = {
      symbol: symbol.toUpperCase(),
      assetType: "stock",
      currentPrice: regularMarketPrice,
      changePercent: changePercent,
      volume: quote?.volume?.[0] || meta.regularMarketVolume || 0,
      high24h: quote?.high?.[0] || meta.regularMarketDayHigh,
      low24h: quote?.low?.[0] || meta.regularMarketDayLow,
      marketCap: meta.marketCap,
    };
    
    // Cache the result
    yahooQuoteCache.set(cacheKey, { data: marketData, timestamp: Date.now() });
    yahooQuoteCooldown.delete(cacheKey);
    const { apiCache } = await import('./api-cache');
    apiCache.set('quote', symbol, marketData, 'yahoo_finance');

    return marketData;
  } catch (error) {
    logger.error(`Error fetching Yahoo Finance price for ${symbol}:`, error);
    logAPIError('Yahoo Finance', `/chart/${symbol}`, error);
    
    // Try cache as last resort
    const { apiCache } = await import('./api-cache');
    const cached = apiCache.get<ExternalMarketData>('quote', symbol);
    if (cached) {
      logger.info(`[CACHE] Serving cached quote for ${symbol} after Yahoo error`);
      return cached.data;
    }
    return null;
  }
}

/**
 * Use multi-source market data service as fallback
 * Tries: Finnhub (FREE) → Twelve Data (FREE) → Tradier → Alpha Vantage
 */
async function fetchWithMultiSource(symbol: string): Promise<ExternalMarketData | null> {
  try {
    logger.info(`🔄 Using multi-source fallback for ${symbol}`);
    const quote = await multiSourceMarketData.getQuote(symbol);

    if (quote) {
      logger.info(`✅ Multi-source got ${symbol}: $${quote.price} (via ${quote.source})`);
      return {
        symbol: symbol.toUpperCase(),
        assetType: 'stock',
        currentPrice: quote.price,
        changePercent: quote.changePercent,
        volume: quote.volume || 0,
      };
    }
  } catch (error) {
    logger.warn(`Multi-source fallback failed for ${symbol}:`, error);
  }
  return null;
}

export async function fetchStockPrice(
  symbol: string,
  apiKey?: string
): Promise<ExternalMarketData | null> {
  const { apiCache } = await import('./api-cache');
  const { marketDataStatus } = await import('./market-data-status');
  
  // Check Tradier status - treat undefined/unknown as healthy (optimistic default)
  const tradierStatus = marketDataStatus.getProviderStatus('tradier');
  const tradierKey = process.env.TRADIER_API_KEY;
  const tradierHealthy = !tradierStatus || tradierStatus.status === 'healthy' || tradierStatus.status === 'unknown';
  
  // Try Tradier first if healthy or status unknown
  if (tradierKey && tradierHealthy) {
    try {
      const quote = await getTradierQuote(symbol, tradierKey);
      if (quote) {
        const data: ExternalMarketData = {
          symbol: quote.symbol.toUpperCase(),
          assetType: "stock",
          currentPrice: quote.last,
          changePercent: quote.change_percentage,
          volume: quote.volume,
          avgVolume: quote.average_volume,
          high24h: quote.high,
          low24h: quote.low,
          marketCap: undefined,
        };
        apiCache.set('quote', symbol, data, 'tradier');
        return data;
      }
    } catch (error) {
      logger.warn(`Tradier quote error for ${symbol}, trying Yahoo Finance:`, error);
    }
  } else if (tradierKey && !tradierHealthy) {
    // Tradier rate limited - check cache first
    const cached = apiCache.get<ExternalMarketData>('quote', symbol);
    if (cached) {
      logger.info(`[CACHE] Serving cached quote for ${symbol} (Tradier ${tradierStatus?.status})`);
      return cached.data;
    }
    logger.info(`Tradier ${tradierStatus?.status} for ${symbol}, using Yahoo Finance fallback`);
  }

  // Fallback to Alpha Vantage if available
  if (apiKey) {
    try {
      const response = await fetch(
        `${ALPHA_VANTAGE_API}?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apiKey}`
      );

      if (!response.ok) {
        logger.info(`Alpha Vantage API error for ${symbol}, falling back to Yahoo Finance`);
        return await fetchYahooFinancePrice(symbol);
      }

      const data = await response.json();
      
      if (data.Information && data.Information.includes("rate limit")) {
        logger.info(`Alpha Vantage rate limit hit for ${symbol}, falling back to Yahoo Finance`);
        return await fetchYahooFinancePrice(symbol);
      }

      const quote = data["Global Quote"];

      if (!quote || !quote["05. price"]) {
        logger.info(`No Alpha Vantage data for ${symbol}, falling back to Yahoo Finance`);
        return await fetchYahooFinancePrice(symbol);
      }

      const avData: ExternalMarketData = {
        symbol: symbol.toUpperCase(),
        assetType: "stock",
        currentPrice: parseFloat(quote["05. price"]),
        changePercent: parseFloat(quote["10. change percent"].replace("%", "")),
        volume: parseInt(quote["06. volume"]),
        high24h: parseFloat(quote["03. high"]),
        low24h: parseFloat(quote["04. low"]),
      };
      
      // Cache Alpha Vantage response for fallback
      apiCache.set('quote', symbol, avData, 'alpha_vantage');
      return avData;
    } catch (error) {
      logger.error(`Error fetching stock price for ${symbol}:`, error);
      // Try multi-source fallback which includes FREE APIs (Finnhub, Twelve Data)
      const multiResult = await fetchWithMultiSource(symbol);
      if (multiResult) return multiResult;
      return await fetchYahooFinancePrice(symbol);
    }
  }

  // Try multi-source fallback first (has FREE options like Finnhub, Twelve Data)
  const multiResult = await fetchWithMultiSource(symbol);
  if (multiResult) return multiResult;

  return await fetchYahooFinancePrice(symbol);
}

export async function searchSymbol(
  symbol: string,
  alphaVantageKey?: string
): Promise<ExternalMarketData | null> {
  const upperSymbol = symbol.toUpperCase();

  if (CRYPTO_SYMBOL_MAP[upperSymbol]) {
    return await fetchCryptoPrice(upperSymbol);
  }

  // Always try stock price fetch - Tradier will be used if available, with fallbacks
  return await fetchStockPrice(upperSymbol, alphaVantageKey);
}

/**
 * Fetch historical daily prices from Yahoo Finance (UNLIMITED)
 * Returns array of closing prices from oldest to newest
 */
async function fetchYahooHistoricalPrices(
  symbol: string,
  periods: number = 60
): Promise<number[]> {
  try {
    // Calculate date range (periods days ago to today)
    const endDate = Math.floor(Date.now() / 1000);
    const startDate = endDate - (periods * 24 * 60 * 60);
    
    const response = await fetch(
      `${YAHOO_FINANCE_API}/${symbol}?interval=1d&period1=${startDate}&period2=${endDate}`
    );

    if (!response.ok) {
      logger.info(`Yahoo Finance historical data error for ${symbol}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) {
      logger.info(`No Yahoo Finance historical data for ${symbol}`);
      return [];
    }

    // Extract closing prices (filter out null values)
    const closePrices = result.indicators.quote[0].close.filter((price: number | null) => price !== null);
    
    logger.info(`✅ Fetched ${closePrices.length} real historical prices for ${symbol} (Yahoo Finance)`);
    return closePrices;
  } catch (error) {
    logger.error(`Yahoo Finance historical error for ${symbol}:`, error instanceof Error ? error.message : 'Unknown error');
    return [];
  }
}

export interface HiddenCryptoGem {
  symbol: string;
  name: string;
  currentPrice: number;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  volumeSpike: boolean;
  priceGap: boolean;
  anomalyScore: number;
  coinId?: string;
  marketCapRank?: number;
}

/**
 * Fetch real historical daily prices for accurate technical analysis
 * Returns array of closing prices from oldest to newest
 */
export async function fetchHistoricalPrices(
  symbol: string,
  assetType: AssetType,
  periods: number = 60,
  apiKey?: string,
  coinId?: string  // Optional: Direct coinId for crypto (bypasses CRYPTO_SYMBOL_MAP lookup)
): Promise<number[]> {
  try {
    if (assetType === 'crypto') {
      // Fetch CoinGecko historical data
      // Use provided coinId if available (from discovery), otherwise lookup in map
      const resolvedCoinId = coinId || CRYPTO_SYMBOL_MAP[symbol.toUpperCase()];
      if (!resolvedCoinId) {
        logger.info(`No CoinGecko mapping for ${symbol}, using fallback`);
        return [];
      }

      const response = await fetch(
        `${COINGECKO_API}/coins/${resolvedCoinId}/market_chart?vs_currency=usd&days=${periods}&interval=daily`
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error');
        logger.warn(`CoinGecko historical data error for ${symbol}: HTTP ${response.status} - ${errorText.substring(0, 200)}`);
        
        // Check for specific error types
        if (response.status === 429) {
          logger.error(`🚨 CoinGecko Rate Limit Hit - ${symbol}`);
        } else if (response.status === 403) {
          logger.error(`🚨 CoinGecko Access Forbidden - ${symbol} - Check API key/permissions`);
        } else if (response.status === 404) {
          logger.warn(`⚠️  CoinGecko Coin Not Found - ${symbol} (coinId: ${resolvedCoinId})`);
        }
        
        return [];
      }

      const data = await response.json();
      // CoinGecko returns [timestamp, price] arrays
      const prices = data.prices.map((p: [number, number]) => p[1]);
      
      logger.info(`✅ Fetched ${prices.length} real historical prices for ${symbol} (crypto)`);
      return prices;
    }

    // Massive first. The chain below it — Tradier, Alpha Vantage, Yahoo — was
    // simultaneously 401, quota-exhausted and 429 on 2026-08-25, which left every
    // candidate in the generator with no history and published an empty board.
    // Massive has unlimited calls on the paid tier and 5 years of history, so it
    // belongs ahead of three sources that each fail for a different reason.
    if (massiveEnabled()) {
      const closes = await fetchMassiveDailyCloses(symbol, periods);
      if (closes.length > 0) {
        logger.info(`✅ Fetched ${closes.length} real historical prices for ${symbol} (Massive)`);
        return closes;
      }
    }

    // Try Tradier first for stock historical data (unlimited)
    const tradierKey = process.env.TRADIER_API_KEY;
    if (tradierKey) {
      try {
        // Deliberately NOT forwarding the key: getTradierHistory reads the same
        // env var itself, and an explicit key marks the call as "caller's own
        // token", which exempts it from the platform circuit breaker.
        const prices = await getTradierHistory(symbol, periods);
        if (prices.length > 0) {
          logger.info(`✅ Fetched ${prices.length} real historical prices for ${symbol} (Tradier)`);
          return prices;
        }
      } catch (error) {
        logger.info(`Tradier error for ${symbol}, trying next source`);
      }
    }

    // Fallback to Alpha Vantage historical data for stocks
    if (apiKey) {
      try {
        const response = await fetch(
          `${ALPHA_VANTAGE_API}?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${apiKey}&outputsize=compact`
        );

        if (response.ok) {
          const data = await response.json();

          // Check for rate limit or errors
          if (!data.Information && !data.Note) {
            const timeSeries = data["Time Series (Daily)"];
            if (timeSeries) {
              // Extract closing prices, sorted from oldest to newest
              const prices = Object.keys(timeSeries)
                .sort() // Sort dates chronologically (oldest first)
                .slice(-periods) // Take last N periods
                .map(date => parseFloat(timeSeries[date]["4. close"]));

              logger.info(`✅ Fetched ${prices.length} real historical prices for ${symbol} (Alpha Vantage)`);
              return prices;
            }
          } else {
            logger.info(`Alpha Vantage rate limit or error for ${symbol}: ${data.Information || data.Note}`);
          }
        }
      } catch (error) {
        logger.info(`Alpha Vantage error for ${symbol}, trying Yahoo Finance`);
      }
    }

    // Final fallback: Yahoo Finance. "UNLIMITED, always available" was optimistic —
    // the bare chart endpoint answers 429 once the scanners are warm, and with
    // Tradier 401 and Alpha Vantage capped at 25 calls/day that left EVERY symbol
    // with no history and the generator publishing nothing at all. Try the shared
    // crumb-authenticated client first, then the raw endpoint.
    logger.info(`Trying Yahoo Finance for ${symbol} historical data...`);
    const { safeChartCloses } = await import('./yahoo-finance-service');
    const libraryCloses = await safeChartCloses(symbol, periods);
    if (libraryCloses.length > 0) {
      logger.info(`✅ Fetched ${libraryCloses.length} real historical prices for ${symbol} (Yahoo lib)`);
      return libraryCloses.slice(-periods);
    }
    return await fetchYahooHistoricalPrices(symbol, periods);
  } catch (error) {
    logger.error(`Error fetching historical prices for ${symbol}:`, error);
    return [];
  }
}

export async function discoverHiddenCryptoGems(limit: number = 10): Promise<HiddenCryptoGem[]> {
  try {
    const marketCapResponse = await fetch(
      `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=true&price_change_percentage=24h`
    );

    if (!marketCapResponse.ok) {
      logger.error("CoinGecko API error:", marketCapResponse.statusText);
      return [];
    }

    const allCoins = await marketCapResponse.json();

    const top20ByMarketCap = new Set(
      allCoins.slice(0, 20).map((coin: any) => coin.id)
    );

    // Map all coins and deduplicate by symbol (keep highest market cap for duplicate symbols)
    const gemsBySymbol = new Map<string, any>();
    
    allCoins.forEach((coin: any, marketCapRank: number) => {
      const marketCap = coin.market_cap || 0;
      const volume24h = coin.total_volume || 0;
      const priceChange = Math.abs(coin.price_change_percentage_24h || 0);
      
      const volumeToMarketCapRatio = marketCap > 0 ? volume24h / marketCap : 0;
      const highTurnover = volumeToMarketCapRatio > 0.10;
      const priceGap = priceChange >= 3.0;
      
      let anomalyScore = 0;
      if (priceGap) anomalyScore += 40;
      if (highTurnover) anomalyScore += 30;
      if (marketCapRank > 50 && marketCapRank <= 150) anomalyScore += 20;
      if (marketCapRank > 150) anomalyScore += 10;

      const gem = {
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        currentPrice: coin.current_price,
        marketCap: marketCap,
        volume24h: volume24h,
        priceChange24h: coin.price_change_percentage_24h || 0,
        volumeSpike: highTurnover,
        priceGap,
        anomalyScore,
        coinId: coin.id,
        marketCapRank: marketCapRank + 1,
      };
      
      // Deduplicate by symbol - keep highest market cap
      const existing = gemsBySymbol.get(gem.symbol);
      if (!existing || gem.marketCap > existing.marketCap) {
        gemsBySymbol.set(gem.symbol, gem);
      }
    });
    
    const hiddenGems: HiddenCryptoGem[] = Array.from(gemsBySymbol.values())
      .filter((gem: any) => 
        !top20ByMarketCap.has(gem.coinId) &&
        gem.marketCap >= 50_000_000 &&
        gem.marketCap <= 2_000_000_000 &&
        gem.volume24h >= 5_000_000 &&
        (gem.priceGap || gem.volumeSpike)
      )
      .sort((a: any, b: any) => b.anomalyScore - a.anomalyScore)
      .slice(0, limit);

    logger.info(`✅ Discovery: ${hiddenGems.length} hidden gems found (excluded top-20, required 3%+ move OR 10%+ turnover, $50M-$2B cap)`);
    
    return hiddenGems;
  } catch (error) {
    logger.error("Error discovering hidden crypto gems:", error);
    return [];
  }
}

// 🔍 PREDICTIVE STOCK SCANNER: Find stocks BEFORE big moves
// Strategy: Scan high-volume universe for early technical setups (unusual volume, RSI divergence, breakout patterns)
// NOT "top gainers" (reactive) - those already moved
interface StockGem {
  symbol: string;
  currentPrice: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  avgVolume?: number; // For volume ratio calculation
  dayHigh?: number;   // Intraday high to detect gap-and-fade
  dayLow?: number;    // Intraday low for reference
}

export async function discoverStockGems(limit: number = 30): Promise<StockGem[]> {
  const gems: StockGem[] = [];
  
  try {
    logger.info('🔍 PREDICTIVE SCAN: Finding stocks BEFORE big moves (high volume + small price changes)...');
    
    // MEMORY-OPTIMIZED STRATEGY:
    // Reduced from 6 categories to 3 most important ones to prevent rate limiting
    // Count reduced from 250 to 50-100 to reduce memory usage
    // Two of the three original categories were GAINERS screens and there was no
    // losers screen at all, so the candidate pool was structurally bullish: a
    // stock in a downtrend setting up short could never enter it. That is the
    // real reason this scanner produced 3 shorts in 594 ideas — not the signal
    // logic, which finds short setups at a 5.8% rate in backtest, but the fact
    // that it was never shown a single short candidate to evaluate.
    //
    // A scanner that only looks at what is going up can only ever tell you to buy.
    const categories = [
      { name: 'mostActive', url: 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=true&scrIds=most_actives&count=100', retries: 2 },
      { name: 'smallCapsGainers', url: 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=true&scrIds=small_cap_gainers&count=50', retries: 2 },
      { name: 'dayGainers', url: 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=true&scrIds=day_gainers&count=50', retries: 1 },
      // day_losers is the only losers screen Yahoo actually publishes — there is
      // no small_cap_losers to mirror small_cap_gainers, and asking for one
      // returns an error rather than an empty list. Count raised to 100 so the
      // single bearish source carries comparable weight to the two bullish ones.
      { name: 'dayLosers', url: 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=true&scrIds=day_losers&count=100', retries: 2 }
    ];
    
    for (let catIdx = 0; catIdx < categories.length; catIdx++) {
      const category = categories[catIdx];

      // Add delay between categories to prevent rate limiting
      if (catIdx > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      let attempt = 0;
      let success = false;

      while (attempt < category.retries && !success) {
        try {
          attempt++;

          // Add delay between retries (exponential backoff)
          if (attempt > 1) {
            const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000); // Max 10s delay
            logger.info(`  ⏳ Retry attempt ${attempt}/${category.retries} for ${category.name} after ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
          const response = await fetch(category.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          
          // Handle rate limiting
          if (response.status === 429) {
            logger.info(`⚠️  Yahoo ${category.name} rate limited (429) - will retry`);
            continue; // Try again with backoff
          }
          
          if (!response.ok) {
            logger.info(`⚠️  Yahoo ${category.name} endpoint returned ${response.status}`);
            break; // Don't retry on other errors
          }
          
          const data = await response.json();
          const quotes = data?.finance?.result?.[0]?.quotes || [];
          
          logger.info(`  ✓ Found ${quotes.length} stocks in ${category.name}`);
          success = true;
          
          for (const quote of quotes) {
            // Filter criteria: 
            // - Price > $1 (avoid sub-dollar micro-caps, but include $1-$5 penny stocks)
            // - Price < $500 (avoid expensive stocks that are hard to trade)
            // - Volume exists
            // - Market cap varies: $10M+ for penny stocks, $50M+ for regular stocks
            const price = quote.regularMarketPrice?.raw || quote.regularMarketPrice;
            const change = quote.regularMarketChangePercent?.raw || quote.regularMarketChangePercent || 0;
            const volume = quote.regularMarketVolume?.raw || quote.regularMarketVolume || 0;
            const avgVolume = quote.averageDailyVolume3Month?.raw || quote.averageDailyVolume3Month;
            const marketCap = quote.marketCap?.raw || quote.marketCap || 0;
            const dayHigh = quote.regularMarketDayHigh?.raw || quote.regularMarketDayHigh;
            const dayLow = quote.regularMarketDayLow?.raw || quote.regularMarketDayLow;
            
            if (!price || price < 1 || price > 500) continue;
            if (volume < 100000) continue; // Minimum 100K volume
            // Relax market cap filter for penny stocks ($1-$5) - allow smaller caps
            if (price >= 5 && marketCap < 50_000_000) continue; // Regular stocks need $50M+ cap
            if (price < 5 && marketCap < 10_000_000) continue; // Penny stocks need $10M+ cap
            
            gems.push({
              symbol: quote.symbol,
              currentPrice: price,
              changePercent: change,
              volume: volume,
              marketCap: marketCap,
              avgVolume: avgVolume,
              dayHigh: dayHigh,
              dayLow: dayLow
            });
          }
        } catch (error) {
          logger.info(`  ⚠️  Failed to fetch ${category.name} (attempt ${attempt}):`, error instanceof Error ? error.message : 'Unknown error');
          if (attempt >= category.retries) {
            break; // Give up after max retries
          }
        }
      }
    }
    
    // Remove duplicates (same symbol might appear in multiple categories)
    const uniqueGems = new Map<string, StockGem>();
    gems.forEach(gem => {
      if (!uniqueGems.has(gem.symbol)) {
        uniqueGems.set(gem.symbol, gem);
      }
    });
    
    // ADAPTIVE DISCOVERY: Wide net captures multiple momentum phases
    // Strategy: Let quant engine decide entry timing, discovery just finds unusual volume + healthy price action
    const sortedGems = Array.from(uniqueGems.values())
      .filter(gem => {
        // DATA QUALITY FILTERS: Require day high (critical for gap-fade detection)
        // More lenient with avgVolume (use current volume as proxy if missing)
        if (!gem.dayHigh || gem.dayHigh === 0) {
          return false; // Can't detect gap-and-fade without intraday high
        }
        
        // Use avgVolume if available, otherwise use current volume (less accurate but usable)
        const effectiveAvgVolume = gem.avgVolume && gem.avgVolume > 0 ? gem.avgVolume : gem.volume;
        const volumeRatio = gem.volume / effectiveAvgVolume;
        
        // CORE FILTERS: Unusual volume + healthy price action
        // RELAXED from 3x to 2x volume (catch more opportunities)
        const hasUnusualVolume = volumeRatio >= 2.0;           // 2x+ average volume (above-average interest)
        // DIRECTION-SYMMETRIC. This block used to open with
        //   const isBullish = gem.changePercent >= 0;   // Only bullish (exclude selloffs)
        // and that single line was, on its own, why this platform could not
        // short. The signal logic finds short setups at a 5.8% rate in backtest,
        // but every declining stock was discarded here before any of it ran —
        // which is how 456 backtestable short signals became 3 stored ideas out
        // of 594. Adding a losers screen upstream changed nothing while this
        // stood; the candidates arrived and were dropped one step later.
        //
        // A scanner that only looks at what is going up can only tell you to buy.
        //
        // The bearish branch is the exact mirror: not yet extended, and holding
        // near the day's LOW rather than its high — because a name that sold off
        // and then bounced back into the middle of its range is the short
        // equivalent of the gap-and-fade this already rejects on the long side.
        const pct = gem.changePercent;
        const isBullishSetup = pct >= 0 && pct < 15.0
          && !!gem.dayHigh && gem.dayHigh > 0
          && (gem.currentPrice / gem.dayHigh) >= 0.90;
        const isBearishSetup = pct <= 0 && pct > -15.0
          && !!gem.dayLow && gem.dayLow > 0
          && (gem.currentPrice / gem.dayLow) <= 1.10;
        const directionalSetup = isBullishSetup || isBearishSetup;
        
        // ADAPTIVE APPROACH: Accept 0-10% bullish moves, let quant engine decide strategy
        // - 0-2%: Early accumulation (RSI, MACD)
        // - 2-5%: Breakout phase (MACD, volume spike)
        // - 5-10%: Strong momentum (5x+ volume required)
        // - Rejected: Stock that gapped +15%, faded to +4% (currentPrice/dayHigh < 95%)
        // - Rejected: Stock with -2% = selloff (bearish)
        // - Rejected: Stock missing dayHigh = can't verify gap-and-fade
        return hasUnusualVolume && directionalSetup;
      })
      .map(gem => {
        // Use avgVolume if available, otherwise use current volume (same as filter)
        const effectiveAvgVolume = gem.avgVolume && gem.avgVolume > 0 ? gem.avgVolume : gem.volume;
        const volumeRatio = gem.volume / effectiveAvgVolume;
        
        // BALANCED SCORING: All phases get competitive scores
        let score = 0;
        
        // Volume component (0-60 points): Higher volume = better (all phases)
        if (volumeRatio >= 5) score += 60;
        else if (volumeRatio >= 4) score += 55;
        else if (volumeRatio >= 3) score += 50;
        
        // Price change component (0-40 points): Balanced across phases
        // Early accumulation (0-2%): Slight preference (38-40 points)
        const move = Math.abs(gem.changePercent);
        if (move < 0.5) score += 40;
        else if (move < 1.0) score += 39;
        else if (move < 1.5) score += 39;
        else if (move < 2.0) score += 38;
        // Breakout phase (2-5%): Competitive score (35-37 points)
        else if (move < 3.0) score += 37;
        else if (move < 4.0) score += 36;
        else if (move < 5.0) score += 35;
        // Strong momentum (5-10%): Still competitive (32-34 points)
        else if (move < 7.0) score += 34;
        else if (move < 10.0) score += 32;
        
        return { ...gem, volumeRatio, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    const totalScanned = uniqueGems.size;
    const passedFilters = sortedGems.length;
    const rejectionRate = totalScanned > 0 ? ((totalScanned - passedFilters) / totalScanned * 100).toFixed(1) : '0.0';
    
    logger.info(`🎯 PREDICTIVE SCAN: ${passedFilters}/${totalScanned} stocks passed filters (${rejectionRate}% rejected)`);
    if (passedFilters > 0) {
      logger.info(`   Top 5: ${sortedGems.slice(0, 5).map(g => `${g.symbol} (+${g.changePercent.toFixed(1)}%, ${g.volumeRatio?.toFixed(1)}x vol, ${((g.currentPrice / g.dayHigh!) * 100).toFixed(1)}% of high)`).join(', ')}`);
    }
    
    return sortedGems;
  } catch (error) {
    logger.error('❌ Stock discovery error:', error);
    return [];
  }
}

// 💎 PENNY STOCK DISCOVERY: Find high-volume penny stocks ($1-$5 range)
// Yahoo screeners don't return penny stocks, so we maintain a curated watchlist
export async function discoverPennyStocks(): Promise<StockGem[]> {
  try {
    logger.info('🔍 Discovering popular stocks ($1-$50 range - penny stocks + retail favorites)...');
    
    // MEMORY-OPTIMIZED STOCK UNIVERSE - Top 50 most important symbols
    // Reduced from 200+ to prevent memory exhaustion and rate limiting
    const pennyStockSymbols = [
      // === TOP RETAIL FAVORITES (20 symbols) ===
      'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMD', 'META', 'GOOGL', 'AMZN',
      'GME', 'AMC', 'PLTR', 'SOFI', 'HOOD', 'COIN', 'MSTR',
      'NIO', 'RIVN', 'LCID', 'SMCI', 'ARM',

      // === QUANTUM & AI (10 symbols) ===
      'IONQ', 'RGTI', 'QUBT', 'QBTS', 'AI', 'SOUN', 'BBAI', 'PATH', 'SNOW', 'DDOG',

      // === CRYPTO MINERS (5 symbols) ===
      'MARA', 'RIOT', 'CLSK', 'BITF', 'HUT',

      // === CLEAN ENERGY (8 symbols) ===
      'PLUG', 'FCEL', 'BE', 'CHPT', 'ENVX', 'QS', 'ENPH', 'SEDG',

      // === NUCLEAR/URANIUM (5 symbols) ===
      'SMR', 'OKLO', 'CCJ', 'LEU', 'UEC',

      // === SPACE (4 symbols) ===
      'RKLB', 'LUNR', 'ASTS', 'SPCE'
    ];
    
    const pennyStocks: StockGem[] = [];

    // Fetch current prices in batches of 5 with 1.5s delays to prevent rate limiting
    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 1500;

    for (let i = 0; i < pennyStockSymbols.length; i += BATCH_SIZE) {
      const batch = pennyStockSymbols.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (symbol) => {
          try {
            const priceData = await fetchStockPrice(symbol);
            if (!priceData) return null;

            const price = priceData.currentPrice;
            const change = priceData.changePercent || 0;
            const volume = priceData.volume || priceData.avgVolume || 0;
            const avgVolume = priceData.avgVolume || 0;
            const marketCap = priceData.marketCap || 0;

            const volumeOk = volume >= 50000 || avgVolume >= 50000;
            const priceOk = price >= 0.50 && price <= 500;

            if (priceOk && volumeOk) {
              return {
                symbol,
                currentPrice: price,
                changePercent: change,
                volume,
                marketCap
              };
            }
            return null;
          } catch {
            return null;
          }
        })
      );

      // Collect successful results
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) {
          pennyStocks.push(result.value);
        }
      }

      // Delay between batches (except for last batch)
      if (i + BATCH_SIZE < pennyStockSymbols.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
    
    // Sort by volume (higher volume = more liquid)
    const sortedPennyStocks = pennyStocks
      .sort((a, b) => b.volume - a.volume);
    
    logger.info(`💎 Discovered ${sortedPennyStocks.length} popular stocks: ${sortedPennyStocks.slice(0, 10).map(g => `${g.symbol} ($${g.currentPrice.toFixed(2)})`).join(', ')}${sortedPennyStocks.length > 10 ? '...' : ''}`);
    
    return sortedPennyStocks.slice(0, 50); // Return top 50 by volume (expanded universe)
  } catch (error) {
    logger.error('❌ Penny stock discovery error:', error);
    return [];
  }
}

/**
 * Earnings event data from Alpha Vantage
 */
export interface EarningsEvent {
  symbol: string;
  name: string;
  reportDate: string; // YYYY-MM-DD format
  fiscalDateEnding: string;
  estimate: number | null; // Analyst consensus EPS estimate
  currency: string;
}

/**
 * Fetch upcoming earnings calendar from Alpha Vantage
 * Returns earnings events for the next 3 months
 */
export async function fetchEarningsCalendar(horizon: '3month' | '6month' | '12month' = '3month'): Promise<EarningsEvent[]> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  
  if (!apiKey) {
    logger.warn('⚠️ No Alpha Vantage API key - earnings calendar unavailable');
    return [];
  }

  try {
    const url = `${ALPHA_VANTAGE_API}?function=EARNINGS_CALENDAR&horizon=${horizon}&apikey=${apiKey}`;
    
    logger.info(`📅 Fetching earnings calendar (${horizon})...`);
    const response = await fetch(url);
    
    if (!response.ok) {
      logger.error(`❌ Alpha Vantage earnings API error: HTTP ${response.status}`);
      return [];
    }

    const csvText = await response.text();
    
    // Check for rate limit
    if (csvText.includes('rate limit') || csvText.includes('premium endpoint')) {
      logger.warn('⚠️ Alpha Vantage rate limit or premium endpoint - earnings unavailable');
      return [];
    }

    // Parse CSV manually (Alpha Vantage returns CSV, not JSON)
    const lines = csvText.trim().split('\n');
    
    if (lines.length < 2) {
      logger.warn('⚠️ No earnings data returned from Alpha Vantage');
      return [];
    }

    // First line is header: symbol,name,reportDate,fiscalDateEnding,estimate,currency
    const header = lines[0].split(',');
    const symbolIdx = header.indexOf('symbol');
    const nameIdx = header.indexOf('name');
    const reportDateIdx = header.indexOf('reportDate');
    const fiscalDateIdx = header.indexOf('fiscalDateEnding');
    const estimateIdx = header.indexOf('estimate');
    const currencyIdx = header.indexOf('currency');

    const earnings: EarningsEvent[] = [];
    
    // Parse each row (skip header)
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',');
      
      if (row.length < 6) continue; // Skip malformed rows
      
      const symbol = row[symbolIdx]?.trim();
      const reportDate = row[reportDateIdx]?.trim();
      
      if (!symbol || !reportDate) continue;
      
      earnings.push({
        symbol,
        name: row[nameIdx]?.trim() || symbol,
        reportDate,
        fiscalDateEnding: row[fiscalDateIdx]?.trim() || reportDate,
        estimate: row[estimateIdx] ? parseFloat(row[estimateIdx]) : null,
        currency: row[currencyIdx]?.trim() || 'USD',
      });
    }

    logger.info(`✅ Found ${earnings.length} upcoming earnings events`);
    logAPISuccess('AlphaVantage', 'earnings_calendar');
    
    return earnings;
  } catch (error) {
    logger.error('❌ Error fetching earnings calendar:', error);
    logAPIError('AlphaVantage', 'earnings_calendar', error instanceof Error ? error.message : String(error));
    return [];
  }
}

/**
 * Get earnings for specific symbols only
 */
export async function fetchSymbolEarnings(symbols: string[]): Promise<Map<string, EarningsEvent>> {
  const allEarnings = await fetchEarningsCalendar('3month');
  const symbolSet = new Set(symbols.map(s => s.toUpperCase()));
  
  const filtered = allEarnings.filter(e => symbolSet.has(e.symbol));
  
  const earningsMap = new Map<string, EarningsEvent>();
  filtered.forEach(e => earningsMap.set(e.symbol, e));
  
  return earningsMap;
}

// ============================================
// FUTURES DATA - 24-hour trading
// ============================================

export interface FuturesQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  previousClose: number;
  session: 'pre' | 'rth' | 'post' | 'overnight' | 'closed';
  lastUpdate: string;
}

// Yahoo Finance futures symbols
const FUTURES_SYMBOLS: Record<string, { yahoo: string; name: string; tickSize: number; pointValue: number }> = {
  'ES': { yahoo: 'ES=F', name: 'E-mini S&P 500', tickSize: 0.25, pointValue: 50 },
  'NQ': { yahoo: 'NQ=F', name: 'E-mini Nasdaq-100', tickSize: 0.25, pointValue: 20 },
  'YM': { yahoo: 'YM=F', name: 'E-mini Dow', tickSize: 1, pointValue: 5 },
  'RTY': { yahoo: 'RTY=F', name: 'E-mini Russell 2000', tickSize: 0.1, pointValue: 50 },
  'GC': { yahoo: 'GC=F', name: 'Gold', tickSize: 0.1, pointValue: 100 },
  'SI': { yahoo: 'SI=F', name: 'Silver', tickSize: 0.005, pointValue: 5000 },
  'CL': { yahoo: 'CL=F', name: 'Crude Oil', tickSize: 0.01, pointValue: 1000 },
  'NG': { yahoo: 'NG=F', name: 'Natural Gas', tickSize: 0.001, pointValue: 10000 },
  'ZB': { yahoo: 'ZB=F', name: '30-Year T-Bond', tickSize: 0.03125, pointValue: 1000 },
  'ZN': { yahoo: 'ZN=F', name: '10-Year T-Note', tickSize: 0.015625, pointValue: 1000 },
  '6E': { yahoo: '6E=F', name: 'Euro FX', tickSize: 0.00005, pointValue: 125000 },
  '6J': { yahoo: '6J=F', name: 'Japanese Yen', tickSize: 0.0000005, pointValue: 12500000 },
};

// Cache for futures quotes (5 second TTL for real-time feel)
const futuresCache = new Map<string, { quote: FuturesQuote; timestamp: number }>();
const FUTURES_CACHE_TTL = 5000; // 5 seconds

/**
 * Determine current futures trading session
 */
function getFuturesSession(): 'pre' | 'rth' | 'post' | 'overnight' | 'closed' {
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = etTime.getDay();
  const hour = etTime.getHours();
  const minute = etTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;
  
  // Futures closed: Friday 5pm to Sunday 6pm ET
  if (day === 6 || (day === 5 && timeInMinutes >= 1020) || (day === 0 && timeInMinutes < 1080)) {
    return 'closed';
  }
  
  // RTH (Regular Trading Hours): 9:30am - 4:00pm ET
  if (timeInMinutes >= 570 && timeInMinutes < 960) {
    return 'rth';
  }
  
  // Pre-market: 6:00am - 9:30am ET
  if (timeInMinutes >= 360 && timeInMinutes < 570) {
    return 'pre';
  }
  
  // Post-market: 4:00pm - 5:00pm ET (daily close)
  if (timeInMinutes >= 960 && timeInMinutes < 1020) {
    return 'post';
  }
  
  // Overnight session (5pm previous day to 6am)
  return 'overnight';
}

/**
 * Fetch single futures quote from Yahoo Finance
 */
async function fetchYahooFuturesQuote(symbol: string): Promise<FuturesQuote | null> {
  const futuresInfo = FUTURES_SYMBOLS[symbol.toUpperCase()];
  if (!futuresInfo) {
    logger.warn(`Unknown futures symbol: ${symbol}`);
    return null;
  }
  
  // Check cache first
  const cached = futuresCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < FUTURES_CACHE_TTL) {
    return cached.quote;
  }
  
  try {
    const response = await fetch(
      `${YAHOO_FINANCE_API}/${futuresInfo.yahoo}?interval=1m&range=1d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    
    if (!response.ok) {
      logger.warn(`Yahoo Finance futures error for ${symbol}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (!result || !result.meta) {
      return null;
    }
    
    const meta = result.meta;
    const previousClose = meta.chartPreviousClose || meta.previousClose || meta.regularMarketPrice;
    const currentPrice = meta.regularMarketPrice;
    const change = currentPrice - previousClose;
    const changePercent = previousClose ? (change / previousClose) * 100 : 0;
    
    const quote: FuturesQuote = {
      symbol: symbol.toUpperCase(),
      name: futuresInfo.name,
      price: currentPrice,
      change,
      changePercent,
      high: meta.regularMarketDayHigh || currentPrice,
      low: meta.regularMarketDayLow || currentPrice,
      volume: meta.regularMarketVolume || 0,
      previousClose,
      session: getFuturesSession(),
      lastUpdate: new Date().toISOString(),
    };
    
    // Update cache
    futuresCache.set(symbol, { quote, timestamp: Date.now() });
    
    logger.info(`✅ Futures quote: ${symbol} @ $${currentPrice.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`);
    
    return quote;
  } catch (error) {
    logger.error(`Error fetching futures quote for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetch all major futures quotes
 */
export async function fetchAllFuturesQuotes(): Promise<FuturesQuote[]> {
  const symbols = Object.keys(FUTURES_SYMBOLS);
  const quotes: FuturesQuote[] = [];
  
  // Fetch in batches to avoid rate limits
  for (const symbol of symbols) {
    const quote = await fetchYahooFuturesQuote(symbol);
    if (quote) {
      quotes.push(quote);
    }
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return quotes;
}

/**
 * Fetch specific futures quote
 */
export async function fetchFuturesQuote(symbol: string): Promise<FuturesQuote | null> {
  return fetchYahooFuturesQuote(symbol);
}

/**
 * Get list of available futures symbols
 */
export function getAvailableFuturesSymbols(): Array<{ symbol: string; name: string; tickSize: number; pointValue: number }> {
  return Object.entries(FUTURES_SYMBOLS).map(([symbol, info]) => ({
    symbol,
    name: info.name,
    tickSize: info.tickSize,
    pointValue: info.pointValue,
  }));
}

/**
 * Fetch futures historical data for charting
 */
export async function fetchFuturesHistory(
  symbol: string,
  interval: '1m' | '5m' | '15m' | '1h' | '1d' = '15m',
  range: '1d' | '5d' | '1mo' | '3mo' = '5d'
): Promise<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]> {
  const futuresInfo = FUTURES_SYMBOLS[symbol.toUpperCase()];
  if (!futuresInfo) {
    return [];
  }
  
  try {
    const response = await fetch(
      `${YAHOO_FINANCE_API}/${futuresInfo.yahoo}?interval=${interval}&range=${range}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    
    if (!response.ok) {
      return [];
    }
    
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      return [];
    }
    
    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];
    
    const candles: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
    
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.open[i] !== null && quote.close[i] !== null) {
        candles.push({
          timestamp: timestamps[i] * 1000,
          open: quote.open[i],
          high: quote.high[i],
          low: quote.low[i],
          close: quote.close[i],
          volume: quote.volume[i] || 0,
        });
      }
    }
    
    return candles;
  } catch (error) {
    logger.error(`Error fetching futures history for ${symbol}:`, error);
    return [];
  }
}

/**
 * Company profile with business description, industry, and key stats
 */
export interface CompanyProfile {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  website: string;
  marketCap: number;
  employees: number;
  headquarters: string;
  keyDrivers: string[];
  catalysts: string[];
}

/**
 * Fetch company profile from Yahoo Finance quoteSummary API
 * Returns business description, sector, industry, and key information
 */
export async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const upperSymbol = symbol.toUpperCase();
  
  try {
    // Yahoo Finance quoteSummary endpoint with assetProfile module
    const response = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${upperSymbol}?modules=assetProfile,summaryProfile,price,summaryDetail`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    
    if (!response.ok) {
      logger.warn(`Yahoo quoteSummary failed for ${symbol}: HTTP ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const result = data?.quoteSummary?.result?.[0];
    
    if (!result) {
      logger.warn(`No quoteSummary data for ${symbol}`);
      return null;
    }
    
    const assetProfile = result.assetProfile || {};
    const price = result.price || {};
    const summaryDetail = result.summaryDetail || {};
    
    // Extract key information
    const description = assetProfile.longBusinessSummary || '';
    const sector = assetProfile.sector || price.sector || 'Unknown';
    const industry = assetProfile.industry || 'Unknown';
    const website = assetProfile.website || '';
    const marketCap = price.marketCap?.raw || summaryDetail.marketCap?.raw || 0;
    const employees = assetProfile.fullTimeEmployees || 0;
    
    // Build headquarters location
    const city = assetProfile.city || '';
    const state = assetProfile.state || '';
    const country = assetProfile.country || '';
    const headquarters = [city, state, country].filter(Boolean).join(', ');
    
    // Extract key drivers from description (simple keyword extraction)
    const keyDrivers = extractKeyDrivers(description, industry);
    
    // Generate potential catalysts based on sector/industry
    const catalysts = generatePotentialCatalysts(sector, industry);
    
    logger.info(`[PROFILE] Fetched company profile for ${symbol}: ${sector} / ${industry}`);
    
    return {
      symbol: upperSymbol,
      name: price.shortName || price.longName || upperSymbol,
      description: description.length > 500 ? description.substring(0, 500) + '...' : description,
      sector,
      industry,
      website,
      marketCap,
      employees,
      headquarters,
      keyDrivers,
      catalysts,
    };
  } catch (error) {
    logger.error(`Error fetching company profile for ${symbol}:`, error);
    return null;
  }
}

/**
 * Extract key business drivers from company description
 */
function extractKeyDrivers(description: string, industry: string): string[] {
  const drivers: string[] = [];
  const lowerDesc = description.toLowerCase();
  
  // Revenue drivers by industry
  const techKeywords = ['software', 'cloud', 'saas', 'subscription', 'ai', 'machine learning', 'data', 'platform'];
  const financeKeywords = ['interest', 'loans', 'deposits', 'trading', 'fees', 'assets under management'];
  const healthcareKeywords = ['drug', 'therapy', 'fda', 'clinical trials', 'pharmaceutical', 'medical devices'];
  const retailKeywords = ['e-commerce', 'stores', 'sales', 'merchandise', 'consumer spending'];
  const energyKeywords = ['oil', 'gas', 'production', 'drilling', 'renewable', 'power generation'];
  
  // Check for matches based on industry
  const keywords = [
    ...techKeywords,
    ...financeKeywords,
    ...healthcareKeywords,
    ...retailKeywords,
    ...energyKeywords,
  ];
  
  for (const keyword of keywords) {
    if (lowerDesc.includes(keyword) && drivers.length < 4) {
      drivers.push(keyword.charAt(0).toUpperCase() + keyword.slice(1));
    }
  }
  
  // Add industry-specific driver if no keywords found
  if (drivers.length === 0) {
    drivers.push(industry);
  }
  
  return drivers;
}

/**
 * Generate potential catalysts based on sector/industry
 */
function generatePotentialCatalysts(sector: string, industry: string): string[] {
  const catalysts: string[] = [];
  
  // Common catalysts by sector
  const sectorCatalysts: Record<string, string[]> = {
    'Technology': ['Product launches', 'Earnings beats', 'AI integration', 'M&A activity'],
    'Healthcare': ['FDA approvals', 'Clinical trial results', 'Drug pipeline updates', 'Regulatory changes'],
    'Financial Services': ['Interest rate changes', 'Loan growth', 'Credit quality', 'M&A deals'],
    'Consumer Cyclical': ['Holiday sales', 'Store openings', 'E-commerce growth', 'Consumer sentiment'],
    'Consumer Defensive': ['Pricing power', 'Market share gains', 'Dividend increases', 'Cost cutting'],
    'Energy': ['Oil prices', 'Production growth', 'Reserve discoveries', 'Policy changes'],
    'Industrials': ['Infrastructure spending', 'Defense contracts', 'Supply chain', 'Capex cycles'],
    'Basic Materials': ['Commodity prices', 'Demand from China', 'New mines/facilities', 'ESG regulations'],
    'Real Estate': ['Interest rates', 'Occupancy rates', 'Rent growth', 'Property acquisitions'],
    'Utilities': ['Rate cases', 'Renewable investments', 'Weather patterns', 'Regulatory approvals'],
    'Communication Services': ['Subscriber growth', 'Content deals', 'Ad revenue', 'Streaming competition'],
  };
  
  const sectorKey = Object.keys(sectorCatalysts).find(key => 
    sector.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(sector.toLowerCase())
  );
  
  if (sectorKey) {
    catalysts.push(...sectorCatalysts[sectorKey]);
  } else {
    catalysts.push('Earnings reports', 'Guidance updates', 'Industry trends', 'Macro factors');
  }
  
  return catalysts.slice(0, 4);
}

/**
 * Comprehensive fundamental data for stock analysis
 * Includes valuation metrics, growth rates, analyst ratings, and short interest
 */
export interface FundamentalData {
  symbol: string;
  marketCap: number | null;       // Market capitalization
  // Valuation metrics
  peRatio: number | null;         // Price-to-Earnings
  forwardPE: number | null;       // Forward P/E
  pegRatio: number | null;        // PEG ratio (P/E to Growth)
  priceToBook: number | null;     // Price-to-Book
  priceToSales: number | null;    // Price-to-Sales
  enterpriseValue: number | null; // Enterprise Value
  
  // Earnings
  eps: number | null;             // Earnings Per Share (TTM)
  forwardEps: number | null;      // Forward EPS estimate
  
  // Growth metrics
  revenueGrowth: number | null;   // YoY revenue growth %
  earningsGrowth: number | null;  // YoY earnings growth %
  quarterlyRevenueGrowth: number | null;
  quarterlyEarningsGrowth: number | null;
  
  // Profitability
  profitMargin: number | null;    // Net profit margin %
  operatingMargin: number | null; // Operating margin %
  grossMargin: number | null;     // Gross margin %
  returnOnEquity: number | null;  // ROE %
  returnOnAssets: number | null;  // ROA %
  
  // Financial health
  debtToEquity: number | null;    // D/E ratio
  currentRatio: number | null;    // Current ratio
  quickRatio: number | null;      // Quick ratio
  freeCashFlow: number | null;    // Free cash flow
  
  // Analyst data
  analystTargetPrice: number | null;     // Mean analyst target
  analystHighTarget: number | null;      // Highest target
  analystLowTarget: number | null;       // Lowest target
  numberOfAnalysts: number | null;       // Analyst coverage
  recommendationKey: string | null;      // buy/hold/sell
  recommendationMean: number | null;     // 1-5 scale (1=strong buy)
  
  // Short interest
  shortRatio: number | null;             // Days to cover
  shortPercentOfFloat: number | null;    // Short % of float
  sharesShort: number | null;            // Shares shorted
  
  // Dividend
  dividendYield: number | null;          // Dividend yield %
  dividendRate: number | null;           // Annual dividend $
  payoutRatio: number | null;            // Payout ratio %
  
  // Fair value indicators
  fairValueUpside: number | null;        // % to analyst target
  
  // Metadata
  fetchedAt: string;
}

// Fundamental data cache to avoid rate limiting (15 minute TTL)
const fundamentalCache = new Map<string, { data: FundamentalData; timestamp: number }>();
const FUNDAMENTAL_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch comprehensive fundamental data from Yahoo Finance
 * Uses multiple quoteSummary modules for complete coverage
 * Includes retry logic with exponential backoff for rate limiting
 * Caches results for 15 minutes to avoid rate limits
 */
export async function fetchFundamentalData(symbol: string): Promise<FundamentalData | null> {
  const upperSymbol = symbol.toUpperCase();
  
  // Check cache first
  const cached = fundamentalCache.get(upperSymbol);
  if (cached && Date.now() - cached.timestamp < FUNDAMENTAL_CACHE_TTL_MS) {
    logger.debug(`[FUNDAMENTALS] Cache hit for ${upperSymbol}`);
    return cached.data;
  }
  
  // User agent rotation to reduce rate limiting
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  
  try {
    // Extended modules for comprehensive data
    const modules = [
      'defaultKeyStatistics',  // P/E, EPS, short interest, shares outstanding
      'financialData',         // Revenue, margins, analyst targets
      'summaryDetail',         // Dividend, market cap, volume
      'earnings',              // EPS history and estimates
      'recommendationTrend',   // Analyst ratings trend
    ].join(',');
    
    // Retry logic with exponential backoff
    const maxRetries = 2;
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 500ms, 1500ms
        await new Promise(resolve => setTimeout(resolve, 500 * Math.pow(2, attempt - 1)));
      }
      
      try {
        const response = await fetch(
          `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${upperSymbol}?modules=${modules}`,
          {
            headers: {
              'User-Agent': randomUserAgent,
              'Accept': 'application/json',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
            }
          }
        );
        
        if (response.ok) {
          const data = await response.json();
          const result = data?.quoteSummary?.result?.[0];
          
          if (result) {
            const fundamentalData = parseFundamentalResult(upperSymbol, result);
            // Cache the result
            fundamentalCache.set(upperSymbol, { data: fundamentalData, timestamp: Date.now() });
            return fundamentalData;
          }
        } else if (response.status === 401 || response.status === 429) {
          // Rate limited - retry
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        } else {
          logger.warn(`[FUNDAMENTALS] Yahoo quoteSummary failed for ${symbol}: HTTP ${response.status}`);
          return null;
        }
      } catch (fetchError) {
        lastError = fetchError as Error;
        continue;
      }
    }
    
    // All retries exhausted
    if (lastError) {
      logger.warn(`[FUNDAMENTALS] Yahoo quoteSummary failed for ${symbol} after retries: ${lastError.message}`);
    }
    return null;
  } catch (error) {
    logger.warn(`[FUNDAMENTALS] Exception fetching data for ${symbol}: ${error}`);
    return null;
  }
}

/**
 * Parse Yahoo Finance quoteSummary result into FundamentalData
 */
function parseFundamentalResult(symbol: string, result: any): FundamentalData {
  const keyStats = result.defaultKeyStatistics || {};
  const financials = result.financialData || {};
  const summary = result.summaryDetail || {};
  const recTrend = result.recommendationTrend?.trend?.[0] || {};
  
  // Helper to extract raw value from Yahoo response objects
  const raw = (obj: any): number | null => {
    if (obj === undefined || obj === null) return null;
    if (typeof obj === 'number') return obj;
    if (obj.raw !== undefined) return obj.raw;
    if (obj.fmt !== undefined && obj.raw === undefined) {
      const parsed = parseFloat(obj.fmt.replace(/[%,]/g, ''));
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  };
  
  // Calculate fair value upside
  const currentPrice = raw(financials.currentPrice);
  const targetPrice = raw(financials.targetMeanPrice);
  const fairValueUpside = currentPrice && targetPrice 
    ? ((targetPrice - currentPrice) / currentPrice) * 100 
    : null;
    
  const fundamental: FundamentalData = {
    symbol: symbol,
    marketCap: raw(summary.marketCap) || raw(keyStats.marketCap) || null,
      
      // Valuation
      peRatio: raw(keyStats.trailingPE) || raw(summary.trailingPE),
      forwardPE: raw(keyStats.forwardPE) || raw(summary.forwardPE),
      pegRatio: raw(keyStats.pegRatio),
      priceToBook: raw(keyStats.priceToBook),
      priceToSales: raw(keyStats.priceToSalesTrailing12Months) || raw(summary.priceToSalesTrailing12Months),
      enterpriseValue: raw(keyStats.enterpriseValue),
      
      // Earnings
      eps: raw(financials.trailingEps) || raw(keyStats.trailingEps),
      forwardEps: raw(financials.forwardEps) || raw(keyStats.forwardEps),
      
      // Growth
      revenueGrowth: raw(financials.revenueGrowth) ? raw(financials.revenueGrowth)! * 100 : null,
      earningsGrowth: raw(financials.earningsGrowth) ? raw(financials.earningsGrowth)! * 100 : null,
      quarterlyRevenueGrowth: raw(financials.revenueQuarterlyGrowth) ? raw(financials.revenueQuarterlyGrowth)! * 100 : null,
      quarterlyEarningsGrowth: raw(financials.earningsQuarterlyGrowth) ? raw(financials.earningsQuarterlyGrowth)! * 100 : null,
      
      // Profitability
      profitMargin: raw(financials.profitMargins) ? raw(financials.profitMargins)! * 100 : null,
      operatingMargin: raw(financials.operatingMargins) ? raw(financials.operatingMargins)! * 100 : null,
      grossMargin: raw(financials.grossMargins) ? raw(financials.grossMargins)! * 100 : null,
      returnOnEquity: raw(financials.returnOnEquity) ? raw(financials.returnOnEquity)! * 100 : null,
      returnOnAssets: raw(financials.returnOnAssets) ? raw(financials.returnOnAssets)! * 100 : null,
      
      // Financial health
      debtToEquity: raw(financials.debtToEquity),
      currentRatio: raw(financials.currentRatio),
      quickRatio: raw(financials.quickRatio),
      freeCashFlow: raw(financials.freeCashflow),
      
      // Analyst data
      analystTargetPrice: raw(financials.targetMeanPrice),
      analystHighTarget: raw(financials.targetHighPrice),
      analystLowTarget: raw(financials.targetLowPrice),
      numberOfAnalysts: raw(financials.numberOfAnalystOpinions),
      recommendationKey: financials.recommendationKey || null,
      recommendationMean: raw(financials.recommendationMean),
      
      // Short interest
      shortRatio: raw(keyStats.shortRatio),
      shortPercentOfFloat: raw(keyStats.shortPercentOfFloat) ? raw(keyStats.shortPercentOfFloat)! * 100 : null,
      sharesShort: raw(keyStats.sharesShort),
      
      // Dividend
      dividendYield: raw(summary.dividendYield) ? raw(summary.dividendYield)! * 100 : null,
      dividendRate: raw(summary.dividendRate),
      payoutRatio: raw(summary.payoutRatio) ? raw(summary.payoutRatio)! * 100 : null,
      
    // Fair value
    fairValueUpside,
      
    fetchedAt: new Date().toISOString(),
  };
    
  logger.info(`[FUNDAMENTALS] Fetched for ${symbol}: P/E=${fundamental.peRatio?.toFixed(1) || 'N/A'}, EPS=${fundamental.eps?.toFixed(2) || 'N/A'}, Target=$${fundamental.analystTargetPrice?.toFixed(0) || 'N/A'}`);
    
  return fundamental;
}
