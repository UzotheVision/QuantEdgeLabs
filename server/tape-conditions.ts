/**
 * TAPE CONDITIONS — is today a day to be buying premium at all?
 *
 * The board grades setups. Nothing graded the DAY. A conviction-30 call bought
 * into a falling tape with expensive premium and dealers short gamma loses on
 * three counts at once — direction, vol, and chop — and the setup being good is
 * irrelevant to any of them. The most valuable thing a system like this can say
 * is "not today", and it had no way to say it.
 *
 * Five reads, each of which independently makes long premium worse:
 *
 *   TREND      SPY under its own short average — a long is swimming upstream.
 *   VOL        VIX elevated or spiking: you pay more for the same exposure, and
 *              a vol collapse takes the position down even when direction is right.
 *   BREADTH    Few sectors participating. A thin tape reverses.
 *   GAMMA      SPY in negative gamma: dealers hedge WITH the move, so ranges
 *              extend and stops that look sane get taken.
 *   CALENDAR   OPEX and the sessions around it behave differently.
 *
 * The verdict is deliberately blunt — TRADE, SELECTIVE, or SIT OUT — because a
 * nuanced score gets rationalised away at 9:31am. Sitting out is a position.
 */
import { logger } from './logger';

export type TapeVerdict = 'trade' | 'selective' | 'sit_out';

export interface TapeSignal {
  key: string;
  label: string;
  /** Negative = argues against buying premium today. */
  points: number;
  detail: string;
}

export interface TapeConditions {
  verdict: TapeVerdict;
  score: number;
  headline: string;
  signals: TapeSignal[];
  /** What would have to change for the verdict to improve. */
  whatWouldChangeIt: string | null;
  asOf: string;
}

async function spyBars(): Promise<{ close: number[]; high: number[]; low: number[] }> {
  const { yahooChart } = await import('./yahoo-client');
  const j = await yahooChart('SPY', { range: '3mo', interval: '1d' });
  const q = j?.chart?.result?.[0]?.indicators?.quote?.[0];
  if (!q) return { close: [], high: [], low: [] };
  return {
    close: (q.close ?? []).filter((x: any) => Number.isFinite(x)),
    high: (q.high ?? []).filter((x: any) => Number.isFinite(x)),
    low: (q.low ?? []).filter((x: any) => Number.isFinite(x)),
  };
}

function ema(v: number[], p: number): number {
  if (!v.length) return NaN;
  const k = 2 / (p + 1);
  let prev = v[0];
  for (let i = 1; i < v.length; i++) prev = v[i] * k + prev * (1 - k);
  return prev;
}

