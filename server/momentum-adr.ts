/**
 * MOMENTUM / ADR SCANNER
 * ======================
 * Find small/mid-cap RUNNERS using the Qullamaggie / Bonde-style ADR setup.
 *
 *   ADR%      = average of [(high-low)/close × 100] over last N days
 *   RVOL      = today's volume / 20d avg volume
 *   tightness = (ADR% over last 5d) / (ADR% over last 20d)  → <0.6 = compressing
 *   range%    = (close - 20d low) / (20d high - 20d low)    → >0.85 = near highs
 *   gain20d   = (close - close[20d ago]) / close[20d ago]
 *
 * Scoring (0-100):
 *   ADR% (0-30)        — higher base volatility = more momentum room
 *   RVOL (0-25)        — fresh volume confirms participation
 *   range% (0-20)      — closer to 20d high = breakout-ready
 *   tightness (0-15)   — coiled spring (low ATR last week vs 4-week)
 *   trend (0-10)       — gain20d > 0 (uptrend qualifier)
 *
 * Filters (defaults):
 *   maxPrice = 100  — small/mid cap only (where ADR matters)
 *   minAdrPct = 4   — needs to actually move
 *   minRvol = 1.2   — fresh participation
 *
 * Output: ranked list with all metrics + entry/stop/target suggestions.
 */
import { logger } from './logger';
import { getTradierHistoryOHLC } from './tradier-api';
import { DISCOVERY_UNIVERSE } from './multi-signal-discovery';

export interface RunnerCandidate {
  symbol: string;
  spot: number;
  adrPct: number;            // average daily range as % of close (last 20d)
  adrPct5d: number;          // last 5d only — for tightness comparison
  rvol: number;              // today vol / 20d avg
  rangePct: number;          // 0..1 position in 20d range (1 = at high)
  tightness: number;         // adrPct5d / adrPct20d (lower = more compressed)
  gain20d: number;           // % gain over last 20d (uptrend filter)
  score: number;             // 0-100 composite
  scoreTier: 'elite' | 'strong' | 'watch' | 'weak';
  // Trade plan
  entry: number;             // suggested entry = today's close
  stop: number;              // 1.5 ADR below entry
  target1: number;           // 2 ADR above entry
  target2: number;           // 4 ADR above entry
  rrTarget1: number;
  // Context
  high20d: number;
  low20d: number;
  avgVolume: number;
  todayVolume: number;
  // Provenance
  scannedAt: number;
}

const DEFAULTS = {
  lookback: 22,         // days of history to fetch (need 20+ + buffer)
  adrWindow: 20,        // days for ADR average
  rangeWindow: 20,      // days for range%
  maxPrice: 100,
  minAdrPct: 4,
  minRvol: 1.2,
  minScore: 0,
  limit: 50,
};

export interface RunnersFilter {
  maxPrice?: number;
  minPrice?: number;
  minAdrPct?: number;
  minRvol?: number;
  minScore?: number;
  /** Restrict to specific sectors from DISCOVERY_UNIVERSE keys */
  sectors?: string[];
  /** Custom ticker list (overrides sectors) */
  symbols?: string[];
  limit?: number;
}

// ─── Pure metric computation ─────────────────────────────────────

export interface OHLCBars {
  opens: number[]; highs: number[]; lows: number[]; closes: number[]; dates: string[];
}

export function computeAdrPct(highs: number[], lows: number[], closes: number[], window: number): number {
  if (closes.length < window) return 0;
  const start = closes.length - window;
  let sum = 0;
  for (let i = start; i < closes.length; i++) {
    if (closes[i] > 0) sum += ((highs[i] - lows[i]) / closes[i]) * 100;
  }
  return sum / window;
}

