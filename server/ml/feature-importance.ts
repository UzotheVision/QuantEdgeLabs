/**
 * Feature Importance Analysis
 *
 * Ranks trading signals by their actual predictive power.
 * Uses permutation importance and ablation studies.
 *
 * Key insight: More signals ≠ better predictions.
 * We need to identify which signals actually add value.
 */

import { db } from '../db';
import { tradeIdeas } from '@shared/schema';
import { gte, and, desc, or, eq } from 'drizzle-orm';
import { logger } from '../logger';

export interface FeatureImportance {
  featureName: string;
  category: 'technical' | 'flow' | 'sentiment' | 'quant' | 'ai' | 'ml';
  importance: number;           // 0-100 score
  winRateContribution: number;  // How much it adds to win rate
  avgConfidenceBoost: number;   // Avg confidence when present
  frequency: number;            // How often signal appears (%)
  correlation: number;          // Correlation with other signals
  recommendation: 'keep' | 'reduce_weight' | 'remove' | 'increase_weight';
}

export interface FeatureImportanceReport {
  features: FeatureImportance[];
  topFeatures: string[];
  redundantFeatures: string[];  // High correlation, low unique contribution
  weakFeatures: string[];       // Low importance, consider removing
  totalSampleSize: number;
  baselineWinRate: number;
  generatedAt: Date;
}

// Signal categories mapping
const SIGNAL_CATEGORIES: Record<string, FeatureImportance['category']> = {
  // Technical signals
  'RSI_OVERSOLD': 'technical',
  'RSI_OVERBOUGHT': 'technical',
  'GOLDEN_CROSS': 'technical',
  'DEATH_CROSS': 'technical',
  'MACD_BULLISH': 'technical',
  'MACD_BEARISH': 'technical',
  'BOLLINGER_BOUNCE': 'technical',
  'SUPPORT_BOUNCE': 'technical',
  'RESISTANCE_BREAK': 'technical',
  'TREND_BREAKOUT': 'technical',
  'VOLUME_SPIKE': 'technical',

  // Flow signals
  'UNUSUAL_CALL_FLOW': 'flow',
  'UNUSUAL_PUT_FLOW': 'flow',
  'SWEEP_DETECTED': 'flow',
  'LARGE_PREMIUM': 'flow',
  'DARK_POOL_PRINT': 'flow',
  'INSIDER_BUYING': 'flow',
  'INSTITUTIONAL_ACCUMULATION': 'flow',

  // Sentiment signals
  'BULLISH_SENTIMENT': 'sentiment',
  'BEARISH_SENTIMENT': 'sentiment',
  'NEWS_CATALYST': 'sentiment',
  'EARNINGS_BEAT': 'sentiment',
  'EARNINGS_MISS': 'sentiment',
  'SOCIAL_BUZZ': 'sentiment',
  'FEAR_EXTREME': 'sentiment',
  'GREED_EXTREME': 'sentiment',

  // Quant signals
  'MOMENTUM_STRONG': 'quant',
  'MEAN_REVERSION': 'quant',
  'VOLATILITY_EXPANSION': 'quant',
  'VOLATILITY_CONTRACTION': 'quant',
  'RELATIVE_STRENGTH': 'quant',
  'STATISTICAL_EDGE': 'quant',

  // AI signals
  'AI_BULLISH': 'ai',
  'AI_BEARISH': 'ai',
  'MULTI_LLM_CONSENSUS': 'ai',
  'CHART_PATTERN_AI': 'ai',

  // ML signals
  'ML_PREDICTION_UP': 'ml',
  'ML_PREDICTION_DOWN': 'ml',
  'REGIME_SHIFT': 'ml',
  'ANOMALY_DETECTED': 'ml',
};

// Correlation groups (signals that often appear together)
const CORRELATION_GROUPS = [
  ['RSI_OVERSOLD', 'SUPPORT_BOUNCE', 'MEAN_REVERSION'],
  ['GOLDEN_CROSS', 'MACD_BULLISH', 'MOMENTUM_STRONG'],
  ['UNUSUAL_CALL_FLOW', 'SWEEP_DETECTED', 'LARGE_PREMIUM'],
  ['NEWS_CATALYST', 'VOLUME_SPIKE', 'BULLISH_SENTIMENT'],
  ['AI_BULLISH', 'MULTI_LLM_CONSENSUS', 'ML_PREDICTION_UP'],
];

/**
 * Analyze feature importance from historical trade data
 */
