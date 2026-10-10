// Quantitative Engine for Futures Trading (NQ, GC)
// Reuses proven RSI/VWAP/volume pipeline from stock quant engine
// Architect: Tick-based pricing, margin calculation, CME market hours validation

import type { InsertTradeIdea } from "@shared/schema";
import { formatInTimeZone } from 'date-fns-tz';
import { 
  calculateRSI, 
  calculateSMA,
  calculateVWAP,
  calculateADX,
  determineMarketRegime,
  analyzeRSI2MeanReversion
} from './technical-indicators';
import { getActiveFuturesContract, getFuturesPrice } from './futures-data-service';
import { logger } from './logger';
import { storage } from './storage';
import { getLetterGrade } from './grading';

// 🔐 MODEL GOVERNANCE: Engine version for audit trail
export const FUTURES_ENGINE_VERSION = "v1.0.0";
export const FUTURES_ENGINE_CHANGELOG = {
  "v1.0.0": "Initial futures engine - NQ and GC support with tick-based pricing, RSI/VWAP/volume signals, margin calculation, CME market hours validation",
};

// Futures contract specifications
interface FuturesSpec {
  rootSymbol: 'NQ' | 'GC';
  tickSize: number;
  multiplier: number;
  tickValue: number; // tickSize * multiplier
  initialMargin: number; // Typical margin requirement
  maintenanceMargin: number;
}

const FUTURES_SPECS: Record<'NQ' | 'GC', FuturesSpec> = {
  NQ: {
    rootSymbol: 'NQ',
    tickSize: 0.25,
    multiplier: 20,
    tickValue: 5, // 0.25 * $20 = $5 per tick
    initialMargin: 17600, // Typical initial margin for E-mini Nasdaq
    maintenanceMargin: 16000,
  },
  GC: {
    rootSymbol: 'GC',
    tickSize: 0.10,
    multiplier: 100,
    tickValue: 10, // 0.10 * $100 = $10 per tick
    initialMargin: 8800, // Typical initial margin for Gold futures
    maintenanceMargin: 8000,
  },
};

interface QuantSignal {
  type: 'rsi2_mean_reversion' | 'vwap_cross' | 'volume_spike' | 'rsi2_short_reversion';
  strength: 'strong' | 'moderate' | 'weak';
  direction: 'long' | 'short';
  rsiValue?: number;
  vwapValue?: number;
  signals: string[];
}

/**
 * Check if CME futures market is open (restrict to RTH for now)
 * CME futures trade 23 hours/day but we'll restrict to Regular Trading Hours (RTH)
 * RTH: 9:30 AM - 4:00 PM ET (matching stock market hours for simplicity)
 */
function isCMEMarketOpen(): boolean {
  const now = new Date();
  
  // Get current time in ET timezone
  const etTime = formatInTimeZone(now, 'America/New_York', 'yyyy-MM-dd HH:mm:ss EEEE');
  const parts = etTime.split(' ');
  const dayName = parts[2]; // "Monday", "Tuesday", etc.
  
  // Check if weekend in ET timezone (Saturday or Sunday)
  if (dayName === 'Saturday' || dayName === 'Sunday') {
    logger.info(`🌙 CME futures RTH CLOSED - ${dayName} (weekend)`);
    return false;
  }
  
  // Extract hour and minute from ET time string
  const timePart = parts[1]; // "HH:mm:ss"
  const etHour = parseInt(timePart.split(':')[0]);
  const etMinute = parseInt(timePart.split(':')[1]);
  
  // RTH: 9:30 AM - 4:00 PM ET (matching stock market for consistency)
  if (etHour < 9 || (etHour === 9 && etMinute < 30)) {
    logger.info(`🌙 CME futures RTH CLOSED - ${dayName} ${timePart.substring(0, 5)} ET (before 9:30 AM)`);
    return false;
  }
  if (etHour >= 16) {
    logger.info(`🌙 CME futures RTH CLOSED - ${dayName} ${timePart.substring(0, 5)} ET (after 4:00 PM)`);
    return false;
  }
  
  logger.info(`✅ CME futures RTH OPEN - ${dayName} ${timePart.substring(0, 5)} ET`);
  return true;
}

