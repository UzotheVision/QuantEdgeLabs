/**
 * HORIZON TIERS — how long is this trade supposed to take, and does the target
 * agree with the answer?
 *
 * The platform had one horizon: whatever the scanner produced, resolved within
 * a few days. Everything inherited that, and the measured results showed what it
 * costs. The B band asked for a 1.8% move with a 1.2% stop and was billed as a
 * multi-day setup — but 1.8% is inside a single day's range for a 55%-IV name,
 * so the "target" was noise and the stop was noise, and which one printed first
 * was a coin flip charged at option prices. The S band had the opposite fault:
 * it asked for 14.1%, a genuine multi-week move, and then resolved it on a
 * horizon too short to deliver one, so 80% of those signals expired unresolved.
 *
 * Both failures are the same failure. The target distance and the time allowed
 * were set independently, and nothing ever checked that they agreed.
 *
 * The fix is to make the horizon an explicit, declared property of the thesis,
 * with a target expressed in units the horizon can actually produce. Volatility
 * is that unit: over T sessions a name travels roughly sigma * sqrt(T). Ask for
 * less and you are trading noise; ask for much more and you are hoping.
 *
 * Invalidation scales with horizon too. An intraday trade can use an intraday
 * stop. A six-month thesis cannot — it has to be invalidated on a CLOSE, or the
 * ordinary range takes you out of a position that was going to work.
 */

export type HorizonTier = 'intraday' | 'swing' | 'position' | 'thesis';

export interface HorizonSpec {
  tier: HorizonTier;
  label: string;
  minSessions: number;
  maxSessions: number;
  /** Target distance in sigma-of-horizon. ~1.0 is an honest ask. */
  targetSigma: number;
  /** Stop distance in sigma-of-horizon. */
  stopSigma: number;
  /** Intraday touch, or end-of-day close? */
  invalidation: 'touch' | 'close';
  /** Minimum DTE so theta is not the dominant term. */
  minDte: number;
  /** Does scaling in make sense over this horizon? */
  ladder: boolean;
  rationale: string;
}

export const HORIZONS: Record<HorizonTier, HorizonSpec> = {
  intraday: {
    tier: 'intraday', label: 'Intraday', minSessions: 0, maxSessions: 1,
    targetSigma: 0.8, stopSigma: 0.5, invalidation: 'touch', minDte: 2, ladder: false,
    rationale: 'One session. A touch stop is honest here because there is no time '
      + 'for noise to mean-revert, and theta is the dominant cost, so DTE must not be 0-1.',
  },
  swing: {
    tier: 'swing', label: 'Swing', minSessions: 2, maxSessions: 10,
    targetSigma: 1.0, stopSigma: 0.7, invalidation: 'close', minDte: 14, ladder: false,
    rationale: 'Days to two weeks. Already too long for an intraday stop — the range '
      + 'will take it — so invalidation moves to the close.',
  },
  position: {
    tier: 'position', label: 'Position', minSessions: 11, maxSessions: 45,
    targetSigma: 1.2, stopSigma: 0.9, invalidation: 'close', minDte: 45, ladder: true,
    rationale: 'Weeks. Long enough that scaling in beats picking one price, and long '
      + 'enough that a 45-DTE floor keeps theta from outrunning the thesis.',
  },
  thesis: {
    tier: 'thesis', label: 'Thesis', minSessions: 46, maxSessions: 260,
    targetSigma: 1.5, stopSigma: 1.2, invalidation: 'close', minDte: 120, ladder: true,
    rationale: 'Months. This is where laddered entry and multi-target ladders belong, '
      + 'and where a target far outside one sigma is legitimate rather than hopeful.',
  },
};

export function tierForSessions(sessions: number): HorizonSpec {
  for (const spec of Object.values(HORIZONS)) {
    if (sessions >= spec.minSessions && sessions <= spec.maxSessions) return spec;
  }
  return HORIZONS.thesis;
}

/** Sigma over a horizon of `sessions`, from annualised vol. */
export function horizonSigma(annualIv: number, sessions: number): number {
  return annualIv * Math.sqrt(Math.max(1, sessions) / 252);
}

export interface CoherenceCheck {
  coherent: boolean;
  /** Requested move expressed in sigma-of-horizon. */
  askedSigma: number;
  expectedSigma: number;
  verdict: 'noise' | 'honest' | 'hopeful';
  message: string;
  /** Target distance this horizon can actually produce, in percent. */
  suggestedTargetPct: number;
  suggestedStopPct: number;
}

/**
 * Does the target agree with the time allowed? This is the check that was
 * missing, and it catches both observed failure modes.
 */
export function checkCoherence(
  targetPct: number,
  stopPct: number,
  annualIv: number,
  sessions: number,
): CoherenceCheck {
  const spec = tierForSessions(sessions);
  const sigma = horizonSigma(annualIv, sessions) * 100;
  const askedSigma = sigma > 0 ? targetPct / sigma : 0;

  const verdict: CoherenceCheck['verdict'] =
    askedSigma < 0.5 ? 'noise' : askedSigma > 2.2 ? 'hopeful' : 'honest';

  const message =
    verdict === 'noise'
      ? `A ${targetPct.toFixed(1)}% target is ${askedSigma.toFixed(2)}σ over ${sessions} session(s) — `
        + `inside the ordinary range. It will print often and mean nothing, and the option expressing it `
        + `costs more than the move is worth.`
      : verdict === 'hopeful'
        ? `A ${targetPct.toFixed(1)}% target is ${askedSigma.toFixed(2)}σ over ${sessions} session(s) — `
          + `this needs a ${spec.tier === 'thesis' ? 'longer' : 'much longer'} horizon than it has been given, `
          + `which is why setups like it expire unresolved.`
        : `${targetPct.toFixed(1)}% over ${sessions} session(s) is ${askedSigma.toFixed(2)}σ — a move this `
          + `horizon can actually produce.`;

  return {
    coherent: verdict === 'honest',
    askedSigma: Math.round(askedSigma * 100) / 100,
    expectedSigma: Math.round(sigma * 100) / 100,
    verdict, message,
    suggestedTargetPct: Math.round(sigma * spec.targetSigma * 100) / 100,
    suggestedStopPct: Math.round(sigma * spec.stopSigma * 100) / 100,
  };
}
