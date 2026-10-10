import { Suspense, useState, useEffect, ComponentType } from "react";
import { getMarketStatus } from "@/lib/market-hours";
import { LEGACY_REDIRECT_PATTERN, resolveLegacyRedirect } from "@/lib/legacy-redirects";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { RealtimePricesProvider } from "@/context/realtime-prices-context";
import { useAuth } from "@/hooks/useAuth";
import { usePageTracking } from "@/hooks/use-analytics";
import { Button } from "@/components/ui/button";
import { LogOut, User, Loader2, Search } from "lucide-react";
import { Footer } from "@/components/footer";
import { AIChatbotPopup } from "@/components/ai-chatbot-popup";
import { ProtectedRoute, AdminProtectedRoute } from "@/components/protected-route";
import { PreferencesProvider, usePreferences } from "@/contexts/preferences-context";
;
import { ContentDensityProvider } from "@/hooks/use-content-density";
import { DensityProvider } from "@/components/ui/qe-density";
import { ErrorBoundary } from "@/components/error-boundary";
import { StockContextProvider } from "@/contexts/stock-context";
import { lazyWithRetry } from "@/lib/lazy-import";
import { CommandPalette } from "@/components/command-palette";
import { WhatsNewDrawer, WhatsNewToast } from "@/components/whats-new";
import { NexusFrame } from "@/components/shell/nexus-frame";

// All page imports use lazyWithRetry for automatic chunk-load error recovery.
// If a deployment changes chunk hashes, stale cached HTML won't crash —
// the app retries and auto-reloads to pick up the new chunks.
// ─── SHELLS — Terminal (/t) + Research (/r) ───
const TerminalShell  = lazyWithRetry(() => import("@/pages/shells/terminal-shell"),  "terminal-shell");

const ResearchShell  = lazyWithRetry(() => import("@/pages/shells/research-shell"),  "research-shell");
const RadarPage      = lazyWithRetry(() => import("@/pages/radar"),                  "radar");
const HowToPage      = lazyWithRetry(() => import("@/pages/how-to"),                 "how-to");

// The tenth reference mock: the wired marketing page. Prior landing stays at @/pages/landing.
const Landing = lazyWithRetry(() => import("@/pages/landing-nexus"), "landing");
const PublicWatchlist = lazyWithRetry(() => import("@/pages/public-watchlist"), "public-watchlist");
const Login = lazyWithRetry(() => import("@/pages/login"), "login");
const Signup = lazyWithRetry(() => import("@/pages/signup"), "signup");
const SlatePage     = lazyWithRetry(() => import("@/pages/slate"), "slate");
const TodayPage     = lazyWithRetry(() => import("@/pages/today"), "today");
const TradeJournalPage = lazyWithRetry(() => import("@/pages/trade-journal"), "trade-journal");
// REMOVED — Market page consolidated, redirect to /home
const PerformancePage = lazyWithRetry(() => import("@/pages/performance"), "performance");
const SettingsPage = lazyWithRetry(() => import("@/pages/settings"), "settings");
const AlertsPage = lazyWithRetry(() => import("@/pages/alerts"), "alerts");
const AdminOverview = lazyWithRetry(() => import("@/pages/admin/overview"), "admin-overview");
const AdminUsers = lazyWithRetry(() => import("@/pages/admin/users"), "admin-users");
const AdminInvites = lazyWithRetry(() => import("@/pages/admin/invites"), "admin-invites");
const AdminWaitlist = lazyWithRetry(() => import("@/pages/admin/waitlist"), "admin-waitlist");
const AdminSystem = lazyWithRetry(() => import("@/pages/admin/system"), "admin-system");
const AdminReports = lazyWithRetry(() => import("@/pages/admin/reports"), "admin-reports");
const AdminSecurity = lazyWithRetry(() => import("@/pages/admin/security"), "admin-security");
const AdminWinLoss = lazyWithRetry(() => import("@/pages/admin/win-loss"), "admin-win-loss");
const AdminCredits = lazyWithRetry(() => import("@/pages/admin/credits"), "admin-credits");
const AdminBetaInvites = lazyWithRetry(() => import("@/pages/admin/beta-invites"), "admin-beta-invites");
const AdminBlog = lazyWithRetry(() => import("@/pages/admin/blog"), "admin-blog");
const AdminTradeIdeas = lazyWithRetry(() => import("@/pages/admin/trade-ideas"), "admin-trade-ideas");
const About = lazyWithRetry(() => import("@/pages/about"), "about");
const PrivacyPolicy = lazyWithRetry(() => import("@/pages/privacy-policy"), "privacy-policy");
const TermsOfService = lazyWithRetry(() => import("@/pages/terms-of-service"), "terms-of-service");