export function computeRangePosition(closes: number[], highs: number[], lows: number[], window: number): {
  rangePct: number; high: number; low: number;
} {
  if (closes.length < window) return { rangePct: 0.5, high: 0, low: 0 };
  const slice = closes.length - window;
  const highWindow = highs.slice(slice);
  const lowWindow = lows.slice(slice);
  const high = Math.max(...highWindow);
  const low = Math.min(...lowWindow);
  const close = closes[closes.length - 1];
  const rangePct = high > low ? (close - low) / (high - low) : 0.5;
  return { rangePct: Math.max(0, Math.min(1, rangePct)), high, low };
}

export function computeGainPct(closes: number[], window: number): number {
  if (closes.length < window) return 0;
  const start = closes[closes.length - window];
  const end = closes[closes.length - 1];
  return start > 0 ? ((end - start) / start) * 100 : 0;
}

function tier(score: number): RunnerCandidate['scoreTier'] {
  if (score >= 75) return 'elite';
  if (score >= 60) return 'strong';
  if (score >= 40) return 'watch';
  return 'weak';
}

// ─── Per-symbol scan ─────────────────────────────────────────────

async function scanOne(symbol: string, todayVolume?: number): Promise<RunnerCandidate | null> {
  try {
    const bars = await getTradierHistoryOHLC(symbol, DEFAULTS.lookback);
    if (!bars || bars.closes.length < DEFAULTS.adrWindow) return null;
    const { highs, lows, closes } = bars;
    const spot = closes[closes.length - 1];
    if (!spot || spot <= 0) return null;

    const adrPct20 = computeAdrPct(highs, lows, closes, DEFAULTS.adrWindow);
    const adrPct5  = computeAdrPct(highs, lows, closes, 5);
    const range = computeRangePosition(closes, highs, lows, DEFAULTS.rangeWindow);
    const gain20 = computeGainPct(closes, DEFAULTS.adrWindow);

    // Volume avg from history (last 20d) — fall back to today's volume if not provided
    // Note: getTradierHistoryOHLC doesn't return volume, so we approximate via today's tape
    const avgVolume = todayVolume ? todayVolume : 0; // best-effort
    const rvol = todayVolume && avgVolume > 0 ? todayVolume / avgVolume : 1;

    const tightness = adrPct20 > 0 ? adrPct5 / adrPct20 : 1;

    // Score components
    const sAdr      = Math.min(30, (adrPct20 / 12) * 30);  // 12% ADR = max
    const sRvol     = Math.min(25, ((rvol - 1) / 2) * 25); // RVOL 3x = max
    const sRange    = Math.min(20, range.rangePct * 20);   // closer to high = more
    const sTight    = tightness < 0.7 ? 15 : tightness < 1.0 ? 8 : 0;
    const sTrend    = gain20 > 5 ? 10 : gain20 > 0 ? 5 : 0;
    const score = Math.round(sAdr + sRvol + sRange + sTight + sTrend);

    // Trade plan
    const adrDollars = (spot * adrPct20) / 100;
    const entry  = spot;
    const stop   = +(spot - 1.5 * adrDollars).toFixed(2);
    const target1 = +(spot + 2 * adrDollars).toFixed(2);
    const target2 = +(spot + 4 * adrDollars).toFixed(2);
    const rrTarget1 = stop < entry ? +((target1 - entry) / (entry - stop)).toFixed(2) : 0;

    return {
      symbol,
      spot: +spot.toFixed(2),
      adrPct: +adrPct20.toFixed(2),
      adrPct5d: +adrPct5.toFixed(2),
      rvol: +rvol.toFixed(2),
      rangePct: +range.rangePct.toFixed(2),
      tightness: +tightness.toFixed(2),
      gain20d: +gain20.toFixed(2),
      score,
      scoreTier: tier(score),
      entry,
      stop,
      target1,
      target2,
      rrTarget1,
      high20d: +range.high.toFixed(2),
      low20d: +range.low.toFixed(2),
      avgVolume,
      todayVolume: todayVolume ?? 0,
      scannedAt: Date.now(),
    };
  } catch (e: any) {
    logger.warn(`[ADR] ${symbol} scan failed: ${e?.message}`);
    return null;
  }
}

