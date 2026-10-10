/**
 * QuantEdge Design Tokens — Component Style API
 *
 * This file provides Tailwind class strings for component variants.
 * All colors reference CSS variables defined in index.css (the single source of truth).
 *
 * Usage:
 *   import { componentStyles } from "@/lib/design-tokens";
 *   <div className={componentStyles.card.default} />
 */

// =============================================================================
// COMPONENT STYLES (Tailwind class strings)
// =============================================================================

export const componentStyles = {
  // Card variants
  card: {
    default: 'rounded-lg bg-card border border-card-border',
    glass: 'rounded-lg bg-[var(--surface-glass)] border border-[var(--surface-glass-border)] backdrop-blur-md',
    elevated: 'rounded-lg bg-card border border-card-border shadow-lg',
    interactive: 'rounded-lg bg-card border border-card-border hover:border-[var(--brand-teal)]/30 transition-colors cursor-pointer',
    feature: 'rounded-xl bg-card border border-card-border',
    /** Bloomberg-density card — tighter padding, left accent ready */
    dense: 'rounded-lg bg-card border border-card-border [&_.shadcn-card]:shadow-none',
    /** Accent-left card — colored left border for categorization */
    accentCyan: 'rounded-lg bg-card border border-card-border border-l-2 border-l-[var(--brand-cyan)]',
    accentTeal: 'rounded-lg bg-card border border-card-border border-l-2 border-l-[var(--brand-teal)]',
    accentGold: 'rounded-lg bg-card border border-card-border border-l-2 border-l-[var(--brand-gold)]',
    accentBullish: 'rounded-lg bg-card border border-card-border border-l-2 border-l-[var(--trade-bullish)]',
    accentBearish: 'rounded-lg bg-card border border-card-border border-l-2 border-l-[var(--trade-bearish)]',
    /** Inset card — for nested data blocks within panels */
    inset: 'rounded-md bg-muted/25 border border-border/40 dark:bg-white/[0.015] dark:border-white/[0.04]',
  },

  // Button variants
  button: {
    primary: 'bg-gradient-to-r from-sky-400 to-sky-600 hover:from-sky-300 hover:to-sky-500 text-black font-semibold', // on the canonical brand ramp (cyan-* remapped in tailwind.config)
    secondary: 'bg-secondary hover:bg-secondary/80 text-secondary-foreground font-medium border border-border',
    outline: 'border border-border hover:bg-muted text-foreground font-medium',
    ghost: 'hover:bg-muted/50 text-muted-foreground hover:text-foreground',
    /** Compact action button — for toolbars and dense layouts */
    compact: 'h-7 px-2.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted text-foreground transition-colors',
  },

  // Badge variants
  badge: {
    default: 'px-2 py-0.5 rounded-full bg-muted border border-border text-xs text-muted-foreground',
    accent: 'px-2 py-0.5 rounded-full bg-[var(--brand-teal)]/15 border border-[var(--brand-teal)]/30 text-xs text-[var(--brand-teal)]',
    success: 'px-2 py-0.5 rounded-full bg-[var(--trade-bullish)]/15 border border-[var(--trade-bullish)]/30 text-xs text-[var(--trade-bullish)]',
    warning: 'px-2 py-0.5 rounded-full bg-[var(--trade-neutral)]/15 border border-[var(--trade-neutral)]/30 text-xs text-[var(--trade-neutral)]',
    error: 'px-2 py-0.5 rounded-full bg-[var(--trade-bearish)]/15 border border-[var(--trade-bearish)]/30 text-xs text-[var(--trade-bearish)]',
    cyan: 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--brand-cyan)]/10 border border-[var(--brand-cyan)]/25 text-[var(--brand-cyan)]',
    bullish: 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--trade-bullish)]/10 border border-[var(--trade-bullish)]/25 text-[var(--trade-bullish)]',
    bearish: 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--trade-bearish)]/10 border border-[var(--trade-bearish)]/25 text-[var(--trade-bearish)]',
    gold: 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--brand-gold)]/10 border border-[var(--brand-gold)]/25 text-[var(--brand-gold)]',
    ai: 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-violet-500/10 border border-violet-500/25 text-violet-400',
    live: 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--trade-bullish)]/10 border border-[var(--trade-bullish)]/25 text-[var(--trade-bullish)]',
    delayed: 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-500/10 border border-amber-500/25 text-amber-400',
    closed: 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-muted/10 border border-border text-muted-foreground',
  },

  // Input styles
  input: {
    default: 'rounded-lg bg-muted/50 border border-border px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-[var(--brand-teal)]/50 focus:ring-1 focus:ring-[var(--brand-teal)]/20 transition-colors',
    /** Compact input for data-dense panels */
    compact: 'rounded-md bg-muted/50 border border-border px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-[var(--brand-teal)]/50 focus:ring-1 focus:ring-[var(--brand-teal)]/20 transition-colors font-mono',
  },

  // Section styles
  section: {
    default: 'py-16 md:py-24',
    compact: 'py-8 md:py-12',
    /** Dense section — Bloomberg terminal spacing */
    dense: 'py-4 md:py-6',
  },

  // Container styles
  container: {
    default: 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8',
    narrow: 'max-w-4xl mx-auto px-4 sm:px-6 lg:px-8',
    wide: 'max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8',
    /** Full-bleed — edge-to-edge data layout */
    flush: 'max-w-[1600px] mx-auto px-3 sm:px-4',
  },

  // Panel variants (used by QEPanel system)
  panel: {
    default: 'rounded-lg bg-[var(--surface-glass)] border border-[var(--surface-glass-border)] backdrop-blur-md',
    glass: 'rounded-lg bg-[var(--surface-glass)] border border-[var(--surface-glass-border)] backdrop-blur-xl',
    nested: 'rounded-md bg-foreground/[0.03] border border-foreground/[0.05]',
    interactive: 'rounded-lg bg-[var(--surface-glass)] border border-[var(--surface-glass-border)] backdrop-blur-md hover:border-[var(--brand-cyan)]/20 hover:shadow-[0_0_24px_var(--glow-cyan)] transition-all duration-200 cursor-pointer',
    stat: 'rounded-lg bg-foreground/[0.03] border border-foreground/[0.06]',
    layer: 'rounded-lg border border-dashed border-foreground/[0.10] bg-transparent',
    /** Bloomberg panel — chrome header + tight body */
    bloomberg: 'rounded-lg bg-card border border-card-border overflow-hidden [&>.panel-header]:flex [&>.panel-header]:items-center [&>.panel-header]:justify-between [&>.panel-header]:px-3 [&>.panel-header]:py-2 [&>.panel-header]:border-b [&>.panel-header]:border-border [&>.panel-header]:bg-muted/30 [&>.panel-body]:p-3',
  },

  // Text utility classes
  text: {
    sectionMarker: 'text-[10px] font-mono font-medium text-muted-foreground uppercase tracking-widest mb-0.5',
    statLabel: 'text-[11px] font-medium text-muted-foreground uppercase tracking-wide',
    /** Mono data — for any numerical value display */
    dataValue: 'font-mono tabular-nums text-foreground',
    /** Price — large mono number */
    price: 'font-mono tabular-nums font-semibold tracking-tight text-foreground',
    /** Ticker symbol */
    ticker: 'font-mono font-semibold tracking-wider uppercase',
    /** Percent change */
    change: 'font-mono tabular-nums text-xs font-medium',
    /** Section chrome label */
    chromeLabel: 'text-[9px] font-mono font-semibold uppercase tracking-[0.12em] text-muted-foreground',
  },

  // Tab trigger variants
  tab: {
    /** Underline tab — minimal, used in Trade Desk sub-tabs */
    underline: 'relative rounded-none border-b-2 border-transparent px-3 pb-2 pt-0.5 text-xs font-mono font-medium text-muted-foreground transition-all data-[state=active]:border-[var(--brand-teal)] data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none hover:text-foreground/80',
    /** Pill tab — rounded pill with background change */
    pill: 'rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-all data-[state=active]:bg-[var(--brand-teal)]/15 data-[state=active]:text-[var(--brand-teal)] hover:text-foreground/80',
  },

  // Section header — gradient accent bar + title + optional action
  sectionHeader: {
    /** Container */
    wrapper: 'flex items-center justify-between mb-3',
    /** Left side: accent bar + icon + title */
    left: 'flex items-center gap-2',
    /** Gradient accent bar */
    accent: 'w-0.5 h-3.5 rounded-full bg-gradient-to-b from-[var(--brand-teal)] to-[var(--brand-cyan)]',
    /** Title text */
    title: 'text-sm font-semibold text-foreground',
    /** Optional count badge */
    count: 'text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full',
  },

  // Status indicator dots
  status: {
    online: 'w-2 h-2 rounded-full bg-[var(--trade-bullish)] shadow-[0_0_6px_var(--trade-bullish)]',
    warning: 'w-2 h-2 rounded-full bg-[var(--trade-neutral)] shadow-[0_0_6px_var(--trade-neutral)]',
    error: 'w-2 h-2 rounded-full bg-[var(--trade-bearish)] shadow-[0_0_6px_var(--trade-bearish)]',
    live: 'w-2 h-2 rounded-full bg-lime-400 shadow-[0_0_6px_rgba(182,255,51,0.5)] animate-pulse',
  },

  // Grade letter badges
  // Grade letter badges — desaturated: neutral bg, only text has color
  grade: {
    S: 'bg-foreground/[0.05] border border-foreground/[0.12] text-[var(--grade-s)]',
    A: 'bg-foreground/[0.04] border border-foreground/[0.10] text-[var(--grade-a)]',
    B: 'bg-foreground/[0.03] border border-foreground/[0.08] text-muted-foreground',
    C: 'bg-foreground/[0.02] border border-foreground/[0.06] text-[var(--grade-c)]',
    D: 'bg-foreground/[0.02] border border-foreground/[0.06] text-[var(--grade-d)]',
    F: 'bg-foreground/[0.02] border border-foreground/[0.06] text-[var(--grade-f)]',
  },

  // GEX / Skylit terminal styling — yellow walls, purple puts, cyan projection
  gex: {
    /** Call wall pill — yellow/gold (positive gamma zone) */
    wallCall: 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--gex-positive)]/15 border border-[var(--gex-positive)]/40 text-[var(--gex-positive)]',
    /** Put wall pill — purple (negative gamma zone) */
    wallPut: 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--gex-negative)]/15 border border-[var(--gex-negative)]/40 text-[var(--gex-negative)]',
    /** Gamma flip line pill — orange (transition zone) */
    flip: 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--gex-flip)]/15 border border-[var(--gex-flip)]/40 text-[var(--gex-flip)]',
    /** Max gamma star — yellow glow */
    star: 'text-[var(--gex-star)] drop-shadow-[0_0_6px_var(--gex-star)]',
    /** Alert ring — red pulse */
    alert: 'ring-1 ring-[var(--gex-alert)] shadow-[0_0_12px_rgba(239,68,68,0.4)]',
    /** Heatmap cell — call side (positive) */
    cellCall: 'bg-[var(--gex-positive-bg)] border border-[var(--gex-positive)]/25',
    /** Heatmap cell — put side (negative) */
    cellPut: 'bg-[var(--gex-negative-bg)] border border-[var(--gex-negative)]/25',
    /** Heatmap cell — neutral baseline */
    cellNeutral: 'bg-[var(--gex-neutral-bg)] border border-border/40',
    /** Projection arc glow — cyan */
    projection: 'stroke-[var(--projection-glow)] drop-shadow-[0_0_8px_var(--projection-glow)]',
    /** Terminal shell — black panel w/ yellow accent edge */
    terminal: 'rounded-lg bg-[var(--surface-base)] border border-[var(--gex-positive)]/20 shadow-[0_0_40px_rgba(250,204,21,0.04)]',
    /** Terminal header bar */
    terminalHeader: 'flex items-center justify-between px-3 py-2 border-b border-[var(--gex-positive)]/15 bg-[var(--surface-raised)]',
    /** Mode toggle button (Orbs/Heatmap/Projection) */
    modeButton: 'h-7 px-2.5 text-[10px] font-mono font-semibold uppercase tracking-wider rounded-md border border-border bg-transparent hover:bg-[var(--gex-positive)]/10 hover:border-[var(--gex-positive)]/40 hover:text-[var(--gex-positive)] transition-colors',
    /** Mode toggle button — active state */
    modeButtonActive: 'h-7 px-2.5 text-[10px] font-mono font-semibold uppercase tracking-wider rounded-md border border-[var(--gex-positive)]/50 bg-[var(--gex-positive)]/15 text-[var(--gex-positive)] shadow-[0_0_12px_rgba(250,204,21,0.15)]',
    /** Confluence score badge — dynamic tier */
    scoreElite: 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--gex-positive)]/20 border border-[var(--gex-positive)]/50 text-[var(--gex-positive)]',
    scoreStrong: 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--brand-cyan)]/20 border border-[var(--brand-cyan)]/50 text-[var(--brand-cyan)]',
    scoreWeak: 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-muted border border-border text-muted-foreground',
  },

  // Data density helpers — use on parent container to tighten child spacing
  density: {
    /** Bloomberg compact — minimal spacing everywhere */
    compact: '[&_.p-6]:p-3 [&_.p-4]:p-2.5 [&_.space-y-4]:space-y-2 [&_.space-y-3]:space-y-1.5 [&_.gap-4]:gap-2 [&_.gap-3]:gap-1.5 [&_.text-2xl]:text-lg [&_.text-xl]:text-base [&_.mb-6]:mb-3 [&_.mb-4]:mb-2',
    /** Comfortable default */
    comfortable: '',
  },
} as const;

