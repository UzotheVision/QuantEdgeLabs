/**
 * HeatseekerToolbar — Unified toolbar for ALL exposure pages.
 *
 * Skylit pattern: one consistent toolbar across Chart, Heatmaps, Index Mode.
 * Same ticker tabs, same GEX/VEX toggle, same controls — everywhere.
 *
 * Row 1: Ticker tabs (quick picks + custom input)
 * Row 2: GEX/VEX toggle | symbol info (price + change) | nav arrows | interval | sort | view
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, RefreshCw, Settings2 } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────
export type ExposureMode = 'gex' | 'vex';
export type ToolbarInterval = '1m' | '3m' | '5m' | '15m' | '1h' | '4h' | '1d';

const INTERVALS: ToolbarInterval[] = ['1m', '3m', '5m', '15m', '1h', '4h', '1d'];
const QUICK_TICKERS = ['SPY', 'TSLA', 'QQQ', 'SPXW', 'NVDA', 'AAPL'];

interface HeatseekerToolbarProps {
  /** Current active symbol */
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  /** GEX or VEX mode */
  mode?: ExposureMode;
  onModeChange?: (mode: ExposureMode) => void;
  /** Chart interval — only shown when showInterval is true */
  interval?: ToolbarInterval;
  onIntervalChange?: (interval: ToolbarInterval) => void;
  showInterval?: boolean;
  /** Spot price and change for current symbol */
  spotPrice?: number;
  priceChange?: number;
  priceChangePct?: number;
  /** Refresh / loading state */
  onRefresh?: () => void;
  isFetching?: boolean;
  /** Extra controls slot (right side) */
  extra?: React.ReactNode;
}

// ─── Sub-components ──────────────────────────────────────────────

function PillButton({
  active,
  onClick,
  children,
  activeClass,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  activeClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-widest rounded transition-colors',
        active
          ? activeClass || 'bg-[var(--gex-positive)]/15 text-[var(--gex-positive)] ring-1 ring-[var(--gex-positive)]/30'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
      )}
    >
      {children}
    </button>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function HeatseekerToolbar({
  symbol,
  onSymbolChange,
  mode = 'gex',
  onModeChange,
  interval = '15m',
  onIntervalChange,
  showInterval = false,
  spotPrice,
  priceChange,
  priceChangePct,
  onRefresh,
  isFetching = false,
  extra,
}: HeatseekerToolbarProps) {
  const [customInput, setCustomInput] = useState('');

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customInput.trim()) {
      onSymbolChange(customInput.trim().toUpperCase());
      setCustomInput('');
    }
  };

  // Cycle through tickers with < > arrows
  const allTickers = QUICK_TICKERS;
  const currentIdx = allTickers.indexOf(symbol);
  const handlePrev = () => {
    if (currentIdx > 0) onSymbolChange(allTickers[currentIdx - 1]);
    else if (currentIdx === -1 && allTickers.length > 0) onSymbolChange(allTickers[allTickers.length - 1]);
  };
  const handleNext = () => {
    if (currentIdx >= 0 && currentIdx < allTickers.length - 1) onSymbolChange(allTickers[currentIdx + 1]);
    else if (currentIdx === -1 && allTickers.length > 0) onSymbolChange(allTickers[0]);
  };

  const isUp = (priceChange ?? 0) >= 0;

  return (
    <div className="border-b border-border/30 bg-[var(--surface-raised)]">
      {/* Row 1: Ticker tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border/15 overflow-x-auto">
        {QUICK_TICKERS.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => onSymbolChange(t)}
            className={cn(
              'px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider rounded transition-colors whitespace-nowrap',
              t === symbol
                ? 'bg-foreground/10 text-foreground ring-1 ring-foreground/20'
                : 'text-muted-foreground hover:text-muted-foreground hover:bg-muted/10'
            )}
          >
            {t}
          </button>
        ))}
        <form onSubmit={handleCustomSubmit} className="ml-1">
          <input
            type="text"
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            placeholder="+"
            className="w-10 px-1.5 py-1 text-[10px] font-mono font-bold uppercase text-center bg-transparent border border-border/30 rounded text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[var(--gex-positive)]/50 focus:w-16 transition-all"
          />
        </form>
      </div>

      {/* Row 2: GEX/VEX | symbol info | nav arrows | interval | extras */}
      <div className="flex items-center justify-between gap-3 px-4 py-1.5 flex-wrap">
        {/* Left group: GEX/VEX + symbol info */}
        <div className="flex items-center gap-2">
          {/* GEX / VEX toggle */}
          {onModeChange && (
            <div className="flex gap-0.5 p-0.5 rounded bg-[var(--surface-base)] border border-border/30">
              <button
                type="button"
                onClick={() => onModeChange('gex')}
                className={cn(
                  'px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded transition-colors',
                  mode === 'gex'
                    ? 'bg-[var(--gex-positive)]/15 text-[var(--gex-positive)]'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                GEX
              </button>
              <button
                type="button"
                onClick={() => onModeChange('vex')}
                className={cn(
                  'px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded transition-colors',
                  mode === 'vex'
                    ? 'bg-violet-400/15 text-violet-400'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                VEX
              </button>
            </div>
          )}

          {/* Nav arrows */}
          <button type="button" onClick={handlePrev} className="p-0.5 text-muted-foreground hover:text-muted-foreground transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {/* Symbol info block */}
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="font-bold text-foreground">{symbol}</span>
            {spotPrice !== undefined && (
              <>
                <span className="text-muted-foreground">•</span>
                <span className="text-foreground tabular-nums">${spotPrice.toFixed(2)}</span>
                {priceChange !== undefined && (
                  <span className={cn('tabular-nums', isUp ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]')}>
                    {isUp ? '+' : ''}{priceChange.toFixed(2)}
                  </span>
                )}
                {priceChangePct !== undefined && (
                  <span className={cn(
                    'px-1 py-0.5 rounded text-[9px] font-bold',
                    isUp ? 'bg-[var(--trade-bullish)]/15 text-[var(--trade-bullish)]' : 'bg-[var(--trade-bearish)]/15 text-[var(--trade-bearish)]'
                  )}>
                    ({isUp ? '+' : ''}{priceChangePct.toFixed(2)}%)
                  </span>
                )}
              </>
            )}
          </div>

          {/* Nav arrows */}
          <button type="button" onClick={handleNext} className="p-0.5 text-muted-foreground hover:text-muted-foreground transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right group: interval + refresh + extras */}
        <div className="flex items-center gap-2">
          {/* Interval picker */}
          {showInterval && onIntervalChange && (
            <div className="flex gap-0.5 p-0.5 rounded bg-[var(--surface-base)] border border-border/30">
              {INTERVALS.map(iv => (
                <button
                  key={iv}
                  type="button"
                  onClick={() => onIntervalChange(iv)}
                  className={cn(
                    'px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase rounded transition-colors',
                    interval === iv
                      ? 'bg-[var(--gex-positive)]/15 text-[var(--gex-positive)]'
                      : 'text-muted-foreground hover:text-muted-foreground'
                  )}
                >
                  {iv}
                </button>
              ))}
            </div>
          )}

          {/* Refresh */}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isFetching}
              className="p-1 text-muted-foreground hover:text-muted-foreground transition-colors"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin text-amber-400')} />
            </button>
          )}

          {/* Extra controls from parent */}
          {extra}
        </div>
      </div>
    </div>
  );
}
