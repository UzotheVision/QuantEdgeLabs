import { logger } from './logger';
import { getFullUniverse, getSectorTickers, PREMIUM_WATCHLIST, LOTTO_ELIGIBLE } from './ticker-universe';
import { getExpandedUniverse, getNewMoverSymbols, getDiscoveryStatus } from './mover-discovery';
import { recordSymbolAttention } from './attention-tracking-service';

const YAHOO_FINANCE_API = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_SCREENER_API = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";

// ===============================================
// SCAN CONCURRENCY LIMITER - Prevents memory overload
// ===============================================
const MAX_CONCURRENT_SCANS = 2; // Maximum simultaneous scan operations
const SCAN_BATCH_SIZE = 5; // Reduced from 10/20 to prevent memory spikes
const BATCH_DELAY_MS = 150; // Delay between batches to allow GC

let activeScanCount = 0;
const scanQueue: Array<{ resolve: () => void; name: string }> = [];

async function acquireScanSlot(scanName: string): Promise<void> {
  if (activeScanCount < MAX_CONCURRENT_SCANS) {
    activeScanCount++;
    logger.debug(`[SCAN-LIMITER] Acquired slot for ${scanName} (${activeScanCount}/${MAX_CONCURRENT_SCANS} active)`);
    return;
  }

  logger.info(`[SCAN-LIMITER] Queuing ${scanName} (${scanQueue.length + 1} waiting, ${activeScanCount} active)`);
  return new Promise((resolve) => {
    scanQueue.push({ resolve, name: scanName });
  });
}

function releaseScanSlot(scanName: string): void {
  activeScanCount = Math.max(0, activeScanCount - 1);

  if (scanQueue.length > 0) {
    const next = scanQueue.shift()!;
    activeScanCount++;
    logger.debug(`[SCAN-LIMITER] Released ${scanName}, starting queued ${next.name}`);
    next.resolve();
  } else {
    logger.debug(`[SCAN-LIMITER] Released ${scanName} (${activeScanCount}/${MAX_CONCURRENT_SCANS} active)`);
  }
}

// Get current scan status for monitoring
export function getScanStatus(): { active: number; queued: number; max: number } {
  return { active: activeScanCount, queued: scanQueue.length, max: MAX_CONCURRENT_SCANS };
}

export interface StockPerformance {
  symbol: string;
  name: string;
  sector?: string;
  currentPrice: number;
  previousClose: number;
  dayChange: number;
  dayChangePercent: number;
  weekChange?: number;
  weekChangePercent?: number;
  monthChange?: number;
  monthChangePercent?: number;
  ytdChange?: number;
  ytdChangePercent?: number;
  yearChange?: number;
  yearChangePercent?: number;
  volume: number;
  avgVolume?: number;
  marketCap?: number;
  peRatio?: number;
  week52High?: number;
  week52Low?: number;
  lastUpdated: Date;
}

interface YahooQuoteResult {
  symbol: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice: number;
  regularMarketPreviousClose: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketVolume: number;
  averageDailyVolume10Day?: number;
  marketCap?: number;
  trailingPE?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  sector?: string;
}

