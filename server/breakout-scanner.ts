/**
 * Breakout Scanner Service
 * Implements 20-day resistance breakout detection
 * 
 * Based on Moon Dev's RBI Framework:
 * - Scans for price breaking above 20-day resistance
 * - Hourly confirmation for momentum validation
 * - Multi-symbol scanning capability
 */

import { fetchOHLCData, OHLCData } from './chart-analysis';
import { calculateATRTargets } from './atr-targets';

interface BreakoutSignal {
  symbol: string;
  signalType: 'breakout' | 'breakdown';
  resistanceLevel: number;
  supportLevel: number;
  currentPrice: number;
  breakoutPercent: number;
  volumeRatio: number;
  strength: 'weak' | 'moderate' | 'strong';
  confidence: number;
  entryPrice: number;
  suggestedStopLoss: number;
  suggestedTarget: number;
  riskRewardRatio: number;
  timestamp: string;
  // Hourly confirmation fields
  hourlyConfirmed: boolean;
  hourlyMomentum: 'strong' | 'moderate' | 'weak' | 'none';
  hourlyBarsAboveResistance: number;
  hourlyHigherLows: boolean;
}

interface HourlyConfirmation {
  confirmed: boolean;
  momentum: 'strong' | 'moderate' | 'weak' | 'none';
  barsAboveLevel: number;
  higherLows: boolean;
  hourlyRSI?: number;
}

interface ScannerConfig {
  lookbackDays: number;          // Days to look back for resistance (default: 20)
  breakoutThresholdPercent: number;  // Min % above resistance to confirm (default: 0.5%)
  volumeMultiplier: number;      // Min volume vs average (default: 1.2x)
  stopLossPercent: number;       // Stop loss below entry (default: 3%)
  targetPercent: number;         // Take profit above entry (default: 6%)
}

const DEFAULT_CONFIG: ScannerConfig = {
  lookbackDays: 20,
  breakoutThresholdPercent: 0.5,
  volumeMultiplier: 1.2,
  stopLossPercent: 3,
  targetPercent: 6
};

// Popular symbols to scan
const STOCK_WATCHLIST = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AMD', 'NFLX', 'CRM',
  'ORCL', 'ADBE', 'INTC', 'PYPL', 'UBER', 'SQ', 'SHOP', 'COIN', 'PLTR', 'SNOW',
  'NET', 'DDOG', 'ZS', 'CRWD', 'PANW', 'MDB', 'TEAM', 'OKTA', 'TWLO', 'ROKU'
];

const CRYPTO_WATCHLIST = [
  'BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'DOT', 'MATIC', 'ATOM', 'UNI', 'AAVE',
  'LTC', 'XRP', 'ADA', 'DOGE', 'SHIB', 'PEPE', 'ARB', 'OP', 'SUI', 'APT'
];

interface OHLCBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number; // Optional - not all data sources provide volume
}

// Calculate 20-day high (resistance level)
function calculateResistance(bars: OHLCBar[], lookback: number): number {
  if (bars.length < lookback) return 0;
  
  const relevantBars = bars.slice(-lookback - 1, -1); // Exclude current bar
  return Math.max(...relevantBars.map(b => b.high));
}

// Calculate 20-day low (support level)
function calculateSupport(bars: OHLCBar[], lookback: number): number {
  if (bars.length < lookback) return Infinity;
  
  const relevantBars = bars.slice(-lookback - 1, -1);
  return Math.min(...relevantBars.map(b => b.low));
}

// Calculate average volume (returns 0 if volume data unavailable)
function calculateAverageVolume(bars: OHLCBar[], lookback: number): number {
  if (bars.length < lookback) return 0;
  
  const relevantBars = bars.slice(-lookback - 1, -1);
  const volumes = relevantBars.map(b => b.volume).filter((v): v is number => v !== undefined && v > 0);
  
  // If no volume data available, return 0 to indicate unavailable
  if (volumes.length === 0) return 0;
  
  return volumes.reduce((a, b) => a + b, 0) / volumes.length;
}

/**
 * Check hourly confirmation for breakout
 * Requires: price staying above resistance, higher lows pattern, momentum
 */
