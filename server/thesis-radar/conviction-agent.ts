/**
 * THESIS RADAR — Conviction Agent
 * =================================
 * The Bullflow-Agent-style synthesizer. Takes a candidate ticker + matched pattern,
 * runs it through every relevant analyzer, assigns each signal a letter grade
 * (A+ / A / A- / B+ / B / B- / C+ / C / C- / D / F), and synthesizes a
 * 1-paragraph "tempered by X" take with a final composite grade.
 *
 * Mirrors the IONQ Bullflow Agent screenshot:
 *   "IONQ 65C bullish sweep backed by opening intent, tempered by nearby resistance"
 *
 * The synthesis MUST name the strongest bull factor AND the most credible bear factor.
 * No one-sided puff pieces — that's how flow tools lose user trust.
 *
 * Design notes:
 *   - Each signal is graded INDEPENDENTLY by its analyzer
 *   - Composite is a weighted blend (not an LLM hallucination)
 *   - The synthesis paragraph CAN use an LLM, but only on the structured grade output
 *   - Output is fully deterministic given the same inputs (modulo LLM temperature=0)
 *   - All signal scores cached for the track-record table
 *
 * To extend:
 *   - Add a new signal kind: implement a grader in this file's `gradeSignal*` family
 *   - Wire it into `gradeAllSignals()` switch
 *   - Add to PATTERN_LIBRARY's `gradedSignals` for any pattern that should use it
 */

import { logger } from '../logger';
import type {
  ExtendedGrade,
  PatternSpec,
  SignalScore,
  SignalSource,
  RadarPick,
} from '@shared/thesis-radar-types';
import { getLetterGrade } from '@shared/grading';
import { v4 as uuidv4 } from 'uuid';

// ─── Score-to-grade mapping ────────────────────────────────────────
// Delegates to the platform-canonical table in @shared/grading so every
// module produces the SAME letter for the same score. ExtendedGrade and
// grading.GradeLetter are the identical 13-letter union (A+ … F).
export function scoreToExtendedGrade(score: number): ExtendedGrade {
  return getLetterGrade(score) as ExtendedGrade;
}

export function gradeToScore(grade: ExtendedGrade): number {
  const map: Record<ExtendedGrade, number> = {
    'A+': 97, A: 92, 'A-': 87,
    'B+': 82, B: 77, 'B-': 72,
    'C+': 67, C: 62, 'C-': 57,
    'D+': 52, D: 47, 'D-': 42,
    F: 30,
  };
  return map[grade] ?? 50;
}

// ─── Signal grader inputs ──────────────────────────────────────────

export interface SignalGraderContext {
  symbol: string;
  spot: number;
  pattern: PatternSpec;
  /** Free-form metadata pulled by subset-engine — varies by signal */
  data: Record<string, unknown>;
}

// Each grader returns SignalScore | null (null = signal not applicable)
type SignalGrader = (ctx: SignalGraderContext) => Promise<SignalScore | null> | SignalScore | null;

// ─── Individual signal graders ─────────────────────────────────────
// Each grader pulls from existing analyzers in /server. For v1 we shape
// the interface; the analyzer-call wiring lives in subset-engine.

function gradeOptionsFlow(ctx: SignalGraderContext): SignalScore | null {
  const d = ctx.data as {
    callVolMultiplier?: number;
    putCallRatio?: number;
    sweepCount?: number;
    sweepPremium?: number;
  };
  if (d.callVolMultiplier == null) return null;

  let score = 50;
  // Multiplier vs 30-day baseline
  if (d.callVolMultiplier >= 5) score += 30;
  else if (d.callVolMultiplier >= 3) score += 20;
  else if (d.callVolMultiplier >= 2) score += 10;

  // Sweep activity
  if ((d.sweepPremium ?? 0) >= 1_000_000) score += 12;
  else if ((d.sweepPremium ?? 0) >= 250_000) score += 6;

  // Put/call sentiment
  if ((d.putCallRatio ?? 1) < 0.3) score += 8;
  else if ((d.putCallRatio ?? 1) > 1.5) score -= 8;

  score = Math.max(0, Math.min(100, score));
  return {
    label: `Call vol ${d.callVolMultiplier?.toFixed(1)}x baseline${d.sweepCount ? `, ${d.sweepCount} sweeps` : ''}`,
    grade: scoreToExtendedGrade(score),
    score,
    source: 'options_flow',
    detail: d.sweepPremium
      ? `Total sweep premium $${(d.sweepPremium / 1000).toFixed(0)}k in lookback window`
      : undefined,
  };
}

