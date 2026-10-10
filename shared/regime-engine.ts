/**
 * REGIME ENGINE — what kind of market is this, and how should we trade it?
 *
 * The tape gate answers one question: trade today or not. That is the right
 * question and the wrong resolution. A market is not on or off; it has a
 * character, and the same setup is a different trade in each one. A breakout
 * bought in a grinding trend is a position you can hold for a week. The same
 * breakout bought in a whipsaw is a coin flip that takes your stop on the way
 * to being right.
 *
 * You cannot make the market cooperate. You can notice which market you are in
 * and stop asking it for things it is not currently handing out.
 *
 * Two axes, because these are the two that decide whether LONG PREMIUM works:
 *
 *   EFFICIENCY  Kaufman's ratio: net distance travelled divided by the total
 *               path walked to get there. 1.0 is a straight line, 0.0 is a
 *               market that ends where it started having thrashed all the way.
 *               Direction is the only thing a bought option is paid for, so a
 *               market with no net direction is a market that only charges you.
 *
 *   VOL PATH    Realized vol now against its own recent baseline. Expanding vol
 *               inflates the premium you pay and then deflates it while you
 *               hold. Contracting vol is cheap to buy but rarely delivers the
 *               move. Which way it is TRAVELLING matters more than its level.
 *
 * Crossed, they give four regimes. Each one gets a playbook — not advice, but
 * actual numbers the bot applies: how far to set targets, how long to hold, how
 * much to size, and what kind of setup to prefer. Same engine, different market,
 * different behaviour.
 *
 * The transition is the dangerous part. A regime that just changed has not
 * proven anything yet, so the playbook pulls in its horns until it holds.
 */

export type RegimeKind = 'grind' | 'momentum' | 'drift' | 'whipsaw';

export interface RegimePlaybook {
  /** Scales how far targets are set. <1 asks the market for less. */
  targetMultiplier: number;
  /** Scales position size off the normal premium budget. */
  sizeMultiplier: number;
  /** Sessions to hold before the thesis is considered stale. */
  maxHoldSessions: number;
  /** Conviction floor a setup must clear to be taken at all. */
  convictionFloor: number;
  /** Setup families that historically pay in this regime. */
  favors: string[];
  /** Setup families that historically bleed in this regime. */
  avoids: string[];
  /** Plain statement of how to behave. */
  stance: string;
}

export interface Regime {
  kind: RegimeKind;
  label: string;
  /** 0..1 — how cleanly the market is travelling. */
  efficiency: number;
  /** Realized vol as a ratio of its own baseline. >1 expanding. */
  volRatio: number;
  /** Consecutive sessions this regime has held. */
  persistence: number;
  /** True while the regime is too new to lean on. */
  transitioning: boolean;
  headline: string;
  why: string;
  playbook: RegimePlaybook;
  asOf: string;
}

/** Kaufman efficiency ratio over the last `period` closes. */
export function efficiencyRatio(closes: number[], period = 20): number {
  if (closes.length < period + 1) return NaN;
  const w = closes.slice(-(period + 1));
  const net = Math.abs(w[w.length - 1] - w[0]);
  let path = 0;
  for (let i = 1; i < w.length; i++) path += Math.abs(w[i] - w[i - 1]);
  return path === 0 ? 0 : net / path;
}

/** Annualised realized vol from daily closes. */
export function realizedVol(closes: number[], period: number): number {
  if (closes.length < period + 1) return NaN;
  const w = closes.slice(-(period + 1));
  const rets: number[] = [];
  for (let i = 1; i < w.length; i++) rets.push(Math.log(w[i] / w[i - 1]));
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const varc = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1 || 1);
  return Math.sqrt(varc) * Math.sqrt(252);
}

const PLAYBOOKS: Record<RegimeKind, RegimePlaybook> = {
  // Trend, calm vol. The one regime where a bought option gets what it paid for.
  grind: {
    targetMultiplier: 1.0,
    sizeMultiplier: 1.0,
    maxHoldSessions: 5,
    convictionFloor: 18,
    favors: ['continuation', 'pullback-to-trend', 'breakout'],
    avoids: ['fade', 'mean-reversion'],
    stance: 'Trend is paying and vol is not eating the premium. Normal targets, '
      + 'normal size, and you can afford to hold a position more than a day.',
  },
  // Trend with vol expanding. Direction works; you are overpaying for it, and
  // the vol that made it expensive leaves right after the move completes.
  momentum: {
    targetMultiplier: 1.3,
    sizeMultiplier: 0.8,
    maxHoldSessions: 3,
    convictionFloor: 22,
    favors: ['breakout', 'continuation', 'gap-and-go'],
    avoids: ['fade', 'premium-selling'],
    stance: 'Moves are bigger, so ask for more — but you are buying inflated vol. '
      + 'Take the move and leave; the IV that made it expensive exits after you.',
  },
  // Chop, calm vol. Nothing moves and theta charges you daily for waiting.
  drift: {
    targetMultiplier: 0.5,
    sizeMultiplier: 0.5,
    maxHoldSessions: 2,
    convictionFloor: 30,
    favors: ['gap-fill', 'range-fade', 'magnet-to-level'],
    avoids: ['breakout', 'continuation', 'trend-following'],
    stance: 'The market is going nowhere and charging rent. Ask for small moves, '
      + 'take them fast, size down. Most days here are best not traded at all.',
  },
  // Chop with vol expanding. Wide ranges, no destination — the range takes your
  // stop and then the market returns to where it was.
  whipsaw: {
    targetMultiplier: 0.7,
    sizeMultiplier: 0.4,
    maxHoldSessions: 1,
    convictionFloor: 34,
    favors: ['range-fade', 'reversal-from-extreme'],
    avoids: ['breakout', 'continuation', 'tight-stops'],
    stance: 'Big ranges going nowhere. Stops that look reasonable get taken on '
      + 'noise. Smallest size, same-day only, and fade extremes rather than chase.',
  },
};

