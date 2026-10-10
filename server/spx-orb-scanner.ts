/**
 * SPX Opening Range Breakout (ORB) Scanner
 *
 * Implements the classic ORB strategy for 0DTE and swing trades:
 * 1. Track opening range (first 15/30/60 min candle)
 * 2. Detect clean breakouts above/below range
 * 3. Generate call/put signals with entry/stop/target
 *
 * Integrates with:
 * - Surge Detection Engine (volume confirmation)
 * - Order Flow Scanner (smart money direction)
 * - Pattern Intelligence (clean break validation)
 * - ML Scorer (confidence calibration)
 */

import { logger } from './logger';
import { fetchStockPrice, fetchYahooFinancePrice } from './market-api';
import { storage } from './storage';

// ============================================
// MARKET DATA HELPERS
// ============================================

interface IntradayPrice {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StockQuote {
  symbol: string;
  price: number;
  change?: number;
  changePercent?: number;
}

// Intraday price cache
const intradayCache = new Map<string, { data: IntradayPrice[]; timestamp: number }>();
const INTRADAY_CACHE_TTL = 60 * 1000; // 1 minute cache

/**
 * Get current stock quote
 */
async function getStockQuote(symbol: string): Promise<StockQuote | null> {
  try {
    const data = await fetchStockPrice(symbol);
    if (data) {
      return {
        symbol: data.symbol,
        price: data.currentPrice,
        change: data.changePercent ? data.currentPrice * (data.changePercent / 100) : undefined,
        changePercent: data.changePercent,
      };
    }
    return null;
  } catch (error) {
    logger.warn(`[ORB] Failed to get quote for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get intraday price data from Yahoo Finance
 */
async function getIntradayPrices(symbol: string, interval: string = '5min'): Promise<IntradayPrice[]> {
  const cacheKey = `${symbol}-${interval}`;
  const cached = intradayCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < INTRADAY_CACHE_TTL) {
    return cached.data;
  }

  try {
    // Map interval to Yahoo Finance format
    const yahooInterval = interval === '5min' ? '5m' : interval === '15min' ? '15m' : '5m';

    const yahooSymbol = getYahooSymbol(symbol);
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${yahooInterval}&range=1d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );

    if (!response.ok) {
      logger.warn(`[ORB] Yahoo Finance error for ${symbol}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];

    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      return [];
    }

    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];
    const prices: IntradayPrice[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      if (quote.open[i] !== null && quote.close[i] !== null) {
        prices.push({
          date: new Date(timestamps[i] * 1000),
          open: quote.open[i],
          high: quote.high[i],
          low: quote.low[i],
          close: quote.close[i],
          volume: quote.volume[i] || 0,
        });
      }
    }

    // Cache the result
    intradayCache.set(cacheKey, { data: prices, timestamp: Date.now() });

    return prices;
  } catch (error) {
    logger.error(`[ORB] Error fetching intraday data for ${symbol}:`, error);
    return [];
  }
}

// ============================================
// TYPES
// ============================================

export interface OpeningRange {
  symbol: string;
  date: string;
  timeframe: '15min' | '30min' | '60min';
  high: number;
  low: number;
  open: number;
  close: number;
  rangeWidth: number;
  rangeWidthPct: number;
  volume: number;
  formedAt: Date;
  isValid: boolean;
}

export interface ORBBreakout {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  breakoutType: '0DTE' | 'SWING';
  timeframe: '15min' | '30min' | '60min';

  // Price levels
  breakoutPrice: number;
  currentPrice: number;
  rangeHigh: number;
  rangeLow: number;
  rangeWidth: number;

  // Trade setup
  entry: number;
  stop: number;
  target1: number;  // 1x range
  target2: number;  // 2x range
  target3?: number; // 3x range (swings only)
  riskReward: string;

  // Options details
  suggestedStrike: number;
  suggestedExpiry: string;
  optionType: 'call' | 'put';
  estimatedPremium?: number;

