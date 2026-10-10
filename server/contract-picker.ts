/**
 * ADAPTIVE CONTRACT PICKER — the contract engine made interactive.
 *
 * Operator ask (2026-09-23): pick per DTE and account size, and have the
 * engine warn instead of silently choosing. This module turns one delayed
 * CBOE chain fetch into ranked candidates for a chosen DTE window and
 * budget, each carrying explicit warnings a trader can act on:
 * spread cost, theta burn at this DTE, position size vs account, thin OI.
 *
 * Data honesty: the chain is CBOE DELAYED quotes (the Tradier key is dead —
 * 401 since Aug 26; renewing it upgrades this to live). Every response says
 * so. Greeks are the chain's own, never invented; a contract without greeks
 * shows what it lacks instead of a fabricated theta.
 */
import { fetchCboeChain } from './contract-analyzer/cboe-chain';
import { logger } from './logger';

export interface PickerCandidate {
  label: string;            // "CALL $370 · 09/30 · 7 DTE"
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  dte: number;
  bid: number;
  ask: number;
  mid: number;
  spreadPct: number | null;   // (ask-bid)/mid
  delta: number | null;
  thetaPerDayPct: number | null; // |theta| / mid — % of premium burned per day
  iv: number | null;
  openInterest: number;
  volume: number;
  costPerContract: number;    // mid * 100
  pctOfBudget: number | null;
  roiAtT1: number | null;     // delta-approx % on premium if the stock reaches T1
  contractsAffordable: number | null; // floor(maxCost-or-budget / cost)
  warnings: string[];
  score: number;
}

export interface PickerResult {
  symbol: string;
  spot: number;
  dataSource: 'cboe_delayed';
  note: string;
  candidates: PickerCandidate[];
}

const dteOf = (expiry: string): number =>
  Math.max(0, Math.round((new Date(expiry + 'T21:00:00Z').getTime() - Date.now()) / 86_400_000));

