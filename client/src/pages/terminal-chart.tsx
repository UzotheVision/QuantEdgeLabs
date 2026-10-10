/**
 * GEX Terminal — Per-ticker gamma exposure analysis.
 *
 * Skylit-inspired layout:
 *   Row 1: Ticker tabs (SPY, TSLA, QQQ... + custom input)
 *   Row 2: GEX/VEX | symbol+price | view pills | expiry filters | interval
 *   Body:  PROFILE | MATRIX | LEVELS (switchable via view pills)
 *
 * All QUANT SEEKER ticker clicks route here: /terminal/:symbol
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useStockContext } from '@/contexts/stock-context';
import { useQuery } from '@tanstack/react-query';
import { GEXExpiryMatrix } from '@/components/gex/gex-expiry-matrix';
import { GEXHeatmapGrid } from '@/components/gex/gex-heatmap-grid';
import { GEXLevelBadge } from '@/components/gex/gex-level-badge';
import { cn } from '@/lib/utils';
import { formatGEX, formatGammaPct } from '../../../shared/gex-types';
import { RefreshCw } from 'lucide-react';
import type { GEXTerminalData } from '../../../shared/gex-types';
import { CacheFreshnessIndicator } from '@/components/gex/CacheFreshnessIndicator';
;


// ─── Helpers ────────────────────────────────────────────────
/** Smart exposure formatter: GEX is in $B, VEX is in $M — scale accordingly */
function formatExposure(val: number, mode: 'gex' | 'vex'): string {
  const sign = val >= 0 ? '+' : '−';
  const abs = Math.abs(val);
  if (mode === 'gex') {
    // totalGEX is in billions
    return `${sign}$${abs.toFixed(2)}B`;
  }
  // totalVEX is in millions
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}B`;
  return `${sign}$${abs.toFixed(1)}M`;
}

/** TradingView-style tick flash — returns 'up'|'down'|null on value change */
function usePriceFlash(value: number | undefined): 'up' | 'down' | null {
  const prevRef = useRef<number | undefined>();
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (value !== undefined && prevRef.current !== undefined && value !== prevRef.current) {
      setFlash(value > prevRef.current ? 'up' : 'down');
      const t = setTimeout(() => setFlash(null), 700);
      prevRef.current = value;
      return () => clearTimeout(t);
    }
    prevRef.current = value;
  }, [value]);

  return flash;
}

function flashStyle(dir: 'up' | 'down' | null): React.CSSProperties {
  if (dir === 'up') return { backgroundColor: 'rgba(34, 197, 94, 0.3)', transition: 'none', borderRadius: '2px' };
  if (dir === 'down') return { backgroundColor: 'rgba(239, 68, 68, 0.3)', transition: 'none', borderRadius: '2px' };
  return { backgroundColor: 'transparent', transition: 'background-color 0.6s ease-out', borderRadius: '2px' };
}

// ─── Constants ──────────────────────────────────────────────
type TerminalView = 'profile' | 'matrix' | 'levels';
type ExposureMode = 'gex' | 'vex';

const DEFAULT_TICKERS = ['SPY', 'TSLA', 'QQQ', 'SPXW', 'NVDA', 'AAPL'];

const VIEW_OPTIONS: { value: TerminalView; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'levels', label: 'Levels' },
];

// ─── Main Component ──────────────────────────────────────────

export default function TerminalPage() {
  const [, params]       = useRoute('/terminal/:symbol');
  const [, paramsRSlash] = useRoute('/r/:symbol');
  const [, navigate]     = useLocation();
  const { currentStock } = useStockContext();
  // Symbol resolution priority: /terminal/:symbol > /r/:symbol > StockContext > SPY fallback.
  // This lets terminal-chart render correctly whether mounted directly OR inside Research shell.
  const symbol = (
    params?.symbol ||
    paramsRSlash?.symbol ||
    currentStock?.symbol ||
    'SPY'
  ).toUpperCase();

  const [view, setView] = useState<TerminalView>('matrix');
  const [exposureMode, setExposureMode] = useState<ExposureMode>('gex');
  const [matrixExpanded, setMatrixExpanded] = useState(false);
  const [tickerSearch, setTickerSearch] = useState('');
  const [showTickerList, setShowTickerList] = useState(false);

  // ─── Watchlist query — populate ticker tabs ───────────────
  const { data: watchlistData } = useQuery<{ symbol: string }[]>({
    queryKey: ['/api/watchlist'],
    queryFn: async () => {
      const res = await fetch('/api/watchlist', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 120_000,
  });

  const tickers = useMemo(() => {
    if (!watchlistData || watchlistData.length === 0) return DEFAULT_TICKERS;
    const wlSymbols = watchlistData
      .map(w => (w.symbol || '').toUpperCase())
      .filter(s => s.length > 0 && s.length <= 5);
    // Deduplicate, keep defaults at front for options-heavy tickers
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of [...DEFAULT_TICKERS, ...wlSymbols]) {
      if (!seen.has(s)) { seen.add(s); result.push(s); }
    }
    return result;
  }, [watchlistData]);

  // ─── Data query ───────────────────────────────────────────
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

  // ─── Derived state ────────────────────────────────────────
  const filteredTickers = useMemo(() => {
    if (!tickerSearch.trim()) return tickers;
    const q = tickerSearch.toUpperCase();
    return tickers.filter(t => t.includes(q));
  }, [tickers, tickerSearch]);

  // ─── Handlers ─────────────────────────────────────────────
  const handleSymbolChange = (next: string) => {
    navigate(`/terminal/${next.toUpperCase()}`);
    setMatrixExpanded(false);
    setTickerSearch('');
    setShowTickerList(false);
  };

  const handleTickerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tickerSearch.trim()) {
      handleSymbolChange(tickerSearch.trim().toUpperCase());
    }
  };


  // Projection & exposure mode
  const proj = data?.projection;
  const projMovePct = proj ? ((proj.endPrice - proj.startPrice) / proj.startPrice) * 100 : 0;
  const netExposure = exposureMode === 'gex' ? data?.snapshot.totalGEX : data?.snapshot.totalVEX;

  // Flash animations on value change (TradingView-style tick)
  const spotFlash = usePriceFlash(data?.snapshot.spotPrice);
  const gexFlash = usePriceFlash(netExposure);

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="h-[calc(100dvh-80px)] bg-[var(--surface-base)] flex flex-col overflow-hidden">

      {/* ═══ SKYLIT-STYLE DASHBOARD TOOLBAR ═══ */}
      <div className="flex-shrink-0 border-b border-border/30 bg-[var(--surface-raised)]">

        {/* Single toolbar row: search + controls */}
        <div className="flex items-center gap-2 px-4 py-1.5 overflow-x-auto">

          {/* Ticker search */}
          <div className="relative">
            <form onSubmit={handleTickerSubmit} className="flex items-center">
              <input aria-label="Ticker symbol"
                type="text"
                value={tickerSearch || symbol}
                onChange={e => { setTickerSearch(e.target.value); setShowTickerList(true); }}
                onFocus={e => { e.target.select(); setShowTickerList(true); }}
                onBlur={() => setTimeout(() => { setShowTickerList(false); setTickerSearch(''); }, 200)}
                className="w-20 px-2 py-0.5 text-[10px] font-mono font-bold uppercase text-center bg-[var(--surface-base)] border border-border/30 rounded text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--gex-positive)]/50 focus:w-36 transition-all"
              />
            </form>
            {showTickerList && filteredTickers.length > 0 && (
              <div
                className="absolute top-full left-0 mt-1 z-50 bg-[var(--surface-raised)] border border-border/30 rounded shadow-xl max-h-64 overflow-y-auto w-48"
                onMouseDown={e => e.preventDefault()}
              >
                {filteredTickers.slice(0, 20).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleSymbolChange(t)}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-[10px] font-mono font-bold uppercase hover:bg-muted/20 transition-colors',
                      t === symbol ? 'text-[var(--gex-positive)] bg-[var(--gex-positive)]/10' : 'text-foreground'
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {data?.snapshot.spotPrice !== undefined && (
            <span
              className={cn(
                'text-[10px] font-mono tabular-nums px-1 py-0.5',
                spotFlash === 'up' ? 'text-[var(--trade-bullish)]' : spotFlash === 'down' ? 'text-[var(--trade-bearish)]' : 'text-foreground'
              )}
              style={flashStyle(spotFlash)}
            >
              ${data.snapshot.spotPrice.toFixed(2)}
            </span>
          )}

          <div className="w-px h-4 bg-border/20" />

          {/* GEX / VEX toggle */}
          <div className="flex gap-0.5 p-0.5 rounded bg-[var(--surface-base)] border border-border/30">
            <button
              type="button"
              onClick={() => setExposureMode('gex')}
              className={cn(
                'px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded transition-colors',
                exposureMode === 'gex'
                  ? 'bg-[var(--gex-positive)]/15 text-[var(--gex-positive)]'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              GEX
            </button>
            <button
              type="button"
              onClick={() => setExposureMode('vex')}
              className={cn(
                'px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded transition-colors',
                exposureMode === 'vex'
                  ? 'bg-violet-400/15 text-violet-400'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              VEX
            </button>
          </div>

          <div className="w-px h-4 bg-border/20" />

          {/* View pills: Profile | Matrix | Levels */}
          <div className="flex gap-0.5 p-0.5 rounded bg-[var(--surface-base)] border border-border/30">
            {VIEW_OPTIONS.map(v => (
              <button
                key={v.value}
                type="button"
                onClick={() => setView(v.value)}
                className={cn(
                  'px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded transition-colors',
                  view === v.value
                    ? 'bg-[var(--gex-positive)]/15 text-[var(--gex-positive)]'
                    : 'text-muted-foreground hover:text-muted-foreground'
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Matrix expand button */}
          {view === 'matrix' && (
            <button
              type="button"
              onClick={() => setMatrixExpanded(!matrixExpanded)}
              className={cn(
                'px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest rounded border transition-colors',
                matrixExpanded
                  ? 'border-amber-400/30 text-amber-400 bg-amber-400/10'
                  : 'border-border/30 text-muted-foreground hover:text-foreground'
              )}
            >
              {matrixExpanded ? 'COLLAPSE' : 'ALL STRIKES'}
            </button>
          )}

          {/* Cache freshness indicator */}
          {data && (
            <div className="border-l border-border/30 pl-2 ml-1">
              <CacheFreshnessIndicator
                asOf={(data as any).cachedAt || (data as any).snapshot?.calculatedAt || Date.now()}
                cached={(data as any).cached === true}
                showLabel
              />
            </div>
          )}

          {/* Refresh */}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1 text-muted-foreground hover:text-muted-foreground transition-colors"
            title="Force refresh"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin text-amber-400')} />
          </button>
        </div>
      </div>

      {/* ═══ UNIFIED LEVELS STRIP — replaces 2 separate bars ═══
           Visually links related levels (PUT WALL = MAX Γ = ZERO-Γ when same strike)
           Color logic: CALL=green | PUT=red | FLIP=amber | MAGNET=cyan          */}
      {data && (() => {
        const s = data.snapshot;
        const spot = s.spotPrice || 0;
        // Detect "linked levels" — when two metrics point to same strike
        const linkedPutMaxGamma = s.putWall != null && s.maxGammaStrike != null && s.putWall === s.maxGammaStrike;
        const linkedTargetMax = s.zeroGammaProjection != null && s.maxGammaStrike != null &&
                                Math.abs(s.zeroGammaProjection - s.maxGammaStrike) < 1;

        const Pill = ({ label, value, tooltip, color, linked }: { label: string; value: React.ReactNode; tooltip: string; color: string; linked?: boolean }) => (
          <div className="flex flex-col items-start min-w-0" title={tooltip}>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground leading-none">
              {label}
              {linked && <span className="ml-1 text-sky-400/60">●</span>}
            </span>
            <span className={cn('text-sm font-bold tabular-nums leading-tight font-mono', color)}>
              {value}
            </span>
          </div>
        );

        return (
          <div className="flex-shrink-0 border-b border-border/15 bg-[var(--surface-base)] px-4 py-2">
            <div className="flex items-center gap-5 overflow-x-auto">
              {/* Regime badge */}
              <span className={cn(
                'px-2 py-1 rounded text-[10px] font-bold uppercase border whitespace-nowrap flex-shrink-0',
                s.regime === 'positive_gamma'
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-[var(--trade-bullish)]'
                  : s.regime === 'negative_gamma'
                    ? 'bg-orange-500/10 border-orange-500/40 text-orange-400'
                    : 'bg-zinc-700/40 border-zinc-700 text-zinc-400'
              )}>
                {s.regime === 'positive_gamma' ? 'Γ POS · pinned' : s.regime === 'negative_gamma' ? 'Γ NEG · squeezy' : 'Γ NEUTRAL'}
              </span>

              {/* Net GEX/VEX */}
              <Pill
                label={`NET ${exposureMode.toUpperCase()}`}
                value={typeof netExposure === 'number' && !isNaN(netExposure) ? formatExposure(netExposure, exposureMode) : '—'}
                tooltip={`Net dealer ${exposureMode} exposure across all strikes`}
                color={(netExposure ?? 0) > 0 ? 'text-[var(--trade-bullish)]' : (netExposure ?? 0) < 0 ? 'text-orange-400' : 'text-foreground'}
              />

              <div className="w-px h-7 bg-border/20 flex-shrink-0" />

              {/* CALL WALL — green = bullish ceiling */}
              <Pill
                label="Call Wall"
                value={s.callWall != null ? `$${s.callWall.toFixed(0)}` : <span className="text-zinc-600 italic text-xs">low OI</span>}
                tooltip="Largest call OI above spot — likely magnet/resistance"
                color="text-[var(--trade-bullish)]"
              />

              {/* MAGNET (Zero-Γ Target) — cyan, with % from spot */}
              {s.zeroGammaProjection != null && (
                <Pill
                  label="Magnet"
                  value={
                    <span className="flex items-baseline gap-1">
                      <span className="text-sky-400">${s.zeroGammaProjection.toFixed(0)}</span>
                      {spot > 0 && (
                        <span className={cn('text-[10px]', s.zeroGammaProjection >= spot ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]')}>
                          {s.zeroGammaProjection >= spot ? '+' : ''}{(((s.zeroGammaProjection - spot) / spot) * 100).toFixed(1)}%
                        </span>
                      )}
                    </span>
                  }
                  tooltip="Zero-Γ projection — price gravitates here from dealer hedging"
                  color=""
                  linked={linkedTargetMax}
                />
              )}

              {/* FLIP — amber = regime change boundary */}
              <Pill
                label="Flip"
                value={s.gammaFlipPrice != null ? `$${s.gammaFlipPrice.toFixed(0)}` : <span className="text-zinc-600 italic text-xs">none</span>}
                tooltip="Where dealer gamma flips from + to − (regime boundary)"
                color="text-amber-400"
              />

              {/* PUT WALL — red = bearish floor */}
              <Pill
                label="Put Wall"
                value={s.putWall != null ? `$${s.putWall.toFixed(0)}` : <span className="text-zinc-600 italic text-xs">low OI</span>}
                tooltip="Largest put OI below spot — likely magnet/support"
                color="text-[var(--trade-bearish)]"
                linked={linkedPutMaxGamma}
              />

              {/* MAX Γ — star, only show if NOT same as Put Wall (avoid duplication) */}
              {!linkedPutMaxGamma && (
                <Pill
                  label="Max Γ"
                  value={<span>★ {s.maxGammaStrike != null ? `$${s.maxGammaStrike.toFixed(0)}` : '—'}</span>}
                  tooltip="Strike with largest gamma magnitude"
                  color="text-amber-400"
                />
              )}
            </div>

            {/* Subtle one-liner explaining magnet — only when relevant */}
            {s.zeroGammaProjection != null && (
              <div className="text-[9px] text-muted-foreground mt-1 font-mono">
                Magnet from dealer hedging flow · conf {proj ? `${(proj.confidence * 100).toFixed(0)}%` : '100%'}
                {(linkedPutMaxGamma || linkedTargetMax) && (
                  <span className="ml-2 text-sky-400/60">● = same strike (linked levels confirm magnet)</span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ═══ LOADING STATE ═══ */}
      {!data && (
        <div className="flex items-center justify-center flex-1">
          {isError ? (
            <div className="text-center space-y-3">
              <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--gex-negative)]">
                FAILED TO LOAD {symbol}
              </div>
              <div className="text-[9px] font-mono text-muted-foreground">
                Options data unavailable — market may be closed or data source is down
              </div>
              <button type="button" onClick={() => refetch()} className="px-3 py-1.5 text-[9px] font-mono font-bold uppercase rounded border border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors">
                RETRY
              </button>
            </div>
          ) : (
            <div className="text-center space-y-2">
              <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--gex-positive)] animate-pulse">
                LOADING {symbol} TERMINAL...
              </div>
              <div className="text-[9px] font-mono text-muted-foreground">
                Fetching options chain & computing exposures
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ PROFILE VIEW — GEX bars + sidebar levels ═══ */}
      {data && view === 'profile' && (
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-0 h-full">
            {/* GEX profile bars */}
            <div className="overflow-auto border-r border-border/15">
              <div className="px-4 py-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--gex-positive)]">
                    {exposureMode.toUpperCase()} PROFILE BY STRIKE
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {data.heatmap.length} strikes · spot ${data.snapshot.spotPrice.toFixed(2)}
                  </span>
                </div>
                <GEXHeatmapGrid cells={data.heatmap} spotPrice={data.snapshot.spotPrice} />
              </div>
            </div>

            {/* Key levels sidebar */}
            <div className="overflow-auto bg-[var(--surface-raised)]/30">
              <div className="px-3 py-2 border-b border-border/15 sticky top-0 bg-[var(--surface-raised)]/80 backdrop-blur-sm z-10">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--gex-positive)]">
                    KEY LEVELS
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {data.snapshot.levels.length} strikes
                  </span>
                </div>
              </div>
              <div className="p-2 space-y-0.5">
                {data.snapshot.levels.map((lvl, i) => (
                  <div key={`${lvl.strike}-${lvl.role}-${i}`} className="flex items-center justify-between gap-2 px-1 py-1 rounded hover:bg-[var(--surface-base)]/50 transition-colors">
                    <GEXLevelBadge level={lvl} compact />
                    <div className="text-right">
                      <div className="text-[10px] font-mono tabular-nums text-foreground">{formatGEX(lvl.gex)}</div>
                      <div className="text-[9px] font-mono text-muted-foreground tabular-nums">
                        {formatGammaPct(lvl.gammaPct)} · OI {lvl.openInterest.toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MATRIX VIEW — Strike × Expiry heatmap ═══ */}
      {data && view === 'matrix' && (
        <div className="flex-1 min-h-0 px-4 py-3 flex flex-col">
          {data.strikeExpiryMatrix && data.strikeExpiryMatrix.length > 0 ? (
            <GEXExpiryMatrix
              matrix={data.strikeExpiryMatrix}
              snapshot={data.snapshot}
              hideControls
              externalMode={exposureMode}
              externalExpanded={matrixExpanded}
            />
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="text-[10px] font-mono text-muted-foreground">No matrix data for {symbol}</div>
            </div>
          )}
        </div>
      )}

      {/* ═══ LEVELS VIEW — Full key levels with bars ═══ */}
      {data && view === 'levels' && (
        <div className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto px-4 py-4">
            <div className="rounded-lg bg-[var(--surface-raised)] border border-border/15 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/15 bg-[var(--surface-base)]/50">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--gex-positive)]">
                  ALL KEY LEVELS — {symbol}
                </span>
                <span className="text-[9px] font-mono text-muted-foreground">
                  {data.snapshot.levels.length} strikes · spot ${data.snapshot.spotPrice.toFixed(2)} · net {formatGEX(data.snapshot.totalGEX)}
                </span>
              </div>
              <div className="divide-y divide-border/10">
                {data.snapshot.levels.map((lvl, i) => {
                  const distPct = ((lvl.strike - data.snapshot.spotPrice) / data.snapshot.spotPrice * 100);
                  const isNear = Math.abs(distPct) < 0.5;
                  return (
                    <div
                      key={`${lvl.strike}-${lvl.role}-${i}`}
                      className={cn(
                        'flex items-center gap-4 px-4 py-2 transition-colors hover:bg-[var(--surface-base)]/40',
                        isNear && 'bg-[var(--projection-glow)]/5'
                      )}
                    >
                      <span className="text-[10px] font-mono text-muted-foreground w-5 text-right tabular-nums">{i + 1}</span>
                      <div className="w-40"><GEXLevelBadge level={lvl} /></div>
                      <div className="flex-1">
                        <div className="h-3 bg-black/30 rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', lvl.gex >= 0 ? 'bg-[var(--gex-positive)]' : 'bg-[var(--gex-negative)]')}
                            style={{ width: `${Math.min(lvl.gammaPct * 3, 100)}%`, opacity: 0.6 }}
                          />
                        </div>
                      </div>
                      <div className="text-right w-20">
                        <div className="text-[11px] font-mono font-bold tabular-nums">{formatGEX(lvl.gex)}</div>
                      </div>
                      <div className="text-right w-14">
                        <div className="text-[10px] font-mono tabular-nums text-muted-foreground">{formatGammaPct(lvl.gammaPct)}</div>
                      </div>
                      <div className="text-right w-20">
                        <div className="text-[10px] font-mono tabular-nums text-muted-foreground">
                          OI {lvl.openInterest >= 1000 ? `${(lvl.openInterest / 1000).toFixed(1)}K` : lvl.openInterest.toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right w-14">
                        <div className={cn(
                          'text-[10px] font-mono font-bold tabular-nums',
                          distPct > 0 ? 'text-[var(--gex-positive)]' : distPct < 0 ? 'text-[var(--gex-negative)]' : 'text-muted-foreground'
                        )}>
                          {distPct >= 0 ? '+' : ''}{distPct.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* EngineStatusFooter removed 2026-09-24: third status bar under the shell's own; fake uptime/engine labels */}
    </div>
  );
}
