import { isOptionScaleIncoherent } from './option-unit-guard';
/**
 * Shared constants for consistent terminology across the platform
 * Use these labels everywhere instead of hardcoding strings
 */

// Engine/Source terminology - use "Engine" consistently
export const ENGINE_LABELS: Record<string, string> = {
  ai: 'AI',
  quant: 'Quant',
  hybrid: 'Hybrid',
  flow_scanner: 'Flow Scanner',
  chart_analysis: 'Chart Analysis',
  lotto_scanner: 'Lotto Scanner',
} as const;

export const ENGINE_KEYS = ['ai', 'quant', 'hybrid', 'flow_scanner', 'chart_analysis', 'lotto_scanner'] as const;
export type EngineKey = typeof ENGINE_KEYS[number];

// DEPRECATED: Legacy confidence bands - use SIGNAL_STRENGTH_BANDS instead
// These are kept for backward compatibility but should not be used for new code
export const CONFIDENCE_BANDS = {
  HIGH: { key: 'high', label: 'High', range: '70+', min: 70, max: 100 },
  MEDIUM: { key: 'medium', label: 'Medium', range: '50-69', min: 50, max: 69 },
  LOW: { key: 'low', label: 'Low', range: '<50', min: 0, max: 49 },
} as const;

// DEPRECATED: Use SIGNAL_STRENGTH_BAND_LABELS instead
export const CONFIDENCE_BAND_LABELS: Record<string, string> = {
  high: 'High (70+)',
  medium: 'Medium (50-69)',
  low: 'Low (<50)',
};

// NEW: Signal Strength band labels - based on indicator consensus, not probability
export const SIGNAL_STRENGTH_BAND_LABELS: Record<string, string> = {
  'A': 'A (5+ signals)',
  'B+': 'B+ (4 signals)',
  'B': 'B (3 signals)',
  'C+': 'C+ (2 signals)',
  'C': 'C (1 signal)',
  'D': 'D (0 signals)',
};

// DEPRECATED: Get confidence band for a given score - use getSignalStrengthBand instead
export function getConfidenceBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

// Trade outcome terminology
export const OUTCOME_LABELS = {
  win: 'Win',
  loss: 'Loss',
  pending: 'Pending',
  expired: 'Expired',
} as const;

// Asset class terminology
export const ASSET_CLASSES = {
  stock: 'Stock',
  option: 'Option',
  crypto: 'Crypto',
  futures: 'Futures',
} as const;

// Tier terminology
export const TIER_LABELS = {
  free: 'Free',
  advanced: 'Advanced',
  pro: 'Pro',
} as const;

// Performance thresholds
export const PERFORMANCE_THRESHOLDS = {
  MIN_LOSS_PERCENT: 3, // Trades must lose at least 3% to count as a loss
  MIN_WIN_PERCENT: 3,  // Trades must gain at least 3% to count as a win (for P&L method)
  WIN_RATE_GOOD: 60,
  WIN_RATE_WARNING: 45,
} as const;

/**
 * Canonical thresholds - use these instead of hardcoding values
 * Trades below these thresholds are considered "breakeven/neutral"
 */
export const CANONICAL_LOSS_THRESHOLD = PERFORMANCE_THRESHOLDS.MIN_LOSS_PERCENT;

/**
 * The clean-era baseline. On this date the stats layer's loss classifier was
 * unified with the barrier layer (a touched stop counts everywhere), the
 * engine-level short gate landed, and the gap_continuation + real-avg-volume
 * signal repairs shipped. Rates computed across this boundary mix two
 * different measurement regimes — cohort tracking starts here.
 */
export const OUTCOME_BASELINE_DATE = '2026-08-26';
export const CANONICAL_WIN_THRESHOLD = PERFORMANCE_THRESHOLDS.MIN_WIN_PERCENT;

