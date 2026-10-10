import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Activity, TrendingUp, TrendingDown, Award, AlertTriangle, Zap, Brain, BarChart3, Target, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface EngineStats {
  engine: string;
  displayName: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgGain: number;
  avgWin: number;
  avgLoss: number;
  stdDev: number;
  confidenceInterval: { lower: number; upper: number };
  sampleSizeGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  profitFactor: number | string;
  expectancy: number;
  sharpeRatio: number;
  isStatisticallySignificant: boolean;
}

interface EngineActualStatsData {
  engines: EngineStats[];
  summary: {
    totalResolvedTrades: number;
    bestEngine: string;
    bestWinRate: number;
    worstEngine: string;
    worstWinRate: number;
    overallSharpeRatio: number;
    maxDrawdown: number;
    lastUpdated: string;
  };
}

const getEngineIcon = (engine: string) => {
  switch (engine.toLowerCase()) {
    case 'flow': return <Zap className="h-4 w-4" />;
    case 'ai': return <Brain className="h-4 w-4" />;
    case 'quant': return <BarChart3 className="h-4 w-4" />;
    case 'hybrid': return <Activity className="h-4 w-4" />;
    default: return <Target className="h-4 w-4" />;
  }
};

const getWinRateColor = (winRate: number) => {
  if (winRate >= 70) return "text-[var(--trade-bullish)]";
  if (winRate >= 50) return "text-[var(--trade-neutral)]";
  return "text-[var(--trade-bearish)]";
};

const getWinRateBg = (winRate: number) => {
  if (winRate >= 70) return "bg-[var(--trade-bullish)]";
  if (winRate >= 50) return "bg-amber-500";
  return "bg-red-500";
};

const getGradeColor = (grade: string) => {
  switch (grade) {
    case 'A': return 'bg-[var(--trade-bullish)]/20 text-[var(--trade-bullish)] border-green-500/30';
    case 'B': return 'bg-sky-500/20 text-sky-500 border-sky-500/30';
    case 'C': return 'bg-amber-500/20 text-[var(--trade-neutral)] border-amber-500/30';
    case 'D': return 'bg-orange-500/20 text-orange-500 border-orange-500/30';
    case 'F': return 'bg-red-500/20 text-[var(--trade-bearish)] border-red-500/30';
    default: return 'bg-muted text-muted-foreground';
  }
};

const getSharpeColor = (sharpe: number) => {
  if (sharpe >= 1) return "text-[var(--trade-bullish)]";
  if (sharpe >= 0.5) return "text-sky-500";
  if (sharpe >= 0) return "text-[var(--trade-neutral)]";
  return "text-[var(--trade-bearish)]";
};

