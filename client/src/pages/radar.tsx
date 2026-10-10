/**
 * THESIS RADAR — Autonomous Setup Discovery
 *
 * 4 tabs:
 *   FORMING       Pre-breakout setups firing now (live cron output)
 *   PICKS         Recent fired picks with letter-grade conviction
 *   PATTERNS      The 6 pattern signatures we scan with
 *   TRACK RECORD  Every pick logged with hit/miss/expired status
 *
 * The Radar is QuantEdge's autonomous discovery engine — it runs every 09:35,
 * 12:00, 15:55 ET on weekdays and pushes A+ picks straight to Trade Desk.
 *
 * Phase 4: one hero metric (actionable forming setups first), compact
 * pick cards capped at 30 with show-more, a single legend for the jargon,
 * and error states that are distinct from empty states.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { QETabs, type QETabItem } from '@/components/ui/qe-tabs';
import { useTabState } from '@/hooks/use-tab-state';
import { PageErrorBoundary } from '@/components/page-error-boundary';
import { Loader2, RefreshCw, Zap, Target, History, Eye, AlertTriangle } from 'lucide-react';

type Tab = 'forming' | 'picks' | 'patterns' | 'track';

const TABS: readonly QETabItem<Tab>[] = [
  { id: 'forming',  label: 'Forming',     hint: 'Pre-breakout setups detected this scan cycle' },
  { id: 'picks',    label: 'Picks',       hint: 'Fired picks with letter-grade conviction' },
  { id: 'patterns', label: 'Patterns',    hint: 'The 6 pattern signatures the engine scans for' },
  { id: 'track',    label: 'Track Record', hint: 'Every pick logged with outcome (hit / invalidated / expired)' },
];

const VALID_TABS = TABS.map(t => t.id);

/** Compact cards cap — summary before detail. */
const PICKS_CAP = 30;

export default function RadarPage() {
  const [tab, setTab] = useTabState<Tab>('picks', VALID_TABS);

  // Single page-level fetch for /api/radar/picks — shared by the Picks tab,
  // the Forming tab (filter), and the hero metric. One request, one source
  // of truth, and fetch failure is tracked separately from "empty".
  const [picks, setPicks] = useState<RadarPick[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadPicks = useCallback(() => {
    setLoading(true);
    setError(false);
    fetch('/api/radar/picks?limit=50', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`radar picks ${r.status}`);
        return r.json();
      })
      .then(d => { setPicks(d.picks ?? []); setLoading(false); })
      .catch(() => { setPicks([]); setError(true); setLoading(false); });
  }, []);

  useEffect(() => { loadPicks(); }, [loadPicks]);

  const query: PicksQuery = { picks, loading, error };

  // HERO METRIC — the single most decision-relevant number on a thesis radar
  // is "is there anything actionable right now?". Forming setups are
  // pre-breakout (pattern matched, entry trigger not yet confirmed): the only
  // thing a trader can still act on. Fired picks are history. So the hero is
  // the forming count plus the highest-conviction forming pick; when nothing
  // is forming we fall back to the latest fired pick.
  const hero = useMemo(() => {
    if (loading || !picks) return null;
    const forming = picks.filter(p => p.status === 'forming');
    if (forming.length > 0) {
      const top = [...forming].sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))[0];
      return { kind: 'forming' as const, count: forming.length, symbol: top.symbol, grade: top.finalGrade };
    }
    if (picks.length > 0) {
      const latest = [...picks].sort((a, b) => +new Date(b.firedAt) - +new Date(a.firedAt))[0];
      return { kind: 'latest' as const, count: picks.length, symbol: latest.symbol, grade: latest.finalGrade };
    }
    return { kind: 'empty' as const };
  }, [picks, loading]);

  return (
    <div className="space-y-3 px-4 py-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
            <Target className="h-4 w-4" />
            Thesis Radar
          </h1>
          <HeroLine hero={hero} loading={loading} error={error} />
          <p className="text-[11px] font-mono text-muted-foreground">
            Autonomous setup discovery — 6 patterns, ~120 tickers, 5 scans/day.
          </p>
        </div>
        <RescanButton onScan={loadPicks} />
      </header>

      <QETabs items={TABS} active={tab} onChange={setTab} prefixLabel="VIEW" />

      <div className="text-[9px] font-mono text-muted-foreground">
        {TABS.find(t => t.id === tab)?.hint}
      </div>

      <Legend />

      <PageErrorBoundary label={`Radar · ${tab}`}>
        {tab === 'forming'  && <FormingTab query={query} />}
        {tab === 'picks'    && <PicksTab query={query} />}
        {tab === 'patterns' && <PatternsTab />}
        {tab === 'track'    && <TrackTab />}
      </PageErrorBoundary>
    </div>
  );
}

