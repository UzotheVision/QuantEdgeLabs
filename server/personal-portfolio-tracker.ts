/**
 * Personal Portfolio Tracker
 *
 * Tracks your actual positions from Webull/other brokers and:
 * 1. Monitors for stop loss hits (-30%)
 * 2. Monitors for profit targets (+50%, +100%)
 * 3. Detects bag holds before they become disasters
 * 4. Sends SMS alerts for critical events
 * 5. Validates strikes against account size
 */

import { logger } from './logger';
import { fetchStockPrice } from './market-api';
import { sendPositionAlert } from './sms-notification-service';

// ============================================
// TYPES
// ============================================

export interface TrackedPosition {
  id: string;
  symbol: string;           // e.g., "NVDA260213C00325000" or "NVDA"
  underlying: string;       // e.g., "NVDA"
  isOption: boolean;
  optionType?: 'call' | 'put';
  strike?: number;
  expiry?: string;          // ISO date
  daysToExpiry?: number;

  // Position details
  quantity: number;
  avgCostBasis: number;     // Per contract/share
  totalCost: number;        // Total invested

  // Current state
  currentPrice?: number;
  currentValue?: number;
  unrealizedPL?: number;
  unrealizedPLPercent?: number;

  // Tracking
  entryDate: Date;
  broker: 'webull' | 'robinhood' | 'manual';

  // Alerts
  stopLossPercent: number;  // Default -30%
  profitTarget1: number;    // Default +50%
  profitTarget2: number;    // Default +100%
  alertsSent: {
    stopLoss: boolean;
    profit50: boolean;
    profit100: boolean;
    bagHoldWarning: boolean;
  };
}

export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  totalPL: number;
  totalPLPercent: number;
  positionCount: number;
  openPositions: TrackedPosition[];
  atRiskPositions: TrackedPosition[];  // Down >20%
  profitablePositions: TrackedPosition[];
  lastUpdated: Date;
}

export interface PersonalConfig {
  accountSize: number;           // Current account value
  maxRiskPerTrade: number;       // $ amount (e.g., $50)
  maxRiskPercent: number;        // % of account (e.g., 5%)
  preferredExpiry: 'weekly' | 'monthly' | '2-3_weeks';
  preferredStrategies: string[];
  phoneNumber?: string;
  smsAlertsEnabled: boolean;
}

// ============================================
// STATE
// ============================================

let positions: Map<string, TrackedPosition> = new Map();
let config: PersonalConfig = {
  accountSize: 700,
  maxRiskPerTrade: 50,
  maxRiskPercent: 7,
  preferredExpiry: '2-3_weeks',
  preferredStrategies: ['pullback_scalp', 'vwap_bounce', 'orb_breakout'],
  smsAlertsEnabled: true,
};

let monitorInterval: NodeJS.Timeout | null = null;

// ============================================
// WEBULL CSV PARSER
// ============================================

/**
 * Parse Webull options CSV export
 * Format: Name,Symbol,Side,Status,Filled,Total Qty,Price,Avg Price,Time-in-Force,Placed Time,Filled Time
 */
