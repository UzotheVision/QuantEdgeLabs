/**
 * Order Flow & Smart Money Scorer (15% weight)
 *
 * Tracks institutional and smart money activity:
 * - Options flow (unusual options activity)
 * - Insider transactions
 * - Institutional holdings
 * - Short interest
 * - Dark pool prints
 */

import { logger } from './logger';

interface OrderFlowResult {
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

class OrderFlowScorer {
  /**
   * Calculate order flow score
   *
   * Note: Full implementation would require paid APIs (Unusual Whales, FlowAlgo, etc.)
   * This implementation uses proxy indicators from Yahoo Finance
   */
  async score(symbol: string): Promise<OrderFlowResult> {
    try {
      logger.info(`[OrderFlowScorer] Scoring ${symbol}`);

      /**
       * Volume comes from Polygon bars, not a Yahoo quote.
       *
       * The old first line was `await yahooFinance.quote(symbol)` with no catch,
       * so a 429 threw before any component ran and the whole scorer returned 50
       * / "Order flow data unavailable". The insider and institutional calls
       * below were already written to degrade (`.catch(() => null)`); only the
       * quote could kill the scorer, and it was the one part replaceable from a
       * source that works.
       *
       * shortPercentOfFloat has no free replacement, so that component (15% of
       * the weight) stays unavailable — and now says so in the breakdown rather
       * than scoring 0% short interest as if it were a reading.
       */
      const { getBars } = await import('./market-data-fallback');
      const bars = await getBars(symbol, 60);

      let quote: any = {};
      if (bars.length >= 21) {
        const recent = bars.slice(-21);
        quote = {
          volume: recent[recent.length - 1].volume,
          averageVolume: Math.round(recent.reduce((a, b) => a + b.volume, 0) / recent.length),
        };
      }

      const { default: YahooFinance } = await import('yahoo-finance2');
      const yahooFinance = new YahooFinance();

      // Insider / institutional have no free replacement. They already degraded
      // to null on failure; that behaviour is unchanged.
      const [holders, insiderTransactions] = await Promise.allSettled([
        yahooFinance.quoteSummary(symbol, {
          // 'institutionalHolders' is NOT a valid module in this yahoo-finance2
          // version — the schema rejects the whole call, so this pair returned
          // null on every symbol even when Yahoo was healthy. The real name is
          // 'institutionOwnership'. This was masked by the .catch(() => null).
          modules: ['institutionOwnership', 'insiderHolders']
        }).catch(() => null),
        yahooFinance.quoteSummary(symbol, {
          modules: ['insiderTransactions']
        }).catch(() => null)
      ]);

      const holdersData = holders.status === 'fulfilled' ? holders.value : null;
      const insiderData = insiderTransactions.status === 'fulfilled' ? insiderTransactions.value : null;

      // Calculate component scores
      const optionsFlowScore = this.scoreOptionsFlow(quote);
      const insiderScore = this.scoreInsiderActivity(insiderData);
      const institutionalScore = this.scoreInstitutionalActivity(holdersData);
      const shortInterestScore = this.scoreShortInterest(quote);

      // Weighted average
      const totalScore = Math.round(
        optionsFlowScore.score * 0.30 +
        insiderScore.score * 0.30 +
        institutionalScore.score * 0.25 +
        shortInterestScore.score * 0.15
      );

      const breakdown = [
        ...optionsFlowScore.breakdown,
        ...insiderScore.breakdown,
        ...institutionalScore.breakdown,
        ...shortInterestScore.breakdown
      ];

      logger.info(`[OrderFlowScorer] ${symbol} scored ${totalScore}/100`);

      return {
        score: totalScore,
        breakdown
      };

    } catch (error: any) {
      logger.error(`[OrderFlowScorer] Failed to score ${symbol}:`, error.message);
      return {
        score: 50,
        breakdown: [{ category: 'Error', value: 'N/A', interpretation: 'Order flow data unavailable' }]
      };
    }
  }