const StrategySimulator = lazyWithRetry(() => import("@/pages/strategy-simulator"), "strategy-simulator");
const Backtest = lazyWithRetry(() => import("@/pages/backtest"), "backtest");
const Academy = lazyWithRetry(() => import("@/pages/academy"), "academy");
const Blog = lazyWithRetry(() => import("@/pages/blog"), "blog");

const BlogPost = lazyWithRetry(() => import("@/pages/blog-post"), "blog-post");
const Pricing = lazyWithRetry(() => import("@/pages/pricing"), "pricing");
// REMOVED — Paper Trading, Wallet Tracker, CT Tracker consolidated out
const TradeAudit = lazyWithRetry(() => import("@/pages/trade-audit"), "trade-audit");

// REMOVED — Backtest merged into Performance tab

// MERGED — Market Scanner folded into Hunt → Surges tab
// MERGED — Bullish Trends absorbed into Market Scanner
// MERGED — Trading Engine absorbed into Performance
// /watchlist + /watchlist/weekly now redirect into the Hunt shell's Watchlist tab
// (single canonical surface); the component is loaded lazily by hunt-shell.tsx.
// REMOVED — Weekly Watchlist tab lives in unified-watchlist, Conviction Backtest in Performance

// REMOVED — AION consolidated out, redirect added below
// REMOVED — Historical Intelligence merged into Performance tab
const NotFound = lazyWithRetry(() => import("@/pages/not-found"), "not-found");
const JoinBeta = lazyWithRetry(() => import("@/pages/join-beta"), "join-beta");
const InviteWelcome = lazyWithRetry(() => import("@/pages/invite-welcome"), "invite-welcome");
const ForgotPassword = lazyWithRetry(() => import("@/pages/forgot-password"), "forgot-password");
const ResetPassword = lazyWithRetry(() => import("@/pages/reset-password"), "reset-password");

// MERGED — Discover absorbed into Trade Desk
const HistoryPage = lazyWithRetry(() => import("@/pages/history"), "history");

// Terminal — full-screen Skylit-style dedicated pages
// MERGED: /terminal/:symbol now redirects to Research (/r/:symbol?tab=chart)
// MERGED: Heatmap view now lives inside unified terminal-chart.tsx

// Preload critical routes after initial render (during idle time).
// This warms the chunk cache so navigation feels instant.
function preloadCriticalRoutes() {
  // Use requestIdleCallback (or setTimeout fallback) to avoid blocking initial paint
  const schedule = typeof requestIdleCallback !== "undefined" ? requestIdleCallback : (fn: () => void) => setTimeout(fn, 2000);
  schedule(() => {
    // Warm only the canonical terminal shell. The previous list downloaded three
    // legacy/heavy pages (including an unrouted Home) immediately after first paint,
    // competing with the live Oracle requests the user was actually waiting for.
    import("@/pages/shells/terminal-shell").catch(() => {});
  });
}

function PageLoader() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] w-full">
      <Loader2 className="h-8 w-8 animate-spin text-sky-400/60" />
    </div>
  );
}

function withBetaProtection<P extends object>(Component: ComponentType<P>) {
  return function ProtectedComponent(props: P) {
    return (
      <ProtectedRoute requireBetaAccess={true}>
        <Component {...props} />
      </ProtectedRoute>
    );
  };
}

