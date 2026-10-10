/**
 * EVIDENCE RAIL — the bridge from a signal to the evidence for it.
 *
 * The gap this closes: the Terminal is organised by DATA SOURCE (Oracle / Flow /
 * GEX / Catalyst) while a trader works in STAGES (discover → validate → size →
 * execute). Discovery lives in Oracle, but validation lived in sibling tabs — so
 * checking a signal meant leaving the signal, opening another tab, and typing the
 * ticker in again. The evidence was a peer of the signal instead of a child of it.
 *
 * Research (`/r/:symbol`) already holds the per-ticker evidence, correctly
 * consolidated. What was missing was the door: one link to the chart tab, from one
 * screen. This is that door, widened — every evidence surface, already bound to
 * the symbol you were looking at.
 *
 * Deliberately a component and not a copied JSX block: a symbol appears in the
 * signal card, the watchlist, the rotation map and the flow board, and each of
 * those growing its own set of links is how "GEX" ends up meaning two different
 * things in two places. One rail, one set of destinations.
 */
import { useLocation } from 'wouter';
import { cn } from '@/lib/utils';

type ResearchTab = 'chart' | 'gex' | 'flow' | 'options' | 'analyze';

/**
 * Labelled by the QUESTION each tab answers, not by the tab's own name. "GEX" is
 * a data source; "where dealers hedge" is why you would click it.
 */
const EVIDENCE: { tab: ResearchTab; label: string; asks: string }[] = [
  { tab: 'chart',   label: 'Chart',   asks: 'What has price actually done?' },
  { tab: 'gex',     label: 'Gamma',   asks: 'Where do dealers have to hedge?' },
  { tab: 'flow',    label: 'Flow',    asks: 'Who else is positioned here?' },
  { tab: 'options', label: 'Chain',   asks: 'What contract, and at what price?' },
  { tab: 'analyze', label: 'Analyze', asks: 'What does the full read say?' },
];

export function EvidenceRail({
  symbol,
  className,
  compact = false,
}: {
  symbol: string;
  className?: string;
  /** Drops the prompt line — for dense rows where the label alone is enough. */
  compact?: boolean;
}) {
  const [, setLocation] = useLocation();
  if (!symbol) return null;
  const sym = symbol.toUpperCase();

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {!compact && (
        <div className="text-label font-mono uppercase tracking-widest text-muted-foreground">
          Check {sym} against
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {EVIDENCE.map((e) => (
          <button
            key={e.tab}
            onClick={() => setLocation(`/r/${sym}?tab=${e.tab}`)}
            title={e.asks}
            className={cn(
              'group inline-flex items-center gap-1.5 rounded border px-2 py-1',
              'border-border/60 bg-card/40 text-[11px] font-mono',
              'text-muted-foreground transition-colors',
              'hover:border-[var(--brand-cyan)]/50 hover:text-[var(--brand-cyan)]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--brand-cyan)]',
            )}
          >
            {e.label}
            <span aria-hidden className="text-muted-foreground group-hover:text-[var(--brand-cyan)]/70">
              ↗
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
