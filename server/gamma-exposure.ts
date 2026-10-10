/**
 * Net Gamma Exposure (GEX) Calculator — v2
 * =========================================
 * NO GAPS: real VEX, cross-validated spot, Schwab → Tradier → Yahoo cascade.
 *
 * Backwards-compatible contract:
 *   calculateGammaExposure(symbol, expiration?)  →  GammaExposureResult
 *   calculateAggregateGammaExposure(symbol)      →  GammaExposureResult
 *
 * New fields added to the result (all optional, old consumers ignore them):
 *   totalVEX, totalDEX, totalCharm, callWall, putWall, vannaFlipPrice,
 *   maxVannaStrike, regime, vexRegime, dataSource, dataQuality
 */

import { logger } from './logger';
import { getTradierOptionsChain } from './tradier-api';
import { getYahooOptionsChain, getYahooExpirations } from './yahoo-options-fallback';
import { getSchwabOptionsChain, getSchwabExpirations, isSchwabConfigured } from './schwab-options-adapter';
import { getCBOEExpirations, getCBOEOptionsChain } from './cboe-options-fallback';
import { getCrossValidatedQuote } from './data-quality';
import {
  computeExposures,
  optionToInput,
  type OptionInput,
  type ExposureSnapshot,
  type StrikeExpiryCell,
} from './options-exposures';
import { tradierBase } from './tradier-api';

// ─── Legacy-compat types ───────────────────────────────────

interface GammaByStrike {
  strike: number;
  callGamma: number;
  putGamma: number;
  callOI: number;
  putOI: number;
  netGEX: number;
  callGEX: number;
  putGEX: number;
  // New fields (optional — legacy consumers ignore)
  callVEX?: number;
  putVEX?: number;
  netVEX?: number;
}

export interface GammaExposureResult {
  symbol: string;
  spotPrice: number;
  expiration: string;
  totalNetGEX: number;
  /** Alias of totalNetGEX — see the emit site for why both names ship. */
  totalGEX?: number;
  flipPoint: number | null;
  maxGammaStrike: number;
  strikes: GammaByStrike[];
  timestamp: string;

  // ─── New optional fields (no gaps)
  totalVEX?: number;
  totalDEX?: number;
  totalCharm?: number;
  callGEX?: number;
  putGEX?: number;
  putCallGEXRatio?: number;
  callWall?: number | null;
  putWall?: number | null;
  vannaFlipPrice?: number | null;
  maxVannaStrike?: number;
  zeroGammaProjection?: number | null;
  regime?: ExposureSnapshot['regime'];
  vexRegime?: ExposureSnapshot['vexRegime'];
  dataSource?: 'schwab' | 'tradier' | 'yahoo' | 'cboe' | 'mixed' | 'none';
  dataQuality?: {
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    score: number;
    sourceCount: number;
    spreadPct: number;
    isStale: boolean;
    hasDisagreement: boolean;
  };
  strikeExpiryMatrix?: StrikeExpiryCell[];
}

// ─── Options Fetch Cascade ─────────────────────────────────

type OptionsSource = 'schwab' | 'tradier' | 'yahoo' | 'cboe' | 'mixed' | 'none';
type OptionsFetchResult = {
  options: any[];
  source: OptionsSource;
};

async function fetchOptionsChain(
  symbol: string,
  expiration?: string,
): Promise<OptionsFetchResult> {
  // 1. Schwab (real-time, free for brokerage account holders)
  if (isSchwabConfigured()) {
    try {
      const schwab = await getSchwabOptionsChain(symbol, expiration);
      if (schwab.length > 0) {
        return { options: schwab, source: 'schwab' };
      }
    } catch (e: any) {
      logger.warn(`[GEX] Schwab chain failed for ${symbol}: ${e.message}`);
    }
  }

  // 2. Tradier (paid, reliable)
  try {
    const tradier = await getTradierOptionsChain(symbol, expiration);
    if (tradier.length > 0) {
      return { options: tradier, source: 'tradier' };
    }
  } catch (e: any) {
    logger.warn(`[GEX] Tradier chain failed for ${symbol}: ${e.message}`);
  }

  // 3. Yahoo (free fallback, BS greeks)
  try {
    const yahoo = await getYahooOptionsChain(symbol, expiration);
    if (yahoo.length > 0) {
      return { options: yahoo, source: 'yahoo' };
    }
  } catch (e: any) {
    logger.warn(`[GEX] Yahoo chain failed for ${symbol}: ${e.message}`);
  }

  // 4. CBOE delayed (free, no key, 15-min delay — last resort)
  try {
    const cboe = await getCBOEOptionsChain(symbol);
    if (cboe && cboe.options.length > 0) {
      // CBOE returns all expirations at once; filter to requested if specified
      let filtered = cboe.options;
      if (expiration) {
        filtered = cboe.options.filter((o: any) => o.expiration_date === expiration);
      }
      if (filtered.length > 0) {
        return { options: filtered, source: 'cboe' as any };
      }
    }
  } catch (e: any) {
    logger.warn(`[GEX] CBOE chain failed for ${symbol}: ${e.message}`);
  }

  return { options: [], source: 'none' };
}

