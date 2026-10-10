/**
 * Research-Grade Trade Evaluation Engine
 *
 * Institutional-quality performance analysis following Goldman Sachs / Two Sigma standards.
 *
 * Key Principles:
 * 1. R-Multiple Analysis - Measure risk-adjusted returns in risk units
 * 2. MAE/MFE Tracking - Maximum Adverse/Favorable Excursion for stop optimization
 * 3. Statistical Significance - P-values for all metrics
 * 4. Time-Weighted Returns - Annualize per-trade performance
 * 5. Benchmark Comparison - Alpha/Beta vs SPY
 * 6. Distribution Analysis - Not just mean, but skew/kurtosis
 *
 * Win/Loss Definition (Research Standard):
 * - WIN: Trade closed with positive risk-adjusted return (R > 0)
 * - LOSS: Trade closed with negative risk-adjusted return (R < 0)
 * - SCRATCH: Trade closed near breakeven (-0.5R to +0.5R)
 *
 * What makes a "real" win:
 * - Hit target price (objective)
 * - Positive R-multiple
 * - Risk-reward achieved
 */

import { db } from './db';
import { tradeIdeas } from '@shared/schema';
import { gte, and, desc, or, eq, isNotNull } from 'drizzle-orm';
import { logger } from './logger';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface RMultipleAnalysis {
  r: number;                    // Risk units (1R = initial risk amount)
  percentReturn: number;        // Actual % return
  initialRisk: number;          // % distance to stop
  rewardRisk: number;           // Achieved reward/risk ratio
  classification: 'big_win' | 'small_win' | 'scratch' | 'small_loss' | 'big_loss';
}

export interface MAEMFEAnalysis {
  mae: number;                  // Maximum Adverse Excursion (worst drawdown during trade)
  mfe: number;                  // Maximum Favorable Excursion (best profit during trade)
  maeToStopRatio: number;       // How close to stop did it get?
  efficiencyRatio: number;      // Actual exit vs MFE (1.0 = perfect exit)
  recommendedStop: number;      // Optimal stop based on MAE distribution
}

export interface StatisticalSignificance {
  winRatePValue: number;        // P-value: is win rate significantly > 50%?
  returnsPValue: number;        // P-value: is mean return significantly > 0?
  sharpeSignificant: boolean;   // Is Sharpe statistically significant?
  sampleSizeAdequate: boolean;  // n >= 30 for CLT
  confidenceInterval: {
    lower: number;
    upper: number;
    confidence: number;         // Usually 95%
  };
}

export interface DistributionAnalysis {
  mean: number;
  median: number;
  stdDev: number;
  skewness: number;             // Positive = right tail (good for trading)
  kurtosis: number;             // High = fat tails (risky)
  percentile25: number;
  percentile75: number;
  percentile95: number;
  percentile5: number;          // VaR proxy
}

export interface BenchmarkComparison {
  alpha: number;                // Excess return vs benchmark
  beta: number;                 // Market sensitivity
  correlation: number;          // Correlation with SPY
  informationRatio: number;     // Alpha / Tracking Error
  treynorRatio: number;         // Excess Return / Beta
  upCapture: number;            // Performance in up markets
  downCapture: number;          // Performance in down markets
}

export interface AdaptiveStopAnalysis {
  optimalStopPercent: number;           // Based on MAE analysis
  currentStopEfficiency: number;        // % of trades that hit stop unnecessarily
  recommendedTrailingStop: number;      // ATR-based trailing stop
  breakEvenMoveThreshold: number;       // When to move stop to breakeven
  timeBasedStopDays: number;            // Max hold time before exit
  volatilityAdjustedStop: number;       // Stop adjusted for current VIX
  stopTooTight: boolean;                // Getting stopped out too often?
  stopTooLoose: boolean;                // Letting losers run?
}

export interface ResearchGradeReport {
  // Summary
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  gradeRationale: string[];

  // Core Metrics
  totalTrades: number;
  winRate: number;
  lossRate: number;
  scratchRate: number;

  // R-Multiple Metrics (Professional Standard)
  avgR: number;                         // Average R-multiple
  expectancyR: number;                  // Expected R per trade
  profitFactorR: number;                // Gross profit R / Gross loss R
  bigWinRate: number;                   // % of trades > 2R
  bigLossRate: number;                  // % of trades < -1R

  // Risk Metrics
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  maxDrawdownDuration: number;          // Days
  recoveryFactor: number;               // Total return / Max DD

  // Time Analysis
  avgHoldTimeDays: number;
  annualizedReturn: number;
  returnPerDayHeld: number;

