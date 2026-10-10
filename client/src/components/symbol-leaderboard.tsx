import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, safeToFixed } from "@/lib/utils";
import { fetchWithParams } from "@/lib/queryClient";

interface SymbolPerformance {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgGain: number;
  avgLoss: number;
  sampleWarning?: boolean; // True if <50 trades - statistically unreliable
}

interface SymbolLeaderboardData {
  topPerformers: SymbolPerformance[];
  underperformers: SymbolPerformance[];
}

interface SymbolLeaderboardProps {
  selectedEngine?: string;
}

export default function SymbolLeaderboard({ selectedEngine }: SymbolLeaderboardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['/api/performance/symbol-leaderboard', selectedEngine ? { engine: selectedEngine } : undefined] as const,
    queryFn: fetchWithParams<SymbolLeaderboardData>(),
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-symbol-leaderboard-loading">
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

  if (!data || (data.topPerformers.length === 0 && data.underperformers.length === 0)) {
    return (
      <Card data-testid="card-symbol-leaderboard-empty">
        <CardHeader>
          <CardTitle>Symbol Leaderboard</CardTitle>
          <CardDescription>Data loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not enough closed trades to display symbol performance rankings.
          </p>
        </CardContent>
      </Card>
    );
  }

  const getWinRateBadgeVariant = (winRate: number) => {
    if (winRate > 70) return "default";
    if (winRate >= 50) return "secondary";
    return "destructive";
  };

  const getWinRateBadgeColor = (winRate: number) => {
    if (winRate > 70) return "text-[var(--trade-bullish)]";
    if (winRate >= 50) return "text-[var(--trade-neutral)]";
    return "text-[var(--trade-bearish)]";
  };

  const renderTable = (symbols: SymbolPerformance[], title: string, icon: React.ReactNode) => {
    if (symbols.length === 0) return null;

    return (
      <div className="space-y-3" data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-lg font-semibold">{title}</h3>
          <Badge variant="outline" className="ml-auto">
            {symbols.length} symbols
          </Badge>
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead className="font-semibold">Symbol</TableHead>
                <TableHead className="text-center font-semibold">Trades</TableHead>
                <TableHead className="text-center font-semibold">Wins</TableHead>
                <TableHead className="text-center font-semibold">Losses</TableHead>
                <TableHead className="text-center font-semibold">Win Rate</TableHead>
                <TableHead className="text-right font-semibold">Avg Gain</TableHead>
                <TableHead className="text-right font-semibold">Avg Loss</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {symbols.map((symbol) => (
                <TableRow key={symbol.symbol} data-testid={`row-symbol-${symbol.symbol}`}>
                  <TableCell className="font-mono font-bold tabular-nums">
                    {symbol.symbol}
                  </TableCell>
                  <TableCell className="text-center font-mono">
                    <div className="flex items-center justify-center gap-1">
                      {symbol.trades}
                      {symbol.sampleWarning && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="w-3 h-3 text-[var(--trade-neutral)]" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Low sample size ({symbol.trades} trades)</p>
                              <p className="text-xs text-muted-foreground">Results may be statistically unreliable</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center font-mono text-[var(--trade-bullish)]">
                    {symbol.wins}
                  </TableCell>
                  <TableCell className="text-center font-mono text-[var(--trade-bearish)]">
                    {symbol.losses}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={getWinRateBadgeVariant(symbol.winRate)}
                      className={cn("font-mono", getWinRateBadgeColor(symbol.winRate))}
                      data-testid={`badge-winrate-${symbol.symbol}`}
                    >
                      {safeToFixed(symbol.winRate, 1)}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[var(--trade-bullish)]">
                    +{safeToFixed(symbol.avgGain, 2)}%
                  </TableCell>
                  <TableCell className="text-right font-mono text-[var(--trade-bearish)]">
                    {safeToFixed(symbol.avgLoss, 2)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  return (
    <Card data-testid="card-symbol-leaderboard">
      <CardHeader>
        <CardTitle>Symbol Leaderboard</CardTitle>
        <CardDescription>
          Best and worst performing symbols by win rate (min 20 trades required)
          {selectedEngine && ` (${selectedEngine.toUpperCase()} engine)`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {renderTable(
          data.topPerformers,
          "Top Performers",
          <TrendingUp className="w-5 h-5 text-[var(--trade-bullish)]" />
        )}
        {renderTable(
          data.underperformers,
          "Underperformers",
          <TrendingDown className="w-5 h-5 text-[var(--trade-bearish)]" />
        )}
      </CardContent>
    </Card>
  );
}
