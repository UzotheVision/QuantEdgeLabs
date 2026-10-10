/**
 * BOARD KIT — the shared vocabulary every QuantEdge surface is built from.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A KIT AND NOT MORE ONE-OFF SECTIONS
 * ═══════════════════════════════════════════════════════════════════════════
 * The reference site ships ~11 distinct sections that LOOK bespoke, but the CSS
 * shows they are the same eight primitives recombined: an eyebrow with a lit
 * rule, a pulsing live dot, a pill chip, a key/value pair, a ghost numeral, a
 * numbered pillar row, a quantised matrix cell, a dashed-top footer. Section
 * fv2's card and section fv4's chapter are the same object with different
 * padding.
 *
 * That is why their page feels designed rather than assembled, and it is the
 * part worth copying — not any individual section. Everything here is exported
 * for the whole platform: Oracle rows, GEX panels, LEAPS cards, the terminal
 * shells. A new board should be a composition of these, not a new stylesheet.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ FROM THEIR SOURCE, NOT FROM COMPUTED STYLE
 * ═══════════════════════════════════════════════════════════════════════════
 *   .fv2-eyebrow:before  28×1px rule, box-shadow 0 0 12px accent   ← the glow is
 *                        what makes a mono label read as instrumentation
 *   .fv4-ch-num          96px, weight 200, colour #ffffff14 (8%), and it goes to
 *                        accent-at-18% on hover — a numeral used as TEXTURE
 *   .fv5-pillar:hover    padding-left: 0 → 8px. The row steps toward you. No
 *                        colour change, no scale — just displacement.
 *   .fv2-rpt:hover       translateY(-2px) plus a 135° gradient wash fading in
 *   .fv2-cov-chip        999px radius, and .is-dot prepends a 4px dot with a
 *                        6px glow
 *
 * Keyframes, verbatim:
 *   @keyframes fv2pulse { 0%,100% { box-shadow:0 0 0 4px A26, 0 0 10px A8c }
 *                          50%    { box-shadow:0 0 0 6px A0d, 0 0 14px Ad9 } }
 *   @keyframes meetBars { 0%,100% { transform:scaleY(.4) }
 *                          50%    { transform:scaleY(1)  } }
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHERE OURS DIFFERS, ON PURPOSE
 * ═══════════════════════════════════════════════════════════════════════════
 * Their accent is a single mint that means "brand". Ours carries meaning and
 * cannot be spent on decoration: cyan is structural, moss is the winning side,
 * clay is the losing side, gold is time. So every primitive here takes a `tone`
 * rather than hard-coding an accent, and defaults to cyan — the neutral,
 * non-directional one. A component that renders a P&L must pass a tone; a
 * component that renders a label must not.
 */
import { cn } from "@/lib/utils";

export type Tone = "structural" | "bull" | "bear" | "time" | "muted";

export const TONE_VAR: Record<Tone, string> = {
  structural: "var(--brand-cyan)",
  bull: "var(--trade-bullish)",
  bear: "var(--trade-bearish)",
  time: "var(--brand-gold)",
  muted: "var(--muted-foreground)",
};

/** Emit once per page. Every animation in the kit lives here so nothing duplicates. */
export function KitStyles() {
  return (
    <style>{`
      @keyframes qk-live-pulse {
        0%,100% { box-shadow: 0 0 0 4px rgb(120 198 232 / .15), 0 0 10px rgb(120 198 232 / .55) }
        50%     { box-shadow: 0 0 0 6px rgb(120 198 232 / .05), 0 0 14px rgb(120 198 232 / .85) }
      }
      @keyframes qk-eq-bars {
        0%,100% { transform: scaleY(.4) }
        50%     { transform: scaleY(1) }
      }
      @keyframes qk-cell-pulse {
        0%,100% { box-shadow: 0 0 0 0 rgb(120 198 232 / .5) }
        50%     { box-shadow: 0 0 0 5px rgb(120 198 232 / 0) }
      }
      @keyframes qk-stage-in {
        from { opacity: 0; transform: translateY(10px) }
        to   { opacity: 1; transform: translateY(0) }
      }
      @keyframes qk-spin { to { transform: rotate(360deg) } }

      .qk-live-dot { animation: 2.4s ease-in-out infinite qk-live-pulse; }
      .qk-eq i     { transform-origin: bottom; animation: 1.1s ease-in-out infinite qk-eq-bars; }
      .qk-stage-in { animation: .6s cubic-bezier(.2,.8,.2,1) both qk-stage-in; }

      @media (prefers-reduced-motion: reduce) {
        .qk-live-dot, .qk-eq i, .qk-stage-in { animation: none; }
      }
    `}</style>
  );
}