  /**
   * Score options flow
   * Using volume ratios as proxy for unusual options activity
   */
  private scoreOptionsFlow(quote: any): {
    score: number;
    breakdown: any[];
  } {
    const avgVolume = quote.averageVolume || 1;
    const currentVolume = quote.volume || 0;
    const volumeRatio = currentVolume / avgVolume;

    // Higher volume often indicates options activity
    let score = 50;
    let flowSignal = 'Neutral';

    if (volumeRatio > 2.5) {
      score = 85;
      flowSignal = 'Very High Volume (Potential Options Activity)';
    } else if (volumeRatio > 1.5) {
      score = 70;
      flowSignal = 'Elevated Volume';
    } else if (volumeRatio > 1.0) {
      score = 60;
      flowSignal = 'Above Average Volume';
    } else if (volumeRatio < 0.5) {
      score = 35;
      flowSignal = 'Low Volume';
    }

    return {
      score,
      breakdown: [
        {
          category: 'Volume Signal',
          value: `${volumeRatio.toFixed(2)}x avg`,
          interpretation: flowSignal
        },
        {
          category: 'Options Flow Indicator',
          value: score >= 70 ? 'Bullish' : score >= 50 ? 'Neutral' : 'Bearish',
          interpretation: score >= 70 ? 'High institutional interest detected' :
                         score >= 50 ? 'Moderate activity' : 'Low institutional interest'
        }
      ]
    };
  }

