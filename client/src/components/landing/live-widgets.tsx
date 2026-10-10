/**
 * Live landing widgets — the interactive sparkline, the rotation quadrant and
 * the signal card. Shared by the marketing landing page and the signed-in
 * Today page so both show the same real data in the same visual language.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { convictionDisplayPercent } from '@shared/conviction-display';

export interface Bar { time: number; open: number; high: number; low: number; close: number }
export interface Sector { etf: string; name: string; change: number; relChange?: number; fiveDayChange?: number; rsRatio?: number; rsMomentum?: number; state?: string; rank?: number }
export interface RotationPayload { asOf?: string; isStale?: boolean; sessionLabel?: string; spyChange?: number; sectors?: Sector[] }
export interface Pick {
  symbol: string; direction?: string | null; tradeType?: string | null; thesis?: string | null;
  entryPrice?: number | null; stopLoss?: number | null; targetPrice?: number | null; riskRewardRatio?: number | null;
  convictionScore?: number | null; publishedConvictionBand?: string | null; convictionBand?: string | null;
  currentPrice?: number | null;
}
export interface ConvictionsPayload { generatedAt?: string; picks?: Pick[] }
export interface CryptoPulse { assets?: { symbol: string; price: number; change24h?: number | null }[] }

export const fetchJson = (url: string) => async () => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`${url} failed`);
  return r.json();
};

/* ── Interactive sparkline: real series, hover crosshair + tooltip ── */
export function Spark({ bars, color, height = 60, label }: { bars: Bar[]; color: string; height?: number; label?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

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
      ctx.strokeStyle = 'rgba(232,236,243,0.25)'; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(hx, hy, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.stroke();
    }
  };

  useEffect(() => { draw(null); /* eslint-disable-next-line */ }, [bars, color]);

  const onMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current; const wrap = wrapRef.current;
    if (!canvas || !wrap || bars.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(frac * (bars.length - 1));
    const bar = bars[idx];
    if (!bar) return;
    draw(idx);
    const first = bars[0].close;
    const chg = first > 0 ? ((bar.close - first) / first) * 100 : 0;
    const d = new Date(bar.time * 1000);
    const when = bars.length > 80
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    setTip({
      x: (idx / (bars.length - 1)) * rect.width,
      y: 0,
      text: `${when} · $${bar.close >= 1000 ? Math.round(bar.close).toLocaleString() : bar.close.toFixed(2)} (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%)`,
    });
  };
  const onLeave = () => { setTip(null); draw(null); };

  if (bars.length < 2) {
    return <div style={{ height, display: 'grid', placeItems: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)' }}>{label ?? 'loading series…'}</div>;
  }
  return (
    <div ref={wrapRef} style={{ position: 'relative', height }} onMouseMove={onMove} onMouseLeave={onLeave}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} />
      {tip && <div className="lspark-tip" style={{ left: tip.x, top: 12 }}>{tip.text}</div>}
    </div>
  );
}

export function useDaily(symbol: string, range: string, interval: string, enabled = true) {
  return useQuery<{ data?: Bar[] }>({
    queryKey: ['/api/historical-prices', symbol, range, interval, 'landing'],
    queryFn: fetchJson(`/api/historical-prices/${symbol}?range=${range}&interval=${interval}`),
    staleTime: 120_000, retry: 1, enabled,
  });
}

