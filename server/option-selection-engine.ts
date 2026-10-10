/**
 * OPTION SELECTION ENGINE — Canonical Premium Picker
 * ===================================================
 * Single source of truth for "given a price-action thesis, which option contract
 * gives the best risk-adjusted ROI?" Consolidates the intent scattered across
 * findOptimalStrike / pickBestContract / enrichOptionIdea.
 *
 * Input:  a PriceActionThesis (direction, entry, stop, T1/T2, setup, conviction).
 * Output: up to THREE graded contract picks — conservative / balanced / aggressive —
 *         each with live premium, modeled ROI at T1/T2, R:R, and a
 *         direction-consistent rationale. The caller picks the tier.
 *
 * Honesty contract (matches platform values):
 *   - Entry premium is ALWAYS the live market mid (never fabricated/BS-derived).
 *   - If no live quote / chain is available, returns status:'unavailable' with a
 *     plain reason — it never invents strikes or prices.
 *   - A bearish (put) pick never reads bullish in its rationale.
 *
 * This module is net-new and imports only public tradier-api helpers, so it
 * cannot break existing callers (Phase 0 of the consolidation).
 */

import { logger } from './logger';
import {
  getTradierQuote,
  getTradierOptionExpirations,
  getTradierOptionsChain,
} from './tradier-api';

// ─── Public types ──────────────────────────────────────────────────

