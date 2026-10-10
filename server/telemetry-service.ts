import { storage } from "./storage";
import { format, subDays, parseISO, differenceInHours } from "date-fns";
import type {
  EngineSource,
  InsertTradeInputSnapshot,
  InsertEngineDailyMetrics,
  InsertEngineHealthAlert,
  EngineDailyMetrics,
  TradeIdea,
} from "@shared/schema";

interface EngineMetrics {
  ideasGenerated: number;
  ideasPublished: number;
  tradesResolved: number;
  tradesWon: number;
  tradesLost: number;
  tradesExpired: number;
  winRate: number | null;
  avgGainPercent: number | null;
  avgLossPercent: number | null;
  expectancy: number | null;
  avgHoldingTimeMinutes: number | null;
  avgConfidenceScore: number | null;
}

type MetricsByEngine = Record<EngineSource, EngineMetrics>;

class TelemetryService {
  private readonly engines: EngineSource[] = ['flow', 'lotto', 'quant', 'ai', 'hybrid', 'manual'];

  async calculateDailyMetrics(date?: string): Promise<MetricsByEngine> {
    const targetDate = date || format(new Date(), 'yyyy-MM-dd');
    
    const allIdeas = await storage.getAllTradeIdeas();
    
    const ideasForDate = allIdeas.filter(idea => {
      const ideaDate = idea.timestamp ? idea.timestamp.split('T')[0] : null;
      return ideaDate === targetDate;
    });
    
    const resolvedForDate = allIdeas.filter(idea => {
      if (!idea.exitDate || idea.outcomeStatus === 'open') return false;
      const exitDate = idea.exitDate.split('T')[0];
      return exitDate === targetDate;
    });

    const result: MetricsByEngine = {} as MetricsByEngine;

    for (const engine of this.engines) {
      const engineIdeas = ideasForDate.filter(i => this.mapSourceToEngine(i.source) === engine);
      const engineResolved = resolvedForDate.filter(i => this.mapSourceToEngine(i.source) === engine);
      
      const winners = engineResolved.filter(i => i.outcomeStatus === 'hit_target');
      const losers = engineResolved.filter(i => i.outcomeStatus === 'hit_stop');
      const expired = engineResolved.filter(i => i.outcomeStatus === 'expired');
      
      const winRate = engineResolved.length > 0 
        ? (winners.length / (winners.length + losers.length)) * 100 
        : null;
      
      const avgGain = this.calculateAverage(winners.map(w => w.percentGain).filter((g): g is number => g !== null));
      const avgLoss = this.calculateAverage(losers.map(l => l.percentGain).filter((l): l is number => l !== null));
      
      let expectancy: number | null = null;
      if (winRate !== null && avgGain !== null && avgLoss !== null) {
        const winRateDecimal = winRate / 100;
        expectancy = (winRateDecimal * avgGain) - ((1 - winRateDecimal) * Math.abs(avgLoss));
      }
      
      const holdingTimes = engineResolved
        .map(i => i.actualHoldingTimeMinutes)
        .filter((t): t is number => t !== null);
      
      const confidenceScores = engineIdeas
        .map(i => i.confidenceScore)
        .filter((c): c is number => c !== null && c > 0);

      result[engine] = {
        ideasGenerated: engineIdeas.length,
        ideasPublished: engineIdeas.filter(i => i.status === 'published').length,
        tradesResolved: engineResolved.length,
        tradesWon: winners.length,
        tradesLost: losers.length,
        tradesExpired: expired.length,
        winRate,
        avgGainPercent: avgGain,
        avgLossPercent: avgLoss,
        expectancy,
        avgHoldingTimeMinutes: this.calculateAverage(holdingTimes),
        avgConfidenceScore: this.calculateAverage(confidenceScores),
      };
    }

    return result;
  }

  async saveInputSnapshot(
    tradeIdeaId: string, 
    engine: EngineSource, 
    inputs: object
  ): Promise<void> {
    const snapshot: InsertTradeInputSnapshot = {
      tradeIdeaId,
      engine,
      signalInputs: inputs,
      confidenceTotal: (inputs as Record<string, unknown>).confidenceTotal as number | undefined,
      confidenceBreakdown: (inputs as Record<string, unknown>).confidenceBreakdown as object | undefined,
      qualityBand: (inputs as Record<string, unknown>).qualityBand as string | undefined,
      volumeAtEntry: (inputs as Record<string, unknown>).volumeAtEntry as number | undefined,
      rsiAtEntry: (inputs as Record<string, unknown>).rsiAtEntry as number | undefined,
      ivAtEntry: (inputs as Record<string, unknown>).ivAtEntry as number | undefined,
      premiumAtEntry: (inputs as Record<string, unknown>).premiumAtEntry as number | undefined,
      skewRatioAtEntry: (inputs as Record<string, unknown>).skewRatioAtEntry as number | undefined,
      marketSessionAtEntry: (inputs as Record<string, unknown>).marketSession as string | undefined,
      vixAtEntry: (inputs as Record<string, unknown>).vixAtEntry as number | undefined,
      spyChangeAtEntry: (inputs as Record<string, unknown>).spyChangeAtEntry as number | undefined,
    };

    await storage.saveTradeInputSnapshot(snapshot);
    console.log(`📊 Saved input snapshot for trade ${tradeIdeaId} (${engine})`);
  }

