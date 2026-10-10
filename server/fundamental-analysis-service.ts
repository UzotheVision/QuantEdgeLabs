/**
 * Fundamental Analysis Service - Regime-Aware Stock Grading
 *
 * Integrates with existing confidence system
 * Uses log returns for performance calculations
 * Adapts to market regimes
 */

import { fundamentalDataProvider } from './fundamental-data-provider';
import { getMarketContext, type MarketContext } from './market-context-service';
import {
  calculateEnhancedConfidence,
  calculateFundamentalScore,
  type StockGradeComponents,
  type EnhancedConfidenceScore,
} from './grade-calculator';
import type { CompanyFundamentals, ComprehensiveGrade } from '../shared/fundamental-types';
import { scoreToGrade } from '../shared/grading';

export class FundamentalAnalysisService {
  /**
   * Get comprehensive stock grade with fundamental + technical integration
   */
  async getStockGrade(
    symbol: string,
    technicalScore?: number,
    signalCount?: number,
    sentimentScore?: number,
    aiScore?: number
  ): Promise<ComprehensiveGrade> {
    // Fetch fundamentals
    const fundamentals = await fundamentalDataProvider.getFundamentals(symbol);

    // Get market regime
    const marketContext = await getMarketContext();

    let fundamentalScore = 0;
    let fundamentalBreakdown = [];

    if (fundamentals) {
      const result = calculateFundamentalScore(fundamentals);
      fundamentalScore = result.score;
      fundamentalBreakdown = result.breakdown;
    }

    // Build component scores
    const components: StockGradeComponents = {
      technicalScore,
      fundamentalScore,
      sentimentScore,
      aiScore,
      signalCount,
      fundamentalBreakdown,
    };

    // Calculate enhanced confidence (integrates all components)
    const enhanced = calculateEnhancedConfidence(components);

    // Adjust for market regime
    const regimeAdjustedScore = this.adjustForMarketRegime(
      enhanced.confidenceScore,
      fundamentalScore,
      marketContext
    );

    const finalGradeInfo = scoreToGrade(regimeAdjustedScore);

    // Build strengths and weaknesses
    const { strengths, weaknesses } = this.extractInsights(
      fundamentals,
      fundamentalBreakdown,
      enhanced
    );

    return {
      symbol,
      overallScore: regimeAdjustedScore,
      overallGrade: finalGradeInfo.grade,

      technicalScore: technicalScore || 0,
      technicalGrade: scoreToGrade(technicalScore || 0).grade,

      fundamentalScore,
      fundamentalGrade: scoreToGrade(fundamentalScore).grade,

      sentimentScore,
      sentimentGrade: sentimentScore ? scoreToGrade(sentimentScore).grade : undefined,

      aiConfidence: aiScore,

      breakdown: fundamentalBreakdown,
      strengths,
      weaknesses,

      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Adjust score based on market regime
   * Systems developed in one regime may underperform in another
   */
  private adjustForMarketRegime(
    baseScore: number,
    fundamentalScore: number,
    marketContext: MarketContext
  ): number {
    let adjustment = 0;

    // In volatile markets, favor strong fundamentals
    if (marketContext.regime === 'volatile') {
      if (fundamentalScore >= 80) {
        adjustment += 3; // Strong fundamentals = safety
      } else if (fundamentalScore < 60) {
        adjustment -= 5; // Weak fundamentals = risky
      }
    }

    // In trending markets, technical alignment matters more
    if (marketContext.regime === 'trending_up' || marketContext.regime === 'trending_down') {
      // Slight boost if direction aligns
      adjustment += 2;
    }

    // In ranging markets, focus on valuation
    if (marketContext.regime === 'ranging') {
      if (fundamentalScore >= 70) {
        adjustment += 2; // Good value play
      }
    }

    return Math.max(0, Math.min(100, baseScore + adjustment));
  }

  /**
   * Extract key insights from fundamental analysis
   */
  private extractInsights(
    fundamentals: CompanyFundamentals | null,
    breakdown: any[],
    enhanced: EnhancedConfidenceScore
  ): { strengths: string[]; weaknesses: string[] } {
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    if (!fundamentals) {
      weaknesses.push('Limited fundamental data available');
      return { strengths, weaknesses };
    }

    // Check each category
    for (const category of breakdown) {
      if (category.score >= 80) {
        strengths.push(`Strong ${category.category}: ${category.grade} (${category.score}/100)`);
      } else if (category.score < 60) {
        weaknesses.push(`Weak ${category.category}: ${category.grade} (${category.score}/100)`);
      }
    }

    // Technical/Fundamental alignment
    const techFundDiff = Math.abs(
      (enhanced.components.technical || 0) - (enhanced.components.fundamental || 0)
    );

    if (techFundDiff < 10) {
      strengths.push('Strong alignment between technical and fundamental analysis');
    } else if (techFundDiff > 25) {
      weaknesses.push('Divergence between technical and fundamental signals');
    }

    // Overall confidence
    if (enhanced.confidenceScore >= 85) {
      strengths.push(`High conviction setup (${enhanced.confidenceScore.toFixed(1)}% confidence)`);
    } else if (enhanced.confidenceScore < 65) {
      weaknesses.push(`Low confidence (${enhanced.confidenceScore.toFixed(1)}%)`);
    }

    return { strengths, weaknesses };
  }

  /**
   * Batch grade multiple symbols (for screener)
   */
  async batchGrade(symbols: string[]): Promise<Map<string, ComprehensiveGrade>> {
    const results = new Map<string, ComprehensiveGrade>();

    // Process in chunks of 5 to avoid rate limits
    const chunkSize = 5;
    for (let i = 0; i < symbols.length; i += chunkSize) {
      const chunk = symbols.slice(i, i + chunkSize);
      const promises = chunk.map(symbol =>
        this.getStockGrade(symbol).catch(() => null)
      );

      const grades = await Promise.all(promises);

      chunk.forEach((symbol, idx) => {
        if (grades[idx]) {
          results.set(symbol, grades[idx]!);
        }
      });

      // Rate limit delay
      if (i + chunkSize < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }
}

// Singleton
export const fundamentalAnalysisService = new FundamentalAnalysisService();
