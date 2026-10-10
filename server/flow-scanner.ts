// DIY Unusual Options Flow Scanner  
// Detects unusual options activity and generates OPTIONS trade ideas based on real premiums

import type { InsertTradeIdea } from "@shared/schema";
import { isUSMarketOpen, isValidTradingDay } from "@shared/market-calendar";
import { getTradierQuote, getTradierOptionsChain, getTradierOptionsChainsByDTE, getTradierHistoryOHLC } from './tradier-api';
import { validateTradeRisk } from './ai-service';
import { logger } from './logger';
import { formatInTimeZone } from 'date-fns-tz';
import { storage } from './storage';
import { calculateATR } from './technical-indicators';
import { isLottoCandidate, calculateLottoTargets } from './lotto-detector';
import { detectSectorFocus, detectRiskProfile, detectResearchHorizon, isPennyStock } from './sector-detector';
import { getLetterGrade } from './grading';
import { sendFlowAlertToDiscord, VALID_DISCORD_GRADES } from './discord-service';
import { getExpandedUniverse } from './mover-discovery';
import { validateFlowData, FlowValidationResult } from './flow-validation';

// 🛡️ QUALITY GATE: Only send B+ and higher to Discord (user requested)
// B+ = 85+, A- = 88+, A = 90+, A+ = 95+
const DISCORD_ALERT_GRADES = VALID_DISCORD_GRADES; // ['A+', 'A', 'A-', 'B+']

// Rate limiting for Discord alerts - prevent floods
const alertQueue: { timestamp: number; symbol: string }[] = [];
const MAX_ALERTS_PER_MINUTE = 3; // Max 3 alerts per minute
const ALERT_SPACING_MS = 20000; // 20 seconds between alerts

// Check if we can send an alert (rate limit check only, no push)
function canSendAlert(symbol: string): boolean {
  const now = Date.now();
  // Clean old entries (older than 1 minute)
  while (alertQueue.length > 0 && now - alertQueue[0].timestamp > 60000) {
    alertQueue.shift();
  }
  // Check rate limit
  if (alertQueue.length >= MAX_ALERTS_PER_MINUTE) {
    logger.info(`🚫 [FLOW-RATE] Rate limit reached (${MAX_ALERTS_PER_MINUTE}/min), skipping ${symbol}`);
    return false;
  }
  // Check spacing - don't send if last alert was too recent
  if (alertQueue.length > 0 && now - alertQueue[alertQueue.length - 1].timestamp < ALERT_SPACING_MS) {
    logger.info(`🚫 [FLOW-RATE] Too soon after last alert, skipping ${symbol}`);
    return false;
  }
  return true;
}

// Record that an alert was sent (call AFTER successfully sending)
function recordAlertSent(symbol: string): void {
  alertQueue.push({ timestamp: Date.now(), symbol });
}

// Wrapper to maintain existing function signature
function isMarketOpen(): { isOpen: boolean; reason: string; minutesUntilClose: number } {
  const status = isUSMarketOpen();
  return { 
    isOpen: status.isOpen, 
    reason: status.reason, 
    minutesUntilClose: status.minutesUntilClose || 0 
  };
}

// Minimum trading time required for different DTE options (in minutes)
const MIN_TRADING_TIME = {
  0: 120,   // 0 DTE: Need at least 2 hours
  1: 90,    // 1 DTE: Need at least 1.5 hours  
  2: 60,    // 2 DTE: Need at least 1 hour
  default: 30  // 3+ DTE: 30 minutes minimum
};

// Check if there's enough trading time for an option
function hasEnoughTradingTime(expirationDate: string, minutesUntilClose: number): { hasTime: boolean; reason: string; dte: number } {
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const expDate = new Date(expirationDate);
  
  // 🔧 FIX: Use calendar day comparison for accurate 0 DTE detection
  // Compare dates in ET timezone to properly identify same-day expirations
  const todayET = etNow.toISOString().split('T')[0]; // YYYY-MM-DD in ET
  const expiryDateStr = expirationDate.split('T')[0]; // YYYY-MM-DD from expiration
  
  // Calculate proper DTE based on calendar days
  let daysToExpiry: number;
  if (todayET === expiryDateStr) {
    daysToExpiry = 0; // Same calendar day = 0 DTE
  } else {
    // Calculate days difference
    const todayMs = new Date(todayET + 'T00:00:00Z').getTime();
    const expiryMs = new Date(expiryDateStr + 'T00:00:00Z').getTime();
    daysToExpiry = Math.floor((expiryMs - todayMs) / (1000 * 60 * 60 * 24));
  }
  
  // Get minimum time requirement based on DTE
  const minMinutes = MIN_TRADING_TIME[daysToExpiry as keyof typeof MIN_TRADING_TIME] || MIN_TRADING_TIME.default;
  
  // For 0 DTE (same day), MUST have enough minutes until close
  if (daysToExpiry === 0) {
    if (minutesUntilClose < minMinutes) {
      return { 
        hasTime: false, 
        reason: `0 DTE with only ${minutesUntilClose} min until close (need ${minMinutes} min)`,
        dte: 0
      };
    }
  }
  
  // For 1 DTE, enforce the 90-minute minimum requirement
  if (daysToExpiry === 1) {
    const minFor1DTE = MIN_TRADING_TIME[1]; // 90 minutes
    if (minutesUntilClose < minFor1DTE) {
      return {
        hasTime: false,
        reason: `1 DTE with only ${minutesUntilClose} min until close (need ${minFor1DTE} min)`,
        dte: 1
      };
    }
  }
  
  // For 2 DTE, enforce the 60-minute minimum requirement
  if (daysToExpiry === 2) {
    const minFor2DTE = MIN_TRADING_TIME[2]; // 60 minutes
    if (minutesUntilClose < minFor2DTE) {
      return {
        hasTime: false,
        reason: `2 DTE with only ${minutesUntilClose} min until close (need ${minFor2DTE} min)`,
        dte: 2
      };
    }
  }
  
  // For 3+ DTE, enforce the default 30-minute minimum
  if (daysToExpiry >= 3 && minutesUntilClose < MIN_TRADING_TIME.default) {
    return {
      hasTime: false,
      reason: `${daysToExpiry} DTE with only ${minutesUntilClose} min until close (need ${MIN_TRADING_TIME.default} min)`,
      dte: daysToExpiry
    };
  }
  
  return { hasTime: true, reason: 'Sufficient trading time', dte: daysToExpiry };
}

