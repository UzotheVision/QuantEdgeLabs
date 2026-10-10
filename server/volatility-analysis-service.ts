/**
 * 🎯 VOLATILITY ANALYSIS SERVICE
 * 
 * Professional-grade volatility analysis for options trading decisions.
 * Implements IV Rank, IV Percentile, Realized Volatility, and IV vs RV comparison.
 * 
 * Core Principles (from Hedge Fund Framework):
 * - IV > RV → Sell premium (volatility is expensive)
 * - IV < RV → Buy convexity (volatility is cheap)
 * - IV Rank > 50% → Consider selling strategies
 * - IV Rank < 30% → Consider buying strategies
 */

import { logger } from "./logger";
import { getTradierQuote, getTradierOptionsChain } from "./tradier-api";
import { fetchOHLCData } from "./chart-analysis";

// Cache for IV history to avoid repeated API calls
interface IVHistoryCache {
  symbol: string;
  ivHistory: number[];
  lastUpdated: number;
  currentIV: number;
}

const ivHistoryCache = new Map<string, IVHistoryCache>();
const IV_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Calculate Realized Volatility (Historical Volatility)
 * Uses close-to-close returns over N days, annualized
 * 
 * @param prices Array of closing prices (oldest to newest)
 * @param period Number of days for calculation (default 20)
 * @returns Annualized realized volatility as percentage
 */
export function calculateRealizedVolatility(prices: number[], period: number = 20): number {
  if (prices.length < period + 1) {
    return 0;
  }

  // Calculate daily log returns
  const returns: number[] = [];
  const recentPrices = prices.slice(-period - 1);
  
  for (let i = 1; i < recentPrices.length; i++) {
    const logReturn = Math.log(recentPrices[i] / recentPrices[i - 1]);
    returns.push(logReturn);
  }

  // Calculate standard deviation of returns
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Annualize: multiply by sqrt(252) trading days
  const annualizedVol = stdDev * Math.sqrt(252) * 100;

  return annualizedVol;
}

/**
 * Calculate IV Rank
 * Where current IV sits in the 52-week range (0-100)
 * 
 * Formula: (Current IV - 52wk Low) / (52wk High - 52wk Low) * 100
 */
export function calculateIVRank(currentIV: number, ivHistory: number[]): number {
  if (ivHistory.length === 0) return 50; // Default to neutral

  const ivMin = Math.min(...ivHistory);
  const ivMax = Math.max(...ivHistory);
  
  if (ivMax === ivMin) return 50; // No range

  const rank = ((currentIV - ivMin) / (ivMax - ivMin)) * 100;
  return Math.max(0, Math.min(100, rank));
}

/**
 * Calculate IV Percentile
 * What percentage of days had lower IV than today
 * 
 * More robust than IV Rank for extreme values
 */
export function calculateIVPercentile(currentIV: number, ivHistory: number[]): number {
  if (ivHistory.length === 0) return 50;

  const daysBelow = ivHistory.filter(iv => iv < currentIV).length;
  return (daysBelow / ivHistory.length) * 100;
}

/**
 * Get current implied volatility from options chain
 * Uses ATM options to estimate current IV
 */
export async function getCurrentIV(symbol: string): Promise<number | null> {
  try {
    // Get stock quote for current price
    const quote = await getTradierQuote(symbol);
    if (!quote || !quote.last) return null;

    const stockPrice = quote.last;

    // Get options chain
    const chain = await getTradierOptionsChain(symbol);
    if (!chain || chain.length === 0) return null;

    // Find ATM options (closest to stock price)
    let atmIV = 0;
    let minDistance = Infinity;

    for (const option of chain) {
      const distance = Math.abs(option.strike - stockPrice);
      if (distance < minDistance && option.greeks?.mid_iv) {
        minDistance = distance;
        atmIV = option.greeks.mid_iv * 100; // Convert to percentage
      }
    }

    return atmIV > 0 ? atmIV : null;
  } catch (error) {
    logger.error(`[VOL-ANALYSIS] Failed to get current IV for ${symbol}:`, error);
    return null;
  }
}

