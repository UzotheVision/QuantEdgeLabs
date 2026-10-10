/**
 * Finnhub adapter — market capitalisation, and a quote path that is not Yahoo.
 * ===========================================================================
 * WHY THIS EXISTS
 * ---------------
 * Every market-cap source in the platform is currently unavailable:
 *
 *   Yahoo          429 Too Many Requests (crumb fetch fails outright)
 *   Alpha Vantage  25 requests/day free tier, already exhausted
 *   Tradier        token not approved for market data
 *   Schwab         not configured
 *
 * The only cap classification left was `MOVERS_UNIVERSE.capTier` in
 * shared/movers-types.ts — a hand-maintained list of 85 symbols, which covered
 * 12 of the 32 names in a recent strongest-movers screen. That is not enough to
 * run a "market cap above $1B" filter, which is the whole point of the screen.
 *
 * Finnhub's free tier gives 60 calls/minute and returns market cap from
 * /stock/profile2 with no OAuth and no weekly re-auth — unlike Schwab, whose
 * refresh token expires every 7 days.
 *
 * SETUP
 * -----
 *   1. Free key at https://finnhub.io/register
 *   2. FINNHUB_API_KEY=... in .env   (the var already exists there, empty)
 *
 * Until a key is present every function here returns null rather than throwing,
 * so callers degrade to "cap unknown" instead of failing.
 *
 * UNITS
 * -----
 * profile2 reports `marketCapitalization` in MILLIONS of the listing currency.
 * It is converted to absolute units here exactly once, because a screen that
 * silently compares millions against a dollars threshold would pass every
 * symbol on the board.
 */

import { logger } from './logger';

const BASE = 'https://finnhub.io/api/v1';

/** Free tier is 60/min. Stay under it — a 429 here costs the whole batch. */
const MAX_PER_MINUTE = 55;
const SPACING_MS = Math.ceil(60_000 / MAX_PER_MINUTE);

/** Caps do not move intraday in any way that matters. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

interface CapEntry { marketCap: number | null; name: string | null; industry: string | null; at: number }
const cache = new Map<string, CapEntry>();

export function isFinnhubConfigured(): boolean {
  return !!(process.env.FINNHUB_API_KEY && process.env.FINNHUB_API_KEY.trim());
}

async function get(path: string): Promise<any | null> {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}token=${key}`);
    if (res.status === 429) {
      logger.warn('[FINNHUB] 429 rate limited — backing off');
      return null;
    }
    if (!res.ok) return null;
    return await res.json();
  } catch (e: any) {
    logger.warn(`[FINNHUB] request failed: ${e?.message ?? e}`);
    return null;
  }
}

/**
 * Market cap in ABSOLUTE currency units (not millions), plus the company's own
 * industry label — which is finer-grained than the platform's 21 hand-defined
 * groups and useful for cross-checking them.
 */
export async function getCompanyProfile(symbol: string): Promise<CapEntry | null> {
  const sym = symbol.toUpperCase();
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const d = await get(`/stock/profile2?symbol=${encodeURIComponent(sym)}`);
  if (!d) return null;

  // profile2 gives marketCapitalization in MILLIONS. Convert once, here.
  const millions = Number(d.marketCapitalization);
  const entry: CapEntry = {
    marketCap: Number.isFinite(millions) && millions > 0 ? millions * 1_000_000 : null,
    name: d.name ?? null,
    industry: d.finnhubIndustry ?? null,
    at: Date.now(),
  };
  cache.set(sym, entry);
  return entry;
}

/**
 * Batch profiles, paced under the free-tier ceiling.
 *
 * Deliberately sequential with spacing rather than parallel: the free tier is a
 * per-minute cap, and firing 32 concurrent requests trips it and returns nothing
 * for the whole screen. A 32-symbol screen takes ~35s cold and is then cached
 * for 12 hours.
 */
export async function getMarketCaps(symbols: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (!isFinnhubConfigured()) return out;

  const wanted = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  let fetched = 0;

  for (const sym of wanted) {
    const cached = cache.get(sym);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      out.set(sym, cached.marketCap);
      continue;
    }
    const p = await getCompanyProfile(sym);
    out.set(sym, p?.marketCap ?? null);
    fetched++;
    if (fetched < wanted.length) await new Promise((r) => setTimeout(r, SPACING_MS));
  }

  if (fetched > 0) {
    const known = Array.from(out.values()).filter((v) => v != null).length;
    logger.info(`[FINNHUB] market caps: ${known}/${wanted.length} resolved (${fetched} fetched, rest cached)`);
  }
  return out;
}

