/**
 * POSITIONS LIVE
 * ==============
 * Aggregates user's open trade ideas with LIVE spot prices and computed P&L.
 * Powers /positions Heat Map page.
 */

import { logger } from './logger';
import { db } from './db';
import { tradeIdeas } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

export interface LivePosition {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  assetType: string;
  entry: number;
  spot: number | null;
  target: number;
  stop: number;
  pnlPct: number;
  pnlAbs: number;
  daysActive: number;
  source: string;
  status: string;
  expiryDate?: string | null;
  daysToExpiry?: number | null;
  isOption: boolean;
  strikePrice?: number | null;
  optionType?: string | null;
  // Heat — for heat map coloring
  heatScore: number;       // -100 to +100 (red → green)
  heatRank: 'fire' | 'hot' | 'warm' | 'cool' | 'frozen' | 'red';
}

async function fetchSpot(symbol: string): Promise<number | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j: any = await r.json();
    return j?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
  } catch {
    return null;
  }
}

function classifyHeat(pnlPct: number, daysActive: number): { score: number; rank: LivePosition['heatRank'] } {
  // Heat = pnl / time-decay-adjusted
  let score = pnlPct;

  if (score > 100) score = 100;
  if (score < -100) score = -100;

  let rank: LivePosition['heatRank'] = 'cool';
  if (score >= 50) rank = 'fire';
  else if (score >= 20) rank = 'hot';
  else if (score >= 5) rank = 'warm';
  else if (score >= -5) rank = 'cool';
  else if (score >= -20) rank = 'frozen';
  else rank = 'red';

  return { score, rank };
}

export async function getLivePositions(userId: string): Promise<LivePosition[]> {
  const open = await db
    .select()
    .from(tradeIdeas)
    .where(and(eq(tradeIdeas.userId, userId), eq(tradeIdeas.outcomeStatus, 'open')))
    .limit(100);

  if (!open.length) return [];

  // Fetch spot for unique symbols in parallel
  const symbols = Array.from(new Set(open.map(t => t.symbol)));
  const spotMap = new Map<string, number | null>();
  await Promise.all(symbols.map(async s => {
    spotMap.set(s, await fetchSpot(s));
  }));

  const now = Date.now();
  const positions: LivePosition[] = open.map(t => {
    const spot = spotMap.get(t.symbol) ?? null;
    const issued = new Date(t.timestamp).getTime();
    const daysActive = Math.max(1, Math.floor((now - issued) / 86400000));
    const isLong = t.direction === 'long';

    let pnlPct = 0;
    let pnlAbs = 0;
    if (spot !== null) {
      pnlAbs = isLong ? spot - t.entryPrice : t.entryPrice - spot;
      pnlPct = (pnlAbs / t.entryPrice) * 100;
    }

    const { score, rank } = classifyHeat(pnlPct, daysActive);
    const dte = t.expiryDate ? Math.floor((new Date(t.expiryDate).getTime() - now) / 86400000) : null;

    return {
      id: t.id,
      symbol: t.symbol,
      direction: t.direction as 'long' | 'short',
      assetType: t.assetType,
      entry: t.entryPrice,
      spot,
      target: t.targetPrice,
      stop: t.stopLoss,
      pnlPct: +pnlPct.toFixed(2),
      pnlAbs: +pnlAbs.toFixed(2),
      daysActive,
      source: t.source || 'unknown',
      status: t.outcomeStatus || 'open',
      expiryDate: t.expiryDate,
      daysToExpiry: dte,
      isOption: t.assetType === 'option',
      strikePrice: t.strikePrice ?? null,
      optionType: t.optionType ?? null,
      heatScore: score,
      heatRank: rank
    };
  });

  // Sort by heat (hottest first)
  return positions.sort((a, b) => b.heatScore - a.heatScore);
}

export interface PositionsSummary {
  total: number;
  winners: number;
  losers: number;
  totalPnLPct: number;
  totalPnLAbs: number;
  hotCount: number;       // fire+hot
  coldCount: number;      // frozen+red
  bestPosition: LivePosition | null;
  worstPosition: LivePosition | null;
  bySource: Record<string, number>;
  byAssetType: Record<string, number>;
}

export function computePositionsSummary(positions: LivePosition[]): PositionsSummary {
  const winners = positions.filter(p => p.pnlPct > 0);
  const losers = positions.filter(p => p.pnlPct < 0);
  const totalPnLPct = positions.reduce((s, p) => s + p.pnlPct, 0);
  const totalPnLAbs = positions.reduce((s, p) => s + p.pnlAbs, 0);
  const hotCount = positions.filter(p => p.heatRank === 'fire' || p.heatRank === 'hot').length;
  const coldCount = positions.filter(p => p.heatRank === 'frozen' || p.heatRank === 'red').length;

  const bySource: Record<string, number> = {};
  const byAssetType: Record<string, number> = {};
  for (const p of positions) {
    bySource[p.source] = (bySource[p.source] || 0) + 1;
    byAssetType[p.assetType] = (byAssetType[p.assetType] || 0) + 1;
  }

  return {
    total: positions.length,
    winners: winners.length,
    losers: losers.length,
    totalPnLPct: +totalPnLPct.toFixed(1),
    totalPnLAbs: +totalPnLAbs.toFixed(2),
    hotCount,
    coldCount,
    bestPosition: positions[0] ?? null,
    worstPosition: positions[positions.length - 1] ?? null,
    bySource,
    byAssetType
  };
}