export async function pickContracts(
  symbol: string,
  opts: { direction?: 'long' | 'short'; dteMin?: number; dteMax?: number; budget?: number; maxCost?: number; target?: number },
): Promise<PickerResult | null> {
  const direction = opts.direction ?? 'long';
  const dteMin = Math.max(0, opts.dteMin ?? 5);
  const dteMax = Math.max(dteMin, opts.dteMax ?? 21);
  const budget = opts.budget && opts.budget > 0 ? opts.budget : null;
  const maxCost = opts.maxCost && opts.maxCost > 0 ? opts.maxCost : null;
  const target = opts.target && opts.target > 0 ? opts.target : null;

  const chain = await fetchCboeChain(symbol);
  if (!chain || !chain.rawChain.length || !(chain.spot > 0)) {
    logger.warn(`[PICKER] no chain for ${symbol}`);
    return null;
  }
  const wantType = direction === 'long' ? 'call' : 'put';

  const candidates: PickerCandidate[] = [];
  for (const o of chain.rawChain) {
    if (String(o.option_type).toLowerCase() !== wantType) continue;
    const dte = dteOf(o.expiration_date);
    if (dte < dteMin || dte > dteMax) continue;
    const bid = Number(o.bid) || 0;
    const ask = Number(o.ask) || 0;
    if (!(ask > 0)) continue;
    const mid = bid > 0 ? (bid + ask) / 2 : ask;
    if (mid < 0.05) continue;
    // Moneyness window: near-the-money is where directional trades live.
    const money = o.strike / chain.spot;
    const otmReach = maxCost != null ? 0.25 : 0.15;
    if (wantType === 'call' && (money < 0.9 || money > 1 + otmReach)) continue;
    if (wantType === 'put' && (money > 1.1 || money < 1 - otmReach)) continue;
    // Under a spend cap, a strike that can't plausibly reach T1 is a lottery ticket.
    if (maxCost != null && target != null && wantType === 'call' && o.strike > target * 1.03) continue;
    if (maxCost != null && target != null && wantType === 'put' && o.strike < target * 0.97) continue;

    const delta = o.greeks?.delta != null ? Math.abs(Number(o.greeks.delta)) : null;
    const theta = o.greeks?.theta != null ? Math.abs(Number(o.greeks.theta)) : null;
    const iv = o.greeks?.mid_iv != null ? Number(o.greeks.mid_iv) : null;
    const oi = Number(o.open_interest) || 0;
    const vol = Number(o.volume) || 0;
    const spreadPct = mid > 0 && bid > 0 ? (ask - bid) / mid : null;
    const thetaPerDayPct = theta != null && mid > 0 ? theta / mid : null;
    const cost = mid * 100;
    // Per-contract spend cap: 'I can afford $100-600' means never show $1,770.
    if (maxCost != null && cost > maxCost) continue;
    const pctOfBudget = budget ? cost / budget : null;
    const roiAtT1 = target != null && delta != null
      ? (delta * (wantType === 'call' ? target - chain.spot : chain.spot - target)) / mid
      : null;
    const cap = maxCost ?? budget;
    const contractsAffordable = cap != null ? Math.floor(cap / cost) : null;

    const warnings: string[] = [];
    if (spreadPct == null) warnings.push('no bid — spread unknowable, exit may be ugly');
    else if (spreadPct > 0.10) warnings.push(`spread ${(spreadPct * 100).toFixed(0)}% of premium — you pay it entering AND exiting`);
    if (oi < 100) warnings.push(`OI ${oi} — thin interest, harder fills`);
    if (vol === 0) warnings.push('zero volume this session');
    if (thetaPerDayPct != null && thetaPerDayPct > 0.04) warnings.push(`theta burns ${(thetaPerDayPct * 100).toFixed(1)}%/day of the premium at ${dte} DTE`);
    if (pctOfBudget != null && pctOfBudget > 0.15) warnings.push(`one contract = ${(pctOfBudget * 100).toFixed(0)}% of the account — sizing risk`);
    if (pctOfBudget != null && pctOfBudget > 1) warnings.push('one contract exceeds the whole budget');
    if (delta == null) warnings.push('greeks unavailable on the delayed chain for this strike');

    // Score: liquidity + delta sweet spot (~0.40) + spread + budget fit.
    let score = 50;
    score += Math.min(15, Math.log10(Math.max(1, oi)) * 5);
    if (delta != null) score += 15 - Math.min(15, Math.abs(delta - 0.4) * 60);
    if (spreadPct != null) score += 10 - Math.min(10, spreadPct * 100);
    if (pctOfBudget != null) score += pctOfBudget <= 0.10 ? 10 : pctOfBudget <= 0.25 ? 5 : 0;
    if (roiAtT1 != null) score += Math.max(0, Math.min(12, roiAtT1 * 10));
    score -= warnings.length * 3;

    candidates.push({
      label: `${wantType.toUpperCase()} $${o.strike} · ${o.expiration_date.slice(5).replace('-', '/')} · ${dte} DTE`,
      optionType: wantType as 'call' | 'put',
      strike: o.strike,
      expiry: o.expiration_date,
      dte, bid, ask,
      mid: Number(mid.toFixed(2)),
      spreadPct, delta,
      thetaPerDayPct, iv,
      openInterest: oi, volume: vol,
      costPerContract: Number(cost.toFixed(0)),
      pctOfBudget,
      roiAtT1: roiAtT1 != null ? Number(roiAtT1.toFixed(2)) : null,
      contractsAffordable,
      warnings,
      score: Math.round(score),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    symbol: symbol.toUpperCase(),
    spot: chain.spot,
    dataSource: 'cboe_delayed',
    note: 'CBOE delayed chain — renew the Tradier key at tradier.com for live quotes/greeks',
    candidates: candidates.slice(0, 8),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLISHED-CONTRACT LIVE REPRICE
//
// Operator 2026-09-24: a published idea froze its contract's delta, IV and
// "ROI at T1" at publish time (e.g. $380C Δ0.51 IV-at-8:51pm) and the card
// kept presenting them as current. This re-reads THAT exact contract from
// the chain now and recomputes everything that decays or drifts: greeks,
// the market's expected move to expiry, whether the target sits inside it,
// premium drift since publish, and the stop/target scenarios. Every output
// carries an as-of stamp and the data source.
// ─────────────────────────────────────────────────────────────────────────

export function normCdf(x: number): number {
  // Abramowitz-Stegun 26.2.17, |err| < 7.5e-8
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export interface LiveContractRead {
  asOf: string;
  dataSource: 'cboe_delayed';
  found: boolean;
  label: string;
  spot: number;
  dte: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  delta: number | null;
  gamma: number | null;
  thetaPerDayPct: number | null;
  iv: number | null;
  expectedMove: number | null;       // 1σ $ move to expiry implied by IV
  targetMove: number | null;         // $ from spot to T1 (signed toward the trade)
  targetSigma: number | null;        // targetMove / expectedMove
  probFinishBeyondT1: number | null; // risk-neutral, driftless approximation
  probTouchT1: number | null;        // ≈ 2 × finish probability (reflection)
  roiIfT1Today: number | null;       // Δ·dS + ½Γ·dS² over mid
  valueAtStopToday: number | null;
  premiumChangeSincePublish: number | null; // vs published entry premium
  breakevenAtExpiry: number | null;
  flags: string[];
}

export async function repricePublishedContract(
  symbol: string,
  opts: { optionType: 'call' | 'put'; strike: number; expiry: string; target?: number; stop?: number; entryPremium?: number },
): Promise<LiveContractRead | null> {
  const chain = await fetchCboeChain(symbol);
  if (!chain || !(chain.spot > 0)) return null;
  const exp = String(opts.expiry).slice(0, 10);
  const row = chain.rawChain.find((o) =>
    String(o.option_type).toLowerCase() === opts.optionType &&
    Math.abs(o.strike - opts.strike) < 0.001 &&
    String(o.expiration_date).slice(0, 10) === exp);
  const dte = dteOf(exp);
  const base: LiveContractRead = {
    asOf: new Date().toISOString(), dataSource: 'cboe_delayed', found: !!row,
    label: `${opts.optionType.toUpperCase()} $${opts.strike} · ${exp.slice(5).replace('-', '/')} · ${dte} DTE`,
    spot: chain.spot, dte,
    bid: null, ask: null, mid: null, delta: null, gamma: null, thetaPerDayPct: null, iv: null,
    expectedMove: null, targetMove: null, targetSigma: null, probFinishBeyondT1: null, probTouchT1: null,
    roiIfT1Today: null, valueAtStopToday: null, premiumChangeSincePublish: null, breakevenAtExpiry: null,
    flags: [],
  };
  if (!row) {
    base.flags.push(dte <= 0 ? 'contract has expired' : 'contract not found on the current chain');
    return base;
  }
  const bid = Number(row.bid) || 0;
  const ask = Number(row.ask) || 0;
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : ask || null;
  const sgn = opts.optionType === 'call' ? 1 : -1;
  const delta = row.greeks?.delta != null ? Number(row.greeks.delta) : null;
  const gamma = row.greeks?.gamma != null ? Number(row.greeks.gamma) : null;
  const theta = row.greeks?.theta != null ? Math.abs(Number(row.greeks.theta)) : null;
  const iv = row.greeks?.mid_iv != null && Number(row.greeks.mid_iv) > 0 ? Number(row.greeks.mid_iv) : null;
  const t = Math.max(dte, 0.5) / 365;

  const expectedMove = iv != null ? chain.spot * iv * Math.sqrt(t) : null;
  const targetMove = opts.target ? sgn * (opts.target - chain.spot) : null;
  const targetSigma = expectedMove && targetMove != null ? targetMove / expectedMove : null;
  const probFinish = targetSigma != null ? 1 - normCdf(targetSigma) : null;
  const probTouch = probFinish != null ? Math.min(1, 2 * probFinish) : null;

  const priceAt = (s: number): number | null => {
    if (mid == null || delta == null) return null;
    const dS = s - chain.spot;
    return Math.max(0, mid + delta * dS + 0.5 * (gamma ?? 0) * dS * dS);
  };
  const atT1 = opts.target ? priceAt(opts.target) : null;
  const atStop = opts.stop ? priceAt(opts.stop) : null;

  Object.assign(base, {
    bid: bid || null, ask: ask || null, mid: mid != null ? Number(mid.toFixed(2)) : null,
    delta, gamma, iv,
    thetaPerDayPct: theta != null && mid ? theta / mid : null,
    expectedMove: expectedMove != null ? Number(expectedMove.toFixed(2)) : null,
    targetMove: targetMove != null ? Number(targetMove.toFixed(2)) : null,
    targetSigma: targetSigma != null ? Number(targetSigma.toFixed(2)) : null,
    probFinishBeyondT1: probFinish != null ? Number(probFinish.toFixed(3)) : null,
    probTouchT1: probTouch != null ? Number(probTouch.toFixed(3)) : null,
    roiIfT1Today: atT1 != null && mid ? Number((atT1 / mid - 1).toFixed(3)) : null,
    valueAtStopToday: atStop != null ? Number(atStop.toFixed(2)) : null,
    premiumChangeSincePublish: opts.entryPremium && mid ? Number((mid / opts.entryPremium - 1).toFixed(3)) : null,
    breakevenAtExpiry: mid != null ? Number((opts.strike + sgn * mid).toFixed(2)) : null,
  });

  const f = base.flags;
  if (targetMove != null && targetMove <= 0) f.push('stock is already past T1 — the published target is spent');
  if (targetSigma != null && targetSigma > 1) f.push(`T1 is ${targetSigma.toFixed(1)}σ away — beyond the move the market is pricing by expiry`);
  if (base.thetaPerDayPct != null && base.thetaPerDayPct > 0.05) f.push(`theta now burns ${(base.thetaPerDayPct * 100).toFixed(1)}%/day`);
  if (base.premiumChangeSincePublish != null && base.premiumChangeSincePublish > 0.3) f.push(`premium already +${Math.round(base.premiumChangeSincePublish * 100)}% since publish — late entry`);
  if (bid > 0 && mid && (ask - bid) / mid > 0.1) f.push(`spread ${Math.round(((ask - bid) / mid) * 100)}% of premium`);
  if (base.breakevenAtExpiry != null && opts.target != null && sgn * (opts.target - base.breakevenAtExpiry) < 0) f.push('T1 does not clear the expiry breakeven — the trade needs T1 early, before decay');
  if (dte <= 2) f.push(`${dte} DTE — gamma risk, decides fast`);
  return base;
}
