/**
 * Whale Flow Service
 * 
 * Tracks large institutional options flow and calculates directional bias.
 * Whale = $100k+ premium per trade
 * Directionality = Net bullish vs bearish sentiment from whale activity
 */

import { logger } from './logger';
import { db } from './db';
import { optionsFlowHistory } from '@shared/schema';
import { eq, desc, gte, and, sql, between } from 'drizzle-orm';

// Whale thresholds (lowered for educational purposes to capture more flow data)
const WHALE_MIN_PREMIUM = 25000;   // $25k minimum for whale classification
const MEGA_WHALE_PREMIUM = 100000; // $100k+ = mega whale (institutional block)
const ULTRA_WHALE_PREMIUM = 500000; // $500k+ = ultra whale (major institution)

export interface WhaleFlow {
  id: number | string;
  symbol: string;
  optionType: 'call' | 'put';
  strikePrice: number;
  expirationDate: string;
  premium: number;
  totalPremium: number;
  volume: number;
  delta: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  flowType: string;
  unusualScore: number;
  whaleSize: 'whale' | 'mega' | 'ultra';
  dteCategory: string;
  detectedAt: string;
  detectedDate: string;
}

export interface DirectionalSummary {
  symbol: string;
  netCallPremium: number;      // Total call premium - put premium
  netPutPremium: number;       // Total put premium
  totalCallPremium: number;
  totalPutPremium: number;
  callCount: number;
  putCount: number;
  netDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  directionStrength: number;   // 0-100 strength of conviction
  whaleCount: number;
  megaWhaleCount: number;
  ultraWhaleCount: number;
  lastActivity: string;
}

export interface MarketDirectionality {
  overallDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  overallStrength: number;
  totalCallPremium: number;
  totalPutPremium: number;
  netPremium: number;
  topBullishSymbols: DirectionalSummary[];
  topBearishSymbols: DirectionalSummary[];
  recentWhaleFlows: WhaleFlow[];
  timestamp: string;
}

/**
 * Classify whale size by premium
 */
function classifyWhaleSize(premium: number): 'whale' | 'mega' | 'ultra' {
  if (premium >= ULTRA_WHALE_PREMIUM) return 'ultra';
  if (premium >= MEGA_WHALE_PREMIUM) return 'mega';
  return 'whale';
}

/**
 * Calculate direction strength (0-100) based on call/put ratio
 */
function calculateDirectionStrength(callPremium: number, putPremium: number): number {
  const total = callPremium + putPremium;
  if (total === 0) return 0;
  
  const diff = Math.abs(callPremium - putPremium);
  const ratio = diff / total;
  
  // Scale to 0-100, with 50+ being significant
  return Math.min(100, Math.round(ratio * 100));
}

/**
 * Determine net direction from call/put premium
 */
function determineDirection(callPremium: number, putPremium: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const strength = calculateDirectionStrength(callPremium, putPremium);
  
  // Need at least 10% difference to be directional
  if (strength < 10) return 'NEUTRAL';
  
  return callPremium > putPremium ? 'BULLISH' : 'BEARISH';
}

/**
 * Get whale flows from database for a specific date range
 */
export async function getWhaleFlows(options: {
  symbol?: string;
  startDate?: string;
  endDate?: string;
  minPremium?: number;
  limit?: number;
}): Promise<WhaleFlow[]> {
  const { 
    symbol, 
    startDate, 
    endDate,
    minPremium = WHALE_MIN_PREMIUM,
    limit = 100 
  } = options;

  try {
    const today = new Date().toISOString().split('T')[0];
    const start = startDate || today;
    const end = endDate || today;

    let query = db.select()
      .from(optionsFlowHistory)
      .where(
        and(
          gte(optionsFlowHistory.totalPremium, minPremium),
          gte(optionsFlowHistory.detectedDate, start),
          sql`${optionsFlowHistory.detectedDate} <= ${end}`
        )
      )
      .orderBy(desc(optionsFlowHistory.totalPremium))
      .limit(limit);

    if (symbol) {
      query = db.select()
        .from(optionsFlowHistory)
        .where(
          and(
            eq(optionsFlowHistory.symbol, symbol.toUpperCase()),
            gte(optionsFlowHistory.totalPremium, minPremium),
            gte(optionsFlowHistory.detectedDate, start),
            sql`${optionsFlowHistory.detectedDate} <= ${end}`
          )
        )
        .orderBy(desc(optionsFlowHistory.totalPremium))
        .limit(limit);
    }

    const flows = await query;

    return flows.map(f => ({
      id: f.id,
      symbol: f.symbol,
      optionType: f.optionType as 'call' | 'put',
      strikePrice: f.strikePrice,
      expirationDate: f.expirationDate,
      premium: f.premium || 0,
      totalPremium: f.totalPremium || 0,
      volume: f.volume,
      delta: f.delta || 0,
      sentiment: (f.sentiment || 'neutral') as 'bullish' | 'bearish' | 'neutral',
      flowType: f.flowType || 'normal',
      unusualScore: f.unusualScore || 0,
      whaleSize: classifyWhaleSize(f.totalPremium || 0),
      dteCategory: f.dteCategory || 'swing',
      detectedAt: f.detectedAt?.toISOString() || '',
      detectedDate: f.detectedDate || today,
    }));
  } catch (error) {
    logger.error('[WHALE-FLOW] Error fetching whale flows:', error);
    return [];
  }
}

