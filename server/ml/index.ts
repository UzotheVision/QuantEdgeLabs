/**
 * ML Module Index
 *
 * Exports all machine learning and statistical analysis components.
 * Use these to validate and improve the trading signal system.
 */

// Import functions needed for internal use in this module
import {
  runCalibrationStudy as _runCalibrationStudy,
  getCalibrationStatus as _getCalibrationStatus,
} from './confidence-calibrator';

import {
  analyzeFeatureImportance as _analyzeFeatureImportance,
} from './feature-importance';

import {
  detectRegime as _detectRegime,
} from './regime-detector';

import {
  calculatePortfolioMetrics as _calculatePortfolioMetrics,
} from './portfolio-metrics';

import {
  trainEnsembleModel as _trainEnsembleModel,
  getModelStatus as _getModelStatus,
} from './ensemble-learner';

// Confidence Calibration
export {
  runCalibrationStudy,
  calibrateConfidence,
  getCalibrationStatus,
  getWinRateBySource,
  type CalibrationReport,
  type CalibrationBin,
  type ConfidenceAdjustment,
} from './confidence-calibrator';

// Feature Importance
export {
  analyzeFeatureImportance,
  calculateOptimalWeights,
  getSignalAdjustments,
  getFeatureSummary,
  type FeatureImportance,
  type FeatureImportanceReport,
} from './feature-importance';

// Market Regime Detection
export {
  detectRegime,
  applyRegimeMultiplier,
  getRegimeSummary,
  type MarketRegime,
  type RegimeAnalysis,
  type SignalMultipliers,
} from './regime-detector';

// Transaction Costs
export {
  calculateTransactionCosts,
  adjustReturnForCosts,
  calculateBreakevenMove,
  getQuickCostEstimate,
  adjustConfidenceForCosts,
  getCostSummary,
  type TransactionCosts,
  type CostParameters,
} from './transaction-costs';

// Portfolio Metrics
export {
  calculatePortfolioMetrics,
  interpretSharpe,
  getPortfolioSummary,
  compareToBenchmarks,
  type PortfolioMetrics,
  type DrawdownAnalysis,
} from './portfolio-metrics';

// Ensemble Meta-Learner
export {
  trainEnsembleModel,
  getEngineWeight,
  combineConfidenceScores,
  getModelStatus,
  getModelSummary,
  updateOnNewOutcome,
  type EngineWeight,
  type EnsembleModel,
} from './ensemble-learner';

/**
 * Run complete ML diagnostics
 */
export async function runMLDiagnostics(lookbackDays: number = 90): Promise<{
  calibration: import('./confidence-calibrator').CalibrationReport;
  featureImportance: import('./feature-importance').FeatureImportanceReport;
  regime: import('./regime-detector').RegimeAnalysis;
  portfolio: import('./portfolio-metrics').PortfolioMetrics;
  ensemble: import('./ensemble-learner').EnsembleModel;
}> {
  const [calibration, featureImportance, regime, portfolio, ensemble] = await Promise.all([
    _runCalibrationStudy(lookbackDays),
    _analyzeFeatureImportance(lookbackDays),
    _detectRegime(),
    _calculatePortfolioMetrics(lookbackDays),
    _trainEnsembleModel(lookbackDays),
  ]);

  return {
    calibration,
    featureImportance,
    regime,
    portfolio,
    ensemble,
  };
}

/**
 * Get ML health check summary
 */
export async function getMLHealthCheck(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
  recommendations: string[];
}> {
  const issues: string[] = [];
  const recommendations: string[] = [];

  try {
    // Check calibration status
    const calibrationStatus = _getCalibrationStatus();
    if (!calibrationStatus.isCalibrated) {
      issues.push('Confidence scores not calibrated');
      recommendations.push('Run calibration study with 90 days of trade data');
    } else if (calibrationStatus.averageAdjustment < 0.8 || calibrationStatus.averageAdjustment > 1.2) {
      issues.push(`Confidence scores ${calibrationStatus.averageAdjustment < 1 ? 'over' : 'under'}confident`);
      recommendations.push('Apply calibration adjustments to confidence formula');
    }

    // Check ensemble model
    const modelStatus = _getModelStatus();
    if (!modelStatus.isTraned) {
      issues.push('Ensemble model not trained');
      recommendations.push('Train ensemble model to optimize engine weights');
    }

    // Check regime detection
    const regime = await _detectRegime();
    if (regime.regime === 'UNKNOWN') {
      issues.push('Market regime detection failed');
      recommendations.push('Check VIX and SPY data feeds');
    } else if (regime.regime === 'CRISIS' || regime.regime === 'HIGH_VOLATILITY') {
      issues.push(`Market in ${regime.regime} mode`);
      recommendations.push('Reduce position sizes and apply regime multipliers');
    }

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (issues.length === 0) {
      status = 'healthy';
    } else if (issues.length <= 2) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return { status, issues, recommendations };
  } catch (error) {
    return {
      status: 'unhealthy',
      issues: [`ML health check failed: ${error}`],
      recommendations: ['Check database connection and data availability'],
    };
  }
}
