/**
 * SPX Session Scanner - Full Day Intraday Strategies
 *
 * Runs all SPX/SPY/QQQ/IWM strategies simultaneously:
 * 1. ORB Breakouts (9:30-10:30 AM)
 * 2. VWAP Bounce/Rejection (All Day)
 * 3. Lunch Reversal Zone (11:30 AM - 1:00 PM)
 * 4. Gamma Level Pinning (All Day)
 * 5. 0DTE Decay Acceleration (After 2:00 PM)
 * 6. Power Hour Scalps (3:00-4:00 PM)
 * 7. Close Imbalance (3:45-4:00 PM)
 */

import { logger } from './logger';
import { fetchStockPrice } from './market-api';
import { storage } from './storage';

// ============================================
// TYPES
// ============================================

export type StrategyType =
  | 'ORB_BREAKOUT'
  | 'VWAP_BOUNCE'
  | 'VWAP_REJECTION'
  | 'LUNCH_REVERSAL'
  | 'GAMMA_PIN'
  | 'THETA_DECAY'
  | 'POWER_HOUR'
  | 'CLOSE_IMBALANCE'
  | 'HOD_RETEST'
  | 'LOD_RETEST';

export interface SPXSignal {
  id: string;
  symbol: string;
  strategy: StrategyType;
  direction: 'LONG' | 'SHORT';
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';

  // Price levels
  currentPrice: number;
  entry: number;
  stop: number;
  target1: number;
  target2: number;

  // Options
  optionType: 'call' | 'put';
  suggestedStrike: number;
  suggestedExpiry: string;
  estimatedPremium?: number;

  // Scores
  confidence: number;
  volumeScore: number;
  flowScore: number;
  vix: number;

  // Context
  sessionPhase: string;
  timeRemaining: string; // Time until close or strategy expires

  // Analysis
  thesis: string;
  signals: string[];
  keyLevel: number;
  keyLevelName: string;

  // Metadata
  timestamp: Date;
  expiresAt: Date; // Signal validity window
}

export interface DayLevels {
  symbol: string;
  hod: number;        // High of Day
  lod: number;        // Low of Day
  vwap: number;       // VWAP
  openPrice: number;  // Opening price
  prevClose: number;  // Previous close

  // Gamma levels (simplified - round strikes)
  gammaLevels: number[];

  // Pivot points
  pivotHigh: number;
  pivotLow: number;

  lastUpdate: Date;
}

export interface SessionScanResult {
  timestamp: Date;
  sessionPhase: string;
  vix: number;
  minutesToClose: number;

  // Active signals by strategy
  signals: SPXSignal[];

  // Day levels for each symbol
  levels: DayLevels[];

  // Strategy status
  activeStrategies: {
    name: StrategyType;
    isActive: boolean;
    reason?: string;
  }[];
}

// ============================================
// CONSTANTS
// ============================================

const INDEX_SYMBOLS = ['SPY', 'QQQ', 'IWM']; // SPX uses SPY as proxy
const SPX_PROXY = 'SPY'; // SPY trades with SPX correlation

const SESSION = {
  PREMARKET_START: 4,
  MARKET_OPEN: 9.5,      // 9:30 AM
  ORB_END: 10.5,         // 10:30 AM
  LUNCH_START: 11.5,     // 11:30 AM
  LUNCH_END: 13,         // 1:00 PM
  DECAY_START: 14,       // 2:00 PM
  POWER_HOUR: 15,        // 3:00 PM
  CLOSE_IMBALANCE: 15.75,// 3:45 PM
  MARKET_CLOSE: 16,      // 4:00 PM
};

// VWAP configuration
const VWAP_BOUNCE_THRESHOLD = 0.15; // 0.15% from VWAP to trigger

// Gamma level spacing
const GAMMA_SPACING = {
  'SPY': 5,   // $5 strikes
  'QQQ': 5,   // $5 strikes
  'IWM': 2,   // $2 strikes
  'SPX': 25,  // $25 strikes
};

// ============================================
// STATE
// ============================================

interface DailyState {
  date: string;
  levels: Map<string, DayLevels>;
  signals: SPXSignal[];
  priceHistory: Map<string, { time: Date; price: number; volume: number }[]>;
  vwapData: Map<string, { cumulativeTPV: number; cumulativeVolume: number; vwap: number }>;
}

let state: DailyState = {
  date: '',
  levels: new Map(),
  signals: [],
  priceHistory: new Map(),
  vwapData: new Map(),
};

// ============================================
// HELPERS
// ============================================

/**
 * Get current ET time as a Date.
 * WARNING: This returns a Date whose .getHours() etc. reflect ET,
 * but whose internal timestamp (.getTime()) is NOT real UTC.
 * Only use for display / hour extraction. Never use .getTime() for expiry math.
 */
