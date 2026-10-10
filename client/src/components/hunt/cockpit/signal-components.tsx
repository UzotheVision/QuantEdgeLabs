/**
 * SIGNAL COMPONENTS — evidence ledger, not a stack of generic progress bars.
 *
 * A layer is an assertion with a reason, not a percentage being filled. The
 * ledger leads with the evidence carrying the most weight, surfaces dissent as
 * its own category, and expands an individual explanation on demand.
 */
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { LAYER_TAG, type ConvictionLayer } from '@/lib/convictions';

export function SignalComponents({
  layers,
  className,
  max = 5,
  showSummary = true,
}: {
  layers: ConvictionLayer[];
  className?: string;
  max?: number;
  showSummary?: boolean;
}) {
  const reduce = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const ranked = [...layers].filter((layer) => layer.points !== 0).sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const visible = expanded ? ranked : ranked.slice(0, max);
  const plus = ranked.filter((l) => l.points > 0).reduce((s, l) => s + l.points, 0);
  const minus = ranked.filter((l) => l.points < 0).reduce((s, l) => s + l.points, 0);
  const against = ranked.filter((l) => l.points < 0);

  if (ranked.length === 0) {
    return <div className="py-2 font-mono text-[10px] text-muted-foreground">No scored evidence was returned.</div>;
  }

  return (
    <div className={cn('space-y-2.5', className)}>
      {showSummary && (
        <div className="grid grid-cols-2 gap-px border border-border/45 bg-border/45 font-mono text-[10px] tabular-nums">
          <div className="bg-card px-2.5 py-2"><span className="text-muted-foreground">SUPPORT</span><span className="float-right font-bold text-[var(--trade-bullish)]">+{plus}</span></div>
          <div className="bg-card px-2.5 py-2"><span className="text-muted-foreground">CHALLENGE</span><span className="float-right font-bold text-[var(--trade-bearish)]">{minus || '—'}</span></div>
        </div>
      )}

      <div className="border-y border-border/45">
        {visible.map((layer, index) => {
          const key = `${layer.kind}-${index}`;
          const isOpen = key === openKey;
          const positive = layer.points > 0;
          const color = positive ? 'var(--trade-bullish)' : 'var(--trade-bearish)';
          return (
            <div key={key} className="border-b border-border/30 last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenKey(isOpen ? null : key)}
                aria-expanded={isOpen}
                className="grid w-full cursor-pointer grid-cols-[3px_minmax(0,1fr)_auto_auto] items-center gap-2 px-0 py-2.5 text-left transition-colors hover:bg-foreground/[0.035]"
              >
                <span className="self-stretch" style={{ background: color }} />
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-foreground/90">{layer.label || LAYER_TAG[layer.kind]}</span>
                  <span className="block truncate font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{positive ? 'supports thesis' : 'argues against'}</span>
                </span>
                <span className="font-mono text-[11px] font-bold tabular-nums" style={{ color }}>{positive ? '+' : ''}{layer.points}</span>
                <span className="pr-2 font-mono text-[10px] text-muted-foreground">{isOpen ? '−' : '+'}</span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && layer.why && (
                  <motion.div
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={reduce ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <p className="border-t border-border/25 bg-foreground/[0.02] px-3 py-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">{layer.why}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {ranked.length > max && (
        <button
          type="button"
          onClick={() => { setExpanded((value) => !value); setOpenKey(null); }}
          className="w-full cursor-pointer border border-border/45 px-2.5 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.11em] text-muted-foreground transition-colors hover:border-[var(--brand-cyan)]/50 hover:text-[var(--brand-cyan)]"
        >
          {expanded ? 'Show deciding evidence' : `Inspect all ${ranked.length} scored layers (+${ranked.length - max})`}
        </button>
      )}

      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        {against.length === 0
          ? 'No scored layer currently disputes the thesis.'
          : `${against.length} counter-signal${against.length > 1 ? 's' : ''}: ${against.map((layer) => layer.label || LAYER_TAG[layer.kind]).join(', ')}.`}
      </p>
    </div>
  );
}
