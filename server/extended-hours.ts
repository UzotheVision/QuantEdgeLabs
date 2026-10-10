/**
 * EXTENDED-HOURS LEADERS — who is actually moving before the bell (and after it).
 *
 * The platform previously went blind outside 9:30–16:00: rotation correctly reported
 * "Aug 19 close · stale" and every signal sat still, because regular-session quotes
 * genuinely weren't moving. But pre-market IS where the day's leaders declare
 * themselves — gaps, earnings reactions, news. This reads the extended-hours tape.
 *
 * Yahoo's chart API exposes pre/post bars via includePrePost=true, and marks the current
 * session in meta.currentTradingPeriod. We compare the latest extended-hours print to the
 * prior regular-session close, which is exactly how a gap is quoted.
 */
import { logger } from './logger';

export type Session = 'pre' | 'regular' | 'post' | 'closed';

export interface ExtendedQuote {
  symbol: string;
  lastPrice: number;
  previousClose: number;
  changePct: number;
  session: Session;
  /** UTC time of the last real print. A quote is never "live" without this. */
  asOf: string;
  /** The print belongs to the current US market session and is fresh enough to use. */
  isCurrent: boolean;
  volume: number;
  /** true when the print came from outside the regular session */
  isExtended: boolean;
}

export interface AssetClassRead {
  key: string;
  label: string;
  symbol: string;
  changePct: number | null;
  stance: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | null;
}

export interface ExtendedLeaders {
  generatedAt: string;
  /** Timestamp of the newest print in this sweep, not the fetch time. */
  asOf: string | null;
  session: Session;
  /** All quotes are historic relative to the market clock; do not call this tape live. */
  isStale: boolean;
  scanned: number;
  gainers: ExtendedQuote[];
  losers: ExtendedQuote[];
  mostActive: ExtendedQuote[];
  /** Per-asset-class regime, on the same reliable chart path as the leaders. */
  assetClasses: AssetClassRead[];
  interpretation: string;
}

/**
 * The regime is read per asset class, not as one index number. These proxies were
 * previously fetched through the batch-quote service, which silently DROPPED TLT / UUP /
 * GLD when the providers throttled — leaving three of five classes blank. They now come
 * from the same chart endpoint the leaders use, which is proving reliable.
 */
const ASSET_CLASSES = [
  { key: 'equities', label: 'EQUITIES', symbol: 'SPY' },
  { key: 'bonds',    label: 'BONDS',    symbol: 'TLT' },
  { key: 'dollar',   label: 'DOLLAR',   symbol: 'UUP' },
  { key: 'metals',   label: 'METALS',   symbol: 'GLD' },
  { key: 'crypto',   label: 'CRYPTO',   symbol: 'BTC-USD' },
] as const;

function stanceOf(pct: number): AssetClassRead['stance'] {
  if (pct > 0.3) return 'BULLISH';
  if (pct < -0.3) return 'BEARISH';
  return 'NEUTRAL';
}

/** Which session a unix-second timestamp falls in, per Yahoo's own period bounds. */
function sessionAt(ts: number, periods: any): Session {
  const p = periods || {};
  const inRange = (x: any) => x && ts >= x.start && ts < x.end;
  const first = (v: any) => (Array.isArray(v) ? v[0] : v);
  if (inRange(first(p.pre))) return 'pre';
  if (inRange(first(p.regular))) return 'regular';
  if (inRange(first(p.post))) return 'post';
  return 'closed';
}

/**
 * Yahoo keeps a currentTradingPeriod schedule in chart metadata after the bars
 * themselves have gone stale. On a Sunday that schedule can label Friday's final
 * print "post". The market clock and the print must therefore agree before a
 * response is allowed to represent the current tape.
 */
function easternParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    day: get('weekday'),
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function scheduledSession(now = new Date()): Session {
  const eastern = easternParts(now);
  if (eastern.day === 'Sat' || eastern.day === 'Sun') return 'closed';
  if (eastern.minutes >= 4 * 60 && eastern.minutes < 9 * 60 + 30) return 'pre';
  if (eastern.minutes >= 9 * 60 + 30 && eastern.minutes < 16 * 60) return 'regular';
  if (eastern.minutes >= 16 * 60 && eastern.minutes < 20 * 60) return 'post';
  return 'closed';
}

function printIsCurrent(timestamp: number | undefined, now = new Date()) {
  if (!timestamp || scheduledSession(now) === 'closed') return false;
  const printAt = new Date(timestamp * 1000);
  const sameEasternDate = easternParts(printAt).date === easternParts(now).date;
  // Five-minute bars may lag slightly; anything beyond twenty minutes is history.
  const fresh = now.getTime() - printAt.getTime() <= 20 * 60 * 1000;
  return sameEasternDate && fresh;
}

