/**
 * BARRIER RESOLUTION — did this idea hit its target or its stop, and which first?
 *
 * This is the single most consequential function on the platform, because every
 * other number is computed downstream of its answer. It was previously spread
 * across the validator with two asymmetries in it, both flattering:
 *
 *   1. TARGET WAS CHECKED FIRST. If price touched both barriers over the life of
 *      the idea, target won by evaluation order alone. Whichever came first in
 *      time, the record said target.
 *
 *   2. STOPS BELOW A MAGNITUDE THRESHOLD WERE ERASED. A touched stop worth less
 *      than MIN_LOSS_PERCENT was rewritten to breakeven. No equivalent threshold
 *      existed on the target side — a target grazed by a cent scored a full win
 *      at 100% "prediction accuracy".
 *
 * The second one is the more damaging, and it is measurable: the B band places
 * its stops 1.2% from entry against a 3% erasure threshold, so EVERY B-band
 * stop-out was deleted. The band's 47-target / 1-stop record was not a hit rate.
 * It was a filter applied to one side of the ledger.
 *
 * The rules here are deliberately boring and symmetric:
 *
 *   - A touched barrier is a touched barrier. No magnitude threshold on either
 *     side. The barrier levels ARE the thesis; if they are too tight to be
 *     meaningful, the fix is to place them further out, not to un-count them.
 *   - When both were touched, order is decided from the bar sequence.
 *   - When order cannot be established — no bars, or both inside one bar — the
 *     STOP wins. A stop and a target inside the same bar is the ambiguous case,
 *     and the ambiguous case must not resolve in our own favour.
 *
 * `direction` is normalised to the UNDERLYING: a long put is 'short' here,
 * because its thesis wins when the stock falls.
 */

export type BarrierOutcome = 'hit_target' | 'hit_stop' | 'open';

export interface Bar { high: number; low: number }

export interface BarrierInput {
  direction: 'long' | 'short';
  target: number;
  stop: number;
  /** Running extremes over the life of the idea. */
  highest: number;
  lowest: number;
  /** Ordered bars if available, so first-touch can actually be established. */
  bars?: Bar[];
}

export interface BarrierResult {
  outcome: BarrierOutcome;
  /** True when both barriers were touched and order could not be established. */
  ambiguous: boolean;
  /** Auditable statement of why this resolved the way it did. */
  note: string;
}

function touchedTarget(d: 'long' | 'short', hi: number, lo: number, target: number): boolean {
  return d === 'long' ? hi >= target : lo <= target;
}
function touchedStop(d: 'long' | 'short', hi: number, lo: number, stop: number): boolean {
  return d === 'long' ? lo <= stop : hi >= stop;
}

export function resolveBarriers(i: BarrierInput): BarrierResult {
  const { direction: d, target, stop, highest, lowest, bars } = i;

  const tgt = touchedTarget(d, highest, lowest, target);
  const stp = touchedStop(d, highest, lowest, stop);

  if (!tgt && !stp) {
    return { outcome: 'open', ambiguous: false, note: 'Neither barrier touched.' };
  }
  if (tgt && !stp) {
    return { outcome: 'hit_target', ambiguous: false, note: 'Target touched, stop never was.' };
  }
  if (stp && !tgt) {
    return { outcome: 'hit_stop', ambiguous: false, note: 'Stop touched, target never was.' };
  }

  // Both touched. Order decides, and only the bar sequence can establish it.
  if (bars?.length) {
    for (let n = 0; n < bars.length; n++) {
      const b = bars[n];
      const t = touchedTarget(d, b.high, b.low, target);
      const s = touchedStop(d, b.high, b.low, stop);
      if (t && s) {
        return {
          outcome: 'hit_stop', ambiguous: true,
          note: `Both barriers inside bar ${n + 1}; intrabar order unknown, so the stop takes it.`,
        };
      }
      if (t) return { outcome: 'hit_target', ambiguous: false, note: `Target reached first, on bar ${n + 1}.` };
      if (s) return { outcome: 'hit_stop', ambiguous: false, note: `Stop reached first, on bar ${n + 1}.` };
    }
  }

  return {
    outcome: 'hit_stop', ambiguous: true,
    note: 'Both barriers touched and no bar sequence available to order them; the stop takes it.',
  };
}
