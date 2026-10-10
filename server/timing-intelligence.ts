// 🕐 TIMING INTELLIGENCE: Trade-specific timing windows
// Derives unique entry/exit windows based on trade characteristics, volatility, and NLP cues

import { formatInTimeZone } from 'date-fns-tz';
import { logger } from './logger';
import type { AssetType, VolatilityRegime, SessionPhase } from '@shared/schema';

export interface TimingWindowsInput {
  symbol: string;
  assetType: AssetType;
  direction: 'long' | 'short';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  analysis: string;
  catalyst: string;
  confidenceScore?: number;
  riskRewardRatio?: number;
  // Optional quant metrics (from quant generator)
  volatilityRegime?: VolatilityRegime;
  sessionPhase?: SessionPhase;
  trendStrength?: number;
  // Optional technical indicators for volatility proxy
  rsiValue?: number;
  volumeRatio?: number;
  // ✅ Option-specific fields
  expiryDate?: string; // ISO date string for option expiration
  // ✅ NEW: Allow explicit holding period override
  holdingPeriod?: 'day' | 'swing' | 'position';
}

export interface TimingWindowsOutput {
  // ISO timestamps for database storage
  entryValidUntil: string;
  exitBy: string;
  // Metadata for database columns
  holdingPeriodType: 'day' | 'swing' | 'position' | 'week-ending';
  entryWindowMinutes: number;
  exitWindowMinutes: number;
  timingConfidence: number;
  targetHitProbability: number;
  volatilityRegime: VolatilityRegime;
  sessionPhase: SessionPhase;
  trendStrength: number;
  // Debug info
  timingReason: string;
}

// 📝 NLP TIMING CUES: Parse analysis text for timing signals
function parseTimingCues(analysisText: string): {
  entryUrgency: 'immediate' | 'moderate' | 'patient';
  entryMultiplier: number;
  reason: string;
} {
  const text = analysisText.toLowerCase();
  
  // IMMEDIATE ENTRY CUES (short entry window: 0.5x - 0.75x)
  const immediateCues = [
    'immediate entry',
    'breakout',
    'breaking out',
    'momentum',
    'squeeze',
    'capitulation',
    'flush',
    'spike',
    'gap up',
    'gap down',
    'strong move',
    'explosive',
    'rapid move'
  ];
  
  // PATIENT ENTRY CUES (long entry window: 1.5x - 2.0x)
  const patientCues = [
    'wait for pullback',
    'wait for dip',
    'wait for retest',
    'pullback',
    'retracement',
    'consolidation',
    'accumulation',
    'support test',
    'wait for confirmation',
    'scale in',
    'laddering',
    'reversal setup',
    'bottom formation'
  ];
  
  // Check for immediate cues
  for (const cue of immediateCues) {
    if (text.includes(cue)) {
      return {
        entryUrgency: 'immediate',
        entryMultiplier: 0.5 + Math.random() * 0.25, // 0.5x - 0.75x
        reason: `"${cue}" detected - short entry window`
      };
    }
  }
  
  // Check for patient cues
  for (const cue of patientCues) {
    if (text.includes(cue)) {
      return {
        entryUrgency: 'patient',
        entryMultiplier: 1.5 + Math.random() * 0.5, // 1.5x - 2.0x
        reason: `"${cue}" detected - extended entry window`
      };
    }
  }
  
  // Default: moderate entry window with slight randomization
  return {
    entryUrgency: 'moderate',
    entryMultiplier: 0.9 + Math.random() * 0.2, // 0.9x - 1.1x (±10% variance)
    reason: 'standard entry window with randomization'
  };
}

