/**
 * CONTRACT VALUE — the cost side of a trade the board already has a view on.
 *
 * The signal says where price is going. This says whether the contract expressing
 * that view is worth its premium, by putting two moves on ONE shared axis:
 *
 *     what the option is PRICED for   (spot × IV × √(dte/365))
 *     what our TARGET actually needs  (|T1 − spot|)
 *
 * Drawn as two bars on the same scale, because "17.6% vs 11.2%" is a sentence you
 * have to parse and two bars is a thing you see. When our bar is longer, the market
 * is underwriting the thesis cheaply — that's the edge. When it's shorter, the move
 * is already in the premium and direction alone won't pay.
 *
 * Deliberately not a buy signal: it's one input, and every verdict shows its inputs.
 */
import { assessContract, type ContractValue } from '@shared/contract-value';
import { TC } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';

const VERDICT_COLOR: Record<string, string> = {
  cheap: TC.bull,
  fair: TC.info,
  rich: TC.bear,
  unknown: TC.muted,
};

/** Two moves, one axis. The comparison IS the visual. */
function MoveComparison({ pricedPct, targetPct }: { pricedPct: number; targetPct: number | null }) {
  const max = Math.max(pricedPct, targetPct ?? 0, 0.1) * 1.1;
  const w = (v: number) => `${Math.max(1, (v / max) * 100)}%`;
  // Our bar is green only when it CLEARS what's priced in — the whole point.
  const targetColor = targetPct != null && targetPct > pricedPct ? TC.bull : TC.muted;

  return (
    <div className="space-y-1.5">
      <Row label="Priced in" pct={pricedPct} width={w(pricedPct)} color={TC.info} note="±1σ by expiry" />
      {targetPct != null && (
        <Row label="Our target" pct={targetPct} width={w(targetPct)} color={targetColor} note="to T1" />
      )}
    </div>
  );
}

function Row({ label, pct, width, color, note }: { label: string; pct: number; width: string; color: string; note: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-label font-mono tabular-nums shrink-0" style={{ color }}>
          {pct.toFixed(1)}% <span className="text-muted-foreground">{note}</span>
        </span>
      </div>
      <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width, background: color }} />
      </div>
    </div>
  );
}

/** Cost drag — spread and theta, the two things that quietly eat a correct thesis. */
function CostBar({ label, pct, danger, unit = '%' }: { label: string; pct: number | null; danger: number; unit?: string }) {
  if (pct == null) return null;
  const color = pct >= danger ? TC.bear : pct >= danger * 0.6 ? TC.warn : TC.muted;
  const width = `${Math.min(100, (pct / (danger * 2)) * 100)}%`;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-label font-mono uppercase tracking-wider text-muted-foreground w-14 shrink-0">{label}</span>
      <div className="h-1.5 flex-1 min-w-[30px] overflow-hidden rounded-full bg-foreground/[0.07]">
        <div className="h-full rounded-full" style={{ width, background: color }} />
      </div>
      <span className="text-label font-mono tabular-nums shrink-0 w-12 text-right" style={{ color }}>
        {pct.toFixed(1)}{unit}
      </span>
    </div>
  );
}

export function ContractValuePanel({
  spot, strike, optionType, iv, dte, bid, ask, mid, theta, targetPrice, closes, className,
}: {
  spot: number; strike: number; optionType: 'call' | 'put';
  iv: number; dte: number;
  bid?: number | null; ask?: number | null; mid?: number | null; theta?: number | null;
  targetPrice?: number | null;
  /** Daily closes of the underlying — enables the IV-vs-realized read. Optional. */
  closes?: number[];
  className?: string;
}) {
  const v: ContractValue = assessContract({
    spot, strike, optionType, iv, dte, bid, ask, mid, theta, closes, targetPrice, entryPrice: spot,
  });

  const verdictColor = VERDICT_COLOR[v.verdict] ?? TC.muted;

  return (
    <div className={cn('rounded-lg border border-border/50 bg-foreground/[0.02] p-3 space-y-2.5', className)}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-label font-mono uppercase tracking-widest text-muted-foreground">Contract Value</span>
        <div className="flex items-center gap-1.5">
          {v.juiced && (
            <span
              className="text-label font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ color: TC.bull, background: `color-mix(in srgb, ${TC.bull} 14%, transparent)` }}
              title="Target exceeds the priced-in move, IV isn't rich, and the spread is sane"
            >
              ⚡ Juiced
            </span>
          )}
          <span
            className="text-label font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ color: verdictColor, background: `color-mix(in srgb, ${verdictColor} 14%, transparent)` }}
          >
            {v.verdict === 'unknown' ? 'no vol ref' : v.verdict}
          </span>
        </div>
      </div>

      {/* Contract pointing the wrong way is a hard stop — say it before anything else. */}
      {v.targetOpposesContract && (
        <div
          className="rounded px-2 py-1.5 text-label font-mono"
          style={{ color: TC.bear, background: `color-mix(in srgb, ${TC.bear} 10%, transparent)` }}
        >
          Target is on the wrong side for a {optionType} — this contract profits from the opposite move.
        </div>
      )}

      <MoveComparison pricedPct={v.expectedMovePct} targetPct={v.targetOpposesContract ? null : v.targetMovePct} />

      <div className="space-y-1 pt-0.5">
        <CostBar label="Spread" pct={v.spreadPct} danger={15} />
        <CostBar label="Theta/d" pct={v.thetaBurnPct} danger={3} />
        {v.ivHvRatio != null && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-label font-mono uppercase tracking-wider text-muted-foreground w-14 shrink-0">IV/HV</span>
            <div className="h-1.5 flex-1 min-w-[30px] overflow-hidden rounded-full bg-foreground/[0.07]">
              {/* 1.0 sits at the midpoint, so "expensive" is visibly right-of-centre. */}
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, (v.ivHvRatio / 2) * 100)}%`, background: verdictColor }}
              />
            </div>
            <span className="text-label font-mono tabular-nums shrink-0 w-12 text-right" style={{ color: verdictColor }}>
              {v.ivHvRatio.toFixed(2)}×
            </span>
          </div>
        )}
      </div>

      {v.notes.length > 0 && (
        <ul className="space-y-0.5 pt-0.5">
          {v.notes.slice(0, 3).map((n, i) => (
            <li key={i} className="ui-prose text-label leading-snug text-muted-foreground">· {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