/**
 * SAMPLE FLOOR — below this many decided trades, a rate is not reported.
 *
 * Not a style rule. `wins / decided` is defined for any decided > 0 and the
 * platform printed it at every size, which produced statements it had no
 * evidence for:
 *
 *   Auto-Lotto Bot   HIT RATE 0%   beside   TRADES 0 · W/L 0/0
 *   equities         0%            off      one decided trade
 *   gex_scanner      winRate 0     off      zero decided trades
 *   dashboard pie    Losses 100%   off      zero decided trades
 *
 * None of those engines had lost anything. Each had simply not resolved a trade
 * yet, and 0% is read as a verdict — the worst possible one — where the honest
 * statement is "not enough trades to say". Losing money on a bot you switched
 * off because it showed 0% is a real cost of a formatting decision.
 *
 * 30 is the conventional floor where a proportion's normal approximation starts
 * behaving, and it is the number canon/score.tsx already defaults CanonRate to.
 * It lives here so the client and the server cannot drift apart on it.
 *
 * The rule is only about REPORTING. Rates are still computed and stored; the
 * counts are always shown, so a small sample stays visible as a sample rather
 * than disappearing.
 */
export const MIN_REPORTABLE_SAMPLE = 30;

/**
 * A win rate, or null when the sample cannot support one.
 *
 * Returns null in two distinct cases that must not be conflated with 0%:
 *   decided === 0                    nothing has resolved — no rate exists
 *   decided < MIN_REPORTABLE_SAMPLE  too few to report, though a rate exists
 *
 * Callers render the counts either way, so the distinction survives: "0 of 0"
 * and "0 of 1" read differently even though both suppress the percentage.
 */
export function reportableRate(
  wins: number,
  decided: number,
  minSample: number = MIN_REPORTABLE_SAMPLE,
): number | null {
  if (!Number.isFinite(wins) || !Number.isFinite(decided)) return null;
  if (decided <= 0 || decided < minSample) return null;
  return Math.round((wins / decided) * 1000) / 10;
}

/**
 * UNIFIED WIN/LOSS CLASSIFICATION
 * 
 * These functions are the SINGLE SOURCE OF TRUTH for determining outcomes.
 * All endpoints, widgets, and calculations MUST use these functions.
 * 
 * CANONICAL DEFINITIONS:
 * - WIN: hit_target OR (closed with P&L >= +3%)
 * - LOSS: hit_stop (a configured stop defines the loss; stop distance varies)
 * - NEUTRAL: expired, manual_exit, breakeven (|P&L| < 3%) - excluded from win rate
 */

/**
 * Check if a trade is a "real win"
 * A trade is a win if:
 * - outcome_status = 'hit_target', OR
 * - closed with percent_gain >= +3%
 */
export function isRealWin(idea: { outcomeStatus?: string | null; percentGain?: number | null }): boolean {
  const status = (idea.outcomeStatus || '').trim().toLowerCase();
  
  // Method 1: Explicit hit_target status
  if (status === 'hit_target') return true;
  
  // Method 2: P&L-based (for trades without proper status)
  if (idea.percentGain !== null && idea.percentGain !== undefined) {
    return idea.percentGain >= CANONICAL_WIN_THRESHOLD;
  }
  
  return false;
}

/**
 * Check if a trade is a "real loss".
 * Works with any object that has outcomeStatus and percentGain properties
 * 
 * A trade is a real loss if:
 * - It hit its configured stop. A 2% stop is still a loss; applying a universal
 *   3% P&L floor was silently converting valid stopped trades into neutrals.
 * 
 * Expired trades are EXCLUDED from loss calculations (they are separate from hit_stop).
 * This matches the documented methodology in replit.md.
 */
export function isRealLoss(idea: { outcomeStatus?: string | null; percentGain?: number | null }): boolean {
  const status = (idea.outcomeStatus || '').trim().toLowerCase();
  
  // Only count hit_stop as losses - expired trades are excluded
  if (status === 'hit_stop') return true;

  // Historic rows without an outcome event can still be measured by their P&L.
  // Expired/manual statuses remain unresolved under this legacy classifier.
  return !status && idea.percentGain != null && idea.percentGain <= -CANONICAL_LOSS_THRESHOLD;
}

