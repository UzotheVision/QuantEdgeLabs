/**
 * CHART TEMPLATES — the reference site's data visuals, rebuilt to their spec and
 * made reusable across the platform.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THEIR CHARTS ACTUALLY DO
 * ═══════════════════════════════════════════════════════════════════════════
 * Two things I had matched by eye and got wrong, now read from their stylesheet:
 *
 *   .rh-chart .grid       stroke-dasharray: 4 4          ← DASHED gridlines. I
 *                                                          had drawn them solid,
 *                                                          which makes the grid
 *                                                          compete with the data.
 *   .rh-chart .price-line filter: drop-shadow(0 0 6px A)  ← the line GLOWS. This
 *                                                          is most of why their
 *                                                          chart reads as lit
 *                                                          rather than printed.
 *
 * And the matrix is not a continuous alpha ramp, which is what I built the first
 * time. It is QUANTISED into three levels:
 *
 *   .fv3-cell     background A/14%,  border A/22%
 *   .fv3-cell.l2  background A/36%,  border A/45%, box-shadow 0 0 6px
 *   .fv3-cell.l3  background A,      border A,     box-shadow 0 0 10px + 0 0 22px
 *                 plus a `:after` running @keyframes fv3pulse forever
 *   .fv3-cell:hover  scale(1.18), z-index 3, and a mono tooltip above it
 *
 * Quantising is the better call and it is worth saying why: a continuous ramp
 * asks the eye to compare two similar alphas, which humans cannot do. Three
 * levels can be counted at a glance. The precise value goes in the tooltip,
 * where it can actually be read. I had built the ramp; this replaces it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOUSE RULE THESE INHERIT
 * ═══════════════════════════════════════════════════════════════════════════
 * Every chart here renders nothing — not a placeholder curve, not a zero grid —
 * when it has no real series. A chart that draws something when it knows nothing
 * is the one bug in this file that would actually cost money.
 */
import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { type Tone, TONE_VAR } from './kit';

// ═════════════════════════════════════════════════════════════════════════════
// MATRIX — quantised heat grid with row labels, an axis, and hover tooltips
// ═════════════════════════════════════════════════════════════════════════════

export interface MatrixCell {
  /** 0 = no reading. Sign is meaningful: negative renders in the `negative` tone. */
  value: number;
  /** Shown in the tooltip. Say what the number means, not just the number. */
  tip: string;
}
export interface MatrixRow {
  label: string;
  /** Marks the row as the one to look at — label turns accent and the pip lights. */
  emphasis?: boolean;
  cells: MatrixCell[];
}

/**
 * Cut points are on the ABSOLUTE value, relative to the loudest reading present.
 * Fixed thresholds would make a quiet day render as an empty grid and a loud one
 * as a solid block; scaling to the frame keeps the three levels informative in
 * both.
 */
function level(v: number, peak: number): 0 | 1 | 2 | 3 {
  if (v === 0 || peak === 0) return 0;
  const r = Math.abs(v) / peak;
  return r >= 0.66 ? 3 : r >= 0.33 ? 2 : 1;
}

