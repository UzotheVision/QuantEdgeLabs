/**
 * POSITION HEAT MAP PAGE
 * ======================
 * Live view of all your open trade ideas with P&L-colored tiles.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────┐
 *   │  HERO: NET OPEN P&L (+ absolute)                     │
 *   │  STRIP: POSITIONS | WIN RATE | HOT | COLD            │
 *   ├──────────────────────────────────────────────────────┤
 *   │  HEATMAP (size = |heat score|, color = heat rank)    │
 *   │  ┌──────┬──────┬─────┬─────┐                          │
 *   │  │ NOK  │ QCOM │ MP  │BB   │                          │
 *   │  │+47%🔥│+24%🔥│+18%│+8%  │                          │
 *   │  ├──────┼──────┴─────┼─────┤                          │
 *   │  │SOUN  │AAPL  -3%   │SNAP │                          │
 *   │  │+12%  │            │-15% │                          │
 *   │  └──────┴────────────┴─────┘                          │
 *   ├──────────────────────────────────────────────────────┤
 *   │  POSITIONS TABLE (sortable, clickable)               │
 *   └──────────────────────────────────────────────────────┘
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { CacheFreshnessIndicator } from '@/components/gex/CacheFreshnessIndicator';
import { SkeletonLoader } from '@/components/gex/SkeletonLoader';
import { ExpandableCard } from '@/components/expandable-card';
import { componentStyles } from '@/lib/design-tokens';

interface LivePosition {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  assetType: string;
  entry: number;
  spot: number | null;
  target: number;
  stop: number;
  pnlPct: number;
  pnlAbs: number;
  daysActive: number;
  source: string;
  status: string;
  daysToExpiry?: number | null;
  isOption: boolean;
  strikePrice?: number | null;
  optionType?: string | null;
  heatScore: number;
  heatRank: 'fire' | 'hot' | 'warm' | 'cool' | 'frozen' | 'red';
}

interface Summary {
  total: number;
  winners: number;
  losers: number;
  totalPnLPct: number;
  totalPnLAbs: number;
  hotCount: number;
  coldCount: number;
  bestPosition: LivePosition | null;
  worstPosition: LivePosition | null;
  bySource: Record<string, number>;
  byAssetType: Record<string, number>;
}

interface PositionsResponse {
  asOf: string;
  summary: Summary;
  positions: LivePosition[];
}

const HEAT_BG: Record<LivePosition['heatRank'], string> = {
  fire: 'bg-[var(--trade-bullish)]/30 border-[var(--trade-bullish)]/60',
  hot: 'bg-[var(--trade-bullish)]/15 border-[var(--trade-bullish)]/40',
  warm: 'bg-[var(--brand-cyan)]/10 border-[var(--brand-cyan)]/30',
  cool: 'bg-muted/30 border-border/50',
  frozen: 'bg-[var(--trade-neutral)]/15 border-[var(--trade-neutral)]/40',
  red: 'bg-[var(--trade-bearish)]/30 border-[var(--trade-bearish)]/60'
};

const HEAT_LABEL: Record<LivePosition['heatRank'], string> = {
  fire: '🔥 FIRE',
  hot: '🔥 HOT',
  warm: '↑ WARM',
  cool: '— COOL',
  frozen: '↓ COLD',
  red: '🛑 RED'
};

export default function PositionsHeatmapPage() {
  const [sortBy, setSortBy] = useState<'pnl' | 'days' | 'expiry'>('pnl');
  const [heatShown, setHeatShown] = useState(24); // heat tiles cap

  const { data, isLoading, isError, refetch, isFetching } = useQuery<PositionsResponse>({
    queryKey: ['positions-live'],
    queryFn: async () => {
      const res = await fetch('/api/positions/live');
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          <SkeletonLoader variant="header" />
          <SkeletonLoader variant="grid" count={1} />
          <SkeletonLoader variant="card" count={3} />
        </div>
      </div>
    );
  }

  // Fetch failure is NOT an empty portfolio — show an honest error, never
  // "no positions" on a broken feed.
  if (isError || (!isLoading && !data)) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-4">Position Heat Map</h1>
          <div className={`${componentStyles.card.default} p-12 text-center`}>
            <div className="text-5xl mb-3">⚠️</div>
            <div className="text-xl font-bold mb-2">Couldn't load positions</div>
            <div className="text-sm text-muted-foreground mb-4">
              The positions feed failed — your portfolio may be fine, this is a data issue.
            </div>
            <button onClick={() => refetch()} className={componentStyles.button.compact}>
              ↻ Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Genuine empty portfolio — reads as empty, not broken.
  // (The `!data` arm is unreachable after the error branch above, but it
  // keeps TS narrowing `data` to defined for the rest of the render.)
  if (!data || data.summary.total === 0) {
    return (
      <div className="min-h-screen bg-background text-foreground p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold mb-4">Position Heat Map</h1>
          <div className={`${componentStyles.card.default} p-12 text-center`}>
            <div className="text-5xl mb-3">🎯</div>
            <div className="text-xl font-bold mb-2">No open positions</div>
            <div className="text-sm text-muted-foreground mb-4">
              Go to Trade Desk or Discovery to start tracking positions.
            </div>
            <Link href="/t">
              <button className="px-4 py-2 bg-[var(--brand-cyan)]/10 border border-[var(--brand-cyan)]/30 rounded text-[var(--brand-cyan)] hover:bg-[var(--brand-cyan)]/20">
                Open Discovery →
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const positions = sortPositions(data.positions, sortBy);

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">🔥 Position Heat Map</h1>
            <CacheFreshnessIndicator asOf={data.asOf} />
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className={componentStyles.button.compact}
          >
            {isFetching ? '...' : '↻ Refresh'}
          </button>
        </div>

        {/* Hero — the single decision number: total open P&L. Winner/loser
            counts are folded into win rate below; nothing is shown twice. */}
        <div className={`${componentStyles.card.default} p-5 mb-3`}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Net open P&L</div>
          <div className={`text-4xl font-bold font-mono tabular-nums ${data.summary.totalPnLPct >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}`}>
            {data.summary.totalPnLPct >= 0 ? '+' : ''}{data.summary.totalPnLPct}%
          </div>
          <div className="text-xs text-muted-foreground mt-1 font-mono tabular-nums">
            {data.summary.totalPnLAbs >= 0 ? '+' : ''}${data.summary.totalPnLAbs} absolute
          </div>
        </div>

        {/* Supporting strip — compact, secondary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <KPI label="POSITIONS" value={data.summary.total.toString()} accent="cyan" />
          <KPI label="WIN RATE" value={`${Math.round((data.summary.winners / data.summary.total) * 100)}%`} accent={data.summary.winners / data.summary.total >= 0.5 ? 'emerald' : 'amber'} />
          <KPI label="🔥 HOT" value={data.summary.hotCount.toString()} accent="emerald" />
          <KPI label="🛑 COLD" value={data.summary.coldCount.toString()} accent="red" />
        </div>

        {/* Best vs Worst — collapsible (default open if extreme) */}
        {data.summary.bestPosition && data.summary.worstPosition && (
          <ExpandableCard
            title="Best vs Worst"
            subtitle={`🏆 ${data.summary.bestPosition.symbol} ${data.summary.bestPosition.pnlPct >= 0 ? '+' : ''}${data.summary.bestPosition.pnlPct}% · ⚠️ ${data.summary.worstPosition.symbol} ${data.summary.worstPosition.pnlPct}%`}
            defaultOpen={Math.abs(data.summary.bestPosition.pnlPct) > 30 || Math.abs(data.summary.worstPosition.pnlPct) > 20}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <BestWorstCard position={data.summary.bestPosition} type="best" />
              <BestWorstCard position={data.summary.worstPosition} type="worst" />
            </div>
          </ExpandableCard>
        )}

        {/* HEAT TREEMAP — default open */}
        <ExpandableCard
          title="🔥 Heat Map"
          subtitle="tile size = |heat score| · tile color = heat rank"
          defaultOpen
        >
          <HeatLegend />
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2">
            {positions.slice(0, heatShown).map(p => (
              <HeatTile key={p.id} position={p} />
            ))}
          </div>
          {positions.length > 24 && (
            <button
              onClick={() => setHeatShown(heatShown >= positions.length ? 24 : positions.length)}
              className="mt-3 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              {heatShown >= positions.length
                ? 'Show less ↑'
                : `Show ${positions.length - heatShown} more ↓`}
            </button>
          )}
        </ExpandableCard>

        {/* Positions Table — COLLAPSED by default */}
        <ExpandableCard
          title="Detail Table"
          subtitle={`Sorted by ${sortBy} · click row → ticker chart`}
          defaultOpen={false}
        >
          <DetailTable positions={positions} sortBy={sortBy} setSortBy={setSortBy} />
        </ExpandableCard>
      </div>
      {/* EngineStatusFooter removed 2026-09-24: third status bar under the shell's own; fake uptime/engine labels */}
    </div>
  );
}

