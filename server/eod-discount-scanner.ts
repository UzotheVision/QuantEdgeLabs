/**
 * EOD Discount Scanner — relative-value option "discounts" near the close.
 *
 * THE IDEA (honest framing):
 *   For each symbol we pull the CBOE delayed chain and look for contracts whose
 *   implied vol sits BELOW the local smile baseline — i.e. the market is pricing
 *   that strike cheaper than its neighbors imply it "should" be. Those are
 *   relative-value discounts: a way to enter a directional bet for less premium
 *   and carry it overnight / into next week.
 *
 * WHAT THIS IS NOT:
 *   - Not real-time. CBOE is ~15min delayed, so this is a "near-close" read.
 *   - Not absolute mispricing. We compare each contract's IV to a baseline built
 *     from its OWN expiry's smile (median IV of neighboring strikes). A contract
 *     can look cheap because the model hasn't caught a real vol shift — that's
 *     why we also gate on liquidity and surface the raw IVs for the user to judge.
 *   - Not advice. We rank cheap, liquid, tradeable contracts; the user picks the
 *     side (call/put) that matches their own thesis.
 *
 * Fair value is computed with the canonical Black-Scholes pricer in
 * options-quant.ts, re-priced at the baseline IV, so the dollar discount is
 * "what this contract would cost at peer vol" minus the live market mid.
 */
import { fetchCboeChain } from './contract-analyzer/cboe-chain';
import { blackScholes } from './options-quant';
import { logger } from './logger';

const RISK_FREE_RATE = 0.045;

/**
 * Only fit the smile — and only flag contracts — inside this log-moneyness band
 * (|ln(strike/spot)| ≤ 0.18, i.e. ~±18% around spot). The deep wings carry
 * enormous IV at short DTE; if they enter the least-squares fit they lift the
 * whole parabola and make even ATM contracts look 50%+ "cheap". Restricting to
 * the liquid body keeps the quadratic a faithful local model.
 */
const MAX_FIT_K = 0.18;
/** Reject implausible "discounts" — anything beyond this is a fit artifact, not an edge. */
const MAX_DISCOUNT_PCT = 0.45;
/** A contract must sit this many residual-σ below the fitted smile to count as cheap. */
const OUTLIER_Z = 1.25;
/**
 * A contract must also be at least this many VOL POINTS (decimal) below the
 * fitted smile. Without this floor, a 1-2 vol-point gap on a cheap OTM option
 * shows as a 20%+ "discount" purely because the premium is tiny — that's smile
 * texture/noise, not a real edge. Requiring a genuine vega-meaningful gap is
 * what kills the flood of low-delta puts the user (rightly) flagged as bogus.
 */
const MIN_VOL_EDGE = 0.03; // 3 vol points

export type DiscountBucket = 'overnight' | 'weekly' | 'swing';

export interface DiscountContract {
  symbol: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string; // YYYY-MM-DD
  dte: number;
  bucket: DiscountBucket;
  mid: number;
  bid: number;
  ask: number;
  spreadPct: number;
  iv: number; // contract IV (decimal, e.g. 0.52)
  baselineIv: number; // fitted smile IV at this strike (decimal)
  volEdge: number; // vol points below the fitted smile (baselineIv - iv)
  zEdge: number; // residual-σ below the fitted smile (outlier strength)
  fairValue: number; // BS price re-priced at baseline IV
  discountDollars: number; // fairValue - mid
  discountPct: number; // (fairValue - mid) / fairValue
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  openInterest: number;
  volume: number;
  spot: number;
  score: number; // 0-100 composite
  rationale: string;
}

export interface EodDiscountResult {
  asOf: string;
  scannedCount: number;
  symbolsWithData: number;
  thresholdPct: number;
  contracts: DiscountContract[];
  notes: string[];
}

export interface ScanOpts {
  minDiscountPct?: number; // default 0.04 (4%)
  maxResults?: number; // default 50
  side?: 'call' | 'put' | 'both'; // default both
  minDte?: number; // default 1
  maxDte?: number; // default 60
  minOpenInterest?: number; // default 100
}

