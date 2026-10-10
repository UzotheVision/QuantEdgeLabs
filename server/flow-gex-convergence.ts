/**
 * Flow-GEX Convergence Service
 * ============================
 * Combines options flow data with gamma exposure analysis to produce
 * high-conviction trading signals. When flow and GEX align, the signal
 * is exponentially stronger (like Trade Echo's 3-tool convergence).
 *
 * HIGH conviction = Short gamma + directional flow (squeeze/crash setup)
 * MEDIUM conviction = Neutral gamma + directional flow
 * LOW conviction = Long gamma + flow aligned (dampened move expected)
 */

// Dollars → a readable magnitude. "$255278K" was a real render; premiums at
// this scale read in millions or billions, not thousands.
function fmtPremium(d: number): string {
  const a = Math.abs(d);
  if (a >= 1e9) return `$${(d / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(d / 1e6).toFixed(1)}M`;
  return `$${(d / 1e3).toFixed(0)}K`;
}


import { logger } from './logger';
import { db } from './db';
import { optionsFlowHistory } from '@shared/schema';
import { eq, desc, gte, and, sql } from 'drizzle-orm';
import { getTradierQuote, getTradierOptionsChain } from './tradier-api';

import { marketDateET } from '@shared/market-day';
// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ConvergenceSignal {
  symbol: string;
  conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  gexBias: 'Long Gamma' | 'Short Gamma' | 'Neutral';
  gexRegime: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  flowBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  flowStrength: number; // 0-100
  convergenceType: string;
  flowCount: number;
  totalPremium: number;
  callCount: number;
  putCount: number;
  gexAnchor: number;
  gexFlipPoint: number | null;
  spotPrice: number;
  defenseLines: number[];
  gexRating: number;
  reasoning: string;
  strategy: string;
  timestamp: string;
}

interface GEXHeatmapData {
  spotPrice: number;
  strikes: number[];
  expirations: string[];
  heatmap: Record<string, Record<string, number>>;
  flipPoint: number | null;
  maxGammaStrike: number;
}

