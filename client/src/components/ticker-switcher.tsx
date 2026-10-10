/**
 * TickerSwitcher — hierarchical ticker picker.
 *
 * Click → dropdown with: Recent · Watchlist · Sector groups · Search.
 * Used as the canonical symbol-picker on Research, GEX > Per-Symbol, etc.
 *
 * Pattern matches HEATSEEKER's "All Tickers 302 ⌘K" + quick-pick chips.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, Search, Star, Clock, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';

const SECTOR_GROUPS: { label: string; symbols: string[] }[] = [
  { label: 'Indices',      symbols: ['SPY','QQQ','IWM','DIA'] },
  { label: 'Mega Tech',    symbols: ['NVDA','AAPL','MSFT','META','GOOGL','AMZN','TSLA'] },
  { label: 'Chips/Semis',  symbols: ['AMD','AVGO','MU','ARM','QCOM','SMH','SOXX','SMCI','MRVL'] },
  { label: 'CPO/Optical',  symbols: ['CRDO','LITE','AAOI','COHR','POET','FN'] },
  { label: 'AI Power',     symbols: ['VRT','GEV','CEG','VST','OKLO','NNE','TLN','BWXT'] },
  { label: 'SaaS/Software',symbols: ['CRM','PLTR','PANW','CRWD','DDOG','NET','MDB','SNOW','HUBS'] },
  { label: 'Fintech',      symbols: ['COIN','SOFI','HOOD','AFRM','UPST','PYPL'] },
  { label: 'Bio/Pharma',   symbols: ['LLY','PFE','MRNA','GILD','VRTX','XBI'] },
  { label: 'Defense/RE',   symbols: ['MP','LMT','KTOS','RKLB','LUNR','SATL'] },
  { label: 'Watchlist OG', symbols: ['BB','NOK','HIMS','ACMR','QRVO','NVAX'] },
];

const RECENT_KEY = 'qe_recent_tickers';
const RECENT_MAX = 8;

function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}
function pushRecent(sym: string) {
  const list = getRecent().filter(s => s !== sym);
  list.unshift(sym);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
}

export interface TickerSwitcherProps {
  value: string;
  onChange: (symbol: string) => void;
  /** Optional inline price/change to render next to the picker */
  price?: number;
  changePct?: number;
  className?: string;
}

