import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Activity,
  Bot,
  Zap,
  Target,
  RefreshCw,
  Calendar,
  FileText,
  Brain,
  Cpu,
  Sparkles,
  DollarSign,
  PieChart,
  Trophy,
  XCircle,
  ArrowRight,
  Clock,
  AlertTriangle,
  Download,
} from "lucide-react";
import { generatePlatformReportPDF } from "@/lib/pdf-export";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn, safeToFixed } from "@/lib/utils";
import { format } from "date-fns";
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import {
  AnalyticsChart,
  AnalyticsTooltip,
  AnalyticsXAxis,
  AnalyticsYAxis,
  AnalyticsGrid,
  CHART_COLORS,
  CHART_RAMP,
} from "@/components/ui/analytics-chart";

/** Recharts value union — keeps tooltip formatters assignable to the themed
 *  tooltip's non-generic Formatter<ValueType, NameType> prop. */
type ChartValue = number | string | Array<number | string>;

import type { PlatformReport } from "@shared/schema";

interface PlatformStats {
  summary: {
    totalIdeas: number;
    openIdeas: number;
    resolvedIdeas: number;
    overallWinRate: number | null;
  };
  engines: Array<{
    engine: string;
    totalIdeas: number;
    trades: number;
    wins: number;
    losses: number;
    winRate: number | null;
    avgGain: number;
    avgLoss: number;
  }>;
  bestEngine: string;
  byAsset: {
    stock: number;
    options: number;
    crypto: number;
    futures: number;
  };
  topWinners: Array<{
    symbol: string;
    wins: number;
    losses: number;
    totalPnl: number;
    winRate: number;
  }>;
  topLosers: Array<{
    symbol: string;
    wins: number;
    losses: number;
    totalPnl: number;
    winRate: number;
  }>;
  botActivity: {
    autoLotto: { trades: number; pnl: number };
    futures: { trades: number; pnl: number };
    crypto: { trades: number; pnl: number };
    propFirm: { trades: number; pnl: number };
  };
  scannerActivity: {
    optionsFlowAlerts: number;
    marketScannerSymbols: number;
    ctTrackerMentions: number;
    ctTrackerAutoTrades: number;
  };
}

interface LatestReports {
  daily: PlatformReport | null;
  weekly: PlatformReport | null;
  monthly: PlatformReport | null;
}

function getCSRFToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

const ENGINE_COLORS: Record<string, string> = {
  ai: CHART_COLORS.purple,
  quant: CHART_COLORS.blue,
  hybrid: CHART_COLORS.accent,
  flow: CHART_COLORS.bull,
  lotto: CHART_COLORS.gold,
};

const ENGINE_LABELS: Record<string, string> = {
  ai: "AI Engine",
  quant: "Quant Engine",
  hybrid: "Hybrid Engine",
  flow: "Flow Scanner",
  lotto: "Lotto Scanner",
};

// Categorical ramp in CHART_RAMP order: accent, gold, purple, blue.
const ASSET_COLORS: string[] = CHART_RAMP.slice(0, 4);

