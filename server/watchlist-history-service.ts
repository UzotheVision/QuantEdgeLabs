import cron from 'node-cron';
import { storage } from './storage';
import { formatInTimeZone } from 'date-fns-tz';
import { logger } from './logger';
import type { InsertWatchlistHistory, WatchlistHistoryRecord, WatchlistItem } from '@shared/schema';

const CT_TIMEZONE = 'America/Chicago';

interface WatchlistHistoryStats {
  symbol: string;
  days: number;
  avgGrade: number;
  priceChange: number;
  gradeChanges: { date: string; from: string | null; to: string | null }[];
  hasTraded: boolean;
  tradeDays: number;
}

export class WatchlistHistoryService {
  private isRunning = false;

  async takeSnapshot(watchlistItem: WatchlistItem): Promise<WatchlistHistoryRecord | null> {
    try {
      const now = new Date();
      const snapshotDate = formatInTimeZone(now, CT_TIMEZONE, 'yyyy-MM-dd');
      const year = now.getFullYear();

      const existingSnapshot = await storage.getLatestWatchlistSnapshot(watchlistItem.id);
      if (existingSnapshot && existingSnapshot.snapshotDate === snapshotDate) {
        return existingSnapshot;
      }

      const priceChange = existingSnapshot && existingSnapshot.price && watchlistItem.currentPrice
        ? ((watchlistItem.currentPrice - existingSnapshot.price) / existingSnapshot.price) * 100
        : null;

      const hasTradeToday = await this.checkIfTradedToday(watchlistItem.symbol, watchlistItem.userId || 'system');

      const snapshotData: InsertWatchlistHistory = {
        watchlistId: watchlistItem.id,
        symbol: watchlistItem.symbol,
        snapshotDate,
        year,
        gradeScore: watchlistItem.gradeScore,
        gradeLetter: watchlistItem.gradeLetter,
        tier: watchlistItem.tier,
        confidenceScore: null,
        price: watchlistItem.currentPrice || 0,
        priceChange,
        volume: null,
        technicalSnapshot: watchlistItem.gradeInputs,
        hasEarnings: false,
        hasNews: false,
        hasTrade: hasTradeToday,
        hasNote: false,
      };

      const snapshot = await storage.createWatchlistSnapshot(snapshotData);
      logger.debug(`[WATCHLIST-HISTORY] Snapshot created for ${watchlistItem.symbol}`);
      return snapshot;
    } catch (error) {
      logger.error(`[WATCHLIST-HISTORY] Failed to create snapshot for ${watchlistItem.symbol}:`, error);
      return null;
    }
  }

  async takeAllSnapshots(): Promise<{ success: number; failed: number }> {
    if (this.isRunning) {
      logger.warn('[WATCHLIST-HISTORY] Snapshot already in progress');
      return { success: 0, failed: 0 };
    }

    this.isRunning = true;
    let success = 0;
    let failed = 0;

    try {
      const watchlistItems = await storage.getAllWatchlist();
      logger.info(`[WATCHLIST-HISTORY] Taking snapshots for ${watchlistItems.length} items`);

      for (const item of watchlistItems) {
        const snapshot = await this.takeSnapshot(item);
        if (snapshot) {
          success++;
        } else {
          failed++;
        }
      }

      logger.info(`[WATCHLIST-HISTORY] Completed: ${success} success, ${failed} failed`);
    } catch (error) {
      logger.error('[WATCHLIST-HISTORY] Failed to take snapshots:', error);
    } finally {
      this.isRunning = false;
    }

    return { success, failed };
  }

  async getSymbolTimeline(symbol: string, year?: number): Promise<WatchlistHistoryRecord[]> {
    return storage.getWatchlistHistory(symbol, year);
  }

  async getWatchlistItemHistory(watchlistId: string, days: number = 365): Promise<WatchlistHistoryRecord[]> {
    return storage.getWatchlistHistoryByWatchlistId(watchlistId, days);
  }

  async getSymbolStats(symbol: string, year?: number): Promise<WatchlistHistoryStats | null> {
    const history = await this.getSymbolTimeline(symbol, year);
    if (history.length === 0) return null;

    const avgGrade = history.reduce((sum, h) => sum + (h.gradeScore || 0), 0) / history.length;
    
    const oldest = history[history.length - 1];
    const newest = history[0];
    const priceChange = oldest.price && newest.price 
      ? ((newest.price - oldest.price) / oldest.price) * 100 
      : 0;

    const gradeChanges: { date: string; from: string | null; to: string | null }[] = [];
    for (let i = 0; i < history.length - 1; i++) {
      if (history[i].gradeLetter !== history[i + 1].gradeLetter) {
        gradeChanges.push({
          date: history[i].snapshotDate,
          from: history[i + 1].gradeLetter,
          to: history[i].gradeLetter,
        });
      }
    }

    const tradeDays = history.filter(h => h.hasTrade).length;

    return {
      symbol,
      days: history.length,
      avgGrade,
      priceChange,
      gradeChanges,
      hasTraded: tradeDays > 0,
      tradeDays,
    };
  }

  async getMultiYearComparison(symbol: string): Promise<{ year: number; avgGrade: number; avgPrice: number; daysWatched: number }[]> {
    const allHistory = await storage.getWatchlistHistory(symbol);
    
    const byYear = new Map<number, { grades: number[]; prices: number[] }>();
    for (const h of allHistory) {
      const entry = byYear.get(h.year) || { grades: [], prices: [] };
      if (h.gradeScore) entry.grades.push(h.gradeScore);
      if (h.price) entry.prices.push(h.price);
      byYear.set(h.year, entry);
    }

    return Array.from(byYear.entries())
      .map(([year, data]) => ({
        year,
        avgGrade: data.grades.length ? data.grades.reduce((a, b) => a + b, 0) / data.grades.length : 0,
        avgPrice: data.prices.length ? data.prices.reduce((a, b) => a + b, 0) / data.prices.length : 0,
        daysWatched: data.grades.length,
      }))
      .sort((a, b) => b.year - a.year);
  }

  private async checkIfTradedToday(symbol: string, userId: string): Promise<boolean> {
    try {
      const today = formatInTimeZone(new Date(), CT_TIMEZONE, 'yyyy-MM-dd');
      const allIdeas = await storage.getAllTradeIdeas();
      return allIdeas.some(idea => 
        idea.symbol === symbol && 
        idea.timestamp && 
        formatInTimeZone(new Date(idea.timestamp), CT_TIMEZONE, 'yyyy-MM-dd') === today
      );
    } catch {
      return false;
    }
  }

  startScheduler(): void {
    cron.schedule('0 16 * * 1-5', async () => {
      logger.info('[WATCHLIST-HISTORY] Running scheduled daily snapshot (4 PM CT market close)');
      await this.takeAllSnapshots();
    }, {
      timezone: CT_TIMEZONE
    });

    logger.info('[WATCHLIST-HISTORY] Daily snapshot scheduler started (runs at 4 PM CT on weekdays)');
  }
}

export const watchlistHistoryService = new WatchlistHistoryService();
