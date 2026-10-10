/**
 * Diagnostic Data Export Service
 * Generates comprehensive reports for LLM analysis to identify performance bottlenecks,
 * technical issues, system faults, and data quality problems
 */

import { storage } from './storage';
import { monitoringService } from './monitoring-service';
import { logger } from './logger';

export interface DiagnosticExport {
  generatedAt: string;
  version: string;
  timeRange: {
    start: string;
    end: string;
  };
  performanceAnalysis: PerformanceAnalysis;
  technicalIssues: TechnicalIssues;
  systemFaults: SystemFaults;
  dataQuality: DataQuality;
}

export interface PerformanceAnalysis {
  overallMetrics: {
    totalTrades: number;
    openTrades: number;
    closedTrades: number;
    winRate: number;
    avgRiskReward: number;
    profitFactor: number;
    maxDrawdown: number;
    avgHoldingTimeHours: number;
  };
  bySignalType: SignalTypeMetrics[];
  byAssetType: AssetTypeMetrics[];
  byMarketCondition: MarketConditionMetrics[];
  byEngineVersion: EngineVersionMetrics[];
  byTimeOfDay: TimeOfDayMetrics[];
  confidenceScoreEffectiveness: ConfidenceScoreAnalysis[];
  rawTradeData: TradeRecord[];
}

export interface SignalTypeMetrics {
  signalType: string;
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  avgConfidenceScore: number;
  successByConfidence: { scoreRange: string; winRate: number; count: number }[];
}

export interface AssetTypeMetrics {
  assetType: string;
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  avgRiskReward: number;
}

export interface MarketConditionMetrics {
  condition: string; // e.g., "trending", "ranging", "volatile"
  totalTrades: number;
  winRate: number;
  avgReturn: number;
}

export interface EngineVersionMetrics {
  version: string;
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  firstSeen: string;
  lastSeen: string;
}

export interface TimeOfDayMetrics {
  hourET: number;
  totalTrades: number;
  winRate: number;
  avgReturn: number;
}

export interface ConfidenceScoreAnalysis {
  scoreRange: string; // e.g., "90-100", "80-90"
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  expectedWinRate: number; // Based on score
  accuracyDelta: number; // Difference between actual and expected
}

export interface TradeRecord {
  id: string;
  symbol: string;
  assetType: string;
  direction: string;
  source: string;
  engineVersion: string | null;
  confidenceScore: number | null;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  riskRewardRatio: number;
  outcomeStatus: string;
  exitPrice: number | null;
  percentGain: number | null;
  holdingPeriod: string | null;
  timestamp: string;
  exitDate: string | null;
  catalyst: string | null;
  volatilityRegime: string | null;
  sessionPhase: string | null;
  validationErrors: string[];
}

export interface TechnicalIssues {
  apiReliability: {
    provider: string;
    totalCalls: number;
    successRate: number;
    avgResponseTimeMs: number;
    recentFailures: { timestamp: string; error: string }[];
    rateLimitHits: number;
  }[];
  dataStalenessConcerns: {
    symbol: string;
    lastUpdate: string;
    ageHours: number;
    expectedUpdateIntervalMinutes: number;
  }[];
  signalCalculationIssues: {
    symbol: string;
    issue: string;
    timestamp: string;
    details: string;
  }[];
}

export interface SystemFaults {
  confidenceScoringIssues: {
    tradeId: string;
    symbol: string;
    expectedScore: number;
    actualScore: number;
    delta: number;
    reason: string;
  }[];
  dataIntegrityViolations: {
    tradeId: string;
    issue: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    details: string;
  }[];
  systemAlerts: {
    id: string;
    type: string;
    category: string;
    message: string;
    timestamp: string;
    resolved: boolean;
  }[];
}

