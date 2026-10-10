/**
 * SIZING — how much cash goes on a contract, keyed to how long it lives.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY ONE RULE WAS WRONG
 * ═══════════════════════════════════════════════════════════════════════════
 * Everything was sized by `accountSize × maxRiskPerTrade%` — on a $10,000
 * account at 2%, a flat $200 ceiling for every option the platform publishes.
 *
 * That is a RISK rule, and it is correct where the premium can genuinely go to
 * zero: a 0DTE or a weekly really can expire worthless in hours, so committing
 * ~2% is right. Applied to a 390-day Δ0.70 LEAP it is nonsense. That contract is
 * a share proxy — it moves with the underlying and it is managed on the
 * underlying's structure, not on a premium stop — so the question is "how much
 * capital do I allocate", not "how much am I willing to lose".
 *
 * Measured consequence of using the risk rule everywhere: on the LEAPS board,
 * median contract cost $4,712 against a $200 ceiling, so ZERO of 26 candidates
 * were buyable and every Risk panel read "too big for this account". The board
 * was arithmetically right and practically useless.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE LADDER
 * ═══════════════════════════════════════════════════════════════════════════
 *   ≤ 45 DTE   RISK basis        — budget = defaultOptionsBudget
 *                                  stop   = −50% premium (the engine's own)
 *   > 45 DTE   ALLOCATION basis  — budget = defaultCapitalPerIdea
 *                                  stop   = the underlying's structural stop
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO NEW SETTINGS WERE INVENTED
 * ═══════════════════════════════════════════════════════════════════════════
 * `defaultOptionsBudget` ($250) and `defaultCapitalPerIdea` ($1,000) already
 * existed in the schema, already had inputs in Settings, and were read by
 * NOTHING. Both are persisted and user-editable. Rather than add a third budget
 * field, this uses the two that were already there and finally gives them an
 * effect — which is also why the numbers land near where a trader would put
 * them by hand ($100-200 weeklies, four figures for a LEAP).
 *
 * The 45-day cut is the one judgement here. It is where the platform's own
 * option-selection engine already splits swing expiries from position expiries,
 * so the boundary is not new — it is just being applied to cash as well as to
 * strike choice.
 */

/** Above this, an option is a position to allocate to, not a trade to risk. */
export const LONG_DATED_MIN_DTE = 46;

export type SizingBasis = 'risk' | 'allocation';

export interface SizingRule {
  basis: SizingBasis;
  /** Max cash for ONE contract. */
  budget: number;
  /** Fraction of premium treated as at-risk. Null when the stop is structural. */
  premiumStopPct: number | null;
  /** Shown to the user so the number is never unexplained. */
  why: string;
}

export interface SizingPrefs {
  accountSize?: number | null;
  maxRiskPerTrade?: number | null;
  defaultOptionsBudget?: number | null;
  defaultCapitalPerIdea?: number | null;
}

export function sizingFor(dte: number | null | undefined, prefs: SizingPrefs | null | undefined): SizingRule {
  const longDated = (dte ?? 0) >= LONG_DATED_MIN_DTE;

  if (longDated) {
    const budget = Number(prefs?.defaultCapitalPerIdea ?? 0);
    return {
      basis: 'allocation',
      budget,
      // A LEAP is not managed on a premium stop, so none is asserted here. The
      // thesis invalidates on the underlying's level, which the signal already
      // carries — inventing a −50% rule for a 400-day contract would make the
      // risk figure look precise while being made up.
      premiumStopPct: null,
      why: budget > 0
        ? `Long-dated (${dte}d) — sized as an allocation against your $${budget.toLocaleString()} per-idea capital, not the per-trade risk budget.`
        : 'Long-dated — set "capital per idea" in Settings to size this.',
    };
  }

  // Short-dated: the premium really can go to zero, so the risk rule applies.
  // Prefer the explicit options budget; fall back to the account risk rule when
  // it has not been set, so this never returns zero for a configured account.
  const explicit = Number(prefs?.defaultOptionsBudget ?? 0);
  const riskRule = ((Number(prefs?.accountSize ?? 0)) * (Number(prefs?.maxRiskPerTrade ?? 0))) / 100;
  const budget = explicit > 0 ? explicit : riskRule;

  return {
    basis: 'risk',
    budget,
    premiumStopPct: 0.5,
    why: budget > 0
      ? `Short-dated (${dte ?? '—'}d) — $${budget.toLocaleString()} at risk, sized off the −50% premium stop.`
      : 'Set an options budget in Settings to size this.',
  };
}
