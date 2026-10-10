import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminLayout } from "@/components/admin/admin-layout";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  TrendingUp,
  TrendingDown,
  Search,
  Trash2,
  Eye,
  Clock,
  Target,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Zap,
  Bot,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ideaSourceMeta, type IdeaSourceTone } from "@shared/idea-sources";
import { format } from "date-fns";

function getCSRFToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

interface TradeIdea {
  id: number;
  symbol: string;
  direction: "bullish" | "bearish";
  currentPrice?: number;
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  confidenceScore: number;
  status: string;
  source: string;
  holdingPeriod?: string;
  catalyst?: string;
  signals?: any[];
  createdAt: string;
  expiresAt?: string;
}

// Source styling keyed by the shared taxonomy's tone token. Labels themselves
// come from ideaSourceMeta() so they stay consistent with every other surface.
const ADMIN_TONE: Record<IdeaSourceTone, { color: string; icon: React.ReactNode }> = {
  quant: { color: "text-purple-400 border-purple-500/20 bg-purple-500/10", icon: <BarChart3 className="h-3 w-3" /> },
  ai: { color: "text-[var(--trade-neutral)] border-amber-500/20 bg-amber-500/10", icon: <Zap className="h-3 w-3" /> },
  hybrid: { color: "text-blue-400 border-blue-500/20 bg-blue-500/10", icon: <BarChart3 className="h-3 w-3" /> },
  flow: { color: "text-[var(--trade-bullish)] border-green-500/20 bg-[var(--trade-bullish)]/10", icon: <TrendingUp className="h-3 w-3" /> },
  news: { color: "text-amber-400 border-amber-500/20 bg-amber-500/10", icon: <Zap className="h-3 w-3" /> },
  scanner: { color: "text-blue-400 border-blue-500/20 bg-blue-500/10", icon: <Target className="h-3 w-3" /> },
  chart: { color: "text-purple-400 border-purple-500/20 bg-purple-500/10", icon: <BarChart3 className="h-3 w-3" /> },
  lotto: { color: "text-fuchsia-400 border-fuchsia-500/20 bg-fuchsia-500/10", icon: <Zap className="h-3 w-3" /> },
  social: { color: "text-pink-400 border-pink-500/20 bg-pink-500/10", icon: <Eye className="h-3 w-3" /> },
  bullish: { color: "text-[var(--trade-bullish)] border-green-500/20 bg-[var(--trade-bullish)]/10", icon: <TrendingUp className="h-3 w-3" /> },
  neutral: { color: "text-muted-foreground border-muted-foreground/20 bg-muted-foreground/10", icon: <Zap className="h-3 w-3" /> },
};

