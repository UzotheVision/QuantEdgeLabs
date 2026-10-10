/**
 * Market Regime Detection
 *
 * Classifies market conditions to apply regime-specific signal weights.
 * Different signals work better in different market environments.
 *
 * Regimes:
 * - TRENDING_UP: Strong uptrend, momentum signals work best
 * - TRENDING_DOWN: Downtrend, bearish signals, put flow important
 * - RANGING: Sideways market, mean reversion signals work best
 * - HIGH_VOLATILITY: VIX > 25, options flow critical, reduce position size
 * - LOW_VOLATILITY: VIX < 15, breakout signals, momentum plays
 * - CRISIS: VIX > 35, defensive mode, cash is king
 */

import { logger } from '../logger';
import { getYahooFinance, safeQuote } from '../yahoo-finance-service';

export type MarketRegime =
  | 'TRENDING_UP'
  | 'TRENDING_DOWN'
  | 'RANGING'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'CRISIS'
  | 'UNKNOWN';

export interface RegimeAnalysis {
  regime: MarketRegime;
  confidence: number;           // 0-100% confidence in classification
  vix: number;
  spyTrend: 'up' | 'down' | 'neutral';
  spyMomentum: number;          // 20-day momentum %
  breadth: number;              // Advance/decline ratio
  volatilityPercentile: number; // Where VIX sits historically
  signalMultipliers: SignalMultipliers;
  recommendations: string[];
  detectedAt: Date;
}

export interface SignalMultipliers {
  momentum: number;       // RSI, MACD, trend signals
  meanReversion: number;  // Oversold/overbought bounces
  breakout: number;       // Support/resistance breaks
  optionsFlow: number;    // Unusual activity signals
  sentiment: number;      // News, social signals
  volume: number;         // Volume-based signals
}

// Historical VIX percentiles (approximate)
const VIX_PERCENTILES = {
  p10: 12,   // 10th percentile - very low vol
  p25: 14,   // 25th percentile
  p50: 17,   // Median
  p75: 22,   // 75th percentile
  p90: 28,   // 90th percentile - high vol
  p95: 32,   // 95th percentile - very high
};

// Cache regime for 5 minutes (market changes slowly)
let cachedRegime: RegimeAnalysis | null = null;
let cacheTime: Date | null = null;
const CACHE_DURATION_MS = 5 * 60 * 1000;

/**
 * Detect current market regime
 */
