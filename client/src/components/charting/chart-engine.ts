/**
 * CHART ENGINE — the reference mock's canvas chart, shared.
 *
 * Extracted from chart-lab-nexus so NexusPriceChart and the Chart Lab page can
 * both use one engine without a circular import. Everything here is the mock's
 * drawing code plus the honesty layer: real OHLCV via useCandles, outlier-wick
 * clamping with counts, zone bands, level lines.
 */
import { useQuery } from '@tanstack/react-query';

/* ────────────────────────────────────────────────────────────────
   DATA
   ──────────────────────────────────────────────────────────────── */

export interface Candle {
  time: number; open: number; high: number; low: number; close: number; volume: number;
  /** Set by useCandles when a bad-tick wick was clamped on that side. */
  clampedLow?: boolean; clampedHigh?: boolean;
}
interface HistoryResponse { symbol: string; range: string; data: Candle[] }
export interface EHQuote { symbol: string; lastPrice: number; changePct: number }
export interface EHPayload { session?: string; gainers?: EHQuote[]; losers?: EHQuote[]; mostActive?: EHQuote[] }

/** TF → the feed's real range/interval pair. No 4h — the feed has no 4h bars. */
export const TF_CONFIG: Record<string, { range: string; interval: string; label: string }> = {
  '1m': { range: '1d', interval: '1m', label: '1M' },
  '5m': { range: '1d', interval: '5m', label: '5M' },
  '15m': { range: '1d', interval: '15m', label: '15M' },
  '1h': { range: '5d', interval: '1h', label: '1H' },
  '1D': { range: '3mo', interval: '1d', label: '1D' },
  '1W': { range: '1y', interval: '1wk', label: '1W' },
};
export const CANDLES_POLL_MS = 120_000;

/**
 * How far a wick may run past its own body before it is treated as a bad tick.
 * Measured live on SPY 5d/1h: three bars carried lows of 710/724/732 against a
 * median close of 765.75 with every neighbour at ~765 — provider corruption,
 * not trades. Deleting those bars would hide data; drawing them claims SPY
 * flash-crashed 7% in an hour. So the wick is CLAMPED to the tolerance and the
 * bar is COUNTED — the info overlay names how many, the same clip-and-say-so
 * treatment the gamma surface gives its robust-max ceiling. Tolerances widen
 * with the bar span because a 7% weekly wick can be a real crash week.
 */
const WICK_TOLERANCE: Record<string, number> = {
  '1m': 0.015, '5m': 0.02, '15m': 0.02, '1h': 0.025, '1D': 0.08, '1W': 0.15,
};

export interface CandleSeries { bars: Candle[]; clampedWicks: number }

export function useCandles(symbol: string, tf: string) {
  const cfg = TF_CONFIG[tf];
  const tol = WICK_TOLERANCE[tf] ?? 0.05;
  return useQuery<CandleSeries>({
    queryKey: ['/api/historical-prices', symbol, cfg.range, cfg.interval, 'chartlab'],
    queryFn: async () => {
      const r = await fetch(`/api/historical-prices/${symbol}?range=${cfg.range}&interval=${cfg.interval}`, { credentials: 'include' });
      if (!r.ok) throw new Error('history failed');
      const body: HistoryResponse & { error?: string } = await r.json();
      let clampedWicks = 0;
      const bars = (body.data ?? []).filter((c) =>
        // Non-positive OHLC is not a price at all.
        [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0),
      ).map((c) => {
        const bodyLo = Math.min(c.open, c.close);
        const bodyHi = Math.max(c.open, c.close);
        let { low, high } = c;
        let clampedLow = false; let clampedHigh = false;
        if (low < bodyLo * (1 - tol)) { low = bodyLo * (1 - tol); clampedLow = true; clampedWicks++; }
        if (high > bodyHi * (1 + tol)) { high = bodyHi * (1 + tol); clampedHigh = true; clampedWicks++; }
        // The feed's time is epoch SECONDS; the drawing code labels with Date(ms).
        return { ...c, low, high, clampedLow, clampedHigh, time: c.time * 1000 };
      });
      if (bars.length < 2) throw new Error(body.error ?? 'history empty');
      return { bars, clampedWicks };
    },
    staleTime: 60_000,
    refetchInterval: CANDLES_POLL_MS,
    retry: 1,
  });
}

export interface Level { price: number; color: string; label: string }
export interface Zone { from: number; to: number; color?: string; label?: string }

/* ────────────────────────────────────────────────────────────────
   THE MOCK'S CHART ENGINE — drawChart/calcMA verbatim, parameterised on the
   things React owns (canvas el, data, options) instead of module globals.
   ──────────────────────────────────────────────────────────────── */

export function calcMA(data: Candle[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    result.push(sum / period);
  }
  return result;
}

