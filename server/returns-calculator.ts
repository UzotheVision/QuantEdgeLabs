/**
 * Returns Calculator - Mathematically Sound Performance Metrics
 *
 * Uses LOG RETURNS for all calculations (symmetric, additive)
 * Prevents asymmetry errors that invalidate performance tests
 */

export interface TradeReturn {
  entryPrice: number;
  exitPrice: number;
  logReturn: number;        // ln(exit/entry) * 100
  simpleReturn: number;     // For display only
  isWin: boolean;
}

export interface ExpectedReturnMetrics {
  avgWin: number;           // Average winning log return
  avgLoss: number;          // Average losing log return (negative)
  winRate: number;          // 0-1 probability of winning
  lossRate: number;         // 0-1 probability of losing
  expectedReturn: number;   // E[R] = avgWin*P(win) - |avgLoss|*P(loss)
  sharpeRatio?: number;     // Risk-adjusted return
  maxDrawdown?: number;     // Largest peak-to-trough decline
}

/**
 * Calculate log return (mathematically correct)
 * Small log returns × 100 ≈ percent returns
 */
export function calculateLogReturn(entryPrice: number, exitPrice: number): number {
  if (entryPrice <= 0 || exitPrice <= 0) return 0;
  return Math.log(exitPrice / entryPrice) * 100;
}

/**
 * Convert log return back to price multiplier
 */
export function logReturnToMultiplier(logReturn: number): number {
  return Math.exp(logReturn / 100);
}

/**
 * Calculate simple return (for display only - NOT for stats)
 */
export function calculateSimpleReturn(entryPrice: number, exitPrice: number): number {
  if (entryPrice <= 0) return 0;
  return ((exitPrice - entryPrice) / entryPrice) * 100;
}

/**
 * Process trade history to compute expected return
 * Uses LOG RETURNS for all statistical analysis
 */