export async function detectRegime(): Promise<RegimeAnalysis> {
  // Return cached if fresh
  if (cachedRegime && cacheTime) {
    const age = Date.now() - cacheTime.getTime();
    if (age < CACHE_DURATION_MS) {
      return cachedRegime;
    }
  }

  try {
    // Fetch VIX and SPY data in parallel
    const [vixData, spyData] = await Promise.all([
      fetchVIX(),
      fetchSPYData(),
    ]);

    const { vix, vixChange } = vixData;
    const { trend, momentum, sma20, sma50, price } = spyData;

    // Calculate volatility percentile
    let volatilityPercentile: number;
    if (vix <= VIX_PERCENTILES.p10) volatilityPercentile = 10;
    else if (vix <= VIX_PERCENTILES.p25) volatilityPercentile = 25;
    else if (vix <= VIX_PERCENTILES.p50) volatilityPercentile = 50;
    else if (vix <= VIX_PERCENTILES.p75) volatilityPercentile = 75;
    else if (vix <= VIX_PERCENTILES.p90) volatilityPercentile = 90;
    else volatilityPercentile = 95;

    // Determine regime
    let regime: MarketRegime;
    let confidence: number;
    const recommendations: string[] = [];

    // Crisis mode: VIX > 35
    if (vix > 35) {
      regime = 'CRISIS';
      confidence = 90;
      recommendations.push(
        'CRISIS MODE: Reduce position sizes by 50%',
        'Avoid new long positions',
        'Focus on hedged or cash positions',
        'Options premiums are elevated - selling premium viable'
      );
    }
    // High volatility: VIX > 25
    else if (vix > 25) {
      regime = 'HIGH_VOLATILITY';
      confidence = 80;
      recommendations.push(
        'HIGH VOL: Reduce position sizes by 25%',
        'Options flow signals more predictive',
        'Wider stops needed',
        'Avoid mean reversion in this environment'
      );
    }
    // Low volatility: VIX < 15
    else if (vix < 15) {
      regime = 'LOW_VOLATILITY';
      confidence = 75;
      recommendations.push(
        'LOW VOL: Breakout signals more reliable',
        'Momentum trades favored',
        'Mean reversion less effective',
        'Consider longer holding periods'
      );
    }
    // Trending up: SPY above both MAs, positive momentum
    else if (trend === 'up' && momentum > 3 && price > sma20 && sma20 > sma50) {
      regime = 'TRENDING_UP';
      confidence = 70 + Math.min(momentum, 10);
      recommendations.push(
        'UPTREND: Momentum signals highly effective',
        'Buy dips to moving averages',
        'Avoid fighting the trend',
        'Trail stops, let winners run'
      );
    }
    // Trending down: SPY below both MAs, negative momentum
    else if (trend === 'down' && momentum < -3 && price < sma20 && sma20 < sma50) {
      regime = 'TRENDING_DOWN';
      confidence = 70 + Math.min(Math.abs(momentum), 10);
      recommendations.push(
        'DOWNTREND: Bearish signals favored',
        'Rally attempts likely to fail',
        'Put flow signals important',
        'Reduce long exposure'
      );
    }
    // Ranging: Neither trending up nor down
    else {
      regime = 'RANGING';
      confidence = 60;
      recommendations.push(
        'RANGING: Mean reversion signals most effective',
        'Buy support, sell resistance',
        'Avoid breakout trades (likely false)',
        'Reduce position sizes in choppy conditions'
      );
    }

    // Calculate signal multipliers based on regime
    const signalMultipliers = calculateSignalMultipliers(regime, vix, momentum);

    const analysis: RegimeAnalysis = {
      regime,
      confidence,
      vix,
      spyTrend: trend,
      spyMomentum: momentum,
      breadth: 1.0, // TODO: Add breadth indicator
      volatilityPercentile,
      signalMultipliers,
      recommendations,
      detectedAt: new Date(),
    };

    // Cache the result
    cachedRegime = analysis;
    cacheTime = new Date();

    logger.info(
      `[REGIME] Detected: ${regime} (${confidence}% confidence), ` +
      `VIX: ${vix.toFixed(1)}, SPY momentum: ${momentum.toFixed(1)}%`
    );

    return analysis;
  } catch (error) {
    logger.error('[REGIME] Detection failed:', error);
    return getDefaultRegime();
  }
}

/**
 * Calculate signal multipliers for current regime
 */
