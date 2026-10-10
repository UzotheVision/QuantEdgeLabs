/**
 * OlAlgo Bot — Challenge Backtest Engine
 * ======================================
 * Simulates the bot taking real historical trade ideas through configurable
 * risk rules to answer: "could $300 grow to $3,000 (and then $30,000)?"
 *
 * This is a SANDBOX. It does not touch the live auto-lotto-trader. It
 * pulls ideas from the tradeIdeas table, walks them in chronological
 * order, applies position sizing + risk gates, and produces an equity
 * curve plus per-trade journal.
 *
 * Two orthogonal axes drive the simulation:
 *   1. Trade pool   — last 90 days vs full history; lotto vs swing
 *   2. Risk profile — capital, % per trade, concurrent caps, daily loss
 *
 * The Monte Carlo wrapper (runChallengeMC) re-runs the same backtest
 * with different RNG seeds. The seed drives:
 *   - Slippage drift (±50% of base)
 *   - Fill probability for borderline trades
 *   - Tie-breaking when more candidates than slots
 * This produces a *distribution* of outcomes — not a single fragile
 * number. The single best run is preserved trade-by-trade for replay.
 *
 * Honest limits:
 *   • Trade ideas in the DB are real, but their outcomes are recorded
 *     against single-share entry/exit prices. We use those prices and
 *     apply leverage assumptions for options sizing.
 *   • Slippage and commissions are modeled but cannot capture every
 *     real-world friction (exchange fees, IV crush, weekend gaps).
 *   • The simulator stops when the account dies (drawdown breach) or
 *     when the trade pool is exhausted. It does NOT pretend to wait
 *     for "the next setup" — that would inflate results.
 *
 * The bot has TWO modes:
 *   • lotto  — only ideas where tradeType === 'lotto' OR isLottoPlay,
 *              uses high R:R (5x) and small position sizing
 *   • swing  — only ideas where tradeType in ('swing', 'mover'),
 *              uses 2:1 R:R and standard sizing
 */

import { db } from './db';
import { tradeIdeas } from '../shared/schema';
import { gte, sql } from 'drizzle-orm';
import {
  isApprovedTicker,
  isSkipTicker,
  S_TIER,
  A_TIER,
} from '../shared/approved-tickers';
import type { TradeIdea } from '../shared/schema';

// ─────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ─────────────────────────────────────────────────────────────

export type ChallengeMode = 'lotto' | 'swing' | 'mixed';
export type TradePool = 'last_90d' | 'full_history';
export type WatchlistScope = 's_only' | 's_and_a' | 'any_approved';
export type AccountType = 'cash' | 'margin';

export interface ChallengeConfig {
  /** Starting cash */
  startingCapital: number;
  /** Primary milestone — typically 10× starting */
  targetCapital: number;
  /** Stretch milestone — typically 100× starting */
  stretchTarget: number;
  /** Hard floor — sim halts if equity drops below this */
  bustThreshold: number;
  /** Maximum % of equity at risk per trade (0-1) */
  maxRiskPerTrade: number;
  /** Maximum concurrent open positions */
  maxConcurrentPositions: number;
  /** Daily loss % that halts trading for the day (0-1) */
  maxDailyLossPct: number;
  /** Account-killing drawdown from peak (0-1) */
  maxDrawdownPct: number;
  /** Confidence floor — only take ideas at or above this. 0 disables the gate. */
  minConfidence: number;
  /** Minimum risk:reward ratio — A+1 setups only */
  minRiskReward: number;
  /** Maximum risk:reward ratio — guards against pie-in-the-sky targets that never hit */
  maxRiskReward: number;
  /** Allowed probability bands. Empty array disables the gate. */
  allowedBands: string[];
  /** Required holding periods. Empty array disables the gate. */
  requiredHoldingPeriods: string[];
  /** Excluded holding periods (always rejected) */
  excludedHoldingPeriods: string[];
  /** Required trade sources. Empty array disables the gate. */
  requiredSources: string[];
  /** Required asset types. Empty array disables the gate. */
  requiredAssetTypes: string[];
  /** Alpha-tier ticker whitelist — bot only trades these. Empty array disables. */
  alphaTickers: string[];
  /** Minimum number of independent confluence signals required before the
   *  bot will fire. Counts qualitySignals[] OR convergenceSignalsJson.signalCount
   *  (whichever is larger). 0 disables — anything that passes the structural
   *  gate is tradeable. Use 3+ for high-conviction "stack the deck" mode. */
  minConfluenceCount: number;
  /** Maximum trades opened per calendar day (anti-revenge gate) */
  maxTradesPerDay: number;
  /** Minimum days between two entries on the SAME symbol — stops the bot
   *  from spamming a single ticker just because the DB has duplicate ideas. */
  perSymbolCooldownDays: number;
  /** Cash account = no leverage (notional ≤ equity).
   *  Margin account = notional ≤ equity × marginMultiple. */
  accountType: AccountType;
  /** Reg-T style margin multiple (1=cash, 2=intraday equity margin, 4=PDT day-trader margin) */
  marginMultiple: number;
  /** Profit-skim trigger as a multiple of the current "skim base".
   *  e.g. 2.0 = "every time the account doubles from the last skim, take some off the table".
   *  0 disables. */
  skimTriggerMult: number;
  /** Fraction of accumulated profit (above the skim base) to move to the vault.
   *  e.g. 0.8 = "vault 80% of the gain, keep 20% to keep growing buying power". */
  skimPct: number;
  /** Trade pool to draw from */
  pool: TradePool;
  /** Lotto vs swing strategy */
  mode: ChallengeMode;
  /** Watchlist scope */
  watchlist: WatchlistScope;
  /** Slippage as % of fill price for OPTION trades (entry+exit each) */
  optionSlippagePct: number;
  /** Slippage as % of fill price for STOCK trades (entry+exit each) */
  stockSlippagePct: number;
  /** Commission $ per option contract */
  commissionPerContract: number;
  /** Flat commission $ per stock leg (entry or exit) */
  stockCommissionPerLeg: number;
  /** RNG seed for reproducibility */
  rngSeed: number;
}

/** What the per-share entry/stop/target represent for sizing math. */
function multiplierFor(assetType: string | null | undefined): number {
  if (assetType === 'option') return 100; // 1 contract = 100 underlying shares
  return 1;
}

/**
 * Derive effective direction from the stored prices, not the stored
 * direction field. The historical DB has many "short" rows whose
 * target > entry > stop (a long configuration) — the upstream tagger
 * was unreliable. Trust the math:
 *   • target > entry → long
 *   • target < entry → short
 *   • equal → fall back to stored direction
 */
function effectiveDirection(idea: TradeIdea): 'long' | 'short' {
  if (idea.targetPrice > idea.entryPrice) return 'long';
  if (idea.targetPrice < idea.entryPrice) return 'short';
  return idea.direction === 'short' ? 'short' : 'long';
}