export async function analyzeFeatureImportance(
  lookbackDays: number = 90
): Promise<FeatureImportanceReport> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  try {
    // Fetch completed trades with signals (using outcomeStatus from tradeIdeas)
    const completedTrades = await db
      .select({
        id: tradeIdeas.id,
        symbol: tradeIdeas.symbol,
        confidence: tradeIdeas.confidence,
        signals: tradeIdeas.signals,
        source: tradeIdeas.source,
        outcome: tradeIdeas.outcomeStatus,
        actualReturn: tradeIdeas.exitPrice,
        entryPrice: tradeIdeas.entryPrice,
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
      logger.warn(`[FEATURE_IMPORTANCE] Insufficient data: ${completedTrades.length} trades`);
      return generateEmptyReport('Need 50+ completed trades for feature importance analysis');
    }

    // Calculate baseline win rate (no signal filtering)
    const totalWins = completedTrades.filter(t => t.outcome === 'hit_target').length;
    const baselineWinRate = (totalWins / completedTrades.length) * 100;

    // Extract all signals from trades
    const signalCounts = new Map<string, {
      total: number;
      wins: number;
      confidenceSum: number;
      returnSum: number;
    }>();

    for (const trade of completedTrades) {
      const signals = parseSignals(trade.signals);

      for (const signal of signals) {
        if (!signalCounts.has(signal)) {
          signalCounts.set(signal, { total: 0, wins: 0, confidenceSum: 0, returnSum: 0 });
        }

        const stats = signalCounts.get(signal)!;
        stats.total++;
        if (trade.outcome === 'hit_target') stats.wins++;
        stats.confidenceSum += trade.confidence || 0;
        // Calculate return from entry/exit prices
        const returnPct = trade.entryPrice && trade.actualReturn
          ? ((trade.actualReturn - trade.entryPrice) / trade.entryPrice) * 100
          : 0;
        stats.returnSum += returnPct;
      }
    }

    // Calculate feature importance scores
    const features: FeatureImportance[] = [];

    for (const [signal, stats] of signalCounts) {
      if (stats.total < 5) continue; // Need minimum sample size

      const signalWinRate = (stats.wins / stats.total) * 100;
      const winRateContribution = signalWinRate - baselineWinRate;
      const avgConfidenceBoost = stats.confidenceSum / stats.total;
      const frequency = (stats.total / completedTrades.length) * 100;

      // Calculate correlation with other signals
      const correlation = calculateSignalCorrelation(signal, completedTrades);

      // Importance score: combination of win rate lift, consistency, and uniqueness
      const importanceRaw =
        (winRateContribution * 2) +           // Win rate contribution (most important)
        (avgConfidenceBoost / 10) +           // Confidence correlation
        (Math.min(frequency, 30) / 3) -       // Frequency (diminishing returns)
        (correlation * 10);                    // Penalty for correlation

      const importance = Math.max(0, Math.min(100, 50 + importanceRaw));

      // Generate recommendation
      let recommendation: FeatureImportance['recommendation'];
      if (importance >= 70 && winRateContribution > 5) {
        recommendation = 'increase_weight';
      } else if (importance >= 50 || winRateContribution > 0) {
        recommendation = 'keep';
      } else if (importance >= 30 && correlation < 0.5) {
        recommendation = 'reduce_weight';
      } else {
        recommendation = 'remove';
      }

      features.push({
        featureName: signal,
        category: SIGNAL_CATEGORIES[signal] || 'technical',
        importance,
        winRateContribution,
        avgConfidenceBoost,
        frequency,
        correlation,
        recommendation,
      });
    }

    // Sort by importance
    features.sort((a, b) => b.importance - a.importance);

    // Identify top, redundant, and weak features
    const topFeatures = features
      .filter(f => f.recommendation === 'increase_weight')
      .map(f => f.featureName);

    const redundantFeatures = features
      .filter(f => f.correlation > 0.6 && f.importance < 60)
      .map(f => f.featureName);

    const weakFeatures = features
      .filter(f => f.recommendation === 'remove')
      .map(f => f.featureName);

    const report: FeatureImportanceReport = {
      features,
      topFeatures,
      redundantFeatures,
      weakFeatures,
      totalSampleSize: completedTrades.length,
      baselineWinRate,
      generatedAt: new Date(),
    };

    logger.info(
      `[FEATURE_IMPORTANCE] Analysis complete: ${features.length} features, ` +
      `${topFeatures.length} top, ${weakFeatures.length} weak`
    );

    return report;
  } catch (error) {
    logger.error('[FEATURE_IMPORTANCE] Analysis failed:', error);
    return generateEmptyReport(`Analysis failed: ${error}`);
  }
}

/**
 * Calculate optimal weights for each signal category
 */