export type ThesisDirection = 'bullish' | 'bearish';
export type SetupType = 'scalp' | 'swing' | 'lotto' | 'position';
export type SelectionTier = 'starter' | 'conservative' | 'balanced' | 'aggressive';
export type EngineGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * Explicit expiry tiers — the single vocabulary for "how far out is the contract".
 * Each tier owns a hard DTE band that the selector enforces, so a thesis can never
 * be paired with an expiry from a different horizon (the "1–2 week hold → Jan-2027
 * LEAP" bug). User-selectable per idea; otherwise derived from the holding period.
 */
export type ExpiryTier = '0DTE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'LEAP';

export interface PriceActionThesis {
  symbol: string;
  direction: ThesisDirection;
  /** Drives the DTE window when no explicit expiryTier is given. */
  setup: SetupType;
  /**
   * Explicit expiry tier (0DTE/DAILY/WEEKLY/MONTHLY/LEAP). When set, its DTE band
   * overrides the setup-derived window — this is what guarantees the chosen
   * contract's expiry matches the stated holding horizon.
   */
  expiryTier?: ExpiryTier;
  /** Planned entry stock price (reference for the move). */
  entry: number;
  /** Stop / invalidation stock price. */
  stop: number;
  /** First target stock price. */
  t1: number;
  /** Optional second target stock price. */
  t2?: number;
  /** Optional explicit holding horizon in days (overrides setup default). */
  holdingDays?: number;
  /** Optional conviction 0-100; nudges the recommended tier. */
  conviction?: number;
  /** Optional pre-fetched spot; otherwise fetched live. */
  asOfSpot?: number;
  /** Account-aware selection inputs. Omit them for research-only comparisons. */
  accountSize?: number;
  riskBudgetDollars?: number;
  riskPerTradePct?: number;
  maxDebitDollars?: number;
  minRoiAtT1Pct?: number;
  /** Explicit escape hatch for the dedicated index-0DTE engine only. */
  allowZeroDte?: boolean;
}

export interface ContractCandidate {
  tier: SelectionTier;
  symbol: string;
  optionSymbol: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string; // YYYY-MM-DD
  dte: number;

  bid: number;
  ask: number;
  mid: number;
  spreadPct: number;
  openInterest: number;
  volume: number;

  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;

  entryPremium: number; // === mid (live, tradeable)
  breakeven: number;
  projectedAtT1: number;
  projectedAtT2?: number;
  modelPremiumAtStop: number;
  roiAtT1Pct: number;
  roiAtT2Pct?: number;
  /** Managed risk = hard 50% premium stop (matches user exit rules). */
  riskRewardRatio: number;
  /** Does T1 clear the +30% first-trim trigger? */
  scaleReachable: boolean;
  /** Whether the underlying T1 reaches/passes the strike in the thesis direction. */
  targetCrossesStrike: boolean;
  /** Dollar risk for one contract at the managed premium stop. */
  riskPerContract: number;
  /** Maximum contracts allowed by both risk budget and debit ceiling. */
  maxContracts: number | null;
  /** False means this contract must not be recommended for this account. */
  fitsAccount: boolean;

  score: number; // 0-100, engine-native
  grade: EngineGrade;
  rationale: string;
  flags: string[];
}

export interface ContractSelection {
  symbol: string;
  direction: ThesisDirection;
  setup: SetupType;
  optionType: 'call' | 'put';
  spot: number;
  asOf: string;
  /** The expiry tier actually used to bound the DTE window. */
  expiryTier: ExpiryTier;
  dteWindow: { min: number; max: number };
  picks: ContractCandidate[]; // up to 3, one per tier
  recommendedTier: SelectionTier | null;
  status: 'ok' | 'unavailable' | 'no_candidates';
  note?: string;
}

// ─── Editable config (single source of truth) ─────────────────────
// DTE windows tuned to the user's backtested v15 (0-1DTE scalps) / v15B
// (2-3DTE swings) strategy. Edit here — every caller of the engine inherits it.

/**
 * Explicit expiry-tier DTE bands — the canonical mapping from horizon → expiry.
 * `ideal` biases scoring toward the sweet spot of the band; `label` is for UI.
 * Principle: the contract expires AT or AFTER your planned exit (small theta
 * buffer), never wildly beyond it. Edit here — every caller inherits it.
 */
// `fallbackMaxDte`: when no liquid contract exists inside [min,max], we may snap
// to the nearest liquid expiry — but ONLY up to this ceiling. Beyond it we return
// no contract (honest "no liquid <tier>") rather than mislabel a far-dated LEAP as
// e.g. WEEKLY. This is the guard against "1–2 week thesis → 171-DTE contract".
export const EXPIRY_TIERS: Record<
  ExpiryTier,
  { min: number; max: number; ideal: number; fallbackMaxDte: number; label: string }
> = {
  '0DTE':    { min: 0,   max: 1,   ideal: 0,   fallbackMaxDte: 3,    label: 'Same-day (0DTE)' },
  DAILY:     { min: 1,   max: 3,   ideal: 2,   fallbackMaxDte: 10,   label: 'Day-to-day (1–3 DTE)' },
  WEEKLY:    { min: 8,   max: 14,  ideal: 10,  fallbackMaxDte: 35,   label: 'Weekly (8–14 DTE)' },
  MONTHLY:   { min: 25,  max: 45,  ideal: 30,  fallbackMaxDte: 90,   label: 'Monthly (25–45 DTE)' },
  LEAP:      { min: 180, max: 730, ideal: 365, fallbackMaxDte: 1000, label: 'LEAP (6mo+)' },
};

/** Map a legacy SetupType to its default expiry tier (when none is given). */
/**
 * A swing thesis is a 1–5 DAY hold, and it was mapped to WEEKLY (5–12 DTE) — so the trade
 * and the contract expired at roughly the same time, leaving no room to be early. The desk
 * rule is the opposite: "if we have a signal that says August, you can always get
 * September. You buy a month out." Swing now defaults to MONTHLY.
 */
export const SETUP_TO_TIER: Record<SetupType, ExpiryTier> = {
  scalp: 'WEEKLY',      // was DAILY (1–3 DTE) — even a day trade shouldn't fight theta
  swing: 'MONTHLY',     // was WEEKLY — the change that matters
  lotto: 'WEEKLY',      // explicitly the gamble
  position: 'MONTHLY',
};

/** Resolve the effective DTE band for a thesis: explicit tier wins, else setup. */
export function resolveExpiryTier(thesis: PriceActionThesis): ExpiryTier {
  return thesis.expiryTier ?? SETUP_TO_TIER[thesis.setup];
}

/**
 * DTE windows — matched to how long the thesis actually needs, not to the cheapest premium.
 *
 * These used to put a SWING setup on 2–4 DTE, which contradicts the rule the desk repeats
 * more than any other: "time is your best friend… if we have a signal that says August, you
 * can always get September. You buy a month out." A swing thesis is a 1–5 DAY hold; on a
 * 3-DTE contract theta eats it and you have to be right immediately — that's a lotto with a
 * swing label on it.
 *
 * Each window now gives the thesis room to be right, with the ideal sitting comfortably
 * past the expected hold rather than on top of it.
 */
/**
 * SHORT-DATED GATE — near-expiry contracts are conviction-gated, not freely available.
 *
 * Under roughly a week, theta and gamma dominate: you have to be right about direction AND
 * timing, with no room to be early. That's an acceptable trade on a setup the engine is
 * genuinely confident in, and a bad one on anything marginal — which is most of the board.
 *
 * So the floor moves with conviction rather than being fixed: weak setups are pushed out to
 * expiries that let them be wrong for a few days and still work.
 */
export const SHORT_DTE_THRESHOLD = 8;
export const SHORT_DTE_MIN_CONVICTION = 75;

/**
 * Minimum DTE this thesis has earned. Low conviction buys time whether it wants to or not.
 *
 * FLOOR RAISED TO 8 — from measured outcomes on this book's own contract P&L:
 *
 *   DTE at signal   n(measured)   win rate   avg R
 *     0-7               96          42.7%    -0.021   ← loses money
 *     8-14             175          43.4%    +0.281   ← 13x better
 *
 * Note the win rate is FLAT across the two (42.7 vs 43.4). Extra time did not make
 * the engine righter — it stopped theta taking the trade before the thesis had a
 * chance to resolve. Same calls, different decay.
 *
 * The old floors let an elite read go to 1 DTE, which is the middle of the losing
 * cohort. Conviction does not defeat gamma: an 85-score idea at 2 DTE still needs
 * to be right immediately, and 96 measured trades say that is a negative-expectancy
 * bet. Conviction still buys a SHORTER expiry than a marginal read gets — the ladder
 * is intact — it just no longer buys one below the point where the data turns.
 */
export function minDteForConviction(conviction?: number | null): number {
  const c = conviction ?? 0;
  if (c >= 85) return 8;    // elite — the shortest the data supports, not the shortest possible
  if (c >= 75) return 8;    // high
  if (c >= 60) return 14;   // decent — at least two weeks
  return 21;                // marginal — a marginal read needs room to be wrong
}

export const DTE_WINDOWS: Record<SetupType, { min: number; max: number; ideal: number }> = {
  // intraday, but never same-day expiry — 0DTE is a gamma coin-flip, not a scalp
  scalp: { min: 8, max: 14, ideal: 10 },
  // 1–5 day hold → roughly a month out, so time decay isn't the counterparty
  swing: { min: 14, max: 45, ideal: 30 },
  // explicitly the gamble; short-dated is the point, so it stays short
  lotto: { min: 8, max: 14, ideal: 10 },
  // multi-week thesis needs a quarter
  position: { min: 30, max: 120, ideal: 60 },
};

/** |delta| bands per tier. Conservative = deep ITM (high delta, low theta burn);
 *  balanced = ATM; aggressive = OTM convexity. */
export const TIER_DELTA: Record<SelectionTier, { min: number; ideal: number; max: number }> = {
  /**
   * STARTER — the cheapest contract that still expresses the thesis.
   *
   * Added because the three tiers below are unbuyable on a small account. ORCL
   * priced 2026-08-31 at spot $149: conservative $2,153/contract, balanced
   * $1,115, aggressive $550. On a $1,000 account at 2% risk, even the
   * aggressive tier risks $275 — 13x the budget.
   *
   * The obvious workaround is worse than the problem. ORCL had contracts at
   * $61-$94, but they were $230-$370 strikes on a $149 stock: delta 0.03-0.06
   * with 21-59% spreads. A $240 call cannot reach a $182 target, so it does not
   * express the thesis at all — it is a lottery ticket that loses a third of
   * its value to the spread on entry.
   *
   * So the floor is delta, not price. 0.15 is the lowest delta that still
   * tracks the underlying meaningfully; below that the contract stops being a
   * proxy for the move. This tier finds the cheapest contract at or above that
   * floor, and if none exists it is simply omitted — an unaffordable setup
   * should read as "not for this account", never as a cheap substitute that
   * cannot win.
   */
  starter: { min: 0.15, ideal: 0.20, max: 0.30 },
  conservative: { min: 0.60, ideal: 0.68, max: 0.80 },
  balanced: { min: 0.42, ideal: 0.50, max: 0.58 },
  aggressive: { min: 0.22, ideal: 0.30, max: 0.40 },
};

export const LIQUIDITY = {
  /** (ask - bid) / mid must be <= this. */
  maxSpreadPct: 0.15,
  minOpenInterest: 100,
  minVolume: 0, // OI is the real gate; early-session volume is often 0
};

/** Assumed days-in-trade per setup (for theta decay on the projection). */
export const HOLD_DAYS: Record<SetupType, number> = {
  scalp: 0.5,
  swing: 2,
  lotto: 1,
  position: 7,
};

export const RISK_FREE_RATE = 0.045;
/** Hard premium stop the user manages to (sell at -50% of premium). */
export const PREMIUM_STOP_FRACTION = 0.5;
const MAX_EXPIRIES_TO_FETCH = 4;
const MIN_T_YEARS = 1 / (365 * 6); // ~4h floor so BS stays stable on 0DTE
const DEFAULT_IV = 0.4;

// ─── Black-Scholes (self-contained) ───────────────────────────────

function normCdf(x: number): number {
  // Hull / Abramowitz-Stegun 7.1.26
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    k * (0.319381530 +
      k * (-0.356563782 +
        k * (1.781477937 +
          k * (-1.821255978 +
            k * 1.330274429))));
  const cnd = 1 - 0.3989422804014327 * Math.exp(-0.5 * x * x) * poly;
  return x < 0 ? 1 - cnd : cnd;
}

function bsPrice(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  isCall: boolean,
): number {
  if (T <= 0) return Math.max(0, isCall ? S - K : K - S);
  const sig = sigma > 0 ? sigma : 0.0001;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sig * sig) / 2) * T) / (sig * sqrtT);
  const d2 = d1 - sig * sqrtT;
  if (isCall) {
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  }
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

