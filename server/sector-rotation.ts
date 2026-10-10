/**
 * SECTOR ROTATION / MONEY-FLOW ENGINE
 * ===================================
 * The "where is the money going?" service — the STAPLE headline brief.
 *
 * Ron's edge in one sentence: *follow the money flow.* When chips are
 * bleeding -7% and pharma is +2.5%, you do NOT want to be long the sector
 * money is fleeing — no matter how clean the chart looks. QuantEdge was
 * blind to this: it would flag 15 semis as ELITE BULLISH on the exact
 * morning the whole group got wrecked.
 *
 * This engine measures *relative* rotation (sector vs SPY), not absolute
 * change, so a broad selloff doesn't penalise everything — only the names
 * that are *underperforming the tape*. That is exactly the rotation signal.
 *
 * Two consumers:
 *   1. RotationBrief  → shared headline component (Hunt / GEX / Home)
 *   2. getRotationForSector() → strong penalty/boost fed into convictions
 *
 * Pre-market aware: when marketState === 'PRE' it uses pre-market change so
 * the brief is live before the open (when rotation is most actionable).
 *
 * No fabrication: every number comes from live Yahoo chart data. Missing
 * data → that sector is simply omitted, never invented.
 */

import { logger } from './logger';
import type { Sector } from '@shared/approved-tickers';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type FlowState = 'INFLOW' | 'OUTFLOW' | 'NEUTRAL';

export interface SectorFlow {
  etf: string;
  name: string;
  change: number;        // effective change now (pre-mkt if PRE, else today) %
  relChange: number;     // change minus SPY change (relative rotation) %
  fiveDayChange: number; // 5-day momentum %
  /**
   * TRUE RRG COORDINATES — both centred on 0.
   *
   * rsRatio    = how strong the sector is RELATIVE TO SPY versus its own recent
   *              norm. Positive means it's outperforming more than it usually does.
   * rsMomentum = whether that relative strength is BUILDING or FADING (the rate of
   *              change of rsRatio).
   *
   * These replace (relChange, fiveDayChange) as the plot axes. Those two were both
   * measures of recent performance — today's move is literally a component of the
   * 5-day move — so they correlated near-perfectly, every sector collapsed onto a
   * diagonal, and the IMPROVING / WEAKENING quadrants could never populate. Strength
   * and the *direction* of strength are genuinely independent, which is the entire
   * premise of a rotation graph: a sector can be strong but fading, or weak but
   * turning up. Null when there isn't enough daily history to compute them.
   */
  rsRatio: number | null;
  rsMomentum: number | null;
  state: FlowState;
  rank: number;          // 1 = strongest inflow
}

export interface RotationBrief {
  asOf: string;
  marketState: 'PRE' | 'OPEN' | 'AFTER' | 'CLOSED';
  /** Epoch ms of the latest data bar (last completed/active session). */
  sessionAtMs: number;
  /** Human label for the data's session, e.g. "Jun 3 close" or "Live". */
  sessionLabel: string;
  /** True when the latest data bar is from a session before "today" (stale). */
  isStale: boolean;
  spyChange: number;
  // Headline money-flow sentence, e.g.
  // "Money rotating OUT of Semis −3.3% · Tech −1.1% → INTO Pharma +2.5% · Health +1.8%"
  headline: string;
  leaders: SectorFlow[];   // strongest inflows (relChange > 0)
  laggards: SectorFlow[];  // strongest outflows (relChange < 0)
  sectors: SectorFlow[];   // all, ranked by relChange desc
  hasRotation: boolean;    // is there a meaningful divergence to act on?
}

// ═══════════════════════════════════════════════════════════════
// UNIVERSE — sector ETFs + the few group-specific funds we map to
// ═══════════════════════════════════════════════════════════════

const BENCHMARK = 'SPY';

const ROTATION_ETFS: { symbol: string; name: string }[] = [
  { symbol: 'XLK',  name: 'Tech' },
  { symbol: 'SMH',  name: 'Semis' },
  { symbol: 'IGV',  name: 'Software' },
  { symbol: 'XLF',  name: 'Financials' },
  { symbol: 'XLV',  name: 'Health' },
  { symbol: 'XBI',  name: 'Biotech' },
  { symbol: 'XLE',  name: 'Energy' },
  { symbol: 'XLI',  name: 'Industrials' },
  { symbol: 'XLY',  name: 'Cons Disc' },
  { symbol: 'XLP',  name: 'Staples' },
  { symbol: 'XLU',  name: 'Utilities' },
  { symbol: 'XLRE', name: 'Real Estate' },
  { symbol: 'XLB',  name: 'Materials' },
  { symbol: 'XLC',  name: 'Comms' },
  { symbol: 'ITA',  name: 'Defense' },
];

// Conviction-engine Sector → the ETF whose tape best represents it.
const SECTOR_TO_ETF: Record<Sector, string | null> = {
  semi_equipment: 'SMH',
  optics: 'SMH',
  chips: 'SMH',
  ai_infra: 'SMH',
  quantum: 'SMH',
  software: 'IGV',
  cybersecurity: 'IGV',
  fintech: 'XLF',
  mega_tech: 'XLK',
  robotics: 'XLK',
  space: 'ITA',
  defense: 'ITA',
  energy: 'XLE',
  biotech: 'XBI',
  pharma: 'XLV',
  healthcare: 'XLV',
  ev_mobility: 'XLY',
  // GDX is the miners' own tape — the right benchmark for the complex, and a
  // far better read on it than any broad-market sector ETF would give.
  precious_metals: 'GDX',
  crypto: null,   // no clean ETF in universe — skip rather than fabricate
  index: 'SPY',
  other: null,
};

