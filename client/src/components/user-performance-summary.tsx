import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, TrendingUp, Zap, Award, Bot, Activity, BarChart3, Brain, CheckCircle, XCircle, AlertTriangle, Info } from "lucide-react";
import { cn, safeToFixed } from "@/lib/utils";
import { CanonRate } from "@/components/canon";

interface EngineMetrics {
  tradesWon: number;
  tradesLost: number;
  winRate: number | null;
  avgGainPercent: number | null;
}

interface EngineHealthData {
  weekMetrics: Record<string, EngineMetrics>;
}

interface PerformanceStats {
  overall: {
    totalIdeas: number;
    winRate: number;
    avgPercentGain: number;
    expectancy: number | null;
    profitFactor: number | null;
  };
  segmentedWinRates: {
    overall: {
      winRate: number;
      wins: number;
      losses: number;
      decided: number;
    };
  };
}

interface AutoLottoBotPerformance {
  overall: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnL: number;
  };
}

// Convert hit rate to letter grade
function getGrade(winRate: number | null): { grade: string; color: string; bgColor: string } {
  if (winRate === null) return { grade: "?", color: "text-muted-foreground", bgColor: "bg-muted/20" };
  if (winRate >= 80) return { grade: "A+", color: "text-[var(--trade-bullish)]", bgColor: "bg-[var(--trade-bullish)]/10" };
  if (winRate >= 70) return { grade: "A", color: "text-[var(--trade-bullish)]", bgColor: "bg-[var(--trade-bullish)]/10" };
  if (winRate >= 60) return { grade: "B", color: "text-sky-400", bgColor: "bg-sky-500/10" };
  if (winRate >= 50) return { grade: "C", color: "text-[var(--trade-neutral)]", bgColor: "bg-amber-500/10" };
  if (winRate >= 40) return { grade: "D", color: "text-orange-400", bgColor: "bg-orange-500/10" };
  return { grade: "F", color: "text-[var(--trade-bearish)]", bgColor: "bg-red-500/10" };
}

function getWinRateColor(rate: number | null): string {
  if (rate === null) return "text-muted-foreground";
  if (rate >= 70) return "text-[var(--trade-bullish)]";
  if (rate >= 50) return "text-[var(--trade-neutral)]";
  return "text-[var(--trade-bearish)]";
}

const ENGINE_CONFIG = {
  flow: { label: "Flow", icon: Activity, description: "Options flow signals" },
  quant: { label: "Quant", icon: BarChart3, description: "Statistical analysis" },
  ai: { label: "AI", icon: Brain, description: "AI pattern recognition" },
  lotto: { label: "Lotto", icon: Target, description: "High-risk plays" },
} as const;

type EngineKey = keyof typeof ENGINE_CONFIG;

