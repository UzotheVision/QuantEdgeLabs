import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, Award, Target, BarChart3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn, safeToFixed } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SignalStats {
  signalName: string;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  openCount: number;
  winRate: number;
  avgWinPercent: number;
  avgLossPercent: number;
  profitFactor: number;
  expectancy: number;
  stockWinRate: number;
  optionWinRate: number;
  cryptoWinRate: number;
  recentWinRate: number;
  trendDirection: 'improving' | 'declining' | 'stable';
  reliabilityScore: number;
  sampleSizeGrade: 'A' | 'B' | 'C' | 'D' | 'F';
}

interface SignalAttributionData {
  signals: SignalStats[];
  topPerformers: SignalStats[];
  worstPerformers: SignalStats[];
  totalSignals: number;
  lastUpdated: string | null;
  message?: string;
}

function getTrendIcon(direction: string) {
  switch (direction) {
    case 'improving':
      return <TrendingUp className="w-3 h-3 text-[var(--trade-bullish)]" />;
    case 'declining':
      return <TrendingDown className="w-3 h-3 text-[var(--trade-bearish)]" />;
    default:
      return <Minus className="w-3 h-3 text-muted-foreground" />;
  }
}

function getGradeColor(grade: string) {
  switch (grade) {
    case 'A': return 'bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/20';
    case 'B': return 'bg-sky-500/10 text-sky-500 border-sky-500/20';
    case 'C': return 'bg-amber-500/10 text-[var(--trade-neutral)] border-amber-500/20';
    case 'D': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
    case 'F': return 'bg-red-500/10 text-[var(--trade-bearish)] border-red-500/20';
    default: return 'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20';
  }
}

function getWinRateColor(rate: number) {
  if (rate >= 70) return 'text-[var(--trade-bullish)]';
  if (rate >= 60) return 'text-sky-400';
  if (rate >= 50) return 'text-[var(--trade-neutral)]';
  return 'text-[var(--trade-bearish)]';
}

function formatSignalName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/RSI2/g, 'RSI(2)')
    .replace(/MACD/g, 'MACD')
    .replace(/VWAP/g, 'VWAP')
    .replace(/ATR/g, 'ATR')
    .replace(/ADX/g, 'ADX')
    .replace(/EMA/g, 'EMA')
    .replace(/SMA/g, 'SMA')
    .replace(/MEAN REVERSION/gi, 'Mean Reversion')
    .replace(/VOLUME SPIKE/gi, 'Volume Spike')
    .replace(/GOLDEN CROSS/gi, 'Golden Cross')
    .replace(/DEATH CROSS/gi, 'Death Cross');
}

