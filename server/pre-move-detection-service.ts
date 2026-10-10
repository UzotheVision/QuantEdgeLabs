// Pre-Move Detection Service
// Detects potential stock moves BEFORE news or market close
// Monitors: Late-day options flow, volume spikes, IV expansion, defense contracts

import { getTradierQuote, getTradierOptionsChainsByDTE } from './tradier-api';
import { sendPreMoveAlertToDiscord } from './discord-service';
import { logger } from './logger';
import { isUSMarketOpen } from '@shared/market-calendar';
import { fetchGovernmentContractsForTicker } from './catalyst-intelligence-service';

// Defense & Aerospace stocks to monitor closely
export const DEFENSE_TICKERS = ['LMT', 'RTX', 'NOC', 'GD', 'BA', 'HII', 'LHX', 'LDOS', 'KTOS', 'AVAV'];

// High-profile movers to watch
export const HIGH_PROFILE_TICKERS = [
  ...DEFENSE_TICKERS,
  'NVDA', 'TSLA', 'AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'AMD', 'PLTR', 'COIN',
  'GME', 'AMC', 'MSTR', 'SMCI', 'ARM', 'IONQ', 'RGTI', 'QUBT'
];

// Pre-move signal types
export type PreMoveSignalType = 
  | 'late_day_sweep'      // Large options sweep in final hour
  | 'volume_spike'        // Volume > 2x average in last 30 min
  | 'iv_expansion'        // IV rising without news
  | 'defense_contract'    // Government contract filing
  | 'unusual_accumulation' // Quiet accumulation pattern
  | 'sector_momentum';    // Sector leader moving, others follow

export interface PreMoveSignal {
  symbol: string;
  signalType: PreMoveSignalType;
  confidence: number; // 0-100
  direction: 'bullish' | 'bearish' | 'neutral';
  details: string;
  timestamp: Date;
  metrics: {
    currentPrice?: number;
    volumeRatio?: number;      // Today's volume / 20-day avg
    ivChange?: number;         // IV change in %
    optionPremium?: number;    // Large sweep premium
    contractValue?: number;    // Government contract $
  };
}

// Cache for baseline metrics
const baselineCache = new Map<string, {
  avgVolume: number;
  avgIV: number;
  lastUpdate: number;
}>();

const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

// Track alerted signals to prevent duplicates
const alertedSignals = new Map<string, number>();
const ALERT_COOLDOWN = 60 * 60 * 1000; // 1 HOUR per signal type (was 30 min - too spammy)

// Track alerts per symbol (stricter - prevents same stock from spamming)
const alertedSymbols = new Map<string, number>();
const SYMBOL_COOLDOWN = 2 * 60 * 60 * 1000; // 2 hours per symbol

// Global alert rate limits
let lastAlertTime = 0;
const MIN_ALERT_INTERVAL = 60 * 1000; // 1 minute between ANY alerts
const MAX_ALERTS_PER_SCAN = 3; // Maximum 3 alerts per scan cycle

// Volume snapshot cache for incremental volume tracking
// Key: symbol, Value: { volume at 3:30 PM, timestamp }
const volumeSnapshotCache = new Map<string, {
  volume: number;
  timestamp: number;
}>();

// Options volume snapshot for power-hour delta tracking
// Key: symbol, Value: { total options volume at 3:00 PM, sweepPremium, timestamp }
const optionsVolumeSnapshotCache = new Map<string, {
  callVolume: number;
  putVolume: number;
  topSweepPremium: number;
  timestamp: number;
}>();

const SNAPSHOT_VALIDITY = 90 * 60 * 1000; // 90 minutes - reset for next trading day

function getSignalKey(signal: PreMoveSignal): string {
  return `${signal.symbol}:${signal.signalType}:${signal.direction}`;
}

function canAlert(signal: PreMoveSignal): boolean {
  const now = Date.now();

  // Check global rate limit (no more than 1 alert per minute)
  if (now - lastAlertTime < MIN_ALERT_INTERVAL) {
    return false;
  }

  // Check per-symbol cooldown (2 hours between any alerts for same stock)
  const lastSymbolAlert = alertedSymbols.get(signal.symbol);
  if (lastSymbolAlert && now - lastSymbolAlert < SYMBOL_COOLDOWN) {
    return false;
  }

  // Check per-signal-type cooldown (1 hour for exact same signal)
  const key = getSignalKey(signal);
  const lastSignalAlert = alertedSignals.get(key);
  if (lastSignalAlert && now - lastSignalAlert < ALERT_COOLDOWN) {
    return false;
  }

  return true;
}

