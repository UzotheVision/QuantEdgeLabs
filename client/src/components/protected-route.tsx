/**
 * Protected Route Component
 *
 * For the new access model:
 * - Visitors CAN browse most pages (data is accessible)
 * - Only user-specific features (watchlist, settings) require login
 * - Beta features are handled by FeatureGate component
 *
 * Use this component only for pages that truly require authentication
 * (e.g., settings, watchlist management, paper trading)
 */

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Loader2, Lock, Mail } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { WaitlistPromptModal } from "@/components/waitlist-prompt-modal";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** If true, requires beta access (shows invite code UI) */
  requireBetaAccess?: boolean;
}

/**
 * ProtectedRoute - For pages that require authentication
 *
 * Most pages should NOT use this anymore since visitors can browse.
 * Only use for truly auth-required pages like:
 * - /settings
 * - /watchlist (management, not viewing)
 * - /paper-trading
 */
export function ProtectedRoute({
  children,
  requireBetaAccess = false,
}: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [inviteCode, setInviteCode] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [showWaitlistModal, setShowWaitlistModal] = useState(true);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2
          className="h-8 w-8 animate-spin text-sky-400"
          data-testid="loading-spinner"
        />
      </div>
    );
  }

  // Not logged in - show waitlist modal
  if (!user) {
    return (
      <>
        <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-slate-950 to-slate-900">
          <div className="text-center">
            <Lock className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Account Required
            </h2>
            <p className="text-muted-foreground mb-4">
              Create a free account to access this feature
            </p>
            <Button onClick={() => setShowWaitlistModal(true)}>
              Sign Up Free
            </Button>
          </div>
        </div>

        <WaitlistPromptModal
          open={showWaitlistModal}
          onClose={() => setLocation("/")}
          title="Create Your Account"
          description="Sign up to unlock market data, AI trials, and more"
        />
      </>
    );
  }

  // Check beta access if required
  const hasBetaAccess =
    user.hasBetaAccess ||
    user.isAdmin ||
    user.subscriptionTier === "admin" ||
    user.subscriptionTier === "pro";

  // If beta access required but user doesn't have it
  if (requireBetaAccess && !hasBetaAccess) {
    const handleRedeemInvite = async () => {
      if (!inviteCode.trim()) {
        toast({
          title: "Enter invite code",
          description: "Please enter your beta invite code",
          variant: "destructive",
        });
        return;
      }

      setIsRedeeming(true);
      try {
        const response = await apiRequest("POST", "/api/beta/redeem", {
          token: inviteCode.trim().toLowerCase(),
        });

        if (response.ok) {
          toast({
            title: "Welcome to the Beta!",
            description: "Your invite code has been redeemed. Enjoy the platform!",
          });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          window.location.reload();
        } else {
          const data = await response.json();
          toast({
            title: "Invalid Code",
            description: data.error || "This invite code is invalid or expired",
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Error",
          description: "Failed to redeem invite code. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsRedeeming(false);
      }
    };

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-slate-950 to-slate-900">
        <Card className="w-full max-w-md glass-card border-amber-500/20">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-2">
              <Lock className="h-8 w-8 text-[var(--trade-neutral)]" />
            </div>
            <CardTitle className="text-xl font-bold">Beta Access Required</CardTitle>
            <CardDescription>
              This feature is available to beta users. Enter your invite code or
              wait for your invitation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                placeholder="Enter invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="text-center font-mono text-lg tracking-wider"
              />
              <Button
                onClick={handleRedeemInvite}
                disabled={isRedeeming}
                className="w-full"
              >
                {isRedeeming ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Redeem Invite Code"
                )}
              </Button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Don't have an invite code?
              </p>
              <Button
                variant="outline"
                onClick={() => setLocation("/pricing")}
                className="w-full"
              >
                <Mail className="mr-2 h-4 w-4" />
                Apply for Beta Access
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground mt-4">
              Logged in as: {user.email}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User is authenticated (and has beta if required)
  return <>{children}</>;
}

/**
 * AuthProtectedRoute - Simple auth check without beta requirement
 */
export function AuthProtectedRoute({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute requireBetaAccess={false}>{children}</ProtectedRoute>;
}

/**
 * BetaProtectedRoute - Requires beta access
 */
export function BetaProtectedRoute({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute requireBetaAccess={true}>{children}</ProtectedRoute>;
}

/**
 * AdminProtectedRoute - Requires admin role
 * Shows 404-like page for non-admins (security through obscurity)
 */
export function AdminProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
      </div>
    );
  }

  // Not logged in or not admin - show generic "not found" (don't reveal admin exists)
  const isAdmin = user?.isAdmin || user?.subscriptionTier === "admin";

  if (!user || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-slate-950 to-slate-900">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-muted-foreground mb-4">404</h1>
          <h2 className="text-xl font-semibold text-foreground mb-2">Page Not Found</h2>
          <p className="text-muted-foreground mb-6">
            The page you're looking for doesn't exist.
          </p>
          <Button onClick={() => setLocation("/")}>
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