async function checkHourlyConfirmation(
  symbol: string,
  resistanceLevel: number,
  isBreakout: boolean
): Promise<HourlyConfirmation> {
  try {
    // Fetch last 24 hours of hourly data
    const hourlyData = await fetchOHLCData(symbol, '1h', 24);
    
    if (!hourlyData || !hourlyData.closes || hourlyData.closes.length < 6) {
      return { confirmed: false, momentum: 'none', barsAboveLevel: 0, higherLows: false };
    }
    
    const closes = hourlyData.closes;
    const lows = hourlyData.lows;
    const lastBars = closes.slice(-6); // Last 6 hours
    const lastLows = lows.slice(-6);
    
    // Count bars above/below the level
    let barsAboveLevel = 0;
    if (isBreakout) {
      barsAboveLevel = lastBars.filter(c => c > resistanceLevel).length;
    } else {
      // For breakdown, count bars below support
      barsAboveLevel = lastBars.filter(c => c < resistanceLevel).length;
    }
    
    // Check for higher lows pattern (bullish) or lower highs (bearish)
    let higherLows = true;
    for (let i = 1; i < lastLows.length; i++) {
      if (isBreakout) {
        if (lastLows[i] < lastLows[i - 1] * 0.998) { // Allow 0.2% tolerance
          higherLows = false;
          break;
        }
      } else {
        // For breakdown, check lower highs
        const highs = hourlyData.highs.slice(-6);
        if (highs[i] > highs[i - 1] * 1.002) {
          higherLows = false;
          break;
        }
      }
    }
    
    // Calculate hourly momentum
    const priceChange = ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100;
    let momentum: 'strong' | 'moderate' | 'weak' | 'none' = 'none';
    
    if (isBreakout) {
      if (priceChange > 2) momentum = 'strong';
      else if (priceChange > 0.5) momentum = 'moderate';
      else if (priceChange > 0) momentum = 'weak';
    } else {
      if (priceChange < -2) momentum = 'strong';
      else if (priceChange < -0.5) momentum = 'moderate';
      else if (priceChange < 0) momentum = 'weak';
    }
    
    // Confirmation requires: 4+ bars above level AND (higher lows OR strong momentum)
    const confirmed = barsAboveLevel >= 4 && (higherLows || momentum === 'strong' || momentum === 'moderate');
    
    return {
      confirmed,
      momentum,
      barsAboveLevel,
      higherLows
    };
  } catch (error) {
    console.log(`[BreakoutScanner] Hourly confirmation unavailable for ${symbol}`);
    return { confirmed: false, momentum: 'none', barsAboveLevel: 0, higherLows: false };
  }
}

// Determine breakout strength (volume ratio of 1 means no volume data)
function getBreakoutStrength(breakoutPercent: number, volumeRatio: number, hasVolumeData: boolean): 'weak' | 'moderate' | 'strong' {
  // If no volume data, use price breakout strength only
  if (!hasVolumeData) {
    if (breakoutPercent >= 3) return 'strong';
    if (breakoutPercent >= 1.5) return 'moderate';
    return 'weak';
  }
  
  // With volume data, combine price and volume signals
  const score = breakoutPercent * 2 + (volumeRatio - 1) * 10;
  
  if (score >= 15) return 'strong';
  if (score >= 8) return 'moderate';
  return 'weak';
}

// Scan single symbol for breakout
export async function scanSymbolForBreakout(
  symbol: string,
  config: Partial<ScannerConfig> = {}
): Promise<BreakoutSignal | null> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  try {
    // Fetch daily data
    const result = await fetchOHLCData(symbol, '1d', cfg.lookbackDays + 10);
    
    if (!result || !result.closes || result.closes.length < cfg.lookbackDays) {
      return null;
    }
    
    // Convert OHLCData arrays to OHLCBar objects
    // Note: Volume data not available from fetchOHLCData, volume confirmation disabled
    const bars: OHLCBar[] = result.dates.map((date, i) => ({
      date,
      open: result.opens[i],
      high: result.highs[i],
      low: result.lows[i],
      close: result.closes[i],
      volume: undefined // Volume not available from data source
    }));
    
    const currentBar = bars[bars.length - 1];
    const resistance = calculateResistance(bars, cfg.lookbackDays);
    const support = calculateSupport(bars, cfg.lookbackDays);
    const avgVolume = calculateAverageVolume(bars, cfg.lookbackDays);
    
    const currentPrice = currentBar.close;
    const currentVolume = currentBar.volume || 0;
    const hasVolumeData = avgVolume > 0 && currentVolume > 0;
    const volumeRatio = hasVolumeData ? currentVolume / avgVolume : 1;
    
    // Check for breakout (price closes above resistance)
    const breakoutPercent = ((currentPrice - resistance) / resistance) * 100;
    const isBreakout = breakoutPercent >= cfg.breakoutThresholdPercent;
    
    // Check for breakdown (price closes below support)
    const breakdownPercent = ((support - currentPrice) / support) * 100;
    const isBreakdown = breakdownPercent >= cfg.breakoutThresholdPercent;
    
    if (!isBreakout && !isBreakdown) {
      return null;
    }
    
    const signalType = isBreakout ? 'breakout' : 'breakdown';
    const percentMove = isBreakout ? breakoutPercent : breakdownPercent;
    
    // 📐 ATR-BASED TARGET/STOP — replaces fixed % heuristic
    // Uses 14-period ATR multiplied by holding-period factors for volatility-aware levels.
    const entryPrice = currentPrice;
    const atrResult = calculateATRTargets({
      currentPrice: entryPrice,
      highs: result.highs,
      lows: result.lows,
      closes: result.closes,
      direction: isBreakout ? 'long' : 'short',
      holdingPeriod: 'swing',
    });
    const stopLoss = atrResult.stop;
    const target = atrResult.target;
    const riskRewardRatio = atrResult.riskRewardRatio;
    
    // Calculate confidence (price-based strength when no volume data)
    const strength = getBreakoutStrength(percentMove, volumeRatio, hasVolumeData);
    let confidence = 50;
    if (strength === 'strong') confidence = 85;
    else if (strength === 'moderate') confidence = 70;
    else confidence = 55;
    
    // Volume confirmation bonus (only if volume data available)
    if (hasVolumeData && volumeRatio >= cfg.volumeMultiplier) {
      confidence += 10;
    }
    
    // Check hourly confirmation
    const hourlyConfirm = await checkHourlyConfirmation(
      symbol, 
      isBreakout ? resistance : support,
      isBreakout
    );
    
    // Hourly confirmation bonus
    if (hourlyConfirm.confirmed) {
      confidence += 15;
    }
    if (hourlyConfirm.momentum === 'strong') {
      confidence += 5;
    }
    
    return {
      symbol,
      signalType,
      resistanceLevel: resistance,
      supportLevel: support,
      currentPrice,
      breakoutPercent: percentMove,
      volumeRatio,
      strength,
      confidence: Math.min(confidence, 95),
      entryPrice,
      suggestedStopLoss: stopLoss,
      suggestedTarget: target,
      riskRewardRatio,
      timestamp: new Date().toISOString(),
      // Hourly confirmation data
      hourlyConfirmed: hourlyConfirm.confirmed,
      hourlyMomentum: hourlyConfirm.momentum,
      hourlyBarsAboveResistance: hourlyConfirm.barsAboveLevel,
      hourlyHigherLows: hourlyConfirm.higherLows
    };
  } catch (error) {
    console.error(`[BreakoutScanner] Error scanning ${symbol}:`, error);
    return null;
  }
}

