/**
 * GEX/VEX Confluence Scanner
 * ==========================
 * Scans the approved watchlist for high-confluence gamma + vanna setups.
 * Uses calculateAggregateGammaExposure for reliable GEX data (Tradier → Yahoo fallback).
 *
 * Confluence scoring (0-100):
 *   - flipProximity (0-25): how close spot is to the gamma flip
 *   - wallSetup    (0-25): clean call/put wall bracketing spot
 *   - vexAlignment (0-20): vanna direction supports thesis
 *   - liquidity    (0-15): OI concentration on key strikes
 *   - regime       (0-15): positive-gamma pin or negative-gamma volatility
 */

import { logger } from './logger';
import { storage } from './storage';
import { calculateAggregateGammaExposure } from './gamma-exposure';
import { getTradierQuote } from './tradier-api';
import { getChartLastPrice, safeQuote, getBestPrice } from './yahoo-finance-service';
import { enrichOptionIdea } from './options-enricher';
import type { AITradeIdea } from './ai-service';
import {
  APPROVED_TICKERS,
  S_TIER,
  A_TIER,
  INDEX_TICKERS,
  SECONDARY,
  SMALL_ACCOUNT_TIER,
  getTier,
  getSector,
  SECTOR_LABELS,
  type Sector,
} from '../shared/approved-tickers';
import {
  ConfluenceRow,
  ConfluenceBreakdown,
  ConfluenceScanResult,
  GEXSnapshot,
  GEXLevel,
  GEXHubData,
  HubLeaderRow,
  SectorAggregate,
  RegimeDistribution,
  TopPlay,
  type VEXSignal,
  scoreToTier,
} from '../shared/gex-types';

// ─── Cache ──────────────────────────────────────────────────
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min (larger universe)
let cachedResult: { data: ConfluenceScanResult; expiresAt: number } | null = null;
// Dedupe concurrent scans: a 132-ticker scan must never run more than once at a time,
// no matter how many page loads or background refreshes fire simultaneously.
let scanInFlight: Promise<ConfluenceScanResult> | null = null;

// ─── Market Session Detection ──────────────────────────────
export type MarketSession = 'pre_market' | 'open' | 'after_hours' | 'overnight';

export function getMarketSession(): MarketSession {
  const now = new Date();
  // Convert to ET (UTC-4 EDT / UTC-5 EST) — approximate
  const utcH = now.getUTCHours();
  const utcM = now.getUTCMinutes();
  const etH = (utcH - 4 + 24) % 24; // EDT approximation
  const etMin = etH * 60 + utcM;

  const isWeekend = now.getUTCDay() === 0 || now.getUTCDay() === 6;
  if (isWeekend) return 'overnight';

  if (etMin >= 570 && etMin < 960) return 'open';        // 9:30 AM - 4:00 PM ET
  if (etMin >= 240 && etMin < 570) return 'pre_market';   // 4:00 AM - 9:30 AM ET
  if (etMin >= 960 && etMin < 1200) return 'after_hours'; // 4:00 PM - 8:00 PM ET
  return 'overnight';                                      // 8:00 PM - 4:00 AM ET
}

// ─── Futures Proxy — ES/NQ/YM for off-hours context ────────
export interface FuturesSnapshot {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  fetchedAt: number;
}

const FUTURES_SYMBOLS = [
  { yahoo: 'ES=F', name: 'S&P 500 Futures', equity: 'SPY' },
  { yahoo: 'NQ=F', name: 'Nasdaq Futures', equity: 'QQQ' },
  { yahoo: 'YM=F', name: 'Dow Futures', equity: 'DIA' },
  { yahoo: 'RTY=F', name: 'Russell 2000 Futures', equity: 'IWM' },
  { yahoo: 'VX=F', name: 'VIX Futures', equity: 'VIX' },
];

let futuresCache: { data: FuturesSnapshot[]; expiresAt: number } | null = null;
const FUTURES_CACHE_TTL = 2 * 60 * 1000; // 2 min — fresher than GEX

