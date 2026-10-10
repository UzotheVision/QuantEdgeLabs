/**
 * Universal Search Service
 *
 * Searches across all platform data:
 * - Stocks (symbols, company names)
 * - Trade Ideas (by symbol, catalyst, strategy)
 * - News Articles (keywords, symbols mentioned)
 * - Actions (quick commands like "chart AAPL")
 * - Help Topics
 */

import { db } from './db';
import { tradeIdeas } from '../shared/schema';
import { ilike, or, sql, desc } from 'drizzle-orm';
import { fetchAlphaVantageNews, type NewsArticle } from './news-service';
import type {
  SearchResponse,
  AnySearchResult,
  StockSearchResult,
  TradeIdeaSearchResult,
  NewsSearchResult,
  ActionSearchResult,
  HelpSearchResult,
  SearchCategory,
  SearchSuggestion,
  TrendingSearch,
} from '../shared/search-types';
import { logger } from './logger';

// Popular stock symbols with company names (for quick search)
const POPULAR_STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', exchange: 'NASDAQ', sector: 'Consumer Cyclical' },
  { symbol: 'TSLA', name: 'Tesla Inc.', exchange: 'NASDAQ', sector: 'Automotive' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'META', name: 'Meta Platforms Inc.', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', exchange: 'NYSE', sector: 'ETF' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'NASDAQ', sector: 'ETF' },
  { symbol: 'APLD', name: 'Applied Digital Corporation', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'INTC', name: 'Intel Corporation', exchange: 'NASDAQ', sector: 'Technology' },
  { symbol: 'PLTR', name: 'Palantir Technologies', exchange: 'NYSE', sector: 'Technology' },
  { symbol: 'COIN', name: 'Coinbase Global Inc.', exchange: 'NASDAQ', sector: 'Finance' },
  { symbol: 'GME', name: 'GameStop Corp.', exchange: 'NYSE', sector: 'Retail' },
  { symbol: 'AMC', name: 'AMC Entertainment', exchange: 'NYSE', sector: 'Entertainment' },
  { symbol: 'SOFI', name: 'SoFi Technologies Inc.', exchange: 'NASDAQ', sector: 'Finance' },
  { symbol: 'RIVN', name: 'Rivian Automotive', exchange: 'NASDAQ', sector: 'Automotive' },
  { symbol: 'LCID', name: 'Lucid Group Inc.', exchange: 'NASDAQ', sector: 'Automotive' },
  { symbol: 'NIO', name: 'NIO Inc.', exchange: 'NYSE', sector: 'Automotive' },
  // Oil complex — searchable by symbol, company name, or the words oil/crude.
  { symbol: 'USO', name: 'United States Oil Fund · WTI crude proxy', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'BNO', name: 'United States Brent Oil Fund · Brent crude proxy', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'XLE', name: 'Energy Select Sector SPDR Fund · oil majors', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'XOP', name: 'SPDR Oil & Gas Exploration and Production ETF', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'OIH', name: 'VanEck Oil Services ETF', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation · integrated oil', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'CVX', name: 'Chevron Corporation · integrated oil', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'COP', name: 'ConocoPhillips · oil producer', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'OXY', name: 'Occidental Petroleum · oil producer', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'EOG', name: 'EOG Resources · oil producer', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'FANG', name: 'Diamondback Energy · oil producer', exchange: 'NASDAQ', sector: 'Oil / Energy' },
  { symbol: 'DVN', name: 'Devon Energy · oil producer', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'SLB', name: 'SLB · oilfield services', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'HAL', name: 'Halliburton · oilfield services', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'VLO', name: 'Valero Energy · oil refiner', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'MPC', name: 'Marathon Petroleum · oil refiner', exchange: 'NYSE', sector: 'Oil / Energy' },
  { symbol: 'PSX', name: 'Phillips 66 · oil refiner', exchange: 'NYSE', sector: 'Oil / Energy' },
];

// Comprehensive crypto mapping
const CRYPTO_SYMBOLS: Record<string, { name: string; symbol: string }> = {
  'BTC': { name: 'Bitcoin', symbol: 'BTC-USD' },
  'ETH': { name: 'Ethereum', symbol: 'ETH-USD' },
  'SOL': { name: 'Solana', symbol: 'SOL-USD' },
  'XRP': { name: 'XRP', symbol: 'XRP-USD' },
  'ADA': { name: 'Cardano', symbol: 'ADA-USD' },
  'DOGE': { name: 'Dogecoin', symbol: 'DOGE-USD' },
  'AVAX': { name: 'Avalanche', symbol: 'AVAX-USD' },
  'DOT': { name: 'Polkadot', symbol: 'DOT-USD' },
  'LINK': { name: 'Chainlink', symbol: 'LINK-USD' },
  'MATIC': { name: 'Polygon', symbol: 'MATIC-USD' },
  'UNI': { name: 'Uniswap', symbol: 'UNI-USD' },
  'ATOM': { name: 'Cosmos', symbol: 'ATOM-USD' },
  'LTC': { name: 'Litecoin', symbol: 'LTC-USD' },
  'FIL': { name: 'Filecoin', symbol: 'FIL-USD' },
  'NEAR': { name: 'NEAR Protocol', symbol: 'NEAR-USD' },
  'APT': { name: 'Aptos', symbol: 'APT-USD' },
  'ARB': { name: 'Arbitrum', symbol: 'ARB-USD' },
  'OP': { name: 'Optimism', symbol: 'OP-USD' },
  'PEPE': { name: 'Pepe', symbol: 'PEPE-USD' },
  'SHIB': { name: 'Shiba Inu', symbol: 'SHIB-USD' },
  'SUI': { name: 'Sui', symbol: 'SUI-USD' },
  'SEI': { name: 'Sei', symbol: 'SEI-USD' },
  'INJ': { name: 'Injective', symbol: 'INJ-USD' },
  'MANA': { name: 'Decentraland', symbol: 'MANA-USD' },
  'SAND': { name: 'The Sandbox', symbol: 'SAND-USD' },
  'AAVE': { name: 'Aave', symbol: 'AAVE-USD' },
  'MKR': { name: 'Maker', symbol: 'MKR-USD' },
  'CRV': { name: 'Curve DAO', symbol: 'CRV-USD' },
  'RENDER': { name: 'Render', symbol: 'RENDER-USD' },
  'IMX': { name: 'Immutable X', symbol: 'IMX-USD' },
};

// Futures contracts
const FUTURES_SYMBOLS: Record<string, { name: string; symbol: string }> = {
  'ES': { name: 'E-mini S&P 500', symbol: 'ES=F' },
  'NQ': { name: 'E-mini Nasdaq 100', symbol: 'NQ=F' },
  'YM': { name: 'E-mini Dow Jones', symbol: 'YM=F' },
  'RTY': { name: 'E-mini Russell 2000', symbol: 'RTY=F' },
  'CL': { name: 'Crude Oil WTI', symbol: 'CL=F' },
  'GC': { name: 'Gold', symbol: 'GC=F' },
  'SI': { name: 'Silver', symbol: 'SI=F' },
  'NG': { name: 'Natural Gas', symbol: 'NG=F' },
  'ZB': { name: '30-Year T-Bond', symbol: 'ZB=F' },
  'ZN': { name: '10-Year T-Note', symbol: 'ZN=F' },
  '6E': { name: 'Euro FX', symbol: '6E=F' },
  '6J': { name: 'Japanese Yen', symbol: '6J=F' },
  'HG': { name: 'Copper', symbol: 'HG=F' },
  'PL': { name: 'Platinum', symbol: 'PL=F' },
  'PA': { name: 'Palladium', symbol: 'PA=F' },
  'ZC': { name: 'Corn', symbol: 'ZC=F' },
  'ZS': { name: 'Soybeans', symbol: 'ZS=F' },
  'ZW': { name: 'Wheat', symbol: 'ZW=F' },
};

// Quick actions that users can search for
const QUICK_ACTIONS: ActionSearchResult[] = [
  {
    id: 'action-chart',
    category: 'actions',
    action: 'chart',
    label: 'Open Chart',
    title: 'Open Chart Analysis',
    subtitle: 'View interactive price chart with indicators',
    icon: '📊',
    url: '/chart',
  },
  {
    id: 'action-screen',
    category: 'actions',
    action: 'screen',
    label: 'Screen Stocks',
    title: 'Stock Screener',
    subtitle: 'Find stocks matching your criteria',
    icon: '🔬',
    url: '/discover',
  },
  {
    id: 'action-ideas',
    category: 'actions',
    action: 'ideas',
    label: 'AI Trade Ideas',
    title: 'AI Trade Ideas',
    subtitle: 'View AI-generated trade opportunities',
    icon: '🤖',
    url: '/trade-desk',
  },
  {
    id: 'action-watchlist',
    category: 'actions',
    action: 'watchlist',
    label: 'Watchlist',
    title: 'My Watchlist',
    subtitle: 'View and manage your watchlist',
    icon: '⭐',
    url: '/watchlist',
  },
  {
    id: 'action-movers',
    category: 'actions',
    action: 'movers',
    label: 'Top Movers',
    title: 'Market Movers',
    subtitle: 'Biggest gainers and losers',
    icon: '🚀',
    url: '/movers',
  },
];

// Help topics for documentation
const HELP_TOPICS: HelpSearchResult[] = [
  {
    id: 'help-confidence',
    category: 'help',
    topic: 'Signal Strength Score',
    section: 'Analysis',
    title: 'Understanding Signal Strength Scores',
    description: 'Learn how our engine calculates signal strength scores for trade ideas',
    icon: '📚',
    url: '/help/confidence-scores',
    tags: ['confidence', 'scoring', 'ai', 'analysis'],
  },
  {
    id: 'help-grading',
    category: 'help',
    topic: 'Stock Grading',
    section: 'Analysis',
    title: 'Stock Grading System',
    description: 'How we grade stocks from S to F based on technical and fundamental analysis',
    icon: '📚',
    url: '/help/grading',
    tags: ['grading', 'fundamentals', 'technicals', 'score'],
  },
  {
    id: 'help-vix',
    category: 'help',
    topic: 'VIX Index',
    section: 'Market Indicators',
    title: 'What is the VIX?',
    description: 'Understanding market volatility and the fear gauge',
    icon: '📚',
    url: '/help/vix',
    tags: ['vix', 'volatility', 'fear', 'market'],
  },
];

/**
 * Search stocks, crypto, and futures by symbol or name
 * Supports ANY ticker - will look up via Yahoo Finance if not in predefined list
 */
async function searchStocks(query: string): Promise<StockSearchResult[]> {
  const results: StockSearchResult[] = [];
  const upperQuery = query.toUpperCase().trim();
  const lowerQuery = query.toLowerCase().trim();

  // 1. Search popular stocks
  for (const stock of POPULAR_STOCKS) {
    if (
      stock.symbol.includes(upperQuery) ||
      stock.name.toUpperCase().includes(upperQuery)
    ) {
      results.push({
        id: `stock-${stock.symbol}`,
        category: 'stocks',
        symbol: stock.symbol,
        companyName: stock.name,
        exchange: stock.exchange,
        title: stock.symbol,
        subtitle: stock.name,
        description: `${stock.exchange} • ${stock.sector}`,
        icon: '📈',
        url: `/stock/${stock.symbol}`,
        sector: stock.sector,
        relevanceScore: stock.symbol === upperQuery ? 100 : 80,
      });
    }
  }

  // 2. Search crypto
  for (const [key, crypto] of Object.entries(CRYPTO_SYMBOLS)) {
    if (key.includes(upperQuery) || crypto.name.toUpperCase().includes(upperQuery)) {
      results.push({
        id: `crypto-${key}`,
        category: 'crypto' as any,
        symbol: crypto.symbol,
        companyName: crypto.name,
        exchange: 'CRYPTO',
        title: key,
        subtitle: crypto.name,
        description: 'Cryptocurrency',
        icon: '₿',
        url: `/stock/${crypto.symbol}`,
        sector: 'Cryptocurrency',
        relevanceScore: key === upperQuery ? 100 : 75,
      });
    }
  }

  // 3. Search futures
  for (const [key, future] of Object.entries(FUTURES_SYMBOLS)) {
    if (key.includes(upperQuery) || future.name.toUpperCase().includes(upperQuery)) {
      results.push({
        id: `future-${key}`,
        category: 'stocks',
        symbol: future.symbol,
        companyName: future.name,
        exchange: 'CME',
        title: key,
        subtitle: future.name,
        description: 'Futures Contract',
        icon: '📊',
        url: `/stock/${future.symbol}`,
        sector: 'Futures',
        relevanceScore: key === upperQuery ? 100 : 70,
      });
    }
  }

  // 4. If exact symbol match not found, try Yahoo Finance lookup
  if (upperQuery.length >= 1 && upperQuery.length <= 10 && !results.find(r => r.symbol === upperQuery)) {
    try {
      const yahooFinance = await import('yahoo-finance2').then(m => m.default);

      // Try to search for the symbol
      const searchResults = await yahooFinance.search(upperQuery, { quotesCount: 5 }).catch(() => null);

      if (searchResults?.quotes) {
        for (const quote of searchResults.quotes) {
          if (quote.symbol && !results.find(r => r.symbol === quote.symbol)) {
            const isEquity = quote.quoteType === 'EQUITY';
            const isCrypto = quote.quoteType === 'CRYPTOCURRENCY';
            const isFuture = quote.quoteType === 'FUTURE';
            const isETF = quote.quoteType === 'ETF';
            const isIndex = quote.quoteType === 'INDEX';

            results.push({
              id: `yahoo-${quote.symbol}`,
              category: isCrypto ? 'crypto' as any : 'stocks',
              symbol: quote.symbol,
              companyName: quote.shortname || quote.longname || quote.symbol,
              exchange: quote.exchange || 'UNKNOWN',
              title: quote.symbol,
              subtitle: quote.shortname || quote.longname || quote.symbol,
              description: `${quote.exchange || ''} • ${quote.quoteType || 'Stock'}`,
              icon: isCrypto ? '₿' : isFuture ? '📊' : isETF ? '📦' : isIndex ? '📉' : '📈',
              url: `/stock/${quote.symbol}`,
              sector: quote.industry || (isCrypto ? 'Cryptocurrency' : isFuture ? 'Futures' : isETF ? 'ETF' : 'Equity'),
              relevanceScore: quote.symbol === upperQuery ? 95 : 65,
            });
          }
        }
      }
    } catch (error) {
      logger.debug('Yahoo Finance search failed, continuing with local results');
    }
  }

  // 5. Also search symbols from our trade ideas
  try {
    const ideas = await db
      .selectDistinct({ symbol: tradeIdeas.symbol })
      .from(tradeIdeas)
      .where(ilike(tradeIdeas.symbol, `%${upperQuery}%`))
      .limit(10);

    for (const idea of ideas) {
      if (!results.find(r => r.symbol === idea.symbol)) {
        results.push({
          id: `stock-${idea.symbol}`,
          category: 'stocks',
          symbol: idea.symbol,
          companyName: idea.symbol,
          exchange: 'UNKNOWN',
          title: idea.symbol,
          subtitle: 'Recently analyzed',
          description: 'View analysis and trade ideas',
          icon: '📈',
          url: `/stock/${idea.symbol}`,
          relevanceScore: 60,
        });
      }
    }
  } catch (error) {
    logger.error('Error searching trade ideas symbols:', error);
  }

  return results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0)).slice(0, 15);
}

