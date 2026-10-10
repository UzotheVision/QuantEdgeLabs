/**
 * COMPRESSION ENGINE — Darvas-style consolidation + TTM Squeeze.
 *
 * "Consolidation creates opportunity because the market is storing energy." A tight range
 * that has been tested repeatedly is a coiled spring: risk is definable (the box edges)
 * and expansion tends to be directional. This is the setup that pays for waiting, and the
 * conviction engine had no concept of it.
 *
 * Two independent reads, deliberately kept separate:
 *   • DARVAS BOX — a real range: tight relative to ATR, with multiple touches of both the
 *     ceiling and the floor. Untested ranges are just quiet drift, not structure.
 *   • TTM SQUEEZE — Bollinger Bands inside Keltner Channels, i.e. realised volatility has
 *     compressed below its own baseline. The classic pre-expansion tell.
 *
 * Neither predicts direction — compression precedes a move, it doesn't choose the side.
 * So the score contribution is modest and only counts when price sits in the upper (for a
 * long) or lower (for a short) part of the box, where a breakout would confirm the thesis.
 */

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume?: number }

export interface CompressionRead {
  inBox: boolean;
  boxHigh: number | null;
  boxLow: number | null;
  boxWidthPct: number | null;
  /** how many bars touched the ceiling / floor — a range needs to be TESTED to matter */
  ceilingTouches: number;
  floorTouches: number;
  /** 0-1, where price sits inside the box (1 = at the ceiling) */
  positionInBox: number | null;
  squeezeOn: boolean;
  squeezeBars: number;
  quality: 'strong' | 'developing' | 'none';
  summary: string;
}

function sma(v: number[], n: number) { const s = v.slice(-n); return s.reduce((a, b) => a + b, 0) / Math.max(s.length, 1); }
function stdev(v: number[], n: number) {
  const s = v.slice(-n); const m = sma(s, n);
  return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(s.length, 1));
}
function atr(c: Candle[], n = 14) {
  const tr: number[] = [];
  for (let i = 1; i < c.length; i++) {
    tr.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
  }
  return sma(tr, n);
}

/** TTM Squeeze: Bollinger(20,2) contained inside Keltner(20,1.5×ATR). */
export function squeezeState(c: Candle[]): { on: boolean; bars: number } {
  if (c.length < 25) return { on: false, bars: 0 };
  let bars = 0;
  for (let end = c.length; end >= 25; end--) {
    const win = c.slice(0, end);
    const closes = win.map((x) => x.close);
    const mid = sma(closes, 20);
    const sd = stdev(closes, 20);
    const a = atr(win, 20);
    const bbUp = mid + 2 * sd, bbLo = mid - 2 * sd;
    const kcUp = mid + 1.5 * a, kcLo = mid - 1.5 * a;
    const on = bbUp < kcUp && bbLo > kcLo;
    if (!on) break;
    bars++;
  }
  return { on: bars > 0, bars };
}

export function analyzeCompression(candles: Candle[], lookback = 25): CompressionRead {
  const none: CompressionRead = {
    inBox: false, boxHigh: null, boxLow: null, boxWidthPct: null,
    ceilingTouches: 0, floorTouches: 0, positionInBox: null,
    squeezeOn: false, squeezeBars: 0, quality: 'none', summary: 'No consolidation detected',
  };
  if (candles.length < lookback + 5) return none;

  const win = candles.slice(-lookback);
  const boxHigh = Math.max(...win.map((c) => c.high));
  const boxLow = Math.min(...win.map((c) => c.low));
  const spot = candles[candles.length - 1].close;
  const a = atr(candles, 14);
  if (!a || !boxHigh || !boxLow || boxHigh <= boxLow) return none;

  const width = boxHigh - boxLow;
  const boxWidthPct = (width / spot) * 100;

  // A range only counts as a box when it is tight RELATIVE to the instrument's own
  // volatility — 6% is roomy for MRK and cramped for MARA.
  const widthInAtr = width / a;
  // Tight on BOTH measures. Relative-to-ATR alone let a 46%-wide MARA range qualify as a
  // "box" simply because MARA is volatile — but a range that wide isn't a coiled spring,
  // it's a trading range you can get chopped up in. The absolute cap keeps the concept honest.
  const isTight = widthInAtr <= 6 && boxWidthPct <= 25;

  // Tested edges: bars closing within 15% of the box height of each boundary.
  const tol = width * 0.15;
  const ceilingTouches = win.filter((c) => c.high >= boxHigh - tol).length;
  const floorTouches = win.filter((c) => c.low <= boxLow + tol).length;

  const positionInBox = (spot - boxLow) / width;
  const { on: squeezeOn, bars: squeezeBars } = squeezeState(candles);

  const tested = ceilingTouches >= 2 && floorTouches >= 2;
  const inBox = isTight && tested;

  const quality: CompressionRead['quality'] =
    inBox && squeezeOn ? 'strong'
    : inBox || (squeezeOn && squeezeBars >= 3) ? 'developing'
    : 'none';

  const summary = quality === 'none'
    ? 'No consolidation detected'
    : [
        inBox ? `${boxWidthPct.toFixed(1)}% box (${widthInAtr.toFixed(1)}×ATR), ${ceilingTouches} ceiling / ${floorTouches} floor tests` : null,
        squeezeOn ? `squeeze on ${squeezeBars} bars` : null,
        positionInBox != null ? `price ${(positionInBox * 100).toFixed(0)}% up the range` : null,
      ].filter(Boolean).join(' · ');

  return {
    inBox, boxHigh, boxLow, boxWidthPct,
    ceilingTouches, floorTouches, positionInBox,
    squeezeOn, squeezeBars, quality, summary,
  };
}

/**
 * Convert a compression read into conviction points for a given direction.
 * Compression is directionless, so we only pay it when price is positioned where a
 * breakout would CONFIRM the trade — near the ceiling for a long, the floor for a short.
 * Capped at ±6 so it supports the thesis rather than driving it.
 */
export function compressionPoints(r: CompressionRead, direction: 'long' | 'short'): { points: number; why: string } | null {
  if (r.quality === 'none' || r.positionInBox == null) return null;

  const pos = direction === 'long' ? r.positionInBox : 1 - r.positionInBox;
  let points = 0;
  if (r.quality === 'strong') points = 6;
  else points = 3;

  // coiled but sitting at the wrong end — the breakout would go against us
  if (pos < 0.4) points = -Math.min(points, 3);
  else if (pos < 0.6) points = Math.round(points * 0.5);

  if (points === 0) return null;
  const side = direction === 'long' ? 'ceiling' : 'floor';
  const why = points > 0
    ? `Coiled: ${r.summary} — pressing the ${side}`
    : `Coiled but positioned at the wrong end of the range for a ${direction}`;
  return { points, why };
}
