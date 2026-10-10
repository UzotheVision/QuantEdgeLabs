/**
 * Unified Options Exposures Calculator
 * =====================================
 * Computes GEX + VEX + DEX + CHARM aggregates from any options source.
 *
 * Handles the "no gaps" problem:
 *   - Computes vanna locally (Tradier doesn't return it)
 *   - Computes charm locally (neither source returns it)
 *   - Falls back to Black-Scholes when greeks missing
 *   - Handles missing IV via ATM proxy
 *   - Aggregates across multiple expirations
 *   - Weights near-term expirations higher (they dominate dealer hedging)
 *
 * Formulas:
 *   GEX(strike) = OI × Gamma × 100 × S² × sign_convention / 1e9
 *   VEX(strike) = OI × Vanna × 100 × S  / 1e6      (per 1% vol move, in $M)
 *   DEX(strike) = OI × Delta × 100 × S              / 1e9
 *   Charm(strike) = OI × dDelta/dt  × 100 × S       / 1e9
 *
 * Sign convention: dealers are assumed short calls (positive GEX), long puts (negative GEX).
 */

import { logger } from './logger';

/**
 * Gamma concentration cut-offs, on net/gross in [-1, 1].
 *
 * Provisional pending a full trading-day sample — set deliberately WIDE so the
 * layer starts scoring the clearly one-sided books first rather than every
 * symbol at once. Each computed snapshot logs its concentration so the cut can
 * be tightened against real spread instead of guessed twice.
 */
const CONC_CUT = 0.25;
const CONC_NEUTRAL = 0.08;

// ─── Types ──────────────────────────────────────────────────

export interface OptionInput {
  strike: number;
  optionType: 'call' | 'put';
  openInterest: number;
  volume: number;
  impliedVolatility: number;        // decimal, e.g. 0.25 for 25%
  daysToExpiry: number;
  greeks?: {
    delta?: number;
    gamma?: number;
    vega?: number;
    theta?: number;
    vanna?: number;
    charm?: number;
  };
}

export interface StrikeExposure {
  strike: number;
  // Aggregates (all in $ billions, normalized)
  netGEX: number;
  callGEX: number;
  putGEX: number;
  netVEX: number;
  callVEX: number;
  putVEX: number;
  netDEX: number;
  netCharm: number;
  // Raw gamma/vanna values (unweighted) for diagnostics
  callGamma: number;
  putGamma: number;
  callVanna: number;
  putVanna: number;
  // Open interest breakdown
  callOI: number;
  putOI: number;
  callVolume: number;
  putVolume: number;
  // Data quality
  dtes: number[];       // Expirations contributing to this strike
}

export interface ExposureSnapshot {
  symbol: string;
  spotPrice: number;
  calculatedAt: number;

  // Totals (billions)
  totalGEX: number;
  totalVEX: number;
  totalDEX: number;
  totalCharm: number;
  callGEX: number;
  putGEX: number;
  putCallGEXRatio: number;

  // Regime
  regime: 'positive_gamma' | 'negative_gamma' | 'neutral' | 'transitioning';
  /**
   * Net GEX as a share of the symbol's OWN gross gamma, in [-1, 1].
   *
   * The absolute regime thresholds (±$0.5B) are index-scale. Measured on live
   * CBOE chains: AAPL — a multi-trillion-dollar company — produces net GEX of
   * +0.26B, and DIA +0.44B, so both land in "transitioning" and the conviction
   * engine's GEX layer skips them. Every single name fails the same way, which
   * is why that layer scored 0 of 92 published ideas.
   *
   * net/gross is dimensionless and self-scaling: +1 means every strike's gamma
   * points the same way, 0 means dealers are balanced. It compares SPY and a
   * small cap on the same footing without needing market cap or history.
   */
  gammaConcentration: number;
  vexRegime: 'vol_tailwind' | 'vol_headwind' | 'vol_neutral';

  // Key structural levels
  gammaFlipPrice: number | null;
  vannaFlipPrice: number | null;
  maxGammaStrike: number;
  maxVannaStrike: number;
  callWall: number | null;
  putWall: number | null;
  zeroGammaProjection: number | null;

  // Strike detail (top-N by |GEX|)
  strikes: StrikeExposure[];

