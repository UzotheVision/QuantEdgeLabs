/**
 * Social Sentiment Scanner
 * 
 * Monitors Twitter/X, Reddit/WSB, and StockTwits for ticker mentions,
 * sentiment analysis, and trending stocks.
 * 
 * LIVE DATA SOURCES:
 * - Tradestie API: https://api.tradestie.com/v1/apps/reddit (Top 50 WSB stocks)
 * - ApeWisdom API: https://apewisdom.io/api/v1.0/filter/wallstreetbets (WSB trending)
 */

import { logger } from './logger';
import { postDiscordWebhook } from './discord-service';

interface SocialMention {
  id: string;
  symbol: string;
  platform: 'twitter' | 'reddit' | 'stocktwits' | 'wsb';
  content: string;
  author: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number; // -100 to 100
  engagement: {
    likes: number;
    comments: number;
    shares: number;
  };
  timestamp: string;
  url: string | null;
}

interface TrendingTicker {
  symbol: string;
  mentionCount: number;
  sentimentScore: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  change24h: number;
  topMentions: SocialMention[];
  source: 'tradestie' | 'apewisdom' | 'combined';
  rank?: number;
}

interface ScannerStatus {
  isActive: boolean;
  lastScan: string | null;
  lastSuccessfulFetch: string | null;
  mentionsFound: number;
  trendingTickers: TrendingTicker[];
  recentMentions: SocialMention[];
  wsbTrending: TrendingTicker[];
  apiStatus: {
    tradestie: 'ok' | 'error' | 'unknown';
    apewisdom: 'ok' | 'error' | 'unknown';
  };
  settings: {
    watchlist: string[];
    platforms: ('twitter' | 'reddit' | 'stocktwits' | 'wsb')[];
    minEngagement: number;
    updateInterval: number; // minutes
  };
}

// Expanded watchlist with popular trading stocks
const EXPANDED_WATCHLIST = [
  // Mega caps
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'BRK.B',
  // Popular trading stocks
  'AMD', 'PLTR', 'SOFI', 'HOOD', 'COIN', 'MARA', 'RIOT', 'CLSK',
  'SMCI', 'ARM', 'MSTR', 'IONQ', 'RGTI', 'QBTS', 'SOUN', 'RKLB',
  // Meme stocks
  'GME', 'AMC', 'BBBY', 'BB', 'NOK', 'WISH', 'CLOV', 'SPCE',
  // EV/Tech
  'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'GOEV', 'NKLA',
  // AI/Cloud
  'SNOW', 'CRWD', 'NET', 'DDOG', 'ZS', 'PANW', 'PATH', 'AI',
  // Biotech/Pharma
  'MRNA', 'BNTX', 'PFE', 'NVAX', 'ARCT',
  // Space/Defense
  'ASTS', 'LUNR', 'RDW', 'VORB', 'RCAT',
  // ETFs
  'SPY', 'QQQ', 'IWM', 'SOXL', 'TQQQ', 'ARKK',
  // Crypto proxies
  'BTC', 'ETH', 'XRP', 'SOL', 'DOGE',
  // Energy/Nuclear
  'SMR', 'OKLO', 'NNE', 'CCJ', 'UEC', 'LEU',
  // Options favorites
  'NVDA', 'SPX', 'AAPL', 'TSLA', 'AMD', 'META'
];

let scannerStatus: ScannerStatus = {
  isActive: true,
  lastScan: null,
  lastSuccessfulFetch: null,
  mentionsFound: 0,
  trendingTickers: [],
  recentMentions: [],
  wsbTrending: [],
  apiStatus: {
    tradestie: 'unknown',
    apewisdom: 'unknown'
  },
  settings: {
    watchlist: EXPANDED_WATCHLIST,
    platforms: ['twitter', 'reddit', 'stocktwits', 'wsb'],
    minEngagement: 10,
    updateInterval: 15,
  },
};

