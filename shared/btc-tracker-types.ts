/**
 * BTC BETA TRACKER — Shared Types
 * =================================
 * The "easy money printer" — tracks BTC price/momentum/key-level breaks and
 * fires call/put alerts on BTC-correlated stocks (MSTR, COIN, MARA, RIOT,
 * CRCL, CLSK, HUT, BITF, IREN, WULF, BLOCK, GLXY).
 *
 * Math:
 *   beta(stock, BTC) = Cov(stock_returns, BTC_returns) / Var(BTC_returns)
 *
 * Patterns detected:
 *   1. BTC Breakout — Long highest-beta names with weekly calls
 *   2. BTC Breakdown — Long puts on highest-beta names
 *   3. BTC Divergence — Mean-reversion play on lagging name
 *   4. Volatility Regime Shift — IV crush opportunity (covered calls)
 *
 * Each detected signal converts to UniversalIdeaInput and pushes to Trade Desk.
 */

import type { ExtendedGrade, SignalScore } from './thesis-radar-types';

// ─── BTC State ──────────────────────────────────────────────────────

export interface BTCState {
  /** Latest BTC spot in USD */
  price: number;
  /** Last update timestamp (ISO) */
  timestamp: string;
  /** 24h change % */
  change24h: number;
  /** 1h change % */
  change1h: number;
  /** 30-day realized volatility (annualized %) */
  realizedVol30d: number;
  /** Recent levels — auto-detected pivots */
  resistance: number[];
  support: number[];
  /** Most recent break in the last 24h */
  recentBreak: 'resistance' | 'support' | null;
  /** Strength of the break 0-100 (volume + momentum confirmation) */
  breakStrength: number;
  /** What's the next nearest level? */
  nextResistance: number | null;
  nextSupport: number | null;
  /** RSI(14) on the 1H chart */
  rsi1h: number;
  /** RSI(14) on the daily */
  rsiDaily: number;
}

// ─── Per-ticker beta + alpha ────────────────────────────────────────

export interface BTCBetaPosition {
  symbol: string;
  /** Current spot */
  spot: number;
  /** 30-day rolling beta vs BTC */
  beta30d: number;
  /** 90-day rolling beta vs BTC */
  beta90d: number;
  /** R-squared on the 30d regression */
  r2: number;
  /** Today's actual price change % */
  actualMovePct: number;
  /** Predicted move based on BTC × beta */
  predictedMovePct: number;
  /** Divergence — actual minus predicted (alpha opportunity if large) */
  divergence: number;
  /** Standardized divergence (Z-score) */
  divergenceZ: number;
  /** Implied vol percentile for the underlying */
  ivPercentile?: number;
  /** Optional: short interest */
  shortInterest?: number;
}

// ─── Signal output ──────────────────────────────────────────────────

export type BTCPattern =
  | 'btc_breakout_long'        // BTC breaks resistance → long high-beta calls
  | 'btc_breakdown_short'      // BTC breaks support → long high-beta puts
  | 'btc_divergence_alpha'     // stock lagging/leading BTC → mean reversion
  | 'btc_vol_regime_shift';    // BTC vol crushing → premium-sell opportunity

export type BTCSignalDirection = 'long_call' | 'long_put' | 'short_call' | 'short_put' | 'neutral';

export interface BTCSignal {
  /** Unique signal ID */
  id: string;
  /** When fired */
  firedAt: string;
  /** Pattern that matched */
  pattern: BTCPattern;
  /** BTC state at fire time */
  btcSnapshot: BTCState;
  /** Symbol the trade idea targets */
  symbol: string;
  /** Spot at fire time */
  spotAtFire: number;
  /** Direction of the trade */
  direction: BTCSignalDirection;
  /** Recommended strike */
  suggestedStrike: number;
  /** Recommended expiry (YYYY-MM-DD) */
  suggestedExpiry: string;
  /** Recommended size in number of contracts */
  suggestedContracts: number;
  /** Estimated cost per contract in dollars */
  estimatedCost: number;
  /** Per-signal grades that build the conviction */
  signals: SignalScore[];
  /** Final composite letter grade */
  finalGrade: ExtendedGrade;
  /** Numeric composite 0-100 */
  finalScore: number;
  /** "BTC breakout +3% with MARA β 2.2 → expected +6.6% by close" */
  thesis: string;
  /** Stop / invalidation price (on the underlying stock) */
  invalidation: number;
  /** Profit targets */
  targets: { t1: number; t2?: number; t3?: number };
  /** Sell triggers (% gains at which to trim) */
  sellTriggers: { trim33At: number; trim50At: number; runnerExitAt: number };
  /** Time horizon */
  horizon: 'minutes' | 'hours' | 'days' | 'weeks';
  /** Status as the signal evolves */
  status: 'fired' | 'confirmed' | 'hit_t1' | 'hit_t2' | 'invalidated' | 'expired';
  /** Whether it's been pushed to Trade Desk */
  pushedToTradeDesk: boolean;
  /** Trade Desk idea ID if pushed */
  tradeDeskIdeaId?: string;
}

