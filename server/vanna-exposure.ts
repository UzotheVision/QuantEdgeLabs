/**
 * VEX — Vanna Exposure Calculator
 * =================================
 * Parallel to GEX (gamma exposure), VEX measures the aggregate
 * sensitivity of dealer delta hedges to implied-volatility changes.
 *
 * Vanna = d(delta)/d(vol)
 * When IV drops, positive-vanna strikes pull delta toward zero →
 *   dealers unwind hedges → price reverts to vanna-heavy strikes.
 * When IV rises, negative-vanna strikes amplify moves.
 *
 * VEX per strike = OI × Vanna × 100 × Spot / 1e6
 *   Calls: dealers short calls → positive vanna exposure
 *   Puts:  dealers long puts  → negative vanna exposure
 */

import { logger } from './logger';
import { getTradierOptionsChain, getTradierQuote } from './tradier-api';
import { getYahooOptionsChain, getYahooExpirations } from './yahoo-options-fallback';
import { safeQuote } from './yahoo-finance-service';
import { tradierBase } from './tradier-api';

// Approximate vanna from delta + gamma when not provided by API
// Vanna ≈ (delta / spot) * (1 - delta) / IV  (simplified approximation)
// Better: use d1-based formula if we have IV
function estimateVanna(delta: number, gamma: number, spot: number, iv: number): number {
  if (!iv || iv <= 0 || !gamma || !spot) return 0;
  // Vanna = -d2 * N'(d1) / sigma ≈ gamma * spot * (1 - 2*|delta|) / iv
  // Simplified: vanna correlates with gamma and is strongest near ATM
  return gamma * spot * (1 - 2 * Math.abs(delta)) / (iv || 0.25);
}

export interface VannaByStrike {
  strike: number;
  callVanna: number;
  putVanna: number;
  callOI: number;
  putOI: number;
  callVEX: number;
  putVEX: number;
  netVEX: number;
}

export interface VannaExposureResult {
  symbol: string;
  spotPrice: number;
  expiration: string;
  totalNetVEX: number;
  vannaFlipPoint: number | null;
  maxVannaStrike: number;
  strikes: VannaByStrike[];
  timestamp: string;
}

/**
 * Calculate VEX for a single expiration
 */
export async function calculateVannaExposure(
  symbol: string,
  expiration?: string,
): Promise<VannaExposureResult | null> {
  try {
    let quote = await getTradierQuote(symbol);
    let spotPrice = quote?.last || quote?.close || 0;
    if (spotPrice <= 0) {
      const yQuote = await safeQuote(symbol);
      const { getBestPrice } = await import('./yahoo-finance-service');
      spotPrice = getBestPrice(yQuote);
    }
    if (spotPrice <= 0) return null;

    let options = await getTradierOptionsChain(symbol, expiration);
    if (options.length === 0) {
      logger.info(`[VEX] Tradier returned no data for ${symbol}, trying Yahoo...`);
      options = await getYahooOptionsChain(symbol, expiration) as any;
    }
    if (options.length === 0) return null;

    const actualExpiration = options[0]?.expiration_date || expiration || 'unknown';
    const strikeMap = new Map<number, VannaByStrike>();

    for (const opt of options) {
      const strike = opt.strike;
      const vanna = (opt.greeks as any)?.vanna ?? estimateVanna(opt.greeks?.delta || 0, opt.greeks?.gamma || 0, spotPrice, opt.greeks?.mid_iv || 0.25);
      const oi = opt.open_interest || 0;
      const isCall = opt.option_type === 'call';

      if (!strikeMap.has(strike)) {
        strikeMap.set(strike, {
          strike,
          callVanna: 0, putVanna: 0,
          callOI: 0, putOI: 0,
          callVEX: 0, putVEX: 0,
          netVEX: 0,
        });
      }
      const entry = strikeMap.get(strike)!;
      if (isCall) { entry.callVanna = vanna; entry.callOI = oi; }
      else        { entry.putVanna  = vanna; entry.putOI  = oi; }
    }

    const strikes: VannaByStrike[] = [];
    let totalNetVEX = 0;

    for (const entry of strikeMap.values()) {
      // Calls: positive VEX (MM short calls, vanna pushes delta toward them on IV drop)
      entry.callVEX = entry.callOI * entry.callVanna * 100 * spotPrice / 1e6;
      // Puts: negative VEX (MM long puts, vanna pushes away on IV drop)
      entry.putVEX = -entry.putOI * entry.putVanna * 100 * spotPrice / 1e6;
      entry.netVEX = entry.callVEX + entry.putVEX;
      totalNetVEX += entry.netVEX;
      strikes.push(entry);
    }

    strikes.sort((a, b) => a.strike - b.strike);

    // Vanna flip point — where cumulative VEX changes sign
    let vannaFlipPoint: number | null = null;
    let cumVEX = 0;
    let prevSign = 0;
    for (const s of strikes) {
      cumVEX += s.netVEX;
      const sign = Math.sign(cumVEX);
      if (prevSign !== 0 && sign !== prevSign) { vannaFlipPoint = s.strike; break; }
      prevSign = sign;
    }

    // Max vanna strike
    let maxVannaStrike = strikes[0]?.strike || spotPrice;
    let maxVEX = 0;
    for (const s of strikes) {
      if (Math.abs(s.netVEX) > maxVEX) { maxVEX = Math.abs(s.netVEX); maxVannaStrike = s.strike; }
    }

    logger.info(`[VEX] ${symbol}: ${strikes.length} strikes, total VEX ${totalNetVEX.toFixed(2)}`);
    return { symbol, spotPrice, expiration: actualExpiration, totalNetVEX, vannaFlipPoint, maxVannaStrike, strikes, timestamp: new Date().toISOString() };
  } catch (err) {
    logger.error(`[VEX] Error for ${symbol}:`, err);
    return null;
  }
}

