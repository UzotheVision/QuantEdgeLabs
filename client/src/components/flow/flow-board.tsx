/**
 * FLOW BOARD — the FLOW tab. "What is smart money doing?"
 *
 * Built to the desk walkthrough: a market-overview strip (bullish vs bearish premium
 * for the day), the full filter set (score · direction · type · premium size · sweep ·
 * whale), a ticker search that also reaches back over past sessions, and the flow cards
 * themselves. Repeats and per-ticker baselines are computed across the loaded tape so
 * "unusual" means unusual FOR THAT NAME.
 */
import { useMemo, useState } from 'react';
import { openWorkup } from '@/lib/workup-bus';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CanonModelNote, scoreBand } from '@/components/canon';
import { useColResize } from '@/lib/use-col-resize';
import '@/styles/nexus.css';
import { FlowCard } from './flow-card';
import {
  scoreFlow, baselinesBySymbol, repeatCounts, contractKey, WHALE_PREMIUM, type FlowPrint,
} from '@/lib/flow/flow-score';
import { RepeatBuyers } from './repeat-buyers';
import { ConvergenceCard } from './convergence-card';

const CYAN = 'var(--brand-cyan,#3b8cff)';
const BULL = 'var(--trade-bullish,#22c55e)';
const BEAR = 'var(--trade-bearish,#ef4444)';

// Index, leveraged, and broad-sector ETF option tape — the hedging churn the
// single-names default filters out (toggle brings it back).
const INDEX_TAPE = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'SPX', 'XSP', 'NDX', 'VIX', 'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'UVXY', 'SMH', 'SOXX', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLC', 'XLB', 'XLRE', 'IGV', 'XBI', 'GLD', 'SLV', 'USO', 'TLT', 'HYG', 'EEM', 'FXI', 'EWZ', 'GDX', 'GDXU', 'ARKK', 'KRE', 'SPXL', 'SPXS', 'UPRO', 'TSLL', 'TSLG', 'TSLR', 'NVDL', 'SMCX', 'PLTU', 'MSTU', 'MSTX', 'BITX']);

// Dir filters on optionType — call vs put IS measured on this feed, unlike
// buyer-vs-seller, which stays unclaimed (4ce5213).
type Dir = 'all' | 'call' | 'put';
type Kind = 'all' | 'sweep' | 'block' | 'unusual_volume';
const MIN_SCORES = [0, 55, 70, 80] as const;
const MIN_PREMIUM = [0, 100_000, 500_000, 1_000_000] as const;

interface FlowResponse {
  trades?: any[];
  stats?: {
    totalTrades: number; totalValue: number; callCount: number; putCount: number;
    callPutRatio: number; mostActiveTickers?: any[]; repeatTickers?: any[]; unusualActivity?: any[];
  };
}

interface IndexPulseData {
  timestamp?: string;
  gex?: { spotPrice?: number; totalNetGEX?: number; maxGammaStrike?: number; topLevels?: Array<{ strike: number; netGEX: number; type: string }> } | null;
  vwap?: { vwap: number; upper1: number; lower1: number; currentPrice: number; distancePct: number; position: string } | null;
  volumeDelta?: { deltaDirection: string; divergence: boolean; note?: string } | null;
  momentum?: { regime: string; rsi: number; confidence: number; tradingAdvice?: string } | null;
  unifiedScore?: { score: number; direction: 'bullish' | 'bearish' | 'neutral'; confidence: number; thesis: string; topSignals: string[] } | null;
}

interface IndexScalpResponse {
  session?: { isMarketOpen: boolean; minutesToClose: number; sessionLabel: string };
  scalps?: Array<{ id: string; symbol: string; bias: 'calls' | 'puts'; setup: string; strike: number; spot: number; target: number; stop: number; confidence: number; thesis: string; timestamp: string }>;
}

