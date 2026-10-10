import { logger } from "./logger";
import { addDays, parseISO, isAfter, isBefore } from "date-fns";

/**
 * Earnings Calendar Service
 * 
 * Fetches upcoming earnings dates from Alpha Vantage and caches them for 24 hours.
 * Used to block trade generation 2 days before earnings (unless it's a news catalyst).
 */

interface EarningsEvent {
  symbol: string;
  reportDate: string; // YYYY-MM-DD format
  fiscalDateEnding: string;
  estimate: string | null;
}

interface EarningsCache {
  data: EarningsEvent[];
  timestamp: number;
}

const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const ALPHA_VANTAGE_API = "https://www.alphavantage.co/query";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let earningsCache: EarningsCache | null = null;

/**
 * Fetch earnings calendar from Alpha Vantage
 * Returns next 3 months of earnings announcements
 */
async function fetchEarningsCalendar(): Promise<EarningsEvent[]> {
  if (!ALPHA_VANTAGE_API_KEY) {
    logger.warn('⚠️ ALPHA_VANTAGE_API_KEY not set - earnings calendar disabled');
    return [];
  }

  try {
    const url = `${ALPHA_VANTAGE_API}?function=EARNINGS_CALENDAR&horizon=3month&apikey=${ALPHA_VANTAGE_API_KEY}`;
    
    logger.info('📊 Fetching earnings calendar from Alpha Vantage...');
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Alpha Vantage API error: HTTP ${response.status}`);
    }

    const csvData = await response.text();
    
    // Parse CSV (Alpha Vantage returns CSV format)
    // Format: symbol,name,reportDate,fiscalDateEnding,estimate,currency
    const lines = csvData.trim().split('\n');
    const headers = lines[0].split(',');
    
    const events: EarningsEvent[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      
      if (values.length < 6) continue; // Skip malformed rows
      
      events.push({
        symbol: values[0].trim(),
        reportDate: values[2].trim(), // YYYY-MM-DD
        fiscalDateEnding: values[3].trim(),
        estimate: values[4].trim() || null,
      });
    }

    logger.info(`✅ Fetched ${events.length} upcoming earnings events`);
    return events;
    
  } catch (error) {
    logger.error('❌ Failed to fetch earnings calendar:', error);
    return [];
  }
}

/**
 * Get cached earnings data or fetch fresh if cache expired
 */
async function getEarningsData(): Promise<EarningsEvent[]> {
  const now = Date.now();
  
  // Check cache validity
  if (earningsCache && (now - earningsCache.timestamp) < CACHE_TTL_MS) {
    logger.info(`📋 Using cached earnings data (age: ${Math.round((now - earningsCache.timestamp) / 1000 / 60)} minutes)`);
    return earningsCache.data;
  }

  // Fetch fresh data
  const freshData = await fetchEarningsCalendar();
  
  earningsCache = {
    data: freshData,
    timestamp: now,
  };

  return freshData;
}

/**
 * Check if a symbol has earnings within the next 2 days
 * 
 * @param symbol - Stock symbol to check
 * @returns true if earnings are within 2 days, false otherwise
 */
/**
 * Per-symbol earnings date from Yahoo, cached.
 *
 * The bulk Alpha Vantage calendar is the primary source, but that key is capped
 * at 25 calls/day and once it is spent the endpoint returns a rate-limit notice
 * that parses into a single junk row. The calendar then reports ~0 events and
 * every earnings check silently answers "no earnings" — which is how a name with
 * a print two days out looked clean. Yahoo answers per symbol and is not capped.
 */
const symbolEarningsCache = new Map<string, { date: Date | null; fetchedAt: number }>();
const SYMBOL_EARNINGS_TTL_MS = 6 * 60 * 60 * 1000;

export async function getEarningsDate(symbol: string): Promise<Date | null> {
  const key = symbol.toUpperCase();
  const cached = symbolEarningsCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < SYMBOL_EARNINGS_TTL_MS) return cached.date;

  let date: Date | null = null;
  try {
    const { safeQuoteSummary } = await import('./yahoo-finance-service');
    const data = await safeQuoteSummary(key, ['calendarEvents']);
    const raw = data?.calendarEvents?.earnings?.earningsDate?.[0];
    // yahoo-finance2 returns a Date; the raw v10 path returns { raw: <epoch> }.
    const parsed =
      raw instanceof Date ? raw
      : typeof raw === 'number' ? new Date(raw * 1000)
      : typeof raw?.raw === 'number' ? new Date(raw.raw * 1000)
      : null;
    if (parsed && !Number.isNaN(parsed.getTime())) date = parsed;
  } catch (error) {
    logger.debug(`[EARNINGS] Yahoo lookup failed for ${symbol}`);
  }

  symbolEarningsCache.set(key, { date, fetchedAt: Date.now() });
  return date;
}

export async function hasUpcomingEarnings(symbol: string): Promise<boolean> {
  const earningsData = await getEarningsData();
  const now = new Date();
  // 🛡️ Extended from 2 to 3 days to avoid IV crush risk before earnings
  const threeDaysFromNow = addDays(now, 3);

  const symbolUpper = symbol.toUpperCase();

  for (const event of earningsData) {
    if (event.symbol.toUpperCase() === symbolUpper) {
      try {
        const reportDate = parseISO(event.reportDate);

        // Check if earnings are within next 3 days (was 2 days - too risky)
        if (isAfter(reportDate, now) && isBefore(reportDate, threeDaysFromNow)) {
          logger.info(`📅 EARNINGS ALERT: ${symbol} has earnings on ${event.reportDate} (within 3 days - IV crush risk)`);
          return true;
        }
      } catch (error) {
        logger.warn(`⚠️ Invalid earnings date for ${symbol}: ${event.reportDate}`);
      }
    }
  }

  // Calendar had nothing for this symbol — confirm against Yahoo before calling it
  // clean, because "not in the calendar" and "no earnings" are not the same thing.
  const yahooDate = await getEarningsDate(symbolUpper);
  if (yahooDate && isAfter(yahooDate, now) && isBefore(yahooDate, threeDaysFromNow)) {
    logger.info(`📅 EARNINGS ALERT: ${symbol} has earnings on ${yahooDate.toISOString().slice(0, 10)} (Yahoo, within 3 days - IV crush risk)`);
    return true;
  }

  return false;
}

/**
 * Check if a symbol should be blocked from trade generation
 * 
 * Symbols are blocked if:
 * - Earnings are within 2 days AND
 * - It's NOT a news catalyst trade
 * 
 * @param symbol - Stock symbol to check
 * @param isNewsCatalyst - Whether this is a news-driven trade
 * @returns true if symbol should be blocked, false if it's safe to trade
 */
export async function shouldBlockSymbol(
  symbol: string,
  isNewsCatalyst: boolean = false
): Promise<boolean> {
  // News catalyst trades are exempt from earnings blocks
  if (isNewsCatalyst) {
    logger.info(`📰 ${symbol} is a news catalyst trade - earnings block EXEMPTED`);
    return false;
  }

  // Check for upcoming earnings
  const hasEarnings = await hasUpcomingEarnings(symbol);
  
  if (hasEarnings) {
    logger.warn(`🚫 BLOCKED: ${symbol} has earnings within 2 days (not a news catalyst)`);
    return true;
  }

  return false;
}

/**
 * Get earnings calendar status for monitoring
 */
export function getEarningsServiceStatus() {
  if (!earningsCache) {
    return {
      status: 'not_initialized',
      cacheAge: 0,
      eventsCount: 0,
    };
  }

  const cacheAgeMinutes = Math.round((Date.now() - earningsCache.timestamp) / 1000 / 60);
  const isCacheValid = (Date.now() - earningsCache.timestamp) < CACHE_TTL_MS;

  return {
    status: isCacheValid ? 'active' : 'stale',
    cacheAge: cacheAgeMinutes,
    eventsCount: earningsCache.data.length,
  };
}

/**
 * Force refresh earnings cache (for testing/admin)
 */
export async function refreshEarningsCache(): Promise<void> {
  logger.info('🔄 Forcing earnings cache refresh...');
  earningsCache = null;
  await getEarningsData();
  logger.info('✅ Earnings cache refreshed');
}

/**
 * Get upcoming earnings for the next 7 days
 * Used for displaying earnings calendar on home page
 */
export async function getUpcomingEarnings(days: number = 7): Promise<EarningsEvent[]> {
  const earningsData = await getEarningsData();
  const now = new Date();
  const futureDate = addDays(now, days);

  const upcoming = earningsData.filter((event) => {
    try {
      const reportDate = parseISO(event.reportDate);
      return isAfter(reportDate, now) && isBefore(reportDate, futureDate);
    } catch {
      return false;
    }
  });

  upcoming.sort((a, b) => {
    return parseISO(a.reportDate).getTime() - parseISO(b.reportDate).getTime();
  });

  return upcoming;
}