/** Real-time quote. A second opinion when Yahoo is rate-limited. */
export async function getFinnhubQuote(symbol: string): Promise<{ price: number; changePct: number } | null> {
  const d = await get(`/quote?symbol=${encodeURIComponent(symbol.toUpperCase())}`);
  if (!d || typeof d.c !== 'number' || d.c <= 0) return null;
  return { price: d.c, changePct: typeof d.dp === 'number' ? d.dp : 0 };
}

/**
 * Next scheduled earnings date, from Finnhub's free earnings calendar.
 *
 * The catalysts scorer read this only from Yahoo's `calendarEvents`, so when
 * Yahoo 429'd it reported "No upcoming earnings data" — including on ADSK,
 * WDAY and AFRM on the afternoon they all reported. A catalyst scorer that
 * cannot see the catalyst is the worst single failure in the engine, because
 * earnings is exactly when the score is consulted.
 *
 * `hour` is 'bmo' | 'amc' | '' — the before/after-close flag, which decides
 * whether a day trade published this morning survives the print.
 */
export async function getNextEarningsDate(
  symbol: string
): Promise<{ date: string; hour: string; epsEstimate: number | null } | null> {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + 120);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const d = await get(
    `/calendar/earnings?from=${iso(from)}&to=${iso(to)}&symbol=${encodeURIComponent(symbol.toUpperCase())}`
  );
  const rows: any[] = d?.earningsCalendar ?? [];
  if (!rows.length) return null;

  // Finnhub returns ascending by date, but sort rather than trust it.
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const next = rows[0];
  if (!next?.date) return null;
  return {
    date: next.date,
    hour: String(next.hour ?? ''),
    epsEstimate: typeof next.epsEstimate === 'number' ? next.epsEstimate : null,
  };
}

/**
 * The ten ratios grade-calculator.ts actually reads, from Finnhub /stock/metric.
 *
 * WHY A THIRD SOURCE
 * fundamental-data-provider has exactly two, and both are dead:
 *   Yahoo quoteSummary   429
 *   Alpha Vantage        "standard API rate limit is 25 requests per day"
 * so getFundamentals() returned null and the fundamental scorer emitted a bare
 * 50 with an EMPTY breakdown — no error, no "unavailable", just a number. That
 * is the most misleading of the placeholder failures because nothing in the
 * output distinguishes it from a genuine middling grade.
 *
 * /stock/metric?metric=all is free tier, returns 133 fields, and covers all ten
 * ratios the calculator consumes.
 *
 * UNITS: Finnhub reports margins and growth as PERCENTAGES (62.97 = 62.97%),
 * which is the convention grade-calculator already expects — verified against
 * its threshold constants, not assumed.
 */
export async function getFinnhubRatios(symbol: string): Promise<{
  peRatio: number | null; pbRatio: number | null; pegRatio: number | null;
  priceToSales: number | null; roe: number | null; netMargin: number | null;
  debtToEquity: number | null; currentRatio: number | null;
  revenueGrowthYoY: number | null; epsGrowthYoY: number | null;
} | null> {
  const d = await get(`/stock/metric?symbol=${encodeURIComponent(symbol.toUpperCase())}&metric=all`);
  const m = d?.metric;
  if (!m) return null;

  const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  const out = {
    peRatio: num(m.peTTM) ?? num(m.peBasicExclExtraTTM),
    pbRatio: num(m.pbQuarterly) ?? num(m.pb),
    pegRatio: num(m.pegTTM),
    priceToSales: num(m.psTTM) ?? num(m.psAnnual),
    roe: num(m.roeTTM) ?? num(m.roeRfy),
    netMargin: num(m.netProfitMarginTTM) ?? num(m.netProfitMarginAnnual),
    // Finnhub's key is literally "totalDebt/totalEquityQuarterly" — the slash is
    // part of the field name, so it must be indexed, not dotted.
    debtToEquity: num(m['totalDebt/totalEquityQuarterly']) ?? num(m['totalDebt/totalEquityAnnual']),
    currentRatio: num(m.currentRatioQuarterly) ?? num(m.currentRatioAnnual),
    revenueGrowthYoY: num(m.revenueGrowthTTMYoy) ?? num(m.revenueGrowthQuarterlyYoy),
    epsGrowthYoY: num(m.epsGrowthTTMYoy) ?? num(m.epsGrowthQuarterlyYoy),
  };

  // All-null means the symbol resolved but carries no fundamentals (an ETF, a
  // recent listing). Treat that as no data rather than ten null ratios, which
  // would score as if every metric were genuinely absent.
  if (Object.values(out).every((v) => v == null)) return null;
  return out;
}
