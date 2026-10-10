/**
 * OlAlgoMax — LEAPs + Swings simulator
 * =====================================
 * A self-contained portfolio simulator that acts like a discretionary
 * swing/LEAP trader (à la Nela Algo Warriors). Unlike OlAlgo's existing
 * backtest, this does NOT read pre-resolved tradeIdeas — it generates
 * entries on the fly from historical OHLC, then walks each position
 * forward with a trim ladder + DTE-flexed stops.
 *
 * Playbook:
 *   1. Every Monday, scan the watchlist for entry signals (close > 20
 *      SMA + RSI > 50). For each that fires, open a long call.
 *   2. Pick a DTE bucket (15-30 / 31-90 / 91-270 / 271-540) and a
 *      delta target that flexes with DTE (lower delta for short DTE,
 *      higher for LEAPs).
 *   3. Size each entry at pctPerName of equity. Cap concurrent
 *      positions at maxConcurrent and per-sector at maxPerSector.
 *   4. Walk forward bar-by-bar:
 *        - Trim ⅓ at +15% premium (locks the trade green)
 *        - Trim ⅓ at +30% premium
 *        - Runner trails -25% off peak premium
 *        - Hard stop at -50%/-40%/-30% based on DTE bucket
 *        - Force close at expiration (intrinsic value)
 *   5. Track equity, max DD, trim events, win rate.
 *
 * Premium model:
 *   For each position, current premium ≈ intrinsic + extrinsic × decay,
 *   where decay is sqrt(daysRemaining/totalDTE) for LEAPs (slow) and
 *   linear for short DTE (fast). This is a defensible first-order
 *   model — not Black-Scholes, but it captures the dominant P&L driver
 *   (directional stock move vs theta).
 */

import { getTradierHistoryOHLC } from './tradier-api';
import { logger } from './logger';
import { getSector, type Sector } from '../shared/approved-tickers';

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

export interface DTEBucket {
  minDTE: number;
  maxDTE: number;
  /** target option delta for strike selection (0-1) */
  deltaTarget: number;
  /** hard stop as a fraction of entry premium lost (0.50 = -50%) */
  stopPct: number;
  /** relative weight for sampling this bucket on each new entry */
  weight: number;
}

export interface OlAlgoMaxConfig {
  startingCapital: number;
  watchlist: string[];
  /** trading window — used to fetch OHLC and bound the sim */
  lookbackDays: number;

  // Sizing
  /** fraction of current equity allocated to each new entry (0.07 = 7%) */
  pctPerName: number;
  maxConcurrent: number;
  maxPerSector: number;

  // DTE / strike selection
  dteBuckets: DTEBucket[];

  // Trim & stop ladder
  trim1Pct: number;            // 0.15 → sell ⅓ at +15%
  trim2Pct: number;            // 0.30 → sell ⅓ at +30%
  trailingStopFromPeak: number; // 0.25 → trail runner -25% off peak

  // Entry signal
  minSmaCross: boolean;         // require close > 20-day SMA
  minRsi: number;               // require RSI(14) > N

  // Reproducibility
  rngSeed: number;
}

export const DEFAULT_OLALGO_MAX_CONFIG: Omit<OlAlgoMaxConfig, 'watchlist' | 'rngSeed'> = {
  startingCapital: 5000,
  lookbackDays: 365,
  pctPerName: 0.07,
  maxConcurrent: 10,
  maxPerSector: 2,
  dteBuckets: [
    { minDTE: 15,  maxDTE: 30,  deltaTarget: 0.35, stopPct: 0.50, weight: 1 },
    { minDTE: 31,  maxDTE: 90,  deltaTarget: 0.50, stopPct: 0.40, weight: 2 },
    { minDTE: 91,  maxDTE: 270, deltaTarget: 0.65, stopPct: 0.30, weight: 2 },
    { minDTE: 271, maxDTE: 540, deltaTarget: 0.70, stopPct: 0.30, weight: 1 },
  ],
  trim1Pct: 0.15,
  trim2Pct: 0.30,
  trailingStopFromPeak: 0.25,
  minSmaCross: true,
  minRsi: 50,
};

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface OHLCBars {
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  dates: string[];
  /** map date → idx for O(1) lookups inside the hot loop */
  dateIdx: Map<string, number>;
}

