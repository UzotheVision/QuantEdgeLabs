/**
 * WhatsNew — sidebar bell badge + drawer + first-visit toast.
 *
 *   • Bell button (with red unread count) lives in the sidebar utility cluster.
 *   • Click → drawer slides in showing the changelog grouped by date,
 *     each entry with a "Go to feature" button.
 *   • On first visit after a new entry: small toast in bottom-right with
 *     "X new updates — click to view". Auto-dismisses in 8s.
 *   • Triggers: bell click, ⌘? from anywhere, clicking the toast.
 *
 *   Tracking: `localStorage.qe_changelog_seen` = id of most recent entry the
 *   user has acknowledged (set when drawer opens).
 */
import { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { useLocation } from 'wouter';
import { Bell, ArrowRight, X, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QEDrawer } from '@/components/ui/qe-drawer';
import { QECard } from '@/components/ui/qe-card';
import { QEPill } from '@/components/ui/qe-pill';
import { CHANGELOG, getUnreadEntries, getMostRecentId, type ChangeEntry, type ChangeTag } from '../../../shared/changelog';

const STORAGE_KEY = 'qe_changelog_seen';

const TAG_VARIANT: Record<ChangeTag, 'cyan' | 'gold' | 'bull' | 'warn' | 'ai' | 'default'> = {
  feature:  'cyan',
  fix:      'warn',
  design:   'gold',
  data:     'bull',
  workflow: 'cyan',
  ai:       'ai',
};

const TAG_LABEL: Record<ChangeTag, string> = {
  feature:  'NEW',
  fix:      'FIX',
  design:   'UI',
  data:     'DATA',
  workflow: 'FLOW',
  ai:       'AI',
};

// ─── Shared store (module-level) ─────────────────────────────────────
// All three surfaces (bell, toast, drawer) mount independently in
// different parts of the tree, so the open/seen state MUST be shared —
// otherwise clicking the bell flips its own local state while the drawer
// (a separate instance) stays closed forever. useSyncExternalStore keeps
// every consumer in sync off one source of truth.

function readSeen(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writeSeen(id: string) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
}

type WNState = { open: boolean; seenId: string | null };
let wnState: WNState = { open: false, seenId: readSeen() };
const wnListeners = new Set<() => void>();

function wnEmit() {
  for (const l of wnListeners) l();
}
function wnSet(patch: Partial<WNState>) {
  wnState = { ...wnState, ...patch };
  wnEmit();
}
function wnSubscribe(cb: () => void) {
  wnListeners.add(cb);
  return () => { wnListeners.delete(cb); };
}
function wnGetSnapshot() {
  return wnState;
}

export function useWhatsNew() {
  const state = useSyncExternalStore(wnSubscribe, wnGetSnapshot, wnGetSnapshot);

  const unread = getUnreadEntries(state.seenId);
  const unreadCount = unread.length;

  const handleOpen = useCallback(() => {
    const latest = getMostRecentId();
    if (latest) writeSeen(latest);
    wnSet({ open: true, seenId: latest ?? wnState.seenId });
  }, []);

  const handleClose = useCallback(() => wnSet({ open: false }), []);

  // ⌘? shortcut to open — registered once at module level would be ideal,
  // but keeping it here is fine now that handleOpen mutates shared state.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '?') {
        e.preventDefault();
        handleOpen();
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [handleOpen]);

  return { open: state.open, unread, unreadCount, handleOpen, handleClose };
}

// ─── Bell button (for sidebar) ──────────────────────────────────────

export function WhatsNewBell({ collapsed }: { collapsed?: boolean }) {
  const { unreadCount, handleOpen } = useWhatsNew();
  return (
    <button
      type="button"
      onClick={handleOpen}
      title={`What's new${unreadCount > 0 ? ` — ${unreadCount} new` : ''}  (⌘?)`}
      className={cn(
        'relative flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-all text-[13px] w-full text-left',
        'group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
        unreadCount > 0
          ? 'text-[var(--brand-cyan)] hover:bg-[var(--brand-cyan)]/5'
          : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/40',
      )}
      data-testid="nav-whats-new"
    >
      <Bell className={cn('w-4 h-4 shrink-0', unreadCount > 0 && 'text-[var(--brand-cyan)]')} />
      <span className="truncate font-mono uppercase tracking-wider text-[11px] group-data-[collapsible=icon]:hidden">
        What's New
      </span>
      {unreadCount > 0 && (
        <span
          className={cn(
            'absolute right-1 top-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--brand-cyan)] text-black text-[9px] font-bold font-mono flex items-center justify-center',
            // In icon-collapsed mode shrink to a corner dot (no number, no overflow)
            'group-data-[collapsible=icon]:right-0.5 group-data-[collapsible=icon]:top-0.5 group-data-[collapsible=icon]:w-2 group-data-[collapsible=icon]:h-2 group-data-[collapsible=icon]:min-w-0 group-data-[collapsible=icon]:px-0',
          )}
        >
          <span className="group-data-[collapsible=icon]:hidden">{unreadCount}</span>
        </span>
      )}
    </button>
  );
}