// UNIFIED FLOW SCAN UNIVERSE (800+ tickers + dynamic movers) - Shared across all platform scanners
// Uses expanded universe that includes dynamically discovered movers from Yahoo Finance
const FLOW_SCAN_TICKERS = getExpandedUniverse();

// Unusual activity thresholds (adjusted for Tradier Sandbox limitations)
// NOTE: Tradier Sandbox doesn't provide average_volume data, so we use absolute volume
const VOLUME_THRESHOLD = 500; // Absolute volume >500 contracts (since avg_vol=0 in sandbox)
const PREMIUM_THRESHOLD = 50000; // $50k+ premium
const IV_THRESHOLD = 0.5; // 50%+ implied volatility

// 🐋 WHALE FLOW THRESHOLDS - Large institutional activity
// These bypass affordability filters and get priority alerts
const WHALE_PREMIUM_THRESHOLD = 1000000; // $1M+ = whale activity (like $6.7M AMZN calls)
const MEGA_WHALE_THRESHOLD = 5000000; // $5M+ = mega whale (urgent alert)

// Tickers with expensive options that should never be filtered for affordability
const WHALE_TIER_TICKERS = ['AMZN', 'GOOGL', 'GOOG', 'META', 'MSFT', 'AAPL', 'NVDA', 'TSLA', 'NFLX', 'AVGO', 'COST', 'BRK.B'];

interface UnusualOption {
  symbol: string;
  underlying: string;
  optionType: 'call' | 'put';
  strike: number;
  expiration: string;
  volume: number;
  premium: number; // volume * last * 100
  lastPrice: number;
  impliedVol: number;
  reasons: string[];
  isWhaleFlow: boolean; // $1M+ notional = whale
  isMegaWhale: boolean; // $5M+ notional = mega whale
  greeks?: {
    delta?: number;
  };
}

interface FlowSignal {
  ticker: string;
  direction: 'long' | 'short';
  currentPrice: number;
  unusualOptions: UnusualOption[];
  totalPremium: number;
  signalStrength: number;
}

// NOTE: isLottoCandidate moved to shared lotto-detector.ts for use across all engines

// Detect unusual options activity
async function detectUnusualOptions(ticker: string): Promise<UnusualOption[]> {
  try {
    logger.info(`📊 [FLOW] Scanning options for ${ticker}...`);
    
    // Get options chain
    const options = await getTradierOptionsChainsByDTE(ticker);
    
    if (options.length === 0) {
      logger.info(`📊 [FLOW] No options data available for ${ticker}`);
      return [];
    }

    logger.info(`📊 [FLOW] ${ticker}: Found ${options.length} option contracts to analyze`);
    
    // Debug: Sample first contract to see what data we're getting
    if (options.length > 0) {
      const sample = options[0];
      logger.info(`📊 [FLOW] ${ticker}: Sample contract - volume=${sample.volume}, avg_vol=${sample.average_volume}, last=${sample.last}, greeks=${sample.greeks ? 'yes' : 'no'}`);
    }
    
    const unusualOptions: UnusualOption[] = [];
    let skippedCount = 0;
    let missingVolume = 0;
    let missingAvgVolume = 0;
    let missingLast = 0;

    let invalidExpirationCount = 0;
    
    let noBidAskCount = 0;
    
    for (const option of options) {
      // Skip if missing critical data (NOTE: average_volume is 0 in Tradier Sandbox, so we don't check it)
      if (!option.volume) missingVolume++;
      if (!option.average_volume) missingAvgVolume++;
      if (!option.last || option.last <= 0) missingLast++;
      
      // 🔒 STRICT PRICING: REQUIRE bid/ask for accurate premiums - don't use stale 'last' price
      const hasBidAsk = option.bid && option.bid > 0 && option.ask && option.ask > 0;
      if (!hasBidAsk) {
        noBidAskCount++;
        continue; // Skip options without live bid/ask (market likely closed)
      }
      const midPrice = (option.bid + option.ask) / 2;
      
      if (!option.volume || midPrice <= 0) {
        skippedCount++;
        continue;
      }
      
      // 🔒 VALIDATION: Skip options with invalid expiration dates (weekends, holidays)
      if (option.expiration_date && !isValidTradingDay(option.expiration_date)) {
        invalidExpirationCount++;
        continue;
      }

      const premium = option.volume * midPrice * 100; // Contract size = 100, using mid-price
      const impliedVol = option.greeks?.mid_iv || option.greeks?.bid_iv || 0;

      const reasons: string[] = [];
      let isUnusual = false;

      // Check absolute volume (since Tradier Sandbox doesn't provide average_volume)
      if (option.volume >= VOLUME_THRESHOLD) {
        reasons.push(`${option.volume} vol`);
        isUnusual = true;
      }

      // Check premium
      if (premium >= PREMIUM_THRESHOLD) {
        reasons.push(`$${(premium / 1000).toFixed(0)}k premium`);
        isUnusual = true;
      }
      
      // 🐋 WHALE FLOW DETECTION - Large institutional activity
      const isWhaleFlow = premium >= WHALE_PREMIUM_THRESHOLD;
      const isMegaWhale = premium >= MEGA_WHALE_THRESHOLD;
      
      if (isMegaWhale) {
        reasons.push(`🐋🐋 MEGA WHALE $${(premium / 1000000).toFixed(1)}M`);
        isUnusual = true;
        logger.warn(`🐋🐋 [MEGA-WHALE] ${ticker} ${option.option_type?.toUpperCase()} $${option.strike} - $${(premium / 1000000).toFixed(2)}M notional!`);
      } else if (isWhaleFlow) {
        reasons.push(`🐋 WHALE $${(premium / 1000000).toFixed(1)}M`);
        isUnusual = true;
        logger.info(`🐋 [WHALE-FLOW] ${ticker} ${option.option_type?.toUpperCase()} $${option.strike} - $${(premium / 1000000).toFixed(2)}M notional`);
      }

      // Check IV spike (Tradier returns IV as decimal, multiply by 100 for display)
      if (impliedVol >= IV_THRESHOLD) {
        reasons.push(`${(impliedVol * 100).toFixed(0)}% IV`);
        isUnusual = true;
      }

      if (isUnusual) {
        // 🛡️ VALIDATION: Check if premium is rational vs underlying price
        const validation = await validateFlowData({
          symbol: ticker,
          optionType: option.option_type as 'call' | 'put',
          strike: option.strike,
          premium: midPrice,
          expiration: option.expiration_date,
          impliedVol
        });
        
        if (!validation.isValid) {
          logger.warn(`🚫 [FLOW-VALIDATE] REJECTED ${ticker} ${option.option_type.toUpperCase()} $${option.strike} @ $${midPrice.toFixed(2)}: ${validation.reason}`);
          continue; // Skip this option - it has stale/invalid data
        }
        
        if (validation.status === 'flagged') {
          reasons.push('⚠️ FLAGGED');
          logger.info(`⚠️ [FLOW-VALIDATE] FLAGGED ${ticker} ${option.option_type.toUpperCase()} $${option.strike}: ${validation.reason}`);
        }
        
        unusualOptions.push({
          isWhaleFlow,
          isMegaWhale,
          symbol: option.symbol,
          underlying: option.underlying,
          optionType: option.option_type as 'call' | 'put',
          strike: option.strike,
          expiration: option.expiration_date,
          volume: option.volume,
          premium,
          lastPrice: midPrice, // Use mid-price for accurate entry
          impliedVol,
          reasons,
          greeks: option.greeks ? {
            delta: option.greeks.delta
          } : undefined
        });

        logger.info(`📊 [FLOW] UNUSUAL: ${ticker} ${option.option_type.toUpperCase()} $${option.strike} @ $${midPrice.toFixed(2)} - ${reasons.join(', ')} (Stock: $${validation.underlyingPrice?.toFixed(2) || 'N/A'})`);
      }
    }

    logger.info(`📊 [FLOW] ${ticker}: Analyzed ${options.length} contracts, skipped ${skippedCount} (no bid/ask=${noBidAskCount}, missing vol=${missingVolume}), found ${unusualOptions.length} unusual`);
    return unusualOptions;
  } catch (error) {
    logger.error(`📊 [FLOW] Error scanning ${ticker}:`, error);
    return [];
  }
}

