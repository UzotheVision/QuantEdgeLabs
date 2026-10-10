/**
 * GEXHeatmapGrid — strike × intensity grid showing gamma concentration.
 * Skylit-style: yellow cells for calls, purple for puts, size reflects magnitude.
 */

import type { HeatmapCell } from '../../../../shared/gex-types';
import { formatGEX } from '../../../../shared/gex-types';
import { cn } from '@/lib/utils';

interface GEXHeatmapGridProps {
  cells: HeatmapCell[];
  spotPrice: number;
}

export function GEXHeatmapGrid({ cells, spotPrice }: GEXHeatmapGridProps) {
  if (cells.length === 0) {
    return (
      <div className="p-6 text-center text-xs font-mono text-muted-foreground">
        No heatmap data
      </div>
    );
  }

  const sorted = [...cells].sort((a, b) => b.strike - a.strike);
  const maxIntensity = Math.max(...cells.map((c) => c.intensity), 0.01);

  return (
    <div className="space-y-px" data-testid="gex-heatmap-grid">
      {sorted.map((cell) => {
        const pct = (cell.intensity / maxIntensity) * 100;
        const isCall = cell.side === 'call';
        const isNear = Math.abs(cell.strike - spotPrice) / spotPrice < 0.003;
        return (
          <div
            key={cell.strike}
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-sm border text-[10px] font-mono transition-all',
              isNear && 'ring-1 ring-[var(--projection-glow)]/60',
              isCall
                ? 'bg-[var(--gex-positive-bg)] border-[var(--gex-positive)]/30 text-[var(--gex-positive)]'
                : 'bg-[var(--gex-negative-bg)] border-[var(--gex-negative)]/30 text-[var(--gex-negative)]',
            )}
          >
            <span className="w-14 text-right font-semibold tabular-nums">
              ${cell.strike.toFixed(0)}
            </span>
            <div className="flex-1 h-4 bg-black/40 rounded-sm overflow-hidden relative">
              <div
                className={cn(
                  'absolute inset-y-0 left-0 transition-all',
                  isCall ? 'bg-[var(--gex-positive)]' : 'bg-[var(--gex-negative)]',
                )}
                style={{ width: `${pct}%`, opacity: 0.55 }}
              />
            </div>
            <span className="w-16 text-right tabular-nums">{formatGEX(cell.gex)}</span>
          </div>
        );
      })}
    </div>
  );
}