export interface DataQuality {
  crossSourceValidation: {
    symbol: string;
    source1: { provider: string; price: number; timestamp: string };
    source2: { provider: string; price: number; timestamp: string };
    discrepancyPercent: number;
  }[];
  missingData: {
    category: string; // e.g., "historical_prices", "market_data", "options_data"
    affectedSymbols: string[];
    count: number;
    impact: string;
  }[];
  signalGenerationInconsistencies: {
    symbol: string;
    expectedSignal: string;
    actualSignal: string;
    marketData: any;
    timestamp: string;
  }[];
  outcomeValidationIssues: {
    tradeId: string;
    issue: string;
    details: string;
  }[];
}

/**
 * Generate comprehensive diagnostic export for LLM analysis
 */
export async function generateDiagnosticExport(
  daysBack: number = 30,
  includeRawData: boolean = true
): Promise<DiagnosticExport> {
  logger.info('📊 Generating diagnostic export for LLM analysis...');
  
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const export_: DiagnosticExport = {
    generatedAt: new Date().toISOString(),
    version: 'v3.2.0',
    timeRange: {
      start: startDate.toISOString(),
      end: endDate.toISOString()
    },
    performanceAnalysis: await generatePerformanceAnalysis(startDate, endDate, includeRawData),
    technicalIssues: await generateTechnicalIssues(),
    systemFaults: await generateSystemFaults(),
    dataQuality: await generateDataQuality()
  };

  logger.info('✅ Diagnostic export generated successfully');
  return export_;
}

/**
 * Performance Analysis - Trade outcomes, win rates, profit factors
 */
async function generatePerformanceAnalysis(
  startDate: Date,
  endDate: Date,
  includeRawData: boolean
): Promise<PerformanceAnalysis> {
  const allTrades = await storage.getAllTradeIdeas();
  const trades = allTrades.filter(t => {
    const tradeDate = new Date(t.timestamp);
    return tradeDate >= startDate && tradeDate <= endDate;
  });

  const closedTrades = trades.filter(t => t.outcomeStatus && ['hit_target', 'hit_stop', 'expired', 'manual_exit'].includes(t.outcomeStatus));
  const winners = closedTrades.filter(t => t.outcomeStatus === 'hit_target');
  const openTrades = trades.filter(t => t.outcomeStatus === 'open');

  // Overall metrics
  const winRate = closedTrades.length > 0 ? (winners.length / closedTrades.length) * 100 : 0;
  const avgRiskReward = trades.length > 0
    ? trades.reduce((sum, t) => sum + (t.riskRewardRatio || 0), 0) / trades.length
    : 0;

  // Profit factor calculation
  const totalGains = winners.reduce((sum, t) => sum + Math.abs(t.percentGain || 0), 0);
  const losers = closedTrades.filter(t => t.outcomeStatus === 'hit_stop');
  const totalLosses = losers.reduce((sum, t) => sum + Math.abs(t.percentGain || 0), 0);
  const profitFactor = totalLosses > 0 ? totalGains / totalLosses : 0;

  // Max drawdown (simplified - assumes sequential trades)
  let maxDrawdown = 0;
  let runningPnL = 0;
  let peak = 0;
  closedTrades.forEach(t => {
    runningPnL += t.percentGain || 0;
    if (runningPnL > peak) peak = runningPnL;
    const drawdown = peak - runningPnL;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  });

  // Average holding time
  const tradesWithHoldingTime = closedTrades.filter(t => t.actualHoldingTimeMinutes);
  const avgHoldingTimeHours = tradesWithHoldingTime.length > 0
    ? tradesWithHoldingTime.reduce((sum, t) => sum + (t.actualHoldingTimeMinutes || 0), 0) / tradesWithHoldingTime.length / 60
    : 0;

  return {
    overallMetrics: {
      totalTrades: trades.length,
      openTrades: openTrades.length,
      closedTrades: closedTrades.length,
      winRate,
      avgRiskReward,
      profitFactor,
      maxDrawdown,
      avgHoldingTimeHours
    },
    bySignalType: calculateSignalTypeMetrics(trades),
    byAssetType: calculateAssetTypeMetrics(trades),
    byMarketCondition: calculateMarketConditionMetrics(trades),
    byEngineVersion: calculateEngineVersionMetrics(trades),
    byTimeOfDay: calculateTimeOfDayMetrics(trades),
    confidenceScoreEffectiveness: calculateConfidenceScoreEffectiveness(trades),
    rawTradeData: includeRawData ? trades.map(mapToTradeRecord) : []
  };
}

