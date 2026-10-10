import { useState, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  TrendingUp, TrendingDown, Target, Clock, Brain, AlertTriangle,
  BarChart3, Flame, Snowflake, Award, ChevronDown, ChevronUp,
  Activity, Zap, PieChart, Calendar, ArrowUpRight, ArrowDownRight,
  Trophy, ShieldAlert, Timer, Lightbulb, Eye, Star, Ban,
  Upload, FileText, Plus, X, Check, Trash2, Download, LineChart,
} from 'lucide-react';
import PositionPnLSimulator, { type SimPosition } from '@/components/position-pnl-simulator';

// ─── Types ──────────────────────────────────────────────────

interface PerformanceMetrics {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  avgRR: number;
  currentStreak: { type: 'win' | 'loss'; count: number };
  bestStreak: number;
  worstStreak: number;
  avgHoldMinutes: number;
  expectancy: number;
}

interface TimingInsight {
  label: string;
  trades: number;
  winRate: number;
  avgPnL: number;
  grade: 'hot' | 'warm' | 'neutral' | 'cold';
}

interface BehaviorInsight {
  id: string;
  category: string;
  severity: 'positive' | 'neutral' | 'warning' | 'critical';
  title: string;
  description: string;
  metric?: string;
  suggestion?: string;
  icon: string;
}

interface TickerBreakdown {
  symbol: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
}

interface SetupBreakdown {
  source: string;
  label: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface PnLPoint {
  date: string;
  cumulativePnL: number;
  tradePnL: number;
  symbol: string;
  outcome: string;
}

interface TradeRecord {
  id: string;
  symbol: string;
  direction: string;
  assetType: string;
  optionType?: string | null;
  strikePrice?: number | null;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  exitPrice?: number | null;
  riskRewardRatio: number;
  realizedPnL?: number | null;
  percentGain?: number | null;
  outcomeStatus: string;
  source: string;
  holdingPeriod: string;
  timestamp: string;
  exitDate?: string | null;
  catalyst?: string | null;
  confidenceScore: number;
}

interface DTEBreakdown {
  label: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
}

interface DayOfWeekPnL {
  day: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  grade: 'hot' | 'warm' | 'neutral' | 'cold';
}

interface TradeCountBucket {
  label: string;
  days: number;
  avgPnL: number;
  totalPnL: number;
  winRate: number;
}

interface WeeklyPnL {
  week: string;
  startDate: string;
  endDate: string;
  trades: number;
  wins: number;
  totalPnL: number;
  cumulativePnL: number;
}

interface DrawdownMetrics {
  maxDrawdown: number;
  maxDrawdownPercent: number;
  currentDrawdown: number;
  peakEquity: number;
  recoveryTrades: number;
  drawdownPeriods: { start: string; end: string; depth: number }[];
}

interface EmotionAnalysis {
  emotion: string;
  trades: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface JournalAnalytics {
  metrics: PerformanceMetrics;
  pnlCurve: PnLPoint[];
  timingByHour: TimingInsight[];
  timingByDay: TimingInsight[];
  timingBySession: TimingInsight[];
  tickerBreakdown: TickerBreakdown[];
  setupBreakdown: SetupBreakdown[];
  insights: BehaviorInsight[];
  recentTrades: TradeRecord[];
  dteBreakdown: DTEBreakdown[];
  dayOfWeekPnL: DayOfWeekPnL[];
  tradeCountOptimum: TradeCountBucket[];
  weeklyPnL: WeeklyPnL[];
  drawdown: DrawdownMetrics;
  emotionAnalysis: EmotionAnalysis[];
}

interface JournalTradeRow {
  id: string;
  symbol: string;
  assetType: string;
  direction: string;
  optionType?: string | null;
  strikePrice?: number | null;
  expiryDate?: string | null;
  quantity: number;
  entryPrice: number;
  exitPrice?: number | null;
  fees?: number;
  entryTime: string;
  exitTime?: string | null;
  holdingMinutes?: number | null;
  realizedPnL?: number | null;
  realizedPnLPercent?: number | null;
  status: string;
  outcome?: string | null;
  notes?: string | null;
  emotion?: string | null;
  setupType?: string | null;
  mistakeTag?: string | null;
  rating?: number | null;
  broker: string;
  importBatchId?: string | null;
}

// ─── Helpers ────────────────────────────────────────────────

function formatPnL(v: number): string {
  const sign = v >= 0 ? '+' : '';
  if (Math.abs(v) >= 10000) return `${sign}$${(v / 1000).toFixed(1)}K`;
  if (Math.abs(v) >= 100) return `${sign}$${v.toFixed(0)}`;
  if (Math.abs(v) >= 1) return `${sign}$${v.toFixed(2)}`;
  return `${sign}$${v.toFixed(2)}`;
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins.toFixed(0)}m`;
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`;
  return `${(mins / 1440).toFixed(1)}d`;
}

const SEVERITY_STYLES = {
  positive: 'border-emerald-500/30 bg-emerald-500/5',
  neutral: 'border-zinc-500/30 bg-zinc-500/5',
  warning: 'border-amber-500/30 bg-amber-500/5',
  critical: 'border-red-500/30 bg-red-500/5',
} as const;

const SEVERITY_TEXT = {
  positive: 'text-[var(--trade-bullish)]',
  neutral: 'text-zinc-400',
  warning: 'text-amber-400',
  critical: 'text-[var(--trade-bearish)]',
} as const;

const GRADE_COLORS = {
  hot: 'bg-emerald-500/20 text-[var(--trade-bullish)]',
  warm: 'bg-amber-500/20 text-amber-400',
  neutral: 'bg-zinc-500/20 text-zinc-400',
  cold: 'bg-red-500/20 text-[var(--trade-bearish)]',
} as const;

const BROKERS = [
  { value: '', label: 'Auto-detect' },
  { value: 'webull', label: 'Webull' },
  { value: 'robinhood', label: 'Robinhood' },
  { value: 'schwab', label: 'Schwab' },
  { value: 'ibkr', label: 'Interactive Brokers' },
  { value: 'tastytrade', label: 'tastytrade' },
  { value: 'tda', label: 'TD Ameritrade' },
  { value: 'fidelity', label: 'Fidelity' },
  { value: 'etrade', label: 'E*TRADE' },
] as const;

const EMOTIONS = [
  { value: 'confident', label: 'Confident', color: 'text-[var(--trade-bullish)]' },
  { value: 'disciplined', label: 'Disciplined', color: 'text-blue-400' },
  { value: 'neutral', label: 'Neutral', color: 'text-zinc-400' },
  { value: 'fearful', label: 'Fearful', color: 'text-amber-400' },
  { value: 'fomo', label: 'FOMO', color: 'text-orange-400' },
  { value: 'greedy', label: 'Greedy', color: 'text-[var(--trade-bearish)]' },
  { value: 'revenge', label: 'Revenge', color: 'text-[var(--trade-bearish)]' },
] as const;

// ─── Components ─────────────────────────────────────────────

function StatCard({ label, value, subValue, icon: Icon, color, tooltip }: {
  label: string;
  value: string;
  subValue?: string;
  icon: typeof TrendingUp;
  color: string;
  tooltip?: string;
}) {
  return (
    <div className="bg-card border border-border/50 rounded-xl p-4 hover:border-border transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span
          className={cn("text-[11px] text-muted-foreground uppercase tracking-wider font-medium", tooltip && "cursor-help")}
          title={tooltip}
        >{label}</span>
        <Icon className={cn("w-4 h-4", color)} />
      </div>
      <div className={cn("text-2xl font-bold tabular-nums", color)}>{value}</div>
      {subValue && <div className="text-[11px] text-muted-foreground mt-1">{subValue}</div>}
    </div>
  );
}

function PnLCurveChart({ data }: { data: PnLPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
        No closed trades yet — P&L curve will appear as you close positions.
      </div>
    );
  }

  const maxPnL = Math.max(...data.map(d => d.cumulativePnL), 0);
  const minPnL = Math.min(...data.map(d => d.cumulativePnL), 0);
  const range = maxPnL - minPnL || 1;
  const h = 180;
  const w = 100;