export function calculateExpectedReturn(trades: TradeReturn[]): ExpectedReturnMetrics {
  if (trades.length === 0) {
    return {
      avgWin: 0,
      avgLoss: 0,
      winRate: 0,
      lossRate: 0,
      expectedReturn: 0,
    };
  }

  const wins = trades.filter(t => t.isWin);
  const losses = trades.filter(t => !t.isWin);

  const avgWin = wins.length > 0
    ? wins.reduce((sum, t) => sum + t.logReturn, 0) / wins.length
    : 0;

  const avgLoss = losses.length > 0
    ? losses.reduce((sum, t) => sum + t.logReturn, 0) / losses.length
    : 0;

  const winRate = wins.length / trades.length;
  const lossRate = losses.length / trades.length;

  // Expected Return Formula: E[R] = avgWin × P(win) - |avgLoss| × P(loss)
  const expectedReturn = (avgWin * winRate) - (Math.abs(avgLoss) * lossRate);

  // Sharpe Ratio: annualized, with risk-free rate subtraction
  // Formula: (mean_excess_return / std_excess_return) * sqrt(252 / avg_holding_days)
  // Risk-free rate: 4.5% annual (T-bill proxy)
  // Limitation: no per-trade duration data available here, so we assume 1 trading day
  // per trade. Callers with duration data should use a duration-aware calculator.
  const ANNUAL_RISK_FREE = 0.045;
  const AVG_HOLDING_DAYS = 1; // conservative default — no duration data in TradeReturn
  const riskFreePerTrade = ANNUAL_RISK_FREE * (AVG_HOLDING_DAYS / 252);
  const returns = trades.map(t => t.logReturn);
  const excessReturns = returns.map(r => (r / 100) - riskFreePerTrade); // log returns are *100
  const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
  const excessVariance = excessReturns.reduce((sum, r) => sum + Math.pow(r - meanExcess, 2), 0) / excessReturns.length;
  const excessStdDev = Math.sqrt(excessVariance);
  const annualizationFactor = Math.sqrt(252 / AVG_HOLDING_DAYS);
  const sharpeRatio = excessStdDev > 0 ? (meanExcess / excessStdDev) * annualizationFactor : 0;

  // Max Drawdown: largest peak-to-trough decline
  let maxDrawdown = 0;
  let peak = 0;
  let cumReturn = 0;

  for (const trade of trades) {
    cumReturn += trade.logReturn;
    if (cumReturn > peak) {
      peak = cumReturn;
    }
    const drawdown = peak - cumReturn;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return {
    avgWin,
    avgLoss,
    winRate,
    lossRate,
    expectedReturn,
    sharpeRatio,
    maxDrawdown,
  };
}

/**
 * Equity curve generation (cumulative log returns)
 */
export function generateEquityCurve(trades: TradeReturn[]): {
  equity: number[];
  dates?: Date[];
  peak: number;
  trough: number;
} {
  const equity: number[] = [100]; // Start at $100
  let cumLogReturn = 0;

  for (const trade of trades) {
    cumLogReturn += trade.logReturn;
    const equityValue = 100 * logReturnToMultiplier(cumLogReturn);
    equity.push(equityValue);
  }

  const peak = Math.max(...equity);
  const trough = Math.min(...equity);

  return { equity, peak, trough };
}

/**
 * Check if expected return meets minimum threshold
 */
export function meetsExpectedReturnThreshold(
  metrics: ExpectedReturnMetrics,
  minExpectedReturn: number = 0.5 // Minimum 0.5% expected return
): { passes: boolean; reason: string } {
  if (metrics.expectedReturn >= minExpectedReturn) {
    return {
      passes: true,
      reason: `Expected return ${metrics.expectedReturn.toFixed(2)}% exceeds threshold`,
    };
  }

  return {
    passes: false,
    reason: `Expected return ${metrics.expectedReturn.toFixed(2)}% below ${minExpectedReturn}% threshold`,
  };
}

/**
 * Calculate position size based on Kelly Criterion
 * f* = (p×b - q) / b
 * where p = win rate, q = loss rate, b = avg win / |avg loss|
 */
export function kellyPositionSize(metrics: ExpectedReturnMetrics): {
  kellySizePercent: number;
  halfKellySizePercent: number;
  recommendation: string;
} {
  if (metrics.avgLoss === 0) {
    return {
      kellySizePercent: 0,
      halfKellySizePercent: 0,
      recommendation: 'Insufficient data',
    };
  }

  const b = metrics.avgWin / Math.abs(metrics.avgLoss);
  const p = metrics.winRate;
  const q = metrics.lossRate;

  const kellySize = (p * b - q) / b;
  const kellySizePercent = Math.max(0, Math.min(100, kellySize * 100));

  // Use half-Kelly for safety
  const halfKelly = kellySizePercent / 2;

  let recommendation = '';
  if (kellySizePercent <= 0) {
    recommendation = 'Do not trade - negative expected value';
  } else if (kellySizePercent < 5) {
    recommendation = 'Very small position recommended';
  } else if (kellySizePercent < 15) {
    recommendation = 'Small to moderate position';
  } else if (kellySizePercent < 25) {
    recommendation = 'Moderate position';
  } else {
    recommendation = 'Large position - use caution';
  }

  return {
    kellySizePercent,
    halfKellySizePercent: halfKelly,
    recommendation,
  };
}

/**
 * ANTI-FUTURE-LEAK CHECK
 * Verify that indicators only use data from BEFORE the trade entry
 */
export function validateNoFutureLeak(
  indicatorTimestamp: Date,
  tradeEntryTimestamp: Date
): { valid: boolean; error?: string } {
  if (indicatorTimestamp > tradeEntryTimestamp) {
    return {
      valid: false,
      error: `FUTURE LEAK DETECTED: Indicator from ${indicatorTimestamp.toISOString()} used for trade at ${tradeEntryTimestamp.toISOString()}`,
    };
  }
  return { valid: true };
}