export function TickerSwitcher({ value, onChange, price, changePct, className }: TickerSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Pull user watchlist via the real endpoint (/api/watchlist returns array of items with .symbol)
  const { data: watchlist } = useQuery<any>({
    queryKey: ['/api/watchlist'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/watchlist', { credentials: 'include' });
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    staleTime: 60_000,
  });

  const searchQuery = search.trim().toUpperCase();
  const { data: universalResults = [], isFetching: searchingUniverse } = useQuery<Array<{
    symbol: string;
    name?: string;
    type?: string;
    changePct?: number | null;
  }>>({
    queryKey: ['/api/search/symbols', searchQuery, 'ticker-switcher'],
    queryFn: async () => {
      const res = await fetch(`/api/search/symbols?q=${encodeURIComponent(searchQuery)}`, { credentials: 'include' });
      if (!res.ok) return [];
      const body = await res.json();
      return (Array.isArray(body) ? body : body.results ?? []).slice(0, 8);
    },
    enabled: open && searchQuery.length > 0,
    staleTime: 60_000,
    retry: 0,
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open]);

  // Recent: re-read on every open AND on every value change (so a freshly-picked symbol shows up)
  const recent = useMemo(() => getRecent(), [open, value]);
  const watchlistSyms = useMemo(() => {
    const list = Array.isArray(watchlist) ? watchlist : (watchlist?.items || watchlist?.symbols || []);
    return list
      .map((w: any) => (typeof w === 'string' ? w : (w?.symbol || w?.ticker || '')).toUpperCase())
      .filter(Boolean);
  }, [watchlist]);

  const select = (sym: string) => {
    const upper = sym.toUpperCase().trim();
    if (!upper) return;
    pushRecent(upper);
    onChange(upper);
    setOpen(false);
    setSearch('');
  };

  const handleEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && search.trim()) {
      e.preventDefault();
      select(search);
    }
  };

  // Filter sector groups by search
  const filteredGroups = search.trim()
    ? SECTOR_GROUPS.map(g => ({
        ...g,
        symbols: g.symbols.filter(s => s.startsWith(search.toUpperCase())),
      })).filter(g => g.symbols.length > 0)
    : SECTOR_GROUPS;

  const changeTone = (changePct ?? 0) >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]';

  return (
    <div ref={containerRef} className={cn('relative inline-flex items-center gap-2', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-md border bg-card hover:bg-muted/30 transition-colors',
          open ? 'border-[var(--brand-cyan)]/50' : 'border-border',
        )}
      >
        <span className="text-base font-mono font-bold text-foreground">{value}</span>
        {price != null && (
          <span className="text-sm font-mono tabular-nums text-foreground">
            ${price.toFixed(2)}
          </span>
        )}
        {changePct != null && (
          <span className={cn('text-[11px] font-mono tabular-nums font-bold', changeTone)}>
            {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
          </span>
        )}
        <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
        <span className="text-[9px] font-mono text-muted-foreground ml-1">⌘K</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[min(420px,calc(100vw-2rem))] max-h-[min(520px,calc(100vh-8rem))] z-40 rounded-lg border border-border bg-card shadow-2xl overflow-hidden flex flex-col"
          style={{
            // Avoid right-edge overflow on narrow viewports
            transform: typeof window !== 'undefined' && containerRef.current
              ? (() => {
                  const rect = containerRef.current.getBoundingClientRect();
                  const overflow = (rect.left + 420) - (window.innerWidth - 16);
                  return overflow > 0 ? `translateX(-${overflow}px)` : 'none';
                })()
              : 'none',
          }}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleEnter}
              placeholder="Type ticker (Enter to jump)…"
              autoFocus
              className="flex-1 bg-transparent border-none outline-none text-sm font-mono uppercase tracking-wide placeholder:text-muted-foreground"
            />
          </div>

          {/* Body */}
          <div className="overflow-auto flex-1 p-2 space-y-3">
            {/* The same live liquid-universe index used by global search. This
                replaces the previous illusion of universality: typing only
                filtered the small static sector chips, even though Enter could
                jump to an arbitrary symbol. */}
            {searchQuery && (
              <div>
                <div className="flex items-center justify-between px-1 mb-1 text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                  <span>Universal results</span>
                  <span>{searchingUniverse ? 'searching…' : `${universalResults.length} found`}</span>
                </div>
                <div className="overflow-hidden rounded-md border border-border/40">
                  {universalResults.map((result) => (
                    <button
                      key={`${result.type ?? 'stock'}-${result.symbol}`}
                      type="button"
                      onClick={() => select(result.symbol)}
                      className="flex w-full items-center gap-3 border-b border-border/30 px-2.5 py-2 text-left last:border-0 hover:bg-muted/30"
                    >
                      <span className="w-14 font-mono text-[11px] font-bold text-foreground">{result.symbol}</span>
                      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{result.name ?? result.type ?? 'equity'}</span>
                      {result.changePct != null && (
                        <span className={cn('font-mono text-[10px] tabular-nums', result.changePct >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]')}>
                          {result.changePct >= 0 ? '+' : ''}{result.changePct.toFixed(2)}%
                        </span>
                      )}
                    </button>
                  ))}
                  {!searchingUniverse && universalResults.length === 0 && (
                    <button type="button" onClick={() => select(searchQuery)} className="flex w-full items-center justify-between px-2.5 py-2 text-left font-mono text-[10px] hover:bg-muted/30">
                      <span>Open {searchQuery} directly</span><span className="text-[var(--brand-cyan)]">↵</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Recent */}
            {recent.length > 0 && (
              <Group icon={<Clock className="w-3 h-3" />} label="Recent" symbols={recent} active={value} onSelect={select} />
            )}

            {/* Watchlist */}
            {watchlistSyms.length > 0 && (
              <Group icon={<Star className="w-3 h-3" />} label={`Watchlist · ${watchlistSyms.length}`} symbols={watchlistSyms.slice(0, 30)} active={value} onSelect={select} />
            )}

            {/* Sector groups */}
            <div className="space-y-3 pt-1 border-t border-border/30">
              <div className="flex items-center gap-1.5 px-1 text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                <Layers className="w-3 h-3" />
                Sectors
              </div>
              {filteredGroups.map(g => (
                <Group key={g.label} label={g.label} symbols={g.symbols} active={value} onSelect={select} />
              ))}
              {filteredGroups.length === 0 && (
                <div className="text-[10px] font-mono text-muted-foreground px-2 py-3 text-center">
                  No tickers match "{search}". Press Enter to jump anyway.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({
  label, symbols, active, onSelect, icon,
}: {
  label: string;
  symbols: string[];
  active: string;
  onSelect: (sym: string) => void;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-1 mb-1 text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {symbols.map(sym => (
          <button
            key={sym}
            type="button"
            onClick={() => onSelect(sym)}
            className={cn(
              'px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors',
              active === sym
                ? 'border-[var(--brand-cyan)]/50 text-[var(--brand-cyan)] bg-[var(--brand-cyan)]/10'
                : 'border-border/40 text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30',
            )}
          >
            {sym}
          </button>
        ))}
      </div>
    </div>
  );
}
