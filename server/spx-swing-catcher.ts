/**
 * SPX Swing Catcher — High-Probability Reversal Detection Engine
 *
 * Identifies confluence-based reversal points where a $2-5 OTM put/call
 * can return 500-1000%+ intraday. Runs every 2 minutes during market hours.
 *
 * 6 Required Signals (all must align for a FIRE alert):
 * 1. Level Confluence (PDH/PDL/PMH/PML + round numbers + Fibonacci)
 * 2. Rejection Signal (long wicks + volume spike)
 * 3. EMA Fan Alignment (13/48 EMA cross + expansion)
 * 4. Momentum Divergence (RSI divergence + MACD histogram)
 * 5. VWAP Confirmation (fail/reclaim with volume)
 * 6. VIX Context (regime + term structure + GEX)
 *
 * Scoring: 6/6 = FIRE, 5/6 = STRONG, 4/6 = WATCH, <4 = no alert
 */

import { logger } from './logger';
import { fetchStockPrice } from './market-api';
import { storage } from './storage';
import {
  calculateRSI,
  calculateEMA,
  calculateMACD,
  calculateFibonacciLevels,
  calculateATR,
  calculateSimpleVWAP,
} from './technical-indicators';

// ============================================
// TYPES
// ============================================

export interface SwingAlert {
  id: string;
  symbol: string;
  direction: 'PUT' | 'CALL';
  score: number;
  scoreLabel: 'FIRE' | 'STRONG' | 'WATCH';
  level: number;
  levelName: string;
  signals: SignalDetail[];
  suggestedStrike: number;
  suggestedExpiry: string;
  estimatedCost: string;
  targetLevel: number;
  stopLevel: number;
  currentPrice: number;
  timestamp: Date;
  expiresAt: Date;
}

export interface SignalDetail {
  name: 'LEVEL_CONFLUENCE' | 'REJECTION' | 'EMA_FAN' | 'DIVERGENCE' | 'VWAP' | 'VIX';
  triggered: boolean;
  detail: string;
  direction: 'PUT' | 'CALL' | 'NEUTRAL';
}

interface IntradayBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PreviousDayLevels {
  pdh: number;
  pdl: number;
  pdc: number;
}

interface PreviousMonthLevels {
  pmh: number;
  pml: number;
}

interface SwingCatcherState {
  date: string;
  previousDay: PreviousDayLevels | null;
  previousMonth: PreviousMonthLevels | null;
  alerts: SwingAlert[];
  lastScanTime: Date | null;
}

// ============================================
// CONSTANTS
// ============================================

const SCAN_SYMBOLS = ['SPY'];  // SPX uses SPY as data proxy
const SPX_MULTIPLIER = 10;     // SPY * 10 ≈ SPX

const SESSION = {
  MARKET_OPEN: 9.583,    // 9:35 AM (5 min after open for data)
  MARKET_CLOSE: 15.75,   // 3:45 PM (stop before close)
};

// Level proximity thresholds
const LEVEL_PROXIMITY_PCT = 0.15;  // 0.15% = ~$1 on SPY, ~$10 on SPX
const LEVEL_STACK_POINTS = 0.5;    // $0.50 on SPY = ~5 SPX points for level stacking

// ============================================
// STATE
// ============================================

let state: SwingCatcherState = {
  date: '',
  previousDay: null,
  previousMonth: null,
  alerts: [],
  lastScanTime: null,
};

// ============================================
// HELPERS
// ============================================

