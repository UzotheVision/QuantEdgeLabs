/**
 * Portfolio-Level Performance Metrics
 *
 * Calculates risk-adjusted returns for the entire signal portfolio.
 * Individual signal Sharpe ratios don't tell the full story -
 * we need portfolio-level analysis to understand true edge.
 *
 * Key Metrics:
 * - Portfolio Sharpe Ratio
 * - Maximum Drawdown
 * - Calmar Ratio
 * - Sortino Ratio
 * - Win Rate & Expectancy
 */

import { db } from '../db';
import { tradeIdeas } from '@shared/schema';
import { gte, and, desc, or, eq } from 'drizzle-orm';
import { logger } from '../logger';

export interface PortfolioMetrics {
  // Return metrics
  totalReturn: number;           // Cumulative return %
  annualizedReturn: number;      // CAGR %
  averageReturn: number;         // Mean return per trade %
  medianReturn: number;          // Median return per trade %

  // Risk metrics
  standardDeviation: number;     // Volatility of returns %
  maxDrawdown: number;           // Worst peak-to-trough %
  averageLoss: number;           // Average losing trade %
  largestLoss: number;           // Worst single trade %

  // Risk-adjusted metrics
  sharpeRatio: number;           // (Return - RiskFree) / StdDev
  sortinoRatio: number;          // Like Sharpe but only downside vol
  calmarRatio: number;           // AnnualReturn / MaxDrawdown

  // Win/loss metrics
  winRate: number;               // % of winning trades
  lossRate: number;              // % of losing trades
  profitFactor: number;          // Gross profit / Gross loss
  expectancy: number;            // Expected return per trade

  // Statistical significance
  numberOfTrades: number;
  tradingDays: number;
  tradesPerDay: number;
  confidence95: {                // 95% confidence interval
    lower: number;
    upper: number;
  };

  // Metadata
  periodStart: Date;
  periodEnd: Date;
  calculatedAt: Date;
}

export interface DrawdownAnalysis {
  maxDrawdown: number;
  maxDrawdownDuration: number;   // Days
  currentDrawdown: number;
  recoveryTime: number | null;   // Days to recover (null if still in DD)
  drawdownPeriods: Array<{
    start: Date;
    end: Date | null;
    depth: number;
    duration: number;
  }>;
}

// Risk-free rate assumption (T-bill proxy)
const RISK_FREE_RATE = 0.045; // 4.5% annual

/**
 * Calculate comprehensive portfolio metrics
 */
