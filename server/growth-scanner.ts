/**
 * Small Cap Growth Scanner
 * Finds stocks with:
 * - 100%+ yearly revenue growth
 * - Near their 50-day SMA (within 5%)
 * - Small cap focus ($50M - $10B market cap)
 */

import { logger } from './logger';
import { fetchFundamentalData, FundamentalData, fetchHistoricalPrices } from './market-api';

export interface GrowthCandidate {
  symbol: string;
  price: number;
  sma50: number;
  distanceFromSMA50: number; // % distance from 50 SMA
  revenueGrowth: number; // YoY revenue growth %
  earningsGrowth: number | null;
  marketCap: number;
  marketCapLabel: string; // 'small', 'mid', 'micro'
  score: number; // 0-100 composite score
  signals: string[];
}

// Small cap universe - high growth potential stocks
const SMALL_CAP_UNIVERSE = [
  // Tech/AI
  'BBAI', 'SOUN', 'AI', 'PLTR', 'PATH', 'BIGC', 'DOCN', 'IONQ', 'RGTI', 'QUBT',
  // EV/Clean Energy
  'LCID', 'RIVN', 'FCEL', 'PLUG', 'CHPT', 'BE', 'ENVX', 'QS', 'SEDG', 'ENPH',
  // Biotech
  'NVAX', 'MRNA', 'CRSP', 'BEAM', 'EDIT', 'NTLA', 'VERV', 'EXAI', 'RXRX', 'DNA',
  // Space/Defense
  'RKLB', 'ASTS', 'LUNR', 'RDW', 'SPCE', 'BKSY', 'PL', 'IRDM',
  // Fintech
  'SOFI', 'HOOD', 'UPST', 'AFRM', 'NU', 'COIN', 'MARA', 'RIOT', 'CLSK', 'HUT',
  // Consumer/Software
  'SHOP', 'TTD', 'DDOG', 'NET', 'SNOW', 'CRWD', 'ZS', 'BILL', 'OKTA',
  // Nuclear/Uranium
  'SMR', 'OKLO', 'NNE', 'UEC', 'CCJ', 'DNN', 'UUUU', 'LEU',
  // Speculative/Momentum
  'GME', 'AMC', 'BBBY', 'CLOV', 'WISH', 'OPEN', 'GRAB', 'GEVO', 'NKLA', 'GOEV',
];

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

/**
 * Classify market cap
 */
function classifyMarketCap(marketCap: number): { label: string; isSmallCap: boolean } {
  if (marketCap < 50_000_000) return { label: 'nano', isSmallCap: false }; // Too small
  if (marketCap < 300_000_000) return { label: 'micro', isSmallCap: true };
  if (marketCap < 2_000_000_000) return { label: 'small', isSmallCap: true };
  if (marketCap < 10_000_000_000) return { label: 'mid', isSmallCap: true };
  return { label: 'large', isSmallCap: false }; // Too large
}

/**
 * Score a growth candidate (0-100)
 */
function scoreCandidate(
  revenueGrowth: number,
  earningsGrowth: number | null,
  distanceFromSMA50: number,
  marketCap: number
): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];

  // Revenue growth scoring (max 40 points)
  if (revenueGrowth >= 200) {
    score += 40;
    signals.push('EXCEPTIONAL_REVENUE_GROWTH_200PCT');
  } else if (revenueGrowth >= 150) {
    score += 35;
    signals.push('STRONG_REVENUE_GROWTH_150PCT');
  } else if (revenueGrowth >= 100) {
    score += 30;
    signals.push('HIGH_REVENUE_GROWTH_100PCT');
  } else if (revenueGrowth >= 50) {
    score += 20;
    signals.push('SOLID_REVENUE_GROWTH_50PCT');
  }

  // Distance from 50 SMA (max 30 points)
  const absDistance = Math.abs(distanceFromSMA50);
  if (absDistance <= 2) {
    score += 30;
    signals.push('SMA50_SUPPORT_ZONE');
  } else if (absDistance <= 5) {
    score += 25;
    signals.push('NEAR_SMA50_5PCT');
  } else if (absDistance <= 10) {
    score += 15;
    signals.push('CLOSE_TO_SMA50_10PCT');
  }

  // Bonus for being ABOVE 50 SMA (bullish)
  if (distanceFromSMA50 > 0 && distanceFromSMA50 <= 5) {
    score += 5;
    signals.push('ABOVE_SMA50_BULLISH');
  }

  // Earnings growth bonus (max 15 points)
  if (earningsGrowth !== null) {
    if (earningsGrowth >= 100) {
      score += 15;
      signals.push('EXCEPTIONAL_EARNINGS_GROWTH');
    } else if (earningsGrowth >= 50) {
      score += 10;
      signals.push('STRONG_EARNINGS_GROWTH');
    } else if (earningsGrowth > 0) {
      score += 5;
      signals.push('POSITIVE_EARNINGS_GROWTH');
    }
  }

  // Small cap bonus (max 15 points)
  const { label } = classifyMarketCap(marketCap);
  if (label === 'micro') {
    score += 15;
    signals.push('MICRO_CAP_HIGH_UPSIDE');
  } else if (label === 'small') {
    score += 12;
    signals.push('SMALL_CAP');
  } else if (label === 'mid') {
    score += 8;
    signals.push('MID_CAP');
  }

  return { score: Math.min(score, 100), signals };
}

