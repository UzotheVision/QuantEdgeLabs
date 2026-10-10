/**
 * CRYPTO — the sixth reference mock, wired.
 *
 *   spot cards      /api/crypto/pulse — the engine's own price, 24h/7d/30d,
 *                   RSI-14, realized vol, and 60 real daily closes for the
 *                   mini chart (the mock's RSI 88 · extended WAS this value)
 *   ETH/BTC         computed from the two live prices; 7d change from the
 *                   two close series — real arithmetic, not a card prop
 *   correlations    computed HERE from real series: Pearson r of daily
 *                   returns, proxy (1mo/1d equity closes) vs its underlying
 *                   (the pulse's crypto closes), aligned by calendar date.
 *                   Fewer than 12 overlapping sessions → dash, never a guess
 *   proxy board     instrument-type descriptions are editorial; the status
 *                   line is the MEASURED correlation once computed. Click →
 *                   the ticker workup (CHART tab, shared symbol)
 *   fear & greed    NO FEED EXISTS → the meter renders NOT MEASURED. The
 *                   mock's random-walk F&G does not ship
 *   feeds row       /api/realtime-status — the sockets' own connected flags
 *
 * The mock's price jitter and looping countdown do not ship.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { openWorkup as openWorkupModal } from '@/lib/workup-bus';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useStockContext } from '@/contexts/stock-context';
import { useColResize } from '@/lib/use-col-resize';
import { usePriceHistory } from '@/components/hunt/cockpit/use-price-history';
import { Heartbeat } from '@/components/viz';
import '@/styles/nexus.css';

interface CryptoAsset {
  symbol: string; name: string; price: number;
  change24h: number | null; change7d: number | null; change30d: number | null;
  rsi14d: number | null; realizedVol30d: number | null;
  closes?: { timestamp: number; close: number }[];
}
interface PulsePayload { asOf?: string; assets?: CryptoAsset[] }
interface RealtimePayload {
  coinbase?: { connected?: boolean };
  futures?: { connected?: boolean };
}
interface SentimentPayload {
  asOf?: string;
  fearGreed?: { value: number; label: string; asOf: string } | null;
  btcDominance?: number | null;
}
interface ProxyCandidate {
  underlying: string; underlying7d: number | null; underlyingGatePassed: boolean;
  symbol: string; route: string; proxyNet: number | null; tapeGatePassed: boolean;
  entry: number | null; invalidation: number | null; invalidationBasis: string | null;
  eligible: boolean; reason: string;
}
interface ProxyCandidatePayload { asOf?: string; eligible?: number; rows?: ProxyCandidate[]; methodology?: string }

const BTC_PROXIES = [
  { sym: 'IBIT', type: 'spot ETF', desc: 'Direct BTC wrapper — tightest correlation, lowest idiosyncratic risk.' },
  { sym: 'MSTR', type: 'treasury', desc: 'BTC balance-sheet exposure — leveraged to BTC moves, equity volatility overlay.' },
  { sym: 'COIN', type: 'exchange', desc: 'Crypto activity + equities — revenue tied to volume, not just price.' },
  { sym: 'MARA', type: 'miner', desc: 'Operating leverage to BTC — fixed cost base amplifies BTC moves.' },
  { sym: 'RIOT', type: 'miner', desc: 'Operating leverage to BTC — similar to MARA, different cost structure.' },
];
const ETH_PROXIES = [
  { sym: 'ETHA', type: 'spot ETF', desc: 'Direct ETH wrapper — cleanest transmission, check liquidity before sizing.' },
  { sym: 'ETHE', type: 'trust', desc: 'ETH wrapper — check liquidity and premium/discount vs NAV.' },
  { sym: 'COIN', type: 'exchange', desc: 'ETH activity + equities — shared with BTC routes, dual exposure.' },
  { sym: 'HOOD', type: 'broker', desc: 'Crypto participation proxy — retail flow indicator, lower correlation.' },
];

/** Pearson r of daily returns, aligned by calendar date. Null below 12 overlaps. */
function correlate(
  a: { time: number; close: number }[] | undefined,
  b: { timestamp: number; close: number }[] | undefined,
): { r: number; n: number } | null {
  if (!a?.length || !b?.length) return null;
  const day = (t: number) => new Date(t < 2e10 ? t * 1000 : t).toISOString().slice(0, 10);
  const mapA = new Map(a.map((p) => [day(p.time), p.close]));
  const mapB = new Map(b.map((p) => [day(p.timestamp), p.close]));
  const days = [...mapA.keys()].filter((d) => mapB.has(d)).sort();
  if (days.length < 13) return null;
  const ra: number[] = []; const rb: number[] = [];
  for (let i = 1; i < days.length; i++) {
    ra.push(Math.log(mapA.get(days[i])! / mapA.get(days[i - 1])!));
    rb.push(Math.log(mapB.get(days[i])! / mapB.get(days[i - 1])!));
  }
  const n = ra.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n;
  const mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  if (da === 0 || db === 0) return null;
  return { r: num / Math.sqrt(da * db), n };
}

