/**
 * SIGNAL FILTERS — one reduction, shared by the rail and the grid.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * The two views had disjoint, incompatible filtering:
 *
 *   rail   a ticker text box + NEW / BEST / CONVICTION tabs
 *   grid   side · band · state · has-contract · five sorts, and no text box
 *
 * So switching lens threw away whatever reduction you had made, and neither
 * view could answer a question the other could. Filtering is a property of the
 * BOOK, not of a rendering of it — it belongs above both.
 *
 * This holds the state and the predicate. Both views consume the same `shown`
 * array, so a filter set in one is still set in the other, and there is exactly
 * one place where "which signals am I looking at" is decided.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TICKER BOX DOES SOMETHING NEW
 * ═══════════════════════════════════════════════════════════════════════════
 * Typing a symbol that is NOT in today's book used to return an empty list and
 * stop there, which is the least useful possible answer — the reader knows the
 * ticker exists, they are asking what the platform thinks of it. When the query
 * matches nothing, the bar now offers to grade that symbol on demand through
 * /api/analyze/:symbol rather than rendering a dead end.
 */
import { useMemo, useState } from 'react';
import { Chip, type Tone } from '@/components/templates/kit';
import { cn } from '@/lib/utils';
import type { ConvictionPick } from '@/lib/convictions';
import { getAllApprovedSymbols } from '@shared/approved-tickers';

export type Side = 'all' | 'long' | 'short';
export type Band = 'all' | 'S' | 'A' | 'B' | 'C';
export type State = 'all' | 'live' | 'pending';
export type SortKey = 'conviction' | 'progress' | 'rr' | 'pnl' | 'fresh';

export interface SignalFilterState {
  query: string; side: Side; band: Band; state: State; withContract: boolean; sort: SortKey;
}

export const EMPTY_FILTERS: SignalFilterState = {
  query: '', side: 'all', band: 'all', state: 'all', withContract: false, sort: 'conviction',
};

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'conviction', label: 'Conviction' },
  { id: 'progress', label: 'To T1' },
  { id: 'rr', label: 'R:R' },
  { id: 'pnl', label: 'P&L' },
  { id: 'fresh', label: 'Newest' },
];

/**
 * Levenshtein, bounded. Only ever run against the ~40 symbols in today's book,
 * so the naive DP is free and a library would be overkill.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Symbols in the book that the query probably MEANT.
 *
 * Typing "TSLS" — one key off TSLA, which is in the book — used to return an
 * empty list and then offer to grade a ticker that does not exist, which fires
 * a real API call and fails. A near-miss is overwhelmingly more likely than a
 * deliberate lookup of an unlisted symbol at this edit distance, so the
 * suggestion comes first and the grade offer is demoted behind it.
 */
export function nearMisses(query: string, symbols: string[], max = 3): string[] {
  const q = query.trim().toUpperCase();
  if (q.length < 2) return [];
  return symbols
    .map((s) => ({ s, d: editDistance(q, s.toUpperCase()) }))
    // 1 edit for short tickers, 2 once there is enough length for it to be a
    // typo rather than a different company.
    .filter(({ s, d }) => d > 0 && d <= (q.length >= 4 ? 2 : 1) && Math.abs(s.length - q.length) <= 2)
    .sort((a, b) => a.d - b.d || a.s.localeCompare(b.s))
    // Only offer the CLOSEST tier. Mixing a 2-edit guess in beside a 1-edit one
    // makes the right answer harder to spot, not easier.
    .reduce<{ best: number; out: string[] }>((acc, x) => {
      if (acc.best < 0) acc.best = x.d;
      if (x.d === acc.best && acc.out.length < max) acc.out.push(x.s);
      return acc;
    }, { best: -1, out: [] }).out;
}

export function useSignalFilters() {
  const [filters, setFilters] = useState<SignalFilterState>(EMPTY_FILTERS);
  const set = <K extends keyof SignalFilterState>(k: K, v: SignalFilterState[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));
  const reset = () => setFilters(EMPTY_FILTERS);
  const active =
    filters.query !== '' || filters.side !== 'all' || filters.band !== 'all' ||
    filters.state !== 'all' || filters.withContract;
  return { filters, set, reset, active };
}

/**
 * Apply the reduction. Takes the geometry accessor rather than importing it, so
 * this module stays free of the signal-detail import chain and can be reused by
 * any board that has picks and a way to price them.
 */
