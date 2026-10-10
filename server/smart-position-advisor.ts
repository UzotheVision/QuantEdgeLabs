import { logger } from "./logger";
import { fetchStockPrice, fetchHistoricalPrices } from "./market-api";
import { getRealtimeQuote } from "./realtime-pricing-service";

export interface PositionInput {
  symbol: string;
  optionType?: 'call' | 'put';
  strikePrice?: number;
  expiryDate?: string;
  entryPrice: number;
  quantity: number;
  assetType: 'stock' | 'option' | 'crypto';
}

export interface ExitSignal {
  action: 'SELL_NOW' | 'SELL_PARTIAL' | 'HOLD' | 'TRAIL_STOP';
  urgency: 'critical' | 'high' | 'moderate' | 'low';
  reason: string;
  confidence: number;
}

export interface RebuySignal {
  shouldRebuy: boolean;
  rebuyZone: { low: number; high: number };
  optimalEntry: number;
  suggestedContract?: {
    strike: number;
    expiry: string;
    estimatedPremium: number;
    reasoning: string;
  };
  confidence: number;
  waitForSignals: string[];
}

export interface SmartAdvisory {
  symbol: string;
  currentPrice: number;
  entryPrice: number;
  currentPnL: number;
  currentPnLPercent: number;
  
  exitSignal: ExitSignal;
  targetFills: {
    conservative: number;
    moderate: number;
    aggressive: number;
  };
  
  rebuySignal: RebuySignal;
  
  technicalSnapshot: {
    rsi2: number;
    rsi14: number;
    trend: 'bullish' | 'bearish' | 'neutral';
    support: number;
    resistance: number;
    isOverbought: boolean;
    isOversold: boolean;
  };
  
  optionMetrics?: {
    dte: number;
    thetaDecay: 'critical' | 'high' | 'moderate' | 'low';
    intrinsicValue: number;
    timeValue: number;
    breakeven: number;
  };
  
  actionPlan: string[];
  timestamp: string;
}

const priceCache = new Map<string, { price: number; timestamp: number }>();
const CACHE_TTL = 15000;

async function getPrice(symbol: string): Promise<number | null> {
  const cached = priceCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price;
  }
  
  try {
    const quote = await getRealtimeQuote(symbol, 'stock');
    if (quote?.price) {
      priceCache.set(symbol, { price: quote.price, timestamp: Date.now() });
      return quote.price;
    }
  } catch (e) {}
  
  try {
    const data = await fetchStockPrice(symbol);
    if (data?.currentPrice) {
      priceCache.set(symbol, { price: data.currentPrice, timestamp: Date.now() });
      return data.currentPrice;
    }
  } catch (e) {}
  
  return null;
}

function calculateRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function findSupportResistance(prices: number[]): { support: number; resistance: number } {
  if (prices.length < 5) {
    const current = prices[prices.length - 1] || 100;
    return { support: current * 0.97, resistance: current * 1.03 };
  }
  
  const recentPrices = prices.slice(-20);
  const low = Math.min(...recentPrices);
  const high = Math.max(...recentPrices);
  
  return {
    support: low,
    resistance: high
  };
}

