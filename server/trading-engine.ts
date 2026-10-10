/**
 * 🎯 TRADING ENGINE
 * 
 * Integrated system combining:
 * 1. Confluence Validation Engine - Validates fundamental + technical alignment
 * 2. Asset-Specific Fundamental Filters - Analysis by market type
 * 3. Trade Structure Generator - Auto-generate entry/stop/target
 * 
 * Based on professional trading framework:
 * - Fundamental answers WHAT & WHY
 * - Technical answers WHEN, WHERE & HOW
 * - Neither works alone. Together, they create edge.
 */

import { fetchStockPrice, fetchCryptoPrice } from './market-api';
import { fetchOHLCData } from './chart-analysis';
import { analyzeVolatility, type VolatilityAnalysis } from './volatility-analysis-service';
import { getMarketContext, type MarketContext } from './market-context-service';
import { logger } from './logger';
import { fetchAlphaVantageNews, type NewsArticle } from './news-service';

// =============================================================================
// NEWS CONTEXT ANALYSIS
// =============================================================================

export interface NewsContext {
  hasRecentNews: boolean;
  sentimentScore: number; // -1 to +1
  sentimentLabel: 'Bullish' | 'Bearish' | 'Neutral' | 'Mixed';
  newsBias: 'bullish' | 'bearish' | 'neutral'; // Directional bias for trade alignment
  topHeadlines: string[];
  keyTopics: string[];
  catalysts: string[];
  convictionAdjustment: number; // -20 to +20 (raw, before direction reconciliation)
  earningsDetected: boolean;
  earningsBeat: boolean | null; // true=beat, false=miss, null=unclear
  /** Signed % surprise vs estimate when extractable from headlines (positive = beat). */
  earningsSurprisePct: number | null;
  warnings: string[];
}

/**
 * Extract a signed earnings surprise % from a blob of headlines.
 * Returns positive for beats, negative for misses, null if not detectable.
 *
 * Patterns we look for (case-insensitive):
 *   "beats by 12%", "tops estimates by 8%"
 *   "EPS surprise of 15%", "+15% surprise"
 *   "EPS $1.20 vs $1.10 estimate"  → (1.20-1.10)/1.10 = 9.1%
 *   "misses by 5%", "below estimates by 7%"
 */
function extractEarningsSurprisePct(text: string): number | null {
  if (!text) return null;
  const t = text.toLowerCase();

  // Pattern 1: "beats/misses by N%" or "tops by N%"
  const byPctRegex = /(beat[s]?|tops?|surpass(?:es)?|miss(?:es)?|fall[s]? short|below)\s+(?:estimates?\s+)?(?:by\s+)?(\d+(?:\.\d+)?)\s*%/;
  const byMatch = t.match(byPctRegex);
  if (byMatch) {
    const verb = byMatch[1];
    const pct = parseFloat(byMatch[2]);
    if (Number.isFinite(pct)) {
      const isMiss = /miss|fall|below/.test(verb);
      return isMiss ? -pct : pct;
    }
  }

  // Pattern 2: "+12% surprise" or "-7% surprise"
  const surpriseRegex = /([+-]?\d+(?:\.\d+)?)\s*%\s*(?:earnings\s+)?surprise/;
  const surpriseMatch = t.match(surpriseRegex);
  if (surpriseMatch) {
    const pct = parseFloat(surpriseMatch[1]);
    if (Number.isFinite(pct)) return pct;
  }

  // Pattern 3: "EPS of $1.20 vs $1.10 (expected|estimate|consensus)"
  const epsRegex = /eps\s+(?:of\s+)?\$?(\d+(?:\.\d+)?)\s+(?:vs\.?|versus|compared to)\s+\$?(\d+(?:\.\d+)?)\s*(?:expected|estimate|consensus)?/;
  const epsMatch = t.match(epsRegex);
  if (epsMatch) {
    const actual = parseFloat(epsMatch[1]);
    const est = parseFloat(epsMatch[2]);
    if (Number.isFinite(actual) && Number.isFinite(est) && est !== 0) {
      return ((actual - est) / Math.abs(est)) * 100;
    }
  }

  return null;
}

/**
 * Analyze news context for a symbol
 * Returns sentiment, catalysts, and conviction adjustment
 */