/**
 * Get directional summary for a symbol
 */
export async function getSymbolDirectionality(symbol: string, date?: string): Promise<DirectionalSummary | null> {
  try {
    const targetDate = date || new Date().toISOString().split('T')[0];

    const flows = await db.select()
      .from(optionsFlowHistory)
      .where(
        and(
          eq(optionsFlowHistory.symbol, symbol.toUpperCase()),
          gte(optionsFlowHistory.totalPremium, WHALE_MIN_PREMIUM),
          eq(optionsFlowHistory.detectedDate, targetDate)
        )
      );

    if (flows.length === 0) return null;

    let totalCallPremium = 0;
    let totalPutPremium = 0;
    let callCount = 0;
    let putCount = 0;
    let megaCount = 0;
    let ultraCount = 0;
    let lastActivity = '';

    for (const f of flows) {
      const premium = f.totalPremium || 0;
      
      if (f.optionType === 'call') {
        totalCallPremium += premium;
        callCount++;
      } else {
        totalPutPremium += premium;
        putCount++;
      }

      if (premium >= ULTRA_WHALE_PREMIUM) ultraCount++;
      else if (premium >= MEGA_WHALE_PREMIUM) megaCount++;

      const detected = f.detectedAt?.toISOString() || '';
      if (detected > lastActivity) lastActivity = detected;
    }

    return {
      symbol: symbol.toUpperCase(),
      netCallPremium: totalCallPremium - totalPutPremium,
      netPutPremium: totalPutPremium,
      totalCallPremium,
      totalPutPremium,
      callCount,
      putCount,
      netDirection: determineDirection(totalCallPremium, totalPutPremium),
      directionStrength: calculateDirectionStrength(totalCallPremium, totalPutPremium),
      whaleCount: flows.length,
      megaWhaleCount: megaCount,
      ultraWhaleCount: ultraCount,
      lastActivity,
    };
  } catch (error) {
    logger.error(`[WHALE-FLOW] Error getting directionality for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get overall market directionality from whale flow
 */
export async function getMarketDirectionality(date?: string): Promise<MarketDirectionality> {
  try {
    const targetDate = date || new Date().toISOString().split('T')[0];

    const flows = await db.select()
      .from(optionsFlowHistory)
      .where(
        and(
          gte(optionsFlowHistory.totalPremium, WHALE_MIN_PREMIUM),
          eq(optionsFlowHistory.detectedDate, targetDate)
        )
      )
      .orderBy(desc(optionsFlowHistory.totalPremium));

    // Aggregate by symbol
    const symbolMap = new Map<string, {
      calls: number;
      puts: number;
      callCount: number;
      putCount: number;
      megaCount: number;
      ultraCount: number;
      lastActivity: string;
    }>();

    let totalCallPremium = 0;
    let totalPutPremium = 0;

    for (const f of flows) {
      const premium = f.totalPremium || 0;
      const symbol = f.symbol;

      if (!symbolMap.has(symbol)) {
        symbolMap.set(symbol, { 
          calls: 0, puts: 0, callCount: 0, putCount: 0, 
          megaCount: 0, ultraCount: 0, lastActivity: '' 
        });
      }

      const entry = symbolMap.get(symbol)!;
      
      if (f.optionType === 'call') {
        entry.calls += premium;
        entry.callCount++;
        totalCallPremium += premium;
      } else {
        entry.puts += premium;
        entry.putCount++;
        totalPutPremium += premium;
      }

      if (premium >= ULTRA_WHALE_PREMIUM) entry.ultraCount++;
      else if (premium >= MEGA_WHALE_PREMIUM) entry.megaCount++;

      const detected = f.detectedAt?.toISOString() || '';
      if (detected > entry.lastActivity) entry.lastActivity = detected;
    }

    // Build per-symbol summaries
    const summaries: DirectionalSummary[] = [];
    for (const [symbol, data] of Array.from(symbolMap.entries())) {
      summaries.push({
        symbol,
        netCallPremium: data.calls - data.puts,
        netPutPremium: data.puts,
        totalCallPremium: data.calls,
        totalPutPremium: data.puts,
        callCount: data.callCount,
        putCount: data.putCount,
        netDirection: determineDirection(data.calls, data.puts),
        directionStrength: calculateDirectionStrength(data.calls, data.puts),
        whaleCount: data.callCount + data.putCount,
        megaWhaleCount: data.megaCount,
        ultraWhaleCount: data.ultraCount,
        lastActivity: data.lastActivity,
      });
    }

    // Sort by direction strength
    const bullish = summaries
      .filter(s => s.netDirection === 'BULLISH')
      .sort((a, b) => b.directionStrength - a.directionStrength)
      .slice(0, 10);

    const bearish = summaries
      .filter(s => s.netDirection === 'BEARISH')
      .sort((a, b) => b.directionStrength - a.directionStrength)
      .slice(0, 10);

    // Map recent flows
    const recentWhales: WhaleFlow[] = flows.slice(0, 20).map(f => ({
      id: f.id,
      symbol: f.symbol,
      optionType: f.optionType as 'call' | 'put',
      strikePrice: f.strikePrice,
      expirationDate: f.expirationDate,
      premium: f.premium || 0,
      totalPremium: f.totalPremium || 0,
      volume: f.volume,
      delta: f.delta || 0,
      sentiment: (f.sentiment || 'neutral') as 'bullish' | 'bearish' | 'neutral',
      flowType: f.flowType || 'normal',
      unusualScore: f.unusualScore || 0,
      whaleSize: classifyWhaleSize(f.totalPremium || 0),
      dteCategory: f.dteCategory || 'swing',
      detectedAt: f.detectedAt?.toISOString() || '',
      detectedDate: f.detectedDate || targetDate,
    }));

    return {
      overallDirection: determineDirection(totalCallPremium, totalPutPremium),
      overallStrength: calculateDirectionStrength(totalCallPremium, totalPutPremium),
      totalCallPremium,
      totalPutPremium,
      netPremium: totalCallPremium - totalPutPremium,
      topBullishSymbols: bullish,
      topBearishSymbols: bearish,
      recentWhaleFlows: recentWhales,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('[WHALE-FLOW] Error getting market directionality:', error);
    return {
      overallDirection: 'NEUTRAL',
      overallStrength: 0,
      totalCallPremium: 0,
      totalPutPremium: 0,
      netPremium: 0,
      topBullishSymbols: [],
      topBearishSymbols: [],
      recentWhaleFlows: [],
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Get whale flow stats for dashboard display
 */
export async function getWhaleFlowStats(): Promise<{
  todayWhaleCount: number;
  todayTotalPremium: number;
  todayDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  todayStrength: number;
  topWhaleSymbol: string | null;
  isMarketOpen: boolean;
}> {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  // Check if market is open (Mon-Fri 9:30 AM - 4:00 PM ET)
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = etTime.getHours();
  const minute = etTime.getMinutes();
  const day = etTime.getDay();
  const marketMinutes = hour * 60 + minute;
  const isMarketOpen = day >= 1 && day <= 5 && marketMinutes >= 570 && marketMinutes < 960; // 9:30-16:00

  try {
    const directionality = await getMarketDirectionality(today);
    
    // Find top whale symbol by total premium
    const topSymbol = [...directionality.topBullishSymbols, ...directionality.topBearishSymbols]
      .sort((a, b) => (b.totalCallPremium + b.totalPutPremium) - (a.totalCallPremium + a.totalPutPremium))[0];

    return {
      todayWhaleCount: directionality.recentWhaleFlows.length,
      todayTotalPremium: directionality.totalCallPremium + directionality.totalPutPremium,
      todayDirection: directionality.overallDirection,
      todayStrength: directionality.overallStrength,
      topWhaleSymbol: topSymbol?.symbol || null,
      isMarketOpen,
    };
  } catch (error) {
    logger.error('[WHALE-FLOW] Error getting stats:', error);
    return {
      todayWhaleCount: 0,
      todayTotalPremium: 0,
      todayDirection: 'NEUTRAL',
      todayStrength: 0,
      topWhaleSymbol: null,
      isMarketOpen,
    };
  }
}

logger.info('[WHALE-FLOW] 🐋 Whale Flow Service initialized');
