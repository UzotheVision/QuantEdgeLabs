/**
 * GexBigGainers — premium GEX-scanner plays that ran hot.
 *
 * Two buckets, one endpoint (`/api/gex/big-gainers`):
 *   Running Now  — still-open plays whose peak run-up cleared the threshold (peak, not last).
 *   Hall of Fame — resolved winners ranked by realized % gain.
 *
 * Rendered full in the GEX hub (gainers tab) and compact in the Trade Desk.
 */
import { useQuery } from '@tanstack/react-query';
import { QECard } from '@/components/ui/qe-card';
import { QEPill } from '@/components/ui/qe-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineEmptyState } from '@/components/ui/empty-state';
import { safeToFixed, cn } from '@/lib/utils';
import { Flame, Trophy, TrendingUp, TrendingDown } from 'lucide-react';

interface GexLivePlay {
  id: string | number;
  symbol: string;
  assetType: string;
  direction: 'long' | 'short';
  optionType: string | null;
  strikePrice: number | null;
  expiryDate: string | null;
  entryPrice: number;
  targetPrice: number | null;
  peakPrice: number | null;
  peakGain: number;
  regime: string | null;
  rationale: string;
  catalyst: string | null;
  timestamp: string;
}

interface GexClosedPlay {
  id: string | number;
  symbol: string;
  assetType: string;
  direction: 'long' | 'short';
  optionType: string | null;
  strikePrice: number | null;
  expiryDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  percentGain: number | null;
  outcomeStatus: string;
  regime: string | null;
  rationale: string;
  catalyst: string | null;
  timestamp: string;
  exitDate: string | null;
}

interface GexBigGainersData {
  success: boolean;
  threshold: number;
  live: GexLivePlay[];
  closed: GexClosedPlay[];
}

/** Shared fetch for GEX big gainers — same query key wherever used, so
 *  the Today's Picks tabs share one cached result. */
export function useGexBigGainers() {
  return useQuery<GexBigGainersData>({
    queryKey: ['/api/gex/big-gainers'],
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

function contractLabel(p: { symbol: string; assetType: string; optionType: string | null; strikePrice: number | null; expiryDate: string | null }): string {
  if (p.assetType === 'option' && p.strikePrice) {
    const side = p.optionType ? p.optionType[0].toUpperCase() : '';
    return `${p.symbol} ${p.strikePrice}${side}`;
  }
  return p.symbol;
}

function GainRow({
  rank, label, direction, gain, sub, gainLabel,
}: {
  rank: number;
  label: string;
  direction: 'long' | 'short';
  gain: number | null;
  sub?: string | null;
  gainLabel?: string;
}) {
  const isShort = direction === 'short';
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40 last:border-0" data-testid={`gex-gainer-row-${rank}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] font-mono text-muted-foreground w-4 tabular-nums">{rank}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-mono font-semibold text-foreground truncate">{label}</span>
            <QEPill variant={isShort ? 'bear' : 'bull'} className="shrink-0">
              {isShort
                ? <TrendingDown className="w-2.5 h-2.5" />
                : <TrendingUp className="w-2.5 h-2.5" />}
              {isShort ? 'SHORT' : 'LONG'}
            </QEPill>
          </div>
          {sub && <div className="text-[10px] font-mono text-muted-foreground truncate">{sub}</div>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-mono font-bold tabular-nums text-[var(--trade-bullish)]">
          +{safeToFixed(gain, 1, '0.0')}%
        </div>
        {gainLabel && <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">{gainLabel}</div>}
      </div>
    </div>
  );
}

function Bucket({
  title, icon, accent, children, count,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  children: React.ReactNode;
  count: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={accent}>{icon}</span>
        <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">{title}</span>
        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">({count})</span>
      </div>
      {children}
    </div>
  );
}

export function GexBigGainers({ compact = false, bare = false }: { compact?: boolean; /** Render without the outer card — for embedding in Today's Picks tabs. */ bare?: boolean }) {
  const { data, isLoading } = useGexBigGainers();

  const liveLimit = compact ? 4 : 25;
  const closedLimit = compact ? 4 : 25;
  const live = (data?.live ?? []).slice(0, liveLimit);
  const closed = (data?.closed ?? []).slice(0, closedLimit);
  const hasNothing = !isLoading && live.length === 0 && closed.length === 0;

  const content = (
    <>
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-1.5">
        <Flame className="w-3.5 h-3.5 text-[var(--brand-cyan)]" />
        <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-foreground">GEX Big Gainers</span>
      </div>
      {data && (
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {data.threshold > 0 ? `≥${safeToFixed(data.threshold, 0, '0')}%` : 'top movers'}
        </span>
      )}
    </div>

    {isLoading && (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    )}

    {hasNothing && (
      <InlineEmptyState message="No GEX gainers tracked yet — check back once plays start running." />
    )}

    {!isLoading && !hasNothing && (
      <div className={cn('grid gap-4', !compact && 'md:grid-cols-2')}>
        <Bucket
          title="Running Now"
          icon={<Flame className="w-3 h-3" />}
          accent="text-[var(--trade-neutral)]"
          count={live.length}
        >
          {live.length === 0
            ? <InlineEmptyState message="Nothing running hot right now." />
            : live.map((p, i) => (
                <GainRow
                  key={p.id}
                  rank={i + 1}
                  label={contractLabel(p)}
                  direction={p.direction}
                  gain={p.peakGain}
                  gainLabel="peak"
                  sub={p.rationale}
                />
              ))}
        </Bucket>

        <Bucket
          title="Hall of Fame"
          icon={<Trophy className="w-3 h-3" />}
          accent="text-[var(--brand-gold,#d4af37)]"
          count={closed.length}
        >
          {closed.length === 0
            ? <InlineEmptyState message="No closed winners yet." />
            : closed.map((p, i) => (
                <GainRow
                  key={p.id}
                  rank={i + 1}
                  label={contractLabel(p)}
                  direction={p.direction}
                  gain={p.percentGain}
                  gainLabel="realized"
                  sub={p.rationale}
                />
              ))}
        </Bucket>
      </div>
    )}
    
    </>
  );

  if (bare) {
    return <div data-testid="gex-big-gainers">{content}</div>;
  }

  return (
    <QECard variant={compact ? 'glass' : 'default'} padding={compact ? 'sm' : 'md'} data-testid="gex-big-gainers">
      {content}
    </QECard>
  );
}