/**
 * Check if a trade is "neutral" (breakeven or unresolved)
 * These trades are EXCLUDED from win rate calculations
 */
export function isNeutral(idea: { outcomeStatus?: string | null; percentGain?: number | null }): boolean {
  return !isRealWin(idea) && !isRealLoss(idea);
}

/**
 * Classify a trade into win/loss/neutral
 */
export type TradeOutcome = 'win' | 'loss' | 'neutral';
/* ════════════════════════════════════════════════════════════════════════
   OUTCOME MODEL v2 — "did the thesis play out", for an options book.
   ════════════════════════════════════════════════════════════════════════

   The canonical model above answers "did the STOCK move 3% our way". That is a
   fair question for shares and the wrong one for this platform, measured:

     • 593 ideas → 43 hit_target, 66 hit_stop, 367 EXPIRED (62%), 117 open.
     • Of 377 closed trades with P&L, 280 (74%) finished between 0% and +3%.

   Under v1 those 280 are "neutral" and excluded. That is only true if you hold
   shares. Buy a 7-45 DTE contract — which is every contract this engine picks,
   since SETUP_TO_TIER caps swing at 45 DTE — and a stock that drifts +1% over a
   month is not neutral, it is most of your premium gone. v1 therefore drops the
   single most common way this book actually loses money, and only ever drops it
   in the flattering direction.

   v2 changes three things:
     1. WIN is reaching T1, not drifting +3%. T1 is where the plan says to scale
        40% and trail to entry — that is the moment the trade is de-risked, and
        it is what the profit plan is written against. T2 is upside, not thesis:
        only 12 of 377 closed trades ever travelled past +25%.
     2. TIMEOUT IS A LOSS. An expired option is -100% of premium. Calling it
        neutral hides 62% of outcomes.
     3. UNRESOLVED means still open. Nothing else.

   v1 is NOT removed. It stays the number on the marketing page until these two
   are compared on the same trades — swapping a public win rate silently is the
   kind of thing this codebase already has scar tissue about.
*/
export type OutcomeV2 = 'win' | 'loss' | 'unresolved';

export interface OutcomeV2Input {
  outcomeStatus?: string | null;
  percentGain?: number | null;
  /** Contract P&L when the idea was expressed as an option — preferred over percentGain. */
  optionPercentGain?: number | null;
  /** Below here: needed to tell a MEASURED outcome from an unmeasurable one. */
  assetType?: string | null;
  entryPrice?: number | null;
  strikePrice?: number | null;
  resolutionReason?: string | null;
}

/**
 * Reaching T1 is the win. Hitting stop or running out of time is the loss.
 * Anything still live is unresolved and belongs in neither bucket.
 */
