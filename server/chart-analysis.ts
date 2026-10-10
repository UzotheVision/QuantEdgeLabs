import { getTradierHistoryOHLC } from './tradier-api';
import { fetchHistoricalPrices } from './market-api';
import { calculateSMA, calculateRSI, calculateATR, calculateBollingerBands } from './technical-indicators';
import { logger } from './logger';

export interface OHLCData {
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  dates: string[];
}

export interface ChartPattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  description: string;
  priceTarget?: number;
  invalidationLevel?: number;
}

export interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: 'strong' | 'moderate' | 'weak';
  touches: number;
  source: string;
}

export interface ChartAnalysisResult {
  symbol: string;
  assetType: string;
  currentPrice: number;
  patterns: ChartPattern[];
  supportLevels: SupportResistanceLevel[];
  resistanceLevels: SupportResistanceLevel[];
  trendDirection: 'bullish' | 'bearish' | 'sideways';
  trendStrength: number;
  keyLevels: {
    nearestSupport: number | null;
    nearestResistance: number | null;
    sma50: number;
    sma200: number;
  };
  validation: {
    isValidSetup: boolean;
    confidence: number;
    reasons: string[];
    warnings: string[];
  };
  analysisTimestamp: string;
}

export async function fetchOHLCData(
  symbol: string,
  assetType: string,
  days: number = 60
): Promise<OHLCData | null> {
  try {
    if (assetType === 'crypto') {
      const prices = await fetchHistoricalPrices(symbol, 'crypto', days);
      if (prices.length < 20) return null;
      
      return {
        opens: prices,
        highs: prices.map(p => p * 1.01),
        lows: prices.map(p => p * 0.99),
        closes: prices,
        dates: prices.map((_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - (prices.length - i));
          return d.toISOString().split('T')[0];
        })
      };
    }

    const ohlc = await getTradierHistoryOHLC(symbol, days);
    if (!ohlc || ohlc.closes.length < 20) {
      logger.warn(`[CHART] Insufficient OHLC data for ${symbol}`);
      return null;
    }

    return ohlc;
  } catch (error) {
    logger.error(`[CHART] Error fetching OHLC for ${symbol}:`, error);
    return null;
  }
}

function findSwingHighs(highs: number[], period: number = 5): number[] {
  const swingHighs: number[] = [];
  
  for (let i = period; i < highs.length - period; i++) {
    let isSwingHigh = true;
    for (let j = 1; j <= period; j++) {
      if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) {
        isSwingHigh = false;
        break;
      }
    }
    if (isSwingHigh) swingHighs.push(highs[i]);
  }
  
  return swingHighs;
}

function findSwingLows(lows: number[], period: number = 5): number[] {
  const swingLows: number[] = [];
  
  for (let i = period; i < lows.length - period; i++) {
    let isSwingLow = true;
    for (let j = 1; j <= period; j++) {
      if (lows[i] >= lows[i - j] || lows[i] >= lows[i + j]) {
        isSwingLow = false;
        break;
      }
    }
    if (isSwingLow) swingLows.push(lows[i]);
  }
  
  return swingLows;
}