export async function getNewsContext(symbol: string): Promise<NewsContext> {
  const result: NewsContext = {
    hasRecentNews: false,
    sentimentScore: 0,
    sentimentLabel: 'Neutral',
    newsBias: 'neutral',
    topHeadlines: [],
    keyTopics: [],
    catalysts: [],
    convictionAdjustment: 0,
    earningsDetected: false,
    earningsBeat: null,
    earningsSurprisePct: null,
    warnings: [],
  };

  try {
    // Fetch recent news for the symbol (last 24-48 hours)
    const articles = await fetchAlphaVantageNews(symbol, undefined, undefined, 10);
    
    if (!articles || articles.length === 0) {
      result.catalysts.push('No recent news catalysts');
      return result;
    }

    result.hasRecentNews = true;
    
    // Calculate aggregate sentiment
    let totalSentiment = 0;
    let relevantArticleCount = 0;
    const topics = new Set<string>();
    
    for (const article of articles) {
      // Find sentiment specific to this ticker
      const tickerSentiment = article.tickerSentiments?.find(
        ts => ts.ticker.toUpperCase() === symbol.toUpperCase()
      );
      
      let score = 0;
      if (tickerSentiment) {
        const parsed = parseFloat(tickerSentiment.ticker_sentiment_score);
        score = isNaN(parsed) ? 0 : parsed;
      } else if (typeof article.overallSentimentScore === 'number' && !isNaN(article.overallSentimentScore)) {
        score = article.overallSentimentScore;
      }
      
      totalSentiment += score;
      relevantArticleCount++;
      
      // Collect top headlines (max 3)
      if (result.topHeadlines.length < 3) {
        result.topHeadlines.push(article.title);
      }
      
      // Collect topics
      article.topics?.forEach(t => topics.add(t.topic));
    }
    
    // Calculate average sentiment
    if (relevantArticleCount > 0) {
      result.sentimentScore = totalSentiment / relevantArticleCount;
    }
    
    // Determine sentiment label
    if (result.sentimentScore > 0.25) {
      result.sentimentLabel = 'Bullish';
    } else if (result.sentimentScore < -0.25) {
      result.sentimentLabel = 'Bearish';
    } else if (Math.abs(result.sentimentScore) < 0.1) {
      result.sentimentLabel = 'Neutral';
    } else {
      result.sentimentLabel = 'Mixed';
    }
    
    // Key topics
    result.keyTopics = Array.from(topics).slice(0, 5);
    
    // Set directional bias based on sentiment score
    if (result.sentimentScore > 0.15) {
      result.newsBias = 'bullish';
    } else if (result.sentimentScore < -0.15) {
      result.newsBias = 'bearish';
    } else {
      result.newsBias = 'neutral';
    }
    
    // Detect earnings and beat/miss from headlines
    const allHeadlines = articles.map(a => a.title.toLowerCase()).join(' ');
    const earningsKeywords = ['earnings', 'quarterly', 'q1', 'q2', 'q3', 'q4', 'eps', 'revenue', 'fiscal', 'beat', 'miss', 'guidance'];
    result.earningsDetected = topics.has('earnings') || earningsKeywords.some(kw => allHeadlines.includes(kw));
    
    if (result.earningsDetected) {
      // Detect beat vs miss from headlines
      const beatKeywords = ['beat', 'beats', 'exceeds', 'tops', 'surpasses', 'outperforms', 'raised guidance', 'raises guidance', 'strong results', 'better than expected', 'blowout'];
      const missKeywords = ['miss', 'misses', 'falls short', 'disappoints', 'below expectations', 'weak', 'lowers guidance', 'cuts guidance', 'warns', 'disappointing'];
      
      const hasBeat = beatKeywords.some(kw => allHeadlines.includes(kw));
      const hasMiss = missKeywords.some(kw => allHeadlines.includes(kw));
      
      if (hasBeat && !hasMiss) {
        result.earningsBeat = true;
        result.newsBias = 'bullish'; // Earnings beat overrides general sentiment
        result.catalysts.push('Earnings BEAT detected');
      } else if (hasMiss && !hasBeat) {
        result.earningsBeat = false;
        result.newsBias = 'bearish'; // Earnings miss overrides general sentiment
        result.catalysts.push('Earnings MISS detected');
        result.warnings.push('Earnings miss detected - high downside risk');
      } else {
        result.earningsBeat = null;
        result.catalysts.push('Earnings activity detected - outcome unclear');
      }

      // Try to pull a magnitude — turns "Earnings beat" from binary to graded.
      const surprisePct = extractEarningsSurprisePct(allHeadlines);
      if (surprisePct !== null) {
        result.earningsSurprisePct = surprisePct;
        // Reconcile with binary flag if we got a clean magnitude
        if (result.earningsBeat === null) {
          result.earningsBeat = surprisePct > 0;
        }
        result.catalysts.push(`Surprise ${surprisePct >= 0 ? '+' : ''}${surprisePct.toFixed(1)}%`);
      }
    }
    
    // Generate catalysts from news
    if (topics.has('earnings') && !result.earningsDetected) {
      result.catalysts.push('Earnings activity detected in news');
    }
    if (topics.has('mergers_and_acquisitions')) {
      result.catalysts.push('M&A activity mentioned');
    }
    if (topics.has('ipo')) {
      result.catalysts.push('IPO/offering news');
    }
    if (topics.has('financial_markets')) {
      result.catalysts.push('Market-moving financial news');
    }
    if (topics.has('technology')) {
      result.catalysts.push('Technology sector news');
    }
    if (topics.has('economy_monetary')) {
      result.catalysts.push('Fed/monetary policy implications');
    }
    
    // Add generic catalyst if we have news but no specific topic match
    if (result.catalysts.length === 0 && articles.length > 0) {
      result.catalysts.push(`${articles.length} recent news articles`);
    }
    
    // Calculate conviction adjustment based on sentiment strength
    // Strong sentiment = bigger adjustment
    if (result.sentimentScore > 0.35) {
      result.convictionAdjustment = 15;
      result.catalysts.push(`Strong bullish news sentiment (+${(result.sentimentScore * 100).toFixed(0)}%)`);
    } else if (result.sentimentScore > 0.2) {
      result.convictionAdjustment = 10;
      result.catalysts.push(`Bullish news sentiment (+${(result.sentimentScore * 100).toFixed(0)}%)`);
    } else if (result.sentimentScore < -0.35) {
      result.convictionAdjustment = -15;
      result.warnings.push(`Strong bearish news sentiment (${(result.sentimentScore * 100).toFixed(0)}%)`);
    } else if (result.sentimentScore < -0.2) {
      result.convictionAdjustment = -10;
      result.warnings.push(`Bearish news sentiment (${(result.sentimentScore * 100).toFixed(0)}%)`);
    }
    
    // Add warning for very recent breaking news
    const now = Date.now();
    const recentArticles = articles.filter(a => {
      try {
        const pubTime = new Date(a.timePublished).getTime();
        return (now - pubTime) < 4 * 60 * 60 * 1000; // Last 4 hours
      } catch { return false; }
    });
    
    if (recentArticles.length > 0) {
      result.warnings.push(`${recentArticles.length} breaking news in last 4 hours - high volatility risk`);
    }
    
  } catch (error) {
    logger.warn(`Error fetching news context for ${symbol}:`, error);
    result.catalysts.push('News data temporarily unavailable');
  }
  
  return result;
}

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

