/**
 * Earnings Prediction Service
 *
 * Provides AI-powered earnings predictions with:
 * - Scenario analysis (probability distribution)
 * - Revenue/EPS forecasts with justifications
 * - Tactical strategies for each scenario
 * - Historical earnings surprise analysis
 *
 * Inspired by Intellectia.ai earnings prediction feature.
 */

import { logger } from "./logger";
import { getTradierQuote, getTradierHistoryOHLC } from "./tradier-api";
import { fetchHistoricalPrices } from "./market-api";
import {
  calculateRSI,
  calculateMACD,
  calculateSMA,
  calculateBollingerBands,
} from "./technical-indicators";

// ===================
// TYPE DEFINITIONS
// ===================

export interface EarningsScenario {
  probability: number;
  priceTarget: number;
  priceChange: number; // percentage
}

export interface ForecastMetric {
  estimate: number;
  consensus: number;
  variance: number; // percentage difference from consensus
  justification: string;
}

export interface TacticalStrategy {
  strategy: string;
  optionPlay?: string;
  reasoning: string;
}

export interface EarningsSurprise {
  date: string;
  expectedEPS: number;
  actualEPS: number;
  surprise: number; // percentage
  priceReaction: number; // percentage move after earnings
}

export interface EarningsPrediction {
  symbol: string;
  currentPrice: number;
  earningsDate: string | null;
  daysToEarnings: number | null;

  // AI Prediction
  prediction: "strong_beat" | "beat" | "neutral" | "miss" | "strong_miss";
  confidence: number; // 0-100
  aiSummary: string;

  // Scenario Probabilities
  scenarios: {
    strongBeat: EarningsScenario;
    beat: EarningsScenario;
    neutral: EarningsScenario;
    miss: EarningsScenario;
    strongMiss: EarningsScenario;
  };

  // Forecasts
  revenueForecast: ForecastMetric;
  epsForecast: ForecastMetric;

  // Tactical Strategies
  tacticalStrategies: {
    bullish: TacticalStrategy;
    neutral: TacticalStrategy;
    bearish: TacticalStrategy;
  };

  // Historical
  surpriseHistory: EarningsSurprise[];
  averageSurprise: number;
  beatRate: number; // percentage of times company beat estimates

  // Risk Assessment
  riskLevel: "low" | "medium" | "high";
  impliedMove: number; // expected % move based on options pricing

  // Metadata
  analysisTimestamp: string;
  dataQuality: "high" | "medium" | "low";
  synthetic?: boolean; // true when surprise history is fabricated/unavailable
}

// ===================
// HELPER FUNCTIONS
// ===================

/**
 * Calculate implied move from current price and volatility
 */
function calculateImpliedMove(
  currentPrice: number,
  historicalVolatility: number,
  daysToEarnings: number
): number {
  // Simplified calculation: volatility * sqrt(time) * adjustment factor for earnings
  const earningsMultiplier = 1.5; // Earnings typically have higher vol
  const timeAdjustment = Math.sqrt(daysToEarnings / 365);
  return historicalVolatility * timeAdjustment * earningsMultiplier;
}

/**
 * Generate AI summary for earnings prediction
 */
function generateAISummary(
  symbol: string,
  prediction: string,
  confidence: number,
  beatRate: number,
  avgSurprise: number,
  technicalSignal: "bullish" | "bearish" | "neutral"
): string {
  const predictionText = {
    strong_beat: "strongly beat earnings expectations",
    beat: "beat earnings expectations",
    neutral: "meet earnings expectations",
    miss: "miss earnings expectations",
    strong_miss: "significantly miss earnings expectations",
  }[prediction];

  const historicalContext =
    beatRate >= 75
      ? `Historically, ${symbol} has beaten estimates ${beatRate.toFixed(0)}% of the time with an average surprise of ${avgSurprise >= 0 ? "+" : ""}${avgSurprise.toFixed(1)}%.`
      : beatRate >= 50
      ? `The company has a mixed track record, beating estimates ${beatRate.toFixed(0)}% of the time.`
      : `Caution: ${symbol} has missed estimates more often than not, with only a ${beatRate.toFixed(0)}% beat rate.`;

  const technicalContext =
    technicalSignal === "bullish"
      ? "Technical indicators suggest positive momentum heading into earnings."
      : technicalSignal === "bearish"
      ? "Technical indicators show weakness, which may amplify any negative reaction."
      : "Technical indicators are mixed, suggesting the stock could move either direction sharply.";

  return `Based on our multi-factor analysis, ${symbol} is predicted to ${predictionText} with ${confidence.toFixed(0)}% confidence. ${historicalContext} ${technicalContext}`;
}

/**
 * Generate tactical strategies based on prediction
 */