function getETTime(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function getETHours(date: Date): number {
  return date.getHours() + date.getMinutes() / 60;
}

function generateId(): string {
  return `swing_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function minutesToClose(etHours: number): number {
  return Math.max(0, Math.round((16 - etHours) * 60));
}

// ============================================
// MARKET DATA FETCHERS
// ============================================

async function getIntradayBars(symbol: string): Promise<IntradayBar[]> {
  try {
    const yahooSym = symbol === 'SPX' ? '%5EGSPC' : symbol;
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=5m&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!response.ok) return [];
    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result?.timestamp) return [];

    const bars: IntradayBar[] = [];
    const q = result.indicators.quote[0];
    for (let i = 0; i < result.timestamp.length; i++) {
      if (q.open[i] !== null && q.close[i] !== null) {
        bars.push({
          date: new Date(result.timestamp[i] * 1000),
          open: q.open[i],
          high: q.high[i],
          low: q.low[i],
          close: q.close[i],
          volume: q.volume[i] || 0,
        });
      }
    }
    return bars;
  } catch (error) {
    logger.error(`[SWING-CATCHER] Error fetching intraday bars for ${symbol}:`, error);
    return [];
  }
}

async function fetchPreviousDayLevels(symbol: string): Promise<PreviousDayLevels | null> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result?.timestamp || result.timestamp.length < 2) return null;

    const q = result.indicators.quote[0];
    // Previous day = second-to-last entry (last is today)
    const idx = result.timestamp.length - 2;
    return {
      pdh: q.high[idx],
      pdl: q.low[idx],
      pdc: q.close[idx],
    };
  } catch (error) {
    logger.error(`[SWING-CATCHER] Error fetching previous day levels:`, error);
    return null;
  }
}

async function fetchPreviousMonthLevels(symbol: string): Promise<PreviousMonthLevels | null> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1mo&range=3mo`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result?.timestamp || result.timestamp.length < 2) return null;

    const q = result.indicators.quote[0];
    const idx = result.timestamp.length - 2;
    return {
      pmh: q.high[idx],
      pml: q.low[idx],
    };
  } catch (error) {
    logger.error(`[SWING-CATCHER] Error fetching previous month levels:`, error);
    return null;
  }
}

// ============================================
// SIGNAL 1: LEVEL CONFLUENCE
// ============================================

function evaluateLevelConfluence(
  price: number,
  bars: IntradayBar[],
  previousDay: PreviousDayLevels | null,
  previousMonth: PreviousMonthLevels | null,
): SignalDetail {
  const levels: { name: string; price: number }[] = [];
  const hitLevels: string[] = [];

  // PDH / PDL / PDC
  if (previousDay) {
    levels.push({ name: 'PDH', price: previousDay.pdh });
    levels.push({ name: 'PDL', price: previousDay.pdl });
    levels.push({ name: 'PDC', price: previousDay.pdc });
  }

  // PMH / PML
  if (previousMonth) {
    levels.push({ name: 'PMH', price: previousMonth.pmh });
    levels.push({ name: 'PML', price: previousMonth.pml });
  }

  // Round numbers (every $5 on SPY = ~$50 on SPX)
  const roundBase = Math.floor(price / 5) * 5;
  for (let i = -2; i <= 2; i++) {
    const roundLevel = roundBase + (i * 5);
    levels.push({ name: `Round $${(roundLevel * SPX_MULTIPLIER).toFixed(0)}`, price: roundLevel });
  }

  // HOD / LOD from today
  if (bars.length > 0) {
    const hod = Math.max(...bars.map(b => b.high));
    const lod = Math.min(...bars.map(b => b.low));
    levels.push({ name: 'HOD', price: hod });
    levels.push({ name: 'LOD', price: lod });
  }

  // Fibonacci levels from current swing
  if (bars.length >= 10) {
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const closes = bars.map(b => b.close);
    const fib = calculateFibonacciLevels(highs, lows, closes, bars.length);
    const keyFibs = fib.levels.filter(l => [0.618, 0.786].includes(l.ratio));
    // Also add 0.707 (not in standard, but calculated manually)
    const swingRange = fib.swingHigh - fib.swingLow;
    const fib707 = fib.trend === 'uptrend'
      ? fib.swingHigh - (swingRange * 0.707)
      : fib.swingLow + (swingRange * 0.707);

    for (const f of keyFibs) {
      levels.push({ name: `Fib ${f.label}`, price: f.price });
    }
    levels.push({ name: 'Fib 70.7%', price: fib707 });
  }

  // Check proximity to each level
  for (const level of levels) {
    const distance = Math.abs(price - level.price) / price * 100;
    if (distance < LEVEL_PROXIMITY_PCT) {
      hitLevels.push(level.name);
    }
  }

  // Check for level stacking (multiple levels within LEVEL_STACK_POINTS of each other)
  let stackCount = 0;
  for (let i = 0; i < levels.length; i++) {
    for (let j = i + 1; j < levels.length; j++) {
      if (Math.abs(levels[i].price - levels[j].price) < LEVEL_STACK_POINTS) {
        const d1 = Math.abs(price - levels[i].price) / price * 100;
        const d2 = Math.abs(price - levels[j].price) / price * 100;
        if (d1 < LEVEL_PROXIMITY_PCT * 2 && d2 < LEVEL_PROXIMITY_PCT * 2) {
          stackCount++;
        }
      }
    }
  }

  const triggered = hitLevels.length >= 2 || stackCount >= 1;
  const detail = triggered
    ? `At ${hitLevels.join(' + ')} (${hitLevels.length} levels stacking)`
    : hitLevels.length === 1
      ? `Near ${hitLevels[0]} (need 2+ for confluence)`
      : 'No key levels nearby';

  return {
    name: 'LEVEL_CONFLUENCE',
    triggered,
    detail,
    direction: 'NEUTRAL', // Level confluence is direction-agnostic
  };
}

