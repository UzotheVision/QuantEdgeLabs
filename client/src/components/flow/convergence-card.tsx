/**
 * FLOW × GEX CONVERGENCE — the loop from the MomoEdge walkthrough, made explicit.
 *
 * He never trades a flow hit on its own. He takes the candidate and immediately
 * checks the gamma picture: "This whale trade looks interesting… let me dive into
 * Prism on QCOM. 190 is a big level it could potentially break and then get up to
 * 200." Flow says somebody is positioned; gamma says whether dealers will amplify
 * or absorb the move. Agreement is the setup, and disagreement is a warning.
 *
 * The two bars are the whole point: flow direction on top, dealer regime beneath.
 * When they point the same way the row is the trade; when they don't, the size of
 * the mismatch is visible rather than buried in a sentence.
 */
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Crosshair } from 'lucide-react';
import { EASE, DUR } from '@/lib/motion';
import { TC } from '@/lib/design-tokens';
import { useStockContext } from '@/contexts/stock-context';

interface Convergence {
  symbol: string;
  conviction: 'HIGH' | 'MEDIUM' | 'LOW';
  gexBias: 'Long Gamma' | 'Short Gamma' | 'Neutral';
  flowBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  flowStrength: number;
  convergenceType: string;
  flowCount: number;
  totalPremium: number;
  gexAnchor: number;
  gexFlipPoint: number | null;
  spotPrice: number;
  reasoning: string;
  strategy: string;
}

const CONV_COLOR = { HIGH: TC.bull, MEDIUM: TC.warn, LOW: TC.muted } as const;
const flowColor = (b: string) => (b === 'BULLISH' ? TC.bull : b === 'BEARISH' ? TC.bear : TC.muted);
// Short gamma means dealers amplify moves — the volatile regime, so it reads warm.
const gexColor = (b: string) => (b === 'Short Gamma' ? TC.warn : b === 'Long Gamma' ? TC.info : TC.muted);

function Bar({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-10 shrink-0 text-label font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 min-w-[30px] overflow-hidden rounded-full bg-foreground/[0.07]">
        <div className="h-full rounded-full transition-[width] duration-500"
             style={{ width: `${Math.max(3, Math.min(100, pct))}%`, background: color }} />
      </div>
      <span className="w-24 shrink-0 text-right text-label font-mono" style={{ color }}>{value}</span>
    </div>
  );
}


/**
 * Where spot sits relative to the gamma flip.
 *
 * The flip is the price where dealer hedging changes sign. Below it they are short
 * gamma and must sell into weakness and buy into strength — moves get amplified.
 * Above it they are long gamma and do the opposite — moves get absorbed. So the
 * useful facts are which side price is on, and how close it is to crossing.
 */