function SignalRow({ signal }: { signal: SignalStats }) {
  return (
    <div 
      className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50 hover-elevate"
      data-testid={`signal-row-${signal.signalName}`}
    >
      <div className="flex items-center gap-3">
        <Badge variant="outline" className={cn("text-xs", getGradeColor(signal.sampleSizeGrade))}>
          {signal.sampleSizeGrade}
        </Badge>
        <div>
          <div className="font-medium text-sm">{formatSignalName(signal.signalName)}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <span>{signal.totalTrades} trades</span>
            <span>|</span>
            <span className="flex items-center gap-1">
              {getTrendIcon(signal.trendDirection)}
              {signal.trendDirection}
            </span>
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <div className="text-right">
                <div className={cn("text-lg font-bold", getWinRateColor(signal.winRate))}>
                  {safeToFixed(signal.winRate, 1)}%
                </div>
                <div className="text-xs text-muted-foreground">
                  {signal.winCount}W / {signal.lossCount}L
                </div>
              </div>
            </TooltipTrigger>
            <TooltipContent className="w-64">
              <div className="space-y-2">
                <div className="font-medium">{formatSignalName(signal.signalName)}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>Avg Win: <span className="text-[var(--trade-bullish)]">+{safeToFixed(signal.avgWinPercent, 2)}%</span></div>
                  <div>Avg Loss: <span className="text-[var(--trade-bearish)]">{safeToFixed(signal.avgLossPercent, 2)}%</span></div>
                  <div>Profit Factor: <span className="text-sky-400">{safeToFixed(signal.profitFactor, 2)}</span></div>
                  <div>Expectancy: <span className={signal.expectancy >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}>{safeToFixed(signal.expectancy, 2)}%</span></div>
                </div>
                {(signal.stockWinRate > 0 || signal.optionWinRate > 0 || signal.cryptoWinRate > 0) && (
                  <div className="pt-2 border-t border-border text-xs">
                    <div className="font-medium mb-1">By Asset Type:</div>
                    {signal.stockWinRate > 0 && <div>Stock: {safeToFixed(signal.stockWinRate, 1)}%</div>}
                    {signal.optionWinRate > 0 && <div>Options: {safeToFixed(signal.optionWinRate, 1)}%</div>}
                    {signal.cryptoWinRate > 0 && <div>Crypto: {safeToFixed(signal.cryptoWinRate, 1)}%</div>}
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        
        <div className="w-24">
          <div className="text-xs text-muted-foreground mb-1">Reliability</div>
          <Progress value={signal.reliabilityScore} className="h-1.5" />
          <div className="text-xs text-right mt-0.5">{signal.reliabilityScore}</div>
        </div>
      </div>
    </div>
  );
}

export function SignalAttributionDashboard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === 'admin';

  const { data, isLoading, error } = useQuery<SignalAttributionData>({
    queryKey: ['/api/signal-attribution'],
    staleTime: 60000,
  });

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/signal-attribution/recalculate');
    },
    onSuccess: () => {
      toast({ title: "Signal attribution recalculated", description: "Analytics updated with latest trade data" });
      queryClient.invalidateQueries({ queryKey: ['/api/signal-attribution'] });
    },
    onError: () => {
      toast({ title: "Recalculation failed", description: "Could not update signal analytics", variant: "destructive" });
    }
  });

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-gradient-to-br from-slate-900/50 to-slate-800/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-sky-400" />
            Signal Attribution Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-border/50 bg-gradient-to-br from-slate-900/50 to-slate-800/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-[var(--trade-neutral)]" />
            Signal Attribution Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Failed to load signal attribution data</p>
        </CardContent>
      </Card>
    );
  }

  const hasData = data.signals && data.signals.length > 0;

  return (
    <Card className="border-border/50 bg-gradient-to-br from-slate-900/50 to-slate-800/30" data-testid="signal-attribution-dashboard">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-sky-400" />
            Signal Attribution Analytics
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Track which indicators drive winning trades
          </p>
        </div>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => recalculateMutation.mutate()}
            disabled={recalculateMutation.isPending}
            data-testid="button-recalculate-signals"
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", recalculateMutation.isPending && "animate-spin")} />
            Recalculate
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="text-center py-8 text-muted-foreground">
            <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>{data.message || "No signal data available yet."}</p>
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                className="mt-4"
                onClick={() => recalculateMutation.mutate()}
                disabled={recalculateMutation.isPending}
              >
                <RefreshCw className={cn("w-4 h-4 mr-2", recalculateMutation.isPending && "animate-spin")} />
                Run Initial Calculation
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {data.topPerformers && data.topPerformers.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-medium mb-3">
                  <Award className="w-4 h-4 text-[var(--trade-bullish)]" />
                  Top Performing Signals
                  <Badge variant="outline" className="ml-auto text-[var(--trade-bullish)] border-green-400/30">60%+ Win Rate</Badge>
                </h3>
                <div className="space-y-2">
                  {data.topPerformers.map(signal => (
                    <SignalRow key={signal.signalName} signal={signal} />
                  ))}
                </div>
              </div>
            )}

            {data.worstPerformers && data.worstPerformers.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-medium mb-3">
                  <AlertTriangle className="w-4 h-4 text-[var(--trade-neutral)]" />
                  Underperforming Signals
                  <Badge variant="outline" className="ml-auto text-[var(--trade-neutral)] border-amber-400/30">&lt;50% Win Rate</Badge>
                </h3>
                <div className="space-y-2">
                  {data.worstPerformers.map(signal => (
                    <SignalRow key={signal.signalName} signal={signal} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="flex items-center gap-2 text-sm font-medium mb-3">
                <Target className="w-4 h-4 text-sky-400" />
                All Signals
                <span className="text-muted-foreground ml-auto text-xs">{data.signals.length} tracked</span>
              </h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {data.signals.map(signal => (
                  <SignalRow key={signal.signalName} signal={signal} />
                ))}
              </div>
            </div>

            {data.lastUpdated && (
              <p className="text-xs text-muted-foreground text-right">
                Last updated: {new Date(data.lastUpdated).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default SignalAttributionDashboard;