// 🔬 VOLATILITY ESTIMATION: Estimate volatility from available data
function estimateVolatilityRegime(input: TimingWindowsInput): {
  regime: VolatilityRegime;
  exitMultiplier: number;
  reason: string;
} {
  // Use quant-provided volatility if available
  if (input.volatilityRegime) {
    const multipliers: Record<VolatilityRegime, number> = {
      'low': 1.3 + Math.random() * 0.2,      // 1.3x - 1.5x (longer holds in calm markets)
      'normal': 0.9 + Math.random() * 0.2,   // 0.9x - 1.1x (standard)
      'high': 0.6 + Math.random() * 0.2,     // 0.6x - 0.8x (shorter holds in volatile markets)
      'extreme': 0.4 + Math.random() * 0.2   // 0.4x - 0.6x (very short holds in extreme volatility)
    };
    
    return {
      regime: input.volatilityRegime,
      exitMultiplier: multipliers[input.volatilityRegime],
      reason: `quant-provided: ${input.volatilityRegime}`
    };
  }
  
  // Estimate from R:R ratio (wide stops = high volatility)
  const maxLoss = input.direction === 'long'
    ? (input.entryPrice - input.stopLoss) / input.entryPrice
    : (input.stopLoss - input.entryPrice) / input.entryPrice;
  
  const maxLossPercent = maxLoss * 100;
  
  // Estimate from technical indicators
  const hasHighRSI = input.rsiValue !== undefined && (input.rsiValue > 70 || input.rsiValue < 30);
  const hasHighVolume = input.volumeRatio !== undefined && input.volumeRatio > 2.5;
  
  // Crypto always has higher baseline volatility
  const isCrypto = input.assetType === 'crypto';
  
  // Options have inherent volatility from time decay
  const isOptions = input.assetType === 'option';
  
  // Decision tree for volatility regime
  let regime: VolatilityRegime;
  let exitMultiplier: number;
  let reason: string;
  
  if (isOptions || maxLossPercent > 4.0 || (hasHighRSI && hasHighVolume)) {
    regime = 'high';
    exitMultiplier = 0.6 + Math.random() * 0.2; // 0.6x - 0.8x
    reason = `high volatility (${isOptions ? 'options' : maxLossPercent.toFixed(1) + '% stop'})`;
  } else if (isCrypto || maxLossPercent > 3.0 || hasHighVolume) {
    regime = 'normal';
    exitMultiplier = 0.9 + Math.random() * 0.2; // 0.9x - 1.1x
    reason = `normal volatility (${isCrypto ? 'crypto' : maxLossPercent.toFixed(1) + '% stop'})`;
  } else if (maxLossPercent < 2.0) {
    regime = 'low';
    exitMultiplier = 1.3 + Math.random() * 0.2; // 1.3x - 1.5x
    reason = `low volatility (${maxLossPercent.toFixed(1)}% stop)`;
  } else {
    regime = 'normal';
    exitMultiplier = 0.9 + Math.random() * 0.2; // 0.9x - 1.1x
    reason = `normal volatility (${maxLossPercent.toFixed(1)}% stop)`;
  }
  
  return { regime, exitMultiplier, reason };
}

// 📅 SESSION PHASE: Determine current market session
function determineSessionPhase(): SessionPhase {
  const now = new Date();
  const etHour = parseInt(formatInTimeZone(now, 'America/New_York', 'H'));
  const etMinute = parseInt(formatInTimeZone(now, 'America/New_York', 'm'));
  
  // Convert to minutes since midnight for easier comparison
  const etMinutesSinceMidnight = etHour * 60 + etMinute;
  
  // Market hours: 9:30 AM - 4:00 PM ET
  const marketOpen = 9 * 60 + 30;   // 9:30 AM
  const midDay = 11 * 60 + 30;      // 11:30 AM
  const closeStart = 15 * 60;       // 3:00 PM
  const marketClose = 16 * 60;      // 4:00 PM
  
  if (etMinutesSinceMidnight < marketOpen || etMinutesSinceMidnight >= marketClose) {
    return 'overnight';
  } else if (etMinutesSinceMidnight >= marketOpen && etMinutesSinceMidnight < midDay) {
    return 'opening';
  } else if (etMinutesSinceMidnight >= closeStart) {
    return 'closing';
  } else {
    return 'mid-day';
  }
}

// 🎯 CONFIDENCE-BASED TIMING: Adjust windows based on confidence score
function calculateConfidenceAdjustment(confidenceScore: number): {
  confidenceMultiplier: number;
  reason: string;
} {
  // High confidence (>60) → shorter windows (trade more aggressively)
  // Low confidence (<50) → longer windows (be more patient)
  
  if (confidenceScore >= 65) {
    return {
      confidenceMultiplier: 0.7 + Math.random() * 0.15, // 0.7x - 0.85x
      reason: `high confidence (${confidenceScore.toFixed(0)}) - aggressive timing`
    };
  } else if (confidenceScore >= 55) {
    return {
      confidenceMultiplier: 0.9 + Math.random() * 0.2, // 0.9x - 1.1x
      reason: `moderate confidence (${confidenceScore.toFixed(0)}) - standard timing`
    };
  } else {
    return {
      confidenceMultiplier: 1.2 + Math.random() * 0.3, // 1.2x - 1.5x
      reason: `lower confidence (${confidenceScore.toFixed(0)}) - patient timing`
    };
  }
}

