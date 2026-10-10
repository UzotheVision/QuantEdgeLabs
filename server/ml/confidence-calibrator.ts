/**
 * Confidence Calibration System
 *
 * Validates that confidence scores correlate with actual win rates.
 * A well-calibrated system means 70% confidence trades win ~70% of the time.
 *
 * Based on: Platt Scaling, Isotonic Regression, and Bayesian calibration
 */

import { db } from '../db';
import { tradeIdeas } from '@shared/schema';
import { gte, and, desc, or, eq, isNotNull } from 'drizzle-orm';
import { logger } from '../logger';

export interface CalibrationBin {
  binStart: number;
  binEnd: number;
  predictedConfidence: number;  // Average predicted confidence in this bin
  actualWinRate: number;        // Actual win rate observed
  sampleSize: number;
  standardError: number;        // Statistical uncertainty
  isCalibrated: boolean;        // Within 10% of predicted
}

export interface CalibrationReport {
  bins: CalibrationBin[];
  overallAccuracy: number;      // Total win rate
  brierScore: number;           // Calibration quality (lower = better, 0 = perfect)
  expectedCalibrationError: number;  // ECE metric
  maxCalibrationError: number;  // MCE metric
  reliability: number;          // 0-100% how reliable are the scores
  recommendations: string[];
  generatedAt: Date;
}

export interface ConfidenceAdjustment {
  originalConfidence: number;
  calibratedConfidence: number;
  adjustmentFactor: number;
}

// Store calibration data for real-time adjustments
let calibrationModel: CalibrationBin[] = [];
let lastCalibrationUpdate: Date | null = null;

/**
 * Calculate calibration metrics from historical trade data
 */
export async function runCalibrationStudy(
  lookbackDays: number = 90
): Promise<CalibrationReport> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  try {
    // Fetch completed trades with outcomes (using tradeIdeas.outcomeStatus)
    const completedTrades = await db
      .select({
        id: tradeIdeas.id,
        symbol: tradeIdeas.symbol,
        confidence: tradeIdeas.confidence,
        direction: tradeIdeas.direction,
        entryPrice: tradeIdeas.entryPrice,
        targetPrice: tradeIdeas.targetPrice,
        stopLoss: tradeIdeas.stopLoss,
        createdAt: tradeIdeas.createdAt,
        outcomeStatus: tradeIdeas.outcomeStatus,
        exitPrice: tradeIdeas.exitPrice,
        source: tradeIdeas.source,
      })
      .from(tradeIdeas)
      .where(
        and(
          gte(tradeIdeas.createdAt, cutoffDate),
          or(
            eq(tradeIdeas.outcomeStatus, 'hit_target'),
            eq(tradeIdeas.outcomeStatus, 'hit_stop')
          )
        )
      )
      .orderBy(desc(tradeIdeas.createdAt));

    if (completedTrades.length < 30) {
      logger.warn(`[CALIBRATION] Insufficient data: ${completedTrades.length} trades (need 30+)`);
      return generateEmptyReport('Insufficient data for calibration study (need 30+ completed trades)');
    }

    // Create calibration bins (10% intervals)
    const bins: CalibrationBin[] = [];
    const binSize = 10;

    for (let binStart = 50; binStart < 100; binStart += binSize) {
      const binEnd = Math.min(binStart + binSize, 100);

      const tradesInBin = completedTrades.filter(t =>
        t.confidence !== null &&
        t.confidence >= binStart &&
        t.confidence < binEnd
      );

      if (tradesInBin.length === 0) {
        bins.push({
          binStart,
          binEnd,
          predictedConfidence: (binStart + binEnd) / 2,
          actualWinRate: 0,
          sampleSize: 0,
          standardError: 0,
          isCalibrated: false,
        });
        continue;
      }

      const wins = tradesInBin.filter(t => t.outcomeStatus === 'hit_target').length;
      const actualWinRate = (wins / tradesInBin.length) * 100;
      const avgConfidence = tradesInBin.reduce((sum, t) => sum + (t.confidence || 0), 0) / tradesInBin.length;

      // Standard error = sqrt(p * (1-p) / n)
      const p = actualWinRate / 100;
      const standardError = Math.sqrt((p * (1 - p)) / tradesInBin.length) * 100;

      // Is it calibrated? Within 10% of predicted
      const isCalibrated = Math.abs(actualWinRate - avgConfidence) <= 10;

      bins.push({
        binStart,
        binEnd,
        predictedConfidence: avgConfidence,
        actualWinRate,
        sampleSize: tradesInBin.length,
        standardError,
        isCalibrated,
      });
    }

    // Calculate overall metrics
    const totalTrades = completedTrades.length;
    const totalWins = completedTrades.filter(t => t.outcomeStatus === 'hit_target').length;
    const overallAccuracy = (totalWins / totalTrades) * 100;

    // Brier Score: Mean squared error of probability predictions
    // Lower is better (0 = perfect, 0.25 = random)
    let brierSum = 0;
    for (const trade of completedTrades) {
      const predicted = (trade.confidence || 50) / 100;
      const actual = trade.outcomeStatus === 'hit_target' ? 1 : 0;
      brierSum += Math.pow(predicted - actual, 2);
    }
    const brierScore = brierSum / totalTrades;

    // Expected Calibration Error (ECE)
    // Weighted average of |predicted - actual| across bins
    let eceSum = 0;
    let mce = 0;
    for (const bin of bins) {
      if (bin.sampleSize > 0) {
        const binError = Math.abs(bin.predictedConfidence - bin.actualWinRate);
        eceSum += (bin.sampleSize / totalTrades) * binError;
        mce = Math.max(mce, binError);
      }
    }
    const expectedCalibrationError = eceSum;
    const maxCalibrationError = mce;

    // Reliability score (100% = perfect calibration)
    // Based on ECE - lower ECE = higher reliability
    const reliability = Math.max(0, 100 - expectedCalibrationError * 2);

    // Generate recommendations
    const recommendations = generateRecommendations(bins, brierScore, expectedCalibrationError);

    // Update the calibration model for real-time use
    calibrationModel = bins.filter(b => b.sampleSize >= 5);
    lastCalibrationUpdate = new Date();

    const report: CalibrationReport = {
      bins,
      overallAccuracy,
      brierScore,
      expectedCalibrationError,
      maxCalibrationError,
      reliability,
      recommendations,
      generatedAt: new Date(),
    };

    logger.info(`[CALIBRATION] Study complete: ${totalTrades} trades, ${overallAccuracy.toFixed(1)}% win rate, Brier: ${brierScore.toFixed(3)}`);

    return report;
  } catch (error) {
    logger.error('[CALIBRATION] Study failed:', error);
    return generateEmptyReport(`Calibration study failed: ${error}`);
  }
}

