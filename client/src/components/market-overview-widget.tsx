import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  AlertTriangle,
  Gauge,
  Clock,
  BarChart3,
  Zap
} from "lucide-react";
import { cn, safeToFixed } from "@/lib/utils";

interface MarketContextData {
  regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile';
  riskSentiment: 'risk_on' | 'risk_off' | 'neutral';
  score: number;
  shouldTrade: boolean;
  reasons: string[];
  spyData: { price: number; change: number; relativeVolume: number } | null;
  vixLevel: number | null;
  tradingSession: 'pre_market' | 'opening_drive' | 'mid_morning' | 'lunch_lull' | 'afternoon' | 'power_hour' | 'after_hours';
  timestamp: string;
}

const regimeConfig = {
  trending_up: { label: 'TRENDING UP', icon: TrendingUp, color: 'text-[var(--trade-bullish)]', bg: 'bg-[var(--trade-bullish)]/20', border: 'border-green-500/40' },
  trending_down: { label: 'TRENDING DOWN', icon: TrendingDown, color: 'text-[var(--trade-bearish)]', bg: 'bg-red-500/20', border: 'border-red-500/40' },
  ranging: { label: 'RANGING', icon: Activity, color: 'text-[var(--trade-neutral)]', bg: 'bg-amber-500/20', border: 'border-amber-500/40' },
  volatile: { label: 'VOLATILE', icon: AlertTriangle, color: 'text-[var(--trade-bearish)]', bg: 'bg-red-500/20', border: 'border-red-500/40' },
};

const sentimentConfig = {
  risk_on: { label: 'RISK-ON', color: 'text-[var(--trade-bullish)]', bg: 'bg-[var(--trade-bullish)]/10' },
  risk_off: { label: 'RISK-OFF', color: 'text-[var(--trade-bearish)]', bg: 'bg-red-500/10' },
  neutral: { label: 'NEUTRAL', color: 'text-muted-foreground', bg: 'bg-muted-foreground/10' },
};

const sessionLabels: Record<string, { label: string }> = {
  pre_market: { label: 'Pre-Market' },
  opening_drive: { label: 'Opening Drive' },
  mid_morning: { label: 'Mid-Morning' },
  lunch_lull: { label: 'Lunch Lull' },
  afternoon: { label: 'Afternoon' },
  power_hour: { label: 'Power Hour' },
  after_hours: { label: 'After Hours' },
};