export function classifyOutcomeV2(idea: OutcomeV2Input): OutcomeV2 {
  const status = (idea.outcomeStatus || '').trim().toLowerCase();

  // UNMEASURABLE COMES FIRST — ahead of the status check, because a status word
  // is what these rows are wrong about.
  //
  // Two populations were being laundered into wins here:
  //
  //   1. Unit-corrupted options. 18 rows recorded hit_target because premium
  //      barriers were compared against underlying spot, which made the target
  //      unreachable-to-miss. All 18 were gex_scanner, all 18 were wins, and
  //      they alone produced a live 18W/0L/100%/+1.189R on the outcome-model
  //      endpoint.
  //
  //   2. Plans that were never entered. A missed_entry row carries a real
  //      percentGain for a trade nobody took. Scoring those counted 21W/7L for
  //      positions that never existed.
  //
  // Both are 'unresolved'. That is not a hedge — it is the only true statement
  // available, and it shows up as missing coverage, which is a number you can
  // put on screen and act on.
  if (isOptionScaleIncoherent(idea)) return 'unresolved';
  if ((idea.resolutionReason || '').toLowerCase().includes('missed_entry')) return 'unresolved';

  if (status === 'hit_target') return 'win';
  if (status === 'hit_stop') return 'loss';

  // Time running out IS a result — but only when the trade was actually measured.
  //
  // Measured on this database: of 367 expired ideas, 268 carry percentGain === 0.00
  // and every one has currentPrice === null. That is not "the stock went nowhere",
  // it is a default that was never written to. Treating those as -1R losses would
  // manufacture 367 losses out of missing data and produce a 9% win rate that is
  // no more honest than the 63% it replaced — just wrong in the other direction.
  //
  // So an expiry only counts as a loss when there is a real P&L attached to it.
  // Without one it is 'unresolved', and the SIZE of that bucket is the finding:
  // this platform does not resolve most of what it publishes. That is a data
  // collection problem and no choice of definition can fix it.
  if (status === 'expired' || status === 'timeout' || status === 'closed_horizon') {
    // Judge on the CONTRACT's realised P&L and on its SIGN — not on the status word.
    //
    // "expired" here means the tracking window closed, not that the option went to
    // zero: measured values in this database run -23.2% to +18.8%, nothing near
    // -100%. So an expiry is a real outcome, but it is not automatically a loss.
    // Marking ORCL at +13.6% as a loss because of a status string would be as wrong
    // as excluding it entirely.
    //
    // Note this is a weaker "win" than hit_target — the trade made money without
    // reaching plan. The win/loss label cannot express that difference; realisedR()
    // can, which is why expectancy is the metric to lead with.
    const pnl = idea.optionPercentGain ?? idea.percentGain;
    if (pnl === null || pnl === undefined || Math.abs(pnl) <= 0.05) return 'unresolved';
    return pnl > 0 ? 'win' : 'loss';
  }

  if (status === 'open' || status === '') return 'unresolved';

  // Manually closed: judge on realised P&L, contract first where we have it.
  const pnl = idea.optionPercentGain ?? idea.percentGain;
  if (pnl === null || pnl === undefined) return 'unresolved';
  return pnl > 0 ? 'win' : 'loss';
}

/**
 * R-multiple actually realised. Win rate without R is unreadable — a 39% win rate
 * at 2.5R is profitable and an 18% one can beat a 50% one, which is exactly how
 * this platform ended up displaying three different win rates that all looked
 * plausible. Returns null when the trade has no measurable P&L rather than
 * guessing a zero, because a guessed zero drags expectancy toward the middle.
 */
export function realisedR(
  idea: OutcomeV2Input & { riskRewardRatio?: number | null },
): number | null {
  const pnl = idea.optionPercentGain ?? idea.percentGain;
  if (pnl === null || pnl === undefined) return null;

  const outcome = classifyOutcomeV2(idea);
  if (outcome === 'unresolved') return null;

  // A managed option stop is -50% of premium (PREMIUM_STOP_FRACTION), so one R on
  // the contract is half the premium. Expressing P&L against that makes a -50%
  // contract exactly -1R, which is what the position sizing already assumes.
  const ONE_R_PREMIUM_PCT = 50;
  return pnl / ONE_R_PREMIUM_PCT;
}

export function classifyTrade(idea: { outcomeStatus?: string | null; percentGain?: number | null }): TradeOutcome {
  if (isRealWin(idea)) return 'win';
  if (isRealLoss(idea)) return 'loss';
  return 'neutral';
}

/**
 * Check if a trade is a "real loss" using resolutionReason instead of outcomeStatus
 * Used by auto-resolved trade endpoints
 * 
 * A trade is a real loss if:
 * - It was auto-resolved by stop hit.
 * 
 * Expired trades are EXCLUDED from loss calculations.
 * This matches the documented methodology in replit.md.
 */