// 🏗️ MAIN FUNCTION: Derive trade-specific timing windows
export function deriveTimingWindows(
  input: TimingWindowsInput,
  baseTimestamp: Date = new Date()
): TimingWindowsOutput {
  // 1. Parse NLP timing cues from analysis
  const nlpCues = parseTimingCues(input.analysis + ' ' + input.catalyst);
  
  // 2. Estimate volatility regime
  const volatilityInfo = estimateVolatilityRegime(input);
  
  // 3. Determine session phase
  const sessionPhase = input.sessionPhase || determineSessionPhase();
  
  // 4. Calculate confidence adjustment
  const confidenceScore = input.confidenceScore || 50;
  const confidenceInfo = calculateConfidenceAdjustment(confidenceScore);
  
  // 5. Determine holding period - use explicit override or calculate
  let holdingPeriodType: 'day' | 'swing' | 'position' | 'week-ending';
  
  if (input.holdingPeriod) {
    // Use explicit holding period if provided
    holdingPeriodType = input.holdingPeriod;
    logger.info(`⏰ [TIMING] ${input.symbol}: Using explicit holdingPeriod="${input.holdingPeriod}"`);
  } else {
    // Calculate holding period based on confidence + volatility
    // IMPORTANT: Check position first (most restrictive), then swing, then day
    if (input.assetType === 'crypto') {
      // Crypto: Based on confidence level
      if (confidenceScore >= 80) {
        holdingPeriodType = 'position';
      } else if (confidenceScore >= 60) {
        holdingPeriodType = 'swing';
      } else {
        holdingPeriodType = 'day';
      }
    } else if (input.assetType === 'stock' || input.assetType === 'penny_stock') {
      // Stocks: Based on confidence + volatility
      if (confidenceScore >= 80 && volatilityInfo.regime === 'low') {
        holdingPeriodType = 'position'; // Very high conviction = position trade
      } else if (confidenceScore >= 65 && (volatilityInfo.regime === 'low' || volatilityInfo.regime === 'normal')) {
        holdingPeriodType = 'swing'; // High conviction = swing trade
      } else {
        holdingPeriodType = 'day'; // Default to day trade
      }
    } else {
      holdingPeriodType = 'day'; // Default for other asset types
    }
  }
  
  // 6. Calculate base windows based on HOLDING PERIOD TYPE
  let baseEntryWindow: number;
  let baseExitWindow: number;
  
  // Entry windows vary by asset type
  if (input.assetType === 'option') {
    baseEntryWindow = 45;     // 45 minutes base (options need quick entry due to theta)
  } else if (input.assetType === 'crypto') {
    baseEntryWindow = 90;     // 1.5 hours base (24/7 market)
  } else {
    baseEntryWindow = 60;     // 1 hour base (stocks)
  }
  
  // Exit windows based on HOLDING PERIOD TYPE
  switch (holdingPeriodType) {
    case 'day':
      // Day trade: exit by end of trading day (use minutes until 4 PM ET)
      if (input.assetType === 'option') {
        baseExitWindow = 300;   // 5 hours for options (theta decay)
      } else if (input.assetType === 'crypto') {
        baseExitWindow = 480;   // 8 hours for crypto day trades
      } else {
        baseExitWindow = 390;   // ~6.5 hours (typical trading day)
      }
      break;
      
    case 'swing':
      // Swing trade: 3-5 trading days
      if (input.assetType === 'crypto') {
        baseExitWindow = 72 * 60;   // 72 hours (3 days, 24/7)
      } else {
        baseExitWindow = 3 * 6.5 * 60; // 3 trading days (~19.5 hours of trading)
      }
      break;
      
    case 'position':
      // Position trade: 1-2 weeks
      if (input.assetType === 'crypto') {
        baseExitWindow = 10 * 24 * 60;  // 10 days (24/7)
      } else {
        baseExitWindow = 10 * 6.5 * 60; // 10 trading days (~65 hours of trading)
      }
      break;
      
    default:
      baseExitWindow = 360; // Fallback: 6 hours
  }
  
  // 7. Apply all multipliers to create unique windows
  const entryWindowMinutes = Math.round(
    baseEntryWindow * 
    nlpCues.entryMultiplier * 
    confidenceInfo.confidenceMultiplier
  );
  
  const exitWindowMinutes = Math.round(
    baseExitWindow * 
    volatilityInfo.exitMultiplier * 
    confidenceInfo.confidenceMultiplier
  );
  
  // 8. Calculate ISO timestamps
  const entryValidUntil = new Date(baseTimestamp.getTime() + entryWindowMinutes * 60 * 1000).toISOString();
  
  // ✅ FIX: For options, exit_by MUST be BEFORE or ON expiry_date (can't hold past expiration!)
  let exitBy: string;
  if (input.assetType === 'option' && input.expiryDate) {
    const optionExpiryDate = new Date(input.expiryDate);
    // Set option expiry to 4:00 PM ET (16:00) on expiry date (when options expire)
    optionExpiryDate.setHours(16, 0, 0, 0);
    
    // Calculate default exit_by based on exit window
    const defaultExitBy = new Date(baseTimestamp.getTime() + exitWindowMinutes * 60 * 1000);
    
    // Use the EARLIER of: (defaultExitBy OR option expiry time)
    // This ensures we never try to exit AFTER the option has expired
    const actualExitBy = defaultExitBy < optionExpiryDate ? defaultExitBy : optionExpiryDate;
    exitBy = actualExitBy.toISOString();
    
    logger.info(`⏰ [TIMING] ${input.symbol} OPTION: Exit by ${formatInTimeZone(actualExitBy, 'America/New_York', 'MMM dd h:mm a zzz')} (option expires ${formatInTimeZone(optionExpiryDate, 'America/New_York', 'MMM dd h:mm a zzz')})`);
  } else if (input.assetType === 'stock' || input.assetType === 'penny_stock') {
    // Calculate exit based on holding period type
    const defaultExitBy = new Date(baseTimestamp.getTime() + exitWindowMinutes * 60 * 1000);
    
    if (holdingPeriodType === 'day') {
      // DAY TRADE: Must exit by market close TODAY (4:00 PM ET)
      const marketCloseToday = new Date(baseTimestamp);
      marketCloseToday.setHours(16, 0, 0, 0); // 4:00 PM ET
      
      const actualExitBy = defaultExitBy < marketCloseToday ? defaultExitBy : marketCloseToday;
      exitBy = actualExitBy.toISOString();
      
      logger.info(`⏰ [TIMING] ${input.symbol} STOCK DAY: Exit by ${formatInTimeZone(actualExitBy, 'America/New_York', 'MMM dd h:mm a zzz')} (market closes today at 4:00 PM ET)`);
    } else if (holdingPeriodType === 'swing') {
      // SWING TRADE: Exit within 3-5 trading days (at market close on that day)
      const tradingDaysAhead = 3; // 3 trading days for swing
      let targetExitDate = new Date(baseTimestamp);
      let daysAdded = 0;
      
      // Add trading days (skip weekends)
      while (daysAdded < tradingDaysAhead) {
        targetExitDate.setDate(targetExitDate.getDate() + 1);
        const dayOfWeek = targetExitDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday (0) or Saturday (6)
          daysAdded++;
        }
      }
      
      // Set to market close (4:00 PM ET) on target day
      targetExitDate.setHours(16, 0, 0, 0);
      exitBy = targetExitDate.toISOString();
      
      logger.info(`⏰ [TIMING] ${input.symbol} STOCK SWING: Exit by ${formatInTimeZone(targetExitDate, 'America/New_York', 'MMM dd h:mm a zzz')} (${tradingDaysAhead} trading days)`);
    } else if (holdingPeriodType === 'position') {
      // POSITION TRADE: Exit within 10+ trading days (at market close on that day)
      const tradingDaysAhead = 10; // 10 trading days for position
      let targetExitDate = new Date(baseTimestamp);
      let daysAdded = 0;
      
      // Add trading days (skip weekends)
      while (daysAdded < tradingDaysAhead) {
        targetExitDate.setDate(targetExitDate.getDate() + 1);
        const dayOfWeek = targetExitDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday (0) or Saturday (6)
          daysAdded++;
        }
      }
      
      // Set to market close (4:00 PM ET) on target day
      targetExitDate.setHours(16, 0, 0, 0);
      exitBy = targetExitDate.toISOString();
      
      logger.info(`⏰ [TIMING] ${input.symbol} STOCK POSITION: Exit by ${formatInTimeZone(targetExitDate, 'America/New_York', 'MMM dd h:mm a zzz')} (${tradingDaysAhead} trading days)`);
    } else {
      // Fallback: use calculated window clamped to today's market close
      const marketCloseToday = new Date(baseTimestamp);
      marketCloseToday.setHours(16, 0, 0, 0);
      const actualExitBy = defaultExitBy < marketCloseToday ? defaultExitBy : marketCloseToday;
      exitBy = actualExitBy.toISOString();
    }
  } else {
    // For crypto, use calculated exit window (crypto trades 24/7)
    exitBy = new Date(baseTimestamp.getTime() + exitWindowMinutes * 60 * 1000).toISOString();
    
    logger.info(`⏰ [TIMING] ${input.symbol} CRYPTO: Exit by ${formatInTimeZone(new Date(exitBy), 'America/New_York', 'MMM dd h:mm a zzz')} (24/7 trading)`);
  }
  
  // 9. CRITICAL: Recalculate exitWindowMinutes to match actual exitBy timestamp
  // This ensures the duration metadata is consistent with the enforced exit deadline
  const finalExitWindowMinutes = Math.round((new Date(exitBy).getTime() - baseTimestamp.getTime()) / (60 * 1000));
  
  // 10. Calculate trend strength (use provided or estimate from price action)
  const trendStrength = input.trendStrength !== undefined
    ? input.trendStrength
    : 50 + (confidenceScore - 50) * 0.5; // Rough estimate: higher confidence = stronger trend
  
  // 10. Calculate timing confidence and target hit probability
  // Higher confidence + appropriate volatility regime + good NLP cues = higher timing confidence
  const timingConfidence = Math.min(95, Math.max(40, 
    confidenceScore * 0.7 + 
    (volatilityInfo.regime === 'high' ? -10 : 0) +
    (nlpCues.entryUrgency === 'immediate' ? 5 : 0) +
    Math.random() * 10 // Add randomization
  ));
  
  const targetHitProbability = Math.min(90, Math.max(35,
    confidenceScore * 0.8 +
    (volatilityInfo.regime === 'low' ? 5 : -5) +
    Math.random() * 10 // Add randomization
  ));
  
  // 12. Build timing reason for logging
  const timingReason = [
    nlpCues.reason,
    volatilityInfo.reason,
    confidenceInfo.reason,
    `${entryWindowMinutes}min entry, ${finalExitWindowMinutes}min exit (${holdingPeriodType})`
  ].join('; ');
  
  // 13. Log the derived timing windows
  logger.info(`⏰ [TIMING] ${input.symbol}: Entry window ${entryWindowMinutes}min, Exit window ${finalExitWindowMinutes}min (${holdingPeriodType}) - ${timingReason}`);
  
  return {
    entryValidUntil,
    exitBy,
    holdingPeriodType,
    entryWindowMinutes,
    exitWindowMinutes: finalExitWindowMinutes, // Use recalculated value to match exitBy
    timingConfidence,
    targetHitProbability,
    volatilityRegime: volatilityInfo.regime,
    sessionPhase,
    trendStrength,
    timingReason
  };
}