// =============================================================================
// PAGE BACKGROUNDS
// =============================================================================

export const backgrounds = {
  grid: {
    image: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
    size: '60px 60px',
  },
} as const;

// =============================================================================
// Z-INDEX SCALE
// =============================================================================

export const zIndex = {
  base: 0,
  behind: -1,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modalBackdrop: 40,
  modal: 50,
  popover: 60,
  tooltip: 70,
  toast: 80,
} as const;

// =============================================================================
// WORKSPACE PRESETS — Layout configurations for resizable panel grids
// =============================================================================

export const workspacePresets = {
  single: {
    cols: 1,
    rows: 1,
    template: "1fr",
    label: "Single",
  },
  split: {
    cols: 2,
    rows: 1,
    template: "1fr 1fr",
    label: "Split",
  },
  tripleSplit: {
    cols: 3,
    rows: 1,
    template: "1fr 1fr 1fr",
    label: "Triple",
  },
  sidebar: {
    cols: 2,
    rows: 1,
    template: "320px 1fr",
    label: "Sidebar",
  },
  tradeDesk: {
    cols: 2,
    rows: 2,
    template: "1.5fr 1fr",
    label: "Trade Desk",
  },
  quad: {
    cols: 2,
    rows: 2,
    template: "1fr 1fr",
    label: "Quad",
  },
} as const;

