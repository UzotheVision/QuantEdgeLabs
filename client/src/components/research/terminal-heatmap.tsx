/**
 * TerminalHeatmap — Full-page Strike × Expiry heatmap.
 *
 * Uses the unified HeatseekerToolbar for consistent UX across all exposure pages.
 * Below the toolbar: expiry filters + the full matrix.
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HeatseekerToolbar, type ExposureMode } from '@/components/heatseeker/heatseeker-toolbar';
import { GEXExpiryMatrix } from '@/components/gex/gex-expiry-matrix';
import { useStockContext } from '@/contexts/stock-context';
import { cn } from '@/lib/utils';
import type { GEXTerminalData } from '../../../../shared/gex-types';

export default function TerminalHeatmapPage() {
  const { currentStock } = useStockContext();
  // Initial symbol from context if Research shell set it, otherwise SPY.
  const [symbol, setSymbol] = useState(currentStock?.symbol?.toUpperCase() || 'SPY');
  // Sync local state when global context changes (Research shell switches ticker).
  useEffect(() => {
    if (currentStock?.symbol && currentStock.symbol.toUpperCase() !== symbol) {
      setSymbol(currentStock.symbol.toUpperCase());
    }
  }, [currentStock?.symbol]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<ExposureMode>('gex');
  const [expanded, setExpanded] = useState(false);

  const { data, isFetching, isError, refetch } = useQuery<GEXTerminalData>({
    queryKey: ['/api/gex-vex/terminal', symbol, '15m'],
    queryFn: async () => {
      const res = await fetch(`/api/gex-vex/terminal/${symbol}?interval=15m&lookback=5`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.reason || `Terminal fetch failed: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  const handleSymbolChange = (s: string) => {
    setSymbol(s);
    setExpanded(false);
  };

  return (
    <div className="h-[calc(100dvh-80px)] bg-[var(--surface-base)] flex flex-col overflow-hidden">
      {/* Unified toolbar */}
      <HeatseekerToolbar
        symbol={symbol}
        onSymbolChange={handleSymbolChange}
        mode={mode}
        onModeChange={setMode}
        spotPrice={data?.snapshot.spotPrice}
        onRefresh={() => refetch()}
        isFetching={isFetching}
        extra={
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className={cn(
              'px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest rounded border transition-colors',
              expanded
                ? 'border-amber-400/30 text-amber-400 bg-amber-400/10'
                : 'border-border/30 text-muted-foreground hover:text-foreground'
            )}
          >
            {expanded ? 'COLLAPSE' : 'ALL STRIKES'}
          </button>
        }
      />

      {/* Matrix — uses built-in week dropdown filter */}
      <div className="flex-1 min-h-0 px-4 py-3 flex flex-col">
        {isError ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-3">
              <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--gex-negative)]">
                FAILED TO LOAD {symbol}
              </div>
              <div className="text-[9px] font-mono text-muted-foreground">
                Options data unavailable — market may be closed or data source is down
              </div>
              <button
                type="button"
                onClick={() => refetch()}
                className="px-3 py-1.5 text-[9px] font-mono font-bold uppercase tracking-widest rounded border border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
              >
                RETRY
              </button>
            </div>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-2">
              <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--gex-positive)] animate-pulse">
                LOADING {symbol} EXPOSURES...
              </div>
              <div className="text-[9px] font-mono text-muted-foreground">
                Fetching options chain & computing exposures
              </div>
            </div>
          </div>
        ) : data.strikeExpiryMatrix && data.strikeExpiryMatrix.length > 0 ? (
          <GEXExpiryMatrix
            matrix={data.strikeExpiryMatrix}
            snapshot={data.snapshot}
            externalMode={mode}
            externalExpanded={expanded}
          />
        ) : (
          <div className="flex items-center justify-center h-64">
            <div className="text-[10px] font-mono text-muted-foreground">
              No expiration matrix data for {symbol}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