// 🎯 MULTI-FACTOR CONFIDENCE SCORING
// Weighted composite of multiple signals for more meaningful scores
interface ConfidenceBreakdown {
  volumeScore: number;      // Weight: 25% - Volume relative to threshold
  premiumScore: number;     // Weight: 20% - Premium magnitude (institutional activity)
  ivScore: number;          // Weight: 15% - Implied volatility (unusual activity)
  breadthScore: number;     // Weight: 15% - Number of unusual contracts
  skewScore: number;        // Weight: 15% - Directional skew strength
  timingScore: number;      // Weight: 10% - Time of day factor
  total: number;            // Weighted composite (40-90%)
  band: 'A' | 'B+' | 'B' | 'C+' | 'C';  // Quality band
}

function calculateConfidenceScore(
  dominantOptions: UnusualOption[],
  totalPremium: number,
  callPremium: number,
  putPremium: number
): ConfidenceBreakdown {
  // Helper to clamp scores to 0-100
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  
  // 1. VOLUME SCORE (25%) - Average volume relative to threshold
  const totalVolume = dominantOptions.reduce((sum, opt) => sum + opt.volume, 0);
  const avgVolume = totalVolume / Math.max(1, dominantOptions.length);
  // Score: 500 contracts = 40%, 1500 = 60%, 3000+ = 80%
  const volumeScore = clamp(40 + ((avgVolume - VOLUME_THRESHOLD) / 50));
  
  // 2. PREMIUM SCORE (20%) - Total premium magnitude with proper scaling
  // Score: $50k = 40%, $250k = 60%, $500k = 75%, $1M+ = 90%
  // Minimum $50k required for meaningful score
  const premiumK = totalPremium / 1000;
  let premiumScore: number;
  if (premiumK < 50) {
    premiumScore = clamp(20 + (premiumK / 50) * 20); // 0-50k: 20-40
  } else if (premiumK < 250) {
    premiumScore = clamp(40 + ((premiumK - 50) / 200) * 20); // 50k-250k: 40-60
  } else if (premiumK < 500) {
    premiumScore = clamp(60 + ((premiumK - 250) / 250) * 15); // 250k-500k: 60-75
  } else {
    premiumScore = clamp(75 + Math.min(15, (premiumK - 500) / 100)); // 500k+: 75-90
  }
  
  // 3. IV SCORE (15%) - Average implied volatility (higher = more unusual)
  const avgIV = dominantOptions.reduce((sum, opt) => sum + (opt.impliedVol || 0.3), 0) / Math.max(1, dominantOptions.length);
  // Score: 20% IV = 30%, 50% IV = 60%, 80%+ IV = 85%
  const ivScore = clamp(30 + avgIV * 70);
  
  // 4. BREADTH SCORE (15%) - Number of unusual contracts detected
  // Score: 1 contract = 30%, 3 = 50%, 5 = 65%, 10+ = 85%
  const contractCount = dominantOptions.length;
  const breadthScore = clamp(30 + Math.min(55, contractCount * 6));
  
  // 5. SKEW SCORE (15%) - Directional conviction (call vs put imbalance)
  // Score: 50/50 = 30%, 70/30 = 55%, 90/10 = 80%, 100/0 = 90%
  const totalPremiumBothSides = callPremium + putPremium;
  const dominantPremium = Math.max(callPremium, putPremium);
  const skewRatio = totalPremiumBothSides > 0 ? dominantPremium / totalPremiumBothSides : 0.5;
  // skewRatio ranges from 0.5 (balanced) to 1.0 (one-sided)
  // Map 0.5-1.0 to 30-90
  const skewScore = clamp(30 + (skewRatio - 0.5) * 120);
  
  // 6. TIMING SCORE (10%) - Time of day factor
  const now = new Date();
  const estHour = (now.getUTCHours() - 5 + 24) % 24; // Convert to EST
  // Score: First 2 hours (9:30-11:30) = 90%, midday = 60%, last hour = 80%
  let timingScore = 60;
  if (estHour >= 9 && estHour < 11) timingScore = 90;  // Morning flow (most significant)
  else if (estHour >= 11 && estHour < 14) timingScore = 60;  // Midday (less significant)
  else if (estHour >= 14 && estHour < 16) timingScore = 80;  // Afternoon (closing push)
  
  // WEIGHTED COMPOSITE
  const weighted = 
    (volumeScore * 0.25) +
    (premiumScore * 0.20) +
    (ivScore * 0.15) +
    (breadthScore * 0.15) +
    (skewScore * 0.15) +
    (timingScore * 0.10);
  
  // CALIBRATED SCORING (Dec 2025)
  // Flow engine has 81.9% historical win rate but was scoring 35-85%
  // Apply 1.15x boost to better reflect actual performance
  // New range: ~40-98% allowing strong signals to reach A band (90+)
  const calibratedScore = weighted * 1.15;
  const total = Math.max(40, Math.min(98, calibratedScore));
  
  // Quality band based on CALIBRATED thresholds (matches getProbabilityBand)
  // A (90+), B+ (85-89), B (78-84), C+ (72-77), C (65-71), D (<65)
  let band: 'A' | 'B+' | 'B' | 'C+' | 'C';
  if (total >= 90) band = 'A';
  else if (total >= 85) band = 'B+';
  else if (total >= 78) band = 'B';
  else if (total >= 72) band = 'C+';
  else band = 'C';
  
  return {
    volumeScore: Math.round(volumeScore),
    premiumScore: Math.round(premiumScore),
    ivScore: Math.round(ivScore),
    breadthScore: Math.round(breadthScore),
    skewScore: Math.round(skewScore),
    timingScore: Math.round(timingScore),
    total: Math.round(total),
    band
  };
}

