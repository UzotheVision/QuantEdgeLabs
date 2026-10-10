/**
 * Flow Edge Service
 * =================
 * Aggregated options flow with stats, filtering, and repeat ticker detection.
 * Powers the /flow page (Algo Edge equivalent).
 * Queries the existing optionsFlowHistory table populated by flow scanners.
 */

import { logger } from './logger';
import { db } from './db';
import { optionsFlowHistory } from '@shared/schema';
import type { FlowStrategyCategory, FlowDteCategory } from '@shared/schema';
import { eq, desc, gte, and, sql, count, sum } from 'drizzle-orm';
import { marketDateET } from '@shared/market-day';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface FlowTrade {
  id: string;
  symbol: string;
  optionType: 'call' | 'put';
  strikePrice: number;
  expirationDate: string;
  volume: number;
  openInterest: number | null;
  volumeOIRatio: number | null;
  premium: number;
  totalPremium: number;
  impliedVolatility: number | null;
  delta: number | null;
  underlyingPrice: number | null;
  sentiment: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  flowType: 'block' | 'sweep' | 'unusual_volume' | 'dark_pool' | 'normal';
  unusualScore: number;
  strategyCategory: string | null;
  dteCategory: string | null;
  isLotto: boolean;
  detectedAt: string;
  detectedDate: string;
}

export interface FlowStats {
  totalTrades: number;
  totalValue: number;
  callCount: number;
  putCount: number;
  callPutRatio: number;
  peakHour: string;
  mostActiveTickers: { symbol: string; count: number; totalPremium: number }[];
  repeatTickers: { symbol: string; count: number }[];
  unusualActivity: { symbol: string; unusualScore: number; flowType: string }[];
  topTradesByValue: FlowTrade[];
}

export interface FlowFilters {
  symbol?: string;
  flowType?: string;
  minPremium?: number;
  strategyCategory?: string;
  dteCategory?: string;
  sentiment?: string;
  limit?: number;
  offset?: number;
  days?: number;
}

export interface FlowResponse {
  trades: FlowTrade[];
  stats: FlowStats;
  pagination: { limit: number; offset: number; total: number };
}