/** CBOE sometimes ships IV as a percent (45) and sometimes decimal (0.45). Normalize to decimal. */
function normIv(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 0;
  return raw > 3 ? raw / 100 : raw;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Fit a quadratic smile  iv ≈ a + b·k + c·k²  (k = ln(strike/spot)) by ordinary
 * least squares. Returns the coefficients or null if the fit is degenerate.
 *
 * WHY A FIT (not neighbor-median): the equity vol smile is steep and CONVEX on
 * the downside. Comparing each strike to its neighbors' median therefore flags
 * almost every put as "below its neighbors" — it's measuring curvature, not
 * mispricing. A smooth quadratic captures that curvature, so residuals below the
 * curve are genuine outliers and come out balanced across calls and puts.
 */
function fitQuadratic(
  points: { k: number; iv: number }[],
): { a: number; b: number; c: number; resStd: number } | null {
  const n = points.length;
  if (n < 6) return null;
  let Sx = 0, Sx2 = 0, Sx3 = 0, Sx4 = 0, Sy = 0, Sxy = 0, Sx2y = 0;
  for (const { k, iv } of points) {
    const k2 = k * k;
    Sx += k;
    Sx2 += k2;
    Sx3 += k2 * k;
    Sx4 += k2 * k2;
    Sy += iv;
    Sxy += k * iv;
    Sx2y += k2 * iv;
  }
  // Normal-equations matrix M·[a,b,c] = v, solved by Cramer's rule.
  const M = [
    [n, Sx, Sx2],
    [Sx, Sx2, Sx3],
    [Sx2, Sx3, Sx4],
  ];
  const v = [Sy, Sxy, Sx2y];
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(M);
  if (!isFinite(D) || Math.abs(D) < 1e-12) return null;
  const col = (idx: number) => M.map((row, r) => row.map((val, c) => (c === idx ? v[r] : val)));
  const a = det3(col(0)) / D;
  const b = det3(col(1)) / D;
  const c = det3(col(2)) / D;
  if (![a, b, c].every(isFinite)) return null;
  // Residual spread of the fit — how tightly the smile hugs the quadratic. We use
  // it to flag only genuine outliers (IV well below the curve), so the flag is
  // balanced across calls and puts instead of catching every point that happens
  // to sit a hair under a curve that can't perfectly model asymmetric skew.
  let ss = 0;
  for (const { k, iv } of points) {
    const r = iv - (a + b * k + c * k * k);
    ss += r * r;
  }
  const resStd = Math.sqrt(ss / n);
  return { a, b, c, resStd };
}

function bucketFor(dte: number): DiscountBucket {
  if (dte <= 2) return 'overnight';
  if (dte <= 9) return 'weekly';
  return 'swing';
}

function dteFrom(expiry: string, now: Date): number {
  const exp = new Date(`${expiry}T20:00:00Z`); // expiry ~ end of trading day
  return Math.max(0, Math.round((exp.getTime() - now.getTime()) / 86_400_000));
}

interface ChainOpt {
  option_type: string;
  strike: number;
  expiration_date: string;
  bid: number;
  ask: number;
  volume?: number;
  open_interest?: number;
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number; mid_iv?: number };
}

/**
 * Scan one symbol's chain for relative-value discounts.
 * Pure-ish: takes the already-fetched chain so it's unit-testable.
 */
