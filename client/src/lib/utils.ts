import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, toZonedTime } from "date-fns-tz";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCTTime(date: Date | string): string {
  const timezone = "America/Chicago";
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const zonedDate = toZonedTime(dateObj, timezone);
  return format(zonedDate, "MMM dd, yyyy h:mm a 'CT'", { timeZone: timezone });
}

export function getMarketSession(): 'pre-market' | 'rth' | 'after-hours' | 'closed' {
  const now = new Date();
  const timezone = "America/Chicago";
  const zonedNow = toZonedTime(now, timezone);
  const hour = zonedNow.getHours();
  const minute = zonedNow.getMinutes();
  const day = zonedNow.getDay();
  
  // Weekend (0 = Sunday, 6 = Saturday)
  if (day === 0 || day === 6) return 'closed';
  
  const timeInMinutes = hour * 60 + minute;
  
  // Pre-market: 4:00 AM - 9:30 AM CT (240 - 570 minutes)
  if (timeInMinutes >= 240 && timeInMinutes < 570) return 'pre-market';
  
  // RTH (Regular Trading Hours): 9:30 AM - 4:00 PM CT (570 - 960 minutes)
  if (timeInMinutes >= 570 && timeInMinutes < 960) return 'rth';
  
  // After-hours: 4:00 PM - 8:00 PM CT (960 - 1200 minutes)
  if (timeInMinutes >= 960 && timeInMinutes < 1200) return 'after-hours';
  
  return 'closed';
}

