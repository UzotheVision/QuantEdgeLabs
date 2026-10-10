/**
 * Grade Calculator - Integrates with Existing Confidence System
 *
 * Enhances the existing confidenceScore by adding fundamental analysis
 * Maintains backward compatibility with existing grading system
 */

import type { CompanyFundamentals, FundamentalScore } from '../shared/fundamental-types';
import { scoreToGrade, getLetterGrade, type GradeLetter } from '../shared/grading';
import { FUNDAMENTAL_CATEGORY_WEIGHTS } from '../shared/grade-types';

export interface StockGradeComponents {
  // Existing components (from technical/AI analysis)
  technicalScore?: number; // 0-100 from pattern analysis
  signalCount?: number; // Number of technical signals
  aiScore?: number; // 0-100 from AI models
  sentimentScore?: number; // 0-100 from social/news sentiment

  // NEW: Fundamental component
  fundamentalScore?: number; // 0-100 from fundamental analysis
  fundamentalBreakdown?: FundamentalScore[]; // Detailed breakdown
}

export interface EnhancedConfidenceScore {
  // Final output (compatible with existing system)
  confidenceScore: number; // 0-100, feeds into existing probabilityBand
  probabilityBand: GradeLetter; // A+, A, A-, etc. (existing format)

  // Component breakdown for transparency
  components: {
    technical: number;
    fundamental: number;
    sentiment: number;
    ai: number;
  };

  // Weighting used
  weights: {
    technical: number;
    fundamental: number;
    sentiment: number;
    ai: number;
  };

  // Detailed fundamental breakdown (if available)
  fundamentalDetails?: FundamentalScore[];

  // Recommendation based on confidence
  recommendation: 'high_conviction' | 'standard' | 'cautious' | 'skip';
  reason: string;
}

/**
 * Default weights for confidence calculation
 * These match the existing system but now include fundamentals
 */
const DEFAULT_WEIGHTS = {
  technical: 0.45, // Existing technical signals (increased slightly)
  fundamental: 0.30, // NEW: Fundamental analysis
  sentiment: 0.15, // Existing sentiment analysis
  ai: 0.10, // Existing AI model confidence
};

/**
 * Calculate enhanced confidence score that integrates fundamentals
 * with existing technical/AI/sentiment scoring
 */
export function calculateEnhancedConfidence(
  components: StockGradeComponents,
  customWeights?: Partial<typeof DEFAULT_WEIGHTS>
): EnhancedConfidenceScore {
  const weights = { ...DEFAULT_WEIGHTS, ...customWeights };

  // Extract component scores (default to 0 if not provided)
  const technicalScore = components.technicalScore || 0;
  const fundamentalScore = components.fundamentalScore || 0;
  const sentimentScore = components.sentimentScore || 0;
  const aiScore = components.aiScore || 0;

  // Calculate weighted confidence score
  let confidenceScore = 0;
  let totalWeight = 0;

  if (technicalScore > 0) {
    confidenceScore += technicalScore * weights.technical;
    totalWeight += weights.technical;
  }

  if (fundamentalScore > 0) {
    confidenceScore += fundamentalScore * weights.fundamental;
    totalWeight += weights.fundamental;
  }

  if (sentimentScore > 0) {
    confidenceScore += sentimentScore * weights.sentiment;
    totalWeight += weights.sentiment;
  }

  if (aiScore > 0) {
    confidenceScore += aiScore * weights.ai;
    totalWeight += weights.ai;
  }

  // Normalize by actual weights used (in case some components are missing)
  if (totalWeight > 0) {
    confidenceScore = confidenceScore / totalWeight;
  }

  // Apply signal bonus (existing system)
  if (components.signalCount) {
    const signalBonus = getSignalBonus(components.signalCount);
    confidenceScore = Math.min(100, confidenceScore + signalBonus);
  }

  // Clamp to 0-100
  confidenceScore = Math.max(0, Math.min(100, confidenceScore));

  // Get grade using existing system
  const gradeInfo = scoreToGrade(confidenceScore);

  // Determine recommendation
  const { recommendation, reason } = getRecommendation(confidenceScore, components);

  return {
    confidenceScore: Math.round(confidenceScore * 10) / 10, // Round to 1 decimal
    probabilityBand: gradeInfo.grade,
    components: {
      technical: technicalScore,
      fundamental: fundamentalScore,
      sentiment: sentimentScore,
      ai: aiScore,
    },
    weights,
    fundamentalDetails: components.fundamentalBreakdown,
    recommendation,
    reason,
  };
}

/**
 * Get signal bonus (from existing system)
 * Signal count provides ADDITIONAL context
 */
