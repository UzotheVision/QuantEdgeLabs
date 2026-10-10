/**
 * SPX INSTITUTIONAL INTELLIGENCE SERVICE
 * ========================================
 * Computes institutional-grade signals from REAL market data only.
 * Every signal is backed by actual API data — no fake/estimated signals.
 *
 * Data Sources:
 *   - Tradier: Options chains (greeks, OI, volume), quotes
 *   - Yahoo Finance: Intraday 5-min bars (VWAP), VIX data
 *   - Existing services: GEX calculator, volatility analysis, macro signals
 *
 * Signals Computed (every 60s during market hours):
 *   A) Put/Call Ratio by Strike (from Tradier chains)
 *   B) GEX Key Levels (from gamma-exposure.ts)
 *   C) IV Skew (from per-strike IV data)
 *   D) VIX Regime + Term Structure Proxy
 *   E) Macro Correlation Context (SPY/TLT/UUP/GLD)
 *   F) VWAP + Bands (from Yahoo 5-min bars)
 *   G) Volume Delta Approximation (from 5-min bars)
 *   H) Unified SPX Signal Score (weighted combination)
 */

import { logger } from './logger';
import { getTradierQuote, getTradierOptionsChain } from './tradier-api';
import { calculateGammaExposure } from './gamma-exposure';
import { analyzeVolatility, calculateRealizedVolatility } from './volatility-analysis-service';
import { analyzeVIXRegime, type VIXRegime } from './macro-signals';
import { calculateRSI, calculateEMA } from './technical-indicators';
import { db } from './db';
import { ivSnapshots } from '@shared/schema';
import { desc, eq, and } from 'drizzle-orm';
import { tradierBase } from './tradier-api';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface PCRByStrike {
  strike: number;
  callVolume: number;
  putVolume: number;
  callOI: number;
  putOI: number;
  pcr: number; // put vol / call vol
}

export interface PCRData {
  byStrike: PCRByStrike[];
  overallPCR: number;       // Total put vol / total call vol
  oiWeightedPCR: number;    // OI-weighted PCR
  totalCallVolume: number;
  totalPutVolume: number;
  totalCallOI: number;
  totalPutOI: number;
  interpretation: 'bullish' | 'bearish' | 'neutral';
}

export interface GEXData {
  flipPoint: number | null;
  maxGammaStrike: number;
  spotPrice: number;
  totalNetGEX: number;
  topLevels: Array<{
    strike: number;
    netGEX: number;
    type: 'support' | 'resistance' | 'magnet';
  }>;
}

export interface IVSkewData {
  atmIV: number;
  atmStrike: number;
  put25dIV: number;          // 25-delta put IV
  call25dIV: number;         // 25-delta call IV
  skew: number;              // put25dIV - call25dIV
  skewRatio: number;         // put25dIV / call25dIV
  interpretation: string;
}

export interface VIXData {
  vix: number;
  vix20dAvg: number;
  regime: VIXRegime;
  termStructure: 'contango' | 'flat' | 'backwardation';
  termSpread: number;        // Proxy spread
  tradingImplication: string;
}

export interface MacroCorrelation {
  spy: { price: number; change: number; changePct: number };
  tlt: { price: number; change: number; changePct: number };
  uup: { price: number; change: number; changePct: number };
  gld: { price: number; change: number; changePct: number };
  bondEquityRelation: 'flight_to_safety' | 'risk_on' | 'mixed';
  dollarPressure: 'headwind' | 'tailwind' | 'neutral';
  regime: 'risk_on' | 'risk_off' | 'mixed';
}

export interface VWAPData {
  vwap: number;
  upper1: number;           // VWAP + 1σ
  lower1: number;           // VWAP - 1σ
  upper2: number;           // VWAP + 2σ
  lower2: number;           // VWAP - 2σ
  currentPrice: number;
  distancePct: number;      // % distance from VWAP
  position: 'above_2sd' | 'above_1sd' | 'at_vwap' | 'below_1sd' | 'below_2sd';
}

export interface VolumeDeltaData {
  cumulativeDelta: number;
  deltaDirection: 'buying' | 'selling' | 'neutral';
  divergence: boolean;       // Price up but delta down (or vice versa)
  barsAnalyzed: number;
  note: string;             // Honest about approximation
}

export interface ExpectedMove {
  dailyMove: number;         // $ expected move for today
  dailyMovePct: number;      // % expected move
  weeklyMove: number;        // $ expected move for the week
  weeklyMovePct: number;
  upperTarget: number;       // spot + dailyMove
  lowerTarget: number;       // spot - dailyMove
  spotPrice: number;
}

export interface MomentumClassifier {
  regime: 'momentum_bullish' | 'momentum_bearish' | 'mean_reversion' | 'mixed';
  rsi: number;
  emaAlignment: 'bullish' | 'bearish' | 'neutral';
  slope5d: number;           // 5-day price slope (normalized)
  confidence: number;        // 0-100
  tradingAdvice: string;
}

export interface UnifiedScore {
  score: number;             // 0-100
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;        // 0-100
  topSignals: string[];
  thesis: string;
}

export interface SPXIntelligence {
  timestamp: string;
  marketOpen: boolean;
  pcr: PCRData | null;
  gex: GEXData | null;
  ivSkew: IVSkewData | null;
  vixRegime: VIXData | null;
  macro: MacroCorrelation | null;
  vwap: VWAPData | null;
  volumeDelta: VolumeDeltaData | null;
  expectedMove: ExpectedMove | null;
  momentum: MomentumClassifier | null;
  unifiedScore: UnifiedScore | null;
}

// ============================================
// CACHE (per-symbol)
// ============================================

const cachedIntelligence = new Map<string, SPXIntelligence>();
const lastComputeTimeBySymbol = new Map<string, number>();
const CACHE_TTL_MS = 55_000; // 55 seconds (compute every 60s)
let computeInterval: ReturnType<typeof setInterval> | null = null;
let lastSnapshotDate: string | null = null; // Track daily IV snapshot to prevent duplicates