function getETTime(): Date {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

/**
 * Get the UTC offset between real UTC and the fake-ET Date.
 * realUTC = fakeET.getTime() + getETOffset()
 */
function getETOffset(): number {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return now.getTime() - et.getTime();
}

function getETHours(date: Date): number {
  return date.getHours() + date.getMinutes() / 60;
}

function getTodayDateString(): string {
  return getETTime().toISOString().split('T')[0];
}

/**
 * Map symbol to Yahoo Finance ticker (SPX cash index = ^GSPC)
 */
function getYahooSymbol(symbol: string): string {
  return symbol === 'SPX' ? '%5EGSPC' : symbol;
}

function generateId(): string {
  return `spx_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function getSessionPhase(etHours: number): string {
  if (etHours < SESSION.MARKET_OPEN) return 'premarket';
  if (etHours < SESSION.ORB_END) return 'opening_range';
  if (etHours < SESSION.LUNCH_START) return 'morning_session';
  if (etHours < SESSION.LUNCH_END) return 'lunch_chop';
  if (etHours < SESSION.DECAY_START) return 'early_afternoon';
  if (etHours < SESSION.POWER_HOUR) return 'decay_zone';
  if (etHours < SESSION.MARKET_CLOSE) return 'power_hour';
  return 'closed';
}

function minutesToClose(etHours: number): number {
  if (etHours >= SESSION.MARKET_CLOSE) return 0;
  return Math.round((SESSION.MARKET_CLOSE - etHours) * 60);
}

function roundToStrike(price: number, symbol: string): number {
  const spacing = GAMMA_SPACING[symbol as keyof typeof GAMMA_SPACING] || 5;
  return Math.round(price / spacing) * spacing;
}

function getExpiry(isZeroDTE: boolean): string {
  const et = getETTime();
  if (isZeroDTE) {
    return et.toISOString().split('T')[0];
  }
  const daysUntilFriday = (5 - et.getDay() + 7) % 7 || 7;
  const friday = new Date(et);
  friday.setDate(friday.getDate() + daysUntilFriday);
  return friday.toISOString().split('T')[0];
}

async function getVIX(): Promise<number> {
  try {
    const data = await fetchStockPrice('^VIX');
    return data?.currentPrice || 18;
  } catch {
    return 18;
  }
}

// ============================================
// MARKET DATA
// ============================================

interface IntradayBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function getIntradayBars(symbol: string): Promise<IntradayBar[]> {
  try {
    const yahooSym = getYahooSymbol(symbol);
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
      if (q.open[i] !== null) {
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
    logger.error(`[SPX-SESSION] Error fetching bars for ${symbol}:`, error);
    return [];
  }
}

// ============================================
// LEVEL CALCULATIONS
// ============================================

async function calculateDayLevels(symbol: string): Promise<DayLevels | null> {
  try {
    const bars = await getIntradayBars(symbol);
    if (bars.length === 0) return null;

    // Calculate HOD, LOD
    const hod = Math.max(...bars.map(b => b.high));
    const lod = Math.min(...bars.map(b => b.low));
    const openPrice = bars[0].open;
    const currentPrice = bars[bars.length - 1].close;

    // Calculate VWAP
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;
    for (const bar of bars) {
      const tp = (bar.high + bar.low + bar.close) / 3;
      cumulativeTPV += tp * bar.volume;
      cumulativeVolume += bar.volume;
    }
    const vwap = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : currentPrice;

    // Store VWAP data for ongoing calculation
    state.vwapData.set(symbol, { cumulativeTPV, cumulativeVolume, vwap });

    // Calculate gamma levels (round strikes around current price)
    const spacing = GAMMA_SPACING[symbol as keyof typeof GAMMA_SPACING] || 5;
    const gammaLevels: number[] = [];
    const baseStrike = roundToStrike(currentPrice, symbol);
    for (let i = -5; i <= 5; i++) {
      gammaLevels.push(baseStrike + (i * spacing));
    }

    // Pivot points (simplified)
    const pivotHigh = (hod + lod + currentPrice) / 3 + (hod - lod);
    const pivotLow = (hod + lod + currentPrice) / 3 - (hod - lod);

    // Get previous close
    const quote = await fetchStockPrice(symbol);
    const prevClose = quote?.currentPrice ? quote.currentPrice / (1 + (quote.changePercent || 0) / 100) : openPrice;

    return {
      symbol,
      hod,
      lod,
      vwap,
      openPrice,
      prevClose,
      gammaLevels,
      pivotHigh,
      pivotLow,
      lastUpdate: new Date(),
    };
  } catch (error) {
    logger.error(`[SPX-SESSION] Error calculating levels for ${symbol}:`, error);
    return null;
  }
}

// ============================================
// STRATEGY SCANNERS
// ============================================

/**
 * VWAP Bounce/Rejection Strategy
 * Looks for price touching VWAP and bouncing or rejecting
 */
async function scanVWAPStrategy(symbol: string, levels: DayLevels): Promise<SPXSignal | null> {
  try {
    const quote = await fetchStockPrice(symbol);
    if (!quote) return null;

    const price = quote.currentPrice;
    const distanceFromVWAP = ((price - levels.vwap) / levels.vwap) * 100;

    // Check if near VWAP
    if (Math.abs(distanceFromVWAP) > VWAP_BOUNCE_THRESHOLD) {
      return null;
    }

    // Determine direction based on context
    const aboveVWAP = price > levels.vwap;
    const trend = price > levels.openPrice ? 'bullish' : 'bearish';

    // VWAP Bounce = touch from below in uptrend, buy
    // VWAP Rejection = touch from above in downtrend, sell
    let direction: 'LONG' | 'SHORT';
    let strategy: StrategyType;

    if (!aboveVWAP && trend === 'bullish') {
      direction = 'LONG';
      strategy = 'VWAP_BOUNCE';
    } else if (aboveVWAP && trend === 'bearish') {
      direction = 'SHORT';
      strategy = 'VWAP_REJECTION';
    } else {
      return null; // No clear setup
    }

    const vix = await getVIX();
    const rangeWidth = levels.hod - levels.lod;

    return createSignal({
      symbol,
      strategy,
      direction,
      price,
      keyLevel: levels.vwap,
      keyLevelName: 'VWAP',
      rangeWidth,
      vix,
      confidence: 65,
      urgency: 'MEDIUM',
      thesis: `${symbol} ${strategy === 'VWAP_BOUNCE' ? 'bouncing off' : 'rejecting from'} VWAP at $${levels.vwap.toFixed(2)}. Trend is ${trend}.`,
    });
  } catch (error) {
    logger.error(`[SPX-SESSION] VWAP scan error for ${symbol}:`, error);
    return null;
  }
}

/**
 * Lunch Reversal Strategy (11:30 AM - 1:00 PM)
 * Fades extended morning moves during low-volume lunch hour
 */
async function scanLunchReversal(symbol: string, levels: DayLevels): Promise<SPXSignal | null> {
  const et = getETTime();
  const etHours = getETHours(et);

  if (etHours < SESSION.LUNCH_START || etHours > SESSION.LUNCH_END) {
    return null;
  }

  try {
    const quote = await fetchStockPrice(symbol);
    if (!quote) return null;

    const price = quote.currentPrice;
    const morningMove = ((price - levels.openPrice) / levels.openPrice) * 100;

    // Need extended move to fade (>0.5%)
    if (Math.abs(morningMove) < 0.5) {
      return null;
    }

    // Check if at HOD/LOD (overextended)
    const nearHOD = price >= levels.hod * 0.998;
    const nearLOD = price <= levels.lod * 1.002;

    let direction: 'LONG' | 'SHORT' | null = null;
    let keyLevel: number;
    let keyLevelName: string;

    if (nearHOD && morningMove > 0.5) {
      direction = 'SHORT'; // Fade the rally
      keyLevel = levels.hod;
      keyLevelName = 'HOD';
    } else if (nearLOD && morningMove < -0.5) {
      direction = 'LONG'; // Fade the selloff
      keyLevel = levels.lod;
      keyLevelName = 'LOD';
    }

    if (!direction) return null;

    const vix = await getVIX();
    const rangeWidth = levels.hod - levels.lod;

    return createSignal({
      symbol,
      strategy: 'LUNCH_REVERSAL',
      direction,
      price,
      keyLevel: keyLevel!,
      keyLevelName: keyLevelName!,
      rangeWidth,
      vix,
      confidence: 60,
      urgency: 'LOW',
      thesis: `${symbol} lunch reversal: Overextended ${morningMove > 0 ? 'rally' : 'selloff'} (${morningMove.toFixed(1)}%) at ${keyLevelName}. Low volume period favors mean reversion.`,
    });
  } catch (error) {
    return null;
  }
}

/**
 * HOD/LOD Retest Strategy
 * Trades retests of the high/low of day
 */
async function scanHODLODRetest(symbol: string, levels: DayLevels): Promise<SPXSignal | null> {
  try {
    const quote = await fetchStockPrice(symbol);
    if (!quote) return null;

    const price = quote.currentPrice;
    const vix = await getVIX();
    const rangeWidth = levels.hod - levels.lod;

    // Check for HOD retest (within 0.1%)
    if (Math.abs(price - levels.hod) / levels.hod < 0.001) {
      // HOD retest - could break or reject
      // Use trend to decide
      const trend = price > levels.vwap ? 'bullish' : 'bearish';
      const direction: 'LONG' | 'SHORT' = trend === 'bullish' ? 'LONG' : 'SHORT';

      return createSignal({
        symbol,
        strategy: 'HOD_RETEST',
        direction,
        price,
        keyLevel: levels.hod,
        keyLevelName: 'HOD',
        rangeWidth,
        vix,
        confidence: 62,
        urgency: 'HIGH',
        thesis: `${symbol} retesting HOD at $${levels.hod.toFixed(2)}. ${direction === 'LONG' ? 'Break above for continuation' : 'Rejection likely'}.`,
      });
    }

    // Check for LOD retest
    if (Math.abs(price - levels.lod) / levels.lod < 0.001) {
      const trend = price < levels.vwap ? 'bearish' : 'bullish';
      const direction: 'LONG' | 'SHORT' = trend === 'bearish' ? 'SHORT' : 'LONG';

      return createSignal({
        symbol,
        strategy: 'LOD_RETEST',
        direction,
        price,
        keyLevel: levels.lod,
        keyLevelName: 'LOD',
        rangeWidth,
        vix,
        confidence: 62,
        urgency: 'HIGH',
        thesis: `${symbol} retesting LOD at $${levels.lod.toFixed(2)}. ${direction === 'SHORT' ? 'Break below for continuation' : 'Bounce likely'}.`,
      });
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Gamma Pin Strategy
 * Price gravitates toward max gamma strikes (round numbers)
 */
async function scanGammaPin(symbol: string, levels: DayLevels): Promise<SPXSignal | null> {
  const et = getETTime();
  const etHours = getETHours(et);

  // Gamma pinning strongest after 2pm
  if (etHours < SESSION.DECAY_START) {
    return null;
  }

  try {
    const quote = await fetchStockPrice(symbol);
    if (!quote) return null;

    const price = quote.currentPrice;
    const vix = await getVIX();

    // Find nearest gamma level
    let nearestGamma = levels.gammaLevels[0];
    let minDistance = Math.abs(price - nearestGamma);

    for (const gamma of levels.gammaLevels) {
      const dist = Math.abs(price - gamma);
      if (dist < minDistance) {
        minDistance = dist;
        nearestGamma = gamma;
      }
    }

    const distancePercent = (minDistance / price) * 100;

    // GRAVITY ZONE: the pin trade's whole edge IS the distance to the pin.
    // Inside 0.35% the move is already over (the old gate published entries
    // sitting ON the magnet — IWM 0.007% away on 2026-09-23); beyond 1.5%
    // other forces dominate the magnet.
    if (distancePercent < 0.35 || distancePercent > 1.5) {
      return null;
    }

    // Direction toward gamma
    const direction: 'LONG' | 'SHORT' = price < nearestGamma ? 'LONG' : 'SHORT';

    // TAPE COHERENCE: a pin long against heavy same-day aggressor selling
    // (SPY was published BULL with −$28.6M sold) is an argument, not a
    // setup. Strongly opposing measured flow vetoes publication, visibly.
    try {
      const bf = await import('./bullflow-service');
      if (bf.bullflowEnabled()) {
        const read: any = await bf.getNetPremiumToday(symbol);
        if (read) {
          const net = Number(read.callsNetPremium ?? 0) - Number(read.putsNetPremium ?? 0);
          if ((direction === 'LONG' && net <= -10e6) || (direction === 'SHORT' && net >= 10e6)) {
            console.log(`[SPX-SESSION] GAMMA_PIN ${symbol} vetoed — aggressor tape ${(net / 1e6).toFixed(1)}M against the ${direction} pin thesis`);
            return null;
          }
        }
      }
    } catch { /* flow unavailable — the geometry gates still hold */ }

    const rangeWidth = levels.hod - levels.lod;

    return createSignal({
      symbol,
      strategy: 'GAMMA_PIN',
      direction,
      price,
      structuralTarget: nearestGamma,
      keyLevel: nearestGamma,
      keyLevelName: `$${nearestGamma} Strike`,
      rangeWidth,
      vix,
      confidence: 58,
      urgency: 'LOW',
      thesis: `${symbol} gravitating toward $${nearestGamma} gamma pin. Price ${distancePercent.toFixed(2)}% away. MM hedging creates magnetic effect.`,
    });
  } catch (error) {
    return null;
  }
}

/**
 * 0DTE Theta Decay Strategy (After 2:00 PM)
 * Accelerated decay creates explosive directional moves
 */
async function scanThetaDecay(symbol: string, levels: DayLevels): Promise<SPXSignal | null> {
  const et = getETTime();
  const etHours = getETHours(et);

  if (etHours < SESSION.DECAY_START) {
    return null;
  }

  try {
    const quote = await fetchStockPrice(symbol);
    if (!quote) return null;

    const price = quote.currentPrice;
    const vix = await getVIX();
    const rangeWidth = levels.hod - levels.lod;

    // Look for momentum in decay zone
    const trend = price > levels.vwap ? 'bullish' : 'bearish';
    const distanceFromVWAP = Math.abs((price - levels.vwap) / levels.vwap) * 100;

    // Need some separation from VWAP to confirm direction
    if (distanceFromVWAP < 0.2) {
      return null;
    }

    const direction: 'LONG' | 'SHORT' = trend === 'bullish' ? 'LONG' : 'SHORT';
    const mins = minutesToClose(etHours);

    return createSignal({
      symbol,
      strategy: 'THETA_DECAY',
      direction,
      price,
      keyLevel: levels.vwap,
      keyLevelName: 'VWAP',
      rangeWidth,
      vix,
      confidence: 55,
      urgency: mins < 60 ? 'HIGH' : 'MEDIUM',
      thesis: `${symbol} ${direction} in theta decay zone. ${mins} mins to close. 0DTE options decaying fast - momentum continuation expected.`,
    });
  } catch (error) {
    return null;
  }
}

/**
 * Power Hour Strategy (3:00-4:00 PM)
 * Increased volatility and volume into close
 */
async function scanPowerHour(symbol: string, levels: DayLevels): Promise<SPXSignal | null> {
  const et = getETTime();
  const etHours = getETHours(et);

  if (etHours < SESSION.POWER_HOUR || etHours >= SESSION.MARKET_CLOSE) {
    return null;
  }

  try {
    const quote = await fetchStockPrice(symbol);
    if (!quote) return null;

    const price = quote.currentPrice;
    const vix = await getVIX();
    const rangeWidth = levels.hod - levels.lod;

    // Strong momentum into close
    const trend = price > levels.vwap ? 'bullish' : 'bearish';
    const distanceFromOpen = ((price - levels.openPrice) / levels.openPrice) * 100;

    // Need clear direction (>0.3% from open)
    if (Math.abs(distanceFromOpen) < 0.3) {
      return null;
    }

    const direction: 'LONG' | 'SHORT' = trend === 'bullish' ? 'LONG' : 'SHORT';
    const mins = minutesToClose(etHours);

    return createSignal({
      symbol,
      strategy: 'POWER_HOUR',
      direction,
      price,
      keyLevel: direction === 'LONG' ? levels.hod : levels.lod,
      keyLevelName: direction === 'LONG' ? 'HOD' : 'LOD',
      rangeWidth,
      vix,
      confidence: 65,
      urgency: 'HIGH',
      thesis: `${symbol} power hour ${direction}. Day ${distanceFromOpen > 0 ? 'up' : 'down'} ${Math.abs(distanceFromOpen).toFixed(2)}%. ${mins} mins to close. Momentum continuation play.`,
    });
  } catch (error) {
    return null;
  }
}

/**
 * Close Imbalance Strategy (3:45-4:00 PM)
 * Detects late-day directional pressure from institutional order flow imbalance.
 * Uses volume delta, VWAP position, and proximity to HOD/LOD to detect EOD fades or rips.
 */
async function scanCloseImbalance(symbol: string, levels: DayLevels): Promise<SPXSignal | null> {
  const et = getETTime();
  const etHours = getETHours(et);

  if (etHours < SESSION.CLOSE_IMBALANCE || etHours >= SESSION.MARKET_CLOSE) {
    return null;
  }

  try {
    const quote = await fetchStockPrice(symbol);
    if (!quote) return null;

    const price = quote.currentPrice;
    const vix = await getVIX();
    const rangeWidth = levels.hod - levels.lod;
    if (rangeWidth <= 0) return null;

    // Get intraday bars to analyze late-day volume pattern
    const bars = await getIntradayBars(symbol);
    if (bars.length < 6) return null; // Need enough data

    // Analyze last 3 bars (~15 min) vs earlier session average
    const recentBars = bars.slice(-3);
    const earlierBars = bars.slice(0, -3);

    const recentAvgVolume = recentBars.reduce((sum, b) => sum + b.volume, 0) / recentBars.length;
    const earlierAvgVolume = earlierBars.length > 0
      ? earlierBars.reduce((sum, b) => sum + b.volume, 0) / earlierBars.length
      : recentAvgVolume;

    // Volume surge into close (>1.5x average = institutional activity)
    const volumeSurge = recentAvgVolume / (earlierAvgVolume || 1);
    if (volumeSurge < 1.2) return null; // No meaningful volume pickup

    // Recent price direction (close of last 3 bars)
    const recentClose = recentBars[recentBars.length - 1].close;
    const recentOpen = recentBars[0].open;
    const recentMove = ((recentClose - recentOpen) / recentOpen) * 100;

    // Day's move from open
    const dayMove = ((price - levels.openPrice) / levels.openPrice) * 100;

    // Position relative to key levels
    const nearHOD = (levels.hod - price) / rangeWidth < 0.15; // Top 15% of range
    const nearLOD = (price - levels.lod) / rangeWidth < 0.15; // Bottom 15% of range
    const belowVWAP = price < levels.vwap;
    const aboveVWAP = price > levels.vwap;

    let direction: 'LONG' | 'SHORT' | null = null;
    let keyLevel: number;
    let keyLevelName: string;
    let confidence = 65;
    const signals: string[] = [];

    // SHORT setup: Price near HOD but selling into close
    if (nearHOD && recentMove < -0.05 && belowVWAP) {
      direction = 'SHORT';
      keyLevel = levels.hod;
      keyLevelName = 'HOD';
      signals.push('Price rejected from HOD into close');
      signals.push('Dropped below VWAP in final 15 min');
      if (volumeSurge > 2) { signals.push('Heavy sell volume surge'); confidence += 5; }
    }
    // SHORT setup: Day was up but fading hard with volume
    else if (dayMove > 0.2 && recentMove < -0.15 && volumeSurge > 1.5) {
      direction = 'SHORT';
      keyLevel = levels.vwap;
      keyLevelName = 'VWAP';
      signals.push(`Fading from +${dayMove.toFixed(2)}% day`);
      signals.push(`${volumeSurge.toFixed(1)}x volume surge into close`);
      if (belowVWAP) { signals.push('Lost VWAP support'); confidence += 5; }
    }
    // LONG setup: Price near LOD but buying into close
    else if (nearLOD && recentMove > 0.05 && aboveVWAP) {
      direction = 'LONG';
      keyLevel = levels.lod;
      keyLevelName = 'LOD';
      signals.push('Price bouncing off LOD into close');
      signals.push('Reclaimed VWAP in final 15 min');
      if (volumeSurge > 2) { signals.push('Heavy buy volume surge'); confidence += 5; }
    }
    // LONG setup: Day was down but recovering hard with volume
    else if (dayMove < -0.2 && recentMove > 0.15 && volumeSurge > 1.5) {
      direction = 'LONG';
      keyLevel = levels.vwap;
      keyLevelName = 'VWAP';
      signals.push(`Recovering from ${dayMove.toFixed(2)}% day`);
      signals.push(`${volumeSurge.toFixed(1)}x volume surge into close`);
      if (aboveVWAP) { signals.push('Reclaimed VWAP'); confidence += 5; }
    }

    if (!direction) return null;

    const mins = minutesToClose(etHours);

    return createSignal({
      symbol,
      strategy: 'CLOSE_IMBALANCE',
      direction,
      price,
      keyLevel: keyLevel!,
      keyLevelName: keyLevelName!,
      rangeWidth,
      vix,
      confidence,
      urgency: 'HIGH',
      thesis: `${symbol} close imbalance ${direction}: ${signals.join('. ')}. ${mins}m to close. Institutional flow driving EOD move.`,
    });
  } catch (error) {
    logger.error(`[SPX-SESSION] Close imbalance scan error for ${symbol}:`, error);
    return null;
  }
}

// ============================================
// SIGNAL CREATION
// ============================================

interface SignalParams {
  symbol: string;
  strategy: StrategyType;
  direction: 'LONG' | 'SHORT';
  price: number;
  keyLevel: number;
  keyLevelName: string;
  rangeWidth: number;
  vix: number;
  confidence: number;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  thesis: string;
  /** When the strategy has a REAL destination (e.g. the gamma pin), targets must be it — not a generic 2R past it. */
  structuralTarget?: number;
}

function createSignal(params: SignalParams): SPXSignal {
  const { symbol, strategy, direction, price, keyLevel, keyLevelName, rangeWidth, vix, confidence, urgency, thesis } = params;

  const et = getETTime();
  const etHours = getETHours(et);
  const mins = minutesToClose(etHours);

  // Calculate trade levels
  const risk = rangeWidth * 0.25;
  const entry = direction === 'LONG' ? price + 0.10 : price - 0.10;
  const stop = direction === 'LONG' ? price - risk : price + risk;
  // A strategy with a structural destination (gamma pin) targets THAT level:
  // a generic 2R past the pin contradicts the pin thesis itself (2026-09-23:
  // IWM was published entering ON the $282 pin targeting $284 beyond it).
  const target1 = params.structuralTarget ?? (direction === 'LONG' ? price + (risk * 2) : price - (risk * 2));
  const target2 = params.structuralTarget != null
    ? params.structuralTarget
    : (direction === 'LONG' ? price + (risk * 3) : price - (risk * 3));

  // Options setup
  const isZeroDTE = mins < 120;
  const optionType = direction === 'LONG' ? 'call' : 'put';
  const suggestedStrike = roundToStrike(direction === 'LONG' ? price + 2 : price - 2, symbol);
  const suggestedExpiry = getExpiry(isZeroDTE);

  // Signals
  const signals: string[] = [];
  if (vix < 18) signals.push('Low VIX - reduced premium');
  if (vix > 25) signals.push('High VIX - elevated premium');
  if (mins < 60) signals.push(`${mins}m to close - fast theta`);
  if (urgency === 'HIGH') signals.push('High urgency setup');
  signals.push(`${keyLevelName} key level`);

  // Time remaining
  const timeRemaining = mins > 60
    ? `${Math.floor(mins / 60)}h ${mins % 60}m`
    : `${mins}m`;

  // Expiry window (signal valid for 15 minutes)
  // IMPORTANT: Use real UTC time for expiry so getActiveSignals() comparison works
  const now = new Date(); // real UTC
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

  return {
    id: generateId(),
    symbol,
    strategy,
    direction,
    urgency,
    currentPrice: price,
    entry,
    stop,
    target1,
    target2,
    optionType,
    suggestedStrike,
    suggestedExpiry,
    confidence,
    volumeScore: 65, // Would integrate with surge detection
    flowScore: 60,   // Would integrate with order flow
    vix,
    sessionPhase: getSessionPhase(etHours),
    timeRemaining,
    thesis,
    signals,
    keyLevel,
    keyLevelName,
    timestamp: now, // Use real UTC, not fake-ET
    expiresAt,
  };
}

/**
 * Save SPX Session signal as a Trade Idea for Trade Desk display
 */
async function saveSignalAsTradeIdea(signal: SPXSignal): Promise<void> {
  logger.info(`[SPX-SESSION] 💾 Attempting to save trade idea for ${signal.symbol} ${signal.strategy}...`);
  try {
    // Calculate risk/reward ratio
    const risk = Math.abs(signal.entry - signal.stop);
    const reward = Math.abs(signal.target1 - signal.entry);
    const riskRewardRatio = risk > 0 ? reward / risk : 2.0;

    // Convert SPX signal to trade idea format
    const tradeIdea = {
      symbol: signal.symbol,
      assetType: 'option' as const,
      direction: signal.direction.toLowerCase(),
      entryPrice: signal.entry,
      targetPrice: signal.target1,
      stopLoss: signal.stop,
      riskRewardRatio,
      catalyst: `${signal.strategy} signal on ${signal.symbol}`,
      analysis: signal.thesis,
      sessionContext: `${signal.sessionPhase} - ${signal.timeRemaining} to close`,
      source: 'spx_session',
      dataSourceUsed: `SPX_${signal.strategy}`,
      timestamp: signal.timestamp.toISOString(),
      outcomeStatus: 'open' as const,
      confidenceScore: signal.confidence,
      holdingPeriod: 'day' as const,

      // Option details
      optionType: signal.optionType,
      strikePrice: signal.suggestedStrike,
      expiryDate: signal.suggestedExpiry,

      // Quality signals
      qualitySignals: signal.signals,

      // Meta
      isLottoPlay: signal.urgency === 'HIGH' && signal.confidence >= 65,
    };

    /**
     * One OPEN idea per (symbol, side) — the same rule every other producer follows.
     *
     * This scanner writes through storage.createTradeIdea directly rather than
     * ingestTradeIdea, so the cross-source "already held" check in
     * server/trade-idea-ingestion.ts never applied to it. Its only guard was the
     * 30-minute window below, which stops a burst but not accumulation: over
     * five days it published SPY 22x, IWM 22x and QQQ 21x — 65 rows, 39% of the
     * entire board, for three tickers.
     *
     * That is not 65 ideas. It is three ideas re-stated hourly, and it crowds
     * every single-name setup off a board the operator reads by scrolling.
     *
     * The 30-minute window is kept for genuine intraday re-entry AFTER a
     * position closes. What is blocked is stacking a second open position on a
     * side already held.
     */
    const sideNow = /bear|short|put|down/i.test(String(signal.direction ?? '')) ? 'short' : 'long';
    try {
      const { db } = await import('./db');
      const { sql } = await import('drizzle-orm');
      const held: any = await db.execute(sql`
        select direction from trade_ideas
        where upper(symbol) = ${String(signal.symbol).toUpperCase()}
          and source = 'spx_session'
          and (status = 'active' or outcome_status = 'open')`);
      const rows = (held.rows ?? held) as any[];
      const clash = rows.some((r) => {
        const s = /bear|short|put|down/i.test(String(r.direction ?? '')) ? 'short' : 'long';
        return s === sideNow;
      });
      if (clash) {
        logger.info(
          `[SPX-SESSION] ⛔ ${signal.symbol} ${sideNow} already open — not stacking another`,
        );
        return;
      }
    } catch (err) {
      // A failed lookup must not block publication; fall through to the
      // 30-minute window, which is the behaviour that existed before.
      logger.debug(`[SPX-SESSION] held-check failed for ${signal.symbol}: ${(err as any)?.message ?? err}`);
    }

    await storage.createTradeIdea(tradeIdea, { dedupWindowHours: 0.5 }); // spine 30-min dedup
    logger.info(`[SPX-SESSION] ✅ Saved trade idea: ${signal.symbol} ${signal.strategy} ${signal.direction}`);
  } catch (error) {
    logger.error(`[SPX-SESSION] Failed to save trade idea for ${signal.symbol}:`, error);
  }
}

// ============================================
// MAIN SCANNER
// ============================================

export async function runSessionScan(): Promise<SessionScanResult> {
  const et = getETTime();
  const etHours = getETHours(et);
  const today = getTodayDateString();
  const sessionPhase = getSessionPhase(etHours);

  logger.info(`[SPX-SESSION] Running scan - Phase: ${sessionPhase}, Time: ${et.toLocaleTimeString()}`);

  // Reset state if new day
  if (state.date !== today) {
    state = {
      date: today,
      levels: new Map(),
      signals: [],
      priceHistory: new Map(),
      vwapData: new Map(),
    };
    logger.info(`[SPX-SESSION] New trading day - state reset`);
  }

  const vix = await getVIX();
  const mins = minutesToClose(etHours);
  const newSignals: SPXSignal[] = [];
  const allLevels: DayLevels[] = [];

  // Scan each symbol
  for (const symbol of INDEX_SYMBOLS) {
    try {
      // Update levels
      const levels = await calculateDayLevels(symbol);
      if (!levels) continue;

      state.levels.set(symbol, levels);
      allLevels.push(levels);

      // Run all strategies
      const strategies = [
        scanVWAPStrategy(symbol, levels),
        scanLunchReversal(symbol, levels),
        scanHODLODRetest(symbol, levels),
        scanGammaPin(symbol, levels),
        scanThetaDecay(symbol, levels),
        scanPowerHour(symbol, levels),
        scanCloseImbalance(symbol, levels),
      ];

      const results = await Promise.all(strategies);

      for (const signal of results) {
        if (signal) {
          // Check if we already have a similar signal
          const existing = state.signals.find(
            s => s.symbol === signal.symbol &&
                 s.strategy === signal.strategy &&
                 s.direction === signal.direction &&
                 new Date().getTime() - s.timestamp.getTime() < 15 * 60 * 1000 // Within 15 min
          );

          if (!existing) {
            newSignals.push(signal);
            state.signals.push(signal);
            logger.info(`[SPX-SESSION] 🎯 NEW SIGNAL: ${signal.symbol} ${signal.strategy} ${signal.direction} - Confidence: ${signal.confidence}%`);

            // SUSPENDED from the board 2026-09-24 (SR 11-7 validation): 12.1% hit
            // vs 40.2% random-walk break-even, −0.51R per idea, t −6.7, negative in
            // both halves of the sample. Signals still feed levels/convergence;
            // they no longer publish. SPX_SESSION_PUBLISH=1 re-enables after redesign.
            if (process.env.SPX_SESSION_PUBLISH === '1') {
              saveSignalAsTradeIdea(signal).catch(e =>
                logger.error(`[SPX-SESSION] Failed to save trade idea:`, e)
              );
            }
          }
        }
      }
    } catch (error) {
      logger.error(`[SPX-SESSION] Error scanning ${symbol}:`, error);
    }
  }

  // Remove expired signals
  const now = new Date();
  state.signals = state.signals.filter(s => s.expiresAt > now);

  // Determine active strategies
  const activeStrategies: SessionScanResult['activeStrategies'] = [
    { name: 'VWAP_BOUNCE', isActive: true },
    { name: 'VWAP_REJECTION', isActive: true },
    { name: 'HOD_RETEST', isActive: true },
    { name: 'LOD_RETEST', isActive: true },
    { name: 'LUNCH_REVERSAL', isActive: etHours >= SESSION.LUNCH_START && etHours <= SESSION.LUNCH_END, reason: etHours < SESSION.LUNCH_START ? 'Before 11:30 AM' : etHours > SESSION.LUNCH_END ? 'After 1:00 PM' : undefined },
    { name: 'GAMMA_PIN', isActive: etHours >= SESSION.DECAY_START, reason: etHours < SESSION.DECAY_START ? 'Before 2:00 PM' : undefined },
    { name: 'THETA_DECAY', isActive: etHours >= SESSION.DECAY_START, reason: etHours < SESSION.DECAY_START ? 'Before 2:00 PM' : undefined },
    { name: 'POWER_HOUR', isActive: etHours >= SESSION.POWER_HOUR, reason: etHours < SESSION.POWER_HOUR ? 'Before 3:00 PM' : undefined },
    { name: 'CLOSE_IMBALANCE', isActive: etHours >= SESSION.CLOSE_IMBALANCE, reason: etHours < SESSION.CLOSE_IMBALANCE ? 'Before 3:45 PM' : undefined },
  ];

  return {
    timestamp: et,
    sessionPhase,
    vix,
    minutesToClose: mins,
    signals: state.signals,
    levels: allLevels,
    activeStrategies,
  };
}

// ============================================
// API HELPERS
// ============================================

export function getActiveSignals(): SPXSignal[] {
  const now = new Date();
  return state.signals.filter(s => s.expiresAt > now);
}

export function getSignalsByStrategy(strategy: StrategyType): SPXSignal[] {
  const now = new Date();
  return state.signals.filter(s => s.strategy === strategy && s.expiresAt > now);
}

export function getLevels(): DayLevels[] {
  return Array.from(state.levels.values());
}

// ============================================
// SCHEDULED SCANNER
// ============================================

let scanInterval: NodeJS.Timeout | null = null;

export function startSessionScanner(intervalMs: number = 30000): void {
  if (scanInterval) {
    clearInterval(scanInterval);
  }

  logger.info(`[SPX-SESSION] Starting session scanner with ${intervalMs}ms interval`);

  // Run immediately
  runSessionScan().catch(e => logger.error('[SPX-SESSION] Scan error:', e));

  // Then run on interval
  scanInterval = setInterval(() => {
    const et = getETTime();
    const etHours = getETHours(et);

    if (etHours >= SESSION.MARKET_OPEN && etHours < SESSION.MARKET_CLOSE) {
      runSessionScan().catch(e => logger.error('[SPX-SESSION] Scan error:', e));
    }
  }, intervalMs);
}

export function stopSessionScanner(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    logger.info('[SPX-SESSION] Scanner stopped');
  }
}

export default {
  runSessionScan,
  getActiveSignals,
  getSignalsByStrategy,
  getLevels,
  startSessionScanner,
  stopSessionScanner,
};
