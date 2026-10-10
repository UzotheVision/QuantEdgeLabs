/**
 * Institutional-Grade Risk Engine
 * PhD-level quantitative risk management for hedge fund professionals
 * 
 * Features:
 * - VaR (Value at Risk) / CVaR (Conditional VaR) calculations
 * - Kelly Criterion position sizing with fractional options
 * - Sharpe/Sortino/Calmar ratio tracking
 * - Maximum drawdown monitoring with circuit breakers
 * - Factor exposure analysis
 * - Execution quality metrics
 * - Real VIX integration with caching
 */

import { logger } from './logger';

// ============================================================================
// VIX CACHING SYSTEM (Updated separately by background job)
// ============================================================================
let _cachedVIX = 20;
let _vixLastUpdated = 0;
const VIX_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached VIX value (synchronous, non-blocking)
 */
export function getCachedVIX(): number {
  return _cachedVIX;
}

/**
 * Update VIX cache - called by background job
 */
export async function updateVIXCache(): Promise<number> {
  try {
    const { getTradierQuote } = await import('./tradier-api');
    const vixQuote = await getTradierQuote('VIX');
    if (vixQuote?.last) {
      _cachedVIX = vixQuote.last;
      _vixLastUpdated = Date.now();
      logger.debug(`[RISK-ENGINE] VIX cache updated: ${_cachedVIX.toFixed(2)}`);
    }
  } catch (e) {
    logger.debug('[RISK-ENGINE] Failed to update VIX cache, using last known value');
  }
  return _cachedVIX;
}

/**
 * Check if VIX cache is stale
 */
export function isVIXCacheStale(): boolean {
  return Date.now() - _vixLastUpdated > VIX_CACHE_TTL;
}

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface RiskMetrics {
  // Portfolio-level metrics
  portfolioValue: number;
  cashBalance: number;
  totalExposure: number;
  
  // VaR metrics (95% and 99% confidence)
  var95Daily: number;       // 1-day VaR at 95% confidence
  var99Daily: number;       // 1-day VaR at 99% confidence
  cvar95Daily: number;      // Conditional VaR (Expected Shortfall) at 95%
  cvar99Daily: number;      // Conditional VaR at 99%
  
  // Drawdown metrics
  currentDrawdown: number;
  maxDrawdown: number;
  drawdownDuration: number; // Days in current drawdown
  
  // Performance ratios
  sharpeRatio: number;      // Risk-adjusted return (annualized)
  sortinoRatio: number;     // Downside deviation adjusted return
  calmarRatio: number;      // Return / Max Drawdown
  
  // Position sizing
  kellyFraction: number;    // Full Kelly optimal fraction
  halfKelly: number;        // Conservative half-Kelly
  quarterKelly: number;     // Ultra-conservative quarter-Kelly
  
  // Circuit breaker status
  circuitBreakerTriggered: boolean;
  circuitBreakerReason: string | null;
  
  // Timestamp
  calculatedAt: string;
}

export interface PositionRisk {
  symbol: string;
  assetType: 'option' | 'future' | 'crypto' | 'stock';
  quantity: number;
  currentValue: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  
  // Position-level risk
  positionVaR: number;
  positionBeta: number;
  deltaExposure: number;    // For options
  gammaExposure: number;    // For options
  vegaExposure: number;     // For options
  thetaDecay: number;       // Daily theta decay for options
  
  // Concentration risk
  portfolioWeight: number;  // % of portfolio
  concentrationRisk: 'low' | 'medium' | 'high' | 'critical';
}

export interface ExecutionMetrics {
  averageSlippage: number;      // In basis points
  fillRate: number;             // % of orders filled
  averageFillTime: number;      // Milliseconds
  rejectionRate: number;        // % of orders rejected
  improvedFillRate: number;     // % filled better than expected
}