/**
 * Search trade ideas by symbol, catalyst, or analysis
 */
async function searchTradeIdeas(query: string): Promise<TradeIdeaSearchResult[]> {
  const results: TradeIdeaSearchResult[] = [];

  try {
    const ideas = await db
      .select()
      .from(tradeIdeas)
      .where(
        or(
          ilike(tradeIdeas.symbol, `%${query}%`),
          ilike(tradeIdeas.catalyst, `%${query}%`),
          ilike(tradeIdeas.analysis, `%${query}%`)
        )
      )
      .orderBy(desc(tradeIdeas.timestamp))
      .limit(20);

    for (const idea of ideas) {
      results.push({
        id: `idea-${idea.id}`,
        category: 'ideas',
        symbol: idea.symbol,
        direction: idea.direction as 'long' | 'short',
        confidence: idea.confidenceScore,
        engine: idea.source,
        strategy: idea.catalyst,
        entryPrice: idea.entryPrice,
        targetPrice: idea.targetPrice,
        title: `${idea.symbol} ${idea.direction.toUpperCase()}`,
        subtitle: `${idea.confidenceScore}pts signal strength • ${idea.source}`,
        description: idea.catalyst.substring(0, 100),
        icon: idea.direction === 'long' ? '📈' : '📉',
        url: `/trade-desk?ideaId=${idea.id}`,
        createdAt: idea.timestamp,
        relevanceScore: idea.confidenceScore,
      });
    }
  } catch (error) {
    logger.error('Error searching trade ideas:', error);
  }

  return results;
}

