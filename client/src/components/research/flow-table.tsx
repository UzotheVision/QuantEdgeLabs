/**
 * FlowTable — Flowseeker-style live options flow table for ONE symbol.
 *
 * Columns (mirrors Flowseeker reference):
 *   DATE/TIME · STRIKE · C/P · OTM% · EXP · DTE · PRICE · SPREAD · SIDE · SENT · SIZE · CHAIN RATIO · PREM
 *
 * Filters above the table:
 *   Flow type (all / sweep / block / unusual_volume)
 *   Sentiment (all / bull / bear / neutral)
 *   Min premium ($)
 *
 * Row actions:
 *   Click row → drawer (next sprint) with Contract Drilldown
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QECard } from '@/components/ui/qe-card';
import { QEStat, QEStatStrip } from '@/components/ui/qe-stat';
import { QEPill } from '@/components/ui/qe-pill';
import { QEBar } from '@/components/ui/qe-bar';
import { QESection } from '@/components/ui/qe-section';
import { QETabs, type QETabItem } from '@/components/ui/qe-tabs';
import { ContractAnalyzer } from '@/components/contract-analyzer';

interface FlowTrade {
  id: string;
  symbol: string;
  optionType: 'call' | 'put';
  strikePrice: number;
  expirationDate: string;
  volume: number;
  openInterest: number | null;
  volumeOIRatio: number | null;
  premium: number;
  totalPremium: number;
  impliedVolatility: number | null;
  delta: number | null;
  underlyingPrice: number | null;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  flowType: 'block' | 'sweep' | 'unusual_volume' | 'dark_pool' | 'normal';
  unusualScore: number;
  detectedAt: string;
}

interface FlowStats {
  totalTrades: number;
  totalValue: number;
  callCount: number;
  putCount: number;
  callPutRatio: number;
}

interface FlowResponse {
  trades: FlowTrade[];
  stats: FlowStats;
  pagination: { limit: number; offset: number; total: number };
}

type FlowTypeFilter = 'all' | 'sweep' | 'block' | 'unusual_volume' | 'dark_pool';
type SentimentFilter = 'all' | 'bullish' | 'bearish' | 'neutral';

const FLOW_TYPES: readonly QETabItem<FlowTypeFilter>[] = [
  { id: 'all',             label: 'All' },
  { id: 'sweep',           label: 'Sweeps' },
  { id: 'block',           label: 'Blocks' },
  { id: 'unusual_volume',  label: 'Unusual' },
  { id: 'dark_pool',       label: 'Dark Pool' },
];

const SENTIMENT_TYPES: readonly QETabItem<SentimentFilter>[] = [
  { id: 'all',      label: 'All' },
  { id: 'bullish',  label: 'Bull' },
  { id: 'bearish',  label: 'Bear' },
  { id: 'neutral',  label: 'Neut' },
];

interface FlowTableProps {
  symbol: string;
}

export function FlowTable({ symbol }: FlowTableProps) {
  const [flowType, setFlowType] = useState<FlowTypeFilter>('all');
  const [sentiment, setSentiment] = useState<SentimentFilter>('all');
  const [minPremium, setMinPremium] = useState(0);
  const [days, setDays] = useState(7);
  // Selected trade → opens ContractAnalyzer panel (Bullflow-style row drilldown)
  const [selectedTrade, setSelectedTrade] = useState<FlowTrade | null>(null);

  const params = new URLSearchParams({
    symbol,
    days: String(days),
    limit: '100',
  });
  if (flowType !== 'all') params.set('flowType', flowType);
  if (sentiment !== 'all') params.set('sentiment', sentiment);
  if (minPremium > 0) params.set('minPremium', String(minPremium));

  const { data, isLoading, isFetching, error, refetch } = useQuery<FlowResponse>({
    queryKey: ['/api/options-flow', symbol, flowType, sentiment, minPremium, days],
    queryFn: async () => {
      const res = await fetch(`/api/options-flow?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Flow fetch failed (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: !!symbol,
  });

  const trades = data?.trades ?? [];
  const stats = data?.stats;

  return (
    <div className="space-y-3">
      {/* STATS STRIP */}
      <QECard variant="default" padding="md">
        <QEStatStrip stats={[
          { label: 'TOTAL FLOWS', value: stats?.totalTrades ?? '—' },
          { label: 'TOTAL VALUE', value: stats?.totalValue ? formatMoney(stats.totalValue) : '—' },
          { label: 'CALLS', value: stats?.callCount ?? 0, tone: 'bull' },
          { label: 'PUTS', value: stats?.putCount ?? 0, tone: 'bear' },
          { label: 'C/P RATIO', value: stats?.callPutRatio?.toFixed(2) ?? '—', tone: (stats?.callPutRatio ?? 1) >= 1 ? 'bull' : 'bear' },
          { label: 'WINDOW', value: `${days}d` },
        ]} />
      </QECard>

      {/* FILTERS */}
      <div className="space-y-2">
        <QETabs items={FLOW_TYPES}     active={flowType}   onChange={setFlowType}   prefixLabel="TYPE" variant="cyan" />
        <QETabs items={SENTIMENT_TYPES} active={sentiment} onChange={setSentiment} prefixLabel="SENT" variant="gold" />

        <div className="flex items-center gap-3 flex-wrap pb-1 border-b border-border/30">
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
            <Filter className="w-3 h-3 inline mr-1" /> FILTERS
          </span>

          {/* Min premium */}
          <label className="flex items-center gap-1.5 text-[10px] font-mono">
            <span className="text-muted-foreground">Min $</span>
            <input
              type="number"
              value={minPremium || ''}
              onChange={e => setMinPremium(Math.max(0, Number(e.target.value) || 0))}
              placeholder="0"
              className="w-20 px-2 py-0.5 bg-card border border-border rounded text-foreground tabular-nums focus:border-[var(--brand-cyan)]/50 outline-none"
            />
          </label>

          {/* Days window */}
          <label className="flex items-center gap-1.5 text-[10px] font-mono">
            <span className="text-muted-foreground">Days</span>
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="px-2 py-0.5 bg-card border border-border rounded text-foreground cursor-pointer focus:border-[var(--brand-cyan)]/50 outline-none"
            >
              <option value={1}>1</option>
              <option value={3}>3</option>
              <option value={7}>7</option>
              <option value={14}>14</option>
              <option value={30}>30</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="ml-auto p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin text-[var(--brand-cyan)]')} />
          </button>
        </div>
      </div>

      {/* TABLE */}
      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--brand-cyan)]" />
        </div>
      )}

      {error && !isLoading && (
        <QECard variant="accent-bear" padding="md" className="text-center text-[10px] font-mono text-[var(--trade-bearish)]">
          FLOW FETCH FAILED — {(error as Error).message}
        </QECard>
      )}

      {!isLoading && !error && trades.length === 0 && (
        <QECard variant="default" padding="lg" className="text-center text-[10px] font-mono text-muted-foreground">
          No options flow detected for {symbol} in the last {days}d
          {flowType !== 'all' && <> · type={flowType}</>}
          {sentiment !== 'all' && <> · sent={sentiment}</>}
          {minPremium > 0 && <> · min ${minPremium.toLocaleString()}</>}
        </QECard>
      )}

      {!isLoading && trades.length > 0 && (
        <QECard variant="default" padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-mono border-collapse min-w-max">
              <thead className="sticky top-0 z-10 bg-muted/30 border-b border-border">
                <tr className="text-[9px] uppercase tracking-widest text-muted-foreground">
                  <Th>Time</Th>
                  <Th>Strike</Th>
                  <Th>C/P</Th>
                  <Th>OTM%</Th>
                  <Th>Exp</Th>
                  <Th>DTE</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Spot</Th>
                  <Th>Type</Th>
                  <Th>Sent</Th>
                  <Th align="right">Size</Th>
                  <Th align="right">V/OI</Th>
                  <Th align="right">Premium</Th>
                </tr>
              </thead>
              <tbody>
                {trades.map(t => (
                  <FlowRow
                    key={t.id}
                    t={t}
                    onClick={() => setSelectedTrade(t)}
                    isSelected={selectedTrade?.id === t.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </QECard>
      )}

      {/* Bullflow-style row drilldown — analyzer panel slides in when a row is clicked */}
      {selectedTrade && (
        <ContractAnalyzer
          key={selectedTrade.id}
          initialInput={`${selectedTrade.symbol} ${selectedTrade.strikePrice}${selectedTrade.optionType === 'call' ? 'C' : 'P'} ${selectedTrade.expirationDate} @ ${selectedTrade.premium}`}
          onClose={() => setSelectedTrade(null)}
        />
      )}
    </div>
  );
}

// ─── Row + cells ────────────────────────────────────────────────────

function FlowRow({ t, onClick, isSelected }: { t: FlowTrade; onClick?: () => void; isSelected?: boolean }) {
  const isCall = t.optionType === 'call';
  const cpTone = isCall ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]';
  const sentVariant =
    t.sentiment === 'bullish' ? 'bull' :
    t.sentiment === 'bearish' ? 'bear' : 'default';
  const flowVariant =
    t.flowType === 'sweep' ? 'cyan' :
    t.flowType === 'block' ? 'gold' :
    t.flowType === 'unusual_volume' ? 'warn' :
    t.flowType === 'dark_pool' ? 'ai' : 'default';

  const dte = daysTo(t.expirationDate);
  const otmPct = t.underlyingPrice && t.strikePrice
    ? ((t.strikePrice - t.underlyingPrice) / t.underlyingPrice) * 100
    : 0;

  return (
    <tr
      onClick={onClick}
      className={cn(
        'border-b border-border/30 hover:bg-muted/20 transition-colors cursor-pointer',
        isSelected && 'bg-[var(--brand-cyan)]/10 border-[var(--brand-cyan)]/40',
      )}
    >
      <Td className="text-muted-foreground tabular-nums">{fmtTime(t.detectedAt)}</Td>
      <Td className="font-bold text-foreground tabular-nums">${t.strikePrice}</Td>
      <Td><span className={cn('font-bold', cpTone)}>{isCall ? 'CALL' : 'PUT'}</span></Td>
      <Td className={cn('tabular-nums', otmPct >= 0 ? 'text-[var(--trade-neutral)]' : 'text-muted-foreground')}>
        {otmPct >= 0 ? '+' : ''}{otmPct.toFixed(1)}%
      </Td>
      <Td className="text-muted-foreground tabular-nums">{fmtExp(t.expirationDate)}</Td>
      <Td className="tabular-nums text-muted-foreground">{dte}d</Td>
      <Td align="right" className="text-foreground tabular-nums">${t.premium.toFixed(2)}</Td>
      <Td align="right" className="text-muted-foreground tabular-nums">{t.underlyingPrice ? `$${t.underlyingPrice.toFixed(2)}` : '—'}</Td>
      <Td><QEPill variant={flowVariant}>{t.flowType.replace('_', ' ')}</QEPill></Td>
      <Td><QEPill variant={sentVariant}>{t.sentiment.slice(0, 4)}</QEPill></Td>
      <Td align="right" className="font-bold text-foreground tabular-nums">{t.volume.toLocaleString()}</Td>
      <Td align="right" className={cn('tabular-nums', (t.volumeOIRatio ?? 0) >= 2 ? 'text-[var(--brand-cyan)] font-bold' : 'text-muted-foreground')}>
        {t.volumeOIRatio ? `${t.volumeOIRatio.toFixed(1)}x` : '—'}
      </Td>
      <Td align="right" className="font-bold text-[var(--brand-gold)] tabular-nums">{formatMoney(t.totalPremium)}</Td>
    </tr>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={cn('px-2 py-1.5 font-medium', align === 'right' ? 'text-right' : 'text-left')}>
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td className={cn('px-2 py-1.5 whitespace-nowrap', align === 'right' && 'text-right', className)}>
      {children}
    </td>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function formatMoney(usd: number): string {
  if (!usd && usd !== 0) return '—';
  const abs = Math.abs(usd);
  const sign = usd < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function fmtExp(iso: string): string {
  // YYYY-MM-DD → MM/DD/YY
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${m}/${dd}/${yy}`;
}

function daysTo(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((t - Date.now()) / 86_400_000));
}
