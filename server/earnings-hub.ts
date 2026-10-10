/**
 * EARNINGS HUB — automated earnings-lotto scanner.
 *
 * What it does (per ticker reporting in the next N days):
 *   1. Fetch beat history (last 4Q from Nasdaq surprise API)
 *   2. Fetch front-week ATM call cost + IV via Tradier
 *   3. Compute implied move = IV × √(DTE/365) × spot
 *   4. Compute ROI scenarios at +1σ / +1.5σ / +2σ
 *   5. Score on: cost-to-move ratio, ROI, budget fit, liquidity
 *   6. Filter to "lotto-quality" — ATM < $4, ≥1 beat, ROI@1.5σ ≥ 60%
 *   7. Rank, return.
 *
 * Cache: 30 min. The earnings calendar updates daily; chains intra-day.
 *
 * Endpoint: GET /api/earnings/week → { upcoming, lottos, all, scannedAt }
 *
 * The same logic that produced the manual Top-10 lottos in chat,
 * now in the platform — runs every time you load the Earnings tab.
 */
import { logger } from './logger';
import { getTradierQuote, getOptionQuote } from './tradier-api';
import { computeGEXFromCBOE } from './gex-cboe-fallback';

// ─── Types ─────────────────────────────────────────────────────────

export type EarningsTime = 'BMO' | 'AMC' | 'TBD' | 'unknown';

export interface BeatHistory {
  beats: number;
  total: number;
  avgSurprisePct: number;
  /** Last 4 surprises in chronological order (most recent first) */
  recentSurprises: number[];
}

export interface ContractPick {
  type: 'CALL' | 'PUT';
  strike: number;
  expiry: string;
  dte: number;
  mid: number;
  bid: number;
  ask: number;
  iv: number;          // 0-1
  oi: number;
  vol: number;
}

export interface EarningsRow {
  symbol: string;
  name?: string;
  date: string;            // YYYY-MM-DD
  time: EarningsTime;
  epsEstimate: string | null;
  spot: number;
  marketCap: number;
  beats: BeatHistory | null;

  // Computed
  ivPct: number;                    // IV * 100 (front-month ATM)
  impliedMovePct: number;           // expected move %
  impliedMoveDollars: number;
  costToMoveRatio: number;          // ATM cost / implied-move-$
  roiAt1Sigma: number;
  roiAt1_5Sigma: number;
  roiAt2Sigma: number;

  atmCall: ContractPick | null;
  otmCall: ContractPick | null;     // ~1σ OTM
  otmPut: ContractPick | null;      // ~1σ OTM downside

  /** 0-100 composite lotto score */
  lottoScore: number;
  /** Brief narrative — auto-generated */
  thesis: string;
  /** Tier label for UI */
  tier: 'S' | 'A' | 'B' | 'C' | 'AVOID';
}

export interface EarningsHubResponse {
  asOf: string;
  windowStart: string;
  windowEnd: string;
  scannedTickers: number;
  upcoming: EarningsRow[];          // all rows
  lottos: EarningsRow[];            // top picks (filtered + ranked)
}

// ─── Cache ─────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60_000;
let cached: { data: EarningsHubResponse; expiresAt: number } | null = null;

// Full-calendar cache (no chain enrichment — fast, hits ~1500 reports)
const CALENDAR_CACHE_TTL_MS = 60 * 60_000;
let calendarCache: { data: EarningsCalendarResponse; expiresAt: number; key: string } | null = null;

// ─── Full calendar (all stocks reporting, grouped by date) ─────────

export interface CalendarRow {
  symbol: string;
  name: string;
  date: string;
  time: EarningsTime;
  epsEstimate: string | null;
  /** Market cap as raw number (could be 0 if Nasdaq doesn't return it) */
  marketCap: number;
  /** Curated importance tier — higher = more "must watch" */
  importance: 1 | 2 | 3 | 4 | 5;
  /** Sector tag (best-effort, derived from name + symbol heuristics) */
  sector: string;
}

