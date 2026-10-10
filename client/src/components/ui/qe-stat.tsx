/**
 * QEStat — label + big tabular value + optional delta.
 *
 * QE-styled metric tile variant of the ui/ primitive layer.
 * Used everywhere we show a number: NET GEX, P&L, breadth, count, etc.
 *
 *   <QEStat label="NET GEX" value="+$4.18B" delta={+22} tone="bull" />
 *   <QEStat label="VIX"      value="18.3"      tone="muted" size="sm" />
 *
 * Tone drives color via CSS vars, never raw Tailwind.
 */
import { cn } from '@/lib/utils';

export type QEStatTone = 'default' | 'bull' | 'bear' | 'cyan' | 'gold' | 'muted' | 'warn';
export type QEStatSize = 'sm' | 'md' | 'lg' | 'xl';

const TONE_MAP: Record<QEStatTone, string> = {
  default: 'text-foreground',
  bull:    'text-[var(--trade-bullish)]',
  bear:    'text-[var(--trade-bearish)]',
  cyan:    'text-[var(--brand-cyan)]',
  gold:    'text-[var(--brand-gold)]',
  muted:   'text-muted-foreground',
  warn:    'text-[var(--trade-neutral)]',
};

const SIZE_MAP: Record<QEStatSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-2xl',
};

export interface QEStatProps {
  label: string;
  value: string | number;
  /** Numeric delta — auto-formatted with arrow + sign + tone */
  delta?: number;
  /** Force a tone instead of inferring from delta sign */
  tone?: QEStatTone;
  /** Suffix appended to the delta (e.g. "%" or "bps") */
  deltaUnit?: string;
  size?: QEStatSize;
  /** Optional micro-caption under value */
  caption?: string;
  className?: string;
}

export function QEStat({
  label,
  value,
  delta,
  deltaUnit = '%',
  tone,
  size = 'md',
  caption,
  className,
}: QEStatProps) {
  const inferredTone: QEStatTone = tone
    ?? (typeof delta === 'number' ? (delta >= 0 ? 'bull' : 'bear') : 'default');
  const valueTone = TONE_MAP[inferredTone];

  return (
    <div className={cn('flex flex-col gap-0.5 min-w-0', className)}>
      <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground truncate">
        {label}
      </div>
      <div className={cn('font-mono font-bold tabular-nums truncate', SIZE_MAP[size], valueTone)}>
        {value}
        {typeof delta === 'number' && (
          <span className={cn('ml-1.5 text-[10px] font-bold', delta >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]')}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(deltaUnit === '%' ? 1 : 2)}{deltaUnit}
          </span>
        )}
      </div>
      {caption && (
        <div className="text-[9px] font-mono text-muted-foreground truncate">{caption}</div>
      )}
    </div>
  );
}

/**
 * QEStatStrip — horizontal row of stats with vertical dividers.
 * Used for market tape, P&L row, KPI bar, etc.
 */
export function QEStatStrip({
  stats,
  className,
}: {
  stats: QEStatProps[];
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-4 flex-wrap', className)}>
      {stats.map((s, i) => (
        <div key={`${s.label}-${i}`} className="flex items-center gap-4">
          {i > 0 && <div className="w-px h-6 bg-border/40" />}
          <QEStat {...s} />
        </div>
      ))}
    </div>
  );
}