const scannerCache = new Map<string, { data: StockPerformance[]; timestamp: number }>();
const moversCache = new Map<string, { data: { gainers: StockPerformance[]; losers: StockPerformance[] }; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MOVERS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes for movers

const SP500_SYMBOLS = [
  'AAPL', 'MSFT', 'AMZN', 'NVDA', 'GOOGL', 'META', 'TSLA', 'BRK-B', 'UNH', 'XOM',
  'JNJ', 'JPM', 'V', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV', 'LLY',
  'PEP', 'KO', 'COST', 'AVGO', 'TMO', 'WMT', 'MCD', 'CSCO', 'ABT', 'DHR',
  'ACN', 'VZ', 'ADBE', 'CRM', 'CMCSA', 'NKE', 'NEE', 'TXN', 'PM', 'BMY',
  'INTC', 'AMD', 'QCOM', 'HON', 'UPS', 'RTX', 'LOW', 'UNP', 'SPGI', 'CAT',
  'GS', 'MS', 'BLK', 'AMAT', 'ELV', 'DE', 'BA', 'IBM', 'GILD', 'MDLZ',
  'AXP', 'ISRG', 'ADI', 'BKNG', 'SBUX', 'PLD', 'LMT', 'TJX', 'MMC', 'REGN',
  'SYK', 'AMT', 'VRTX', 'LRCX', 'GE', 'NOW', 'ZTS', 'CVS', 'MO', 'CB',
  'C', 'ETN', 'PANW', 'CI', 'BDX', 'SO', 'DUK', 'CL', 'EQIX', 'CME',
  'PGR', 'AON', 'ITW', 'BSX', 'KLAC', 'FI', 'MU', 'WM', 'APD', 'MCK',
  'PLTR', 'IONQ', 'RKLB', 'SMR', 'OKLO', 'HIMS', 'APP', 'SOUN', 'MARA', 'RIOT',
  'COIN', 'HOOD', 'SOFI', 'AFRM', 'UPST', 'NU', 'DKNG', 'ABNB', 'CRWD', 'NET',
  'SNOW', 'DDOG', 'ZS', 'MDB', 'OKTA', 'TWLO', 'DOCU', 'TTD', 'ROKU', 'SQ',
  'SHOP', 'MELI', 'SE', 'BABA', 'JD', 'PDD', 'GRAB', 'PATH', 'U', 'RBLX',
  'ARM', 'SMCI', 'VRT', 'DELL', 'HPE', 'ORCL', 'SAP', 'CRM', 'WDAY', 'TEAM',
];

const PENNY_STOCKS = [
  'SNDL', 'PLUG', 'FCEL', 'NKLA', 'LCID', 'RIVN', 'FSR', 'GOEV', 'WKHS', 'RIDE',
  'SPCE', 'ASTR', 'RDW', 'VORB', 'ASTS', 'GSAT', 'BKSY', 'LUNR', 'SATL', 'MNTS',
  'MULN', 'FFIE', 'REE', 'DRMA', 'CLSK', 'HUT', 'BITF', 'CORZ', 'GREE', 'IREN',
  'DNA', 'BEAM', 'CRSP', 'EDIT', 'NTLA', 'VERV', 'ACHR', 'JOBY', 'EVTL', 'LILM',
  'ARBE', 'LAZR', 'AEVA', 'MVIS', 'VLDR', 'OUST', 'INVZ', 'CPTN', 'LIDR', 'AEYE',
];

const GROWTH_STOCKS = [
  'NVDA', 'AMD', 'PLTR', 'SMCI', 'ARM', 'MRVL', 'AVGO', 'MU', 'LRCX', 'KLAC',
  'ASML', 'TSM', 'INTC', 'TXN', 'ADI', 'ON', 'NXPI', 'QCOM', 'AMAT', 'SNPS',
  'CDNS', 'ANSS', 'MCHP', 'SWKS', 'QRVO', 'WOLF', 'CRUS', 'SITM', 'RMBS', 'MPWR',
  'CRWD', 'NET', 'ZS', 'PANW', 'FTNT', 'S', 'OKTA', 'CYBR', 'RPD', 'TENB',
  'SNOW', 'DDOG', 'MDB', 'CFLT', 'ESTC', 'NEWR', 'SPLK', 'SUMO', 'DT', 'GTLB',
  'APP', 'SOUN', 'IONQ', 'RKLB', 'SMR', 'OKLO', 'NNE', 'LEU', 'CCJ', 'UEC',
  'COIN', 'MARA', 'RIOT', 'HUT', 'CLSK', 'BITF', 'CORZ', 'IREN', 'BTBT', 'ARBK',
  // High-Momentum Mid-Caps (big movers)
  'CVNA', 'UPST', 'W', 'DASH', 'ABNB', 'UBER', 'LYFT', 'RBLX', 'U', 'SNAP',
  // China ADRs
  'BABA', 'BIDU', 'JD', 'PDD', 'LI', 'XPEV', 'NIO',
];

const ETF_UNIVERSE = [
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'VT', 'SCHD', 'JEPI', 'JEPQ',
  'ARKK', 'ARKG', 'ARKF', 'ARKW', 'ARKQ', 'XLK', 'XLF', 'XLE', 'XLV', 'XLI',
  'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'SMH', 'SOXX', 'IGV', 'FXI', 'EEM',
  'TLT', 'SHY', 'BND', 'HYG', 'LQD', 'GLD', 'SLV', 'USO', 'UNG', 'WEAT',
  'TQQQ', 'SQQQ', 'UPRO', 'SPXU', 'TNA', 'TZA', 'SOXL', 'SOXS', 'LABU', 'LABD',
];

export function getStockUniverse(category: 'all' | 'sp500' | 'growth' | 'penny' | 'etf' | 'premium' | 'lotto' | 'expanded' | 'static' = 'all'): string[] {
  switch (category) {
    case 'sp500':
      return SP500_SYMBOLS;
    case 'growth':
      return GROWTH_STOCKS;
    case 'penny':
      return PENNY_STOCKS;
    case 'etf':
      return ETF_UNIVERSE;
    case 'premium':
      return PREMIUM_WATCHLIST;
    case 'lotto':
      return LOTTO_ELIGIBLE;
    case 'static':
      // Use only static universe (800+ tickers) - no dynamic movers
      return getFullUniverse();
    case 'expanded':
    case 'all':
    default:
      // Use expanded universe (static 800+ tickers + dynamically discovered movers)
      // This ensures scanners can find stocks like CVNA even if not in static list
      return getExpandedUniverse();
  }
}

/**
 * Trigger mover discovery scan - call this periodically during market hours
 * to discover new movers NOT in the static ticker universe
 */
export async function runMoverDiscovery(): Promise<{ newMovers: string[]; totalDiscovered: number }> {
  logger.info('[SCANNER] Running dynamic mover discovery...');
  
  try {
    const newMovers = await getNewMoverSymbols();
    const status = getDiscoveryStatus();
    
    if (newMovers.length > 0) {
      logger.info(`[SCANNER] Discovered ${newMovers.length} new movers not in static universe: ${newMovers.slice(0, 5).join(', ')}${newMovers.length > 5 ? '...' : ''}`);
    }
    
    return {
      newMovers,
      totalDiscovered: status.discoveredCount
    };
  } catch (error) {
    logger.error('[SCANNER] Mover discovery failed:', error);
    return { newMovers: [], totalDiscovered: 0 };
  }
}

async function fetchYahooQuote(symbol: string): Promise<YahooQuoteResult | null> {
  try {
    const response = await fetch(
      `${YAHOO_FINANCE_API}/${symbol}?interval=1d&range=1y`
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (!result) return null;

    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];
    const closes = quote?.close || [];
    const volumes = quote?.volume || [];
    
    const currentPrice = meta.regularMarketPrice || closes[closes.length - 1];
    const previousClose = meta.previousClose || (closes.length > 1 ? closes[closes.length - 2] : currentPrice);
    
    return {
      symbol: meta.symbol || symbol,
      shortName: meta.shortName,
      longName: meta.longName,
      regularMarketPrice: currentPrice,
      regularMarketPreviousClose: previousClose,
      regularMarketChange: currentPrice - previousClose,
      regularMarketChangePercent: previousClose ? ((currentPrice - previousClose) / previousClose) * 100 : 0,
      regularMarketVolume: volumes[volumes.length - 1] || 0,
      averageDailyVolume10Day: meta.averageDailyVolume10Day,
      marketCap: meta.marketCap,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    };
  } catch (error) {
    logger.debug(`Failed to fetch quote for ${symbol}: ${error}`);
    return null;
  }
}

async function fetchYahooHistoricalPerformance(symbol: string): Promise<{
  weekChange?: number;
  monthChange?: number;
  ytdChange?: number;
  yearChange?: number;
} | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const oneYearAgo = now - (365 * 24 * 60 * 60);
    
    const response = await fetch(
      `${YAHOO_FINANCE_API}/${symbol}?interval=1d&period1=${oneYearAgo}&period2=${now}`
    );

    if (!response.ok) return null;

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (!result) return null;

    const closes = result.indicators?.quote?.[0]?.close?.filter((p: number | null) => p !== null) || [];
    const timestamps = result.timestamp || [];
    
    if (closes.length < 2) return null;

    const currentPrice = closes[closes.length - 1];
    
    const weekIdx = Math.max(0, closes.length - 5);
    const monthIdx = Math.max(0, closes.length - 22);
    
    const currentYear = new Date().getFullYear();
    const janFirst = new Date(currentYear, 0, 1).getTime() / 1000;
    let ytdIdx = 0;
    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i] >= janFirst) {
        ytdIdx = i;
        break;
      }
    }

    return {
      weekChange: closes[weekIdx] ? ((currentPrice - closes[weekIdx]) / closes[weekIdx]) * 100 : undefined,
      monthChange: closes[monthIdx] ? ((currentPrice - closes[monthIdx]) / closes[monthIdx]) * 100 : undefined,
      ytdChange: closes[ytdIdx] ? ((currentPrice - closes[ytdIdx]) / closes[ytdIdx]) * 100 : undefined,
      yearChange: closes[0] ? ((currentPrice - closes[0]) / closes[0]) * 100 : undefined,
    };
  } catch (error) {
    logger.debug(`Failed to fetch historical for ${symbol}: ${error}`);
    return null;
  }
}

