/**
 * ENTRY TIMING — when to take a signal, not just whether.
 *
 * The board says WHAT. The tape gate says WHETHER. Nothing said WHEN, and the
 * evidence is that when matters more than either on some names:
 *
 *   - DHR published at 4:00:57pm ET, 57 seconds after the close.
 *   - TSLA published at 4:47pm the evening before a +5.29% day.
 *   - NVDA earns +111% overnight against −21% intraday over two years. Buying it
 *     at the open and selling into the close has been the losing side of the same
 *     correct directional call.
 *
 * So this answers a narrow question with the ticker's own record: given the
 *  session we are in and how this name distributes its return, is now a moment to
 * act, wait, or hold through?
 *
 * It never says "buy". It says whether the clock is with you or against you.
 */
import { logger } from './logger';
import { computeBaseRates, type Bar } from '@shared/ticker-base-rates';

export type TimingAction = 'act_now' | 'wait_for_open' | 'hold_through_close' | 'too_late_today' | 'no_edge';

export interface EntryTiming {
  action: TimingAction;
  session: 'pre' | 'regular_open' | 'regular_mid' | 'regular_close' | 'post' | 'closed';
  headline: string;
  detail: string;
  /** The overnight/intraday split this was decided on. */
  overnightPct: number | null;
  intradayPct: number | null;
}

const ET = 'America/New_York';

/** Finer-grained than the market-session split: the parts of a day behave differently. */
function sessionNow(d: Date = new Date()): EntryTiming['session'] {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false });
  const p = f.formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[get('weekday')] ?? 1;
  if (dow === 0 || dow === 6) return 'closed';

  const mins = (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10);
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'pre';
  // The first 30 minutes is its own animal: the range is not set and the open
  // auction is still resolving. Treating it as "the session" is how entries get
  // taken into a print that has not settled.
  if (mins >= 9 * 60 + 30 && mins < 10 * 60) return 'regular_open';
  if (mins >= 10 * 60 && mins < 15 * 60 + 30) return 'regular_mid';
  if (mins >= 15 * 60 + 30 && mins < 16 * 60) return 'regular_close';
  if (mins >= 16 * 60 && mins < 20 * 60) return 'post';
  return 'closed';
}

export function evaluateEntryTiming(bars: Bar[], symbol?: string, now: Date = new Date()): EntryTiming {
  const session = sessionNow(now);

  const rates = computeBaseRates(bars, symbol);
  const on = rates?.rates.find((r) => r.key === 'overnight');
  // The base-rate value is formatted "+111% / -21%" — parse both legs back out.
  let overnightPct: number | null = null;
  let intradayPct: number | null = null;
  if (on?.value) {
    const m = on.value.match(/([+-]?\d+)%\s*\/\s*([+-]?\d+)%/);
    if (m) { overnightPct = Number(m[1]); intradayPct = Number(m[2]); }
  }

  const gapCarries = overnightPct != null && intradayPct != null && overnightPct > 0 && intradayPct < 0;
  const sessionCarries = overnightPct != null && intradayPct != null && intradayPct > 0 && overnightPct <= 0;

  const base = (action: TimingAction, headline: string, detail: string): EntryTiming =>
    ({ action, session, headline, detail, overnightPct, intradayPct });

  // Outside hours there is nothing to fill against, whatever the setup says.
  if (session === 'closed') {
    return base('wait_for_open', 'Market closed', 'Nothing fills until the next open. A signal published now is a plan, not an entry.');
  }
  if (session === 'post') {
    return base('too_late_today',
      'After the close',
      'No liquid fill left today. Anything acted on here is really a decision to take the overnight gap — size it as one.');
  }
  if (session === 'pre') {
    return gapCarries
      ? base('act_now', 'Pre-market, and this name pays overnight',
          `${symbol ?? 'This name'} earns ${overnightPct}% overnight against ${intradayPct}% intraday. Being positioned BEFORE the open is where its return actually is.`)
      : base('wait_for_open', 'Pre-market',
          'Thin books before the open mean wide spreads on options. Unless the thesis is the gap itself, the open prices better.');
  }
  if (session === 'regular_open') {
    return base('wait_for_open', 'First 30 minutes',
      'The opening range is not set and the auction is still resolving. Levels taken here are frequently undone by 10am.');
  }
  if (session === 'regular_close') {
    return gapCarries
      ? base('hold_through_close', 'Late session, and the gap is where the money is',
          `${symbol ?? 'This name'} gives back ${Math.abs(intradayPct ?? 0)}% intraday and gains ${overnightPct}% overnight. Closing the position here surrenders the part that pays.`)
      : base('too_late_today', 'Last 30 minutes',
          'Little session left to work with, and holding through the close adds gap risk for a name whose return is intraday.');
  }

  // Mid-session — the normal case.
  if (sessionCarries) {
    return base('act_now', 'Mid-session, and this name pays intraday',
      `${symbol ?? 'This name'} earns ${intradayPct}% during the session against ${overnightPct}% overnight. There is room to work and less reason to carry it overnight.`);
  }
  if (gapCarries) {
    return base('act_now', 'Mid-session — but plan to hold',
      `${symbol ?? 'This name'} earns ${overnightPct}% overnight against ${intradayPct}% intraday. Entering is fine; closing before the bell gives away the part that historically pays.`);
  }

  logger.debug(`[TIMING] ${symbol}: no directional split, session ${session}`);
  return base('no_edge', 'Mid-session',
    'No strong overnight/intraday split in this name — the clock is neutral, so decide on the setup alone.');
}