export default function EngineActualPerformance() {
  const { data, isLoading, error } = useQuery<EngineActualStatsData>({
    queryKey: ['/api/performance/engine-actual-stats'],
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-engine-performance-loading">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card data-testid="card-engine-performance-error">
        <CardHeader>
          <CardTitle>Engine Performance</CardTitle>
          <CardDescription>Actual win rates by engine</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Failed to load engine performance data.</p>
        </CardContent>
      </Card>
    );
  }

  const { engines, summary } = data;

  return (
    <Card data-testid="card-engine-actual-performance">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-primary" />
              Engine Performance Analytics
            </CardTitle>
            <CardDescription>
              Statistical analysis from {summary.totalResolvedTrades} resolved trades
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            Updated: {new Date(summary.lastUpdated).toLocaleDateString()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <p className="text-xs text-muted-foreground">Best Engine</p>
            <p className="font-semibold text-[var(--trade-bullish)]">{summary.bestEngine}</p>
            <p className="text-xs font-mono text-[var(--trade-bullish)]">{summary.bestWinRate}% win rate</p>
          </div>
          <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
            <p className="text-xs text-muted-foreground">Sharpe Ratio</p>
            <p className={cn("font-semibold font-mono", getSharpeColor(summary.overallSharpeRatio))}>
              {summary.overallSharpeRatio}
            </p>
            <p className="text-xs text-muted-foreground">
              {summary.overallSharpeRatio >= 1 ? 'Excellent' : summary.overallSharpeRatio >= 0.5 ? 'Good' : 'Fair'}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-muted-foreground">Max Drawdown</p>
            <p className="font-semibold font-mono text-[var(--trade-bearish)]">-{summary.maxDrawdown}%</p>
            <p className="text-xs text-muted-foreground">Largest peak-to-trough</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border">
            <p className="text-xs text-muted-foreground">Total Trades</p>
            <p className="font-semibold font-mono">{summary.totalResolvedTrades}</p>
            <p className="text-xs text-muted-foreground">Resolved positions</p>
          </div>
        </div>

        <div className="space-y-3">
          {engines.map((engine, index) => (
            <div 
              key={engine.engine}
              className={cn(
                "p-4 rounded-lg border transition-colors",
                index === 0 ? "bg-[var(--trade-bullish)]/5 border-green-500/20" : "bg-muted/30"
              )}
              data-testid={`engine-stats-${engine.engine}`}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2 rounded-md",
                    index === 0 ? "bg-[var(--trade-bullish)]/20 text-[var(--trade-bullish)]" : "bg-muted text-muted-foreground"
                  )}>
                    {getEngineIcon(engine.engine)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{engine.displayName}</p>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge variant="outline" className={cn("text-[10px]", getGradeColor(engine.sampleSizeGrade))}>
                              {engine.sampleSizeGrade}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs font-medium">Sample Size Grade: {engine.sampleSizeGrade}</p>
                            <p className="text-xs text-muted-foreground">
                              {engine.totalTrades >= 100 ? 'Highly reliable (100+ trades)' :
                               engine.totalTrades >= 50 ? 'Reliable (50+ trades)' :
                               engine.totalTrades >= 30 ? 'Statistically significant (30+ trades)' :
                               'Low sample size - interpret with caution'}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {!engine.isStatisticallySignificant && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <AlertTriangle className="h-3 w-3 text-[var(--trade-neutral)]" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Low sample size (n&lt;30)</p>
                              <p className="text-xs text-muted-foreground">Results may not be statistically reliable</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {engine.totalTrades} trades ({engine.wins}W / {engine.losses}L)
                    </p>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="flex items-baseline gap-1 justify-end">
                    <p className={cn("text-2xl font-bold font-mono", getWinRateColor(engine.winRate))}>
                      {engine.winRate}%
                    </p>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs font-medium">95% Confidence Interval</p>
                          <p className="text-xs font-mono">{engine.confidenceInterval.lower}% - {engine.confidenceInterval.upper}%</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">
                    CI: [{engine.confidenceInterval.lower}%, {engine.confidenceInterval.upper}%]
                  </p>
                </div>
              </div>
              
              <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-muted-foreground">Avg Win</p>
                  <p className="font-mono text-[var(--trade-bullish)]">+{engine.avgWin}%</p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-muted-foreground">Avg Loss</p>
                  <p className="font-mono text-[var(--trade-bearish)]">-{engine.avgLoss}%</p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-muted-foreground">Profit Factor</p>
                  <p className={cn("font-mono", 
                    typeof engine.profitFactor === 'number' && engine.profitFactor >= 1.5 ? "text-[var(--trade-bullish)]" :
                    typeof engine.profitFactor === 'number' && engine.profitFactor >= 1 ? "text-[var(--trade-neutral)]" : "text-[var(--trade-bearish)]"
                  )}>
                    {engine.profitFactor}
                  </p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-muted-foreground">Expectancy</p>
                  <p className={cn("font-mono", engine.expectancy >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]")}>
                    {engine.expectancy >= 0 ? '+' : ''}{engine.expectancy}%
                  </p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-muted-foreground">Sharpe</p>
                  <p className={cn("font-mono", getSharpeColor(engine.sharpeRatio))}>
                    {engine.sharpeRatio}
                  </p>
                </div>
              </div>
              
              <div className="mt-3">
                <Progress 
                  value={engine.winRate} 
                  className={cn("h-1.5", getWinRateBg(engine.winRate))}
                />
              </div>
            </div>
          ))}
        </div>

        {engines.some(e => !e.isStatisticallySignificant) && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-[var(--trade-neutral)] mt-0.5 shrink-0" />
            <div className="text-sm text-amber-600 dark:text-[var(--trade-neutral)]">
              <p className="font-medium">Statistical Significance Warning</p>
              <p className="text-xs mt-1 text-[var(--trade-neutral)]/80">
                Some engines have fewer than 30 trades. Results marked with grade D/F may not be statistically reliable.
                A minimum of 30 samples is required for 95% confidence intervals to be meaningful.
              </p>
            </div>
          </div>
        )}

        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Methodology:</span> Win Rate uses hit_target/hit_stop outcomes. 
            Sharpe Ratio = Avg Return / Std Dev. Profit Factor = Gross Wins / Gross Losses.
            Expectancy = (Win% x Avg Win) - (Loss% x Avg Loss). 95% CI uses normal approximation.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