export interface CalendarDay {
  date: string;
  dayName: string;
  total: number;
  bmo: CalendarRow[];
  amc: CalendarRow[];
  tbd: CalendarRow[];
}

export interface EarningsCalendarResponse {
  asOf: string;
  windowStart: string;
  windowEnd: string;
  totalReports: number;
  days: CalendarDay[];
  /** Top 30 by market cap across the window (the ones that move indexes) */
  topByMarketCap: CalendarRow[];
}

// Sector hints — quick keyword heuristic on company name/symbol
function inferSector(symbol: string, name: string): string {
  const s = symbol.toUpperCase();
  const n = (name || '').toLowerCase();

  // Hard-tag major names
  const TAG: Record<string, string> = {
    NVDA: 'Chips', AMD: 'Chips', AVGO: 'Chips', MU: 'Chips', TSM: 'Chips', INTC: 'Chips',
    ARM: 'Chips', SMCI: 'Chips', MRVL: 'Chips', QCOM: 'Chips',
    LITE: 'Optical', AAOI: 'Optical', COHR: 'Optical', CRDO: 'Optical',
    CRM: 'SaaS', NOW: 'SaaS', PANW: 'SaaS', CRWD: 'SaaS', DDOG: 'SaaS', NET: 'SaaS',
    MDB: 'SaaS', SNOW: 'SaaS', HUBS: 'SaaS', BILL: 'SaaS', PLTR: 'SaaS', SOUN: 'SaaS',
    CEG: 'Power', VST: 'Power', TLN: 'Power', BE: 'Power', OKLO: 'Power', SMR: 'Power',
    NNE: 'Power', BWXT: 'Power', LEU: 'Power', CCJ: 'Power', UEC: 'Power',
    VRT: 'Cooling', MOD: 'Cooling',
    ETN: 'Power-Eq', GEV: 'Power-Eq', POWL: 'Power-Eq',
    CRWV: 'AI-Cloud', NBIS: 'AI-Cloud', IREN: 'AI-Cloud',
    MARA: 'Crypto', RIOT: 'Crypto', HUT: 'Crypto', WULF: 'Crypto', CLSK: 'Crypto', CIFR: 'Crypto',
    COIN: 'Fintech', SOFI: 'Fintech', HOOD: 'Fintech', UPST: 'Fintech', AFRM: 'Fintech', PYPL: 'Fintech',
    DIS: 'Media', NFLX: 'Media', ROKU: 'Media', SPOT: 'Media', SNAP: 'Media', PINS: 'Media',
    META: 'Media', RDDT: 'Media', TTD: 'AdTech', APP: 'AdTech',
    UBER: 'Consumer', LYFT: 'Consumer', DASH: 'Consumer', ABNB: 'Travel', RBLX: 'Consumer',
    LLY: 'Pharma', PFE: 'Pharma', VRTX: 'Pharma', GILD: 'Pharma', BMY: 'Pharma', MRNA: 'Pharma',
    RXRX: 'Bio-AI', ABCL: 'Bio-AI', NVAX: 'Pharma', HIMS: 'Health',
    MP: 'Materials', UAMY: 'Materials', FCX: 'Materials',
    TSLA: 'Auto', RIVN: 'Auto', LCID: 'Auto', F: 'Auto', GM: 'Auto', MBLY: 'Auto',
    XOM: 'Energy', CVX: 'Energy', COP: 'Energy',
    JPM: 'Banks', BAC: 'Banks', WFC: 'Banks', GS: 'Banks', MS: 'Banks',
    LMT: 'Defense', NOC: 'Defense', RTX: 'Defense', LDOS: 'Defense', HII: 'Defense',
  };
  if (TAG[s]) return TAG[s];

  // Name-based heuristics
  if (/bank|financial|capital|holdings/.test(n)) return 'Financials';
  if (/pharma|therapeutic|bio|gene|health/.test(n)) return 'Health';
  if (/energy|petroleum|oil|gas/.test(n)) return 'Energy';
  if (/semi|chip|tech/.test(n)) return 'Tech';
  if (/software|cloud|saas/.test(n)) return 'SaaS';
  if (/restaurant|food|consumer/.test(n)) return 'Consumer';
  if (/real estate|reit/.test(n)) return 'REIT';
  return 'Other';
}

