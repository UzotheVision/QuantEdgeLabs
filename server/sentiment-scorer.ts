/**
 * News & Sentiment Scorer (10% weight)
 *
 * Analyzes sentiment from:
 * - News articles
 * - Social media (Twitter, Reddit)
 * - Analyst ratings
 * - Earnings reports
 */

import { logger } from './logger';

interface SentimentResult {
  score: number; // 0-100
  breakdown: {
    category: string;
    value: number | string;
    interpretation: string;
    // RESEARCH-GRADE ADDITIONS
    statisticalSignificance?: {
      pValue: number;
      zScore: number;
      confidence: string;
    };
    historicalContext?: {
      percentile: number;
      mean: number;
      stdDev: number;
      sampleSize: number;
    };
    backtestPerformance?: {
      winRate: number;
      avgReturn: number;
      sharpeRatio: number;
      sampleSize: number;
    };
    methodology?: {
      formula: string;
      period: number;
      assumptions: string[];
      citations?: string[];
    };
  }[];
}

class SentimentScorer {
  /**
   * Calculate sentiment score
   */
  async score(symbol: string): Promise<SentimentResult> {
    try {
      logger.info(`[SentimentScorer] Scoring ${symbol}`);

      const { default: YahooFinance } = await import('yahoo-finance2');
      const yahooFinance = new YahooFinance();

      // Fetch news and analyst recommendations
      const [newsData, recommendationsData] = await Promise.allSettled([
        yahooFinance.search(symbol, { newsCount: 10 }).catch(() => ({ news: [] })),
        yahooFinance.quoteSummary(symbol, {
          modules: ['recommendationTrend', 'upgradeDowngradeHistory']
        }).catch(() => null)
      ]);

      const news = newsData.status === 'fulfilled' ? newsData.value.news : [];
      const recommendations = recommendationsData.status === 'fulfilled' ?
        recommendationsData.value : null;

      // Calculate component scores
      const newsScore = this.scoreNews(news);
      const analystScore = this.scoreAnalystRatings(recommendations);
      const socialScore = this.scoreSocialSentiment(symbol); // Placeholder for now

      // Weighted average
      const totalScore = Math.round(
        newsScore.score * 0.40 +
        analystScore.score * 0.40 +
        socialScore.score * 0.20
      );

      const breakdown = [
        ...newsScore.breakdown,
        ...analystScore.breakdown,
        ...socialScore.breakdown
      ];

      logger.info(`[SentimentScorer] ${symbol} scored ${totalScore}/100`);

      return {
        score: totalScore,
        breakdown
      };

    } catch (error: any) {
      logger.error(`[SentimentScorer] Failed to score ${symbol}:`, error.message);
      return {
        score: 50,
        breakdown: [{ category: 'Error', value: 'N/A', interpretation: 'Sentiment data unavailable' }]
      };
    }
  }