export type AssetClass = 'stock' | 'options' | 'futures' | 'crypto';
export type Bias = 'bullish' | 'bearish' | 'neutral';
export type SignalStrength = 'strong' | 'moderate' | 'weak' | 'none';

export interface FundamentalAnalysis {
  asset: AssetClass;
  symbol: string;
  bias: Bias;
  conviction: number; // 0-100
  drivers: string[];
  catalysts: string[];
  risks: string[];
  timeHorizon: 'short' | 'medium' | 'long'; // days, weeks, months
}

export interface TechnicalAnalysis {
  symbol: string;
  trend: {
    direction: 'up' | 'down' | 'sideways';
    strength: SignalStrength;
    movingAverages: {
      sma20: number;
      sma50: number;
      sma200: number;
      priceVsSma20: 'above' | 'below';
      priceVsSma50: 'above' | 'below';
    };
  };
  momentum: {
    rsi14: number;
    condition: 'overbought' | 'oversold' | 'neutral';
    divergence: 'bullish' | 'bearish' | 'none';
  };
  volatility: {
    atr14: number;
    atrPercent: number;
    regime: 'low' | 'normal' | 'high' | 'extreme';
    compression: boolean;
  };
  levels: {
    currentPrice: number;
    support: number[];
    resistance: number[];
    vwap: number | null;
    pivotPoint: number;
  };
}

export interface ConfluenceResult {
  isValid: boolean;
  score: number; // 0-100
  alignment: 'strong' | 'moderate' | 'weak' | 'conflict';
  fundamentalBias: Bias;
  technicalBias: Bias;
  checks: {
    name: string;
    passed: boolean;
    detail: string;
  }[];
  recommendation: string;
  warnings: string[];
}

export interface TradeStructure {
  symbol: string;
  direction: 'long' | 'short';
  entry: {
    price: number;
    type: 'limit' | 'market' | 'stop';
    rationale: string;
  };
  stop: {
    price: number;
    type: 'technical' | 'volatility' | 'percentage';
    rationale: string;
  };
  targets: {
    price: number;
    probability: number;
    rationale: string;
  }[];
  riskReward: number;
  positionSize: {
    riskPercent: number;
    shares: number;
    dollarRisk: number;
  };
  structure: string; // e.g., "long shares", "call spread", "short put"
  timeframe: string;
  invalidation: string;
}

export interface TradingEngineResult {
  symbol: string;
  assetClass: AssetClass;
  timestamp: string;
  fundamental: FundamentalAnalysis;
  technical: TechnicalAnalysis;
  confluence: ConfluenceResult;
  tradeStructure: TradeStructure | null;
  volatilityContext: VolatilityAnalysis | null;
  marketContext: MarketContext;
  newsContext?: NewsContext | null;
  actionable: boolean;
  summary: string;
}

// =============================================================================
// FUNDAMENTAL ANALYSIS ENGINE
// =============================================================================

/**
 * Analyze fundamentals for stocks - now with real news integration
 * Returns both FundamentalAnalysis and separate NewsContext
 */
async function analyzeStockFundamentals(symbol: string): Promise<{ fundamental: FundamentalAnalysis; newsContext: NewsContext | null }> {
  const drivers: string[] = [];
  const catalysts: string[] = [];
  const risks: string[] = [];
  let bias: Bias = 'neutral';
  let conviction = 50;
  let newsContext: NewsContext | null = null;

  try {
    // Fetch real news context in parallel with price data
    const [quote, news] = await Promise.all([
      fetchStockPrice(symbol),
      getNewsContext(symbol)
    ]);
    
    newsContext = news;
    
    if (quote) {
      // Price momentum analysis
      const changePercent = quote.changePercent || 0;
      
      if (changePercent > 2) {
        drivers.push(`Strong momentum: +${changePercent.toFixed(2)}% today`);
        bias = 'bullish';
        conviction += 15;
      } else if (changePercent < -2) {
        drivers.push(`Weak momentum: ${changePercent.toFixed(2)}% today`);
        bias = 'bearish';
        conviction += 15;
      } else {
        drivers.push(`Neutral momentum: ${changePercent.toFixed(2)}% today`);
      }

      // Volume analysis (if available)
      if (quote.volume && quote.avgVolume) {
        const volumeRatio = quote.volume / quote.avgVolume;
        if (volumeRatio > 1.5) {
          drivers.push(`High volume: ${(volumeRatio * 100).toFixed(0)}% of average`);
          conviction += 10;
        }
      }
    }

    // NEWS CONTEXT INTEGRATION - Real catalysts from news
    if (newsContext.hasRecentNews) {
      // Add news sentiment to drivers (only if we have a valid score)
      if (newsContext.sentimentLabel !== 'Neutral' && newsContext.sentimentScore !== 0) {
        const sentimentPct = (newsContext.sentimentScore * 100).toFixed(0);
        drivers.push(`News sentiment: ${newsContext.sentimentLabel} (${sentimentPct}%)`);
      } else if (newsContext.hasRecentNews) {
        drivers.push(`News sentiment: ${newsContext.sentimentLabel}`);
      }
      
      // Add real catalysts from news
      newsContext.catalysts.forEach(c => catalysts.push(c));
      
      // Adjust conviction based on news sentiment
      conviction += newsContext.convictionAdjustment;
      
      // Add news warnings to risks
      newsContext.warnings.forEach(w => risks.push(w));
      
      // If news sentiment strongly contradicts price action, flag it
      if (newsContext.sentimentLabel === 'Bearish' && bias === 'bullish') {
        risks.push('Bearish news vs bullish price - potential reversal');
      } else if (newsContext.sentimentLabel === 'Bullish' && bias === 'bearish') {
        drivers.push('Bullish news vs bearish price - potential bounce');
      }
    } else {
      catalysts.push('No recent news catalysts');
    }

    // Market regime context
    const marketContext = await getMarketContext();
    if (marketContext.regime === 'trending_up') {
      drivers.push('Bullish market regime');
      if (bias !== 'bearish') conviction += 10;
    } else if (marketContext.regime === 'trending_down') {
      drivers.push('Bearish market regime');
      if (bias !== 'bullish') conviction += 10;
    }

    // VIX context
    if (marketContext.vixLevel) {
      if (marketContext.vixLevel > 25) {
        risks.push(`Elevated VIX: ${marketContext.vixLevel.toFixed(1)} (high fear)`);
        catalysts.push('Potential volatility expansion');
      } else if (marketContext.vixLevel < 15) {
        drivers.push(`Low VIX: ${marketContext.vixLevel.toFixed(1)} (complacency)`);
        risks.push('Potential volatility spike risk');
      }
    }
    
    // Add general risks
    risks.push('Market-wide correlation risk');
    risks.push('Sector rotation risk');

  } catch (error) {
    logger.warn(`Error analyzing stock fundamentals for ${symbol}:`, error);
    drivers.push('Limited fundamental data available');
    risks.push('Data quality uncertainty');
  }

  return {
    fundamental: {
      asset: 'stock',
      symbol,
      bias,
      conviction: Math.min(100, Math.max(0, conviction)),
      drivers,
      catalysts,
      risks,
      timeHorizon: 'medium',
    },
    newsContext,
  };
}

