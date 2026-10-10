/**
 * EARNINGS CALENDAR — the forward-looking events the catalyst board was missing.
 *
 * The catalyst table holds 406 rows and every one is a PAST SEC filing, so a board
 * that filters to upcoming events found nothing on 83 of 83 live signals. Earnings
 * are the one scheduled, binary, universally-relevant event, and they're exactly
 * what a signal's horizon needs checking against: a swing trade whose thesis needs
 * ten sessions is a different trade when earnings land on day four.
 *
 * Source is Nasdaq's public earnings calendar — no key, no crumb, and it carries
 * the session (pre-market vs after-hours), which matters because an after-hours
 * print gaps the next open rather than moving the session you're in.
 *
 * Deliberately NOT treated as directional. An earnings date says variance is
 * coming, not which way — so downstream this is risk, never bull/bear tilt.
 */
import { logger } from './logger';
import { marketDateET } from '@shared/market-day';

export interface EarningsEvent {
  symbol: string;
  companyName: string;
  /** YYYY-MM-DD, the session it reports on. */
  date: string;
  /** 'pre' = before the open, 'post' = after the close, null = unspecified. */
  session: 'pre' | 'post' | null;
  epsForecast: number | null;
  daysAway: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let _cache: { at: number; events: EarningsEvent[] } | null = null;

function parseSession(t: string | null | undefined): 'pre' | 'post' | null {
  const s = String(t ?? '').toLowerCase();
  if (s.includes('pre-market')) return 'pre';
  if (s.includes('after-hours')) return 'post';
  return null;
}

function parseEps(v: string | null | undefined): number | null {
  if (!v) return null;
  // Values arrive as "$2.33" or "($0.14)" for negatives.
  const neg = /\(.*\)/.test(v);
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** ISO date N calendar days from today, in market time. */
function dateOffset(days: number): string {
  return marketDateET(new Date(Date.now() + days * 86_400_000));
}

async function fetchDay(date: string): Promise<EarningsEvent[]> {
  const { rateLimited } = await import('./provider-cache');
  const json: any = await rateLimited('nasdaq', 400, async () => {
    const r = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    if (!r.ok) return null;
    return r.json();
  });

  const rows: any[] = json?.data?.rows ?? [];
  const today = marketDateET();
  const daysAway = Math.round(
    (new Date(`${date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000,
  );

  return rows
    .map((r) => ({
      symbol: String(r.symbol ?? '').trim().toUpperCase(),
      companyName: String(r.name ?? '').trim(),
      date,
      session: parseSession(r.time),
      epsForecast: parseEps(r.epsForecast),
      daysAway,
    }))
    .filter((e) => e.symbol);
}

/**
 * Upcoming earnings for the next `days` calendar days. Weekends are skipped rather
 * than fetched — companies do not report on a Saturday, and each skipped day is one
 * fewer request against a source we do not want to hammer.
 */
export async function getUpcomingEarnings(days = 21, force = false): Promise<EarningsEvent[]> {
  if (!force && _cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.events;

  const out: EarningsEvent[] = [];
  for (let i = 0; i <= days; i++) {
    const date = dateOffset(i);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    try {
      out.push(...(await fetchDay(date)));
    } catch (err: any) {
      logger.warn(`[EARNINGS] ${date} failed: ${err?.message ?? err}`);
    }
  }

  _cache = { at: Date.now(), events: out };
  logger.info(`[EARNINGS] ${out.length} upcoming reports across ${days} days`);
  return out;
}

/** Earnings map keyed by symbol — the shape the catalyst join wants. */
export async function getEarningsBySymbol(days = 21): Promise<Map<string, EarningsEvent>> {
  const all = await getUpcomingEarnings(days);
  const map = new Map<string, EarningsEvent>();
  for (const e of all) {
    // Keep the SOONEST report per symbol; a later one is not the risk in play.
    const prev = map.get(e.symbol);
    if (!prev || e.daysAway < prev.daysAway) map.set(e.symbol, e);
  }
  return map;
}