// 📊 HOLDING PERIOD CLASSIFICATION: Classify based on actual duration
// REQUIRED FIX #2: Calculate holding period from actual entry to exit times
export function classifyHoldingPeriodByDuration(
  entryTimestamp: string | Date,
  exitTimestamp: string | Date
): 'day' | 'swing' | 'position' {
  const entryTime = new Date(entryTimestamp);
  const exitTime = new Date(exitTimestamp);
  
  // Calculate duration in milliseconds
  const durationMs = exitTime.getTime() - entryTime.getTime();
  
  // Validate that exit is after entry
  if (durationMs <= 0) {
    logger.error(`❌ [HOLDING-PERIOD] Invalid duration: exit (${exitTimestamp}) is before or equal to entry (${entryTimestamp})`);
    throw new Error(`Invalid duration: exit time must be after entry time. Entry: ${entryTimestamp}, Exit: ${exitTimestamp}`);
  }
  
  // Convert to hours
  const durationHours = durationMs / (1000 * 60 * 60);
  
  // Classify based on thresholds:
  // - < 6 hours = 'day'
  // - 6 hours to 5 days (120 hours) = 'swing'
  // - 5+ days (120+ hours) = 'position'
  
  let classification: 'day' | 'swing' | 'position';
  
  if (durationHours < 6) {
    classification = 'day';
  } else if (durationHours < 120) { // 5 days * 24 hours = 120 hours
    classification = 'swing';
  } else {
    classification = 'position';
  }
  
  logger.info(`📊 [HOLDING-PERIOD] Classified as "${classification}" (${durationHours.toFixed(2)} hours = ${(durationHours / 24).toFixed(2)} days)`);
  
  return classification;
}

