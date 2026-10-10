/**
 * CONFIDENCE CALIBRATION SERVICE
 * 
 * Learns from historical trade outcomes to provide calibrated confidence scores.
 * Instead of just counting signals, we factor in:
 * - Historical win rate by pattern/asset/engine
 * - Momentum and trend strength
 * - Risk/reward ratio quality
 * - Market regime alignment
 */

import { db } from './db';
import { tradeIdeas } from '@shared/schema';
import { eq, sql, and, gte, lte, isNotNull, ne } from 'drizzle-orm';
import { logger } from './logger';
import { isRealLoss } from '@shared/constants';

export interface CalibrationData {
  assetType: string;
  direction: string;
  source: string;
  signalCount: number;
  winRate: number;
  avgGain: number;
  avgLoss: number;
  sampleSize: number;
}

export interface CalibratedConfidence {
  rawScore: number;           // Original signal-based score
  calibratedScore: number;    // Adjusted based on historical performance
  calibrationFactor: number;  // Multiplier applied (1.0 = no change)
  factors: {
    historicalWinRate: number;   // From similar trades
    riskRewardQuality: number;   // R:R ratio assessment
    signalDensity: number;       // Signal consensus strength
    sampleSizeConfidence: number; // How much data we have
  };
  recommendation: 'high_conviction' | 'standard' | 'cautious' | 'skip';
  reason: string;
}

export interface AdaptiveExitStrategy {
  type: 'fixed' | 'trailing' | 'staged';
  initialTarget: number;      // First profit target (%)
  trailingStop: number;       // Trailing stop distance (%)
  stages: ExitStage[];        // Staged profit taking
  maxHoldTime: number;        // Maximum hold time in minutes
  momentumHoldEnabled: boolean; // Whether to hold on strong momentum
}

export interface ExitStage {
  targetPercent: number;      // Target gain percentage
  exitPercent: number;        // Percentage of position to exit
  trailAfter: boolean;        // Start trailing after this stage
}

// Cache for calibration data (refreshed periodically)
let calibrationCache: Map<string, CalibrationData> = new Map();
let lastCacheRefresh: Date | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Refresh calibration cache from database
 */
export async function refreshCalibrationCache(): Promise<void> {
  try {
    logger.info('📊 [CALIBRATION] Refreshing calibration cache from historical data...');
    
    // Get all resolved trades from last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const resolvedTrades = await db
      .select()
      .from(tradeIdeas)
      .where(
        and(
          isNotNull(tradeIdeas.outcomeStatus),
          ne(tradeIdeas.outcomeStatus, 'open'),
          gte(tradeIdeas.timestamp, ninetyDaysAgo.toISOString())
        )
      );
    
    // Use separate accumulators for proper calculation
    interface GroupAccumulator {
      assetType: string;
      direction: string;
      source: string;
      totalTrades: number;
      winCount: number;
      totalGain: number;  // Sum of all winning gains
      totalLoss: number;  // Sum of all losses (negative values)
      signalSum: number;  // Sum of signal counts
    }
    
    const accumulators = new Map<string, GroupAccumulator>();
    
    // First pass: accumulate raw data
    for (const trade of resolvedTrades) {
      const key = `${trade.assetType}|${trade.direction}|${trade.source}`;
      
      if (!accumulators.has(key)) {
        accumulators.set(key, {
          assetType: trade.assetType,
          direction: trade.direction,
          source: trade.source,
          totalTrades: 0,
          winCount: 0,
          totalGain: 0,
          totalLoss: 0,
          signalSum: 0
        });
      }
      
      const acc = accumulators.get(key)!;
      acc.totalTrades++;
      
      // Count signal occurrences
      const signalCount = trade.qualitySignals?.length || 0;
      acc.signalSum += signalCount;
      
      const status = (trade.outcomeStatus || '').trim().toLowerCase();
      const isWin = status === 'hit_target';
      const isLoss = isRealLoss(trade);
      
      if (isWin) {
        acc.winCount++;
        if (trade.percentGain && trade.percentGain > 0) {
          acc.totalGain += trade.percentGain;
        }
      }
      
      if (isLoss && trade.percentGain && trade.percentGain < 0) {
        acc.totalLoss += trade.percentGain; // Negative value
      }
    }
    
    // Second pass: convert accumulators to CalibrationData with proper averages
    const groups = new Map<string, CalibrationData>();
    
    Array.from(accumulators.entries()).forEach(([key, acc]) => {
      const winRate = acc.totalTrades > 0 ? (acc.winCount / acc.totalTrades) * 100 : 0;
      const avgGain = acc.winCount > 0 ? acc.totalGain / acc.winCount : 0;
      const lossCount = acc.totalTrades - acc.winCount;
      const avgLoss = lossCount > 0 ? acc.totalLoss / lossCount : 0;
      const avgSignalCount = acc.totalTrades > 0 ? acc.signalSum / acc.totalTrades : 0;
      
      groups.set(key, {
        assetType: acc.assetType,
        direction: acc.direction,
        source: acc.source,
        signalCount: Math.round(avgSignalCount),
        winRate,
        avgGain,
        avgLoss,
        sampleSize: acc.totalTrades
      });
    });
    
    calibrationCache = groups;
    lastCacheRefresh = new Date();
    
    logger.info(`📊 [CALIBRATION] Cached ${groups.size} calibration groups from ${resolvedTrades.length} trades`);
    
  } catch (error) {
    logger.error('📊 [CALIBRATION] Error refreshing cache:', error);
  }
}

