/**
 * Economic Calendar Service
 * Static schedule of major U.S. economic events published by the Fed/BLS/BEA.
 * These are deterministic — dates known months in advance.
 */

import { logger } from './logger';

export interface EconomicEvent {
  name: string;
  date: string; // YYYY-MM-DD
  time: string; // ET time string
  importance: 'high' | 'medium' | 'low';
  description: string;
  tradingImpact?: string;
}

// Major economic events for March 2026
// Sources: Federal Reserve calendar, BLS release schedule, BEA advance schedule
const ECONOMIC_EVENTS_2026: EconomicEvent[] = [
  // March 2026
  { name: 'ISM Manufacturing PMI', date: '2026-03-02', time: '10:00 AM ET', importance: 'high', description: 'Manufacturing sector activity — above 50 = expansion', tradingImpact: 'Affects industrials (XLI), commodities (USO, GLD)' },
  { name: 'JOLTS Job Openings', date: '2026-03-04', time: '10:00 AM ET', importance: 'medium', description: 'Job openings and labor turnover survey', tradingImpact: 'Labor market strength indicator' },
  { name: 'ISM Services PMI', date: '2026-03-04', time: '10:00 AM ET', importance: 'high', description: 'Services sector activity — above 50 = expansion', tradingImpact: 'Broad market impact, 70% of GDP' },
  { name: 'ADP Employment', date: '2026-03-05', time: '8:15 AM ET', importance: 'medium', description: 'Private sector employment change — NFP preview', tradingImpact: 'Sets expectations for Friday jobs report' },
  { name: 'Nonfarm Payrolls', date: '2026-03-06', time: '8:30 AM ET', importance: 'high', description: 'Monthly jobs report — unemployment rate, wage growth, job gains', tradingImpact: 'Moves SPY, bonds (TLT), VIX. Biggest monthly data release.' },
  { name: 'Fed Chair Powell Speech', date: '2026-03-07', time: '12:00 PM ET', importance: 'high', description: 'Semi-annual monetary policy testimony', tradingImpact: 'Rate expectations, volatility spike' },
  { name: 'CPI Inflation', date: '2026-03-12', time: '8:30 AM ET', importance: 'high', description: 'Consumer Price Index — headline and core inflation', tradingImpact: 'Major mover for bonds (TLT/TBT), gold (GLD), equities' },
  { name: 'PPI Inflation', date: '2026-03-13', time: '8:30 AM ET', importance: 'medium', description: 'Producer Price Index — wholesale inflation', tradingImpact: 'Leads CPI, affects margin expectations' },
  { name: 'Retail Sales', date: '2026-03-14', time: '8:30 AM ET', importance: 'high', description: 'Monthly consumer spending report', tradingImpact: 'Consumer discretionary (XLY), retail stocks' },
  { name: 'FOMC Rate Decision', date: '2026-03-18', time: '2:00 PM ET', importance: 'high', description: 'Federal Reserve interest rate decision + statement + dot plot', tradingImpact: 'THE event. Moves everything — SPY, TLT, GLD, VIX, USD. Straddle plays common.' },
  { name: 'FOMC Press Conference', date: '2026-03-18', time: '2:30 PM ET', importance: 'high', description: 'Fed Chair Q&A — tone often moves markets more than the decision', tradingImpact: 'Whipsaw risk. Extended hours vol spike.' },
  { name: 'Existing Home Sales', date: '2026-03-20', time: '10:00 AM ET', importance: 'medium', description: 'Housing market activity level', tradingImpact: 'Homebuilders (XHB), mortgage rates, rate-sensitive sectors' },
  { name: 'Initial Jobless Claims', date: '2026-03-20', time: '8:30 AM ET', importance: 'low', description: 'Weekly unemployment claims — labor market health', tradingImpact: 'Trending data; significant only with large surprises' },
  { name: 'S&P Global PMI Flash', date: '2026-03-24', time: '9:45 AM ET', importance: 'medium', description: 'Flash manufacturing & services PMI for March', tradingImpact: 'Early read on economic momentum' },
  { name: 'New Home Sales', date: '2026-03-25', time: '10:00 AM ET', importance: 'medium', description: 'New residential home sales pace', tradingImpact: 'Housing sector, builder stocks' },
  { name: 'Durable Goods Orders', date: '2026-03-26', time: '8:30 AM ET', importance: 'medium', description: 'Orders for long-lasting manufactured goods', tradingImpact: 'Capex indicator — affects industrials (XLI), defense (LMT, RTX)' },
  { name: 'GDP (Q4 Final)', date: '2026-03-27', time: '8:30 AM ET', importance: 'high', description: 'Final Q4 2025 GDP revision — economic growth rate', tradingImpact: 'Broad market impact if revised significantly' },
  { name: 'PCE Price Index', date: '2026-03-28', time: '8:30 AM ET', importance: 'high', description: 'Personal Consumption Expenditures — the Fed\'s PREFERRED inflation measure', tradingImpact: 'Most important inflation read for Fed policy. Moves bonds, gold, equities.' },
  { name: 'Michigan Consumer Sentiment', date: '2026-03-28', time: '10:00 AM ET', importance: 'medium', description: 'Consumer confidence and inflation expectations', tradingImpact: 'Consumer sentiment leading indicator' },

  // April 2026 (preview — next month visibility)
  { name: 'ISM Manufacturing PMI', date: '2026-04-01', time: '10:00 AM ET', importance: 'high', description: 'April manufacturing PMI', tradingImpact: 'Kick-off of new month data cycle' },
  { name: 'Nonfarm Payrolls', date: '2026-04-03', time: '8:30 AM ET', importance: 'high', description: 'March jobs report', tradingImpact: 'Major monthly release' },
  { name: 'CPI Inflation', date: '2026-04-10', time: '8:30 AM ET', importance: 'high', description: 'March CPI — inflation check', tradingImpact: 'Key inflation data point' },
];