function recordAlert(signal: PreMoveSignal): void {
  const now = Date.now();
  alertedSignals.set(getSignalKey(signal), now);
  alertedSymbols.set(signal.symbol, now);
  lastAlertTime = now;
}

// Check if we're in the "power hour" (last hour before close)
function isInPowerHour(): boolean {
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hours = etNow.getHours();
  const minutes = etNow.getMinutes();
  
  // Power hour: 3:00 PM - 4:00 PM ET
  return hours === 15 || (hours === 16 && minutes === 0);
}

// Check if we're in the final 30 minutes
function isInFinal30Minutes(): boolean {
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hours = etNow.getHours();
  const minutes = etNow.getMinutes();
  
  // Final 30 min: 3:30 PM - 4:00 PM ET
  return hours === 15 && minutes >= 30;
}

// Take options volume snapshot at start of power hour (3:00 PM) for delta tracking
export async function snapshotOptionsVolumeIfNeeded(ticker: string): Promise<void> {
  const now = Date.now();
  const cached = optionsVolumeSnapshotCache.get(ticker);
  
  if (cached && now - cached.timestamp < SNAPSHOT_VALIDITY) return;
  
  const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hours = etNow.getHours();
  const minutes = etNow.getMinutes();
  
  // Snapshot window: 2:55 PM - 3:05 PM ET (start of power hour)
  if (hours === 14 && minutes >= 55 || hours === 15 && minutes <= 5) {
    try {
      const options = await getTradierOptionsChainsByDTE(ticker);
      if (!options || options.length === 0) return;
      
      let totalCallVol = 0;
      let totalPutVol = 0;
      let topPremium = 0;
      
      for (const opt of options) {
        if (!opt.volume) continue;
        const premium = opt.volume * (opt.last || opt.bid || 0) * 100;
        if (opt.option_type === 'call') totalCallVol += opt.volume;
        else totalPutVol += opt.volume;
        if (premium > topPremium) topPremium = premium;
      }
      
      optionsVolumeSnapshotCache.set(ticker, {
        callVolume: totalCallVol,
        putVolume: totalPutVol,
        topSweepPremium: topPremium,
        timestamp: now
      });
      logger.debug(`[PRE-MOVE] Options snapshot for ${ticker}: ${totalCallVol} calls, ${totalPutVol} puts`);
    } catch (e) {
      // Ignore errors
    }
  }
}

// Detect late-day options sweeps with delta tracking
export async function detectLateDaySweeps(ticker: string): Promise<PreMoveSignal | null> {
  if (!isInPowerHour()) return null;
  
  try {
    const options = await getTradierOptionsChainsByDTE(ticker);
    if (!options || options.length === 0) return null;
    
    const now = Date.now();
    const snapshot = optionsVolumeSnapshotCache.get(ticker);
    
    // Look for large volume on short-dated options
    let totalCallVolume = 0;
    let totalPutVolume = 0;
    let largestSweep = { volume: 0, premium: 0, type: 'call' as 'call' | 'put', strike: 0 };
    
    for (const opt of options) {
      if (!opt.volume || opt.volume < 100) continue;
      
      const premium = (opt.volume * (opt.last || opt.bid || 0) * 100);
      
      if (opt.option_type === 'call') {
        totalCallVolume += opt.volume;
        if (premium > largestSweep.premium) {
          largestSweep = { volume: opt.volume, premium, type: 'call', strike: opt.strike };
        }
      } else {
        totalPutVolume += opt.volume;
        if (premium > largestSweep.premium) {
          largestSweep = { volume: opt.volume, premium, type: 'put', strike: opt.strike };
        }
      }
    }
    
    // Calculate delta if we have a snapshot
    let incrementalPremium = largestSweep.premium;
    let hasIncrementalData = false;
    let powerHourCallDelta = 0;
    let powerHourPutDelta = 0;
    
    if (snapshot && now - snapshot.timestamp < SNAPSHOT_VALIDITY) {
      powerHourCallDelta = totalCallVolume - snapshot.callVolume;
      powerHourPutDelta = totalPutVolume - snapshot.putVolume;
      
      // Only count premium accumulated during power hour
      if (snapshot.topSweepPremium > 0) {
        incrementalPremium = Math.max(0, largestSweep.premium - snapshot.topSweepPremium);
      }
      hasIncrementalData = true;
    }
    
    // Significant sweep: > $500k premium (or incremental premium during power hour)
    if (incrementalPremium < 500000) return null;
    
    const direction = largestSweep.type === 'call' ? 'bullish' : 'bearish';
    const confidence = Math.min(95, 70 + Math.floor(incrementalPremium / 200000));
    
    const quote = await getTradierQuote(ticker);
    
    const deltaInfo = hasIncrementalData 
      ? ` (Power hour: +${powerHourCallDelta.toLocaleString()} calls, +${powerHourPutDelta.toLocaleString()} puts)`
      : '';
    
    return {
      symbol: ticker,
      signalType: 'late_day_sweep',
      confidence,
      direction,
      details: `🔥 POWER HOUR SWEEP: ${ticker} $${largestSweep.strike} ${largestSweep.type.toUpperCase()} - ${largestSweep.volume.toLocaleString()} contracts, $${(incrementalPremium / 1000000).toFixed(2)}M premium${deltaInfo}`,
      timestamp: new Date(),
      metrics: {
        currentPrice: quote?.last || 0,
        optionPremium: incrementalPremium
      }
    };
  } catch (e) {
    logger.error(`[PRE-MOVE] Error detecting sweeps for ${ticker}:`, e);
    return null;
  }
}