function clusterPriceLevels(prices: number[], tolerance: number = 0.02): { price: number; count: number }[] {
  if (prices.length === 0) return [];
  
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters: { price: number; count: number; prices: number[] }[] = [];
  
  for (const price of sorted) {
    let added = false;
    for (const cluster of clusters) {
      const avgPrice = cluster.prices.reduce((a, b) => a + b, 0) / cluster.prices.length;
      if (Math.abs(price - avgPrice) / avgPrice < tolerance) {
        cluster.prices.push(price);
        cluster.count++;
        cluster.price = cluster.prices.reduce((a, b) => a + b, 0) / cluster.prices.length;
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push({ price, count: 1, prices: [price] });
    }
  }
  
  return clusters.map(c => ({ price: c.price, count: c.count }));
}

export function detectSupportResistance(ohlc: OHLCData, currentPrice: number): {
  support: SupportResistanceLevel[];
  resistance: SupportResistanceLevel[];
} {
  const swingHighs = findSwingHighs(ohlc.highs);
  const swingLows = findSwingLows(ohlc.lows);
  
  const highClusters = clusterPriceLevels(swingHighs, 0.015);
  const lowClusters = clusterPriceLevels(swingLows, 0.015);
  
  const sma50 = calculateSMA(ohlc.closes, 50);
  const sma200 = calculateSMA(ohlc.closes, 200);
  const sma20 = calculateSMA(ohlc.closes, 20);
  
  const allLevels: SupportResistanceLevel[] = [];
  
  for (const cluster of highClusters) {
    if (cluster.count >= 2) {
      allLevels.push({
        price: Number(cluster.price.toFixed(2)),
        type: cluster.price > currentPrice ? 'resistance' : 'support',
        strength: cluster.count >= 3 ? 'strong' : 'moderate',
        touches: cluster.count,
        source: 'swing_high'
      });
    }
  }
  
  for (const cluster of lowClusters) {
    if (cluster.count >= 2) {
      allLevels.push({
        price: Number(cluster.price.toFixed(2)),
        type: cluster.price < currentPrice ? 'support' : 'resistance',
        strength: cluster.count >= 3 ? 'strong' : 'moderate',
        touches: cluster.count,
        source: 'swing_low'
      });
    }
  }
  
  const maLevels = [
    { price: sma20, name: 'SMA20' },
    { price: sma50, name: 'SMA50' },
    { price: sma200, name: 'SMA200' }
  ];
  
  for (const ma of maLevels) {
    if (ma.price > 0) {
      allLevels.push({
        price: Number(ma.price.toFixed(2)),
        type: ma.price < currentPrice ? 'support' : 'resistance',
        strength: ma.name === 'SMA200' ? 'strong' : 'moderate',
        touches: 1,
        source: ma.name
      });
    }
  }
  
  const roundNumbers = [
    Math.floor(currentPrice / 100) * 100,
    Math.ceil(currentPrice / 100) * 100,
    Math.floor(currentPrice / 50) * 50,
    Math.ceil(currentPrice / 50) * 50,
    Math.floor(currentPrice / 10) * 10,
    Math.ceil(currentPrice / 10) * 10
  ].filter((v, i, arr) => arr.indexOf(v) === i && Math.abs(v - currentPrice) / currentPrice < 0.1);
  
  for (const round of roundNumbers) {
    if (round > 0) {
      allLevels.push({
        price: round,
        type: round < currentPrice ? 'support' : 'resistance',
        strength: round % 100 === 0 ? 'moderate' : 'weak',
        touches: 1,
        source: 'round_number'
      });
    }
  }
  
  const support = allLevels
    .filter(l => l.type === 'support')
    .sort((a, b) => b.price - a.price)
    .slice(0, 5);
    
  const resistance = allLevels
    .filter(l => l.type === 'resistance')
    .sort((a, b) => a.price - b.price)
    .slice(0, 5);
  
  return { support, resistance };
}

function detectDoubleTop(highs: number[], closes: number[], currentPrice: number): ChartPattern | null {
  if (highs.length < 20) return null;
  
  const recentHighs = highs.slice(-30);
  const peaks: { index: number; price: number }[] = [];
  
  for (let i = 3; i < recentHighs.length - 3; i++) {
    if (recentHighs[i] > recentHighs[i-1] && recentHighs[i] > recentHighs[i-2] &&
        recentHighs[i] > recentHighs[i+1] && recentHighs[i] > recentHighs[i+2]) {
      peaks.push({ index: i, price: recentHighs[i] });
    }
  }
  
  for (let i = 0; i < peaks.length - 1; i++) {
    const peak1 = peaks[i];
    const peak2 = peaks[i + 1];
    
    if (peak2.index - peak1.index >= 5 && peak2.index - peak1.index <= 20) {
      const priceDiff = Math.abs(peak1.price - peak2.price) / peak1.price;
      
      if (priceDiff < 0.03) {
        const neckline = Math.min(...recentHighs.slice(peak1.index, peak2.index));
        
        if (currentPrice < (peak1.price + peak2.price) / 2 * 0.98) {
          const patternHeight = ((peak1.price + peak2.price) / 2) - neckline;
          const target = neckline - patternHeight;
          
          return {
            name: 'Double Top',
            type: 'bearish',
            confidence: 70 + (1 - priceDiff) * 20,
            description: `Double top pattern detected at $${((peak1.price + peak2.price) / 2).toFixed(2)} with neckline at $${neckline.toFixed(2)}`,
            priceTarget: Number(target.toFixed(2)),
            invalidationLevel: Number(Math.max(peak1.price, peak2.price).toFixed(2))
          };
        }
      }
    }
  }
  
  return null;
}

function detectDoubleBottom(lows: number[], closes: number[], currentPrice: number): ChartPattern | null {
  if (lows.length < 20) return null;
  
  const recentLows = lows.slice(-30);
  const troughs: { index: number; price: number }[] = [];
  
  for (let i = 3; i < recentLows.length - 3; i++) {
    if (recentLows[i] < recentLows[i-1] && recentLows[i] < recentLows[i-2] &&
        recentLows[i] < recentLows[i+1] && recentLows[i] < recentLows[i+2]) {
      troughs.push({ index: i, price: recentLows[i] });
    }
  }
  
  for (let i = 0; i < troughs.length - 1; i++) {
    const trough1 = troughs[i];
    const trough2 = troughs[i + 1];
    
    if (trough2.index - trough1.index >= 5 && trough2.index - trough1.index <= 20) {
      const priceDiff = Math.abs(trough1.price - trough2.price) / trough1.price;
      
      if (priceDiff < 0.03) {
        const neckline = Math.max(...recentLows.slice(trough1.index, trough2.index));
        
        if (currentPrice > (trough1.price + trough2.price) / 2 * 1.02) {
          const patternHeight = neckline - ((trough1.price + trough2.price) / 2);
          const target = neckline + patternHeight;
          
          return {
            name: 'Double Bottom',
            type: 'bullish',
            confidence: 70 + (1 - priceDiff) * 20,
            description: `Double bottom pattern detected at $${((trough1.price + trough2.price) / 2).toFixed(2)} with neckline at $${neckline.toFixed(2)}`,
            priceTarget: Number(target.toFixed(2)),
            invalidationLevel: Number(Math.min(trough1.price, trough2.price).toFixed(2))
          };
        }
      }
    }
  }
  
  return null;
}

function detectHeadAndShoulders(highs: number[], lows: number[], closes: number[], currentPrice: number): ChartPattern | null {
  if (highs.length < 30) return null;
  
  const recentHighs = highs.slice(-40);
  const peaks: { index: number; price: number }[] = [];
  
  for (let i = 3; i < recentHighs.length - 3; i++) {
    if (recentHighs[i] > recentHighs[i-1] && recentHighs[i] > recentHighs[i-2] &&
        recentHighs[i] > recentHighs[i+1] && recentHighs[i] > recentHighs[i+2]) {
      peaks.push({ index: i, price: recentHighs[i] });
    }
  }
  
  if (peaks.length >= 3) {
    for (let i = 0; i < peaks.length - 2; i++) {
      const leftShoulder = peaks[i];
      const head = peaks[i + 1];
      const rightShoulder = peaks[i + 2];
      
      if (head.price > leftShoulder.price * 1.02 && head.price > rightShoulder.price * 1.02) {
        const shoulderDiff = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
        
        if (shoulderDiff < 0.05) {
          const necklineLeft = Math.min(...lows.slice(leftShoulder.index, head.index));
          const necklineRight = Math.min(...lows.slice(head.index, rightShoulder.index));
          const neckline = (necklineLeft + necklineRight) / 2;
          
          if (currentPrice < neckline * 1.02) {
            const patternHeight = head.price - neckline;
            const target = neckline - patternHeight;
            
            return {
              name: 'Head and Shoulders',
              type: 'bearish',
              confidence: 75 + (1 - shoulderDiff) * 15,
              description: `H&S pattern: Head at $${head.price.toFixed(2)}, neckline at $${neckline.toFixed(2)}`,
              priceTarget: Number(target.toFixed(2)),
              invalidationLevel: Number(head.price.toFixed(2))
            };
          }
        }
      }
    }
  }
  
  return null;
}

function detectBullFlag(highs: number[], lows: number[], closes: number[], currentPrice: number): ChartPattern | null {
  if (closes.length < 20) return null;
  
  const poleStart = closes.length - 20;
  const poleEnd = closes.length - 10;
  const flagEnd = closes.length - 1;
  
  const poleGain = (closes[poleEnd] - closes[poleStart]) / closes[poleStart];
  
  if (poleGain > 0.05) {
    const flagHighs = highs.slice(poleEnd, flagEnd + 1);
    const flagLows = lows.slice(poleEnd, flagEnd + 1);
    
    const flagHighMax = Math.max(...flagHighs);
    const flagLowMin = Math.min(...flagLows);
    const flagRange = (flagHighMax - flagLowMin) / flagHighMax;
    
    const flagSlope = (closes[flagEnd] - closes[poleEnd]) / closes[poleEnd];
    
    if (flagRange < 0.08 && flagSlope < 0 && flagSlope > -0.05) {
      const target = currentPrice + (closes[poleEnd] - closes[poleStart]);
      
      return {
        name: 'Bull Flag',
        type: 'bullish',
        confidence: 65 + Math.min(poleGain * 100, 20),
        description: `Bull flag forming after ${(poleGain * 100).toFixed(1)}% rally, consolidating in tight range`,
        priceTarget: Number(target.toFixed(2)),
        invalidationLevel: Number(flagLowMin.toFixed(2))
      };
    }
  }
  
  return null;
}

function detectAscendingTriangle(highs: number[], lows: number[], closes: number[], currentPrice: number): ChartPattern | null {
  if (highs.length < 20) return null;
  
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  
  const highMax = Math.max(...recentHighs);
  const highMin = Math.min(...recentHighs);
  const highRange = (highMax - highMin) / highMax;
  
  let risingLows = true;
  for (let i = 5; i < recentLows.length; i += 5) {
    if (recentLows[i] < recentLows[i - 5] * 0.99) {
      risingLows = false;
      break;
    }
  }
  
  if (highRange < 0.03 && risingLows) {
    const resistanceLevel = highMax;
    const supportTrend = recentLows[recentLows.length - 1];
    const triangleHeight = resistanceLevel - supportTrend;
    const target = resistanceLevel + triangleHeight;
    
    return {
      name: 'Ascending Triangle',
      type: 'bullish',
      confidence: 70,
      description: `Ascending triangle with flat resistance at $${resistanceLevel.toFixed(2)} and rising support`,
      priceTarget: Number(target.toFixed(2)),
      invalidationLevel: Number(supportTrend.toFixed(2))
    };
  }
  
  return null;
}

function detectDescendingTriangle(highs: number[], lows: number[], closes: number[], currentPrice: number): ChartPattern | null {
  if (lows.length < 20) return null;
  
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  
  const lowMax = Math.max(...recentLows);
  const lowMin = Math.min(...recentLows);
  const lowRange = (lowMax - lowMin) / lowMin;
  
  let fallingHighs = true;
  for (let i = 5; i < recentHighs.length; i += 5) {
    if (recentHighs[i] > recentHighs[i - 5] * 1.01) {
      fallingHighs = false;
      break;
    }
  }
  
  if (lowRange < 0.03 && fallingHighs) {
    const supportLevel = lowMin;
    const resistanceTrend = recentHighs[recentHighs.length - 1];
    const triangleHeight = resistanceTrend - supportLevel;
    const target = supportLevel - triangleHeight;
    
    return {
      name: 'Descending Triangle',
      type: 'bearish',
      confidence: 70,
      description: `Descending triangle with flat support at $${supportLevel.toFixed(2)} and falling resistance`,
      priceTarget: Number(target.toFixed(2)),
      invalidationLevel: Number(resistanceTrend.toFixed(2))
    };
  }
  
  return null;
}

function detectChannel(highs: number[], lows: number[], closes: number[]): ChartPattern | null {
  if (highs.length < 20) return null;
  
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  
  const highSlope = (recentHighs[recentHighs.length - 1] - recentHighs[0]) / recentHighs.length;
  const lowSlope = (recentLows[recentLows.length - 1] - recentLows[0]) / recentLows.length;
  
  const slopeRatio = Math.abs(highSlope - lowSlope) / Math.max(Math.abs(highSlope), Math.abs(lowSlope), 0.001);
  
  if (slopeRatio < 0.3 && Math.abs(highSlope) > 0.001) {
    const avgSlope = (highSlope + lowSlope) / 2;
    const channelWidth = Math.max(...recentHighs) - Math.min(...recentLows);
    
    if (avgSlope > 0) {
      return {
        name: 'Ascending Channel',
        type: 'bullish',
        confidence: 65,
        description: `Price trading in ascending channel with ${(avgSlope * 100).toFixed(2)}% daily slope`,
        priceTarget: Number((closes[closes.length - 1] + channelWidth * 0.5).toFixed(2))
      };
    } else {
      return {
        name: 'Descending Channel',
        type: 'bearish',
        confidence: 65,
        description: `Price trading in descending channel with ${(avgSlope * 100).toFixed(2)}% daily slope`,
        priceTarget: Number((closes[closes.length - 1] - channelWidth * 0.5).toFixed(2))
      };
    }
  }
  
  return null;
}

function detectRisingWedge(highs: number[], lows: number[], closes: number[], currentPrice: number): ChartPattern | null {
  if (closes.length < 20) return null;
  
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  
  let highSlope = 0;
  let lowSlope = 0;
  let highSum = 0, lowSum = 0;
  
  for (let i = 1; i < recentHighs.length; i++) {
    highSum += (recentHighs[i] - recentHighs[i-1]) / recentHighs[i-1];
    lowSum += (recentLows[i] - recentLows[i-1]) / recentLows[i-1];
  }
  
  highSlope = highSum / (recentHighs.length - 1);
  lowSlope = lowSum / (recentLows.length - 1);
  
  if (highSlope > 0.001 && lowSlope > 0.002 && lowSlope > highSlope) {
    const wedgeTop = Math.max(...recentHighs);
    const target = currentPrice - (wedgeTop - Math.min(...recentLows)) * 0.618;
    
    return {
      name: 'Rising Wedge',
      type: 'bearish',
      confidence: 68,
      description: 'Rising wedge pattern detected - lower highs converging with higher lows, often precedes breakdown',
      priceTarget: Number(target.toFixed(2)),
      invalidationLevel: Number((wedgeTop * 1.02).toFixed(2))
    };
  }
  
  return null;
}

function detectFallingWedge(highs: number[], lows: number[], closes: number[], currentPrice: number): ChartPattern | null {
  if (closes.length < 20) return null;
  
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  
  let highSlope = 0;
  let lowSlope = 0;
  let highSum = 0, lowSum = 0;
  
  for (let i = 1; i < recentHighs.length; i++) {
    highSum += (recentHighs[i] - recentHighs[i-1]) / recentHighs[i-1];
    lowSum += (recentLows[i] - recentLows[i-1]) / recentLows[i-1];
  }
  
  highSlope = highSum / (recentHighs.length - 1);
  lowSlope = lowSum / (recentLows.length - 1);
  
  if (highSlope < -0.002 && lowSlope < -0.001 && highSlope < lowSlope) {
    const wedgeBottom = Math.min(...recentLows);
    const target = currentPrice + (Math.max(...recentHighs) - wedgeBottom) * 0.618;
    
    return {
      name: 'Falling Wedge',
      type: 'bullish',
      confidence: 68,
      description: 'Falling wedge pattern detected - lower highs converging with lower lows, often precedes breakout',
      priceTarget: Number(target.toFixed(2)),
      invalidationLevel: Number((wedgeBottom * 0.98).toFixed(2))
    };
  }
  
  return null;
}

function detectCupAndHandle(highs: number[], lows: number[], closes: number[], currentPrice: number): ChartPattern | null {
  if (closes.length < 30) return null;
  
  const cupPeriod = Math.min(30, closes.length);
  const cupCloses = closes.slice(-cupPeriod);
  
  const cupHigh = Math.max(...cupCloses.slice(0, 5));
  const cupLow = Math.min(...cupCloses.slice(Math.floor(cupPeriod/3), Math.floor(cupPeriod*2/3)));
  const cupRight = Math.max(...cupCloses.slice(-5));
  
  const cupDepth = (cupHigh - cupLow) / cupHigh;
  const cupSymmetry = Math.abs(cupHigh - cupRight) / cupHigh;
  
  if (cupDepth > 0.1 && cupDepth < 0.35 && cupSymmetry < 0.05) {
    const handleCloses = closes.slice(-10);
    const handleDrop = (cupRight - Math.min(...handleCloses)) / cupRight;
    
    if (handleDrop > 0.02 && handleDrop < cupDepth * 0.5) {
      const target = cupRight + (cupRight - cupLow);
      
      return {
        name: 'Cup and Handle',
        type: 'bullish',
        confidence: 72,
        description: `Cup and handle forming with ${(cupDepth * 100).toFixed(1)}% cup depth, handle retracement ${(handleDrop * 100).toFixed(1)}%`,
        priceTarget: Number(target.toFixed(2)),
        invalidationLevel: Number(cupLow.toFixed(2))
      };
    }
  }
  
  return null;
}

function detectHammerPattern(opens: number[], highs: number[], lows: number[], closes: number[], currentPrice: number): ChartPattern | null {
  if (closes.length < 5) return null;
  
  const idx = closes.length - 1;
  const open = opens[idx];
  const high = highs[idx];
  const low = lows[idx];
  const close = closes[idx];
  
  const body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const totalRange = high - low;
  
  if (totalRange === 0 || body === 0) return null;
  
  // Hammer: Long lower wick, small upper wick, appears after downtrend (potential bullish reversal)
  // Requirements: Lower wick >= 2x body, upper wick <= 0.5x body
  if (lowerWick >= body * 2 && upperWick <= body * 0.5) {
    // Check for prior downtrend (prices were falling)
    const lookback = Math.min(5, idx);
    const priorClose = closes[idx - lookback];
    const isDowntrend = priorClose > closes[idx - 1];
    
    if (isDowntrend) {
      return {
        name: 'Hammer',
        type: 'bullish',
        confidence: 62,
        description: 'Hammer candlestick at potential support - long lower wick shows buyers rejected lower prices',
        priceTarget: Number((currentPrice + totalRange * 1.5).toFixed(2)),
        invalidationLevel: Number((low * 0.99).toFixed(2))
      };
    }
  }
  
  // Shooting Star: Long upper wick, small lower wick, appears after uptrend (potential bearish reversal)
  // Requirements: Upper wick >= 2x body, lower wick <= 0.5x body
  if (upperWick >= body * 2 && lowerWick <= body * 0.5) {
    // Check for prior uptrend (prices were rising)
    const lookback = Math.min(5, idx);
    const priorClose = closes[idx - lookback];
    const isUptrend = priorClose < closes[idx - 1];
    
    if (isUptrend) {
      return {
        name: 'Shooting Star',
        type: 'bearish',
        confidence: 62,
        description: 'Shooting star candlestick at potential resistance - long upper wick shows sellers rejected higher prices',
        priceTarget: Number((currentPrice - totalRange * 1.5).toFixed(2)),
        invalidationLevel: Number((high * 1.01).toFixed(2))
      };
    }
  }
  
  return null;
}

function detectEngulfingPattern(opens: number[], highs: number[], lows: number[], closes: number[], currentPrice: number): ChartPattern | null {
  if (closes.length < 3) return null;
  
  const idx = closes.length - 1;
  const currOpen = opens[idx];
  const currClose = closes[idx];
  const currHigh = highs[idx];
  const currLow = lows[idx];
  const prevOpen = opens[idx - 1];
  const prevClose = closes[idx - 1];
  const prevLow = lows[idx - 1];
  const prevHigh = highs[idx - 1];
  
  const currBody = Math.abs(currClose - currOpen);
  const prevBody = Math.abs(prevClose - prevOpen);
  
  // Bullish Engulfing: Current bullish candle (close > open) engulfs previous bearish candle (close < open)
  const isCurrBullish = currClose > currOpen;
  const isPrevBearish = prevClose < prevOpen;
  
  if (isCurrBullish && isPrevBearish) {
    // Body of current candle must completely contain body of previous candle
    if (currOpen <= prevClose && currClose >= prevOpen && currBody > prevBody * 1.1) {
      return {
        name: 'Bullish Engulfing',
        type: 'bullish',
        confidence: 65,
        description: 'Bullish engulfing - green candle completely engulfs prior red candle, suggesting buyers took control',
        priceTarget: Number((currentPrice + currBody * 1.5).toFixed(2)),
        invalidationLevel: Number((Math.min(currLow, prevLow) * 0.99).toFixed(2))
      };
    }
  }
  
  // Bearish Engulfing: Current bearish candle (close < open) engulfs previous bullish candle (close > open)
  const isCurrBearish = currClose < currOpen;
  const isPrevBullish = prevClose > prevOpen;
  
  if (isCurrBearish && isPrevBullish) {
    // Body of current candle must completely contain body of previous candle
    if (currOpen >= prevClose && currClose <= prevOpen && currBody > prevBody * 1.1) {
      return {
        name: 'Bearish Engulfing',
        type: 'bearish',
        confidence: 65,
        description: 'Bearish engulfing - red candle completely engulfs prior green candle, suggesting sellers took control',
        priceTarget: Number((currentPrice - currBody * 1.5).toFixed(2)),
        invalidationLevel: Number((Math.max(currHigh, prevHigh) * 1.01).toFixed(2))
      };
    }
  }
  
  return null;
}

function detectRSIDivergence(closes: number[], currentPrice: number): ChartPattern | null {
  if (closes.length < 30) return null;
  
  // Calculate RSI values for rolling windows to detect divergence
  // We need at least 15 data points, each requiring 14 prior closes
  const rsiValues: number[] = [];
  for (let i = 14; i < closes.length; i++) {
    const windowCloses = closes.slice(i - 14, i + 1);
    rsiValues.push(calculateRSI(windowCloses, 14));
  }
  
  if (rsiValues.length < 15) return null;
  
  const recentCloses = closes.slice(-15);
  const recentRSI = rsiValues.slice(-15);
  
  const priceSlope = (recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0];
  const rsiSlope = recentRSI[recentRSI.length - 1] - recentRSI[0];
  
  if (priceSlope > 0.03 && rsiSlope < -5) {
    return {
      name: 'Bearish RSI Divergence',
      type: 'bearish',
      confidence: 60,
      description: 'Price making higher highs while RSI making lower highs - momentum weakening, potential reversal',
      priceTarget: Number((currentPrice * 0.95).toFixed(2))
    };
  }
  
  if (priceSlope < -0.03 && rsiSlope > 5) {
    return {
      name: 'Bullish RSI Divergence',
      type: 'bullish',
      confidence: 60,
      description: 'Price making lower lows while RSI making higher lows - momentum building, potential reversal',
      priceTarget: Number((currentPrice * 1.05).toFixed(2))
    };
  }
  
  return null;
}

function detectVolumeTrend(closes: number[], volumes: number[] | undefined, currentPrice: number): ChartPattern | null {
  if (!volumes || volumes.length < 10 || closes.length < 10) return null;
  
  const recentVolumes = volumes.slice(-10);
  const recentCloses = closes.slice(-10);
  
  const avgVolume = recentVolumes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const recentAvg = recentVolumes.slice(-3).reduce((a, b) => a + b, 0) / 3;
  
  const priceChange = (recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0];
  const volumeChange = (recentAvg - avgVolume) / avgVolume;
  
  if (volumeChange > 0.5 && priceChange > 0.02) {
    return {
      name: 'Volume Breakout',
      type: 'bullish',
      confidence: 58,
      description: `Volume surge ${(volumeChange * 100).toFixed(0)}% above average accompanying ${(priceChange * 100).toFixed(1)}% price move`,
      priceTarget: Number((currentPrice * 1.05).toFixed(2))
    };
  }
  
  if (volumeChange > 0.5 && priceChange < -0.02) {
    return {
      name: 'Volume Breakdown',
      type: 'bearish',
      confidence: 58,
      description: `Volume surge ${(volumeChange * 100).toFixed(0)}% above average accompanying ${(priceChange * 100).toFixed(1)}% price drop`,
      priceTarget: Number((currentPrice * 0.95).toFixed(2))
    };
  }
  
  return null;
}

export function detectChartPatterns(ohlc: OHLCData, currentPrice: number): ChartPattern[] {
  const patterns: ChartPattern[] = [];
  
  // Classic chart patterns
  const doubleTop = detectDoubleTop(ohlc.highs, ohlc.closes, currentPrice);
  if (doubleTop) patterns.push(doubleTop);
  
  const doubleBottom = detectDoubleBottom(ohlc.lows, ohlc.closes, currentPrice);
  if (doubleBottom) patterns.push(doubleBottom);
  
  const headShoulders = detectHeadAndShoulders(ohlc.highs, ohlc.lows, ohlc.closes, currentPrice);
  if (headShoulders) patterns.push(headShoulders);
  
  const bullFlag = detectBullFlag(ohlc.highs, ohlc.lows, ohlc.closes, currentPrice);
  if (bullFlag) patterns.push(bullFlag);
  
  const ascTriangle = detectAscendingTriangle(ohlc.highs, ohlc.lows, ohlc.closes, currentPrice);
  if (ascTriangle) patterns.push(ascTriangle);
  
  const descTriangle = detectDescendingTriangle(ohlc.highs, ohlc.lows, ohlc.closes, currentPrice);
  if (descTriangle) patterns.push(descTriangle);
  
  const channel = detectChannel(ohlc.highs, ohlc.lows, ohlc.closes);
  if (channel) patterns.push(channel);
  
  // Wedge patterns
  const risingWedge = detectRisingWedge(ohlc.highs, ohlc.lows, ohlc.closes, currentPrice);
  if (risingWedge) patterns.push(risingWedge);
  
  const fallingWedge = detectFallingWedge(ohlc.highs, ohlc.lows, ohlc.closes, currentPrice);
  if (fallingWedge) patterns.push(fallingWedge);
  
  // Cup and handle
  const cupHandle = detectCupAndHandle(ohlc.highs, ohlc.lows, ohlc.closes, currentPrice);
  if (cupHandle) patterns.push(cupHandle);
  
  // Candlestick patterns
  const hammer = detectHammerPattern(ohlc.opens, ohlc.highs, ohlc.lows, ohlc.closes, currentPrice);
  if (hammer) patterns.push(hammer);
  
  const engulfing = detectEngulfingPattern(ohlc.opens, ohlc.highs, ohlc.lows, ohlc.closes, currentPrice);
  if (engulfing) patterns.push(engulfing);
  
  // Momentum divergences
  const rsiDiv = detectRSIDivergence(ohlc.closes, currentPrice);
  if (rsiDiv) patterns.push(rsiDiv);
  
  return patterns.sort((a, b) => b.confidence - a.confidence);
}

function determineTrendDirection(ohlc: OHLCData): { direction: 'bullish' | 'bearish' | 'sideways'; strength: number } {
  const closes = ohlc.closes;
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const sma200 = calculateSMA(closes, Math.min(200, closes.length));
  
  const currentPrice = closes[closes.length - 1];
  
  let bullishPoints = 0;
  let bearishPoints = 0;
  
  if (currentPrice > sma20) bullishPoints += 1; else bearishPoints += 1;
  if (currentPrice > sma50) bullishPoints += 2; else bearishPoints += 2;
  if (currentPrice > sma200) bullishPoints += 3; else bearishPoints += 3;
  if (sma20 > sma50) bullishPoints += 1; else bearishPoints += 1;
  if (sma50 > sma200) bullishPoints += 2; else bearishPoints += 2;
  
  const recentChange = (currentPrice - closes[Math.max(0, closes.length - 10)]) / closes[Math.max(0, closes.length - 10)];
  if (recentChange > 0.02) bullishPoints += 2;
  else if (recentChange < -0.02) bearishPoints += 2;
  
  const total = bullishPoints + bearishPoints;
  const strength = Math.abs(bullishPoints - bearishPoints) / total * 100;
  
  if (bullishPoints > bearishPoints + 2) {
    return { direction: 'bullish', strength };
  } else if (bearishPoints > bullishPoints + 2) {
    return { direction: 'bearish', strength };
  }
  
  return { direction: 'sideways', strength };
}

export async function analyzeChart(
  symbol: string,
  assetType: string,
  currentPrice: number
): Promise<ChartAnalysisResult | null> {
  const ohlc = await fetchOHLCData(symbol, assetType, 60);
  
  if (!ohlc) {
    logger.warn(`[CHART] Cannot analyze ${symbol} - insufficient data`);
    return null;
  }
  
  const patterns = detectChartPatterns(ohlc, currentPrice);
  const { support, resistance } = detectSupportResistance(ohlc, currentPrice);
  const { direction: trendDirection, strength: trendStrength } = determineTrendDirection(ohlc);
  
  const sma50 = calculateSMA(ohlc.closes, 50);
  const sma200 = calculateSMA(ohlc.closes, Math.min(200, ohlc.closes.length));
  
  const nearestSupport = support.length > 0 ? support[0].price : null;
  const nearestResistance = resistance.length > 0 ? resistance[0].price : null;
  
  const validation = validateTradeSetup(
    currentPrice,
    patterns,
    support,
    resistance,
    trendDirection,
    sma50,
    sma200
  );
  
  return {
    symbol,
    assetType,
    currentPrice,
    patterns,
    supportLevels: support,
    resistanceLevels: resistance,
    trendDirection,
    trendStrength,
    keyLevels: {
      nearestSupport,
      nearestResistance,
      sma50: Number(sma50.toFixed(2)),
      sma200: Number(sma200.toFixed(2))
    },
    validation,
    analysisTimestamp: new Date().toISOString()
  };
}

function validateTradeSetup(
  currentPrice: number,
  patterns: ChartPattern[],
  support: SupportResistanceLevel[],
  resistance: SupportResistanceLevel[],
  trendDirection: string,
  sma50: number,
  sma200: number
): { isValidSetup: boolean; confidence: number; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let confidence = 50;
  
  if (currentPrice > sma200) {
    reasons.push('Price above 200-day MA (long-term uptrend)');
    confidence += 10;
  } else {
    warnings.push('Price below 200-day MA (long-term downtrend)');
    confidence -= 5;
  }
  
  if (currentPrice > sma50) {
    reasons.push('Price above 50-day MA (intermediate uptrend)');
    confidence += 5;
  } else {
    warnings.push('Price below 50-day MA (intermediate weakness)');
  }
  
  const bullishPatterns = patterns.filter(p => p.type === 'bullish');
  const bearishPatterns = patterns.filter(p => p.type === 'bearish');
  
  if (bullishPatterns.length > 0) {
    const bestPattern = bullishPatterns[0];
    reasons.push(`Bullish pattern: ${bestPattern.name} (${bestPattern.confidence.toFixed(0)}% confidence)`);
    confidence += Math.min(bestPattern.confidence / 5, 15);
  }
  
  if (bearishPatterns.length > 0) {
    const worstPattern = bearishPatterns[0];
    warnings.push(`Bearish pattern: ${worstPattern.name} detected`);
    confidence -= 10;
  }
  
  const strongSupport = support.filter(s => s.strength === 'strong');
  if (strongSupport.length > 0) {
    const nearest = strongSupport[0];
    const distanceToSupport = (currentPrice - nearest.price) / currentPrice;
    if (distanceToSupport < 0.03) {
      reasons.push(`Near strong support at $${nearest.price.toFixed(2)}`);
      confidence += 10;
    }
  }
  
  const strongResistance = resistance.filter(r => r.strength === 'strong');
  if (strongResistance.length > 0) {
    const nearest = strongResistance[0];
    const distanceToResistance = (nearest.price - currentPrice) / currentPrice;
    if (distanceToResistance < 0.02) {
      warnings.push(`Near strong resistance at $${nearest.price.toFixed(2)} - potential rejection`);
      confidence -= 10;
    }
  }
  
  if (trendDirection === 'bullish') {
    reasons.push('Overall trend is bullish');
    confidence += 5;
  } else if (trendDirection === 'bearish') {
    warnings.push('Overall trend is bearish');
    confidence -= 5;
  }
  
  confidence = Math.max(0, Math.min(100, confidence));
  
  const isValidSetup = confidence >= 55 && warnings.length <= 2;
  
  return { isValidSetup, confidence, reasons, warnings };
}

export async function validateTradeWithChart(
  symbol: string,
  assetType: string,
  direction: 'long' | 'short',
  entryPrice: number,
  targetPrice: number,
  stopLoss: number
): Promise<{
  isValid: boolean;
  chartAnalysis: ChartAnalysisResult | null;
  adjustedEntry?: number;
  adjustedTarget?: number;
  adjustedStop?: number;
  validationNotes: string[];
}> {
  const validationNotes: string[] = [];
  
  const analysis = await analyzeChart(symbol, assetType, entryPrice);
  
  if (!analysis) {
    validationNotes.push('Unable to fetch chart data for validation');
    return { isValid: true, chartAnalysis: null, validationNotes };
  }
  
  let isValid = analysis.validation.isValidSetup;
  let adjustedEntry = entryPrice;
  let adjustedTarget = targetPrice;
  let adjustedStop = stopLoss;
  
  if (direction === 'long') {
    const bullishPatterns = analysis.patterns.filter(p => p.type === 'bullish');
    const bearishPatterns = analysis.patterns.filter(p => p.type === 'bearish');
    
    if (bearishPatterns.length > 0 && bearishPatterns[0].confidence > 75) {
      isValid = false;
      validationNotes.push(`REJECTED: Strong bearish pattern (${bearishPatterns[0].name}) conflicts with LONG direction`);
    }
    
    if (bullishPatterns.length > 0 && bullishPatterns[0].priceTarget) {
      const patternTarget = bullishPatterns[0].priceTarget;
      if (patternTarget > targetPrice) {
        adjustedTarget = patternTarget;
        validationNotes.push(`Target adjusted to pattern target: $${patternTarget.toFixed(2)}`);
      }
    }
    
    if (analysis.supportLevels.length > 0) {
      const nearestSupport = analysis.supportLevels[0].price;
      if (nearestSupport > stopLoss && nearestSupport < entryPrice) {
        adjustedStop = nearestSupport * 0.99;
        validationNotes.push(`Stop adjusted to below support: $${adjustedStop.toFixed(2)}`);
      }
    }
    
    if (analysis.resistanceLevels.length > 0) {
      const nearestResistance = analysis.resistanceLevels[0].price;
      if (nearestResistance < targetPrice && nearestResistance > entryPrice) {
        validationNotes.push(`Warning: Resistance at $${nearestResistance.toFixed(2)} before target`);
      }
    }
  } else {
    const bearishPatterns = analysis.patterns.filter(p => p.type === 'bearish');
    const bullishPatterns = analysis.patterns.filter(p => p.type === 'bullish');
    
    if (bullishPatterns.length > 0 && bullishPatterns[0].confidence > 75) {
      isValid = false;
      validationNotes.push(`REJECTED: Strong bullish pattern (${bullishPatterns[0].name}) conflicts with SHORT direction`);
    }
    
    if (bearishPatterns.length > 0 && bearishPatterns[0].priceTarget) {
      const patternTarget = bearishPatterns[0].priceTarget;
      if (patternTarget < targetPrice) {
        adjustedTarget = patternTarget;
        validationNotes.push(`Target adjusted to pattern target: $${patternTarget.toFixed(2)}`);
      }
    }
  }
  
  validationNotes.push(...analysis.validation.reasons);
  validationNotes.push(...analysis.validation.warnings.map(w => `⚠️ ${w}`));
  
  return {
    isValid,
    chartAnalysis: analysis,
    adjustedEntry,
    adjustedTarget,
    adjustedStop,
    validationNotes
  };
}
