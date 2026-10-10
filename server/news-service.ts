import { logger } from './logger';
import { logAPIError, logAPISuccess } from './monitoring-service';

const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';

export interface NewsArticle {
  uuid: string;
  title: string;
  summary: string;
  url: string;
  timePublished: string;
  authors: string[];
  source: string;
  sourceDomain: string;
  tickers: string[];
  topics: Array<{
    topic: string;
    relevance_score: string;
  }>;
  overallSentimentScore: number;
  overallSentimentLabel: 'Bullish' | 'Bearish' | 'Neutral' | 'Somewhat-Bullish' | 'Somewhat-Bearish';
  tickerSentiments: Array<{
    ticker: string;
    relevance_score: string;
    ticker_sentiment_score: string;
    ticker_sentiment_label: string;
  }>;
}

export interface BreakingNewsArticle extends NewsArticle {
  isBreaking: boolean;
  breakingReason: string;
  primaryTicker: string;
  tradingDirection: 'long' | 'short';
}

// In-memory cache for deduplication
const seenArticleUUIDs = new Set<string>();
const MAX_CACHE_SIZE = 1000;

// API quota tracking
let dailyAPICallCount = 0;
let lastResetDate = new Date().toDateString();

// Last successful fetch timestamp
let lastSuccessfulFetch: Date | null = null;
let lastRateLimited: Date | null = null;

/**
 * Reset daily API call counter at midnight
 */
function checkAndResetDailyQuota(): void {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    logger.info(`📰 [NEWS] Daily quota reset: ${dailyAPICallCount} calls made yesterday`);
    dailyAPICallCount = 0;
    lastResetDate = today;
  }
}

/**
 * Check if we're within API quota (500 calls/day for free tier)
 */
function isWithinQuota(): boolean {
  checkAndResetDailyQuota();
  const MAX_DAILY_CALLS = 500;
  const remainingCalls = MAX_DAILY_CALLS - dailyAPICallCount;
  
  if (remainingCalls <= 0) {
    logger.warn(`📰 [NEWS] API quota exhausted (${dailyAPICallCount}/${MAX_DAILY_CALLS} calls today)`);
    return false;
  }
  
  if (remainingCalls <= 50) {
    logger.warn(`📰 [NEWS] Low quota warning: ${remainingCalls} calls remaining today`);
  }
  
  return true;
}

/**
 * Fetch news from Alpha Vantage NEWS_SENTIMENT endpoint
 * @param tickers Optional comma-separated tickers to filter (e.g., "AAPL,MSFT,TSLA")
 * @param topics Optional topics filter (e.g., "earnings,ipo,mergers_and_acquisitions")
 * @param timeFrom Optional start time (YYYYMMDDTHHMM format)
 * @param limit Maximum number of articles (default 50, max 1000)
 */
export async function fetchAlphaVantageNews(
  tickers?: string,
  topics?: string,
  timeFrom?: string,
  limit: number = 50
): Promise<NewsArticle[]> {
  if (!ALPHA_VANTAGE_API_KEY) {
    logger.error('📰 [NEWS] ALPHA_VANTAGE_API_KEY not configured');
    return [];
  }

  if (!isWithinQuota()) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      function: 'NEWS_SENTIMENT',
      apikey: ALPHA_VANTAGE_API_KEY,
      limit: limit.toString(),
      sort: 'LATEST'
    });

    if (tickers) params.append('tickers', tickers);
    if (topics) params.append('topics', topics);
    if (timeFrom) params.append('time_from', timeFrom);

    const url = `${ALPHA_VANTAGE_BASE_URL}?${params}`;
    
    logger.info(`📰 [NEWS] Fetching from Alpha Vantage (limit=${limit}, tickers=${tickers || 'all'}, topics=${topics || 'all'})`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'QuantEdgeLabs/1.0'
      }
    });

    dailyAPICallCount++;
    
    if (!response.ok) {
      logAPIError('Alpha Vantage News', '/query', new Error(`HTTP ${response.status}`));
      return [];
    }

    const data = await response.json();

    // Check for rate-limit / error response. Alpha Vantage signals a hit daily
    // limit via `Information` (newer format), and errors via `Note` /
    // `Error Message`. Missing `Information` here was the silent-0-articles bug:
    // the response had no `feed`, so we returned [] but still marked the service
    // "healthy" (lastSuccessfulFetch set below). Treat all three as a failure.
    if (data.Note || data['Error Message'] || data.Information) {
      const errorMsg = data.Note || data['Error Message'] || data.Information;
      logger.warn(`📰 [NEWS] Alpha Vantage limited/unavailable: ${errorMsg}`);
      logAPIError('Alpha Vantage News', '/query', new Error(errorMsg));
      lastRateLimited = new Date();
      return [];
    }

    const articles: NewsArticle[] = data.feed || [];
    
    logAPISuccess('Alpha Vantage News', '/query', { articlesFound: articles.length, quotaUsed: dailyAPICallCount });
    logger.info(`📰 [NEWS] Fetched ${articles.length} articles (quota: ${dailyAPICallCount}/500)`);
    
    lastSuccessfulFetch = new Date();
    
    return articles;
  } catch (error: any) {
    logger.error(`📰 [NEWS] Error fetching Alpha Vantage news:`, error);
    logAPIError('Alpha Vantage News', '/query', error);
    return [];
  }
}

