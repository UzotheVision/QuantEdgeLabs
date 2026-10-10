/**
 * DIVERGENCE ENGINE — price and momentum disagreeing, which is the disagreement
 * that precedes turns.
 *
 * Built to reproduce calls of the shape "NQ massive bullish divergence on the
 * hourly": price grinds to a lower low while momentum makes a HIGHER low, so the
 * selling that produced the new low was weaker than the selling that produced
 * the last one. Sellers are running out before buyers are.
 *
 * The reason this belongs in a signal system rather than an indicator panel is
 * that it is one of the few technical patterns that is genuinely LEADING. Almost
 * everything else on a chart — moving averages, breakouts, trend lines — is a
 * restatement of what price has already done. A divergence is a statement about
 * the FORCE behind price, and force changes before direction does.
 *
 * Two things make most divergence code useless, and both are handled here:
 *
 *   PIVOTS, NOT ENDPOINTS. Comparing the last bar to some bar N back finds a
 *   "divergence" on almost any series. Real ones compare confirmed swing lows —
 *   a bar lower than k bars either side of it — so the pattern is anchored to
 *   structure the market actually made.
 *
 *   CONFIRMATION LAG IS REAL AND MUST BE ADMITTED. A pivot cannot be confirmed
 *   until k bars have printed after it, so every divergence is discovered at
 *   least k bars late. Code that ignores this looks clairvoyant in backtest and
 *   loses money live. `barsSincePivot` is reported so the caller can see exactly
 *   how stale the read is.
 *
 * Divergence says pressure is shifting. It does NOT say when, and it does not
 * say how far — a divergence can persist while price keeps going. It belongs
 * with a level and an invalidation, never on its own.
 */

export type DivergenceKind = 'bullish' | 'bearish' | 'hidden_bullish' | 'hidden_bearish';

export interface Bar { high: number; low: number; close: number }

export interface Divergence {
  kind: DivergenceKind;
  /** Strength 0-100 from separation, momentum gap, and freshness. */
  strength: number;
  /** Index of the earlier pivot. */
  fromIdx: number;
  /** Index of the later pivot. */
  toIdx: number;
  priceFrom: number;
  priceTo: number;
  momentumFrom: number;
  momentumTo: number;
  /** Bars since the later pivot — this is how late the read already is. */
  barsSincePivot: number;
  read: string;
}