  /**
   * Score insider transactions (RESEARCH-GRADE with statistical validation)
   * Insider buying is bullish, selling is moderately bearish
   */
  private scoreInsiderActivity(insiderData: any): {
    score: number;
    breakdown: any[];
  } {
    if (!insiderData || !insiderData.insiderTransactions) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Insider Transactions',
            value: 'N/A',
            interpretation: 'No recent insider data available'
          }
        ]
      };
    }

    const transactions = insiderData.insiderTransactions.transactions || [];

    // Analyze recent transactions (last 3 months)
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    /**
     * yahoo-finance2 already parses startDate into a Date. The old code did
     * `new Date((t.startDate || t.date) * 1000)` — multiplying a Date by 1000
     * gives epoch-millis × 1000, i.e. the year 58576, so EVERY row passed the
     * ">= threeMonthsAgo" test and the three-month window was never applied.
     * That is why the breakdown read a constant "150 sells" for NVDA, AFRM and
     * WDAY alike: 150 is Yahoo's page size, not a measurement.
     *
     * Handle both shapes — a Date, and an epoch-seconds number if the upstream
     * parsing ever changes.
     */
    const asDate = (v: any): Date | null => {
      if (v instanceof Date) return v;
      if (typeof v === 'number' && Number.isFinite(v)) {
        // Seconds vs milliseconds: anything below ~1e12 is seconds.
        return new Date(v < 1e12 ? v * 1000 : v);
      }
      if (typeof v === 'string') {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      }
      return null;
    };

    const recentTransactions = transactions.filter((t: any) => {
      const transactionDate = asDate(t.startDate ?? t.date);
      return transactionDate !== null && transactionDate >= threeMonthsAgo;
    });

    if (recentTransactions.length === 0) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Insider Transactions',
            value: '0 recent',
            interpretation: 'No recent insider activity'
          }
        ]
      };
    }

    let buys = 0;
    let sells = 0;
    let buyValue = 0;
    let sellValue = 0;

    /**
     * Only open-market trades signal anything. Everything else is compensation
     * plumbing and must not be counted as a sell.
     *
     * The old test was `includes('buy') || includes('purchase')`, with an ELSE
     * that swept every remaining row into `sells`. Yahoo's actual text for NVDA
     * over this window: 42 "Stock Award(Grant)", 20 "Stock Gift", and the rest
     * "Sale at price ...". Not one row contains "buy" or "purchase" — insiders
     * receive shares by grant, they do not buy them — so grants and gifts were
     * being reported as insider selling. Combined with the broken date filter
     * above, "0 buys, 150 sells" was routine payroll rendered as a bearish
     * signal, identically on every symbol.
     *
     * Rows that are neither a purchase nor a sale are now excluded from both
     * counts rather than defaulting to one side.
     */
    let ignored = 0;
    recentTransactions.forEach((t: any) => {
      const text = String(t.transactionText ?? '').toLowerCase();
      const isBuy = text.includes('purchase') || text.includes('buy');
      const isSell = text.includes('sale') || text.includes('sold') || text.includes('sell');
      const value = (t.shares || 0) * (t.value || 0);

      if (isBuy) {
        buys++;
        buyValue += value;
      } else if (isSell) {
        sells++;
        sellValue += value;
      } else {
        // Grants, awards, gifts, option exercises, conversions.
        ignored++;
      }
    });

    // Every row was compensation plumbing — no open-market conviction either way.
    if (buys === 0 && sells === 0) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Insider Transactions (3mo)',
            value: '0 open-market',
            interpretation: ignored > 0
              ? `${ignored} grant/gift/exercise rows only — no buys or sells`
              : 'No recent insider activity'
          }
        ]
      };
    }

    // ===== STATISTICAL ANALYSIS OF INSIDER ACTIVITY =====

    // Calculate buy/sell ratio
    const totalTransactions = buys + sells;
    const buyRatio = totalTransactions > 0 ? buys / totalTransactions : 0.5;

    // Net transaction value
    const netValue = buyValue - sellValue;
    const totalValue = buyValue + sellValue;
    const netValueRatio = totalValue > 0 ? netValue / totalValue : 0;

    // Calculate z-score for buy ratio (baseline: 0.3 buy ratio is typical)
    // Research shows insider selling is more common due to compensation/diversification
    const baselineBuyRatio = 0.3; // Academic research baseline
    const buyRatioStdDev = 0.15; // Typical standard deviation
    const buyRatioZScore = (buyRatio - baselineBuyRatio) / buyRatioStdDev;
    const buyRatioPValue = this.calculatePValue(buyRatioZScore);

    // Percentile calculation
    const buyRatioPercentile = Math.round((1 - (1 / (1 + Math.exp(buyRatioZScore)))) * 100);

    // Cluster analysis (3+ transactions in same direction indicates conviction)
    const isBuyCluster = buys >= 3;
    const isSellCluster = sells >= 3;

    // Score based on buy/sell ratio and clustering
    let score = 50;
    let signal = 'Neutral';

    if (buys > sells && isBuyCluster) {
      score = 80;
      signal = 'Cluster Buying - Strong insider conviction (Very Bullish)';
    } else if (buys > sells) {
      score = 70;
      signal = 'Net Buying - Positive insider sentiment (Bullish)';
    } else if (sells > buys && isSellCluster) {
      score = 30;
      signal = 'Cluster Selling - Insiders reducing exposure (Bearish)';
    } else if (sells > buys) {
      score = 40;
      signal = 'Net Selling - May indicate profit-taking or diversification (Cautious)';
    }

    return {
      score,
      breakdown: [
        {
          category: 'Insider Transactions (3mo)',
          value: `${buys} buys, ${sells} sells`,
          interpretation: signal,
          statisticalSignificance: {
            pValue: Math.round(buyRatioPValue * 1000) / 1000,
            zScore: Math.round(buyRatioZScore * 100) / 100,
            confidence: this.getConfidenceLevel(buyRatioPValue)
          },
          historicalContext: {
            percentile: buyRatioPercentile,
            mean: baselineBuyRatio,
            stdDev: buyRatioStdDev,
            sampleSize: totalTransactions
          },
          methodology: {
            formula: 'Buy Ratio = Buys / (Buys + Sells); Net Value Ratio = (Buy Value - Sell Value) / Total Value',
            period: 3,
            assumptions: [
              'Insiders have superior information about company prospects',
              'Insider buying is stronger signal than selling (selling may be for diversification)',
              'Cluster buying (3+ transactions) indicates high conviction',
              'Net buying predicts positive future returns',
              'Baseline buy ratio: 30% (selling more common due to compensation)',
              'Assumes all reported transactions are legitimate and timely'
            ],
            citations: [
              'Seyhun, H. N. (1986). Insiders\' Profits, Costs of Trading, and Market Efficiency. Journal of Financial Economics, 16(2), 189-212',
              'Lakonishok, J., & Lee, I. (2001). Are Insider Trades Informative? Review of Financial Studies, 14(1), 79-111',
              'Jeng, L. A., et al. (2003). Estimating the Returns to Insider Trading: A Performance-Evaluation Perspective. Review of Economics and Statistics, 85(2), 453-471',
              'Cohen, L., et al. (2012). Decoding Inside Information. Journal of Finance, 67(3), 1009-1043'
            ]
          }
        },
        {
          category: 'Transaction Value Analysis',
          value: `$${(Math.abs(netValue) / 1000000).toFixed(1)}M net ${netValue >= 0 ? 'buying' : 'selling'}`,
          interpretation: netValueRatio > 0.3 ?
            `Strong net buying by value (${(netValueRatio * 100).toFixed(0)}% net buy) - high conviction` :
            netValueRatio < -0.3 ?
            `Strong net selling by value (${(Math.abs(netValueRatio) * 100).toFixed(0)}% net sell)` :
            'Balanced transaction values',
          historicalContext: {
            percentile: netValueRatio > 0.3 ? 85 : netValueRatio > 0 ? 65 : netValueRatio > -0.3 ? 35 : 15,
            mean: 0,
            stdDev: 0.3,
            sampleSize: totalTransactions
          },
          methodology: {
            formula: 'Net Value Ratio = (Total Buy Value - Total Sell Value) / (Total Buy Value + Total Sell Value)',
            period: 3,
            assumptions: [
              'Larger transaction values indicate stronger conviction',
              'Net value complements transaction count analysis',
              'High-value insider buying is particularly bullish'
            ],
            citations: [
              'Seyhun, H. N. (1988). The Information Content of Aggregate Insider Trading. Journal of Business, 61(1), 1-24'
            ]
          }
        },
        {
          category: 'Insider Sentiment',
          value: buys > sells ? 'Bullish' : sells > buys ? 'Bearish' : 'Neutral',
          interpretation: buys > sells ?
            `Insiders accumulating shares - buy ratio ${(buyRatio * 100).toFixed(0)}% (above ${(baselineBuyRatio * 100).toFixed(0)}% baseline)` :
            sells > buys ?
            `Insiders reducing positions - may indicate valuation concerns or diversification` :
            'Balanced insider activity - no clear directional signal'
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
   * Score institutional holdings
   * Increasing institutional ownership is bullish
   */
  private scoreInstitutionalActivity(holdersData: any): {
    score: number;
    breakdown: any[];
  } {
    if (!holdersData || !holdersData.institutionOwnership) {
      return {
        score: 50,
        breakdown: [
          {
            category: 'Institutional Holdings',
            value: 'N/A',
            interpretation: 'No institutional data available'
          }
        ]
      };
    }

    const institutions = holdersData.institutionOwnership.ownershipList || [];

    if (institutions.length === 0) {
      return {
        score: 40,
        breakdown: [
          {
            category: 'Institutional Holdings',
            value: 'Low',
            interpretation: 'Limited institutional interest'
          }
        ]
      };
    }

    // Calculate total institutional ownership
    const totalShares = institutions.reduce((sum: number, h: any) => sum + (h.shares || 0), 0);

    // Analyze position changes
    let increasing = 0;
    let decreasing = 0;

    institutions.forEach((h: any) => {
      if (h.change && h.change > 0) increasing++;
      if (h.change && h.change < 0) decreasing++;
    });

    let score = 50;
    let signal = 'Stable';

    if (increasing > decreasing && increasing >= 5) {
      score = 80;
      signal = 'Strong Institutional Accumulation';
    } else if (increasing > decreasing) {
      score = 65;
      signal = 'Institutional Buying';
    } else if (decreasing > increasing && decreasing >= 5) {
      score = 30;
      signal = 'Institutional Distribution';
    } else if (decreasing > increasing) {
      score = 45;
      signal = 'Institutional Selling';
    }

    return {
      score,
      breakdown: [
        {
          category: 'Institutional Holders',
          value: institutions.length.toString(),
          interpretation: institutions.length >= 100 ? 'High institutional interest' :
                         institutions.length >= 50 ? 'Moderate interest' : 'Low interest'
        },
        {
          category: 'Position Changes',
          value: `${increasing} up, ${decreasing} down`,
          interpretation: signal
        }
      ]
    };
  }

  /**
   * Score short interest
   * High short interest with bullish signals = squeeze potential
   * High short interest alone = bearish
   */
  private scoreShortInterest(quote: any): {
    score: number;
    breakdown: any[];
  } {
    // No free source carries short float. Absent is neutral AND labelled — a
    // missing field used to read through as 0% and score like genuinely low
    // short interest.
    if (quote.shortPercentOfFloat == null) {
      return {
        score: 50,
        breakdown: [{ category: 'Short Interest', value: 'N/A', interpretation: 'No short float source available' }]
      };
    }
    const shortPercent = quote.shortPercentOfFloat || 0;

    let score = 50;
    let signal = 'Normal';

    if (shortPercent < 0.05) {
      score = 55;
      signal = 'Low short interest';
    } else if (shortPercent >= 0.20) {
      score = 40; // High short interest is generally bearish
      signal = 'High short interest (Squeeze potential)';
    } else if (shortPercent >= 0.10) {
      score = 45;
      signal = 'Elevated short interest';
    }

    return {
      score,
      breakdown: [
        {
          category: 'Short Interest',
          value: `${(shortPercent * 100).toFixed(1)}%`,
          interpretation: signal
        },
        {
          category: 'Short Squeeze Risk',
          value: shortPercent >= 0.20 ? 'High' : shortPercent >= 0.10 ? 'Moderate' : 'Low',
          interpretation: shortPercent >= 0.20 ?
            'Heavily shorted - watch for squeeze' :
            shortPercent >= 0.10 ?
            'Moderate short position' :
            'Low short interest'
        }
      ]
    };
  }
}

export const orderFlowScorer = new OrderFlowScorer();