/**
 * Get calibration data for a trade profile
 */
function getCalibrationData(assetType: string, direction: string, source: string): CalibrationData | null {
  const key = `${assetType}|${direction}|${source}`;
  return calibrationCache.get(key) || null;
}

/**
 * Calculate calibrated confidence score
 */
export async function getCalibratedConfidence(params: {
  assetType: string;
  direction: string;
  source: string;
  signalCount: number;
  riskRewardRatio: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  volatilityRegime?: 'low' | 'normal' | 'high';
}): Promise<CalibratedConfidence> {
  // Refresh cache if stale
  if (!lastCacheRefresh || Date.now() - lastCacheRefresh.getTime() > CACHE_TTL_MS) {
    await refreshCalibrationCache();
  }
  
  // Get historical data for this profile
  const calibrationData = getCalibrationData(params.assetType, params.direction, params.source);
  
  // Calculate raw score from signal count (existing logic)
  const rawScore = Math.min(100, 40 + (params.signalCount * 12));
  
  // Factor 1: Historical win rate adjustment
  let historicalWinRate = 0.5; // Default 50% if no data
  if (calibrationData && calibrationData.sampleSize >= 10) {
    const rawWR = calibrationData.winRate;
    historicalWinRate = (Number.isFinite(rawWR) && rawWR >= 0 && rawWR <= 100) ? rawWR / 100 : 0.5;
  }

  // Factor 2: Risk/Reward quality
  const safeRR = Number.isFinite(params.riskRewardRatio) ? params.riskRewardRatio : 1.0;
  let riskRewardQuality = 0.5;
  if (safeRR >= 3) {
    riskRewardQuality = 0.9;
  } else if (safeRR >= 2) {
    riskRewardQuality = 0.75;
  } else if (safeRR >= 1.5) {
    riskRewardQuality = 0.6;
  } else {
    riskRewardQuality = 0.4;
  }
  
  // Factor 3: Signal density (from trade's signal count vs historical average)
  // This measures how many confirming signals exist for this setup
  let signalDensity = 0.5;
  if (params.signalCount >= 5) {
    signalDensity = 0.95; // Exceptional signal alignment
  } else if (params.signalCount >= 4) {
    signalDensity = 0.8;
  } else if (params.signalCount >= 3) {
    signalDensity = 0.65;
  } else if (params.signalCount >= 2) {
    signalDensity = 0.5;
  } else {
    signalDensity = 0.3;
  }
  
  // Factor 4: Sample size confidence
  let sampleSizeConfidence = 0.3;
  if (calibrationData) {
    if (calibrationData.sampleSize >= 50) sampleSizeConfidence = 1.0;
    else if (calibrationData.sampleSize >= 30) sampleSizeConfidence = 0.8;
    else if (calibrationData.sampleSize >= 15) sampleSizeConfidence = 0.6;
    else if (calibrationData.sampleSize >= 5) sampleSizeConfidence = 0.4;
  }
  
  // Combine factors with weights
  const calibrationFactor = (
    historicalWinRate * 0.35 +          // 35% weight on historical performance
    riskRewardQuality * 0.25 +           // 25% weight on R:R
    signalDensity * 0.20 +               // 20% weight on signal consensus
    sampleSizeConfidence * 0.20          // 20% weight on data confidence
  ) * 2; // Scale to ~1.0 average

  // NaN safety
  const safeFactor = Number.isFinite(calibrationFactor) ? calibrationFactor : 1.0;

  // Apply calibration
  const rawCalibrated = rawScore * safeFactor;
  const calibratedScore = Number.isFinite(rawCalibrated) ? Math.min(100, Math.max(10, rawCalibrated)) : rawScore;
  
  // Determine recommendation
  let recommendation: CalibratedConfidence['recommendation'];
  let reason: string;
  
  if (calibratedScore >= 75 && historicalWinRate >= 0.6 && params.riskRewardRatio >= 2) {
    recommendation = 'high_conviction';
    reason = `Strong setup: ${(historicalWinRate * 100).toFixed(0)}% historical win rate, ${params.riskRewardRatio.toFixed(1)}:1 R:R`;
  } else if (calibratedScore >= 55) {
    recommendation = 'standard';
    reason = 'Solid setup with reasonable risk/reward profile';
  } else if (calibratedScore >= 40) {
    recommendation = 'cautious';
    reason = 'Lower conviction - consider smaller position size';
  } else {
    recommendation = 'skip';
    reason = 'Insufficient edge - recommend passing on this trade';
  }
  
  return {
    rawScore,
    calibratedScore: Math.round(calibratedScore),
    calibrationFactor: Math.round(calibrationFactor * 100) / 100,
    factors: {
      historicalWinRate: Math.round(historicalWinRate * 100),
      riskRewardQuality: Math.round(riskRewardQuality * 100),
      signalDensity: Math.round(signalDensity * 100),
      sampleSizeConfidence: Math.round(sampleSizeConfidence * 100)
    },
    recommendation,
    reason
  };
}