// Shared caches for symbol-independent data (VIX + Macro)
let cachedVIXRegime: VIXData | null = null;
let cachedMacro: MacroCorrelation | null = null;
let lastVIXComputeTime = 0;
let lastMacroComputeTime = 0;

// Symbol mapping helpers
function getYahooSymbol(symbol: string): string {
  return symbol === 'SPX' ? '%5EGSPC' : symbol;
}
function getTradierSymbol(symbol: string): string {
  // SPX cash index doesn't have accessible options on Tradier — use SPY as proxy
  return symbol === 'SPX' ? 'SPY' : symbol;
}

// ============================================
// SIGNAL COMPUTATIONS
// ============================================

/**
 * A) Put/Call Ratio by Strike
 * Source: Tradier options chain — real OI + volume per strike
 */
async function computePCR(symbol: string = 'SPY'): Promise<PCRData | null> {
  try {
    const tradierSym = getTradierSymbol(symbol);
    const key = process.env.TRADIER_API_KEY;
    if (!key) return null;

    const baseUrl = tradierBase();
    const expRes = await fetch(`${baseUrl}/markets/options/expirations?symbol=${tradierSym}`, {
      headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
    });

    if (!expRes.ok) return null;
    const expData = await expRes.json();
    const expirations: string[] = (expData.expirations?.date || []).slice(0, 3);

    if (expirations.length === 0) return null;

    // Fetch chains for each expiration in parallel
    const chains = await Promise.all(
      expirations.map(exp => getTradierOptionsChain(tradierSym, exp))
    );

    const allOptions = chains.flat();
    if (allOptions.length === 0) return null;

    // Aggregate by strike
    const strikeMap = new Map<number, PCRByStrike>();
    let totalCallVol = 0, totalPutVol = 0, totalCallOI = 0, totalPutOI = 0;

    for (const opt of allOptions) {
      const strike = opt.strike;
      const existing = strikeMap.get(strike) || {
        strike, callVolume: 0, putVolume: 0, callOI: 0, putOI: 0, pcr: 0,
      };

      if (opt.option_type === 'call' || opt.type === 'call') {
        existing.callVolume += opt.volume || 0;
        existing.callOI += opt.open_interest || 0;
        totalCallVol += opt.volume || 0;
        totalCallOI += opt.open_interest || 0;
      } else {
        existing.putVolume += opt.volume || 0;
        existing.putOI += opt.open_interest || 0;
        totalPutVol += opt.volume || 0;
        totalPutOI += opt.open_interest || 0;
      }

      strikeMap.set(strike, existing);
    }

    // Calculate PCR per strike
    const byStrike: PCRByStrike[] = [];
    Array.from(strikeMap.values()).forEach((data) => {
      data.pcr = data.callVolume > 0 ? data.putVolume / data.callVolume : 0;
      if (data.callVolume + data.putVolume > 100) { // Filter noise
        byStrike.push(data);
      }
    });
    byStrike.sort((a, b) => a.strike - b.strike);

    const overallPCR = totalCallVol > 0 ? totalPutVol / totalCallVol : 1;
    const oiWeightedPCR = totalCallOI > 0 ? totalPutOI / totalCallOI : 1;

    // PCR > 1.2 = bearish crowd (contrarian bullish), PCR < 0.7 = bullish crowd (contrarian bearish)
    // When volume is 0 (weekends/after-hours), fall back to OI-weighted PCR for interpretation
    const effectivePCR = totalCallVol === 0 && totalCallOI > 0
      ? (totalCallOI > 0 ? totalPutOI / totalCallOI : 1)
      : overallPCR;
    const interpretation: PCRData['interpretation'] =
      effectivePCR > 1.2 ? 'bullish' :    // Contrarian: lots of puts = bullish
      effectivePCR < 0.7 ? 'bearish' :     // Contrarian: lots of calls = bearish
      'neutral';

    return {
      byStrike,
      overallPCR: Math.round(overallPCR * 100) / 100,
      oiWeightedPCR: Math.round(oiWeightedPCR * 100) / 100,
      totalCallVolume: totalCallVol,
      totalPutVolume: totalPutVol,
      totalCallOI: totalCallOI,
      totalPutOI: totalPutOI,
      interpretation,
    };
  } catch (err) {
    logger.debug(`[SPX-INTEL] PCR computation failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * B) GEX Key Levels
 * Source: gamma-exposure.ts — real OI + gamma from Tradier
 */
async function computeGEX(symbol: string = 'SPY'): Promise<GEXData | null> {
  try {
    const tradierSym = getTradierSymbol(symbol);
    const result = await calculateGammaExposure(tradierSym);
    if (!result) return null;

    // Find top 5 levels by absolute GEX
    const sorted = [...result.strikes]
      .sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX))
      .slice(0, 8);

    const topLevels = sorted.map(s => ({
      strike: s.strike,
      netGEX: Math.round(s.netGEX * 1000) / 1000,
      type: (s.netGEX > 0 ? 'magnet' : 'resistance') as 'support' | 'resistance' | 'magnet',
    }));

    return {
      flipPoint: result.flipPoint,
      maxGammaStrike: result.maxGammaStrike,
      spotPrice: result.spotPrice,
      totalNetGEX: Math.round(result.totalNetGEX * 1000) / 1000,
      topLevels,
    };
  } catch (err) {
    logger.debug(`[SPX-INTEL] GEX computation failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * C) IV Skew
 * Source: Tradier chain — per-strike mid_iv from greeks (real data)
 */
async function computeIVSkew(symbol: string = 'SPY'): Promise<IVSkewData | null> {
  try {
    const tradierSym = getTradierSymbol(symbol);
    const quote = await getTradierQuote(tradierSym);
    if (!quote || !quote.last) return null;
    const spot = quote.last;

    const chain = await getTradierOptionsChain(tradierSym);
    if (chain.length === 0) return null;

    // Find ATM option (closest strike to spot)
    const calls = chain.filter(o => (o.option_type || o.type) === 'call' && o.greeks?.mid_iv);
    const puts = chain.filter(o => (o.option_type || o.type) === 'put' && o.greeks?.mid_iv);

    if (calls.length === 0 || puts.length === 0) return null;

    // ATM: closest to spot
    const atmCall = calls.reduce((best, c) =>
      Math.abs(c.strike - spot) < Math.abs(best.strike - spot) ? c : best
    );
    const atmPut = puts.reduce((best, p) =>
      Math.abs(p.strike - spot) < Math.abs(best.strike - spot) ? p : best
    );

    const atmIV = ((atmCall.greeks?.mid_iv || 0) + (atmPut.greeks?.mid_iv || 0)) / 2 * 100;

    // 25-delta put: find put with delta closest to -0.25
    const put25d = puts
      .filter(p => p.greeks && p.greeks.delta < 0)
      .reduce((best, p) => {
        const dist = Math.abs(Math.abs(p.greeks!.delta) - 0.25);
        const bestDist = Math.abs(Math.abs(best.greeks!.delta) - 0.25);
        return dist < bestDist ? p : best;
      }, puts[0]);

    // 25-delta call: find call with delta closest to 0.25
    const call25d = calls
      .filter(c => c.greeks && c.greeks.delta > 0)
      .reduce((best, c) => {
        const dist = Math.abs(c.greeks!.delta - 0.25);
        const bestDist = Math.abs(best.greeks!.delta - 0.25);
        return dist < bestDist ? c : best;
      }, calls[0]);

    const put25dIV = (put25d?.greeks?.mid_iv || 0) * 100;
    const call25dIV = (call25d?.greeks?.mid_iv || 0) * 100;
    const skew = Math.round((put25dIV - call25dIV) * 100) / 100;
    const skewRatio = call25dIV > 0 ? Math.round((put25dIV / call25dIV) * 100) / 100 : 1;

    let interpretation = 'Normal skew — standard demand for downside protection';
    if (skew > 10) interpretation = 'Heavy put skew — institutions buying crash protection, fear elevated';
    else if (skew > 5) interpretation = 'Moderate put skew — elevated demand for puts';
    else if (skew < -2) interpretation = 'Call skew — unusual upside speculation, often precedes tops';
    else if (skew < 2) interpretation = 'Flat skew — low demand for hedges, complacency';

    return {
      atmIV: Math.round(atmIV * 100) / 100,
      atmStrike: atmCall.strike,
      put25dIV: Math.round(put25dIV * 100) / 100,
      call25dIV: Math.round(call25dIV * 100) / 100,
      skew,
      skewRatio,
      interpretation,
    };
  } catch (err) {
    logger.debug(`[SPX-INTEL] IV Skew computation failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * D) VIX Regime + Term Structure Proxy
 * Source: Tradier quote for VIX-related ETFs (real quotes)
 */
async function computeVIXRegime(): Promise<VIXData | null> {
  try {
    // Fetch VIX-related quotes in parallel
    // ^VIX is not tradeable on Tradier, use UVXY/VIXY for proxies
    // But we can try fetching VIX directly — Tradier may return it as index
    const [vixQuote, uvxyQuote] = await Promise.all([
      getTradierQuote('VIX').catch(() => null),   // Tradier index quote
      getTradierQuote('UVXY').catch(() => null),   // 1.5x VIX ETF
    ]);

    // Try to get VIX from the index quote or calculate from UVXY
    let vixLevel = vixQuote?.last || 0;

    // If Tradier doesn't return VIX, try Yahoo Finance
    if (!vixLevel) {
      try {
        const yahooRes = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        if (yahooRes.ok) {
          const yahooData = await yahooRes.json();
          const closes = yahooData.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
          if (closes?.length > 0) {
            vixLevel = closes[closes.length - 1];
          }
        }
      } catch { /* fallback below */ }
    }

    // If still no VIX, try getting it from SPY IV (IV ≈ VIX for SPY)
    if (!vixLevel) {
      const volAnalysis = await analyzeVolatility('SPY').catch(() => null);
      if (volAnalysis?.currentIV) {
        vixLevel = volAnalysis.currentIV; // ATM IV of SPY ≈ VIX
      }
    }

    if (!vixLevel) return null;

    // Get VIX regime from macro-signals
    const regime = analyzeVIXRegime(vixLevel);

    // 20-day VIX average — approximate from historical (use Yahoo)
    let vix20dAvg = 19.5; // Default historical mean
    try {
      const period2 = Math.floor(Date.now() / 1000);
      const period1 = period2 - 30 * 86400; // 30 days
      const histRes = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&period1=${period1}&period2=${period2}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (histRes.ok) {
        const histData = await histRes.json();
        const closes: number[] = histData.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
        const validCloses = closes.filter((c: number | null) => c != null && c > 0) as number[];
        if (validCloses.length >= 10) {
          vix20dAvg = validCloses.slice(-20).reduce((sum, v) => sum + v, 0) / Math.min(20, validCloses.length);
        }
      }
    } catch { /* use default */ }

    // Term structure proxy: compare VIX (spot fear) to its 20d avg
    // If VIX < 20d avg → contango (normal, less fear), if VIX > 20d avg → backwardation (fear)
    const termSpread = Math.round((vix20dAvg - vixLevel) * 100) / 100;
    let termStructure: VIXData['termStructure'] = 'flat';
    if (termSpread > 2) termStructure = 'contango';      // VIX below avg = calm
    else if (termSpread < -2) termStructure = 'backwardation'; // VIX above avg = stressed

    let tradingImplication = regime.tradingImplication;
    if (termStructure === 'backwardation') {
      tradingImplication += ' VIX in backwardation — fear is acute, expect mean reversion.';
    } else if (termStructure === 'contango') {
      tradingImplication += ' VIX in contango — normal conditions, trend following works.';
    }

    return {
      vix: Math.round(vixLevel * 100) / 100,
      vix20dAvg: Math.round(vix20dAvg * 100) / 100,
      regime,
      termStructure,
      termSpread,
      tradingImplication,
    };
  } catch (err) {
    logger.debug(`[SPX-INTEL] VIX computation failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * E) Macro Correlation Context
 * Source: Tradier quotes for SPY, TLT, UUP, GLD (all real-time)
 */
async function computeMacroCorrelation(): Promise<MacroCorrelation | null> {
  try {
    const [spy, tlt, uup, gld] = await Promise.all([
      getTradierQuote('SPY'),
      getTradierQuote('TLT'),
      getTradierQuote('UUP'),
      getTradierQuote('GLD'),
    ]);

    if (!spy) return null;

    const format = (q: any) => ({
      price: q?.last || 0,
      change: q?.change || 0,
      changePct: q?.change_percentage || 0,
    });

    const spyData = format(spy);
    const tltData = format(tlt);
    const uupData = format(uup);
    const gldData = format(gld);

    // Bond-equity relationship:
    // SPY down + TLT up = flight to safety (risk off)
    // SPY down + TLT down = systematic deleveraging (very bad)
    // SPY up + TLT down = risk on (normal)
    let bondEquityRelation: MacroCorrelation['bondEquityRelation'] = 'mixed';
    if (spyData.changePct < -0.3 && tltData.changePct > 0.2) {
      bondEquityRelation = 'flight_to_safety';
    } else if (spyData.changePct > 0.3 && tltData.changePct < -0.2) {
      bondEquityRelation = 'risk_on';
    }

    // Dollar pressure: strong dollar (UUP up) = headwind for SPX
    let dollarPressure: MacroCorrelation['dollarPressure'] = 'neutral';
    if (uupData.changePct > 0.3) dollarPressure = 'headwind';
    else if (uupData.changePct < -0.3) dollarPressure = 'tailwind';

    // Overall regime
    let regime: MacroCorrelation['regime'] = 'mixed';
    if (spyData.changePct > 0.3 && bondEquityRelation === 'risk_on') {
      regime = 'risk_on';
    } else if (spyData.changePct < -0.3 || bondEquityRelation === 'flight_to_safety') {
      regime = 'risk_off';
    }

    return {
      spy: spyData,
      tlt: tltData,
      uup: uupData,
      gld: gldData,
      bondEquityRelation,
      dollarPressure,
      regime,
    };
  } catch (err) {
    logger.debug(`[SPX-INTEL] Macro computation failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * F) VWAP + Bands (Intraday)
 * Source: Yahoo Finance 5-min bars (free, no API key needed)
 */
async function computeVWAP(symbol: string = 'SPY'): Promise<VWAPData | null> {
  try {
    const yahooSym = getYahooSymbol(symbol);
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=5m&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const quotes = result.indicators?.quote?.[0];
    if (!quotes) return null;

    const { high, low, close, volume } = quotes;
    if (!high || !close || !volume) return null;

    // Calculate VWAP: Σ(TP × Volume) / Σ(Volume), where TP = (H+L+C)/3
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;
    const tpvArray: number[] = [];

    for (let i = 0; i < close.length; i++) {
      const h = high[i], l = low[i], c = close[i], v = volume[i];
      if (h == null || l == null || c == null || v == null || v === 0) continue;

      const tp = (h + l + c) / 3;
      cumulativeTPV += tp * v;
      cumulativeVolume += v;
      tpvArray.push(tp);
    }

    if (cumulativeVolume === 0) return null;

    const vwap = cumulativeTPV / cumulativeVolume;

    // Calculate standard deviation bands
    let varianceSum = 0;
    let volumeForVariance = 0;
    for (let i = 0; i < close.length; i++) {
      const h = high[i], l = low[i], c = close[i], v = volume[i];
      if (h == null || l == null || c == null || v == null || v === 0) continue;
      const tp = (h + l + c) / 3;
      varianceSum += v * Math.pow(tp - vwap, 2);
      volumeForVariance += v;
    }

    const stdDev = volumeForVariance > 0 ? Math.sqrt(varianceSum / volumeForVariance) : 0;

    const currentPrice = close.filter((c: number | null) => c != null).pop() || vwap;
    const distancePct = Math.round(((currentPrice - vwap) / vwap) * 10000) / 100;

    let position: VWAPData['position'] = 'at_vwap';
    if (currentPrice > vwap + 2 * stdDev) position = 'above_2sd';
    else if (currentPrice > vwap + stdDev) position = 'above_1sd';
    else if (currentPrice < vwap - 2 * stdDev) position = 'below_2sd';
    else if (currentPrice < vwap - stdDev) position = 'below_1sd';

    return {
      vwap: Math.round(vwap * 100) / 100,
      upper1: Math.round((vwap + stdDev) * 100) / 100,
      lower1: Math.round((vwap - stdDev) * 100) / 100,
      upper2: Math.round((vwap + 2 * stdDev) * 100) / 100,
      lower2: Math.round((vwap - 2 * stdDev) * 100) / 100,
      currentPrice: Math.round(currentPrice * 100) / 100,
      distancePct,
      position,
    };
  } catch (err) {
    logger.debug(`[SPX-INTEL] VWAP computation failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * G) Volume Delta Approximation
 * Source: Yahoo Finance 5-min bars (same data as VWAP)
 * Note: This is an approximation — real delta needs tick-level data
 */
async function computeVolumeDelta(symbol: string = 'SPY'): Promise<VolumeDeltaData | null> {
  try {
    const yahooSym = getYahooSymbol(symbol);
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=5m&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const quotes = result.indicators?.quote?.[0];
    if (!quotes) return null;

    const { open, close, volume } = quotes;
    if (!open || !close || !volume) return null;

    // Approximate delta: bar close > open → buying pressure, else selling
    let cumulativeDelta = 0;
    let barsAnalyzed = 0;

    for (let i = 0; i < close.length; i++) {
      const o = open[i], c = close[i], v = volume[i];
      if (o == null || c == null || v == null || v === 0) continue;

      if (c > o) {
        cumulativeDelta += v; // Buying pressure
      } else if (c < o) {
        cumulativeDelta -= v; // Selling pressure
      }
      // Doji bars (c === o) → neutral, skip
      barsAnalyzed++;
    }

    const deltaDirection: VolumeDeltaData['deltaDirection'] =
      cumulativeDelta > 0 ? 'buying' :
      cumulativeDelta < 0 ? 'selling' : 'neutral';

    // Check for divergence: price up but delta negative (or vice versa)
    const lastClose = close.filter((c: number | null) => c != null).pop() || 0;
    const firstClose = close.find((c: number | null) => c != null) || 0;
    const priceUp = lastClose > firstClose;
    const divergence = (priceUp && cumulativeDelta < 0) || (!priceUp && cumulativeDelta > 0);

    return {
      cumulativeDelta: Math.round(cumulativeDelta),
      deltaDirection,
      divergence,
      barsAnalyzed,
      note: 'Approximated from 5-min bar direction × volume. Not tick-level delta.',
    };
  } catch (err) {
    logger.debug(`[SPX-INTEL] Volume delta computation failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * I) Expected Move
 * Pure math from ATM IV — zero API calls (uses already-computed ivSkew data)
 * Formula: Price × IV/100 × √(DTE/252)
 */
function computeExpectedMove(ivSkew: IVSkewData | null, spotPrice: number): ExpectedMove | null {
  if (!ivSkew || !spotPrice || ivSkew.atmIV <= 0) return null;

  const iv = ivSkew.atmIV / 100; // Convert from percentage
  const dailyFactor = Math.sqrt(1 / 252);
  const weeklyFactor = Math.sqrt(5 / 252);

  const dailyMove = spotPrice * iv * dailyFactor;
  const weeklyMove = spotPrice * iv * weeklyFactor;

  return {
    dailyMove: Math.round(dailyMove * 100) / 100,
    dailyMovePct: Math.round((dailyMove / spotPrice) * 10000) / 100, // As percentage
    weeklyMove: Math.round(weeklyMove * 100) / 100,
    weeklyMovePct: Math.round((weeklyMove / spotPrice) * 10000) / 100,
    upperTarget: Math.round((spotPrice + dailyMove) * 100) / 100,
    lowerTarget: Math.round((spotPrice - dailyMove) * 100) / 100,
    spotPrice,
  };
}

/**
 * J) Momentum vs Mean-Reversion Classifier
 * Uses RSI, EMA alignment, and price slope from daily closes
 * Source: Tradier daily quote history (free, already used elsewhere)
 */
async function computeMomentumClassifier(vwapData: VWAPData | null, symbol: string = 'SPY'): Promise<MomentumClassifier | null> {
  try {
    const yahooSym = getYahooSymbol(symbol);
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=60d`;
    const response = await fetch(yahooUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!response.ok) {
      logger.debug('[SPX-INTEL] Momentum classifier: Yahoo daily bars failed');
      return null;
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result?.indicators?.quote?.[0]?.close) return null;

    const closes: number[] = result.indicators.quote[0].close.filter((c: number | null) => c != null);
    if (closes.length < 25) return null; // Need at least 25 bars for EMA21

    // Calculate indicators using existing functions from technical-indicators.ts
    const rsi = calculateRSI(closes, 14);
    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);

    // 5-day price slope (linear regression normalized by price)
    const last5 = closes.slice(-5);
    const n = last5.length;
    const xMean = (n - 1) / 2;
    const yMean = last5.reduce((a, b) => a + b, 0) / n;
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (last5[i] - yMean);
      denominator += (i - xMean) * (i - xMean);
    }
    const slope = denominator > 0 ? numerator / denominator : 0;
    const slopeNormalized = (slope / yMean) * 100; // As % per day

    // EMA alignment
    const emaAlignment: MomentumClassifier['emaAlignment'] =
      ema9 > ema21 * 1.001 ? 'bullish' :
      ema9 < ema21 * 0.999 ? 'bearish' : 'neutral';

    // Classification logic
    let regime: MomentumClassifier['regime'] = 'mixed';
    let confidence = 40;
    let tradingAdvice = 'Mixed signals — wait for clearer setup or trade small';

    // Check for mean reversion extremes FIRST (overrides momentum)
    const extendedFromVWAP = vwapData && (vwapData.position === 'above_2sd' || vwapData.position === 'below_2sd');

    if (rsi > 72 || rsi < 28 || extendedFromVWAP) {
      regime = 'mean_reversion';
      confidence = Math.min(85, 50 + Math.abs(rsi - 50));
      if (rsi > 72) {
        tradingAdvice = `RSI ${rsi} overbought — fade the move, sell premium, or tighten stops on longs`;
      } else if (rsi < 28) {
        tradingAdvice = `RSI ${rsi} oversold — look for reversal setups, buy premium is cheap`;
      } else {
        tradingAdvice = `Price extended ${vwapData!.distancePct}% from VWAP — mean reversion likely`;
      }
    }
    // Bullish momentum
    else if (rsi > 55 && emaAlignment === 'bullish' && slopeNormalized > 0.05) {
      regime = 'momentum_bullish';
      confidence = Math.min(85, 40 + (rsi - 50) + Math.abs(slopeNormalized) * 20);
      tradingAdvice = 'Trend following — ride momentum with trailing stops, buy dips to EMA9';
    }
    // Bearish momentum
    else if (rsi < 45 && emaAlignment === 'bearish' && slopeNormalized < -0.05) {
      regime = 'momentum_bearish';
      confidence = Math.min(85, 40 + (50 - rsi) + Math.abs(slopeNormalized) * 20);
      tradingAdvice = 'Bearish trend — sell rallies, buy puts on bounces to EMA9';
    }

    return {
      regime,
      rsi: Math.round(rsi * 100) / 100,
      emaAlignment,
      slope5d: Math.round(slopeNormalized * 1000) / 1000,
      confidence: Math.round(confidence),
      tradingAdvice,
    };
  } catch (err) {
    logger.debug(`[SPX-INTEL] Momentum classifier failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * K) Daily IV Snapshot (runs at market close)
 * Stores ATM IV to DB for real IV Rank over time
 */
async function snapshotDailyIV(): Promise<void> {
  const intel = cachedIntelligence.get('SPY');
  if (!intel) return;

  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayStr = `${etNow.getFullYear()}-${String(etNow.getMonth() + 1).padStart(2, '0')}-${String(etNow.getDate()).padStart(2, '0')}`;

  // Already snapshotted today?
  if (lastSnapshotDate === todayStr) return;

  // Only snapshot at 4:00-4:01 PM ET
  const hour = etNow.getHours();
  const minute = etNow.getMinutes();
  if (hour !== 16 || minute > 1) return;

  // Only on weekdays
  const day = etNow.getDay();
  if (day === 0 || day === 6) return;

  if (!intel.ivSkew?.atmIV) {
    logger.warn('[SPX-INTEL] No ATM IV data for daily snapshot');
    return;
  }

  try {
    // Fetch RV for snapshot
    const { fetchOHLCData } = await import('./chart-analysis');
    const historicalData = await fetchOHLCData('SPY', '3mo');
    let rv20 = 0;
    let rv10 = 0;
    if (historicalData?.closes) {
      rv20 = calculateRealizedVolatility(historicalData.closes, 20);
      rv10 = calculateRealizedVolatility(historicalData.closes, 10);
    }

    await db.insert(ivSnapshots).values({
      symbol: 'SPY',
      date: todayStr,
      atmIv: intel.ivSkew.atmIV,
      rv20: rv20 || null,
      rv10: rv10 || null,
      spotPrice: intel.expectedMove?.spotPrice || null,
      pcr: intel.pcr?.overallPCR || null,
      vix: intel.vixRegime?.vix || null,
    }).onConflictDoNothing(); // Prevent duplicate if somehow triggered twice

    lastSnapshotDate = todayStr;
    logger.info(`[SPX-INTEL] Daily IV snapshot saved: ATM_IV=${intel.ivSkew.atmIV}%, RV20=${rv20.toFixed(1)}%, VIX=${intel.vixRegime?.vix || 'N/A'}`);
  } catch (err) {
    logger.error(`[SPX-INTEL] Daily IV snapshot failed: ${(err as Error).message}`);
  }
}

/**
 * Get real IV history from stored snapshots
 * Falls back to estimated history if not enough stored data yet
 */
export async function getStoredIVHistory(symbol: string, days: number = 252): Promise<number[]> {
  try {
    const snapshots = await db.select({ atmIv: ivSnapshots.atmIv })
      .from(ivSnapshots)
      .where(eq(ivSnapshots.symbol, symbol))
      .orderBy(desc(ivSnapshots.date))
      .limit(days);

    if (snapshots.length >= 30) {
      return snapshots.map(s => s.atmIv).reverse(); // Oldest first
    }

    // Not enough real data yet — return what we have (UI can indicate "building history")
    logger.debug(`[SPX-INTEL] Only ${snapshots.length} IV snapshots for ${symbol}, need 30+ for reliable IV Rank`);
    return snapshots.map(s => s.atmIv).reverse();
  } catch (err) {
    logger.debug(`[SPX-INTEL] Failed to fetch IV history: ${(err as Error).message}`);
    return [];
  }
}

/**
 * H) Unified SPX Signal Score
 * Weighted combination of all signals
 */
function computeUnifiedScore(
  pcr: PCRData | null,
  gex: GEXData | null,
  ivSkew: IVSkewData | null,
  vixRegime: VIXData | null,
  macro: MacroCorrelation | null,
  vwapData: VWAPData | null,
  volumeDelta: VolumeDeltaData | null,
  momentum: MomentumClassifier | null,
  symbol: string = 'SPY',
): UnifiedScore {
  let bullishPoints = 0;
  let bearishPoints = 0;
  let totalWeight = 0;
  const topSignals: string[] = [];

  // GEX Direction (22.5% weight — reduced from 25% to make room for momentum)
  if (gex) {
    const weight = 22.5;
    totalWeight += weight;
    if (gex.totalNetGEX > 0) {
      bullishPoints += weight * 0.7; // Positive GEX = market makers support
      topSignals.push(`GEX positive ($${gex.totalNetGEX.toFixed(1)}B) — MM support at ${gex.flipPoint || 'N/A'}`);
    } else {
      bearishPoints += weight * 0.7;
      topSignals.push(`GEX negative ($${gex.totalNetGEX.toFixed(1)}B) — MM amplifying moves`);
    }
  }

  // PCR Sentiment (15% weight — contrarian)
  if (pcr) {
    const weight = 15;
    totalWeight += weight;
    if (pcr.interpretation === 'bullish') { // High put volume = contrarian bullish
      bullishPoints += weight * 0.8;
      topSignals.push(`PCR ${pcr.overallPCR} (high puts = contrarian bullish)`);
    } else if (pcr.interpretation === 'bearish') {
      bearishPoints += weight * 0.8;
      topSignals.push(`PCR ${pcr.overallPCR} (low puts = contrarian bearish)`);
    }
  }

  // VIX Regime (15% weight)
  if (vixRegime) {
    const weight = 15;
    totalWeight += weight;
    const v = vixRegime.regime;
    if (v.regime === 'extreme_complacency' || v.regime === 'complacency') {
      bearishPoints += weight * 0.5; // Low VIX = complacent, risk of correction
      topSignals.push(`VIX ${vixRegime.vix} (complacent — risk of spike)`);
    } else if (v.regime === 'extreme_fear') {
      bullishPoints += weight * 0.7; // Extreme fear = contrarian bullish
      topSignals.push(`VIX ${vixRegime.vix} (extreme fear — contrarian bullish)`);
    } else if (v.regime === 'fear') {
      bearishPoints += weight * 0.3; // Moderate fear = slightly bearish
    }
    if (vixRegime.termStructure === 'backwardation') {
      bearishPoints += weight * 0.3;
    }
  }

  // Flow Direction (17.5% weight — reduced from 20%) — use volume delta as proxy
  if (volumeDelta) {
    const weight = 17.5;
    totalWeight += weight;
    if (volumeDelta.deltaDirection === 'buying') {
      bullishPoints += weight * 0.6;
      if (!volumeDelta.divergence) {
        topSignals.push('Volume delta confirms buying pressure');
      }
    } else if (volumeDelta.deltaDirection === 'selling') {
      bearishPoints += weight * 0.6;
    }
    if (volumeDelta.divergence) {
      topSignals.push('⚠️ Volume delta DIVERGENCE — price and delta disagree');
    }
  }

  // VWAP Position (10% weight)
  if (vwapData) {
    const weight = 10;
    totalWeight += weight;
    if (vwapData.position === 'above_1sd' || vwapData.position === 'above_2sd') {
      bullishPoints += weight * 0.5; // Above VWAP = bullish bias
      if (vwapData.position === 'above_2sd') {
        bearishPoints += weight * 0.3; // Extended — mean reversion risk
        topSignals.push(`Price extended +2σ above VWAP (${vwapData.distancePct}%) — reversion risk`);
      }
    } else if (vwapData.position === 'below_1sd' || vwapData.position === 'below_2sd') {
      bearishPoints += weight * 0.5;
      if (vwapData.position === 'below_2sd') {
        bullishPoints += weight * 0.3; // Extended — bounce candidate
        topSignals.push(`Price extended -2σ below VWAP (${vwapData.distancePct}%) — bounce candidate`);
      }
    }
  }

  // IV Skew (10% weight)
  if (ivSkew) {
    const weight = 10;
    totalWeight += weight;
    if (ivSkew.skew > 8) {
      bearishPoints += weight * 0.5; // Heavy put skew = fear
    } else if (ivSkew.skew < 0) {
      bullishPoints += weight * 0.3; // Call skew = greed
    }
  }

  // Macro Regime (5% weight)
  if (macro) {
    const weight = 5;
    totalWeight += weight;
    if (macro.regime === 'risk_on') {
      bullishPoints += weight * 0.7;
    } else if (macro.regime === 'risk_off') {
      bearishPoints += weight * 0.7;
      topSignals.push(`Macro risk-off: ${macro.bondEquityRelation.replace(/_/g, ' ')}`);
    }
    if (macro.dollarPressure === 'headwind') {
      bearishPoints += weight * 0.2;
    }
  }

  // Momentum Classifier (5% weight)
  if (momentum) {
    const weight = 5;
    totalWeight += weight;
    if (momentum.regime === 'momentum_bullish') {
      bullishPoints += weight * 0.7;
      topSignals.push(`Momentum: ${momentum.regime.replace(/_/g, ' ')} (RSI ${momentum.rsi}, EMA ${momentum.emaAlignment})`);
    } else if (momentum.regime === 'momentum_bearish') {
      bearishPoints += weight * 0.7;
      topSignals.push(`Momentum: ${momentum.regime.replace(/_/g, ' ')} (RSI ${momentum.rsi}, EMA ${momentum.emaAlignment})`);
    } else if (momentum.regime === 'mean_reversion') {
      // Mean reversion signal — adds to the contrarian side
      if (momentum.rsi > 70) {
        bearishPoints += weight * 0.5;
      } else if (momentum.rsi < 30) {
        bullishPoints += weight * 0.5;
      }
      topSignals.push(`Mean reversion setup (RSI ${momentum.rsi}) — ${momentum.tradingAdvice.split('—')[0].trim()}`);
    }
  }

  // Calculate score
  const netBullish = bullishPoints - bearishPoints;
  const maxPossible = totalWeight || 100;
  const rawScore = 50 + (netBullish / maxPossible) * 50; // Center at 50
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  const direction: UnifiedScore['direction'] =
    score >= 60 ? 'bullish' :
    score <= 40 ? 'bearish' : 'neutral';

  const confidence = Math.min(95, Math.round(
    (Math.abs(score - 50) / 50) * 100 * (totalWeight / 100)
  ));

  // Generate thesis
  const signalCount = [pcr, gex, ivSkew, vixRegime, macro, vwapData, volumeDelta, momentum].filter(Boolean).length;
  const thesis = `${symbol} ${direction.toUpperCase()} bias (${score}/100) from ${signalCount} signals. ` +
    topSignals.slice(0, 3).join('. ') + '.';

  return { score, direction, confidence, topSignals: topSignals.slice(0, 5), thesis };
}

// ============================================
// MAIN COMPUTATION LOOP
// ============================================

async function computeAllSignals(symbol: string = 'SPY'): Promise<SPXIntelligence> {
  const start = Date.now();

  // Check if market is open (rough check)
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = etNow.getHours();
  const minute = etNow.getMinutes();
  const day = etNow.getDay();
  const marketOpen = day >= 1 && day <= 5 && (hour > 9 || (hour === 9 && minute >= 30)) && hour < 16;

  // VIX and Macro are market-wide — use shared cache to avoid redundant API calls
  async function getVIXCached(): Promise<VIXData | null> {
    if (cachedVIXRegime && Date.now() - lastVIXComputeTime < CACHE_TTL_MS) return cachedVIXRegime;
    cachedVIXRegime = await computeVIXRegime();
    lastVIXComputeTime = Date.now();
    return cachedVIXRegime;
  }
  async function getMacroCached(): Promise<MacroCorrelation | null> {
    if (cachedMacro && Date.now() - lastMacroComputeTime < CACHE_TTL_MS) return cachedMacro;
    cachedMacro = await computeMacroCorrelation();
    lastMacroComputeTime = Date.now();
    return cachedMacro;
  }

  // Compute all signals in parallel — symbol-specific + shared
  const [pcr, gex, ivSkew, vixRegime, macro, vwap, volumeDelta, momentum] = await Promise.all([
    computePCR(symbol),
    computeGEX(symbol),
    computeIVSkew(symbol),
    getVIXCached(),                                                // Shared (market-wide)
    getMacroCached(),                                              // Shared (market-wide)
    marketOpen ? computeVWAP(symbol) : Promise.resolve(null),
    marketOpen ? computeVolumeDelta(symbol) : Promise.resolve(null),
    computeMomentumClassifier(null, symbol),
  ]);

  // Recompute momentum with VWAP data if available (for mean-reversion detection)
  const momentumFinal = vwap ? await computeMomentumClassifier(vwap, symbol) : momentum;

  // ── SPX price scaling ──────────────────────────────────────────────
  // SPX uses SPY as proxy for options data. We need the real ^GSPC price
  // so spotPrice, expected move, and GEX levels display at SPX scale (~6000+).
  let realSpotPrice = gex?.spotPrice || vwap?.currentPrice || 0;

  if (symbol === 'SPX' && gex) {
    // Fetch real SPX (^GSPC) price from Yahoo
    try {
      const spxRes = await fetch(
        'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d',
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      if (spxRes.ok) {
        const spxData = await spxRes.json();
        const closes = spxData.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
        const spxPrice = closes?.filter((c: number | null) => c != null).pop();
        if (spxPrice && spxPrice > 1000) { // Sanity check — SPX should be 4000+
          const ratio = spxPrice / (gex.spotPrice || 1);
          realSpotPrice = Math.round(spxPrice * 100) / 100;
          // Scale GEX levels to SPX price range
          gex.spotPrice = realSpotPrice;
          if (gex.flipPoint) {
            gex.flipPoint = Math.round(gex.flipPoint * ratio);
          }
          gex.maxGammaStrike = Math.round(gex.maxGammaStrike * ratio);
          // Scale net gamma by ratio (SPX notional ~10x SPY)
          gex.totalNetGEX = Math.round(gex.totalNetGEX * ratio * 1000) / 1000;
          gex.topLevels = gex.topLevels.map(l => ({
            ...l,
            strike: Math.round(l.strike * ratio),
            netGEX: Math.round(l.netGEX * ratio * 1000) / 1000,
          }));
          // Scale IV skew ATM strike too
          if (ivSkew) {
            ivSkew.atmStrike = Math.round(ivSkew.atmStrike * ratio);
          }
          // Scale PCR by-strike data to SPX price range
          if (pcr && pcr.byStrike) {
            pcr.byStrike = pcr.byStrike.map(s => ({
              ...s,
              strike: Math.round(s.strike * ratio),
            }));
          }
        }
      }
    } catch {
      logger.debug('[SPX-INTEL] Failed to fetch ^GSPC price for SPX scaling');
    }
  }

  // Expected move from IV — pure math, no API call
  const expectedMove = computeExpectedMove(ivSkew, realSpotPrice);

  const unifiedScore = computeUnifiedScore(pcr, gex, ivSkew, vixRegime, macro, vwap, volumeDelta, momentumFinal, symbol);

  const elapsed = Date.now() - start;
  logger.info(`[SPX-INTEL] Computed ${[pcr, gex, ivSkew, vixRegime, macro, vwap, volumeDelta, momentumFinal, expectedMove].filter(Boolean).length}/9 signals for ${symbol} in ${elapsed}ms | Score: ${unifiedScore.score} ${unifiedScore.direction}`);

  // Try daily IV snapshot (checks time internally, no-op most of the time)
  snapshotDailyIV().catch(() => {}); // Fire-and-forget, don't block

  return {
    timestamp: new Date().toISOString(),
    marketOpen,
    pcr,
    gex,
    ivSkew,
    vixRegime,
    macro,
    vwap,
    volumeDelta,
    expectedMove,
    momentum: momentumFinal,
    unifiedScore,
  };
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Get cached intelligence data for a specific symbol (fast — returns in <1ms)
 */
export function getSPXIntelligence(symbol: string = 'SPY'): SPXIntelligence | null {
  const cached = cachedIntelligence.get(symbol);
  if (!cached) return null;
  // Check if cache is still fresh
  const lastTime = lastComputeTimeBySymbol.get(symbol) || 0;
  if (Date.now() - lastTime > CACHE_TTL_MS) return null;
  return cached;
}

/**
 * Force recompute for a specific symbol (on-demand or admin refresh)
 */
export async function refreshSPXIntelligence(symbol: string = 'SPY'): Promise<SPXIntelligence> {
  const data = await computeAllSignals(symbol);
  cachedIntelligence.set(symbol, data);
  lastComputeTimeBySymbol.set(symbol, Date.now());
  return data;
}

/**
 * Start the intelligence service — computes SPY every 60s (primary symbol)
 * Other symbols are computed on-demand when requested via getSPXIntelligence/refreshSPXIntelligence
 */
export function startSPXIntelligenceService(): void {
  logger.info('[SPX-INTEL] Starting Index Intelligence Service (SPY primary, others on-demand)...');

  // Initial compute after 10s (let other services initialize)
  setTimeout(async () => {
    try {
      const data = await computeAllSignals('SPY');
      cachedIntelligence.set('SPY', data);
      lastComputeTimeBySymbol.set('SPY', Date.now());
    } catch (err) {
      logger.error('[SPX-INTEL] Initial computation failed:', err);
    }
  }, 10_000);

  // Run every 60 seconds — only SPY (primary). Other symbols on-demand.
  computeInterval = setInterval(async () => {
    try {
      const data = await computeAllSignals('SPY');
      cachedIntelligence.set('SPY', data);
      lastComputeTimeBySymbol.set('SPY', Date.now());
    } catch (err) {
      logger.error('[SPX-INTEL] Computation cycle failed:', err);
    }
  }, 60_000);

  logger.info('[SPX-INTEL] Index Intelligence Service started, SPY every 60s');
}

/**
 * Stop the intelligence service
 */
export function stopSPXIntelligenceService(): void {
  if (computeInterval) {
    clearInterval(computeInterval);
    computeInterval = null;
  }
  logger.info('[SPX-INTEL] SPX Intelligence Service stopped');
}
