import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminLayout } from "@/components/admin/admin-layout";
import {
  Users,
  Mail,
  UserPlus,
  TrendingUp,
  Activity,
  DollarSign,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Database,
  Cpu,
  Zap,
  Eye,
  MousePointer,
  BarChart3,
  Bot,
  Brain,
  Target,
} from "lucide-react";
import { cn, safeToFixed } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  color?: 'cyan' | 'green' | 'amber' | 'purple' | 'red';
  isLoading?: boolean;
}

function MetricCard({ title, value, description, icon, trend, color = 'cyan', isLoading }: MetricCardProps) {
  const colorClasses = {
    cyan: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    green: "text-[var(--trade-bullish)] bg-[var(--trade-bullish)]/10 border-green-500/20",
    amber: "text-[var(--trade-neutral)] bg-amber-500/10 border-amber-500/20",
    purple: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    red: "text-[var(--trade-bearish)] bg-red-500/10 border-red-500/20",
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={cn("p-2 rounded-lg border", colorClasses[color])}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24 bg-muted" />
        ) : (
          <>
            <div className="text-2xl font-bold text-foreground" data-testid={`metric-${title.toLowerCase().replace(/\s+/g, '-')}`}>
              {value}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
            {trend && (
              <div className={cn(
                "flex items-center gap-1 text-xs mt-2",
                trend.value >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
              )}>
                <TrendingUp className={cn("h-3 w-3", trend.value < 0 && "rotate-180")} />
                <span>{trend.value >= 0 ? '+' : ''}{trend.value}%</span>
                <span className="text-muted-foreground">{trend.label}</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ActivityItem {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  user?: string;
}

function RecentActivity({ activities, isLoading }: { activities: ActivityItem[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-12 bg-muted" />
        ))}
      </div>
    );
  }

  if (!activities?.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.slice(0, 8).map((activity) => (
        <div 
          key={activity.id} 
          className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/50"
        >
          <div className="p-2 rounded-full bg-muted">
            {activity.type === 'user_signup' && <UserPlus className="h-3 w-3 text-[var(--trade-bullish)]" />}
            {activity.type === 'invite_sent' && <Mail className="h-3 w-3 text-sky-400" />}
            {activity.type === 'invite_redeemed' && <CheckCircle2 className="h-3 w-3 text-[var(--trade-bullish)]" />}
            {activity.type === 'waitlist_join' && <Clock className="h-3 w-3 text-[var(--trade-neutral)]" />}
            {!['user_signup', 'invite_sent', 'invite_redeemed', 'waitlist_join'].includes(activity.type) && 
              <Activity className="h-3 w-3 text-muted-foreground" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground truncate">{activity.description}</p>
            <p className="text-xs text-muted-foreground">{activity.timestamp}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

interface SystemStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  latency?: number;
}

function SystemHealth({ systems, isLoading }: { systems: SystemStatus[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-10 bg-muted" />
        ))}
      </div>
    );
  }

  const defaultSystems: SystemStatus[] = [
    { name: 'Database', status: 'healthy' },
    { name: 'API Server', status: 'healthy' },
    { name: 'AI Providers', status: 'healthy' },
    { name: 'Market Data', status: 'healthy' },
  ];

  const displaySystems = systems?.length ? systems : defaultSystems;

  return (
    <div className="space-y-2">
      {displaySystems.map((system) => (
        <div 
          key={system.name}
          className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/50"
        >
          <div className="flex items-center gap-3">
            <div className={cn(
              "h-2 w-2 rounded-full",
              system.status === 'healthy' && "bg-[var(--trade-bullish)]",
              system.status === 'degraded' && "bg-amber-400",
              system.status === 'down' && "bg-red-400"
            )} />
            <span className="text-sm text-foreground">{system.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {system.latency && (
              <span className="text-xs text-muted-foreground">{system.latency}ms</span>
            )}
            <Badge 
              variant="outline"
              className={cn(
                "text-xs",
                system.status === 'healthy' && "text-[var(--trade-bullish)] border-green-500/20",
                system.status === 'degraded' && "text-[var(--trade-neutral)] border-amber-500/20",
                system.status === 'down' && "text-[var(--trade-bearish)] border-red-500/20"
              )}
            >
              {system.status}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminOverviewContent() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/admin/stats'],
    queryFn: async () => {
      const res = await fetch('/api/admin/stats', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    }
  });

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['/api/admin/users'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch users');
      return res.json();
    }
  });

  const { data: waitlistData, isLoading: waitlistLoading } = useQuery({
    queryKey: ['/api/admin/waitlist'],
    queryFn: async () => {
      const res = await fetch('/api/admin/waitlist', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch waitlist');
      return res.json();
    }
  });

  const { data: invitesData, isLoading: invitesLoading } = useQuery({
    queryKey: ['/api/admin/invites'],
    queryFn: async () => {
      const res = await fetch('/api/admin/invites', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch invites');
      return res.json();
    }
  });

  const { data: activities, isLoading: activitiesLoading } = useQuery({
    queryKey: ['/api/admin/activity'],
    queryFn: async () => {
      const res = await fetch('/api/admin/activity', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch activity');
      return res.json();
    }
  });

  const { data: systemHealth, isLoading: healthLoading } = useQuery({
    queryKey: ['/api/admin/system-health'],
    refetchInterval: 30000,
    queryFn: async () => {
      const res = await fetch('/api/admin/system-health', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch health');
      return res.json();
    }
  });

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ['/api/admin/analytics'],
    refetchInterval: 60000,
    queryFn: async () => {
      const res = await fetch('/api/admin/analytics', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch analytics');
      return res.json();
    }
  });

  // Bot activity stats
  const { data: tradeIdeasData, isLoading: ideasLoading } = useQuery<{ ideas: any[] }>({
    queryKey: ['/api/trade-ideas?limit=100'],
    refetchInterval: 60000,
  });

  const totalUsers = users?.length || 0;
  const proUsers = users?.filter((u: any) => u.subscriptionTier === 'pro')?.length || 0;
  const waitlistCount = waitlistData?.waitlist?.length || waitlistData?.length || 0;
  const pendingWaitlist = waitlistData?.waitlist?.filter((w: any) => w.status === 'pending')?.length ||
    waitlistData?.filter?.((w: any) => w.status === 'pending')?.length || 0;
  const totalInvites = invitesData?.invites?.length || invitesData?.length || 0;
  const redeemedInvites = invitesData?.invites?.filter((i: any) => i.status === 'redeemed')?.length ||
    invitesData?.filter?.((i: any) => i.status === 'redeemed')?.length || 0;

  // Calculate bot activity stats
  const ideas = tradeIdeasData?.ideas || [];
  const botSourceMap: Record<string, { label: string; color: string; icon: any }> = {
    quant_signal: { label: "Quant Bot", color: "text-purple-400", icon: BarChart3 },
    bot_screener: { label: "Screener Bot", color: "text-sky-400", icon: Target },
    ai_analysis: { label: "AI Bot", color: "text-[var(--trade-neutral)]", icon: Brain },
    options_flow: { label: "Flow Bot", color: "text-[var(--trade-bullish)]", icon: TrendingUp },
    whale_flow: { label: "Whale Bot", color: "text-[var(--trade-bullish)]", icon: TrendingUp },
    market_scanner: { label: "Scanner Bot", color: "text-blue-400", icon: Target },
    sentiment: { label: "Sentiment Bot", color: "text-pink-400", icon: Eye },
    bullish_trend: { label: "Trend Bot", color: "text-[var(--trade-bullish)]", icon: TrendingUp },
  };

  const botStats = Object.entries(
    ideas.reduce((acc: Record<string, number>, idea: any) => {
      acc[idea.source] = (acc[idea.source] || 0) + 1;
      return acc;
    }, {})
  ).map(([source, count]) => ({
    source,
    count: count as number,
    ...botSourceMap[source] || { label: source, color: "text-muted-foreground", icon: Bot },
  })).sort((a, b) => b.count - a.count);

  const activeIdeas = ideas.filter((i: any) => i.status === 'active').length;
  const expiredIdeas = ideas.filter((i: any) => i.status === 'expired').length;
  const avgConfidence = ideas.length > 0
    ? Math.round(ideas.reduce((sum: number, i: any) => sum + (i.confidenceScore || 0), 0) / ideas.length)
    : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Users"
          value={totalUsers}
          description={`${proUsers} Pro subscribers`}
          icon={<Users className="h-4 w-4" />}
          color="cyan"
          isLoading={usersLoading}
        />
        <MetricCard
          title="Waitlist"
          value={waitlistCount}
          description={`${pendingWaitlist} pending review`}
          icon={<UserPlus className="h-4 w-4" />}
          color="amber"
          isLoading={waitlistLoading}
        />
        <MetricCard
          title="Invites Sent"
          value={totalInvites}
          description={`${redeemedInvites} redeemed`}
          icon={<Mail className="h-4 w-4" />}
          color="green"
          isLoading={invitesLoading}
        />
        <MetricCard
          title="Ideas Today"
          value={stats?.ideasToday || 0}
          description="Research briefs generated"
          icon={<Zap className="h-4 w-4" />}
          color="purple"
          isLoading={statsLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Activity className="h-5 w-5 text-sky-400" />
              Recent Activity
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Latest platform events
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecentActivity activities={activities || []} isLoading={activitiesLoading} />
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2">
              <Cpu className="h-5 w-5 text-[var(--trade-bullish)]" />
              System Status
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Service health overview
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SystemHealth 
              systems={systemHealth?.services || []} 
              isLoading={healthLoading} 
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Database</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Database className="h-8 w-8 text-sky-400" />
              <div>
                <p className="text-lg font-semibold text-foreground">
                  {stats?.dbStats?.tableCount || 0} tables
                </p>
                <p className="text-xs text-muted-foreground">PostgreSQL (Neon)</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-[var(--trade-bullish)]" />
              <div>
                <p className="text-lg font-semibold text-foreground">
                  ${safeToFixed(stats?.revenue, 2, '0.00')}
                </p>
                <p className="text-xs text-muted-foreground">This month</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Conversion Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <TrendingUp className="h-8 w-8 text-purple-400" />
              <div>
                <p className="text-lg font-semibold text-foreground">
                  {totalInvites > 0 ? safeToFixed((redeemedInvites / totalInvites) * 100, 1) : 0}%
                </p>
                <p className="text-xs text-muted-foreground">Invite → User</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-sky-400" />
            User Behavior Analytics (24h)
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Page views, activities, and engagement metrics
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analyticsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-20 bg-muted" />
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="h-4 w-4 text-sky-400" />
                    <span className="text-sm text-muted-foreground">Page Views</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground" data-testid="metric-page-views-24h">
                    {analyticsData?.totalPageViews24h || 0}
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="h-4 w-4 text-[var(--trade-bullish)]" />
                    <span className="text-sm text-muted-foreground">Active Users</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground" data-testid="metric-active-users-24h">
                    {analyticsData?.activeUsers24h || 0}
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <MousePointer className="h-4 w-4 text-[var(--trade-neutral)]" />
                    <span className="text-sm text-muted-foreground">Total Activities</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground" data-testid="metric-total-activities">
                    {analyticsData?.topActivities?.reduce((sum: number, a: any) => sum + (a.count || 0), 0) || 0}
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-4 w-4 text-purple-400" />
                    <span className="text-sm text-muted-foreground">Logins</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground" data-testid="metric-logins-24h">
                    {analyticsData?.recentLogins?.length || 0}
                  </p>
                </div>
              </div>

              {analyticsData?.topPages && analyticsData.topPages.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">Top Pages</h4>
                  <div className="space-y-2">
                    {analyticsData.topPages.slice(0, 5).map((page: { path: string; count: number }, idx: number) => (
                      <div 
                        key={page.path}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-5">{idx + 1}.</span>
                          <span className="text-sm text-foreground font-mono">{page.path}</span>
                        </div>
                        <Badge variant="outline" className="text-sky-400 border-sky-500/20">
                          {page.count} views
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analyticsData?.topActivities && analyticsData.topActivities.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">Activity Breakdown</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {analyticsData.topActivities.map((activity: { activityType: string; count: number }) => (
                      <div 
                        key={activity.activityType}
                        className="p-3 rounded-lg bg-muted/30 border border-border/30 text-center"
                      >
                        <p className="text-lg font-semibold text-foreground">{activity.count}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {activity.activityType.replace(/_/g, ' ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bot Activity Section */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Bot className="h-5 w-5 text-purple-400" />
            AI Bot Activity
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Trade idea generation by source
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ideasLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} className="h-20 bg-muted" />
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="h-4 w-4 text-sky-400" />
                    <span className="text-sm text-muted-foreground">Total Ideas</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{ideas.length}</p>
                </div>

                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="h-4 w-4 text-[var(--trade-bullish)]" />
                    <span className="text-sm text-muted-foreground">Active</span>
                  </div>
                  <p className="text-2xl font-bold text-[var(--trade-bullish)]">{activeIdeas}</p>
                </div>

                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Expired</span>
                  </div>
                  <p className="text-2xl font-bold text-muted-foreground">{expiredIdeas}</p>
                </div>

                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="h-4 w-4 text-[var(--trade-neutral)]" />
                    <span className="text-sm text-muted-foreground">Avg Confidence</span>
                  </div>
                  <p className="text-2xl font-bold text-[var(--trade-neutral)]">{avgConfidence}%</p>
                </div>
              </div>

              {/* Bot Breakdown */}
              {botStats.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground">Ideas by Bot</h4>
                  <div className="space-y-2">
                    {botStats.slice(0, 6).map((bot) => {
                      const BotIcon = bot.icon;
                      const percentage = ideas.length > 0 ? Math.round((bot.count / ideas.length) * 100) : 0;
                      return (
                        <div
                          key={bot.source}
                          className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30"
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn("p-1.5 rounded", "bg-muted/50")}>
                              <BotIcon className={cn("h-4 w-4", bot.color)} />
                            </div>
                            <span className="text-sm text-foreground">{bot.label}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full bg-gradient-to-r from-sky-500 to-sky-400")}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <Badge variant="outline" className="text-sky-400 border-sky-500/20 min-w-[50px] justify-center">
                              {bot.count}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {botStats.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Bot activity will appear when running</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminOverview() {
  return (
    <AdminLayout>
      <AdminOverviewContent />
    </AdminLayout>
  );
}