// Sentiment keywords for basic analysis
const BULLISH_KEYWORDS = [
  'buy', 'long', 'moon', 'bullish', 'calls', 'pump', 'breakout', 'upside', 'rocket',
  'squeeze', 'undervalued', 'accumulate', 'green', 'rally', 'bounce', 'support',
  'higher', 'strong', 'earnings beat', 'upgraded', 'outperform'
];

const BEARISH_KEYWORDS = [
  'sell', 'short', 'puts', 'bearish', 'dump', 'crash', 'overvalued', 'downside',
  'breakdown', 'resistance', 'weak', 'lower', 'drop', 'red', 'fade', 'downgrade',
  'miss', 'disappointing', 'sell-off', 'panic'
];

/**
 * Analyze sentiment of text
 */
function analyzeSentiment(text: string): { sentiment: 'bullish' | 'bearish' | 'neutral'; score: number } {
  const lowerText = text.toLowerCase();
  
  let bullishScore = 0;
  let bearishScore = 0;
  
  for (const keyword of BULLISH_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      bullishScore += 10;
    }
  }
  
  for (const keyword of BEARISH_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      bearishScore += 10;
    }
  }
  
  // Amplify for strong language
  if (lowerText.includes('!')) {
    bullishScore *= 1.2;
    bearishScore *= 1.2;
  }
  if (lowerText.includes('🚀') || lowerText.includes('📈')) {
    bullishScore += 15;
  }
  if (lowerText.includes('📉') || lowerText.includes('💀')) {
    bearishScore += 15;
  }
  
  const netScore = bullishScore - bearishScore;
  const normalizedScore = Math.max(-100, Math.min(100, netScore));
  
  let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (normalizedScore > 15) sentiment = 'bullish';
  else if (normalizedScore < -15) sentiment = 'bearish';
  
  return { sentiment, score: normalizedScore };
}

/**
 * Extract ticker symbols from text
 */
function extractTickers(text: string): string[] {
  // Match $TICKER or just TICKER patterns
  const tickerRegex = /\$([A-Z]{1,5})\b|\b([A-Z]{2,5})\b/g;
  const tickers: string[] = [];
  
  let match;
  while ((match = tickerRegex.exec(text)) !== null) {
    const ticker = match[1] || match[2];
    if (ticker && scannerStatus.settings.watchlist.includes(ticker)) {
      tickers.push(ticker);
    }
  }
  
  return Array.from(new Set(tickers));
}

// Tradestie API response interface
interface TradestieStock {
  ticker: string;
  no_of_comments: number;
  sentiment: string;
  sentiment_score: number;
}

// ApeWisdom API response interface
interface ApeWisdomResponse {
  count: number;
  pages: number;
  current_page: number;
  results: {
    rank: number;
    ticker: string;
    name: string;
    mentions: string;
    upvotes: string;
    rank_24h_ago: string;
    mentions_24h_ago: string;
  }[];
}

/**
 * Fetch trending stocks from Tradestie WSB API
 * https://api.tradestie.com/v1/apps/reddit
 */