export function MarketOverviewWidget() {
  const { data: context, isLoading, error } = useQuery<MarketContextData>({
    queryKey: ['/api/market-context'],
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <Card className="bg-card/50 backdrop-blur-xl border-border/30 shadow-[0_0_30px_-10px_rgba(34,211,238,0.06)]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground/90">
            <BarChart3 className="h-4 w-4 text-sky-400" />
            Market Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8 w-full bg-muted/50" />
          <Skeleton className="h-16 w-full bg-muted/50" />
          <Skeleton className="h-4 w-3/4 bg-muted/50" />
        </CardContent>
      </Card>
    );
  }

  if (error || !context) {
    return (
      <Card className="bg-card/50 backdrop-blur-xl border-border/30 shadow-[0_0_30px_-10px_rgba(34,211,238,0.06)]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground/90">
            <BarChart3 className="h-4 w-4 text-sky-400" />
            Market Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Unable to load market data</p>
        </CardContent>
      </Card>
    );
  }

  const regime = regimeConfig[context.regime];
  const sentiment = sentimentConfig[context.riskSentiment];
  const session = sessionLabels[context.tradingSession] || { label: context.tradingSession };
  const RegimeIcon = regime.icon;

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-[var(--trade-bullish)]';
    if (score >= 50) return 'text-[var(--trade-neutral)]';
    return 'text-[var(--trade-bearish)]';
  };

  const getVixColor = (vix: number | null) => {
    if (!vix) return 'text-muted-foreground';
    if (vix < 15) return 'text-[var(--trade-bullish)]';
    if (vix < 20) return 'text-[var(--trade-neutral)]';
    if (vix < 25) return 'text-orange-400';
    return 'text-[var(--trade-bearish)]';
  };

  return (
    <Card className="bg-card/50 backdrop-blur-xl border-border/30 shadow-[0_0_30px_-10px_rgba(34,211,238,0.06)] hover:shadow-[0_0_40px_-10px_rgba(34,211,238,0.1)] transition-all duration-300" data-testid="widget-market-overview">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground/90">
            <BarChart3 className="h-4 w-4 text-sky-400" />
            Market Overview
          </CardTitle>
          <Badge className="text-xs bg-muted/60 text-foreground/80 border border-border/50">
            {session.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center gap-2 px-3 py-2 rounded-md", regime.bg, regime.border, "border")}>
            <RegimeIcon className={cn("h-5 w-5", regime.color)} />
            <span className={cn("font-bold text-sm", regime.color)}>{regime.label}</span>
          </div>
          <div className={cn("px-2 py-1 rounded text-xs font-medium", sentiment.bg, sentiment.color)}>
            {sentiment.label}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 rounded-lg bg-muted/40 border border-border/30">
            <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Trade Score</div>
            <div className={cn("text-2xl font-bold font-mono tabular-nums", getScoreColor(context.score))}>
              {context.score}
            </div>
            <Badge 
              className={cn(
                "text-xs mt-2",
                context.shouldTrade 
                  ? "bg-[var(--trade-bullish)]/15 text-[var(--trade-bullish)] border border-green-500/30" 
                  : "bg-muted/50 text-muted-foreground border border-border/30"
              )}
              data-testid="badge-trade-status"
            >
              {context.shouldTrade ? 'TRADEABLE' : 
               (session.label.includes('Hours') || session.label === 'Weekend' ? 'CLOSED' : 'CAUTION')}
            </Badge>
          </div>
          
          <div className="text-center p-3 rounded-lg bg-muted/40 border border-border/30">
            <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">VIX</div>
            <div className={cn("text-2xl font-bold font-mono tabular-nums", getVixColor(context.vixLevel))}>
              {context.vixLevel ? safeToFixed(context.vixLevel, 1) : '--'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Fear Index</div>
          </div>
          
          <div className="text-center p-3 rounded-lg bg-muted/40 border border-border/30">
            <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">SPY</div>
            {context.spyData ? (
              <>
                <div className="text-lg font-bold font-mono tabular-nums text-foreground/95">
                  ${safeToFixed(context.spyData.price, 2)}
                </div>
                <div className={cn(
                  "text-xs font-medium font-mono",
                  context.spyData.change >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'
                )}>
                  {context.spyData.change >= 0 ? '+' : ''}{safeToFixed(context.spyData.change, 2)}%
                </div>
              </>
            ) : (
              <div className="text-lg font-bold font-mono tabular-nums text-muted-foreground">--</div>
            )}
          </div>
        </div>

        {context.spyData && (
          <div className="flex items-center gap-2 text-xs">
            <Zap className="h-3 w-3 text-sky-400" />
            <span className="text-muted-foreground">Volume:</span>
            <span className={cn(
              "font-medium font-mono",
              context.spyData.relativeVolume > 1.3 ? 'text-[var(--trade-bullish)]' : 
              context.spyData.relativeVolume < 0.7 ? 'text-[var(--trade-bearish)]' : 'text-foreground/80'
            )}>
              {safeToFixed(context.spyData.relativeVolume, 2)}x avg
            </span>
          </div>
        )}

        {context.reasons.length > 0 && (
          <div className="border-t border-border/30 pt-3">
            <div className="text-xs text-muted-foreground space-y-1">
              {context.reasons.slice(0, 3).map((reason, i) => (
                <div key={i} className="flex items-start gap-1">
                  <span className="text-sky-400">•</span>
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
