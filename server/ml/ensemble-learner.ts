/**
 * Ensemble Meta-Learner
 *
 * Learns optimal weights for combining signals from different engines.
 * Uses historical performance to determine which engines to trust more.
 *
 * Instead of fixed weights (Technical 40%, Quant 40%, etc.),
 * we learn weights from actual performance data.
 */

import { db } from '../db';
import { tradeIdeas } from '@shared/schema';
import { gte, and, desc, or, eq } from 'drizzle-orm';
import { logger } from '../logger';

export interface EngineWeight {
  engine: string;
  weight: number;           // 0-1, normalized
  winRate: number;
  sampleSize: number;
  confidence: number;       // Statistical confidence in weight
  adjustment: 'increase' | 'decrease' | 'keep';
}

export interface EnsembleModel {
  weights: Map<string, number>;
  engineStats: EngineWeight[];
  baselineWinRate: number;
  ensembleWinRate: number;  // Estimated win rate using ensemble
  improvement: number;      // % improvement over baseline
  lastUpdated: Date;
  modelVersion: string;
}

// Default weights (used before learning)
const DEFAULT_WEIGHTS: Record<string, number> = {
  'technical': 0.25,
  'quant': 0.25,
  'flow': 0.20,
  'sentiment': 0.15,
  'ai': 0.10,
  'ml': 0.05,
};

// Minimum sample size for reliable weight estimation
const MIN_SAMPLE_SIZE = 20;

// Learning rate for weight updates
const LEARNING_RATE = 0.1;

// Current ensemble model (cached)
let currentModel: EnsembleModel | null = null;

/**
 * Train ensemble model on historical data
 */
export async function trainEnsembleModel(
  lookbackDays: number = 90
): Promise<EnsembleModel> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  try {
    // Fetch completed trades with source/engine info (using outcomeStatus from tradeIdeas)
    const completedTrades = await db
      .select({
        id: tradeIdeas.id,
        source: tradeIdeas.source,
        confidence: tradeIdeas.confidence,
        signals: tradeIdeas.signals,
        outcome: tradeIdeas.outcomeStatus,
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
      )
      .orderBy(desc(tradeIdeas.createdAt));

    if (completedTrades.length < 50) {
      logger.warn(`[ENSEMBLE] Insufficient data: ${completedTrades.length} trades`);
      return createDefaultModel('Insufficient data for training');
    }

    // Calculate baseline win rate (all trades)
    const totalWins = completedTrades.filter(t => t.outcome === 'hit_target').length;
    const baselineWinRate = (totalWins / completedTrades.length) * 100;

    // Group trades by primary signal category
    const engineGroups = new Map<string, typeof completedTrades>();

    for (const trade of completedTrades) {
      const engine = categorizeSource(trade.source, trade.signals);
      if (!engineGroups.has(engine)) {
        engineGroups.set(engine, []);
      }
      engineGroups.get(engine)!.push(trade);
    }

    // Calculate win rate per engine
    const engineStats: EngineWeight[] = [];
    const rawWeights = new Map<string, number>();

    for (const [engine, trades] of engineGroups) {
      if (trades.length < MIN_SAMPLE_SIZE) {
        // Not enough data - use default weight
        rawWeights.set(engine, DEFAULT_WEIGHTS[engine] || 0.1);
        continue;
      }

      const wins = trades.filter(t => t.outcome === 'hit_target').length;
      const winRate = (wins / trades.length) * 100;

      // Calculate statistical confidence using binomial proportion confidence interval
      const p = wins / trades.length;
      const z = 1.96; // 95% confidence
      const stderr = Math.sqrt((p * (1 - p)) / trades.length);
      const confidenceInterval = z * stderr * 100;

      // Weight based on how much better than baseline
      // If engine wins 60% vs baseline 50%, it gets higher weight
      const outperformance = winRate - baselineWinRate;
      let weight = DEFAULT_WEIGHTS[engine] || 0.1;

      // Adjust weight based on performance
      if (outperformance > 10) {
        weight *= 1.5; // 50% boost for strong performers
      } else if (outperformance > 5) {
        weight *= 1.25; // 25% boost
      } else if (outperformance > 0) {
        weight *= 1.1; // 10% boost
      } else if (outperformance < -5) {
        weight *= 0.7; // 30% reduction for underperformers
      } else if (outperformance < 0) {
        weight *= 0.9; // 10% reduction
      }

      rawWeights.set(engine, weight);

      // Determine adjustment recommendation
      let adjustment: 'increase' | 'decrease' | 'keep';
      if (outperformance > 5 && confidenceInterval < 15) {
        adjustment = 'increase';
      } else if (outperformance < -5 && confidenceInterval < 15) {
        adjustment = 'decrease';
      } else {
        adjustment = 'keep';
      }

      engineStats.push({
        engine,
        weight: 0, // Will be normalized
        winRate,
        sampleSize: trades.length,
        confidence: 100 - confidenceInterval,
        adjustment,
      });
    }

    // Normalize weights to sum to 1
    const totalWeight = Array.from(rawWeights.values()).reduce((a, b) => a + b, 0);
    const normalizedWeights = new Map<string, number>();

    for (const [engine, weight] of rawWeights) {
      normalizedWeights.set(engine, weight / totalWeight);
    }

    // Update engineStats with normalized weights
    for (const stat of engineStats) {
      stat.weight = normalizedWeights.get(stat.engine) || 0;
    }

    // Estimate ensemble win rate using weighted combination
    let ensembleWinRate = 0;
    for (const stat of engineStats) {
      ensembleWinRate += stat.weight * stat.winRate;
    }

    const improvement = ensembleWinRate - baselineWinRate;

    const model: EnsembleModel = {
      weights: normalizedWeights,
      engineStats: engineStats.sort((a, b) => b.weight - a.weight),
      baselineWinRate,
      ensembleWinRate,
      improvement,
      lastUpdated: new Date(),
      modelVersion: `v${Date.now()}`,
    };

    // Cache the model
    currentModel = model;

    logger.info(
      `[ENSEMBLE] Model trained: baseline ${baselineWinRate.toFixed(1)}%, ` +
      `ensemble ${ensembleWinRate.toFixed(1)}%, improvement: +${improvement.toFixed(1)}%`
    );

    return model;
  } catch (error) {
    logger.error('[ENSEMBLE] Training failed:', error);
    return createDefaultModel(`Training error: ${error}`);
  }
}