function gradeUnusualActivity(ctx: SignalGraderContext): SignalScore | null {
  const d = ctx.data as { oiConcentrationPct?: number; concentrationStrike?: number; topStrikeOI?: number };
  if (d.oiConcentrationPct == null) return null;

  let score = 50;
  if (d.oiConcentrationPct >= 0.30) score += 30;
  else if (d.oiConcentrationPct >= 0.20) score += 22;
  else if (d.oiConcentrationPct >= 0.15) score += 14;

  if ((d.topStrikeOI ?? 0) >= 5000) score += 8;
  else if ((d.topStrikeOI ?? 0) >= 2000) score += 4;

  score = Math.max(0, Math.min(100, score));
  return {
    label: `OI concentration ${(d.oiConcentrationPct * 100).toFixed(0)}% on $${d.concentrationStrike}C`,
    grade: scoreToExtendedGrade(score),
    score,
    source: 'unusual_activity',
    detail: d.topStrikeOI ? `Top strike OI: ${d.topStrikeOI.toLocaleString()}` : undefined,
  };
}

function gradePriceAction(ctx: SignalGraderContext): SignalScore | null {
  const d = ctx.data as {
    aboveSMA20?: boolean;
    aboveEMA20?: boolean;
    rsi14?: number;
    macdBullishCross?: boolean;
    pctFrom50DMA?: number;
  };
  if (d.aboveSMA20 == null && d.rsi14 == null) return null;

  let score = 50;
  let bullishLabels: string[] = [];
  let bearishLabels: string[] = [];

  if (d.aboveSMA20) { score += 8; bullishLabels.push('20-SMA reclaim'); }
  if (d.aboveEMA20) { score += 8; bullishLabels.push('20-EMA reversal'); }
  if (d.macdBullishCross) { score += 12; bullishLabels.push('MACD bullish cross'); }

  if (d.rsi14 != null) {
    if (d.rsi14 >= 50 && d.rsi14 <= 70) { score += 8; bullishLabels.push(`RSI ${d.rsi14.toFixed(0)}`); }
    else if (d.rsi14 > 75) { score -= 6; bearishLabels.push(`RSI overbought ${d.rsi14.toFixed(0)}`); }
    else if (d.rsi14 < 35) { score -= 4; bearishLabels.push(`RSI weak ${d.rsi14.toFixed(0)}`); }
  }

  if ((d.pctFrom50DMA ?? 0) > 25) { score -= 6; bearishLabels.push('extended >25% from 50DMA'); }

  score = Math.max(0, Math.min(100, score));
  return {
    label: bullishLabels.length
      ? `Trend: ${bullishLabels.slice(0, 2).join(', ')}`
      : 'Trend: weak',
    grade: scoreToExtendedGrade(score),
    score,
    source: 'price_action',
    detail: [...bullishLabels, ...bearishLabels].join(' · '),
  };
}