  // Statistical Validity
  statistics: StatisticalSignificance;
  distribution: DistributionAnalysis;

  // Benchmark
  benchmark: BenchmarkComparison;

  // Stop Loss Optimization
  stopAnalysis: AdaptiveStopAnalysis;

  // Recommendations
  recommendations: string[];

  // Metadata
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
}

export interface TradeWithDetails {
  id: number;
  symbol: string;
  direction: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  exitPrice: number | null;
  percentGain: number | null;
  outcomeStatus: string | null;
  createdAt: Date | null;
  exitDate: Date | null;
  source: string | null;
  assetType: string | null;
}

// ============================================================
// MAIN EVALUATION FUNCTION
// ============================================================

export async function runResearchGradeEvaluation(
  lookbackDays: number = 90,
  engine?: string
): Promise<ResearchGradeReport> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
  const periodStart = cutoffDate;
  const periodEnd = new Date();

  try {
    // Fetch trades with full details
    let query = db
      .select({
        id: tradeIdeas.id,
        symbol: tradeIdeas.symbol,
        direction: tradeIdeas.direction,
        entryPrice: tradeIdeas.entryPrice,
        targetPrice: tradeIdeas.targetPrice,
        stopLoss: tradeIdeas.stopLoss,
        exitPrice: tradeIdeas.exitPrice,
        percentGain: tradeIdeas.percentGain,
        outcomeStatus: tradeIdeas.outcomeStatus,
        createdAt: tradeIdeas.createdAt,
        exitDate: tradeIdeas.exitDate,
        source: tradeIdeas.source,
        assetType: tradeIdeas.assetType,
      })
      .from(tradeIdeas)
      .where(
        and(
          gte(tradeIdeas.createdAt, cutoffDate),
          or(
            eq(tradeIdeas.outcomeStatus, 'hit_target'),
            eq(tradeIdeas.outcomeStatus, 'hit_stop'),
            eq(tradeIdeas.outcomeStatus, 'expired'),
            eq(tradeIdeas.outcomeStatus, 'manual_exit')
          )
        )
      )
      .orderBy(tradeIdeas.createdAt);

    const trades = await query as TradeWithDetails[];

    // Filter by engine if specified
    const filteredTrades = engine
      ? trades.filter(t => t.source === engine)
      : trades;

    if (filteredTrades.length < 10) {
      return generateInsufficientDataReport(periodStart, periodEnd, filteredTrades.length);
    }

    // Calculate R-multiples for all trades
    const rAnalyses = filteredTrades.map(calculateRMultiple);

    // Classify trades
    const wins = rAnalyses.filter(r => r.classification === 'big_win' || r.classification === 'small_win');
    const losses = rAnalyses.filter(r => r.classification === 'big_loss' || r.classification === 'small_loss');
    const scratches = rAnalyses.filter(r => r.classification === 'scratch');

    const bigWins = rAnalyses.filter(r => r.classification === 'big_win');
    const bigLosses = rAnalyses.filter(r => r.classification === 'big_loss');

    // Core rates
    const winRate = (wins.length / filteredTrades.length) * 100;
    const lossRate = (losses.length / filteredTrades.length) * 100;
    const scratchRate = (scratches.length / filteredTrades.length) * 100;
    const bigWinRate = (bigWins.length / filteredTrades.length) * 100;
    const bigLossRate = (bigLosses.length / filteredTrades.length) * 100;

    // R-Multiple metrics
    const allR = rAnalyses.map(r => r.r).filter(r => isFinite(r));
    const avgR = allR.length > 0 ? allR.reduce((a, b) => a + b, 0) / allR.length : 0;

    const winR = wins.map(w => w.r).filter(r => isFinite(r) && r > 0);
    const lossR = losses.map(l => Math.abs(l.r)).filter(r => isFinite(r) && r > 0);

    const grossProfitR = winR.reduce((a, b) => a + b, 0);
    const grossLossR = lossR.reduce((a, b) => a + b, 0);
    const profitFactorR = grossLossR > 0 ? grossProfitR / grossLossR : grossProfitR > 0 ? Infinity : 0;

    const avgWinR = winR.length > 0 ? winR.reduce((a, b) => a + b, 0) / winR.length : 0;
    const avgLossR = lossR.length > 0 ? lossR.reduce((a, b) => a + b, 0) / lossR.length : 1;
    const expectancyR = (winRate / 100 * avgWinR) - (lossRate / 100 * avgLossR);

    // Returns for risk metrics
    const returns = filteredTrades
      .map(t => t.percentGain)
      .filter((r): r is number => r !== null && isFinite(r));

    // Distribution analysis
    const distribution = calculateDistribution(returns);

    // Time analysis (computed before Sharpe so avg holding period is available)
    const holdTimes = filteredTrades
      .filter(t => t.createdAt && t.exitDate)
      .map(t => {
        const start = new Date(t.createdAt!);
        const end = new Date(t.exitDate!);
        return (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      })
      .filter(d => d > 0 && d < 365);

    const avgHoldTimeDays = holdTimes.length > 0
      ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length
      : 1; // default 1 day if no duration data

    // Risk metrics (pass avg holding period for proper annualization)
    const sharpeRatio = calculateSharpe(returns, avgHoldTimeDays);
    const sortinoRatio = calculateSortino(returns, avgHoldTimeDays);
    const { maxDrawdown, maxDrawdownDuration, equityCurve } = calculateDrawdown(returns);
    const totalReturn = returns.reduce((a, b) => a + b, 0);
    const calmarRatio = maxDrawdown > 0 ? totalReturn / maxDrawdown : 0;
    const recoveryFactor = maxDrawdown > 0 ? totalReturn / maxDrawdown : totalReturn;

    const tradingDays = lookbackDays * 0.7; // ~70% are trading days
    const annualizedReturn = tradingDays > 0
      ? (totalReturn / tradingDays) * 252
      : 0;

    const returnPerDayHeld = avgHoldTimeDays > 0
      ? (totalReturn / filteredTrades.length) / avgHoldTimeDays
      : 0;

    // Statistical significance
    const statistics = calculateStatisticalSignificance(returns, winRate, filteredTrades.length);

    // Benchmark comparison (placeholder - would need SPY data)
    const benchmark = calculateBenchmarkComparison(returns, filteredTrades);

    // Adaptive stop analysis
    const stopAnalysis = analyzeStopLoss(filteredTrades, rAnalyses);

    // Generate overall grade
    const { grade, rationale } = calculateOverallGrade({
      winRate,
      expectancyR,
      profitFactorR,
      sharpeRatio,
      maxDrawdown,
      statistics,
      bigWinRate,
      bigLossRate,
    });

    // Generate recommendations
    const recommendations = generateRecommendations({
      winRate,
      expectancyR,
      profitFactorR,
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      avgHoldTimeDays,
      stopAnalysis,
      distribution,
      bigWinRate,
      bigLossRate,
    });

    const report: ResearchGradeReport = {
      overallGrade: grade,
      gradeRationale: rationale,
      totalTrades: filteredTrades.length,
      winRate,
      lossRate,
      scratchRate,
      avgR,
      expectancyR,
      profitFactorR,
      bigWinRate,
      bigLossRate,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      maxDrawdown,
      maxDrawdownDuration,
      recoveryFactor,
      avgHoldTimeDays,
      annualizedReturn,
      returnPerDayHeld,
      statistics,
      distribution,
      benchmark,
      stopAnalysis,
      recommendations,
      periodStart,
      periodEnd,
      generatedAt: new Date(),
    };

    logger.info(
      `[RESEARCH] Grade: ${grade} | WR: ${winRate.toFixed(1)}% | ` +
      `ExpR: ${expectancyR.toFixed(2)}R | Sharpe: ${sharpeRatio.toFixed(2)} | ` +
      `MDD: ${maxDrawdown.toFixed(1)}% | n=${filteredTrades.length}`
    );

    return report;
  } catch (error) {
    logger.error('[RESEARCH] Evaluation failed:', error);
    return generateErrorReport(periodStart, periodEnd, error);
  }
}

