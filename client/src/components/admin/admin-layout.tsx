import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Shield,
  LayoutDashboard,
  Users,
  Mail,
  UserPlus,
  Activity,
  Database,
  Lock,
  Eye,
  FileBarChart,
  CreditCard,
  ChevronLeft,
  Zap,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

type AuthStep = "pin" | "password" | "authenticated";

interface AdminLayoutProps {
  children: React.ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const [location] = useLocation();
  const [authStep, setAuthStep] = useState<AuthStep>("pin");
  const [pinCode, setPinCode] = useState("");
  const [password, setPassword] = useState("");
  const { toast } = useToast();

  // Check if already authenticated (has valid admin session)
  const { data: authCheck, isLoading: checkingAuth } = useQuery({
    queryKey: ['/api/admin/check-auth'],
    queryFn: async () => {
      const res = await fetch('/api/admin/check-auth', { credentials: 'include' });
      if (!res.ok) return { authenticated: false };
      return res.json();
    },
    retry: false,
  });

  useEffect(() => {
    if (authCheck?.authenticated) {
      setAuthStep('authenticated');
    }
  }, [authCheck]);

  const handlePinSubmit = async () => {
    if (pinCode.length !== 4) {
      toast({ title: "Please enter 4 digits", variant: "destructive" });
      return;
    }

    try {
      const res = await fetch('/api/admin/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pinCode }),
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error('Invalid access code');
      }

      setAuthStep('password');
      toast({ title: "Access code verified", description: "Enter admin password" });
    } catch (error) {
      toast({ title: "Invalid access code", variant: "destructive" });
      setPinCode("");
    }
  };

  const handlePasswordSubmit = async () => {
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'include',
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Login failed' }));
        throw new Error(error.error || 'Invalid password');
      }

      const response = await res.json();
      setAuthStep('authenticated');
      toast({
        title: "Admin access granted",
        description: `Session expires in ${response.expiresIn || '24h'}`
      });
    } catch (error: any) {
      toast({ title: error.message || "Invalid password", variant: "destructive" });
    }
  };

  // Loading state
  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <Shield className="h-12 w-12 text-sky-500" />
          <p className="text-muted-foreground">Verifying access...</p>
        </div>
      </div>
    );
  }

  // Authentication gate
  if (authStep !== 'authenticated') {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card border-border">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto p-3 bg-sky-500/10 rounded-full w-fit border border-sky-500/20">
              <Shield className="h-8 w-8 text-sky-500" />
            </div>
            <CardTitle className="text-2xl text-white">Admin Access</CardTitle>
            <CardDescription className="text-muted-foreground">
              {authStep === 'pin' 
                ? 'Enter your 4-digit access code' 
                : 'Enter your admin password'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {authStep === 'pin' ? (
              <div className="flex flex-col items-center gap-6">
                <InputOTP 
                  maxLength={4} 
                  value={pinCode} 
                  onChange={setPinCode}
                  onComplete={handlePinSubmit}
                  data-testid="input-admin-pin"
                >
                  <InputOTPGroup className="gap-3">
                    {[0, 1, 2, 3].map((index) => (
                      <InputOTPSlot 
                        key={index} 
                        index={index} 
                        className="h-14 w-14 text-2xl bg-muted border-border text-white" 
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                <Button 
                  onClick={handlePinSubmit} 
                  className="w-full bg-sky-600 hover:bg-sky-700"
                  disabled={pinCode.length !== 4}
                  data-testid="button-verify-pin"
                >
                  Verify Access Code
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <Input
                  type="password"
                  placeholder="Admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                  className="h-12 bg-muted border-border text-white placeholder:text-muted-foreground"
                  data-testid="input-admin-password"
                />
                <Button 
                  onClick={handlePasswordSubmit}
                  className="w-full bg-sky-600 hover:bg-sky-700"
                  disabled={!password}
                  data-testid="button-login"
                >
                  <Lock className="mr-2 h-4 w-4" />
                  Access Admin Panel
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Navigation items
  const navItems = [
    { title: "Overview", href: "/admin", icon: LayoutDashboard },
    { title: "Users", href: "/admin/users", icon: Users },
    { title: "Trade Ideas", href: "/admin/trade-ideas", icon: Zap },
    { title: "Invites", href: "/admin/invites", icon: Mail },
    { title: "Waitlist", href: "/admin/waitlist", icon: UserPlus },
    { title: "System", href: "/admin/system", icon: Activity },
  ];

  const advancedItems = [
    { title: "Blog", href: "/admin/blog", icon: BookOpen },
    { title: "Reports", href: "/admin/reports", icon: FileBarChart },
    { title: "Win/Loss", href: "/admin/win-loss", icon: Zap },
    { title: "Credits", href: "/admin/credits", icon: CreditCard },
    { title: "Security", href: "/admin/security", icon: Eye },
  ];

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full bg-card">
        <Sidebar className="border-r border-border">
          <SidebarHeader className="border-b border-border p-4">
            <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-white transition-colors">
              <ChevronLeft className="h-4 w-4" />
              <span className="text-sm">Back to App</span>
            </Link>
            <div className="flex items-center gap-3 mt-4">
              <div className="p-2 bg-sky-500/10 rounded-lg border border-sky-500/20">
                <Shield className="h-5 w-5 text-sky-500" />
              </div>
              <div>
                <h2 className="font-semibold text-white">Admin Panel</h2>
                <p className="text-xs text-muted-foreground">Quant Edge Labs</p>
              </div>
            </div>
          </SidebarHeader>
          
          <SidebarContent className="px-2">
            <SidebarGroup>
              <SidebarGroupLabel className="text-muted-foreground text-xs uppercase tracking-wider px-2">
                Management
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => {
                    const isActive = location === item.href;
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild>
                          <Link 
                            href={item.href}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                              isActive 
                                ? "bg-sky-500/10 text-sky-400 border border-sky-500/20" 
                                : "text-muted-foreground hover:text-white hover:bg-muted"
                            )}
                            data-testid={`nav-${item.title.toLowerCase()}`}
                          >
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel className="text-muted-foreground text-xs uppercase tracking-wider px-2">
                Advanced
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {advancedItems.map((item) => {
                    const isActive = location === item.href;
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild>
                          <Link 
                            href={item.href}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                              isActive 
                                ? "bg-sky-500/10 text-sky-400 border border-sky-500/20" 
                                : "text-muted-foreground hover:text-white hover:bg-muted"
                            )}
                            data-testid={`nav-${item.title.toLowerCase().replace('/', '-')}`}
                          >
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t border-border p-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/20">
                Authenticated
              </Badge>
            </div>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 overflow-auto">
          <div className="sticky top-0 z-10 bg-card/95 backdrop-blur border-b border-border">
            <div className="flex items-center gap-4 px-6 py-4">
              <SidebarTrigger className="text-muted-foreground hover:text-white" data-testid="button-sidebar-toggle" />
              <h1 className="text-lg font-semibold text-white">
                {navItems.find(item => item.href === location)?.title || 
                 advancedItems.find(item => item.href === location)?.title || 
                 'Admin'}
              </h1>
            </div>
          </div>
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