export async function scanStockPerformance(
  symbols: string[],
  includeHistorical: boolean = false
): Promise<StockPerformance[]> {
  const cacheKey = `scan_${symbols.slice(0, 10).join('_')}_${symbols.length}_${includeHistorical}`;

  const cached = scannerCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug(`[SCANNER] Using cached data for ${symbols.length} symbols`);
    return cached.data;
  }

  // Acquire scan slot to prevent memory overload
  await acquireScanSlot(`scanStockPerformance(${symbols.length})`);

  try {
    logger.info(`[SCANNER] Scanning ${symbols.length} symbols...`);
    const results: StockPerformance[] = [];

    // Use smaller batch size to reduce memory pressure
    for (let i = 0; i < symbols.length; i += SCAN_BATCH_SIZE) {
      const batch = symbols.slice(i, i + SCAN_BATCH_SIZE);

      const batchPromises = batch.map(async (symbol) => {
        const quote = await fetchYahooQuote(symbol);
        if (!quote) return null;

        let historical = null;
        if (includeHistorical) {
          historical = await fetchYahooHistoricalPerformance(symbol);
        }

        return {
          symbol: quote.symbol,
          name: quote.longName || quote.shortName || symbol,
          currentPrice: quote.regularMarketPrice,
          previousClose: quote.regularMarketPreviousClose,
          dayChange: quote.regularMarketChange,
          dayChangePercent: quote.regularMarketChangePercent,
          weekChange: historical?.weekChange,
          weekChangePercent: historical?.weekChange,
          monthChange: historical?.monthChange,
          monthChangePercent: historical?.monthChange,
          ytdChange: historical?.ytdChange,
          ytdChangePercent: historical?.ytdChange,
          yearChange: historical?.yearChange,
          yearChangePercent: historical?.yearChange,
          volume: quote.regularMarketVolume,
          avgVolume: quote.averageDailyVolume10Day,
          marketCap: quote.marketCap,
          peRatio: quote.trailingPE,
          week52High: quote.fiftyTwoWeekHigh,
          week52Low: quote.fiftyTwoWeekLow,
          lastUpdated: new Date(),
        } as StockPerformance;
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter((r): r is StockPerformance => r !== null));

      // Longer delay between batches to allow GC
      if (i + SCAN_BATCH_SIZE < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    scannerCache.set(cacheKey, { data: results, timestamp: Date.now() });

    logger.info(`[SCANNER] Completed scan: ${results.length}/${symbols.length} symbols fetched`);
    return results;
  } finally {
    releaseScanSlot(`scanStockPerformance(${symbols.length})`);
  }
}

export async function getTopMovers(
  timeframe: 'day' | 'week' | 'month' | 'ytd' | 'year' = 'day',
  category: 'all' | 'sp500' | 'growth' | 'penny' | 'etf' = 'all',
  limit: number = 50
): Promise<{ gainers: StockPerformance[]; losers: StockPerformance[] }> {
  const moversCacheKey = `movers_${timeframe}_${category}_${limit}`;
  
  const cachedMovers = moversCache.get(moversCacheKey);
  if (cachedMovers && Date.now() - cachedMovers.timestamp < MOVERS_CACHE_TTL) {
    logger.debug(`[SCANNER] Using cached movers for ${timeframe}/${category}`);
    return cachedMovers.data;
  }

  const symbols = getStockUniverse(category);
  const includeHistorical = timeframe !== 'day';
  
  logger.info(`[SCANNER] Fetching top movers: ${timeframe}/${category} (${symbols.length} symbols)`);
  const stocks = await scanStockPerformance(symbols, includeHistorical);
  
  let sortField: keyof StockPerformance;
  switch (timeframe) {
    case 'week':
      sortField = 'weekChangePercent';
      break;
    case 'month':
      sortField = 'monthChangePercent';
      break;
    case 'ytd':
      sortField = 'ytdChangePercent';
      break;
    case 'year':
      sortField = 'yearChangePercent';
      break;
    default:
      sortField = 'dayChangePercent';
  }

  const validStocks = stocks.filter(s => s[sortField] !== undefined && s[sortField] !== null);
  
  if (validStocks.length === 0) {
    logger.warn(`[SCANNER] No valid stocks found for ${timeframe}/${category}`);
  }
  
  const sorted = validStocks.sort((a, b) => {
    const aVal = a[sortField] as number;
    const bVal = b[sortField] as number;
    return bVal - aVal;
  });

  const result = {
    gainers: sorted.slice(0, limit),
    losers: sorted.slice(-limit).reverse(),
  };

  moversCache.set(moversCacheKey, { data: result, timestamp: Date.now() });
  logger.info(`[SCANNER] Cached movers: ${result.gainers.length} gainers, ${result.losers.length} losers`);
  
  return result;
}

export async function getSectorPerformance(): Promise<Record<string, { avg: number; count: number }>> {
  const sectorETFs: Record<string, string> = {
    'Technology': 'XLK',
    'Financials': 'XLF',
    'Healthcare': 'XLV',
    'Energy': 'XLE',
    'Consumer Discretionary': 'XLY',
    'Consumer Staples': 'XLP',
    'Industrials': 'XLI',
    'Materials': 'XLB',
    'Real Estate': 'XLRE',
    'Utilities': 'XLU',
    'Communication Services': 'XLC',
  };

  const results: Record<string, { avg: number; count: number }> = {};
  
  for (const [sector, etf] of Object.entries(sectorETFs)) {
    const quote = await fetchYahooQuote(etf);
    if (quote) {
      results[sector] = {
        avg: quote.regularMarketChangePercent,
        count: 1,
      };
    }
  }

  return results;
}

export function clearScannerCache(): void {
  scannerCache.clear();
  moversCache.clear();
  surgeCache.data = [];
  surgeCache.timestamp = 0;
  logger.info('[SCANNER] Cache cleared');
}

// ===============================================
// SURGE DETECTION SYSTEM - Find breakouts BEFORE they explode
// ===============================================

export interface SurgeSignal {
  symbol: string;
  name: string;
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  surgeType: 'PRE_SURGE' | 'BREAKOUT' | 'MOMENTUM' | 'VOLUME_SPIKE' | 'EARLY_MOVER';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  signals: string[];
  score: number;
  detectedAt: Date;
  // Technical context
  nearHigh52?: boolean;
  breakingResistance?: boolean;
  marketCap?: number;
  sector?: string;
}

// Surge detection thresholds - tuned for catching moves EARLY
const SURGE_THRESHOLDS = {
  // Volume thresholds (x average)
  volumeSpike: 2.0,       // 2x volume = something happening
  volumeSurge: 3.0,       // 3x volume = significant interest
  volumeExplosion: 5.0,   // 5x volume = massive activity
  
  // Price movement thresholds (%)
  earlyMove: 2.0,         // 2% = early momentum  
  breakout: 3.0,          // 3% = confirmed breakout (catches moves early!)
  surge: 6.0,             // 6% = strong surge
  explosion: 10.0,        // 10% = major move
  
  // Premarket/early detection (catches moves BEFORE they explode)
  preSurgeVolume: 1.5,    // 1.5x volume with small price move = building
  preSurgePrice: 1.0,     // 1% move with elevated volume = early signal
};

// Cache for surge data
const surgeCache: { data: SurgeSignal[]; timestamp: number } = { data: [], timestamp: 0 };
const SURGE_CACHE_TTL = 60 * 1000; // 1 minute - keep it fresh for real-time detection

/**
 * MAIN SURGE SCANNER - Scans entire universe for breakout candidates
 * Catches stocks BEFORE they explode by detecting:
 * 1. Volume building (pre-surge indicator)
 * 2. Price breakouts from range
 * 3. Momentum acceleration
 * 4. Sector-wide moves
 */
export async function scanForSurges(forceRefresh: boolean = false): Promise<SurgeSignal[]> {
  // Check cache
  if (!forceRefresh && surgeCache.data.length > 0 && Date.now() - surgeCache.timestamp < SURGE_CACHE_TTL) {
    logger.debug('[SURGE-SCANNER] Using cached surge data');
    return surgeCache.data;
  }

  // Acquire scan slot to prevent memory overload
  await acquireScanSlot('scanForSurges');

  try {
    logger.info('[SURGE-SCANNER] Starting real-time surge detection...');

    const surges: SurgeSignal[] = [];
    const universe = getExpandedUniverse(); // 800+ tickers including discovered movers

    // Limit universe size to prevent memory issues (scan top 400 most relevant)
    const limitedUniverse = universe.slice(0, 400);
    logger.info(`[SURGE-SCANNER] Scanning ${limitedUniverse.length} symbols (limited from ${universe.length})`);

    // Use smaller batch size to reduce memory pressure
    for (let i = 0; i < limitedUniverse.length; i += SCAN_BATCH_SIZE) {
      const batch = limitedUniverse.slice(i, i + SCAN_BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (symbol) => {
          try {
            const quote = await fetchYahooQuote(symbol);
            if (!quote || !quote.regularMarketPrice) return null;

            const price = quote.regularMarketPrice;
            const change = quote.regularMarketChange || 0;
            const changePercent = quote.regularMarketChangePercent || 0;
            const volume = quote.regularMarketVolume || 0;
            const avgVolume = quote.averageDailyVolume10Day || volume;
            const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;

            // Detect surge patterns
            const surge = detectSurgePattern(
              symbol,
              quote.longName || quote.shortName || symbol,
              price,
              change,
              changePercent,
              volume,
              avgVolume,
              volumeRatio,
              quote.fiftyTwoWeekHigh,
              quote.fiftyTwoWeekLow,
              quote.marketCap
            );

            return surge;
          } catch (error) {
            return null;
          }
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) {
          surges.push(result.value);
        }
      }

      // Longer delay between batches to allow GC and avoid rate limiting
      if (i + SCAN_BATCH_SIZE < limitedUniverse.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    // Sort by score (highest first)
    const sortedSurges = surges.sort((a, b) => b.score - a.score);

    // Update cache
    surgeCache.data = sortedSurges;
    surgeCache.timestamp = Date.now();

    logger.info(`[SURGE-SCANNER] Detected ${sortedSurges.length} surge signals (${sortedSurges.filter(s => s.severity === 'CRITICAL' || s.severity === 'HIGH').length} high priority)`);

    return sortedSurges;
  } finally {
    releaseScanSlot('scanForSurges');
  }
}

/**
 * Detect surge pattern for a single stock
 */
function detectSurgePattern(
  symbol: string,
  name: string,
  price: number,
  change: number,
  changePercent: number,
  volume: number,
  avgVolume: number,
  volumeRatio: number,
  week52High?: number,
  week52Low?: number,
  marketCap?: number
): SurgeSignal | null {
  const signals: string[] = [];
  let score = 0;
  let surgeType: SurgeSignal['surgeType'] = 'MOMENTUM';
  let severity: SurgeSignal['severity'] = 'LOW';
  
  const absChange = Math.abs(changePercent);
  const nearHigh52 = week52High ? price >= week52High * 0.95 : false;
  const breakingResistance = week52High ? price >= week52High * 0.98 : false;
  
  // ===== VOLUME DETECTION =====
  if (volumeRatio >= SURGE_THRESHOLDS.volumeExplosion) {
    signals.push(`VOLUME EXPLOSION: ${volumeRatio.toFixed(1)}x average`);
    score += 40;
    surgeType = 'VOLUME_SPIKE';
  } else if (volumeRatio >= SURGE_THRESHOLDS.volumeSurge) {
    signals.push(`High volume: ${volumeRatio.toFixed(1)}x average`);
    score += 25;
  } else if (volumeRatio >= SURGE_THRESHOLDS.volumeSpike) {
    signals.push(`Elevated volume: ${volumeRatio.toFixed(1)}x average`);
    score += 15;
  }
  
  // ===== PRICE MOVEMENT DETECTION =====
  if (absChange >= SURGE_THRESHOLDS.explosion) {
    signals.push(`MAJOR MOVE: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%`);
    score += 50;
    surgeType = 'BREAKOUT';
  } else if (absChange >= SURGE_THRESHOLDS.surge) {
    signals.push(`Strong surge: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%`);
    score += 35;
    surgeType = 'BREAKOUT';
  } else if (absChange >= SURGE_THRESHOLDS.breakout) {
    signals.push(`Breakout move: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%`);
    score += 25;
    surgeType = 'MOMENTUM';
  } else if (absChange >= SURGE_THRESHOLDS.earlyMove) {
    signals.push(`Early momentum: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%`);
    score += 15;
    surgeType = 'EARLY_MOVER';
  }
  
  // ===== PRE-SURGE DETECTION (the key to catching moves early!) =====
  if (volumeRatio >= SURGE_THRESHOLDS.preSurgeVolume && absChange >= SURGE_THRESHOLDS.preSurgePrice && absChange < SURGE_THRESHOLDS.breakout) {
    signals.push('PRE-SURGE: Volume building with price pressure');
    score += 20;
    surgeType = 'PRE_SURGE';
  }
  
  // ===== TECHNICAL CONTEXT =====
  if (breakingResistance && changePercent > 0) {
    signals.push('BREAKING 52-WEEK HIGH!');
    score += 30;
    surgeType = 'BREAKOUT';
  } else if (nearHigh52 && changePercent > 0) {
    signals.push('Near 52-week high - breakout imminent');
    score += 15;
  }
  
  // Check for oversold bounces (potential reversal plays)
  if (week52Low && price <= week52Low * 1.1 && changePercent > 2) {
    signals.push('Oversold bounce - reversal signal');
    score += 15;
  }
  
  // ===== FILTER OUT NOISE =====
  // Minimum threshold: need some signal to qualify
  if (score < 25) return null;
  
  // Need at least volume OR price movement
  if (volumeRatio < 1.3 && absChange < 2) return null;
  
  // ===== DETERMINE SEVERITY =====
  if (score >= 80) {
    severity = 'CRITICAL';
  } else if (score >= 55) {
    severity = 'HIGH';
  } else if (score >= 35) {
    severity = 'MEDIUM';
  } else {
    severity = 'LOW';
  }
  
  return {
    symbol,
    name,
    currentPrice: price,
    priceChange: change,
    priceChangePercent: changePercent,
    volume,
    avgVolume,
    volumeRatio,
    surgeType,
    severity,
    signals,
    score,
    detectedAt: new Date(),
    nearHigh52,
    breakingResistance,
    marketCap
  };
}

/**
 * Get latest surge alerts for API response
 */
export function getLatestSurges(): SurgeSignal[] {
  return surgeCache.data;
}

/**
 * Get high-priority surges only (CRITICAL + HIGH severity)
 */
export function getHighPrioritySurges(): SurgeSignal[] {
  return surgeCache.data.filter(s => s.severity === 'CRITICAL' || s.severity === 'HIGH');
}

// Smart Watchlist Pick with trade idea analysis
export interface SmartWatchlistPick {
  symbol: string;
  name: string;
  currentPrice: number;
  changePercent: number;
  timeframe: 'day' | 'week' | 'month' | 'ytd' | 'year';
  direction: 'long' | 'short';
  volume: number;
  avgVolume?: number;
  volumeRatio: number;
  marketCap?: number;
  week52High?: number;
  week52Low?: number;
  distanceFrom52High?: number;
  distanceFrom52Low?: number;
  tradeIdea: {
    thesis: string;
    entryReason: string;
    riskLevel: 'low' | 'medium' | 'high' | 'speculative';
    suggestedAction: string;
    technicalSignals: string[];
  };
  score: number;
}

const watchlistCache = new Map<string, { data: SmartWatchlistPick[]; timestamp: number }>();
const WATCHLIST_CACHE_TTL = 10 * 60 * 1000; // 10 minutes for watchlists

// Get the change percent for the specific timeframe
function getTimeframeChange(stock: StockPerformance, timeframe: string): number {
  switch (timeframe) {
    case 'week': return stock.weekChangePercent ?? stock.dayChangePercent;
    case 'month': return stock.monthChangePercent ?? stock.dayChangePercent;
    case 'ytd': return stock.ytdChangePercent ?? stock.dayChangePercent;
    case 'year': return stock.yearChangePercent ?? stock.dayChangePercent;
    default: return stock.dayChangePercent;
  }
}

// Generate trade idea analysis for a stock based on its performance data
function generateTradeIdea(stock: StockPerformance, timeframe: string, isGainer: boolean): SmartWatchlistPick['tradeIdea'] {
  const technicalSignals: string[] = [];
  const volumeRatio = stock.avgVolume ? stock.volume / stock.avgVolume : 1;
  const distanceFrom52High = stock.week52High && stock.currentPrice 
    ? ((stock.week52High - stock.currentPrice) / stock.week52High) * 100 : undefined;
  const distanceFrom52Low = stock.week52Low && stock.currentPrice 
    ? ((stock.currentPrice - stock.week52Low) / stock.week52Low) * 100 : undefined;
  
  // Get the correct change for this timeframe
  const timeframeChange = getTimeframeChange(stock, timeframe);
  const changeAbs = Math.abs(timeframeChange);
  
  // Build technical signals based on the timeframe
  if (volumeRatio > 2) technicalSignals.push('Unusual Volume (2x+ avg)');
  else if (volumeRatio > 1.5) technicalSignals.push('Above Avg Volume');
  
  if (distanceFrom52High !== undefined && distanceFrom52High < 5) {
    technicalSignals.push('Near 52-Week High');
  } else if (distanceFrom52High !== undefined && distanceFrom52High < 15) {
    technicalSignals.push('Within 15% of 52-Week High');
  }
  
  if (distanceFrom52Low !== undefined && distanceFrom52Low < 20) {
    technicalSignals.push('Potential Bounce Zone');
  }
  
  // Add timeframe-appropriate momentum signals
  if (timeframe === 'day') {
    if (changeAbs > 10) technicalSignals.push('Strong Intraday Move');
    else if (changeAbs > 5) technicalSignals.push('Notable Daily Move');
  } else if (timeframe === 'week') {
    if (changeAbs > 15) technicalSignals.push('Strong Weekly Momentum');
    else if (changeAbs > 8) technicalSignals.push('Solid Weekly Gains');
  } else if (timeframe === 'month') {
    if (changeAbs > 25) technicalSignals.push('Exceptional Monthly Run');
    else if (changeAbs > 15) technicalSignals.push('Strong Monthly Trend');
  } else if (timeframe === 'ytd' || timeframe === 'year') {
    if (changeAbs > 100) technicalSignals.push('Multi-Bagger');
    else if (changeAbs > 50) technicalSignals.push('Strong Annual Performer');
    else if (changeAbs > 25) technicalSignals.push('Outperforming Market');
  }
  
  if (stock.peRatio && stock.peRatio < 15) technicalSignals.push('Value Play (Low P/E)');
  if (stock.marketCap && stock.marketCap < 2e9) technicalSignals.push('Small Cap (Higher Vol)');
  if (stock.marketCap && stock.marketCap >= 100e9) technicalSignals.push('Large Cap (Stable)');
  
  // Determine risk level based on timeframe-appropriate thresholds
  let riskLevel: 'low' | 'medium' | 'high' | 'speculative' = 'medium';
  if (stock.currentPrice < 5) riskLevel = 'speculative';
  else if (stock.marketCap && stock.marketCap < 1e9) riskLevel = 'high';
  else if (stock.marketCap && stock.marketCap >= 50e9) riskLevel = 'low';
  else if (timeframe === 'day' && changeAbs > 15) riskLevel = 'high';
  else if (timeframe === 'week' && changeAbs > 25) riskLevel = 'high';
  else if ((timeframe === 'month' || timeframe === 'ytd' || timeframe === 'year') && changeAbs > 50) riskLevel = 'high';
  
  // Build thesis based on timeframe and direction
  let thesis = '';
  let entryReason = '';
  let suggestedAction = '';
  
  if (isGainer) {
    switch (timeframe) {
      case 'day':
        thesis = `${stock.symbol} showing strong intraday momentum with ${stock.dayChangePercent.toFixed(1)}% gain.`;
        entryReason = volumeRatio > 1.5 
          ? 'High volume confirms buyer interest - momentum likely to continue.' 
          : 'Price action strong but watch for volume confirmation.';
        suggestedAction = 'Consider day trade or swing entry on pullback to VWAP.';
        break;
      case 'week':
        thesis = `${stock.symbol} outperforming over the week with ${(stock.weekChangePercent || 0).toFixed(1)}% gain.`;
        entryReason = 'Weekly momentum suggests institutional accumulation phase.';
        suggestedAction = 'Look for entry near weekly support or on consolidation break.';
        break;
      case 'month':
        thesis = `${stock.symbol} showing monthly strength with ${(stock.monthChangePercent || 0).toFixed(1)}% gain.`;
        entryReason = 'Sustained monthly gains indicate trend development.';
        suggestedAction = 'Swing trade opportunity - consider position sizing for multi-week hold.';
        break;
      case 'ytd':
        thesis = `${stock.symbol} is a YTD leader with ${(stock.ytdChangePercent || 0).toFixed(1)}% return.`;
        entryReason = 'Strong YTD performance suggests leadership position in sector.';
        suggestedAction = 'Position trade candidate - buy dips in established uptrend.';
        break;
      case 'year':
        thesis = `${stock.symbol} up ${(stock.yearChangePercent || 0).toFixed(1)}% over 52 weeks - strong long-term trend.`;
        entryReason = 'Year-long momentum indicates fundamental strength.';
        suggestedAction = 'Long-term accumulation opportunity on significant pullbacks.';
        break;
    }
  } else {
    // For losers - potential bounce plays or shorts
    switch (timeframe) {
      case 'day':
        thesis = `${stock.symbol} down ${Math.abs(stock.dayChangePercent).toFixed(1)}% - potential oversold bounce.`;
        entryReason = volumeRatio > 2 
          ? 'Heavy selling may indicate capitulation - watch for reversal.' 
          : 'Selling pressure present but not extreme yet.';
        suggestedAction = 'Wait for price to stabilize and show reversal candle before entry.';
        break;
      case 'week':
        thesis = `${stock.symbol} weak weekly performance - down ${Math.abs(stock.weekChangePercent || 0).toFixed(1)}%.`;
        entryReason = 'Weekly weakness may present mean reversion opportunity.';
        suggestedAction = 'Watch for weekly support levels and RSI oversold conditions.';
        break;
      default:
        thesis = `${stock.symbol} showing extended weakness - potential value opportunity.`;
        entryReason = 'Extended selling may be creating entry point for contrarian trade.';
        suggestedAction = 'Research fundamentals before catching falling knife.';
    }
  }
  
  return {
    thesis,
    entryReason,
    riskLevel,
    suggestedAction,
    technicalSignals: technicalSignals.slice(0, 4),
  };
}

// Score stocks for watchlist ranking (higher = better pick)
function scoreStock(stock: StockPerformance, timeframe: string, isGainer: boolean): number {
  let score = 50; // Base score
  
  const volumeRatio = stock.avgVolume ? stock.volume / stock.avgVolume : 1;
  const changePercent = Math.abs(getTimeframeChange(stock, timeframe));
  
  // Volume boost (max +20)
  if (volumeRatio > 3) score += 20;
  else if (volumeRatio > 2) score += 15;
  else if (volumeRatio > 1.5) score += 10;
  else if (volumeRatio > 1) score += 5;
  
  // Change percent boost with timeframe-appropriate thresholds (max +20)
  if (timeframe === 'day') {
    if (changePercent > 15) score += 20;
    else if (changePercent > 8) score += 15;
    else if (changePercent > 4) score += 10;
    else if (changePercent > 2) score += 5;
  } else if (timeframe === 'week') {
    if (changePercent > 20) score += 20;
    else if (changePercent > 12) score += 15;
    else if (changePercent > 6) score += 10;
    else if (changePercent > 3) score += 5;
  } else if (timeframe === 'month') {
    if (changePercent > 35) score += 20;
    else if (changePercent > 20) score += 15;
    else if (changePercent > 10) score += 10;
    else if (changePercent > 5) score += 5;
  } else { // ytd, year
    if (changePercent > 80) score += 20;
    else if (changePercent > 50) score += 15;
    else if (changePercent > 25) score += 10;
    else if (changePercent > 10) score += 5;
  }
  
  // Market cap stability (prefer tradeable, liquid stocks)
  if (stock.marketCap) {
    if (stock.marketCap >= 10e9) score += 10; // Large cap bonus
    else if (stock.marketCap >= 1e9) score += 5; // Mid cap
    else if (stock.marketCap < 500e6) score -= 5; // Micro cap penalty
  }
  
  // Near 52-week high bonus for gainers
  if (isGainer && stock.week52High && stock.currentPrice) {
    const distanceFromHigh = ((stock.week52High - stock.currentPrice) / stock.week52High) * 100;
    if (distanceFromHigh < 5) score += 15; // Breaking out
    else if (distanceFromHigh < 10) score += 10;
  }
  
  // Avoid penny stocks for main watchlist (unless specifically in penny category)
  if (stock.currentPrice < 1) score -= 20;
  else if (stock.currentPrice < 5) score -= 10;
  
  return Math.max(0, Math.min(100, score));
}

// Generate curated smart watchlist for a given timeframe
export async function generateSmartWatchlist(
  timeframe: 'day' | 'week' | 'month' | 'ytd' | 'year' = 'day',
  limit: number = 15
): Promise<SmartWatchlistPick[]> {
  const cacheKey = `smart_${timeframe}_${limit}`;

  const cached = watchlistCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < WATCHLIST_CACHE_TTL) {
    logger.debug(`[SCANNER] Using cached smart watchlist for ${timeframe}`);
    return cached.data;
  }

  // Acquire scan slot to prevent memory overload
  await acquireScanSlot(`generateSmartWatchlist(${timeframe})`);

  try {
    logger.info(`[SCANNER] Generating smart watchlist for ${timeframe}...`);

    // Get top movers - reduced limit to lower memory usage
    const { gainers, losers } = await getTopMovers(timeframe, 'all', 30);

    // Combine and score all candidates
    const candidates: SmartWatchlistPick[] = [];
  
  // Process gainers (long opportunities)
  for (const stock of gainers) {
    const score = scoreStock(stock, timeframe, true);
    const volumeRatio = stock.avgVolume ? stock.volume / stock.avgVolume : 1;
    const tradeIdea = generateTradeIdea(stock, timeframe, true);
    
    const changePercent = (() => {
      switch (timeframe) {
        case 'week': return stock.weekChangePercent || 0;
        case 'month': return stock.monthChangePercent || 0;
        case 'ytd': return stock.ytdChangePercent || 0;
        case 'year': return stock.yearChangePercent || 0;
        default: return stock.dayChangePercent;
      }
    })();
    
    candidates.push({
      symbol: stock.symbol,
      name: stock.name,
      currentPrice: stock.currentPrice,
      changePercent,
      timeframe,
      direction: 'long',
      volume: stock.volume,
      avgVolume: stock.avgVolume,
      volumeRatio,
      marketCap: stock.marketCap,
      week52High: stock.week52High,
      week52Low: stock.week52Low,
      distanceFrom52High: stock.week52High ? ((stock.week52High - stock.currentPrice) / stock.week52High) * 100 : undefined,
      distanceFrom52Low: stock.week52Low ? ((stock.currentPrice - stock.week52Low) / stock.week52Low) * 100 : undefined,
      tradeIdea,
      score,
    });
  }
  
  // Process top losers (potential bounce/short opportunities) - limit to top 5
  for (const stock of losers.slice(0, 5)) {
    const score = scoreStock(stock, timeframe, false);
    const volumeRatio = stock.avgVolume ? stock.volume / stock.avgVolume : 1;
    const tradeIdea = generateTradeIdea(stock, timeframe, false);
    
    const changePercent = (() => {
      switch (timeframe) {
        case 'week': return stock.weekChangePercent || 0;
        case 'month': return stock.monthChangePercent || 0;
        case 'ytd': return stock.ytdChangePercent || 0;
        case 'year': return stock.yearChangePercent || 0;
        default: return stock.dayChangePercent;
      }
    })();
    
    // Add bounce play candidates with lower scores
    candidates.push({
      symbol: stock.symbol,
      name: stock.name,
      currentPrice: stock.currentPrice,
      changePercent,
      timeframe,
      direction: 'long', // Bounce play
      volume: stock.volume,
      avgVolume: stock.avgVolume,
      volumeRatio,
      marketCap: stock.marketCap,
      week52High: stock.week52High,
      week52Low: stock.week52Low,
      distanceFrom52High: stock.week52High ? ((stock.week52High - stock.currentPrice) / stock.week52High) * 100 : undefined,
      distanceFrom52Low: stock.week52Low ? ((stock.currentPrice - stock.week52Low) / stock.week52Low) * 100 : undefined,
      tradeIdea,
      score: score - 10, // Slightly lower score for contrarian plays
    });
  }
  
  // Sort by score and take top picks
  const sortedPicks = candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  
  // Record attention events for top picks (high-scoring only)
  for (const pick of sortedPicks.filter(p => p.score >= 70)) {
    recordSymbolAttention(
      pick.symbol,
      'market_scanner',
      'scan',
      { 
        confidence: pick.score,
        direction: pick.direction === 'long' ? 'bullish' : 'bearish',
        changePercent: pick.changePercent,
        message: `${timeframe} scan: ${pick.volumeRatio.toFixed(1)}x volume`
      }
    );
  }
  
    watchlistCache.set(cacheKey, { data: sortedPicks, timestamp: Date.now() });
    logger.info(`[SCANNER] Generated ${sortedPicks.length} smart watchlist picks for ${timeframe}`);

    return sortedPicks;
  } finally {
    releaseScanSlot(`generateSmartWatchlist(${timeframe})`);
  }
}

/**
 * Ingest top movers from Market Scanner into Trade Desk
 * This creates trade ideas for high-quality movers with strong setups
 */
export async function ingestMoversToTradeDesk(
  timeframe: 'day' | 'week' = 'day',
  minChangePercent: number = 4,
  minVolumeRatio: number = 1.5
): Promise<{ ingested: number; skipped: number }> {
  const { ingestTradeIdea, createScannerSignals } = await import('./trade-idea-ingestion');
  
  const movers = await getTopMovers(timeframe, 'all', 30);
  let ingested = 0;
  let skipped = 0;
  
  const holdingPeriod = timeframe === 'day' ? 'day' : 'swing';
  
  // Process gainers (bullish setups)
  for (const stock of movers.gainers) {
    const changePercent = timeframe === 'day' ? stock.dayChangePercent : (stock.weekChangePercent || 0);
    const volumeRatio = stock.avgVolume ? stock.volume / stock.avgVolume : 1;
    
    // Quality filter: minimum move + volume
    if (Math.abs(changePercent) < minChangePercent || volumeRatio < minVolumeRatio) {
      skipped++;
      continue;
    }
    
    // Skip penny stocks under $2
    if (stock.currentPrice < 2) {
      skipped++;
      continue;
    }
    
    const signals = createScannerSignals({
      changePercent,
      relativeVolume: volumeRatio,
      nearHigh: stock.week52High ? stock.currentPrice >= stock.week52High * 0.95 : false,
      breakout: changePercent > 6 && volumeRatio > 2,
    });
    
    // Need at least 2 signals
    if (signals.length < 2) {
      skipped++;
      continue;
    }
    
    const result = await ingestTradeIdea({
      source: 'market_scanner',
      symbol: stock.symbol,
      assetType: 'stock',
      direction: 'bullish',
      signals,
      holdingPeriod,
      currentPrice: stock.currentPrice,
      catalyst: `${timeframe === 'day' ? 'Day' : 'Week'} mover: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}% with ${volumeRatio.toFixed(1)}x volume`,
      analysis: `${stock.name} is showing strong ${timeframe} momentum with elevated volume. ${stock.week52High && stock.currentPrice >= stock.week52High * 0.95 ? 'Trading near 52-week highs.' : ''}`,
    });
    
    if (result.success) {
      ingested++;
      logger.info(`[SCANNER->TRADE-DESK] ✅ Ingested ${stock.symbol}: ${changePercent.toFixed(1)}% (${holdingPeriod})`);
    } else {
      skipped++;
    }
  }
  
  // Process losers (potential bounce plays - bearish then reversal)
  for (const stock of movers.losers.slice(0, 10)) {
    const changePercent = timeframe === 'day' ? stock.dayChangePercent : (stock.weekChangePercent || 0);
    const volumeRatio = stock.avgVolume ? stock.volume / stock.avgVolume : 1;
    
    // For losers, look for oversold bounces - bigger drops with volume
    if (changePercent > -5 || volumeRatio < 1.5) {
      skipped++;
      continue;
    }
    
    if (stock.currentPrice < 5) {
      skipped++;
      continue;
    }
    
    const signals = createScannerSignals({
      changePercent: Math.abs(changePercent), // Use absolute for signal strength
      relativeVolume: volumeRatio,
      rsi: 25, // Assume oversold on big drops
    });
    
    if (signals.length < 2) {
      skipped++;
      continue;
    }
    
    const result = await ingestTradeIdea({
      source: 'market_scanner',
      symbol: stock.symbol,
      assetType: 'stock',
      direction: 'bullish', // Bounce play - looking for reversal
      signals,
      holdingPeriod: 'swing', // Bounce plays need time
      currentPrice: stock.currentPrice,
      catalyst: `Oversold bounce candidate: ${changePercent.toFixed(1)}% drop with ${volumeRatio.toFixed(1)}x volume`,
      analysis: `${stock.name} is oversold after a significant drop. Watching for reversal confirmation.`,
    });
    
    if (result.success) {
      ingested++;
      logger.info(`[SCANNER->TRADE-DESK] ✅ Ingested bounce play ${stock.symbol}: ${changePercent.toFixed(1)}%`);
    } else {
      skipped++;
    }
  }
  
  logger.info(`[SCANNER->TRADE-DESK] Complete: ${ingested} ingested, ${skipped} skipped`);
  return { ingested, skipped };
}
