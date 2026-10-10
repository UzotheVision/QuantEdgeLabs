import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sparkles,
  CreditCard,
  Users,
  DollarSign,
  RefreshCw,
  Activity,
  Bot,
  TrendingUp,
  Clock,
  AlertTriangle,
  Zap,
  Crown,
  Shield,
  UserCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn, safeToFixed } from "@/lib/utils";
import { format } from "date-fns";

interface CreditStats {
  totalQueries: number;
  uniqueUsers: number;
  totalCostCents: number;
  avgLatencyMs: number;
  tierBreakdown: {
    free: number;
    advanced: number;
    pro: number;
    admin: number;
  };
  activeBalances: number;
  totalCreditsAllocated: number;
  totalCreditsUsed: number;
  utilizationRate: number;
  estimatedMonthlyCost: string;
}

interface CreditBalance {
  id: number;
  userId: string;
  userEmail: string;
  userName: string;
  tierSnapshot: string;
  creditsAllocated: number;
  creditsUsed: number;
  cycleStart: string;
  cycleEnd: string;
}

interface UsageRecord {
  id: number;
  userId: string;
  userEmail: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number | null;
  responseTimeMs: number | null;
  promptPreview: string | null;
  tierSnapshot: string;
  createdAt: string;
}

function getCSRFToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

function getTierColor(tier: string) {
  switch (tier) {
    case 'free': return 'bg-muted-foreground/20 text-muted-foreground';
    case 'advanced': return 'bg-purple-500/20 text-purple-400';
    case 'pro': return 'bg-amber-500/20 text-[var(--trade-neutral)]';
    case 'admin': return 'bg-red-500/20 text-[var(--trade-bearish)]';
    default: return 'bg-muted-foreground/20 text-muted-foreground';
  }
}

function getTierIcon(tier: string) {
  switch (tier) {
    case 'free': return <UserCheck className="w-3 h-3" />;
    case 'advanced': return <Zap className="w-3 h-3" />;
    case 'pro': return <Crown className="w-3 h-3" />;
    case 'admin': return <Shield className="w-3 h-3" />;
    default: return <UserCheck className="w-3 h-3" />;
  }
}

