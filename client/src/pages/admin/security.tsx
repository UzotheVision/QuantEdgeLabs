import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Shield,
  AlertTriangle,
  Users,
  Activity,
  Lock,
  Eye,
  Globe,
  Clock,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Ban,
  Server,
} from "lucide-react";
import { cn, safeToFixed } from "@/lib/utils";
import { format } from "date-fns";
import {
  PieChart,
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
} from "@/components/ui/analytics-chart";

interface SecurityStats {
  totalRequests: number;
  last24HoursRequests: number;
  failedAttempts: number;
  blockedIPs: number;
  uniqueIPs: number;
  requestsByEndpoint: Record<string, number>;
  requestsByMethod: Record<string, number>;
  statusCodeDistribution: Record<string, number>;
  topIPs: { ip: string; count: number }[];
  recentFailedLogins: { ip: string; count: number; blockedUntil: string | null }[];
}

interface AuditLog {
  id: string;
  timestamp: string;
  action: string;
  adminIp: string;
  userAgent: string;
  endpoint: string;
  method: string;
  requestBody: Record<string, unknown>;
  responseStatus: number;
  duration: number;
  metadata: Record<string, unknown>;
}

interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

const STATUS_COLORS: Record<string, string> = {
  "2xx": CHART_COLORS.bull,
  "3xx": CHART_COLORS.accent,
  "4xx": CHART_COLORS.gold,
  "5xx": CHART_COLORS.bear,
};

const METHOD_COLORS: Record<string, string> = {
  GET: CHART_COLORS.blue,
  POST: CHART_COLORS.bull,
  PUT: CHART_COLORS.gold,
  PATCH: CHART_COLORS.purple,
  DELETE: CHART_COLORS.bear,
};