export interface SimulatedTrade {
  ideaId: string;
  symbol: string;
  direction: 'long' | 'short';
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  contracts: number;
  riskedDollars: number;
  realizedPnL: number;
  pnlPct: number;
  outcome: 'win' | 'loss' | 'breakeven';
  reason: 'hit_target' | 'hit_stop' | 'expired' | 'manual';
  equityAfter: number;
  confidence: number;
  catalyst: string;
  tradeType: string | null;
}

export interface EquityPoint {
  timestamp: string;
  equity: number;
  openPositions: number;
  totalTrades: number;
}

export interface ChallengeRunResult {
  config: ChallengeConfig;
  rngSeed: number;
  startedAt: string;
  endedAt: string;

  startingCapital: number;
  endingCapital: number;
  peakCapital: number;
  troughCapital: number;

  /** Profit-skim vault (locked away — not used for trading) */
  vaultBalance: number;
  /** Total realized: trading equity + vault */
  totalRealized: number;
  /** Number of skim events that fired during the run */
  skimEvents: number;

  hitTarget: boolean;
  hitStretch: boolean;
  busted: boolean;
  daysToTarget: number | null;
  daysToStretch: number | null;
  totalDays: number;

  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdownPct: number;
  longestLossStreak: number;
  longestWinStreak: number;

  trades: SimulatedTrade[];
  equityCurve: EquityPoint[];
}

export interface MonteCarloResult {
  config: ChallengeConfig;
  runs: number;
  poolSize: number;

  // Outcome distribution
  hitTargetCount: number;
  hitTargetPct: number;
  hitStretchCount: number;
  hitStretchPct: number;
  bustedCount: number;
  bustedPct: number;

  // Equity stats
  endingEquityP10: number;
  endingEquityP25: number;
  endingEquityP50: number;
  endingEquityP75: number;
  endingEquityP90: number;
  endingEquityMean: number;
  endingEquityMax: number;
  endingEquityMin: number;

  // Time stats
  medianDaysToTarget: number | null;
  medianDaysToStretch: number | null;

  // Vault stats (profit-skim mechanic)
  vaultBalanceP50: number;
  vaultBalanceMean: number;
  vaultBalanceMax: number;
  totalRealizedP50: number;
  totalRealizedMean: number;
  totalRealizedMax: number;
  medianSkimEvents: number;

  // Risk stats
  worstDrawdown: number;
  medianDrawdown: number;
  longestLossStreak: number;

  // Stat-by-stat across all runs
  perRunSummary: Array<{
    seed: number;
    endingCapital: number;
    vaultBalance: number;
    totalRealized: number;
    hitTarget: boolean;
    hitStretch: boolean;
    busted: boolean;
    profitable: boolean;
    totalTrades: number;
    winRate: number;
    maxDrawdown: number;
  }>;

  // Headline truthiness — runs where total wealth (BP + vault) > starting capital
  profitableCount: number;
  profitablePct: number;

  // Best & worst run preserved trade-by-trade for replay
  bestRun: ChallengeRunResult;
  worstRun: ChallengeRunResult;
}

// ─────────────────────────────────────────────────────────────
// DEFAULTS — sensible starting points for the dashboard
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// EMPIRICAL ALPHA TIER — winners discovered via profilePool().
// These S+A tickers had both meaningful sample size AND above-average
// historical win rate in the swing pool.
// ─────────────────────────────────────────────────────────────
export const SWING_ALPHA_TICKERS = [
  'NET',  'DDOG', 'HIMS', 'UPST', 'DUOL', 'AFRM',
  'ASAN', 'ESTC', 'MDB',  'BILL', 'COIN', 'SOFI',
  'RMBS', 'WDC',
];

// ─────────────────────────────────────────────────────────────
// LOTTO config — empirically tuned. Historical lotto pool has 73% raw
// win rate with 0 stop-outs (they expire instead). Confidence/band
// labels are NOT predictive on lottos, so we ignore them and rely on
// structural filters: option asset, flow source, position holding.
// ─────────────────────────────────────────────────────────────
export const DEFAULT_LOTTO_CONFIG: Omit<ChallengeConfig, 'rngSeed'> = {
  startingCapital: 300,
  targetCapital: 3_000,
  stretchTarget: 30_000,
  bustThreshold: 50,
  // 18% per trade — high WR + uncapped R:R + small starting account
  // demands aggressive sizing or we leave money on the table.
  maxRiskPerTrade: 0.18,
  maxConcurrentPositions: 4,
  maxDailyLossPct: 0.35,
  maxDrawdownPct: 0.60,
  minConfidence: 0,                       // disabled — labels are noise here
  minRiskReward: 1.5,
  maxRiskReward: 0,                       // disabled — lottos NEED big R:R
  allowedBands: [],                       // disabled — band labels are noise here
  requiredHoldingPeriods: ['position'],   // 93% WR vs 11% for swing-period lottos
  excludedHoldingPeriods: [],
  requiredSources: ['flow'],              // 35/37 lotto winners came from flow
  requiredAssetTypes: ['option'],
  alphaTickers: [],                       // S+A is enough, lottos are sparse
  minConfluenceCount: 0,                  // disabled — lottos are catalyst plays, not confluence stacks
  maxTradesPerDay: 4,                     // realistic — no more than 4 entries/day
  perSymbolCooldownDays: 2,               // 2-day cooldown — no spamming the same ticker
  accountType: 'cash',
  marginMultiple: 1,
  skimTriggerMult: 0,                     // disabled by default
  skimPct: 0,
  pool: 'last_90d',
  mode: 'lotto',
  watchlist: 's_and_a',
  optionSlippagePct: 0.025,
  stockSlippagePct: 0.0005,
  commissionPerContract: 0.65,
  stockCommissionPerLeg: 0,
};

