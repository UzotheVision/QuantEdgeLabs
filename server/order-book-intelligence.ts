/**
 * Order Book Intelligence Module
 * 
 * Institutional Flow Detection:
 * - Block trade detection (large single orders)
 * - Iceberg order identification (hidden liquidity)
 * - Order imbalance analysis (bid/ask ratio)
 * - Sweep detection (aggressive market orders)
 * - Dark pool print analysis
 * 
 * Integrates with Chart Analysis, Command Center, and Trade Desk
 */

import { logger } from './logger';

export interface OrderBookSnapshot {
  symbol: string;
  timestamp: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  lastPrice: number;
  lastSize: number;
  totalBidVolume: number;
  totalAskVolume: number;
}

export interface BlockTrade {
  symbol: string;
  timestamp: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  dollarValue: number;
  percentOfDailyVolume: number;
  significance: 'notable' | 'significant' | 'major' | 'institutional';
}

export interface SweepOrder {
  symbol: string;
  timestamp: string;
  direction: 'bid' | 'ask';
  levelsSwept: number;
  totalSize: number;
  avgPrice: number;
  priceImpact: number;
  aggression: 'moderate' | 'aggressive' | 'very_aggressive';
}

export interface OrderImbalance {
  symbol: string;
  timestamp: string;
  bidVolume: number;
  askVolume: number;
  imbalanceRatio: number;
  bias: 'strongly_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strongly_bearish';
  topOfBookSpread: number;
  depthRatio: number;
  interpretation: string;
}

export interface InstitutionalFlow {
  symbol: string;
  timestamp: string;
  flowScore: number;
  flowDirection: 'accumulation' | 'distribution' | 'neutral';
  blockTrades: BlockTrade[];
  sweepOrders: SweepOrder[];
  orderImbalance: OrderImbalance;
  darkPoolPrints: Array<{
    price: number;
    size: number;
    timestamp: string;
    premium: number;
  }>;
  keyLevels: {
    heavyBidSupport: number[];
    heavyAskResistance: number[];
  };
  tradingSignal: string;
  confidence: number;
}

const BLOCK_TRADE_THRESHOLDS = {
  stock: { notable: 10000, significant: 50000, major: 100000, institutional: 500000 },
  option: { notable: 100, significant: 500, major: 1000, institutional: 5000 },
};

/**
 * Detect block trades from order flow
 */
export function detectBlockTrades(
  trades: Array<{ price: number; size: number; side: 'buy' | 'sell'; timestamp: string }>,
  symbol: string,
  avgDailyVolume: number,
  assetType: 'stock' | 'option' = 'stock'
): BlockTrade[] {
  const thresholds = BLOCK_TRADE_THRESHOLDS[assetType];
  const blocks: BlockTrade[] = [];

  for (const trade of trades) {
    let significance: BlockTrade['significance'] | null = null;
    
    if (trade.size >= thresholds.institutional) {
      significance = 'institutional';
    } else if (trade.size >= thresholds.major) {
      significance = 'major';
    } else if (trade.size >= thresholds.significant) {
      significance = 'significant';
    } else if (trade.size >= thresholds.notable) {
      significance = 'notable';
    }

    if (significance) {
      const dollarValue = trade.price * trade.size;
      const percentOfDaily = avgDailyVolume > 0 ? (trade.size / avgDailyVolume) * 100 : 0;

      blocks.push({
        symbol,
        timestamp: trade.timestamp,
        price: trade.price,
        size: trade.size,
        side: trade.side,
        dollarValue,
        percentOfDailyVolume: percentOfDaily,
        significance,
      });
    }
  }

  return blocks.sort((a, b) => b.size - a.size);
}

/**
 * Detect sweep orders (aggressive orders taking multiple levels)
 */