function getSignalBonus(signalCount: number): number {
  if (signalCount >= 5) return 5;
  if (signalCount >= 4) return 3;
  if (signalCount >= 3) return 1;
  if (signalCount <= 1) return -3;
  return 0;
}

/**
 * Get recommendation based on confidence score and components
 */
function getRecommendation(
  confidenceScore: number,
  components: StockGradeComponents
): { recommendation: 'high_conviction' | 'standard' | 'cautious' | 'skip'; reason: string } {
  // High conviction: 85+ overall with strong fundamentals OR technicals
  if (confidenceScore >= 85) {
    if (
      (components.fundamentalScore && components.fundamentalScore >= 80) ||
      (components.technicalScore && components.technicalScore >= 80)
    ) {
      return {
        recommendation: 'high_conviction',
        reason: 'Strong alignment across technical and fundamental analysis',
      };
    }
  }

  // Standard: 70-85 with balanced scores
  if (confidenceScore >= 70) {
    return {
      recommendation: 'standard',
      reason: 'Good confidence with balanced indicators',
    };
  }

  // Cautious: 60-70, mixed signals
  if (confidenceScore >= 60) {
    const hasMixedSignals =
      components.technicalScore &&
      components.fundamentalScore &&
      Math.abs(components.technicalScore - components.fundamentalScore) > 20;

    return {
      recommendation: 'cautious',
      reason: hasMixedSignals
        ? 'Mixed signals between technical and fundamental analysis'
        : 'Moderate confidence, proceed with caution',
    };
  }

  // Skip: Below 60
  return {
    recommendation: 'skip',
    reason: 'Confidence too low for trade consideration',
  };
}

/**
 * Score fundamental health (35% of fundamental score)
 */
export function scoreFundamentalHealth(fundamentals: CompanyFundamentals): FundamentalScore {
  const ratios = fundamentals.ratios;
  const metrics: FundamentalScore['metrics'] = [];

  let totalScore = 0;
  let count = 0;

  // Revenue Growth (YoY)
  if (ratios.revenueGrowthYoY !== null) {
    const value = ratios.revenueGrowthYoY;
    const score = scoreRevenueGrowth(value);
    metrics.push({
      name: 'Revenue Growth (YoY)',
      value: `${value.toFixed(1)}%`,
      score,
      benchmark: 10, // 10% is good growth
      interpretation: getGrowthInterpretation(value),
    });
    totalScore += score;
    count++;
  }

  // Profit Margins
  if (ratios.netMargin !== null) {
    const value = ratios.netMargin;
    const score = scoreProfitMargin(value);
    metrics.push({
      name: 'Net Profit Margin',
      value: `${value.toFixed(1)}%`,
      score,
      benchmark: 15, // 15% is healthy
      interpretation: getMarginInterpretation(value),
    });
    totalScore += score;
    count++;
  }

  // ROE (Return on Equity)
  if (ratios.roe !== null) {
    const value = ratios.roe;
    const score = scoreROE(value);
    metrics.push({
      name: 'Return on Equity',
      value: `${value.toFixed(1)}%`,
      score,
      benchmark: 15, // 15% is good ROE
      interpretation: getROEInterpretation(value),
    });
    totalScore += score;
    count++;
  }

  // Debt to Equity
  if (ratios.debtToEquity !== null) {
    const value = ratios.debtToEquity;
    const score = scoreDebtToEquity(value);
    metrics.push({
      name: 'Debt-to-Equity',
      value: value.toFixed(2),
      score,
      benchmark: 1.0, // 1.0 or lower is healthy
      interpretation: getDebtInterpretation(value),
    });
    totalScore += score;
    count++;
  }

  // Current Ratio (Liquidity)
  if (ratios.currentRatio !== null) {
    const value = ratios.currentRatio;
    const score = scoreCurrentRatio(value);
    metrics.push({
      name: 'Current Ratio',
      value: value.toFixed(2),
      score,
      benchmark: 2.0, // 2.0 is ideal
      interpretation: getCurrentRatioInterpretation(value),
    });
    totalScore += score;
    count++;
  }

  const avgScore = count > 0 ? totalScore / count : 0;
  const finalScore = Math.round(avgScore);

  return {
    category: 'Financial Health',
    score: finalScore,
    weight: FUNDAMENTAL_CATEGORY_WEIGHTS['Financial Health'],
    grade: getLetterGrade(finalScore),
    metrics,
  };
}

/**
 * Score valuation metrics (25% of fundamental score)
 */
