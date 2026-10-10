/**
 * ══════════════════════════════════════════════════════════════════
 *  Bear Flag / Breakdown Scanner — the short-side mirror of "Femi's Scanner"
 * ══════════════════════════════════════════════════════════════════
 *
 * The convictions feed was 39 BULL / 1 BEAR because every upstream scanner
 * (bull-flag, bullish-trend, squeeze) only emits LONG ideas. This is the
 * symmetric short-side source so high-conviction bearish setups can rank too.
 *
 * Inverts the bull-flag DNA — we hunt distribution / breakdown continuation:
 *
 *   1. Strong prior DOWNtrend (price well below 200 SMA)
 *   2. Currently bouncing / consolidating (the "bear flag" relief rally)
 *   3. EMA stacking inverted: 20 EMA < 50 EMA (downtrend structure intact)
 *   4. RSI relieving into 40–60 zone (bounce cool-off, not reversal)
 *   5. Volume declining during the bounce (weak buying / low conviction rally)
 *   6. Down significantly from 52-week high (the prior down leg)
 *   7. Up from recent low (the bounce offers a short entry into resistance)
 *   8. MACD below zero or histogram turning negative
 *   9. Price capped below 50 SMA acting as resistance
 *  10. Tight consolidation range (Bollinger squeeze forming)
 *  11. Bear-flag shape — higher lows + flat/falling highs into resistance
 *
 * Each criterion maps to a weighted score. Total 0–100.
 * Grade: S ≥ 85, A ≥ 75, B ≥ 65, C ≥ 55, D < 55.
 *
 * Every number is computed from real Yahoo OHLCV — no fabricated levels.
 */

import { logger } from "./logger";

// ─── Result Shape ────────────────────────────────────────────────

export interface BearFlagSetup {
  symbol: string;
  currentPrice: number;
  score: number;
  grade: string;
  direction: 'short';

  // Trend context
  ema20: number;
  ema50: number;
  sma200: number;
  trendBias: 'bearish' | 'neutral';

  // Flag metrics
  priorLegPercent: number;      // how big was the prior DOWN leg
  bouncePercent: number;        // how much it has bounced off the recent low
  bounceFromLow: number;        // dollar amount above recent low
  flagDays: number;             // how many days the bear flag has been forming
  flagTightness: number;        // 0-1 — how tight the consolidation is

  // Momentum
  rsi14: number;
  macdHistogram: number;
  macdBelowZero: boolean;

  // Volume
  volumeRatio: number;          // current vs 20d avg
  flagVolumeDecline: boolean;   // volume declining during the bounce?
  avgVolume: number;

  // Levels
  entryPrice: number;
  targetPrice: number;
  targetPercent: number;
  stretchTargetPrice: number | null;
  targetRationale: string;
  stopLoss: number;
  stopLossPercent: number;
  holdDays: number;

  // Pattern description
  pattern: string;
  reason: string;
  signals: string[];
  createdAt: Date;
}

// ─── Ticker Universe ─────────────────────────────────────────────
// Same liquid universe as the bull-flag scanner — breakdowns happen in
// the exact same names that make the cleanest pullbacks.

const BEAR_FLAG_UNIVERSE = [
  // Semiconductors / Chips
  'NVDA', 'AMD', 'INTC', 'AVGO', 'QCOM', 'MU', 'MRVL', 'ON', 'AEHR', 'LRCX',
  'KLAC', 'AMAT', 'TSM', 'ASML', 'TXN', 'NXPI', 'MCHP', 'SWKS', 'QRVO',
  // Optics / Photonics
  'AAOI', 'COHR', 'IIVI', 'LITE', 'CIEN', 'INFN',
  // Software / SaaS
  'CRM', 'NOW', 'SNOW', 'PLTR', 'DDOG', 'NET', 'CRWD', 'ZS', 'MDB', 'PANW',
  'S', 'OKTA', 'HUBS', 'BILL', 'PCOR', 'CFLT', 'MNDY',
  // Consumer / Streaming / Media
  'NFLX', 'DIS', 'AMZN', 'SPOT', 'ROKU', 'PARA', 'WBD',
  // Home Goods / Consumer Discretionary
  'HD', 'LOW', 'TGT', 'COST', 'WMT', 'WSM', 'RH', 'ETSY', 'W', 'BBBY',
  // Clean Energy / EV
  'OKLO', 'TSLA', 'RIVN', 'NIO', 'XPEV', 'ENPH', 'SEDG', 'FSLR', 'RUN',
  // Financials
  'SQ', 'PYPL', 'COIN', 'SOFI', 'HOOD', 'AFRM',
  // Tech mega caps
  'AAPL', 'MSFT', 'GOOGL', 'META',
  // Biotech/Health
  'MRNA', 'LLY', 'ABBV',
  // Misc high-beta growth
  'SHOP', 'UBER', 'DKNG', 'ABNB', 'TTD', 'RBLX', 'DASH', 'ARM', 'SMCI',
];