function calculateSignalTypeMetrics(trades: any[]): SignalTypeMetrics[] {
  // Extract signal types from quality signals or catalyst
  const signalMap = new Map<string, any[]>();
  
  trades.forEach(t => {
    const signals = t.qualitySignals || [];
    const primarySignal = signals[0] || 'Unknown';
    
    if (!signalMap.has(primarySignal)) {
      signalMap.set(primarySignal, []);
    }
    signalMap.get(primarySignal)!.push(t);
  });

  return Array.from(signalMap.entries()).map(([signalType, signalTrades]) => {
    const closed = signalTrades.filter(t => t.outcomeStatus && ['hit_target', 'hit_stop', 'expired'].includes(t.outcomeStatus));
    const winners = closed.filter(t => t.outcomeStatus === 'hit_target');
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const avgReturn = closed.length > 0
      ? closed.reduce((sum, t) => sum + (t.percentGain || 0), 0) / closed.length
      : 0;
    const avgConfidence = signalTrades.length > 0
      ? signalTrades.reduce((sum, t) => sum + (t.confidenceScore || 0), 0) / signalTrades.length
      : 0;

    // Success by confidence range
    const confidenceRanges = [
      { range: '90-100', min: 90, max: 100 },
      { range: '80-89', min: 80, max: 89 },
      { range: '70-79', min: 70, max: 79 },
      { range: '<70', min: 0, max: 69 }
    ];

    const successByConfidence = confidenceRanges.map(r => {
      const rangeT = signalTrades.filter(t =>
        t.confidenceScore >= r.min && t.confidenceScore <= r.max
      );
      const closedRange = rangeT.filter(t => t.outcomeStatus && ['hit_target', 'hit_stop', 'expired'].includes(t.outcomeStatus));
      const winnersRange = closedRange.filter(t => t.outcomeStatus === 'hit_target');
      const wr = closedRange.length > 0 ? (winnersRange.length / closedRange.length) * 100 : 0;

      return {
        scoreRange: r.range,
        winRate: wr,
        count: rangeT.length
      };
    });

    return {
      signalType,
      totalTrades: signalTrades.length,
      winRate,
      avgReturn,
      avgConfidenceScore: avgConfidence,
      successByConfidence
    };
  });
}

function calculateAssetTypeMetrics(trades: any[]): AssetTypeMetrics[] {
  const assetTypes = ['stock', 'crypto', 'option'];
  
  return assetTypes.map(assetType => {
    const assetTrades = trades.filter(t => t.assetType === assetType);
    const closed = assetTrades.filter(t => t.outcomeStatus && ['hit_target', 'hit_stop', 'expired'].includes(t.outcomeStatus));
    const winners = closed.filter(t => t.outcomeStatus === 'hit_target');
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const avgReturn = closed.length > 0
      ? closed.reduce((sum, t) => sum + (t.percentGain || 0), 0) / closed.length
      : 0;
    const avgRR = assetTrades.length > 0
      ? assetTrades.reduce((sum, t) => sum + (t.riskRewardRatio || 0), 0) / assetTrades.length
      : 0;

    return {
      assetType,
      totalTrades: assetTrades.length,
      winRate,
      avgReturn,
      avgRiskReward: avgRR
    };
  });
}

