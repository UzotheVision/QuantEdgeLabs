/**
 * Interactive sparkline — real series, hover crosshair + date/price tooltip.
 * Extracted from the landing page so the Pattern Radar previews (and any
 * future mini-chart) share one implementation. Renders nothing clever when
 * the series is missing: a labeled empty state, never a synthetic line.
 */
import { useEffect, useRef, useState } from 'react';

export interface SparkBar { time: number; close: number }

export function Spark({ bars, color, height = 60, label }: { bars: SparkBar[]; color: string; height?: number; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);

  const draw = (hoverIdx: number | null) => {
    const canvas = canvasRef.current;
    if (!canvas || bars.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = devicePixelRatio;
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const data = bars.map((b) => b.close);
    const min = Math.min(...data); const max = Math.max(...data);
    const range = max - min || 1;
    const X = (i: number) => (i / (data.length - 1)) * w;
    const Y = (v: number) => h - ((v - min) / range) * h * 0.85 - h * 0.05;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '40'); grad.addColorStop(1, color + '00');
    ctx.beginPath();
    data.forEach((v, i) => { i === 0 ? ctx.moveTo(X(i), Y(v)) : ctx.lineTo(X(i), Y(v)); });
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    data.forEach((v, i) => { i === 0 ? ctx.moveTo(X(i), Y(v)) : ctx.lineTo(X(i), Y(v)); });
    ctx.strokeStyle = color; ctx.lineWidth = 1.3;
    ctx.shadowColor = color; ctx.shadowBlur = 6;
    ctx.stroke(); ctx.shadowBlur = 0;
    if (hoverIdx != null && data[hoverIdx] != null) {
      const hx = X(hoverIdx); const hy = Y(data[hoverIdx]);
      ctx.strokeStyle = 'rgba(232,236,243,0.25)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2); ctx.fill();
    }
  };

  useEffect(() => { draw(null); /* eslint-disable-next-line */ }, [bars, color]);

  const onMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || bars.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(frac * (bars.length - 1));
    const bar = bars[idx];
    if (!bar) return;
    draw(idx);
    const first = bars[0].close;
    const chg = first > 0 ? ((bar.close - first) / first) * 100 : 0;
    const d = new Date(bar.time < 2e10 ? bar.time * 1000 : bar.time);
    const when = bars.length > 80
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    setTip({ x: (idx / (bars.length - 1)) * rect.width, text: `${when} · $${bar.close >= 1000 ? Math.round(bar.close).toLocaleString() : bar.close.toFixed(2)} (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%)` });
  };

  if (bars.length < 2) {
    return <div style={{ height, display: 'grid', placeItems: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)' }}>{label ?? 'loading series…'}</div>;
  }
  return (
    <div style={{ position: 'relative', height }} onMouseMove={onMove} onMouseLeave={() => { setTip(null); draw(null); }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} />
      {tip && <div className="lspark-tip" style={{ left: tip.x, top: 12 }}>{tip.text}</div>}
    </div>
  );
}
