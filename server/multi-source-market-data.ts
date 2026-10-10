/**
 * MULTI-SOURCE MARKET DATA SERVICE
 *
 * Smart market data system that:
 * 1. Tries free APIs first (Finnhub, Twelve Data, Yahoo)
 * 2. Falls back to paid APIs (Tradier, Alpha Vantage)
 * 3. Caches data to reduce API calls
 * 4. Handles rate limits gracefully
 */

import { logger } from './logger';

// API Priority Order (free first!)
const API_PRIORITY = {
  REALTIME: ['finnhub', 'twelvedata', 'tradier', 'alphavantage'],
  HISTORICAL: ['yahoofinance', 'alphavantage', 'twelvedata', 'tradier'],
  OPTIONS: ['tradier', 'polygon'], // Options need paid APIs
  CRYPTO: ['coingecko', 'finnhub'], // CoinGecko is FREE!
};

interface PriceData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  timestamp: number;
  source: string;
}

interface HistoricalData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

class MultiSourceMarketData {
  private cache: Map<string, { data: any; expires: number }> = new Map();
  private rateLimits: Map<string, { count: number; resetAt: number }> = new Map();

  // 5-minute cache for price data
  private CACHE_TTL = 5 * 60 * 1000;

  /**
   * Get real-time stock quote with fallback
   */
  async getQuote(symbol: string): Promise<PriceData | null> {
    const cacheKey = `quote:${symbol}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    for (const source of API_PRIORITY.REALTIME) {
      try {
        if (this.isRateLimited(source)) continue;

        let data: PriceData | null = null;

        switch (source) {
          case 'finnhub':
            data = await this.fetchFinnhub(symbol);
            break;
          case 'twelvedata':
            data = await this.fetchTwelveData(symbol);
            break;
          case 'tradier':
            data = await this.fetchTradier(symbol);
            break;
          case 'alphavantage':
            data = await this.fetchAlphaVantage(symbol);
            break;
        }

        if (data) {
          this.setCache(cacheKey, data);
          logger.info(`✅ Got ${symbol} quote from ${source}: $${data.price}`);
          return data;
        }
      } catch (error: any) {
        logger.warn(`${source} failed for ${symbol}:`, error.message);
        this.recordRateLimit(source);
        continue;
      }
    }

    logger.error(`❌ All sources failed for ${symbol}`);
    return null;
  }

  /**
   * Finnhub (FREE - 60 calls/minute)
   */
  private async fetchFinnhub(symbol: string): Promise<PriceData | null> {
    const key = process.env.FINNHUB_API_KEY;
    if (!key) return null;

    const response = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${key}`
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (!data.c) return null;

    return {
      symbol,
      price: data.c, // current price
      change: data.d, // change
      changePercent: data.dp, // change percent
      timestamp: data.t * 1000,
      source: 'finnhub',
    };
  }

  /**
   * Twelve Data (FREE - 800 calls/day)
   */
  private async fetchTwelveData(symbol: string): Promise<PriceData | null> {
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) return null;

    const response = await fetch(
      `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${key}`
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (data.status === 'error') return null;

    return {
      symbol,
      price: parseFloat(data.price),
      change: 0,
      changePercent: 0,
      timestamp: Date.now(),
      source: 'twelvedata',
    };
  }

