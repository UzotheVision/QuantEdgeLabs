import { format, set, getDay } from 'date-fns';

const MARKET_TIMEZONE = 'America/New_York';

export interface MarketStatus {
  isOpen: boolean;
  nextOpen: Date | null;
  nextClose: Date | null;
  statusMessage: string;
}

// Get current time in Eastern Time using Intl API (reliable cross-browser)
function getEasternTime(): { hour: number; minute: number; dayOfWeek: number; dateStr: string } {
  const now = new Date();
  
  // Use Intl.DateTimeFormat to get Eastern Time components reliably
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'long',
    hour12: false,
  });
  
  const parts = etFormatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const weekdayName = parts.find(p => p.type === 'weekday')?.value || '';
  
  // Convert weekday name to number (0 = Sunday, 6 = Saturday)
  const weekdayMap: Record<string, number> = {
    'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
    'Thursday': 4, 'Friday': 5, 'Saturday': 6
  };
  const dayOfWeek = weekdayMap[weekdayName] ?? 1;
  
  // Get date string for display
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const dateStr = dateFormatter.format(now);
  
  return { hour, minute, dayOfWeek, dateStr };
}

export function getMarketStatus(): MarketStatus {
  const et = getEasternTime();
  const { hour, minute, dayOfWeek } = et;
  
  // Weekend check (0 = Sunday, 6 = Saturday)
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return {
      isOpen: false,
      nextOpen: null,
      nextClose: null,
      statusMessage: 'Market Closed (Weekend)'
    };
  }
  
  // Convert current time to minutes since midnight for comparison
  const currentMinutes = hour * 60 + minute;
  const marketOpenMinutes = 9 * 60 + 30; // 9:30 AM = 570 minutes
  const marketCloseMinutes = 16 * 60;    // 4:00 PM = 960 minutes
  
  // Check if within market hours
  const isOpen = currentMinutes >= marketOpenMinutes && currentMinutes < marketCloseMinutes;
  
  if (isOpen) {
    return {
      isOpen: true,
      nextOpen: null,
      nextClose: null,
      statusMessage: `Market Open (closes at 4:00 PM ET)`
    };
  }
  
  // Before market open
  if (currentMinutes < marketOpenMinutes) {
    return {
      isOpen: false,
      nextOpen: null,
      nextClose: null,
      statusMessage: `Pre-Market (opens at 9:30 AM ET)`
    };
  }
  
  // After market close
  return {
    isOpen: false,
    nextOpen: null,
    nextClose: null,
    statusMessage: `After Hours (opens tomorrow at 9:30 AM ET)`
  };
}

export function getMetricsUpdateMessage(): string {
  const status = getMarketStatus();
  
  if (status.isOpen) {
    return 'Live market data updating every 30 seconds';
  }
  
  return `${status.statusMessage} - Metrics update when market reopens`;
}

// Debug function to check what the browser thinks the time is
export function debugMarketTime(): string {
  const et = getEasternTime();
  return `ET: ${et.hour}:${et.minute.toString().padStart(2, '0')} (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][et.dayOfWeek]})`;
}