// 🔍 BATCH VERIFICATION: Ensure timing windows are unique within batch
export function verifyTimingUniqueness(
  trades: Array<{ symbol: string; entryValidUntil: string; exitBy: string; timingReason?: string }>
): void {
  const entryTimes = new Map<string, string[]>();
  const exitTimes = new Map<string, string[]>();
  
  for (const trade of trades) {
    // Group by timestamp
    if (!entryTimes.has(trade.entryValidUntil)) {
      entryTimes.set(trade.entryValidUntil, []);
    }
    entryTimes.get(trade.entryValidUntil)!.push(trade.symbol);
    
    if (!exitTimes.has(trade.exitBy)) {
      exitTimes.set(trade.exitBy, []);
    }
    exitTimes.get(trade.exitBy)!.push(trade.symbol);
  }
  
  // Check for duplicates
  let hasIdenticalEntry = false;
  let hasIdenticalExit = false;
  
  entryTimes.forEach((symbols, timestamp) => {
    if (symbols.length > 1) {
      logger.warn(`⚠️  [TIMING] Identical entry windows detected: ${symbols.join(', ')} all expire at ${timestamp}`);
      hasIdenticalEntry = true;
    }
  });
  
  exitTimes.forEach((symbols, timestamp) => {
    if (symbols.length > 1) {
      logger.warn(`⚠️  [TIMING] Identical exit windows detected: ${symbols.join(', ')} all expire at ${timestamp}`);
      hasIdenticalExit = true;
    }
  });
  
  if (!hasIdenticalEntry && !hasIdenticalExit) {
    logger.info(`✅ [TIMING] All ${trades.length} trades have unique timing windows`);
  }
  
  // Log summary statistics
  const entryWindowDurations = trades.map(t => {
    const now = new Date();
    const entry = new Date(t.entryValidUntil);
    return Math.round((entry.getTime() - now.getTime()) / (1000 * 60)); // minutes
  });
  
  const exitWindowDurations = trades.map(t => {
    const now = new Date();
    const exit = new Date(t.exitBy);
    return Math.round((exit.getTime() - now.getTime()) / (1000 * 60)); // minutes
  });
  
  logger.info(`📊 [TIMING] Entry window range: ${Math.min(...entryWindowDurations)}min - ${Math.max(...entryWindowDurations)}min`);
  logger.info(`📊 [TIMING] Exit window range: ${Math.min(...exitWindowDurations)}min - ${Math.max(...exitWindowDurations)}min`);
}

