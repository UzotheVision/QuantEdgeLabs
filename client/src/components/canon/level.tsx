/**
 * CANON · LEVEL
 *
 * One vocabulary for a price level. GEX already had the right one in
 * components/gex/gex-level-badge (ROLE_LABELS: CALL WALL / PUT WALL / FLIP /
 * MAX γ / SUPPORT / RESISTANCE) while Prism and signal-detail's PriceLadder
 * named the same structures differently — so a level that is a "call wall" on
 * one tab appeared under another name on the next.
 *
 * ROLE_LABELS is promoted verbatim rather than redesigned; it was the best of
 * the three and the wording is already what a desk says out loud. What is added
 * is the plan-level vocabulary the ladder needs (ENTRY / STOP / TARGET / LIVE)
 * so both families live in one place instead of two.
 *
 * Colour is by MEANING, not by position: a wall is resistance-coloured wherever
 * it appears, so the reader learns one mapping instead of one per tab.
 */
import { cn } from '@/lib/utils';

export type LevelRole =
  | 'call_wall' | 'put_wall' | 'flip' | 'max_gamma' | 'support' | 'resistance' | 'neutral'
  | 'entry' | 'stop' | 'target' | 'live';

export const LEVEL_LABELS: Record<LevelRole, string> = {
  call_wall: 'CALL WALL',
  put_wall: 'PUT WALL',
  flip: 'FLIP',
  max_gamma: 'MAX γ',
  support: 'SUPPORT',
  resistance: 'RESISTANCE',
  neutral: 'STRIKE',
  entry: 'ENTRY',
  stop: 'STOP',
  target: 'TARGET',
  live: 'LIVE',
};

export function levelColor(role: LevelRole): string {
  switch (role) {
    case 'call_wall':
    case 'resistance':
    case 'target':
      return 'var(--trade-bullish)';
    case 'put_wall':
    case 'support':
      return 'var(--trade-bearish)';
    case 'stop':
      return 'var(--trade-bearish)';
    case 'flip':
      return 'var(--gex-flip, var(--brand-gold))';
    case 'max_gamma':
      return 'var(--brand-gold)';
    // Entry is the frozen structural reference from the published plan. Cyan is
    // reserved for that across the terminal — do not reuse it for live price.
    case 'entry':
      return 'var(--brand-cyan)';
    case 'live':
      return 'var(--foreground)';
    default:
      return 'var(--muted-foreground)';
  }
}

export function CanonLevelBadge({
  role,
  price,
  className,
}: {
  role: LevelRole;
  price?: number | null;
  className?: string;
}) {
  const color = levelColor(role);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-label font-bold uppercase tracking-wider',
        className,
      )}
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
      }}
    >
      {LEVEL_LABELS[role]}
      {typeof price === 'number' && Number.isFinite(price) && (
        <span className="tabular-nums opacity-80">${price}</span>
      )}
    </span>
  );
}
