/**
 * GAP MAGNETS — the unfilled gaps a symbol is likely to trade back into.
 *
 * Sits under the price ladder, and deliberately NOT as extra rungs on it. The
 * ladder holds PLAN levels — entry, stop, the targets we committed to. A gap is
 * MARKET STRUCTURE: it exists whether or not we have a position, and it is not a
 * level anyone chose. Mixing the two would make an observation look like a
 * decision.
 *
 * Why this is worth its own strip: on QCOM the bear-flag scanner published a
 * target of 136.64, which looks uncanny next to the real unfilled gap at 136.99.
 * It isn't insight — the scanner computes `currentPrice * (1 - pct/100)` where
 * pct is `min(bounce * 2, 15)`, and QCOM hit the 15 cap. A flat percentage
 * landed a third of a dollar from a real level by luck. This strip shows the
 * level the flat number was accidentally approximating.
 *
 * The fill rate is the point. "Price fills gaps" is folklore until you count;
 * /api/gaps/:symbol reports the symbol's own history (QCOM: 32 of 33, median 4
 * bars). A magnet with a measured base rate is a level you can size against. One
 * without is a story.
 */
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

interface Gap {
  direction: 'up' | 'down';
  from: number;
  to: number;
  mid: number;
  sizePct: number;
  ageBars: number;
  nearEdge: number;
  distancePct: number;
}

interface GapReport {
  symbol: string;
  spot: number;
  unfilled: Gap[];
  stats?: {
    total: number;
    filled: number;
    fillRate: number;
    medianBarsToFill: number | null;
    sampleConfidence: string;
  };
}

const money = (n: number) => n.toFixed(2);

export function GapMagnets({ symbol, className }: { symbol: string; className?: string }) {
  const { data, isLoading, isError } = useQuery<GapReport>({
    queryKey: ['/api/gaps', symbol],
    queryFn: async () => {
      const r = await fetch(`/api/gaps/${symbol}`, { credentials: 'include' });
      if (!r.ok) throw new Error('gap read failed');
      return r.json();
    },
    enabled: !!symbol,
    staleTime: 300_000,
    retry: 1,
  });

  if (!symbol || isLoading) return null;

  // An empty result means "no unfilled gaps", which is a real answer about this
  // symbol — say it, rather than rendering nothing and letting the absence read
  // as a loading state that never resolved.
  if (isError) {
    return (
      <div className={cn('border-t border-border/30 px-4 py-2.5', className)}>
        <span className="text-label font-mono text-muted-foreground">
          Gap history unavailable for {symbol}
        </span>
      </div>
    );
  }

  // Nearest first, and only what price could plausibly reach. The raw feed
  // returns every unfilled gap on the chart — on CRCL that included one 141.9%
  // away, which is a historical artifact, not a magnet. A level you cannot trade
  // to is clutter sitting where an actionable one should be.
  const REACHABLE_PCT = 25;
  const gaps = (data?.unfilled ?? [])
    .filter((gp) => Math.abs(gp.distancePct) <= REACHABLE_PCT)
    .sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct))
    .slice(0, 3);
  const hidden = (data?.unfilled ?? []).length - gaps.length;
  const stats = data?.stats;

  return (
    <div className={cn('border-t border-border/30 px-4 py-2.5', className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-label font-mono uppercase tracking-widest text-muted-foreground">
          Unfilled gaps
        </span>
        {stats && stats.total > 0 && (
          <span className="text-label font-mono tabular-nums text-muted-foreground">
            fills {Math.round(stats.fillRate * 100)}%
            <span className="text-muted-foreground"> · {stats.filled}/{stats.total}</span>
            {stats.medianBarsToFill != null && (
              <span className="text-muted-foreground"> · median {stats.medianBarsToFill} bars</span>
            )}
          </span>
        )}
      </div>

      {gaps.length === 0 ? (
        <span className="text-label font-mono text-muted-foreground">
          {hidden > 0
            ? `No unfilled gap within ${REACHABLE_PCT}% of spot — ${hidden} further out.`
            : 'None open — every gap on this chart has been filled.'}
        </span>
      ) : (
        <div className="flex flex-col gap-1">
          {gaps.map((gp) => {
            const below = gp.distancePct < 0;
            return (
              <div key={`${gp.from}-${gp.to}`} className="flex items-center gap-2 text-label font-mono tabular-nums">
                {/* Dashed, muted: structure, not a level anyone chose. */}
                <span
                  aria-hidden
                  className="h-px w-3 shrink-0"
                  style={{
                    background: `repeating-linear-gradient(90deg, var(--brand-gold) 0 3px, transparent 3px 6px)`,
                  }}
                />
                <span className="text-foreground/80">
                  ${money(gp.from)}–${money(gp.to)}
                </span>
                <span className="text-muted-foreground">
                  {gp.sizePct.toFixed(1)}% · {gp.ageBars}b old
                </span>
                <span
                  className="ml-auto"
                  style={{ color: below ? 'var(--trade-bearish)' : 'var(--trade-bullish)' }}
                >
                  {gp.distancePct >= 0 ? '+' : ''}{gp.distancePct.toFixed(1)}%
                </span>
              </div>
            );
          })}
          {hidden > 0 && (
            /* Never truncate silently — a shorter list would read as "these are
               all the gaps" when it is really "these are the reachable ones". */
            <span className="pt-0.5 text-label font-mono text-muted-foreground">
              {hidden} more beyond {REACHABLE_PCT}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
