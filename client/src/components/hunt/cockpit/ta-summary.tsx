/**
 * TASummary — compact, always-visible technical read for the cockpit subject.
 * Pulls the same /api/ta payload the chart overlay uses, so the Fib levels and
 * candlestick patterns are surfaced even when they fall outside the chart's
 * visible price band. One glanceable strip: net bias, structure, Fib zone +
 * key retracements, detected pattern, and the confluence reasons behind it.
 *
 * Honesty: renders nothing while loading / on error / with no data. No fakes.
 */
import { useTA } from './use-ta';
import { cn } from '@/lib/utils';

const BIAS_STYLE: Record<string, string> = {
  bullish: 'text-[var(--trade-bullish)] border-[var(--trade-bullish)]/40 bg-[var(--trade-bullish)]/10',
  bearish: 'text-[var(--trade-bearish)] border-[var(--trade-bearish)]/40 bg-[var(--trade-bearish)]/10',
  neutral: 'text-muted-foreground border-border bg-muted/20',
};

export function TASummary({ symbol }: { symbol: string }) {
  const { ta, isLoading, isError } = useTA(symbol, '6mo', '1d', true);

  if (isLoading || isError || !ta) return null;

  const keyFibs = ta.fib?.levels.filter((l) => l.key) ?? [];
  const patterns = ta.patterns.filter((p) => p.detected && p.type !== 'neutral');

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2.5">
      {/* header row: net TA bias + structure */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Technical Read
        </span>
        <span
          className={cn(
            'px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider border',
            BIAS_STYLE[ta.bias.direction],
          )}
          title={`Net TA bias score: ${ta.bias.score} (−100 bearish … +100 bullish)`}
        >
          {ta.bias.direction} {ta.bias.score > 0 ? '+' : ''}{ta.bias.score}
        </span>
      </div>

      {/* structure + fib zone */}
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        {ta.structure && (
          <div>
            <div className="text-muted-foreground text-[9px] uppercase tracking-wider">Structure</div>
            <div className="text-foreground capitalize">
              {ta.structure.trend}
              {ta.structure.breakOfStructure && <span className="text-[var(--brand-gold,#d4af37)]"> · BOS</span>}
            </div>
          </div>
        )}
        {ta.fib && (
          <div>
            <div className="text-muted-foreground text-[9px] uppercase tracking-wider">Fib Zone ({ta.fib.trend === 'uptrend' ? 'up' : 'down'})</div>
            <div className="text-foreground">{ta.fib.currentZone}</div>
          </div>
        )}
      </div>

      {/* key fib retracement levels */}
      {keyFibs.length > 0 && (
        <div>
          <div className="text-muted-foreground text-[9px] uppercase tracking-wider mb-1">Key Fib Levels</div>
          <div className="flex flex-wrap gap-1.5">
            {keyFibs.map((l) => (
              <span
                key={l.ratio}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-[var(--brand-gold,#d4af37)]/30 text-[var(--brand-gold,#d4af37)]"
              >
                {l.label} ${l.price.toFixed(2)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* candlestick patterns on latest candle */}
      {patterns.length > 0 && (
        <div>
          <div className="text-muted-foreground text-[9px] uppercase tracking-wider mb-1">Candlestick</div>
          <div className="flex flex-wrap gap-1.5">
            {patterns.map((p) => (
              <span
                key={p.name}
                className={cn(
                  'px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border',
                  p.type === 'bullish'
                    ? 'text-[var(--trade-bullish)] border-[var(--trade-bullish)]/40'
                    : 'text-[var(--trade-bearish)] border-[var(--trade-bearish)]/40',
                )}
              >
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* confluence reasons */}
      {ta.bias.confluence.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 pt-1 border-t border-border/30">
          {ta.bias.confluence.map((c, i) => (
            <span key={i} className="text-[10px] font-mono text-muted-foreground">
              · {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