// Analyze flow signals from unusual options
function analyzeFlowSignals(ticker: string, currentPrice: number, unusualOptions: UnusualOption[]): FlowSignal | null {
  if (unusualOptions.length === 0) return null;

  // Separate calls and puts
  const calls = unusualOptions.filter(opt => opt.optionType === 'call');
  const puts = unusualOptions.filter(opt => opt.optionType === 'put');

  // Calculate total premium for each side
  const callPremium = calls.reduce((sum, opt) => sum + opt.premium, 0);
  const putPremium = puts.reduce((sum, opt) => sum + opt.premium, 0);

  // Determine direction based on dominant flow
  let direction: 'long' | 'short';
  let dominantOptions: UnusualOption[];
  let totalPremium: number;

  if (callPremium > putPremium) {
    direction = 'long';
    dominantOptions = calls;
    totalPremium = callPremium;
  } else {
    direction = 'short';
    dominantOptions = puts;
    totalPremium = putPremium;
  }

  // 🎯 MULTI-FACTOR CONFIDENCE SCORING
  const confidence = calculateConfidenceScore(dominantOptions, totalPremium, callPremium, putPremium);
  const signalStrength = confidence.total;

  logger.info(`📊 [FLOW] ${ticker} SIGNAL: ${direction.toUpperCase()} - ${dominantOptions.length} contracts, $${(totalPremium / 1000000).toFixed(2)}M premium`);
  logger.info(`📊 [FLOW] ${ticker} CONFIDENCE: ${signalStrength}% [${confidence.band}] (Vol:${confidence.volumeScore} Prem:${confidence.premiumScore} IV:${confidence.ivScore} Breadth:${confidence.breadthScore} Skew:${confidence.skewScore} Time:${confidence.timingScore})`);

  return {
    ticker,
    direction,
    currentPrice,
    unusualOptions: dominantOptions,
    totalPremium,
    signalStrength
  };
}

