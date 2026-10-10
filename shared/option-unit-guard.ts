/**
 * OPTION UNIT COHERENCE
 *
 * Two files disagreed about what an option idea's entryPrice/targetPrice/stopLoss
 * hold. options-enricher declares them PREMIUM ("Option premium (NOT stock
 * price)") and writes premium into them. performance-validator asserted the
 * opposite — that they are STOCK levels — and compared them against the
 * underlying's spot.
 *
 * The result was not a rounding error. For an SMCI call: entry 3.09, target
 * 4.635, stop 1.545, all premium; the validator fed it a spot of 38.42. So
 * max(3.09, 38.42) >= 4.635 fired the target and min(3.09, 38.42) never touched
 * the stop. The row was guaranteed hit_target the first time the validator saw
 * it, regardless of what SMCI actually did.
 *
 * WHY A SCALE TEST RATHER THAN A FINGERPRINT
 *
 * The obvious detector is the artifact's signature — a percentGain of exactly
 * +50.00% from targetMultiplier 1.50. That is a symptom, and symptoms change
 * when a multiplier changes. This tests the actual precondition instead: are the
 * barriers on the same scale as the series that will be compared against them?
 *
 * highestPriceReached / lowestPriceReached are always filled from the UNDERLYING
 * spot, and strikePrice is by definition on the underlying scale. So strike is a
 * reliable yardstick, and no guess about intent is required.
 *
 * THE THRESHOLD
 *
 * Measured across all 312 option rows on 2026-08-25:
 *   corrupted rows   entryPrice / strikePrice  =  0.0076 – 0.0663
 *   coherent rows    entryPrice / strikePrice  =  0.794  – 2.598
 *
 * A 12x gap. Bands of 0.20, 0.25 and 0.30 each caught 18/18 with zero false
 * positives, including across all 178 open rows. 0.40 began catching legitimate
 * deep-ITM rows (a NET idea with entry 285.77 against a 110 strike), so 0.30
 * sits comfortably inside the measured margin.
 *
 * Lower bound only. A premium can only sit BELOW its strike, so an upper bound
 * would add false positives for no measured gain.
 */

export interface OptionScaleInput {
  assetType?: string | null;
  entryPrice?: number | null;
  strikePrice?: number | null;
}

/** Below this multiple of strike, entryPrice cannot be an underlying level. */
export const OPTION_SCALE_FLOOR = 0.30;

/**
 * True when an option row's barriers are NOT on the underlying scale, and so
 * cannot be compared against underlying prices.
 *
 * Conservative by construction: anything it cannot positively identify as
 * incoherent returns false, because a false positive silently withholds a real
 * outcome while a false negative merely leaves the existing behaviour in place.
 */
export function isOptionScaleIncoherent(idea: OptionScaleInput): boolean {
  if (idea.assetType !== 'option') return false;

  const entry = idea.entryPrice;
  const strike = idea.strikePrice;
  if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) return false;
  if (typeof strike !== 'number' || !Number.isFinite(strike) || strike <= 0) return false;

  return entry < OPTION_SCALE_FLOOR * strike;
}

/** Human-readable reason, for logs and for the row's outcomeNotes. */
export function optionScaleReason(idea: OptionScaleInput): string {
  const entry = typeof idea.entryPrice === 'number' ? idea.entryPrice : NaN;
  const strike = typeof idea.strikePrice === 'number' ? idea.strikePrice : NaN;
  const ratio = Number.isFinite(entry) && Number.isFinite(strike) && strike > 0
    ? (entry / strike).toFixed(4)
    : 'n/a';
  return `entry ${entry} is ${ratio}x strike ${strike} — barriers are premium, not underlying levels; not resolvable against spot`;
}
