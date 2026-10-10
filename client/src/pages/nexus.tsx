/**
 * NEXUS — the operator's reference terminal, wired.
 *
 * This is the reference mock USED AS AUTHORED — its stylesheet is embedded
 * verbatim below, its DOM structure is reproduced class-for-class, and its
 * canvas code (background particles, rotation quadrant, card charts, watch
 * sparks) is the mock's own drawing code. Three mechanical transforms only,
 * required to run inside a routed app instead of owning the document:
 *
 *   html,body{...} and body{...}  →  .nexus-root{...}
 *   body::before / body::after    →  .nexus-root::before / ::after
 *   element ids                   →  refs (React owns the DOM)
 *
 * WHAT IS WIRED (the only substantive change): every hardcoded array in the
 * mock is replaced by the real feed that slot describes.
 *
 *   ticker tape        /api/extended-hours          real movers, real session
 *   stream rows        /api/realtime-status         ES/NQ/CL + BTC/ETH with the
 *                                                   socket's OWN ageSeconds —
 *                                                   the ages tick because the
 *                                                   feed is live, not setTimeout
 *   cash rotation      /api/sector-rotation         leaders/laggards
 *   rotation map       /api/sector-rotation         x=rsRatio y=rsMomentum
 *   time & sales       /api/options-flow            real detected flow prints;
 *                                                   side chip is CALL/PUT, not
 *                                                   the mock's coin-flip BUY/SELL
 *                                                   — direction is not measured
 *                                                   and is not claimed (4ce5213)
 *   session brief      /api/sector-rotation         the feed's own headline
 *   signal cards       /api/convictions             the live book
 *   card charts        /api/historical-prices       real 5d closes
 *   heatmap            /api/sector-rotation
 *   watchlist          /api/watchlist + tape quotes
 *   sys status         /api/health, /api/automations/status, /api/market-pulse
 *
 * The mock's price-jitter loop does not run: prices move when the feed moves.
 * Its filter buttons, which only toggled classes, now actually filter.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { openWorkup } from '@/lib/workup-bus';
import { Spark } from '@/components/charting/spark';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { usePriceHistory } from '@/components/hunt/cockpit/use-price-history';
import { geometryFor } from '@/components/oracle/signal-detail';
import { useTheme } from '@/components/theme-provider';
import { useColResize } from '@/lib/use-col-resize';
import { useStockContext } from '@/contexts/stock-context';
import type { ConvictionPick, ConvictionsResponse } from '@/lib/convictions';
import quantEdgeLogoUrl from '@assets/qe-mark.svg';
// The cockpit — the deep single-signal read — mounts on demand behind the
// board's view toggle. Same component the old Active Book used.
const HuntCockpit = lazy(() => import('@/pages/shells/hunt-cockpit'));
const TickerWorkup = lazy(() => import('@/components/workup/ticker-workup').then(m => ({ default: m.TickerWorkup })));
import '@/styles/nexus.css';
import { usePrefs, orderOf } from '@/lib/board-prefs';
import { CustomizePanel } from '@/components/shell/customize-panel';

/** Radar hover-preview: the pattern\'s real 1mo series + its defining levels.
 *  Interaction reveals measured data (interactivity plan rule #1). */
function RadarPreview({ symbol, note, x, y }: { symbol: string; note: string; x: number; y: number }) {
  const { data } = useQuery<{ data?: { time: number; close: number }[] }>({
    queryKey: ['/api/historical-prices', symbol, '1mo', 'radar'],
    queryFn: async () => {
      const r = await fetch(`/api/historical-prices/${symbol}?range=1mo&interval=1d`, { credentials: 'include' });
      if (!r.ok) throw new Error('bars failed');
      return r.json();
    },
    staleTime: 300_000, retry: 1,
  });
  return (
    <div style={{ position: 'fixed', left: Math.min(x, window.innerWidth - 250), top: y + 14, width: 236, zIndex: 90, background: 'linear-gradient(135deg, var(--panel-solid), var(--panel-2))', border: '1px solid var(--nx-border-hi)', borderRadius: 8, padding: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.6)', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 13 }}>
        {symbol}
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', fontWeight: 600 }}>1mo · real bars</span>
      </div>
      <Spark bars={(data?.data ?? []).map((b) => ({ time: b.time, close: b.close }))} color="#3b8cff" height={54} />
      <div style={{ marginTop: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-dim)', lineHeight: 1.5 }}>{note}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   THE MOCK'S STYLESHEET, VERBATIM (body → .nexus-root only).
   ════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════
   DATA — the real feeds behind each slot.
   ════════════════════════════════════════════════════════════════ */

interface EHQuote { symbol: string; lastPrice: number; changePct: number }
interface EHPayload {
  session?: string; isStale?: boolean;
  gainers?: EHQuote[]; losers?: EHQuote[]; mostActive?: EHQuote[]; assetClasses?: EHQuote[];
}
interface Sector {
  etf: string; name: string; change: number; rsRatio: number; rsMomentum: number; state?: string;
}
interface RotationPayload {
  asOf?: string; sessionLabel?: string; spyChange?: number; headline?: string;
  leaders?: Sector[]; laggards?: Sector[]; sectors?: Sector[];
}
const NEXUS_ROTATION_NAMES: Record<string, string[]> = {
  SMH: ['SMH', 'MU', 'SNDK', 'AMD', 'AVGO', 'ARM'], XLK: ['MSFT', 'AAPL', 'ORCL', 'QCOM'],
  IGV: ['NOW', 'CRM', 'ADBE', 'DDOG'], XLC: ['META', 'GOOG', 'NFLX', 'TTD'],
  XLV: ['LLY', 'JNJ', 'UNH', 'MRK'], XBI: ['VRTX', 'REGN', 'MRNA', 'GILD'],
  XLF: ['JPM', 'GS', 'BAC', 'AFRM'], XLE: ['XOM', 'CVX', 'COP', 'SLB'],
  XLI: ['CAT', 'GE', 'BA', 'DE'], XLY: ['AMZN', 'TSLA', 'HD', 'NKE'],
};
interface RealtimePayload {
  prices?: {
    futures?: Record<string, { price: number; ageSeconds: number }>;
    crypto?: Record<string, { price: number; ageSeconds: number }>;
  };
}
interface FlowTrade {
  id: string; symbol: string; optionType: 'call' | 'put'; strikePrice: number;
  totalPremium: number; flowType?: string; detectedAt: string;
}

const q = (path: string) => async () => {
  const r = await fetch(path, { credentials: 'include' });
  if (!r.ok) throw new Error(`${path} failed`);
  return r.json();
};

function useNexusData() {
  const realtime = useQuery<RealtimePayload>({
    queryKey: ['/api/realtime-status', 'nexus'], queryFn: q('/api/realtime-status'),
    refetchInterval: 5_000, staleTime: 4_000, retry: 1,
  });
  // Pattern Radar — the full-universe engine's raw detections. Visible even
  // when the funnel declines them: detection and selection are separate jobs,
  // and the operator sees both.
  const patterns = useQuery<{ asOf: string | null; scanned: number; hits: { symbol: string; pattern: string; bias: string; note: string; levels: Record<string, number> }[] }>({
    queryKey: ['/api/patterns/scan', 'nexus'],
    queryFn: async () => {
      const r = await fetch('/api/patterns/scan', { credentials: 'include' });
      if (!r.ok) throw new Error('patterns failed');
      return r.json();
    },
    refetchInterval: 600_000, staleTime: 300_000, retry: 1,
  });

  const rotation = useQuery<RotationPayload>({
    queryKey: ['/api/sector-rotation', 'nexus'], queryFn: q('/api/sector-rotation'),
    refetchInterval: 180_000, staleTime: 120_000, retry: 1,
  });
  const extended = useQuery<EHPayload>({
    queryKey: ['/api/extended-hours', 'nexus'], queryFn: q('/api/extended-hours'),
    refetchInterval: 30_000, staleTime: 20_000, retry: 1,
  });
  const convictions = useQuery<ConvictionsResponse>({
    queryKey: ['/api/convictions', 'nexus'], queryFn: q('/api/convictions?limit=24&minScore=0'),
    refetchInterval: 30_000, staleTime: 20_000, retry: 1,
    refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
  const flow = useQuery<{ trades: FlowTrade[] }>({
    queryKey: ['/api/options-flow', 'nexus'], queryFn: q('/api/options-flow?limit=12'),
    refetchInterval: 120_000, staleTime: 60_000, retry: 1,
  });
  const watchlist = useQuery<{ symbol: string }[]>({
    queryKey: ['/api/watchlist'], refetchInterval: 120_000, retry: 1,
  });
  const pulse = useQuery<{ macro?: { vix?: number } }>({
    queryKey: ['market-pulse'], queryFn: q('/api/market-pulse'),
    refetchInterval: 120_000, staleTime: 60_000, retry: 1,
  });
  const health = useQuery<{ dataPartial?: boolean }>({
    queryKey: ['/api/health', 'terminal-chrome'], queryFn: q('/api/health'),
    refetchInterval: 120_000, staleTime: 60_000, retry: 1,
  });
  return { realtime, rotation, extended, convictions, flow, watchlist, pulse, health, patterns };
}

/* ════════════════════════════════════════════════════════════════
   THE MOCK'S DRAWING CODE (verbatim logic, refs instead of ids).
   ════════════════════════════════════════════════════════════════ */

/** Background particles + flow lines — the mock's drawBg, unchanged. */
function useBgCanvas(ref: React.RefObject<HTMLCanvasElement>, off = false) {
  useEffect(() => {
    const bgCanvas = ref.current;
    if (!bgCanvas || off) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bgCtx = bgCanvas.getContext('2d');
    if (!bgCtx) return;
    let bgW = 0; let bgH = 0; let raf = 0;
    function resizeBg() {
      bgW = bgCanvas!.width = innerWidth * devicePixelRatio;
      bgH = bgCanvas!.height = innerHeight * devicePixelRatio;
      bgCanvas!.style.width = innerWidth + 'px';
      bgCanvas!.style.height = innerHeight + 'px';
    }
    resizeBg();
    const onResize = () => { bgCtx!.setTransform(1, 0, 0, 1, 0, 0); resizeBg(); };
    window.addEventListener('resize', onResize);

    const particles: { x: number; y: number; vx: number; vy: number; r: number; hue: number }[] = [];
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * innerWidth, y: Math.random() * innerHeight,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5, hue: 170 + Math.random() * 40,
      });
    }
    const flowLines: { y: number; amp: number; freq: number; phase: number; opacity: number }[] = [];
    for (let i = 0; i < 8; i++) {
      flowLines.push({
        y: Math.random() * innerHeight, amp: 20 + Math.random() * 40,
        freq: 0.002 + Math.random() * 0.003, phase: Math.random() * Math.PI * 2,
        opacity: 0.03 + Math.random() * 0.05,
      });
    }
    function drawBg(t: number) {
      bgCtx!.setTransform(1, 0, 0, 1, 0, 0);
      bgCtx!.clearRect(0, 0, bgW, bgH);
      bgCtx!.scale(devicePixelRatio, devicePixelRatio);
      flowLines.forEach((fl) => {
        bgCtx!.strokeStyle = `rgba(59,140,255, ${fl.opacity})`;
        bgCtx!.lineWidth = 1;
        bgCtx!.beginPath();
        for (let x = 0; x < innerWidth; x += 4) {
          const y = fl.y + Math.sin(x * fl.freq + t * 0.0005 + fl.phase) * fl.amp;
          if (x === 0) bgCtx!.moveTo(x, y); else bgCtx!.lineTo(x, y);
        }
        bgCtx!.stroke();
      });
      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = innerWidth; if (p.x > innerWidth) p.x = 0;
        if (p.y < 0) p.y = innerHeight; if (p.y > innerHeight) p.y = 0;
        bgCtx!.fillStyle = `hsla(${p.hue}, 80%, 65%, 0.6)`;
        bgCtx!.beginPath(); bgCtx!.arc(p.x, p.y, p.r, 0, Math.PI * 2); bgCtx!.fill();
        bgCtx!.fillStyle = `hsla(${p.hue}, 80%, 65%, 0.1)`;
        bgCtx!.beginPath(); bgCtx!.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); bgCtx!.fill();
      });
      bgCtx!.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 120) {
            bgCtx!.strokeStyle = `rgba(59,140,255, ${(1 - d / 120) * 0.15})`;
            bgCtx!.beginPath();
            bgCtx!.moveTo(particles[i].x, particles[i].y);
            bgCtx!.lineTo(particles[j].x, particles[j].y);
            bgCtx!.stroke();
          }
        }
      }
      raf = requestAnimationFrame(drawBg);
    }
    raf = requestAnimationFrame(drawBg);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [ref, off]);
}