// Take volume snapshot at 3:30 PM for later comparison
export async function snapshotVolumeIfNeeded(ticker: string): Promise<void> {
  const now = Date.now();
  const cached = volumeSnapshotCache.get(ticker);
  
  // Only take snapshot once per day (check if current snapshot is still valid)
  if (cached && now - cached.timestamp < SNAPSHOT_VALIDITY) return;
  
  // Take snapshot around 3:30 PM ET (start of final 30 min window)
  const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hours = etNow.getHours();
  const minutes = etNow.getMinutes();
  
  // Snapshot window: 3:25 PM - 3:35 PM ET
  if (hours === 15 && minutes >= 25 && minutes <= 35) {
    try {
      const quote = await getTradierQuote(ticker);
      if (quote?.volume) {
        volumeSnapshotCache.set(ticker, {
          volume: quote.volume,
          timestamp: now
        });
        logger.debug(`[PRE-MOVE] Volume snapshot for ${ticker}: ${quote.volume.toLocaleString()} shares`);
      }
    } catch (e) {
      // Ignore errors for snapshots
    }
  }
}

// Detect volume spikes in final 30 minutes using incremental volume tracking
export async function detectVolumeSpike(ticker: string): Promise<PreMoveSignal | null> {
  if (!isInFinal30Minutes()) return null;
  
  try {
    const quote = await getTradierQuote(ticker);
    if (!quote || !quote.volume || !quote.average_volume) return null;
    
    const now = Date.now();
    const snapshot = volumeSnapshotCache.get(ticker);
    
    // Calculate incremental volume in final 30 minutes
    let incrementalVolume = 0;
    let incrementalRatio = 0;
    let hasIncrementalData = false;
    
    if (snapshot && now - snapshot.timestamp < SNAPSHOT_VALIDITY && snapshot.timestamp < now) {
      incrementalVolume = quote.volume - snapshot.volume;
      
      // Expected volume in 30 min is roughly 1/13 of daily average (6.5 hour trading day)
      const expected30MinVolume = quote.average_volume / 13;
      incrementalRatio = incrementalVolume / expected30MinVolume;
      hasIncrementalData = true;
      
      // Need at least 2x expected volume for this 30-min window
      if (incrementalRatio < 2) return null;
    } else {
      // Fallback to full-day comparison if no snapshot available
      const volumeRatio = quote.volume / quote.average_volume;
      if (volumeRatio < 2.5) return null; // Higher threshold for fallback
      incrementalRatio = volumeRatio;
    }
    
    // Price direction determines bullish/bearish
    const priceChange = quote.change_percentage || 0;
    const direction = priceChange > 0.5 ? 'bullish' : priceChange < -0.5 ? 'bearish' : 'neutral';
    
    const confidence = Math.min(90, 60 + Math.floor(incrementalRatio * 5));
    
    return {
      symbol: ticker,
      signalType: 'volume_spike',
      confidence,
      direction,
      details: `📊 ${hasIncrementalData ? 'LATE-DAY' : 'ELEVATED'} VOLUME: ${ticker} trading at ${incrementalRatio.toFixed(1)}x ${hasIncrementalData ? 'expected final 30-min' : 'average'} volume${hasIncrementalData ? ` (+${incrementalVolume.toLocaleString()} shares since 3:30)` : ''}. Price ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%`,
      timestamp: new Date(),
      metrics: {
        currentPrice: quote.last,
        volumeRatio: incrementalRatio
      }
    };
  } catch (e) {
    logger.error(`[PRE-MOVE] Error detecting volume spike for ${ticker}:`, e);
    return null;
  }
}