  const points = data.map((d, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * w;
    const y = h - ((d.cumulativePnL - minPnL) / range) * (h - 20) - 10;
    return `${x},${y}`;
  }).join(' ');

  const lastPnL = data[data.length - 1]?.cumulativePnL || 0;
  const isPositive = lastPnL >= 0;

  return (
    <div className="relative h-48">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
        <line
          x1="0" x2={w}
          y1={h - ((-minPnL) / range) * (h - 20) - 10}
          y2={h - ((-minPnL) / range) * (h - 20) - 10}
          stroke="var(--border)" strokeWidth="0.3" strokeDasharray="2,2"
        />
        <polygon
          points={`0,${h} ${points} ${w},${h}`}
          fill={isPositive ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'}
        />
        <polyline
          points={points}
          fill="none"
          stroke={isPositive ? '#10b981' : '#ef4444'}
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="absolute top-2 left-3">
        <span className="text-[10px] text-muted-foreground">{data.length} trades</span>
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: BehaviorInsight }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "border rounded-xl p-4 cursor-pointer transition-all hover:shadow-md",
        SEVERITY_STYLES[insight.severity],
      )}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{insight.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className={cn("font-semibold text-sm", SEVERITY_TEXT[insight.severity])}>
              {insight.title}
            </h4>
            {insight.metric && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground font-mono">
                {insight.metric}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{insight.description}</p>
          {expanded && insight.suggestion && (
            <div className="mt-3 p-3 rounded-lg bg-white/5 border border-white/10">
              <div className="flex items-center gap-1.5 mb-1">
                <Lightbulb className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] font-semibold text-amber-400 uppercase">Suggestion</span>
              </div>
              <p className="text-xs text-foreground/80">{insight.suggestion}</p>
            </div>
          )}
        </div>
        {insight.suggestion && (
          expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </div>
    </div>
  );
}

function TimingHeatmap({ data, label }: { data: TimingInsight[]; label: string }) {
  if (data.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5" /> {label}
      </h3>
      <div className="space-y-1.5">
        {data.map((t) => (
          <div key={t.label} className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground w-24 shrink-0 tabular-nums">{t.label}</span>
            <div className="flex-1 h-6 bg-white/5 rounded overflow-hidden relative">
              <div
                className={cn("h-full rounded transition-all",
                  t.grade === 'hot' ? 'bg-emerald-500/30' :
                  t.grade === 'warm' ? 'bg-amber-500/30' :
                  t.grade === 'cold' ? 'bg-red-500/30' : 'bg-zinc-500/20'
                )}
                style={{ width: `${Math.min(t.winRate, 100)}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-between px-2">
                <span className="text-[10px] font-medium text-foreground/80">{t.winRate}% WR</span>
                <span className="text-[10px] text-muted-foreground">{t.trades} trades</span>
              </div>
            </div>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium w-14 text-center", GRADE_COLORS[t.grade])}>
              {t.grade === 'hot' ? 'HOT' : t.grade === 'warm' ? 'WARM' : t.grade === 'cold' ? 'COLD' : 'EVEN'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TickerTable({ data }: { data: TickerBreakdown[] }) {
  if (data.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/50">
            <th className="text-left py-2 text-muted-foreground font-medium">SYMBOL</th>
            <th className="text-center py-2 text-muted-foreground font-medium">TRADES</th>
            <th className="text-center py-2 text-muted-foreground font-medium">WIN RATE</th>
            <th className="text-right py-2 text-muted-foreground font-medium">TOTAL P&L</th>
            <th className="text-right py-2 text-muted-foreground font-medium">AVG P&L</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 15).map((t) => (
            <tr key={t.symbol} className="border-b border-border/30 hover:bg-white/5 transition-colors">
              <td className="py-2 font-semibold text-foreground">{t.symbol}</td>
              <td className="py-2 text-center text-muted-foreground">{t.trades}</td>
              <td className="py-2 text-center">
                <span className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-medium",
                  t.winRate >= 60 ? "bg-emerald-500/20 text-[var(--trade-bullish)]" :
                  t.winRate >= 45 ? "bg-amber-500/20 text-amber-400" :
                  "bg-red-500/20 text-[var(--trade-bearish)]"
                )}>
                  {t.winRate}%
                </span>
              </td>
              <td className={cn("py-2 text-right font-mono", t.totalPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]")}>
                {formatPnL(t.totalPnL)}
              </td>
              <td className={cn("py-2 text-right font-mono", t.avgPnL >= 0 ? "text-[var(--trade-bullish)]/70" : "text-[var(--trade-bearish)]/70")}>
                {formatPnL(t.avgPnL)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SetupTable({ data }: { data: SetupBreakdown[] }) {
  const [showAll, setShowAll] = useState(false);
  const VISIBLE = 8;
  if (data.length === 0) return null;
  const visible = showAll ? data : data.slice(0, VISIBLE);

  return (
    <div className="space-y-2">
      {visible.map((s) => (
        <div key={s.source} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/8 transition-colors">
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">{s.label}</div>
            <div className="text-[10px] text-muted-foreground">{s.trades} trades</div>
          </div>
          <div className="text-center px-3">
            <div className={cn("text-sm font-bold", s.winRate >= 55 ? "text-[var(--trade-bullish)]" : s.winRate >= 45 ? "text-amber-400" : "text-[var(--trade-bearish)]")}>
              {s.winRate}%
            </div>
            <div className="text-[9px] text-muted-foreground">WIN RATE</div>
          </div>
          <div className="text-right w-20">
            <div className={cn("text-sm font-mono font-medium", s.totalPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]")}>
              {formatPnL(s.totalPnL)}
            </div>
            <div className="text-[9px] text-muted-foreground">TOTAL</div>
          </div>
        </div>
      ))}
      {data.length > VISIBLE && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAll ? 'Show less' : `Show all ${data.length} setups`}
        </button>
      )}
    </div>
  );
}

function RecentTradesTable({ trades }: { trades: TradeRecord[] }) {
  if (trades.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/50 text-muted-foreground">
            <th className="text-left py-2 font-medium">SYMBOL</th>
            <th className="text-left py-2 font-medium">SIDE</th>
            <th className="text-center py-2 font-medium">TYPE</th>
            <th className="text-right py-2 font-medium">ENTRY</th>
            <th className="text-right py-2 font-medium">EXIT</th>
            <th className="text-right py-2 font-medium">P&L</th>
            <th className="text-center py-2 font-medium">STATUS</th>
            <th className="text-right py-2 font-medium">DATE</th>
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 25).map((t) => {
            const isOpt = t.assetType === 'option';
            return (
              <tr key={t.id} className="border-b border-border/20 hover:bg-white/5 transition-colors">
                <td className="py-2">
                  <span className="font-semibold text-foreground">{t.symbol}</span>
                  {isOpt && t.strikePrice && (
                    <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-400">
                      {t.optionType?.toUpperCase()} ${t.strikePrice}
                    </span>
                  )}
                </td>
                <td className="py-2">
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-medium",
                    t.direction === 'long' ? "bg-emerald-500/20 text-[var(--trade-bullish)]" : "bg-red-500/20 text-[var(--trade-bearish)]"
                  )}>
                    {t.direction === 'long' ? 'LONG' : 'SHORT'}
                  </span>
                </td>
                <td className="py-2 text-center text-muted-foreground">{isOpt ? 'Option' : 'Stock'}</td>
                <td className="py-2 text-right font-mono text-muted-foreground">${t.entryPrice.toFixed(2)}</td>
                <td className="py-2 text-right font-mono text-muted-foreground">
                  {t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '—'}
                </td>
                <td className={cn("py-2 text-right font-mono font-medium",
                  t.realizedPnL && t.realizedPnL > 0 ? "text-[var(--trade-bullish)]" :
                  t.realizedPnL && t.realizedPnL < 0 ? "text-[var(--trade-bearish)]" : "text-muted-foreground"
                )}>
                  {t.realizedPnL != null ? formatPnL(t.realizedPnL) : '—'}
                </td>
                <td className="py-2 text-center">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded",
                    t.outcomeStatus === 'hit_target' ? "bg-emerald-500/20 text-[var(--trade-bullish)]" :
                    t.outcomeStatus === 'hit_stop' ? "bg-red-500/20 text-[var(--trade-bearish)]" :
                    t.outcomeStatus === 'expired' ? "bg-zinc-500/20 text-zinc-400" :
                    "bg-blue-500/20 text-blue-400"
                  )}>
                    {t.outcomeStatus === 'hit_target' ? 'WIN' :
                     t.outcomeStatus === 'hit_stop' ? 'LOSS' :
                     t.outcomeStatus === 'expired' ? 'EXPIRED' : 'OPEN'}
                  </span>
                </td>
                <td className="py-2 text-right text-muted-foreground text-[10px]">
                  {new Date(t.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── CSV Upload Component ──────────────────────────────────

function CSVImportPanel({ onImportSuccess }: { onImportSuccess: () => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [broker, setBroker] = useState('');
  const [importResult, setImportResult] = useState<{
    success: boolean;
    broker: string;
    saved: number;
    duplicates?: number;
    open?: number;
    closed?: number;
    errors: string[];
    batchId?: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setImportResult({ success: false, broker: '', saved: 0, errors: ['Only CSV files are supported.'] });
      return;
    }
    setIsUploading(true);
    setImportResult(null);

    try {
      const csv = await file.text();

      // Get CSRF token
      const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();

      const res = await fetch('/api/journal/import-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({ csv, broker: broker || undefined }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');

      setImportResult({
        success: true,
        broker: data.broker,
        saved: data.saved,
        duplicates: data.duplicates,
        open: data.open,
        closed: data.closed,
        errors: data.errors || [],
        batchId: data.batchId,
      });
      onImportSuccess();
    } catch (err: any) {
      setImportResult({
        success: false,
        broker: '',
        saved: 0,
        errors: [err.message || 'Import failed'],
      });
    } finally {
      setIsUploading(false);
    }
  }, [broker, onImportSuccess]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="space-y-4">
      {/* Broker selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-muted-foreground font-medium">Broker:</label>
        <select
          value={broker}
          onChange={(e) => setBroker(e.target.value)}
          className="bg-white/5 border border-border/50 rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-purple-500/50"
        >
          {BROKERS.map((b) => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>
        <span className="text-[10px] text-muted-foreground">
          Leave on auto-detect if unsure — we'll figure it out from the CSV headers.
        </span>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all",
          isDragging
            ? "border-purple-500 bg-purple-500/10"
            : "border-border/50 hover:border-border hover:bg-white/5",
          isUploading && "opacity-50 pointer-events-none",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
        {isUploading ? (
          <div className="space-y-2">
            <Activity className="w-8 h-8 mx-auto text-purple-400 animate-pulse" />
            <p className="text-sm text-muted-foreground">Parsing your trades...</p>
          </div>
        ) : (
          <div className="space-y-2">
            <Upload className={cn("w-8 h-8 mx-auto", isDragging ? "text-purple-400" : "text-muted-foreground")} />
            <p className="text-sm text-foreground font-medium">
              {isDragging ? 'Drop CSV file here' : 'Drag & drop your broker CSV here'}
            </p>
            <p className="text-xs text-muted-foreground">
              or click to browse — supports Webull, Robinhood, Schwab, IBKR, tastytrade
            </p>
          </div>
        )}
      </div>

      {/* Import result */}
      {importResult && (
        <div className={cn(
          "rounded-xl border p-4",
          importResult.success
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-red-500/30 bg-red-500/5"
        )}>
          {importResult.success ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-[var(--trade-bullish)]" />
                <span className="text-sm font-semibold text-[var(--trade-bullish)]">
                  Import Successful
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Detected <span className="text-foreground font-medium">{importResult.broker}</span> format.
                Imported <span className="text-foreground font-medium">{importResult.saved}</span> trades.
                {typeof importResult.closed === 'number' && typeof importResult.open === 'number' && (
                  <> Reconstructed <span className="text-foreground font-medium">{importResult.closed} closed</span> and <span className="text-foreground font-medium">{importResult.open} open</span> positions.</>
                )}
                {!!importResult.duplicates && (
                  <> Skipped <span className="text-foreground font-medium">{importResult.duplicates} duplicates</span>.</>
                )}
              </p>
              {importResult.errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] text-amber-400 font-medium">{importResult.errors.length} warnings:</p>
                  <ul className="text-[10px] text-muted-foreground list-disc pl-4 mt-1 max-h-24 overflow-y-auto">
                    {importResult.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <X className="w-4 h-4 text-[var(--trade-bearish)]" />
                <span className="text-sm font-semibold text-[var(--trade-bearish)]">Import Failed</span>
              </div>
              <ul className="text-xs text-muted-foreground list-disc pl-4">
                {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* How to export guide */}
      <div className="bg-white/5 rounded-xl border border-border/30 p-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" /> How to export from your broker
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] text-muted-foreground">
          <div>
            <span className="text-foreground font-medium">Webull:</span> Account → History → Export Orders
          </div>
          <div>
            <span className="text-foreground font-medium">Robinhood:</span> Statements & History → Download CSV
          </div>
          <div>
            <span className="text-foreground font-medium">Schwab:</span> Accounts → History → Export
          </div>
          <div>
            <span className="text-foreground font-medium">IBKR:</span> Reports → Flex Queries → Trade Confirm
          </div>
          <div>
            <span className="text-foreground font-medium">tastytrade:</span> History → Trade History → Export
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Manual Trade Entry ────────────────────────────────────

function ManualTradeForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({
    symbol: '',
    direction: 'long' as 'long' | 'short',
    assetType: 'stock' as 'stock' | 'option',
    optionType: 'call' as 'call' | 'put',
    strikePrice: '',
    expiryDate: '',
    quantity: '1',
    entryPrice: '',
    exitPrice: '',
    entryTime: new Date().toISOString().slice(0, 16),
    exitTime: '',
    fees: '0',
    notes: '',
    emotion: '',
    setupType: '',
    mistakeTag: '',
    rating: 3,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.symbol || !form.entryPrice) {
      setError('Symbol and entry price are required.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const entryPrice = parseFloat(form.entryPrice);
      const exitPrice = form.exitPrice ? parseFloat(form.exitPrice) : null;
      const quantity = parseFloat(form.quantity) || 1;
      const fees = parseFloat(form.fees) || 0;
      const multiplier = form.assetType === 'option' ? 100 : 1;

      let realizedPnL: number | null = null;
      if (exitPrice !== null) {
        const priceDiff = form.direction === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice;
        realizedPnL = +(priceDiff * quantity * multiplier - fees).toFixed(2);
      }

      const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();

      const body: Record<string, any> = {
        symbol: form.symbol.toUpperCase(),
        direction: form.direction,
        assetType: form.assetType,
        quantity,
        entryPrice,
        exitPrice,
        entryTime: new Date(form.entryTime).toISOString(),
        exitTime: form.exitTime ? new Date(form.exitTime).toISOString() : null,
        fees,
        realizedPnL,
        realizedPnLPercent: realizedPnL !== null && entryPrice > 0
          ? +((realizedPnL / (entryPrice * quantity * multiplier)) * 100).toFixed(2)
          : null,
        status: exitPrice !== null ? 'closed' : 'open',
        outcome: realizedPnL !== null
          ? (realizedPnL > 0 ? 'win' : realizedPnL < 0 ? 'loss' : 'breakeven')
          : 'open',
        notes: form.notes || null,
        emotion: form.emotion || null,
        setupType: form.setupType || null,
        mistakeTag: form.mistakeTag || null,
        rating: form.rating,
      };

      if (form.assetType === 'option') {
        body.optionType = form.optionType;
        body.strikePrice = form.strikePrice ? parseFloat(form.strikePrice) : null;
        body.expiryDate = form.expiryDate || null;
      }

      if (form.exitTime && form.entryTime) {
        body.holdingMinutes = Math.round(
          (new Date(form.exitTime).getTime() - new Date(form.entryTime).getTime()) / 60000
        );
      }

      const res = await fetch('/api/journal/trade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add trade');
      }

      // Reset form
      setForm(prev => ({
        ...prev,
        symbol: '',
        entryPrice: '',
        exitPrice: '',
        quantity: '1',
        fees: '0',
        notes: '',
        emotion: '',
        setupType: '',
        mistakeTag: '',
        entryTime: new Date().toISOString().slice(0, 16),
        exitTime: '',
      }));
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-[var(--trade-bearish)]">
          {error}
        </div>
      )}

      {/* Row 1: Core trade info */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Symbol *</label>
          <input
            type="text"
            value={form.symbol}
            onChange={(e) => setForm(p => ({ ...p, symbol: e.target.value }))}
            placeholder="AAPL"
            className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Direction</label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, direction: 'long' }))}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-medium transition-colors",
                form.direction === 'long' ? "bg-emerald-500/20 text-[var(--trade-bullish)] border border-emerald-500/30" : "bg-white/5 text-muted-foreground border border-border/50"
              )}
            >
              LONG
            </button>
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, direction: 'short' }))}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-medium transition-colors",
                form.direction === 'short' ? "bg-red-500/20 text-[var(--trade-bearish)] border border-red-500/30" : "bg-white/5 text-muted-foreground border border-border/50"
              )}
            >
              SHORT
            </button>
          </div>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Type</label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, assetType: 'stock' }))}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-medium transition-colors",
                form.assetType === 'stock' ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-white/5 text-muted-foreground border border-border/50"
              )}
            >
              Stock
            </button>
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, assetType: 'option' }))}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-medium transition-colors",
                form.assetType === 'option' ? "bg-purple-500/20 text-purple-400 border border-purple-500/30" : "bg-white/5 text-muted-foreground border border-border/50"
              )}
            >
              Option
            </button>
          </div>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Quantity</label>
          <input
            type="number"
            value={form.quantity}
            onChange={(e) => setForm(p => ({ ...p, quantity: e.target.value }))}
            min="1"
            step="1"
            className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-purple-500/50"
          />
        </div>
      </div>

      {/* Option fields (conditional) */}
      {form.assetType === 'option' && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Call/Put</label>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, optionType: 'call' }))}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-medium transition-colors",
                  form.optionType === 'call' ? "bg-emerald-500/20 text-[var(--trade-bullish)] border border-emerald-500/30" : "bg-white/5 text-muted-foreground border border-border/50"
                )}
              >
                CALL
              </button>
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, optionType: 'put' }))}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-medium transition-colors",
                  form.optionType === 'put' ? "bg-red-500/20 text-[var(--trade-bearish)] border border-red-500/30" : "bg-white/5 text-muted-foreground border border-border/50"
                )}
              >
                PUT
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Strike Price</label>
            <input
              type="number"
              value={form.strikePrice}
              onChange={(e) => setForm(p => ({ ...p, strikePrice: e.target.value }))}
              placeholder="150.00"
              step="0.5"
              className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-purple-500/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Expiry Date</label>
            <input
              type="date"
              value={form.expiryDate}
              onChange={(e) => setForm(p => ({ ...p, expiryDate: e.target.value }))}
              className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-purple-500/50"
            />
          </div>
        </div>
      )}

      {/* Row 2: Prices & Timing */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Entry Price *</label>
          <input
            type="number"
            value={form.entryPrice}
            onChange={(e) => setForm(p => ({ ...p, entryPrice: e.target.value }))}
            placeholder="0.00"
            step="0.01"
            className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Exit Price</label>
          <input
            type="number"
            value={form.exitPrice}
            onChange={(e) => setForm(p => ({ ...p, exitPrice: e.target.value }))}
            placeholder="Leave blank if open"
            step="0.01"
            className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Entry Time</label>
          <input
            type="datetime-local"
            value={form.entryTime}
            onChange={(e) => setForm(p => ({ ...p, entryTime: e.target.value }))}
            className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Exit Time</label>
          <input
            type="datetime-local"
            value={form.exitTime}
            onChange={(e) => setForm(p => ({ ...p, exitTime: e.target.value }))}
            className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-purple-500/50"
          />
        </div>
      </div>

      {/* Row 3: Journal / Self-reflection */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Emotion</label>
          <select
            value={form.emotion}
            onChange={(e) => setForm(p => ({ ...p, emotion: e.target.value }))}
            className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-purple-500/50"
          >
            <option value="">Select...</option>
            {EMOTIONS.map((em) => (
              <option key={em.value} value={em.value}>{em.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Setup Type</label>
          <input
            type="text"
            value={form.setupType}
            onChange={(e) => setForm(p => ({ ...p, setupType: e.target.value }))}
            placeholder="e.g. GEX flip, breakout"
            className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Mistake</label>
          <input
            type="text"
            value={form.mistakeTag}
            onChange={(e) => setForm(p => ({ ...p, mistakeTag: e.target.value }))}
            placeholder="e.g. chased, no stop"
            className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">
            Rating: {form.rating}/5
          </label>
          <div className="flex gap-1 mt-1">
            {[1, 2, 3, 4, 5].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setForm(p => ({ ...p, rating: r }))}
                className={cn(
                  "flex-1 py-1.5 rounded text-xs font-medium transition-colors",
                  r <= form.rating ? "bg-amber-500/20 text-amber-400" : "bg-white/5 text-muted-foreground"
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))}
          placeholder="What was your thesis? What went right or wrong?"
          rows={2}
          className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-purple-500/50 resize-none"
        />
      </div>

      {/* Fees + Submit */}
      <div className="flex items-end gap-3">
        <div className="w-28">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-1">Fees ($)</label>
          <input
            type="number"
            value={form.fees}
            onChange={(e) => setForm(p => ({ ...p, fees: e.target.value }))}
            step="0.01"
            min="0"
            className="w-full bg-white/5 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-purple-500/50"
          />
        </div>

        {/* P&L preview */}
        {form.entryPrice && form.exitPrice && (
          <div className="flex-1">
            <div className="text-[10px] text-muted-foreground mb-1">Estimated P&L</div>
            {(() => {
              const entry = parseFloat(form.entryPrice);
              const exit = parseFloat(form.exitPrice);
              const qty = parseFloat(form.quantity) || 1;
              const fees = parseFloat(form.fees) || 0;
              const mult = form.assetType === 'option' ? 100 : 1;
              const diff = form.direction === 'long' ? exit - entry : entry - exit;
              const pnl = diff * qty * mult - fees;
              return (
                <span className={cn("text-lg font-bold font-mono", pnl >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]")}>
                  {formatPnL(pnl)}
                </span>
              );
            })()}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !form.symbol || !form.entryPrice}
          className={cn(
            "px-6 py-2 rounded-lg text-sm font-medium transition-all",
            "bg-purple-500/20 text-purple-400 border border-purple-500/30",
            "hover:bg-purple-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          {isSubmitting ? (
            <Activity className="w-4 h-4 animate-spin" />
          ) : (
            <span className="flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Log Trade
            </span>
          )}
        </button>
      </div>
    </form>
  );
}

// ─── Personal Trades List ──────────────────────────────────

function PersonalTradesTable({ trades, onDelete }: { trades: JournalTradeRow[]; onDelete: (id: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const VISIBLE = 30;
  if (trades.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No trades yet.</p>
        <p className="text-xs mt-1">Import a CSV or log your first trade above.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/50 text-muted-foreground">
            <th className="text-left py-2 font-medium">SYMBOL</th>
            <th className="text-left py-2 font-medium">SIDE</th>
            <th className="text-center py-2 font-medium">TYPE</th>
            <th className="text-right py-2 font-medium">QTY</th>
            <th className="text-right py-2 font-medium">ENTRY</th>
            <th className="text-right py-2 font-medium">EXIT</th>
            <th className="text-right py-2 font-medium">P&L</th>
            <th className="text-center py-2 font-medium">OUTCOME</th>
            <th className="text-center py-2 font-medium">BROKER</th>
            <th className="text-right py-2 font-medium">DATE</th>
            <th className="text-center py-2 font-medium w-8"></th>
          </tr>
        </thead>
        <tbody>
          {(showAll ? trades : trades.slice(0, VISIBLE)).map((t) => {
            const isOpt = t.assetType === 'option';
            const pnl = t.realizedPnL;
            return (
              <tr key={t.id} className="border-b border-border/20 hover:bg-white/5 transition-colors group">
                <td className="py-2">
                  <span className="font-semibold text-foreground">{t.symbol}</span>
                  {isOpt && t.strikePrice && (
                    <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-400">
                      {t.optionType?.toUpperCase()} ${t.strikePrice}
                    </span>
                  )}
                  {t.emotion && (
                    <span className="ml-1 text-[9px] text-muted-foreground">
                      ({t.emotion})
                    </span>
                  )}
                </td>
                <td className="py-2">
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-medium",
                    t.direction === 'long' ? "bg-emerald-500/20 text-[var(--trade-bullish)]" : "bg-red-500/20 text-[var(--trade-bearish)]"
                  )}>
                    {t.direction === 'long' ? 'LONG' : 'SHORT'}
                  </span>
                </td>
                <td className="py-2 text-center text-muted-foreground">{isOpt ? 'Option' : 'Stock'}</td>
                <td className="py-2 text-right text-muted-foreground font-mono">{t.quantity}</td>
                <td className="py-2 text-right font-mono text-muted-foreground">${t.entryPrice.toFixed(2)}</td>
                <td className="py-2 text-right font-mono text-muted-foreground">
                  {t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '—'}
                </td>
                <td className={cn("py-2 text-right font-mono font-medium",
                  pnl && pnl > 0 ? "text-[var(--trade-bullish)]" :
                  pnl && pnl < 0 ? "text-[var(--trade-bearish)]" : "text-muted-foreground"
                )}>
                  {pnl != null ? formatPnL(pnl) : '—'}
                  {t.realizedPnLPercent != null && (
                    <span className="text-[9px] text-muted-foreground ml-1">
                      ({t.realizedPnLPercent > 0 ? '+' : ''}{t.realizedPnLPercent.toFixed(1)}%)
                    </span>
                  )}
                </td>
                <td className="py-2 text-center">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded",
                    t.outcome === 'win' ? "bg-emerald-500/20 text-[var(--trade-bullish)]" :
                    t.outcome === 'loss' ? "bg-red-500/20 text-[var(--trade-bearish)]" :
                    t.outcome === 'breakeven' ? "bg-zinc-500/20 text-zinc-400" :
                    "bg-blue-500/20 text-blue-400"
                  )}>
                    {(t.outcome || t.status).toUpperCase()}
                  </span>
                </td>
                <td className="py-2 text-center">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground">
                    {t.broker}
                  </span>
                </td>
                <td className="py-2 text-right text-muted-foreground text-[10px]">
                  {new Date(t.entryTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </td>
                <td className="py-2 text-center">
                  <button
                    onClick={() => onDelete(t.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-[var(--trade-bearish)]"
                    title="Delete trade"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {trades.length > VISIBLE && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAll ? 'Show less' : `Show all ${trades.length} trades`}
        </button>
      )}
    </div>
  );
}

// ─── DTE Breakdown Chart ──────────────────────────────────

function DTEBreakdownCard({ data }: { data: DTEBreakdown[] }) {
  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-muted-foreground text-xs">
        No option trades with expiry data to analyze DTE patterns.
      </div>
    );
  }

  const maxTrades = Math.max(...data.map(d => d.trades));

  return (
    <div className="space-y-2">
      {data.map((d) => {
        const barWidth = maxTrades > 0 ? (d.trades / maxTrades) * 100 : 0;
        return (
          <div key={d.label} className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground w-20 shrink-0 font-mono">{d.label}</span>
            <div className="flex-1 h-8 bg-white/5 rounded overflow-hidden relative">
              <div
                className={cn(
                  "h-full rounded transition-all",
                  d.avgPnL >= 0 ? 'bg-emerald-500/25' : 'bg-red-500/25'
                )}
                style={{ width: `${Math.max(barWidth, 8)}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-between px-2">
                <span className="text-[10px] font-medium text-foreground/80">
                  {d.winRate.toFixed(0)}% WR · {d.trades} trades
                </span>
                <span className={cn("text-[10px] font-mono font-medium",
                  d.avgPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                )}>
                  avg {formatPnL(d.avgPnL)}
                </span>
              </div>
            </div>
            <span className={cn("text-[10px] font-mono w-16 text-right font-medium",
              d.totalPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
            )}>
              {formatPnL(d.totalPnL)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Day of Week P&L Chart ────────────────────────────────

function DayOfWeekChart({ data }: { data: DayOfWeekPnL[] }) {
  if (data.length === 0) return null;

  const maxAbsPnL = Math.max(...data.map(d => Math.abs(d.totalPnL)), 1);

  return (
    <div className="space-y-2">
      {data.map((d) => {
        const barWidth = (Math.abs(d.totalPnL) / maxAbsPnL) * 100;
        const isPositive = d.totalPnL >= 0;

        return (
          <div key={d.day} className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground w-20 shrink-0">{d.day}</span>
            <div className="flex-1 h-7 relative">
              {/* Center line */}
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
              {/* Bar grows from center */}
              <div className="absolute inset-y-0 left-1/2 flex items-center" style={{
                ...(isPositive
                  ? { left: '50%', width: `${barWidth / 2}%` }
                  : { right: '50%', width: `${barWidth / 2}%`, left: `${50 - barWidth / 2}%` }
                ),
              }}>
                <div className={cn(
                  "h-5 w-full rounded-sm",
                  isPositive ? 'bg-emerald-500/30' : 'bg-red-500/30'
                )} />
              </div>
              {/* Labels */}
              <div className="absolute inset-0 flex items-center justify-between px-1">
                <span className="text-[9px] text-muted-foreground">{d.trades} trades</span>
                <span className={cn("text-[10px] font-mono font-medium",
                  isPositive ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                )}>
                  {formatPnL(d.totalPnL)}
                </span>
              </div>
            </div>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium w-14 text-center",
              GRADE_COLORS[d.grade]
            )}>
              {d.grade === 'hot' ? 'HOT' : d.grade === 'warm' ? 'WARM' : d.grade === 'cold' ? 'COLD' : 'EVEN'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Trade Count Optimum ──────────────────────────────────

function TradeCountOptimumCard({ data }: { data: TradeCountBucket[] }) {
  if (data.length === 0) return null;

  const bestBucket = data.reduce((best, curr) =>
    curr.avgPnL > best.avgPnL ? curr : best, data[0]);

  return (
    <div className="space-y-3">
      {data.map((b) => {
        const isBest = b === bestBucket && b.avgPnL > 0;

        return (
          <div key={b.label} className={cn(
            "flex items-center justify-between p-3 rounded-lg border transition-colors",
            isBest
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-border/30 bg-white/5"
          )}>
            <div className="flex items-center gap-3">
              {isBest && <Star className="w-3.5 h-3.5 text-[var(--trade-bullish)]" />}
              <div>
                <div className="text-sm font-medium text-foreground">{b.label}</div>
                <div className="text-[10px] text-muted-foreground">{b.days} days · {b.winRate.toFixed(0)}% WR</div>
              </div>
            </div>
            <div className="text-right">
              <div className={cn("text-sm font-mono font-bold",
                b.avgPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
              )}>
                {formatPnL(b.avgPnL)}/day
              </div>
              <div className="text-[9px] text-muted-foreground">
                total {formatPnL(b.totalPnL)}
              </div>
            </div>
          </div>
        );
      })}
      {bestBucket && bestBucket.avgPnL > 0 && (
        <div className="text-[10px] text-[var(--trade-bullish)]/80 flex items-center gap-1.5 px-1">
          <Lightbulb className="w-3 h-3" />
          Sweet spot: {bestBucket.label} per day (avg {formatPnL(bestBucket.avgPnL)}/day)
        </div>
      )}
    </div>
  );
}

// ─── Weekly P&L Chart ─────────────────────────────────────

function WeeklyPnLChart({ data }: { data: WeeklyPnL[] }) {
  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-muted-foreground text-xs">
        Not enough data for weekly breakdown.
      </div>
    );
  }

  const maxCum = Math.max(...data.map(d => d.cumulativePnL), 0);
  const minCum = Math.min(...data.map(d => d.cumulativePnL), 0);
  const range = maxCum - minCum || 1;
  const h = 160;
  const w = 100;

  const points = data.map((d, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * w;
    const y = h - ((d.cumulativePnL - minCum) / range) * (h - 20) - 10;
    return `${x},${y}`;
  }).join(' ');

  const lastCum = data[data.length - 1]?.cumulativePnL ?? 0;
  const isPos = lastCum >= 0;

  // Bars for weekly P&L
  const maxWeekPnL = Math.max(...data.map(d => Math.abs(d.totalPnL)), 1);

  return (
    <div className="space-y-4">
      {/* Cumulative line */}
      <div className="relative h-40">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
          <line x1="0" x2={w}
            y1={h - ((-minCum) / range) * (h - 20) - 10}
            y2={h - ((-minCum) / range) * (h - 20) - 10}
            stroke="var(--border)" strokeWidth="0.3" strokeDasharray="2,2" />
          <polygon points={`0,${h} ${points} ${w},${h}`}
            fill={isPos ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'} />
          <polyline points={points} fill="none"
            stroke={isPos ? '#10b981' : '#ef4444'} strokeWidth="0.8"
            vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="absolute top-2 left-3">
          <span className="text-[10px] text-muted-foreground">{data.length} weeks</span>
        </div>
      </div>

      {/* Weekly bars */}
      <div className="space-y-1">
        {data.slice(-12).map((w) => (
          <div key={w.week} className="flex items-center gap-2">
            <span className="text-[9px] text-muted-foreground w-16 shrink-0 font-mono">{w.week}</span>
            <div className="flex-1 h-5 bg-white/5 rounded overflow-hidden relative">
              <div
                className={cn("h-full rounded",
                  w.totalPnL >= 0 ? 'bg-emerald-500/25' : 'bg-red-500/25'
                )}
                style={{ width: `${(Math.abs(w.totalPnL) / maxWeekPnL) * 100}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-between px-1.5">
                <span className="text-[9px] text-muted-foreground">{w.trades} trades</span>
                <span className={cn("text-[9px] font-mono",
                  w.totalPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                )}>
                  {formatPnL(w.totalPnL)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Drawdown Card ────────────────────────────────────────

function DrawdownCard({ data }: { data: DrawdownMetrics }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-white/5">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 cursor-help" title="Largest peak-to-trough decline in your equity curve.">Max Drawdown</div>
          <div className="text-lg font-bold text-[var(--trade-bearish)] font-mono">{formatPnL(-Math.abs(data.maxDrawdown))}</div>
        </div>
        <div className="p-3 rounded-lg bg-white/5">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 cursor-help" title="Highest cumulative P&L your journal has reached.">Peak Equity</div>
          <div className="text-lg font-bold text-[var(--trade-bullish)] font-mono">{formatPnL(data.peakEquity)}</div>
        </div>
        <div className="p-3 rounded-lg bg-white/5">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 cursor-help" title="How far your equity currently sits below its peak.">Current Drawdown</div>
          <div className={cn("text-lg font-bold font-mono",
            data.currentDrawdown > 0 ? "text-[var(--trade-bearish)]" : "text-[var(--trade-bullish)]"
          )}>
            {data.currentDrawdown > 0 ? formatPnL(-data.currentDrawdown) : 'At peak'}
          </div>
        </div>
        <div className="p-3 rounded-lg bg-white/5">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Recovery Trades</div>
          <div className="text-lg font-bold text-foreground font-mono">
            {data.recoveryTrades > 0 ? data.recoveryTrades : '—'}
          </div>
        </div>
      </div>

      {data.drawdownPeriods.length > 0 && (
        <div>
          <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-2">Drawdown Periods</div>
          <div className="space-y-1">
            {data.drawdownPeriods.slice(0, 5).map((p, i) => (
              <div key={i} className="flex items-center justify-between px-2 py-1.5 rounded bg-red-500/5 border border-red-500/10">
                <span className="text-[10px] text-muted-foreground">
                  {new Date(p.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' → '}
                  {new Date(p.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <span className="text-[10px] font-mono text-[var(--trade-bearish)] font-medium">
                  {formatPnL(-Math.abs(p.depth))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Emotion Analysis ─────────────────────────────────────

const EMOTION_COLORS: Record<string, string> = {
  confident: 'text-[var(--trade-bullish)] bg-emerald-500/20',
  disciplined: 'text-blue-400 bg-blue-500/20',
  neutral: 'text-zinc-400 bg-zinc-500/20',
  fearful: 'text-amber-400 bg-amber-500/20',
  fomo: 'text-orange-400 bg-orange-500/20',
  greedy: 'text-[var(--trade-bearish)] bg-red-500/20',
  revenge: 'text-[var(--trade-bearish)] bg-red-500/20',
};

function EmotionChart({ data }: { data: EmotionAnalysis[] }) {
  if (data.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground text-xs">
        Tag your trades with emotions to see how feelings affect performance.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((e) => {
        const colorClass = EMOTION_COLORS[e.emotion.toLowerCase()] || 'text-zinc-400 bg-zinc-500/20';
        const [textColor, bgColor] = colorClass.split(' ');

        return (
          <div key={e.emotion} className="flex items-center gap-3 p-2.5 rounded-lg bg-white/5 hover:bg-white/8 transition-colors">
            <span className={cn("text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider", colorClass)}>
              {e.emotion}
            </span>
            <div className="flex-1 flex items-center gap-3">
              <span className="text-[10px] text-muted-foreground">{e.trades} trades</span>
              <span className={cn("text-[10px] font-medium",
                e.winRate >= 55 ? "text-[var(--trade-bullish)]" : e.winRate >= 45 ? "text-amber-400" : "text-[var(--trade-bearish)]"
              )}>
                {e.winRate.toFixed(0)}% WR
              </span>
            </div>
            <div className="text-right">
              <span className={cn("text-xs font-mono font-medium",
                e.avgPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
              )}>
                avg {formatPnL(e.avgPnL)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Simulator Tab ─────────────────────────────────────────

function SimulatorTab({ trades }: { trades: JournalTradeRow[] }) {
  // Extract open option positions from journal trades → SimPosition[]
  const optionPositions = useMemo<SimPosition[]>(() => {
    return trades
      .filter(t => t.assetType === 'option' && t.strikePrice && t.optionType)
      .map(t => ({
        symbol: t.symbol,
        strikePrice: t.strikePrice!,
        optionType: t.optionType as 'call' | 'put',
        direction: (t.direction || 'long') as 'long' | 'short',
        quantity: t.quantity || 1,
        avgCost: t.entryPrice,
        expiryDate: t.expiryDate || '',
      }));
  }, [trades]);

  // Group by symbol for selector
  const symbolGroups = useMemo(() => {
    const groups = new Map<string, SimPosition[]>();
    for (const pos of optionPositions) {
      const arr = groups.get(pos.symbol) || [];
      arr.push(pos);
      groups.set(pos.symbol, arr);
    }
    return groups;
  }, [optionPositions]);

  const symbols = useMemo(() => Array.from(symbolGroups.keys()), [symbolGroups]);
  const [selectedSymbol, setSelectedSymbol] = useState(symbols[0] || '');

  // Update selection if symbols change
  useMemo(() => {
    if (symbols.length > 0 && !symbols.includes(selectedSymbol)) {
      setSelectedSymbol(symbols[0]);
    }
  }, [symbols, selectedSymbol]);

  const activePositions = symbolGroups.get(selectedSymbol) || [];

  if (optionPositions.length === 0) {
    return (
      <div className="bg-card border border-border/50 rounded-xl p-8 text-center">
        <LineChart className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground mb-2">No Option Positions</h3>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          Log or import option trades with strike prices and expiry dates to use the P&L simulator.
          It will project your returns at any underlying price.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Symbol selector */}
      {symbols.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Simulate:</span>
          <div className="flex gap-1">
            {symbols.map(sym => (
              <button
                key={sym}
                onClick={() => setSelectedSymbol(sym)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  selectedSymbol === sym
                    ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                    : "bg-white/5 text-muted-foreground border border-border/50 hover:bg-white/10"
                )}
              >
                {sym} ({symbolGroups.get(sym)?.length || 0} legs)
              </button>
            ))}
          </div>
        </div>
      )}

      <PositionPnLSimulator
        positions={activePositions}
        symbol={selectedSymbol}
      />
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────

function EmptyJournal({ onImportClick }: { onImportClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-20 h-20 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-6">
        <Brain className="w-10 h-10 text-purple-400" />
      </div>
      <h2 className="text-xl font-bold text-foreground mb-2">Your Trade Journal</h2>
      <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
        Import your trades from Webull, Robinhood, or any broker to get personalized analytics,
        behavioral insights, and coaching to improve your edge.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={onImportClick}
          className="px-5 py-2.5 rounded-lg text-sm font-medium bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-colors flex items-center gap-2"
        >
          <Upload className="w-4 h-4" /> Import CSV
        </button>
        <button
          onClick={onImportClick}
          className="px-5 py-2.5 rounded-lg text-sm font-medium bg-white/5 text-muted-foreground border border-border/50 hover:bg-white/10 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Log First Trade
        </button>
      </div>
    </div>
  );
}

// ─── Section empty note ───────────────────────────────────────

function SectionEmpty({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground py-6 text-center">{text}</p>;
}

// ─── Load error (fetch failure must not read as "no trades") ──

function LoadErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <AlertTriangle className="w-10 h-10 text-amber-400/70 mb-4" />
      <h2 className="text-base font-semibold text-foreground mb-1">Couldn&apos;t load your journal</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-5">
        The journal service didn&apos;t respond. Your trades are safe — this is a
        connection issue, not missing data.
      </p>
      <button
        onClick={onRetry}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-white/5 text-foreground border border-border/50 hover:bg-white/10 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function TradeJournal() {
  const [activeTab, setActiveTab] = useState<'overview' | 'insights' | 'timing' | 'trades' | 'simulator' | 'import'>('overview');
  const queryClient = useQueryClient();

  // Fetch personal trades
  const { data: tradesData, error: tradesError } = useQuery<{ trades: JournalTradeRow[]; count: number }>({
    queryKey: ['journal-trades'],
    queryFn: async () => {
      const res = await fetch('/api/journal/trades', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch trades');
      return res.json();
    },
  });

  // Fetch analytics
  const { data, isLoading, error } = useQuery<JournalAnalytics>({
    queryKey: ['journal-analytics'],
    queryFn: async () => {
      const res = await fetch('/api/journal/analytics', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch analytics');
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  // Delete trade mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
      const { csrfToken } = await csrfRes.json();
      const res = await fetch(`/api/journal/trade/${id}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-trades'] });
      queryClient.invalidateQueries({ queryKey: ['journal-analytics'] });
    },
  });

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['journal-trades'] });
    queryClient.invalidateQueries({ queryKey: ['journal-analytics'] });
  }, [queryClient]);

  const tradeCount = tradesData?.count ?? 0;
  const personalTrades = tradesData?.trades ?? [];
  const hasNoTrades = tradeCount === 0 && !isLoading && !tradesError;

  // Trades-list fetch failed: surface an error, never the "no trades" empty state
  if (tradesError && !isLoading && activeTab !== 'import') {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Brain className="w-6 h-6 text-purple-400" />
              Trade Journal
            </h1>
          </div>
        </div>
        <LoadErrorCard onRetry={handleRefresh} />
      </div>
    );
  }

  // Show empty state if no trades at all (unless on import tab)
  if (hasNoTrades && activeTab !== 'import') {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Brain className="w-6 h-6 text-purple-400" />
              Trade Journal
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your personal trade log with behavioral analytics and coaching
            </p>
          </div>
        </div>
        <EmptyJournal onImportClick={() => setActiveTab('import')} />
      </div>
    );
  }

  if (isLoading && activeTab !== 'import') {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Activity className="w-8 h-8 text-muted-foreground animate-pulse mx-auto mb-3" />
          <div className="text-sm text-muted-foreground">Analyzing your trades...</div>
        </div>
      </div>
    );
  }

  if ((error || !data) && activeTab !== 'import') {
    return (
      <div className="max-w-[1400px] mx-auto px-4 py-6">
        <LoadErrorCard onRetry={handleRefresh} />
      </div>
    );
  }

  const emptyMetrics: PerformanceMetrics = {
    totalTrades: 0, closedTrades: 0, openTrades: 0, wins: 0, losses: 0,
    winRate: 0, totalPnL: 0, avgWin: 0, avgLoss: 0, largestWin: 0, largestLoss: 0,
    profitFactor: 0, avgRR: 0, currentStreak: { type: 'win', count: 0 },
    bestStreak: 0, worstStreak: 0, avgHoldMinutes: 0, expectancy: 0,
  };

  const metrics = data?.metrics ?? emptyMetrics;
  const pnlCurve = data?.pnlCurve ?? [];
  const insights = data?.insights ?? [];
  const tickerBreakdown = data?.tickerBreakdown ?? [];
  const setupBreakdown = data?.setupBreakdown ?? [];
  const recentTrades = data?.recentTrades ?? [];
  const timingByHour = data?.timingByHour ?? [];
  const timingByDay = data?.timingByDay ?? [];
  const timingBySession = data?.timingBySession ?? [];
  const dteBreakdown = data?.dteBreakdown ?? [];
  const dayOfWeekPnL = data?.dayOfWeekPnL ?? [];
  const tradeCountOptimum = data?.tradeCountOptimum ?? [];
  const weeklyPnL = data?.weeklyPnL ?? [];
  const drawdown: DrawdownMetrics = data?.drawdown ?? {
    maxDrawdown: 0, maxDrawdownPercent: 0, currentDrawdown: 0,
    peakEquity: 0, recoveryTrades: 0, drawdownPeriods: [],
  };
  const emotionAnalysis = data?.emotionAnalysis ?? [];

  const positiveInsights = insights.filter(i => i.severity === 'positive');
  const warningInsights = insights.filter(i => i.severity === 'warning' || i.severity === 'critical');
  const coachingInsights = insights.filter(i => i.category === 'coaching');

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-400" />
            Trade Journal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {tradeCount} trades logged — behavioral analytics and personalized coaching
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-border/50">
          {(['overview', 'insights', 'timing', 'trades', 'simulator', 'import'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                activeTab === tab
                  ? "bg-white/10 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/80"
              )}
            >
              {tab === 'overview' ? 'Overview' :
               tab === 'insights' ? 'Insights' :
               tab === 'timing' ? 'Timing' :
               tab === 'trades' ? 'Trades' :
               tab === 'simulator' ? 'P&L Sim' : 'Import'}
            </button>
          ))}
        </div>
      </div>

      {/* Hero metric — Expectancy: the single number that answers "am I getting better" */}
      <div className="bg-card border border-border/50 rounded-xl p-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span
            className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium cursor-help"
            title="Average profit or loss per trade. Positive means your strategy has an edge; negative means it loses money on average."
          >
            Expectancy · your edge per trade
          </span>
          <div className={cn("text-4xl font-bold tabular-nums mt-1", metrics.expectancy >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]")}>
            {formatPnL(metrics.expectancy)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {metrics.expectancy > 0
              ? `Positive edge — you earn ${formatPnL(metrics.expectancy)} per trade on average.`
              : metrics.expectancy < 0
                ? `Negative edge — you lose ${formatPnL(Math.abs(metrics.expectancy))} per trade on average.`
                : 'Breakeven — no measurable edge yet.'}
            {` Across ${metrics.closedTrades} closed trades.`}
          </p>
        </div>
        <Zap className={cn("w-8 h-8 shrink-0", metrics.expectancy >= 0 ? "text-[var(--trade-bullish)]/50" : "text-[var(--trade-bearish)]/50")} />
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <StatCard
          label="Total P&L" value={formatPnL(metrics.totalPnL)}
          subValue={`${metrics.closedTrades} closed trades`}
          icon={metrics.totalPnL >= 0 ? TrendingUp : TrendingDown}
          color={metrics.totalPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"}
          tooltip="Net profit or loss across all closed trades in this journal."
        />
        <StatCard
          label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`}
          subValue={`${metrics.wins}W / ${metrics.losses}L`}
          icon={Target}
          color={metrics.winRate >= 55 ? "text-[var(--trade-bullish)]" : metrics.winRate >= 45 ? "text-amber-400" : "text-[var(--trade-bearish)]"}
          tooltip="Share of closed trades that were winners."
        />
        <StatCard
          label="Profit Factor" value={metrics.profitFactor === Infinity ? 'INF' : `${metrics.profitFactor.toFixed(2)}x`}
          subValue={`Avg win $${metrics.avgWin.toFixed(0)} / Avg loss $${metrics.avgLoss.toFixed(0)}`}
          icon={BarChart3}
          color={metrics.profitFactor >= 1.5 ? "text-[var(--trade-bullish)]" : metrics.profitFactor >= 1 ? "text-amber-400" : "text-[var(--trade-bearish)]"}
          tooltip="Gross profit divided by gross loss. Above 1.0 means profitable; 1.5+ is strong."
        />
        <StatCard
          label="Current Streak"
          value={`${metrics.currentStreak.count} ${metrics.currentStreak.type === 'win' ? 'W' : 'L'}`}
          subValue={`Best: ${metrics.bestStreak}W | Worst: ${metrics.worstStreak}L`}
          icon={metrics.currentStreak.type === 'win' ? Flame : Snowflake}
          color={metrics.currentStreak.type === 'win' ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"}
          tooltip="Your current run of consecutive wins or losses."
        />
        <StatCard
          label="Avg Hold" value={formatMinutes(metrics.avgHoldMinutes)}
          subValue={`${metrics.openTrades} positions open`}
          icon={Clock}
          color="text-blue-400"
          tooltip="Average time a position stays open before closing."
        />
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Row 1: P&L curve + Key Insights */}
          <div className="lg:col-span-2 bg-card border border-border/50 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Cumulative P&L
            </h3>
            <PnLCurveChart data={pnlCurve} />
          </div>

          <div className="bg-card border border-border/50 rounded-xl p-5 space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5" /> Key Insights
            </h3>
            {insights.length === 0 ? (
              <p className="text-xs text-muted-foreground">More trades needed to generate insights.</p>
            ) : (
              insights.slice(0, 5).map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))
            )}
          </div>

          {/* Row 2: Drawdown + Weekly P&L */}
          <div className="bg-card border border-border/50 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <TrendingDown className="w-3.5 h-3.5" /> Drawdown Analysis
            </h3>
            <DrawdownCard data={drawdown} />
          </div>

          <div className="lg:col-span-2 bg-card border border-border/50 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Weekly P&L
            </h3>
            <WeeklyPnLChart data={weeklyPnL} />
          </div>

          {/* Row 3: Tickers + Setups + Session */}
          <div className="bg-card border border-border/50 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <PieChart className="w-3.5 h-3.5" /> Ticker Performance
            </h3>
            {tickerBreakdown.length === 0
              ? <SectionEmpty text="Log more trades to see per-ticker performance." />
              : <TickerTable data={tickerBreakdown} />}
          </div>

          <div className="bg-card border border-border/50 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" /> Setup Performance
            </h3>
            {setupBreakdown.length === 0
              ? <SectionEmpty text="Tag trades with a setup type to compare what works." />
              : <SetupTable data={setupBreakdown} />}
          </div>

          <div className="bg-card border border-border/50 rounded-xl p-5">
            {timingBySession.length === 0
              ? <SectionEmpty text="No session data yet — timing stats appear after a few trades." />
              : <TimingHeatmap data={timingBySession} label="Session Performance" />}
          </div>
        </div>
      )}

      {activeTab === 'insights' && (
        <div className="space-y-6">
          {positiveInsights.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--trade-bullish)] mb-3 flex items-center gap-2">
                <Trophy className="w-4 h-4" /> Your Strengths
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {positiveInsights.map((i) => <InsightCard key={i.id} insight={i} />)}
              </div>
            </div>
          )}

          {warningInsights.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-amber-400 mb-3 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" /> Areas to Improve
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {warningInsights.map((i) => <InsightCard key={i.id} insight={i} />)}
              </div>
            </div>
          )}

          {coachingInsights.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-purple-400 mb-3 flex items-center gap-2">
                <Lightbulb className="w-4 h-4" /> Coaching
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {coachingInsights.map((i) => <InsightCard key={i.id} insight={i} />)}
              </div>
            </div>
          )}

          {insights.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Brain className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Complete more trades to unlock behavioral insights.</p>
              <p className="text-xs mt-1">The engine needs 5+ closed trades to detect patterns.</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'timing' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Session + Day of Week Win Rate */}
          <div className="bg-card border border-border/50 rounded-xl p-5">
            <TimingHeatmap data={timingBySession} label="By Session" />
          </div>
          <div className="bg-card border border-border/50 rounded-xl p-5">
            <TimingHeatmap data={timingByDay} label="By Day of Week (Win Rate)" />
          </div>

          {/* Day of Week P&L ($ chart) */}
          <div className="bg-card border border-border/50 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Day of Week P&L
            </h3>
            <DayOfWeekChart data={dayOfWeekPnL} />
          </div>

          {/* Optimal Trade Count */}
          <div className="bg-card border border-border/50 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5" /> Optimal Trade Count / Day
            </h3>
            <TradeCountOptimumCard data={tradeCountOptimum} />
          </div>

          {/* DTE Breakdown (Options) */}
          <div className="bg-card border border-border/50 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5" /> <span className="cursor-help" title="DTE = days to expiration. Groups your option trades by how much time was left on the contract.">DTE Breakdown (Options)</span>
            </h3>
            <DTEBreakdownCard data={dteBreakdown} />
          </div>

          {/* Emotion Analysis */}
          <div className="bg-card border border-border/50 rounded-xl p-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Brain className="w-3.5 h-3.5" /> Emotion vs Performance
            </h3>
            <EmotionChart data={emotionAnalysis} />
          </div>

          {/* Hourly breakdown (full width) */}
          <div className="lg:col-span-2 bg-card border border-border/50 rounded-xl p-5">
            <TimingHeatmap data={timingByHour} label="By Hour" />
          </div>
        </div>
      )}

      {activeTab === 'trades' && (
        <div className="bg-card border border-border/50 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" /> Your Trades ({personalTrades.length})
            </h3>
          </div>
          <PersonalTradesTable
            trades={personalTrades}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        </div>
      )}

      {activeTab === 'simulator' && (
        <SimulatorTab trades={personalTrades} />
      )}

      {activeTab === 'import' && (
        <div className="space-y-6">
          {/* Reset all trades — for cleaning up old malformed imports */}
          {tradeCount > 0 && (
            <div className="bg-card border border-red-500/20 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-[var(--trade-bearish)] uppercase tracking-wider flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5" /> Reset Journal
                  </h4>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Delete all {tradeCount} trades and re-import fresh. Use this if old imports have wrong P&L or malformed symbols.
                  </p>
                </div>
                <button
                  onClick={async () => {
                    if (!confirm(`Delete all ${tradeCount} trades? This cannot be undone. You can re-import after.`)) return;
                    try {
                      const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
                      const { csrfToken } = await csrfRes.json();
                      const res = await fetch('/api/journal/trades/all', {
                        method: 'DELETE',
                        headers: { 'X-CSRF-Token': csrfToken },
                        credentials: 'include',
                      });
                      if (!res.ok) throw new Error('Delete failed');
                      const data = await res.json();
                      alert(`Deleted ${data.deleted} trades. You can now re-import your CSVs.`);
                      handleRefresh();
                    } catch (err: any) {
                      alert('Failed to delete: ' + err.message);
                    }
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-[var(--trade-bearish)] border border-red-500/20 hover:bg-red-500/20 transition-colors shrink-0"
                >
                  Delete All Trades
                </button>
              </div>
            </div>
          )}

          {/* CSV Import */}
          <div className="bg-card border border-border/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Upload className="w-4 h-4 text-purple-400" /> Import from Broker
            </h3>
            <CSVImportPanel onImportSuccess={handleRefresh} />
          </div>

          {/* Manual Entry */}
          <div className="bg-card border border-border/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4 text-purple-400" /> Log Trade Manually
            </h3>
            <ManualTradeForm onSuccess={handleRefresh} />
          </div>
        </div>
      )}
    </div>
  );
}