// =============================================================================
// TRADING COLOR SEMANTICS — colour means one thing on this platform, always.
// (moved here from lib/oracle/trading-colors.ts — this file is the single token module)
//
//   GREEN  — long / bullish / in profit. Direction and P&L ONLY.
//   RED    — short / bearish / at a loss / invalidation risk.
//   AMBER  — waiting or caution: pending trigger, near stop, time running out.
//   CYAN   — structural + neutral information (levels, spot, UI accents). Never a
//            directional claim. Deliberately kept distinct from bullish green.
//   MUTED  — inert / closed / no reading.
//
// Non-directional health bars (validity, pace) must NOT use green/red, or a strong
// BEARISH setup renders green and reads as bullish. They use the neutral ramp below.
// =============================================================================

export const TC = {
  bull:    'var(--trade-bullish, #22c55e)',
  bear:    'var(--trade-bearish, #ef4444)',
  warn:    '#e0a458',
  info:    'var(--brand-cyan, #3b8cff)',
  muted:   'var(--muted-foreground, #8b98a8)',
  neutral: 'var(--foreground, #e6edf3)',
} as const;

/** Direction colour — the only place green/red may be chosen from a side. */
export function directionColor(direction: 'long' | 'short' | string): string {
  return direction === 'short' ? TC.bear : TC.bull;
}

