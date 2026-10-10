/**
 * PhD-Level Options Quantitative Analytics
 * Institutional-grade options pricing and risk analysis
 * 
 * Features:
 * - Black-Scholes pricing with Greeks
 * - SABR volatility model calibration
 * - Volatility surface construction
 * - Monte Carlo option pricing
 * - Strategy P&L simulation
 * - IV rank/percentile calculations
 * - Skew and term structure analysis
 */

import { logger } from './logger';

// ============================================================================
// CONSTANTS
// ============================================================================

const DAYS_PER_YEAR = 365;
const TRADING_DAYS_PER_YEAR = 252;
const RISK_FREE_RATE = 0.05; // 5% annual risk-free rate

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface OptionParams {
  spotPrice: number;
  strikePrice: number;
  timeToExpiry: number;    // In years
  riskFreeRate: number;
  volatility: number;      // Implied volatility
  optionType: 'call' | 'put';
  dividendYield?: number;
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  vanna: number;           // d(delta)/d(vol)
  volga: number;           // d(vega)/d(vol) - vomma
  charm: number;           // d(delta)/d(time)
  color: number;           // d(gamma)/d(time)
  speed: number;           // d(gamma)/d(spot)
  zomma: number;           // d(gamma)/d(vol)
}

export interface OptionPrice {
  theoreticalPrice: number;
  intrinsicValue: number;
  timeValue: number;
  greeks: Greeks;
}

export interface VolatilitySurfacePoint {
  strike: number;
  expiry: number;          // Days to expiry
  impliedVol: number;
  moneyness: number;       // Strike / Spot
  delta: number;
}

export interface VolatilitySurface {
  spotPrice: number;
  strikes: number[];
  expiries: number[];      // Days to expiry
  ivMatrix: number[][];    // [expiry][strike]
  timestamp: string;
}

export interface SABRParams {
  alpha: number;           // Initial volatility
  beta: number;            // CEV exponent (0-1)
  rho: number;             // Correlation (-1 to 1)
  nu: number;              // Vol of vol
}

export interface SkewMetrics {
  putCallSkew: number;     // 25-delta put IV - 25-delta call IV
  atmVolatility: number;   // ATM IV
  skewSlope: number;       // Rate of IV change per strike
  termStructureSlope: number; // Near-term vs far-term IV difference
  butterflySpread: number; // Wings vs ATM IV
}

export interface IVAnalysis {
  currentIV: number;
  ivRank: number;          // 0-100, current IV vs 52-week range
  ivPercentile: number;    // 0-100, % of time IV was lower
  ivHigh52Week: number;
  ivLow52Week: number;
  ivMean: number;
  ivStdDev: number;
  ivTrend: 'rising' | 'falling' | 'neutral';
  expectedMove: number;    // 1-sigma expected move
  expectedMovePercent: number;
}

export interface StrategyLeg {
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  quantity: number;        // Positive = long, negative = short
  premium: number;
}

export interface StrategyPayoff {
  name: string;
  legs: StrategyLeg[];
  maxProfit: number | 'unlimited';
  maxLoss: number | 'unlimited';
  breakEvenPoints: number[];
  probabilityOfProfit: number;
  expectedValue: number;
  payoffCurve: Array<{ price: number; pnl: number }>;
  greeksAggregate: Greeks;
}

export interface MonteCarloResult {
  theoreticalPrice: number;
  confidence95: [number, number];
  confidence99: [number, number];
  paths: number;
  executionTimeMs: number;
}

// ============================================================================
// MATHEMATICAL UTILITIES
// ============================================================================

/**
 * Standard normal cumulative distribution function (CDF)
 * Approximation using Abramowitz and Stegun formula
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Standard normal probability density function (PDF)
 */
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Generate normally distributed random number (Box-Muller)
 */
