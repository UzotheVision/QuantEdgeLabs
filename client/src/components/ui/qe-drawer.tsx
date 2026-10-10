/**
 * QEDrawer — right slide-in for drill-ins.
 *
 * Used everywhere we want to expose detail without losing the parent context:
 *   - Click a ConfluenceRow → drawer with full GEX terminal panes
 *   - Click a ticker in Sector Hunt → drawer with quick research card
 *   - Click an alert → drawer with full alert details + actions
 *
 *   <QEDrawer open={open} onClose={() => setOpen(false)} title="CRDO" subtitle="Credo Technology">
 *     <Body />
 *   </QEDrawer>
 *
 * Backdrop click closes. ESC closes. Body scroll-locks while open.
 */
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface QEDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** "sm"=420px, "md"=560px, "lg"=720px */
  size?: 'sm' | 'md' | 'lg';
  /** Right slot in header (e.g. action buttons) */
  headerAction?: ReactNode;
  /** Set to false to suppress the close X button */
  showClose?: boolean;
  className?: string;
  children: ReactNode;
}

const SIZE_MAP = {
  sm: 'w-[420px] max-w-full',
  md: 'w-[560px] max-w-full',
  lg: 'w-[720px] max-w-full',
};

export function QEDrawer({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  headerAction,
  showClose = true,
  className,
  children,
}: QEDrawerProps) {
  // ESC to close + scroll lock while open
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      {/* Panel */}
      <div className={cn(
        'h-full bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200',
        SIZE_MAP[size],
        className,
      )}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20 shrink-0">
          <div className="min-w-0">
            <div className="text-base font-mono font-bold text-foreground truncate">{title}</div>
            {subtitle && (
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest truncate">
                {subtitle}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerAction}
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close drawer"
                className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