// ─── Raw chain shape (structural subset of TradierOption) ─────────
// Declared locally so the pure core can be fed synthetic data in tests while
// the live TradierOption[] still passes via structural typing.

export interface RawChainOption {
  symbol: string;
  option_type: string; // "call" | "put"
  strike: number;
  expiration_date: string;
  bid: number;
  ask: number;
  volume?: number;
  open_interest?: number;
  greeks?: {
    delta: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    mid_iv?: number;
    smv_vol?: number;
  };
}

// ─── Internal normalized contract ─────────────────────────────────

interface NormOption {
  optionSymbol: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  dte: number;
  bid: number;
  ask: number;
  mid: number;
  spreadPct: number;
  openInterest: number;
  volume: number;
  delta: number; // signed (calls +, puts -)
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  ivEstimated: boolean;
}

function dteFrom(expiry: string): number {
  return Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000);
}

function occSymbol(symbol: string, expiry: string, type: 'call' | 'put', strike: number): string {
  const yymmdd = `${expiry.slice(2, 4)}${expiry.slice(5, 7)}${expiry.slice(8, 10)}`;
  const cp = type === 'call' ? 'C' : 'P';
  const strk = (strike * 1000).toFixed(0).padStart(8, '0');
  return `O:${symbol}${yymmdd}${cp}${strk}`;
}

