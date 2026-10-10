import { logger } from "./logger";
import { shouldAllowSessionEntry, getTradingSession, checkUnifiedEntryGate } from "./market-context-service";

export interface DayTradeOpportunity {
  symbol: string;
  name?: string;
  currentPrice: number;
  vwap: number;
  vwapDistance: number;
  rsi2: number;
  momentum5m: number;
  volumeSpike: number;
  direction: 'long' | 'short';
  pattern: string;
  entry: number;
  target: number;
  targetPercent: number;
  stopLoss: number;
  stopPercent: number;
  riskReward: number;
  confidence: number;
  signals: string[];
  timeframe: string;
  createdAt: Date;
}

const DAYTRADE_TICKERS = [
  'SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'META',
  'GOOGL', 'COIN', 'MARA', 'RIOT', 'MSTR', 'SMCI', 'ARM', 'AVGO', 'MU', 'TSM',
  'PLTR', 'SOFI', 'HOOD', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI',
  'SOXL', 'TQQQ', 'SQQQ', 'UVXY', 'VIX',
  'XLF', 'XLE', 'XLK', 'XBI', 'ARKK',
  'GME', 'AMC', 'BBBY', 'MEME',
  'GLD', 'SLV', 'USO', 'UNG',
  'BA', 'DIS', 'NFLX', 'UBER', 'ABNB'
];

const intradayCache = new Map<string, { data: any; timestamp: Date }>();
const CACHE_TTL = 5 * 60 * 1000;

async function fetchIntradayData(symbol: string): Promise<any> {
  const cached = intradayCache.get(symbol);
  if (cached && (Date.now() - cached.timestamp.getTime()) < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=1d`
    );
    
    if (!response.ok) {
      logger.warn(`[DAYTRADE] Failed to fetch intraday data for ${symbol}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (result) {
      intradayCache.set(symbol, { data: result, timestamp: new Date() });
    }
    
    return result;
  } catch (error) {
    logger.error(`[DAYTRADE] Error fetching ${symbol}:`, error);
    return null;
  }
}