  /**
   * Tradier (PAID - $10/month)
   */
  private async fetchTradier(symbol: string): Promise<PriceData | null> {
    const key = process.env.TRADIER_API_KEY;
    if (!key) return null;

    const baseUrl = process.env.TRADIER_USE_SANDBOX === 'true'
      ? 'https://sandbox.tradier.com'
      : 'https://api.tradier.com';

    const response = await fetch(
      `${baseUrl}/v1/markets/quotes?symbols=${symbol}`,
      {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const quote = data?.quotes?.quote;

    if (!quote || !quote.last) return null;

    return {
      symbol,
      price: quote.last,
      change: quote.change || 0,
      changePercent: quote.change_percentage || 0,
      volume: quote.volume,
      timestamp: Date.now(),
      source: 'tradier',
    };
  }

  /**
   * Alpha Vantage (FREE - 500 calls/day)
   */
  private async fetchAlphaVantage(symbol: string): Promise<PriceData | null> {
    const key = process.env.ALPHA_VANTAGE_API_KEY;
    if (!key) return null;

    const response = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${key}`
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const quote = data['Global Quote'];

    if (!quote || !quote['05. price']) return null;

    return {
      symbol,
      price: parseFloat(quote['05. price']),
      change: parseFloat(quote['09. change']),
      changePercent: parseFloat(quote['10. change percent'].replace('%', '')),
      volume: parseInt(quote['06. volume']),
      timestamp: Date.now(),
      source: 'alphavantage',
    };
  }

  /**
   * Get historical data with fallback
   */
  async getHistorical(
    symbol: string,
    days: number = 30
  ): Promise<HistoricalData[]> {
    const cacheKey = `historical:${symbol}:${days}`;
    const cached = this.getCache(cacheKey);
    if (cached) return cached;

    for (const source of API_PRIORITY.HISTORICAL) {
      try {
        if (this.isRateLimited(source)) continue;

        let data: HistoricalData[] = [];

        switch (source) {
          case 'yahoofinance':
            data = await this.fetchYahooFinance(symbol, days);
            break;
          case 'alphavantage':
            data = await this.fetchAlphaVantageHistory(symbol);
            break;
          case 'twelvedata':
            data = await this.fetchTwelveDataHistory(symbol, days);
            break;
          case 'tradier':
            data = await this.fetchTradierHistory(symbol, days);
            break;
        }

        if (data.length > 0) {
          this.setCache(cacheKey, data, 60 * 60 * 1000); // Cache 1 hour
          logger.info(`✅ Got ${symbol} history (${data.length} days) from ${source}`);
          return data;
        }
      } catch (error: any) {
        logger.warn(`${source} history failed for ${symbol}:`, error.message);
        continue;
      }
    }

    logger.error(`❌ All sources failed for ${symbol} historical data`);
    return [];
  }

  /**
   * Yahoo Finance via yfinance library
   * COMPLETELY FREE - No API key needed!
   */
  private async fetchYahooFinance(
    symbol: string,
    days: number
  ): Promise<HistoricalData[]> {
    // Use yahoo-finance2 npm package or direct API
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const period1 = Math.floor(startDate.getTime() / 1000);
    const period2 = Math.floor(endDate.getTime() / 1000);

    const url = `https://query1.finance.yahoo.com/v7/finance/download/${symbol}?period1=${period1}&period2=${period2}&interval=1d&events=history`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const csv = await response.text();
    const lines = csv.split('\n').slice(1); // Skip header

    return lines
      .filter(line => line.trim())
      .map(line => {
        const [date, open, high, low, close, , volume] = line.split(',');
        return {
          date,
          open: parseFloat(open),
          high: parseFloat(high),
          low: parseFloat(low),
          close: parseFloat(close),
          volume: parseInt(volume),
        };
      });
  }

  /**
   * Alpha Vantage Historical (FREE)
   */
  private async fetchAlphaVantageHistory(symbol: string): Promise<HistoricalData[]> {
    const key = process.env.ALPHA_VANTAGE_API_KEY;
    if (!key) return [];

    const response = await fetch(
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${key}`
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const timeSeries = data['Time Series (Daily)'];

    if (!timeSeries) return [];

    return Object.entries(timeSeries).map(([date, values]: [string, any]) => ({
      date,
      open: parseFloat(values['1. open']),
      high: parseFloat(values['2. high']),
      low: parseFloat(values['3. low']),
      close: parseFloat(values['4. close']),
      volume: parseInt(values['5. volume']),
    }));
  }

  /**
   * Twelve Data Historical (FREE)
   */
  private async fetchTwelveDataHistory(symbol: string, days: number): Promise<HistoricalData[]> {
    const key = process.env.TWELVE_DATA_API_KEY;
    if (!key) return [];

    const response = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=${days}&apikey=${key}`
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (!data.values) return [];

    return data.values.map((v: any) => ({
      date: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseInt(v.volume),
    }));
  }

  /**
   * Tradier Historical (PAID)
   */
  private async fetchTradierHistory(symbol: string, days: number): Promise<HistoricalData[]> {
    const key = process.env.TRADIER_API_KEY;
    if (!key) return [];

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const start = startDate.toISOString().split('T')[0];

    const baseUrl = process.env.TRADIER_USE_SANDBOX === 'true'
      ? 'https://sandbox.tradier.com'
      : 'https://api.tradier.com';

    const response = await fetch(
      `${baseUrl}/v1/markets/history?symbol=${symbol}&start=${start}&end=${endDate}`,
      {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const history = data?.history?.day;

    if (!history) return [];

    return (Array.isArray(history) ? history : [history]).map((d: any) => ({
      date: d.date,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
  }

  // Cache helpers
  private getCache(key: string): any {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expires) {
      return cached.data;
    }
    return null;
  }

  private setCache(key: string, data: any, ttl: number = this.CACHE_TTL) {
    this.cache.set(key, {
      data,
      expires: Date.now() + ttl,
    });
  }

  // Rate limit helpers
  private isRateLimited(source: string): boolean {
    const limit = this.rateLimits.get(source);
    if (!limit) return false;
    return Date.now() < limit.resetAt;
  }

  private recordRateLimit(source: string) {
    this.rateLimits.set(source, {
      count: 1,
      resetAt: Date.now() + (60 * 1000), // 1 minute cooldown
    });
  }

  /**
   * Get status of all data sources
   */
  getSourceStatus() {
    return {
      finnhub: !!process.env.FINNHUB_API_KEY,
      twelvedata: !!process.env.TWELVE_DATA_API_KEY,
      tradier: !!process.env.TRADIER_API_KEY,
      alphavantage: !!process.env.ALPHA_VANTAGE_API_KEY,
      yahoofinance: true, // Always available (no key needed)
      coingecko: true, // Always available (no key needed)
    };
  }
}

// Singleton instance
export const marketData = new MultiSourceMarketData();

// Convenience functions
export async function getStockPrice(symbol: string): Promise<number | null> {
  const quote = await marketData.getQuote(symbol);
  return quote?.price || null;
}

export async function getStockHistory(symbol: string, days: number = 30): Promise<HistoricalData[]> {
  return await marketData.getHistorical(symbol, days);
}
