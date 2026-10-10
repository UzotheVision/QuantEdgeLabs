import { logger } from "./logger";
import { storage } from "./storage";
import type { FuturesContract } from "@shared/schema";
import { getFuturesPrice as getRealtimeFuturesPrice } from "./realtime-price-service";

// Price cache with 30-second TTL
interface PriceCacheEntry {
  price: number;
  timestamp: Date;
}

const priceCache = new Map<string, PriceCacheEntry>();
const PRICE_CACHE_TTL = 30 * 1000; // 30 seconds

// Mock price base values for various futures
const MOCK_PRICES: Record<string, number> = {
  // Index futures
  NQ: 21000, // E-mini Nasdaq-100
  ES: 5900,  // E-mini S&P 500
  YM: 43000, // E-mini Dow
  RTY: 2200, // E-mini Russell
  // Metals (COMEX)
  GC: 2750,  // Gold
  SI: 31,    // Silver
  HG: 4.5,   // Copper
  PL: 1000,  // Platinum
  PA: 950,   // Palladium
  // Energy (NYMEX)
  CL: 75,    // Crude Oil WTI
  NG: 3.5,   // Natural Gas
  // Bonds
  ZB: 118,   // 30-Year T-Bond
  ZN: 110,   // 10-Year T-Note
};

// Price fluctuation ranges
const PRICE_FLUCTUATIONS: Record<string, number> = {
  NQ: 10,    // +/- 10 points
  ES: 5,     // +/- 5 points
  YM: 50,    // +/- 50 points
  RTY: 2,    // +/- 2 points
  GC: 5,     // +/- 5 points
  SI: 0.2,   // +/- 0.2 points
  HG: 0.05,  // +/- 0.05 points
  PL: 10,    // +/- 10 points
  PA: 10,    // +/- 10 points
  CL: 0.5,   // +/- 0.5 points
  NG: 0.05,  // +/- 0.05 points
  ZB: 0.5,   // +/- 0.5 points
  ZN: 0.25,  // +/- 0.25 points
};

/**
 * Check if Databento API is available
 * TODO: Replace with actual Databento API key check when available
 * Reference: https://databento.com/docs/api-reference/authentication
 */
export function isDatentoAvailable(): boolean {
  const apiKey = process.env.DATABENTO_API_KEY;
  const isAvailable = !!apiKey && apiKey.length > 0;
  
  if (!isAvailable) {
    logger.info('[FUTURES-SERVICE] Databento API key not available - using mock data');
  }
  
  return isAvailable;
}

/**
 * Generate mock price with small random fluctuations
 * @param rootSymbol - Futures root symbol (e.g., 'NQ', 'GC', 'HG', 'CL')
 * @returns Mock price with random fluctuation
 */
function generateMockPrice(rootSymbol: string): number {
  const basePrice = MOCK_PRICES[rootSymbol] || 100;
  const fluctuation = PRICE_FLUCTUATIONS[rootSymbol] || 1;

  // No random fluctuation — return static base price until real feed available
  const price = basePrice;

  // Tick sizes by product type
  const tickSizes: Record<string, number> = {
    NQ: 0.25, ES: 0.25, YM: 1, RTY: 0.1,
    GC: 0.10, SI: 0.005, HG: 0.0005, PL: 0.10, PA: 0.10,
    CL: 0.01, NG: 0.001, ZB: 0.03125, ZN: 0.015625,
  };
  const tickSize = tickSizes[rootSymbol] || 0.01;
  return Math.round(price / tickSize) * tickSize;
}

/**
 * Get cached price or generate new mock price
 * @param contractCode - e.g., 'NQH25', 'HGH25'
 * @param rootSymbol - Futures root symbol (e.g., 'NQ', 'GC', 'HG')
 * @returns Cached or newly generated price
 */
function getCachedOrGeneratePrice(contractCode: string, rootSymbol: string): number {
  const cached = priceCache.get(contractCode);
  const now = new Date();

  // Check if cache is valid (within TTL)
  if (cached && (now.getTime() - cached.timestamp.getTime()) < PRICE_CACHE_TTL) {
    logger.debug(`[FUTURES-SERVICE] Using cached price for ${contractCode}: $${cached.price}`);
    return cached.price;
  }

  // Generate new mock price
  const price = generateMockPrice(rootSymbol);

  // Update cache
  priceCache.set(contractCode, {
    price,
    timestamp: now,
  });

  logger.info(`[FUTURES-SERVICE] Generated mock price for ${contractCode}: $${price} (${rootSymbol} base: $${MOCK_PRICES[rootSymbol] || 'unknown'})`);

  return price;
}

/**
 * Get active front month contract for a root symbol
 * @param rootSymbol - Futures root symbol (e.g., 'NQ', 'GC', 'HG', 'CL')
 * @returns Active front month futures contract
 * @throws Error if no active contract found
 */
export async function getActiveFuturesContract(rootSymbol: string): Promise<FuturesContract> {
  logger.debug(`[FUTURES-SERVICE] Fetching active front month contract for ${rootSymbol}`);

  const contract = await storage.getActiveFuturesContract(rootSymbol);

  if (!contract) {
    const error = `No active front month contract found for ${rootSymbol}`;
    logger.error(`[FUTURES-SERVICE] ${error}`);
    throw new Error(error);
  }

  logger.info(`[FUTURES-SERVICE] Found active contract: ${contract.contractCode} (expires: ${contract.expirationDate})`);

  return contract;
}

/**
 * Get current price for a specific futures contract
 * @param contractCode - e.g., 'NQH25', 'GCJ25'
 * @returns Current price (mock data until Databento integrated)
 * @throws Error if contract not found
 */
