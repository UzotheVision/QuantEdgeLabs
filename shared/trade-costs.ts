/**
 * TRADE COSTS — what the round trip actually takes out.
 *
 * Nothing in this codebase modelled commission or slippage. Every performance
 * number it has ever produced was GROSS, and for an options book that is not a
 * small correction: the measured gross edge on 340 option ideas is +10.6% per
 * idea, and the round-trip cost on the premium range the bot actually trades is
 * the same order of magnitude. Whether this platform has an edge or not is
 * decided almost entirely by a number nobody was subtracting.
 *
 * The spread curve below is MEASURED, not assumed. 21,051 live contracts with
 * open interest of at least 10, across eight names spanning SPY down to the
 * small-account tier, bucketed by premium:
 *
 *     $0.05-0.25   20.0%      $1.00-2.50    4.0%
 *     $0.25-0.50    9.8%      $2.50-5.00    2.9%
 *     $0.50-1.00    5.5%      $5.00+        3.1%
 *
 * Read that against the bot's own $0.05-$1.00 premium band and the problem is
 * immediate: the cheap contracts that make 100% moves possible are the ones
 * where a fifth of the premium is gone the moment you round-trip it. "Lotto
 * plays" are not cheap; they are the most expensive contracts on the board per
 * dollar deployed.
 *
 * Two honest caveats, both stated rather than buried:
 *
 *   The sample was taken with the market CLOSED, so these are wider than what
 *   fills at midday. They are an upper bound. RTH_DISCOUNT scales them to a
 *   regular-hours estimate, and both numbers should be reported — a range you
 *   can defend beats a point estimate you cannot.
 *
 *   Crossing the full spread assumes market orders. A patient limit inside the
 *   spread does better, and a signal system that fires on a move often does
 *   worse. Full-spread is the honest default for anything automated.
 */

export interface CostModel {
  /** Per contract, per side. Zero for the commission-free brokers. */
  commissionPerContract: number;
  /** Fraction of the measured (closed-market) spread to assume during RTH. */
  rthDiscount: number;
  /** Extra adverse fill beyond the quoted spread, as a fraction of premium. */
  slippageFrac: number;
}

export const DEFAULT_COSTS: CostModel = {
  commissionPerContract: 0.65,
  rthDiscount: 0.6,
  slippageFrac: 0.0,
};

/** Commission-free retail, which is what a small account is realistically on. */
export const ZERO_COMMISSION: CostModel = {
  commissionPerContract: 0,
  rthDiscount: 0.6,
  slippageFrac: 0.0,
};

/** Measured median bid-ask as a percent of mid, by premium band. */
const SPREAD_CURVE: Array<{ upTo: number; medianPct: number }> = [
  { upTo: 0.25, medianPct: 20.0 },
  { upTo: 0.50, medianPct: 9.8 },
  { upTo: 1.00, medianPct: 5.5 },
  { upTo: 2.50, medianPct: 4.0 },
  { upTo: 5.00, medianPct: 2.9 },
  { upTo: Infinity, medianPct: 3.1 },
];

/** Expected full bid-ask spread, as a percent of premium, at this price level. */
export function expectedSpreadPct(premium: number, rthDiscount = 1): number {
  const band = SPREAD_CURVE.find((b) => premium <= b.upTo) ?? SPREAD_CURVE[SPREAD_CURVE.length - 1];
  return band.medianPct * rthDiscount;
}

export interface RoundTripCost {
  /** Total cost as a percent of premium paid. */
  totalPct: number;
  spreadPct: number;
  commissionPct: number;
  slippagePct: number;
  detail: string;
}

/**
 * Round-trip cost of one option position, as a percent of the premium paid.
 * Buying the ask and selling the bid costs the WHOLE spread, not half of it.
 */
export function roundTripCost(
  entryPremium: number,
  contracts = 1,
  model: CostModel = DEFAULT_COSTS,
): RoundTripCost {
  const prem = Math.max(0.01, entryPremium);
  const spreadPct = expectedSpreadPct(prem, model.rthDiscount);

  // Commission is per contract per side, against premium x 100 per contract.
  const commissionPct = prem > 0
    ? ((model.commissionPerContract * 2) / (prem * 100)) * 100
    : 0;

  const slippagePct = model.slippageFrac * 100 * 2;
  const totalPct = spreadPct + commissionPct + slippagePct;

  return {
    totalPct: Math.round(totalPct * 10) / 10,
    spreadPct: Math.round(spreadPct * 10) / 10,
    commissionPct: Math.round(commissionPct * 10) / 10,
    slippagePct: Math.round(slippagePct * 10) / 10,
    detail: `$${prem.toFixed(2)} premium: ${spreadPct.toFixed(1)}% spread`
      + (commissionPct > 0.05 ? ` + ${commissionPct.toFixed(1)}% commission` : '')
      + ` = ${totalPct.toFixed(1)}% of premium, round trip.`,
  };
}

/** Gross percent return minus the round trip it took to get it. */
export function netReturnPct(
  grossPct: number,
  entryPremium: number,
  model: CostModel = DEFAULT_COSTS,
): number {
  return grossPct - roundTripCost(entryPremium, 1, model).totalPct;
}

/**
 * The gross return a position must clear before it has paid for itself. Worth
 * showing on a signal card: a $0.20 contract needs a double-digit move just to
 * break even, which is not obvious from anything else on the screen.
 */
export function breakevenGrossPct(entryPremium: number, model: CostModel = DEFAULT_COSTS): number {
  return roundTripCost(entryPremium, 1, model).totalPct;
}
