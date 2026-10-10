/**
 * Reusable dynamic UX primitives.
 * Use these instead of always-rendered stacks.
 */

import { useState, ReactNode } from 'react';

// ─── ExpandableCard — click header to toggle body ────────
export function ExpandableCard({
  title,
  subtitle,
  defaultOpen = false,
  badge,
  children,
  onClick
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => { setOpen(o => !o); onClick?.(); }}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-zinc-800/30 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{title}</div>
            {subtitle && <div className="text-[10px] text-zinc-500 truncate">{subtitle}</div>}
          </div>
        </div>
        {badge && <div className="flex-shrink-0">{badge}</div>}
      </button>
      {open && <div className="px-3 pb-3 pt-1 border-t border-zinc-800/50">{children}</div>}
    </div>
  );
}

// ─── TimeAware — render only during market state ─────────
export function TimeAware({
  showWhen,
  marketState,
  children
}: {
  showWhen: ('PRE' | 'OPEN' | 'AFTER' | 'CLOSED')[];
  marketState: string;
  children: ReactNode;
}) {
  if (!showWhen.includes(marketState as any)) return null;
  return <>{children}</>;
}

// ─── SideDrawer — slide-in panel from right ──────────────
export function SideDrawer({
  open,
  onClose,
  title,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 w-full md:w-[420px] bg-zinc-900 border-l border-zinc-800 z-50 overflow-y-auto">
        <div className="flex items-center justify-between p-3 border-b border-zinc-800 sticky top-0 bg-zinc-900">
          <div className="text-sm font-bold">{title}</div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">✕</button>
        </div>
        <div className="p-3">{children}</div>
      </div>
    </>
  );
}

// ─── Skeleton-on-empty — shows loading shimmer when undefined ──
export function ShowIf({ has, fallback, children }: { has: any; fallback?: ReactNode; children: ReactNode }) {
  if (!has) return fallback ? <>{fallback}</> : null;
  return <>{children}</>;
}