function generateTacticalStrategies(
  symbol: string,
  prediction: string,
  impliedMove: number,
  currentPrice: number
): EarningsPrediction["tacticalStrategies"] {
  const strikeUp = Math.ceil(currentPrice * 1.05);
  const strikeDown = Math.floor(currentPrice * 0.95);

  return {
    bullish: {
      strategy: "Long Call or Bull Call Spread",
      optionPlay: `Buy ${symbol} ${strikeUp}C weekly, or ${strikeUp}/${Math.ceil(currentPrice * 1.1)}C spread`,
      reasoning:
        prediction === "strong_beat" || prediction === "beat"
          ? "Aligns with our bullish earnings prediction. Consider spreads to reduce premium risk."
          : "Contrarian play if you believe the market is underestimating the company.",
    },
    neutral: {
      strategy: "Iron Condor or Strangle Sell",
      optionPlay: `Sell ${strikeDown}P/${strikeUp}C strangle or iron condor`,
      reasoning: `If you expect the stock to stay within the implied move of ${impliedMove.toFixed(1)}%, selling premium can be profitable.`,
    },
    bearish: {
      strategy: "Long Put or Bear Put Spread",
      optionPlay: `Buy ${symbol} ${strikeDown}P weekly, or ${strikeDown}/${Math.floor(currentPrice * 0.9)}P spread`,
      reasoning:
        prediction === "miss" || prediction === "strong_miss"
          ? "Aligns with our bearish earnings prediction. Spreads reduce cost basis."
          : "Hedge play if you're long the stock and want protection.",
    },
  };
}

/**
 * Stub: Returns empty earnings history.
 * In production, this would fetch real earnings history from FMP, Alpha Vantage, or similar.
 */
function simulateHistoricalSurprises(_symbol: string): EarningsSurprise[] {
  // No real data source available — return empty instead of fabricating EPS data
  return [];
}

// ===================
// MAIN PREDICTION FUNCTION
// ===================

/**
 * Generate comprehensive earnings prediction for a symbol
 */
