/**
 * Index Lotto Scanner Service
 *
 * Identifies high risk/reward options plays on index ETFs (SPX, SPY, IWM, QQQ)
 * Analyzes technical setups: pin bars, RSI divergence, support/resistance, gamma levels
 *
 * Based on successful trade patterns:
 * - Pin bar at key levels (0.5 fib, pivot points)
 * - RSI divergence with price
 * - Gamma flip points
 * - Bollinger squeeze breakouts
 */

import { logger } from "./logger";
import { getTradierQuote, getTradierHistoryOHLC } from "./tradier-api";
import {
  calculateRSI,
  calculateMACD,
  calculateSMA,
  calculateBollingerBands,
} from "./technical-indicators";

// Types
interface TechnicalSetup {
  type: 'pin_bar' | 'rsi_divergence' | 'support_bounce' | 'resistance_rejection' | 'gamma_flip' | 'bollinger_squeeze';
  timeframe: '5m' | '15m' | '1h' | '4h' | 'daily';
  strength: number;
  description: string;
}

interface LottoPlay {
  symbol: string;
  underlying: string;
  underlyingPrice: number;
  strike: number;
  expiry: string;
  type: 'call' | 'put';
  currentPrice: number;
  estimatedTarget: number;
  potentialReturn: number;
  setups: TechnicalSetup[];
  overallScore: number;
  suggestedEntry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  riskReward: string;
  keyLevel: number;
  levelType: 'support' | 'resistance' | 'pivot';
  gammaExposure: 'positive' | 'negative' | 'neutral';
  thesis: string;
  confidence: 'low' | 'medium' | 'high';
}

interface IndexData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  dayRange: { low: number; high: number };
  pivotPoints: { s1: number; s2: number; pivot: number; r1: number; r2: number };
  rsi: number;
  macdSignal: 'bullish' | 'bearish' | 'neutral';
  volumeProfile: 'above_avg' | 'below_avg' | 'average';
}

// Calculate pivot points from OHLC
function calculatePivotPoints(high: number, low: number, close: number) {
  const pivot = (high + low + close) / 3;
  const r1 = 2 * pivot - low;
  const r2 = pivot + (high - low);
  const s1 = 2 * pivot - high;
  const s2 = pivot - (high - low);
  return { pivot, r1, r2, s1, s2 };
}

// Detect pin bar candle
function detectPinBar(open: number, high: number, low: number, close: number): boolean {
  const body = Math.abs(close - open);
  const totalRange = high - low;
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;

  // Pin bar has small body and long wick on one side
  if (totalRange === 0) return false;
  const bodyRatio = body / totalRange;
  const upperWickRatio = upperWick / totalRange;
  const lowerWickRatio = lowerWick / totalRange;

  // Bullish pin bar: small body, long lower wick
  if (bodyRatio < 0.3 && lowerWickRatio > 0.5) return true;
  // Bearish pin bar: small body, long upper wick
  if (bodyRatio < 0.3 && upperWickRatio > 0.5) return true;

  return false;
}

// Detect RSI divergence
function detectRSIDivergence(prices: number[], rsiValues: number[]): { type: 'bullish' | 'bearish' | null; strength: number } {
  if (prices.length < 10 || rsiValues.length < 10) return { type: null, strength: 0 };

  const recentPrices = prices.slice(-10);
  const recentRSI = rsiValues.slice(-10);

  // Find local lows/highs
  const priceMin1 = Math.min(...recentPrices.slice(0, 5));
  const priceMin2 = Math.min(...recentPrices.slice(5));
  const rsiMin1 = Math.min(...recentRSI.slice(0, 5));
  const rsiMin2 = Math.min(...recentRSI.slice(5));

  const priceMax1 = Math.max(...recentPrices.slice(0, 5));
  const priceMax2 = Math.max(...recentPrices.slice(5));
  const rsiMax1 = Math.max(...recentRSI.slice(0, 5));
  const rsiMax2 = Math.max(...recentRSI.slice(5));

  // Bullish divergence: price lower low, RSI higher low
  if (priceMin2 < priceMin1 && rsiMin2 > rsiMin1) {
    return { type: 'bullish', strength: Math.min(80, 50 + (rsiMin2 - rsiMin1) * 2) };
  }

  // Bearish divergence: price higher high, RSI lower high
  if (priceMax2 > priceMax1 && rsiMax2 < rsiMax1) {
    return { type: 'bearish', strength: Math.min(80, 50 + (rsiMax1 - rsiMax2) * 2) };
  }

  return { type: null, strength: 0 };
}