type Hero =
  | { kind: 'forming'; count: number; symbol: string; grade: string }
  | { kind: 'latest'; count: number; symbol: string; grade: string }
  | { kind: 'empty' }
  | null;

function HeroLine({ hero, loading, error }: { hero: Hero; loading: boolean; error: boolean }) {
  if (loading) {
    return <div className="text-sm font-mono text-muted-foreground animate-pulse">Reading radar…</div>;
  }
  if (error || !hero) {
    return <div className="text-sm font-mono text-muted-foreground">Couldn't reach the radar API.</div>;
  }
  if (hero.kind === 'forming') {
    return (
      <div className="text-sm font-mono flex items-center gap-2 flex-wrap">
        <span className="font-bold text-amber-500">{hero.count} forming</span>
        <span className="text-muted-foreground text-[11px]">top:</span>
        <span className="font-bold text-foreground">{hero.symbol}</span>
        <GradePill grade={hero.grade} />
      </div>
    );
  }
  if (hero.kind === 'latest') {
    return (
      <div className="text-sm font-mono flex items-center gap-2 flex-wrap">
        <span className="text-muted-foreground text-[11px]">latest pick:</span>
        <span className="font-bold text-foreground">{hero.symbol}</span>
        <GradePill grade={hero.grade} />
        <span className="text-muted-foreground text-[11px]">· {hero.count} fired</span>
      </div>
    );
  }
  return <div className="text-sm font-mono text-muted-foreground">No picks on record yet — the next scan will appear here.</div>;
}

// ─── Legend — the one place jargon gets explained ────────────────────

function Legend() {
  return (
    <details className="text-[10px] font-mono text-muted-foreground">
      <summary className="cursor-pointer text-primary/80 hover:text-primary w-fit">
        Legend — grades, statuses, terms
      </summary>
      <div className="mt-2 space-y-1.5 max-w-2xl">
        <div>
          <span className="font-bold text-foreground/80">Grade&nbsp;</span>
          letter-grade conviction from the engine, A+ highest through D — the colored chip on every pick.
        </div>
        <div>
          <span className="font-bold text-foreground/80">Forming&nbsp;</span>
          pattern matched but the entry trigger hasn't confirmed yet — the actionable watchlist.
        </div>
        <div>
          <span className="font-bold text-foreground/80">Fired pick&nbsp;</span>
          a setup the engine acted on: entry spot, targets T1/T2, and invalidation (stop).
        </div>
        <div>
          <span className="font-bold text-foreground/80">Signals&nbsp;</span>
          the graded inputs behind a pick — each chip shows label + grade, hover for the source.
        </div>
        <div>
          <span className="font-bold text-foreground/80">Hit rate / Avg pct / Avg days&nbsp;</span>
          track-record columns: share of resolved picks that hit, mean outcome, mean days to resolve.
        </div>
      </div>
    </details>
  );
}

// ─── Picks tab — recent fired picks ────────────────────────────────