/**
 * Search news articles (from Alpha Vantage news service)
 */
async function searchNews(query: string): Promise<NewsSearchResult[]> {
  const results: NewsSearchResult[] = [];

  try {
    // Fetch news related to query (if it's a symbol)
    const upperQuery = query.toUpperCase();
    const isSymbol = /^[A-Z]{1,5}$/.test(upperQuery);

    let articles: NewsArticle[] = [];
    if (isSymbol) {
      articles = await fetchAlphaVantageNews(upperQuery, undefined, undefined, 10);
    }

    for (const article of articles) {
      results.push({
        id: `news-${article.uuid}`,
        category: 'news',
        headline: article.title,
        source: article.source,
        publishedAt: article.timePublished,
        symbols: article.tickers,
        sentiment: article.overallSentimentLabel.includes('Bullish')
          ? 'positive'
          : article.overallSentimentLabel.includes('Bearish')
          ? 'negative'
          : 'neutral',
        title: article.title,
        subtitle: article.source,
        description: article.summary.substring(0, 150),
        icon: '📰',
        url: article.url,
        relevanceScore: parseFloat(
          article.tickerSentiments.find(t => t.ticker === upperQuery)?.relevance_score || '50'
        ),
      });
    }
  } catch (error) {
    logger.error('Error searching news:', error);
  }

  return results;
}