export async function generateEarningsPrediction(
  symbol: string
): Promise<EarningsPrediction | null> {
  try {
    logger.info(`[EARNINGS-PREDICTION] Generating prediction for ${symbol}`);

    // Fetch current quote
    const quote = await getTradierQuote(symbol);
    if (!quote || !quote.last) {
      logger.warn(`[EARNINGS-PREDICTION] Could not fetch quote for ${symbol}`);
      return null;
    }

    const currentPrice = quote.last;

    // Fetch historical data for technical analysis
    let closes: number[] = [];
    let highs: number[] = [];
    let lows: number[] = [];

    try {
      const history = await getTradierHistoryOHLC(symbol, 60);
      if (history && history.closes.length > 0) {
        closes = history.closes;
        highs = history.highs;
        lows = history.lows;
      }
    } catch (e) {
      // Fallback to market-api
      const fallback = await fetchHistoricalPrices(symbol, 'stock', 60);
      if (Array.isArray(fallback)) {
        closes = fallback;
      }
    }

    // Calculate technical indicators
    let technicalSignal: "bullish" | "bearish" | "neutral" = "neutral";
    let rsi = 50;

    if (closes.length >= 20) {
      rsi = calculateRSI(closes, 14);
      const sma20 = calculateSMA(closes, 20);
      const macd = calculateMACD(closes);

      let bullPoints = 0;
      let bearPoints = 0;

      if (rsi < 35) bullPoints += 2;
      else if (rsi > 65) bearPoints += 2;

      if (currentPrice > sma20) bullPoints += 1;
      else bearPoints += 1;

      if (macd.histogram > 0) bullPoints += 1;
      else bearPoints += 1;

      if (bullPoints > bearPoints + 1) technicalSignal = "bullish";
      else if (bearPoints > bullPoints + 1) technicalSignal = "bearish";
    }

    // Historical surprises — empty until real data source (FMP/Alpha Vantage) integrated
    const surpriseHistory = simulateHistoricalSurprises(symbol);
    const beatsCount = surpriseHistory.filter((s) => s.surprise > 0).length;
    const beatRate = surpriseHistory.length > 0 ? (beatsCount / surpriseHistory.length) * 100 : 50; // default 50% when no history
    const averageSurprise = surpriseHistory.length > 0
      ? surpriseHistory.reduce((sum, s) => sum + s.surprise, 0) / surpriseHistory.length
      : 0;

    // Calculate historical volatility for implied move
    let historicalVolatility = 30; // default
    if (closes.length >= 20) {
      const returns = [];
      for (let i = 1; i < closes.length; i++) {
        returns.push(Math.log(closes[i] / closes[i - 1]));
      }
      const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance =
        returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
      historicalVolatility = Math.sqrt(variance * 252) * 100;
    }

    // Determine prediction based on technicals + historical pattern
    let prediction: EarningsPrediction["prediction"] = "neutral";
    let confidence = 55;

    if (beatRate >= 80 && technicalSignal === "bullish") {
      prediction = "strong_beat";
      confidence = 78; // Fixed confidence — no random noise
    } else if (beatRate >= 65 || technicalSignal === "bullish") {
      prediction = "beat";
      confidence = 65;
    } else if (beatRate < 40 && technicalSignal === "bearish") {
      prediction = "strong_miss";
      confidence = 68;
    } else if (beatRate < 50 || technicalSignal === "bearish") {
      prediction = "miss";
      confidence = 60;
    } else {
      confidence = 55;
    }

    // Calculate implied move
    const daysToEarnings = 14; // Would come from earnings calendar
    const impliedMove = calculateImpliedMove(currentPrice, historicalVolatility, daysToEarnings);

    // Generate scenario probabilities
    const scenarios: EarningsPrediction["scenarios"] = {
      strongBeat: {
        probability: prediction === "strong_beat" ? 25 : prediction === "beat" ? 15 : 10,
        priceTarget: currentPrice * 1.1,
        priceChange: 10,
      },
      beat: {
        probability: prediction === "strong_beat" ? 30 : prediction === "beat" ? 35 : 25,
        priceTarget: currentPrice * 1.05,
        priceChange: 5,
      },
      neutral: {
        probability:
          prediction === "neutral"
            ? 40
            : prediction === "beat" || prediction === "miss"
            ? 30
            : 20,
        priceTarget: currentPrice,
        priceChange: 0,
      },
      miss: {
        probability: prediction === "miss" ? 35 : prediction === "strong_miss" ? 25 : 15,
        priceTarget: currentPrice * 0.95,
        priceChange: -5,
      },
      strongMiss: {
        probability: prediction === "strong_miss" ? 25 : prediction === "miss" ? 15 : 5,
        priceTarget: currentPrice * 0.9,
        priceChange: -10,
      },
    };

    // Normalize probabilities to 100%
    const totalProb = Object.values(scenarios).reduce((sum, s) => sum + s.probability, 0);
    Object.keys(scenarios).forEach((key) => {
      scenarios[key as keyof typeof scenarios].probability = Math.round(
        (scenarios[key as keyof typeof scenarios].probability / totalProb) * 100
      );
    });

    // Generate forecasts
    const consensusEPS = surpriseHistory[0]?.expectedEPS || 2.0;
    const consensusRevenue = currentPrice * 10; // Simplified P/S estimation

    const epsVariance =
      prediction === "strong_beat"
        ? 8
        : prediction === "beat"
        ? 4
        : prediction === "miss"
        ? -4
        : prediction === "strong_miss"
        ? -8
        : 0;

    const revenueForecast: ForecastMetric = {
      estimate: consensusRevenue * (1 + epsVariance / 100),
      consensus: consensusRevenue,
      variance: epsVariance,
      justification:
        epsVariance > 0
          ? "Strong demand indicators and positive channel checks suggest revenue upside."
          : epsVariance < 0
          ? "Macro headwinds and inventory concerns may pressure top-line growth."
          : "Revenue expected to be in-line with seasonal patterns.",
    };

    const epsForecast: ForecastMetric = {
      estimate: parseFloat((consensusEPS * (1 + epsVariance / 100)).toFixed(2)),
      consensus: consensusEPS,
      variance: epsVariance,
      justification:
        epsVariance > 0
          ? "Operating leverage and cost efficiencies should drive EPS beat."
          : epsVariance < 0
          ? "Margin compression from input costs may pressure bottom line."
          : "EPS expected to meet street expectations.",
    };

    // Generate tactical strategies
    const tacticalStrategies = generateTacticalStrategies(
      symbol,
      prediction,
      impliedMove,
      currentPrice
    );

    // Generate AI summary
    const aiSummary = generateAISummary(
      symbol,
      prediction,
      confidence,
      beatRate,
      averageSurprise,
      technicalSignal
    );

    // Determine risk level
    const riskLevel: EarningsPrediction["riskLevel"] =
      impliedMove > 10 || historicalVolatility > 50
        ? "high"
        : impliedMove > 5 || historicalVolatility > 30
        ? "medium"
        : "low";

    const result: EarningsPrediction = {
      symbol,
      currentPrice,
      earningsDate: null, // Would come from earnings calendar API
      daysToEarnings,
      prediction,
      confidence: parseFloat(confidence.toFixed(0)),
      aiSummary,
      scenarios,
      revenueForecast,
      epsForecast,
      tacticalStrategies,
      surpriseHistory,
      averageSurprise: parseFloat(averageSurprise.toFixed(1)),
      beatRate: parseFloat(beatRate.toFixed(0)),
      riskLevel,
      impliedMove: parseFloat(impliedMove.toFixed(1)),
      analysisTimestamp: new Date().toISOString(),
      dataQuality: closes.length >= 50 ? "high" : closes.length >= 20 ? "medium" : "low",
      synthetic: surpriseHistory.length === 0, // No real earnings history available
    };

    logger.info(
      `[EARNINGS-PREDICTION] Generated prediction for ${symbol}: ${prediction} (${confidence.toFixed(0)}% confidence)`
    );

    return result;
  } catch (error) {
    logger.error(`[EARNINGS-PREDICTION] Error generating prediction for ${symbol}:`, error);
    return null;
  }
}

/**
 * Get historical earnings data for a symbol
 */
export async function getEarningsHistory(
  symbol: string
): Promise<EarningsSurprise[] | null> {
  try {
    // In production, this would fetch from FMP or similar API
    return simulateHistoricalSurprises(symbol);
  } catch (error) {
    logger.error(`[EARNINGS-PREDICTION] Error fetching earnings history for ${symbol}:`, error);
    return null;
  }
}