function withAdminProtection<P extends object>(Component: ComponentType<P>) {
  return function AdminProtectedComponent(props: P) {
    return (
      <AdminProtectedRoute>
        <Component {...props} />
      </AdminProtectedRoute>
    );
  };
}
function SmartLanding() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <PageLoader />;
  }

  // If logged in, land on TODAY (/today) — the signed-in home (2026-09-24).
  // We deliberately ignore a stale `qe-last-page` pointing at a legacy shell so the
  // app stops opening on the old sidebar UI; the legacy routes all still work if you
  // navigate to them directly. Anything else previously visited is still restored.
  // ?preview=landing renders the marketing page even while signed in. Without it
  // the landing page is unreachable to anyone with a session — which is everyone
  // who works on it — so the only way to check a change was to log out. Read-only
  // escape hatch: it changes nothing but which component renders.
  if (user && new URLSearchParams(window.location.search).get('preview') === 'landing') {
    return <Landing />;
  }

  if (user) {
    const lastPage = localStorage.getItem('qe-last-page');
    const LEGACY_LANDINGS = ['/p', '/h', '/g', '/r'];
    const target = !lastPage || LEGACY_LANDINGS.includes(lastPage.split('?')[0]) ? '/today' : lastPage;
    return <Redirect to={target} />;
  }

  // Otherwise show landing page
  return <Landing />;
}

/**
 * Renders the redirect for any legacy URL matched by LEGACY_REDIRECT_PATTERN.
 * (Unmatched fallthrough renders NotFound, same as the old 404 fallback.)
 */
function LegacyRedirect() {
  const [location] = useLocation();
  const target = resolveLegacyRedirect(location);
  if (!target) return <NotFound />;
  return <Redirect to={target} />;
}

