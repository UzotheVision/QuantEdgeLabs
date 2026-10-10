/**
 * QECard — QE-styled card variant of the ui/ primitive layer.
 *
 * All page content should be composed of QECard. Variants pull from
 * `componentStyles.card.*` (see lib/design-tokens.ts) which in turn
 * pull from CSS variables (single source of truth in index.css).
 *
 * Stop hand-rolling `bg-zinc-900/40 border border-zinc-800 rounded-lg`.
 * Use <QECard variant="glass"> instead.
 */
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { componentStyles } from '@/lib/design-tokens';

export type QECardVariant =
  | 'default'
  | 'glass'
  | 'elevated'
  | 'interactive'
  | 'feature'
  | 'dense'
  | 'inset'
  | 'accent-cyan'
  | 'accent-teal'
  | 'accent-gold'
  | 'accent-bull'
  | 'accent-bear';

const VARIANT_MAP: Record<QECardVariant, string> = {
  'default':       componentStyles.card.default,
  'glass':         componentStyles.card.glass,
  'elevated':      componentStyles.card.elevated,
  'interactive':   componentStyles.card.interactive,
  'feature':       componentStyles.card.feature,
  'dense':         componentStyles.card.dense,
  'inset':         componentStyles.card.inset,
  'accent-cyan':   componentStyles.card.accentCyan,
  'accent-teal':   componentStyles.card.accentTeal,
  'accent-gold':   componentStyles.card.accentGold,
  'accent-bull':   componentStyles.card.accentBullish,
  'accent-bear':   componentStyles.card.accentBearish,
};

export interface QECardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: QECardVariant;
  /** Padding preset — most pages should use 'md' (default). 'none' for nested. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const PADDING_MAP = {
  none: '',
  sm: 'p-2',
  md: 'p-3',
  lg: 'p-4',
};

export const QECard = forwardRef<HTMLDivElement, QECardProps>(
  ({ variant = 'default', padding = 'md', className, children, ...rest }, ref) => (
    <div ref={ref} className={cn(VARIANT_MAP[variant], PADDING_MAP[padding], className)} {...rest}>
      {children}
    </div>
  ),
);
QECard.displayName = 'QECard';