// ═══════════════════════════════════════════════════════════════
// FETCH
// ═══════════════════════════════════════════════════════════════

interface RawQuote {
  symbol: string;
  change: number;          // today regular change %
  preMarketChange: number | null;
  fiveDayChange: number;
  marketState: string;
  sessionAtMs: number;     // epoch ms of the latest bar (regularMarketTime)
}

/** A provider session label is only trusted when it agrees with the NYSE clock. */
function easternClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    weekday: get('weekday'),
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function scheduledMarketState(now = new Date()): RotationBrief['marketState'] {
  const eastern = easternClock(now);
  if (eastern.weekday === 'Sat' || eastern.weekday === 'Sun') return 'CLOSED';
  if (eastern.minutes >= 4 * 60 && eastern.minutes < 9 * 60 + 30) return 'PRE';
  if (eastern.minutes >= 9 * 60 + 30 && eastern.minutes < 16 * 60) return 'OPEN';
  if (eastern.minutes >= 16 * 60 && eastern.minutes < 20 * 60) return 'AFTER';
  return 'CLOSED';
}

function isFreshCurrentEasternPrint(atMs: number, now = new Date()) {
  if (!atMs || scheduledMarketState(now) === 'CLOSED') return false;
  return easternClock(new Date(atMs)).date === easternClock(now).date
    && now.getTime() - atMs <= 20 * 60 * 1000;
}