export function applyFilters<T extends ConvictionPick>(
  picks: T[],
  f: SignalFilterState,
  geo: (p: T) => { progressPct: number; pnlPct: number; daysHeld: number; statusLabel?: string },
): T[] {
  const q = f.query.trim().toUpperCase();
  let out = picks;
  if (q) out = out.filter((p) => p.symbol.toUpperCase().includes(q));
  if (f.side !== 'all') out = out.filter((p) => p.direction === f.side);
  if (f.band !== 'all') out = out.filter((p) => p.convictionBand === f.band);
  if (f.state !== 'all') {
    out = out.filter((p) => {
      const pending = /pending|trigger/i.test(geo(p).statusLabel ?? '');
      return f.state === 'pending' ? pending : !pending;
    });
  }
  if (f.withContract) out = out.filter((p) => p.optionDte != null);

  const by: Record<SortKey, (a: T, b: T) => number> = {
    conviction: (a, b) => b.convictionScore - a.convictionScore,
    progress: (a, b) => geo(b).progressPct - geo(a).progressPct,
    rr: (a, b) => (b.riskRewardRatio ?? 0) - (a.riskRewardRatio ?? 0),
    pnl: (a, b) => geo(b).pnlPct - geo(a).pnlPct,
    fresh: (a, b) => geo(a).daysHeld - geo(b).daysHeld,
  };
  return [...out].sort(by[f.sort]);
}

