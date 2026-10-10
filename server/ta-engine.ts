/**
 * ta-engine.ts — the ONE place that turns raw OHLCV into a structured
 * technical read: Fibonacci levels, candlestick patterns, support/resistance,
 * market structure, and a single net bias.
 *
 * Why this module exists:
 *   The primitives already live in technical-indicators.ts, but they were only
 *   ever consumed piecemeal inside scanners. This wraps them into one payload so
 *   BOTH surfaces share the same source of truth:
 *     • Phase 1 — the chart overlay (Fib lines + pattern badge on SignalChart)
 *     • Phase 2 — the conviction score (TA confluence as a scoring layer)
 *
 * Honesty rule: every number here is derived from real candles. If there aren't
 * enough candles to compute something, the field is omitted/empty — never faked.
 */
import {
  calculateFibonacciLevels,
  detectCandlestickPatterns,
  detectSupportResistanceLevels,
  analyzeMarketStructure,
  calculateRSI,
  calculateEMABundle,
  type PatternResult,
} from './technical-indicators';

export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FibLevel {
  ratio: number;
  price: number;
  label: string;
  /** the headline retracement levels traders actually watch */
  key: boolean;
}

export interface TARead {
  symbol: string;
  asOf: number;            // unix seconds of the last candle
  currentPrice: number;
  candleCount: number;

  fib: {
    swingHigh: number;
    swingLow: number;
    trend: 'uptrend' | 'downtrend';
    currentZone: string;   // e.g. "38.2%-50%"
    levels: FibLevel[];
  } | null;

  patterns: PatternResult[];   // most-recent-candle candlestick patterns

  levels: {
    support: number[];
    resistance: number[];
    nearestSupport: number;
    nearestResistance: number;
    pricePosition: 'near_support' | 'near_resistance' | 'middle';
  } | null;

  structure: {
    trend: 'uptrend' | 'downtrend' | 'ranging';
    higherHighs: number;
    higherLows: number;
    lowerHighs: number;
    lowerLows: number;
    breakOfStructure: boolean;
  } | null;

  /** Net technical bias distilled from the above — consumed by conviction (phase 2). */
  bias: {
    direction: 'bullish' | 'bearish' | 'neutral';
    score: number;          // -100..+100 (negative = bearish)
    confluence: string[];   // human-readable reasons, e.g. "Bullish Engulfing at 61.8% Fib"
  };
}

const KEY_FIB_RATIOS = new Set([0.382, 0.5, 0.618]);

// ── Cached candle fetch + TA read ──────────────────────────────────────
// Daily candles only change once per session, so a single fetch is reused for
// hours. This is what lets the conviction engine enrich its whole shortlist with
// TA without blasting Yahoo on every rebuild.
const _taCache = new Map<string, { at: number; read: TARead | null }>();
const TA_TTL_MS = 2 * 60 * 60 * 1000;      // 2h for a good read (daily candles)
const TA_NEG_TTL_MS = 45 * 1000;           // 45s for a miss — a transient 429 must
                                           // NOT poison the symbol for hours.

// Global concurrency gate on the Yahoo chart endpoint. The conviction engine
// enriches its whole shortlist at once; without this, ~190 simultaneous chart
// fetches stampede Yahoo, every one 429s, and the cache fills with nulls. Cap to
// a handful in flight so requests succeed instead of all failing together.
const TA_MAX_CONCURRENT = 4;
let _inFlight = 0;
const _waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (_inFlight < TA_MAX_CONCURRENT) { _inFlight++; return; }
  await new Promise<void>((resolve) => _waiters.push(resolve));
  _inFlight++;
}
function release(): void {
  _inFlight--;
  const next = _waiters.shift();
  if (next) next();
}

function rangeToPeriod1(range: string): Date {
  const months: Record<string, number> = {
    '1mo': 1, '3mo': 3, '6mo': 6, '1y': 12, '2y': 24, '5y': 60,
  };
  const m = months[range] ?? 6;
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d;
}

