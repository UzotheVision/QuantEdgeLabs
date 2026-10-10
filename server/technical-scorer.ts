/**
 * Technical Analysis Scorer (25% weight)
 *
 * Analyzes technical indicators and chart patterns:
 * - Trend: Moving averages (SMA, EMA)
 * - Momentum: RSI, MACD, Stochastic
 * - Volatility: Bollinger Bands, ATR
 * - Volume: OBV, Volume trends
 */

import { logger } from './logger';
import { calculateRSI, calculateMACD } from './technical-indicators';

interface TechnicalResult {
  score: number; // 0-100
  breakdown: {
    category: string;
    value: number | string;
    interpretation: string;
    // RESEARCH-GRADE ADDITIONS
    statisticalSignificance?: {
      pValue: number;
      zScore: number;
      confidence: string; // 'HIGH' | 'MEDIUM' | 'LOW'
    };
    historicalContext?: {
      percentile: number; // vs 1-year distribution
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

class TechnicalScorer {
  /**
   * Calculate technical score for a symbol
   */
  async score(symbol: string): Promise<TechnicalResult> {
    try {
      logger.info(`[TechnicalScorer] Scoring ${symbol}`);

      /**
       * Bars via the shared fallback (Polygon grouped-daily → Yahoo).
       *
       * Technical carries the largest weight in CATEGORY_WEIGHTS, and it was
       * calling Yahoo directly with a throw on failure — so on a 429 the
       * heaviest input to the grade became the default 50 labelled "Error".
       * Observed intermittently on WDAY while the other scorers succeeded,
       * which is the worst version of the bug: the score moves for a reason
       * that has nothing to do with the stock.
       *
       * 260 sessions, because SMA200 needs 200 plus room for the historical
       * RSI distribution computed below.
       */
      const { getBars } = await import('./market-data-fallback');
      const historical = await getBars(symbol, 260);

      if (!historical || historical.length < 50) {
        throw new Error('Insufficient historical data for technical analysis');
      }

      const prices = historical.map(h => h.close);
      const volumes = historical.map(h => h.volume);
      const dates = historical.map(h => h.date);

      // Calculate current indicators
      const rsi = calculateRSI(prices, 14);
      const macd = calculateMACD(prices, 12, 26, 9);
      const sma20 = this.calculateSMA(prices, 20);
      const sma50 = this.calculateSMA(prices, 50);
      const sma200 = this.calculateSMA(prices, 200);
      const currentPrice = prices[prices.length - 1];

      // Calculate historical RSI values for statistical analysis
      const historicalRSI = this.calculateHistoricalRSI(prices, 14);

      // Calculate historical MACD values
      const historicalMACD = this.calculateHistoricalMACD(prices, 12, 26, 9);

      // Volume analysis
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const volumeTrend = recentVolume / avgVolume;

      // Historical volume ratios
      const historicalVolumeRatios = this.calculateHistoricalVolumeRatios(volumes);

      // Score components with enhanced statistical context
      const trendScore = this.scoreTrend(currentPrice, sma20, sma50, sma200, prices, dates);
      const momentumScore = this.scoreMomentum(rsi, macd, historicalRSI, historicalMACD, prices, dates);
      const volumeScore = this.scoreVolume(volumeTrend, historicalVolumeRatios, prices, dates);

      // Weighted average
      const totalScore = Math.round(
        trendScore.score * 0.40 +
        momentumScore.score * 0.40 +
        volumeScore.score * 0.20
      );

      const breakdown = [
        ...trendScore.breakdown,
        ...momentumScore.breakdown,
        ...volumeScore.breakdown
      ];

      logger.info(`[TechnicalScorer] ${symbol} scored ${totalScore}/100`);

      return {
        score: totalScore,
        breakdown
      };

    } catch (error: any) {
      logger.error(`[TechnicalScorer] Failed to score ${symbol}:`, error.message);
      return {
        score: 50,
        breakdown: [{ category: 'Error', value: 'N/A', interpretation: 'Technical data unavailable' }]
      };
    }
  }

  /**
   * Calculate historical RSI values for statistical analysis
   */
  private calculateHistoricalRSI(prices: number[], period: number): number[] {
    const rsiValues: number[] = [];

    // Calculate RSI for each point in history (starting from period+1)
    for (let i = period; i < prices.length; i++) {
      const slice = prices.slice(0, i + 1);
      const rsi = calculateRSI(slice, period);
      rsiValues.push(rsi);
    }

    return rsiValues;
  }

  /**
   * Calculate historical MACD values
   */
  private calculateHistoricalMACD(prices: number[], fast: number, slow: number, signal: number): any[] {
    const macdValues: any[] = [];

    for (let i = slow; i < prices.length; i++) {
      const slice = prices.slice(0, i + 1);
      const macd = calculateMACD(slice, fast, slow, signal);
      macdValues.push(macd);
    }

    return macdValues;
  }

  /**
   * Calculate historical volume ratios (5-day avg vs overall avg)
   */
  private calculateHistoricalVolumeRatios(volumes: number[]): number[] {
    const ratios: number[] = [];
    const overallAvg = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    for (let i = 5; i < volumes.length; i++) {
      const recentAvg = volumes.slice(i - 5, i).reduce((a, b) => a + b, 0) / 5;
      ratios.push(recentAvg / overallAvg);
    }

    return ratios;
  }

  /**
   * Score trend based on moving averages (RESEARCH-GRADE with statistical validation)
   */
  private scoreTrend(
    price: number,
    sma20: number,
    sma50: number,
    sma200: number,
    prices: number[],
    dates: Date[]
  ): {
    score: number;
    breakdown: any[];
  } {
    let score = 50;
    const breakdown = [];

    // Calculate historical moving averages for statistical analysis
    const historicalSMA20: number[] = [];
    const historicalSMA50: number[] = [];
    const historicalSMA200: number[] = [];

    for (let i = 200; i < prices.length; i++) {
      const slice = prices.slice(0, i + 1);
      historicalSMA20.push(this.calculateSMA(slice, 20));
      historicalSMA50.push(this.calculateSMA(slice, 50));
      historicalSMA200.push(this.calculateSMA(slice, 200));
    }

    // Calculate price deviation from SMA200
    const priceDeviation = ((price - sma200) / sma200) * 100;
    const historicalDeviations = historicalSMA200.map((sma, i) => {
      const p = prices[i + 200];
      return ((p - sma) / sma) * 100;
    });

    const deviationMean = this.calculateMean(historicalDeviations);
    const deviationStdDev = this.calculateStdDev(historicalDeviations, deviationMean);
    const deviationZScore = this.calculateZScore(priceDeviation, deviationMean, deviationStdDev);
    const deviationPValue = this.calculatePValue(deviationZScore);
    const deviationPercentile = this.calculatePercentile(priceDeviation, historicalDeviations);

    // ===== PRICE VS SMA200 (PRIMARY TREND) =====

    // Backtest being above SMA200
    const aboveSMA200Backtest = this.backtestSignal(
      (value) => value > 0,
      historicalDeviations,
      prices.slice(200),
      5
    );

    // Backtest being below SMA200
    const belowSMA200Backtest = this.backtestSignal(
      (value) => value < 0,
      historicalDeviations,
      prices.slice(200),
      5
    );

    const aboveSMA200 = price > sma200;
    let sma200Interpretation = '';
    let sma200Backtest = aboveSMA200 ? aboveSMA200Backtest : belowSMA200Backtest;

    if (aboveSMA200) {
      score += 20;
      sma200Interpretation = `Bullish long-term trend - price ${Math.abs(priceDeviation).toFixed(1)}% above 200-day MA`;
    } else {
      score -= 15;
      sma200Interpretation = `Bearish long-term trend - price ${Math.abs(priceDeviation).toFixed(1)}% below 200-day MA`;
    }

    breakdown.push({
      category: 'Long-term Trend (SMA200)',
      value: aboveSMA200 ? 'Above' : 'Below',
      interpretation: sma200Interpretation,
      statisticalSignificance: {
        pValue: Math.round(deviationPValue * 1000) / 1000,
        zScore: Math.round(deviationZScore * 100) / 100,
        confidence: this.getConfidenceLevel(deviationPValue)
      },
      historicalContext: {
        percentile: Math.round(deviationPercentile),
        mean: Math.round(deviationMean * 10) / 10,
        stdDev: Math.round(deviationStdDev * 10) / 10,
        sampleSize: historicalDeviations.length
      },
      backtestPerformance: sma200Backtest,
      methodology: {
        formula: 'SMA(n) = (P1 + P2 + ... + Pn) / n',
        period: 200,
        assumptions: [
          '200-day MA represents long-term trend equilibrium',
          'Price above MA indicates bullish regime; below indicates bearish',
          'MA acts as dynamic support (bullish) or resistance (bearish)',
          'Assumes price mean-reverts to long-term average'
        ],
        citations: [
          'Gartley, H. M. (1935). Profits in the Stock Market',
          'Pring, M. J. (2002). Technical Analysis Explained. McGraw-Hill'
        ]
      }
    });

    // ===== GOLDEN/DEATH CROSS (SMA50 vs SMA200) =====

    // Calculate MA spread (SMA50 - SMA200) as % of SMA200
    const maSpread = ((sma50 - sma200) / sma200) * 100;
    const historicalMASpreads = historicalSMA50.map((sma50Val, i) => {
      return ((sma50Val - historicalSMA200[i]) / historicalSMA200[i]) * 100;
    });

    const spreadMean = this.calculateMean(historicalMASpreads);
    const spreadStdDev = this.calculateStdDev(historicalMASpreads, spreadMean);
    const spreadZScore = this.calculateZScore(maSpread, spreadMean, spreadStdDev);
    const spreadPValue = this.calculatePValue(spreadZScore);
    const spreadPercentile = this.calculatePercentile(maSpread, historicalMASpreads);

    // Backtest golden cross
    const goldenCrossBacktest = this.backtestSignal(
      (value) => value > 0,
      historicalMASpreads,
      prices.slice(200),
      10 // 10-day forward return for longer-term signal
    );

    // Backtest death cross
    const deathCrossBacktest = this.backtestSignal(
      (value) => value < 0,
      historicalMASpreads,
      prices.slice(200),
      10
    );

    const isGoldenCross = sma50 > sma200;
    let crossInterpretation = '';
    let crossBacktest = isGoldenCross ? goldenCrossBacktest : deathCrossBacktest;

    if (isGoldenCross) {
      score += 15;
      crossInterpretation = 'Golden Cross - 50-day MA above 200-day MA (bullish crossover)';
    } else {
      score -= 10;
      crossInterpretation = 'Death Cross - 50-day MA below 200-day MA (bearish crossover)';
    }

    breakdown.push({
      category: 'MA Cross (50/200)',
      value: isGoldenCross ? 'Golden Cross' : 'Death Cross',
      interpretation: crossInterpretation,
      statisticalSignificance: {
        pValue: Math.round(spreadPValue * 1000) / 1000,
        zScore: Math.round(spreadZScore * 100) / 100,
        confidence: this.getConfidenceLevel(spreadPValue)
      },
      historicalContext: {
        percentile: Math.round(spreadPercentile),
        mean: Math.round(spreadMean * 10) / 10,
        stdDev: Math.round(spreadStdDev * 10) / 10,
        sampleSize: historicalMASpreads.length
      },
      backtestPerformance: crossBacktest,
      methodology: {
        formula: 'Golden Cross: SMA(50) > SMA(200); Death Cross: SMA(50) < SMA(200)',
        period: 200,
        assumptions: [
          'Crossovers indicate regime shifts in market sentiment',
          'Golden cross precedes sustained bull markets',
          'Death cross precedes sustained bear markets',
          'Signal works best in trending (not ranging) markets'
        ],
        citations: [
          'Colby, R. W., & Meyers, T. A. (1988). The Encyclopedia of Technical Market Indicators',
          'Murphy, J. J. (1999). Technical Analysis of the Financial Markets. NYIF'
        ]
      }
    });

    // ===== SHORT-TERM TREND (SMA20) =====

    const aboveSMA20 = price > sma20;
    const sma20Deviation = ((price - sma20) / sma20) * 100;

    // Calculate historical SMA20 deviations
    const sma20Deviations = historicalSMA20.map((sma, i) => {
      const p = prices[i + 200];
      return ((p - sma) / sma) * 100;
    });

    const sma20Mean = this.calculateMean(sma20Deviations);
    const sma20StdDev = this.calculateStdDev(sma20Deviations, sma20Mean);
    const sma20ZScore = this.calculateZScore(sma20Deviation, sma20Mean, sma20StdDev);
    const sma20PValue = this.calculatePValue(sma20ZScore);
    const sma20Percentile = this.calculatePercentile(sma20Deviation, sma20Deviations);

    // Backtest above/below SMA20
    const aboveSMA20Backtest = this.backtestSignal(
      (value) => value > 0,
      sma20Deviations,
      prices.slice(200),
      3 // 3-day forward return for short-term signal
    );

    const belowSMA20Backtest = this.backtestSignal(
      (value) => value < 0,
      sma20Deviations,
      prices.slice(200),
      3
    );

    let sma20Interpretation = '';
    let sma20Backtest = aboveSMA20 ? aboveSMA20Backtest : belowSMA20Backtest;

    if (aboveSMA20) {
      score += 15;
      sma20Interpretation = `Bullish short-term momentum - price ${Math.abs(sma20Deviation).toFixed(1)}% above 20-day MA`;
    } else {
      sma20Interpretation = `Bearish short-term momentum - price ${Math.abs(sma20Deviation).toFixed(1)}% below 20-day MA`;
    }

    breakdown.push({
      category: 'Short-term Trend (SMA20)',
      value: aboveSMA20 ? 'Above' : 'Below',
      interpretation: sma20Interpretation,
      statisticalSignificance: {
        pValue: Math.round(sma20PValue * 1000) / 1000,
        zScore: Math.round(sma20ZScore * 100) / 100,
        confidence: this.getConfidenceLevel(sma20PValue)
      },
      historicalContext: {
        percentile: Math.round(sma20Percentile),
        mean: Math.round(sma20Mean * 10) / 10,
        stdDev: Math.round(sma20StdDev * 10) / 10,
        sampleSize: sma20Deviations.length
      },
      backtestPerformance: sma20Backtest,
      methodology: {
        formula: 'SMA(20) = sum of last 20 closing prices / 20',
        period: 20,
        assumptions: [
          '20-day MA captures short-term trend (approximately 1 trading month)',
          'Price above MA suggests short-term bullish momentum',
          'Price below MA suggests short-term bearish momentum',
          'Works best as dynamic support/resistance in trending markets'
        ],
        citations: [
          'Appel, G., & Hitschler, F. (1980). Stock Market Trading Systems',
          'Elder, A. (1993). Trading for a Living. Wiley'
        ]
      }
    });

    return {
      score: Math.min(100, Math.max(0, score)),
      breakdown
    };
  }

  /**
   * Score momentum indicators (RESEARCH-GRADE with statistical validation)
   */
  private scoreMomentum(
    rsi: number,
    macd: any,
    historicalRSI: number[],
    historicalMACD: any[],
    prices: number[],
    dates: Date[]
  ): {
    score: number;
    breakdown: any[];
  } {
    let score = 50;
    const breakdown = [];

    // ===== RSI ANALYSIS WITH STATISTICAL VALIDATION =====

    // Calculate RSI statistical metrics
    const rsiMean = this.calculateMean(historicalRSI);
    const rsiStdDev = this.calculateStdDev(historicalRSI, rsiMean);
    const rsiZScore = this.calculateZScore(rsi, rsiMean, rsiStdDev);
    const rsiPValue = this.calculatePValue(rsiZScore);
    const rsiPercentile = this.calculatePercentile(rsi, historicalRSI);

    // Backtest RSI oversold signal (RSI < 30)
    const oversoldBacktest = this.backtestSignal(
      (value) => value < 30,
      historicalRSI,
      prices.slice(14), // Align with RSI calculation offset
      5 // 5-day forward return
    );

    // Backtest RSI overbought signal (RSI > 70)
    const overboughtBacktest = this.backtestSignal(
      (value) => value > 70,
      historicalRSI,
      prices.slice(14),
      5
    );

    // Backtest RSI bullish zone (RSI 50-70)
    const bullishZoneBacktest = this.backtestSignal(
      (value) => value >= 50 && value <= 70,
      historicalRSI,
      prices.slice(14),
      5
    );

    // RSI scoring with enhanced interpretation
    let rsiInterpretation = '';
    let rsiBacktest = bullishZoneBacktest;

    if (rsi < 30) {
      score += 20;
      rsiInterpretation = 'Oversold - potential mean reversion opportunity';
      rsiBacktest = oversoldBacktest;
    } else if (rsi > 70) {
      score -= 15;
      rsiInterpretation = 'Overbought - potential resistance or pullback';
      rsiBacktest = overboughtBacktest;
    } else if (rsi > 50) {
      score += 10;
      rsiInterpretation = 'Bullish momentum zone - positive trend strength';
    } else {
      rsiInterpretation = 'Bearish momentum zone - negative trend strength';
    }

    breakdown.push({
      category: 'RSI (14-period)',
      value: rsi.toFixed(1),
      interpretation: rsiInterpretation,
      statisticalSignificance: {
        pValue: Math.round(rsiPValue * 1000) / 1000,
        zScore: Math.round(rsiZScore * 100) / 100,
        confidence: this.getConfidenceLevel(rsiPValue)
      },
      historicalContext: {
        percentile: Math.round(rsiPercentile),
        mean: Math.round(rsiMean * 10) / 10,
        stdDev: Math.round(rsiStdDev * 10) / 10,
        sampleSize: historicalRSI.length
      },
      backtestPerformance: rsiBacktest,
      methodology: {
        formula: 'RSI = 100 - (100 / (1 + RS)), where RS = avg_gain / avg_loss',
        period: 14,
        assumptions: [
          'Price changes follow mean-reverting distribution',
          'RSI oscillates around equilibrium of 50',
          'Extreme values (< 30 or > 70) indicate temporary imbalance'
        ],
        citations: ['Wilder, J. W. (1978). New Concepts in Technical Trading Systems. Trend Research']
      }
    });

    // ===== MACD ANALYSIS WITH STATISTICAL VALIDATION =====

    const macdValue = macd.macd;
    const signal = macd.signal;
    const histogram = macd.histogram;

    // Extract MACD histograms from history
    const historicalHistograms = historicalMACD.map(m => m.histogram);
    const histogramMean = this.calculateMean(historicalHistograms);
    const histogramStdDev = this.calculateStdDev(historicalHistograms, histogramMean);
    const histogramZScore = this.calculateZScore(histogram, histogramMean, histogramStdDev);
    const histogramPValue = this.calculatePValue(histogramZScore);
    const histogramPercentile = this.calculatePercentile(histogram, historicalHistograms);

    // Backtest MACD bullish crossover
    const macdBullishBacktest = this.backtestSignal(
      (value) => value > 0,
      historicalHistograms,
      prices.slice(26), // Align with MACD calculation offset
      5
    );

    // Backtest MACD bearish crossover
    const macdBearishBacktest = this.backtestSignal(
      (value) => value < 0,
      historicalHistograms,
      prices.slice(26),
      5
    );

    let macdInterpretation = '';
    let macdBacktest = macdBullishBacktest;

    if (histogram > 0 && macdValue > signal) {
      score += 20;
      macdInterpretation = 'Bullish crossover - MACD above signal line (buy signal)';
      macdBacktest = macdBullishBacktest;
    } else if (histogram < 0 && macdValue < signal) {
      score -= 15;
      macdInterpretation = 'Bearish crossover - MACD below signal line (sell signal)';
      macdBacktest = macdBearishBacktest;
    } else {
      macdInterpretation = 'Neutral - MACD near signal line (consolidation)';
    }

    breakdown.push({
      category: 'MACD (12,26,9)',
      value: histogram > 0 ? 'Bullish' : histogram < 0 ? 'Bearish' : 'Neutral',
      interpretation: macdInterpretation,
      statisticalSignificance: {
        pValue: Math.round(histogramPValue * 1000) / 1000,
        zScore: Math.round(histogramZScore * 100) / 100,
        confidence: this.getConfidenceLevel(histogramPValue)
      },
      historicalContext: {
        percentile: Math.round(histogramPercentile),
        mean: Math.round(histogramMean * 1000) / 1000,
        stdDev: Math.round(histogramStdDev * 1000) / 1000,
        sampleSize: historicalHistograms.length
      },
      backtestPerformance: macdBacktest,
      methodology: {
        formula: 'MACD = EMA(12) - EMA(26); Signal = EMA(9) of MACD; Histogram = MACD - Signal',
        period: 26,
        assumptions: [
          'Exponential moving averages capture trend momentum',
          'Crossovers indicate trend changes',
          'Histogram divergence signals weakening trends'
        ],
        citations: ['Appel, G. (2005). Technical Analysis: Power Tools for Active Investors. FT Press']
      }
    });

    return {
      score: Math.min(100, Math.max(0, score)),
      breakdown
    };
  }

  /**
   * Score volume trends (RESEARCH-GRADE with statistical validation)
   */
  private scoreVolume(
    volumeTrend: number,
    historicalVolumeRatios: number[],
    prices: number[],
    dates: Date[]
  ): {
    score: number;
    breakdown: any[];
  } {
    let score = 50;

    // Calculate volume ratio statistics
    const volumeMean = this.calculateMean(historicalVolumeRatios);
    const volumeStdDev = this.calculateStdDev(historicalVolumeRatios, volumeMean);
    const volumeZScore = this.calculateZScore(volumeTrend, volumeMean, volumeStdDev);
    const volumePValue = this.calculatePValue(volumeZScore);
    const volumePercentile = this.calculatePercentile(volumeTrend, historicalVolumeRatios);

    // Backtest high volume signal (volume > 1.5x average)
    const highVolumeBacktest = this.backtestSignal(
      (value) => value > 1.5,
      historicalVolumeRatios,
      prices.slice(5), // Align with 5-day volume calculation offset
      5
    );

    // Backtest low volume signal (volume < 0.7x average)
    const lowVolumeBacktest = this.backtestSignal(
      (value) => value < 0.7,
      historicalVolumeRatios,
      prices.slice(5),
      5
    );

    // Backtest normal volume (0.9x to 1.3x average)
    const normalVolumeBacktest = this.backtestSignal(
      (value) => value >= 0.9 && value <= 1.3,
      historicalVolumeRatios,
      prices.slice(5),
      5
    );

    let volumeInterpretation = '';
    let volumeBacktest = normalVolumeBacktest;

    if (volumeTrend > 1.5) {
      score += 25;
      volumeInterpretation = 'Significantly elevated volume - strong institutional participation and conviction';
      volumeBacktest = highVolumeBacktest;
    } else if (volumeTrend > 1.0) {
      score += 10;
      volumeInterpretation = 'Above-average volume - increased market interest';
      volumeBacktest = normalVolumeBacktest;
    } else if (volumeTrend < 0.7) {
      score -= 15;
      volumeInterpretation = 'Below-average volume - weak participation and conviction';
      volumeBacktest = lowVolumeBacktest;
    } else {
      volumeInterpretation = 'Average volume - normal trading activity';
    }

    return {
      score: Math.min(100, Math.max(0, score)),
      breakdown: [
        {
          category: 'Volume Trend (5-day avg vs baseline)',
          value: `${(volumeTrend * 100).toFixed(0)}%`,
          interpretation: volumeInterpretation,
          statisticalSignificance: {
            pValue: Math.round(volumePValue * 1000) / 1000,
            zScore: Math.round(volumeZScore * 100) / 100,
            confidence: this.getConfidenceLevel(volumePValue)
          },
          historicalContext: {
            percentile: Math.round(volumePercentile),
            mean: Math.round(volumeMean * 100) / 100,
            stdDev: Math.round(volumeStdDev * 100) / 100,
            sampleSize: historicalVolumeRatios.length
          },
          backtestPerformance: volumeBacktest,
          methodology: {
            formula: 'Volume Ratio = (5-day avg volume) / (overall avg volume)',
            period: 5,
            assumptions: [
              'Volume reflects institutional participation and conviction',
              'High volume confirms price moves; low volume suggests weak trends',
              'Volume spikes often precede significant price movements',
              'Assumes volume data is clean and not affected by splits/dividends'
            ],
            citations: [
              'Granville, J. (1963). Granville\'s New Key to Stock Market Profits',
              'Arms, R. (1989). Volume Cycles in the Stock Market'
            ]
          }
        }
      ]
    };
  }

  /**
   * Calculate Simple Moving Average
   */
  private calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) {
      return prices[prices.length - 1];
    }

    const slice = prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  /**
   * STATISTICAL HELPER METHODS FOR RESEARCH-GRADE ANALYSIS
   */

  /**
   * Calculate mean of array
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[], mean?: number): number {
    if (values.length === 0) return 0;
    const avg = mean !== undefined ? mean : this.calculateMean(values);
    const squareDiffs = values.map(value => Math.pow(value - avg, 2));
    const variance = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate z-score (how many standard deviations from mean)
   */
  private calculateZScore(value: number, mean: number, stdDev: number): number {
    if (stdDev === 0) return 0;
    return (value - mean) / stdDev;
  }

  /**
   * Calculate percentile rank of a value in a distribution
   */
  private calculatePercentile(value: number, distribution: number[]): number {
    if (distribution.length === 0) return 50;
    const sorted = [...distribution].sort((a, b) => a - b);
    const belowCount = sorted.filter(v => v < value).length;
    return (belowCount / sorted.length) * 100;
  }

  /**
   * Calculate p-value from z-score (two-tailed test)
   * Uses approximation of standard normal cumulative distribution function
   */
  private calculatePValue(zScore: number): number {
    const absZ = Math.abs(zScore);

    // Approximation of cumulative distribution function
    const t = 1 / (1 + 0.2316419 * absZ);
    const d = 0.3989423 * Math.exp(-absZ * absZ / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

    // Two-tailed test
    return 2 * p;
  }

  /**
   * Get confidence level from p-value
   */
  private getConfidenceLevel(pValue: number): string {
    if (pValue < 0.01) return 'HIGH'; // 99% confidence
    if (pValue < 0.05) return 'MEDIUM'; // 95% confidence
    return 'LOW'; // Below 95% confidence
  }

  /**
   * Backtest a signal: calculate future returns when signal occurs
   * Returns performance metrics
   */
  private backtestSignal(
    signalCondition: (value: number) => boolean,
    historicalValues: number[],
    historicalPrices: number[],
    lookAheadDays: number = 5
  ): {
    winRate: number;
    avgReturn: number;
    sharpeRatio: number;
    sampleSize: number;
  } {
    const signals: { index: number; value: number }[] = [];

    // Find all signal occurrences
    historicalValues.forEach((value, i) => {
      if (signalCondition(value)) {
        signals.push({ index: i, value });
      }
    });

    if (signals.length === 0) {
      return { winRate: 0, avgReturn: 0, sharpeRatio: 0, sampleSize: 0 };
    }

    const returns: number[] = [];

    // Calculate return for each signal
    signals.forEach(signal => {
      const entryPrice = historicalPrices[signal.index];
      const exitIndex = Math.min(signal.index + lookAheadDays, historicalPrices.length - 1);
      const exitPrice = historicalPrices[exitIndex];

      if (entryPrice && exitPrice) {
        const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        returns.push(returnPct);
      }
    });

    if (returns.length === 0) {
      return { winRate: 0, avgReturn: 0, sharpeRatio: 0, sampleSize: 0 };
    }

    const winRate = returns.filter(r => r > 0).length / returns.length;
    const avgReturn = this.calculateMean(returns);
    const stdDevReturn = this.calculateStdDev(returns, avgReturn);

    // Annualized Sharpe with risk-free subtraction
    // Risk-free: 4.5% annual (T-bill proxy), prorated for lookAheadDays holding period
    // Returns are in percent, so risk-free is also in percent
    const riskFreePerTrade = 4.5 * (lookAheadDays / 252);
    const excessReturn = avgReturn - riskFreePerTrade;
    const sharpeRatio = stdDevReturn !== 0 ? (excessReturn / stdDevReturn) * Math.sqrt(252 / lookAheadDays) : 0;

    return {
      winRate: Math.round(winRate * 1000) / 1000,
      avgReturn: Math.round(avgReturn * 1000) / 1000,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      sampleSize: returns.length
    };
  }
}

export const technicalScorer = new TechnicalScorer();
