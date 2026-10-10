import { db } from './db';
import { watchlist, researchHistory } from '@shared/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { logger } from './logger';
import type { WatchlistItem, ResearchHistoryRecord } from '@shared/schema';

interface PersonalEdge {
  symbol: string;
  timesTraded: number;
  timesWon: number;
  winRate: number;
  avgReturn: number;
  totalPnl: number;
  confidenceBoost: number;
  patternMatch?: string;
  lastTradedAt?: string;
}

interface SymbolStats {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  avgReturn: number;
  winRate: number;
}

export class PersonalEdgeService {
  
  async calculateEdgeBoost(winRate: number, timesTraded: number): Promise<number> {
    if (timesTraded < 2) return 0;
    
    let boost = 0;
    
    if (winRate >= 80) boost = 15;
    else if (winRate >= 70) boost = 10;
    else if (winRate >= 60) boost = 5;
    else if (winRate >= 50) boost = 0;
    else if (winRate >= 40) boost = -5;
    else boost = -10;
    
    if (timesTraded >= 10) boost += 5;
    else if (timesTraded >= 5) boost += 2;
    
    return Math.max(-15, Math.min(20, boost));
  }

  async getSymbolStats(userId: string, symbol: string): Promise<SymbolStats | null> {
    try {
      const trades = await db.select()
        .from(researchHistory)
        .where(and(
          eq(researchHistory.userId, userId),
          eq(researchHistory.symbol, symbol),
          eq(researchHistory.actionTaken, 'traded')
        ));
      
      if (trades.length === 0) return null;
      
      const wins = trades.filter((t: ResearchHistoryRecord) => (t.outcomePnL || 0) > 0).length;
      const losses = trades.filter((t: ResearchHistoryRecord) => (t.outcomePnL || 0) < 0).length;
      const totalPnl = trades.reduce((sum: number, t: ResearchHistoryRecord) => sum + (t.outcomePnL || 0), 0);
      const avgReturn = trades.length > 0 
        ? trades.reduce((sum: number, t: ResearchHistoryRecord) => sum + (t.outcomeReturn || 0), 0) / trades.length 
        : 0;
      const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
      
      return {
        symbol,
        trades: trades.length,
        wins,
        losses,
        totalPnl,
        avgReturn,
        winRate
      };
    } catch (error) {
      logger.error('Error getting symbol stats:', error);
      return null;
    }
  }

  async getPersonalEdge(userId: string, symbol: string): Promise<PersonalEdge> {
    const stats = await this.getSymbolStats(userId, symbol);
    
    if (!stats) {
      return {
        symbol,
        timesTraded: 0,
        timesWon: 0,
        winRate: 0,
        avgReturn: 0,
        totalPnl: 0,
        confidenceBoost: 0
      };
    }
    
    const confidenceBoost = await this.calculateEdgeBoost(stats.winRate, stats.trades);
    
    const lastTrade = await db.select()
      .from(researchHistory)
      .where(and(
        eq(researchHistory.userId, userId),
        eq(researchHistory.symbol, symbol),
        eq(researchHistory.actionTaken, 'traded')
      ))
      .orderBy(desc(researchHistory.decidedAt))
      .limit(1);
    
    return {
      symbol,
      timesTraded: stats.trades,
      timesWon: stats.wins,
      winRate: stats.winRate,
      avgReturn: stats.avgReturn,
      totalPnl: stats.totalPnl,
      confidenceBoost,
      lastTradedAt: lastTrade[0]?.decidedAt?.toISOString()
    };
  }

  async updateWatchlistPersonalEdge(userId: string, watchlistId: string): Promise<void> {
    try {
      const item = await db.select()
        .from(watchlist)
        .where(eq(watchlist.id, watchlistId))
        .limit(1);
      
      if (!item[0]) return;
      
      const edge = await this.getPersonalEdge(userId, item[0].symbol);
      
      await db.update(watchlist)
        .set({
          timesTraded: edge.timesTraded,
          timesWon: edge.timesWon,
          avgReturn: edge.avgReturn,
          totalPnl: edge.totalPnl,
          personalEdgeBoost: edge.confidenceBoost,
          lastTradedAt: edge.lastTradedAt
        })
        .where(eq(watchlist.id, watchlistId));
      
      logger.info(`Updated personal edge for ${item[0].symbol}: boost=${edge.confidenceBoost}`);
    } catch (error) {
      logger.error('Error updating watchlist personal edge:', error);
    }
  }

  async updateAllWatchlistEdges(userId: string): Promise<number> {
    try {
      const items = await db.select()
        .from(watchlist)
        .where(eq(watchlist.userId, userId));
      
      let updated = 0;
      for (const item of items) {
        await this.updateWatchlistPersonalEdge(userId, item.id);
        updated++;
      }
      
      return updated;
    } catch (error) {
      logger.error('Error updating all watchlist edges:', error);
      return 0;
    }
  }

  async getPerformanceByTier(userId: string, year?: number): Promise<Record<string, {
    watched: number;
    traded: number;
    conversionRate: number;
    winRate: number;
    avgReturn: number;
    totalPnl: number;
  }>> {
    const items = await db.select()
      .from(watchlist)
      .where(eq(watchlist.userId, userId));
    
    const result: Record<string, {
      watched: number;
      traded: number;
      conversionRate: number;
      winRate: number;
      avgReturn: number;
      totalPnl: number;
    }> = {};
    const tiers = ['S', 'A', 'B', 'C', 'D', 'F'];
    
    for (const tier of tiers) {
      const tierItems = items.filter((i: WatchlistItem) => i.tier === tier);
      const tradedItems = tierItems.filter((i: WatchlistItem) => (i.timesTraded || 0) > 0);
      
      const totalTrades = tradedItems.reduce((sum: number, i: WatchlistItem) => sum + (i.timesTraded || 0), 0);
      const totalWins = tradedItems.reduce((sum: number, i: WatchlistItem) => sum + (i.timesWon || 0), 0);
      const totalPnl = tradedItems.reduce((sum: number, i: WatchlistItem) => sum + (i.totalPnl || 0), 0);
      const avgReturn = tradedItems.length > 0
        ? tradedItems.reduce((sum: number, i: WatchlistItem) => sum + (i.avgReturn || 0), 0) / tradedItems.length
        : 0;
      
      result[tier] = {
        watched: tierItems.length,
        traded: tradedItems.length,
        conversionRate: tierItems.length > 0 ? (tradedItems.length / tierItems.length) * 100 : 0,
        winRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
        avgReturn,
        totalPnl
      };
    }
    
    return result;
  }

  async getMissedOpportunities(userId: string, limit: number = 5): Promise<Array<{
    symbol: string;
    tier: string;
    gradeScore: number;
    priceSinceAdded: number;
    addedAt: string;
  }>> {
    try {
      const items = await db.select()
        .from(watchlist)
        .where(and(
          eq(watchlist.userId, userId),
          sql`${watchlist.timesTraded} = 0 OR ${watchlist.timesTraded} IS NULL`,
          sql`${watchlist.priceSinceAdded} > 10`
        ))
        .orderBy(desc(watchlist.priceSinceAdded))
        .limit(limit);
      
      return items.map((i: WatchlistItem) => ({
        symbol: i.symbol,
        tier: i.tier || 'C',
        gradeScore: i.gradeScore || 50,
        priceSinceAdded: i.priceSinceAdded || 0,
        addedAt: i.addedAt
      }));
    } catch (error) {
      logger.error('Error getting missed opportunities:', error);
      return [];
    }
  }
}

export const personalEdgeService = new PersonalEdgeService();