function AdminTradeIdeasContent() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [deleteIdeaId, setDeleteIdeaId] = useState<number | null>(null);

  const { data: ideasData, isLoading, refetch } = useQuery<{ ideas: TradeIdea[] }>({
    queryKey: ["/api/trade-ideas?limit=100"],
    queryFn: async () => {
      const res = await fetch("/api/trade-ideas?limit=100", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch ideas");
      return res.json();
    },
  });

  const { data: statsData } = useQuery<{
    total: number;
    active: number;
    expired: number;
    bySource: Record<string, number>;
  }>({
    queryKey: ["/api/admin/trade-ideas/stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/trade-ideas/stats", { credentials: "include" });
      if (!res.ok) {
        // Return calculated stats from ideas if endpoint doesn't exist
        return null;
      }
      return res.json();
    },
  });

  const deleteIdeaMutation = useMutation({
    mutationFn: async (ideaId: number) => {
      const csrfToken = getCSRFToken();
      const headers: Record<string, string> = {};
      if (csrfToken) headers["x-csrf-token"] = csrfToken;
      const res = await fetch(`/api/trade-ideas/${ideaId}`, {
        method: "DELETE",
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete idea");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trade-ideas"] });
      toast({ title: "Trade idea deleted" });
      setDeleteIdeaId(null);
    },
    onError: () => {
      toast({ title: "Failed to delete trade idea", variant: "destructive" });
    },
  });

  const ideas = ideasData?.ideas || [];

  // Calculate stats from ideas if stats endpoint not available
  const stats = statsData || {
    total: ideas.length,
    active: ideas.filter((i) => i.status === "active").length,
    expired: ideas.filter((i) => i.status === "expired").length,
    bySource: ideas.reduce((acc, idea) => {
      acc[idea.source] = (acc[idea.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };

  const filteredIdeas = ideas.filter((idea) => {
    const matchesSearch = idea.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      idea.catalyst?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || idea.status === statusFilter;
    const matchesSource = sourceFilter === "all" || idea.source === sourceFilter;
    return matchesSearch && matchesStatus && matchesSource;
  });

  const uniqueSources = Array.from(new Set(ideas.map((i) => i.source)));

  const ideaToDelete = ideas.find((i) => i.id === deleteIdeaId);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Ideas</p>
                <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              </div>
              <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20">
                <Zap className="h-5 w-5 text-sky-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-2xl font-bold text-[var(--trade-bullish)]">{stats.active}</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--trade-bullish)]/10 border border-green-500/20">
                <CheckCircle2 className="h-5 w-5 text-[var(--trade-bullish)]" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Expired</p>
                <p className="text-2xl font-bold text-muted-foreground">{stats.expired}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted-foreground/10 border border-muted-foreground/20">
                <Clock className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sources</p>
                <p className="text-2xl font-bold text-foreground">{uniqueSources.length}</p>
              </div>
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <Bot className="h-5 w-5 text-purple-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Zap className="h-5 w-5 text-sky-400" />
                Trade Ideas Management
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {filteredIdeas.length} ideas {statusFilter !== "all" && `(${statusFilter})`}
              </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search symbols..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-muted border-border text-foreground w-full sm:w-48"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-32 bg-muted border-border text-foreground">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-muted border-border">
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-full sm:w-40 bg-muted border-border text-foreground">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent className="bg-muted border-border">
                  <SelectItem value="all">All Sources</SelectItem>
                  {uniqueSources.map((source) => (
                    <SelectItem key={source} value={source}>
                      {ideaSourceMeta(source).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetch()}
                className="border-border text-foreground/80"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 bg-muted" />
              ))}
            </div>
          ) : filteredIdeas.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Zap className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Loading trade ideas...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Symbol</TableHead>
                    <TableHead className="text-muted-foreground">Direction</TableHead>
                    <TableHead className="text-muted-foreground">Signal Strength</TableHead>
                    <TableHead className="text-muted-foreground">Source</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-muted-foreground">Created</TableHead>
                    <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIdeas.slice(0, 50).map((idea) => {
                    const sourceMeta = ideaSourceMeta(idea.source);
                    const sourceConfig = { label: sourceMeta.label, ...ADMIN_TONE[sourceMeta.tone] };

                    return (
                      <TableRow key={idea.id} className="border-border">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sky-400">{idea.symbol}</span>
                            {idea.catalyst && (
                              <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                                {idea.catalyst}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              "flex items-center gap-1 w-fit",
                              idea.direction === "bullish"
                                ? "text-[var(--trade-bullish)] border-green-500/20 bg-[var(--trade-bullish)]/10"
                                : "text-[var(--trade-bearish)] border-red-500/20 bg-red-500/10"
                            )}
                          >
                            {idea.direction === "bullish" ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {idea.direction}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  idea.confidenceScore >= 80
                                    ? "bg-[var(--trade-bullish)]"
                                    : idea.confidenceScore >= 60
                                    ? "bg-amber-400"
                                    : "bg-red-400"
                                )}
                                style={{ width: `${idea.confidenceScore}%` }}
                              />
                            </div>
                            <span className="text-sm text-foreground font-mono">
                              {idea.confidenceScore}pts
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("flex items-center gap-1 w-fit", sourceConfig.color)}>
                            {sourceConfig.icon}
                            {sourceConfig.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              idea.status === "active"
                                ? "text-[var(--trade-bullish)] border-green-500/20"
                                : idea.status === "expired"
                                ? "text-muted-foreground border-muted-foreground/20"
                                : "text-[var(--trade-neutral)] border-amber-500/20"
                            )}
                          >
                            {idea.status === "active" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                            {idea.status === "expired" && <XCircle className="h-3 w-3 mr-1" />}
                            {idea.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-muted-foreground">
                            {format(new Date(idea.createdAt), "MMM d, HH:mm")}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-[var(--trade-bearish)] hover:text-[var(--trade-bearish)] hover:bg-red-500/10"
                            onClick={() => setDeleteIdeaId(idea.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteIdeaId} onOpenChange={() => setDeleteIdeaId(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete Trade Idea</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete this trade idea? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {ideaToDelete && (
            <div className="p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sky-400">{ideaToDelete.symbol}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    ideaToDelete.direction === "bullish"
                      ? "text-[var(--trade-bullish)] border-green-500/20"
                      : "text-[var(--trade-bearish)] border-red-500/20"
                  )}
                >
                  {ideaToDelete.direction}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {ideaToDelete.confidenceScore}pts signal strength • {ideaToDelete.source}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteIdeaId(null)}
              className="border-border text-foreground/80"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteIdeaId && deleteIdeaMutation.mutate(deleteIdeaId)}
              disabled={deleteIdeaMutation.isPending}
            >
              {deleteIdeaMutation.isPending ? "Deleting..." : "Delete Idea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminTradeIdeas() {
  return (
    <AdminLayout>
      <AdminTradeIdeasContent />
    </AdminLayout>
  );
}