function DetailTable({ positions, sortBy, setSortBy }: { positions: LivePosition[]; sortBy: 'pnl' | 'days' | 'expiry'; setSortBy: (s: 'pnl' | 'days' | 'expiry') => void; }) {
  const [rowsShown, setRowsShown] = useState(30);
  return (
    <div>
      <div className="flex items-center justify-end mb-3 gap-1">
        {(['pnl', 'days', 'expiry'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`text-[10px] px-2 py-1 rounded ${
              sortBy === s ? 'bg-[var(--brand-cyan)]/20 text-[var(--brand-cyan)]' : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
          >
            Sort: {s}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2 pr-3">Symbol</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3" title="Direction: long or short">Dir</th>
              <th className="py-2 pr-3 text-right">Entry</th>
              <th className="py-2 pr-3 text-right">Spot</th>
              <th className="py-2 pr-3 text-right">Target</th>
              <th className="py-2 pr-3 text-right">Stop</th>
              <th className="py-2 pr-3 text-right">P&L %</th>
              <th className="py-2 pr-3 text-right">P&L $</th>
              <th className="py-2 pr-3 text-center">Days</th>
              <th className="py-2 pr-3 text-center" title="Days to expiry (options only)">DTE</th>
              <th className="py-2 pr-3" title="Heat rank — momentum score bucket, see Heat Map legend">Heat</th>
              <th className="py-2 pr-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {positions.slice(0, rowsShown).map(p => (
              <PositionRow key={p.id} position={p} />
            ))}
          </tbody>
        </table>
      </div>
      {positions.length > 30 && (
        <button
          onClick={() => setRowsShown(rowsShown >= positions.length ? 30 : positions.length)}
          className="mt-3 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          {rowsShown >= positions.length
            ? 'Show less ↑'
            : `Show ${positions.length - rowsShown} more ↓`}
        </button>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function KPI({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-[var(--trade-bullish)]',
    red: 'text-[var(--trade-bearish)]',
    cyan: 'text-[var(--brand-cyan)]',
    amber: 'text-[var(--trade-neutral)]'
  };
  return (
    <div className={`${componentStyles.card.default} p-3`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${colorMap[accent] || 'text-foreground'}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// The single canonical legend for the heatmap intensity scale.
const HEAT_RANK_TIP: Record<LivePosition['heatRank'], string> = {
  fire: 'FIRE — strongest positive momentum',
  hot: 'HOT — strong positive momentum',
  warm: 'WARM — mild positive momentum',
  cool: 'COOL — flat / neutral',
  frozen: 'COLD — negative momentum',
  red: 'RED — strongest negative momentum',
};

function HeatLegend() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3">
      {(Object.keys(HEAT_BG) as LivePosition['heatRank'][]).map(rank => (
        <span
          key={rank}
          title={HEAT_RANK_TIP[rank]}
          className={`border rounded px-2 py-0.5 text-[10px] font-mono cursor-help ${HEAT_BG[rank]}`}
        >
          {HEAT_LABEL[rank]}
        </span>
      ))}
    </div>
  );
}

function HeatTile({ position }: { position: LivePosition }) {
  const bg = HEAT_BG[position.heatRank];
  const sizeClass =
    Math.abs(position.heatScore) > 30 ? 'col-span-2 row-span-2' :
    Math.abs(position.heatScore) > 15 ? 'col-span-2' :
    '';

  return (
    <Link href={`/r/${position.symbol}`}>
      <div className={`border rounded p-3 hover:border-[var(--brand-cyan)]/50 transition-colors cursor-pointer ${bg} ${sizeClass}`}>
        <div className="flex items-center justify-between mb-1">
          <span className="font-bold">{position.symbol}</span>
          <span className="text-[9px] opacity-70">{HEAT_LABEL[position.heatRank]}</span>
        </div>
        <div className={`text-xl font-bold font-mono ${position.pnlPct >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}`}>
          {position.pnlPct >= 0 ? '+' : ''}{position.pnlPct}%
        </div>
        <div className="text-[10px] opacity-60 mt-1">
          {position.isOption ? `${position.strikePrice}${position.optionType?.[0]?.toUpperCase()}` : 'Stock'} · {position.daysActive}d
        </div>
      </div>
    </Link>
  );
}

function BestWorstCard({ position, type }: { position: LivePosition; type: 'best' | 'worst' }) {
  return (
    <div className={`p-4 ${type === 'best' ? componentStyles.card.accentBullish : componentStyles.card.accentBearish}`}>
      <div className="text-[10px] uppercase tracking-wider mb-2 text-muted-foreground">
        {type === 'best' ? '🏆 Best Position' : '⚠️ Worst Position'}
      </div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-bold">{position.symbol}</div>
          <div className="text-xs text-muted-foreground">
            {position.isOption ? `$${position.strikePrice} ${position.optionType?.toUpperCase()}` : 'Shares'} · {position.daysActive}d in
          </div>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold ${position.pnlPct >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}`}>
            {position.pnlPct >= 0 ? '+' : ''}{position.pnlPct}%
          </div>
          <div className="text-xs text-muted-foreground">
            ${position.pnlAbs >= 0 ? '+' : ''}{position.pnlAbs}
          </div>
        </div>
      </div>
    </div>
  );
}

function PositionRow({ position }: { position: LivePosition }) {
  const heatColor =
    position.heatRank === 'fire' ? 'text-[var(--trade-bullish)]' :
    position.heatRank === 'hot' ? 'text-[var(--trade-bullish)]' :
    position.heatRank === 'warm' ? 'text-[var(--brand-cyan)]' :
    position.heatRank === 'cool' ? 'text-muted-foreground' :
    position.heatRank === 'frozen' ? 'text-[var(--trade-neutral)]' :
    'text-[var(--trade-bearish)]';

  return (
    <tr className="border-b border-border/50 hover:bg-muted/20">
      <td className="py-2 pr-3 font-bold">
        <Link href={`/r/${position.symbol}`}>
          <span className="hover:text-[var(--brand-cyan)] cursor-pointer">{position.symbol}</span>
        </Link>
      </td>
      <td className="py-2 pr-3 text-muted-foreground">
        {position.isOption ? `${position.optionType?.[0]?.toUpperCase()} $${position.strikePrice}` : 'Stk'}
      </td>
      <td className={`py-2 pr-3 ${position.direction === 'long' ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}`}>
        {position.direction === 'long' ? '▲' : '▼'}
      </td>
      <td className="py-2 pr-3 text-right font-mono">${position.entry.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right font-mono">{position.spot ? `$${position.spot.toFixed(2)}` : '—'}</td>
      <td className="py-2 pr-3 text-right font-mono text-[var(--trade-bullish)]">${position.target.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right font-mono text-[var(--trade-bearish)]">${position.stop.toFixed(2)}</td>
      <td className={`py-2 pr-3 text-right font-mono font-bold ${position.pnlPct >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}`}>
        {position.pnlPct >= 0 ? '+' : ''}{position.pnlPct}%
      </td>
      <td className={`py-2 pr-3 text-right font-mono ${position.pnlAbs >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}`}>
        ${position.pnlAbs >= 0 ? '+' : ''}{position.pnlAbs}
      </td>
      <td className="py-2 pr-3 text-center text-muted-foreground">{position.daysActive}d</td>
      <td className="py-2 pr-3 text-center text-muted-foreground">{position.daysToExpiry !== null && position.daysToExpiry !== undefined ? `${position.daysToExpiry}d` : '—'}</td>
      <td className={`py-2 pr-3 ${heatColor}`}>{HEAT_LABEL[position.heatRank]}</td>
      <td className="py-2 pr-3 text-muted-foreground text-[10px]">{position.source}</td>
    </tr>
  );
}

function sortPositions(positions: LivePosition[], by: 'pnl' | 'days' | 'expiry'): LivePosition[] {
  const sorted = [...positions];
  if (by === 'pnl') sorted.sort((a, b) => b.pnlPct - a.pnlPct);
  else if (by === 'days') sorted.sort((a, b) => b.daysActive - a.daysActive);
  else if (by === 'expiry') sorted.sort((a, b) => (a.daysToExpiry ?? 9999) - (b.daysToExpiry ?? 9999));
  return sorted;
}
