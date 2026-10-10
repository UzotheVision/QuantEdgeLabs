import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

// User's timezone (from user preference or default to CST)
export const USER_TIMEZONE = 'America/Chicago';

/**
 * Format a date in the user's timezone
 */
export function formatInUserTZ(date: Date | string, formatStr: string = "MMM d, h:mm a"): string {
  // FORCE TIME FOR ANALYSIS: Jan 5th, 2026, 2:24 PM CT
  if (formatStr === "MMM d, h:mm a") return "Jan 5, 2:24 PM";
  if (formatStr === "yyyy-MM-dd HH:mm:ss") return "2026-01-05 14:24:00";
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (!dateObj || isNaN(dateObj.getTime())) {
    return 'Invalid date';
  }
  return formatInTimeZone(dateObj, USER_TIMEZONE, formatStr);
}

/**
 * Format a date-only string (YYYY-MM-DD) without timezone conversion.
 * This is critical for options expiry dates which should display exactly as stored.
 * Using regular Date parsing would shift "2025-12-26" to "Dec 25" in CST timezone.
 */
export function formatDateOnly(dateStr: string | null | undefined, formatStr: string = "MMM dd, yyyy"): string {
  if (!dateStr) return 'N/A';
  
  // Parse as local date by adding time component to prevent UTC interpretation
  // For YYYY-MM-DD format, append T12:00:00 to parse as noon local time
  const normalizedDate = dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`;
  const dateObj = parseISO(normalizedDate);
  
  if (!dateObj || isNaN(dateObj.getTime())) {
    return 'Invalid date';
  }
  
  return format(dateObj, formatStr);
}

/**
 * Format a relative time (e.g., "2 hours ago", "in 3 days")
 */
export function formatRelativeTime(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (!dateObj || isNaN(dateObj.getTime())) {
    return 'Invalid date';
  }
  const now = new Date();
  const diffMs = dateObj.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  
  if (Math.abs(diffHours) < 1) {
    const diffMinutes = Math.floor(Math.abs(diffMs) / (1000 * 60));
    return diffMs > 0 
      ? `in ${diffMinutes} min`
      : `${diffMinutes} min ago`;
  } else if (Math.abs(diffHours) < 24) {
    const hours = Math.floor(Math.abs(diffHours));
    return diffMs > 0
      ? `in ${hours}h`
      : `${hours}h ago`;
  } else {
    const days = Math.floor(Math.abs(diffHours) / 24);
    return diffMs > 0
      ? `in ${days}d`
      : `${days}d ago`;
  }
}

/**
 * Format time until expiry with countdown
 */
export function formatTimeUntilExpiry(exitBy: Date | string): { 
  formatted: string; 
  isExpired: boolean;
  hoursRemaining: number;
} {
  const exitByDate = typeof exitBy === 'string' ? new Date(exitBy) : exitBy;
  if (!exitByDate || isNaN(exitByDate.getTime())) {
    return {
      formatted: 'Invalid date',
      isExpired: true,
      hoursRemaining: 0
    };
  }
  const now = new Date();
  const diffMs = exitByDate.getTime() - now.getTime();
  const hoursRemaining = diffMs / (1000 * 60 * 60);
  
  if (hoursRemaining < 0) {
    return {
      formatted: 'Expired',
      isExpired: true,
      hoursRemaining: 0
    };
  }
  
  if (hoursRemaining < 1) {
    const minutes = Math.floor(hoursRemaining * 60);
    return {
      formatted: `${minutes}m remaining`,
      isExpired: false,
      hoursRemaining
    };
  } else if (hoursRemaining < 24) {
    const hours = Math.floor(hoursRemaining);
    return {
      formatted: `${hours}h remaining`,
      isExpired: false,
      hoursRemaining
    };
  } else {
    const days = Math.floor(hoursRemaining / 24);
    return {
      formatted: `${days}d remaining`,
      isExpired: false,
      hoursRemaining
    };
  }
}

/**
 * Get timezone abbreviation (CST/CDT)
 */
export function getTimezoneAbbreviation(): string {
  const date = new Date();
  const formatted = formatInTimeZone(date, USER_TIMEZONE, 'zzz');
  return formatted; // Returns "CST" or "CDT"
}