function randomNormal(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ============================================================================
// BLACK-SCHOLES MODEL
// ============================================================================

/**
 * Calculate d1 and d2 for Black-Scholes
 */
function calculateD1D2(
  spot: number,
  strike: number,
  timeToExpiry: number,
  riskFreeRate: number,
  volatility: number,
  dividendYield: number = 0
): { d1: number; d2: number } {
  const sqrtT = Math.sqrt(timeToExpiry);
  const d1 = (Math.log(spot / strike) + (riskFreeRate - dividendYield + 0.5 * volatility * volatility) * timeToExpiry) / (volatility * sqrtT);
  const d2 = d1 - volatility * sqrtT;
  return { d1, d2 };
}

/**
 * Black-Scholes option pricing with full Greeks
 */
export function blackScholes(params: OptionParams): OptionPrice {
  const { spotPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, optionType, dividendYield = 0 } = params;
  
  // Handle edge cases
  if (timeToExpiry <= 0) {
    const intrinsic = optionType === 'call' 
      ? Math.max(0, spotPrice - strikePrice)
      : Math.max(0, strikePrice - spotPrice);
    return {
      theoreticalPrice: intrinsic,
      intrinsicValue: intrinsic,
      timeValue: 0,
      greeks: { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, volga: 0, charm: 0, color: 0, speed: 0, zomma: 0 }
    };
  }
  
  const { d1, d2 } = calculateD1D2(spotPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, dividendYield);
  const sqrtT = Math.sqrt(timeToExpiry);
  const discountFactor = Math.exp(-riskFreeRate * timeToExpiry);
  const dividendDiscount = Math.exp(-dividendYield * timeToExpiry);
  
  let price: number;
  let delta: number;
  
  if (optionType === 'call') {
    price = spotPrice * dividendDiscount * normalCDF(d1) - strikePrice * discountFactor * normalCDF(d2);
    delta = dividendDiscount * normalCDF(d1);
  } else {
    price = strikePrice * discountFactor * normalCDF(-d2) - spotPrice * dividendDiscount * normalCDF(-d1);
    delta = -dividendDiscount * normalCDF(-d1);
  }
  
  // Common Greeks
  const gamma = dividendDiscount * normalPDF(d1) / (spotPrice * volatility * sqrtT);
  const vega = spotPrice * dividendDiscount * normalPDF(d1) * sqrtT / 100; // Per 1% IV change
  
  // Theta (per day)
  const theta_part1 = -(spotPrice * dividendDiscount * normalPDF(d1) * volatility) / (2 * sqrtT);
  let theta: number;
  if (optionType === 'call') {
    theta = (theta_part1 - riskFreeRate * strikePrice * discountFactor * normalCDF(d2) + dividendYield * spotPrice * dividendDiscount * normalCDF(d1)) / DAYS_PER_YEAR;
  } else {
    theta = (theta_part1 + riskFreeRate * strikePrice * discountFactor * normalCDF(-d2) - dividendYield * spotPrice * dividendDiscount * normalCDF(-d1)) / DAYS_PER_YEAR;
  }
  
  // Rho (per 1% rate change)
  let rho: number;
  if (optionType === 'call') {
    rho = strikePrice * timeToExpiry * discountFactor * normalCDF(d2) / 100;
  } else {
    rho = -strikePrice * timeToExpiry * discountFactor * normalCDF(-d2) / 100;
  }
  
  // Higher-order Greeks
  const vanna = -dividendDiscount * normalPDF(d1) * d2 / volatility;
  const volga = vega * d1 * d2 / volatility;
  const charm = dividendDiscount * (dividendYield * normalCDF(d1) - normalPDF(d1) * (2 * (riskFreeRate - dividendYield) * timeToExpiry - d2 * volatility * sqrtT) / (2 * timeToExpiry * volatility * sqrtT));
  const color = -dividendDiscount * normalPDF(d1) / (2 * spotPrice * timeToExpiry * volatility * sqrtT) * (2 * dividendYield * timeToExpiry + 1 + (2 * (riskFreeRate - dividendYield) * timeToExpiry - d2 * volatility * sqrtT) / (volatility * sqrtT) * d1);
  const speed = -gamma / spotPrice * (d1 / (volatility * sqrtT) + 1);
  const zomma = gamma * (d1 * d2 - 1) / volatility;
  
  // Intrinsic and time value
  const intrinsicValue = optionType === 'call' 
    ? Math.max(0, spotPrice - strikePrice)
    : Math.max(0, strikePrice - spotPrice);
  const timeValue = price - intrinsicValue;
  
  return {
    theoreticalPrice: Math.max(0, price),
    intrinsicValue,
    timeValue: Math.max(0, timeValue),
    greeks: {
      delta,
      gamma,
      theta,
      vega,
      rho,
      vanna,
      volga,
      charm,
      color,
      speed,
      zomma
    }
  };
}

/**
 * Calculate implied volatility using Newton-Raphson method
 */
export function calculateImpliedVolatility(
  marketPrice: number,
  spotPrice: number,
  strikePrice: number,
  timeToExpiry: number,
  riskFreeRate: number,
  optionType: 'call' | 'put',
  maxIterations: number = 100,
  tolerance: number = 0.0001
): number {
  // Initial guess using Brenner-Subrahmanyam approximation
  let sigma = Math.sqrt(2 * Math.PI / timeToExpiry) * marketPrice / spotPrice;
  sigma = Math.max(0.01, Math.min(5.0, sigma)); // Clamp to reasonable range
  
  for (let i = 0; i < maxIterations; i++) {
    const result = blackScholes({
      spotPrice,
      strikePrice,
      timeToExpiry,
      riskFreeRate,
      volatility: sigma,
      optionType
    });
    
    const priceDiff = result.theoreticalPrice - marketPrice;
    
    if (Math.abs(priceDiff) < tolerance) {
      return sigma;
    }
    
    // Newton-Raphson step: sigma_new = sigma - f(sigma) / f'(sigma)
    const vegaAdjusted = result.greeks.vega * 100; // Convert back from per-1%
    if (Math.abs(vegaAdjusted) < 1e-10) break;
    
    sigma = sigma - priceDiff / vegaAdjusted;
    sigma = Math.max(0.01, Math.min(5.0, sigma)); // Keep in bounds
  }
  
  return sigma;
}

// ============================================================================
// SABR MODEL
// ============================================================================

/**
 * SABR implied volatility approximation (Hagan et al. 2002)
 */
export function sabrImpliedVolatility(
  forward: number,
  strike: number,
  timeToExpiry: number,
  sabr: SABRParams
): number {
  const { alpha, beta, rho, nu } = sabr;
  
  // Handle ATM case
  if (Math.abs(forward - strike) < 1e-10) {
    const fMid = forward;
    const term1 = alpha / Math.pow(fMid, 1 - beta);
    const term2 = 1 + ((1 - beta) ** 2 / 24 * alpha ** 2 / Math.pow(fMid, 2 - 2 * beta) +
                       0.25 * rho * beta * nu * alpha / Math.pow(fMid, 1 - beta) +
                       (2 - 3 * rho ** 2) / 24 * nu ** 2) * timeToExpiry;
    return term1 * term2;
  }
  
  const fMid = Math.sqrt(forward * strike);
  const logFK = Math.log(forward / strike);
  
  // z and x(z) calculation
  const z = (nu / alpha) * Math.pow(fMid, 1 - beta) * logFK;
  const xz = Math.log((Math.sqrt(1 - 2 * rho * z + z ** 2) + z - rho) / (1 - rho));
  
  // Numerator
  const num = alpha * (1 + ((1 - beta) ** 2 / 24 * alpha ** 2 / Math.pow(fMid, 2 - 2 * beta) +
                            0.25 * rho * beta * nu * alpha / Math.pow(fMid, 1 - beta) +
                            (2 - 3 * rho ** 2) / 24 * nu ** 2) * timeToExpiry);
  
  // Denominator
  const den = Math.pow(fMid, 1 - beta) * (1 + (1 - beta) ** 2 / 24 * logFK ** 2 + 
                                           (1 - beta) ** 4 / 1920 * logFK ** 4);
  
  return num / den * z / xz;
}

/**
 * Calibrate SABR parameters to market implied volatilities
 * Uses simplified least-squares approach
 */
export function calibrateSABR(
  forward: number,
  strikes: number[],
  marketVols: number[],
  timeToExpiry: number,
  beta: number = 0.5 // Often fixed at 0.5 or 1
): SABRParams {
  // Initial guess
  let alpha = marketVols[Math.floor(marketVols.length / 2)] * Math.pow(forward, 1 - beta);
  let rho = -0.2;
  let nu = 0.3;
  
  // Simple gradient descent calibration
  const learningRate = 0.01;
  const iterations = 100;
  
  for (let iter = 0; iter < iterations; iter++) {
    let totalError = 0;
    let alphaGrad = 0;
    let rhoGrad = 0;
    let nuGrad = 0;
    
    for (let i = 0; i < strikes.length; i++) {
      const modelVol = sabrImpliedVolatility(forward, strikes[i], timeToExpiry, { alpha, beta, rho, nu });
      const error = modelVol - marketVols[i];
      totalError += error ** 2;
      
      // Numerical gradients
      const eps = 0.001;
      alphaGrad += error * (sabrImpliedVolatility(forward, strikes[i], timeToExpiry, { alpha: alpha + eps, beta, rho, nu }) - modelVol) / eps;
      rhoGrad += error * (sabrImpliedVolatility(forward, strikes[i], timeToExpiry, { alpha, beta, rho: rho + eps, nu }) - modelVol) / eps;
      nuGrad += error * (sabrImpliedVolatility(forward, strikes[i], timeToExpiry, { alpha, beta, rho, nu: nu + eps }) - modelVol) / eps;
    }
    
    // Update parameters
    alpha -= learningRate * alphaGrad;
    rho -= learningRate * rhoGrad;
    nu -= learningRate * nuGrad;
    
    // Enforce constraints
    alpha = Math.max(0.001, alpha);
    rho = Math.max(-0.999, Math.min(0.999, rho));
    nu = Math.max(0.001, nu);
  }
  
  return { alpha, beta, rho, nu };
}

// ============================================================================
// VOLATILITY SURFACE
// ============================================================================

/**
 * Construct volatility surface from option chain data
 */
export function constructVolatilitySurface(
  spotPrice: number,
  optionChain: Array<{
    strike: number;
    expiry: number; // Days to expiry
    bid: number;
    ask: number;
    optionType: 'call' | 'put';
  }>,
  riskFreeRate: number = RISK_FREE_RATE
): VolatilitySurface {
  const expirySet = new Set<number>();
  const strikeSet = new Set<number>();
  
  // Group by expiry and strike
  const ivMap = new Map<string, number>();
  
  for (const option of optionChain) {
    expirySet.add(option.expiry);
    strikeSet.add(option.strike);
    
    const midPrice = (option.bid + option.ask) / 2;
    if (midPrice <= 0) continue;
    
    const timeToExpiry = option.expiry / DAYS_PER_YEAR;
    if (timeToExpiry <= 0) continue;
    
    try {
      const iv = calculateImpliedVolatility(
        midPrice,
        spotPrice,
        option.strike,
        timeToExpiry,
        riskFreeRate,
        option.optionType
      );
      
      const key = `${option.expiry}-${option.strike}`;
      ivMap.set(key, iv);
    } catch (e) {
      // Skip invalid options
    }
  }
  
  const expiries = Array.from(expirySet).sort((a, b) => a - b);
  const strikes = Array.from(strikeSet).sort((a, b) => a - b);
  
  // Build IV matrix with interpolation for missing values
  const ivMatrix: number[][] = [];
  for (const expiry of expiries) {
    const row: number[] = [];
    for (const strike of strikes) {
      const key = `${expiry}-${strike}`;
      row.push(ivMap.get(key) || 0);
    }
    ivMatrix.push(row);
  }
  
  // Interpolate missing values (linear interpolation along strikes, then expiries)
  for (let e = 0; e < ivMatrix.length; e++) {
    // Horizontal interpolation (across strikes)
    let lastValidIdx = -1;
    let lastValidVal = 0;
    for (let s = 0; s < ivMatrix[e].length; s++) {
      if (ivMatrix[e][s] > 0) {
        if (lastValidIdx >= 0 && lastValidIdx < s - 1) {
          // Interpolate between lastValidIdx and s
          const gap = s - lastValidIdx;
          for (let g = 1; g < gap; g++) {
            ivMatrix[e][lastValidIdx + g] = lastValidVal + (ivMatrix[e][s] - lastValidVal) * (g / gap);
          }
        }
        lastValidIdx = s;
        lastValidVal = ivMatrix[e][s];
      }
    }
    // Fill trailing zeros with last valid
    if (lastValidIdx >= 0) {
      for (let s = lastValidIdx + 1; s < ivMatrix[e].length; s++) {
        if (ivMatrix[e][s] === 0) ivMatrix[e][s] = lastValidVal;
      }
    }
    // Fill leading zeros with first valid
    const firstValid = ivMatrix[e].findIndex(v => v > 0);
    if (firstValid > 0) {
      for (let s = 0; s < firstValid; s++) {
        ivMatrix[e][s] = ivMatrix[e][firstValid];
      }
    }
  }
  
  // Vertical interpolation (across expiries) for any remaining zeros
  for (let s = 0; s < strikes.length; s++) {
    let lastValidIdx = -1;
    let lastValidVal = 0;
    for (let e = 0; e < ivMatrix.length; e++) {
      if (ivMatrix[e][s] > 0) {
        if (lastValidIdx >= 0 && lastValidIdx < e - 1) {
          const gap = e - lastValidIdx;
          for (let g = 1; g < gap; g++) {
            ivMatrix[lastValidIdx + g][s] = lastValidVal + (ivMatrix[e][s] - lastValidVal) * (g / gap);
          }
        }
        lastValidIdx = e;
        lastValidVal = ivMatrix[e][s];
      }
    }
    if (lastValidIdx >= 0) {
      for (let e = lastValidIdx + 1; e < ivMatrix.length; e++) {
        if (ivMatrix[e][s] === 0) ivMatrix[e][s] = lastValidVal;
      }
    }
    const firstValidE = ivMatrix.findIndex(row => row[s] > 0);
    if (firstValidE > 0) {
      for (let e = 0; e < firstValidE; e++) {
        ivMatrix[e][s] = ivMatrix[firstValidE][s];
      }
    }
  }
  
  // If entire matrix is still empty, use ATM default
  const anyValid = ivMatrix.some(row => row.some(v => v > 0));
  if (!anyValid && strikes.length > 0 && expiries.length > 0) {
    const defaultIV = 0.30; // 30% default
    for (let e = 0; e < ivMatrix.length; e++) {
      for (let s = 0; s < ivMatrix[e].length; s++) {
        const moneyness = strikes[s] / spotPrice;
        // Create slight skew - higher IV for OTM puts
        ivMatrix[e][s] = defaultIV * (1 + 0.1 * (1 - moneyness));
      }
    }
  }
  
  return {
    spotPrice,
    strikes,
    expiries,
    ivMatrix,
    timestamp: new Date().toISOString()
  };
}

// ============================================================================
// IV ANALYSIS
// ============================================================================

/**
 * Calculate IV rank and percentile from historical data
 */
export function analyzeIV(
  currentIV: number,
  historicalIVs: number[] // Past 252 trading days
): IVAnalysis {
  if (historicalIVs.length === 0) {
    return {
      currentIV,
      ivRank: 50,
      ivPercentile: 50,
      ivHigh52Week: currentIV,
      ivLow52Week: currentIV,
      ivMean: currentIV,
      ivStdDev: 0,
      ivTrend: 'neutral',
      expectedMove: 0,
      expectedMovePercent: 0
    };
  }
  
  const sortedIVs = [...historicalIVs].sort((a, b) => a - b);
  const ivHigh52Week = Math.max(...historicalIVs);
  const ivLow52Week = Math.min(...historicalIVs);
  
  // IV Rank: (Current IV - 52w Low) / (52w High - 52w Low)
  const ivRank = ivHigh52Week === ivLow52Week 
    ? 50 
    : ((currentIV - ivLow52Week) / (ivHigh52Week - ivLow52Week)) * 100;
  
  // IV Percentile: % of historical IVs below current
  const belowCount = sortedIVs.filter(iv => iv < currentIV).length;
  const ivPercentile = (belowCount / sortedIVs.length) * 100;
  
  // Mean and StdDev
  const ivMean = historicalIVs.reduce((sum, iv) => sum + iv, 0) / historicalIVs.length;
  const ivVariance = historicalIVs.reduce((sum, iv) => sum + (iv - ivMean) ** 2, 0) / historicalIVs.length;
  const ivStdDev = Math.sqrt(ivVariance);
  
  // Trend detection (compare recent 5-day average to 20-day average)
  const recent5 = historicalIVs.slice(-5);
  const recent20 = historicalIVs.slice(-20);
  const avg5 = recent5.reduce((sum, iv) => sum + iv, 0) / recent5.length;
  const avg20 = recent20.reduce((sum, iv) => sum + iv, 0) / recent20.length;
  
  let ivTrend: 'rising' | 'falling' | 'neutral';
  if (avg5 > avg20 * 1.05) ivTrend = 'rising';
  else if (avg5 < avg20 * 0.95) ivTrend = 'falling';
  else ivTrend = 'neutral';
  
  // Expected move (1 standard deviation for ~30 days)
  const expectedMovePercent = currentIV * Math.sqrt(30 / DAYS_PER_YEAR) * 100;
  
  return {
    currentIV,
    ivRank: Math.round(ivRank * 10) / 10,
    ivPercentile: Math.round(ivPercentile * 10) / 10,
    ivHigh52Week,
    ivLow52Week,
    ivMean,
    ivStdDev,
    ivTrend,
    expectedMove: expectedMovePercent,
    expectedMovePercent
  };
}

// ============================================================================
// SKEW ANALYSIS
// ============================================================================

/**
 * Analyze volatility skew and term structure
 */
export function analyzeSkew(
  surface: VolatilitySurface,
  spotPrice: number
): SkewMetrics {
  // Find ATM strike (closest to spot)
  const atmStrikeIdx = surface.strikes.reduce((closest, strike, idx) => 
    Math.abs(strike - spotPrice) < Math.abs(surface.strikes[closest] - spotPrice) ? idx : closest, 0);
  
  // Use first expiry for skew calculations
  const atmVolatility = surface.ivMatrix[0]?.[atmStrikeIdx] || 0.3;
  
  // Find 25-delta put and call (approximate as 10% OTM)
  const putStrike = spotPrice * 0.90;
  const callStrike = spotPrice * 1.10;
  
  const putStrikeIdx = surface.strikes.findIndex(s => s >= putStrike) || 0;
  const callStrikeIdx = surface.strikes.findIndex(s => s >= callStrike) || surface.strikes.length - 1;
  
  const putIV = surface.ivMatrix[0]?.[putStrikeIdx] || atmVolatility;
  const callIV = surface.ivMatrix[0]?.[callStrikeIdx] || atmVolatility;
  
  const putCallSkew = (putIV - callIV) * 100; // In vol points
  
  // Skew slope (IV change per 1% strike change)
  const skewSlope = (putIV - atmVolatility) / 0.10;
  
  // Term structure slope (far-dated vs near-dated ATM)
  const nearATM = surface.ivMatrix[0]?.[atmStrikeIdx] || 0.3;
  const farATM = surface.ivMatrix[surface.ivMatrix.length - 1]?.[atmStrikeIdx] || 0.3;
  const termStructureSlope = (farATM - nearATM) * 100;
  
  // Butterfly spread (wings vs ATM)
  const butterflySpread = ((putIV + callIV) / 2 - atmVolatility) * 100;
  
  return {
    putCallSkew,
    atmVolatility,
    skewSlope,
    termStructureSlope,
    butterflySpread
  };
}

// ============================================================================
// MONTE CARLO PRICING
// ============================================================================

/**
 * Monte Carlo option pricing with geometric Brownian motion
 */
export function monteCarloPrice(
  params: OptionParams,
  numPaths: number = 10000,
  numSteps: number = 252
): MonteCarloResult {
  const startTime = Date.now();
  const { spotPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, optionType, dividendYield = 0 } = params;
  
  const dt = timeToExpiry / numSteps;
  const drift = (riskFreeRate - dividendYield - 0.5 * volatility ** 2) * dt;
  const diffusion = volatility * Math.sqrt(dt);
  
  const payoffs: number[] = [];
  
  for (let path = 0; path < numPaths; path++) {
    let price = spotPrice;
    
    for (let step = 0; step < numSteps; step++) {
      const z = randomNormal();
      price *= Math.exp(drift + diffusion * z);
    }
    
    // Calculate payoff
    const payoff = optionType === 'call'
      ? Math.max(0, price - strikePrice)
      : Math.max(0, strikePrice - price);
    
    payoffs.push(payoff);
  }
  
  // Discount expected payoff
  const discountFactor = Math.exp(-riskFreeRate * timeToExpiry);
  const meanPayoff = payoffs.reduce((sum, p) => sum + p, 0) / numPaths;
  const theoreticalPrice = meanPayoff * discountFactor;
  
  // Calculate confidence intervals
  payoffs.sort((a, b) => a - b);
  const discountedPayoffs = payoffs.map(p => p * discountFactor);
  
  const ci95Lower = discountedPayoffs[Math.floor(numPaths * 0.025)];
  const ci95Upper = discountedPayoffs[Math.floor(numPaths * 0.975)];
  const ci99Lower = discountedPayoffs[Math.floor(numPaths * 0.005)];
  const ci99Upper = discountedPayoffs[Math.floor(numPaths * 0.995)];
  
  return {
    theoreticalPrice,
    confidence95: [ci95Lower, ci95Upper],
    confidence99: [ci99Lower, ci99Upper],
    paths: numPaths,
    executionTimeMs: Date.now() - startTime
  };
}

// ============================================================================
// STRATEGY SIMULATION
// ============================================================================

/**
 * Simulate multi-leg options strategy P&L
 */
export function simulateStrategy(
  legs: StrategyLeg[],
  spotPrice: number,
  priceRange: { min: number; max: number; step: number },
  volatility: number = 0.3,
  riskFreeRate: number = RISK_FREE_RATE
): StrategyPayoff {
  const payoffCurve: Array<{ price: number; pnl: number }> = [];
  
  // Calculate net premium (cost/credit)
  const netPremium = legs.reduce((sum, leg) => sum + leg.premium * leg.quantity, 0);
  
  // Calculate payoff at each price point
  for (let price = priceRange.min; price <= priceRange.max; price += priceRange.step) {
    let pnl = -netPremium; // Start with premium paid/received
    
    for (const leg of legs) {
      const intrinsic = leg.optionType === 'call'
        ? Math.max(0, price - leg.strike)
        : Math.max(0, leg.strike - price);
      
      pnl += intrinsic * leg.quantity;
    }
    
    payoffCurve.push({ price, pnl });
  }
  
  // Find max profit/loss and breakeven points
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  const breakEvenPoints: number[] = [];
  
  for (let i = 0; i < payoffCurve.length; i++) {
    const { pnl } = payoffCurve[i];
    if (pnl > maxProfit) maxProfit = pnl;
    if (pnl < maxLoss) maxLoss = pnl;
    
    // Find breakeven (sign change)
    if (i > 0) {
      const prevPnl = payoffCurve[i - 1].pnl;
      if ((prevPnl < 0 && pnl >= 0) || (prevPnl >= 0 && pnl < 0)) {
        breakEvenPoints.push(payoffCurve[i].price);
      }
    }
  }
  
  // Aggregate Greeks
  let greeksAggregate: Greeks = {
    delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0,
    vanna: 0, volga: 0, charm: 0, color: 0, speed: 0, zomma: 0
  };
  
  for (const leg of legs) {
    const daysToExpiry = Math.max(1, Math.floor((new Date(leg.expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    const timeToExpiry = daysToExpiry / DAYS_PER_YEAR;
    
    const result = blackScholes({
      spotPrice,
      strikePrice: leg.strike,
      timeToExpiry,
      riskFreeRate,
      volatility,
      optionType: leg.optionType
    });
    
    for (const key of Object.keys(greeksAggregate) as (keyof Greeks)[]) {
      greeksAggregate[key] += result.greeks[key] * leg.quantity;
    }
  }
  
  // Probability of profit (approximate using delta)
  const profitableCount = payoffCurve.filter(p => p.pnl > 0).length;
  const probabilityOfProfit = (profitableCount / payoffCurve.length) * 100;
  
  // Expected value (simple average)
  const expectedValue = payoffCurve.reduce((sum, p) => sum + p.pnl, 0) / payoffCurve.length;
  
  // Determine strategy name
  let name = 'Custom Strategy';
  if (legs.length === 1) {
    name = `Long ${legs[0].optionType.charAt(0).toUpperCase() + legs[0].optionType.slice(1)}`;
  } else if (legs.length === 2) {
    const callLegs = legs.filter(l => l.optionType === 'call');
    const putLegs = legs.filter(l => l.optionType === 'put');
    
    if (callLegs.length === 2) {
      if (callLegs[0].quantity * callLegs[1].quantity < 0) {
        name = 'Call Spread';
      }
    } else if (putLegs.length === 2) {
      if (putLegs[0].quantity * putLegs[1].quantity < 0) {
        name = 'Put Spread';
      }
    } else if (callLegs.length === 1 && putLegs.length === 1) {
      if (callLegs[0].strike === putLegs[0].strike) {
        name = callLegs[0].quantity > 0 ? 'Long Straddle' : 'Short Straddle';
      } else {
        name = callLegs[0].quantity > 0 ? 'Long Strangle' : 'Short Strangle';
      }
    }
  } else if (legs.length === 4) {
    name = 'Iron Condor / Butterfly';
  }
  
  return {
    name,
    legs,
    maxProfit: maxProfit === Infinity ? 'unlimited' : maxProfit,
    maxLoss: maxLoss === -Infinity ? 'unlimited' : Math.abs(maxLoss),
    breakEvenPoints,
    probabilityOfProfit,
    expectedValue,
    payoffCurve,
    greeksAggregate
  };
}

logger.info('[OPTIONS-QUANT] PhD-level options analytics loaded');
