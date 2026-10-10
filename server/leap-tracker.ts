/**
 * LEAP TRACKER — "find the A+ LEAPS to absolutely get"
 * ====================================================
 * Ranks long-dated (6mo+) call LEAPS across a curated quality universe and
 * surfaces the highest-conviction stock-replacement bets. An "A+ LEAP" is a
 * secular leader in a sector money is flowing INTO, trending above its own
 * moving averages, with a deep-ITM contract (~0.70-0.80 delta) that is liquid
 * and not grossly overpriced on IV.
 *
 * Three orthogonal pillars (0-100 total):
 *   1. SECTOR  (0-30) — rotation leadership of the name's sector ETF (RRG
 *                       quadrant + 3M relative strength). "Follow the money."
 *   2. TREND   (0-30) — the name's OWN price structure: above 50/200-day,
 *                       golden-cross, positive 3M & 6M return.
 *   3. CONTRACT(0-40) — the actual LEAP the canonical option-selection engine
 *                       returns: delta fit (stock-replacement), liquidity,
 *                       IV level (don't overpay vega), modeled R:R.
 *
 * Honesty contract: every number is live (Yahoo history + CBOE chain via the
 * canonical engine). A name with no liquid LEAP, or no history, is dropped —
 * never fabricated. Cached 15min.
 *
 * Reuses (no duplicate logic):
 *   - option-selection-engine.selectContracts (expiryTier:'LEAP') for the contract.
 *   - sector-rotation.getRotationMatrix for sector leadership.
 */

import { logger } from './logger';
import { selectContracts, type ContractCandidate, type ContractSelection } from './option-selection-engine';
import { getRotationMatrix, type Quadrant, type RotationMatrixData } from './sector-rotation';
import { getRealtimeBatchQuotes } from './realtime-pricing-service';

// ─── Public types ──────────────────────────────────────────────────

export type LeapGrade = 'S' | 'A' | 'B' | 'C';

export interface LeapFundamentals {
  eps: number | null;          // trailing EPS
  revenue: number | null;      // trailing-12m revenue ($)
  revenueGrowth: number | null;// YoY revenue growth (fraction, e.g. 0.42 = +42%)
  cash: number | null;         // total cash ($)
  profitable: boolean | null;  // net income > 0
  marketCap: number | null;
  forwardPE: number | null;
}

export interface LeapPick {
  symbol: string;
  name: string;
  sectorEtf: string;
  sectorLabel: string;
  tier: 'core' | 'spec';
  spot: number;
  fundamentals: LeapFundamentals | null;

  // Pillars
  score: number;            // 0-100 composite
  grade: LeapGrade;
  sectorScore: number;      // 0-30
  trendScore: number;       // 0-30
  contractScore: number;    // 0-40

  // Sector context
  quadrant: Quadrant;
  sectorRel3M: number | null;
  sectorTrend: 'accelerating' | 'rolling' | 'steady';

  // Trend context
  ret3M: number | null;
  ret6M: number | null;
  aboveSma50: boolean;
  aboveSma200: boolean;
  goldenCross: boolean;

  // The LEAP contract (from canonical engine)
  optionSymbol: string;
  strike: number;
  expiry: string;
  dte: number;
  delta: number;
  iv: number;
  entryPremium: number;
  breakeven: number;
  openInterest: number;
  spreadPct: number;
  roiAtT1Pct: number;
  roiAtT2Pct?: number;
  riskRewardRatio: number;

  // Plain-English why
  why: string[];
  ivLabel: 'cheap' | 'fair' | 'rich';
}

export interface LeapTrackerData {
  asOf: string;
  sessionLabel: string;
  isStale: boolean;
  spyChange: number;
  scanned: number;          // names attempted
  qualified: number;        // names with a liquid LEAP
  picks: LeapPick[];        // sorted best-first
  note?: string;
}

// ─── Curated LEAP universe ─────────────────────────────────────────
// Quality, liquid names with deep long-dated chains, mapped to the sector ETF
// the rotation engine reports. These are the only names worth a 1-year bet;
// junk with thin LEAP chains is deliberately excluded.

