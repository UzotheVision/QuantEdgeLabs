import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Calendar, Target, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { safeToFixed } from "@/lib/utils";

interface ExpiryPattern {
  expiryDate: string;
  expiryType: 'weekly' | 'monthly' | 'leap';
  dayOfWeek: string;
  weekOfMonth: number;
  totalTrades: number;
  callTrades: number;
  putTrades: number;
  callWinRate: number;
  putWinRate: number;
  callPutRatio: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentStrength: number;
  avgPnL: number;
  avgDTE: number;
  bestSymbols: string[];
  worstSymbols: string[];
}

interface WeeklyPattern {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  year: number;
  dominantSentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number;
  totalCalls: number;
  totalPuts: number;
  callWinRate: number;
  putWinRate: number;
  priceDirection: 'up' | 'down' | 'sideways';
  confidenceLevel: number;
}

interface PatternSummary {
  totalPatterns: number;
  bullishExpiries: number;
  bearishExpiries: number;
  neutralExpiries: number;
  overallSentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number;
  topPerformingExpiry: ExpiryPattern | null;
  worstPerformingExpiry: ExpiryPattern | null;
  weeklyWinRate: number;
  monthlyWinRate: number;
}

function getSentimentIcon(sentiment: string) {
  switch (sentiment) {
    case 'bullish':
      return <TrendingUp className="h-4 w-4 text-[var(--trade-bullish)]" />;
    case 'bearish':
      return <TrendingDown className="h-4 w-4 text-[var(--trade-bearish)]" />;
    default:
      return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
}

function getSentimentColor(sentiment: string) {
  switch (sentiment) {
    case 'bullish':
      return 'bg-[var(--trade-bullish)]/20 text-[var(--trade-bullish)] border-green-500/30';
    case 'bearish':
      return 'bg-red-500/20 text-[var(--trade-bearish)] border-red-500/30';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export function ExpiryPatternInsights({ portfolioId }: { portfolioId?: string }) {
  const { data: summary, isLoading: summaryLoading } = useQuery<PatternSummary>({
    queryKey: ['/api/expiry-patterns/summary', portfolioId],
  });

  const { data: weeklyData, isLoading: weeklyLoading } = useQuery<{ patterns: WeeklyPattern[] }>({
    queryKey: ['/api/expiry-patterns/weekly', portfolioId],
  });

  const { data: patternsData, isLoading: patternsLoading } = useQuery<{ patterns: ExpiryPattern[] }>({
    queryKey: ['/api/expiry-patterns', portfolioId],
  });

  if (summaryLoading || weeklyLoading || patternsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Expiry Pattern Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const patterns = patternsData?.patterns || [];
  const weeklyPatterns = weeklyData?.patterns || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Expiry Pattern Insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold">{summary.totalPatterns}</div>
              <div className="text-xs text-muted-foreground">Expiry Dates Analyzed</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="flex items-center justify-center gap-1">
                {getSentimentIcon(summary.overallSentiment)}
                <span className="text-lg font-bold capitalize">{summary.overallSentiment}</span>
              </div>
              <div className="text-xs text-muted-foreground">Overall Sentiment</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold text-sky-400">{safeToFixed(summary.weeklyWinRate, 1, '0.0')}%</div>
              <div className="text-xs text-muted-foreground">Weekly Expiry Win Rate</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <div className="text-2xl font-bold text-purple-400">{safeToFixed(summary.monthlyWinRate, 1, '0.0')}%</div>
              <div className="text-xs text-muted-foreground">Monthly Expiry Win Rate</div>
            </div>
          </div>
        )}

        {summary && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded bg-[var(--trade-bullish)]/10">
              <div className="text-lg font-bold text-[var(--trade-bullish)]">{summary.bullishExpiries}</div>
              <div className="text-xs text-muted-foreground">Bullish</div>
            </div>
            <div className="p-2 rounded bg-muted/50">
              <div className="text-lg font-bold">{summary.neutralExpiries}</div>
              <div className="text-xs text-muted-foreground">Neutral</div>
            </div>
            <div className="p-2 rounded bg-red-500/10">
              <div className="text-lg font-bold text-[var(--trade-bearish)]">{summary.bearishExpiries}</div>
              <div className="text-xs text-muted-foreground">Bearish</div>
            </div>
          </div>
        )}

        {weeklyPatterns.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
              <Target className="h-4 w-4" />
              Weekly Pattern Analysis
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {weeklyPatterns.slice(0, 6).map((week, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Week {week.weekNumber}</span>
                    <Badge variant="outline" className={getSentimentColor(week.dominantSentiment)}>
                      {week.dominantSentiment}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-[var(--trade-bullish)]">{week.totalCalls} calls</span>
                    <span className="text-[var(--trade-bearish)]">{week.totalPuts} puts</span>
                    <span className="text-muted-foreground">
                      {week.priceDirection === 'up' ? '↑' : week.priceDirection === 'down' ? '↓' : '→'}
                      {safeToFixed(week.confidenceLevel, 0, '0')}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {patterns.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              Recent Expiry Performance
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {patterns.slice(0, 5).map((pattern, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded bg-muted/30 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{pattern.expiryDate}</span>
                    <Badge variant="outline" className="text-xs">
                      {pattern.expiryType}
                    </Badge>
                    <Badge variant="outline" className={getSentimentColor(pattern.sentiment)}>
                      {pattern.sentiment}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={pattern.avgPnL >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}>
                      ${safeToFixed(pattern.avgPnL, 0, '0')} avg
                    </span>
                    <span className="text-muted-foreground">
                      {pattern.totalTrades} trades
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {patterns.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>No expiry pattern data available yet</p>
            <p className="text-xs">Patterns will appear as trades are closed</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