export function parseWebullOptionsCSV(csvContent: string): TrackedPosition[] {
  const lines = csvContent.trim().split('\n');
  const header = lines[0];

  // Skip header
  const dataLines = lines.slice(1);

  // Group by symbol to calculate net positions
  const positionMap = new Map<string, {
    buys: { qty: number; price: number; date: string }[];
    sells: { qty: number; price: number; date: string }[];
  }>();

  for (const line of dataLines) {
    const parts = line.split(',');
    if (parts.length < 11) continue;

    const [name, symbol, side, status, filled, totalQty, price, avgPrice, tif, placedTime, filledTime] = parts;

    // Only process filled orders
    if (status !== 'Filled') continue;

    const qty = parseInt(filled);
    const priceValue = parseFloat(avgPrice) || parseFloat(price.replace('@', ''));

    if (isNaN(qty) || isNaN(priceValue) || qty === 0) continue;

    if (!positionMap.has(symbol)) {
      positionMap.set(symbol, { buys: [], sells: [] });
    }

    const pos = positionMap.get(symbol)!;
    if (side === 'Buy') {
      pos.buys.push({ qty, price: priceValue, date: filledTime || placedTime });
    } else if (side === 'Sell') {
      pos.sells.push({ qty, price: priceValue, date: filledTime || placedTime });
    }
  }

  // Calculate net positions
  const trackedPositions: TrackedPosition[] = [];

  for (const [symbol, trades] of positionMap) {
    const totalBought = trades.buys.reduce((sum, t) => sum + t.qty, 0);
    const totalSold = trades.sells.reduce((sum, t) => sum + t.qty, 0);
    const netQty = totalBought - totalSold;

    // Only track open positions (net qty > 0)
    if (netQty <= 0) continue;

    // Calculate average cost basis (FIFO)
    let remainingQty = netQty;
    let totalCostBasis = 0;

    // Sort buys by date (FIFO)
    const sortedBuys = [...trades.buys].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    for (const buy of sortedBuys) {
      if (remainingQty <= 0) break;
      const qtyFromThisBuy = Math.min(buy.qty, remainingQty);
      totalCostBasis += qtyFromThisBuy * buy.price * 100; // Options are x100
      remainingQty -= qtyFromThisBuy;
    }

    // Parse option symbol (e.g., "NVDA260213C00325000")
    const optionInfo = parseOptionSymbol(symbol);

    const position: TrackedPosition = {
      id: `webull_${symbol}_${Date.now()}`,
      symbol,
      underlying: optionInfo?.underlying || symbol,
      isOption: !!optionInfo,
      optionType: optionInfo?.type,
      strike: optionInfo?.strike,
      expiry: optionInfo?.expiry,
      daysToExpiry: optionInfo ? getDaysToExpiry(optionInfo.expiry) : undefined,
      quantity: netQty,
      avgCostBasis: totalCostBasis / netQty / 100, // Per contract
      totalCost: totalCostBasis,
      entryDate: new Date(sortedBuys[0]?.date || Date.now()),
      broker: 'webull',
      stopLossPercent: -30,
      profitTarget1: 50,
      profitTarget2: 100,
      alertsSent: {
        stopLoss: false,
        profit50: false,
        profit100: false,
        bagHoldWarning: false,
      },
    };

    trackedPositions.push(position);
  }

  return trackedPositions;
}

/**
 * Parse option symbol like "NVDA260213C00325000"
 * Format: UNDERLYING + YYMMDD + C/P + STRIKE (8 digits, strike * 1000)
 */
function parseOptionSymbol(symbol: string): {
  underlying: string;
  expiry: string;
  type: 'call' | 'put';
  strike: number;
} | null {
  // Match pattern like NVDA260213C00325000
  const match = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;

  const [, underlying, dateStr, typeChar, strikeStr] = match;

  // Parse date YYMMDD
  const year = 2000 + parseInt(dateStr.slice(0, 2));
  const month = parseInt(dateStr.slice(2, 4));
  const day = parseInt(dateStr.slice(4, 6));
  const expiry = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Parse strike (divide by 1000)
  const strike = parseInt(strikeStr) / 1000;

  return {
    underlying,
    expiry,
    type: typeChar === 'C' ? 'call' : 'put',
    strike,
  };
}

