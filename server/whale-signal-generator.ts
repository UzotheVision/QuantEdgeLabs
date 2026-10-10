/**
 * Whale Signal Generator
 * 
 * Converts massive options flow ($1M+) into actionable trade signals.
 * When whales are loading up on calls/puts with millions in premium,
 * that's a strong directional indicator.
 */

import { logger } from './logger';
import { db } from './db';
import { optionsFlowHistory, tradeIdeas } from '@shared/schema';
import { eq, desc, gte, and, sql } from 'drizzle-orm';

// Signal thresholds
const SIGNAL_MIN_PREMIUM = 500000;    // $500k minimum to generate signal
const STRONG_SIGNAL_PREMIUM = 1000000; // $1M = strong signal
const MEGA_SIGNAL_PREMIUM = 5000000;   // $5M = mega signal (very rare, high conviction)

export interface WhaleSignal {
  symbol: string;
  direction: 'CALL' | 'PUT';
  conviction: 'moderate' | 'strong' | 'mega';
  totalPremium: number;
  flowCount: number;
  avgStrike: number;
  primaryExpiration: string;
  dteCategory: string;
  reasoning: string;
  detectedAt: string;
}

/**
 * Scan today's whale flow and generate directional signals
 */
export async function generateWhaleSignals(): Promise<WhaleSignal[]> {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get all significant flows from today ($100k+)
    const flows = await db.select()
      .from(optionsFlowHistory)
      .where(
        and(
          gte(optionsFlowHistory.totalPremium, 100000),
          eq(optionsFlowHistory.detectedDate, today)
        )
      )
      .orderBy(desc(optionsFlowHistory.totalPremium));

    if (flows.length === 0) {
      logger.info('[WHALE-SIGNAL] No significant flows today');
      return [];
    }

    // Aggregate by symbol + direction
    const aggregated = new Map<string, {
      symbol: string;
      direction: 'CALL' | 'PUT';
      totalPremium: number;
      flowCount: number;
      strikes: number[];
      expirations: string[];
      dteCategories: string[];
    }>();

    for (const flow of flows) {
      const key = `${flow.symbol}-${flow.optionType.toUpperCase()}`;
      
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          symbol: flow.symbol,
          direction: flow.optionType.toUpperCase() as 'CALL' | 'PUT',
          totalPremium: 0,
          flowCount: 0,
          strikes: [],
          expirations: [],
          dteCategories: [],
        });
      }

      const entry = aggregated.get(key)!;
      entry.totalPremium += flow.totalPremium || 0;
      entry.flowCount++;
      entry.strikes.push(flow.strikePrice);
      entry.expirations.push(flow.expirationDate);
      if (flow.dteCategory) entry.dteCategories.push(flow.dteCategory);
    }

    // Generate signals from aggregated flow
    const signals: WhaleSignal[] = [];

    for (const [_, data] of Array.from(aggregated.entries())) {
      // Only generate signal if total premium meets threshold
      if (data.totalPremium < SIGNAL_MIN_PREMIUM) continue;

      // Determine conviction level
      let conviction: 'moderate' | 'strong' | 'mega';
      if (data.totalPremium >= MEGA_SIGNAL_PREMIUM) {
        conviction = 'mega';
      } else if (data.totalPremium >= STRONG_SIGNAL_PREMIUM) {
        conviction = 'strong';
      } else {
        conviction = 'moderate';
      }

      // Calculate average strike
      const avgStrike = data.strikes.reduce((a, b) => a + b, 0) / data.strikes.length;

      // Find most common expiration
      const expCounts = new Map<string, number>();
      for (const exp of data.expirations) {
        expCounts.set(exp, (expCounts.get(exp) || 0) + 1);
      }
      const primaryExpiration = Array.from(expCounts.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] || data.expirations[0];

      // Find most common DTE category
      const dteCounts = new Map<string, number>();
      for (const dte of data.dteCategories) {
        dteCounts.set(dte, (dteCounts.get(dte) || 0) + 1);
      }
      const primaryDte = Array.from(dteCounts.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'swing';

      // Build reasoning
      const premiumStr = formatPremium(data.totalPremium);
      const reasoning = buildReasoning(data.symbol, data.direction, data.totalPremium, data.flowCount, primaryDte);

      signals.push({
        symbol: data.symbol,
        direction: data.direction,
        conviction,
        totalPremium: data.totalPremium,
        flowCount: data.flowCount,
        avgStrike: Math.round(avgStrike * 100) / 100,
        primaryExpiration,
        dteCategory: primaryDte,
        reasoning,
        detectedAt: new Date().toISOString(),
      });
    }

    // Sort by total premium (biggest whales first)
    signals.sort((a, b) => b.totalPremium - a.totalPremium);

    logger.info(`[WHALE-SIGNAL] Generated ${signals.length} whale signals`);
    return signals;

  } catch (error) {
    logger.error('[WHALE-SIGNAL] Error generating signals:', error);
    return [];
  }
}