// Importance score: higher market cap + bigger expected move = higher importance
function rankImportance(symbol: string, marketCap: number, name: string): 1 | 2 | 3 | 4 | 5 {
  // Curated mega-importance list (always 5)
  const MUST_WATCH = new Set([
    'AAPL','MSFT','GOOGL','AMZN','META','NVDA','TSLA','BRK.B','JPM','XOM','LLY',
    'AMD','AVGO','ORCL','NFLX','HD','PG','JNJ','WMT','MA','V','UNH','BAC','PFE',
  ]);
  if (MUST_WATCH.has(symbol)) return 5;

  // Mid-importance — well-known names
  const HIGH_INTEREST = new Set([
    'PLTR','COIN','SHOP','UBER','DIS','SMCI','CRM','MU','ARM','MRVL','MSTR','APP',
    'SNAP','PINS','SOFI','HOOD','RIVN','LCID','RBLX','DDOG','NET','HUBS','MDB','SNOW',
    'PANW','CRWD','BILL','TTD','RDDT','LITE','CRWV','VST','TLN','CEG','OKLO','SMR',
    'MP','BWXT','LEU','PYPL','AFRM','UPST','GILD','VRTX','RXRX','TEM','NVAX','HIMS',
    'ABNB','EXPE','MAR','SHOP','MCD','SBUX','SOUN','SPOT','ROKU','CART','LYFT','DASH',
  ]);
  if (HIGH_INTEREST.has(symbol)) return 4;

  // Use market cap as a proxy
  if (marketCap >= 50e9) return 5;
  if (marketCap >= 10e9) return 4;
  if (marketCap >= 2e9) return 3;
  if (marketCap >= 500e6) return 2;
  return 1;
}