// Detect IV expansion without news (someone knows something)
export async function detectIVExpansion(ticker: string): Promise<PreMoveSignal | null> {
  try {
    const options = await getTradierOptionsChainsByDTE(ticker);
    if (!options || options.length === 0) return null;
    
    // Calculate average ATM IV
    const quote = await getTradierQuote(ticker);
    if (!quote || !quote.last) return null;
    
    const atPrice = quote.last;
    const atmOptions = options.filter(opt => {
      const distance = Math.abs(opt.strike - atPrice) / atPrice;
      return distance < 0.05 && opt.greeks?.mid_iv;
    });
    
    if (atmOptions.length === 0) return null;
    
    const currentIV = atmOptions.reduce((sum, opt) => sum + (opt.greeks?.mid_iv || 0), 0) / atmOptions.length;
    
    // Check against baseline
    const cached = baselineCache.get(ticker);
    const now = Date.now();
    
    if (!cached || now - cached.lastUpdate > CACHE_TTL) {
      // Set baseline
      baselineCache.set(ticker, {
        avgVolume: quote.average_volume || quote.volume || 0,
        avgIV: currentIV,
        lastUpdate: now
      });
      return null;
    }
    
    const ivChange = ((currentIV - cached.avgIV) / cached.avgIV) * 100;
    
    // Need at least 15% IV expansion
    if (ivChange < 15) return null;
    
    const confidence = Math.min(88, 65 + Math.floor(ivChange / 2));
    
    return {
      symbol: ticker,
      signalType: 'iv_expansion',
      confidence,
      direction: 'neutral', // IV expansion alone doesn't indicate direction
      details: `⚡ IV EXPANSION: ${ticker} IV up ${ivChange.toFixed(1)}% from baseline (${(cached.avgIV * 100).toFixed(0)}% → ${(currentIV * 100).toFixed(0)}%). Market pricing in a move.`,
      timestamp: new Date(),
      metrics: {
        currentPrice: quote.last,
        ivChange
      }
    };
  } catch (e) {
    logger.error(`[PRE-MOVE] Error detecting IV expansion for ${ticker}:`, e);
    return null;
  }
}

// Monitor defense contracts (for LMT, RTX, NOC, etc.)
export async function checkDefenseContracts(ticker: string): Promise<PreMoveSignal | null> {
  if (!DEFENSE_TICKERS.includes(ticker)) return null;
  
  try {
    const contracts = await fetchGovernmentContractsForTicker(ticker);
    if (!contracts || contracts.length === 0) return null;
    
    // Check for recent contracts (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentContracts = contracts.filter(c => new Date(c.awardDate) > oneDayAgo);
    
    if (recentContracts.length === 0) return null;
    
    // Find largest contract
    const largest = recentContracts.reduce((max, c) => 
      (c.obligationAmount || 0) > (max.obligationAmount || 0) ? c : max
    );
    
    if (!largest.obligationAmount || largest.obligationAmount < 10000000) return null; // Min $10M
    
    const quote = await getTradierQuote(ticker);
    const confidence = Math.min(95, 75 + Math.floor(Math.log10(largest.obligationAmount) * 3));
    
    return {
      symbol: ticker,
      signalType: 'defense_contract',
      confidence,
      direction: 'bullish',
      details: `🇺🇸 DEFENSE CONTRACT: ${ticker} awarded $${(largest.obligationAmount / 1000000).toFixed(1)}M contract from ${largest.awardingAgencyName || 'Government'}. ${largest.description?.slice(0, 100) || ''}`,
      timestamp: new Date(),
      metrics: {
        currentPrice: quote?.last || 0,
        contractValue: largest.obligationAmount
      }
    };
  } catch (e) {
    logger.error(`[PRE-MOVE] Error checking defense contracts for ${ticker}:`, e);
    return null;
  }
}

