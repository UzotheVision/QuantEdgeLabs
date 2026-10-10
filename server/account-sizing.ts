/**
 * ACCOUNT-AWARE POSITION SIZING
 * =============================
 * Turns "here is a contract" into "here is what YOU can take, and what it
 * costs you if it fails".
 *
 * The Contract Engine already picks conservative / balanced / aggressive
 * strikes, but it prices them for an abstract account. On a $1,000 account a
 * single $15.13 contract is $1,513 of premium — 151% of the account — and the
 * board presented it identically to a $2 contract. The tier that is "correct"
 * on structure can be unbuyable in practice, and nothing said so.
 *
 * TWO CONSTRAINTS, BOTH REAL
 *   affordability — total premium must fit the account at all
 *   risk budget   — the loss if the stop hits must fit riskPerTradePct
 *
 * The binding one is almost always risk, not affordability. That distinction
 * matters: an account can afford a position it has no business taking.
 *
 * STOP BASIS FOR OPTIONS
 * A long option's realistic worst case is not the underlying stop — it is the
 * premium lost when the thesis fails. Sizing off the underlying stop distance
 * understates risk badly on a low-delta contract, because the option can lose
 * far more percentage than the stock does. Premium-stop is the honest basis and
 * is what this uses; the underlying stop is reported alongside for context.
 */

export interface SizingInput {
  accountSize: number;
  /** Percent of the account risked on one trade. 1-2% is the common range. */
  riskPerTradePct: number;
  /** Option premium per share (contract cost = premium x 100). */
  premium: number;
  /** Fraction of premium given up if the thesis fails. 0.5 = a -50% stop. */
  premiumStopPct?: number;
  /** Underlying levels, for context and for the stock case. */
  entryPrice?: number;
  stopLoss?: number;
  targetPrice?: number;
  contractMultiplier?: number;
}

export interface SizingResult {
  contracts: number;
  costPerContract: number;
  totalCost: number;
  riskPerContract: number;
  totalRisk: number;
  pctOfAccount: number;
  pctOfAccountAtRisk: number;
  /** Which constraint decided the count. */
  bindingConstraint: 'risk' | 'affordability' | 'none';
  affordable: boolean;
  /** Plain-language reason the operator can act on. */
  verdict: string;
  maxRewardAtTarget: number | null;
}

export function sizePosition(input: SizingInput): SizingResult {
  const mult = input.contractMultiplier ?? 100;
  const stopPct = input.premiumStopPct ?? 0.5;
  const costPerContract = input.premium * mult;
  const riskPerContract = costPerContract * stopPct;
  const riskBudget = input.accountSize * (input.riskPerTradePct / 100);

  // How many contracts each constraint allows, independently.
  const byRisk = riskPerContract > 0 ? Math.floor(riskBudget / riskPerContract) : 0;
  const byCash = costPerContract > 0 ? Math.floor(input.accountSize / costPerContract) : 0;
  const contracts = Math.max(0, Math.min(byRisk, byCash));

  const totalCost = contracts * costPerContract;
  const totalRisk = contracts * riskPerContract;

  let bindingConstraint: SizingResult['bindingConstraint'] = 'none';
  if (contracts > 0) bindingConstraint = byRisk <= byCash ? 'risk' : 'affordability';

  // Reward if the underlying reaches target, approximated by intrinsic at T1.
  // Deliberately conservative: it ignores remaining time value, so the real
  // number is usually better. Overstating upside is the more expensive error.
  let maxRewardAtTarget: number | null = null;
  if (input.targetPrice != null && input.entryPrice != null && input.entryPrice > 0 && contracts > 0) {
    const movePct = (input.targetPrice - input.entryPrice) / input.entryPrice;
    // A rough delta-1 proxy on premium; real payoff depends on the strike.
    maxRewardAtTarget = totalCost * Math.max(0, movePct * 3);
  }

  let verdict: string;
  if (contracts === 0) {
    if (byCash === 0) {
      verdict =
        `Not affordable — one contract costs $${costPerContract.toFixed(0)} against a ` +
        `$${input.accountSize.toFixed(0)} account. Needs a cheaper strike or further expiry.`;
    } else {
      verdict =
        `Affordable but over budget — one contract risks $${riskPerContract.toFixed(0)} ` +
        `at a -${(stopPct * 100).toFixed(0)}% premium stop, above the ` +
        `$${riskBudget.toFixed(0)} limit (${input.riskPerTradePct}% of account). ` +
        `Raise the risk cap or take a cheaper contract.`;
    }
  } else {
    verdict =
      `${contracts} contract${contracts === 1 ? '' : 's'} — $${totalCost.toFixed(0)} committed ` +
      `(${((totalCost / input.accountSize) * 100).toFixed(0)}% of account), ` +
      `$${totalRisk.toFixed(0)} at risk (${((totalRisk / input.accountSize) * 100).toFixed(1)}%). ` +
      `Limited by ${bindingConstraint === 'risk' ? 'the risk budget' : 'account size'}.`;
  }

  return {
    contracts,
    costPerContract,
    totalCost,
    riskPerContract,
    totalRisk,
    pctOfAccount: input.accountSize > 0 ? (totalCost / input.accountSize) * 100 : 0,
    pctOfAccountAtRisk: input.accountSize > 0 ? (totalRisk / input.accountSize) * 100 : 0,
    bindingConstraint,
    affordable: byCash > 0,
    verdict,
    maxRewardAtTarget,
  };
}

/**
 * Pick the tier an account can actually trade.
 *
 * Returns every tier annotated with its sizing, plus which one is recommended:
 * the most structurally sound tier that yields at least one contract inside the
 * risk budget. If none do, the cheapest is returned flagged as unaffordable —
 * never silently omitted, because "no recommendation" reads as "no setup".
 */
export function recommendTierForAccount<T extends { name: string; premium: number; score?: number }>(
  tiers: T[],
  account: Omit<SizingInput, 'premium'>,
): { tier: T; sizing: SizingResult; recommended: boolean }[] {
  const rows = tiers.map((t) => ({
    tier: t,
    sizing: sizePosition({ ...account, premium: t.premium }),
    recommended: false,
  }));

  // Preference order is the order given (conservative → aggressive), so the
  // first tradeable tier wins rather than the cheapest.
  const first = rows.find((r) => r.sizing.contracts > 0);
  if (first) first.recommended = true;
  else {
    const cheapest = rows.reduce((a, b) => (b.sizing.costPerContract < a.sizing.costPerContract ? b : a), rows[0]);
    if (cheapest) cheapest.recommended = true;
  }
  return rows;
}