function Router() {
  usePageTracking();

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* ─── TERMINAL — one shell, 10 tabs (NEXUS · CHART · FLOW · GEX · LEAPS · CRYPTO · CATALYST · BOT · POSITIONS · JOURNAL) ─── */}
        <Route path="/t"          component={withBetaProtection(TerminalShell)} />
        
        {/* ─── RESEARCH — per-ticker shell (own symbol chrome; stays separate) ─── */}

        <Route path="/r/:symbol"  component={withBetaProtection(ResearchShell)} />
        <Route path="/r"          component={withBetaProtection(ResearchShell)} />
        <Route path="/radar"      component={withBetaProtection(RadarPage)} />

        <Route path="/how-to"     component={HowToPage} />

        {/* ─── RESTORED ROUTES ───────────────────────────────────────────────
            These four paths had NO <Route> while 28 <Redirect>s and roughly 25
            nav links pointed at them, so every one of those landed on NotFound.
            /trade-desk was the worst: login.tsx:62 and :87 send you there after
            a successful sign-in, which meant signing in ended on a 404.

            The pages themselves were fine the whole time — imported, building,
            and backed by live endpoints. Only the routes were missing, lost when
            the router was collapsed to shells and the targets were never
            repointed. Restoring the route is the small fix; deleting the pages
            would have been the expensive one. */}
        <Route path="/today"       component={withBetaProtection(TodayPage)} />
        <Route path="/slate"       component={withBetaProtection(SlatePage)} />
        {/* HOME IS THE TERMINAL. Confirmed by the owner, against two rival
            candidates that both call themselves the dashboard in their own headers:
            pages/home.tsx ("Command Center", 1,186 lines) and pages/home-glass.tsx
            ("the real dashboard in the chosen design language"). Neither is. The
            product is /t — Terminal ORACLE: regime, rotation map, session brief,
            early rotation, the live signal board and the signal card.

            So /home is a redirect, not a page, and the other two stay unrouted.
            Three files claiming to be the dashboard is how this drifted in the
            first place; only one of them is reachable now, and it is the right one. */}

        {/* Public marketing routes that had links but no <Route>. /pricing is the
            worst of these: protected-route.tsx:201, kavout-sidebar.tsx:162 and
            ai-chatbot-popup.tsx:300 all send users there to upgrade, and all three
            hit NotFound — the entire paid-conversion path was a dead end. Blog had
            the mirror problem: /admin/blog is routed, so posts could be authored
            but never read. */}
        <Route path="/pricing"    component={Pricing} />
        <Route path="/blog/:slug" component={BlogPost} />
        <Route path="/blog"       component={Blog} />
        <Route path="/academy"    component={Academy} />

        {/* Public, read-only shared watchlist (no auth) — for trading groups */}
        <Route path="/w" component={PublicWatchlist} />

        {/* Core Pages - Smart redirect for logged-in users */}
        <Route path="/" component={SmartLanding} />

      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/join-beta" component={JoinBeta} />
      
      <Route path="/invite" component={InviteWelcome} />

      <Route path="/trade-ideas/:id/audit" component={withBetaProtection(TradeAudit)} />

      {/* System Pages */}
      <Route path="/settings" component={withBetaProtection(SettingsPage)} />
      <Route path="/alerts" component={withBetaProtection(AlertsPage)} />

      {/* Admin Pages - Have their own password auth via AdminLayout */}
      <Route path="/admin" component={AdminOverview} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/invites" component={AdminInvites} />
      <Route path="/admin/waitlist" component={AdminWaitlist} />
      <Route path="/admin/system" component={AdminSystem} />
      <Route path="/admin/trade-ideas" component={AdminTradeIdeas} />
      <Route path="/admin/blog" component={AdminBlog} />
      <Route path="/admin/reports" component={AdminReports} />
      <Route path="/admin/security" component={AdminSecurity} />
      <Route path="/admin/win-loss" component={AdminWinLoss} />
      <Route path="/admin/credits" component={AdminCredits} />
      <Route path="/admin/beta-invites" component={AdminBetaInvites} />
      <Route path="/about" component={About} />
      
      {/* Legal Pages */}
      <Route path="/privacy" component={PrivacyPolicy} />
      <Route path="/terms" component={TermsOfService} />

      {/* ─── LEGACY REDIRECTS ─── one catch-all replaces ~70 individual redirect
          routes. The map, matcher, and route pattern live in
          lib/legacy-redirects.ts; redirect chains were resolved to final
          destinations so every legacy URL lands in one hop. */}
      <Route path={LEGACY_REDIRECT_PATTERN}>
        <LegacyRedirect />
      </Route>

      {/* 404 Fallback */}
      <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function AuthHeader() {
  const { user, logout, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [marketStatus, setMarketStatus] = useState({ isOpen: false, statusMessage: 'Checking...' });

  useEffect(() => {
    const updateStatus = () => {
      const status = getMarketStatus();
      setMarketStatus(status);
    };
    updateStatus();
    const interval = setInterval(updateStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    logout();
    setLocation("/");
  };

  const userData = user as { email?: string; firstName?: string } | null;

  return (
    <header className="flex items-center justify-between gap-2 px-3 h-10 border-b border-border/40 bg-card/50 backdrop-blur-sm shrink-0">
      {/* Left — trigger + market status */}
      <div className="flex items-center gap-2">
        <SidebarTrigger data-testid="button-mobile-menu" className="h-7 w-7 text-muted-foreground" />
        <div className="h-4 w-px bg-border hidden sm:block" />
        <span className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
          <span className={`h-1 w-1 rounded-full ${marketStatus.isOpen ? 'bg-[var(--trade-bullish)] animate-pulse' : 'bg-muted-foreground'}`} />
          {marketStatus.isOpen ? 'OPEN' : 'CLOSED'}
        </span>
      </div>

      {/* Right — search, user, theme */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground gap-1.5 hidden sm:flex"
          onClick={() => window.dispatchEvent(new Event('qe:open-command-palette'))}
        >
          <Search className="h-3 w-3" />
          Search
          <kbd className="ml-1 px-1 py-0 text-[9px] bg-muted rounded border border-border text-muted-foreground">⌘K</kbd>
        </Button>
        {isAuthenticated && userData && (
          <>
            <span className="hidden md:inline text-[10px] font-mono text-muted-foreground truncate max-w-[120px]">
              {userData.firstName || userData.email || 'User'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              aria-label="Log out"
              data-testid="button-logout"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-3 w-3" />
            </Button>
          </>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}

function App() {
  const [location] = useLocation();

  // Preload critical routes once after first render
  useEffect(() => {
    preloadCriticalRoutes();
  }, []);

  // Track last visited page for session persistence across reloads
  useEffect(() => {
    const path = location.split('?')[0];
    // Only save authenticated app pages (not landing/login/public)
    // Don't remember legacy shells as the landing page — the Terminal (/t) is the front
    // door now. They remain reachable directly; they just no longer hijack the next visit.
    const skipPaths = ['/', '/w', '/landing', '/login', '/signup', '/invite', '/join-beta',
                       '/p', '/h', '/g', '/r', '/pos', '/j', '/academy', '/how-to'];
    if (!skipPaths.includes(path) && !path.startsWith('/admin') && !path.startsWith('/invite/')) {
      localStorage.setItem('qe-last-page', location);
    }
  }, [location]);

  const style = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3rem",
  };

  // Show public landing pages without sidebar (admin page handles its own layout)
  // Strip query parameters for comparison since location may include ?code=XXX etc.
  const locationPath = location.split('?')[0];
  const publicPages = ['/', '/w', '/landing', '/features', '/login', '/signup', '/invite', '/join-beta', '/admin', '/admin/users', '/admin/invites', '/admin/waitlist', '/admin/system', '/admin/trade-ideas', '/admin/reports', '/admin/security', '/admin/win-loss', '/admin/credits', '/admin/beta-invites', '/admin/blog', '/admin/old', '/privacy', '/terms', '/about', '/academy', '/blog', '/pricing'];
  // Also check for dynamic invite paths like /invite/:token
  const isPublicPage = publicPages.includes(locationPath) || locationPath.startsWith('/invite/');
  if (isPublicPage) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="nexus" storageKey="quantedge-theme">
          <TooltipProvider>
            <RealtimePricesProvider>
              <StockContextProvider>
                <Router />
                <CommandPalette />
                <WhatsNewDrawer />
                <WhatsNewToast />
                <Toaster />
              </StockContextProvider>
            </RealtimePricesProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  // FULL-BLEED SHELLS — the current design. No AppSidebar, no AuthHeader, no global
  // Footer; each of these shells supplies its own header and tabs, so the sidebar was
  // redundant chrome stacked on top of chrome.
  //
  // /t was the only route in here, which meant the Terminal was the only surface in
  // the new design and everything else still rendered the old left-sidebar layout.
  // That split was doing real damage: the evidence rail links a signal to
  // /r/:symbol, so validating a call threw you out of the new product and into the
  // old one mid-task. Research already draws its own symbol header and its own
  // Chart/Options/GEX/Flow/Analyze tabs — it was never missing chrome, it was
  // wearing two sets.
  //
  // Matching /r and /r/:symbol as a prefix, not an equality, so per-ticker routes
  // are included.
  // /r (research) now renders inside NexusFrame like every other page, so it
  // gets the shared topbar and mobile dock instead of a third chrome of its own.
  const isFullBleedShell = locationPath === '/t' || locationPath === '/nexus' || locationPath === '/today';

  if (isFullBleedShell) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="nexus" storageKey="quantedge-theme">
          <TooltipProvider>
            <RealtimePricesProvider>
              <StockContextProvider>
                <PreferencesProvider>
                  <ContentDensityProvider>
                    <DensityProvider>
                      <SidebarProvider style={style as React.CSSProperties}>
                        <div className="h-screen w-full overflow-auto page-atmosphere">
                          <ErrorBoundary>
                            <Suspense fallback={<PageLoader />}>
                              <Router />
                            </Suspense>
                          </ErrorBoundary>
                        </div>
                      </SidebarProvider>
                      {/* No legacy CommandPalette here: the terminal shell owns
                          ⌘K with its own palette (liquid-universe search + tab
                          jumps). Mounting both stacked two palettes on one
                          keystroke. */}
                      <WhatsNewDrawer />
                      <WhatsNewToast />
                      <Toaster />
                    </DensityProvider>
                  </ContentDensityProvider>
                </PreferencesProvider>
              </StockContextProvider>
            </RealtimePricesProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  // Every other signed-in page wears the terminal's chrome (NexusFrame): same
  // topbar, same desktop tabs, same mobile bottom dock. The legacy left-sidebar
  // layout (AppSidebar + AuthHeader + Footer) was retired 2026-09-24 — two
  // designs in one product made moving between the board and a page feel like
  // leaving the app.
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="nexus" storageKey="quantedge-theme">
        <TooltipProvider>
          <RealtimePricesProvider>
            <StockContextProvider>
              <PreferencesProvider>
                <ContentDensityProvider>
                  <DensityProvider>
                    <SidebarProvider style={style as React.CSSProperties}>
                      <NexusFrame>
                        <ErrorBoundary>
                          <Suspense fallback={<PageLoader />}>
                            <Router />
                          </Suspense>
                        </ErrorBoundary>
                      </NexusFrame>
                    </SidebarProvider>
                    <CommandPalette />
                    <WhatsNewDrawer />
                    <WhatsNewToast />
                    <Toaster />
                  </DensityProvider>
                </ContentDensityProvider>
              </PreferencesProvider>
            </StockContextProvider>
          </RealtimePricesProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
