/**
 * SIGNAL GEOMETRY — the engineering layer behind the Oracle page.
 *
 * Every number the signal view shows is derived here, once, from the pick the engine
 * already produces. Pure functions: same input → same output, no fetching, no display.
 *
 * What it computes (each maps to something the desk actually reads):
 *   • R-multiples — risk = |entry − stop|; every level expressed as R away from live.
 *   • T2 — only when the publisher has supplied a second structural level. A
 *     second target cannot be manufactured from T1's R multiple.
 *   • Progress — how far live has travelled entry → T1 (direction-aware).
 *   • Pace / horizon — how much of the holding window is spent vs progress made. A trade
 *     that's 20% to target with 80% of its time gone is failing even while "green".
 *   • Status — PENDING TRIGGER before entry fills, IN PLAY, AT TARGET, NEAR STOP.
 *   • Profit-taking plan — the next evidenced structural target, without a
 *     fabricated extension.
 *   • Components — VALIDITY / PROGRESS / PACE / OVERLAY, the four sub-scores.
 */

export interface GeomInput {
  direction: 'long' | 'short';
  entryPrice: number;
  targetPrice: number;      // T1
  stopLoss: number;
  live: number;
  riskRewardRatio?: number | null;
  holdingPeriod?: string | null;
  /** Contract time remaining when the signal was published. */
  optionDte?: number | null;
  /** Absolute expiry lets the UI recompute time remaining after publication. */
  expiryDate?: string | null;
  generatedAt?: string | null;
  convictionScore?: number | null;
  /** Derived from the signal's execution ledger, never inferred from spot. */
  lifecycleState?: 'coverage' | 'thesis' | 'pending_trigger' | 'triggered' | 'executed' | 'closed';
  /** Peak favourable price seen since entry, when the backend has tracked it. */
  extremePrice?: number | null;
}

export type SignalStatus = 'pending_trigger' | 'in_play' | 'at_target' | 'near_stop' | 'invalidated';

export interface Level {
  key: 'stop' | 'entry' | 'live' | 't1' | 't2';
  label: string;
  price: number;
  /** signed % from live (+ = above live) */
  pctFromLive: number;
  /** distance from live in R (always >= 0) */
  rAway: number;
  /** the level's own R-multiple measured from entry (stop = -1R, T1 = +xR) */
  rFromEntry: number;
}

export interface Component { key: 'validity' | 'progress' | 'pace' | 'overlay'; label: string; value: number; why: string }