export async function getTapeConditions(): Promise<TapeConditions> {
  const signals: TapeSignal[] = [];

  // ── TREND ────────────────────────────────────────────────────────────────
  try {
    const { close } = await spyBars();
    if (close.length > 25) {
      const spot = close[close.length - 1];
      const e10 = ema(close.slice(-40), 10);
      const vs = ((spot - e10) / e10) * 100;
      const pts = vs < -1.5 ? -3 : vs < -0.4 ? -2 : vs > 0.4 ? 2 : 0;
      signals.push({
        key: 'trend', label: 'Index trend', points: pts,
        detail: `SPY ${vs >= 0 ? '+' : ''}${vs.toFixed(2)}% vs its 10-day average.`,
      });
    }
  } catch { /* a missing read must not decide the day */ }

  // ── VOLATILITY ───────────────────────────────────────────────────────────
  try {
    const { yahooQuote } = await import('./yahoo-client');
    const vix = await yahooQuote('^VIX');
    if (vix) {
      const lvl = vix.price;
      const chg = vix.changePercent;
      // Level matters, but the CHANGE matters more: a spiking VIX is repricing
      // every option you hold while you hold it.
      let pts = 0;
      if (chg > 8) pts -= 3;
      else if (chg > 4) pts -= 2;
      else if (chg < -5) pts += 1;
      if (lvl > 28) pts -= 2;
      else if (lvl > 21) pts -= 1;
      else if (lvl < 15) pts += 1;
      signals.push({
        key: 'vol', label: 'Volatility', points: pts,
        detail: `VIX ${lvl.toFixed(1)} (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%). ` +
          (chg > 4 ? 'Rising vol reprices premium against you intraday.'
           : lvl > 21 ? 'Elevated — you are paying up for the same exposure.'
           : 'Calm enough that premium is not the problem.'),
      });
    }
  } catch { /* optional */ }

  // ── BREADTH ──────────────────────────────────────────────────────────────
  try {
    const { getSectorRotation } = await import('./sector-rotation');
    const rot = await getSectorRotation();
    const secs = rot?.sectors ?? [];
    if (secs.length >= 8) {
      const green = secs.filter((s: any) => s.change > 0).length;
      const pctGreen = green / secs.length;
      const pts = pctGreen < 0.25 ? -3 : pctGreen < 0.4 ? -2 : pctGreen > 0.7 ? 2 : 0;
      signals.push({
        key: 'breadth', label: 'Breadth', points: pts,
        detail: `${green} of ${secs.length} sectors green. ` +
          (pctGreen < 0.4 ? 'A thin tape reverses — few things are actually working.'
           : 'Participation is broad enough to trust a move.'),
      });
    }
  } catch { /* optional */ }

  // ── DEALER GAMMA ─────────────────────────────────────────────────────────
  try {
    const { computeGEXFromCBOE } = await import('./gex-cboe-fallback');
    const gex = await computeGEXFromCBOE('SPY');
    if (gex?.regime) {
      const neg = String(gex.regime).includes('negative');
      signals.push({
        key: 'gamma', label: 'Dealer gamma', points: neg ? -2 : 1,
        detail: neg
          ? 'SPY in negative gamma — dealers hedge WITH the move, so ranges extend and reasonable stops get taken.'
          : 'SPY in positive gamma — dealers dampen the move, ranges stay contained.',
      });
    }
  } catch { /* optional */ }

  // ── CALENDAR ─────────────────────────────────────────────────────────────
  try {
    const { getOpexContext } = await import('@shared/opex-calendar');
    const opex = getOpexContext();
    if (opex.isOpexDay) {
      signals.push({ key: 'calendar', label: 'Calendar', points: -2,
        detail: `${opex.label}. Pinning is strongest today and anything held to the close settles at intrinsic.` });
    } else if (opex.isOpexWeek) {
      signals.push({ key: 'calendar', label: 'Calendar', points: -1,
        detail: `${opex.label}. Levels held by expiring gamma may stop holding once it rolls off.` });
    }
  } catch { /* optional */ }

  const score = signals.reduce((s, x) => s + x.points, 0);

  // Thresholds are deliberately asymmetric. The cost of sitting out a good day is
  // an opportunity; the cost of trading a bad one is money.
  const verdict: TapeVerdict = score <= -5 ? 'sit_out' : score <= -1 ? 'selective' : 'trade';

  const worst = [...signals].sort((a, b) => a.points - b.points)[0];
  const headline =
    verdict === 'sit_out'
      ? 'Sit this one out. Long premium is fighting the tape today.'
      : verdict === 'selective'
        ? 'Selective only. Take A-grade setups, skip anything marginal.'
        : 'Tape is workable. Nothing structural arguing against premium.';

  const whatWouldChangeIt =
    verdict === 'trade' || !worst || worst.points >= 0
      ? null
      : `Mostly ${worst.label.toLowerCase()}: ${worst.detail}`;

  logger.info(`[TAPE] ${verdict.toUpperCase()} (score ${score}) — ${signals.map((s) => `${s.key}:${s.points}`).join(' ')}`);

  return { verdict, score, headline, signals, whatWouldChangeIt, asOf: new Date().toISOString() };
}
