import { storage } from "./storage";
import { type CTMention, type CTSource } from "@shared/schema";

/**
 * Register a new influencer/source
 */
export async function addCTSource(name: string, platform: any, url?: string, followerCount?: number): Promise<CTSource> {
  return await storage.createCTSource({
    platform,
    handle: url || "",
    displayName: name,
    followersCount: followerCount || 0,
    isActive: true,
  });
}

/**
 * Simple rule-based sentiment analysis
 */
function analyzeSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const bullishWords = ["moon", "pump", "long", "buy", "bullish", "ape", "🚀", "📈"];
  const bearishWords = ["dump", "short", "sell", "bearish", "rekt", "📉"];

  const lowercaseText = text.toLowerCase();
  
  const isBullish = bullishWords.some(word => lowercaseText.includes(word));
  const isBearish = bearishWords.some(word => lowercaseText.includes(word));

  if (isBullish && !isBearish) return 'bullish';
  if (isBearish && !isBullish) return 'bearish';
  return 'neutral';
}

/**
 * Parse a post for ticker mentions and sentiment
 */
export async function parseCTMention(text: string, sourceId: string, timestamp?: string): Promise<CTMention[]> {
  // Ticker Parsing Rules:
  // - Match $TICKER format (e.g., $BTC, $ETH, $SOL)
  // - Match TICKER/USD or TICKER/USDT pairs
  // - Ignore common words that look like tickers
  
  const tickers = new Set<string>();
  
  // $TICKER
  const cashtagRegex = /\$([A-Z]{2,10})/g;
  let match;
  while ((match = cashtagRegex.exec(text.toUpperCase())) !== null) {
    tickers.add(match[1]);
  }

  // TICKER/USD or TICKER/USDT
  const pairRegex = /\b([A-Z]{2,10})\/(USD|USDT)\b/g;
  while ((match = pairRegex.exec(text.toUpperCase())) !== null) {
    tickers.add(match[1]);
  }

  const commonWords = new Set(["THE", "AND", "FOR", "ARE", "BUT", "NOT", "YOU", "ALL", "ANY", "CAN", "HAD", "WAS", "NEW", "NOW", "ONE", "OUT", "SET", "WHO", "WHY"]);
  
  const createdMentions: CTMention[] = [];
  const sentiment = analyzeSentiment(text);
  const tickerArray = Array.from(tickers).filter(t => !commonWords.has(t));

  if (tickerArray.length > 0) {
    const mention = await storage.createCTMention({
      sourceId,
      postText: text,
      tickers: tickerArray,
      sentiment,
      postedAt: timestamp || new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    });
    createdMentions.push(mention);
  }

  return createdMentions;
}

/**
 * Fetch latest posts from source
 * No real social media API integrated — returns without generating fake posts
 */
export async function fetchAndStoreMentions(_sourceId: string): Promise<void> {
  // No-op: no real social media feed connected
  return;
}

/**
 * Get mentions from the last N hours
 */
export async function getRecentMentions(hours: number): Promise<CTMention[]> {
  return await storage.getCTMentions(hours);
}

/**
 * Get most mentioned tickers
 */
export async function getTopTickers(limit: number): Promise<{ ticker: string, count: number }[]> {
  const mentions = await storage.getCTMentions(24); // Last 24 hours
  const counts: Record<string, number> = {};
  
  mentions.forEach(m => {
    (m.tickers || []).forEach(ticker => {
      counts[ticker] = (counts[ticker] || 0) + 1;
    });
  });

  return Object.entries(counts)
    .map(([ticker, count]) => ({ ticker, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Update call performance after price check
 */
export async function trackCallPerformance(mentionId: any): Promise<void> {
  const mentions = await storage.getCTMentions();
  const mention = mentions.find(m => m.id === mentionId);
  if (!mention) return;

  // In a real app, we'd fetch the live price for mention.ticker
  // For this mock, we'll assume currentPrice is slightly different from entry
  const mockEntryPrice = 100;
  const mockCurrentPrice = mention.sentiment === 'bullish' ? 110 : 90;
  const pnlPercent = ((mockCurrentPrice - mockEntryPrice) / mockEntryPrice) * 100;

  await storage.updateCTCallPerformance(mentionId, {
    symbol: mention.tickers?.[0] || "UNKNOWN",
    direction: mention.sentiment === 'bearish' ? 'short' : 'long',
    callPrice: mockEntryPrice,
    exitPrice: mockCurrentPrice,
    pnlPercent,
    outcome: pnlPercent > 0 ? 'win' : 'loss',
    resolvedAt: new Date().toISOString(),
  });
}

/**
 * Generate CT data — disabled, no real social media feed connected.
 * Previously generated fabricated posts. Now returns immediately.
 */
export async function generateMockCTData(_hours: number = 24): Promise<void> {
  // No-op: mock data generation disabled
  return;
}

// Export all functions
export default {
  addCTSource,
  parseCTMention,
  fetchAndStoreMentions,
  getRecentMentions,
  getTopTickers,
  trackCallPerformance,
  generateMockCTData
};