/**
 * Analyze fundamentals for options
 */
async function analyzeOptionsFundamentals(symbol: string): Promise<FundamentalAnalysis> {
  const drivers: string[] = [];
  const catalysts: string[] = [];
  const risks: string[] = [];
  let bias: Bias = 'neutral';
  let conviction = 50;

  try {
    // Get volatility context - critical for options
    const volAnalysis = await analyzeVolatility(symbol);
    
    if (volAnalysis) {
      // IV Rank drives options fundamentals
      if (volAnalysis.ivRank < 30) {
        drivers.push(`Low IV Rank: ${volAnalysis.ivRank.toFixed(0)}% - options are cheap`);
        catalysts.push('Volatility expansion potential');
        bias = 'bullish'; // Bullish on premium (buy options)
        conviction += 20;
      } else if (volAnalysis.ivRank > 70) {
        drivers.push(`High IV Rank: ${volAnalysis.ivRank.toFixed(0)}% - options are expensive`);
        catalysts.push('Volatility contraction expected');
        risks.push('Premium decay if IV drops');
        // For selling premium, we'd be bullish; for buying, bearish on premium
        conviction += 20;
      } else {
        drivers.push(`Neutral IV Rank: ${volAnalysis.ivRank.toFixed(0)}%`);
      }

      // IV vs RV comparison
      if (volAnalysis.ivVsRv === 'expensive') {
        risks.push('IV > RV - premium may be overpriced');
      } else if (volAnalysis.ivVsRv === 'cheap') {
        catalysts.push('IV < RV - premium may be underpriced');
      }
    }

    // Upcoming catalysts
    catalysts.push('Earnings dates');
    catalysts.push('Economic data releases');
    catalysts.push('FOMC meetings');

    // Options-specific risks
    risks.push('Theta decay');
    risks.push('Early assignment risk (if selling)');
    risks.push('Liquidity risk in far OTM strikes');

  } catch (error) {
    logger.warn(`Error analyzing options fundamentals for ${symbol}:`, error);
    drivers.push('Limited options data available');
  }

  return {
    asset: 'options',
    symbol,
    bias,
    conviction: Math.min(100, Math.max(0, conviction)),
    drivers,
    catalysts,
    risks,
    timeHorizon: 'short',
  };
}

/**
 * Analyze fundamentals for futures
 */
async function analyzeFuturesFundamentals(symbol: string): Promise<FundamentalAnalysis> {
  const drivers: string[] = [];
  const catalysts: string[] = [];
  const risks: string[] = [];
  let bias: Bias = 'neutral';
  let conviction = 50;

  try {
    // Map futures symbols to underlying indices
    const futuresMap: Record<string, string> = {
      'ES': 'SPY', 'NQ': 'QQQ', 'YM': 'DIA', 'RTY': 'IWM',
      'MES': 'SPY', 'MNQ': 'QQQ', 'MYM': 'DIA', 'M2K': 'IWM',
      'GC': 'GLD', 'SI': 'SLV', 'CL': 'USO', 'NG': 'UNG',
    };

    const underlying = futuresMap[symbol.toUpperCase()] || symbol;
    const quote = await fetchStockPrice(underlying);

    if (quote) {
      const changePercent = quote.changePercent || 0;
      if (changePercent > 0.5) {
        drivers.push(`Index momentum: +${changePercent.toFixed(2)}%`);
        bias = 'bullish';
        conviction += 15;
      } else if (changePercent < -0.5) {
        drivers.push(`Index weakness: ${changePercent.toFixed(2)}%`);
        bias = 'bearish';
        conviction += 15;
      }
    }

    // Macro drivers for futures
    const marketContext = await getMarketContext();
    
    drivers.push(`Market regime: ${marketContext.regime}`);
    if (marketContext.vixLevel) {
      drivers.push(`VIX level: ${marketContext.vixLevel.toFixed(1)}`);
    }

    // Futures-specific catalysts
    catalysts.push('Central bank policy decisions');
    catalysts.push('Economic data (NFP, CPI, GDP)');
    catalysts.push('Geopolitical events');
    catalysts.push('Overnight session gaps');

    // Futures-specific risks
    risks.push('Leverage amplifies losses');
    risks.push('Margin call risk');
    risks.push('Gap risk on open');
    risks.push('Roll cost at expiration');

  } catch (error) {
    logger.warn(`Error analyzing futures fundamentals for ${symbol}:`, error);
    drivers.push('Limited futures data available');
  }

  return {
    asset: 'futures',
    symbol,
    bias,
    conviction: Math.min(100, Math.max(0, conviction)),
    drivers,
    catalysts,
    risks,
    timeHorizon: 'short',
  };
}