/**
 * EYEBROW — a mono label preceded by a lit rule.
 *
 * The rule is the whole trick. A bare uppercase mono label reads as a caption;
 * the same label with a 28px glowing rule in front of it reads as a channel
 * marker on an instrument. One pseudo-element's difference.
 */
export function Eyebrow({
  children,
  tone = "structural",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const c = TONE_VAR[tone];
  return (
    <span
      className={cn(
        "flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em]",
        className,
      )}
      style={{ color: c }}
    >
      <i
        aria-hidden
        className="h-px w-7 shrink-0"
        style={{ background: c, boxShadow: `0 0 12px ${c}` }}
      />
      {children}
    </span>
  );
}

/** LIVE DOT — a pulsing status pip. Only render when something is genuinely live. */
export function LiveDot({
  tone = "structural",
  className,
}: {
  tone?: Tone;
  className?: string;
}) {
  return (
    <i
      aria-hidden
      className={cn(
        "qk-live-dot inline-block h-2 w-2 shrink-0 rounded-full",
        className,
      )}
      style={{ background: TONE_VAR[tone] }}
    />
  );
}

/**
 * EQ BARS — five bars breathing on a 150ms stagger. Their `.mt-bars`.
 * Signals "streaming" without a spinner. Heights are fixed by design: this is a
 * status ornament, not a chart, and giving it fake data would make it a lie.
 */
export function EqBars({
  tone = "structural",
  className,
}: {
  tone?: Tone;
  className?: string;
}) {
  const heights = [40, 80, 55, 95, 65];
  return (
    <span
      aria-hidden
      className={cn("qk-eq flex h-3.5 items-end gap-[2px]", className)}
    >
      {heights.map((h, i) => (
        <i
          key={i}
          className="w-[2px] rounded-[1px]"
          style={{
            height: `${h}%`,
            background: TONE_VAR[tone],
            animationDelay: `${i * 150}ms`,
          }}
        />
      ))}
    </span>
  );
}

/** CHIP — pill with an optional lit dot and a primary state. Their `.fv2-cov-chip`. */
export function Chip({
  children,
  active,
  dot,
  tone = "structural",
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  dot?: boolean;
  tone?: Tone;
  onClick?: () => void;
  title?: string;
}) {
  const c = TONE_VAR[tone];
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center rounded-full border px-4 py-[9px] font-mono text-[11px] uppercase tracking-[0.08em] transition-all duration-[250ms]",
        active
          ? "border-current"
          : "border-border bg-foreground/[0.02] text-muted-foreground hover:border-current",
        onClick && "cursor-pointer",
      )}
      style={
        active
          ? {
              color: c,
              background: `color-mix(in srgb, ${c} 8%, transparent)`,
              borderColor: `color-mix(in srgb, ${c} 40%, transparent)`,
            }
          : undefined
      }
    >
      {dot && (
        <i
          aria-hidden
          className="mr-2 h-1 w-1 shrink-0 rounded-full"
          style={{ background: c, boxShadow: `0 0 6px ${c}` }}
        />
      )}
      {children}
    </Tag>
  );
}

/**
 * KEY/VALUE — their `.fv4-ch-key .item`. A tiny uppercase key over a mono value.
 * Stacked, never inline: an inline `KEY: value` makes the eye read the label
 * first every time, which is backwards once you know what the labels are.
 */