export default function AdminReportsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { toast } = useToast();

  useQuery({
    queryKey: ["/api/admin/check-auth"],
    queryFn: async () => {
      const res = await fetch("/api/admin/check-auth", {
        credentials: "include",
      });
      if (res.ok) {
        setIsAuthenticated(true);
        return true;
      }
      setIsAuthenticated(false);
      return false;
    },
    retry: false,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<PlatformStats>({
    queryKey: ["/api/admin/reports/stats"],
    enabled: isAuthenticated,
    queryFn: async () => {
      const res = await fetch("/api/admin/reports/stats", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const { data: latestReports, isLoading: reportsLoading } = useQuery<LatestReports>({
    queryKey: ["/api/admin/reports/latest"],
    enabled: isAuthenticated,
    queryFn: async () => {
      const res = await fetch("/api/admin/reports/latest", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch reports");
      return res.json();
    },
  });

  const { data: allReports, isLoading: allReportsLoading } = useQuery<PlatformReport[]>({
    queryKey: ["/api/admin/reports", selectedPeriod],
    enabled: isAuthenticated,
    queryFn: async () => {
      const res = await fetch(`/api/admin/reports?period=${selectedPeriod}&limit=10`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch reports");
      return res.json();
    },
  });

  const generateReportMutation = useMutation({
    mutationFn: async (period: string) => {
      const csrfToken = getCSRFToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrfToken) {
        headers["x-csrf-token"] = csrfToken;
      }
      const res = await fetch("/api/admin/reports/generate", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ period }),
      });
      if (!res.ok) throw new Error("Failed to generate report");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Report Generated", description: `${selectedPeriod} report generated successfully` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reports/latest"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to generate report", variant: "destructive" });
    },
  });

  if (!isAuthenticated) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Card className="glass-card w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[var(--trade-neutral)]" />
              Admin Access Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Please authenticate via the Admin Panel first to access reports.
            </p>
            <Button onClick={() => window.location.href = "/admin"} data-testid="button-go-to-admin">
              Go to Admin Panel
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const assetChartData = stats ? [
    { name: "Stocks", value: stats.byAsset.stock, color: ASSET_COLORS[0] },
    { name: "Options", value: stats.byAsset.options, color: ASSET_COLORS[1] },
    { name: "Crypto", value: stats.byAsset.crypto, color: ASSET_COLORS[2] },
    { name: "Futures", value: stats.byAsset.futures, color: ASSET_COLORS[3] },
  ].filter(d => d.value > 0) : [];

  const engineChartData = stats?.engines.map(e => ({
    engine: ENGINE_LABELS[e.engine] || e.engine,
    winRate: e.winRate || 0,
    trades: e.trades,
    fill: ENGINE_COLORS[e.engine] || CHART_COLORS.slate,
  })) || [];

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold flex items-center gap-3" data-testid="text-page-title">
            <FileText className="h-7 w-7 text-sky-400" />
            Platform Reports Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Comprehensive analytics and performance reports
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedPeriod} onValueChange={(v) => setSelectedPeriod(v as typeof selectedPeriod)}>
            <SelectTrigger className="w-[140px]" data-testid="select-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => generateReportMutation.mutate(selectedPeriod)}
            disabled={generateReportMutation.isPending}
            className="bg-sky-500 hover:bg-sky-400 text-foreground"
            data-testid="button-generate-report"
          >
            {generateReportMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 mr-2" />
            )}
            Generate {selectedPeriod.charAt(0).toUpperCase() + selectedPeriod.slice(1)} Report
          </Button>
        </div>
      </div>

      {/* Report Overview Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {["daily", "weekly", "monthly"].map((period) => {
          const report = latestReports?.[period as keyof LatestReports];
          const isSelected = period === selectedPeriod;
          return (
            <Card
              key={period}
              className={cn(
                "glass-card cursor-pointer transition-all",
                isSelected && "ring-2 ring-sky-500/50"
              )}
              onClick={() => setSelectedPeriod(period as typeof selectedPeriod)}
              data-testid={`card-${period}-report`}
            >
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium capitalize flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  {period} Report
                </CardTitle>
                {report?.status === "completed" ? (
                  <Badge className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/30">Completed</Badge>
                ) : report?.status === "generating" ? (
                  <Badge className="bg-amber-500/10 text-[var(--trade-neutral)] border-amber-500/30">Generating</Badge>
                ) : (
                  <Badge variant="secondary">No Data</Badge>
                )}
              </CardHeader>
              <CardContent>
                {reportsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ) : report ? (
                  <div className="space-y-2">
                    <p className="text-2xl font-bold font-mono tabular-nums" data-testid={`text-${period}-ideas`}>
                      {report.totalIdeasGenerated || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Ideas Generated
                    </p>
                    <div className="flex items-center gap-4 pt-2 text-sm">
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-[var(--trade-bullish)]" />
                        <span className="font-mono tabular-nums text-[var(--trade-bullish)]">
                          {report.overallWinRate != null ? safeToFixed(report.overallWinRate, 1) : "—"}%
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Trophy className="h-3 w-3 text-[var(--trade-neutral)]" />
                        <span className="text-muted-foreground">
                          {ENGINE_LABELS[report.bestPerformingEngine || ""] || "—"}
                        </span>
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm">
                    Report generation pending
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Tabs for different sections */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="engines" data-testid="tab-engines">Engine Performance</TabsTrigger>
          <TabsTrigger value="bots" data-testid="tab-bots">Bot Activity</TabsTrigger>
          <TabsTrigger value="symbols" data-testid="tab-symbols">Top Performers</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">Report History</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="stat-glass">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Total Ideas
                  </p>
                  <BarChart3 className="h-4 w-4 text-sky-400" />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-8 w-20 mt-2" />
                ) : (
                  <p className="text-2xl font-bold font-mono tabular-nums mt-2" data-testid="text-total-ideas">
                    {stats?.summary.totalIdeas || 0}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="stat-glass">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Open Ideas
                  </p>
                  <Activity className="h-4 w-4 text-[var(--trade-neutral)]" />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-8 w-20 mt-2" />
                ) : (
                  <p className="text-2xl font-bold font-mono tabular-nums mt-2" data-testid="text-open-ideas">
                    {stats?.summary.openIdeas || 0}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="stat-glass">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Overall Win Rate
                  </p>
                  <TrendingUp className="h-4 w-4 text-[var(--trade-bullish)]" />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-8 w-20 mt-2" />
                ) : (
                  <p className={cn(
                    "text-2xl font-bold font-mono tabular-nums mt-2",
                    (stats?.summary.overallWinRate || 0) >= 50 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                  )} data-testid="text-win-rate">
                    {stats?.summary.overallWinRate != null ? safeToFixed(stats.summary.overallWinRate, 1) : "—"}%
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="stat-glass">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Best Engine
                  </p>
                  <Trophy className="h-4 w-4 text-[var(--trade-neutral)]" />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-8 w-20 mt-2" />
                ) : (
                  <p className="text-lg font-semibold mt-2" data-testid="text-best-engine">
                    {ENGINE_LABELS[stats?.bestEngine || ""] || "—"}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Download PDF Button */}
          {latestReports?.[selectedPeriod] && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  const report = latestReports[selectedPeriod];
                  if (report) {
                    generatePlatformReportPDF(report as any);
                    toast({ title: "PDF Downloaded", description: `${selectedPeriod} report PDF generated successfully` });
                  }
                }}
                className="border-sky-500/30 hover:border-sky-500"
                data-testid="button-download-pdf"
              >
                <Download className="h-4 w-4 mr-2" />
                Download {selectedPeriod.charAt(0).toUpperCase() + selectedPeriod.slice(1)} Report PDF
              </Button>
            </div>
          )}

          {/* Asset Distribution Pie Chart */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <PieChart className="h-5 w-5 text-sky-400" />
                  Asset Type Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : assetChartData.length > 0 ? (
                  <AnalyticsChart config={{}} className="h-[280px]">
                    <RechartsPieChart>
                      <Pie
                        data={assetChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${safeToFixed(percent * 100, 0)}%`}
                        labelLine={{ stroke: CHART_COLORS.slate }}
                      >
                        {assetChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <AnalyticsTooltip />
                    </RechartsPieChart>
                  </AnalyticsChart>
                ) : (
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    Asset data loading...
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Scanner Activity */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5 text-purple-400" />
                  Scanner Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="stat-glass rounded-lg p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                    Options Flow Alerts
                  </p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-sky-400" data-testid="text-flow-alerts">
                    {stats?.scannerActivity.optionsFlowAlerts || 0}
                  </p>
                </div>
                <div className="stat-glass rounded-lg p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                    Symbols Tracked
                  </p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-purple-400" data-testid="text-symbols-tracked">
                    {stats?.scannerActivity.marketScannerSymbols || 0}
                  </p>
                </div>
                <div className="stat-glass rounded-lg p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                    CT Tracker Mentions
                  </p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-[var(--trade-bullish)]" data-testid="text-ct-mentions">
                    {stats?.scannerActivity.ctTrackerMentions || 0}
                  </p>
                </div>
                <div className="stat-glass rounded-lg p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                    CT Auto-Trades
                  </p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-[var(--trade-neutral)]" data-testid="text-ct-trades">
                    {stats?.scannerActivity.ctTrackerAutoTrades || 0}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Engine Performance Tab */}
        <TabsContent value="engines" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-400" />
                Engine Performance Comparison
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : engineChartData.length > 0 ? (
                <AnalyticsChart config={{}} className="h-[300px]">
                  <BarChart data={engineChartData} layout="vertical">
                    <AnalyticsGrid />
                    <AnalyticsXAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <AnalyticsYAxis type="category" dataKey="engine" width={120} />
                    <AnalyticsTooltip formatter={(value: ChartValue) => [`${safeToFixed(value, 1)}%`, "Win Rate"]} />
                    <Bar dataKey="winRate" radius={[0, 4, 4, 0]}>
                      {engineChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </AnalyticsChart>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  Engine data loading...
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {stats?.engines.map((engine) => (
              <Card key={engine.engine} className="stat-glass" data-testid={`card-engine-${engine.engine}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    {engine.engine === "ai" && <Brain className="h-4 w-4" style={{ color: ENGINE_COLORS.ai }} />}
                    {engine.engine === "quant" && <Cpu className="h-4 w-4" style={{ color: ENGINE_COLORS.quant }} />}
                    {engine.engine === "hybrid" && <Sparkles className="h-4 w-4" style={{ color: ENGINE_COLORS.hybrid }} />}
                    {engine.engine === "flow" && <Zap className="h-4 w-4" style={{ color: ENGINE_COLORS.flow }} />}
                    {engine.engine === "lotto" && <Target className="h-4 w-4" style={{ color: ENGINE_COLORS.lotto }} />}
                    <span className="font-medium text-sm">{ENGINE_LABELS[engine.engine] || engine.engine}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Win Rate</span>
                      <span className={cn(
                        "font-mono tabular-nums font-semibold",
                        (engine.winRate || 0) >= 50 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                      )}>
                        {engine.winRate != null ? safeToFixed(engine.winRate, 1) : "—"}%
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Trades</span>
                      <span className="font-mono tabular-nums">{engine.trades}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Wins</span>
                      <span className="font-mono tabular-nums text-[var(--trade-bullish)]">{engine.wins}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Losses</span>
                      <span className="font-mono tabular-nums text-[var(--trade-bearish)]">{engine.losses}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Avg Gain</span>
                      <span className="font-mono tabular-nums text-[var(--trade-bullish)]">+{safeToFixed(engine.avgGain, 1)}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Avg Loss</span>
                      <span className="font-mono tabular-nums text-[var(--trade-bearish)]">-{safeToFixed(engine.avgLoss, 1)}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Bot Activity Tab */}
        <TabsContent value="bots" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="glass-card border-l-2 border-l-cyan-500" data-testid="card-bot-autolotto">
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Bot className="h-4 w-4 text-sky-400" />
                  Auto-Lotto Bot
                </CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-2xl font-bold font-mono tabular-nums">
                        {stats?.botActivity.autoLotto.trades || 0}
                      </p>
                      <p className="text-xs text-muted-foreground">Trades Executed</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className={cn(
                        "font-mono tabular-nums font-semibold",
                        (stats?.botActivity.autoLotto.pnl || 0) >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                      )}>
                        {(stats?.botActivity.autoLotto.pnl || 0) >= 0 ? "+" : ""}
                        ${safeToFixed(stats?.botActivity.autoLotto.pnl, 2, "0.00")}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card border-l-2 border-l-purple-500" data-testid="card-bot-futures">
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-purple-400" />
                  Futures Bot
                </CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-2xl font-bold font-mono tabular-nums">
                        {stats?.botActivity.futures.trades || 0}
                      </p>
                      <p className="text-xs text-muted-foreground">Trades Executed</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className={cn(
                        "font-mono tabular-nums font-semibold",
                        (stats?.botActivity.futures.pnl || 0) >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                      )}>
                        {(stats?.botActivity.futures.pnl || 0) >= 0 ? "+" : ""}
                        ${safeToFixed(stats?.botActivity.futures.pnl, 2, "0.00")}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card border-l-2 border-l-green-500" data-testid="card-bot-crypto">
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[var(--trade-bullish)]" />
                  Crypto Bot
                </CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-2xl font-bold font-mono tabular-nums">
                        {stats?.botActivity.crypto.trades || 0}
                      </p>
                      <p className="text-xs text-muted-foreground">Trades Executed</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className={cn(
                        "font-mono tabular-nums font-semibold",
                        (stats?.botActivity.crypto.pnl || 0) >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                      )}>
                        {(stats?.botActivity.crypto.pnl || 0) >= 0 ? "+" : ""}
                        ${safeToFixed(stats?.botActivity.crypto.pnl, 2, "0.00")}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card border-l-2 border-l-amber-500" data-testid="card-bot-propfirm">
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Target className="h-4 w-4 text-[var(--trade-neutral)]" />
                  Prop Firm Mode
                </CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-2xl font-bold font-mono tabular-nums">
                        {stats?.botActivity.propFirm.trades || 0}
                      </p>
                      <p className="text-xs text-muted-foreground">Trades Executed</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className={cn(
                        "font-mono tabular-nums font-semibold",
                        (stats?.botActivity.propFirm.pnl || 0) >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                      )}>
                        {(stats?.botActivity.propFirm.pnl || 0) >= 0 ? "+" : ""}
                        ${safeToFixed(stats?.botActivity.propFirm.pnl, 2, "0.00")}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Top Performers Tab */}
        <TabsContent value="symbols" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-[var(--trade-bullish)]" />
                  Top Winning Symbols
                </CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : stats?.topWinners.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead className="text-right">Wins</TableHead>
                        <TableHead className="text-right">Losses</TableHead>
                        <TableHead className="text-right">Win Rate</TableHead>
                        <TableHead className="text-right">Total P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.topWinners.map((symbol, i) => (
                        <TableRow key={symbol.symbol} data-testid={`row-winner-${i}`}>
                          <TableCell className="font-mono font-semibold">{symbol.symbol}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-[var(--trade-bullish)]">
                            {symbol.wins}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-[var(--trade-bearish)]">
                            {symbol.losses}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {safeToFixed(symbol.winRate, 1)}%
                          </TableCell>
                          <TableCell className={cn(
                            "text-right font-mono tabular-nums",
                            symbol.totalPnl >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                          )}>
                            {symbol.totalPnl >= 0 ? "+" : ""}{safeToFixed(symbol.totalPnl, 1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    No winning trades recorded yet
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-[var(--trade-bearish)]" />
                  Top Losing Symbols
                </CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : stats?.topLosers.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol</TableHead>
                        <TableHead className="text-right">Wins</TableHead>
                        <TableHead className="text-right">Losses</TableHead>
                        <TableHead className="text-right">Win Rate</TableHead>
                        <TableHead className="text-right">Total P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.topLosers.map((symbol, i) => (
                        <TableRow key={symbol.symbol} data-testid={`row-loser-${i}`}>
                          <TableCell className="font-mono font-semibold">{symbol.symbol}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-[var(--trade-bullish)]">
                            {symbol.wins}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-[var(--trade-bearish)]">
                            {symbol.losses}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {safeToFixed(symbol.winRate, 1)}%
                          </TableCell>
                          <TableCell className={cn(
                            "text-right font-mono tabular-nums",
                            symbol.totalPnl >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                          )}>
                            {symbol.totalPnl >= 0 ? "+" : ""}{safeToFixed(symbol.totalPnl, 1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    No losing trades recorded yet
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Report History Tab */}
        <TabsContent value="history" className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5 text-sky-400" />
                {selectedPeriod.charAt(0).toUpperCase() + selectedPeriod.slice(1)} Report History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {allReportsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : allReports?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Generated</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Ideas</TableHead>
                      <TableHead className="text-right">Trades</TableHead>
                      <TableHead className="text-right">Win Rate</TableHead>
                      <TableHead className="text-right">Best Engine</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allReports.map((report, i) => (
                      <TableRow key={report.id} data-testid={`row-report-${i}`}>
                        <TableCell className="font-mono text-sm">
                          {report.generatedAt ? format(new Date(report.generatedAt), "MMM dd, yyyy HH:mm") : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(report.startDate), "MMM dd")} - {format(new Date(report.endDate), "MMM dd")}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {report.totalIdeasGenerated || 0}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {report.totalTradesResolved || 0}
                        </TableCell>
                        <TableCell className={cn(
                          "text-right font-mono tabular-nums",
                          (report.overallWinRate || 0) >= 50 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                        )}>
                          {report.overallWinRate != null ? safeToFixed(report.overallWinRate, 1) : "—"}%
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {ENGINE_LABELS[report.bestPerformingEngine || ""] || "—"}
                        </TableCell>
                        <TableCell>
                          {report.status === "completed" ? (
                            <Badge className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/30">
                              Completed
                            </Badge>
                          ) : report.status === "generating" ? (
                            <Badge className="bg-amber-500/10 text-[var(--trade-neutral)] border-amber-500/30">
                              Generating
                            </Badge>
                          ) : (
                            <Badge variant="destructive">Failed</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  No {selectedPeriod} reports generated yet
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