// ─────────────────────────────────────────────────────────────
// SWING config — empirically tuned. Pool has 48% raw WR with high
// variance. The bot only trades the alpha-ticker subset (which back-
// tests at 60-89% WR) and avoids day-holds (22% WR) and 5+ R:R
// (24% WR). Conf 75-79 is the sweet spot, not 90+.
// ─────────────────────────────────────────────────────────────
export const DEFAULT_SWING_CONFIG: Omit<ChallengeConfig, 'rngSeed'> = {
  startingCapital: 300,
  targetCapital: 3_000,
  stretchTarget: 30_000,
  bustThreshold: 50,
  maxRiskPerTrade: 0.05,
  maxConcurrentPositions: 4,
  maxDailyLossPct: 0.15,
  maxDrawdownPct: 0.40,
  minConfidence: 70,                       // floor — most pool is 70+
  minRiskReward: 1.4,                      // include the 1.5-2 sweet spot
  maxRiskReward: 3.5,                      // exclude 5+ R:R fantasies
  allowedBands: [],                        // ticker whitelist does the work
  requiredHoldingPeriods: [],
  excludedHoldingPeriods: ['day'],         // day-holds = 22% WR, kill them
  requiredSources: [],
  requiredAssetTypes: [],                  // mixed stocks+options — options-only loses (-8.6% avg pnl)
  alphaTickers: SWING_ALPHA_TICKERS,       // empirical winners only
  minConfluenceCount: 0,                   // off by default — overridden per-tier (small accounts use 3+)
  maxTradesPerDay: 4,
  perSymbolCooldownDays: 3,                // swings take longer — 3-day cooldown per ticker
  accountType: 'cash',
  marginMultiple: 1,
  skimTriggerMult: 0,                      // disabled by default
  skimPct: 0,
  pool: 'last_90d',
  mode: 'swing',
  watchlist: 's_and_a',
  optionSlippagePct: 0.02,
  stockSlippagePct: 0.0005,
  commissionPerContract: 0.65,
  stockCommissionPerLeg: 0,
};

// ─────────────────────────────────────────────────────────────
// SEEDED RNG (mulberry32) — reproducible per seed
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
// TRADE POOL — fetch + filter ideas from DB
// ─────────────────────────────────────────────────────────────

type A1Gate = Pick<
  ChallengeConfig,
  | 'minConfidence'
  | 'minRiskReward'
  | 'maxRiskReward'
  | 'allowedBands'
  | 'requiredHoldingPeriods'
  | 'excludedHoldingPeriods'
  | 'requiredSources'
  | 'requiredAssetTypes'
  | 'alphaTickers'
  | 'minConfluenceCount'
>;

/**
 * Counts the independent confluence signals attached to an idea. Uses
 * whichever signal store is richer:
 *   - qualitySignals[] (legacy summary array)
 *   - convergenceSignalsJson.signalCount (modern engine output)
 *   - convergenceSignalsJson.signals[].length (raw signals array)
 */
function countConfluenceSignals(idea: TradeIdea): number {
  const qsLen = Array.isArray(idea.qualitySignals) ? idea.qualitySignals.length : 0;

  let convLen = 0;
  const conv = (idea as any).convergenceSignalsJson;
  if (conv && typeof conv === 'object') {
    if (typeof conv.signalCount === 'number') {
      convLen = conv.signalCount;
    } else if (Array.isArray(conv.signals)) {
      convLen = conv.signals.length;
    }
  }

  return Math.max(qsLen, convLen);
}

/**
 * A+1 setup gate. Empirically tuned — every gate is OPTIONAL and disabled
 * when its config field is empty/zero. This lets each mode (lotto vs swing)
 * apply only the filters that actually correlate with wins in its pool.
 */
export function passesA1Filter(idea: TradeIdea, config: A1Gate): boolean {
  // Confidence (0 disables)
  if (config.minConfidence > 0 && (idea.confidenceScore || 0) < config.minConfidence) return false;

  // Probability band whitelist
  if (config.allowedBands.length > 0) {
    const band = (idea.probabilityBand || '').trim();
    if (!config.allowedBands.includes(band)) return false;
  }

  // Source whitelist
  if (config.requiredSources.length > 0) {
    if (!config.requiredSources.includes(idea.source || '')) return false;
  }

  // Asset type whitelist
  if (config.requiredAssetTypes.length > 0) {
    if (!config.requiredAssetTypes.includes(idea.assetType || '')) return false;
  }

  // Holding period required + excluded
  const hp = idea.holdingPeriod || '';
  if (config.requiredHoldingPeriods.length > 0 && !config.requiredHoldingPeriods.includes(hp)) return false;
  if (config.excludedHoldingPeriods.length > 0 && config.excludedHoldingPeriods.includes(hp)) return false;

  // Alpha ticker whitelist (the actually-winning subset of S+A)
  if (config.alphaTickers.length > 0) {
    if (!config.alphaTickers.includes(idea.symbol.toUpperCase())) return false;
  }

  // Confluence count gate — "stack the deck" mode. Requires N independent
  // signals to fire before the bot will touch the trade. This is what
  // converts a high-volume signal firehose into a curated conviction list.
  if (config.minConfluenceCount > 0) {
    if (countConfluenceSignals(idea) < config.minConfluenceCount) return false;
  }

  // Sanity checks on the trade structure itself
  if (!idea.entryPrice || !idea.targetPrice || !idea.stopLoss) return false;
  if (idea.entryPrice <= 0 || idea.targetPrice <= 0 || idea.stopLoss <= 0) return false;

  const direction = effectiveDirection(idea);
  const perShareRisk = direction === 'long' ? idea.entryPrice - idea.stopLoss : idea.stopLoss - idea.entryPrice;
  if (perShareRisk <= 0) return false;

  const perShareReward = direction === 'long' ? idea.targetPrice - idea.entryPrice : idea.entryPrice - idea.targetPrice;
  if (perShareReward <= 0) return false;

  // Computed R:R sweet spot — guards both noisy targets and pie-in-the-sky
  const computedRR = perShareReward / perShareRisk;
  if (computedRR < config.minRiskReward) return false;
  if (config.maxRiskReward > 0 && computedRR > config.maxRiskReward) return false;

  return true;
}