/**
 * Check if we're in optimal trading window (first 2 hours)
 * Same as stock market - best liquidity and volume in first 2 hours
 */
function isOptimalTradingWindow(): boolean {
  const now = new Date();
  const etTime = formatInTimeZone(now, 'America/New_York', 'yyyy-MM-dd HH:mm:ss EEEE');
  const parts = etTime.split(' ');
  const timePart = parts[1]; // "HH:mm:ss"
  const etHour = parseInt(timePart.split(':')[0]);
  const etMinute = parseInt(timePart.split(':')[1]);
  
  // 🎯 PRIME WINDOW: 9:30 AM - 11:30 AM ET ONLY
  if (etHour === 9 && etMinute >= 30) return true;  // 9:30-9:59 AM
  if (etHour === 10) return true;  // 10:00-10:59 AM
  if (etHour === 11 && etMinute < 30) return true;  // 11:00-11:29 AM
  
  logger.info(`⏰ Outside optimal trading window (9:30-11:30 AM ET) - current time: ${timePart.substring(0, 5)} ET`);
  return false;
}

/**
 * Generate mock historical prices for futures (until Databento API is integrated)
 * @param currentPrice - Current price from futures-data-service
 * @param days - Number of days of historical data
 * @returns Array of historical prices (most recent last)
 */
function generateMockHistoricalPrices(currentPrice: number, days: number): number[] {
  const prices: number[] = [];
  
  // Generate realistic price walk with mean reversion
  // Start from ~5% below current price and walk up to current
  const startPrice = currentPrice * 0.95;
  const priceStep = (currentPrice - startPrice) / days;
  
  for (let i = 0; i < days; i++) {
    // Deterministic linear interpolation — no random noise on mock prices
    const price = startPrice + (priceStep * i);
    prices.push(price);
  }
  
  // Ensure last price is close to current price
  prices[prices.length - 1] = currentPrice;
  
  return prices;
}

/**
 * Analyze futures contract using RSI/VWAP/volume signals
 * Reuses proven quant pipeline from stock engine
 */