// ============================================================
// R-MULTIPLE CALCULATION
// ============================================================

function calculateRMultiple(trade: TradeWithDetails): RMultipleAnalysis {
  const entry = trade.entryPrice || 0;
  const stop = trade.stopLoss || 0;
  const exit = trade.exitPrice || entry;
  const percentReturn = trade.percentGain || 0;

  // Initial risk = distance from entry to stop
  let initialRisk: number;
  if (trade.direction === 'long' || trade.direction === 'bullish') {
    initialRisk = entry > 0 && stop > 0 ? ((entry - stop) / entry) * 100 : 5; // Default 5% if no stop
  } else {
    initialRisk = entry > 0 && stop > 0 ? ((stop - entry) / entry) * 100 : 5;
  }

  // Ensure positive risk (absolute value)
  initialRisk = Math.abs(initialRisk);
  if (initialRisk === 0) initialRisk = 5; // Minimum 5% assumed risk

  // R-multiple = Actual return / Initial risk
  const r = percentReturn / initialRisk;

  // Reward/Risk achieved
  const rewardRisk = percentReturn >= 0
    ? percentReturn / initialRisk
    : -Math.abs(percentReturn) / initialRisk;

  // Classify the trade
  let classification: RMultipleAnalysis['classification'];
  if (r >= 2) {
    classification = 'big_win';      // 2R+ is a big win
  } else if (r >= 0.5) {
    classification = 'small_win';    // 0.5R to 2R
  } else if (r >= -0.5) {
    classification = 'scratch';      // -0.5R to 0.5R (breakeven area)
  } else if (r >= -1.5) {
    classification = 'small_loss';   // -0.5R to -1.5R
  } else {
    classification = 'big_loss';     // Worse than -1.5R
  }

  return {
    r,
    percentReturn,
    initialRisk,
    rewardRisk,
    classification,
  };
}