async function fetchTradestieWSB(): Promise<TrendingTicker[]> {
  try {
    const response = await fetch('https://api.tradestie.com/v1/apps/reddit', {
      headers: {
        'User-Agent': 'QuantEdge-Trading-Platform/1.0',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      logger.warn(`[SOCIAL-SENTIMENT] Tradestie API returned ${response.status}`);
      scannerStatus.apiStatus.tradestie = 'error';
      return [];
    }
    
    const data: TradestieStock[] = await response.json();
    scannerStatus.apiStatus.tradestie = 'ok';
    
    logger.info(`[SOCIAL-SENTIMENT] Tradestie: Found ${data.length} WSB trending stocks`);
    
    return data.map((stock, index) => {
      const sentimentType = stock.sentiment?.toLowerCase() === 'bullish' 
        ? 'bullish' 
        : stock.sentiment?.toLowerCase() === 'bearish' 
          ? 'bearish' 
          : 'neutral';
      
      return {
        symbol: stock.ticker,
        mentionCount: stock.no_of_comments || 0,
        sentimentScore: Math.round((stock.sentiment_score || 0) * 100),
        sentiment: sentimentType,
        change24h: 0,
        topMentions: [],
        source: 'tradestie' as const,
        rank: index + 1
      };
    });
  } catch (error) {
    logger.error('[SOCIAL-SENTIMENT] Tradestie API error:', error);
    scannerStatus.apiStatus.tradestie = 'error';
    return [];
  }
}

/**
 * Fetch trending stocks from ApeWisdom API
 * https://apewisdom.io/api/v1.0/filter/wallstreetbets
 */
async function fetchApeWisdomWSB(): Promise<TrendingTicker[]> {
  try {
    const response = await fetch('https://apewisdom.io/api/v1.0/filter/wallstreetbets', {
      headers: {
        'User-Agent': 'QuantEdge-Trading-Platform/1.0',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      logger.warn(`[SOCIAL-SENTIMENT] ApeWisdom API returned ${response.status}`);
      scannerStatus.apiStatus.apewisdom = 'error';
      return [];
    }
    
    const data: ApeWisdomResponse = await response.json();
    scannerStatus.apiStatus.apewisdom = 'ok';
    
    logger.info(`[SOCIAL-SENTIMENT] ApeWisdom: Found ${data.results?.length || 0} WSB trending stocks`);
    
    return (data.results || []).map((stock) => {
      const mentions = parseInt(stock.mentions) || 0;
      const mentions24hAgo = parseInt(stock.mentions_24h_ago) || 0;
      const momentumChange = mentions24hAgo > 0 ? ((mentions - mentions24hAgo) / mentions24hAgo) * 100 : 0;
      
      // Higher mentions = more bullish sentiment assumption
      let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      if (momentumChange > 50) sentiment = 'bullish';
      else if (momentumChange < -30) sentiment = 'bearish';
      
      return {
        symbol: stock.ticker,
        mentionCount: mentions,
        sentimentScore: Math.round(momentumChange),
        sentiment,
        change24h: momentumChange,
        topMentions: [],
        source: 'apewisdom' as const,
        rank: stock.rank
      };
    });
  } catch (error) {
    logger.error('[SOCIAL-SENTIMENT] ApeWisdom API error:', error);
    scannerStatus.apiStatus.apewisdom = 'error';
    return [];
  }
}

/**
 * Fetch all WSB trending stocks from multiple sources
 */
export async function fetchWSBTrending(): Promise<TrendingTicker[]> {
  logger.info('[SOCIAL-SENTIMENT] Fetching WSB trending from Tradestie + ApeWisdom...');
  
  const [tradestieData, apewisdomData] = await Promise.all([
    fetchTradestieWSB(),
    fetchApeWisdomWSB()
  ]);
  
  // Merge and dedupe by symbol, preferring Tradestie data (has actual sentiment)
  const symbolMap = new Map<string, TrendingTicker>();
  
  // Add Tradestie first (better sentiment data)
  for (const ticker of tradestieData) {
    symbolMap.set(ticker.symbol, ticker);
  }
  
  // Add ApeWisdom data if not already present
  for (const ticker of apewisdomData) {
    if (!symbolMap.has(ticker.symbol)) {
      symbolMap.set(ticker.symbol, ticker);
    } else {
      // Merge mention counts
      const existing = symbolMap.get(ticker.symbol)!;
      existing.mentionCount = Math.max(existing.mentionCount, ticker.mentionCount);
      existing.source = 'combined';
    }
  }
  
  // Sort by mention count
  const combined = Array.from(symbolMap.values())
    .sort((a, b) => b.mentionCount - a.mentionCount);
  
  // Update status
  scannerStatus.wsbTrending = combined;
  scannerStatus.lastSuccessfulFetch = new Date().toISOString();
  
  logger.info(`[SOCIAL-SENTIMENT] Combined WSB trending: ${combined.length} unique tickers`);
  
  // Add any new discovered tickers to watchlist
  for (const ticker of combined.slice(0, 30)) {
    if (!scannerStatus.settings.watchlist.includes(ticker.symbol)) {
      scannerStatus.settings.watchlist.push(ticker.symbol);
      logger.info(`[SOCIAL-SENTIMENT] Auto-added trending ticker: ${ticker.symbol}`);
    }
  }
  
  return combined;
}

/**
 * Get current WSB trending tickers
 */
export function getWSBTrending(): TrendingTicker[] {
  return [...scannerStatus.wsbTrending];
}

/**
 * Platform scanner - now with real WSB data
 */
async function scanPlatform(platform: 'twitter' | 'reddit' | 'stocktwits' | 'wsb'): Promise<SocialMention[]> {
  const mentions: SocialMention[] = [];
  
  if (platform === 'wsb' || platform === 'reddit') {
    // Get real WSB data
    const wsbTrending = await fetchWSBTrending();
    
    // Convert to mentions format
    for (const ticker of wsbTrending.slice(0, 50)) {
      mentions.push({
        id: `wsb_${ticker.symbol}_${Date.now()}`,
        symbol: ticker.symbol,
        platform: 'wsb',
        content: `${ticker.symbol} trending on WSB with ${ticker.mentionCount} mentions`,
        author: 'r/wallstreetbets',
        sentiment: ticker.sentiment,
        sentimentScore: ticker.sentimentScore,
        engagement: {
          likes: ticker.mentionCount * 10,
          comments: ticker.mentionCount,
          shares: Math.floor(ticker.mentionCount / 5)
        },
        timestamp: new Date().toISOString(),
        url: `https://reddit.com/r/wallstreetbets/search?q=${ticker.symbol}`
      });
    }
    
    logger.info(`[SOCIAL-SENTIMENT] WSB scan: ${mentions.length} trending tickers`);
  } else {
    logger.info(`[SOCIAL-SENTIMENT] Scanning ${platform}... (limited without API key)`);
  }
  
  return mentions;
}

/**
 * Scan all platforms for mentions
 */
export async function scanSocialSentiment(): Promise<{
  mentions: SocialMention[];
  trending: TrendingTicker[];
}> {
  if (!scannerStatus.isActive) {
    return { mentions: [], trending: [] };
  }
  
  logger.info('[SOCIAL-SENTIMENT] Starting social media scan...');
  scannerStatus.lastScan = new Date().toISOString();
  
  const allMentions: SocialMention[] = [];
  
  for (const platform of scannerStatus.settings.platforms) {
    try {
      const mentions = await scanPlatform(platform);
      allMentions.push(...mentions);
    } catch (error) {
      logger.warn(`[SOCIAL-SENTIMENT] Error scanning ${platform}:`, error);
    }
  }
  
  // Aggregate by ticker
  const tickerMap = new Map<string, {
    mentions: SocialMention[];
    totalScore: number;
    count: number;
  }>();
  
  for (const mention of allMentions) {
    const existing = tickerMap.get(mention.symbol) || { mentions: [], totalScore: 0, count: 0 };
    existing.mentions.push(mention);
    existing.totalScore += mention.sentimentScore;
    existing.count++;
    tickerMap.set(mention.symbol, existing);
  }
  
  // Create trending tickers
  const trending: TrendingTicker[] = [];
  tickerMap.forEach((data, symbol) => {
    const avgScore = data.count > 0 ? data.totalScore / data.count : 0;
    
    let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (avgScore > 20) sentiment = 'bullish';
    else if (avgScore < -20) sentiment = 'bearish';
    
    trending.push({
      symbol,
      mentionCount: data.count,
      sentimentScore: avgScore,
      sentiment,
      change24h: 0,
      topMentions: data.mentions.slice(0, 5),
      source: 'combined' as const,
    });
  });
  
  // Sort by mention count
  trending.sort((a, b) => b.mentionCount - a.mentionCount);
  
  // Update status
  scannerStatus.mentionsFound += allMentions.length;
  scannerStatus.trendingTickers = trending.slice(0, 20);
  scannerStatus.recentMentions = allMentions.slice(0, 100);
  
  logger.info(`[SOCIAL-SENTIMENT] Found ${allMentions.length} mentions, ${trending.length} tickers`);
  
  // Send alerts for high-activity tickers
  if (trending.length > 0) {
    await sendTrendingAlerts(trending.slice(0, 5));
  }
  
  return { mentions: allMentions, trending };
}

/**
 * Send alerts for trending tickers
 */
async function sendTrendingAlerts(trending: TrendingTicker[]): Promise<void> {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || trending.length === 0) return;

  // DEDUPLICATION: Check if we can send notification (global + per-symbol cooldown)
  const { canSendScannerNotification, markScannerNotificationSent } = await import('./discord-service');
  const symbols = trending.map(t => t.symbol);
  const dedupCheck = canSendScannerNotification('social_sentiment', symbols);

  if (!dedupCheck.canSend) {
    logger.info(`[SOCIAL-SENTIMENT] Discord notification BLOCKED: ${dedupCheck.reason}`);
    return;
  }

  // Filter tickers to only those that passed symbol dedup
  const filteredTrending = trending.filter(t => dedupCheck.filteredSymbols.includes(t.symbol));
  if (filteredTrending.length === 0) {
    logger.info('[SOCIAL-SENTIMENT] All tickers were recently notified - skipping Discord');
    return;
  }

  try {
    const content = [
      '# 🔥 Trending on Social Media',
      '',
      ...filteredTrending.map(ticker => {
        const emoji = ticker.sentiment === 'bullish' ? '🟢' : ticker.sentiment === 'bearish' ? '🔴' : '⚪';
        return `${emoji} **$${ticker.symbol}** - ${ticker.mentionCount} mentions | Sentiment: ${ticker.sentimentScore > 0 ? '+' : ''}${ticker.sentimentScore.toFixed(0)}`;
      }),
    ].join('\n');

    await postDiscordWebhook(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        username: 'Social Sentiment Scanner',
      }),
    });

    // Mark notification as sent to prevent spam
    markScannerNotificationSent('social_sentiment', filteredTrending.map(t => t.symbol));
    logger.info(`[SOCIAL-SENTIMENT] Discord alert sent for ${filteredTrending.length} tickers (deduped)`);
  } catch (error) {
    logger.warn('[SOCIAL-SENTIMENT] Discord alert failed:', error);
  }
}

