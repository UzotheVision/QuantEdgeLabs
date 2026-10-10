/**
 * RESEARCH — the canonical per-ticker home.
 *
 *   URL: /r/:symbol[?tab=chart|options|gex|flow|news|setups|analysis]
 *
 * Header:
 *   • TickerSwitcher (hierarchical: recent / watchlist / sector groups / search)
 *   • Live price + change pill (from /api/quote)
 *   • Sector/tier tags
 *
 * Tabs:
 *   Chart    — price + key levels + GEX overlays  (terminal-chart.tsx)
 *   Options  — chain · greeks · IV · ROI         (options-analyzer.tsx)
 *   GEX      — walls · flip · matrix · dealer flow (terminal-heatmap.tsx)
 *   Flow     — unusual options activity for this ticker (next sprint stub)
 *   News     — catalysts + sentiment (next sprint stub)
 *   Setups   — active trade ideas tied to this symbol (next sprint stub)
 *   Analysis — TA + FA combined (next sprint stub)
 *
 * Symbol propagation:
 *   useParams() reads URL → setCurrentStock() updates global StockContext
 *   → terminal-chart, options-analyzer, etc. (which already read currentStock)
 *     all see the right ticker without prop-drilling.
 *
 * GEX → Per-Symbol shortcut redirects here with ?tab=gex (no duplication).
 */
import { useEffect } from 'react';
import { useParams, useLocation } from 'wouter';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';

import { QETabs, type QETabItem } from '@/components/ui/qe-tabs';
import { TickerSwitcher } from '@/components/ticker-switcher';
import { useTabState } from '@/hooks/use-tab-state';
import { useStockContext } from '@/contexts/stock-context';
import { PageErrorBoundary } from '@/components/page-error-boundary';

// Lazy children — each is the existing implementation, now reading symbol via context
const TerminalHeatmap  = lazy(() => import('@/components/research/terminal-heatmap'));
const ContractAnalyzer = lazy(() => import('@/components/contract-analyzer').then(m => ({ default: m.ContractAnalyzer })));

const TickerWorkup     = lazy(() => import('@/components/workup/ticker-workup').then(m => ({ default: m.TickerWorkup })));

type Tab = 'workup' | 'gex' | 'analyze';

const TABS: readonly QETabItem<Tab>[] = [
  { id: 'workup',   label: 'Dossier',       hint: 'One live workspace · overview, chart, options, events and execution gates' },
  { id: 'gex',      label: 'GEX surface',   hint: 'Specialist surface · walls, flip, expiry matrix and dealer positioning' },
  { id: 'analyze',  label: 'Contract lab',  hint: 'Paste any contract for a separate contract-level analysis' },
];

const VALID_TABS = TABS.map(t => t.id);

export default function ResearchShell() {
  const { symbol: rawSym } = useParams<{ symbol: string }>();
  const [, setLocation] = useLocation();
  const { currentStock, setCurrentStock } = useStockContext();
  const [tab, setTab] = useTabState<Tab>('workup', VALID_TABS);

  const symbol = (rawSym ?? 'SPY').toUpperCase();
  const source = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('from') : null;
  const requestedLegacyTab = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('tab') : null;
  const initialWorkupTab = requestedLegacyTab === 'chart' || requestedLegacyTab === 'options'
    ? requestedLegacyTab
    : 'overview';
  const returnTab = source?.startsWith('terminal-') ? source.replace('terminal-', '') : null;

  // 1) Sync URL :symbol → StockContext so children see the right ticker
  useEffect(() => {
    if (!symbol) return;
    if (!currentStock || currentStock.symbol !== symbol) {
      setCurrentStock({ symbol });
    }
  }, [symbol, currentStock, setCurrentStock]);

  // Old links opened separate Chart / Options / Flow applications with their
  // own headers and interaction grammar. Keep those URLs working, but land
  // them inside the canonical dossier instead of rendering a duplicate UI.
  useEffect(() => {
    if (!requestedLegacyTab || !['chart', 'options', 'flow'].includes(requestedLegacyTab)) return;
    const params = new URLSearchParams(window.location.search);
    params.delete('tab');
    setLocation(`/r/${symbol}${params.size ? `?${params.toString()}` : ''}`, { replace: true });
  }, [requestedLegacyTab, setLocation, symbol]);

  // 3) Live quote for header — uses /api/quotes/batch (the endpoint that actually exists)
  const { data: quote } = useQuery<{ price: number; change: number; changePct: number }>({
    queryKey: ['/api/quotes/batch', symbol],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/batch/${symbol}`, { credentials: 'include' });
      if (!res.ok) throw new Error('quote failed');
      const body = await res.json();
      const q = body?.quotes?.[symbol];
      if (!q) throw new Error('no quote');
      return { price: q.price, change: q.change, changePct: q.changePercent };
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
    enabled: !!symbol,
  });

  const handleSymbolChange = (sym: string) => {
    setLocation(`/r/${sym.toUpperCase()}${tab !== 'workup' ? `?tab=${tab}` : ''}`);
  };

  return (
    <div className="space-y-3 px-4 py-3">
      {/* HEADER — ticker switcher + price + sector tags */}
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setLocation(returnTab && returnTab !== 'oracle' ? `/t?tab=${returnTab}` : '/t')}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-[var(--brand-cyan)]/50 hover:text-foreground"
            title={returnTab ? `Back to ${returnTab}` : 'Back to terminal'}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Terminal
          </button>
          <TickerSwitcher
            value={symbol}
            onChange={handleSymbolChange}
            price={quote?.price}
            changePct={quote?.changePct}
          />
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Research · one symbol, every engine
          </span>
        </div>
      </header>

      {/* SUB-NAV TABS */}
      <QETabs items={TABS} active={tab} onChange={setTab} prefixLabel="VIEW" />

      <div className="text-[9px] font-mono text-muted-foreground">
        {TABS.find(t => t.id === tab)?.hint}
      </div>

      {/* CONTENT */}
      <PageErrorBoundary label={`Research · ${symbol} · ${tab}`}>
        <Suspense fallback={<Loading />}>
          {/* Re-key on (symbol, tab) so children get fresh state on switch */}
          <div key={`${symbol}-${tab}`}>
            {tab === 'workup'  && <TickerWorkup symbol={symbol} mode="embedded" initialTab={initialWorkupTab} onNavigate={(next) => { if (next === 'gex') setTab('gex'); }} />}
            {tab === 'gex'     && <TerminalHeatmap />}
            {tab === 'analyze' && <ContractAnalyzer />}
          </div>
        </Suspense>
      </PageErrorBoundary>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="w-4 h-4 animate-spin text-[var(--brand-cyan)]" />
    </div>
  );
}
