/**
 * NEXUS FRAME — the terminal's chrome around every standalone page.
 *
 * Replaces the legacy left-sidebar layout (AppSidebar + AuthHeader + Footer),
 * which the operator retired on 2026-09-24: "side bar pages was the last design,
 * scrap it". A page like /slate now wears the same topbar, the same desktop
 * tabs and the same mobile bottom dock as /t, so moving between the board and a
 * page no longer swaps the entire interface underneath you.
 */
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { BookOpen, LogOut, Moon, SlidersHorizontal, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EASE, DUR } from '@/lib/motion';
import { useTheme } from '@/components/theme-provider';
import { useAuth } from '@/hooks/useAuth';
import qeMark from '@assets/qe-mark.svg';
import '@/styles/nexus.css';
import { PAGES, UTILITY_PAGES } from './nav-model';
import { MobileDock } from './mobile-dock';
import { CustomizePanel } from './customize-panel';
import { DesktopRail } from './desktop-rail';

export function NexusFrame({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const path = location.split('?')[0];
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const reduce = useReducedMotion();
  const [accountOpen, setAccountOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const nexusLight = theme === 'nexus-light';
  const page = [...PAGES, ...UTILITY_PAGES].find((p) => p.href === path)
    ?? (path.startsWith('/r') ? { href: path, label: 'Research', short: 'RESEARCH', icon: PAGES[0].icon } : undefined);
  const accountLabel = (user as any)?.firstName || (user as any)?.email?.split('@')[0] || 'Account';

  return (
    <div className={cn('qe-terminal nexus-vars flex min-h-[100dvh] w-full min-w-0 max-w-[100vw] flex-col', nexusLight && 'light')}>
      <DesktopRail activeTab={null} currentPath={path} />
      <header className="sticky top-0 z-20 lg:pl-[196px]">
        <div className="topbar" style={{ minHeight: 44 }}>
          <Link href="/today" className="brand lg:hidden" aria-label="Quant Edge Labs — home">
            <img className="brand-logo" src={qeMark} alt="" width={22} height={22} />
            <span className="brand-name">QUANTEDGE</span>
            <span className="brand-slash">{'//'}</span>
            <span className="brand-sub">{page ? page.short : 'TERMINAL'}</span>
          </Link>

          <div className="top-spacer" />

          <div className="relative">
            <button onClick={() => setAccountOpen((o) => !o)} aria-label="Open account menu" aria-expanded={accountOpen} className="user-chip">
              <div className="user-avatar">{accountLabel.slice(0, 1).toUpperCase()}</div>
              <span className="user-name hidden lg:inline">{accountLabel}</span>
            </button>
            <AnimatePresence>
              {accountOpen && (
                <motion.div
                  className="absolute right-0 top-10 z-40 w-52 rounded-lg border border-border/70 bg-card p-1.5 shadow-xl shadow-black/30"
                  initial={reduce ? false : { opacity: 0, y: -4, scale: .98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: .98 }}
                  transition={{ duration: DUR.fast, ease: EASE }}
                >
                  {[
                    { icon: Bell, label: 'Alerts', go: () => setLocation('/alerts') },
                    { icon: BookOpen, label: 'How to use', go: () => setLocation('/how-to') },
                    { icon: SlidersHorizontal, label: 'Display & layout', go: () => setCustomizeOpen(true) },
                    { icon: SlidersHorizontal, label: 'Settings', go: () => setLocation('/settings') },
                  ].map(({ icon: Icon, label, go }) => (
                    <button key={label} onClick={() => { setAccountOpen(false); go(); }} className="flex min-h-10 w-full items-center gap-2 rounded px-2.5 text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </button>
                  ))}
                  <button onClick={() => setTheme(nexusLight ? 'nexus' : 'nexus-light')} className="flex min-h-10 w-full items-center gap-2 rounded px-2.5 text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                    {nexusLight ? <Moon className="h-3.5 w-3.5" /> : <span className="grid h-3.5 w-3.5 place-items-center text-[11px] leading-none">☀</span>}
                    {nexusLight ? 'Dark mode' : 'Light mode'}
                  </button>
                  {user && (
                    <button onClick={() => { setAccountOpen(false); logout(); }} className="flex min-h-10 w-full items-center gap-2 rounded px-2.5 text-left font-mono text-[11px] uppercase tracking-wider text-[var(--trade-bearish)] transition-colors hover:bg-[var(--trade-bearish)]/10">
                      <LogOut className="h-3.5 w-3.5" /> Sign out
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* overflow-x contained HERE: one wide table (the GEX strike matrix, a filter
          row) used to widen the whole document, and iOS then zoomed the entire
          page out — dock included (measured: /r/META 1572px on a 393px phone). */}
      <main className="min-h-0 w-full min-w-0 flex-1 overflow-x-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-[196px]">
        {children}
      </main>

      <MobileDock activeTab={null} />
      <CustomizePanel open={customizeOpen} onClose={() => setCustomizeOpen(false)} />

      <footer className="bottombar hidden lg:flex lg:pl-[196px]" style={{ minHeight: 26 }}>
        <div className="bb-item"><span className="dot" /><b>{page ? page.short : 'PAGE'}</b></div>
        <div className="bb-spacer" />
        <div className="bb-item">Educational only · not investment advice</div>
      </footer>
    </div>
  );
}
