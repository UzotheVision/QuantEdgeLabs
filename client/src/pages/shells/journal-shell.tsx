/**
 * JOURNAL — "How do I get better"
 *
 * Tabs: Trade Log | History | Metrics | Backtest
 */
import { lazy, Suspense } from 'react';
import { QETabs, type QETabItem } from '@/components/ui/qe-tabs';
import { useTabState } from '@/hooks/use-tab-state';
import { PageErrorBoundary } from '@/components/page-error-boundary';
import { Loader2 } from 'lucide-react';

const Performance       = lazy(() => import('@/pages/performance'));
const TradeJournal      = lazy(() => import('@/pages/trade-journal'));
const StrategySim       = lazy(() => import('@/pages/strategy-simulator'));

type Tab = 'log' | 'metrics' | 'backtest';

/**
 * Trade Log pointed at pages/history.tsx, which renders /api/ai/chat/history and
 * /api/research-history — your AI chats and research runs, under a tab whose own
 * hint read "Every trade you took". The actual trade log, pages/trade-journal.tsx,
 * was orphaned with six live /api/journal/* endpoints and no way in.
 *
 * Trade Log now shows trades. The chat/research history keeps its own tab rather
 * than being deleted, since it was the only door to those two endpoints.
 *
 * The 'mistakes' tab is gone — it rendered ComingSoon and was not in this array
 * anyway, so it was an unreachable branch advertising a feature that does not exist.
 *
 * The 'academy' tab was removed per product decision (2026-09-09): the Academy
 * rendered the full standalone /academy page inside the Terminal, duplicating it.
 * /academy remains the canonical home for learning content.
 */
const TABS: readonly QETabItem<Tab>[] = [
  { id: 'log',      label: 'Trade Log', hint: 'Every trade you took' },
  // Consolidated 2026-09-24: the standalone PERF page rendered this exact
  // component a second time; /performance now redirects here.
  { id: 'metrics',  label: 'Track record', hint: 'How the published ideas actually did — hit rate, expectancy, sample size' },
  { id: 'backtest', label: 'Backtest',  hint: 'Run strategies on historicals' },
];

const VALID_TABS = TABS.map(t => t.id);

export default function JournalShell() {
  const [tab, setTab] = useTabState<Tab>('log', VALID_TABS, 'jtab');

  return (
    <div className="space-y-3 px-4 py-3">
      <QETabs items={TABS} active={tab} onChange={setTab} prefixLabel="VIEW" />

      <PageErrorBoundary label={`Journal · ${tab}`}>
        <Suspense fallback={<Loading />}>
          {tab === 'log'      && <TradeJournal />}
          {tab === 'metrics'  && <Performance />}
          {tab === 'backtest' && <StrategySim />}
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
