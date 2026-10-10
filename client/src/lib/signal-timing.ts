import { USER_TIMEZONE, getTimezoneAbbreviation } from '@/lib/timezone';
/**
 * SIGNAL TIMING — when a signal actually fired, and whether that moment was tradeable.
 *
 * Motivating bug: DHR was published at 4:00:57 PM ET — 57 seconds AFTER the close.
 * The board rendered it identically to a signal fired at 10am, so it read as
 * actionable when in reality the next chance to act was ~17.5 hours later, after
 * a full overnight gap. A signal you cannot act on is not the same as a signal
 * you have not acted on yet, and the UI has to say which one it is.
 *
 * Two independent facts, deliberately kept apart:
 *   1. WHICH SESSION it fired in  — was there liquidity at the moment of the call?
 *   2. HOW MANY SESSIONS AGO      — has price had time to leave the entry behind?
 * A signal can be born untradeable (fired at 4:00pm) and still be perfectly fresh.
 */

export type MarketSession = 'pre' | 'regular' | 'post' | 'closed';

const ET = 'America/New_York';

/** Eastern-time parts for any instant, without dragging in a tz library. */
function etParts(d: Date): { hour: number; minute: number; dow: number; ymd: string } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour: 'numeric', minute: 'numeric', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
  });
  const p = f.formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // Intl renders midnight as hour "24" under hour12:false in some engines.
  const hour = parseInt(get('hour'), 10) % 24;
  return {
    hour,
    minute: parseInt(get('minute'), 10),
    dow: dowMap[get('weekday')] ?? 1,
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** Session containing a given instant. 4:00:00pm ET is already 'post'. */
export function sessionAt(d: Date): MarketSession {
  const { hour, minute, dow } = etParts(d);
  if (dow === 0 || dow === 6) return 'closed';
  const mins = hour * 60 + minute;
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'pre';
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'regular';
  if (mins >= 16 * 60 && mins < 20 * 60) return 'post';
  return 'closed';
}

/** UTC instant of the 9:30am ET open on a given ET calendar date. */
function etOpenUtc(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  // ET is UTC-4 (EDT) or UTC-5 (EST); pick whichever reads back as exactly 09:30
  // rather than hardcoding a DST rule that Congress keeps threatening to change.
  for (const off of [4, 5]) {
    const t = Date.UTC(y, m - 1, d, 9 + off, 30);
    const p = etParts(new Date(t));
    if (p.hour === 9 && p.minute === 30) return t;
  }
  return Date.UTC(y, m - 1, d, 13, 30);
}

/**
 * Count regular-session opens in the half-open interval (from, to] — i.e. how many
 * chances price had to gap away from the signal's entry. Calendar-day math would
 * over-count weekends, and "hours elapsed" would call a Friday-3pm signal stale by
 * Saturday when nothing has actually traded. Only opens count.
 *
 * Holidays are not modelled: the NYSE calendar isn't available client-side, so a
 * signal spanning Thanksgiving reports one session more than it lived through.
 * Over-stating staleness by one is the safe direction to be wrong in.
 */
export function sessionsElapsed(from: Date, to: Date): number {
  if (to <= from) return 0;
  let count = 0;
  // Walk ET calendar dates from `from`'s date through `to`'s date, counting the
  // 9:30 open of each weekday that falls strictly after `from` and at/before `to`.
  const cursor = new Date(from.getTime());
  for (let guard = 0; guard < 400; guard++) {
    const p = etParts(cursor);
    if (p.dow !== 0 && p.dow !== 6) {
      const open = etOpenUtc(p.ymd);
      if (open > from.getTime() && open <= to.getTime()) count++;
    }
    // Step to the next ET date, anchored mid-morning so the date never slips a day
    // when the UTC clock and the ET clock disagree about which day it is.
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(12, 0, 0, 0);
    if (cursor.getTime() > to.getTime() + 86_400_000) break;
  }
  return count;
}

export interface SignalTiming {
  /** Session the signal was born into. */
  bornIn: MarketSession;
  /** True when it fired outside regular hours — no liquid fill was available. */
  bornOutsideHours: boolean;
  /** Regular-session opens since. 0 = you have not missed a session. */
  sessionsSince: number;
  /** Short human label: "9:42am ET" / "4:01pm ET · after close". */
  label: string;
  /** Why it may be unactionable, or null when it's clean. */
  caveat: string | null;
  /** How much to discount it: 'live' | 'watch' | 'stale'. */
  standing: 'live' | 'watch' | 'stale';
}

export function signalTiming(generatedAt: string | Date | null | undefined, now: Date = new Date()): SignalTiming | null {
  if (!generatedAt) return null;
  const d = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  if (isNaN(d.getTime())) return null;

  const bornIn = sessionAt(d);
  const sessionsSince = sessionsElapsed(d, now);

  // Session CLASSIFICATION stays in ET — that is when the market is actually open,
  // and it does not change because the reader lives somewhere else. The DISPLAYED
  // clock is the reader's own zone, because "4:00 pm ET" makes someone in Chicago
  // do arithmetic to work out whether they were at their desk.
  const clock = d
    .toLocaleTimeString('en-US', { timeZone: USER_TIMEZONE, hour: 'numeric', minute: '2-digit' })
    .toLowerCase();
  const tzAbbr = getTimezoneAbbreviation();

  const sessionWord =
    bornIn === 'regular' ? '' :
    bornIn === 'pre' ? ' · pre-market' :
    bornIn === 'post' ? ' · after close' : ' · market closed';

  const label = `${clock} ${tzAbbr}${sessionWord}`;

  let caveat: string | null = null;
  let standing: SignalTiming['standing'] = 'live';

  if (sessionsSince >= 2) {
    caveat = `${sessionsSince} sessions old — re-check the level before acting`;
    standing = 'stale';
  } else if (bornIn !== 'regular' && sessionsSince >= 1) {
    // The exact DHR case: born after hours, and the open has since happened.
    caveat = bornIn === 'post' || bornIn === 'closed'
      ? 'Fired after the close — price gapped before you could act'
      : 'Fired pre-market — the open has since happened';
    standing = 'stale';
  } else if (bornIn !== 'regular') {
    // Fired outside hours but the next open hasn't happened yet: still catchable.
    caveat = bornIn === 'pre' ? 'Pre-market call — fills at the open' : 'No liquid fill until the next open';
    standing = 'watch';
  } else if (sessionsSince === 1) {
    caveat = 'Fired last session';
    standing = 'watch';
  }

  return { bornIn, bornOutsideHours: bornIn !== 'regular', sessionsSince, label, caveat, standing };
}
