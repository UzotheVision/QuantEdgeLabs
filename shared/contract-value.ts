/**
 * CONTRACT VALUE — is this option cheap, fair, or rich for the move we expect?
 *
 * A signal tells you WHERE price is going. It says nothing about whether the
 * contract expressing that view is worth what it costs. Those are separate
 * questions and the platform has only ever answered the first one: we'd publish
 * "NVDA long, target $210" and pick a strike without ever asking whether the
 * option market had already priced that move in. If it has, you're paying full
 * freight for a move you predicted — the thesis can be right and the trade still
 * lose to theta and spread.
 *
 * The core comparison is one line:
 *
 *     move the option is PRICED for   vs   move our SIGNAL expects
 *
 * Options are priced off implied volatility. Over `dte` days, the market is
 * paying for a ±1σ move of roughly:
 *
 *     expectedMove = spot × IV × √(dte / 365)
 *
 * If our target implies a LARGER move than that, the market is underwriting our
 * thesis cheaply — the contract has "juice". If our target is well inside the
 * priced-in move, we're buying a move the market already expects, and the edge
 * has to come from somewhere other than direction.
 *
 * Two supporting reads:
 *   • IV vs realized vol — is this contract's vol expensive against how much the
 *     stock has ACTUALLY been moving? IV/HV < ~0.85 = structurally cheap premium.
 *   • Spread and theta — the two costs that quietly eat a correct thesis. A 20%
 *     bid/ask means you start 10% down and need the move just to break even.
 *
 * NOT advice, and deliberately not a "buy this" score: it's the cost side of a
 * trade the user still decides. Every verdict states its own assumption.
 */

