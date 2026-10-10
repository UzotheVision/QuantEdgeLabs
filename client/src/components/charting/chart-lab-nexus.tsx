/**
 * CHART LAB — the second reference mock, wired.
 *
 * The mock's DOM and canvas engine are used as authored: the same drawChart —
 * grid, price/time axes, MA20/50, volume bars, candles/line toggle, published
 * levels, live price tag, crosshair with OHLCV tooltip — with refs instead of
 * ids. What is replaced is the only thing that had to be:
 *
 *   generateCandles()        →  /api/historical-prices/:symbol (real OHLCV)
 *   fake pivot R3…S2 levels  →  the PUBLISHED signal's STOP/ENTRY/T1 from
 *                               /api/convictions — the mock's own copy says
 *                               "published QuantEdge levels", and its badge
 *                               already anticipates "no published signal"
 *   the 2s candle jitter     →  does not run; the series refetches on a real
 *                               poll and the "next poll" readouts count to it
 *   fake watchlist + sparks  →  /api/watchlist + real 5d closes
 *
 * The mock's 4h button does not ship: the price feed has no 4h interval, and a
 * missing timeframe is honest where a resampled-looking fake is not. Every
 * other TF maps to a measured range/interval pair (bar counts probed live:
 * 1m=780 · 5m=379 · 15m=127 · 1h=86 · 1D=64 · 1W=55).
 *
 * Chrome (topbar/tape/bottombar) belongs to the terminal shell — this renders
 * the mock's main area only, exactly like NexusBoard.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStockContext } from '@/contexts/stock-context';
import { useColResize } from '@/lib/use-col-resize';
import {
  drawChart, useCandles, TF_CONFIG, CANDLES_POLL_MS,
  type Candle, type Level, type Zone, type CandleSeries, type EHQuote, type EHPayload,
} from '@/components/charting/chart-engine';
import { NexusPriceChart } from '@/components/charting/nexus-price-chart';
// Re-exported so existing engine imports keep working.
export { drawChart, useCandles, TF_CONFIG } from '@/components/charting/chart-engine';
export type { Candle, Level, Zone, CandleSeries } from '@/components/charting/chart-engine';
import { usePriceHistory } from '@/components/hunt/cockpit/use-price-history';
import type { ConvictionPick, ConvictionsResponse } from '@/lib/convictions';
import '@/styles/nexus.css';

/* ────────────────────────────────────────────────────────────────
   Watch spark — the mock's drawSpark shape on real 5d closes.
   ──────────────────────────────────────────────────────────────── */