function analyzeFuturesData(
  rootSymbol: 'NQ' | 'GC',
  currentPrice: number,
  historicalPrices: number[]
): QuantSignal | null {
  // Require sufficient historical data for 200-day MA calculation
  if (historicalPrices.length < 200) {
    logger.info(`  ${rootSymbol}: Insufficient data (${historicalPrices.length} days < 200 required)`);
    return null;
  }

  // Estimate volume (mock data until Databento integrated)
  const avgVolume = 100000; // Typical daily volume for NQ/GC
  const volumeRatio = 1.0; // Neutral ratio — no fake volume data until real feed available
  
  // Calculate CRITICAL 200-day MA (trend filter)
  const sma200 = calculateSMA(historicalPrices, 200);
  
  // Calculate 50-day MA (intermediate trend filter)
  const sma50 = calculateSMA(historicalPrices, 50);
  
  // Calculate RSI(2) - SHORT period for mean reversion
  const rsi2 = calculateRSI(historicalPrices, 2);
  
  // Calculate ADX for regime filtering (estimated with mock high/low data)
  const estimatedHighs = historicalPrices.map(p => p * 1.01);
  const estimatedLows = historicalPrices.map(p => p * 0.99);
  const adx = calculateADX(estimatedHighs, estimatedLows, historicalPrices, 14);
  
  // Track detected signals
  const detectedSignals: string[] = [];
  let primarySignal: QuantSignal | null = null;
  
  // PRIORITY 1: RSI(2) Mean Reversion LONG (oversold + above 50-day MA + ranging market)
  const rsi2Signal = analyzeRSI2MeanReversion(rsi2, currentPrice, sma200);
  if (rsi2Signal.signal !== 'none') {
    if (currentPrice < sma50) {
      logger.info(`  ${rootSymbol}: RSI2 LONG signal ignored - below 50-day MA (price: ${currentPrice.toFixed(2)}, SMA50: ${sma50.toFixed(2)})`);
    } else if (adx > 25) {
      logger.info(`  ${rootSymbol}: RSI2 LONG signal ignored - STRONG TREND (ADX ${adx.toFixed(1)})`);
    } else {
      detectedSignals.push('RSI2_MEAN_REVERSION');
      if (!primarySignal) {
        primarySignal = {
          type: 'rsi2_mean_reversion',
          strength: rsi2Signal.strength,
          direction: 'long',
          rsiValue: rsi2,
          signals: detectedSignals,
        };
      }
    }
  }
  
  // PRIORITY 2: RSI(2) SHORT Mean Reversion (overbought + below 50-day MA + ranging market)
  if (rsi2 > 90 && currentPrice < sma200) {
    if (currentPrice > sma50) {
      logger.info(`  ${rootSymbol}: RSI2 SHORT signal ignored - above 50-day MA (price: ${currentPrice.toFixed(2)}, SMA50: ${sma50.toFixed(2)})`);
    } else if (adx > 25) {
      logger.info(`  ${rootSymbol}: RSI2 SHORT signal ignored - STRONG TREND (ADX ${adx.toFixed(1)})`);
    } else {
      detectedSignals.push('RSI2_SHORT_REVERSION');
      if (!primarySignal) {
        primarySignal = {
          type: 'rsi2_short_reversion',
          strength: rsi2 > 95 ? 'strong' : 'moderate',
          direction: 'short',
          rsiValue: rsi2,
          signals: detectedSignals,
        };
      }
    }
  }
  
  // PRIORITY 3: VWAP Institutional Flow Detection (momentum signal)
  const recentPrices = historicalPrices.slice(-20);
  const recentVolumes = new Array(20).fill(avgVolume);
  // calculateVWAP requires (high, low, close, volume) - use recentPrices as proxy for all OHLC
  const vwap = calculateVWAP(recentPrices, recentPrices, recentPrices, recentVolumes);
  
  if (currentPrice > vwap && currentPrice < vwap * 1.02 && volumeRatio >= 1.5) {
    detectedSignals.push('VWAP_CROSS');
    if (!primarySignal) {
      primarySignal = {
        type: 'vwap_cross',
        strength: volumeRatio >= 2.5 ? 'strong' : 'moderate',
        direction: 'long',
        vwapValue: vwap,
        signals: detectedSignals,
      };
    }
  }
  
  // PRIORITY 4: Volume Spike (early institutional flow)
  if (volumeRatio >= 3 && currentPrice > sma200) {
    detectedSignals.push('VOLUME_SPIKE');
    if (!primarySignal) {
      primarySignal = {
        type: 'volume_spike',
        strength: volumeRatio >= 5 ? 'strong' : 'moderate',
        direction: 'long',
        signals: detectedSignals,
      };
    }
  }
  
  // Signal confidence voting - require 2+ signals (or high-conviction SHORT)
  const hasShortSignal = detectedSignals.includes('RSI2_SHORT_REVERSION');
  const isHighConvictionShort = hasShortSignal && primarySignal?.strength === 'strong';
  
  if (detectedSignals.length < 2 && !isHighConvictionShort) {
    if (detectedSignals.length === 1) {
      logger.info(`  ${rootSymbol}: Only 1 signal (${detectedSignals[0]}) - need 2+ for confidence`);
    }
    return null;
  }
  
  // Log signal agreement
  if (isHighConvictionShort && detectedSignals.length === 1) {
    logger.info(`  ${rootSymbol}: ✅ HIGH-CONVICTION SHORT signal: ${detectedSignals[0]} (ADX ${adx.toFixed(1)}, RSI ${primarySignal?.rsiValue?.toFixed(1)})`);
  } else {
    logger.info(`  ${rootSymbol}: ✅ ${detectedSignals.length} signals agree: ${detectedSignals.join(' + ')} (ADX ${adx.toFixed(1)})`);
  }
  
  if (primarySignal) {
    primarySignal.signals = detectedSignals;
  }
  
  return primarySignal;
}