// Scan multiple symbols
export async function scanMultipleSymbols(
  symbols: string[],
  config: Partial<ScannerConfig> = {}
): Promise<BreakoutSignal[]> {
  console.log(`[BreakoutScanner] Scanning ${symbols.length} symbols for breakouts...`);
  
  const signals: BreakoutSignal[] = [];
  
  // Process in batches to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(symbol => scanSymbolForBreakout(symbol, config))
    );
    
    for (const signal of results) {
      if (signal) {
        signals.push(signal);
      }
    }
    
    // Small delay between batches
    if (i + batchSize < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Sort by confidence
  signals.sort((a, b) => b.confidence - a.confidence);
  
  console.log(`[BreakoutScanner] Found ${signals.length} breakout signals`);
  return signals;
}

// Scan all stocks
export async function scanStocksForBreakouts(
  config: Partial<ScannerConfig> = {}
): Promise<BreakoutSignal[]> {
  /**
   * Scan the liquid universe, not a 30-symbol hand list.
   *
   * STOCK_WATCHLIST holds 30 tickers. A breakout scanner restricted to 30 names
   * cannot find a breakout in the other 1,970 liquid names, so its output was
   * never a read on the market — it was a read on that list.
   *
   * Same defect as bull-flag-scanner had (90 hand-typed names against 2,000
   * with bars loaded). See the comment there for the ORCL case that exposed it.
   *
   * The hand list is unioned in so nothing that used to be scanned drops out
   * when the universe is cold.
   */
  let universe: string[] = STOCK_WATCHLIST;
  try {
    const { getLiquidSymbols, loadLiquidUniverseFromDisk } = await import('./liquid-universe');
    if (getLiquidSymbols().length === 0) await loadLiquidUniverseFromDisk();
    const liquid = getLiquidSymbols();
    if (liquid.length > 0) {
      universe = Array.from(new Set([...STOCK_WATCHLIST, ...liquid].map((x) => x.toUpperCase())));
    }
  } catch { /* cold universe — the hand list still scans */ }
  return scanMultipleSymbols(universe, config);
}

// Scan all crypto
export async function scanCryptoForBreakouts(
  config: Partial<ScannerConfig> = {}
): Promise<BreakoutSignal[]> {
  return scanMultipleSymbols(CRYPTO_WATCHLIST, config);
}

// Full market scan
export async function fullMarketScan(
  config: Partial<ScannerConfig> = {}
): Promise<{
  stocks: BreakoutSignal[];
  crypto: BreakoutSignal[];
  totalSignals: number;
  timestamp: string;
}> {
  console.log('[BreakoutScanner] Running full market scan...');
  
  const [stocks, crypto] = await Promise.all([
    scanStocksForBreakouts(config),
    scanCryptoForBreakouts(config)
  ]);
  
  return {
    stocks,
    crypto,
    totalSignals: stocks.length + crypto.length,
    timestamp: new Date().toISOString()
  };
}

// Get scanner configuration
export function getScannerConfig(): ScannerConfig {
  return { ...DEFAULT_CONFIG };
}

// Get watchlists
export function getWatchlists() {
  return {
    stocks: STOCK_WATCHLIST,
    crypto: CRYPTO_WATCHLIST
  };
}