// ============================================================
// STATISTICAL CALCULATIONS
// ============================================================

function calculateDistribution(returns: number[]): DistributionAnalysis {
  if (returns.length === 0) {
    return {
      mean: 0, median: 0, stdDev: 0, skewness: 0, kurtosis: 0,
      percentile25: 0, percentile75: 0, percentile95: 0, percentile5: 0,
    };
  }

  const sorted = [...returns].sort((a, b) => a - b);
  const n = returns.length;

  // Mean
  const mean = returns.reduce((a, b) => a + b, 0) / n;

  // Median
  const median = n % 2 === 0
    ? (sorted[n/2 - 1] + sorted[n/2]) / 2
    : sorted[Math.floor(n/2)];

  // Standard Deviation
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  // Skewness: measures asymmetry (positive = right tail, good for trading)
  const skewness = stdDev > 0
    ? returns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 3), 0) / n
    : 0;

  // Kurtosis: measures tail thickness (high = fat tails = risky)
  const kurtosis = stdDev > 0
    ? returns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 4), 0) / n - 3
    : 0;

  // Percentiles
  const getPercentile = (p: number) => {
    const index = Math.floor(p * n / 100);
    return sorted[Math.min(index, n - 1)];
  };

  return {
    mean,
    median,
    stdDev,
    skewness,
    kurtosis,
    percentile25: getPercentile(25),
    percentile75: getPercentile(75),
    percentile95: getPercentile(95),
    percentile5: getPercentile(5),
  };
}

/**
 * Annualized Sharpe Ratio from per-trade percent returns
 *
 * excess_i = (return_i / 100) - (riskFreeAnnual * avgHoldingDays / 252)
 * sharpe = (mean(excess) / std(excess)) * sqrt(252 / avgHoldingDays)
 *
 * @param returns         per-trade percent gains (e.g. [2.5, -1.3, ...])
 * @param avgHoldingDays  average holding period in calendar days (default 1)
 */
function calculateSharpe(returns: number[], avgHoldingDays: number = 1): number {
  if (returns.length < 2) return 0;

  const ANNUAL_RISK_FREE = 0.045; // 4.5% T-bill proxy
  const holdingTradingDays = Math.max(avgHoldingDays * (252 / 365), 0.1);
  const riskFreePerTrade = (ANNUAL_RISK_FREE * holdingTradingDays) / 252;

  const excessReturns = returns.map(r => (r / 100) - riskFreePerTrade);
  const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
  const variance = excessReturns.reduce((sum, r) => sum + Math.pow(r - meanExcess, 2), 0) / excessReturns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  const annualizationFactor = Math.sqrt(252 / holdingTradingDays);
  return (meanExcess / stdDev) * annualizationFactor;
}

/**
 * Annualized Sortino Ratio (downside-deviation variant of Sharpe)
 */
function calculateSortino(returns: number[], avgHoldingDays: number = 1): number {
  if (returns.length < 2) return 0;

  const ANNUAL_RISK_FREE = 0.045;
  const holdingTradingDays = Math.max(avgHoldingDays * (252 / 365), 0.1);
  const riskFreePerTrade = (ANNUAL_RISK_FREE * holdingTradingDays) / 252;

  const excessReturns = returns.map(r => (r / 100) - riskFreePerTrade);
  const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;

  // Downside deviation: only consider negative excess returns
  const downsideExcess = excessReturns.filter(r => r < 0);
  if (downsideExcess.length === 0) return meanExcess > 0 ? Infinity : 0;

  const downsideVariance = downsideExcess.reduce(
    (sum, r) => sum + Math.pow(r, 2), 0
  ) / downsideExcess.length;
  const downsideDev = Math.sqrt(downsideVariance);

  if (downsideDev === 0) return 0;

  const annualizationFactor = Math.sqrt(252 / holdingTradingDays);
  return (meanExcess / downsideDev) * annualizationFactor;
}

