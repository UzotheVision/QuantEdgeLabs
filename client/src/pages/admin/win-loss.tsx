import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, safeToFixed } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  Download,
  RefreshCw,
  Shield,
  BarChart3,
  Activity,
  Zap,
  Info,
  CircleDot,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
} from "lucide-react";
import {
  Line,
  BarChart,
  Bar,
  ComposedChart,
  Area,
  ReferenceLine,
  Cell,
} from "recharts";
import {
  AnalyticsChart,
  AnalyticsTooltip,
  AnalyticsXAxis,
  AnalyticsYAxis,
  AnalyticsGrid,
  AnalyticsGradient,
  CHART_COLORS,
} from "@/components/ui/analytics-chart";

/** Recharts value union — keeps tooltip formatters assignable to the themed
 *  tooltip's non-generic Formatter<ValueType, NameType> prop. */
type ChartValue = number | string | Array<number | string>;

import { useToast } from "@/hooks/use-toast";

interface WinLossSummary {
  totalTrades: number;
  decidedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  expired: number;
  winRate: number;
  winRateCI: { center: number; lower: number; upper: number };
  avgWinPercent: number;
  avgLossPercent: number;
  maxWinPercent: number;
  maxLossPercent: number;
  profitFactor: number | string;
  expectancy: number;
  payoffRatio: number;
  distribution: Array<{ range: string; count: number; wins: number; losses: number }>;
  lossPatterns: Array<{ reason: string; count: number; avgLoss: number }>;
  byAssetType: Array<{ assetType: string; totalTrades: number; wins: number; losses: number; winRate: number; avgGain: number }>;
  bySource: Array<{ source: string; totalTrades: number; wins: number; losses: number; winRate: number; avgGain: number }>;
  sampleReliability: 'high' | 'medium' | 'low';
}

interface StopLossSimulation {
  thresholdPercent: number;
  wins: number;
  losses: number;
  breakeven: number;
  decidedTrades: number;
  winRate: number;
  winRateLower: number;
  winRateUpper: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  profitFactor: number;
}

interface StopLossSimData {
  simulations: StopLossSimulation[];
  optimalThreshold: {
    thresholdPercent: number;
    expectedWinRate: number;
    expectancy: number;
    profitFactor: number;
    rationale: string;
  } | null;
  totalTrades: number;
  sampleReliability: 'high' | 'medium' | 'low';
}

interface ExpirationTrade {
  id: string;
  symbol: string;
  assetType: string;
  direction: string;
  holdingPeriod: string;
  source: string;
  confidenceScore: number | null;
  timestamp: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  targetDistancePercent: number;
  stopDistancePercent: number;
  riskRewardRatio: number | null;
  highestReached: number;
  lowestReached: number;
  peakTowardsTargetPercent: number;
  peakAwayFromTargetPercent: number;
  progressToTargetPercent: number;
  neededMorePercent: number;
  almostHitTarget: boolean;
  veryClose: boolean;
  wouldHaveHitStop: boolean;
  holdingTimeMinutes: number | null;
  exitBy: string | null;
  entryValidUntil: string | null;
  priceAtExpiration: number | null;
  priceAtPublish: number | null;
}

interface ExpirationAnalysisData {
  summary: {
    totalExpired: number;
    almostHitTargetCount?: number;
    almostHitTargetPercent?: number;
    veryCloseCount?: number;
    veryClosePercent?: number;
    wouldHaveHitStopCount?: number;
    wouldHaveHitStopPercent?: number;
    avgProgressToTarget?: number;
    avgNeededMorePercent?: number;
    message?: string;
  };
  byHoldingPeriod: Array<{
    period: string;
    count: number;
    almostHitTargetCount: number;
    almostHitTargetPercent: number;
    avgProgressToTarget: number;
    avgNeededMorePercent: number;
  }>;
  byAssetType: Array<{
    assetType: string;
    count: number;
    almostHitTargetPercent: number;
    avgProgressToTarget: number;
  }>;
  trades: ExpirationTrade[];
  recommendations: Array<{
    type: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    data?: any;
  }>;
  reliability: 'high' | 'medium' | 'low';
}