/**
 * The cash gate changes grading, so an incomplete calendar must never be
 * presented as "clear". This is deliberately derived from the actual schedule
 * rather than a hand-maintained version number.
 */
export interface CalendarCoverage {
  source: 'curated' | 'finnhub' | 'fred';
  current: boolean;
  firstDate: string | null;
  lastDate: string | null;
}

type FinnhubCalendarRow = {
  country?: string;
  date?: string;
  time?: string;
  event?: string;
  impact?: string;
  actual?: number | string | null;
  estimate?: number | string | null;
  prev?: number | string | null;
};

let liveCache: { expiresAt: number; events: EconomicEvent[] } | null = null;

/**
 * Live-provider-first calendar. The previous service silently stopped at
 * 2026-04-10, yet downstream screens still looked like a functioning calendar.
 * Finnhub's economic calendar is used when the account has access; otherwise we
 * return no events and let the UI say the source is unavailable. We never roll
 * old dates forward or manufacture a recurring release date.
 */
export async function getVerifiedUpcomingEvents(days = 7): Promise<{
  events: EconomicEvent[];
  coverage: CalendarCoverage;
}> {
  const now = new Date();
  const curatedCoverage = getCalendarCoverage(now);
  if (curatedCoverage.current) {
    return { events: getUpcomingEvents(days), coverage: curatedCoverage };
  }

  if (liveCache && liveCache.expiresAt > Date.now()) {
    return {
      events: liveCache.events,
      coverage: { source: 'finnhub', current: liveCache.events.length > 0, firstDate: liveCache.events[0]?.date ?? null, lastDate: liveCache.events.at(-1)?.date ?? null },
    };
  }

  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) return { events: [], coverage: curatedCoverage };

  const date = (value: Date) => value.toISOString().slice(0, 10);
  const end = new Date(now.getTime() + days * 86_400_000);
  try {
    const response = await fetch(`https://finnhub.io/api/v1/calendar/economic?from=${date(now)}&to=${date(end)}&token=${encodeURIComponent(key)}`);
    if (!response.ok) {
      logger.warn(`[ECON-CAL] Finnhub calendar unavailable (${response.status}); stale curated dates will not be shown`);
      liveCache = { expiresAt: Date.now() + 15 * 60_000, events: [] };
      return { events: [], coverage: curatedCoverage };
    }
    const payload = await response.json() as { economicCalendar?: FinnhubCalendarRow[] };
    const events = (payload.economicCalendar ?? [])
      .filter((row) => row.country === 'US' && row.date && row.event)
      .map((row): EconomicEvent => {
        const impact = String(row.impact ?? '').toLowerCase();
        const importance: EconomicEvent['importance'] = impact.includes('high') ? 'high' : impact.includes('medium') ? 'medium' : 'low';
        const facts = [row.estimate != null ? `Forecast ${row.estimate}` : null, row.prev != null ? `Previous ${row.prev}` : null].filter(Boolean).join(' · ');
        return { name: row.event!, date: row.date!.slice(0, 10), time: row.time ? `${row.time} ET` : 'Time TBD', importance, description: facts || 'Verified US economic release', tradingImpact: facts || undefined };
      })
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    liveCache = { expiresAt: Date.now() + 15 * 60_000, events };
    return { events, coverage: { source: 'finnhub', current: events.length > 0, firstDate: events[0]?.date ?? null, lastDate: events.at(-1)?.date ?? null } };
  } catch (error) {
    logger.warn(`[ECON-CAL] live provider failed: ${(error as Error).message}`);
    return { events: [], coverage: curatedCoverage };
  }
}