interface Position {
  symbol: string;
  sector: Sector;
  entryDate: string;
  entryBarIdx: number;
  entryStock: number;
  strike: number;
  expiryBarIdx: number;
  entryPremium: number;
  contracts: number;
  initialContracts: number;
  dte: number;
  delta: number;
  stopPct: number;
  trim1Hit: boolean;
  trim2Hit: boolean;
  peakPremium: number;
  /** $ already realized from prior trims */
  realized: number;
}

export interface ClosedTrade {
  symbol: string;
  sector: Sector;
  entryDate: string;
  exitDate: string;
  reason: 'trim_runner' | 'hard_stop' | 'expired';
  initialCost: number;
  totalRealized: number;
  pnl: number;
  pnlPct: number;
  contracts: number;
  dte: number;
  delta: number;
  trim1Hit: boolean;
  trim2Hit: boolean;
}

export interface OlAlgoMaxResult {
  startingCapital: number;
  endingEquity: number;
  totalRealizedPnL: number;
  totalReturnPct: number;
  maxDrawdownPct: number;

  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;

  trim1Events: number;
  trim2Events: number;
  runnerExits: number;
  hardStops: number;
  expirations: number;

  trades: ClosedTrade[];
  equityCurve: Array<{ date: string; equity: number; openPositions: number }>;
}

// ─────────────────────────────────────────────────────────────
// SEEDED RNG
// ─────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────
// INDICATORS
// ─────────────────────────────────────────────────────────────