export interface DrawOpts {
  type: 'candles' | 'line';
  tf: string;
  showCrosshair: boolean;
  showLevels: boolean;
  levels: Level[];
  /** Shaded price bands (e.g. unfilled gaps) drawn under the levels. */
  zones?: Zone[];
  mouseX: number;
  mouseY: number;
  /** A sibling chart's hovered candle time — draws a synced dashed cursor
   *  when the local mouse is outside this plot. */
  syncTime?: number | null;
  onHover: (c: Candle | null, x: number, y: number) => void;
}

export function drawChart(chartCanvas: HTMLCanvasElement, candles: Candle[], opts: DrawOpts) {
  const ctx = chartCanvas.getContext('2d');
  if (!ctx) return;
  const rect = chartCanvas.getBoundingClientRect();
  const w = rect.width; const h = rect.height;
  chartCanvas.width = w * devicePixelRatio;
  chartCanvas.height = h * devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const padding = { top: 20, right: 70, bottom: 50, left: 14 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;
  const volumeH = chartH * 0.18;
  const priceH = chartH - volumeH - 10;

  let min = Infinity; let max = -Infinity; let maxVol = 0;
  candles.forEach((c) => {
    // A clamped side is a bad tick: it may not set the scale, or three broken
    // prints flatten every real bar (measured on QQQ 1h). Its wick is drawn
    // to the plot edge below instead — off-scale, stated as such.
    const lo = c.clampedLow ? Math.min(c.open, c.close) : c.low;
    const hi = c.clampedHigh ? Math.max(c.open, c.close) : c.high;
    if (lo < min) min = lo;
    if (hi > max) max = hi;
    if (c.volume > maxVol) maxVol = c.volume;
  });
  const span = max - min;
  min -= span * 0.05;
  max += span * 0.05;
  const priceRange = max - min || 1;

  // Grid + price labels
  ctx.strokeStyle = 'rgba(59,140,255, 0.05)';
  ctx.lineWidth = 1;
  const gridLines = 6;
  for (let i = 0; i <= gridLines; i++) {
    const y = padding.top + (priceH / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(w - padding.right, y);
    ctx.stroke();
    const price = max - (priceRange / gridLines) * i;
    ctx.fillStyle = 'rgba(139, 147, 163, 0.6)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(price.toFixed(2), w - padding.right + 8, y + 3);
  }

  // Time labels
  ctx.fillStyle = 'rgba(139, 147, 163, 0.5)';
  ctx.font = '9.5px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  const timeStep = Math.max(1, Math.floor(candles.length / 6));
  for (let i = 0; i < candles.length; i += timeStep) {
    const x = padding.left + (i / (candles.length - 1)) * chartW;
    const d = new Date(candles[i].time);
    const label = opts.tf === '1D' || opts.tf === '1W'
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    ctx.fillText(label, x, h - padding.bottom + 16);
  }

  // Shaded zones (gap bands etc.) under everything else
  for (const z of opts.zones ?? []) {
    const top = Math.max(z.from, z.to); const bot = Math.min(z.from, z.to);
    if (bot > max || top < min) continue;
    const y1 = padding.top + ((max - Math.min(top, max)) / priceRange) * priceH;
    const y2 = padding.top + ((max - Math.max(bot, min)) / priceRange) * priceH;
    ctx.fillStyle = (z.color ?? '#facc15') + '14';
    ctx.fillRect(padding.left, y1, chartW, Math.max(1, y2 - y1));
    if (z.label) {
      ctx.fillStyle = (z.color ?? '#facc15') + '99';
      ctx.font = '700 8px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(z.label, w - padding.right - 4, y1 + 9);
    }
  }

  // Published levels — the real ones, drawn the mock's way
  if (opts.showLevels) {
    opts.levels.forEach((lvl) => {
      if (lvl.price >= min && lvl.price <= max) {
        const y = padding.top + ((max - lvl.price) / priceRange) * priceH;
        ctx.strokeStyle = lvl.color + '40';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = lvl.color;
        ctx.font = '700 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(lvl.label, padding.left + 4, y - 3);
      }
    });
  }

  // Moving averages
  const ma20 = calcMA(candles, 20);
  const ma50 = calcMA(candles, 50);
  const strokeMA = (ma: (number | null)[], style: string) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let started = false;
    ma.forEach((v, i) => {
      if (v === null) return;
      const x = padding.left + (i / (candles.length - 1)) * chartW;
      const y = padding.top + ((max - v) / priceRange) * priceH;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  strokeMA(ma50, 'rgba(167, 139, 250, 0.6)');
  strokeMA(ma20, 'rgba(59,140,255, 0.7)');

  // Volume bars
  const volTop = padding.top + priceH + 10;
  const candleW = chartW / candles.length;
  candles.forEach((c, i) => {
    const x = padding.left + i * candleW;
    const barH = maxVol > 0 ? (c.volume / maxVol) * volumeH : 0;
    ctx.fillStyle = c.close >= c.open ? 'rgba(110,231,183, 0.25)' : 'rgba(255,107,61, 0.25)';
    ctx.fillRect(x + candleW * 0.15, volTop + volumeH - barH, candleW * 0.7, barH);
  });

  // Hovered candle detection
  let hoveredIdx = -1;
  const inPlot = opts.showCrosshair
    && opts.mouseX > padding.left && opts.mouseX < w - padding.right
    && opts.mouseY > padding.top && opts.mouseY < padding.top + priceH;
  if (inPlot) {
    const idx = Math.floor((opts.mouseX - padding.left) / candleW);
    if (idx >= 0 && idx < candles.length) hoveredIdx = idx;
  }

  // Synced cursor from a sibling chart (cockpit crosshair sync): when the
  // local mouse is elsewhere, mark the sibling's hovered TIME on this chart's
  // own axis — nearest candle, dashed, unobtrusive.
  if (!inPlot && opts.syncTime != null && candles.length > 1) {
    let best = -1; let bestD = Infinity;
    for (let i = 0; i < candles.length; i++) {
      const d = Math.abs(candles[i].time - opts.syncTime);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      const sx = padding.left + best * candleW + candleW / 2;
      ctx.strokeStyle = 'rgba(110,231,219,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(sx, padding.top); ctx.lineTo(sx, padding.top + priceH); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Candles or line
  if (opts.type === 'candles') {
    candles.forEach((c, i) => {
      const x = padding.left + i * candleW;
      const cx = x + candleW / 2;
      const isUp = c.close >= c.open;
      const color = isUp ? '#6ee7b7' : '#ff6b3d';
      const openY = padding.top + ((max - c.open) / priceRange) * priceH;
      const closeY = padding.top + ((max - c.close) / priceRange) * priceH;
      const highY = c.clampedHigh ? padding.top : padding.top + ((max - c.high) / priceRange) * priceH;
      const lowY = c.clampedLow ? padding.top + priceH : padding.top + ((max - c.low) / priceRange) * priceH;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, highY);
      ctx.lineTo(cx, lowY);
      ctx.stroke();
      const bodyTop = Math.min(openY, closeY);
      const bodyH = Math.max(Math.abs(closeY - openY), 1);
      const bodyW = candleW * 0.7;
      ctx.fillStyle = color;
      ctx.fillRect(cx - bodyW / 2, bodyTop, bodyW, bodyH);
      if (i === hoveredIdx) {
        ctx.fillStyle = color + '30';
        ctx.fillRect(x, padding.top, candleW, priceH + volumeH + 10);
      }
    });
  } else {
    const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + priceH);
    grad.addColorStop(0, 'rgba(59,140,255, 0.25)');
    grad.addColorStop(1, 'rgba(59,140,255, 0)');
    ctx.beginPath();
    candles.forEach((c, i) => {
      const x = padding.left + (i / (candles.length - 1)) * chartW;
      const y = padding.top + ((max - c.close) / priceRange) * priceH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(padding.left + chartW, padding.top + priceH);
    ctx.lineTo(padding.left, padding.top + priceH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    candles.forEach((c, i) => {
      const x = padding.left + (i / (candles.length - 1)) * chartW;
      const y = padding.top + ((max - c.close) / priceRange) * priceH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#3b8cff';
    ctx.lineWidth = 1.8;
    ctx.shadowColor = '#3b8cff';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Current price line + tag
  const lastCandle = candles[candles.length - 1];
  const lastY = padding.top + ((max - lastCandle.close) / priceRange) * priceH;
  ctx.strokeStyle = 'rgba(59,140,255, 0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(padding.left, lastY);
  ctx.lineTo(w - padding.right, lastY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#3b8cff';
  ctx.fillRect(w - padding.right, lastY - 9, 60, 18);
  ctx.fillStyle = '#031917';
  ctx.font = '700 10px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(lastCandle.close.toFixed(2), w - padding.right + 6, lastY + 3);

  // Crosshair
  if (inPlot) {
    ctx.strokeStyle = 'rgba(59,140,255, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(opts.mouseX, padding.top);
    ctx.lineTo(opts.mouseX, padding.top + priceH + volumeH + 10);
    ctx.moveTo(padding.left, opts.mouseY);
    ctx.lineTo(w - padding.right, opts.mouseY);
    ctx.stroke();
    ctx.setLineDash([]);
    const cursorPrice = max - ((opts.mouseY - padding.top) / priceH) * priceRange;
    ctx.fillStyle = 'rgba(14,17,23,0.9)';
    ctx.fillRect(w - padding.right, opts.mouseY - 9, 60, 18);
    ctx.strokeStyle = 'rgba(59,140,255, 0.5)';
    ctx.strokeRect(w - padding.right, opts.mouseY - 9, 60, 18);
    ctx.fillStyle = '#e8ecf3';
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(cursorPrice.toFixed(2), w - padding.right + 6, opts.mouseY + 3);
    if (hoveredIdx >= 0) opts.onHover(candles[hoveredIdx], opts.mouseX, opts.mouseY);
    else opts.onHover(null, 0, 0);
  } else {
    opts.onHover(null, 0, 0);
  }
}