export function KeyValue({
  k,
  v,
  tone,
  className,
}: {
  k: string;
  v: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
        {k}
      </span>
      <span
        className="font-mono text-[13px] font-medium tabular-nums"
        style={{ color: tone ? TONE_VAR[tone] : "var(--foreground)" }}
      >
        {v}
      </span>
    </div>
  );
}

export function KeyValueRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-auto flex flex-wrap gap-x-6 gap-y-3 border-t border-dashed border-border pt-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * GHOST NUMERAL — a 96px hairline figure in the corner at 8% opacity, lifting to
 * accent on hover. Their `.fv4-ch-num`.
 *
 * Use it ONLY where the number encodes real sequence — a pipeline stage, a
 * ranked position. A decorative 01/02/03 over three unordered features is the
 * single most common tell of a generated layout, and this component will happily
 * produce that if pointed at the wrong content.
 */
export function GhostNumeral({
  n,
  tone = "structural",
}: {
  n: number | string;
  tone?: Tone;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute right-7 top-6 select-none font-light leading-none tracking-[-0.04em]",
        "text-[96px] text-foreground/[0.07] transition-colors duration-[400ms]",
      )}
      style={{ ["--gn" as string]: TONE_VAR[tone] }}
    >
      <span className="transition-colors duration-[400ms] group-hover:text-[color:var(--gn)] group-hover:opacity-20">
        {typeof n === "number" ? String(n).padStart(2, "0") : n}
      </span>
    </span>
  );
}

/**
 * PILLAR ROW — numbered row that steps 8px toward the reader on hover.
 * Their `.fv5-pillar`. Displacement instead of a colour change: it reads as
 * physical rather than as a selection state, which matters in a list where
 * nothing is actually selectable.
 */
export function PillarRow({
  n,
  title,
  desc,
  tone = "structural",
  onClick,
}: {
  n: number | string;
  title: string;
  desc?: string;
  tone?: Tone;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "grid grid-cols-[28px_1fr] gap-4 border-b border-border py-[18px] transition-[padding-left] duration-300 hover:pl-2",
        onClick && "cursor-pointer",
      )}
    >
      <span
        className="pt-[3px] font-mono text-[11px] font-medium tracking-[0.12em]"
        style={{ color: TONE_VAR[tone] }}
      >
        {typeof n === "number" ? String(n).padStart(2, "0") : n}
      </span>
      <div>
        <p className="mb-1 text-base font-medium leading-[1.4] tracking-[-0.005em] text-foreground">
          {title}
        </p>
        {desc && (
          <p className="text-[13px] leading-[1.6] text-muted-foreground">
            {desc}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * BOARD FRAME — the panel chrome. A hairline box with a masked 56px graph-paper
 * grid that fades out toward the edges (`.fv3-board:after`), a mono title and a
 * slot for a legend.
 *
 * The radial mask is what stops the grid reading as a table: it is present under
 * the data and gone at the margins, so it registers as a surface rather than as
 * structure the content sits inside.
 */
export function BoardFrame({
  title,
  right,
  children,
  className,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded border border-border bg-foreground/[0.02] p-6 sm:p-9",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          opacity: 0.35,
          WebkitMaskImage: "radial-gradient(#000 0%, transparent 80%)",
          maskImage: "radial-gradient(#000 0%, transparent 80%)",
        }}
      />
      {(title || right) && (
        <div className="relative z-[2] mb-6 flex flex-wrap items-center justify-between gap-4">
          {title && (
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {title}
            </span>
          )}
          {right}
        </div>
      )}
      <div className="relative z-[2]">{children}</div>
    </div>
  );
}

/** LEGEND — the three-swatch escalating scale used beside a matrix. */
export function IntensityLegend({
  labels = ["low", "mid", "high"],
  tone = "structural",
}: {
  labels?: [string, string, string] | string[];
  tone?: Tone;
}) {
  const c = TONE_VAR[tone];
  const steps = [0.18, 0.45, 1];
  return (
    <span className="inline-flex items-center gap-[18px] font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
      {steps.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <i
            className="h-2.5 w-2.5 rounded-[2px] border"
            style={{
              background: `color-mix(in srgb, ${c} ${s * 100}%, transparent)`,
              borderColor: `color-mix(in srgb, ${c} ${Math.min(100, s * 120)}%, transparent)`,
              boxShadow:
                s === 1
                  ? `0 0 10px color-mix(in srgb, ${c} 70%, transparent)`
                  : undefined,
            }}
          />
          {labels[i]}
        </span>
      ))}
    </span>
  );
}