// ═══════════════════════════════════════════════════════════════
// CORE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function buildConditions(filters: FlowFilters) {
  const conditions: any[] = [];
  const days = filters.days || 7;
  const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  conditions.push(gte(optionsFlowHistory.detectedDate, startDate));

  if (filters.symbol) {
    conditions.push(eq(optionsFlowHistory.symbol, filters.symbol.toUpperCase()));
  }
  if (filters.flowType) {
    conditions.push(eq(optionsFlowHistory.flowType, filters.flowType as any));
  }
  if (filters.minPremium) {
    conditions.push(gte(optionsFlowHistory.totalPremium, filters.minPremium));
  }
  if (filters.strategyCategory) {
    conditions.push(eq(optionsFlowHistory.strategyCategory, filters.strategyCategory as FlowStrategyCategory));
  }
  if (filters.dteCategory) {
    conditions.push(eq(optionsFlowHistory.dteCategory, filters.dteCategory as FlowDteCategory));
  }
  if (filters.sentiment) {
    conditions.push(eq(optionsFlowHistory.sentiment, filters.sentiment as any));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

function mapRow(f: any): FlowTrade {
  return {
    id: f.id,
    symbol: f.symbol,
    optionType: f.optionType as 'call' | 'put',
    strikePrice: f.strikePrice,
    expirationDate: f.expirationDate,
    volume: f.volume,
    openInterest: f.openInterest,
    volumeOIRatio: f.volumeOIRatio,
    premium: f.premium || 0,
    totalPremium: f.totalPremium || 0,
    impliedVolatility: f.impliedVolatility,
    delta: f.delta,
    underlyingPrice: f.underlyingPrice,
    // Every persisted row predates any tape-level source, so its stored
    // bullish/bearish came from the old `call && delta > 0.3` rule — which is
    // backwards whenever the contract was SOLD. Rather than migrate historical
    // rows to a value they never earned, report them for what they are. Flip this
    // to `f.sentiment` once biasBasis === 'tape' is being written.
    sentiment: 'unknown' as const,
    flowType: (f.flowType || 'normal') as FlowTrade['flowType'],
    unusualScore: f.unusualScore || 0,
    strategyCategory: f.strategyCategory,
    dteCategory: f.dteCategory,
    isLotto: f.isLotto || false,
    detectedAt: f.detectedAt?.toISOString() || '',
    detectedDate: f.detectedDate || '',
  };
}

function dteCategory(expiry: string): FlowDteCategory {
  const today = new Date(`${marketDateET()}T12:00:00-04:00`).getTime();
  const expiration = new Date(`${String(expiry).slice(0, 10)}T12:00:00-04:00`).getTime();
  const dte = Math.max(0, Math.round((expiration - today) / 86_400_000));
  if (dte === 0) return '0DTE';
  if (dte <= 2) return '1-2DTE';
  if (dte <= 7) return '3-7DTE';
  if (dte <= 45) return 'swing';
  if (dte <= 180) return 'monthly';
  return 'leaps';
}

/**
 * The SSE tape used to feed scoring while the Flow page queried only the
 * persisted chain-snapshot table. That made the page look frozen even with a
 * healthy live stream. Merge today's in-memory prints into the read model;
 * keep their direction unknown because an alert classification is not an
 * aggressor-side measurement.
 */
async function getLiveTape(filters: FlowFilters): Promise<FlowTrade[]> {
  try {
    const { bullflowEnabled, getBullflowPrints } = await import('./bullflow-service');
    if (!bullflowEnabled()) return [];
    const today = marketDateET();
    return getBullflowPrints().prints
      .filter((p) => marketDateET(new Date(p.at)) === today)
      .map((p): FlowTrade => {
        const category = dteCategory(p.expiry);
        const flowType: FlowTrade['flowType'] = /sweep/i.test(p.alertName)
          ? 'sweep'
          : p.premium >= 500_000 ? 'block' : 'unusual_volume';
        return {
          id: `bullflow-${p.id}`,
          symbol: p.underlying,
          optionType: p.optionType,
          strikePrice: p.strike,
          expirationDate: p.expiry,
          volume: p.contracts ?? 0,
          openInterest: null,
          volumeOIRatio: null,
          premium: p.fillPrice,
          totalPremium: p.premium,
          impliedVolatility: null,
          delta: null,
          underlyingPrice: null,
          sentiment: 'unknown',
          flowType,
          unusualScore: 70,
          strategyCategory: p.alertName,
          dteCategory: category,
          isLotto: category === '0DTE',
          detectedAt: p.at,
          detectedDate: today,
        };
      })
      .filter((p) => !filters.symbol || p.symbol === filters.symbol.toUpperCase())
      .filter((p) => !filters.flowType || p.flowType === filters.flowType)
      .filter((p) => !filters.minPremium || p.totalPremium >= filters.minPremium)
      .filter((p) => !filters.dteCategory || p.dteCategory === filters.dteCategory)
      .filter((p) => !filters.sentiment || p.sentiment === filters.sentiment);
  } catch (error) {
    logger.warn('[FLOW-EDGE] Live tape unavailable:', error);
    return [];
  }
}

/**
 * Get paginated options flow trades with filters
 */
export async function getOptionsFlow(filters: FlowFilters): Promise<FlowResponse> {
  const limit = Math.min(filters.limit || 50, 200);
  const offset = filters.offset || 0;

  try {
    const where = buildConditions(filters);

    // Read a slightly wider persisted window, then merge the live SSE tape
    // before sorting/pagination. Live prints must not wait for the next DB
    // scanner cycle to appear on the operator's screen.
    const dbTrades = await db.select()
      .from(optionsFlowHistory)
      .where(where)
      .orderBy(desc(optionsFlowHistory.detectedAt))
      .limit(Math.min(500, limit + offset + 100));

    const liveTrades = await getLiveTape(filters);
    const merged = [...liveTrades, ...dbTrades.map(mapRow)]
      .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt));
    const trades = merged.slice(offset, offset + limit);

    // Get total count for pagination
    const countResult = await db.select({ count: sql<number>`count(*)` })
      .from(optionsFlowHistory)
      .where(where);
    const total = Number(countResult[0]?.count || 0) + liveTrades.length;

    // Get ALL rows for stats (up to 500 for performance)
    const allRows = await db.select()
      .from(optionsFlowHistory)
      .where(where)
      .orderBy(desc(optionsFlowHistory.totalPremium))
      .limit(500);

    const stats = computeStats([...liveTrades, ...allRows]);

    return {
      trades,
      stats,
      pagination: { limit, offset, total },
    };
  } catch (error) {
    logger.error('[FLOW-EDGE] Error fetching options flow:', error);
    return {
      trades: [],
      stats: emptyStats(),
      pagination: { limit, offset, total: 0 },
    };
  }
}

