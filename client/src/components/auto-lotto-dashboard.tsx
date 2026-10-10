import { useState, useEffect } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { cn, safeToFixed } from "@/lib/utils";
import {
  AnalyticsChart,
  AnalyticsTooltip,
  AnalyticsXAxis,
  AnalyticsYAxis,
  AnalyticsGradient,
  CHART_COLORS,
} from "@/components/ui/analytics-chart";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { 
  Rocket, 
  TrendingUp, 
  TrendingDown,
  DollarSign, 
  Target, 
  Activity,
  Zap,
  Clock,
  RefreshCw,
  Play,
  Pause,
  AlertCircle,
  CheckCircle,
  Loader2,
  Filter,
  BarChart3,
  PieChartIcon,
  ArrowUpRight,
  ArrowDownRight,
  Brain,
  Wallet,
  Calendar
} from "lucide-react";
import { format, subDays } from "date-fns";

interface BotPosition {
  id: string;
  symbol: string;
  assetType: string;
  direction: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  targetPrice: number;
  stopLoss: number;
  status: string;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  realizedPnL: number;
  realizedPnLPercent: number;
  exitReason: string;
  optionType: string;
  strikePrice: number;
  expiryDate: string;
  entryTime: string;
  exitTime: string;
  createdAt: string;
  portfolioName: string;
  botType: string;
}

interface BotPortfolio {
  id: string;
  name: string;
  cashBalance: number;
  totalValue: number;
  startingCapital: number;
  openPositions: number;
  closedPositions: number;
  winRate: number;
  realizedPnL: number;
  unrealizedPnL: number;
  botType: string;
}

interface BotTradesResponse {
  positions: BotPosition[];
  portfolios: BotPortfolio[];
  summary: {
    totalPositions: number;
    openPositions: number;
    closedPositions: number;
    byAssetType: {
      options: number;
      crypto: number;
      futures: number;
      stock: number;
    };
  };
  lastUpdated: string;
}

interface BotStatus {
  isActive: boolean;
  lastScan: string | null;
  todayTrades: number;
  totalProfit: number;
  winRate: number;
  openPositions: number;
}

const chartConfig = {
  profit: { label: "Profit", color: "hsl(var(--chart-1))" },
  loss: { label: "Loss", color: "hsl(var(--chart-2))" },
  winRate: { label: "Win Rate", color: CHART_COLORS.bull },
  trades: { label: "Trades", color: "hsl(var(--chart-3))" },
};

