import { useQuery } from "@tanstack/react-query";
import { useMarketPoll, POLL } from "@/hooks/use-market-poll";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Target, Activity, Calendar, Brain, BarChart3, TrendingUp, Database, CheckCircle, XCircle, AlertTriangle, RefreshCw, History, Lock, Bot, Info, Wallet } from "lucide-react";
import BrokerImport from "@/components/broker-import";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, subDays, subMonths, startOfDay } from 'date-fns';
import { useState, useMemo, lazy, Suspense } from 'react';
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn, safeToFixed } from "@/lib/utils";
import { CanonRate } from "@/components/canon";
import { getPnlColor } from "@/lib/signal-grade";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ValidationResultsDialog } from "@/components/validation-results-dialog";
import { TierGate } from "@/components/tier-gate";
import { useAuth } from "@/hooks/useAuth";
import { RiskDisclosure } from "@/components/risk-disclosure";

import { UserPerformanceSummary } from "@/components/user-performance-summary";

const EngineTrendsChart = lazy(() => import("@/components/engine-trends-chart"));
const ConfidenceCalibration = lazy(() => import("@/components/confidence-calibration"));
const CalibrationCurve = lazy(() => import("@/components/calibration-curve"));
const EngineActualPerformance = lazy(() => import("@/components/engine-actual-performance"));
const StreakTracker = lazy(() => import("@/components/streak-tracker"));
const LossPatternsDashboard = lazy(() => import("@/components/loss-patterns-dashboard"));
const SignalAttributionDashboard = lazy(() => import("@/components/signal-attribution-dashboard"));
const SymbolLeaderboard = lazy(() => import("@/components/symbol-leaderboard"));
const TimeOfDayHeatmap = lazy(() => import("@/components/time-of-day-heatmap"));
const RollingWinRateChart = lazy(() => import("@/components/rolling-win-rate-chart"));
const DrawdownAnalysisChart = lazy(() => import("@/components/drawdown-analysis-chart"));
const HistoricalIntelligenceTab = lazy(() => import("@/components/historical-intelligence-tab"));
const ConvictionBacktestCard = lazy(() => import("@/components/conviction-backtest-card"));
const BacktestPage = lazy(() => import("@/pages/backtest"));

function ChartSkeleton() {
  return (
    <div className="h-48 w-full animate-pulse bg-muted/30 rounded-lg flex items-center justify-center">
      <span className="text-muted-foreground text-sm">Loading...</span>
    </div>
  );
}

interface SegmentWinRate {
  winRate: number;
  wins: number;
  losses: number;
  decided: number;
}

interface PerformanceStats {
  overall: {
    totalIdeas: number; openIdeas: number; closedIdeas: number; wonIdeas: number; lostIdeas: number;
    expiredIdeas: number; winRate: number; quantAccuracy: number; directionalAccuracy: number;
    avgPercentGain: number; avgHoldingTimeMinutes: number; sharpeRatio: number; maxDrawdown: number;
    profitFactor: number; expectancy: number; evScore: number; adjustedWeightedAccuracy: number;
    oppositeDirectionRate: number; oppositeDirectionCount: number; avgWinSize: number; avgLossSize: number;
  };
  segmentedWinRates: {
    equities: SegmentWinRate;
    options: SegmentWinRate;
    overall: SegmentWinRate;
  };
  bySource: Array<{ source: string; totalIdeas: number; wonIdeas: number; lostIdeas: number; winRate: number; avgPercentGain: number; }>;
  byAssetType: Array<{ assetType: string; totalIdeas: number; wonIdeas: number; lostIdeas: number; winRate: number; avgPercentGain: number; }>;
  bySignalType: Array<{ signal: string; totalIdeas: number; wonIdeas: number; lostIdeas: number; winRate: number; avgPercentGain: number; }>;
}