// ─── FRED-BACKED RELEASE CALENDAR ────────────────────────────────────────────
//
// The curated array below was hand-typed and its last entry is 2026-04-10, so
// from mid-April onward the platform reported "calendar needs refresh" and the
// cash gate ran with no idea when CPI or payrolls were due.
//
// FRED publishes forward release dates for exactly these series and it is free,
// public-domain US government data. Release IDs were discovered from
// /fred/releases rather than guessed.
//
// Deliberately NOT covered here: FOMC rate decisions. There is no FRED release
// for the decision itself, and inventing the dates would be worse than omitting
// them. That needs federalreserve.gov's own calendar as a separate source.
const FRED_RELEASES: Array<{
  id: number;
  name: string;
  time: string;
  importance: EconomicEvent['importance'];
  description: string;
  tradingImpact: string;
}> = [
  { id: 10, name: 'CPI Inflation', time: '8:30 AM ET', importance: 'high',
    description: 'Consumer Price Index — headline and core inflation',
    tradingImpact: 'Major mover for bonds (TLT), gold (GLD), equities' },
  { id: 50, name: 'Nonfarm Payrolls', time: '8:30 AM ET', importance: 'high',
    description: 'Employment Situation — jobs, unemployment rate, wage growth',
    tradingImpact: 'Moves SPY, TLT, VIX. Biggest monthly release.' },
  { id: 54, name: 'PCE Price Index', time: '8:30 AM ET', importance: 'high',
    description: "Personal Income and Outlays — the Fed's preferred inflation measure",
    tradingImpact: 'Most important inflation read for Fed policy' },
  { id: 46, name: 'PPI Inflation', time: '8:30 AM ET', importance: 'medium',
    description: 'Producer Price Index — wholesale inflation',
    tradingImpact: 'Leads CPI; affects margin expectations' },
  { id: 53, name: 'GDP', time: '8:30 AM ET', importance: 'high',
    description: 'Gross Domestic Product — economic growth rate',
    tradingImpact: 'Broad market impact on a large revision' },
  { id: 9, name: 'Retail Sales', time: '8:30 AM ET', importance: 'high',
    description: 'Advance monthly retail and food services sales',
    tradingImpact: 'Consumer discretionary (XLY), retail names' },
  { id: 192, name: 'JOLTS Job Openings', time: '10:00 AM ET', importance: 'medium',
    description: 'Job openings and labor turnover',
    tradingImpact: 'Labor market slack indicator the Fed watches' },
  { id: 13, name: 'Industrial Production', time: '9:15 AM ET', importance: 'medium',
    description: 'Industrial production and capacity utilisation',
    tradingImpact: 'Industrials (XLI), cyclicals' },
];

const FRED_API = 'https://api.stlouisfed.org/fred';
const FRED_TTL_MS = 12 * 60 * 60 * 1000;

let fredEvents: EconomicEvent[] = [];
let fredFetchedAt = 0;
let fredInFlight: Promise<void> | null = null;

/** True once FRED has returned at least one forward release date. */
export function fredCalendarReady(): boolean {
  return fredEvents.length > 0;
}

async function fetchReleaseDates(
  rel: (typeof FRED_RELEASES)[number],
  key: string,
  from: string,
): Promise<EconomicEvent[]> {
  const url =
    `${FRED_API}/release/dates?release_id=${rel.id}&api_key=${key}&file_type=json` +
    `&include_release_dates_with_no_data=true&sort_order=asc&realtime_start=${from}&limit=24`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any = await res.json();
  if (data?.error_message) throw new Error(data.error_message);
  return (data?.release_dates ?? [])
    .map((d: any) => d?.date)
    .filter((d: unknown): d is string => typeof d === 'string')
    .map((date: string) => ({
      name: rel.name,
      date,
      time: rel.time,
      importance: rel.importance,
      description: rel.description,
      tradingImpact: rel.tradingImpact,
    }));
}

