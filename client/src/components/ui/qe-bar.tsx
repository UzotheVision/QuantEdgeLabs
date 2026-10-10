/**
 * QEBar — horizontal progress / score bar.
 *
 * Single-segment:
 *   <QEBar value={72} max={100} tone="cyan" label="Confidence" valueRight />
 *
 * Multi-segment (regime distribution etc.):
 *   <QEBar segments={[
 *     { value: 12, color: 'var(--gex-positive)' },
 *     { value: 5,  color: 'var(--gex-negative)' },
 *     { value: 3,  color: 'var(--gex-flip)' },
 *   ]} />
 */
import { cn } from '@/lib/utils';

export type QEBarTone = 'cyan' | 'bull' | 'bear' | 'gold' | 'warn' | 'muted' | 'auto';
export type QEBarSize = 'xs' | 'sm' | 'md';

const TONE_COLOR: Record<QEBarTone, string> = {
  cyan:  'var(--brand-cyan)',
  bull:  'var(--trade-bullish)',
  bear:  'var(--trade-bearish)',
  gold:  'var(--brand-gold)',
  warn:  'var(--trade-neutral)',
  muted: 'var(--muted-foreground)',
  auto:  'var(--brand-cyan)',
};

const HEIGHT_MAP: Record<QEBarSize, string> = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2',
};

export interface BarSegment {
  value: number;
  color: string;
  label?: string;
}

export interface QEBarProps {
  /** Single-segment value */
  value?: number;
  /** Single-segment max */
  max?: number;
  tone?: QEBarTone;
  /** Multi-segment override — replaces value/max */
  segments?: BarSegment[];
  size?: QEBarSize;
  /** Label rendered above the bar */
  label?: string;
  /** Show value on the right of label */
  valueRight?: boolean;
  /** Suffix for value display ("%", "pts", etc.) */
  valueUnit?: string;
  className?: string;
}

export function QEBar({
  value = 0,
  max = 100,
  tone = 'cyan',
  segments,
  size = 'sm',
  label,
  valueRight,
  valueUnit = '',
  className,
}: QEBarProps) {
  const barInner = segments && segments.length > 0
    ? <MultiSegment segments={segments} />
    : <SingleSegment value={value} max={max} tone={tone} />;

  return (
    <div className={cn('w-full', className)}>
      {(label || valueRight) && (
        <div className="flex items-center justify-between mb-0.5 text-[9px] font-mono uppercase tracking-widest">
          <span className="text-muted-foreground">{label}</span>
          {valueRight && (
            <span className="text-foreground tabular-nums font-bold">
              {value}{valueUnit}
            </span>
          )}
        </div>
      )}
      <div className={cn('rounded-full overflow-hidden bg-muted/40 flex', HEIGHT_MAP[size])}>
        {barInner}
      </div>
    </div>
  );
}

function SingleSegment({ value, max, tone }: { value: number; max: number; tone: QEBarTone }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div
      className="h-full transition-all duration-300"
      style={{ width: `${pct}%`, backgroundColor: TONE_COLOR[tone], opacity: 0.85 }}
    />
  );
}

function MultiSegment({ segments }: { segments: BarSegment[] }) {
  const total = Math.max(1, segments.reduce((sum, s) => sum + s.value, 0));
  return (
    <>
      {segments.map((s, i) => (
        <div
          key={i}
          className="h-full"
          style={{
            width: `${(s.value / total) * 100}%`,
            backgroundColor: s.color,
            opacity: 0.85,
          }}
          title={s.label}
        />
      ))}
    </>
  );
}
