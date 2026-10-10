import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, Tooltip, Cell } from "recharts";
import { AlertTriangle, Info } from "lucide-react";
import {
  ENGINE_HISTORICAL_PERFORMANCE,
  calculateExpectedValue,
  formatExpectedValue,
  normalizeEngineKey
} from "@shared/constants";
import { safeToFixed } from "@/lib/utils";
import { AnalyticsChart, AnalyticsXAxis, AnalyticsYAxis, AnalyticsGrid, CHART_COLORS } from "@/components/ui/analytics-chart";

interface ConfidenceBand {
  band: string;
  bandLabel: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
}

interface ConfidenceCalibrationProps {
  selectedEngine?: string;
}

const getBarColor = (winRate: number) => {
  if (winRate >= 70) return CHART_COLORS.bull;
  if (winRate >= 50) return CHART_COLORS.gold;
  return CHART_COLORS.bear;
};

function CustomTooltip({ active, payload }: any) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
        <p className="font-semibold text-sm">Signal Band: {data.bandLabel}</p>
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
          <p className="font-semibold mt-2">
            Actual Win Rate: <span className="font-mono">{safeToFixed(data.winRate, 1)}%</span>
          </p>
        </div>
      </div>
    );
  }
  return null;
}

export default function ConfidenceCalibration({ selectedEngine }: ConfidenceCalibrationProps) {
  const queryParams = selectedEngine ? `?engine=${selectedEngine}` : '';

  const { data, isLoading } = useQuery<ConfidenceBand[]>({
    queryKey: ['/api/performance/confidence-calibration', selectedEngine],
    queryFn: async () => {
      const response = await fetch(`/api/performance/confidence-calibration${queryParams}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch confidence calibration data');
      }
      return response.json();
    },
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-confidence-calibration-loading">
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
      <Card data-testid="card-signal-analysis-empty">
        <CardHeader>
          <CardTitle>Signal Performance Analysis</CardTitle>
          <CardDescription>Data loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not enough closed trades with signal data to display performance analysis.
          </p>
        </CardContent>
      </Card>
    );
  }

  const normalizedEngine = selectedEngine ? normalizeEngineKey(selectedEngine) : null;
  const engineEV = normalizedEngine ? ENGINE_HISTORICAL_PERFORMANCE[normalizedEngine] : null;
  const evValue = engineEV ? calculateExpectedValue(engineEV) : null;

  return (
    <Card data-testid="card-confidence-calibration">
      <CardHeader>
        <CardTitle>Signal Performance Analysis</CardTitle>
        <CardDescription>
          Historical win rate by signal count
          {selectedEngine && ` (${selectedEngine.toUpperCase()} engine)`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
          <Info className="h-4 w-4 text-sky-500 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-sky-600 dark:text-sky-400">
              Signal Strength = How many indicators agree (not probability)
            </p>
            {engineEV && evValue !== null && (
              <p className="text-xs text-muted-foreground mt-1">
                {selectedEngine?.toUpperCase()} Expected Value: <span className="font-mono font-bold tabular-nums">{formatExpectedValue(evValue)}</span> based on {engineEV.totalTrades} trades
              </p>
            )}
          </div>
        </div>

        <AnalyticsChart config={{}} className="h-80">
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <AnalyticsGrid opacity={0.3} />
            <AnalyticsXAxis
              dataKey="bandLabel"
              label={{ value: 'Signal Band', position: 'insideBottom', offset: -5, style: { fill: 'hsl(var(--muted-foreground))' } }}
            />
            <AnalyticsYAxis
              label={{ value: 'Actual Win Rate %', angle: -90, position: 'insideLeft', style: { fill: 'hsl(var(--muted-foreground))' } }}
              domain={[0, 100]}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--accent))' }} />
            <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${entry.band}-${index}`} fill={getBarColor(entry.winRate)} />
              ))}
            </Bar>
          </BarChart>
        </AnalyticsChart>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 text-xs text-center">
          {data.map((band, index) => (
            <div key={`band-${band.band}-${index}`} className="p-2 rounded border bg-muted/20">
              <p className="font-semibold">{band.bandLabel}</p>
              <p className="font-mono text-muted-foreground mt-1">{band.trades} trades</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
