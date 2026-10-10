/**
 * Numeric primitives — the design law: EVERY number on the platform renders in
 * IBM Plex Mono with tabular-nums + slashed-zero. These are the only sanctioned
 * way to print a raw number, percent, price, or ticker symbol. No more ad-hoc
 * `font-mono tabular-nums` spans drifting per page.
 *
 *   <Num value={7874} />                      → 7,874
 *   <Num value={4.18e9} compact />            → 4.18B
 *   <Pct value={7.42} />                      → +7.42%  (green, sign-colored)
 *   <Price value={156.09} />                  → $156.09
 *   <Price value={156.09} size="xl" tone="auto" delta /> big hero price
 *   <Ticker symbol="AVGO" />                  → AVGO (uppercase mono tracked)
 */
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

// IBM Plex Mono slashed-zero + tabular lining figures — the QE number look.
const FIGURES: CSSProperties = { fontFeatureSettings: '"zero" 1, "tnum" 1, "lnum" 1' };

export type NumTone = 'auto' | 'bull' | 'bear' | 'neutral' | 'muted' | 'foreground';

const TONE: Record<Exclude<NumTone, 'auto'>, string> = {
  bull: 'text-[var(--trade-bullish)]',
  bear: 'text-[var(--trade-bearish)]',
  neutral: 'text-[var(--trade-neutral)]',
  muted: 'text-muted-foreground',
  foreground: 'text-foreground',
};

function signTone(n: number): string {
  return n > 0 ? TONE.bull : n < 0 ? TONE.bear : TONE.neutral;
}

function toNum(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function fmt(n: number, decimals?: number, compact?: boolean): string {
  if (compact) {
    const abs = Math.abs(n);
    if (abs >= 1e12) return (n / 1e12).toFixed(decimals ?? 2) + 'T';
    if (abs >= 1e9) return (n / 1e9).toFixed(decimals ?? 2) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(decimals ?? 2) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(decimals ?? 1) + 'K';
  }
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? (Number.isInteger(n) ? 0 : 2),
  });
}

function toneClass(n: number | null, tone: NumTone): string {
  if (n === null) return TONE.muted;
  if (tone === 'auto') return signTone(n);
  return TONE[tone];
}

// ─── Num ─────────────────────────────────────────────────────
export interface NumProps {
  value: number | null | undefined;
  decimals?: number;
  compact?: boolean;
  tone?: NumTone;
  className?: string;
  fallback?: string;
}

export function Num({ value, decimals, compact, tone = 'foreground', className, fallback = '—' }: NumProps) {
  const n = toNum(value);
  return (
    <span style={FIGURES} className={cn('font-mono tabular-nums', toneClass(n, tone), className)}>
      {n === null ? fallback : fmt(n, decimals, compact)}
    </span>
  );
}

// ─── Pct (value of 7.42 → "+7.42%") ──────────────────────────
export interface PctProps {
  value: number | null | undefined;
  decimals?: number;
  tone?: NumTone; // default 'auto' (sign-colored)
  showSign?: boolean;
  className?: string;
  fallback?: string;
}

export function Pct({ value, decimals = 2, tone = 'auto', showSign = true, className, fallback = '—' }: PctProps) {
  const n = toNum(value);
  const sign = n !== null && showSign && n > 0 ? '+' : '';
  return (
    <span style={FIGURES} className={cn('font-mono tabular-nums', toneClass(n, tone), className)}>
      {n === null ? fallback : `${sign}${n.toFixed(decimals)}%`}
    </span>
  );
}

// ─── Price ───────────────────────────────────────────────────
export type PriceSize = 'sm' | 'md' | 'lg' | 'xl';
const PRICE_SIZE: Record<PriceSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
  xl: 'text-3xl',
};

export interface PriceProps {
  value: number | null | undefined;
  decimals?: number;
  currency?: string;
  compact?: boolean;
  tone?: NumTone; // default 'foreground'
  size?: PriceSize;
  className?: string;
  fallback?: string;
}

export function Price({
  value,
  decimals = 2,
  currency = '$',
  compact,
  tone = 'foreground',
  size = 'md',
  className,
  fallback = '—',
}: PriceProps) {
  const n = toNum(value);
  return (
    <span style={FIGURES} className={cn('font-mono font-semibold tabular-nums', PRICE_SIZE[size], toneClass(n, tone), className)}>
      {n === null ? fallback : `${n < 0 ? '-' : ''}${currency}${fmt(Math.abs(n), decimals, compact)}`}
    </span>
  );
}

// ─── Ticker ──────────────────────────────────────────────────
export interface TickerProps {
  symbol: string;
  className?: string;
}

export function Ticker({ symbol, className }: TickerProps) {
  return (
    <span className={cn('font-mono font-semibold uppercase tracking-[0.04em] text-foreground', className)}>
      {symbol}
    </span>
  );
}
