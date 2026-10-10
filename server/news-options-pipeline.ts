/**
 * News→Options Pipeline
 *
 * Monitors breaking news and generates high-conviction options trade ideas.
 * This catches early surge signals like RDW, USAR, BNAI that move on news.
 *
 * Flow: Breaking News → Validate Catalyst → Generate Options Idea → Trade Desk
 */

import { logger } from './logger';
import { fetchBreakingNews, type BreakingNewsArticle } from './news-service';
import { ingestTradeIdea, type IngestionInput } from './trade-idea-ingestion';
import { fetchStockPrice } from './market-api';

// Configuration
const NEWS_SCAN_INTERVAL_MS = 5 * 60 * 1000; // Scan every 5 minutes
const MIN_SENTIMENT_SCORE = 0.4; // Minimum sentiment for options play (0-1 scale)
const MIN_PRICE_FOR_OPTIONS = 5; // Don't play options on penny stocks

// Track processed news to avoid duplicates
const processedNewsIds = new Set<string>();
const MAX_PROCESSED_CACHE = 500;

// Catalyst types that warrant options plays
const HIGH_CONVICTION_CATALYSTS = [
  'earnings beat', 'guidance raised', 'fda approval', 'acquisition',
  'merger', 'contract awarded', 'partnership', 'regulatory approval',
  'breakthrough', 'record revenue', 'beat estimates', 'analyst upgrade'
];

const BEARISH_CATALYSTS = [
  'earnings miss', 'guidance lowered', 'fda rejection', 'lawsuit',
  'sec investigation', 'product recall', 'data breach', 'ceo departure',
  'downgrade', 'missed estimates', 'bankruptcy', 'fraud'
];

interface NewsOptionsIdea {
  symbol: string;
  direction: 'bullish' | 'bearish';
  optionType: 'call' | 'put';
  confidence: number;
  catalyst: string;
  newsUrl: string;
  suggestedExpiry: string; // "0DTE", "Weekly", "Monthly"
  strikeStrategy: 'ATM' | 'OTM' | 'ITM';
}

/**
 * Analyze a breaking news article and determine if it warrants an options play
 */
function analyzeNewsCatalyst(news: BreakingNewsArticle): NewsOptionsIdea | null {
  const { primaryTicker, tradingDirection, overallSentimentScore, title, summary, url, breakingReason } = news;

  if (!primaryTicker || primaryTicker.length > 5 || primaryTicker.includes('.')) {
    return null; // Skip invalid tickers
  }

  const combinedText = `${title} ${summary}`.toLowerCase();
  const sentimentStrength = Math.abs(overallSentimentScore);

  // Check for high-conviction catalysts
  const matchedBullish = HIGH_CONVICTION_CATALYSTS.filter(c => combinedText.includes(c));
  const matchedBearish = BEARISH_CATALYSTS.filter(c => combinedText.includes(c));

  // Determine if this is a high-conviction setup
  const isBullishCatalyst = matchedBullish.length > 0 && overallSentimentScore > MIN_SENTIMENT_SCORE;
  const isBearishCatalyst = matchedBearish.length > 0 && overallSentimentScore < -MIN_SENTIMENT_SCORE;

  if (!isBullishCatalyst && !isBearishCatalyst) {
    logger.debug(`[NEWS-OPTIONS] ${primaryTicker}: Sentiment ${sentimentStrength.toFixed(2)} too weak or no catalyst match`);
    return null;
  }

  // Calculate confidence based on sentiment + catalyst match strength
  let confidence = 60; // Base confidence

  // Sentiment boost
  if (sentimentStrength >= 0.6) confidence += 15;
  else if (sentimentStrength >= 0.5) confidence += 10;
  else if (sentimentStrength >= 0.4) confidence += 5;

  // Catalyst match boost
  const catalystCount = Math.max(matchedBullish.length, matchedBearish.length);
  confidence += catalystCount * 5;

  // Cap at 85% - news plays are inherently risky
  confidence = Math.min(85, confidence);

  // Determine option type and strategy
  const direction = isBullishCatalyst ? 'bullish' : 'bearish';
  const optionType = direction === 'bullish' ? 'call' : 'put';

  // Determine expiry suggestion based on catalyst type
  let suggestedExpiry = 'Weekly';
  const urgentKeywords = ['breaking', 'just announced', 'reported today', 'confirmed', 'alert'];
  if (urgentKeywords.some(k => combinedText.includes(k))) {
    suggestedExpiry = '0DTE';
  } else if (combinedText.includes('earnings') || combinedText.includes('fda')) {
    suggestedExpiry = 'Weekly';
  } else {
    suggestedExpiry = 'Monthly';
  }

  // OTM for quick momentum plays, ATM for higher probability
  const strikeStrategy = sentimentStrength >= 0.5 ? 'OTM' : 'ATM';

  const catalystDescription = direction === 'bullish'
    ? matchedBullish.join(', ')
    : matchedBearish.join(', ');

  logger.info(`[NEWS-OPTIONS] ✅ ${primaryTicker}: ${direction.toUpperCase()} ${optionType.toUpperCase()} - Confidence ${confidence}%`);
  logger.info(`[NEWS-OPTIONS]    Catalyst: ${catalystDescription}`);
  logger.info(`[NEWS-OPTIONS]    Strategy: ${strikeStrategy} ${suggestedExpiry}`);

  return {
    symbol: primaryTicker,
    direction,
    optionType,
    confidence,
    catalyst: `${title.slice(0, 100)}... | ${catalystDescription}`,
    newsUrl: url,
    suggestedExpiry,
    strikeStrategy
  };
}

