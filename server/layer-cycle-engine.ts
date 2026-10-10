/**
 * LAYER CYCLE ENGINE — turns the static taxonomy into a live rotation map.
 *
 * For each of 18 layers, every scan, computes:
 *   avgRet 5d / 20d / 60d
 *   breadth above 50dma + 200dma
 *   RS vs SPY (60d)
 *   small_vs_mega 20d-return spread (the BROADENING signal)
 *
 * Then classifies cycle stage (pre / early / mid / late / topped / rolling).
 *
 * Caches the result for 30 min — the underlying data is daily bars, no
 * point recomputing more often than that.
 */
import { logger } from './logger';
import { getTradierHistoryOHLC } from './tradier-api';
import {
  LAYERS,
  ALL_LAYER_TICKERS,
  type Layer,
} from '../shared/layer-taxonomy';
import {
  classifyStage,
  type LayerCycle,
  type LayerMetrics,
  type LayerCycleResponse,
  type TickerSnapshot,
} from '../shared/layer-types';

interface BarMetrics {
  symbol: string;
  spot: number;
  ret5d: number;
  ret20d: number;
  ret60d: number;
  above50dma: 0 | 1;
  above200dma: 0 | 1;
}

const CACHE_TTL_MS = 30 * 60_000;
let cached: { data: LayerCycleResponse; expiresAt: number } | null = null;

// ─── Per-symbol bar metrics ─────────────────────────────────────────

async function fetchSymbolMetrics(symbol: string, lookback: number): Promise<BarMetrics | null> {
  try {
    const bars = await getTradierHistoryOHLC(symbol, lookback);
    if (!bars || bars.closes.length < 20) return null;
    const closes = bars.closes;
    const n = closes.length;
    const spot = closes[n - 1];
    if (!spot || spot <= 0) return null;

    const ret = (back: number): number => {
      if (n <= back) return 0;
      const p = closes[n - 1 - back];
      return p > 0 ? ((spot - p) / p) * 100 : 0;
    };

    const sma = (window: number): number => {
      if (n < window) return 0;
      let sum = 0;
      for (let i = n - window; i < n; i++) sum += closes[i];
      return sum / window;
    };

    const sma50 = sma(50);
    const sma200 = sma(200);

    return {
      symbol,
      spot,
      ret5d:  ret(5),
      ret20d: ret(20),
      ret60d: ret(60),
      above50dma:  sma50 > 0 && spot > sma50  ? 1 : 0,
      above200dma: sma200 > 0 && spot > sma200 ? 1 : 0,
    };
  } catch (e: any) {
    logger.warn(`[LAYERS] ${symbol} failed: ${e?.message}`);
    return null;
  }
}

// ─── Layer aggregation ──────────────────────────────────────────────

function computeLayerMetrics(
  layer: Layer,
  bySymbol: Map<string, BarMetrics>,
  spyRet60: number,
): LayerMetrics {
  const tickers: TickerSnapshot[] = [];
  for (const t of layer.tickers) {
    const m = bySymbol.get(t.symbol);
    if (!m) continue;
    tickers.push({
      symbol: t.symbol,
      cap: t.cap,
      spot: m.spot,
      ret5d: m.ret5d,
      ret20d: m.ret20d,
      ret60d: m.ret60d,
      above50dma: m.above50dma,
      above200dma: m.above200dma,
      rs60d: m.ret60d - spyRet60,
    });
  }

  if (tickers.length === 0) {
    return {
      avgRet5d: 0, avgRet20d: 0, avgRet60d: 0,
      breadth50: 0, breadth200: 0, rsVsSpy60d: 0,
      smallVsMegaSpread20d: 0, tickerCount: 0, topMovers: [],
    };
  }

  const mean = (arr: number[]): number => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;

  const ret5 = tickers.map(t => t.ret5d);
  const ret20 = tickers.map(t => t.ret20d);
  const ret60 = tickers.map(t => t.ret60d);

  // Breadth
  const breadth50  = mean(tickers.map(t => t.above50dma));
  const breadth200 = mean(tickers.map(t => t.above200dma));

  // Small vs mega 20d return spread
  const smalls = tickers.filter(t => t.cap === 'small' || t.cap === 'micro').map(t => t.ret20d);
  const megas  = tickers.filter(t => t.cap === 'mega'  || t.cap === 'large').map(t => t.ret20d);
  const smallVsMegaSpread20d = (smalls.length && megas.length) ? mean(smalls) - mean(megas) : 0;

  // Top movers (by 20d return, top 5)
  const topMovers = [...tickers].sort((a, b) => b.ret20d - a.ret20d).slice(0, 5);

  return {
    avgRet5d:  +mean(ret5).toFixed(2),
    avgRet20d: +mean(ret20).toFixed(2),
    avgRet60d: +mean(ret60).toFixed(2),
    breadth50: +breadth50.toFixed(2),
    breadth200: +breadth200.toFixed(2),
    rsVsSpy60d: +(mean(ret60) - spyRet60).toFixed(2),
    smallVsMegaSpread20d: +smallVsMegaSpread20d.toFixed(2),
    tickerCount: tickers.length,
    topMovers,
  };
}

// ─── Public ────────────────────────────────────────────────────────

export async function computeLayerCycles(force = false): Promise<LayerCycleResponse> {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

  const startedAt = Date.now();
  logger.info(`[LAYERS] computing cycles for ${ALL_LAYER_TICKERS.length} tickers across ${LAYERS.length} layers…`);

  // Fetch SPY first (we need its 60d return for RS calcs)
  const spyMetrics = await fetchSymbolMetrics('SPY', 220);
  const spyRet60 = spyMetrics?.ret60d ?? 0;

  // Batch-fetch all layer tickers (concurrency 8)
  const BATCH = 8;
  const bySymbol = new Map<string, BarMetrics>();
  for (let i = 0; i < ALL_LAYER_TICKERS.length; i += BATCH) {
    const slice = ALL_LAYER_TICKERS.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(s => fetchSymbolMetrics(s, 220)));
    for (const r of results) if (r) bySymbol.set(r.symbol, r);
  }

  // Aggregate per layer
  const layers: LayerCycle[] = LAYERS.map(layer => {
    const metrics = computeLayerMetrics(layer, bySymbol, spyRet60);
    const { stage, reason } = classifyStage(metrics);
    return {
      id: layer.id,
      label: layer.label,
      description: layer.description,
      derivativeOrder: layer.derivativeOrder,
      rank: layer.rank,
      stage,
      stageReason: reason,
      metrics,
      computedAt: new Date().toISOString(),
    };
  });

  const response: LayerCycleResponse = {
    layers,
    asOf: new Date().toISOString().slice(0, 10),
    tickersScanned: bySymbol.size,
    durationMs: Date.now() - startedAt,
  };

  cached = { data: response, expiresAt: Date.now() + CACHE_TTL_MS };

  logger.info(`[LAYERS] done in ${(response.durationMs / 1000).toFixed(1)}s — ${bySymbol.size}/${ALL_LAYER_TICKERS.length} scanned`);

  return response;
}

export function clearLayerCycleCache(): void {
  cached = null;
}

/**
 * Drill-in for a single layer — returns full ticker breakdown sorted by 20d return.
 * Falls back to the cached snapshot if available.
 */
export async function getLayerDetail(layerId: string): Promise<LayerCycle | null> {
  const response = await computeLayerCycles();
  return response.layers.find(l => l.id === layerId) ?? null;
}
