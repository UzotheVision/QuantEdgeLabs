import { useQuery, useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Brain, TrendingUp, TrendingDown, Target, 
  RefreshCw, Search, BarChart3, AlertTriangle, 
  CheckCircle, Database, ArrowUpDown
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from 'react';
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn, safeToFixed } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";

interface HistoricalStats {
  overall: {
    totalIdeas: number;
    closedIdeas: number;
    wins: number;
    losses: number;
    breakevens: number;
    winRate: number;
    totalPnL: number;
    avgPnLPercent: number;
    profitFactor: number;
  };
  bySource: Record<string, { ideas: number; wins: number; winRate: number; pnl: number }>;
  byAssetType: Record<string, { ideas: number; wins: number; winRate: number; pnl: number }>;
  byDirection: Record<string, { ideas: number; wins: number; winRate: number; pnl: number }>;
  byCatalyst: Array<{ catalyst: string; ideas: number; wins: number; winRate: number; pnl: number }>;
  bySymbol: Array<{ symbol: string; ideas: number; wins: number; winRate: number; pnl: number; lastTrade: string }>;
  byConfidenceBand: Array<{ band: string; ideas: number; wins: number; expectedWinRate: number; actualWinRate: number; calibrationError: number }>;
  topPerformers: Array<{ symbol: string; winRate: number; trades: number; totalPnL: number }>;
  worstPerformers: Array<{ symbol: string; winRate: number; trades: number; totalPnL: number }>;
}

function getWinRateColor(rate: number | null): string {
  if (rate === null) return "text-muted-foreground";
  if (rate >= 70) return "text-[var(--trade-bullish)]";
  if (rate >= 50) return "text-[var(--trade-neutral)]";
  return "text-[var(--trade-bearish)]";
}

function getPnlColor(pnl: number | null): string {
  if (pnl === null || pnl === 0) return "text-muted-foreground";
  return pnl > 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]";
}