async function fetchQuote(symbol: string): Promise<RawQuote | null> {
  try {
    // Rotation does not stop at 16:00. Money rotates through the overnight and
    // pre-market session, and by the open the leadership is often already decided.
    // Reading only daily CLOSES froze this map every night, so we read INTRADAY bars
    // with pre/post included and take the most recent print — which is the live price
    // during the regular session and the extended-hours price outside it.
    const intradayUrl =
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=15m&includePrePost=true`;
    const r = await fetch(intradayUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j: any = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const m = res.meta;

    const closes: number[] = res.indicators?.quote?.[0]?.close || [];
    const stamps: number[] = res.timestamp || [];

    // most recent bar that actually printed (this is the extended-hours price at night)
    let i = closes.length - 1;
    while (i >= 0 && (closes[i] == null || !Number.isFinite(closes[i]))) i--;
    if (i < 0) return null;
    const last = Number(closes[i]);
    const sessionAtMs = (stamps[i] ?? m.regularMarketTime ?? 0) * 1000;

    // baseline = the PRIOR session's last regular-hours print, derived from the
    // series itself. NEVER m.chartPreviousClose here: on a 5d range Yahoo sets
    // it to the close before the RANGE (5+ sessions back), which made "today's
    // change" a week's cumulative move — SMH read +10.1% "Live" while the real
    // tape printed −1.1% (found 2026-09-23; every rotation panel was wrong
    // during live sessions).
    const etDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const etMinutes = (ms: number) => {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
      return Number(p.find((x) => x.type === 'hour')?.value ?? 0) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0);
    };
    const lastDate = etDate(sessionAtMs);
    let prevClose = 0;
    for (let k = i; k >= 0; k--) {
      if (closes[k] == null || !Number.isFinite(closes[k])) continue;
      const tMs = (stamps[k] ?? 0) * 1000;
      if (etDate(tMs) === lastDate) continue;            // still the current session
      const mins = etMinutes(tMs);
      if (mins < 9 * 60 + 30 || mins > 16 * 60) continue; // want the regular-hours close
      prevClose = Number(closes[k]);
      break;
    }
    if (!prevClose) prevClose = Number(m.previousClose ?? m.chartPreviousClose ?? 0);
    const regNow = Number(m.regularMarketPrice ?? last);
    if (!prevClose) return null;

    const change = +(((last - prevClose) / prevClose) * 100).toFixed(2);

    // extended-hours delta: how far the latest print has moved past the regular close
    const extendedChange =
      regNow && last !== regNow ? +(((last - regNow) / regNow) * 100).toFixed(2) : null;

    // five-day momentum from the same series (first available print in the window)
    let f = 0;
    while (f < closes.length && (closes[f] == null || !Number.isFinite(closes[f]))) f++;
    const first = f < closes.length ? Number(closes[f]) : last;
    const fiveDayChange = first ? +(((last - first) / first) * 100).toFixed(2) : 0;

    const marketState = isFreshCurrentEasternPrint(sessionAtMs)
      ? scheduledMarketState()
      : String(m.marketState || '').toUpperCase();

    return {
      symbol,
      change,
      preMarketChange: extendedChange,
      fiveDayChange,
      marketState,
      sessionAtMs,
    };
  } catch (e: any) {
    logger.warn(`[sector-rotation] failed ${symbol}: ${e?.message || e}`);
    return null;
  }
}


/**
 * Derive an honest session label + stale flag from the latest bar time.
 * Yahoo's `marketState` is often missing in our environment, so we never
 * pretend data is "live" when it isn't — if the newest bar predates today,
 * we say so plainly ("Jun 3 close") instead of masquerading as current flow.
 */
function deriveSession(sessionAtMs: number, marketState: string): {
  label: string;
  state: RotationBrief['marketState'];
  isStale: boolean;
} {
  if (!sessionAtMs) return { label: 'no data', state: 'CLOSED', isStale: true };

  const sessDay = new Date(sessionAtMs);
  const now = new Date();
  const sameDay = easternClock(sessDay).date === easternClock(now).date;

  const dateStr = sessDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Fresh print + actual market clock outrank stale Yahoo metadata. This prevents
  // a valid 09:04 ET pre-market quote being labelled as the day's closing print.
  if (sameDay && isFreshCurrentEasternPrint(sessionAtMs, now)) {
    const scheduled = scheduledMarketState(now);
    if (scheduled === 'PRE') return { label: 'Pre-market', state: 'PRE', isStale: false };
    if (scheduled === 'OPEN') return { label: 'Live', state: 'OPEN', isStale: false };
    if (scheduled === 'AFTER') return { label: 'After hours', state: 'AFTER', isStale: false };
  }

  // A provider can retain PRE after a Friday close. Only honour that state when
  // the data itself belongs to today's session.
  const ms = (marketState || '').toUpperCase();
  if (sameDay && ms === 'PRE') return { label: 'Pre-market', state: 'PRE', isStale: false };
  if (sameDay && ms === 'REGULAR') return { label: 'Live', state: 'OPEN', isStale: false };
  if (sameDay && (ms === 'POST' || ms === 'POSTPOST')) return { label: 'After hours', state: 'AFTER', isStale: false };

  // No marketState → infer from freshness.
  if (sameDay) return { label: `${dateStr} close`, state: 'CLOSED', isStale: false };
  return { label: `${dateStr} close`, state: 'CLOSED', isStale: true };
}

// ═══════════════════════════════════════════════════════════════
// CLASSIFY
// ═══════════════════════════════════════════════════════════════

const INFLOW_THRESHOLD = 0.4;   // relChange % to count as a real inflow/outflow

function effectiveChange(q: RawQuote): number {
  // Pre-market: the regular "today" change is stale (yesterday). Use pre-mkt.
  if (q.marketState === 'PRE' && q.preMarketChange != null) return q.preMarketChange;
  return q.change;
}

function classify(relChange: number): FlowState {
  if (relChange >= INFLOW_THRESHOLD) return 'INFLOW';
  if (relChange <= -INFLOW_THRESHOLD) return 'OUTFLOW';
  return 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════
// CACHE + MAIN
// ═══════════════════════════════════════════════════════════════

let _cache: { at: number; brief: RotationBrief } | null = null;
const TTL_MS = 90 * 1000; // matches leadership cadence; RRG axes stay based on daily closes


/** Daily closes for the RS computation. Cached hard — this data changes once a day. */
async function fetchDailyCloses(symbol: string): Promise<number[]> {
  const { cachedFetch } = await import('./provider-cache');
  return cachedFetch(`rrg:${symbol}`, 6 * 60 * 60 * 1000, async () => {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=6mo&interval=1d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return [];
    const j: any = await r.json();
    const closes: number[] = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    return closes.filter((c: any) => Number.isFinite(c) && c > 0);
  });
}

const RS_NORM_WINDOW = 40;  // trading days the ratio is normalised against (~2 months)
const RS_MOM_LOOKBACK = 10; // days over which we measure whether RS is building

/**
 * JdK-style RS-Ratio / RS-Momentum, simplified but faithful to the construction.
 *
 * ratio(t)      = sector(t) / benchmark(t)          — raw relative strength
 * rsRatio(t)    = ratio(t) / mean(ratio, N) − 1     — strength vs its OWN norm
 * rsMomentum(t) = rsRatio(t) − rsRatio(t − k)       — is that strength building?
 *
 * Normalising against the sector's own recent average is what makes the axes
 * comparable across sectors: without it, an ETF that structurally trades at a
 * higher ratio to SPY would sit permanently on one side of the chart regardless
 * of whether anything was actually rotating.
 */
function computeRs(
  sectorCloses: number[],
  benchCloses: number[],
): { rsRatio: number; rsMomentum: number } | null {
  const n = Math.min(sectorCloses.length, benchCloses.length);
  if (n < RS_NORM_WINDOW + RS_MOM_LOOKBACK + 1) return null;

  // Align from the right — the two series may start on different dates.
  const sec = sectorCloses.slice(-n);
  const ben = benchCloses.slice(-n);
  const ratio = sec.map((v, i) => v / ben[i]).filter((v) => Number.isFinite(v) && v > 0);
  if (ratio.length < RS_NORM_WINDOW + RS_MOM_LOOKBACK + 1) return null;

  const rsAt = (idx: number): number | null => {
    const start = idx - RS_NORM_WINDOW + 1;
    if (start < 0) return null;
    const win = ratio.slice(start, idx + 1);
    const mean = win.reduce((a, b) => a + b, 0) / win.length;
    if (!(mean > 0)) return null;
    return (ratio[idx] / mean - 1) * 100;
  };

  const now = rsAt(ratio.length - 1);
  const then = rsAt(ratio.length - 1 - RS_MOM_LOOKBACK);
  if (now == null || then == null) return null;

  return {
    rsRatio: +now.toFixed(2),
    rsMomentum: +(now - then).toFixed(2),
  };
}

export async function getSectorRotation(force = false): Promise<RotationBrief> {
  if (!force && _cache && Date.now() - _cache.at < TTL_MS) return _cache.brief;

  const fetchedQuotes = await Promise.all([
    fetchQuote(BENCHMARK),
    ...ROTATION_ETFS.map(e => fetchQuote(e.symbol)),
  ]);
  let spy = fetchedQuotes[0];
  const rest = fetchedQuotes.slice(1);

  // Daily history for the RRG axes. Heavily cached (6h) because daily closes only
  // change once a day, so this costs one round of requests per session, not per view.
  const benchDaily = await fetchDailyCloses(BENCHMARK).catch(() => [] as number[]);
  const sectorDaily = await Promise.all(
    ROTATION_ETFS.map(e => fetchDailyCloses(e.symbol).catch(() => [] as number[])),
  );

  // Yahoo occasionally omits one otherwise-live ETF (SMH and XLK were both
  // missing on 2026-09-25), and the old code silently removed that sector from
  // the map. Fall back to the platform's batch quote service: absence from one
  // provider is unknown data, not evidence that a sector stopped existing.
  const missingSymbols = [
    ...(spy ? [] : [BENCHMARK]),
    ...ROTATION_ETFS.filter((_, i) => !rest[i]).map((e) => e.symbol),
  ];
  if (missingSymbols.length > 0) {
    try {
      const { getRealtimeBatchQuotes } = await import('./realtime-pricing-service');
      const fallback = await getRealtimeBatchQuotes(
        missingSymbols.map((symbol) => ({ symbol, assetType: 'stock' as const })),
      );
      const fromFallback = (symbol: string, closes: number[]): RawQuote | null => {
        const q = fallback.get(symbol);
        if (!q || !Number.isFinite(q.price) || !Number.isFinite(q.changePercent)) return null;
        const base = closes.length >= 6 ? closes[closes.length - 6] : 0;
        const fiveDayChange = base > 0 ? ((q.price - base) / base) * 100 : 0;
        return {
          symbol,
          change: Number(q.changePercent),
          preMarketChange: null,
          fiveDayChange: +fiveDayChange.toFixed(2),
          marketState: scheduledMarketState(),
          sessionAtMs: Date.now(),
        };
      };
      if (!spy) spy = fromFallback(BENCHMARK, benchDaily);
      ROTATION_ETFS.forEach((e, i) => {
        if (!rest[i]) rest[i] = fromFallback(e.symbol, sectorDaily[i] ?? []);
      });
    } catch (err: any) {
      logger.warn(`[sector-rotation] batch fallback failed: ${err?.message ?? err}`);
    }
  }

  // Session timing — use the freshest bar across all fetched ETFs.
  const allQuotes = [spy, ...rest].filter((q): q is RawQuote => !!q);
  const sessionAtMs = allQuotes.reduce((mx, q) => Math.max(mx, q.sessionAtMs), 0);
  const rawState = spy?.marketState || rest.find(r => r)?.marketState || '';
  const { label: sessionLabel, state: marketState, isStale } = deriveSession(sessionAtMs, rawState);

  const spyChange = spy ? effectiveChange(spy) : 0;

  const sectors: SectorFlow[] = rest
    .map((q, i) => {
      if (!q) return null;
      const meta = ROTATION_ETFS[i];
      const chg = effectiveChange(q);
      const relChange = +(chg - spyChange).toFixed(2);
      const rs = benchDaily.length ? computeRs(sectorDaily[i] ?? [], benchDaily) : null;
      return {
        etf: meta.symbol,
        name: meta.name,
        change: chg,
        relChange,
        fiveDayChange: q.fiveDayChange,
        rsRatio: rs?.rsRatio ?? null,
        rsMomentum: rs?.rsMomentum ?? null,
        state: classify(relChange),
        rank: 0,
      } as SectorFlow;
    })
    .filter((s): s is SectorFlow => s !== null)
    .sort((a, b) => b.relChange - a.relChange)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  const leaders = sectors.filter(s => s.state === 'INFLOW').slice(0, 3);
  const laggards = sectors.filter(s => s.state === 'OUTFLOW').slice(-3).reverse();

  const hasRotation = leaders.length > 0 && laggards.length > 0;

  const fmt = (s: SectorFlow) =>
    `${s.name} ${s.change >= 0 ? '+' : ''}${s.change.toFixed(1)}%`;

  // When the data is from a prior session we describe it in the past tense and
  // tag the session, so it never reads as a live "right now" rotation claim.
  const verb = isStale ? `Last session (${sessionLabel}): money rotated` : 'Money rotating';

  let headline: string;
  if (hasRotation) {
    headline =
      `${verb} OUT of ${laggards.map(fmt).join(' · ')} ` +
      `→ INTO ${leaders.map(fmt).join(' · ')}`;
  } else if (leaders.length > 0) {
    headline = `Buyers crowding into ${leaders.map(fmt).join(' · ')} — no clear funding source yet`;
  } else if (laggards.length > 0) {
    headline = `Selling concentrated in ${laggards.map(fmt).join(' · ')} — broad de-risking`;
  } else {
    headline = `No clear sector rotation — money sitting still`;
  }

  const brief: RotationBrief = {
    asOf: new Date().toISOString(),
    marketState,
    sessionAtMs,
    sessionLabel,
    isStale,
    spyChange: +spyChange.toFixed(2),
    headline,
    leaders,
    laggards,
    sectors,
    hasRotation,
  };

  _cache = { at: Date.now(), brief };
  return brief;
}

// ═══════════════════════════════════════════════════════════════
// PER-SECTOR SIGNAL — consumed by the conviction engine
// ═══════════════════════════════════════════════════════════════

export interface RotationSignal {
  etf: string;
  name: string;
  state: FlowState;
  change: number;
  relChange: number;
  fiveDayChange: number;
}

/**
 * Resolve the live rotation state for a conviction Sector. Returns null when
 * the sector has no mapped ETF or data is unavailable (never fabricates).
 */
export async function getRotationForSector(sector: Sector): Promise<RotationSignal | null> {
  const etf = SECTOR_TO_ETF[sector];
  if (!etf) return null;
  const brief = await getSectorRotation();
  if (etf === 'SPY') {
    return { etf: 'SPY', name: 'S&P 500', state: 'NEUTRAL', change: brief.spyChange, relChange: 0, fiveDayChange: 0 };
  }
  const sf = brief.sectors.find(s => s.etf === etf);
  if (!sf) return null;
  return {
    etf: sf.etf,
    name: sf.name,
    state: sf.state,
    change: sf.change,
    relChange: sf.relChange,
    fiveDayChange: sf.fiveDayChange,
  };
}

// ═══════════════════════════════════════════════════════════════
// MULTI-TIMEFRAME ROTATION MATRIX
// ═══════════════════════════════════════════════════════════════
//
// The one-line brief answers "where did money go today?". The matrix answers
// the deeper question the morning brief carries: where is leadership building
// or rolling over ACROSS time — hourly, daily, weekly, monthly — and what is
// the rotation PATTERN (who is the money leaving, who is it moving into)?
//
// Each sector is placed in an RRG-style quadrant from two numbers measured
// RELATIVE to SPY (so a broad selloff doesn't paint everyone red):
//   • rsRatio    = relative leadership LEVEL  (1-month relative return)
//   • rsMomentum = is that lead ACCELERATING? (weekly pace vs monthly pace)
//
//        rsRatio>0, momentum≥0 → LEADING    (money parked, confirmed)
//        rsRatio>0, momentum<0 → WEAKENING  (leadership fading — money leaving)
//        rsRatio≤0, momentum≥0 → IMPROVING  (early money rotating IN)
//        rsRatio≤0, momentum<0 → LAGGING    (out of favor)
//
// No fabrication: a timeframe with insufficient bars is returned as null and
// rendered as "—", never guessed.

export type RotTF = '1H' | '1D' | '1W' | '1M' | '3M';
export const ROT_TIMEFRAMES: RotTF[] = ['1H', '1D', '1W', '1M', '3M'];

export type Quadrant = 'leading' | 'improving' | 'weakening' | 'lagging';

/**
 * Predictive pattern stats mined from ~1y of daily relative-vs-SPY returns.
 * Two orthogonal edges: WHEN a sector tends to lead (day-of-week seasonality)
 * and HOW its relative strength behaves day-to-day (trend-follows vs mean-reverts,
 * via lag-1 autocorrelation), plus the live streak and its historical follow-through.
 * Every field is null when the sample is too small — never fabricated.
 */
export interface SectorPredict {
  bestDay: string | null;          // weekday it leads SPY most, e.g. "Tue"
  bestDayRel: number | null;       // avg relative return on that weekday (%)
  worstDay: string | null;
  worstDayRel: number | null;
  autocorr: number | null;         // lag-1 autocorrelation of daily rel returns
  behavior: 'trend-follows' | 'mean-reverts' | 'random' | null;
  streak: number;                  // current consecutive same-sign rel-day streak
  streakDir: 'up' | 'down' | 'flat';
  edgeAfterStreak: number | null;  // avg next-day rel return after a 2+ day streak this dir (%)
  note: string;                    // plain-English, actionable
}

export interface SectorRotationRow {
  etf: string;
  name: string;
  abs: Record<RotTF, number | null>;   // absolute return per timeframe (%)
  rel: Record<RotTF, number | null>;   // relative-to-SPY return per timeframe (% pts)
  rank: Record<RotTF, number | null>;  // leadership rank (1 = strongest) per timeframe
  quadrant: Quadrant;
  rsRatio: number;                     // 1-month relative leadership level
  rsMomentum: number;                  // accel: weekly pace vs monthly pace
  trend: 'accelerating' | 'rolling' | 'steady';
  pattern: string;                     // human-readable pattern
  spark: number[];                     // cumulative relative-vs-SPY, last ~20 daily bars
  predict: SectorPredict | null;       // mined predictive patterns (day-of-week, persistence)
}

export interface RotationMatrixData {
  asOf: string;
  sessionLabel: string;
  isStale: boolean;
  spyChange: number;
  timeframes: RotTF[];
  rows: SectorRotationRow[];           // sorted by leadership (quadrant, then rsRatio)
  narrative: string[];                 // pattern callouts
  rotations: { from: string; to: string }[];
  predictive: string[];                // mined predictive-pattern callouts (seasonality, persistence)
}

interface History { closes: number[]; ts: number[]; }

async function fetchHistory(symbol: string, range: string, interval: string): Promise<History | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j: any = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const rawCloses: any[] = res.indicators?.quote?.[0]?.close || [];
    const rawTs: any[] = res.timestamp || [];
    const closes: number[] = [];
    const ts: number[] = [];
    for (let i = 0; i < rawCloses.length; i++) {
      if (rawCloses[i] != null) { closes.push(rawCloses[i]); ts.push((rawTs[i] || 0) * 1000); }
    }
    if (closes.length < 2) return null;
    return { closes, ts };
  } catch (e: any) {
    logger.warn(`[rotation-matrix] history failed ${symbol}: ${e?.message || e}`);
    return null;
  }
}

// % return over `barsBack` bars (null if not enough history).
function pctOver(closes: number[] | undefined, barsBack: number): number | null {
  if (!closes || closes.length < barsBack + 1) return null;
  const last = closes[closes.length - 1];
  const ref = closes[closes.length - 1 - barsBack];
  if (!ref) return null;
  return ((last - ref) / ref) * 100;
}

// Cumulative relative-vs-SPY performance over the last n daily bars (for sparkline).
function buildRelSpark(etf: number[], spy: number[], n: number): number[] {
  const len = Math.min(etf.length, spy.length, n + 1);
  if (len < 2) return [];
  const e = etf.slice(etf.length - len);
  const s = spy.slice(spy.length - len);
  const be = e[0], bs = s[0];
  if (!be || !bs) return [];
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    out.push(+(((e[i] / be - 1) - (s[i] / bs - 1)) * 100).toFixed(2));
  }
  return out;
}

function quad(ratio: number, momentum: number): Quadrant {
  if (ratio > 0) return momentum >= 0 ? 'leading' : 'weakening';
  return momentum >= 0 ? 'improving' : 'lagging';
}

function patternText(q: Quadrant, trend: SectorRotationRow['trend']): string {
  switch (q) {
    case 'leading':   return trend === 'rolling' ? 'Leading — but cooling' : 'Leading — money parked here';
    case 'improving': return 'Rotating IN — early money';
    case 'weakening': return 'Fading — money starting to leave';
    case 'lagging':   return trend === 'accelerating' ? 'Basing — early turn up' : 'Out of favor';
  }
}

// Daily bars per timeframe (~21 trading days/month). '1H' uses 60-min bars.
const TF_BARS: Record<RotTF, { src: 'd' | 'h'; n: number }> = {
  '1H': { src: 'h', n: 1 },
  '1D': { src: 'd', n: 1 },
  '1W': { src: 'd', n: 5 },
  '1M': { src: 'd', n: 21 },
  '3M': { src: 'd', n: 63 },
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Mine predictive patterns from a sector's daily history vs SPY's. Returns null
 * when there isn't enough aligned history to be honest about an edge.
 */
function computeSectorPredict(
  dCloses: number[], dTs: number[], sCloses: number[],
): SectorPredict | null {
  const n = Math.min(dCloses.length, sCloses.length, dTs.length);
  if (n < 60) return null;
  const dc = dCloses.slice(dCloses.length - n);
  const dt = dTs.slice(dTs.length - n);
  const sc = sCloses.slice(sCloses.length - n);

  // Daily relative-vs-SPY return (%), tagged with the bar's weekday.
  const rel: number[] = [];
  const relTs: number[] = [];
  for (let i = 1; i < n; i++) {
    if (!dc[i - 1] || !sc[i - 1]) continue;
    rel.push(((dc[i] / dc[i - 1] - 1) - (sc[i] / sc[i - 1] - 1)) * 100);
    relTs.push(dt[i]);
  }
  if (rel.length < 40) return null;

  // ── Day-of-week seasonality ──
  const byDay: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  rel.forEach((r, i) => {
    const wd = new Date(relTs[i]).getUTCDay();
    if (byDay[wd]) byDay[wd].push(r);
  });
  let bestDay: string | null = null, bestDayRel: number | null = null;
  let worstDay: string | null = null, worstDayRel: number | null = null;
  for (const wd of [1, 2, 3, 4, 5]) {
    const arr = byDay[wd];
    if (arr.length < 10) continue;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (bestDayRel == null || avg > bestDayRel) { bestDayRel = +avg.toFixed(2); bestDay = WEEKDAYS[wd]; }
    if (worstDayRel == null || avg < worstDayRel) { worstDayRel = +avg.toFixed(2); worstDay = WEEKDAYS[wd]; }
  }

  // ── Persistence: lag-1 autocorrelation of daily relative returns ──
  const mean = rel.reduce((a, b) => a + b, 0) / rel.length;
  let num = 0, den = 0;
  for (let i = 0; i < rel.length; i++) {
    den += (rel[i] - mean) ** 2;
    if (i > 0) num += (rel[i] - mean) * (rel[i - 1] - mean);
  }
  const autocorr = den > 0 ? +(num / den).toFixed(3) : null;
  const behavior: SectorPredict['behavior'] =
    autocorr == null ? null
      : autocorr > 0.08 ? 'trend-follows'
      : autocorr < -0.08 ? 'mean-reverts'
      : 'random';

  // ── Current streak + its historical follow-through ──
  const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  let streak = 0;
  let streakDir: SectorPredict['streakDir'] = 'flat';
  const lastSign = sign(rel[rel.length - 1]);
  if (lastSign !== 0) {
    streakDir = lastSign > 0 ? 'up' : 'down';
    for (let i = rel.length - 1; i >= 0; i--) {
      if (sign(rel[i]) === lastSign) streak++; else break;
    }
  }
  let edgeAfterStreak: number | null = null;
  if (streakDir !== 'flat') {
    const want = streakDir === 'up' ? 1 : -1;
    const nexts: number[] = [];
    let run = 0;
    for (let i = 0; i < rel.length; i++) {
      if (sign(rel[i]) === want) run++; else run = 0;
      if (run >= 2 && i + 1 < rel.length) nexts.push(rel[i + 1]);
    }
    if (nexts.length >= 8) edgeAfterStreak = +(nexts.reduce((a, b) => a + b, 0) / nexts.length).toFixed(2);
  }

  // ── Note ──
  const parts: string[] = [];
  if (bestDay && bestDayRel != null && bestDayRel > 0.03) parts.push(`Leads on ${bestDay} (avg ${bestDayRel >= 0 ? '+' : ''}${bestDayRel}%)`);
  if (streak >= 2 && edgeAfterStreak != null) {
    const dirWord = streakDir === 'up' ? 'relative-strength' : 'relative-weakness';
    if (behavior === 'mean-reverts' || (streakDir === 'up' && edgeAfterStreak < 0) || (streakDir === 'down' && edgeAfterStreak > 0)) {
      parts.push(`${streak}-day ${dirWord} streak — tends to revert (${edgeAfterStreak >= 0 ? '+' : ''}${edgeAfterStreak}% next)`);
    } else {
      parts.push(`${streak}-day ${dirWord} streak — tends to continue (${edgeAfterStreak >= 0 ? '+' : ''}${edgeAfterStreak}% next)`);
    }
  } else if (behavior && behavior !== 'random') {
    parts.push(behavior === 'trend-follows' ? 'Relative moves persist day-to-day' : 'Relative moves fade day-to-day');
  }
  const note = parts.length ? parts.join(' · ') : 'No strong day-to-day pattern';

  return { bestDay, bestDayRel, worstDay, worstDayRel, autocorr, behavior, streak, streakDir, edgeAfterStreak, note };
}

let _matrixCache: { at: number; data: RotationMatrixData } | null = null;
const MATRIX_TTL_MS = 5 * 60 * 1000;

export async function getRotationMatrix(force = false): Promise<RotationMatrixData> {
  if (!force && _matrixCache && Date.now() - _matrixCache.at < MATRIX_TTL_MS) return _matrixCache.data;

  const symbols = [BENCHMARK, ...ROTATION_ETFS.map(e => e.symbol)];
  const [daily, hourly] = await Promise.all([
    Promise.all(symbols.map(s => fetchHistory(s, '1y', '1d'))),
    Promise.all(symbols.map(s => fetchHistory(s, '5d', '60m'))),
  ]);

  const dailyMap = new Map<string, History>();
  const hourlyMap = new Map<string, History>();
  symbols.forEach((s, i) => {
    if (daily[i]) dailyMap.set(s, daily[i]!);
    if (hourly[i]) hourlyMap.set(s, hourly[i]!);
  });

  const spyDaily = dailyMap.get(BENCHMARK);
  const spyHourly = hourlyMap.get(BENCHMARK);

  // Honest session stamp from SPY's freshest daily bar.
  const sessionAtMs = spyDaily ? spyDaily.ts[spyDaily.ts.length - 1] : 0;
  const { label: sessionLabel, isStale } = deriveSession(sessionAtMs, '');
  const spyChange = spyDaily ? (pctOver(spyDaily.closes, 1) ?? 0) : 0;

  const spyAbs: Record<RotTF, number | null> = {} as Record<RotTF, number | null>;
  for (const tf of ROT_TIMEFRAMES) {
    const cfg = TF_BARS[tf];
    spyAbs[tf] = pctOver(cfg.src === 'h' ? spyHourly?.closes : spyDaily?.closes, cfg.n);
  }

  const rows: SectorRotationRow[] = [];
  for (const meta of ROTATION_ETFS) {
    const d = dailyMap.get(meta.symbol);
    if (!d) continue;
    const h = hourlyMap.get(meta.symbol);

    const abs: Record<RotTF, number | null> = {} as Record<RotTF, number | null>;
    const rel: Record<RotTF, number | null> = {} as Record<RotTF, number | null>;
    for (const tf of ROT_TIMEFRAMES) {
      const cfg = TF_BARS[tf];
      const a = pctOver(cfg.src === 'h' ? h?.closes : d.closes, cfg.n);
      abs[tf] = a == null ? null : +a.toFixed(2);
      rel[tf] = (a == null || spyAbs[tf] == null) ? null : +(a - (spyAbs[tf] as number)).toFixed(2);
    }

    const r1w = rel['1W'] ?? 0;
    const r1m = rel['1M'] ?? r1w;
    const rsRatio = +r1m.toFixed(2);
    const rsMomentum = +((r1w * (21 / 5)) - r1m).toFixed(2);  // weekly pace vs monthly pace
    const trend: SectorRotationRow['trend'] =
      rsMomentum > 1 ? 'accelerating' : rsMomentum < -1 ? 'rolling' : 'steady';
    const q = quad(rsRatio, rsMomentum);

    rows.push({
      etf: meta.symbol,
      name: meta.name,
      abs,
      rel,
      rank: {} as Record<RotTF, number | null>,
      quadrant: q,
      rsRatio,
      rsMomentum,
      trend,
      pattern: patternText(q, trend),
      spark: spyDaily ? buildRelSpark(d.closes, spyDaily.closes, 20) : [],
      predict: spyDaily ? computeSectorPredict(d.closes, d.ts, spyDaily.closes) : null,
    });
  }

  // Leadership rank per timeframe.
  for (const tf of ROT_TIMEFRAMES) {
    const ranked = rows.filter(r => r.rel[tf] != null).sort((a, b) => (b.rel[tf] as number) - (a.rel[tf] as number));
    ranked.forEach((r, i) => { r.rank[tf] = i + 1; });
    rows.filter(r => r.rel[tf] == null).forEach(r => { r.rank[tf] = null; });
  }

  // Sort by leadership: quadrant priority, then relative-strength level.
  const QUAD_ORDER: Record<Quadrant, number> = { leading: 0, improving: 1, weakening: 2, lagging: 3 };
  rows.sort((a, b) => (QUAD_ORDER[a.quadrant] - QUAD_ORDER[b.quadrant]) || (b.rsRatio - a.rsRatio));

  // Narrative + rotation pairs.
  const fmtRel = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const dest = rows.filter(r => r.quadrant === 'improving').slice(0, 2);
  const lead = rows.filter(r => r.quadrant === 'leading').slice(0, 3);
  const src = rows.filter(r => r.quadrant === 'weakening' || r.quadrant === 'lagging').slice(0, 2);

  const narrative: string[] = [];
  if (lead.length) narrative.push(`Leadership: ${lead.map(d => `${d.name} ${fmtRel(d.rel['1M'])} 1m`).join(' · ')}`);
  if (dest.length) narrative.push(`Money rotating INTO ${dest.map(d => `${d.name} (${fmtRel(d.rel['1W'])} 1w)`).join(' · ')}`);
  if (src.length) narrative.push(`Leaving ${src.map(d => `${d.name} (${fmtRel(d.rel['1W'])} 1w)`).join(' · ')}`);
  if (!narrative.length) narrative.push('No clear cross-timeframe rotation — leadership is mixed.');

  const rotations: { from: string; to: string }[] = [];
  const fromPool = src.length ? src : lead.filter(r => r.trend === 'rolling').slice(0, 2);
  for (const f of fromPool) for (const t of dest) rotations.push({ from: f.name, to: t.name });

  // ── Predictive callouts: surface the few strongest mined edges ──
  const predictive: string[] = [];
  const withPredict = rows.filter(r => r.predict);

  // 1) Today's day-of-week seasonal leaders (uses the data's session weekday).
  const todayWd = WEEKDAYS[new Date(sessionAtMs || Date.now()).getUTCDay()];
  const seasonalToday = withPredict
    .filter(r => r.predict!.bestDay === todayWd && (r.predict!.bestDayRel ?? 0) > 0.05)
    .sort((a, b) => (b.predict!.bestDayRel ?? 0) - (a.predict!.bestDayRel ?? 0))
    .slice(0, 3);
  if (['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(todayWd) && seasonalToday.length) {
    predictive.push(`${todayWd} seasonality favors ${seasonalToday.map(r => `${r.name} (avg +${r.predict!.bestDayRel}%)`).join(' · ')}`);
  }

  // 2) Live continuation setups: on an up-streak that historically keeps going.
  const continuation = withPredict
    .filter(r => r.predict!.streakDir === 'up' && r.predict!.streak >= 2 && (r.predict!.edgeAfterStreak ?? 0) > 0.03)
    .sort((a, b) => (b.predict!.edgeAfterStreak ?? 0) - (a.predict!.edgeAfterStreak ?? 0))
    .slice(0, 2);
  if (continuation.length) {
    predictive.push(`Continuation: ${continuation.map(r => `${r.name} on a ${r.predict!.streak}-day RS streak (+${r.predict!.edgeAfterStreak}% avg next)`).join(' · ')}`);
  }

  // 3) Fade setups: extended streak in a mean-reverting sector.
  const fade = withPredict
    .filter(r => r.predict!.streak >= 3 && (r.predict!.behavior === 'mean-reverts'
      || (r.predict!.streakDir === 'up' && (r.predict!.edgeAfterStreak ?? 0) < -0.03)
      || (r.predict!.streakDir === 'down' && (r.predict!.edgeAfterStreak ?? 0) > 0.03)))
    .sort((a, b) => b.predict!.streak - a.predict!.streak)
    .slice(0, 2);
  if (fade.length) {
    predictive.push(`Stretched (mean-revert risk): ${fade.map(r => `${r.name} ${r.predict!.streak}-day ${r.predict!.streakDir} streak`).join(' · ')}`);
  }

  if (!predictive.length) predictive.push('No standout seasonal or persistence edges right now.');

  const data: RotationMatrixData = {
    asOf: new Date().toISOString(),
    sessionLabel,
    isStale,
    spyChange: +spyChange.toFixed(2),
    timeframes: ROT_TIMEFRAMES,
    rows,
    narrative,
    rotations,
    predictive,
  };

  _matrixCache = { at: Date.now(), data };
  return data;
}