function dayName(dateISO: string): string {
  const d = new Date(dateISO + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

export async function buildEarningsCalendar(
  opts: { daysAhead?: number; includeAll?: boolean } = {},
  force = false,
): Promise<EarningsCalendarResponse> {
  const daysAhead = opts.daysAhead ?? 7;
  const cacheKey = `${daysAhead}:${opts.includeAll ?? false}`;

  if (!force && calendarCache && calendarCache.key === cacheKey && calendarCache.expiresAt > Date.now()) {
    return calendarCache.data;
  }

  const startedAt = Date.now();
  const dates = dateRangeISO(daysAhead);

  // Pull all calendar rows for the window
  const calendar = await Promise.all(
    dates.map(async d => ({ date: d, rows: await fetchNasdaqCalendar(d) })),
  );

  let totalReports = 0;
  const days: CalendarDay[] = [];

  for (const day of calendar) {
    const bmo: CalendarRow[] = [];
    const amc: CalendarRow[] = [];
    const tbd: CalendarRow[] = [];

    for (const r of day.rows) {
      const symbol = String(r.symbol ?? '').toUpperCase();
      if (!symbol) continue;
      totalReports++;

      const marketCap = (() => {
        const mc = String(r.marketCap ?? '').replace(/[$,\s]/g, '');
        const n = parseInt(mc);
        return Number.isFinite(n) ? n : 0;
      })();

      const t = r.time as string;
      const time: EarningsTime =
        t === 'time-after-hours' ? 'AMC' :
        t === 'time-pre-market'  ? 'BMO' :
        t === 'time-not-supplied' ? 'TBD' : 'unknown';

      const row: CalendarRow = {
        symbol,
        name: r.name ?? '',
        date: day.date,
        time,
        epsEstimate: r.epsForecast ?? null,
        marketCap,
        importance: rankImportance(symbol, marketCap, r.name ?? ''),
        sector: inferSector(symbol, r.name ?? ''),
      };

      if (time === 'BMO') bmo.push(row);
      else if (time === 'AMC') amc.push(row);
      else tbd.push(row);
    }

    // Within each session group, sort by importance desc then mkt cap desc
    const byImportance = (a: CalendarRow, b: CalendarRow) =>
      b.importance - a.importance || b.marketCap - a.marketCap;
    bmo.sort(byImportance);
    amc.sort(byImportance);
    tbd.sort(byImportance);

    days.push({
      date: day.date,
      dayName: dayName(day.date),
      total: bmo.length + amc.length + tbd.length,
      bmo, amc, tbd,
    });
  }

  // Top 30 across the entire window by market cap (the index movers)
  const allFlat: CalendarRow[] = days.flatMap(d => [...d.bmo, ...d.amc, ...d.tbd]);
  const topByMarketCap = allFlat
    .filter(r => r.marketCap > 0)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 30);

  const response: EarningsCalendarResponse = {
    asOf: new Date().toISOString(),
    windowStart: dates[0],
    windowEnd: dates[dates.length - 1],
    totalReports,
    days,
    topByMarketCap,
  };

  calendarCache = { data: response, expiresAt: Date.now() + CALENDAR_CACHE_TTL_MS, key: cacheKey };
  logger.info(`[EARNINGS-CAL] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${totalReports} reports across ${days.length} days`);
  return response;
}

export function clearEarningsCalendarCache(): void { calendarCache = null; }

// ─── Calendar fetcher (Nasdaq) ─────────────────────────────────────

async function fetchNasdaqCalendar(date: string): Promise<any[]> {
  const url = `https://api.nasdaq.com/api/calendar/earnings?date=${date}`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return [];
    const j: any = await r.json();
    return j?.data?.rows ?? [];
  } catch {
    return [];
  }
}

// ─── Beat history (Nasdaq surprise) ────────────────────────────────

async function fetchBeatHistory(symbol: string): Promise<BeatHistory | null> {
  const url = `https://api.nasdaq.com/api/company/${symbol}/earnings-surprise`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const rows = (j?.data?.earningsSurpriseTable?.rows ?? []).slice(0, 4);
    let beats = 0;
    let total = 0;
    const sps: number[] = [];
    for (const row of rows) {
      const sp = String(row.percentageSurprise ?? '').replace(/[,%]/g, '').trim();
      if (sp && sp !== '--' && sp !== 'N/A') {
        const v = parseFloat(sp);
        if (Number.isFinite(v)) {
          sps.push(v);
          if (v > 0) beats++;
          total++;
        }
      }
    }
    if (total === 0) return null;
    return {
      beats,
      total,
      avgSurprisePct: sps.reduce((s, x) => s + x, 0) / sps.length,
      recentSurprises: sps,
    };
  } catch {
    return null;
  }
}

// ─── Tradier chain fetcher (front-month ATM/OTM call+put) ─────────

interface ChainResult {
  spot: number;
  ivPct: number;
  atmCall: ContractPick | null;
  otmCall: ContractPick | null;
  otmPut: ContractPick | null;
  dte: number;
  expiry: string;
}

