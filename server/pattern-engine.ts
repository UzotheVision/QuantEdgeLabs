/**
 * PATTERN ENGINE — full-universe chart pattern recognition on real OHLC.
 *
 * The operator's demand, verbatim: "we are to universally scan any ticker
 * based on any conditions... we need a chart pattern recognition engine."
 * They were right about the failure it answers: ABBV printed a four-day
 * inside bar and nothing on the platform could see it, because every scanner
 * watched its own curated pool and the analyzer faked highs/lows off closes.
 *
 * This engine watches the FULL universe (761 names) on real daily bars:
 *   - one sweep per ~12h (patterns live on daily bars; intraday adds nothing
 *     to a daily-range pattern except noise)
 *   - fetches via the same candle feed the charts use, concurrency-capped
 *   - every detector is explicit bar arithmetic — no scores without math,
 *     no pattern claimed without printing the levels that define it
 *
 * Detectors (v1):
 *   inside_coil     mother bar + >=3 consecutive inside sessions, unbroken
 *   nr7             narrowest daily range of the last 7 — compression day
 *   bull_flag       pole >=12% in <=15 bars, then 3-8 bar drift retracing
 *                   less than half the pole, close above the drift's floor
 *   bear_flag       the mirror — flagged for the board's context and the
 *                   short gate's conversation; the engine takes no side
 *   breakout_watch  close within 3% of the 52-week high on rising 20d avg
 *
 * Structure context travels with every hit (above/below 200-day, EMA stack)
 * so consumers can apply their own discipline. The engine detects; it does
 * not select, gate, or publish — those jobs belong to the funnel and its
 * referees.
 */
import { logger } from './logger';

export interface PatternHit {
  symbol: string;
  /** On the operator's core watchlist — consumers pin these first. */
  core?: boolean;
  pattern: 'inside_coil' | 'nr7' | 'bull_flag' | 'bear_flag' | 'breakout_watch';
  bias: 'long' | 'short' | 'neutral';
  /**
   * Flags only. Bulkowski's measured record: tight flags (shallow retrace off
   * a strong pole) succeed ~85%; LOOSE flags fail ~55% — a coin flip. A loose
   * flag therefore keeps its shape label but has its bias DEMOTED to neutral:
   * the pattern is real, its direction claim is not evidence-grade.
   */
  quality?: 'tight' | 'loose';
  detectedAt: string;
  /** Bar arithmetic that defines the pattern — the proof, not decoration. */
  levels: Record<string, number>;
  note: string;
  context: { above200d: boolean | null; ema20AboveEma50: boolean | null; last: number; pctFromHigh?: number | null };
}

interface Bar { time: number; open: number; high: number; low: number; close: number; volume?: number }

let cache: { at: number; hits: PatternHit[]; scanned: number; failed: number } | null = null;
let scanning = false;
const SCAN_TTL_MS = 12 * 60 * 60 * 1000;

function ema(vals: number[], n: number): number {
  const k = 2 / (n + 1);
  let e = vals[0];
  for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
  return e;
}