export function isWeekend(): boolean {
  const now = new Date();
  const timezone = "America/Chicago";
  const zonedNow = toZonedTime(now, timezone);
  const day = zonedNow.getDay();
  
  // Weekend: 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

export type MarketSession = 'open' | 'pre_market' | 'after_hours' | 'closed';

export interface MarketStatus {
  session: MarketSession;
  label: string;
  nextOpen: string | null;
  message: string;
}

export function getMarketStatus(): MarketStatus {
  const now = new Date();
  const etTimezone = "America/New_York";
  const zonedNow = toZonedTime(now, etTimezone);
  const day = zonedNow.getDay();
  const hours = zonedNow.getHours();
  const minutes = zonedNow.getMinutes();
  const timeDecimal = hours + minutes / 60;
  
  // Weekend check
  if (day === 0 || day === 6) {
    return {
      session: 'closed',
      label: 'Market Closed',
      nextOpen: 'Monday 9:30 AM ET',
      message: 'Review recent research briefs and prepare watchlists for next week.'
    };
  }
  
  // Market hours: 9:30 AM - 4:00 PM ET
  if (timeDecimal >= 9.5 && timeDecimal < 16) {
    return {
      session: 'open',
      label: 'Market Open',
      nextOpen: null,
      message: 'Live trading session in progress.'
    };
  }
  
  // Pre-market: 4:00 AM - 9:30 AM ET
  if (timeDecimal >= 4 && timeDecimal < 9.5) {
    return {
      session: 'pre_market',
      label: 'Pre-Market',
      nextOpen: '9:30 AM ET',
      message: 'Pre-market session active. Fresh ideas will be generated at market open.'
    };
  }
  
  // After-hours: 4:00 PM - 8:00 PM ET
  if (timeDecimal >= 16 && timeDecimal < 20) {
    return {
      session: 'after_hours',
      label: 'After-Hours',
      nextOpen: 'Tomorrow 9:30 AM ET',
      message: 'After-hours trading. Review recent briefs and plan tomorrow\'s trades.'
    };
  }
  
  // Overnight: 8:00 PM - 4:00 AM ET
  return {
    session: 'closed',
    label: 'Market Closed',
    nextOpen: timeDecimal >= 20 ? 'Tomorrow 9:30 AM ET' : '9:30 AM ET',
    message: 'Market closed. Recent research briefs are shown below for planning.'
  };
}

export function getNextTradingWeekStart(): Date {
  const now = new Date();
  const timezone = "America/Chicago";
  const zonedNow = toZonedTime(now, timezone);
  const day = zonedNow.getDay();
  
  // Calculate days until next Monday
  let daysUntilMonday = 0;
  if (day === 0) { // Sunday
    daysUntilMonday = 1;
  } else if (day === 6) { // Saturday
    daysUntilMonday = 2;
  } else { // Weekday - return next Monday
    daysUntilMonday = (8 - day) % 7 || 7;
  }
  
  const nextMonday = new Date(zonedNow);
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  nextMonday.setHours(9, 30, 0, 0); // 9:30 AM market open
  
  return nextMonday;
}

export function formatCurrency(value: number): string {
  try {
    // Handle null/undefined/NaN - convert first for safety
    if (value === null || value === undefined) {
      return '$0.00';
    }
    const num = typeof value === 'number' ? value : Number(value);
    if (isNaN(num) || !isFinite(num)) {
      return '$0.00';
    }

    // Handle very small crypto prices (< $0.01)
    if (num < 0.01 && num > 0) {
      // Count leading zeros after decimal
      const str = num.toFixed(10);
      const match = str.match(/0\.0*[1-9]/);
      if (match) {
        const significantDigits = match[0].length - 2; // -2 for "0."
        return `$${num.toFixed(Math.min(significantDigits + 2, 8))}`;
      }
    }

    // Normal formatting for values >= $0.01
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return '$0.00';
  }
}

export function formatPercent(value: number, decimals: number = 2): string {
  try {
    // Handle null/undefined/NaN - convert first for safety
    if (value === null || value === undefined) {
      return '+0.00%';
    }
    const num = typeof value === 'number' ? value : Number(value);
    if (isNaN(num) || !isFinite(num)) {
      return '+0.00%';
    }
    return `${num >= 0 ? '+' : ''}${num.toFixed(decimals)}%`;
  } catch {
    return '+0.00%';
  }
}

export function formatVolume(volume: number): string {
  try {
    // Handle null/undefined/NaN - convert first for safety
    if (volume === null || volume === undefined) {
      return '0';
    }
    const num = typeof volume === 'number' ? volume : Number(volume);
    if (isNaN(num) || !isFinite(num)) {
      return '0';
    }
    if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
    return num.toFixed(0);
  } catch {
    return '0';
  }
}

export function calculatePositionSize(
  entryPrice: number,
  stopLoss: number,
  capitalAllocated: number,
  maxRiskPercent: number
): { shares: number; riskAmount: number; riskPercent: number } {
  // Protect against division by zero
  const safeEntryPrice = entryPrice || 1;
  const entryStopDiff = Math.abs(safeEntryPrice - stopLoss) || 0.01;
  const stopLossPercent = Math.abs((stopLoss - safeEntryPrice) / safeEntryPrice) * 100;
  const maxRiskAmount = capitalAllocated * (maxRiskPercent / 100);
  const shares = Math.floor(maxRiskAmount / entryStopDiff);
  const actualRiskAmount = shares * entryStopDiff;
  const actualRiskPercent = capitalAllocated > 0 ? (actualRiskAmount / capitalAllocated) * 100 : 0;

  return {
    shares,
    riskAmount: actualRiskAmount,
    riskPercent: actualRiskPercent,
  };
}

export function calculateRiskReward(
  entryPrice: number,
  stopLoss: number,
  targetPrice: number
): number {
  const risk = Math.abs(entryPrice - stopLoss) || 0.01; // Protect against division by zero
  const reward = Math.abs(targetPrice - entryPrice);
  return reward / risk;
}

export function getPriceChangeColor(change: number): string {
  if (change > 0) return 'text-bullish';
  if (change < 0) return 'text-bearish';
  return 'text-muted-foreground';
}

export type TradeSignal = {
  status: 'ENTRY ZONE' | 'HOLDING' | 'TAKE PROFIT' | 'STOP OUT' | 'BREAKOUT' | 'INVALIDATED' | 'MONITORING';
  color: 'green' | 'blue' | 'yellow' | 'red' | 'purple' | 'gray';
  message: string;
  action: 'BUY' | 'HOLD' | 'SELL' | 'EXIT' | 'WATCH';
};

export function calculateDynamicSignal(
  currentPrice: number,
  entryPrice: number,
  targetPrice: number,
  stopLoss: number,
  direction: 'long' | 'short'
): TradeSignal {
  const entryThreshold = 0.02; // 2% threshold for entry zone
  const targetThreshold = 0.01; // 1% threshold for target zone
  const stopThreshold = 0.01; // 1% threshold for stop zone

  if (direction === 'long') {
    // Long position signals
    const distanceFromEntry = ((currentPrice - entryPrice) / entryPrice);
    const distanceFromTarget = ((currentPrice - targetPrice) / targetPrice);
    const distanceFromStop = ((currentPrice - stopLoss) / stopLoss);

    if (currentPrice <= stopLoss * (1 + stopThreshold)) {
      return {
        status: 'STOP OUT',
        color: 'red',
        message: `Price hit stop loss at ${formatCurrency(stopLoss)}`,
        action: 'EXIT'
      };
    } else if (currentPrice >= targetPrice * (1 - targetThreshold)) {
      if (currentPrice > targetPrice * 1.05) {
        return {
          status: 'BREAKOUT',
          color: 'purple',
          message: `Price surged ${formatPercent((currentPrice - targetPrice) / targetPrice * 100, 1)} beyond target!`,
          action: 'HOLD'
        };
      }
      return {
        status: 'TAKE PROFIT',
        color: 'green',
        message: `Target reached! Consider taking profits`,
        action: 'SELL'
      };
    } else if (Math.abs(distanceFromEntry) <= entryThreshold) {
      return {
        status: 'ENTRY ZONE',
        color: 'blue',
        message: `Good entry opportunity near ${formatCurrency(entryPrice)}`,
        action: 'BUY'
      };
    } else if (currentPrice > entryPrice && currentPrice < targetPrice) {
      const progressPercent = ((currentPrice - entryPrice) / (targetPrice - entryPrice)) * 100;
      return {
        status: 'HOLDING',
        color: 'yellow',
        message: `${formatPercent(progressPercent, 0)} toward target`,
        action: 'HOLD'
      };
    } else if (currentPrice < entryPrice && currentPrice > stopLoss) {
      return {
        status: 'MONITORING',
        color: 'gray',
        message: `Below entry, watching for setup`,
        action: 'WATCH'
      };
    }
  } else {
    // Short position signals
    const distanceFromEntry = ((entryPrice - currentPrice) / entryPrice);
    const distanceFromTarget = ((targetPrice - currentPrice) / targetPrice);
    const distanceFromStop = ((stopLoss - currentPrice) / stopLoss);

    if (currentPrice >= stopLoss * (1 - stopThreshold)) {
      return {
        status: 'STOP OUT',
        color: 'red',
        message: `Price hit stop loss at ${formatCurrency(stopLoss)}`,
        action: 'BUY' // Buy to cover short at a loss
      };
    } else if (currentPrice <= targetPrice * (1 + targetThreshold)) {
      if (currentPrice < targetPrice * 0.95) {
        return {
          status: 'BREAKOUT',
          color: 'purple',
          message: `Price dropped ${formatPercent(Math.abs((currentPrice - targetPrice) / targetPrice * 100), 1)} beyond target!`,
          action: 'HOLD'
        };
      }
      return {
        status: 'TAKE PROFIT',
        color: 'green',
        message: `Target reached! Buy to cover short`,
        action: 'BUY' // Buy to cover short and take profit
      };
    } else if (Math.abs(distanceFromEntry) <= entryThreshold) {
      return {
        status: 'ENTRY ZONE',
        color: 'blue',
        message: `Good short entry near ${formatCurrency(entryPrice)}`,
        action: 'SELL' // Sell to enter short position
      };
    } else if (currentPrice < entryPrice && currentPrice > targetPrice) {
      const progressPercent = ((entryPrice - currentPrice) / (entryPrice - targetPrice)) * 100;
      return {
        status: 'HOLDING',
        color: 'yellow',
        message: `${formatPercent(progressPercent, 0)} toward target`,
        action: 'HOLD'
      };
    } else if (currentPrice > entryPrice && currentPrice < stopLoss) {
      return {
        status: 'MONITORING',
        color: 'gray',
        message: `Above entry, watching for setup`,
        action: 'WATCH'
      };
    }
  }

  // Default fallback
  return {
    status: 'MONITORING',
    color: 'gray',
    message: 'Monitoring price action',
    action: 'WATCH'
  };
}

// ============================================
// SAFE NUMBER FORMATTING UTILITIES
// Prevents "Cannot read properties of null (reading 'toFixed')" errors
// ============================================

/**
 * Safely converts a value to a number, returning a fallback if null/undefined/NaN/Infinity
 */
export function safeNumber(value: any, fallback: number = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (isNaN(num) || !isFinite(num)) return fallback;
  return num;
}

/**
 * Safely formats a number with toFixed, returning fallback string if value is invalid
 * Wrapped in try-catch for bulletproof safety
 */
export function safeToFixed(value: any, decimals: number = 2, fallback: string = '0.00'): string {
  try {
    if (value === null || value === undefined) return fallback;
    const num = typeof value === 'number' ? value : Number(value);
    if (isNaN(num) || !isFinite(num)) return fallback;
    return num.toFixed(decimals);
  } catch {
    return fallback;
  }
}

/**
 * Safely formats a price with dollar sign
 */
export function safePrice(value: any, decimals: number = 2): string {
  try {
    if (value === null || value === undefined) return '$0.00';
    const num = typeof value === 'number' ? value : Number(value);
    if (isNaN(num) || !isFinite(num)) return '$0.00';
    return `$${num.toFixed(decimals)}`;
  } catch {
    return '$0.00';
  }
}

/**
 * Safely formats a percentage with sign
 */
export function safePercent(value: any, decimals: number = 2, showSign: boolean = true): string {
  try {
    if (value === null || value === undefined) return '+0.00%';
    const num = typeof value === 'number' ? value : Number(value);
    if (isNaN(num) || !isFinite(num)) return '+0.00%';
    const sign = showSign && num >= 0 ? '+' : '';
    return `${sign}${num.toFixed(decimals)}%`;
  } catch {
    return '+0.00%';
  }
}

/**
 * Safely formats currency with proper locale formatting
 */
export function safeCurrency(value: any, fallback: string = '$0.00'): string {
  const num = safeNumber(value);
  if (num === 0 && (value === null || value === undefined)) return fallback;
  return formatCurrency(num);
}

// ============================================
// UNIFIED DATA FORMATTING — Bloomberg density
// Single source of truth for all numerical display.
// Every number on the platform should go through one of these.
// ============================================

/**
 * Format market cap with T/B/M/K suffix
 */
export function formatMarketCap(value: number | null | undefined): string {
  const num = safeNumber(value);
  if (num === 0) return '--';
  if (num >= 1_000_000_000_000) return `$${(num / 1_000_000_000_000).toFixed(2)}T`;
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(0)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

/**
 * Format risk:reward ratio — "2.3:1" style
 */
export function formatRR(entry: number, target: number, stop: number): string {
  const risk = Math.abs(entry - stop);
  if (risk === 0) return '--';
  const reward = Math.abs(target - entry);
  return `${(reward / risk).toFixed(1)}:1`;
}

/**
 * Compact relative time — "2m" / "3h" / "1d" / "2w"
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '--';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

/**
 * Format compact volume — "1.2M" style (fewer decimals than formatVolume)
 */
export function formatVolumeCompact(volume: number | null | undefined): string {
  const num = safeNumber(volume);
  if (num === 0) return '--';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return num.toFixed(0);
}

/**
 * Format price change with color class — returns { text, className }
 * Use for consistent bullish/bearish/neutral display everywhere.
 */
export function formatPriceChange(value: number | null | undefined, decimals: number = 2): {
  text: string;
  className: string;
  isPositive: boolean;
} {
  const num = safeNumber(value);
  const isPositive = num >= 0;
  return {
    text: `${isPositive ? '+' : ''}${num.toFixed(decimals)}%`,
    className: num > 0
      ? 'text-[var(--trade-bullish)]'
      : num < 0
        ? 'text-[var(--trade-bearish)]'
        : 'text-muted-foreground',
    isPositive,
  };
}