// ─── Expiry window selection ───────────────────────────────────────

function pickExpiries(
  allExpirations: string[],
  win: { min: number; max: number; ideal: number },
): { expiries: string[]; fallback: boolean } {
  const dated = allExpirations
    .map((e) => ({ e, dte: dteFrom(e) }))
    .filter((x) => x.dte >= 0);

  const inWindow = dated.filter((x) => x.dte >= win.min && x.dte <= win.max);
  if (inWindow.length > 0) {
    inWindow.sort((a, b) => Math.abs(a.dte - win.ideal) - Math.abs(b.dte - win.ideal));
    return { expiries: inWindow.slice(0, MAX_EXPIRIES_TO_FETCH).map((x) => x.e), fallback: false };
  }

  // No expiry inside the window → take the nearest one at/above the window min,
  // else the closest overall. Flagged as a fallback so the caller knows.
  const atOrAboveMin = dated.filter((x) => x.dte >= win.min).sort((a, b) => a.dte - b.dte);
  if (atOrAboveMin.length > 0) return { expiries: [atOrAboveMin[0].e], fallback: true };
  if (dated.length > 0) {
    dated.sort((a, b) => Math.abs(a.dte - win.ideal) - Math.abs(b.dte - win.ideal));
    return { expiries: [dated[0].e], fallback: true };
  }
  return { expiries: [], fallback: true };
}

/**
 * Restrict an already-normalized contract pool to the tier's DTE window.
 *
 * This is the fix for the "1–2 week hold → 2027 LEAP" bug: selectFromChain
 * receives the WHOLE CBOE chain (every expiry), and pickScore only weighted DTE
 * at 20%, so a far-dated LEAP with a nice delta could out-score the correct
 * near-dated contract. We now hard-bound the candidate set to the window first.
 *
 * Fallback (mirrors pickExpiries): if nothing lands inside [min,max], snap to the
 * single nearest expiry at/above min (else the closest expiry overall) and keep
 * only that expiry's contracts — so we degrade to "closest available", never to
 * "anything on the board". `fallback=true` is surfaced as a flag/note.
 */
function filterPoolToWindow(
  pool: NormOption[],
  win: { min: number; max: number; ideal: number; fallbackMaxDte: number },
): { pool: NormOption[]; fallback: boolean } {
  const inWindow = pool.filter((o) => o.dte >= win.min && o.dte <= win.max);
  if (inWindow.length > 0) return { pool: inWindow, fallback: false };

  // Snap to the nearest single expiry, preferring at/above the window min.
  const expiries = Array.from(new Set(pool.map((o) => o.dte))).sort((a, b) => a - b);
  if (expiries.length === 0) return { pool: [], fallback: true };
  const atOrAbove = expiries.filter((d) => d >= win.min);
  const targetDte =
    atOrAbove.length > 0
      ? atOrAbove[0]
      : expiries.reduce((best, d) =>
          Math.abs(d - win.ideal) < Math.abs(best - win.ideal) ? d : best,
        );
  // Honesty guard: if the nearest liquid expiry is beyond the tier's fallback
  // ceiling, do NOT substitute a far-dated contract — return nothing so the
  // caller reports "no liquid <tier> contract" instead of mislabeling a LEAP.
  if (targetDte > win.fallbackMaxDte) return { pool: [], fallback: true };
  return { pool: pool.filter((o) => o.dte === targetDte), fallback: true };
}

// ─── Filtering + normalization ─────────────────────────────────────

function normalizeAndFilter(
  raw: RawChainOption[],
  optionType: 'call' | 'put',
): NormOption[] {
  const out: NormOption[] = [];
  for (const o of raw) {
    if (o.option_type !== optionType) continue;
    const bid = o.bid ?? 0;
    const ask = o.ask ?? 0;
    if (bid <= 0 || ask <= 0) continue;
    const mid = (bid + ask) / 2;
    if (mid <= 0) continue;
    const spreadPct = (ask - bid) / mid;
    if (spreadPct > LIQUIDITY.maxSpreadPct) continue;
    const oi = o.open_interest ?? 0;
    if (oi < LIQUIDITY.minOpenInterest) continue;
    const vol = o.volume ?? 0;
    if (vol < LIQUIDITY.minVolume) continue;

    const g = o.greeks;
    if (!g || typeof g.delta !== 'number') continue; // need greeks to select intelligently

    const ivRaw = g.mid_iv ?? g.smv_vol ?? 0;
    const ivEstimated = !(ivRaw > 0);
    const iv = ivEstimated ? DEFAULT_IV : ivRaw;

    out.push({
      optionSymbol: o.symbol,
      optionType,
      strike: o.strike,
      expiry: o.expiration_date,
      dte: Math.max(0, dteFrom(o.expiration_date)),
      bid,
      ask,
      mid,
      spreadPct,
      openInterest: oi,
      volume: vol,
      delta: g.delta,
      gamma: g.gamma ?? 0,
      theta: g.theta ?? 0,
      vega: g.vega ?? 0,
      iv,
      ivEstimated,
    });
  }
  return out;
}