export async function calculatePortfolioMetrics(
  lookbackDays: number = 90
): Promise<PortfolioMetrics> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
  const periodStart = cutoffDate;
  const periodEnd = new Date();

  try {
    // Fetch completed trades with outcomes (using outcomeStatus from tradeIdeas)
    const completedTrades = await db
      .select({
        id: tradeIdeas.id,
        symbol: tradeIdeas.symbol,
        confidence: tradeIdeas.confidenceScore,
        direction: tradeIdeas.direction,
        entryPrice: tradeIdeas.entryPrice,
        targetPrice: tradeIdeas.targetPrice,
        stopLoss: tradeIdeas.stopLoss,
        createdAt: tradeIdeas.timestamp,
        outcome: tradeIdeas.outcomeStatus,
        exitPrice: tradeIdeas.exitPrice,
      })
      .from(tradeIdeas)
      .where(
        and(
          gte(tradeIdeas.timestamp, cutoffDate.toISOString()),
          or(
            eq(tradeIdeas.outcomeStatus, 'hit_target'),
            eq(tradeIdeas.outcomeStatus, 'hit_stop')
          )
        )
      )
      .orderBy(tradeIdeas.timestamp);

    if (completedTrades.length < 10) {
      logger.warn(`[PORTFOLIO] Insufficient data: ${completedTrades.length} trades`);
      return generateEmptyMetrics(periodStart, periodEnd, 'Insufficient data (need 10+ trades)');
    }

    // Extract returns (calculate from entry/exit prices)
    const returns = completedTrades
      .map(t => {
        if (t.entryPrice && t.exitPrice) {
          return ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100;
        }
        // Fallback: use outcome status to estimate return
        return t.outcome === 'hit_target' ? 5 : -3; // Conservative estimates
      })
      .filter(r => !isNaN(r) && isFinite(r));

    if (returns.length === 0) {
      return generateEmptyMetrics(periodStart, periodEnd, 'No valid returns data');
    }

    // Basic return metrics
    const totalReturn = returns.reduce((a, b) => a + b, 0);
    const averageReturn = totalReturn / returns.length;
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const medianReturn = sortedReturns[Math.floor(sortedReturns.length / 2)];

    // Annualized return (assuming 252 trading days)
    const tradingDays = lookbackDays * (252 / 365); // Convert to trading days
    const tradesPerDay = returns.length / tradingDays;
    const dailyReturn = averageReturn * tradesPerDay;
    const annualizedReturn = dailyReturn * 252;

    // Volatility (standard deviation)
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - averageReturn, 2), 0) / returns.length;
    const standardDeviation = Math.sqrt(variance);

    // Win/loss metrics
    const wins = returns.filter(r => r > 0);
    const losses = returns.filter(r => r < 0);
    const winRate = (wins.length / returns.length) * 100;
    const lossRate = (losses.length / returns.length) * 100;

    const grossProfit = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

    const averageLoss = losses.length > 0
      ? losses.reduce((a, b) => a + b, 0) / losses.length
      : 0;
    const largestLoss = Math.min(...returns);

    // Expectancy: (WinRate * AvgWin) - (LossRate * AvgLoss)
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
    const expectancy = (winRate / 100 * avgWin) - (lossRate / 100 * avgLoss);

    // Risk-adjusted metrics
    // Sharpe Ratio: annualized, per-trade excess returns approach
    // excess_i = return_i - (riskFreeAnnual * avgHoldingDays_i / 252)
    // sharpe = (mean(excess) / std(excess)) * sqrt(252 / avgHoldingDays)
    // Since we don't have per-trade holding days here, we estimate from tradesPerDay:
    // avgHoldingDays ≈ 1 / tradesPerDay (how many trading days between trades)
    const avgHoldingDays = tradesPerDay > 0 ? 1 / tradesPerDay : 1;
    const riskFreePerTrade = RISK_FREE_RATE * (avgHoldingDays / 252);
    const excessReturns = returns.map(r => (r / 100) - riskFreePerTrade); // convert % to decimal
    const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
    const excessVariance = excessReturns.reduce((sum, r) => sum + Math.pow(r - meanExcess, 2), 0) / excessReturns.length;
    const excessStdDev = Math.sqrt(excessVariance);
    const annualizationFactor = Math.sqrt(252 / Math.max(avgHoldingDays, 0.1));
    const sharpeRatio = excessStdDev > 0
      ? (meanExcess / excessStdDev) * annualizationFactor
      : 0;

    // Sortino Ratio: same approach but using only downside deviation of excess returns
    const negativeExcess = excessReturns.filter(r => r < 0);
    const downsideExcessVariance = negativeExcess.length > 0
      ? negativeExcess.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeExcess.length
      : 0;
    const downsideExcessStdDev = Math.sqrt(downsideExcessVariance);
    const sortinoRatio = downsideExcessStdDev > 0
      ? (meanExcess / downsideExcessStdDev) * annualizationFactor
      : 0;

    // Maximum Drawdown
    const drawdown = calculateDrawdown(returns);
    const maxDrawdown = drawdown.maxDrawdown;

    // Calmar Ratio: AnnualReturn / MaxDrawdown
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

    // 95% Confidence Interval for mean return
    const standardError = standardDeviation / Math.sqrt(returns.length);
    const confidence95 = {
      lower: averageReturn - 1.96 * standardError,
      upper: averageReturn + 1.96 * standardError,
    };

    const metrics: PortfolioMetrics = {
      totalReturn,
      annualizedReturn,
      averageReturn,
      medianReturn,
      standardDeviation,
      maxDrawdown,
      averageLoss,
      largestLoss,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      winRate,
      lossRate,
      profitFactor,
      expectancy,
      numberOfTrades: returns.length,
      tradingDays: Math.round(tradingDays),
      tradesPerDay,
      confidence95,
      periodStart,
      periodEnd,
      calculatedAt: new Date(),
    };

    logger.info(
      `[PORTFOLIO] Metrics calculated: ${returns.length} trades, ` +
      `${winRate.toFixed(1)}% win rate, Sharpe: ${sharpeRatio.toFixed(2)}`
    );

    return metrics;
  } catch (error) {
    logger.error('[PORTFOLIO] Calculation failed:', error);
    return generateEmptyMetrics(periodStart, periodEnd, `Error: ${error}`);
  }
}