export interface SignalGeometry {
  risk: number;                 // $ per share to the stop
  reward: number;               // $ per share to T1
  rr: number;                   // reward : risk at entry
  /** Null means no second structural target has been observed. */
  t2: number | null;
  levels: Level[];
  progressPct: number;          // 0–100 entry → T1
  pnlPct: number;               // direction-aware, from entry
  daysHeld: number;
  horizonDays: number;
  horizonBasis: string;
  horizonUsedPct: number;
  drawdownPct: number;          // adverse excursion from entry (0 if none)
  status: SignalStatus;
  statusLabel: string;
  components: Component[];
  plan: { rung: 'T1' | 'T2'; price: number; action: string; active: boolean }[];
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Max days the thesis is given, by holding period. */
export function horizonDaysFor(
  holdingPeriod?: string | null,
  optionDte?: number | null,
  expiryDate?: string | null,
): { days: number; basis: string } {
  const remainingDte = expiryDate
    ? Math.max(0, Math.ceil((Date.parse(expiryDate) - Date.now()) / 86_400_000))
    : optionDte ?? null;
  const period = (holdingPeriod || '').toLowerCase();

  switch (period) {
    case 'day': return { days: 1, basis: 'intraday plan' };
    case 'week-ending': return { days: Math.max(1, Math.min(5, remainingDte ?? 5)), basis: remainingDte != null ? `${remainingDte}DTE contract` : 'week-ending plan' };
    case 'swing': {
      // A swing plan should exit with time still left on the option. Half the
      // available DTE (capped at 15 sessions) creates a real management window
      // without pretending every 10DTE and 25DTE contract is the same 5-day bet.
      const days = remainingDte != null ? Math.max(3, Math.min(15, Math.round(remainingDte * 0.5))) : 5;
      return { days, basis: remainingDte != null ? `${remainingDte}DTE contract` : 'setup default · no contract' };
    }
    case 'position': {
      const days = remainingDte != null ? Math.max(20, Math.min(120, Math.round(remainingDte * 0.65))) : 30;
      return { days, basis: remainingDte != null ? `${remainingDte}DTE contract` : 'position plan' };
    }
    case 'leap':
    case 'leaps': {
      const days = remainingDte != null ? Math.max(90, Math.min(365, Math.round(remainingDte * 0.65))) : 180;
      return { days, basis: remainingDte != null ? `${remainingDte}DTE contract` : 'LEAPS plan' };
    }
    default: return { days: remainingDte != null ? Math.max(3, Math.min(30, Math.round(remainingDte * 0.5))) : 10, basis: remainingDte != null ? `${remainingDte}DTE contract` : 'unclassified setup' };
  }
}

export function computeGeometry(i: GeomInput): SignalGeometry {
  const long = i.direction !== 'short';
  const entry = i.entryPrice;
  const live = i.live > 0 ? i.live : entry;

  // risk / reward per share, direction-aware
  const risk = Math.max(Math.abs(entry - i.stopLoss), 1e-6);
  const reward = Math.abs(i.targetPrice - entry);
  const rr = i.riskRewardRatio && i.riskRewardRatio > 0 ? i.riskRewardRatio : reward / risk;

  // The persisted trade idea has one target today. Don't create a prettier,
  // but imaginary, T2 here. When the publisher records a second real level it
  // can be passed through explicitly.
  const t2: number | null = null;

  const mk = (key: Level['key'], label: string, price: number): Level => ({
    key, label, price,
    pctFromLive: live > 0 ? ((price - live) / live) * 100 : 0,
    rAway: Math.abs(price - live) / risk,
    rFromEntry: (long ? price - entry : entry - price) / risk,
  });

  const levels: Level[] = [
    mk('t1', 'T1', i.targetPrice),
    mk('live', 'LIVE', live),
    mk('entry', 'ENTRY', entry),
    mk('stop', 'STOP', i.stopLoss),
  ].sort((a, b) => b.price - a.price);

  // travelled entry → T1
  const span = long ? i.targetPrice - entry : entry - i.targetPrice;
  const done = long ? live - entry : entry - live;
  const progressPct = span > 0 ? clamp((done / span) * 100) : 0;

  const pnlPct = entry > 0 ? ((long ? live - entry : entry - live) / entry) * 100 : 0;

  // time
  const started = i.generatedAt ? Date.parse(i.generatedAt) : NaN;
  const daysHeld = Number.isNaN(started) ? 0 : Math.max(0, (Date.now() - started) / 86_400_000);
  const horizonPlan = horizonDaysFor(i.holdingPeriod, i.optionDte, i.expiryDate);
  const horizonDays = horizonPlan.days;
  const horizonUsedPct = clamp((daysHeld / horizonDays) * 100);

  // adverse excursion: how far it went against us from entry
  const adverse = i.extremePrice != null
    ? (long ? entry - Math.min(i.extremePrice, live) : Math.max(i.extremePrice, live) - entry)
    : (long ? entry - live : live - entry);
  const drawdownPct = entry > 0 ? Math.max(0, (adverse / entry) * 100) : 0;

  // status
  // Price touching the entry is not proof of an entry. A trigger must be
  // observed by the engine, and an execution must come from the paper/broker
  // ledger. This makes the UI tell the truth even when spot sits beyond a
  // planned trigger level.
  const triggered = i.lifecycleState === 'triggered' || i.lifecycleState === 'executed';
  const hitStop = long ? live <= i.stopLoss : live >= i.stopLoss;
  const nearStop = Math.abs(live - i.stopLoss) / risk <= 0.25;
  let status: SignalStatus = 'in_play';
  if (hitStop) status = 'invalidated';
  else if (!triggered) status = 'pending_trigger';
  else if (progressPct >= 95) status = 'at_target';
  else if (nearStop) status = 'near_stop';

  const statusLabel = {
    pending_trigger: 'PENDING TRIGGER',
    in_play: 'IN PLAY',
    at_target: 'AT TARGET',
    near_stop: 'NEAR STOP',
    invalidated: 'INVALIDATED',
  }[status];

  // ── the four sub-scores ──────────────────────────────────────────────
  // VALIDITY — is the setup still structurally intact? Conviction, decayed by how much
  // of the risk budget has been spent moving against us.
  const riskSpent = clamp((Math.max(0, long ? entry - live : live - entry) / risk) * 100);
  const validity = clamp(Math.round((i.convictionScore != null ? clamp(i.convictionScore * 1.8) : 60) * (1 - riskSpent / 200)));

  // PACE — progress made vs time spent. 100 = on or ahead of schedule.
  const pace = horizonUsedPct <= 0 ? 100 : clamp(Math.round((progressPct / Math.max(horizonUsedPct, 1)) * 100));

  // OVERLAY — how much of the R:R is still ahead of us (unrealised opportunity).
  const overlay = clamp(Math.round(100 - progressPct * 0.6 - riskSpent * 0.4));

  const components: Component[] = [
    { key: 'validity', label: 'VALIDITY', value: validity, why: `${riskSpent.toFixed(0)}% of risk budget used` },
    { key: 'progress', label: 'PROGRESS', value: Math.round(progressPct), why: 'entry → T1' },
    { key: 'pace',     label: 'PACE',     value: pace,     why: `${horizonUsedPct.toFixed(0)}% of horizon spent` },
    { key: 'overlay',  label: 'OVERLAY',  value: overlay,  why: 'opportunity still ahead' },
  ];

  // One observed level means one honest action. Do not imply a second exit
  // plan simply because a component wants symmetrical rows.
  const plan: SignalGeometry['plan'] = [
    { rung: 'T1', price: i.targetPrice, action: 'First structural target — reassess or trail only after a new level forms', active: status === 'in_play' || status === 'pending_trigger' },
  ];

  return {
    risk, reward, rr, t2, levels, progressPct, pnlPct,
    daysHeld, horizonDays, horizonBasis: horizonPlan.basis, horizonUsedPct, drawdownPct,
    status, statusLabel, components, plan,
  };
}