interface AutoLottoBotPerformance {
  overall: { totalTrades: number; wins: number; losses: number; winRate: number; totalPnL: number; avgPnL: number; openPositions: number; unrealizedPnL: number; };
  options: { totalTrades: number; wins: number; losses: number; winRate: number; totalPnL: number; portfolio: any; };
  futures: { totalTrades: number; wins: number; losses: number; winRate: number; totalPnL: number; portfolio: any; };
  byExitReason: Array<{ reason: string; count: number; wins: number; winRate: number; }>;
  bestTrade: { symbol: string; optionType: string; strikePrice?: number; pnl: number; pnlPercent?: number; } | null;
  worstTrade: { symbol: string; optionType: string; strikePrice?: number; pnl: number; pnlPercent?: number; } | null;
  recentTrades: Array<{ symbol: string; optionType: string; strikePrice?: number; realizedPnL: number; realizedPnLPercent?: number; exitReason: string; closedAt: string; }>;
  unrealizedPnL: number;
}

interface EngineMetrics {
  ideasGenerated: number; ideasPublished: number; tradesResolved: number; tradesWon: number;
  tradesLost: number; tradesExpired: number; winRate: number | null; avgGainPercent: number | null;
  avgLossPercent: number | null; expectancy: number | null; avgHoldingTimeMinutes: number | null;
  avgConfidenceScore: number | null;
}

interface EngineHealthData {
  todayMetrics: Record<string, EngineMetrics>;
  weekMetrics: Record<string, EngineMetrics>;
  historicalMetrics: Array<{ date: string; engine: string; winRate: number | null; }>;
  activeAlerts: any[];
}

interface DataIntegrityCheck {
  checkName: string;
  status: 'pass' | 'fail' | 'warning';
  expected: number;
  actual: number;
  details?: string;
}

const ENGINE_CONFIG = {
  flow: { label: "Flow", icon: Activity, color: "text-[var(--trade-bullish)]", bg: "bg-emerald-500/10" },
  quant: { label: "Quant", icon: BarChart3, color: "text-blue-400", bg: "bg-blue-500/10" },
  ai: { label: "AI", icon: Brain, color: "text-purple-400", bg: "bg-purple-500/10" },
  lotto: { label: "Lotto", icon: Target, color: "text-[var(--trade-neutral)]", bg: "bg-amber-500/10" },
} as const;

type EngineKey = keyof typeof ENGINE_CONFIG;

function getWinRateColor(rate: number | null): string {
  if (rate === null) return "text-muted-foreground";
  if (rate >= 70) return "text-[var(--trade-bullish)]";
  if (rate >= 50) return "text-[var(--trade-neutral)]";
  return "text-[var(--trade-bearish)]";
}

