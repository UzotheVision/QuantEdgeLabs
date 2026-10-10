import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeToFixed } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, Tooltip, Cell } from "recharts";
import { Info } from "lucide-react";
import { fetchWithParams } from "@/lib/queryClient";
import { AnalyticsChart, AnalyticsXAxis, AnalyticsYAxis, AnalyticsGrid, CHART_COLORS } from "@/components/ui/analytics-chart";

interface HourData {
  hour: number;
  hourLabel: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
}

interface TimeOfDayHeatmapProps {
  selectedEngine?: string;
}

export default function TimeOfDayHeatmap({ selectedEngine }: TimeOfDayHeatmapProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['/api/performance/time-of-day-heatmap', selectedEngine ? { engine: selectedEngine } : undefined] as const,
    queryFn: fetchWithParams<HourData[]>(),
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-time-heatmap-loading">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-80 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card data-testid="card-time-heatmap-empty">
        <CardHeader>
          <CardTitle>Time of Day Performance</CardTitle>
          <CardDescription>Data loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not enough closed trades to display hourly performance patterns.
          </p>
        </CardContent>
      </Card>
    );
  }

  const getBarColor = (winRate: number) => {
    if (winRate >= 70) return CHART_COLORS.bull;
    if (winRate >= 40) return CHART_COLORS.gold;
    return CHART_COLORS.bear;
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-card border border-card-border rounded-lg p-3 shadow-lg">
          <p className="font-semibold text-sm">{data.hourLabel}</p>
          <div className="mt-2 space-y-1 text-xs">
            <p className="text-muted-foreground">
              Trades: <span className="font-mono text-foreground">{data.trades}</span>
            </p>
            <p className="text-[var(--trade-bullish)]">
              Wins: <span className="font-mono">{data.wins}</span>
            </p>
            <p className="text-[var(--trade-bearish)]">
              Losses: <span className="font-mono">{data.losses}</span>
            </p>
            <p className="font-semibold">
              Win Rate: <span className="font-mono">{safeToFixed(data.winRate, 1)}%</span>
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card data-testid="card-time-heatmap">
      <CardHeader>
        <CardTitle>Time of Day Performance</CardTitle>
        <CardDescription>
          Win rate by hour during market hours
          {selectedEngine && ` (${selectedEngine.toUpperCase()} engine)`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <AnalyticsChart config={{}} className="h-80">
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <AnalyticsGrid opacity={0.3} />
            <AnalyticsXAxis
              dataKey="hourLabel"
            />
            <AnalyticsYAxis
              label={{ value: 'Win Rate %', angle: -90, position: 'insideLeft', style: { fill: 'hsl(var(--muted-foreground))' } }}
              domain={[0, 100]}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--accent))' }} />
            <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getBarColor(entry.winRate)} />
              ))}
            </Bar>
          </BarChart>
        </AnalyticsChart>
        <div className="flex items-start gap-2 p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
          <Info className="w-4 h-4 text-sky-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Market opens at 9:30 AM ET, closes at 4:00 PM ET. Performance measured during regular trading hours only.
          </p>
        </div>
        <div className="flex items-center justify-center gap-6 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.bull }} />
            <span className="text-muted-foreground">Strong (70%+)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.gold }} />
            <span className="text-muted-foreground">Moderate (40-70%)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.bear }} />
            <span className="text-muted-foreground">Weak (&lt;40%)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