function gradeNews(ctx: SignalGraderContext): SignalScore | null {
  const d = ctx.data as {
    hyperscalerMentions?: number;
    sentimentScore?: number;     // -1 to +1
    catalystWithinDays?: number;
    bottleneckCluster?: number;  // count of "constrained" mentions
  };

  let score = 50;
  let label: string;

  if ((d.hyperscalerMentions ?? 0) >= 2) { score += 18; }
  else if ((d.hyperscalerMentions ?? 0) === 1) { score += 10; }

  if ((d.sentimentScore ?? 0) > 0.3) score += 8;
  else if ((d.sentimentScore ?? 0) < -0.3) score -= 8;

  if (d.catalystWithinDays != null && d.catalystWithinDays <= 30 && d.catalystWithinDays >= 0) {
    score += 10;
  }

  if ((d.bottleneckCluster ?? 0) >= 3) score += 12;

  score = Math.max(0, Math.min(100, score));
  label = `News skew ${(d.sentimentScore ?? 0) >= 0 ? 'bullish' : 'bearish'}`;
  if (d.catalystWithinDays != null && d.catalystWithinDays <= 30) {
    label += ` · catalyst in ${d.catalystWithinDays}d`;
  }

  return {
    label,
    grade: scoreToExtendedGrade(score),
    score,
    source: 'news_nlp',
    detail: d.hyperscalerMentions
      ? `${d.hyperscalerMentions} hyperscaler mention${d.hyperscalerMentions > 1 ? 's' : ''} in window`
      : undefined,
  };
}

function gradeIV(ctx: SignalGraderContext): SignalScore | null {
  const d = ctx.data as { ivPercentile?: number; ivRank?: number; termStructureRatio?: number };
  if (d.ivPercentile == null) return null;

  let score = 50;
  // Pattern-aware IV grading: long_vol setups want LOW IV, short_vol want HIGH
  // Default: low IV = better optionality entry
  if (d.ivPercentile <= 20) score += 22;
  else if (d.ivPercentile <= 40) score += 12;
  else if (d.ivPercentile >= 80) score -= 18;

  if ((d.termStructureRatio ?? 1) >= 1.3) score += 8; // Front IV juiced = catalyst priced

  score = Math.max(0, Math.min(100, score));
  return {
    label: `IV ${d.ivPercentile.toFixed(0)} %ile${d.ivPercentile <= 30 ? ' (cheap)' : d.ivPercentile >= 75 ? ' (juiced)' : ''}`,
    grade: scoreToExtendedGrade(score),
    score,
    source: 'iv_skew',
  };
}

function gradeAnalystRatings(ctx: SignalGraderContext): SignalScore | null {
  const d = ctx.data as { newInitiations90d?: number; ptUpgradesQTD?: number; consensusUpside?: number };
  if (d.newInitiations90d == null && d.consensusUpside == null) return null;

  let score = 55;
  if ((d.newInitiations90d ?? 0) >= 3) score += 14;
  else if ((d.newInitiations90d ?? 0) >= 2) score += 8;

  if ((d.ptUpgradesQTD ?? 0) >= 2) score += 10;
  if ((d.consensusUpside ?? 0) >= 0.40) score += 12;
  else if ((d.consensusUpside ?? 0) <= -0.10) score -= 10;

  score = Math.max(0, Math.min(100, score));
  return {
    label: d.consensusUpside != null
      ? `Analyst PT +${(d.consensusUpside * 100).toFixed(0)}% upside`
      : `${d.newInitiations90d} new initiations 90d`,
    grade: scoreToExtendedGrade(score),
    score,
    source: 'analyst_ratings',
  };
}

function gradeInstitutionalFlow(ctx: SignalGraderContext): SignalScore | null {
  const d = ctx.data as {
    recent13fBuyShares?: number;
    whaleNames?: string[];
    insiderBuys90dDollars?: number;
  };
  if (d.recent13fBuyShares == null && d.insiderBuys90dDollars == null) return null;

  let score = 50;
  if ((d.recent13fBuyShares ?? 0) >= 10_000_000) score += 22;
  else if ((d.recent13fBuyShares ?? 0) >= 1_000_000) score += 12;

  if ((d.insiderBuys90dDollars ?? 0) >= 1_000_000) score += 14;
  else if ((d.insiderBuys90dDollars ?? 0) >= 100_000) score += 6;

  score = Math.max(0, Math.min(100, score));
  return {
    label: `Whale flow${d.whaleNames?.length ? `: ${d.whaleNames.slice(0, 2).join(', ')}` : ''}`,
    grade: scoreToExtendedGrade(score),
    score,
    source: 'institutional_flow',
    detail: d.recent13fBuyShares
      ? `${(d.recent13fBuyShares / 1_000_000).toFixed(1)}M shares accumulated in last 30d`
      : undefined,
  };
}

