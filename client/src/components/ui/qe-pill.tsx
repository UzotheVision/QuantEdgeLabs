/**
 * QEPill — small inline status badge.
 *
 * Variants pull from `componentStyles.badge.*` for token consistency.
 *
 *   <QEPill variant="bull">LONG</QEPill>
 *   <QEPill variant="cyan" icon={<Activity className="w-2.5 h-2.5" />}>LIVE</QEPill>
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { componentStyles } from '@/lib/design-tokens';

export type QEPillVariant =
  | 'default'
  | 'bull'
  | 'bear'
  | 'warn'
  | 'cyan'
  | 'gold'
  | 'ai'
  | 'live'
  | 'delayed'
  | 'closed'
  | 'accent'   // brand teal
  | 'success'
  | 'error';

const VARIANT_MAP: Record<QEPillVariant, string> = {
  default: componentStyles.badge.default,
  bull:    componentStyles.badge.bullish,
  bear:    componentStyles.badge.bearish,
  warn:    componentStyles.badge.warning,
  cyan:    componentStyles.badge.cyan,
  gold:    componentStyles.badge.gold,
  ai:      componentStyles.badge.ai,
  live:    componentStyles.badge.live,
  delayed: componentStyles.badge.delayed,
  closed:  componentStyles.badge.closed,
  accent:  componentStyles.badge.accent,
  success: componentStyles.badge.success,
  error:   componentStyles.badge.error,
};

export interface QEPillProps {
  variant?: QEPillVariant;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function QEPill({ variant = 'default', icon, className, children }: QEPillProps) {
  return (
    <span className={cn(VARIANT_MAP[variant], 'inline-flex items-center gap-1', className)}>
      {icon}
      {children}
    </span>
  );
}
