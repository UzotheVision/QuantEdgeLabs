/**
 * TERMINAL — the one shell. Replaces the scattered pages with a single persistent
 * chrome + 10 tabs (NEXUS · CHART · FLOW · GEX · LEAPS · CRYPTO · CATALYST ·
 * BOT · POSITIONS · JOURNAL), the MomoEdge grammar
 * applied to QuantEdge's real engines. Everything moves via the shared motion
 * system; the tab underline slides (layoutId) and content cross-fades.
 *
 * This is the consolidation target for AUDIT.md / BLUEPRINT.md / TERMINAL_SPEC.md.
 */
import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'wouter';
import { onWorkup } from '@/lib/workup-bus';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Activity, Bitcoin, Bot, BookOpen, CalendarDays, CandlestickChart, Grid3X3, Loader2,
  LogOut, Moon, MoreHorizontal, Radar, Search, SlidersHorizontal,
  TrendingUp, UserRound, Wallet, X, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EASE, DUR } from '@/lib/motion';
import { RotationMap } from '@/components/rotation-map';
import { SessionBrief } from '@/components/oracle/session-brief';
;
import { OracleMarketField } from '@/components/oracle/oracle-market-field';
import { TickerTape, SectorHeatmap, WatchlistRail, SystemStatusBlock, FooterMarketLine } from '@/components/oracle/oracle-rails';
import { LiveStatsBar } from '@/components/footer';
// LEAPS = the fifth reference mock, wired. The prior LeapTracker stays at
// components/hunt/leap-tracker.
const LeapTracker = lazy(() => import('@/components/hunt/leaps-nexus').then(m => ({ default: m.LeapsNexus })));
import { TerminalAlerts, AlertBell, useSignalAlerts } from '@/components/terminal/terminal-alerts';
import { useQuery } from '@tanstack/react-query';
import type { ConvictionsResponse } from '@/lib/convictions';
import { useStockContext } from '@/contexts/stock-context';
import { useTheme } from '@/components/theme-provider';
import { useAuth } from '@/hooks/useAuth';
import { KitStyles } from '@/components/templates/kit';
import quantEdgeLogoUrl from '@assets/qe-mark.svg';
import '@/styles/nexus.css';
import { TerminalTickerSearch } from '@/components/terminal/terminal-ticker-search';
import { SystemPulse } from '@/components/terminal/system-pulse';
import { CommandPalette } from '@/components/terminal/command-palette';
// Non-default tabs and closed overlays must not tax Oracle's first paint. Keeping
// these as static imports made charting, bot analytics and settings code part of
// every terminal visit even when the user never opened those surfaces.
const TerminalGuide = lazy(() => import('@/components/terminal/terminal-guide').then(m => ({ default: m.TerminalGuide })));
const TerminalSettings = lazy(() => import('@/components/terminal/terminal-settings').then(m => ({ default: m.TerminalSettings })));

// CHART = the reference Chart Lab mock, wired (chart-lab-nexus). The prior
// EpochChart-based lab stays in the tree at charting/chart-lab.tsx.
const ChartLab = lazy(() => import('@/components/charting/chart-lab-nexus').then(m => ({ default: m.ChartLabBoard })));

const NexusBoard    = lazy(() => import('@/pages/nexus').then(m => ({ default: m.NexusBoard })));
// GEX = the reference GEX Hub mock, wired.
const GexHub        = lazy(() => import('@/components/gex/gex-hub-nexus').then(m => ({ default: m.GexHubNexus })));
const FlowBoard     = lazy(() => import('@/components/flow/flow-board').then(m => ({ default: m.FlowBoard })));
// The old flow-heatmap page is the SECTOR TREEMAP with a flow overlay (breadth, net flow,
// sweeps, whales + per-ticker flow detail). That's the Heatmap surface, not the tape — so
// it belongs on HEATMAP. Keeping it preserves the strongest part of the old design.
// PRISM = the strike x expiry gamma surface (what the walkthrough actually shows),
// not the premium-spectrum strike picker that used to sit here.