/**
 * Calculate drawdown from return series
 */
function calculateDrawdown(returns: number[]): DrawdownAnalysis {
  if (returns.length === 0) {
    return {
      maxDrawdown: 0,
      maxDrawdownDuration: 0,
      currentDrawdown: 0,
      recoveryTime: null,
      drawdownPeriods: [],
    };
  }

  // Calculate cumulative equity curve
  let equity = 100; // Start with $100
  const equityCurve: number[] = [equity];

  for (const r of returns) {
    equity = equity * (1 + r / 100);
    equityCurve.push(equity);
  }

  // Calculate drawdown series
  let peak = equityCurve[0];
  let maxDrawdown = 0;
  let currentDrawdown = 0;

  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
    }

    const drawdown = ((peak - equityCurve[i]) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }

    if (i === equityCurve.length - 1) {
      currentDrawdown = drawdown;
    }
  }

  return {
    maxDrawdown,
    maxDrawdownDuration: 0, // Would need dates to calculate
    currentDrawdown,
    recoveryTime: currentDrawdown > 0 ? null : 0,
    drawdownPeriods: [],
  };
}

/**
 * Generate empty metrics when insufficient data
 */
function generateEmptyMetrics(
  periodStart: Date,
  periodEnd: Date,
  reason: string
): PortfolioMetrics {
  logger.warn(`[PORTFOLIO] Empty metrics: ${reason}`);

  return {
    totalReturn: 0,
    annualizedReturn: 0,
    averageReturn: 0,
    medianReturn: 0,
    standardDeviation: 0,
    maxDrawdown: 0,
    averageLoss: 0,
    largestLoss: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    calmarRatio: 0,
    winRate: 50,
    lossRate: 50,
    profitFactor: 1,
    expectancy: 0,
    numberOfTrades: 0,
    tradingDays: 0,
    tradesPerDay: 0,
    confidence95: { lower: 0, upper: 0 },
    periodStart,
    periodEnd,
    calculatedAt: new Date(),
  };
}

/**
 * Interpret Sharpe ratio quality
 */
export function interpretSharpe(sharpe: number): {
  quality: 'excellent' | 'good' | 'acceptable' | 'poor' | 'negative';
  description: string;
} {
  if (sharpe >= 2.0) {
    return {
      quality: 'excellent',
      description: 'Exceptional risk-adjusted returns (hedge fund quality)',
    };
  } else if (sharpe >= 1.0) {
    return {
      quality: 'good',
      description: 'Good risk-adjusted returns (better than market)',
    };
  } else if (sharpe >= 0.5) {
    return {
      quality: 'acceptable',
      description: 'Acceptable but not great (market-like risk/reward)',
    };
  } else if (sharpe >= 0) {
    return {
      quality: 'poor',
      description: 'Returns do not justify the risk taken',
    };
  } else {
    return {
      quality: 'negative',
      description: 'Negative risk-adjusted returns (losing money)',
    };
  }
}

/**
 * Get portfolio health summary
 */
