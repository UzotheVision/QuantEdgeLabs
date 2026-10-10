/**
 * CANON · VALUE
 *
 * Zero, missing and not-measurable are three different truths and this terminal
 * renders them identically in places. That is a correctness bug wearing a design
 * costume: on a trading screen, "0.0%" and "we don't know" lead to opposite
 * decisions, and a blank cell reads as neither.
 *
 * The distinction matters most where it already bit us. The Flow tab reported
 * bullish-vs-bearish premium that was really call-vs-put premium, because an
 * unmeasured direction was rendered the same as a measured one. Flow now models
 * this properly — NOT MEASURED slots, · UNVERIFIED rows, a "direction measured %"
 * stat. This promotes that pattern rather than reinventing it.
 *
 * Four states, deliberately:
 *
 *   value        a real measurement            renders the number
 *   zero         genuinely zero                renders 0, styled as a real value
 *   missing      we have no data yet           renders — , muted
 *   unmeasurable we CANNOT know from this feed renders NOT MEASURED, italic
 *
 * `missing` and `unmeasurable` are not synonyms. Missing is a gap that better
 * plumbing could fill. Unmeasurable is a statement about the data source, and it
 * does not go away by waiting — a chain snapshot will never tell you who was
 * aggressive. Collapsing them hides which problem you have.
 */
import { cn } from '@/lib/utils';

export type ValueState = 'value' | 'zero' | 'missing' | 'unmeasurable';

export function valueStateOf(
  n: number | null | undefined,
  opts: { unmeasurable?: boolean } = {},
): ValueState {
  if (opts.unmeasurable) return 'unmeasurable';
  if (n === null || n === undefined || !Number.isFinite(n)) return 'missing';
  return n === 0 ? 'zero' : 'value';
}

export function CanonValue({
  value,
  format,
  unmeasurable,
  reason,
  className,
  color,
  strong,
}: {
  value: number | null | undefined;
  /** Renderer for a real number. Never called for missing/unmeasurable. */
  format?: (n: number) => string;
  /** True when this feed structurally cannot produce the number. */
  unmeasurable?: boolean;
  /** Shown on hover — why it cannot be measured. Worth filling in. */
  reason?: string;
  className?: string;
  color?: string;
  strong?: boolean;
}) {
  const state = valueStateOf(value, { unmeasurable });
  const base = cn('font-mono tabular-nums', strong && 'font-bold', className);

  if (state === 'unmeasurable') {
    return (
      <span
        className={cn(base, 'italic text-muted-foreground')}
        title={reason ?? 'This feed cannot measure this value'}
      >
        NOT MEASURED
      </span>
    );
  }

  if (state === 'missing') {
    return (
      <span className={cn(base, 'text-muted-foreground')} title="No data">
        —
      </span>
    );
  }

  // A real zero is a measurement and is styled like one. Muting it would make it
  // look like absent data, which is the confusion this component exists to end.
  const text = format ? format(value as number) : String(value);
  return (
    <span className={base} style={color ? { color } : undefined}>
      {text}
    </span>
  );
}

/**
 * Coverage line — "measurable X of Y (Z%)".
 *
 * Every percentage on a performance surface needs its denominator beside it. The
 * platform previously showed a 73.3% win rate next to its own counts of 0 wins
 * and 1 loss, because the rate and the counts came from different populations.
 */
export function CanonCoverage({
  measurable,
  total,
  label = 'Measurable',
  breakdown,
  className,
}: {
  measurable: number;
  total: number;
  label?: string;
  /** e.g. "18 unit-corrupted · 30 never entered". Rendered verbatim. */
  breakdown?: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.round((measurable / total) * 100) : 0;
  return (
    <div className={cn('font-mono text-label leading-relaxed text-muted-foreground', className)}>
      <span className="uppercase tracking-wider">{label}:</span>{' '}
      <span className="tabular-nums text-foreground/80">
        {measurable} of {total} ({pct}%)
      </span>
      {breakdown && <span className="text-muted-foreground"> · {breakdown}</span>}
    </div>
  );
}
