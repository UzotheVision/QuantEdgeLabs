import { storage } from "./storage";
import { logger } from "./logger";

const POLYMARKET_API_BASE = "https://gamma-api.polymarket.com";
const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

interface PolymarketEvent {
  id: string;
  title: string;
  slug: string;
  description: string;
  startDate: string;
  endDate: string;
  markets: PolymarketMarket[];
  volume: number;
  liquidity: number;
  category: string;
}

interface PolymarketMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: number;
  liquidity: number;
  endDate: string;
  active: boolean;
  closed: boolean;
  description: string;
}

interface PredictionOpportunity {
  marketId: string;
  question: string;
  currentPrice: number;
  outcome: string;
  predictedProbability: number;
  edge: number;
  confidence: number;
  newsSource: string;
  newsTitle: string;
  reasoning: string;
  category: string;
  volume: number;
  liquidity: number;
  expiryDate: string;
}

interface NewsSignal {
  ticker?: string;
  headline: string;
  summary: string;
  sentiment: number;
  keywords: string[];
  relevantMarkets: string[];
}

const PREDICTION_CATEGORIES = [
  'politics',
  'crypto',
  'finance',
  'sports',
  'pop-culture',
  'tech',
  'world-affairs',
  'us-elections'
];

const ARBITRAGE_KEYWORDS = {
  politics: ['election', 'president', 'congress', 'senate', 'vote', 'poll', 'debate', 'campaign', 'primary', 'nominee'],
  crypto: ['bitcoin', 'ethereum', 'btc', 'eth', 'crypto', 'blockchain', 'sec', 'etf', 'regulation', 'halving'],
  finance: ['fed', 'interest rate', 'inflation', 'gdp', 'unemployment', 'recession', 'market', 'stock', 'earnings'],
  tech: ['ai', 'openai', 'google', 'apple', 'microsoft', 'tesla', 'spacex', 'launch', 'ipo'],
  sports: ['superbowl', 'nfl', 'nba', 'mlb', 'championship', 'playoffs', 'finals', 'world series'],
};

export async function fetchPolymarketEvents(category?: string, limit: number = 50): Promise<PolymarketEvent[]> {
  try {
    const params = new URLSearchParams({
      limit: limit.toString(),
      active: 'true',
      closed: 'false',
      order: 'volume',
      ascending: 'false'
    });
    
    if (category) {
      params.append('tag', category);
    }
    
    const url = `${POLYMARKET_API_BASE}/events?${params}`;
    logger.info(`[POLYMARKET] Fetching events: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'QuantEdgeLabs/1.0'
      }
    });
    
    if (!response.ok) {
      logger.error(`[POLYMARKET] API error: HTTP ${response.status}`);
      return [];
    }
    
    const events = await response.json();
    logger.info(`[POLYMARKET] Fetched ${events.length} active events`);
    return events;
  } catch (error) {
    logger.error(`[POLYMARKET] Failed to fetch events:`, error);
    return [];
  }
}

export async function fetchMarketById(marketId: string): Promise<PolymarketMarket | null> {
  try {
    const url = `${POLYMARKET_API_BASE}/markets/${marketId}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'QuantEdgeLabs/1.0'
      }
    });
    
    if (!response.ok) {
      return null;
    }
    
    return await response.json();
  } catch (error) {
    logger.error(`[POLYMARKET] Failed to fetch market ${marketId}:`, error);
    return null;
  }
}