  async runDailyRollup(): Promise<void> {
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    console.log(`📊 Running daily rollup for ${yesterday}...`);
    
    const metrics = await this.calculateDailyMetrics(yesterday);
    
    for (const engine of this.engines) {
      const engineMetrics = metrics[engine];
      
      if (engineMetrics.ideasGenerated === 0 && engineMetrics.tradesResolved === 0) {
        continue;
      }
      
      const dailyMetrics: InsertEngineDailyMetrics = {
        date: yesterday,
        engine,
        ideasGenerated: engineMetrics.ideasGenerated,
        ideasPublished: engineMetrics.ideasPublished,
        tradesResolved: engineMetrics.tradesResolved,
        tradesWon: engineMetrics.tradesWon,
        tradesLost: engineMetrics.tradesLost,
        tradesExpired: engineMetrics.tradesExpired,
        winRate: engineMetrics.winRate,
        avgGainPercent: engineMetrics.avgGainPercent,
        avgLossPercent: engineMetrics.avgLossPercent,
        expectancy: engineMetrics.expectancy,
        avgHoldingTimeMinutes: engineMetrics.avgHoldingTimeMinutes,
        avgConfidenceScore: engineMetrics.avgConfidenceScore,
      };
      
      await storage.saveEngineDailyMetrics(dailyMetrics);
      console.log(`  ✓ Saved metrics for ${engine}: ${engineMetrics.ideasGenerated} ideas, ${engineMetrics.tradesWon}W/${engineMetrics.tradesLost}L`);
    }
    
    console.log('✅ Daily rollup complete');
  }

  async checkEngineHealth(): Promise<void> {
    console.log('🔍 Checking engine health...');
    
    const today = format(new Date(), 'yyyy-MM-dd');
    const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    
    const recentMetrics = await storage.getEngineMetricsRange(sevenDaysAgo, today);
    const baselineMetrics = await storage.getEngineMetricsRange(thirtyDaysAgo, today);
    
    const allIdeas = await storage.getAllTradeIdeas();
    
    for (const engine of this.engines) {
      const engineRecentMetrics = recentMetrics.filter(m => m.engine === engine);
      const engineBaselineMetrics = baselineMetrics.filter(m => m.engine === engine);
      
      const recentWinRate = this.calculateAggregateWinRate(engineRecentMetrics);
      const baselineWinRate = this.calculateAggregateWinRate(engineBaselineMetrics);
      
      if (recentWinRate !== null && baselineWinRate !== null && baselineWinRate > 0) {
        const dropPercent = ((baselineWinRate - recentWinRate) / baselineWinRate) * 100;
        
        if (dropPercent > 15) {
          const alert: InsertEngineHealthAlert = {
            engine,
            alertType: 'win_rate_drop',
            severity: dropPercent > 25 ? 'critical' : 'warning',
            message: `${engine} engine win rate dropped ${dropPercent.toFixed(1)}% below 30-day baseline`,
            details: {
              recentWinRate: recentWinRate.toFixed(1),
              baselineWinRate: baselineWinRate.toFixed(1),
              dropPercent: dropPercent.toFixed(1),
            },
          };
          
          await storage.saveEngineHealthAlert(alert);
          console.log(`  ⚠️ Alert: ${engine} win rate drop (${recentWinRate.toFixed(1)}% vs ${baselineWinRate.toFixed(1)}% baseline)`);
        }
      }
      
      const engineIdeas = allIdeas.filter(i => this.mapSourceToEngine(i.source) === engine);
      const lastIdea = engineIdeas
        .filter(i => i.timestamp)
        .sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime())[0];
      
      if (lastIdea && lastIdea.timestamp) {
        const hoursSinceLastIdea = differenceInHours(new Date(), parseISO(lastIdea.timestamp));
        
        if (hoursSinceLastIdea >= 24) {
          const alert: InsertEngineHealthAlert = {
            engine,
            alertType: 'no_ideas',
            severity: hoursSinceLastIdea >= 48 ? 'critical' : 'warning',
            message: `${engine} engine has not generated ideas for ${hoursSinceLastIdea} hours`,
            details: {
              lastIdeaTimestamp: lastIdea.timestamp,
              hoursSinceLastIdea,
            },
          };
          
          await storage.saveEngineHealthAlert(alert);
          console.log(`  ⚠️ Alert: ${engine} no ideas for ${hoursSinceLastIdea}h`);
        }
      }
    }
    
    console.log('✅ Engine health check complete');
  }

  private mapSourceToEngine(source: string): EngineSource {
    const sourceToEngine: Record<string, EngineSource> = {
      'flow_scanner': 'flow',
      'flow': 'flow',
      'lotto_scanner': 'lotto',
      'lotto': 'lotto',
      'quant': 'quant',
      'quantitative': 'quant',
      'ai': 'ai',
      'chart_analysis': 'ai',
      'hybrid': 'hybrid',
      'manual': 'manual',
    };
    
    return sourceToEngine[source] || 'manual';
  }

  private calculateAverage(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private calculateAggregateWinRate(metrics: EngineDailyMetrics[]): number | null {
    const totalWins = metrics.reduce((sum, m) => sum + (m.tradesWon || 0), 0);
    const totalLosses = metrics.reduce((sum, m) => sum + (m.tradesLost || 0), 0);
    const totalDecided = totalWins + totalLosses;
    
    if (totalDecided === 0) return null;
    return (totalWins / totalDecided) * 100;
  }
}

export const telemetryService = new TelemetryService();
