import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Send, Mail, Users, Clock, CheckCircle, XCircle, RefreshCw, Copy, Plus } from "lucide-react";
import { Link } from "wouter";

interface WaitlistEntry {
  id: string;
  email: string;
  status: 'pending' | 'approved' | 'invited' | 'joined' | 'rejected';
  createdAt: string;
  inviteId?: string;
}

interface BetaInvite {
  id: string;
  email: string;
  token: string;
  status: 'pending' | 'sent' | 'redeemed' | 'expired' | 'revoked';
  createdAt: string;
  sentAt?: string;
  redeemedAt?: string;
  expiresAt: string;
}

export default function AdminBetaInvites() {
  const { toast } = useToast();
  const [newEmail, setNewEmail] = useState("");
  const [personalMessage, setPersonalMessage] = useState("");

  const { data: waitlist, isLoading: waitlistLoading, refetch: refetchWaitlist } = useQuery<WaitlistEntry[]>({
    queryKey: ['/api/admin/waitlist'],
  });

  const { data: invites, isLoading: invitesLoading, refetch: refetchInvites } = useQuery<BetaInvite[]>({
    queryKey: ['/api/admin/invites'],
  });

  const sendInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('POST', `/api/admin/waitlist/${id}/invite`, { personalMessage: personalMessage || undefined });
    },
    onSuccess: () => {
      toast({ title: "Invite Sent", description: "Beta invite email sent successfully" });
      refetchWaitlist();
      refetchInvites();
    },
    onError: (error: any) => {
      toast({ title: "Failed", description: error.message || "Could not send invite", variant: "destructive" });
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: async (email: string) => {
      return apiRequest('POST', '/api/admin/invites', { email, personalMessage: personalMessage || undefined, sendEmail: true });
    },
    onSuccess: () => {
      toast({ title: "Invite Created & Sent", description: `Beta invite sent to ${newEmail}` });
      setNewEmail("");
      setPersonalMessage("");
      refetchInvites();
      refetchWaitlist();
    },
    onError: (error: any) => {
      toast({ title: "Failed", description: error.message || "Could not create invite", variant: "destructive" });
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('POST', `/api/admin/invites/${id}/resend`);
    },
    onSuccess: () => {
      toast({ title: "Invite Resent", description: "Email sent again" });
      refetchInvites();
    },
    onError: (error: any) => {
      toast({ title: "Failed", description: error.message || "Could not resend", variant: "destructive" });
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('POST', `/api/admin/invites/${id}/revoke`);
    },
    onSuccess: () => {
      toast({ title: "Invite Revoked", description: "Access revoked" });
      refetchInvites();
    },
    onError: (error: any) => {
      toast({ title: "Failed", description: error.message || "Could not revoke", variant: "destructive" });
    },
  });

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}/join-beta?code=${token}`;
    navigator.clipboard.writeText(link);
    toast({ title: "Copied", description: "Invite link copied to clipboard" });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary" className="bg-amber-500/20 text-[var(--trade-neutral)]"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'approved':
        return <Badge variant="secondary" className="bg-blue-500/20 text-blue-400">Approved</Badge>;
      case 'invited':
      case 'sent':
        return <Badge variant="secondary" className="bg-sky-500/20 text-sky-400"><Mail className="w-3 h-3 mr-1" />Invited</Badge>;
      case 'joined':
      case 'redeemed':
        return <Badge variant="secondary" className="bg-[var(--trade-bullish)]/20 text-[var(--trade-bullish)]"><CheckCircle className="w-3 h-3 mr-1" />Joined</Badge>;
      case 'rejected':
      case 'revoked':
        return <Badge variant="secondary" className="bg-red-500/20 text-[var(--trade-bearish)]"><XCircle className="w-3 h-3 mr-1" />Revoked</Badge>;
      case 'expired':
        return <Badge variant="secondary" className="bg-gray-500/20 text-muted-foreground">Expired</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const pendingWaitlist = waitlist?.filter(e => e.status === 'pending') || [];
  const invitedWaitlist = waitlist?.filter(e => e.status === 'invited' || e.status === 'joined') || [];

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/admin">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Beta Invite Management</h1>
            <p className="text-muted-foreground">Send invites and manage beta access</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-sky-400" />
              Send New Invite
            </CardTitle>
            <CardDescription>Create and send a beta invite to any email address</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  data-testid="input-new-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Personal Message (Optional)</Label>
                <Input
                  id="message"
                  placeholder="Welcome to the beta..."
                  value={personalMessage}
                  onChange={(e) => setPersonalMessage(e.target.value)}
                  data-testid="input-personal-message"
                />
              </div>
            </div>
            <Button
              onClick={() => createInviteMutation.mutate(newEmail)}
              disabled={!newEmail || createInviteMutation.isPending}
              className="bg-sky-600 hover:bg-sky-700"
              data-testid="button-send-new-invite"
            >
              <Send className="w-4 h-4 mr-2" />
              {createInviteMutation.isPending ? "Sending..." : "Send Invite"}
            </Button>
          </CardContent>
        </Card>

        <Tabs defaultValue="waitlist" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="waitlist" className="flex items-center gap-2" data-testid="tab-waitlist">
              <Users className="w-4 h-4" />
              Waitlist ({pendingWaitlist.length})
            </TabsTrigger>
            <TabsTrigger value="invites" className="flex items-center gap-2" data-testid="tab-invites">
              <Mail className="w-4 h-4" />
              All Invites ({invites?.length || 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="waitlist" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Pending Waitlist</CardTitle>
                  <CardDescription>People waiting for beta access</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchWaitlist()} data-testid="button-refresh-waitlist">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardContent>
                {waitlistLoading ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : pendingWaitlist.length === 0 ? (
                  <p className="text-muted-foreground">No pending waitlist entries</p>
                ) : (
                  <div className="space-y-3">
                    {pendingWaitlist.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50" data-testid={`waitlist-entry-${entry.id}`}>
                        <div>
                          <p className="font-medium" data-testid={`text-email-${entry.id}`}>{entry.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Joined {new Date(entry.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(entry.status)}
                          <Button
                            size="sm"
                            onClick={() => sendInviteMutation.mutate(entry.id)}
                            disabled={sendInviteMutation.isPending}
                            className="bg-sky-600 hover:bg-sky-700"
                            data-testid={`button-invite-${entry.id}`}
                          >
                            <Send className="w-3 h-3 mr-1" />
                            Invite
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invites" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>All Invites</CardTitle>
                  <CardDescription>Track invite status and actions</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchInvites()} data-testid="button-refresh-invites">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardContent>
                {invitesLoading ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : !invites || invites.length === 0 ? (
                  <p className="text-muted-foreground">No invites sent yet</p>
                ) : (
                  <div className="space-y-3">
                    {invites.map((invite) => (
                      <div key={invite.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50" data-testid={`invite-entry-${invite.id}`}>
                        <div className="flex-1">
                          <p className="font-medium" data-testid={`text-invite-email-${invite.id}`}>{invite.email}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>Expires {new Date(invite.expiresAt).toLocaleDateString()}</span>
                            {invite.redeemedAt && (
                              <span className="text-[var(--trade-bullish)]">• Redeemed {new Date(invite.redeemedAt).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(invite.status)}
                          {invite.status !== 'redeemed' && invite.status !== 'revoked' && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => copyInviteLink(invite.token)}
                                title="Copy invite link"
                                data-testid={`button-copy-${invite.id}`}
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => resendInviteMutation.mutate(invite.id)}
                                disabled={resendInviteMutation.isPending}
                                title="Resend email"
                                data-testid={`button-resend-${invite.id}`}
                              >
                                <RefreshCw className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => revokeInviteMutation.mutate(invite.id)}
                                disabled={revokeInviteMutation.isPending}
                                title="Revoke invite"
                                className="text-[var(--trade-bearish)] hover:text-[var(--trade-bearish)]"
                                data-testid={`button-revoke-${invite.id}`}
                              >
                                <XCircle className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
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