export interface FactorExposure {
  marketBeta: number;           // Overall market exposure
  momentumFactor: number;       // Momentum strategy loading
  valueFactor: number;          // Value strategy loading
  sizeFactor: number;           // Small-cap vs large-cap tilt
  volatilityFactor: number;     // Volatility exposure
  qualityFactor: number;        // Quality factor loading
}

export interface ScenarioResult {
  scenarioName: string;
  portfolioChange: number;
  portfolioChangePercent: number;
  varImpact: number;
  positionImpacts: Array<{
    symbol: string;
    pnlChange: number;
    pnlChangePercent: number;
  }>;
}

export interface KellySizingResult {
  winProbability: number;
  winLossRatio: number;
  fullKelly: number;
  halfKelly: number;
  quarterKelly: number;
  recommendedSize: number;
  maxPositionSize: number;
  rationale: string;
}

// ============================================================================
// STATISTICAL FUNCTIONS
// ============================================================================

/**
 * Calculate mean of an array
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(mean(squaredDiffs));
}

/**
 * Calculate downside deviation (for Sortino ratio)
 * Only considers returns below target (typically 0 or risk-free rate)
 */
function downsideDeviation(returns: number[], target: number = 0): number {
  const downsideReturns = returns.filter(r => r < target).map(r => Math.pow(r - target, 2));
  if (downsideReturns.length === 0) return 0;
  return Math.sqrt(mean(downsideReturns));
}

/**
 * Calculate percentile of sorted array
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] * (upper - index) + sortedValues[upper] * (index - lower);
}

/**
 * Generate normally distributed random number (Box-Muller transform)
 */
function randomNormal(mean: number = 0, stdDev: number = 1): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0 * stdDev + mean;
}

// ============================================================================
// VaR CALCULATIONS
// ============================================================================

/**
 * Historical VaR calculation
 * Uses actual historical returns to estimate potential losses
 */
export function calculateHistoricalVaR(
  returns: number[],
  portfolioValue: number,
  confidenceLevel: number = 0.95
): number {
  if (returns.length < 10) {
    logger.warn('[RISK] Insufficient historical data for VaR calculation');
    return portfolioValue * 0.02; // Default 2% VaR
  }
  
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const varPercentile = 1 - confidenceLevel;
  const varReturn = percentile(sortedReturns, varPercentile * 100);
  
  return Math.abs(varReturn * portfolioValue);
}

/**
 * Parametric VaR (variance-covariance method)
 * Assumes normal distribution of returns
 */
export function calculateParametricVaR(
  returns: number[],
  portfolioValue: number,
  confidenceLevel: number = 0.95,
  holdingPeriod: number = 1 // days
): number {
  if (returns.length < 10) {
    return portfolioValue * 0.02;
  }
  
  const mu = mean(returns);
  const sigma = standardDeviation(returns);
  
  // Z-score for confidence level
  const zScores: Record<number, number> = {
    0.90: 1.282,
    0.95: 1.645,
    0.99: 2.326,
    0.999: 3.090
  };
  const z = zScores[confidenceLevel] || 1.645;
  
  // Scale for holding period
  const scaledVaR = (mu - z * sigma) * Math.sqrt(holdingPeriod) * portfolioValue;
  
  return Math.abs(scaledVaR);
}

/**
 * Monte Carlo VaR
 * Simulates thousands of scenarios for robust VaR estimation
 */
export function calculateMonteCarloVaR(
  returns: number[],
  portfolioValue: number,
  confidenceLevel: number = 0.95,
  simulations: number = 10000,
  holdingPeriod: number = 1
): number {
  if (returns.length < 10) {
    return portfolioValue * 0.02;
  }
  
  const mu = mean(returns);
  const sigma = standardDeviation(returns);
  
  const simulatedReturns: number[] = [];
  
  for (let i = 0; i < simulations; i++) {
    let cumulativeReturn = 0;
    for (let day = 0; day < holdingPeriod; day++) {
      cumulativeReturn += randomNormal(mu, sigma);
    }
    simulatedReturns.push(cumulativeReturn);
  }
  
  simulatedReturns.sort((a, b) => a - b);
  const varPercentile = 1 - confidenceLevel;
  const varIndex = Math.floor(varPercentile * simulations);
  
  return Math.abs(simulatedReturns[varIndex] * portfolioValue);
}