/**
 * Volatility Analysis Result
 */
export interface VolatilityAnalysis {
  symbol: string;
  currentIV: number;          // Current implied volatility %
  realizedVol20: number;      // 20-day realized volatility %
  realizedVol10: number;      // 10-day realized volatility %
  ivRank: number;             // IV Rank (0-100)
  ivPercentile: number;       // IV Percentile (0-100)
  ivVsRv: 'expensive' | 'cheap' | 'fair'; // IV vs RV assessment
  ivRvRatio: number;          // IV / RV ratio
  recommendation: 'buy_premium' | 'sell_premium' | 'neutral';
  signals: string[];
  timestamp: Date;
}

/**
 * Full volatility analysis for a symbol
 * Combines IV Rank, IV Percentile, RV, and makes trading recommendations
 */
export async function analyzeVolatility(symbol: string): Promise<VolatilityAnalysis | null> {
  try {
    const signals: string[] = [];

    // Get current IV from options chain
    const currentIV = await getCurrentIV(symbol);
    if (!currentIV) {
      logger.warn(`[VOL-ANALYSIS] No IV data for ${symbol}`);
      return null;
    }

    // Get historical prices for RV calculation
    const historicalData = await fetchOHLCData(symbol, 'stock', 60);
    if (!historicalData || historicalData.closes.length < 21) {
      logger.warn(`[VOL-ANALYSIS] Insufficient historical data for ${symbol}`);
      return null;
    }

    // Calculate Realized Volatility (10-day and 20-day)
    const rv20 = calculateRealizedVolatility(historicalData.closes, 20);
    const rv10 = calculateRealizedVolatility(historicalData.closes, 10);

    // Simulate IV history from recent data (in production, store actual IV history)
    // For now, estimate based on price volatility patterns
    const ivHistory = estimateIVHistory(historicalData.closes, currentIV);

    // Calculate IV Rank and Percentile
    const ivRank = calculateIVRank(currentIV, ivHistory);
    const ivPercentile = calculateIVPercentile(currentIV, ivHistory);

    // IV vs RV Analysis
    const ivRvRatio = rv20 > 0 ? currentIV / rv20 : 1;
    let ivVsRv: 'expensive' | 'cheap' | 'fair' = 'fair';
    let recommendation: 'buy_premium' | 'sell_premium' | 'neutral' = 'neutral';

    // IV > RV by 20%+ → Expensive (sell premium)
    if (ivRvRatio > 1.2) {
      ivVsRv = 'expensive';
      signals.push(`📈 IV > RV by ${((ivRvRatio - 1) * 100).toFixed(0)}% - Premium EXPENSIVE`);
    }
    // IV < RV by 20%+ → Cheap (buy premium)
    else if (ivRvRatio < 0.8) {
      ivVsRv = 'cheap';
      signals.push(`📉 IV < RV by ${((1 - ivRvRatio) * 100).toFixed(0)}% - Premium CHEAP`);
    } else {
      signals.push(`⚖️ IV ≈ RV (ratio: ${ivRvRatio.toFixed(2)}) - Fair value`);
    }

    // IV Rank signals
    if (ivRank > 70) {
      signals.push(`🔥 IV Rank ${ivRank.toFixed(0)}% - HIGH (near 52wk high)`);
      recommendation = 'sell_premium';
    } else if (ivRank < 30) {
      signals.push(`❄️ IV Rank ${ivRank.toFixed(0)}% - LOW (near 52wk low)`);
      recommendation = 'buy_premium';
    } else {
      signals.push(`📊 IV Rank ${ivRank.toFixed(0)}% - NEUTRAL`);
    }

    // Override recommendation based on IV vs RV if strong signal
    if (ivVsRv === 'expensive' && ivRank > 50) {
      recommendation = 'sell_premium';
    } else if (ivVsRv === 'cheap' && ivRank < 50) {
      recommendation = 'buy_premium';
    }

    logger.info(`[VOL-ANALYSIS] ${symbol}: IV=${currentIV.toFixed(1)}%, RV20=${rv20.toFixed(1)}%, IVRank=${ivRank.toFixed(0)}%, Rec=${recommendation}`);

    return {
      symbol,
      currentIV,
      realizedVol20: rv20,
      realizedVol10: rv10,
      ivRank,
      ivPercentile,
      ivVsRv,
      ivRvRatio,
      recommendation,
      signals,
      timestamp: new Date(),
    };
  } catch (error) {
    logger.error(`[VOL-ANALYSIS] Failed to analyze ${symbol}:`, error);
    return null;
  }
}