/**
 * Generate adaptive exit strategy based on trade characteristics
 */
export function generateAdaptiveExitStrategy(params: {
  assetType: string;
  direction: string;
  confidenceScore: number;
  riskRewardRatio: number;
  volatilityRegime: 'low' | 'normal' | 'high';
  isLotto?: boolean;
  targetGainPercent: number;
  stopLossPercent: number;
}): AdaptiveExitStrategy {
  const { assetType, confidenceScore, riskRewardRatio, volatilityRegime, isLotto, targetGainPercent, stopLossPercent } = params;
  
  // Base configuration varies by asset type
  let baseTrailingStop = stopLossPercent * 0.6; // Default: 60% of stop loss as trail
  let stages: ExitStage[] = [];
  let type: AdaptiveExitStrategy['type'] = 'staged';
  
  // HIGH CONVICTION: Let winners run with trailing stops
  if (confidenceScore >= 75 && riskRewardRatio >= 2) {
    // Staged profit taking with trailing
    stages = [
      { targetPercent: targetGainPercent * 0.4, exitPercent: 25, trailAfter: false },   // Take 25% at 40% of target
      { targetPercent: targetGainPercent * 0.7, exitPercent: 25, trailAfter: false },   // Take 25% at 70% of target
      { targetPercent: targetGainPercent, exitPercent: 25, trailAfter: true },          // Take 25% at target, start trailing
      // Remaining 25% trails for maximum gain
    ];
    baseTrailingStop = Math.max(stopLossPercent * 0.5, 3); // Tighter trail for winners
    
  // LOTTO PLAYS: Quick profit taking, protect gains
  } else if (isLotto || assetType === 'option') {
    stages = [
      { targetPercent: 15, exitPercent: 30, trailAfter: false },    // Quick 15% - take 30%
      { targetPercent: 30, exitPercent: 30, trailAfter: false },    // 30% gain - take another 30%
      { targetPercent: 50, exitPercent: 20, trailAfter: true },     // 50% gain - take 20%, start trailing
      // Remaining 20% trails for home run
    ];
    baseTrailingStop = 8; // 8% trailing stop for options
    
  // STANDARD: Balanced approach
  } else if (confidenceScore >= 55) {
    stages = [
      { targetPercent: targetGainPercent * 0.5, exitPercent: 33, trailAfter: false },  // Half target: take 1/3
      { targetPercent: targetGainPercent, exitPercent: 33, trailAfter: true },         // Full target: take 1/3, trail
      // Remaining 33% trails
    ];
    baseTrailingStop = stopLossPercent * 0.7;
    
  // LOW CONVICTION: Conservative exits
  } else {
    stages = [
      { targetPercent: targetGainPercent * 0.6, exitPercent: 50, trailAfter: false },  // Take half early
      { targetPercent: targetGainPercent, exitPercent: 50, trailAfter: false },        // Take rest at target
    ];
    type = 'fixed';
    baseTrailingStop = stopLossPercent;
  }
  
  // Adjust trailing stop based on volatility
  if (volatilityRegime === 'high') {
    baseTrailingStop *= 1.3; // Wider trail in high volatility
  } else if (volatilityRegime === 'low') {
    baseTrailingStop *= 0.8; // Tighter trail in low volatility
  }
  
  // Calculate max hold time
  let maxHoldTime: number;
  if (assetType === 'option') {
    maxHoldTime = 24 * 60; // 24 hours for options (theta decay)
  } else if (assetType === 'crypto') {
    maxHoldTime = 72 * 60; // 72 hours for crypto
  } else if (confidenceScore >= 75) {
    maxHoldTime = 5 * 24 * 60; // 5 days for high conviction
  } else {
    maxHoldTime = 48 * 60; // 48 hours default
  }
  
  return {
    type,
    initialTarget: targetGainPercent,
    trailingStop: Math.round(baseTrailingStop * 10) / 10,
    stages,
    maxHoldTime,
    momentumHoldEnabled: confidenceScore >= 70
  };
}

