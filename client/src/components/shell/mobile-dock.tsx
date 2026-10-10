/**
 * The bottom navigation — ONE component for the terminal and every page.
 * Four primary sections + More. More opens a sheet with the remaining
 * instruments and the standalone pages. Touch targets are ≥ 44pt (Apple HIG).
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EASE, DUR } from '@/lib/motion';
import { TABS, MOBILE_PRIMARY, MOBILE_MORE, PAGES, UTILITY_PAGES, MobileTabIcon, tabHref, type Tab } from './nav-model';

export function MobileDock({ activeTab, onTab }: {
  /** The terminal tab in view, or null on a standalone page. */
  activeTab: Tab | null;
  /** In the terminal, switch tabs in place; elsewhere omit it and the dock navigates. */
  onTab?: (t: Tab) => void;
}) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const reduce = useReducedMotion();
  const path = location.split('?')[0];
  const go = (t: Tab) => { setOpen(false); onTab ? onTab(t) : setLocation(tabHref(t)); };
  const goPage = (href: string) => { setOpen(false); setLocation(href); };
  const onPage = [...PAGES, ...UTILITY_PAGES].some((p) => p.href === path);
  const moreActive = open || (activeTab != null && MOBILE_MORE.includes(activeTab)) || onPage;

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/65 bg-background/[0.98] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <nav className="grid h-16 grid-cols-5 px-1" aria-label="Sections">
          {MOBILE_PRIMARY.map((id) => {
            const label = TABS.find((item) => item.id === id)?.label ?? id;
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-w-0 flex-col items-center justify-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors',
                  active ? 'text-[var(--brand-cyan)]' : 'text-muted-foreground',
                )}
              >
                {active && <motion.span layoutId="mobile-dock-active" className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-[var(--brand-cyan)]" />}
                <MobileTabIcon tab={id} />
                <span>{label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className={cn(
              'relative flex flex-col items-center justify-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors',
              moreActive ? 'text-[var(--brand-cyan)]' : 'text-muted-foreground',
            )}
          >
            {moreActive && !open && <motion.span layoutId="mobile-dock-active" className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-[var(--brand-cyan)]" />}
            <MoreHorizontal className="h-[18px] w-[18px]" />
            <span>More</span>
          </button>
        </nav>
      </div>

      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-label="More sections"
              className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 max-h-[70dvh] overflow-y-auto rounded-xl border border-border/75 bg-card shadow-2xl lg:hidden"
              initial={reduce ? false : { opacity: 0, y: 16, scale: .98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0, y: 12, scale: .98 }}
              transition={{ duration: DUR.fast, ease: EASE }}
            >
              <p className="border-b border-border/50 px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Instruments</p>
              <div className="grid grid-cols-3 gap-px bg-border/50">
                {MOBILE_MORE.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => go(id)}
                    className={cn(
                      'flex min-h-[72px] flex-col items-center justify-center gap-1.5 bg-card font-mono text-[10px] font-bold uppercase tracking-wider transition-colors',
                      activeTab === id ? 'text-[var(--brand-cyan)]' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <MobileTabIcon tab={id} />
                    {TABS.find((item) => item.id === id)?.label}
                  </button>
                ))}
              </div>
              <p className="border-y border-border/50 px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Pages</p>
              <div className="grid grid-cols-2 gap-px bg-border/50">
                {[...PAGES, ...UTILITY_PAGES].map((p) => {
                  const Icon = p.icon;
                  const active = path === p.href;
                  return (
                    <button
                      key={p.href}
                      type="button"
                      onClick={() => goPage(p.href)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-[52px] items-center gap-2.5 bg-card px-4 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors',
                        active ? 'text-[var(--brand-cyan)]' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