/**
 * Analyze fundamentals for crypto
 */
async function analyzeCryptoFundamentals(symbol: string): Promise<FundamentalAnalysis> {
  const drivers: string[] = [];
  const catalysts: string[] = [];
  const risks: string[] = [];
  let bias: Bias = 'neutral';
  let conviction = 50;

  try {
    // Get crypto price
    const quote = await fetchCryptoPrice(symbol);

    if (quote) {
      const changePercent = quote.changePercent || 0;
      if (changePercent > 3) {
        drivers.push(`Strong momentum: +${changePercent.toFixed(2)}%`);
        bias = 'bullish';
        conviction += 20;
      } else if (changePercent < -3) {
        drivers.push(`Weak momentum: ${changePercent.toFixed(2)}%`);
        bias = 'bearish';
        conviction += 20;
      }
    }

    // Crypto-specific fundamentals
    if (symbol.toUpperCase() === 'BTC' || symbol.toUpperCase() === 'BITCOIN') {
      drivers.push('Bitcoin dominance indicator');
      catalysts.push('Halving cycles');
      catalysts.push('Institutional adoption news');
      catalysts.push('ETF flows');
    } else if (symbol.toUpperCase() === 'ETH' || symbol.toUpperCase() === 'ETHEREUM') {
      drivers.push('Network activity & gas fees');
      catalysts.push('Layer 2 adoption');
      catalysts.push('Staking yield changes');
    }

    // General crypto catalysts
    catalysts.push('Regulatory developments');
    catalysts.push('Macro liquidity cycles');
    catalysts.push('On-chain metrics');

    // Crypto-specific risks
    risks.push('24/7 trading - gap risk anytime');
    risks.push('Regulatory uncertainty');
    risks.push('Exchange/custody risk');
    risks.push('High correlation to BTC');
    risks.push('Token unlock/emission schedules');

  } catch (error) {
    logger.warn(`Error analyzing crypto fundamentals for ${symbol}:`, error);
    drivers.push('Limited crypto data available');
  }

  return {
    asset: 'crypto',
    symbol,
    bias,
    conviction: Math.min(100, Math.max(0, conviction)),
    drivers,
    catalysts,
    risks,
    timeHorizon: 'medium',
  };
}

/**
 * Main fundamental analysis dispatcher
 */
export async function analyzeFundamentals(
  symbol: string,
  assetClass: AssetClass
): Promise<{ fundamental: FundamentalAnalysis; newsContext: NewsContext | null }> {
  switch (assetClass) {
    case 'stock':
      return analyzeStockFundamentals(symbol);
    case 'options':
      return { fundamental: await analyzeOptionsFundamentals(symbol), newsContext: null };
    case 'futures':
      return { fundamental: await analyzeFuturesFundamentals(symbol), newsContext: null };
    case 'crypto':
      return { fundamental: await analyzeCryptoFundamentals(symbol), newsContext: null };
    default:
      return analyzeStockFundamentals(symbol);
  }
}

// =============================================================================
// TECHNICAL ANALYSIS ENGINE
// =============================================================================

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

/**
 * Calculate RSI
 */
function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate ATR (Average True Range)
 */
function calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
  if (highs.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
}

/**
 * Find support and resistance levels
 */
function findLevels(prices: number[], highs: number[], lows: number[]): { support: number[]; resistance: number[] } {
  if (prices.length < 20) {
    const currentPrice = prices[prices.length - 1] || 0;
    return {
      support: [currentPrice * 0.98, currentPrice * 0.95],
      resistance: [currentPrice * 1.02, currentPrice * 1.05],
    };
  }

  const currentPrice = prices[prices.length - 1];
  const recentLows = lows.slice(-20).sort((a, b) => a - b);
  const recentHighs = highs.slice(-20).sort((a, b) => b - a);

  // Find significant lows below current price as support
  const support = recentLows
    .filter(l => l < currentPrice)
    .slice(0, 3);

  // Find significant highs above current price as resistance
  const resistance = recentHighs
    .filter(h => h > currentPrice)
    .slice(0, 3);

  return { support, resistance };
}

/**
 * Perform technical analysis on a symbol
 */