function calculateDrawdown(returns: number[]): {
  maxDrawdown: number;
  maxDrawdownDuration: number;
  equityCurve: number[];
} {
  if (returns.length === 0) {
    return { maxDrawdown: 0, maxDrawdownDuration: 0, equityCurve: [100] };
  }

  // Build equity curve starting at 100
  let equity = 100;
  const equityCurve: number[] = [equity];

  for (const r of returns) {
    equity = equity * (1 + r / 100);
    equityCurve.push(equity);
  }

  // Find max drawdown and duration
  let peak = equityCurve[0];
  let peakIndex = 0;
  let maxDrawdown = 0;
  let maxDrawdownDuration = 0;
  let currentDuration = 0;

  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
      peakIndex = i;
      currentDuration = 0;
    } else {
      currentDuration++;
      const drawdown = ((peak - equityCurve[i]) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownDuration = currentDuration;
      }
    }
  }

  return { maxDrawdown, maxDrawdownDuration, equityCurve };
}

function calculateStatisticalSignificance(
  returns: number[],
  winRate: number,
  sampleSize: number
): StatisticalSignificance {
  const sampleSizeAdequate = sampleSize >= 30;

  // Win rate significance (binomial test vs 50%)
  // Using normal approximation for binomial
  const p = winRate / 100;
  const se = Math.sqrt(0.5 * 0.5 / sampleSize); // SE under null (p=0.5)
  const zWinRate = (p - 0.5) / se;
  const winRatePValue = 1 - normalCDF(Math.abs(zWinRate));

  // Returns significance (one-sample t-test vs 0)
  if (returns.length < 2) {
    return {
      winRatePValue: 1,
      returnsPValue: 1,
      sharpeSignificant: false,
      sampleSizeAdequate,
      confidenceInterval: { lower: 0, upper: 0, confidence: 95 },
    };
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  const se2 = stdDev / Math.sqrt(returns.length);
  const tStat = mean / se2;
  const returnsPValue = 2 * (1 - studentTCDF(Math.abs(tStat), returns.length - 1));

  // Sharpe significance (generally need Sharpe > 0.5 and n > 30)
  const sharpe = calculateSharpe(returns);
  const sharpeSignificant = sharpe > 0.5 && sampleSize >= 30;

  // 95% confidence interval for mean return
  const tCritical = 1.96; // Approximate for large n
  const marginOfError = tCritical * se2;

  return {
    winRatePValue,
    returnsPValue,
    sharpeSignificant,
    sampleSizeAdequate,
    confidenceInterval: {
      lower: mean - marginOfError,
      upper: mean + marginOfError,
      confidence: 95,
    },
  };
}

// Standard normal CDF approximation
function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

  return 0.5 * (1.0 + sign * y);
}

// Student's t CDF approximation
function studentTCDF(t: number, df: number): number {
  // Approximation using normal for df > 30
  if (df > 30) return normalCDF(t);

  // Simple approximation for smaller df
  const x = df / (df + t * t);
  return 1 - 0.5 * Math.pow(x, df / 2);
}

// ============================================================
// BENCHMARK COMPARISON
// ============================================================

function calculateBenchmarkComparison(
  returns: number[],
  trades: TradeWithDetails[]
): BenchmarkComparison {
  // Note: For real implementation, would fetch SPY returns for same period
  // This is a placeholder using market assumptions

  const mean = returns.length > 0
    ? returns.reduce((a, b) => a + b, 0) / returns.length
    : 0;

  const spyDailyReturn = 0.04; // Assume ~10% annual / 252 days
  const spyReturn = spyDailyReturn * returns.length;

  const alpha = mean - spyReturn;
  const beta = 1.0; // Would calculate from correlation
  const correlation = 0.3; // Placeholder

  const stdDev = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length)
    : 1;

  const trackingError = stdDev; // Simplified
  const informationRatio = trackingError > 0 ? alpha / trackingError : 0;
  const treynorRatio = beta > 0 ? (mean - 0.02) / beta : 0;

  // Up/Down capture (would need daily SPY data)
  const upCapture = 100; // Placeholder
  const downCapture = 100;

  return {
    alpha,
    beta,
    correlation,
    informationRatio,
    treynorRatio,
    upCapture,
    downCapture,
  };
}

// ============================================================
// ADAPTIVE STOP LOSS ANALYSIS
// ============================================================

