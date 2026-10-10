import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
  UserPlus,
  Search,
  Mail,
  CheckCircle2,
  Clock,
  XCircle,
  Send,
  RefreshCw,
  Calendar,
  Users,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

function getCSRFToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

interface WaitlistEntry {
  id: string;
  email: string;
  source: string;
  referralCode?: string;
  status: 'pending' | 'approved' | 'invited' | 'joined' | 'rejected';
  inviteSent: boolean;
  convertedToUser: boolean;
  createdAt: string;
}

function AdminWaitlistContent() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  const { data: waitlistData, isLoading, refetch } = useQuery<{ entries: WaitlistEntry[], count: number }>({
    queryKey: ['/api/admin/waitlist'],
    queryFn: async () => {
      const res = await fetch('/api/admin/waitlist', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch waitlist');
      return res.json();
    }
  });

  const approveWaitlistMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const csrfToken = getCSRFToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
      const res = await fetch('/api/admin/waitlist/approve', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to approve');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/waitlist'] });
      toast({ title: "Waitlist entries approved" });
      setSelectedIds(new Set());
    },
    onError: () => {
      toast({ title: "Failed to approve entries", variant: "destructive" });
    }
  });

  const sendInvitesMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const csrfToken = getCSRFToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
      const res = await fetch('/api/admin/waitlist/send-invites', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to send invites');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/waitlist'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/invites'] });
      toast({ title: `Invites sent to ${data.sent || 0} users` });
      setSelectedIds(new Set());
      setShowInviteDialog(false);
    },
    onError: () => {
      toast({ title: "Failed to send invites", variant: "destructive" });
    }
  });

  const rejectWaitlistMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const csrfToken = getCSRFToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
      const res = await fetch('/api/admin/waitlist/reject', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to reject');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/waitlist'] });
      toast({ title: "Waitlist entries rejected" });
      setSelectedIds(new Set());
    },
    onError: () => {
      toast({ title: "Failed to reject entries", variant: "destructive" });
    }
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (waitlistId: string) => {
      const csrfToken = getCSRFToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
      const res = await fetch(`/api/admin/waitlist/${waitlistId}/resend-invite`, {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to resend invite');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/waitlist'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/invites'] });
      toast({ title: "Invite email resent successfully" });
    },
    onError: () => {
      toast({ title: "Failed to resend invite email", variant: "destructive" });
    }
  });

  const waitlist = waitlistData?.entries || [];

  const filteredWaitlist = waitlist.filter((entry: WaitlistEntry) => {
    const matchesSearch = entry.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || entry.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string, inviteSent: boolean, converted: boolean) => {
    if (converted) {
      return (
        <Badge variant="outline" className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Joined
        </Badge>
      );
    }
    if (inviteSent) {
      return (
        <Badge variant="outline" className="bg-sky-500/10 text-sky-400 border-sky-500/20">
          <Send className="h-3 w-3 mr-1" />
          Invited
        </Badge>
      );
    }
    const styles = {
      pending: "bg-amber-500/10 text-[var(--trade-neutral)] border-amber-500/20",
      approved: "bg-purple-500/10 text-purple-400 border-purple-500/20",
      invited: "bg-sky-500/10 text-sky-400 border-sky-500/20",
      joined: "bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/20",
      rejected: "bg-red-500/10 text-[var(--trade-bearish)] border-red-500/20",
    };
    const icons = {
      pending: <Clock className="h-3 w-3 mr-1" />,
      approved: <CheckCircle2 className="h-3 w-3 mr-1" />,
      invited: <Send className="h-3 w-3 mr-1" />,
      joined: <CheckCircle2 className="h-3 w-3 mr-1" />,
      rejected: <XCircle className="h-3 w-3 mr-1" />,
    };
    return (
      <Badge variant="outline" className={cn(styles[status as keyof typeof styles] || styles.pending)}>
        {icons[status as keyof typeof icons] || icons.pending}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredWaitlist.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredWaitlist.map(e => e.id)));
    }
  };

  const pendingCount = waitlist.filter(e => e.status === 'pending').length;
  const approvedCount = waitlist.filter(e => e.status === 'approved' && !e.inviteSent).length;
  const invitedCount = waitlist.filter(e => e.inviteSent && !e.convertedToUser).length;
  const joinedCount = waitlist.filter(e => e.convertedToUser).length;

  const selectedEntries = waitlist.filter(e => selectedIds.has(e.id));
  const canApprove = selectedEntries.some(e => e.status === 'pending');
  const canInvite = selectedEntries.some(e => (e.status === 'approved' || e.status === 'pending') && !e.inviteSent);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-[var(--trade-neutral)]">{pendingCount}</p>
              <p className="text-sm text-muted-foreground">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-400">{approvedCount}</p>
              <p className="text-sm text-muted-foreground">Approved</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-sky-400">{invitedCount}</p>
              <p className="text-sm text-muted-foreground">Invited</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-[var(--trade-bullish)]">{joinedCount}</p>
              <p className="text-sm text-muted-foreground">Joined</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-foreground flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-sky-400" />
                Waitlist Management
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {filteredWaitlist.length} entries {statusFilter !== 'all' && `(${statusFilter})`}
              </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search emails..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-muted border-border text-foreground w-full sm:w-64"
                  data-testid="input-search-waitlist"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-36 bg-muted border-border text-foreground" data-testid="select-status-filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-muted border-border">
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="invited">Invited</SelectItem>
                  <SelectItem value="joined">Joined</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                className="border-border text-foreground/80"
                data-testid="button-refresh-waitlist"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selectedIds.size > 0 && (
            <div className="mb-4 p-3 bg-muted rounded-lg flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} selected
              </span>
              {canApprove && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => approveWaitlistMutation.mutate(Array.from(selectedIds))}
                  disabled={approveWaitlistMutation.isPending}
                  className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                  data-testid="button-bulk-approve"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Approve
                </Button>
              )}
              {canInvite && (
                <Button
                  size="sm"
                  onClick={() => setShowInviteDialog(true)}
                  className="bg-sky-600 hover:bg-sky-700"
                  data-testid="button-bulk-invite"
                >
                  <Send className="h-4 w-4 mr-1" />
                  Send Invites
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => rejectWaitlistMutation.mutate(Array.from(selectedIds))}
                disabled={rejectWaitlistMutation.isPending}
                className="border-red-500/30 text-[var(--trade-bearish)] hover:bg-red-500/10"
                data-testid="button-bulk-reject"
              >
                <XCircle className="h-4 w-4 mr-1" />
                Reject
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} className="h-16 bg-muted" />
              ))}
            </div>
          ) : filteredWaitlist.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Waitlist is empty</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedIds.size === filteredWaitlist.length && filteredWaitlist.length > 0}
                        onCheckedChange={toggleSelectAll}
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <TableHead className="text-muted-foreground">Email</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-muted-foreground">Source</TableHead>
                    <TableHead className="text-muted-foreground">Joined</TableHead>
                    <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWaitlist.map((entry) => (
                    <TableRow 
                      key={entry.id} 
                      className={cn(
                        "border-border",
                        selectedIds.has(entry.id) && "bg-muted/50"
                      )}
                      data-testid={`row-waitlist-${entry.id}`}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(entry.id)}
                          onCheckedChange={() => toggleSelect(entry.id)}
                          data-testid={`checkbox-${entry.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <span className="text-foreground">{entry.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(entry.status, entry.inviteSent, entry.convertedToUser)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-muted-foreground border-border">
                          {entry.source}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(entry.createdAt), 'MMM d, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {entry.inviteSent && !entry.convertedToUser && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-[var(--trade-neutral)] hover:text-amber-300"
                              onClick={() => resendInviteMutation.mutate(entry.id)}
                              disabled={resendInviteMutation.isPending}
                              data-testid={`button-resend-${entry.id}`}
                              title="Resend invite email"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          {!entry.inviteSent && entry.status === 'pending' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-sky-400 hover:text-sky-300"
                              onClick={() => sendInvitesMutation.mutate([entry.id])}
                              disabled={sendInvitesMutation.isPending}
                              data-testid={`button-invite-${entry.id}`}
                              title="Send invite"
                            >
                              <Send className="h-4 w-4 mr-1" />
                              Invite
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">Send Beta Invites</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will create invite codes and send emails to the selected waitlist entries.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Users className="h-5 w-5 text-sky-400" />
              <span className="text-foreground">{selectedIds.size} users will receive invites</span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => setShowInviteDialog(false)}
              className="border-border text-foreground/80"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => sendInvitesMutation.mutate(Array.from(selectedIds))}
              disabled={sendInvitesMutation.isPending}
              className="bg-sky-600 hover:bg-sky-700"
              data-testid="button-confirm-send-invites"
            >
              {sendInvitesMutation.isPending ? "Sending..." : "Send Invites"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminWaitlist() {
  return (
    <AdminLayout>
      <AdminWaitlistContent />
    </AdminLayout>
  );
}