const QUAD_COLOR: Record<string, string> = {
  leading: '#6ee7b7', improving: '#3b8cff', weakening: '#facc15', lagging: '#ff6b3d',
};

/** The feed's rsRatio/rsMomentum → the mock's 0–100 x/y + quadrant colour. */
function quadPointsFrom(sectors: Sector[]) {
  const vals = sectors.flatMap((s) => [Math.abs(s.rsRatio), Math.abs(s.rsMomentum)]).filter(Number.isFinite);
  const span = Math.max(1e-6, ...vals);
  return sectors.map((s) => {
    const x = 50 + (s.rsRatio / span) * 45;
    const y = 50 + (s.rsMomentum / span) * 45;
    const quad = s.rsRatio >= 0
      ? (s.rsMomentum >= 0 ? 'leading' : 'weakening')
      : (s.rsMomentum >= 0 ? 'improving' : 'lagging');
    return { sym: s.etf, x, y, color: QUAD_COLOR[quad], phase: 0, trail: [] as { x: number; y: number }[] };
  }).map((p, i) => ({ ...p, phase: (i * Math.PI * 2) / Math.max(1, sectors.length) }));
}

/** Rotation quadrant — the mock's drawQuad verbatim, fed real sector positions. */
function useQuadCanvas(ref: React.RefObject<HTMLCanvasElement>, sectors: Sector[], light = false) {
  const pointsRef = useRef<ReturnType<typeof quadPointsFrom>>([]);
  // The label colour rides a ref so the running rAF loop picks up a theme flip
  // without tearing the canvas down.
  const labelRef = useRef('#fff');
  useEffect(() => { labelRef.current = light ? '#121826' : '#fff'; }, [light]);
  useEffect(() => { pointsRef.current = quadPointsFrom(sectors); }, [sectors]);
  useEffect(() => {
    const quadCanvas = ref.current;
    if (!quadCanvas) return;
    const quadCtx = quadCanvas.getContext('2d');
    if (!quadCtx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    function resizeQuad() {
      const rect = quadCanvas!.getBoundingClientRect();
      quadCanvas!.width = rect.width * devicePixelRatio;
      quadCanvas!.height = rect.height * devicePixelRatio;
    }
    resizeQuad();
    window.addEventListener('resize', resizeQuad);
    function drawQuad(t: number) {
      const rect = quadCanvas!.getBoundingClientRect();
      const w = rect.width; const h = rect.height;
      quadCtx!.setTransform(1, 0, 0, 1, 0, 0);
      quadCtx!.clearRect(0, 0, quadCanvas!.width, quadCanvas!.height);
      quadCtx!.scale(devicePixelRatio, devicePixelRatio);
      quadCtx!.strokeStyle = 'rgba(59,140,255, 0.15)';
      quadCtx!.lineWidth = 1;
      quadCtx!.setLineDash([4, 4]);
      quadCtx!.beginPath();
      quadCtx!.moveTo(w / 2, 0); quadCtx!.lineTo(w / 2, h);
      quadCtx!.moveTo(0, h / 2); quadCtx!.lineTo(w, h / 2);
      quadCtx!.stroke();
      quadCtx!.setLineDash([]);
      pointsRef.current.forEach((s) => {
        const drift = still ? 0 : Math.sin(t * 0.0005 + s.phase) * 1.5;
        const px = (s.x / 100) * w + drift;
        const py = (1 - s.y / 100) * h + (still ? 0 : Math.cos(t * 0.0007 + s.phase) * 1.5);
        s.trail.push({ x: px, y: py });
        if (s.trail.length > 12) s.trail.shift();
        const r = parseInt(s.color.slice(1, 3), 16);
        const g = parseInt(s.color.slice(3, 5), 16);
        const b = parseInt(s.color.slice(5, 7), 16);
        s.trail.forEach((tp, i) => {
          const alpha = (i / s.trail.length) * 0.3;
          quadCtx!.fillStyle = `rgba(${r},${g},${b},${alpha})`;
          quadCtx!.beginPath();
          quadCtx!.arc(tp.x, tp.y, (i / s.trail.length) * 3, 0, Math.PI * 2);
          quadCtx!.fill();
        });
        const glowR = 14 + (still ? 0 : Math.sin(t * 0.003 + s.phase) * 2);
        const grad = quadCtx!.createRadialGradient(px, py, 0, px, py, glowR);
        grad.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        quadCtx!.fillStyle = grad;
        quadCtx!.beginPath(); quadCtx!.arc(px, py, glowR, 0, Math.PI * 2); quadCtx!.fill();
        quadCtx!.fillStyle = s.color;
        quadCtx!.beginPath(); quadCtx!.arc(px, py, 4, 0, Math.PI * 2); quadCtx!.fill();
        quadCtx!.strokeStyle = `rgba(${r},${g},${b},0.6)`;
        quadCtx!.lineWidth = 1;
        quadCtx!.beginPath();
        quadCtx!.arc(px, py, 7 + (still ? 0 : Math.sin(t * 0.004 + s.phase) * 1), 0, Math.PI * 2);
        quadCtx!.stroke();
        quadCtx!.fillStyle = labelRef.current;
        quadCtx!.font = '700 8.5px "JetBrains Mono", monospace';
        quadCtx!.textAlign = 'center';
        quadCtx!.fillText(s.sym, px, py - 12);
      });
      raf = requestAnimationFrame(drawQuad);
    }
    raf = requestAnimationFrame(drawQuad);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resizeQuad); };
  }, [ref]);
}

/** The mock's drawSignalChart, verbatim — fed real closes instead of a walk. */
function drawSignalChart(canvas: HTMLCanvasElement, data: number[], dir: 'bull' | 'bear') {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = devicePixelRatio;
  const w = canvas.clientWidth; const h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  const min = Math.min(...data); const max = Math.max(...data);
  const range = max - min || 1;
  const color = dir === 'bull' ? '#6ee7b7' : '#ff6b3d';
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + '40');
  grad.addColorStop(1, color + '00');
  ctx.beginPath();
  data.forEach((p, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((p - min) / range) * h * 0.85 - h * 0.05;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  data.forEach((p, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((p - min) / range) * h * 0.85 - h * 0.05;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color; ctx.lineWidth = 1.3;
  ctx.shadowColor = color; ctx.shadowBlur = 6;
  ctx.stroke(); ctx.shadowBlur = 0;
  const lastY = h - ((data[data.length - 1] - min) / range) * h * 0.85 - h * 0.05;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(w - 1, lastY, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color + '60';
  ctx.beginPath(); ctx.arc(w - 1, lastY, 5, 0, Math.PI * 2); ctx.fill();
}

/** Mini chart cell: mock canvas + real 5d closes. Empty history → empty box. */
function SigChart({ symbol, dir }: { symbol: string; dir: 'bull' | 'bear' }) {
  const { points } = usePriceHistory(symbol, '5d', '1h');
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && points.length >= 2) drawSignalChart(ref.current, points.map((p) => p.close), dir);
  }, [points, dir]);
  return (
    <div className="sig-chart">
      {points.length >= 2
        ? <canvas ref={ref} />
        : <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', fontFamily: "'JetBrains Mono',monospace" }}>NO PRICE HISTORY</div>}
    </div>
  );
}

/** Watchlist spark: the mock's drawSpark shape, real closes. */
function WatchSpark({ symbol, up }: { symbol: string; up: boolean }) {
  const { points } = usePriceHistory(symbol, '5d', '1d');
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && points.length >= 2) drawSignalChart(ref.current, points.map((p) => p.close), up ? 'bull' : 'bear');
  }, [points, up]);
  return <canvas ref={ref} className="watch-spark" />;
}

/* ════════════════════════════════════════════════════════════════
   PAGE
   ════════════════════════════════════════════════════════════════ */


// Futures rows are FRONT-MONTH CME futures (auto-rolled): after a quarterly
// expiry they carry ~3 months of rate basis ABOVE the cash index — ES printed
// +65 pts over SPX cash the Monday after the Sep'26 roll and it was correct.
// The tooltip says so, because a broker's US500 CFD tracks CASH, not this.
const FUTURES_NOTE = 'Front-month CME future (auto-rolls) — trades above the cash index by carry basis after a roll; a broker US500/US100 CFD tracks the cash index instead';
const AnatomyMark = ({ n }: { n: number }) => (
  <span
    aria-hidden="true"
    style={{ display: 'inline-grid', placeItems: 'center', width: 16, height: 16, borderRadius: '50%', background: 'var(--cyan, #3b8cff)', color: '#0a0c10', font: "800 9.5px 'JetBrains Mono',monospace", flex: 'none', marginLeft: 4, verticalAlign: 'middle' }}
  >{n}</span>
);
const ANATOMY_LEGEND: Array<[number, string, string]> = [
  [1, 'Band & score', 'S strongest → C weakest. The number totals every evidence layer.'],
  [2, 'Status', 'Pending trigger = not a trade until price takes the entry in market hours. In play = triggered.'],
  [3, 'Evidence layers', 'Each chip is one measured reason. Red chips argue against the idea and subtract points.'],
  [4, 'Levels', 'Stop is a price that actually printed. T1 is a real level or a stated 2R. "R:R now" is for entering at the live price.'],
  [5, 'The tape', 'Options money from real fills: ✓ agrees with the idea, ✗ is positioned against it.'],
];

const STREAM_ORDER = [
  { sym: 'ES', kind: 'futures' as const },
  { sym: 'NQ', kind: 'futures' as const },
  { sym: 'CL', kind: 'futures' as const },
  { sym: 'BTC', kind: 'crypto' as const },
  { sym: 'ETH', kind: 'crypto' as const },
];

function sessionWord(s?: string) {
  return s === 'pre' ? 'pre-market' : s === 'post' ? 'after hours' : s === 'regular' ? 'live session' : 'last close';
}
const fmtPrice = (n: number, money = false) =>
  money ? '$' + Math.round(n).toLocaleString()
    : n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : n.toFixed(2);