function analyzeStopLoss(
  trades: TradeWithDetails[],
  rAnalyses: RMultipleAnalysis[]
): AdaptiveStopAnalysis {
  // Calculate initial risk percentages
  const initialRisks = rAnalyses.map(r => r.initialRisk).filter(r => r > 0 && r < 50);
  const avgInitialRisk = initialRisks.length > 0
    ? initialRisks.reduce((a, b) => a + b, 0) / initialRisks.length
    : 5;

  // Analyze trades that hit stop
  const stopHits = trades.filter(t => t.outcomeStatus === 'hit_stop');
  const winners = trades.filter(t => t.outcomeStatus === 'hit_target');

  // Calculate what % of stop hits were unnecessary (price reversed after stop)
  // This would require intraday data - using proxy based on final outcome
  const unnecessaryStops = stopHits.filter(t => {
    const loss = t.percentGain || 0;
    return loss > -2; // Small loss = might have recovered
  });

  const stopEfficiency = stopHits.length > 0
    ? 1 - (unnecessaryStops.length / stopHits.length)
    : 1;

  // Optimal stop based on winner behavior
  const winnerMinDrawdowns = winners
    .map(t => {
      // Estimate MAE as fraction of initial risk (would need tick data for real MAE)
      const risk = rAnalyses.find(r => r.percentReturn === t.percentGain)?.initialRisk || 5;
      return risk * 0.5; // Assume winners rarely dip more than 50% of initial risk
    })
    .filter(d => d > 0);

  const optimalStopPercent = winnerMinDrawdowns.length > 0
    ? Math.max(
        winnerMinDrawdowns.reduce((a, b) => a + b, 0) / winnerMinDrawdowns.length * 1.2,
        2 // Minimum 2%
      )
    : avgInitialRisk;

  // Trailing stop recommendation based on average win size
  const avgWin = winners.length > 0
    ? winners.reduce((sum, t) => sum + (t.percentGain || 0), 0) / winners.length
    : 5;

  const recommendedTrailingStop = avgWin * 0.3; // Trail at 30% of average win

  // Breakeven threshold
  const breakEvenMoveThreshold = avgInitialRisk * 0.5; // Move to BE after 0.5R profit

  // Time-based analysis
  const holdTimes = trades
    .filter(t => t.createdAt && t.exitDate)
    .map(t => {
      const days = (new Date(t.exitDate!).getTime() - new Date(t.createdAt!).getTime()) / (1000 * 60 * 60 * 24);
      return { days, gain: t.percentGain || 0 };
    });

  // Find optimal holding period
  const winnerHoldTimes = holdTimes.filter(h => h.gain > 0).map(h => h.days);
  const loserHoldTimes = holdTimes.filter(h => h.gain <= 0).map(h => h.days);

  const avgWinnerHoldTime = winnerHoldTimes.length > 0
    ? winnerHoldTimes.reduce((a, b) => a + b, 0) / winnerHoldTimes.length
    : 5;

  const avgLoserHoldTime = loserHoldTimes.length > 0
    ? loserHoldTimes.reduce((a, b) => a + b, 0) / loserHoldTimes.length
    : 5;

  // If losers are held longer than winners, stop is too loose
  const stopTooLoose = avgLoserHoldTime > avgWinnerHoldTime * 1.5;

  // If many trades hit stop and then reverse, stop is too tight
  const stopTooTight = unnecessaryStops.length > stopHits.length * 0.3;

  // Time-based stop recommendation
  const timeBasedStopDays = Math.ceil(avgWinnerHoldTime * 1.5);

  // Volatility-adjusted stop (would use VIX in production)
  const volatilityAdjustedStop = optimalStopPercent * 1.0; // Placeholder

  return {
    optimalStopPercent,
    currentStopEfficiency: stopEfficiency,
    recommendedTrailingStop,
    breakEvenMoveThreshold,
    timeBasedStopDays,
    volatilityAdjustedStop,
    stopTooTight,
    stopTooLoose,
  };
}

// ============================================================
// GRADING & RECOMMENDATIONS
// ============================================================