/**
 * Refresh the forward calendar from FRED. Safe to call repeatedly — results are
 * cached for 12h and concurrent callers share one in-flight request. Never
 * throws: on failure the curated array remains in use and coverage reports
 * 'curated' so the UI can say so honestly.
 */
export async function refreshFredCalendar(force = false): Promise<void> {
  const key = process.env.FRED_API_KEY?.trim();
  if (!key) return;
  if (!force && fredEvents.length > 0 && Date.now() - fredFetchedAt < FRED_TTL_MS) return;
  if (fredInFlight) return fredInFlight;

  fredInFlight = (async () => {
    const from = new Date().toISOString().slice(0, 10);
    const settled = await Promise.allSettled(
      FRED_RELEASES.map((rel) => fetchReleaseDates(rel, key, from)),
    );
    const next = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    const failed = settled.filter((r) => r.status === 'rejected').length;

    // Only replace the cache on a materially successful pass. A partial failure
    // that returned two releases must not evict a good eight-release calendar.
    if (next.length > 0 && failed < FRED_RELEASES.length / 2) {
      fredEvents = next.sort((a, b) => a.date.localeCompare(b.date));
      fredFetchedAt = Date.now();
      const last = fredEvents.at(-1)?.date ?? '?';
      logger.info(`[ECON-CAL] FRED calendar refreshed — ${fredEvents.length} dates through ${last}` +
        (failed ? ` (${failed} release(s) failed)` : ''));
    } else {
      logger.warn(`[ECON-CAL] FRED refresh returned nothing usable (${failed}/${FRED_RELEASES.length} failed) — keeping curated calendar`);
    }
  })().finally(() => { fredInFlight = null; });

  return fredInFlight;
}

/**
 * The event pool every accessor reads.
 *
 * FRED wins on a same-name-same-date collision so the curated entry does not
 * duplicate it, and the curated array stays as the floor for anything FRED does
 * not publish. Kept synchronous because six callers and three UI surfaces
 * already depend on these being sync.
 */
function allEvents(): EconomicEvent[] {
  if (fredEvents.length === 0) return ECONOMIC_EVENTS_2026;
  const seen = new Set(fredEvents.map((e) => `${e.name}|${e.date}`));
  return [
    ...fredEvents,
    ...ECONOMIC_EVENTS_2026.filter((e) => !seen.has(`${e.name}|${e.date}`)),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export function getCalendarCoverage(now: Date = new Date()): CalendarCoverage {
  const pool = allEvents();
  const dates = pool.map((event) => event.date).sort();
  const firstDate = dates[0] ?? null;
  const lastDate = dates.at(-1) ?? null;
  const today = now.toISOString().slice(0, 10);
  return {
    source: fredEvents.length > 0 ? 'fred' : 'curated',
    current: !!firstDate && !!lastDate && today >= firstDate && today <= lastDate,
    firstDate,
    lastDate,
  };
}

/**
 * Get upcoming economic events within the specified number of days
 */
export function getUpcomingEvents(days: number = 7): EconomicEvent[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // Set now to start of today for inclusive comparison
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return allEvents().filter(event => {
    const eventDate = new Date(event.date + 'T00:00:00');
    return eventDate >= todayStart && eventDate <= cutoff;
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Get today's economic events
 */
export function getTodayEvents(): EconomicEvent[] {
  const today = new Date().toISOString().split('T')[0];
  return allEvents().filter(event => event.date === today);
}

/**
 * Get all events for a specific month
 */
export function getMonthEvents(year: number, month: number): EconomicEvent[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return allEvents().filter(event => event.date.startsWith(prefix));
}

/**
 * Check if there's a high-importance event within N hours
 */
export function hasHighImpactEventSoon(hours: number = 24): EconomicEvent | null {
  const now = new Date();
  const cutoff = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const upcoming = allEvents().filter(event => {
    const eventDate = new Date(event.date + 'T00:00:00');
    return event.importance === 'high' && eventDate >= todayStart && eventDate <= cutoff;
  });

  return upcoming.length > 0 ? upcoming[0] : null;
}

logger.debug('[ECON-CAL] Economic calendar service loaded with ' + ECONOMIC_EVENTS_2026.length + ' events');