// ─── Per-tier candidate selection ──────────────────────────────────

function pickScore(o: NormOption, tier: SelectionTier, idealDte: number): number {
  const band = TIER_DELTA[tier];
  const absDelta = Math.abs(o.delta);
  const deltaCloseness = 1 - Math.min(1, Math.abs(absDelta - band.ideal) / 0.5);
  const dteCloseness = 1 - Math.min(1, Math.abs(o.dte - idealDte) / Math.max(1, idealDte));
  const liq = 1 - Math.min(1, o.spreadPct / LIQUIDITY.maxSpreadPct);
  return deltaCloseness * 0.7 + dteCloseness * 0.2 + liq * 0.1;
}

function letterGrade(score: number): EngineGrade {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 68) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ─── Projection + scoring of one chosen contract ──────────────────

function buildCandidate(
  o: NormOption,
  tier: SelectionTier,
  thesis: PriceActionThesis,
  refSpot: number,
  shared: boolean,
  fallbackDte: boolean,
): ContractCandidate {
  const isCall = o.optionType === 'call';
  const r = RISK_FREE_RATE;
  const Tnow = Math.max(MIN_T_YEARS, o.dte / 365);
  const holdDays = Math.min(thesis.holdingDays ?? HOLD_DAYS[thesis.setup], o.dte);
  const Ttarget = Math.max(MIN_T_YEARS, (o.dte - holdDays) / 365);

  // Anchor to the live mid, model only the CHANGE via Black-Scholes. This keeps
  // the entry premium truthful (real tradeable price) while still projecting
  // moves + theta decay accurately for large swings.
  const bsNow = bsPrice(refSpot, o.strike, Tnow, r, o.iv, isCall);
  const proj = (targetSpot: number): number => {
    const bsAt = bsPrice(targetSpot, o.strike, Ttarget, r, o.iv, isCall);
    return Math.max(0, o.mid + (bsAt - bsNow));
  };

  const projectedAtT1 = proj(thesis.t1);
  const projectedAtT2 = thesis.t2 != null ? proj(thesis.t2) : undefined;
  const modelPremiumAtStop = proj(thesis.stop);

  const entryPremium = o.mid;
  const riskPremium = entryPremium * PREMIUM_STOP_FRACTION; // managed -50% stop
  const rewardT1 = projectedAtT1 - entryPremium;
  const riskRewardRatio = riskPremium > 0 ? rewardT1 / riskPremium : 0;
  const roiAtT1Pct = (projectedAtT1 / entryPremium - 1) * 100;
  const roiAtT2Pct = projectedAtT2 != null ? (projectedAtT2 / entryPremium - 1) * 100 : undefined;
  const scaleReachable = roiAtT1Pct >= 30;
  const breakeven = isCall ? o.strike + entryPremium : o.strike - entryPremium;
  const targetCrossesStrike = isCall ? thesis.t1 >= o.strike : thesis.t1 <= o.strike;

  // Account fit is computed in RISK units, not just contract debit. With the
  // platform's managed -50% premium stop, a $2,000 contract risks $1,000. The
  // debit ceiling remains independent because a trader may not want that much
  // cash tied up even when the stop risk technically fits.
  const riskBudget = thesis.riskBudgetDollars ?? (
    thesis.accountSize && thesis.riskPerTradePct
      ? thesis.accountSize * (thesis.riskPerTradePct / 100)
      : null
  );
  const debitPerContract = entryPremium * 100;
  const riskPerContract = debitPerContract * PREMIUM_STOP_FRACTION;
  const maxByRisk = riskBudget != null && riskBudget > 0
    ? Math.floor(riskBudget / Math.max(1, riskPerContract))
    : Number.POSITIVE_INFINITY;
  const maxByDebit = thesis.maxDebitDollars != null && thesis.maxDebitDollars > 0
    ? Math.floor(thesis.maxDebitDollars / Math.max(1, debitPerContract))
    : Number.POSITIVE_INFINITY;
  const constrained = Number.isFinite(maxByRisk) || Number.isFinite(maxByDebit);
  const maxContractsRaw = Math.min(maxByRisk, maxByDebit);
  const maxContracts = constrained ? Math.max(0, maxContractsRaw) : null;
  const fitsAccount = maxContracts == null || maxContracts >= 1;

  // ── Engine-native score ──
  const rrScore =
    riskRewardRatio >= 3 ? 100 :
    riskRewardRatio >= 2 ? 85 :
    riskRewardRatio >= 1.5 ? 70 :
    riskRewardRatio >= 1 ? 50 :
    riskRewardRatio >= 0.5 ? 30 : 15;
  /**
   * Liquidity: spread 55 / open interest 30 / volume 15.
   *
   * Two defects this replaces, both visible on a live GOOGL pick where the engine
   * graded a 2.1k-OI / 119-volume put ABOVE a 12k-OI / 1.3k-volume one:
   *
   *   1. OI credit was `min(1, oi/2000) * 40`, so 2,100 and 12,000 both scored a
   *      full 40. Six times the open interest bought nothing. The cap is now 10k,
   *      which actually separates a thin strike from a crowded one.
   *   2. Volume was never scored — only used as a filter, and that filter is 0.
   *      Open interest is yesterday's positioning; volume is whether anyone is
   *      trading it TODAY. A strike with big OI and no volume is a crowd that has
   *      already left, and it is exactly where a fill goes badly.
   *
   * Volume only scores when the field is present. LIQUIDITY.minVolume stays 0 on
   * purpose — early-session volume is legitimately zero and must not disqualify a
   * contract — so an absent/zero value is treated as "unknown", scoring the neutral
   * middle rather than a penalty. Punishing 9:31am for not having traded yet would
   * just push every morning pick toward stale strikes.
   */
  const oiScore = Math.min(1, o.openInterest / 10000) * 30;
  const volKnown = typeof o.volume === 'number' && o.volume > 0;
  const volScore = volKnown ? Math.min(1, (o.volume as number) / 1000) * 15 : 7.5;
  const liqScore =
    (1 - Math.min(1, o.spreadPct / LIQUIDITY.maxSpreadPct)) * 55 +
    oiScore +
    volScore;
  const band = TIER_DELTA[tier];
  const deltaFitScore = (1 - Math.min(1, Math.abs(Math.abs(o.delta) - band.ideal) / 0.5)) * 100;
  const reachScore = scaleReachable ? 100 : Math.max(0, roiAtT1Pct / 30) * 100;
  let score = rrScore * 0.4 + reachScore * 0.25 + liqScore * 0.2 + deltaFitScore * 0.15;
  if (shared) score -= 6;
  if (fallbackDte) score -= 8;
  if (o.ivEstimated) score -= 4;
  if (!targetCrossesStrike) score -= 12;
  if (!fitsAccount) score -= 30;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // ── Flags ──
  const flags: string[] = [];
  if (o.dte === 0) flags.push('0DTE');
  if (!scaleReachable) flags.push('below_30pct_scale');
  if (o.ivEstimated) flags.push('iv_estimated');
  if (shared) flags.push('shared_strike');
  if (fallbackDte) flags.push('dte_fallback');
  if (o.openInterest < 250) flags.push('thin_oi');
  if (!targetCrossesStrike) flags.push('strike_beyond_t1');
  if (!fitsAccount) flags.push('outside_account_risk');
  if (roiAtT1Pct < (thesis.minRoiAtT1Pct ?? 20)) flags.push('target_return_below_floor');

  // ── Direction-consistent rationale (GEX lesson: shorts must not read bullish) ──
  const verb = isCall ? 'rises' : 'falls';
  const cp = isCall ? 'C' : 'P';
  const rationale =
    `${tier} ${o.optionType}: $${o.strike}${cp} ${o.expiry} (${o.dte}DTE, Δ${o.delta.toFixed(2)}). ` +
    `Profits as ${thesis.symbol} ${verb} from $${refSpot.toFixed(2)} toward T1 $${thesis.t1.toFixed(2)} — ` +
    `~${roiAtT1Pct >= 0 ? '+' : ''}${roiAtT1Pct.toFixed(0)}% on premium ($${entryPremium.toFixed(2)}→$${projectedAtT1.toFixed(2)}), ` +
    `R:R ${riskRewardRatio.toFixed(1)}:1 vs the -50% premium stop ($${riskPremium.toFixed(2)}).`;

  return {
    tier,
    symbol: thesis.symbol,
    optionSymbol: o.optionSymbol || occSymbol(thesis.symbol, o.expiry, o.optionType, o.strike),
    optionType: o.optionType,
    strike: o.strike,
    expiry: o.expiry,
    dte: o.dte,
    bid: o.bid,
    ask: o.ask,
    mid: o.mid,
    spreadPct: o.spreadPct,
    openInterest: o.openInterest,
    volume: o.volume,
    delta: o.delta,
    gamma: o.gamma,
    theta: o.theta,
    vega: o.vega,
    iv: o.iv,
    entryPremium,
    breakeven,
    projectedAtT1,
    projectedAtT2,
    modelPremiumAtStop,
    roiAtT1Pct,
    roiAtT2Pct,
    riskRewardRatio,
    scaleReachable,
    targetCrossesStrike,
    riskPerContract,
    maxContracts,
    fitsAccount,
    score,
    grade: letterGrade(score),
    rationale,
    flags,
  };
}