export async function analyzeTechnicals(symbol: string): Promise<TechnicalAnalysis> {
  try {
    // Fetch historical OHLC data
    const ohlcData = await fetchOHLCData(symbol, 'stock', 100);
    
    if (!ohlcData || ohlcData.closes.length < 20) {
      throw new Error('Insufficient historical data');
    }

    const closes = ohlcData.closes;
    const highs = ohlcData.highs;
    const lows = ohlcData.lows;
    const currentPrice = closes[closes.length - 1];

    // Moving Averages
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    const sma200 = closes.length >= 200 ? calculateSMA(closes, 200) : sma50;

    // Trend determination
    let trendDirection: 'up' | 'down' | 'sideways' = 'sideways';
    let trendStrength: SignalStrength = 'weak';

    if (currentPrice > sma20 && sma20 > sma50) {
      trendDirection = 'up';
      trendStrength = currentPrice > sma50 * 1.02 ? 'strong' : 'moderate';
    } else if (currentPrice < sma20 && sma20 < sma50) {
      trendDirection = 'down';
      trendStrength = currentPrice < sma50 * 0.98 ? 'strong' : 'moderate';
    }

    // RSI
    const rsi14 = calculateRSI(closes, 14);
    let rsiCondition: 'overbought' | 'oversold' | 'neutral' = 'neutral';
    if (rsi14 > 70) rsiCondition = 'overbought';
    else if (rsi14 < 30) rsiCondition = 'oversold';

    // ATR
    const atr14 = calculateATR(highs, lows, closes, 14);
    const atrPercent = (atr14 / currentPrice) * 100;

    let volatilityRegime: 'low' | 'normal' | 'high' | 'extreme' = 'normal';
    if (atrPercent < 1) volatilityRegime = 'low';
    else if (atrPercent > 3) volatilityRegime = 'extreme';
    else if (atrPercent > 2) volatilityRegime = 'high';

    // Volatility compression detection (Bollinger Band squeeze)
    const stdDev = Math.sqrt(
      closes.slice(-20).reduce((sum, p) => sum + Math.pow(p - sma20, 2), 0) / 20
    );
    const bbWidth = (stdDev * 2) / sma20;
    const compression = bbWidth < 0.04; // Tight bands

    // Support/Resistance levels
    const { support, resistance } = findLevels(closes, highs, lows);

    // Pivot Point
    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];
    const lastClose = closes[closes.length - 1];
    const pivotPoint = (lastHigh + lastLow + lastClose) / 3;

    return {
      symbol,
      trend: {
        direction: trendDirection,
        strength: trendStrength,
        movingAverages: {
          sma20,
          sma50,
          sma200,
          priceVsSma20: currentPrice > sma20 ? 'above' : 'below',
          priceVsSma50: currentPrice > sma50 ? 'above' : 'below',
        },
      },
      momentum: {
        rsi14,
        condition: rsiCondition,
        divergence: 'none', // Would need more complex analysis
      },
      volatility: {
        atr14,
        atrPercent,
        regime: volatilityRegime,
        compression,
      },
      levels: {
        currentPrice,
        support,
        resistance,
        vwap: null, // Would need intraday data
        pivotPoint,
      },
    };
  } catch (error) {
    logger.warn(`Error analyzing technicals for ${symbol}:`, error);
    
    // Return minimal technical analysis
    const quote = await fetchStockPrice(symbol);
    const currentPrice = quote?.currentPrice || 0;

    return {
      symbol,
      trend: {
        direction: 'sideways',
        strength: 'none',
        movingAverages: {
          sma20: currentPrice,
          sma50: currentPrice,
          sma200: currentPrice,
          priceVsSma20: 'above',
          priceVsSma50: 'above',
        },
      },
      momentum: {
        rsi14: 50,
        condition: 'neutral',
        divergence: 'none',
      },
      volatility: {
        atr14: 0,
        atrPercent: 0,
        regime: 'normal',
        compression: false,
      },
      levels: {
        currentPrice,
        support: [currentPrice * 0.98],
        resistance: [currentPrice * 1.02],
        vwap: null,
        pivotPoint: currentPrice,
      },
    };
  }
}

// =============================================================================
// CONFLUENCE VALIDATION ENGINE
// =============================================================================

/**
 * Validate confluence between fundamental and technical analysis
 * Integrates volatility context for regime-aware validation
 */
export function validateConfluence(
  fundamental: FundamentalAnalysis,
  technical: TechnicalAnalysis,
  volatilityContext?: VolatilityAnalysis | null,
  marketContext?: MarketContext | null
): ConfluenceResult {
  const checks: { name: string; passed: boolean; detail: string }[] = [];
  const warnings: string[] = [];
  let score = 0;

  // Determine technical bias
  let technicalBias: Bias = 'neutral';
  if (technical.trend.direction === 'up' && technical.momentum.condition !== 'overbought') {
    technicalBias = 'bullish';
  } else if (technical.trend.direction === 'down' && technical.momentum.condition !== 'oversold') {
    technicalBias = 'bearish';
  }

  // Check 1: Fundamental and Technical Bias Alignment
  const biasAligned = fundamental.bias === technicalBias || 
                      fundamental.bias === 'neutral' || 
                      technicalBias === 'neutral';
  checks.push({
    name: 'Bias Alignment',
    passed: biasAligned,
    detail: biasAligned 
      ? `Fundamental (${fundamental.bias}) aligns with Technical (${technicalBias})`
      : `Conflict: Fundamental ${fundamental.bias} vs Technical ${technicalBias}`,
  });
  if (biasAligned) score += 25;
  if (!biasAligned) warnings.push('⚠️ Fundamental and technical signals conflict');

  // Check 2: Trend Confirmation
  const trendConfirmed = technical.trend.strength !== 'none';
  checks.push({
    name: 'Trend Confirmation',
    passed: trendConfirmed,
    detail: trendConfirmed
      ? `${technical.trend.strength} ${technical.trend.direction} trend confirmed`
      : 'No clear trend established',
  });
  if (trendConfirmed) score += 20;

  // Check 3: Momentum Not Extreme
  const momentumHealthy = technical.momentum.condition === 'neutral';
  checks.push({
    name: 'Momentum Health',
    passed: momentumHealthy,
    detail: momentumHealthy
      ? `RSI ${technical.momentum.rsi14.toFixed(0)} - healthy range`
      : `RSI ${technical.momentum.rsi14.toFixed(0)} - ${technical.momentum.condition}`,
  });
  if (momentumHealthy) score += 15;
  if (technical.momentum.condition === 'overbought' && fundamental.bias === 'bullish') {
    warnings.push('⚠️ RSI overbought - consider waiting for pullback');
  }
  if (technical.momentum.condition === 'oversold' && fundamental.bias === 'bearish') {
    warnings.push('⚠️ RSI oversold - consider waiting for bounce');
  }

  // Check 4: Volatility Allows Trade
  const volatilityOk = technical.volatility.regime !== 'extreme';
  checks.push({
    name: 'Volatility Environment',
    passed: volatilityOk,
    detail: volatilityOk
      ? `${technical.volatility.regime} volatility (ATR ${technical.volatility.atrPercent.toFixed(2)}%)`
      : 'Extreme volatility - increased risk',
  });
  if (volatilityOk) score += 15;
  if (!volatilityOk) warnings.push('⚠️ Extreme volatility - reduce position size');

  // Check 5: Price at Key Level
  const currentPrice = technical.levels.currentPrice;
  const nearSupport = technical.levels.support.some(s => Math.abs(currentPrice - s) / currentPrice < 0.02);
  const nearResistance = technical.levels.resistance.some(r => Math.abs(currentPrice - r) / currentPrice < 0.02);
  const atKeyLevel = nearSupport || nearResistance;
  checks.push({
    name: 'Key Level Proximity',
    passed: atKeyLevel,
    detail: atKeyLevel
      ? nearSupport ? 'Near support - good long entry zone' : 'Near resistance - good short entry zone'
      : 'Not at a key technical level',
  });
  if (atKeyLevel) score += 15;

  // Check 6: Conviction Level
  const highConviction = fundamental.conviction >= 60;
  checks.push({
    name: 'Conviction Level',
    passed: highConviction,
    detail: `Fundamental conviction: ${fundamental.conviction}%`,
  });
  if (highConviction) score += 10;

  // Check 7: IV/Volatility Context (if available)
  if (volatilityContext) {
    const ivContextOk = volatilityContext.recommendation !== 'sell_premium' || fundamental.asset !== 'options';
    checks.push({
      name: 'IV Context',
      passed: ivContextOk,
      detail: `IV Rank ${volatilityContext.ivRank?.toFixed(0) || 'N/A'}% - ${volatilityContext.recommendation || 'neutral'}`,
    });
    if (ivContextOk) score += 5;
    
    // Warn if IV suggests against trade direction
    if (volatilityContext.recommendation === 'sell_premium' && fundamental.asset === 'options') {
      warnings.push('⚠️ High IV - consider selling premium instead of buying');
    }
  }

  // Check 8: Market Context (if available)
  if (marketContext) {
    const marketAllowsTrade = marketContext.shouldTrade !== false;
    if (!marketAllowsTrade) {
      warnings.push('⚠️ Market context advises against trading: ' + (marketContext.reasons?.join(', ') || 'unfavorable conditions'));
      score -= 10; // Penalty for adverse market context
    }
  }

  // Determine overall alignment
  let alignment: 'strong' | 'moderate' | 'weak' | 'conflict' = 'weak';
  if (score >= 80 && biasAligned) alignment = 'strong';
  else if (score >= 60 && biasAligned) alignment = 'moderate';
  else if (!biasAligned) alignment = 'conflict';

  // Generate recommendation
  let recommendation = '';
  if (alignment === 'strong') {
    recommendation = `Strong confluence for ${fundamental.bias} trade. Entry conditions favorable.`;
  } else if (alignment === 'moderate') {
    recommendation = `Moderate confluence. Consider smaller position or wait for better setup.`;
  } else if (alignment === 'weak') {
    recommendation = `Weak confluence. Not recommended for entry. Wait for alignment.`;
  } else {
    recommendation = `Conflicting signals. Do not trade. Fundamental says ${fundamental.bias}, technical says ${technicalBias}.`;
  }

  return {
    isValid: alignment === 'strong' || alignment === 'moderate',
    score,
    alignment,
    fundamentalBias: fundamental.bias,
    technicalBias,
    checks,
    recommendation,
    warnings,
  };
}