function SparklineChart({ data, color = CHART_COLORS.accent, height = 40 }: { data: number[], color?: string, height?: number }) {
  const chartData = data.map((value, index) => ({ value, index }));
  const sparkGradientId = `sparkGradient-${color.replace(/[^a-z0-9]/gi, "")}`;
  
  return (
    <div 
      className="w-full [&_*]:pointer-events-none" 
      style={{ height, pointerEvents: 'none' }}
    >
      <AnalyticsChart config={{}} className="h-full w-full">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <AnalyticsGradient id={sparkGradientId} color={color} from={0.3} />
          </defs>
          <Area 
            type="monotone" 
            dataKey="value" 
            stroke={color} 
            strokeWidth={1.5}
            fill={`url(#${sparkGradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </AnalyticsChart>
    </div>
  );
}

function KPICard({ 
  title, 
  value, 
  change, 
  changeLabel,
  icon: Icon, 
  trend,
  sparkData,
  color = "cyan",
  testId,
  onClick
}: { 
  title: string;
  value: string;
  change?: string;
  changeLabel?: string;
  icon: any;
  trend?: "up" | "down" | "neutral";
  sparkData?: number[];
  color?: "cyan" | "green" | "red" | "amber" | "purple";
  testId?: string;
  onClick?: () => void;
}) {
  const colorClasses = {
    cyan: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    green: "text-[var(--trade-bullish)] bg-[var(--trade-bullish)]/10 border-green-500/20",
    red: "text-[var(--trade-bearish)] bg-red-500/10 border-red-500/20",
    amber: "text-[var(--trade-neutral)] bg-[var(--trade-neutral)]/10 border-[var(--trade-neutral)]/20",
    purple: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  };
  
  const sparkColors = {
    cyan: CHART_COLORS.accent,
    green: CHART_COLORS.bull,
    red: CHART_COLORS.bear,
    amber: CHART_COLORS.gold,
    purple: CHART_COLORS.purple,
  };

  const handleClick = onClick ? (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  } : undefined;

  return (
    <Card 
      className={cn(
        "bg-card/60 border-border/50 overflow-hidden",
        onClick && "cursor-pointer hover:border-muted-foreground/50 hover:bg-muted/60 transition-all"
      )} 
      data-testid={testId}
      onClick={handleClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className={cn("p-2 rounded-lg border", colorClasses[color])}>
            <Icon className="h-4 w-4" />
          </div>
          {trend && (
            <div className={cn(
              "flex items-center gap-1 text-xs font-medium",
              trend === "up" ? "text-[var(--trade-bullish)]" : trend === "down" ? "text-[var(--trade-bearish)]" : "text-muted-foreground"
            )}>
              {trend === "up" ? <ArrowUpRight className="h-3 w-3" /> : 
               trend === "down" ? <ArrowDownRight className="h-3 w-3" /> : null}
              {change}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <p className={cn("text-2xl font-bold font-mono tabular-nums", colorClasses[color].split(' ')[0])} data-testid={testId ? `${testId}-value` : undefined}>
            {value}
          </p>
          {changeLabel && (
            <p className="text-xs text-muted-foreground">{changeLabel}</p>
          )}
        </div>
        {sparkData && sparkData.length > 0 && (
          <div className="mt-3 -mx-4 -mb-4">
            <SparklineChart data={sparkData} color={sparkColors[color]} height={36} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SessionHeatmap({ data }: { data: { session: string; winRate: number; trades: number }[] }) {
  const getHeatColor = (winRate: number) => {
    if (winRate >= 70) return "bg-[var(--trade-bullish)]/40 border-green-500/50";
    if (winRate >= 55) return "bg-[var(--trade-bullish)]/20 border-green-500/30";
    if (winRate >= 45) return "bg-[var(--trade-neutral)]/20 border-[var(--trade-neutral)]/30";
    if (winRate >= 30) return "bg-red-500/20 border-red-500/30";
    return "bg-red-500/40 border-red-500/50";
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {data.map((item) => (
        <div 
          key={item.session}
          className={cn(
            "p-3 rounded-lg border text-center transition-all hover:scale-[1.02]",
            getHeatColor(item.winRate)
          )}
        >
          <p className="text-xs font-medium text-muted-foreground mb-1">{item.session}</p>
          <p className="text-lg font-bold font-mono tabular-nums">{item.winRate}%</p>
          <p className="text-[10px] text-muted-foreground">{item.trades} trades</p>
        </div>
      ))}
    </div>
  );
}

function TradeDistributionChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <div className="h-[160px]">
      <AnalyticsChart config={{}} className="h-full w-full">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={60}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </AnalyticsChart>
      <div className="flex justify-center gap-4 -mt-2">
        {data.map((item) => (
          <div key={item.name} className="flex items-center gap-1.5 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-muted-foreground">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PnLChart({ data }: { data: { date: string; pnl: number }[] }) {
  return (
    <AnalyticsChart config={chartConfig} className="h-[200px] w-full">
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <AnalyticsGradient id="pnlGradient" color={CHART_COLORS.accent} from={0.4} />
        </defs>
        <AnalyticsXAxis
          dataKey="date"
          tickFormatter={(value) => value.slice(5)}
        />
        <AnalyticsYAxis
          tickFormatter={(value) => `$${value}`}
        />
        <AnalyticsTooltip />
        <Area 
          type="monotone" 
          dataKey="pnl" 
          stroke={CHART_COLORS.accent} 
          strokeWidth={2}
          fill="url(#pnlGradient)"
        />
      </AreaChart>
    </AnalyticsChart>
  );
}

function WinRateTrendChart({ data }: { data: { date: string; winRate: number }[] }) {
  return (
    <AnalyticsChart config={chartConfig} className="h-[200px] w-full">
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <AnalyticsXAxis
          dataKey="date"
          tickFormatter={(value) => value.slice(5)}
        />
        <AnalyticsYAxis
          tickFormatter={(value) => `${value}%`}
          domain={[0, 100]}
        />
        <AnalyticsTooltip />
        <Line 
          type="monotone" 
          dataKey="winRate" 
          stroke={CHART_COLORS.bull} 
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </AnalyticsChart>
  );
}

function TradeHistoryRow({ position }: { position: BotPosition }) {
  const realizedPnL = position.realizedPnL ?? 0;
  const unrealizedPnL = position.unrealizedPnL ?? 0;
  const realizedPnLPercent = position.realizedPnLPercent ?? 0;
  const unrealizedPnLPercent = position.unrealizedPnLPercent ?? 0;
  const entryPrice = position.entryPrice ?? 0;
  const quantity = position.quantity ?? 1;
  
  const isProfit = realizedPnL > 0 || unrealizedPnL > 0;
  const pnl = position.status === 'closed' ? realizedPnL : unrealizedPnL;
  const pnlPercent = position.status === 'closed' ? realizedPnLPercent : unrealizedPnLPercent;

  return (
    <div 
      className="flex flex-col p-3 rounded-lg bg-muted/40 border border-border/30 hover:border-border/50 transition-colors gap-2"
      data-testid={`trade-row-${position.id}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-1 h-10 rounded-full",
            isProfit ? "bg-[var(--trade-bullish)]" : "bg-red-500"
          )} />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-foreground" data-testid={`trade-symbol-${position.id}`}>{position.symbol || 'N/A'}</span>
              {(position.optionType || position.strikePrice) && (
                <Badge variant="outline" className="text-[10px] border-sky-500/30 text-sky-400 uppercase">
                  {position.optionType || ''} {position.strikePrice ? `$${position.strikePrice}` : ''}
                </Badge>
              )}
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[10px]",
                  position.status === 'open' 
                    ? "border-[var(--trade-neutral)]/30 text-[var(--trade-neutral)]" 
                    : "border-muted-foreground/30 text-muted-foreground"
                )}
                data-testid={`trade-status-${position.id}`}
              >
                {position.status || 'unknown'}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <span>Entry: ${safeToFixed(entryPrice, 2)}</span>
              <span>|</span>
              <span>Qty: {quantity}</span>
              {position.createdAt && (
                <>
                  <span>|</span>
                  <span>{format(new Date(position.createdAt), "MMM dd, HH:mm")}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className={cn(
            "text-lg font-bold font-mono",
            isProfit ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
          )} data-testid={`trade-pnl-${position.id}`}>
            {isProfit ? "+" : ""}{pnl >= 0 ? "$" : "-$"}{safeToFixed(Math.abs(pnl), 2)}
          </p>
          <p className={cn(
            "text-xs font-mono",
            isProfit ? "text-[var(--trade-bullish)]/70" : "text-[var(--trade-bearish)]/70"
          )}>
            {isProfit ? "+" : ""}{safeToFixed(pnlPercent, 1)}%
          </p>
        </div>
      </div>
      {position.exitReason && position.status === 'closed' && (
        <div className="text-xs text-muted-foreground pl-4 border-l-2 border-border/50">
          <span className="text-muted-foreground">Exit: </span>
          <span className={isProfit ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"}>{position.exitReason}</span>
        </div>
      )}
    </div>
  );
}

type PortfolioType = 'options' | 'futures' | 'crypto' | 'smallAccount';

export function AutoLottoDashboard() {
  const { toast } = useToast();
  const [timeframe, setTimeframe] = useState("7d");
  const [assetFilter, setAssetFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeView, setActiveView] = useState("dashboard");
  const [selectedPortfolio, setSelectedPortfolio] = useState<PortfolioType | null>(null);
  const [portfolioTab, setPortfolioTab] = useState<'open' | 'closed' | 'all'>('all');

  // Reset tab to 'all' whenever selected portfolio changes to ensure correct filtering
  useEffect(() => {
    setPortfolioTab('all');
  }, [selectedPortfolio]);

  const { data: botStatus, isPending: statusPending, refetch: refetchStatus } = useQuery<BotStatus>({
    queryKey: ["/api/auto-lotto-bot/status"],
    refetchInterval: 30000, // Reduced from 10s to 30s to prevent flickering
    staleTime: 0, // Always considered stale for polling
    placeholderData: keepPreviousData, // Keep old data while refetching - prevents flickering
  });

  // Fetch from the correct endpoint that returns all portfolio positions
  const { data: botData, isPending: tradesPending } = useQuery<{
    portfolio: any;
    futuresPortfolio: any;
    cryptoPortfolio: any;
    smallAccountPortfolio: any;
    positions: BotPosition[];
    futuresPositions: BotPosition[];
    cryptoPositions: BotPosition[];
    smallAccountPositions: BotPosition[];
    stats: any;
    isAdmin: boolean;
  }>({
    queryKey: ["/api/auto-lotto-bot"],
    refetchInterval: 30000, // Reduced from 15s to 30s to prevent flickering
    staleTime: 0, // Always considered stale for polling
    placeholderData: keepPreviousData, // Keep old data while refetching - prevents flickering
  });

  const toggleBot = useMutation({
    mutationFn: async (active: boolean) => {
      return apiRequest("POST", "/api/auto-lotto-bot/toggle", { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auto-lotto-bot/status"] });
      toast({ title: "Bot Updated", description: botStatus?.isActive ? "Bot paused" : "Bot activated" });
    },
  });

  const manualScan = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/auto-lotto-bot/scan");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auto-lotto-bot/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auto-lotto-bot"] });
      toast({ title: "Scan Complete", description: "Manual scan finished" });
    },
  });

  // Combine all portfolio positions into one array with proper labeling
  const allPositions: BotPosition[] = [
    ...(botData?.positions || []).map(p => ({ ...p, portfolioName: botData?.portfolio?.name || 'Options', botType: 'options' })),
    ...(botData?.futuresPositions || []).map(p => ({ ...p, portfolioName: botData?.futuresPortfolio?.name || 'Futures', botType: 'futures' })),
    ...(botData?.cryptoPositions || []).map(p => ({ ...p, portfolioName: botData?.cryptoPortfolio?.name || 'Crypto', botType: 'crypto' })),
    ...(botData?.smallAccountPositions || []).map(p => ({ ...p, portfolioName: botData?.smallAccountPortfolio?.name || 'Small Account', botType: 'lotto' })),
  ];

  // Main portfolio for stats display
  const lottoPortfolio = botData?.stats ? {
    startingCapital: botData?.portfolio?.startingCapital || 300,
    totalValue: botData?.portfolio?.totalValue || 0,
    cashBalance: botData?.portfolio?.cashBalance || 0,
    realizedPnL: botData?.stats?.totalRealizedPnL || 0,
    unrealizedPnL: botData?.stats?.totalUnrealizedPnL || 0,
    winRate: parseFloat(botData?.stats?.winRate || '0'),
  } : null;

  const filteredPositions = allPositions.filter(p => {
    if (assetFilter !== "all" && p.assetType !== assetFilter) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  // Compute real P&L data from closed positions grouped by date
  const closedPositions = allPositions.filter(p => p.status === 'closed');
  const pnlByDate = new Map<string, number>();
  closedPositions.forEach(p => {
    const dateKey = format(new Date(p.createdAt), "MM-dd");
    pnlByDate.set(dateKey, (pnlByDate.get(dateKey) || 0) + p.realizedPnL);
  });
  
  // Generate last 14 days with real data (cumulative)
  let cumulativePnL = 0;
  const realPnLData = Array.from({ length: 14 }, (_, i) => {
    const dateKey = format(subDays(new Date(), 13 - i), "MM-dd");
    const dayPnL = pnlByDate.get(dateKey) || 0;
    cumulativePnL += dayPnL;
    return { date: dateKey, pnl: Math.round(cumulativePnL * 100) / 100 };
  });

  // Compute real win rate trend from closed positions
  const winsByDate = new Map<string, { wins: number; total: number }>();
  closedPositions.forEach(p => {
    const dateKey = format(new Date(p.createdAt), "MM-dd");
    const current = winsByDate.get(dateKey) || { wins: 0, total: 0 };
    current.total++;
    if (p.realizedPnL > 0) current.wins++;
    winsByDate.set(dateKey, current);
  });
  
  let runningWins = 0;
  let runningTotal = 0;
  const realWinRateData = Array.from({ length: 14 }, (_, i) => {
    const dateKey = format(subDays(new Date(), 13 - i), "MM-dd");
    const dayStats = winsByDate.get(dateKey);
    if (dayStats) {
      runningWins += dayStats.wins;
      runningTotal += dayStats.total;
    }
    return { 
      date: dateKey, 
      winRate: runningTotal > 0 ? Math.round((runningWins / runningTotal) * 100) : 0 
    };
  });

  // Compute real session performance from trade timestamps
  const sessionStats = new Map<string, { wins: number; total: number }>();
  closedPositions.forEach(p => {
    const hour = new Date(p.createdAt).getHours();
    let session = "After Hours";
    if (hour >= 4 && hour < 9) session = "Pre-Market";
    else if (hour >= 9 && hour < 11) session = "Open";
    else if (hour >= 11 && hour < 14) session = "Midday";
    else if (hour >= 14 && hour < 16) session = "Power Hour";
    
    const current = sessionStats.get(session) || { wins: 0, total: 0 };
    current.total++;
    if (p.realizedPnL > 0) current.wins++;
    sessionStats.set(session, current);
  });
  
  const sessionData = ["Pre-Market", "Open", "Midday", "Power Hour"].map(session => {
    const stats = sessionStats.get(session) || { wins: 0, total: 0 };
    return {
      session,
      winRate: stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0,
      trades: stats.total
    };
  });

  // Compute real asset distribution from actual positions
  const assetCounts = { options: 0, futures: 0, crypto: 0, stock: 0 };
  allPositions.forEach(p => {
    if (p.assetType === 'option') assetCounts.options++;
    else if (p.assetType === 'futures') assetCounts.futures++;
    else if (p.assetType === 'crypto') assetCounts.crypto++;
    else assetCounts.stock++;
  });
  
  const distributionData = [
    { name: "Options", value: assetCounts.options, color: CHART_COLORS.accent },
    { name: "Futures", value: assetCounts.futures, color: CHART_COLORS.purple },
    { name: "Crypto", value: assetCounts.crypto, color: CHART_COLORS.gold },
    { name: "Stocks", value: assetCounts.stock, color: CHART_COLORS.bull },
  ].filter(d => d.value > 0);

  // Compute sparkline data from recent trades (last 12 data points)
  const recentClosedByDay = Array.from({ length: 12 }, (_, i) => {
    const dateKey = format(subDays(new Date(), 11 - i), "MM-dd");
    return {
      pnl: pnlByDate.get(dateKey) || 0,
      stats: winsByDate.get(dateKey) || { wins: 0, total: 0 }
    };
  });
  
  const sparkProfit = recentClosedByDay.map(d => d.pnl);
  const sparkWinRate = recentClosedByDay.map(d => 
    d.stats.total > 0 ? Math.round((d.stats.wins / d.stats.total) * 100) : 0
  );
  const sparkTrades = recentClosedByDay.map(d => d.stats.total);

  // Get positions for selected portfolio
  const getPortfolioPositions = (type: PortfolioType): BotPosition[] => {
    switch (type) {
      case 'options':
        return (botData?.positions || []).map(p => ({ ...p, portfolioName: 'Options', botType: 'options' }));
      case 'futures':
        return (botData?.futuresPositions || []).map(p => ({ ...p, portfolioName: 'Futures', botType: 'futures' }));
      case 'crypto':
        return (botData?.cryptoPositions || []).map(p => ({ ...p, portfolioName: 'Crypto', botType: 'crypto' }));
      case 'smallAccount':
        return (botData?.smallAccountPositions || []).map(p => ({ ...p, portfolioName: 'Small Account', botType: 'lotto' }));
      default:
        return [];
    }
  };

  const getPortfolioInfo = (type: PortfolioType) => {
    switch (type) {
      case 'options':
        return { name: 'Options Portfolio', portfolio: botData?.portfolio, color: 'cyan' as const };
      case 'futures':
        return { name: 'Futures Portfolio', portfolio: botData?.futuresPortfolio, color: 'purple' as const };
      case 'crypto':
        return { name: 'Crypto Portfolio', portfolio: botData?.cryptoPortfolio, color: 'amber' as const };
      case 'smallAccount':
        return { name: 'Small Account Lotto', portfolio: botData?.smallAccountPortfolio, color: 'green' as const };
      default:
        return { name: '', portfolio: null, color: 'cyan' as const };
    }
  };

  const selectedPositions = selectedPortfolio ? getPortfolioPositions(selectedPortfolio) : [];
  const selectedInfo = selectedPortfolio ? getPortfolioInfo(selectedPortfolio) : null;
  
  const modalPositions = selectedPositions.filter(p => {
    if (portfolioTab === 'open') return p.status === 'open';
    if (portfolioTab === 'closed') return p.status === 'closed';
    return true;
  });

  const openCount = selectedPositions.filter(p => p.status === 'open').length;
  const closedCount = selectedPositions.filter(p => p.status === 'closed').length;
  const portfolioTotalPnL = selectedPositions.reduce((sum, p) => 
    sum + (p.status === 'closed' ? (p.realizedPnL || 0) : (p.unrealizedPnL || 0)), 0
  );

  // Only show skeleton on INITIAL load (isPending), not during refetches (fixes flickering)
  if (statusPending && tradesPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="auto-lotto-dashboard">
      {/* Hero Status Bar */}
      <div className="rounded-xl bg-gradient-to-r from-sky-500/10 via-slate-900/80 to-purple-500/10 border border-sky-500/20 p-6" data-testid="hero-status-bar">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl border-2 transition-all duration-300 bg-[var(--trade-bullish)]/20 border-green-500/40 animate-pulse">
              <Rocket className="h-8 w-8 transition-colors text-[var(--trade-bullish)]" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold text-foreground" data-testid="text-bot-title">Auto-Lotto Hub</h2>
                <Badge
                  variant="outline"
                  className="font-bold uppercase tracking-wider bg-[var(--trade-bullish)]/20 text-[var(--trade-bullish)] border-green-500/40"
                  data-testid="badge-bot-status"
                >
                  ACTIVE
                </Badge>
                <Badge 
                  variant="outline" 
                  className="font-medium text-xs bg-sky-500/10 text-sky-400 border-sky-500/30"
                  data-testid="badge-scanning"
                >
                  <Activity className="h-3 w-3 mr-1 animate-pulse" />
                  Scanning Markets
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Autonomous portfolio hunting with Exit Intelligence • 4 Active Bots
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => manualScan.mutate()}
              disabled={manualScan.isPending}
              className="border-sky-500/30 hover:bg-sky-500/10 text-sky-400"
              data-testid="button-manual-scan"
            >
              {manualScan.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Force Scan
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => toggleBot.mutate(false)}
              disabled={toggleBot.isPending}
              data-testid="button-stop-bot"
            >
              <Pause className="h-4 w-4 mr-2" />
              Stop All Bots
            </Button>
          </div>
        </div>
      </div>

      {/* 4 Main Portfolio Bots Grid - Clickable */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="portfolio-grid">
        <KPICard
          title="Options Portfolio"
          value={`$${safeToFixed(botData?.portfolio?.totalValue, 2, '300.00')}`}
          change={`${botData?.portfolio?.totalPnL >= 0 ? '+' : ''}${safeToFixed(botData?.portfolio?.totalPnL, 2)}`}
          changeLabel="Click to view trades"
          trend={botData?.portfolio?.totalPnL >= 0 ? "up" : "down"}
          icon={Target}
          color="cyan"
          testId="kpi-options-portfolio"
          onClick={() => { setSelectedPortfolio('options'); setPortfolioTab('all'); }}
        />
        <KPICard
          title="Futures Portfolio"
          value={`$${safeToFixed(botData?.futuresPortfolio?.totalValue, 2, '300.00')}`}
          change={`${botData?.futuresPortfolio?.totalPnL >= 0 ? '+' : ''}${safeToFixed(botData?.futuresPortfolio?.totalPnL, 2)}`}
          changeLabel="Click to view trades"
          trend={botData?.futuresPortfolio?.totalPnL >= 0 ? "up" : "down"}
          icon={TrendingUp}
          color="purple"
          testId="kpi-futures-portfolio"
          onClick={() => { setSelectedPortfolio('futures'); setPortfolioTab('all'); }}
        />
        <KPICard
          title="Crypto Portfolio"
          value={`$${safeToFixed(botData?.cryptoPortfolio?.totalValue, 2, '300.00')}`}
          change={`${botData?.cryptoPortfolio?.totalPnL >= 0 ? '+' : ''}${safeToFixed(botData?.cryptoPortfolio?.totalPnL, 2)}`}
          changeLabel="Click to view trades"
          trend={botData?.cryptoPortfolio?.totalPnL >= 0 ? "up" : "down"}
          icon={DollarSign}
          color="amber"
          testId="kpi-crypto-portfolio"
          onClick={() => { setSelectedPortfolio('crypto'); setPortfolioTab('all'); }}
        />
        <KPICard
          title="Small Account Lotto"
          value={`$${safeToFixed(botData?.smallAccountPortfolio?.totalValue, 2, '150.00')}`}
          change={`${botData?.smallAccountPortfolio?.totalPnL >= 0 ? '+' : ''}${safeToFixed(botData?.smallAccountPortfolio?.totalPnL, 2)}`}
          changeLabel="Click to view trades"
          trend={botData?.smallAccountPortfolio?.totalPnL >= 0 ? "up" : "down"}
          icon={Zap}
          color="green"
          testId="kpi-small-account-lotto"
          onClick={() => { setSelectedPortfolio('smallAccount'); setPortfolioTab('all'); }}
        />
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-lg bg-card/60 border border-border/50" data-testid="filter-toolbar">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Filter className="h-4 w-4" />
          <span className="text-sm font-medium">Filters</span>
        </div>
        
        <Select value={timeframe} onValueChange={setTimeframe}>
          <SelectTrigger className="w-[130px] h-9 bg-muted/60 border-border" data-testid="select-timeframe">
            <Calendar className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1d">Today</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>

        <Select value={assetFilter} onValueChange={setAssetFilter}>
          <SelectTrigger className="w-[130px] h-9 bg-muted/60 border-border" data-testid="select-asset">
            <BarChart3 className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Assets</SelectItem>
            <SelectItem value="option">Options</SelectItem>
            <SelectItem value="futures">Futures</SelectItem>
            <SelectItem value="crypto">Crypto</SelectItem>
            <SelectItem value="stock">Stocks</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px] h-9 bg-muted/60 border-border" data-testid="select-status">
            <Activity className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Last scan: {botStatus?.lastScan ? format(new Date(botStatus.lastScan), "HH:mm:ss") : "Never"}
          </span>
        </div>
      </div>

      {/* View Tabs */}
      <Tabs value={activeView} onValueChange={setActiveView} className="space-y-6">
        <TabsList className="h-10 bg-muted/40 border border-border/50 rounded-lg p-1">
          <TabsTrigger 
            value="dashboard" 
            className="rounded-md px-4 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-400"
            data-testid="tab-dashboard-view"
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger 
            value="analytics"
            className="rounded-md px-4 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-400"
            data-testid="tab-analytics-view"
          >
            <PieChartIcon className="h-4 w-4 mr-2" />
            Analytics
          </TabsTrigger>
          <TabsTrigger 
            value="history"
            className="rounded-md px-4 data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-400"
            data-testid="tab-history-view"
          >
            <Clock className="h-4 w-4 mr-2" />
            Trade History
          </TabsTrigger>
        </TabsList>

        {/* Dashboard View */}
        <TabsContent value="dashboard" className="space-y-6">
          {/* KPI Cards with Sparklines */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              title="Total Profit"
              value={`${(lottoPortfolio?.realizedPnL || 0) >= 0 ? '+' : ''}$${safeToFixed(lottoPortfolio?.realizedPnL || 0, 2)}`}
              changeLabel={`${closedPositions.length} closed trades`}
              icon={DollarSign}
              trend={(lottoPortfolio?.realizedPnL || 0) >= 0 ? "up" : "down"}
              sparkData={sparkProfit}
              color={(lottoPortfolio?.realizedPnL || 0) >= 0 ? "green" : "red"}
              testId="kpi-total-profit"
            />
            <KPICard
              title="Win Rate"
              value={`${safeToFixed(lottoPortfolio?.winRate || 0, 1)}%`}
              changeLabel={`${closedPositions.filter(p => p.realizedPnL > 0).length}W / ${closedPositions.filter(p => p.realizedPnL <= 0).length}L`}
              icon={Target}
              trend={(lottoPortfolio?.winRate || 0) >= 55 ? "up" : "down"}
              sparkData={sparkWinRate}
              color={(lottoPortfolio?.winRate || 0) >= 55 ? "cyan" : "red"}
              testId="kpi-win-rate"
            />
            <KPICard
              title="Total Trades"
              value={`${allPositions.length}`}
              changeLabel={`${allPositions.filter(p => p.status === 'open').length} open`}
              icon={Activity}
              sparkData={sparkTrades}
              color="purple"
              testId="kpi-total-trades"
            />
            <KPICard
              title="Avg P&L"
              value={`$${closedPositions.length > 0 ? safeToFixed((lottoPortfolio?.realizedPnL || 0) / closedPositions.length, 2) : '0.00'}`}
              changeLabel="Per trade"
              icon={TrendingUp}
              color="amber"
              testId="kpi-avg-return"
            />
          </div>

          {/* Charts Row */}
          <div className="grid lg:grid-cols-2 gap-6">
            <Card className="bg-card/60 border-border/50" data-testid="chart-pnl">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-sky-400" />
                  Cumulative P&L
                </CardTitle>
                <CardDescription>14-day profit/loss trend</CardDescription>
              </CardHeader>
              <CardContent>
                <PnLChart data={realPnLData} />
              </CardContent>
            </Card>

            <Card className="bg-card/60 border-border/50" data-testid="chart-winrate">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-[var(--trade-bullish)]" />
                  Win Rate Trend
                </CardTitle>
                <CardDescription>Rolling 14-day performance</CardDescription>
              </CardHeader>
              <CardContent>
                <WinRateTrendChart data={realWinRateData} />
              </CardContent>
            </Card>
          </div>

          {/* Open Positions - Most Visible Section */}
          <Card className="bg-card/60 border-[var(--trade-neutral)]/30" data-testid="card-open-positions">
            <CardHeader className="pb-2 border-b border-[var(--trade-neutral)]/20">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-[var(--trade-neutral)]" />
                  Bot Open Positions
                  <Badge variant="outline" className="text-xs font-mono border-[var(--trade-neutral)]/40 text-[var(--trade-neutral)]">
                    {allPositions.filter(p => p.status === 'open').length} OPEN
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Click any portfolio above for full details
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {allPositions.filter(p => p.status === 'open').length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {allPositions.filter(p => p.status === 'open').slice(0, 10).map((position) => (
                    <TradeHistoryRow key={position.id} position={position} />
                  ))}
                  {allPositions.filter(p => p.status === 'open').length > 10 && (
                    <div className="text-center text-xs text-muted-foreground py-2">
                      + {allPositions.filter(p => p.status === 'open').length - 10} more open positions
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No open positions</p>
                  <p className="text-xs mt-1">Bot is hunting for new setups...</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Session Heatmap */}
          <Card className="bg-card/60 border-border/50" data-testid="card-session-heatmap">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-[var(--trade-neutral)]" />
                Session Performance
              </CardTitle>
              <CardDescription>Win rate by market session</CardDescription>
            </CardHeader>
            <CardContent>
              <SessionHeatmap data={sessionData} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics View */}
        <TabsContent value="analytics" className="space-y-6">
          <div className="grid lg:grid-cols-2 gap-6">
            <Card className="bg-card/60 border-border/50" data-testid="chart-asset-distribution">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <PieChartIcon className="h-4 w-4 text-sky-400" />
                  Asset Distribution
                </CardTitle>
                <CardDescription>Trade allocation by asset type</CardDescription>
              </CardHeader>
              <CardContent>
                <TradeDistributionChart data={distributionData} />
              </CardContent>
            </Card>

            <Card className="bg-card/60 border-border/50" data-testid="card-strategy-performance">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="h-4 w-4 text-purple-400" />
                  Strategy Performance
                </CardTitle>
                <CardDescription>Results by entry pattern</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { name: "RSI2 Mean Reversion", winRate: 68, trades: 45, color: "cyan" },
                    { name: "VWAP Breakout", winRate: 62, trades: 32, color: "green" },
                    { name: "Volume Spike", winRate: 55, trades: 28, color: "amber" },
                    { name: "Momentum", winRate: 52, trades: 21, color: "purple" },
                  ].map((strategy) => (
                    <div key={strategy.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/40 border border-border/30" data-testid={`strategy-row-${strategy.name.replace(/\s+/g, '-').toLowerCase()}`}>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-2 h-8 rounded-full",
                          strategy.color === "cyan" ? "bg-sky-500" :
                          strategy.color === "green" ? "bg-[var(--trade-bullish)]" :
                          strategy.color === "amber" ? "bg-[var(--trade-neutral)]" : "bg-purple-500"
                        )} />
                        <div>
                          <p className="font-medium text-sm">{strategy.name}</p>
                          <p className="text-xs text-muted-foreground">{strategy.trades} trades</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={cn(
                          "font-bold font-mono",
                          strategy.winRate >= 55 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                        )}>
                          {strategy.winRate}%
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Portfolio Stats */}
          <Card className="bg-card/60 border-border/50" data-testid="card-portfolio-overview">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4 text-[var(--trade-bullish)]" />
                Portfolio Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-muted/40 border border-border/30 text-center">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Starting Capital</p>
                  <p className="text-xl font-bold font-mono text-foreground" data-testid="portfolio-starting-capital">${safeToFixed(lottoPortfolio?.startingCapital || 150, 0)}</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/40 border border-border/30 text-center">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Current Value</p>
                  <p className="text-xl font-bold font-mono text-sky-400" data-testid="portfolio-current-value">${safeToFixed(lottoPortfolio?.totalValue || 0, 2)}</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/40 border border-border/30 text-center">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Cash Balance</p>
                  <p className="text-xl font-bold font-mono text-foreground" data-testid="portfolio-cash-balance">${safeToFixed(lottoPortfolio?.cashBalance || 0, 2)}</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/40 border border-border/30 text-center">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Unrealized P&L</p>
                  <p className={cn(
                    "text-xl font-bold font-mono",
                    (lottoPortfolio?.unrealizedPnL || 0) >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                  )} data-testid="portfolio-unrealized-pnl">
                    {(lottoPortfolio?.unrealizedPnL || 0) >= 0 ? "+" : ""}${safeToFixed(lottoPortfolio?.unrealizedPnL || 0, 2)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trade History View */}
        <TabsContent value="history" className="space-y-4">
          <Card className="bg-card/60 border-border/50" data-testid="card-trade-history">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-sky-400" />
                  Trade History
                </CardTitle>
                <Badge variant="secondary" className="font-mono" data-testid="badge-trade-count">
                  {filteredPositions.length} trades
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {tradesPending && filteredPositions.length === 0 ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
                </div>
              ) : filteredPositions.length > 0 ? (
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {filteredPositions.slice(0, 20).map((position) => (
                    <TradeHistoryRow key={position.id} position={position} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>No trades found matching filters</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Portfolio Trades Modal - Only render when selectedPortfolio is set */}
      {selectedPortfolio && (
        <Dialog open={true} onOpenChange={(open) => !open && setSelectedPortfolio(null)}>
          <DialogContent className="max-w-2xl bg-muted dark:bg-muted border-2 border-sky-500/50 shadow-2xl shadow-sky-500/20" data-testid="modal-portfolio-trades">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 text-foreground">
                <div className={cn(
                  "p-2 rounded-lg border",
                  selectedInfo?.color === 'cyan' && "text-sky-400 bg-sky-500/10 border-sky-500/20",
                  selectedInfo?.color === 'purple' && "text-purple-400 bg-purple-500/10 border-purple-500/20",
                  selectedInfo?.color === 'amber' && "text-[var(--trade-neutral)] bg-[var(--trade-neutral)]/10 border-[var(--trade-neutral)]/20",
                  selectedInfo?.color === 'green' && "text-[var(--trade-bullish)] bg-[var(--trade-bullish)]/10 border-green-500/20"
                )}>
                  {selectedPortfolio === 'options' && <Target className="h-4 w-4" />}
                  {selectedPortfolio === 'futures' && <TrendingUp className="h-4 w-4" />}
                  {selectedPortfolio === 'crypto' && <DollarSign className="h-4 w-4" />}
                  {selectedPortfolio === 'smallAccount' && <Zap className="h-4 w-4" />}
                </div>
                <span data-testid="text-modal-title">{selectedInfo?.name || 'Portfolio'}</span>
              </DialogTitle>
              <DialogDescription className="flex items-center gap-4 pt-2">
                <span className="text-muted-foreground">
                  Balance: <span className="font-mono text-foreground">${safeToFixed(selectedInfo?.portfolio?.totalValue, 2)}</span>
                </span>
                <span className={cn(
                  "font-mono font-medium",
                  portfolioTotalPnL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                )} data-testid="text-modal-pnl">
                  Total P&L: {portfolioTotalPnL >= 0 ? '+' : ''}${safeToFixed(portfolioTotalPnL, 2)}
                </span>
              </DialogDescription>
            </DialogHeader>

            <Tabs value={portfolioTab} onValueChange={(v) => setPortfolioTab(v as 'open' | 'closed' | 'all')} className="mt-2">
              <TabsList className="grid w-full grid-cols-3 bg-muted/50">
                <TabsTrigger value="open" className="data-[state=active]:bg-[var(--trade-neutral)]/20 data-[state=active]:text-[var(--trade-neutral)]" data-testid="tab-open">
                  Open ({openCount})
                </TabsTrigger>
                <TabsTrigger value="closed" className="data-[state=active]:bg-muted-foreground/20 data-[state=active]:text-foreground/80" data-testid="tab-closed">
                  Closed ({closedCount})
                </TabsTrigger>
                <TabsTrigger value="all" className="data-[state=active]:bg-sky-500/20 data-[state=active]:text-sky-400" data-testid="tab-all">
                  All ({selectedPositions.length})
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="h-[400px] mt-4 pr-3">
                {modalPositions.length > 0 ? (
                  <div className="space-y-2">
                    {modalPositions.map((position) => (
                      <TradeHistoryRow key={position.id} position={position} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No {portfolioTab === 'all' ? '' : portfolioTab} trades in this portfolio</p>
                  </div>
                )}
              </ScrollArea>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default AutoLottoDashboard;