interface GEXKeyLevels {
  anchor: number;
  flip: number | null;
  defenseLines: number[];
  gexRating: number;
  bias: 'Long Gamma' | 'Short Gamma' | 'Neutral';
  regime: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════

const convergenceCache = new Map<string, { data: ConvergenceSignal; ts: number }>();
const CACHE_TTL = 60_000; // 60 seconds

// ═══════════════════════════════════════════════════════════════
// SERVER-SIDE KEY LEVELS (ported from gex-dashboard.tsx)
// ═══════════════════════════════════════════════════════════════

function aggregateGex(data: GEXHeatmapData): Map<number, number> {
  const agg = new Map<number, number>();
  for (const strike of data.strikes) {
    const row = data.heatmap[String(strike)] || {};
    let total = 0;
    for (const exp of data.expirations) total += row[exp] || 0;
    agg.set(strike, total);
  }
  return agg;
}

function computeKeyLevels(data: GEXHeatmapData): GEXKeyLevels {
  const { spotPrice, strikes, flipPoint, maxGammaStrike } = data;
  const agg = aggregateGex(data);

  const ranked = [...agg.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .filter(([s]) => s !== maxGammaStrike)
    .slice(0, 3)
    .map(([s]) => s)
    .sort((a, b) => b - a);

  // GEX Rating: concentration near spot
  const nearSpotGex = strikes
    .filter(s => Math.abs(s - spotPrice) / spotPrice < 0.02)
    .reduce((sum, s) => sum + Math.abs(agg.get(s) || 0), 0);
  const totalGex = [...agg.values()].reduce((sum, v) => sum + Math.abs(v), 0);
  const concentration = totalGex > 0 ? nearSpotGex / totalGex : 0;
  const gexRating = Math.min(5, Math.max(1, Math.round(concentration * 10 + 1)));

  const bias: GEXKeyLevels['bias'] = !flipPoint ? 'Neutral'
    : spotPrice > flipPoint ? 'Long Gamma' : 'Short Gamma';
  const regime: GEXKeyLevels['regime'] = !flipPoint ? 'NEUTRAL'
    : spotPrice > flipPoint ? 'POSITIVE' : 'NEGATIVE';

  return { anchor: maxGammaStrike, flip: flipPoint, defenseLines: ranked, gexRating, bias, regime };
}

// ═══════════════════════════════════════════════════════════════
// FETCH GEX DATA (reuse existing heatmap logic from routes.ts)
// ═══════════════════════════════════════════════════════════════

/**
 * GEX for the convergence read.
 *
 * This used to go straight to Tradier, which returns 401 on an unfunded account —
 * so fetchGEXData returned null for EVERY symbol and getTopConvergenceSignals
 * silently produced an empty list. The whole convergence feature was dead, and
 * dead quietly: no error surfaced, it just always found nothing.
 *
 * CBOE's chain needs no auth and already powers the GEX tab, so try it first and
 * keep Tradier only as a secondary path for whenever that key is funded again.
 */

/** Adapt the live CBOE GEX snapshot into the heatmap shape this module expects. */
async function fetchGEXFromCBOE(symbol: string): Promise<GEXHeatmapData | null> {
  try {
    const { computeGEXFromCBOE } = await import('./gex-cboe-fallback');
    const snap = await computeGEXFromCBOE(symbol);
    if (!snap || !(snap.spotPrice > 0) || !Array.isArray(snap.levels) || snap.levels.length === 0) return null;

    const strikes = snap.levels.map((l: any) => Number(l.strike)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    if (!strikes.length) return null;

    // computeKeyLevels aggregates heatmap[expiry][strike]; the CBOE snapshot is
    // already summed across expiries, so present it as a single synthetic column.
    // aggregateGex sums over expiries either way, so the maths is unchanged.
    const column: Record<string, number> = {};
    for (const l of snap.levels as any[]) column[String(l.strike)] = Number(l.netGEX) || 0;

    // The snapshot's own gammaFlipPrice is unreliable — it returns 230 for SPY at
    // $762, i.e. outside the strike ladder entirely. A flip point that isn't in the
    // ladder is not a regime boundary, and passing it through produced a bogus
    // Long/Short Gamma call; dropping it left the regime Neutral and every symbol
    // NO_SIGNAL. So derive it from the ladder instead, which is the actual
    // definition: walk strikes upward accumulating net GEX and take the level where
    // the running total changes sign — below it dealers are short gamma and amplify
    // moves, above it they're long gamma and dampen them.
    const rawFlip = Number(snap.gammaFlipPrice);
    let flipPoint: number | null =
      Number.isFinite(rawFlip) && rawFlip >= strikes[0] && rawFlip <= strikes[strikes.length - 1]
        ? rawFlip
        : null;

    if (flipPoint == null) {
      const ladder = [...(snap.levels as any[])]
        .map((l) => ({ strike: Number(l.strike), gex: Number(l.netGEX) || 0 }))
        .filter((l) => Number.isFinite(l.strike))
        .sort((a, b) => a.strike - b.strike);
      let cum = 0;
      let prevCum = 0;
      for (const lvl of ladder) {
        prevCum = cum;
        cum += lvl.gex;
        if (prevCum !== 0 && Math.sign(cum) !== Math.sign(prevCum)) {
          flipPoint = lvl.strike;
          break;
        }
      }
    }

    return {
      spotPrice: snap.spotPrice,
      strikes,
      expirations: ['aggregate'],
      heatmap: { aggregate: column },
      flipPoint,
      maxGammaStrike: Number(snap.maxGammaStrike) || strikes[Math.floor(strikes.length / 2)],
    };
  } catch {
    return null;
  }
}

async function fetchGEXData(symbol: string): Promise<GEXHeatmapData | null> {
  const viaCboe = await fetchGEXFromCBOE(symbol);
  if (viaCboe) return viaCboe;

  try {
    const apiKey = process.env.TRADIER_API_KEY;
    if (!apiKey) return null;

    const quote = await getTradierQuote(symbol, apiKey);
    if (!quote?.last && !quote?.close) return null;
    const spotPrice = quote.last || quote.close || 0;
    if (spotPrice <= 0) return null;

    // Get expirations
    const useSandbox = process.env.TRADIER_USE_SANDBOX === 'true';
    const base = useSandbox ? 'https://sandbox.tradier.com/v1' : 'https://api.tradier.com/v1';
    const expRes = await fetch(`${base}/markets/options/expirations?symbol=${symbol}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!expRes.ok) return null;
    const expData = await expRes.json();
    const expirations = (expData.expirations?.date || []).slice(0, 5);
    if (expirations.length === 0) return null;

    // Fetch chains
    const heatmap: Record<string, Record<string, number>> = {};
    const allStrikes = new Set<number>();

    for (const exp of expirations) {
      const chain = await getTradierOptionsChain(symbol, exp, apiKey);
      if (!chain || chain.length === 0) continue;

      for (const opt of chain) {
        const strike = opt.strike;
        if (Math.abs(strike - spotPrice) / spotPrice > 0.05) continue;

        allStrikes.add(strike);
        const gamma = opt.greeks?.gamma || 0;
        const oi = opt.open_interest || 0;
        const gex = oi * gamma * 100 * spotPrice * spotPrice / 1e9;
        const signedGex = opt.option_type === 'call' ? gex : -gex;

        if (!heatmap[String(strike)]) heatmap[String(strike)] = {};
        heatmap[String(strike)][exp] = (heatmap[String(strike)][exp] || 0) + Math.round(signedGex * 1000);
      }
    }

    const strikes = [...allStrikes].sort((a, b) => b - a);
    if (strikes.length === 0) return null;

    // Compute flip point and max gamma
    const agg = new Map<number, number>();
    for (const s of strikes) {
      const row = heatmap[String(s)] || {};
      let total = 0;
      for (const exp of expirations) total += row[exp] || 0;
      agg.set(s, total);
    }

    let maxGammaStrike = strikes[0];
    let maxGex = 0;
    let flipPoint: number | null = null;
    const ascending = [...strikes].sort((a, b) => a - b);

    for (const s of ascending) {
      const g = Math.abs(agg.get(s) || 0);
      if (g > maxGex) { maxGex = g; maxGammaStrike = s; }
    }

    // Find flip: where cumulative GEX changes sign
    let cumGex = 0;
    for (const s of ascending) {
      const prev = cumGex;
      cumGex += agg.get(s) || 0;
      if (prev !== 0 && ((prev > 0 && cumGex <= 0) || (prev < 0 && cumGex >= 0))) {
        flipPoint = s;
      }
    }

    return { spotPrice, strikes, expirations, heatmap, flipPoint, maxGammaStrike };
  } catch (error) {
    logger.error(`[CONVERGENCE] Error fetching GEX for ${symbol}:`, error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// FETCH RECENT FLOW
// ═══════════════════════════════════════════════════════════════

async function fetchRecentFlow(symbol: string, hours = 8) {
  try {
    const cutoff = new Date(Date.now() - hours * 3600000);
    const today = marketDateET(); // ET market date — NOT the UTC date

    const flows = await db.select()
      .from(optionsFlowHistory)
      .where(
        and(
          eq(optionsFlowHistory.symbol, symbol.toUpperCase()),
          gte(optionsFlowHistory.detectedDate, today)
        )
      )
      .orderBy(desc(optionsFlowHistory.totalPremium))
      .limit(100);

    return flows;
  } catch (error) {
    logger.error(`[CONVERGENCE] Error fetching flow for ${symbol}:`, error);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// CONVERGENCE COMPUTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Compute convergence signal for a single symbol.
 * Combines GEX regime + options flow direction.
 */
export async function computeConvergenceSignal(symbol: string): Promise<ConvergenceSignal | null> {
  const sym = symbol.toUpperCase();

  // Check cache
  const cached = convergenceCache.get(sym);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    // Fetch GEX and flow in parallel
    const [gexData, flowRows] = await Promise.all([
      fetchGEXData(sym === 'SPX' ? 'SPY' : sym),
      fetchRecentFlow(sym),
    ]);

    if (!gexData) {
      logger.debug(`[CONVERGENCE] No GEX data for ${sym}`);
      return null;
    }

    const keyLevels = computeKeyLevels(gexData);
    const { anchor, flip, defenseLines, gexRating, bias, regime } = keyLevels;

    // Compute flow stats
    let callPremium = 0, putPremium = 0, callCount = 0, putCount = 0;
    for (const f of flowRows) {
      const prem = f.totalPremium || 0;
      if (f.optionType === 'call') { callPremium += prem; callCount++; }
      else { putPremium += prem; putCount++; }
    }

    const totalPremium = callPremium + putPremium;
    const flowStrength = totalPremium > 0 ? Math.min(100, Math.round(Math.abs(callPremium - putPremium) / totalPremium * 100)) : 0;
    const flowBias: ConvergenceSignal['flowBias'] = flowStrength < 10 ? 'NEUTRAL'
      : callPremium > putPremium ? 'BULLISH' : 'BEARISH';

    // Determine convergence type and conviction
    let conviction: ConvergenceSignal['conviction'] = 'LOW';
    let convergenceType = 'NEUTRAL';
    let reasoning = '';
    let strategy = '';

    const flowCount = flowRows.length;
    const hasSignificantFlow = flowCount >= 3 && totalPremium >= 50000;

    if (regime === 'NEGATIVE' && flowBias === 'BULLISH' && hasSignificantFlow) {
      // Short gamma + bullish flow = squeeze setup
      conviction = flowCount >= 5 && flowStrength >= 40 ? 'HIGH' : 'MEDIUM';
      convergenceType = 'CALL_SWEEP_SHORT_GAMMA';
      reasoning = `Short gamma regime (spot below flip at $${flip}) with ${callCount} bullish call sweeps totaling ${fmtPremium(callPremium)}. Dealers are short gamma and must BUY into rallies — large call flow here can trigger a gamma squeeze.`;
      strategy = `Long: Entry near $${gexData.spotPrice.toFixed(0)}, target $${anchor}, stop below $${(defenseLines[2] || gexData.spotPrice * 0.97).toFixed(0)}. Look for 0DTE or weekly calls at $${anchor} strike.`;
    } else if (regime === 'NEGATIVE' && flowBias === 'BEARISH' && hasSignificantFlow) {
      // Short gamma + bearish flow = crash acceleration
      conviction = flowCount >= 5 && flowStrength >= 40 ? 'HIGH' : 'MEDIUM';
      convergenceType = 'PUT_SWEEP_SHORT_GAMMA';
      reasoning = `Short gamma regime with ${putCount} bearish put sweeps totaling ${fmtPremium(putPremium)}. Dealers amplify downside moves — put flow accelerates the sell-off.`;
      strategy = `Short: Entry near $${gexData.spotPrice.toFixed(0)}, target $${(defenseLines[2] || gexData.spotPrice * 0.95).toFixed(0)}, stop above $${flip || anchor}. Weekly puts below current price.`;
    } else if (regime === 'POSITIVE' && flowBias !== 'NEUTRAL' && hasSignificantFlow) {
      // Long gamma + directional flow = dampened but directional
      conviction = 'LOW';
      convergenceType = 'FLOW_LONG_GAMMA';
      reasoning = `Long gamma regime (spot above flip at $${flip}) — dealers dampen moves. ${flowBias} flow detected but expect mean reversion. Price likely gravitates to anchor at $${anchor}.`;
      strategy = `Scalp ${flowBias === 'BULLISH' ? 'long' : 'short'} with tight targets. Expect chop near $${anchor}. Sell premium strategies favored.`;
    } else if (regime === 'NEUTRAL' && flowBias !== 'NEUTRAL' && hasSignificantFlow) {
      conviction = 'MEDIUM';
      convergenceType = 'FLOW_NEUTRAL_GAMMA';
      reasoning = `Neutral gamma regime with ${flowBias} flow bias (${flowCount} trades, ${fmtPremium(totalPremium)} premium). Gamma provides no directional edge — flow direction is the primary signal.`;
      strategy = `${flowBias === 'BULLISH' ? 'Long' : 'Short'}: Follow the flow with standard risk management. Entry near $${gexData.spotPrice.toFixed(0)}, target 1-2% move.`;
    } else {
      convergenceType = 'NO_SIGNAL';
      reasoning = `Insufficient convergence. ${flowCount} trades detected with ${fmtPremium(totalPremium)} premium. ${regime} gamma regime with ${flowBias} flow.`;
      strategy = 'Wait for clearer signal alignment between GEX regime and institutional flow.';
    }

    const signal: ConvergenceSignal = {
      symbol: sym,
      conviction,
      gexBias: bias,
      gexRegime: regime,
      flowBias,
      flowStrength,
      convergenceType,
      flowCount,
      totalPremium,
      callCount,
      putCount,
      gexAnchor: anchor,
      gexFlipPoint: flip,
      spotPrice: gexData.spotPrice,
      defenseLines,
      gexRating,
      reasoning,
      strategy,
      timestamp: new Date().toISOString(),
    };

    convergenceCache.set(sym, { data: signal, ts: Date.now() });
    return signal;
  } catch (error) {
    logger.error(`[CONVERGENCE] Error computing signal for ${sym}:`, error);
    return null;
  }
}

/**
 * Get top convergence signals across the most active flow tickers
 */
export async function getTopConvergenceSignals(limit = 5): Promise<ConvergenceSignal[]> {
  try {
    const today = marketDateET(); // ET market date — NOT the UTC date

    // Get most active tickers from today's flow
    const activeResult = await db.select({
      symbol: optionsFlowHistory.symbol,
      count: sql<number>`count(*)`,
      premium: sql<number>`sum(coalesce(${optionsFlowHistory.totalPremium}, 0))`,
    })
      .from(optionsFlowHistory)
      .where(gte(optionsFlowHistory.detectedDate, today))
      .groupBy(optionsFlowHistory.symbol)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    if (activeResult.length === 0) return [];

    // Compute convergence for each (sequentially to avoid rate limits)
    const signals: ConvergenceSignal[] = [];
    for (const row of activeResult) {
      if (signals.length >= limit) break;
      try {
        const signal = await computeConvergenceSignal(row.symbol);
        if (signal && signal.convergenceType !== 'NO_SIGNAL') {
          signals.push(signal);
        }
      } catch (e) {
        logger.debug(`[CONVERGENCE] Skipping ${row.symbol}: ${e}`);
      }
      // Rate limit: 200ms between Tradier API calls
      await new Promise(r => setTimeout(r, 200));
    }

    // Sort by conviction (HIGH > MEDIUM > LOW) then by flow count
    const order = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    signals.sort((a, b) => (order[b.conviction] - order[a.conviction]) || (b.flowCount - a.flowCount));

    return signals.slice(0, limit);
  } catch (error) {
    logger.error('[CONVERGENCE] Error getting top signals:', error);
    return [];
  }
}

logger.info('[CONVERGENCE] Flow-GEX Convergence Service initialized');