/**
 * Fetch candles (cached) and return the structured TA read. Shared by the
 * /api/ta route and the conviction TA layer so both see identical numbers.
 * Returns null on insufficient data / provider failure — never throws, never fakes.
 */
export async function getCachedTARead(
  symbol: string,
  range = '6mo',
  interval = '1d',
): Promise<TARead | null> {
  const key = `${symbol.toUpperCase()}:${range}:${interval}`;
  const hit = _taCache.get(key);
  if (hit) {
    const ttl = hit.read ? TA_TTL_MS : TA_NEG_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.read;
  }

  await acquire();
  try {
    // Re-check the cache after waiting for the gate — a concurrent caller for the
    // same symbol may have just populated it while we were queued.
    const fresh = _taCache.get(key);
    if (fresh && fresh.read && Date.now() - fresh.at < TA_TTL_MS) return fresh.read;

    const YahooFinance = (await import('yahoo-finance2')).default;
    const yf = new YahooFinance();
    const result = await yf.chart(symbol, {
      period1: rangeToPeriod1(range),
      interval: interval as any,
    } as any);
    const candles: OHLCV[] = ((result as any)?.quotes || [])
      .filter((q: any) => q.open != null && q.high != null && q.low != null && q.close != null)
      .map((q: any) => ({
        time: Math.floor(new Date(q.date).getTime() / 1000),
        open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume || 0,
      }));
    const read = candles.length >= 10 ? computeTA(symbol, candles) : null;
    _taCache.set(key, { at: Date.now(), read });
    return read;
  } catch {
    _taCache.set(key, { at: Date.now(), read: null });
    return null;
  } finally {
    release();
  }
}

/**
 * Compute the full technical read from candles. Pure function — no I/O — so it's
 * trivially testable and reusable by any caller (route, scanner, conviction layer).
 */
export function computeTA(symbol: string, candles: OHLCV[]): TARead {
  const open = candles.map((c) => c.open);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const close = candles.map((c) => c.close);
  const volume = candles.map((c) => c.volume);
  const currentPrice = close[close.length - 1] ?? 0;
  const asOf = candles[candles.length - 1]?.time ?? Math.floor(Date.now() / 1000);

  // ── Fibonacci ────────────────────────────────────────────────────────
  let fib: TARead['fib'] = null;
  if (close.length >= 10) {
    const raw = calculateFibonacciLevels(high, low, close, Math.min(50, close.length));
    fib = {
      swingHigh: raw.swingHigh,
      swingLow: raw.swingLow,
      trend: raw.trend,
      currentZone: raw.currentLevel,
      levels: raw.levels.map((l) => ({ ...l, key: KEY_FIB_RATIOS.has(l.ratio) })),
    };
  }

  // ── Candlestick patterns (most recent candle) ────────────────────────
  let patterns: PatternResult[] = [];
  if (candles.length >= 3) {
    try {
      patterns = detectCandlestickPatterns({ open, high, low, close });
    } catch {
      patterns = [];
    }
  }

  // ── Support / resistance ─────────────────────────────────────────────
  let levels: TARead['levels'] = null;
  if (close.length >= 10) {
    levels = detectSupportResistanceLevels(high, low, close, Math.min(50, close.length));
  }

  // ── Market structure ─────────────────────────────────────────────────
  let structure: TARead['structure'] = null;
  if (close.length >= 10) {
    const ms = analyzeMarketStructure(high, low, close);
    structure = {
      trend: ms.trend,
      higherHighs: ms.higherHighs,
      higherLows: ms.higherLows,
      lowerHighs: ms.lowerHighs,
      lowerLows: ms.lowerLows,
      breakOfStructure: ms.breakOfStructure,
    };
  }

  const bias = deriveBias({ currentPrice, fib, patterns, levels, structure, close, high, low });

  return {
    symbol,
    asOf,
    currentPrice,
    candleCount: candles.length,
    fib,
    patterns,
    levels,
    structure,
    bias,
  };
}

/**
 * Distill the structured read into one net bias. This is the contract phase 2
 * leans on: a bounded -100..+100 score plus the human reasons behind it.
 *
 * Weighting philosophy: structure/trend is the backbone, candlestick patterns
 * are the trigger, and price sitting AT a confluence (a key Fib that coincides
 * with S/R) is what turns a setup from "fine" into "high conviction".
 */