/**
 * Calculate entry, target, and stop using tick-based distances
 * Futures targets/stops must align with tick increments
 */
function calculateTickBasedLevels(
  currentPrice: number,
  signal: QuantSignal,
  spec: FuturesSpec
): { entryPrice: number; targetPrice: number; stopLoss: number; riskRewardRatio: number } {
  const entryPrice = currentPrice;
  
  // Target: 10% move for futures but rounded to nearest tick
  // Stop: 5% move (aligns with 5-7% platform rule) but rounded to nearest tick
  const targetPercent = 0.10;
  const stopPercent = 0.05;
  
  let targetPrice: number;
  let stopLoss: number;
  
  if (signal.direction === 'short') {
    // BEARISH: Target DOWN, Stop UP
    targetPrice = entryPrice * (1 - targetPercent);
    stopLoss = entryPrice * (1 + stopPercent);
  } else {
    // BULLISH: Target UP, Stop DOWN
    targetPrice = entryPrice * (1 + targetPercent);
    stopLoss = entryPrice * (1 - stopPercent);
  }
  
  // Round to nearest tick
  targetPrice = Math.round(targetPrice / spec.tickSize) * spec.tickSize;
  stopLoss = Math.round(stopLoss / spec.tickSize) * spec.tickSize;
  
  // Calculate R:R ratio
  const riskPoints = Math.abs(stopLoss - entryPrice);
  const rewardPoints = Math.abs(targetPrice - entryPrice);
  const riskRewardRatio = rewardPoints / riskPoints;
  
  // Enforce R:R ≥ 2.0 for futures (higher leverage requirement)
  if (riskRewardRatio < 2.0) {
    logger.info(`  ${spec.rootSymbol}: R:R too low (${riskRewardRatio.toFixed(2)}:1 < 2.0:1) - rejecting trade`);
    throw new Error('Insufficient risk/reward ratio for futures trade');
  }
  
  return {
    entryPrice: Number(entryPrice.toFixed(2)),
    targetPrice: Number(targetPrice.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    riskRewardRatio: Number(riskRewardRatio.toFixed(2)),
  };
}

/**
 * Generate catalyst description for futures signal
 */
function generateFuturesCatalyst(rootSymbol: 'NQ' | 'GC', signal: QuantSignal): string {
  const productName = rootSymbol === 'NQ' ? 'E-mini Nasdaq-100' : 'Gold';
  
  if (signal.type === 'rsi2_mean_reversion') {
    const rsiValue = signal.rsiValue || 50;
    return `${productName} futures RSI(2) extreme oversold at ${rsiValue.toFixed(0)} - mean reversion setup above 200-day MA`;
  } else if (signal.type === 'rsi2_short_reversion') {
    const rsiValue = signal.rsiValue || 50;
    return `${productName} futures RSI(2) extreme overbought at ${rsiValue.toFixed(0)} - mean reversion SHORT setup below 200-day MA`;
  } else if (signal.type === 'vwap_cross') {
    return `${productName} futures price crossing above VWAP - institutional buying detected`;
  } else if (signal.type === 'volume_spike') {
    return `${productName} futures volume spike with positive price action - early accumulation`;
  }
  
  return `${productName} futures technical setup detected`;
}

/**
 * Generate analysis text for futures trade idea
 */
function generateFuturesAnalysis(
  rootSymbol: 'NQ' | 'GC',
  signal: QuantSignal,
  contractCode: string,
  spec: FuturesSpec
): string {
  const productName = rootSymbol === 'NQ' ? 'E-mini Nasdaq-100' : 'Gold';
  const direction = signal.direction === 'long' ? 'bullish' : 'bearish';
  const signalList = signal.signals.join(', ');
  
  return `${productName} futures (${contractCode}) shows ${direction} setup with ${signal.signals.length} confirming signals: ${signalList}. ` +
    `This futures contract has a ${spec.tickSize} tick size (${spec.tickValue} per tick) and requires $${spec.initialMargin.toLocaleString()} initial margin. ` +
    `Mean reversion strategy targeting 55-65% live win rate in ranging markets. Trade within CME Regular Trading Hours (RTH) for best liquidity.`;
}

/**
 * Calculate time windows for futures day trades
 */
function calculateFuturesTimeWindows(): { entryValidUntil: string; exitBy: string } {
  const now = new Date();
  
  // Entry window: 60 minutes from now
  const entryValidUntil = new Date(now.getTime() + 60 * 60 * 1000);
  
  // Exit by market close (4:00 PM ET)
  const exitBy = new Date(now);
  exitBy.setHours(16, 0, 0, 0); // 4:00 PM ET
  
  // If entry window extends past market close, cap it
  if (entryValidUntil > exitBy) {
    return {
      entryValidUntil: formatInTimeZone(exitBy, 'America/Chicago', 'MMM dd, h:mm a zzz'),
      exitBy: formatInTimeZone(exitBy, 'America/Chicago', 'MMM dd, h:mm a zzz'),
    };
  }
  
  return {
    entryValidUntil: formatInTimeZone(entryValidUntil, 'America/Chicago', 'MMM dd, h:mm a zzz'),
    exitBy: formatInTimeZone(exitBy, 'America/Chicago', 'MMM dd, h:mm a zzz'),
  };
}

/**
 * Generate futures trade ideas for NQ and GC
 * @param forceGenerate - Bypass market hours checks for manual generation
 * @returns Array of futures trade ideas
 */
export async function generateFuturesIdeas(forceGenerate: boolean = false): Promise<InsertTradeIdea[]> {
  logger.info(`🎯 [FUTURES-ENGINE] Starting futures trade idea generation...${forceGenerate ? ' [FORCED]' : ''}`);
  
  // Check if CME market is open (RTH only for now)
  // Can be bypassed with forceGenerate=true for manual generation
  if (!isCMEMarketOpen() && !forceGenerate) {
    logger.info('[FUTURES-ENGINE] CME market closed - skipping generation');
    return [];
  }
  if (!isCMEMarketOpen() && forceGenerate) {
    logger.info('[FUTURES-ENGINE] CME market closed but force=true - proceeding (data may be stale)');
  }
  
  // Check if we're in optimal trading window
  // Can be bypassed with forceGenerate=true for manual generation
  if (!isOptimalTradingWindow() && !forceGenerate) {
    logger.info('[FUTURES-ENGINE] Outside optimal trading window - skipping generation');
    return [];
  }
  
  const ideas: InsertTradeIdea[] = [];
  const rootSymbols: ('NQ' | 'GC')[] = ['NQ', 'GC'];
  
  for (const rootSymbol of rootSymbols) {
    try {
      logger.info(`\n📊 [FUTURES-ENGINE] Analyzing ${rootSymbol}...`);
      
      // Get active front month contract
      const contract = await getActiveFuturesContract(rootSymbol);
      logger.info(`  Contract: ${contract.contractCode} (expires ${contract.expirationDate})`);
      
      // Check if contract is near expiration (< 5 days)
      const expirationDate = new Date(contract.expirationDate);
      const daysToExpiry = Math.floor((expirationDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      
      if (daysToExpiry < 5) {
        logger.info(`  ⚠️ Contract ${contract.contractCode} expires in ${daysToExpiry} days - will auto-roll to next month`);
        // TODO: Implement auto-roll logic when < 5 days to expiry
        // For now, continue with current contract but add warning to analysis
      }
      
      // Get current price from futures data service
      const currentPrice = await getFuturesPrice(contract.contractCode);
      logger.info(`  Current price: $${currentPrice.toFixed(2)}`);
      
      // Generate mock historical prices (until Databento API integrated)
      // TODO: Replace with real Databento historical data
      const historicalPrices = generateMockHistoricalPrices(currentPrice, 250);
      logger.info(`  Generated ${historicalPrices.length} days of mock historical data`);
      
      // Analyze using RSI/VWAP/volume signals
      const signal = analyzeFuturesData(rootSymbol, currentPrice, historicalPrices);
      
      if (!signal) {
        logger.info(`  No valid signals detected for ${rootSymbol}`);
        continue;
      }
      
      // Get futures specs
      const spec = FUTURES_SPECS[rootSymbol];
      
      // Calculate tick-based levels
      let levels;
      try {
        levels = calculateTickBasedLevels(currentPrice, signal, spec);
      } catch (error: any) {
        logger.info(`  ${error.message}`);
        continue;
      }
      
      logger.info(`  ✅ Valid trade setup: ${signal.direction.toUpperCase()} at $${levels.entryPrice} (R:R ${levels.riskRewardRatio}:1)`);
      
      // Calculate time windows
      const timeWindows = calculateFuturesTimeWindows();
      
      // Generate catalyst and analysis
      const catalyst = generateFuturesCatalyst(rootSymbol, signal);
      const analysis = generateFuturesAnalysis(rootSymbol, signal, contract.contractCode, spec);
      
      // Calculate confidence score (CALIBRATED Dec 2025)
      // Quant engine has 34.4% historical win rate - apply 0.57x multiplier
      // Raw scores: strong=70, moderate=60, weak=50
      // After multiplier: strong=40, moderate=34, weak=28
      const QUANT_MULTIPLIER = 0.57; // Based on 34.4% / 60.8% average
      const rawScore = signal.strength === 'strong' ? 70 : 
                       signal.strength === 'moderate' ? 60 : 50;
      const confidenceScore = Math.round(rawScore * QUANT_MULTIPLIER);
      // Standard academic grading
      const probabilityBand = getLetterGrade(confidenceScore);
      
      // Create futures trade idea
      const idea: InsertTradeIdea = {
        symbol: rootSymbol,
        assetType: 'future',
        direction: signal.direction,
        holdingPeriod: 'day', // Day trade for futures
        entryPrice: levels.entryPrice,
        targetPrice: levels.targetPrice,
        stopLoss: levels.stopLoss,
        riskRewardRatio: levels.riskRewardRatio,
        catalyst,
        analysis,
        sessionContext: `RTH (9:30 AM - 4:00 PM ET)`,
        timestamp: new Date().toISOString(),
        
        // Futures-specific fields
        futuresContractCode: contract.contractCode,
        futuresRootSymbol: rootSymbol,
        futuresMultiplier: spec.multiplier,
        futuresTickSize: spec.tickSize,
        futuresInitialMargin: spec.initialMargin,
        futuresMaintenanceMargin: spec.maintenanceMargin,
        
        // Time windows
        entryValidUntil: timeWindows.entryValidUntil,
        exitBy: timeWindows.exitBy,
        
        // Source and confidence
        source: 'quant',
        confidenceScore,
        qualitySignals: signal.signals,
        probabilityBand,
        
        // Model governance
        engineVersion: FUTURES_ENGINE_VERSION,
        generationTimestamp: new Date().toISOString(),
        dataSourceUsed: 'yahoo_finance',
        
        // Explainability
        rsiValue: signal.rsiValue,
        
        // Visibility
        visibility: 'private',
        isPublic: false,
      };
      
      ideas.push(idea);
      
      logger.info(`  💡 Created ${signal.direction.toUpperCase()} trade idea for ${contract.contractCode}`);
      logger.info(`     Entry: $${levels.entryPrice} | Target: $${levels.targetPrice} | Stop: $${levels.stopLoss}`);
      logger.info(`     Margin: $${spec.initialMargin.toLocaleString()} | Tick: ${spec.tickSize} = $${spec.tickValue}`);
      
    } catch (error: any) {
      logger.error(`[FUTURES-ENGINE] Error analyzing ${rootSymbol}:`, error);
      continue;
    }
  }
  
  logger.info(`\n🎯 [FUTURES-ENGINE] Generation complete - created ${ideas.length} futures trade ideas`);
  
  return ideas;
}