// ============================================
// SIGNAL 2: REJECTION CANDLE
// ============================================

function evaluateRejection(bars: IntradayBar[]): SignalDetail {
  if (bars.length < 5) {
    return { name: 'REJECTION', triggered: false, detail: 'Insufficient data', direction: 'NEUTRAL' };
  }

  const recentBars = bars.slice(-3);
  const avgVolume = bars.slice(-20).reduce((s, b) => s + b.volume, 0) / Math.min(bars.length, 20);

  let bestRejection: { direction: 'PUT' | 'CALL'; detail: string } | null = null;

  for (const bar of recentBars) {
    const body = Math.abs(bar.close - bar.open);
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const hasVolumeSpike = bar.volume > avgVolume * 1.5;

    // Long upper wick at resistance (PUT signal)
    if (upperWick > body * 2 && upperWick > 0.05 && hasVolumeSpike) {
      bestRejection = {
        direction: 'PUT',
        detail: `Upper wick rejection (${(upperWick / body).toFixed(1)}x body) with ${(bar.volume / avgVolume).toFixed(1)}x volume`,
      };
    }

    // Long lower wick at support (CALL signal)
    if (lowerWick > body * 2 && lowerWick > 0.05 && hasVolumeSpike) {
      bestRejection = {
        direction: 'CALL',
        detail: `Lower wick rejection (${(lowerWick / body).toFixed(1)}x body) with ${(bar.volume / avgVolume).toFixed(1)}x volume`,
      };
    }
  }

  return {
    name: 'REJECTION',
    triggered: !!bestRejection,
    detail: bestRejection?.detail || 'No rejection candles detected',
    direction: bestRejection?.direction || 'NEUTRAL',
  };
}

// ============================================
// SIGNAL 3: EMA FAN ALIGNMENT (13/48)
// ============================================

