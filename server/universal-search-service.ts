/**
 * Universal Search Service
 *
 * A hybrid search engine that can:
 * 1. Analyze stocks (existing functionality)
 * 2. Answer ANY question (general AI with web search)
 * 3. Generate trading strategies
 * 4. Provide market education
 */

import { logger } from './logger';

// Query intent types
export type QueryIntent =
  | 'stock_analysis'      // "NVDA technical analysis", "analyze AAPL"
  | 'trading_strategy'    // "swing trade for earnings", "options play on AMD"
  | 'market_question'     // "why is the market down", "what's moving SPY"
  | 'education'           // "what is RSI", "how do options work"
  | 'general'             // anything else - books, history, concepts
  | 'price_check';        // "TSLA price", "what's NVDA at"

export interface SearchQuery {
  raw: string;
  intent: QueryIntent;
  tickers: string[];
  keywords: string[];
  isQuestion: boolean;
}

export interface SearchResult {
  type: QueryIntent;
  query: string;
  response: string;
  sources?: { title: string; url?: string; type: string }[];
  relatedTickers?: string[];
  suggestedFollowUps?: string[];
  confidence: number;
  processingTime: number;
}

// Common stock tickers to detect
const COMMON_TICKERS = new Set([
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK', 'JPM',
  'V', 'UNH', 'XOM', 'JNJ', 'WMT', 'MA', 'PG', 'HD', 'CVX', 'MRK', 'ABBV', 'LLY',
  'PFE', 'KO', 'PEP', 'COST', 'TMO', 'AVGO', 'MCD', 'CSCO', 'ACN', 'ABT', 'DHR',
  'NKE', 'TXN', 'NEE', 'UPS', 'PM', 'RTX', 'HON', 'QCOM', 'LOW', 'UNP', 'IBM',
  'AMD', 'INTC', 'BA', 'GE', 'CAT', 'GS', 'AXP', 'SBUX', 'BKNG', 'MDLZ', 'GILD',
  'ADI', 'TJX', 'MMC', 'SYK', 'ISRG', 'VRTX', 'REGN', 'ZTS', 'LRCX', 'MU', 'AMAT',
  'NOW', 'PANW', 'SNPS', 'CDNS', 'KLAC', 'ADBE', 'CRM', 'ORCL', 'SAP', 'INTU',
  'SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO', 'ARKK', 'XLF', 'XLE', 'XLK', 'XLV',
  'BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'DOT', 'MATIC', 'AVAX', 'LINK', 'UNI',
  'GME', 'AMC', 'PLTR', 'SOFI', 'RIVN', 'LCID', 'NIO', 'COIN', 'HOOD', 'MSTR',
  'ARM', 'SMCI', 'IONQ', 'RGTI', 'QUBT', 'RKLB', 'RDW', 'LUNR', 'LMT', 'NOC',
]);

// Trading/market keywords
const TRADING_KEYWORDS = [
  'swing', 'trade', 'play', 'setup', 'entry', 'exit', 'target', 'stop', 'loss',
  'call', 'put', 'option', 'options', 'spread', 'straddle', 'strangle', 'iron condor',
  'earnings', 'er', 'guidance', 'beat', 'miss', 'revenue', 'eps',
  'breakout', 'breakdown', 'support', 'resistance', 'trend', 'momentum',
  'bullish', 'bearish', 'long', 'short', 'buy', 'sell',
  'squeeze', 'gamma', 'delta', 'theta', 'vega', 'iv', 'implied volatility',
];

const EDUCATION_KEYWORDS = [
  'what is', 'what are', 'how do', 'how does', 'explain', 'meaning of',
  'definition', 'difference between', 'learn', 'understand', 'basics',
  'beginner', 'tutorial', 'guide', 'introduction',
];

const ANALYSIS_KEYWORDS = [
  'analysis', 'analyze', 'technical', 'fundamental', 'chart', 'pattern',
  'indicator', 'rsi', 'macd', 'vwap', 'ema', 'sma', 'bollinger',
  'volume', 'flow', 'sentiment', 'news', 'catalyst',
];

/**
 * Parse and classify a search query
 */