export async function getFuturesPrice(contractCode: string): Promise<number> {
  logger.debug(`[FUTURES-SERVICE] Fetching price for ${contractCode}`);
  
  // Validate contract exists in database
  const contract = await storage.getFuturesContract(contractCode);
  
  if (!contract) {
    const error = `Contract not found: ${contractCode}`;
    logger.error(`[FUTURES-SERVICE] ${error}`);
    throw new Error(error);
  }
  
  // PRIORITY 1: Try real-time Databento WebSocket price (sub-second latency)
  const realtimePrice = getRealtimeFuturesPrice(contract.rootSymbol);
  if (realtimePrice) {
    const ageMs = Date.now() - realtimePrice.timestamp.getTime();
    logger.debug(`[FUTURES-RT] ${contractCode}: $${realtimePrice.price} (${ageMs}ms old, source: ${realtimePrice.source})`);
    
    // Update cache with real-time price
    priceCache.set(contractCode, {
      price: realtimePrice.price,
      timestamp: realtimePrice.timestamp,
    });
    
    return realtimePrice.price;
  }
  
  // Fallback to mock data if Databento not connected
  if (isDatentoAvailable()) {
    logger.debug(`[FUTURES-SERVICE] Databento API key found but no real-time price yet - using mock data`);
  }
  
  const price = getCachedOrGeneratePrice(contractCode, contract.rootSymbol);
  
  return price;
}

/**
 * Get multiple contract prices at once (bulk operation)
 * @param contractCodes - Array of contract codes (e.g., ['NQH25', 'GCJ25'])
 * @returns Map of contract code to price
 */
export async function getFuturesPrices(contractCodes: string[]): Promise<Map<string, number>> {
  logger.debug(`[FUTURES-SERVICE] Fetching prices for ${contractCodes.length} contracts`);
  
  const priceMap = new Map<string, number>();
  
  // TODO: Replace with Databento batch API when available
  // Reference: https://databento.com/docs/api-reference/timeseries/batch
  // For now, fetch each price individually (can be optimized later)
  
  for (const contractCode of contractCodes) {
    try {
      const price = await getFuturesPrice(contractCode);
      priceMap.set(contractCode, price);
    } catch (error) {
      logger.error(`[FUTURES-SERVICE] Failed to get price for ${contractCode}:`, error);
      // Continue with other contracts even if one fails
    }
  }
  
  logger.info(`[FUTURES-SERVICE] Successfully fetched ${priceMap.size}/${contractCodes.length} prices`);
  
  return priceMap;
}

// Price history cache for trend analysis
const historyCache = new Map<string, { prices: number[]; timestamp: Date }>();
const HISTORY_CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Get recent price history for trend analysis
 * Uses Yahoo Finance for historical data
 * @param contractCode - e.g., 'NQH25', 'GCJ25'
 * @returns Array of recent prices (last 20 data points)
 */
export async function getFuturesHistory(contractCode: string): Promise<number[]> {
  // Check cache first
  const cached = historyCache.get(contractCode);
  if (cached && (Date.now() - cached.timestamp.getTime()) < HISTORY_CACHE_TTL) {
    return cached.prices;
  }
  
  // Map contract code to Yahoo Finance symbol
  const rootSymbol = contractCode.substring(0, 2).toUpperCase();

  // Yahoo Finance futures symbols mapping
  const yahooSymbolMap: Record<string, string> = {
    // Index futures
    NQ: 'NQ=F', ES: 'ES=F', YM: 'YM=F', RTY: 'RTY=F',
    // Metals (COMEX)
    GC: 'GC=F', SI: 'SI=F', HG: 'HG=F', PL: 'PL=F', PA: 'PA=F',
    // Energy (NYMEX)
    CL: 'CL=F', NG: 'NG=F', RB: 'RB=F', HO: 'HO=F',
    // Bonds
    ZB: 'ZB=F', ZN: 'ZN=F', ZF: 'ZF=F', ZT: 'ZT=F',
    // Agriculture
    ZC: 'ZC=F', ZS: 'ZS=F', ZW: 'ZW=F',
  };

  const yahooSymbol = yahooSymbolMap[rootSymbol] || `${rootSymbol}=F`;
  
  try {
    // Fetch from Yahoo Finance
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=5m&range=2d`);
    if (!response.ok) {
      logger.warn(`[FUTURES-HISTORY] Yahoo fetch failed for ${yahooSymbol}: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const quotes = data.chart?.result?.[0]?.indicators?.quote?.[0];
    const closes = quotes?.close?.filter((p: any) => p !== null) || [];
    
    // Get last 20 prices for trend analysis
    const recentPrices = closes.slice(-20) as number[];
    
    // Cache the result
    historyCache.set(contractCode, {
      prices: recentPrices,
      timestamp: new Date()
    });
    
    logger.info(`[FUTURES-HISTORY] Fetched ${recentPrices.length} prices for ${contractCode}`);
    return recentPrices;
  } catch (error) {
    logger.warn(`[FUTURES-HISTORY] Error fetching history for ${contractCode}:`, error);
    return [];
  }
}

/**
 * Clear price cache (useful for testing or forcing refresh)
 */
export function clearPriceCache(): void {
  const size = priceCache.size;
  priceCache.clear();
  logger.info(`[FUTURES-SERVICE] Cleared price cache (${size} entries)`);
}

/**
 * Get cache statistics (for monitoring/debugging)
 */
export function getCacheStats(): { size: number; entries: Array<{ contractCode: string; price: number; age: number }> } {
  const now = new Date();
  const entries = Array.from(priceCache.entries()).map(([contractCode, entry]) => ({
    contractCode,
    price: entry.price,
    age: Math.floor((now.getTime() - entry.timestamp.getTime()) / 1000), // age in seconds
  }));
  
  return {
    size: priceCache.size,
    entries,
  };
}