/** The mock's mini-chart draw — fed the pulse's real closes. */
function MiniChart({ closes, color }: { closes?: { timestamp: number; close: number }[]; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !closes || closes.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = devicePixelRatio;
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const data = closes.map((c) => c.close);
    const min = Math.min(...data); const max = Math.max(...data);
    const range = max - min || 1;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(1, color + '00');
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
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.stroke(); ctx.shadowBlur = 0;
    const lastY = h - ((data[data.length - 1] - min) / range) * h * 0.85 - h * 0.05;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(w - 1, lastY, 3, 0, Math.PI * 2); ctx.fill();
  }, [closes, color]);
  if (!closes || closes.length < 2) {
    return <div className="mini-chart" style={{ display: 'grid', placeItems: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)' }}>NO SERIES</div>;
  }
  return <div className="mini-chart"><canvas ref={ref} /></div>;
}

function pct(v: number | null | undefined, dp = 1): string {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`;
}

/** One proxy's correlation row/status — its own component so the price-history
 *  hook can run per symbol. */
function useProxyCorr(sym: string, underlying?: CryptoAsset) {
  const { points } = usePriceHistory(sym, '1mo', '1d');
  return useMemo(() => correlate(points, underlying?.closes?.slice(-35)), [points, underlying]);
}

function ProxyCard({ p, underlying, accent, onOpen }: {
  p: { sym: string; type: string; desc: string };
  underlying?: CryptoAsset;
  accent: string;
  onOpen: (sym: string) => void;
}) {
  const corr = useProxyCorr(p.sym, underlying);
  return (
    <div className="proxy-card" data-proxy={p.sym} style={{ ['--proxy-color' as string]: accent }} onClick={() => onOpen(p.sym)}>
      <div className="proxy-top">
        <div className="proxy-sym">{p.sym}</div>
        <div className="proxy-type">{p.type}</div>
        <div className="proxy-arrow">→</div>
      </div>
      <div className="proxy-desc">{p.desc}</div>
      {corr ? (
        <div className="proxy-status measured" title={`Pearson r of daily log returns vs ${underlying?.symbol}, ${corr.n} overlapping sessions`}>
          corr {corr.r.toFixed(2)} vs {underlying?.symbol} · {corr.n} sessions
        </div>
      ) : (
        <div className="proxy-status"><span className="dot" />relationship not yet measurable</div>
      )}
    </div>
  );
}

function CorrRow({ sym, underlying }: { sym: string; underlying?: CryptoAsset }) {
  const corr = useProxyCorr(sym, underlying);
  const r = corr?.r ?? null;
  const cls = r == null ? 'low' : r >= 0.8 ? 'high' : r >= 0.55 ? 'med' : 'low';
  return (
    <div className="corr-item">
      <div className="corr-sym">{sym}</div>
      <div className="corr-bar"><div className={`corr-fill ${cls}`} style={{ width: r == null ? '0%' : `${Math.max(4, Math.abs(r) * 100)}%` }} /></div>
      <div className="corr-val">{r == null ? '—' : r.toFixed(2)}</div>
    </div>
  );
}

export function CryptoNexus() {
  const [, setLocation] = useLocation();
  const { setCurrentStock } = useStockContext();
  const rail = useColResize('nx-crypto-side', 320, { sign: -1, min: 240, max: 520 });

  const { data: pulse } = useQuery<PulsePayload>({
    queryKey: ['/api/crypto/pulse', 'nexus'],
    queryFn: async () => {
      const r = await fetch('/api/crypto/pulse', { credentials: 'include' });
      if (!r.ok) throw new Error('crypto pulse failed');
      return r.json();
    },
    staleTime: 60_000, refetchInterval: 120_000, retry: 1,
  });
  const { data: realtime } = useQuery<RealtimePayload>({
    queryKey: ['/api/realtime-status', 'nexus'],
    queryFn: async () => {
      const r = await fetch('/api/realtime-status', { credentials: 'include' });
      if (!r.ok) throw new Error('realtime failed');
      return r.json();
    },
    refetchInterval: 30_000, staleTime: 20_000, retry: 1,
  });
  // Fear & Greed (alternative.me) + BTC dominance (CoinGecko) — the two feeds
  // this tab previously disclosed as missing. Server-cached 30 min.
  const { data: sentiment } = useQuery<SentimentPayload>({
    queryKey: ['/api/crypto/sentiment', 'nexus'],
    queryFn: async () => {
      const r = await fetch('/api/crypto/sentiment', { credentials: 'include' });
      if (!r.ok) throw new Error('sentiment failed');
      return r.json();
    },
    staleTime: 15 * 60_000, refetchInterval: 30 * 60_000, retry: 1,
  });
  const { data: proxyTrace, isError: proxyTraceError } = useQuery<ProxyCandidatePayload>({
    queryKey: ['/api/crypto/proxy-candidates', 'nexus'],
    queryFn: async () => {
      const r = await fetch('/api/crypto/proxy-candidates', { credentials: 'include' });
      if (!r.ok) throw new Error('proxy candidate trace failed');
      return r.json();
    },
    staleTime: 5 * 60_000, refetchInterval: 5 * 60_000, retry: 1,
  });

  const btc = pulse?.assets?.find((a) => a.symbol === 'BTC');
  const eth = pulse?.assets?.find((a) => a.symbol === 'ETH');

  /* ETH/BTC — real arithmetic on the two live series */
  const ethBtc = btc && eth && btc.price > 0 ? eth.price / btc.price : null;
  const ethBtc7d = useMemo(() => {
    if (!btc?.closes?.length || !eth?.closes?.length) return null;
    const b = btc.closes; const e = eth.closes;
    const idx = Math.max(0, b.length - 8);
    const then = e[Math.max(0, e.length - 8)].close / b[idx].close;
    const now = e[e.length - 1].close / b[b.length - 1].close;
    return then > 0 ? ((now - then) / then) * 100 : null;
  }, [btc, eth]);

  const feedsLive = (realtime?.coinbase?.connected ? 1 : 0) + (realtime?.futures?.connected ? 1 : 0);

  const openWorkup = (sym: string) => {
    setCurrentStock({ symbol: sym });
    openWorkupModal(sym); // the universal dossier, over this tab
  };

  const SpotCard = ({ a, kind }: { a?: CryptoAsset; kind: 'btc' | 'eth' }) => {
    const accent = kind === 'btc' ? '#f7931a' : '#8b7ee0';
    const rsi = a?.rsi14d ?? null;
    const rsiExt = rsi != null && (rsi >= 70 || rsi <= 30);
    const vol = a?.realizedVol30d ?? null;
    return (
      <div className={`crypto-spot-card ${kind}`}>
        <div className="crypto-spot-head">
          <div className={`spot-icon ${kind}`}>{kind === 'btc' ? '₿' : 'Ξ'}</div>
          <div>
            <div className="spot-name">{a ? `${a.symbol} · ${a.name}` : kind.toUpperCase()}</div>
            <div className="spot-sub">{kind === 'btc' ? 'Largest crypto · store of value' : 'Smart contracts · DeFi layer'}</div>
          </div>
        </div>
        <div className="crypto-spot-price">{a ? `$${Math.round(a.price).toLocaleString()}` : '—'}</div>
        <MiniChart closes={a?.closes} color={accent} />
        <div className="spot-perf">
          {([['24h', a?.change24h], ['7d', a?.change7d], ['30d', a?.change30d]] as const).map(([label, v]) => (
            <div className="perf-item" key={label}>
              <div className="perf-label">{label}</div>
              <div className={`perf-val ${v != null && v < 0 ? 'down' : 'up'}`} style={v == null ? { color: 'var(--text-mute)' } : undefined}>{pct(v)}</div>
            </div>
          ))}
        </div>
        <div className="spot-stats">
          <div className="stat-item">
            <div className="stat-k">RSI · 14d</div>
            {rsi == null ? <div className="stat-v" style={{ color: 'var(--text-mute)' }}>—</div> : (
              <>
                <div className="stat-v">{Math.round(rsi)} <span className={`rsi-pill ${rsiExt ? 'ext' : 'ok'}`}>{rsiExt ? 'extended' : 'in range'}</span></div>
                <div className="rsi-bar"><div className={`rsi-fill ${rsiExt ? 'ext' : 'ok'}`} style={{ width: `${Math.min(100, rsi)}%` }} /></div>
              </>
            )}
          </div>
          <div className="stat-item">
            <div className="stat-k">Realized vol · 30d</div>
            {vol == null ? <div className="stat-v" style={{ color: 'var(--text-mute)' }}>—</div> : (
              <>
                <div className="stat-v">{Math.round(vol)}%</div>
                <div className="rsi-bar"><div className={`rsi-fill ${vol >= 60 ? 'ext' : 'ok'}`} style={{ width: `${Math.min(100, vol)}%` }} /></div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="cryptolab">
      <div className={`main${rail.dragging ? ' nx-dragging' : ''}`} style={{ ['--nx-side' as string]: `${rail.width}px` }}>
        <div className={`nx-resize${rail.dragging ? ' active' : ''}`} style={{ right: rail.width - 4, marginLeft: 0 }} title="Drag to resize · double-click to expand" {...rail.handleProps} />

        {/* ══════════ CRYPTO AREA ══════════ */}
        <div className="col crypto-area">
          <div className="crypto-header">
            <div className="crypto-eyebrow">Crypto intelligence</div>
            <div className="crypto-title-row">
              <div className="crypto-title">Trade the tape, then choose the proxy.</div>
            </div>
            <div className="crypto-desc">
              <b>BTC</b> and <span className="eth">ETH</span> establish the market context. Equity proxies are a separate trade with their own chart, option chain, liquidity, and risk.
            </div>
            <div className="crypto-meta">
              <span className="tag btc" style={{ display: 'inline-flex', gap: 6 }}>
                spot read <Heartbeat since={pulse?.asOf ?? null} staleAfterSec={600} />
              </span>
              <span className={`tag ${feedsLive === 2 ? 'live' : 'mute'}`}><span className="dot" />{feedsLive}/2 feeds live</span>
              <span className="tag mute">{BTC_PROXIES.length + ETH_PROXIES.length} proxies</span>
            </div>
          </div>

          <div className="spot-section">
            <div className="spot-label">Spot read</div>
            <div className="spot-grid">
              <SpotCard a={btc} kind="btc" />
              <SpotCard a={eth} kind="eth" />
            </div>
          </div>

          <section className="border-y border-border/45 px-4 py-4 md:px-6" aria-label="Crypto proxy promotion gate">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--brand-cyan)]">Nexus promotion gate</div>
                <h2 className="mt-1 text-sm font-semibold text-foreground">Which proxies can become trade ideas now</h2>
                <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">The coin move only opens the search. A proxy needs its own bullish options tape and a measured chart invalidation before the publisher may send it to Nexus.</p>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground"><b className="text-foreground">{proxyTrace?.eligible ?? 0}</b> eligible · <Heartbeat since={proxyTrace?.asOf ?? null} staleAfterSec={600} /></div>
            </div>
            {proxyTraceError ? (
              <div className="mt-3 rounded border border-[var(--trade-bearish)]/30 bg-[var(--trade-bearish)]/5 px-3 py-2 font-mono text-[10px] text-[var(--trade-bearish)]">Proxy evidence feed failed. No eligibility is implied.</div>
            ) : (
              <div className="mt-3 grid gap-2 xl:grid-cols-2">
                {(proxyTrace?.rows ?? []).map((row) => (
                  <button key={`${row.underlying}-${row.symbol}`} type="button" onClick={() => openWorkup(row.symbol)} className="grid cursor-pointer grid-cols-[58px_64px_1fr_auto] items-center gap-2 rounded border border-border/45 bg-background/20 px-3 py-2 text-left transition-colors hover:border-[var(--brand-cyan)]/50 hover:bg-foreground/[0.025]">
                    <span className="font-mono text-[11px] font-bold text-foreground">{row.symbol}</span>
                    <span className="font-mono text-[9px] text-muted-foreground">{row.underlying} {row.underlying7d == null ? '—' : `${row.underlying7d >= 0 ? '+' : ''}${(row.underlying7d * 100).toFixed(1)}%`}</span>
                    <span className="min-w-0 truncate text-[10px] text-muted-foreground" title={row.reason}>{row.reason}</span>
                    <span className="rounded border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider" style={{ color: row.eligible ? 'var(--green)' : row.tapeGatePassed ? 'var(--amber)' : 'var(--text-mute)', borderColor: row.eligible ? 'color-mix(in srgb,var(--green) 35%,transparent)' : 'var(--nx-border)' }}>{row.eligible ? 'QUALIFIED' : row.tapeGatePassed ? 'NEEDS LEVEL' : 'WATCH'}</span>
                  </button>
                ))}
                {!proxyTrace?.rows?.length && <div className="font-mono text-[10px] text-muted-foreground">Reading the crypto transmission gates…</div>}
              </div>
            )}
          </section>

          <div className="proxy-section">
            <div className="proxy-head">
              <div className="proxy-label">Proxy board</div>
              <div className="proxy-sub">Equities to investigate after the crypto read · open = full ticker workup</div>
            </div>

            <div className="proxy-group">
              <div className="proxy-group-head">
                <div className="proxy-group-sym btc">BTC routes</div>
                {btc?.change24h != null && (
                  <div className={`proxy-group-chg ${btc.change24h >= 0 ? 'up' : 'down'}`}>underlying {pct(btc.change24h)}</div>
                )}
                <div className="proxy-group-label">{BTC_PROXIES.length} proxies</div>
              </div>
              <div className="proxy-grid">
                {BTC_PROXIES.map((p) => <ProxyCard key={`b-${p.sym}`} p={p} underlying={btc} accent="#f7931a" onOpen={openWorkup} />)}
              </div>
            </div>

            <div className="proxy-group">
              <div className="proxy-group-head">
                <div className="proxy-group-sym eth">ETH routes</div>
                {eth?.change24h != null && (
                  <div className={`proxy-group-chg ${eth.change24h >= 0 ? 'up' : 'down'}`}>underlying {pct(eth.change24h)}</div>
                )}
                <div className="proxy-group-label">{ETH_PROXIES.length} proxies</div>
              </div>
              <div className="proxy-grid">
                {ETH_PROXIES.map((p) => <ProxyCard key={`e-${p.sym}`} p={p} underlying={eth} accent="#8b7ee0" onOpen={openWorkup} />)}
              </div>
            </div>
          </div>

          <div className="how-section">
            <div className="how-label">How to use this</div>
            <div className="how-steps">
              <div className="how-step">
                <div className="how-num">01</div>
                <div className="how-title">Read the underlying</div>
                <div className="how-desc">BTC/ETH trend, 24h range, RSI, and realized volatility describe <b>crypto</b> — not a stock option trade.</div>
              </div>
              <div className="how-step">
                <div className="how-num">02</div>
                <div className="how-title">Select the transmission</div>
                <div className="how-desc">A proxy may be <b>direct (ETF)</b>, balance-sheet driven, or operating leverage. It can diverge materially.</div>
              </div>
              <div className="how-step">
                <div className="how-num">03</div>
                <div className="how-title">Validate the option</div>
                <div className="how-desc">Open the ticker workup. <b>Entry, structural targets, premiums, OI, spread, and expiry</b> must be measured there.</div>
              </div>
            </div>
            <div className="how-warning">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
              <div><b>No shortcut:</b> no proxy is graded as a trade solely because BTC or ETH moved. Each must pass its own evidence bar in Oracle.</div>
            </div>
          </div>
        </div>

        {/* ══════════ RIGHT SIDEBAR ══════════ */}
        <div className="col col-right">
          <div className="sec-head">
            <div className="sec-num" style={{ color: 'var(--btc-bright)', textShadow: '0 0 8px rgba(247,147,26,0.4)' }}>Crypto intelligence</div>
            <div className="sec-title" style={{ background: 'linear-gradient(135deg,#fff,var(--btc-bright))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Underlying first.</div>
            <div className="sec-sub">Read the tape of BTC and ETH before choosing an equity proxy. Context before transmission.</div>
            <div className="sec-meta">
              <span className="tag btc">CRYPTO</span>
              <span className="tag live"><span className="dot" />engaged</span>
            </div>
          </div>

          <div className="summary">
            <div className="summary-grid">
              <div className="summary-card btc">
                <div className="summary-label">BTC · spot</div>
                <div className="summary-val btc">{btc ? `$${Math.round(btc.price).toLocaleString()}` : '—'}</div>
                <div className="summary-sub" style={{ color: (btc?.change24h ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{pct(btc?.change24h)} · 24h</div>
              </div>
              <div className="summary-card eth">
                <div className="summary-label">ETH · spot</div>
                <div className="summary-val eth">{eth ? `$${Math.round(eth.price).toLocaleString()}` : '—'}</div>
                <div className="summary-sub" style={{ color: (eth?.change24h ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>{pct(eth?.change24h)} · 24h</div>
              </div>
              <div className="summary-card eth">
                <div className="summary-label">ETH / BTC</div>
                <div className="summary-val">{ethBtc != null ? ethBtc.toFixed(4) : '—'}</div>
                <div className="summary-sub" style={ethBtc7d != null ? { color: ethBtc7d >= 0 ? 'var(--green)' : 'var(--red)' } : undefined}>{ethBtc7d != null ? `${pct(ethBtc7d)} · 7d` : 'ratio of live spots'}</div>
              </div>
              <div className="summary-card btc">
                <div className="summary-label">Feeds</div>
                <div className="summary-val" style={{ color: feedsLive === 2 ? 'var(--green)' : 'var(--amber)' }}>{feedsLive}/2</div>
                <div className="summary-sub">coinbase · futures</div>
              </div>
            </div>
          </div>

          <div className="correlation">
            <div className="correlation-head">
              <div className="correlation-label">Proxy correlation · ~30d</div>
              <div style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', fontFamily: "'JetBrains Mono',monospace" }}>daily log returns</div>
            </div>
            <div className="correlation-list">
              {['IBIT', 'MSTR', 'MARA', 'COIN', 'RIOT'].map((s) => <CorrRow key={s} sym={s} underlying={btc} />)}
              {['HOOD'].map((s) => <CorrRow key={s} sym={s} underlying={eth} />)}
            </div>
          </div>

          <div className="fear-greed" style={{ padding: '14px 16px', borderBottom: '1px solid var(--nx-border)' }}>
            <div className="correlation-head">
              <div className="correlation-label">Crypto Fear &amp; Greed</div>
              {sentiment?.fearGreed && (
                <div style={{ fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)', fontFamily: "'JetBrains Mono',monospace" }}>alternative.me</div>
              )}
            </div>
            {sentiment?.fearGreed ? (() => {
              const fg = sentiment.fearGreed!;
              const color = fg.value >= 75 ? 'var(--red)' : fg.value >= 55 ? 'var(--amber)' : fg.value >= 45 ? 'var(--text-dim)' : fg.value >= 25 ? 'var(--btc-bright)' : 'var(--green)';
              return (
                <div style={{ padding: '10px 0 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, color }}>{fg.value}</span>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color }}>{fg.label}</span>
                  </div>
                  <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'linear-gradient(90deg, var(--green), var(--amber) 50%, var(--red))', opacity: 0.9 }}>
                    <div style={{ position: 'absolute', top: -3, left: `calc(${Math.min(100, Math.max(0, fg.value))}% - 2px)`, width: 4, height: 12, borderRadius: 2, background: '#fff', boxShadow: '0 0 6px rgba(255,255,255,0.6)' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-9, 9px)', color: 'var(--text-mute)' }}>
                    <span>fear</span><span>greed</span>
                  </div>
                </div>
              );
            })() : (
              <div style={{ padding: '14px 0 6px', textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontStyle: 'italic', color: 'var(--text-mute)' }}>
                NOT MEASURED — sentiment feed unreachable
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, padding: '7px 10px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--nx-border)', borderRadius: 4, fontSize: 'var(--fs-10, 10px)' }}>
              <span style={{ color: 'var(--text-dim)' }}>BTC dominance</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: sentiment?.btcDominance != null ? 'var(--btc-bright)' : 'var(--text-mute)' }}>
                {sentiment?.btcDominance != null ? `${sentiment.btcDominance.toFixed(1)}%` : '—'}
              </span>
            </div>
          </div>

          <div className="disclaimer">
            Educational only · not investment advice.<br />
            Crypto proxies are equities — validate each separately.
          </div>
        </div>
      </div>
    </div>
  );
}

export default CryptoNexus;
