/**
 * HOW TO USE QUANTEDGE — single-page user guide
 *
 * Linked from sidebar (Help) and ⌘K. Static page with no API calls.
 * Goal: replace "I don't know how to use this" with "I know exactly where to go."
 */
import { Link } from 'wouter';
import { Target, Bitcoin, Home, Wallet, Crosshair, Zap, BookOpen, Microscope, ArrowRight } from 'lucide-react';

export default function HowToPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-mono font-bold uppercase tracking-widest">
          How to use QuantEdge
        </h1>
        <p className="text-[12px] font-mono text-muted-foreground">
          One terminal, three windows of time, one workflow. Read this once.
        </p>
      </header>

      {/* Daily Workflow */}
      <Section title="Your Daily Workflow" subtitle="3 windows of time, 3 things to check">
        <div className="space-y-3">
          <Step
            time="MORNING (8:00–9:30 AM ET)"
            actions={[
              { url: '/t',     label: 'Terminal — NEXUS',     why: 'Market briefing — regime, rotation, signals' },
              { url: '/radar', label: 'Thesis Radar → Picks', why: 'See what fired overnight (auto)' },
              { url: '/t?tab=crypto', label: 'Terminal — Crypto', why: 'BTC level breaks — MARA/COIN/MSTR plays' },
              { url: '/t?tab=positions', label: 'Positions',  why: 'Adjust stops on existing trades' },
            ]}
          />
          <Step
            time="DURING MARKET (9:30 AM – 4:00 PM)"
            actions={[
              { url: '/r/QCOM', label: 'Research → /r/[ticker]', why: 'Per-ticker chart, options, GEX, flow — all in one' },
              { url: '/t?tab=gex', label: 'GEX',               why: 'Dealer walls = your entry/exit levels' },
            ]}
          />
          <Step
            time="LUNCH + CLOSE (12:00 PM, 3:55 PM)"
            actions={[
              { url: '/radar', label: 'Re-check Radar', why: 'Cron fires fresh picks at these exact times' },
            ]}
          />
        </div>
      </Section>

      {/* What each page is for */}
      <Section title="What Each Page Does" subtitle="Eight destinations — that's the whole product.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PageCard icon={Home}       url="/t"      title="Terminal"        desc="NEXUS home — market briefing, rotation, signals, and every tab" />
          <PageCard icon={Target}     url="/radar"  title="Thesis Radar"    desc="6 patterns × 120 tickers, scanned 5×/day, A+ pushes to Trade Desk" />
          <PageCard icon={Bitcoin}    url="/t?tab=crypto" title="BTC Radar" desc="Live BTC + 14 crypto-equity beta tracker, fires on level breaks" />
          <PageCard icon={Crosshair}  url="/slate" title="Slate"  desc="Today's measured setups and the pre-market gappers" />
          <PageCard icon={Zap}        url="/t?tab=gex" title="GEX & Flow"   desc="Dealer gamma walls + options flow — your entry/exit lens" />
          <PageCard icon={Microscope} url="/r/SPY"  title="Research"        desc="Per-ticker deep dive — chart, options, GEX, flow, news" />
          <PageCard icon={Wallet}     url="/t?tab=positions" title="Positions" desc="Your open book — alerts, stops, exits" />
          <PageCard icon={BookOpen}   url="/t?tab=journal" title="Journal"  desc="Trade history + performance + backtests" />
        </div>
      </Section>

      {/* What Thesis Radar does */}
      <Section title="How Thesis Radar Works" subtitle="The autonomous discovery engine">
        <div className="qe-card border border-border/40 rounded-md p-4 space-y-3">
          <div className="text-[11px] font-mono space-y-2">
            <p>
              <span className="text-[var(--brand-cyan)]">1.</span>{' '}
              Cron runs at <strong>09:35, 12:00, 15:55, 20:00 ET</strong> on weekdays
            </p>
            <p>
              <span className="text-[var(--brand-cyan)]">2.</span>{' '}
              Scans <strong>~120 tickers</strong> against <strong>6 pattern signatures</strong>:
            </p>
            <ul className="ml-6 space-y-1 text-muted-foreground text-[11px]">
              <li>• <strong>DGXX Setup</strong> — small-cap + AI-adjacent + call vol spike + hyperscaler news</li>
              <li>• <strong>Aschenbrenner 2nd Derivative</strong> — layer hasn't run yet vs first-order layer</li>
              <li>• <strong>Bottleneck Whisper</strong> — "constrained / shortage" mentions cluster</li>
              <li>• <strong>Institutional Accumulation</strong> — whale buys + insider purchases</li>
              <li>• <strong>Catalyst Whisper</strong> — unusual OI + scheduled event in 30 days</li>
              <li>• <strong>Gamma Squeeze</strong> — UNH-style penny call premium juice</li>
            </ul>
            <p>
              <span className="text-[var(--brand-cyan)]">3.</span>{' '}
              Each match graded on <strong>7 signals</strong> (price action, options flow, news, IV, analysts, institutional, sector rotation) → composite letter grade A+ to F
            </p>
            <p>
              <span className="text-[var(--brand-cyan)]">4.</span>{' '}
              Picks ≥ <strong>B+</strong> auto-push to Trade Desk + Discord (when webhook configured)
            </p>
            <p>
              <span className="text-[var(--brand-cyan)]">5.</span>{' '}
              You wake up to a ranked picks list at <Link href="/radar" className="text-[var(--brand-cyan)] underline">/radar</Link>
            </p>
          </div>
        </div>
      </Section>

      {/* Quick decision tree */}
      <Section title="When Stuck — Quick Decision Tree" subtitle="">
        <div className="space-y-2 text-[11px] font-mono">
          <DecisionRow q="What should I trade today?"               a={['/radar', '/btc']} />
          <DecisionRow q="Is the market bullish or bearish?"        a={['/p?tab=pulse']} />
          <DecisionRow q="Where's QCOM going?"                       a={['/r/QCOM', '/g']} />
          <DecisionRow q="What just got published today?"   a={['/slate']} />
          <DecisionRow q="What earnings are this week?"             a={['/p?tab=earnings']} />
          <DecisionRow q="My open positions?"                        a={['/pos']} />
          <DecisionRow q="My win rate / track record?"               a={['/j']} />
          <DecisionRow q="A pattern setup I want to follow?"        a={['/h']} />
        </div>
      </Section>

      {/* Limits to know */}
      <Section title="What QuantEdge ISN'T" subtitle="Honest disclosure">
        <div className="text-[11px] font-mono text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">Real-time data:</strong> we use CBOE delayed (15 min) + Yahoo Finance + Tradier when token is alive. We're <strong>not</strong> Unusual Whales (no curated dark pool prints) or Polygon ($99/mo institutional real-time).
          </p>
          <p>
            <strong className="text-foreground">Best for:</strong> swing trades + LEAPS where 15-min lag doesn't kill you. Thesis discovery. Pattern recognition. Auto-graded conviction.
          </p>
          <p>
            <strong className="text-foreground">Not best for:</strong> 0DTE scalping (need real-time, refresh Tradier first). Pre-market options data (limited). Overnight stock alerts (closed market).
          </p>
        </div>
      </Section>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-[13px] font-mono uppercase tracking-wider text-foreground">{title}</h2>
        {subtitle && <p className="text-[11px] font-mono text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Step({ time, actions }: { time: string; actions: { url: string; label: string; why: string }[] }) {
  return (
    <div className="qe-card border border-border/40 rounded-md p-3">
      <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--brand-cyan)] mb-2">{time}</div>
      <div className="space-y-1.5">
        {actions.map((a, i) => (
          <Link key={i} href={a.url} className="flex items-center gap-2 text-[11px] font-mono hover:bg-muted/30 px-2 py-1 rounded transition">
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="text-foreground min-w-[200px]">{a.label}</span>
            <span className="text-muted-foreground">{a.why}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PageCard({ icon: Icon, url, title, desc }: { icon: any; url: string; title: string; desc: string }) {
  return (
    <Link href={url} className="qe-card border border-border/40 rounded-md p-3 hover:border-[var(--brand-cyan)]/40 transition">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 text-[var(--brand-cyan)]" />
        <div className="text-[12px] font-mono font-bold uppercase">{title}</div>
        <div className="text-[11px] font-mono text-muted-foreground">{url}</div>
      </div>
      <p className="text-[11px] font-mono text-muted-foreground">{desc}</p>
    </Link>
  );
}

function DecisionRow({ q, a }: { q: string; a: string[] }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border border-border/30 rounded">
      <span className="flex-1 text-foreground">{q}</span>
      <div className="flex gap-1">
        {a.map((url, i) => (
          <Link key={i} href={url} className="px-2 py-0.5 rounded bg-[var(--brand-cyan)]/10 text-[var(--brand-cyan)] hover:bg-[var(--brand-cyan)]/20 text-[11px] font-mono">
            {url}
          </Link>
        ))}
      </div>
    </div>
  );
}