/** Annualized close-to-close realized volatility, as a decimal (0.42 = 42%). */
export function realizedVol(closes: number[], window = 20): number | null {
  const px = closes.filter((c) => Number.isFinite(c) && c > 0);
  if (px.length < window + 1) return null;
  const recent = px.slice(-(window + 1));
  const rets: number[] = [];
  for (let i = 1; i < recent.length; i++) rets.push(Math.log(recent[i] / recent[i - 1]));
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  // Sample stdev (n-1): with a 20-day window the population form is biased low,
  // which would make every contract look expensive relative to realized.
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

export type ValueVerdict = 'cheap' | 'fair' | 'rich' | 'unknown';

export interface ContractValue {
  /** ±1σ move the option is priced for, in dollars and percent. */
  expectedMove: number;
  expectedMovePct: number;
  /** The move our signal is actually targeting, in percent. */
  targetMovePct: number | null;
  /**
   * targetMove ÷ expectedMove. >1 means we expect more than the market pays for.
   * This is the number that decides whether the contract is "juiced".
   */
  moveRatio: number | null;
  iv: number;
  hv: number | null;
  ivHvRatio: number | null;
  /** Round-trip execution cost as % of mid. 10% here = 10% down on entry. */
  spreadPct: number | null;
  /** Daily theta as % of premium — the clock's rent. */
  thetaBurnPct: number | null;
  /** % move in the underlying needed just to cover spread + theta to expiry. */
  breakevenMovePct: number | null;
  /** Target points the opposite way from what this contract needs. Hard stop. */
  targetOpposesContract: boolean;
  verdict: ValueVerdict;
  /** True when the signal's target exceeds what's priced in AND costs are sane. */
  juiced: boolean;
  /** Plain-language reasons, most important first. */
  notes: string[];
}

export interface ContractValueInput {
  spot: number;
  strike: number;
  optionType: 'call' | 'put';
  /** Implied vol as a decimal (0.45) or percent (45) — both accepted. */
  iv: number;
  dte: number;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  theta?: number | null;
  /** Recent daily closes of the UNDERLYING, for realized vol. */
  closes?: number[];
  /** The signal's price target, so we can compare expected vs priced-in move. */
  targetPrice?: number | null;
  entryPrice?: number | null;
}

export function assessContract(input: ContractValueInput): ContractValue {
  const notes: string[] = [];
  const { spot, dte, optionType } = input;

  // CBOE publishes IV as a decimal, some feeds as percent. Anything above 5 is
  // certainly a percentage (a 500% IV decimal doesn't exist in a listed name).
  const iv = input.iv > 5 ? input.iv / 100 : input.iv;

  const yearsToExp = Math.max(dte, 0) / 365;
  const expectedMove = spot * iv * Math.sqrt(yearsToExp);
  const expectedMovePct = spot > 0 ? (expectedMove / spot) * 100 : 0;

  // How far our own signal says price is going.
  const ref = input.entryPrice ?? spot;
  let targetMovePct: number | null = null;
  let targetOpposesContract = false;
  if (input.targetPrice && ref > 0) {
    // SIGNED, then checked against the contract's direction. Taking |target - ref|
    // would score a $196 target on a CALL (spot $216) as a healthy 9.6% "move" when
    // it's actually a 9.6% move the WRONG WAY — the contract expires worthless on
    // exactly the path the target describes. Direction has to gate the magnitude.
    const signed = ((input.targetPrice - ref) / ref) * 100;
    const favourable = optionType === 'call' ? signed > 0 : signed < 0;
    targetOpposesContract = !favourable;
    targetMovePct = favourable ? Math.abs(signed) : 0;
  }
  const moveRatio = targetMovePct != null && expectedMovePct > 0 ? targetMovePct / expectedMovePct : null;

  // Realized vol for the vol-vs-vol read.
  const hv = input.closes ? realizedVol(input.closes) : null;
  const ivHvRatio = hv && hv > 0 ? iv / hv : null;

  // Execution costs.
  const bid = input.bid ?? 0;
  const ask = input.ask ?? 0;
  const mid = input.mid ?? (bid > 0 && ask > 0 ? (bid + ask) / 2 : 0);
  const spreadPct = mid > 0 && ask > bid ? ((ask - bid) / mid) * 100 : null;

  const theta = input.theta != null ? Math.abs(input.theta) : null;
  const thetaBurnPct = theta != null && mid > 0 ? (theta / mid) * 100 : null;

  // What the underlying must do just to cover costs. Half the spread is the entry
  // slip; theta to expiry is the rent. Converted to an underlying move via the
  // option's sensitivity, approximated by expectedMove per unit of premium.
  let breakevenMovePct: number | null = null;
  if (spreadPct != null && mid > 0 && spot > 0) {
    const slipDollars = (ask - bid) / 2;
    const costDollars = slipDollars + (theta != null ? theta * Math.min(dte, 30) : 0);
    // Premium moves roughly with delta; without a reliable delta here, use the
    // ratio of premium to expected move as a crude sensitivity proxy.
    const sensitivity = expectedMove > 0 ? mid / expectedMove : 0;
    if (sensitivity > 0) breakevenMovePct = ((costDollars / sensitivity) / spot) * 100;
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  let verdict: ValueVerdict = 'unknown';
  if (ivHvRatio != null) {
    if (ivHvRatio < 0.85) {
      verdict = 'cheap';
      notes.push(`IV ${(iv * 100).toFixed(0)}% is below realized ${(hv! * 100).toFixed(0)}% — premium is cheap vs how this actually moves`);
    } else if (ivHvRatio > 1.25) {
      verdict = 'rich';
      notes.push(`IV ${(iv * 100).toFixed(0)}% is well above realized ${(hv! * 100).toFixed(0)}% — you're paying a vol premium`);
    } else {
      verdict = 'fair';
      notes.push(`IV ${(iv * 100).toFixed(0)}% is in line with realized ${(hv! * 100).toFixed(0)}%`);
    }
  } else {
    notes.push('No realized-vol comparison available (not enough price history)');
  }

  if (targetOpposesContract) {
    notes.push(
      `Target $${input.targetPrice!.toFixed(2)} is on the WRONG SIDE for a ${optionType} from $${ref.toFixed(2)} — this contract profits from the opposite move`,
    );
  }

  if (moveRatio != null && !targetOpposesContract) {
    if (moveRatio > 1.15) {
      notes.push(`Target implies a ${targetMovePct!.toFixed(1)}% move vs ${expectedMovePct.toFixed(1)}% priced in — the market is underwriting this cheaply`);
    } else if (moveRatio < 0.85) {
      notes.push(`Target is only ${targetMovePct!.toFixed(1)}% vs ${expectedMovePct.toFixed(1)}% already priced in — the move is largely in the premium`);
    } else {
      notes.push(`Target ${targetMovePct!.toFixed(1)}% ≈ the ${expectedMovePct.toFixed(1)}% priced in — no vol edge either way`);
    }
  }

  if (spreadPct != null && spreadPct > 15) {
    notes.push(`Wide ${spreadPct.toFixed(0)}% spread — you start roughly ${(spreadPct / 2).toFixed(0)}% down on entry`);
  }
  if (thetaBurnPct != null && thetaBurnPct > 3) {
    notes.push(`Theta burns ${thetaBurnPct.toFixed(1)}%/day — this needs to work quickly`);
  }
  if (dte <= 7) {
    notes.push(`${dte}DTE — gamma cuts both ways and there's no time to be wrong`);
  }

  // "Juiced" = our thesis asks for more than the market has priced, the premium
  // isn't structurally expensive, and the costs won't eat the move. All three,
  // because any one alone is a trap: a cheap contract with a 30% spread is not cheap.
  const juiced =
    !targetOpposesContract &&
    moveRatio != null && moveRatio > 1.15 &&
    verdict !== 'rich' &&
    (spreadPct == null || spreadPct <= 15);

  return {
    expectedMove, expectedMovePct, targetMovePct, moveRatio,
    iv, hv, ivHvRatio, spreadPct, thetaBurnPct, breakevenMovePct,
    targetOpposesContract, verdict, juiced, notes,
  };
}