async function fetchEarningsChain(symbol: string, knownSpot?: number): Promise<ChainResult | null> {
  const apiKey = process.env.TRADIER_API_KEY;
  // Tradier preferred — falls back to CBOE-derived spot only if Tradier blocked
  let spot = knownSpot;
  if (!spot) {
    const q = await getTradierQuote(symbol);
    spot = q?.last ?? undefined;
  }
  if (!spot) {
    const cboe = await computeGEXFromCBOE(symbol).catch(() => null);
    spot = cboe?.spotPrice ?? 0;
  }
  if (!spot || spot <= 0) return null;

  if (!apiKey) {
    logger.warn(`[EARNINGS-HUB] no TRADIER_API_KEY — cannot fetch chain for ${symbol}`);
    return null;
  }

  // Get expirations
  try {
    const expR = await fetch(
      `https://api.tradier.com/v1/markets/options/expirations?symbol=${symbol}`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!expR.ok) return null;
    const expJson: any = await expR.json();
    const exps: string[] = expJson?.expirations?.date ?? [];
    if (exps.length === 0) return null;

    // Pick first expiry that's 5-21 DTE
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let pickedExp: string | null = null;
    let pickedDte = 0;
    for (const exp of exps) {
      const d = new Date(exp);
      const dte = Math.round((d.getTime() - today.getTime()) / 86_400_000);
      if (dte >= 5 && dte <= 21) {
        pickedExp = exp;
        pickedDte = dte;
        break;
      }
    }
    if (!pickedExp) return null;

    // Fetch chain
    const chainR = await fetch(
      `https://api.tradier.com/v1/markets/options/chains?symbol=${symbol}&expiration=${pickedExp}&greeks=true`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!chainR.ok) return null;
    const chainJson: any = await chainR.json();
    const options: any[] = chainJson?.options?.option ?? [];
    if (options.length === 0) return null;

    const calls = options.filter(o => o.option_type === 'call');
    const puts = options.filter(o => o.option_type === 'put');

    const atmCallRaw = calls.reduce(
      (best, c) => Math.abs(c.strike - spot!) < Math.abs(best.strike - spot!) ? c : best,
      calls[0],
    );
    const ivPct = (atmCallRaw?.greeks?.mid_iv ?? 0) * 100;
    const impliedMove = (ivPct / 100) * Math.sqrt(pickedDte / 365) * spot;
    const targetOtmCall = spot + impliedMove;
    const targetOtmPut = spot - impliedMove;

    const otmCallRaw = calls.reduce(
      (best, c) => Math.abs(c.strike - targetOtmCall) < Math.abs(best.strike - targetOtmCall) ? c : best,
      calls[0],
    );
    const otmPutRaw = puts.length > 0 ? puts.reduce(
      (best, p) => Math.abs(p.strike - targetOtmPut) < Math.abs(best.strike - targetOtmPut) ? p : best,
      puts[0],
    ) : null;

    const toContract = (raw: any, type: 'CALL' | 'PUT'): ContractPick => {
      const bid = raw.bid ?? 0;
      const ask = raw.ask ?? 0;
      const mid = ask > 0 ? (bid + ask) / 2 : (raw.last ?? 0);
      return {
        type,
        strike: raw.strike,
        expiry: pickedExp!,
        dte: pickedDte,
        mid: +mid.toFixed(2),
        bid,
        ask,
        iv: raw?.greeks?.mid_iv ?? 0,
        oi: raw.open_interest ?? 0,
        vol: raw.volume ?? 0,
      };
    };

    return {
      spot,
      ivPct,
      atmCall: atmCallRaw ? toContract(atmCallRaw, 'CALL') : null,
      otmCall: otmCallRaw ? toContract(otmCallRaw, 'CALL') : null,
      otmPut: otmPutRaw ? toContract(otmPutRaw, 'PUT') : null,
      dte: pickedDte,
      expiry: pickedExp,
    };
  } catch (e: any) {
    logger.warn(`[EARNINGS-HUB] ${symbol} chain failed: ${e?.message}`);
    return null;
  }
}

// ─── Scoring ───────────────────────────────────────────────────────

