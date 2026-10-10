/**
 * PAGE SHELL — the site template.
 *
 * The app has 60 pages. Nine referenced any shared chrome; 34 defined their own
 * full-height wrapper; and eight different container widths were in use
 * (max-w-md through max-w-[1600px]). Every page was its own island, which is why
 * the site reads as a set of screens rather than a product — no amount of palette
 * work fixes that, because the inconsistency is structural.
 *
 * One shell, three widths, one vertical rhythm. A page picks a width and a header
 * and gets everything else for free. Deviating is still possible, but it now has
 * to be a decision rather than an accident.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Three widths, named for what they hold — not for a Tailwind number. Eight
 * arbitrary max-widths is how a site ends up with no measure.
 */
export const WIDTH = {
  /** Dense data. Tables, boards, the Terminal. */
  wide: 'max-w-[1600px]',
  /** Standard content: most pages. */
  page: 'max-w-6xl',
  /** Prose. Long-form reading, settings, docs — a real measure, ~70ch. */
  read: 'max-w-3xl',
} as const;

export type PageWidth = keyof typeof WIDTH;

export function PageShell({
  children,
  width = 'page',
  header,
  className,
  /** Dense surfaces manage their own padding; prose pages want the rhythm. */
  flush = false,
}: {
  children: ReactNode;
  width?: PageWidth;
  header?: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <div className={cn('min-h-screen bg-background text-foreground', className)}>
      {header}
      <main className={cn('mx-auto w-full px-4 sm:px-6', WIDTH[width], flush ? 'py-0' : 'py-8 sm:py-10')}>
        {children}
      </main>
    </div>
  );
}

/**
 * PAGE HEADER — title, optional context, optional actions. Every page had its own
 * heading treatment; this is the one that applies unless a page has a stated
 * reason not to use it.
 */
export function PageHeader({
  eyebrow, title, description, actions, className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex items-start justify-between gap-4 flex-wrap', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="ui-eyebrow text-[10px] text-[var(--brand-cyan)]">{eyebrow}</div>
        )}
        <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="ui-prose mt-1.5 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * SECTION — vertical rhythm. Pages were spacing sections with whatever margin the
 * author reached for, so the page had no beat. One scale, three steps.
 */
export function Section({
  children, gap = 'base', className,
}: { children: ReactNode; gap?: 'tight' | 'base' | 'loose'; className?: string }) {
  const pad = gap === 'tight' ? 'py-4' : gap === 'loose' ? 'py-12' : 'py-7';
  return <section className={cn(pad, className)}>{children}</section>;
}

/**
 * SURFACE — the one card. Every page rolled its own border/radius/background
 * combination; this is the shared one so a card looks like a card everywhere.
 */
export function Surface({
  children, title, meta, className, padded = true,
}: {
  children: ReactNode;
  title?: string;
  meta?: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={cn('rounded-xl border border-card-border bg-card overflow-hidden', className)}>
      {(title || meta) && (
        <div className="flex items-center justify-between gap-2 border-b border-border/40 px-4 py-2.5">
          {title && <span className="ui-eyebrow text-[11px] text-foreground/80">{title}</span>}
          {meta}
        </div>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </div>
  );
}