// Main scan function - runs all detection algorithms
// Options: skipAlerts - when true, just returns signals without sending Discord alerts (for convergence engine)
export async function scanForPreMoveSignals(
  tickers: string[] = HIGH_PROFILE_TICKERS,
  options: { skipAlerts?: boolean } = {}
): Promise<PreMoveSignal[]> {
  const marketStatus = isUSMarketOpen();
  if (!marketStatus.isOpen) {
    logger.info('[PRE-MOVE] Market closed, skipping scan');
    return [];
  }

  logger.info(`[PRE-MOVE] Scanning ${tickers.length} tickers for pre-move signals... (alerts: ${!options.skipAlerts})`);
  const signals: PreMoveSignal[] = [];
  
  // Process in batches to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (ticker) => {
      const tickerSignals: PreMoveSignal[] = [];
      
      // Take snapshots for incremental tracking (these are no-ops if already cached)
      await Promise.all([
        snapshotOptionsVolumeIfNeeded(ticker),
        snapshotVolumeIfNeeded(ticker)
      ]);
      
      // Run all detection algorithms in parallel
      const [sweep, volume, iv, contract] = await Promise.all([
        detectLateDaySweeps(ticker),
        detectVolumeSpike(ticker),
        detectIVExpansion(ticker),
        checkDefenseContracts(ticker)
      ]);
      
      if (sweep) tickerSignals.push(sweep);
      if (volume) tickerSignals.push(volume);
      if (iv) tickerSignals.push(iv);
      if (contract) tickerSignals.push(contract);
      
      return tickerSignals;
    });
    
    const batchResults = await Promise.all(batchPromises);
    for (const result of batchResults) {
      signals.push(...result);
    }
    
    // Small delay between batches
    if (i + batchSize < tickers.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Sort by confidence
  signals.sort((a, b) => b.confidence - a.confidence);

  // Send alerts for high-confidence signals (MAX 3 per scan to prevent spam)
  // Skip alerts if called from convergence engine (to prevent duplicate alerts)
  if (!options.skipAlerts) {
    let alertsSent = 0;
    for (const signal of signals) {
      // Enforce max alerts per scan
      if (alertsSent >= MAX_ALERTS_PER_SCAN) {
        logger.debug(`[PRE-MOVE] Max alerts per scan reached (${MAX_ALERTS_PER_SCAN}), skipping remaining signals`);
        break;
      }

      // Only alert A+ confidence (90%+) to reduce noise
      if (signal.confidence >= 90 && canAlert(signal)) {
        try {
          await sendPreMoveAlertToDiscord(signal);
          recordAlert(signal);
          alertsSent++;
          logger.info(`[PRE-MOVE] Alert sent: ${signal.symbol} - ${signal.signalType} (${signal.confidence}%)`);

          // Wait 2 seconds between alerts to prevent Discord rate limits
          await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
          logger.error(`[PRE-MOVE] Failed to send alert for ${signal.symbol}:`, e);
        }
      }
    }
  }

  logger.info(`[PRE-MOVE] Scan complete. Found ${signals.length} signals, ${signals.filter(s => s.confidence >= 90).length} A+ signals`);
  
  return signals;
}

// Schedule regular scans during market hours
let scanInterval: ReturnType<typeof setInterval> | null = null;

export function startPreMoveScanner(): void {
  if (scanInterval) return;
  
  logger.info('[PRE-MOVE] Starting Pre-Move Detection Scanner...');
  
  // Run every 5 minutes during market hours
  scanInterval = setInterval(async () => {
    const marketStatus = isUSMarketOpen();
    if (!marketStatus.isOpen) return;
    
    // Intensify scanning during power hour
    if (isInPowerHour()) {
      await scanForPreMoveSignals(HIGH_PROFILE_TICKERS);
    } else {
      // Regular hours: just scan defense stocks
      await scanForPreMoveSignals(DEFENSE_TICKERS);
    }
  }, 5 * 60 * 1000);
  
  // Initial scan
  scanForPreMoveSignals(DEFENSE_TICKERS).catch(console.error);
}

export function stopPreMoveScanner(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    logger.info('[PRE-MOVE] Pre-Move Detection Scanner stopped');
  }
}