export async function fetchTrendingMarkets(limit: number = 20): Promise<PolymarketMarket[]> {
  try {
    const params = new URLSearchParams({
      limit: limit.toString(),
      active: 'true',
      closed: 'false',
      order: 'volume24hr',
      ascending: 'false'
    });
    
    const url = `${POLYMARKET_API_BASE}/markets?${params}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'QuantEdgeLabs/1.0'
      }
    });
    
    if (!response.ok) {
      return [];
    }
    
    const markets = await response.json();
    logger.info(`[POLYMARKET] Fetched ${markets.length} trending markets`);
    return markets;
  } catch (error) {
    logger.error(`[POLYMARKET] Failed to fetch trending markets:`, error);
    return [];
  }
}

export function matchNewsToMarkets(newsSignal: NewsSignal, markets: PolymarketMarket[]): PolymarketMarket[] {
  const matchedMarkets: PolymarketMarket[] = [];
  const headlineLower = (newsSignal.headline || '').toLowerCase();
  const summaryLower = (newsSignal.summary || '').toLowerCase();
  const combinedText = `${headlineLower} ${summaryLower}`;
  const keywords = newsSignal.keywords ?? [];
  
  for (const market of markets) {
    const questionLower = market.question.toLowerCase();
    const descriptionLower = (market.description || '').toLowerCase();
    
    let matchScore = 0;
    
    for (const keyword of keywords) {
      if (questionLower.includes(keyword.toLowerCase())) {
        matchScore += 3;
      }
      if (descriptionLower.includes(keyword.toLowerCase())) {
        matchScore += 1;
      }
    }
    
    for (const [category, keywords] of Object.entries(ARBITRAGE_KEYWORDS)) {
      for (const keyword of keywords) {
        if (combinedText.includes(keyword) && questionLower.includes(keyword)) {
          matchScore += 2;
        }
      }
    }
    
    if (matchScore >= 3) {
      matchedMarkets.push(market);
    }
  }
  
  return matchedMarkets;
}

export async function analyzeArbitrageOpportunity(
  market: PolymarketMarket,
  newsSignal: NewsSignal
): Promise<PredictionOpportunity | null> {
  try {
    const prices = market.outcomePrices.map(p => parseFloat(p));
    const outcomes = market.outcomes;
    
    if (prices.length !== 2 || outcomes.length !== 2) {
      return null;
    }
    
    const [yesPrice, noPrice] = prices;
    const sentimentDirection = newsSignal.sentiment > 0 ? 'YES' : 'NO';
    const sentimentStrength = Math.abs(newsSignal.sentiment);
    
    const predictedProbChange = sentimentStrength * 0.15;
    let predictedYesProbability: number;
    let edge: number;
    let targetOutcome: string;
    let targetPrice: number;
    
    if (sentimentDirection === 'YES') {
      predictedYesProbability = Math.min(0.95, yesPrice + predictedProbChange);
      edge = predictedYesProbability - yesPrice;
      targetOutcome = 'YES';
      targetPrice = yesPrice;
    } else {
      predictedYesProbability = Math.max(0.05, yesPrice - predictedProbChange);
      edge = yesPrice - predictedYesProbability;
      targetOutcome = 'NO';
      targetPrice = noPrice;
    }
    
    if (edge < 0.03) {
      return null;
    }
    
    const confidence = Math.min(95, 50 + (edge * 100) + (sentimentStrength * 30));
    
    return {
      marketId: market.id,
      question: market.question,
      currentPrice: targetPrice,
      outcome: targetOutcome,
      predictedProbability: sentimentDirection === 'YES' ? predictedYesProbability : 1 - predictedYesProbability,
      edge: edge,
      confidence: Math.round(confidence),
      newsSource: 'Alpha Vantage',
      newsTitle: newsSignal.headline,
      reasoning: `${sentimentDirection === 'YES' ? 'Bullish' : 'Bearish'} news sentiment (${(sentimentStrength * 100).toFixed(0)}%) suggests ${targetOutcome} outcome probability is higher than market price of ${(targetPrice * 100).toFixed(1)}%. Edge: ${(edge * 100).toFixed(1)}%`,
      category: detectCategory(market.question),
      volume: market.volume,
      liquidity: market.liquidity,
      expiryDate: market.endDate,
    };
  } catch (error) {
    logger.error(`[POLYMARKET] Failed to analyze arbitrage for ${market.id}:`, error);
    return null;
  }
}

function detectCategory(question: string): string {
  const lowerQuestion = question.toLowerCase();
  
  for (const [category, keywords] of Object.entries(ARBITRAGE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerQuestion.includes(keyword)) {
        return category;
      }
    }
  }
  
  return 'other';
}

export async function generatePredictionSignal(opportunity: PredictionOpportunity): Promise<{
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  analysis: string;
  catalyst: string;
  confidence: number;
  assetType: 'prediction';
} | null> {
  if (opportunity.confidence < 55) {
    return null;
  }
  
  const symbol = `POLY-${opportunity.marketId.slice(0, 8).toUpperCase()}`;
  const direction: 'long' | 'short' = opportunity.outcome === 'YES' ? 'long' : 'short';
  const entryPrice = opportunity.currentPrice;
  
  const targetPrice = direction === 'long' 
    ? Math.min(0.95, entryPrice + opportunity.edge)
    : Math.max(0.05, entryPrice - opportunity.edge);
  
  const stopLoss = direction === 'long'
    ? Math.max(0.01, entryPrice - (opportunity.edge * 0.5))
    : Math.min(0.99, entryPrice + (opportunity.edge * 0.5));
  
  const riskReward = Math.abs(targetPrice - entryPrice) / Math.abs(entryPrice - stopLoss);
  
  if (riskReward < 1.5) {
    return null;
  }
  
  return {
    symbol,
    direction,
    entryPrice,
    targetPrice,
    stopLoss,
    analysis: `[PREDICTION MARKET] ${opportunity.question}\n\n${opportunity.reasoning}\n\nVolume: $${opportunity.volume.toLocaleString()} | Liquidity: $${opportunity.liquidity.toLocaleString()}`,
    catalyst: opportunity.newsTitle,
    confidence: opportunity.confidence,
    assetType: 'prediction'
  };
}

export async function scanForPredictionOpportunities(
  newsArticles: Array<{
    title: string;
    summary: string;
    overallSentimentScore: number;
    tickerSentiments?: Array<{ ticker: string }>;
  }>
): Promise<PredictionOpportunity[]> {
  logger.info(`[POLYMARKET] Scanning for prediction opportunities from ${newsArticles.length} news articles`);
  
  const trendingMarkets = await fetchTrendingMarkets(50);
  
  if (trendingMarkets.length === 0) {
    logger.warn(`[POLYMARKET] No trending markets available`);
    return [];
  }
  
  const opportunities: PredictionOpportunity[] = [];
  
  for (const article of newsArticles) {
    const newsSignal: NewsSignal = {
      headline: article.title,
      summary: article.summary,
      sentiment: article.overallSentimentScore,
      keywords: extractKeywords(article.title + ' ' + article.summary),
      relevantMarkets: [],
      ticker: article.tickerSentiments?.[0]?.ticker
    };
    
    const matchedMarkets = matchNewsToMarkets(newsSignal, trendingMarkets);
    
    for (const market of matchedMarkets) {
      const opportunity = await analyzeArbitrageOpportunity(market, newsSignal);
      if (opportunity && opportunity.edge >= 0.05 && opportunity.confidence >= 55) {
        opportunities.push(opportunity);
        logger.info(`[POLYMARKET] Found opportunity: ${market.question.slice(0, 50)}... Edge: ${(opportunity.edge * 100).toFixed(1)}%`);
      }
    }
  }
  
  opportunities.sort((a, b) => b.edge - a.edge);
  
  logger.info(`[POLYMARKET] Found ${opportunities.length} prediction opportunities`);
  return opportunities.slice(0, 10);
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'will', 'be', 'been', 'has', 'have', 'had', 'do', 'does', 'did', 'but', 'or', 'and', 'for', 'with', 'at', 'by', 'from', 'to', 'in', 'on', 'of', 'that', 'this', 'it', 'its', 'as', 'can', 'could', 'would', 'should', 'may', 'might']);
  
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word));
  
  const wordCounts = new Map<string, number>();
  for (const word of words) {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  }
  
  return Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);
}

export async function createPredictionPaperTrade(opportunity: PredictionOpportunity): Promise<boolean> {
  try {
    const signal = await generatePredictionSignal(opportunity);
    if (!signal) {
      return false;
    }
    
    const riskReward = Math.abs(signal.targetPrice - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopLoss);
    
    await storage.createTradeIdea({
      symbol: signal.symbol,
      assetType: 'prediction',
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      targetPrice: signal.targetPrice,
      stopLoss: signal.stopLoss,
      analysis: signal.analysis,
      catalyst: signal.catalyst,
      confidenceScore: signal.confidence,
      riskRewardRatio: riskReward,
      source: 'prediction-market',
      engineVersion: '3.0',
      outcomeStatus: 'open',
      sessionContext: 'Prediction market paper trade',
      timestamp: new Date().toISOString(),
    });
    
    logger.info(`[POLYMARKET] Created paper trade for ${signal.symbol}: ${signal.direction.toUpperCase()} @ ${signal.entryPrice}`);
    return true;
  } catch (error) {
    logger.error(`[POLYMARKET] Failed to create paper trade:`, error);
    return false;
  }
}

export async function runPredictionMarketScan(): Promise<void> {
  logger.info(`[POLYMARKET] Starting prediction market scan...`);
  
  try {
    const { fetchBreakingNews } = await import('./news-service');
    const breakingNews = await fetchBreakingNews(undefined, undefined, 20);
    
    if (breakingNews.length === 0) {
      logger.info(`[POLYMARKET] No breaking news to analyze`);
      return;
    }
    
    const opportunities = await scanForPredictionOpportunities(breakingNews);
    
    if (opportunities.length === 0) {
      logger.info(`[POLYMARKET] No prediction opportunities found`);
      return;
    }
    
    const bestOpportunity = opportunities[0];
    logger.info(`[POLYMARKET] Best opportunity: ${bestOpportunity.question.slice(0, 60)}... (${(bestOpportunity.edge * 100).toFixed(1)}% edge)`);
    
    const created = await createPredictionPaperTrade(bestOpportunity);
    if (created) {
      logger.info(`[POLYMARKET] Paper trade created successfully`);
    }
  } catch (error) {
    logger.error(`[POLYMARKET] Scan failed:`, error);
  }
}