function scoreRow(row: Pick<EarningsRow,
  'costToMoveRatio' | 'roiAt1_5Sigma' | 'atmCall' | 'beats'
>): number {
  const costRatio = row.costToMoveRatio;
  const cheapPts   = Math.max(0, Math.min(40, (1 - costRatio) * 80));
  const roiPts     = Math.max(0, Math.min(30, (row.roiAt1_5Sigma / 100) * 30));
  const budgetPts  = Math.max(0, Math.min(15, (5 - (row.atmCall?.mid ?? 5)) * 3));
  const liqPts     = Math.min(15, (row.atmCall?.oi ?? 0) / 100);
  return Math.round(cheapPts + roiPts + budgetPts + liqPts);
}

function classifyTier(row: EarningsRow): EarningsRow['tier'] {
  if (!row.beats || row.beats.total === 0) return 'C';
  const beatRate = row.beats.beats / row.beats.total;
  // AVOID — historical wreckage on missed quarters
  if (beatRate <= 0.25 && row.beats.avgSurprisePct < -50) return 'AVOID';
  // S — perfect track + strong score
  if (row.lottoScore >= 90 && beatRate >= 0.75) return 'S';
  // A — strong score OR perfect track
  if (row.lottoScore >= 75 || beatRate === 1) return 'A';
  // B — meets minimums
  if (row.lottoScore >= 60 && beatRate >= 0.5) return 'B';
  return 'C';
}

function buildThesis(row: EarningsRow): string {
  const parts: string[] = [];
  if (row.beats) {
    parts.push(`${row.beats.beats}/${row.beats.total} beats, avg ${row.beats.avgSurprisePct >= 0 ? '+' : ''}${row.beats.avgSurprisePct.toFixed(0)}%`);
  }
  parts.push(`IV ${row.ivPct.toFixed(0)}%`);
  parts.push(`iMove ±${row.impliedMovePct.toFixed(1)}%`);
  parts.push(`cost/move ${row.costToMoveRatio.toFixed(2)}x`);
  if (row.roiAt1_5Sigma >= 100) parts.push(`+1.5σ → +${row.roiAt1_5Sigma.toFixed(0)}%`);
  return parts.join(' · ');
}

// ─── Public: scan a tickers list → ranked rows ─────────────────────

const DEFAULT_UNIVERSE = [
  'PLTR','SHOP','ARM','APP','FTNT','DDOG','NET','HUBS','BILL','APPN','TEAM','DUOL','GTLB','TWLO',
  'AMD','SMCI','MRVL','MU','ON','MCHP','LRCX','AMAT','KLAC','SWKS','GFS','LSCC','POWI',
  'TLN','VST','CEG','OKLO','SMR','NNE','BWXT','LEU','POWL','VRT','GEV','ETN',
  'LITE','AAOI','CRDO','COHR','FN',
  'CRWV','NBIS','IREN','HUT','MARA','RIOT','CIFR','WULF','CLSK',
  'DIS','UBER','LYFT','DASH','ABNB','RBLX','CART','MCD',
  'COIN','SOFI','HOOD','PYPL','UPST','AFRM','MSTR',
  'LLY','PFE','VRTX','GILD','RXRX','VKTX','TEM','NVAX','HIMS','ABSI',
  'MP','UAMY','HII','LDOS','CCJ','UEC',
  'SNAP','PINS','RDDT','TTD',
  'LCID','RIVN','MBLY',
  'EXPE','TRIP','MAR',
  'SOUN','BLZE','PATH','ASAN',
];