export function isRealLossByResolution(idea: { resolutionReason?: string | null; percentGain?: number | null }): boolean {
  const reason = idea.resolutionReason;
  
  // Only count stop hits as losses - expired trades are excluded
  if (reason === 'auto_stop_hit') return true;

  return !reason && idea.percentGain != null && idea.percentGain <= -CANONICAL_LOSS_THRESHOLD;
}

/**
 * Filter to current-gen engines only (exclude legacy Quant v1.x/v2.x)
 */
export function isCurrentGenEngine(idea: { engineVersion?: string | null }): boolean {
  if (!idea.engineVersion) {
    return true;
  }
  
  const version = idea.engineVersion.toLowerCase();
  if (version.startsWith('v3.')) return true;
  if (version.startsWith('flow_')) return true;
  if (version.startsWith('hybrid_')) return true;
  if (version.startsWith('ai_')) return true;
  
  return false;
}

// Engine colors for consistent styling
export const ENGINE_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  ai: { border: 'border-amber-500/50', text: 'text-amber-400', bg: 'bg-amber-500/10' },
  quant: { border: 'border-cyan-500/50', text: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  hybrid: { border: 'border-purple-500/50', text: 'text-purple-400', bg: 'bg-purple-500/10' },
  flow_scanner: { border: 'border-green-500/50', text: 'text-green-400', bg: 'bg-green-500/10' },
  chart_analysis: { border: 'border-blue-500/50', text: 'text-blue-400', bg: 'bg-blue-500/10' },
  lotto_scanner: { border: 'border-pink-500/50', text: 'text-pink-400', bg: 'bg-pink-500/10' },
} as const;

/**
 * SIGNAL STRENGTH BANDS (Replaces misleading confidence bands)
 * 
 * CANONICAL grading used across Discord cards AND Dashboard.
 * These bands represent SIGNAL CONSENSUS, not probability.
 * A+ = Exceptional (5+ signals agree)
 * A = Strong (4 signals)
 * B = Good (3 signals)
 * C = Average (2 signals)
 * D = Weak (0-1 signals)
 */
export const SIGNAL_STRENGTH_BANDS = {
  'A+': { min: 5, label: 'A+', description: 'Exceptional - All indicators aligned', color: 'green' },
  A: { min: 4, label: 'A', description: 'Strong - Most indicators aligned', color: 'green' },
  B: { min: 3, label: 'B', description: 'Good - Multiple indicators aligned', color: 'cyan' },
  C: { min: 2, label: 'C', description: 'Average - Some indicators aligned', color: 'amber' },
  D: { min: 0, label: 'D', description: 'Weak - Few indicators aligned', color: 'red' },
} as const;

export type SignalStrengthBand = keyof typeof SIGNAL_STRENGTH_BANDS;

/**
 * Get Signal Strength band from signal count
 * CANONICAL function - used by Discord cards AND Dashboard for consistency
 */
export function getSignalStrengthBand(signalCount: number): SignalStrengthBand {
  if (signalCount >= 5) return 'A+';
  if (signalCount >= 4) return 'A';
  if (signalCount >= 3) return 'B';
  if (signalCount >= 2) return 'C';
  return 'D';
}

/**
 * Get signal label for Discord cards (e.g., "A+ Signal")
 */
export function getSignalLabel(signalCount: number): string {
  const band = getSignalStrengthBand(signalCount);
  if (band === 'D') return 'Low Signal';
  return `${band} Signal`;
}

/**
 * Get styling classes for signal strength band
 */