/**
 * Conditional VaR (Expected Shortfall)
 * Average loss in the worst (1-confidence)% of cases
 */
export function calculateCVaR(
  returns: number[],
  portfolioValue: number,
  confidenceLevel: number = 0.95
): number {
  if (returns.length < 10) {
    return portfolioValue * 0.03; // Default 3% CVaR
  }
  
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const cutoffIndex = Math.floor((1 - confidenceLevel) * sortedReturns.length);
  const tailReturns = sortedReturns.slice(0, Math.max(1, cutoffIndex));
  
  const averageTailLoss = mean(tailReturns);
  return Math.abs(averageTailLoss * portfolioValue);
}

// ============================================================================
// KELLY CRITERION POSITION SIZING
// ============================================================================

/**
 * Calculate Kelly Criterion optimal bet size
 * f* = (bp - q) / b
 * where:
 *   b = odds received on the bet (win/loss ratio)
 *   p = probability of winning
 *   q = probability of losing (1 - p)
 */
export function calculateKellyCriterion(
  winRate: number,        // Historical win rate (0-1)
  avgWin: number,         // Average winning trade amount
  avgLoss: number,        // Average losing trade amount (positive number)
  portfolioValue: number, // Current portfolio value
  maxAllocation: number = 0.25 // Max 25% of portfolio per trade
): KellySizingResult {
  // Validate inputs
  const validWinRate = Math.max(0.01, Math.min(0.99, winRate));
  const validAvgWin = Math.max(0.01, avgWin);
  const validAvgLoss = Math.max(0.01, avgLoss);
  
  const winLossRatio = validAvgWin / validAvgLoss;
  const lossRate = 1 - validWinRate;
  
  // Kelly formula: f* = (bp - q) / b = p - q/b
  const fullKelly = validWinRate - (lossRate / winLossRatio);
  
  // Clamp to reasonable bounds
  const clampedKelly = Math.max(0, Math.min(maxAllocation, fullKelly));
  const halfKelly = clampedKelly / 2;
  const quarterKelly = clampedKelly / 4;
  
  // Handle negative edge case - return zeros for all Kelly values
  if (fullKelly < 0) {
    return {
      winProbability: validWinRate,
      winLossRatio,
      fullKelly: 0,
      halfKelly: 0,
      quarterKelly: 0,
      recommendedSize: 0,
      maxPositionSize: 0,
      rationale: `Negative edge detected (raw Kelly: ${(fullKelly * 100).toFixed(2)}%). No position recommended - expected value is negative.`
    };
  }
  
  // Recommended size based on edge strength
  let recommendedSize: number;
  let rationale: string;
  
  if (validWinRate < 0.45) {
    recommendedSize = quarterKelly;
    rationale = 'Low win rate - using quarter-Kelly for capital preservation.';
  } else if (validWinRate < 0.55) {
    recommendedSize = halfKelly;
    rationale = 'Moderate edge - using half-Kelly for balanced risk/reward.';
  } else {
    recommendedSize = halfKelly; // Never use full Kelly in practice
    rationale = 'Strong edge - using half-Kelly (full Kelly is too aggressive for real trading).';
  }
  
  const maxPositionSize = recommendedSize * portfolioValue;
  
  return {
    winProbability: validWinRate,
    winLossRatio,
    fullKelly: clampedKelly,
    halfKelly,
    quarterKelly,
    recommendedSize,
    maxPositionSize,
    rationale
  };
}

// ============================================================================
// PERFORMANCE RATIOS
// ============================================================================