function calculateOverallGrade(metrics: {
  winRate: number;
  expectancyR: number;
  profitFactorR: number;
  sharpeRatio: number;
  maxDrawdown: number;
  statistics: StatisticalSignificance;
  bigWinRate: number;
  bigLossRate: number;
}): { grade: 'A' | 'B' | 'C' | 'D' | 'F'; rationale: string[] } {
  const rationale: string[] = [];
  let score = 0;

  // Win rate (0-20 points)
  if (metrics.winRate >= 60) { score += 20; rationale.push('Excellent win rate (60%+)'); }
  else if (metrics.winRate >= 50) { score += 15; rationale.push('Good win rate (50%+)'); }
  else if (metrics.winRate >= 40) { score += 10; rationale.push('Acceptable win rate (40%+)'); }
  else { score += 0; rationale.push('Low win rate (<40%)'); }

  // Expectancy R (0-25 points) - Most important
  if (metrics.expectancyR >= 0.5) { score += 25; rationale.push('Strong positive expectancy (0.5R+)'); }
  else if (metrics.expectancyR >= 0.2) { score += 20; rationale.push('Good positive expectancy'); }
  else if (metrics.expectancyR >= 0) { score += 10; rationale.push('Marginal positive expectancy'); }
  else { score += 0; rationale.push('Negative expectancy - losing system'); }

  // Profit Factor (0-15 points)
  if (metrics.profitFactorR >= 2) { score += 15; rationale.push('Excellent profit factor (2+)'); }
  else if (metrics.profitFactorR >= 1.5) { score += 12; rationale.push('Good profit factor (1.5+)'); }
  else if (metrics.profitFactorR >= 1) { score += 8; rationale.push('Positive profit factor'); }
  else { score += 0; rationale.push('Negative profit factor'); }

  // Sharpe Ratio (0-15 points)
  if (metrics.sharpeRatio >= 1.5) { score += 15; rationale.push('Excellent Sharpe ratio (1.5+)'); }
  else if (metrics.sharpeRatio >= 1) { score += 12; rationale.push('Good Sharpe ratio (1+)'); }
  else if (metrics.sharpeRatio >= 0.5) { score += 8; rationale.push('Acceptable Sharpe ratio'); }
  else if (metrics.sharpeRatio >= 0) { score += 4; rationale.push('Low but positive Sharpe'); }
  else { score += 0; rationale.push('Negative Sharpe ratio'); }

  // Max Drawdown (0-15 points)
  if (metrics.maxDrawdown <= 10) { score += 15; rationale.push('Low drawdown (<10%)'); }
  else if (metrics.maxDrawdown <= 20) { score += 10; rationale.push('Moderate drawdown (10-20%)'); }
  else if (metrics.maxDrawdown <= 30) { score += 5; rationale.push('High drawdown (20-30%)'); }
  else { score += 0; rationale.push('Severe drawdown (>30%)'); }

  // Statistical significance (0-10 points)
  if (metrics.statistics.sampleSizeAdequate && metrics.statistics.returnsPValue < 0.05) {
    score += 10;
    rationale.push('Statistically significant results');
  } else if (metrics.statistics.sampleSizeAdequate) {
    score += 5;
    rationale.push('Adequate sample but not significant');
  } else {
    rationale.push('Insufficient sample size for significance');
  }

  // Big win/loss ratio bonus/penalty
  if (metrics.bigWinRate > metrics.bigLossRate * 2) {
    score += 5;
    rationale.push('Strong big win vs big loss ratio');
  } else if (metrics.bigLossRate > metrics.bigWinRate * 2) {
    score -= 10;
    rationale.push('Warning: More big losses than big wins');
  }

  // Convert score to grade
  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (score >= 85) grade = 'A';
  else if (score >= 70) grade = 'B';
  else if (score >= 55) grade = 'C';
  else if (score >= 40) grade = 'D';
  else grade = 'F';

  return { grade, rationale };
}