// =============================================================================
// TRADE STRUCTURE GENERATOR
// =============================================================================

/**
 * Generate trade structure with entry, stop, and targets
 * Validates inputs and handles edge cases
 */
export function generateTradeStructure(
  symbol: string,
  fundamental: FundamentalAnalysis,
  technical: TechnicalAnalysis,
  confluence: ConfluenceResult,
  accountSize: number = 1000
): TradeStructure | null {
  // Don't generate structure for invalid confluence
  if (!confluence.isValid) {
    return null;
  }

  const currentPrice = technical.levels.currentPrice;
  let atr = technical.volatility.atr14;

  // Validate critical inputs - reject if data is insufficient
  if (!currentPrice || currentPrice <= 0) {
    logger.warn(`[TradingEngine] Cannot generate trade structure: invalid price for ${symbol}`);
    return null;
  }

  // Handle zero or missing ATR - use percentage-based fallback
  if (!atr || atr <= 0) {
    atr = currentPrice * 0.02; // Use 2% as fallback ATR
    logger.info(`[TradingEngine] Using fallback ATR (2%) for ${symbol}`);
  }

  // Validate account size
  if (accountSize < 100) {
    logger.warn(`[TradingEngine] Account size too small: ${accountSize}`);
    return null;
  }

  const direction: 'long' | 'short' = fundamental.bias === 'bearish' ? 'short' : 'long';

  // Entry calculation
  let entryPrice = currentPrice;
  let entryRationale = '';

  if (direction === 'long') {
    // For longs, prefer entry at support or pullback
    const nearestSupport = technical.levels.support[0] || currentPrice * 0.98;
    if (nearestSupport > currentPrice * 0.97) {
      entryPrice = nearestSupport;
      entryRationale = `Entry at support level $${nearestSupport.toFixed(2)}`;
    } else {
      entryPrice = currentPrice;
      entryRationale = `Market entry at current price $${currentPrice.toFixed(2)}`;
    }
  } else {
    // For shorts, prefer entry at resistance
    const nearestResistance = technical.levels.resistance[0] || currentPrice * 1.02;
    if (nearestResistance < currentPrice * 1.03) {
      entryPrice = nearestResistance;
      entryRationale = `Entry at resistance level $${nearestResistance.toFixed(2)}`;
    } else {
      entryPrice = currentPrice;
      entryRationale = `Market entry at current price $${currentPrice.toFixed(2)}`;
    }
  }

  // Stop calculation (1.5 ATR from entry)
  const stopDistance = atr * 1.5;
  let stopPrice = direction === 'long' 
    ? entryPrice - stopDistance 
    : entryPrice + stopDistance;

  // Ensure stop is below support (long) or above resistance (short)
  if (direction === 'long' && technical.levels.support[0]) {
    stopPrice = Math.min(stopPrice, technical.levels.support[0] * 0.99);
  } else if (direction === 'short' && technical.levels.resistance[0]) {
    stopPrice = Math.max(stopPrice, technical.levels.resistance[0] * 1.01);
  }

  const stopRationale = `Stop 1.5 ATR ($${atr.toFixed(2)}) from entry at $${stopPrice.toFixed(2)}`;

  // Target calculation
  const riskPerShare = Math.abs(entryPrice - stopPrice);
  const targets = [
    {
      price: direction === 'long' ? entryPrice + riskPerShare * 2 : entryPrice - riskPerShare * 2,
      probability: 60,
      rationale: '2:1 R:R target',
    },
    {
      price: direction === 'long' ? entryPrice + riskPerShare * 3 : entryPrice - riskPerShare * 3,
      probability: 40,
      rationale: '3:1 R:R target',
    },
  ];

  // Use nearest resistance/support as primary target if better
  if (direction === 'long' && technical.levels.resistance[0]) {
    const resistanceTarget = technical.levels.resistance[0];
    if (resistanceTarget > entryPrice && resistanceTarget < targets[0].price) {
      targets.unshift({
        price: resistanceTarget,
        probability: 70,
        rationale: 'Resistance level target',
      });
    }
  }

  // Position sizing (risk 2% of account)
  const riskPercent = 2;
  const dollarRisk = accountSize * (riskPercent / 100);
  const shares = Math.floor(dollarRisk / riskPerShare);
  const riskReward = (targets[0].price - entryPrice) / riskPerShare;

  // Determine structure type
  let structure = direction === 'long' ? 'Long shares' : 'Short shares';
  if (fundamental.asset === 'options') {
    structure = direction === 'long' 
      ? 'Long call or call debit spread' 
      : 'Long put or put debit spread';
  } else if (fundamental.asset === 'futures') {
    structure = direction === 'long' ? 'Long futures contract' : 'Short futures contract';
  }

  // Invalidation point
  const invalidation = direction === 'long'
    ? `Trade invalid if price closes below $${stopPrice.toFixed(2)}`
    : `Trade invalid if price closes above $${stopPrice.toFixed(2)}`;

  return {
    symbol,
    direction,
    entry: {
      price: entryPrice,
      type: entryPrice === currentPrice ? 'market' : 'limit',
      rationale: entryRationale,
    },
    stop: {
      price: stopPrice,
      type: 'technical',
      rationale: stopRationale,
    },
    targets,
    riskReward: Math.abs(riskReward),
    positionSize: {
      riskPercent,
      shares,
      dollarRisk,
    },
    structure,
    timeframe: fundamental.timeHorizon === 'short' ? '1-5 days' : 
               fundamental.timeHorizon === 'medium' ? '1-4 weeks' : '1-3 months',
    invalidation,
  };
}