  // Intelligence scores
  confidence: number;
  volumeScore: number;      // From Surge Detection
  flowScore: number;        // From Order Flow
  patternScore: number;     // From Pattern Intelligence
  mlScore: number;          // From ML Scorer

  // Context
  vix: number;
  sessionPhase: string;
  gammaZone: 'positive' | 'negative' | 'neutral';

  // Metadata
  timestamp: Date;
  signals: string[];
  thesis: string;
}

export interface ORBScanResult {
  timestamp: Date;
  sessionPhase: string;
  vix: number;

  // Current ranges
  ranges: OpeningRange[];

  // Active breakouts
  breakouts: ORBBreakout[];

  // Pending setups (range formed, waiting for break)
  pendingSetups: {
    symbol: string;
    timeframe: string;
    rangeHigh: number;
    rangeLow: number;
    distanceToHigh: number;
    distanceToLow: number;
    bias: 'bullish' | 'bearish' | 'neutral';
  }[];
}

// ============================================
// CONSTANTS
// ============================================

const INDEX_SYMBOLS = ['SPX', 'SPY', 'QQQ', 'IWM'];

// Session times in ET
const SESSION = {
  PREMARKET_START: 4,
  MARKET_OPEN: 9.5,      // 9:30 AM
  RANGE_15MIN: 9.75,     // 9:45 AM
  RANGE_30MIN: 10,       // 10:00 AM
  RANGE_60MIN: 10.5,     // 10:30 AM
  MIDDAY_START: 12,
  AFTERNOON_START: 14,
  POWER_HOUR: 15,
  MARKET_CLOSE: 16,
};

// Minimum range width to consider (avoid choppy/tight ranges)
const MIN_RANGE_PCT = 0.15; // 0.15% minimum range

// Breakout confirmation buffer (price must break by this amount)
const BREAKOUT_BUFFER_PCT = 0.02; // 0.02% above/below range

// ============================================
// IN-MEMORY STATE
// ============================================

interface DailyState {
  date: string;
  ranges: Map<string, OpeningRange[]>;  // symbol -> ranges by timeframe
  breakouts: ORBBreakout[];
  priceHistory: Map<string, { time: Date; price: number; volume: number }[]>;
}