/**
 * Estimate IV history from price data
 * In production, this would use actual historical IV data from options
 * For now, we estimate using price volatility patterns
 */
function estimateIVHistory(prices: number[], currentIV: number): number[] {
  const history: number[] = [];
  const windowSize = 10;

  // Calculate rolling volatility and scale to IV-like values
  for (let i = windowSize; i < prices.length; i++) {
    const window = prices.slice(i - windowSize, i);
    const rv = calculateRealizedVolatility(window, windowSize - 1);
    
    // IV typically trades at a premium to RV (volatility risk premium)
    // Scale to approximate IV levels
    const estimatedIV = rv * 1.2; // Fixed 20% vol risk premium when real IV unavailable
    history.push(estimatedIV);
  }

  // Ensure current IV is in the history
  history.push(currentIV);

  return history;
}

/**
 * Batch volatility analysis for multiple symbols
 */
export async function batchVolatilityAnalysis(symbols: string[]): Promise<Map<string, VolatilityAnalysis>> {
  const results = new Map<string, VolatilityAnalysis>();

  // Process in parallel with rate limiting
  const batchSize = 5;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const analyses = await Promise.all(
      batch.map(symbol => analyzeVolatility(symbol))
    );

    batch.forEach((symbol, idx) => {
      if (analyses[idx]) {
        results.set(symbol, analyses[idx]!);
      }
    });

    // Rate limit between batches
    if (i + batchSize < symbols.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return results;
}

/**
 * Strategy Selection Matrix
 * Determines best instrument and strategy based on regime + volatility
 */
export interface StrategyRecommendation {
  instrument: 'options_buy' | 'options_sell' | 'shares' | 'futures';
  strategy: string;
  confidence: number;
  reasoning: string[];
}

export function selectStrategy(
  regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile',
  volatilityAnalysis: VolatilityAnalysis | null,
  assetType: 'stock' | 'etf' | 'futures' | 'crypto'
): StrategyRecommendation {
  const reasoning: string[] = [];
  let instrument: StrategyRecommendation['instrument'] = 'shares';
  let strategy = 'Hold';
  let confidence = 50;

  // Default to volatility-neutral if no analysis
  const ivRank = volatilityAnalysis?.ivRank || 50;
  const ivVsRv = volatilityAnalysis?.ivVsRv || 'fair';
  const recommendation = volatilityAnalysis?.recommendation || 'neutral';

  reasoning.push(`Regime: ${regime}`);
  reasoning.push(`IV Rank: ${ivRank.toFixed(0)}%`);
  reasoning.push(`IV vs RV: ${ivVsRv}`);

  // Strategy Selection Matrix (from Hedge Fund Framework)
  switch (regime) {
    case 'trending_up':
      if (ivRank < 30 || ivVsRv === 'cheap') {
        // Low IV + uptrend = Buy calls (cheap convexity)
        instrument = 'options_buy';
        strategy = 'Long Calls (Trend + Cheap Vol)';
        confidence = 75;
        reasoning.push('✅ Uptrend + Low IV → Buy calls for convexity');
      } else if (ivRank > 70 || ivVsRv === 'expensive') {
        // High IV + uptrend = Shares or bull put spreads
        instrument = 'shares';
        strategy = 'Long Shares (Trend, avoid expensive options)';
        confidence = 65;
        reasoning.push('⚠️ Uptrend but expensive options → Use shares');
      } else {
        // Normal IV + uptrend = Shares or modest call exposure
        instrument = assetType === 'futures' ? 'futures' : 'shares';
        strategy = 'Trend Following';
        confidence = 70;
        reasoning.push('📈 Uptrend with fair IV → Trend follow');
      }
      break;

    case 'trending_down':
      if (ivRank < 30 || ivVsRv === 'cheap') {
        // Low IV + downtrend = Buy puts
        instrument = 'options_buy';
        strategy = 'Long Puts (Trend + Cheap Vol)';
        confidence = 70;
        reasoning.push('✅ Downtrend + Low IV → Buy puts');
      } else if (ivRank > 70 || ivVsRv === 'expensive') {
        // High IV + downtrend = Sell call spreads or stay out
        instrument = 'options_sell';
        strategy = 'Bear Call Spread (Sell expensive premium)';
        confidence = 60;
        reasoning.push('📉 Downtrend + expensive IV → Sell calls');
      } else {
        instrument = 'shares';
        strategy = 'Short Shares or Puts';
        confidence = 60;
        reasoning.push('📉 Downtrend with fair IV');
      }
      break;

    case 'volatile':
      if (ivRank > 60 || ivVsRv === 'expensive') {
        // High vol regime + expensive IV = Sell premium
        instrument = 'options_sell';
        strategy = 'Iron Condor (Sell vol spike)';
        confidence = 65;
        reasoning.push('🔥 Volatile + expensive IV → Sell premium');
      } else {
        // Volatile but IV cheap = Long straddle/strangle
        instrument = 'options_buy';
        strategy = 'Long Straddle (Buy gamma)';
        confidence = 55;
        reasoning.push('⚡ Volatile + cheap IV → Buy gamma');
      }
      break;

    case 'ranging':
      if (ivRank > 50 || ivVsRv === 'expensive') {
        // Range-bound + high IV = Sell premium
        instrument = 'options_sell';
        strategy = 'Iron Condor / Strangle';
        confidence = 70;
        reasoning.push('📊 Ranging + high IV → Sell premium');
      } else {
        // Range-bound + low IV = Mean reversion with shares
        instrument = 'shares';
        strategy = 'Mean Reversion';
        confidence = 60;
        reasoning.push('📊 Ranging + low IV → Mean revert with shares');
      }
      break;
  }

  return {
    instrument,
    strategy,
    confidence,
    reasoning,
  };
}

/**
 * Quick IV check for trading decisions
 * Returns simplified assessment for bot use
 */
export async function quickIVCheck(symbol: string): Promise<{
  ivRank: number;
  recommendation: 'buy' | 'sell' | 'neutral';
  reason: string;
} | null> {
  try {
    const analysis = await analyzeVolatility(symbol);
    if (!analysis) return null;

    let recommendation: 'buy' | 'sell' | 'neutral' = 'neutral';
    let reason = `IV Rank: ${analysis.ivRank.toFixed(0)}%`;

    if (analysis.ivRank < 30 && analysis.ivVsRv !== 'expensive') {
      recommendation = 'buy';
      reason = `Low IV (${analysis.ivRank.toFixed(0)}%) - options are cheap`;
    } else if (analysis.ivRank > 70 && analysis.ivVsRv !== 'cheap') {
      recommendation = 'sell';
      reason = `High IV (${analysis.ivRank.toFixed(0)}%) - options are expensive`;
    }

    return {
      ivRank: analysis.ivRank,
      recommendation,
      reason,
    };
  } catch (error) {
    return null;
  }
}