/**
 * Aggregate VEX across next 4 expirations
 */
export async function calculateAggregateVEX(symbol: string): Promise<VannaExposureResult | null> {
  try {
    let quoteAgg = await getTradierQuote(symbol);
    let spotPrice = quoteAgg?.last || quoteAgg?.close || 0;
    if (spotPrice <= 0) {
      const yQuote = await safeQuote(symbol);
      const { getBestPrice } = await import('./yahoo-finance-service');
      spotPrice = getBestPrice(yQuote);
    }
    if (spotPrice <= 0) return null;

    // Get expirations — Tradier first, Yahoo fallback
    let expirations: string[] = [];
    const apiKey = process.env.TRADIER_API_KEY;
    if (apiKey) {
      try {
        const baseUrl = tradierBase();
        const expRes = await fetch(`${baseUrl}/markets/options/expirations?symbol=${symbol}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        });
        if (expRes.ok) {
          const expData = await expRes.json();
          expirations = (expData.expirations?.date || []).slice(0, 4);
        }
      } catch { /* fall through */ }
    }
    if (expirations.length === 0) {
      expirations = (await getYahooExpirations(symbol)).slice(0, 4);
    }
    if (expirations.length === 0) return null;

    const strikeMap = new Map<number, VannaByStrike>();

    for (const exp of expirations) {
      let options = await getTradierOptionsChain(symbol, exp);
      if (options.length === 0) {
        options = await getYahooOptionsChain(symbol, exp) as any;
      }
      for (const opt of options) {
        const strike = opt.strike;
        const vanna = (opt.greeks as any)?.vanna ?? estimateVanna(opt.greeks?.delta || 0, opt.greeks?.gamma || 0, spotPrice, opt.greeks?.mid_iv || 0.25);
        const oi = opt.open_interest || 0;
        const isCall = opt.option_type === 'call';

        if (!strikeMap.has(strike)) {
          strikeMap.set(strike, { strike, callVanna: 0, putVanna: 0, callOI: 0, putOI: 0, callVEX: 0, putVEX: 0, netVEX: 0 });
        }
        const entry = strikeMap.get(strike)!;
        if (isCall) { entry.callOI += oi; entry.callVanna = Math.max(entry.callVanna, vanna); }
        else        { entry.putOI += oi;  entry.putVanna = Math.max(entry.putVanna, vanna); }
      }
    }

    const strikes: VannaByStrike[] = [];
    let totalNetVEX = 0;

    for (const entry of strikeMap.values()) {
      entry.callVEX = entry.callOI * entry.callVanna * 100 * spotPrice / 1e6;
      entry.putVEX = -entry.putOI * entry.putVanna * 100 * spotPrice / 1e6;
      entry.netVEX = entry.callVEX + entry.putVEX;
      totalNetVEX += entry.netVEX;
      strikes.push(entry);
    }

    strikes.sort((a, b) => a.strike - b.strike);

    let vannaFlipPoint: number | null = null;
    let cumVEX = 0, prevSign = 0;
    for (const s of strikes) {
      cumVEX += s.netVEX;
      const sign = Math.sign(cumVEX);
      if (prevSign !== 0 && sign !== prevSign) { vannaFlipPoint = s.strike; break; }
      prevSign = sign;
    }

    let maxVannaStrike = strikes[0]?.strike || spotPrice;
    let maxVEX = 0;
    for (const s of strikes) {
      if (Math.abs(s.netVEX) > maxVEX) { maxVEX = Math.abs(s.netVEX); maxVannaStrike = s.strike; }
    }

    return {
      symbol, spotPrice, expiration: `Aggregate (${expirations.length} exp)`,
      totalNetVEX, vannaFlipPoint, maxVannaStrike, strikes, timestamp: new Date().toISOString(),
    };
  } catch (err) {
    logger.error(`[VEX] Aggregate error for ${symbol}:`, err);
    return null;
  }
}

logger.info('[VEX] Vanna Exposure Calculator loaded');