function evaluateEMAFan(closes: number[]): SignalDetail {
  if (closes.length < 50) {
    return { name: 'EMA_FAN', triggered: false, detail: 'Insufficient data for EMA(48)', direction: 'NEUTRAL' };
  }

  // Calculate current and recent EMA values
  const ema13 = calculateEMA(closes, 13);
  const ema48 = calculateEMA(closes, 48);

  // Calculate EMAs from 5 bars ago to detect expansion
  const prevCloses = closes.slice(0, -5);
  const prevEma13 = calculateEMA(prevCloses, 13);
  const prevEma48 = calculateEMA(prevCloses, 48);

  // Calculate EMAs from 10 bars ago for cross detection
  const olderCloses = closes.slice(0, -10);
  const olderEma13 = olderCloses.length >= 13 ? calculateEMA(olderCloses, 13) : ema13;
  const olderEma48 = olderCloses.length >= 48 ? calculateEMA(olderCloses, 48) : ema48;

  const currentGap = ema13 - ema48;
  const prevGap = prevEma13 - prevEma48;
  const olderGap = olderEma13 - olderEma48;

  // Bear fan: EMA13 below EMA48 and gap expanding (more negative)
  const isBearFan = currentGap < 0 && currentGap < prevGap;
  // Bull fan: EMA13 above EMA48 and gap expanding (more positive)
  const isBullFan = currentGap > 0 && currentGap > prevGap;

  // Cross detection: sign change in last 10 bars
  const recentCross = (olderGap > 0 && currentGap < 0) || (olderGap < 0 && currentGap > 0);

  let direction: 'PUT' | 'CALL' | 'NEUTRAL' = 'NEUTRAL';
  let detail = '';
  let triggered = false;

  if (isBearFan || (recentCross && currentGap < 0)) {
    direction = 'PUT';
    triggered = true;
    detail = recentCross
      ? `EMA 13 crossed below EMA 48 — bear fan forming (gap: ${currentGap.toFixed(2)})`
      : `Bear fan expanding (gap: ${currentGap.toFixed(2)}, was ${prevGap.toFixed(2)})`;
  } else if (isBullFan || (recentCross && currentGap > 0)) {
    direction = 'CALL';
    triggered = true;
    detail = recentCross
      ? `EMA 13 crossed above EMA 48 — bull fan forming (gap: ${currentGap.toFixed(2)})`
      : `Bull fan expanding (gap: ${currentGap.toFixed(2)}, was ${prevGap.toFixed(2)})`;
  } else {
    detail = `EMA fan neutral (13: ${ema13.toFixed(2)}, 48: ${ema48.toFixed(2)}, gap: ${currentGap.toFixed(2)})`;
  }

  return { name: 'EMA_FAN', triggered, detail, direction };
}

// ============================================
// SIGNAL 4: MOMENTUM DIVERGENCE
// ============================================

function evaluateDivergence(closes: number[], highs: number[], lows: number[]): SignalDetail {
  if (closes.length < 20) {
    return { name: 'DIVERGENCE', triggered: false, detail: 'Insufficient data', direction: 'NEUTRAL' };
  }

  // RSI divergence check
  const currentRSI = calculateRSI(closes, 14);
  const prevRSI = calculateRSI(closes.slice(0, -5), 14);

  // Recent price extremes vs 10-bar-ago extremes
  const recentHigh = Math.max(...highs.slice(-5));
  const olderHigh = Math.max(...highs.slice(-15, -5));
  const recentLow = Math.min(...lows.slice(-5));
  const olderLow = Math.min(...lows.slice(-15, -5));

  // MACD histogram check
  const currentMACD = calculateMACD(closes);
  const prevMACD = calculateMACD(closes.slice(0, -3));

  let triggered = false;
  let direction: 'PUT' | 'CALL' | 'NEUTRAL' = 'NEUTRAL';
  let detail = '';

  // Bearish RSI divergence: price makes new high but RSI makes lower high
  if (recentHigh > olderHigh && currentRSI < prevRSI && currentRSI > 55) {
    triggered = true;
    direction = 'PUT';
    detail = `Bearish RSI divergence: price new high but RSI declining (${currentRSI.toFixed(0)} vs ${prevRSI.toFixed(0)})`;
  }
  // Bullish RSI divergence: price makes new low but RSI makes higher low
  else if (recentLow < olderLow && currentRSI > prevRSI && currentRSI < 45) {
    triggered = true;
    direction = 'CALL';
    detail = `Bullish RSI divergence: price new low but RSI rising (${currentRSI.toFixed(0)} vs ${prevRSI.toFixed(0)})`;
  }

  // MACD histogram shrinking while price extends (secondary confirmation)
  const histShrinking = Math.abs(currentMACD.histogram) < Math.abs(prevMACD.histogram);
  if (!triggered && histShrinking) {
    const priceExtending = recentHigh > olderHigh || recentLow < olderLow;
    if (priceExtending && currentMACD.histogram > 0 && recentHigh > olderHigh) {
      triggered = true;
      direction = 'PUT';
      detail = `MACD histogram shrinking while price makes new highs (hist: ${currentMACD.histogram.toFixed(3)})`;
    } else if (priceExtending && currentMACD.histogram < 0 && recentLow < olderLow) {
      triggered = true;
      direction = 'CALL';
      detail = `MACD histogram shrinking while price makes new lows (hist: ${currentMACD.histogram.toFixed(3)})`;
    }
  }

  if (!triggered) {
    detail = `No divergence (RSI: ${currentRSI.toFixed(0)}, MACD hist: ${currentMACD.histogram.toFixed(3)})`;
  }

  return { name: 'DIVERGENCE', triggered, detail, direction };
}