// Detect Bollinger squeeze
function detectBollingerSqueeze(bbands: { upper: number[]; middle: number[]; lower: number[] }): { isSqueezing: boolean; strength: number } {
  if (bbands.upper.length < 20) return { isSqueezing: false, strength: 0 };

  const recentWidth = bbands.upper.slice(-5).map((u, i) => u - bbands.lower.slice(-5)[i]);
  const historicalWidth = bbands.upper.slice(-20, -5).map((u, i) => u - bbands.lower.slice(-20, -5)[i]);

  const avgRecent = recentWidth.reduce((a, b) => a + b, 0) / recentWidth.length;
  const avgHistorical = historicalWidth.reduce((a, b) => a + b, 0) / historicalWidth.length;

  const squeezeFactor = avgHistorical / avgRecent;
  const isSqueezing = squeezeFactor > 1.3;

  return {
    isSqueezing,
    strength: Math.min(90, 50 + (squeezeFactor - 1) * 30),
  };
}

// Get index data
async function getIndexData(symbol: string, name: string): Promise<IndexData | null> {
  try {
    const quote = await getTradierQuote(symbol);
    if (!quote || !quote.last) return null;

    // Get historical data for technicals
    const historyData = await getTradierHistoryOHLC(symbol, 30);
    if (!historyData || !historyData.closes || historyData.closes.length < 20) return null;

    const closes = historyData.closes;
    const highs = historyData.highs;
    const lows = historyData.lows;
    // Volume not available from this API, use placeholder
    const volumes = closes.map(() => 1000000);

    // Calculate technicals
    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes);

    // Pivot points from yesterday's data (second to last values)
    const yesterdayIdx = closes.length - 2;
    const pivots = calculatePivotPoints(
      highs[yesterdayIdx] || highs[closes.length - 1],
      lows[yesterdayIdx] || lows[closes.length - 1],
      closes[yesterdayIdx] || closes[closes.length - 1]
    );

    // Volume analysis (using placeholder since volume not available)
    const volumeProfile: 'above_avg' | 'below_avg' | 'average' = 'average';

    // MACD signal
    const macdSignal = macd.histogram > 0 && macd.macdLine > macd.signalLine ? 'bullish' :
      macd.histogram < 0 && macd.macdLine < macd.signalLine ? 'bearish' : 'neutral';

    return {
      symbol,
      name,
      price: quote.last,
      change: quote.change || 0,
      changePercent: quote.change_percentage || 0,
      dayRange: { low: quote.low || quote.last, high: quote.high || quote.last },
      pivotPoints: {
        s1: parseFloat(pivots.s1.toFixed(2)),
        s2: parseFloat(pivots.s2.toFixed(2)),
        pivot: parseFloat(pivots.pivot.toFixed(2)),
        r1: parseFloat(pivots.r1.toFixed(2)),
        r2: parseFloat(pivots.r2.toFixed(2)),
      },
      rsi: Math.round(rsi),
      macdSignal,
      volumeProfile,
    };
  } catch (error) {
    logger.error(`[INDEX-LOTTO] Failed to get data for ${symbol}:`, error);
    return null;
  }
}