export function getPortfolioSummary(metrics: PortfolioMetrics): string {
  const sharpeInterpret = interpretSharpe(metrics.sharpeRatio);

  return `
📊 Portfolio Performance Summary (${metrics.numberOfTrades} trades over ${metrics.tradingDays} days)

RETURNS:
• Total Return: ${metrics.totalReturn >= 0 ? '+' : ''}${metrics.totalReturn.toFixed(2)}%
• Annualized: ${metrics.annualizedReturn >= 0 ? '+' : ''}${metrics.annualizedReturn.toFixed(2)}%
• Average per trade: ${metrics.averageReturn >= 0 ? '+' : ''}${metrics.averageReturn.toFixed(2)}%
• Expectancy: ${metrics.expectancy >= 0 ? '+' : ''}${metrics.expectancy.toFixed(2)}%

RISK:
• Max Drawdown: -${metrics.maxDrawdown.toFixed(2)}%
• Volatility: ${metrics.standardDeviation.toFixed(2)}%
• Largest Loss: ${metrics.largestLoss.toFixed(2)}%

RISK-ADJUSTED:
• Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)} (${sharpeInterpret.quality})
• Sortino Ratio: ${metrics.sortinoRatio.toFixed(2)}
• Calmar Ratio: ${metrics.calmarRatio.toFixed(2)}

WIN/LOSS:
• Win Rate: ${metrics.winRate.toFixed(1)}%
• Profit Factor: ${metrics.profitFactor.toFixed(2)}x

STATISTICAL CONFIDENCE:
• 95% CI for avg return: [${metrics.confidence95.lower.toFixed(2)}%, ${metrics.confidence95.upper.toFixed(2)}%]
${metrics.confidence95.lower > 0 ? '✅ Statistically significant positive returns' : '⚠️ Returns may not be statistically significant'}

${sharpeInterpret.description}
  `.trim();
}

/**
 * Compare portfolio to benchmarks
 */
export function compareToBenchmarks(metrics: PortfolioMetrics): {
  vs_spy: string;
  vs_random: string;
  recommendation: string;
} {
  // SPY historical: ~10% annual return, ~15% volatility, Sharpe ~0.5
  const spy_sharpe = 0.5;
  const spy_annual_return = 10;

  // Random trading: 50% win rate, ~0 expectancy, Sharpe ~0
  const random_sharpe = 0;

  let vs_spy: string;
  if (metrics.sharpeRatio > spy_sharpe + 0.3) {
    vs_spy = `Beating SPY: Your Sharpe (${metrics.sharpeRatio.toFixed(2)}) > SPY (${spy_sharpe})`;
  } else if (metrics.sharpeRatio > spy_sharpe - 0.2) {
    vs_spy = `Market-like performance: Sharpe similar to SPY`;
  } else {
    vs_spy = `Underperforming SPY: Consider index investing instead`;
  }

  let vs_random: string;
  if (metrics.sharpeRatio > 0.3 && metrics.winRate > 53) {
    vs_random = `Beating random: Your edge is statistically significant`;
  } else if (metrics.sharpeRatio > 0) {
    vs_random = `Slightly better than random, but edge is marginal`;
  } else {
    vs_random = `Not better than random trading - review strategy`;
  }

  let recommendation: string;
  if (metrics.sharpeRatio >= 1.0 && metrics.maxDrawdown < 20) {
    recommendation = 'Strategy looks solid. Consider increasing position sizes.';
  } else if (metrics.sharpeRatio >= 0.5) {
    recommendation = 'Decent strategy. Focus on reducing drawdowns.';
  } else if (metrics.sharpeRatio > 0) {
    recommendation = 'Marginal edge. Focus on signal quality over quantity.';
  } else {
    recommendation = 'Strategy needs work. Reduce position sizes and review signals.';
  }

  return { vs_spy, vs_random, recommendation };
}

export default {
  calculatePortfolioMetrics,
  interpretSharpe,
  getPortfolioSummary,
  compareToBenchmarks,
};