interface UniverseName { sym: string; name: string; etf: string; tier?: 'core' | 'spec'; }

const LEAP_UNIVERSE: UniverseName[] = [
  // ─── CORE: quality mega/large caps with deep, liquid LEAP chains ───
  // Semis (user's home turf)
  { sym: 'NVDA', name: 'NVIDIA',        etf: 'SMH' },
  { sym: 'AVGO', name: 'Broadcom',      etf: 'SMH' },
  { sym: 'AMD',  name: 'AMD',           etf: 'SMH' },
  { sym: 'MU',   name: 'Micron',        etf: 'SMH' },
  { sym: 'ARM',  name: 'Arm',           etf: 'SMH' },
  { sym: 'MRVL', name: 'Marvell',       etf: 'SMH' },
  { sym: 'KLAC', name: 'KLA',           etf: 'SMH' },
  { sym: 'LRCX', name: 'Lam Research',  etf: 'SMH' },
  { sym: 'TSM',  name: 'TSMC',          etf: 'SMH' },
  // Mega-cap tech / software
  { sym: 'MSFT', name: 'Microsoft',     etf: 'XLK' },
  { sym: 'AAPL', name: 'Apple',         etf: 'XLK' },
  { sym: 'GOOGL',name: 'Alphabet',      etf: 'XLK' },
  { sym: 'META', name: 'Meta',          etf: 'XLK' },
  { sym: 'AMZN', name: 'Amazon',        etf: 'XLY' },
  { sym: 'NOW',  name: 'ServiceNow',    etf: 'IGV' },
  { sym: 'CRM',  name: 'Salesforce',    etf: 'IGV' },
  { sym: 'PANW', name: 'Palo Alto',     etf: 'IGV' },
  { sym: 'CRWD', name: 'CrowdStrike',   etf: 'IGV' },
  { sym: 'ORCL', name: 'Oracle',        etf: 'XLK' },
  // Healthcare / pharma (rotation destination)
  { sym: 'LLY',  name: 'Eli Lilly',     etf: 'XLV' },
  { sym: 'UNH',  name: 'UnitedHealth',  etf: 'XLV' },
  { sym: 'ABBV', name: 'AbbVie',        etf: 'XLV' },
  { sym: 'ISRG', name: 'Intuitive',     etf: 'XLV' },
  // Financials
  { sym: 'JPM',  name: 'JPMorgan',      etf: 'XLF' },
  { sym: 'GS',   name: 'Goldman Sachs', etf: 'XLF' },
  // Defense / industrials
  { sym: 'GE',   name: 'GE Aerospace',  etf: 'XLI' },
  { sym: 'RTX',  name: 'RTX',           etf: 'ITA' },
  // Cons disc / energy
  { sym: 'TSLA', name: 'Tesla',         etf: 'XLY' },
  { sym: 'XOM',  name: 'Exxon',         etf: 'XLE' },

  // ─── SPEC: retail / Twitter speculative names (drop in if they have a
  // liquid LEAP; many are cheap so their LEAPs run cents–few $). Surfaced WITH
  // fundamentals so a high-flyer isn't mistaken for a profitable compounder. ──
  // Fintech / retail-favorite financials
  { sym: 'SOFI', name: 'SoFi',          etf: 'XLF', tier: 'spec' },
  { sym: 'HOOD', name: 'Robinhood',     etf: 'XLF', tier: 'spec' },
  { sym: 'AFRM', name: 'Affirm',        etf: 'XLF', tier: 'spec' },
  { sym: 'COIN', name: 'Coinbase',      etf: 'XLF', tier: 'spec' },
  // Quantum
  { sym: 'QBTS', name: 'D-Wave Quantum',etf: 'XLK', tier: 'spec' },
  { sym: 'QUBT', name: 'Quantum Comp',  etf: 'XLK', tier: 'spec' },
  { sym: 'IONQ', name: 'IonQ',          etf: 'XLK', tier: 'spec' },
  { sym: 'RGTI', name: 'Rigetti',       etf: 'XLK', tier: 'spec' },
  { sym: 'LAES', name: 'SEALSQ',        etf: 'SMH', tier: 'spec' },
  // AI / data / software high-flyers
  { sym: 'PLTR', name: 'Palantir',      etf: 'XLK', tier: 'spec' },
  { sym: 'SOUN', name: 'SoundHound AI', etf: 'XLK', tier: 'spec' },
  { sym: 'AI',   name: 'C3.ai',         etf: 'XLK', tier: 'spec' },
  { sym: 'HPE',  name: 'HPE',           etf: 'XLK', tier: 'spec' },
  // Robotics / drones / space / eVTOL
  { sym: 'SERV', name: 'Serve Robotics',etf: 'XLK', tier: 'spec' },
  { sym: 'ONDS', name: 'Ondas',         etf: 'ITA', tier: 'spec' },
  { sym: 'RKLB', name: 'Rocket Lab',    etf: 'ITA', tier: 'spec' },
  { sym: 'ASTS', name: 'AST SpaceMobile',etf: 'XLK', tier: 'spec' },
  { sym: 'ACHR', name: 'Archer Aviation',etf: 'ITA', tier: 'spec' },
  { sym: 'JOBY', name: 'Joby Aviation', etf: 'ITA', tier: 'spec' },
  // Nuclear / energy transition
  { sym: 'OKLO', name: 'Oklo',          etf: 'XLE', tier: 'spec' },
  { sym: 'SMR',  name: 'NuScale Power', etf: 'XLE', tier: 'spec' },
  // EV / cons disc high-flyers
  { sym: 'RIVN', name: 'Rivian',        etf: 'XLY', tier: 'spec' },
  { sym: 'DKNG', name: 'DraftKings',    etf: 'XLY', tier: 'spec' },
];

