/**
 * INTRADAY SCANNER — Orchestrator
 * =================================
 * Pulls OHLC for a universe, runs all detectors, returns ranked setups.
 *
 * Universe sources (in priority order):
 *   1. User's active watchlist (always included when scan param onWatchlist=true)
 *   2. MOVERS_UNIVERSE (curated 80-name list)
 *   3. APPROVED_TICKERS (broader fallback)
 *
 * Output is filterable by pattern + min score + watchlist-only.
 */

import { logger } from '../logger';
import { detectBullFlag, detectBreakout20d, detectGapAndGo } from './detectors';
import { v4 as uuidv4 } from 'uuid';
import { MOVERS_UNIVERSE } from '@shared/movers-types';
import type { IntradayPattern, IntradaySetup, IntradayScanResult } from '@shared/intraday-scanner-types';

const UA = 'Mozilla/5.0';

// ─── OHLC fetcher (Yahoo, daily) ───────────────────────────────────

interface OHLCBar {
  date?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

const _ohlcCache = new Map<string, { bars: OHLCBar[]; fetchedAt: number }>();
const OHLC_TTL_MS = 15 * 60 * 1000; // 15 min cache

async function fetchOHLC(symbol: string, days = 60): Promise<OHLCBar[] | null> {
  const cached = _ohlcCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < OHLC_TTL_MS) return cached.bars;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { chart?: { result?: any[] } };
    const result = j.chart?.result?.[0];
    if (!result) return null;
    const ts = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const bars: OHLCBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.open?.[i] == null) continue;
      bars.push({
        date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
        open: q.open[i],
        high: q.high?.[i] ?? q.open[i],
        low: q.low?.[i] ?? q.open[i],
        close: q.close?.[i] ?? q.open[i],
        volume: q.volume?.[i] ?? 0,
      });
    }
    _ohlcCache.set(symbol, { bars, fetchedAt: Date.now() });
    return bars;
  } catch (e) {
    logger.warn(`[INTRADAY] OHLC fetch failed for ${symbol}: ${(e as Error).message}`);
    return null;
  }
}

// ─── Universe builder ─────────────────────────────────────────────

async function buildUniverse(watchlistOnly: boolean): Promise<string[]> {
  if (watchlistOnly) {
    // Pull active watchlist from DB
    try {
      const { db } = await import('../db');
      const { watchlist } = await import('@shared/schema');
      const rows = await db.select({ symbol: watchlist.symbol }).from(watchlist);
      const symbols = rows.map((r: any) => r.symbol).filter(Boolean);
      return symbols.length > 0 ? symbols : MOVERS_UNIVERSE.map(t => t.symbol);
    } catch (e) {
      logger.warn(`[INTRADAY] watchlist fetch failed: ${(e as Error).message}, falling back to MOVERS_UNIVERSE`);
    }
  }
  return MOVERS_UNIVERSE.map(t => t.symbol);
}

// ─── Run scan ─────────────────────────────────────────────────────

export interface ScanOptions {
  pattern: IntradayPattern;
  /** Min score to include in results (default 65) */
  minScore?: number;
  /** Restrict to user's watchlist symbols only */
  watchlistOnly?: boolean;
  /** Max results to return (default 30) */
  limit?: number;
}

export async function scanIntraday(opts: ScanOptions): Promise<IntradayScanResult> {
  const minScore = opts.minScore ?? 65;
  const limit = opts.limit ?? 30;
  const symbols = await buildUniverse(opts.watchlistOnly ?? false);

  const setups: IntradaySetup[] = [];
  // Process in batches of 6 with 200ms delay to avoid Yahoo rate-limits
  const batchSize = 6;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const ohlcMap = await Promise.all(batch.map(s => fetchOHLC(s)));
    for (let j = 0; j < batch.length; j++) {
      const sym = batch[j];
      const bars = ohlcMap[j];
      if (!bars || bars.length < 25) continue;

      let detection: { pattern: IntradayPattern; score: number; grade: any; metrics: any } | null = null;
      let direction: 'long' | 'short' | 'neutral' = 'long';

      if (opts.pattern === 'bull_flag') {
        const r = detectBullFlag(bars);
        if (r) detection = { ...r };
      } else if (opts.pattern === 'breakout_20d') {
        const r = detectBreakout20d(bars);
        if (r) detection = { ...r };
      } else if (opts.pattern === 'unusual_flow') {
        // Delegated to flow scanner (separate path) — return null here
        continue;
      }

      if (!detection || detection.score < minScore) continue;

      const spot = bars[bars.length - 1].close;
      const summary = buildSummary(opts.pattern, sym, spot, detection.metrics);

      setups.push({
        id: uuidv4(),
        pattern: opts.pattern,
        symbol: sym,
        spot,
        detectedAt: new Date().toISOString(),
        grade: detection.grade,
        score: detection.score,
        metrics: detection.metrics,
        summary,
        direction,
        plan: buildPlan(opts.pattern, spot, detection.metrics),
      });
    }
    if (i + batchSize < symbols.length) await new Promise(r => setTimeout(r, 250));
  }

  setups.sort((a, b) => b.score - a.score);
  const top = setups.slice(0, limit);

  return {
    pattern: opts.pattern,
    asOf: new Date().toISOString(),
    setups: top,
    summary: {
      totalScanned: symbols.length,
      setupsFound: setups.length,
      averageScore: setups.length
        ? Math.round(setups.reduce((a, b) => a + b.score, 0) / setups.length)
        : 0,
    },
  };
}

// ─── Summary + plan helpers ────────────────────────────────────────

function buildSummary(pattern: IntradayPattern, sym: string, spot: number, m: any): string {
  switch (pattern) {
    case 'bull_flag':
      return `${sym} bull flag: ${m.poleGainPct?.toFixed(0)}% pole, flag ${m.flagBars}d/${m.consolidationRangePct?.toFixed(1)}% range. Break above $${m.breakoutLevel?.toFixed(2)}.`;
    case 'breakout_20d':
      return `${sym} broke 20-day high ($${m.breakoutLevel?.toFixed(2)}) +${m.pctAboveLevel?.toFixed(1)}% on ${m.volumeRatio?.toFixed(1)}× avg volume. RSI ${m.rsi14?.toFixed(0)}.`;
    default:
      return `${sym} setup at $${spot.toFixed(2)}`;
  }
}

function buildPlan(pattern: IntradayPattern, spot: number, m: any): IntradaySetup['plan'] {
  switch (pattern) {
    case 'bull_flag':
      return {
        entry: m.breakoutLevel,
        stop: m.breakoutLevel * 0.97,
        target: m.breakoutLevel * (1 + (m.poleGainPct ?? 10) / 200), // half the pole size
      };
    case 'breakout_20d':
      return {
        entry: spot,
        stop: m.breakoutLevel ?? spot * 0.96,
        target: spot * 1.08,
      };
    default:
      return { entry: spot, stop: spot * 0.95, target: spot * 1.05 };
  }
}