/**
 * Calculate annualized Sharpe Ratio
 *
 * Methodology:
 *   excess_i = return_i - (riskFreeAnnual / 252)  [per-period risk-free cost]
 *   sharpe = (mean(excess) / std(excess)) * sqrt(252)
 *
 * @param returns       - array of per-period decimal returns (e.g. daily P&L fractions)
 * @param riskFreeRate  - per-period risk-free rate (default: 4.5% annual / 252)
 *
 * Note: this function assumes all returns share the same period length.
 * For trade-level returns with variable holding periods, use the
 * duration-aware calculators in self-learning-service or routes.ts.
 */
export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate: number = 0.045 / 252 // Daily risk-free rate (4.5% annual T-bill proxy)
): number {
  if (returns.length < 20) return 0;

  // Compute excess returns per period
  const excessReturns = returns.map(r => r - riskFreeRate);
  const meanExcess = mean(excessReturns);
  const stdExcess = standardDeviation(excessReturns);

  if (stdExcess === 0) return 0;

  // Annualize (assuming daily returns)
  const annualizedSharpe = (meanExcess / stdExcess) * Math.sqrt(252);

  return annualizedSharpe;
}

/**
 * Calculate Sortino Ratio
 * Uses downside deviation instead of total standard deviation
 */
export function calculateSortinoRatio(
  returns: number[],
  riskFreeRate: number = 0.045 / 252
): number {
  if (returns.length < 20) return 0;
  
  const avgReturn = mean(returns);
  const downDev = downsideDeviation(returns, riskFreeRate);
  
  if (downDev === 0) return avgReturn > riskFreeRate ? 10 : 0; // Cap at 10 if no downside
  
  const excessReturn = avgReturn - riskFreeRate;
  const annualizedSortino = (excessReturn / downDev) * Math.sqrt(252);
  
  return annualizedSortino;
}

/**
 * Calculate Calmar Ratio
 * Annualized Return / Maximum Drawdown
 */
export function calculateCalmarRatio(
  returns: number[],
  maxDrawdown: number
): number {
  if (returns.length < 20 || maxDrawdown === 0) return 0;
  
  const totalReturn = returns.reduce((sum, r) => sum * (1 + r), 1) - 1;
  const annualizedReturn = Math.pow(1 + totalReturn, 252 / returns.length) - 1;
  
  return annualizedReturn / Math.abs(maxDrawdown);
}

/**
 * Calculate Maximum Drawdown
 * Largest peak-to-trough decline
 */
export function calculateMaxDrawdown(equityCurve: number[]): { maxDrawdown: number; drawdownDuration: number } {
  if (equityCurve.length < 2) {
    return { maxDrawdown: 0, drawdownDuration: 0 };
  }
  
  let maxDrawdown = 0;
  let maxDrawdownDuration = 0;
  let currentDrawdownStart = 0;
  let peak = equityCurve[0];
  
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
      currentDrawdownStart = i;
    }
    
    const drawdown = (peak - equityCurve[i]) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownDuration = i - currentDrawdownStart;
    }
  }
  
  return { maxDrawdown, drawdownDuration: maxDrawdownDuration };
}

// ============================================================================
// CIRCUIT BREAKERS
// ============================================================================

interface CircuitBreakerConfig {
  maxDailyLoss: number;           // Max daily loss in dollars
  maxDailyLossPercent: number;    // Max daily loss as % of portfolio
  maxDrawdownPercent: number;     // Max drawdown before halt
  maxConsecutiveLosses: number;   // Max losing trades in a row
  volatilityThreshold: number;    // VIX level to pause trading
}

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  maxDailyLoss: 500,
  maxDailyLossPercent: 0.05,      // 5% daily loss limit
  maxDrawdownPercent: 0.15,       // 15% max drawdown
  maxConsecutiveLosses: 5,
  volatilityThreshold: 35         // Pause if VIX > 35
};