// ─── Toast (auto-shown on first visit with unread) ──────────────────

export function WhatsNewToast() {
  const { unreadCount, handleOpen } = useWhatsNew();
  const [dismissed, setDismissed] = useState(false);

  // A first-time visitor has never seen the changelog, so EVERY entry counts
  // as unread ("34 new updates") — noise on a first impression, and on phones
  // it covers the page. Baseline them silently; returning users still get it.
  const [firstVisit] = useState(() => wnState.seenId == null);
  useEffect(() => {
    if (!firstVisit) return;
    const latest = getMostRecentId();
    if (latest) { writeSeen(latest); wnSet({ seenId: latest }); }
  }, [firstVisit]);

  // Auto-dismiss after 10s
  useEffect(() => {
    if (unreadCount === 0 || dismissed) return;
    const t = setTimeout(() => setDismissed(true), 10_000);
    return () => clearTimeout(t);
  }, [unreadCount, dismissed]);

  if (firstVisit || unreadCount === 0 || dismissed) return null;

  return (
    <button
      type="button"
      onClick={() => { handleOpen(); setDismissed(true); }}
      className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg bg-card border border-[var(--brand-cyan)]/40 shadow-2xl hover:bg-[var(--brand-cyan)]/5 transition-all group animate-in slide-in-from-bottom-4 duration-300"
    >
      <Sparkles className="w-4 h-4 text-[var(--brand-cyan)]" />
      <div className="text-left">
        <div className="text-xs font-mono font-bold text-foreground">
          {unreadCount} new {unreadCount === 1 ? 'update' : 'updates'}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          Click to view · auto-dismiss in 10s
        </div>
      </div>
      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-[var(--brand-cyan)] group-hover:translate-x-0.5 transition-all" />
      <span
        role="button"
        onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
        className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted/40"
        title="Dismiss"
      >
        <X className="w-3 h-3" />
      </span>
    </button>
  );
}

// ─── Drawer (the actual list) ────────────────────────────────────────

export function WhatsNewDrawer() {
  const { open, handleClose } = useWhatsNew();
  const [, setLocation] = useLocation();

  const grouped = groupByDate(CHANGELOG);

  const goTo = (link?: string) => {
    if (link) {
      handleClose();
      setLocation(link);
    }
  };

  return (
    <QEDrawer
      open={open}
      onClose={handleClose}
      title="What's New"
      subtitle={`${CHANGELOG.length} updates · press ⌘? to reopen`}
      size="md"
    >
      <div className="p-3 space-y-4">
        {grouped.map(([date, entries]) => (
          <div key={date}>
            <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-2 px-1">
              {formatDate(date)}
            </div>
            <div className="space-y-2">
              {entries.map(e => (
                <QECard key={e.id} variant="default" padding="md" className="hover:border-[var(--brand-cyan)]/30 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="text-[13px] font-mono font-bold text-foreground leading-tight">
                      {e.title}
                    </h3>
                    <QEPill variant={TAG_VARIANT[e.tag]}>{TAG_LABEL[e.tag]}</QEPill>
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground leading-relaxed mb-2">
                    {e.blurb}
                  </p>
                  {e.link && (
                    <button
                      type="button"
                      onClick={() => goTo(e.link)}
                      className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--brand-cyan)] hover:underline"
                    >
                      {e.linkLabel ?? 'Go to feature'}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </QECard>
              ))}
            </div>
          </div>
        ))}
        <div className="text-center text-[9px] font-mono text-muted-foreground pt-2 border-t border-border/30">
          That's it for now. Check back when the cyan badge lights up.
        </div>
      </div>
    </QEDrawer>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function groupByDate(entries: ChangeEntry[]): [string, ChangeEntry[]][] {
  const map = new Map<string, ChangeEntry[]>();
  for (const e of entries) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date)!.push(e);
  }
  return Array.from(map.entries());
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const isToday = d.toDateString() === today.toDateString();
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const dayName = d.toLocaleDateString(undefined, { weekday: 'long' });
  const month = d.toLocaleDateString(undefined, { month: 'long' });
  const dayNum = d.getDate();
  if (isToday) return `Today · ${month} ${dayNum}`;
  if (isYesterday) return `Yesterday · ${month} ${dayNum}`;
  return `${dayName} · ${month} ${dayNum}`;
}