// ============================================================
// TIER 1: HERO STATS - Clean, minimal, essential metrics only
// ============================================================
function HeroStats({ stats, botPnL }: { stats: PerformanceStats; botPnL: number }) {
  const { equities, options, overall } = stats.segmentedWinRates;
  
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="hero-stats">
      {/* Hit Rate - Primary Focus */}
      <Card className="col-span-2 md:col-span-1">
        <CardContent className="p-4">
          <div className="flex items-center gap-1 mb-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Hit Rate</p>
            <span className="text-[10px] text-muted-foreground font-mono">n={overall.decided}</span>
            <span className="group relative inline-block">
              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              <span className="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 bottom-full mb-1 w-48 p-2 text-[10px] bg-popover text-popover-foreground border rounded shadow-lg z-50">
                Count-based: wins / decided trades. Excludes &#177;3% breakeven trades.
              </span>
            </span>
          </div>
          {/* The headline number. Was safeToFixed(winRate) — and safeToFixed
              renders null as '0.00', so a suppressed rate would have shown as a
              red 0.0%. CanonRate owns the below-floor rendering instead. */}
          <div className="text-3xl" data-testid="stat-win-rate">
            <CanonRate className="text-3xl font-bold" wins={overall.wins} decided={overall.decided} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {overall.wins}W / {overall.losses}L ({overall.decided} decided)
          </p>
        </CardContent>
      </Card>

      {/* Segmented Rates */}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">By Asset Type</p>
          <div className="space-y-1">
            {/* Equities was rendering a red 0% off a single decided trade — one
                stopped-out equity idea presented as "equities never win". The
                segment counts below stay, so a thin segment reads as thin
                rather than as a losing one. */}
            <div className="flex justify-between items-center gap-2">
              <span className="text-xs">Equities</span>
              <CanonRate wins={equities.wins} decided={equities.decided} />
            </div>
            <div className="flex justify-between items-center gap-2">
              <span className="text-xs">Options</span>
              <CanonRate wins={options.wins} decided={options.decided} />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            EQ: {equities.wins}W/{equities.losses}L · OPT: {options.wins}W/{options.losses}L
          </p>
        </CardContent>
      </Card>

      {/* Bot P&L */}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Bot P&L</p>
          <p className={cn("text-3xl font-bold font-mono", botPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]")} data-testid="stat-pnl">
            {botPnL >= 0 ? '+' : ''}${safeToFixed(botPnL, 0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Realized gains</p>
        </CardContent>
      </Card>

      {/* Trade Count */}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Ideas</p>
          <p className="text-3xl font-bold font-mono text-[var(--trade-bullish)]" data-testid="stat-total">
            {stats.overall.totalIdeas}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {stats.overall.openIdeas} open · {stats.overall.closedIdeas} closed
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// TIER 2: ENGINE PERFORMANCE GRID - Quick comparison view
// ============================================================
function EngineGrid({ engineHealthData, isLoading }: { engineHealthData?: EngineHealthData; isLoading: boolean }) {
  const engines: EngineKey[] = ["flow", "quant", "ai", "lotto"];
  
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }

  // Detect engines with no resolved trades (likely excluded due to broken option-premium pricing)
  const excludedEngines = engines.filter((key) => {
    const metrics = engineHealthData?.weekMetrics?.[key];
    return !metrics || (metrics.tradesWon === 0 && metrics.tradesLost === 0 && metrics.tradesExpired === 0);
  });

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="engine-grid">
        {engines.map((key) => {
          const config = ENGINE_CONFIG[key];
          const Icon = config.icon;
          const metrics = engineHealthData?.weekMetrics?.[key];
          const winRate = metrics?.winRate ?? null;
          const isExcluded = excludedEngines.includes(key);

          return (
            <Card key={key} className={cn("hover-elevate cursor-default", isExcluded && "opacity-60")}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={cn("p-1.5 rounded", config.bg)}>
                    <Icon className={cn("h-3.5 w-3.5", config.color)} />
                  </div>
                  <span className="text-sm font-medium">{config.label}</span>
                  {isExcluded && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 text-[var(--trade-neutral)] border-amber-500/40">
                      Paused
                    </Badge>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-2xl font-bold font-mono", getWinRateColor(winRate))}>
                    {winRate !== null ? `${safeToFixed(winRate, 0)}%` : '—'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {metrics?.tradesWon ?? 0}W/{metrics?.tradesLost ?? 0}L
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {/* Disclosure: excluded engines */}
      <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/20 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-[var(--trade-neutral)] mt-0.5 shrink-0" />
        <span>
          <strong>Options validation under maintenance</strong> — Flow (1,127) and Lotto (341) ideas excluded from stats.
          Option-premium pricing is being rebuilt; these engines will return once validation is reliable.
        </span>
      </div>
    </div>
  );
}

// ============================================================
// DATA INTEGRITY PANEL - SQL-backed verification
// ============================================================
function DataIntegrityPanel({ stats }: { stats: PerformanceStats }) {
  const { data: integrityData, isLoading, isError, refetch } = useQuery<{
    checks: DataIntegrityCheck[];
    sampleTrades: Array<{
      id: string;
      symbol: string;
      direction: string;
      outcomeStatus: string;
      percentGain: number | null;
      source: string;
      isWin: boolean;
      isRealLoss: boolean;
    }>;
    methodology: {
      winDefinition: string;
      lossDefinition: string;
      exclusions: string[];
    };
  }>({
    queryKey: ['/api/audit/data-integrity'],
    staleTime: 60000,
  });

  const passCount = integrityData?.checks?.filter(c => c.status === 'pass').length ?? 0;
  const totalChecks = integrityData?.checks?.length ?? 0;

  return (
    <Card data-testid="data-integrity-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-[var(--trade-bullish)]" />
            <CardTitle className="text-base">Data Integrity Audit</CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()} data-testid="button-refresh-audit">
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Methodology Definition */}
        <div className="p-3 rounded-lg bg-muted/30 text-sm space-y-2">
          <p className="font-medium text-[var(--trade-bullish)]">Win/Loss Methodology</p>
          <div className="grid gap-1 text-xs text-muted-foreground">
            <div className="flex gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-[var(--trade-bullish)] mt-0.5 shrink-0" />
              <span><strong>Win:</strong> outcomeStatus = 'hit_target'</span>
            </div>
            <div className="flex gap-2">
              <XCircle className="h-3.5 w-3.5 text-[var(--trade-bearish)] mt-0.5 shrink-0" />
              <span><strong>Loss:</strong> outcomeStatus = 'hit_stop' AND percentGain ≤ -3%</span>
            </div>
            <div className="flex gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-[var(--trade-neutral)] mt-0.5 shrink-0" />
              <span><strong>Excluded:</strong> Breakeven (&gt;-3%), expired, open trades, buggy data</span>
            </div>
          </div>
        </div>

        {/* Integrity Checks */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Integrity Checks</p>
            <Badge variant={passCount === totalChecks ? "default" : "destructive"} className="text-xs">
              {passCount}/{totalChecks} Pass
            </Badge>
          </div>
          {isLoading ? (
            <Skeleton className="h-20" />
          ) : isError ? (
            <div className="flex items-center justify-between p-3 rounded bg-muted/20 text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                <XCircle className="h-3.5 w-3.5 text-[var(--trade-bearish)]" />
                Audit request failed — the stats above are unaffected.
              </span>
              <Button variant="ghost" size="sm" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : (
            <div className="space-y-1">
              {integrityData?.checks?.map((check, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded bg-muted/20 text-xs">
                  <div className="flex items-center gap-2">
                    {check.status === 'pass' ? (
                      <CheckCircle className="h-3.5 w-3.5 text-[var(--trade-bullish)]" />
                    ) : check.status === 'warning' ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-[var(--trade-neutral)]" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-[var(--trade-bearish)]" />
                    )}
                    <span>{check.checkName}</span>
                  </div>
                  <span className="font-mono text-muted-foreground">
                    {check.actual} / {check.expected}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sample Trades */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Sample Trades (Verification)</p>
          {isLoading ? (
            <Skeleton className="h-32" />
          ) : isError ? null : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1 px-2">Symbol</th>
                    <th className="text-left py-1 px-2">Source</th>
                    <th className="text-left py-1 px-2">Status</th>
                    <th className="text-right py-1 px-2">Gain</th>
                    <th className="text-center py-1 px-2">Class</th>
                  </tr>
                </thead>
                <tbody>
                  {integrityData?.sampleTrades?.slice(0, 8).map((trade, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1.5 px-2 font-mono">{trade.symbol}</td>
                      <td className="py-1.5 px-2">{trade.source}</td>
                      <td className="py-1.5 px-2">
                        <Badge variant="outline" className={cn("text-[10px]",
                          trade.outcomeStatus === 'hit_target' ? "text-[var(--trade-bullish)] border-green-500/50" :
                          trade.outcomeStatus === 'hit_stop' ? "text-[var(--trade-bearish)] border-red-500/50" :
                          "text-muted-foreground"
                        )}>
                          {trade.outcomeStatus}
                        </Badge>
                      </td>
                      <td className={cn("py-1.5 px-2 text-right font-mono",
                        getPnlColor(trade.outcomeStatus, trade.percentGain)
                      )}>
                        {trade.percentGain !== null ? `${safeToFixed(trade.percentGain, 1)}%` : '—'}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        {trade.isWin ? (
                          <Badge className="bg-[var(--trade-bullish)]/20 text-[var(--trade-bullish)] text-[10px]">WIN</Badge>
                        ) : trade.isRealLoss ? (
                          <Badge className="bg-red-500/20 text-[var(--trade-bearish)] text-[10px]">LOSS</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">EXCL</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Reconciliation */}
        <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-xs">
          <p className="font-medium text-[var(--trade-bullish)] mb-2">Reconciliation Check</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-muted-foreground">Reported Wins</p>
              <p className="font-mono font-bold text-[var(--trade-bullish)]">{stats.segmentedWinRates.overall.wins}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Reported Losses</p>
              <p className="font-mono font-bold text-[var(--trade-bearish)]">{stats.segmentedWinRates.overall.losses}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Hit Rate <span className="font-mono">(n={stats.segmentedWinRates.overall.decided})</span></p>
              <p className="font-mono font-bold tabular-nums">{safeToFixed(stats.segmentedWinRates.overall.winRate, 1)}%</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// AUTO-LOTTO BOT SUMMARY - Compact view
// ============================================================
function BotSummary({ data, isLoading }: { data?: AutoLottoBotPerformance; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-20" />;
  if (!data) return null;

  return (
    <Card data-testid="bot-summary">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[var(--trade-neutral)]" />
            <span className="font-medium text-sm">Auto-Lotto Bot</span>
          </div>
          <Badge variant="outline" className="text-xs">
            {data.overall.openPositions} open
          </Badge>
        </div>
        <div className="grid grid-cols-4 gap-3 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Trades</p>
            <p className="font-mono font-bold tabular-nums">{data.overall.totalTrades}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Hit Rate</p>
            <p className={cn("font-mono font-bold", getWinRateColor(data.overall.winRate))}>
              {safeToFixed(data.overall.winRate, 0)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">W/L</p>
            <p className="font-mono">
              <span className="text-[var(--trade-bullish)]">{data.overall.wins}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-[var(--trade-bearish)]">{data.overall.losses}</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">P&L</p>
            <p className={cn("font-mono font-bold", data.overall.totalPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]")}>
              {data.overall.totalPnL >= 0 ? '+' : ''}${safeToFixed(data.overall.totalPnL, 0)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// MAIN PAGE COMPONENT - Simplified for users, detailed analytics tier-gated
// ============================================================
export default function PerformancePage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dateRange, setDateRange] = useState("all");
  const [engineFilter, setEngineFilter] = useState<string>("all");
  const [assetFilter, setAssetFilter] = useState<string>("all");
  const [isValidating, setIsValidating] = useState(false);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [validationResults, setValidationResults] = useState<any[]>([]);
  const [validationSummary, setValidationSummary] = useState({ validated: 0, updated: 0 });

  const apiFilters = useMemo(() => {
    let startDate: string | null = null;
    const now = new Date();
    switch (dateRange) {
      case 'today': startDate = format(startOfDay(now), 'yyyy-MM-dd'); break;
      case '7d': startDate = format(subDays(now, 7), 'yyyy-MM-dd'); break;
      case '30d': startDate = format(subDays(now, 30), 'yyyy-MM-dd'); break;
      case '3m': startDate = format(subMonths(now, 3), 'yyyy-MM-dd'); break;
    }
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (engineFilter !== 'all') params.append('source', engineFilter);
    if (assetFilter !== 'all') params.append('assetType', assetFilter);
    return params.toString() ? `?${params.toString()}` : '';
  }, [dateRange, engineFilter, assetFilter]);

  const perfInterval = useMarketPoll(POLL.METRICS.open, POLL.METRICS.closed);
  const { data: stats, isLoading, isError, refetch: refetchStats } = useQuery<PerformanceStats>({
    queryKey: ['/api/performance/stats', apiFilters],
    staleTime: 0, gcTime: 0, refetchOnMount: 'always',
    refetchInterval: perfInterval,
  });

  const handleExport = () => { window.location.href = '/api/performance/export'; };

  const handleValidate = async () => {
    setIsValidating(true);
    try {
      const response = await apiRequest('POST', '/api/performance/validate');
      const result = await response.json();
      setValidationResults(result.results || []);
      setValidationSummary({ validated: result.validated, updated: result.updated });
      setShowValidationDialog(true);
      toast({ title: "Validation Complete", description: `Validated ${result.validated} ideas, updated ${result.updated}` });
      queryClient.invalidateQueries({ queryKey: ['/api/performance/stats'] });
    } catch (error) {
      toast({ title: "Validation Failed", variant: "destructive" });
    } finally {
      setIsValidating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  // A fetch failure must not read as "no data".
  if (isError) {
    return (
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <Card className="p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-[var(--trade-bearish)] mx-auto mb-3" />
          <h2 className="text-lg font-semibold">Couldn't load performance data</h2>
          <p className="text-muted-foreground mt-1 text-sm">The request failed — your data is safe. Try again.</p>
          <Button className="mt-4" onClick={() => refetchStats()}>Retry</Button>
        </Card>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <Card className="p-6">
          <h2 className="text-xl font-bold">No Performance Data</h2>
          <p className="text-muted-foreground mt-2">Performance metrics will appear here once ideas start closing.</p>
        </Card>
      </div>
    );
  }

  const decidedCount = stats.segmentedWinRates?.overall?.decided ?? 0;
  const isFiltered = dateRange !== "all" || engineFilter !== "all" || assetFilter !== "all";

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-5 space-y-4">
      {/* Header — compact */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold text-foreground tracking-tight">Performance</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date range */}
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-24 h-7 text-xs" data-testid="select-date-range">
              <Calendar className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">7 Days</SelectItem>
              <SelectItem value="30d">30 Days</SelectItem>
              <SelectItem value="3m">3 Months</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>

          {/* Engine filter */}
          <Select value={engineFilter} onValueChange={setEngineFilter}>
            <SelectTrigger className="w-28 h-7 text-xs">
              <Brain className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Engines</SelectItem>
              <SelectItem value="quant">Quant</SelectItem>
              <SelectItem value="flow">Flow</SelectItem>
              <SelectItem value="ai">AI</SelectItem>
              <SelectItem value="lotto">Lotto</SelectItem>
            </SelectContent>
          </Select>

          {/* Asset type filter */}
          <Select value={assetFilter} onValueChange={setAssetFilter}>
            <SelectTrigger className="w-24 h-7 text-xs">
              <Activity className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assets</SelectItem>
              <SelectItem value="equities">Equities</SelectItem>
              <SelectItem value="options">Options</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport} aria-label="Export performance data" data-testid="button-export">
            <Download className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* User Performance Summary - Primary View.
          A fresh account (or a filtered period) with no decided ideas gets an
          inviting empty state instead of a hero full of zeros. */}
      {decidedCount === 0 ? (
        <Card className="p-8 text-center" data-testid="empty-performance">
          <Target className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-semibold">
            {isFiltered ? "No decided ideas in this view" : "No decided ideas yet"}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm max-w-md mx-auto">
            Ideas count toward hit rate and expectancy once they close — open ideas don't move these numbers.
            Check back after the next scan window.
          </p>
          {isFiltered && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => { setDateRange("all"); setEngineFilter("all"); setAssetFilter("all"); }}
            >
              Show all time
            </Button>
          )}
        </Card>
      ) : (
        <UserPerformanceSummary apiFilters={apiFilters} />
      )}

      {/* Advanced Analytics Toggle */}
      <div className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/10 border border-border/30">
        <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          ADVANCED ANALYTICS
        </div>
        <button
          type="button"
          className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? "HIDE" : "SHOW"}
        </button>
      </div>

      {/* Advanced Analytics - Collapsible */}
      {showAdvanced && (
        <div className="space-y-3 animate-in slide-in-from-top-2 duration-200">
          <TierGate feature="performance" blur>
            <Tabs defaultValue="overview" className="space-y-3">
              <TabsList className="grid w-full max-w-2xl grid-cols-6">
                <TabsTrigger value="overview" className="text-[10px] gap-1 font-mono" data-testid="tab-overview">
                  <TrendingUp className="h-3 w-3" />Trends
                </TabsTrigger>
                <TabsTrigger value="analytics" className="text-[10px] gap-1 font-mono" data-testid="tab-analytics">
                  <BarChart3 className="h-3 w-3" />Deep
                </TabsTrigger>
                <TabsTrigger value="backtest" className="text-[10px] gap-1 font-mono" data-testid="tab-backtest">
                  <Target className="h-3 w-3" />Patterns
                </TabsTrigger>
                <TabsTrigger value="historical" className="text-[10px] gap-1 font-mono" data-testid="tab-historical">
                  <History className="h-3 w-3" />History
                </TabsTrigger>
                <TabsTrigger value="audit" className="text-[10px] gap-1 font-mono" data-testid="tab-audit">
                  <Database className="h-3 w-3" />Audit
                </TabsTrigger>
                <TabsTrigger value="portfolio" className="text-[10px] gap-1 font-mono" data-testid="tab-portfolio">
                  <Wallet className="h-3 w-3" />Portfolio
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-[var(--trade-bullish)]" />
                      <CardTitle className="text-sm">Weekly Trends</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Suspense fallback={<ChartSkeleton />}>
                      <EngineTrendsChart />
                    </Suspense>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="analytics" className="space-y-4">
                {/* Conviction backtest sits at the top of analytics —
                    it's the headline answer to "is the engine working?" */}
                <Suspense fallback={<ChartSkeleton />}>
                  <ConvictionBacktestCard lookbackDays={90} />
                </Suspense>

                <Accordion type="multiple" className="space-y-2">
                  <AccordionItem value="engine-perf" className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline text-sm">
                      Actual Engine Performance
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <Suspense fallback={<ChartSkeleton />}><EngineActualPerformance /></Suspense>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="rolling-winrate" className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline text-sm">
                      Rolling Hit Rate Trends
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <Suspense fallback={<ChartSkeleton />}><RollingWinRateChart /></Suspense>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="drawdown" className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline text-sm">
                      Drawdown Analysis
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <Suspense fallback={<ChartSkeleton />}><DrawdownAnalysisChart /></Suspense>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="streaks" className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline text-sm">
                      Performance Streaks
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <Suspense fallback={<ChartSkeleton />}><StreakTracker /></Suspense>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="symbols" className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline text-sm">
                      Symbol Leaderboard
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <Suspense fallback={<ChartSkeleton />}><SymbolLeaderboard /></Suspense>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="time" className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline text-sm">
                      Time-of-Day Performance
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <Suspense fallback={<ChartSkeleton />}><TimeOfDayHeatmap /></Suspense>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="calibration" className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline text-sm">
                      Signal Calibration
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <Suspense fallback={<ChartSkeleton />}><ConfidenceCalibration /></Suspense>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="curve" className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline text-sm">
                      Calibration Curve
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <Suspense fallback={<ChartSkeleton />}><CalibrationCurve /></Suspense>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="losses" className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline text-sm">
                      Loss Patterns
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <Suspense fallback={<ChartSkeleton />}><LossPatternsDashboard /></Suspense>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="attribution" className="border rounded-lg">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline text-sm">
                      Signal Attribution
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      <Suspense fallback={<ChartSkeleton />}><SignalAttributionDashboard /></Suspense>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </TabsContent>

              <TabsContent value="backtest" className="space-y-4">
                <Suspense fallback={<ChartSkeleton />}>
                  <BacktestPage />
                </Suspense>
              </TabsContent>

              <TabsContent value="historical" className="space-y-4">
                <Suspense fallback={<ChartSkeleton />}>
                  <HistoricalIntelligenceTab />
                </Suspense>
              </TabsContent>

              <TabsContent value="audit" className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium">Data Integrity Audit</h3>
                  <Button variant="outline" size="sm" onClick={handleValidate} disabled={isValidating} data-testid="button-validate">
                    <Activity className={cn("w-3.5 h-3.5 mr-1.5", isValidating && 'animate-spin')} />
                    Validate All
                  </Button>
                </div>
                <DataIntegrityPanel stats={stats} />
              </TabsContent>

              <TabsContent value="portfolio" className="space-y-4">
                <BrokerImport />
              </TabsContent>
            </Tabs>
          </TierGate>
        </div>
      )}

      <RiskDisclosure />

      <ValidationResultsDialog
        open={showValidationDialog}
        onOpenChange={setShowValidationDialog}
        results={validationResults}
        summary={validationSummary}
      />
    </div>
  );
}
