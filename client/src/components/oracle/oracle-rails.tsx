/**
 * ORACLE RAILS — the furniture the v2 terminal layout adds around the book.
 *
 * Carbon-copied structurally from the operator's reference mock (a fixed-viewport
 * three-column terminal), with one deliberate deviation the mock cannot survive
 * without: the mock generates its tape, its watchlist sparks and its price
 * "jitter" from Math.random() on a timer. Every widget here reads a real
 * endpoint, shows the server's own timestamp through Heartbeat, and renders its
 * empty state honestly. A marquee of invented prints is the same fabrication
 * this branch spent d186fef..e16a23c removing — better lit.
 *
 * Colour comes from tokens (--trade-*, --brand-*, --grade-*), never from the
 * mock's hex palette. That is the "keep our theme" half of the instruction.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Heartbeat } from '@/components/viz';
import { feedTimestamp } from '@/components/canon/use-feed-freshness';
import { Sparkline } from '@/components/hunt/cockpit/sparkline';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────
   TICKER TAPE — real quotes from /api/extended-hours.
   The mock scrolls 20 hardcoded prices forever. This scrolls the movers the
   scanner actually measured, says which session they are from, and goes quiet
   (not busy) when the feed is stale.
   ──────────────────────────────────────────────────────────────── */

interface EHQuote {
  symbol: string;
  lastPrice: number;
  changePct: number;
  asOf?: string;
}
interface EHPayload {
  generatedAt?: string;
  asOf?: string;
  isStale?: boolean;
  session?: string;
  gainers?: EHQuote[];
  losers?: EHQuote[];
  mostActive?: EHQuote[];
  assetClasses?: EHQuote[];
}

function sessionLabel(session?: string): string {
  switch (session) {
    case 'pre': return 'PRE-MARKET';
    case 'post': return 'AFTER HOURS';
    case 'regular': return 'LIVE SESSION';
    case 'closed': return 'LAST CLOSE';
    default: return 'SESSION —';
  }
}