/**
 * Get scanner status
 */
export function getSocialSentimentStatus(): ScannerStatus {
  return { ...scannerStatus };
}

/**
 * Get trending tickers
 */
export function getTrendingTickers(): TrendingTicker[] {
  return [...scannerStatus.trendingTickers];
}

/**
 * Get recent mentions
 */
export function getRecentMentions(limit = 50): SocialMention[] {
  return scannerStatus.recentMentions.slice(0, limit);
}

/**
 * Toggle scanner active state
 */
export function setSocialSentimentActive(active: boolean): void {
  scannerStatus.isActive = active;
  logger.info(`[SOCIAL-SENTIMENT] Scanner ${active ? 'ACTIVATED' : 'DEACTIVATED'}`);
}

/**
 * Update scanner settings
 */
export function updateSocialSentimentSettings(settings: Partial<ScannerStatus['settings']>): void {
  scannerStatus.settings = { ...scannerStatus.settings, ...settings };
  logger.info('[SOCIAL-SENTIMENT] Settings updated:', scannerStatus.settings);
}

/**
 * Add ticker to watchlist
 */
export function addTickerToWatch(symbol: string): void {
  if (!scannerStatus.settings.watchlist.includes(symbol)) {
    scannerStatus.settings.watchlist.push(symbol);
    logger.info(`[SOCIAL-SENTIMENT] Added ${symbol} to watchlist`);
  }
}

/**
 * Remove ticker from watchlist
 */
export function removeTickerFromWatch(symbol: string): void {
  scannerStatus.settings.watchlist = scannerStatus.settings.watchlist.filter(s => s !== symbol);
  logger.info(`[SOCIAL-SENTIMENT] Removed ${symbol} from watchlist`);
}

/**
 * Manually analyze text sentiment
 */
export function analyzeText(text: string): {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  score: number;
  tickers: string[];
} {
  const { sentiment, score } = analyzeSentiment(text);
  const tickers = extractTickers(text);
  
  return { sentiment, score, tickers };
}
