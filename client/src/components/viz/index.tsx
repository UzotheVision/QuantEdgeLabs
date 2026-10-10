/**
 * VIZ PRIMITIVES — the shared visual language.
 *
 * A trading surface should let you read position at a glance, not parse a sentence.
 * "stop $1.25 (−50%) target $4.98 (+100%)" is three numbers you have to assemble in your
 * head; a bar with the stop zone, the target zone and a live marker is one look.
 *
 * These are deliberately small and unopinionated so every surface uses the SAME encoding:
 * red is always the losing side, green the winning side, cyan is structural, amber is time
 * running out. Consistency is what makes a glance reliable.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import { TC } from '@/lib/design-tokens';

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/**
 * RANGE BAR — stop ─── entry ─── now ─── target on one axis.
 * The single most useful object on a trading screen: where the trade sits between the two
 * prices that end it.
 */
export function RangeBar({
  stop, entry, current, target, height = 8, showTicks = true, className,
  /** Contracts held — turns the hover readout into real dollars, not just a price. */
  quantity,
  /** 100 for options, 1 for shares. */
  multiplier = 1,
}: {
  stop: number; entry: number; current: number; target: number;
  height?: number; showTicks?: boolean; className?: string;
  quantity?: number;
  multiplier?: number;
}) {
  // Hover scrubbing. The bar already encoded the range but you could not read a
  // value off it — you could see the position was somewhere between the stop and
  // the target without knowing what any point on it was worth. Pointing at the bar
  // now answers "what is this worth if premium gets here", which is the question
  // being asked when someone looks at it.
  const [hoverPct, setHoverPct] = React.useState<number | null>(null);
  const lo = Math.min(stop, entry, current, target);
  const hi = Math.max(stop, entry, current, target);
  const span = hi - lo || 1;
  const pos = (v: number) => clamp(((v - lo) / span) * 100);

  const long = target > stop;
  const stopPos = pos(stop), entryPos = pos(entry), curPos = pos(current), tgtPos = pos(target);

  // Map a hover position back to the price it represents, then to P&L at that price.
  const hoverPrice = hoverPct == null ? null : lo + (hoverPct / 100) * span;
  const hoverPnlPct = hoverPrice == null || entry <= 0 ? null : ((hoverPrice - entry) / entry) * 100;
  const hoverPnl =
    hoverPrice == null || !quantity ? null : (hoverPrice - entry) * quantity * multiplier;
  // risk side runs from the stop to entry; reward side entry to target
  const riskFrom = Math.min(stopPos, entryPos), riskTo = Math.max(stopPos, entryPos);
  const rewFrom = Math.min(entryPos, tgtPos), rewTo = Math.max(entryPos, tgtPos);

  return (
    <div className={cn('w-full', className)}>
      {/* Readout sits ABOVE the bar so the cursor never covers the answer. */}
      <div className="mb-1 flex h-4 items-baseline justify-between text-label font-mono tabular-nums">
        {hoverPrice != null ? (
          <>
            <span className="text-foreground">${hoverPrice.toFixed(2)}</span>
            <span style={{ color: (hoverPnlPct ?? 0) >= 0 ? TC.bull : TC.bear }}>
              {(hoverPnlPct ?? 0) >= 0 ? '+' : ''}{(hoverPnlPct ?? 0).toFixed(0)}%
              {hoverPnl != null && (
                <span className="ml-1.5">
                  {hoverPnl >= 0 ? '+' : '−'}${Math.abs(hoverPnl).toFixed(0)}
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">hover the bar to price it</span>
        )}
      </div>

      <div
        className="relative w-full cursor-crosshair rounded-full bg-foreground/[0.07]"
        style={{ height }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (r.width <= 0) return;
          setHoverPct(clamp(((e.clientX - r.left) / r.width) * 100));
        }}
        onMouseLeave={() => setHoverPct(null)}
      >
        {/* the scrub line — drawn first so the real markers stay on top */}
        {hoverPct != null && (
          <div
            className="pointer-events-none absolute top-[-3px] bottom-[-3px] w-px bg-foreground/45"
            style={{ left: `${hoverPct}%` }}
          />
        )}
        {/* risk zone */}
        <div className="absolute top-0 bottom-0 rounded-full"
             style={{ left: `${riskFrom}%`, width: `${riskTo - riskFrom}%`, background: `color-mix(in srgb, ${TC.bear} 30%, transparent)` }} />
        {/* reward zone */}
        <div className="absolute top-0 bottom-0 rounded-full"
             style={{ left: `${rewFrom}%`, width: `${rewTo - rewFrom}%`, background: `color-mix(in srgb, ${TC.bull} 26%, transparent)` }} />
        {/* filled progress from entry toward target */}
        <div className="absolute top-0 bottom-0 rounded-full"
             style={{
               left: `${Math.min(entryPos, curPos)}%`,
               width: `${Math.abs(curPos - entryPos)}%`,
               background: (long ? current >= entry : current <= entry) ? TC.bull : TC.bear,
               opacity: 0.9,
             }} />
        {/* entry marker */}
        <div className="absolute top-[-2px] bottom-[-2px] w-px bg-foreground/70" style={{ left: `${entryPos}%` }} />
        {/* live marker */}
        <div className="absolute rounded-full ring-2 ring-background"
             style={{ left: `calc(${curPos}% - ${height / 2}px)`, top: -1, width: height + 2, height: height + 2, background: TC.info }} />
      </div>

      {showTicks && (
        <div className="mt-1 flex justify-between text-label font-mono tabular-nums">
          <span style={{ color: TC.bear }}>{stop.toFixed(2)}</span>
          <span className="text-muted-foreground">entry {entry.toFixed(2)}</span>
          <span style={{ color: TC.bull }}>{target.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

/** METER — a labelled 0–100 fill. Use for anything proportional. */
export function Meter({
  value, label, right, color, height = 6, className,
}: {
  value: number; label?: string; right?: string; color?: string; height?: number; className?: string;
}) {
  const v = clamp(value);
  return (
    <div className={cn('w-full', className)}>
      {(label || right) && (
        <div className="mb-1 flex items-baseline justify-between">
          {label && <span className="text-label font-mono uppercase tracking-wider text-muted-foreground">{label}</span>}
          {right && <span className="text-label font-mono tabular-nums text-muted-foreground">{right}</span>}
        </div>
      )}
      <div className="w-full overflow-hidden rounded-full bg-foreground/[0.07]" style={{ height }}>
        <div className="h-full rounded-full transition-[width] duration-500"
             style={{ width: `${v}%`, background: color ?? TC.info }} />
      </div>
    </div>
  );
}

/**
 * DECAY BAR — time left on a contract. Drains as expiry approaches and turns amber then
 * red, because theta is the risk that has no equivalent in shares.
 */
export function DecayBar({ daysLeft, totalDays = 30, className }: { daysLeft: number; totalDays?: number; className?: string }) {
  const pct = clamp((daysLeft / totalDays) * 100);
  const color = daysLeft <= 2 ? TC.bear : daysLeft <= 7 ? TC.warn : TC.muted;
  return (
    <div className={cn('w-full', className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-label font-mono uppercase tracking-wider text-muted-foreground">Time left</span>
        <span className="text-label font-mono tabular-nums" style={{ color }}>{daysLeft}d</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/**
 * COIL BAR — where price sits inside a consolidation box. Pressing the ceiling is the
 * setup; sitting on the floor is the opposite trade.
 */
export function CoilBar({ low, high, current, className }: { low: number; high: number; current: number; className?: string }) {
  const span = high - low || 1;
  const pos = clamp(((current - low) / span) * 100);
  const color = pos >= 70 ? TC.bull : pos <= 30 ? TC.bear : TC.warn;
  return (
    <div className={cn('w-full', className)}>
      <div className="relative h-1.5 w-full rounded-full"
           style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${TC.bear} 22%, transparent), color-mix(in srgb, ${TC.warn} 18%, transparent), color-mix(in srgb, ${TC.bull} 24%, transparent))` }}>
        <div className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ring-2 ring-background"
             style={{ left: `calc(${pos}% - 5px)`, background: color }} />
      </div>
      <div className="mt-1 flex justify-between text-label font-mono tabular-nums text-muted-foreground">
        <span>{low.toFixed(2)}</span>
        <span style={{ color }}>{pos.toFixed(0)}% up the range</span>
        <span>{high.toFixed(2)}</span>
      </div>
    </div>
  );
}

/** DIVERGING BAR — a signed value drawn from a centre line (sector strength, net flow). */
export function DivergingBar({ value, max, height = 6, className }: { value: number; max: number; height?: number; className?: string }) {
  const m = Math.max(Math.abs(max), 0.01);
  const raw = (Math.abs(value) / m) * 50;
  const pct = clamp(raw, 0, 50);
  const pos = value >= 0;
  // A value past the scale is pinned at the edge, so it must SAY it's pinned —
  // otherwise a 13x outlier and a merely-large value draw the same full bar.
  const overflows = raw > 50.5;
  const color = pos ? TC.bull : TC.bear;
  return (
    <div className={cn('relative w-full rounded-full bg-foreground/[0.07]', className)} style={{ height }}>
      <div className="absolute top-0 bottom-0 w-px bg-foreground/25" style={{ left: '50%' }} />
      <div className="absolute top-0 bottom-0 rounded-full"
           style={{ left: pos ? '50%' : `${50 - pct}%`, width: `${pct}%`, background: color }} />
      {overflows && (
        <div
          className="absolute top-0 bottom-0"
          style={{
            [pos ? 'right' : 'left']: 0,
            width: 5,
            // hatched cap = "this ran past the edge of the scale"
            background: `repeating-linear-gradient(90deg, ${color} 0 1px, transparent 1px 3px)`,
          }}
          title={`Off the scale — ${value.toFixed(2)} vs a ${m.toFixed(2)} axis`}
        />
      )}
    </div>
  );
}

/**
 * A max that one outlier can't destroy.
 *
 * Using the raw maximum means a single extreme member sets the axis for everyone:
 * with Crypto at +6.9% against a field of ±0.5%, every other group rendered as a
 * 2-4% sliver and the panel showed six bars that all looked like zero. Scaling to
 * a high percentile instead keeps the typical values readable; whatever exceeds it
 * is pinned and hatched rather than silently flattening the rest.
 */
export function robustMax(values: number[], floor = 0.5, percentile = 0.8): number {
  const abs = values.map((v) => Math.abs(v)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!abs.length) return floor;
  const idx = Math.min(abs.length - 1, Math.floor(abs.length * percentile));
  return Math.max(floor, abs[idx]);
}

/**
 * SCORE DIAL — a compact radial for a 0–100 rating.
 * A number alone gives no sense of scale; an arc shows how full the tank is at a glance.
 */
export function ScoreDial({
  value, size = 56, label, delta, className,
}: { value: number; size?: number; label?: string; delta?: number | null; className?: string }) {
  const v = clamp(value);
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const color = v >= 70 ? TC.bull : v >= 45 ? TC.warn : TC.bear;
  return (
    <div className={cn('relative grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4}
                stroke="color-mix(in srgb, var(--foreground) 10%, transparent)" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} stroke={color}
                strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (v / 100) * c}
                style={{ transition: 'stroke-dashoffset 600ms ease' }} />
      </svg>
      <span className="absolute flex flex-col items-center leading-none">
        <span className="font-mono text-lead font-bold tabular-nums" style={{ color }}>{Math.round(v)}</span>
        {label && <span className="mt-0.5 text-label font-mono uppercase tracking-wider text-muted-foreground">{label}</span>}
      </span>
      {delta != null && delta !== 0 && (
        <span className="absolute -right-1 -top-1 font-mono text-label font-bold tabular-nums"
              style={{ color: delta > 0 ? TC.bull : TC.bear }}>
          {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
        </span>
      )}
    </div>
  );
}

/**
 * STACKED BAR — parts of a whole (e.g. supporting vs opposing conviction points).
 * Shows composition, which a single total hides.
 */
export function StackedBar({
  segments, height = 8, className,
}: { segments: { value: number; color: string; label?: string }[]; height?: number; className?: string }) {
  const total = segments.reduce((s, x) => s + Math.abs(x.value), 0) || 1;
  return (
    <div className={cn('flex w-full overflow-hidden rounded-full bg-foreground/[0.07]', className)} style={{ height }}>
      {segments.map((s, i) => (
        <div key={i} title={s.label}
             style={{ width: `${(Math.abs(s.value) / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}

/** SPARKLINE — a tiny trend, no axes. For "what has this been doing" at a glance. */
export function Sparkline({
  values, width = 88, height = 24, color, className,
}: { values: number[]; width?: number; height?: number; color?: string; className?: string }) {
  if (!values || values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - lo) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const up = values[values.length - 1] >= values[0];
  const stroke = color ?? (up ? TC.bull : TC.bear);
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5}
                strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** PILL — a compact labelled chip. The spec-chip pattern used across the terminal. */
export function Pill({
  children, color, className,
}: { children: React.ReactNode; color?: string; className?: string }) {
  const c = color ?? TC.info;
  return (
    <span className={cn('rounded border px-1.5 py-px font-mono text-label font-bold uppercase tracking-wider', className)}
          style={{ color: c, borderColor: `color-mix(in srgb, ${c} 40%, transparent)`, background: `color-mix(in srgb, ${c} 10%, transparent)` }}>
      {children}
    </span>
  );
}

/**
 * STRUCTURAL RANGE — put support ── flip ── spot ── call wall on one axis.
 *
 * These four numbers describe a cage: where dealers defend, where gamma flips sign, and
 * where price actually is inside it. As a list of stats you have to hold four prices in
 * your head and compare them; as one axis you see immediately whether spot is pinned
 * mid-range, pressing a wall, or through the flip and into a different regime.
 */
export function StructuralRange({
  putWall, callWall, spot, flip, magnet, height = 10, className,
}: {
  putWall?: number | null; callWall?: number | null; spot: number;
  flip?: number | null; magnet?: number | null; height?: number; className?: string;
}) {
  const pts = [putWall, callWall, spot, flip, magnet].filter((v): v is number => typeof v === 'number' && v > 0);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const span = hi - lo || 1;
  const pos = (v: number) => clamp(((v - lo) / span) * 100);

  const inCage = putWall != null && callWall != null && spot > putWall && spot < callWall;

  return (
    <div className={cn('w-full', className)}>
      <div className="relative w-full rounded-full" style={{
        height,
        background: `linear-gradient(90deg,
          color-mix(in srgb, ${TC.bear} 30%, transparent),
          color-mix(in srgb, var(--foreground) 6%, transparent) 50%,
          color-mix(in srgb, ${TC.bull} 30%, transparent))`,
      }}>
        {/* gamma flip — the regime boundary, so it's a hard line not a dot */}
        {flip != null && flip > 0 && (
          <div className="absolute -top-1 -bottom-1 w-px" style={{ left: `${pos(flip)}%`, background: TC.warn }} title={`γ flip $${flip}`} />
        )}
        {/* magnet / max-gamma strike */}
        {magnet != null && magnet > 0 && (
          <div className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rotate-45"
               style={{ left: `calc(${pos(magnet)}% - 3px)`, background: TC.warn }} title={`magnet $${magnet}`} />
        )}
        {/* spot */}
        <div className="absolute rounded-full ring-2 ring-background"
             style={{ left: `calc(${pos(spot)}% - ${height / 2}px)`, top: -1, width: height + 2, height: height + 2, background: TC.info }}
             title={`spot $${spot.toFixed(2)}`} />
      </div>

      <div className="mt-1 flex justify-between text-label font-mono tabular-nums">
        <span style={{ color: TC.bear }}>{putWall ? `$${putWall}` : '—'}<span className="ml-1 text-muted-foreground">put</span></span>
        <span className="text-muted-foreground">{inCage ? 'inside the range' : 'outside the walls'}</span>
        <span style={{ color: TC.bull }}><span className="mr-1 text-muted-foreground">call</span>{callWall ? `$${callWall}` : '—'}</span>
      </div>
    </div>
  );
}

/**
 * GRAVITY SPLIT — how exposure divides above vs below spot.
 * Reads as a pull: which side dealers are positioned to defend harder.
 */
export function GravitySplit({ upPct, height = 8, className }: { upPct: number; height?: number; className?: string }) {
  const up = clamp(upPct);
  return (
    <div className={cn('w-full', className)}>
      <div className="flex w-full overflow-hidden rounded-full" style={{ height }}>
        <div style={{ width: `${up}%`, background: TC.bull }} />
        <div style={{ width: `${100 - up}%`, background: TC.bear }} />
      </div>
      <div className="mt-1 flex justify-between text-label font-mono tabular-nums">
        <span style={{ color: TC.bull }}>↑ {up.toFixed(0)}%</span>
        <span style={{ color: TC.bear }}>{(100 - up).toFixed(0)}% ↓</span>
      </div>
    </div>
  );
}

/**
 * PARTICIPATION STRIP — what share of a group is moving together.
 *
 * Deliberately NOT a filled bar. Breadth sat directly under a diverging move bar
 * in identical green, so every sector row showed two same-coloured bars of similar
 * length meaning completely different things: one directional, one not. The eye
 * read them as a pair of magnitudes and could separate neither.
 *
 * Ten discrete ticks instead. Participation is a proportion of a countable set, so
 * a segmented strip states that honestly, and being a different visual FORM — not
 * just a different colour — means it can never be mistaken for the move above it.
 * Neutral by default, because breadth has no direction of its own.
 */
export function ParticipationStrip({
  pct, height = 4, className,
}: { pct: number; height?: number; className?: string }) {
  const filled = Math.round(clamp(pct) / 10);
  return (
    <div className={cn('flex w-full items-center gap-[3px]', className)} style={{ height }}>
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height,
            background: i < filled ? 'var(--foreground)' : 'currentColor',
            opacity: i < filled ? 0.55 : 0.1,
          }}
        />
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * LIVENESS
 *
 * The board was accurate and completely still. Numbers replaced themselves
 * between polls with no transition, so a screen that had just updated looked
 * identical to one that had been frozen for an hour — and a terminal you cannot
 * tell is live is a terminal you do not trust.
 *
 * What makes a real trading screen feel alive is not decoration. It is that a
 * changing number ANNOUNCES the change: it flashes the direction it moved and
 * travels to its new value instead of teleporting. That is the whole trick, and
 * it carries information — you catch the move peripherally, without reading.
 *
 * Both primitives honour prefers-reduced-motion by dropping straight to the
 * final value, because a flashing screen is genuinely painful for some people.
 * ──────────────────────────────────────────────────────────────────────────── */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Eases a number toward its target over `ms`, on rAF. */
function useTweened(target: number, ms = 420): number {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = React.useState(target);
  const fromRef = React.useRef(target);
  const rafRef = React.useRef<number>();

  React.useEffect(() => {
    if (reduced || !Number.isFinite(target)) { setShown(target); return; }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      // easeOutCubic — fast departure, soft landing. Reads as momentum.
      const e = 1 - Math.pow(1 - p, 3);
      setShown(from + (target - from) * e);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, ms, reduced]);

  React.useEffect(() => { if (reduced) fromRef.current = target; }, [target, reduced]);
  return reduced ? target : shown;
}

/**
 * A number that announces its own change: tints green on a rise, red on a fall,
 * and travels to the new value rather than snapping.
 */
export function LiveValue({
  value,
  format,
  className,
  flashMs = 700,
  tween = true,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  flashMs?: number;
  /** Off for values where an intermediate number would be a lie (counts, ids). */
  tween?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const [dir, setDir] = React.useState<'up' | 'down' | null>(null);
  const prev = React.useRef(value);

  React.useEffect(() => {
    if (!Number.isFinite(value) || value === prev.current) return;
    setDir(value > prev.current ? 'up' : 'down');
    prev.current = value;
    const id = setTimeout(() => setDir(null), flashMs);
    return () => clearTimeout(id);
  }, [value, flashMs]);

  const tweened = useTweened(tween ? value : prev.current, 420);
  const shown = tween && !reduced ? tweened : value;
  const text = format ? format(shown) : String(Math.round(shown * 100) / 100);

  return (
    <span
      className={cn(
        'inline-block rounded-[3px] px-1 -mx-1 transition-colors duration-500 tabular-nums',
        // Tokens, not raw Tailwind: a rising price must be the same green as a
        // bullish badge, and emerald-300 is not --trade-bullish. This is the
        // single most-repeated motion in the terminal, so a mismatch here reads
        // as two different products.
        dir === 'up' && 'bg-[color-mix(in_srgb,var(--trade-bullish)_20%,transparent)] text-[var(--trade-bullish)]',
        dir === 'down' && 'bg-[color-mix(in_srgb,var(--trade-bearish)_20%,transparent)] text-[var(--trade-bearish)]',
        className,
      )}
      style={{ transitionDuration: dir ? '90ms' : `${flashMs}ms` }}
    >
      {text}
    </span>
  );
}

/**
 * Proof the screen is still connected: a pulsing dot and an age that actually
 * counts up, going amber then red as the data gets old. A static "LIVE" badge
 * claims freshness; this one demonstrates it.
 */
export function Heartbeat({
  since,
  staleAfterSec = 90,
  label = 'LIVE',
  className,
}: {
  /** When the data last arrived. ISO string is the common case — every live
   *  endpoint here returns one (generatedAt / asOf / calculatedAt / scannedAt). */
  since: Date | number | string | null | undefined;
  staleAfterSec?: number;
  label?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, 1000);
    return () => clearInterval(id);
  }, []);

  const ms = since ? Date.now() - new Date(since).getTime() : NaN;
  const sec = Math.max(0, Math.floor(ms / 1000));
  const stale = !Number.isFinite(sec) || sec > staleAfterSec;
  const dead = !Number.isFinite(sec) || sec > staleAfterSec * 4;

  const age = !Number.isFinite(sec)
    ? 'no data'
    : sec < 60 ? `${sec}s ago`
    : sec < 3600 ? `${Math.floor(sec / 60)}m ago`
    : `${Math.floor(sec / 3600)}h ago`;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[10px] tracking-wider', className)}>
      <span className="relative flex h-1.5 w-1.5">
        {/* The ping is the one looping animation allowed on a data surface, because
            it encodes freshness rather than decorating it. It still stops under
            prefers-reduced-motion — the dot colour and the counting age already
            carry the whole meaning, so nothing is lost by dropping the pulse. */}
        {!stale && !reduced && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: 'var(--trade-bullish)' }} />
        )}
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ background: dead ? 'var(--trade-bearish)' : stale ? 'var(--brand-gold)' : 'var(--trade-bullish)' }}
        />
      </span>
      <span style={{ color: dead ? 'var(--trade-bearish)' : stale ? 'var(--brand-gold)' : 'var(--trade-bullish)' }}>
        {label}
      </span>
      <span className="text-muted-foreground">{age}</span>
    </span>
  );
}