// ─── Public: bulk scan with cache ─────────────────────────────────

let cached: { result: RunnerCandidate[]; key: string; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function scanRunners(filters: RunnersFilter = {}): Promise<RunnerCandidate[]> {
  const f = { ...DEFAULTS, ...filters };
  const universe = (() => {
    if (filters.symbols?.length) return Array.from(new Set(filters.symbols.map(s => s.toUpperCase())));
    const sectors = (filters.sectors?.length ? filters.sectors : Object.keys(DISCOVERY_UNIVERSE)) as Array<keyof typeof DISCOVERY_UNIVERSE>;
    return Array.from(new Set(sectors.flatMap(s => DISCOVERY_UNIVERSE[s] ?? [])));
  })();

  // Cache key
  const cacheKey = JSON.stringify({ universe: universe.length, ...f });
  if (cached && cached.key === cacheKey && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  logger.info(`[ADR] scanning ${universe.length} tickers (price≤$${f.maxPrice}, ADR≥${f.minAdrPct}%)…`);
  const startedAt = Date.now();

  // Pre-filter by price via per-symbol quote (parallel, batched)
  const { getTradierQuote } = await import('./tradier-api');
  const BATCH = 8;
  const priced: string[] = [];
  const quotesByTicker = new Map<string, { last: number; volume: number; average_volume?: number }>();
  for (let i = 0; i < universe.length; i += BATCH) {
    const slice = universe.slice(i, i + BATCH);
    const part = await Promise.all(slice.map(async (sym) => {
      try {
        const q = await getTradierQuote(sym);
        if (!q) return { sym, ok: false };
        quotesByTicker.set(sym, { last: q.last ?? 0, volume: (q as any).volume ?? 0, average_volume: (q as any).average_volume });
        const ok = (q.last ?? 0) <= (f.maxPrice ?? Infinity) && (q.last ?? 0) >= (f.minPrice ?? 0);
        return { sym, ok };
      } catch { return { sym, ok: true }; /* allow through if quote fails */ }
    }));
    for (const p of part) if (p.ok) priced.push(p.sym);
  }

  // Scan history for each priced ticker
  const results: RunnerCandidate[] = [];
  for (let i = 0; i < priced.length; i += BATCH) {
    const slice = priced.slice(i, i + BATCH);
    const part = await Promise.all(slice.map(sym => {
      const q = quotesByTicker.get(sym);
      const todayVol = q?.volume ?? 0;
      const avgVol = q?.average_volume ?? todayVol;
      const rvolHint = avgVol > 0 ? todayVol / avgVol : 1;
      return scanOne(sym, todayVol).then(r => {
        if (r && rvolHint && rvolHint > 0) {
          r.rvol = +rvolHint.toFixed(2);
          r.avgVolume = avgVol;
          const sRvol = Math.min(25, Math.max(0, ((r.rvol - 1) / 2) * 25));
          r.score = Math.min(100, r.score + Math.round(sRvol));
          r.scoreTier = tier(r.score);
        }
        return r;
      });
    }));
    for (const r of part) if (r) results.push(r);
  }

  // Apply filters
  const filtered = results.filter(r =>
    r.adrPct >= (f.minAdrPct ?? 0) &&
    r.rvol   >= (f.minRvol   ?? 0) &&
    r.score  >= (f.minScore  ?? 0)
  );
  filtered.sort((a, b) => b.score - a.score);
  const limited = filtered.slice(0, f.limit ?? DEFAULTS.limit);

  cached = { result: limited, key: cacheKey, expiresAt: Date.now() + CACHE_TTL_MS };
  logger.info(`[ADR] done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${limited.length} runners (top: ${limited[0]?.symbol}/${limited[0]?.score})`);
  return limited;
}

export function clearRunnersCache() { cached = null; }