interface RadarPick {
  id: string;
  firedAt: string;
  patternId: string;
  symbol: string;
  spotAtFire: number;
  finalGrade: string;
  finalScore: number;
  synthesis: string;
  status: string;
  direction: string;
  signals: { label: string; grade: string; score: number; source: string }[];
  invalidation?: number;
  targets?: { t1?: number; t2?: number; t3?: number };
}

interface PicksQuery {
  picks: RadarPick[] | null;
  loading: boolean;
  error: boolean;
}

function PicksTab({ query }: { query: PicksQuery }) {
  const [showAll, setShowAll] = useState(false);
  const { picks, loading, error } = query;

  if (loading) return <LoadingState label="Loading picks…" />;
  if (error) {
    return (
      <ErrorState
        title="Couldn't load picks"
        message="The radar API didn't respond. This doesn't mean the radar is empty — try the Re-scan button or reload the page."
      />
    );
  }
  if (!picks || picks.length === 0) {
    return (
      <EmptyState
        icon={<Eye className="h-8 w-8 text-muted-foreground" />}
        title="No picks fired yet"
        message="Scans run at 09:35, 12:00, 15:55 ET on weekdays. Check back after the next scan, or trigger one manually with the Re-scan button."
      />
    );
  }

  const visible = showAll ? picks : picks.slice(0, PICKS_CAP);
  return (
    <div className="space-y-2">
      {visible.map(p => <PickCard key={p.id} pick={p} />)}
      {picks.length > PICKS_CAP && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="w-full text-[10px] font-mono py-2 rounded border border-border/40 text-muted-foreground hover:text-foreground hover:border-primary/40 transition"
        >
          {showAll ? 'Show less' : `Show all ${picks.length} picks`}
        </button>
      )}
    </div>
  );
}