export function TickerTape({ className }: { className?: string }) {
  const { data } = useQuery<EHPayload>({
    queryKey: ['/api/extended-hours', 'oracle-tape'],
    queryFn: async () => {
      const r = await fetch('/api/extended-hours', { credentials: 'include' });
      if (!r.ok) throw new Error('extended-hours failed');
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });

  // Dedup across the four lists, keep scanner order (gainers → losers → active).
  const seen = new Set<string>();
  const quotes: EHQuote[] = [];
  for (const list of [data?.gainers, data?.losers, data?.mostActive, data?.assetClasses]) {
    for (const q of list ?? []) {
      // Both fields, not just one — mostActive rows can carry a change with no
      // price. A quote missing either is not printable, so it is not printed.
      if (seen.has(q.symbol) || !Number.isFinite(q.changePct) || !Number.isFinite(q.lastPrice)) continue;
      seen.add(q.symbol);
      quotes.push(q);
    }
  }

  if (!quotes.length) {
    // No feed → an empty quiet strip, not an invented one.
    return (
      <div className={cn('ticker-tape', className)} style={{ minHeight: 28 }}>
        <span style={{ padding: '0 16px', fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-mute)' }}>
          quote tape · no data
        </span>
      </div>
    );
  }

  /* The reference marquee, exactly — .ticker-tape > .ticker-track > .ticker-item.
     The session and the feed's honest age ride as the track's lead item instead
     of a side chip, so the information survives without changing his layout. */
  const lead = (i: number) => (
    <div key={`lead-${i}`} className="ticker-item">
      <span className="ticker-price" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {sessionLabel(data?.session)}
        <Heartbeat since={feedTimestamp(data)} staleAfterSec={900} />
      </span>
      <span className="ticker-sep">·</span>
    </div>
  );
  const item = (q: EHQuote, i: number) => (
    <div key={`${q.symbol}-${i}`} className="ticker-item">
      <span className="ticker-sym">{q.symbol.replace('-USD', '')}</span>
      <span className="ticker-price">
        {q.lastPrice >= 1000 ? q.lastPrice.toLocaleString('en-US', { maximumFractionDigits: 0 }) : q.lastPrice.toFixed(2)}
      </span>
      <span className={cn('ticker-chg', q.changePct >= 0 ? 'up' : 'down')}>
        {q.changePct >= 0 ? '+' : ''}
        {q.changePct.toFixed(2)}%
      </span>
      <span className="ticker-sep">·</span>
    </div>
  );

  return (
    <div className={cn('ticker-tape', className)} style={{ minHeight: 28 }} aria-label="quote tape">
      {/* Two copies for the seamless wrap; the animation moves -50%. A stale
          feed pauses — motion is a liveness claim (MOTION.md). */}
      <div className={cn('ticker-track', data?.isStale && 'stale')}>
        {lead(0)}
        {quotes.map(item)}
        {lead(1)}
        {quotes.map((q, i) => item(q, i + quotes.length))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   SECTOR HEATMAP — /api/sector-rotation, the same feed the Rotation Map and
   money-flow strip read, so the three can never disagree about a sector.
   ──────────────────────────────────────────────────────────────── */

interface Sector {
  etf: string;
  name: string;
  change: number;
  state?: string;
}
interface RotationPayload {
  asOf?: string;
  sessionLabel?: string;
  isStale?: boolean;
  sectors?: Sector[];
}

/** Token-mixed cell fill — intensity tracks |change|, hue tracks sign. */
function heatStyle(chg: number): React.CSSProperties {
  const t = Math.min(Math.abs(chg) / 5, 1); // ±5% saturates
  const base = chg >= 0 ? 'var(--trade-bullish)' : 'var(--trade-bearish)';
  return {
    background: `color-mix(in srgb, ${base} ${Math.round(8 + t * 34)}%, transparent)`,
    borderColor: `color-mix(in srgb, ${base} ${Math.round(18 + t * 30)}%, transparent)`,
    color: t > 0.45 ? 'var(--foreground)' : `color-mix(in srgb, ${base} 80%, var(--foreground))`,
  };
}

export function SectorHeatmap({
  className,
  onSelectSymbol,
}: {
  className?: string;
  onSelectSymbol?: (sym: string) => void;
}) {
  const { data } = useQuery<RotationPayload>({
    queryKey: ['/api/sector-rotation', 'oracle-heatmap'],
    queryFn: async () => {
      const r = await fetch('/api/sector-rotation', { credentials: 'include' });
      if (!r.ok) throw new Error('sector-rotation failed');
      return r.json();
    },
    staleTime: 120_000,
    refetchInterval: 180_000,
    retry: 1,
  });

  const sectors = data?.sectors ?? [];

  return (
    <div className={cn('px-4 py-3', className)}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Sector heatmap
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          {data?.sessionLabel ?? '1D % chg'}
          <Heartbeat since={feedTimestamp(data)} staleAfterSec={900} />
        </span>
      </div>
      {sectors.length ? (
        <div className="grid grid-cols-5 gap-[3px]">
          {sectors.map((s) => (
            <button
              key={s.etf}
              type="button"
              onClick={() => onSelectSymbol?.(s.etf)}
              title={`${s.name} · ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%${s.state ? ` · ${s.state}` : ''}`}
              className="relative aspect-[1.4] rounded-[3px] border font-mono text-[9px] font-bold transition-transform hover:z-[2] hover:scale-105"
              style={heatStyle(s.change)}
            >
              {s.etf}
              <span className="absolute bottom-[2px] right-[3px] text-[9px] font-medium opacity-80">
                {s.change >= 0 ? '+' : ''}
                {s.change.toFixed(1)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="font-mono text-[10px] text-muted-foreground">no sector read yet</p>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   WATCHLIST RAIL — /api/watchlist joined with the extended-hours scan.
   A watchlist symbol the scanner did not price shows a dash, not a guess. An
   empty watchlist is an empty state — the mock's ten hardcoded biotech names
   do not ship.
   ──────────────────────────────────────────────────────────────── */

export function WatchlistRail({
  className,
  onSelectSymbol,
}: {
  className?: string;
  onSelectSymbol?: (sym: string) => void;
}) {
  const { data: watchlist } = useQuery<{ symbol: string }[]>({
    queryKey: ['/api/watchlist'],
    refetchInterval: 120_000,
  });
  const { data: eh } = useQuery<EHPayload>({
    queryKey: ['/api/extended-hours', 'oracle-tape'],
    queryFn: async () => {
      const r = await fetch('/api/extended-hours', { credentials: 'include' });
      if (!r.ok) throw new Error('extended-hours failed');
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });

  const quoteBySym = new Map<string, EHQuote>();
  for (const list of [eh?.gainers, eh?.losers, eh?.mostActive, eh?.assetClasses]) {
    for (const q of list ?? []) {
      if (!quoteBySym.has(q.symbol) && Number.isFinite(q.changePct)) quoteBySym.set(q.symbol, q);
    }
  }

  const names = (watchlist ?? []).slice(0, 12);

  return (
    <div className={cn('border-t border-border/50 px-4 py-3', className)}>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Watchlist
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {names.length ? `${names.length} names` : ''}
        </span>
      </div>
      {names.length ? (
        <div className="space-y-0.5">
          {names.map(({ symbol }) => {
            const q = quoteBySym.get(symbol);
            const up = q != null && q.changePct >= 0;
            return (
              <button
                key={symbol}
                type="button"
                onClick={() => onSelectSymbol?.(symbol)}
                className="grid w-full grid-cols-[44px_1fr_auto] items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--brand-cyan)_5%,transparent)]"
              >
                <span className="font-mono text-[11px] font-bold">{symbol}</span>
                <Sparkline symbol={symbol} tone={q ? (up ? 'bull' : 'bear') : 'neutral'} width="100%" height={20} />
                {q ? (
                  <span
                    className="text-right font-mono text-[10px] font-bold tabular-nums"
                    style={{ color: up ? 'var(--trade-bullish)' : 'var(--trade-bearish)' }}
                  >
                    {up ? '+' : ''}
                    {q.changePct.toFixed(1)}%
                  </span>
                ) : (
                  /* Not scanned this pass — absence, not zero. */
                  <span className="text-right font-mono text-[10px] text-muted-foreground">—</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="ui-prose py-2 text-[11px] text-muted-foreground">
          No names on the watchlist yet — add tickers from any board and they track here.
        </p>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   SYSTEM STATUS — the same query keys the footer's LiveStatsBar uses, rendered
   as the mock's key/value block. Shared keys mean React Query serves one cache
   and the two surfaces cannot disagree.
   ──────────────────────────────────────────────────────────────── */

export function SystemStatusBlock({ className }: { className?: string }) {
  const { data: botStatus } = useQuery<{ bots: { name: string; status: string }[] }>({
    queryKey: ['/api/automations/status'],
    refetchInterval: 60_000,
  });
  const { data: watchlistData } = useQuery<{ symbol: string }[]>({
    queryKey: ['/api/watchlist'],
    refetchInterval: 120_000,
  });
  const { data: pulseData } = useQuery<{ macro?: { vix?: number; vixState?: string } }>({
    queryKey: ['market-pulse'],
    queryFn: async () => {
      const r = await fetch('/api/market-pulse', { credentials: 'include' });
      if (!r.ok) throw new Error('market-pulse failed');
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });
  const { data: health } = useQuery<{ dataPartial?: boolean }>({
    queryKey: ['/api/health', 'terminal-chrome'],
    queryFn: async () => {
      const r = await fetch('/api/health', { credentials: 'include' });
      if (!r.ok) throw new Error('health failed');
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });

  const runningBots = botStatus?.bots?.filter((b) => b.status === 'running').length;
  const vix = pulseData?.macro?.vix;

  const Row = ({ k, v, tone }: { k: string; v: React.ReactNode; tone?: 'ok' | 'warn' }) => (
    <div className="flex justify-between py-1 font-mono text-[10.5px]">
      <span className="uppercase tracking-wider text-muted-foreground">{k}</span>
      <span
        className="font-semibold tabular-nums"
        style={
          tone === 'ok'
            ? { color: 'var(--trade-bullish)' }
            : tone === 'warn'
              ? { color: 'var(--brand-gold, #facc15)' }
              : undefined
        }
      >
        {v}
      </span>
    </div>
  );

  return (
    <div className={cn('border-t border-border/50 px-4 py-3', className)}>
      <Row k="Feed" v={health?.dataPartial ? 'partial' : 'connected'} tone={health?.dataPartial ? 'warn' : 'ok'} />
      <Row k="Bots" v={runningBots ?? '—'} />
      <Row k="Watchlist" v={watchlistData?.length ?? '—'} />
      {/* VIX above ~20 is the conventional caution line; below it stays neutral. */}
      <Row k="VIX" v={vix != null ? vix.toFixed(1) : '—'} tone={vix != null && vix >= 20 ? 'warn' : undefined} />
      <p className="mt-2 border-t border-border/40 pt-2 text-center font-mono text-[9px] italic leading-relaxed text-muted-foreground">
        Educational only · not investment advice.
        <br />
        Past setups do not guarantee future results.
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   FOOTER MARKET LINE — the reference bottom bar's session · index · BTC ·
   countdown · clock, on real data. The countdown is not theater: it counts to
   the tape query's actual next refetch (dataUpdatedAt + interval), so it is a
   true statement about when the screen polls again. The clock is wall time.
   ──────────────────────────────────────────────────────────────── */

const TAPE_REFETCH_MS = 120_000;

function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function FooterMarketLine({ className }: { className?: string }) {
  const { data, dataUpdatedAt } = useQuery<EHPayload>({
    queryKey: ['/api/extended-hours', 'oracle-tape'],
    queryFn: async () => {
      const r = await fetch('/api/extended-hours', { credentials: 'include' });
      if (!r.ok) throw new Error('extended-hours failed');
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: TAPE_REFETCH_MS,
    retry: 1,
  });
  const now = useNowTick();

  // assetClasses rows carry only the day change (lastPrice is null by design on
  // that list), while the same symbol appears in mostActive WITH a level. Prefer
  // the row that has the price, fall back to the change-only one.
  const bySym = new Map<string, EHQuote>();
  for (const list of [data?.mostActive, data?.gainers, data?.losers, data?.assetClasses]) {
    for (const q of list ?? []) {
      const prev = bySym.get(q.symbol);
      if (!prev || (!Number.isFinite(prev.lastPrice) && Number.isFinite(q.lastPrice))) {
        bySym.set(q.symbol, q);
      }
    }
  }
  const spy = bySym.get('SPY');
  const btc = bySym.get('BTC-USD');

  const nextIn = dataUpdatedAt ? Math.max(0, Math.ceil((dataUpdatedAt + TAPE_REFETCH_MS - now) / 1000)) : null;
  const clock = new Date(now).toTimeString().slice(0, 8);

  const Quote = ({ label, q, money }: { label: string; q?: EHQuote; money?: boolean }) => {
    if (!q || !Number.isFinite(q.changePct)) return null;
    const hasLevel = Number.isFinite(q.lastPrice);
    return (
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        {label}{' '}
        {/* When the feed carries only the day change (assetClasses rows), show
            the change alone rather than inventing a level. */}
        {hasLevel && (
          <b className="text-[var(--brand-cyan)]">
            {money ? `$${Math.round(q.lastPrice).toLocaleString()}` : q.lastPrice.toFixed(2)}
          </b>
        )}
        <span style={{ color: q.changePct >= 0 ? 'var(--trade-bullish)' : 'var(--trade-bearish)' }}>
          {q.changePct >= 0 ? '+' : ''}
          {q.changePct.toFixed(1)}%
        </span>
      </span>
    );
  };

  return (
    <span className={cn('inline-flex items-center gap-3 font-mono', className)}>
      <span className="text-muted-foreground">{sessionLabel(data?.session).toLowerCase()}</span>
      <Quote label="SPY" q={spy} />
      <Quote label="BTC" q={btc} money />
      {nextIn != null && (
        <span className="hidden tabular-nums text-muted-foreground lg:inline">
          next poll {nextIn}s
        </span>
      )}
      <span className="tabular-nums text-muted-foreground">{clock}</span>
    </span>
  );
}