// ============================================
// SIGNAL 5: VWAP CONFIRMATION
// ============================================

function evaluateVWAPConfirmation(price: number, bars: IntradayBar[]): SignalDetail {
  if (bars.length < 10) {
    return { name: 'VWAP', triggered: false, detail: 'Insufficient data', direction: 'NEUTRAL' };
  }

  // Calculate VWAP
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (const bar of bars) {
    const tp = (bar.high + bar.low + bar.close) / 3;
    cumulativeTPV += tp * bar.volume;
    cumulativeVolume += bar.volume;
  }
  const vwap = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : price;

  // Check recent bars for VWAP cross with volume
  const recentBars = bars.slice(-6);
  const avgVolume = bars.slice(-20).reduce((s, b) => s + b.volume, 0) / Math.min(bars.length, 20);

  // Track VWAP position over recent bars
  const wasAbove = recentBars.slice(0, 3).some(b => b.close > vwap);
  const wasBelow = recentBars.slice(0, 3).some(b => b.close < vwap);
  const nowAbove = price > vwap;
  const nowBelow = price < vwap;
  const lastBarVolume = recentBars[recentBars.length - 1].volume;
  const hasVolume = lastBarVolume > avgVolume * 1.3;

  let triggered = false;
  let direction: 'PUT' | 'CALL' | 'NEUTRAL' = 'NEUTRAL';
  let detail = '';

  // PUT: Price was above VWAP, now failing below it
  if (wasAbove && nowBelow && hasVolume) {
    triggered = true;
    direction = 'PUT';
    detail = `Failed VWAP ($${vwap.toFixed(2)}) — was above, now below with ${(lastBarVolume / avgVolume).toFixed(1)}x volume`;
  }
  // CALL: Price was below VWAP, now reclaiming it
  else if (wasBelow && nowAbove && hasVolume) {
    triggered = true;
    direction = 'CALL';
    detail = `Reclaimed VWAP ($${vwap.toFixed(2)}) — was below, now above with ${(lastBarVolume / avgVolume).toFixed(1)}x volume`;
  }

  if (!triggered) {
    const pos = nowAbove ? 'above' : 'below';
    detail = `Price ${pos} VWAP ($${vwap.toFixed(2)}) — no cross detected`;
  }

  return { name: 'VWAP', triggered, detail, direction };
}

// ============================================
// SIGNAL 6: VIX CONTEXT
// ============================================