function getDaysToExpiry(expiry: string): number {
  const expiryDate = new Date(expiry);
  const now = new Date();
  const diffTime = expiryDate.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// ============================================
// POSITION MONITORING
// ============================================

/**
 * Update all position prices and check alerts
 */
export async function updatePositions(): Promise<PortfolioSummary> {
  const positionList = Array.from(positions.values());
  const atRisk: TrackedPosition[] = [];
  const profitable: TrackedPosition[] = [];

  let totalValue = 0;
  let totalCost = 0;

  for (const position of positionList) {
    try {
      // Get current price
      const priceData = await fetchStockPrice(position.underlying);
      if (!priceData) continue;

      // For options, estimate current value based on underlying movement
      // This is a simplification - ideally we'd get real option prices
      let currentPrice: number;

      if (position.isOption && position.strike) {
        // Rough option price estimate based on intrinsic value
        const underlyingPrice = priceData.last;
        const intrinsic = position.optionType === 'call'
          ? Math.max(0, underlyingPrice - position.strike)
          : Math.max(0, position.strike - underlyingPrice);

        // Add some time value estimate (rough)
        const dte = position.daysToExpiry || 0;
        const timeValue = position.avgCostBasis * 0.1 * Math.sqrt(dte / 30);
        currentPrice = intrinsic + timeValue;

        // Minimum value
        currentPrice = Math.max(currentPrice, 0.01);
      } else {
        currentPrice = priceData.last;
      }

      position.currentPrice = currentPrice;
      position.currentValue = currentPrice * position.quantity * (position.isOption ? 100 : 1);
      position.unrealizedPL = position.currentValue - position.totalCost;
      position.unrealizedPLPercent = (position.unrealizedPL / position.totalCost) * 100;

      // Update DTE
      if (position.expiry) {
        position.daysToExpiry = getDaysToExpiry(position.expiry);
      }

      totalValue += position.currentValue;
      totalCost += position.totalCost;

      // Check alerts
      await checkPositionAlerts(position);

      // Categorize
      if (position.unrealizedPLPercent <= -20) {
        atRisk.push(position);
      } else if (position.unrealizedPLPercent >= 20) {
        profitable.push(position);
      }

    } catch (error) {
      logger.error(`[PORTFOLIO] Error updating ${position.symbol}:`, error);
    }
  }

  return {
    totalValue,
    totalCost,
    totalPL: totalValue - totalCost,
    totalPLPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    positionCount: positionList.length,
    openPositions: positionList,
    atRiskPositions: atRisk,
    profitablePositions: profitable,
    lastUpdated: new Date(),
  };
}

/**
 * Check if any alerts should be sent for a position
 */
async function checkPositionAlerts(position: TrackedPosition): Promise<void> {
  if (!config.smsAlertsEnabled) return;

  const plPercent = position.unrealizedPLPercent || 0;

  // STOP LOSS ALERT (-30%)
  if (plPercent <= position.stopLossPercent && !position.alertsSent.stopLoss) {
    logger.warn(`[PORTFOLIO] 🚨 STOP LOSS HIT: ${position.symbol} at ${plPercent.toFixed(1)}%`);
    position.alertsSent.stopLoss = true;

    await sendPositionAlert({
      type: 'stop_loss',
      symbol: position.symbol,
      underlying: position.underlying,
      plPercent,
      currentPrice: position.currentPrice || 0,
      avgCost: position.avgCostBasis,
      quantity: position.quantity,
      message: `🚨 STOP LOSS: ${position.underlying} ${position.optionType?.toUpperCase() || ''} $${position.strike} is DOWN ${Math.abs(plPercent).toFixed(0)}%! CUT IT NOW.`,
    });
  }

  // BAG HOLD WARNING (-50%)
  if (plPercent <= -50 && !position.alertsSent.bagHoldWarning) {
    logger.warn(`[PORTFOLIO] 💀 BAG HOLD WARNING: ${position.symbol} at ${plPercent.toFixed(1)}%`);
    position.alertsSent.bagHoldWarning = true;

    await sendPositionAlert({
      type: 'bag_hold',
      symbol: position.symbol,
      underlying: position.underlying,
      plPercent,
      currentPrice: position.currentPrice || 0,
      avgCost: position.avgCostBasis,
      quantity: position.quantity,
      message: `💀 BAG HOLD ALERT: ${position.underlying} is DOWN ${Math.abs(plPercent).toFixed(0)}%! You're losing $${Math.abs(position.unrealizedPL || 0).toFixed(0)}. Consider cutting.`,
    });
  }

  // PROFIT TARGET 1 (+50%)
  if (plPercent >= position.profitTarget1 && !position.alertsSent.profit50) {
    logger.info(`[PORTFOLIO] 💰 PROFIT TARGET 1: ${position.symbol} at +${plPercent.toFixed(1)}%`);
    position.alertsSent.profit50 = true;

    await sendPositionAlert({
      type: 'profit_target',
      symbol: position.symbol,
      underlying: position.underlying,
      plPercent,
      currentPrice: position.currentPrice || 0,
      avgCost: position.avgCostBasis,
      quantity: position.quantity,
      message: `💰 TAKE PROFIT: ${position.underlying} is UP ${plPercent.toFixed(0)}%! You're up $${(position.unrealizedPL || 0).toFixed(0)}. Sell half or trail stop!`,
    });
  }

  // PROFIT TARGET 2 (+100%)
  if (plPercent >= position.profitTarget2 && !position.alertsSent.profit100) {
    logger.info(`[PORTFOLIO] 🎯 PROFIT TARGET 2: ${position.symbol} at +${plPercent.toFixed(1)}%`);
    position.alertsSent.profit100 = true;

    await sendPositionAlert({
      type: 'profit_target',
      symbol: position.symbol,
      underlying: position.underlying,
      plPercent,
      currentPrice: position.currentPrice || 0,
      avgCost: position.avgCostBasis,
      quantity: position.quantity,
      message: `🎯 2X TARGET: ${position.underlying} is UP ${plPercent.toFixed(0)}%! TAKE PROFITS. Don't let a winner become a loser!`,
    });
  }

  // EXPIRY WARNING (< 2 DTE)
  if (position.daysToExpiry !== undefined && position.daysToExpiry <= 2 && position.daysToExpiry >= 0) {
    const expiryWarning = `⏰ EXPIRY WARNING: ${position.underlying} ${position.optionType?.toUpperCase()} $${position.strike} expires in ${position.daysToExpiry} day(s)!`;
    logger.warn(`[PORTFOLIO] ${expiryWarning}`);
  }
}

// ============================================
// STRIKE VALIDATOR
// ============================================

/**
 * Validate if a strike is appropriate for account size
 */
export function validateStrike(
  underlying: string,
  strike: number,
  currentPrice: number,
  optionType: 'call' | 'put',
  accountSize: number
): {
  isValid: boolean;
  warning?: string;
  recommendation?: string;
} {
  const distancePercent = Math.abs(strike - currentPrice) / currentPrice * 100;

  // For small accounts (<$1500), max 5% OTM
  // For medium accounts ($1500-$5000), max 10% OTM
  // For larger accounts, max 15% OTM
  let maxOTM: number;
  if (accountSize < 1500) {
    maxOTM = 5;
  } else if (accountSize < 5000) {
    maxOTM = 10;
  } else {
    maxOTM = 15;
  }

  const isOTM = (optionType === 'call' && strike > currentPrice) ||
                (optionType === 'put' && strike < currentPrice);

  if (isOTM && distancePercent > maxOTM) {
    return {
      isValid: false,
      warning: `Strike $${strike} is ${distancePercent.toFixed(1)}% OTM - too risky for $${accountSize} account`,
      recommendation: optionType === 'call'
        ? `Consider strike closer to $${(currentPrice * (1 + maxOTM/100)).toFixed(0)}`
        : `Consider strike closer to $${(currentPrice * (1 - maxOTM/100)).toFixed(0)}`,
    };
  }

  return { isValid: true };
}

// ============================================
// API FUNCTIONS
// ============================================

export function importPositions(newPositions: TrackedPosition[]): void {
  for (const pos of newPositions) {
    positions.set(pos.id, pos);
  }
  logger.info(`[PORTFOLIO] Imported ${newPositions.length} positions`);
}

export function clearPositions(): void {
  positions.clear();
  logger.info('[PORTFOLIO] Cleared all positions');
}

export function getPositions(): TrackedPosition[] {
  return Array.from(positions.values());
}

export function getConfig(): PersonalConfig {
  return { ...config };
}

export function updateConfig(newConfig: Partial<PersonalConfig>): void {
  config = { ...config, ...newConfig };
  logger.info('[PORTFOLIO] Config updated:', config);
}

export function startMonitoring(intervalMs: number = 60000): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
  }

  logger.info(`[PORTFOLIO] Starting position monitoring (${intervalMs}ms interval)`);

  // Run immediately
  updatePositions().catch(e => logger.error('[PORTFOLIO] Monitor error:', e));

  // Then on interval
  monitorInterval = setInterval(() => {
    updatePositions().catch(e => logger.error('[PORTFOLIO] Monitor error:', e));
  }, intervalMs);
}

export function stopMonitoring(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    logger.info('[PORTFOLIO] Position monitoring stopped');
  }
}
