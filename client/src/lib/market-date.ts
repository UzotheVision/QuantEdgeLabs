/**
 * MARKET DATE — parse exchange date strings without losing a day.
 *
 * `new Date("2026-08-28")` is parsed as UTC midnight per the ISO spec, so anywhere west of
 * UTC it renders as the 27th. Option expiries are date-only strings, so the platform was
 * displaying every contract one day early — showing "Aug 27" (a Thursday) for a contract
 * that actually expires Friday Aug 28. Weekly options don't expire on Thursdays, so the
 * date was not just wrong, it was obviously wrong.
 *
 * Anchoring at local midday keeps the calendar date intact in every timezone the platform
 * is likely to run in, and DTE maths measured from it can't be off by one either.
 */

/** Parse a date-only exchange string ("2026-08-28") as that calendar day, locally. */
export function parseMarketDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d;
  const s = String(d).trim();
  // date-only → anchor at local midday; anything with a time component is already explicit
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "Aug 28" / "Aug 28, 2026" */
export function formatExpiry(d: string | Date | null | undefined, opts: { year?: boolean } = {}): string {
  const dt = parseMarketDate(d);
  if (!dt) return '—';
  return dt.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(opts.year ? { year: 'numeric' } : {}),
  });
}

/** Whole days until expiry, never negative. */
export function daysToExpiry(d: string | Date | null | undefined, from: Date = new Date()): number | null {
  const dt = parseMarketDate(d);
  if (!dt) return null;
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Weekly options expire Friday — a Thursday expiry is a parsing bug, not a contract. */
export function isLikelyExpiryDay(d: string | Date | null | undefined): boolean {
  const dt = parseMarketDate(d);
  if (!dt) return false;
  const day = dt.getDay();
  return day === 5 || day === 4; // Friday, or Thursday for the rare holiday-shifted week
}
