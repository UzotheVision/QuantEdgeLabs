/**
 * NexusPriceChart — the CHART tab's engine as a drop-in component.
 *
 * One chart everywhere: CHART, the cockpit, GEX and any panel that needs price
 * render the SAME interactive canvas — real OHLCV, timeframe bar, candles/line
 * toggle, MA20/50, volume, crosshair with OHLCV tooltip, published levels, gap
 * zones, outlier-wick clamping with the on-chart disclosure.
 *
 * Interaction model (the "can't scroll to see other bars" fix):
 *   wheel        zoom in/out, anchored on the bar under the cursor
 *   drag         pan through history
 *   double-click reset to the full range
 *   ⤢            expand into a modal over a blurred backdrop
 *
 * Pan/zoom is a windowed VIEW over the real series — never resampled, never
 * interpolated: `span` bars ending `offset` bars before the latest.
 */
import { useEffect, useRef, useState } from 'react';
import {
  drawChart, useCandles, TF_CONFIG,
  type Candle, type Level, type Zone,
} from '@/components/charting/chart-engine';
import '@/styles/nexus.css';

const MIN_SPAN = 15;

const SYNC_BUS = new Map<string, Set<(t: number | null) => void>>();

export function NexusPriceChart({
  symbol,
  initialTf = '1D',
  height = 340,
  levels = [],
  zones = [],
  fill = false,
  expandable = true,
  onHoverCandle,
  syncGroup,
}: {
  symbol: string;
  initialTf?: keyof typeof TF_CONFIG;
  height?: number;
  levels?: (Level & { dashed?: boolean })[];
  zones?: Zone[];
  /** Fill the parent (flex:1) instead of a fixed height — for page layouts. */
  fill?: boolean;
  /** Show the ⤢ button that opens the blurred-backdrop modal. */
  expandable?: boolean;
  /** Hovered (or latest) candle — for external OHLC readouts. */
  onHoverCandle?: (c: Candle | null) => void;
  /** Charts sharing a group share a crosshair: hovering one marks the same
   *  time on the others. */
  syncGroup?: string;
}) {
  const [tf, setTf] = useState<keyof typeof TF_CONFIG>(
    TF_CONFIG[initialTf] ? initialTf : '1D',
  );
  const [type, setType] = useState<'candles' | 'line'>('candles');
  const [expanded, setExpanded] = useState(false);
  const { data: series, isLoading, isError } = useCandles(symbol, tf);
  const all = series?.bars;

  /* windowed view over the series: span bars, ending `offset` bars before now */
  const [view, setView] = useState<{ span: number | null; offset: number }>({ span: null, offset: 0 });
  useEffect(() => { setView({ span: null, offset: 0 }); }, [symbol, tf]);
  const len = all?.length ?? 0;
  const span = view.span == null ? len : Math.min(view.span, len);
  const offset = Math.min(view.offset, Math.max(0, len - span));
  const candles = all ? all.slice(Math.max(0, len - span - offset), len - offset) : undefined;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: -1, y: -1 });
  const pan = useRef<{ startX: number; startOffset: number; moved: boolean } | null>(null);
  const touch = useRef<{ x: number; offset: number; dist: number | null; span: number } | null>(null);
  const syncTime = useRef<number | null>(null);
  const publishSync = (t: number | null) => {
    if (!syncGroup) return;
    const set = SYNC_BUS.get(syncGroup);
    if (!set) return;
    set.forEach((fn) => { if (fn !== syncListener.current) fn(t); });
  };
  const syncListener = useRef<(t: number | null) => void>(() => {});
  useEffect(() => {
    if (!syncGroup) return;
    const fn = (t: number | null) => { syncTime.current = t; redraw(); };
    syncListener.current = fn;
    if (!SYNC_BUS.has(syncGroup)) SYNC_BUS.set(syncGroup, new Set());
    SYNC_BUS.get(syncGroup)!.add(fn);
    return () => { SYNC_BUS.get(syncGroup)?.delete(fn); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncGroup]);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !candles || candles.length < 2) return;
    drawChart(canvas, candles, {
      type, tf, showCrosshair: true, showLevels: true,
      levels: levels.filter((l) => Number.isFinite(l.price)),
      zones,
      mouseX: mouse.current.x,
      mouseY: mouse.current.y,
      syncTime: syncTime.current,
      onHover: (c: Candle | null, x: number, y: number) => {
        onHoverCandle?.(c ?? (candles ? candles[candles.length - 1] : null));
        publishSync(c?.time ?? null);
        const tip = tipRef.current; const wrap = wrapRef.current;
        if (!tip || !wrap) return;
        if (!c || pan.current?.moved) { tip.classList.remove('show'); return; }
        const d = new Date(c.time);
        tip.querySelector('[data-tip=time]')!.textContent = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
        tip.querySelector('[data-tip=o]')!.textContent = c.open.toFixed(2);
        tip.querySelector('[data-tip=h]')!.textContent = c.high.toFixed(2);
        tip.querySelector('[data-tip=l]')!.textContent = c.low.toFixed(2);
        const tc = tip.querySelector('[data-tip=c]') as HTMLElement;
        tc.textContent = c.close.toFixed(2);
        tc.className = 'v ' + (c.close >= c.open ? 'up' : 'down');
        tip.querySelector('[data-tip=v]')!.textContent = c.volume > 0 ? (c.volume / 1e6).toFixed(2) + 'M' : '—';
        const rect = wrap.getBoundingClientRect();
        let tx = x + 16; let ty = y - 60;
        if (tx + 180 > rect.width) tx = x - 180;
        if (ty < 10) ty = y + 16;
        tip.style.left = tx + 'px';
        tip.style.top = ty + 'px';
        tip.classList.add('show');
      },
    });
  };

  useEffect(() => { redraw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [candles, type, tf, levels, zones]);
  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, type, tf, levels, zones]);

  /* wheel zoom — native listener so preventDefault actually stops page scroll */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!all || all.length < MIN_SPAN) return;
      e.preventDefault();
      setView((v) => {
        const curSpan = v.span == null ? all.length : Math.min(v.span, all.length);
        // Delta-proportional zoom. The old fixed 1.25x step compounded per
        // EVENT, and a trackpad fires dozens of small-delta events per flick —
        // one gesture blew through the whole range. exp(delta·k) makes a small
        // trackpad delta a small zoom and a full wheel notch (~100) about 16%;
        // line-mode wheels (deltaMode 1) are normalised to pixels first.
        const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
        const factor = Math.exp(Math.max(-160, Math.min(160, delta)) * 0.0015);
        const nextSpan = Math.round(Math.max(MIN_SPAN, Math.min(all.length, curSpan * factor)));
        if (nextSpan >= all.length) return { span: null, offset: 0 };
        // anchor: keep the bar under the cursor roughly in place
        const rect = el.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const anchor = all.length - v.offset - Math.round((1 - frac) * curSpan);
        const nextOffset = Math.max(0, Math.min(all.length - nextSpan, all.length - anchor - Math.round(frac * nextSpan)));
        return { span: nextSpan, offset: nextOffset };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [all]);

  const chartBody = (
    <>
      {isLoading ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
          loading {symbol} · {TF_CONFIG[tf].label}…
        </div>
      ) : isError || !candles?.length ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
          no price history for {symbol} at {TF_CONFIG[tf].label}
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          style={{ cursor: pan.current ? 'grabbing' : 'crosshair', touchAction: 'none' }}
          onTouchStart={(e) => {
            if (!all) return;
            if (e.touches.length === 2) {
              const dx = e.touches[0].clientX - e.touches[1].clientX;
              const dy = e.touches[0].clientY - e.touches[1].clientY;
              touch.current = { x: 0, offset, dist: Math.hypot(dx, dy), span };
            } else if (e.touches.length === 1) {
              touch.current = { x: e.touches[0].clientX, offset, dist: null, span };
            }
          }}
          onTouchMove={(e) => {
            const t0 = touch.current;
            if (!t0 || !all) return;
            e.preventDefault();
            if (e.touches.length === 2 && t0.dist != null) {
              // pinch: scale the visible span around the current window
              const dx = e.touches[0].clientX - e.touches[1].clientX;
              const dy = e.touches[0].clientY - e.touches[1].clientY;
              const scale = t0.dist / Math.max(20, Math.hypot(dx, dy));
              const nextSpan = Math.round(Math.min(all.length, Math.max(20, t0.span * scale)));
              setView((v) => ({ span: nextSpan, offset: Math.min(v.offset, Math.max(0, all.length - nextSpan)) }));
            } else if (e.touches.length === 1 && t0.dist == null) {
              const wrap = wrapRef.current;
              const width = wrap?.clientWidth || 1;
              const perPx = span / width;
              const delta = Math.round((e.touches[0].clientX - t0.x) * perPx);
              setView((v) => ({ ...v, offset: Math.max(0, Math.min(Math.max(0, all.length - span), t0.offset + delta)) }));
            }
          }}
          onTouchEnd={() => { touch.current = null; }}
          onMouseDown={(e) => {
            pan.current = { startX: e.clientX, startOffset: offset, moved: false };
          }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            if (pan.current && all) {
              const dx = e.clientX - pan.current.startX;
              if (Math.abs(dx) > 3) pan.current.moved = true;
              const barW = rect.width / Math.max(1, span);
              const dBars = Math.round(dx / barW);
              setView((v) => ({
                span: v.span,
                offset: Math.max(0, Math.min(len - span, pan.current!.startOffset + dBars)),
              }));
            }
            redraw();
          }}
          onMouseUp={() => { pan.current = null; redraw(); }}
          onMouseLeave={() => { pan.current = null; mouse.current = { x: -1, y: -1 }; redraw(); }}
          onDoubleClick={() => setView({ span: null, offset: 0 })}
        />
      )}

      <div className="timeframe-bar" style={{ top: 8, left: 8 }}>
        {(Object.keys(TF_CONFIG) as (keyof typeof TF_CONFIG)[]).map((k) => (
          <button key={k} className={`tf-btn${tf === k ? ' active' : ''}`} style={{ padding: '3px 8px' }} onClick={() => setTf(k)}>{k}</button>
        ))}
      </div>
      <div className="chart-type-toggle" style={{ position: 'absolute', top: 8, right: 8, zIndex: 3, display: 'flex', gap: 2 }}>
        {(['candles', 'line'] as const).map((t) => (
          <button key={t} className={`chart-type-btn${type === t ? ' active' : ''}`} onClick={() => setType(t)}>{t}</button>
        ))}
        {expandable && !expanded && (
          <button className="chart-type-btn" title="Expand" onClick={() => setExpanded(true)}>⤢</button>
        )}
      </div>

      <div className="chart-info-overlay" style={{ bottom: 8, left: 8, padding: '4px 8px' }}>
        <span>TF <b>{TF_CONFIG[tf].label}</b></span>
        <span>BARS <b>{candles?.length ?? 0}{view.span != null ? ` / ${len}` : ''}</b></span>
        {view.span != null
          ? <span style={{ color: 'var(--cyan-bright)' }}>drag · wheel · dbl-click resets</span>
          : <span>wheel zoom · drag pan</span>}
        {(series?.clampedWicks ?? 0) > 0 && (
          <span style={{ color: 'var(--amber)' }}>{series!.clampedWicks} OUTLIER WICK{series!.clampedWicks === 1 ? '' : 'S'} CLAMPED</span>
        )}
      </div>

      <div className="crosshair-tip" ref={tipRef}>
        <div className="row"><span className="k">Time</span><span className="v" data-tip="time">—</span></div>
        <div className="row"><span className="k">Open</span><span className="v" data-tip="o">—</span></div>
        <div className="row"><span className="k">High</span><span className="v" data-tip="h">—</span></div>
        <div className="row"><span className="k">Low</span><span className="v" data-tip="l">—</span></div>
        <div className="row"><span className="k">Close</span><span className="v" data-tip="c">—</span></div>
        <div className="row"><span className="k">Volume</span><span className="v" data-tip="v">—</span></div>
      </div>
    </>
  );

  return (
    <>
      <div
        ref={wrapRef}
        className="chart-canvas-wrap"
        style={fill
          ? { flex: 1, minHeight: 0, position: 'relative' }
          : { height, flex: 'none', borderRadius: 6, border: '1px solid var(--nx-border, rgba(59,140,255,0.08))' }}
      >
        {chartBody}
      </div>

      {/* mini-expand: same chart, big, over a blurred backdrop. A separate
          instance so the small one keeps its own view when this closes. */}
      {expanded && (
        <div className="chart-modal" onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}>
          <div className="chart-modal-box">
            <div className="chart-modal-head">
              <span className="chart-modal-title">{symbol} · price</span>
              <button className="chart-modal-close" onClick={() => setExpanded(false)}>ESC ✕</button>
            </div>
            <div className="chart-modal-body">
              <NexusPriceChart
                symbol={symbol}
                initialTf={tf}
                levels={levels}
                zones={zones}
                fill
                expandable={false}
              />
            </div>
          </div>
        </div>
      )}
      {expanded && <EscClose onClose={() => setExpanded(false)} />}
    </>
  );
}

function EscClose({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return null;
}