export default function AdminCredits() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");

  const { data: stats, isLoading: statsLoading } = useQuery<CreditStats>({
    queryKey: ['/api/admin/credits/stats'],
  });

  const { data: balances, isLoading: balancesLoading } = useQuery<CreditBalance[]>({
    queryKey: ['/api/admin/credits/balances'],
  });

  const { data: usage, isLoading: usageLoading } = useQuery<UsageRecord[]>({
    queryKey: ['/api/admin/credits/usage'],
  });

  const resetCreditsMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch(`/api/admin/credits/reset/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCSRFToken() || '',
        },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to reset credits');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/credits/balances'] });
      toast({
        title: "Credits Reset",
        description: "User credits have been reset successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to reset credits",
        variant: "destructive",
      });
    },
  });

  const refreshStats = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/admin/credits/stats'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/credits/balances'] });
    queryClient.invalidateQueries({ queryKey: ['/api/admin/credits/usage'] });
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Sparkles className="w-8 h-8 text-purple-400" />
              AI Credits Management
            </h1>
            <p className="text-muted-foreground mt-1">
              Monitor and manage AI credit usage across all users
            </p>
          </div>
          <Button
            variant="outline"
            onClick={refreshStats}
            className="gap-2"
            data-testid="button-refresh-credits"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="balances" data-testid="tab-balances">Balances</TabsTrigger>
            <TabsTrigger value="usage" data-testid="tab-usage">Usage Log</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {statsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[...Array(8)].map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="pb-2">
                      <Skeleton className="h-4 w-24" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-8 w-16" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : stats ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Total Queries</CardTitle>
                      <Activity className="w-4 h-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="stat-total-queries">
                        {stats.totalQueries.toLocaleString()}
                      </div>
                      <p className="text-xs text-muted-foreground">All-time AI requests</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Active Users</CardTitle>
                      <Users className="w-4 h-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="stat-active-users">
                        {stats.activeBalances}
                      </div>
                      <p className="text-xs text-muted-foreground">{stats.uniqueUsers} unique users</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Estimated Cost</CardTitle>
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="stat-monthly-cost">
                        ${stats.estimatedMonthlyCost}
                      </div>
                      <p className="text-xs text-muted-foreground">This billing cycle</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Utilization</CardTitle>
                      <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="stat-utilization">
                        {stats.utilizationRate}%
                      </div>
                      <Progress value={stats.utilizationRate} className="mt-2 h-2" />
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Credits Breakdown</CardTitle>
                      <CreditCard className="w-4 h-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Allocated</span>
                          <span className="font-mono">{stats.totalCreditsAllocated.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Used</span>
                          <span className="font-mono text-[var(--trade-neutral)]">{stats.totalCreditsUsed.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Remaining</span>
                          <span className="font-mono text-[var(--trade-bullish)]">
                            {(stats.totalCreditsAllocated - stats.totalCreditsUsed).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                      <CardTitle className="text-sm font-medium">Tier Distribution</CardTitle>
                      <Users className="w-4 h-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <Badge className={getTierColor('free')}>Free</Badge>
                          </div>
                          <span className="font-mono">{stats.tierBreakdown.free}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <Badge className={getTierColor('advanced')}>Advanced</Badge>
                          </div>
                          <span className="font-mono">{stats.tierBreakdown.advanced}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <Badge className={getTierColor('pro')}>Pro</Badge>
                          </div>
                          <span className="font-mono">{stats.tierBreakdown.pro}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <Badge className={getTierColor('admin')}>Admin</Badge>
                          </div>
                          <span className="font-mono">{stats.tierBreakdown.admin}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
                    <CardTitle className="text-sm font-medium">Performance Metrics</CardTitle>
                    <Clock className="w-4 h-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-8">
                      <div>
                        <div className="text-sm text-muted-foreground">Avg Response Time</div>
                        <div className="text-xl font-bold">
                          {stats.avgLatencyMs ? `${Math.round(stats.avgLatencyMs)}ms` : 'N/A'}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Total Cost</div>
                        <div className="text-xl font-bold">
                          ${safeToFixed(stats.totalCostCents / 100, 2)}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="flex items-center justify-center py-8">
                  <AlertTriangle className="w-5 h-5 text-[var(--trade-neutral)] mr-2" />
                  <span className="text-muted-foreground">No credit stats available</span>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="balances" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  User Credit Balances
                </CardTitle>
              </CardHeader>
              <CardContent>
                {balancesLoading ? (
                  <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : balances && balances.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Tier</TableHead>
                        <TableHead className="text-right">Used</TableHead>
                        <TableHead className="text-right">Allocated</TableHead>
                        <TableHead className="text-right">Remaining</TableHead>
                        <TableHead>Cycle End</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balances.map((balance) => {
                        const remaining = balance.creditsAllocated - balance.creditsUsed;
                        const usagePercent = balance.creditsAllocated > 0 
                          ? (balance.creditsUsed / balance.creditsAllocated) * 100 
                          : 0;
                        
                        return (
                          <TableRow key={balance.id} data-testid={`row-balance-${balance.id}`}>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium">{balance.userName}</span>
                                <span className="text-xs text-muted-foreground">{balance.userEmail}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge className={cn("gap-1", getTierColor(balance.tierSnapshot))}>
                                {getTierIcon(balance.tierSnapshot)}
                                {balance.tierSnapshot}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {balance.creditsUsed}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {balance.creditsAllocated}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={cn(
                                "font-mono",
                                remaining <= 5 ? "text-[var(--trade-bearish)]" :
                                remaining <= 20 ? "text-[var(--trade-neutral)]" : "text-[var(--trade-bullish)]"
                              )}>
                                {remaining}
                              </span>
                              <Progress 
                                value={usagePercent} 
                                className="mt-1 h-1 w-16"
                              />
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {format(new Date(balance.cycleEnd), 'MMM d, yyyy')}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => resetCreditsMutation.mutate(balance.userId)}
                                disabled={resetCreditsMutation.isPending}
                                data-testid={`button-reset-${balance.id}`}
                              >
                                <RefreshCw className="w-4 h-4 mr-1" />
                                Reset
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    No user balances found
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="usage" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  Recent AI Usage Log
                </CardTitle>
              </CardHeader>
              <CardContent>
                {usageLoading ? (
                  <div className="space-y-2">
                    {[...Array(5)].map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : usage && usage.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead className="text-right">Latency</TableHead>
                        <TableHead>Prompt Preview</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usage.map((record) => (
                        <TableRow key={record.id} data-testid={`row-usage-${record.id}`}>
                          <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                            {format(new Date(record.createdAt), 'MMM d, HH:mm')}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Badge className={cn("text-xs", getTierColor(record.tierSnapshot))}>
                                {record.tierSnapshot}
                              </Badge>
                              <span className="text-sm truncate max-w-[120px]">
                                {record.userEmail}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="gap-1">
                              <Bot className="w-3 h-3" />
                              {record.provider}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {record.model}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {record.responseTimeMs ? `${record.responseTimeMs}ms` : '-'}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-muted-foreground text-sm">
                            {record.promptPreview || '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    No usage records found
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