function computeIndicators(bars: OHLCBars, idx: number) {
  if (idx < 20) return null;
  const win = bars.closes.slice(idx - 19, idx + 1);
  const sma20 = win.reduce((a, b) => a + b, 0) / win.length;

  // RSI(14)
  let gains = 0;
  let losses = 0;
  for (let i = idx - 13; i <= idx; i++) {
    const change = bars.closes[i] - bars.closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return { sma20, rsi, close: bars.closes[idx] };
}

// ─────────────────────────────────────────────────────────────
// STRIKE / PREMIUM MODEL
// ─────────────────────────────────────────────────────────────

/** Approximate strike + premium for a long call at the given delta/DTE.
 *  Uses a simplified BSM-ish closed form with σ=0.30 annualized vol.
 *  Good enough for portfolio simulation, not for live execution. */
function pickStrike(stock: number, deltaTarget: number, dte: number): { strike: number; entryPremium: number } {
  const sigma = 0.30;
  const T = dte / 365;
  const sqrtT = Math.sqrt(T);

  // Inverse-normal lookup for common delta targets
  const deltaToZ: Record<string, number> = {
    '0.30': 0.5244,
    '0.35': 0.3853,
    '0.40': 0.2533,
    '0.45': 0.1257,
    '0.50': 0,
    '0.55': -0.1257,
    '0.60': -0.2533,
    '0.65': -0.3853,
    '0.70': -0.5244,
    '0.75': -0.6745,
  };
  const zKey = deltaTarget.toFixed(2);
  const z = deltaToZ[zKey] ?? 0;

  // Strike that produces approximately the requested delta
  const rawStrike = stock * Math.exp(-z * sigma * sqrtT);
  const strike = Math.round(rawStrike * 2) / 2;

  // Premium ≈ intrinsic + extrinsic
  // Extrinsic for ATM ≈ 0.4 × S × σ × √T (Brenner-Subrahmanyam approximation)
  // Scale up for ITM (more intrinsic), down for OTM
  const intrinsic = Math.max(0, stock - strike);
  const atmExtrinsic = 0.4 * stock * sigma * sqrtT;
  // Higher delta = closer to ITM = less time value relative to intrinsic
  const extrinsicScale = 1 - Math.abs(deltaTarget - 0.5) * 0.6;
  const extrinsic = atmExtrinsic * extrinsicScale;

  const premium = Math.max(0.05, intrinsic + extrinsic);
  return { strike, entryPremium: Math.round(premium * 100) / 100 };
}

/** Estimate current premium given the stock price and time elapsed.
 *  LEAPs decay slowly (sqrt), short DTE decays linearly (theta-heavy). */
function estimatePremium(
  currentStock: number,
  strike: number,
  entryStock: number,
  entryPremium: number,
  daysElapsed: number,
  totalDTE: number,
  isLEAP: boolean,
): number {
  const intrinsicAtEntry = Math.max(0, entryStock - strike);
  const extrinsicAtEntry = Math.max(0, entryPremium - intrinsicAtEntry);

  const intrinsic = Math.max(0, currentStock - strike);
  const daysRemaining = Math.max(0, totalDTE - daysElapsed);
  const decayFactor = isLEAP
    ? Math.sqrt(daysRemaining / totalDTE)
    : daysRemaining / totalDTE;

  return Math.max(0, intrinsic + extrinsicAtEntry * decayFactor);
}

// ─────────────────────────────────────────────────────────────
// DTE BUCKET SAMPLER
// ─────────────────────────────────────────────────────────────

function pickDTEBucket(buckets: DTEBucket[], rng: () => number) {
  const total = buckets.reduce((s, b) => s + b.weight, 0);
  let r = rng() * total;
  for (const b of buckets) {
    r -= b.weight;
    if (r <= 0) {
      const dte = Math.floor(b.minDTE + rng() * (b.maxDTE - b.minDTE + 1));
      return { dte, deltaTarget: b.deltaTarget, stopPct: b.stopPct };
    }
  }
  const last = buckets[buckets.length - 1];
  return { dte: last.maxDTE, deltaTarget: last.deltaTarget, stopPct: last.stopPct };
}

/** Find the bar whose date is the first one >= entry + dte calendar days. */
function findExpiryBarIdx(bars: OHLCBars, entryBarIdx: number, dte: number): number {
  const entryDate = new Date(bars.dates[entryBarIdx] + 'T16:00:00Z');
  const targetMs = entryDate.getTime() + dte * 86_400_000;
  for (let j = entryBarIdx + 1; j < bars.dates.length; j++) {
    const barMs = new Date(bars.dates[j] + 'T16:00:00Z').getTime();
    if (barMs >= targetMs) return j;
  }
  return bars.dates.length - 1;
}

// ─────────────────────────────────────────────────────────────
// MAIN RUNNER
// ─────────────────────────────────────────────────────────────

export async function runOlAlgoMax(config: OlAlgoMaxConfig): Promise<OlAlgoMaxResult> {
  const rng = makeRng(config.rngSeed);

  // 1. Fetch OHLC for every watchlist ticker
  const tickerBars = new Map<string, OHLCBars>();
  for (const sym of config.watchlist) {
    const raw = await getTradierHistoryOHLC(sym.toUpperCase(), config.lookbackDays);
    if (!raw || raw.closes.length < 25) continue;
    const dateIdx = new Map<string, number>();
    raw.dates.forEach((d, i) => dateIdx.set(d, i));
    tickerBars.set(sym.toUpperCase(), { ...raw, dateIdx });
  }
  if (tickerBars.size === 0) {
    throw new Error('OlAlgoMax: no OHLC data for any watchlist ticker');
  }

  // 2. Build a unified date axis (union of all tickers' bar dates, sorted)
  const dateSet = new Set<string>();
  tickerBars.forEach((b) => b.dates.forEach((d) => dateSet.add(d)));
  const sortedDates = Array.from(dateSet).sort();

  // 3. Portfolio state
  let equity = config.startingCapital;
  let peakEquity = equity;
  let maxDrawdown = 0;
  const open: Position[] = [];
  const closed: ClosedTrade[] = [];
  const equityCurve: OlAlgoMaxResult['equityCurve'] = [];

  let trim1Events = 0;
  let trim2Events = 0;
  let runnerExits = 0;
  let hardStops = 0;
  let expirations = 0;

  // 4. Walk the unified date axis day-by-day
  for (let dayIdx = 0; dayIdx < sortedDates.length; dayIdx++) {
    const date = sortedDates[dayIdx];

    // ─── A. Process open positions ─────────────────────────
    for (let i = open.length - 1; i >= 0; i--) {
      const pos = open[i];
      const bars = tickerBars.get(pos.symbol);
      if (!bars) continue;
      const barIdx = bars.dateIdx.get(date);
      if (barIdx === undefined) continue;

      const isLEAP = pos.dte > 90;
      const daysElapsed = barIdx - pos.entryBarIdx;
      const high = bars.highs[barIdx];
      const low = bars.lows[barIdx];

      // ── Expiration ──
      if (barIdx >= pos.expiryBarIdx) {
        const finalStock = bars.closes[barIdx];
        const intrinsic = Math.max(0, finalStock - pos.strike);
        const exitValue = intrinsic * pos.contracts * 100;
        const totalRealized = pos.realized + exitValue;
        equity += exitValue;
        const initialCost = pos.entryPremium * pos.initialContracts * 100;
        closed.push({
          symbol: pos.symbol,
          sector: pos.sector,
          entryDate: pos.entryDate,
          exitDate: date,
          reason: 'expired',
          initialCost,
          totalRealized,
          pnl: totalRealized - initialCost,
          pnlPct: (totalRealized - initialCost) / initialCost,
          contracts: pos.initialContracts,
          dte: pos.dte,
          delta: pos.delta,
          trim1Hit: pos.trim1Hit,
          trim2Hit: pos.trim2Hit,
        });
        expirations++;
        open.splice(i, 1);
        continue;
      }

      const premiumAtHigh = estimatePremium(high, pos.strike, pos.entryStock, pos.entryPremium, daysElapsed, pos.dte, isLEAP);
      const premiumAtLow = estimatePremium(low, pos.strike, pos.entryStock, pos.entryPremium, daysElapsed, pos.dte, isLEAP);

      // Track peak for trailing-stop runner
      if (premiumAtHigh > pos.peakPremium) pos.peakPremium = premiumAtHigh;

      // ── Hard stop (entry × (1 - stopPct)) ──
      const stopLevel = pos.entryPremium * (1 - pos.stopPct);
      if (premiumAtLow <= stopLevel) {
        const exitValue = stopLevel * pos.contracts * 100;
        const totalRealized = pos.realized + exitValue;
        equity += exitValue;
        const initialCost = pos.entryPremium * pos.initialContracts * 100;
        closed.push({
          symbol: pos.symbol,
          sector: pos.sector,
          entryDate: pos.entryDate,
          exitDate: date,
          reason: 'hard_stop',
          initialCost,
          totalRealized,
          pnl: totalRealized - initialCost,
          pnlPct: (totalRealized - initialCost) / initialCost,
          contracts: pos.initialContracts,
          dte: pos.dte,
          delta: pos.delta,
          trim1Hit: pos.trim1Hit,
          trim2Hit: pos.trim2Hit,
        });
        hardStops++;
        open.splice(i, 1);
        continue;
      }

      // ── Trim ladder ──
      if (!pos.trim1Hit && premiumAtHigh >= pos.entryPremium * (1 + config.trim1Pct)) {
        const trimContracts = Math.floor(pos.initialContracts / 3);
        if (trimContracts > 0 && pos.contracts >= trimContracts) {
          const trimValue = pos.entryPremium * (1 + config.trim1Pct) * trimContracts * 100;
          pos.realized += trimValue;
          equity += trimValue;
          pos.contracts -= trimContracts;
          trim1Events++;
        }
        pos.trim1Hit = true;
      }
      if (pos.trim1Hit && !pos.trim2Hit && premiumAtHigh >= pos.entryPremium * (1 + config.trim2Pct)) {
        const trimContracts = Math.floor(pos.initialContracts / 3);
        if (trimContracts > 0 && pos.contracts >= trimContracts) {
          const trimValue = pos.entryPremium * (1 + config.trim2Pct) * trimContracts * 100;
          pos.realized += trimValue;
          equity += trimValue;
          pos.contracts -= trimContracts;
          trim2Events++;
        }
        pos.trim2Hit = true;
      }

      // ── Runner: trailing stop -25% off peak (only after trim2) ──
      if (pos.trim2Hit && pos.contracts > 0) {
        const trail = pos.peakPremium * (1 - config.trailingStopFromPeak);
        if (premiumAtLow <= trail) {
          const exitValue = trail * pos.contracts * 100;
          const totalRealized = pos.realized + exitValue;
          equity += exitValue;
          const initialCost = pos.entryPremium * pos.initialContracts * 100;
          closed.push({
            symbol: pos.symbol,
            sector: pos.sector,
            entryDate: pos.entryDate,
            exitDate: date,
            reason: 'trim_runner',
            initialCost,
            totalRealized,
            pnl: totalRealized - initialCost,
            pnlPct: (totalRealized - initialCost) / initialCost,
            contracts: pos.initialContracts,
            dte: pos.dte,
            delta: pos.delta,
            trim1Hit: pos.trim1Hit,
            trim2Hit: pos.trim2Hit,
          });
          runnerExits++;
          open.splice(i, 1);
        }
      }
    }

    // Update peak / drawdown after intraday processing
    // Equity here is realized cash + cost basis of open positions is already
    // out of the account. We mark-to-market in the curve below.
    let mtmEquity = equity;
    for (const pos of open) {
      const bars = tickerBars.get(pos.symbol);
      if (!bars) continue;
      const barIdx = bars.dateIdx.get(date);
      if (barIdx === undefined) continue;
      const isLEAP = pos.dte > 90;
      const daysElapsed = barIdx - pos.entryBarIdx;
      const close = bars.closes[barIdx];
      const prem = estimatePremium(close, pos.strike, pos.entryStock, pos.entryPremium, daysElapsed, pos.dte, isLEAP);
      mtmEquity += prem * pos.contracts * 100;
    }
    if (mtmEquity > peakEquity) peakEquity = mtmEquity;
    const dd = (peakEquity - mtmEquity) / peakEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // ─── B. Open new positions on Mondays ──────────────────
    const dow = new Date(date + 'T16:00:00Z').getUTCDay();
    if (dow === 1) {
      const sectorCount = new Map<Sector, number>();
      open.forEach((p) => sectorCount.set(p.sector, (sectorCount.get(p.sector) || 0) + 1));

      // Shuffle watchlist so we don't always pick the same first ones
      const shuffled = [...config.watchlist].map((s) => s.toUpperCase());
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      for (const sym of shuffled) {
        if (open.length >= config.maxConcurrent) break;
        if (open.some((p) => p.symbol === sym)) continue;

        const sector = getSector(sym);
        if ((sectorCount.get(sector) || 0) >= config.maxPerSector) continue;

        const bars = tickerBars.get(sym);
        if (!bars) continue;
        const barIdx = bars.dateIdx.get(date);
        if (barIdx === undefined || barIdx < 20) continue;

        const ind = computeIndicators(bars, barIdx);
        if (!ind) continue;

        // Entry signal
        if (config.minSmaCross && ind.close <= ind.sma20) continue;
        if (ind.rsi < config.minRsi) continue;

        // Pick DTE bucket → strike + premium
        const { dte, deltaTarget, stopPct } = pickDTEBucket(config.dteBuckets, rng);
        const { strike, entryPremium } = pickStrike(ind.close, deltaTarget, dte);

        // Sizing
        const target = equity * config.pctPerName;
        const costPerContract = entryPremium * 100;
        const contracts = Math.max(1, Math.floor(target / costPerContract));
        const totalCost = contracts * costPerContract;
        if (totalCost > equity * 0.95) continue; // leave a small cash buffer

        const expiryBarIdx = findExpiryBarIdx(bars, barIdx, dte);
        equity -= totalCost;

        open.push({
          symbol: sym,
          sector,
          entryDate: date,
          entryBarIdx: barIdx,
          entryStock: ind.close,
          strike,
          expiryBarIdx,
          entryPremium,
          contracts,
          initialContracts: contracts,
          dte,
          delta: deltaTarget,
          stopPct,
          trim1Hit: false,
          trim2Hit: false,
          peakPremium: entryPremium,
          realized: 0,
        });
        sectorCount.set(sector, (sectorCount.get(sector) || 0) + 1);
      }
    }

    equityCurve.push({ date, equity: mtmEquity, openPositions: open.length });
  }

  // 5. Force-close any positions still open at the last bar (mark to market)
  const lastDate = sortedDates[sortedDates.length - 1];
  for (const pos of open) {
    const bars = tickerBars.get(pos.symbol);
    if (!bars) continue;
    const lastBarIdx = bars.dates.length - 1;
    const finalStock = bars.closes[lastBarIdx];
    const isLEAP = pos.dte > 90;
    const daysElapsed = lastBarIdx - pos.entryBarIdx;
    const prem = estimatePremium(finalStock, pos.strike, pos.entryStock, pos.entryPremium, daysElapsed, pos.dte, isLEAP);
    const exitValue = prem * pos.contracts * 100;
    const totalRealized = pos.realized + exitValue;
    equity += exitValue;
    const initialCost = pos.entryPremium * pos.initialContracts * 100;
    closed.push({
      symbol: pos.symbol,
      sector: pos.sector,
      entryDate: pos.entryDate,
      exitDate: lastDate,
      reason: 'expired',
      initialCost,
      totalRealized,
      pnl: totalRealized - initialCost,
      pnlPct: (totalRealized - initialCost) / initialCost,
      contracts: pos.initialContracts,
      dte: pos.dte,
      delta: pos.delta,
      trim1Hit: pos.trim1Hit,
      trim2Hit: pos.trim2Hit,
    });
  }

  const wins = closed.filter((t) => t.pnl > 0).length;
  const losses = closed.filter((t) => t.pnl <= 0).length;
  const totalRealizedPnL = closed.reduce((s, t) => s + t.pnl, 0);

  logger.info(
    `[olalgo-max] ${closed.length} trades · ${wins}W/${losses}L · ` +
    `equity $${Math.round(equity).toLocaleString()} · DD ${(maxDrawdown * 100).toFixed(1)}% · ` +
    `trims: ${trim1Events}/${trim2Events} · runner: ${runnerExits} · stops: ${hardStops}`,
  );

  return {
    startingCapital: config.startingCapital,
    endingEquity: equity,
    totalRealizedPnL,
    totalReturnPct: (equity - config.startingCapital) / config.startingCapital,
    maxDrawdownPct: maxDrawdown,
    totalTrades: closed.length,
    wins,
    losses,
    winRate: closed.length > 0 ? wins / closed.length : 0,
    trim1Events,
    trim2Events,
    runnerExits,
    hardStops,
    expirations,
    trades: closed,
    equityCurve,
  };
}

// ─────────────────────────────────────────────────────────────
// LIVE SCAN — what would fire on the most recent bar
// ─────────────────────────────────────────────────────────────

export interface LiveSignal {
  symbol: string;
  sector: Sector;
  asOfDate: string;
  stockPrice: number;
  sma20: number;
  rsi14: number;
  /** suggested DTE bucket pick — uses the middle bucket (50d, 0.50Δ) by default
   *  since we can't roll RNG live; user can override at execution time */
  dte: number;
  delta: number;
  strike: number;
  entryPremium: number;
  contracts: number;
  totalCost: number;
  pctOfEquity: number;
  /** target premiums for the trim ladder + hard stop */
  trim1Price: number;
  trim2Price: number;
  hardStopPrice: number;
}

/** Run the OlAlgoMax entry signal on the latest bar of every watchlist
 *  ticker. Returns the list of qualifying entries with strike/premium/sizing
 *  computed exactly the same way the simulator does it.
 *
 *  This is what the bot WOULD enter if today were a Monday. It uses the
 *  middle DTE bucket (31-90d, 0.50Δ) deterministically — the simulator's
 *  weighted RNG can't be replayed live, so we pick the "core" bucket. */
export async function scanCurrentSignals(
  watchlist: string[],
  startingCapital: number,
  pctPerName: number,
  maxConcurrent: number,
  maxPerSector: number,
  lookbackDays: number = 60,
): Promise<LiveSignal[]> {
  const signals: LiveSignal[] = [];

  for (const rawSym of watchlist) {
    const sym = rawSym.toUpperCase();
    const raw = await getTradierHistoryOHLC(sym, lookbackDays);
    if (!raw || raw.closes.length < 25) continue;

    const idx = raw.closes.length - 1;
    const ind = computeIndicators(raw as any, idx);
    if (!ind) continue;

    // Same entry filter as the simulator
    if (ind.close <= ind.sma20) continue;
    if (ind.rsi < 50) continue;

    // Use the "core" bucket — 50d, 0.50Δ — same shape as DEFAULT_OLALGO_MAX_CONFIG[1]
    const dte = 50;
    const deltaTarget = 0.50;
    const stopPct = 0.40;

    const { strike, entryPremium } = pickStrike(ind.close, deltaTarget, dte);
    const target = startingCapital * pctPerName;
    const costPerContract = entryPremium * 100;
    const contracts = Math.max(1, Math.floor(target / costPerContract));
    const totalCost = contracts * costPerContract;

    signals.push({
      symbol: sym,
      sector: getSector(sym),
      asOfDate: raw.dates[idx],
      stockPrice: ind.close,
      sma20: ind.sma20,
      rsi14: ind.rsi,
      dte,
      delta: deltaTarget,
      strike,
      entryPremium,
      contracts,
      totalCost,
      pctOfEquity: totalCost / startingCapital,
      trim1Price: Math.round(entryPremium * 1.15 * 100) / 100,
      trim2Price: Math.round(entryPremium * 1.30 * 100) / 100,
      hardStopPrice: Math.round(entryPremium * (1 - stopPct) * 100) / 100,
    });
  }

  // Apply portfolio caps the same way the simulator would
  // 1. Sort by RSI strength (highest momentum first)
  signals.sort((a, b) => b.rsi14 - a.rsi14);

  // 2. Walk through, enforcing affordability + sector caps + concurrent cap
  //    and tracking running cash so we don't oversize
  const sectorCount = new Map<Sector, number>();
  const filtered: LiveSignal[] = [];
  let cashRemaining = startingCapital;
  for (const s of signals) {
    const c = sectorCount.get(s.sector) || 0;
    if (c >= maxPerSector) continue;
    if (filtered.length >= maxConcurrent) break;
    // Affordability — match simulator's "leave a small cash buffer" rule
    if (s.totalCost > cashRemaining * 0.95) continue;
    filtered.push(s);
    sectorCount.set(s.sector, c + 1);
    cashRemaining -= s.totalCost;
  }

  return filtered;
}

// ─────────────────────────────────────────────────────────────
// MONTE CARLO WRAPPER
// ─────────────────────────────────────────────────────────────

export interface OlAlgoMaxMC {
  runs: number;
  startingCapital: number;
  endingEquityP10: number;
  endingEquityP50: number;
  endingEquityP90: number;
  endingEquityMean: number;
  endingEquityMin: number;
  endingEquityMax: number;
  totalReturnPctP50: number;
  maxDrawdownP50: number;
  winRateP50: number;
  totalTradesP50: number;
  trim1EventsP50: number;
  trim2EventsP50: number;
  runnerExitsP50: number;
  hardStopsP50: number;
  bestRun: OlAlgoMaxResult;
  worstRun: OlAlgoMaxResult;
}

const median = (arr: number[]) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const percentile = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * p)] ?? 0;
};