export function getSignalStrengthStyles(band: SignalStrengthBand): { bg: string; text: string; border: string } {
  switch (band) {
    case 'A+':
      return { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/50' };
    case 'A':
      return { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/40' };
    case 'B':
      return { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/50' };
    case 'C':
      return { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/50' };
    case 'D':
    default:
      return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/50' };
  }
}

/**
 * EXPECTED VALUE CALCULATION
 * 
 * Instead of fake probability, show expected return per $1 risked
 * Formula: EV = (winRate * avgWin) - (lossRate * avgLoss)
 */
export interface ExpectedValueData {
  winRate: number;        // 0-100 percentage
  avgWin: number;         // Average gain on winning trades (e.g., 3.11%)
  avgLoss: number;        // Average loss on losing trades (e.g., -2.5%)
  totalTrades: number;    // Sample size for transparency
}

/**
 * Calculate expected value per $1 risked
 * Returns the expected return for every $1 you risk
 */
export function calculateExpectedValue(data: ExpectedValueData): number {
  const winProb = data.winRate / 100;
  const lossProb = 1 - winProb;
  
  // Expected value = (P(win) * avg_gain) - (P(loss) * avg_loss)
  // avgLoss is already negative, so we use absolute value
  const ev = (winProb * data.avgWin) - (lossProb * Math.abs(data.avgLoss));
  
  // Convert from percentage to per-dollar return
  // e.g., EV of 2% means $1.02 returned per $1 risked, or +$0.02 profit
  return ev / 100;
}

/**
 * Format expected value for display
 * Shows "+$X.XX per $1 risked" or "-$X.XX per $1 risked"
 */
export function formatExpectedValue(ev: number): string {
  try {
    // Safe handling of null/undefined/NaN
    if (ev === null || ev === undefined) {
      return '$0.00 per $1';
    }
    const num = typeof ev === 'number' ? ev : Number(ev);
    if (isNaN(num) || !isFinite(num)) {
      return '$0.00 per $1';
    }
    const sign = num >= 0 ? '+' : '';
    return `${sign}$${num.toFixed(2)} per $1`;
  } catch {
    return '$0.00 per $1';
  }
}

/**
 * Historical engine performance data (verified Dec 2025)
 * Used for calculating expected value when real-time data unavailable
 */
export const ENGINE_HISTORICAL_PERFORMANCE: Record<string, ExpectedValueData> = {
  flow_scanner: { winRate: 81.9, avgWin: 3.11, avgLoss: -2.5, totalTrades: 199 },
  ai: { winRate: 57.1, avgWin: 1.07, avgLoss: -2.0, totalTrades: 77 },
  hybrid: { winRate: 40.6, avgWin: 2.0, avgLoss: -2.5, totalTrades: 32 },
  quant: { winRate: 34.4, avgWin: 2.5, avgLoss: -2.0, totalTrades: 93 },
  chart_analysis: { winRate: 22.2, avgWin: 2.0, avgLoss: -2.5, totalTrades: 9 },
  manual: { winRate: 0, avgWin: 0, avgLoss: -3.58, totalTrades: 1 },
} as const;

/**
 * Normalize engine name to canonical key
 * Handles: "Flow Scanner", "flow_scanner", "flow", "FLOW", etc.
 */
export function normalizeEngineKey(engine: string): string {
  const normalized = engine.toLowerCase().trim().replace(/\s+/g, '_');
  
  // Map common variations to canonical keys
  const engineMap: Record<string, string> = {
    'flow': 'flow_scanner',
    'flow_scanner': 'flow_scanner',
    'ai': 'ai',
    'quant': 'quant',
    'hybrid': 'hybrid',
    'chart': 'chart_analysis',
    'chart_analysis': 'chart_analysis',
    'manual': 'manual',
    'lotto': 'lotto_scanner',
    'lotto_scanner': 'lotto_scanner',
  };
  
  return engineMap[normalized] || normalized;
}

/**
 * Get expected value for an engine
 */
export function getEngineExpectedValue(engine: string): { ev: number; formatted: string; data: ExpectedValueData } | null {
  const normalizedEngine = normalizeEngineKey(engine);
  const data = ENGINE_HISTORICAL_PERFORMANCE[normalizedEngine];
  
  if (!data || data.totalTrades < 3) {
    return null; // Not enough data
  }
  
  const ev = calculateExpectedValue(data);
  return {
    ev,
    formatted: formatExpectedValue(ev),
    data
  };
}