function calculateRSI2(closes: number[]): number {
  if (closes.length < 3) return 50;
  
  const period = 2;
  let gains = 0;
  let losses = 0;
  
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateVWAP(highs: number[], lows: number[], closes: number[], volumes: number[]): number {
  if (highs.length === 0 || volumes.length === 0) return closes[closes.length - 1] || 0;
  
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (let i = 0; i < highs.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    const vol = volumes[i] || 0;
    cumulativeTPV += typicalPrice * vol;
    cumulativeVolume += vol;
  }
  
  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : closes[closes.length - 1];
}

function calculateMomentum(closes: number[], periods: number): number {
  if (closes.length < periods + 1) return 0;
  const current = closes[closes.length - 1];
  const past = closes[closes.length - 1 - periods];
  return ((current - past) / past) * 100;
}

function detectDayTradePattern(
  closes: number[], 
  vwap: number, 
  rsi2: number,
  volumeSpike: number
): { pattern: string; direction: 'long' | 'short'; signals: string[] } {
  const current = closes[closes.length - 1];
  const signals: string[] = [];
  
  const aboveVWAP = current > vwap;
  const vwapDist = ((current - vwap) / vwap) * 100;
  
  if (rsi2 < 10) {
    signals.push('RSI(2) Extreme Oversold');
    if (aboveVWAP || vwapDist > -0.5) {
      return { pattern: 'RSI2 Mean Reversion Long', direction: 'long', signals };
    }
  }
  
  if (rsi2 > 90) {
    signals.push('RSI(2) Extreme Overbought');
    if (!aboveVWAP || vwapDist < 0.5) {
      return { pattern: 'RSI2 Mean Reversion Short', direction: 'short', signals };
    }
  }
  
  if (aboveVWAP && volumeSpike > 2.0) {
    signals.push('Above VWAP');
    signals.push('Volume Surge');
    if (rsi2 < 70) {
      return { pattern: 'VWAP Breakout Long', direction: 'long', signals };
    }
  }
  
  if (!aboveVWAP && volumeSpike > 2.0) {
    signals.push('Below VWAP');
    signals.push('Volume Surge');
    if (rsi2 > 30) {
      return { pattern: 'VWAP Breakdown Short', direction: 'short', signals };
    }
  }
  
  if (rsi2 < 20 && volumeSpike > 1.5) {
    signals.push('Oversold + Volume');
    return { pattern: 'Volume Capitulation Long', direction: 'long', signals };
  }
  
  if (rsi2 > 80 && volumeSpike > 1.5) {
    signals.push('Overbought + Volume');
    return { pattern: 'Climax Top Short', direction: 'short', signals };
  }
  
  const recentCloses = closes.slice(-10);
  const momentum = calculateMomentum(closes, 5);
  
  if (momentum > 1.5 && aboveVWAP) {
    signals.push('Strong Momentum');
    signals.push('Above VWAP');
    return { pattern: 'Momentum Continuation Long', direction: 'long', signals };
  }
  
  if (momentum < -1.5 && !aboveVWAP) {
    signals.push('Bearish Momentum');
    signals.push('Below VWAP');
    return { pattern: 'Momentum Continuation Short', direction: 'short', signals };
  }
  
  return { pattern: 'No Clear Setup', direction: 'long', signals: [] };
}

function scoreDayTrade(
  rsi2: number,
  vwapDistance: number,
  volumeSpike: number,
  direction: 'long' | 'short',
  signalCount: number
): number {
  let score = 40;
  
  if (direction === 'long') {
    if (rsi2 < 10) score += 25;
    else if (rsi2 < 20) score += 20;
    else if (rsi2 < 30) score += 10;
    
    if (vwapDistance > 0 && vwapDistance < 1) score += 10;
    else if (vwapDistance < 0 && vwapDistance > -0.5) score += 15;
  } else {
    if (rsi2 > 90) score += 25;
    else if (rsi2 > 80) score += 20;
    else if (rsi2 > 70) score += 10;
    
    if (vwapDistance < 0 && vwapDistance > -1) score += 10;
    else if (vwapDistance > 0 && vwapDistance < 0.5) score += 15;
  }
  
  if (volumeSpike > 3) score += 15;
  else if (volumeSpike > 2) score += 10;
  else if (volumeSpike > 1.5) score += 5;
  
  score += signalCount * 3;
  
  return Math.min(100, Math.max(0, score));
}

async function analyzeTicker(symbol: string): Promise<DayTradeOpportunity | null> {
  try {
    const data = await fetchIntradayData(symbol);
    if (!data || !data.indicators?.quote?.[0]) return null;
    
    const quote = data.indicators.quote[0];
    const closes = (quote.close || []).filter((c: any) => c !== null);
    const highs = (quote.high || []).filter((h: any) => h !== null);
    const lows = (quote.low || []).filter((l: any) => l !== null);
    const volumes = (quote.volume || []).filter((v: any) => v !== null);
    
    if (closes.length < 10) return null;
    
    const currentPrice = closes[closes.length - 1];
    const rsi2 = calculateRSI2(closes);
    const vwap = calculateVWAP(highs, lows, closes, volumes);
    const vwapDistance = ((currentPrice - vwap) / vwap) * 100;
    
    const avgVolume = volumes.slice(0, Math.max(1, volumes.length - 5)).reduce((s: number, v: number) => s + v, 0) / 
                      Math.max(1, volumes.length - 5);
    const recentVolume = volumes.slice(-5).reduce((s: number, v: number) => s + v, 0) / 5;
    const volumeSpike = avgVolume > 0 ? recentVolume / avgVolume : 1;
    
    const momentum5m = calculateMomentum(closes, Math.min(5, closes.length - 1));
    
    const { pattern, direction, signals } = detectDayTradePattern(closes, vwap, rsi2, volumeSpike);
    
    if (pattern === 'No Clear Setup' || signals.length === 0) {
      return null;
    }
    
    const confidence = scoreDayTrade(rsi2, vwapDistance, volumeSpike, direction, signals.length);
    
    if (confidence < 55) {
      return null;
    }
    
    let entry: number, target: number, stopLoss: number;
    
    if (direction === 'long') {
      entry = currentPrice;
      const atr = Math.max(...highs.slice(-10)) - Math.min(...lows.slice(-10));
      const atrPercent = (atr / currentPrice) * 100;
      
      target = currentPrice * (1 + Math.min(2, Math.max(0.5, atrPercent * 0.5)) / 100);
      stopLoss = currentPrice * (1 - Math.min(1.5, Math.max(0.3, atrPercent * 0.3)) / 100);
    } else {
      entry = currentPrice;
      const atr = Math.max(...highs.slice(-10)) - Math.min(...lows.slice(-10));
      const atrPercent = (atr / currentPrice) * 100;
      
      target = currentPrice * (1 - Math.min(2, Math.max(0.5, atrPercent * 0.5)) / 100);
      stopLoss = currentPrice * (1 + Math.min(1.5, Math.max(0.3, atrPercent * 0.3)) / 100);
    }
    
    const targetPercent = Math.abs((target - entry) / entry) * 100;
    const stopPercent = Math.abs((stopLoss - entry) / entry) * 100;
    const riskReward = stopPercent > 0 ? targetPercent / stopPercent : 1;
    
    if (riskReward < 1.5) {
      return null;
    }
    
    return {
      symbol,
      name: data.meta?.shortName || symbol,
      currentPrice,
      vwap,
      vwapDistance,
      rsi2,
      momentum5m,
      volumeSpike,
      direction,
      pattern,
      entry,
      target,
      targetPercent,
      stopLoss,
      stopPercent,
      riskReward,
      confidence,
      signals,
      timeframe: '5m',
      createdAt: new Date()
    };
  } catch (error) {
    logger.error(`[DAYTRADE] Error analyzing ${symbol}:`, error);
    return null;
  }
}

export async function getDayTradeOpportunities(limit: number = 15): Promise<DayTradeOpportunity[]> {
  // 🎯 SESSION GATING - Check if current session is favorable for day trading
  const sessionCheck = shouldAllowSessionEntry('daytrade');
  const currentSession = getTradingSession();
  logger.info(`[DAYTRADE] Session: ${currentSession} | Allowed: ${sessionCheck.allowed} | Confidence multiplier: ${sessionCheck.confidenceMultiplier.toFixed(2)}x`);
  
  // 🛑 BLOCK: If session is not allowed for day trading, return empty array
  if (!sessionCheck.allowed) {
    logger.info(`[DAYTRADE] ⛔ SESSION BLOCKED: ${sessionCheck.reason}`);
    return []; // Don't scan during unfavorable sessions
  }
  
  logger.info(`[DAYTRADE] Scanning ${DAYTRADE_TICKERS.length} tickers for day trade setups...`);
  
  const opportunities: DayTradeOpportunity[] = [];
  
  const batchSize = 10;
  for (let i = 0; i < DAYTRADE_TICKERS.length; i += batchSize) {
    const batch = DAYTRADE_TICKERS.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(symbol => analyzeTicker(symbol)));
    
    for (const result of results) {
      if (result) {
        // 🎯 APPLY SESSION CONFIDENCE MULTIPLIER - boost/reduce based on session quality
        const adjustedConfidence = Math.round(result.confidence * sessionCheck.confidenceMultiplier);
        
        // 🎯 UNIFIED ENTRY GATE - Check regime, exhaustion, and session factors
        const entryGate = await checkUnifiedEntryGate('daytrade', adjustedConfidence);
        if (!entryGate.allowed) {
          logger.debug(`[DAYTRADE] ⛔ GATE BLOCKED ${result.symbol}: ${entryGate.reasons?.join("; ")}`);
          continue; // Skip this opportunity
        }
        
        // Use the final adjusted confidence from unified gate
        opportunities.push({
          ...result,
          confidence: entryGate.adjustedConfidence,
          // Keep original ATR-based stops/targets from analyzeTicker (already ATR-adjusted)
          // No further modification needed - analyzeTicker already calculates proper ATR-based levels
        });
      }
    }
    
    if (i + batchSize < DAYTRADE_TICKERS.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  opportunities.sort((a, b) => b.confidence - a.confidence);
  
  const topOpportunities = opportunities.slice(0, limit);
  
  logger.info(`[DAYTRADE] Found ${opportunities.length} setups, returning top ${topOpportunities.length} (session multiplier: ${sessionCheck.confidenceMultiplier.toFixed(2)}x)`);
  
  return topOpportunities;
}