/**
 * SECTION RULE — a labelled divider that ranks what follows.
 *
 * The Oracle board's real failure was not styling: it was four full-width panels
 * of identical visual weight stacked in ascending order of importance. Nothing
 * in the layout said which one to read, so the layout said they were equal, and
 * the least actionable one came first.
 *
 * A rule with a name is the cheapest possible fix for that. It costs 24px and it
 * tells the reader that everything below it belongs to a different, lower tier
 * than what came above — which is the one thing a stack of equal cards can never
 * communicate on its own.
 *
 * Deliberately NOT a heading: these mark demotions, not chapters, so they read at
 * label scale and let the panel titles underneath stay the loudest text.
 */
export function SectionRule({
  label,
  note,
  className,
}: {
  label: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 pt-3", className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      {note && (
        <span className="font-mono text-[10px] text-muted-foreground">
          {note}
        </span>
      )}
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * READOUT — one block, four instances. The fix for a rail of bespoke panels.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PROBLEM, MEASURED
 * ═══════════════════════════════════════════════════════════════════════════
 * The cockpit renders 55 panels across 15 distinct footprints. The signal grid
 * renders 40 cards across 1. That difference is the entire reason the grid is
 * easier to read, and it is structural rather than stylistic:
 *
 *   • repeating units teach the eye ONCE — position means the same thing every
 *     time, so instance 40 costs nothing to parse. 15 unique shapes make you
 *     re-learn the layout at every panel.
 *   • comparison needs alignment. Same field, same place, or the reader has to
 *     hold the previous panel in memory.
 *   • filtering only works over like things. A card is atomic so it can be
 *     hidden; "part of the cockpit" is not a thing that can be hidden, which is
 *     why a filter bar was natural on the grid and structurally unavailable on
 *     the rail.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS AND IS NOT UNIFIED
 * ═══════════════════════════════════════════════════════════════════════════
 * The FRAME and the GRAMMAR are shared: header strip, one headline value with a
 * qualifier, optional supporting bars, an optional detail slot, one line of
 * prose at the bottom. The CONTENT of the detail slot is per-panel.
 *
 * That distinction matters. Forcing Signal Components into "big number + bars"
 * would delete its per-layer explanations — "Coiled: 15.1% box (5.6×ATR), 2
 * ceiling / 4 floor tests" — which are the best writing in the platform. The
 * reference site's cards work the same way: identical head/title/body/viz/foot
 * skeleton, a different visual inside each one. Consistency of structure is what
 * reads as designed; identical content would just be repetitive.
 *
 * The prose line is deliberately last and deliberately singular. A panel that
 * ends in a paragraph becomes a document; one that ends in a sentence stays an
 * instrument.
 */
