/**
 * CBOE-BASED GEX FALLBACK
 * =======================
 * Direct CBOE chain → full GEX snapshot.
 * Works on weekends, after-hours, when Tradier is rate-limited.
 *
 * Used as fallback when calculateAggregateGammaExposure (Tradier-first)
 * returns null. CBOE returns end-of-day option chains that update
 * even when markets are closed — perfect for "last known good" data.
 *
 * Returns the same GEXSnapshot shape as toSnapshot() so callers
 * can drop it in transparently.
 */

import { logger } from './logger';
import type { GEXSnapshot } from '../shared/gex-types';
import { bucketizeChain, dealerFlowPer1PctFromGamma, type BucketContract } from './gex-dte-buckets';

interface CBOEContract {
  option: string;
  bid: number;
  ask: number;
  iv: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  open_interest: number;
  volume: number;
  last_trade_price: number;
}

interface CBOEResponse {
  data: {
    symbol: string;
    current_price: number;
    bid: number;
    ask: number;
    options: CBOEContract[];
  };
}

interface AggregatedStrike {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  callOI: number;
  putOI: number;
  callVEX: number;
  putVEX: number;
}

export async function computeGEXFromCBOE(symbol: string): Promise<GEXSnapshot | null> {
  try {
    const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${symbol}.json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const j: CBOEResponse = await r.json();
    const data = j?.data;
    if (!data?.current_price || !data?.options?.length) return null;

    const spot = data.current_price;
    const opts = data.options;
    const slen = symbol.length;

    // Aggregate by strike
    const byStrike = new Map<number, AggregatedStrike>();
    let totalCallGEX = 0, totalPutGEX = 0;
    let totalCallVEX = 0, totalPutVEX = 0;

    // For DTE bucketing — we collect raw contracts as we walk
    const contractList: BucketContract[] = [];
    let netGammaSum = 0; // for dealer-flow calc

    for (const o of opts) {
      const s = o.option;
      const base = s.slice(slen);
      const cp = base[6];
      const strike = parseInt(base.slice(7)) / 1000;
      const oi = o.open_interest || 0;
      if (oi === 0) continue;
      const gamma = o.gamma || 0;
      const vega = o.vega || 0;
      // Expiration is encoded in CBOE option symbol: chars 0-5 of `base` = YYMMDD
      const yy = base.slice(0, 2);
      const mm = base.slice(2, 4);
      const dd = base.slice(4, 6);
      const expirationDate = `20${yy}-${mm}-${dd}`;
      contractList.push({ expirationDate, strike, cp: cp as 'C' | 'P', oi, gamma });
      netGammaSum += oi * gamma * (cp === 'P' ? -1 : 1);

      // GEX in dollars per 1% underlying move.
      // The 100-share contract multiplier and the 0.01 move cancel, so adding
      // another ×100 here would inflate the fallback exposure by two orders of
      // magnitude relative to the canonical options-exposures implementation.
      const gexContribution = oi * gamma * spot * spot;
      // VEX = OI × vega × spot × 100 (vanna proxy via vega)
      const vexContribution = oi * vega * spot * 100;

      const existing = byStrike.get(strike) || {
        strike, callGEX: 0, putGEX: 0, netGEX: 0, callOI: 0, putOI: 0, callVEX: 0, putVEX: 0
      };

      if (cp === 'C') {
        existing.callGEX += gexContribution;
        existing.callOI += oi;
        existing.callVEX += vexContribution;
        totalCallGEX += gexContribution;
        totalCallVEX += vexContribution;
      } else {
        existing.putGEX += gexContribution;
        existing.putOI += oi;
        existing.putVEX += vexContribution;
        totalPutGEX += gexContribution;
        totalPutVEX += vexContribution;
      }
      existing.netGEX = existing.callGEX - existing.putGEX;
      byStrike.set(strike, existing);
    }

    if (byStrike.size === 0) return null;

    // Sort strikes ascending
    const strikes = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);

    // Find call wall (largest +GEX above spot)
    let callWall: number | null = null;
    let callWallGEX = 0;
    for (const s of strikes) {
      if (s.strike > spot && s.netGEX > callWallGEX && s.callOI > 100) {
        callWall = s.strike;
        callWallGEX = s.netGEX;
      }
    }

    // Find put wall (largest -GEX below spot)
    let putWall: number | null = null;
    let putWallGEX = 0;
    for (const s of strikes) {
      if (s.strike < spot && s.netGEX < putWallGEX && s.putOI > 100) {
        putWall = s.strike;
        putWallGEX = s.netGEX;
      }
    }

    // Find max gamma strike (largest |netGEX|)
    let maxGammaStrike = strikes[0].strike;
    let maxAbs = 0;
    for (const s of strikes) {
      if (Math.abs(s.netGEX) > maxAbs) {
        maxAbs = Math.abs(s.netGEX);
        maxGammaStrike = s.strike;
      }
    }

    // Find gamma flip (where cumulative GEX changes sign)
    let gammaFlipPrice: number | null = null;
    let cumulative = 0;
    for (let i = 0; i < strikes.length; i++) {
      const prev = cumulative;
      cumulative += strikes[i].netGEX;
      if ((prev <= 0 && cumulative > 0) || (prev >= 0 && cumulative < 0)) {
        gammaFlipPrice = strikes[i].strike;
        break;
      }
    }

    const totalGEX = totalCallGEX - totalPutGEX;
    const totalVEX = totalCallVEX - totalPutVEX;
    const putCallRatio = totalCallGEX > 0 ? Math.abs(totalPutGEX) / totalCallGEX : 0;

    const regime: GEXSnapshot['regime'] =
      totalGEX > 0 && Math.abs(totalGEX) > 1e9 ? 'positive_gamma' :
      totalGEX < 0 && Math.abs(totalGEX) > 1e9 ? 'negative_gamma' :
      'neutral';

    // zeroGammaProjection: closest strike to gamma flip (if exists)
    const zeroGammaProjection = gammaFlipPrice;

    // Build levels for rendering (top 20 by |netGEX|, sorted by strike)
    const levelsRaw = [...strikes]
      .sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX))
      .slice(0, 20)
      .sort((a, b) => a.strike - b.strike);

    const levels = levelsRaw.map(l => ({
      strike: l.strike,
      netGEX: l.netGEX,
      callGEX: l.callGEX,
      putGEX: -l.putGEX,
      callOI: l.callOI,
      putOI: l.putOI,
      isCallWall: l.strike === callWall,
      isPutWall: l.strike === putWall,
      isMaxGamma: l.strike === maxGammaStrike,
    })) as any;

    // P0: DTE buckets + dealer-flow
    const byDte = bucketizeChain(contractList, spot);
    const dealerFlowPer1Pct = dealerFlowPer1PctFromGamma(netGammaSum, spot);

    return {
      symbol,
      spotPrice: spot,
      calculatedAt: Date.now(),
      totalGEX: totalGEX / 1e9,         // billions ($/1.0 move)
      totalVEX: totalVEX / 1e6,         // millions — match Tradier-path convention
      callGEX: totalCallGEX / 1e9,
      putGEX: -totalPutGEX / 1e9,
      putCallRatio,
      gammaFlipPrice,
      maxGammaStrike,
      callWall,
      putWall,
      zeroGammaProjection,
      levels,
      regime,
      volatilityRegime: 'normal',
      dealerFlowPer1Pct,
      byDte,
    } as GEXSnapshot;
  } catch (e: any) {
    logger.warn(`[GEX-CBOE-FALLBACK] failed ${symbol}: ${e.message}`);
    return null;
  }
}

/**
 * Bulk version — used by GEX Hub when Tradier scan fails.
 * Returns only symbols that yielded data.
 */
export async function bulkComputeGEXFromCBOE(symbols: string[]): Promise<Map<string, GEXSnapshot>> {
  const results = new Map<string, GEXSnapshot>();
  const BATCH = 8;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const data = await Promise.all(batch.map(s => computeGEXFromCBOE(s)));
    for (let j = 0; j < batch.length; j++) {
      if (data[j]) results.set(batch[j], data[j]!);
    }
  }
  return results;
}