interface BullflowPulse {
  enabled?: boolean;
  streamState?: string;
  gexStreamState?: string;
  printsHeld?: number;
  indexFlow?: { lean: 'long' | 'short' | 'flat'; netPremium: number; asOf?: string } | null;
  latestGexSetup?: { classification?: string; title?: string; message?: string; nodeStrike?: number; newNodeStrike?: number } | null;
}

function IndexZeroDtePulse({ intel, scalps, stream }: { intel?: IndexPulseData; scalps?: IndexScalpResponse; stream?: BullflowPulse }) {
  const score = intel?.unifiedScore?.score;
  const direction = intel?.unifiedScore?.direction ?? 'neutral';
  const confidence = intel?.unifiedScore?.confidence ?? 0;
  const spot = intel?.gex?.spotPrice ?? intel?.vwap?.currentPrice;
  const magnet = intel?.gex?.maxGammaStrike;
  const active = scalps?.scalps?.[0];
  const biasColor = direction === 'bullish' ? BULL : direction === 'bearish' ? BEAR : 'var(--amber)';
  const gate = active ? 'TRIGGERED' : confidence >= 35 ? 'ARMED' : 'WAIT';

  const level = (label: string, value?: number, color = 'var(--text-mute)') => (
    <div style={{ minWidth: 92 }}>
      <div style={{ fontSize: 8, letterSpacing: 1.1, color: 'var(--text-mute)' }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700, color }}>{value != null && Number.isFinite(value) ? value.toFixed(2) : '—'}</div>
    </div>
  );

  return (
    <div style={{ margin: '0 0 10px', padding: '12px 14px', border: '1px solid var(--nx-border, rgba(148,163,184,.14))', borderRadius: 8, background: 'linear-gradient(90deg, rgba(59,140,255,.055), rgba(7,12,20,.35))' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, letterSpacing: 1.4, color: CYAN }}>INDEX 0DTE PULSE · SPX</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginTop: 4 }}>
            <strong style={{ fontSize: 18, color: biasColor }}>{direction.toUpperCase()}</strong>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", color: 'var(--text)' }}>{score != null ? `${score}/100` : '—'}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: gate === 'TRIGGERED' ? BULL : 'var(--amber)' }}>{gate}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, overflowX: 'auto', fontFamily: "'JetBrains Mono',monospace" }}>
          {level('LOWER 1σ', intel?.vwap?.lower1, BEAR)}
          {level('VWAP', intel?.vwap?.vwap, CYAN)}
          {level('SPOT', spot, 'var(--text)')}
          {level('UPPER 1σ', intel?.vwap?.upper1, BULL)}
          {level('GAMMA MAGNET', magnet, 'var(--amber)')}
        </div>
        <div style={{ minWidth: 180, textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 9, lineHeight: 1.6 }}>
          <div style={{ color: stream?.streamState === 'live' ? BULL : 'var(--amber)' }}>TAPE {stream?.streamState?.toUpperCase() ?? 'OFF'} · {stream?.printsHeld ?? 0} PRINTS</div>
          <div style={{ color: 'var(--text-mute)' }}>{scalps?.session?.isMarketOpen ? `${scalps.session.minutesToClose}m TO CLOSE` : 'SESSION CLOSED'} · {confidence}% agreement</div>
        </div>
      </div>
      <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--nx-border, rgba(148,163,184,.1))', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 10 }}>
        <span style={{ color: 'var(--text-secondary)' }}>
          {active ? `${active.symbol} ${active.bias.toUpperCase()} $${active.strike} · ${active.setup.replace(/_/g, ' ')} · ${active.confidence}/100` : 'No qualified entry: bias exists, but level + momentum + tape confirmation has not aligned.'}
        </span>
        <span style={{ color: stream?.indexFlow?.lean === 'long' ? BULL : stream?.indexFlow?.lean === 'short' ? BEAR : 'var(--text-mute)' }}>
          {stream?.indexFlow
            ? `SPY FLOW ${stream.indexFlow.lean.toUpperCase()} · ${stream.indexFlow.netPremium >= 0 ? '+' : '−'}$${(Math.abs(stream.indexFlow.netPremium) / 1e6).toFixed(1)}M`
            : 'SPY flow unavailable'}
          {stream?.latestGexSetup ? ` · ${stream.latestGexSetup.title}` : ''}
        </span>
      </div>
    </div>
  );
}