/**
 * Search quick actions
 */
function searchActions(query: string): ActionSearchResult[] {
  const lowerQuery = query.toLowerCase();
  return QUICK_ACTIONS.filter(
    action =>
      action.label.toLowerCase().includes(lowerQuery) ||
      action.title.toLowerCase().includes(lowerQuery) ||
      action.action.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Search help topics
 */
function searchHelp(query: string): HelpSearchResult[] {
  const lowerQuery = query.toLowerCase();
  return HELP_TOPICS.filter(
    help =>
      help.topic.toLowerCase().includes(lowerQuery) ||
      help.title.toLowerCase().includes(lowerQuery) ||
      help.tags.some(tag => tag.includes(lowerQuery))
  );
}

/**
 * Universal search across all categories
 */
export async function universalSearch(
  query: string,
  categories?: SearchCategory[]
): Promise<SearchResponse> {
  const startTime = Date.now();
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return {
      query,
      results: [],
      categories: [],
      totalResults: 0,
      searchTime: 0,
    };
  }

  const shouldSearchCategory = (category: SearchCategory) =>
    !categories || categories.length === 0 || categories.includes(category) || categories.includes('all');

  // Perform parallel searches
  const [stocks, tradeIdeasResults, news, actions, help] = await Promise.all([
    shouldSearchCategory('stocks') ? searchStocks(trimmedQuery) : Promise.resolve([]),
    shouldSearchCategory('ideas') ? searchTradeIdeas(trimmedQuery) : Promise.resolve([]),
    shouldSearchCategory('news') ? searchNews(trimmedQuery) : Promise.resolve([]),
    shouldSearchCategory('actions') ? Promise.resolve(searchActions(trimmedQuery)) : Promise.resolve([]),
    shouldSearchCategory('help') ? Promise.resolve(searchHelp(trimmedQuery)) : Promise.resolve([]),
  ]);

  // Combine all results
  const allResults: AnySearchResult[] = [
    ...stocks,
    ...tradeIdeasResults,
    ...news,
    ...actions,
    ...help,
  ];

  // Group by category
  const categoryCounts = new Map<SearchCategory, AnySearchResult[]>();
  for (const result of allResults) {
    const existing = categoryCounts.get(result.category) || [];
    existing.push(result);
    categoryCounts.set(result.category, existing);
  }

  const categoryResults = Array.from(categoryCounts.entries()).map(([category, results]) => ({
    category,
    count: results.length,
    results,
  }));

  const searchTime = Date.now() - startTime;

  logger.info(
    `🔍 [SEARCH] Query: "${trimmedQuery}" | Results: ${allResults.length} | Time: ${searchTime}ms`
  );

  return {
    query: trimmedQuery,
    results: allResults,
    categories: categoryResults,
    totalResults: allResults.length,
    searchTime,
  };
}

/**
 * Get search suggestions for autocomplete
 */
export async function getSearchSuggestions(query: string): Promise<SearchSuggestion[]> {
  const suggestions: SearchSuggestion[] = [];
  const upperQuery = query.toUpperCase().trim();

  // Suggest popular stocks
  for (const stock of POPULAR_STOCKS) {
    if (stock.symbol.startsWith(upperQuery) || stock.name.toUpperCase().includes(upperQuery)) {
      suggestions.push({
        text: stock.symbol,
        category: 'stocks',
        icon: '📈',
        metadata: { companyName: stock.name },
      });
    }
  }

  // Suggest crypto
  for (const [key, crypto] of Object.entries(CRYPTO_SYMBOLS)) {
    if (key.startsWith(upperQuery) || crypto.name.toUpperCase().includes(upperQuery)) {
      suggestions.push({
        text: key,
        category: 'crypto' as any,
        icon: '₿',
        metadata: { companyName: crypto.name, symbol: crypto.symbol },
      });
    }
  }

  // Suggest futures
  for (const [key, future] of Object.entries(FUTURES_SYMBOLS)) {
    if (key.startsWith(upperQuery) || future.name.toUpperCase().includes(upperQuery)) {
      suggestions.push({
        text: key,
        category: 'stocks',
        icon: '📊',
        metadata: { companyName: future.name, symbol: future.symbol },
      });
    }
  }

  // Suggest actions
  const lowerQuery = query.toLowerCase();
  for (const action of QUICK_ACTIONS) {
    if (action.label.toLowerCase().includes(lowerQuery)) {
      suggestions.push({
        text: action.label,
        category: 'actions',
        icon: action.icon,
      });
    }
  }

  // Sort by relevance (exact prefix match first)
  return suggestions
    .sort((a, b) => {
      const aExact = a.text.toUpperCase().startsWith(upperQuery) ? 1 : 0;
      const bExact = b.text.toUpperCase().startsWith(upperQuery) ? 1 : 0;
      return bExact - aExact;
    })
    .slice(0, 10); // Limit to 10 suggestions
}

/**
 * Get trending searches (mock data for now)
 */
export async function getTrendingSearches(): Promise<TrendingSearch[]> {
  return [
    { query: 'NVDA', category: 'stocks', count: 150, trendDirection: 'up' },
    { query: 'TSLA', category: 'stocks', count: 120, trendDirection: 'up' },
    { query: 'BTC', category: 'crypto' as any, count: 110, trendDirection: 'up' },
    { query: 'ETH', category: 'crypto' as any, count: 95, trendDirection: 'up' },
    { query: 'SPY', category: 'stocks', count: 85, trendDirection: 'stable' },
    { query: 'ES', category: 'stocks', count: 75, trendDirection: 'stable' },
    { query: 'PLTR', category: 'stocks', count: 70, trendDirection: 'up' },
    { query: 'SOL', category: 'crypto' as any, count: 65, trendDirection: 'up' },
  ];
}

/**
 * Store recent search in localStorage (client-side)
 * This function is just a type definition for the client
 */
export interface RecentSearchStorage {
  userId: string;
  query: string;
  category: SearchCategory;
  timestamp: string;
  resultClicked?: string;
}