export function parseQuery(rawQuery: string): SearchQuery {
  const query = rawQuery.trim();
  const upperQuery = query.toUpperCase();
  const lowerQuery = query.toLowerCase();

  // Extract tickers
  const words = query.split(/\s+/);
  const tickers: string[] = [];

  for (const word of words) {
    const cleanWord = word.replace(/[^A-Z]/gi, '').toUpperCase();
    if (cleanWord.length >= 1 && cleanWord.length <= 5 && COMMON_TICKERS.has(cleanWord)) {
      tickers.push(cleanWord);
    }
  }

  // Also check for $TICKER format
  const dollarTickers = query.match(/\$([A-Z]{1,5})/gi) || [];
  for (const dt of dollarTickers) {
    const ticker = dt.replace('$', '').toUpperCase();
    if (!tickers.includes(ticker)) {
      tickers.push(ticker);
    }
  }

  // Extract keywords
  const keywords: string[] = [];
  for (const kw of [...TRADING_KEYWORDS, ...ANALYSIS_KEYWORDS]) {
    if (lowerQuery.includes(kw)) {
      keywords.push(kw);
    }
  }

  // Determine if it's a question
  const isQuestion = /^(what|why|how|when|where|who|which|is|are|can|could|should|would|do|does|did)/i.test(query)
    || query.includes('?');

  // Classify intent
  let intent: QueryIntent = 'general';

  // Price check - simple price queries
  if (/price|trading at|what('s| is).*at\??$/i.test(lowerQuery) && tickers.length > 0) {
    intent = 'price_check';
  }
  // Stock analysis - has ticker + analysis keywords
  else if (tickers.length > 0 && keywords.some(k => ANALYSIS_KEYWORDS.includes(k))) {
    intent = 'stock_analysis';
  }
  // Trading strategy - has trading keywords (with or without ticker)
  else if (keywords.some(k => TRADING_KEYWORDS.includes(k))) {
    intent = 'trading_strategy';
  }
  // Market question - market-related but no specific ticker analysis
  else if (/market|sector|index|economy|fed|fomc|cpi|inflation|gdp|jobs|unemployment/i.test(lowerQuery)) {
    intent = 'market_question';
  }
  // Education - learning/explanation questions about trading
  else if (EDUCATION_KEYWORDS.some(k => lowerQuery.includes(k)) &&
           (keywords.length > 0 || /trading|stock|option|market|invest/i.test(lowerQuery))) {
    intent = 'education';
  }
  // Has ticker but no specific intent - default to stock analysis
  else if (tickers.length > 0) {
    intent = 'stock_analysis';
  }
  // Everything else is general
  else {
    intent = 'general';
  }

  return {
    raw: query,
    intent,
    tickers,
    keywords,
    isQuestion,
  };
}

/**
 * Generate a system prompt based on query intent
 */
export function getSystemPromptForIntent(intent: QueryIntent): string {
  switch (intent) {
    case 'stock_analysis':
      return `You are a professional stock analyst at Quant Edge Labs. Provide detailed technical and fundamental analysis.
Include: current price context, key levels, recent catalysts, institutional flow if relevant, and actionable insights.
Be specific with numbers and levels. Avoid generic advice.`;

    case 'trading_strategy':
      return `You are a trading strategist at Quant Edge Labs. Generate specific, actionable trade setups.
For every strategy, include:
- Entry price/criteria
- Target price(s) with rationale
- Stop-loss level
- Risk/reward ratio
- Position sizing suggestion
- Key catalysts or timing considerations
Format clearly with tables when appropriate.`;

    case 'market_question':
      return `You are a market analyst at Quant Edge Labs. Provide context on market conditions, sector rotation, and macro factors.
Connect current events to market movements. Be specific about sectors, indices, and timeframes.`;

    case 'education':
      return `You are a trading educator at Quant Edge Labs. Explain trading concepts clearly for both beginners and intermediate traders.
Use examples with real tickers when helpful. Break down complex topics into digestible parts.
Include practical applications, not just theory.`;

    case 'price_check':
      return `Provide the current price and brief context for the requested stock. Include today's change and any relevant recent news.`;

    case 'general':
    default:
      return `You are a helpful AI assistant at Quant Edge Labs, a trading research platform.
Answer questions accurately and thoroughly. If the question relates to trading or markets, provide that context.
For non-trading questions, still be helpful and informative.`;
  }
}

/**
 * Build context for the LLM based on intent
 */
export async function buildContextForQuery(parsedQuery: SearchQuery): Promise<string> {
  const contexts: string[] = [];

  // Add current date/time context
  const now = new Date();
  const etTime = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  contexts.push(`Current time: ${etTime} ET`);

  // For stock-related queries, we could fetch real data here
  if (parsedQuery.tickers.length > 0 && parsedQuery.intent !== 'general') {
    contexts.push(`Tickers mentioned: ${parsedQuery.tickers.join(', ')}`);
    // TODO: Fetch real-time quotes, recent news, options flow for these tickers
    // This would integrate with your existing services
  }

  // Add market context for trading/market queries
  if (['trading_strategy', 'market_question', 'stock_analysis'].includes(parsedQuery.intent)) {
    // TODO: Fetch current market conditions (SPY, VIX, sector performance)
    contexts.push('Note: Provide analysis based on current market conditions.');
  }

  return contexts.join('\n');
}

/**
 * Main search function - routes to appropriate handler
 */
export async function universalSearch(
  query: string,
  options: {
    includeWebSearch?: boolean;
    maxTokens?: number;
    userId?: string;
  } = {}
): Promise<SearchResult> {
  const startTime = Date.now();

  try {
    // Parse and classify the query
    const parsedQuery = parseQuery(query);
    logger.info(`[UNIVERSAL-SEARCH] Query: "${query}" | Intent: ${parsedQuery.intent} | Tickers: ${parsedQuery.tickers.join(', ') || 'none'}`);

    // Get appropriate system prompt
    const systemPrompt = getSystemPromptForIntent(parsedQuery.intent);

    // Build context
    const context = await buildContextForQuery(parsedQuery);

    // For now, return a structured response indicating what would happen
    // In production, this would call your LLM service
    const response = await generateResponse(parsedQuery, systemPrompt, context, options);

    return {
      type: parsedQuery.intent,
      query: query,
      response: response.text,
      sources: response.sources,
      relatedTickers: parsedQuery.tickers,
      suggestedFollowUps: generateFollowUps(parsedQuery),
      confidence: response.confidence,
      processingTime: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('[UNIVERSAL-SEARCH] Error:', error);
    return {
      type: 'general',
      query: query,
      response: 'I encountered an error processing your request. Please try again.',
      confidence: 0,
      processingTime: Date.now() - startTime,
    };
  }
}

/**
 * Generate response using LLM
 * This integrates with your existing multi-llm-service
 */
async function generateResponse(
  parsedQuery: SearchQuery,
  systemPrompt: string,
  context: string,
  options: { includeWebSearch?: boolean; maxTokens?: number }
): Promise<{ text: string; sources: { title: string; url?: string; type: string }[]; confidence: number }> {

  // Import your LLM service dynamically to avoid circular deps
  try {
    const { generateAI } = await import('./multi-llm-service');

    const fullPrompt = `${context}\n\nUser Query: ${parsedQuery.raw}`;

    const llmResponse = await generateAI(fullPrompt, {
      system: systemPrompt,
      mode: 'fallback',
      strategy: 'quality',
    });

    return {
      text: llmResponse || 'No response generated.',
      sources: [],
      confidence: 85,
    };
  } catch (error) {
    logger.error('[UNIVERSAL-SEARCH] LLM call failed:', error);

    // Fallback response based on intent
    return {
      text: getFallbackResponse(parsedQuery),
      sources: [],
      confidence: 50,
    };
  }
}

/**
 * Generate fallback response if LLM fails
 */
function getFallbackResponse(parsedQuery: SearchQuery): string {
  switch (parsedQuery.intent) {
    case 'stock_analysis':
      return `To analyze ${parsedQuery.tickers.join(', ')}, I recommend checking the stock detail page for real-time charts, technical indicators, and AI analysis.`;
    case 'trading_strategy':
      return `For trading strategies, check out our Trade Desk which has AI-generated setups with entry, target, and stop-loss levels.`;
    case 'price_check':
      return `For real-time prices, use the search bar to go directly to the stock page for ${parsedQuery.tickers.join(', ')}.`;
    default:
      return `I'm having trouble generating a response right now. Please try your question again or rephrase it.`;
  }
}

/**
 * Generate follow-up suggestions based on query
 */
function generateFollowUps(parsedQuery: SearchQuery): string[] {
  const followUps: string[] = [];

  if (parsedQuery.tickers.length > 0) {
    const ticker = parsedQuery.tickers[0];

    if (parsedQuery.intent === 'stock_analysis') {
      followUps.push(`What's the options flow for ${ticker}?`);
      followUps.push(`${ticker} earnings history`);
      followUps.push(`Technical setup for ${ticker}`);
    } else if (parsedQuery.intent === 'trading_strategy') {
      followUps.push(`${ticker} risk/reward analysis`);
      followUps.push(`Alternative plays on ${ticker}`);
      followUps.push(`${ticker} vs sector performance`);
    }
  }

  if (parsedQuery.intent === 'education') {
    followUps.push('Show me a real example');
    followUps.push('What are common mistakes?');
    followUps.push('Advanced strategies for this');
  }

  if (parsedQuery.intent === 'general') {
    followUps.push('How does this relate to trading?');
    followUps.push('Tell me more');
  }

  return followUps.slice(0, 3);
}

/**
 * Quick intent check for routing (fast, no LLM call)
 */
export function quickIntentCheck(query: string): {
  hasTickerIntent: boolean;
  tickers: string[];
  suggestedRoute: 'stock' | 'search' | 'chat';
} {
  const parsed = parseQuery(query);

  return {
    hasTickerIntent: parsed.tickers.length > 0 && ['stock_analysis', 'price_check'].includes(parsed.intent),
    tickers: parsed.tickers,
    suggestedRoute: parsed.tickers.length > 0 && parsed.intent === 'stock_analysis'
      ? 'stock'
      : parsed.intent === 'general'
        ? 'chat'
        : 'search',
  };
}
