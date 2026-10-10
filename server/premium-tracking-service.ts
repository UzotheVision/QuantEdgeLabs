/**
 * Premium Tracking Service
 * 
 * Tracks option premiums over time for watchlist symbols to help identify
 * good entry points when premiums are cheap vs expensive.
 */

import { storage } from './storage';
import { logger } from './logger';
import { formatInTimeZone } from 'date-fns-tz';
import type { InsertPremiumHistory, WatchlistItem } from '@shared/schema';

const CT_TIMEZONE = 'America/Chicago';

interface OptionQuote {
  symbol: string;
  strike: number;
  expiry: string;
  optionType: 'call' | 'put';
  bid: number;
  ask: number;
  last: number;
  iv: number;
  delta: number;
  underlyingPrice: number;
}

/**
 * Fetch option quote from Tradier API
 */
async function fetchOptionQuote(
  symbol: string,
  strike: number,
  expiry: string,
  optionType: 'call' | 'put'
): Promise<OptionQuote | null> {
  const apiKey = process.env.TRADIER_API_KEY;
  if (!apiKey) {
    logger.warn('[PREMIUM] Tradier API key not configured');
    return null;
  }

  try {
    // Format expiry for Tradier (YYMMDD)
    const expiryParts = expiry.split('-');
    const expiryFormatted = expiryParts[0].slice(2) + expiryParts[1] + expiryParts[2];
    
    // Build OCC option symbol
    const strikeFormatted = String(strike * 1000).padStart(8, '0');
    const optionSymbol = `${symbol}${expiryFormatted}${optionType === 'call' ? 'C' : 'P'}${strikeFormatted}`;

    // Fetch from Tradier
    const response = await fetch(
      `https://api.tradier.com/v1/markets/quotes?symbols=${optionSymbol}&greeks=true`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      logger.warn(`[PREMIUM] Tradier API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const quote = data.quotes?.quote;
    
    if (!quote) {
      logger.debug(`[PREMIUM] No quote found for ${optionSymbol}`);
      return null;
    }

    return {
      symbol,
      strike,
      expiry,
      optionType,
      bid: quote.bid || 0,
      ask: quote.ask || 0,
      last: quote.last || ((quote.bid + quote.ask) / 2),
      iv: quote.greeks?.mid_iv || 0,
      delta: quote.greeks?.delta || 0,
      underlyingPrice: quote.underlying_last || 0
    };
  } catch (error) {
    logger.error(`[PREMIUM] Error fetching quote for ${symbol}: ${error}`);
    return null;
  }
}

/**
 * Calculate percentile rank of current premium vs history
 */
function calculatePercentileRank(currentPremium: number, history: number[]): number {
  if (history.length === 0) return 50;
  
  const sorted = [...history].sort((a, b) => a - b);
  const belowCount = sorted.filter(p => p < currentPremium).length;
  
  return Math.round((belowCount / sorted.length) * 100);
}

/**
 * Track premiums for a single watchlist item
 */
export async function trackPremiumForItem(item: WatchlistItem): Promise<boolean> {
  if (!item.trackPremiums || !item.preferredStrike || !item.preferredExpiry) {
    return false;
  }

  const quote = await fetchOptionQuote(
    item.symbol,
    item.preferredStrike,
    item.preferredExpiry,
    item.preferredOptionType || 'call'
  );

  if (!quote) {
    return false;
  }

  const now = new Date();
  const snapshotDate = formatInTimeZone(now, CT_TIMEZONE, 'yyyy-MM-dd');
  const snapshotTime = formatInTimeZone(now, CT_TIMEZONE, 'HH:mm');

  // Get premium history for percentile calculation
  const history = await storage.getPremiumHistory(item.id, 90); // Last 90 days
  const historicalPremiums = history.map(h => h.premium);
  
  // Calculate analytics
  const percentileRank = calculatePercentileRank(quote.last, historicalPremiums);
  const avgPremium30d = historicalPremiums.length > 0
    ? historicalPremiums.slice(0, 30).reduce((a, b) => a + b, 0) / Math.min(historicalPremiums.length, 30)
    : quote.last;
  
  const lastSnapshot = history[0];
  const premiumChange = lastSnapshot 
    ? ((quote.last - lastSnapshot.premium) / lastSnapshot.premium) * 100 
    : 0;
  const premiumChangeDollar = lastSnapshot 
    ? quote.last - lastSnapshot.premium 
    : 0;

  // Store snapshot
  const snapshot: InsertPremiumHistory = {
    watchlistId: item.id,
    symbol: item.symbol,
    optionType: item.preferredOptionType || 'call',
    strikePrice: item.preferredStrike,
    expirationDate: item.preferredExpiry,
    premium: quote.last,
    underlyingPrice: quote.underlyingPrice,
    impliedVolatility: quote.iv,
    delta: quote.delta,
    snapshotDate,
    snapshotTime,
    premiumChange,
    premiumChangeDollar,
    avgPremium30d,
    percentileRank
  };

  await storage.createPremiumSnapshot(snapshot);

  // Update watchlist item with latest premium info
  await storage.updateWatchlistPremium(item.id, {
    lastPremium: quote.last,
    lastPremiumDate: snapshotDate,
    avgPremium: avgPremium30d,
    premiumPercentile: percentileRank
  });

  // Check if premium hit alert threshold
  if (item.premiumAlertThreshold && quote.last <= item.premiumAlertThreshold) {
    logger.info(`[PREMIUM ALERT] ${item.symbol} premium ($${quote.last.toFixed(2)}) hit threshold ($${item.premiumAlertThreshold.toFixed(2)})`);
    // Could send Discord alert here
  }

  logger.debug(`[PREMIUM] Tracked ${item.symbol}: $${quote.last.toFixed(2)} (${percentileRank}th percentile)`);
  return true;
}

/**
 * Track premiums for all enabled watchlist items
 */
export async function trackAllPremiums(): Promise<{ tracked: number; failed: number }> {
  const items = await storage.getWatchlistItemsWithPremiumTracking();
  
  let tracked = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const success = await trackPremiumForItem(item);
      if (success) tracked++;
      else failed++;
      
      // Rate limit to avoid API throttling
      await new Promise(r => setTimeout(r, 200));
    } catch (error) {
      logger.error(`[PREMIUM] Error tracking ${item.symbol}: ${error}`);
      failed++;
    }
  }

  logger.info(`[PREMIUM] Tracked ${tracked} items, ${failed} failed`);
  return { tracked, failed };
}

/**
 * Get premium trend summary for a watchlist item
 */
export async function getPremiumTrend(watchlistId: string): Promise<{
  current: number | null;
  percentile: number | null;
  trend: 'rising' | 'falling' | 'stable';
  change7d: number | null;
  change30d: number | null;
  isOpportunity: boolean;
  avg30d: number | null;
  history: Array<{ date: string; premium: number; avgPremium30d?: number | null }>;
}> {
  const history = await storage.getPremiumHistory(watchlistId, 90);
  
  if (history.length === 0) {
    return {
      current: null,
      percentile: null,
      trend: 'stable',
      change7d: null,
      change30d: null,
      isOpportunity: false,
      avg30d: null,
      history: []
    };
  }

  const current = history[0].premium;
  const percentile = history[0].percentileRank;
  
  // Calculate 7-day and 30-day changes
  const week = history.filter(h => {
    const daysAgo = Math.floor((Date.now() - new Date(h.snapshotDate).getTime()) / (1000 * 60 * 60 * 24));
    return daysAgo <= 7;
  });
  const month = history.filter(h => {
    const daysAgo = Math.floor((Date.now() - new Date(h.snapshotDate).getTime()) / (1000 * 60 * 60 * 24));
    return daysAgo <= 30;
  });

  const change7d = week.length > 1 
    ? ((current - week[week.length - 1].premium) / week[week.length - 1].premium) * 100 
    : null;
  const change30d = month.length > 1 
    ? ((current - month[month.length - 1].premium) / month[month.length - 1].premium) * 100 
    : null;

  // Determine trend
  let trend: 'rising' | 'falling' | 'stable' = 'stable';
  if (change7d !== null) {
    if (change7d > 5) trend = 'rising';
    else if (change7d < -5) trend = 'falling';
  }

  // Opportunity = low percentile (cheap) + falling trend
  const isOpportunity = (percentile !== null && percentile < 25) || 
                        (trend === 'falling' && change7d !== null && change7d < -10);

  // Get stored 30-day average from most recent snapshot
  const avg30d = history[0].avgPremium30d ?? null;
  
  return {
    current,
    percentile,
    trend,
    change7d,
    change30d,
    isOpportunity,
    avg30d,
    history: history.slice(0, 30).map(h => ({
      date: h.snapshotDate,
      premium: h.premium,
      avgPremium30d: h.avgPremium30d
    }))
  };
}

/**
 * Check all watchlist items for premium buying opportunities and send Discord alerts
 */
export async function checkPremiumOpportunities(): Promise<void> {
  const items = await storage.getWatchlistItemsWithPremiumTracking();
  const opportunities: Array<{
    symbol: string;
    percentile: number;
    currentPremium: number;
    avg30d: number | null;
    change7d: number | null;
    strike?: string;
    expiry?: string;
  }> = [];
  
  for (const item of items) {
    try {
      const trend = await getPremiumTrend(item.id);
      
      // Only alert on genuine opportunities (25th percentile or lower = cheap premiums)
      if (trend.isOpportunity && trend.current !== null && trend.percentile !== null) {
        opportunities.push({
          symbol: item.symbol,
          percentile: trend.percentile,
          currentPremium: trend.current,
          avg30d: trend.avg30d,
          change7d: trend.change7d,
          strike: item.preferredStrike?.toString() ?? undefined,
          expiry: item.preferredExpiry ?? undefined
        });
      }
    } catch (error) {
      logger.error(`[PREMIUM] Error checking ${item.symbol} for opportunities: ${error}`);
    }
  }
  
  if (opportunities.length === 0) {
    logger.info('[PREMIUM] No premium opportunities found today');
    return;
  }
  
  // Sort by percentile (cheapest first)
  opportunities.sort((a, b) => a.percentile - b.percentile);
  
  // Send Discord alert
  try {
    const { sendDiscordAlert } = await import('./discord-service');
    
    // Build alert message with opportunities
    const oppsText = opportunities.slice(0, 10).map(opp => {
      const parts = [
        `**${opp.symbol}** - ${opp.percentile}th percentile`,
        `Current: $${opp.currentPremium.toFixed(2)}`
      ];
      if (opp.avg30d) parts.push(`30d Avg: $${opp.avg30d.toFixed(2)}`);
      if (opp.change7d) parts.push(`7d: ${opp.change7d > 0 ? '+' : ''}${opp.change7d.toFixed(1)}%`);
      return parts.join(' | ');
    }).join('\n');
    
    const message = `💰 **Premium Buying Opportunities**\n\nFound ${opportunities.length} watchlist items with historically cheap premiums:\n\n${oppsText}\n\n_Lower percentile = cheaper than usual. Consider buying when premiums are cheap!_`;
    
    await sendDiscordAlert(message, 'info');
    
    logger.info(`[PREMIUM] Sent Discord alert for ${opportunities.length} premium opportunities`);
  } catch (discordError) {
    logger.error('[PREMIUM] Failed to send Discord alert:', discordError);
  }
}