/**
 * Get weight for a specific engine
 */
export function getEngineWeight(engine: string): number {
  if (currentModel && currentModel.weights.has(engine)) {
    return currentModel.weights.get(engine)!;
  }
  return DEFAULT_WEIGHTS[engine] || 0.1;
}

/**
 * Apply ensemble weights to combine confidence scores
 */
export function combineConfidenceScores(
  scores: Map<string, number>
): {
  combinedConfidence: number;
  breakdown: Array<{ engine: string; score: number; weight: number; contribution: number }>;
} {
  const breakdown: Array<{ engine: string; score: number; weight: number; contribution: number }> = [];

  let totalWeight = 0;
  let weightedSum = 0;

  for (const [engine, score] of scores) {
    const weight = getEngineWeight(engine);
    const contribution = score * weight;

    breakdown.push({
      engine,
      score,
      weight,
      contribution,
    });

    weightedSum += contribution;
    totalWeight += weight;
  }

  // Normalize
  const combinedConfidence = totalWeight > 0 ? weightedSum / totalWeight : 50;

  return {
    combinedConfidence: Math.round(combinedConfidence * 10) / 10,
    breakdown: breakdown.sort((a, b) => b.contribution - a.contribution),
  };
}

/**
 * Categorize trade source into engine type
 */
function categorizeSource(source: string | null, signals: unknown): string {
  const sourceLower = (source || '').toLowerCase();

  if (sourceLower.includes('technical') || sourceLower.includes('chart')) {
    return 'technical';
  }
  if (sourceLower.includes('quant') || sourceLower.includes('statistical')) {
    return 'quant';
  }
  if (sourceLower.includes('flow') || sourceLower.includes('option') || sourceLower.includes('sweep')) {
    return 'flow';
  }
  if (sourceLower.includes('sentiment') || sourceLower.includes('news') || sourceLower.includes('social')) {
    return 'sentiment';
  }
  if (sourceLower.includes('ai') || sourceLower.includes('llm') || sourceLower.includes('gpt')) {
    return 'ai';
  }
  if (sourceLower.includes('ml') || sourceLower.includes('predict')) {
    return 'ml';
  }

  // Try to infer from signals
  if (signals) {
    const signalStr = JSON.stringify(signals).toLowerCase();
    if (signalStr.includes('rsi') || signalStr.includes('macd') || signalStr.includes('sma')) {
      return 'technical';
    }
    if (signalStr.includes('flow') || signalStr.includes('sweep')) {
      return 'flow';
    }
  }

  return 'technical'; // Default
}

/**
 * Create default model when training isn't possible
 */
