/**
 * SURFACE TEMPLATES — the two card shapes the platform needs everywhere.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RECORD CARD  (their .fv2-rpt)
 * ═══════════════════════════════════════════════════════════════════════════
 * A ticker-led card with a typed badge, a quiet id line, a title that grows into
 * the available space, and a dashed-top footer. Read from their source:
 *
 *   .fv2-rpt         min-height 220, radius 2, border A/8%
 *   .fv2-rpt:before  linear-gradient(135deg, A/6% 0%, transparent 60%), opacity 0
 *   .fv2-rpt:hover   translateY(-2px), border A/45%, and :before → opacity 1
 *   .fv2-rpt-foot    border-top: 1px DASHED
 *   .t-deep/.t-prev/.t-rev  the type badge is colour-coded by kind
 *
 * The 135° wash is the detail worth keeping: a flat background swap on hover
 * reads as a selection state, while a directional gradient reads as light moving
 * across a surface. Same one property, completely different feel.
 *
 * This is the right shape for a signal, a report, a LEAPS candidate, a flow
 * alert — anything that is "one named thing with a type and a timestamp".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DETAIL PANEL  (their .mdp-*)
 * ═══════════════════════════════════════════════════════════════════════════
 * The drill-down: a title bar with a back affordance and actions, then rows on a
 * fixed 130px key column, then a bordered footer for the primary action. It is
 * what a card opens INTO, and having one shared shape for that is the difference
 * between a platform and a pile of modals.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TONE IS NOT DECORATION
 * ═══════════════════════════════════════════════════════════════════════════
 * `tone` on these components drives the wash, the border and the badge together.
 * Pass `bear` for a short and the whole card leans clay; pass nothing and it
 * stays cyan-neutral. Never pass a tone to make a card stand out — the colour
 * means direction, and a card tinted for emphasis is a card that lies.
 */
import { cn } from '@/lib/utils';
import { type Tone, TONE_VAR } from './kit';

// ═════════════════════════════════════════════════════════════════════════════