  // Strike × Expiration matrix (for Skylit-style heatmap)
  strikeExpiryMatrix: StrikeExpiryCell[];

  // Diagnostics
  expirationsUsed: string[];
  strikesScanned: number;
  strikesWithOI: number;
  vannaComputed: number;    // How many vanna values were computed vs provided
}

export interface StrikeExpiryCell {
  strike: number;
  expiryLabel: string;  // e.g. "APR 14"
  dte: number;
  netGEX: number;       // in billions
  netVEX: number;       // in millions
}

// ─── Black-Scholes helpers ──────────────────────────────────

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

const RISK_FREE = 0.045; // 4.5% — approx 3-month T-bill, adjust later if needed

interface ComputedGreeks {
  delta: number;
  gamma: number;
  vega: number;
  vanna: number;
  charm: number;
}

function computeAllGreeks(
  spot: number,
  strike: number,
  tte: number,    // years
  iv: number,
  isCall: boolean,
): ComputedGreeks {
  if (tte <= 0 || iv <= 0 || spot <= 0 || strike <= 0) {
    return {
      delta: isCall ? (spot > strike ? 1 : 0) : (spot < strike ? -1 : 0),
      gamma: 0, vega: 0, vanna: 0, charm: 0,
    };
  }

  const sqrtT = Math.sqrt(tte);
  const d1 = (Math.log(spot / strike) + (RISK_FREE + 0.5 * iv * iv) * tte) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  const nd1 = normalPDF(d1);

  const delta = isCall ? normalCDF(d1) : normalCDF(d1) - 1;
  const gamma = nd1 / (spot * iv * sqrtT);
  const vega = spot * nd1 * sqrtT / 100; // per 1% IV

  // Vanna = d(delta)/d(sigma) = -d2/sigma · phi(d1)
  //       = phi(d1) · (1 - d1/sigma·sqrtT)
  // Most common form: vanna = -exp(-q*T) · phi(d1) · d2 / sigma
  const vanna = -nd1 * d2 / iv;

  // Charm (delta decay) = d(delta)/d(t)
  // For call: -phi(d1) · [2rT - d2·sigma·sqrtT] / (2·T·sigma·sqrtT)
  // Simplified (no dividend):
  const charm = -nd1 * (2 * RISK_FREE * tte - d2 * iv * sqrtT) / (2 * tte * iv * sqrtT);

  return {
    delta,
    gamma,
    vega,
    vanna,
    charm: isCall ? charm : -charm,
  };
}

// ─── Main Aggregator ────────────────────────────────────────