export default function AdminSecurityPage() {
  const [, setLocation] = useLocation();
  const [logsPage, setLogsPage] = useState(0);
  const logsLimit = 15;

  const { data: authCheck, isLoading: authLoading } = useQuery({
    queryKey: ["/api/admin/check-auth"],
    queryFn: async () => {
      const res = await fetch("/api/admin/check-auth", {
        credentials: "include",
      });
      return res.ok;
    },
    retry: false,
  });

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<SecurityStats>({
    queryKey: ["/api/admin/security-stats"],
    enabled: !!authCheck,
    refetchInterval: 30000,
    queryFn: async () => {
      const res = await fetch("/api/admin/security-stats", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch security stats");
      return res.json();
    },
  });

  const { data: auditLogs, isLoading: logsLoading, refetch: refetchLogs } = useQuery<AuditLogsResponse>({
    queryKey: ["/api/admin/audit-logs", logsPage],
    enabled: !!authCheck,
    queryFn: async () => {
      const res = await fetch(`/api/admin/audit-logs?limit=${logsLimit}&offset=${logsPage * logsLimit}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch audit logs");
      return res.json();
    },
  });

  if (authLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-sky-400" />
      </div>
    );
  }

  if (!authCheck) {
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
              Please authenticate via the Admin Panel first to access security monitoring.
            </p>
            <Button 
              onClick={() => setLocation("/admin")} 
              data-testid="button-go-to-admin"
              className="bg-sky-500 hover:bg-sky-400 text-foreground"
            >
              Go to Admin Panel
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusChartData = stats ? Object.entries(stats.statusCodeDistribution).map(([status, count]) => ({
    name: status,
    value: count,
    fill: STATUS_COLORS[status] || CHART_COLORS.slate,
  })) : [];

  const methodChartData = stats ? Object.entries(stats.requestsByMethod).map(([method, count]) => ({
    method,
    count,
    fill: METHOD_COLORS[method] || CHART_COLORS.slate,
  })) : [];

  const endpointChartData = stats ? Object.entries(stats.requestsByEndpoint)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([endpoint, count]) => ({
      endpoint: endpoint.length > 30 ? endpoint.slice(0, 27) + "..." : endpoint,
      count,
    })) : [];

  const totalPages = auditLogs ? Math.ceil(auditLogs.total / logsLimit) : 0;

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return "text-[var(--trade-bullish)]";
    if (status >= 300 && status < 400) return "text-sky-400";
    if (status >= 400 && status < 500) return "text-[var(--trade-neutral)]";
    return "text-[var(--trade-bearish)]";
  };

  const getStatusBadgeVariant = (status: number) => {
    if (status >= 200 && status < 300) return "bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/30";
    if (status >= 300 && status < 400) return "bg-sky-500/10 text-sky-400 border-sky-500/30";
    if (status >= 400 && status < 500) return "bg-amber-500/10 text-[var(--trade-neutral)] border-amber-500/30";
    return "bg-red-500/10 text-[var(--trade-bearish)] border-red-500/30";
  };

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold flex items-center gap-3" data-testid="text-page-title">
            <Shield className="h-7 w-7 text-sky-400" />
            Security Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time security monitoring and audit logs
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            refetchStats();
            refetchLogs();
          }}
          className="border-border hover:border-sky-500"
          data-testid="button-refresh-security"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Security Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Total API Requests
              </span>
              <Activity className="h-4 w-4 text-sky-400" />
            </div>
            {statsLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-total-requests">
                {stats?.totalRequests.toLocaleString() || 0}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.last24HoursRequests || 0} in last 24h
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Failed Logins (24h)
              </span>
              <AlertTriangle className="h-4 w-4 text-[var(--trade-neutral)]" />
            </div>
            {statsLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className={cn(
                "text-2xl font-bold font-mono tabular-nums",
                (stats?.failedAttempts || 0) > 0 ? "text-[var(--trade-neutral)]" : ""
              )} data-testid="text-failed-logins">
                {stats?.failedAttempts || 0}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Authentication failures
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Blocked IPs
              </span>
              <Ban className="h-4 w-4 text-[var(--trade-bearish)]" />
            </div>
            {statsLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className={cn(
                "text-2xl font-bold font-mono tabular-nums",
                (stats?.blockedIPs || 0) > 0 ? "text-[var(--trade-bearish)]" : ""
              )} data-testid="text-blocked-ips">
                {stats?.blockedIPs || 0}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Currently blocked
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Unique Visitor IPs
              </span>
              <Users className="h-4 w-4 text-purple-400" />
            </div>
            {statsLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-bold font-mono tabular-nums" data-testid="text-unique-ips">
                {stats?.uniqueIPs || 0}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Distinct IP addresses
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Status Code Distribution */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-4 w-4 text-sky-400" />
              Status Code Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="h-[200px] flex items-center justify-center">
                <Skeleton className="h-[180px] w-[180px] rounded-full" />
              </div>
            ) : statusChartData.length > 0 ? (
              <AnalyticsChart config={{}} className="h-[200px]">
                <PieChart>
                  <Pie
                    data={statusChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${safeToFixed(percent * 100, 0)}%`}
                  >
                    {statusChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <AnalyticsTooltip />
                </PieChart>
              </AnalyticsChart>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                Data loading...
              </div>
            )}
          </CardContent>
        </Card>

        {/* Requests by Method */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-4 w-4 text-sky-400" />
              Requests by Method
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="h-[200px] flex items-center justify-center">
                <Skeleton className="h-full w-full" />
              </div>
            ) : methodChartData.length > 0 ? (
              <AnalyticsChart config={{}} className="h-[200px]">
                <BarChart data={methodChartData} layout="vertical">
                  <AnalyticsGrid />
                  <AnalyticsXAxis type="number" />
                  <AnalyticsYAxis type="category" dataKey="method" width={50} />
                  <AnalyticsTooltip />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {methodChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </AnalyticsChart>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                Data loading...
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Endpoints */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="h-4 w-4 text-sky-400" />
              Top Endpoints
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="h-[200px] flex items-center justify-center">
                <Skeleton className="h-full w-full" />
              </div>
            ) : endpointChartData.length > 0 ? (
              <AnalyticsChart config={{}} className="h-[200px]">
                <BarChart data={endpointChartData} layout="vertical">
                  <AnalyticsGrid />
                  <AnalyticsXAxis type="number" />
                  <AnalyticsYAxis type="category" dataKey="endpoint" width={100} />
                  <AnalyticsTooltip />
                  <Bar dataKey="count" fill={CHART_COLORS.accent} radius={[0, 4, 4, 0]} />
                </BarChart>
              </AnalyticsChart>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                Data loading...
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Threat Monitoring Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Blocked IPs & Failed Logins */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Lock className="h-4 w-4 text-[var(--trade-bearish)]" />
              Blocked IPs & Failed Logins
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (stats?.recentFailedLogins?.length || 0) > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {stats?.recentFailedLogins.map((item, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/40"
                    data-testid={`row-failed-login-${idx}`}
                  >
                    <div className="flex items-center gap-3">
                      {item.blockedUntil ? (
                        <Ban className="h-4 w-4 text-[var(--trade-bearish)]" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-[var(--trade-neutral)]" />
                      )}
                      <div>
                        <p className="font-mono text-sm">{item.ip}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.count} failed attempt{item.count > 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    {item.blockedUntil && (
                      <Badge className="bg-red-500/10 text-[var(--trade-bearish)] border-red-500/30">
                        <Clock className="h-3 w-3 mr-1" />
                        Blocked until {format(new Date(item.blockedUntil), "HH:mm:ss")}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No failed login attempts</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top IPs by Request Volume */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Eye className="h-4 w-4 text-purple-400" />
              Top IPs by Request Volume
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (stats?.topIPs?.length || 0) > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {stats?.topIPs.map((item, idx) => (
                  <div 
                    key={idx} 
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/40"
                    data-testid={`row-top-ip-${idx}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground w-6">#{idx + 1}</span>
                      <p className="font-mono text-sm">{item.ip}</p>
                    </div>
                    <Badge variant="outline" className="font-mono">
                      {item.count.toLocaleString()} requests
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No request data</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Audit Log Viewer */}
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-4 w-4 text-sky-400" />
            Audit Log
          </CardTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {auditLogs ? `${auditLogs.offset + 1}-${Math.min(auditLogs.offset + logsLimit, auditLogs.total)} of ${auditLogs.total}` : "Loading..."}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="w-[120px]">IP</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead className="w-[80px]">Method</TableHead>
                  <TableHead className="w-[80px]">Status</TableHead>
                  <TableHead className="w-[80px] text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsLoading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(7)].map((_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (auditLogs?.logs?.length || 0) > 0 ? (
                  auditLogs?.logs.map((log, idx) => (
                    <TableRow key={log.id} data-testid={`row-audit-log-${idx}`}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {format(new Date(log.timestamp), "MMM dd HH:mm:ss")}
                      </TableCell>
                      <TableCell className="font-medium text-sm max-w-[200px] truncate">
                        {log.action}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {log.adminIp}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[200px] truncate" title={log.endpoint}>
                        {log.endpoint}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-xs font-mono",
                            log.method === "GET" && "text-blue-400 border-blue-500/30",
                            log.method === "POST" && "text-[var(--trade-bullish)] border-green-500/30",
                            log.method === "PUT" && "text-[var(--trade-neutral)] border-amber-500/30",
                            log.method === "PATCH" && "text-purple-400 border-purple-500/30",
                            log.method === "DELETE" && "text-[var(--trade-bearish)] border-red-500/30"
                          )}
                        >
                          {log.method}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn("text-xs font-mono", getStatusBadgeVariant(log.responseStatus))}>
                          {log.responseStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {log.duration}ms
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No audit logs available
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLogsPage(p => Math.max(0, p - 1))}
                disabled={logsPage === 0}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground px-4">
                Page {logsPage + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLogsPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={logsPage >= totalPages - 1}
                data-testid="button-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