const LABELS: Record<RegimeKind, string> = {
  grind: 'GRIND', momentum: 'MOMENTUM', drift: 'DRIFT', whipsaw: 'WHIPSAW',
};

/** Thresholds are deliberately not symmetric — see classifyRegime. */
export const TREND_CUTOFF = 0.35;
export const VOL_EXPANDING = 1.15;

/**
 * Classify from daily closes alone. `history` lets the caller pass the previous
 * classification so persistence and transition can be tracked across calls.
 */
export function classifyRegime(
  closes: number[],
  prior?: { kind: RegimeKind; persistence: number } | null,
): Regime | null {
  if (closes.length < 25) return null;

  const er = efficiencyRatio(closes, 20);
  const fast = realizedVol(closes, 10);
  const base = realizedVol(closes, 60 <= closes.length - 1 ? 60 : closes.length - 1);
  if (!Number.isFinite(er) || !Number.isFinite(fast) || !Number.isFinite(base) || base === 0) return null;

  const volRatio = fast / base;
  const trending = er >= TREND_CUTOFF;
  const expanding = volRatio >= VOL_EXPANDING;

  const kind: RegimeKind = trending
    ? (expanding ? 'momentum' : 'grind')
    : (expanding ? 'whipsaw' : 'drift');

  const persistence = prior && prior.kind === kind ? prior.persistence + 1 : 1;
  const transitioning = persistence <= 2;

  const playbook = { ...PLAYBOOKS[kind] };
  // A regime nobody has confirmed yet does not get full size. The first days
  // after a change are where the previous playbook is still in your head.
  if (transitioning) {
    playbook.sizeMultiplier = Math.round(playbook.sizeMultiplier * 0.6 * 100) / 100;
    playbook.convictionFloor += 4;
  }

  const why =
    `Efficiency ${er.toFixed(2)} — the index kept ${(er * 100).toFixed(0)}% of the distance it walked, `
    + `so the tape is ${trending ? 'travelling' : 'thrashing'}. `
    + `10-day realized vol is ${volRatio >= 1 ? (volRatio.toFixed(2) + '× its 60-day baseline') : ((1 / volRatio).toFixed(2) + '× below baseline')}, `
    + `so volatility is ${expanding ? 'expanding — you are paying up and it leaves after the move' : 'contained — premium is cheap but the move has to come from direction'}.`;

  const headline = transitioning
    ? `${LABELS[kind]} — just changed, not yet confirmed. Half size until it holds.`
    : `${LABELS[kind]} — held ${persistence} sessions.`;

  return {
    kind, label: LABELS[kind], efficiency: er, volRatio, persistence, transitioning,
    headline, why, playbook, asOf: new Date().toISOString(),
  };
}

/** Apply a regime playbook to a raw setup. The single place adaptation happens. */
export function adaptToRegime(
  setup: { conviction: number; targetPct: number; premiumBudget: number; family?: string },
  regime: Regime,
): {
  taken: boolean; reason: string;
  conviction: number; targetPct: number; premiumBudget: number; maxHoldSessions: number;
} {
  const p = regime.playbook;
  const fam = setup.family ?? '';

  if (setup.conviction < p.convictionFloor) {
    return {
      taken: false,
      reason: `Conviction ${setup.conviction} is under the ${p.convictionFloor} floor this regime demands (${regime.label}).`,
      conviction: setup.conviction, targetPct: setup.targetPct,
      premiumBudget: 0, maxHoldSessions: p.maxHoldSessions,
    };
  }
  if (fam && p.avoids.includes(fam)) {
    return {
      taken: false,
      reason: `${fam} setups bleed in a ${regime.label} tape — this regime pays ${p.favors.join(' / ')}.`,
      conviction: setup.conviction, targetPct: setup.targetPct,
      premiumBudget: 0, maxHoldSessions: p.maxHoldSessions,
    };
  }

  // A favoured family gets a real, bounded nudge — not a thumb on the scale.
  const bonus = fam && p.favors.includes(fam) ? 3 : 0;

  return {
    taken: true,
    reason: bonus
      ? `${fam} is what a ${regime.label} tape pays for.`
      : `Clears the ${regime.label} floor.`,
    conviction: setup.conviction + bonus,
    targetPct: Math.round(setup.targetPct * p.targetMultiplier * 100) / 100,
    premiumBudget: Math.round(setup.premiumBudget * p.sizeMultiplier),
    maxHoldSessions: p.maxHoldSessions,
  };
}