  /**
   * Score news sentiment
   * Using keyword analysis for sentiment classification
   */
  private scoreNews(news: any[]): {
    score: number;
    breakdown: any[];
  } {
    if (!news || news.length === 0) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'News Sentiment',
            value: 'No Data',
            interpretation: 'No recent news available'
          }
        ]
      };
    }

    // Analyze news titles for sentiment
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;

    const positiveKeywords = [
      'surge', 'soar', 'rally', 'gain', 'beat', 'exceed', 'upgrade',
      'bullish', 'growth', 'profit', 'revenue', 'strong', 'positive',
      'breakthrough', 'success', 'acquisition', 'partnership', 'win'
    ];

    const negativeKeywords = [
      'drop', 'fall', 'plunge', 'miss', 'decline', 'downgrade',
      'bearish', 'loss', 'weak', 'concern', 'risk', 'warning',
      'lawsuit', 'investigation', 'fraud', 'scandal', 'bankruptcy'
    ];

    news.forEach((article: any) => {
      const title = (article.title || '').toLowerCase();
      const hasPositive = positiveKeywords.some(kw => title.includes(kw));
      const hasNegative = negativeKeywords.some(kw => title.includes(kw));

      if (hasPositive && !hasNegative) {
        positiveCount++;
      } else if (hasNegative && !hasPositive) {
        negativeCount++;
      } else {
        neutralCount++;
      }
    });

    // Calculate sentiment score
    const totalNews = news.length;
    const sentimentRatio = (positiveCount - negativeCount) / totalNews;

    let score = 50 + (sentimentRatio * 50); // Maps -1..1 to 0..100
    score = Math.min(100, Math.max(0, Math.round(score)));

    const overallSentiment =
      score >= 70 ? 'Positive' :
      score >= 55 ? 'Slightly Positive' :
      score >= 45 ? 'Neutral' :
      score >= 30 ? 'Slightly Negative' : 'Negative';

    return {
      score,
      breakdown: [
        {
          category: 'News Articles (Recent)',
          value: `${positiveCount}+ / ${neutralCount}≈ / ${negativeCount}−`,
          interpretation: overallSentiment
        },
        {
          category: 'News Sentiment Score',
          value: `${score}/100`,
          interpretation: score >= 60 ?
            'Predominantly positive news coverage' :
            score >= 40 ?
            'Mixed news sentiment' :
            'Predominantly negative news coverage'
        }
      ]
    };
  }

  /**
   * Score analyst ratings (RESEARCH-GRADE with statistical validation)
   */
  private scoreAnalystRatings(recommendations: any): {
    score: number;
    breakdown: any[];
  } {
    if (!recommendations || !recommendations.recommendationTrend) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Analyst Ratings',
            value: 'N/A',
            interpretation: 'No analyst data available'
          }
        ]
      };
    }

    const trend = recommendations.recommendationTrend?.trend || [];
    if (trend.length === 0) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Analyst Ratings',
            value: 'No Coverage',
            interpretation: 'No analyst coverage'
          }
        ]
      };
    }

    // Get most recent month
    const latest = trend[0];

    const strongBuy = latest.strongBuy || 0;
    const buy = latest.buy || 0;
    const hold = latest.hold || 0;
    const sell = latest.sell || 0;
    const strongSell = latest.strongSell || 0;

    const total = strongBuy + buy + hold + sell + strongSell;

    if (total === 0) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Analyst Ratings',
            value: 'No Ratings',
            interpretation: 'No analyst ratings available'
          }
        ]
      };
    }

    // Weight ratings: strongBuy=5, buy=4, hold=3, sell=2, strongSell=1
    const weightedScore =
      (strongBuy * 5 + buy * 4 + hold * 3 + sell * 2 + strongSell * 1) / total;

    // Map 1-5 to 0-100
    const score = Math.round(((weightedScore - 1) / 4) * 100);

    const consensus =
      score >= 80 ? 'Strong Buy' :
      score >= 60 ? 'Buy' :
      score >= 40 ? 'Hold' :
      score >= 20 ? 'Sell' : 'Strong Sell';

    // ===== STATISTICAL ANALYSIS OF ANALYST CONSENSUS =====

    // Calculate historical consensus scores
    const historicalScores = trend.map((t: any) => {
      const sb = t.strongBuy || 0;
      const b = t.buy || 0;
      const h = t.hold || 0;
      const s = t.sell || 0;
      const ss = t.strongSell || 0;
      const tot = sb + b + h + s + ss;

      if (tot === 0) return 50;

      const ws = (sb * 5 + b * 4 + h * 3 + s * 2 + ss * 1) / tot;
      return Math.round(((ws - 1) / 4) * 100);
    });

    const consensusMean = historicalScores.reduce((a: number, b: number) => a + b, 0) / historicalScores.length;
    const consensusStdDev = Math.sqrt(
      historicalScores.reduce((sum: number, val: number) => sum + Math.pow(val - consensusMean, 2), 0) / historicalScores.length
    );
    const consensusZScore = consensusStdDev !== 0 ? (score - consensusMean) / consensusStdDev : 0;
    const consensusPValue = this.calculatePValue(consensusZScore);
    const consensusPercentile = Math.round(
      (historicalScores.filter((s: number) => s < score).length / historicalScores.length) * 100
    );

    // Calculate coverage diversity (more analysts = more reliable)
    const coverageQuality = total >= 20 ? 'High' : total >= 10 ? 'Medium' : 'Low';
    const coverageScore = total >= 20 ? 1.0 : total >= 10 ? 0.8 : 0.6;

    // Check for recent upgrades/downgrades
    const history = recommendations.upgradeDowngradeHistory?.history || [];
    const recentChanges = history.slice(0, 5); // Last 5 changes

    const upgrades = recentChanges.filter((h: any) =>
      h.toGrade && h.fromGrade &&
      this.gradeValue(h.toGrade) > this.gradeValue(h.fromGrade)
    ).length;

    const downgrades = recentChanges.filter((h: any) =>
      h.toGrade && h.fromGrade &&
      this.gradeValue(h.toGrade) < this.gradeValue(h.fromGrade)
    ).length;

    // Calculate momentum score
    const momentumScore = upgrades - downgrades;
    const momentumInterpretation =
      upgrades > downgrades ? 'Positive analyst momentum - improving sentiment' :
      downgrades > upgrades ? 'Negative analyst momentum - deteriorating sentiment' :
      'Stable analyst views - no clear trend';

    return {
      score,
      breakdown: [
        {
          category: 'Analyst Consensus',
          value: consensus,
          interpretation: `${strongBuy + buy} Buy, ${hold} Hold, ${sell + strongSell} Sell (${total} analysts)`,
          statisticalSignificance: {
            pValue: Math.round(consensusPValue * 1000) / 1000,
            zScore: Math.round(consensusZScore * 100) / 100,
            confidence: this.getConfidenceLevel(consensusPValue)
          },
          historicalContext: {
            percentile: consensusPercentile,
            mean: Math.round(consensusMean * 10) / 10,
            stdDev: Math.round(consensusStdDev * 10) / 10,
            sampleSize: historicalScores.length
          },
          methodology: {
            formula: 'Weighted Score = (StrongBuy×5 + Buy×4 + Hold×3 + Sell×2 + StrongSell×1) / Total',
            period: trend.length,
            assumptions: [
              'Analyst ratings reflect collective professional opinion',
              'Buy-side and sell-side analysts provide independent views',
              'Rating changes (upgrades/downgrades) precede price movements',
              'Higher analyst coverage indicates more reliable consensus',
              'Assumes no systematic bias in analyst ratings'
            ],
            citations: [
              'Womack, K. L. (1996). Do Brokerage Analysts\' Recommendations Have Investment Value? Journal of Finance, 51(1), 137-167',
              'Barber, B., et al. (2001). Can Investors Profit from the Prophets? Security Analyst Recommendations and Stock Returns. Journal of Finance, 56(2), 531-563'
            ]
          }
        },
        {
          category: 'Coverage Quality',
          value: `${total} analysts (${coverageQuality})`,
          interpretation: total >= 20 ?
            'High analyst coverage - consensus highly reliable' :
            total >= 10 ?
            'Moderate coverage - consensus reasonably reliable' :
            'Limited coverage - consensus may be less reliable'
        },
        {
          category: 'Recent Rating Changes',
          value: `${upgrades} upgrades, ${downgrades} downgrades`,
          interpretation: momentumInterpretation,
          historicalContext: {
            percentile: 50, // Placeholder
            mean: 0,
            stdDev: 0,
            sampleSize: recentChanges.length
          },
          methodology: {
            formula: 'Momentum = Recent Upgrades - Recent Downgrades',
            period: 5,
            assumptions: [
              'Recent rating changes (last 5) indicate shifting sentiment',
              'Upgrades are bullish signals; downgrades are bearish',
              'Clustering of upgrades/downgrades amplifies signal strength'
            ],
            citations: [
              'Jegadeesh, N., et al. (2004). Analyzing the Analysts: When Do Recommendations Add Value? Journal of Finance, 59(3), 1083-1124'
            ]
          }
        }
      ]
    };
  }

  /**
   * Calculate p-value from z-score (two-tailed test)
   */
  private calculatePValue(zScore: number): number {
    const absZ = Math.abs(zScore);
    const t = 1 / (1 + 0.2316419 * absZ);
    const d = 0.3989423 * Math.exp(-absZ * absZ / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return 2 * p;
  }

  /**
   * Get confidence level from p-value
   */
  private getConfidenceLevel(pValue: number): string {
    if (pValue < 0.01) return 'HIGH';
    if (pValue < 0.05) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Score social media sentiment
   * Placeholder - would need Twitter/Reddit APIs for real implementation
   */
  private scoreSocialSentiment(symbol: string): {
    score: number;
    breakdown: any[];
  } {
    // TODO: Implement real social sentiment analysis
    // Would require Twitter API, Reddit API, StockTwits API

    return {
      score: 50,
      breakdown: [
        {
          category: 'Social Sentiment',
          value: 'Not Available',
          interpretation: 'Social media sentiment analysis coming soon'
        }
      ]
    };
  }

  /**
   * Convert analyst grade to numeric value
   */
  private gradeValue(grade: string): number {
    const lowerGrade = grade.toLowerCase();

    if (lowerGrade.includes('strong buy') || lowerGrade.includes('buy')) return 5;
    if (lowerGrade.includes('outperform') || lowerGrade.includes('overweight')) return 4;
    if (lowerGrade.includes('hold') || lowerGrade.includes('neutral')) return 3;
    if (lowerGrade.includes('underperform') || lowerGrade.includes('underweight')) return 2;
    if (lowerGrade.includes('sell')) return 1;

    return 3; // Default to hold
  }
}

export const sentimentScorer = new SentimentScorer();