export async function getFuturesSnapshot(): Promise<FuturesSnapshot[]> {
  if (futuresCache && Date.now() < futuresCache.expiresAt) {
    return futuresCache.data;
  }

  const results: FuturesSnapshot[] = [];

  // Use Yahoo chart API directly — more reliable for futures symbols than yahoo-finance2 library
  await Promise.all(FUTURES_SYMBOLS.map(async (f) => {
    try {
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(f.yahoo)}?interval=1m&range=1d&includePrePost=true`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) return;

      const price = meta.regularMarketPrice || 0;
      const prev = meta.chartPreviousClose || meta.previousClose || price;
      if (price <= 0) return;

      const change = price - prev;
      results.push({
        symbol: f.yahoo,
        name: f.name,
        price,
        change,
        changePct: prev > 0 ? (change / prev) * 100 : 0,
        fetchedAt: Date.now(),
      });
    } catch (e: any) {
      logger.debug(`[FUTURES] Failed to fetch ${f.yahoo}: ${e.message}`);
    }
  }));

  if (results.length > 0) {
    futuresCache = { data: results, expiresAt: Date.now() + FUTURES_CACHE_TTL };
  }
  logger.info(`[FUTURES] Fetched ${results.length}/${FUTURES_SYMBOLS.length} futures quotes`);
  return results;
}

// ─── Quote Helper ──────────────────────────────────────────
async function getQuoteWithChange(symbol: string): Promise<{ price: number; change: number; changePct: number } | null> {
  try {
    // Try Tradier first
    const tradier = await getTradierQuote(symbol);
    if (tradier?.last && tradier?.prevclose) {
      const change = tradier.last - tradier.prevclose;
      return {
        price: tradier.last,
        change,
        changePct: (change / tradier.prevclose) * 100,
      };
    }

    // Yahoo fallback
    const yq = await safeQuote(symbol);
    const price = getBestPrice(yq);
    if (price > 0) {
      const prev = (yq as any)?.regularMarketPreviousClose || price;
      const change = price - prev;
      return {
        price,
        change,
        changePct: prev > 0 ? (change / prev) * 100 : 0,
      };
    }

    // Last resort — chart candle
    const chart = await getChartLastPrice(symbol);
    if (chart > 0) {
      return { price: chart, change: 0, changePct: 0 };
    }

    return null;
  } catch (e: any) {
    logger.warn(`[GEX-SCAN] Quote failed for ${symbol}: ${e.message}`);
    return null;
  }
}

// ─── Convert gamma-exposure result → GEXSnapshot ──────────
import { bucketizeMatrix, dealerFlowFromTotalGEX } from './gex-dte-buckets';

export function toSnapshot(result: NonNullable<Awaited<ReturnType<typeof calculateAggregateGammaExposure>>>): GEXSnapshot {
  const {
    symbol,
    spotPrice,
    totalNetGEX,
    flipPoint,
    maxGammaStrike,
    strikes,
    totalVEX,
    callGEX: callGexExtra,
    putGEX: putGexExtra,
    putCallGEXRatio,
    callWall: callWallExtra,
    putWall: putWallExtra,
    zeroGammaProjection: projExtra,
    regime: regimeExtra,
    dataSource,
    dataQuality,
  } = result;

  // Prefer the real values from the unified aggregator; fall back to derivation if missing.
  const callGEX =
    callGexExtra ?? strikes.reduce((sum, s) => sum + (s.callGEX > 0 ? s.callGEX : 0), 0);
  const putGEX =
    putGexExtra ??
    Math.abs(strikes.reduce((sum, s) => sum + (s.putGEX < 0 ? s.putGEX : 0), 0));
  const pcr = putCallGEXRatio ?? (callGEX > 0 ? putGEX / callGEX : 0);
  const totalAbsGEX = strikes.reduce((sum, s) => sum + Math.abs(s.netGEX), 0);

  const callWall =
    callWallExtra ??
    strikes
      .filter((s) => s.strike > spotPrice && s.netGEX > 0)
      .sort((a, b) => b.netGEX - a.netGEX)[0]?.strike ??
    null;

  const putWall =
    putWallExtra ??
    strikes
      .filter((s) => s.strike < spotPrice && s.netGEX < 0)
      .sort((a, b) => a.netGEX - b.netGEX)[0]?.strike ??
    null;

  const zeroGammaProjection = projExtra ?? (totalNetGEX > 0 ? maxGammaStrike : flipPoint);

  // Build level list with roles — now includes real VEX
  const levels: GEXLevel[] = strikes
    .filter((s) => Math.abs(s.netGEX) > 0 || Math.abs(s.netVEX || 0) > 0)
    .map((s) => {
      let role: GEXLevel['role'] = 'neutral';
      if (s.strike === maxGammaStrike) role = 'max_gamma';
      else if (s.strike === callWall) role = 'call_wall';
      else if (s.strike === putWall) role = 'put_wall';
      else if (s.strike === flipPoint) role = 'flip';
      else if (s.netGEX > 0 && s.strike > spotPrice) role = 'resistance';
      else if (s.netGEX < 0 && s.strike < spotPrice) role = 'support';

      return {
        strike: s.strike,
        gex: s.netGEX,
        callGex: s.callGEX,
        putGex: s.putGEX,
        vex: s.netVEX ?? 0,
        gammaPct: totalAbsGEX > 0 ? Math.abs(s.netGEX) / totalAbsGEX : 0,
        openInterest: s.callOI + s.putOI,
        role,
        distancePct: spotPrice > 0 ? ((s.strike - spotPrice) / spotPrice) * 100 : 0,
      };
    })
    .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex))
    .slice(0, 20);

  const regime: GEXSnapshot['regime'] =
    regimeExtra ??
    (totalNetGEX > 0.5
      ? 'positive_gamma'
      : totalNetGEX < -0.5
        ? 'negative_gamma'
        : Math.abs(totalNetGEX) < 0.2
          ? 'neutral'
          : 'transitioning');

  // P0: per-DTE buckets + dealer-flow per 1% move
  const matrix = (result as any).strikeExpiryMatrix as Array<{ strike: number; dte: number; netGEX: number }> | undefined;
  const byDte = matrix && matrix.length > 0 ? bucketizeMatrix(matrix, spotPrice) : undefined;
  const dealerFlowPer1Pct = dealerFlowFromTotalGEX(totalNetGEX);

  return {
    symbol,
    spotPrice,
    calculatedAt: Date.now(),
    totalGEX: totalNetGEX,
    totalVEX: totalVEX ?? 0,
    callGEX,
    putGEX,
    putCallRatio: pcr,
    gammaFlipPrice: flipPoint,
    maxGammaStrike,
    callWall,
    putWall,
    zeroGammaProjection,
    levels,
    regime,
    volatilityRegime: 'normal',
    source: (dataSource as GEXSnapshot['source']) || 'mixed',
    expirationsUsed: [],
    dataQuality,
    dealerFlowPer1Pct,
    byDte,
  };
}

// ─── Confluence Scoring ────────────────────────────────────
function scoreConfluence(snap: GEXSnapshot): ConfluenceBreakdown {
  const { spotPrice, callWall, putWall, levels, totalGEX, regime } = snap;

  // The displayed flip is currently a cumulative-by-strike crossing, not a true
  // zero-gamma spot sweep. Keep it as an estimated chart reference, but do not let
  // proximity to that estimate manufacture up to 25 ranking points.
  const flipProximity = 0;

  // 2. Wall setup (0-25) — reward clean bracket around spot
  let wallSetup = 0;
  if (callWall && putWall) {
    const bracket = (callWall - putWall) / spotPrice;
    // Tight (2-5%) = best
    if (bracket >= 0.02 && bracket <= 0.06) wallSetup = 25;
    else if (bracket < 0.02) wallSetup = 18; // very tight — squeeze
    else if (bracket <= 0.1) wallSetup = 15;
    else wallSetup = 8;
  } else if (callWall || putWall) {
    wallSetup = 10; // one-sided
  }

  // 3. VEX alignment (0-20) — uses REAL vanna from options-exposures
  //    Positive VEX + positive gamma → vol tailwind, dealers add thrust (good long)
  //    Negative VEX + negative gamma → vol headwind, break plays favored
  //    Divergent VEX/GEX signs → transitioning, lower confidence
  const totalVEX = snap.totalVEX || 0;
  let vexAlignment = 0;
  const gexSign = Math.sign(totalGEX);
  const vexSign = Math.sign(totalVEX);
  const vexMag = Math.min(1, Math.abs(totalVEX) / 500); // $500M+ = full magnitude (VEX is in $M)

  if (gexSign !== 0 && vexSign !== 0 && gexSign === vexSign) {
    // Aligned — best case
    vexAlignment = Math.round(12 + 8 * vexMag); // 12-20
  } else if (gexSign !== 0 && vexSign !== 0 && gexSign !== vexSign) {
    // Divergent — expect chop / transition
    vexAlignment = Math.round(6 + 6 * vexMag); // 6-12
  } else if (regime === 'negative_gamma') {
    vexAlignment = 14; // vol regime = opportunity even without vanna signal
  } else if (regime === 'transitioning') {
    vexAlignment = 10;
  } else {
    vexAlignment = 6;
  }

  // 4. Liquidity (0-15) — top-3 levels OI weight
  const top3OI = levels.slice(0, 3).reduce((sum, l) => sum + l.openInterest, 0);
  let liquidity = 0;
  if (top3OI > 20000) liquidity = 15;
  else if (top3OI > 8000) liquidity = 12;
  else if (top3OI > 3000) liquidity = 8;
  else if (top3OI > 500) liquidity = 4;

  // 5. Regime (0-15) — reward strong regimes
  let regimeScore = 0;
  if (regime === 'negative_gamma') regimeScore = 15; // volatility plays
  else if (regime === 'positive_gamma') regimeScore = 12; // pin plays
  else if (regime === 'transitioning') regimeScore = 10;
  else regimeScore = 5;

  return {
    flipProximity: Math.round(flipProximity),
    wallSetup: Math.round(wallSetup),
    vexAlignment: Math.round(vexAlignment),
    liquidity: Math.round(liquidity),
    regime: Math.round(regimeScore),
  };
}

function deriveBias(snap: GEXSnapshot): {
  bias: 'long' | 'short' | 'neutral';
  target: number | null;
  stop: number | null;
  rr: number | null;
} {
  const { spotPrice, callWall, putWall, regime, zeroGammaProjection, maxGammaStrike, totalVEX } = snap;

  let bias: 'long' | 'short' | 'neutral' = 'neutral';
  let target: number | null = null;
  let stop: number | null = null;

  if (regime === 'positive_gamma') {
    // Positive gamma → dealers DAMPEN moves → price PINS near max gamma / projection.
    // Target is the magnet (max gamma or projection), NOT the distant wall.
    const magnet = zeroGammaProjection || maxGammaStrike;
    if (magnet && magnet > 0) {
      const distPct = ((magnet - spotPrice) / spotPrice) * 100;
      if (distPct > 0.15) {
        bias = 'long';
        target = magnet;
        stop = putWall || spotPrice * 0.985;
      } else if (distPct < -0.15) {
        bias = 'short';
        target = magnet;
        stop = callWall || spotPrice * 1.015;
      } else {
        // Within 0.15% of magnet → pinned, neutral
        bias = 'neutral';
        target = magnet;
      }
    }
  } else if (regime === 'negative_gamma') {
    // Negative gamma → dealers AMPLIFY moves → price trends toward nearest wall.
    if (callWall && putWall) {
      const distCall = Math.abs(callWall - spotPrice);
      const distPut = Math.abs(spotPrice - putWall);
      if (distCall < distPut) {
        bias = 'long';
        target = callWall;
        stop = spotPrice - (callWall - spotPrice) * 0.4; // tighter stop in neg gamma
      } else {
        bias = 'short';
        target = putWall;
        stop = spotPrice + (spotPrice - putWall) * 0.4;
      }
    }
  } else if (regime === 'transitioning') {
    // Transitioning → approaching flip, momentum matters
    // If positive VEX, lean long (vanna supports). If negative, lean toward nearest wall.
    if (totalVEX > 0 && callWall) {
      bias = 'long';
      target = callWall;
      stop = putWall || spotPrice * 0.98;
    } else if (totalVEX < 0 && putWall && callWall) {
      const distCall = Math.abs(callWall - spotPrice);
      const distPut = Math.abs(spotPrice - putWall);
      bias = distCall < distPut ? 'long' : 'short';
      target = bias === 'long' ? callWall : putWall;
      stop = bias === 'long' ? putWall : callWall;
    }
  }

  let rr: number | null = null;
  if (target && stop && bias !== 'neutral') {
    const reward = Math.abs(target - spotPrice);
    const risk = Math.abs(stop - spotPrice);
    rr = risk > 0 ? reward / risk : null;
  }

  return { bias, target, stop, rr };
}

// ─── Main Scanner ──────────────────────────────────────────
type ScanOptions = { tickers?: string[]; minScore?: number; useCache?: boolean };

function emptyScan(): ConfluenceScanResult {
  return {
    rows: [],
    scannedAt: Date.now(),
    tickersScanned: 0,
    tickersWithData: 0,
    marketRegime: 'choppy',
    topPick: null,
    errors: [],
  };
}

// Kick a full scan in the background, deduped so only one ever runs at a time.
function startBackgroundScan(options?: ScanOptions): void {
  if (scanInFlight) return;
  scanInFlight = runFullScan(options)
    .catch((e: any) => {
      logger.error('[GEX-SCAN] background scan failed', { error: e?.message });
      return cachedResult?.data ?? emptyScan();
    })
    .finally(() => { scanInFlight = null; });
}

/**
 * Hub-facing scan. For the market-wide path it NEVER blocks on the full
 * 132-ticker scan: it serves cached (even stale) data instantly and refreshes
 * in the background. On a truly cold cache it returns empty immediately so the
 * hub endpoint can show its fast CBOE mini-scan while the real scan warms the
 * cache. Targeted scans (explicit `tickers`) still run fresh and blocking.
 */
export async function scanWatchlistConfluence(options?: ScanOptions): Promise<ConfluenceScanResult> {
  if (options?.tickers && options.tickers.length > 0) {
    return runFullScan(options);
  }

  const useCache = options?.useCache !== false;
  if (useCache && cachedResult) {
    if (cachedResult.expiresAt <= Date.now()) startBackgroundScan(options); // stale → refresh in bg
    return cachedResult.data; // instant, even if a few minutes old
  }

  // Cold cache → warm in the background, return empty now so the hub endpoint
  // serves its fast CBOE mini-scan instead of blocking on the full scan.
  startBackgroundScan(options);
  return emptyScan();
}

async function runFullScan(options?: ScanOptions): Promise<ConfluenceScanResult> {
  const universe: string[] =
    options?.tickers && options.tickers.length > 0
      ? options.tickers.map((t) => t.toUpperCase()).filter((t) => (APPROVED_TICKERS as Set<string>).has(t))
      : [
          ...(INDEX_TICKERS as readonly string[]),
          ...(S_TIER as readonly string[]),
          ...(A_TIER as readonly string[]),
          ...(SECONDARY as readonly string[]),
          ...(SMALL_ACCOUNT_TIER as readonly string[]),
        ];
  // Deduplicate (some tickers may appear in multiple tiers)
  const seen = new Set<string>();
  const deduped = universe.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });

  logger.info(`[GEX-SCAN] Scanning ${deduped.length} tickers...`);
  const startedAt = Date.now();

  const rows: ConfluenceRow[] = [];
  const errors: Array<{ symbol: string; error: string }> = [];

  // Process in batches of 5 to respect rate limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        const [gex, quote] = await Promise.all([
          calculateAggregateGammaExposure(symbol),
          getQuoteWithChange(symbol),
        ]);

        // Tradier path failed → fall back to CBOE delayed chain so weekends,
        // after-hours, and rate-limit storms don't zero out the entire scan.
        let snap;
        if (gex) {
          snap = toSnapshot(gex);
        } else {
          const { computeGEXFromCBOE } = await import('./gex-cboe-fallback');
          const cboe = await computeGEXFromCBOE(symbol);
          if (cboe) {
            snap = cboe;
          } else {
            // THIRD LEG — Bullflow's precomputed per-strike chain, one call
            // instead of a 30-expiry fetch storm. This is what rescues the
            // ~120 names that died on Tradier(401)+CBOE(429) and left the
            // hub honestly reporting 14/136.
            const { computeGEXFromBullflow } = await import('./gex-bullflow-fallback');
            const bfl = await computeGEXFromBullflow(symbol);
            if (!bfl) throw new Error('no_gex_data');
            snap = bfl;
          }
        }
        if (!quote) throw new Error('no_quote');

        // Override spot with fresh quote if more recent
        if (quote.price > 0) snap.spotPrice = quote.price;

        const breakdown = scoreConfluence(snap);
        const score =
          breakdown.flipProximity +
          breakdown.wallSetup +
          breakdown.vexAlignment +
          breakdown.liquidity +
          breakdown.regime;

        const { bias, target, stop, rr } = deriveBias(snap);

        const row: ConfluenceRow = {
          symbol,
          tier: getTier(symbol),
          spotPrice: snap.spotPrice,
          change: quote.change,
          changePct: quote.changePct,
          score,
          breakdown,
          scoreTier: scoreToTier(score),
          gammaFlip: snap.gammaFlipPrice,
          callWall: snap.callWall,
          putWall: snap.putWall,
          projection: snap.zeroGammaProjection,
          maxGammaStrike: snap.maxGammaStrike,
          totalGEX: snap.totalGEX,
          totalVEX: snap.totalVEX,
          regime: snap.regime,
          sector: getSector(symbol),
          bias,
          target,
          stop,
          riskReward: rr,
          dataSource: snap.source,
          calculatedAt: snap.calculatedAt,
          dealerFlowPer1Pct: snap.dealerFlowPer1Pct,
          byDte: snap.byDte,
        };
        return row;
      }),
    );

    results.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        rows.push(res.value);
      } else {
        errors.push({ symbol: batch[idx], error: res.reason?.message || 'unknown' });
      }
    });
  }

  // Filter by min score
  const minScore = options?.minScore ?? 0;
  const filtered = rows.filter((r) => r.score >= minScore);
  filtered.sort((a, b) => b.score - a.score);

  // Market regime from SPY/QQQ
  const spy = filtered.find((r) => r.symbol === 'SPY');
  const qqq = filtered.find((r) => r.symbol === 'QQQ');
  let marketRegime: ConfluenceScanResult['marketRegime'] = 'choppy';
  if (spy && qqq) {
    if (spy.changePct > 0.3 && qqq.changePct > 0.3) marketRegime = 'risk_on';
    else if (spy.changePct < -0.3 && qqq.changePct < -0.3) marketRegime = 'risk_off';
    else if (Math.abs(spy.changePct) > 0.5) marketRegime = 'trending';
  }

  const result: ConfluenceScanResult = {
    rows: filtered,
    scannedAt: startedAt,
    tickersScanned: deduped.length,
    tickersWithData: rows.length,
    marketRegime,
    topPick: filtered[0]?.symbol ?? null,
    errors,
  };

  cachedResult = { data: result, expiresAt: Date.now() + CACHE_TTL_MS };

  const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
  logger.info(
    `[GEX-SCAN] Done in ${duration}s: ${rows.length}/${universe.length} scored, ${errors.length} errors, top: ${result.topPick} (${filtered[0]?.score ?? 0})`,
  );

  return result;
}

export function clearConfluenceCache(): void {
  cachedResult = null;
}

// ─────────────────────────────────────────────────────────────
// GEX HUB AGGREGATION
// ─────────────────────────────────────────────────────────────
// Wraps the existing scan and reshapes it into the market-wide
// hub view: top GEX longs/shorts, top VEX movers, sector splits,
// regime distribution. Cheap reshape — no extra fetches.
// ─────────────────────────────────────────────────────────────

const HUB_LEADER_COUNT = 6;

function toLeaderRow(r: ConfluenceRow): HubLeaderRow {
  return {
    symbol: r.symbol,
    tier: r.tier,
    spotPrice: r.spotPrice,
    changePct: r.changePct,
    totalGEX: r.totalGEX,
    totalVEX: r.totalVEX,
    score: r.score,
    regime: r.regime,
    bias: r.bias,
    sector: r.sector,
    callWall: r.callWall,
    putWall: r.putWall,
  };
}

// ─── Top Plays — rank actionable setups by dealer positioning ──

function buildTopPlays(rows: ConfluenceRow[]): TopPlay[] {
  return rows
    .filter((r) => r.spotPrice > 0 && (r.totalGEX !== 0 || r.totalVEX !== 0))
    .map((r) => {
      const flipDist = r.gammaFlip && r.gammaFlip > 0
        ? ((r.spotPrice - r.gammaFlip) / r.spotPrice) * 100
        : null;
      const isAboveFlip = flipDist !== null && flipDist >= 0;
      const isNegativeGamma = r.regime === 'negative_gamma' || r.totalGEX < 0;
      const absVex = Math.abs(r.totalVEX);

      // ── Play score: VEX magnitude (40) + regime (15) + wall setup (15) ──
      // Gamma flip is displayed as an estimate but excluded from ranking until it is
      // recomputed by sweeping total GEX across candidate spot prices.
      let score = 0;

      // VEX component (0-40): positive VEX is rare and very bullish
      if (r.totalVEX > 0 && absVex > 50) score += 40;
      else if (absVex > 1000) score += 35;
      else if (absVex > 500) score += 30;
      else if (absVex > 100) score += 22;
      else if (absVex > 10) score += 12;
      else score += 4;

      // Regime (0-15): negative gamma = amplified moves
      if (isNegativeGamma) score += 15;
      else if (r.regime === 'positive_gamma') score += 12;
      else if (r.regime === 'transitioning') score += 8;
      else score += 4;

      // Wall setup (0-15): tight bracket = coiled
      if (r.callWall && r.putWall && r.spotPrice > 0) {
        const bracket = ((r.callWall - r.putWall) / r.spotPrice) * 100;
        if (bracket >= 2 && bracket <= 5) score += 15;
        else if (bracket < 2) score += 12;
        else if (bracket <= 10) score += 10;
        else score += 5;
      }

      // VEX signal classification
      let vexSignal: VEXSignal;
      if (r.totalVEX > 0 && absVex > 50) vexSignal = 'positive_rare';
      else if (absVex > 500 && isNegativeGamma) vexSignal = 'negative_explosive';
      else if (absVex > 100) vexSignal = 'negative_strong';
      else vexSignal = 'mild';

      // ── Plain English insight (regime-aware) ──
      const isPositiveGamma = r.regime === 'positive_gamma';
      const isTransitioning = r.regime === 'transitioning';
      const hasPositiveVEX = r.totalVEX > 0;
      let insight: string;

      if (vexSignal === 'positive_rare' && isPositiveGamma) {
        // Positive VEX + positive gamma = vol compression drives dealer buying → strong pin support
        insight = `Positive VEX (+${absVex.toFixed(0)}) in positive gamma — vol compression drives dealer buying. Strong pin support near $${(r.callWall || r.gammaFlip || r.spotPrice).toFixed(0)}.`;
      } else if (vexSignal === 'positive_rare') {
        // Positive VEX outside positive gamma = dealers buying alongside, rare
        insight = `Positive VEX (+${absVex.toFixed(0)}) — dealers accumulating delta with you. Rare bullish signal${isTransitioning ? ' — watch for regime flip to confirm.' : '.'}`;
      } else if (vexSignal === 'negative_explosive') {
        // Negative gamma + high VEX = cascading dealer hedging both ways
        insight = `Negative gamma + VEX −${absVex.toFixed(0)} = coiled spring. Dealer hedging can amplify a confirmed break in either direction.`;
      } else if (isPositiveGamma) {
        // Positive gamma dampens moves; do not derive direction from the current
        // cumulative-strike flip estimate.
        const negVexNote = absVex > 100
          ? ` Negative VEX (−${absVex.toFixed(0)}) = vol-compression headwind limits upside extension.`
          : '';
        insight = `Positive gamma — dealers dampen moves; expect range-bound action near $${(r.callWall || r.spotPrice).toFixed(0)}.${negVexNote}${hasPositiveVEX ? ' Positive VEX supports the bid.' : ''}`;
      } else if (isNegativeGamma) {
        insight = `Negative gamma — dealer hedging can amplify whichever side confirms first. Use the walls as structural levels, not directional triggers.`;
      } else if (isTransitioning && flipDist !== null) {
        insight = `Transitioning regime. The displayed flip is an estimated reference and is excluded from the score; confirm direction with price and flow.`;
      } else {
        insight = `Neutral regime. VEX ${r.totalVEX >= 0 ? '+' : ''}${r.totalVEX.toFixed(0)} — moderate dealer positioning, no strong directional pressure.`;
      }

      const conviction = score >= 70 ? 'high' as const : score >= 45 ? 'medium' as const : 'low' as const;

      return {
        symbol: r.symbol,
        sector: r.sector,
        spotPrice: r.spotPrice,
        gammaFlip: r.gammaFlip,
        flipDistancePct: flipDist ?? 0,
        isAboveFlip,
        callWall: r.callWall,
        putWall: r.putWall,
        totalGEX: r.totalGEX,
        totalVEX: r.totalVEX,
        vexSignal,
        regime: r.regime,
        isNegativeGamma,
        playScore: Math.min(100, score),
        conviction,
        bias: r.bias,
        target: r.target || (r.bias === 'short' ? r.putWall : r.callWall),
        stop: r.stop || (r.bias === 'short' ? r.callWall : r.putWall),
        insight,
      } satisfies TopPlay;
    })
    .sort((a, b) => b.playScore - a.playScore)
    .slice(0, 20);
}

// ─── Persist top GEX Hub plays as trade ideas (with option enrichment) ───

const TOP_PLAY_DUPE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2-hour dedup window

async function isTopPlayDuplicate(symbol: string, bias: string): Promise<boolean> {
  try {
    const all = await storage.getAllTradeIdeas();
    const cutoff = Date.now() - TOP_PLAY_DUPE_WINDOW_MS;
    return all.some(
      (i: any) =>
        i.symbol === symbol &&
        i.source === 'gex_scanner' &&
        (i.dataSourceUsed || '').startsWith('GEX_top_play') &&
        (i.direction || '').toLowerCase() === bias &&
        // Premium-space rows created by the old publisher are invalid Active
        // Book candidates. Do not let one suppress the corrected replacement.
        !(
          i.optionType != null &&
          Number(i.strikePrice) > 0 &&
          Number(i.entryPrice) > 0 &&
          Number(i.entryPrice) < Number(i.strikePrice) * 0.5
        ) &&
        new Date(i.timestamp).getTime() > cutoff,
    );
  } catch { return false; }
}

/**
 * Persist top GEX Hub plays as enriched trade ideas.
 * Called after buildGEXHub — takes the highest-conviction plays
 * and writes them through the options enricher into trade_ideas.
 */
export async function persistTopPlaysAsIdeas(plays: TopPlay[]): Promise<number> {
  // Only persist high/medium conviction plays (score >= 45)
  const best = plays.filter(p => p.conviction !== 'low' && p.bias !== 'neutral').slice(0, 8);
  if (best.length === 0) return 0;

  let persisted = 0;
  for (const play of best) {
    if (await isTopPlayDuplicate(play.symbol, play.bias)) continue;

    const direction = play.bias as 'long' | 'short';

    // SANITY GATE — reject degenerate plays. When the GEX walls land right on
    // top of spot (e.g. AVGO gapped and the call/put walls clustered within
    // ~0.2% of price), the target is a sub-1% move and the "swing" idea is
    // meaningless. Also reject when spot is missing/invalid (price feed down).
    // Better to surface NOTHING than a confident-looking degenerate signal.
    const MIN_TARGET_DISTANCE_PCT = 0.008; // 0.8% minimum room to target
    const effTarget = play.target || play.spotPrice * (direction === 'long' ? 1.03 : 0.97);
    if (!(play.spotPrice > 0)) {
      logger.warn(`[GEX-HUB] ⛔ skip ${play.symbol} — invalid spot (price feed unavailable)`);
      continue;
    }
    const targetDistPct = Math.abs(effTarget - play.spotPrice) / play.spotPrice;
    if (targetDistPct < MIN_TARGET_DISTANCE_PCT) {
      logger.warn(`[GEX-HUB] ⛔ skip ${play.symbol} — degenerate target (${(targetDistPct * 100).toFixed(2)}% from spot, walls clustered at price)`);
      continue;
    }

    const aiShape: AITradeIdea = {
      symbol: play.symbol,
      assetType: 'option',
      direction,
      entryPrice: play.spotPrice,
      targetPrice: play.target || play.spotPrice * (direction === 'long' ? 1.03 : 0.97),
      stopLoss: play.stop || play.spotPrice * (direction === 'long' ? 0.98 : 1.02),
      catalyst: `GEX Hub top play — ${play.vexSignal} VEX, ${play.regime} regime`,
      analysis: play.insight,
      sessionContext: 'regular',
    };

    let tradeIdea: Record<string, any>;
    try {
      const enriched = await enrichOptionIdea(aiShape);
      if (enriched) {
        const underlyingTarget = play.target || play.spotPrice * (direction === 'long' ? 1.03 : 0.97);
        const underlyingStop = play.stop || play.spotPrice * (direction === 'long' ? 0.98 : 1.02);
        const risk = Math.abs(play.spotPrice - underlyingStop);
        const reward = Math.abs(underlyingTarget - play.spotPrice);
        tradeIdea = {
          symbol: play.symbol,
          sector: play.sector ?? null,
          assetType: 'option',
          direction,
          // Signal geometry always stays in UNDERLYING price space. The old
          // publisher replaced these with option premium ($2.70 on PLTR), so
          // live revalidation compared a $192 stock quote to a $2.70 entry and
          // correctly rejected the row as malformed.
          entryPrice: play.spotPrice,
          targetPrice: underlyingTarget,
          stopLoss: underlyingStop,
          riskRewardRatio: risk > 0 ? +(reward / risk).toFixed(2) : 0,
          // Contract premium is separate from the share-price ladder.
          entryPremium: enriched.entryPrice,
          optionType: enriched.optionType,
          strikePrice: enriched.strikePrice,
          expiryDate: enriched.expiryDate,
          catalyst: `GEX top play — ${enriched.optionType.toUpperCase()} $${enriched.strikePrice} exp ${enriched.expiryDate}`,
          analysis: `${play.insight} | OPTIONS: ${enriched.optionType.toUpperCase()} $${enriched.strikePrice} @ $${enriched.entryPrice.toFixed(2)} contract mid. Underlying target $${underlyingTarget.toFixed(2)}.`,
          source: 'gex_scanner',
          dataSourceUsed: `GEX_top_play_${play.vexSignal}`,
          sessionContext: 'regular',
          timestamp: new Date().toISOString(),
          outcomeStatus: 'open',
          confidenceScore: Math.min(94, Math.round(play.playScore * 0.9 + 10)),
          holdingPeriod: play.playScore >= 65 ? 'day' : 'swing',
          qualitySignals: [
            `gamma_regime:${play.regime}`,
            `vex_signal:${play.vexSignal}`,
            `play_score:${play.playScore}`,
            play.gammaFlip ? `flip:${play.gammaFlip.toFixed(2)}` : '',
            play.callWall ? `call_wall:${play.callWall.toFixed(2)}` : '',
            play.putWall ? `put_wall:${play.putWall.toFixed(2)}` : '',
            `strike:${enriched.strikePrice}`,
            `expiry:${enriched.expiryDate}`,
          ].filter(Boolean),
        };
        logger.info(`[GEX-HUB] 🎯 TopPlay → ${play.symbol} ${enriched.optionType.toUpperCase()} $${enriched.strikePrice} exp ${enriched.expiryDate}`);
      } else {
        throw new Error('enrichment null');
      }
    } catch {
      // Fallback: stock-level idea
      const stockRR = play.target && play.stop
        ? Math.abs(((play.target || 0) - play.spotPrice) / (play.spotPrice - (play.stop || play.spotPrice)))
        : 2.0;
      tradeIdea = {
        symbol: play.symbol,
        sector: play.sector ?? null,
        assetType: 'stock',
        direction,
        entryPrice: play.spotPrice,
        targetPrice: play.target || play.spotPrice * (direction === 'long' ? 1.03 : 0.97),
        stopLoss: play.stop || play.spotPrice * (direction === 'long' ? 0.98 : 1.02),
        riskRewardRatio: +stockRR.toFixed(2),
        catalyst: `GEX Hub top play — ${play.vexSignal} VEX, ${play.regime} regime`,
        analysis: play.insight,
        source: 'gex_scanner',
        dataSourceUsed: `GEX_top_play_${play.vexSignal}`,
        sessionContext: 'regular',
        timestamp: new Date().toISOString(),
        outcomeStatus: 'open',
        confidenceScore: Math.min(94, Math.round(play.playScore * 0.9 + 10)),
        holdingPeriod: play.playScore >= 65 ? 'day' : 'swing',
        qualitySignals: [
          `gamma_regime:${play.regime}`,
          `vex_signal:${play.vexSignal}`,
          `play_score:${play.playScore}`,
          play.gammaFlip ? `flip:${play.gammaFlip.toFixed(2)}` : '',
          play.callWall ? `call_wall:${play.callWall.toFixed(2)}` : '',
          play.putWall ? `put_wall:${play.putWall.toFixed(2)}` : '',
        ].filter(Boolean),
      };
    }

    try {
      await storage.createTradeIdea(tradeIdea as any);
      persisted++;
    } catch (err) {
      logger.warn(`[GEX-HUB] TopPlay persist failed ${play.symbol}: ${(err as Error).message}`);
    }
  }

  if (persisted > 0) {
    logger.info(`[GEX-HUB] ✅ Persisted ${persisted}/${best.length} top plays as trade ideas`);
    const { invalidateConvictionsCache } = await import('./convictions-engine');
    invalidateConvictionsCache();
  }
  return persisted;
}

export async function buildGEXHub(scan: ConfluenceScanResult): Promise<GEXHubData> {
  const rows = scan.rows;

  // ─── Top positive GEX (call wall heavy / pin candidates) ───
  const topPositiveGEX = [...rows]
    .filter((r) => r.totalGEX > 0)
    .sort((a, b) => b.totalGEX - a.totalGEX)
    .slice(0, HUB_LEADER_COUNT)
    .map(toLeaderRow);

  // ─── Top negative GEX (volatility / break candidates) ──────
  const topNegativeGEX = [...rows]
    .filter((r) => r.totalGEX < 0)
    .sort((a, b) => a.totalGEX - b.totalGEX) // most negative first
    .slice(0, HUB_LEADER_COUNT)
    .map(toLeaderRow);

  // ─── Top VEX (vanna movers — by absolute magnitude) ────────
  const topVEX = [...rows]
    .filter((r) => Math.abs(r.totalVEX) > 0)
    .sort((a, b) => Math.abs(b.totalVEX) - Math.abs(a.totalVEX))
    .slice(0, HUB_LEADER_COUNT)
    .map(toLeaderRow);

  // ─── Sector aggregation ───────────────────────────────────
  const sectorMap = new Map<string, ConfluenceRow[]>();
  for (const r of rows) {
    const arr = sectorMap.get(r.sector) || [];
    arr.push(r);
    sectorMap.set(r.sector, arr);
  }

  const sectors: SectorAggregate[] = [];
  for (const [sector, sectorRows] of Array.from(sectorMap.entries())) {
    if (sectorRows.length === 0) continue;
    const netGEX = sectorRows.reduce((sum, r) => sum + r.totalGEX, 0);
    const netVEX = sectorRows.reduce((sum, r) => sum + r.totalVEX, 0);
    const avgScore = sectorRows.reduce((sum, r) => sum + r.score, 0) / sectorRows.length;
    const bullishCount = sectorRows.filter((r) => r.bias === 'long').length;
    const bearishCount = sectorRows.filter((r) => r.bias === 'short').length;
    const neutralCount = sectorRows.filter((r) => r.bias === 'neutral').length;
    const topPick = [...sectorRows].sort((a, b) => b.score - a.score)[0]?.symbol ?? null;

    sectors.push({
      sector,
      label: SECTOR_LABELS[sector as Sector] || sector,
      symbols: sectorRows.map((r) => r.symbol),
      netGEX,
      netVEX,
      avgScore,
      bullishCount,
      bearishCount,
      neutralCount,
      topPick,
    });
  }
  sectors.sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX));

  // ─── Regime distribution ──────────────────────────────────
  const regimeDistribution: RegimeDistribution = {
    positive_gamma: 0,
    negative_gamma: 0,
    neutral: 0,
    transitioning: 0,
    total: rows.length,
  };
  for (const r of rows) {
    regimeDistribution[r.regime] = (regimeDistribution[r.regime] || 0) + 1;
  }

  const marketNetGEX = rows.reduce((sum, r) => sum + r.totalGEX, 0);
  const marketNetVEX = rows.reduce((sum, r) => sum + r.totalVEX, 0);

  // ─── Top plays ─────────────────────────────────────────────
  const topPlays = buildTopPlays(rows);

  // ─── Session + futures context ─────────────────────────────
  const session = getMarketSession();
  let futures: GEXHubData['futures'] = undefined;
  if (session !== 'open') {
    try {
      const snaps = await getFuturesSnapshot();
      if (snaps.length > 0) futures = snaps;
    } catch (e: any) {
      logger.warn(`[GEX-HUB] Futures fetch failed: ${e.message}`);
    }
  }

  return {
    scannedAt: scan.scannedAt,
    marketRegime: scan.marketRegime,
    totalTickers: rows.length,
    attempted: rows.length + (scan.errors?.length ?? 0),
    failedSymbols: (scan.errors ?? []).map((e) => e.symbol),
    topPositiveGEX,
    topNegativeGEX,
    topVEX,
    sectors,
    regimeDistribution,
    marketNetGEX,
    marketNetVEX,
    topPlays,
    session,
    futures,
  };
}
