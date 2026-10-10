/**
 * CommandPalette — global ⌘K search across the platform.
 *
 * Triggers:
 *   - ⌘K / Ctrl+K from anywhere
 *   - Click the search icon in any header
 *
 * What it searches:
 *   - Tickers (typed → /r/SYMBOL)
 *   - Pages   (Terminal, GEX, Research, Positions, Journal, Trade Desk — and tabs within)
 *   - Quick actions (thesis radar, settings)
 *
 * Wraps shadcn Command primitive — keyboard-first, accessible, fast.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Home,
  Bell,
  Crosshair,
  Zap,
  Microscope,
  Wallet,
  BookOpen,
  TrendingUp,
  Search,
  ArrowRight,
} from 'lucide-react';

interface NavTarget {
  href: string;
  label: string;
  hint?: string;
  icon: any;
  keywords?: string[];
}

const PRIMARY_DESTINATIONS: NavTarget[] = [
  { href: '/t',              label: 'Terminal',   icon: Home,      hint: 'NEXUS home · tape · rotation · signals', keywords: ['dashboard','pulse','overview','nexus'] },
  { href: '/t?tab=gex',      label: 'GEX',        icon: Zap,       hint: 'Gamma hub · market-wide and per-symbol', keywords: ['gamma','vex','dealer','flow'] },
  { href: '/r',              label: 'Research',   icon: Microscope,hint: 'Per-ticker chart · options · GEX', keywords: ['terminal','chart','options','ticker'] },
  { href: '/t?tab=positions',label: 'Positions',  icon: Wallet,    hint: 'My book · open positions · P&L heat map', keywords: ['heatmap','book','pnl'] },
  { href: '/t?tab=journal',  label: 'Journal',    icon: BookOpen,  hint: 'Trade log · metrics · backtest · academy', keywords: ['history','performance','backtest'] },
  { href: '/slate',          label: 'Slate', icon: Crosshair, hint: "Today's measured setups + pre-market gappers", keywords: ['discovery','scanner','picks','setups','trade desk','gappers'] },
];

const NESTED_TABS: NavTarget[] = [
  // Terminal tabs
  { href: '/t?tab=chart',    label: 'Terminal → Chart',    icon: Home, keywords: ['price','levels','candle'] },
  { href: '/t?tab=flow',     label: 'Terminal → Flow',     icon: Home, keywords: ['tape','premium','sweeps','whales'] },
  { href: '/t?tab=leaps',    label: 'Terminal → LEAPS',    icon: Home, keywords: ['long','dated','thesis'] },
  { href: '/t?tab=crypto',   label: 'Terminal → Crypto',   icon: Home, keywords: ['bitcoin','btc'] },
  { href: '/t?tab=catalyst', label: 'Terminal → Catalyst', icon: Home, keywords: ['events','earnings','calendar'] },
  { href: '/t?tab=bot',      label: 'Terminal → Bot',      icon: Home, keywords: ['automation','paper'] },
  // Research tabs (the per-ticker home — search a ticker → lands here)
  { href: '/r/SPY?tab=chart',    label: 'Research → Chart',    icon: Microscope, keywords: ['price','levels','candle'] },
  { href: '/r/SPY?tab=options',  label: 'Research → Options',  icon: Microscope, keywords: ['chain','greeks','iv'] },
  { href: '/r/SPY?tab=gex',      label: 'Research → GEX',      icon: Microscope, keywords: ['gamma','walls','flip','per-symbol'] },
  { href: '/r/SPY?tab=analyze',  label: 'Research → Analyze',  icon: Microscope, keywords: ['contract','grade','bullflow','a+'] },
  // Journal sub-tabs (nested — the journal reads ?jtab= so it never fights the shell's ?tab=)
  { href: '/t?tab=journal&jtab=log',      label: 'Journal → Trade Log',  icon: BookOpen, keywords: ['history','trades'] },
  { href: '/t?tab=journal&jtab=metrics',  label: 'Journal → Metrics',    icon: BookOpen, keywords: ['performance','win'] },
  { href: '/t?tab=journal&jtab=backtest', label: 'Journal → Backtest',   icon: BookOpen, keywords: ['simulator','strategy'] },
];

// Quick popular tickers for tap-jump (extend over time / pull from watchlist)
const POPULAR_TICKERS = [
  'SPY','QQQ','IWM','NVDA','AAPL','MSFT','TSLA','AMD','META','GOOGL','AMZN',
  'AVGO','ARM','MU','SMCI','PLTR','COIN','SHOP','NOK','BB','MP','CRDO','LITE','AAOI',
  'VST','CEG','OKLO','NNE','VRT','GEV','ETN','DDOG','NET','HUBS','SNOW','MDB','PANW','CRWD',
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [, setLocation] = useLocation();
  const tickerQuery = search.trim().toUpperCase();
  const { data: tickerResults = [] } = useQuery<Array<{ symbol: string; name?: string; type?: string; changePct?: number | null }>>({
    queryKey: ['/api/search/symbols', tickerQuery, 'global-palette'],
    queryFn: async () => {
      const response = await fetch(`/api/search/symbols?q=${encodeURIComponent(tickerQuery)}`, { credentials: 'include' });
      if (!response.ok) return [];
      const body = await response.json();
      return (Array.isArray(body) ? body : body.results ?? []).slice(0, 10);
    },
    enabled: open && tickerQuery.length > 0,
    staleTime: 60_000,
    retry: 0,
  });

  // Global ⌘K listener — only ⌘K toggles. Digit shortcuts must NOT hijack
  // typing into the search input (a real ticker like "1080P" or just "1" matters).
  // We only honor 1-6 when the search is empty AND the digit is pressed with ⌘.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        return;
      }
      // ⌘1-⌘6 jumps to primary destination from anywhere (closes palette if open)
      if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '6') {
        const idx = parseInt(e.key) - 1;
        if (PRIMARY_DESTINATIONS[idx]) {
          e.preventDefault();
          setLocation(PRIMARY_DESTINATIONS[idx].href);
          setOpen(false);
        }
      }
    };
    document.addEventListener('keydown', handler);
    // Allow any header search button (or other UI) to open the palette without
    // faking a keyboard event — dispatch `window` event 'qe:open-command-palette'.
    const openHandler = () => setOpen(true);
    window.addEventListener('qe:open-command-palette', openHandler);
    return () => {
      document.removeEventListener('keydown', handler);
      window.removeEventListener('qe:open-command-palette', openHandler);
    };
  }, [setLocation]);

  // When search looks like a ticker (1-6 letters, all caps), pressing Enter on
  // empty results jumps to /r/SYMBOL even if it's not in our popular list.
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && search.trim()) {
      const q = search.trim().toUpperCase();
      const looksLikeTicker = /^[A-Z]{1,6}(\.[A-Z])?$/.test(q);
      if (looksLikeTicker) {
        e.preventDefault();
        setOpen(false);
        setLocation(`/r/${q}`);
        setSearch('');
      }
    }
  };

  const go = (href: string) => {
    setOpen(false);
    setSearch('');
    setLocation(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Type a ticker, page, or action…  (⌘K toggle · ⌘1-6 jump · Enter on ticker → Research)"
        value={search}
        onValueChange={setSearch}
        onKeyDown={handleInputKeyDown}
        autoFocus
      />
      <CommandList>
        <CommandEmpty>
          <div className="text-xs text-muted-foreground py-3 px-2">
            {/^[A-Za-z]{1,6}(\.[A-Za-z])?$/.test(search.trim()) ? (
              <div>
                Press <kbd className="px-1 py-0.5 bg-muted rounded text-[var(--brand-cyan)] font-mono">Enter</kbd> to open
                <span className="font-mono font-bold text-[var(--brand-cyan)] mx-1">{search.toUpperCase()}</span>
                in Research → <span className="font-mono text-muted-foreground">/r/{search.toUpperCase()}</span>
              </div>
            ) : (
              <>
                <div className="mb-2">No matches. Try:</div>
                <ul className="space-y-1 text-[11px]">
                  <li>· A ticker symbol (e.g. <span className="font-mono text-[var(--brand-cyan)]">CRDO</span>)</li>
                  <li>· A page name (e.g. <span className="font-mono text-[var(--brand-cyan)]">heatmap</span>)</li>
                  <li>· A workflow (e.g. <span className="font-mono text-[var(--brand-cyan)]">leaps</span>, <span className="font-mono text-[var(--brand-cyan)]">earnings</span>)</li>
                </ul>
              </>
            )}
          </div>
        </CommandEmpty>

        <CommandGroup heading="Go to">
          {PRIMARY_DESTINATIONS.map((t, i) => {
            const Icon = t.icon;
            return (
              <CommandItem
                key={t.href}
                value={`${t.label} ${(t.keywords ?? []).join(' ')}`}
                onSelect={() => go(t.href)}
              >
                <Icon className="w-3.5 h-3.5 mr-2 text-[var(--brand-cyan)]" />
                <span className="font-mono text-sm font-bold">{t.label}</span>
                {t.hint && (
                  <span className="ml-2 text-[10px] text-muted-foreground">{t.hint}</span>
                )}
                <span className="ml-auto text-[9px] font-mono text-muted-foreground">
                  ⌘{i + 1}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Tabs & sub-pages">
          {NESTED_TABS.map(t => {
            const Icon = t.icon;
            return (
              <CommandItem
                key={t.href}
                value={`${t.label} ${(t.keywords ?? []).join(' ')}`}
                onSelect={() => go(t.href)}
              >
                <Icon className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                <span className="text-xs">{t.label}</span>
                <ArrowRight className="ml-auto w-3 h-3 text-muted-foreground" />
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={tickerQuery ? "Universal tickers" : "Popular tickers (jump to Research)"}>
          {(tickerQuery
            ? tickerResults.map((result) => result.symbol)
            : POPULAR_TICKERS
          ).map(sym => {
            const result = tickerResults.find((item) => item.symbol === sym);
            return (
            <CommandItem
              key={sym}
              value={`${sym} ${result?.name ?? ''} ticker`}
              onSelect={() => go(`/r/${sym}`)}
            >
              <TrendingUp className="w-3.5 h-3.5 mr-2 text-[var(--brand-gold)]" />
              <span className="font-mono text-sm font-bold">{sym}</span>
              <span className="ml-2 min-w-0 truncate text-[10px] text-muted-foreground">{result?.name ?? 'Research'}</span>
              {result?.changePct != null && (
                <span className={result.changePct >= 0 ? 'ml-auto text-[10px] text-[var(--trade-bullish)]' : 'ml-auto text-[10px] text-[var(--trade-bearish)]'}>
                  {result.changePct >= 0 ? '+' : ''}{result.changePct.toFixed(2)}%
                </span>
              )}
              <span className="ml-auto text-[9px] font-mono text-muted-foreground">/r/{sym}</span>
            </CommandItem>
          )})}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick actions">
          <CommandItem onSelect={() => go('/alerts')}>
            <Bell className="w-3.5 h-3.5 mr-2" />
            <span className="text-xs">Alerts</span>
          </CommandItem>
          <CommandItem onSelect={() => go('/radar')}>
            <Crosshair className="w-3.5 h-3.5 mr-2" />
            <span className="text-xs">Thesis Radar</span>
          </CommandItem>
          <CommandItem onSelect={() => go('/settings')}>
            <Search className="w-3.5 h-3.5 mr-2" />
            <span className="text-xs">Settings</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