function WatchSpark({ symbol, up }: { symbol: string; up: boolean }) {
  const { points } = usePriceHistory(symbol, '5d', '1d');
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || points.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = devicePixelRatio;
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const pts = points.map((p) => p.close);
    const min = Math.min(...pts); const max = Math.max(...pts);
    const range = max - min || 1;
    const color = up ? '#6ee7b7' : '#ff6b3d';
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(1, color + '00');
    ctx.beginPath();
    pts.forEach((pt, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - ((pt - min) / range) * h * 0.8 - h * 0.1;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    pts.forEach((pt, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - ((pt - min) / range) * h * 0.8 - h * 0.1;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
    ctx.stroke();
  }, [points, up]);
  return <canvas ref={ref} className="watch-spark" />;
}

/* ────────────────────────────────────────────────────────────────
   BOARD
   ──────────────────────────────────────────────────────────────── */

const q = (path: string) => async () => {
  const r = await fetch(path, { credentials: 'include' });
  if (!r.ok) throw new Error(`${path} failed`);
  return r.json();
};

const DEFAULT_INSTRUMENTS = ['SPY', 'QQQ', 'IWM', 'SMH', 'XBI'];

export function ChartLabBoard() {
  const { currentStock, setCurrentStock } = useStockContext();
  const symbol = currentStock?.symbol?.toUpperCase() || 'SPY';

  const [tf, setTf] = useState<keyof typeof TF_CONFIG>('1h');
  const [type, setType] = useState<'candles' | 'line'>('candles');
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [showLevels, setShowLevels] = useState(true);
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  // Sidebar rail: drag its border left to widen, double-click to expand.
  const rail = useColResize('nx-chart-side', 300, { sign: -1, min: 240, max: 620 });

  const { data: series, isLoading, isError, dataUpdatedAt } = useCandles(symbol, tf);
  const candles = series?.bars;

  const { data: convictions } = useQuery<ConvictionsResponse>({
    queryKey: ['/api/convictions', 'chart-lab'],
    queryFn: q('/api/convictions?limit=100&minScore=0'),
    staleTime: 60_000,
    retry: 1,
  });
  const pick = useMemo(
    () => convictions?.picks?.find((c: ConvictionPick) => c.symbol.toUpperCase() === symbol),
    [convictions, symbol],
  );
  // The real published levels — the mock's fake pivot ladder does not ship.
  const levels: Level[] = useMemo(() => (pick ? [
    { price: pick.targetPrice, color: '#6ee7b7', label: 'T1' },
    { price: pick.entryPrice, color: '#3b8cff', label: 'ENTRY' },
    { price: pick.stopLoss, color: '#ff6b3d', label: 'STOP' },
  ].filter((l) => Number.isFinite(l.price)) : []), [pick]);

  const { data: extended } = useQuery<EHPayload>({
    queryKey: ['/api/extended-hours', 'oracle-tape'],
    queryFn: q('/api/extended-hours'),
    staleTime: 60_000, refetchInterval: 120_000, retry: 1,
  });
  const { data: realtime } = useQuery<{ prices?: { crypto?: Record<string, { price: number }> } }>({
    queryKey: ['/api/realtime-status', 'nexus'],
    queryFn: q('/api/realtime-status'),
    refetchInterval: 5_000, staleTime: 4_000, retry: 1,
  });
  const { data: watchlist } = useQuery<{ symbol: string }[]>({
    queryKey: ['/api/watchlist'], refetchInterval: 120_000, retry: 1,
  });
  const { data: pulse } = useQuery<{ macro?: { vix?: number } }>({
    queryKey: ['market-pulse'],
    queryFn: q('/api/market-pulse'),
    staleTime: 60_000, refetchInterval: 120_000, retry: 1,
  });
  const { data: botStatus } = useQuery<{ bots: { name: string; status: string }[] }>({
    queryKey: ['/api/automations/status'], refetchInterval: 60_000, retry: 1,
  });

  const quoteBySym = useMemo(() => {
    const m = new Map<string, EHQuote>();
    for (const list of [extended?.mostActive, extended?.gainers, extended?.losers]) {
      for (const t of list ?? []) if (!m.has(t.symbol) && Number.isFinite(t.changePct)) m.set(t.symbol, t);
    }
    return m;
  }, [extended]);

  /* clock / uptime / next-poll — all real */
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
  const nextPoll = dataUpdatedAt ? Math.max(0, Math.ceil((dataUpdatedAt + CANDLES_POLL_MS - now) / 1000)) : null;

  const [ohlc, setOhlc] = useState<Candle | null>(null);

  const instruments = useMemo(() => {
    const set = new Set<string>([symbol, ...DEFAULT_INSTRUMENTS, ...(watchlist ?? []).map((w) => w.symbol)]);
    return [...set];
  }, [watchlist, symbol]);

  const spyQ = quoteBySym.get('SPY');
  const btc = realtime?.prices?.crypto?.BTC;
  const vix = pulse?.macro?.vix;
  const runningBots = botStatus?.bots?.filter((b) => b.status === 'running').length;
  const bullish = pick && pick.direction !== 'short';
  const isUp = ohlc ? ohlc.close >= ohlc.open : true;

  /* Sidebar level bars: width = the level's real position inside the span the
     published levels cover. The mock's widths were hardcoded ranks. */
  const levelRows = useMemo(() => {
    if (!levels.length) return [];
    const prices = levels.map((l) => l.price);
    const lo = Math.min(...prices); const hi = Math.max(...prices);
    const span = hi - lo || 1;
    return [...levels].sort((a, b) => b.price - a.price).map((l) => ({
      ...l,
      widthPct: 20 + ((l.price - lo) / span) * 75,
      kind: l.label === 'STOP' ? 'resist' : 'support',
    }));
  }, [levels]);

  const watchSyms = (watchlist ?? []).slice(0, 10);

  return (
    <div className="chartlab">
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
        {/* ══════════ CHART AREA ══════════ */}
        <div className="chart-area">
          <div className="chart-header">
            <div className="chart-eyebrow">Price intelligence</div>
            <div className="chart-title-row">
              <div className="chart-title">Chart Lab · {symbol}</div>
              <div className={`chart-badge${pick ? ' has-signal' : ''}`}>
                <span className="dot" />
                {pick
                  ? `${pick.convictionBand} · ${pick.convictionScore > 0 ? '+' : ''}${pick.convictionScore} evidence`
                  : 'no published signal'}
              </div>
            </div>
            <div className="chart-desc">One chart, every timeframe, with published QuantEdge levels anchored to the same ticker used across Oracle, Flow and GEX.</div>
          </div>

          <div className="instrument-bar">
            <div className="instrument-label">Instrument</div>
            <div className="instrument-selector" onClick={() => setInstrumentOpen((o) => !o)}>
              <span className="instrument-sym">{symbol}</span>
              <svg className="instrument-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: instrumentOpen ? 'rotate(180deg)' : undefined }}><path d="M6 9l6 6 6-6" /></svg>
              {instrumentOpen && (
                <div className="instrument-menu" onClick={(e) => e.stopPropagation()}>
                  {instruments.map((sym) => (
                    <button key={sym} onClick={() => { setCurrentStock({ symbol: sym }); setInstrumentOpen(false); }}>
                      <span>{sym}</span>
                      {quoteBySym.get(sym) && (
                        <span style={{ color: quoteBySym.get(sym)!.changePct >= 0 ? 'var(--green)' : 'var(--red)', fontSize: 'var(--fs-10, 10px)' }}>
                          {quoteBySym.get(sym)!.changePct >= 0 ? '+' : ''}{quoteBySym.get(sym)!.changePct.toFixed(1)}%
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {extended?.session && extended.session !== 'regular' && (
              <div className="ext-hours">{extended.session === 'closed' ? 'last close' : 'ext hours'}</div>
            )}

            <div className="ohlc">
              <div className="ohlc-item"><span className="ohlc-label">O</span><span className="ohlc-val">{ohlc ? ohlc.open.toFixed(2) : '—'}</span></div>
              <div className="ohlc-item"><span className="ohlc-label">H</span><span className="ohlc-val up">{ohlc ? ohlc.high.toFixed(2) : '—'}</span></div>
              <div className="ohlc-item"><span className="ohlc-label">L</span><span className="ohlc-val down">{ohlc ? ohlc.low.toFixed(2) : '—'}</span></div>
              <div className="ohlc-item"><span className="ohlc-label">C</span><span className={`ohlc-val ${isUp ? 'up' : 'down'}`}>{ohlc ? ohlc.close.toFixed(2) : '—'}</span></div>
            </div>
          </div>

          {/* The shared engine — pan/zoom, TF bar, candles/line, crosshair,
              expand-to-modal. One chart everywhere. */}
          <NexusPriceChart
            key={symbol}
            symbol={symbol}
            initialTf="1h"
            fill
            levels={levels}
            onHoverCandle={setOhlc}
          />
        </div>

        {/* ══════════ RIGHT SIDEBAR ══════════ */}
        <div className="sidebar">
          <div className="sec-head">
            <div className="sec-num">Chart Lab</div>
            <div className="sec-title">Price intelligence.</div>
            <div className="sec-sub">One chart, every timeframe. QuantEdge levels anchored across Oracle, Flow and GEX.</div>
            <div className="sec-meta">
              <span className="tag cyan">CHART</span>
              <span className="tag live"><span className="dot" />engaged</span>
            </div>
          </div>

          <div className="summary">
            <div className="summary-grid">
              <div className="summary-card">
                <div className="summary-label">Last close · SPY</div>
                {spyQ ? (
                  <>
                    <div className={`summary-val ${spyQ.changePct >= 0 ? 'up' : 'down'}`}>{spyQ.lastPrice.toFixed(2)}</div>
                    <div className="summary-sub" style={{ color: spyQ.changePct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {spyQ.changePct >= 0 ? '+' : ''}{spyQ.changePct.toFixed(2)}%
                    </div>
                  </>
                ) : (
                  <div className="summary-val" style={{ color: 'var(--text-mute)' }}>—</div>
                )}
              </div>
              <div className="summary-card">
                <div className="summary-label">BTC · live</div>
                {btc ? (
                  <>
                    <div className="summary-val">${Math.round(btc.price).toLocaleString()}</div>
                    <div className="summary-sub">realtime stream</div>
                  </>
                ) : (
                  <div className="summary-val" style={{ color: 'var(--text-mute)' }}>—</div>
                )}
              </div>
              <div className="summary-card">
                <div className="summary-label">Next poll</div>
                <div className="summary-val">{nextPoll != null ? `${nextPoll}s` : '—'}</div>
                <div className="summary-sub">candle refetch</div>
              </div>
              <div className="summary-card">
                <div className="summary-label">Local time</div>
                <div className="summary-val">{clock}</div>
                <div className="summary-sub">wall clock</div>
              </div>
            </div>
          </div>

          <div className="levels-section">
            <div className="levels-head">
              <div className="levels-title">QuantEdge Levels</div>
              <div style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', fontFamily: "'JetBrains Mono',monospace" }}>{symbol}</div>
            </div>
            {levelRows.length ? levelRows.map((l) => (
              <div className="level-row" key={l.label}>
                <div className="level-name" style={l.label === 'ENTRY' ? { color: 'var(--cyan-bright)' } : undefined}>{l.label}</div>
                <div className="level-bar"><div className={`level-bar-fill ${l.kind}`} style={{ width: `${l.widthPct}%` }} /></div>
                <div className="level-val" style={{ color: l.color }}>{l.price.toFixed(2)}</div>
              </div>
            )) : (
              <div style={{ fontSize: 11, color: 'var(--text-mute)', fontFamily: "'JetBrains Mono',monospace", padding: '4px 0' }}>
                {/* Absence, stated — the mock's pivot ladder was invented numbers. */}
                no published signal for {symbol} — levels appear when the book carries one
              </div>
            )}
            {pick && (
              <div style={{ marginTop: 8, fontSize: 'var(--fs-10, 10px)', color: 'var(--text-dim)', fontFamily: "'JetBrains Mono',monospace" }}>
                {bullish ? '▲ LONG' : '▼ SHORT'} · R:R {pick.riskRewardRatio ? `${pick.riskRewardRatio.toFixed(1)}:1` : '—'}
              </div>
            )}
          </div>

          <div className="watch-section">
            <div className="watch-head">
              <div className="watch-title">Watchlist</div>
              <div className="watch-count">{watchSyms.length ? `${watchSyms.length} names` : ''}</div>
            </div>
            <div>
              {watchSyms.map(({ symbol: sym }) => {
                const wq = quoteBySym.get(sym);
                const up = wq != null && wq.changePct >= 0;
                return (
                  <div
                    className={`watch-item${sym === symbol ? ' active' : ''}`}
                    key={sym}
                    onClick={() => setCurrentStock({ symbol: sym })}
                  >
                    <div className="watch-sym">{sym}</div>
                    <div className="watch-name" />
                    <WatchSpark symbol={sym} up={wq ? up : true} />
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

          <div className="sys-status">
            <div className="sys-row"><span className="k">Uptime</span><span className="v">{uptime}</span></div>
            <div className="sys-row"><span className="k">Bots</span><span className="v">{runningBots ?? '—'}</span></div>
            <div className="sys-row"><span className="k">Watchlist</span><span className="v">{watchlist?.length ?? '—'}</span></div>
            <div className="sys-row"><span className="k">VIX</span><span className={`v${vix != null && vix >= 20 ? ' warn' : ''}`}>{vix != null ? vix.toFixed(1) : '—'}</span></div>
          </div>

          <div className="disclaimer">
            Educational only · not investment advice.<br />
            Past performance does not guarantee future results.
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChartLabBoard;
