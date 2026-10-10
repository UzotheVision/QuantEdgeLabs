import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, Mail, Sparkles } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import quantEdgeLabsLogoUrl from "@assets/qe-mark.svg";
import { WaitlistPopup } from "@/components/waitlist-popup";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  // Handle URL error parameters from OAuth callbacks
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');

    if (error) {
      const errorMessages: Record<string, string> = {
        'invite_required': 'This is an invite-only beta. Join the waitlist to request access.',
        'google_auth_failed': 'Google sign-in failed. Please try again.',
        'no_user': 'Could not retrieve your account. Please try again.',
        'login_failed': 'Login failed. Please try again.',
        'not_on_waitlist': 'You must be on the waitlist to sign in. Join below.',
      };

      setAuthError(errorMessages[error] || 'An error occurred during sign-in.');
      window.history.replaceState({}, '', '/login');
    }
  }, []);

  // Admin login mutation
  const adminLoginMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest("POST", "/api/auth/dev-login", { accessCode: code });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Welcome!", description: "Admin login successful." });
      setLocation("/t");
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message || "Invalid access code",
        variant: "destructive",
      });
    },
  });

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginFormData) => {
      const response = await apiRequest("POST", "/api/auth/login", data);
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Welcome back!", description: "You have been logged in successfully." });
      setTimeout(() => setLocation("/t"), 100);
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message || "Invalid email or password",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: LoginFormData) => {
    loginMutation.mutate(data);
  };

  const handleAdminLogin = () => {
    if (accessCode.trim()) {
      adminLoginMutation.mutate(accessCode);
    }
  };

  return (
    <div className="min-h-screen bg-background flex transition-colors">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-100 dark:from-emerald-950/50 via-[#fafafa] dark:via-[#0a0a0a] to-[#fafafa] dark:to-[#0a0a0a]" />

        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: `linear-gradient(rgba(16, 185, 129, 0.1) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(16, 185, 129, 0.1) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }} />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div>
            <Link href="/">
              <div className="flex items-center gap-3 cursor-pointer">
                <img src={quantEdgeLabsLogoUrl} alt="QuantEdge" className="h-8 w-8" />
                <span className="text-foreground dark:text-foreground font-medium">QuantEdge</span>
              </div>
            </Link>
          </div>

          <div className="space-y-8">
            <div>
              <h1 className="text-4xl font-medium text-foreground dark:text-foreground mb-4 leading-tight">
                Multi-engine.<br />
                One edge.
              </h1>
              <p className="text-muted-foreground dark:text-muted-foreground text-lg max-w-md">
                Join thousands of traders using AI-powered analysis to find their next trade.
              </p>
            </div>

            {/* Stats */}
            <div className="flex gap-8">
              <div>
                <div className="text-2xl font-mono text-foreground dark:text-foreground">2,500+</div>
                <div className="text-sm text-muted-foreground dark:text-muted-foreground">Traders joined</div>
              </div>
              <div>
                <div className="text-2xl font-mono text-foreground dark:text-foreground">Multi</div>
                <div className="text-sm text-muted-foreground dark:text-muted-foreground">Engine convergence</div>
              </div>
              <div>
                <div className="text-2xl font-mono text-[var(--trade-bullish)] dark:text-[var(--trade-bullish)]">24/7</div>
                <div className="text-sm text-muted-foreground dark:text-muted-foreground">Market analysis</div>
              </div>
            </div>

            {/* Testimonial */}
            <div className="bg-white dark:bg-card border border-gray-200 dark:border-border rounded-lg p-5 max-w-md">
              <p className="text-muted-foreground dark:text-foreground/80 text-sm mb-3">
                "Finally, a platform that gives retail traders the same analysis tools institutions have been using for years."
              </p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <span className="text-[var(--trade-bullish)] dark:text-[var(--trade-bullish)] text-xs font-medium">JM</span>
                </div>
                <div>
                  <div className="text-sm text-foreground dark:text-foreground">James M.</div>
                  <div className="text-xs text-muted-foreground dark:text-muted-foreground">Beta tester</div>
                </div>
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground dark:text-muted-foreground">
            © {new Date().getFullYear()} Quant Edge Labs
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center mb-8">
            <Link href="/">
              <div className="flex items-center gap-2">
                <img src={quantEdgeLabsLogoUrl} alt="QuantEdge" className="h-8 w-8" />
                <span className="text-foreground dark:text-foreground font-medium">QuantEdge</span>
              </div>
            </Link>
          </div>

          {/* Back button */}
          <Link href="/">
            <button className="flex items-center gap-2 text-sm text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground transition-colors mb-8">
              <ArrowLeft className="w-4 h-4" />
              Back to home
            </button>
          </Link>

          {/* Header */}
          <div className="mb-8">
            <h2 className="text-2xl font-medium text-foreground dark:text-foreground mb-2">Welcome back</h2>
            <p className="text-muted-foreground dark:text-muted-foreground">
              Sign in to access your dashboard
            </p>
          </div>

          {/* Error Alert */}
          {authError && (
            <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-[var(--trade-bearish)]">{authError}</p>
              {authError.includes('waitlist') && (
                <button
                  onClick={() => setWaitlistOpen(true)}
                  className="mt-2 text-sm text-foreground underline"
                >
                  Join the waitlist
                </button>
              )}
            </div>
          )}

          {/* Waitlist Notice */}
          <div className="mb-6 p-4 rounded-lg bg-white dark:bg-card border border-gray-200 dark:border-border">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Sparkles className="w-4 h-4 text-[var(--trade-bullish)] dark:text-[var(--trade-bullish)]" />
              </div>
              <div>
                <p className="text-sm text-foreground dark:text-foreground font-medium">Invite-only beta</p>
                <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                  Sign in is only available for approved waitlist members.
                </p>
              </div>
            </div>
          </div>

          {/* Google Sign In */}
          <a href="/api/auth/google" className="block mb-4">
            <Button
              type="button"
              className="w-full h-11 bg-white dark:bg-card border border-gray-200 dark:border-border text-foreground dark:text-foreground hover:bg-gray-50 dark:hover:bg-muted hover:border-gray-300 dark:hover:border-border"
            >
              <SiGoogle className="mr-2 h-4 w-4" />
              Continue with Google
            </Button>
          </a>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200 dark:border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#fafafa] dark:bg-[var(--surface-base)] px-3 text-muted-foreground dark:text-muted-foreground">or continue with email</span>
            </div>
          </div>

          {/* Email/Password Form */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
                        <Input
                          type="email"
                          placeholder="Email address"
                          aria-label="Email address"
                          autoComplete="email"
                          className="h-11 pl-10 bg-white dark:bg-card border-gray-200 dark:border-border text-foreground dark:text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus:border-gray-300 dark:focus:border-border focus:ring-0"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="text-[var(--trade-bearish)] dark:text-[var(--trade-bearish)] text-xs" />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
                        <Input
                          type={showPassword ? "text" : "password"}
                          placeholder="Password"
                          aria-label="Password"
                          autoComplete="current-password"
                          className="h-11 pl-10 pr-10 bg-white dark:bg-card border-gray-200 dark:border-border text-foreground dark:text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus:border-gray-300 dark:focus:border-border focus:ring-0"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          className="absolute right-0 top-1/2 -translate-y-1/2 h-11 w-11 flex items-center justify-center text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage className="text-[var(--trade-bearish)] dark:text-[var(--trade-bearish)] text-xs" />
                  </FormItem>
                )}
              />

              <div className="flex items-center justify-between">
                <Link href="/forgot-password">
                  <span className="text-xs text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground transition-colors">
                    Forgot password?
                  </span>
                </Link>
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-gray-900 dark:bg-white text-foreground dark:text-black hover:bg-gray-800 dark:hover:bg-muted font-medium"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? "Signing in..." : "Sign in"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </form>
          </Form>

          {/* Waitlist CTA */}
          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground dark:text-muted-foreground mb-3">Don't have access yet?</p>
            <Button
              variant="outline"
              className="w-full h-11 border-gray-200 dark:border-border text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground hover:bg-gray-50 dark:hover:bg-card"
              onClick={() => setWaitlistOpen(true)}
            >
              Join the waitlist
            </Button>
          </div>

          {/* Admin Access - Hidden by default */}
          <div className="mt-8 pt-6 border-t border-border/50">
            <button
              type="button"
              onClick={() => setShowAdminLogin(!showAdminLogin)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center min-h-11"
            >
              Admin access
            </button>

            {showAdminLogin && (
              <div className="mt-4 space-y-3">
                <Input
                  type="password"
                  placeholder="Admin access code"
                  aria-label="Admin access code"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                  className="h-10 bg-card border-border text-foreground placeholder:text-muted-foreground focus:border-border focus:ring-0"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-9 border-border text-muted-foreground hover:text-foreground hover:bg-card text-xs"
                  onClick={handleAdminLogin}
                  disabled={adminLoginMutation.isPending || !accessCode.trim()}
                >
                  {adminLoginMutation.isPending ? "Logging in..." : "Admin Login"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Waitlist Popup */}
      <WaitlistPopup open={waitlistOpen} onOpenChange={setWaitlistOpen} />
    </div>
  );
}
