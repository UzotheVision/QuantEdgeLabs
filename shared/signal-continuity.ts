/**
 * SIGNAL CONTINUITY — a signal is a standing position, not a row per scan.
 *
 * The board regenerated every cycle, so a CRCL long published Tuesday reappeared
 * Wednesday as a brand-new signal with a new timestamp and a slightly different
 * score. Nothing was wrong with the thesis; the scanner had simply run again.
 * That does three bad things at once: it re-alerts a call you already made, it
 * throws away the only interesting information (what has happened SINCE), and it
 * makes a system that never changes its mind look like one that changes it
 * hourly.
 *
 * The accounts worth copying do the opposite. A stance is taken, it stands, it
 * gets updated as evidence accumulates, and when it flips the flip is announced
 * as a flip — "no longer bearish on BTC" only means something because the bear
 * case had been standing and public for weeks.
 *
 * So identity is keyed on what defines the THESIS, never on what merely drifts.
 * Price moves and the score wobbles; neither makes it a different trade. A
 * different strike or a different expiry does — that is a different contract.
 *
 * What the surface should say is not "CRCL long, conviction 93" every morning.
 * It is "CRCL long, standing 2 sessions, +5.5% since published, 62% of the way
 * to target, conviction 96 → 93."
 */

export type SignalStatus =
  | 'new'          // first time we have published this thesis
  | 'standing'     // unchanged and still valid
  | 'strengthened' // same thesis, evidence improved
  | 'weakened'     // same thesis, evidence decayed but not broken
  | 'invalidated'  // stop breached or the thesis premise is gone
  | 'target_hit';  // it did what it said it would

export interface SignalIdentity {
  symbol: string;
  direction: 'long' | 'short';
  optionType?: 'call' | 'put' | null;
  strikePrice?: number | null;
  expiryDate?: string | null;
}

/**
 * Stable across rescans, distinct across genuinely different trades.
 * Deliberately excludes entry price, score, and timestamp — those drift while
 * the thesis is unchanged, and keying on them is what created a new signal
 * every cycle.
 */
export function signalKey(i: SignalIdentity): string {
  const parts = [i.symbol.toUpperCase(), i.direction];
  if (i.optionType) {
    parts.push(i.optionType);
    // Strike bucketed to the cent so float noise cannot fork the key.
    if (i.strikePrice != null) parts.push(String(Math.round(i.strikePrice * 100)));
    if (i.expiryDate) parts.push(i.expiryDate.slice(0, 10));
  } else {
    parts.push('stock');
  }
  return parts.join('|');
}

export interface PriorSignal {
  key: string;
  publishedAt: string | Date;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  conviction: number;
}

export interface ContinuityUpdate {
  status: SignalStatus;
  /** Sessions since first publication. 0 = published today. */
  age: number;
  /** Underlying move since published, in percent. */
  movePct: number;
  /** How far along the entry→target path, 0-100. Negative = wrong way. */
  progressPct: number;
  convictionThen: number;
  convictionNow: number;
  /** One line for the card: what has happened since we called it. */
  sinceLine: string;
  /** True when this should re-announce. Standing signals must not re-alert. */
  shouldAlert: boolean;
}

/**
 * Compare a freshly-scored pick against the standing version of the same thesis.
 * `sessionsElapsed` is injected rather than computed so this stays pure and the
 * caller keeps ownership of the market calendar.
 */
export function reconcile(
  prior: PriorSignal | null,
  now: { conviction: number; spot: number; targetPrice: number; stopLoss: number; direction: 'long' | 'short' },
  sessionsElapsed: number,
): ContinuityUpdate {
  const long = now.direction === 'long';

  if (!prior) {
    return {
      status: 'new', age: 0, movePct: 0, progressPct: 0,
      convictionThen: now.conviction, convictionNow: now.conviction,
      sinceLine: 'Published now.',
      shouldAlert: true,
    };
  }

  const movePct = prior.entryPrice > 0
    ? ((now.spot - prior.entryPrice) / prior.entryPrice) * 100 * (long ? 1 : -1)
    : 0;

  const span = Math.abs(prior.targetPrice - prior.entryPrice);
  const travelled = long ? now.spot - prior.entryPrice : prior.entryPrice - now.spot;
  const progressPct = span > 0 ? Math.round((travelled / span) * 100) : 0;

  const stopBreached = long ? now.spot <= prior.stopLoss : now.spot >= prior.stopLoss;
  const targetReached = long ? now.spot >= prior.targetPrice : now.spot <= prior.targetPrice;

  const dConv = now.conviction - prior.conviction;

  let status: SignalStatus;
  if (targetReached) status = 'target_hit';
  else if (stopBreached) status = 'invalidated';
  else if (dConv >= 5) status = 'strengthened';
  else if (dConv <= -8) status = 'weakened';
  else status = 'standing';

  const ageLabel = sessionsElapsed <= 0 ? 'today'
    : sessionsElapsed === 1 ? 'since yesterday'
    : `standing ${sessionsElapsed} sessions`;

  const moveLabel = `${movePct >= 0 ? '+' : ''}${movePct.toFixed(1)}%`;
  const convLabel = dConv === 0 ? '' : ` · conviction ${prior.conviction} → ${now.conviction}`;

  // The terminal branches read as a verdict, so they take a plain elapsed count
  // rather than the "standing N sessions" phrasing a live signal wants.
  const heldLabel = sessionsElapsed <= 0 ? 'same session'
    : sessionsElapsed === 1 ? '1 session' : `${sessionsElapsed} sessions`;

  const sinceLine =
    status === 'target_hit' ? `Target reached — ${moveLabel} in ${heldLabel}.`
    : status === 'invalidated' ? `Stop breached, thesis done — ${moveLabel} in ${heldLabel}.`
    : progressPct >= 5 ? `${ageLabel}: ${moveLabel}, ${progressPct}% of the way to target${convLabel}.`
    : progressPct <= -5 ? `${ageLabel}: ${moveLabel}, moving away from target${convLabel}.`
    : `${ageLabel}: ${moveLabel}, still coiled${convLabel}.`;

  return {
    status, age: sessionsElapsed, movePct, progressPct,
    convictionThen: prior.conviction, convictionNow: now.conviction,
    sinceLine,
    // Re-announce only on a state CHANGE. A standing signal that merely got
    // rescored is the thing that was spamming the channel.
    shouldAlert: status === 'target_hit' || status === 'invalidated' || status === 'strengthened',
  };
}