/** Normalise whatever the API returns into the shape the scorer expects. */
function toPrint(t: any): FlowPrint | null {
  const symbol = t?.symbol ?? t?.ticker;
  if (!symbol) return null;
  const optionType = (t.optionType ?? t.option_type ?? t.type ?? 'call').toLowerCase() === 'put' ? 'put' : 'call';
  return {
    symbol,
    optionType,
    strikePrice: Number(t.strikePrice ?? t.strike_price ?? t.strike ?? 0),
    expirationDate: String(t.expirationDate ?? t.expiration_date ?? t.expiry ?? t.expiryDate ?? ''),
    volume: Number(t.volume ?? t.size ?? 0),
    openInterest: t.openInterest ?? t.open_interest ?? null,
    volumeOIRatio: t.volumeOIRatio ?? t.volume_oi_ratio ?? null,
    premium: Number(t.premium ?? 0),
    totalPremium: t.totalPremium ?? t.total_premium ?? null,
    impliedVolatility: t.impliedVolatility ?? t.implied_volatility ?? null,
    delta: t.delta ?? null,
    underlyingPrice: t.underlyingPrice ?? t.underlying_price ?? t.spot ?? null,
    // No fallback. This used to default to call->bullish / put->bearish, which made
    // the overview's "bullish vs bearish premium" nothing more than call vs put
    // premium wearing a directional label. Absent a measured bias, say so.
    sentiment: (t.sentiment ?? 'unknown') as FlowPrint['sentiment'],
    flowType: (t.flowType ?? t.flow_type ?? 'normal') as FlowPrint['flowType'],
    unusualScore: t.unusualScore ?? t.unusual_score ?? null,
    isLotto: t.isLotto ?? t.is_lotto ?? null,
    detectedAt: t.detectedAt ?? t.detected_at ?? null,
  };
}

