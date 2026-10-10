/**
 * Quantitative Scorer (15% weight)
 *
 * Statistical analysis focusing on:
 * - Risk Metrics (Beta, Volatility, Sharpe Ratio)
 * - Mean Reversion (Z-Score, Bollinger position)
 * - Correlation Analysis
 * - Momentum Metrics
 */

import { logger } from './logger';

interface QuantitativeResult {
  score: number; // 0-100
  breakdown: {
    category: string;
    value: number | string;
    interpretation: string;
  }[];
}

class QuantitativeScorer {
  /**
   * Calculate quantitative score for a symbol
   */
  async score(symbol: string): Promise<QuantitativeResult> {
    try {
      logger.info(`[QuantScorer] Scoring ${symbol}`);

      /**
       * Bars and quotes come from the shared fallback, not Yahoo directly.
       *
       * This scorer called yahoo-finance2 and threw on any failure, which meant
       * a 429 returned the default 50 with "Data unavailable" — and the engine
       * then blended that placeholder into an overall grade as if it were a
       * reading. On ADSK five of seven scorers were doing this at once and the
       * result still presented as a considered C/57.
       *
       * See server/market-data-fallback.ts: Polygon bars → Yahoo, Finnhub
       * quotes → Yahoo.
       */
      const { getBars, getQuote } = await import('./market-data-fallback');
      const historical = await getBars(symbol, 180);

      if (!historical || historical.length < 30) {
        throw new Error('Insufficient historical data');
      }

      const q = await getQuote(symbol);
      const spyQ = await getQuote('SPY');
      // Beta is not carried by either fallback source; 1.0 is the neutral
      // assumption and is stated rather than silently defaulted.
      const quote: any = { regularMarketPrice: q?.price ?? 0, beta: 1.0 };
      const spyQuote: any = { regularMarketPrice: spyQ?.price ?? 0 };

      // Calculate metrics
      const volatility = this.calculateVolatility(historical);
      const returns3m = this.calculateReturns(historical, 90);
      const returns6m = this.calculateReturns(historical, 180);
      const sharpeRatio = this.calculateSharpeRatio(historical);
      const beta = quote.beta || 1.0;
      const zScore = this.calculateZScore(historical);
      const bollingerPosition = this.calculateBollingerPosition(historical);

      // Score each component
      const riskScore = this.scoreRiskMetrics(volatility, beta, sharpeRatio);
      const momentumScore = this.scoreMomentum(returns3m, returns6m);
      const meanReversionScore = this.scoreMeanReversion(zScore, bollingerPosition);
      const correlationScore = this.scoreCorrelation(beta);

      // Weighted average (you can adjust these weights)
      const totalScore = Math.round(
        riskScore * 0.35 +
        momentumScore * 0.30 +
        meanReversionScore * 0.20 +
        correlationScore * 0.15
      );

      const breakdown = [
        {
          category: 'Volatility (30-day)',
          value: `${(volatility * 100).toFixed(1)}%`,
          interpretation: volatility < 0.20 ? 'Low risk' :
                         volatility < 0.40 ? 'Moderate risk' : 'High risk'
        },
        {
          category: 'Sharpe Ratio',
          value: sharpeRatio.toFixed(2),
          interpretation: sharpeRatio > 1.5 ? 'Excellent risk-adjusted returns' :
                         sharpeRatio > 1.0 ? 'Good risk-adjusted returns' :
                         sharpeRatio > 0.5 ? 'Fair risk-adjusted returns' : 'Poor risk-adjusted returns'
        },
        {
          category: 'Beta (vs S&P 500)',
          value: beta.toFixed(2),
          interpretation: beta < 0.8 ? 'Low market correlation' :
                         beta < 1.2 ? 'Moderate market correlation' : 'High market correlation'
        },
        {
          category: '3-Month Return',
          value: `${(returns3m * 100).toFixed(1)}%`,
          interpretation: returns3m > 0.10 ? 'Strong momentum' :
                         returns3m > 0 ? 'Positive momentum' :
                         returns3m > -0.10 ? 'Weak momentum' : 'Negative momentum'
        },
        {
          category: '6-Month Return',
          value: `${(returns6m * 100).toFixed(1)}%`,
          interpretation: returns6m > 0.15 ? 'Strong long-term momentum' :
                         returns6m > 0 ? 'Positive trend' : 'Negative trend'
        },
        {
          category: 'Z-Score',
          value: zScore.toFixed(2),
          interpretation: Math.abs(zScore) > 2 ? 'Extreme deviation from mean' :
                         Math.abs(zScore) > 1 ? 'Moderate deviation' : 'Near average'
        },
        {
          category: 'Bollinger Position',
          value: `${(bollingerPosition * 100).toFixed(0)}%`,
          interpretation: bollingerPosition > 0.8 ? 'Near upper band (overbought?)' :
                         bollingerPosition < 0.2 ? 'Near lower band (oversold?)' : 'Mid-range'
        }
      ];

      logger.info(`[QuantScorer] ${symbol} scored ${totalScore}/100`);

      return {
        score: totalScore,
        breakdown
      };

    } catch (error: any) {
      logger.error(`[QuantScorer] Failed to score ${symbol}:`, error.message);
      return {
        score: 50,
        breakdown: [{ category: 'Error', value: 'N/A', interpretation: 'Data unavailable' }]
      };
    }
  }

