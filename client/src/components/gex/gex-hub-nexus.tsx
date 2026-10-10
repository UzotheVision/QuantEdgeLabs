/**
 * GEX HUB — the fourth reference mock, wired.
 *
 * Layout and classes are the mock's. Every slot reads the real feed:
 *
 *   ranked list       /api/gex-vex/hub topPlays — playScore, ±γ from
 *                     isNegativeGamma, SPY tagged benchmark
 *   spot card         /api/gex-vex/terminal/:sym snapshot + the tape's quote
 *                     for the day change; flip price only when it exists
 *   money flow        /api/sector-rotation laggards → leaders
 *   matrix            strikeExpiryMatrix — real strikes × real expiries; cell
 *                     intensity from a robust max (hot/mega are relative to
 *                     THIS book, not invented bands); GEX/VEX toggle switches
 *                     the measured field; DTE chips carry real counts
 *   3D                the existing GammaSurface — already the honest surface
 *                     (LISTED mode, overflow ticks); VEX view maps the same
 *                     real matrix through netVEX
 *   context rail      snapshot walls + matrix-derived gravity and strongest
 *                     nodes; the model note is verbatim (the mock copied ours)
 *   ⌘K search         /api/search/symbols — the real universal index, selects
 *                     into the shared stock context so every tab follows
 *
 * The mock's genGEX() random matrix, spot jitter and looping countdown do not
 * ship — same rule as every board before it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useStockContext } from '@/contexts/stock-context';
import { useColResize } from '@/lib/use-col-resize';
import { GammaSurface } from '@/components/prism/gamma-surface';
import { robustMax } from '@/components/viz';
import type { StrikeExpiryCell, GEXSnapshot } from '@shared/gex-types';
import '@/styles/nexus.css';

const q = (path: string) => async () => {
  const r = await fetch(path, { credentials: 'include' });
  if (!r.ok) throw new Error(`${path} failed`);
  return r.json();
};

interface TopPlay {
  symbol: string; sector?: string; spotPrice?: number; playScore?: number;
  conviction?: string; regime?: string; bias?: string; callWall?: number; putWall?: number;
  isNegativeGamma?: boolean; insight?: string;
  totalVEX?: number; vexSignal?: string; gammaFlip?: number | null; flipDistancePct?: number | null;
}
interface HubPayload { hub?: { topPlays?: TopPlay[]; totalScanned?: number; totalTickers?: number; attempted?: number; failedSymbols?: string[]; miniScan?: boolean }; generatedAt?: string }
interface TerminalData { symbol: string; snapshot: GEXSnapshot; strikeExpiryMatrix: StrikeExpiryCell[]; generatedAt?: string }
interface Sector { etf: string; name: string; change: number }
interface RotationPayload { leaders?: Sector[]; laggards?: Sector[]; sectors?: Sector[]; sessionLabel?: string }
interface EHQuote { symbol: string; lastPrice: number; changePct: number }
interface EHPayload { session?: string; gainers?: EHQuote[]; losers?: EHQuote[]; mostActive?: EHQuote[] }
interface SearchResult { symbol: string; name?: string; type?: string }

const DTE_BUCKETS = [
  { id: 'all', label: 'ALL', test: (_d: number) => true },
  { id: '0-7', label: '0–7d', test: (d: number) => d <= 7 },
  { id: '7-30', label: '7–30d', test: (d: number) => d > 7 && d <= 30 },
  { id: '30-90', label: '30–90d', test: (d: number) => d > 30 && d <= 90 },
  { id: '90+', label: '90d+', test: (d: number) => d > 90 },
] as const;
type BucketId = typeof DTE_BUCKETS[number]['id'];

/**
 * The matrix values are denominated in $MILLIONS — the same convention the
 * snapshot's own formatter uses ($-5.48 renders $5.5B at the hub level).
 * Verified against the live feed: SPY's dominant node is 80.14 → $80.1M at
 * $766 AUG 28. Values under one thousand dollars are dust: rendered as an
 * empty cell that still answers on hover, so "visually nothing" never turns
 * into "claimed zero".
 */