function scanSymbolChain(
  symbol: string,
  spot: number,
  rawChain: ChainOpt[],
  opts: Required<ScanOpts>,
  now: Date,
): DiscountContract[] {
  const out: DiscountContract[] = [];

  // Sanity guard: the spot must sit within the listed strike ladder. CBOE
  // occasionally serves an inconsistent underlying quote (spot far outside the
  // strikes), which would make every Black-Scholes fair value meaningless. Skip
  // the symbol rather than surface a nonsense "fair value" to the user.
  if (rawChain.length > 0) {
    let minStrike = Infinity;
    let maxStrike = -Infinity;
    for (const o of rawChain) {
      if (o.strike < minStrike) minStrike = o.strike;
      if (o.strike > maxStrike) maxStrike = o.strike;
    }
    if (spot < minStrike * 0.9 || spot > maxStrike * 1.1) return out;
  }

  // Group by EXPIRY + SIDE. The equity skew is asymmetric — the put wing is
  // steeper and more convex than the call wing — so a single curve over both
  // sides can't fit it, and the misfit systematically parks the near-OTM puts
  // below the curve (which read as false "discounts"). Fitting each side's own
  // smile asks the right question: is THIS put cheap vs the OTHER puts, is THIS
  // call cheap vs the other calls. That removes the cross-side bias and balances
  // the output across calls and puts.
  const groups = new Map<string, ChainOpt[]>();
  for (const o of rawChain) {
    const type = o.option_type === 'call' || o.option_type === 'put' ? o.option_type : null;
    if (!type) continue;
    if (opts.side !== 'both' && type !== opts.side) continue;
    const dte = dteFrom(o.expiration_date, now);
    if (dte < opts.minDte || dte > opts.maxDte) continue;
    const key = `${o.expiration_date}|${type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }

  for (const group of Array.from(groups.values())) {
    // Collect every usable IV point on this side's smile: x = log-moneyness
    // ln(strike/spot), y = IV.
    const points: { k: number; iv: number }[] = [];
    for (const o of group) {
      const iv = normIv(Number(o.greeks?.mid_iv ?? 0));
      if (iv <= 0 || o.strike <= 0) continue;
      const k = Math.log(o.strike / spot);
      if (Math.abs(k) > MAX_FIT_K) continue; // keep the fit to the liquid body
      points.push({ k, iv });
    }
    const fit = fitQuadratic(points);
    if (!fit) continue; // need ≥6 clean points for a stable smile

    const fitIvAt = (k: number) => fit.a + fit.b * k + fit.c * k * k;

    for (const o of group) {
      const iv = normIv(Number(o.greeks?.mid_iv ?? 0));
      if (iv <= 0 || o.strike <= 0) continue;

      // Only score contracts inside the band the smile was actually fit on.
      const k = Math.log(o.strike / spot);
      if (Math.abs(k) > MAX_FIT_K) continue;

      const bid = Number(o.bid ?? 0);
      const ask = Number(o.ask ?? 0);
      const mid = (bid + ask) / 2;
      if (mid < 0.05 || ask <= 0) continue; // untradeable / no offer

      const spreadPct = mid > 0 ? (ask - bid) / mid : 1;
      if (spreadPct > 0.25) continue; // too wide

      const oi = Math.round(Number(o.open_interest ?? 0));
      const vol = Math.round(Number(o.volume ?? 0));
      if (oi < opts.minOpenInterest && vol <= 0) continue; // illiquid

      const delta = Number(o.greeks?.delta ?? 0);
      if (Math.abs(delta) < 0.12 || Math.abs(delta) > 0.80) continue; // skip junk wings & deep-ITM

      // Baseline = the FITTED smile value at this strike's log-moneyness.
      // A contract is a "discount" only if its IV sits below the smooth curve —
      // a true outlier, not just a point on the natural downside skew.
      const baselineIv = fitIvAt(k);
      if (baselineIv <= 0) continue;
      // A contract is "cheap" only if its IV is BOTH a statistical outlier
      // (≥OUTLIER_Z residual-σ below the fitted smile) AND a genuine vega-edge
      // (≥MIN_VOL_EDGE vol points below it). The σ test adapts to how noisy each
      // smile is; the absolute floor stops cheap-OTM noise from qualifying. Both
      // gates together are what balance calls vs puts and kill the bogus flood.
      const volEdge = baselineIv - iv; // vol points below the fitted smile
      const zEdge = fit.resStd > 0 ? volEdge / fit.resStd : 0;
      if (volEdge < MIN_VOL_EDGE) continue;
      if (zEdge < OUTLIER_Z) continue;

      const dte = dteFrom(o.expiration_date, now);
      const T = Math.max(dte, 0.5) / 365;

      // Re-price at the baseline IV → what it "should" cost at peer vol.
      const fair = blackScholes({
        spotPrice: spot,
        strikePrice: o.strike,
        timeToExpiry: T,
        riskFreeRate: RISK_FREE_RATE,
        volatility: baselineIv,
        optionType: o.option_type as 'call' | 'put',
      }).theoreticalPrice;

      if (!isFinite(fair) || fair <= mid) continue;
      const discountDollars = fair - mid;
      const discountPct = discountDollars / fair;
      if (discountPct < opts.minDiscountPct) continue;
      if (discountPct > MAX_DISCOUNT_PCT) continue; // implausibly large → fit artifact / stale quote, not an edge

      // Composite score is driven by the VOL-EDGE STRENGTH (how many residual-σ
      // below the smile), NOT the dollar-%. The dollar-% inflates for cheap OTM
      // contracts and was what buried real call signals under low-delta puts.
      const edgeScore = Math.min(zEdge / 3, 1) * 60; // up to 60 pts at 3σ below the smile
      const liqScore = Math.min(oi / 2000, 1) * 25; // up to 25 pts
      const spreadScore = Math.max(0, 1 - spreadPct / 0.25) * 15; // up to 15 pts
      const score = Math.round(edgeScore + liqScore + spreadScore);

      const rationale =
        `IV ${(iv * 100).toFixed(0)}% vs fitted smile ${(baselineIv * 100).toFixed(0)}% ` +
        `(${(volEdge * 100).toFixed(1)} vol-pts / ${zEdge.toFixed(1)}σ under) — ` +
        `~${(discountPct * 100).toFixed(0)}% cheaper than fair ($${fair.toFixed(2)} vs $${mid.toFixed(2)} mid).`;

      out.push({
        symbol,
        optionType: o.option_type as 'call' | 'put',
        strike: o.strike,
        expiry: o.expiration_date,
        dte,
        bucket: bucketFor(dte),
        mid: Number(mid.toFixed(2)),
        bid: Number(bid.toFixed(2)),
        ask: Number(ask.toFixed(2)),
        spreadPct: Number(spreadPct.toFixed(3)),
        iv: Number(iv.toFixed(4)),
        baselineIv: Number(baselineIv.toFixed(4)),
        volEdge: Number(volEdge.toFixed(4)),
        zEdge: Number(zEdge.toFixed(2)),
        fairValue: Number(fair.toFixed(2)),
        discountDollars: Number(discountDollars.toFixed(2)),
        discountPct: Number(discountPct.toFixed(4)),
        delta: Number(delta.toFixed(3)),
        gamma: Number(Number(o.greeks?.gamma ?? 0).toFixed(4)),
        theta: Number(Number(o.greeks?.theta ?? 0).toFixed(3)),
        vega: Number(Number(o.greeks?.vega ?? 0).toFixed(3)),
        openInterest: oi,
        volume: vol,
        spot: Number(spot.toFixed(2)),
        score,
        rationale,
      });
    }
  }

  return out;
}

/**
 * Scan a universe of symbols for end-of-day relative-value option discounts.
 * Fetches CBOE chains concurrently (bounded), ranks all hits by score.
 */
export async function scanEodDiscounts(symbols: string[], opts: ScanOpts = {}): Promise<EodDiscountResult> {
  const resolved: Required<ScanOpts> = {
    minDiscountPct: opts.minDiscountPct ?? 0.04,
    maxResults: opts.maxResults ?? 50,
    side: opts.side ?? 'both',
    minDte: opts.minDte ?? 1,
    maxDte: opts.maxDte ?? 60,
    minOpenInterest: opts.minOpenInterest ?? 100,
  };
  const now = new Date();
  const uniq = Array.from(new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean)));

  const all: DiscountContract[] = [];
  let symbolsWithData = 0;
  const notes: string[] = [];

  // Bounded concurrency so we don't hammer the CBOE CDN (it 429s under bursts).
  const BATCH = 6;
  for (let i = 0; i < uniq.length; i += BATCH) {
    const slice = uniq.slice(i, i + BATCH);
    const chains = await Promise.all(
      slice.map(async (sym) => {
        try {
          const chain = await fetchCboeChain(sym);
          return { sym, chain };
        } catch (e) {
          logger.warn(`[EOD-DISCOUNT] ${sym} chain fetch failed: ${(e as Error).message}`);
          return { sym, chain: null };
        }
      }),
    );
    for (const { sym, chain } of chains) {
      if (!chain || chain.rawChain.length === 0 || chain.spot <= 0) continue;
      symbolsWithData++;
      all.push(...scanSymbolChain(sym, chain.spot, chain.rawChain as any, resolved, now));
    }
  }

  all.sort((a, b) => b.score - a.score || b.discountPct - a.discountPct);
  const contracts = all.slice(0, resolved.maxResults);

  if (symbolsWithData === 0) {
    notes.push('No CBOE chains returned data — markets may be closed or the symbols have no listed options.');
  } else if (contracts.length === 0) {
    notes.push(
      `Scanned ${symbolsWithData} symbols with chains but found no contracts trading ${(resolved.minDiscountPct * 100).toFixed(0)}%+ below their smile baseline. Try lowering the discount threshold.`,
    );
  }
  notes.push('CBOE quotes are ~15min delayed — treat this as a near-close read, not a live print.');

  return {
    asOf: now.toISOString(),
    scannedCount: uniq.length,
    symbolsWithData,
    thresholdPct: resolved.minDiscountPct,
    contracts,
    notes,
  };
}