function calculateSignalMultipliers(
  regime: MarketRegime,
  vix: number,
  momentum: number
): SignalMultipliers {
  // Default multipliers (1.0 = no change)
  const multipliers: SignalMultipliers = {
    momentum: 1.0,
    meanReversion: 1.0,
    breakout: 1.0,
    optionsFlow: 1.0,
    sentiment: 1.0,
    volume: 1.0,
  };

  switch (regime) {
    case 'TRENDING_UP':
      multipliers.momentum = 1.3;       // Momentum works great
      multipliers.meanReversion = 0.7;  // Bounces are buyable
      multipliers.breakout = 1.2;       // Breakouts tend to work
      multipliers.optionsFlow = 1.1;
      multipliers.sentiment = 1.1;
      multipliers.volume = 1.1;
      break;

    case 'TRENDING_DOWN':
      multipliers.momentum = 1.2;       // Bearish momentum works
      multipliers.meanReversion = 0.5;  // Don't catch falling knives
      multipliers.breakout = 0.8;       // False breakouts common
      multipliers.optionsFlow = 1.3;    // Put flow important
      multipliers.sentiment = 1.2;      // News moves markets
      multipliers.volume = 1.1;
      break;

    case 'RANGING':
      multipliers.momentum = 0.7;       // Whipsaws common
      multipliers.meanReversion = 1.4;  // Mean reversion shines
      multipliers.breakout = 0.5;       // False breakouts everywhere
      multipliers.optionsFlow = 0.9;
      multipliers.sentiment = 0.8;      // Noise in ranging markets
      multipliers.volume = 1.0;
      break;

    case 'HIGH_VOLATILITY':
      multipliers.momentum = 0.8;       // Too volatile for momentum
      multipliers.meanReversion = 0.6;  // Extremes can get more extreme
      multipliers.breakout = 0.7;
      multipliers.optionsFlow = 1.4;    // Flow signals critical
      multipliers.sentiment = 1.3;      // News-driven
      multipliers.volume = 1.2;
      break;

    case 'LOW_VOLATILITY':
      multipliers.momentum = 1.2;
      multipliers.meanReversion = 0.8;  // Less mean reversion
      multipliers.breakout = 1.3;       // Breakouts work well
      multipliers.optionsFlow = 0.9;    // Less informative
      multipliers.sentiment = 0.9;
      multipliers.volume = 1.1;
      break;

    case 'CRISIS':
      multipliers.momentum = 0.5;       // Everything correlates
      multipliers.meanReversion = 0.3;  // Knives keep falling
      multipliers.breakout = 0.4;
      multipliers.optionsFlow = 1.5;    // Flow is king
      multipliers.sentiment = 1.4;      // Headlines move markets
      multipliers.volume = 1.3;
      break;

    default:
      // Keep defaults
      break;
  }

  // Fine-tune based on VIX level
  if (vix > 30) {
    multipliers.momentum *= 0.9;
    multipliers.optionsFlow *= 1.1;
  } else if (vix < 15) {
    multipliers.breakout *= 1.1;
    multipliers.momentum *= 1.1;
  }

  return multipliers;
}

/**
 * Apply regime multiplier to a signal confidence
 */
export function applyRegimeMultiplier(
  signalType: string,
  baseConfidence: number,
  multipliers: SignalMultipliers
): number {
  // Map signal types to multiplier categories
  const signalCategory = getSignalCategory(signalType);
  const multiplier = multipliers[signalCategory] || 1.0;

  // Apply multiplier with dampening to avoid extreme values
  const adjusted = baseConfidence * (0.5 + multiplier * 0.5);

  // Clamp to reasonable range
  return Math.max(30, Math.min(95, adjusted));
}

/**
 * Get signal category for multiplier lookup
 */
function getSignalCategory(signalType: string): keyof SignalMultipliers {
  const lower = signalType.toLowerCase();

  if (lower.includes('rsi') || lower.includes('macd') || lower.includes('momentum') ||
      lower.includes('trend') || lower.includes('cross')) {
    return 'momentum';
  }

  if (lower.includes('oversold') || lower.includes('overbought') ||
      lower.includes('reversion') || lower.includes('bounce')) {
    return 'meanReversion';
  }

  if (lower.includes('breakout') || lower.includes('break') ||
      lower.includes('support') || lower.includes('resistance')) {
    return 'breakout';
  }

  if (lower.includes('flow') || lower.includes('sweep') ||
      lower.includes('option') || lower.includes('call') || lower.includes('put')) {
    return 'optionsFlow';
  }

  if (lower.includes('sentiment') || lower.includes('news') ||
      lower.includes('social') || lower.includes('fear') || lower.includes('greed')) {
    return 'sentiment';
  }

  if (lower.includes('volume') || lower.includes('spike')) {
    return 'volume';
  }

  return 'momentum'; // Default
}