export function computeExposures(
  symbol: string,
  spotPrice: number,
  options: OptionInput[],
  expirationsUsed: string[] = [],
): ExposureSnapshot {
  if (spotPrice <= 0) {
    throw new Error(`Invalid spot price for ${symbol}: ${spotPrice}`);
  }

  const strikeMap = new Map<number, StrikeExposure>();
  const expiryMap = new Map<string, StrikeExpiryCell>(); // key: "strike|dte"
  let vannaComputedCount = 0;
  const S2 = spotPrice * spotPrice;
  const MULT = 100;

  // Near-term weighting: 0-7 DTE = 1.0, 7-21 = 0.7, 21-45 = 0.45, 45+ = 0.2
  function dteWeight(dte: number): number {
    if (dte <= 7) return 1.0;
    if (dte <= 21) return 0.7;
    if (dte <= 45) return 0.45;
    return 0.2;
  }

  for (const opt of options) {
    const oi = opt.openInterest || 0;
    const vol = opt.volume || 0;
    if (oi === 0 && vol === 0) continue;

    // Filter to meaningful strikes (within 40% of spot). Widened from 25% so
    // far-OTM strikes (the cheap lottery wings) are available to scroll/expand
    // in the matrix — the frontend already decides what to show vs collapse.
    if (opt.strike < spotPrice * 0.6 || opt.strike > spotPrice * 1.4) continue;

    const isCall = opt.optionType === 'call';
    const iv = opt.impliedVolatility > 0 ? opt.impliedVolatility : 0.30; // fallback IV
    const tte = Math.max(0.001, opt.daysToExpiry / 365.25);

    // Use provided greeks if valid, else compute
    let gamma = opt.greeks?.gamma;
    let vanna = opt.greeks?.vanna;
    let delta = opt.greeks?.delta;
    let charm = opt.greeks?.charm;

    const needsCompute = !Number.isFinite(gamma) || gamma === 0 ||
                         !Number.isFinite(vanna) ||
                         !Number.isFinite(delta) || delta === 0 ||
                         !Number.isFinite(charm);

    if (needsCompute) {
      const bs = computeAllGreeks(spotPrice, opt.strike, tte, iv, isCall);
      if (!Number.isFinite(gamma!) || gamma === 0) gamma = bs.gamma;
      if (!Number.isFinite(vanna!)) { vanna = bs.vanna; vannaComputedCount++; }
      if (!Number.isFinite(delta!) || delta === 0) delta = bs.delta;
      if (!Number.isFinite(charm!)) charm = bs.charm;
    }

    // OI-weighted effective quantity (use volume as proxy when OI is 0 — common after hours)
    const effectiveOI = oi > 0 ? oi : Math.max(0, vol);
    const weight = dteWeight(opt.daysToExpiry);

    // GEX: call = +, put = − (dealer convention)
    // Formula: OI × Gamma × 100 × 0.01 × S² / 1e9  (per 1% move, in $B)
    // The 100 (contract multiplier) × 0.01 (1% factor) cancel to 1.
    const callGexContribution = isCall
      ? effectiveOI * gamma! * S2 * weight / 1e9
      : 0;
    const putGexContribution = !isCall
      ? -effectiveOI * gamma! * S2 * weight / 1e9
      : 0;

    // VEX: vanna · OI · contract × spot (normalized to millions)
    // Sign convention: positive vanna → price up when IV up
    // For calls: dealer short → dealer's vanna negative contribution
    // For puts: dealer long → dealer's vanna positive contribution
    // Note: VEX uses /1e6 (not /1e9 like GEX) because vanna×S produces values
    // ~250x smaller than gamma×S² — using /1e9 makes most VEX values sub-threshold.
    //
    // KNOWN INCONSISTENCY (audited 2026-08-26): GEX above assumes dealers are
    // LONG calls / SHORT puts (calls +, puts −); this VEX sign assumes the
    // OPPOSITE dealer book (calls −, puts +). Each is a defensible convention
    // alone, but together the two surfaces tell contradictory dealer stories.
    // Every vexSignal label and insight string downstream is calibrated to
    // THIS sign, so flipping it here without re-deriving all of those would
    // silently invert their meaning — do that as one deliberate pass, not a
    // drive-by. Until then: treat net VEX as a put-minus-call vanna tilt.
    const vexContribution = (isCall ? -1 : 1) * effectiveOI * vanna! * MULT * spotPrice * weight / 1e6;

    // DEX (delta exposure)
    const dexContribution = (isCall ? -1 : 1) * effectiveOI * delta! * MULT * spotPrice * weight / 1e9;

    // Charm (per day delta decay)
    const charmContribution = (isCall ? -1 : 1) * effectiveOI * charm! * MULT * spotPrice * weight / 1e9;

    if (!strikeMap.has(opt.strike)) {
      strikeMap.set(opt.strike, {
        strike: opt.strike,
        netGEX: 0, callGEX: 0, putGEX: 0,
        netVEX: 0, callVEX: 0, putVEX: 0,
        netDEX: 0, netCharm: 0,
        callGamma: 0, putGamma: 0, callVanna: 0, putVanna: 0,
        callOI: 0, putOI: 0, callVolume: 0, putVolume: 0,
        dtes: [],
      });
    }
    const entry = strikeMap.get(opt.strike)!;

    if (isCall) {
      entry.callGEX += callGexContribution;
      entry.callVEX += vexContribution;
      entry.callGamma = Math.max(entry.callGamma, gamma!);
      entry.callVanna = Math.max(Math.abs(entry.callVanna), Math.abs(vanna!));
      entry.callOI += oi;
      entry.callVolume += vol;
    } else {
      entry.putGEX += putGexContribution;
      entry.putVEX += vexContribution;
      entry.putGamma = Math.max(entry.putGamma, gamma!);
      entry.putVanna = Math.max(Math.abs(entry.putVanna), Math.abs(vanna!));
      entry.putOI += oi;
      entry.putVolume += vol;
    }

    entry.netDEX += dexContribution;
    entry.netCharm += charmContribution;
    if (!entry.dtes.includes(opt.daysToExpiry)) {
      entry.dtes.push(opt.daysToExpiry);
    }

    // Per-expiry matrix accumulation
    const dteBucket = Math.round(opt.daysToExpiry);
    const expiryKey = `${opt.strike}|${dteBucket}`;
    const gexContrib = callGexContribution + putGexContribution;
    if (!expiryMap.has(expiryKey)) {
      const expiryDate = new Date(Date.now() + dteBucket * 86400000);
      const expiryLabel = expiryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
      expiryMap.set(expiryKey, { strike: opt.strike, expiryLabel, dte: dteBucket, netGEX: 0, netVEX: 0 });
    }
    const expiryCell = expiryMap.get(expiryKey)!;
    expiryCell.netGEX += gexContrib;
    expiryCell.netVEX += vexContribution;
  }

  // Compute net exposures
  for (const entry of Array.from(strikeMap.values())) {
    entry.netGEX = entry.callGEX + entry.putGEX;
    entry.netVEX = entry.callVEX + entry.putVEX;
  }

  const strikes = Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);

  if (strikes.length === 0) {
    return {
      symbol, spotPrice, calculatedAt: Date.now(),
      totalGEX: 0, totalVEX: 0, totalDEX: 0, totalCharm: 0, gammaConcentration: 0,
      callGEX: 0, putGEX: 0, putCallGEXRatio: 0,
      regime: 'neutral', vexRegime: 'vol_neutral',
      gammaFlipPrice: null, vannaFlipPrice: null,
      maxGammaStrike: spotPrice, maxVannaStrike: spotPrice,
      callWall: null, putWall: null, zeroGammaProjection: null,
      strikes: [],
      strikeExpiryMatrix: [],
      expirationsUsed, strikesScanned: 0, strikesWithOI: 0, vannaComputed: 0,
    };
  }

  // Aggregate totals
  const totalGEX = strikes.reduce((sum, s) => sum + s.netGEX, 0);
  const totalVEX = strikes.reduce((sum, s) => sum + s.netVEX, 0);
  const totalDEX = strikes.reduce((sum, s) => sum + s.netDEX, 0);
  const totalCharm = strikes.reduce((sum, s) => sum + s.netCharm, 0);
  const callGEX = strikes.reduce((sum, s) => sum + Math.max(0, s.callGEX), 0);
  const putGEX = Math.abs(strikes.reduce((sum, s) => sum + Math.min(0, s.putGEX), 0));

  /**
   * Gamma flip — the crossing NEAREST SPOT, not the first one found.
   *
   * The old loop walked strikes ascending and `break`-ed on the first sign
   * change of cumulative gamma. Strikes start ~15% below spot where netGEX is
   * order 1e-9 — pure noise — so the very first jitter down there won. Measured
   * on SPY 2026-08-31 (spot 766.28): it reported a flip of 656, the second
   * strike in the book, while the real crossing sat at 753. A flip 14% below
   * spot is not a level anyone can trade, and it made the regime read
   * nonsensically against it.
   *
   * Collect every crossing, then take the one closest to spot. Far-OTM noise
   * still produces crossings; it just no longer outranks the real one.
   */
  let gammaFlipPrice: number | null = null;
  {
    const crossings: number[] = [];
    let cumGamma = 0;
    let prevSign = 0;
    for (const s of strikes) {
      cumGamma += s.netGEX;
      const sign = Math.sign(cumGamma);
      if (prevSign !== 0 && sign !== 0 && sign !== prevSign) crossings.push(s.strike);
      if (sign !== 0) prevSign = sign;
    }
    if (crossings.length > 0) {
      gammaFlipPrice = crossings.reduce((best, k) =>
        Math.abs(k - spotPrice) < Math.abs(best - spotPrice) ? k : best, crossings[0]);
    }
  }

  // Vanna flip (where cumulative VEX crosses zero)
  let vannaFlipPrice: number | null = null;
  let cumVex = 0;
  let prevVexSign = 0;
  for (const s of strikes) {
    cumVex += s.netVEX;
    const sign = Math.sign(cumVex);
    if (prevVexSign !== 0 && sign !== prevVexSign) {
      vannaFlipPrice = s.strike;
      break;
    }
    prevVexSign = sign;
  }

  // Max gamma/vanna strike
  let maxGammaStrike = strikes[0].strike;
  let maxGamma = 0;
  let maxVannaStrike = strikes[0].strike;
  let maxVanna = 0;
  for (const s of strikes) {
    if (Math.abs(s.netGEX) > maxGamma) {
      maxGamma = Math.abs(s.netGEX);
      maxGammaStrike = s.strike;
    }
    if (Math.abs(s.netVEX) > maxVanna) {
      maxVanna = Math.abs(s.netVEX);
      maxVannaStrike = s.strike;
    }
  }

  /**
   * Walls — measured on the RELEVANT LEG, not on net gamma.
   *
   * A call wall is where dealers are short calls: as price rises into it they
   * must sell to stay hedged, so it acts as resistance. That is a property of
   * CALL gamma alone. The old code filtered on `netGEX > 0`, which subtracts
   * put gamma at the same strike — so the strike carrying the most calls is
   * excluded outright whenever puts happen to dominate it.
   *
   * SPY 2026-08-31 (spot 766.28) is the clean example. Strike 766 held the
   * largest call gamma in the book (+0.955) but netted −1.512 because its put
   * gamma was −2.467, so the `netGEX > 0` filter threw it away and the function
   * returned 780 — a strike with negligible call gamma. The reported wall was
   * not where the calls were.
   *
   * The put wall had the mirror problem: filtering on the most-negative netGEX
   * lands on whatever strike puts dominate most, which is almost always the
   * money. It returned 766 against a spot of 766.28 — 0.04% away. "Support is
   * exactly here" is not a level, it is a restatement of the spot price.
   *
   * Walls are also required to stand clear of spot. A wall inside the noise
   * band around the money tells you nothing you cannot see on the tape.
   */
  /**
   * Walls are ranked by OPEN INTEREST, not by gamma.
   *
   * Gamma is a bell curve centred on spot: dGamma/dStrike peaks at the money and
   * decays either side. So "the strike above spot with the most gamma" is
   * arithmetically forced to be the FIRST strike above spot, whatever the book
   * looks like. It is not a level — it is the spot price with extra steps, and
   * it moves every time price ticks.
   *
   * Open interest is not spot-centred. It accumulates at round numbers and at
   * strikes people actually sold, and it stays there while price travels toward
   * it. That is what makes a wall readable.
   *
   * Measured 2026-08-31, gamma-ranked vs OI-ranked call wall:
   *
   *   SPY    767  (+0.09%, 2,826 OI)   vs   785  (+2.44%, 37,955 OI)
   *   QQQ    716  (+0.12%, 2,994 OI)   vs   745  (+4.18%, 21,629 OI)
   *   TSLA 367.5  (+0.11%, 1,731 OI)   vs   400  (+8.96%, 12,507 OI)
   *
   * The OI walls carry 10-15x the open interest and sit far enough away to
   * trade against. The gamma walls all sit within 0.12% of spot.
   *
   * maxGammaStrike is kept separately above — that one IS the gamma peak, and
   * it is the right number for a pin, just not for a wall.
   */
  const callWall = strikes
    .filter((s) => s.strike > spotPrice && s.callOI > 0)
    .sort((a, b) => b.callOI - a.callOI)[0]?.strike ?? null;

  const putWall = strikes
    .filter((s) => s.strike < spotPrice && s.putOI > 0)
    .sort((a, b) => b.putOI - a.putOI)[0]?.strike ?? null;

  // Zero-gamma projection
  // In positive gamma regime → price magnetizes to max gamma
  // In negative gamma regime → breaks toward flip
  const zeroGammaProjection = totalGEX > 0 ? maxGammaStrike : gammaFlipPrice;

  // How one-sided is dealer gamma, relative to this symbol's own book?
  const grossGEX = strikes.reduce((sum, s) => sum + Math.abs(s.netGEX), 0);
  const gammaConcentration = grossGEX > 0 ? totalGEX / grossGEX : 0;

  // Regimes — absolute OR relative.
  //
  // The absolute bar is kept so index readings do not move: SPY at −4.42B stays
  // negative_gamma exactly as before. The relative bar is what lets a single
  // name qualify at all, since none of them reach ±$0.5B.
  //
  // CONC_CUT is set from measurement, not taste — see the logged distribution.
  const regime: ExposureSnapshot['regime'] =
    (totalGEX > 0.5 || gammaConcentration > CONC_CUT) ? 'positive_gamma'
    : (totalGEX < -0.5 || gammaConcentration < -CONC_CUT) ? 'negative_gamma'
    : Math.abs(gammaConcentration) < CONC_NEUTRAL ? 'neutral'
    : 'transitioning';

  // VEX regime: positive VEX = vol tailwind (higher vol = higher price via vanna)
  // VEX is in $M (not $B like GEX), so thresholds are 1000× the old values
  const vexRegime: ExposureSnapshot['vexRegime'] =
    totalVEX > 150 ? 'vol_tailwind'
    : totalVEX < -150 ? 'vol_headwind'
    : 'vol_neutral';

  const strikesWithOI = strikes.filter((s) => s.callOI + s.putOI > 0).length;

  logger.info(
    `[EXPOSURES] ${symbol}: ${strikes.length} strikes, ` +
    `GEX=${totalGEX.toFixed(2)}B VEX=${totalVEX.toFixed(1)}M DEX=${totalDEX.toFixed(2)}B ` +
    `flip=$${gammaFlipPrice || '—'} vflip=$${vannaFlipPrice || '—'} ` +
    `maxγ=$${maxGammaStrike} maxV=$${maxVannaStrike} ` +
    `conc=${gammaConcentration.toFixed(3)} regime=${regime}/${vexRegime} vannaComputed=${vannaComputedCount}`,
  );

  return {
    symbol, spotPrice, calculatedAt: Date.now(),
    totalGEX, totalVEX, totalDEX, totalCharm, gammaConcentration,
    callGEX, putGEX,
    putCallGEXRatio: callGEX > 0 ? putGEX / callGEX : 0,
    regime, vexRegime,
    gammaFlipPrice, vannaFlipPrice,
    maxGammaStrike, maxVannaStrike,
    callWall, putWall, zeroGammaProjection,
    strikes,
    // Include all strikes with any OI — let the frontend decide visibility.
    // Previous filter (netGEX > 0.0001) excluded far-OTM strikes, making
    // "ALL STRIKES" show the same data as collapsed view.
    strikeExpiryMatrix: Array.from(expiryMap.values())
      .sort((a, b) => b.strike - a.strike || a.dte - b.dte),
    expirationsUsed,
    strikesScanned: strikes.length,
    strikesWithOI,
    vannaComputed: vannaComputedCount,
  };
}