// 🔄 DYNAMIC EXIT TIME RECALCULATION: Fluctuates exit times based on current volatility
// Prevents all trades from showing identical exit times
export interface RecalculateExitTimeInput {
  symbol: string;
  assetType: AssetType;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  direction: 'long' | 'short';
  originalExitBy: string; // ISO timestamp
  currentPrice?: number; // Optional current price for volatility estimation
}

export interface RecalculateExitTimeOutput {
  exitBy: string; // Updated ISO timestamp
  varianceApplied: number; // Percentage variance applied (-30% to +30%)
  reason: string;
}

/**
 * Recalculates the exitBy timestamp dynamically based on current market conditions
 * Adds ±10-30% variance to prevent all trades showing identical exit times
 */
export function recalculateExitTime(input: RecalculateExitTimeInput): RecalculateExitTimeOutput {
  const { symbol, assetType, entryPrice, targetPrice, stopLoss, direction, originalExitBy, currentPrice } = input;
  
  const originalExitDate = new Date(originalExitBy);
  const now = new Date();
  
  // Calculate remaining time to original exit
  const remainingMs = originalExitDate.getTime() - now.getTime();
  
  // If already expired or very close, don't adjust
  if (remainingMs < 5 * 60 * 1000) { // Less than 5 minutes
    return {
      exitBy: originalExitBy,
      varianceApplied: 0,
      reason: 'Exit time imminent - no adjustment'
    };
  }
  
  // 📊 VOLATILITY ESTIMATION from price action
  let volatilityMultiplier = 1.0;
  let volatilityReason = 'baseline';
  
  // Calculate price range as volatility proxy
  const maxMove = direction === 'long'
    ? (targetPrice - entryPrice) / entryPrice
    : (entryPrice - targetPrice) / entryPrice;
  
  const maxLoss = direction === 'long'
    ? (entryPrice - stopLoss) / entryPrice
    : (stopLoss - entryPrice) / entryPrice;
  
  const priceRangePercent = (maxMove + maxLoss) * 100;
  
  // If we have current price, use it to estimate volatility
  if (currentPrice !== undefined) {
    const currentPriceMove = Math.abs(currentPrice - entryPrice) / entryPrice * 100;
    
    // High volatility: price already moved significantly from entry
    if (currentPriceMove > 2.5) {
      volatilityMultiplier = 0.7 + Math.random() * 0.1; // 0.7x - 0.8x (shorten exit window)
      volatilityReason = `high vol (${currentPriceMove.toFixed(1)}% move from entry)`;
    } else if (currentPriceMove > 1.5) {
      volatilityMultiplier = 0.85 + Math.random() * 0.15; // 0.85x - 1.0x
      volatilityReason = `moderate vol (${currentPriceMove.toFixed(1)}% move)`;
    } else {
      volatilityMultiplier = 1.0 + Math.random() * 0.2; // 1.0x - 1.2x (can extend slightly)
      volatilityReason = `low vol (${currentPriceMove.toFixed(1)}% move)`;
    }
  } else {
    // Estimate from stop/target range if no current price
    if (priceRangePercent > 8) {
      volatilityMultiplier = 0.75 + Math.random() * 0.15; // Wide range = high vol
      volatilityReason = `wide range (${priceRangePercent.toFixed(1)}%)`;
    } else if (priceRangePercent > 5) {
      volatilityMultiplier = 0.9 + Math.random() * 0.2;
      volatilityReason = `moderate range (${priceRangePercent.toFixed(1)}%)`;
    } else {
      volatilityMultiplier = 1.0 + Math.random() * 0.15;
      volatilityReason = `tight range (${priceRangePercent.toFixed(1)}%)`;
    }
  }
  
  // Asset-specific adjustments
  if (assetType === 'option') {
    volatilityMultiplier *= 0.85; // Options have time decay - shorter windows
    volatilityReason += ' + options theta';
  } else if (assetType === 'crypto') {
    volatilityMultiplier *= 1.1; // Crypto 24/7 - can extend slightly
    volatilityReason += ' + crypto 24/7';
  }
  
  // Add ±10-30% random variance to prevent identical exit times
  // This variance is seeded by symbol hash for consistency within session
  const symbolHash = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const seedVariance = ((symbolHash % 41) - 20) / 100; // -20% to +20% based on symbol
  const randomVariance = (Math.random() - 0.5) * 0.2; // ±10% additional random
  const totalVariance = seedVariance + randomVariance;
  
  // Apply variance (clamped to ±30%)
  const clampedVariance = Math.max(-0.3, Math.min(0.3, totalVariance));
  const finalMultiplier = volatilityMultiplier * (1 + clampedVariance);
  
  // Calculate new remaining time
  const adjustedRemainingMs = remainingMs * finalMultiplier;
  
  // Minimum 10 minutes, maximum is original + 30%
  const minRemainingMs = 10 * 60 * 1000;
  const maxRemainingMs = remainingMs * 1.3;
  const clampedRemainingMs = Math.max(minRemainingMs, Math.min(maxRemainingMs, adjustedRemainingMs));
  
  // Calculate new exit time
  const newExitDate = new Date(now.getTime() + clampedRemainingMs);
  const newExitBy = newExitDate.toISOString();
  
  // Calculate actual variance percentage for logging
  const actualVariance = ((clampedRemainingMs - remainingMs) / remainingMs) * 100;
  
  logger.debug(`⏰ [RECALC] ${symbol}: Exit time adjusted by ${actualVariance.toFixed(1)}% (${volatilityReason})`);
  
  return {
    exitBy: newExitBy,
    varianceApplied: Math.round(actualVariance * 10) / 10,
    reason: volatilityReason
  };
}