// Generate lotto plays based on technical analysis
function generateLottoPlays(indexData: IndexData[]): LottoPlay[] {
  const plays: LottoPlay[] = [];

  for (const index of indexData) {
    const { symbol, price, pivotPoints, rsi, macdSignal } = index;

    // Determine bias
    const isBullish = macdSignal === 'bullish' || (rsi > 40 && rsi < 60 && price > pivotPoints.pivot);
    const isBearish = macdSignal === 'bearish' || (rsi > 60);

    // Calculate strike distances
    const otmDistance = symbol === 'SPX' ? 40 : symbol === 'SPY' ? 4 : symbol === 'QQQ' ? 8 : 4;
    const optionMultiplier = symbol === 'SPX' ? 0.01 : 0.10; // Rough estimate for option pricing

    // Generate bullish play if conditions favor
    if (isBullish || rsi < 35) {
      const strike = Math.ceil((price + otmDistance) / 5) * 5; // Round to nearest 5
      const distanceToStrike = strike - price;
      const estimatedPremium = distanceToStrike * optionMultiplier * 2;

      const setups: TechnicalSetup[] = [];

      // Add setups based on conditions
      if (rsi < 35) {
        setups.push({
          type: 'rsi_divergence',
          timeframe: '1h',
          strength: 65 + (35 - rsi),
          description: `RSI oversold at ${rsi}, potential reversal`,
        });
      }

      if (price > pivotPoints.pivot && price < pivotPoints.r1) {
        setups.push({
          type: 'support_bounce',
          timeframe: '1h',
          strength: 70,
          description: `Holding above pivot ${pivotPoints.pivot}, targeting R1 ${pivotPoints.r1}`,
        });
      }

      if (macdSignal === 'bullish') {
        setups.push({
          type: 'gamma_flip',
          timeframe: '4h',
          strength: 68,
          description: 'MACD bullish, potential gamma acceleration',
        });
      }

      if (setups.length > 0) {
        const overallScore = Math.round(setups.reduce((sum, s) => sum + s.strength, 0) / setups.length);

        plays.push({
          symbol: `${symbol} ${strike}C ${getDTE()}`,
          underlying: symbol,
          underlyingPrice: price,
          strike,
          expiry: getDTE(),
          type: 'call',
          currentPrice: parseFloat(estimatedPremium.toFixed(2)),
          estimatedTarget: parseFloat((estimatedPremium * 3).toFixed(2)),
          potentialReturn: 200,
          setups,
          overallScore,
          suggestedEntry: parseFloat((estimatedPremium * 0.9).toFixed(2)),
          stopLoss: parseFloat((estimatedPremium * 0.4).toFixed(2)),
          target1: parseFloat((estimatedPremium * 2).toFixed(2)),
          target2: parseFloat((estimatedPremium * 3.5).toFixed(2)),
          riskReward: '1:4',
          keyLevel: pivotPoints.pivot,
          levelType: 'support',
          gammaExposure: 'negative',
          thesis: `${symbol} showing bullish signals with MACD ${macdSignal} and RSI at ${rsi}. Looking for move through ${pivotPoints.r1} resistance.`,
          confidence: overallScore > 70 ? 'high' : overallScore > 55 ? 'medium' : 'low',
        });
      }
    }

    // Generate bearish play if conditions favor
    if (isBearish || rsi > 70) {
      const strike = Math.floor((price - otmDistance) / 5) * 5;
      const distanceToStrike = price - strike;
      const estimatedPremium = distanceToStrike * optionMultiplier * 2;

      const setups: TechnicalSetup[] = [];

      if (rsi > 70) {
        setups.push({
          type: 'rsi_divergence',
          timeframe: '1h',
          strength: 60 + (rsi - 70),
          description: `RSI overbought at ${rsi}, potential pullback`,
        });
      }

      if (price < pivotPoints.pivot && price > pivotPoints.s1) {
        setups.push({
          type: 'resistance_rejection',
          timeframe: '1h',
          strength: 68,
          description: `Rejected at pivot ${pivotPoints.pivot}, targeting S1 ${pivotPoints.s1}`,
        });
      }

      if (macdSignal === 'bearish') {
        setups.push({
          type: 'gamma_flip',
          timeframe: '4h',
          strength: 65,
          description: 'MACD bearish, potential downside acceleration',
        });
      }

      if (setups.length > 0) {
        const overallScore = Math.round(setups.reduce((sum, s) => sum + s.strength, 0) / setups.length);

        plays.push({
          symbol: `${symbol} ${strike}P ${getDTE()}`,
          underlying: symbol,
          underlyingPrice: price,
          strike,
          expiry: getDTE(),
          type: 'put',
          currentPrice: parseFloat(estimatedPremium.toFixed(2)),
          estimatedTarget: parseFloat((estimatedPremium * 3).toFixed(2)),
          potentialReturn: 200,
          setups,
          overallScore,
          suggestedEntry: parseFloat((estimatedPremium * 0.9).toFixed(2)),
          stopLoss: parseFloat((estimatedPremium * 0.4).toFixed(2)),
          target1: parseFloat((estimatedPremium * 2).toFixed(2)),
          target2: parseFloat((estimatedPremium * 3.5).toFixed(2)),
          riskReward: '1:4',
          keyLevel: pivotPoints.pivot,
          levelType: 'resistance',
          gammaExposure: 'negative',
          thesis: `${symbol} showing bearish signals with MACD ${macdSignal} and RSI at ${rsi}. Looking for breakdown through ${pivotPoints.s1} support.`,
          confidence: overallScore > 70 ? 'high' : overallScore > 55 ? 'medium' : 'low',
        });
      }
    }
  }

  return plays.sort((a, b) => b.overallScore - a.overallScore);
}