/**
 * Format premium for display
 */
function formatPremium(premium: number): string {
  if (premium >= 1000000000) {
    return `$${(premium / 1000000000).toFixed(2)}B`;
  } else if (premium >= 1000000) {
    return `$${(premium / 1000000).toFixed(2)}M`;
  } else if (premium >= 1000) {
    return `$${(premium / 1000).toFixed(0)}K`;
  }
  return `$${premium.toFixed(0)}`;
}

/**
 * Build human-readable reasoning for the signal
 */
function buildReasoning(
  symbol: string, 
  direction: 'CALL' | 'PUT', 
  premium: number, 
  flowCount: number,
  dteCategory: string
): string {
  const premiumStr = formatPremium(premium);
  const directionWord = direction === 'CALL' ? 'bullish' : 'bearish';
  const convictionWord = premium >= MEGA_SIGNAL_PREMIUM ? 'MEGA' : 
                         premium >= STRONG_SIGNAL_PREMIUM ? 'STRONG' : 'significant';

  let timeframe = '';
  switch (dteCategory) {
    case '0DTE': timeframe = 'same-day expiration (0DTE)'; break;
    case '1-2DTE': timeframe = 'near-term (1-2 DTE)'; break;
    case '3-7DTE': timeframe = 'weekly timeframe'; break;
    case 'swing': timeframe = 'swing timeframe (8-30 DTE)'; break;
    case 'monthly': timeframe = 'monthly timeframe'; break;
    case 'leaps': timeframe = 'LEAPS (long-term)'; break;
    default: timeframe = 'mixed timeframes';
  }

  return `🐋 ${convictionWord.toUpperCase()} WHALE SIGNAL: ${premiumStr} in ${symbol} ${direction}S across ${flowCount} flow(s). ` +
         `Institutions are placing ${directionWord} bets targeting ${timeframe}. ` +
         `This level of premium indicates serious conviction from smart money.`;
}

/**
 * Get signals that could be converted to trade ideas
 * Only returns signals that pass quality filters
 */
export async function getActionableWhaleSignals(): Promise<WhaleSignal[]> {
  const signals = await generateWhaleSignals();
  
  // Filter to only strong/mega conviction signals
  return signals.filter(s => s.conviction !== 'moderate' || s.totalPremium >= 750000);
}

/**
 * Check if a symbol has strong whale flow today
 * Useful for boosting confidence in other signals
 */
export async function getWhaleFlowBoost(symbol: string): Promise<{
  hasWhaleFlow: boolean;
  direction: 'CALL' | 'PUT' | null;
  conviction: 'moderate' | 'strong' | 'mega' | null;
  premium: number;
}> {
  const signals = await generateWhaleSignals();
  const symbolSignals = signals.filter(s => s.symbol.toUpperCase() === symbol.toUpperCase());

  if (symbolSignals.length === 0) {
    return { hasWhaleFlow: false, direction: null, conviction: null, premium: 0 };
  }

  // Return the strongest signal for this symbol
  const strongest = symbolSignals.sort((a, b) => b.totalPremium - a.totalPremium)[0];
  
  return {
    hasWhaleFlow: true,
    direction: strongest.direction,
    conviction: strongest.conviction,
    premium: strongest.totalPremium,
  };
}

logger.info('[WHALE-SIGNAL] 🐋 Whale Signal Generator initialized');
