/**
 * Premium-Spectrum Scanner — one ticker, the WHOLE option chain, every price tier.
 *
 * THE IDEA:
 *   Given a ticker (and a directional bias), pull the entire listed chain across
 *   ALL expiries — from this-week weeklies to 2027/2028/2029 LEAPS — and bucket
 *   every tradeable contract by what it COSTS:
 *
 *     lotto   < $0.50    cent lottery tickets — huge leverage, usually expire worthless
 *     cheap   $0.50–2    small-account swings — cheap but real delta
 *     low     $2–10      the bread-and-butter directional bet
 *     mid     $10–30     higher-conviction / longer-dated positions
 *     high    $30–100    LEAP-ish or high-priced underlyings
 *     deep    $100–2000  deep-ITM stock-replacement LEAPS
 *
 *   Within each tier we rank by RISK-ADJUSTED leverage: how much underlying
 *   exposure you control per premium dollar, discounted for how far the stock has
 *   to move to break even, how fast theta bleeds it, and how liquid/tight it is.
 *
 * WHAT THIS IS NOT:
 *   - Not advice. It surfaces tradeable contracts across the price spectrum so the
 *     user can pick the risk profile that fits their account. Each row carries a
 *     plain-English thesis describing the TYPE of play, not a buy signal.
 *   - Not real-time. CBOE is ~15min delayed; Yahoo fallback similar. Near-close read.
 *
 * Greeks/ROI use the canonical Black-Scholes pricer in options-quant.ts.
 */
import { fetchCboeChain } from './contract-analyzer/cboe-chain';
import type { RawChainOption } from './option-selection-engine';
import { blackScholes } from './options-quant';
import { getYahooExpirations, getYahooEngineChain } from './yahoo-options-fallback';
import { getRealtimeQuote } from './realtime-pricing-service';
import { logger } from './logger';

const RISK_FREE_RATE = 0.045;

export type PremiumTier = 'lotto' | 'cheap' | 'low' | 'mid' | 'high' | 'deep';

const TIER_BOUNDS: Record<PremiumTier, { min: number; max: number; label: string; blurb: string }> = {
  lotto: { min: 0.01, max: 0.5,   label: 'Lotto',          blurb: 'Cent lottery tickets — max leverage, usually expire worthless' },
  cheap: { min: 0.5,  max: 2,     label: 'Cheap',          blurb: 'Small-account swings — cheap but real delta' },
  low:   { min: 2,    max: 10,    label: 'Low',            blurb: 'Bread-and-butter directional bet' },
  mid:   { min: 10,   max: 30,    label: 'Mid',            blurb: 'Higher conviction / longer-dated' },
  high:  { min: 30,   max: 100,   label: 'High',           blurb: 'LEAP-ish or high-priced underlying' },
  deep:  { min: 100,  max: 2000,  label: 'Deep-ITM LEAP',  blurb: 'Deep-ITM stock-replacement LEAP' },
};

const TIER_ORDER: PremiumTier[] = ['lotto', 'cheap', 'low', 'mid', 'high', 'deep'];

export interface SpectrumContract {
  symbol: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string; // YYYY-MM-DD
  dte: number;
  tier: PremiumTier;
  mid: number;
  bid: number;
  ask: number;
  premiumDollars: number; // mid * 100 (what one contract costs)
  spreadPct: number;
  iv: number; // decimal
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  openInterest: number;
  volume: number;
  spot: number;
  moneyness: number; // strike / spot
  intrinsic: number;
  extrinsic: number; // mid - intrinsic (time premium at risk)
  extrinsicPct: number; // extrinsic / mid
  breakeven: number;
  breakevenMovePct: number; // how far underlying must move to break even at expiry
  leverage: number; // |delta| * spot / mid — $ exposure per $ premium
  thetaDecayPctPerDay: number; // |theta| / mid
  pop: number; // probability underlying finishes past breakeven by expiry (0-1)
  roi10: number; // % return if underlying moves +10% in your direction (10 trading days out)
  roi20: number; // ...+20%
  roi30: number; // ...+30%
  score: number; // 0-100 risk-adjusted
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  thesis: string;
}