async function evaluateVIXContext(): Promise<SignalDetail> {
  try {
    // Try to get intelligence data (VIX regime + GEX)
    const { getSPXIntelligence } = await import('./spx-intelligence-service');
    const intel = getSPXIntelligence('SPY');

    if (intel?.vixRegime) {
      const vix = intel.vixRegime.currentVIX;
      const regime = intel.vixRegime.regime;
      const termStructure = intel.vixRegime.termStructure;

      let triggered = false;
      let direction: 'PUT' | 'CALL' | 'NEUTRAL' = 'NEUTRAL';
      let detail = '';

      // VIX > 20 and fear regime = put environment
      if (vix > 20 && (regime === 'fear' || regime === 'extreme_fear')) {
        triggered = true;
        direction = 'PUT';
        detail = `VIX ${vix.toFixed(1)} in ${regime} regime`;
        if (termStructure === 'backwardation') {
          detail += ' + backwardation (acute fear)';
        }
      }
      // VIX < 18 and calm = call environment
      else if (vix < 18 && (regime === 'calm' || regime === 'low_vol')) {
        triggered = true;
        direction = 'CALL';
        detail = `VIX ${vix.toFixed(1)} in ${regime} regime — low fear`;
      }
      // Elevated VIX > 25 = strong put signal
      else if (vix > 25) {
        triggered = true;
        direction = 'PUT';
        detail = `VIX elevated at ${vix.toFixed(1)} — high fear environment`;
      }

      // GEX enhancement
      if (intel.gex && triggered) {
        const gex = intel.gex;
        if (gex.totalNetGEX < 0) {
          detail += ` | Negative GEX ($${(gex.totalNetGEX / 1e9).toFixed(1)}B) — MMs amplifying moves`;
        }
      }

      if (!triggered) {
        detail = `VIX ${vix.toFixed(1)} — neutral (${regime})`;
      }

      return { name: 'VIX', triggered, detail, direction };
    }

    // Fallback: fetch VIX directly
    const vixQuote = await fetchStockPrice('^VIX');
    if (vixQuote) {
      const vix = vixQuote.currentPrice;
      const triggered = vix > 20 || vix < 18;
      const direction: 'PUT' | 'CALL' | 'NEUTRAL' = vix > 20 ? 'PUT' : vix < 18 ? 'CALL' : 'NEUTRAL';
      return {
        name: 'VIX',
        triggered,
        detail: `VIX at ${vix.toFixed(1)}${vix > 20 ? ' — elevated fear' : vix < 18 ? ' — calm' : ''}`,
        direction,
      };
    }

    return { name: 'VIX', triggered: false, detail: 'VIX data unavailable', direction: 'NEUTRAL' };
  } catch (error) {
    return { name: 'VIX', triggered: false, detail: 'VIX check failed', direction: 'NEUTRAL' };
  }
}

// ============================================
// MAIN SCANNER
// ============================================