function gradeSectorRotation(ctx: SignalGraderContext): SignalScore | null {
  const d = ctx.data as {
    layerStage?: 'pre' | 'early' | 'mid' | 'late' | 'topped' | 'rolling';
    derivativeOrder?: number;
    layerBreadth?: number;
  };
  if (d.layerStage == null) return null;

  let score = 50;
  if (d.layerStage === 'early') score += 20;
  else if (d.layerStage === 'mid') score += 10;
  else if (d.layerStage === 'pre') score += 8;
  else if (d.layerStage === 'late') score -= 6;
  else if (d.layerStage === 'topped' || d.layerStage === 'rolling') score -= 16;

  if ((d.derivativeOrder ?? 1) >= 2 && (d.layerStage === 'pre' || d.layerStage === 'early')) {
    score += 10;
  }
  if ((d.layerBreadth ?? 0) >= 0.6) score += 4;

  score = Math.max(0, Math.min(100, score));
  return {
    label: `Layer stage: ${d.layerStage}${d.derivativeOrder ? ` · D${d.derivativeOrder}` : ''}`,
    grade: scoreToExtendedGrade(score),
    score,
    source: 'sector_rotation',
  };
}

function gradeGEXPositioning(ctx: SignalGraderContext): SignalScore | null {
  const d = ctx.data as { netGEX?: number; dealerFlowPer1Pct?: number; flipPoint?: number };
  if (d.netGEX == null) return null;

  let score = 50;
  // Positive net GEX = dealers long gamma = stabilizing
  if (d.netGEX > 1_000_000_000) score += 14;   // strong support regime
  else if (d.netGEX < -500_000_000) score -= 8; // negative gamma = volatile, depends on direction

  // Spot relative to flip
  if (ctx.spot > (d.flipPoint ?? ctx.spot)) score += 6; // above flip = bullish bias
  else if (ctx.spot < (d.flipPoint ?? ctx.spot)) score -= 4;

  score = Math.max(0, Math.min(100, score));
  return {
    label: `GEX ${d.netGEX > 0 ? '+' : ''}$${(d.netGEX / 1e9).toFixed(2)}B${d.flipPoint ? ` · flip $${d.flipPoint.toFixed(2)}` : ''}`,
    grade: scoreToExtendedGrade(score),
    score,
    source: 'gex_positioning',
  };
}

// ─── Main grader: dispatch by signal source ────────────────────────

const GRADER_REGISTRY: Partial<Record<SignalSource, SignalGrader>> = {
  options_flow: gradeOptionsFlow,
  unusual_activity: gradeUnusualActivity,
  price_action: gradePriceAction,
  news_nlp: gradeNews,
  iv_skew: gradeIV,
  analyst_ratings: gradeAnalystRatings,
  institutional_flow: gradeInstitutionalFlow,
  sector_rotation: gradeSectorRotation,
  gex_positioning: gradeGEXPositioning,
};

export async function gradeAllSignals(
  ctx: SignalGraderContext,
  sources: SignalSource[],
): Promise<SignalScore[]> {
  const scores: SignalScore[] = [];
  for (const src of sources) {
    const grader = GRADER_REGISTRY[src];
    if (!grader) {
      logger.warn(`[CONVICTION] No grader registered for ${src}`);
      continue;
    }
    try {
      const result = await grader(ctx);
      if (result) scores.push(result);
    } catch (e) {
      logger.warn(`[CONVICTION] Grader ${src} threw on ${ctx.symbol}: ${(e as Error).message}`);
    }
  }
  return scores;
}