/**
 * Compute aggregated stats from flow rows
 */
function computeStats(rows: any[]): FlowStats {
  if (rows.length === 0) return emptyStats();

  let totalValue = 0;
  let callCount = 0;
  let putCount = 0;
  const symbolMap = new Map<string, { count: number; totalPremium: number }>();
  const hourMap = new Map<string, number>();
  const unusualMap = new Map<string, { score: number; flowType: string }>();

  for (const f of rows) {
    const premium = f.totalPremium || 0;
    totalValue += premium;

    if (f.optionType === 'call') callCount++;
    else putCount++;

    // Aggregate by symbol
    const sym = f.symbol;
    const entry = symbolMap.get(sym) || { count: 0, totalPremium: 0 };
    entry.count++;
    entry.totalPremium += premium;
    symbolMap.set(sym, entry);

    // Peak hour
    if (f.detectedAt) {
      const hour = new Date(f.detectedAt).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/New_York',
      });
      hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
    }

    // Unusual activity tracking
    const score = f.unusualScore || 0;
    if (score > 5) {
      const existing = unusualMap.get(sym);
      if (!existing || score > existing.score) {
        unusualMap.set(sym, { score, flowType: f.flowType || 'normal' });
      }
    }
  }

  // Most active tickers (top 10)
  const mostActiveTickers = [...symbolMap.entries()]
    .map(([symbol, data]) => ({ symbol, count: data.count, totalPremium: data.totalPremium }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Repeat tickers (3+ trades)
  const repeatTickers = [...symbolMap.entries()]
    .filter(([_, data]) => data.count >= 3)
    .map(([symbol, data]) => ({ symbol, count: data.count }))
    .sort((a, b) => b.count - a.count);

  // Peak hour
  let peakHour = '9:30 AM';
  let maxHourCount = 0;
  for (const [hour, cnt] of hourMap) {
    if (cnt > maxHourCount) { maxHourCount = cnt; peakHour = hour; }
  }

  // Unusual activity (top 10 by score)
  const unusualActivity = [...unusualMap.entries()]
    .map(([symbol, data]) => ({ symbol, unusualScore: data.score, flowType: data.flowType }))
    .sort((a, b) => b.unusualScore - a.unusualScore)
    .slice(0, 10);

  // Top trades by value
  const topTradesByValue = rows
    .sort((a, b) => (b.totalPremium || 0) - (a.totalPremium || 0))
    .slice(0, 5)
    .map(mapRow);

  return {
    totalTrades: rows.length,
    totalValue,
    callCount,
    putCount,
    callPutRatio: putCount > 0 ? +(callCount / putCount).toFixed(2) : callCount,
    peakHour,
    mostActiveTickers,
    repeatTickers,
    unusualActivity,
    topTradesByValue,
  };
}

function emptyStats(): FlowStats {
  return {
    totalTrades: 0,
    totalValue: 0,
    callCount: 0,
    putCount: 0,
    callPutRatio: 0,
    peakHour: '--',
    mostActiveTickers: [],
    repeatTickers: [],
    unusualActivity: [],
    topTradesByValue: [],
  };
}

logger.info('[FLOW-EDGE] Flow Edge Service initialized');