const ETF_LABEL: Record<string, string> = {
  SMH: 'Semis', XLK: 'Tech', IGV: 'Software', XLV: 'Healthcare',
  XLF: 'Financials', XLI: 'Industrials', ITA: 'Defense', XLY: 'Cons Disc', XLE: 'Energy',
};

// ─── Yahoo daily history (self-contained; Yahoo is the working source) ──

interface DailyHistory { closes: number[]; }

async function fetchDaily(symbol: string): Promise<DailyHistory | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d&includePrePost=false`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j: any = await r.json();
    const res = j?.chart?.result?.[0];
    const raw: any[] = res?.indicators?.quote?.[0]?.close || [];
    const closes = raw.filter((c) => c != null) as number[];
    if (closes.length < 130) return null;
    return { closes };
  } catch (e: any) {
    logger.warn(`[leap-tracker] history failed ${symbol}: ${e?.message || e}`);
    return null;
  }
}

// ─── Fundamentals (EPS / revenue / cash) via Yahoo quoteSummary ────────
// Honest: any field Yahoo doesn't return stays null and the UI omits it.
const _fundCache = new Map<string, { at: number; data: LeapFundamentals | null }>();
const FUND_TTL = 6 * 60 * 60 * 1000; // 6h — fundamentals barely move intraday

async function fetchFundamentals(symbol: string): Promise<LeapFundamentals | null> {
  const cached = _fundCache.get(symbol);
  if (cached && Date.now() - cached.at < FUND_TTL) return cached.data;
  try {
    const { safeQuoteSummary } = await import('./yahoo-finance-service');
    const s: any = await safeQuoteSummary(symbol, ['defaultKeyStatistics', 'financialData', 'summaryDetail', 'price']);
    if (!s) { _fundCache.set(symbol, { at: Date.now(), data: null }); return null; }
    const ks = s?.defaultKeyStatistics ?? {};
    const fd = s?.financialData ?? {};
    const px = s?.price ?? {};
    const num = (v: any): number | null =>
      typeof v === 'number' ? v : (v && typeof v.raw === 'number' ? v.raw : null);
    const data: LeapFundamentals = {
      eps: num(ks.trailingEps),
      revenue: num(fd.totalRevenue),
      revenueGrowth: num(fd.revenueGrowth),
      cash: num(fd.totalCash),
      profitable: typeof num(fd.profitMargins) === 'number' ? (num(fd.profitMargins) as number) > 0 : null,
      marketCap: num(px.marketCap),
      forwardPE: num(ks.forwardPE),
    };
    _fundCache.set(symbol, { at: Date.now(), data });
    return data;
  } catch (e: any) {
    logger.warn(`[leap-tracker] fundamentals failed ${symbol}: ${e?.message || e}`);
    _fundCache.set(symbol, { at: Date.now(), data: null });
    return null;
  }
}

function sma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  const slice = closes.slice(closes.length - n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function pctOver(closes: number[], barsBack: number): number | null {
  if (closes.length < barsBack + 1) return null;
  const last = closes[closes.length - 1];
  const ref = closes[closes.length - 1 - barsBack];
  if (!ref) return null;
  return ((last - ref) / ref) * 100;
}

// ─── Pillar scorers ────────────────────────────────────────────────

interface SectorCtx {
  quadrant: Quadrant;
  rel3M: number | null;
  trend: 'accelerating' | 'rolling' | 'steady';
}

function scoreSector(ctx: SectorCtx | null): { score: number; why: string[] } {
  const why: string[] = [];
  if (!ctx) return { score: 12, why: ['Sector flow unknown'] };
  let s = 0;
  switch (ctx.quadrant) {
    case 'leading':   s = ctx.trend === 'rolling' ? 20 : 26; why.push(ctx.trend === 'rolling' ? 'Sector leading but cooling' : 'Sector leading — money parked here'); break;
    case 'improving': s = 22; why.push('Money rotating INTO sector (early)'); break;
    case 'weakening': s = 11; why.push('Sector fading — money leaving'); break;
    case 'lagging':   s = ctx.trend === 'accelerating' ? 12 : 5; why.push(ctx.trend === 'accelerating' ? 'Sector basing — early turn up' : 'Sector out of favor'); break;
  }
  // Relative-strength bonus (up to +4): reward sectors leading SPY over 3M.
  if (ctx.rel3M != null) {
    if (ctx.rel3M > 5) s += 4;
    else if (ctx.rel3M > 0) s += 2;
    else if (ctx.rel3M < -5) s -= 2;
  }
  return { score: Math.max(0, Math.min(30, s)), why };
}

function scoreTrend(closes: number[]): { score: number; why: string[]; ctx: {
  ret3M: number | null; ret6M: number | null; aboveSma50: boolean; aboveSma200: boolean; goldenCross: boolean;
} } {
  const last = closes[closes.length - 1];
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const ret3M = pctOver(closes, 63);
  const ret6M = pctOver(closes, 126);
  const aboveSma50 = s50 != null && last > s50;
  const aboveSma200 = s200 != null && last > s200;
  const goldenCross = s50 != null && s200 != null && s50 > s200;

  let s = 0;
  const why: string[] = [];
  if (aboveSma200) { s += 9; } else { why.push('Below 200-day'); }
  if (aboveSma50) { s += 6; }
  if (goldenCross) { s += 5; why.push('Golden cross (50>200)'); }
  if (ret6M != null && ret6M > 0) s += Math.min(6, ret6M / 5); // up to +6 for strong 6M
  if (ret3M != null && ret3M > 0) s += Math.min(4, ret3M / 5); // up to +4 for strong 3M
  if (ret6M != null && ret6M < -10) s -= 4;
  if (aboveSma200 && aboveSma50 && goldenCross) why.push('Clean uptrend (above 50 & 200, golden cross)');

  return {
    score: Math.max(0, Math.min(30, Math.round(s))),
    why,
    ctx: { ret3M, ret6M, aboveSma50, aboveSma200, goldenCross },
  };
}

function ivLabelFor(iv: number): 'cheap' | 'fair' | 'rich' {
  if (iv < 0.35) return 'cheap';
  if (iv <= 0.55) return 'fair';
  return 'rich';
}

function scoreContract(c: ContractCandidate): { score: number; why: string[]; ivLabel: 'cheap' | 'fair' | 'rich' } {
  const why: string[] = [];
  let s = 0;

  // Delta fit: stock-replacement sweet spot ~0.70-0.80 (deep ITM, low theta burn).
  const d = Math.abs(c.delta);
  let deltaFit: number;
  if (d >= 0.70 && d <= 0.82) { deltaFit = 16; why.push(`Stock-replacement Δ${d.toFixed(2)}`); }
  else if (d >= 0.60 && d < 0.70) deltaFit = 12;
  else if (d > 0.82 && d <= 0.90) deltaFit = 12;
  else if (d >= 0.50 && d < 0.60) deltaFit = 8;
  else deltaFit = 4;
  s += deltaFit;

  // Liquidity (0-12): OI + tight spread.
  const oiScore = Math.min(8, (c.openInterest / 1500) * 8);
  const spreadScore = (1 - Math.min(1, c.spreadPct / 0.15)) * 4;
  s += oiScore + spreadScore;
  if (c.openInterest < 250) why.push('Thin LEAP OI');

  // IV level (0-8): don't overpay vega on a long-dated bet.
  const ivLabel = ivLabelFor(c.iv);
  s += ivLabel === 'cheap' ? 8 : ivLabel === 'fair' ? 5 : 1;
  if (ivLabel === 'rich') why.push(`Rich IV ${(c.iv * 100).toFixed(0)}% — paying up for vega`);
  else if (ivLabel === 'cheap') why.push(`Cheap IV ${(c.iv * 100).toFixed(0)}%`);

  // Modeled R:R (0-4).
  s += c.riskRewardRatio >= 2 ? 4 : c.riskRewardRatio >= 1 ? 2 : 0;

  return { score: Math.max(0, Math.min(40, Math.round(s))), why, ivLabel };
}

function gradeFor(score: number): LeapGrade {
  if (score >= 78) return 'S';
  if (score >= 66) return 'A';
  if (score >= 52) return 'B';
  return 'C';
}

// ─── Main ──────────────────────────────────────────────────────────

let _cache: { at: number; data: LeapTrackerData } | null = null;
const TTL_MS = 15 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function evaluate(
  u: UniverseName,
  sectorCtx: SectorCtx | null,
  liveSpot: number | null,
): Promise<LeapPick | null> {
  const hist = await fetchDaily(u.sym);
  if (!hist) return null;
  // Use the live quote as spot for display + the engine's ROI anchor so prices
  // stay consistent with the rest of the platform; fall back to last daily close.
  const lastClose = hist.closes[hist.closes.length - 1];
  const spot = liveSpot && liveSpot > 0 ? liveSpot : lastClose;
  if (!(spot > 0)) return null;

  const sectorR = scoreSector(sectorCtx);
  const trendR = scoreTrend(hist.closes);

  // Build a long-horizon bullish stock-replacement thesis. Targets/stop are
  // structural anchors for the engine's ROI/R:R projection over the hold.
  const conviction = Math.min(100, Math.round((sectorR.score + trendR.score) * (100 / 60)));
  const selection: ContractSelection = await selectContracts({
    symbol: u.sym,
    direction: 'bullish',
    setup: 'position',
    expiryTier: 'LEAP',
    entry: spot,
    stop: +(spot * 0.80).toFixed(2),
    t1: +(spot * 1.30).toFixed(2),
    t2: +(spot * 1.60).toFixed(2),
    holdingDays: 180,
    conviction,
    asOfSpot: spot,
  });

  if (selection.status !== 'ok' || selection.picks.length === 0) return null;
  // Prefer the conservative (deepest-ITM) pick for a stock-replacement LEAP;
  // fall back to the engine's recommended/best.
  const pick =
    selection.picks.find((p) => p.tier === 'conservative') ??
    selection.picks.find((p) => p.tier === selection.recommendedTier) ??
    selection.picks[0];

  const contractR = scoreContract(pick);
  const score = sectorR.score + trendR.score + contractR.score;

  const fundamentals = await fetchFundamentals(u.sym);
  // For speculative names, append a fundamentals reality-check to the thesis.
  if (u.tier === 'spec' && fundamentals) {
    if (fundamentals.profitable === false) contractR.why.push('Not yet profitable — speculative LEAP');
    if (fundamentals.revenueGrowth != null && fundamentals.revenueGrowth > 0.3)
      contractR.why.push(`Revenue +${(fundamentals.revenueGrowth * 100).toFixed(0)}% YoY`);
  }

  return {
    symbol: u.sym,
    name: u.name,
    sectorEtf: u.etf,
    sectorLabel: ETF_LABEL[u.etf] ?? u.etf,
    tier: u.tier ?? 'core',
    fundamentals,
    spot: +spot.toFixed(2),
    score,
    grade: gradeFor(score),
    sectorScore: sectorR.score,
    trendScore: trendR.score,
    contractScore: contractR.score,
    quadrant: sectorCtx?.quadrant ?? 'improving',
    sectorRel3M: sectorCtx?.rel3M ?? null,
    sectorTrend: sectorCtx?.trend ?? 'steady',
    ret3M: trendR.ctx.ret3M,
    ret6M: trendR.ctx.ret6M,
    aboveSma50: trendR.ctx.aboveSma50,
    aboveSma200: trendR.ctx.aboveSma200,
    goldenCross: trendR.ctx.goldenCross,
    optionSymbol: pick.optionSymbol,
    strike: pick.strike,
    expiry: pick.expiry,
    dte: pick.dte,
    delta: pick.delta,
    iv: pick.iv,
    entryPremium: pick.entryPremium,
    breakeven: pick.breakeven,
    openInterest: pick.openInterest,
    spreadPct: pick.spreadPct,
    roiAtT1Pct: pick.roiAtT1Pct,
    roiAtT2Pct: pick.roiAtT2Pct,
    riskRewardRatio: pick.riskRewardRatio,
    why: [...sectorR.why, ...trendR.why, ...contractR.why],
    ivLabel: contractR.ivLabel,
  };
}

export async function getLeapTracker(force = false): Promise<LeapTrackerData> {
  if (!force && _cache && Date.now() - _cache.at < TTL_MS) return _cache.data;

  let matrix: RotationMatrixData | null = null;
  try {
    matrix = await getRotationMatrix(force);
  } catch (e: any) {
    logger.warn(`[leap-tracker] rotation matrix unavailable: ${e?.message || e}`);
  }
  const sectorByEtf = new Map<string, SectorCtx>();
  if (matrix) {
    for (const row of matrix.rows) {
      sectorByEtf.set(row.etf, { quadrant: row.quadrant, rel3M: row.rel['3M'], trend: row.trend });
    }
  }

  // Live spot for every name from the unified quote source — keeps the LEAP
  // board's prices consistent with movers/watchlist/convictions.
  const liveSpots = new Map<string, number>();
  try {
    const quoteMap = await getRealtimeBatchQuotes(
      LEAP_UNIVERSE.map((u) => ({ symbol: u.sym, assetType: 'stock' as const })),
    );
    for (const [sym, q] of Array.from(quoteMap.entries())) {
      if (q?.price > 0) liveSpots.set(sym, q.price);
    }
  } catch (e: any) {
    logger.warn(`[leap-tracker] live spot batch failed: ${e?.message || e}`);
  }

  // Evaluate in small batches to respect CBOE/Yahoo rate limits.
  const picks: LeapPick[] = [];
  const BATCH = 4;
  for (let i = 0; i < LEAP_UNIVERSE.length; i += BATCH) {
    const batch = LEAP_UNIVERSE.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((u) => evaluate(u, sectorByEtf.get(u.etf) ?? null, liveSpots.get(u.sym) ?? null).catch(() => null)),
    );
    for (const r of results) if (r) picks.push(r);
    if (i + BATCH < LEAP_UNIVERSE.length) await sleep(250);
  }

  picks.sort((a, b) => b.score - a.score);

  const data: LeapTrackerData = {
    asOf: new Date().toISOString(),
    sessionLabel: matrix?.sessionLabel ?? 'Live',
    isStale: matrix?.isStale ?? false,
    spyChange: matrix?.spyChange ?? 0,
    scanned: LEAP_UNIVERSE.length,
    qualified: picks.length,
    picks,
    note: picks.length === 0 ? 'No liquid LEAP chains available right now.' : undefined,
  };

  _cache = { at: Date.now(), data };
  return data;
}