async function fetchExpirationsCascade(symbol: string): Promise<string[]> {
  if (isSchwabConfigured()) {
    try {
      const schwab = await getSchwabExpirations(symbol);
      if (schwab.length > 0) return schwab;
    } catch { /* fall through */ }
  }

  // Tradier expirations
  try {
    const apiKey = process.env.TRADIER_API_KEY;
    if (apiKey) {
      const baseUrl = tradierBase();
      const res = await fetch(`${baseUrl}/markets/options/expirations?symbol=${symbol}`, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        const list = data.expirations?.date || [];
        if (list.length > 0) return list;
      }
    }
  } catch { /* fall through */ }

  // Yahoo
  try {
    const yahooExps = await getYahooExpirations(symbol);
    if (yahooExps.length > 0) return yahooExps;
  } catch { /* fall through */ }

  // CBOE delayed (last resort — free, no key, 15-min delay)
  try {
    const cboeExps = await getCBOEExpirations(symbol);
    if (cboeExps.length > 0) {
      logger.info(`[GEX-AGG] Using CBOE delayed expirations for ${symbol}`);
      return cboeExps;
    }
  } catch { /* fall through */ }

  return [];
}

// ─── Snapshot → Legacy result adapter ──────────────────────

function snapshotToLegacy(
  snap: ExposureSnapshot,
  expirationLabel: string,
  source: OptionsSource,
  cq: Awaited<ReturnType<typeof getCrossValidatedQuote>>,
): GammaExposureResult {
  const strikes: GammaByStrike[] = snap.strikes.map((s) => ({
    strike: s.strike,
    callGamma: s.callGamma,
    putGamma: s.putGamma,
    callOI: s.callOI,
    putOI: s.putOI,
    netGEX: s.netGEX,
    callGEX: s.callGEX,
    putGEX: s.putGEX,
    callVEX: s.callVEX,
    putVEX: s.putVEX,
    netVEX: s.netVEX,
  }));

  return {
    symbol: snap.symbol,
    spotPrice: snap.spotPrice,
    expiration: expirationLabel,
    /**
     * Emitted under BOTH names on purpose.
     *
     * The wire has always carried `totalNetGEX`, but shared/gex-types.ts
     * declares the field as `totalGEX`, so six client components read
     * `snapshot.totalGEX` and got `undefined` — with no type error, because the
     * type agreed with them and the server did not.
     *
     * The visible symptom was prism-board's `(snap.totalGEX ?? 0) >= 0`
     * evaluating `0 >= 0` on every symbol, so that panel printed "Positive
     * gamma — dealer hedging dampens moves" for SPY at −4.5B, directly beneath
     * a split reading 77% puts and beside a chip reading negative_gamma.
     *
     * Renaming either side alone breaks the other, so both are sent. The type
     * is now true of the payload, which is what lets the compiler catch the
     * next one of these.
     */
    totalNetGEX: snap.totalGEX,
    totalGEX: snap.totalGEX,
    flipPoint: snap.gammaFlipPrice,
    maxGammaStrike: snap.maxGammaStrike,
    strikes,
    timestamp: new Date(snap.calculatedAt).toISOString(),
    // Extras
    totalVEX: snap.totalVEX,
    totalDEX: snap.totalDEX,
    totalCharm: snap.totalCharm,
    callGEX: snap.callGEX,
    putGEX: snap.putGEX,
    putCallGEXRatio: snap.putCallGEXRatio,
    callWall: snap.callWall,
    putWall: snap.putWall,
    vannaFlipPrice: snap.vannaFlipPrice,
    maxVannaStrike: snap.maxVannaStrike,
    zeroGammaProjection: snap.zeroGammaProjection,
    regime: snap.regime,
    vexRegime: snap.vexRegime,
    strikeExpiryMatrix: snap.strikeExpiryMatrix,
    dataSource: source === 'none' ? undefined : source,
    dataQuality: {
      grade: cq.qualityGrade,
      score: cq.qualityScore,
      sourceCount: cq.sourceCount,
      spreadPct: cq.maxSpreadPct,
      isStale: cq.isStale,
      hasDisagreement: cq.hasDisagreement,
    },
  };
}

// ─── Single Expiration ──────────────────────────────────────