// =============================================================================
// MAIN TRADING ENGINE
// =============================================================================

/**
 * Run complete trading engine analysis
 */
export async function runTradingEngine(
  symbol: string,
  assetClass: AssetClass,
  accountSize: number = 1000
): Promise<TradingEngineResult> {
  logger.info(`🎯 Trading Engine analyzing ${symbol} (${assetClass})`);

  // Run all analyses in parallel
  const [fundamentalResult, technical, volatilityContext, marketContext] = await Promise.all([
    analyzeFundamentals(symbol, assetClass),
    analyzeTechnicals(symbol),
    analyzeVolatility(symbol).catch(() => null),
    getMarketContext(),
  ]);

  // Extract fundamental and news context
  const { fundamental, newsContext } = fundamentalResult;

  // Validate confluence with volatility and market context for regime-aware gating
  const confluence = validateConfluence(fundamental, technical, volatilityContext, marketContext);

  // Generate trade structure if valid
  const tradeStructure = generateTradeStructure(symbol, fundamental, technical, confluence, accountSize);

  // Determine if actionable - consider market context gating
  const marketAllowsTrade = marketContext.shouldTrade !== false;
  const actionable = confluence.isValid && 
                     confluence.alignment !== 'conflict' && 
                     fundamental.conviction >= 50 &&
                     marketAllowsTrade;

  // Generate summary
  let summary = '';
  if (actionable && tradeStructure) {
    summary = `✅ ${symbol}: ${tradeStructure.direction.toUpperCase()} setup. ` +
              `Entry $${tradeStructure.entry.price.toFixed(2)}, ` +
              `Stop $${tradeStructure.stop.price.toFixed(2)}, ` +
              `Target $${tradeStructure.targets[0].price.toFixed(2)} ` +
              `(${tradeStructure.riskReward.toFixed(1)}:1 R:R)`;
  } else if (confluence.alignment === 'conflict') {
    summary = `⚠️ ${symbol}: Conflicting signals. ` +
              `Fundamental: ${fundamental.bias}, Technical: ${confluence.technicalBias}. ` +
              `Wait for alignment.`;
  } else {
    summary = `⏸️ ${symbol}: No clear setup. ` +
              `Confluence score ${confluence.score}/100. ` +
              `${confluence.recommendation}`;
  }

  return {
    symbol,
    assetClass,
    timestamp: new Date().toISOString(),
    fundamental,
    technical,
    confluence,
    tradeStructure,
    volatilityContext,
    marketContext,
    newsContext,
    actionable,
    summary,
  };
}

/**
 * Quick scan for multiple symbols
 */
export async function scanSymbols(
  symbols: string[],
  assetClass: AssetClass
): Promise<TradingEngineResult[]> {
  const results: TradingEngineResult[] = [];

  for (const symbol of symbols) {
    try {
      const result = await runTradingEngine(symbol, assetClass);
      results.push(result);
    } catch (error) {
      logger.warn(`Error scanning ${symbol}:`, error);
    }
  }

  // Sort by actionability and confluence score
  return results.sort((a, b) => {
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    return b.confluence.score - a.confluence.score;
  });
}