/* Real rotation quadrant: rsRatio × rsMomentum, gentle cosmetic drift only. */
export function RotQuad({ sectors, height = 260 }: { sectors: Sector[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const pts = sectors.filter((s) => Number.isFinite(s.rsRatio) && Number.isFinite(s.rsMomentum));
    if (!pts.length) return;
    const xs = pts.map((s) => s.rsRatio!); const ys = pts.map((s) => s.rsMomentum!);
    const xMax = Math.max(1, ...xs.map(Math.abs)); const yMax = Math.max(1, ...ys.map(Math.abs));
    const phase = new Map(pts.map((s, i) => [s.etf, i * 1.7]));
    const colorOf = (s: Sector) => (s.rsRatio! >= 0 && s.rsMomentum! >= 0) ? '#6ee7b7' : (s.rsRatio! < 0 && s.rsMomentum! >= 0) ? '#3b8cff' : (s.rsRatio! >= 0) ? '#facc15' : '#ff6b3d';
    const drawFrame = (t: number) => {
      const canvas = ref.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width; const h = rect.height;
      if (w === 0) { raf = requestAnimationFrame(drawFrame); return; }
      canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      ctx.strokeStyle = 'rgba(59,140,255,0.15)'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      ctx.setLineDash([]);
      pts.forEach((s) => {
        const px = w / 2 + (s.rsRatio! / xMax) * (w * 0.42) + Math.sin(t * 0.0005 + phase.get(s.etf)!) * 1.5;
        const py = h / 2 - (s.rsMomentum! / yMax) * (h * 0.42) + Math.cos(t * 0.0007 + phase.get(s.etf)!) * 1.5;
        const c = colorOf(s);
        const r = parseInt(c.slice(1, 3), 16); const g = parseInt(c.slice(3, 5), 16); const b = parseInt(c.slice(5, 7), 16);
        const grad = ctx.createRadialGradient(px, py, 0, px, py, 12);
        grad.addColorStop(0, `rgba(${r},${g},${b},0.5)`); grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '700 8px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
        ctx.fillText(s.etf, px, py - 10);
      });
      raf = requestAnimationFrame(drawFrame);
    };
    raf = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(raf);
  }, [sectors]);
  const hasPts = sectors.some((pt) => Number.isFinite(pt.rsRatio) && Number.isFinite(pt.rsMomentum));
  if (!hasPts) {
    return <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)', fontStyle: 'italic' }}>loading map…</div>;
  }
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}

export const CHECK = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>;

export function SigCard({ p }: { p: Pick }) {
  const { data } = useDaily(p.symbol, '1mo', '1d');
  const bars = data?.data ?? [];
  const band = (p.publishedConvictionBand ?? p.convictionBand ?? 'C').charAt(0);
  const dir = (p.direction ?? 'long').toLowerCase();
  const bandColor = band === 'S' ? '#fbbf24' : band === 'A' ? '#3b8cff' : band === 'B' ? '#facc15' : '#8b93a3';
  const live = p.currentPrice; const entry = p.entryPrice;
  const pnl = live != null && entry ? ((live - entry) / entry) * (dir === 'short' ? -100 : 100) : null;
  const fmt = (v?: number | null) => v == null ? '—' : `$${v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2)}`;
  return (
    <Link href="/t" className="lsig-card" style={{ ['--band-color' as string]: bandColor, display: 'block' }}>
      <div className="lsig-head">
        <div className="lsig-ticker">{p.symbol}</div>
        <div className="lsig-band" style={{ background: `${bandColor}26`, color: bandColor, border: `1px solid ${bandColor}4d` }}>{band}</div>
        <div className="lsig-ev"><b>{convictionDisplayPercent(p.convictionScore ?? 0)}</b>/100 evidence{pnl != null && <span style={{ marginLeft: 8, color: pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}%</span>}</div>
      </div>
      <div className="lsig-type">
        <span className={`dir ${dir === 'short' ? 'bear' : 'bull'}`}>{dir === 'short' ? '▼ BEAR' : '▲ BULL'}</span>
        <span className="kind">· {p.tradeType ?? 'swing'}{p.thesis ? ` · ${p.thesis.split('.')[0].slice(0, 34)}` : ''}</span>
      </div>
      <div className="lsig-chart"><Spark bars={bars} color={dir === 'short' ? '#ff6b3d' : '#6ee7b7'} height={56} /></div>
      <div className="lsig-levels">
        <div className="lsig-level"><div className="l">Entry</div><div className="v">{fmt(p.entryPrice)}</div></div>
        <div className="lsig-level"><div className="l">Stop</div><div className="v stop">{fmt(p.stopLoss)}</div></div>
        <div className="lsig-level"><div className="l">T1</div><div className="v t1">{fmt(p.targetPrice)}</div></div>
        <div className="lsig-level"><div className="l">R:R</div><div className="v rr">{p.riskRewardRatio != null ? `${Number(p.riskRewardRatio).toFixed(1)}:1` : '—'}</div></div>
      </div>
    </Link>
  );
}