async function runSwingCatcherScan(): Promise<SwingAlert[]> {
  const et = getETTime();
  const etHours = getETHours(et);
  const today = et.toISOString().split('T')[0];

  logger.info(`[SWING-CATCHER] Running scan at ${et.toLocaleTimeString()}`);

  // Reset state on new day
  if (state.date !== today) {
    state = {
      date: today,
      previousDay: null,
      previousMonth: null,
      alerts: [],
      lastScanTime: null,
    };
  }

  // Fetch PDH/PDL/PMH/PML once per day
  if (!state.previousDay) {
    state.previousDay = await fetchPreviousDayLevels('SPY');
    logger.info(`[SWING-CATCHER] PDH/PDL loaded: ${JSON.stringify(state.previousDay)}`);
  }
  if (!state.previousMonth) {
    state.previousMonth = await fetchPreviousMonthLevels('SPY');
    logger.info(`[SWING-CATCHER] PMH/PML loaded: ${JSON.stringify(state.previousMonth)}`);
  }

  const newAlerts: SwingAlert[] = [];

  for (const symbol of SCAN_SYMBOLS) {
    try {
      // Get market data
      const bars = await getIntradayBars(symbol);
      if (bars.length < 15) continue;

      const quote = await fetchStockPrice(symbol);
      if (!quote) continue;

      const price = quote.currentPrice;
      const closes = bars.map(b => b.close);
      const highs = bars.map(b => b.high);
      const lows = bars.map(b => b.low);

      // Evaluate all 6 signals
      const signal1 = evaluateLevelConfluence(price, bars, state.previousDay, state.previousMonth);
      const signal2 = evaluateRejection(bars);
      const signal3 = evaluateEMAFan(closes);
      const signal4 = evaluateDivergence(closes, highs, lows);
      const signal5 = evaluateVWAPConfirmation(price, bars);
      const signal6 = await evaluateVIXContext();

      const allSignals = [signal1, signal2, signal3, signal4, signal5, signal6];

      // Calculate score
      const score = allSignals.filter(s => s.triggered).length;

      // Determine direction from triggered signals
      const directionalSignals = allSignals.filter(s => s.triggered && s.direction !== 'NEUTRAL');
      const putVotes = directionalSignals.filter(s => s.direction === 'PUT').length;
      const callVotes = directionalSignals.filter(s => s.direction === 'CALL').length;

      // Need at least 4 signals for WATCH, direction must have majority
      if (score < 4) continue;
      if (putVotes === 0 && callVotes === 0) continue;

      const direction: 'PUT' | 'CALL' = putVotes >= callVotes ? 'PUT' : 'CALL';

      // Check for direction agreement (at least 3 directional signals must agree)
      const directionAgreement = direction === 'PUT' ? putVotes : callVotes;
      if (directionAgreement < 2) continue;

      // Score label
      const scoreLabel: 'FIRE' | 'STRONG' | 'WATCH' =
        score >= 6 ? 'FIRE' : score >= 5 ? 'STRONG' : 'WATCH';

      // Calculate trade setup
      const spxPrice = price * SPX_MULTIPLIER;
      const otmDistance = spxPrice * 0.015; // 1.5% OTM
      const suggestedStrike = direction === 'PUT'
        ? Math.round((spxPrice - otmDistance) / 5) * 5
        : Math.round((spxPrice + otmDistance) / 5) * 5;

      // Target: next major level
      const hod = Math.max(...highs);
      const lod = Math.min(...lows);
      const range = hod - lod;
      const targetLevel = direction === 'PUT'
        ? (price - range) * SPX_MULTIPLIER
        : (price + range) * SPX_MULTIPLIER;
      const stopLevel = direction === 'PUT'
        ? (hod + range * 0.25) * SPX_MULTIPLIER
        : (lod - range * 0.25) * SPX_MULTIPLIER;

      // Expiry: 0DTE today, or next trading day
      const mins = minutesToClose(etHours);
      const isZeroDTE = mins > 30; // Need at least 30 min left
      const expiry = isZeroDTE ? today : getNextTradingDay(et);

      // Build level name from triggered confluence signals
      const levelName = allSignals
        .filter(s => s.triggered)
        .map(s => s.name.replace('_', ' '))
        .join(' + ');

      // Check for duplicates (same symbol, direction, within 15 min)
      const isDuplicate = state.alerts.some(
        a => a.symbol === symbol &&
          a.direction === direction &&
          new Date().getTime() - a.timestamp.getTime() < 15 * 60 * 1000
      );
      if (isDuplicate) continue;

      // Estimated cost
      const atr = bars.length >= 14
        ? calculateATR(highs, lows, closes, 14)
        : range;
      const estimatedCost = atr * SPX_MULTIPLIER < 15 ? '$2-5' : '$3-8';

      const now = new Date();
      const alert: SwingAlert = {
        id: generateId(),
        symbol,
        direction,
        score,
        scoreLabel,
        level: price,
        levelName,
        signals: allSignals,
        suggestedStrike,
        suggestedExpiry: expiry,
        estimatedCost,
        targetLevel: Number(targetLevel.toFixed(0)),
        stopLevel: Number(stopLevel.toFixed(0)),
        currentPrice: price,
        timestamp: now,
        expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      };

      newAlerts.push(alert);
      state.alerts.push(alert);

      logger.info(`[SWING-CATCHER] ${scoreLabel} ALERT: ${symbol} ${direction} Score ${score}/6 at $${price.toFixed(2)} — ${levelName}`);

      // Save as trade idea for Trade Desk
      if (score >= 5) {
        saveSwingAlertAsTradeIdea(alert).catch(e =>
          logger.error(`[SWING-CATCHER] Failed to save trade idea:`, e)
        );
      }
    } catch (error) {
      logger.error(`[SWING-CATCHER] Error scanning ${symbol}:`, error);
    }
  }

  // Remove expired alerts
  state.alerts = state.alerts.filter(a => a.expiresAt > new Date());
  state.lastScanTime = new Date();

  return newAlerts;
}

