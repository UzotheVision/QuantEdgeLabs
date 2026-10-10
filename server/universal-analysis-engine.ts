/**
 * Universal Analysis Engine
 *
 * Single source of truth for all stock analysis across the platform.
 * Aggregates 7 dimensions of analysis with weighted scoring.
 *
 * Dimensions:
 * - Technical (25%): Chart patterns, indicators, trends
 * - Fundamental (30%): Financials, valuation, growth
 * - Quantitative (15%): Statistical metrics, risk analysis
 * - ML Predictions (10%): AI-powered price forecasting
 * - Order Flow (15%): Smart money, institutional activity
 * - Sentiment (10%): News, social media, analyst ratings
 * - Catalysts (5%): Upcoming events, earnings, announcements
 */

import { logger } from './logger';

export interface AnalysisParams {
  timeHorizon?: 'DAY' | 'SWING' | 'LONG' | 'ANY';
  focus?: string[] | 'ALL'; // Which dimensions to emphasize
  minScore?: number;
  includeBreakdown?: boolean;
  includeHistorical?: boolean;
}

export interface ComponentScore {
  score: number; // 0-100
  grade: string; // S, A+, A, A-, B+, B, B-, C+, C, C-, D, F
  weight: number; // 0.25, 0.30, etc.
  breakdown: {
    category: string;
    value: number | string;
    interpretation: string;
  }[];
}

export interface TimeHorizonSignal {
  signal: 'BUY' | 'SELL' | 'WAIT';
  confidence: number; // 0-100
  entry?: number;
  exit?: number;
  targetPrice?: number;
  timeframe?: string;
}

export interface UnifiedAnalysisResponse {
  // Meta
  symbol: string;
  name: string;
  assetType: 'stock' | 'crypto' | 'etf' | 'forex';
  timestamp: string;
  auditId: string;

  // Overall Score
  overall: {
    grade: string; // S, A+, A, A-, B+, B, B-, C+, C, C-, D, F
    score: number; // 0-100
    tier: string; // S, A, B, C, D, F
    recommendation: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  };

  // Component Scores (All 7 Dimensions)
  components: {
    technical: ComponentScore;
    fundamental: ComponentScore;
    quantitative: ComponentScore;
    ml: ComponentScore;
    orderFlow: ComponentScore;
    sentiment: ComponentScore;
    catalysts: ComponentScore;
  };

  // Time Horizon Specific
  timeHorizons: {
    day: TimeHorizonSignal;
    swing: TimeHorizonSignal;
    long: TimeHorizonSignal;
  };

  // Insights
  insights: {
    strengths: string[];
    weaknesses: string[];
    catalysts: string[];
    risks: string[];
  };
}

// Scoring weights (must sum to 1.0)
/**
 * CAUTION: these sum to 1.10, not 1.00.
 *
 * The percentages in the comments are what was intended; the values are what is
 * applied, and they total 110%. calculateOverallScore used to multiply and sum
 * these WITHOUT dividing by the total, so every grade the platform has ever
 * published was inflated by up to 10%. Measured on ADSK 2026-08-27: true
 * weighted score 64, displayed 69 — across the C+/B- boundary, on a stock
 * reporting that night.
 *
 * calculateOverallScore now divides by the weight actually used, so the
 * arithmetic is correct whatever these sum to. The values are left as they are
 * because changing them shifts the relative importance of the categories, which
 * is a modelling decision and not a bug fix — the ratios between them are
 * presumably what was wanted. Fix the ratios deliberately, or leave them; either
 * way the division keeps the output on a 0-100 scale.
 */
export const CATEGORY_WEIGHTS = {
  technical: 0.25,      // intended 25%  → effective 22.7%
  fundamental: 0.30,    // intended 30%  → effective 27.3%
  quantitative: 0.15,   // intended 15%  → effective 13.6%
  ml: 0.10,             // intended 10%  → effective  9.1%   (stub; excluded)
  orderFlow: 0.15,      // intended 15%  → effective 13.6%
  sentiment: 0.10,      // intended 10%  → effective  9.1%
  catalysts: 0.05       // intended  5%  → effective  4.5%
};

/**
 * Universal Analysis Engine - Main Class
 */