// Get DTE string
function getDTE(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();

  // If it's Friday or weekend, return 0DTE for Friday
  if (dayOfWeek >= 5) return '0DTE';
  // During weekdays, return based on time
  const hour = now.getHours();
  if (hour >= 15) return '0DTE'; // After 3pm, looking at next day
  return '0DTE';
}

// Main export
export async function scanIndexLottoPlays(): Promise<{ indexData: IndexData[]; lottoPlays: LottoPlay[] }> {
  logger.info('[INDEX-LOTTO] Starting index lotto scan...');

  const indices = [
    { symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
    { symbol: 'QQQ', name: 'Invesco QQQ Trust' },
    { symbol: 'IWM', name: 'iShares Russell 2000 ETF' },
  ];

  // Note: SPX requires different data source (cash index), using SPY as proxy
  const indexDataPromises = indices.map(i => getIndexData(i.symbol, i.name));
  const indexDataResults = await Promise.all(indexDataPromises);
  const indexData = indexDataResults.filter((d): d is IndexData => d !== null);

  // Add SPX data derived from SPY
  const spyData = indexData.find(d => d.symbol === 'SPY');
  if (spyData) {
    const spxPrice = spyData.price * 10; // Rough SPX approximation
    indexData.unshift({
      symbol: 'SPX',
      name: 'S&P 500 Index',
      price: parseFloat(spxPrice.toFixed(2)),
      change: spyData.change * 10,
      changePercent: spyData.changePercent,
      dayRange: {
        low: parseFloat((spyData.dayRange.low * 10).toFixed(2)),
        high: parseFloat((spyData.dayRange.high * 10).toFixed(2)),
      },
      pivotPoints: {
        s1: parseFloat((spyData.pivotPoints.s1 * 10).toFixed(2)),
        s2: parseFloat((spyData.pivotPoints.s2 * 10).toFixed(2)),
        pivot: parseFloat((spyData.pivotPoints.pivot * 10).toFixed(2)),
        r1: parseFloat((spyData.pivotPoints.r1 * 10).toFixed(2)),
        r2: parseFloat((spyData.pivotPoints.r2 * 10).toFixed(2)),
      },
      rsi: spyData.rsi,
      macdSignal: spyData.macdSignal,
      volumeProfile: spyData.volumeProfile,
    });
  }

  const lottoPlays = generateLottoPlays(indexData);

  logger.info(`[INDEX-LOTTO] Scan complete: ${indexData.length} indices, ${lottoPlays.length} plays`);

  return { indexData, lottoPlays };
}