/**
 * Generate trade idea from news options analysis and ingest to Trade Desk
 */
async function generateAndIngestOptionsIdea(idea: NewsOptionsIdea): Promise<boolean> {
  try {
    // Fetch current price
    const quote = await fetchStockPrice(idea.symbol);
    if (!quote || !quote.currentPrice) {
      logger.warn(`[NEWS-OPTIONS] Could not get price for ${idea.symbol}`);
      return false;
    }

    const currentPrice = quote.currentPrice;

    // Skip penny stocks
    if (currentPrice < MIN_PRICE_FOR_OPTIONS) {
      logger.info(`[NEWS-OPTIONS] Skipping ${idea.symbol} - price $${currentPrice.toFixed(2)} too low for options`);
      return false;
    }

    // Calculate entry, target, stop based on option type
    // Options need MEANINGFUL underlying moves to generate 30-100%+ profits
    const isCall = idea.optionType === 'call';

    // Target multipliers based on expiry - options are leveraged!
    // For a 50% option gain on OTM calls, you typically need 5-10% underlying move
    // For a 100% option gain, you need 8-15% underlying move
    const targetMultipliers: Record<string, number> = {
      '0DTE': isCall ? 1.08 : 0.92,    // 8% move for 50%+ option profit
      'Weekly': isCall ? 1.10 : 0.90,   // 10% move for 50%+ option profit
      'Monthly': isCall ? 1.15 : 0.85,  // 15% move for 50%+ option profit
    };

    const targetMultiplier = targetMultipliers[idea.suggestedExpiry] || (isCall ? 1.10 : 0.90);

    // Entry is current price
    const entryPrice = currentPrice;

    // Target based on expected move for meaningful option profit
    const targetPrice = isCall
      ? currentPrice * targetMultiplier
      : currentPrice * (2 - targetMultiplier); // Inverse for puts

    // Stop loss - 5% adverse move (options can go to zero, so tighter stops)
    const stopLoss = isCall
      ? currentPrice * 0.95  // 5% down for calls
      : currentPrice * 1.05; // 5% up for puts

    // Calculate expiry date
    const now = new Date();
    let expiryDate: string;
    if (idea.suggestedExpiry === '0DTE') {
      expiryDate = now.toISOString().split('T')[0];
    } else if (idea.suggestedExpiry === 'Weekly') {
      const nextFriday = new Date(now);
      nextFriday.setDate(now.getDate() + (5 - now.getDay() + 7) % 7 || 7);
      expiryDate = nextFriday.toISOString().split('T')[0];
    } else {
      const nextMonth = new Date(now);
      nextMonth.setMonth(now.getMonth() + 1);
      expiryDate = nextMonth.toISOString().split('T')[0];
    }

    // Build ingestion input
    const ingestionInput: IngestionInput = {
      source: 'news_catalyst',
      symbol: idea.symbol,
      assetType: 'option',
      direction: idea.direction,
      optionType: idea.optionType,
      signals: [
        { type: 'news_catalyst', weight: 20, description: `Breaking news: ${idea.catalyst.slice(0, 50)}` },
        { type: 'sentiment_strong', weight: 15, description: `Strong ${idea.direction} sentiment detected` },
        { type: 'momentum_expected', weight: 10, description: `${idea.suggestedExpiry} momentum play` }
      ],
      currentPrice,
      suggestedEntry: entryPrice,
      suggestedTarget: targetPrice,
      suggestedStop: stopLoss,
      holdingPeriod: idea.suggestedExpiry === '0DTE' ? 'day' : 'swing',
      catalyst: idea.catalyst,
      analysis: `News-driven ${idea.optionType.toUpperCase()} play. ${idea.strikeStrategy} strike recommended for ${idea.suggestedExpiry} expiry. Catalyst: ${idea.catalyst}`,
      sourceMetadata: {
        newsUrl: idea.newsUrl,
        suggestedExpiry: idea.suggestedExpiry,
        strikeStrategy: idea.strikeStrategy
      }
    };

    const result = await ingestTradeIdea(ingestionInput);

    if (result.success) {
      logger.info(`[NEWS-OPTIONS] ✅ Ingested ${idea.symbol} ${idea.optionType.toUpperCase()} to Trade Desk`);
      return true;
    } else {
      logger.warn(`[NEWS-OPTIONS] ⚠️ Ingestion failed for ${idea.symbol}: ${result.reason}`);
      return false;
    }

  } catch (error) {
    logger.error(`[NEWS-OPTIONS] Error generating idea for ${idea.symbol}:`, error);
    return false;
  }
}