/** P&L colour — green in profit, red at a loss, muted at flat. */
export function pnlColor(pct: number, flatEpsilon = 0.01): string {
  if (Math.abs(pct) < flatEpsilon) return TC.muted;
  return pct > 0 ? TC.bull : TC.bear;
}

/**
 * Health ramp for NON-directional 0–100 metrics (validity, pace, overlay, structure).
 * Cyan→amber→red: strength without implying a market direction.
 */
export function healthColor(v: number): string {
  if (v >= 66) return TC.info;
  if (v >= 33) return TC.warn;
  return TC.bear;
}

/** Status colour for a signal's lifecycle state. */
export function statusColor(status: string): string {
  switch (status) {
    case 'at_target':       return TC.bull;
    case 'invalidated':     return TC.bear;
    case 'near_stop':       return TC.bear;
    case 'pending_trigger': return TC.warn;
    case 'closed':          return TC.muted;
    default:                return TC.info; // in play — structural, not directional
  }
}

/**
 * How much of the risk budget is spent. This IS directional in meaning (against the
 * trade), so red is correct as it climbs.
 */
export function riskColor(pctUsed: number): string {
  if (pctUsed >= 75) return TC.bear;
  if (pctUsed >= 40) return TC.warn;
  return TC.muted;
}

/**
 * BAND COLOUR — S / A / B / C must be visually distinct.
 *
 * Every band was rendering in the same colour, so "ELITE BULLISH" and "MED BULLISH" looked
 * identical and the grade carried no visual weight at all. Direction still owns green/red,
 * so the band gets its own ramp: gold for elite (rare, earns attention), cyan for strong,
 * slate for ordinary, muted for weak. Reading the ramp tells you the tier before you read
 * the word.
 */
export function bandColor(band?: string | null): string {
  switch ((band ?? '').toUpperCase()) {
    case 'S': return '#e0a458';                       // gold — elite
    case 'A': return 'var(--brand-cyan, #3b8cff)';    // cyan — strong
    case 'B': return '#7aa2f7';                       // slate blue — solid
    default:  return 'var(--muted-foreground, #8b98a8)';
  }
}

/**
 * Fill colour for a confidence meter, graded by the score itself rather than one flat
 * accent — so a 90 and a 40 don't look the same length-adjusted.
 */
export function confidenceFill(score: number): string {
  if (score >= 85) return '#e0a458';
  if (score >= 70) return 'var(--brand-cyan, #3b8cff)';
  if (score >= 50) return '#7aa2f7';
  if (score >= 30) return '#8b98a8';
  return 'var(--trade-bearish, #ef4444)';
}