function detect(symbol: string, bars: Bar[]): PatternHit[] {
  const hits: PatternHit[] = [];
  if (bars.length < 60) return hits;
  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];
  const now = new Date().toISOString();
  const sma200 = closes.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
  const e20 = ema(closes.slice(-120), 20);
  const e50 = ema(closes.slice(-160), 50);
  // Proximity to the window high — George & Hwang (2004): nearness to the
  // 52-week high predicts returns better than standard momentum, the most
  // replicated ranking signal in this space. The liquid fast path carries ~70
  // sessions, curated names a full year, so this is the AVAILABLE-window high,
  // negative = below it.
  const windowHigh = Math.max(...bars.slice(-252).map((b) => b.high));
  const pctFromHigh = windowHigh > 0 ? ((last - windowHigh) / windowHigh) * 100 : null;

  const context = {
    above200d: sma200 != null ? last > sma200 : null,
    ema20AboveEma50: e20 > e50,
    last,
    pctFromHigh: pctFromHigh != null ? Number(pctFromHigh.toFixed(1)) : null,
  };

  // ── inside_coil: mother bar + >=3 consecutive inside sessions, unbroken ──
  for (let m = bars.length - 5; m >= Math.max(0, bars.length - 9); m--) {
    const mother = bars[m];
    const after = bars.slice(m + 1);
    if (after.length >= 3 && after.every((x) => x.high <= mother.high && x.low >= mother.low)) {
      hits.push({
        symbol, pattern: 'inside_coil',
        bias: context.above200d === false ? 'short' : context.above200d === true ? 'long' : 'neutral',
        detectedAt: now,
        levels: { motherHigh: mother.high, motherLow: mother.low, coilDays: after.length },
        note: `${after.length} sessions inside ${mother.low.toFixed(2)}–${mother.high.toFixed(2)}; break direction decides`,
        context,
      });
      break;
    }
  }

  // ── nr7: narrowest range of the last 7 sessions ──
  const last7 = bars.slice(-7);
  if (last7.length === 7) {
    const ranges = last7.map((b) => b.high - b.low);
    if (ranges[6] > 0 && ranges[6] === Math.min(...ranges)) {
      hits.push({
        symbol, pattern: 'nr7', bias: 'neutral', detectedAt: now,
        levels: { rangeHigh: last7[6].high, rangeLow: last7[6].low },
        note: `narrowest daily range in 7 sessions (${ranges[6].toFixed(2)}) — compression day`,
        context,
      });
    }
  }

  // ── flags: pole then shallow drift ──
  // pole: >=12% move across <=15 bars, ending 3-8 bars ago; drift since then
  // retraces less than half the pole and stays orderly (no bar beyond pole
  // extreme, no full giveback).
  const N = bars.length;
  for (const dir of ['up', 'down'] as const) {
    for (let driftLen = 3; driftLen <= 8; driftLen++) {
      const poleEnd = N - 1 - driftLen;
      if (poleEnd < 15) break;
      const poleEndBar = bars[poleEnd];
      const poleWindow = bars.slice(Math.max(0, poleEnd - 15), poleEnd + 1);
      const drift = bars.slice(poleEnd + 1);
      if (dir === 'up') {
        const poleLow = Math.min(...poleWindow.map((b) => b.low));
        const poleRise = (poleEndBar.high - poleLow) / poleLow;
        if (poleRise < 0.12) continue;
        const driftLow = Math.min(...drift.map((b) => b.low));
        const retrace = (poleEndBar.high - driftLow) / (poleEndBar.high - poleLow);
        const driftHigh = Math.max(...drift.map((b) => b.high));
        if (retrace > 0 && retrace <= 0.5 && driftHigh <= poleEndBar.high * 1.01 && last > driftLow) {
          const tight = retrace <= 0.34 && poleRise >= 0.2;
          hits.push({
            symbol, pattern: 'bull_flag', bias: tight ? 'long' : 'neutral', quality: tight ? 'tight' : 'loose', detectedAt: now,
            levels: { poleLow, poleHigh: poleEndBar.high, flagLow: driftLow, retracePct: Math.round(retrace * 100) },
            note: `pole +${(poleRise * 100).toFixed(0)}% then ${driftLen}-bar drift retracing ${(retrace * 100).toFixed(0)}%${tight ? ' · tight' : ' · loose — direction unproven (measured ~coin-flip class)'}`,
            context,
          });
        }
      } else {
        const poleHigh = Math.max(...poleWindow.map((b) => b.high));
        const poleDrop = (poleHigh - poleEndBar.low) / poleHigh;
        if (poleDrop < 0.12) continue;
        const driftHigh = Math.max(...drift.map((b) => b.high));
        const retrace = (driftHigh - poleEndBar.low) / (poleHigh - poleEndBar.low);
        const driftLow = Math.min(...drift.map((b) => b.low));
        if (retrace > 0 && retrace <= 0.5 && driftLow >= poleEndBar.low * 0.99 && last < driftHigh) {
          const tight = retrace <= 0.34 && poleDrop >= 0.2;
          hits.push({
            symbol, pattern: 'bear_flag', bias: tight ? 'short' : 'neutral', quality: tight ? 'tight' : 'loose', detectedAt: now,
            levels: { poleHigh, poleLow: poleEndBar.low, flagHigh: driftHigh, retracePct: Math.round(retrace * 100) },
            note: `pole -${(poleDrop * 100).toFixed(0)}% then ${driftLen}-bar bounce retracing ${(retrace * 100).toFixed(0)}%${tight ? ' · tight' : ' · loose — direction unproven (measured ~coin-flip class)'}`,
            context,
          });
        }
      }
      if (hits.some((h) => h.pattern === (dir === 'up' ? 'bull_flag' : 'bear_flag'))) break;
    }
  }

  // ── breakout_watch: within 3% of the 52w high, 20d avg close rising ──
  const hi52 = Math.max(...bars.slice(-252).map((b) => b.high));
  if (last >= hi52 * 0.97 && closes.length >= 40) {
    const ma20now = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const ma20then = closes.slice(-40, -20).reduce((a, b) => a + b, 0) / 20;
    if (ma20now > ma20then) {
      hits.push({
        symbol, pattern: 'breakout_watch', bias: 'long', detectedAt: now,
        levels: { high52: hi52, distancePct: Math.round(((hi52 - last) / hi52) * 1000) / 10 },
        note: `within ${(((hi52 - last) / hi52) * 100).toFixed(1)}% of the 52w high on a rising 20d`,
        context,
      });
    }
  }

  return hits;
}