export function Readout({
  title,
  meta,
  value,
  qualifier,
  valueTone = "structural",
  bars,
  children,
  note,
  className,
}: {
  title: string;
  meta?: React.ReactNode;
  /** The one number this panel exists to deliver. */
  value?: React.ReactNode;
  /** What the number means in words — "ELITE BULLISH", "net", "0 contracts". */
  qualifier?: React.ReactNode;
  valueTone?: Tone;
  /** Supporting structure under the headline — a Distribution, a split bar. */
  bars?: React.ReactNode;
  /** Panel-specific detail. This is the slot that stays bespoke. */
  children?: React.ReactNode;
  /** One sentence. Not a paragraph. */
  note?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[4px] border border-card-border bg-card/[0.9]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.13em] text-foreground/90">
          {title}
        </span>
        {meta && (
          <span className="font-mono text-[10px] font-medium text-muted-foreground">
            {meta}
          </span>
        )}
      </div>

      <div className="space-y-3 px-4 py-3.5">
        {(value != null || qualifier) && (
          <div className="flex items-baseline gap-2.5">
            {value != null && (
              <span
                className="font-mono text-[34px] font-bold leading-none tabular-nums"
                style={{ color: TONE_VAR[valueTone] }}
              >
                {value}
              </span>
            )}
            {qualifier && (
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {qualifier}
              </span>
            )}
          </div>
        )}

        {bars}
        {children}

        {note && (
          <p className="border-t border-border/45 pt-2.5 font-mono text-[10px] font-medium leading-relaxed text-muted-foreground">
            {note}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * BAND SCALE — where a score sits against the cut-offs that decide its grade.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS REPLACES AND WHY
 * ═══════════════════════════════════════════════════════════════════════════
 * The Confidence panel rendered a radial gauge under a 32px "77". Once the
 * numeral moved into the block's headline, the arc was drawing exactly one
 * value that was already stated 40px above it — decoration wearing the costume
 * of a chart.
 *
 * It also carried four stacked glow effects on one shape: a 16px stroke under
 * `blur(6px)`, a 12px gradient stroke under `drop-shadow(0 0 8px)`, a dot under
 * `drop-shadow(0 0 6px)`, and a hairline track. Effects were doing the work that
 * information should have been doing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SHOWS INSTEAD
 * ═══════════════════════════════════════════════════════════════════════════
 * The one thing the bare number cannot tell you: DISTANCE TO THE NEXT GRADE.
 * A 77 is a Band A, S begins at 86 — so this signal is nine points short of the
 * top band, and that is actionable in a way "77" alone is not. The cut-offs are
 * passed in rather than hardcoded so the scale can never drift from the engine
 * the way the percentage curve once did.
 *
 * Horizontal, segmented, no glow — the same grammar as every other bar in the
 * rail, rather than a dashboard gauge imported from a different design language.
 */
export function BandScale({
  value,
  bands,
  tone = "structural",
  className,
  max = 100,
}: {
  /** Current score on the same scale as the band floors. */
  value: number;
  /** Ordered LOW → HIGH, each with the floor at which that band begins. */
  bands: { label: string; floor: number }[];
  tone?: Tone;
  className?: string;
  /** Ceiling for the instrument. Defaults to the old 0–100 index scale. */
  max?: number;
}) {
  if (!bands.length) return null;
  const sorted = [...bands].sort((a, b) => a.floor - b.floor);
  const activeIdx = sorted.reduce(
    (acc, b, i) => (value >= b.floor ? i : acc),
    0,
  );
  const next = sorted[activeIdx + 1];
  const pos = Math.max(0, Math.min(100, (value / max) * 100));
  const c = TONE_VAR[tone];

  return (
    <div className={cn("min-w-0", className)}>
      <div className="relative h-1.5 overflow-hidden rounded-[1px] bg-foreground/[0.06]">
        {sorted.map((b, i) => {
          const start = (b.floor / max) * 100;
          const end = ((sorted[i + 1]?.floor ?? max) / max) * 100;
          return (
            <span
              key={b.label}
              className="absolute inset-y-0"
              style={{
                left: `${start}%`,
                width: `${end - start}%`,
                // Only the achieved bands carry colour. Tinting the ones above
                // would imply the signal had reached them.
                background: i <= activeIdx ? c : "transparent",
                opacity: i === activeIdx ? 1 : 0.28,
                borderLeft: i > 0 ? "1px solid var(--card)" : undefined,
              }}
            />
          );
        })}
        {/* the marker — a hairline, not a glowing puck */}
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-foreground"
          style={{ left: `${pos}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-baseline justify-between font-mono text-[9px] uppercase tracking-[0.12em]">
        <span className="flex gap-2">
          {sorted.map((b, i) => (
            <span
              key={b.label}
              style={{ color: i === activeIdx ? c : undefined }}
              className={
                i === activeIdx ? "font-bold" : "text-muted-foreground"
              }
            >
              {b.label}
            </span>
          ))}
        </span>
        <span className="text-muted-foreground">
          {next
            ? `${Math.max(0, Math.ceil(next.floor - value))} to ${next.label}`
            : "top band"}
        </span>
      </div>
    </div>
  );
}
