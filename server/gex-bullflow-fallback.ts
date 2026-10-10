/**
 * GEX FROM BULLFLOW — the rescue leg for the 122 names that die on chains.
 *
 * The hub's honest "14/136 scanned" exists because Tradier is dead and CBOE
 * 429s under the fetch storm. Bullflow serves PRE-COMPUTED per-strike net
 * GEX/VEX with spot in one call per endpoint — no chain storm at all.
 *
 * Units verified empirically against SPY (2026-09-08): values are DOLLARS,
 * calls positive / puts negative — the same convention as the CBOE path —
 * so totals divide to $B (GEX) and $M (VEX) exactly like every other leg.
 *
 * Rate limits: both endpoints are 25 req/min. All calls here serialize
 * through one queue with a 2.6s gap, so a 120-name rescue takes ~10 min in
 * the background scan rather than tripping the limiter.
 */
import { logger } from './logger';
import type { GEXSnapshot, GEXLevel } from '@shared/gex-types';

let chain: Promise<void> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.then(() => new Promise((r) => setTimeout(r, 2600)), () => new Promise((r) => setTimeout(r, 2600)));
  return run;
}

export async function computeGEXFromBullflow(symbol: string): Promise<GEXSnapshot | null> {
  try {
    const bf = await import('./bullflow-service');
    if (!bf.bullflowEnabled()) return null;

    const gex: any = await throttled(() => bf.getNetGexChain(symbol));
    if (!gex?.spot_price || !Array.isArray(gex.strikes) || gex.strikes.length === 0) return null;
    const vex: any = await throttled(() => bf.getNetVexChain(symbol));

    const spot = Number(gex.spot_price);

    // Aggregate across expirations, per strike.
    const byStrike = new Map<number, { call: number; put: number; net: number }>();
    let totalCall = 0, totalPut = 0;
    for (const row of gex.strikes) {
      const k = Number(row.strike);
      if (!Number.isFinite(k)) continue;
      const a = byStrike.get(k) ?? { call: 0, put: 0, net: 0 };
      a.call += Number(row.call_gex) || 0;
      a.put += Number(row.put_gex) || 0;
      a.net += Number(row.net_gex) || 0;
      byStrike.set(k, a);
      totalCall += Number(row.call_gex) || 0;
      totalPut += Number(row.put_gex) || 0;
    }
    const totalGEX = (totalCall + totalPut) / 1e9;

    let totalVEX = 0;
    if (Array.isArray(vex?.strikes)) {
      for (const row of vex.strikes) totalVEX += Number(row.net_vex) || 0;
      totalVEX /= 1e6;
    }

    const strikes = [...byStrike.entries()].sort((a, b) => a[0] - b[0]);

    // Walls + max-gamma, CBOE-path conventions.
    let callWall: number | null = null, callWallVal = 0;
    let putWall: number | null = null, putWallVal = 0;
    let maxGammaStrike = spot, maxAbs = 0;
    for (const [k, a] of strikes) {
      if (Math.abs(a.net) > maxAbs) { maxAbs = Math.abs(a.net); maxGammaStrike = k; }
      if (k > spot && a.net > callWallVal) { callWallVal = a.net; callWall = k; }
      if (k < spot && a.net < putWallVal) { putWallVal = a.net; putWall = k; }
    }

    // Flip: cumulative net crosses zero walking strikes upward.
    let gammaFlipPrice: number | null = null;
    let cum = 0, prevCum = 0, prevK: number | null = null;
    for (const [k, a] of strikes) {
      prevCum = cum;
      cum += a.net;
      if (prevK != null && ((prevCum < 0 && cum >= 0) || (prevCum > 0 && cum <= 0))) {
        const span = cum - prevCum;
        gammaFlipPrice = span !== 0 ? prevK + (k - prevK) * (0 - prevCum) / span : k;
        // keep the crossing NEAREST spot when several exist
        if (gammaFlipPrice != null && Math.abs(gammaFlipPrice - spot) > spot * 0.25) gammaFlipPrice = null;
        else break;
      }
      prevK = k;
    }

    const totalAbs = strikes.reduce((s, [, a]) => s + Math.abs(a.net), 0) || 1;
    const levels: GEXLevel[] = strikes
      .map(([k, a]) => ({ k, a }))
      .sort((x, y) => Math.abs(y.a.net) - Math.abs(x.a.net))
      .slice(0, 10)
      .map(({ k, a }): GEXLevel => ({
        strike: k,
        gex: a.net / 1e9,
        callGex: a.call / 1e9,
        putGex: a.put / 1e9,
        vex: 0,                   // per-strike vanna not merged in this leg — 0, not invented
        openInterest: 0,          // not carried by this feed — 0, not invented
        gammaPct: Math.abs(a.net) / totalAbs,
        role: k === maxGammaStrike ? 'max_gamma' : a.net > 0 && k > spot ? 'resistance' : a.net < 0 && k < spot ? 'support' : 'neutral',
        distancePct: ((k - spot) / spot) * 100,
      }));

    const regime = totalGEX > 0.05 ? 'positive_gamma' : totalGEX < -0.05 ? 'negative_gamma' : 'transitioning';

    return {
      symbol: symbol.toUpperCase(),
      spotPrice: spot,
      calculatedAt: Date.now(),
      totalGEX,
      totalNetGEX: totalGEX,
      totalVEX,
      callGEX: totalCall / 1e9,
      putGEX: totalPut / 1e9,
      putCallRatio: totalCall !== 0 ? Math.abs(totalPut) / totalCall : 0,
      gammaFlipPrice,
      maxGammaStrike,
      callWall,
      putWall,
      zeroGammaProjection: gammaFlipPrice,
      levels,
      regime,
      volatilityRegime: 'normal',
      dealerFlowPer1Pct: 0,
      byDte: undefined,
    } as GEXSnapshot;
  } catch (e: any) {
    logger.warn(`[GEX-BULLFLOW] ${symbol} failed: ${e?.message}`);
    return null;
  }
}
