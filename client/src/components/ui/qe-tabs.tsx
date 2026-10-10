/**
 * QETabs — horizontal sub-navigation pill strip.
 *
 * QE-styled pill-strip tabs, one variant of the ui/ Tabs primitive. Used at top of every workflow
 * (PULSE, HUNT, RESEARCH, POSITIONS, JOURNAL) and nested within RESEARCH
 * for per-symbol drill-ins.
 *
 *   <QETabs
 *     items={[
 *       { id: 'tape', label: 'Tape' },
 *       { id: 'rotation', label: 'Rotation', count: 5, hint: 'Layer cycle stages' },
 *       { id: 'earnings', label: 'Earnings', disabled: true },
 *     ]}
 *     active="tape"
 *     onChange={setActive}
 *   />
 *
 * Variants:
 *   - 'cyan' (default) — primary nav
 *   - 'gold'           — secondary (sort selectors etc.)
 *   - 'subtle'         — for tertiary in-card tabs
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type QETabsVariant = 'cyan' | 'gold' | 'subtle';
export type QETabsSize = 'sm' | 'md';

export interface QETabItem<T extends string = string> {
  id: T;
  label: string;
  /** Number shown after label as `· 12` */
  count?: number;
  /** Tooltip on hover */
  hint?: string;
  /** Renders disabled / strikethrough */
  disabled?: boolean;
  /** Optional leading icon */
  icon?: ReactNode;
  /**
   * Optional cluster label. When ANY item has a group, tabs render as labeled
   * clusters (tiny group caption + subtle divider between clusters) instead of a
   * flat strip — calms a long tab bar without nesting navigation. Consecutive
   * items sharing a group string are drawn together, in declaration order.
   */
  group?: string;
}

export interface QETabsProps<T extends string = string> {
  items: readonly QETabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  variant?: QETabsVariant;
  size?: QETabsSize;
  /** Optional left-side label e.g. "VIEW" */
  prefixLabel?: string;
  /** Slot rendered after the tabs (right-aligned) */
  rightSlot?: ReactNode;
  className?: string;
}

// Active tab — filled accent chip with a soft outer glow (premium segmented look).
const ACTIVE_VARIANT: Record<QETabsVariant, string> = {
  cyan:   'text-[var(--brand-cyan)] bg-[var(--brand-cyan)]/15 ring-1 ring-[var(--brand-cyan)]/40 shadow-[0_0_12px_-2px_var(--brand-cyan)]',
  gold:   'text-[var(--brand-gold)] bg-[var(--brand-gold)]/15 ring-1 ring-[var(--brand-gold)]/40 shadow-[0_0_12px_-2px_var(--brand-gold)]',
  subtle: 'text-foreground bg-foreground/10 ring-1 ring-foreground/20',
};

const SIZE_PADDING: Record<QETabsSize, string> = {
  sm: 'px-2.5 py-1 text-[9px]',
  md: 'px-3 py-1.5 text-[10px]',
};

export function QETabs<T extends string = string>({
  items,
  active,
  onChange,
  variant = 'cyan',
  size = 'md',
  prefixLabel,
  rightSlot,
  className,
}: QETabsProps<T>) {
  const renderTab = (item: QETabItem<T>) => (
    <button
      key={item.id}
      type="button"
      disabled={item.disabled}
      onClick={() => !item.disabled && onChange(item.id)}
      title={item.hint}
      className={cn(
        'font-mono font-bold uppercase rounded-md transition-all duration-150 inline-flex items-center gap-1.5 cursor-pointer',
        SIZE_PADDING[size],
        item.disabled && 'opacity-40 cursor-not-allowed text-muted-foreground',
        !item.disabled && active === item.id
          ? ACTIVE_VARIANT[variant]
          : !item.disabled && 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]',
      )}
    >
      {item.icon}
      {item.label}
      {typeof item.count === 'number' && !item.disabled && (
        <span className="text-muted-foreground font-normal">·{item.count}</span>
      )}
      {item.disabled && (
        <span className="ml-0.5 text-[9px] font-mono uppercase tracking-widest text-muted-foreground px-1 py-0 rounded border border-border/30">
          soon
        </span>
      )}
    </button>
  );

  // Grouped layout: when any item declares a group, draw labeled clusters with a
  // faint divider between them. Calms a long tab bar without nesting navigation.
  const grouped = items.some((i) => i.group);

  if (grouped) {
    const clusters: { group: string; items: QETabItem<T>[] }[] = [];
    for (const item of items) {
      const g = item.group ?? '';
      const last = clusters[clusters.length - 1];
      if (last && last.group === g) last.items.push(item);
      else clusters.push({ group: g, items: [item] });
    }
    return (
      <div className={cn('flex max-w-full items-center gap-1 flex-wrap rounded-lg border border-border/40 bg-foreground/[0.03] p-1', className)}>
        {prefixLabel && (
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mx-1.5 self-center">
            {prefixLabel}
          </span>
        )}
        {clusters.map((cluster, ci) => (
          <div key={cluster.group || ci} className="flex min-w-0 flex-wrap items-center gap-1">
            {ci > 0 && <span className="mx-1 h-5 w-px bg-border/40" aria-hidden />}
            {cluster.group && (
              <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground mr-0.5 self-center select-none">
                {cluster.group}
              </span>
            )}
            {cluster.items.map(renderTab)}
          </div>
        ))}
        {rightSlot && <div className="ml-auto">{rightSlot}</div>}
      </div>
    );
  }

  return (
    <div className={cn('flex max-w-full items-center gap-1 flex-wrap rounded-lg border border-border/40 bg-foreground/[0.03] p-1', className)}>
      {prefixLabel && (
        <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mx-1.5">
          {prefixLabel}
        </span>
      )}
      {items.map(renderTab)}
      {rightSlot && <div className="ml-auto">{rightSlot}</div>}
    </div>
  );
}
