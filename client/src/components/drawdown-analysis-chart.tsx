import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Area, Line, Tooltip, ReferenceLine, ComposedChart } from "recharts";
import { TrendingDown, TrendingUp, Activity, Info, AlertTriangle, CheckCircle } from "lucide-react";
import { cn, safeToFixed } from "@/lib/utils";
import { Tooltip as TooltipUI, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AnalyticsChart, AnalyticsXAxis, AnalyticsYAxis, AnalyticsGrid, AnalyticsGradient, CHART_COLORS } from "@/components/ui/analytics-chart";

interface EquityCurvePoint {
  tradeIndex: number;
  date: string;
  equity: number;        // Multiplicative equity (starts at 1.0)
  peak: number;
  drawdown: number;
  drawdownPercent: number;
}

interface DrawdownPeriod {
  start: number;
  end: number;
  depth: number;
  recoveryTrades: number;
}

type CalmarStatus = 'valid' | 'estimated' | 'insufficient-sample' | 'no-drawdown';

interface DrawdownAnalysisData {
  equityCurve: EquityCurvePoint[];
  drawdownPeriods: DrawdownPeriod[];
  summary: {
    totalTrades: number;
    totalReturnPercent: number;
    maxDrawdownPercent: number;
    currentDrawdownPercent: number;
    isInDrawdown: boolean;
    totalDrawdownPeriods: number;
    avgRecoveryTrades: number;
    calmar: {
      value: number | null;
      status: CalmarStatus;
    };
    annualizedReturnPercent: number;
    observationYears: number;
    finalEquity: number;
  };
}

function CustomTooltip({ active, payload }: any) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const equityReturn = safeToFixed((data.equity - 1) * 100, 2);
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
        <p className="font-semibold text-sm">Trade #{data.tradeIndex}</p>
        <p className="text-xs text-muted-foreground mb-2">{data.date}</p>
        <div className="space-y-1 text-xs">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Equity:</span>
            <span className="font-mono text-foreground">{safeToFixed(data.equity, 4)}x</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Total Return:</span>
            <span className={cn(
              "font-mono font-semibold",
              parseFloat(equityReturn) >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
            )}>
              {parseFloat(equityReturn) >= 0 ? '+' : ''}{equityReturn}%
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Peak:</span>
            <span className="font-mono text-sky-500">{safeToFixed(data.peak, 4)}x</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Drawdown:</span>
            <span className={cn(
              "font-mono",
              data.drawdownPercent > 0 ? "text-[var(--trade-bearish)]" : "text-[var(--trade-bullish)]"
            )}>
              {data.drawdownPercent > 0 ? `-${data.drawdownPercent}%` : 'None'}
            </span>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

