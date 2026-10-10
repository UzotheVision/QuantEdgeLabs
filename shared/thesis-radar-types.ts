/**
 * THESIS RADAR — Shared Types
 * ============================
 * The Thesis Radar surfaces emerging theses BEFORE they're consensus.
 * It's the layer above the rotation engine: instead of telling you what's moving,
 * it tells you what's about to.
 *
 * Architecture overview:
 *
 *   Pattern Library  →  Subset Engine  →  Live Scanner  →  Conviction Agent
 *        ↓                   ↓                  ↓                 ↓
 *   (signatures)      (filter compiler)    (cron runs)     (letter grades)
 *                                                                ↓
 *                                                       Preview Card / Track Record
 *                                                                ↓
 *                                                          Trade Desk Idea
 *
 * Each PATTERN is a named setup signature (e.g. "DGXX setup", "Bottleneck whisper")
 * defined as a chain of FILTER conditions. The subset engine runs the filter against
 * the universe daily; matches go through conviction grading and become Radar Picks.
 */

// ─── Grade modifiers (extends shared/grade-types with +/-) ───

export type GradeModifier = '+' | '' | '-';
export type ExtendedGrade =
  | 'A+' | 'A' | 'A-'
  | 'B+' | 'B' | 'B-'
  | 'C+' | 'C' | 'C-'
  | 'D+' | 'D' | 'D-'
  | 'F';

export interface SignalScore {
  /** Short label for the signal, e.g. "MACD bullish reversal" */
  label: string;
  /** Letter grade visible on the card */
  grade: ExtendedGrade;
  /** Underlying numeric score 0-100 (for sorting / weighting) */
  score: number;
  /** Optional 1-line detail shown on hover or expand */
  detail?: string;
  /** Which engine/source produced the signal — for debugging + audit */
  source: SignalSource;
}

export type SignalSource =
  | 'price_action'
  | 'options_flow'
  | 'gex_positioning'
  | 'news_nlp'
  | 'earnings_history'
  | 'analyst_ratings'
  | 'insider_filings'
  | 'institutional_flow'
  | 'social_sentiment'
  | 'sector_rotation'
  | 'macd'
  | 'rsi'
  | 'sma_ema'
  | 'volume_profile'
  | 'iv_skew'
  | 'unusual_activity'
  | 'aggregate';

// ─── Pattern definition ────────────────────────────────────────────

export type PatternId =
  | 'dgxx_setup'                  // small-cap hyperscaler-adjacent + call vol spike + news catalyst
  | 'aschenbrenner_2nd_derivative' // first-order layer up + 2nd-derivative flat + cheap IV
  | 'bottleneck_whisper'           // multi-call mention of "constrained" + sub-$5B supplier
  | 'institutional_accumulation'   // Form 4 / 13F whale buys + low IV percentile
  | 'catalyst_whisper'             // unusual call OI + news scheduled within 30 days
  | 'gamma_squeeze';               // OI cluster + low IV + beaten-down stock + binary catalyst

export type PatternHorizon = 'days' | 'weeks' | 'months' | 'quarters';

export interface PatternSpec {
  /** Stable ID for DB references */
  id: PatternId;
  /** Human-readable name */
  name: string;
  /** What this pattern catches */
  thesis: string;
  /** Time horizon for the play to materialize */
  horizon: PatternHorizon;
  /** Target hit rate (used for ranking / calibration alerts) */
  targetHitRate: number;
  /** Filter chain — each filter narrows the universe */
  filters: PatternFilter[];
  /** Which signals to grade once a match is found */
  gradedSignals: SignalSource[];
  /** Time-to-decision after firing (alert TTL in hours) */
  alertTTLHours: number;
  /** Output kind — affects which UI surface this hits */
  output: 'forming' | 'confirmed' | 'preview';
}

export interface PatternFilter {
  /** Domain the filter operates on */
  domain: 'price' | 'cap' | 'options_flow' | 'news' | 'fundamentals' | 'sector' | 'iv' | 'analysts';
  /** Operator-style description for the engine compiler */
  predicate: string;
  /** Numeric/string params for the predicate */
  params?: Record<string, number | string | boolean>;
  /** Human-readable explanation (used in Preview cards) */
  explain: string;
}

// ─── Match output (after pattern + grading runs) ───────────────────

export interface RadarPick {
  /** Unique ID for tracking */
  id: string;
  /** When the pick fired */
  firedAt: string;
  /** The pattern that matched */
  patternId: PatternId;
  /** Symbol that matched */
  symbol: string;
  /** Spot at fire-time (for invalidation tracking) */
  spotAtFire: number;
  /** Per-signal grades that build the conviction */
  signals: SignalScore[];
  /** Final synthesized letter grade */
  finalGrade: ExtendedGrade;
  /** Numeric composite 0-100 */
  finalScore: number;
  /** "Bullish sweep backed by opening intent, tempered by nearby resistance" */
  synthesis: string;
  /** Status — updates over time */
  status: 'forming' | 'confirmed' | 'hit_t1' | 'hit_t2' | 'invalidated' | 'expired';
  /** Stop / invalidation level */
  invalidation?: number;
  /** T1 / T2 / runner targets */
  targets?: { t1?: number; t2?: number; t3?: number; runner?: number };
  /** Trigger condition that needs to confirm */
  trigger?: string;
  /** Conviction direction */
  direction: 'long' | 'short' | 'long_vol' | 'short_vol' | 'neutral';
}

// ─── Track record entry (one row per fired pick, updated as outcome resolves) ───

export interface TrackRecordEntry {
  pickId: string;
  patternId: PatternId;
  symbol: string;
  firedAt: string;
  spotAtFire: number;
  finalGrade: ExtendedGrade;
  // Populated when resolved:
  resolvedAt?: string;
  outcomePrice?: number;
  outcomePct?: number;       // % move from fire to resolve
  hitT1?: boolean;
  hitT2?: boolean;
  invalidated?: boolean;
  daysToResolve?: number;
  // Per-pattern aggregate stats updated daily:
  // (computed in track-record.ts roll-up)
}

// ─── Discord alert payload (mirrors RiskyBisksy block format) ───

export interface DiscordRadarAlert {
  type: 'forming' | 'confirmed' | 'invalidated';
  symbol: string;
  pattern: string;
  spot: number;
  signalBlock: { label: string; value: string; emoji?: string }[];
  reason: string;
  trigger?: string;
  status: string;
  disclaimer?: string;
}