const fmtM = (v: number) => {
  const a = Math.abs(v); const sign = v < 0 ? '-' : '';
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}B`;
  if (a >= 1) return `${sign}$${a.toFixed(1)}M`;
  return `${sign}$${(a * 1000).toFixed(0)}K`;
};
const DUST_M = 0.001; // < $1K of exposure
const RANKED_DEFAULT = 12; // ranked board is compact-by-default; expand on demand

export function GexHubNexus() {
  const [, setLocation] = useLocation();
  const { currentStock, setCurrentStock } = useStockContext();
  // The hub's OWN anchor. Its search and ranked list re-anchor THIS, never the
  // global stock context — since the workup took over that contract, setting it
  // from here popped the dossier over the hub on every click. The universal
  // search (top right) owns the popup; the hub's controls own the hub.
  const [anchor, setAnchor] = useState<string | null>(null);
  const symbol = (anchor ?? currentStock?.symbol ?? 'SPY').toUpperCase();
  const [rankMode, setRankMode] = useState<'gex' | 'vex'>('gex');
  const [rankAll, setRankAll] = useState(false);
  const [drill, setDrill] = useState<StrikeExpiryCell | null>(null);

  const [workspace, setWorkspace] = useState<'map' | 'surface'>('map');
  const [view3d, setView3d] = useState(false);
  const [metric, setMetric] = useState<'gex' | 'vex'>('gex');
  const [bucket, setBucket] = useState<BucketId>('0-7');
  const [showAbove, setShowAbove] = useState(false);
  const [showBelow, setShowBelow] = useState(false);
  const leftRail = useColResize('nx-gex-left', 320, { sign: 1, min: 240, max: 520 });
  const rightRail = useColResize('nx-gex-right', 320, { sign: -1, min: 240, max: 520 });

  const { data: hub, isLoading: hubLoading, isError: hubError, refetch: refetchHub } = useQuery<HubPayload>({
    queryKey: ['/api/gex-vex/hub', 'nexus'], queryFn: q('/api/gex-vex/hub'),
    staleTime: 120_000, refetchInterval: 180_000, retry: 1,
  });
  const { data: term, isLoading: termLoading, isError: termError, refetch: refetchTerm } = useQuery<TerminalData>({
    queryKey: ['/api/gex-vex/terminal', symbol, 'nexus'],
    queryFn: q(`/api/gex-vex/terminal/${symbol}?interval=15m&lookback=5`),
    staleTime: 60_000, refetchInterval: 120_000, retry: 1,
  });
  const { data: rotation } = useQuery<RotationPayload>({
    queryKey: ['/api/sector-rotation', 'nexus'], queryFn: q('/api/sector-rotation'),
    staleTime: 120_000, refetchInterval: 180_000, retry: 1,
  });
  const { data: eh } = useQuery<EHPayload>({
    queryKey: ['/api/extended-hours', 'nexus'], queryFn: q('/api/extended-hours'),
    staleTime: 60_000, refetchInterval: 120_000, retry: 1,
  });

  const plays = hub?.hub?.topPlays ?? [];
  const snap = term?.snapshot;
  const matrix = term?.strikeExpiryMatrix ?? [];
  const spot = snap?.spotPrice ?? 0;

  const quoteBySym = useMemo(() => {
    const m = new Map<string, EHQuote>();
    for (const list of [eh?.mostActive, eh?.gainers, eh?.losers]) {
      for (const t of list ?? []) if (!m.has(t.symbol) && Number.isFinite(t.changePct)) m.set(t.symbol, t);
    }
    return m;
  }, [eh]);
  const spotQ = quoteBySym.get(symbol);

  /* ── matrix shaping — all real cells, windowed around spot ── */
  const valOf = (c: StrikeExpiryCell) => (metric === 'vex' ? (c.netVEX ?? 0) : c.netGEX);

  const shaped = useMemo(() => {
    const cells = matrix.filter((c) => Number.isFinite(c.strike) && Number.isFinite(c.dte));
    const expiryAll = [...new Map(cells.map((c) => [c.dte, c.expiryLabel] as const)).entries()]
      .sort((a, b) => a[0] - b[0]);
    const bucketDef = DTE_BUCKETS.find((b) => b.id === bucket)!;
    const expiries = expiryAll.filter(([d]) => bucketDef.test(d));
    const bucketCounts = Object.fromEntries(
      DTE_BUCKETS.map((b) => [b.id, expiryAll.filter(([d]) => b.test(d)).length]),
    ) as Record<BucketId, number>;

    const strikesAll = [...new Set(cells.map((c) => c.strike))].sort((a, b) => b - a);
    const WINDOW = 12;
    const nearestIdx = strikesAll.reduce((best, s, i) =>
      Math.abs(s - spot) < Math.abs(strikesAll[best] - spot) ? i : best, 0);
    const from = showAbove ? 0 : Math.max(0, nearestIdx - WINDOW);
    const to = showBelow ? strikesAll.length : Math.min(strikesAll.length, nearestIdx + WINDOW + 1);
    const strikes = strikesAll.slice(from, to);
    const hiddenAbove = from;
    const hiddenBelow = strikesAll.length - to;

    const byKey = new Map<string, StrikeExpiryCell>();
    cells.forEach((c) => byKey.set(`${c.strike}|${c.dte}`, c));

    const vals = cells.map((c) => Math.abs(valOf(c)));
    const rMax = robustMax(vals, 1e-9, 0.985);

    /* strongest listed nodes above / below spot — the context rail's read */
    let above: StrikeExpiryCell | null = null; let below: StrikeExpiryCell | null = null;
    for (const c of cells) {
      if (c.strike > spot && (!above || Math.abs(valOf(c)) > Math.abs(valOf(above)))) above = c;
      if (c.strike < spot && (!below || Math.abs(valOf(c)) > Math.abs(valOf(below)))) below = c;
    }
    /* gravity: call-side vs put-side share of total |exposure| */
    let pos = 0; let neg = 0;
    for (const c of cells) { const v = valOf(c); if (v >= 0) pos += v; else neg += -v; }
    // One decimal, clamped off the poles: with a single node holding ~99% of
    // exposure, integer rounding printed "0% puts / 100% calls" — but puts
    // EXIST, they are just dwarfed. 0% is a claim of absence; 0.2% is a
    // measurement. (Same lesson as the robust max on the gamma surface.)
    const callPct = pos + neg > 0
      ? Math.min(99.9, Math.max(0.1, (pos / (pos + neg)) * 100))
      : null;

    return { expiries, expiryAll, bucketCounts, strikes, hiddenAbove, hiddenBelow, byKey, rMax, above, below, callPct, total: cells.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix, bucket, showAbove, showBelow, spot, metric]);

  const cellClass = (v: number) => {
    if (v === 0) return '';
    const a = Math.abs(v);
    let cls = v > 0 ? 'call' : 'put';
    if (a >= shaped.rMax) cls += ' mega';
    else if (a >= shaped.rMax * 0.25) cls += ' hot';
    return cls;
  };

  const profile = useMemo(() => {
    const levels = [...(snap?.levels ?? [])]
      .filter((l) => Number.isFinite(l.strike) && Number.isFinite(l.gex))
      .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
      .slice(0, 13)
      .sort((a, b) => b.strike - a.strike);
    const max = Math.max(1e-9, ...levels.map((l) => Math.abs(l.gex)));
    return { levels, max };
  }, [snap?.levels, spot]);

  const regimeRead = snap?.regime === 'negative_gamma'
    ? {
        label: 'Expansion regime',
        tone: 'red',
        headline: 'Dealer hedging can chase the move.',
        expectation: 'Breaks can accelerate. Wait for price to clear a wall, then trade with the confirmed direction instead of fading it.',
      }
    : snap?.regime === 'positive_gamma'
      ? {
          label: 'Compression regime',
          tone: 'green',
          headline: 'Dealer hedging can absorb the move.',
          expectation: 'Expect two-way trade and pinning toward the dominant node. Fade weak extensions until a wall breaks with confirmation.',
        }
      : {
          label: 'Transition regime',
          tone: 'amber',
          headline: 'The dealer map has no stable grip.',
          expectation: 'Treat the walls as decision levels, reduce size, and let price confirm direction before using gamma as confluence.',
        };

  /* ── ⌘K search — the real universal index ── */
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: results = [], isFetching: searching } = useQuery<SearchResult[]>({
    queryKey: ['/api/search/symbols', query.trim().toUpperCase()],
    queryFn: async () => {
      const r = await fetch(`/api/search/symbols?q=${encodeURIComponent(query.trim().toUpperCase())}`, { credentials: 'include' });
      if (!r.ok) return [];
      const body = await r.json();
      return Array.isArray(body) ? body : body.results ?? [];
    },
    enabled: searchOpen && query.trim().length > 0,
    staleTime: 60_000, retry: 0,
  });
  const shownResults: SearchResult[] = query.trim()
    ? results
    : plays.slice(0, 10).map((p) => ({ symbol: p.symbol, name: p.sector, type: 'ranked' }));

  useEffect(() => {
    // Capture phase + stopPropagation: while the hub is mounted, ⌘K belongs to
    // ITS search — the legacy global command palette must not also open.
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen((o) => !o); setQuery(''); setCursor(0);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);
  useEffect(() => { if (searchOpen) setTimeout(() => inputRef.current?.focus(), 40); }, [searchOpen]);

  const pick = (sym: string) => {
    setAnchor(sym.toUpperCase());
    setSearchOpen(false);
  };

  const sessionLabel = eh?.session === 'pre' ? 'Pre-market' : eh?.session === 'post' ? 'After hours' : eh?.session === 'regular' ? 'Live' : 'Last close';
  // The focused terminal snapshot is newer and more complete than the ranked
  // rail. Never let a stale hub row label the same symbol +γ while its live
  // dealer map says −γ.
  const negGamma = snap
    ? snap.regime === 'negative_gamma'
    : plays.find((p) => p.symbol === symbol)?.isNegativeGamma;
  const laggards = (rotation?.laggards ?? []).slice(0, 3);
  const leaders = (rotation?.leaders ?? []).slice(0, 3);

  return (
    <div className="gexlab">
      <div
        className={`main${leftRail.dragging || rightRail.dragging ? ' nx-dragging' : ''}`}
        style={{ ['--nx-gexl' as string]: `${leftRail.width}px`, ['--nx-gexr' as string]: `${rightRail.width}px` }}
      >
        <div className={`nx-resize${leftRail.dragging ? ' active' : ''}`} style={{ left: leftRail.width }} title="Drag to resize · double-click to expand" {...leftRail.handleProps} />
        <div className={`nx-resize${rightRail.dragging ? ' active' : ''}`} style={{ right: rightRail.width - 4, marginLeft: 0 }} title="Drag to resize · double-click to expand" {...rightRail.handleProps} />

        {/* ══════════ LEFT — FOCUS + RANKED ══════════ */}
        <div className="col col-left">
          <div className="sec-head">
            <div className="sec-num">Dealer positioning</div>
            <div className="sec-title">GEX Hub</div>
            <div className="sec-sub">Start with the ranked market, then inspect the true strike × expiry exposure surface.</div>
            <div className="sec-meta">
              <span className="tag cyan">{symbol} focus</span>
              <span className="tag amber">{sessionLabel}</span>
              <button className="focus-action" style={{ marginLeft: 'auto' }} onClick={() => { setSearchOpen(true); setQuery(''); setCursor(0); }}>
                ⌘K SEARCH →
              </button>
            </div>
          </div>

          {/* HERO — the single decision-relevant read: the focus symbol's
              gamma regime. Walls, gravity and nodes are supporting detail
              for this posture. */}
          {snap && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', marginBottom: 10,
                border: '1px solid var(--nx-border-hi)', borderRadius: 8,
                background: 'color-mix(in srgb, var(--cyan) 6%, transparent)',
              }}
              title="Gamma regime — whether dealer hedging currently amplifies or dampens price moves. Positive gamma: dealers sell rallies and buy dips (dampens). Negative gamma: dealers chase the move (amplifies). Neutral: no strong dealer footprint."
            >
              <span style={{
                fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, fontSize: 24, lineHeight: 1,
                color: snap.regime === 'negative_gamma' ? 'var(--red)' : snap.regime === 'positive_gamma' ? 'var(--green)' : 'var(--amber)',
              }}>
                {snap.regime === 'negative_gamma' ? '−γ' : snap.regime === 'positive_gamma' ? '+γ' : '±γ'}
              </span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {snap.regime === 'negative_gamma' ? 'Negative gamma' : snap.regime === 'positive_gamma' ? 'Positive gamma' : snap.regime === 'transitioning' ? 'Transitioning' : 'Neutral regime'}
                </div>
                <div style={{ fontSize: 'var(--fs-10, 10px)', color: 'var(--text-dim)', marginTop: 2 }}>
                  {snap.regime === 'negative_gamma'
                    ? 'Dealer hedging can amplify moves'
                    : snap.regime === 'positive_gamma'
                      ? 'Dealer hedging dampens moves'
                      : 'No strong dealer footprint — levels matter less'}
                </div>
              </div>
              <span style={{ marginLeft: 'auto', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {spot ? `$${spot.toFixed(2)}` : '—'}
                <span style={{ display: 'block', fontSize: 'var(--fs-9, 9px)', marginTop: 2 }}>
                  {snap.putWall != null && snap.callWall != null
                    ? (spot > snap.putWall && spot < snap.callWall
                      ? `inside $${Math.round(snap.putWall)}–$${Math.round(snap.callWall)}`
                      : spot >= snap.callWall
                        ? `above $${Math.round(snap.callWall)} call wall`
                        : `below $${Math.round(snap.putWall)} put wall`)
                    : 'walls —'}
                </span>
              </span>
            </div>
          )}

          <div className="focus-card">
            <div className="focus-head">
              <div className="focus-label" title="Sector rotation — where money is moving out of → into this session">Money flow · {rotation?.sessionLabel ?? 'session'}</div>
              <button className="focus-action" onClick={() => setLocation('/t?tab=flow')}>VIEW →</button>
            </div>
            <div className="spot-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="spot-ticker">{symbol}</div>
                  <div className="spot-price">{spot ? `$${spot.toFixed(2)}` : '—'}</div>
                  {spotQ ? (
                    <div className="spot-chg" style={{ color: spotQ.changePct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {spotQ.changePct >= 0 ? '+' : ''}{spotQ.changePct.toFixed(2)}%
                    </div>
                  ) : (
                    <div className="spot-chg" style={{ color: 'var(--text-mute)' }}>chg —</div>
                  )}
                </div>
                <div style={{ textAlign: 'right', fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)', fontFamily: "'JetBrains Mono',monospace" }}>
                  <div>{symbol === 'SPY' ? 'benchmark' : 'focus'}</div>
                  <div style={{ color: snap?.gammaFlipPrice ? 'var(--cyan-bright)' : 'var(--text-mute)', marginTop: 2 }} title="Gamma flip — the price where dealer gamma changes sign. Below it, hedging amplifies moves.">
                    {snap?.gammaFlipPrice ? `flip $${Math.round(snap.gammaFlipPrice)}` : 'no flip in range'}
                  </div>
                </div>
              </div>
            </div>
            {/* Dealer structure rail — the flip/wall geometry, drawn not implied.
                putWall … gammaFlip … callWall on a price axis with the live spot
                marker; below-flip territory is negative-gamma red. */}
            {snap && (snap.putWall || snap.callWall || snap.gammaFlipPrice) && (() => {
              const pts = [snap.putWall, snap.gammaFlipPrice, snap.callWall, spot].filter((v): v is number => Number.isFinite(v as number));
              const lo = Math.min(...pts) * 0.995; const hi = Math.max(...pts) * 1.005;
              const X = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
              const flip = snap.gammaFlipPrice;
              return (
                <div style={{ margin: '10px 0 4px', padding: '14px 10px 4px', position: 'relative' }}>
                  <div style={{ position: 'relative', height: 6, borderRadius: 3, background: flip != null ? `linear-gradient(90deg, color-mix(in srgb, var(--red) 35%, transparent) ${X(flip)}, color-mix(in srgb, var(--green) 30%, transparent) ${X(flip)})` : 'color-mix(in srgb, var(--cyan) 15%, transparent)' }}>
                    {snap.putWall != null && <div title={`Put wall $${snap.putWall}`} style={{ position: 'absolute', left: X(snap.putWall), top: -4, width: 2, height: 14, background: 'var(--red)', boxShadow: '0 0 6px var(--red)' }} />}
                    {flip != null && <div title={`Gamma flip $${flip}`} style={{ position: 'absolute', left: X(flip), top: -6, width: 2, height: 18, background: 'var(--amber)', boxShadow: '0 0 8px var(--amber)' }} />}
                    {snap.callWall != null && <div title={`Call wall $${snap.callWall}`} style={{ position: 'absolute', left: X(snap.callWall), top: -4, width: 2, height: 14, background: 'var(--green)', boxShadow: '0 0 6px var(--green)' }} />}
                    {spot != null && <div title={`Spot $${spot.toFixed(2)}`} style={{ position: 'absolute', left: X(spot), top: -3, width: 8, height: 12, borderRadius: 2, background: '#fff', boxShadow: '0 0 8px rgba(255,255,255,0.7)', transform: 'translateX(-4px)' }} />}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)' }}>
                    <span style={{ color: 'var(--red)' }}>P {snap.putWall != null ? `$${Math.round(snap.putWall)}` : '—'}</span>
                    <span style={{ color: 'var(--amber)' }}>flip {flip != null ? `$${Math.round(flip)}` : '—'}</span>
                    <span style={{ color: 'var(--green)' }}>C {snap.callWall != null ? `$${Math.round(snap.callWall)}` : '—'}</span>
                  </div>
                </div>
              );
            })()}
            <div className="flow-wrap">
              <div className="flow-side">
                <div className="flow-side-label">Out of</div>
                {laggards.map((s) => (
                  <div className="flow-item" key={s.etf}><span className="sym">{s.name}</span><span className="val out">{s.change.toFixed(1)}%</span></div>
                ))}
                {!laggards.length && <div className="flow-item"><span className="sym" style={{ color: 'var(--text-mute)' }}>no read yet</span></div>}
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-side">
                <div className="flow-side-label">Into</div>
                {leaders.map((s) => (
                  <div className="flow-item" key={s.etf}><span className="sym">{s.name}</span><span className="val in">+{s.change.toFixed(1)}%</span></div>
                ))}
                {!leaders.length && <div className="flow-item"><span className="sym" style={{ color: 'var(--text-mute)' }}>no read yet</span></div>}
              </div>
            </div>
          </div>

          <div className="ranked">
            <div className="ranked-head">
              <div className="ranked-label" title="Ranked by play score — a composite of gamma exposure, wall distance and regime">Ranked · {rankMode === 'gex' ? 'GEX surface' : 'VEX surface'}</div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {(['gex', 'vex'] as const).map((m) => (
                  <button key={m} onClick={() => setRankMode(m)}
                    title={m === 'gex' ? 'Rank by GEX surface — dealer gamma exposure' : 'Rank by VEX surface — volatility exposure'}
                    style={{ padding: '2px 8px', borderRadius: 3, fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer', letterSpacing: 0.5, background: rankMode === m ? 'color-mix(in srgb, var(--amber) 15%, transparent)' : 'transparent', color: rankMode === m ? 'var(--amber)' : 'var(--text-mute)', border: rankMode === m ? '1px solid color-mix(in srgb, var(--amber) 30%, transparent)' : '1px solid var(--nx-border)' }}>
                    {m}
                  </button>
                ))}
                <div
                  className="ranked-count"
                  style={{ marginLeft: 6, color: (hub?.hub?.failedSymbols?.length ?? 0) > 0 ? 'var(--amber)' : undefined }}
                  title={(hub?.hub?.failedSymbols?.length ?? 0) > 0
                    ? `chains failed for: ${hub!.hub!.failedSymbols!.slice(0, 20).join(', ')}${hub!.hub!.failedSymbols!.length > 20 ? '…' : ''}`
                    : 'every attempted name scanned'}
                >
                  {hub?.hub?.miniScan ? 'mini-scan ' : ''}
                  {hub?.hub?.totalTickers ?? hub?.hub?.totalScanned ?? plays.length}
                  {hub?.hub?.attempted != null && hub.hub.attempted !== (hub.hub.totalTickers ?? 0) ? `/${hub.hub.attempted}` : ''} scanned
                  {hub?.hub?.miniScan ? ' · full sweep warming' : ''}
                </div>
              </div>
            </div>
            <div className="ranked-list">
              {(rankMode === 'gex' ? plays : [...plays].sort((a, b) => Math.abs(b.totalVEX ?? 0) - Math.abs(a.totalVEX ?? 0))).slice(0, rankAll ? plays.length : RANKED_DEFAULT).map((p, i) => (
                <div
                  key={p.symbol}
                  className={`ranked-item${p.symbol === 'SPY' ? ' benchmark' : ''}${p.symbol === symbol ? ' active' : ''}`}
                  onClick={() => setAnchor(p.symbol)}
                  title={p.insight ? `${p.symbol} — ${p.insight}` : p.symbol}
                >
                  <div className="ranked-num">{i + 1}</div>
                  <div>
                    <span className="ranked-sym">{p.symbol}</span>
                    {p.symbol === 'SPY' && <span className="ranked-bench">benchmark</span>}
                  </div>
                  {rankMode === 'gex'
                    ? <div className={`ranked-gamma ${p.isNegativeGamma ? 'neg' : 'pos'}`}>{p.isNegativeGamma ? '−γ' : '+γ'}</div>
                    : <div className={`ranked-gamma ${(p.totalVEX ?? 0) < 0 ? 'neg' : 'pos'}`}>{(p.vexSignal ?? 'V').slice(0, 4)}</div>}
                  {rankMode === 'gex'
                    ? <div className="ranked-score" title="play score — composite rank of gamma exposure, wall distance and regime">{p.playScore ?? '—'}</div>
                    : <div className="ranked-score" title="total VEX">{p.totalVEX != null ? `${(p.totalVEX / 1e6) >= 1000 ? (p.totalVEX / 1e9).toFixed(1) + 'B' : (p.totalVEX / 1e6).toFixed(0) + 'M'}` : '—'}</div>}
                </div>
              ))}
              {hubLoading && !plays.length && (
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)', padding: '8px 0' }}>
                  hub scan loading…
                </div>
              )}
              {hubError && !plays.length && (
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)', padding: '8px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>ranked scan unavailable</span>
                  <button onClick={() => refetchHub()} style={{ color: 'var(--cyan)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-10, 10px)', textDecoration: 'underline', padding: 0 }}>retry</button>
                </div>
              )}
            </div>
            {plays.length > RANKED_DEFAULT && (
              <div className="expand-row" onClick={() => setRankAll((a) => !a)}>
                <span>{rankAll ? 'show less' : `+ ${plays.length - RANKED_DEFAULT} more ranked`}</span>
              </div>
            )}
          </div>
        </div>

        {/* ══════════ CENTER — PRISM ══════════ */}
        <div className="col prism-area">
          <div className="prism-header">
            <div className="prism-eyebrow">Dealer map · {symbol}</div>
            <div className="prism-title-row">
              <div className="prism-title">{workspace === 'map' ? 'Where price is likely to react' : 'Strike × Expiry Surface'}</div>
              <div className="prism-badge"><span className="dot" />{termLoading ? 'reading chain…' : `${snap?.expirationsUsed?.length || shaped.expiryAll.length} expiries`}</div>
            </div>
            <div className="prism-desc">{workspace === 'map' ? 'Start with the behavior, dominant node and break levels. Open the surface only when you need the raw chain.' : 'Research view: every material listed node by strike and expiry.'}</div>
          </div>

          <div className="prism-controls">
            <div className="view-toggle">
              {(['map', 'surface'] as const).map((v) => (
                <button key={v} className={`view-btn${workspace === v ? ' active' : ''}`} style={{ background: workspace === v ? undefined : 'transparent', border: 'none' }} onClick={() => setWorkspace(v)}>{v === 'map' ? 'DEALER MAP' : 'EXPIRY SURFACE'}</button>
              ))}
            </div>
            {workspace === 'surface' && <div className="view-toggle">
              {(['2d', '3d'] as const).map((v) => (
                <button key={v} className={`view-btn${(v === '3d') === view3d ? ' active' : ''}`} style={{ background: (v === '3d') === view3d ? undefined : 'transparent', border: 'none' }} onClick={() => setView3d(v === '3d')} title={v === '3d' ? '3D gamma surface — the honest surface, listed cells only' : '2D strike × expiry grid'}>{v.toUpperCase()}</button>
              ))}
            </div>}
            {workspace === 'surface' && <div className="view-toggle">
              {(['gex', 'vex'] as const).map((m) => (
                <button key={m} className={`view-btn${metric === m ? ' active' : ''}`} style={{ background: metric === m ? undefined : 'transparent', border: 'none' }} onClick={() => setMetric(m)} title={m === 'gex' ? 'Net gamma exposure (GEX) — dealer positioning' : 'Net volatility exposure (VEX) — vega-weighted positioning'}>{m.toUpperCase()}</button>
              ))}
            </div>}
            {workspace === 'surface' && <div className="filter-sep" />}
            {workspace === 'surface' && <div className="filter-group">
              <span className="filter-label" title="Days to expiry — filter the surface by time bucket">DTE</span>
              <div className="filter-chips">
                {DTE_BUCKETS.map((b) => (
                  <button key={b.id} className={`filter-chip${bucket === b.id ? ' active' : ''}`} onClick={() => setBucket(b.id)}>
                    {b.label} <span className="n">·{shaped.bucketCounts[b.id]}</span>
                  </button>
                ))}
              </div>
            </div>}
            {workspace === 'surface' && <div className="expiry-selector">
              <div className="expiry-btn" title="Expiries inside the current DTE bucket, and the furthest listed expiry">
                {shaped.expiries.length} of {shaped.expiryAll.length} expiries
                {shaped.expiryAll.length > 0 && ` · max ${shaped.expiryAll[shaped.expiryAll.length - 1][1]} (${shaped.expiryAll[shaped.expiryAll.length - 1][0]}d)`}
              </div>
            </div>}
          </div>

          {workspace === 'map' && (
            <div className="dealer-map-workspace">
              <section className={`dealer-read ${regimeRead.tone}`}>
                <div>
                  <div className="dealer-kicker">{regimeRead.label}</div>
                  <h2>{regimeRead.headline}</h2>
                  <p>{regimeRead.expectation}</p>
                </div>
                <div className="dealer-flow-stat">
                  <span>Net gamma</span>
                  <strong>{snap ? `${snap.totalGEX >= 0 ? '+' : ''}${snap.totalGEX.toFixed(2)}B` : '—'}</strong>
                  <small>per 1% underlying move</small>
                </div>
              </section>

              <section className="dealer-levels">
                {[
                  ['PUT FLOOR', snap?.putWall, 'support / bearish break'],
                  ['SPOT', spot || null, sessionLabel],
                  ['KING NODE', snap?.maxGammaStrike, 'strongest pin'],
                  ['CALL WALL', snap?.callWall, 'resistance / bullish break'],
                ].map(([label, value, note]) => (
                  <div className={`dealer-level ${label === 'SPOT' ? 'spot' : label === 'KING NODE' ? 'king' : ''}`} key={String(label)}>
                    <span>{label}</span>
                    <strong>{typeof value === 'number' && value > 0 ? `$${value.toFixed(2).replace('.00', '')}` : '—'}</strong>
                    <small>{note}</small>
                  </div>
                ))}
              </section>

              <section className="dealer-profile-card">
                <div className="dealer-card-head">
                  <div><span>Gamma profile</span><strong>Near-spot pressure by strike</strong></div>
                  <small>bar length = relative exposure · sign = estimated dealer side</small>
                </div>
                <div className="dealer-profile">
                  {profile.levels.map((level) => {
                    const width = Math.max(2, Math.abs(level.gex) / profile.max * 48);
                    const positive = level.gex >= 0;
                    const special = level.strike === snap?.maxGammaStrike || level.strike === snap?.callWall || level.strike === snap?.putWall;
                    return (
                      <div className={`dealer-profile-row${special ? ' special' : ''}`} key={level.strike}>
                        <div className="dealer-strike">${level.strike}</div>
                        <div className="dealer-bar-axis">
                          <div className={`dealer-bar ${positive ? 'positive' : 'negative'}`} style={positive ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }} />
                          {Math.abs(level.strike - spot) <= Math.max(0.5, spot * 0.001) && <i className="dealer-spot-line" />}
                        </div>
                        <div className="dealer-role">{level.strike === snap?.maxGammaStrike ? 'KING' : level.strike === snap?.callWall ? 'CALL WALL' : level.strike === snap?.putWall ? 'PUT WALL' : `${level.distancePct >= 0 ? '+' : ''}${level.distancePct.toFixed(1)}%`}</div>
                      </div>
                    );
                  })}
                  {!profile.levels.length && <div className="dealer-empty">{termLoading ? 'Building the dealer map…' : 'No material gamma levels returned.'}</div>}
                </div>
              </section>

              <section className="dealer-actions">
                <div>
                  <span>IF PRICE HOLDS INSIDE</span>
                  <strong>{snap?.putWall && snap?.callWall ? `$${snap.putWall}–$${snap.callWall}` : 'the dealer range'}</strong>
                  <p>{snap?.regime === 'negative_gamma' ? 'Do not assume a pin. Wait for direction and use the opposite wall as invalidation.' : `Expect rotation toward $${snap?.maxGammaStrike ?? 'the king node'}; avoid chasing the middle.`}</p>
                </div>
                <div>
                  <span>IF A WALL BREAKS</span>
                  <strong>{snap?.callWall ? `>${snap.callWall} bullish` : 'upper wall bullish'} · {snap?.putWall ? `<${snap.putWall} bearish` : 'lower wall bearish'}</strong>
                  <p>Require price acceptance plus volume/flow confirmation. GEX supplies structure; it does not create the entry by itself.</p>
                </div>
              </section>
            </div>
          )}

          {workspace === 'surface' && <>
          {/* Matrix intensity legend — the single canonical key for cell color and brightness. */}
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'center', padding: '8px 2px 2px', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)' }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Call-side exposure — positive net gamma at that strike × expiry">
              <span style={{ width: 20, height: 12, borderRadius: 2, background: 'linear-gradient(135deg, color-mix(in srgb, var(--green) 30%, transparent), color-mix(in srgb, var(--green) 15%, transparent))' }} />
              calls
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Put-side exposure — negative net gamma at that strike × expiry">
              <span style={{ width: 20, height: 12, borderRadius: 2, background: 'linear-gradient(135deg, color-mix(in srgb, var(--red) 30%, transparent), color-mix(in srgb, var(--red) 15%, transparent))' }} />
              puts
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title="hot — at least 25% of the strongest listed exposure in this book">
              <span style={{ width: 20, height: 12, borderRadius: 2, background: 'linear-gradient(135deg, color-mix(in srgb, var(--green) 30%, transparent), color-mix(in srgb, var(--green) 15%, transparent))', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)' }} />
              hot ≥ 25% of max
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title="mega — the single strongest listed exposure in this book">
              <span style={{ width: 20, height: 12, borderRadius: 2, background: 'linear-gradient(135deg, color-mix(in srgb, var(--green) 30%, transparent), color-mix(in srgb, var(--green) 15%, transparent))', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15), 0 0 6px rgba(255,255,255,0.35)' }} />
              mega = book max
            </span>
            <span title="Empty cell — the chain never listed that strike × expiry. Not a zero.">empty = not listed</span>
            <span title="Values in $ millions ($B when marked). Under $1K of exposure is dust: no text, hover still answers.">$M · B when marked</span>
          </div>

          {view3d ? (
            <div className="three-wrap">
              {/* GammaSurface is already the honest 3D: LISTED mode for absent
                  cells, overflow ticks past the robust max. VEX maps the same
                  real matrix through netVEX. */}
              <GammaSurface
                className="h-full w-full"
                points={(metric === 'vex' ? matrix.map((c) => ({ ...c, netGEX: c.netVEX ?? 0 })) : matrix) as any}
                spot={spot}
                symbol={symbol}
                callWall={snap?.callWall}
                putWall={snap?.putWall}
                flipPrice={snap?.gammaFlipPrice ?? null}
              />
            </div>
          ) : (
            <div className="matrix-wrap">
              {shaped.hiddenAbove > 0 && !showAbove && (
                <div className="expand-row" onClick={() => setShowAbove(true)}>
                  <span>▲ {shaped.hiddenAbove} strikes above · click to expand</span>
                </div>
              )}
              {termLoading ? (
                <div style={{ display: 'grid', placeItems: 'center', height: 240, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>
                  reading the surface…
                </div>
              ) : termError && !shaped.strikes.length ? (
                <div style={{ display: 'grid', placeItems: 'center', height: 240, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-mute)', gap: 8, alignContent: 'center' }}>
                  <span>couldn't read the surface</span>
                  <button onClick={() => refetchTerm()} style={{ color: 'var(--cyan)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, textDecoration: 'underline', padding: 0 }}>retry</button>
                </div>
              ) : !shaped.strikes.length ? (
                <div style={{ display: 'grid', placeItems: 'center', height: 240, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--text-mute)' }}>
                  no listed cells for {symbol}
                </div>
              ) : (
                <table className="matrix">
                  <thead>
                    <tr>
                      <th className="sticky-col">STRIKE</th>
                      {shaped.expiries.map(([dte, label]) => <th key={dte}>{label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {shaped.strikes.map((strike) => {
                      const dist = strike - spot;
                      const pct = spot > 0 ? ((dist / spot) * 100).toFixed(1) : '0';
                      const isSpot = Math.abs(dist) < (spot * 0.0008 + 0.01);
                      const rowCls = isSpot ? 'spot' : dist > 0 ? 'above' : 'below';
                      return (
                        <tr key={strike} className="strike-row">
                          <td className={`sticky-col ${rowCls}`}>
                            ${strike}
                            {!isSpot && <span className="pct">{dist > 0 ? '+' : ''}{pct}%</span>}
                            {snap?.putWall === strike && <span className="star" title="put support">★</span>}
                            {snap?.callWall === strike && <span style={{ color: 'var(--cyan)', marginLeft: 3 }} title="call wall">⊙</span>}
                          </td>
                          {shaped.expiries.map(([dte]) => {
                            const cell = shaped.byKey.get(`${strike}|${dte}`);
                            const v = cell ? valOf(cell) : null;
                            return (
                              <td key={dte}>
                                {/* Absent = the chain never listed it — an empty cell,
                                    not a zero (the value/zero/missing rule). Dust
                                    (<$1K) shows no text but still answers on hover. */}
                                {v == null || v === 0
                                  ? <div className="cell" />
                                  : Math.abs(v) < DUST_M
                                    ? <div className="cell" title={`$${strike} · ${cell!.expiryLabel} · ${metric.toUpperCase()} ${fmtM(v)} (dust)`} />
                                    : <div className={`cell ${cellClass(v)}`} style={{ cursor: 'pointer' }} title={`$${strike} · ${cell!.expiryLabel} · ${metric.toUpperCase()} ${fmtM(v)} — click to drill in`} onClick={(e) => { e.stopPropagation(); setDrill(cell!); }}>{fmtM(v)}</div>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {shaped.hiddenBelow > 0 && !showBelow && (
                <div className="expand-row" onClick={() => setShowBelow(true)}>
                  <span>▼ {shaped.hiddenBelow} strikes below · click to expand</span>
                </div>
              )}
              {(showAbove || showBelow) && (
                <div className="expand-row" onClick={() => { setShowAbove(false); setShowBelow(false); }}>
                  <span>collapse to the spot window</span>
                </div>
              )}
            </div>
          )}
          </>}
        </div>

        {/* ══════════ RIGHT — CONTEXT ══════════ */}
        <div className="col col-right">
          <div className="sec-head">
            <div className="sec-num">Context</div>
            <div className="sec-title">What it means.</div>
            <div className="sec-sub">Key levels, gravity and model assumptions for {symbol}.</div>
          </div>

          <div className="context-card">
            <div className="context-head">
              <div className="context-label">Key levels</div>
              <div style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', fontFamily: "'JetBrains Mono',monospace" }}>{symbol} · {sessionLabel.toLowerCase()}</div>
            </div>
            <div className="context-grid">
              <div className="context-item">
                <div className="context-k" title="Largest positive-gamma strike above spot — the level dealers defend; resistance.">Call wall</div>
                <div className="context-v green">{snap?.callWall ? `$${snap.callWall}` : '—'}</div>
                <div className="context-sub">resistance</div>
              </div>
              <div className="context-item">
                <div className="context-k" title="Largest negative-gamma strike below spot — dealer support; the floor.">Put support</div>
                <div className="context-v red">{snap?.putWall ? `$${snap.putWall}` : '—'}</div>
                <div className="context-sub">floor</div>
              </div>
              <div className="context-item">
                <div className="context-k" title="Zero-gamma projection — the near-term price magnet implied by the gamma surface.">0γ projection</div>
                <div className="context-v cyan">{snap?.zeroGammaProjection != null ? `$${Math.round(snap.zeroGammaProjection)}` : '—'}</div>
                <div className="context-sub">near-term magnet</div>
              </div>
              <div className="context-item">
                <div className="context-k" title="Volatility regime — the current volatility environment for this name.">Vol regime</div>
                <div className="context-v amber">{snap?.volatilityRegime ? snap.volatilityRegime.charAt(0).toUpperCase() + snap.volatilityRegime.slice(1) : '—'}</div>
                <div className="context-sub">vol environment</div>
              </div>
              {snap?.callWall != null && snap?.putWall != null && (
                <div className="context-item full">
                  <div className="context-k" title="Put wall → call wall — the range dealers are positioned around. Inside: expect pin and drift. Outside: moves can accelerate.">Structural range</div>
                  <div className="context-v amber">${snap.putWall} put → ${snap.callWall} call</div>
                  <div className="context-sub">
                    {spot > snap.putWall && spot < snap.callWall ? 'inside the range' : spot >= snap.callWall ? 'above the call wall' : 'below put support'}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="gravity-card">
            <div className="context-head">
              <div className="context-label" title="Share of total listed exposure sitting on the call side vs the put side — which way the book leans.">Gravity · call vs put exposure</div>
            </div>
            {shaped.callPct == null ? (
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-mute)' }}>no listed exposure yet</div>
            ) : (
              <>
                <div
                  className="gravity-bar"
                  style={{ background: `linear-gradient(90deg, var(--red) 0%, var(--red) ${100 - shaped.callPct}%, var(--panel-hi) ${100 - shaped.callPct}%, var(--panel-hi) ${100 - shaped.callPct + 2}%, var(--green) ${100 - shaped.callPct + 2}%, var(--green) 100%)` }}
                >
                  {spot > 0 && snap?.putWall != null && snap?.callWall != null && snap.callWall > snap.putWall && (
                    <div
                      className="gravity-marker"
                      title={`spot $${spot.toFixed(2)} within the wall range`}
                      style={{ left: `${Math.max(2, Math.min(98, ((spot - snap.putWall) / (snap.callWall - snap.putWall)) * 100))}%` }}
                    />
                  )}
                </div>
                <div className="gravity-labels">
                  <div className="puts">↓ {(100 - shaped.callPct).toFixed(1)}% puts</div>
                  <div className="calls">{shaped.callPct.toFixed(1)}% calls ↑</div>
                </div>
                <div className="gravity-pct">
                  {negGamma
                    ? <span className="down">Negative gamma</span>
                    : <span className="up">Positive gamma</span>}
                  {' '}— {negGamma ? 'dealer hedging can amplify moves' : 'dealer hedging dampens moves'}
                </div>
                <div className="gravity-note">
                  {negGamma
                    ? <>Dealer hedging can <b>amplify whichever side confirms first</b>. Use the walls as structure, not as a ceiling and floor.</>
                    : <>Expect price to <b>drift and pin</b> between levels rather than trend hard. Dealers sell into rallies and buy into dips to stay delta-neutral.</>}
                </div>
              </>
            )}
          </div>

          <div className="insight-card">
            <div className="context-head">
              <div className="context-label" title="Largest listed gamma nodes above and below spot. Levels, not entries.">Strongest nodes · {metric.toUpperCase()}</div>
            </div>
            {shaped.above ? (
              <div className="insight-item bull">
                <div className="insight-k">Above spot</div>
                <div className="insight-v">${shaped.above.strike} · {shaped.above.expiryLabel} · {shaped.above.dte}d</div>
                <div className="insight-desc">Largest listed {metric.toUpperCase()} node above. <b>A level, not an entry.</b></div>
              </div>
            ) : (
              <div className="insight-item note"><div className="insight-desc">No listed node above spot.</div></div>
            )}
            {shaped.below ? (
              <div className="insight-item bear">
                <div className="insight-k">Below spot</div>
                <div className="insight-v">${shaped.below.strike} · {shaped.below.expiryLabel} · {shaped.below.dte}d</div>
                <div className="insight-desc">
                  Largest listed node below.{shaped.below.dte <= 1 ? <> <b>0–1DTE — pin risk elevated into the close.</b></> : null}
                </div>
              </div>
            ) : (
              <div className="insight-item note"><div className="insight-desc">No listed node below spot.</div></div>
            )}
            {(shaped.above?.dte ?? 99) <= 5 && (
              <div className="insight-item note">
                <div className="insight-k">Time is your friend</div>
                <div className="insight-v">Same strike, later expiry</div>
                <div className="insight-desc">The strongest node sits only {shaped.above!.dte}d out. Consider the same strike on a later expiry — you pay more premium, but the thesis gets room to play out.</div>
              </div>
            )}
          </div>

          <div className="model-note">
            <b>Model ·</b> Dealer sign is an assumption, not an observation — inventory is never reported. Magnitude at each strike is the reliable read. Nodes are levels, not entries. Confirm on the chart before trading.
          </div>

          <div className="disclaimer">
            Educational only · not investment advice.<br />
            Nodes are levels, not entries.
          </div>
        </div>
      </div>

      {/* ══════════ ⌘K SEARCH — real universal index ══════════ */}
      {drill && (() => {
        const strikeCells = matrix.filter((m) => m.strike === drill.strike);
        const expiryCells = matrix.filter((m) => m.dte === drill.dte);
        const val = (c: StrikeExpiryCell) => metric === 'vex' ? (c.netVEX ?? 0) : c.netGEX;
        const strikeTotal = strikeCells.reduce((a, c) => a + val(c), 0);
        const expiryTotal = expiryCells.reduce((a, c) => a + val(c), 0);
        const v = val(drill);
        const dist = spot ? ((drill.strike - spot) / spot) * 100 : null;
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 85, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center' }} onClick={() => setDrill(null)}>
            <div style={{ width: 320, background: 'linear-gradient(135deg, var(--panel-solid), var(--panel-2))', border: '1px solid var(--nx-border-hi)', borderRadius: 10, padding: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.7)' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 16 }}>{symbol} ${drill.strike}</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', color: 'var(--text-dim)' }}>{drill.expiryLabel} · {drill.dte}d</div>
              </div>
              {[
                ['net GEX', fmtM(drill.netGEX)],
                ['net VEX', fmtM(drill.netVEX ?? 0)],
                ['vs spot', dist != null ? `${dist >= 0 ? '+' : ''}${dist.toFixed(1)}%` : '—'],
                [`share of $${drill.strike} strike`, strikeTotal !== 0 ? `${((v / strikeTotal) * 100).toFixed(0)}% of ${fmtM(strikeTotal)}` : '—'],
                [`share of ${drill.expiryLabel} expiry`, expiryTotal !== 0 ? `${((v / expiryTotal) * 100).toFixed(0)}% of ${fmtM(expiryTotal)}` : '—'],
              ].map(([k, val2]) => (
                <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed color-mix(in srgb, var(--cyan) 8%, transparent)', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                  <span style={{ color: 'var(--text-mute)', textTransform: 'uppercase', fontSize: 'var(--fs-9, 9px)', letterSpacing: 0.5 }}>{k}</span>
                  <span style={{ fontWeight: 700 }}>{val2}</span>
                </div>
              ))}
              <div style={{ marginTop: 10, fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', fontFamily: "'JetBrains Mono',monospace", fontStyle: 'italic' }}>listed-chain node · esc or click away to close</div>
            </div>
          </div>
        );
      })()}
      {searchOpen && (
        <div className="search-modal" onClick={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}>
          <div className="search-box">
            <div className="search-input-wrap">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input
                ref={inputRef}
                className="search-input"
                placeholder="Search any ticker…"
                value={query}
                onChange={(e) => { setQuery(e.target.value.toUpperCase()); setCursor(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(shownResults.length - 1, c + 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
                  if (e.key === 'Enter') {
                    const sel = shownResults[cursor] ?? (query.trim() ? { symbol: query.trim() } : null);
                    if (sel) pick(sel.symbol);
                  }
                }}
              />
              <span className="search-kbd">ESC</span>
            </div>
            <div className="search-results">
              <div className="search-group">{query.trim() ? (searching ? 'searching…' : `${shownResults.length} matches`) : 'Ranked board'}</div>
              {shownResults.map((r, i) => {
                const qte = quoteBySym.get(r.symbol);
                return (
                  <div key={`${r.symbol}-${i}`} className={`search-item${i === cursor ? ' active' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => pick(r.symbol)}>
                    <div className="search-sym">{r.symbol}</div>
                    <div className="search-name">{r.name ?? `${r.symbol} · ${r.type ?? 'equity'}`}</div>
                    <div className="search-price">{qte ? `$${qte.lastPrice.toFixed(2)}` : ''}</div>
                    {qte
                      ? <div className={`search-chg ${qte.changePct >= 0 ? 'up' : 'down'}`}>{qte.changePct >= 0 ? '+' : ''}{qte.changePct.toFixed(1)}%</div>
                      : <div />}
                  </div>
                );
              })}
              {query.trim() && !searching && !shownResults.length && (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-mute)', fontSize: 12 }}>
                  No results for “{query}” — Enter opens it directly.
                </div>
              )}
            </div>
            <div className="search-footer">
              <span><kbd>↑↓</kbd> navigate</span>
              <span><kbd>↵</kbd> select</span>
              <span><kbd>esc</kbd> close</span>
              <span style={{ marginLeft: 'auto', color: 'var(--cyan)' }}>universal ticker index</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GexHubNexus;
