/**
 * BTC TRACKER — Correlation Math
 * ================================
 * Pure functions: rolling beta, R², divergence, and pivot detection.
 *
 * Beta math:
 *   beta(stock, BTC) = Cov(stock_returns, BTC_returns) / Var(BTC_returns)
 *
 * R² shows how much of the stock's move is explained by BTC. >0.6 is a tight
 * correlation; <0.3 means the stock is moving for non-BTC reasons (so beta
 * is unreliable that day).
 */

// ─── Returns helpers ────────────────────────────────────────────────

/** Convert a price series to log-returns (more stable than pct returns for math) */
export function pricesToReturns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] <= 0) continue;
    r.push(Math.log(prices[i] / prices[i - 1]));
  }
  return r;
}

/** Mean of a series */
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const x of arr) s += x;
  return s / arr.length;
}

/** Variance of a series (Bessel-corrected, n-1) */
function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s = 0;
  for (const x of arr) {
    const d = x - m;
    s += d * d;
  }
  return s / (arr.length - 1);
}

/** Covariance of two equal-length series */
function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

/** Standard deviation */
export function stddev(arr: number[]): number {
  return Math.sqrt(variance(arr));
}

// ─── Beta + R² ──────────────────────────────────────────────────────

export interface BetaResult {
  beta: number;
  alpha: number;        // intercept (small for daily, irrelevant for our use)
  r2: number;           // 0-1, how tightly stock follows BTC
  observations: number; // sample size
}

/**
 * Linear regression: stock_return = alpha + beta * btc_return + noise
 * Returns slope (beta), intercept (alpha), and R² (goodness of fit).
 */
export function computeBeta(stockReturns: number[], btcReturns: number[]): BetaResult {
  const n = Math.min(stockReturns.length, btcReturns.length);
  if (n < 5) return { beta: 0, alpha: 0, r2: 0, observations: n };

  const s = stockReturns.slice(-n);
  const b = btcReturns.slice(-n);

  const varBtc = variance(b);
  if (varBtc === 0) return { beta: 0, alpha: 0, r2: 0, observations: n };

  const cov = covariance(s, b);
  const beta = cov / varBtc;
  const alpha = mean(s) - beta * mean(b);

  // R² = 1 - SSres/SStot
  const meanS = mean(s);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = alpha + beta * b[i];
    ssTot += (s[i] - meanS) ** 2;
    ssRes += (s[i] - predicted) ** 2;
  }
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  return { beta, alpha, r2, observations: n };
}

// ─── Divergence detection ──────────────────────────────────────────

export interface DivergenceResult {
  predictedMovePct: number;
  actualMovePct: number;
  divergence: number;        // actual - predicted
  divergenceZ: number;       // z-score of the divergence
  /** Strong divergence = mean reversion opportunity */
  signal: 'strong_long' | 'mild_long' | 'neutral' | 'mild_short' | 'strong_short';
}

/**
 * Compare actual stock move to predicted move (β × BTC move).
 * If stock LAGGED BTC by a lot, it's likely to catch up (long signal).
 * If stock LED BTC by a lot, may revert (short signal).
 */
export function computeDivergence(
  stockMovePct: number,
  btcMovePct: number,
  beta: number,
  historicalDivergenceStdDev: number,
): DivergenceResult {
  const predictedMovePct = beta * btcMovePct;
  const divergence = stockMovePct - predictedMovePct;
  const divergenceZ =
    historicalDivergenceStdDev > 0 ? divergence / historicalDivergenceStdDev : 0;

  let signal: DivergenceResult['signal'] = 'neutral';
  if (divergenceZ <= -2.0) signal = 'strong_long';      // stock lagged BTC, will catch up
  else if (divergenceZ <= -1.0) signal = 'mild_long';
  else if (divergenceZ >= 2.0) signal = 'strong_short'; // stock led BTC, will revert
  else if (divergenceZ >= 1.0) signal = 'mild_short';

  return { predictedMovePct, actualMovePct: stockMovePct, divergence, divergenceZ, signal };
}