function calculateMarketConditionMetrics(trades: any[]): MarketConditionMetrics[] {
  // Group by volatility regime
  const conditions = ['low', 'moderate', 'high', 'extreme', 'unknown'];
  
  return conditions.map(condition => {
    const condTrades = trades.filter(t =>
      ((t.volatilityRegime as string | null) || 'unknown').toLowerCase() === condition
    );
    const closed = condTrades.filter(t => t.outcomeStatus && ['hit_target', 'hit_stop', 'expired'].includes(t.outcomeStatus));
    const winners = closed.filter(t => t.outcomeStatus === 'hit_target');
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const avgReturn = closed.length > 0
      ? closed.reduce((sum, t) => sum + (t.percentGain || 0), 0) / closed.length
      : 0;

    return {
      condition,
      totalTrades: condTrades.length,
      winRate,
      avgReturn
    };
  });
}

function calculateEngineVersionMetrics(trades: any[]): EngineVersionMetrics[] {
  const versionMap = new Map<string, any[]>();
  
  trades.forEach(t => {
    const version = t.engineVersion || 'unknown';
    if (!versionMap.has(version)) {
      versionMap.set(version, []);
    }
    versionMap.get(version)!.push(t);
  });

  return Array.from(versionMap.entries()).map(([version, versionTrades]) => {
    const closed = versionTrades.filter(t => t.outcomeStatus && ['hit_target', 'hit_stop', 'expired'].includes(t.outcomeStatus));
    const winners = closed.filter(t => t.outcomeStatus === 'hit_target');
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const avgReturn = closed.length > 0
      ? closed.reduce((sum, t) => sum + (t.percentGain || 0), 0) / closed.length
      : 0;

    const timestamps = versionTrades.map(t => new Date(t.timestamp).getTime());
    const firstSeen = new Date(Math.min(...timestamps)).toISOString();
    const lastSeen = new Date(Math.max(...timestamps)).toISOString();

    return {
      version,
      totalTrades: versionTrades.length,
      winRate,
      avgReturn,
      firstSeen,
      lastSeen
    };
  });
}

function calculateTimeOfDayMetrics(trades: any[]): TimeOfDayMetrics[] {
  const hourMap = new Map<number, any[]>();
  
  trades.forEach(t => {
    const date = new Date(t.timestamp);
    // Convert to ET (approximate - ignoring DST for simplicity)
    const etHour = (date.getUTCHours() - 5 + 24) % 24;
    
    if (!hourMap.has(etHour)) {
      hourMap.set(etHour, []);
    }
    hourMap.get(etHour)!.push(t);
  });

  return Array.from(hourMap.entries())
    .map(([hourET, hourTrades]) => {
      const closed = hourTrades.filter(t => t.outcomeStatus && ['hit_target', 'hit_stop', 'expired'].includes(t.outcomeStatus));
      const winners = closed.filter(t => t.outcomeStatus === 'hit_target');
      const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
      const avgReturn = closed.length > 0
        ? closed.reduce((sum, t) => sum + (t.percentGain || 0), 0) / closed.length
        : 0;

      return {
        hourET,
        totalTrades: hourTrades.length,
        winRate,
        avgReturn
      };
    })
    .sort((a, b) => a.hourET - b.hourET);
}

function calculateConfidenceScoreEffectiveness(trades: any[]): ConfidenceScoreAnalysis[] {
  const ranges = [
    { range: '90-100', min: 90, max: 100, expectedWR: 90 },
    { range: '80-89', min: 80, max: 89, expectedWR: 80 },
    { range: '70-79', min: 70, max: 79, expectedWR: 70 },
    { range: '60-69', min: 60, max: 69, expectedWR: 60 },
    { range: '<60', min: 0, max: 59, expectedWR: 50 }
  ];

  return ranges.map(r => {
    const rangeTrades = trades.filter(t =>
      t.confidenceScore >= r.min && t.confidenceScore <= r.max
    );
    const closed = rangeTrades.filter(t => t.outcomeStatus && ['hit_target', 'hit_stop', 'expired'].includes(t.outcomeStatus));
    const winners = closed.filter(t => t.outcomeStatus === 'hit_target');
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const avgReturn = closed.length > 0
      ? closed.reduce((sum, t) => sum + (t.percentGain || 0), 0) / closed.length
      : 0;

    return {
      scoreRange: r.range,
      totalTrades: rangeTrades.length,
      winRate,
      avgReturn,
      expectedWinRate: r.expectedWR,
      accuracyDelta: winRate - r.expectedWR
    };
  });
}