function PickCard({ pick }: { pick: RadarPick }) {
  const isLong = pick.direction === 'long' || pick.direction === 'long_vol';
  const hasDetail = pick.signals.length > 0 || pick.targets?.t1 || pick.invalidation;
  return (
    <div className="qe-card border border-border/40 rounded-md p-3 space-y-1.5 hover:border-primary/30 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`font-mono text-xs ${isLong ? 'text-[var(--trade-bullish)]' : 'text-rose-500'}`}>
            {isLong ? '↑' : '↓'}
          </span>
          <div className="font-mono font-bold text-sm truncate">{pick.symbol}</div>
          <GradePill grade={pick.finalGrade} />
          <div className="text-[10px] font-mono text-muted-foreground truncate">
            ${pick.spotAtFire.toFixed(2)} · {pick.patternId.replace(/_/g, ' ')}
          </div>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground shrink-0">
          {new Date(pick.firedAt).toLocaleString()}
        </div>
      </div>

      <p className="text-[11px] font-mono text-muted-foreground leading-relaxed line-clamp-2">
        {pick.synthesis}
      </p>

      {hasDetail && (
        <details className="text-[10px] font-mono">
          <summary className="cursor-pointer text-primary/80 hover:text-primary w-fit">
            {pick.signals.length > 0 ? `${pick.signals.length} signals` : 'Details'}
            {(pick.targets?.t1 || pick.invalidation) ? ' · levels' : ''}
          </summary>
          <div className="mt-2 space-y-2">
            {pick.signals.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {pick.signals.map((s, i) => (
                  <div
                    key={i}
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted/30 border border-border/30"
                    title={s.source}
                  >
                    {s.label} <span className="text-muted-foreground">{s.grade}</span>
                  </div>
                ))}
              </div>
            )}
            {(pick.targets?.t1 || pick.invalidation) && (
              <div className="flex items-center gap-3">
                {pick.targets?.t1 && <span className="text-[var(--trade-bullish)]">T1: ${pick.targets.t1.toFixed(2)}</span>}
                {pick.targets?.t2 && <span className="text-[var(--trade-bullish)]">T2: ${pick.targets.t2.toFixed(2)}</span>}
                {pick.invalidation && <span className="text-rose-500">Stop: ${pick.invalidation.toFixed(2)}</span>}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Forming tab ────────────────────────────────────────────────────

function FormingTab({ query }: { query: PicksQuery }) {
  const { picks, loading, error } = query;
  // Forming is the fired-but-unconfirmed subset of the same picks payload —
  // no second fetch, no divergent state.
  const forming = useMemo(() => (picks ?? []).filter(p => p.status === 'forming'), [picks]);

  if (loading) return <LoadingState label="Loading forming setups…" />;
  if (error) {
    return (
      <ErrorState
        title="Couldn't load forming setups"
        message="The radar API didn't respond. This doesn't mean nothing is forming — try the Re-scan button or reload the page."
      />
    );
  }
  if (forming.length === 0) {
    return (
      <EmptyState
        icon={<Zap className="h-8 w-8 text-amber-500/40" />}
        title="No forming setups right now"
        message="This tab watches for patterns that matched but haven't confirmed an entry trigger yet. When one fires, it appears here first — ahead of the Picks tab."
      />
    );
  }
  return <div className="space-y-2">{forming.map(p => <PickCard key={p.id} pick={p} />)}</div>;
}

// ─── Patterns tab ───────────────────────────────────────────────────

interface Pattern {
  id: string;
  name: string;
  thesis: string;
  horizon: string;
  targetHitRate: number;
  filters: { domain: string; predicate: string; explain: string }[];
  gradedSignals: string[];
}

function PatternsTab() {
  const [patterns, setPatterns] = useState<Pattern[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch('/api/radar/patterns', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`radar patterns ${r.status}`);
        return r.json();
      })
      .then(d => setPatterns(d.patterns ?? []))
      .catch(() => { setPatterns([]); setError(true); });
  }, []);
  if (!patterns) return <LoadingState label="Loading patterns…" />;
  if (error) {
    return (
      <ErrorState
        title="Couldn't load patterns"
        message="The radar API didn't respond. The 6 pattern signatures are configured server-side — try reloading the page."
      />
    );
  }
  if (patterns.length === 0) {
    return (
      <EmptyState
        icon={<Eye className="h-8 w-8 text-muted-foreground" />}
        title="No patterns configured"
        message="The engine didn't return any pattern signatures. If this persists, the scan configuration may need attention."
      />
    );
  }
  return (
    <div className="space-y-3">
      {patterns.map(p => (
        <div key={p.id} className="qe-card border border-border/40 rounded-md p-4 space-y-3">
          <div>
            <h3 className="font-mono font-bold text-sm uppercase">{p.name}</h3>
            <p className="text-[11px] font-mono text-muted-foreground mt-1">{p.thesis}</p>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <div className="text-muted-foreground">
              Horizon: <span className="text-foreground">{p.horizon}</span>
            </div>
            <div className="text-muted-foreground">
              Target hit rate: <span className="text-foreground">{(p.targetHitRate * 100).toFixed(0)}%</span>
            </div>
            <div className="text-muted-foreground">
              Filters: <span className="text-foreground">{p.filters.length}</span>
            </div>
          </div>
          <details className="text-[10px] font-mono">
            <summary className="cursor-pointer text-primary/80 hover:text-primary">View filters</summary>
            <ul className="mt-2 space-y-1.5 pl-4">
              {p.filters.map((f, i) => (
                <li key={i} className="text-muted-foreground">
                  <span className="text-primary/60">[{f.domain}]</span> {f.explain}
                </li>
              ))}
            </ul>
          </details>
        </div>
      ))}
    </div>
  );
}

// ─── Track Record tab ───────────────────────────────────────────────

interface PatternStats {
  patternId: string;
  totalPicks: number;
  resolved: number;
  hits: number;
  hitRate: number;
  avgOutcomePct: number;
  avgDaysToResolve: number;
}

function TrackTab() {
  const [stats, setStats] = useState<PatternStats[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch('/api/radar/stats', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`radar stats ${r.status}`);
        return r.json();
      })
      .then(d => setStats(d.stats ?? []))
      .catch(() => { setStats([]); setError(true); });
  }, []);
  if (!stats) return <LoadingState label="Loading track record…" />;
  if (error) {
    return (
      <ErrorState
        title="Couldn't load track record"
        message="The radar API didn't respond. Resolved-pick history is stored server-side — try reloading the page."
      />
    );
  }
  if (stats.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-8 w-8 text-muted-foreground" />}
        title="No resolved picks yet"
        message="Track record builds as picks fire and the daily resolve cron marks outcomes. Check back after a few weeks of operation."
      />
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground px-3 py-2 border-b border-border/30">
        <div className="col-span-2">Pattern</div>
        <div>Picks</div>
        <div>Resolved</div>
        <div>Hit Rate</div>
        <div>Avg Pct</div>
        <div>Avg Days</div>
      </div>
      {stats.map(s => (
        <div key={s.patternId} className="grid grid-cols-7 gap-3 text-[11px] font-mono px-3 py-2 hover:bg-muted/20">
          <div className="col-span-2 text-foreground">{s.patternId.replace(/_/g, ' ')}</div>
          <div>{s.totalPicks}</div>
          <div>{s.resolved}</div>
          <div className={s.hitRate >= 0.5 ? 'text-[var(--trade-bullish)]' : 'text-rose-500'}>
            {(s.hitRate * 100).toFixed(0)}%
          </div>
          <div className={s.avgOutcomePct >= 0 ? 'text-[var(--trade-bullish)]' : 'text-rose-500'}>
            {s.avgOutcomePct >= 0 ? '+' : ''}{s.avgOutcomePct.toFixed(1)}%
          </div>
          <div>{s.avgDaysToResolve.toFixed(1)}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function GradePill({ grade }: { grade: string }) {
  const color =
    grade.startsWith('A') ? 'bg-emerald-500/15 text-[var(--trade-bullish)]' :
    grade.startsWith('B') ? 'bg-blue-500/15 text-blue-500' :
    grade.startsWith('C') ? 'bg-amber-500/15 text-amber-500' :
    'bg-rose-500/15 text-rose-500';
  return (
    <div
      className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${color}`}
      title={`Conviction grade ${grade} — engine letter grade, A+ highest`}
    >
      {grade}
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-[11px] font-mono text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-2" />
      {label}
    </div>
  );
}

function EmptyState({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
      {icon}
      <div className="font-mono text-sm text-foreground">{title}</div>
      <div className="font-mono text-[10px] text-muted-foreground max-w-md">{message}</div>
    </div>
  );
}

function ErrorState({ title, message }: { title: string; message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
      <AlertTriangle className="h-8 w-8 text-amber-500/60" />
      <div className="font-mono text-sm text-foreground">{title}</div>
      <div className="font-mono text-[10px] text-muted-foreground max-w-md">
        {message ?? "The radar API didn't respond. This doesn't mean the radar is empty — try the Re-scan button or reload the page."}
      </div>
    </div>
  );
}

function RescanButton({ onScan }: { onScan?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const handleRescan = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/radar/scan', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      const total = (data.picks ?? []).length;
      setLastResult(`Fired ${total} picks across ${data.summaries?.length ?? 0} patterns`);
      // Refresh page-level data without a full reload
      setTimeout(() => onScan?.(), 1500);
    } catch (e) {
      setLastResult('Scan failed');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      {lastResult && <div className="text-[10px] font-mono text-muted-foreground">{lastResult}</div>}
      <button
        onClick={handleRescan}
        disabled={loading}
        className="text-[10px] font-mono px-3 py-1.5 rounded border border-border/40 hover:border-primary/40 hover:bg-muted/30 flex items-center gap-2 disabled:opacity-50"
      >
        <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        Re-scan
      </button>
    </div>
  );
}