function recommendTier(thesis: PriceActionThesis): SelectionTier {
  const base: Record<SetupType, SelectionTier> = {
    scalp: 'balanced',
    swing: 'balanced',
    lotto: 'aggressive',
    position: 'conservative',
  };
  let tier = base[thesis.setup];
  const conv = thesis.conviction;
  if (conv != null) {
    if (conv >= 80 && tier === 'conservative') tier = 'balanced';
    else if (conv >= 85 && tier === 'balanced') tier = 'aggressive';
    else if (conv < 50 && tier === 'aggressive') tier = 'balanced';
    else if (conv < 40 && tier === 'balanced') tier = 'conservative';
  }
  return tier;
}

// ─── Pure core (no I/O — testable) ─────────────────────────────────
// Given a thesis, a live spot, and the raw option rows, build the 3-tier
// selection. Separated from network I/O so it can be exercised directly.

export function selectFromChain(
  thesis: PriceActionThesis,
  spot: number,
  rawOptions: RawChainOption[],
  meta?: { fallbackDte?: boolean; expiriesNote?: string },
): ContractSelection {
  const optionType: 'call' | 'put' = thesis.direction === 'bullish' ? 'call' : 'put';
  const expiryTier = resolveExpiryTier(thesis);
  const tierWin = EXPIRY_TIERS[expiryTier];

  // Short-dated is conviction-gated. Under ~a week you must be right on direction AND
  // timing with no room to be early — fine on a setup the engine is genuinely confident
  // in, bad on a marginal one, and most of the board is marginal. So the floor rises as
  // conviction falls: a weak read is pushed out to an expiry that lets it be wrong for a
  // few days and still work.
  const dteFloor = thesis.allowZeroDte && expiryTier === '0DTE'
    ? 0
    : minDteForConviction(thesis.conviction);
  const gated = dteFloor > tierWin.min;
  const win = gated
    ? {
        ...tierWin,
        min: dteFloor,
        max: Math.max(tierWin.max, dteFloor + 14),
        ideal: Math.max(tierWin.ideal, dteFloor + 5),
      }
    : tierWin;
  const base = {
    symbol: thesis.symbol,
    direction: thesis.direction,
    setup: thesis.setup,
    optionType,
    spot,
    asOf: new Date().toISOString(),
    expiryTier,
    dteWindow: { min: win.min, max: win.max },
    dteGateNote: gated
      ? `Conviction ${Math.round(thesis.conviction ?? 0)} — short-dated withheld, minimum ${dteFloor} DTE`
      : undefined,
  };

  const fullPool = normalizeAndFilter(rawOptions, optionType);
  if (fullPool.length === 0) {
    return {
      ...base,
      picks: [],
      recommendedTier: null,
      status: 'no_candidates',
      note: `No liquid ${optionType}s for ${thesis.symbol} (spread/OI gates).`,
    };
  }

  // Hard-bound the candidate set to the tier's DTE window BEFORE scoring, so the
  // chosen expiry always matches the horizon (no LEAP for a weekly thesis).
  const { pool, fallback: windowFallback } = filterPoolToWindow(fullPool, win);
  const fallbackDte = (meta?.fallbackDte ?? false) || windowFallback;
  if (pool.length === 0) {
    return {
      ...base,
      picks: [],
      recommendedTier: null,
      status: 'no_candidates',
      note: `No liquid ${optionType}s for ${thesis.symbol} in the ${win.label} window (${win.min}-${win.max}DTE).`,
    };
  }

  // One DISTINCT contract per tier (greedy). When the in-window chain is thin and
  // a tier has no distinct strike left, we SKIP that tier rather than emit an
  // identical duplicate row — showing the same contract under two tiers is
  // misleading. Result: collapse to as many tiers as there are real choices.
  const tiers: SelectionTier[] = ['conservative', 'balanced', 'aggressive', 'starter'];
  const used = new Set<string>();
  const picks: ContractCandidate[] = [];
  for (const tier of tiers) {
    const ranked = [...pool].sort(
      (a, b) => pickScore(b, tier, win.ideal) - pickScore(a, tier, win.ideal),
    );
    const distinct = ranked.find((o) => !used.has(o.optionSymbol));
    if (!distinct) continue; // no distinct contract for this tier → omit it
    used.add(distinct.optionSymbol);
    picks.push(buildCandidate(distinct, tier, thesis, spot, false, fallbackDte));
  }

  const fallbackNote = windowFallback
    ? `No expiry inside the ${win.label} window (${win.min}-${win.max}DTE) for ${thesis.symbol} — used nearest available (${picks[0]?.dte ?? '?'}DTE).`
    : undefined;

  // Recommended tier must actually be present in the emitted picks. Thin chains
  // can drop a tier, so fall back to the best-scoring contract we did emit.
  const eligible = picks.filter((p) =>
    p.fitsAccount &&
    p.targetCrossesStrike &&
    p.roiAtT1Pct >= (thesis.minRoiAtT1Pct ?? 20) &&
    p.riskRewardRatio >= 1
  );
  const preferredTier = recommendTier(thesis);
  const recommendedTier = eligible.some((p) => p.tier === preferredTier)
    ? preferredTier
    : (eligible.length > 0
        ? [...eligible].sort((a, b) => b.score - a.score)[0].tier
        : null);

  return {
    ...base,
    picks,
    recommendedTier,
    status: 'ok',
    note: recommendedTier == null && picks.length > 0
      ? 'No contract clears thesis reachability, projected return, R:R, and account-risk gates.'
      : (meta?.expiriesNote ?? fallbackNote),
  };
}