function FlipAxis({ spot, flip, bias }: { spot: number; flip: number | null; bias: string }) {
  if (!flip || !(spot > 0)) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-10 shrink-0 text-label font-mono uppercase tracking-wider text-muted-foreground">Gamma</span>
        <span className="text-label font-mono text-muted-foreground">
          no readable flip in this chain — regime undefined
        </span>
      </div>
    );
  }

  const distPct = ((spot - flip) / flip) * 100;
  const above = distPct >= 0;
  const color = above ? TC.info : TC.warn;
  // Clamp the visual to ±6%; past that the exact distance stops mattering because
  // the regime isn't realistically flipping intraday.
  const offset = Math.max(-1, Math.min(1, distPct / 6));
  const leftPct = 50 + offset * 46;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-10 shrink-0 text-label font-mono uppercase tracking-wider text-muted-foreground">Gamma</span>
      <div className="relative h-4 flex-1 min-w-[60px]">
        {/* amplify (below flip) | dampen (above flip) */}
        <div className="absolute inset-y-[6px] left-0 right-1/2 rounded-l-full" style={{ background: `color-mix(in srgb, ${TC.warn} 22%, transparent)` }} />
        <div className="absolute inset-y-[6px] left-1/2 right-0 rounded-r-full" style={{ background: `color-mix(in srgb, ${TC.info} 22%, transparent)` }} />
        {/* the flip itself */}
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/40" />
        {/* spot marker */}
        <div
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${leftPct}%`, background: color, boxShadow: `0 0 6px color-mix(in srgb, ${color} 70%, transparent)` }}
          title={`Spot $${spot.toFixed(2)} is ${Math.abs(distPct).toFixed(1)}% ${above ? 'above' : 'below'} the flip at $${flip}`}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-label font-mono tabular-nums" style={{ color }}>
        {Math.abs(distPct).toFixed(1)}% {above ? 'above' : 'below'}
      </span>
    </div>
  );
}

export function ConvergenceCard({ className }: { className?: string }) {
  const { setCurrentStock } = useStockContext();
  const { data, isLoading, isError } = useQuery<{ signals: Convergence[] }>({
    queryKey: ['/api/flow-gex-convergence/top'],
    queryFn: async () => {
      const r = await fetch('/api/flow-gex-convergence/top?limit=6', { credentials: 'include' });
      if (!r.ok) throw new Error('convergence failed');
      const j = await r.json();
      return { signals: Array.isArray(j) ? j : (j.signals ?? []) };
    },
    staleTime: 300_000, refetchInterval: 600_000, retry: 1,
  });

  const signals = data?.signals ?? [];

  return (
    <div className={`rounded-xl border border-card-border bg-card overflow-hidden ${className ?? ''}`}>
      <div className="flex items-start gap-2.5 border-b border-border/40 px-4 py-2.5">
        <Crosshair className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TC.info }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-meta font-mono font-bold uppercase tracking-widest text-foreground/80">Flow × Gamma</span>
            <span className="text-label font-mono tabular-nums text-muted-foreground">{signals.length}</span>
          </div>
          <div className="text-label font-mono text-muted-foreground mt-0.5">
            Does the dealer positioning back what the flow is doing?
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid place-items-center py-10 text-label font-mono uppercase tracking-widest text-muted-foreground">
          reading gamma…
        </div>
      ) : isError ? (
        <div className="grid place-items-center py-10 text-label font-mono uppercase tracking-widest text-muted-foreground">
          convergence unavailable
        </div>
      ) : signals.length === 0 ? (
        <div className="px-4 py-8 text-center ui-prose text-label leading-relaxed text-muted-foreground">
          No symbol currently has both a directional flow lean and a readable gamma regime.
        </div>
      ) : (
        <div className="divide-y divide-border/25">
          {signals.map((s, i) => {
            const cc = CONV_COLOR[s.conviction] ?? TC.muted;
            return (
              <motion.button
                key={s.symbol}
                onClick={() => setCurrentStock({ symbol: s.symbol })}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DUR.base, ease: EASE, delay: Math.min(i * 0.04, 0.3) }}
                className="w-full cursor-pointer px-4 py-2.5 text-left transition-colors hover:bg-foreground/[0.03]"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-body font-mono font-bold tracking-wide text-foreground">{s.symbol}</span>
                  <span className="text-label font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ color: cc, background: `color-mix(in srgb, ${cc} 12%, transparent)` }}>
                    {s.conviction}
                  </span>
                  <span className="text-label font-mono text-muted-foreground">
                    {s.convergenceType.replace(/_/g, ' ').toLowerCase()}
                  </span>
                  <span className="ml-auto text-label font-mono tabular-nums text-muted-foreground">
                    {s.flowCount} prints{s.gexFlipPoint ? ` · flip $${s.gexFlipPoint}` : ''}
                  </span>
                </div>

                <div className="mt-1.5 space-y-1.5">
                  {/* Flow strength IS a percentage (how lopsided call vs put premium is),
                      so a filled bar is the honest encoding. */}
                  <Bar label="Flow" value={`${s.flowBias.toLowerCase()} ${s.flowStrength}%`} pct={s.flowStrength} color={flowColor(s.flowBias)} />
                  {/* Gamma regime is NOT a percentage. This used to render a bar that was
                      100% wide for both Long and Short Gamma — the length meant nothing,
                      which made it decoration wearing the costume of a measurement. What
                      IS measurable is where spot sits relative to the flip: below it
                      dealers amplify moves, above it they dampen them, and how FAR from
                      it decides whether that regime is about to change. */}
                  <FlipAxis spot={s.spotPrice} flip={s.gexFlipPoint} bias={s.gexBias} />
                </div>

                <div className="mt-1 ui-prose text-label leading-snug text-muted-foreground">{s.reasoning}</div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ConvergenceCard;
