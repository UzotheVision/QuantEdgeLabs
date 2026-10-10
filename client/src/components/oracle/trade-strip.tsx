/**
 * TRADE STRIP — the contract you would actually buy, in the hero.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TWO PROBLEMS THIS SOLVES
 * ═══════════════════════════════════════════════════════════════════════════
 * 1 · POSITION. Measured in the cockpit's centre column:
 *
 *        hero (identity · price · chart · ladder)     0 → 1178px
 *        CONTRACT ENGINE                           1190 → 2171px
 *
 *    The engine is not bloat — it is a real decision surface carrying three
 *    fully-specified contracts across risk tiers, with greeks, liquidity and
 *    projected ROI on each. It deserves its 981px. What it did not deserve was
 *    starting 1,190px down, so the single most actionable fact on the page —
 *    what to buy — required scrolling past the entire chart block.
 *
 * 2 · DISAGREEMENT, which is the more serious one. The hero header printed the
 *    strike stored on the published idea:
 *
 *        header               "Healthcare · CALL $370"
 *        contract engine REC  "$415C · Sep 18 · 26DTE · $22.55"
 *
 *    Those are different trades. `selected.strikePrice` is what the generator
 *    chose when the idea was written; the engine re-selects live against the
 *    current chain through POST /api/options/select. The engine is the
 *    authoritative answer — and the stale one was the one above the fold.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT DOES ABOUT THE DISAGREEMENT
 * ═══════════════════════════════════════════════════════════════════════════
 * It says so. When the live pick differs from the published strike, the strip
 * names both and marks which one the levels were computed from — because the
 * published strike is not garbage, it is the basis of the thesis, the R:R and
 * every number in the Risk panel. Quietly swapping one for the other would hide
 * a real disagreement between two parts of the system; showing only the stale
 * one is what the board did before.
 *
 * This strip is a POINTER, not a replacement. It carries the four facts you need
 * to know whether to keep reading — strike, expiry, premium, ROI — and nothing
 * else. The greeks, the liquidity read, the tier comparison and the value panel
 * all stay in the engine below, which is where a decision between three
 * contracts actually gets made.
 */
import { Eyebrow, type Tone } from '@/components/templates/kit';
import { cn } from '@/lib/utils';

export interface TradeStripPick {
  tier: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  dte: number;
  entryPremium: number;
  roiAtT1Pct: number;
  openInterest: number;
  spreadPct: number;
}

export function TradeStrip({
  pick, publishedStrike, publishedType, direction, onJump, className,
}: {
  pick: TradeStripPick | null;
  /** The strike stored on the idea — what the levels and R:R were computed from. */
  publishedStrike?: number | null;
  publishedType?: string | null;
  direction: 'long' | 'short';
  /** Scrolls to the full engine. A pointer with nothing to point at is a dead end. */
  onJump?: () => void;
  className?: string;
}) {
  const tone: Tone = direction === 'long' ? 'bull' : 'bear';

  // Nothing resolved yet. Say that rather than rendering an empty frame that
  // reads as "no contract exists" — the engine is usually still in flight.
  if (!pick) {
    return (
      <div className={cn('rounded-lg border border-dashed border-border px-4 py-2.5', className)}>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Selecting contract…
        </span>
      </div>
    );
  }

  const disagrees =
    publishedStrike != null &&
    Number.isFinite(publishedStrike) &&
    Math.abs(publishedStrike - pick.strike) > 0.01;

  const thin = pick.openInterest < 500 || pick.spreadPct > 0.08;

  return (
    <div className={cn('rounded-lg border border-card-border bg-foreground/[0.02] px-4 py-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Eyebrow tone={tone}>The trade · {pick.tier}</Eyebrow>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-xl font-bold tabular-nums text-foreground">
              ${pick.strike}{pick.optionType === 'call' ? 'C' : 'P'}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {pick.expiry} · {pick.dte}DTE
            </span>
          </div>
        </div>

        <Fact label="Premium" value={`$${pick.entryPremium.toFixed(2)}`} />
        <Fact
          label="ROI at T1"
          value={`${pick.roiAtT1Pct >= 0 ? '+' : ''}${pick.roiAtT1Pct.toFixed(0)}%`}
          tone={pick.roiAtT1Pct >= 0 ? 'bull' : 'bear'}
        />
        <Fact
          label="Liquidity"
          value={thin ? 'thin' : 'ok'}
          tone={thin ? 'time' : 'bull'}
          note={`${pick.openInterest.toLocaleString()} OI · ${(pick.spreadPct * 100).toFixed(1)}% spread`}
        />

        {onJump && (
          <button
            onClick={onJump}
            className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-[color:var(--brand-cyan)]"
          >
            Compare tiers ↓
          </button>
        )}
      </div>

      {/* The disagreement, stated. Never silently reconciled. */}
      {disagrees && (
        <p className="mt-2.5 border-t border-dashed border-border pt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Published at{' '}
          <span className="text-[var(--brand-gold)]">
            ${publishedStrike}{(publishedType ?? '').toLowerCase() === 'put' ? 'P' : 'C'}
          </span>
          {' '}— that was the originally published vehicle. The underlying entry,
          stop and targets remain fixed independently of strike. For a new entry,
          the engine now prefers ${pick.strike}; it does not replace an existing position.
        </p>
      )}
    </div>
  );
}

function Fact({ label, value, tone, note }: { label: string; value: string; tone?: Tone; note?: string }) {
  const color =
    tone === 'bull' ? 'var(--trade-bullish)'
    : tone === 'bear' ? 'var(--trade-bearish)'
    : tone === 'time' ? 'var(--brand-gold)'
    : 'var(--foreground)';
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <span className="font-mono text-[13px] font-medium tabular-nums" style={{ color }}>{value}</span>
      {note && <span className="font-mono text-[9px] text-muted-foreground">{note}</span>}
    </div>
  );
}
