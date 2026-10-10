/**
 * TICKER WORKUP — the eighth reference mock, wired as the universal dossier.
 *
 * Opens over any tab for any symbol. Every panel is a measurement or an
 * honest absence — the mock itself designed the empty states ("No signal ·
 * benchmark / context ticker") and they render whenever the engines carry
 * nothing for the name:
 *
 *   header       last daily close vs prior close, day's volume — from the
 *                same universal history feed every chart uses
 *   signal card  the conviction engine's live pick for this symbol, with its
 *                real layers as the evidence breakdown; his no-signal state
 *                otherwise. Levels are the pick's entry/stop/target
 *   live stats   RSI-14, ATR-14, vol vs 20d avg, 52w H/L — computed here
 *                from the 1y daily series. Short % has no feed → not shown
 *   chart        the shared NexusPriceChart (real pan/zoom/expand) — the
 *                mock's fake candles and its 4h TF do not ship
 *   options      the flow scanner's real prints for this symbol; premium
 *                sums and C/P computed from them. Direction stays unclaimed
 *   events/news  the symbol's catalyst rows (impact-graded), plus the FRED
 *                macro queue for index ETFs. His methodology note — binary
 *                events are risk, never tilt — kept verbatim
 *   bot          which of the platform's real gates BIND this symbol, with
 *                live condition state — not a fake execution list
 *   related      same-bucket names from the scan universe's own taxonomy,
 *                each with its real 5d change
 *   correlation  Pearson r of daily log returns vs SPY/QQQ/BTC, computed
 *                from real series — dashes under 13 overlapping sessions
 *
 * "Trade" does not exist — no broker. The slot holds Chart/GEX (real
 * navigation). Watch is a real watchlist POST.
 */
import { ContractPickerPanel } from "./contract-picker-panel";
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { useQuery } from '@tanstack/react-query';
import { NexusPriceChart } from '@/components/charting/nexus-price-chart';
import { openWorkup } from '@/lib/workup-bus';
import '@/styles/nexus.css';

/* ── payloads ── */
interface Bar { time: number; open: number; high: number; low: number; close: number; volume?: number }
interface ConvictionsPayload {
  generatedAt?: string;
  picks?: {
    symbol: string; direction?: string | null; tradeType?: string | null; holdingPeriod?: string | null;
    entryPrice?: number | null; stopLoss?: number | null; targetPrice?: number | null; riskRewardRatio?: number | null;
    publishedConvictionScore?: number | null; convictionScore?: number | null;
    publishedConvictionBand?: string | null; convictionBand?: string | null; thesis?: string | null;
    layers?: { kind?: string; label?: string; points?: number; why?: string }[];
  }[];
}
interface CatalystRow { id?: string; symbol?: string; title?: string; description?: string; source?: string; sourceUrl?: string; timestamp?: string; eventType?: string; impact?: string }
interface FlowTrade {
  id?: string; symbol: string; optionType?: string; strikePrice?: number | string; expirationDate?: string;
  volume?: number; openInterest?: number; volumeOIRatio?: number | string; premium?: number | string; totalPremium?: number | string;
  flowType?: string; unusualScore?: number; detectedAt?: string;
}
interface PeersPayload { symbol: string; sector: string | null; peers: string[] }

interface QuantinumDossier {
  symbol: string; asOf: string;
  price: { last: number | null; changePercent: number | null };
  layers: { kind: string; label: string; points: number; why: string; source: string }[];
  unavailable: string[];
  bullPoints: number; bearPoints: number;
  lean: 'bullish' | 'bearish' | 'mixed' | 'quiet';
  confidence: number;
  shortGate: { open: boolean; why: string };
  suggestions: { symbol: string; why: string }[];
}
interface EconPayload { upcoming?: { name: string; date: string; time?: string; importance?: string; description?: string }[] }
interface CryptoPulse { assets?: { symbol: string; closes?: { timestamp: number; close: number }[] }[] }

const INDEX_ETFS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'IVV', 'TQQQ', 'SQQQ']);
const BTC_PROXIES = new Set(['MARA', 'RIOT', 'MSTR', 'COIN', 'IBIT', 'CLSK', 'ETHA', 'ETHE', 'HOOD']);

const fetchJson = (url: string) => async () => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`${url} failed`);
  return r.json();
};

/* ── real math over real series ── */
function rsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let gain = 0; let loss = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  if (gain + loss === 0) return 50;
  const rs = loss === 0 ? Infinity : gain / loss;
  return 100 - 100 / (1 + rs);
}
function atr14(bars: Bar[]): number | null {
  if (bars.length < 15) return null;
  let sum = 0;
  for (let i = bars.length - 14; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    sum += Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prev), Math.abs(bars[i].low - prev));
  }
  return sum / 14;
}
/** Pearson r of daily log returns, aligned by calendar date. */
function correlate(a: { t: number; c: number }[], b: { t: number; c: number }[]): number | null {
  if (a.length < 5 || b.length < 5) return null;
  const day = (t: number) => new Date(t < 2e10 ? t * 1000 : t).toISOString().slice(0, 10);
  const ma = new Map(a.map((p) => [day(p.t), p.c]));
  const mb = new Map(b.map((p) => [day(p.t), p.c]));
  const days = [...ma.keys()].filter((d) => mb.has(d)).sort();
  if (days.length < 13) return null;
  const ra: number[] = []; const rb: number[] = [];
  for (let i = 1; i < days.length; i++) {
    ra.push(Math.log(ma.get(days[i])! / ma.get(days[i - 1])!));
    rb.push(Math.log(mb.get(days[i])! / mb.get(days[i - 1])!));
  }
  const n = ra.length;
  const avgA = ra.reduce((x, y) => x + y, 0) / n;
  const avgB = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - avgA) * (rb[i] - avgB); da += (ra[i] - avgA) ** 2; db += (rb[i] - avgB) ** 2; }
  return da === 0 || db === 0 ? null : num / Math.sqrt(da * db);
}
function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v >= 1000 ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`;
}
function fmtVol(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}
function fmtPremium(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
function relTime(iso?: string): string {
  if (!iso) return '';
  const m = (Date.now() - Date.parse(iso)) / 60_000;
  if (!Number.isFinite(m)) return '';
  if (m < 60) return `${Math.max(1, Math.round(m))}m ago`;
  if (m < 36 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
function useDaily(symbol: string, range: string, key: string) {
  return useQuery<{ data?: Bar[] }>({
    queryKey: ['/api/historical-prices', symbol, range, key],
    queryFn: fetchJson(`/api/historical-prices/${symbol}?range=${range}&interval=1d`),
    staleTime: 120_000, retry: 1,
  });
}

/* Peer row fetches its own 5d change — real, per symbol. */
function PeerRow({ sym, onOpen }: { sym: string; onOpen: (s: string) => void }) {
  const { data } = useDaily(sym, '5d', 'peer');
  const bars = data?.data ?? [];
  const chg = bars.length >= 2 ? ((bars[bars.length - 1].close - bars[bars.length - 2].close) / bars[bars.length - 2].close) * 100 : null;
  return (
    <div className="related-item" onClick={() => onOpen(sym)}>
      <div className="related-sym">{sym}</div>
      <div className="related-name">{chg == null ? 'loading…' : 'same universe bucket'}</div>
      <div className={`related-chg ${chg != null && chg < 0 ? 'down' : 'up'}`}>{chg == null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`}</div>
    </div>
  );
}