function HeroStats({ stats }: { stats: HistoricalStats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="historical-hero-stats">
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-col items-center">
            <Database className="h-6 w-6 text-sky-400 mb-1" />
            <p className="text-2xl font-bold">{stats.overall.totalIdeas.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Total Ideas</p>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-col items-center">
            <CheckCircle className="h-6 w-6 text-[var(--trade-bullish)] mb-1" />
            <p className={cn("text-2xl font-bold", getWinRateColor(stats.overall.winRate))}>
              {safeToFixed(stats.overall.winRate, 1)}%
            </p>
            <p className="text-xs text-muted-foreground">Win Rate</p>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-col items-center">
            <Target className="h-6 w-6 text-[var(--trade-neutral)] mb-1" />
            <p className="text-2xl font-bold">{stats.overall.wins}</p>
            <p className="text-xs text-muted-foreground">Wins</p>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-col items-center">
            <BarChart3 className="h-6 w-6 text-purple-400 mb-1" />
            <p className={cn("text-2xl font-bold", stats.overall.profitFactor >= 1.5 ? "text-[var(--trade-bullish)]" : stats.overall.profitFactor >= 1 ? "text-[var(--trade-neutral)]" : "text-[var(--trade-bearish)]")}>
              {safeToFixed(stats.overall.profitFactor, 2)}x
            </p>
            <p className="text-xs text-muted-foreground">Profit Factor</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SourceBreakdown({ stats }: { stats: HistoricalStats }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-purple-400" />
          Source Performance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Object.entries(stats.bySource).map(([source, data]) => (
            <div key={source} className="space-y-1">
              <div className="flex justify-between items-center text-sm">
                <span className="capitalize font-medium">{source}</span>
                <span className={cn("font-medium", getWinRateColor(data.winRate))}>
                  {safeToFixed(data.winRate, 1)}%
                </span>
              </div>
              <Progress value={data.winRate} className="h-1.5" />
              <p className="text-xs text-muted-foreground">{data.ideas} ideas</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TopPerformers({ stats }: { stats: HistoricalStats }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-[var(--trade-bullish)]">
            <TrendingUp className="h-4 w-4" />
            Top Performers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Symbol</TableHead>
                <TableHead className="text-xs text-right">Trades</TableHead>
                <TableHead className="text-xs text-right">Win Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.topPerformers.slice(0, 5).map((performer) => (
                <TableRow key={performer.symbol}>
                  <TableCell className="font-mono text-xs">{performer.symbol}</TableCell>
                  <TableCell className="text-right text-xs">{performer.trades}</TableCell>
                  <TableCell className={cn("text-right font-bold text-xs", getWinRateColor(performer.winRate))}>
                    {safeToFixed(performer.winRate, 0)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-[var(--trade-bearish)]">
            <TrendingDown className="h-4 w-4" />
            Worst Performers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Symbol</TableHead>
                <TableHead className="text-xs text-right">Trades</TableHead>
                <TableHead className="text-xs text-right">Win Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.worstPerformers.slice(0, 5).map((performer) => (
                <TableRow key={performer.symbol}>
                  <TableCell className="font-mono text-xs">{performer.symbol}</TableCell>
                  <TableCell className="text-right text-xs">{performer.trades}</TableCell>
                  <TableCell className={cn("text-right font-bold text-xs", getWinRateColor(performer.winRate))}>
                    {safeToFixed(performer.winRate, 0)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DirectionBreakdown({ stats }: { stats: HistoricalStats }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-blue-400" />
          Direction Performance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Object.entries(stats.byDirection).map(([direction, data]) => (
            <div key={direction} className="space-y-1">
              <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2">
                  {direction === 'long' ? (
                    <TrendingUp className="h-3.5 w-3.5 text-[var(--trade-bullish)]" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5 text-[var(--trade-bearish)]" />
                  )}
                  <span className="capitalize font-medium">{direction}</span>
                  <span className="text-xs text-muted-foreground">{data.ideas} ideas</span>
                </div>
                <span className={cn("font-medium", getWinRateColor(data.winRate))}>
                  {safeToFixed(data.winRate, 1)}%
                </span>
              </div>
              <Progress value={data.winRate} className="h-1.5" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function HistoricalIntelligenceTab() {
  const { toast } = useToast();
  
  const { data: stats, isLoading, error } = useQuery<HistoricalStats>({
    queryKey: ['/api/historical-intelligence/stats'],
    staleTime: 5 * 60 * 1000,
  });
  
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/historical-intelligence/refresh');
      return response;
    },
    onSuccess: (data: any) => {
      toast({
        title: "Intelligence Refreshed",
        description: `Updated ${data.profilesUpdated} symbol profiles`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/historical-intelligence'] });
    },
    onError: () => {
      toast({
        title: "Refresh Failed",
        description: "Could not refresh historical intelligence",
        variant: "destructive",
      });
    },
  });
  
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }
  
  if (error || !stats) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertTriangle className="h-12 w-12 text-[var(--trade-neutral)] mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Failed to Load Historical Intelligence</h2>
          <p className="text-muted-foreground text-sm mb-4">There was an error loading the analytics data.</p>
          <Button onClick={() => window.location.reload()} size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-4" data-testid="historical-intelligence-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-purple-400" />
          <h3 className="font-semibold">Historical Intelligence</h3>
          <Badge variant="outline" className="text-xs">
            {stats.overall.totalIdeas.toLocaleString()} ideas
          </Badge>
        </div>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          data-testid="button-refresh-historical"
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshMutation.isPending && "animate-spin")} />
          {refreshMutation.isPending ? "Refreshing..." : "Refresh"}
        </Button>
      </div>
      
      <HeroStats stats={stats} />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SourceBreakdown stats={stats} />
        <DirectionBreakdown stats={stats} />
      </div>
      
      <TopPerformers stats={stats} />
    </div>
  );
}