let dailyState: DailyState = {
  date: '',
  ranges: new Map(),
  breakouts: [],
  priceHistory: new Map(),
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function getETTime(): Date {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function getETHours(date: Date): number {
  return date.getHours() + date.getMinutes() / 60;
}

function getSessionPhase(etHours: number): string {
  if (etHours < SESSION.MARKET_OPEN) return 'premarket';
  if (etHours < SESSION.RANGE_15MIN) return 'opening_range_forming';
  if (etHours < SESSION.RANGE_30MIN) return 'range_15min_complete';
  if (etHours < SESSION.RANGE_60MIN) return 'range_30min_complete';
  if (etHours < SESSION.MIDDAY_START) return 'morning_session';
  if (etHours < SESSION.AFTERNOON_START) return 'midday';
  if (etHours < SESSION.POWER_HOUR) return 'afternoon';
  if (etHours < SESSION.MARKET_CLOSE) return 'power_hour';
  return 'closed';
}

function getTodayDateString(): string {
  const et = getETTime();
  return et.toISOString().split('T')[0];
}

function generateId(): string {
  return `orb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Map symbol to Yahoo Finance ticker (SPX cash index = ^GSPC)
function getYahooSymbol(symbol: string): string {
  return symbol === 'SPX' ? '%5EGSPC' : symbol;
}

// Round strike to nearest 5 for SPX, nearest 1 for others
function roundToStrike(price: number, symbol: string): number {
  if (symbol === 'SPX') {
    return Math.round(price / 5) * 5;
  }
  return Math.round(price);
}

// Get expiry based on trade type
function getExpiry(tradeType: '0DTE' | 'SWING'): string {
  const et = getETTime();
  if (tradeType === '0DTE') {
    return et.toISOString().split('T')[0];
  }
  // Swing = next Friday
  const daysUntilFriday = (5 - et.getDay() + 7) % 7 || 7;
  const friday = new Date(et);
  friday.setDate(friday.getDate() + daysUntilFriday);
  return friday.toISOString().split('T')[0];
}

// ============================================
// RANGE CALCULATION
// ============================================

async function calculateOpeningRange(
  symbol: string,
  timeframe: '15min' | '30min' | '60min'
): Promise<OpeningRange | null> {
  try {
    // Get intraday prices for today
    const prices = await getIntradayPrices(symbol, '5min');
    if (!prices || prices.length === 0) {
      logger.warn(`[ORB] No intraday data for ${symbol}`);
      return null;
    }

    const et = getETTime();
    const today = getTodayDateString();

    // Determine range end time based on timeframe
    let rangeEndMinutes: number;
    switch (timeframe) {
      case '15min': rangeEndMinutes = 15; break;
      case '30min': rangeEndMinutes = 30; break;
      case '60min': rangeEndMinutes = 60; break;
    }

    // Filter prices to opening range window (9:30 ET to range end)
    // Yahoo timestamps are in real UTC, so we must build range bounds in UTC too
    // ET is UTC-5 (EST) or UTC-4 (EDT). Detect by comparing getETTime offset.
    const now = new Date();
    const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const utcOffsetMs = now.getTime() - etNow.getTime(); // positive = ET is behind UTC
    // Build 9:30 AM ET as a real UTC timestamp
    const rangeStartTime = new Date(etNow);
    rangeStartTime.setHours(9, 30, 0, 0);
    // Convert back to real UTC by adding the offset
    const rangeStartUTC = new Date(rangeStartTime.getTime() + utcOffsetMs);

    const rangeEndUTC = new Date(rangeStartUTC.getTime() + rangeEndMinutes * 60 * 1000);

    const rangePrices = prices.filter(p => {
      const priceTime = new Date(p.date);
      return priceTime >= rangeStartUTC && priceTime <= rangeEndUTC;
    });

    if (rangePrices.length === 0) {
      logger.debug(`[ORB] ${symbol} ${timeframe}: 0 bars in range (start=${rangeStartUTC.toISOString()}, end=${rangeEndUTC.toISOString()}, firstBar=${prices[0]?.date})`);
      return null;
    }

    // Calculate range high, low, open, close
    const high = Math.max(...rangePrices.map(p => p.high));
    const low = Math.min(...rangePrices.map(p => p.low));
    const open = rangePrices[0].open;
    const close = rangePrices[rangePrices.length - 1].close;
    const volume = rangePrices.reduce((sum, p) => sum + (p.volume || 0), 0);

    const rangeWidth = high - low;
    const rangeWidthPct = (rangeWidth / low) * 100;

    // Validate range
    const isValid = rangeWidthPct >= MIN_RANGE_PCT;

    return {
      symbol,
      date: today,
      timeframe,
      high,
      low,
      open,
      close,
      rangeWidth,
      rangeWidthPct,
      volume,
      formedAt: rangeEndUTC,
      isValid,
    };
  } catch (error) {
    logger.error(`[ORB] Error calculating range for ${symbol}:`, error);
    return null;
  }
}

// ============================================
// BREAKOUT DETECTION
// ============================================

async function detectBreakout(
  symbol: string,
  range: OpeningRange,
  currentPrice: number
): Promise<{ direction: 'LONG' | 'SHORT'; strength: number } | null> {
  const buffer = range.rangeWidth * (BREAKOUT_BUFFER_PCT / 100);

  // Check for breakout above range
  if (currentPrice > range.high + buffer) {
    const strength = ((currentPrice - range.high) / range.rangeWidth) * 100;
    return { direction: 'LONG', strength: Math.min(strength, 100) };
  }

  // Check for breakout below range
  if (currentPrice < range.low - buffer) {
    const strength = ((range.low - currentPrice) / range.rangeWidth) * 100;
    return { direction: 'SHORT', strength: Math.min(strength, 100) };
  }

  return null;
}

// ============================================
// INTELLIGENCE INTEGRATION
// ============================================

async function getVolumeScore(symbol: string): Promise<number> {
  try {
    // Try to use surge detection engine
    const { detectSurge } = await import('./surge-detection-engine');
    const surge = await detectSurge(symbol);
    if (surge && surge.volumeRatio) {
      // Score based on volume ratio (1.5x = 50, 2x = 75, 3x+ = 100)
      return Math.min(100, (surge.volumeRatio - 1) * 50);
    }
  } catch (e) {
    // Fallback to basic volume check
  }
  return 50; // Default moderate score
}

async function getFlowScore(symbol: string, direction: 'LONG' | 'SHORT'): Promise<number> {
  try {
    // Try to use order flow scanner
    const { getOptionsFlow } = await import('./options-flow-scanner');
    const flow = await getOptionsFlow(symbol);
    if (flow) {
      // Check if flow agrees with direction
      const bullishFlow = flow.callVolume > flow.putVolume;
      const agrees = (direction === 'LONG' && bullishFlow) || (direction === 'SHORT' && !bullishFlow);
      const ratio = bullishFlow
        ? flow.callVolume / (flow.putVolume || 1)
        : flow.putVolume / (flow.callVolume || 1);

      if (agrees) {
        return Math.min(100, 50 + ratio * 10);
      } else {
        return Math.max(0, 50 - ratio * 10);
      }
    }
  } catch (e) {
    // Fallback
  }
  return 50;
}

async function getPatternScore(symbol: string, direction: 'LONG' | 'SHORT'): Promise<number> {
  try {
    // Try to use pattern intelligence
    const { analyzePatterns } = await import('./pattern-intelligence');
    const patterns = await analyzePatterns(symbol);
    if (patterns && patterns.length > 0) {
      // Check for confirming patterns
      const confirmingPatterns = patterns.filter(p => {
        const bullish = p.bias === 'bullish' || p.type.includes('breakout');
        const bearish = p.bias === 'bearish' || p.type.includes('breakdown');
        return (direction === 'LONG' && bullish) || (direction === 'SHORT' && bearish);
      });

      if (confirmingPatterns.length > 0) {
        return Math.min(100, 60 + confirmingPatterns.length * 10);
      }
    }
  } catch (e) {
    // Fallback
  }
  return 50;
}

async function getMLScore(
  symbol: string,
  direction: 'LONG' | 'SHORT',
  confidence: number
): Promise<number> {
  try {
    // Try to use ML scorer for calibration
    const { calibrateConfidence } = await import('./ml-scorer');
    const calibrated = await calibrateConfidence(symbol, direction, confidence);
    return calibrated || confidence;
  } catch (e) {
    // Fallback to uncalibrated
  }
  return confidence;
}

async function getVIX(): Promise<number> {
  try {
    const quote = await getStockQuote('VIX');
    return quote?.price || 18;
  } catch (e) {
    return 18; // Default VIX
  }
}

// ============================================
// TRADE SETUP GENERATION
// ============================================

async function generateBreakoutSignal(
  symbol: string,
  range: OpeningRange,
  direction: 'LONG' | 'SHORT',
  breakoutStrength: number,
  tradeType: '0DTE' | 'SWING'
): Promise<ORBBreakout> {
  const et = getETTime();
  const currentQuote = await getStockQuote(symbol);
  const currentPrice = currentQuote?.price || range.close;
  const vix = await getVIX();

  // Get intelligence scores
  const [volumeScore, flowScore, patternScore] = await Promise.all([
    getVolumeScore(symbol),
    getFlowScore(symbol, direction),
    getPatternScore(symbol, direction),
  ]);

  // Calculate base confidence
  const baseConfidence = Math.round(
    (breakoutStrength * 0.2) +
    (volumeScore * 0.25) +
    (flowScore * 0.25) +
    (patternScore * 0.2) +
    (range.isValid ? 10 : 0)
  );

  // Apply ML calibration
  const mlScore = await getMLScore(symbol, direction, baseConfidence);
  const confidence = Math.round((baseConfidence + mlScore) / 2);

  // Calculate trade levels
  const entry = direction === 'LONG'
    ? range.high + (range.rangeWidth * 0.02)
    : range.low - (range.rangeWidth * 0.02);

  const stop = direction === 'LONG'
    ? range.high - (range.rangeWidth * 0.25)  // Stop just inside range
    : range.low + (range.rangeWidth * 0.25);

  const target1 = direction === 'LONG'
    ? range.high + range.rangeWidth
    : range.low - range.rangeWidth;

  const target2 = direction === 'LONG'
    ? range.high + (range.rangeWidth * 2)
    : range.low - (range.rangeWidth * 2);

  const target3 = tradeType === 'SWING' ? (direction === 'LONG'
    ? range.high + (range.rangeWidth * 3)
    : range.low - (range.rangeWidth * 3)) : undefined;

  // Calculate risk/reward
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target1 - entry);
  const riskReward = `1:${(reward / risk).toFixed(1)}`;

  // Options setup
  const optionType = direction === 'LONG' ? 'call' : 'put';
  const suggestedStrike = roundToStrike(
    direction === 'LONG' ? currentPrice + 5 : currentPrice - 5,
    symbol
  );
  const suggestedExpiry = getExpiry(tradeType);

  // Generate signals list
  const signals: string[] = [];
  if (volumeScore >= 70) signals.push(`High volume (${volumeScore})`);
  if (flowScore >= 70) signals.push(`Smart money confirms (${flowScore})`);
  if (patternScore >= 70) signals.push(`Clean pattern (${patternScore})`);
  if (breakoutStrength >= 50) signals.push(`Strong breakout (${breakoutStrength.toFixed(0)}%)`);
  if (vix < 20) signals.push('Low VIX environment');
  if (vix > 25) signals.push('Elevated VIX - reduce size');

  // Generate thesis
  const thesis = `${symbol} ${range.timeframe} ORB ${direction === 'LONG' ? 'breakout above' : 'breakdown below'} ` +
    `$${direction === 'LONG' ? range.high.toFixed(2) : range.low.toFixed(2)}. ` +
    `Range width: ${range.rangeWidthPct.toFixed(2)}%. ` +
    `${signals.slice(0, 2).join('. ')}.`;

  // Determine gamma zone
  let gammaZone: 'positive' | 'negative' | 'neutral' = 'neutral';
  // Simplified: above yesterday's close = positive, below = negative
  if (currentPrice > range.open * 1.002) gammaZone = 'positive';
  else if (currentPrice < range.open * 0.998) gammaZone = 'negative';

  return {
    id: generateId(),
    symbol,
    direction,
    breakoutType: tradeType,
    timeframe: range.timeframe,

    breakoutPrice: direction === 'LONG' ? range.high : range.low,
    currentPrice,
    rangeHigh: range.high,
    rangeLow: range.low,
    rangeWidth: range.rangeWidth,

    entry,
    stop,
    target1,
    target2,
    target3,
    riskReward,

    suggestedStrike,
    suggestedExpiry,
    optionType,

    confidence,
    volumeScore,
    flowScore,
    patternScore,
    mlScore,

    vix,
    sessionPhase: getSessionPhase(getETHours(et)),
    gammaZone,

    timestamp: new Date(), // Use real UTC, not fake-ET
    signals,
    thesis,
  };
}

/**
 * Save ORB breakout as a Trade Idea for Trade Desk display
 */
async function saveBreakoutAsTradeIdea(breakout: ORBBreakout): Promise<void> {
  try {
    // Convert ORB breakout to trade idea format
    const tradeIdea = {
      symbol: breakout.symbol,
      assetType: 'option' as const,
      direction: breakout.direction.toLowerCase(),
      entryPrice: breakout.entry,
      targetPrice: breakout.target1,
      stopLoss: breakout.stop,
      riskRewardRatio: breakout.riskReward,
      catalyst: `ORB ${breakout.timeframe} ${breakout.direction} breakout`,
      analysis: breakout.thesis,
      sessionContext: `${breakout.sessionPhase} - ${breakout.breakoutType} trade`,
      source: 'orb_scanner',
      dataSourceUsed: `ORB_${breakout.timeframe}_${breakout.breakoutType}`,
      timestamp: breakout.timestamp.toISOString(),
      outcomeStatus: 'open' as const,
      confidenceScore: breakout.confidence,
      holdingPeriod: breakout.breakoutType === '0DTE' ? 'day' as const : 'swing' as const,

      // Option details
      optionType: breakout.optionType,
      strikePrice: breakout.suggestedStrike,
      expiryDate: breakout.suggestedExpiry,

      // Quality signals
      qualitySignals: breakout.signals,

      // Meta
      isLottoPlay: breakout.breakoutType === '0DTE' && breakout.confidence >= 65,
    };

    await storage.createTradeIdea(tradeIdea, { dedupWindowHours: 1 }); // spine 1h dedup
    logger.info(`[ORB] ✅ Saved trade idea: ${breakout.symbol} ${breakout.direction} ${breakout.timeframe}`);
  } catch (error) {
    logger.error(`[ORB] Failed to save trade idea for ${breakout.symbol}:`, error);
  }
}

// ============================================
// MAIN SCANNER
// ============================================

export async function runORBScan(): Promise<ORBScanResult> {
  const et = getETTime();
  const etHours = getETHours(et);
  const today = getTodayDateString();
  const sessionPhase = getSessionPhase(etHours);

  logger.info(`[ORB] Running scan - Session: ${sessionPhase}, Time: ${et.toLocaleTimeString()}`);

  // Reset state if new day
  if (dailyState.date !== today) {
    dailyState = {
      date: today,
      ranges: new Map(),
      breakouts: [],
      priceHistory: new Map(),
    };
    logger.info(`[ORB] New trading day - state reset`);
  }

  const vix = await getVIX();
  const ranges: OpeningRange[] = [];
  const breakouts: ORBBreakout[] = [];
  const pendingSetups: ORBScanResult['pendingSetups'] = [];

  // Scan each index
  for (const symbol of INDEX_SYMBOLS) {
    try {
      const quote = await getStockQuote(symbol);
      if (!quote) continue;

      const currentPrice = quote.price;

      // Calculate ranges based on session phase
      const timeframes: ('15min' | '30min' | '60min')[] = [];
      if (etHours >= SESSION.RANGE_15MIN) timeframes.push('15min');
      if (etHours >= SESSION.RANGE_30MIN) timeframes.push('30min');
      if (etHours >= SESSION.RANGE_60MIN) timeframes.push('60min');

      for (const tf of timeframes) {
        // Check if we already have this range cached
        const cachedRanges = dailyState.ranges.get(symbol) || [];
        let range = cachedRanges.find(r => r.timeframe === tf);

        if (!range) {
          // Calculate new range
          range = await calculateOpeningRange(symbol, tf);
          if (range) {
            cachedRanges.push(range);
            dailyState.ranges.set(symbol, cachedRanges);
            logger.info(`[ORB] ${symbol} ${tf} range formed: High=${range.high.toFixed(2)}, Low=${range.low.toFixed(2)}, Width=${range.rangeWidthPct.toFixed(2)}%`);
          }
        }

        if (range && range.isValid) {
          ranges.push(range);

          // Check for breakout
          const breakout = await detectBreakout(symbol, range, currentPrice);

          if (breakout) {
            // Check if we already signaled this breakout
            const existingBreakout = dailyState.breakouts.find(
              b => b.symbol === symbol && b.timeframe === tf && b.direction === breakout.direction
            );

            if (!existingBreakout) {
              // Determine trade type based on time
              const tradeType: '0DTE' | 'SWING' = etHours < SESSION.POWER_HOUR ? '0DTE' : 'SWING';

              const signal = await generateBreakoutSignal(
                symbol,
                range,
                breakout.direction,
                breakout.strength,
                tradeType
              );

              // Only add if confidence is acceptable
              if (signal.confidence >= 65) {
                breakouts.push(signal);
                dailyState.breakouts.push(signal);
                logger.info(`[ORB] 🎯 BREAKOUT: ${symbol} ${signal.direction} ${tf} - Confidence: ${signal.confidence}%`);

                // Save to Trade Ideas database for Trade Desk display
                saveBreakoutAsTradeIdea(signal).catch(e =>
                  logger.error(`[ORB] Failed to save trade idea:`, e)
                );
              }
            }
          } else {
            // No breakout yet - add to pending setups
            const distanceToHigh = ((range.high - currentPrice) / currentPrice) * 100;
            const distanceToLow = ((currentPrice - range.low) / currentPrice) * 100;

            // Determine bias based on where price is within range
            const rangePosition = (currentPrice - range.low) / range.rangeWidth;
            let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
            if (rangePosition > 0.7) bias = 'bullish';
            else if (rangePosition < 0.3) bias = 'bearish';

            pendingSetups.push({
              symbol,
              timeframe: tf,
              rangeHigh: range.high,
              rangeLow: range.low,
              distanceToHigh,
              distanceToLow,
              bias,
            });
          }
        }
      }
    } catch (error) {
      logger.error(`[ORB] Error scanning ${symbol}:`, error);
    }
  }

  // Also generate swing setups based on weekly ranges
  // (This would analyze daily candles for larger moves)

  return {
    timestamp: et,
    sessionPhase,
    vix,
    ranges,
    breakouts: [...dailyState.breakouts], // Include all today's breakouts
    pendingSetups,
  };
}

// ============================================
// API HELPERS
// ============================================

export async function getORBStatus(): Promise<{
  isActive: boolean;
  sessionPhase: string;
  rangesFormed: number;
  activeBreakouts: number;
  pendingSetups: number;
}> {
  const et = getETTime();
  const etHours = getETHours(et);
  const sessionPhase = getSessionPhase(etHours);

  const isActive = etHours >= SESSION.MARKET_OPEN && etHours < SESSION.MARKET_CLOSE;

  let rangesFormed = 0;
  dailyState.ranges.forEach(ranges => {
    rangesFormed += ranges.length;
  });

  return {
    isActive,
    sessionPhase,
    rangesFormed,
    activeBreakouts: dailyState.breakouts.length,
    pendingSetups: 0, // Would need to calculate
  };
}

export function getActiveBreakouts(): ORBBreakout[] {
  return dailyState.breakouts;
}

export function getRanges(): OpeningRange[] {
  const ranges: OpeningRange[] = [];
  dailyState.ranges.forEach(symbolRanges => {
    ranges.push(...symbolRanges);
  });
  return ranges;
}

// ============================================
// SCHEDULED SCANNER
// ============================================

let scanInterval: NodeJS.Timeout | null = null;

export function startORBScanner(intervalMs: number = 60000): void {
  if (scanInterval) {
    clearInterval(scanInterval);
  }

  logger.info(`[ORB] Starting ORB scanner with ${intervalMs}ms interval`);

  // Run immediately
  runORBScan().catch(e => logger.error('[ORB] Scan error:', e));

  // Then run on interval
  scanInterval = setInterval(() => {
    const et = getETTime();
    const etHours = getETHours(et);

    // Only scan during market hours
    if (etHours >= SESSION.MARKET_OPEN && etHours < SESSION.MARKET_CLOSE) {
      runORBScan().catch(e => logger.error('[ORB] Scan error:', e));
    }
  }, intervalMs);
}

export function stopORBScanner(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    logger.info('[ORB] Scanner stopped');
  }
}

export default {
  runORBScan,
  getORBStatus,
  getActiveBreakouts,
  getRanges,
  startORBScanner,
  stopORBScanner,
};