/**
 * Fetch VIX data
 */
async function fetchVIX(): Promise<{ vix: number; vixChange: number }> {
  try {
    const quote = await safeQuote('^VIX');
    if (!quote) {
      return { vix: 20, vixChange: 0 };
    }
    return {
      vix: quote.regularMarketPrice || 20,
      vixChange: quote.regularMarketChangePercent || 0,
    };
  } catch {
    logger.warn('[REGIME] Failed to fetch VIX, using default');
    return { vix: 20, vixChange: 0 };
  }
}

/**
 * Fetch SPY data for trend analysis
 */
async function fetchSPYData(): Promise<{
  trend: 'up' | 'down' | 'neutral';
  momentum: number;
  sma20: number;
  sma50: number;
  price: number;
}> {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 100); // Need 50+ days for SMA50

    const yf = await getYahooFinance();
    const history = await yf.chart('SPY', {
      period1: startDate,
      period2: endDate,
      interval: '1d',
    });

    const quotes = history.quotes || [];
    if (quotes.length < 50) {
      throw new Error('Insufficient historical data');
    }

    const closes = quotes.map(q => q.close || 0).filter(c => c > 0);
    const currentPrice = closes[closes.length - 1];

    // Calculate SMAs
    const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;

    // Calculate 20-day momentum
    const price20DaysAgo = closes[closes.length - 21] || currentPrice;
    const momentum = ((currentPrice - price20DaysAgo) / price20DaysAgo) * 100;

    // Determine trend
    let trend: 'up' | 'down' | 'neutral';
    if (currentPrice > sma20 && sma20 > sma50) {
      trend = 'up';
    } else if (currentPrice < sma20 && sma20 < sma50) {
      trend = 'down';
    } else {
      trend = 'neutral';
    }

    return {
      trend,
      momentum,
      sma20,
      sma50,
      price: currentPrice,
    };
  } catch (error) {
    logger.warn('[REGIME] Failed to fetch SPY data:', error);
    return {
      trend: 'neutral',
      momentum: 0,
      sma20: 500,
      sma50: 500,
      price: 500,
    };
  }
}

/**
 * Get default regime when detection fails
 */
function getDefaultRegime(): RegimeAnalysis {
  return {
    regime: 'UNKNOWN',
    confidence: 0,
    vix: 20,
    spyTrend: 'neutral',
    spyMomentum: 0,
    breadth: 1.0,
    volatilityPercentile: 50,
    signalMultipliers: {
      momentum: 1.0,
      meanReversion: 1.0,
      breakout: 1.0,
      optionsFlow: 1.0,
      sentiment: 1.0,
      volume: 1.0,
    },
    recommendations: ['Unable to detect regime - using default multipliers'],
    detectedAt: new Date(),
  };
}

/**
 * Get a human-readable regime summary
 */
export function getRegimeSummary(analysis: RegimeAnalysis): string {
  const { regime, confidence, vix, spyTrend, spyMomentum, recommendations } = analysis;

  return `
Market Regime: ${regime} (${confidence}% confidence)
VIX: ${vix.toFixed(1)} | SPY Trend: ${spyTrend} | Momentum: ${spyMomentum >= 0 ? '+' : ''}${spyMomentum.toFixed(1)}%

Signal Adjustments:
- Momentum signals: ${(analysis.signalMultipliers.momentum * 100).toFixed(0)}%
- Mean reversion: ${(analysis.signalMultipliers.meanReversion * 100).toFixed(0)}%
- Breakout signals: ${(analysis.signalMultipliers.breakout * 100).toFixed(0)}%
- Options flow: ${(analysis.signalMultipliers.optionsFlow * 100).toFixed(0)}%

Recommendations:
${recommendations.map(r => `• ${r}`).join('\n')}
  `.trim();
}

export default {
  detectRegime,
  applyRegimeMultiplier,
  getRegimeSummary,
};