function deriveBias(ctx: {
  currentPrice: number;
  fib: TARead['fib'];
  patterns: PatternResult[];
  levels: TARead['levels'];
  structure: TARead['structure'];
  close: number[];
  high: number[];
  low: number[];
}): TARead['bias'] {
  const { currentPrice, fib, patterns, levels, structure, close, high, low } = ctx;
  let score = 0;
  const confluence: string[] = [];

  // 1. Market structure (backbone) — up to ±35
  if (structure) {
    if (structure.trend === 'uptrend') {
      score += 25;
      confluence.push(`Uptrend structure (${structure.higherHighs}HH / ${structure.higherLows}HL)`);
    } else if (structure.trend === 'downtrend') {
      score -= 25;
      confluence.push(`Downtrend structure (${structure.lowerHighs}LH / ${structure.lowerLows}LL)`);
    }
    if (structure.breakOfStructure) {
      // BOS amplifies whatever the new trend is
      const dir = structure.trend === 'downtrend' ? -10 : 10;
      score += dir;
      confluence.push('Break of structure');
    }
  }

  // 2. EMA trend confirmation — up to ±15 (scaled by how aligned the stack is)
  if (close.length >= 21) {
    try {
      const ema = calculateEMABundle(close);
      // alignment is 0..100; map distance-from-neutral into a ±15 nudge.
      const mag = Math.round((Math.abs(ema.alignment - 50) / 50) * 15);
      if (ema.trend === 'bullish') {
        score += mag;
        confluence.push(`EMA stack bullish (${ema.alignment}% aligned)`);
      } else if (ema.trend === 'bearish') {
        score -= mag;
        confluence.push(`EMA stack bearish (${ema.alignment}% aligned)`);
      }
    } catch { /* not enough data */ }
  }

  // 3. Candlestick patterns (trigger) — up to ±25
  const strengthPts: Record<PatternResult['strength'], number> = { strong: 14, moderate: 9, weak: 4 };
  for (const p of patterns) {
    if (!p.detected) continue;
    const pts = strengthPts[p.strength];
    if (p.type === 'bullish') { score += pts; confluence.push(`${p.name} (bullish)`); }
    else if (p.type === 'bearish') { score -= pts; confluence.push(`${p.name} (bearish)`); }
  }

  // 4. Price at a key Fibonacci level — up to ±15 (and flags confluence)
  if (fib) {
    const atKeyFib = fib.levels.find(
      (l) => l.key && Math.abs(l.price - currentPrice) / currentPrice < 0.015,
    );
    if (atKeyFib) {
      // A retracement into a key Fib in an uptrend is bullish support, and vice versa.
      if (fib.trend === 'uptrend') { score += 12; confluence.push(`At ${atKeyFib.label} Fib support`); }
      else { score -= 12; confluence.push(`At ${atKeyFib.label} Fib resistance`); }
    }
  }

  // 5. Position vs nearest S/R — up to ±10
  if (levels) {
    if (levels.pricePosition === 'near_support') {
      score += 10;
      confluence.push(`Near support $${levels.nearestSupport}`);
    } else if (levels.pricePosition === 'near_resistance') {
      score -= 10;
      confluence.push(`Near resistance $${levels.nearestResistance}`);
    }
  }

  // 6. RSI extreme as a mean-reversion nudge — up to ±8
  if (close.length >= 15) {
    const rsi = calculateRSI(close);
    if (rsi <= 30) { score += 8; confluence.push(`RSI oversold (${rsi.toFixed(0)})`); }
    else if (rsi >= 70) { score -= 8; confluence.push(`RSI overbought (${rsi.toFixed(0)})`); }
  }

  const clamped = Math.max(-100, Math.min(100, score));
  const direction: 'bullish' | 'bearish' | 'neutral' =
    clamped >= 15 ? 'bullish' : clamped <= -15 ? 'bearish' : 'neutral';

  return { direction, score: clamped, confluence };
}