// ─── Main entry point (I/O) ────────────────────────────────────────

export async function selectContracts(
  thesis: PriceActionThesis,
  apiKey?: string,
): Promise<ContractSelection> {
  const optionType: 'call' | 'put' = thesis.direction === 'bullish' ? 'call' : 'put';
  const expiryTier = resolveExpiryTier(thesis);
  const win = EXPIRY_TIERS[expiryTier];
  const unavailable = (note: string, spot = 0): ContractSelection => ({
    symbol: thesis.symbol,
    direction: thesis.direction,
    setup: thesis.setup,
    optionType,
    spot,
    asOf: new Date().toISOString(),
    expiryTier,
    dteWindow: { min: win.min, max: win.max },
    picks: [],
    recommendedTier: null,
    status: 'unavailable',
    note,
  });

  // 1. PRIMARY SOURCE — CBOE delayed chain (free, no key, no Tradier dependency).
  //    One fetch returns the live spot + the WHOLE chain (greeks + IV), which the
  //    pure core bounds to the thesis DTE window. We only fall through to Tradier
  //    if CBOE is unavailable. This is what keeps the engine working when the
  //    Tradier token is unapproved/expired.
  try {
    const { fetchCboeChain } = await import("./contract-analyzer/cboe-chain");
    const cboe = await fetchCboeChain(thesis.symbol);
    if (cboe && cboe.rawChain.length > 0) {
      const spot = thesis.asOfSpot ?? cboe.spot;
      if (spot > 0) {
        const sel = selectFromChain(thesis, spot, cboe.rawChain, {
          expiriesNote: undefined,
        });
        // Stamp the chain's real fetch time, not "now" — a cached chain must
        // not read as fresh (audit 2026-09-24).
        if (cboe.fetchedAt) (sel as any).asOf = new Date(cboe.fetchedAt).toISOString();
        return sel;
      }
    }
  } catch (e) {
    logger.warn(`[OPTION-ENGINE] CBOE primary failed for ${thesis.symbol}, falling back to Yahoo: ${(e as Error).message}`);
  }

  // 1.5 SECONDARY SOURCE — Yahoo options chain (free, crumb-auth). Reached when
  //     CBOE is rate-limited (429) or returns nothing. Greeks are Black-Scholes
  //     approximations (good enough for selection); keeps the engine alive when
  //     both CBOE and Tradier are unavailable.
  try {
    const { getYahooExpirations, getYahooEngineChain } = await import("./yahoo-options-fallback");
    const yExps = await getYahooExpirations(thesis.symbol);
    if (yExps.length > 0) {
      const { expiries: yPicked, fallback: yFallbackDte } = pickExpiries(yExps, win);
      if (yPicked.length > 0) {
        const { spot: ySpot, chain: yChain } = await getYahooEngineChain(thesis.symbol, yPicked);
        const spot = thesis.asOfSpot ?? ySpot;
        if (spot > 0 && yChain.length > 0) {
          logger.info(`[OPTION-ENGINE] Using Yahoo options fallback for ${thesis.symbol} (${yChain.length} contracts)`);
          return selectFromChain(thesis, spot, yChain, {
            fallbackDte: yFallbackDte,
            expiriesNote: yFallbackDte
              ? `No expiry inside the ${win.min}-${win.max}DTE window — used nearest available (${yPicked[0]}).`
              : undefined,
          });
        }
      }
    }
  } catch (e) {
    logger.warn(`[OPTION-ENGINE] Yahoo options fallback failed for ${thesis.symbol}, falling back to Tradier: ${(e as Error).message}`);
  }

  // 2. FALLBACK — Tradier (only reached if CBOE and Yahoo returned nothing).
  // 2a. Spot — never fabricate. If unavailable, say so.
  let spot = thesis.asOfSpot;
  if (spot == null) {
    const quote = await getTradierQuote(thesis.symbol, apiKey);
    spot = quote?.last ?? quote?.close ?? undefined;
  }
  if (spot == null || !(spot > 0)) {
    return unavailable(
      `Live quote unavailable for ${thesis.symbol} — no contract selected (no fabricated prices).`,
    );
  }

  // 2b. Expiries inside the thesis DTE window.
  const allExpirations = await getTradierOptionExpirations(thesis.symbol, apiKey);
  if (allExpirations.length === 0) {
    return unavailable(`No option expirations returned for ${thesis.symbol} (chain unavailable).`, spot);
  }
  const { expiries, fallback: fallbackDte } = pickExpiries(allExpirations, win);
  if (expiries.length === 0) {
    return unavailable(`No expirations near the ${win.min}-${win.max}DTE window for ${thesis.symbol}.`, spot);
  }

  // 2c. Fetch + merge in-window chains (staggered to respect rate limits).
  const chainArrays = await Promise.all(
    expiries.map(async (exp, i) => {
      await new Promise((res) => setTimeout(res, i * 100));
      return getTradierOptionsChain(thesis.symbol, exp, apiKey);
    }),
  );

  // 2d. Delegate to the pure core.
  return selectFromChain(thesis, spot, chainArrays.flat(), {
    fallbackDte,
    expiriesNote: fallbackDte
      ? `No expiry inside the ${win.min}-${win.max}DTE window — used nearest available (${expiries[0]}).`
      : undefined,
  });
}