/**
 * Detect if news article represents a breaking/significant market event
 * Uses sentiment scores and keyword detection
 */
export function detectBreakingNews(article: NewsArticle): BreakingNewsArticle | null {
  const { title, summary, overallSentimentScore, overallSentimentLabel, tickerSentiments, topics } = article;
  const combinedText = `${title} ${summary}`.toLowerCase();
  
  // Breaking news keywords
  const earningsKeywords = ['earnings beat', 'earnings surprise', 'guidance raised', 'guidance increased', 
    'beat estimates', 'exceeded expectations', 'record earnings', 'blowout earnings', 'eps beat'];
  
  const corporateActionKeywords = ['acquisition', 'merger', 'buyout', 'takeover', 'deal announced',
    'partnership announced', 'collaboration announced', 'joint venture', 'acquired by'];
  
  const regulatoryKeywords = ['fda approval', 'regulatory approval', 'cleared by fda', 'fda grants',
    'sec approval', 'patent granted', 'license approved'];
  
  const fedKeywords = ['fed', 'federal reserve', 'rate cut', 'rate hike', 'fomc', 'interest rate decision',
    'powell', 'monetary policy', 'fed minutes', 'fed statement'];
  
  const priceMovementKeywords = ['+10%', '+15%', '+20%', '+25%', '+30%', 'up 10%', 'up 15%', 'up 20%',
    'surged', 'spiked', 'soared', 'rallied', 'jumped', 'plunged', 'crashed', 'tanked', 'plummeted'];
  
  const milestoneKeywords = ['$1t', '$2t', '$3t', '$1b', '$5b', '$10b', '1 trillion', '2 trillion',
    'all-time high', 'record high', 'historic', 'milestone'];
  
  const breakingIndicators = ['breaking:', 'just announced', 'just reported', 'alert:', 'confirmed today',
    'announced today', 'reported today', 'urgent:', 'developing:'];
  
  const allKeywords = [
    ...earningsKeywords, ...corporateActionKeywords, ...regulatoryKeywords,
    ...fedKeywords, ...priceMovementKeywords, ...milestoneKeywords, ...breakingIndicators
  ];
  
  // Check for keyword matches
  const matchedKeywords = allKeywords.filter(keyword => combinedText.includes(keyword));
  
  // Check sentiment strength (>0.35 bullish or <-0.35 bearish is significant)
  const hasStrongSentiment = Math.abs(overallSentimentScore) > 0.35;
  
  // Check topic relevance
  const relevantTopics = topics.filter(t => 
    ['earnings', 'ipo', 'mergers_and_acquisitions', 'financial_markets', 
     'economy_monetary', 'economy_fiscal', 'manufacturing', 'technology'].includes(t.topic)
  );
  
  // Breaking news criteria:
  // 1. Has strong sentiment (>0.35 or <-0.35) AND matched keywords
  // 2. OR has very strong sentiment (>0.5 or <-0.5)
  // 3. OR matched 2+ keywords
  const isBreaking = (hasStrongSentiment && matchedKeywords.length > 0) || 
                     Math.abs(overallSentimentScore) > 0.5 || 
                     matchedKeywords.length >= 2 ||
                     relevantTopics.length >= 2;
  
  if (!isBreaking) {
    return null;
  }
  
  // Find primary ticker (highest relevance score)
  let primaryTicker = '';
  let primaryTickerSentiment = 0;
  
  if (tickerSentiments.length > 0) {
    const sorted = [...tickerSentiments].sort((a, b) => 
      parseFloat(b.relevance_score) - parseFloat(a.relevance_score)
    );
    primaryTicker = sorted[0].ticker;
    primaryTickerSentiment = parseFloat(sorted[0].ticker_sentiment_score);
  }
  
  // Determine trading direction based on sentiment
  const tradingDirection: 'long' | 'short' = 
    (primaryTickerSentiment || overallSentimentScore) > 0 ? 'long' : 'short';
  
  const breakingReason = [
    matchedKeywords.length > 0 ? `Keywords: ${matchedKeywords.slice(0, 3).join(', ')}` : '',
    hasStrongSentiment ? `Strong ${overallSentimentLabel} sentiment (${overallSentimentScore.toFixed(2)})` : '',
    relevantTopics.length > 0 ? `Topics: ${relevantTopics.map(t => t.topic).join(', ')}` : ''
  ].filter(Boolean).join(' | ');
  
  logger.info(`📰 [BREAKING NEWS] ${title}`);
  logger.info(`   → Ticker: ${primaryTicker}, Direction: ${tradingDirection.toUpperCase()}, Sentiment: ${overallSentimentScore.toFixed(2)}`);
  logger.info(`   → Reason: ${breakingReason}`);
  
  return {
    ...article,
    isBreaking: true,
    breakingReason,
    primaryTicker,
    tradingDirection
  };
}