// ─── Realized volatility ───────────────────────────────────────────

/**
 * Annualized realized volatility from a series of daily returns.
 * Multiply daily stddev by √252 for annual.
 */
export function realizedVolatility(returns: number[], periodsPerYear = 252): number {
  if (returns.length < 2) return 0;
  return stddev(returns) * Math.sqrt(periodsPerYear);
}

// ─── Pivot detection (key levels) ──────────────────────────────────

export interface Pivot {
  price: number;
  type: 'high' | 'low';
  /** Number of bars on each side that confirm the pivot */
  strength: number;
}

/**
 * Detect local pivots in a price series.
 * A pivot high is a bar whose high is greater than `lookback` bars on each side.
 * Returns an array of pivots sorted by recency (oldest first).
 */
export function detectPivots(prices: number[], lookback = 5): Pivot[] {
  const pivots: Pivot[] = [];
  if (prices.length < lookback * 2 + 1) return pivots;

  for (let i = lookback; i < prices.length - lookback; i++) {
    const p = prices[i];
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (prices[i - j] >= p) isHigh = false;
      if (prices[i + j] >= p) isHigh = false;
      if (prices[i - j] <= p) isLow = false;
      if (prices[i + j] <= p) isLow = false;
    }
    if (isHigh) pivots.push({ price: p, type: 'high', strength: lookback });
    else if (isLow) pivots.push({ price: p, type: 'low', strength: lookback });
  }
  return pivots;
}

/**
 * From a list of pivots, extract clean resistance and support levels.
 * Clusters nearby pivots (within 1% of each other) and keeps the strongest.
 */
export function extractKeyLevels(pivots: Pivot[]): { resistance: number[]; support: number[] } {
  const highs = pivots.filter(p => p.type === 'high').map(p => p.price);
  const lows = pivots.filter(p => p.type === 'low').map(p => p.price);

  const cluster = (arr: number[], tolerancePct = 0.01): number[] => {
    if (arr.length === 0) return [];
    const sorted = [...arr].sort((a, b) => a - b);
    const clusters: number[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const last = clusters[clusters.length - 1];
      const lastMean = last.reduce((a, b) => a + b, 0) / last.length;
      if (Math.abs(sorted[i] - lastMean) / lastMean <= tolerancePct) {
        last.push(sorted[i]);
      } else {
        clusters.push([sorted[i]]);
      }
    }
    return clusters.map(c => c.reduce((a, b) => a + b, 0) / c.length);
  };

  return {
    resistance: cluster(highs).slice(-5), // 5 most recent resistance levels
    support: cluster(lows).slice(-5),
  };
}

// ─── Break detection ───────────────────────────────────────────────

/**
 * Determine if the most recent price has broken any of the key levels,
 * and how strong the break was (volume + momentum confirmation).
 */
export function detectBreak(
  currentPrice: number,
  yesterdayClose: number,
  resistance: number[],
  support: number[],
  /** Recent volume / 20-day avg volume — pass 1.0 if you don't have it */
  volumeRatio = 1.0,
): { kind: 'resistance' | 'support' | null; level: number | null; strength: number } {
  // Check resistance breaks (price was below R yesterday, above R today)
  for (const r of resistance.sort((a, b) => a - b)) {
    if (yesterdayClose < r && currentPrice >= r) {
      const breakPct = ((currentPrice - r) / r) * 100;
      const strength = Math.min(100, breakPct * 10 + volumeRatio * 30);
      return { kind: 'resistance', level: r, strength };
    }
  }
  // Check support breaks (price was above S yesterday, below S today)
  for (const s of support.sort((a, b) => b - a)) {
    if (yesterdayClose > s && currentPrice <= s) {
      const breakPct = ((s - currentPrice) / s) * 100;
      const strength = Math.min(100, breakPct * 10 + volumeRatio * 30);
      return { kind: 'support', level: s, strength };
    }
  }
  return { kind: null, level: null, strength: 0 };
}