/** Wilder RSI, returned aligned to the input series (leading values NaN). */
export function rsi(closes: number[], period = 14): number[] {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;

  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / period, al = loss / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    ag = (ag * (period - 1) + g) / period;
    al = (al * (period - 1) + l) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

/** Confirmed swing lows: strictly lower than `k` bars on both sides. */
export function pivotLows(bars: Bar[], k = 3): number[] {
  const idx: number[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let ok = true;
    for (let j = 1; j <= k && ok; j++) {
      if (bars[i].low >= bars[i - j].low || bars[i].low >= bars[i + j].low) ok = false;
    }
    if (ok) idx.push(i);
  }
  return idx;
}

export function pivotHighs(bars: Bar[], k = 3): number[] {
  const idx: number[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let ok = true;
    for (let j = 1; j <= k && ok; j++) {
      if (bars[i].high <= bars[i - j].high || bars[i].high <= bars[i + j].high) ok = false;
    }
    if (ok) idx.push(i);
  }
  return idx;
}

/**
 * Ignore pivots further apart than this — they are not the same swing.
 *
 * This is measured in BARS, which means it says something different on every
 * timeframe: 60 bars is about nine sessions of hourly data but roughly three
 * months of daily, where ordinary swings run longer than that. Hardcoded at 60
 * it silently discarded valid daily divergences — an audit caught it dropping a
 * textbook one (lower low 87.40 -> 84.50 against RSI 0.0 -> 4.5) purely because
 * the pivots sat 62 bars apart.
 *
 * The default is now generous and callers scanning short intervals should pass
 * something tighter. A dropped signal that never appears is worse than a loose
 * one you can score down.
 */
export const MAX_PIVOT_SPAN = 120;
/** And closer than this, where it is just noise. */
export const MIN_PIVOT_SPAN = 5;

function score(priceSepPct: number, momGap: number, barsSince: number): number {
  const sep = Math.min(1, priceSepPct / 5);
  const gap = Math.min(1, momGap / 15);
  // Freshness matters most. A divergence found 20 bars late has usually resolved.
  const fresh = Math.max(0, 1 - barsSince / 20);
  return Math.round((sep * 0.25 + gap * 0.4 + fresh * 0.35) * 100);
}

/**
 * Find the most recent regular divergence in each direction.
 * Regular bullish: price lower low, momentum higher low  — sellers exhausting.
 * Regular bearish: price higher high, momentum lower high — buyers exhausting.
 */
export function findDivergences(
  bars: Bar[],
  k = 3,
  rsiPeriod = 14,
  maxSpan = MAX_PIVOT_SPAN,
): Divergence[] {
  if (bars.length < rsiPeriod + k * 2 + 5) return [];
  const closes = bars.map((b) => b.close);
  const mom = rsi(closes, rsiPeriod);
  const last = bars.length - 1;
  const out: Divergence[] = [];

  const lows = pivotLows(bars, k);
  for (let i = lows.length - 1; i > 0; i--) {
    const b = lows[i], a = lows[i - 1];
    const span = b - a;
    if (span < MIN_PIVOT_SPAN || span > maxSpan) continue;
    if (!Number.isFinite(mom[a]) || !Number.isFinite(mom[b])) continue;

    if (bars[b].low < bars[a].low && mom[b] > mom[a]) {
      const sepPct = ((bars[a].low - bars[b].low) / bars[a].low) * 100;
      const gap = mom[b] - mom[a];
      const barsSince = last - b;
      out.push({
        kind: 'bullish',
        strength: score(sepPct, gap, barsSince),
        fromIdx: a, toIdx: b,
        priceFrom: bars[a].low, priceTo: bars[b].low,
        momentumFrom: Math.round(mom[a] * 10) / 10,
        momentumTo: Math.round(mom[b] * 10) / 10,
        barsSincePivot: barsSince,
        read: `Price made a lower low (${bars[a].low.toFixed(2)} → ${bars[b].low.toFixed(2)}) `
          + `while momentum made a higher low (RSI ${mom[a].toFixed(0)} → ${mom[b].toFixed(0)}). `
          + `The selling into this low was weaker than the last one. `
          + `Confirmed ${barsSince} bar(s) ago — that lag is unavoidable and already priced in by anyone else watching.`,
      });
      break;
    }
  }

  const highs = pivotHighs(bars, k);
  for (let i = highs.length - 1; i > 0; i--) {
    const b = highs[i], a = highs[i - 1];
    const span = b - a;
    if (span < MIN_PIVOT_SPAN || span > maxSpan) continue;
    if (!Number.isFinite(mom[a]) || !Number.isFinite(mom[b])) continue;

    if (bars[b].high > bars[a].high && mom[b] < mom[a]) {
      const sepPct = ((bars[b].high - bars[a].high) / bars[a].high) * 100;
      const gap = mom[a] - mom[b];
      const barsSince = last - b;
      out.push({
        kind: 'bearish',
        strength: score(sepPct, gap, barsSince),
        fromIdx: a, toIdx: b,
        priceFrom: bars[a].high, priceTo: bars[b].high,
        momentumFrom: Math.round(mom[a] * 10) / 10,
        momentumTo: Math.round(mom[b] * 10) / 10,
        barsSincePivot: barsSince,
        read: `Price made a higher high (${bars[a].high.toFixed(2)} → ${bars[b].high.toFixed(2)}) `
          + `while momentum made a lower high (RSI ${mom[a].toFixed(0)} → ${mom[b].toFixed(0)}). `
          + `The buying into this high was weaker than the last one. `
          + `Confirmed ${barsSince} bar(s) ago.`,
      });
      break;
    }
  }

  return out.sort((x, y) => y.strength - x.strength);
}