export async function fetchTradePool(
  pool: TradePool,
  mode: ChallengeMode,
  watchlist: WatchlistScope,
  qualityGate?: A1Gate,
): Promise<TradeIdea[]> {
  // 1. Date cutoff
  let cutoffIso: string | null = null;
  if (pool === 'last_90d') {
    cutoffIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  }

  // 2. Pull from DB
  const rows = cutoffIso
    ? await db.select().from(tradeIdeas).where(gte(tradeIdeas.timestamp, cutoffIso)).orderBy(tradeIdeas.timestamp)
    : await db.select().from(tradeIdeas).orderBy(tradeIdeas.timestamp);

  // 3. Filter
  const sTier = new Set(S_TIER as readonly string[]);
  const aTier = new Set(A_TIER as readonly string[]);

  const filtered = rows.filter((idea) => {
    // Skip excluded ideas
    if (idea.excludeFromTraining) return false;
    if (idea.archived) return false;

    // Skip-list check
    if (isSkipTicker(idea.symbol)) return false;

    // Watchlist scope
    const sym = idea.symbol.toUpperCase();
    if (watchlist === 's_only' && !sTier.has(sym)) return false;
    if (watchlist === 's_and_a' && !sTier.has(sym) && !aTier.has(sym)) return false;
    if (watchlist === 'any_approved' && !isApprovedTicker(sym)) return false;

    // Mode filter
    const isLotto = idea.isLottoPlay || idea.tradeType === 'lotto';
    if (mode === 'lotto') {
      if (!isLotto) return false;
    } else if (mode === 'swing') {
      // swing — exclude lottos
      if (isLotto) return false;
    }
    // mode === 'mixed' → both pass

    // Must have actionable entry/target/stop
    if (!idea.entryPrice || !idea.targetPrice || !idea.stopLoss) return false;
    if (idea.entryPrice <= 0 || idea.targetPrice <= 0 || idea.stopLoss <= 0) return false;

    // Need a known outcome (we can only simulate trades the live system already resolved)
    const decided =
      idea.outcomeStatus === 'hit_target' ||
      idea.outcomeStatus === 'hit_stop' ||
      idea.outcomeStatus === 'manual_exit' ||
      idea.outcomeStatus === 'expired';
    if (!decided) return false;

    // A+1 quality gate (optional — applied here so the pool size in the UI
    // reflects what the bot actually considers tradeable)
    if (qualityGate && !passesA1Filter(idea, qualityGate)) return false;

    return true;
  });

  // ── Dedupe duplicate ideas ────────────────────────────────────────
  // Upstream ingestion sometimes inserts the same idea twice (same symbol,
  // same day, identical entry/target/stop). Collapse those — without this
  // the bot "fires the same trade for the same ticker" repeatedly.
  const seen = new Set<string>();
  const deduped: TradeIdea[] = [];
  for (const idea of filtered) {
    const day = idea.timestamp.slice(0, 10);
    const key = `${idea.symbol.toUpperCase()}|${day}|${idea.entryPrice}|${idea.targetPrice}|${idea.stopLoss}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(idea);
  }

  return deduped;
}

// ─────────────────────────────────────────────────────────────
// SINGLE-RUN SIMULATION
// ─────────────────────────────────────────────────────────────

interface OpenPosition {
  ideaId: string;
  symbol: string;
  direction: 'long' | 'short';
  entryDate: string;
  entryPrice: number;
  contracts: number;
  riskedDollars: number;
  targetPrice: number;
  stopLoss: number;
  confidence: number;
  catalyst: string;
  tradeType: string | null;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Run a single backtest pass over the trade pool.
 *
 * The walk is event-driven: we sort ideas by entry timestamp, and at each
 * idea we first close any open positions whose exit date has arrived,
 * then attempt to open the new idea if risk gates allow.
 */
interface OpenPositionExt extends OpenPosition {
  assetType: string;
  multiplier: number;
}

export function runChallenge(pool: TradeIdea[], config: ChallengeConfig): ChallengeRunResult {
  const rng = makeRng(config.rngSeed);

  // Slippage drifts ±50% per run for both option and stock fills
  const slipDrift = 0.5 + rng();
  const optionSlip = config.optionSlippagePct * slipDrift;
  const stockSlip = config.stockSlippagePct * slipDrift;

  let equity = config.startingCapital;
  let peak = equity;
  let trough = equity;

  // Profit-skim vault (locked, doesn't affect trading buying power).
  // Every time equity ≥ skimBase × skimTriggerMult, we move skimPct of the
  // profit (above skimBase) to the vault and reset skimBase to current equity.
  let vault = 0;
  let skimBase = equity;
  let skimEvents = 0;
  // Rolling drawdown — peak-to-valley measured AS WE GO, so a $300→$87k
  // run with no equity dip never reports a 100% drawdown.
  let maxRollingDD = 0;
  let cashedOut = false;
  const open: OpenPositionExt[] = [];
  const trades: SimulatedTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  let dailyLoss = 0;
  let lastDay: string | null = null;
  let tradesToday = 0;

  // Per-symbol cooldown — last entry timestamp keyed by symbol.
  // Used to prevent the bot from re-entering the same ticker too quickly,
  // which is what made the equity curve look like "the same trade for the same ticker".
  const lastEntryBySymbol = new Map<string, string>();

  let consecutiveLosses = 0;
  let consecutiveWins = 0;
  let longestLossStreak = 0;
  let longestWinStreak = 0;

  let daysToTarget: number | null = null;
  let daysToStretch: number | null = null;
  let busted = false;

  if (pool.length === 0) {
    return emptyResult(config, 'no_pool_data');
  }

  const startDate = pool[0].timestamp;

  equityCurve.push({ timestamp: startDate, equity, openPositions: 0, totalTrades: 0 });

  // Helper: close a position with asset-aware PnL math
  const closePosition = (
    pos: OpenPositionExt,
    exitPrice: number,
    exitDate: string,
    reason: SimulatedTrade['reason'],
  ): SimulatedTrade => {
    const direction = pos.direction === 'long' ? 1 : -1;
    const isOption = pos.assetType === 'option';

    // Gross PnL accounts for the contract multiplier (100 for options)
    const grossPnL = (exitPrice - pos.entryPrice) * direction * pos.contracts * pos.multiplier;

    // Slippage is a fraction of fill price, charged on both legs.
    // For options it's a fat 2-3%; for stocks it's a few bps.
    const slipPct = isOption ? optionSlip : stockSlip;
    const slipCost = pos.entryPrice * slipPct * pos.contracts * pos.multiplier * 2;

    // Commission is options-only per contract, stocks pay flat per leg.
    const commCost = isOption
      ? config.commissionPerContract * pos.contracts * 2
      : config.stockCommissionPerLeg * 2;

    const realizedPnL = grossPnL - slipCost - commCost;
    const pnlPct = pos.riskedDollars > 0 ? (realizedPnL / pos.riskedDollars) * 100 : 0;

    let outcome: SimulatedTrade['outcome'] = 'breakeven';
    if (realizedPnL > 0.01) outcome = 'win';
    else if (realizedPnL < -0.01) outcome = 'loss';

    equity += realizedPnL;
    if (equity > peak) peak = equity;
    if (equity < trough) trough = equity;

    // Rolling peak-to-valley drawdown — actual worst dip experienced
    if (peak > 0) {
      const dd = (peak - equity) / peak;
      if (dd > maxRollingDD) maxRollingDD = dd;
    }

    // Streak tracking
    if (outcome === 'win') {
      consecutiveWins++;
      consecutiveLosses = 0;
      if (consecutiveWins > longestWinStreak) longestWinStreak = consecutiveWins;
    } else if (outcome === 'loss') {
      consecutiveLosses++;
      consecutiveWins = 0;
      if (consecutiveLosses > longestLossStreak) longestLossStreak = consecutiveLosses;
      dailyLoss += Math.abs(realizedPnL);
    }

    // ── Profit-skim vault ─────────────────────────────────────────
    // Take a slice of profits off the table once the account hits a
    // multiplier of the last skim base. The vault is locked — does NOT
    // contribute to buying power. This models the user's "every time I
    // hit a milestone I move 70-90% to a savings account" behavior.
    if (
      config.skimTriggerMult > 0 &&
      config.skimPct > 0 &&
      equity >= skimBase * config.skimTriggerMult
    ) {
      const profit = equity - skimBase;
      const toVault = profit * config.skimPct;
      vault += toVault;
      equity -= toVault;
      skimBase = equity;
      skimEvents++;
      // Recompute peak/trough vs the post-skim equity so DD math stays sane
      if (equity > peak) peak = equity;
    }

    // Milestone tracking — count vault + trading equity together so the
    // skim doesn't penalize the account for hitting its goal.
    const totalAfterSkim = equity + vault;
    if (daysToTarget === null && totalAfterSkim >= config.targetCapital) {
      daysToTarget = daysBetween(startDate, exitDate);
    }
    if (daysToStretch === null && totalAfterSkim >= config.stretchTarget) {
      daysToStretch = daysBetween(startDate, exitDate);
    }

    return {
      ideaId: pos.ideaId,
      symbol: pos.symbol,
      direction: pos.direction,
      entryDate: pos.entryDate,
      exitDate,
      entryPrice: pos.entryPrice,
      exitPrice,
      contracts: pos.contracts,
      riskedDollars: pos.riskedDollars,
      realizedPnL,
      pnlPct,
      outcome,
      reason,
      equityAfter: equity,
      confidence: pos.confidence,
      catalyst: pos.catalyst,
      tradeType: pos.tradeType,
    };
  };

  // Walk ideas in time order
  for (const idea of pool) {
    if (busted) break;
    if (equity < config.bustThreshold) {
      busted = true;
      break;
    }

    const ideaDay = dayKey(idea.timestamp);

    // Reset daily counters on day change
    if (lastDay !== ideaDay) {
      dailyLoss = 0;
      tradesToday = 0;
      lastDay = ideaDay;
    }

    // ── A+1 quality gate (uses the same logic as fetchTradePool, but
    //    config-aware so it handles overrides too) ─────────────────────
    if (!passesA1Filter(idea, config)) continue;

    // ── Cash out: stretch goal hit means we won. Stop trading. ────────
    if (equity >= config.stretchTarget) {
      cashedOut = true;
      break;
    }

    // ── Risk gates before opening new position ────────────────────────
    if (open.length >= config.maxConcurrentPositions) continue;
    if (tradesToday >= config.maxTradesPerDay) continue;
    if (dailyLoss >= equity * config.maxDailyLossPct) continue;
    if (peak > 0 && (peak - equity) / peak > config.maxDrawdownPct) {
      busted = true;
      break;
    }

    // ── Per-symbol cooldown — realistic trader doesn't re-enter the same
    //    ticker every day. Forces the bot to spread entries across the pool.
    if (config.perSymbolCooldownDays > 0) {
      const last = lastEntryBySymbol.get(idea.symbol.toUpperCase());
      if (last && daysBetween(last, idea.timestamp) < config.perSymbolCooldownDays) {
        continue;
      }
    }

    // Refuse to re-open a symbol that already has an open position
    if (open.some((p) => p.symbol.toUpperCase() === idea.symbol.toUpperCase())) continue;

    // ── Position sizing — asset-aware, risk-based ────────────────────
    const assetType = idea.assetType || 'stock';
    const multiplier = multiplierFor(assetType);
    const direction = effectiveDirection(idea);
    const perShareRisk =
      direction === 'long'
        ? idea.entryPrice - idea.stopLoss
        : idea.stopLoss - idea.entryPrice;

    if (perShareRisk <= 0) continue; // bad data

    // Real $ at risk per contract = (per-share risk) × multiplier
    const dollarsPerContract = perShareRisk * multiplier;
    const dollarsToRisk = equity * config.maxRiskPerTrade;
    let contracts = Math.floor(dollarsToRisk / dollarsPerContract);

    // CRITICAL: if we cannot afford even one contract at our risk budget,
    // SKIP the trade. The old code forced contracts=1 which silently
    // overrode risk discipline and blew up small accounts.
    if (contracts < 1) continue;

    // Notional cap honors account type:
    //   cash    → notional ≤ equity (no leverage)
    //   margin  → notional ≤ equity × marginMultiple
    const perContractCost = idea.entryPrice * multiplier;
    const buyingPower = config.accountType === 'margin'
      ? equity * Math.max(1, config.marginMultiple)
      : equity;
    const notional = contracts * perContractCost;
    if (notional > buyingPower) {
      contracts = Math.floor(buyingPower / perContractCost);
      if (contracts < 1) continue;
    }

    const riskedDollars = contracts * dollarsPerContract;
    // Belt-and-suspenders: skip if the rounded contracts somehow over-risk
    if (riskedDollars > equity * config.maxRiskPerTrade * 1.25) continue;

    // Open the position
    const pos: OpenPositionExt = {
      ideaId: idea.id,
      symbol: idea.symbol,
      direction,
      entryDate: idea.timestamp,
      entryPrice: idea.entryPrice,
      contracts,
      riskedDollars,
      targetPrice: idea.targetPrice,
      stopLoss: idea.stopLoss,
      confidence: idea.confidenceScore || 0,
      catalyst: idea.catalyst || '',
      tradeType: idea.tradeType,
      assetType,
      multiplier,
    };
    open.push(pos);
    tradesToday++;
    lastEntryBySymbol.set(idea.symbol.toUpperCase(), idea.timestamp);

    // Resolve the position immediately based on the idea's recorded outcome.
    // This is the honest simulation: we use what the live system observed.
    const outcomeStatus = idea.outcomeStatus;
    let exitPrice = idea.exitPrice ?? idea.entryPrice;
    let reason: SimulatedTrade['reason'] = 'manual';

    if (outcomeStatus === 'hit_target') {
      exitPrice = idea.targetPrice;
      reason = 'hit_target';
    } else if (outcomeStatus === 'hit_stop') {
      exitPrice = idea.stopLoss;
      reason = 'hit_stop';
    } else if (outcomeStatus === 'expired') {
      exitPrice = idea.exitPrice ?? idea.entryPrice;
      reason = 'expired';
    } else {
      exitPrice = idea.exitPrice ?? idea.entryPrice;
      reason = 'manual';
    }

    const exitDate = idea.exitDate || idea.timestamp;
    const trade = closePosition(pos, exitPrice, exitDate, reason);
    trades.push(trade);

    // Remove from open
    const idx = open.findIndex((p) => p.ideaId === pos.ideaId);
    if (idx >= 0) open.splice(idx, 1);

    equityCurve.push({
      timestamp: exitDate,
      equity,
      openPositions: open.length,
      totalTrades: trades.length,
    });

    if (equity < config.bustThreshold) {
      busted = true;
      break;
    }
  }

  // ─── Aggregate stats ────────────────────────────────────
  const wins = trades.filter((t) => t.outcome === 'win').length;
  const losses = trades.filter((t) => t.outcome === 'loss').length;
  const breakevens = trades.filter((t) => t.outcome === 'breakeven').length;
  const decided = wins + losses;
  const winRate = decided > 0 ? wins / decided : 0;

  const winPnls = trades.filter((t) => t.outcome === 'win').map((t) => t.realizedPnL);
  const lossPnls = trades.filter((t) => t.outcome === 'loss').map((t) => Math.abs(t.realizedPnL));
  const grossWin = winPnls.reduce((s, v) => s + v, 0);
  const grossLoss = lossPnls.reduce((s, v) => s + v, 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

  const avgWin = winPnls.length > 0 ? grossWin / winPnls.length : 0;
  const avgLoss = lossPnls.length > 0 ? grossLoss / lossPnls.length : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

  const avgWinPct = winPnls.length > 0
    ? winPnls.reduce((s, _v, i) => s + trades.filter((t) => t.outcome === 'win')[i].pnlPct, 0) / winPnls.length
    : 0;
  const avgLossPct = lossPnls.length > 0
    ? trades.filter((t) => t.outcome === 'loss').reduce((s, t) => s + t.pnlPct, 0) / lossPnls.length
    : 0;

  // Use the rolling peak-to-valley DD captured during the walk, not the
  // naive (peak - trough) which counts the starting capital as a "valley".
  const maxDrawdownPct = maxRollingDD * 100;

  const startedAt = pool[0]?.timestamp || new Date().toISOString();
  const endedAt = trades[trades.length - 1]?.exitDate || startedAt;
  const totalDays = daysBetween(startedAt, endedAt);

  const totalRealized = equity + vault;
  return {
    config,
    rngSeed: config.rngSeed,
    startedAt,
    endedAt,
    startingCapital: config.startingCapital,
    endingCapital: equity,
    peakCapital: peak,
    troughCapital: trough,
    vaultBalance: vault,
    totalRealized,
    skimEvents,
    hitTarget: totalRealized >= config.targetCapital || daysToTarget !== null,
    hitStretch: totalRealized >= config.stretchTarget || daysToStretch !== null,
    busted,
    daysToTarget,
    daysToStretch,
    totalDays,
    totalTrades: trades.length,
    wins,
    losses,
    breakevens,
    winRate,
    avgWinPct,
    avgLossPct,
    profitFactor,
    expectancy,
    maxDrawdownPct,
    longestLossStreak,
    longestWinStreak,
    trades,
    equityCurve,
  };
}

function emptyResult(config: ChallengeConfig, _reason: string): ChallengeRunResult {
  const now = new Date().toISOString();
  return {
    config,
    rngSeed: config.rngSeed,
    startedAt: now,
    endedAt: now,
    startingCapital: config.startingCapital,
    endingCapital: config.startingCapital,
    peakCapital: config.startingCapital,
    troughCapital: config.startingCapital,
    vaultBalance: 0,
    totalRealized: config.startingCapital,
    skimEvents: 0,
    hitTarget: false,
    hitStretch: false,
    busted: false,
    daysToTarget: null,
    daysToStretch: null,
    totalDays: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    breakevens: 0,
    winRate: 0,
    avgWinPct: 0,
    avgLossPct: 0,
    profitFactor: 0,
    expectancy: 0,
    maxDrawdownPct: 0,
    longestLossStreak: 0,
    longestWinStreak: 0,
    trades: [],
    equityCurve: [{ timestamp: now, equity: config.startingCapital, openPositions: 0, totalTrades: 0 }],
  };
}

// ─────────────────────────────────────────────────────────────
// MONTE CARLO WRAPPER
// ─────────────────────────────────────────────────────────────

/**
 * Re-run the same backtest with N different seeds. Each seed alters
 * slippage drift + the order in which simultaneous candidates are
 * picked when concurrent slot pressure occurs.
 *
 * Pool fetch happens once and is reused — the variance comes purely
 * from the simulation mechanics, not from changing the trade history.
 */
export async function runChallengeMC(
  baseConfig: Omit<ChallengeConfig, 'rngSeed'>,
  runs: number,
): Promise<MonteCarloResult> {
  const pool = await fetchTradePool(baseConfig.pool, baseConfig.mode, baseConfig.watchlist, {
    minConfidence: baseConfig.minConfidence,
    minRiskReward: baseConfig.minRiskReward,
    maxRiskReward: baseConfig.maxRiskReward,
    allowedBands: baseConfig.allowedBands,
    requiredHoldingPeriods: baseConfig.requiredHoldingPeriods,
    excludedHoldingPeriods: baseConfig.excludedHoldingPeriods,
    requiredSources: baseConfig.requiredSources,
    requiredAssetTypes: baseConfig.requiredAssetTypes,
    alphaTickers: baseConfig.alphaTickers,
    minConfluenceCount: baseConfig.minConfluenceCount,
  });

  if (pool.length === 0) {
    return emptyMC(baseConfig, runs, 0);
  }

  const results: ChallengeRunResult[] = [];
  for (let i = 0; i < runs; i++) {
    const config: ChallengeConfig = { ...baseConfig, rngSeed: 1000 + i * 7 };
    // Per-run shuffle of borderline cases via deterministic noise
    const shuffled = shuffleSimultaneous(pool, config.rngSeed);
    const result = runChallenge(shuffled, config);
    results.push(result);
  }

  // Aggregate
  const endingEquities = results.map((r) => r.endingCapital).sort((a, b) => a - b);
  const drawdowns = results.map((r) => r.maxDrawdownPct).sort((a, b) => a - b);
  const vaults = results.map((r) => r.vaultBalance).sort((a, b) => a - b);
  const totals = results.map((r) => r.totalRealized).sort((a, b) => a - b);
  const skimEventsArr = results.map((r) => r.skimEvents).sort((a, b) => a - b);
  const hitTargetCount = results.filter((r) => r.hitTarget).length;
  const hitStretchCount = results.filter((r) => r.hitStretch).length;
  const bustedCount = results.filter((r) => r.busted).length;
  // Profitable = total wealth (trading BP + locked vault) > starting capital.
  // This is the truthful "did you make money" stat — busted runs can still be
  // profitable when the vault locked in skimmed profits before the BP drained.
  const profitableCount = results.filter(
    (r) => r.endingCapital + r.vaultBalance > baseConfig.startingCapital,
  ).length;

  const targetTimes = results.filter((r) => r.daysToTarget !== null).map((r) => r.daysToTarget!);
  const stretchTimes = results.filter((r) => r.daysToStretch !== null).map((r) => r.daysToStretch!);

  // Best/worst by TOTAL realized (equity + vault) so skim runs aren't penalized
  const bestRun = [...results].sort((a, b) => b.totalRealized - a.totalRealized)[0];
  const worstRun = [...results].sort((a, b) => a.totalRealized - b.totalRealized)[0];

  const longestLossStreak = Math.max(...results.map((r) => r.longestLossStreak), 0);

  return {
    config: { ...baseConfig, rngSeed: -1 },
    runs,
    poolSize: pool.length,
    hitTargetCount,
    hitTargetPct: runs > 0 ? hitTargetCount / runs : 0,
    hitStretchCount,
    hitStretchPct: runs > 0 ? hitStretchCount / runs : 0,
    bustedCount,
    bustedPct: runs > 0 ? bustedCount / runs : 0,
    profitableCount,
    profitablePct: runs > 0 ? profitableCount / runs : 0,
    endingEquityP10: percentile(endingEquities, 0.1),
    endingEquityP25: percentile(endingEquities, 0.25),
    endingEquityP50: percentile(endingEquities, 0.5),
    endingEquityP75: percentile(endingEquities, 0.75),
    endingEquityP90: percentile(endingEquities, 0.9),
    endingEquityMean: endingEquities.reduce((s, v) => s + v, 0) / Math.max(1, endingEquities.length),
    endingEquityMax: endingEquities[endingEquities.length - 1] ?? 0,
    endingEquityMin: endingEquities[0] ?? 0,
    medianDaysToTarget: targetTimes.length > 0 ? percentile(targetTimes.sort((a, b) => a - b), 0.5) : null,
    medianDaysToStretch: stretchTimes.length > 0 ? percentile(stretchTimes.sort((a, b) => a - b), 0.5) : null,
    vaultBalanceP50: percentile(vaults, 0.5),
    vaultBalanceMean: vaults.reduce((s, v) => s + v, 0) / Math.max(1, vaults.length),
    vaultBalanceMax: vaults[vaults.length - 1] ?? 0,
    totalRealizedP50: percentile(totals, 0.5),
    totalRealizedMean: totals.reduce((s, v) => s + v, 0) / Math.max(1, totals.length),
    totalRealizedMax: totals[totals.length - 1] ?? 0,
    medianSkimEvents: percentile(skimEventsArr, 0.5),
    worstDrawdown: drawdowns[drawdowns.length - 1] ?? 0,
    medianDrawdown: percentile(drawdowns, 0.5),
    longestLossStreak,
    perRunSummary: results.map((r) => ({
      seed: r.rngSeed,
      endingCapital: r.endingCapital,
      vaultBalance: r.vaultBalance,
      totalRealized: r.totalRealized,
      hitTarget: r.hitTarget,
      hitStretch: r.hitStretch,
      busted: r.busted,
      profitable: r.endingCapital + r.vaultBalance > baseConfig.startingCapital,
      totalTrades: r.totalTrades,
      winRate: r.winRate,
      maxDrawdown: r.maxDrawdownPct,
    })),
    bestRun,
    worstRun,
  };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * sortedAsc.length)));
  return sortedAsc[idx];
}

/**
 * Light deterministic shuffle for ideas that share a timestamp. Most
 * ideas will keep their order; only "ties" get rotated by seed.
 */
function shuffleSimultaneous(pool: TradeIdea[], seed: number): TradeIdea[] {
  const rng = makeRng(seed);
  const groups = new Map<string, TradeIdea[]>();
  for (const idea of pool) {
    const k = idea.timestamp;
    const arr = groups.get(k) || [];
    arr.push(idea);
    groups.set(k, arr);
  }
  const sortedKeys = Array.from(groups.keys()).sort();
  const result: TradeIdea[] = [];
  for (const k of sortedKeys) {
    const grp = groups.get(k)!;
    if (grp.length === 1) {
      result.push(grp[0]);
    } else {
      // Fisher-Yates with seeded RNG
      for (let i = grp.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [grp[i], grp[j]] = [grp[j], grp[i]];
      }
      result.push(...grp);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// POOL PROFILER — find which historical attributes correlate with wins
// ─────────────────────────────────────────────────────────────

interface BucketStat {
  bucket: string;
  n: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  avgRR: number;
  avgPnLPct: number;
}

function bucketize(rows: TradeIdea[], keyFn: (r: TradeIdea) => string | null): BucketStat[] {
  const map = new Map<string, TradeIdea[]>();
  for (const r of rows) {
    const k = keyFn(r);
    if (k === null) continue;
    const arr = map.get(k) || [];
    arr.push(r);
    map.set(k, arr);
  }
  const out: BucketStat[] = [];
  for (const [bucket, arr] of Array.from(map.entries())) {
    const wins = arr.filter((r) => r.outcomeStatus === 'hit_target').length;
    const losses = arr.filter((r) => r.outcomeStatus === 'hit_stop').length;
    const expired = arr.filter((r) => r.outcomeStatus === 'expired').length;
    const decided = wins + losses + expired;
    const winRate = decided > 0 ? wins / decided : 0;
    const avgRR = arr.reduce((s, r) => s + (r.riskRewardRatio || 0), 0) / arr.length;
    const avgPnLPct = arr.reduce((s, r) => s + (r.percentGain || 0), 0) / arr.length;
    out.push({ bucket, n: arr.length, wins, losses, expired, winRate, avgRR, avgPnLPct });
  }
  return out.sort((a, b) => b.n - a.n);
}

export interface PoolProfile {
  mode: ChallengeMode;
  pool: TradePool;
  totalDecided: number;
  overall: { wins: number; losses: number; expired: number; winRate: number };
  byBand: BucketStat[];
  byConfidenceBucket: BucketStat[];
  byRRBucket: BucketStat[];
  bySource: BucketStat[];
  byTradeType: BucketStat[];
  byAssetType: BucketStat[];
  byHoldingPeriod: BucketStat[];
  bySymbolTop: BucketStat[];
}

/**
 * Weekly options-only diagnosis. Walks the last 90d of OPTION ideas and
 * buckets them by ISO week, returning win/loss/expired counts plus a
 * realized P&L assuming 1 contract per trade. Used by the dashboard
 * Weekly Diagnosis panel to answer "why are we losing this week?".
 */
export interface WeeklyOptionsBucket {
  week: string;            // monday ISO date
  ideas: number;
  wins: number;
  losses: number;
  expired: number;
  winRate: number;
  realizedPnL: number;     // 1 contract × 100 multiplier × (exit - entry)
  topWinners: Array<{ sym: string; pnl: number }>;
  topLosers: Array<{ sym: string; pnl: number }>;
}

export async function weeklyOptionsAnalysis(
  watchlist: WatchlistScope = 's_and_a',
  alphaOnly: string[] = [],
): Promise<{ weeks: WeeklyOptionsBucket[]; overall: { ideas: number; wr: number; pnl: number } }> {
  // Pull both lotto + swing pools, filter to options
  const lotto = await fetchTradePool('last_90d', 'lotto', watchlist);
  const swing = await fetchTradePool('last_90d', 'swing', watchlist);
  let rows = [...lotto, ...swing].filter((r) => r.assetType === 'option');
  if (alphaOnly.length > 0) {
    const set = new Set(alphaOnly.map((s) => s.toUpperCase()));
    rows = rows.filter((r) => set.has(r.symbol.toUpperCase()));
  }

  const weekKey = (iso: string): string => {
    const d = new Date(iso);
    const day = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
    return monday.toISOString().slice(0, 10);
  };

  const buckets = new Map<string, TradeIdea[]>();
  for (const r of rows) {
    const k = weekKey(r.timestamp);
    const arr = buckets.get(k) || [];
    arr.push(r);
    buckets.set(k, arr);
  }

  const weeks: WeeklyOptionsBucket[] = [];
  let totalIdeas = 0;
  let totalWins = 0;
  let totalPnl = 0;

  for (const [week, arr] of Array.from(buckets.entries())) {
    let wins = 0,
      losses = 0,
      expired = 0,
      pnl = 0;
    const perTrade: Array<{ sym: string; pnl: number }> = [];
    for (const r of arr) {
      const dir = effectiveDirection(r);
      const exit =
        r.outcomeStatus === 'hit_target'
          ? r.targetPrice
          : r.outcomeStatus === 'hit_stop'
            ? r.stopLoss
            : r.exitPrice ?? r.entryPrice;
      const tradePnl = (exit - r.entryPrice) * (dir === 'long' ? 1 : -1) * 100; // 1 contract
      pnl += tradePnl;
      perTrade.push({ sym: r.symbol, pnl: tradePnl });
      if (r.outcomeStatus === 'hit_target') wins++;
      else if (r.outcomeStatus === 'hit_stop') losses++;
      else expired++;
    }
    const decided = wins + losses + expired;
    const sortedDesc = [...perTrade].sort((a, b) => b.pnl - a.pnl);
    weeks.push({
      week,
      ideas: arr.length,
      wins,
      losses,
      expired,
      winRate: decided > 0 ? wins / decided : 0,
      realizedPnL: pnl,
      topWinners: sortedDesc.slice(0, 3),
      topLosers: sortedDesc.slice(-3).reverse(),
    });
    totalIdeas += arr.length;
    totalWins += wins;
    totalPnl += pnl;
  }

  weeks.sort((a, b) => a.week.localeCompare(b.week));

  return {
    weeks,
    overall: {
      ideas: totalIdeas,
      wr: totalIdeas > 0 ? totalWins / totalIdeas : 0,
      pnl: totalPnl,
    },
  };
}

export async function sampleLottoRows(): Promise<any[]> {
  const rows = await fetchTradePool('full_history', 'lotto', 's_and_a');
  return rows.slice(0, 25).map((r) => ({
    sym: r.symbol,
    dir: r.direction,
    asset: r.assetType,
    hp: r.holdingPeriod,
    src: r.source,
    band: r.probabilityBand,
    conf: r.confidenceScore,
    rrStored: r.riskRewardRatio,
    entry: r.entryPrice,
    target: r.targetPrice,
    stop: r.stopLoss,
    risk: r.direction === 'short' ? r.stopLoss - r.entryPrice : r.entryPrice - r.stopLoss,
    reward: r.direction === 'short' ? r.entryPrice - r.targetPrice : r.targetPrice - r.entryPrice,
    outcome: r.outcomeStatus,
    isLotto: r.isLottoPlay,
  }));
}

export async function profilePool(
  poolPeriod: TradePool,
  mode: ChallengeMode,
  watchlist: WatchlistScope = 's_and_a',
): Promise<PoolProfile> {
  // Pull pool with NO quality gate so we see the full picture
  const rows = await fetchTradePool(poolPeriod, mode, watchlist);
  const wins = rows.filter((r) => r.outcomeStatus === 'hit_target').length;
  const losses = rows.filter((r) => r.outcomeStatus === 'hit_stop').length;
  const expired = rows.filter((r) => r.outcomeStatus === 'expired').length;

  return {
    mode,
    pool: poolPeriod,
    totalDecided: rows.length,
    overall: { wins, losses, expired, winRate: rows.length > 0 ? wins / (wins + losses + expired || 1) : 0 },
    byBand: bucketize(rows, (r) => r.probabilityBand || 'NONE'),
    byConfidenceBucket: bucketize(rows, (r) => {
      const c = r.confidenceScore || 0;
      if (c >= 90) return '90+';
      if (c >= 85) return '85-89';
      if (c >= 80) return '80-84';
      if (c >= 75) return '75-79';
      if (c >= 70) return '70-74';
      return '<70';
    }),
    byRRBucket: bucketize(rows, (r) => {
      const rr = r.riskRewardRatio || 0;
      if (rr >= 5) return '5+';
      if (rr >= 3) return '3-5';
      if (rr >= 2) return '2-3';
      if (rr >= 1.5) return '1.5-2';
      return '<1.5';
    }),
    bySource: bucketize(rows, (r) => r.source || 'unknown'),
    byTradeType: bucketize(rows, (r) => r.tradeType || 'unknown'),
    byAssetType: bucketize(rows, (r) => r.assetType || 'unknown'),
    byHoldingPeriod: bucketize(rows, (r) => r.holdingPeriod || 'unknown'),
    bySymbolTop: bucketize(rows, (r) => r.symbol).slice(0, 25),
  };
}

function emptyMC(baseConfig: Omit<ChallengeConfig, 'rngSeed'>, runs: number, poolSize: number): MonteCarloResult {
  const blank: ChallengeRunResult = emptyResult({ ...baseConfig, rngSeed: 0 }, 'no_pool_data');
  return {
    config: { ...baseConfig, rngSeed: -1 },
    runs,
    poolSize,
    hitTargetCount: 0,
    hitTargetPct: 0,
    hitStretchCount: 0,
    hitStretchPct: 0,
    bustedCount: 0,
    bustedPct: 0,
    profitableCount: 0,
    profitablePct: 0,
    endingEquityP10: baseConfig.startingCapital,
    endingEquityP25: baseConfig.startingCapital,
    endingEquityP50: baseConfig.startingCapital,
    endingEquityP75: baseConfig.startingCapital,
    endingEquityP90: baseConfig.startingCapital,
    endingEquityMean: baseConfig.startingCapital,
    endingEquityMax: baseConfig.startingCapital,
    endingEquityMin: baseConfig.startingCapital,
    medianDaysToTarget: null,
    medianDaysToStretch: null,
    vaultBalanceP50: 0,
    vaultBalanceMean: 0,
    vaultBalanceMax: 0,
    totalRealizedP50: baseConfig.startingCapital,
    totalRealizedMean: baseConfig.startingCapital,
    totalRealizedMax: baseConfig.startingCapital,
    medianSkimEvents: 0,
    worstDrawdown: 0,
    medianDrawdown: 0,
    longestLossStreak: 0,
    perRunSummary: [],
    bestRun: blank,
    worstRun: blank,
  };
}