export default function AdminWinLossAnalysis() {
  const [, setLocation] = useLocation();
  const [stopLossThreshold, setStopLossThreshold] = useState<number>(3);
  const { toast } = useToast();

  const { data: authCheck, isLoading: authLoading } = useQuery({
    queryKey: ["/api/admin/check-auth"],
    queryFn: async () => {
      const res = await fetch("/api/admin/check-auth", {
        credentials: "include",
      });
      return res.ok;
    },
    retry: false,
  });

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery<WinLossSummary>({
    queryKey: ["/api/admin/win-loss/summary"],
    enabled: !!authCheck,
    queryFn: async () => {
      const res = await fetch("/api/admin/win-loss/summary", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch win/loss summary");
      return res.json();
    },
  });

  const { data: simData, isLoading: simLoading } = useQuery<StopLossSimData>({
    queryKey: ["/api/admin/win-loss/stop-loss-sim"],
    enabled: !!authCheck,
    queryFn: async () => {
      const res = await fetch("/api/admin/win-loss/stop-loss-sim", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch stop-loss simulation");
      return res.json();
    },
  });

  const { data: expirationData, isLoading: expirationLoading } = useQuery<ExpirationAnalysisData>({
    queryKey: ["/api/admin/win-loss/expiration-analysis"],
    enabled: !!authCheck,
    queryFn: async () => {
      const res = await fetch("/api/admin/win-loss/expiration-analysis", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch expiration analysis");
      return res.json();
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/win-loss/export", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to export data");
      return res.json();
    },
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ml-training-data-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Export complete", description: `Exported ${data.metadata.totalRecords} records` });
    },
    onError: () => {
      toast({ title: "Export failed", variant: "destructive" });
    },
  });

  if (authLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-sky-400" data-testid="loading-spinner" />
      </div>
    );
  }

  if (!authCheck) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Card className="glass-card w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[var(--trade-neutral)]" />
              Admin Access Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Please authenticate via the Admin Panel first.
            </p>
            <Button 
              onClick={() => setLocation("/admin")} 
              data-testid="button-go-to-admin"
              className="bg-sky-500 hover:bg-sky-400 text-foreground"
            >
              Go to Admin Panel
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentSimulation = simData?.simulations?.find(s => s.thresholdPercent === stopLossThreshold);
  const reliabilityColor = summary?.sampleReliability === 'high' ? 'text-[var(--trade-bullish)]' : 
                          summary?.sampleReliability === 'medium' ? 'text-[var(--trade-neutral)]' : 'text-[var(--trade-bearish)]';

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-sky-400" />
            Win/Loss Analysis
          </h1>
          <p className="text-muted-foreground">Institutional-grade trade performance analytics</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={reliabilityColor}>
            {summary?.sampleReliability?.toUpperCase()} RELIABILITY
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchSummary()}
            data-testid="button-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            data-testid="button-export"
            className="bg-sky-500 hover:bg-sky-400 text-foreground"
          >
            <Download className="h-4 w-4 mr-1" />
            Export ML Data
          </Button>
        </div>
      </div>

      {summaryLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-sky-400" />
        </div>
      ) : summary ? (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="stop-loss" data-testid="tab-stop-loss">Stop-Loss Simulator</TabsTrigger>
            <TabsTrigger value="expiration" data-testid="tab-expiration">
              <Clock className="h-4 w-4 mr-1" />
              Expiration Analysis
            </TabsTrigger>
            <TabsTrigger value="breakdown" data-testid="tab-breakdown">Breakdown</TabsTrigger>
            <TabsTrigger value="patterns" data-testid="tab-patterns">Loss Patterns</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <Card className="bg-[var(--trade-bullish)]/10 border-green-500/20">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Wins</p>
                  <p className="text-2xl font-bold text-[var(--trade-bullish)]" data-testid="text-wins">{summary.wins}</p>
                  <p className="text-xs text-muted-foreground">of {summary.decidedTrades}</p>
                </CardContent>
              </Card>
              <Card className="bg-red-500/10 border-red-500/20">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Losses</p>
                  <p className="text-2xl font-bold text-[var(--trade-bearish)]" data-testid="text-losses">{summary.losses}</p>
                  <p className="text-xs text-muted-foreground">&gt;3% drawdown</p>
                </CardContent>
              </Card>
              <Card className="bg-amber-500/10 border-amber-500/20">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">Breakeven</p>
                  <p className="text-2xl font-bold text-[var(--trade-neutral)]">{summary.breakeven}</p>
                  <p className="text-xs text-muted-foreground">&lt;3% loss</p>
                </CardContent>
              </Card>
              <Card className="bg-sky-500/10 border-sky-500/20">
                <CardContent className="p-4">
                  <TooltipProvider>
                    <TooltipUI>
                      <TooltipTrigger className="w-full text-left">
                        <p className="text-xs text-muted-foreground">Win Rate</p>
                        <p className="text-2xl font-bold text-sky-500" data-testid="text-win-rate">{summary.winRate}%</p>
                        <p className="text-xs text-muted-foreground">
                          [{summary.winRateCI.lower}%-{summary.winRateCI.upper}%]
                        </p>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">Wilson Score 95% Confidence Interval</p>
                        <p className="text-xs text-muted-foreground">True win rate is likely between {summary.winRateCI.lower}% and {summary.winRateCI.upper}%</p>
                      </TooltipContent>
                    </TooltipUI>
                  </TooltipProvider>
                </CardContent>
              </Card>
              <Card className="bg-purple-500/10 border-purple-500/20">
                <CardContent className="p-4">
                  <TooltipProvider>
                    <TooltipUI>
                      <TooltipTrigger className="w-full text-left">
                        <p className="text-xs text-muted-foreground">Expectancy</p>
                        <p className={cn("text-2xl font-bold", summary.expectancy >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]")} data-testid="text-expectancy">
                          {summary.expectancy >= 0 ? '+' : ''}{summary.expectancy}%
                        </p>
                        <p className="text-xs text-muted-foreground">per trade</p>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">Expected return per trade</p>
                        <p className="text-xs text-muted-foreground">= (WinRate × AvgWin) + (LossRate × AvgLoss)</p>
                      </TooltipContent>
                    </TooltipUI>
                  </TooltipProvider>
                </CardContent>
              </Card>
              <Card className="bg-blue-500/10 border-blue-500/20">
                <CardContent className="p-4">
                  <TooltipProvider>
                    <TooltipUI>
                      <TooltipTrigger className="w-full text-left">
                        <p className="text-xs text-muted-foreground">Profit Factor</p>
                        <p className={cn("text-2xl font-bold", 
                          typeof summary.profitFactor === 'number' && summary.profitFactor >= 1.5 ? "text-[var(--trade-bullish)]" :
                          typeof summary.profitFactor === 'number' && summary.profitFactor >= 1 ? "text-sky-500" : "text-[var(--trade-bearish)]"
                        )} data-testid="text-profit-factor">
                          {summary.profitFactor}
                        </p>
                        <p className="text-xs text-muted-foreground">&gt;1.5 = strong</p>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">Gross Profit / Gross Loss</p>
                        <p className="text-xs text-muted-foreground">&gt;1.5 indicates strong risk-adjusted returns</p>
                      </TooltipContent>
                    </TooltipUI>
                  </TooltipProvider>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Average Win vs Loss</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Avg Win</span>
                    <span className="text-[var(--trade-bullish)] font-mono font-semibold">+{summary.avgWinPercent}%</span>
                  </div>
                  <Progress value={Math.min(100, summary.avgWinPercent * 5)} className="h-2 bg-[var(--trade-bullish)]/20" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Avg Loss</span>
                    <span className="text-[var(--trade-bearish)] font-mono font-semibold">{summary.avgLossPercent}%</span>
                  </div>
                  <Progress value={Math.min(100, Math.abs(summary.avgLossPercent) * 5)} className="h-2 bg-red-500/20" />
                  <div className="pt-2 border-t flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Payoff Ratio</span>
                    <span className={cn("font-mono font-semibold", summary.payoffRatio >= 1.5 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-neutral)]")}>
                      {summary.payoffRatio}:1
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Return Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-48">
                    <AnalyticsChart config={{}} className="h-full">
                      <BarChart data={summary.distribution.filter(d => d.count > 0)}>
                        <AnalyticsGrid opacity={0.5} />
                        <AnalyticsXAxis dataKey="range" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--fs-9, 9px)' }} interval={0} angle={-45} textAnchor="end" height={60} />
                        <AnalyticsYAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--fs-10, 10px)' }} />
                        <AnalyticsTooltip />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {summary.distribution.filter(d => d.count > 0).map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={entry.range.includes('-') && !entry.range.includes('to') ? CHART_COLORS.bear : 
                                    entry.range.startsWith('-') ? CHART_COLORS.bear : CHART_COLORS.bull}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </AnalyticsChart>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Info className="h-4 w-4 text-sky-400" />
                  Key Metrics Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Max Win</p>
                    <p className="text-[var(--trade-bullish)] font-mono">+{summary.maxWinPercent}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Max Loss</p>
                    <p className="text-[var(--trade-bearish)] font-mono">{summary.maxLossPercent}%</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Expired Trades</p>
                    <p className="font-mono">{summary.expired}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Total Resolved</p>
                    <p className="font-mono">{summary.totalTrades}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stop-loss" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-[var(--trade-neutral)]" />
                  Stop-Loss Threshold Simulator
                </CardTitle>
                <CardDescription>
                  Adjust the stop-loss threshold to see how it affects win rate and expectancy
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Stop-Loss Threshold</span>
                    <Badge variant="secondary" className="font-mono">{stopLossThreshold}%</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 py-2">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20].map((threshold) => (
                      <Button
                        key={threshold}
                        variant={stopLossThreshold === threshold ? "default" : "outline"}
                        size="sm"
                        onClick={() => setStopLossThreshold(threshold)}
                        className={cn(
                          "min-w-[48px] font-mono",
                          stopLossThreshold === threshold && "bg-sky-500 hover:bg-sky-400 text-foreground"
                        )}
                        data-testid={`button-threshold-${threshold}`}
                      >
                        {threshold}%
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Trades with loss &gt; {stopLossThreshold}% count as losses
                  </p>
                </div>

                {currentSimulation && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
                      <p className="text-xs text-muted-foreground">Win Rate at {stopLossThreshold}%</p>
                      <p className="text-xl font-bold text-sky-500">{currentSimulation.winRate}%</p>
                      <p className="text-xs text-muted-foreground">[{currentSimulation.winRateLower}%-{currentSimulation.winRateUpper}%]</p>
                    </div>
                    <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                      <p className="text-xs text-muted-foreground">Expectancy</p>
                      <p className={cn("text-xl font-bold", currentSimulation.expectancy >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]")}>
                        {currentSimulation.expectancy >= 0 ? '+' : ''}{currentSimulation.expectancy}%
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <p className="text-xs text-muted-foreground">Losses Counted</p>
                      <p className="text-xl font-bold text-[var(--trade-neutral)]">{currentSimulation.losses}</p>
                      <p className="text-xs text-muted-foreground">{currentSimulation.breakeven} breakeven</p>
                    </div>
                    <div className="p-3 rounded-lg bg-[var(--trade-bullish)]/10 border border-green-500/20">
                      <p className="text-xs text-muted-foreground">Profit Factor</p>
                      <p className="text-xl font-bold text-[var(--trade-bullish)]">
                        {currentSimulation.profitFactor === Infinity ? '∞' : currentSimulation.profitFactor}
                      </p>
                    </div>
                  </div>
                )}

                {simData?.optimalThreshold && (
                  <div className="p-4 rounded-lg bg-gradient-to-r from-sky-500/10 to-purple-500/10 border border-sky-500/20">
                    <div className="flex items-start gap-3">
                      <Target className="h-5 w-5 text-sky-400 mt-0.5" />
                      <div>
                        <p className="font-semibold text-sky-400">Optimal Threshold: {simData.optimalThreshold.thresholdPercent}%</p>
                        <p className="text-sm text-muted-foreground">{simData.optimalThreshold.rationale}</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {simData?.simulations && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Win Rate & Expectancy by Threshold</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <AnalyticsChart config={{}} className="h-full">
                      <ComposedChart data={simData.simulations}>
                        <defs>
                          <AnalyticsGradient id="wl-winrate-fill" color={CHART_COLORS.accent} />
                        </defs>
                        <AnalyticsGrid opacity={0.5} />
                        <AnalyticsXAxis 
                          dataKey="thresholdPercent" 
                          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--fs-10, 10px)' }}
                          tickFormatter={(val) => `${val}%`}
                          label={{ value: 'Stop-Loss Threshold', position: 'insideBottom', offset: -5, fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--fs-10, 10px)' }}
                        />
                        <AnalyticsYAxis 
                          yAxisId="left"
                          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--fs-10, 10px)' }}
                          tickFormatter={(val) => `${val}%`}
                          label={{ value: 'Win Rate', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--fs-10, 10px)' }}
                        />
                        <AnalyticsYAxis 
                          yAxisId="right"
                          orientation="right"
                          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--fs-10, 10px)' }}
                          tickFormatter={(val) => `${val}%`}
                          label={{ value: 'Expectancy', angle: 90, position: 'insideRight', fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--fs-10, 10px)' }}
                        />
                        <AnalyticsTooltip 
                          formatter={(value: ChartValue, name: number | string) => [`${value}%`, name === 'winRate' ? 'Win Rate' : 'Expectancy']}
                        />
                        <ReferenceLine y={0} yAxisId="right" stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                        {simData.optimalThreshold && (
                          <ReferenceLine 
                            x={simData.optimalThreshold.thresholdPercent} 
                            stroke="hsl(var(--primary))" 
                            strokeDasharray="5 5"
                            label={{ value: 'Optimal', fill: 'hsl(var(--primary))', fontSize: 'var(--fs-10, 10px)' }}
                          />
                        )}
                        <Area 
                          yAxisId="left"
                          type="monotone" 
                          dataKey="winRate" 
                          fill="url(#wl-winrate-fill)" 
                          stroke={CHART_COLORS.accent}
                          strokeWidth={2}
                        />
                        <Line 
                          yAxisId="right"
                          type="monotone" 
                          dataKey="expectancy" 
                          stroke={CHART_COLORS.purple}
                          strokeWidth={2}
                          dot={{ fill: CHART_COLORS.purple, r: 3 }}
                        />
                      </ComposedChart>
                    </AnalyticsChart>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="breakdown" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">By Asset Type</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {summary.byAssetType.map((asset) => (
                      <div key={asset.assetType} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="capitalize">{asset.assetType}</Badge>
                          <span className="text-sm text-muted-foreground">{asset.totalTrades} trades</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={cn("text-sm font-mono", asset.winRate >= 60 ? "text-[var(--trade-bullish)]" : asset.winRate >= 50 ? "text-[var(--trade-neutral)]" : "text-[var(--trade-bearish)]")}>
                            {asset.winRate}%
                          </span>
                          <span className={cn("text-sm font-mono", asset.avgGain >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]")}>
                            {asset.avgGain >= 0 ? '+' : ''}{asset.avgGain}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">By Engine/Source</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {summary.bySource.map((src) => (
                      <div key={src.source} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="uppercase">{src.source}</Badge>
                          <span className="text-sm text-muted-foreground">{src.totalTrades} trades</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            <CheckCircle className="h-3 w-3 text-[var(--trade-bullish)]" />
                            <span className="text-xs">{src.wins}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <XCircle className="h-3 w-3 text-[var(--trade-bearish)]" />
                            <span className="text-xs">{src.losses}</span>
                          </div>
                          <span className={cn("text-sm font-mono font-semibold", src.winRate >= 60 ? "text-[var(--trade-bullish)]" : src.winRate >= 50 ? "text-[var(--trade-neutral)]" : "text-[var(--trade-bearish)]")}>
                            {src.winRate}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="expiration" className="space-y-4">
            {expirationLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-8 w-8 animate-spin text-sky-400" />
              </div>
            ) : expirationData?.summary?.totalExpired === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No closed trades to analyze yet</p>
                </CardContent>
              </Card>
            ) : expirationData ? (
              <>
                <Card className="border-amber-500/20 bg-amber-500/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5 text-[var(--trade-neutral)]" />
                      Expiration Forensics
                    </CardTitle>
                    <CardDescription>
                      Analyzing {expirationData.summary.totalExpired} trades that expired before hitting target or stop
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
                        <div className="text-xs text-muted-foreground mb-1">Total Expired</div>
                        <div className="text-2xl font-bold text-sky-400">{expirationData.summary.totalExpired}</div>
                      </div>
                      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <div className="text-xs text-muted-foreground mb-1">Almost Hit Target (75%+)</div>
                        <div className="text-2xl font-bold text-[var(--trade-neutral)]">
                          {expirationData.summary.almostHitTargetPercent ?? 0}%
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {expirationData.summary.almostHitTargetCount ?? 0} trades
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-[var(--trade-bullish)]/10 border border-green-500/20">
                        <div className="text-xs text-muted-foreground mb-1">Very Close (90%+)</div>
                        <div className="text-2xl font-bold text-[var(--trade-bullish)]">
                          {expirationData.summary.veryClosePercent ?? 0}%
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {expirationData.summary.veryCloseCount ?? 0} trades
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                        <div className="text-xs text-muted-foreground mb-1">Avg Progress to Target</div>
                        <div className="text-2xl font-bold text-purple-400">
                          {expirationData.summary.avgProgressToTarget ?? 0}%
                        </div>
                      </div>
                    </div>

                    {expirationData.recommendations.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-[var(--trade-neutral)]" />
                          Recommendations
                        </h4>
                        {expirationData.recommendations.map((rec, i) => (
                          <div 
                            key={i} 
                            className={cn(
                              "p-3 rounded-lg border flex items-start gap-3",
                              rec.severity === 'critical' && "bg-red-500/10 border-red-500/30",
                              rec.severity === 'warning' && "bg-amber-500/10 border-amber-500/30",
                              rec.severity === 'info' && "bg-blue-500/10 border-blue-500/30"
                            )}
                          >
                            {rec.severity === 'critical' && <AlertTriangle className="h-5 w-5 text-[var(--trade-bearish)] shrink-0 mt-0.5" />}
                            {rec.severity === 'warning' && <AlertTriangle className="h-5 w-5 text-[var(--trade-neutral)] shrink-0 mt-0.5" />}
                            {rec.severity === 'info' && <Info className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />}
                            <p className="text-sm">{rec.message}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">By Holding Period</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {expirationData.byHoldingPeriod.length === 0 ? (
                        <p className="text-muted-foreground text-center py-4">Accumulating holding period data...</p>
                      ) : (
                        <div className="space-y-3">
                          {expirationData.byHoldingPeriod.map((period) => (
                            <div key={period.period} className="p-3 rounded-lg bg-muted/30">
                              <div className="flex items-center justify-between mb-2">
                                <Badge variant="outline" className="capitalize">{period.period}</Badge>
                                <span className="text-sm text-muted-foreground">{period.count} expired</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-muted-foreground">Almost hit target:</span>
                                  <span className={cn("ml-1 font-semibold", period.almostHitTargetPercent >= 40 ? "text-[var(--trade-neutral)]" : "text-muted-foreground")}>
                                    {period.almostHitTargetPercent}%
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Avg progress:</span>
                                  <span className="ml-1 font-semibold">{period.avgProgressToTarget}%</span>
                                </div>
                              </div>
                              <div className="mt-2">
                                <Progress value={period.avgProgressToTarget} className="h-2" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">By Asset Type</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {expirationData.byAssetType.length === 0 ? (
                        <p className="text-muted-foreground text-center py-4">Accumulating asset type data...</p>
                      ) : (
                        <div className="space-y-3">
                          {expirationData.byAssetType.map((asset) => (
                            <div key={asset.assetType} className="p-3 rounded-lg bg-muted/30">
                              <div className="flex items-center justify-between mb-2">
                                <Badge variant="secondary" className="uppercase">{asset.assetType}</Badge>
                                <span className="text-sm text-muted-foreground">{asset.count} expired</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-muted-foreground">Almost hit target:</span>
                                  <span className={cn("ml-1 font-semibold", asset.almostHitTargetPercent >= 40 ? "text-[var(--trade-neutral)]" : "text-muted-foreground")}>
                                    {asset.almostHitTargetPercent}%
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Avg progress:</span>
                                  <span className="ml-1 font-semibold">{asset.avgProgressToTarget}%</span>
                                </div>
                              </div>
                              <div className="mt-2">
                                <Progress value={asset.avgProgressToTarget} className="h-2" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Expired Trade Details
                    </CardTitle>
                    <CardDescription>
                      Recent expired trades with progress analysis (showing up to 100)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {expirationData.trades.slice(0, 20).map((trade) => (
                        <div 
                          key={trade.id} 
                          className={cn(
                            "p-3 rounded-lg border flex items-center justify-between",
                            trade.veryClose && "bg-[var(--trade-bullish)]/5 border-green-500/20",
                            trade.almostHitTarget && !trade.veryClose && "bg-amber-500/5 border-amber-500/20",
                            !trade.almostHitTarget && "bg-muted/30"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div>
                              <div className="font-semibold flex items-center gap-2">
                                {trade.symbol}
                                <Badge variant="outline" className="text-xs capitalize">{trade.direction}</Badge>
                                <Badge variant="secondary" className="text-xs">{trade.holdingPeriod}</Badge>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                Entry: ${trade.entryPrice} | Target: ${trade.targetPrice} ({trade.targetDistancePercent}%)
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Progress:</span>
                              <span className={cn(
                                "font-mono font-semibold",
                                trade.progressToTargetPercent >= 90 && "text-[var(--trade-bullish)]",
                                trade.progressToTargetPercent >= 75 && trade.progressToTargetPercent < 90 && "text-[var(--trade-neutral)]",
                                trade.progressToTargetPercent < 75 && "text-muted-foreground"
                              )}>
                                {trade.progressToTargetPercent}%
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Needed +{trade.neededMorePercent}% more
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="patterns" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-[var(--trade-bearish)]" />
                  Loss Pattern Analysis
                </CardTitle>
                <CardDescription>
                  Top failure modes identified from historical losses
                </CardDescription>
              </CardHeader>
              <CardContent>
                {summary.lossPatterns.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">Run analysis after more trades close</p>
                ) : (
                  <div className="space-y-3">
                    {summary.lossPatterns.map((pattern, i) => (
                      <div key={pattern.reason} className="flex items-center justify-between p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-bold text-muted-foreground">#{i + 1}</span>
                          <div>
                            <p className="font-medium capitalize">{pattern.reason.replace(/_/g, ' ')}</p>
                            <p className="text-xs text-muted-foreground">{pattern.count} occurrences</p>
                          </div>
                        </div>
                        <Badge variant="destructive" className="font-mono">
                          {safeToFixed(pattern.avgLoss, 1, "0")}% avg
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">Waiting for trade data to accumulate</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