/**
 * Apply calibration adjustment to a confidence score
 * Uses isotonic regression-style interpolation
 */
export function calibrateConfidence(rawConfidence: number): ConfidenceAdjustment {
  if (calibrationModel.length === 0 || !lastCalibrationUpdate) {
    // No calibration data - return unadjusted
    return {
      originalConfidence: rawConfidence,
      calibratedConfidence: rawConfidence,
      adjustmentFactor: 1.0,
    };
  }

  // Check if calibration is stale (older than 7 days)
  const staleDays = 7;
  const daysSinceCalibration = (Date.now() - lastCalibrationUpdate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCalibration > staleDays) {
    logger.warn(`[CALIBRATION] Model is stale (${daysSinceCalibration.toFixed(1)} days old)`);
  }

  // Find the appropriate bin
  const bin = calibrationModel.find(b =>
    rawConfidence >= b.binStart && rawConfidence < b.binEnd
  );

  if (!bin || bin.sampleSize < 5) {
    // Not enough data for this confidence level
    return {
      originalConfidence: rawConfidence,
      calibratedConfidence: rawConfidence,
      adjustmentFactor: 1.0,
    };
  }

  // Apply Platt scaling: adjust based on actual win rate
  // If predicted 75% but actual is 55%, we scale down
  const scaleFactor = bin.actualWinRate / bin.predictedConfidence;
  let calibratedConfidence = rawConfidence * scaleFactor;

  // Clamp to reasonable bounds
  calibratedConfidence = Math.max(30, Math.min(95, calibratedConfidence));

  return {
    originalConfidence: rawConfidence,
    calibratedConfidence: Math.round(calibratedConfidence * 10) / 10,
    adjustmentFactor: scaleFactor,
  };
}

/**
 * Get current calibration status
 */
export function getCalibrationStatus(): {
  isCalibrated: boolean;
  lastUpdate: Date | null;
  binCount: number;
  averageAdjustment: number;
} {
  if (calibrationModel.length === 0) {
    return {
      isCalibrated: false,
      lastUpdate: null,
      binCount: 0,
      averageAdjustment: 1.0,
    };
  }

  const adjustments = calibrationModel
    .filter(b => b.sampleSize >= 5)
    .map(b => b.actualWinRate / b.predictedConfidence);

  const avgAdjustment = adjustments.length > 0
    ? adjustments.reduce((a, b) => a + b, 0) / adjustments.length
    : 1.0;

  return {
    isCalibrated: true,
    lastUpdate: lastCalibrationUpdate,
    binCount: calibrationModel.length,
    averageAdjustment: avgAdjustment,
  };
}

/**
 * Generate actionable recommendations from calibration analysis
 */