/**
 * Fetch and filter breaking news (deduplicates automatically)
 */
export async function fetchBreakingNews(
  tickers?: string,
  topics?: string,
  limit: number = 50
): Promise<BreakingNewsArticle[]> {
  // Calculate time window (last 24 hours)
  const timeFrom = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const timeFromStr = timeFrom.toISOString().replace(/[-:]/g, '').slice(0, 13); // YYYYMMDDTHHmm
  
  const articles = await fetchAlphaVantageNews(tickers, topics, timeFromStr, limit);
  
  if (articles.length === 0) {
    return [];
  }
  
  logger.info(`📰 [NEWS] Processing ${articles.length} articles for breaking news detection`);
  
  // Deduplicate and detect breaking news
  const breakingArticles: BreakingNewsArticle[] = [];
  let newArticles = 0;
  let duplicates = 0;
  
  for (const article of articles) {
    // Check if we've seen this UUID before
    if (seenArticleUUIDs.has(article.uuid)) {
      duplicates++;
      continue;
    }
    
    newArticles++;
    
    // Add to seen set (with cache size limit)
    seenArticleUUIDs.add(article.uuid);
    if (seenArticleUUIDs.size > MAX_CACHE_SIZE) {
      const firstUUID = seenArticleUUIDs.values().next().value;
      seenArticleUUIDs.delete(firstUUID);
    }
    
    // Check if it's breaking news
    const breaking = detectBreakingNews(article);
    if (breaking) {
      breakingArticles.push(breaking);
    }
  }
  
  logger.info(`📰 [NEWS] Found ${breakingArticles.length} breaking news articles (${newArticles} new, ${duplicates} duplicates)`);
  
  return breakingArticles;
}

/**
 * Get service status and metrics
 */
export function getNewsServiceStatus() {
  checkAndResetDailyQuota();
  
  // Alpha Vantage is the source of truth on limits (free tier = 25/day). A recent
  // `Information` response means we're rate-limited regardless of our own counter.
  const rateLimited = lastRateLimited ? (Date.now() - lastRateLimited.getTime()) < 60 * 60 * 1000 : false;
  const fetchedRecently = lastSuccessfulFetch ? (Date.now() - lastSuccessfulFetch.getTime()) < 60 * 60 * 1000 : false;
  return {
    quotaUsed: dailyAPICallCount,
    quotaLimit: 500,
    quotaRemaining: 500 - dailyAPICallCount,
    lastFetch: lastSuccessfulFetch,
    lastRateLimited,
    rateLimited,
    cacheSize: seenArticleUUIDs.size,
    // Honest: rate-limited or never-fetched-successfully is NOT healthy.
    isHealthy: !rateLimited && fetchedRecently,
  };
}

/**
 * Manually reset quota (for testing purposes)
 */
export function resetQuotaForTesting(): void {
  dailyAPICallCount = 0;
  lastResetDate = new Date().toDateString();
  logger.info('📰 [NEWS] Quota manually reset for testing');
}