export function checkCircuitBreakers(
  dailyPnL: number,
  portfolioValue: number,
  currentDrawdown: number,
  consecutiveLosses: number,
  currentVIX: number = 15,
  config: Partial<CircuitBreakerConfig> = {}
): { triggered: boolean; reason: string | null } {
  const cfg = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  
  // Check daily loss limit
  if (dailyPnL < -cfg.maxDailyLoss) {
    return {
      triggered: true,
      reason: `Daily loss limit exceeded: $${Math.abs(dailyPnL).toFixed(2)} > $${cfg.maxDailyLoss}`
    };
  }
  
  // Check daily loss percentage
  const dailyLossPercent = Math.abs(dailyPnL) / portfolioValue;
  if (dailyPnL < 0 && dailyLossPercent > cfg.maxDailyLossPercent) {
    return {
      triggered: true,
      reason: `Daily loss % exceeded: ${(dailyLossPercent * 100).toFixed(1)}% > ${(cfg.maxDailyLossPercent * 100).toFixed(1)}%`
    };
  }
  
  // Check max drawdown
  if (currentDrawdown > cfg.maxDrawdownPercent) {
    return {
      triggered: true,
      reason: `Max drawdown exceeded: ${(currentDrawdown * 100).toFixed(1)}% > ${(cfg.maxDrawdownPercent * 100).toFixed(1)}%`
    };
  }
  
  // Check consecutive losses
  if (consecutiveLosses >= cfg.maxConsecutiveLosses) {
    return {
      triggered: true,
      reason: `Consecutive losses: ${consecutiveLosses} >= ${cfg.maxConsecutiveLosses}`
    };
  }
  
  // Check volatility
  if (currentVIX > cfg.volatilityThreshold) {
    return {
      triggered: true,
      reason: `High volatility: VIX ${currentVIX.toFixed(1)} > ${cfg.volatilityThreshold}`
    };
  }
  
  return { triggered: false, reason: null };
}

// ============================================================================
// SCENARIO ANALYSIS
// ============================================================================

export function runScenarioAnalysis(
  positions: PositionRisk[],
  portfolioValue: number,
  scenario: 'crash' | 'rally' | 'vol_spike' | 'custom',
  customParams?: { marketMove: number; volChange: number }
): ScenarioResult {
  const scenarios: Record<string, { marketMove: number; volChange: number; name: string }> = {
    crash: { marketMove: -0.10, volChange: 0.50, name: 'Market Crash (-10%, +50% vol)' },
    rally: { marketMove: 0.05, volChange: -0.20, name: 'Market Rally (+5%, -20% vol)' },
    vol_spike: { marketMove: -0.02, volChange: 0.30, name: 'Vol Spike (-2%, +30% vol)' },
    custom: customParams ? { ...customParams, name: 'Custom Scenario' } : { marketMove: 0, volChange: 0, name: 'Custom' }
  };
  
  const params = scenarios[scenario];
  let totalImpact = 0;
  const positionImpacts: ScenarioResult['positionImpacts'] = [];
  
  for (const position of positions) {
    let pnlChange = 0;
    
    if (position.assetType === 'option') {
      // Options: delta * price move + vega * vol change
      pnlChange = position.deltaExposure * params.marketMove * position.currentValue
                + position.vegaExposure * params.volChange;
    } else {
      // Linear instruments: beta-adjusted market move
      pnlChange = position.positionBeta * params.marketMove * position.currentValue;
    }
    
    totalImpact += pnlChange;
    positionImpacts.push({
      symbol: position.symbol,
      pnlChange,
      pnlChangePercent: (pnlChange / position.currentValue) * 100
    });
  }
  
  return {
    scenarioName: params.name,
    portfolioChange: totalImpact,
    portfolioChangePercent: (totalImpact / portfolioValue) * 100,
    varImpact: Math.abs(totalImpact),
    positionImpacts
  };
}

// ============================================================================
// MAIN RISK ENGINE CLASS
// ============================================================================