function mapToTradeRecord(trade: any): TradeRecord {
  // Validate trade data for common issues
  const errors: string[] = [];
  
  if (trade.direction === 'long' && trade.targetPrice < trade.entryPrice) {
    errors.push('LONG trade has target below entry');
  }
  if (trade.direction === 'short' && trade.targetPrice > trade.entryPrice) {
    errors.push('SHORT trade has target above entry');
  }
  if (trade.riskRewardRatio < 1) {
    errors.push('Risk/Reward ratio below 1:1');
  }
  if (trade.confidenceScore && (trade.confidenceScore < 0 || trade.confidenceScore > 100)) {
    errors.push('Confidence score out of valid range (0-100)');
  }

  return {
    id: trade.id,
    symbol: trade.symbol,
    assetType: trade.assetType,
    direction: trade.direction,
    source: trade.source,
    engineVersion: trade.engineVersion,
    confidenceScore: trade.confidenceScore,
    entryPrice: trade.entryPrice,
    targetPrice: trade.targetPrice,
    stopLoss: trade.stopLoss,
    riskRewardRatio: trade.riskRewardRatio,
    outcomeStatus: trade.outcomeStatus,
    exitPrice: trade.exitPrice,
    percentGain: trade.percentGain,
    holdingPeriod: trade.holdingPeriod,
    timestamp: trade.timestamp,
    exitDate: trade.exitDate,
    catalyst: trade.catalyst,
    volatilityRegime: trade.volatilityRegime,
    sessionPhase: trade.sessionPhase,
    validationErrors: errors
  };
}

/**
 * Technical Issues - API reliability, data staleness, calculation errors
 */
async function generateTechnicalIssues(): Promise<TechnicalIssues> {
  const apiMetrics = monitoringService.getAPIMetrics();
  const alerts = monitoringService.getAlerts();

  // API Reliability
  const apiReliability = apiMetrics.map(metric => {
    const totalCalls = metric.successCount + metric.failureCount;
    const successRate = totalCalls > 0 ? (metric.successCount / totalCalls) * 100 : 0;

    // Get recent failures from alerts
    const recentFailures = alerts
      .filter(a => 
        a.category === 'api' && 
        a.message.includes(metric.provider) &&
        !a.resolved
      )
      .slice(0, 10)
      .map(a => ({
        timestamp: a.timestamp,
        error: a.message
      }));

    return {
      provider: metric.provider,
      totalCalls,
      successRate,
      avgResponseTimeMs: metric.avgResponseTime,
      recentFailures,
      rateLimitHits: metric.rateLimitWarning ? 1 : 0
    };
  });

  return {
    apiReliability,
    dataStalenessConcerns: [], // Would need to implement cache age tracking
    signalCalculationIssues: [] // Would need to log these during calculation
  };
}

/**
 * System Faults - Confidence scoring issues, data integrity violations
 */