export function Matrix({
  rows, axis, nowIndex, tone = 'structural', negativeTone = 'bear',
  labelWidth = 120, maxCell = 30, className,
}: {
  rows: MatrixRow[];
  /** Column headings. Must be the same length as each row's cells. */
  axis?: string[];
  /** Index of the "current" column — rendered accent and bold. */
  nowIndex?: number;
  tone?: Tone; negativeTone?: Tone; labelWidth?: number;
  /**
   * Cell edge cap in px. Their matrix sits in a ~760px column where `1fr` +
   * aspect-square lands near 30px. Dropped into a 1600px board the same rule
   * produces 100px tiles: the grid stops reading as a heat field and starts
   * reading as a bar chart with no bars. Columns are therefore capped rather
   * than fluid, and the grid stays left-aligned instead of stretching.
   */
  maxCell?: number;
  className?: string;
}) {
  const cols = rows[0]?.cells.length ?? 0;
  const peak = useMemo(
    () => Math.max(0, ...rows.flatMap((r) => r.cells.map((c) => Math.abs(c.value)))),
    [rows],
  );
  if (!rows.length || !cols) return null;

  const grid = { gridTemplateColumns: `${labelWidth}px repeat(${cols}, minmax(0, ${maxCell}px))` };

  return (
    <div className={cn('min-w-0', className)}>
      <div className="relative z-[2] grid gap-1.5" style={grid}>
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <span
              className={cn(
                'flex items-center gap-2 self-center border-r border-dashed border-border pr-3',
                'font-mono text-[11px] tracking-[0.06em]',
                row.emphasis ? 'text-[color:var(--qk-tone)]' : 'text-muted-foreground',
              )}
              style={{ ['--qk-tone' as string]: TONE_VAR[tone] }}
            >
              <i
                aria-hidden
                className="h-[5px] w-[5px] shrink-0 rounded-full"
                style={
                  row.emphasis
                    ? { background: TONE_VAR[tone], boxShadow: `0 0 6px ${TONE_VAR[tone]}` }
                    : { background: 'var(--muted-foreground)', opacity: 0.4 }
                }
              />
              <span className="truncate" title={row.label}>{row.label}</span>
            </span>

            {row.cells.map((cell, i) => (
              <MatrixCellEl
                key={i}
                cell={cell}
                lvl={level(cell.value, peak)}
                tone={cell.value < 0 ? negativeTone : tone}
              />
            ))}
          </div>
        ))}
      </div>

      {axis && axis.length === cols && (
        <div
          className="relative z-[2] mt-3.5 grid gap-1.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground"
          style={grid}
        >
          <span />
          {axis.map((a, i) => (
            <span
              key={i}
              className={cn('truncate text-center', i === nowIndex && 'font-semibold text-[color:var(--qk-now)]')}
              style={{ ['--qk-now' as string]: TONE_VAR[tone] }}
            >
              {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MatrixCellEl({ cell, lvl, tone }: { cell: MatrixCell; lvl: 0 | 1 | 2 | 3; tone: Tone }) {
  const c = TONE_VAR[tone];
  const fill = [0.03, 0.14, 0.36, 1][lvl];
  const edge = [0.06, 0.22, 0.45, 1][lvl];
  return (
    <span
      className={cn(
        'group/cell relative aspect-square rounded-[2px] border transition-all duration-[250ms]',
        'hover:z-[3] hover:scale-[1.18] motion-reduce:hover:scale-100',
      )}
      style={{
        background: `color-mix(in srgb, ${c} ${fill * 100}%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} ${edge * 100}%, transparent)`,
        boxShadow: lvl === 3 ? `0 0 10px color-mix(in srgb, ${c} 60%, transparent)` : undefined,
      }}
    >
      {/* Level 3 breathes, so the loudest readings find your eye without colour. */}
      {lvl === 3 && <i aria-hidden className="qk-cell-pulse absolute inset-0 rounded-[2px]" />}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-[4] -translate-x-1/2 translate-y-1 whitespace-nowrap',
          'rounded-[3px] border bg-popover px-2 py-1.5 font-mono text-[10px] tracking-[0.04em] text-popover-foreground',
          'opacity-0 transition-[opacity,transform] duration-[180ms] group-hover/cell:translate-y-0 group-hover/cell:opacity-100',
        )}
        style={{ borderColor: `color-mix(in srgb, ${c} 40%, transparent)` }}
      >
        {cell.tip}
      </span>
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SPARK — the 64px inline chart, for a table cell or a card corner
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Their `.tp-chart-mini`: a bordered 64px box with a line and an optional price
 * tag pinned top-right. Small enough to sit in a row without becoming the row.
 *
 * Direction sets the tone by default — a series that ended lower renders clay —
 * because a sparkline whose colour says nothing wastes the one channel it has.
 */
export function Spark({
  series, tag, tone, height = 64, className,
}: { series: number[]; tag?: string; tone?: Tone; height?: number; className?: string }) {
  const uid = useId().replace(/:/g, '');
  const pts = series.filter(Number.isFinite);
  if (pts.length < 2) return null;

  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const W = 200;
  const H = 64;
  const pad = 6;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - pad * 2);

  const d = pts.map((v, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `M 0 ${H} ${d.replace(/^M/, 'L')} L ${W} ${H} Z`;
  const auto: Tone = pts[pts.length - 1] >= pts[0] ? 'bull' : 'bear';
  const c = TONE_VAR[tone ?? auto];

  return (
    <div
      className={cn('relative overflow-hidden rounded-[2px] border border-border bg-foreground/[0.02]', className)}
      style={{ height }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden>
        <defs>
          <linearGradient id={`sp-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={c} stopOpacity="0.22" />
            <stop offset="100%" stopColor={c} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#sp-${uid})`} />
        <path
          d={d}
          fill="none"
          stroke={c}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ filter: `drop-shadow(0 0 4px color-mix(in srgb, ${c} 45%, transparent))` }}
        />
      </svg>
      {tag && (
        <span
          className="absolute right-1 top-1.5 rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.04em] text-background"
          style={{ background: c }}
        >
          {tag}
        </span>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// BAR WAVE — the staggered hover chart
// ═════════════════════════════════════════════════════════════════════════════

export interface WaveBar { value: number; tip?: string; tone?: Tone }

/**
 * Their `.tool-chart`. The motion is two overlapping nth-child selectors
 * (`odd` → .6, `3n` → 1) firing on a per-bar 30ms transition-delay, so the
 * highlight travels rather than switching on at once.
 *
 * Wants a parent carrying `group`.
 */
export function BarWave({ bars, tone = 'structural', height = 80, className }: {
  bars: WaveBar[]; tone?: Tone; height?: number; className?: string;
}) {
  if (bars.length < 2) return null;
  const peak = Math.max(...bars.map((b) => Math.abs(b.value))) || 1;
  return (
    <div className={cn('flex items-end gap-1', className)} style={{ height }}>
      {bars.map((b, i) => (
        <span
          key={i}
          title={b.tip}
          className={cn(
            'flex-1 rounded-[1px] opacity-20 transition-all duration-[400ms]',
            'group-hover:[&:nth-child(odd)]:opacity-60 group-hover:[&:nth-child(3n)]:opacity-100',
            'motion-reduce:transition-none',
          )}
          style={{
            height: `${(Math.abs(b.value) / peak) * 100}%`,
            background: TONE_VAR[b.tone ?? tone],
            transitionDelay: `${i * 30}ms`,
          }}
        />
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// DISTRIBUTION — a horizontal ranked bar list
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Not in their kit; added because the platform needs it constantly (band counts,
 * sector weights, layer contribution) and the alternative everywhere today is a
 * bare number list. Built from the same primitives so it does not read as a
 * foreign component.
 */
export function Distribution({ items, tone = 'structural', className }: {
  /** `id` keeps repeated display labels (for example two Technical layers) from
      becoming React-key collisions. The label is intentionally still repeated:
      collapsing distinct evidence just to silence a warning would hide data. */
  items: { id?: string; label: string; value: number; tone?: Tone; note?: string }[];
  tone?: Tone; className?: string;
}) {
  if (!items.length) return null;
  const peak = Math.max(...items.map((i) => Math.abs(i.value))) || 1;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {items.map((it, index) => (
        <div key={it.id ?? `${it.label}-${index}`} className="grid grid-cols-[80px_1fr_auto] items-center gap-3">
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            {it.label}
          </span>
          <span className="h-1.5 overflow-hidden rounded-[1px] bg-foreground/[0.06]">
            <span
              className="block h-full rounded-[1px] transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
              style={{ width: `${(Math.abs(it.value) / peak) * 100}%`, background: TONE_VAR[it.tone ?? tone] }}
            />
          </span>
          <span className="font-mono text-[11px] tabular-nums text-foreground">
            {it.note ?? it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SEGMENTED — the toggle, and the stage it cross-fades
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Their `.hp-switch`: a 999px pill of buttons where the active one inverts to
 * solid ink on white text, over a blurred translucent backing.
 */
export function Segmented<T extends string>({ options, value, onChange, className }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex gap-1 rounded-full border border-border bg-background/85 p-1 backdrop-blur-[6px]',
        className,
      )}
      role="tablist"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-[color,background] duration-[250ms]',
              on ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * VARIANT STAGE — their `.hp-variant` / `.is-on`. All variants are stacked and
 * absolutely positioned; only the live one has opacity and pointer events.
 *
 * Cross-fade rather than swap, and deliberately NOT a mount/unmount: keeping all
 * variants mounted means a chart that animates on entry does not replay its
 * draw-in every time the reader toggles back, which is the thing that makes
 * these controls feel cheap.
 */
export function VariantStage<T extends string>({ active, variants, className, minHeight = 420 }: {
  active: T; variants: { value: T; node: React.ReactNode }[]; className?: string; minHeight?: number;
}) {
  return (
    <div className={cn('relative', className)} style={{ minHeight }}>
      {variants.map((v) => {
        const on = v.value === active;
        return (
          <div
            key={v.value}
            aria-hidden={!on}
            className={cn(
              'inset-0 flex items-center justify-center transition-opacity duration-500',
              on ? 'relative opacity-100' : 'pointer-events-none absolute opacity-0',
            )}
          >
            {v.node}
          </div>
        );
      })}
    </div>
  );
}

/** Convenience: Segmented + VariantStage wired together with local state. */
export function ToggleStage<T extends string>({ options, variants, initial, header, minHeight }: {
  options: { value: T; label: string }[];
  variants: { value: T; node: React.ReactNode }[];
  initial?: T; header?: React.ReactNode; minHeight?: number;
}) {
  const [v, setV] = useState<T>(initial ?? options[0].value);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        {header}
        <Segmented options={options} value={v} onChange={setV} className="ml-auto" />
      </div>
      <VariantStage active={v} variants={variants} minHeight={minHeight} />
    </div>
  );
}
