/**
 * TODAY — the prototype for the overhaul (2026-09-24).
 *
 * The operator: "too much and boring… not grade A". Twelve equal-weight tabs
 * and collapse chrome gave the platform no hero. This screen has exactly one
 * job per band, in reading order:
 *
 *   1. The week, in one sentence and one chart — the Skylit-style dealer map
 *      (measured GEX levels with gamma concentration + the model's projected
 *      path). The weekly-path model was built server-side and never shown
 *      anywhere; it is the platform's differentiator, so it leads.
 *   2. The single best idea right now, big.
 *   3. The rest of the book as clean ranked rows.
 *   4. The honest track record.
 *
 * Built from docs/DESIGN_SYSTEM.md: cinematic dark, Space Grotesk display,
 * Inter UI, JetBrains Mono numbers, luminous accents, motion only on real data.
 * Integrity: only MEASURED dealer levels are drawn; the path is labelled a
 * model projection with its confidence, never a forecast.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { Search } from 'lucide-react';
import { convictionDisplayPercent } from '@shared/conviction-display';
import { Spark, RotQuad, SigCard, CHECK, fetchJson, useDaily, type RotationPayload, type CryptoPulse } from '@/components/landing/live-widgets';
import '@/styles/nexus.css';
import '@/styles/today.css';

// ── data shapes (subset) ────────────────────────────────────────────────────
interface WPLevel { price: number; label: string; type: string; side: string }
interface WPPoint { dayOffset: number; price: number; lo?: number; hi?: number; confidence: number }
interface WPPhase { label: string; description: string; startDay: number; endDay: number; type: string }
interface WeeklyPath { cached?: boolean; cachedAt?: string; symbol: string; spotPrice: number; weekStart: string; weekEnd: string; levels: WPLevel[]; path: WPPoint[]; phases: WPPhase[]; regime: string; confidence: number; expectedMove?: number; annualVol?: number; volSource?: string; impliedVol?: number }
interface GexLevel { strike: number; gammaPct: number; role?: string }
interface GexTerminal { snapshot?: { spotPrice: number; callWall?: number; putWall?: number; maxGammaStrike?: number; gammaFlipPrice?: number; levels?: GexLevel[] } }
interface Layer { kind: string; why: string; points: number }
interface Pick {
  ideaId: string; symbol: string; direction: 'long' | 'short'; sector?: string; thesis?: string;
  entryPrice?: number; targetPrice?: number; stopLoss?: number; riskRewardRatio?: number; currentPrice?: number;
  convictionScore?: number | null; convictionBand?: string | null; layers?: Layer[]; optionType?: string; strikePrice?: number; expiryDate?: string;
  lifecycleState?: string; isBotHeld?: boolean;
}
interface Perf { overall?: { winRate?: number; winRateDecided?: number; expectancy?: number; profitFactor?: number; totalIdeas?: number } }
interface Quote { price?: number; lastPrice?: number; changePercent?: number }

const get = <T,>(url: string) => async (): Promise<T> => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
};
const fmt = (n?: number | null, d = 2) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

// ── the week, in one sentence ──────────────────────────────────────────────
function weekSentence(wp?: WeeklyPath, magnet?: number) {
  if (!wp) return { title: 'Reading the dealer map…', sub: '' };
  const short = wp.regime?.includes('negative');
  const title = short
    ? `Dealers are short gamma. Moves get amplified${magnet ? ` — ${fmt(magnet, 0)} is the magnet.` : '.'}`
    : `Dealers are long gamma. Moves get dampened${magnet ? ` — price pins toward ${fmt(magnet, 0)}.` : '.'}`;
  const sub = short
    ? 'When dealers are short gamma they sell into drops and buy into rips, so ranges widen. Fade the walls, respect the breaks.'
    : 'When dealers are long gamma they buy dips and sell rips, so ranges tighten around the biggest strike.';
  return { title, sub };
}

const PHONE = '(max-width: 640px)';
function useNarrow() {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(PHONE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
    () => window.matchMedia(PHONE).matches, () => false);
}

// ── Skylit-style weekly dealer map ─────────────────────────────────────────
function WeekMap({ wp, gex }: { wp: WeeklyPath; gex?: GexTerminal }) {
  const reduce = useReducedMotion();
  // On a phone the map is drawn in a narrower coordinate space so labels stay
  // at a readable size instead of shrinking with the viewBox.
  const narrow = useNarrow();
  const W = narrow ? 380 : 760, H = narrow ? 320 : 380, padL = 8, padR = narrow ? 92 : 118, padT = 18, padB = 46;
  const snap = gex?.snapshot;
  // Only measured dealer levels — the model's extrapolated ones stay off the map.
  const measured = [
    snap?.callWall && { price: snap.callWall, label: 'Call wall', tone: 'bull' },
    snap?.maxGammaStrike && { price: snap.maxGammaStrike, label: 'Max gamma', tone: 'magnet' },
    snap?.putWall && { price: snap.putWall, label: 'Put wall', tone: 'bear' },
  ].filter(Boolean) as { price: number; label: string; tone: string }[];
  const pctAt = (k: number) => snap?.levels?.find((l) => Math.abs(l.strike - k) < 0.01)?.gammaPct;
  // Scale to the week SPY can realistically travel (±2σ of the implied move),
  // not to walls 5% away — those get an edge marker instead of flattening the path.
  const sig = wp.expectedMove ?? wp.spotPrice * 0.02;
  const lo = wp.spotPrice - 2.2 * sig, hi = wp.spotPrice + 2.2 * sig;
  const y = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
  const clampY = (p: number) => Math.max(padT, Math.min(H - padB, y(p)));
  const x = (d: number) => padL + (d / 5) * (W - padL - padR);
  const line = wp.path.map((p, i) => `${i ? 'L' : 'M'}${x(p.dayOffset).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const upper = wp.path.map((p) => `${x(p.dayOffset).toFixed(1)},${y(p.hi ?? p.price).toFixed(1)}`);
  const lower = [...wp.path].reverse().map((p) => `${x(p.dayOffset).toFixed(1)},${y(p.lo ?? p.price).toFixed(1)}`);
  const end = wp.path[wp.path.length - 1];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`td-map${narrow ? ' narrow' : ''}`} role="img" aria-label={`${wp.symbol} weekly dealer map and projected path`}>
      <defs>
        <linearGradient id="td-path" x1="0" x2="1"><stop offset="0" stopColor="#7fb2ff" /><stop offset="1" stopColor="#3b8cff" /></linearGradient>
        <linearGradient id="td-cone" x1="0" x2="1"><stop offset="0" stopColor="#3b8cff" stopOpacity="0.02" /><stop offset="1" stopColor="#3b8cff" stopOpacity="0.16" /></linearGradient>
        <filter id="td-glow"><feGaussianBlur stdDeviation="3.2" /></filter>
      </defs>
      {/* day grid */}
      {days.map((d, i) => (
        <g key={d}>
          <line x1={x(i)} x2={x(i)} y1={padT} y2={H - padB} className="td-grid" />
          <text x={x(i + 0.5)} y={H - padB + 16} className="td-axis" textAnchor="middle">{d}</text>
        </g>
      ))}
      {/* phases */}
      {wp.phases.map((ph) => (
        <g key={ph.label}>
          <rect x={x(ph.startDay) + 2} y={H - 22} width={Math.max(0, x(ph.endDay) - x(ph.startDay) - 4)} height={16} rx={3} className={`td-phase ${ph.type}`} />
          <text x={x((ph.startDay + ph.endDay) / 2)} y={H - 11} className="td-phase-t" textAnchor="middle">{narrow ? ph.label.replace('PHASE ', 'P').split(' ')[0] : `${ph.label.replace('PHASE ', 'P')} — ${ph.description}`}</text>
        </g>
      ))}
      {/* measured dealer levels */}
      {measured.map((m) => {
        const pct = pctAt(m.price);
        const off = m.price > hi ? 'up' : m.price < lo ? 'dn' : null;
        return (
          <g key={m.label} className={`td-lvl ${m.tone}`}>
            {!off && m.tone === 'magnet' && <rect x={padL} y={y(m.price) - 7} width={W - padL - padR} height={14} className="td-magnet" />}
            {!off && <line x1={padL} x2={W - padR} y1={y(m.price)} y2={y(m.price)} />}
            <text x={W - padR + 10} y={clampY(m.price) + (off === 'up' ? 10 : off === 'dn' ? -14 : -3)} className="td-lvl-name">{off === 'up' ? '↑ ' : off === 'dn' ? '↓ ' : ''}{m.label}</text>
            <text x={W - padR + 10} y={clampY(m.price) + (off === 'up' ? 24 : off === 'dn' ? 0 : 11)} className="td-lvl-px">{fmt(m.price, 0)}{pct != null ? `${narrow ? ' ' : '  ·  '}${(pct * 100).toFixed(0)}% γ` : ''}</text>
          </g>
        );
      })}
      {/* ±1σ implied-move band + projected path */}
      <polygon points={[...upper, ...lower].join(' ')} fill="url(#td-cone)" />
      <path d={line} className="td-path-glow" filter="url(#td-glow)" />
      <motion.path d={line} className="td-path" stroke="url(#td-path)"
        initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: [0.2, 0.8, 0.2, 1] }} />
      {/* spot + end */}
      <circle cx={x(0)} cy={y(wp.spotPrice)} r={5} className="td-spot" />
      <text x={x(0) + 10} y={y(wp.spotPrice) - 10} className="td-spot-t">now {fmt(wp.spotPrice)}</text>
      {end?.hi != null && <text x={x(end.dayOffset) - 6} y={y(end.hi) - 6} className="td-band-t" textAnchor="end">+1σ {fmt(end.hi, 0)}</text>}
      {end?.lo != null && <text x={x(end.dayOffset) - 6} y={y(end.lo) + 14} className="td-band-t" textAnchor="end">−1σ {fmt(end.lo, 0)}</text>}
    </svg>
  );
}

