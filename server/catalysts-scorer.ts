/**
 * Catalysts & Events Scorer (5% weight)
 *
 * Tracks upcoming events that could impact price:
 * - Earnings dates and history
 * - Product launches
 * - FDA approvals (biotech)
 * - Mergers & Acquisitions
 * - Macro events
 */

import { logger } from './logger';

interface CatalystsResult {
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

class CatalystsScorer {
  /**
   * Calculate catalysts score
   */
  async score(symbol: string): Promise<CatalystsResult> {
    try {
      logger.info(`[CatalystsScorer] Scoring ${symbol}`);

      const { default: YahooFinance } = await import('yahoo-finance2');
      const yahooFinance = new YahooFinance();
      // yahooFinance is already instantiated

      // Fetch earnings and calendar data
      const [calendarData, earningsHistory] = await Promise.allSettled([
        yahooFinance.quoteSummary(symbol, {
          modules: ['calendarEvents']
        }).catch(() => null),
        yahooFinance.quoteSummary(symbol, {
          modules: ['earningsHistory', 'earnings']
        }).catch(() => null)
      ]);

      let calendar: any = calendarData.status === 'fulfilled' ? calendarData.value : null;
      const earnings = earningsHistory.status === 'fulfilled' ? earningsHistory.value : null;

      /**
       * Finnhub backfills the earnings date when Yahoo has none.
       *
       * This scorer is 40%-weighted on the next earnings date and read it only
       * from Yahoo's calendarEvents. With Yahoo 429ing it reported "No upcoming
       * earnings data" on ADSK, WDAY and AFRM on 2026-08-27 — the afternoon all
       * three reported. A catalyst scorer blind to the catalyst is the worst
       * failure in the engine, because earnings is precisely when it is read.
       *
       * Finnhub's /calendar/earnings is free and returns the before/after-close
       * flag Yahoo's field does not, so an AMC print is distinguishable from a
       * BMO one — which is what decides whether a position held overnight is
       * exposed to the report.
       */
      if (!calendar?.calendarEvents?.earnings?.earningsDate?.[0]) {
        try {
          const { getNextEarningsDate } = await import('./finnhub-adapter');
          const fh = await getNextEarningsDate(symbol);
          if (fh?.date) {
            // 'amc' reports after the close, so stamp it in the evening; 'bmo'
            // before the open. The hour matters for same-day expiries.
            const when = new Date(`${fh.date}T${fh.hour === 'bmo' ? '13:00' : '20:30'}:00Z`);
            calendar = {
              ...(calendar ?? {}),
              calendarEvents: {
                ...(calendar?.calendarEvents ?? {}),
                earnings: {
                  ...(calendar?.calendarEvents?.earnings ?? {}),
                  earningsDate: [when],
                  epsEstimate: fh.epsEstimate ?? undefined,
                },
              },
            };
            logger.info(`[CatalystsScorer] ${symbol} earnings from Finnhub: ${fh.date} ${fh.hour || 'time n/a'}`);
          }
        } catch (e: any) {
          logger.debug(`[CatalystsScorer] Finnhub earnings lookup failed for ${symbol}: ${e?.message ?? e}`);
        }
      }

      // Calculate component scores
      const earningsScore = this.scoreEarnings(calendar, earnings);
      const upcomingEventsScore = this.scoreUpcomingEvents(calendar);
      const earningsHistoryScore = this.scoreEarningsHistory(earnings);

      // Weighted average
      const totalScore = Math.round(
        earningsScore.score * 0.40 +
        upcomingEventsScore.score * 0.30 +
        earningsHistoryScore.score * 0.30
      );

      const breakdown = [
        ...earningsScore.breakdown,
        ...upcomingEventsScore.breakdown,
        ...earningsHistoryScore.breakdown
      ];

      logger.info(`[CatalystsScorer] ${symbol} scored ${totalScore}/100`);

      return {
        score: totalScore,
        breakdown
      };

    } catch (error: any) {
      logger.error(`[CatalystsScorer] Failed to score ${symbol}:`, error.message);
      return {
        score: 50,
        breakdown: [{ category: 'Error', value: 'N/A', interpretation: 'Catalyst data unavailable' }]
      };
    }
  }

