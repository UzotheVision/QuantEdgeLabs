import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchResult {
  symbol: string;
  name?: string;
  type?: 'stock' | 'crypto' | 'futures' | string;
  /** Real session change from the liquid universe, when the symbol is ranked. */
  changePct?: number | null;
}

export function TerminalTickerSearch({
  value,
  onSelect,
  compact = false,
  variant,
}: {
  value?: string;
  onSelect: (result: SearchResult) => void;
  compact?: boolean;
  /** 'nexus' renders the reference terminal's .search shell (svg + input +
   *  ⌘K chip) around the same typeahead engine. Look changes; logic doesn't. */
  variant?: 'nexus';
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // ⌘K is owned by the shell's CommandPalette; this inline variant stays for
  // mobile and embedded uses without competing for the binding.

  const q = query.trim().toUpperCase();
  const { data = [], isFetching } = useQuery<SearchResult[]>({
    queryKey: ['/api/search/symbols', q],
    queryFn: async () => {
      const response = await fetch(`/api/search/symbols?q=${encodeURIComponent(q)}`, { credentials: 'include' });
      if (!response.ok) return [];
      const body = await response.json();
      return Array.isArray(body) ? body : body.results ?? [];
    },
    enabled: q.length > 0,
    staleTime: 60_000,
    retry: 0,
  });

  const results = useMemo(() => data.slice(0, 8), [data]);

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const select = (result: SearchResult) => {
    onSelect({ ...result, symbol: result.symbol.toUpperCase() });
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={root} className="relative">
      <div className={cn(
        variant === 'nexus'
          ? 'search'
          : 'flex items-center rounded border border-border/60 bg-background/65 transition-colors focus-within:border-[var(--brand-cyan)]',
        variant !== 'nexus' && (compact ? 'h-9' : 'h-8'),
      )}>
        {variant === 'nexus' ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        ) : (
          <Search className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        {value && !query && (
          <span className="ml-2 rounded-sm bg-[var(--brand-cyan)]/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[var(--brand-cyan)]">
            {value}
          </span>
        )}
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value.toUpperCase()); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((i) => Math.min(results.length - 1, i + 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((i) => Math.max(0, i - 1)); }
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'Enter' && q) {
              event.preventDefault();
              select(results[cursor] ?? { symbol: q, name: q, type: 'stock' });
            }
          }}
          placeholder={value ? 'switch ticker' : 'search any ticker'}
          aria-label="Search any ticker"
          className={cn(
            variant === 'nexus'
              ? undefined /* the .search shell styles its input */
              : 'min-w-0 flex-1 bg-transparent px-2 font-mono text-[10px] uppercase tracking-wider text-foreground outline-none placeholder:text-muted-foreground',
            variant !== 'nexus' && (compact ? 'w-40' : 'w-32 lg:w-44'),
          )}
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className={variant === 'nexus' ? 'text-inherit' : 'mr-2 text-muted-foreground hover:text-foreground'} style={variant === 'nexus' ? { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mute)' } : undefined}>
            <X className="h-3 w-3" />
          </button>
        )}
        {variant === 'nexus' && !query && <span className="search-kbd">⌘K</span>}
      </div>

      {open && q && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-[340px] overflow-hidden rounded-md border border-border/80 bg-[var(--background)]/98 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>Universal ticker</span>
            <span>{isFetching ? 'searching…' : `${results.length} matches`}</span>
          </div>
          {results.length ? results.map((result, index) => (
            <button
              type="button"
              key={`${result.type}-${result.symbol}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => select(result)}
              className={cn(
                'flex w-full items-center gap-3 border-b border-border/30 px-3 py-2.5 text-left last:border-0',
                cursor === index ? 'bg-[var(--brand-cyan)]/[0.08]' : 'hover:bg-foreground/[0.035]',
              )}
            >
              <span className="w-14 font-mono text-[12px] font-bold tracking-wider text-foreground">{result.symbol}</span>
              <span
                className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
                style={result.changePct != null ? { color: result.changePct >= 0 ? 'var(--green, #34d399)' : 'var(--red, #ff6b3d)' } : undefined}
              >
                {result.name ?? result.symbol}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--brand-cyan)]/75">{result.type ?? 'stock'}</span>
            </button>
          )) : !isFetching ? (
            <button type="button" onClick={() => select({ symbol: q, type: 'stock' })} className="flex w-full items-center justify-between px-3 py-3 text-left font-mono text-[10px] hover:bg-foreground/[0.035]">
              <span>Open {q} directly</span><span className="text-[var(--brand-cyan)]">↗</span>
            </button>
          ) : null}
          <div className="border-t border-border/50 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            Enter open · ↑↓ navigate · symbol follows every workspace
          </div>
        </div>
      )}
    </div>
  );
}