/** Sweep the full universe. Long-running (~minutes) — callers fire and forget. */
export async function scanUniversePatterns(force = false): Promise<void> {
  if (scanning) return;
  if (!force && cache && Date.now() - cache.at < SCAN_TTL_MS) return;
  scanning = true;
  const started = Date.now();
  try {
    const { getFullUniverse } = await import('./ticker-universe');
    const { fetchCandlesBatch } = await import('./historical-candles');
    const { getLiquidSymbols, getUniverseBars, warmLiquidUniverse } = await import('./liquid-universe');
    // The operator's rule: top-2000 liquid names UNIVERSALLY, plus every
    // curated list. The liquid set's bars come from grouped-daily calls (~70
    // requests for the whole market); only curated stragglers outside it pay
    // the per-symbol fetch. A cold universe is warmed HERE rather than trusted
    // to boot ordering — the first boot sweep raced the 45s warm timer and
    // covered only the curated 673.
    if (getLiquidSymbols().length === 0) await warmLiquidUniverse();
    const liquid = getLiquidSymbols();
    const universe = Array.from(new Set([...getFullUniverse(), ...liquid].map((t: string) => t.toUpperCase())));
    const { USER_CORE_WATCHLIST } = await import('./ticker-universe');
    const coreSet = new Set(USER_CORE_WATCHLIST.map((t: string) => t.toUpperCase()));
    logger.info(`[PATTERN-ENGINE] sweeping ${universe.length} names (${liquid.length} liquid + curated) on real daily bars…`);
    const hits: PatternHit[] = [];
    let scanned = 0; let failed = 0;

    // Fast path: whole-market bars assembled from grouped sessions.
    const grouped = liquid.length ? await getUniverseBars(70) : new Map();
    const curatedSet = new Set(getFullUniverse().map((t: string) => t.toUpperCase()));
    const remaining: string[] = [];
    for (const sym of universe) {
      const gb = grouped.get(sym);
      if (gb && gb.length >= 60) {
        scanned++;
        hits.push(...detect(sym, gb as Bar[]).map((h) => ({ ...h, core: coreSet.has(sym) })));
      } else if (curatedSet.has(sym)) {
        // Only curated names earn the per-symbol fallback — a liquid-only name
        // with thin grouped coverage is counted unreadable, not allowed to
        // stampede thousands of per-symbol fetches.
        remaining.push(sym);
      } else {
        failed++;
      }
    }

    // Per-symbol fallback for curated names the grouped set didn't cover.
    const CHUNK = 40;
    for (let i = 0; i < remaining.length; i += CHUNK) {
      const slice = remaining.slice(i, i + CHUNK);
      try {
        const candles = await fetchCandlesBatch(slice, '1y', '1d', 8);
        for (const sym of slice) {
          const bars = (candles.get(sym) ?? []).filter((b: Bar) => Number.isFinite(b.close) && b.close > 0);
          if (bars.length < 60) { failed++; continue; }
          scanned++;
          hits.push(...detect(sym, bars as Bar[]).map((h) => ({ ...h, core: coreSet.has(sym) })));
        }
      } catch (err: any) {
        failed += slice.length;
        logger.warn(`[PATTERN-ENGINE] chunk failed (${slice[0]}…): ${err?.message}`);
      }
    }
    cache = { at: Date.now(), hits, scanned, failed };
    logger.info(`[PATTERN-ENGINE] sweep done in ${Math.round((Date.now() - started) / 1000)}s — ${hits.length} hits across ${scanned} scanned (${failed} unreadable)`);
    try {
      const { pulse } = await import('./system-pulse');
      pulse('pattern', `swept ${scanned} names — ${hits.length} live patterns`);
    } catch { /* pulse is decoration, never load-bearing */ }
  } finally {
    scanning = false;
  }
}

export function getPatternHits(): { asOf: string | null; hits: PatternHit[]; scanned: number; failed: number; scanning: boolean } {
  return {
    asOf: cache ? new Date(cache.at).toISOString() : null,
    hits: cache?.hits ?? [],
    scanned: cache?.scanned ?? 0,
    failed: cache?.failed ?? 0,
    scanning,
  };
}

// Exported for measurement scripts — the edge tester runs detect() on
// held-out history to score pattern classes out of sample.
export { detect as detectPatterns };