// ─── Adapter from Tradier/Yahoo option shape ───────────────

export function optionToInput(opt: any, expDateStr?: string): OptionInput | null {
  if (!opt || !opt.strike) return null;
  const optionType = (opt.option_type || opt.type || '').toLowerCase() as 'call' | 'put';
  if (optionType !== 'call' && optionType !== 'put') return null;

  const exp = expDateStr || opt.expiration_date || opt.expiration || '';
  let dte = 0;
  if (exp) {
    const expTime = new Date(exp + (exp.length <= 10 ? 'T16:00:00' : '')).getTime();
    dte = Math.max(0, (expTime - Date.now()) / 86400000);
  }

  // Prefer mid_iv, then smv_vol, then ask_iv, then bid_iv
  const g = opt.greeks || {};
  const iv = g.mid_iv || g.smv_vol || g.ask_iv || g.bid_iv || opt.impliedVolatility || 0.30;

  return {
    strike: opt.strike,
    optionType,
    openInterest: opt.open_interest || 0,
    volume: opt.volume || 0,
    impliedVolatility: iv,
    daysToExpiry: dte,
    greeks: {
      delta: g.delta,
      gamma: g.gamma,
      vega: g.vega,
      theta: g.theta,
      vanna: g.vanna, // Tradier doesn't return this, will trigger compute
      charm: g.charm, // Tradier doesn't return this, will trigger compute
    },
  };
}
