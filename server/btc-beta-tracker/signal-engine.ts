/**
 * BTC TRACKER — Signal Engine
 * =============================
 * Detects 4 patterns in real-time and converts each match to a BTCSignal.
 *
 *   1. btc_breakout_long       BTC breaks resistance → long highest-beta calls
 *   2. btc_breakdown_short     BTC breaks support    → long highest-beta puts
 *   3. btc_divergence_alpha    Stock lagging/leading → mean reversion
 *   4. btc_vol_regime_shift    BTC vol crushing      → premium-sell setup
 *
 * Each detection runs independently — patterns don't interfere with each other.
 * Output is a fully populated BTCSignal that the trade-idea-generator can
 * convert directly into a Trade Desk idea.
 */

import { logger } from '../logger';
import { v4 as uuidv4 } from 'uuid';
import {
  computeBeta,
  computeDivergence,
  detectPivots,
  extractKeyLevels,
  detectBreak,
  pricesToReturns,
  realizedVolatility,
  stddev,
} from './correlation-math';
import {
  fetchBTCCurrent,
  fetchBTCHistorical,
  fetchPairForBeta,
} from './btc-data-feed';
import {
  BTC_UNIVERSE,
  type BTCSignal,
  type BTCBetaPosition,
  type BTCState,
  type BTCPattern,
  type BTCSignalDirection,
} from '@shared/btc-tracker-types';
import { scoreToExtendedGrade } from '../thesis-radar/conviction-agent';

// ─── BTC State builder ──────────────────────────────────────────────

export async function buildBTCState(): Promise<BTCState | null> {
  const current = await fetchBTCCurrent();
  const history = await fetchBTCHistorical(90);
  if (!current || !history || history.length < 30) {
    logger.warn('[BTC-ENGINE] Cannot build BTC state — missing data');
    return null;
  }

  const closes = history.map(b => b.close);
  const returns = pricesToReturns(closes);
  const realizedVol = realizedVolatility(returns) * 100; // as percentage

  const pivots = detectPivots(closes, 5);
  const { resistance, support } = extractKeyLevels(pivots);

  const yesterdayClose = closes[closes.length - 2] ?? current.price;
  const breakInfo = detectBreak(current.price, yesterdayClose, resistance, support, 1.0);

  const nextResistance = resistance.find(r => r > current.price) ?? null;
  const nextSupport = [...support].reverse().find(s => s < current.price) ?? null;

  // RSI(14) on daily closes
  const rsiDaily = computeRSI(closes, 14);

  return {
    price: current.price,
    timestamp: new Date().toISOString(),
    change24h: current.change24h,
    change1h: current.change1h,
    realizedVol30d: realizedVol,
    resistance,
    support,
    recentBreak: breakInfo.kind,
    breakStrength: breakInfo.strength,
    nextResistance,
    nextSupport,
    rsi1h: rsiDaily, // intraday hourly not available from daily candles — fallback
    rsiDaily,
  };
}

// ─── Per-ticker beta calculation ───────────────────────────────────

export async function buildBetaPosition(symbol: string): Promise<BTCBetaPosition | null> {
  const pair = await fetchPairForBeta(symbol, 90);
  if (!pair) return null;

  const stockReturns = pricesToReturns(pair.stockCloses);
  const btcReturns = pricesToReturns(pair.btcCloses);

  // 30-day rolling beta uses last 30 returns
  const beta30 = computeBeta(stockReturns.slice(-30), btcReturns.slice(-30));
  const beta90 = computeBeta(stockReturns, btcReturns);

  const stockSpot = pair.stockCloses[pair.stockCloses.length - 1];
  const stockYesterday = pair.stockCloses[pair.stockCloses.length - 2] ?? stockSpot;
  const actualMovePct = ((stockSpot - stockYesterday) / stockYesterday) * 100;

  const btcLast = pair.btcCloses[pair.btcCloses.length - 1];
  const btcPrev = pair.btcCloses[pair.btcCloses.length - 2] ?? btcLast;
  const btcMovePct = ((btcLast - btcPrev) / btcPrev) * 100;

  // Historical divergence stddev (used to z-score today's divergence)
  const hist: number[] = [];
  for (let i = 1; i < Math.min(stockReturns.length, btcReturns.length); i++) {
    const sPct = stockReturns[i] * 100;
    const bPct = btcReturns[i] * 100;
    hist.push(sPct - beta30.beta * bPct);
  }
  const divStdDev = stddev(hist);

  const div = computeDivergence(actualMovePct, btcMovePct, beta30.beta, divStdDev);

  return {
    symbol,
    spot: stockSpot,
    beta30d: beta30.beta,
    beta90d: beta90.beta,
    r2: beta30.r2,
    actualMovePct: div.actualMovePct,
    predictedMovePct: div.predictedMovePct,
    divergence: div.divergence,
    divergenceZ: div.divergenceZ,
  };
}

