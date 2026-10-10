import { db } from "./db";
import { tradeIdeas, signalPerformance } from "@shared/schema";
import { eq, sql, and, isNotNull, inArray } from "drizzle-orm";
import { logger } from "./logger";

export interface SignalStats {
  signalName: string;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  openCount: number;
  winRate: number;
  avgWinPercent: number;
  avgLossPercent: number;
  profitFactor: number;
  expectancy: number;
  stockWinRate: number;
  optionWinRate: number;
  cryptoWinRate: number;
  recentWinRate: number;
  trendDirection: 'improving' | 'declining' | 'stable';
  reliabilityScore: number;
  sampleSizeGrade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface SignalAttributionResult {
  signals: SignalStats[];
  topPerformers: SignalStats[];
  worstPerformers: SignalStats[];
  totalTradesAnalyzed: number;
  overallWinRate: number;
  lastUpdated: string;
}

function getSampleSizeGrade(n: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (n >= 100) return 'A';
  if (n >= 50) return 'B';
  if (n >= 20) return 'C';
  if (n >= 10) return 'D';
  return 'F';
}

function calculateReliabilityScore(stats: {
  winRate: number;
  totalTrades: number;
  profitFactor: number;
}): number {
  const sampleWeight = Math.min(stats.totalTrades / 100, 1) * 30;
  const winRateWeight = stats.winRate * 0.4;
  const profitFactorWeight = Math.min(stats.profitFactor * 10, 30);
  
  return Math.round(sampleWeight + winRateWeight + profitFactorWeight);
}

export async function calculateSignalAttribution(): Promise<SignalAttributionResult> {
  logger.info("📊 [SIGNAL-ATTRIBUTION] Starting signal performance calculation...");
  
  const closedTrades = await db.select()
    .from(tradeIdeas)
    .where(
      and(
        isNotNull(tradeIdeas.qualitySignals),
        inArray(tradeIdeas.outcomeStatus, ['hit_target', 'hit_stop', 'expired', 'manual_exit'])
      )
    );
  
  const openTrades = await db.select()
    .from(tradeIdeas)
    .where(
      and(
        isNotNull(tradeIdeas.qualitySignals),
        eq(tradeIdeas.outcomeStatus, 'open')
      )
    );
  
  const signalMap = new Map<string, {
    wins: { percent: number; assetType: string }[];
    losses: { percent: number; assetType: string }[];
    opens: number;
    recentOutcomes: boolean[];
  }>();
  
  for (const trade of closedTrades) {
    const signals = trade.qualitySignals || [];
    const isWin = trade.outcomeStatus === 'hit_target';
    const percentGain = trade.percentGain || 0;
    const assetType = trade.assetType;
    
    for (const signal of signals) {
      if (!signalMap.has(signal)) {
        signalMap.set(signal, { wins: [], losses: [], opens: 0, recentOutcomes: [] });
      }
      
      const data = signalMap.get(signal)!;
      
      if (isWin) {
        data.wins.push({ percent: percentGain, assetType });
      } else {
        data.losses.push({ percent: percentGain, assetType });
      }
      
      data.recentOutcomes.push(isWin);
      if (data.recentOutcomes.length > 30) {
        data.recentOutcomes.shift();
      }
    }
  }
  
  for (const trade of openTrades) {
    const signals = trade.qualitySignals || [];
    for (const signal of signals) {
      if (!signalMap.has(signal)) {
        signalMap.set(signal, { wins: [], losses: [], opens: 0, recentOutcomes: [] });
      }
      signalMap.get(signal)!.opens++;
    }
  }
  
  const signalStats: SignalStats[] = [];
  
  for (const [signalName, data] of signalMap.entries()) {
    const totalClosed = data.wins.length + data.losses.length;
    const totalTrades = totalClosed + data.opens;
    
    if (totalClosed === 0) {
      signalStats.push({
        signalName,
        totalTrades,
        winCount: 0,
        lossCount: 0,
        openCount: data.opens,
        winRate: 0,
        avgWinPercent: 0,
        avgLossPercent: 0,
        profitFactor: 0,
        expectancy: 0,
        stockWinRate: 0,
        optionWinRate: 0,
        cryptoWinRate: 0,
        recentWinRate: 0,
        trendDirection: 'stable',
        reliabilityScore: 0,
        sampleSizeGrade: getSampleSizeGrade(totalTrades),
      });
      continue;
    }
    
    const winRate = (data.wins.length / totalClosed) * 100;
    const avgWinPercent = data.wins.length > 0 
      ? data.wins.reduce((sum, w) => sum + w.percent, 0) / data.wins.length 
      : 0;
    const avgLossPercent = data.losses.length > 0 
      ? data.losses.reduce((sum, l) => sum + l.percent, 0) / data.losses.length 
      : 0;
    
    const totalWinAmount = data.wins.reduce((sum, w) => sum + Math.abs(w.percent), 0);
    const totalLossAmount = data.losses.reduce((sum, l) => sum + Math.abs(l.percent), 0);
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? 10 : 0;
    
    const expectancy = (winRate / 100 * avgWinPercent) + ((1 - winRate / 100) * avgLossPercent);
    
    const stockWins = data.wins.filter(w => w.assetType === 'stock').length;
    const stockLosses = data.losses.filter(l => l.assetType === 'stock').length;
    const stockTotal = stockWins + stockLosses;
    const stockWinRate = stockTotal > 0 ? (stockWins / stockTotal) * 100 : 0;
    
    const optionWins = data.wins.filter(w => w.assetType === 'option').length;
    const optionLosses = data.losses.filter(l => l.assetType === 'option').length;
    const optionTotal = optionWins + optionLosses;
    const optionWinRate = optionTotal > 0 ? (optionWins / optionTotal) * 100 : 0;
    
    const cryptoWins = data.wins.filter(w => w.assetType === 'crypto').length;
    const cryptoLosses = data.losses.filter(l => l.assetType === 'crypto').length;
    const cryptoTotal = cryptoWins + cryptoLosses;
    const cryptoWinRate = cryptoTotal > 0 ? (cryptoWins / cryptoTotal) * 100 : 0;
    
    const recentWins = data.recentOutcomes.filter(o => o).length;
    const recentWinRate = data.recentOutcomes.length > 0 
      ? (recentWins / data.recentOutcomes.length) * 100 
      : 0;
    
    let trendDirection: 'improving' | 'declining' | 'stable' = 'stable';
    if (data.recentOutcomes.length >= 10) {
      const recentHalf = data.recentOutcomes.slice(-Math.floor(data.recentOutcomes.length / 2));
      const olderHalf = data.recentOutcomes.slice(0, Math.floor(data.recentOutcomes.length / 2));
      const recentRate = recentHalf.filter(o => o).length / recentHalf.length;
      const olderRate = olderHalf.filter(o => o).length / olderHalf.length;
      
      if (recentRate - olderRate > 0.1) trendDirection = 'improving';
      else if (olderRate - recentRate > 0.1) trendDirection = 'declining';
    }
    
    const stats: SignalStats = {
      signalName,
      totalTrades,
      winCount: data.wins.length,
      lossCount: data.losses.length,
      openCount: data.opens,
      winRate: Math.round(winRate * 10) / 10,
      avgWinPercent: Math.round(avgWinPercent * 100) / 100,
      avgLossPercent: Math.round(avgLossPercent * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      stockWinRate: Math.round(stockWinRate * 10) / 10,
      optionWinRate: Math.round(optionWinRate * 10) / 10,
      cryptoWinRate: Math.round(cryptoWinRate * 10) / 10,
      recentWinRate: Math.round(recentWinRate * 10) / 10,
      trendDirection,
      reliabilityScore: 0,
      sampleSizeGrade: getSampleSizeGrade(totalTrades),
    };
    
    stats.reliabilityScore = calculateReliabilityScore({
      winRate: stats.winRate,
      totalTrades: stats.totalTrades,
      profitFactor: stats.profitFactor,
    });
    
    signalStats.push(stats);
  }
  
  signalStats.sort((a, b) => b.reliabilityScore - a.reliabilityScore);
  
  const qualifiedSignals = signalStats.filter(s => s.totalTrades >= 10);
  const topPerformers = qualifiedSignals
    .filter(s => s.winRate >= 60)
    .slice(0, 5);
  const worstPerformers = qualifiedSignals
    .filter(s => s.winRate < 50)
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, 5);
  
  const totalTradesAnalyzed = closedTrades.length;
  const overallWins = closedTrades.filter(t => t.outcomeStatus === 'hit_target').length;
  const overallWinRate = totalTradesAnalyzed > 0 
    ? Math.round((overallWins / totalTradesAnalyzed) * 1000) / 10 
    : 0;
  
  for (const stats of signalStats) {
    try {
      const existing = await db.select()
        .from(signalPerformance)
        .where(eq(signalPerformance.signalName, stats.signalName))
        .limit(1);
      
      const performanceData = {
        signalName: stats.signalName,
        totalTrades: stats.totalTrades,
        winCount: stats.winCount,
        lossCount: stats.lossCount,
        openCount: stats.openCount,
        winRate: stats.winRate,
        avgWinPercent: stats.avgWinPercent,
        avgLossPercent: stats.avgLossPercent,
        profitFactor: stats.profitFactor,
        expectancy: stats.expectancy,
        stockWinRate: stats.stockWinRate,
        optionWinRate: stats.optionWinRate,
        cryptoWinRate: stats.cryptoWinRate,
        recentWinRate: stats.recentWinRate,
        trendDirection: stats.trendDirection,
        reliabilityScore: stats.reliabilityScore,
        sampleSizeGrade: stats.sampleSizeGrade,
        lastCalculatedAt: new Date(),
      };
      
      if (existing.length > 0) {
        await db.update(signalPerformance)
          .set(performanceData)
          .where(eq(signalPerformance.signalName, stats.signalName));
      } else {
        await db.insert(signalPerformance).values(performanceData);
      }
    } catch (error) {
      logger.warn(`[SIGNAL-ATTRIBUTION] Failed to save ${stats.signalName}:`, error);
    }
  }
  
  logger.info(`📊 [SIGNAL-ATTRIBUTION] Analyzed ${signalStats.length} signals from ${totalTradesAnalyzed} closed trades`);
  logger.info(`📊 [SIGNAL-ATTRIBUTION] Top performer: ${topPerformers[0]?.signalName || 'N/A'} (${topPerformers[0]?.winRate || 0}% win rate)`);
  
  return {
    signals: signalStats,
    topPerformers,
    worstPerformers,
    totalTradesAnalyzed,
    overallWinRate,
    lastUpdated: new Date().toISOString(),
  };
}

export async function getSignalPerformanceFromCache(): Promise<SignalStats[]> {
  const cached = await db.select().from(signalPerformance).orderBy(signalPerformance.reliabilityScore);
  
  return cached.map(row => ({
    signalName: row.signalName,
    totalTrades: row.totalTrades,
    winCount: row.winCount,
    lossCount: row.lossCount,
    openCount: row.openCount,
    winRate: row.winRate,
    avgWinPercent: row.avgWinPercent,
    avgLossPercent: row.avgLossPercent,
    profitFactor: row.profitFactor,
    expectancy: row.expectancy,
    stockWinRate: row.stockWinRate || 0,
    optionWinRate: row.optionWinRate || 0,
    cryptoWinRate: row.cryptoWinRate || 0,
    recentWinRate: row.recentWinRate || 0,
    trendDirection: row.trendDirection as 'improving' | 'declining' | 'stable' || 'stable',
    reliabilityScore: row.reliabilityScore || 0,
    sampleSizeGrade: row.sampleSizeGrade as 'A' | 'B' | 'C' | 'D' | 'F' || 'F',
  }));
}

// Helper to convert detailed band to coarse band for external display
function getCoarseBandFromDetailed(detailedBand: string): string {
  if (detailedBand === 'A+' || detailedBand === 'A') return 'A';
  if (detailedBand === 'B+' || detailedBand === 'B') return 'B';
  if (detailedBand === 'C+' || detailedBand === 'C') return 'C';
  if (detailedBand === 'D' || detailedBand === 'F') return 'D';
  return 'D';
}

// Consolidates detailed band stats into coarse bands (A, B, C, D)
export interface ConsolidatedBandStats {
  band: string;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  detailedBands: string[]; // Shows which detailed bands are included
}

export function consolidateBandStats(signals: SignalStats[]): ConsolidatedBandStats[] {
  const bandMap = new Map<string, { trades: number; wins: number; losses: number; detailed: Set<string> }>();
  
  for (const signal of signals) {
    // Check if signal name looks like a band (A+, A, B+, B, C+, C, D, F)
    const bandPattern = /^(A\+|A|B\+|B|C\+|C|D|F)$/;
    if (!bandPattern.test(signal.signalName)) continue;
    
    const coarseBand = getCoarseBandFromDetailed(signal.signalName);
    
    if (!bandMap.has(coarseBand)) {
      bandMap.set(coarseBand, { trades: 0, wins: 0, losses: 0, detailed: new Set() });
    }
    
    const data = bandMap.get(coarseBand)!;
    data.trades += signal.totalTrades;
    data.wins += signal.winCount;
    data.losses += signal.lossCount;
    data.detailed.add(signal.signalName);
  }
  
  const result: ConsolidatedBandStats[] = [];
  const bandOrder = ['A', 'B', 'C', 'D'];
  
  for (const band of bandOrder) {
    const data = bandMap.get(band);
    if (data && data.trades > 0) {
      result.push({
        band,
        totalTrades: data.trades,
        winCount: data.wins,
        lossCount: data.losses,
        winRate: Math.round((data.wins / data.trades) * 1000) / 10,
        detailedBands: Array.from(data.detailed).sort(),
      });
    }
  }
  
  return result;
}