export interface SpectrumResult {
  symbol: string;
  spot: number;
  side: 'call' | 'put';
  asOf: string;
  source: 'cboe' | 'yahoo' | 'none';
  scannedContracts: number;
  expiries: string[];
  tiers: { tier: PremiumTier; label: string; blurb: string; contracts: SpectrumContract[] }[];
  best: SpectrumContract[]; // top picks across all tiers
  notes: string[];
}

export interface SpectrumOpts {
  side?: 'call' | 'put';
  perTier?: number; // contracts to return per tier (default 5)
  minOi?: number; // liquidity floor (default 5 — keep lottos but drop totally dead strikes)
  maxDtePref?: number; // for ROI horizon modelling only
}

function normIv(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 0;
  return raw > 3 ? raw / 100 : raw;
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/**
 * Probability the underlying finishes past breakeven by expiry under a lognormal
 * model — a realistic profit-odds gauge so cent-lottos don't grade like ITM LEAPS.
 */
function probOfProfit(
  spot: number, breakeven: number, iv: number, dteDays: number, type: 'call' | 'put',
): number {
  const T = Math.max(dteDays, 0.5) / 365;
  const sig = iv * Math.sqrt(T);
  if (sig <= 0 || spot <= 0 || breakeven <= 0) return 0;
  const d2 = (Math.log(spot / breakeven) + (RISK_FREE_RATE - 0.5 * iv * iv) * T) / sig;
  return type === 'call' ? normCdf(d2) : normCdf(-d2);
}

function dteFrom(expiry: string, now: Date): number {
  const exp = new Date(`${expiry}T20:00:00Z`);
  return Math.max(0, Math.round((exp.getTime() - now.getTime()) / 86_400_000));
}

function tierFor(premium: number): PremiumTier | null {
  for (const t of TIER_ORDER) {
    const b = TIER_BOUNDS[t];
    if (premium >= b.min && premium < b.max) return t;
  }
  return premium >= 2000 ? 'deep' : null;
}

function gradeFor(score: number): SpectrumContract['grade'] {
  if (score >= 80) return 'S';
  if (score >= 66) return 'A';
  if (score >= 50) return 'B';
  if (score >= 34) return 'C';
  return 'D';
}

/** Fetch the full chain across all expiries. CBOE primary, Yahoo fallback. */
async function fetchFullChain(
  symbol: string,
): Promise<{ spot: number; chain: RawChainOption[]; source: 'cboe' | 'yahoo' | 'none' }> {
  // 1) CBOE — one request returns the entire chain (all expiries).
  try {
    const cboe = await fetchCboeChain(symbol);
    if (cboe && cboe.rawChain.length > 0 && cboe.spot > 0) {
      return { spot: cboe.spot, chain: cboe.rawChain, source: 'cboe' };
    }
  } catch (e) {
    logger.debug(`[SPECTRUM] CBOE chain failed for ${symbol}: ${(e as Error).message}`);
  }

  // 2) Yahoo — pull every listed expiry (incl. far-dated LEAPS) and stitch.
  try {
    const exps = await getYahooExpirations(symbol);
    if (exps.length > 0) {
      const { spot, chain } = await getYahooEngineChain(symbol, exps);
      if (spot > 0 && chain.length > 0) {
        return { spot, chain: chain as unknown as RawChainOption[], source: 'yahoo' };
      }
    }
  } catch (e) {
    logger.debug(`[SPECTRUM] Yahoo chain failed for ${symbol}: ${(e as Error).message}`);
  }

  return { spot: 0, chain: [], source: 'none' };
}

/** Re-price a contract after an underlying move of `movePct` (signed for side). */
function roiAfterMove(
  c: { spot: number; strike: number; iv: number; dte: number; optionType: 'call' | 'put'; mid: number },
  movePct: number,
  horizonDays: number,
): number {
  const dir = c.optionType === 'call' ? 1 : -1;
  const newSpot = c.spot * (1 + dir * movePct);
  const remainingDte = Math.max(c.dte - horizonDays, 0.5);
  const T = remainingDte / 365;
  const priced = blackScholes({
    spotPrice: newSpot,
    strikePrice: c.strike,
    timeToExpiry: T,
    riskFreeRate: RISK_FREE_RATE,
    volatility: c.iv,
    optionType: c.optionType,
  }).theoreticalPrice;
  if (!isFinite(priced) || c.mid <= 0) return 0;
  return (priced - c.mid) / c.mid;
}

function buildThesis(c: SpectrumContract): string {
  const exp = c.expiry;
  const leap = c.dte >= 300;
  const moneyLabel =
    c.optionType === 'call'
      ? c.moneyness < 0.97 ? 'ITM' : c.moneyness > 1.03 ? 'OTM' : 'ATM'
      : c.moneyness > 1.03 ? 'ITM' : c.moneyness < 0.97 ? 'OTM' : 'ATM';

  switch (c.tier) {
    case 'lotto':
      return `Lottery ${moneyLabel} ${c.optionType} — ${c.leverage.toFixed(0)}x leverage for $${c.premiumDollars.toFixed(0)}/contract, but only ~${(c.pop * 100).toFixed(0)}% odds of profit. ` +
        `Needs a ${(Math.abs(c.breakevenMovePct) * 100).toFixed(0)}% move to break even by ${exp}; theta bleeds ${(c.thetaDecayPctPerDay * 100).toFixed(0)}%/day. Size tiny — most expire worthless.`;
    case 'cheap':
      return `Cheap ${moneyLabel} ${c.optionType} at $${c.premiumDollars.toFixed(0)}/contract — ${c.leverage.toFixed(0)}x exposure, ~${(c.pop * 100).toFixed(0)}% odds of profit. ` +
        `Break-even ${(Math.abs(c.breakevenMovePct) * 100).toFixed(0)}% away. ${c.extrinsicPct > 0.7 ? 'Mostly time premium — direction must hit fast.' : 'Some intrinsic cushion.'}`;
    case 'low':
    case 'mid':
      return `${moneyLabel} ${c.optionType}, ${c.dte}DTE — ${c.leverage.toFixed(1)}x leverage, ${(c.extrinsicPct * 100).toFixed(0)}% extrinsic, ~${(c.pop * 100).toFixed(0)}% odds of profit. ` +
        `+20% underlying → ~${(c.roi20 * 100).toFixed(0)}% on the contract.${leap ? ' Long-dated — survives chop.' : ''}`;
    case 'high':
    case 'deep':
      return `Deep-ITM ${c.optionType} stock-replacement (${exp}) — ${(c.delta * 100).toFixed(0)}Δ, only ${(c.extrinsicPct * 100).toFixed(0)}% time premium at risk, ~${(c.pop * 100).toFixed(0)}% odds of profit. ` +
        `Acts like ${(c.delta * 100).toFixed(0)} shares for $${c.premiumDollars.toFixed(0)} vs $${(c.spot * 100).toFixed(0)} in stock. +20% → ~${(c.roi20 * 100).toFixed(0)}%.`;
  }
}

/**
 * Score a contract on RISK-ADJUSTED merit within its own tier. The components are
 * scaled so the headline number is comparable across tiers (a great lotto and a
 * great deep-ITM LEAP can both grade well, each on its own terms).
 */
function scoreContract(c: Omit<SpectrumContract, 'score' | 'grade' | 'thesis'>): number {
  // Probability of profit — the realism anchor. A 5%-POP lotto cannot grade like a
  // 55%-POP ITM contract no matter how juicy its hypothetical ROI is.
  const popScore = Math.min(Math.max(c.pop, 0) / 0.6, 1) * 34; // up to 34 pts (caps at 60% POP)

  // Payoff if a normal-ish (+20%) move lands — the upside you're paying for, but
  // capped so fantasy lotto ROIs don't dominate the probability anchor.
  const payoffScore = Math.min(Math.max(c.roi20, 0) / 2, 1) * 24; // up to 24 pts (caps at +200%)

  // Liquidity: OI + day volume.
  const liq = c.openInterest + c.volume * 2;
  const liqScore = Math.min(liq / 2000, 1) * 18; // up to 18 pts

  // Spread tightness.
  const spreadScore = Math.max(0, 1 - c.spreadPct / 0.25) * 12; // up to 12 pts

  // Theta safety: less daily bleed (relative to premium) = better.
  const thetaScore = Math.max(0, 1 - c.thetaDecayPctPerDay / 0.1) * 12; // up to 12 pts

  return Math.round(popScore + payoffScore + liqScore + spreadScore + thetaScore);
}

export async function scanPremiumSpectrum(symbol: string, opts: SpectrumOpts = {}): Promise<SpectrumResult> {
  const sym = symbol.toUpperCase().trim();
  const side = opts.side ?? 'call';
  const perTier = opts.perTier ?? 5;
  const minOi = opts.minOi ?? 5;
  const now = new Date();
  const notes: string[] = [];

  const { spot: chainSpot, chain, source } = await fetchFullChain(sym);

  // Prefer a live unified quote for spot when available (chain spot can be stale).
  let spot = chainSpot;
  try {
    const q = await getRealtimeQuote(sym, 'stock');
    if (q?.price && q.price > 0) spot = q.price;
  } catch { /* keep chain spot */ }

  if (chain.length === 0 || spot <= 0) {
    notes.push(`No option chain available for ${sym} right now (CBOE rate-limited and Yahoo returned nothing). Try again shortly.`);
    return {
      symbol: sym, spot: spot || 0, side, asOf: now.toISOString(), source,
      scannedContracts: 0, expiries: [], tiers: [], best: [], notes,
    };
  }

  const expirySet = new Set<string>();
  const scored: SpectrumContract[] = [];

  for (const o of chain) {
    const type = o.option_type === 'call' || o.option_type === 'put' ? o.option_type : null;
    if (!type || type !== side) continue;
    if (o.strike <= 0) continue;

    const bid = Number(o.bid ?? 0);
    const ask = Number(o.ask ?? 0);
    const mid = (bid + ask) / 2;
    if (mid <= 0 || ask <= 0) continue;

    const tier = tierFor(mid);
    if (!tier) continue;

    const oi = Math.round(Number(o.open_interest ?? 0));
    const vol = Math.round(Number(o.volume ?? 0));
    if (oi < minOi && vol <= 0) continue; // skip totally dead strikes

    const dte = dteFrom(o.expiration_date, now);
    if (dte < 1) continue;

    let iv = normIv(Number(o.greeks?.mid_iv ?? o.greeks?.smv_vol ?? 0));
    if (iv <= 0) iv = 0.5; // last-resort so BS doesn't divide by zero; flagged via extrinsic

    const delta = Number(o.greeks?.delta ?? 0);
    const gamma = Number(o.greeks?.gamma ?? 0);
    const theta = Number(o.greeks?.theta ?? 0);
    const vega = Number(o.greeks?.vega ?? 0);

    const spreadPct = mid > 0 ? (ask - bid) / mid : 1;
    const moneyness = o.strike / spot;
    const intrinsic = type === 'call' ? Math.max(spot - o.strike, 0) : Math.max(o.strike - spot, 0);
    const extrinsic = Math.max(mid - intrinsic, 0);
    const extrinsicPct = mid > 0 ? extrinsic / mid : 1;
    const breakeven = type === 'call' ? o.strike + mid : o.strike - mid;
    const breakevenMovePct = (breakeven - spot) / spot;
    const leverage = mid > 0 ? Math.abs(delta) * spot / mid : 0;
    const thetaDecayPctPerDay = mid > 0 ? Math.abs(theta) / mid : 0;
    const pop = probOfProfit(spot, breakeven, iv, dte, type);

    const horizon = Math.min(opts.maxDtePref ?? 10, Math.max(dte - 1, 1));
    const base = { spot, strike: o.strike, iv, dte, optionType: type, mid };
    const roi10 = roiAfterMove(base, 0.10, horizon);
    const roi20 = roiAfterMove(base, 0.20, horizon);
    const roi30 = roiAfterMove(base, 0.30, horizon);

    expirySet.add(o.expiration_date);

    const partial: Omit<SpectrumContract, 'score' | 'grade' | 'thesis'> = {
      symbol: sym, optionType: type, strike: o.strike, expiry: o.expiration_date, dte, tier,
      mid: Number(mid.toFixed(2)), bid: Number(bid.toFixed(2)), ask: Number(ask.toFixed(2)),
      premiumDollars: Number((mid * 100).toFixed(0)),
      spreadPct: Number(spreadPct.toFixed(3)),
      iv: Number(iv.toFixed(4)),
      delta: Number(delta.toFixed(3)), gamma: Number(gamma.toFixed(4)),
      theta: Number(theta.toFixed(3)), vega: Number(vega.toFixed(3)),
      openInterest: oi, volume: vol, spot: Number(spot.toFixed(2)),
      moneyness: Number(moneyness.toFixed(3)),
      intrinsic: Number(intrinsic.toFixed(2)),
      extrinsic: Number(extrinsic.toFixed(2)),
      extrinsicPct: Number(extrinsicPct.toFixed(3)),
      breakeven: Number(breakeven.toFixed(2)),
      breakevenMovePct: Number(breakevenMovePct.toFixed(4)),
      leverage: Number(leverage.toFixed(2)),
      thetaDecayPctPerDay: Number(thetaDecayPctPerDay.toFixed(4)),
      pop: Number(pop.toFixed(3)),
      roi10: Number(roi10.toFixed(3)), roi20: Number(roi20.toFixed(3)), roi30: Number(roi30.toFixed(3)),
    };
    const score = scoreContract(partial);
    const full: SpectrumContract = { ...partial, score, grade: gradeFor(score), thesis: '' };
    full.thesis = buildThesis(full);
    scored.push(full);
  }

  // Group by tier, rank within tier by score, keep top N.
  const tiers = TIER_ORDER.map((t) => {
    const inTier = scored
      .filter((c) => c.tier === t)
      .sort((a, b) => b.score - a.score || b.leverage - a.leverage)
      .slice(0, perTier);
    return { tier: t, label: TIER_BOUNDS[t].label, blurb: TIER_BOUNDS[t].blurb, contracts: inTier };
  }).filter((g) => g.contracts.length > 0);

  // "Best" = highest-scoring across the whole spectrum, deduped to one per tier-ish spread.
  const best = [...scored].sort((a, b) => b.score - a.score).slice(0, 8);

  if (source === 'cboe') notes.push('CBOE chain (~15min delayed) — near-close read, not a live print.');
  if (source === 'yahoo') notes.push('Yahoo fallback chain (CBOE was rate-limited) — greeks Black-Scholes modeled.');
  notes.push('Leverage = $ underlying exposure per premium $. Break-even move = how far the stock must travel by expiry. Not advice.');

  return {
    symbol: sym, spot: Number(spot.toFixed(2)), side, asOf: now.toISOString(), source,
    scannedContracts: scored.length,
    expiries: Array.from(expirySet).sort(),
    tiers, best, notes,
  };
}