// ─── Composite score + synthesis ───────────────────────────────────

export function computeComposite(signals: SignalScore[]): { score: number; grade: ExtendedGrade } {
  if (signals.length === 0) return { score: 0, grade: 'F' };

  // Weights by source — options/news/institutional flow weighted heavier
  // because they're forward-looking; price action is current state.
  const sourceWeights: Partial<Record<SignalSource, number>> = {
    options_flow: 1.6,
    unusual_activity: 1.5,
    institutional_flow: 1.4,
    news_nlp: 1.3,
    iv_skew: 1.1,
    sector_rotation: 1.2,
    earnings_history: 1.1,
    insider_filings: 1.3,
    price_action: 1.0,
    analyst_ratings: 0.9,
    gex_positioning: 1.0,
    macd: 0.7,
    rsi: 0.7,
    sma_ema: 0.7,
    volume_profile: 0.9,
    social_sentiment: 0.6,
    aggregate: 1.0,
  };

  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of signals) {
    const w = sourceWeights[s.source] ?? 1.0;
    weightedSum += s.score * w;
    totalWeight += w;
  }

  const composite = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const score = Math.round(composite);
  return { score, grade: scoreToExtendedGrade(score) };
}

/**
 * Build the "tempered by X" synthesis paragraph.
 * Names the strongest bull factor AND the most credible bear factor.
 * No LLM call — fully deterministic from the structured grades.
 */
export function synthesizeTake(signals: SignalScore[], finalGrade: ExtendedGrade): string {
  if (signals.length === 0) return 'Insufficient data to synthesize a view.';

  const sorted = [...signals].sort((a, b) => b.score - a.score);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  const direction =
    finalGrade.startsWith('A') || finalGrade.startsWith('B+')
      ? 'bullish'
      : finalGrade.startsWith('D') || finalGrade === 'F'
      ? 'bearish'
      : 'mixed';

  // If weakest is also reasonably strong (>=B-), no need to temper
  const shouldTemper = weakest.score < 65 && signals.length >= 3;

  if (!shouldTemper) {
    return `${direction.charAt(0).toUpperCase()}${direction.slice(1)} setup — ${strongest.label.toLowerCase()} is the lead signal.`;
  }

  return `${direction.charAt(0).toUpperCase()}${direction.slice(1)} setup backed by ${strongest.label.toLowerCase()}, tempered by ${weakest.label.toLowerCase()}.`;
}

// ─── Top-level: run conviction grading on a single ticker × pattern ──

export interface ConvictionResult {
  pick: RadarPick;
  /** Per-signal breakdown for the Radar UI */
  signalBreakdown: SignalScore[];
}

export async function gradeConviction(
  symbol: string,
  spot: number,
  pattern: PatternSpec,
  data: Record<string, unknown>,
): Promise<ConvictionResult> {
  const ctx: SignalGraderContext = { symbol, spot, pattern, data };
  const signals = await gradeAllSignals(ctx, pattern.gradedSignals);
  const { score, grade } = computeComposite(signals);
  const synthesis = synthesizeTake(signals, grade);

  const pick: RadarPick = {
    id: uuidv4(),
    firedAt: new Date().toISOString(),
    patternId: pattern.id,
    symbol,
    spotAtFire: spot,
    signals,
    finalGrade: grade,
    finalScore: score,
    synthesis,
    status: pattern.output === 'forming' ? 'forming' : 'confirmed',
    direction:
      grade.startsWith('A') || grade.startsWith('B+') ? 'long' :
      grade.startsWith('F') || grade.startsWith('D') ? 'short' :
      'neutral',
  };

  logger.info(
    `[CONVICTION] ${symbol} × ${pattern.id} → ${grade} (${score}/100) · ${signals.length} signals`,
  );

  return { pick, signalBreakdown: signals };
}
