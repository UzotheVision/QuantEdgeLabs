/**
 * LANDING — the tenth reference mock, wired to the live platform.
 *
 * A marketing page that shows the actual product instead of a fabricated
 * one. Everything in the hero terminal, tape, stats, signal cards and
 * rotation map is the same live data the terminal itself renders:
 *
 *   hero pulse    SPY's real intraday series — INTERACTIVE (hover crosshair
 *                 + value tip), not the mock's Math.random ramp
 *   signal cards  the board's top two live picks with their REAL levels;
 *                 the mock's hardcoded TSLA bear card is gone — the short
 *                 gate killed that class of signal and the landing page
 *                 does not advertise trades the platform will not take
 *   rotation map  every sector at its real rsRatio × rsMomentum coordinate
 *   flow rows     the strongest real in/outflows from the same feed
 *   stats         real counts (no "42ms latency" theater)
 *   FAQ           honest answers: delayed options data is disclosed, the
 *                 bot is a paper measurement ledger, no broker custody
 *
 * The mock's price jitter, fake stats and lorem-tier claims do not ship.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { convictionDisplayPercent } from '@shared/conviction-display';
import {
  Spark, RotQuad, SigCard, CHECK, fetchJson, useDaily,
  type RotationPayload, type ConvictionsPayload, type CryptoPulse,
} from '@/components/landing/live-widgets';
import '@/styles/nexus.css';

export default function LandingNexus() {
  const { data: rotation, isLoading: rotationLoading } = useQuery<RotationPayload>({ queryKey: ['/api/sector-rotation', 'landing'], queryFn: fetchJson('/api/sector-rotation'), refetchInterval: 300_000, staleTime: 120_000, retry: 1 });
  const { data: conv, isLoading: convLoading } = useQuery<ConvictionsPayload>({ queryKey: ['/api/convictions', 'landing'], queryFn: fetchJson('/api/convictions?limit=40&minScore=10'), refetchInterval: 300_000, staleTime: 120_000, retry: 1 });
  const { data: pulse } = useQuery<CryptoPulse>({ queryKey: ['/api/crypto/pulse', 'landing'], queryFn: fetchJson('/api/crypto/pulse'), staleTime: 300_000, retry: 1 });
  const { data: patterns, isLoading: patternsLoading } = useQuery<{ hits?: unknown[]; scanned?: number; scanning?: boolean }>({ queryKey: ['/api/patterns/scan', 'landing'], queryFn: fetchJson('/api/patterns/scan'), staleTime: 600_000, retry: 1 });
  const { data: ideasMeta, isLoading: ideasLoading } = useQuery<{ total?: number; last24h?: number }>({ queryKey: ['/api/trade-ideas/debug/raw', 'landing'], queryFn: fetchJson('/api/trade-ideas/debug/raw'), staleTime: 600_000, retry: 1 });
  const spyIntra = useDaily('SPY', '1d', '5m');
  const spyDaily = useDaily('SPY', '5d', '1d');
  const [tapePaused, setTapePaused] = useState(false);

  const spyBars = spyIntra.data?.data ?? [];
  const spyLast = spyBars[spyBars.length - 1]?.close ?? null;
  const spyPrev = (spyDaily.data?.data ?? []).slice(-2)[0]?.close ?? null;
  const spyChg = spyLast && spyPrev ? ((spyLast - spyPrev) / spyPrev) * 100 : null;

  const picks = conv?.picks ?? [];
  const top2 = [...picks].sort((a, b) => (b.convictionScore ?? 0) - (a.convictionScore ?? 0)).slice(0, 2);
  const longs = picks.filter((p) => (p.direction ?? 'long') !== 'short').length;
  const shorts = picks.length - longs;
  // Raw confluence points are NOT percentages — the shared display transform
  // maps them onto the 0-100 confidence index every product surface uses.
  // "17/100" was raw points wearing a percent sign; that class of units lie
  // is exactly what this platform exists to kill.
  const topScore = convictionDisplayPercent(top2[0]?.convictionScore ?? 0);
  const avgScore = picks.length ? Math.round(picks.reduce((a, p) => a + convictionDisplayPercent(p.convictionScore ?? 0), 0) / picks.length) : 0;

  const sectors = rotation?.sectors ?? [];
  const flows = useMemo(() => {
    const sorted = [...sectors].filter((s) => Number.isFinite(s.relChange)).sort((a, b) => (b.relChange ?? 0) - (a.relChange ?? 0));
    const maxAbs = Math.max(0.1, ...sorted.map((s) => Math.abs(s.relChange ?? 0)));
    return { top: sorted.slice(0, 2), bottom: sorted.slice(-2).reverse(), maxAbs };
  }, [sectors]);

  const tape = useMemo(() => {
    const rows: { sym: string; price: string; chg: number }[] = [];
    sectors.forEach((s) => rows.push({ sym: s.etf, price: '', chg: s.change }));
    (pulse?.assets ?? []).forEach((a) => rows.push({ sym: a.symbol, price: `$${Math.round(a.price).toLocaleString()}`, chg: a.change24h ?? 0 }));
    return rows;
  }, [sectors, pulse]);

  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
    }, { threshold: 0.1 });
    document.querySelectorAll('.landing .reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const fresh = !rotation?.isStale;
  // Overnight / weekends the map correctly shows the last close — that is the
  // market being shut, not the data failing. Say which one it is.
  const closed = !fresh && /close/i.test(rotation?.sessionLabel ?? '');

  const MODULES: { name: string; desc: string; tag: string; color: string }[] = [
    { name: 'Oracle', desc: 'Evidence-ranked signals with a full audit trail. Every layer that argues for or against a setup, visible at a glance.', tag: 'Core · Live', color: '#3b8cff' },
    { name: 'Chart', desc: 'Interactive multi-frame price action — pan, zoom, expand — with published levels drawn on the real bars.', tag: 'Price · Interactive', color: '#60a5fa' },
    { name: 'Flow', desc: 'Unusual options prints — whales, sweeps, blocks — with premium sums and honest freshness on every row.', tag: 'Options · 15m cycles', color: '#6ee7b7' },
    { name: 'GEX', desc: 'Gamma exposure by strike and expiry — dealer walls and the flip level where hedging pressure reverses. Know where the market is magnetized.', tag: 'Options · Live', color: '#f472b6' },
    { name: 'Leaps', desc: 'Long-dated calls graded on trend, value and momentum — with budget and grade filters over real premiums.', tag: 'Options · Daily', color: '#a78bfa' },
    { name: 'Crypto', desc: 'BTC/ETH spot reads with measured proxy correlations — the equity route chosen from evidence, not vibes.', tag: '24/7 · Live', color: '#fbbf24' },
    { name: 'Catalyst', desc: 'Earnings, macro releases and impact-graded news joined to live signals. Binary events are risk, never tilt.', tag: 'Events · Live', color: '#fb7185' },
    { name: 'Bot', desc: 'The real automation layer — jobs, gates and a paper ledger that measures every published signal.', tag: 'Measurement', color: '#3b8cff' },
  ];

  return (
    <div className="landing nexus-vars">
      {/* NAV */}
      <nav className="lnav">
        <div className="lnav-inner">
          <div className="brand">
            <div className="brand-mark" />
            <span className="brand-name">QUANTEDGE</span>
            <span className="brand-slash">//</span>
            <span className="brand-sub">TERMINAL</span>
          </div>
          <div className="lnav-links">
            {['Modules', 'Workflow', 'Pricing', 'FAQ'].map((l) => (
              <div key={l} className="lnav-link" onClick={() => document.getElementById(`sec-${l.toLowerCase()}`)?.scrollIntoView({ behavior: 'smooth' })}>{l}</div>
            ))}
          </div>
          <div className="lnav-spacer" />
          <div className={`lnav-status${fresh ? '' : closed ? ' closed' : ' stale'}`}><span className="dot" />{fresh ? 'Live' : closed ? 'Market closed' : 'Data stale'}</div>
          <Link href="/login" className="btn btn-ghost">Sign in</Link>
          <Link href="/t" className="btn btn-primary">Get access</Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="container">
          <div className="hero-grid">
            <div>
              <div className="hero-eyebrow"><span className="pill">LIVE</span>Evidence-ranked trading intelligence</div>
              <h1 className="hero-title">
                Read the tape.<br />
                <span className="grad">Rank the setup.</span><br />
                <span className="accent">Execute the edge.</span>
              </h1>
              <p className="hero-sub">
                QUANTEDGE is a multi-module terminal that fuses market intelligence, rotation mapping and evidence-ranked signals into one connected view — so you trade what's leading, not what's lagging.
              </p>
              <div className="hero-actions">
                <Link href="/t" className="btn btn-primary btn-lg">
                  Open the terminal
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                </Link>
                <Link href="/t?tab=chart" className="btn btn-ghost btn-lg">See a live chart</Link>
              </div>
              <div className="hero-meta">
                <div className="hero-meta-item">{CHECK}Every number is measured</div>
                <div className="hero-meta-item">{CHECK}Unmeasured says so</div>
                <div className="hero-meta-item">{CHECK}Signals carry their evidence</div>
              </div>
            </div>

            {/* Hero terminal — everything real */}
            <div className="lterminal">
              <div className="lterminal-head">
                <div className="lterminal-dots"><span /><span /><span /></div>
                <div className="lterminal-title">oracle · ranked book · live</div>
                <div className="lterminal-status"><span className="dot" />engaged</div>
              </div>
              <div className="lterminal-body">
                <div className="t-panel">
                  <div className="t-panel-head"><span>Market Pulse · SPY</span><span className="live">LIVE</span></div>
                  <div className="t-price">{spyLast != null ? `SPY ${spyLast.toFixed(2)}` : 'SPY —'}</div>
                  <div className={`t-change${(spyChg ?? 0) >= 0 ? ' up' : ''}`}>{spyChg != null ? `${spyChg >= 0 ? '+' : ''}${spyChg.toFixed(2)}% · ${rotation?.sessionLabel ?? 'session'}` : '—'}</div>
                  <div className="t-chart"><Spark bars={spyBars} color={(spyChg ?? 0) >= 0 ? '#6ee7b7' : '#ff6b3d'} height={60} /></div>
                </div>
                <div className="t-panel">
                  <div className="t-panel-head"><span>Rotation Map</span><span>{rotation?.sessionLabel ?? ''}</span></div>
                  <div className="t-quadrant"><RotQuad sectors={sectors} height={120} /></div>
                </div>
                <div className="t-panel" style={{ gridColumn: '1/-1' }}>
                  <div className="t-panel-head"><span>Active Signals · {picks.length} in play</span><span className="live">LIVE</span></div>
                  {top2.map((p) => {
                    const dir = (p.direction ?? 'long').toLowerCase();
                    const pnl = p.currentPrice != null && p.entryPrice ? ((p.currentPrice - p.entryPrice) / p.entryPrice) * (dir === 'short' ? -100 : 100) : null;
                    return (
                      <div className="t-signal" key={p.symbol}>
                        <span className="ticker">{p.symbol}</span>
                        <span className="band">{(p.publishedConvictionBand ?? p.convictionBand ?? 'C').charAt(0)}</span>
                        <span style={{ fontSize: 'var(--fs-10, 10px)', color: 'var(--text-dim)' }}>{dir === 'short' ? '▼ BEAR' : '▲ BULL'} · {p.tradeType ?? 'swing'}</span>
                        <span className={`dir${(pnl ?? 0) < 0 ? ' down' : ''}`}>{pnl != null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%` : '—'}</span>
                      </div>
                    );
                  })}
                  <div className="t-row"><span className="k">Avg evidence</span><span className="v">{avgScore}/100</span></div>
                  <div className="t-row"><span className="k">Top evidence</span><span className="v up">{topScore}/100</span></div>
                  <div className="t-row"><span className="k">Long / Short</span><span className="v"><span style={{ color: 'var(--green)' }}>{longs}</span> / <span style={{ color: 'var(--red)' }}>{shorts}</span></span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TAPE — real sector + crypto reads; pauses on hover like a tape should */}
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

      {/* STATS — real */}
      <section className="stats-bar-l">
        <div className="container">
          <div className="stats-grid">
            <div className="stat-item reveal">
              <div className="lstat-val">{ideasLoading ? '—' : (ideasMeta?.total ?? 0).toLocaleString()}</div>
              <div className="lstat-label">Signals generated & outcome-tracked</div>
              <div className="lstat-sub">{ideasLoading ? 'loading…' : `${ideasMeta?.last24h ?? 0} in the last 24h${conv ? ` · ${picks.length} in play now` : ''}`}</div>
            </div>
            <div className="stat-item reveal">
              <div className="lstat-val">{rotationLoading ? '—' : sectors.length}</div>
              <div className="lstat-label">Sectors mapped in rotation</div>
              <div className="lstat-sub">{rotationLoading ? 'loading…' : (rotation?.sessionLabel ?? 'live session')}</div>
            </div>
            <div className="stat-item reveal">
              <div className="lstat-val">{patternsLoading || (!patterns?.scanned && patterns?.scanning) ? '—' : (patterns?.hits?.length ?? 0)}</div>
              <div className="lstat-label">Chart patterns detected today</div>
              <div className="lstat-sub">{patternsLoading ? 'loading…' : patterns?.scanned ? `${patterns.scanned} names swept on real bars` : 'sweep in progress'}</div>
            </div>
            <div className="stat-item reveal">
              <div className="lstat-val">{convLoading ? '—' : (<>{topScore}<span style={{ fontSize: 20, color: 'var(--text-mute)' }}>/100</span></>)}</div>
              <div className="lstat-label">Top evidence score today</div>
              <div className="lstat-sub">14-layer scoring, audited</div>
            </div>
          </div>
        </div>
      </section>

      {/* MODULES */}
      <section id="sec-modules">
        <div className="container">
          <div className="reveal">
            <div className="sec-eyebrow">01 · Modules</div>
            <h2 className="lsec-title">Eight modules. <span className="grad">One connected view.</span></h2>
            <p className="lsec-sub">Every module talks to every other. Rotation informs signals. Signals inform the ledger. The ledger keeps score on everything — including the rules.</p>
          </div>
          <div className="modules-grid">
            {MODULES.map((m) => (
              <Link href="/t" key={m.name} className="lmodule reveal" style={{ ['--mod-color' as string]: m.color }}>
                <div className="lmodule-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /></svg>
                </div>
                <div className="lmodule-name">{m.name}</div>
                <div className="lmodule-desc">{m.desc}</div>
                <span className="lmodule-tag">{m.tag}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section>
        <div className="container">
          <div className="feature">
            <div className="reveal">
              <div className="feature-num">FEATURE · 01</div>
              <h3 className="feature-title">Signals ranked by evidence, not hype.</h3>
              <p className="feature-desc">These two cards are the live board's top picks right now — real levels, real evidence scores, real P&L. Hover the charts: they're the platform's actual price series, and clicking any card opens the terminal on the real thing.</p>
              <div className="feature-list">
                <div className="feature-list-item">{CHECK}<div><b>14-layer evidence scoring</b> <span>— technical, regime, GEX, catalyst, flow, pre-market and more.</span></div></div>
                <div className="feature-list-item">{CHECK}<div><b>Band grading S → C</b> <span>— conviction tiers, strongest to weakest; filter the book in one click.</span></div></div>
                <div className="feature-list-item">{CHECK}<div><b>Entry, stop, T1 and R:R</b> <span>— first target and risk/reward, pre-computed on every signal. No guesswork.</span></div></div>
              </div>
            </div>
            <div className="feature-visual reveal">
              {convLoading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-mute)', fontStyle: 'italic', fontSize: 12 }}>Loading live signals…</div>}
              {!convLoading && top2.map((p) => <SigCard key={p.symbol} p={p} />)}
              {!convLoading && top2.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-mute)', fontStyle: 'italic', fontSize: 12 }}>The board is between publishes — signals appear here the moment they exist.</div>}
            </div>
          </div>

          <div className="feature reverse">
            <div className="reveal">
              <div className="feature-num">FEATURE · 02</div>
              <h3 className="feature-title">See rotation before it becomes consensus.</h3>
              <p className="feature-desc">Every dot is a real sector at its measured relative-strength × momentum coordinate, from the same feed the terminal trades against. The flows below are today's strongest measured in/outflows.</p>
              <div className="feature-list">
                <div className="feature-list-item">{CHECK}<div><b>{sectors.length || 15} sectors mapped live</b> <span>— rsRatio and rsMomentum, computed not drawn.</span></div></div>
                <div className="feature-list-item">{CHECK}<div><b>Inflow / outflow states</b> <span>— cash rotation direction, quantified per sector.</span></div></div>
                <div className="feature-list-item">{CHECK}<div><b>Stale data says so</b> <span>— the map is labeled with its session, never passed off as live.</span></div></div>
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
                {[...flows.top.map((s) => ({ s, cls: 'in' as const })), ...flows.bottom.map((s) => ({ s, cls: 'out' as const }))].map(({ s, cls }) => (
                  <div className="lflow-row" key={s.etf}>
                    <div className="lflow-sym" style={{ color: cls === 'in' ? 'var(--green)' : 'var(--red)' }}>{s.etf}</div>
                    <div className="lflow-bar"><div className={`lflow-fill ${cls}`} style={{ width: `${Math.min(95, Math.abs(s.relChange ?? 0) / flows.maxAbs * 95)}%` }} /></div>
                    <div className={`lflow-val ${cls}`}>{(s.relChange ?? 0) >= 0 ? '+' : ''}{(s.relChange ?? 0).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WORKFLOW */}
      <section id="sec-workflow">
        <div className="container">
          <div className="reveal" style={{ textAlign: 'center', marginBottom: 56 }}>
            <div className="sec-eyebrow" style={{ margin: '0 auto 16px' }}>02 · Workflow</div>
            <h2 className="lsec-title" style={{ margin: '0 auto 16px' }}>From tape to trade <span className="grad">in four moves.</span></h2>
            <p className="lsec-sub" style={{ margin: '0 auto' }}>A repeatable process that removes emotion and surfaces only the setups worth your capital.</p>
          </div>
          <div className="workflow-grid">
            {[
              ['01', 'Read the tape', 'Open the terminal. Check the pulse, rotation map and pattern radar. Know what the market is doing before you look at any ticker.'],
              ['02', 'Rank the book', 'Filter by band, side, state. Sort by conviction, risk/reward or time-to-target. The top of the book is where your attention belongs.'],
              ['03', 'Audit the evidence', 'Open any symbol\'s workup. See every layer that argues for it and against it. If the evidence doesn\'t clear your bar, skip it.'],
              ['04', 'Let the ledger judge', 'Entry, stop and T1 are pre-set. The paper ledger measures every published signal — win rates carry their sample size, always.'],
            ].map(([n, t, d]) => (
              <div className="workflow-step reveal" key={n}>
                <div className="workflow-num">{n}</div>
                <div className="workflow-title">{t}</div>
                <div className="workflow-desc">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

            {/* PRICING — the canonical plans live on /pricing; this section links there
          instead of duplicating a stale tier grid that contradicted it. */}
      <section id="sec-pricing">
        <div className="container">
          <div className="reveal" style={{ textAlign: 'center', marginBottom: 8 }}>
            <div className="sec-eyebrow" style={{ margin: '0 auto 16px' }}>03 · Pricing</div>
            <h2 className="lsec-title" style={{ margin: '0 auto 16px' }}>Start free. <span className="grad">Scale when the book does.</span></h2>
            <p className="lsec-sub" style={{ margin: '0 auto 24px' }}>Explore the platform free, then upgrade to Advanced for unlimited access and real-time data. Beta pricing locks in before launch.</p>
            <Link href="/pricing" className="btn btn-primary btn-lg">
              See plans and pricing
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ — honest answers */}
      <section id="sec-faq">
        <div className="container">
          <div className="reveal" style={{ textAlign: 'center', marginBottom: 48 }}>
            <div className="sec-eyebrow" style={{ margin: '0 auto 16px' }}>04 · FAQ</div>
            <h2 className="lsec-title" style={{ margin: '0 auto' }}>Questions, answered honestly.</h2>
          </div>
          <div className="faq-list">
            {[
              ['Is this investment advice?', 'No. QUANTEDGE is an educational and analytical tool. Every signal is a hypothesis ranked by evidence — not a recommendation. You remain fully responsible for your own execution and risk.'],
              ['What data powers the terminal?', 'Live equity, futures and crypto quotes; real daily and intraday bars for every chart; options chains from multiple sources with freshness disclosed on every surface — delayed data is labeled delayed, and anything unmeasured says NOT MEASURED instead of showing a made-up number.'],
              ['How is "evidence" actually calculated?', 'Each signal is scored across up to 14 independent layers — technicals, market regime, GEX positioning, catalysts, flow, pre-market context and more. Layers argue for (+) or against (−) the setup, every layer shows its reasoning, and the sum is the evidence score. Win rates are only reported once a signal family has 30+ decided outcomes.'],
              ['Does the bot trade my money?', 'No. The Bot module is a paper measurement ledger: it takes the platform\'s own published signals into a simulated book with real contract marks (source and delay disclosed on every fill), so the track record is earned in public. No broker custody, no execution of client funds.'],
              ['Can I cancel anytime?', 'Yes. Monthly plans cancel anytime. Annual plans can be refunded pro-rata within the first 30 days. No retention calls, no friction.'],
            ].map(([q, a], i) => (
              <div className={`faq-item reveal${openFaq === i ? ' open' : ''}`} key={q}>
                <div className="faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  {q}
                  <span className="icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg></span>
                </div>
                <div className="faq-a"><div className="faq-a-inner">{a}</div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="container">
          <div className="cta-box reveal">
            <h2 className="cta-title">Stop trading the headline.<br /><span className="grad">Start trading the tape.</span></h2>
            <p className="cta-sub">Join the operators using QUANTEDGE to read rotation, rank evidence and execute with discipline.</p>
            <div className="cta-actions">
              <Link href="/t" className="btn btn-primary btn-lg">
                Open the terminal
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
              </Link>
              <Link href="/t?tab=gex" className="btn btn-ghost btn-lg">See the GEX surface</Link>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lfooter">
        <div className="container">
          {/* Footer links: /about, /w, /academy, /pricing and the legal pages had
              no door anywhere in the product (nav-architecture test N4, 2026-09-24). */}
          <nav className="lfooter-links" aria-label="Site" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginBottom: 16 }}>
            {[['/about', 'About'], ['/pricing', 'Pricing'], ['/academy', 'Academy'], ['/blog', 'Blog'], ['/w', 'Public watchlist'], ['/privacy', 'Privacy'], ['/terms', 'Terms']].map(([href, label]) => (
              <Link key={href} href={href} style={{ color: 'var(--text-dim)', textDecoration: 'none', fontSize: 13, minHeight: 32, display: 'inline-flex', alignItems: 'center' }}>{label}</Link>
            ))}
          </nav>
          <div className="lfooter-bottom">
            <div>© 2026 QuantEdge Labs · All rights reserved.</div>
            <div className="disclaimer">Educational and analytical tool only. Not investment advice. Trading involves risk of loss. Past performance of signals does not guarantee future results — and every performance figure shown carries its sample size.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