function dateRangeISO(daysAhead: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function buildEarningsHub(
  opts: { daysAhead?: number; universe?: string[] } = {},
  force = false,
): Promise<EarningsHubResponse> {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

  const startedAt = Date.now();
  const daysAhead = opts.daysAhead ?? 7;
  const universe = new Set((opts.universe ?? DEFAULT_UNIVERSE).map(s => s.toUpperCase()));

  // 1) Pull calendar across the window
  const dates = dateRangeISO(daysAhead);
  const calendar: { date: string; rows: any[] }[] = await Promise.all(
    dates.map(async d => ({ date: d, rows: await fetchNasdaqCalendar(d) })),
  );

  // 2) Filter to our universe
  type CalRow = { date: string; symbol: string; name: string; epsForecast: string | null; time: EarningsTime };
  const target: CalRow[] = [];
  for (const day of calendar) {
    for (const r of day.rows) {
      const sym = String(r.symbol ?? '').toUpperCase();
      if (!universe.has(sym)) continue;
      if (target.find(t => t.symbol === sym)) continue;
      const t = r.time as string;
      const time: EarningsTime =
        t === 'time-after-hours' ? 'AMC' :
        t === 'time-pre-market'  ? 'BMO' :
        t === 'time-not-supplied' ? 'TBD' : 'unknown';
      target.push({
        date: day.date,
        symbol: sym,
        name: r.name ?? '',
        epsForecast: r.epsForecast ?? null,
        time,
      });
    }
  }

  // 3) For each, fetch chain + beats in parallel batches
  const BATCH = 6;
  const rows: EarningsRow[] = [];
  for (let i = 0; i < target.length; i += BATCH) {
    const slice = target.slice(i, i + BATCH);
    const part = await Promise.all(slice.map(async t => {
      const [chain, beats] = await Promise.all([
        fetchEarningsChain(t.symbol),
        fetchBeatHistory(t.symbol),
      ]);
      if (!chain || !chain.atmCall) return null;
      const impliedMovePct = chain.ivPct * Math.sqrt(chain.dte / 365);
      const impliedMoveDollars = (impliedMovePct / 100) * chain.spot;
      const cost = chain.atmCall.mid;
      const costToMoveRatio = impliedMoveDollars > 0 ? cost / impliedMoveDollars : 99;
      const roiAt = (scenSpot: number) => {
        const intrinsic = Math.max(0, scenSpot - chain.atmCall!.strike);
        return cost > 0 ? ((intrinsic - cost) / cost) * 100 : 0;
      };
      const roi1   = roiAt(chain.spot + impliedMoveDollars);
      const roi1_5 = roiAt(chain.spot + 1.5 * impliedMoveDollars);
      const roi2   = roiAt(chain.spot + 2 * impliedMoveDollars);

      const partial = {
        symbol: t.symbol, name: t.name, date: t.date, time: t.time,
        epsEstimate: t.epsForecast, spot: chain.spot, marketCap: 0,
        beats,
        ivPct: chain.ivPct, impliedMovePct, impliedMoveDollars,
        costToMoveRatio, roiAt1Sigma: roi1, roiAt1_5Sigma: roi1_5, roiAt2Sigma: roi2,
        atmCall: chain.atmCall, otmCall: chain.otmCall, otmPut: chain.otmPut,
        lottoScore: 0, thesis: '', tier: 'C' as const,
      };
      partial.lottoScore = scoreRow(partial);
      const full: EarningsRow = { ...partial, tier: 'C' };
      full.tier = classifyTier(full);
      full.thesis = buildThesis(full);
      return full;
    }));
    for (const r of part) if (r) rows.push(r);
  }

  rows.sort((a, b) => b.lottoScore - a.lottoScore);

  // Lottos: meets all the criteria
  const lottos = rows.filter(r =>
    r.atmCall && r.atmCall.mid < 4 &&
    r.beats && r.beats.beats >= 1 &&
    r.roiAt1_5Sigma >= 60,
  ).slice(0, 12);

  const response: EarningsHubResponse = {
    asOf: new Date().toISOString(),
    windowStart: dates[0],
    windowEnd: dates[dates.length - 1],
    scannedTickers: rows.length,
    upcoming: rows,
    lottos,
  };

  cached = { data: response, expiresAt: Date.now() + CACHE_TTL_MS };
  logger.info(`[EARNINGS-HUB] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${rows.length} scored, ${lottos.length} lottos`);

  return response;
}

export function clearEarningsHubCache(): void { cached = null; }