function createDefaultModel(reason: string): EnsembleModel {
  const weights = new Map(Object.entries(DEFAULT_WEIGHTS));
  const engineStats: EngineWeight[] = Object.entries(DEFAULT_WEIGHTS).map(([engine, weight]) => ({
    engine,
    weight,
    winRate: 50,
    sampleSize: 0,
    confidence: 0,
    adjustment: 'keep' as const,
  }));

  return {
    weights,
    engineStats,
    baselineWinRate: 50,
    ensembleWinRate: 50,
    improvement: 0,
    lastUpdated: new Date(),
    modelVersion: 'default',
  };
}

/**
 * Get current model status
 */
export function getModelStatus(): {
  isTraned: boolean;
  lastUpdated: Date | null;
  version: string;
  engineCount: number;
} {
  if (!currentModel) {
    return {
      isTraned: false,
      lastUpdated: null,
      version: 'none',
      engineCount: 0,
    };
  }

  return {
    isTraned: currentModel.modelVersion !== 'default',
    lastUpdated: currentModel.lastUpdated,
    version: currentModel.modelVersion,
    engineCount: currentModel.weights.size,
  };
}

/**
 * Get model summary for display
 */
export function getModelSummary(): string {
  if (!currentModel) {
    return 'Ensemble model not trained. Run trainEnsembleModel() first.';
  }

  const { engineStats, baselineWinRate, ensembleWinRate, improvement, lastUpdated } = currentModel;

  const weightBreakdown = engineStats
    .map(s => `  ${s.engine}: ${(s.weight * 100).toFixed(1)}% weight, ${s.winRate.toFixed(1)}% win rate (n=${s.sampleSize})`)
    .join('\n');

  return `
🤖 Ensemble Model Summary
Updated: ${lastUpdated.toISOString()}
Version: ${currentModel.modelVersion}

Performance:
• Baseline win rate: ${baselineWinRate.toFixed(1)}%
• Ensemble win rate: ${ensembleWinRate.toFixed(1)}%
• Improvement: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(1)}%

Engine Weights:
${weightBreakdown}

Recommendations:
${engineStats
  .filter(s => s.adjustment !== 'keep')
  .map(s => `• ${s.adjustment === 'increase' ? '📈' : '📉'} ${s.adjustment} weight for ${s.engine}`)
  .join('\n') || '• All weights are optimal'}
  `.trim();
}

/**
 * Incremental update when new trade outcome arrives
 */
export async function updateOnNewOutcome(
  engine: string,
  outcome: 'win' | 'loss',
  confidence: number
): Promise<void> {
  if (!currentModel) {
    logger.debug('[ENSEMBLE] No model to update');
    return;
  }

  // Find the engine stats
  const stats = currentModel.engineStats.find(s => s.engine === engine);
  if (!stats) {
    return;
  }

  // Update running statistics
  const oldWinRate = stats.winRate / 100;
  const newOutcome = outcome === 'win' ? 1 : 0;

  // Exponential moving average update
  const alpha = LEARNING_RATE;
  const newWinRate = (1 - alpha) * oldWinRate + alpha * newOutcome;

  stats.winRate = newWinRate * 100;
  stats.sampleSize++;

  // Recalculate weights based on new win rates
  const baselineWinRate = currentModel.baselineWinRate;

  for (const s of currentModel.engineStats) {
    const outperformance = s.winRate - baselineWinRate;
    let weight = DEFAULT_WEIGHTS[s.engine] || 0.1;

    if (outperformance > 10) weight *= 1.5;
    else if (outperformance > 5) weight *= 1.25;
    else if (outperformance > 0) weight *= 1.1;
    else if (outperformance < -5) weight *= 0.7;
    else if (outperformance < 0) weight *= 0.9;

    s.weight = weight;
  }

  // Normalize weights
  const totalWeight = currentModel.engineStats.reduce((sum, s) => sum + s.weight, 0);
  for (const s of currentModel.engineStats) {
    s.weight = s.weight / totalWeight;
    currentModel.weights.set(s.engine, s.weight);
  }

  // Recalculate ensemble win rate
  currentModel.ensembleWinRate = currentModel.engineStats.reduce(
    (sum, s) => sum + s.weight * s.winRate, 0
  );
  currentModel.improvement = currentModel.ensembleWinRate - currentModel.baselineWinRate;
  currentModel.lastUpdated = new Date();

  logger.debug(`[ENSEMBLE] Updated ${engine}: win rate ${stats.winRate.toFixed(1)}%`);
}

export default {
  trainEnsembleModel,
  getEngineWeight,
  combineConfidenceScores,
  getModelStatus,
  getModelSummary,
  updateOnNewOutcome,
};