export function FlowBoard({ onSelectSymbol }: { onSelectSymbol?: (s: string) => void }) {
  const [dir, setDir] = useState<Dir>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [minScore, setMinScore] = useState<number>(0);
  const [minPrem, setMinPrem] = useState<number>(0);
  const [whaleOnly, setWhaleOnly] = useState(false);
  // Index/leveraged ETF tape (SPY/QQQ 0DTE churn) is mostly hedging and
  // market-making, and on heavy days it buries every single-name whale under
  // same-minute strike-day aggregates. Default view = single names; the index
  // tape is one click away, never hidden.
  const [showIndexTape, setShowIndexTape] = useState(true);
  const [zeroDteOnly, setZeroDteOnly] = useState(false);
  const [q, setQ] = useState('');
  const [days, setDays] = useState(7);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'tape' | 'cards'>('tape');

  const { data, isLoading, isError } = useQuery<FlowResponse>({
    queryKey: ['/api/options-flow', 'board', days],
    queryFn: async () => {
      const r = await fetch(`/api/options-flow?limit=200&days=${days}`, { credentials: 'include' });
      if (!r.ok) throw new Error('flow failed');
      return r.json();
    },
    staleTime: 8_000,
    refetchInterval: 15_000,
    retry: 1,
  });

  const indexPulseQ = useQuery<IndexPulseData>({
    queryKey: ['/api/spx/intelligence', 'SPX', 'flow-pulse'],
    queryFn: async () => {
      const r = await fetch('/api/spx/intelligence?symbol=SPX', { credentials: 'include' });
      if (!r.ok) throw new Error('index pulse failed');
      return r.json();
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 0,
  });

  const indexScalpsQ = useQuery<IndexScalpResponse>({
    queryKey: ['/api/index-scalps', 'flow-pulse'],
    queryFn: async () => {
      const r = await fetch('/api/index-scalps', { credentials: 'include' });
      if (!r.ok) throw new Error('index scalps failed');
      return r.json();
    },
    staleTime: 8_000,
    refetchInterval: 15_000,
    retry: 0,
  });

  const streamQ = useQuery<BullflowPulse>({
    queryKey: ['/api/bullflow/status', 'flow-pulse'],
    queryFn: async () => {
      const r = await fetch('/api/bullflow/status', { credentials: 'include' });
      if (!r.ok) throw new Error('tape status failed');
      return r.json();
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
    retry: 0,
  });

  const prints = useMemo(
    () => (data?.trades ?? []).map(toPrint).filter(Boolean) as FlowPrint[],
    [data],
  );

  const scored = useMemo(() => {
    const base = baselinesBySymbol(prints);
    const reps = repeatCounts(prints);
    return prints
      .map((p) => ({ print: p, score: scoreFlow(p, { baseline: base[p.symbol], repeatCount: reps[contractKey(p)] }) }))
      .sort((a, b) => b.score.score - a.score.score);
  }, [prints]);

  // Market-wide leaders by aggressor-inferred NET premium — the whole-market
  // "where is directional money actually going" strip. Provider-computed
  // (ask-side vs bid-side); absent key or cold feed renders nothing.
  const leadersQ = useQuery<{ enabled: boolean; rows: Array<{ ticker: string; totalNetPremium?: number; totalPremium?: number; callPremium?: number; putPremium?: number }> }>({
    queryKey: ['/api/bullflow/leaders'],
    queryFn: async () => {
      const r = await fetch('/api/bullflow/leaders', { credentials: 'include' });
      if (!r.ok) return { enabled: false, rows: [] };
      return r.json();
    },
    staleTime: 5 * 60_000, refetchInterval: 6 * 60_000, retry: 0,
  });

  const shown = useMemo(() => scored.filter(({ print: p, score: s }) => {
    if (dir !== 'all' && p.optionType !== dir) return false;
    if (kind !== 'all' && p.flowType !== kind) return false;
    if (s.score < minScore) return false;
    if (s.totalPremium < minPrem) return false;
    if (whaleOnly && !s.isWhale) return false;
    if (!showIndexTape && INDEX_TAPE.has(p.symbol.toUpperCase())) return false;
    if (zeroDteOnly) {
      const expiryET = new Date(`${String(p.expirationDate).slice(0, 10)}T12:00:00`).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      if (expiryET !== todayET) return false;
    }
    if (q.trim() && !p.symbol.toUpperCase().includes(q.trim().toUpperCase())) return false;
    return true;
  }), [scored, dir, kind, minScore, minPrem, whaleOnly, showIndexTape, zeroDteOnly, q]);

  // Session premium split.
  //
  // `bull`/`bear` only accumulate premium whose direction was actually MEASURED
  // (sentiment set from the tape). Snapshot-sourced prints land in `unclassified`
  // instead of being silently counted as conviction — a $1M call print that was
  // SOLD is bearish, and nothing in a chain snapshot can tell us which it was.
  // callPrem/putPrem are reported separately and honestly as what they are.
  const overview = useMemo(() => {
    let bull = 0, bear = 0, unclassified = 0, callPrem = 0, putPrem = 0, whales = 0, sweeps = 0;
    for (const { print: p, score: s } of scored) {
      if (p.sentiment === 'bullish') bull += s.totalPremium;
      else if (p.sentiment === 'bearish') bear += s.totalPremium;
      else if (p.sentiment === 'unknown') unclassified += s.totalPremium;
      if (p.optionType === 'call') callPrem += s.totalPremium; else putPrem += s.totalPremium;
      if (s.isWhale) whales++;
      if (s.isSweep) sweeps++;
    }
    const net = bull - bear;
    const measuredPct = (bull + bear + unclassified) > 0
      ? (bull + bear) / (bull + bear + unclassified) * 100
      : 0;

    // Rate of change, not just level. $374M of premium means nothing without
    // knowing whether that is building or fading — the prints carry detectedAt,
    // so compare the last hour against the hour before it. Only computed when
    // BOTH windows have prints; a comparison against an empty prior hour is a
    // meaningless percentage, so it stays null and the UI omits it.
    const now = Date.now();
    let lastHour = 0, priorHour = 0, lastHourN = 0, priorHourN = 0;
    for (const { print: p, score: sc } of scored) {
      const t = p.detectedAt ? new Date(p.detectedAt).getTime() : NaN;
      if (Number.isNaN(t)) continue;
      const ageMin = (now - t) / 60_000;
      if (ageMin <= 60) { lastHour += sc.totalPremium; lastHourN++; }
      else if (ageMin <= 120) { priorHour += sc.totalPremium; priorHourN++; }
    }
    const hourDeltaPct = (lastHourN > 0 && priorHourN > 0 && priorHour > 0)
      ? ((lastHour - priorHour) / priorHour) * 100
      : null;

    return { bull, bear, net, unclassified, callPrem, putPrem, measuredPct, whales, sweeps, hourDeltaPct, total: scored.length };
  }, [scored]);

  // Honest freshness: say when the newest print actually landed, never imply "live".
  const freshness = useMemo(() => {
    const times = prints.map((p) => (p.detectedAt ? Date.parse(String(p.detectedAt)) : NaN)).filter((n) => !Number.isNaN(n));
    if (!times.length) return null;
    const newest = new Date(Math.max(...times));
    const ageH = (Date.now() - newest.getTime()) / 3_600_000;
    return {
      label: newest.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
      stale: ageH > 24,
      ageDays: Math.floor(ageH / 24),
    };
  }, [prints]);

  const toggleWatch = (sym: string) =>
    setWatched((w) => { const n = new Set(w); n.has(sym) ? n.delete(sym) : n.add(sym); return n; });

  const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`;

  // Follow-through rail: drag its border left to widen, double-click to expand.
  const rail = useColResize('nx-flow-side', 300, { sign: -1, min: 240, max: 620 });

  /* table sort — premium / score / time, desc */

  const [sortKey, setSortKey] = useState<'score' | 'premium' | 'time'>('score');
  const sorted = useMemo(() => {
    const arr = [...shown];
    if (sortKey === 'premium') arr.sort((a, b) => b.score.totalPremium - a.score.totalPremium);
    else if (sortKey === 'time') arr.sort((a, b) => String(b.print.detectedAt ?? '').localeCompare(String(a.print.detectedAt ?? '')));
    return arr; // 'score' is the scorer's own order
  }, [shown, sortKey]);

  const dteOf = (p: FlowPrint): number | null => {
    const t = Date.parse(p.expirationDate);
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.round((t - Date.now()) / 86_400_000));
  };
  /* OTM distance, signed toward profit: calls above spot and puts below spot are
     positive. Null spot → dash, never a guess. */
  const otmOf = (p: FlowPrint): number | null => {
    if (p.underlyingPrice == null || !Number.isFinite(p.underlyingPrice) || p.underlyingPrice <= 0) return null;
    const raw = ((p.strikePrice - p.underlyingPrice) / p.underlyingPrice) * 100;
    return p.optionType === 'call' ? raw : -raw;
  };
  const bandClass = (n: number) => scoreBand(n).toLowerCase();

  return (
    <div className="flowlab">
      <div
        className={`main${rail.dragging ? ' nx-dragging' : ''}`}
        style={{ ['--nx-side' as string]: `${rail.width}px` }}
      >
        <div
          className={`nx-resize${rail.dragging ? ' active' : ''}`}
          style={{ right: rail.width - 4, marginLeft: 0 }}
          title="Drag to resize · double-click to expand"
          {...rail.handleProps}
        />
        {/* ══════════ FLOW AREA ══════════ */}
        <div className="flow-area">
          <div className="flow-header">
            <div className="flow-eyebrow">Options activity</div>
            <div className="flow-title-row">
              <div className="flow-title">Flow</div>
              <span className={cn('tag', freshness?.stale ? 'warn' : 'live')} style={freshness?.stale ? { background: 'rgba(250,204,21,0.1)', color: 'var(--amber)', border: '1px solid rgba(250,204,21,0.25)' } : undefined}>
                <span className="dot" />
                {freshness ? (freshness.stale ? `historical · last print ${freshness.label}` : `last print ${freshness.label}`) : 'no prints'}
              </span>
            </div>
            <div className="flow-desc">Follow unusual options-chain activity from aggregate premium to contract-level evidence. Bias and pattern labels are inferred.</div>
          </div>

          <IndexZeroDtePulse intel={indexPulseQ.data} scalps={indexScalpsQ.data} stream={streamQ.data} />

          {/* The mock's six stat-cards — same measured values as before, including
              the honest sixth: Direction is n/a until a tape source measures it. */}
          <div className="stats-bar">
            <div className="stat-card">
              <div className="stat-label">Contract obs</div>
              <div className="stat-val cyan">{overview.total}</div>
              <div className="stat-sub">
                {overview.hourDeltaPct == null
                  ? `window ${days === 200 ? 'all' : `${days}d`}`
                  : `${overview.hourDeltaPct >= 0 ? '▲' : '▼'}${Math.abs(overview.hourDeltaPct).toFixed(1)}% vs prior hr`}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Call premium</div>
              <div className="stat-val green">{money(overview.callPrem)}</div>
              <div className="stat-sub">
                {overview.callPrem >= overview.putPrem
                  ? `leads by ${money(overview.callPrem - overview.putPrem)}`
                  : `trails by ${money(overview.putPrem - overview.callPrem)}`}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Put premium</div>
              <div className="stat-val red">{money(overview.putPrem)}</div>
              <div className="stat-sub">activity ≠ conviction</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">≥$1M premium</div>
              <div className="stat-val">{overview.whales}</div>
              <div className="stat-sub">{overview.total > 0 ? `${Math.round((overview.whales / overview.total) * 100)}% of obs` : '—'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Sweep-like</div>
              <div className="stat-val cyan">{overview.sweeps}</div>
              <div className="stat-sub">aggressive pattern</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Direction</div>
              {overview.measuredPct > 0 ? (
                <>
                  <div className="stat-val cyan">{overview.measuredPct.toFixed(0)}%</div>
                  <div className="stat-sub">of premium measured</div>
                </>
              ) : (
                <>
                  <div className="stat-val" style={{ color: 'var(--text-mute)' }}>n/a</div>
                  <div className="stat-sub">not measured</div>
                </>
              )}
            </div>
          </div>

          {overview.measuredPct === 0 && overview.total > 0 && (
            <div style={{ padding: '8px 24px 0' }}>
              <CanonModelNote tone="gap">
                Direction is not measured on this feed. A chain snapshot cannot tell a
                buyer from a seller, and selling calls is bearish while selling puts is
                bullish — so the side of this premium is unknown, not neutral.
              </CanonModelNote>
            </div>
          )}

          {/* ── market leaders — aggressor-inferred net premium, whole market ── */}
          {(leadersQ.data?.rows?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', overflowX: 'auto', borderBottom: '1px solid var(--nx-border, rgba(148,163,184,0.1))', marginBottom: 8 }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 8.5, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mute)', whiteSpace: 'nowrap' }} title="Provider-measured aggressor net premium (ask-side minus bid-side) — market-wide, ETFs excluded">
                Leaders · net premium
              </span>
              {leadersQ.data!.rows.slice(0, 14).map((r) => {
                const net = r.totalNetPremium ?? ((r.callPremium ?? 0) - (r.putPremium ?? 0));
                const up = net >= 0;
                return (
                  <button key={r.ticker} onClick={() => openWorkup(r.ticker)}
                    title={`${r.ticker}: net ${up ? '+' : '−'}$${(Math.abs(net) / 1e6).toFixed(1)}M aggressor premium today — click for workup`}
                    style={{ display: 'flex', gap: 5, alignItems: 'baseline', padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', cursor: 'pointer', background: up ? 'rgba(52,211,153,0.07)' : 'rgba(255,107,61,0.07)', border: `1px solid ${up ? 'rgba(52,211,153,0.2)' : 'rgba(255,107,61,0.2)'}` }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', fontWeight: 700, color: 'var(--text)' }}>{r.ticker}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: up ? 'var(--green)' : 'var(--red)' }}>{up ? '+' : '−'}${(Math.abs(net) / 1e6).toFixed(1)}M</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── filters — the mock's select bar. Dir is CALL/PUT: measured. ── */}
          <div className="filters-bar">
            <div className="filter-group">
              <span className="filter-label">Names</span>
              <select
                className="filter-select"
                value={showIndexTape ? 'all' : 'single'}
                onChange={(e) => setShowIndexTape(e.target.value === 'all')}
                title="Include index, sector and leveraged ETF contracts. ETF flow can be hedging, so use the 0DTE pulse for context."
              >
                <option value="single">SINGLE NAMES</option>
                <option value="all">ALL + INDEX/ETF</option>
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">DTE</span>
              <select className="filter-select" value={zeroDteOnly ? '0' : 'all'} onChange={(e) => setZeroDteOnly(e.target.value === '0')}>
                <option value="all">ALL</option>
                <option value="0">0DTE ONLY</option>
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">Dir</span>
              <select className="filter-select" value={dir} onChange={(e) => setDir(e.target.value as Dir)}>
                <option value="all">ALL</option>
                <option value="call">CALL</option>
                <option value="put">PUT</option>
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">Pattern</span>
              <select className="filter-select" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                <option value="all">ALL</option>
                <option value="sweep">SWEEP-LIKE</option>
                <option value="block">BLOCK-LIKE</option>
                <option value="unusual_volume">UNUSUAL</option>
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">Score</span>
              <select className="filter-select" value={String(minScore)} onChange={(e) => setMinScore(Number(e.target.value))}>
                {MIN_SCORES.map((v) => <option key={v} value={v}>{v === 0 ? 'ANY' : `${v}+`}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">Premium</span>
              <select className="filter-select" value={String(minPrem)} onChange={(e) => setMinPrem(Number(e.target.value))}>
                {MIN_PREMIUM.map((v) => <option key={v} value={v}>{v === 0 ? 'ANY' : v >= 1e6 ? '$1M+' : `$${v / 1000}K+`}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">Window</span>
              <select className="filter-select" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
                <option value="1">1D</option>
                <option value="7">1W</option>
                <option value="30">1M</option>
                <option value="200">ALL</option>
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">Ticker</span>
              <input
                className="filter-select"
                style={{ width: 90, cursor: 'text', textTransform: 'uppercase' }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="any"
                aria-label="Filter flow by ticker"
              />
            </div>
            <div className="view-toggle">
              {(['tape', 'cards'] as const).map((next) => (
                <button
                  key={next}
                  type="button"
                  onClick={() => setView(next)}
                  className={cn('view-btn', view === next && 'active')}
                  style={{ background: view === next ? undefined : 'transparent', border: 'none' }}
                >
                  {next === 'tape' ? 'Table' : 'Cards'}
                </button>
              ))}
            </div>
          </div>

          {/* ── the tape — the mock's table ── */}
          <div className="table-wrap">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center gap-2 text-label font-mono uppercase tracking-widest text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading the tape…
              </div>
            ) : isError ? (
              <Empty title="Flow unavailable" body="The flow feed did not respond. It will retry automatically." />
            ) : sorted.length === 0 ? (
              <Empty
                title={prints.length === 0 ? 'No chain activity yet' : 'Nothing matches those filters'}
                body={prints.length === 0
                  ? 'No premium-qualified contract observations are available for this window. Activity usually builds through the first 15–30 minutes after the open.'
                  : 'Loosen the score, premium, or type filters to see more of the tape.'}
              />
            ) : view === 'tape' ? (
              <table className="flow-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Symbol</th>
                    <th>Contract</th>
                    <th>Pattern</th>
                    <th className={cn('sortable', sortKey === 'score' && 'text-[var(--cyan)]')} onClick={() => setSortKey('score')}>Score {sortKey === 'score' ? '▾' : ''}</th>
                    <th className={cn('sortable', sortKey === 'premium' && 'text-[var(--cyan)]')} onClick={() => setSortKey('premium')}>Premium {sortKey === 'premium' ? '▾' : ''}</th>
                    <th>Vol / OI</th>
                    <th>OTM</th>
                    <th>DTE</th>
                    <th className={cn('sortable', sortKey === 'time' && 'text-[var(--cyan)]')} onClick={() => setSortKey('time')}>Time {sortKey === 'time' ? '▾' : ''}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(({ print: p, score: sc }, i) => {
                    const dte = dteOf(p);
                    const otm = otmOf(p);
                    const pattern = sc.isWhale ? 'whale'
                      : p.flowType === 'sweep' ? 'sweep'
                        : p.flowType === 'block' ? 'block'
                          : p.flowType === 'unusual_volume' ? 'unusual' : 'normal';
                    return (
                      <tr key={`${contractKey(p)}-${i}`} onClick={() => { onSelectSymbol?.(p.symbol); openWorkup(p.symbol); }}>
                        <td className="row-num">{i + 1}</td>
                        <td className="ticker">{p.symbol}</td>
                        <td className="contract">${p.strikePrice} {p.optionType === 'call' ? 'C' : 'P'} · {p.expirationDate || '—'}</td>
                        <td><span className={`bias ${pattern}`}>{pattern === 'unusual' ? 'unusual' : pattern}</span></td>
                        <td><span className={`score ${bandClass(sc.score)}`} title={`base 38\n${sc.components.map((x) => `${x.points >= 0 ? '+' : ''}${x.points} ${x.label} — ${x.why}`).join('\n')}`}>{sc.score}</span></td>
                        <td className="premium">{money(sc.totalPremium)}</td>
                        <td className="vol-oi">
                          {p.volume.toLocaleString()} / {p.openInterest != null ? p.openInterest.toLocaleString() : '—'}
                          {p.volumeOIRatio != null && <span className="ratio"> · {p.volumeOIRatio.toFixed(1)}x</span>}
                        </td>
                        <td>
                          {otm == null
                            ? <span className="otm" style={{ color: 'var(--text-mute)' }}>—</span>
                            : <span className={cn('otm', otm >= 0 ? 'pos' : 'neg')}>{otm >= 0 ? '+' : ''}{otm.toFixed(1)}%</span>}
                        </td>
                        <td className="dte">{dte != null ? `${dte}d` : '—'}</td>
                        <td className="time">{p.detectedAt ? new Date(p.detectedAt).toTimeString().slice(0, 8) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
                {sorted.map(({ print, score }, i) => (
                  <FlowCard
                    key={`${contractKey(print)}-${i}`}
                    print={print}
                    score={score}
                    watched={watched.has(print.symbol)}
                    onWatch={toggleWatch}
                    onSelect={onSelectSymbol}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ══════════ SIDEBAR — follow-through ══════════ */}
        <div className="sidebar">
          <div className="sec-head">
            <div className="sec-num">Follow-through</div>
            <div className="sec-title">After the print.</div>
            <div className="sec-sub">Repeats answer "is this accumulating?"; convergence answers "does dealer positioning agree?"</div>
            <div className="sec-meta">
              <span className="tag cyan">FLOW</span>
              <span className="tag mute">accumulation × dealer context</span>
            </div>
          </div>
          <div className="follow-section">
            <RepeatBuyers />
          </div>
          <div className="gamma-section">
            <ConvergenceCard />
          </div>
          <div className="disclaimer">
            Educational only · not investment advice.<br />
            Pattern labels are inferred from chain activity.
          </div>
        </div>
      </div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-mono text-[12px] font-bold uppercase tracking-widest text-foreground/80">{title}</p>
      <p className="ui-prose mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