/**
 * Run the news→options pipeline once
 */
export async function runNewsOptionsPipeline(): Promise<{
  newsScanned: number;
  ideasGenerated: number;
  ideasIngested: number;
}> {
  logger.info('[NEWS-OPTIONS] 🔍 Scanning for breaking news catalysts...');

  const results = {
    newsScanned: 0,
    ideasGenerated: 0,
    ideasIngested: 0
  };

  try {
    // Fetch recent breaking news
    const breakingNews = await fetchBreakingNews();
    results.newsScanned = breakingNews.length;

    if (breakingNews.length === 0) {
      logger.info('[NEWS-OPTIONS] No breaking news found');
      return results;
    }

    logger.info(`[NEWS-OPTIONS] Found ${breakingNews.length} breaking news articles`);

    // Process each breaking news article
    for (const news of breakingNews) {
      // Skip if already processed
      if (processedNewsIds.has(news.uuid)) {
        continue;
      }

      // Mark as processed
      processedNewsIds.add(news.uuid);

      // Clean up old entries
      if (processedNewsIds.size > MAX_PROCESSED_CACHE) {
        const toDelete = Array.from(processedNewsIds).slice(0, 100);
        toDelete.forEach(id => processedNewsIds.delete(id));
      }

      // Analyze for options play
      const optionsIdea = analyzeNewsCatalyst(news);
      if (!optionsIdea) {
        continue;
      }

      results.ideasGenerated++;

      // Generate and ingest the trade idea
      const ingested = await generateAndIngestOptionsIdea(optionsIdea);
      if (ingested) {
        results.ideasIngested++;
      }

      // Small delay between ingestions
      await new Promise(r => setTimeout(r, 500));
    }

    logger.info(`[NEWS-OPTIONS] Pipeline complete: ${results.ideasGenerated} ideas generated, ${results.ideasIngested} ingested`);

  } catch (error) {
    logger.error('[NEWS-OPTIONS] Pipeline error:', error);
  }

  return results;
}

// Interval handle for continuous monitoring
let newsOptionsInterval: NodeJS.Timeout | null = null;

/**
 * Start continuous news monitoring pipeline
 */
export function startNewsOptionsPipeline(intervalMs: number = NEWS_SCAN_INTERVAL_MS): void {
  if (newsOptionsInterval) {
    clearInterval(newsOptionsInterval);
  }

  logger.info(`[NEWS-OPTIONS] 🚀 Starting news→options pipeline (interval: ${intervalMs / 1000}s)`);

  // Run immediately
  runNewsOptionsPipeline();

  // Then run on interval
  newsOptionsInterval = setInterval(() => {
    runNewsOptionsPipeline();
  }, intervalMs);
}

/**
 * Stop the news monitoring pipeline
 */
export function stopNewsOptionsPipeline(): void {
  if (newsOptionsInterval) {
    clearInterval(newsOptionsInterval);
    newsOptionsInterval = null;
    logger.info('[NEWS-OPTIONS] 🛑 Pipeline stopped');
  }
}

/**
 * Get pipeline status
 */
export function getNewsOptionsPipelineStatus(): {
  running: boolean;
  processedCount: number;
} {
  return {
    running: newsOptionsInterval !== null,
    processedCount: processedNewsIds.size
  };
}
