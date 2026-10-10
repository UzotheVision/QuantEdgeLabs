/**
 * OPEX CALENDAR — the dates that change how options behave.
 *
 * The platform had no concept of expiration week. An IWM $296P was held into
 * monthly OPEX and settled worthless with no warning anywhere in the app that the
 * date mattered. It matters a great deal: the third Friday is when the largest
 * open interest expires at once, dealer gamma collapses as those contracts roll
 * off, pinning to high-OI strikes peaks, and the Monday after routinely behaves
 * differently because the hedges that were holding price in place are gone.
 *
 * None of that is a forecast. It is a property of the calendar, and a tool that
 * prices options should know what day it is.
 */

const ET = 'America/New_York';

function etParts(d: Date): { y: number; m: number; day: number; dow: number } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const p = f.formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: +get('year'), m: +get('month'), day: +get('day'), dow: dowMap[get('weekday')] ?? 1 };
}

/** The third Friday of a given month, as a YYYY-MM-DD string in market time. */
export function monthlyOpex(year: number, month: number): string {
  // Walk the month counting Fridays. Deliberately not arithmetic on day-of-week
  // offsets — that form is easy to get wrong by one at month boundaries.
  let fridays = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, month - 1, day, 12));
    if (d.getUTCMonth() !== month - 1) break;
    if (d.getUTCDay() === 5) {
      fridays++;
      if (fridays === 3) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }
  return '';
}

export interface OpexContext {
  /** Today, in market time. */
  today: string;
  /** This month's third Friday. */
  thisMonth: string;
  /** The next monthly expiration on or after today. */
  next: string;
  sessionsAway: number;
  isOpexDay: boolean;
  /** Monday–Friday of the expiration week. */
  isOpexWeek: boolean;
  /** The session after a monthly expiry, when the expiring hedges are gone. */
  isPostOpex: boolean;
  /** Quarterly expirations (Mar/Jun/Sep/Dec) carry index-rebalance flow too. */
  isQuarterly: boolean;
  label: string | null;
  note: string | null;
}

function toDate(s: string): number {
  return new Date(`${s}T12:00:00Z`).getTime();
}

/** Trading days between two market dates, weekends excluded. */
function sessionsBetween(fromISO: string, toISO: string): number {
  let count = 0;
  const end = toDate(toISO);
  const cur = new Date(toDate(fromISO));
  while (cur.getTime() < end && count < 400) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export function getOpexContext(now: Date = new Date()): OpexContext {
  const { y, m, day } = etParts(now);
  const today = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const thisMonth = monthlyOpex(y, m);
  // If this month's has passed, the next one is next month's.
  const next = toDate(thisMonth) >= toDate(today)
    ? thisMonth
    : monthlyOpex(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);

  const sessionsAway = toDate(next) >= toDate(today) ? sessionsBetween(today, next) : 0;
  const isOpexDay = today === thisMonth;

  // Expiration WEEK is Monday through Friday of the week containing the third
  // Friday — measured as being within four sessions before it.
  const isOpexWeek = !isOpexDay && next === thisMonth && sessionsAway <= 4;

  // The session after expiry. Anything up to three calendar days covers Fri→Mon.
  const daysSince = (toDate(today) - toDate(thisMonth)) / 86_400_000;
  const isPostOpex = daysSince > 0 && daysSince <= 3;

  const isQuarterly = [3, 6, 9, 12].includes(Number(next.slice(5, 7)));

  let label: string | null = null;
  let note: string | null = null;

  if (isOpexDay) {
    label = isQuarterly ? 'Quarterly OPEX today' : 'Monthly OPEX today';
    note =
      'The largest block of open interest expires at the close. Pinning to high-OI strikes is strongest today, ' +
      'and anything held into the close settles at intrinsic — there is no time value left to salvage.' +
      (isQuarterly ? ' Quarterly expiry adds index-rebalance flow on top.' : '');
  } else if (isOpexWeek) {
    label = `OPEX week · ${sessionsAway} session${sessionsAway === 1 ? '' : 's'} out`;
    note =
      'Monthly expiration is this week. Dealer gamma is concentrated in strikes that are about to roll off, ' +
      'so levels that have been holding may stop holding once they do. Short-dated positions need a plan before Friday.';
  } else if (isPostOpex) {
    label = 'Post-OPEX';
    note =
      'Last Friday\'s expiry cleared a large block of open interest. The hedging that was pinning price is gone, ' +
      'which is why ranges often widen in the sessions after a monthly expiry.';
  }

  return { today, thisMonth, next, sessionsAway, isOpexDay, isOpexWeek, isPostOpex, isQuarterly, label, note };
}