// ── level ladder: where price sits between stop and target ────────────────
function Ladder({ p, live }: { p: Pick; live?: number }) {
  const s = p.stopLoss ?? 0, e = p.entryPrice ?? 0, t = p.targetPrice ?? 0;
  const lo = Math.min(s, t), hi = Math.max(s, t);
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100))}%`;
  const long = p.direction === 'long';
  return (
    <div className="td-ladder">
      <div className="td-ladder-track">
        <div className="td-ladder-risk" style={{ left: long ? at(s) : at(e), width: `calc(${at(long ? e : s)} - ${at(long ? s : e)})` }} />
        <div className="td-ladder-reward" style={{ left: long ? at(e) : at(t), width: `calc(${at(long ? t : e)} - ${at(long ? e : t)})` }} />
        {live != null && <div className="td-ladder-now" style={{ left: at(live) }} title={`now ${fmt(live)}`} />}
      </div>
      <div className="td-ladder-labels">
        {long ? <span className="bear">Stop <b>{fmt(s)}</b></span> : <span className="bull">Target <b>{fmt(t)}</b></span>}
        <span>Entry <b>{fmt(e)}</b></span>
        {long ? <span className="bull">Target <b>{fmt(t)}</b></span> : <span className="bear">Stop <b>{fmt(s)}</b></span>}
      </div>
    </div>
  );
}

/**
 * Evidence, in plain English. The layers carry precise measurements in
 * machine phrasing ("Aggressor tape: +$18.5M net bullish … calls bought
 * +$14.0M"); a person needs one sentence and a few reasons.
 */
function explain(p: Pick): { headline: string; reasons: string[]; against?: string } {
  const L = p.layers ?? [];
  const txt = (l?: Layer) => (l?.why ?? '').replace(/^[^\w$+-]+/u, '').trim();
  const all = L.map(txt);
  const PATTERN = /Higher-Lows Base|V-Recovery|Bull flag|Bear flag|Breakout|Breakdown|Pullback|Reclaim/i;
  const flow = all.find((w) => /net premium|Aggressor tape/i.test(w));
  const pattern = all.find((w) => PATTERN.test(w) && / off the /i.test(w)) ?? all.find((w) => PATTERN.test(w));
  let headline = '';
  const m = flow?.match(/([+-])\$([\d.]+)M net (?:premium )?(bullish|bearish)/i);
  if (m && flow) {
    const bull = m[3].toLowerCase() === 'bullish';
    const lead = flow.match(bull ? /calls (bought|sold) \+\$([\d.]+)M/i : /puts (bought|sold) \+\$([\d.]+)M/i);
    headline = `Options traders put $${m[2]}M ${bull ? 'behind' : 'against'} it yesterday` +
      (lead && Number(lead[2]) > 0 ? `, $${lead[2]}M of it in ${bull ? 'calls' : 'puts'} ${lead[1]}.` : '.');
  } else if (pattern) {
    const lvl = pattern.match(/\$([\d.,]+) bottom/)?.[1] ?? pattern.match(/bottomed \$([\d.,]+)/)?.[1];
    if (/Higher-Lows/i.test(pattern)) headline = `Building higher lows off the $${lvl} bottom.`;
    else if (/V-Recovery/i.test(pattern)) headline = `Sharp V-shaped recovery off the $${lvl} bottom.`;
    else headline = pattern.split(/[:;(]/)[0].trim() + '.';
  } else headline = (p.thesis ?? '').split('.')[0] + '.';

  const sectorLine = (w: string) => {
    const s = w.replace(/[🩸]/gu, '').trim().match(/^([A-Za-z &]+?) ([+-][\d.]+)% \(([+-][\d.]+)% vs SPY\)/);
    if (!s) return '';
    const down = s[2].startsWith('-');
    return `${s[1]} ${down ? 'down' : 'up'} ${s[2].slice(1)}% today`;
  };
  const reasons: string[] = [];
  for (const l of [...L].sort((a, b) => b.points - a.points)) {
    if (l.points <= 0 || reasons.length >= 3) continue;
    const w = txt(l);
    if (/net premium|Aggressor tape|context only|Regime ranging/i.test(w) || PATTERN.test(w)) continue;
    let r = '';
    const run = w.match(/clean runway to .+? at \$([\d.,]+) \(([\d.]+)R, (\d+)% reach odds\)/i);
    if (run) r = `Open road to $${run[1]} · ${run[3]}% reach odds`;
    else if (/^TA confirms/i.test(w)) r = 'Trend on the chart agrees';
    else if (/Coiled/i.test(w)) r = 'Coiled tight, pressing the ceiling';
    else if (/Dealers support/i.test(w)) r = 'Dealer hedging leans its way';
    else if (/benchmark complex/i.test(w)) r = 'Deep, liquid options market';
    else if (/Earnings beat/i.test(w)) r = 'Beat on earnings';
    else if (/Earnings miss/i.test(w)) r = 'Missed on earnings';
    else if (/vs SPY/i.test(w)) r = sectorLine(w) + (/confirms/i.test(w) ? ', confirming it' : '');
    else r = w.split(/[—(;]/)[0].trim();
    if (r && !reasons.includes(r)) reasons.push(r);
  }
  const neg = L.filter((l) => l.points < 0).sort((a, b) => a.points - b.points)[0];
  let against: string | undefined;
  if (neg) {
    const w = txt(neg);
    const cap = w.match(/at \$([\d.,]+) caps the move at ([\d.]+)R/i);
    if (cap) against = `Resistance at $${cap[1]} caps the move at ${cap[2]}× the risk.`;
    else if (/vs SPY/i.test(w)) against = `${sectorLine(w)}, money rotating out of the sector.`;
    else against = w.replace(/[🩸]/gu, '').split('—')[0].trim() + '.';
  }
  return { headline, reasons, against };
}
const sectorName = (s?: string) => (!s || s === 'other' ? '' : s.replace(/_/g, ' '));

export default function TodayPage() {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState('');
  const retryWhileDown = { refetchInterval: (qq: { state: { status: string } }) => (qq.state.status === 'error' ? 30_000 : false) };
  const wp = useQuery<WeeklyPath>({ queryKey: ['/api/weekly-path/SPY'], queryFn: get('/api/weekly-path/SPY'), staleTime: 300_000, ...retryWhileDown });
  const gex = useQuery<GexTerminal>({ queryKey: ['/api/gex-vex/terminal/SPY', 'today'], queryFn: get('/api/gex-vex/terminal/SPY'), staleTime: 300_000, ...retryWhileDown });
  const conv = useQuery<{ picks?: Pick[] }>({ queryKey: ['/api/convictions', 'today'], queryFn: get('/api/convictions'), staleTime: 60_000, refetchInterval: 90_000 });
  const perf = useQuery<Perf>({ queryKey: ['/api/performance/stats/', 'today'], queryFn: get('/api/performance/stats/'), staleTime: 600_000 });
  const rotation = useQuery<RotationPayload>({ queryKey: ['/api/sector-rotation', 'landing'], queryFn: fetchJson('/api/sector-rotation'), refetchInterval: 300_000, staleTime: 120_000, retry: 1 });
  const pulse = useQuery<CryptoPulse>({ queryKey: ['/api/crypto/pulse', 'landing'], queryFn: fetchJson('/api/crypto/pulse'), staleTime: 300_000, retry: 1 });
  const spyIntra = useDaily('SPY', '1d', '5m');
  const [tapePaused, setTapePaused] = useState(false);

  const ideas = useMemo(() => (conv.data?.picks ?? [])
    .filter((p) => typeof p.convictionScore === 'number' && !p.isBotHeld && p.lifecycleState !== 'executed')
    .sort((a, b) => (b.convictionScore ?? 0) - (a.convictionScore ?? 0)), [conv.data]);
  const syms = ideas.slice(0, 12).map((p) => p.symbol).concat('SPY').join(',');
  const quotes = useQuery<{ quotes: Record<string, Quote> }>({ queryKey: [`/api/quotes/batch/${syms}`], queryFn: get(`/api/quotes/batch/${syms}`), enabled: ideas.length > 0, refetchInterval: 60_000 });
  const px = (s: string) => { const qq = quotes.data?.quotes?.[s]; return qq?.price ?? qq?.lastPrice; };

  const snap = gex.data?.snapshot;
  const magnet = snap?.maxGammaStrike;
  const shortGamma = wp.data?.regime?.includes('negative');
  const sigma = wp.data?.expectedMove;
  const spy = quotes.data?.quotes?.SPY;
  const spyPx = spy?.price ?? spy?.lastPrice ?? wp.data?.spotPrice;
  const spyBars = spyIntra.data?.data ?? [];
  const pinClose = magnet != null && sigma != null && spyPx != null && Math.abs(magnet - spyPx) <= 0.75 * sigma;
  const best = ideas[0];
  const bestX = best ? explain(best) : undefined;
  const book = ideas.slice(2, 8); // 0 and 1 are the feature cards
  const longs = ideas.filter((p) => p.direction !== 'short').length;
  const o = perf.data?.overall;

  const sectors = rotation.data?.sectors ?? [];
  const flows = useMemo(() => {
    const sorted = [...sectors].filter((x) => Number.isFinite(x.relChange)).sort((a, b) => (b.relChange ?? 0) - (a.relChange ?? 0));
    const maxAbs = Math.max(0.1, ...sorted.map((x) => Math.abs(x.relChange ?? 0)));
    return { top: sorted.slice(0, 2), bottom: sorted.slice(-2).reverse(), maxAbs };
  }, [sectors]);
  const tape = useMemo(() => {
    const rows: { sym: string; price: string; chg: number }[] = [];
    sectors.forEach((x) => rows.push({ sym: x.etf, price: '', chg: x.change }));
    (pulse.data?.assets ?? []).forEach((x) => rows.push({ sym: x.symbol, price: `$${Math.round(x.price).toLocaleString()}`, chg: x.change24h ?? 0 }));
    return rows;
  }, [sectors, pulse.data]);
  const fresh = !rotation.data?.isStale;
  const closed = !fresh && /close/i.test(rotation.data?.sessionLabel ?? '');

  // Sections rest visible; the reveal only adds motion as they scroll in.
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } }), { threshold: 0.08 });
    document.querySelectorAll('.today-l .reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [conv.data, rotation.data]);

  const go = (e: React.FormEvent) => { e.preventDefault(); const s = q.trim().toUpperCase(); if (s) setLocation(`/r/${s}`); };
  const toBest = () => document.getElementById('sec-best')?.scrollIntoView({ behavior: 'smooth' });
  const weekOf = wp.data ? new Date(wp.data.weekStart + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const feedDown = wp.isError && !wp.data;

  return (
    <div className="landing nexus-vars today-l">
      {/* NAV — the landing bar, signed-in destinations */}
      <nav className="lnav">
        <div className="lnav-inner">
          <Link href="/today" className="brand" style={{ textDecoration: 'none' }}>
            <div className="brand-mark" />
            <span className="brand-name">QUANTEDGE</span>
            <span className="brand-slash">//</span>
            <span className="brand-sub">TODAY</span>
          </Link>
          <div className="lnav-links">
            <Link href="/today" className="lnav-link on">Today</Link>
            <Link href="/t?tab=gex" className="lnav-link">Markets</Link>
            <Link href="/t?tab=journal&jtab=metrics" className="lnav-link">Track record</Link>
          </div>
          <div className="lnav-spacer" />
          <form className="tl-search" onSubmit={go} role="search">
            <label htmlFor="tl-q" className="tl-search-ico"><Search size={14} aria-hidden /></label>
            <input id="tl-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Any ticker" aria-label="Search a ticker" autoCapitalize="characters" />
          </form>
          <div className={`lnav-status${fresh ? '' : closed ? ' closed' : ' stale'}`}><span className="dot" />{fresh ? 'Live' : closed ? 'Market closed' : 'Data stale'}</div>
          <Link href="/t" className="btn btn-primary">Terminal</Link>
        </div>
      </nav>

      {/* HERO — the week, and the dealer map in the terminal window */}
      <section className="hero">
        <div className="container">
          <div className="hero-grid">
            <div>
              <div className="hero-eyebrow"><span className="pill">LIVE</span>SPY dealer map{weekOf ? ` · week of ${weekOf}` : ''}</div>
              {feedDown ? (
                <h1 className="hero-title">The options feed<br /><span className="grad">is down right now.</span></h1>
              ) : (
                <h1 className="hero-title">
                  Dealers are {shortGamma ? 'short' : 'long'} gamma.<br />
                  <span className="grad">Moves get {shortGamma ? 'amplified' : 'dampened'}.</span><br />
                  {sigma != null
                    ? <span className="accent">{pinClose && !shortGamma ? `Price pins near ${fmt(magnet, 0)}.` : `Typical week: ±${fmt(sigma, 0)} pts.`}</span>
                    : null}
                </h1>
              )}
              <p className="hero-sub">
                {feedDown
                  ? 'We only draw the map from measured positioning. It comes back the moment the feed does — this page retries every 30 seconds.'
                  : `${shortGamma
                    ? 'Short-gamma dealers sell into drops and buy into rips, so ranges widen.'
                    : 'Long-gamma dealers buy dips and sell rips, so ranges tighten.'}${sigma != null ? ` ${wp.data?.volSource === 'realized-20d' ? 'Lately SPY has moved' : 'Expect'} about ±${fmt(sigma, 0)} points (${fmt(sigma / (spyPx ?? 1) * 100, 1)}%) in a typical week${wp.data?.volSource === 'realized-20d' ? `${wp.data.impliedVol ? ` — options price more, ±${fmt((spyPx ?? 0) * wp.data.impliedVol * Math.sqrt(5 / 252), 0)}` : ''}` : wp.data?.volSource === 'vix' ? ' (from VIX)' : ' (estimated)'}.` : ''}${magnet && sigma != null && !pinClose ? ` The biggest strike, ${fmt(magnet, 0)}, is ${fmt(Math.abs(magnet - (spyPx ?? magnet)), 0)} points away — further than dealers usually drag price in a week.` : ''}`}
              </p>
              <div className="hero-actions">
                <button type="button" className="btn btn-primary btn-lg" onClick={toBest}>
                  Today&rsquo;s best idea
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
                </button>
                <Link href="/t?tab=gex" className="btn btn-ghost btn-lg">Full GEX surface</Link>
              </div>
              <div className="tl-keys">
                {([['Magnet', magnet, 'max gamma', 'mag'], ['Ceiling', snap?.callWall, 'call wall', 'up'], ['Floor', snap?.putWall, 'put wall', 'dn']] as const).map(([k, v, sub, cls]) => (
                  <div key={k}><span>{k}</span><b className={cls}>{fmt(v as number | undefined, 0)}</b><small>{sub}</small></div>
                ))}
              </div>
            </div>

            <div className="lterminal">
              <div className="lterminal-head">
                <div className="lterminal-dots"><span /><span /><span /></div>
                <div className="lterminal-title">dealer map · spy · this week</div>
                <div className="lterminal-status"><span className="dot" />{wp.data?.cachedAt ? `${Math.max(1, Math.round((Date.now() - Date.parse(wp.data.cachedAt)) / 60000))}m old` : 'measured'}</div>
              </div>
              <div className="lterminal-body">
                <div className="t-panel" style={{ gridColumn: '1/-1' }}>
                  <div className="t-panel-head"><span>This week · implied range · walls</span><span>{sigma != null ? `1σ ±${fmt(sigma, 0)} pts · ${wp.data?.volSource === 'realized-20d' ? `realized ${((wp.data.annualVol ?? 0) * 100).toFixed(1)}%` : wp.data?.volSource === 'vix' ? `VIX ${((wp.data.annualVol ?? 0) * 100).toFixed(1)}` : 'est.'}` : ''}</span></div>
                  {wp.data && !gex.isLoading
                    ? <WeekMap wp={wp.data} gex={gex.data} />
                    : <div className="tl-map-empty">{feedDown ? 'Options feed down — retrying' : 'Reading dealer positioning…'}</div>}
                </div>
                <div className="t-panel">
                  <div className="t-panel-head"><span>Market pulse · SPY</span><span className="live">LIVE</span></div>
                  <div className="t-price">SPY {fmt(spyPx)}</div>
                  <div className={`t-change${(spy?.changePercent ?? 0) >= 0 ? ' up' : ''}`}>{spy?.changePercent != null ? `${spy.changePercent >= 0 ? '+' : ''}${spy.changePercent.toFixed(2)}% · ${rotation.data?.sessionLabel ?? 'session'}` : '—'}</div>
                  <div className="t-chart"><Spark bars={spyBars} color={(spy?.changePercent ?? 0) >= 0 ? '#6ee7b7' : '#ff6b3d'} height={54} /></div>
                </div>
                <div className="t-panel">
                  <div className="t-panel-head"><span>The book · {ideas.length} live</span><span className="live">LIVE</span></div>
                  {ideas.slice(0, 3).map((p) => (
                    <div className="t-signal" key={p.ideaId}>
                      <span className="ticker">{p.symbol}</span>
                      <span style={{ fontSize: 'var(--fs-10, 10px)', color: p.direction === 'short' ? 'var(--red)' : 'var(--green)' }}>{p.direction === 'short' ? '▼ short' : '▲ long'}</span>
                      <span className="dir">{convictionDisplayPercent(p.convictionScore ?? 0)}</span>
                    </div>
                  ))}
                  <div className="t-row"><span className="k">Long / Short</span><span className="v"><span style={{ color: 'var(--green)' }}>{longs}</span> / <span style={{ color: 'var(--red)' }}>{ideas.length - longs}</span></span></div>
                </div>
              </div>
            </div>
          </div>
          <div className="tl-map-foot">Shaded band: SPY’s 1σ weekly move from its last 20 sessions (about 2 weeks in 3 close inside it). The line leans toward the biggest strike only in long gamma, capped at a quarter of that move. Not a forecast.</div>
        </div>
      </section>

      {/* TAPE */}
      {tape.length > 0 && (
        <div className="ltape" onMouseEnter={() => setTapePaused(true)} onMouseLeave={() => setTapePaused(false)}>
          <div className={`ltape-track${tapePaused ? ' paused' : ''}`}>
            {[...tape, ...tape].map((t, i) => (
              <div className="ltape-item" key={i}>
                <span className="ltape-sym">{t.sym}</span>
                {t.price && <span className="ltape-price">{t.price}</span>}
                <span className={`ltape-chg ${t.chg >= 0 ? 'up' : 'down'}`}>{t.chg >= 0 ? '+' : ''}{t.chg.toFixed(2)}%</span>
                <span className="ltape-sep">·</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STATS — measured */}
      <section className="stats-bar-l">
        <div className="container">
          <div className="stats-grid">
            <div className="stat-item reveal">
              <div className="lstat-val">{conv.isLoading ? '—' : ideas.length}</div>
              <div className="lstat-label">Live ideas in the book</div>
              <div className="lstat-sub">{longs} long · {ideas.length - longs} short</div>
            </div>
            <div className="stat-item reveal">
              <div className="lstat-val">{best ? convictionDisplayPercent(best.convictionScore ?? 0) : '—'}<span style={{ fontSize: 20, color: 'var(--text-mute)' }}>/100</span></div>
              <div className="lstat-label">Top evidence score</div>
              <div className="lstat-sub">{best ? `${best.symbol} · ${best.direction}` : 'waiting for the board'}</div>
            </div>
            <div className="stat-item reveal">
              <div className="lstat-val">{o?.winRate != null ? `${o.winRate.toFixed(0)}%` : '—'}</div>
              <div className="lstat-label">Win rate, decided ideas</div>
              <div className="lstat-sub">{o?.winRateDecided != null ? `n = ${o.winRateDecided} hit target or stop` : 'measuring'}</div>
            </div>
            <div className="stat-item reveal">
              <div className="lstat-val">{o?.expectancy != null ? `${o.expectancy >= 0 ? '+' : ''}${o.expectancy.toFixed(2)}%` : '—'}</div>
              <div className="lstat-label">Average per idea</div>
              <div className="lstat-sub">{o?.profitFactor != null ? `profit factor ${o.profitFactor.toFixed(2)}` : 'measuring'}</div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURE · BEST IDEA */}
      <section id="sec-best">
        <div className="container">
          {best && bestX ? (
            <div className="feature">
              <div className="reveal">
                <div className="feature-num">BEST IDEA RIGHT NOW · {best.symbol} · {best.direction === 'short' ? 'SHORT' : 'LONG'}{best.optionType ? ` · ${best.optionType.toUpperCase()} ${best.strikePrice ?? ''}` : ''}</div>
                <h3 className="feature-title">{bestX.headline}</h3>
                {bestX.against && <p className="feature-desc"><b style={{ color: 'var(--red)' }}>Against it:</b> {bestX.against}</p>}
                <div className="feature-list">
                  {bestX.reasons.map((r) => <div className="feature-list-item" key={r}>{CHECK}<div><b>{r}</b></div></div>)}
                </div>
                <div className="tl-ladder"><Ladder p={best} live={px(best.symbol)} /></div>
                <div className="hero-actions" style={{ marginTop: 24 }}>
                  <Link href={`/r/${best.symbol}`} className="btn btn-primary btn-lg">Full analysis
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                  </Link>
                </div>
              </div>
              <div className="feature-visual reveal">
                <SigCard p={best as never} />
                {ideas[1] && <SigCard p={ideas[1] as never} />}
              </div>
            </div>
          ) : (
            <div className="tl-empty">{conv.isLoading ? 'Loading the book…' : 'The board is between publishes — ideas appear here the moment they exist.'}</div>
          )}
        </div>
      </section>

      {/* THE BOOK */}
      {book.length > 0 && (
        <section>
          <div className="container">
            <div className="reveal">
              <div className="sec-eyebrow">The book · ranked by evidence</div>
              <h2 className="lsec-title">Next up. <span className="grad">Every one explains itself.</span></h2>
            </div>
            <div className="tl-book">
              {book.map((p) => {
                const x = explain(p);
                return (
                  <div className="tl-book-item reveal" key={p.ideaId}>
                    <SigCard p={p as never} />
                    <p className="tl-book-why">{x.headline}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* FEATURE · ROTATION */}
      <section>
        <div className="container">
          <div className="feature reverse">
            <div className="reveal">
              <div className="feature-num">WHERE THE MONEY IS MOVING</div>
              <h3 className="feature-title">See rotation before it becomes consensus.</h3>
              <p className="feature-desc">Every dot is a real sector at its measured relative-strength × momentum coordinate. The bars are today&rsquo;s strongest measured inflows and outflows versus SPY.</p>
              <div className="feature-list">
                <div className="feature-list-item">{CHECK}<div><b>{sectors.length || '—'} sectors mapped</b> <span>— {rotation.data?.sessionLabel ?? 'live session'}</span></div></div>
                {flows.top[0] && <div className="feature-list-item">{CHECK}<div><b>Leading: {flows.top[0].name}</b> <span>— {(flows.top[0].relChange ?? 0) >= 0 ? '+' : ''}{(flows.top[0].relChange ?? 0).toFixed(1)}% vs SPY</span></div></div>}
                {flows.bottom[0] && <div className="feature-list-item">{CHECK}<div><b>Lagging: {flows.bottom[0].name}</b> <span>— {(flows.bottom[0].relChange ?? 0).toFixed(1)}% vs SPY</span></div></div>}
              </div>
            </div>
            <div className="feature-visual reveal">
              <div className="rot-map">
                <RotQuad sectors={sectors} />
                <div className="rot-label tl">Leading</div>
                <div className="rot-label tr">Improving</div>
                <div className="rot-label bl">Weakening</div>
                <div className="rot-label br">Lagging</div>
                <div className="rot-axis x">x · rel strength →</div>
                <div className="rot-axis y">y · momentum →</div>
              </div>
              <div className="flow-viz">
                {[...flows.top.map((x) => ({ x, cls: 'in' as const })), ...flows.bottom.map((x) => ({ x, cls: 'out' as const }))].map(({ x, cls }) => (
                  <div className="lflow-row" key={x.etf}>
                    <div className="lflow-sym" style={{ color: cls === 'in' ? 'var(--green)' : 'var(--red)' }}>{x.etf}</div>
                    <div className="lflow-bar"><div className={`lflow-fill ${cls}`} style={{ width: `${Math.min(95, Math.abs(x.relChange ?? 0) / flows.maxAbs * 95)}%` }} /></div>
                    <div className={`lflow-val ${cls}`}>{(x.relChange ?? 0) >= 0 ? '+' : ''}{(x.relChange ?? 0).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA — the honest record */}
      <section>
        <div className="container">
          <div className="cta-box reveal">
            <h2 className="cta-title">Every idea is graded.<br /><span className="grad">Including the losers.</span></h2>
            <p className="cta-sub">
              {o?.winRate != null && o.winRateDecided != null
                ? `${o.winRate.toFixed(0)}% of ${o.winRateDecided} decided ideas hit target before stop. Losers stay on the record, and every rate carries its sample size.`
                : 'The record is replayed on 5-minute bars, not marked to the close.'}
            </p>
            <div className="cta-actions">
              <Link href="/t?tab=journal&jtab=metrics" className="btn btn-primary btn-lg">See the track record</Link>
              <Link href="/t" className="btn btn-ghost btn-lg">Open the terminal</Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="lfooter">
        <div className="container">
          <div className="lfooter-bottom">
            <div>© 2026 QuantEdge Labs</div>
            <div className="disclaimer">Educational and analytical tool only. Not investment advice. Every performance figure carries its sample size.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