// ─── RSI helper ─────────────────────────────────────────────────────

function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (gains + losses === 0) return 50;
  const rs = gains / (losses || 1);
  return 100 - 100 / (1 + rs);
}

// ─── Pattern detectors ─────────────────────────────────────────────

/**
 * Pattern 1: BTC Breakout — Long the high beta
 */
function detectBreakoutLong(
  state: BTCState,
  positions: BTCBetaPosition[],
): BTCSignal[] {
  if (state.recentBreak !== 'resistance' || state.breakStrength < 50) return [];
  const signals: BTCSignal[] = [];

  // Rank by beta (highest first), exclude inverse correlations
  const ranked = [...positions]
    .filter(p => p.beta30d >= 0.8 && p.r2 >= 0.3)
    .sort((a, b) => b.beta30d - a.beta30d)
    .slice(0, 5);

  for (const pos of ranked) {
    const score = computeBreakoutScore(state, pos);
    const grade = scoreToExtendedGrade(score);
    if (score < 65) continue;

    const targetMove = pos.beta30d * Math.max(state.change1h, 1.5); // expected % move
    const t1 = pos.spot * (1 + targetMove / 100);
    const t2 = pos.spot * (1 + (targetMove * 1.8) / 100);
    const stop = pos.spot * 0.95;

    signals.push({
      id: uuidv4(),
      firedAt: new Date().toISOString(),
      pattern: 'btc_breakout_long',
      btcSnapshot: state,
      symbol: pos.symbol,
      spotAtFire: pos.spot,
      direction: 'long_call',
      // Strike picking: ATM-ish OTM call
      suggestedStrike: roundStrike(pos.spot * 1.05),
      suggestedExpiry: nearestWeeklyExpiry(7),
      suggestedContracts: contractSize(pos.spot, 200), // ~$200 budget per leg
      estimatedCost: 0, // populated by trade-idea-generator with live mid
      signals: [
        {
          label: `BTC broke $${state.recentBreak === 'resistance' ? Math.round(state.nextResistance ?? state.price) : state.price} resistance`,
          grade: scoreToExtendedGrade(state.breakStrength),
          score: state.breakStrength,
          source: 'price_action',
          detail: `Strength ${state.breakStrength.toFixed(0)}/100`,
        },
        {
          label: `${pos.symbol} β ${pos.beta30d.toFixed(2)} (R²=${pos.r2.toFixed(2)})`,
          grade: scoreToExtendedGrade(Math.min(100, pos.beta30d * 40)),
          score: Math.min(100, pos.beta30d * 40),
          source: 'sector_rotation',
          detail: `Predicted move: +${targetMove.toFixed(2)}%`,
        },
      ],
      finalGrade: grade,
      finalScore: score,
      thesis: `BTC broke ${state.recentBreak} (strength ${state.breakStrength.toFixed(0)}/100). ${pos.symbol} β ${pos.beta30d.toFixed(2)} → expected +${targetMove.toFixed(1)}% in next 4-24h. Long call captures move with leverage.`,
      invalidation: stop,
      targets: { t1, t2 },
      sellTriggers: { trim33At: 0.5, trim50At: 1.0, runnerExitAt: 2.0 },
      horizon: 'hours',
      status: 'fired',
      pushedToTradeDesk: false,
    });
  }
  return signals;
}

/**
 * Pattern 2: BTC Breakdown — Long the puts
 */