/**
 * Check if we should continue holding based on momentum
 */
export function shouldContinueHolding(params: {
  currentGainPercent: number;
  highestGainPercent: number;
  trailingStop: number;
  stages: ExitStage[];
  remainingPositionPercent: number;
}): { hold: boolean; reason: string; suggestedAction?: string } {
  const { currentGainPercent, highestGainPercent, trailingStop, stages, remainingPositionPercent } = params;
  
  // Check if trailing stop hit
  const drawdownFromHigh = highestGainPercent - currentGainPercent;
  if (drawdownFromHigh >= trailingStop && currentGainPercent > 0) {
    return {
      hold: false,
      reason: `Trailing stop hit: ${drawdownFromHigh.toFixed(1)}% drawdown from high of +${highestGainPercent.toFixed(1)}%`,
      suggestedAction: 'EXIT_ALL'
    };
  }
  
  // Check if any exit stage reached
  for (const stage of stages) {
    if (currentGainPercent >= stage.targetPercent && !stage.trailAfter) {
      return {
        hold: true,
        reason: `Stage target +${stage.targetPercent}% reached`,
        suggestedAction: `EXIT_${stage.exitPercent}%`
      };
    }
  }
  
  // Continue holding if still profitable and above trailing threshold
  if (currentGainPercent > 0) {
    return {
      hold: true,
      reason: `Holding with +${currentGainPercent.toFixed(1)}% gain (high: +${highestGainPercent.toFixed(1)}%)`
    };
  }
  
  return {
    hold: true,
    reason: 'Position within normal range'
  };
}

/**
 * Format exit strategy for display
 */
export function formatExitStrategyDisplay(strategy: AdaptiveExitStrategy): string {
  const stageDescriptions = strategy.stages.map((s, i) => {
    const trailNote = s.trailAfter ? ' → Trail' : '';
    return `${i + 1}. +${s.targetPercent}%: Exit ${s.exitPercent}%${trailNote}`;
  });
  
  return [
    `Strategy: ${strategy.type.toUpperCase()}`,
    `Trailing Stop: -${strategy.trailingStop}%`,
    ...stageDescriptions,
    strategy.momentumHoldEnabled ? '✓ Momentum hold enabled' : ''
  ].filter(Boolean).join('\n');
}

// Initialize cache on module load
refreshCalibrationCache().catch(err => {
  logger.error('📊 [CALIBRATION] Initial cache refresh failed:', err);
});