export function scoreValuation(fundamentals: CompanyFundamentals): FundamentalScore {
  const ratios = fundamentals.ratios;
  const metrics: FundamentalScore['metrics'] = [];

  let totalScore = 0;
  let count = 0;

  // P/E Ratio
  if (ratios.peRatio !== null && ratios.peRatio > 0) {
    const value = ratios.peRatio;
    const score = scorePERatio(value);
    metrics.push({
      name: 'P/E Ratio',
      value: value.toFixed(1),
      score,
      benchmark: 20, // 20 is fair value
      interpretation: getPEInterpretation(value),
    });
    totalScore += score;
    count++;
  }

  // P/B Ratio
  if (ratios.pbRatio !== null && ratios.pbRatio > 0) {
    const value = ratios.pbRatio;
    const score = scorePBRatio(value);
    metrics.push({
      name: 'P/B Ratio',
      value: value.toFixed(1),
      score,
      benchmark: 3.0, // 3.0 is reasonable
      interpretation: getPBInterpretation(value),
    });
    totalScore += score;
    count++;
  }

  // PEG Ratio
  if (ratios.pegRatio !== null && ratios.pegRatio > 0) {
    const value = ratios.pegRatio;
    const score = scorePEGRatio(value);
    metrics.push({
      name: 'PEG Ratio',
      value: value.toFixed(2),
      score,
      benchmark: 1.0, // 1.0 is fair value
      interpretation: getPEGInterpretation(value),
    });
    totalScore += score;
    count++;
  }

  // Price/Sales
  if (ratios.priceToSales !== null && ratios.priceToSales > 0) {
    const value = ratios.priceToSales;
    const score = scorePriceToSales(value);
    metrics.push({
      name: 'Price-to-Sales',
      value: value.toFixed(1),
      score,
      benchmark: 2.0, // 2.0 is reasonable
      interpretation: getPSInterpretation(value),
    });
    totalScore += score;
    count++;
  }

  const avgScore = count > 0 ? totalScore / count : 0;
  const finalScore = Math.round(avgScore);

  return {
    category: 'Valuation',
    score: finalScore,
    weight: FUNDAMENTAL_CATEGORY_WEIGHTS['Valuation'],
    grade: getLetterGrade(finalScore),
    metrics,
  };
}

/**
 * Score growth metrics (20% of fundamental score)
 */
export function scoreGrowthMetrics(fundamentals: CompanyFundamentals): FundamentalScore {
  const ratios = fundamentals.ratios;
  const metrics: FundamentalScore['metrics'] = [];

  let totalScore = 0;
  let count = 0;

  // EPS Growth
  if (ratios.epsGrowthYoY !== null) {
    const value = ratios.epsGrowthYoY;
    const score = scoreEPSGrowth(value);
    metrics.push({
      name: 'EPS Growth (YoY)',
      value: `${value.toFixed(1)}%`,
      score,
      benchmark: 15, // 15% is strong
      interpretation: getGrowthInterpretation(value),
    });
    totalScore += score;
    count++;
  }

  // Revenue Growth (duplicate check from Financial Health)
  if (ratios.revenueGrowthYoY !== null) {
    const value = ratios.revenueGrowthYoY;
    const score = scoreRevenueGrowth(value);
    totalScore += score;
    count++;
  }

  const avgScore = count > 0 ? totalScore / count : 0;
  const finalScore = Math.round(avgScore);

  return {
    category: 'Growth',
    score: finalScore,
    weight: FUNDAMENTAL_CATEGORY_WEIGHTS['Growth'],
    grade: getLetterGrade(finalScore),
    metrics,
  };
}

/**
 * Calculate overall fundamental score from all categories
 */
export function calculateFundamentalScore(fundamentals: CompanyFundamentals): {
  score: number;
  breakdown: FundamentalScore[];
} {
  const breakdown: FundamentalScore[] = [
    scoreFundamentalHealth(fundamentals),
    scoreValuation(fundamentals),
    scoreGrowthMetrics(fundamentals),
  ];

  // Calculate weighted average
  let totalScore = 0;
  let totalWeight = 0;

  for (const category of breakdown) {
    totalScore += category.score * category.weight;
    totalWeight += category.weight;
  }

  const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

  return {
    score: Math.round(finalScore),
    breakdown,
  };
}

// Scoring helper functions
function scoreRevenueGrowth(value: number): number {
  if (value >= 25) return 100;
  if (value >= 15) return 90;
  if (value >= 10) return 80;
  if (value >= 5) return 70;
  if (value >= 0) return 60;
  if (value >= -5) return 40;
  return 20;
}

function scoreProfitMargin(value: number): number {
  if (value >= 25) return 100;
  if (value >= 20) return 90;
  if (value >= 15) return 80;
  if (value >= 10) return 70;
  if (value >= 5) return 60;
  if (value >= 0) return 40;
  return 20;
}

