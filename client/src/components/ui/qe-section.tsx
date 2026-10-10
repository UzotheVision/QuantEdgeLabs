/**
 * QESection — header + body, optionally collapsible.
 *
 * Collapsible stacked-panel block, QE-styled variant of the ui/ primitive layer.
 *
 *   <QESection title="Top Plays" subtitle="ranked by dealer positioning">
 *     <Body />
 *   </QESection>
 *
 *   <QESection
 *     title="Sectors · 13"
 *     collapsible
 *     defaultOpen={false}
 *     action={<button>Refresh</button>}
 *   >
 *     <Body />
 *   </QESection>
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QECard, type QECardVariant } from './qe-card';

export interface QESectionProps {
  title: string;
  subtitle?: string;
  /** Right-aligned action area (button, count, refresh icon) */
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  variant?: QECardVariant;
  /** Set to false to use no card chrome (for nested sections) */
  bordered?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function QESection({
  title,
  subtitle,
  action,
  collapsible = false,
  defaultOpen = true,
  variant = 'default',
  bordered = true,
  className,
  bodyClassName,
  children,
}: QESectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = !collapsible || open;

  const Header = (
    <div
      className={cn(
        'flex items-center justify-between gap-3',
        collapsible && 'cursor-pointer select-none',
      )}
      onClick={() => collapsible && setOpen(!open)}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-foreground">
            {title}
          </span>
          {subtitle && (
            <span className="text-[9px] font-mono text-muted-foreground">
              · {subtitle}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {action}
        {collapsible && (
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        )}
      </div>
    </div>
  );

  if (!bordered) {
    return (
      <div className={cn('space-y-2', className)}>
        {Header}
        {isOpen && <div className={bodyClassName}>{children}</div>}
      </div>
    );
  }

  return (
    <QECard variant={variant} padding="none" className={cn('overflow-hidden', className)}>
      <div className={cn('px-3 py-2 border-b border-border/40', !isOpen && 'border-b-0')}>
        {Header}
      </div>
      {isOpen && <div className={cn('p-3', bodyClassName)}>{children}</div>}
    </QECard>
  );
}