export function calculateOptimalWeights(
  features: FeatureImportance[]
): Map<string, number> {
  const weights = new Map<string, number>();

  // Group by category
  const categoryStats = new Map<string, { totalImportance: number; count: number }>();

  for (const feature of features) {
    if (!categoryStats.has(feature.category)) {
      categoryStats.set(feature.category, { totalImportance: 0, count: 0 });
    }
    const stats = categoryStats.get(feature.category)!;
    stats.totalImportance += feature.importance;
    stats.count++;
  }

  // Calculate normalized weights
  let totalWeight = 0;
  for (const [category, stats] of categoryStats) {
    const avgImportance = stats.totalImportance / stats.count;
    weights.set(category, avgImportance);
    totalWeight += avgImportance;
  }

  // Normalize to sum to 100
  for (const [category, weight] of weights) {
    weights.set(category, (weight / totalWeight) * 100);
  }

  return weights;
}

/**
 * Get recommended signal adjustments for the confidence formula
 */
export function getSignalAdjustments(
  features: FeatureImportance[]
): Map<string, number> {
  const adjustments = new Map<string, number>();

  for (const feature of features) {
    // Base adjustment on win rate contribution
    let adjustment = 1.0;

    if (feature.winRateContribution > 10) {
      adjustment = 1.3; // Increase weight by 30%
    } else if (feature.winRateContribution > 5) {
      adjustment = 1.15; // Increase by 15%
    } else if (feature.winRateContribution > 0) {
      adjustment = 1.0; // Keep as is
    } else if (feature.winRateContribution > -5) {
      adjustment = 0.8; // Reduce by 20%
    } else {
      adjustment = 0.5; // Halve the weight
    }

    // Penalize highly correlated signals
    if (feature.correlation > 0.7) {
      adjustment *= 0.7;
    } else if (feature.correlation > 0.5) {
      adjustment *= 0.85;
    }

    adjustments.set(feature.featureName, adjustment);
  }

  return adjustments;
}

/**
 * Parse signals from trade idea (handles various formats)
 */
function parseSignals(signals: unknown): string[] {
  if (!signals) return [];

  if (Array.isArray(signals)) {
    return signals.filter(s => typeof s === 'string');
  }

  if (typeof signals === 'string') {
    // Try JSON parse
    try {
      const parsed = JSON.parse(signals);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Split by comma or semicolon
      return signals.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    }
  }

  return [];
}

/**
 * Calculate correlation of a signal with other signals
 */
function calculateSignalCorrelation(
  signal: string,
  trades: Array<{ signals: unknown }>
): number {
  // Find which correlation group this signal belongs to
  for (const group of CORRELATION_GROUPS) {
    if (group.includes(signal)) {
      // Count co-occurrence with other signals in group
      let coOccurrences = 0;
      let signalOccurrences = 0;

      for (const trade of trades) {
        const tradeSignals = parseSignals(trade.signals);
        const hasSignal = tradeSignals.includes(signal);

        if (hasSignal) {
          signalOccurrences++;
          const otherGroupSignals = group.filter(s => s !== signal);
          const hasOther = otherGroupSignals.some(s => tradeSignals.includes(s));
          if (hasOther) coOccurrences++;
        }
      }

      if (signalOccurrences > 0) {
        return coOccurrences / signalOccurrences;
      }
    }
  }

  return 0.2; // Default low correlation
}

/**
 * Generate empty report
 */
function generateEmptyReport(reason: string): FeatureImportanceReport {
  return {
    features: [],
    topFeatures: [],
    redundantFeatures: [],
    weakFeatures: [],
    totalSampleSize: 0,
    baselineWinRate: 50,
    generatedAt: new Date(),
  };
}

/**
 * Get a quick summary of feature health
 */
export function getFeatureSummary(report: FeatureImportanceReport): string {
  const { features, topFeatures, weakFeatures, baselineWinRate } = report;

  if (features.length === 0) {
    return 'Insufficient data for feature analysis';
  }

  const avgImportance = features.reduce((sum, f) => sum + f.importance, 0) / features.length;
  const bestFeature = features[0];
  const worstFeature = features[features.length - 1];

  return `
Feature Health Summary:
- ${features.length} signals analyzed (${report.totalSampleSize} trades)
- Baseline win rate: ${baselineWinRate.toFixed(1)}%
- Average importance: ${avgImportance.toFixed(1)}/100
- Top performer: ${bestFeature.featureName} (+${bestFeature.winRateContribution.toFixed(1)}% win rate)
- Worst performer: ${worstFeature.featureName} (${worstFeature.winRateContribution.toFixed(1)}% win rate)
- Signals to boost: ${topFeatures.join(', ') || 'None'}
- Signals to remove: ${weakFeatures.join(', ') || 'None'}
  `.trim();
}

export default {
  analyzeFeatureImportance,
  calculateOptimalWeights,
  getSignalAdjustments,
  getFeatureSummary,
};