// CATALYST — the event calendar joined to the signals we publish, so a call and the
// news pointing the other way land on the same screen instead of two separate ones.
// CRYPTO = the sixth reference mock, wired. Prior CryptoTerminal stays in tree.
const CryptoTerminal = lazy(() => import('@/components/crypto/crypto-nexus').then(m => ({ default: m.CryptoNexus })));
// BOT = the seventh reference mock: the real automation layer, reported honestly.
const BotNexus = lazy(() => import('@/components/bot/bot-nexus').then(m => ({ default: m.BotNexus })));
// POSITIONS + JOURNAL — folded in from their own shells/routes (Phase 2: one chrome).
// Positions is a single panel (its shell was only a header around the heatmap);
// Journal keeps its own sub-tabs, synced to ?jtab= so it never fights the shell's ?tab=.
const PositionsPanel = lazy(() => import('@/pages/positions-heatmap'));
const JournalPanel = lazy(() => import('@/pages/shells/journal-shell'));
// CATALYST = composed from docs/DESIGN_SYSTEM.md (no mock). Prior CatalystBoard stays in tree.
const CatalystNexus = lazy(() => import('@/components/catalyst/catalyst-nexus').then(m => ({ default: m.CatalystNexus })));

// Tabs, mobile dock and "More" live in ONE shared model so the terminal and
// every standalone page (NexusFrame) wear identical navigation.
import { TABS, type Tab } from '@/components/shell/nav-model';
import { MobileDock } from '@/components/shell/mobile-dock';
import { CustomizePanel } from '@/components/shell/customize-panel';
import { DesktopRail } from '@/components/shell/desktop-rail';
export { TABS };
export type { Tab };