export async function calculateGammaExposure(
  symbol: string,
  expiration?: string,
): Promise<GammaExposureResult | null> {
  try {
    // 1. Cross-validated spot price
    const cq = await getCrossValidatedQuote(symbol);
    if (cq.bestPrice <= 0) {
      logger.error(`[GEX] No valid spot price for ${symbol}`);
      return null;
    }

    // 2. Fetch options chain via cascade
    const { options, source } = await fetchOptionsChain(symbol, expiration);
    if (options.length === 0) {
      logger.warn(`[GEX] No options data for ${symbol} from any source`);
      return null;
    }

    const actualExpiration = options[0]?.expiration_date || expiration || 'unknown';

    // 3. Map to OptionInput
    const inputs: OptionInput[] = [];
    for (const opt of options) {
      const input = optionToInput(opt, actualExpiration);
      if (input) inputs.push(input);
    }

    if (inputs.length === 0) {
      logger.warn(`[GEX] No usable option contracts for ${symbol}`);
      return null;
    }

    // 4. Compute exposures
    const snap = computeExposures(symbol, cq.bestPrice, inputs, [actualExpiration]);

    return snapshotToLegacy(snap, actualExpiration, source, cq);
  } catch (error: any) {
    logger.error(`[GEX] Error calculating gamma exposure for ${symbol}: ${error?.message || error}`);
    return null;
  }
}

// ─── Multi-Expiration Aggregate ────────────────────────────

export async function calculateAggregateGammaExposure(
  symbol: string,
): Promise<GammaExposureResult | null> {
  try {
    // 1. Cross-validated spot
    const cq = await getCrossValidatedQuote(symbol);
    if (cq.bestPrice <= 0) {
      logger.warn(`[GEX-AGG] No valid spot price for ${symbol}`);
      return null;
    }

    // 1.5 — Massive chain snapshot: the whole chain (greeks, IV, OI, volume)
    // in one OPRA-fed call. Entitlement-gated: silently unavailable until the
    // operator's Options Starter subscription activates, at which point this
    // becomes the primary leg and the per-expiry fetch storm below becomes
    // the fallback. See server/massive-options.ts.
    try {
      const { getMassiveChainInputs } = await import('./massive-options');
      const massiveInputs = await getMassiveChainInputs(symbol);
      if (massiveInputs && massiveInputs.length >= 10) {
        const snap = computeExposures(symbol, cq.bestPrice, massiveInputs, ['massive-chain']);
        logger.info(`[GEX-AGG] ${symbol}: Massive chain snapshot — ${massiveInputs.length} contracts, one call`);
        return snapshotToLegacy(snap, `Aggregate (massive chain)`, 'mixed', cq);
      }
    } catch { /* fall through to the cascade */ }

    // 2. Get expirations
    const allExps = await fetchExpirationsCascade(symbol);
    if (allExps.length === 0) {
      logger.warn(`[GEX-AGG] No expirations found for ${symbol}`);
      return null;
    }

    // Fetch a wide window with a hard cap — uncapping fires too many parallel
    // requests per symbol and Tradier rate-limits the entire scan to zero.
    // 30 expiries gives ~3 months for daily-expiry symbols; for the LEAPS view
    // the dedicated buckets/CBOE-fallback endpoint pulls the full chain.
    const nearExps = allExps.slice(0, 30);

    // 3. Fetch in chunks (concurrency limit) with cascade — keeps under rate-limit
    const CHUNK = 6;
    const chainResults: Awaited<ReturnType<typeof fetchOptionsChain>>[] = [];
    for (let i = 0; i < nearExps.length; i += CHUNK) {
      const slice = nearExps.slice(i, i + CHUNK);
      const part = await Promise.all(slice.map((exp) => fetchOptionsChain(symbol, exp)));
      chainResults.push(...part);
    }

    // 4. Collect all inputs
    const allInputs: OptionInput[] = [];
    const expsUsed: string[] = [];
    const sourcesUsed = new Set<string>();
    for (let i = 0; i < chainResults.length; i++) {
      const { options, source } = chainResults[i];
      if (options.length === 0) continue;
      expsUsed.push(nearExps[i]);
      sourcesUsed.add(source);
      for (const opt of options) {
        const input = optionToInput(opt, nearExps[i]);
        if (input) allInputs.push(input);
      }
    }

    if (allInputs.length === 0) {
      logger.warn(`[GEX-AGG] No option contracts for ${symbol} across ${nearExps.length} exps`);
      return null;
    }

    // 5. Compute unified exposures
    const snap = computeExposures(symbol, cq.bestPrice, allInputs, expsUsed);

    const mixedSource: OptionsSource =
      sourcesUsed.size === 1
        ? (Array.from(sourcesUsed)[0] as OptionsSource)
        : sourcesUsed.size > 1 ? 'mixed' : 'none';

    const legacyExp = `Aggregate (${expsUsed.length} exp)`;
    return snapshotToLegacy(snap, legacyExp, mixedSource, cq);
  } catch (error: any) {
    logger.error(`[GEX] Aggregate calculation error for ${symbol}: ${error?.message || error}`);
    return null;
  }
}