function detectBreakdownShort(
  state: BTCState,
  positions: BTCBetaPosition[],
): BTCSignal[] {
  if (state.recentBreak !== 'support' || state.breakStrength < 50) return [];
  const signals: BTCSignal[] = [];

  const ranked = [...positions]
    .filter(p => p.beta30d >= 0.8 && p.r2 >= 0.3)
    .sort((a, b) => b.beta30d - a.beta30d)
    .slice(0, 5);

  for (const pos of ranked) {
    const score = computeBreakdownScore(state, pos);
    if (score < 65) continue;

    const targetMove = pos.beta30d * Math.abs(state.change1h);
    const t1 = pos.spot * (1 - targetMove / 100);
    const t2 = pos.spot * (1 - (targetMove * 1.5) / 100);
    const stop = pos.spot * 1.05;

    signals.push({
      id: uuidv4(),
      firedAt: new Date().toISOString(),
      pattern: 'btc_breakdown_short',
      btcSnapshot: state,
      symbol: pos.symbol,
      spotAtFire: pos.spot,
      direction: 'long_put',
      suggestedStrike: roundStrike(pos.spot * 0.95),
      suggestedExpiry: nearestWeeklyExpiry(14),
      suggestedContracts: contractSize(pos.spot, 200),
      estimatedCost: 0,
      signals: [],
      finalGrade: scoreToExtendedGrade(score),
      finalScore: score,
      thesis: `BTC broke support (strength ${state.breakStrength.toFixed(0)}). ${pos.symbol} β ${pos.beta30d.toFixed(2)} → expected -${targetMove.toFixed(1)}%. Long put captures downside.`,
      invalidation: stop,
      targets: { t1, t2 },
      sellTriggers: { trim33At: 0.5, trim50At: 1.0, runnerExitAt: 2.0 },
      horizon: 'hours',
      status: 'fired',
      pushedToTradeDesk: false,
    });
  }
  return signals;
}

/**
 * Pattern 3: BTC Divergence Alpha — mean reversion play
 */
function detectDivergenceAlpha(
  state: BTCState,
  positions: BTCBetaPosition[],
): BTCSignal[] {
  const signals: BTCSignal[] = [];
  for (const pos of positions) {
    if (Math.abs(pos.divergenceZ) < 1.5) continue;
    if (pos.r2 < 0.4) continue; // skip noisy correlations

    const isLagging = pos.divergenceZ <= -1.5; // stock LAGGED BTC, will catch up
    const direction: BTCSignalDirection = isLagging ? 'long_call' : 'long_put';

    const targetMove = Math.abs(pos.divergence) * 0.6; // expect 60% mean reversion
    const t1 = isLagging
      ? pos.spot * (1 + targetMove / 100)
      : pos.spot * (1 - targetMove / 100);
    const stop = isLagging ? pos.spot * 0.96 : pos.spot * 1.04;

    const score = Math.min(95, 50 + Math.abs(pos.divergenceZ) * 15);

    signals.push({
      id: uuidv4(),
      firedAt: new Date().toISOString(),
      pattern: 'btc_divergence_alpha',
      btcSnapshot: state,
      symbol: pos.symbol,
      spotAtFire: pos.spot,
      direction,
      suggestedStrike: roundStrike(isLagging ? pos.spot * 1.03 : pos.spot * 0.97),
      suggestedExpiry: nearestWeeklyExpiry(30),
      suggestedContracts: contractSize(pos.spot, 200),
      estimatedCost: 0,
      signals: [],
      finalGrade: scoreToExtendedGrade(score),
      finalScore: score,
      thesis: `${pos.symbol} ${isLagging ? 'lagged' : 'led'} BTC by ${Math.abs(pos.divergenceZ).toFixed(2)}σ today (actual ${pos.actualMovePct.toFixed(2)}% vs predicted ${pos.predictedMovePct.toFixed(2)}% from β ${pos.beta30d.toFixed(2)}). Mean reversion: target ${targetMove.toFixed(1)}% ${isLagging ? 'catch-up' : 'pullback'}.`,
      invalidation: stop,
      targets: { t1 },
      sellTriggers: { trim33At: 0.4, trim50At: 0.8, runnerExitAt: 1.5 },
      horizon: 'days',
      status: 'fired',
      pushedToTradeDesk: false,
    });
  }
  return signals;
}

/**
 * Pattern 4: BTC Vol Regime Shift — IV crush opportunity (sell premium)
 * Note: this fires as a "neutral" signal type so the user can decide to sell calls/puts.
 */