export class RiskEngine {
  private historicalReturns: number[] = [];
  private equityCurve: number[] = [];
  private dailyPnL: number = 0;
  private consecutiveLosses: number = 0;
  
  constructor(
    private portfolioValue: number,
    private config: Partial<CircuitBreakerConfig> = {}
  ) {
    this.equityCurve = [portfolioValue];
  }
  
  /**
   * Update with new return data
   */
  updateReturns(dailyReturn: number): void {
    this.historicalReturns.push(dailyReturn);
    if (this.historicalReturns.length > 252) {
      this.historicalReturns.shift(); // Keep 1 year of data
    }
    
    const newEquity = this.equityCurve[this.equityCurve.length - 1] * (1 + dailyReturn);
    this.equityCurve.push(newEquity);
    
    this.dailyPnL = dailyReturn * this.portfolioValue;
    
    if (dailyReturn < 0) {
      this.consecutiveLosses++;
    } else {
      this.consecutiveLosses = 0;
    }
  }
  
  /**
   * Get comprehensive risk metrics
   * Uses cached VIX value (updated separately by updateVIXCache)
   */
  calculateRiskMetrics(): RiskMetrics {
    const { maxDrawdown, drawdownDuration } = calculateMaxDrawdown(this.equityCurve);
    const currentEquity = this.equityCurve[this.equityCurve.length - 1];
    const peak = Math.max(...this.equityCurve);
    const currentDrawdown = (peak - currentEquity) / peak;
    
    // Use cached VIX value (updated by separate background job)
    const currentVIX = getCachedVIX();
    
    const circuitBreaker = checkCircuitBreakers(
      this.dailyPnL,
      this.portfolioValue,
      currentDrawdown,
      this.consecutiveLosses,
      currentVIX,
      this.config
    );
    
    // Calculate Kelly based on historical performance
    const wins = this.historicalReturns.filter(r => r > 0);
    const losses = this.historicalReturns.filter(r => r < 0);
    const winRate = wins.length / Math.max(1, this.historicalReturns.length);
    const avgWin = wins.length > 0 ? mean(wins) : 0.02;
    const avgLoss = losses.length > 0 ? Math.abs(mean(losses)) : 0.02;
    
    const kelly = calculateKellyCriterion(winRate, avgWin, avgLoss, this.portfolioValue);
    
    return {
      portfolioValue: currentEquity,
      cashBalance: currentEquity * 0.2, // Assume 20% cash
      totalExposure: currentEquity * 0.8,
      
      var95Daily: calculateHistoricalVaR(this.historicalReturns, currentEquity, 0.95),
      var99Daily: calculateHistoricalVaR(this.historicalReturns, currentEquity, 0.99),
      cvar95Daily: calculateCVaR(this.historicalReturns, currentEquity, 0.95),
      cvar99Daily: calculateCVaR(this.historicalReturns, currentEquity, 0.99),
      
      currentDrawdown,
      maxDrawdown,
      drawdownDuration,
      
      sharpeRatio: calculateSharpeRatio(this.historicalReturns),
      sortinoRatio: calculateSortinoRatio(this.historicalReturns),
      calmarRatio: calculateCalmarRatio(this.historicalReturns, maxDrawdown),
      
      kellyFraction: kelly.fullKelly,
      halfKelly: kelly.halfKelly,
      quarterKelly: kelly.quarterKelly,
      
      circuitBreakerTriggered: circuitBreaker.triggered,
      circuitBreakerReason: circuitBreaker.reason,
      
      calculatedAt: new Date().toISOString()
    };
  }
}

// Export singleton for bot usage
let botRiskEngine: RiskEngine | null = null;

export function getBotRiskEngine(portfolioValue: number = 300): RiskEngine {
  if (!botRiskEngine) {
    botRiskEngine = new RiskEngine(portfolioValue);
  }
  return botRiskEngine;
}

export function resetBotRiskEngine(): void {
  botRiskEngine = null;
}

logger.info('[RISK-ENGINE] Institutional risk engine loaded');