  /**
   * Score upcoming earnings
   */
  private scoreEarnings(calendar: any, earnings: any): {
    score: number;
    breakdown: any[];
  } {
    if (!calendar || !calendar.calendarEvents) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Earnings Date',
            value: 'Unknown',
            interpretation: 'No upcoming earnings data'
          }
        ]
      };
    }

    const earningsDate = calendar.calendarEvents.earnings?.earningsDate?.[0];

    if (!earningsDate) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Earnings Date',
            value: 'Not Scheduled',
            interpretation: 'No upcoming earnings scheduled'
          }
        ]
      };
    }

    // Calculate days until earnings
    /**
     * Calendar days, not elapsed hours.
     *
     * The old form floored (earningsDate - now) / 86400000, so an AMC print
     * happening TONIGHT read as "1 days ago" the moment the clock passed the
     * stamped time by a few minutes — ADSK, WDAY and AFRM all showed that on
     * 2026-08-27, the afternoon they reported. Flooring a small negative gives
     * -1, and the scorer then treated an imminent catalyst as a past one.
     *
     * Comparing dates at midnight makes "today" mean today, which is the only
     * reading a trader can act on.
     */
    const midnight = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x.getTime();
    };
    const daysUntil = Math.round(
      (midnight(new Date(earningsDate)) - midnight(new Date())) / (1000 * 60 * 60 * 24)
    );

    let score = 50;
    let interpretation = 'Earnings scheduled';

    if (daysUntil < 0) {
      // Recent earnings (within last 7 days)
      if (daysUntil >= -7) {
        score = 55;
        interpretation = 'Recent earnings announcement';
      } else {
        score = 50;
        interpretation = 'No imminent catalysts';
      }
    } else if (daysUntil === 0) {
      score = 62;
      interpretation = 'Earnings TODAY - binary event, position accordingly';
    } else if (daysUntil <= 7) {
      score = 60; // Upcoming earnings in 1 week (anticipation)
      interpretation = 'Earnings this week - high volatility expected';
    } else if (daysUntil <= 14) {
      score = 55;
      interpretation = 'Earnings in 2 weeks - building anticipation';
    } else if (daysUntil <= 30) {
      score = 52;
      interpretation = 'Earnings this month';
    } else {
      score = 50;
      interpretation = 'Earnings in distant future';
    }

    // Get earnings estimate vs actual (if available)
    const estimate = calendar.calendarEvents.earnings?.epsEstimate;
    const avgEstimate = calendar.calendarEvents.earnings?.epsAverage;

    return {
      score,
      breakdown: [
        {
          category: 'Next Earnings',
          value: daysUntil === 0 ? 'TODAY' :
            daysUntil > 0 ?
            `In ${daysUntil} day${daysUntil === 1 ? '' : 's'}` :
            `${Math.abs(daysUntil)} day${daysUntil === -1 ? '' : 's'} ago`,
          interpretation
        },
        {
          category: 'EPS Estimate',
          value: estimate !== undefined ? `$${estimate.toFixed(2)}` : 'N/A',
          interpretation: avgEstimate !== undefined ?
            `Analyst avg: $${avgEstimate.toFixed(2)}` :
            'No consensus estimate'
        }
      ]
    };
  }

  /**
   * Score other upcoming events
   */
  private scoreUpcomingEvents(calendar: any): {
    score: number;
    breakdown: any[];
  } {
    if (!calendar || !calendar.calendarEvents) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Upcoming Events',
            value: 'None',
            interpretation: 'No scheduled events'
          }
        ]
      };
    }

    const events = [];

    // Dividend date
    if (calendar.calendarEvents.exDividendDate) {
      const daysUntil = Math.floor(
        (new Date(calendar.calendarEvents.exDividendDate).getTime() - Date.now()) /
        (1000 * 60 * 60 * 24)
      );

      if (daysUntil >= 0 && daysUntil <= 30) {
        events.push({
          type: 'Dividend',
          days: daysUntil,
          impact: 'positive'
        });
      }
    }

    let score = 50;
    let eventsText = 'None identified';

    if (events.length > 0) {
      score = 55;
      eventsText = events.map(e => `${e.type} in ${e.days} days`).join(', ');
    }

    return {
      score,
      breakdown: [
        {
          category: 'Upcoming Catalysts',
          value: events.length.toString(),
          interpretation: eventsText
        }
      ]
    };
  }

  /**
   * Score historical earnings performance (RESEARCH-GRADE with statistical validation)
   */
  private scoreEarningsHistory(earnings: any): {
    score: number;
    breakdown: any[];
  } {
    if (!earnings || !earnings.earningsHistory) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Earnings History',
            value: 'N/A',
            interpretation: 'No historical earnings data'
          }
        ]
      };
    }

    const history = earnings.earningsHistory.history || [];

    if (history.length === 0) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Earnings History',
            value: 'No Data',
            interpretation: 'No historical earnings available'
          }
        ]
      };
    }

    // Analyze last 4 quarters
    const recentQuarters = history.slice(0, 4);

    let beats = 0;
    let meets = 0;
    let misses = 0;
    const surprises: number[] = []; // Actual - Estimate as % of estimate

    recentQuarters.forEach((q: any) => {
      const actual = q.epsActual;
      const estimate = q.epsEstimate;

      if (actual === undefined || estimate === undefined) return;

      const diff = actual - estimate;
      const percentDiff = (diff / Math.abs(estimate)) * 100;
      surprises.push(percentDiff);

      if (percentDiff > 5) {
        beats++;
      } else if (percentDiff < -5) {
        misses++;
      } else {
        meets++;
      }
    });

    // ===== STATISTICAL ANALYSIS OF EARNINGS SURPRISES =====

    // Calculate surprise statistics
    const surpriseMean = surprises.length > 0 ?
      surprises.reduce((a, b) => a + b, 0) / surprises.length : 0;

    const surpriseStdDev = surprises.length > 0 ?
      Math.sqrt(surprises.reduce((sum, val) => sum + Math.pow(val - surpriseMean, 2), 0) / surprises.length) : 0;

    // Current quarter surprise (most recent)
    const latestSurprise = surprises.length > 0 ? surprises[0] : 0;
    const surpriseZScore = surpriseStdDev !== 0 ? (latestSurprise - surpriseMean) / surpriseStdDev : 0;
    const surprisePValue = this.calculatePValue(surpriseZScore);

    // Consistency score (lower std dev = more consistent)
    const consistencyScore = Math.max(0, 100 - (surpriseStdDev * 2));

    // Beat rate
    const beatRate = surprises.length > 0 ? beats / surprises.length : 0;

    let score = 50;
    let trend = 'Mixed';

    if (beats >= 3) {
      score = 80;
      trend = 'Consistent Beat';
    } else if (beats === 2 && misses === 0) {
      score = 70;
      trend = 'Mostly Beats';
    } else if (beats >= 1 && misses === 0) {
      score = 60;
      trend = 'Beat or Meet';
    } else if (misses >= 3) {
      score = 25;
      trend = 'Consistent Miss';
    } else if (misses >= 2) {
      score = 35;
      trend = 'Mostly Misses';
    }

    return {
      score,
      breakdown: [
        {
          category: 'Earnings Track Record (4Q)',
          value: `${beats} beats, ${meets} meets, ${misses} misses`,
          interpretation: `${trend} - ${(beatRate * 100).toFixed(0)}% beat rate`,
          statisticalSignificance: {
            pValue: Math.round(surprisePValue * 1000) / 1000,
            zScore: Math.round(surpriseZScore * 100) / 100,
            confidence: this.getConfidenceLevel(surprisePValue)
          },
          historicalContext: {
            percentile: beatRate >= 0.75 ? 90 : beatRate >= 0.5 ? 70 : beatRate >= 0.25 ? 50 : 30,
            mean: Math.round(surpriseMean * 10) / 10,
            stdDev: Math.round(surpriseStdDev * 10) / 10,
            sampleSize: surprises.length
          },
          methodology: {
            formula: 'Surprise = ((Actual EPS - Estimated EPS) / |Estimated EPS|) × 100',
            period: 4,
            assumptions: [
              'Analyst estimates represent market expectations',
              'Earnings surprises (beats/misses) impact stock price',
              'Consistent beats indicate strong operational execution',
              'Beat threshold: >5% above estimate; Miss threshold: >5% below',
              'Assumes EPS estimates are unbiased and independent'
            ],
            citations: [
              'Ball, R., & Brown, P. (1968). An Empirical Evaluation of Accounting Income Numbers. Journal of Accounting Research, 6(2), 159-178',
              'Bernard, V. L., & Thomas, J. K. (1989). Post-Earnings-Announcement Drift: Delayed Price Response or Risk Premium? Journal of Accounting Research, 27, 1-36',
              'Rendleman, R. J., et al. (1982). Empirical Anomalies Based on Unexpected Earnings and the Importance of Risk Adjustments. Journal of Financial Economics, 10(3), 269-287'
            ]
          }
        },
        {
          category: 'Earnings Consistency',
          value: score >= 70 ? 'High' : score >= 50 ? 'Moderate' : 'Low',
          interpretation: score >= 70 ?
            `Company consistently delivers (σ=${surpriseStdDev.toFixed(1)}% surprise volatility)` :
            score >= 50 ?
            `Company performance varies (σ=${surpriseStdDev.toFixed(1)}% surprise volatility)` :
            `Company often disappoints (σ=${surpriseStdDev.toFixed(1)}% surprise volatility)`,
          historicalContext: {
            percentile: Math.round(consistencyScore),
            mean: surpriseMean,
            stdDev: surpriseStdDev,
            sampleSize: surprises.length
          },
          methodology: {
            formula: 'Consistency Score = max(0, 100 - (StdDev of Surprises × 2))',
            period: 4,
            assumptions: [
              'Lower surprise volatility indicates better predictability',
              'Consistent execution reduces uncertainty and risk premium',
              'High consistency (low volatility) is valued by investors'
            ],
            citations: [
              'Graham, J. R., et al. (2005). The Economic Implications of Corporate Financial Reporting. Journal of Accounting and Economics, 40(1-3), 3-73'
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
}

export const catalystsScorer = new CatalystsScorer();