// Calculate dynamic target based on option Greeks, IV, and ATR
async function calculateDynamicTarget(
  ticker: string,
  currentPrice: number,
  direction: 'long' | 'short',
  mostActiveOption: UnusualOption
): Promise<{ targetMultiplier: number; method: string; explanation: string }> {
  // Calculate days to expiration (DTE)
  const expirationDate = new Date(mostActiveOption.expiration);
  const now = new Date();
  const daysToExpiry = Math.max(1, Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  // METHOD 1: IV-Based (Preferred for options)
  // Formula: Expected Move = √(DTE/365) × IV
  // Target = Expected Move × 50% (conservative)
  if (mostActiveOption.impliedVol && mostActiveOption.impliedVol > 0) {
    const ivPercent = mostActiveOption.impliedVol; // Already in decimal form (e.g., 0.50 for 50%)
    const expectedMove = Math.sqrt(daysToExpiry / 365) * ivPercent;
    const targetMultiplier = expectedMove * 0.5; // Use 50% of expected move as target
    
    // Ensure reasonable bounds (5% to 25%)
    const boundedMultiplier = Math.max(0.05, Math.min(0.25, targetMultiplier));
    
    logger.info(`📊 [FLOW] ${ticker}: IV-based target calculated - IV=${(ivPercent * 100).toFixed(1)}%, DTE=${daysToExpiry}d, Expected Move=${(expectedMove * 100).toFixed(1)}%, Target=${(boundedMultiplier * 100).toFixed(1)}%`);
    
    return {
      targetMultiplier: boundedMultiplier,
      method: 'IV-based',
      explanation: `${(boundedMultiplier * 100).toFixed(1)}% target based on ${(ivPercent * 100).toFixed(0)}% IV, ${daysToExpiry}d DTE`
    };
  }

  // METHOD 2: ATR-Based (Fallback if no IV available)
  // Fetch historical OHLC data for ATR calculation
  const ohlcData = await getTradierHistoryOHLC(ticker, 20);
  if (ohlcData && ohlcData.highs.length >= 15) {
    const atr = calculateATR(ohlcData.highs, ohlcData.lows, ohlcData.closes, 14);
    if (atr > 0) {
      const atrPercent = atr / currentPrice; // ATR as % of current price
      const targetMultiplier = atrPercent * 1.5; // Use 1.5x ATR as target
      
      // Ensure reasonable bounds (5% to 25%)
      const boundedMultiplier = Math.max(0.05, Math.min(0.25, targetMultiplier));
      
      logger.info(`📊 [FLOW] ${ticker}: ATR-based target calculated - ATR=$${atr.toFixed(2)}, ATR%=${(atrPercent * 100).toFixed(1)}%, Target=${(boundedMultiplier * 100).toFixed(1)}%`);
      
      return {
        targetMultiplier: boundedMultiplier,
        method: 'ATR-based',
        explanation: `${(boundedMultiplier * 100).toFixed(1)}% target based on ATR $${atr.toFixed(2)} (${(atrPercent * 100).toFixed(1)}% of price)`
      };
    }
  }

  // METHOD 3: Fallback to conservative 5.25% if no data available
  logger.info(`📊 [FLOW] ${ticker}: Using fallback 5.25% target (no IV/ATR data available)`);
  return {
    targetMultiplier: 0.0525,
    method: 'fallback',
    explanation: '5.25% target (fallback - no volatility data available)'
  };
}

// Generate trade idea from flow signal
async function generateTradeFromFlow(signal: FlowSignal): Promise<InsertTradeIdea | null> {
  const { ticker, direction, currentPrice, unusualOptions, totalPremium, signalStrength } = signal;

  // Find the most active strike (highest premium)
  const mostActiveOption = unusualOptions.reduce((max, opt) => 
    opt.premium > max.premium ? opt : max
  );

  // 🎯 DYNAMIC TARGETS: Calculate based on option Greeks, IV, and volatility
  const dynamicTarget = await calculateDynamicTarget(ticker, currentPrice, direction, mostActiveOption);
  const targetMultiplier = dynamicTarget.targetMultiplier;
  
  // Calculate stop loss (maintain 1.1:1 R:R minimum)
  const stopMultiplier = targetMultiplier / 1.1; // Risk is 1/1.1 of reward
  
  // 🔧 OPTIONS PRICING FIX: Use OPTION PREMIUM, not stock price
  // The mostActiveOption already has the last traded premium price
  const optionPremium = mostActiveOption.lastPrice;  // Option premium from Tradier
  
  // Entry/Target/Stop are now based on OPTION PREMIUM, not stock price
  const entryPrice = optionPremium;
  let targetPrice: number;
  let stopLoss: number;

  // 🎯 MINIMUM VIABLE TARGET - Options need REAL profit potential to be worth trading
  // Cheap options need larger % moves, expensive options can use smaller %
  let effectiveTargetMultiplier = targetMultiplier;
  
  // For cheap options (under $0.50), require at least 50% gain or $0.05 minimum
  // For options $0.50-$2, require at least 25% gain
  // For options over $2, the dynamic calculation is fine
  if (entryPrice < 0.10) {
    // Super cheap options: need at least 100% or $0.05 min gain
    const minGain = Math.max(entryPrice * 1.0, 0.05); // 100% or $0.05
    effectiveTargetMultiplier = Math.max(targetMultiplier, minGain / entryPrice);
  } else if (entryPrice < 0.50) {
    // Cheap options: need at least 50% or $0.10 min gain
    const minGain = Math.max(entryPrice * 0.50, 0.10);
    effectiveTargetMultiplier = Math.max(targetMultiplier, minGain / entryPrice);
  } else if (entryPrice < 2.00) {
    // Moderate options: need at least 25% gain
    effectiveTargetMultiplier = Math.max(targetMultiplier, 0.25);
  } else {
    // Expensive options: at least 15% for it to be worthwhile
    effectiveTargetMultiplier = Math.max(targetMultiplier, 0.15);
  }
  
  // Recalculate stop based on new target (maintain 1.1:1 R:R)
  const effectiveStopMultiplier = effectiveTargetMultiplier / 1.1;

  // 🔧 FIX: OPTIONS PREMIUM TARGETS - You're always BUYING the option, never selling!
  // Whether CALL or PUT, the goal is to BUY at entry premium and SELL at higher target premium.
  // - CALL flow (direction='long'): Buy call, stock goes UP, call premium goes UP ✓
  // - PUT flow (direction='short'): Buy put, stock goes DOWN, put premium goes UP ✓
  // 
  // The "direction" label ('long'/'short') refers to the UNDERLYING stock direction,
  // NOT whether you're long/short on the option. You're always LONG the option premium.
  // So targets are ALWAYS: target > entry, stop < entry (for profit on premium increase)
  
  targetPrice = entryPrice * (1 + effectiveTargetMultiplier);
  stopLoss = entryPrice * (1 - effectiveStopMultiplier);
  
  // Log the target adjustment for cheap options
  if (effectiveTargetMultiplier > targetMultiplier) {
    logger.info(`📊 [FLOW] ${ticker}: Boosted target from ${(targetMultiplier*100).toFixed(1)}% → ${(effectiveTargetMultiplier*100).toFixed(1)}% (cheap option at $${entryPrice.toFixed(2)})`);
  }

  // Calculate R:R ratio - always based on premium increase (buying options)
  const risk = entryPrice - stopLoss;   // Risk = entry - stop (premium decrease)
  const reward = targetPrice - entryPrice;  // Reward = target - entry (premium increase)
  let riskRewardRatio = reward / risk;

  // 🔧 FIX: Generate OPTIONS trades (not stocks) - we're detecting options flow!
  // Use the most active option's type (call/put) to determine the option contract type
  const optionType = mostActiveOption.optionType; // 'call' or 'put'
  
  // Validate trade risk
  const validation = validateTradeRisk({
    symbol: ticker,
    assetType: 'option',  // ✅ FIXED: Generate options, not stocks
    direction,
    entryPrice,
    targetPrice,
    stopLoss,
    catalyst: `Unusual ${direction === 'long' ? 'CALL' : 'PUT'} flow detected`,
    analysis: '',
    sessionContext: '',
  });

  if (!validation.isValid) {
    logger.warn(`📊 [FLOW] ${ticker} trade rejected: ${validation.reason}`);
    return null;
  }

  // Generate timestamp and entry/exit windows
  const now = new Date();
  const timestamp = now.toISOString();
  
  // ⏰ TIME-CONSCIOUS ENTRY/EXIT CALCULATION
  // Entry window: Based on expected move timing (shorter for high IV, longer for low IV)
  const ivPercent = mostActiveOption.impliedVol || 0.3; // Default 30% IV
  
  // Higher IV = faster moves expected = shorter entry window
  // Low IV (20%): 90 min entry window
  // High IV (80%): 30 min entry window
  const entryWindowMinutes = Math.round(90 - (ivPercent * 75)); // Range: 30-90 min
  const entryValidUntil = new Date(now.getTime() + Math.max(30, entryWindowMinutes) * 60 * 1000).toISOString();
  
  // ✅ FIX: For options, exit_by MUST be BEFORE or ON expiry_date (can't hold past expiration!)
  // CRITICAL: Use ET timezone explicitly - setHours uses server timezone (UTC) which breaks calculations
  const expiryDateStr = mostActiveOption.expiration.split('T')[0]; // YYYY-MM-DD
  // Construct 4:00 PM ET (market close) on expiry date - this is when options expire
  // During EST: 4 PM ET = 21:00 UTC, During EDT: 4 PM ET = 20:00 UTC
  const optionExpiryDate = new Date(`${expiryDateStr}T16:00:00-05:00`); // -05:00 is EST, close enough for calculations
  
  // 🎯 DYNAMIC EXIT TIME CALCULATION (fluctuates based on IV, DTE, and expected move)
  // Formula: Base time adjusted by IV + random jitter for natural variation
  const daysToExpiry = Math.max(1, Math.ceil((optionExpiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  
  // Base exit time in hours:
  // - 0 DTE: 1-3 hours (quick scalps)
  // - 1 DTE: 2-4 hours (day trades)  
  // - 2+ DTE: 3-6 hours (can hold longer)
  let baseExitHours: number;
  if (daysToExpiry <= 1) {
    baseExitHours = 1.5 + (ivPercent * 1.5); // 1.5-3 hours for 0-1 DTE
  } else if (daysToExpiry <= 2) {
    baseExitHours = 2.5 + (ivPercent * 1.5); // 2.5-4 hours for 2 DTE
  } else {
    baseExitHours = 3 + (ivPercent * 3); // 3-6 hours for 3+ DTE
  }
  
  // Add random jitter (±20%) for natural fluctuation - every trade is different!
  const jitterPercent = 0.8 + (Math.random() * 0.4); // 0.8 to 1.2
  const exitHoursWithJitter = baseExitHours * jitterPercent;
  
  // Convert to milliseconds and calculate exit time
  const exitTimeMs = now.getTime() + (exitHoursWithJitter * 60 * 60 * 1000);
  const dynamicExitBy = new Date(exitTimeMs);
  
  // Use the EARLIER of: (dynamicExitBy OR option expiry time - 30 min buffer)
  // This ensures we never try to exit AFTER the option has expired, with buffer time
  const expiryBuffer = new Date(optionExpiryDate.getTime() - 30 * 60 * 1000); // 30 min before expiry
  const exitBy = (dynamicExitBy < expiryBuffer ? dynamicExitBy : expiryBuffer).toISOString();
  
  // VALIDATION: Entry must be before exit
  if (new Date(entryValidUntil) >= new Date(exitBy)) {
    logger.warn(`📊 [FLOW] ${ticker} rejected: Entry window (${entryValidUntil}) >= Exit time (${exitBy})`);
    return null;
  }
  
  logger.info(`📊 [FLOW] ${ticker} TIMING: Entry valid ${Math.round(entryWindowMinutes)}min, Exit in ~${exitHoursWithJitter.toFixed(1)}h (IV=${(ivPercent * 100).toFixed(0)}%, DTE=${daysToExpiry})`)
  logger.info(`📊 [FLOW] ${ticker} WINDOWS: Entry until ${formatInTimeZone(new Date(entryValidUntil), 'America/New_York', 'h:mm a')}, Exit by ${formatInTimeZone(new Date(exitBy), 'America/New_York', 'h:mm a')} (exp: ${formatInTimeZone(optionExpiryDate, 'America/New_York', 'MMM dd h:mm a')})`)

  // Build catalyst and analysis with dynamic target explanation
  const catalyst = `Unusual ${direction === 'long' ? 'CALL' : 'PUT'} Flow: ${unusualOptions.length} contracts, $${(totalPremium / 1000000).toFixed(2)}M premium`;
  
  const topOptions = unusualOptions.slice(0, 3).map(opt => 
    `${opt.optionType.toUpperCase()} $${opt.strike} (${opt.reasons.join(', ')})`
  ).join('; ');

  const targetPercent = (targetMultiplier * 100).toFixed(1);
  const analysis = `OPTIONS FLOW: Smart money betting on ${direction === 'long' ? '+' : '-'}${targetPercent}% move in option premium (${dynamicTarget.explanation}). Entry: $${entryPrice.toFixed(2)} premium for ${mostActiveOption.optionType.toUpperCase()} $${mostActiveOption.strike} (exp: ${mostActiveOption.expiration}). Most active contract: ${mostActiveOption.volume} volume, $${(mostActiveOption.premium / 1000).toFixed(0)}k premium. Top unusual options: ${topOptions}. Flow suggests ${direction === 'long' ? 'bullish' : 'bearish'} momentum on underlying ${ticker}.`;

  const sessionContext = `${formatInTimeZone(now, 'America/New_York', 'ha zzz')} - Unusual options flow detected in ${ticker}`;
  
  // 📊 DETAILED LOGGING: Show options trade details
  logger.info(`📊 [FLOW] ${ticker} OPTIONS TRADE: ${optionType.toUpperCase()} $${mostActiveOption.strike} (exp: ${mostActiveOption.expiration})`);
  logger.info(`📊 [FLOW] ${ticker} PREMIUM LEVELS: Entry=$${entryPrice.toFixed(2)}, Target=$${targetPrice.toFixed(2)} (${direction === 'long' ? '+' : '-'}${targetPercent}%), Stop=$${stopLoss.toFixed(2)}, R:R=${riskRewardRatio.toFixed(2)}:1`);
  logger.info(`📊 [FLOW] ${ticker} UNDERLYING: Stock @ $${currentPrice.toFixed(2)}, Flow suggests ${direction === 'long' ? 'bullish' : 'bearish'} momentum`);

  // 🎰 LOTTO MODE DETECTION: Check if this qualifies as a high-risk lotto play
  const isLotto = isLottoCandidate({
    lastPrice: mostActiveOption.lastPrice,
    greeks: mostActiveOption.greeks,
    expiration: mostActiveOption.expiration,
    symbol: mostActiveOption.symbol
  });
  
  if (isLotto) {
    // Override targets for lotto plays with DTE-aware multipliers
    const lottoTargets = calculateLottoTargets(entryPrice, mostActiveOption.expiration);
    targetPrice = lottoTargets.targetPrice;
    riskRewardRatio = lottoTargets.riskRewardRatio;
    logger.info(`🎰 [FLOW] ${ticker} LOTTO PLAY DETECTED (${lottoTargets.dteCategory}): Entry=$${entryPrice.toFixed(2)}, Delta=${Math.abs(mostActiveOption.greeks?.delta || 0).toFixed(2)}, Target=$${targetPrice.toFixed(2)} (${lottoTargets.targetMultiplier}x potential)`);
  }

  const sectorFocus = detectSectorFocus(ticker);
  const riskProfile = detectRiskProfile(ticker, entryPrice, isLotto, 'option');
  
  // Derive holdingPeriod from days to expiry - NOT hardcoded 'day'
  const derivedHoldingPeriod = daysToExpiry <= 2 ? 'day' : 
                               daysToExpiry <= 14 ? 'swing' : 'position';
  const researchHorizon = detectResearchHorizon(derivedHoldingPeriod, daysToExpiry);
  
  return {
    symbol: ticker,
    assetType: 'option',  // ✅ FIXED: Generate options, not stocks
    direction,
    holdingPeriod: derivedHoldingPeriod,
    entryPrice,
    targetPrice,
    stopLoss,
    riskRewardRatio,
    catalyst,
    analysis,
    sessionContext,
    timestamp,
    entryValidUntil,
    exitBy,
    source: 'flow',
    confidenceScore: signalStrength,
    qualitySignals: [
      `unusual_${direction === 'long' ? 'call' : 'put'}_flow`,
      `volume_${mostActiveOption.volume}_contracts`,
      `premium_$${(totalPremium / 1000000).toFixed(2)}M`
    ],
    probabilityBand: getLetterGrade(signalStrength),
    dataSourceUsed: 'tradier',
    engineVersion: 'flow_v3.0.0_time_conscious',  // Time-conscious with dynamic exit times
    generationTimestamp: timestamp,
    // ✅ OPTIONS-SPECIFIC FIELDS (match schema field names)
    optionType,  // 'call' or 'put' from most active option
    strikePrice: mostActiveOption.strike,  // Match schema: strikePrice not strike
    expiryDate: mostActiveOption.expiration,  // Match schema: expiryDate not expiration
    // 🎰 LOTTO MODE FLAG
    isLottoPlay: isLotto,
    // 📊 RESEARCH CATEGORIZATION - For filtering and educational framing
    sectorFocus,
    riskProfile,
    researchHorizon,
    liquidityWarning: isPennyStock(ticker, currentPrice),
    // 🔓 Flow is considered a catalyst (unusual activity = market signal)
    // This allows 1.1:1 R:R minimum instead of 2:1 in validateTradeRisk
    isNewsCatalyst: true,
  };
}

// DTE ranges by holding period for flow scanner filtering
export const FLOW_DTE_RANGES: Record<string, { min: number; max: number; label: string }> = {
  'day': { min: 0, max: 2, label: 'Today/Tomorrow (0-2 DTE)' },      // 0DTE, 1DTE
  'swing': { min: 3, max: 14, label: 'Swing (3-14 DTE)' },            // ~1-2 weeks
  'position': { min: 15, max: 60, label: 'Position (15-60 DTE)' },    // ~2 weeks to 2 months
  'all': { min: 0, max: 540, label: 'All Expirations' }               // Everything
};

// Main flow scanner function
export async function scanUnusualOptionsFlow(holdingPeriod?: string, forceGenerate: boolean = false): Promise<InsertTradeIdea[]> {
  const dteRange = FLOW_DTE_RANGES[holdingPeriod || 'all'] || FLOW_DTE_RANGES['all'];
  logger.info(`📊 [FLOW] Starting flow scan - ${dteRange.label} (DTE: ${dteRange.min}-${dteRange.max})${forceGenerate ? ' [FORCED]' : ''}`);
  
  // 🔒 MARKET HOURS CHECK: Only scan when market is open (data is stale otherwise)
  // Can be bypassed with forceGenerate=true for manual generation
  const marketStatus = isMarketOpen();
  if (!marketStatus.isOpen && !forceGenerate) {
    logger.info(`📊 [FLOW] Skipping scan - ${marketStatus.reason}. Data would be stale.`);
    return [];
  }
  if (!marketStatus.isOpen && forceGenerate) {
    logger.info(`📊 [FLOW] Market closed but force=true - proceeding with scan (data may be stale)`);
  }
  
  // 🚫 DEDUPLICATION: Get existing open symbols to avoid duplicate trades
  const allIdeas = await storage.getAllTradeIdeas();
  const existingOpenSymbols = new Set(
    allIdeas
      .filter((idea: any) => idea.outcomeStatus === 'open')
      .map((idea: any) => idea.symbol.toUpperCase())
  );
  
  const tradeIdeas: InsertTradeIdea[] = [];
  let scannedCount = 0;
  let unusualCount = 0;

  for (const ticker of FLOW_SCAN_TICKERS) {
    try {
      // 🚫 Skip if symbol already has an open trade
      if (existingOpenSymbols.has(ticker.toUpperCase())) {
        logger.info(`📊 [FLOW] Skipped ${ticker} - already has open trade`);
        continue;
      }
      
      // Get current stock price
      const quote = await getTradierQuote(ticker);
      if (!quote || !quote.last || quote.last <= 0) {
        logger.warn(`📊 [FLOW] No quote data for ${ticker}`);
        continue;
      }

      scannedCount++;
      const currentPrice = quote.last;

      // Detect unusual options (with DTE filtering)
      const allUnusualOptions = await detectUnusualOptions(ticker);
      
      // Filter by DTE range for selected holding period AND trading time remaining
      const now = new Date();
      let insufficientTimeCount = 0;
      const unusualOptions = allUnusualOptions.filter(opt => {
        const expDate = new Date(opt.expiration);
        const daysToExp = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        // Check DTE range
        if (daysToExp < dteRange.min || daysToExp > dteRange.max) {
          return false;
        }
        
        // ⏰ TIME-CONSCIOUS: Check if enough trading time remains for this option
        const timeCheck = hasEnoughTradingTime(opt.expiration, marketStatus.minutesUntilClose);
        if (!timeCheck.hasTime) {
          insufficientTimeCount++;
          return false;
        }
        
        return true;
      });
      
      if (insufficientTimeCount > 0) {
        logger.info(`📊 [FLOW] ${ticker}: Filtered out ${insufficientTimeCount} options with insufficient trading time`);
      }
      
      if (unusualOptions.length === 0) {
        continue;
      }

      unusualCount++;

      // Analyze flow signals
      const signal = analyzeFlowSignals(ticker, currentPrice, unusualOptions);
      
      if (!signal) {
        continue;
      }

      // Generate trade idea with dynamic targets
      const tradeIdea = await generateTradeFromFlow(signal);
      
      if (tradeIdea) {
        tradeIdeas.push(tradeIdea);
        
        // 🐋 Log whale flow detection (alerts sent AFTER trade is saved in cron job)
        const hasWhaleFlow = signal.unusualOptions.some(opt => opt.isWhaleFlow);
        const hasMegaWhale = signal.unusualOptions.some(opt => opt.isMegaWhale);
        
        if (hasWhaleFlow || hasMegaWhale) {
          const whaleNotional = signal.unusualOptions.filter(o => o.isWhaleFlow).reduce((sum, o) => sum + o.premium, 0);
          logger.warn(`🐋 [WHALE-ALERT] ${ticker}: $${(whaleNotional / 1000000).toFixed(2)}M institutional flow detected! ${hasMegaWhale ? '🐋🐋 MEGA' : ''}`);
        }
        
        const grade = tradeIdea.probabilityBand || '';
        logger.info(`📊 [FLOW] Generated: ${ticker} ${tradeIdea.optionType?.toUpperCase()} $${tradeIdea.strikePrice} @ $${tradeIdea.entryPrice?.toFixed(2)} (${grade}) - will alert if saved`);
        
        // NOTE: Discord alerts moved to index.ts cron job - only sent AFTER trade passes validation and is saved
        // This prevents "ghost alerts" for trades that get rejected by validation/deduplication
      }

    } catch (error) {
      logger.error(`📊 [FLOW] Error processing ${ticker}:`, error);
    }
  }

  logger.info(`📊 [FLOW] Scan complete: ${scannedCount}/${FLOW_SCAN_TICKERS.length} tickers scanned, ${unusualCount} with unusual activity, ${tradeIdeas.length} trades generated`);
  
  return tradeIdeas;
}

// Check if market hours (9:30 AM - 4:00 PM ET, Mon-Fri)
// Uses direct UTC offset calculation since toLocaleString timezone is broken in this environment
export function isMarketHoursForFlow(): boolean {
  const now = new Date();
  
  // Calculate ET time using UTC offset (EST = UTC-5, but we use -5 for standard time in January)
  // This avoids the broken toLocaleString timezone conversion
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const utcDay = now.getUTCDay();
  
  // EST offset: UTC-5 (January is standard time, not daylight saving)
  const etOffset = -5;
  let etHour = utcHour + etOffset;
  let etDay = utcDay;
  
  // Handle day wraparound
  if (etHour < 0) {
    etHour += 24;
    etDay = (etDay + 6) % 7; // Previous day
  } else if (etHour >= 24) {
    etHour -= 24;
    etDay = (etDay + 1) % 7; // Next day
  }
  
  const timeInMinutes = etHour * 60 + utcMinute;
  
  // Market hours: 9:30 AM - 4:00 PM ET, Monday-Friday
  const marketOpen = 9 * 60 + 30;  // 9:30 AM
  const marketClose = 16 * 60;      // 4:00 PM
  
  const isWeekday = etDay >= 1 && etDay <= 5;
  const isWithinHours = timeInMinutes >= marketOpen && timeInMinutes < marketClose;
  
  // Log for debugging
  const etTimeStr = `${etHour.toString().padStart(2, '0')}:${utcMinute.toString().padStart(2, '0')}`;
  if (!isWeekday || !isWithinHours) {
    console.log(`🕐 [MARKET-HOURS] ET: ${etTimeStr}, Day: ${etDay}, Market: ${isWeekday && isWithinHours ? 'OPEN' : 'CLOSED'}`);
  }
  
  return isWeekday && isWithinHours;
}