export function RecordCard({
  ticker, badge, badgeTone, id, title, footLeft, footRight, tone = 'structural',
  onClick, href, children, className, style,
}: {
  ticker: string;
  badge?: string;
  badgeTone?: Tone;
  /** The quiet line under the ticker — an id, a setup name, a session stamp. */
  id?: string;
  title: string;
  footLeft?: React.ReactNode;
  footRight?: React.ReactNode;
  tone?: Tone;
  onClick?: () => void;
  href?: string;
  /** Optional body between title and footer — a Spark, a Distribution. */
  children?: React.ReactNode;
  className?: string;
  /** Merged after the card's own --rc var — for per-card CSS custom properties
   *  (e.g. --band-color driving the signal-grid edge stripe). */
  style?: React.CSSProperties;
}) {
  const c = TONE_VAR[tone];
  const bc = TONE_VAR[badgeTone ?? tone];
  const Tag: React.ElementType = href ? 'a' : onClick ? 'button' : 'div';

  return (
    <Tag
      href={href}
      onClick={onClick}
      className={cn(
        'group/rec relative flex min-h-[220px] flex-col overflow-hidden rounded-[2px] border p-5 text-left',
        'border-border bg-foreground/[0.02] transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)]',
        (href || onClick) && 'cursor-pointer',
        'hover:-translate-y-0.5 motion-reduce:hover:translate-y-0',
        className,
      )}
      style={{ ['--rc' as string]: c, ...style }}
    >
      {/* 135° wash — light crossing the surface, not a background swap */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/rec:opacity-100"
        style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${c} 8%, transparent) 0%, transparent 60%)` }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[2px] border border-transparent transition-colors duration-300 group-hover/rec:border-[color:var(--rc)]"
        style={{ borderColor: undefined }}
      />

      <div className="relative z-[1] mb-4 flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold tracking-[0.04em] text-foreground">{ticker}</span>
        {badge && (
          <span
            className="rounded-[1px] border px-1.5 py-[3px] font-mono text-[9px] tracking-[0.14em]"
            style={{ color: bc, borderColor: `color-mix(in srgb, ${bc} 45%, transparent)` }}
          >
            {badge}
          </span>
        )}
      </div>

      {id && (
        <span className="relative z-[1] mb-2.5 font-mono text-[10px] tracking-[0.12em] text-muted-foreground">
          {id}
        </span>
      )}

      <p className="relative z-[1] mb-auto text-sm font-normal leading-[1.45] tracking-[-0.01em] text-foreground/90 transition-colors duration-200 group-hover/rec:text-foreground">
        {title}
      </p>

      {children && <div className="relative z-[1] mt-4">{children}</div>}

      {(footLeft || footRight) && (
        <div className="relative z-[1] mt-[18px] flex items-center justify-between gap-2 border-t border-dashed border-border pt-3.5 font-mono text-[10px] uppercase tracking-[0.06em]">
          <span style={{ color: c }}>{footLeft}</span>
          <span className="text-muted-foreground">{footRight}</span>
        </div>
      )}
    </Tag>
  );
}

// ═════════════════════════════════════════════════════════════════════════════

export function DetailPanel({
  title, onBack, actions, children, footer, className,
}: {
  title: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-md border border-border bg-card', className)}>
      <div className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            className="inline-flex h-[22px] w-[22px] items-center justify-center text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ←
          </button>
        )}
        <span className="text-base font-medium tracking-[-0.01em] text-foreground">{title}</span>
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </div>

      <div className="px-6 py-5">{children}</div>

      {footer && (
        <div className="flex justify-center border-t border-border px-6 py-4">{footer}</div>
      )}
    </div>
  );
}

/** Their `.mdp-act` — a hairline action button whose icon lifts 1px on hover. */
export function PanelAction({ children, onClick, tone = 'structural' }: {
  children: React.ReactNode; onClick?: () => void; tone?: Tone;
}) {
  const c = TONE_VAR[tone];
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border border-border bg-foreground/[0.02] px-3 py-1.5',
        'text-xs text-muted-foreground transition-[color,background,border-color] duration-[250ms]',
        'hover:text-foreground [&>svg]:h-[13px] [&>svg]:w-[13px]',
        '[&>svg]:transition-transform [&>svg]:duration-300 hover:[&>svg]:-translate-y-px',
      )}
      style={{ ['--pa' as string]: c }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `color-mix(in srgb, ${c} 55%, transparent)`;
        e.currentTarget.style.background = `color-mix(in srgb, ${c} 8%, transparent)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '';
        e.currentTarget.style.background = '';
      }}
    >
      {children}
    </button>
  );
}

/** Their `.mdp-row` — a 130px key column against a free-flowing value column. */
export function PanelRow({ k, children, className }: {
  k: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-1 items-start gap-1 sm:grid-cols-[130px_1fr] sm:gap-4', className)}>
      <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-foreground/85">{k}</span>
      <div className="flex flex-col gap-0.5 text-[13px] leading-[1.55] text-muted-foreground">{children}</div>
    </div>
  );
}

export function PanelRows({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-3', className)}>{children}</div>;
}

/**
 * SECTION HEAD — the asymmetric header used above every one of their sections:
 * headline carrying the width on the left, the qualifying paragraph on the
 * right, both bottom-aligned. `.wrap { grid-template-columns: 1.2fr 1fr;
 * align-items: end }`.
 *
 * Bottom alignment is the part people miss. Aligning to the top leaves the
 * paragraph floating beside a two-line headline; aligning to the baseline of the
 * block ties them together as one unit.
 */
export function SectionHead({ eyebrow, title, lede, right, className }: {
  eyebrow?: React.ReactNode; title: React.ReactNode; lede?: React.ReactNode;
  right?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('mb-12 grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-end', className)}>
      <div>
        {eyebrow}
        <h2 className="mt-5 text-3xl font-light leading-[1.06] tracking-[-0.03em] text-foreground sm:text-4xl lg:text-[3.25rem]">
          {title}
        </h2>
      </div>
      {lede ? (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground md:pb-2">{lede}</p>
      ) : (
        right
      )}
    </div>
  );
}
