/**
 * Platform Report Generator Service
 * 
 * Generates comprehensive daily, weekly, and monthly reports for the Quant Edge Labs trading platform.
 * Reports are stored in the platformReports table for historical tracking and admin review.
 */

import { storage, isRealLoss, isCurrentGenEngine, getDecidedTrades } from './storage';
import { logger } from './logger';
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import type { PlatformReport, InsertPlatformReport, TradeIdea, IdeaSource, ReportPeriod } from '@shared/schema';
import { sendReportNotificationToDiscord } from './discord-service';

const CT_TIMEZONE = 'America/Chicago';

interface SymbolPerformance {
  symbol: string;
  wins: number;
  losses: number;
  totalPnl: number;
  avgPnl: number;
}

interface EnginePerformance {
  engine: IdeaSource;
  generated: number;
  resolved: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnl: number;
}

/**
 * Helper to format date for database storage (YYYY-MM-DD)
 */
function formatDateForDB(date: Date): string {
  return formatInTimeZone(date, CT_TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Helper to get CT time boundaries for a date
 */
function getCTDayBoundaries(date: Date): { start: Date; end: Date } {
  const ctDate = toZonedTime(date, CT_TIMEZONE);
  const startCT = startOfDay(ctDate);
  const endCT = endOfDay(ctDate);
  return { start: startCT, end: endCT };
}

/**
 * Filter trade ideas by date range (using timestamp field)
 */
function filterIdeasByDateRange(ideas: TradeIdea[], startDate: Date, endDate: Date): TradeIdea[] {
  const startStr = formatDateForDB(startDate);
  const endStr = formatDateForDB(endDate);
  
  return ideas.filter(idea => {
    const ideaDate = idea.timestamp.split('T')[0];
    return ideaDate >= startStr && ideaDate <= endStr;
  });
}

/**
 * Count ideas by source engine
 */
function countBySource(ideas: TradeIdea[]): Record<IdeaSource, number> {
  const counts: Record<string, number> = {
    ai: 0,
    quant: 0,
    hybrid: 0,
    flow: 0,
    lotto: 0,
    manual: 0,
    news: 0,
    chart_analysis: 0,
    'penny-scanner': 0,
  };
  
  for (const idea of ideas) {
    const source = idea.source || 'quant';
    counts[source] = (counts[source] || 0) + 1;
  }
  
  return counts as Record<IdeaSource, number>;
}

/**
 * Calculate win/loss statistics for resolved trades
 */
function calculateWinLossStats(ideas: TradeIdea[]): {
  resolved: number;
  wins: number;
  losses: number;
  winRate: number;
  avgGain: number;
  avgLoss: number;
  totalPnl: number;
} {
  const decided = getDecidedTrades(ideas);
  
  const wins = decided.filter(t => t.outcomeStatus === 'hit_target');
  const losses = decided.filter(t => isRealLoss(t));
  
  const resolved = wins.length + losses.length;
  const winRate = resolved > 0 ? (wins.length / resolved) * 100 : 0;
  
  let totalGain = 0;
  let totalLoss = 0;
  
  for (const trade of wins) {
    const gain = trade.percentGain || ((trade.targetPrice - trade.entryPrice) / trade.entryPrice) * 100;
    totalGain += gain;
  }
  
  for (const trade of losses) {
    const loss = trade.percentGain || ((trade.stopLoss - trade.entryPrice) / trade.entryPrice) * 100;
    totalLoss += loss;
  }
  
  const avgGain = wins.length > 0 ? totalGain / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;
  const totalPnl = totalGain + totalLoss;
  
  return {
    resolved,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgGain,
    avgLoss,
    totalPnl,
  };
}

/**
 * Calculate engine-specific performance
 */
function calculateEnginePerformance(ideas: TradeIdea[]): EnginePerformance[] {
  const engines: IdeaSource[] = ['ai', 'quant', 'hybrid', 'flow', 'lotto'];
  const results: EnginePerformance[] = [];
  
  for (const engine of engines) {
    const engineIdeas = ideas.filter(i => i.source === engine);
    if (engineIdeas.length === 0) continue;
    
    const decided = getDecidedTrades(engineIdeas);
    const wins = decided.filter(t => t.outcomeStatus === 'hit_target');
    const losses = decided.filter(t => isRealLoss(t));
    
    let totalPnl = 0;
    for (const t of decided) {
      totalPnl += t.percentGain || 0;
    }
    
    results.push({
      engine,
      generated: engineIdeas.length,
      resolved: decided.length,
      wins: wins.length,
      losses: losses.length,
      winRate: decided.length > 0 ? (wins.length / decided.length) * 100 : 0,
      avgPnl: decided.length > 0 ? totalPnl / decided.length : 0,
    });
  }
  
  return results;
}

/**
 * Identify top winning and losing symbols
 */
function getTopSymbols(ideas: TradeIdea[], limit: number = 5): {
  topWinning: SymbolPerformance[];
  topLosing: SymbolPerformance[];
} {
  const symbolMap = new Map<string, SymbolPerformance>();
  const decided = getDecidedTrades(ideas);
  
  for (const idea of decided) {
    const existing = symbolMap.get(idea.symbol) || {
      symbol: idea.symbol,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      avgPnl: 0,
    };
    
    const pnl = idea.percentGain || 0;
    
    if (idea.outcomeStatus === 'hit_target') {
      existing.wins++;
    } else if (isRealLoss(idea)) {
      existing.losses++;
    }
    
    existing.totalPnl += pnl;
    symbolMap.set(idea.symbol, existing);
  }
  
  const allSymbols = Array.from(symbolMap.values());
  for (const sym of allSymbols) {
    const total = sym.wins + sym.losses;
    sym.avgPnl = total > 0 ? sym.totalPnl / total : 0;
  }
  
  const topWinning = [...allSymbols]
    .filter(s => s.totalPnl > 0)
    .sort((a, b) => b.totalPnl - a.totalPnl)
    .slice(0, limit);
  
  const topLosing = [...allSymbols]
    .filter(s => s.totalPnl < 0)
    .sort((a, b) => a.totalPnl - b.totalPnl)
    .slice(0, limit);
  
  return { topWinning, topLosing };
}

/**
 * Count asset type breakdown
 */
function countByAssetType(ideas: TradeIdea[]): {
  stocks: number;
  options: number;
  crypto: number;
  futures: number;
} {
  let stocks = 0;
  let options = 0;
  let crypto = 0;
  let futures = 0;
  
  for (const idea of ideas) {
    switch (idea.assetType) {
      case 'stock':
      case 'penny_stock':
        stocks++;
        break;
      case 'option':
        options++;
        break;
      case 'crypto':
        crypto++;
        break;
      case 'future':
        futures++;
        break;
    }
  }
  
  return { stocks, options, crypto, futures };
}

/**
 * Generate Daily Report
 * Called at end of trading day (~5 PM CT)
 */
export async function generateDailyReport(date?: Date): Promise<PlatformReport> {
  const reportDate = date || new Date();
  const startDate = startOfDay(toZonedTime(reportDate, CT_TIMEZONE));
  const endDate = endOfDay(toZonedTime(reportDate, CT_TIMEZONE));
  
  const startStr = formatDateForDB(startDate);
  const endStr = formatDateForDB(endDate);
  
  logger.info(`[REPORT-GEN] Generating daily report for ${startStr}`);
  
  try {
    const allIdeas = await storage.getAllTradeIdeas();
    const todayIdeas = filterIdeasByDateRange(allIdeas, startDate, endDate);
    
    const bySource = countBySource(todayIdeas);
    const stats = calculateWinLossStats(todayIdeas);
    const enginePerf = calculateEnginePerformance(todayIdeas);
    const { topWinning, topLosing } = getTopSymbols(todayIdeas);
    const assetBreakdown = countByAssetType(todayIdeas);
    
    const bestEngine = enginePerf
      .filter(e => e.resolved >= 3)
      .sort((a, b) => b.winRate - a.winRate)[0];
    
    const aiPerf = enginePerf.find(e => e.engine === 'ai');
    const quantPerf = enginePerf.find(e => e.engine === 'quant');
    const hybridPerf = enginePerf.find(e => e.engine === 'hybrid');
    
    const ctMentions = await storage.getCTMentions(24);
    const flowIdeas = todayIdeas.filter(i => i.source === 'flow' || i.source === 'lotto');
    
    const report: InsertPlatformReport = {
      period: 'daily',
      startDate: startStr,
      endDate: endStr,
      status: 'completed',
      
      totalIdeasGenerated: todayIdeas.length,
      aiIdeasGenerated: bySource.ai || 0,
      quantIdeasGenerated: bySource.quant || 0,
      hybridIdeasGenerated: bySource.hybrid || 0,
      
      totalTradesResolved: stats.resolved,
      totalWins: stats.wins,
      totalLosses: stats.losses,
      overallWinRate: stats.winRate,
      avgGainPercent: stats.avgGain,
      avgLossPercent: stats.avgLoss,
      totalPnlPercent: stats.totalPnl,
      
      aiWinRate: aiPerf?.winRate || null,
      quantWinRate: quantPerf?.winRate || null,
      hybridWinRate: hybridPerf?.winRate || null,
      bestPerformingEngine: bestEngine?.engine || null,
      
      autoLottoTrades: bySource.lotto || 0,
      autoLottoPnl: 0,
      futuresBotTrades: assetBreakdown.futures,
      futuresBotPnl: 0,
      cryptoBotTrades: assetBreakdown.crypto,
      cryptoBotPnl: 0,
      propFirmTrades: 0,
      propFirmPnl: 0,
      
      optionsFlowAlerts: flowIdeas.length,
      marketScannerSymbolsTracked: 0,
      ctTrackerMentions: ctMentions.length,
      ctTrackerAutoTrades: 0,
      
      stockTradeCount: assetBreakdown.stocks,
      optionsTradeCount: assetBreakdown.options,
      cryptoTradeCount: assetBreakdown.crypto,
      futuresTradeCount: assetBreakdown.futures,
      
      topWinningSymbols: topWinning,
      topLosingSymbols: topLosing,
      
      activeUsers: 0,
      newUsers: 0,
      
      reportData: {
        enginePerformance: enginePerf,
        bySource,
        generatedAt: new Date().toISOString(),
      },
      
      generatedBy: 'system',
    };
    
    const created = await storage.createPlatformReport(report);
    logger.info(`[REPORT-GEN] Daily report created: ${created.id}`);
    
    // Send Discord notification (optional - won't fail if webhook not configured)
    await sendReportNotificationToDiscord({
      period: 'daily',
      startDate: startStr,
      endDate: endStr,
      totalIdeasGenerated: todayIdeas.length,
      overallWinRate: stats.winRate,
      totalPnlPercent: stats.totalPnl,
      bestPerformingEngine: bestEngine?.engine || null,
      totalWins: stats.wins,
      totalLosses: stats.losses,
    }).catch(err => logger.warn('[REPORT-GEN] Discord notification failed (non-fatal):', err));
    
    return created;
  } catch (error) {
    logger.error('[REPORT-GEN] Failed to generate daily report:', error);
    throw error;
  }
}

/**
 * Generate Weekly Report
 * Called Sunday at midnight CT
 */
export async function generateWeeklyReport(endDate?: Date): Promise<PlatformReport> {
  const end = endDate || new Date();
  const start = subDays(end, 6);
  
  const startStr = formatDateForDB(start);
  const endStr = formatDateForDB(end);
  
  logger.info(`[REPORT-GEN] Generating weekly report for ${startStr} to ${endStr}`);
  
  try {
    const allIdeas = await storage.getAllTradeIdeas();
    const weekIdeas = filterIdeasByDateRange(allIdeas, start, end);
    
    const bySource = countBySource(weekIdeas);
    const stats = calculateWinLossStats(weekIdeas);
    const enginePerf = calculateEnginePerformance(weekIdeas);
    const { topWinning, topLosing } = getTopSymbols(weekIdeas, 10);
    const assetBreakdown = countByAssetType(weekIdeas);
    
    const bestEngine = enginePerf
      .filter(e => e.resolved >= 5)
      .sort((a, b) => b.winRate - a.winRate)[0];
    
    const aiPerf = enginePerf.find(e => e.engine === 'ai');
    const quantPerf = enginePerf.find(e => e.engine === 'quant');
    const hybridPerf = enginePerf.find(e => e.engine === 'hybrid');
    
    const previousWeekStart = subDays(start, 7);
    const previousWeekEnd = subDays(start, 1);
    const prevWeekIdeas = filterIdeasByDateRange(allIdeas, previousWeekStart, previousWeekEnd);
    const prevStats = calculateWinLossStats(prevWeekIdeas);
    
    const winRateChange = stats.winRate - prevStats.winRate;
    const volumeChange = weekIdeas.length - prevWeekIdeas.length;
    
    const ctMentions = await storage.getCTMentions(168);
    
    const report: InsertPlatformReport = {
      period: 'weekly',
      startDate: startStr,
      endDate: endStr,
      status: 'completed',
      
      totalIdeasGenerated: weekIdeas.length,
      aiIdeasGenerated: bySource.ai || 0,
      quantIdeasGenerated: bySource.quant || 0,
      hybridIdeasGenerated: bySource.hybrid || 0,
      
      totalTradesResolved: stats.resolved,
      totalWins: stats.wins,
      totalLosses: stats.losses,
      overallWinRate: stats.winRate,
      avgGainPercent: stats.avgGain,
      avgLossPercent: stats.avgLoss,
      totalPnlPercent: stats.totalPnl,
      
      aiWinRate: aiPerf?.winRate || null,
      quantWinRate: quantPerf?.winRate || null,
      hybridWinRate: hybridPerf?.winRate || null,
      bestPerformingEngine: bestEngine?.engine || null,
      
      autoLottoTrades: bySource.lotto || 0,
      autoLottoPnl: 0,
      futuresBotTrades: assetBreakdown.futures,
      futuresBotPnl: 0,
      cryptoBotTrades: assetBreakdown.crypto,
      cryptoBotPnl: 0,
      propFirmTrades: 0,
      propFirmPnl: 0,
      
      optionsFlowAlerts: bySource.flow || 0,
      marketScannerSymbolsTracked: 0,
      ctTrackerMentions: ctMentions.length,
      ctTrackerAutoTrades: 0,
      
      stockTradeCount: assetBreakdown.stocks,
      optionsTradeCount: assetBreakdown.options,
      cryptoTradeCount: assetBreakdown.crypto,
      futuresTradeCount: assetBreakdown.futures,
      
      topWinningSymbols: topWinning,
      topLosingSymbols: topLosing,
      
      activeUsers: 0,
      newUsers: 0,
      
      reportData: {
        enginePerformance: enginePerf,
        bySource,
        weekOverWeek: {
          winRateChange,
          volumeChange,
          previousWinRate: prevStats.winRate,
          previousVolume: prevWeekIdeas.length,
        },
        generatedAt: new Date().toISOString(),
      },
      
      generatedBy: 'system',
    };
    
    const created = await storage.createPlatformReport(report);
    logger.info(`[REPORT-GEN] Weekly report created: ${created.id}`);
    
    // Send Discord notification (optional - won't fail if webhook not configured)
    await sendReportNotificationToDiscord({
      period: 'weekly',
      startDate: startStr,
      endDate: endStr,
      totalIdeasGenerated: weekIdeas.length,
      overallWinRate: stats.winRate,
      totalPnlPercent: stats.totalPnl,
      bestPerformingEngine: bestEngine?.engine || null,
      totalWins: stats.wins,
      totalLosses: stats.losses,
    }).catch(err => logger.warn('[REPORT-GEN] Discord notification failed (non-fatal):', err));
    
    return created;
  } catch (error) {
    logger.error('[REPORT-GEN] Failed to generate weekly report:', error);
    throw error;
  }
}

/**
 * Generate Monthly Report
 * Called on the 1st of each month at 12:01 AM CT
 */
export async function generateMonthlyReport(year: number, month: number): Promise<PlatformReport> {
  const start = new Date(year, month - 1, 1);
  const end = endOfMonth(start);
  
  const startStr = formatDateForDB(start);
  const endStr = formatDateForDB(end);
  
  logger.info(`[REPORT-GEN] Generating monthly report for ${year}-${String(month).padStart(2, '0')}`);
  
  try {
    const allIdeas = await storage.getAllTradeIdeas();
    const monthIdeas = filterIdeasByDateRange(allIdeas, start, end);
    
    const bySource = countBySource(monthIdeas);
    const stats = calculateWinLossStats(monthIdeas);
    const enginePerf = calculateEnginePerformance(monthIdeas);
    const { topWinning, topLosing } = getTopSymbols(monthIdeas, 10);
    const assetBreakdown = countByAssetType(monthIdeas);
    
    const bestEngine = enginePerf
      .filter(e => e.resolved >= 10)
      .sort((a, b) => b.winRate - a.winRate)[0];
    
    const aiPerf = enginePerf.find(e => e.engine === 'ai');
    const quantPerf = enginePerf.find(e => e.engine === 'quant');
    const hybridPerf = enginePerf.find(e => e.engine === 'hybrid');
    
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonthStart = new Date(prevYear, prevMonth - 1, 1);
    const prevMonthEnd = endOfMonth(prevMonthStart);
    const prevMonthIdeas = filterIdeasByDateRange(allIdeas, prevMonthStart, prevMonthEnd);
    const prevStats = calculateWinLossStats(prevMonthIdeas);
    
    const weeklyBreakdown: { week: number; ideas: number; winRate: number }[] = [];
    let weekStart = start;
    let weekNum = 1;
    while (weekStart <= end) {
      const weekEnd = new Date(Math.min(addDays(weekStart, 6).getTime(), end.getTime()));
      const weekIdeas = filterIdeasByDateRange(monthIdeas, weekStart, weekEnd);
      const weekStats = calculateWinLossStats(weekIdeas);
      weeklyBreakdown.push({
        week: weekNum,
        ideas: weekIdeas.length,
        winRate: weekStats.winRate,
      });
      weekStart = addDays(weekEnd, 1);
      weekNum++;
    }
    
    const report: InsertPlatformReport = {
      period: 'monthly',
      startDate: startStr,
      endDate: endStr,
      status: 'completed',
      
      totalIdeasGenerated: monthIdeas.length,
      aiIdeasGenerated: bySource.ai || 0,
      quantIdeasGenerated: bySource.quant || 0,
      hybridIdeasGenerated: bySource.hybrid || 0,
      
      totalTradesResolved: stats.resolved,
      totalWins: stats.wins,
      totalLosses: stats.losses,
      overallWinRate: stats.winRate,
      avgGainPercent: stats.avgGain,
      avgLossPercent: stats.avgLoss,
      totalPnlPercent: stats.totalPnl,
      
      aiWinRate: aiPerf?.winRate || null,
      quantWinRate: quantPerf?.winRate || null,
      hybridWinRate: hybridPerf?.winRate || null,
      bestPerformingEngine: bestEngine?.engine || null,
      
      autoLottoTrades: bySource.lotto || 0,
      autoLottoPnl: 0,
      futuresBotTrades: assetBreakdown.futures,
      futuresBotPnl: 0,
      cryptoBotTrades: assetBreakdown.crypto,
      cryptoBotPnl: 0,
      propFirmTrades: 0,
      propFirmPnl: 0,
      
      optionsFlowAlerts: bySource.flow || 0,
      marketScannerSymbolsTracked: 0,
      ctTrackerMentions: 0,
      ctTrackerAutoTrades: 0,
      
      stockTradeCount: assetBreakdown.stocks,
      optionsTradeCount: assetBreakdown.options,
      cryptoTradeCount: assetBreakdown.crypto,
      futuresTradeCount: assetBreakdown.futures,
      
      topWinningSymbols: topWinning,
      topLosingSymbols: topLosing,
      
      activeUsers: 0,
      newUsers: 0,
      
      reportData: {
        enginePerformance: enginePerf,
        bySource,
        weeklyBreakdown,
        monthOverMonth: {
          winRateChange: stats.winRate - prevStats.winRate,
          volumeChange: monthIdeas.length - prevMonthIdeas.length,
          previousWinRate: prevStats.winRate,
          previousVolume: prevMonthIdeas.length,
        },
        generatedAt: new Date().toISOString(),
      },
      
      generatedBy: 'system',
    };
    
    const created = await storage.createPlatformReport(report);
    logger.info(`[REPORT-GEN] Monthly report created: ${created.id}`);
    
    // Send Discord notification (optional - won't fail if webhook not configured)
    await sendReportNotificationToDiscord({
      period: 'monthly',
      startDate: startStr,
      endDate: endStr,
      totalIdeasGenerated: monthIdeas.length,
      overallWinRate: stats.winRate,
      totalPnlPercent: stats.totalPnl,
      bestPerformingEngine: bestEngine?.engine || null,
      totalWins: stats.wins,
      totalLosses: stats.losses,
    }).catch(err => logger.warn('[REPORT-GEN] Discord notification failed (non-fatal):', err));
    
    return created;
  } catch (error) {
    logger.error('[REPORT-GEN] Failed to generate monthly report:', error);
    throw error;
  }
}
