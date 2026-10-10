/**
 * SHORT DISCIPLINE — REVISED 2026-09-24 (operator: "if the platform isn't as
 * good long and short it's trash"). Shorts are now held to the SAME measured-
 * evidence standard as longs: no event requirement. Coherence is enforced
 * elsewhere, symmetrically (the Tape Contradiction layer subtracts from a short
 * that fights heavy buying exactly as it does from a long that fights selling).
 * Only the BTC-proxy rule survives, mirrored with the long side: don't short
 * levered-bitcoin equities while bitcoin itself is rising.
 *
 * The original two rules (kept for history):
 *
 * 1. A short needs an EVENT, not a chart. "RSI(2) overbought" and "price rejected
 *    under VWAP" are descriptions of what price already did — generateCatalyst()
 *    turns them into prose that reads like a catalyst, but nothing is actually
 *    happening to the company. A long that fails drifts; a short that fails is
 *    short a name that is being bid, which is the trade that burns you.
 *
 * 2. Crypto miners and treasury-holders are BTC proxies. MARA is not an
 *    independent equity thesis, it is levered bitcoin with a listing. Shorting
 *    one while BTC is holding up is taking the opposite side of the thing that
 *    actually drives it. Structurally these names are long-biased; a short needs
 *    BTC itself to be breaking down AND an event on top.
 *
 * This does not stop shorts. It stops shorts nobody can point at a reason for.
 */

import { logger } from './logger';

/**
 * Equities whose price is a bitcoin proxy — miners, treasury holders, and the
 * exchange. Direction on these follows BTC, not their own fundamentals.
 */
export const BTC_PROXIES = new Set([
  // Miners
  'MARA', 'RIOT', 'CLSK', 'HUT', 'IREN', 'WULF', 'CIFR', 'BITF', 'CORZ', 'BTBT',
  'HIVE', 'BTDR', 'GREE', 'SDIG', 'ARBK', 'CAN',
  // Treasury / balance-sheet proxies
  'MSTR', 'BMNR', 'SMLR',
  // Exchange / infrastructure
  'COIN', 'BKKT', 'GLXY',
  // Spot & equity ETFs that track the same beta
  'IBIT', 'FBTC', 'GBTC', 'BITO', 'BITX', 'WGMI', 'BLOK',
]);

export function isBtcProxy(symbol: string): boolean {
  return BTC_PROXIES.has(symbol.toUpperCase());
}

/**
 * How far BTC has to be breaking down before a short on one of its proxies is
 * even considered. Set to a genuine flush, not ordinary chop — these names are
 * treated as close to long-only, and a -3% BTC day was judged too loose a bar
 * for taking the other side of levered beta.
 */
const BTC_BREAKDOWN_PCT = 0;

export interface ShortDisciplineInput {
  symbol: string;
  direction: 'long' | 'short';
  /**
   * True only when a real dated event backs this trade — an earnings print, a
   * downgrade, guidance, an SEC action. A technical pattern is NOT a catalyst,
   * so callers must not pass `true` merely because `catalyst` is a non-empty
   * string: generateCatalyst() always returns one.
   */
  hasEventCatalyst: boolean;
  /** BTC's session change in percent, when known. */
  btcChangePercent?: number | null;
}

export interface ShortDisciplineResult {
  allowed: boolean;
  reason: string | null;
}

export function evaluateShortDiscipline(input: ShortDisciplineInput): ShortDisciplineResult {
  const { symbol, direction, hasEventCatalyst, btcChangePercent } = input;

  // Longs are not this module's business.
  if (direction !== 'short') return { allowed: true, reason: null };

  void hasEventCatalyst; // an event still strengthens a short via the catalyst layer; it is no longer required

  if (isBtcProxy(symbol)) {
    // Mirror of the long rule: a proxy short needs bitcoin not to be rising.
    const btcIsBreakingDown =
      typeof btcChangePercent === 'number' &&
      Number.isFinite(btcChangePercent) &&
      btcChangePercent <= BTC_BREAKDOWN_PCT;

    if (!btcIsBreakingDown) {
      const btcText =
        typeof btcChangePercent === 'number' && Number.isFinite(btcChangePercent)
          ? `BTC ${btcChangePercent >= 0 ? '+' : ''}${btcChangePercent.toFixed(1)}%`
          : 'BTC move unknown';
      return {
        allowed: false,
        reason: `${symbol} is a BTC proxy and ${btcText} — no proxy shorts while bitcoin is rising`,
      };
    }
  }

  return { allowed: true, reason: null };
}

/** Convenience wrapper that logs the rejection in the generator's voice. */
export function passesShortDiscipline(input: ShortDisciplineInput): boolean {
  const verdict = evaluateShortDiscipline(input);
  if (!verdict.allowed) {
    logger.info(`  🚫 ${input.symbol}: ${verdict.reason}`);
  }
  return verdict.allowed;
}

/**
 * What counts as the EVENT a short requires. The catalysts table holds every
 * ticker-tagged news row, including multi-ticker roundups and opinion pieces —
 * measured live: META carried a Constellation Energy guidance piece as its
 * "catalyst". A mention is not an event. classifyImpact() already grades rows
 * (high = earnings/FDA/M&A/guidance on the actual name, not a roundup), so the
 * gate delegates to that grade instead of re-deriving it.
 */
export function isSubstantiveEventCatalyst(row: { impact?: string | null }): boolean {
  return row.impact === 'high';
}