function useUptime() {
  const [s, setS] = useState(0);
  useEffect(() => { const t = setInterval(() => setS((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

const isTab = (v: string | null): v is Tab => !!v && TABS.some((t) => t.id === v);

/**
 * Both of these tabs used to exist at this level and now live inside GEX. Anyone
 * with a bookmark, an open pin, or the muscle memory for ?tab=prism should land on
 * the surface they meant rather than being dropped on Oracle with no explanation —
 * a removed tab that silently resolves elsewhere reads as a bug.
 */
const MOVED_TABS: Record<string, Tab> = { prism: 'gex', heatmap: 'gex' };
const resolveTab = (v: string | null): Tab =>
  isTab(v) ? v : (v && MOVED_TABS[v]) || 'oracle';

type MarketFocus = 'pulse' | 'rotation' | 'brief';
const MARKET_FOCUS_COPY: Record<MarketFocus, { eyebrow: string; title: string; description: string }> = {
  pulse: {
    eyebrow: 'Market participation',
    title: 'Market Pulse',
    description: 'Broad asset participation and where money is rotating right now.',
  },
  rotation: {
    eyebrow: 'Relative rotation',
    title: 'Rotation Map',
    description: 'Relative strength × momentum across the sector universe.',
  },
  brief: {
    eyebrow: 'Leadership tape',
    title: 'Session Brief',
    description: 'The groups carrying today’s tape, and the names inside them.',
  },
};

export default function TerminalShell() {
  // Tab lives in the URL (?tab=gex) so it's deep-linkable, shareable, survives a reload,
  // and lets legacy routes redirect straight to the right surface.
  const [location, setLocation] = useLocation();
  const urlTab = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
  const [tab, setTabState] = useState<Tab>(resolveTab(urlTab));

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    const path = window.location.pathname;
    // 'oracle' is the id, NEXUS is the surface: the front tab renders the
    // NEXUS board INSIDE this shell — one chrome, one nav, no second page.
    setLocation(next === 'oracle' ? path : `${path}?tab=${next}`, { replace: true });
  }, [setLocation]);


  // Follow back/forward and external navigations that change ?tab=
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    setTabState((cur) => (isTab(t) ? t : 'oracle') === cur ? cur : (isTab(t) ? t : 'oracle'));
  }, [location]);

  const [guideOpen, setGuideOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // ⌘K from anywhere in the terminal opens the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [marketFocus, setMarketFocus] = useState<MarketFocus | null>(null);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Alerts watch the same conviction feed the Oracle tab renders, so they fire on any
  // tab — the point of an alert is that it reaches you when you are NOT looking at it.
  const { data: convictions } = useQuery<ConvictionsResponse>({
    queryKey: ['/api/convictions', 'alerts'],
    queryFn: async () => {
      const r = await fetch('/api/convictions', { credentials: 'include' });
      if (!r.ok) throw new Error('convictions failed');
      return r.json();
    },
    staleTime: 60_000, refetchInterval: 90_000, retry: 1,
  });
  const alerts = useSignalAlerts(convictions?.picks);
  const reduce = useReducedMotion();
  const uptime = useUptime();
  // One ticker for the whole terminal: search once, every tab follows it.
  const { currentStock, setCurrentStock } = useStockContext();
  // ONE ticker destination. Search, flow rows, rotation/session names and every
  // openWorkup() call land on the same deep-linkable Research shell. The old
  // behavior mixed context-only changes, modal dossiers and tab switches.
  const openResearch = useCallback((symbol: string, name?: string, researchTab: 'workup' | 'chart' | 'flow' | 'gex' = 'workup') => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setCurrentStock({ symbol: sym, name });
    const params = new URLSearchParams();
    if (researchTab !== 'workup') params.set('tab', researchTab);
    params.set('from', `terminal-${tab}`);
    setLocation(`/r/${encodeURIComponent(sym)}?${params.toString()}`);
  }, [setCurrentStock, setLocation, tab]);
  useEffect(() => onWorkup((sym) => openResearch(sym)), [openResearch]);
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const { data: health } = useQuery<{
    status?: string;
    dependencies?: { tradier?: boolean; postgres?: { ok?: boolean } };
  }>({
    queryKey: ['/api/health', 'terminal-chrome'],
    queryFn: async () => {
      const response = await fetch('/api/health', { credentials: 'include' });
      if (!response.ok) throw new Error('health unavailable');
      return response.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 0,
  });
  const nexusLight = theme === 'nexus-light';
  // The chrome button is the ☀/☾ from the reference topbar: dark blue ↔ light.
  // Night/dark remain reachable from the settings panel's labelled picker.
  const nextTheme = nexusLight ? 'nexus' as const : 'nexus-light' as const;
  const dataPartial = health?.status === 'degraded' || health?.dependencies?.tradier === false;
  const accountLabel = user?.firstName || user?.email?.split('@')[0] || 'Account';
  const accountInitial = accountLabel.slice(0, 1).toUpperCase();

  return (
    <div className={cn('qe-terminal nexus-vars min-h-screen flex flex-col', theme === 'nexus-light' && 'light')}>
      <KitStyles />
      <DesktopRail activeTab={tab} currentPath="/t" onTab={setTab} />
      {/* ── persistent chrome — the reference terminal's topbar, verbatim
             classes from styles/nexus.css. Every tab wears it. ── */}
      <header className="sticky top-0 z-20 lg:pl-[196px]">
        <div className="topbar" style={{ minHeight: 44 }}>
          <Link href="/today" className="brand lg:hidden" aria-label="Quant Edge Labs — home" style={{ textDecoration: 'none' }}>
            <img className="brand-logo" src={quantEdgeLogoUrl} alt="Quant Edge Labs" />
            <span className="brand-name">QUANTEDGE</span>
            <span className="brand-slash">{'//'}</span>
            <span className="brand-sub hidden sm:inline">TERMINAL</span>
          </Link>
          <div className="status-chip ok hidden sm:flex"><span className="dot" />Engaged</div>
          <div
            className={cn('status-chip hidden lg:flex', dataPartial ? 'warn' : 'ok')}
            title={dataPartial ? 'Some premium and chain-dependent reads are unavailable' : 'Primary data dependencies are healthy'}
          >
            <span className="dot" />{dataPartial ? 'Data partial' : 'Data ready'}
          </div>

          {/* His nav sits LEFT, immediately after the chips — not centered. */}
          <div className="top-spacer" />

          {/* His search box — same typeahead engine, his shell around it. */}
          <button
            type="button"
            onClick={() => setMobileSearchOpen((open) => !open)}
            aria-label="Search ticker"
            aria-expanded={mobileSearchOpen}
            className="grid h-9 w-9 place-items-center rounded border border-border/55 text-muted-foreground transition-colors hover:text-foreground lg:hidden"
          >
            <Search className="h-4 w-4" />
          </button>
          {/* Desktop search is a ⌘K PALETTE TRIGGER, not an inline dropdown —
              same .search chrome the mock drew, but clicking it (or ⌘K from
              anywhere) opens the command palette. */}
          <div className="hidden lg:block">
            <button
              type="button"
              className="search"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command palette"
              style={{ cursor: 'pointer', background: 'transparent' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              {currentStock?.symbol ? (
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 'var(--fs-10, 10px)', fontWeight: 700, letterSpacing: 0.8, color: 'var(--cyan-bright, #3b8cff)' }}>{currentStock.symbol}</span>
              ) : (
                <span style={{ fontSize: 'var(--fs-10-5, 10.5px)', color: 'var(--text-mute)' }}>search any ticker</span>
              )}
              <span className="search-kbd">⌘K</span>
            </button>
          </div>

          {/* His user-chip. Everything the mock's header doesn't show — alerts,
              settings, guide, the ☀/☾ — lives in this menu, so the bar itself
              stays pixel-true to the reference. */}
          <div className="relative">
              <button
                onClick={() => setAccountOpen((open) => !open)}
                aria-label="Open account menu"
                aria-expanded={accountOpen}
                className="user-chip"
              >
                <div className="user-avatar">{accountInitial}</div>
                <span className="user-name hidden lg:inline">{accountLabel}</span>
                {alerts.unread > 0 && (
                  <span
                    className="grid h-4 min-w-4 place-items-center rounded-full px-1 font-mono text-[9px] font-bold"
                    style={{ background: 'rgba(59,140,255,0.15)', color: 'var(--cyan-bright)', border: '1px solid rgba(59,140,255,0.3)' }}
                  >
                    {alerts.unread}
                  </span>
                )}
              </button>
              <AnimatePresence>
                {accountOpen && (
                  <motion.div
                    className="absolute right-0 top-9 z-40 w-52 rounded-lg border border-border/70 bg-card p-1.5 shadow-xl shadow-black/30"
                    initial={reduce ? false : { opacity: 0, y: -4, scale: .98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: .98 }}
                    transition={{ duration: DUR.fast, ease: EASE }}
                  >
                    <div className="border-b border-border/45 px-2.5 py-2 font-mono">
                      <div className="truncate text-[11px] font-bold text-foreground">{accountLabel}</div>
                      <div className="truncate text-[9px] text-muted-foreground">{user?.email ?? 'Guest terminal'}</div>
                    </div>
                    {/* Controls the reference header doesn't carry — parked here
                        so the bar matches it exactly. */}
                    <button onClick={() => { setAccountOpen(false); setAlertsOpen(true); alerts.setUnread(0); }} className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                      <Activity className="h-3.5 w-3.5" /> Alerts{alerts.unread > 0 ? ` · ${alerts.unread}` : ''}
                    </button>
                    <button onClick={() => { setAccountOpen(false); setGuideOpen(true); }} className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                      <BookOpen className="h-3.5 w-3.5" /> Guide
                    </button>
                    <button onClick={() => setTheme(nextTheme)} className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                      {nexusLight ? <Moon className="h-3.5 w-3.5" /> : <span className="grid h-3.5 w-3.5 place-items-center text-[11px] leading-none">☀</span>}
                      {nexusLight ? 'Dark mode' : 'Light mode'}
                    </button>
                    <button onClick={() => { setAccountOpen(false); setCustomizeOpen(true); }} className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                      <SlidersHorizontal className="h-3.5 w-3.5" /> Display & layout
                    </button>
                    <button onClick={() => { setAccountOpen(false); setSettingsOpen(true); }} className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                      <UserRound className="h-3.5 w-3.5" /> Preferences & risk
                    </button>
                    <button onClick={() => { setAccountOpen(false); setLocation('/settings'); }} className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                      <SlidersHorizontal className="h-3.5 w-3.5" /> Full account settings
                    </button>
                    {user && <button onClick={() => { setAccountOpen(false); logout(); }} className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--trade-bearish)] transition-colors hover:bg-[var(--trade-bearish)]/10">
                      <LogOut className="h-3.5 w-3.5" /> Sign out
                    </button>}
                  </motion.div>
                )}
              </AnimatePresence>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {mobileSearchOpen && (
            <motion.div
              className="border-t border-border/45 px-3 py-2 lg:hidden"
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={reduce ? undefined : { opacity: 0, height: 0 }}
            >
              <TerminalTickerSearch
                compact
                value={currentStock?.symbol}
                onSelect={(result) => {
                  openResearch(result.symbol, result.name);
                  setMobileSearchOpen(false);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ── quote tape — real movers from the extended-hours scan, labelled by
          session. Hidden on small screens where 28px of marquee is noise. */}
      <div className="hidden md:block lg:pl-[196px]">
        <TickerTape />
      </div>

      {/* ── tab content (cross-fades) ── */}
      <main className="min-h-0 min-w-0 flex-1 overflow-x-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-[196px]">
        {/* Some market modules keep long-lived subscriptions and nested layout
            animations. `mode="wait"` can leave the outgoing module mounted at
            opacity 0 while it waits for every descendant to finish exiting,
            producing a blank terminal after a tab change. Sync keeps the handoff
            animated without allowing one module to block the next. */}
        <AnimatePresence mode="sync" initial={false}>
          <motion.div
            key={tab}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: DUR.base, ease: EASE }}
          >
            <Suspense fallback={<Fallback />}>
              {tab === 'oracle' && (
                /* NEXUS — the reference board, embedded. The shell owns the
                   chrome (topbar/nav/tape/footer); this renders only the
                   three-column main. The previous Oracle v2 layout this
                   replaces lives at 4598bc1 if it is ever wanted back. */
                <div className="nexus-embed-host">
                  <NexusBoard />
                </div>
              )}
              {tab === 'chart' && <ChartLab />}
              {/* clicking a ticker sets the shared symbol, so PRISM/GEX follow it.
                  Full-bleed: the FLOW mock owns its own two-column layout. */}
              {tab === 'flow' && <FlowBoard onSelectSymbol={(sym) => openResearch(sym, undefined, 'flow')} />}
              {tab === 'gex' && <GexHub />}
              {tab === 'leaps' && <LeapTracker />}
              {tab === 'crypto' && <CryptoTerminal />}
              {tab === 'catalyst' && <CatalystNexus />}
              {tab === 'bot' && <BotNexus />}
              {tab === 'positions' && <PositionsPanel />}
              {tab === 'journal' && <JournalPanel />}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>


      <MobileDock activeTab={tab} onTab={setTab} />
      <CustomizePanel open={customizeOpen} onClose={() => setCustomizeOpen(false)} />

      {/* Each live market view has a full-screen focus mode. The stage stays comparable
          at a glance; a reader can then inspect one real source without it becoming
          a taller card inside the scrolling Oracle book. */}
      <AnimatePresence>
        {tab === 'oracle' && marketFocus && (
          <motion.div
            className="qe-focus-overlay fixed inset-0 z-[60] grid place-items-center bg-background/55 p-3 backdrop-blur-md md:p-6"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            onMouseDown={() => setMarketFocus(null)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-label={`${MARKET_FOCUS_COPY[marketFocus].title} full view`}
              className="qe-focus-panel flex max-h-[calc(100dvh-24px)] w-full max-w-[1480px] flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xl shadow-black/50"
              initial={reduce ? false : { opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, y: 10, scale: 0.99 }}
              transition={{ duration: 0.24, ease: EASE }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3 md:px-5">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--brand-cyan)]">{MARKET_FOCUS_COPY[marketFocus].eyebrow}</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{MARKET_FOCUS_COPY[marketFocus].title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{MARKET_FOCUS_COPY[marketFocus].description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMarketFocus(null)}
                  className="inline-flex items-center gap-1 border border-border/70 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-[var(--brand-cyan)] hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" /> Close
                </button>
              </div>
              <div className="min-h-0 overflow-y-auto p-3 md:p-5">
                {marketFocus === 'pulse' && <OracleMarketField expanded onSelectSymbol={(sym) => openResearch(sym)} />}
                {marketFocus === 'rotation' && <RotationMap expanded />}
                {marketFocus === 'brief' && <SessionBrief expanded onSelectSymbol={(sym) => openResearch(sym)} />}
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      {guideOpen && (
        <Suspense fallback={null}>
          <TerminalGuide tab={tab} open onClose={() => setGuideOpen(false)} />
        </Suspense>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <TerminalSettings open onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      <TerminalAlerts
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        feed={alerts.feed}
        setFeed={alerts.setFeed}
        prefs={alerts.prefs}
        update={alerts.update}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onTicker={(symbol, name) => openResearch(symbol, name)}
        onTab={(t) => setTab(t as Tab)}
        tabs={TABS}
      />

      {/* ── footer — the reference bottombar. Same real content as before:
             LiveStatsBar (bots/watchlist/VIX) and the market line (session ·
             SPY · BTC · next poll · clock) ride inside his chrome. ── */}
      <footer className="bottombar lg:pl-[196px]" style={{ minHeight: 26 }}>
        <div className="bb-item"><span className="dot" /><b>{tab.toUpperCase()}</b> engaged</div>
        <div className="bb-sep" />
        <SystemPulse />
        <div className="bb-sep hidden md:block" />
        <div className="bb-item hidden md:flex">Uptime <b className="tabular-nums">{uptime}</b></div>
        <div className="bb-sep hidden md:block" />
        <span className="hidden items-center md:inline-flex">
          <LiveStatsBar />
        </span>
        <div className="bb-spacer" />
        <span className="hidden items-center lg:inline-flex">
          <FooterMarketLine className="text-[10px]" />
        </span>
        <div className="bb-sep hidden sm:block" />
        <div className="bb-item hidden sm:flex">Educational only · not investment advice</div>
      </footer>
    </div>
  );
}

function Fallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-cyan,#3b8cff)]" />
    </div>
  );
}