/**
 * Scan for high-growth small cap stocks near 50 SMA
 * @param minRevenueGrowth Minimum YoY revenue growth % (default 100)
 * @param maxDistanceFromSMA Max % distance from 50 SMA (default 10)
 * @param limit Max candidates to return (default 10)
 */
export async function scanGrowthStocks(
  minRevenueGrowth: number = 100,
  maxDistanceFromSMA: number = 10,
  limit: number = 10
): Promise<GrowthCandidate[]> {
  logger.info(`[GROWTH-SCANNER] Scanning ${SMALL_CAP_UNIVERSE.length} stocks for ${minRevenueGrowth}%+ revenue growth near 50 SMA...`);

  const candidates: GrowthCandidate[] = [];
  const errors: string[] = [];
  let scanned = 0;
  let passedFundamentals = 0;
  let passedTechnical = 0;

  for (const symbol of SMALL_CAP_UNIVERSE) {
    try {
      scanned++;

      // Fetch fundamentals
      const fundamentals = await fetchFundamentalData(symbol);
      if (!fundamentals) {
        continue;
      }

      // Check revenue growth threshold
      const revenueGrowth = fundamentals.revenueGrowth;
      if (revenueGrowth === null || revenueGrowth < minRevenueGrowth) {
        continue;
      }
      passedFundamentals++;

      // Check market cap (small cap focus)
      const marketCap = fundamentals.marketCap;
      if (marketCap === null || marketCap === undefined) {
        logger.debug(`[GROWTH-SCANNER] ${symbol}: Skipped - no market cap data available`);
        continue;
      }
      const { isSmallCap, label: marketCapLabel } = classifyMarketCap(marketCap);
      if (!isSmallCap) {
        continue;
      }

      // Fetch historical prices for 50 SMA
      const historicalPrices = await fetchHistoricalPrices(symbol, 60);
      if (!historicalPrices || historicalPrices.length < 50) {
        continue;
      }

      const closes = historicalPrices.map((d: { close: number }) => d.close);
      const currentPrice = closes[closes.length - 1];
      const sma50 = calculateSMA(closes, 50);

      // Calculate distance from 50 SMA
      const distanceFromSMA50 = ((currentPrice - sma50) / sma50) * 100;

      // Check if near 50 SMA
      if (Math.abs(distanceFromSMA50) > maxDistanceFromSMA) {
        continue;
      }
      passedTechnical++;

      // Score the candidate
      const { score, signals } = scoreCandidate(
        revenueGrowth,
        fundamentals.earningsGrowth,
        distanceFromSMA50,
        marketCap
      );

      candidates.push({
        symbol,
        price: currentPrice,
        sma50,
        distanceFromSMA50: parseFloat(distanceFromSMA50.toFixed(2)),
        revenueGrowth,
        earningsGrowth: fundamentals.earningsGrowth,
        marketCap,
        marketCapLabel,
        score,
        signals,
      });

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error: any) {
      errors.push(symbol);
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  logger.info(`[GROWTH-SCANNER] Results: ${scanned} scanned, ${passedFundamentals} passed growth filter, ${passedTechnical} near 50 SMA`);
  logger.info(`[GROWTH-SCANNER] Found ${candidates.length} growth candidates:`);
  
  for (const c of candidates.slice(0, limit)) {
    logger.info(`[GROWTH-SCANNER] ${c.symbol}: ${c.revenueGrowth.toFixed(0)}% rev growth, ${c.distanceFromSMA50.toFixed(1)}% from 50SMA, score=${c.score}`);
  }

  return candidates.slice(0, limit);
}

/**
 * Get cached growth scan results (for API endpoint)
 */
let lastGrowthScan: { results: GrowthCandidate[]; timestamp: number } | null = null;
const GROWTH_SCAN_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function getGrowthCandidates(
  forceRefresh: boolean = false
): Promise<GrowthCandidate[]> {
  if (!forceRefresh && lastGrowthScan && Date.now() - lastGrowthScan.timestamp < GROWTH_SCAN_CACHE_TTL) {
    return lastGrowthScan.results;
  }

  const results = await scanGrowthStocks(100, 10, 15);
  lastGrowthScan = { results, timestamp: Date.now() };
  return results;
}