export function SignalFilterBar({
  filters, set, reset, active, picks, shownCount, suggestFrom, onGradeTicker, grading, compact,
}: {
  filters: SignalFilterState;
  set: <K extends keyof SignalFilterState>(k: K, v: SignalFilterState[K]) => void;
  reset: () => void;
  active: boolean;
  picks: ConvictionPick[];
  shownCount: number;
  /**
   * Symbols to draw "did you mean" from. Defaults to `picks`, but the caller
   * should pass the FULL book: the visible picks are already narrowed by MODE,
   * so typing "TSLS" suggested FSLY (2 edits) purely because TSLA (1 edit) was
   * outside the active mode. A suggestion drawn from less than the platform
   * knows is a worse guess than the platform can actually make.
   */
  suggestFrom?: ConvictionPick[];
  /** Called when the typed symbol is not in the book and the user asks to grade it. */
  onGradeTicker?: (symbol: string) => void;
  grading?: boolean;
  /** Rail variant: stacks, drops the sort row. */
  compact?: boolean;
}) {
  const [compactOpen, setCompactOpen] = useState(false);
  const bandCount = useMemo(() => {
    const c: Record<string, number> = { all: picks.length, S: 0, A: 0, B: 0, C: 0 };
    picks.forEach((p) => { c[p.convictionBand] = (c[p.convictionBand] ?? 0) + 1; });
    return c;
  }, [picks]);

  const q = filters.query.trim().toUpperCase();
  const inBook = q ? picks.some((p) => p.symbol.toUpperCase() === q) : true;
  /**
   * Suggest from the whole APPROVED UNIVERSE, not just the loaded book.
   *
   * The cockpit fetches ?limit=40&minScore=10, so only the top 40 ideas are in
   * memory. Typing "TSLS" suggested FSLY because TSLA had just dropped to score
   * 10 and fell outside that window — the platform knew the symbol perfectly
   * well, the component simply could not see it. Drawing from the universe means
   * the guess no longer depends on whether the name happens to be published
   * today.
   */
  const universe = useMemo(() => getAllApprovedSymbols(), []);
  const bookSymbols = useMemo(
    () => new Set((suggestFrom?.length ? suggestFrom : picks).map((p) => p.symbol.toUpperCase())),
    [suggestFrom, picks],
  );
  // A known ticker that simply has no published signal is not a typo. TSLA was
  // being offered FSLY/SLV/TSEM because the old test only knew whether it was in
  // today's book, not whether QuantEdge actually covers it.
  const knownTicker = !!q && universe.includes(q);
  const suggestions = useMemo(
    () => (q && !inBook && !knownTicker && shownCount === 0 ? nearMisses(q, universe) : []),
    [q, inBook, knownTicker, shownCount, universe],
  );
  // Only offer to grade once we are reasonably sure it is not a typo. Grading
  // costs a live API call, and spending one on "TSLS" is worse than useless.
  const canGrade = !!q && !inBook && shownCount === 0 && !!onGradeTicker && suggestions.length === 0;
  const activeFilterCount = Number(filters.side !== 'all') + Number(filters.band !== 'all') +
    Number(filters.state !== 'all') + Number(filters.withContract);
  const showControls = !compact || compactOpen;

  return (
    <div className={cn(
      'rounded-lg border border-card-border bg-card px-3 py-2.5',
      compact ? 'space-y-2' : 'flex flex-wrap items-center gap-x-5 gap-y-2',
    )}>
      <div className={cn('flex items-center gap-1.5', compact && 'justify-between')}>
        <input
          value={filters.query}
          onChange={(e) => set('query', e.target.value)}
          onKeyDown={(e) => {
            // Enter on a covered ticker is an analysis action, not an attempt to
            // filter an empty book. The button remains visible for mouse users.
            if (e.key === 'Enter' && knownTicker && !inBook && onGradeTicker) {
              e.preventDefault();
              onGradeTicker(q);
            }
          }}
          placeholder="ticker"
          aria-label="Filter book by ticker"
          className={cn('w-20 rounded border border-border/50 bg-background/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-foreground outline-none transition-[width,border-color] focus:w-28 focus:border-[var(--brand-cyan)]', compact && 'flex-1')}
        />
        {filters.query && (
          <button
            onClick={() => set('query', '')}
            className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
            aria-label="Clear ticker"
          >
            ✕
          </button>
        )}
        {compact && (
          <button
            type="button"
            onClick={() => setCompactOpen((v) => !v)}
            className={cn(
              'shrink-0 border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] transition-colors',
              compactOpen || activeFilterCount > 0
                ? 'border-[var(--brand-cyan)]/45 bg-[var(--brand-cyan)]/10 text-[var(--brand-cyan)]'
                : 'border-border/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground',
            )}
          >
            {compactOpen ? 'done' : activeFilterCount > 0 ? `filters ${activeFilterCount}` : 'filters'}
          </button>
        )}
      </div>

      {showControls && <>
      <FilterGroup label="Side">
        {(['all', 'long', 'short'] as Side[]).map((d) => (
          <Chip key={d} active={filters.side === d} onClick={() => set('side', d)}
            tone={(d === 'short' ? 'bear' : d === 'long' ? 'bull' : 'structural') as Tone}>
            {d === 'all' ? 'All' : d}
          </Chip>
        ))}
      </FilterGroup>

      <FilterGroup label="Band">
        {(['all', 'S', 'A', 'B', 'C'] as Band[]).map((b) => (
          <Chip key={b} active={filters.band === b} onClick={() => set('band', b)}>
            {b === 'all' ? 'All' : b}
            <span className="ml-1 opacity-50">{bandCount[b] ?? 0}</span>
          </Chip>
        ))}
      </FilterGroup>

      <FilterGroup label="State">
        {(['all', 'live', 'pending'] as State[]).map((s) => (
          <Chip key={s} active={filters.state === s} onClick={() => set('state', s)}>
            {s === 'all' ? 'All' : s === 'live' ? 'In play' : 'Pending'}
          </Chip>
        ))}
      </FilterGroup>

      <Chip active={filters.withContract} dot={filters.withContract}
        onClick={() => set('withContract', !filters.withContract)} tone="time">
        Has contract
      </Chip>

      {!compact && (
        <FilterGroup label="Sort" className="ml-auto">
          {SORTS.map((s) => (
            <Chip key={s.id} active={filters.sort === s.id} onClick={() => set('sort', s.id)}>
              {s.label}
            </Chip>
          ))}
        </FilterGroup>
      )}
      </>}

      {/* Count + escape. Never truncate silently. */}
      <div className={cn('flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground', compact ? '' : 'w-full')}>
        <span>{shownCount} of {picks.length} shown</span>
        {active && (
          <button onClick={reset} className="text-[color:var(--brand-cyan)] transition-opacity hover:opacity-70">
            clear
          </button>
        )}
      </div>

      {/* Probably a typo — offer the real symbol before anything else. */}
      {suggestions.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-2 border-t border-border/40 pt-2">
          <span className="font-mono text-[10px] text-muted-foreground">Did you mean</span>
          {suggestions.map((sym) => {
            const listed = bookSymbols.has(sym);
            return (
              <button
                key={sym}
                // A suggestion the book does not carry cannot be filtered to —
                // grade it instead, or the click would land on an empty list.
                onClick={() => (listed ? set('query', sym) : onGradeTicker?.(sym))}
                title={listed ? `Filter to ${sym}` : `${sym} isn't published today — grade it`}
                className="rounded border border-[var(--brand-cyan)]/40 bg-[var(--brand-cyan)]/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--brand-cyan)] transition-colors hover:bg-[var(--brand-cyan)]/20"
              >
                {sym}{listed ? '' : ' ↗'}
              </button>
            );
          })}
          {onGradeTicker && (
            <button
              onClick={() => onGradeTicker(q)}
              disabled={grading}
              className="font-mono text-[10px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
            >
              no, grade {q}
            </button>
          )}
        </div>
      )}

      {/* A ticker the book does not carry is a question, not a dead end. */}
      {canGrade && (
        <div className="flex w-full items-center gap-2 border-t border-border/40 pt-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {knownTicker ? `${q} is covered, but has no published signal today.` : `${q} isn’t in today’s book.`}
          </span>
          <button
            onClick={() => onGradeTicker?.(q)}
            disabled={grading}
            className="rounded border border-[var(--brand-cyan)]/40 bg-[var(--brand-cyan)]/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--brand-cyan)] transition-colors hover:bg-[var(--brand-cyan)]/20 disabled:opacity-50"
          >
            {grading ? 'analysing…' : `analyse ${q}`}
          </button>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children, className }: {
  label: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