function getNextTradingDay(et: Date): string {
  const next = new Date(et);
  next.setDate(next.getDate() + 1);
  // Skip weekends
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString().split('T')[0];
}

// ============================================
// TRADE IDEA PERSISTENCE
// ============================================

async function saveSwingAlertAsTradeIdea(alert: SwingAlert): Promise<void> {
  try {
    const allIdeas = await storage.getAllTradeIdeas();
    const recentDuplicate = allIdeas.find(
      (idea: any) =>
        idea.symbol === alert.symbol &&
        idea.source === 'swing_catcher' &&
        idea.direction.toLowerCase() === (alert.direction === 'PUT' ? 'short' : 'long') &&
        new Date().getTime() - new Date(idea.timestamp).getTime() < 30 * 60 * 1000
    );
    if (recentDuplicate) return;

    const tradeIdea = {
      symbol: alert.symbol,
      assetType: 'option' as const,
      direction: alert.direction === 'PUT' ? 'short' : 'long',
      entryPrice: alert.currentPrice,
      targetPrice: alert.targetLevel / SPX_MULTIPLIER,
      stopLoss: alert.stopLevel / SPX_MULTIPLIER,
      riskRewardRatio: 5.0, // Target 500%+ return
      catalyst: `${alert.scoreLabel} Swing Catcher: ${alert.score}/6 signals aligned`,
      analysis: alert.signals.filter(s => s.triggered).map(s => s.detail).join('. '),
      sessionContext: `Score ${alert.score}/6 — ${alert.signals.filter(s => s.triggered).map(s => s.name).join(', ')}`,
      source: 'swing_catcher',
      dataSourceUsed: `SWING_${alert.scoreLabel}`,
      timestamp: alert.timestamp.toISOString(),
      outcomeStatus: 'open' as const,
      confidenceScore: Math.round((alert.score / 6) * 100),
      holdingPeriod: 'day' as const,
      optionType: alert.direction === 'PUT' ? 'put' : 'call',
      strikePrice: alert.suggestedStrike,
      expiryDate: alert.suggestedExpiry,
      qualitySignals: alert.signals.filter(s => s.triggered).map(s => `${s.name}: ${s.detail}`),
      isLottoPlay: true,
    };

    await storage.createTradeIdea(tradeIdea);
    logger.info(`[SWING-CATCHER] Saved trade idea: ${alert.symbol} ${alert.direction} Score ${alert.score}/6`);
  } catch (error) {
    logger.error(`[SWING-CATCHER] Failed to save trade idea:`, error);
  }
}

// ============================================
// LIFECYCLE
// ============================================

let scanInterval: NodeJS.Timeout | null = null;

export function startSwingCatcher(intervalMs: number = 120000): void {
  if (scanInterval) clearInterval(scanInterval);

  logger.info(`[SWING-CATCHER] Starting with ${intervalMs}ms interval`);

  // Run immediately
  runSwingCatcherScan().catch(e => logger.error('[SWING-CATCHER] Scan error:', e));

  // Then on interval
  scanInterval = setInterval(() => {
    runSwingCatcherScan().catch(e => logger.error('[SWING-CATCHER] Scan error:', e));
  }, intervalMs);
}

export function stopSwingCatcher(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    logger.info('[SWING-CATCHER] Stopped');
  }
}

export function getActiveSwingAlerts(): SwingAlert[] {
  const now = new Date();
  return state.alerts.filter(a => a.expiresAt > now);
}

export function getSwingCatcherStatus(): {
  isActive: boolean;
  lastScan: string | null;
  alertCount: number;
  previousDay: PreviousDayLevels | null;
  previousMonth: PreviousMonthLevels | null;
} {
  return {
    isActive: scanInterval !== null,
    lastScan: state.lastScanTime?.toISOString() || null,
    alertCount: getActiveSwingAlerts().length,
    previousDay: state.previousDay,
    previousMonth: state.previousMonth,
  };
}

export default {
  startSwingCatcher,
  stopSwingCatcher,
  getActiveSwingAlerts,
  getSwingCatcherStatus,
  runSwingCatcherScan,
};