async function generateSystemFaults(): Promise<SystemFaults> {
  const alerts = monitoringService.getAlerts();
  const trades = await storage.getAllTradeIdeas();

  // Find confidence scoring anomalies
  const confidenceScoringIssues = trades
    .filter(t => {
      // Flag trades where confidence score doesn't match actual outcome
      if (!t.confidenceScore || !t.outcomeStatus || !['hit_target', 'hit_stop'].includes(t.outcomeStatus)) return false;
      
      // If confidence is 90+ but trade lost, that's a scoring issue
      if (t.confidenceScore >= 90 && t.outcomeStatus === 'hit_stop') return true;
      
      // If confidence is <70 but trade won big, that's also an issue
      if (t.confidenceScore < 70 && t.outcomeStatus === 'hit_target' && (t.percentGain || 0) > 10) return true;
      
      return false;
    })
    .slice(0, 50) // Limit to 50 examples
    .map(t => ({
      tradeId: t.id,
      symbol: t.symbol,
      expectedScore: t.outcomeStatus === 'hit_target' ? 90 : 60,
      actualScore: t.confidenceScore || 0,
      delta: Math.abs((t.confidenceScore || 0) - (t.outcomeStatus === 'hit_target' ? 90 : 60)),
      reason: `${t.outcomeStatus === 'hit_target' ? 'Won' : 'Lost'} despite ${t.confidenceScore}% confidence`
    }));

  // Data integrity violations
  const dataIntegrityViolations = trades
    .filter(t => {
      // Check for logical inconsistencies
      if (t.direction === 'long' && t.targetPrice < t.entryPrice) return true;
      if (t.direction === 'short' && t.targetPrice > t.entryPrice) return true;
      if (t.riskRewardRatio < 0.5) return true;
      if (t.stopLoss === t.entryPrice) return true;
      return false;
    })
    .slice(0, 50)
    .map(t => {
      let issue = '';
      let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
      
      if (t.direction === 'long' && t.targetPrice < t.entryPrice) {
        issue = 'LONG trade has target below entry';
        severity = 'high';
      } else if (t.direction === 'short' && t.targetPrice > t.entryPrice) {
        issue = 'SHORT trade has target above entry';
        severity = 'high';
      } else if (t.riskRewardRatio < 0.5) {
        issue = 'Risk/Reward ratio too low (<0.5:1)';
        severity = 'medium';
      } else if (t.stopLoss === t.entryPrice) {
        issue = 'Stop loss equals entry price';
        severity = 'critical';
      }

      return {
        tradeId: t.id,
        issue,
        severity,
        details: `Symbol: ${t.symbol}, Entry: $${t.entryPrice}, Target: $${t.targetPrice}, Stop: $${t.stopLoss}`
      };
    });

  // System alerts
  const systemAlerts = alerts.slice(0, 100).map(a => ({
    id: a.id,
    type: a.type,
    category: a.category,
    message: a.message,
    timestamp: a.timestamp,
    resolved: a.resolved
  }));

  return {
    confidenceScoringIssues,
    dataIntegrityViolations,
    systemAlerts
  };
}

/**
 * Data Quality - Cross-source validation, missing data, inconsistencies
 */
async function generateDataQuality(): Promise<DataQuality> {
  const trades = await storage.getAllTradeIdeas();

  // Missing outcome data
  const closedWithoutExit = trades.filter(t =>
    t.outcomeStatus && ['hit_target', 'hit_stop'].includes(t.outcomeStatus) && !t.exitPrice
  );

  const missingData = [
    {
      category: 'exit_prices',
      affectedSymbols: Array.from(new Set(closedWithoutExit.map(t => t.symbol))),
      count: closedWithoutExit.length,
      impact: 'Cannot calculate actual returns or validate predictions'
    }
  ];

  // Outcome validation issues
  const outcomeValidationIssues = trades
    .filter(t => {
      if (!t.outcomeStatus || !['hit_target', 'hit_stop'].includes(t.outcomeStatus)) return false;
      
      // Check if outcome matches the actual price movement
      if (t.outcomeStatus === 'hit_target' && t.exitPrice && t.exitPrice < t.entryPrice && t.direction === 'long') {
        return true; // Winner but price went down on long trade
      }
      if (t.outcomeStatus === 'hit_stop' && t.exitPrice && t.exitPrice > t.entryPrice && t.direction === 'long') {
        return true; // Loser but price went up on long trade
      }
      
      return false;
    })
    .slice(0, 50)
    .map(t => ({
      tradeId: t.id,
      issue: 'Outcome status conflicts with actual price movement',
      details: `${t.symbol}: ${t.direction} from $${t.entryPrice} to $${t.exitPrice} marked as ${t.outcomeStatus}`
    }));

  return {
    crossSourceValidation: [], // Would need multi-source price tracking
    missingData,
    signalGenerationInconsistencies: [], // Would need to log expected vs actual signals
    outcomeValidationIssues
  };
}
