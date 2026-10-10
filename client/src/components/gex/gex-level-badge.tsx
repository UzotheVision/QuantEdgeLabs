/**
 * GEXLevelBadge — small pill labeling a strike as call wall / put wall / flip / max.
 */

import { componentStyles } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';
import type { GEXLevel } from '../../../../shared/gex-types';

interface GEXLevelBadgeProps {
  level: GEXLevel;
  showGamma?: boolean;
  compact?: boolean;
}

const ROLE_LABELS: Record<GEXLevel['role'], string> = {
  call_wall: 'CALL WALL',
  put_wall: 'PUT WALL',
  flip: 'FLIP',
  max_gamma: 'MAX γ',
  support: 'SUPPORT',
  resistance: 'RESISTANCE',
  neutral: 'STRIKE',
};

export function GEXLevelBadge({ level, showGamma = true, compact = false }: GEXLevelBadgeProps) {
  const style =
    level.role === 'call_wall' || level.role === 'resistance'
      ? componentStyles.gex.wallCall
      : level.role === 'put_wall' || level.role === 'support'
        ? componentStyles.gex.wallPut
        : level.role === 'flip'
          ? componentStyles.gex.flip
          : level.role === 'max_gamma'
            ? componentStyles.gex.wallCall
            : componentStyles.badge.default;

  return (
    <div className={cn(style, compact && 'px-1.5 py-0')} data-testid={`gex-level-${level.strike}`}>
      {level.role === 'max_gamma' && (
        <span className={componentStyles.gex.star}>★</span>
      )}
      <span>{ROLE_LABELS[level.role]}</span>
      <span className="tabular-nums font-bold">${level.strike.toFixed(0)}</span>
      {showGamma && (
        <span className="tabular-nums opacity-70">{(level.gammaPct * 100).toFixed(1)}%</span>
      )}
    </div>
  );
}