// ─── Data Cache ──────────────────────────────────────────────────

const dailyCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 min

async function fetchDaily(symbol: string): Promise<any> {
  const cached = dailyCache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=6mo`
    );
    if (!res.ok) return null;

    const json = await res.json();
    const result = json.chart?.result?.[0];
    if (result) dailyCache.set(symbol, { data: result, ts: Date.now() });
    return result;
  } catch (err) {
    logger.error(`[BEAR-FLAG] Fetch error for ${symbol}:`, err);
    return null;
  }
}

// ─── Technical Helpers ───────────────────────────────────────────

function calcSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((s, p) => s + p, 0) / period;
}

function calcEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [prices[prices.length - 1] || 0];
  const ema: number[] = [];
  const mult = 2 / (period + 1);
  const sma = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(sma);
  for (let i = period; i < prices.length; i++) {
    ema.push((prices[i] - ema[ema.length - 1]) * mult + ema[ema.length - 1]);
  }
  return ema;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  if (prices.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const fast = calcEMA(prices, 12);
  const slow = calcEMA(prices, 26);
  const offset = 26 - 12; // 14
  const macdLine: number[] = [];
  for (let i = 0; i < slow.length; i++) {
    macdLine.push(fast[i + offset] - slow[i]);
  }
  const signalLine = calcEMA(macdLine, 9);
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { macd, signal, histogram: macd - signal };
}

function calcBollingerWidth(closes: number[], period = 20): number {
  if (closes.length < period) return 1;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, v) => a + (v - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = mean + 2 * stdDev;
  const lower = mean - 2 * stdDev;
  return mean > 0 ? (upper - lower) / mean : 1; // normalized width
}

// ─── Pattern Detection ───────────────────────────────────────────

interface FlagAnalysis {
  hasPriorDowntrend: boolean;
  priorLegPercent: number;      // size of the prior DOWN leg (positive %)
  bouncePercent: number;        // how far it has rallied off the recent low
  bounceFromLow: number;        // dollar amount above recent low
  flagDays: number;
  flagTightness: number;        // 0-1, higher = tighter
  higherLowsLowerFlat: boolean; // classic bear-flag shape (rising lows into capped highs)
  volumeDeclining: boolean;
  highFromHigh52: number;       // % below 52wk high (depth of damage)
  lowFromLow52: number;         // % above recent low
}

function analyzeFlag(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[]
): FlagAnalysis {
  const n = closes.length;
  const current = closes[n - 1];

  // 52-week (window) high/low
  const allHigh = Math.max(...highs);
  const allLow = Math.min(...lows.filter(l => l > 0));
  const highFromHigh52 = allHigh > 0 ? ((allHigh - current) / allHigh) * 100 : 0;
  const lowFromLow52 = allLow > 0 ? ((current - allLow) / allLow) * 100 : 0;

  // Find the recent swing LOW (lowest close in last 60 days) — the bottom
  // of the prior down leg, off which the bear-flag bounce forms.
  const lookback = Math.min(60, n);
  const recentLowIdx = closes.slice(-lookback).reduce(
    (minIdx, v, i) => v < closes[n - lookback + minIdx] ? i : minIdx,
    0
  );
  const recentLow = closes[n - lookback + recentLowIdx];
  const daysSinceLow = lookback - recentLowIdx - 1;

  // Prior downtrend: from the high before the recent low
  const priorSlice = closes.slice(Math.max(0, n - lookback), n - lookback + recentLowIdx + 1);
  const priorHigh = priorSlice.length > 0 ? Math.max(...priorSlice) : current;
  const priorLegPercent = priorHigh > 0 ? ((priorHigh - recentLow) / priorHigh) * 100 : 0;
  const hasPriorDowntrend = priorLegPercent > 10; // at least 10% prior decline

  // Bounce off the recent low
  const bouncePercent = recentLow > 0 ? ((current - recentLow) / recentLow) * 100 : 0;
  const bounceFromLow = current - recentLow;

  // Flag days = days since low
  const flagDays = daysSinceLow;

  // Flag tightness: range of last `flagDays` bars relative to price
  const flagSlice = Math.min(flagDays || 5, 20);
  const flagHighs = highs.slice(-flagSlice);
  const flagLows = lows.slice(-flagSlice);
  const flagRange = flagHighs.length > 0
    ? Math.max(...flagHighs) - Math.min(...flagLows.filter(l => l > 0))
    : current * 0.1;
  const flagTightness = current > 0
    ? Math.max(0, 1 - (flagRange / current) * 10)
    : 0;

  // Higher lows pattern during the bounce (rising-lows bear-flag channel)
  let higherLowCount = 0;
  const flagBarLows = lows.slice(-(Math.min(flagSlice, 10)));
  for (let i = 1; i < flagBarLows.length; i++) {
    if (flagBarLows[i] > flagBarLows[i - 1]) higherLowCount++;
  }
  const higherLowsLowerFlat = higherLowCount >= Math.floor(flagBarLows.length * 0.5);

  // Volume declining during the bounce vs the prior down leg
  const flagVols = volumes.slice(-flagSlice);
  const priorVols = volumes.slice(-(flagSlice * 2), -flagSlice);
  const avgFlagVol = flagVols.length > 0
    ? flagVols.reduce((a, b) => a + b, 0) / flagVols.length
    : 0;
  const avgPriorVol = priorVols.length > 0
    ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length
    : avgFlagVol;
  const volumeDeclining = avgFlagVol < avgPriorVol * 0.85; // 15%+ lower vol on bounce

  return {
    hasPriorDowntrend,
    priorLegPercent,
    bouncePercent,
    bounceFromLow,
    flagDays,
    flagTightness,
    higherLowsLowerFlat,
    volumeDeclining,
    highFromHigh52,
    lowFromLow52,
  };
}

// ─── Scoring Engine ──────────────────────────────────────────────
// Mirror of the bull-flag weights — each criterion totals 0–100.

function scoreBearFlag(
  flag: FlagAnalysis,
  rsi: number,
  macdBelowZero: boolean,
  macdHistTurningDown: boolean,
  emaStackingDown: boolean,     // EMA20 < EMA50
  priceBelowSMA50: boolean,
  priceBelowSMA200: boolean,
  bollingerWidth: number,
): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];

  // 1. Prior downtrend (max 15 pts)
  if (flag.hasPriorDowntrend) {
    if (flag.priorLegPercent > 30) { score += 15; signals.push(`Strong prior down leg (-${flag.priorLegPercent.toFixed(0)}%)`); }
    else if (flag.priorLegPercent > 20) { score += 12; signals.push(`Solid prior down leg (-${flag.priorLegPercent.toFixed(0)}%)`); }
    else if (flag.priorLegPercent > 10) { score += 8; signals.push(`Prior downtrend (-${flag.priorLegPercent.toFixed(0)}%)`); }
  }

  // 2. Bounce depth — sweet spot is 5-20% relief rally (max 12 pts)
  if (flag.bouncePercent >= 5 && flag.bouncePercent <= 20) {
    score += 12;
    signals.push(`Healthy relief bounce (+${flag.bouncePercent.toFixed(1)}%)`);
  } else if (flag.bouncePercent > 2 && flag.bouncePercent < 5) {
    score += 6;
    signals.push(`Shallow bounce (+${flag.bouncePercent.toFixed(1)}%)`);
  } else if (flag.bouncePercent > 20 && flag.bouncePercent <= 30) {
    score += 4;
    signals.push(`Extended bounce (+${flag.bouncePercent.toFixed(1)}%)`);
  }

  // 3. EMA stacking inverted: 20 < 50 (max 12 pts)
  if (emaStackingDown) {
    score += 12;
    signals.push('EMA 20 < EMA 50 (downtrend intact)');
  }

  // 4. RSI 40-60 sweet spot — bounce cooling, not reversing (max 10 pts)
  if (rsi >= 40 && rsi <= 60) {
    score += 10;
    signals.push(`RSI relieving (${rsi.toFixed(0)})`);
  } else if (rsi > 60 && rsi <= 65) {
    score += 6;
    signals.push(`RSI near overbought bounce (${rsi.toFixed(0)})`);
  } else if (rsi >= 35 && rsi < 40) {
    score += 5;
    signals.push(`RSI still weak (${rsi.toFixed(0)})`);
  }

  // 5. Volume declining during the bounce (max 10 pts)
  if (flag.volumeDeclining) {
    score += 10;
    signals.push('Volume declining on bounce (weak buying)');
  }

  // 6. Down from 52-week high — damage already done (max 8 pts)
  if (flag.highFromHigh52 > 30) {
    score += 8;
    signals.push(`-${flag.highFromHigh52.toFixed(0)}% from 52wk high`);
  } else if (flag.highFromHigh52 > 15) {
    score += 5;
    signals.push(`-${flag.highFromHigh52.toFixed(0)}% from 52wk high`);
  }

  // 7. MACD below zero or histogram turning negative (max 8 pts)
  if (macdBelowZero && macdHistTurningDown) {
    score += 8;
    signals.push('MACD below zero + histogram turning down');
  } else if (macdBelowZero) {
    score += 5;
    signals.push('MACD below zero');
  } else if (macdHistTurningDown) {
    score += 4;
    signals.push('MACD histogram turning negative');
  }

  // 8. Price below 50 SMA — capped by resistance (max 8 pts)
  if (priceBelowSMA50) {
    score += 8;
    signals.push('Capped below 50 SMA');
  }

  // 9. Price below 200 SMA — overall downtrend (max 7 pts)
  if (priceBelowSMA200) {
    score += 7;
    signals.push('Below 200 SMA (long-term downtrend)');
  }

  // 10. Bollinger squeeze / tight consolidation (max 5 pts)
  if (bollingerWidth < 0.08) {
    score += 5;
    signals.push('Bollinger squeeze (tight range)');
  } else if (bollingerWidth < 0.12) {
    score += 3;
    signals.push('Narrowing Bollinger bands');
  }

  // 11. Bear-flag shape — higher lows into capped highs (max 5 pts)
  if (flag.higherLowsLowerFlat && flag.flagDays >= 3) {
    score += 5;
    signals.push(`Classic bear-flag shape (${flag.flagDays} days)`);
  }

  return { score: Math.min(100, score), signals };
}

/**
 * A prior cycle low is useful context, but it is usually too far away to call
 * the first take-profit after a large relief bounce.  The first target is the
 * nearest confirmed pivot support beneath spot; the cycle low remains a
 * labelled stretch objective so the UI can show the full thesis without
 * pretending the whole move is equally likely.
 */
export function selectBearFlagTargets(
  lows: number[],
  currentPrice: number,
  priorCycleLow: number,
): Pick<BearFlagSetup, 'targetPrice' | 'targetPercent' | 'stretchTargetPrice' | 'targetRationale'> {
  const windowStart = Math.max(2, lows.length - 45);
  const pivots: number[] = [];

  for (let i = windowStart; i < lows.length - 2; i++) {
    const price = lows[i];
    if (!Number.isFinite(price) || price <= 0 || price >= currentPrice) continue;

    const isPivot =
      price < lows[i - 1] &&
      price < lows[i - 2] &&
      price <= lows[i + 1] &&
      price <= lows[i + 2];
    const distancePercent = ((currentPrice - price) / currentPrice) * 100;

    // Ignore tiny one-day noise immediately beneath spot. A first target
    // should represent a tradable support test, not the next few cents.
    if (isPivot && distancePercent >= 1) pivots.push(price);
  }

  const supportsBeforeCycleLow = pivots
    .filter((price) => price > priorCycleLow)
    .sort((a, b) => b - a);
  const targetPrice = supportsBeforeCycleLow[0] ?? priorCycleLow;
  const targetPercent = ((currentPrice - targetPrice) / currentPrice) * 100;
  const stretchTargetPrice = targetPrice > priorCycleLow * 1.01 ? priorCycleLow : null;

  return {
    targetPrice,
    targetPercent,
    stretchTargetPrice,
    targetRationale: supportsBeforeCycleLow.length > 0
      ? 'Nearest confirmed swing support'
      : 'Prior cycle low — no nearer confirmed support',
  };
}

// ─── Main Scanner ────────────────────────────────────────────────

export async function scanBearFlagBreakdowns(): Promise<BearFlagSetup[]> {
  /**
   * Scan the liquid universe, not a hand-typed list.
   *
   * An audit of all 23 producers found 20 capped to hand-written arrays while
   * the 2,000-name liquid universe sat loaded in memory. ORCL was the case that
   * exposed it: on the core watchlist, 180 sessions of bars available, and zero
   * ideas in the platform's history — never rejected, never evaluated, because
   * nobody had typed it into an array.
   *
   * The hand list is unioned in, so nothing that used to be scanned drops out
   * when the universe is cold.
   */
  let bearUniverse: string[] = [...BEAR_FLAG_UNIVERSE];
  try {
    const { getLiquidSymbols, loadLiquidUniverseFromDisk } = await import('./liquid-universe');
    if (getLiquidSymbols().length === 0) await loadLiquidUniverseFromDisk();
    const liquid = getLiquidSymbols();
    if (liquid.length > 0) {
      bearUniverse = Array.from(new Set([...BEAR_FLAG_UNIVERSE, ...liquid].map((x) => x.toUpperCase())));
    }
  } catch { /* cold universe — the hand list still scans */ }
  logger.info(`[BEAR-FLAG] 🐻 Scanning ${bearUniverse.length} tickers for bear flag breakdowns...`);

  const results: BearFlagSetup[] = [];
  const funnel = { data: 0, downtrend: 0, bounce: 0, scored: 0 };

  // Use the same grouped-daily source as the bullish scanner. The old path
  // made one Yahoo request per symbol; a 429 then looked exactly like "no bear
  // setups" and biased the board bullish. Grouped bars cover the entire liquid
  // universe with the same data used by research/backtests.
  let uniBars: Map<string, { open: number; high: number; low: number; close: number; volume: number }[]> = new Map();
  try {
    const { getUniverseBars, loadLiquidUniverseFromDisk, getLiquidSymbols } = await import('./liquid-universe');
    if (getLiquidSymbols().length === 0) await loadLiquidUniverseFromDisk();
    uniBars = await getUniverseBars(180) as any;
    logger.info(`[BEAR-FLAG] bars from liquid universe for ${uniBars.size} names`);
  } catch (e: any) {
    logger.warn(`[BEAR-FLAG] universe bars unavailable (${e?.message ?? e}) — falling back to Yahoo per symbol`);
  }

  for (const symbol of bearUniverse) {
    try {
      let closes: number[] = [];
      let highs: number[] = [];
      let lows: number[] = [];
      let volumes: number[] = [];
      const ub = uniBars.get(symbol.toUpperCase());
      if (ub && ub.length >= 50) {
        closes = ub.map((b) => b.close).filter((p) => p != null);
        highs = ub.map((b) => b.high).filter((p) => p != null);
        lows = ub.map((b) => b.low).filter((p) => p != null);
        volumes = ub.map((b) => b.volume).filter((v) => v != null);
      } else {
        const data = await fetchDaily(symbol);
        if (!data) continue;
        const quotes = data.indicators?.quote?.[0];
        closes = (quotes?.close || []).filter((p: any) => p != null);
        highs = (quotes?.high || []).filter((p: any) => p != null);
        lows = (quotes?.low || []).filter((p: any) => p != null);
        volumes = (quotes?.volume || []).filter((v: any) => v != null);
      }
      funnel.data++;

      if (closes.length < 50) continue;

      const currentPrice = closes[closes.length - 1];
      if (currentPrice <= 0) continue;

      // ── Compute indicators ──
      const ema20Arr = calcEMA(closes, 20);
      const ema50Arr = calcEMA(closes, 50);
      const ema20 = ema20Arr[ema20Arr.length - 1];
      const ema50 = ema50Arr[ema50Arr.length - 1];
      const sma200 = calcSMA(closes, Math.min(200, closes.length));
      const sma50 = calcSMA(closes, 50);
      const rsi14 = calcRSI(closes);
      const macd = calcMACD(closes);
      const bollingerWidth = calcBollingerWidth(closes);

      // ── Flag analysis ──
      const flag = analyzeFlag(closes, highs, lows, volumes);

      // ── Quick gate: skip if no prior downtrend or bounce too small/large ──
      if (!flag.hasPriorDowntrend) continue;
      funnel.downtrend++;
      if (flag.bouncePercent < 2 || flag.bouncePercent > 35) continue;
      funnel.bounce++;

      // ── Volume ──
      const currentVol = volumes[volumes.length - 1] || 0;
      const avgVol = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
      const volumeRatio = avgVol > 0 ? currentVol / avgVol : 1;

      // ── Score ──
      const { score, signals } = scoreBearFlag(
        flag,
        rsi14,
        macd.macd < 0,
        macd.histogram < 0, // turning negative
        ema20 < ema50,
        currentPrice < sma50,
        currentPrice < sma200,
        bollingerWidth,
      );

      // Only keep setups scoring ≥ 45
      if (score < 45) continue;
      funnel.scored++;

      // ── Grade ──
      let grade = 'D';
      if (score >= 85) grade = 'S';
      else if (score >= 75) grade = 'A';
      else if (score >= 65) grade = 'B';
      else if (score >= 55) grade = 'C';

      // ── Structural target hierarchy ──────────────────────────────────────
      // The low that started the relief bounce is a continuation objective,
      // not automatically T1. Use the nearest confirmed support first and keep
      // the old cycle low as stretch context.
      const priorCycleLow = currentPrice - flag.bounceFromLow;
      const {
        targetPrice,
        targetPercent,
        stretchTargetPrice,
        targetRationale,
      } = selectBearFlagTargets(lows, currentPrice, priorCycleLow);

      // Stop: above the flag high (bounce resistance)
      const flagHighs = highs.slice(-(Math.min(flag.flagDays || 5, 15)));
      const flagHigh = flagHighs.length > 0 ? Math.max(...flagHighs) : currentPrice * 1.05;
      const stopLoss = flagHigh * 1.01; // tiny buffer above flag high
      const stopLossPercent = ((stopLoss - currentPrice) / currentPrice) * 100;

      // Hold time based on flag duration
      const holdDays = Math.max(3, Math.min(15, Math.round(flag.flagDays * 0.7)));

      // Build reason string
      const reason = signals.slice(0, 4).join(' · ');

      // Trend bias
      const trendBias = (ema20 < ema50 && currentPrice < sma200) ? 'bearish' as const : 'neutral' as const;

      results.push({
        symbol,
        currentPrice,
        score,
        grade,
        direction: 'short',
        ema20,
        ema50,
        sma200,
        trendBias,
        priorLegPercent: flag.priorLegPercent,
        bouncePercent: flag.bouncePercent,
        bounceFromLow: flag.bounceFromLow,
        flagDays: flag.flagDays,
        flagTightness: flag.flagTightness,
        rsi14,
        macdHistogram: macd.histogram,
        macdBelowZero: macd.macd < 0,
        volumeRatio,
        flagVolumeDecline: flag.volumeDeclining,
        avgVolume: avgVol,
        entryPrice: currentPrice,
        targetPrice,
        targetPercent,
        stretchTargetPrice,
        targetRationale,
        stopLoss,
        stopLossPercent,
        holdDays,
        pattern: 'bear_flag_breakdown',
        reason,
        signals,
        createdAt: new Date(),
      });

    } catch (err) {
      logger.error(`[BEAR-FLAG] Error on ${symbol}:`, err);
    }

    // Rate limit Yahoo — slightly more conservative than the bull scanner so a
    // back-to-back bull+bear sweep doesn't trip Yahoo's 429 throttle.
    await new Promise(r => setTimeout(r, 150));
  }

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  logger.info(
    `[BEAR-FLAG] ✅ Found ${results.length} bear flag breakdown setups ` +
    `(funnel: data=${funnel.data} → downtrend=${funnel.downtrend} → bounce=${funnel.bounce} → scored≥45=${funnel.scored})`
  );
  return results;
}

/**
 * Get top bear flag opportunities — main export for API route
 */
export async function getTopBearFlagSetups(limit = 15): Promise<BearFlagSetup[]> {
  const all = await scanBearFlagBreakdowns();
  return all.slice(0, limit);
}

/**
 * Auto-ingest high-scoring bear flag setups to Trade Desk.
 * A fresh bounce that's just rolling over (short flag, RSI cresting) is tagged
 * 'day'; an established multi-day bear flag is 'swing' — so the convictions feed
 * carries both intraday and multi-day short ideas.
 */
export async function ingestBearFlagIdeas(): Promise<number> {
  try {
    const setups = await getTopBearFlagSetups(10);
    const { ingestTradeIdea } = await import("./trade-idea-ingestion");
    // SHORT DISCIPLINE — the same gate quant-ideas-generator applies, which this
    // producer was walking straight past. A bear flag is a PATTERN, not an event:
    // the operator's rule is no shorts without a dated catalyst ("that's how u
    // get burnt"), and the live book proved the hole — META was carrying a
    // pattern-short PUT while gapping UP pre-market. Every bearish idea now
    // needs a real catalyst row for its symbol, with the BTC-proxy carve-out
    // handled inside passesShortDiscipline.
    const { passesShortDiscipline, isSubstantiveEventCatalyst } = await import("./short-discipline");
    const { storage } = await import("./storage");
    let activeCatalysts: { symbol?: string | null; impact?: string | null }[] = [];
    try { activeCatalysts = await storage.getActiveCatalysts(); } catch { /* no catalyst feed → every short fails the gate, which is the safe side */ }
    let disciplineRejected = 0;
    let ingested = 0;

    for (const setup of setups) {
      const hasEventCatalyst = activeCatalysts.some(
        (c) => c.symbol?.toUpperCase() === setup.symbol.toUpperCase()
          // A mention is not an event — only impact:'high' rows qualify.
          && isSubstantiveEventCatalyst(c as any),
      );
      if (!passesShortDiscipline({ symbol: setup.symbol, direction: 'short', hasEventCatalyst, btcChangePercent: null })) {
        disciplineRejected++;
        continue;
      }
      // Bearish setups are structurally rarer and score lower in a bull tape
      // than long pullbacks, so the short side uses a C-grade gate (≥55) vs the
      // bull scanner's B-gate (≥65). They still enter the feed at their TRUE
      // (lower) conviction tier — the convictions engine bands grade them
      // honestly, never inflated to "elite". Sorted desc, so stop at first miss.
      if (setup.score < 55) break;

      // Fresh, tight bounce that's cresting → day trade; otherwise swing.
      const holdingPeriod: 'day' | 'swing' =
        setup.flagDays <= 3 && setup.rsi14 >= 55 ? 'day' : 'swing';

      try {
        // Keep the pattern evidence atomic.  `bear_flag_0` / `bear_flag_1`
        // made the UI say "bear flag" repeatedly while hiding whether the
        // actual support was trend, momentum, volume, or structure.  These are
        // still all derived from the same OHLCV feed; the convictions engine
        // must earn cross-source convergence later from sector, GEX, breadth,
        // catalyst, etc.  A long checklist is not independent confirmation.
        const evidence = buildBearishEvidence(setup);
        const result = await ingestTradeIdea({
          source: 'market_scanner',
          symbol: setup.symbol,
          assetType: 'stock',
          direction: 'bearish',
          signals: evidence,
          holdingPeriod,
          currentPrice: setup.currentPrice,
          targetPrice: setup.targetPrice,
          stopLoss: setup.stopLoss,
          catalyst: `🐻 Bear Flag Breakdown · pattern quality ${setup.score}/100 (${setup.grade}). ${setup.reason}`,
          analysis: `Bear flag pattern detected. Prior down leg: -${setup.priorLegPercent.toFixed(0)}%, bounce: +${setup.bouncePercent.toFixed(1)}%. ` +
            `RSI: ${setup.rsi14.toFixed(0)}, EMA stacking: ${setup.ema20 < setup.ema50 ? 'bearish (20<50)' : 'neutral'}. ` +
            `First support: $${setup.targetPrice.toFixed(2)} (${setup.targetRationale}). ` +
            (setup.stretchTargetPrice ? `Prior cycle-low stretch: $${setup.stretchTargetPrice.toFixed(2)}. ` : '') +
            `Signals: ${setup.signals.join(', ')}`,
          convergenceAnalysis: {
            signals: evidence.map((signal) => ({
              // One source on purpose: these are distinct technical tests,
              // but not independent data sources.
              source: 'daily_ohlcv',
              type: signal.type,
              direction: 'bearish' as const,
              weight: signal.weight,
              confidence: setup.score,
              description: signal.description,
              data: signal.data,
              timestamp: new Date().toISOString(),
            })),
            convergenceScore: setup.score,
            signalCount: evidence.length,
            primaryThesis: `Bearish continuation candidate: ${setup.reason}`,
            technicalSummary: `Prior leg -${setup.priorLegPercent.toFixed(0)}%, relief bounce +${setup.bouncePercent.toFixed(1)}%, RSI ${setup.rsi14.toFixed(0)}.`,
            riskFactors: [
              'This is a daily-chart thesis, not an executed breakdown.',
              'A fresh rejection or close below the flag floor is required before entry.',
            ],
            keyLevels: [
              { type: 'entry_context', price: setup.entryPrice, label: 'Scanner reference' },
              { type: 'first_support', price: setup.targetPrice, label: setup.targetRationale },
              ...(setup.stretchTargetPrice
                ? [{ type: 'continuation_objective', price: setup.stretchTargetPrice, label: 'Prior cycle low · stretch, not T1' }]
                : []),
              { type: 'invalidation', price: setup.stopLoss, label: 'Flag-high invalidation' },
            ],
            generatedAt: new Date().toISOString(),
          },
        });
        if (result.success) ingested++;
      } catch {
        // Dedup gate blocked — expected
      }
    }

    if (ingested > 0) {
      logger.info(`[BEAR-FLAG] 📤 Auto-ingested ${ingested} bear flag setups to Trade Desk`);
    }
    if (disciplineRejected > 0) logger.info(`[BearFlag] short discipline rejected ${disciplineRejected} pattern-shorts with no dated catalyst`);
    return ingested;
  } catch (err) {
    logger.error('[BEAR-FLAG] Ingest error:', err);
    return 0;
  }
}

/**
 * Translate each observed bear-flag criterion into a stable, inspectable
 * evidence item. We deliberately do not use the scanner's aggregate /100 as
 * the weight for every item: that duplicated the same score 8–11 times and
 * created an inflated confidence number.
 */
function buildBearishEvidence(setup: BearFlagSetup): Array<{
  type: string;
  weight: number;
  description: string;
  data?: Record<string, number | boolean>;
}> {
  return setup.signals.flatMap((description) => {
    if (/prior down leg|prior downtrend/i.test(description)) {
      return [{ type: 'BEAR_TREND_STRUCTURE', weight: 5, description, data: { priorLegPercent: setup.priorLegPercent } }];
    }
    if (/relief bounce|shallow bounce|extended bounce/i.test(description)) {
      return [{ type: 'BEAR_RELIEF_RALLY', weight: 4, description, data: { bouncePercent: setup.bouncePercent } }];
    }
    if (/EMA 20 < EMA 50/i.test(description)) {
      return [{ type: 'BEAR_EMA_STACK', weight: 4, description, data: { ema20BelowEma50: true } }];
    }
    if (/RSI /i.test(description)) {
      return [{ type: 'BEAR_RSI_RESET', weight: 3, description, data: { rsi14: setup.rsi14 } }];
    }
    if (/Volume declining/i.test(description)) {
      return [{ type: 'BEAR_DISTRIBUTION_VOLUME', weight: 4, description, data: { volumeDeclining: setup.flagVolumeDecline } }];
    }
    if (/52wk high/i.test(description)) {
      return [{ type: 'BEAR_52W_DAMAGE', weight: 3, description }];
    }
    if (/MACD/i.test(description)) {
      return [{ type: 'MACD_BEARISH_CROSS', weight: 4, description, data: { macdBelowZero: setup.macdBelowZero, histogram: setup.macdHistogram } }];
    }
    if (/50 SMA/i.test(description)) {
      return [{ type: 'RESISTANCE_REJECTION', weight: 4, description }];
    }
    if (/200 SMA/i.test(description)) {
      return [{ type: 'BEAR_LONG_TERM_TREND', weight: 4, description }];
    }
    if (/Bollinger/i.test(description)) {
      return [{ type: 'BEAR_COMPRESSION', weight: 3, description }];
    }
    if (/bear-flag shape/i.test(description)) {
      return [{ type: 'BEAR_FLAG', weight: 4, description, data: { flagDays: setup.flagDays, tightness: setup.flagTightness } }];
    }
    // A new criterion should remain visible rather than silently disappearing.
    return [{ type: 'BEAR_TECHNICAL_CONTEXT', weight: 2, description }];
  });
}