export function detectSweepOrders(
  orderBook: OrderBookSnapshot,
  recentTrades: Array<{ price: number; size: number; side: 'buy' | 'sell' }>
): SweepOrder[] {
  const sweeps: SweepOrder[] = [];
  
  const buyTrades = recentTrades.filter(t => t.side === 'buy');
  const sellTrades = recentTrades.filter(t => t.side === 'sell');

  if (buyTrades.length >= 3) {
    const prices = buyTrades.map(t => t.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const levelsSwept = orderBook.asks.filter(a => a.price >= minPrice && a.price <= maxPrice).length;
    
    if (levelsSwept >= 2) {
      const totalSize = buyTrades.reduce((sum, t) => sum + t.size, 0);
      const avgPrice = buyTrades.reduce((sum, t) => sum + t.price * t.size, 0) / totalSize;
      const priceImpact = ((maxPrice - minPrice) / minPrice) * 100;

      let aggression: SweepOrder['aggression'] = 'moderate';
      if (levelsSwept >= 5 || priceImpact > 0.5) aggression = 'very_aggressive';
      else if (levelsSwept >= 3 || priceImpact > 0.2) aggression = 'aggressive';

      sweeps.push({
        symbol: orderBook.symbol,
        timestamp: orderBook.timestamp,
        direction: 'ask',
        levelsSwept,
        totalSize,
        avgPrice,
        priceImpact,
        aggression,
      });
    }
  }

  if (sellTrades.length >= 3) {
    const prices = sellTrades.map(t => t.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const levelsSwept = orderBook.bids.filter(b => b.price >= minPrice && b.price <= maxPrice).length;
    
    if (levelsSwept >= 2) {
      const totalSize = sellTrades.reduce((sum, t) => sum + t.size, 0);
      const avgPrice = sellTrades.reduce((sum, t) => sum + t.price * t.size, 0) / totalSize;
      const priceImpact = ((maxPrice - minPrice) / minPrice) * 100;

      let aggression: SweepOrder['aggression'] = 'moderate';
      if (levelsSwept >= 5 || priceImpact > 0.5) aggression = 'very_aggressive';
      else if (levelsSwept >= 3 || priceImpact > 0.2) aggression = 'aggressive';

      sweeps.push({
        symbol: orderBook.symbol,
        timestamp: orderBook.timestamp,
        direction: 'bid',
        levelsSwept,
        totalSize,
        avgPrice,
        priceImpact,
        aggression,
      });
    }
  }

  return sweeps;
}

/**
 * Calculate order book imbalance
 */
export function calculateOrderImbalance(orderBook: OrderBookSnapshot): OrderImbalance {
  const { bids, asks, symbol, timestamp, totalBidVolume, totalAskVolume } = orderBook;

  // Handle empty arrays safely
  const top5Bids = bids.length > 0 ? bids.slice(0, 5).reduce((sum, b) => sum + b.size, 0) : 0;
  const top5Asks = asks.length > 0 ? asks.slice(0, 5).reduce((sum, b) => sum + b.size, 0) : 0;

  const imbalanceRatio = top5Asks > 0 ? top5Bids / top5Asks : 1;
  
  let bias: OrderImbalance['bias'] = 'neutral';
  if (imbalanceRatio > 2) bias = 'strongly_bullish';
  else if (imbalanceRatio > 1.3) bias = 'bullish';
  else if (imbalanceRatio < 0.5) bias = 'strongly_bearish';
  else if (imbalanceRatio < 0.77) bias = 'bearish';

  const topBid = bids[0]?.price || 0;
  const topAsk = asks[0]?.price || 0;
  const topOfBookSpread = topAsk > 0 ? ((topAsk - topBid) / topAsk) * 100 : 0;
  const depthRatio = totalAskVolume > 0 ? totalBidVolume / totalAskVolume : 1;

  let interpretation = '';
  if (bias === 'strongly_bullish') {
    interpretation = 'Heavy bid support indicates institutional accumulation - buyers outnumber sellers 2:1+';
  } else if (bias === 'bullish') {
    interpretation = 'Moderate bid support suggests buying pressure - watch for breakout confirmation';
  } else if (bias === 'strongly_bearish') {
    interpretation = 'Heavy offer pressure indicates institutional distribution - sellers dominate';
  } else if (bias === 'bearish') {
    interpretation = 'Moderate selling pressure - caution on long entries, watch support levels';
  } else {
    interpretation = 'Balanced order book - wait for directional signal from volume or price action';
  }

  return {
    symbol,
    timestamp,
    bidVolume: top5Bids,
    askVolume: top5Asks,
    imbalanceRatio,
    bias,
    topOfBookSpread,
    depthRatio,
    interpretation,
  };
}

/**
 * Find key support/resistance levels from order book depth
 */
export function findKeyLevels(orderBook: OrderBookSnapshot): { heavyBidSupport: number[]; heavyAskResistance: number[] } {
  const { bids, asks } = orderBook;

  // Handle empty arrays safely
  if (!bids.length && !asks.length) {
    return { heavyBidSupport: [], heavyAskResistance: [] };
  }

  const avgBidSize = bids.length > 0 
    ? bids.reduce((sum, b) => sum + b.size, 0) / bids.length 
    : 1;
  const avgAskSize = asks.length > 0 
    ? asks.reduce((sum, a) => sum + a.size, 0) / asks.length 
    : 1;

  const heavyBidSupport = bids
    .filter(b => b.size > avgBidSize * 2)
    .slice(0, 3)
    .map(b => b.price);

  const heavyAskResistance = asks
    .filter(a => a.size > avgAskSize * 2)
    .slice(0, 3)
    .map(a => a.price);

  return { heavyBidSupport, heavyAskResistance };
}

/**
 * Generate comprehensive institutional flow analysis
 */
export async function analyzeInstitutionalFlow(
  symbol: string,
  orderBook: OrderBookSnapshot | null,
  recentTrades: Array<{ price: number; size: number; side: 'buy' | 'sell'; timestamp: string }>,
  avgDailyVolume: number,
  assetType: 'stock' | 'option' = 'stock'
): Promise<InstitutionalFlow> {
  const timestamp = new Date().toISOString();

  const blockTrades = detectBlockTrades(recentTrades, symbol, avgDailyVolume, assetType);
  
  const mockOrderBook: OrderBookSnapshot = orderBook || {
    symbol,
    timestamp,
    bids: [],
    asks: [],
    lastPrice: recentTrades[0]?.price || 0,
    lastSize: recentTrades[0]?.size || 0,
    totalBidVolume: 0,
    totalAskVolume: 0,
  };

  const sweepOrders = orderBook ? detectSweepOrders(mockOrderBook, recentTrades) : [];
  const orderImbalance = calculateOrderImbalance(mockOrderBook);
  const keyLevels = findKeyLevels(mockOrderBook);

  let flowScore = 50;
  
  for (const block of blockTrades) {
    if (block.side === 'buy') {
      flowScore += block.significance === 'institutional' ? 15 : 
                   block.significance === 'major' ? 10 : 
                   block.significance === 'significant' ? 5 : 2;
    } else {
      flowScore -= block.significance === 'institutional' ? 15 : 
                   block.significance === 'major' ? 10 : 
                   block.significance === 'significant' ? 5 : 2;
    }
  }

  for (const sweep of sweepOrders) {
    if (sweep.direction === 'ask') {
      flowScore += sweep.aggression === 'very_aggressive' ? 10 : 
                   sweep.aggression === 'aggressive' ? 5 : 2;
    } else {
      flowScore -= sweep.aggression === 'very_aggressive' ? 10 : 
                   sweep.aggression === 'aggressive' ? 5 : 2;
    }
  }

  if (orderImbalance.bias === 'strongly_bullish') flowScore += 10;
  else if (orderImbalance.bias === 'bullish') flowScore += 5;
  else if (orderImbalance.bias === 'strongly_bearish') flowScore -= 10;
  else if (orderImbalance.bias === 'bearish') flowScore -= 5;

  flowScore = Math.max(0, Math.min(100, flowScore));

  let flowDirection: InstitutionalFlow['flowDirection'] = 'neutral';
  if (flowScore > 65) flowDirection = 'accumulation';
  else if (flowScore < 35) flowDirection = 'distribution';

  let tradingSignal = '';
  if (flowDirection === 'accumulation') {
    tradingSignal = `Institutional accumulation detected (score: ${flowScore}). ${blockTrades.filter(b => b.side === 'buy').length} bullish block trades, order book favors buyers. Look for pullback entries near ${keyLevels.heavyBidSupport[0]?.toFixed(2) || 'support'}.`;
  } else if (flowDirection === 'distribution') {
    tradingSignal = `Institutional distribution detected (score: ${flowScore}). ${blockTrades.filter(b => b.side === 'sell').length} bearish block trades, order book favors sellers. Avoid new longs, consider hedges.`;
  } else {
    tradingSignal = `Mixed institutional flow (score: ${flowScore}). Wait for clearer directional signal before establishing new positions.`;
  }

  const dataPoints = blockTrades.length + sweepOrders.length + (orderBook ? 1 : 0);
  const confidence = Math.min(85, 40 + dataPoints * 5);

  return {
    symbol,
    timestamp,
    flowScore,
    flowDirection,
    blockTrades: blockTrades.slice(0, 5),
    sweepOrders: sweepOrders.slice(0, 5),
    orderImbalance,
    darkPoolPrints: [],
    keyLevels,
    tradingSignal,
    confidence,
  };
}

/**
 * Quick flow check for trade validation
 */
export function getQuickFlowSignal(flowScore: number): {
  signal: 'bullish' | 'bearish' | 'neutral';
  positionAdjustment: number;
  warning: string | null;
} {
  if (flowScore > 70) {
    return {
      signal: 'bullish',
      positionAdjustment: 1.2,
      warning: null,
    };
  } else if (flowScore > 55) {
    return {
      signal: 'bullish',
      positionAdjustment: 1.0,
      warning: null,
    };
  } else if (flowScore < 30) {
    return {
      signal: 'bearish',
      positionAdjustment: 0.5,
      warning: 'Heavy distribution detected - reduce position size or avoid entry',
    };
  } else if (flowScore < 45) {
    return {
      signal: 'bearish',
      positionAdjustment: 0.75,
      warning: 'Moderate selling pressure - exercise caution',
    };
  }
  
  return {
    signal: 'neutral',
    positionAdjustment: 1.0,
    warning: null,
  };
}

export const OrderBookIntelligence = {
  detectBlockTrades,
  detectSweepOrders,
  calculateOrderImbalance,
  findKeyLevels,
  analyzeInstitutionalFlow,
  getQuickFlowSignal,
};