export async function fetchExtendedQuote(symbol: string): Promise<ExtendedQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
                `?range=1d&interval=5m&includePrePost=true`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    const body = await res.json();
    const r = body?.chart?.result?.[0];
    const meta = r?.meta;
    if (!meta) return null;

    const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? 0);
    if (!previousClose) return null;

    const ts: number[] = r.timestamp || [];
    const closes: number[] = r.indicators?.quote?.[0]?.close || [];
    const vols: number[] = r.indicators?.quote?.[0]?.volume || [];

    // walk back to the most recent bar that actually printed
    let i = closes.length - 1;
    while (i >= 0 && (closes[i] == null || !Number.isFinite(closes[i]))) i--;
    const lastPrice = i >= 0 ? Number(closes[i]) : Number(meta.regularMarketPrice ?? 0);
    if (!lastPrice) return null;

    const barAt = i >= 0 ? ts[i] : undefined;
    const barSession = barAt ? sessionAt(barAt, meta.currentTradingPeriod) : 'closed';
    const isCurrent = printIsCurrent(barAt);
    const volume = i >= 0 ? Number(vols[i] ?? 0) : 0;

    return {
      symbol,
      lastPrice,
      previousClose,
      changePct: ((lastPrice - previousClose) / previousClose) * 100,
      session: isCurrent ? barSession : 'closed',
      asOf: barAt ? new Date(barAt * 1000).toISOString() : new Date().toISOString(),
      isCurrent,
      volume,
      isExtended: isCurrent && (barSession === 'pre' || barSession === 'post'),
    };
  } catch (e: any) {
    logger.warn(`[EXT-HOURS] ${symbol}: ${e?.message}`);
    return null;
  }
}

/** Current session for the market as a whole (from a liquid proxy). */
export async function currentSession(): Promise<Session> {
  const spy = await fetchExtendedQuote('SPY');
  return spy?.session ?? 'closed';
}

export async function getExtendedLeaders(symbols: string[], limit = 10): Promise<ExtendedLeaders> {
  const CONCURRENCY = 8;
  // fold the asset-class proxies into the same sweep so we don't add extra requests
  symbols = Array.from(new Set([...symbols, ...ASSET_CLASSES.map((c) => c.symbol)]));
  const out: ExtendedQuote[] = [];
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(batch.map((s) => fetchExtendedQuote(s)));
    for (const r of rows) if (r) out.push(r);
  }

  const session = out.find((q) => q.symbol === 'SPY')?.session
    ?? (out.length ? out[0].session : 'closed');
  const asOf = out.reduce<string | null>((latest, quote) => !latest || quote.asOf > latest ? quote.asOf : latest, null);
  const isStale = !out.some((quote) => quote.isCurrent);

  const ranked = [...out].sort((a, b) => b.changePct - a.changePct);
  const gainers = ranked.filter((q) => q.changePct > 0).slice(0, limit);
  const losers = ranked.filter((q) => q.changePct < 0).slice(-limit).reverse();
  const mostActive = [...out].sort((a, b) => b.volume - a.volume).slice(0, limit);

  const label = session === 'pre' ? 'Pre-market'
              : session === 'post' ? 'After-hours'
              : session === 'regular' ? 'Regular session' : 'Market closed';
  const interpretation = isStale
    ? asOf ? `Market closed — the latest scanned print is from ${new Date(asOf).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}.` : 'Market closed — no current extended-hours tape.'
    : gainers.length
    ? `${label}: ${gainers[0].symbol} leads ${gainers[0].changePct >= 0 ? '+' : ''}${gainers[0].changePct.toFixed(1)}%` +
      `${gainers[1] ? `, then ${gainers[1].symbol} ${gainers[1].changePct >= 0 ? '+' : ''}${gainers[1].changePct.toFixed(1)}%` : ''}` +
      `${losers[0] ? `. Weakest is ${losers[0].symbol} ${losers[0].changePct.toFixed(1)}%` : ''}.` +
      `${session === 'pre' ? ' These are the names declaring themselves before the bell.' : ''}`
    : `${label}: nothing moving on the scanned names.`;

  const bySym = new Map(out.map((q) => [q.symbol, q]));
  const assetClasses: AssetClassRead[] = ASSET_CLASSES.map((c) => {
    const q = bySym.get(c.symbol);
    const changePct = q ? q.changePct : null;
    return { key: c.key, label: c.label, symbol: c.symbol, changePct, stance: changePct == null ? null : stanceOf(changePct) };
  });

  return {
    generatedAt: new Date().toISOString(), asOf, isStale,
    session, scanned: out.length, gainers, losers, mostActive, assetClasses, interpretation,
  };
}
