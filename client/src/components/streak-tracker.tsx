import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame, X, Trophy, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchWithParams } from "@/lib/queryClient";

interface StreakData {
  currentStreak: number;
  currentStreakType: 'win' | 'loss' | 'none';
  longestWinStreak: number;
  longestLossStreak: number;
}

interface StreakTrackerProps {
  selectedEngine?: string;
}

export default function StreakTracker({ selectedEngine }: StreakTrackerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['/api/performance/streaks', selectedEngine ? { engine: selectedEngine } : undefined] as const,
    queryFn: fetchWithParams<StreakData>(),
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-streak-tracker-loading">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card data-testid="card-streak-tracker-empty">
        <CardHeader>
          <CardTitle>Streak Tracker</CardTitle>
          <CardDescription>Data loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not enough closed trades to track winning and losing streaks.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isOnWinStreak = data.currentStreakType === 'win' && data.currentStreak > 0;
  const isOnLossStreak = data.currentStreakType === 'loss' && data.currentStreak > 0;
  const isLongWinStreak = isOnWinStreak && data.currentStreak > 5;
  const isRecordWinStreak = isOnWinStreak && data.currentStreak === data.longestWinStreak && data.currentStreak > 0;

  return (
    <Card data-testid="card-streak-tracker">
      <CardHeader>
        <CardTitle>Streak Tracker</CardTitle>
        <CardDescription>
          Current and historical winning/losing streaks
          {selectedEngine && ` (${selectedEngine.toUpperCase()} engine)`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center p-6 rounded-lg border bg-muted/20">
          <p className="text-sm text-muted-foreground mb-3">Current Streak</p>
          {data.currentStreakType === 'none' || data.currentStreak === 0 ? (
            <Badge variant="outline" className="text-lg px-4 py-2">
              No Active Streak
            </Badge>
          ) : isOnWinStreak ? (
            <div className="space-y-2">
              <Badge 
                variant="default" 
                className={cn(
                  "text-2xl px-6 py-3 bg-[var(--trade-bullish)] hover:bg-green-600 text-white",
                  isLongWinStreak && ""
                )}
                data-testid="badge-current-win-streak"
              >
                <Flame className="w-6 h-6 mr-2" />
                {data.currentStreak} Win Streak
              </Badge>
              {isRecordWinStreak && (
                <div className="flex items-center justify-center gap-2 text-[var(--trade-neutral)]">
                  <Trophy className="w-4 h-4" />
                  <span className="text-sm font-semibold">New Record!</span>
                </div>
              )}
            </div>
          ) : (
            <Badge 
              variant="destructive" 
              className="text-2xl px-6 py-3"
              data-testid="badge-current-loss-streak"
            >
              <X className="w-6 h-6 mr-2" />
              {data.currentStreak} Loss Streak
            </Badge>
          )}
          {isOnWinStreak && (
            <p className="text-sm text-[var(--trade-bullish)] font-semibold mt-3">
              Keep the momentum going!
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border bg-card space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Trophy className="w-4 h-4" />
              <span className="text-sm">Longest Win Streak</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold font-mono text-[var(--trade-bullish)]">
                {data.longestWinStreak}
              </span>
              {isRecordWinStreak && data.longestWinStreak > 0 && (
                <span className="text-2xl text-[var(--trade-bullish)] font-bold">NEW RECORD</span>
              )}
            </div>
            {data.longestWinStreak === 0 && (
              <p className="text-xs text-muted-foreground">No wins yet</p>
            )}
          </div>

          <div className="p-4 rounded-lg border bg-card space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              <TrendingDown className="w-4 h-4" />
              <span className="text-sm">Longest Loss Streak</span>
            </div>
            <div className="text-4xl font-bold font-mono text-[var(--trade-bearish)]">
              {data.longestLossStreak}
            </div>
            {data.longestLossStreak === 0 && (
              <p className="text-xs text-muted-foreground">No losses yet</p>
            )}
          </div>
        </div>

        {isOnLossStreak && data.currentStreak >= 3 && (
          <div className="p-3 rounded-lg border bg-amber-500/10 border-amber-500/20">
            <p className="text-xs text-muted-foreground text-center">
              Consider reviewing your strategy or taking a break after {data.currentStreak} consecutive losses.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