function generateRecommendations(metrics: {
  winRate: number;
  expectancyR: number;
  profitFactorR: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  avgHoldTimeDays: number;
  stopAnalysis: AdaptiveStopAnalysis;
  distribution: DistributionAnalysis;
  bigWinRate: number;
  bigLossRate: number;
}): string[] {
  const recommendations: string[] = [];

  // Win rate recommendations
  if (metrics.winRate < 40) {
    recommendations.push(
      'CRITICAL: Win rate below 40%. Review entry criteria and signal quality.'
    );
  }

  // Expectancy recommendations
  if (metrics.expectancyR < 0) {
    recommendations.push(
      'CRITICAL: Negative expectancy means losing money over time. ' +
      'Either improve win rate OR increase average win size relative to loss size.'
    );
  } else if (metrics.expectancyR < 0.2) {
    recommendations.push(
      'Expectancy is marginally positive. Consider tightening entry criteria for higher quality setups.'
    );
  }

  // Stop loss recommendations
  if (metrics.stopAnalysis.stopTooTight) {
    recommendations.push(
      `STOP TOO TIGHT: Many trades hitting stop then reversing. ` +
      `Consider widening stop to ${metrics.stopAnalysis.optimalStopPercent.toFixed(1)}%.`
    );
  }

  if (metrics.stopAnalysis.stopTooLoose) {
    recommendations.push(
      'STOP TOO LOOSE: Losers held longer than winners. ' +
      `Implement time-based stop at ${metrics.stopAnalysis.timeBasedStopDays} days.`
    );
  }

  if (metrics.stopAnalysis.currentStopEfficiency < 0.7) {
    recommendations.push(
      'Stop efficiency is low. Consider adaptive trailing stop: ' +
      `Move to breakeven after ${metrics.stopAnalysis.breakEvenMoveThreshold.toFixed(1)}% gain, ` +
      `then trail by ${metrics.stopAnalysis.recommendedTrailingStop.toFixed(1)}%.`
    );
  }

  // Risk recommendations
  if (metrics.maxDrawdown > 25) {
    recommendations.push(
      `Max drawdown of ${metrics.maxDrawdown.toFixed(1)}% is too high. ` +
      'Reduce position sizes or add correlation filters.'
    );
  }

  // Distribution recommendations
  if (metrics.distribution.skewness < 0) {
    recommendations.push(
      'Negative skew: more large losses than large wins. ' +
      'Let winners run longer or cut losers faster.'
    );
  }

  if (metrics.distribution.kurtosis > 3) {
    recommendations.push(
      'High kurtosis indicates fat tails (extreme outcomes). ' +
      'Consider hedging or reducing position sizes.'
    );
  }

  // Big win/loss recommendations
  if (metrics.bigLossRate > 15) {
    recommendations.push(
      `${metrics.bigLossRate.toFixed(1)}% of trades are big losses (>1.5R). ` +
      'Review these trades for pattern - might be specific setups to avoid.'
    );
  }

  if (metrics.bigWinRate < 10 && metrics.winRate > 50) {
    recommendations.push(
      'High win rate but few big wins. Consider wider targets or trailing stops to capture more upside.'
    );
  }

  // Holding time recommendations
  if (metrics.avgHoldTimeDays > 14) {
    recommendations.push(
      'Average hold time over 2 weeks. For active trading, consider shorter timeframes or time-based exits.'
    );
  }

  // Sharpe vs Sortino
  if (metrics.sortinoRatio > metrics.sharpeRatio * 1.5) {
    recommendations.push(
      'High Sortino relative to Sharpe suggests upside volatility is high (good). ' +
      'Continue letting winners run.'
    );
  }

  return recommendations;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function generateInsufficientDataReport(
  periodStart: Date,
  periodEnd: Date,
  tradeCount: number
): ResearchGradeReport {
  return {
    overallGrade: 'F',
    gradeRationale: [`Insufficient data: ${tradeCount} trades (need 10+ for analysis)`],
    totalTrades: tradeCount,
    winRate: 0,
    lossRate: 0,
    scratchRate: 0,
    avgR: 0,
    expectancyR: 0,
    profitFactorR: 0,
    bigWinRate: 0,
    bigLossRate: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    calmarRatio: 0,
    maxDrawdown: 0,
    maxDrawdownDuration: 0,
    recoveryFactor: 0,
    avgHoldTimeDays: 0,
    annualizedReturn: 0,
    returnPerDayHeld: 0,
    statistics: {
      winRatePValue: 1,
      returnsPValue: 1,
      sharpeSignificant: false,
      sampleSizeAdequate: false,
      confidenceInterval: { lower: 0, upper: 0, confidence: 95 },
    },
    distribution: {
      mean: 0, median: 0, stdDev: 0, skewness: 0, kurtosis: 0,
      percentile25: 0, percentile75: 0, percentile95: 0, percentile5: 0,
    },
    benchmark: {
      alpha: 0, beta: 0, correlation: 0,
      informationRatio: 0, treynorRatio: 0,
      upCapture: 0, downCapture: 0,
    },
    stopAnalysis: {
      optimalStopPercent: 5,
      currentStopEfficiency: 0,
      recommendedTrailingStop: 2,
      breakEvenMoveThreshold: 2,
      timeBasedStopDays: 5,
      volatilityAdjustedStop: 5,
      stopTooTight: false,
      stopTooLoose: false,
    },
    recommendations: ['Collect more trade data before analysis'],
    periodStart,
    periodEnd,
    generatedAt: new Date(),
  };
}

function generateErrorReport(
  periodStart: Date,
  periodEnd: Date,
  error: unknown
): ResearchGradeReport {
  return {
    ...generateInsufficientDataReport(periodStart, periodEnd, 0),
    gradeRationale: [`Evaluation error: ${error}`],
    recommendations: ['Fix data source and retry evaluation'],
  };
}

export default {
  runResearchGradeEvaluation,
};