export async function runOlAlgoMaxMC(
  baseConfig: Omit<OlAlgoMaxConfig, 'rngSeed'>,
  runs: number,
): Promise<OlAlgoMaxMC> {
  const results: OlAlgoMaxResult[] = [];
  for (let i = 0; i < runs; i++) {
    const r = await runOlAlgoMax({ ...baseConfig, rngSeed: (i + 1) * 1337 });
    results.push(r);
  }

  const equities = results.map((r) => r.endingEquity);
  const bestRun = [...results].sort((a, b) => b.endingEquity - a.endingEquity)[0];
  const worstRun = [...results].sort((a, b) => a.endingEquity - b.endingEquity)[0];

  return {
    runs: results.length,
    startingCapital: baseConfig.startingCapital,
    endingEquityP10: percentile(equities, 0.10),
    endingEquityP50: percentile(equities, 0.50),
    endingEquityP90: percentile(equities, 0.90),
    endingEquityMean: equities.reduce((s, x) => s + x, 0) / equities.length,
    endingEquityMin: Math.min(...equities),
    endingEquityMax: Math.max(...equities),
    totalReturnPctP50: median(results.map((r) => r.totalReturnPct)),
    maxDrawdownP50: median(results.map((r) => r.maxDrawdownPct)),
    winRateP50: median(results.map((r) => r.winRate)),
    totalTradesP50: Math.round(median(results.map((r) => r.totalTrades))),
    trim1EventsP50: Math.round(median(results.map((r) => r.trim1Events))),
    trim2EventsP50: Math.round(median(results.map((r) => r.trim2Events))),
    runnerExitsP50: Math.round(median(results.map((r) => r.runnerExits))),
    hardStopsP50: Math.round(median(results.map((r) => r.hardStops))),
    bestRun,
    worstRun,
  };
}
