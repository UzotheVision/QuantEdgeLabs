/**
 * ROLL ENGINE — when to move a position out rather than let it die.
 *
 * The bot had no concept of rolling. An IWM $296P was held to expiration and
 * settled worthless for a total loss of the premium, when the thesis on the
 * underlying had not actually been invalidated — it simply ran out of time. That
 * is the single most avoidable way an options account bleeds.
 *
 * Three distinct situations, and they want different answers:
 *
 *   ROLL OUT     — thesis intact, time running out. Close the near contract and
 *                  buy the same strike further out. Costs premium, buys runway.
 *   ROLL UP/OUT  — deep in the money and mostly intrinsic. Take the gain, move to
 *                  a higher strike further out: banks profit, keeps exposure, and
 *                  cuts the capital at risk.
 *   LET IT GO    — thesis broken or the roll is not worth paying for. Rolling a
 *                  losing thesis is throwing good money after bad, and it is the
 *                  most common way this feature gets misused.
 *
 * The engine will not roll a position whose underlying has moved against it. A
 * roll must be a decision about TIME, never a way to avoid admitting direction
 * was wrong.
 */
import { logger } from './logger';

export type RollAction = 'roll_out' | 'roll_up_and_out' | 'hold' | 'let_expire';

export interface RollCandidate {
  action: RollAction;
  reason: string;
  /** What the roll would cost (debit) or collect (credit), per contract. */
  netDebit: number | null;
  suggestedStrike: number | null;
  suggestedExpiry: string | null;
}

export interface RollInput {
  symbol: string;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  dte: number;
  entryPremium: number;
  currentPremium: number;
  spot: number;
  /** Underlying price when the position was opened — is the thesis still alive? */
  entrySpot: number;
}

/** Inside this many sessions, time decay dominates and a decision is forced. */
const ROLL_WINDOW_DTE = 10;
/** A roll costing more than this share of the current premium is not worth it. */
const MAX_ROLL_COST_RATIO = 0.6;
/** Intrinsic share above which a position is "mostly intrinsic" and worth rolling up. */
const DEEP_ITM_INTRINSIC = 0.8;

export function evaluateRoll(input: RollInput): RollCandidate {
  const { optionType, strike, dte, currentPremium, spot, entrySpot } = input;

  const none = (action: RollAction, reason: string): RollCandidate => ({
    action, reason, netDebit: null, suggestedStrike: null, suggestedExpiry: null,
  });

  if (dte > ROLL_WINDOW_DTE) {
    return none('hold', `${dte} DTE — still has runway, nothing to decide yet.`);
  }

  // Has the underlying moved the way the position needed?
  const move = ((spot - entrySpot) / entrySpot) * 100;
  const thesisAlive = optionType === 'call' ? move > -3 : move < 3;

  if (!thesisAlive) {
    return none(
      'let_expire',
      `Underlying moved ${move >= 0 ? '+' : ''}${move.toFixed(1)}% against a ${optionType} since entry. ` +
      `Rolling this is paying again for a call that was wrong on direction, not on time.`,
    );
  }

  const intrinsic = optionType === 'call' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);

  // Intrinsic cannot exceed the premium — an option trading below its own exercise
  // value is an arbitrage that does not survive in a live market. When the inputs
  // say otherwise the mark is stale or the spot and the quote are from different
  // moments, and acting on it would roll a position based on a price that isn't
  // real. Refuse rather than report a 125% intrinsic share.
  if (intrinsic > currentPremium * 1.02 && currentPremium > 0) {
    logger.warn(
      `[ROLL] ${input.symbol} $${strike}${optionType[0].toUpperCase()}: intrinsic $${intrinsic.toFixed(2)} ` +
      `exceeds premium $${currentPremium.toFixed(2)} — stale mark, skipping roll decision`,
    );
    return none('hold', `Mark $${currentPremium.toFixed(2)} is below intrinsic $${intrinsic.toFixed(2)} — quote looks stale, not deciding on it.`);
  }

  const extrinsic = Math.max(0, currentPremium - intrinsic);
  const intrinsicShare = currentPremium > 0 ? Math.min(1, intrinsic / currentPremium) : 0;

  // Nearly worthless and out of time: nothing to roll into that is worth paying for.
  if (currentPremium < 0.10) {
    return none('let_expire', `Premium is $${currentPremium.toFixed(2)} with ${dte} DTE — there is nothing left to salvage.`);
  }

  if (intrinsicShare >= DEEP_ITM_INTRINSIC && intrinsic > 0) {
    // Deep ITM: the position is behaving like stock and paying for optionality it
    // is no longer using. Roll up and out — bank intrinsic, re-buy leverage.
    const nextStrike = optionType === 'call'
      ? Math.round(spot * 1.05)
      : Math.round(spot * 0.95);
    return {
      action: 'roll_up_and_out',
      reason:
        `${(intrinsicShare * 100).toFixed(0)}% of the $${currentPremium.toFixed(2)} premium is intrinsic with ${dte} DTE. ` +
        `The contract is tracking the stock and paying for optionality it no longer uses. Rolling ` +
        `${optionType === 'call' ? 'up' : 'down'} and out banks the intrinsic and restores leverage on less capital.`,
      netDebit: null,
      suggestedStrike: nextStrike,
      suggestedExpiry: null,
    };
  }

  // Thesis alive, still has extrinsic value, running out of time → buy runway.
  const rollCostRatio = extrinsic / Math.max(currentPremium, 0.01);
  if (rollCostRatio > MAX_ROLL_COST_RATIO) {
    return none(
      'let_expire',
      `${(rollCostRatio * 100).toFixed(0)}% of the premium is time value with ${dte} DTE. ` +
      `A roll here mostly re-buys decay — the extension costs more than the position is worth.`,
    );
  }

  return {
    action: 'roll_out',
    reason:
      `Thesis intact (underlying ${move >= 0 ? '+' : ''}${move.toFixed(1)}% since entry) but only ${dte} DTE left. ` +
      `Rolling the same $${strike} strike further out buys time without changing the trade.`,
    netDebit: null,
    suggestedStrike: strike,
    suggestedExpiry: null,
  };
}

export function describeRoll(symbol: string, r: RollCandidate): string {
  return `[ROLL] ${symbol}: ${r.action.toUpperCase()} — ${r.reason}`;
}