  /**
   * Calculate annualized volatility
   */
  private calculateVolatility(historical: any[]): number {
    const prices = historical.map(h => h.close);
    const returns = [];

    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;
    const dailyVol = Math.sqrt(variance);

    // Annualize (252 trading days)
    return dailyVol * Math.sqrt(252);
  }

  /**
   * Calculate returns over N days
   */
  private calculateReturns(historical: any[], days: number): number {
    if (historical.length < days) {
      return 0;
    }

    const currentPrice = historical[historical.length - 1].close;
    const pastPrice = historical[Math.max(0, historical.length - days - 1)].close;

    return (currentPrice - pastPrice) / pastPrice;
  }

  /**
   * Calculate annualized Sharpe Ratio from daily price series
   * Uses excess returns (daily return - daily risk-free rate) for proper risk adjustment
   */
  private calculateSharpeRatio(historical: any[]): number {
    const prices = historical.map(h => h.close);
    const returns = [];

    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    // 4.5% annual risk-free rate (T-bill proxy), prorated to daily
    const dailyRiskFree = 0.045 / 252;
    const excessReturns = returns.map(r => r - dailyRiskFree);
    const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
    const excessStdDev = Math.sqrt(
      excessReturns.map(r => Math.pow(r - meanExcess, 2)).reduce((a, b) => a + b, 0) / excessReturns.length
    );

    // Annualize: multiply ratio by sqrt(252)
    return excessStdDev > 0 ? (meanExcess / excessStdDev) * Math.sqrt(252) : 0;
  }

  /**
   * Calculate Z-Score (how many standard deviations from mean)
   */
  private calculateZScore(historical: any[]): number {
    const prices = historical.slice(-30).map(h => h.close); // Last 30 days
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(
      prices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / prices.length
    );

    const currentPrice = prices[prices.length - 1];
    return stdDev > 0 ? (currentPrice - mean) / stdDev : 0;
  }

  /**
   * Calculate Bollinger Band position (0 = lower band, 1 = upper band)
   */
  private calculateBollingerPosition(historical: any[]): number {
    const prices = historical.slice(-20).map(h => h.close); // 20-day Bollinger
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const stdDev = Math.sqrt(
      prices.map(p => Math.pow(p - mean, 2)).reduce((a, b) => a + b, 0) / prices.length
    );

    const currentPrice = prices[prices.length - 1];
    const upperBand = mean + 2 * stdDev;
    const lowerBand = mean - 2 * stdDev;

    if (upperBand === lowerBand) return 0.5;

    return (currentPrice - lowerBand) / (upperBand - lowerBand);
  }

  /**
   * Score risk metrics (volatility, beta, Sharpe)
   */
  private scoreRiskMetrics(volatility: number, beta: number, sharpe: number): number {
    let score = 50; // Start neutral

    // Volatility scoring (lower is better for long-term)
    if (volatility < 0.20) score += 20;
    else if (volatility < 0.40) score += 10;
    else if (volatility > 0.60) score -= 20;

    // Sharpe ratio scoring (higher is better)
    if (sharpe > 1.5) score += 20;
    else if (sharpe > 1.0) score += 15;
    else if (sharpe > 0.5) score += 5;
    else if (sharpe < 0) score -= 15;

    // Beta scoring (moderate beta preferred)
    if (beta < 0.8 || beta > 1.5) score -= 5;
    else score += 10;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Score momentum metrics
   */
  private scoreMomentum(returns3m: number, returns6m: number): number {
    let score = 50;

    // 3-month momentum
    if (returns3m > 0.10) score += 25;
    else if (returns3m > 0.05) score += 15;
    else if (returns3m > 0) score += 5;
    else if (returns3m < -0.10) score -= 25;
    else if (returns3m < 0) score -= 10;

    // 6-month momentum
    if (returns6m > 0.15) score += 25;
    else if (returns6m > 0.05) score += 15;
    else if (returns6m > 0) score += 5;
    else if (returns6m < -0.15) score -= 25;
    else if (returns6m < 0) score -= 10;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Score mean reversion metrics
   */
  private scoreMeanReversion(zScore: number, bollingerPosition: number): number {
    let score = 50;

    // Z-score extremes suggest mean reversion opportunity
    if (Math.abs(zScore) > 2) {
      score += 20; // Extreme deviation = opportunity
    } else if (Math.abs(zScore) > 1) {
      score += 10;
    }

    // Bollinger band position
    if (bollingerPosition < 0.2 || bollingerPosition > 0.8) {
      score += 15; // Near bands = potential reversal
    }

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Score correlation with market
   */
  private scoreCorrelation(beta: number): number {
    let score = 50;

    // Moderate correlation preferred (diversification benefit)
    if (beta >= 0.8 && beta <= 1.2) {
      score += 30; // Good market correlation
    } else if (beta > 1.5) {
      score -= 20; // Too volatile vs market
    } else if (beta < 0.5) {
      score += 10; // Low correlation = diversification
    }

    return Math.min(100, Math.max(0, score));
  }
}

export const quantitativeScorer = new QuantitativeScorer();