function detectVolRegimeShift(
  state: BTCState,
  positions: BTCBetaPosition[],
): BTCSignal[] {
  // Only fire if BTC realized vol has compressed (low) but stock IV is still elevated
  if (state.realizedVol30d > 70) return []; // BTC vol still high — skip
  // Without per-ticker IV percentile we use a heuristic based on miner volatility
  const signals: BTCSignal[] = [];
  // Conservative: only fire on highest-beta (most volatile) names where IV mean-reverts
  for (const pos of positions.filter(p => p.beta30d >= 1.7)) {
    const score = 60; // moderate conviction on this pattern
    signals.push({
      id: uuidv4(),
      firedAt: new Date().toISOString(),
      pattern: 'btc_vol_regime_shift',
      btcSnapshot: state,
      symbol: pos.symbol,
      spotAtFire: pos.spot,
      direction: 'short_call', // covered call / credit spread setup
      suggestedStrike: roundStrike(pos.spot * 1.10),
      suggestedExpiry: nearestWeeklyExpiry(30),
      suggestedContracts: 1,
      estimatedCost: 0,
      signals: [],
      finalGrade: scoreToExtendedGrade(score),
      finalScore: score,
      thesis: `BTC realized vol compressed to ${state.realizedVol30d.toFixed(0)}%. Miners' IV likely lags down — sell ${pos.symbol} ${roundStrike(pos.spot * 1.10)}C against shares for premium decay.`,
      invalidation: pos.spot * 1.15,
      targets: { t1: pos.spot * 0.95 },
      sellTriggers: { trim33At: 0.5, trim50At: 0.8, runnerExitAt: 1.0 },
      horizon: 'weeks',
      status: 'fired',
      pushedToTradeDesk: false,
    });
  }
  return signals;
}

// ─── Composite scoring helpers ─────────────────────────────────────

function computeBreakoutScore(state: BTCState, pos: BTCBetaPosition): number {
  let score = 0;
  score += Math.min(35, state.breakStrength * 0.4);
  score += Math.min(25, pos.beta30d * 12);
  score += Math.min(15, pos.r2 * 25);
  score += state.rsiDaily > 50 && state.rsiDaily < 75 ? 10 : 0;
  score += state.change24h > 2 ? 10 : 0;
  return Math.min(100, Math.round(score));
}

function computeBreakdownScore(state: BTCState, pos: BTCBetaPosition): number {
  let score = 0;
  score += Math.min(35, state.breakStrength * 0.4);
  score += Math.min(25, pos.beta30d * 12);
  score += Math.min(15, pos.r2 * 25);
  score += state.rsiDaily > 70 ? 10 : 0;
  score += state.change24h < -2 ? 10 : 0;
  return Math.min(100, Math.round(score));
}

// ─── Strike + expiry helpers ───────────────────────────────────────

function roundStrike(price: number): number {
  if (price < 5) return Math.round(price * 2) / 2; // half dollar increments
  if (price < 50) return Math.round(price);
  if (price < 200) return Math.round(price / 5) * 5; // $5 increments
  return Math.round(price / 10) * 10;
}

function nearestWeeklyExpiry(daysOut: number): string {
  const target = new Date(Date.now() + daysOut * 24 * 60 * 60 * 1000);
  // Find nearest Friday
  const day = target.getUTCDay();
  const daysToFriday = (5 - day + 7) % 7;
  target.setUTCDate(target.getUTCDate() + daysToFriday);
  return target.toISOString().split('T')[0];
}

function contractSize(spot: number, budget: number): number {
  // Rough: cheaper stocks get more contracts (atm calls cost ~5% of strike)
  const estCallPrice = spot * 0.05;
  return Math.max(1, Math.floor(budget / (estCallPrice * 100)));
}

// ─── Main scan ──────────────────────────────────────────────────────

export async function scanAllPatterns(): Promise<{
  state: BTCState | null;
  positions: BTCBetaPosition[];
  signals: BTCSignal[];
}> {
  const state = await buildBTCState();
  if (!state) return { state: null, positions: [], signals: [] };

  // Parallel beta computation for speed (limit concurrency to avoid rate limiting)
  const positions: BTCBetaPosition[] = [];
  const concurrency = 4;
  for (let i = 0; i < BTC_UNIVERSE.length; i += concurrency) {
    const batch = BTC_UNIVERSE.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(t => buildBetaPosition(t.symbol).catch(() => null)),
    );
    for (const r of batchResults) if (r) positions.push(r);
  }

  const signals: BTCSignal[] = [
    ...detectBreakoutLong(state, positions),
    ...detectBreakdownShort(state, positions),
    ...detectDivergenceAlpha(state, positions),
    ...detectVolRegimeShift(state, positions),
  ];

  logger.info(
    `[BTC-ENGINE] Scan: BTC=$${state.price.toFixed(0)} (${state.change24h >= 0 ? '+' : ''}${state.change24h.toFixed(2)}%) · ${positions.length} betas · ${signals.length} signals fired`,
  );

  return { state, positions, signals };
}