// ─── BTC universe (the names we track) ──────────────────────────────

export interface BTCUniverseTicker {
  symbol: string;
  name: string;
  category: 'treasury' | 'exchange' | 'miner' | 'miner_hpc' | 'stablecoin' | 'payments' | 'crypto_bank' | 'etf';
  /** Approximate BTC beta from historical regression (used as fallback) */
  expectedBeta: number;
  /** Whether to include in "high-beta call" suggestions */
  includeInLongScan: boolean;
  /** Whether liquid options are available */
  hasOptions: boolean;
}

export const BTC_UNIVERSE: BTCUniverseTicker[] = [
  { symbol: 'MSTR',  name: 'Strategy / MicroStrategy',  category: 'treasury',     expectedBeta: 1.8, includeInLongScan: true,  hasOptions: true },
  { symbol: 'COIN',  name: 'Coinbase Global',           category: 'exchange',     expectedBeta: 1.4, includeInLongScan: true,  hasOptions: true },
  { symbol: 'MARA',  name: 'Marathon Digital',          category: 'miner',        expectedBeta: 2.2, includeInLongScan: true,  hasOptions: true },
  { symbol: 'RIOT',  name: 'Riot Platforms',            category: 'miner',        expectedBeta: 1.9, includeInLongScan: true,  hasOptions: true },
  { symbol: 'CRCL',  name: 'Circle Internet',           category: 'stablecoin',   expectedBeta: 1.0, includeInLongScan: true,  hasOptions: true },
  { symbol: 'CLSK',  name: 'CleanSpark',                category: 'miner',        expectedBeta: 2.1, includeInLongScan: true,  hasOptions: true },
  { symbol: 'HUT',   name: 'Hut 8',                     category: 'miner_hpc',    expectedBeta: 1.6, includeInLongScan: true,  hasOptions: true },
  { symbol: 'BITF',  name: 'Bitfarms',                  category: 'miner',        expectedBeta: 2.3, includeInLongScan: true,  hasOptions: true },
  { symbol: 'IREN',  name: 'Iris Energy',               category: 'miner_hpc',    expectedBeta: 1.5, includeInLongScan: true,  hasOptions: true },
  { symbol: 'WULF',  name: 'TeraWulf',                  category: 'miner_hpc',    expectedBeta: 1.4, includeInLongScan: true,  hasOptions: true },
  { symbol: 'BTDR',  name: 'Bitdeer',                   category: 'miner_hpc',    expectedBeta: 1.7, includeInLongScan: true,  hasOptions: true },
  { symbol: 'XYZ',   name: 'Block (Square)',            category: 'payments',     expectedBeta: 0.7, includeInLongScan: true,  hasOptions: true },
  { symbol: 'GLXY',  name: 'Galaxy Digital',            category: 'crypto_bank',  expectedBeta: 1.5, includeInLongScan: true,  hasOptions: true },
  { symbol: 'IBIT',  name: 'iShares Bitcoin Trust ETF', category: 'etf',          expectedBeta: 1.0, includeInLongScan: true,  hasOptions: true },
];

// ─── Track record entry ────────────────────────────────────────────

export interface BTCTrackRecordEntry {
  signalId: string;
  pattern: BTCPattern;
  symbol: string;
  firedAt: string;
  spotAtFire: number;
  finalGrade: ExtendedGrade;
  // Resolved fields:
  resolvedAt?: string;
  outcomePrice?: number;
  outcomePct?: number;
  hitT1?: boolean;
  hitT2?: boolean;
  invalidated?: boolean;
  daysToResolve?: number;
}