export function UserPerformanceSummary({ apiFilters = "" }: { apiFilters?: string }) {
  const { data: stats, isLoading: isStatsLoading } = useQuery<PerformanceStats>({
    // Same key as the page-level stats query (including active filters) so the
    // hero always reflects the selected period — one cached fetch, not two.
    queryKey: ['/api/performance/stats', apiFilters],
    staleTime: 60000,
  });

  const { data: engineHealthData, isLoading: isEngineLoading } = useQuery<EngineHealthData>({
    queryKey: ["/api/engine-health"],
    staleTime: 30000,
  });

  const { data: botData, isLoading: isBotLoading } = useQuery<AutoLottoBotPerformance>({
    queryKey: ["/api/performance/auto-lotto-bot"],
    staleTime: 30000,
  });

  const isLoading = isStatsLoading || isEngineLoading || isBotLoading;

  if (isLoading) {
    // Viewport-tall placeholder: the finished summary is ~1,200px on a phone,
    // and a 350px skeleton made everything below jump when it arrived
    // (CLS 0.54 measured 2026-09-24). Below-the-fold content can't shift.
    return (
      <div className="min-h-[100dvh] space-y-6" aria-busy="true">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  const overallWinRate = stats?.segmentedWinRates?.overall?.winRate ?? 0;
  const totalDecided = stats?.segmentedWinRates?.overall?.decided ?? 0;
  const wins = stats?.segmentedWinRates?.overall?.wins ?? 0;
  const losses = stats?.segmentedWinRates?.overall?.losses ?? 0;
  const overallGrade = getGrade(overallWinRate);
  // Hero metric: expectancy = (win% x avg win) - (loss% x avg loss), in
  // percentage points per idea. It answers "do the engines make money" in a
  // way hit rate alone can't — a 70% hit rate with a bad win/loss size ratio
  // still loses money.
  const expectancy = stats?.overall?.expectancy ?? null;

  const engines: EngineKey[] = ["flow", "quant", "ai", "lotto"];

  return (
    <div className="space-y-6">
      {/* Hero — expectancy leads (the one number that answers "do the engines
          make money"); the grade tile anchors trust, hit rate stays visible
          as the secondary stat. */}
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-sky-500/5 via-transparent to-purple-500/5" />
        <CardContent className="relative p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            {/* Main: grade tile + expectancy */}
            <div className="flex items-center gap-6">
              <div className={cn(
                "h-20 w-20 rounded-2xl flex items-center justify-center text-3xl font-bold",
                overallGrade.bgColor, overallGrade.color
              )}>
                {overallGrade.grade}
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <p className="text-sm text-muted-foreground uppercase tracking-wider">Expectancy</p>
                  <span className="text-xs text-muted-foreground font-mono">n={totalDecided}</span>
                  <span className="group relative inline-block">
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    <span className="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 bottom-full mb-1 w-52 p-2 text-[10px] bg-popover text-popover-foreground border rounded shadow-lg z-50">
                      Your edge per idea: (win% &#215; avg win) &#8722; (loss% &#215; avg loss). Positive means the engines make money on average; negative means they lose it.
                    </span>
                  </span>
                </div>
                <p className={cn("text-4xl font-bold font-mono", expectancy === null ? "text-muted-foreground" : expectancy < 0 ? "text-[var(--trade-bearish)]" : "text-[var(--trade-bullish)]")}>
                  {expectancy === null ? '—' : `${expectancy >= 0 ? '+' : ''}${safeToFixed(expectancy, 1)}%`}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {expectancy === null
                    ? 'No decided ideas in this period'
                    : expectancy > 0
                      ? `Positive edge — about ${safeToFixed(expectancy, 1)}% per idea across ${totalDecided} decided.`
                      : expectancy < 0
                        ? `Negative edge — about ${safeToFixed(Math.abs(expectancy), 1)}% lost per idea across ${totalDecided} decided.`
                        : 'Breakeven — no measurable edge yet.'}
                </p>
              </div>
            </div>

            {/* Quick Stats — Bot P&L intentionally omitted: the dedicated
                Auto-Lotto card below is its canonical home. */}
            <div className="flex gap-6">
              <div className="text-center">
                <p className="text-xs text-muted-foreground uppercase">Hit Rate</p>
                <p className={cn("text-2xl font-bold font-mono", getWinRateColor(overallWinRate))}>
                  {safeToFixed(overallWinRate, 0)}%
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{wins}W/{losses}L</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground uppercase">Total Ideas</p>
                <p className="text-2xl font-bold font-mono text-sky-400">{stats?.overall?.totalIdeas ?? 0}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground uppercase">Avg Gain</p>
                <p className={cn(
                  "text-2xl font-bold font-mono",
                  (stats?.overall?.avgPercentGain ?? 0) >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                )}>
                  {(stats?.overall?.avgPercentGain ?? 0) >= 0 ? '+' : ''}{safeToFixed(stats?.overall?.avgPercentGain ?? 0, 1)}%
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Engine Reliability Grades */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Engine Performance
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {engines.map((key) => {
            const config = ENGINE_CONFIG[key];
            const Icon = config.icon;
            const metrics = engineHealthData?.weekMetrics?.[key];
            const winRate = metrics?.winRate ?? null;
            const grade = getGrade(winRate);

            return (
              <Card key={key} className="hover-elevate">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{config.label}</span>
                    </div>
                    <div className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center text-sm font-bold",
                      grade.bgColor, grade.color
                    )}>
                      {grade.grade}
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className={cn("text-xl font-bold font-mono", getWinRateColor(winRate))}>
                      {winRate !== null ? `${safeToFixed(winRate, 0)}%` : '—'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      hit rate{(metrics?.tradesWon ?? 0) + (metrics?.tradesLost ?? 0) > 0 && (
                        <span className="font-mono ml-1">n={(metrics?.tradesWon ?? 0) + (metrics?.tradesLost ?? 0)}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CheckCircle className="h-3 w-3 text-[var(--trade-bullish)]" />
                      {metrics?.tradesWon ?? 0}
                    </span>
                    <span className="flex items-center gap-1">
                      <XCircle className="h-3 w-3 text-[var(--trade-bearish)]" />
                      {metrics?.tradesLost ?? 0}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Auto-Lotto Bot Summary */}
      {botData && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-[var(--trade-neutral)]" />
                <CardTitle className="text-base">Auto-Lotto Bot</CardTitle>
              </div>
              <Badge variant="outline" className="text-xs">
                Live Trading
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground uppercase">Trades</p>
                <p className="text-xl font-bold font-mono tabular-nums">{botData.overall.totalTrades}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Hit Rate</p>
                {/* Was `${winRate}%`, which printed a red 0% for a bot that had
                    taken zero trades — the card's own TRADES 0 · W/L 0/0 said so
                    in the same row. CanonRate suppresses the percentage below the
                    sample floor and says which kind of "no number" this is. */}
                <CanonRate
                  className="text-xl"
                  wins={botData.overall.wins}
                  decided={botData.overall.wins + botData.overall.losses}
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">W/L</p>
                <p className="font-mono text-lg">
                  <span className="text-[var(--trade-bullish)]">{botData.overall.wins}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-[var(--trade-bearish)]">{botData.overall.losses}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Total P&L</p>
                <p className={cn(
                  "text-xl font-bold font-mono",
                  botData.overall.totalPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                )}>
                  {botData.overall.totalPnL >= 0 ? '+' : ''}${safeToFixed(botData.overall.totalPnL, 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Flow/Lotto Disclosure */}
      <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/20 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-[var(--trade-neutral)] mt-0.5 shrink-0" />
        <span>
          <strong>Options validation under maintenance</strong> — Flow (1,127) and Lotto (341) ideas excluded from stats.
          Option-premium pricing is being rebuilt; these engines will return once validation is reliable.
        </span>
      </div>

      {/* What This Means Section */}
      <Card className="bg-muted/20 border-dashed">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-sky-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium mb-1">What do these numbers mean?</p>
              <p className="text-muted-foreground">
                Our trading engines analyze market data to generate trade ideas. The hit rate shows
                how often ideas hit their target vs stop loss (count-based, not P&L-weighted).
                Trades within &#177;3% of entry are excluded as breakeven. A <span className="text-[var(--trade-bullish)] font-medium">70%+ hit rate</span> indicates
                strong reliability. Engine grades (A-F) help you quickly compare performance across different strategies. Expectancy is your edge per idea — a positive expectancy means the strategy makes money on average, even with a modest hit rate.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default UserPerformanceSummary;