function scoreROE(value: number): number {
  if (value >= 25) return 100;
  if (value >= 20) return 90;
  if (value >= 15) return 80;
  if (value >= 10) return 70;
  if (value >= 5) return 60;
  return 40;
}

function scoreDebtToEquity(value: number): number {
  if (value <= 0.5) return 100;
  if (value <= 1.0) return 90;
  if (value <= 1.5) return 75;
  if (value <= 2.0) return 60;
  if (value <= 3.0) return 40;
  return 20;
}

function scoreCurrentRatio(value: number): number {
  if (value >= 2.5) return 100;
  if (value >= 2.0) return 90;
  if (value >= 1.5) return 80;
  if (value >= 1.0) return 70;
  if (value >= 0.75) return 50;
  return 30;
}

function scorePERatio(value: number): number {
  if (value < 0) return 20; // Negative P/E is bad
  if (value <= 15) return 100; // Undervalued
  if (value <= 20) return 90; // Fair value
  if (value <= 25) return 75;
  if (value <= 35) return 60;
  if (value <= 50) return 40;
  return 20; // Overvalued
}

function scorePBRatio(value: number): number {
  if (value <= 1.0) return 100;
  if (value <= 2.0) return 90;
  if (value <= 3.0) return 80;
  if (value <= 5.0) return 65;
  if (value <= 10.0) return 45;
  return 25;
}

function scorePEGRatio(value: number): number {
  if (value <= 0.5) return 100;
  if (value <= 1.0) return 90;
  if (value <= 1.5) return 75;
  if (value <= 2.0) return 60;
  if (value <= 3.0) return 40;
  return 20;
}

function scorePriceToSales(value: number): number {
  if (value <= 1.0) return 100;
  if (value <= 2.0) return 90;
  if (value <= 3.0) return 75;
  if (value <= 5.0) return 60;
  if (value <= 10.0) return 40;
  return 20;
}

function scoreEPSGrowth(value: number): number {
  if (value >= 30) return 100;
  if (value >= 20) return 90;
  if (value >= 15) return 85;
  if (value >= 10) return 75;
  if (value >= 5) return 65;
  if (value >= 0) return 55;
  return 30;
}

// Interpretation helpers
function getGrowthInterpretation(value: number): string {
  if (value >= 20) return 'Exceptional growth';
  if (value >= 10) return 'Strong growth';
  if (value >= 5) return 'Healthy growth';
  if (value >= 0) return 'Modest growth';
  return 'Declining';
}

function getMarginInterpretation(value: number): string {
  if (value >= 20) return 'Excellent profitability';
  if (value >= 15) return 'Strong margins';
  if (value >= 10) return 'Healthy margins';
  if (value >= 5) return 'Modest margins';
  return 'Weak margins';
}

function getROEInterpretation(value: number): string {
  if (value >= 20) return 'Exceptional returns';
  if (value >= 15) return 'Strong returns';
  if (value >= 10) return 'Good returns';
  if (value >= 5) return 'Fair returns';
  return 'Poor returns';
}

function getDebtInterpretation(value: number): string {
  if (value <= 0.5) return 'Very low debt';
  if (value <= 1.0) return 'Healthy debt levels';
  if (value <= 1.5) return 'Moderate debt';
  if (value <= 2.0) return 'Elevated debt';
  return 'High debt risk';
}

function getCurrentRatioInterpretation(value: number): string {
  if (value >= 2.0) return 'Excellent liquidity';
  if (value >= 1.5) return 'Good liquidity';
  if (value >= 1.0) return 'Adequate liquidity';
  return 'Liquidity concerns';
}

function getPEInterpretation(value: number): string {
  if (value < 0) return 'Company unprofitable';
  if (value <= 15) return 'Undervalued';
  if (value <= 25) return 'Fairly valued';
  if (value <= 35) return 'Moderately expensive';
  return 'Overvalued';
}

function getPBInterpretation(value: number): string {
  if (value <= 1.0) return 'Trading below book value';
  if (value <= 3.0) return 'Reasonable valuation';
  if (value <= 5.0) return 'Moderately expensive';
  return 'High premium to book';
}

function getPEGInterpretation(value: number): string {
  if (value <= 1.0) return 'Undervalued relative to growth';
  if (value <= 2.0) return 'Fairly valued';
  return 'Expensive for growth rate';
}

function getPSInterpretation(value: number): string {
  if (value <= 2.0) return 'Attractive valuation';
  if (value <= 5.0) return 'Moderate valuation';
  return 'High valuation';
}