export function NexusBoard() {
  const [, setLocation] = useLocation();
  const { theme, setTheme } = useTheme();
  const { currentStock, setCurrentStock } = useStockContext();
  const focusSym = currentStock?.symbol?.toUpperCase();
  const light = theme === 'nexus-light';
  const { realtime, rotation, extended, convictions, flow, watchlist, pulse, health, patterns } = useNexusData();
  const [radarPrev, setRadarPrev] = useState<{ symbol: string; note: string; x: number; y: number } | null>(null);
  const [radarBrowse, setRadarBrowse] = useState<string | null>(null); // pattern filter or 'all'
  const [printsExpanded, setPrintsExpanded] = useState(false);
  // THE expand — the terminal's signature ⤢-to-blurred-modal, on every rail
  // section. The operator asked roughly fifty times; inline toggles are not it.
  const [expandSec, setExpandSec] = useState<null | 'prints' | 'watch' | 'heat' | 'quad' | 'pulse' | 'dev'>(null);
  // Rail window-manager: each side panel can be collapsed to its header or
  // hidden entirely ("it's so much going on"). Per-viewer convenience,
  // persisted in localStorage; hidden panels come back via the restore chips.
  const [railUi, setRailUi] = useState<Record<string, 'min' | 'hidden' | 'shown'>>(() => {
    // Sector Heatmap and Flow Prints repeat the Rotation Map and the FLOW tab;
    // they start hidden (restorable from the chip) — purpose review 2026-09-24.
    const DEFAULTS: Record<string, 'min' | 'hidden' | 'shown'> = { heat: 'hidden', prints: 'hidden' };
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('nx-rail-ui-v2') || '{}') }; } catch { return DEFAULTS; }
  });
  const setRail = (id: string, mode: 'min' | 'hidden' | null) => {
    setRailUi((cur) => {
      const next = { ...cur };
      // An explicit 'shown' — deleting the key would let a hidden-by-default
      // panel re-hide itself on the next load.
      next[id] = mode ?? 'shown';
      try { localStorage.setItem('nx-rail-ui-v2', JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };
  const railCls = (id: string, base: string) =>
    `${base}${railUi[id] === 'min' ? ' rail-min' : ''}${railUi[id] === 'hidden' ? ' rail-hidden' : ''}`;
  const RAIL_NAMES: Record<string, string> = { radar: 'Pattern Radar', pulse: 'Market Pulse', quad: 'Rotation Map', prints: 'Flow Prints', brief: 'Session Brief', dev: 'Candidate field', heat: 'Sector Heatmap', watch: 'Watchlist' };
  const RailCtl = ({ id }: { id: string }) => (
    <span style={{ display: 'inline-flex', gap: 3, marginLeft: 5 }}>
      <button title={railUi[id] === 'min' ? 'Expand panel' : 'Collapse to header'} onClick={(e) => { e.stopPropagation(); setRail(id, railUi[id] === 'min' ? null : 'min'); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', fontSize: 'var(--fs-10, 10px)', padding: '0 2px', lineHeight: 1 }}>
        {railUi[id] === 'min' ? '+' : '–'}
      </button>
      <button title="Hide panel (restore chip appears at the top of the rail)" onClick={(e) => { e.stopPropagation(); setRail(id, 'hidden'); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)', fontSize: 'var(--fs-10, 10px)', padding: '0 2px', lineHeight: 1 }}>
        ×
      </button>
    </span>
  );
  const RailRestore = ({ ids }: { ids: string[] }) => {
    const hidden = ids.filter((i) => railUi[i] === 'hidden');
    if (!hidden.length) return null;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 16px' }}>
        {hidden.map((i) => (
          <button key={i} onClick={() => setRail(i, null)} title="Restore panel"
            style={{ padding: '2px 8px', borderRadius: 3, background: 'rgba(148,163,184,0.06)', border: '1px dashed var(--nx-border)', color: 'var(--text-mute)', cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", fontSize: 8.5, letterSpacing: 0.5 }}>
            + {RAIL_NAMES[i] ?? i}
          </button>
        ))}
      </div>
    );
  };
  const bigQuadRef = useRef<HTMLCanvasElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addSym, setAddSym] = useState('');
  // Quick-actions on the book's cards. The Bot? verdict runs the bot's own
  // entry rules for this symbol right now — absence stops being a mystery.
  const botStatus = useQuery<{ openPositions?: Array<{
    symbol: string; currentPrice?: number | null; entryPrice?: number | null;
    unrealizedPnL?: number | null; unrealizedPnLPercent?: number | null;
    lastPriceUpdate?: string | null;
  }>; config?: { minConviction?: number; maxProgressPct?: number } }>({
    queryKey: ['/api/quant-bot/status', 'nexus'], queryFn: q('/api/quant-bot/status'),
    staleTime: 60_000, retry: 1,
  });
  const pulseSpyQ = useQuery<{ data?: { time: number; close: number }[] }>({
    queryKey: ['/api/historical-prices', 'SPY', '1d5m', 'nexus'], queryFn: q('/api/historical-prices/SPY?range=1d&interval=5m'),
    staleTime: 120_000, refetchInterval: 300_000, retry: 1, enabled: expandSec === 'pulse',
  });
  const pulseSpy = pulseSpyQ.data?.data;
  const heldByBot = useMemo(() => new Set((botStatus.data?.openPositions ?? []).map((x) => x.symbol)), [botStatus.data]);
  const liveBotPosition = useMemo(() => new Map(
    (botStatus.data?.openPositions ?? []).map((x) => [x.symbol.toUpperCase(), x]),
  ), [botStatus.data]);
  const [botVerdicts, setBotVerdicts] = useState<Record<string, string>>({});
  const [watchState, setWatchState] = useState<Record<string, string>>({});
  const addToWatch = async (sym: string) => {
    setWatchState((w) => ({ ...w, [sym]: '…' }));
    try {
      const r = await apiRequest('POST', '/api/watchlist', { symbol: sym });
      setWatchState((w) => ({ ...w, [sym]: r.ok ? '✓' : '✗' }));
    } catch { setWatchState((w) => ({ ...w, [sym]: '✗' })); }
  };

  useEffect(() => { document.title = 'QUANTEDGE // NEXUS'; }, []);

  /* clock + uptime — the mock's tick, verbatim behaviour (uptime = page age) */
  const [now, setNow] = useState(() => Date.now());
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = new Date(now).toTimeString().slice(0, 8);
  const upSec = Math.floor((now - mountedAt.current) / 1000);
  const uptime = `${pad(Math.floor(upSec / 3600))}:${pad(Math.floor((upSec % 3600) / 60))}:${pad(upSec % 60)}`;

  /* canvases */
  const bgRef = useRef<HTMLCanvasElement>(null);
  const quadRef = useRef<HTMLCanvasElement>(null);
  const prefs = usePrefs();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const ord = (rail: 'left' | 'right', id: string) => 10 + orderOf(prefs, rail, id);
  useBgCanvas(bgRef, prefs.calm);
  useQuadCanvas(quadRef, rotation.data?.sectors ?? [], light);
  useQuadCanvas(bigQuadRef, rotation.data?.sectors ?? [], light);

  /* stream rows — real prices; flash only when a price actually changed */
  const fut = realtime.data?.prices?.futures ?? {};
  const cry = realtime.data?.prices?.crypto ?? {};
  const prevPrices = useRef<Record<string, number>>({});
  const streamRows = STREAM_ORDER.map(({ sym, kind }) => {
    const src = kind === 'futures' ? fut[sym] : cry[sym];
    const prev = prevPrices.current[sym];
    const flash = src != null && prev != null && src.price !== prev;
    const dirUp = src != null && prev != null ? src.price >= prev : undefined;
    return { sym, kind, price: src?.price, age: src?.ageSeconds, flash, dirUp };
  });
  useEffect(() => {
    for (const { sym, kind } of STREAM_ORDER) {
      const src = kind === 'futures' ? fut[sym] : cry[sym];
      if (src) prevPrices.current[sym] = src.price;
    }
  });
  const freshCount = streamRows.filter((r) => r.age != null && r.age <= 60).length;

  /* tape — real movers, deduped, both fields present */
  const tapeQuotes = useMemo(() => {
    const seen = new Set<string>(); const out: EHQuote[] = [];
    for (const list of [extended.data?.gainers, extended.data?.losers, extended.data?.mostActive]) {
      for (const t of list ?? []) {
        if (seen.has(t.symbol) || !Number.isFinite(t.lastPrice) || !Number.isFinite(t.changePct)) continue;
        seen.add(t.symbol); out.push(t);
      }
    }
    return out;
  }, [extended.data]);

  /* signals — the live book through the mock's filter bar, which now filters */
  // GRID is the mock's card wall; SCANNER and COCKPIT are the working views the
  // desk asked back in — HuntCockpit owns those, mounted with its own filters.
  const [bookView, setBookView] = useState<'grid' | 'scanner' | 'cockpit' | 'ledger'>('grid');
  const [selectedLedger, setSelectedLedger] = useState<any | null>(null);
  // "Explain cards": numbered anatomy markers (1-5) on every card + a legend.
  const [explainCards, setExplainCards] = useState<boolean>(() => {
    try { return localStorage.getItem('nx-explain-cards') === '1'; } catch { return false; }
  });
  const toggleExplain = () => setExplainCards((v) => {
    try { localStorage.setItem('nx-explain-cards', v ? '0' : '1'); } catch { /* ok */ }
    return !v;
  });
  // Outcomes use completed trading sessions, not a rolling 72-hour window that
  // silently drops Thursday/Friday records over a weekend.
  const ledgerQ = useQuery<{ window: string; sessions: string[]; ledger: Array<{ id: string; symbol: string; direction: string; signal: string; score: number | null; entryPrice: number; targetPrice: number; riskRewardRatio: number | null; outcome: string; optionType: 'call' | 'put' | null; strikePrice: number | null; expiryDate: string | null; contractSymbol: string | null; entryPremium: number | null; exitPremium: number | null; optionPercentGain: number | null; realizedPnL: number | null; outcomeNotes: string | null; resolutionReason: string | null; dataSourceUsed: string | null; onDemand: boolean; at: string }> }>({
    queryKey: ['/api/ideas/ledger', 'nexus', 6], queryFn: q('/api/ideas/ledger?limit=120&sessions=6'),
    staleTime: 120_000, retry: 1,
  });
  const indexReplayQ = useQuery<{
    period: { from: string; to: string; tradingSessions: number };
    limitation: string;
    summary: { alerts: number; resolved: number; coveragePct: number; trust: string; targetHits: number; stops: number; targetHitRatePct: number; netMarkedPnlDollars: number };
    policyMatrix: Record<string, { targetPct: number; sample: number; targetHits: number; stops: number; targetHitRatePct: number; netMarkedPnlDollars: number }>;
    rows: Array<{ date: string; symbol: string; direction: string; estTimestamp: string; entryMark?: number; exitMark?: number; outcome: string; returnPct?: number; pnlDollars?: number; error?: string }>;
  }>({
    queryKey: ['/api/backtests/index-0dte/six-session'],
    queryFn: q('/api/backtests/index-0dte/six-session'),
    staleTime: 3_600_000, retry: 0,
  });
  const latestHit = ledgerQ.data?.ledger.find((row) => row.outcome === 'hit_target');
  // Draggable rails: drag the border, double-click to cycle default ↔ expanded.
  const leftRail = useColResize('nx-rail-left', 320, { sign: 1, min: 220, max: 560 });
  const rightRail = useColResize('nx-rail-right', 340, { sign: -1, min: 220, max: 560 });
  const [side, setSide] = useState<'all' | 'long' | 'short'>('all');
  const [band, setBand] = useState<'all' | 'S' | 'A' | 'B' | 'C'>('all');
  const [bookScope, setBookScope] = useState<'setups' | 'live' | 'held' | 'all'>('all');
  const [sort, setSort] = useState<'conviction' | 'rr' | 'newest'>('newest');
  const [expanded, setExpanded] = useState<string | null>(null);
  const picks = convictions.data?.picks ?? [];
  // Aggressor context for every card — the tape read that decodes whether
  // today's options money agrees with the signal. One batch call, cached.
  const pickSyms = [...new Set(picks.map((p) => p.symbol))].slice(0, 12).join(',');
  const leansQ = useQuery<{ enabled: boolean; reads: Record<string, { lean: 'long' | 'short' | 'flat'; net: number }> }>({
    queryKey: ['/api/bullflow/net-premium-batch', pickSyms],
    queryFn: q(`/api/bullflow/net-premium-batch?symbols=${pickSyms}`),
    enabled: pickSyms.length > 0, staleTime: 180_000, refetchInterval: 240_000, retry: 0,
  });
  const leanOf = (sym: string) => leansQ.data?.reads?.[sym];
  const bandOf = (p: ConvictionPick) => (p.convictionBand || 'C').charAt(0).toUpperCase();
  const signalPicks = useMemo(() => picks.filter((p) => !p.isBotHeld), [picks]);
  const heldPicks = useMemo(() => picks.filter((p) => p.isBotHeld), [picks]);
  const legacyHeldCount = useMemo(() => heldPicks.filter((p) => p.botBookLegacy).length, [heldPicks]);
  const setupCount = useMemo(() => signalPicks.filter((p) => p.lifecycleState === 'pending_trigger').length, [signalPicks]);
  const liveSignalCount = useMemo(() => signalPicks.filter((p) => p.lifecycleState === 'triggered' || p.lifecycleState === 'executed').length, [signalPicks]);
  const bandCounts = useMemo(() => {
    const c: Record<string, number> = { S: 0, A: 0, B: 0, C: 0 };
    signalPicks.forEach((p) => { c[bandOf(p)] = (c[bandOf(p)] ?? 0) + 1; });
    return c;
  }, [signalPicks]);
  const shown = useMemo(() => {
    let out = picks.filter((p) =>
      (bookScope === 'all' ||
        (bookScope === 'held' && p.isBotHeld) ||
        (bookScope === 'setups' && !p.isBotHeld && p.lifecycleState === 'pending_trigger') ||
        (bookScope === 'live' && !p.isBotHeld && (p.lifecycleState === 'triggered' || p.lifecycleState === 'executed'))) &&
      (side === 'all' || p.direction === side) &&
      (band === 'all' || (!p.isBotHeld && bandOf(p) === band)));
    out = [...out].sort((a, b) =>
      sort === 'conviction' ? (b.convictionScore ?? 0) - (a.convictionScore ?? 0)
        : sort === 'rr' ? (b.riskRewardRatio ?? 0) - (a.riskRewardRatio ?? 0)
          : (new Date(b.generatedAt ?? b.heldSince ?? 0).getTime() || 0) -
            (new Date(a.generatedAt ?? a.heldSince ?? 0).getTime() || 0));
    return out;
  }, [picks, bookScope, side, band, sort]);
  const longs = picks.filter((p) => p.direction === 'long').length;
  const shorts = picks.length - longs;
  // Held inventory deliberately has no entry grade. Including it as zero made
  // three scored signals plus five positions report "Avg Evidence 9/100" — a
  // mathematically tidy but operationally false KPI.
  const scores = signalPicks
    .map((p) => Number(p.convictionScore))
    .filter((score) => Number.isFinite(score));
  const avgEv = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const topEv = scores.length ? Math.max(...scores) : null;

  /* heat colour — the mock's heatColor, verbatim */
  function heatColor(v: number) {
    const intensity = Math.min(Math.abs(v) / 6, 1);
    if (v >= 0) {
      const r = Math.round(20 + intensity * 40);
      const g = Math.round(40 + intensity * 180);
      const b = Math.round(40 + intensity * 100);
      return `rgba(${r}, ${g}, ${b}, ${0.3 + intensity * 0.5})`;
    }
    const r = Math.round(40 + intensity * 200);
    const g = Math.round(30 + intensity * 40);
    const b = Math.round(40 + intensity * 60);
    return `rgba(${r}, ${g}, ${b}, ${0.3 + intensity * 0.5})`;
  }

  const sectors = rotation.data?.sectors ?? [];
  const leaders = (rotation.data?.leaders ?? sectors.filter((s) => s.change > 0).slice(0, 2)).slice(0, 2);
  const laggards = (rotation.data?.laggards ?? [...sectors].reverse().filter((s) => s.change < 0).slice(0, 2)).slice(0, 2);
  const rotationQueue = sectors
    .filter((s) => Number.isFinite(s.rsRatio) && Number.isFinite(s.rsMomentum) && s.rsMomentum > 0 && NEXUS_ROTATION_NAMES[s.etf])
    .map((s) => ({ ...s, phase: s.rsRatio >= 0 ? 'LEADING' : 'IMPROVING' }))
    .sort((a, b) => a.phase === b.phase ? b.rsMomentum - a.rsMomentum : a.phase === 'IMPROVING' ? -1 : 1)
    .slice(0, 3);
  const spyChange = rotation.data?.spyChange;
  const dataPartial = health.data?.dataPartial ?? true;
  const vix = pulse.data?.macro?.vix;
  // Watchlist order is the operator's, not the API's: drag to reorder, the
  // order persists per device (localStorage — a display preference, not data).
  const [watchOrder, setWatchOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nx-watch-order') ?? '[]'); } catch { return []; }
  });
  const dragSym = useRef<string | null>(null);
  const watchSyms = useMemo(() => {
    const base = (watchlist.data ?? []).slice(0, 10);
    if (!watchOrder.length) return base;
    const rank = new Map(watchOrder.map((sym, i) => [sym, i]));
    return [...base].sort((x, y) => (rank.get(x.symbol) ?? 99) - (rank.get(y.symbol) ?? 99));
  }, [watchlist.data, watchOrder]);
  const Ex = ({ id }: { id: NonNullable<typeof expandSec> }) => (
    <button title="Expand" onClick={(e) => { e.stopPropagation(); setExpandSec(id); }}
      style={{ marginLeft: 6, width: 16, height: 16, display: 'inline-grid', placeItems: 'center', background: 'transparent', border: '1px solid var(--nx-border)', borderRadius: 3, color: 'var(--text-mute)', cursor: 'pointer', fontSize: 'var(--fs-9, 9px)', lineHeight: 1 }}>⤢</button>
  );

  const dropOn = (target: string) => {
    const from = dragSym.current;
    dragSym.current = null;
    if (!from || from === target) return;
    const syms = watchSyms.map((w) => w.symbol);
    const next = syms.filter((x) => x !== from);
    next.splice(next.indexOf(target), 0, from);
    setWatchOrder(next);
    try { localStorage.setItem('nx-watch-order', JSON.stringify(next)); } catch { /* ignore */ }
  };
  // Live quotes for every symbol on the board (not only the day's movers), so
  // cards price off now rather than the board-build snapshot. 20s cadence.
  // Phones show the top 6 of the book, then "show all": the full book ran
  // ~9,400px on a 393px screen before any market context (review 2026-09-24).
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setIsPhone(mq.matches);
    mq.addEventListener('change', on); return () => mq.removeEventListener('change', on);
  }, []);
  const [bookAll, setBookAll] = useState(false);
  const bookList = isPhone && !bookAll && prefs.phoneCount > 0 ? shown.slice(0, prefs.phoneCount) : shown;
  const boardSyms = useMemo(() => Array.from(new Set(shown.map((p) => p.symbol))).slice(0, 40).sort().join(','), [shown]);
  const boardQuotesQ = useQuery<{ quotes: Record<string, { price: number; changePercent: number }> }>({
    queryKey: [`/api/quotes/batch/${boardSyms}`],
    enabled: boardSyms.length > 0,
    refetchInterval: 20_000,
    staleTime: 15_000,
  });
  const quoteBySym = useMemo(() => {
    const m = new Map<string, EHQuote>();
    for (const list of [extended.data?.gainers, extended.data?.losers, extended.data?.mostActive]) {
      for (const t of list ?? []) if (!m.has(t.symbol) && Number.isFinite(t.changePct)) m.set(t.symbol, t);
    }
    for (const [sym, q] of Object.entries(boardQuotesQ.data?.quotes ?? {})) {
      if (Number.isFinite(q?.price) && q.price > 0) {
        m.set(sym, { ...(m.get(sym) ?? {}), symbol: sym, lastPrice: q.price, changePct: q.changePercent } as EHQuote);
      }
    }
    return m;
  }, [extended.data, boardQuotesQ.data]);
  const runningBots = 0; /* automations/status shape varies; sys row reads watch/vix/feed */
  const es = fut['ES'];
  const btc = cry['BTC'];

  const bandColorOf = (b: string) =>
    b === 'S' ? '#6ee7b7' : b === 'A' ? '#3b8cff' : b === 'B' ? '#facc15' : '#8b93a3';

  return (
    /* Embedded in the terminal shell — the shell's root carries .nexus-vars
       (and .light), its topbar carries the nav, its footer the bottombar. This
       renders only the board: ambient canvas + the three-column main. */
    <div className="nexus-embed">
      <canvas id="bgCanvas" ref={bgRef} />
      <CustomizePanel open={customizeOpen} onClose={() => setCustomizeOpen(false)} railUi={railUi} setRail={setRail} />

      {/* ============ MAIN ============ */}
      <div
        className={`main${leftRail.dragging || rightRail.dragging ? ' nx-dragging' : ''}`}
        style={{ ['--nx-left' as string]: `${leftRail.width}px`, ['--nx-right' as string]: `${rightRail.width}px` }}
      >
        {/* draggable borders — drag to resize, double-click to expand */}
        <div
          className={`nx-resize${leftRail.dragging ? ' active' : ''}`}
          style={{ left: leftRail.width }}
          title="Drag to resize · double-click to expand"
          {...leftRail.handleProps}
        />
        <div
          className={`nx-resize${rightRail.dragging ? ' active' : ''}`}
          style={{ right: rightRail.width - 4, marginLeft: 0 }}
          title="Drag to resize · double-click to expand"
          {...rightRail.handleProps}
        />
        {/* LEFT — MARKET INTEL */}
        <div className="col col-left">
          <div className="sec-head">
            <div className="sec-num">01 · MARKET CONTEXT</div>
            <div className="sec-sub">Read the tape before the trade. Participation, relative rotation and leadership — one connected market view.</div>
          </div>
          <RailRestore ids={['radar', 'pulse', 'quad', 'prints', 'brief']} />

          <div className={railCls('radar', 'intel-block')} style={{ order: ord('left', 'radar') }}>
            <div className="intel-head">
              <div className="intel-label">Pattern Radar<RailCtl id="radar" /></div>
              <div className="intel-value" style={{ cursor: 'pointer' }} title="Open the full pattern browser" role="button" tabIndex={0} onKeyDown={pressOnEnter} onClick={() => setRadarBrowse('all')}>{patterns.data ? `${patterns.data.hits.length} hits · ${patterns.data.scanned} scanned ⤢` : 'warming…'}</div>
            </div>
            {(['inside_coil', 'bull_flag', 'breakout_watch', 'bear_flag'] as const).map((pat) => {
              // Operator-core names pin to the front of each group — CRCL's
              // bull flag was hit #40 of 157 and invisible behind the 8-chip cap.
              const rows = (patterns.data?.hits ?? []).filter((h) => h.pattern === pat)
                .sort((a, b) => Number((b as any).core ?? false) - Number((a as any).core ?? false)).slice(0, 8);
              if (!rows.length) return null;
              const label = pat === 'inside_coil' ? 'Coils' : pat === 'bull_flag' ? 'Bull flags' : pat === 'breakout_watch' ? '52w-high watch' : 'Bear flags';
              return (
                <div key={pat} style={{ marginBottom: 8 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: 0.8, margin: '6px 0 4px' }}>
                    {label} · {(patterns.data?.hits ?? []).filter((h) => h.pattern === pat).length}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {rows.map((h) => (
                      <button key={`${pat}-${h.symbol}`}
                        onMouseEnter={(e) => setRadarPrev({ symbol: h.symbol, note: h.note, x: (e.currentTarget as HTMLElement).getBoundingClientRect().left, y: (e.currentTarget as HTMLElement).getBoundingClientRect().bottom })}
                        onMouseLeave={() => setRadarPrev(null)}
                        onClick={() => { setRadarPrev(null); setCurrentStock({ symbol: h.symbol }); openWorkup(h.symbol); }}
                        style={{ padding: '3px 8px', background: 'var(--panel-hi)', border: `1px solid ${h.bias === 'short' ? 'rgba(255,107,61,0.3)' : h.bias === 'long' ? 'rgba(110,231,183,0.3)' : 'var(--nx-border)'}`, borderRadius: 4, fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', fontWeight: 600, color: h.bias === 'short' ? 'var(--red)' : h.bias === 'long' ? 'var(--green)' : 'var(--text-dim)', cursor: 'pointer' }}>
                        {h.symbol}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {patterns.data && patterns.data.hits.length === 0 && (
              <div style={{ fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)', fontStyle: 'italic', padding: '6px 0' }}>Sweep pending — first pass runs ~3 min after boot.</div>
            )}
            {radarPrev && <RadarPreview {...radarPrev} />}
            {expandSec && (
              <div className="chart-modal" onClick={() => setExpandSec(null)}>
                <div className="chart-modal-box" style={{ maxWidth: 980, maxHeight: '86vh', margin: 'auto' }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid var(--nx-border)' }}>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15 }}>
                      {expandSec === 'prints' ? 'Flow Prints' : expandSec === 'watch' ? 'Watchlist' : expandSec === 'heat' ? 'Sector Heatmap' : expandSec === 'quad' ? 'Rotation Map' : expandSec === 'dev' ? 'Candidate field' : 'Market Pulse'}
                    </div>
                    <button onClick={() => setExpandSec(null)} style={{ background: 'transparent', border: '1px solid var(--nx-border)', borderRadius: 4, color: 'var(--text-dim)', cursor: 'pointer', width: 26, height: 26 }}>✕</button>
                  </div>
                  <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
                    {expandSec === 'prints' && (
                      <div>
                        {(flow.data?.trades ?? []).map((t) => (
                          <div key={t.id} role="button" tabIndex={0} onKeyDown={pressOnEnter} onClick={() => { setExpandSec(null); setCurrentStock({ symbol: t.symbol }); openWorkup(t.symbol); }}
                            style={{ display: 'grid', gridTemplateColumns: '90px 70px 1fr auto auto', gap: 12, alignItems: 'center', padding: '8px 10px', borderBottom: '1px dashed rgba(59,140,255,0.08)', cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                            <span style={{ color: 'var(--text-mute)' }}>{new Date(t.detectedAt).toTimeString().slice(0, 8)}</span>
                            <b style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13 }}>{t.symbol}</b>
                            <span style={{ color: 'var(--text-dim)' }}>${t.strikePrice} strike · ${Math.round(t.totalPremium / 1000)}k premium</span>
                            <span style={{ color: t.optionType === 'call' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{t.optionType.toUpperCase()}</span>
                            <span style={{ color: 'var(--text-mute)', fontSize: 'var(--fs-10, 10px)' }}>workup →</span>
                          </div>
                        ))}
                        {!(flow.data?.trades ?? []).length && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-mute)', fontStyle: 'italic' }}>No prints in the window.</div>}
                      </div>
                    )}
                    {expandSec === 'watch' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                        {watchSyms.map(({ symbol }) => {
                          const wq = quoteBySym.get(symbol);
                          return (
                            <div key={symbol} role="button" tabIndex={0} onKeyDown={pressOnEnter} onClick={() => { setExpandSec(null); setCurrentStock({ symbol }); openWorkup(symbol); }}
                              style={{ padding: 12, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--nx-border)', borderRadius: 6, cursor: 'pointer' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                                <b style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 14 }}>{symbol}</b>
                                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, color: wq && wq.changePct < 0 ? 'var(--red)' : 'var(--green)' }}>{wq ? `${wq.changePct >= 0 ? '+' : ''}${wq.changePct.toFixed(2)}%` : '—'}</span>
                              </div>
                              <WatchSpark symbol={symbol} up={!wq || wq.changePct >= 0} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {expandSec === 'heat' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                        {sectors.map((s2) => (
                          <button key={s2.etf} onClick={() => { setExpandSec(null); setCurrentStock({ symbol: s2.etf }); openWorkup(s2.etf); }}
                            style={{ padding: '18px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: heatColor(s2.change), color: Math.abs(s2.change) > 2 ? '#fff' : 'rgba(255,255,255,0.9)', fontFamily: "'JetBrains Mono',monospace" }}>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{s2.etf}</div>
                            <div style={{ fontSize: 'var(--fs-10, 10px)', opacity: 0.85 }}>{s2.name}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{s2.change >= 0 ? '+' : ''}{s2.change.toFixed(2)}%</div>
                          </button>
                        ))}
                      </div>
                    )}
                    {expandSec === 'quad' && (
                      <div style={{ position: 'relative', height: '62vh', background: 'linear-gradient(rgba(59,140,255,0.05) 1px, transparent 1px),linear-gradient(90deg, rgba(59,140,255,0.05) 1px, transparent 1px)', backgroundSize: '25% 25%', borderRadius: 8, overflow: 'hidden' }}>
                        <canvas ref={bigQuadRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
                        <div style={{ position: 'absolute', top: 10, left: 14, color: 'var(--green)', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', fontWeight: 700, letterSpacing: 1 }}>LEADING</div>
                        <div style={{ position: 'absolute', top: 10, right: 14, color: 'var(--cyan)', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', fontWeight: 700, letterSpacing: 1 }}>IMPROVING</div>
                        <div style={{ position: 'absolute', bottom: 10, left: 14, color: 'var(--amber)', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', fontWeight: 700, letterSpacing: 1 }}>WEAKENING</div>
                        <div style={{ position: 'absolute', bottom: 10, right: 14, color: 'var(--red)', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', fontWeight: 700, letterSpacing: 1 }}>LAGGING</div>
                      </div>
                    )}
                    {expandSec === 'pulse' && (
                      <div>
                        <div style={{ marginBottom: 14 }}>
                          <Spark bars={(pulseSpy ?? []).map((b2) => ({ time: b2.time, close: b2.close }))} color="#3b8cff" height={220} label="SPY intraday" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                          {streamRows.map((r) => (
                            <div key={r.sym} style={{ padding: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--nx-border)', borderRadius: 6, fontFamily: "'JetBrains Mono',monospace" }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <b>{r.sym}</b>
                                <span style={{ color: r.dirUp === false ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>{r.dirUp == null ? '—' : r.dirUp ? '▲' : '▼'}</span>
                              </div>
                              <div style={{ fontSize: 12, marginTop: 4 }}>{r.price != null ? (r.sym === 'BTC' || r.sym === 'ETH' ? `$${Math.round(r.price).toLocaleString()}` : `$${r.price.toFixed(2)}`) : 'no level'}</div>
                              <div style={{ fontSize: 'var(--fs-9, 9px)', color: r.age != null && r.age <= 60 ? 'var(--green)' : 'var(--amber)', marginTop: 2 }}>{r.age != null ? `${Math.round(r.age)}s ago` : 'age unknown'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {expandSec === 'dev' && (
                      <div style={{ color: 'var(--text-dim)', fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                        The candidate field's full set renders in the rail — this expands as the set grows. Pre-trigger picks and live compressions, all clickable to their workups.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {radarBrowse && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 88, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center' }} onClick={() => setRadarBrowse(null)}>
                <div style={{ width: 'min(720px, 92vw)', maxHeight: '80vh', overflow: 'auto', background: 'linear-gradient(135deg, var(--panel-solid), var(--panel-2))', border: '1px solid var(--nx-border-hi)', borderRadius: 12, padding: 18 }} onClick={(ev) => ev.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 15, marginRight: 'auto' }}>Pattern browser · {patterns.data?.hits.length ?? 0} hits</div>
                    {['all', 'inside_coil', 'bull_flag', 'bear_flag', 'breakout_watch', 'nr7'].map((f) => (
                      <button key={f} onClick={() => setRadarBrowse(f)} style={{ padding: '3px 8px', borderRadius: 3, fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer', background: radarBrowse === f ? 'rgba(59,140,255,0.15)' : 'transparent', color: radarBrowse === f ? 'var(--cyan-bright)' : 'var(--text-mute)', border: '1px solid var(--nx-border)' }}>{f.replace('_', ' ')}</button>
                    ))}
                  </div>
                  {(patterns.data?.hits ?? []).filter((h) => radarBrowse === 'all' || h.pattern === radarBrowse).slice(0, 120).map((h) => (
                    <div key={`${h.pattern}-${h.symbol}`} role="button" tabIndex={0} onKeyDown={pressOnEnter} onClick={() => { setRadarBrowse(null); setCurrentStock({ symbol: h.symbol }); openWorkup(h.symbol); }}
                      style={{ display: 'grid', gridTemplateColumns: '64px 110px 1fr', gap: 10, alignItems: 'center', padding: '7px 10px', borderBottom: '1px dashed rgba(59,140,255,0.08)', cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)' }}>
                      <b style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 12, color: h.bias === 'short' ? 'var(--red)' : h.bias === 'long' ? 'var(--green)' : 'var(--text)' }}>{h.symbol}</b>
                      <span style={{ color: 'var(--text-mute)', textTransform: 'uppercase', fontSize: 'var(--fs-9, 9px)' }}>{h.pattern.replace('_', ' ')}</span>
                      <span style={{ color: 'var(--text-dim)' }}>{h.note}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={railCls('pulse', 'intel-block')} style={{ order: ord('left', 'pulse') }}>
            <div className="intel-head">
              <div className="intel-label">Market Pulse<Ex id="pulse" /><RailCtl id="pulse" /></div>
              <div className="intel-value">{rotation.data?.sessionLabel ?? '—'}</div>
            </div>
            <div className="pulse-card">
              <div className="pulse-top">
                <div className="pulse-title">
                  {freshCount > 0 && <span className="live-dot" />}
                  {freshCount > 0 ? 'LIVE · streams' : 'STREAMS'}
                </div>
                <div className="pulse-age">{freshCount}/{STREAM_ORDER.length} fresh</div>
              </div>
              <div className="pulse-main">
                <div className="pulse-ticker">SPY</div>
                {spyChange != null ? (
                  <div className={`pulse-change ${spyChange >= 0 ? 'up' : 'down'}`}>
                    {spyChange >= 0 ? '+' : ''}{spyChange.toFixed(1)}%
                  </div>
                ) : (
                  <div className="pulse-change" style={{ color: 'var(--text-mute)' }}>—</div>
                )}
                <div style={{ marginLeft: 'auto', fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)' }}>
                  CASH · {sessionWord(extended.data?.session)}
                </div>
              </div>
              <div className="pulse-sub">{freshCount}/{STREAM_ORDER.length} fresh · futures &amp; crypto stream</div>

              {streamRows.map((r) => (
                <div className={`stream-row${r.flash ? ' flash' : ''}`} key={`${r.sym}-${r.price ?? 'x'}`} title={r.kind === 'futures' ? FUTURES_NOTE : undefined}>
                  <div className="stream-sym">{r.sym}</div>
                  <div className="stream-bar">
                    {/* Bar = freshness: full at 0s, empty at 60s+. The mock's bars
                        were random widths; this one means something. */}
                    <div className="stream-bar-fill" style={{ width: r.age != null ? `${Math.max(4, 100 - Math.min(60, r.age) * (100 / 60))}%` : '0%' }} />
                  </div>
                  <div className={`stream-price${r.dirUp === true ? ' up' : r.dirUp === false ? ' down' : ''}`}>
                    {r.price != null ? fmtPrice(r.price, r.kind === 'crypto') : '—'}
                  </div>
                  <div className="stream-age">{r.age != null ? `${r.age}s` : '—'}</div>
                </div>
              ))}
            </div>

            <div className="intel-head" style={{ marginTop: 14 }}>
              <div className="intel-label">Cash rotation</div>
            </div>
            <div className="rotation-flow">
              <div className="rot-side">
                <div className="rot-label">Out of</div>
                {laggards.map((s) => (
                  <div className="rot-item" key={s.etf}>
                    <span className="sym">{s.name}</span>
                    <span className="val out">{s.change.toFixed(1)}%</span>
                  </div>
                ))}
                {!laggards.length && <div className="rot-item"><span className="sym">—</span></div>}
              </div>
              <div className="rot-arrow">→</div>
              <div className="rot-side">
                <div className="rot-label">Into</div>
                {leaders.map((s) => (
                  <div className="rot-item" key={s.etf}>
                    <span className="sym">{s.name}</span>
                    <span className="val in">+{s.change.toFixed(1)}%</span>
                  </div>
                ))}
                {!leaders.length && <div className="rot-item"><span className="sym">—</span></div>}
              </div>
            </div>
          </div>

          {/* Rotation Map */}
          <div className={railCls('quad', 'intel-block')} style={{ order: ord('left', 'quad') }}>
            <div className="intel-head">
              <div className="intel-label">Rotation Map<Ex id="quad" /><RailCtl id="quad" /></div>
              <div className="intel-value">{rotation.data?.sessionLabel ?? '—'}</div>
            </div>
            <div className="quad-wrap">
              <div className="quad-canvas-wrap">
                <canvas className="quad-canvas" ref={quadRef} />
                <div className="quad-label tl">Leading</div>
                <div className="quad-label tr">Improving</div>
                <div className="quad-label bl">Weakening</div>
                <div className="quad-label br">Lagging</div>
                <div className="quad-axis x">x · rel strength →</div>
                <div className="quad-axis y">y · building →</div>
              </div>
              <div className="quad-legend">
                <div className="quad-legend-item"><div className="quad-legend-dot" style={{ background: 'var(--green)', color: 'var(--green)' }} />Leading</div>
                <div className="quad-legend-item"><div className="quad-legend-dot" style={{ background: 'var(--cyan)', color: 'var(--cyan)' }} />Improving</div>
                <div className="quad-legend-item"><div className="quad-legend-dot" style={{ background: 'var(--amber)', color: 'var(--amber)' }} />Weakening</div>
                <div className="quad-legend-item"><div className="quad-legend-dot" style={{ background: 'var(--red)', color: 'var(--red)' }} />Lagging</div>
              </div>
            </div>
          </div>

          {/* Flow prints — the mock's Time & Sales slot, wired to the real flow
              feed. Side chip is CALL/PUT because that is measured; buyer vs
              seller is not, and is not claimed. */}
          <div className={railCls('prints', 'tape')} style={{ order: ord('left', 'prints') }}>
            <div className="intel-head">
              <div className="intel-label">Flow Prints<Ex id="prints" /><RailCtl id="prints" /></div>
              <div className="intel-value" style={{ cursor: 'pointer' }} title="Expand / collapse the print list"
                onClick={() => setPrintsExpanded((x) => !x)}>
                {printsExpanded ? `${(flow.data?.trades ?? []).length} prints · collapse ▲` : '15-min delayed · expand ▼'}
              </div>
            </div>
            <div className="tape-list" style={printsExpanded ? { maxHeight: 380, overflowY: 'auto' } : undefined}>
              {(flow.data?.trades ?? []).slice(0, printsExpanded ? 200 : 10).map((t) => (
                <div className="tape-row" key={t.id} style={{ cursor: 'pointer' }} title={`Open ${t.symbol} workup`} role="button" tabIndex={0} onKeyDown={pressOnEnter} onClick={() => { setCurrentStock({ symbol: t.symbol }); openWorkup(t.symbol); }}>
                  <span className="tape-time">{new Date(t.detectedAt).toTimeString().slice(0, 8)}</span>
                  <span className="tape-sym">{t.symbol}</span>
                  <span className="tape-price">${t.strikePrice} × ${Math.round(t.totalPremium / 1000)}k</span>
                  <span className={`tape-side ${t.optionType === 'call' ? 'buy' : 'sell'}`}>{t.optionType.toUpperCase()}</span>
                </div>
              ))}
              {!(flow.data?.trades ?? []).length && (
                <div className="tape-row"><span className="tape-time">—</span><span className="tape-sym" style={{ color: 'var(--text-mute)' }}>no prints yet</span></div>
              )}
            </div>
          </div>

          {/* Session Brief — the rotation feed's own headline, not invented prose */}
          <div className={railCls('brief', 'intel-block')} style={{ order: ord('left', 'brief') }}>
            <div className="intel-head">
              <div className="intel-label">Session Brief<RailCtl id="brief" /></div>
              <div className="intel-value">from the rotation feed</div>
            </div>
            <div className="brief-text">
              {rotation.data?.headline
                ? <span>{rotation.data.headline}</span>
                : <span style={{ color: 'var(--text-mute)' }}>No session read yet.</span>}
            </div>
            {rotationQueue.length > 0 && (
              <div style={{ marginTop: 10, display: 'grid', gap: 7 }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Research next · not signals</div>
                {rotationQueue.map((sector) => (
                  <div key={sector.etf} style={{ borderTop: '1px solid var(--nx-border)', paddingTop: 7 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)' }}>
                      <b style={{ color: 'var(--text)' }}>{sector.etf} · {sector.name}</b>
                      <span style={{ color: sector.phase === 'IMPROVING' ? 'var(--cyan)' : 'var(--green)' }}>{sector.phase}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 9px', marginTop: 5 }}>
                      {NEXUS_ROTATION_NAMES[sector.etf].map((symbol) => (
                        <button key={symbol} type="button" onClick={() => openWorkup(symbol)} style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', fontWeight: 700 }}>{symbol}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* CENTER — ACTIVE BOOK */}
        <div className="col col-center">
          <div className="sec-head">
            <div className="sec-num">02 · ACTIVE BOOK</div>
            <div className="sec-title">Ranked opportunities.</div>
            <div className="sec-sub">Select a ticker to connect price, evidence, levels and execution.</div>
            <div className="sec-meta">
              <span className="tag cyan">ranked book</span>
              <span className="tag mute">· {picks.length}</span>
              <button
                type="button"
                onClick={toggleExplain}
                aria-pressed={explainCards}
                className={`view-btn${explainCards ? ' active' : ''}`}
                title="Show what each part of a card means"
                style={{ marginLeft: 8 }}
              >
                {explainCards ? 'hide guide' : 'explain cards'}
              </button>
              <button
                type="button"
                className="view-btn"
                aria-haspopup="dialog"
                onClick={() => setCustomizeOpen(true)}
                title="Arrange panels, choose what cards show, text size and calm mode"
              >
                customize
              </button>
              {latestHit && (
                <button
                  type="button"
                  className="view-btn active"
                  onClick={() => setBookView('ledger')}
                  title="Open recent measured outcomes"
                  style={{ color: 'var(--green)', borderColor: 'color-mix(in srgb, var(--green) 35%, transparent)' }}
                >
                  latest hit · {latestHit.symbol}{latestHit.optionPercentGain != null ? ` +${Number(latestHit.optionPercentGain).toFixed(0)}%` : ''}
                </button>
              )}
              <div className="view-toggle" style={{ marginLeft: 'auto' }}>
                {(['grid', 'scanner', 'cockpit', 'ledger'] as const).map((v) => (
                  <button
                    key={v}
                    className={`view-btn${bookView === v ? ' active' : ''}`}
                    style={{ background: bookView === v ? undefined : 'transparent', border: 'none' }}
                    onClick={() => setBookView(v)}
                  >
                    {v === 'ledger' ? 'outcomes' : v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {bookView === 'ledger' ? (
            <div style={{ padding: '12px 16px' }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Everything published · {ledgerQ.data?.window ?? '6 completed trading sessions'} · click a record → historical replay
              </div>
              {indexReplayQ.data && (
                <div style={{ marginBottom: 14, border: '1px solid var(--nx-border-hi)', borderRadius: 8, overflow: 'hidden', background: 'color-mix(in srgb, var(--panel-2) 82%, transparent)' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, padding: '10px 12px', borderBottom: '1px solid var(--nx-border)' }}>
                    <div style={{ minWidth: 210 }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: 'var(--cyan-bright)', fontWeight: 800, letterSpacing: 1 }}>INDEX 0DTE · SIX-SESSION REPLAY</div>
                      <div style={{ marginTop: 3, fontSize: 10, color: 'var(--text-mute)' }}>{indexReplayQ.data.period.from} → {indexReplayQ.data.period.to} · ordered one-minute reported trades</div>
                    </div>
                    {[
                      ['Coverage', `${indexReplayQ.data.summary.resolved}/${indexReplayQ.data.summary.alerts} · ${indexReplayQ.data.summary.coveragePct}%`],
                      ['+100% target', `${indexReplayQ.data.summary.targetHits}/${indexReplayQ.data.summary.resolved} · ${indexReplayQ.data.summary.targetHitRatePct}%`],
                      ['Stops', String(indexReplayQ.data.summary.stops)],
                      ['Marked P&L', `${indexReplayQ.data.summary.netMarkedPnlDollars >= 0 ? '+' : '−'}$${Math.abs(indexReplayQ.data.summary.netMarkedPnlDollars).toFixed(0)}`],
                    ].map(([label, value]) => (
                      <div key={label} style={{ minWidth: 86 }}>
                        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: .8 }}>{label}</div>
                        <div style={{ marginTop: 2, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 800, color: label === 'Marked P&L' && indexReplayQ.data!.summary.netMarkedPnlDollars < 0 ? 'var(--red)' : 'var(--text)' }}>{value}</div>
                      </div>
                    ))}
                    <div style={{ marginLeft: 'auto', maxWidth: 280, fontSize: 9, lineHeight: 1.5, color: 'var(--amber)' }}>
                      INSUFFICIENT COVERAGE · reported marks, not executable fills. Missing paths stay unresolved.
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(245px,1fr))' }}>
                    {indexReplayQ.data.rows.map((row) => {
                      const contract = row.symbol.replace(/^O:/, '');
                      const color = row.outcome === 'target' ? 'var(--green)' : row.outcome === 'stop' ? 'var(--red)' : 'var(--text-mute)';
                      return (
                        <div key={`${row.date}-${row.symbol}-${row.estTimestamp}`} style={{ display: 'grid', gridTemplateColumns: '62px 1fr auto', gap: 8, padding: '7px 10px', borderRight: '1px solid var(--nx-border)', borderBottom: '1px solid var(--nx-border)', alignItems: 'baseline' }}>
                          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: 'var(--text-mute)' }}>{row.date.slice(5)}</span>
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono',monospace", fontSize: 9 }}>{contract}{row.entryMark != null ? ` · $${row.entryMark.toFixed(2)}` : ''}</span>
                          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, fontWeight: 800, color }} title={row.error}>
                            {row.outcome === 'unresolved'
                              ? row.error?.includes('exceeds') ? 'OVER BUDGET' : 'NO PATH'
                              : `${row.returnPct! >= 0 ? '+' : ''}${row.returnPct!.toFixed(0)}%`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {(ledgerQ.data?.ledger ?? []).map((r) => {
                const mfeMatch = r.outcomeNotes?.match(/peak \$[\d.]+ \(\+?([\d.]+)%\)/i);
                const pathMfe = mfeMatch ? Number(mfeMatch[1]) : null;
                const oc = r.outcome === 'hit_target' ? { c: 'var(--green)', t: 'HIT T1' }
                  : r.outcome === 'hit_stop' ? { c: 'var(--red)', t: 'STOPPED' }
                  : r.outcome === 'expired' && pathMfe != null && pathMfe >= 10 ? { c: 'var(--amber)', t: `PEAK +${pathMfe.toFixed(0)}% · FADED` }
                  : r.outcome === 'expired' ? { c: 'var(--text-mute)', t: 'EXPIRED' }
                  : { c: 'var(--cyan-bright)', t: 'OPEN' };
                return (
                  <div key={r.id} role="button" tabIndex={0} onKeyDown={pressOnEnter} onClick={() => setSelectedLedger(r)}
                    aria-label={`Open historical analysis for ${r.symbol}`}
                    style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '6px 4px', borderBottom: '1px solid var(--nx-border, rgba(148,163,184,0.08))', cursor: 'pointer' }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', minWidth: 56 }}>{new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700, minWidth: 52 }}>{r.symbol}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', fontWeight: 700, color: r.direction === 'short' ? 'var(--red)' : 'var(--green)', minWidth: 42 }}>{r.direction === 'short' ? '▼ BEAR' : '▲ BULL'}</span>
                    <span style={{ fontSize: 'var(--fs-10, 10px)', color: 'var(--text-dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.optionType && r.strikePrice != null
                        ? `${r.contractSymbol ? r.contractSymbol.replace(/\d{6}[CP]\d{8}$/, '') : r.symbol} ${r.strikePrice}${r.optionType === 'call' ? 'C' : 'P'}${r.expiryDate ? ` · ${r.expiryDate.slice(5)}` : ''}`
                        : r.signal}
                      {r.entryPremium != null ? ` · $${Number(r.entryPremium).toFixed(2)}` : ''}
                      {r.exitPremium != null ? ` → $${Number(r.exitPremium).toFixed(2)}` : ''}
                      {r.optionPercentGain != null ? ` · ${Number(r.optionPercentGain) >= 0 ? '+' : ''}${Number(r.optionPercentGain).toFixed(1)}%` : ''}
                      {r.outcome === 'hit_target' && pathMfe != null && pathMfe > Number(r.optionPercentGain ?? 0) ? ` · peak +${pathMfe.toFixed(0)}%` : ''}
                      {r.realizedPnL != null ? ` · ${Number(r.realizedPnL) >= 0 ? '+' : '−'}$${Math.abs(Number(r.realizedPnL)).toFixed(0)} marked` : ''}
                      {r.onDemand ? ' · on-demand' : ''}
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-dim)', minWidth: 46, textAlign: 'right' }}>{r.score != null ? `${r.score}` : '—'}{r.riskRewardRatio != null ? ` · ${r.riskRewardRatio}R` : ''}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', fontWeight: 700, color: oc.c, minWidth: 58, textAlign: 'right' }}>{oc.t}</span>
                  </div>
                );
              })}
              {ledgerQ.isFetching && !(ledgerQ.data?.ledger ?? []).length && (
                <div style={{ padding: 20, textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)' }}>reading the ledger…</div>
              )}
              {!ledgerQ.isFetching && !(ledgerQ.data?.ledger ?? []).length && (
                <div style={{ padding: 20, textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)' }}>nothing published in the last 6 completed trading sessions</div>
              )}
            </div>
          ) : bookView !== 'grid' ? (
            <Suspense fallback={
              <div style={{ padding: 40, textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                loading {bookView}…
              </div>
            }>
              {/* key forces a fresh mount so initialView takes effect on switch */}
              <div style={{ padding: '12px 16px' }}>
                <HuntCockpit key={bookView} initialView={bookView} lockedView />
              </div>
            </Suspense>
          ) : (
          <>
          <div className="stats-bar">
            <div className="stat-box">
              <div className="stat-label">Signals / Held</div>
              <div className="stat-val cyan">
                {signalPicks.length}<span style={{ color: 'var(--text-mute)', fontSize: 'var(--fs-10, 10px)' }}> / {heldPicks.length}</span>
              </div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Avg Evidence</div>
              <div className="stat-val">{avgEv ?? '—'}<span style={{ color: 'var(--text-mute)', fontSize: 'var(--fs-10, 10px)' }}>/100</span></div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Top Evidence</div>
              <div className="stat-val green">{topEv ?? '—'}<span style={{ color: 'var(--text-mute)', fontSize: 'var(--fs-10, 10px)' }}>/100</span></div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Long / Short</div>
              <div className="stat-val">
                <span style={{ color: 'var(--green)' }}>{longs}</span>
                <span style={{ color: 'var(--text-mute)' }}> / </span>
                <span style={{ color: 'var(--red)' }}>{shorts}</span>
              </div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Session</div>
              <div className="stat-val amber">{sessionWord(extended.data?.session).toUpperCase()}</div>
            </div>
          </div>

          <div className="filters">
            <div className="filter-group">
              <span className="filter-label">Book</span>
              {([
                ['setups', `Setups · ${setupCount}`],
                ['live', `Live · ${liveSignalCount}`],
                ['held', `Held · ${heldPicks.length}`],
                ['all', `All · ${picks.length}`],
              ] as const).map(([scope, label]) => (
                <button key={scope} className={`filter-btn${bookScope === scope ? ' active' : ''}`} onClick={() => setBookScope(scope)}>{label}</button>
              ))}
            </div>
            <div className="filter-sep" />
            <div className="filter-group">
              <span className="filter-label">Side</span>
              {(['all', 'long', 'short'] as const).map((s) => (
                <button key={s} className={`filter-btn${side === s ? ' active' : ''}`} onClick={() => setSide(s)}>
                  {s === 'all' ? 'All' : s === 'long' ? 'Long' : 'Short'}
                </button>
              ))}
            </div>
            <div className="filter-sep" />
            <div className="filter-group">
              <span className="filter-label">Band</span>
              <button className={`filter-btn${band === 'all' ? ' active' : ''}`} onClick={() => setBand('all')}>All · {picks.length}</button>
              {(['S', 'A', 'B', 'C'] as const).map((b) => (
                <button key={b} className={`filter-btn${band === b ? ' active' : ''}`} onClick={() => setBand(b)}>
                  {b} · {bandCounts[b] ?? 0}
                </button>
              ))}
            </div>
            <div className="filter-sep" />
            <div className="filter-group">
              <span className="filter-label">Sort</span>
              {([['conviction', 'Conviction'], ['rr', 'R:R'], ['newest', 'Newest']] as const).map(([v, l]) => (
                <button key={v} className={`filter-btn${sort === v ? ' active' : ''}`} onClick={() => setSort(v)}>{l}</button>
              ))}
            </div>
          </div>

          <div style={{ padding: '8px 16px 0', fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)', fontFamily: "'JetBrains Mono',monospace" }}>
            <span style={{ color: 'var(--text)' }}>
              {bookList.length < shown.length ? `top ${bookList.length} of ${shown.length}` : `${shown.length} displayed`}
            </span>
            {' · '}{signalPicks.length} current signal{signalPicks.length === 1 ? '' : 's'}
            {' · '}{heldPicks.length} held position{heldPicks.length === 1 ? '' : 's'}
            {legacyHeldCount > 0 ? ` (${legacyHeldCount} legacy book)` : ''}
            {' · '}{convictions.data?.totalCandidatesScanned ?? '—'} candidates scanned this cycle
          </div>

          {explainCards && (
            <div style={{ display: 'grid', gap: 8, padding: '12px 14px', margin: '0 0 12px', border: '1px solid var(--nx-border)', borderRadius: 8, fontFamily: "'JetBrains Mono',monospace" }}>
              {ANATOMY_LEGEND.map(([n, k, v]) => (
                <div key={n} style={{ display: 'grid', gridTemplateColumns: '20px minmax(0,1fr)', gap: 8, alignItems: 'start', fontSize: 11 }}>
                  <AnatomyMark n={n} />
                  <div><b style={{ color: 'var(--text)' }}>{k}.</b> <span style={{ color: 'var(--text-dim)' }}>{v}</span></div>
                </div>
              ))}
            </div>
          )}
          <div
            className={['signals', `density-${prefs.density}`, ...Object.entries(prefs.card).filter(([, on]) => !on).map(([k]) => `hide-${k}`)].join(' ')}
            style={prefs.columns !== 'auto' ? { gridTemplateColumns: `repeat(${prefs.columns}, minmax(0, 1fr))` } : undefined}
          >
            {bookList.map((p) => {
              const b = bandOf(p);
              // Live quote first — the board-build price can be 15+ min old
              // (audit 2026-09-24). Contract-basis levels are premiums, so the
              // share quote can't be compared to them; those keep the stored mark.
              const isPremiumBasis = (p as any).levelBasis === 'contract';
              const px = isPremiumBasis
                ? (p.currentPrice ?? p.entryPrice)
                : (quoteBySym.get(p.symbol)?.lastPrice ?? p.currentPrice ?? p.entryPrice);
              const g = geometryFor(p, px);
              const botMark = p.isBotHeld ? liveBotPosition.get(p.symbol.toUpperCase()) : undefined;
              const heldPnlPct = botMark?.unrealizedPnLPercent ?? p.unrealizedPnlPercent;
              const cardPnlPct = p.isBotHeld && heldPnlPct != null
                ? Number(heldPnlPct)
                : g.pnlPct;
              const pendingNow = /pending|trigger/i.test(g.statusLabel ?? '');
              // R:R for someone entering NOW, not the ratio frozen at publish.
              const isLong = p.direction !== 'short';
              const liveRR = (() => {
                if (pendingNow || px == null || p.stopLoss == null || p.targetPrice == null) return null;
                const risk = isLong ? px - p.stopLoss : p.stopLoss - px;
                const reward = isLong ? p.targetPrice - px : px - p.targetPrice;
                return risk > 0 && reward > 0 ? reward / risk : 0;
              })();
              // DTE counts down from the expiry, never the value stored at publish.
              const liveDte = p.expiryDate
                ? Math.max(0, Math.ceil((new Date(String(p.expiryDate).slice(0, 10) + 'T20:00:00Z').getTime() - Date.now()) / 86_400_000))
                : p.optionDte ?? null;
              const pending = /pending|trigger/i.test(g.statusLabel ?? '');
              const botFloor = botStatus.data?.config?.minConviction ?? 18;
              // A directional record can remain on the audit trail after its
              // evidence decays. Do not present that history as a fresh call.
              const weakThesis = !p.isBotHeld && (p.convictionScore ?? 0) < botFloor;
              const displayStatus = weakThesis ? 'THESIS WEAKENED' : g.statusLabel;
              const against = (p.layers ?? []).filter((l) => l.points < 0);
              const chips = (p.layers ?? [])
                .filter((l) => l.points !== 0)
                .sort((a2, b2) => Math.abs(b2.points) - Math.abs(a2.points))
                .slice(0, 4);
              const dir = p.direction === 'long' ? 'bull' : 'bear';
              return (
                <div
                  className={`signal${expanded === p.ideaId ? ' expanded' : ''}`}
                  style={{ ['--band-color' as string]: bandColorOf(b) }}
                  key={p.ideaId}
                  onClick={() => setExpanded(expanded === p.ideaId ? null : p.ideaId)}
                >
                  <div className="sig-head">
                    <div className="sig-ticker">{p.symbol}</div>
                    <div className={`sig-band band-${b}`}>{p.isBotHeld ? 'POS' : b}</div>{explainCards && <AnatomyMark n={1} />}
                    <div className="sig-ev">
                      {p.isBotHeld
                        ? <span title={`${p.botBookName ?? 'Bot book'}${p.botBookLegacy ? ' · older portfolio' : ' · current portfolio'}`}><b>{p.botBookLegacy ? 'LEGACY HELD' : 'BOT HELD'}</b>{heldPnlPct != null ? ` · ${Number(heldPnlPct) >= 0 ? '+' : ''}${Number(heldPnlPct).toFixed(1)}%` : ''}</span>
                        : <span>+<b>{p.convictionScore}</b> evidence</span>}
                      <div className="ev-bar"><div className="ev-bar-fill" style={{ width: p.isBotHeld ? '100%' : `${Math.min(100, ((p.convictionScore ?? 0) / 70) * 100)}%` }} /></div>
                    </div>
                  </div>
                  <div className="sig-type">
                    <span className={`sig-dir ${dir}`}>
                      {weakThesis ? (dir === 'bull' ? '▲ LONG BIAS' : '▼ SHORT BIAS') : (dir === 'bull' ? '▲ BULL' : '▼ BEAR')}
                    </span>
                    <span className="sig-kind">· {p.isBotHeld ? 'position' : p.holdingPeriod}</span>
                    <span className="sig-pattern">{p.isBotHeld ? (p.botBookLegacy ? 'Older bot book · manage or reconcile' : 'Current bot inventory') : (p.thesis?.split('.')[0] ?? '')}</span>
                  </div>
                  {p.optionType && p.strikePrice != null && p.expiryDate && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, margin: '-2px 0 7px', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-dim)' }}>
                      <span style={{ color: 'var(--cyan-bright)', fontWeight: 700 }}>
                        {p.symbol} ${p.strikePrice}{p.optionType === 'call' ? 'C' : 'P'} · {String(p.expiryDate).slice(5, 10)}
                      </span>
                      <span>{p.entryPremium != null ? `entry mark $${Number(p.entryPremium).toFixed(2)}` : 'mark unavailable'}</span>
                    </div>
                  )}
                  <SigChart symbol={p.symbol} dir={dir} />
                  <div className="sig-status">
                    <span className={`sig-status-pill${pending || weakThesis ? ' pending' : ''}`}>{displayStatus}</span>{explainCards && <AnatomyMark n={2} />}
                    <span style={{ fontSize: 'var(--fs-10, 10px)', color: 'var(--text-dim)' }}>
                      {p.optionDte != null || p.expiryDate
                        ? `${g.horizonUsedPct.toFixed(0)}% of ${g.horizonDays}d used`
                        : 'timing pending contract'}
                    </span>
                  </div>
                  <div className="sig-actions" style={{ display: 'flex', gap: 5, alignItems: 'center', margin: '6px 0 2px', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)' }} onClick={(e) => e.stopPropagation()}>
                    {[
                      ['WORKUP', () => openWorkup(p.symbol)],
                      [watchState[p.symbol] ? `WATCH ${watchState[p.symbol]}` : 'WATCH', () => addToWatch(p.symbol)],
                      ['BOT?', () => {
                        const floor = botFloor;
                        const maxProg = botStatus.data?.config?.maxProgressPct ?? 35;
                        const px = quoteBySym.get(p.symbol)?.lastPrice ?? p.currentPrice ?? p.entryPrice ?? 0;
                        let verdict: string;
                        if (heldByBot.has(p.symbol)) verdict = 'held by the bot ✓';
                        else if ((p.convictionScore ?? 0) < floor) verdict = `below bot floor (${p.convictionScore} < ${floor})`;
                        else if (pending) verdict = 'pending trigger — no front-running its own entry';
                        else if (p.direction === 'long' ? px <= (p.stopLoss ?? 0) : px >= (p.stopLoss ?? Infinity)) verdict = 'invalidated — stop already traded';
                        else if (g.progressPct > maxProg) verdict = `chase guard (${g.progressPct.toFixed(0)}% > ${maxProg}%)`;
                        else verdict = 'qualifies — fills next 10-min cycle (mark + sizing permitting)';
                        setBotVerdicts((v) => ({ ...v, [p.ideaId]: v[p.ideaId] ? '' : verdict }));
                      }],
                    ].map(([label, fn]) => (
                      <button key={String(label)} onClick={fn as () => void}
                        style={{ padding: '2px 7px', borderRadius: 3, background: 'transparent', border: '1px solid var(--nx-border)', color: 'var(--text-mute)', cursor: 'pointer', letterSpacing: 0.5, fontWeight: 700, fontFamily: 'inherit', fontSize: 'var(--fs-9, 9px)', transition: 'all 0.15s' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--cyan-dim)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--nx-border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-mute)'; }}>
                        {String(label)}
                      </button>
                    ))}
                    {botVerdicts[p.ideaId] && <span style={{ color: 'var(--amber)', fontSize: 'var(--fs-9, 9px)' }}>{botVerdicts[p.ideaId]}</span>}
                  </div>
                  <div className="progress-wrap">
                    <div className="progress-label">
                      <span>Progress to T1</span>
                      <b>{g.progressPct.toFixed(0)}%</b>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, g.progressPct))}%` }} />
                    </div>
                  </div>
                  <div className="sig-ev-list">
                    {explainCards && <AnatomyMark n={3} />}
                    {chips.map((l, i) => (
                      <div className={`ev-chip ${l.points >= 0 ? 'pos' : 'neg'}`} key={`${l.kind}-${i}`}>
                        {l.kind.slice(0, 3).toUpperCase()} <span className="v">{l.points > 0 ? '+' : ''}{l.points}</span>
                      </div>
                    ))}
                  </div>
                  <div className="ev-note">
                    {p.isBotHeld
                      ? 'inventory · entry evidence not rescored'
                      : against.length
                        ? `${against.length} layer${against.length > 1 ? 's' : ''} arguing against`
                        : 'no scored layer currently disputes'}
                  </div>
                  <div className="sig-levels" title={(p as any).levelBasis === 'contract' ? 'Levels are the option contract\'s PREMIUM, not share prices' : undefined}>
                    {explainCards && <div style={{ position: 'absolute', marginTop: -10, marginLeft: -6 }}><AnatomyMark n={4} /></div>}
                    <div className="level"><div className="level-label" style={(p as any).levelBasis === 'contract' ? { color: 'var(--amber)' } : undefined}>{(p as any).levelBasis === 'contract' ? 'PREM' : 'Entry'}</div><div className="level-val entry">${p.entryPrice?.toFixed(2) ?? '—'}</div></div>
                    <div className="level"><div className="level-label">Stop</div><div className="level-val stop">${p.stopLoss?.toFixed(2) ?? '—'}</div></div>
                    <div className="level"><div className="level-label">T1</div><div className="level-val t1">${p.targetPrice?.toFixed(2) ?? '—'}</div></div>
                    <div className="level" title={liveRR != null && p.riskRewardRatio ? `R:R if you enter at the live price. At publish it was ${p.riskRewardRatio.toFixed(1)}:1.` : 'R:R from entry — the trigger has not printed'}><div className="level-label">{liveRR != null ? 'R:R now' : 'R:R'}</div><div className="level-val rr" style={liveRR != null && liveRR < 1 ? { color: 'var(--amber)' } : undefined}>{liveRR != null ? `${liveRR.toFixed(1)}:1` : p.riskRewardRatio ? `${p.riskRewardRatio.toFixed(1)}:1` : '—'}</div></div>
                    <div className="level"><div className="level-label">P&amp;L</div><div className={`level-val pnl ${cardPnlPct >= 0 ? 'pos' : 'neg'}`}>{cardPnlPct >= 0 ? '+' : ''}{cardPnlPct.toFixed(1)}%</div></div>
                  </div>
                  <div className="sig-foot">
                    {(() => {
                      const lr = leanOf(p.symbol);
                      if (!lr) return null;
                      const agrees = (lr.lean === 'long') === (p.direction !== 'short');
                      const c = lr.lean === 'flat' ? 'var(--text-mute)' : agrees ? 'var(--green)' : 'var(--amber)';
                      return (
                        <span
                          title={`Bullflow aggressor net premium today: ${lr.net >= 0 ? '+' : '−'}$${(Math.abs(lr.net) / 1e6).toFixed(1)}M (${lr.lean.toUpperCase()}) — ${lr.lean === 'flat' ? 'no decisive tape' : agrees ? 'the tape AGREES with this signal' : 'the tape DISAGREES — options money is positioned the other way'}`}
                          style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8.5, fontWeight: 700, color: c, letterSpacing: 0.5 }}
                        >
                          TAPE {lr.lean === 'flat' ? '·FLAT' : agrees ? '✓' : '✗'} {lr.net >= 0 ? '+' : '−'}${(Math.abs(lr.net) / 1e6).toFixed(1)}M{explainCards && <AnatomyMark n={5} />}
                        </span>
                      );
                    })()}
                    <span>{liveDte != null ? `${liveDte}d` : 'no contract'}</span>
                    <span>{p.sector ?? ''}</span>
                  </div>
                </div>
              );
            })}
            {bookList.length < shown.length && (
              <button type="button" onClick={() => setBookAll(true)}
                style={{ gridColumn: '1/-1', minHeight: 44, border: '1px solid var(--nx-border-hi)', borderRadius: 8, background: 'transparent', color: 'var(--cyan-bright)', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-11, 12px)', fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer' }}>
                Show all {shown.length} ideas
              </button>
            )}
            {!shown.length && (
              <p style={{ gridColumn: '1/-1', textAlign: 'center', padding: '32px 0', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-mute)' }}>
                {convictions.isLoading ? 'loading the book…' : 'Nothing matches these filters.'}
              </p>
            )}
          </div>
          </>
          )}
        </div>

        {/* RIGHT — DEVELOPING */}
        <div className="col col-right">
          <div className="sec-head">
            <div className="sec-num">03 · DEVELOPING</div>
            <div className="sec-title">Setups before the trigger.</div>
            <div className="sec-sub">Coiled names inside groups already receiving money.</div>
            <div className="sec-meta"><span className="tag mute">watch · not signals</span></div>
          </div>
          <RailRestore ids={['dev', 'heat', 'watch']} />

          {/* CANDIDATE FIELD — finally real. Two measured sources, no theater:
              picks whose trigger has not printed (the board's own pending set)
              and pattern-engine coils/NR7 in bullish structure. Watch, not
              signals — clicking opens the workup, nothing here is graded. */}
          {(() => {
            const pendingPicks = picks
              .map((p) => ({ p, g: geometryFor(p, quoteBySym.get(p.symbol)?.lastPrice ?? p.currentPrice ?? p.entryPrice ?? 0) }))
              .filter(({ g }) => /pending|trigger/i.test(g.statusLabel ?? ''))
              .slice(0, 4);
            const coilHits = (patterns.data?.hits ?? [])
              .filter((h) => (h.pattern === 'inside_coil' || h.pattern === 'nr7') && h.bias !== 'short')
              .filter((h) => !pendingPicks.some(({ p }) => p.symbol === h.symbol))
              .slice(0, 5);
            const total = pendingPicks.length + coilHits.length;
            if (!total) return (
              <div className="dev-empty" style={{ order: ord('right', 'dev') }}>
                <div className="dev-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                </div>
                <div className="dev-title">Candidate field</div>
                <div className="dev-desc">No pre-trigger picks and no live coils this sweep — empty means measured-empty, not broken.</div>
                <div className="dev-state"><span className="dot" />screening…</div>
              </div>
            );
            return (
              <div className={railCls('dev', '')} style={{ order: ord('right', 'dev'), padding: '12px 16px', borderBottom: '1px solid var(--nx-border)' }}>
                <div className="intel-head" style={{ marginBottom: 8 }}>
                  <div className="intel-label">Candidate field<Ex id="dev" /><RailCtl id="dev" /></div>
                  <div className="intel-value">{total} developing</div>
                </div>
                {pendingPicks.map(({ p, g }) => (
                  <div key={`pp-${p.ideaId}`} role="button" tabIndex={0} onKeyDown={pressOnEnter} onClick={() => { setCurrentStock({ symbol: p.symbol }); openWorkup(p.symbol); }}
                    style={{ display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: 8, alignItems: 'center', padding: '6px 8px', marginBottom: 4, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--nx-border)', borderRadius: 4, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)' }}>
                    <b style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 12 }}>{p.symbol}</b>
                    <span style={{ color: 'var(--text-dim)' }}>awaiting trigger · entry ${p.entryPrice?.toFixed(2)}</span>
                    <span style={{ color: 'var(--amber)', fontWeight: 700 }}>{(p.convictionScore ?? 0)}pt</span>
                  </div>
                ))}
                {coilHits.map((h) => (
                  <div key={`ch-${h.pattern}-${h.symbol}`} role="button" tabIndex={0} onKeyDown={pressOnEnter} onClick={() => { setCurrentStock({ symbol: h.symbol }); openWorkup(h.symbol); }}
                    style={{ display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: 8, alignItems: 'center', padding: '6px 8px', marginBottom: 4, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--nx-border)', borderRadius: 4, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)' }}>
                    <b style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 12 }}>{h.symbol}</b>
                    <span style={{ color: 'var(--text-dim)' }} title={h.note}>{h.pattern === 'inside_coil' ? 'coiling' : 'NR7 compression'} · {h.note.slice(0, 30)}…</span>
                    <span style={{ color: 'var(--cyan-bright)', fontWeight: 700 }}>watch</span>
                  </div>
                ))}
                <p style={{ marginTop: 6, fontSize: 'var(--fs-11, 12px)', color: 'var(--text-dim)' }}>Watch list, not signals: setups that haven't triggered yet. Tap one for its workup.</p>
              </div>
            );
          })()}

          <div className={railCls('heat', 'heatmap-section')} style={{ order: ord('right', 'heat') }}>
            <div className="intel-head">
              <div className="intel-label">Sector Heatmap<Ex id="heat" /><RailCtl id="heat" /></div>
              <div className="intel-value">{rotation.data?.sessionLabel ?? '1D % chg'}</div>
            </div>
            <div className="heatmap">
              {sectors.map((s) => (
                <button
                  className="heat-cell"
                  key={s.etf}
                  onClick={() => { setCurrentStock({ symbol: s.etf }); openWorkup(s.etf); }}
                  title={`${s.name} · ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}% — click to focus ${s.etf}`}
                  style={{ background: heatColor(s.change), color: Math.abs(s.change) > 2 ? '#fff' : 'rgba(255,255,255,0.85)' }}
                >
                  {s.etf}
                  <span className="chg">{s.change > 0 ? '+' : ''}{s.change.toFixed(1)}%</span>
                </button>
              ))}
            </div>
          </div>

          <div className={railCls('watch', 'watch-section')} style={{ order: ord('right', 'watch') }}>
            <div className="watch-head">
              <div className="watch-title">Watchlist<Ex id="watch" /><RailCtl id="watch" /></div>
              <div className="watch-count" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {watchSyms.length ? `${watchSyms.length} names` : ''}
                {addOpen ? (
                  <input autoFocus value={addSym} onChange={(e) => setAddSym(e.target.value.toUpperCase())}
                    onKeyDown={async (e) => {
                      if (e.key === 'Escape') { setAddOpen(false); setAddSym(''); return; }
                      if (e.key !== 'Enter' || !addSym.trim()) return;
                      try {
                        await apiRequest('POST', '/api/watchlist', { symbol: addSym.trim() });
                        queryClient.invalidateQueries({ queryKey: ['/api/watchlist'] });
                      } catch { /* row simply won't appear */ }
                      setAddOpen(false); setAddSym('');
                    }}
                    placeholder="SYM ↵" style={{ width: 62, background: 'var(--bg-2)', border: '1px solid var(--nx-border-hi)', borderRadius: 3, color: 'var(--text)', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', padding: '2px 6px', outline: 'none' }} />
                ) : (
                  <button title="Add a ticker to the watchlist" onClick={() => setAddOpen(true)}
                    style={{ width: 18, height: 18, borderRadius: 3, background: 'rgba(59,140,255,0.08)', border: '1px solid var(--nx-border-hi)', color: 'var(--cyan-bright)', cursor: 'pointer', fontSize: 12, lineHeight: 1, display: 'grid', placeItems: 'center' }}>+</button>
                )}
              </div>
            </div>
            <div>
              {watchSyms.map(({ symbol }) => {
                const wq = quoteBySym.get(symbol);
                const up = wq != null && wq.changePct >= 0;
                return (
                  <div
                    className={`watch-item${symbol === focusSym ? ' active' : ''}`}
                    key={symbol}
                    draggable
                    onDragStart={() => { dragSym.current = symbol; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropOn(symbol)}
                    title={`Set ${symbol} as the terminal's focus symbol — CHART, GEX and FLOW follow it`}
                    onClick={() => { setCurrentStock({ symbol }); openWorkup(symbol); }}
                  >
                    <div className="watch-sym">{symbol}</div>
                    <div className="watch-name" />
                    <WatchSpark symbol={symbol} up={wq ? up : true} />
                    {wq
                      ? <div className={`watch-chg ${up ? 'up' : 'down'}`}>{up ? '+' : ''}{wq.changePct.toFixed(1)}%</div>
                      : <div className="watch-chg" style={{ color: 'var(--text-mute)' }}>—</div>}
                  </div>
                );
              })}
              {!watchSyms.length && (
                <div style={{ fontSize: 11, color: 'var(--text-mute)', padding: '4px 0' }}>
                  No names on the watchlist yet.
                </div>
              )}
            </div>
          </div>

          {/* System status block removed 2026-09-24: the terminal footer already shows
              connection, uptime, VIX and feed state on every tab. */}
          <div className="disclaimer" style={{ order: 999 }}>
            Educational only · not investment advice.<br />
            Past setups do not guarantee future results.
          </div>
        </div>
      </div>

      {selectedLedger && (
        <Suspense fallback={null}>
          <TickerWorkup
            symbol={selectedLedger.symbol}
            onClose={() => setSelectedLedger(null)}
            historicalRecord={{
              id: selectedLedger.id,
              publishedAt: selectedLedger.at,
              direction: selectedLedger.direction,
              outcome: selectedLedger.outcome,
              score: selectedLedger.score,
              riskRewardRatio: selectedLedger.riskRewardRatio,
              contract: selectedLedger.optionType && selectedLedger.strikePrice != null
                ? `${selectedLedger.symbol} ${selectedLedger.strikePrice}${selectedLedger.optionType === 'call' ? 'C' : 'P'}${selectedLedger.expiryDate ? ` · ${selectedLedger.expiryDate.slice(0, 10)}` : ''}`
                : null,
              entryPremium: selectedLedger.entryPremium,
              exitPremium: selectedLedger.exitPremium,
              optionPercentGain: selectedLedger.optionPercentGain,
              realizedPnL: selectedLedger.realizedPnL,
              outcomeNotes: selectedLedger.outcomeNotes,
              resolutionReason: selectedLedger.resolutionReason,
            }}
          />
        </Suspense>
      )}

    </div>
  );
}

export default NexusBoard;

/** Keyboard parity for clickable rows: Enter/Space fires the row's own onClick.
 *  (UI validation 2026-09-24: board rows were mouse-only — unreachable by keyboard.) */
const pressOnEnter = (e: ReactKeyboardEvent<HTMLElement>) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); }
};