export default function DrawdownAnalysisChart() {
  const { data, isLoading, error } = useQuery<DrawdownAnalysisData>({
    queryKey: ['/api/performance/drawdown-analysis'],
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-drawdown-analysis-loading">
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
      <Card data-testid="card-drawdown-analysis-error">
        <CardHeader>
          <CardTitle>Drawdown Analysis</CardTitle>
          <CardDescription>Peak-to-trough performance metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Failed to load drawdown analysis.</p>
        </CardContent>
      </Card>
    );
  }

  const { equityCurve, summary } = data;

  return (
    <Card data-testid="card-drawdown-analysis">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-primary" />
              Drawdown Analysis
              <TooltipProvider>
                <TooltipUI>
                  <TooltipTrigger>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">Measures the decline from peak cumulative returns.
                    Essential for understanding risk exposure and recovery patterns.</p>
                  </TooltipContent>
                </TooltipUI>
              </TooltipProvider>
            </CardTitle>
            <CardDescription>
              Equity curve and drawdown metrics from {summary.totalTrades} trades
            </CardDescription>
          </div>
          {summary.isInDrawdown ? (
            <Badge variant="outline" className="bg-red-500/10 text-[var(--trade-bearish)] border-red-500/30">
              <AlertTriangle className="h-3 w-3 mr-1" />
              In Drawdown
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/30">
              <CheckCircle className="h-3 w-3 mr-1" />
              At Peak
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-3 rounded-lg bg-[var(--trade-bullish)]/10 border border-green-500/20">
            <p className="text-xs text-muted-foreground">Total Return</p>
            <p className={cn(
              "font-semibold font-mono text-lg",
              summary.totalReturnPercent >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
            )}>
              {summary.totalReturnPercent >= 0 ? '+' : ''}{safeToFixed(summary.totalReturnPercent, 1)}%
            </p>
            <p className="text-[10px] text-muted-foreground">{safeToFixed(summary.finalEquity, 4)}x</p>
          </div>
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-muted-foreground">Max Drawdown</p>
            <p className="font-semibold font-mono text-lg text-[var(--trade-bearish)]">-{summary.maxDrawdownPercent}%</p>
          </div>
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="text-xs text-muted-foreground">Current DD</p>
            <p className={cn(
              "font-semibold font-mono text-lg",
              summary.currentDrawdownPercent > 0 ? "text-[var(--trade-neutral)]" : "text-[var(--trade-bullish)]"
            )}>
              {summary.currentDrawdownPercent > 0 ? `-${summary.currentDrawdownPercent}%` : 'None'}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
            <p className="text-xs text-muted-foreground">Calmar Ratio</p>
            <TooltipProvider>
              <TooltipUI>
                <TooltipTrigger>
                  <p className={cn(
                    "font-semibold font-mono text-lg",
                    summary.calmar.status !== 'valid' && summary.calmar.status !== 'estimated' ? "text-muted-foreground" :
                    summary.calmar.value !== null && summary.calmar.value >= 1 ? "text-[var(--trade-bullish)]" :
                    summary.calmar.value !== null && summary.calmar.value >= 0.5 ? "text-sky-500" : "text-[var(--trade-neutral)]"
                  )}>
                    {summary.calmar.status === 'insufficient-sample' ? 'N/A' :
                     summary.calmar.status === 'no-drawdown' ? '∞' :
                     summary.calmar.value}
                    {summary.calmar.status === 'estimated' && <span className="text-xs">*</span>}
                  </p>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Annualized Return / Max Drawdown</p>
                  <p className="text-xs text-muted-foreground">&gt;1 = Good risk-adjusted returns</p>
                  {summary.observationYears > 0 && summary.calmar.status === 'valid' && (
                    <p className="text-xs text-muted-foreground">
                      {safeToFixed(summary.observationYears, 2)} years observed
                    </p>
                  )}
                  {summary.calmar.status === 'insufficient-sample' && (
                    <p className="text-xs text-[var(--trade-neutral)]">Insufficient sample (&lt;10 trades)</p>
                  )}
                  {summary.calmar.status === 'no-drawdown' && (
                    <p className="text-xs text-[var(--trade-bullish)]">No drawdown recorded (infinite)</p>
                  )}
                  {summary.calmar.status === 'estimated' && (
                    <p className="text-xs text-[var(--trade-neutral)]">* Estimated (timestamps uncertain)</p>
                  )}
                </TooltipContent>
              </TooltipUI>
            </TooltipProvider>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 border">
            <p className="text-xs text-muted-foreground">Avg Recovery</p>
            <p className="font-semibold font-mono text-lg">{summary.avgRecoveryTrades} trades</p>
          </div>
        </div>

        <AnalyticsChart config={{}} className="h-64">
          <ComposedChart data={equityCurve} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <defs>
              <AnalyticsGradient id="equityGradient" color={CHART_COLORS.bull} from={0.4} />
              <AnalyticsGradient id="drawdownGradient" color={CHART_COLORS.bear} from={0.4} />
            </defs>
            <AnalyticsGrid opacity={0.5} />
            <AnalyticsXAxis
              dataKey="tradeIndex"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--fs-10, 10px)' }}
            />
            <AnalyticsYAxis
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--fs-10, 10px)' }}
              domain={['auto', 'auto']}
              tickFormatter={(val) => `${safeToFixed(val, 2)}x`}
              label={{ value: 'Equity (1.0 = start)', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))', fontSize: 'var(--fs-10, 10px)' }}
            />
            <ReferenceLine y={1} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="equity"
              stroke={CHART_COLORS.bull}
              fill="url(#equityGradient)"
              strokeWidth={2}
              name="Equity Curve"
            />
            <Line
              type="monotone"
              dataKey="peak"
              stroke={CHART_COLORS.accent}
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
              name="Peak"
            />
          </ComposedChart>
        </AnalyticsChart>

        <div className="flex items-center gap-4 justify-center text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-2 bg-[var(--trade-bullish)]/40 rounded border border-green-500" />
            <span className="text-muted-foreground">Equity Curve</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-sky-500 rounded" style={{ borderBottom: `2px dashed ${CHART_COLORS.accent}` }} />
            <span className="text-muted-foreground">High Water Mark</span>
          </div>
        </div>

        {summary.totalDrawdownPeriods > 0 && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-2 font-medium">
              {summary.totalDrawdownPeriods} drawdown periods recorded
            </p>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Risk Assessment:</span>{' '}
              {summary.maxDrawdownPercent > 30
                ? 'High risk profile - consider tighter position sizing'
                : summary.maxDrawdownPercent > 15
                ? 'Moderate risk - acceptable for active trading'
                : 'Low drawdown - conservative risk profile'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