function MiniChart({ bars }: { bars: Bar[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last30 = bars.slice(-30);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || last30.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = devicePixelRatio;
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const data = last30.map((b) => b.close);
    const min = Math.min(...data); const max = Math.max(...data);
    const range = max - min || 1;
    const up = data[data.length - 1] >= data[0];
    const color = up ? '#6ee7b7' : '#ff6b3d';
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '40'); grad.addColorStop(1, color + '00');
    ctx.beginPath();
    data.forEach((pt, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((pt - min) / range) * h * 0.85 - h * 0.05;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    data.forEach((pt, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((pt - min) / range) * h * 0.85 - h * 0.05;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.shadowColor = color; ctx.shadowBlur = 6;
    ctx.stroke(); ctx.shadowBlur = 0;
  }, [last30]);
  if (last30.length < 2) return <div className="mini-chart" style={{ display: 'grid', placeItems: 'center', fontSize: 'var(--fs-9, 9px)', fontFamily: "'JetBrains Mono',monospace", color: 'var(--text-mute)' }}>NO SERIES</div>;
  return <div className="mini-chart"><canvas ref={ref} /></div>;
}

type WuTab = 'overview' | 'chart' | 'options' | 'events' | 'bot';

export interface HistoricalWorkupRecord {
  id: string;
  publishedAt: string;
  direction: string;
  outcome: string;
  score?: number | null;
  riskRewardRatio?: number | null;
  contract?: string | null;
  entryPremium?: number | null;
  exitPremium?: number | null;
  optionPercentGain?: number | null;
  realizedPnL?: number | null;
  outcomeNotes?: string | null;
  resolutionReason?: string | null;
}

export function TickerWorkup({ symbol, onClose, onNavigate, mode = 'modal', historicalRecord, initialTab = 'overview' }: {
  symbol: string;
  onClose?: () => void;
  onNavigate?: (tab: 'chart' | 'gex', symbol: string) => void;
  mode?: 'modal' | 'embedded';
  historicalRecord?: HistoricalWorkupRecord | null;
  initialTab?: WuTab;
}) {
  const close = onClose ?? (() => undefined);
  const [tab, setTab] = useState<WuTab>(initialTab);
  const [watched, setWatched] = useState<'idle' | 'saving' | 'done' | 'fail'>('idle');
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertPrice, setAlertPrice] = useState('');
  const [alertState, setAlertState] = useState<'idle' | 'armed' | 'fail'>('idle');
  // On-demand engine run — the SAME pipeline the publisher runs, for this one
  // name. Publishes into the cockpit book when it finds a qualifying setup.
  const [engineState, setEngineState] = useState<'idle' | 'running' | 'done' | 'fail'>('idle');
  const [engineResult, setEngineResult] = useState<any>(null);
  const runEngine = async () => {
    setEngineState('running');
    try {
      const r = await apiRequest('POST', `/api/engine/analyze/${symbol}`, {});
      const d = await r.json();
      setEngineResult(d);
      setEngineState('done');
      if (d?.published) {
        // The pick now exists in the book — refresh the conviction queries.
        const { queryClient } = await import('@/lib/queryClient');
        queryClient.invalidateQueries({ queryKey: ['/api/convictions'] });
        queryClient.invalidateQueries({ queryKey: ['/api/convictions', 'wu'] });
      }
    } catch { setEngineState('fail'); }
  };

  // Modal workups remain user-triggered. The canonical Research dossier runs
  // the read once per symbol so a search immediately has a current, sourced
  // market interpretation instead of a second click and an empty shell.
  const [qtm, setQtm] = useState<QuantinumDossier | null>(null);
  const [qtmState, setQtmState] = useState<'idle' | 'running' | 'fail'>('idle');
  const autoQuantinumSymbol = useRef('');
  const runQuantinum = async () => {
    setQtmState('running');
    try {
      const r = await fetch(`/api/quantinum/${symbol}`, { credentials: 'include' });
      if (!r.ok) throw new Error(String(r.status));
      setQtm(await r.json());
      setQtmState('idle');
    } catch { setQtmState('fail'); }
  };

  useEffect(() => { setTab(initialTab); setWatched('idle'); setQtm(null); setQtmState('idle'); setEngineState('idle'); setEngineResult(null); }, [initialTab, symbol]);
  useEffect(() => {
    if (mode !== 'embedded' || historicalRecord || autoQuantinumSymbol.current === symbol) return;
    autoQuantinumSymbol.current = symbol;
    void runQuantinum();
  }, [historicalRecord, mode, symbol]);
  // Keyboard: esc closes, ←/→ cycle tabs, ↑/↓ hop through the peer list —
  // the dossier browses like a dossier, not like a webpage.
  const peersRef = useRef<string[]>([]);
  useEffect(() => {
    const TABS: WuTab[] = ['overview', 'chart', 'options', 'events', 'bot'];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mode === 'modal') { e.stopPropagation(); close(); return; }
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setTab((t) => TABS[(TABS.indexOf(t) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]);
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = peersRef.current;
        if (!list.length) return;
        e.preventDefault();
        const cur = list.indexOf(symbol);
        const next = list[(cur + (e.key === 'ArrowDown' ? 1 : list.length - 1) + list.length) % list.length];
        if (next) openWorkup(next);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true } as any);
  }, [close, mode, symbol]);

  const { data: yearly } = useDaily(symbol, '1y', 'wu');
  const { data: conv } = useQuery<ConvictionsPayload>({ queryKey: ['/api/convictions', 'wu'], queryFn: fetchJson('/api/convictions?limit=60'), staleTime: 120_000, retry: 1 });
  const { data: cats } = useQuery<CatalystRow[]>({ queryKey: ['/api/catalysts/symbol', symbol], queryFn: fetchJson(`/api/catalysts/symbol/${symbol}`), staleTime: 300_000, retry: 1 });
  const { data: flow } = useQuery<{ trades?: FlowTrade[] }>({ queryKey: ['/api/options-flow', symbol, 'wu'], queryFn: fetchJson(`/api/options-flow?symbol=${symbol}&limit=40`), staleTime: 180_000, retry: 1 });
  const { data: peers } = useQuery<PeersPayload>({ queryKey: ['/api/peers', symbol], queryFn: fetchJson(`/api/peers/${symbol}`), staleTime: 3600_000, retry: 1 });
  const { data: econ } = useQuery<EconPayload>({ queryKey: ['/api/economic-calendar', 'wu'], queryFn: fetchJson('/api/economic-calendar'), staleTime: 600_000, retry: 1, enabled: INDEX_ETFS.has(symbol) });
  const { data: spyHist } = useDaily('SPY', '3mo', 'wu-corr');
  const { data: qqqHist } = useDaily('QQQ', '3mo', 'wu-corr');
  const { data: shortInt } = useQuery<{ shortPercentOfFloat: number | null; shortRatio: number | null; squeezeContext: string }>({ queryKey: ['/api/short-interest', symbol], queryFn: fetchJson(`/api/short-interest/${symbol}`), staleTime: 3600_000, retry: 1 });
  const { data: aggressor } = useQuery<{ enabled: boolean; read: { lean: 'long' | 'short' | 'flat'; callsNetPremium: number; putsNetPremium: number } | null }>({ queryKey: ['/api/bullflow/net-premium', symbol], queryFn: fetchJson(`/api/bullflow/net-premium/${symbol}`), staleTime: 180_000, retry: 0 });
  const { data: bullflowContext } = useQuery<{
    enabled: boolean;
    darkPoolLevels?: Array<{ price: number; notional: number; pctDayVolume?: number }>;
    disclosure?: string;
  }>({ queryKey: ['/api/bullflow/context', symbol], queryFn: fetchJson(`/api/bullflow/context/${symbol}`), staleTime: 180_000, retry: 0 });
  const { data: pulse } = useQuery<CryptoPulse>({ queryKey: ['/api/crypto/pulse', 'wu'], queryFn: fetchJson('/api/crypto/pulse'), staleTime: 300_000, retry: 1 });

  const bars = yearly?.data ?? [];
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const price = last?.close ?? null;
  const chgAbs = last && prev ? last.close - prev.close : null;
  const chgPct = last && prev && prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : null;
  const up = (chgPct ?? 0) >= 0;

  const stats = useMemo(() => {
    const closes = bars.map((b) => b.close);
    const vols = bars.map((b) => b.volume ?? 0).filter((v) => v > 0);
    const avgVol20 = vols.length >= 21 ? vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 : null;
    const lastVol = last?.volume ?? null;
    return {
      rsi: rsi14(closes),
      atr: atr14(bars),
      volAvg: avgVol20 && lastVol ? lastVol / avgVol20 : null,
      h52: closes.length ? Math.max(...bars.slice(-252).map((b) => b.high)) : null,
      l52: closes.length ? Math.min(...bars.slice(-252).map((b) => b.low)) : null,
      ret30: bars.length > 21 ? ((bars[bars.length - 1].close - bars[bars.length - 22].close) / bars[bars.length - 22].close) * 100 : null,
      ma20: closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null,
      ma50: closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null,
    };
  }, [bars, last]);

  const pick = conv?.picks?.find((p) => p.symbol?.toUpperCase() === symbol);
  const band = pick?.publishedConvictionBand ?? pick?.convictionBand ?? null;
  const score = pick?.publishedConvictionScore ?? pick?.convictionScore ?? null;
  const layers = (pick?.layers ?? []).filter((l) => Number.isFinite(l.points));
  const evTotal = layers.reduce((a, l) => a + (l.points ?? 0), 0);
  const maxAbsPts = Math.max(1, ...layers.map((l) => Math.abs(l.points ?? 0)));
  const against = layers.filter((l) => (l.points ?? 0) < 0).length;

  const catRows = useMemo(() => (cats ?? []).slice().sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? '')), [cats]);
  const highImpact = catRows.filter((c) => c.impact === 'high');
  const macroEvents = INDEX_ETFS.has(symbol) ? (econ?.upcoming ?? []).slice(0, 3) : [];
  const eventCount = highImpact.length + macroEvents.length;

  const trades = flow?.trades ?? [];
  const flowSums = useMemo(() => {
    const num = (v: number | string | undefined) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const call = trades.filter((t) => (t.optionType ?? '').toLowerCase() === 'call');
    const put = trades.filter((t) => (t.optionType ?? '').toLowerCase() === 'put');
    const callPrem = call.reduce((a, t) => a + num(t.totalPremium ?? t.premium), 0);
    const putPrem = put.reduce((a, t) => a + num(t.totalPremium ?? t.premium), 0);
    return { callPrem, putPrem, ratio: putPrem > 0 ? callPrem / putPrem : null, sweeps: trades.filter((t) => (t.flowType ?? '').toLowerCase().includes('sweep')).length };
  }, [trades]);

  const corr = useMemo(() => {
    const mine = bars.slice(-70).map((b) => ({ t: b.time, c: b.close }));
    const mk = (other?: Bar[]) => other ? correlate(mine, other.slice(-70).map((b) => ({ t: b.time, c: b.close }))) : null;
    const btcCloses = pulse?.assets?.find((a) => a.symbol === 'BTC')?.closes?.map((c) => ({ t: c.timestamp, c: c.close }));
    return {
      SPY: symbol === 'SPY' ? 1 : mk(spyHist?.data),
      QQQ: symbol === 'QQQ' ? 1 : mk(qqqHist?.data),
      BTC: btcCloses ? correlate(mine, btcCloses) : null,
    };
  }, [bars, spyHist, qqqHist, pulse, symbol]);

  /* The real gates that BIND this symbol, with live condition state. */
  const botRules = useMemo(() => {
    const rules: { name: string; meta: string; status: 'armed' | 'triggered' | 'waiting' }[] = [];
    const hasEvent = highImpact.length > 0;
    rules.push({
      name: 'Short discipline gate',
      meta: hasEvent ? `event catalyst on file (${highImpact.length} high-impact) — a short may argue its case` : 'no high-impact event on file — shorts are blocked for this name',
      status: hasEvent ? 'triggered' : 'armed',
    });
    if (BTC_PROXIES.has(symbol)) {
      rules.push({ name: 'BTC-proxy long bias', meta: 'crypto proxy — structurally long-biased, never systematically shorted', status: 'triggered' });
    }
    if (pick) {
      rules.push({
        name: 'Published levels enforced',
        meta: `entry ${fmtPrice(pick.entryPrice)} · stop ${fmtPrice(pick.stopLoss)} · target ${fmtPrice(pick.targetPrice)}`,
        status: 'triggered',
      });
    }
    if (hasEvent) {
      rules.push({ name: 'Event risk sizing', meta: 'high-impact catalyst inside window — SIZE DOWN flag, not auto-exit', status: 'triggered' });
    }
    if (INDEX_ETFS.has(symbol) && macroEvents.length) {
      rules.push({ name: 'Macro cash gate', meta: `${macroEvents[0].name} · ${macroEvents[0].date} — high-importance release gates risk-on ideas`, status: 'triggered' });
    }
    rules.push({ name: 'Sample-size floor', meta: 'no win rate reported for this name under n<30 decided outcomes', status: 'armed' });
    return rules;
  }, [symbol, highImpact, pick, macroEvents]);

  const addWatch = async () => {
    if (watched !== 'idle') return;
    setWatched('saving');
    try {
      const r = await apiRequest('POST', '/api/watchlist', { symbol });
      setWatched(r.ok ? 'done' : 'fail');
    } catch { setWatched('fail'); }
  };

  const levels = pick ? [
    ...(pick.entryPrice != null ? [{ price: pick.entryPrice, color: '#3b8cff', label: 'Entry' }] : []),
    ...(pick.stopLoss != null ? [{ price: pick.stopLoss, color: '#ff6b3d', label: 'Stop' }] : []),
    ...(pick.targetPrice != null ? [{ price: pick.targetPrice, color: '#6ee7b7', label: 'T1' }] : []),
  ] : [];

  const gradeClass = band ? band.toLowerCase().charAt(0) : 'none';
  const dir = (pick?.direction ?? '').toLowerCase();
  const sectorLabel = peers?.sector ? peers.sector.replace(/_/g, ' ') : null;
  useEffect(() => { peersRef.current = peers?.peers ?? []; }, [peers]);

  const num = (v: number | string | undefined) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  const EventItem = ({ title, distance, desc, impact, soft }: { title: string; distance: string; desc: React.ReactNode; impact: string; soft?: boolean }) => (
    <div className="event-item">
      <div className="event-head">
        <div className="event-title">{title}</div>
        <div className="event-distance">{distance}</div>
      </div>
      <div className="event-desc">{desc}</div>
      <div className={`event-impact${soft ? ' soft' : ''}`}>⚠ {impact}</div>
    </div>
  );

  const eventsBlock = (
    <div className="events-list">
      {highImpact.slice(0, 4).map((c) => (
        <EventItem key={c.id ?? c.timestamp} title={`${(c.eventType ?? 'event').toUpperCase()} · ${c.source?.split(':').pop() ?? 'news'}`}
          distance={relTime(c.timestamp)} desc={<>{c.title ?? c.description?.slice(0, 140)}</>} impact="EVENT RISK" />
      ))}
      {macroEvents.map((e) => (
        <EventItem key={`${e.name}-${e.date}`} title={`${e.name} · macro`} distance={e.date}
          desc={<><b>{e.time ?? ''}</b> {e.description ?? ''}</>} impact={e.importance === 'high' ? 'HIGH IMPACT' : 'MONITOR'} soft={e.importance !== 'high'} />
      ))}
      {eventCount === 0 && <div className="wu-empty">No high-impact events on file for {symbol} — the news sentry covers a rotating watchlist slice, so absence here is absence of coverage, not proof of quiet.</div>}
    </div>
  );

  return (
    <div className={`workuplab${mode === 'embedded' ? ' embedded' : ''}${historicalRecord ? ' has-history' : ''}`} onClick={(e) => { if (mode === 'modal' && e.target === e.currentTarget) close(); }}>
      <div className="workup-box" role={mode === 'modal' ? 'dialog' : 'region'} aria-label={`${symbol} research workup`}>

        {/* HEADER */}
        <div className="workup-head">
          <div className="ticker-identity">
            <div className="ticker-logo">{symbol.charAt(0)}</div>
            <div className="ticker-main">
              <div className="ticker-name-row">
                <div className="ticker-sym">{symbol}</div>
                {sectorLabel && <div className="ticker-sector">{sectorLabel}</div>}
                <div className={`ticker-grade ${gradeClass}`}>{band ? `${band}${score != null ? ` · ${Math.round(score)}` : ''}` : '— no signal'}</div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4, fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)' }}>
                <span>daily close series</span>
                <span>·</span>
                <span>Vol <b style={{ color: 'var(--text)' }}>{fmtVol(last?.volume)}</b></span>
                {stats.ret30 != null && (<><span>·</span><span>30d <b style={{ color: stats.ret30 >= 0 ? 'var(--green)' : 'var(--red)' }}>{stats.ret30 >= 0 ? '+' : ''}{stats.ret30.toFixed(1)}%</b></span></>)}
              </div>
            </div>
          </div>

          <div className="ticker-price-block">
            <div className="ticker-price">{fmtPrice(price)}</div>
            <div className="ticker-change">
              <div className={`ticker-change-val ${up ? 'up' : 'down'}`}>{chgAbs != null ? `${chgAbs >= 0 ? '+' : '-'}$${Math.abs(chgAbs).toFixed(2)} · ${chgPct! >= 0 ? '+' : ''}${chgPct!.toFixed(2)}%` : '—'}</div>
              <div className="ticker-change-sub">vs prior daily close {fmtPrice(prev?.close)}</div>
            </div>
          </div>

          <div className="workup-actions">
            <button className={`wa-btn${watched === 'done' ? ' done' : ''}`} onClick={addWatch} title="Add to the real watchlist">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
              {watched === 'done' ? 'Watching' : watched === 'saving' ? '…' : watched === 'fail' ? 'Failed' : 'Watch'}
            </button>
            {alertOpen ? (
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <input autoFocus value={alertPrice} onChange={(e) => setAlertPrice(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Escape') { setAlertOpen(false); return; }
                    if (e.key !== 'Enter') return;
                    const px2 = Number(alertPrice);
                    if (!Number.isFinite(px2) || px2 <= 0) { setAlertState('fail'); return; }
                    try {
                      const r = await apiRequest('POST', '/api/alerts/level', { symbol, price: px2 });
                      setAlertState(r.ok ? 'armed' : 'fail');
                    } catch { setAlertState('fail'); }
                    setAlertOpen(false);
                  }}
                  placeholder="level $" style={{ width: 84, background: 'var(--bg-2)', border: '1px solid var(--nx-border-hi)', borderRadius: 5, color: 'var(--text)', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, padding: '6px 8px', outline: 'none' }} />
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)' }}>↵ arm</span>
              </span>
            ) : (
              <button className={`wa-btn${alertState === 'armed' ? ' done' : ''}`} title="Alert when price crosses a level — fires once, relayed to Discord"
                onClick={() => { setAlertPrice(price != null ? String(Math.round(price * 100) / 100) : ''); setAlertOpen(true); }}>
                {alertState === 'armed' ? 'Alert ✓' : alertState === 'fail' ? 'Alert ✗' : 'Alert'}
              </button>
            )}
            <button className="wa-btn" onClick={() => { onNavigate?.('gex', symbol); if (mode === 'modal') close(); }} title="Open the full GEX surface">GEX</button>
            <button className="wa-btn primary" onClick={() => { onNavigate?.('chart', symbol); if (mode === 'modal') close(); }} title="Open the full chart lab">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
              Chart
            </button>
            {mode === 'modal' && (
              <button className="wa-close" onClick={close} aria-label="Close workup">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        </div>

        {historicalRecord && (
          <section className="history-replay" aria-label="Historical ledger record">
            <div className="history-replay-title">
              <span>Historical replay</span>
              <b>{historicalRecord.outcome.replaceAll('_', ' ')}</b>
            </div>
            <div className="history-replay-metrics">
              <div><span>Published</span><b>{new Date(historicalRecord.publishedAt).toLocaleString()}</b></div>
              <div><span>Recorded contract</span><b>{historicalRecord.contract || 'underlying only'}</b></div>
              <div><span>Option path</span><b>{historicalRecord.entryPremium != null ? `$${historicalRecord.entryPremium.toFixed(2)}` : '—'}{historicalRecord.exitPremium != null ? ` → $${historicalRecord.exitPremium.toFixed(2)}` : ''}</b></div>
              <div><span>Measured return</span><b className={(historicalRecord.optionPercentGain ?? 0) >= 0 ? 'positive' : 'negative'}>{historicalRecord.optionPercentGain != null ? `${historicalRecord.optionPercentGain >= 0 ? '+' : ''}${historicalRecord.optionPercentGain.toFixed(1)}%` : 'unresolved'}</b></div>
              <div><span>Evidence / R:R</span><b>{historicalRecord.score ?? '—'}{historicalRecord.riskRewardRatio != null ? ` · ${historicalRecord.riskRewardRatio}R` : ''}</b></div>
            </div>
            <div className="history-replay-note">
              {historicalRecord.outcomeNotes || historicalRecord.resolutionReason || 'No contract-path audit note is stored for this record.'}
            </div>
            <div className="history-replay-context">The record above is frozen history. The dossier below is current context and may differ from conditions at publication.</div>
          </section>
        )}

        {/* BODY */}
        <div className="workup-body">

          {/* LEFT */}
          <div className="workup-left">
            <div className="ql-section">
              <div className="ql-label" style={{ color: 'var(--purple, #a78bfa)' }}><span className="dot" />Quantinum Intelligence</div>
              {!qtm ? (
                <button
                  className="wa-btn"
                  style={{ width: '100%', justifyContent: 'center', padding: '8px 0', fontSize: 'var(--fs-10, 10px)', letterSpacing: 0.8 }}
                  onClick={runQuantinum}
                  disabled={qtmState === 'running'}
                  title="Run every engine on this name — evidence layers with signed points, missing feeds named"
                >
                  {qtmState === 'running' ? 'RUNNING ENGINES…' : qtmState === 'fail' ? 'FAILED — RETRY' : '◈ RUN FULL BREAKDOWN'}
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', borderRadius: 6, background: qtm.lean === 'bullish' ? 'rgba(52,211,153,0.07)' : qtm.lean === 'bearish' ? 'rgba(255,107,61,0.07)' : 'rgba(148,163,184,0.06)', border: `1px solid ${qtm.lean === 'bullish' ? 'rgba(52,211,153,0.25)' : qtm.lean === 'bearish' ? 'rgba(255,107,61,0.25)' : 'var(--nx-border)'}` }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, color: qtm.lean === 'bullish' ? 'var(--green)' : qtm.lean === 'bearish' ? 'var(--red)' : 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                      {qtm.lean === 'bullish' ? '▲' : qtm.lean === 'bearish' ? '▼' : '◆'} {qtm.lean}
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-dim)' }} title="Display index over evidence weight — not a probability">
                      {qtm.confidence}/100 · +{qtm.bullPoints}/−{qtm.bearPoints}
                    </div>
                  </div>
                  {qtm.layers.map((l, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }} title={`${l.why} — ${l.source}`}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', fontWeight: 700, minWidth: 24, textAlign: 'right', color: l.points > 0 ? 'var(--green)' : l.points < 0 ? 'var(--red)' : 'var(--text-mute)' }}>
                        {l.points > 0 ? `+${l.points}` : l.points}
                      </span>
                      <span style={{ fontSize: 'var(--fs-10, 10px)', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                        <b>{l.label}</b> · <span style={{ color: 'var(--text-dim)' }}>{l.why}</span>
                      </span>
                    </div>
                  ))}
                  {qtm.unavailable.length > 0 && (
                    <div style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', lineHeight: 1.5 }} title={qtm.unavailable.join(' · ')}>
                      NOT MEASURED: {qtm.unavailable.map((u) => u.split(' (')[0]).join(' · ')}
                    </div>
                  )}
                  <div style={{ fontSize: 'var(--fs-9, 9px)', fontFamily: "'JetBrains Mono',monospace", color: qtm.shortGate.open ? 'var(--amber)' : 'var(--text-mute)' }}>
                    SHORT GATE: {qtm.shortGate.open ? 'OPEN' : 'blocked'} — {qtm.shortGate.why}
                  </div>
                  {qtm.suggestions.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                      {qtm.suggestions.map((s) => (
                        <button key={s.symbol} className="wa-btn" style={{ padding: '2px 7px', fontSize: 'var(--fs-9, 9px)' }} title={s.why} onClick={() => openWorkup(s.symbol)}>
                          {s.symbol}{s.why.includes('pattern') ? ' ◆' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="ql-section">
              <div className="ql-label cyan"><span className="dot" />Oracle signal</div>
              <div className="signal-card">
                {pick ? (
                  <>
                    <div className="signal-card-head">
                      <div className={`signal-card-badge ${dir === 'short' ? 'bear' : 'bull'}`}>{dir === 'short' ? '▼ BEAR' : '▲ BULL'}</div>
                      <div className="signal-card-type">{pick.tradeType ?? pick.holdingPeriod ?? 'idea'}{pick.thesis ? ` · ${pick.thesis.split('.')[0].slice(0, 26)}` : ''}</div>
                    </div>
                    <div className="signal-card-ev">
                      <span>{evTotal >= 0 ? '+' : ''}<b>{evTotal}</b> evidence</span>
                      <div className="signal-card-bar"><div className="signal-card-bar-fill" style={{ width: `${Math.min(100, Math.abs(evTotal) / 70 * 100)}%` }} /></div>
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-dim)' }}>
                      <span>{layers.length} layers scored</span>
                      <span>·</span>
                      <span style={{ color: against ? 'var(--amber)' : 'var(--green)' }}>{against} against</span>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>No signal · not in the current conviction book</div>
                    {engineState !== 'done' ? (
                      <button
                        className="wa-btn"
                        style={{ justifyContent: 'center', padding: '6px 0', fontSize: 'var(--fs-10, 10px)', letterSpacing: 0.8 }}
                        disabled={engineState === 'running'}
                        onClick={runEngine}
                        title="Run the SAME engine the publisher runs — every detector, every gate — on this name right now. A found setup publishes into the book; a quiet chart says so."
                      >
                        {engineState === 'running' ? 'ENGINE RUNNING…' : engineState === 'fail' ? 'FAILED — RETRY' : '⚙ RUN ENGINE ON THIS NAME'}
                      </button>
                    ) : engineResult?.published ? (
                      <div style={{ fontSize: 'var(--fs-10-5, 10.5px)', color: 'var(--green)', textAlign: 'center' }}>
                        ✓ {engineResult.idea?.signal} {engineResult.idea?.direction?.toUpperCase()} published — score {engineResult.idea?.score}, R:R {engineResult.idea?.riskRewardRatio}:1. Board refreshing…
                      </div>
                    ) : engineResult?.blocked ? (
                      <div style={{ fontSize: 'var(--fs-10-5, 10.5px)', color: 'var(--amber)', lineHeight: 1.45 }}>{engineResult.blocked}</div>
                    ) : (
                      <div style={{ fontSize: 'var(--fs-10-5, 10.5px)', color: 'var(--text-dim)', lineHeight: 1.45 }} title={`checked: ${(engineResult?.checked ?? []).join(', ')}`}>
                        {engineResult?.reason ?? 'engine ran — no qualifying setup'}{engineResult?.idea ? ` (found ${engineResult.idea.signal} but ${engineResult.reason?.includes('R:R') ? 'below the R:R floor' : 'not publishable'})` : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="ql-section">
              <div className="ql-label">Key levels{(pick as any)?.levelBasis === 'contract' ? ' · contract premium' : ''}</div>
              <div className="ql-levels" title={(pick as any)?.levelBasis === 'contract' ? 'These levels are the option contract\'s premium, not share prices' : undefined}>
                {pick ? (
                  <>
                    <div className="ql-level"><div className="ql-level-name" style={{ color: 'var(--cyan-bright)' }}>Entry</div><div className="ql-level-bar"><div className="ql-level-fill entry" style={{ width: '50%' }} /></div><div className="ql-level-val">{fmtPrice(pick.entryPrice)}</div></div>
                    <div className="ql-level"><div className="ql-level-name" style={{ color: 'var(--red)' }}>Stop</div><div className="ql-level-bar"><div className="ql-level-fill stop" style={{ width: '30%' }} /></div><div className="ql-level-val">{fmtPrice(pick.stopLoss)}</div></div>
                    <div className="ql-level"><div className="ql-level-name" style={{ color: 'var(--green)' }}>T1</div><div className="ql-level-bar"><div className="ql-level-fill t1" style={{ width: '80%' }} /></div><div className="ql-level-val">{fmtPrice(pick.targetPrice)}</div></div>
                    <div className="ql-level"><div className="ql-level-name">R:R</div><div className="ql-level-bar"><div className="ql-level-fill entry" style={{ width: '55%' }} /></div><div className="ql-level-val" style={{ color: 'var(--cyan-bright)' }}>{pick.riskRewardRatio != null ? `${Number(pick.riskRewardRatio).toFixed(1)}:1` : '—'}</div></div>
                  </>
                ) : (
                  <div className="wu-empty">No structured levels · no live idea for this name</div>
                )}
              </div>
            </div>

            <div className="ql-section">
              <div className="ql-label live"><span className="dot" />Computed · 1y daily</div>
              <div className="ql-grid">
                <div className="ql-stat"><div className="ql-stat-k">RSI · 14</div><div className="ql-stat-v">{stats.rsi != null ? Math.round(stats.rsi) : '—'}</div></div>
                <div className="ql-stat"><div className="ql-stat-k">ATR · 14</div><div className="ql-stat-v">{stats.atr != null ? fmtPrice(stats.atr) : '—'}</div></div>
                <div className="ql-stat"><div className="ql-stat-k">Vol / 20d avg</div><div className={`ql-stat-v${stats.volAvg != null && stats.volAvg >= 1.3 ? ' up' : ''}`}>{stats.volAvg != null ? `${stats.volAvg.toFixed(1)}×` : '—'}</div></div>
                <div className="ql-stat" title={`Squeeze context: ${shortInt?.squeezeContext ?? 'unknown'} — exchange-reported, twice-monthly cycle`}>
                  <div className="ql-stat-k">Short % float</div>
                  <div className="ql-stat-v" style={{ color: (shortInt?.shortPercentOfFloat ?? 0) >= 0.15 ? 'var(--red)' : (shortInt?.shortPercentOfFloat ?? 0) >= 0.08 ? 'var(--amber)' : undefined }}>
                    {shortInt?.shortPercentOfFloat != null ? `${(shortInt.shortPercentOfFloat * 100).toFixed(1)}%` : '—'}
                    {shortInt?.shortRatio != null && <span style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', marginLeft: 4 }}>{shortInt.shortRatio.toFixed(1)}d cover</span>}
                  </div>
                </div>
                <div className="ql-stat"><div className="ql-stat-k">MA 20</div><div className="ql-stat-v cyan">{fmtPrice(stats.ma20)}</div></div>
                <div className="ql-stat"><div className="ql-stat-k">52w H</div><div className="ql-stat-v up">{fmtPrice(stats.h52)}</div></div>
                <div className="ql-stat"><div className="ql-stat-k">52w L</div><div className="ql-stat-v down">{fmtPrice(stats.l52)}</div></div>
              </div>
            </div>

            <div className="ql-section">
              <div className="ql-label amber"><span className="dot" />Catalyst</div>
              {highImpact.length ? (
                <div style={{ padding: 10, background: 'rgba(251,146,60,0.04)', border: '1px solid rgba(251,146,60,0.15)', borderRadius: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ fontSize: 'var(--fs-10, 10px)', color: 'var(--event)', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{highImpact[0].eventType ?? 'event'}</div>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 700, color: 'var(--event)' }}>{relTime(highImpact[0].timestamp)}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.45 }}>{(highImpact[0].title ?? highImpact[0].description ?? '').slice(0, 90)}</div>
                  <div style={{ marginTop: 8, padding: '4px 8px', background: 'rgba(255,107,61,0.08)', border: '1px solid rgba(255,107,61,0.2)', borderRadius: 4, fontSize: 'var(--fs-9, 9px)', color: 'var(--red)', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>⚠ EVENT RISK · SIZE DOWN</div>
                </div>
              ) : (
                <div className="wu-empty">No high-impact event on file.<br />Forward earnings dates are not yet fed.</div>
              )}
            </div>
          </div>

          {/* CENTER */}
          <div className="workup-center">
            <div className="workup-tabs">
              {([['overview', 'Overview', null], ['chart', 'Chart', null], ['options', 'Options', trades.length || null], ['events', 'Events', eventCount || null], ['bot', 'Bot', botRules.length]] as const).map(([k, label, count]) => (
                <div key={k} className={`wt-btn${tab === k ? ' active' : ''}`} onClick={() => setTab(k as WuTab)}>
                  {label}{count != null && <span className="count">{count}</span>}
                </div>
              ))}
            </div>

            <div className="workup-content">
              {tab === 'overview' && (
                <div className="overview-grid">
                  <div className="ov-card wide" style={{ ['--ov-color' as string]: 'var(--cyan)' }}>
                    <div className="ov-head">
                      <div className="ov-title">
                        <div className="icon" style={{ background: 'linear-gradient(135deg, var(--cyan), var(--blue))' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-5" /></svg>
                        </div>
                        Price action · interactive
                      </div>
                      <div className="ov-badge" style={{ color: 'var(--cyan-bright)', background: 'rgba(59,140,255,0.1)', border: '1px solid rgba(59,140,255,0.25)' }}>REAL SERIES</div>
                    </div>
                    <NexusPriceChart key={`ov-${symbol}`} symbol={symbol} initialTf="1D" height={220} levels={levels} expandable />
                    <div className="ov-stats">
                      <div className="ov-stat"><div className="ov-stat-k">Open</div><div className="ov-stat-v">{fmtPrice(last?.open)}</div></div>
                      <div className="ov-stat"><div className="ov-stat-k">High</div><div className="ov-stat-v" style={{ color: 'var(--green)' }}>{fmtPrice(last?.high)}</div></div>
                      <div className="ov-stat"><div className="ov-stat-k">Low</div><div className="ov-stat-v" style={{ color: 'var(--red)' }}>{fmtPrice(last?.low)}</div></div>
                      <div className="ov-stat"><div className="ov-stat-k">Volume</div><div className="ov-stat-v">{fmtVol(last?.volume)}</div></div>
                    </div>
                  </div>

                  <div className="ov-card" style={{ ['--ov-color' as string]: 'var(--cyan)' }}>
                    <div className="ov-head">
                      <div className="ov-title">
                        <div className="icon" style={{ background: 'linear-gradient(135deg, var(--cyan), var(--blue))' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                        </div>
                        Evidence breakdown
                      </div>
                      {pick && <div className="ov-badge" style={{ color: 'var(--cyan-bright)', background: 'rgba(59,140,255,0.1)', border: '1px solid rgba(59,140,255,0.25)' }}>{evTotal >= 0 ? '+' : ''}{evTotal}</div>}
                    </div>
                    {pick ? (
                      <>
                        <div className="ev-list">
                          {layers.slice(0, 7).map((l, i) => {
                            const pts = l.points ?? 0;
                            return (
                              <div className="ev-row" key={i} title={l.why ?? ''}>
                                <div className="ev-name">{(l.label ?? l.kind ?? '—').slice(0, 14)}</div>
                                <div className="ev-bar"><div className={`ev-fill ${pts >= 0 ? 'pos' : 'neg'}`} style={{ width: `${Math.abs(pts) / maxAbsPts * 100}%` }} /></div>
                                <div className={`ev-val ${pts >= 0 ? 'pos' : 'neg'}`}>{pts >= 0 ? '+' : ''}{pts}</div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ marginTop: 10, padding: 8, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--nx-border)', borderRadius: 4, fontSize: 'var(--fs-10, 10px)', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                          {against ? `${against} layer${against !== 1 ? 's' : ''} arguing against — hover a row for its reasoning` : 'no layers arguing against — hover a row for its reasoning'}
                        </div>
                      </>
                    ) : (
                      <div className="wu-empty" style={{ padding: '24px 0' }}>No signal · the conviction engine has no live idea for {symbol}. Nothing is scored here without one.</div>
                    )}
                  </div>

                  <div className="ov-card" style={{ ['--ov-color' as string]: 'var(--event)' }}>
                    <div className="ov-head">
                      <div className="ov-title">
                        <div className="icon" style={{ background: 'linear-gradient(135deg, var(--event), var(--amber))' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                        </div>
                        Catalysts on file
                      </div>
                      <div className="ov-badge" style={{ color: 'var(--event)', background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.25)' }}>{eventCount}</div>
                    </div>
                    {eventsBlock}
                  </div>
                </div>
              )}

              {tab === 'chart' && (
                <div className="ov-card wide" style={{ ['--ov-color' as string]: 'var(--cyan)' }}>
                  <div className="ov-head">
                    <div className="ov-title">
                      <div className="icon" style={{ background: 'linear-gradient(135deg, var(--cyan), var(--blue))' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-5" /></svg>
                      </div>
                      {symbol} · Chart Lab
                    </div>
                    <div className="ov-badge" style={{ color: 'var(--cyan-bright)', background: 'rgba(59,140,255,0.1)', border: '1px solid rgba(59,140,255,0.25)' }}>PAN · ZOOM · ⤢</div>
                  </div>
                  <NexusPriceChart key={`ch-${symbol}`} symbol={symbol} initialTf="1h" height={380} levels={levels} expandable />
                  <div className="ov-stats" style={{ gridTemplateColumns: 'repeat(6,1fr)' }}>
                    <div className="ov-stat"><div className="ov-stat-k">MA 20</div><div className="ov-stat-v" style={{ color: 'var(--cyan-bright)' }}>{fmtPrice(stats.ma20)}</div></div>
                    <div className="ov-stat"><div className="ov-stat-k">MA 50</div><div className="ov-stat-v" style={{ color: 'var(--purple)' }}>{fmtPrice(stats.ma50)}</div></div>
                    <div className="ov-stat"><div className="ov-stat-k">RSI · 14</div><div className="ov-stat-v">{stats.rsi != null ? Math.round(stats.rsi) : '—'}</div></div>
                    <div className="ov-stat"><div className="ov-stat-k">ATR · 14</div><div className="ov-stat-v">{stats.atr != null ? fmtPrice(stats.atr) : '—'}</div></div>
                    <div className="ov-stat"><div className="ov-stat-k">52w H</div><div className="ov-stat-v" style={{ color: 'var(--green)' }}>{fmtPrice(stats.h52)}</div></div>
                    <div className="ov-stat"><div className="ov-stat-k">52w L</div><div className="ov-stat-v" style={{ color: 'var(--red)' }}>{fmtPrice(stats.l52)}</div></div>
                  </div>
                </div>
              )}

              {tab === 'options' && (
                <div className="ov-card wide" style={{ ['--ov-color' as string]: 'var(--purple)' }}>
                  <div className="ov-head">
                    <div className="ov-title">
                      <div className="icon" style={{ background: 'linear-gradient(135deg, var(--purple), var(--blue))' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 9h6v6H9z" /></svg>
                      </div>
                      Unusual options activity
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {aggressor?.read && (
                        <div
                          className="ov-badge"
                          title={`Aggressor-inferred net premium today (ask-side vs bid-side, measured by the tape): calls ${aggressor.read.callsNetPremium < 0 ? '−' : '+'}$${(Math.abs(aggressor.read.callsNetPremium) / 1e6).toFixed(1)}M · puts ${aggressor.read.putsNetPremium < 0 ? '−' : '+'}$${(Math.abs(aggressor.read.putsNetPremium) / 1e6).toFixed(1)}M`}
                          style={{
                            color: aggressor.read.lean === 'long' ? 'var(--green)' : aggressor.read.lean === 'short' ? 'var(--red)' : 'var(--text-dim)',
                            background: aggressor.read.lean === 'long' ? 'rgba(52,211,153,0.1)' : aggressor.read.lean === 'short' ? 'rgba(255,107,61,0.1)' : 'rgba(148,163,184,0.08)',
                            border: `1px solid ${aggressor.read.lean === 'long' ? 'rgba(52,211,153,0.3)' : aggressor.read.lean === 'short' ? 'rgba(255,107,61,0.3)' : 'var(--nx-border)'}`,
                          }}
                        >
                          AGGRESSOR: {aggressor.read.lean.toUpperCase()}
                        </div>
                      )}
                      {!!bullflowContext?.darkPoolLevels?.length && (
                        <div
                          className="ov-badge"
                          title={`${bullflowContext.disclosure} Largest today: ${bullflowContext.darkPoolLevels.slice(0, 3).map((level) => `$${level.price.toFixed(2)} · $${(level.notional / 1e6).toFixed(1)}M`).join(' | ')}`}
                          style={{ color: 'var(--text-dim)', background: 'rgba(148,163,184,0.08)', border: '1px solid var(--nx-border)' }}
                        >
                          DARK ${bullflowContext.darkPoolLevels[0].price.toFixed(2)} · ${(bullflowContext.darkPoolLevels[0].notional / 1e6).toFixed(1)}M
                        </div>
                      )}
                      <div className="ov-badge" style={{ color: 'var(--purple)', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)' }}>{trades.length} prints</div>
                    </div>
                  </div>
                  {trades.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
                      <div className="ov-stat"><div className="ov-stat-k">Call premium</div><div className="ov-stat-v" style={{ color: 'var(--green)' }}>{fmtPremium(flowSums.callPrem)}</div></div>
                      <div className="ov-stat"><div className="ov-stat-k">Put premium</div><div className="ov-stat-v" style={{ color: 'var(--red)' }}>{fmtPremium(flowSums.putPrem)}</div></div>
                      <div className="ov-stat"><div className="ov-stat-k">C/P premium</div><div className="ov-stat-v">{flowSums.ratio != null ? flowSums.ratio.toFixed(2) : '—'}</div></div>
                      <div className="ov-stat"><div className="ov-stat-k">Sweeps</div><div className="ov-stat-v" style={{ color: 'var(--cyan-bright)' }}>{flowSums.sweeps}</div></div>
                    </div>
                  )}
                  <ContractPickerPanel symbol={symbol} />
                  <div className="flow-list">
                    {trades.slice(0, 14).map((t) => {
                      const strike = num(t.strikePrice);
                      const isCall = (t.optionType ?? '').toLowerCase() === 'call';
                      const prem = num(t.totalPremium ?? t.premium);
                      const ft = (t.flowType ?? 'unusual').toLowerCase();
                      const ftClass = ft.includes('whale') ? 'whale' : ft.includes('sweep') ? 'sweep' : ft.includes('block') ? 'block' : 'unusual';
                      return (
                        <div className="flow-row" key={t.id ?? `${t.strikePrice}-${t.detectedAt}`}>
                          <div className="flow-contract">${strike != null ? strike : '—'}{isCall ? 'C' : 'P'} {t.expirationDate ? new Date(t.expirationDate).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}</div>
                          <div className={`flow-type ${ftClass}`}>{ftClass}</div>
                          <div className="flow-voloi">Vol <b>{fmtVol(t.volume)}</b> / OI {fmtVol(t.openInterest)}{t.volumeOIRatio != null ? ` · ${Number(t.volumeOIRatio).toFixed(1)}×` : ''}</div>
                          <div className="flow-premium">{prem != null ? fmtPremium(prem) : '—'}</div>
                          <div className={`flow-side ${isCall ? 'call' : 'put'}`}>{isCall ? 'CALL' : 'PUT'}</div>
                        </div>
                      );
                    })}
                    {trades.length === 0 && <div className="wu-empty" style={{ padding: '24px 0' }}>No prints for {symbol} in the flow window — the scanner surfaces only what clears its thresholds. Direction is never claimed without the trade tape.</div>}
                  </div>
                </div>
              )}

              {tab === 'events' && (
                <div className="ov-card wide" style={{ ['--ov-color' as string]: 'var(--event)' }}>
                  <div className="ov-head">
                    <div className="ov-title">
                      <div className="icon" style={{ background: 'linear-gradient(135deg, var(--event), var(--amber))' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                      </div>
                      Event file · {symbol}
                    </div>
                    <div className="ov-badge" style={{ color: 'var(--event)', background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.25)' }}>{eventCount} tracked</div>
                  </div>
                  {eventsBlock}
                  <div style={{ marginTop: 14, padding: 12, background: 'rgba(251,146,60,0.04)', border: '1px solid rgba(251,146,60,0.15)', borderRadius: 6, fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.55, fontStyle: 'italic' }}>
                    <b style={{ color: 'var(--event)', fontStyle: 'normal' }}>Catalyst methodology:</b> Binary events (earnings, FDA, conferences) are counted as risk, never as directional tilt. A tracked event inside the signal horizon flags <b style={{ color: 'var(--text)' }}>SIZE DOWN</b> — not automatic exit.
                  </div>
                </div>
              )}

              {tab === 'bot' && (
                <div className="ov-card wide" style={{ ['--ov-color' as string]: 'var(--bot)' }}>
                  <div className="ov-head">
                    <div className="ov-title">
                      <div className="icon" style={{ background: 'linear-gradient(135deg, var(--bot), #06b6d4)' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
                      </div>
                      Gates binding {symbol}
                    </div>
                    <div className="ov-badge" style={{ color: 'var(--bot)', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.25)' }}>{botRules.length} bound</div>
                  </div>
                  <div className="bot-list">
                    {botRules.map((r) => (
                      <div className="bot-rule" key={r.name}>
                        <div className="bot-rule-icon">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                        </div>
                        <div>
                          <div className="bot-rule-name">{r.name}</div>
                          <div className="bot-rule-meta">{r.meta}</div>
                        </div>
                        <div className={`bot-rule-status ${r.status}`}>{r.status === 'triggered' ? 'in effect' : r.status}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, padding: 8, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--nx-border)', borderRadius: 4, fontSize: 'var(--fs-10, 10px)', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                    These are the platform's real gates evaluated against {symbol}'s live data — nothing here executes. No broker is connected.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT */}
          <div className="workup-right">
            <div className="mini-chart-wrap">
              <div className="ql-label cyan"><span className="dot" />30-day trend</div>
              <MiniChart bars={bars} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)' }}>
                <span style={{ color: 'var(--text-mute)' }}>30d ago</span>
                <span style={{ color: (stats.ret30 ?? 0) >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{stats.ret30 != null ? `${stats.ret30 >= 0 ? '+' : ''}${stats.ret30.toFixed(1)}%` : '—'}</span>
              </div>
            </div>

            <div className="related-list">
              <div className="ql-label">Related · {sectorLabel ?? 'universe bucket'}</div>
              {(peers?.peers ?? []).map((p) => <PeerRow key={p} sym={p} onOpen={(s) => openWorkup(s)} />)}
              {(peers?.peers ?? []).length === 0 && <div className="wu-empty">Not in a scan-universe bucket — no peers to show.</div>}
            </div>

            <div className="news-list">
              <div className="ql-label">Latest on file</div>
              {catRows.slice(0, 4).map((n) => (
                <div className="news-item" key={n.id ?? n.timestamp} title={n.description ?? ''}>
                  <div className="news-source"><span>{(n.source ?? 'news').split(':').pop()}</span><span>{relTime(n.timestamp)}</span></div>
                  <div className="news-title">{(n.title ?? n.description ?? '').slice(0, 110)}</div>
                </div>
              ))}
              {catRows.length === 0 && <div className="wu-empty">No rows for {symbol} — the sentry's rotating slice has not covered it recently.</div>}
            </div>

            <div className="corr-block">
              <div className="ql-label">Correlation · daily log returns</div>
              {(['SPY', 'QQQ', 'BTC'] as const).filter((s) => s !== symbol).map((s) => {
                const r = corr[s];
                const cls = r == null ? 'low' : Math.abs(r) >= 0.7 ? '' : Math.abs(r) >= 0.45 ? 'mid' : 'low';
                return (
                  <div className="corr-row" key={s}>
                    <span className="sym">{s}</span>
                    <div className="track"><div className={`fill ${cls}`} style={{ width: r == null ? '0%' : `${Math.max(4, Math.abs(r) * 100)}%` }} /></div>
                    <span className="val">{r == null ? '—' : r.toFixed(2)}</span>
                  </div>
                );
              })}
              <div style={{ marginTop: 6, fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', fontFamily: "'JetBrains Mono',monospace" }}>computed · ~3mo overlap, dash under 13 sessions</div>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="workup-foot">
          <div className="wf-item"><span className="dot" /><b>{symbol}</b> · workup</div>
          <div className="wf-sep" />
          <div className="wf-item">Oracle <span className="hl">{band ? `${band}${score != null ? ` · ${Math.round(score)}` : ''}` : 'no signal'}</span></div>
          <div className="wf-sep" />
          <div className="wf-item">Flow <span className="hl">{trades.length}</span> prints</div>
          <div className="wf-sep" />
          <div className="wf-item">Events <span style={{ color: eventCount ? 'var(--event)' : 'var(--text-mute)' }}>{eventCount || 'none on file'}</span></div>
          <div className="wf-sep" />
          <div className="wf-item">Gates <span className="hl">{botRules.length}</span> bound</div>
          <div className="wf-spacer" />
          <div className="wf-item">{mode === 'modal' ? 'esc close · ' : ''}←→ tabs · ↑↓ peers</div>
        </div>
      </div>
    </div>
  );
}

export default TickerWorkup;