export class UniversalAnalysisEngine {
  /**
   * Analyze a single symbol with comprehensive multi-dimensional scoring
   */
  async analyze(symbol: string, params: AnalysisParams = {}): Promise<UnifiedAnalysisResponse> {
    const startTime = Date.now();
    const auditId = this.generateAuditId(symbol);

    try {
      logger.info(`[UniversalEngine] Analyzing ${symbol}`, { params, auditId });

      // Import scorers dynamically
      const [
        { technicalScorer },
        { fundamentalAnalysisService },
        { quantitativeScorer },
        { mlScorer },
        { orderFlowScorer },
        { sentimentScorer },
        { catalystsScorer }
      ] = await Promise.all([
        import('./technical-scorer'),
        import('./fundamental-analysis-service'),
        import('./quantitative-scorer'),
        import('./ml-scorer'),
        import('./order-flow-scorer'),
        import('./sentiment-scorer'),
        import('./catalysts-scorer')
      ]);

      /**
       * Basic stock info, with a fallback.
       *
       * This single call was unguarded while every scorer below it carries a
       * .catch() — so a Yahoo 429 did not degrade the analysis, it destroyed it,
       * and on-demand grading returned "Failed to get crumb, status 429" instead
       * of a grade. Yahoo is rate-limiting persistently right now.
       *
       * Finnhub covers the same fields for the purpose this quote serves here
       * (price and name), is on a separate quota, and is already configured.
       */
      let quote: any = null;
      try {
        const { default: YahooFinance } = await import('yahoo-finance2');
        const yahooFinance = new YahooFinance();
        quote = await yahooFinance.quote(symbol);
      } catch (err: any) {
        try {
          const { getFinnhubQuote, getCompanyProfile } = await import('./finnhub-adapter');
          const [fq, prof] = await Promise.all([
            getFinnhubQuote(symbol),
            getCompanyProfile(symbol).catch(() => null),
          ]);
          if (fq) {
            quote = {
              symbol,
              regularMarketPrice: fq.price,
              regularMarketChangePercent: fq.changePct,
              longName: prof?.name ?? symbol,
              marketCap: prof?.marketCap ?? null,
              _source: 'finnhub',
            };
          }
        } catch { /* both sources down — fall through to the null guard */ }

        if (!quote) {
          // Say WHICH sources failed. "Failed to get crumb" told the user
          // nothing they could act on.
          throw new Error(
            `No quote available for ${symbol} — Yahoo failed (${err?.message ?? 'unknown'}) and Finnhub returned nothing.`,
          );
        }
      }

      // Run all scorers in parallel
      const [
        technicalResult,
        fundamentalResult,
        quantitativeResult,
        mlResult,
        orderFlowResult,
        sentimentResult,
        catalystsResult
      ] = await Promise.all([
        technicalScorer.score(symbol).catch(err => this.handleScorerError('technical', err)),
        fundamentalAnalysisService.getStockGrade(symbol).catch(err => this.handleScorerError('fundamental', err)),
        quantitativeScorer.score(symbol).catch(err => this.handleScorerError('quantitative', err)),
        mlScorer.score(symbol).catch(err => this.handleScorerError('ml', err)),
        orderFlowScorer.score(symbol).catch(err => this.handleScorerError('orderFlow', err)),
        sentimentScorer.score(symbol).catch(err => this.handleScorerError('sentiment', err)),
        catalystsScorer.score(symbol).catch(err => this.handleScorerError('catalysts', err))
      ]);

      /**
       * Which categories produced no reading.
       *
       * Two ways a scorer signals this: an explicit `available: false` (the ml
       * stub), or a breakdown that is nothing but an Error/N-A entry, which is
       * what the Yahoo-dependent scorers emit when their source is down. Both
       * are excluded from the weighted average rather than counted as a vote
       * for 50 — see calculateOverallScore.
       */
      const isUnavailable = (r: any): boolean => {
        if (r?.available === false) return true;
        const bd = r?.breakdown;
        if (!Array.isArray(bd) || bd.length === 0) return true;
        return bd.every((b: any) =>
          b?.category === 'Error' || b?.value === 'N/A' || b?.value === 'Unknown');
      };

      const unavailable = new Set<string>();
      for (const [cat, res] of Object.entries({
        technical: technicalResult,
        fundamental: fundamentalResult,
        quantitative: quantitativeResult,
        ml: mlResult,
        orderFlow: orderFlowResult,
        sentiment: sentimentResult,
        catalysts: catalystsResult,
      })) {
        if (isUnavailable(res)) unavailable.add(cat);
      }
      if (unavailable.size > 0) {
        logger.warn(`[UniversalEngine] ${symbol}: no data from ${[...unavailable].join(', ')} — excluded from the blend`);
      }

      // Calculate overall score
      const overallScore = this.calculateOverallScore({
        technical: technicalResult.score,
        fundamental: fundamentalResult.fundamentalScore || fundamentalResult.score || 50,
        quantitative: quantitativeResult.score,
        ml: mlResult.score,
        orderFlow: orderFlowResult.score,
        sentiment: sentimentResult.score,
        catalysts: catalystsResult.score
      }, unavailable);

      const overallGrade = this.scoreToGrade(overallScore);
      const recommendation = this.scoreToRecommendation(overallScore);
      const confidence = this.calculateConfidence([
        technicalResult,
        fundamentalResult,
        quantitativeResult,
        mlResult,
        orderFlowResult,
        sentimentResult,
        catalystsResult
      ]);

      // Generate time horizon signals
      const timeHorizons = this.generateTimeHorizonSignals(
        overallScore,
        technicalResult,
        fundamentalResult,
        quote.regularMarketPrice || 0
      );

      // Generate insights
      const insights = this.generateInsights({
        technical: technicalResult,
        fundamental: fundamentalResult,
        quantitative: quantitativeResult,
        ml: mlResult,
        orderFlow: orderFlowResult,
        sentiment: sentimentResult,
        catalysts: catalystsResult
      });

      const analysis: UnifiedAnalysisResponse = {
        symbol,
        name: quote.longName || quote.shortName || symbol,
        assetType: this.determineAssetType(quote),
        timestamp: new Date().toISOString(),
        auditId,

        overall: {
          grade: overallGrade,
          score: overallScore,
          tier: overallGrade.charAt(0),
          recommendation,
          confidence
        },

        components: {
          technical: {
            score: technicalResult.score,
            grade: this.scoreToGrade(technicalResult.score),
            weight: CATEGORY_WEIGHTS.technical,
            breakdown: technicalResult.breakdown || []
          },
          fundamental: {
            score: fundamentalResult.fundamentalScore || fundamentalResult.score || 50,
            grade: this.scoreToGrade(fundamentalResult.fundamentalScore || fundamentalResult.score || 50),
            weight: CATEGORY_WEIGHTS.fundamental,
            breakdown: this.flattenFundamentalBreakdown(fundamentalResult.breakdown),
          },
          quantitative: {
            score: quantitativeResult.score,
            grade: this.scoreToGrade(quantitativeResult.score),
            weight: CATEGORY_WEIGHTS.quantitative,
            breakdown: quantitativeResult.breakdown || []
          },
          ml: {
            score: mlResult.score,
            grade: this.scoreToGrade(mlResult.score),
            weight: CATEGORY_WEIGHTS.ml,
            breakdown: mlResult.breakdown || []
          },
          orderFlow: {
            score: orderFlowResult.score,
            grade: this.scoreToGrade(orderFlowResult.score),
            weight: CATEGORY_WEIGHTS.orderFlow,
            breakdown: orderFlowResult.breakdown || []
          },
          sentiment: {
            score: sentimentResult.score,
            grade: this.scoreToGrade(sentimentResult.score),
            weight: CATEGORY_WEIGHTS.sentiment,
            breakdown: sentimentResult.breakdown || []
          },
          catalysts: {
            score: catalystsResult.score,
            grade: this.scoreToGrade(catalystsResult.score),
            weight: CATEGORY_WEIGHTS.catalysts,
            breakdown: catalystsResult.breakdown || []
          }
        },

        timeHorizons,
        insights
      };

      // Log audit trail
      await this.logAnalysis(analysis, params, Date.now() - startTime);

      logger.info(`[UniversalEngine] Completed ${symbol} in ${Date.now() - startTime}ms`, {
        score: overallScore,
        grade: overallGrade,
        auditId
      });

      return analysis;

    } catch (error: any) {
      logger.error(`[UniversalEngine] Failed to analyze ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Batch analyze multiple symbols
   */
  async batchAnalyze(symbols: string[], params: AnalysisParams = {}): Promise<UnifiedAnalysisResponse[]> {
    logger.info(`[UniversalEngine] Batch analyzing ${symbols.length} symbols`);

    const results = await Promise.allSettled(
      symbols.map(symbol => this.analyze(symbol, params))
    );

    return results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<UnifiedAnalysisResponse>).value);
  }

  /**
   * Flatten the fundamental breakdown into the shape the other six scorers use.
   *
   * fundamental-analysis-service returns FundamentalScore[] — category groups
   * ({ category, score, grade, metrics: [{ name, value, interpretation }] }) —
   * while every other scorer returns flat { category, value, interpretation }.
   * The engine passed it straight through, so anything reading `breakdown[].value`
   * rendered "Financial Health: undefined": the values are one level down under
   * `metrics`, keyed `name` rather than `category`.
   *
   * Flattening here rather than in each consumer keeps the contract uniform at
   * the engine boundary, where it is stated.
   */
  private flattenFundamentalBreakdown(breakdown: any): any[] {
    if (!Array.isArray(breakdown)) return [];

    return breakdown.flatMap((group: any) => {
      // Already flat (a defensive path — an error entry, or a future change).
      if (group?.metrics === undefined) {
        return group?.category ? [group] : [];
      }
      const metrics = Array.isArray(group.metrics) ? group.metrics : [];
      return metrics.map((m: any) => ({
        category: group.category ? `${group.category}: ${m?.name ?? ''}`.trim() : (m?.name ?? ''),
        value: m?.value ?? 'N/A',
        interpretation: m?.interpretation ?? '',
      }));
    });
  }

  /**
   * Calculate weighted overall score
   */
  private calculateOverallScore(
    scores: Record<string, number>,
    unavailable: Set<string> = new Set()
  ): number {
    /**
     * Renormalise over the categories that actually produced a reading.
     *
     * The old form defaulted every missing category to 50 and applied its full
     * weight. That treats "no data" as "neutral opinion", which it is not — it
     * drags every grade toward the middle in proportion to how much of the
     * engine is broken. With ml permanently stubbed and, until the fixes in
     * this pass, five other scorers failing on a Yahoo 429, a score of 57 could
     * be one real reading blended with six placeholders and still present as a
     * considered C+.
     *
     * Dropping an unavailable category and rescaling the rest to sum to 1 means
     * a non-reading neither helps nor hurts. The score then reflects only what
     * was actually measured — and the caller can see WHICH categories those
     * were in the breakdown.
     *
     * If every category is unavailable there is nothing to average, and 50 is
     * returned as a genuine "no opinion" rather than a computed one.
     */
    let weightedSum = 0;
    let weightUsed = 0;

    for (const [cat, weight] of Object.entries(CATEGORY_WEIGHTS)) {
      if (unavailable.has(cat)) continue;
      const v = scores[cat];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      weightedSum += v * weight;
      weightUsed += weight;
    }

    if (weightUsed <= 0) return 50;

    const finalScore = Math.min(100, Math.max(0, Math.round(weightedSum / weightUsed)));
    return isNaN(finalScore) ? 50 : finalScore;
  }

  /**
   * Convert score (0-100) to letter grade
   */
  private scoreToGrade(score: number): string {
    if (score >= 95) return 'S';
    if (score >= 90) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 80) return 'A-';
    if (score >= 75) return 'B+';
    if (score >= 70) return 'B';
    if (score >= 65) return 'B-';
    if (score >= 60) return 'C+';
    if (score >= 55) return 'C';
    if (score >= 50) return 'C-';
    if (score >= 40) return 'D';
    return 'F';
  }

  /**
   * Convert score to buy/sell recommendation
   */
  private scoreToRecommendation(score: number): 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' {
    if (score >= 85) return 'STRONG_BUY';
    if (score >= 70) return 'BUY';
    if (score >= 50) return 'HOLD';
    if (score >= 35) return 'SELL';
    return 'STRONG_SELL';
  }

  /**
   * Calculate confidence level based on data completeness
   */
  private calculateConfidence(results: any[]): 'HIGH' | 'MEDIUM' | 'LOW' {
    const completeness = results.filter(r => r && r.score > 0).length / results.length;
    const variance = this.calculateVariance(results.map(r => r?.score || 50));

    if (completeness > 0.9 && variance < 10) return 'HIGH';
    if (completeness > 0.7) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Calculate statistical variance
   */
  private calculateVariance(scores: number[]): number {
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const squaredDiffs = scores.map(score => Math.pow(score - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / scores.length);
  }

  /**
   * Generate time horizon specific signals
   */
  private generateTimeHorizonSignals(
    overallScore: number,
    technical: any,
    fundamental: any,
    currentPrice: number
  ): { day: TimeHorizonSignal; swing: TimeHorizonSignal; long: TimeHorizonSignal } {
    return {
      day: {
        signal: technical.score >= 70 ? 'BUY' : technical.score <= 40 ? 'SELL' : 'WAIT',
        confidence: technical.score,
        entry: currentPrice * 0.98,
        exit: currentPrice * 1.02,
        timeframe: '1-5 days'
      },
      swing: {
        signal: overallScore >= 70 ? 'BUY' : overallScore <= 40 ? 'SELL' : 'WAIT',
        confidence: overallScore,
        entry: currentPrice * 0.95,
        exit: currentPrice * 1.10,
        timeframe: '3-15 days'
      },
      long: {
        signal: fundamental.score >= 70 ? 'BUY' : fundamental.score <= 40 ? 'SELL' : 'WAIT',
        confidence: fundamental.score,
        targetPrice: currentPrice * 1.25,
        timeframe: '3-12 months'
      }
    };
  }

  /**
   * Generate insights based on component scores
   */
  private generateInsights(components: any): {
    strengths: string[];
    weaknesses: string[];
    catalysts: string[];
    risks: string[];
  } {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const catalysts: string[] = [];
    const risks: string[] = [];

    // Analyze each component
    Object.entries(components).forEach(([key, value]: [string, any]) => {
      if (value.score >= 80) {
        strengths.push(`Strong ${key} indicators`);
      } else if (value.score <= 40) {
        weaknesses.push(`Weak ${key} metrics`);
      }
    });

    // Add specific insights from components
    if (components.orderFlow?.breakdown) {
      const bullishFlow = components.orderFlow.breakdown.find((b: any) =>
        b.interpretation.toLowerCase().includes('bullish')
      );
      if (bullishFlow) catalysts.push('Institutional buying detected');
    }

    if (components.fundamental?.breakdown) {
      const highDebt = components.fundamental.breakdown.find((b: any) =>
        b.category.toLowerCase().includes('debt') && b.value > 2
      );
      if (highDebt) risks.push('High debt-to-equity ratio');
    }

    return {
      strengths: strengths.length > 0 ? strengths : ['Moderate performance across metrics'],
      weaknesses: weaknesses.length > 0 ? weaknesses : ['Minor concerns in some areas'],
      catalysts: catalysts.length > 0 ? catalysts : ['Monitor for upcoming events'],
      risks: risks.length > 0 ? risks : ['Standard market risks apply']
    };
  }

  /**
   * Determine asset type from quote data
   */
  private determineAssetType(quote: any): 'stock' | 'crypto' | 'etf' | 'forex' {
    const quoteType = quote.quoteType?.toLowerCase() || '';
    if (quoteType.includes('etf')) return 'etf';
    if (quoteType.includes('cryptocurrency')) return 'crypto';
    if (quoteType.includes('currency')) return 'forex';
    return 'stock';
  }

  /**
   * Handle scorer errors gracefully
   */
  private handleScorerError(scorerName: string, error: any): any {
    logger.warn(`[UniversalEngine] ${scorerName} scorer failed:`, error.message);
    return {
      score: 50, // Neutral score on error
      grade: 'C',
      breakdown: [{ category: 'Error', value: 'N/A', interpretation: 'Data unavailable' }]
    };
  }

  /**
   * Generate unique audit ID
   */
  private generateAuditId(symbol: string): string {
    return `${symbol}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log analysis to audit trail
   */
  private async logAnalysis(
    analysis: UnifiedAnalysisResponse,
    params: AnalysisParams,
    duration: number
  ): Promise<void> {
    try {
      const { analysisLogger } = await import('./analysis-logger');
      await analysisLogger.log({
        auditId: analysis.auditId,
        symbol: analysis.symbol,
        timestamp: analysis.timestamp,
        params,
        result: analysis,
        duration
      });
    } catch (error: any) {
      logger.error('[UniversalEngine] Failed to log audit trail:', error);
      // Don't throw - logging failure shouldn't break analysis
    }
  }
}

// Export singleton instance
export const universalEngine = new UniversalAnalysisEngine();