function generateRecommendations(
  bins: CalibrationBin[],
  brierScore: number,
  ece: number
): string[] {
  const recommendations: string[] = [];

  // Check overall calibration quality
  if (brierScore > 0.2) {
    recommendations.push(
      `HIGH PRIORITY: Brier score (${brierScore.toFixed(3)}) indicates poor calibration. ` +
      `Confidence scores are not predictive of actual outcomes.`
    );
  } else if (brierScore > 0.15) {
    recommendations.push(
      `MODERATE: Brier score (${brierScore.toFixed(3)}) shows room for improvement. ` +
      `Consider adjusting signal weights.`
    );
  }

  // Check for systematic overconfidence
  const overconfidentBins = bins.filter(b =>
    b.sampleSize >= 5 &&
    b.predictedConfidence - b.actualWinRate > 15
  );
  if (overconfidentBins.length > 0) {
    const avgOverconfidence = overconfidentBins.reduce(
      (sum, b) => sum + (b.predictedConfidence - b.actualWinRate), 0
    ) / overconfidentBins.length;
    recommendations.push(
      `OVERCONFIDENCE DETECTED: System is ${avgOverconfidence.toFixed(1)}% too optimistic ` +
      `in ${overconfidentBins.length} confidence ranges. Apply scaling factor of ${(100 / (100 + avgOverconfidence)).toFixed(2)}.`
    );
  }

  // Check for underconfidence
  const underconfidentBins = bins.filter(b =>
    b.sampleSize >= 5 &&
    b.actualWinRate - b.predictedConfidence > 10
  );
  if (underconfidentBins.length > 0) {
    recommendations.push(
      `UNDERCONFIDENCE: Some signals are performing better than predicted. ` +
      `Consider increasing weights for these signal types.`
    );
  }

  // Check for low sample sizes
  const lowSampleBins = bins.filter(b => b.sampleSize < 10 && b.sampleSize > 0);
  if (lowSampleBins.length > 2) {
    recommendations.push(
      `DATA SPARSITY: ${lowSampleBins.length} confidence ranges have <10 samples. ` +
      `Collect more trade outcome data for reliable calibration.`
    );
  }

  // Check specific bins
  for (const bin of bins) {
    if (bin.sampleSize >= 10 && !bin.isCalibrated) {
      const direction = bin.predictedConfidence > bin.actualWinRate ? 'down' : 'up';
      const adjustment = Math.abs(bin.predictedConfidence - bin.actualWinRate);
      recommendations.push(
        `Adjust ${bin.binStart}-${bin.binEnd}% confidence ${direction} by ${adjustment.toFixed(1)}%. ` +
        `(Predicted: ${bin.predictedConfidence.toFixed(1)}%, Actual: ${bin.actualWinRate.toFixed(1)}%)`
      );
    }
  }

  if (recommendations.length === 0) {
    recommendations.push(
      `Calibration looks good! Brier score: ${brierScore.toFixed(3)}, ECE: ${ece.toFixed(1)}%. ` +
      `Continue monitoring as more data accumulates.`
    );
  }

  return recommendations;
}

/**
 * Generate empty report when insufficient data
 */
function generateEmptyReport(reason: string): CalibrationReport {
  return {
    bins: [],
    overallAccuracy: 0,
    brierScore: 0.25, // Random baseline
    expectedCalibrationError: 50,
    maxCalibrationError: 50,
    reliability: 0,
    recommendations: [reason],
    generatedAt: new Date(),
  };
}

/**
 * Calculate win rate by source/engine for feature importance
 */
export async function getWinRateBySource(lookbackDays: number = 90): Promise<Map<string, {
  winRate: number;
  sampleSize: number;
  avgConfidence: number;
  avgReturn: number;
}>> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  const results = new Map();

  try {
    const tradesBySource = await db
      .select({
        source: tradeIdeas.source,
        outcomeStatus: tradeIdeas.outcomeStatus,
        confidence: tradeIdeas.confidence,
        entryPrice: tradeIdeas.entryPrice,
        exitPrice: tradeIdeas.exitPrice,
      })
      .from(tradeIdeas)
      .where(
        and(
          gte(tradeIdeas.createdAt, cutoffDate),
          or(
            eq(tradeIdeas.outcomeStatus, 'hit_target'),
            eq(tradeIdeas.outcomeStatus, 'hit_stop')
          )
        )
      );

    // Group by source
    const sourceGroups = new Map<string, typeof tradesBySource>();
    for (const trade of tradesBySource) {
      const source = trade.source || 'unknown';
      if (!sourceGroups.has(source)) {
        sourceGroups.set(source, []);
      }
      sourceGroups.get(source)!.push(trade);
    }

    // Calculate metrics per source
    for (const [source, trades] of sourceGroups) {
      const wins = trades.filter(t => t.outcomeStatus === 'hit_target').length;
      const winRate = (wins / trades.length) * 100;
      const avgConfidence = trades.reduce((sum, t) => sum + (t.confidence || 0), 0) / trades.length;

      // Calculate average return from entry/exit prices
      let totalReturn = 0;
      let countWithPrices = 0;
      for (const trade of trades) {
        if (trade.entryPrice && trade.exitPrice) {
          const ret = ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
          totalReturn += ret;
          countWithPrices++;
        }
      }
      const avgReturn = countWithPrices > 0 ? totalReturn / countWithPrices : 0;

      results.set(source, {
        winRate,
        sampleSize: trades.length,
        avgConfidence,
        avgReturn,
      });
    }
  } catch (error) {
    logger.error('[CALIBRATION] Win rate by source failed:', error);
  }

  return results;
}

export default {
  runCalibrationStudy,
  calibrateConfidence,
  getCalibrationStatus,
  getWinRateBySource,
};