function calculateDTE(expiryDate?: string): number {
  if (!expiryDate) return 999;
  const expiry = new Date(expiryDate);
  const now = new Date();
  return Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

function getThetaUrgency(dte: number): 'critical' | 'high' | 'moderate' | 'low' {
  if (dte <= 2) return 'critical';
  if (dte <= 5) return 'high';
  if (dte <= 14) return 'moderate';
  return 'low';
}

export async function getSmartAdvisory(position: PositionInput): Promise<SmartAdvisory | null> {
  try {
    const currentPrice = await getPrice(position.symbol);
    if (!currentPrice) {
      logger.error("Could not fetch price for smart advisory", { symbol: position.symbol });
      return null;
    }
    
    let historicalPrices: number[] = [];
    try {
      const assetTypeForFetch = position.assetType === 'option' ? 'stock' : position.assetType;
      const historical = await fetchHistoricalPrices(position.symbol, assetTypeForFetch as any, 30);
      if (historical && historical.length > 0) {
        historicalPrices = historical.map((p: any) => typeof p === 'number' ? p : p.close || p.price || p).filter(Boolean);
      }
    } catch (e) {
      historicalPrices = [currentPrice * 0.95, currentPrice * 0.97, currentPrice * 0.99, currentPrice];
    }
    
    const rsi2 = calculateRSI(historicalPrices, 2);
    const rsi14 = calculateRSI(historicalPrices, 14);
    const { support, resistance } = findSupportResistance(historicalPrices);
    
    const isOverbought = rsi2 > 90 || rsi14 > 70;
    const isOversold = rsi2 < 10 || rsi14 < 30;
    
    const pnl = (currentPrice - position.entryPrice) * position.quantity;
    const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    const trend = rsi14 > 55 ? 'bullish' : rsi14 < 45 ? 'bearish' : 'neutral';
    
    let exitSignal: ExitSignal;
    
    if (isOverbought && pnlPercent > 50) {
      exitSignal = {
        action: 'SELL_NOW',
        urgency: 'high',
        reason: `RSI(2) at ${rsi2.toFixed(0)} = extremely overbought. You're up ${pnlPercent.toFixed(0)}%. Lock in profits!`,
        confidence: 85
      };
    } else if (isOverbought && pnlPercent > 20) {
      exitSignal = {
        action: 'SELL_PARTIAL',
        urgency: 'moderate',
        reason: `RSI(2) at ${rsi2.toFixed(0)} = overbought. Consider selling 50% to lock in ${pnlPercent.toFixed(0)}% gain.`,
        confidence: 75
      };
    } else if (pnlPercent > 100) {
      exitSignal = {
        action: 'TRAIL_STOP',
        urgency: 'moderate',
        reason: `You're up ${pnlPercent.toFixed(0)}%! Set a trailing stop to protect gains.`,
        confidence: 80
      };
    } else if (pnlPercent < -30) {
      exitSignal = {
        action: 'SELL_NOW',
        urgency: 'high',
        reason: `Down ${Math.abs(pnlPercent).toFixed(0)}%. Cut losses before they grow.`,
        confidence: 70
      };
    } else {
      exitSignal = {
        action: 'HOLD',
        urgency: 'low',
        reason: `Position is ${pnlPercent >= 0 ? 'up' : 'down'} ${Math.abs(pnlPercent).toFixed(1)}%. No urgent exit signals.`,
        confidence: 60
      };
    }
    
    const targetFills = {
      conservative: currentPrice * 1.02,
      moderate: currentPrice * 1.05,
      aggressive: resistance * 1.02
    };
    
    const rebuyZone = {
      low: support * 0.99,
      high: support * 1.02
    };
    
    const optimalRebuyEntry = (rebuyZone.low + rebuyZone.high) / 2;
    
    const rebuySignal: RebuySignal = {
      shouldRebuy: isOversold || (pnlPercent > 50 && rsi2 < 30),
      rebuyZone,
      optimalEntry: optimalRebuyEntry,
      confidence: isOversold ? 80 : 50,
      waitForSignals: isOversold 
        ? ['RSI(2) < 10', 'Price at support', 'Volume spike']
        : ['Wait for pullback to support', `Target zone: $${rebuyZone.low.toFixed(2)} - $${rebuyZone.high.toFixed(2)}`]
    };
    
    if (position.assetType === 'option' && position.strikePrice) {
      const dte = calculateDTE(position.expiryDate);
      const nextFriday = new Date();
      nextFriday.setDate(nextFriday.getDate() + ((5 - nextFriday.getDay() + 7) % 7) + 7);
      const suggestedExpiry = nextFriday.toISOString().split('T')[0];
      
      const atmStrike = Math.round(optimalRebuyEntry / 5) * 5;
      
      rebuySignal.suggestedContract = {
        strike: atmStrike,
        expiry: suggestedExpiry,
        estimatedPremium: atmStrike * 0.03,
        reasoning: `ATM ${position.optionType || 'call'} with 2 weeks of time. Lower theta decay risk.`
      };
    }
    
    const actionPlan: string[] = [];
    
    if (exitSignal.action === 'SELL_NOW') {
      actionPlan.push(`🔴 SELL: Exit at market or limit ${targetFills.conservative.toFixed(2)}`);
    } else if (exitSignal.action === 'SELL_PARTIAL') {
      actionPlan.push(`🟡 PARTIAL EXIT: Sell 50% at ${targetFills.conservative.toFixed(2)}`);
      actionPlan.push(`🟢 TRAIL: Set stop at breakeven ($${position.entryPrice.toFixed(2)}) on remaining`);
    } else if (exitSignal.action === 'TRAIL_STOP') {
      actionPlan.push(`🟢 TRAILING STOP: Set at $${(currentPrice * 0.95).toFixed(2)} (5% below current)`);
    }
    
    if (rebuySignal.shouldRebuy) {
      actionPlan.push(`📍 REBUY ZONE: $${rebuyZone.low.toFixed(2)} - $${rebuyZone.high.toFixed(2)}`);
    } else {
      actionPlan.push(`⏳ WAIT: Pullback to $${rebuyZone.high.toFixed(2)} before re-entry`);
    }
    
    let optionMetrics;
    if (position.assetType === 'option' && position.strikePrice) {
      const dte = calculateDTE(position.expiryDate);
      const intrinsic = Math.max(0, 
        position.optionType === 'call' 
          ? currentPrice - position.strikePrice 
          : position.strikePrice - currentPrice
      );
      const timeValue = Math.max(0, position.entryPrice - intrinsic);
      
      optionMetrics = {
        dte,
        thetaDecay: getThetaUrgency(dte),
        intrinsicValue: intrinsic,
        timeValue: timeValue,
        breakeven: position.optionType === 'call' 
          ? position.strikePrice + position.entryPrice
          : position.strikePrice - position.entryPrice
      };
      
      if (dte <= 2) {
        actionPlan.unshift(`⚠️ THETA CRITICAL: Only ${dte} DTE - exit or roll ASAP!`);
      } else if (dte <= 5) {
        actionPlan.unshift(`⏰ THETA WARNING: ${dte} DTE - time decay accelerating`);
      }
    }
    
    return {
      symbol: position.symbol,
      currentPrice,
      entryPrice: position.entryPrice,
      currentPnL: pnl,
      currentPnLPercent: pnlPercent,
      exitSignal,
      targetFills,
      rebuySignal,
      technicalSnapshot: {
        rsi2,
        rsi14,
        trend,
        support,
        resistance,
        isOverbought,
        isOversold
      },
      optionMetrics,
      actionPlan,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    logger.error("Error generating smart advisory", { error, position });
    return null;
  }
}

export async function getQuickRebuyAdvice(
  symbol: string, 
  previousEntry: number,
  assetType: 'stock' | 'option' = 'stock'
): Promise<{
  currentPrice: number;
  isGoodEntry: boolean;
  rebuyZone: { low: number; high: number };
  suggestedAction: string;
  confidence: number;
} | null> {
  try {
    const currentPrice = await getPrice(symbol);
    if (!currentPrice) return null;
    
    let historicalPrices: number[] = [];
    try {
      const historical = await fetchHistoricalPrices(symbol, assetType as any, 30);
      if (historical && historical.length > 0) {
        historicalPrices = historical.map((p: any) => typeof p === 'number' ? p : p.close || p.price || p).filter(Boolean);
      }
    } catch (e) {
      historicalPrices = [currentPrice];
    }
    
    const rsi2 = calculateRSI(historicalPrices, 2);
    const { support, resistance } = findSupportResistance(historicalPrices);
    
    const isNearSupport = currentPrice <= support * 1.02;
    const isOversold = rsi2 < 20;
    const isBelowPreviousEntry = currentPrice < previousEntry;
    
    const isGoodEntry = (isNearSupport || isOversold) && isBelowPreviousEntry;
    
    let suggestedAction: string;
    let confidence: number;
    
    if (isOversold && isNearSupport) {
      suggestedAction = `Strong rebuy signal! RSI(2) at ${rsi2.toFixed(0)} and at support $${support.toFixed(2)}`;
      confidence = 85;
    } else if (isOversold) {
      suggestedAction = `RSI(2) oversold at ${rsi2.toFixed(0)} - consider scaling in`;
      confidence = 70;
    } else if (isNearSupport) {
      suggestedAction = `At support level $${support.toFixed(2)} - watch for bounce confirmation`;
      confidence = 65;
    } else if (isBelowPreviousEntry) {
      suggestedAction = `Below your previous entry ($${previousEntry.toFixed(2)}) but wait for oversold signal`;
      confidence = 50;
    } else {
      suggestedAction = `Wait for pullback. Target zone: $${support.toFixed(2)} - $${(support * 1.02).toFixed(2)}`;
      confidence = 40;
    }
    
    return {
      currentPrice,
      isGoodEntry,
      rebuyZone: { low: support * 0.99, high: support * 1.02 },
      suggestedAction,
      confidence
    };
    
  } catch (error) {
    logger.error("Error getting quick rebuy advice", { error, symbol });
    return null;
  }
}
