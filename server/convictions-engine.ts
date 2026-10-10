/**
 * CONVICTIONS ENGINE
 * ==================
 * One ranked list, every layer of confluence stacked on every name.
 *
 * This is the "Today's Convictions" backend. It pulls the most recent
 * trade ideas from the database, then layers in:
 *   1. Technical confluence (RSI, MACD, trend, volume) — already on each idea
 *   2. Convergence signals (options flow + news + sentiment + insider) — from convergenceSignalsJson
 *   3. Catalyst flags (earnings, news catalyst, news bias) — from idea fields
 *   4. Market regime (VIX / SPY / sentiment) — from getMarketContext()
 *   5. Geopolitical context (active scenarios, risk level) — from getScenarioMatrix()
 *   6. Fundamentals (P/E, growth, short interest) — from FundamentalDataProvider
 *   7. Sector tailwind — from approved-tickers SECTOR_MAP + sector ETF performance
 *
 * Every layer contributes points to a single conviction score (0-100).
 * Output is sorted descending so the user sees the highest-conviction
 * setups first, with each contributing layer broken out.
 *
 * Performance design:
 *   - Pulls last 24h of ideas (already pre-filtered by quality scanners)
 *   - Caches market context (5min) and geopolitical matrix (10min)
 *   - Skips fundamentals enrichment when symbol count > 30 (rate-limit safety)
 */

import { db } from "./db";
import { tradeIdeas, type ConvergenceAnalysis } from "@shared/schema";
import { readOracleExecutionAudit, type OracleLifecycleState } from "@shared/oracle-lifecycle";
import { gte, desc } from "drizzle-orm";
import { logger } from "./logger";
import { getMarketContext, type MarketContext } from "./market-context-service";
import { getScenarioMatrix } from "./geopolitical-matrix";
import { getSector, isApprovedTicker, getTier, type Sector } from "@shared/approved-tickers";
import { getTradierQuote } from "./tradier-api";
import { getMarketBreadth, type MarketBreadthSnapshot } from "./market-breadth-service";
import { getAnalystSnapshot, type AnalystSnapshot } from "./analyst-data-service";
import { getRealtimeBatchQuotes, type RealtimeQuote } from "./realtime-pricing-service";
import { currentMarketPhase, getPreMarketBatch, type PreMarketSnapshot } from "./pre-market-service";
import { getGexSnapshotBatch, type GexSnapshot } from "./gex-snapshot-service";
import { isUSMarketOpen } from "@shared/market-calendar";

/**
 * The Oracle board must remain usable while slower context services are
 * rebuilding their own caches.  Let those services finish in the background,
 * but never make a human wait behind a 120-name breadth calculation.
 */
function within<T>(promise: Promise<T>, fallback: T, timeoutMs = 900): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

function neutralMarketContext(isOpen: boolean): MarketContext {
  return {
    regime: "ranging",
    riskSentiment: "neutral",
    preferredDirection: "BOTH",
    score: 50,
    shouldTrade: isOpen,
    reasons: ["Market context is refreshing — no live regime adjustment applied"],
    spyData: null,
    vixLevel: null,
    timestamp: new Date(),
  };
}

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

// Re-exported from the canonical list so the engine and the marketing copy can
// never disagree about how many layers exist. The old hand-typed union omitted
// "macro", which was already being emitted onto layers.
export type { ConvictionLayerKind } from "@shared/conviction-layers";
import type { ConvictionLayerKind } from "@shared/conviction-layers";
import { isLeadershipName } from "@shared/leadership-universe";

export interface ConvictionLayer {
  kind: ConvictionLayerKind;
  label: string;
  /** Points contributed to the overall score (positive = bullish for the trade direction). */
  points: number;
  /** One-line human explanation. Shown to the user as the WHY. */
  why: string;
  /** Optional structured data the UI can format. */
  data?: Record<string, unknown>;
}

export interface ConvictionPick {
  ideaId: string;
  symbol: string;
  sector: Sector;
  direction: "long" | "short";
  assetType: string;
  /** What the entry/stop/target are priced in: option-contract premium or the underlying's shares. */
  levelBasis?: "contract" | "underlying";
  holdingPeriod: string;
  tradeType: string | null;

  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  riskRewardRatio: number;

  // Options fields (optional)
  optionType: "call" | "put" | null;
  strikePrice: number | null;
  /** Premium per contract at signal time — lets the client size contracts. */
  entryPremium: number | null;
  optionDte: number | null;
  expiryDate: string | null;

  /** Total conviction score 0-100 (sum of layer points, capped). */
  convictionScore: number;
  /** Categorical band for UI tinting. */
  convictionBand: "S" | "A" | "B" | "C";
  /** Independent layers that fired. Drives "confluence after confluence" UX. */
  layerCount: number;
  layers: ConvictionLayer[];

  /**
   * Evidence score captured the first time this published plan was graded.
   * This is deliberately distinct from `convictionScore`, which is the live
   * re-grade used to rank today's board as context and price change.
   */
  publishedConvictionScore: number | null;
  publishedConvictionBand: "S" | "A" | "B" | "C" | null;

  /** Top-line thesis the user reads first. */
  thesis: string;

  catalyst: string;
  catalystSourceUrl: string | null;
  generatedAt: string;

  /**
   * Originating engine ('quant' | 'ai' | 'hybrid' | 'flow' | 'news' | 'manual').
   * Surfaced so the unified cockpit can drive the Trade Desk "mode" tabs
   * (AI Picks / Flow / Lotto / News / Manual) off the same conviction feed.
   */
  source: string;
  /** Live price at response time — what P&L / progress are measured against. */
  currentPrice?: number | null;
  /** A published plan is not an executed position. Derived from the durable audit. */
  lifecycleState: OracleLifecycleState;
}

export interface ConvictionsResponse {
  generatedAt: string;
  marketContext: {
    regime: string;
    riskSentiment: string;
    preferredDirection: string;
    score: number;
    vixLevel: number | null;
    reasons: string[];
  };
  breadth: {
    regime: string;
    bias: number;
    advanceDeclineRatio: number;
    percentAbove200MA: number;
    percentAbove50MA: number;
    newHighsLows: number;
    sampleSize: number;
    interpretation: string;
  } | null;
  geopolitical: {
    risk: string;
    activeScenarios: string[];
  };
  totalCandidatesScanned: number;
  picks: ConvictionPick[];
}

// ─────────────────────────────────────────────────────────────
// Layer scorers
// ─────────────────────────────────────────────────────────────

function scoreTechnicalLayer(idea: any, direction: "long" | "short"): ConvictionLayer | null {
  const rsi = typeof idea.rsiValue === "number" ? idea.rsiValue : null;
  const macdHist = typeof idea.macdHistogram === "number" ? idea.macdHistogram : null;
  const volRatio = typeof idea.volumeRatio === "number" ? idea.volumeRatio : null;
  const trend = typeof idea.trendStrength === "number" ? idea.trendStrength : null;

  const reasons: string[] = [];
  let points = 0;

  if (rsi !== null) {
    if (direction === "long" && rsi >= 45 && rsi <= 65) {
      points += 4;
      reasons.push(`RSI ${rsi.toFixed(0)} (sweet spot)`);
    } else if (direction === "short" && rsi >= 60 && rsi <= 75) {
      points += 4;
      reasons.push(`RSI ${rsi.toFixed(0)} (overbought)`);
    } else if (direction === "long" && rsi < 35) {
      points += 3;
      reasons.push(`RSI ${rsi.toFixed(0)} (oversold bounce)`);
    }
  }

  if (macdHist !== null) {
    if (direction === "long" && macdHist > 0) {
      points += 3;
      reasons.push("MACD bullish cross");
    } else if (direction === "short" && macdHist < 0) {
      points += 3;
      reasons.push("MACD bearish cross");
    }
  }

  if (volRatio !== null && volRatio >= 1.5) {
    points += 4;
    reasons.push(`Vol ${volRatio.toFixed(1)}× avg`);
  }

  if (trend !== null && trend >= 60) {
    points += 3;
    reasons.push(`Trend ${trend.toFixed(0)}/100`);
  }

  // Catalyst-text fallback — many historical ideas only have a free-text
  // catalyst field (e.g. "Heavy volume (3.2x average)"). Mine it for the
  // structured signals we couldn't read directly.
  const catText: string = typeof idea.catalyst === "string" ? idea.catalyst.toLowerCase() : "";
  if (catText) {
    // Volume mention
    const volMatch = catText.match(/(\d+(?:\.\d+)?)\s*x\s*(?:average|avg)/);
    if (volRatio === null && volMatch) {
      const v = parseFloat(volMatch[1]);
      if (v >= 1.5) {
        points += 4;
        reasons.push(`Vol ${v.toFixed(1)}× avg`);
      }
    } else if (volRatio === null && /heavy volume|unusual volume/.test(catText)) {
      points += 3;
      reasons.push("Heavy volume");
    }
    // Trend / breakout / squeeze keywords
    if (/breakout|breaking out|broke out/.test(catText)) {
      points += 3;
      reasons.push("Breakout");
    }
    if (/squeeze|coil|tight range/.test(catText)) {
      points += 3;
      reasons.push("Squeeze");
    }
    if (/trend|uptrend|momentum/.test(catText) && direction === "long") {
      points += 2;
      reasons.push("Trend up");
    }
    if (/downtrend|bearish trend/.test(catText) && direction === "short") {
      points += 2;
      reasons.push("Trend down");
    }
    // RSI / MACD textual mentions
    if (rsi === null && /rsi/.test(catText)) {
      points += 2;
      reasons.push("RSI flagged");
    }
    if (macdHist === null && /macd/.test(catText)) {
      points += 2;
      reasons.push("MACD flagged");
    }
  }

  if (points === 0) return null;
  return {
    kind: "technical",
    label: "Technical",
    points,
    why: reasons.join(" · "),
    data: { rsi, macdHist, volRatio, trend },
  };
}

/**
 * Quality signals layer — reads the `qualitySignals[]` array that every
 * scanner-generated idea writes (e.g. "Heavy volume (3.2x avg)", "Breakout
 * detected", "Bullish momentum 100/100"). Each aligned signal earns 2pts,
 * capped at 12. This is the workhorse layer for historical ideas where
 * the structured technical fields aren't populated.
 */
function isTapePrimaryIdea(idea: any): boolean {
  const source = String(idea.source ?? "").toLowerCase();
  const catalyst = String(idea.catalyst ?? "");
  return source === "flow" || catalyst.startsWith("Aggressor tape:");
}

/**
 * Intraday aggressor flow is a short-lived observation, not a multi-day fact.
 * Keep it at full weight during the session it was measured, then decay it
 * quickly. After one full market day it remains visible in the thesis/history,
 * but contributes no fresh conviction points until Bullflow publishes a new
 * read. This also prevents a dated tape sentence from being counted once as a
 * quality signal and again as measured structure for several sessions.
 */
function tapeEvidenceWeight(idea: any, applyLiveDecay = true): { factor: number; ageHours: number } {
  const ageHours = ideaAgeHours(idea);
  if (!applyLiveDecay || !isTapePrimaryIdea(idea)) return { factor: 1, ageHours };
  if (ageHours <= 8) return { factor: 1, ageHours };
  if (ageHours <= 16) return { factor: 0.65, ageHours };
  if (ageHours <= 24) return { factor: 0.3, ageHours };
  return { factor: 0, ageHours };
}

function scoreQualitySignalsLayer(
  idea: any,
  direction: "long" | "short",
  applyLiveDecay = true,
): ConvictionLayer | null {
  const qs: string[] = Array.isArray(idea.qualitySignals) ? idea.qualitySignals : [];
  if (qs.length === 0) return null;

  // Count signals that align with the direction.
  // Includes the reversal and tape vocabulary (2026-09-23): "bottomed",
  // "ascending floors", "net premium bought" are aligned long evidence — the
  // old list scored a measured bottom-reversal as neutral and buried it.
  const longKeywords = /breakout|bullish|momentum|volume|surge|uptrend|near high|gap up|squeeze|coil|oversold|bounce|accumulation|relative volume|strong move|positive|higher[- ]lows?|bottomed|ascending|recover|retrace|reversal|net premium|call buying|call-weighted|aggressor|tape confirms/i;
  const shortKeywords = /bearish|breakdown|downtrend|gap down|near low|overbought|distribution|selloff|negative/i;

  const aligned = qs.filter((s) => {
    if (typeof s !== "string") return false;
    if (direction === "long") return longKeywords.test(s);
    return shortKeywords.test(s);
  });

  if (aligned.length === 0) {
    // Even neutral signals (e.g. "1.5x relative volume") still indicate
    // *something* fired — give partial credit for the count.
    const tapeWeight = tapeEvidenceWeight(idea, applyLiveDecay);
    const points = Math.round(Math.min(6, qs.length) * tapeWeight.factor);
    if (points === 0) return null;
    return {
      kind: "technical",
      label: `Signals ${qs.length}×`,
      points,
      why: `${qs.slice(0, 3).join(" · ")}${tapeWeight.factor < 1 ? ` · aged tape ${tapeWeight.ageHours.toFixed(0)}h (${Math.round(tapeWeight.factor * 100)}% weight)` : ""}`,
      data: { signalCount: qs.length, aligned: 0, evidenceWeight: tapeWeight.factor, evidenceAgeHours: tapeWeight.ageHours },
    };
  }

  const rawPoints = Math.min(12, aligned.length * 2 + Math.min(2, qs.length - aligned.length));
  const tapeWeight = tapeEvidenceWeight(idea, applyLiveDecay);
  const points = Math.round(rawPoints * tapeWeight.factor);
  if (points === 0) return null;
  return {
    kind: "technical",
    label: `Signals ${aligned.length}/${qs.length}`,
    points,
    why: `${aligned.slice(0, 3).join(" · ")}${tapeWeight.factor < 1 ? ` · aged tape ${tapeWeight.ageHours.toFixed(0)}h (${Math.round(tapeWeight.factor * 100)}% weight)` : ""}`,
    data: { signalCount: qs.length, aligned: aligned.length, evidenceWeight: tapeWeight.factor, evidenceAgeHours: tapeWeight.ageHours },
  };
}

/**
 * Measured-structure layer — reversal and tape-primary ideas are early BY
 * DESIGN: every trend layer (RSI, EMA stack, 200SMA) systematically
 * under-scores a name that is turning off a bottom or being accumulated
 * before the chart moves, which buried the 2026-09-23 reversal slate at
 * 4-14 points. The detector measured real things (a dated bottom, a printed
 * invalidation, aggressor dollars at the ask) — credit that measurement,
 * scaled by the publisher's own confidence.
 */
function scoreMeasuredStructureLayer(idea: any, applyLiveDecay = true): ConvictionLayer | null {
  const cat = String(idea.catalyst ?? "");
  const isReversal = cat.startsWith("Higher-Lows Base") || cat.startsWith("V-Recovery");
  const isTape = cat.startsWith("Aggressor tape:");
  if (!isReversal && !isTape) return null;
  const conf = Number(idea.confidenceScore ?? 0);
  const rawPoints = conf >= 80 ? 12 : conf >= 70 ? 9 : 6;
  const tapeWeight = tapeEvidenceWeight(idea, applyLiveDecay);
  const points = Math.round(rawPoints * tapeWeight.factor);
  if (points === 0) return null;
  return {
    kind: "structure",
    label: isTape ? "Measured Tape" : "Reversal Structure",
    points,
    why: `${cat.split("·")[0].trim()}${tapeWeight.factor < 1 ? ` · aged ${tapeWeight.ageHours.toFixed(0)}h (${Math.round(tapeWeight.factor * 100)}% weight)` : ""}`,
    data: { publisherConfidence: conf, evidenceWeight: tapeWeight.factor, evidenceAgeHours: tapeWeight.ageHours },
  };
}

/**
 * Leadership layer — membership in the benchmark complex (SPX/NDX/SMH/IGV
 * class, curated in shared/leadership-universe) is worth real points: liquid
 * options, institutional participation, index flows. Absence is never
 * evidence against a name — no penalty, only the boost. Operator policy
 * 2026-09-23: the board must skew toward names a trader benchmarks against.
 */
function scoreLeadershipLayer(symbol: string): ConvictionLayer | null {
  try {
    if (!isLeadershipName(symbol)) return null;
    return {
      kind: "structure",
      label: "Benchmark Name",
      points: 4,
      why: "Inside the benchmark complex (SPX/NDX/SMH/IGV class) — liquid options, institutional participation",
      data: {},
    };
  } catch {
    return null;
  }
}

/**
 * Path-to-structure layer — the context the 2R formula targets ignored
 * (operator 2026-09-24). Resistance (or support, for shorts) sitting inside
 * 1R of the entry caps the trade before it can pay; a clean runway to the
 * first real level is evidence FOR it.
 */
async function scorePathToStructureLayer(p: any): Promise<ConvictionLayer | null> {
  try {
    if (!(p.entryPrice > 0) || !(p.stopLoss > 0) || p.levelBasis === 'contract') return null;
    const { buildTargetLadder } = await import("./target-ladder");
    const l = await buildTargetLadder({
      symbol: p.symbol, direction: p.direction, entry: p.entryPrice, stop: p.stopLoss,
      holdingPeriod: p.holdingPeriod, publishedTarget: p.targetPrice, includeGex: false,
    });
    const first = l?.rungs.find((r) => r.structural);
    if (!l || !first) return null;
    const wall = p.direction === 'long' ? 'resistance' : 'support';
    if (first.rMultiple < 1) {
      return { kind: "structure", label: "Path Blocked", points: -6,
        why: `${first.source} at $${first.price} caps the move at ${first.rMultiple}R — the first real ${wall} arrives before 1:1`,
        data: { firstLevel: first.price, rMultiple: first.rMultiple } };
    }
    if (first.rMultiple <= 3) {
      // A lone Fibonacci ratio is a weaker level than a traded shelf or a wall.
      const fibOnly = /^Fib[^+]*$/.test(first.source.trim());
      return { kind: "structure", label: "Clear Path", points: fibOnly ? 2 : 4,
        why: `clean runway to ${first.source} at $${first.price} (${first.rMultiple}R, ${Math.round(first.probTouch * 100)}% reach odds)`,
        data: { firstLevel: first.price, rMultiple: first.rMultiple } };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Tape contradiction layer — SUBTRACTS. When the aggressor tape (measured
 * ask-vs-bid fills, same-day) leans hard against the idea's direction, that
 * is evidence AGAINST the card and must cost points, not decorate a chip:
 * on 2026-09-23 a BULL SPY pin card rendered with −$28.6M net sold on its
 * own face. Scaled by size; mild disagreement costs little, heavy costs a
 * band. Confirming tape is already rewarded elsewhere — this layer only
 * ever goes negative or abstains.
 */
async function scoreTapeContradictionLayer(symbol: string, direction: "long" | "short"): Promise<ConvictionLayer | null> {
  try {
    const bf = await import("./bullflow-service");
    if (!bf.bullflowEnabled()) return null;
    const read: any = await bf.getNetPremiumToday(symbol);
    if (!read) return null;
    const net = Number(read.callsNetPremium ?? 0) - Number(read.putsNetPremium ?? 0);
    const against = direction === "long" ? -net : net; // positive = tape opposes
    if (against < 1_000_000) return null;               // mild/confirming → abstain
    const points = against >= 20e6 ? -10 : against >= 5e6 ? -7 : -4;
    return {
      kind: "structure",
      label: "Tape Contradiction",
      points,
      why: `aggressor tape leans ${direction === "long" ? "SHORT" : "LONG"} $${(against / 1e6).toFixed(1)}M against this card today (measured fills)`,
      data: { netPremium: net },
    };
  } catch {
    return null;
  }
}

/**
 * Watchlist tier layer — being on the proven backtested watchlist is
 * itself a form of conviction. S-tier names earn more than secondary.
 */
/**
 * BAND CUTOFFS — retuned 22 Aug 2026, after the Watchlist Tier layer stopped scoring.
 *
 * The old cutoffs (S=30 / A=22 / B=15) were set when that layer contributed up to
 * 10 points, and the comment said so outright: "S = 30+ (technical + tier +
 * convergence + regime + sector all firing)". With tier removed, the observed
 * maximum across 88 live picks was 29 — S had become mathematically unreachable.
 *
 * Refitted against the real distribution rather than by subtracting 10, because the
 * tier layer never contributed a flat 10: it paid 8 for S-tier names, 5 for A, 4 for
 * mega-caps, 3 for index ETFs, 2 for secondary and 0 for everything else. A uniform
 * shift would have over-corrected most of the board.
 *
 * Anchored to percentiles of that distribution (n=88, max 29, median 12.5):
 *   S = 25  → top ~5%   — elite should be rare enough to mean something
 *   A = 19  → top ~22%
 *   B = 13  → top ~48%
 *   C = the rest
 *
 * ⚠️ Fitted to a WEEKEND snapshot with stale data — several picks were carrying a
 * Freshness penalty of -6 for being ~29h old, and Yahoo was rate-limiting. Live
 * intraday scores should run higher, which would push more names into S than the
 * ~5% intended. Re-measure on a trading day and adjust these three numbers; that is
 * the only edit required, and it is why they are named constants in one place
 * instead of two inline ternaries that had already been duplicated.
 */
const BAND_CUTOFFS = { S: 25, A: 19, B: 13 } as const;

function bandFor(score: number): "S" | "A" | "B" | "C" {
  return score >= BAND_CUTOFFS.S ? "S"
       : score >= BAND_CUTOFFS.A ? "A"
       : score >= BAND_CUTOFFS.B ? "B"
       : "C";
}

function scoreTierLayer(symbol: string, riskRewardRatio: number): ConvictionLayer | null {
  const tier = getTier(symbol);
  if (!tier) return null;

  let points = 0;
  let label = "";
  switch (tier) {
    case "MEGA":
      // Mega-cap names get a small boost: they're always relevant, but
      // not user-validated edge plays — so they sit between A-tier and INDEX.
      points = 4;
      label = "Mega-cap (FAANG)";
      break;
    case "S":
      points = 8;
      label = "S-tier watchlist";
      break;
    case "A":
      points = 5;
      label = "A-tier watchlist";
      break;
    case "INDEX":
      points = 3;
      label = "Index ETF";
      break;
    case "SECONDARY":
      points = 2;
      label = "Secondary watchlist";
      break;
  }

  const reasons = [label];
  if (typeof riskRewardRatio === "number" && riskRewardRatio >= 2.0) {
    reasons.push(`R:R ${riskRewardRatio.toFixed(1)}×`);
  }

  // ── SCORES ZERO ON PURPOSE. Kept as visible CONTEXT, not as evidence. ──
  //
  // This layer used to award up to 10 points (8 for S-tier + 2 for R:R ≥ 2.5).
  // Bands are S=30 / A=22 / B=15, so that was a THIRD of the way to ELITE handed
  // over before a single piece of market evidence was read. Two separate defects:
  //
  //   1. CIRCULAR. Watchlist tier records that WE like a symbol. Adding a ticker
  //      to the S-tier list raised its conviction score by 8 with no change in
  //      the tape — the engine rewarding its owner's preference and calling the
  //      result confidence. It inflated hardest on exactly the names already
  //      carrying the most bias, which is the worst place to add any.
  //
  //   2. R:R WAS DOUBLE-COUNTED, and gameable. R:R is a property of the PLAN, set
  //      by where the target is put — and targets are not always structural (the
  //      bear-flag scanner still uses `price * (1 - min(bounce*2, 15)/100)`, a
  //      flat percentage). Scoring R:R meant conviction could be raised by moving
  //      the target further away. Confidence should never be a function of an
  //      output we chose ourselves.
  //
  // The tier still SHOWS — knowing a name is S-tier is useful routing information
  // — it just no longer votes. Deleting the layer outright would have hidden that
  // context; zeroing it keeps the fact and removes the vote.
  //
  // ⚠️ Bands were tuned assuming this contributed ("S = 30+ (technical + tier +
  // convergence + regime + sector all firing)"). Every watchlist name now scores
  // up to 10 lower, so some S-band signals become A. That is the correction, not
  // a regression — but the thresholds deserve a fresh look against real output.
  const SCORING_POINTS = 0;
  void points; // retained above so the tier mapping stays readable

  return {
    kind: "fundamental", // re-using the fundamental kind for tier (no separate UI bucket needed)
    label: "Watchlist Tier",
    points: SCORING_POINTS,
    why: `${reasons.join(" · ")} · context only, not scored`,
    data: { tier },
  };
}

function scoreConvergenceLayer(conv: ConvergenceAnalysis | null | undefined, direction: "long" | "short"): ConvictionLayer | null {
  if (!conv || !Array.isArray(conv.signals) || conv.signals.length === 0) return null;

  // Only count signals aligned with the trade direction
  const aligned = conv.signals.filter((s) => {
    if (direction === "long") return s.direction === "bullish" || s.direction === "neutral";
    return s.direction === "bearish" || s.direction === "neutral";
  });

  if (aligned.length === 0) return null;

  // Convergence is agreement between independent evidence SOURCES, not the
  // number of indicators one scanner ran over the same OHLCV series. Before
  // this gate, a bear-flag scanner could submit eleven daily-chart checks and
  // receive the same 18-point boost as price action + options flow + sector +
  // catalyst all agreeing. That made a single pattern look like a complete
  // thesis. One source gets no convergence credit; the other conviction layers
  // (sector, GEX, breadth, catalyst, regime) have to earn it.
  const sources = Array.from(new Set(aligned.map((s) => s.source)));
  if (sources.length < 2) return null;
  const points = Math.min(16, sources.length * 4);

  return {
    kind: "convergence",
    label: `Convergence ${sources.length} sources`,
    points,
    why: `${sources.length} independent sources agree: ${sources.slice(0, 4).join(", ")}${sources.length > 4 ? "…" : ""}`,
    data: { signalCount: aligned.length, sourceCount: sources.length, sources, primaryThesis: conv.primaryThesis },
  };
}

function scoreCatalystLayer(idea: any, direction: "long" | "short"): ConvictionLayer | null {
  const isNews = idea.isNewsCatalyst === true;
  const newsBias = idea.newsBias as "bullish" | "bearish" | "neutral" | null;
  const earningsBeat = idea.earningsBeat;
  // Earnings surprise % can come from three places, in priority order:
  //   1. dedicated column on the idea (future schema)
  //   2. sourceMetadata JSON
  //   3. inline tag inside the catalyst text "[surprise=+12.4%]" — this is
  //      what universal-idea-generator currently writes (no schema migration).
  const inlineMatch =
    typeof idea.catalyst === "string"
      ? idea.catalyst.match(/\[surprise=([+-]?\d+(?:\.\d+)?)%\]/)
      : null;
  // Only the inline tag is real. This used to try idea.earningsSurprisePct first
  // and idea.sourceMetadata?.earningsSurprisePct second — NEITHER column exists on
  // trade_ideas (verified against shared/schema.ts), and the `as any` row typing
  // hid it, so both reads were permanently undefined and every idea outside
  // universal-idea-generator silently fell through to the flat score. The tag is
  // written by server/universal-idea-generator.ts as `[surprise=+X%]`.
  const surprisePctRaw = inlineMatch ? parseFloat(inlineMatch[1]) : null;
  const surprisePct = Number.isFinite(surprisePctRaw) ? (surprisePctRaw as number) : null;

  const reasons: string[] = [];
  let points = 0;

  if (isNews && newsBias) {
    const aligned =
      (direction === "long" && newsBias === "bullish") ||
      (direction === "short" && newsBias === "bearish");
    if (aligned) {
      points += 8;
      reasons.push(`News catalyst (${newsBias})`);
    } else if (newsBias === "neutral") {
      points += 3;
      reasons.push("News catalyst (neutral)");
    }
  }

  // Earnings beat/miss — magnitude-aware.
  // We previously gave a flat +4 for any beat. Now we scale:
  //   |surprise| <  3%  : +2  (in-line, low signal)
  //   |surprise| 3–10%  : +4  (solid beat/miss)
  //   |surprise| 10–25% : +6  (strong)
  //   |surprise| > 25%  : +8  (blowout)
  // The flat +4 stays as fallback when magnitude isn't available so we
  // don't regress historical ideas that lack the new field.
  if (earningsBeat === true && direction === "long") {
    if (surprisePct !== null && surprisePct > 0) {
      const mag = Math.abs(surprisePct);
      const earned = mag > 25 ? 8 : mag >= 10 ? 6 : mag >= 3 ? 4 : 2;
      points += earned;
      reasons.push(`Earnings beat +${surprisePct.toFixed(1)}%`);
    } else {
      points += 4;
      reasons.push("Earnings beat");
    }
  } else if (earningsBeat === false && direction === "short") {
    if (surprisePct !== null && surprisePct < 0) {
      const mag = Math.abs(surprisePct);
      const earned = mag > 25 ? 8 : mag >= 10 ? 6 : mag >= 3 ? 4 : 2;
      points += earned;
      reasons.push(`Earnings miss ${surprisePct.toFixed(1)}%`);
    } else {
      points += 4;
      reasons.push("Earnings miss");
    }
  }

  // ── RISK SIDE (bidirectional) — a catalyst is also uncertainty ──────────
  // Until now this layer only ever ADDED points. But an event is a two-way
  // thing: a reason a move could happen AND a reason to stand aside. These two
  // checks let the layer go NEGATIVE, so a risky setup grades lower.

  // 1) News that CONTRADICTS the trade direction is a headwind, not neutral.
  let eventRisk = false;
  if (isNews && newsBias && newsBias !== "neutral") {
    const misaligned =
      (direction === "long" && newsBias === "bearish") ||
      (direction === "short" && newsBias === "bullish");
    if (misaligned) {
      points -= 6;
      eventRisk = true;
      reasons.push(`Headwind: ${newsBias} news vs ${direction}`);
    }
  }

  // 2) An UNRESOLVED binary/high-variance event held through the trade is risk,
  //    not a reason to size up ("burning cash into the print"). Detect scheduled
  //    binary events from the catalyst text that still read as ahead (pre / into /
  //    upcoming / a near date). Past earnings are already scored via earningsBeat,
  //    so we only fire when the event hasn't happened yet. Penalty scales with how
  //    long we'd sit through it — position/swing hold through it; day trades often
  //    exit before. Conservative: requires BOTH a binary keyword AND ahead-framing.
  const cText = typeof idea.catalyst === "string" ? idea.catalyst.toLowerCase() : "";
  const BINARY = /\b(earnings|fda|pdufa|adcom|ruling|verdict|court|decision|readout|guidance|fomc|cpi)\b/;
  const AHEAD = /\b(ahead of|before|into|pre[\s-]|upcoming|expected|scheduled|next week|tomorrow|this week|awaiting)\b/;
  const earningsAlreadyResolved = idea.earningsBeat === true || idea.earningsBeat === false;
  if (!earningsAlreadyResolved && BINARY.test(cText) && AHEAD.test(cText)) {
    const hp = idea.holdingPeriod;
    const risk = hp === "position" ? 8 : hp === "swing" || hp === "week-ending" ? 6 : 3;
    points -= risk;
    eventRisk = true;
    reasons.push(`Event risk: unresolved binary catalyst ahead (${hp} hold)`);
  }

  // A scanner setup description is not an event catalyst. Technical patterns
  // already score in Signals/Technical; generic free text earns no extra point.
  if (points === 0) return null;
  return {
    kind: "catalyst",
    label: points < 0 ? "Catalyst Risk" : "Catalyst",
    points,
    why: reasons.join(" · "),
    data: { isNews, newsBias, earningsBeat, surprisePct, eventRisk },
  };
}

function scoreRegimeLayer(direction: "long" | "short", ctx: MarketContext): ConvictionLayer | null {
  const reasons: string[] = [];
  let points = 0;

  const aligned =
    (direction === "long" && (ctx.preferredDirection === "LONG" || ctx.preferredDirection === "BOTH")) ||
    (direction === "short" && (ctx.preferredDirection === "SHORT" || ctx.preferredDirection === "BOTH"));

  if (aligned) {
    points += 5;
    reasons.push(`Regime ${ctx.regime} prefers ${ctx.preferredDirection}`);
  } else {
    // Counter-regime trades take a small penalty
    points -= 3;
    reasons.push(`Counter-regime (${ctx.regime} prefers ${ctx.preferredDirection})`);
  }

  if (direction === "long" && ctx.riskSentiment === "risk_on") {
    points += 3;
    reasons.push("Risk-on tape");
  } else if (direction === "short" && ctx.riskSentiment === "risk_off") {
    points += 3;
    reasons.push("Risk-off tape");
  }

  if (ctx.vixLevel !== null) {
    if (direction === "long" && ctx.vixLevel < 18) {
      points += 2;
      reasons.push(`VIX ${ctx.vixLevel.toFixed(1)} (calm)`);
    } else if (direction === "short" && ctx.vixLevel > 22) {
      points += 2;
      reasons.push(`VIX ${ctx.vixLevel.toFixed(1)} (fear)`);
    }
  }

  return {
    kind: "regime",
    label: "Market Regime",
    points,
    why: reasons.join(" · "),
    data: { regime: ctx.regime, riskSentiment: ctx.riskSentiment, vix: ctx.vixLevel },
  };
}

/**
 * Market breadth confluence — confirms or contradicts the price-based regime.
 * A name flagged "S band" during a deteriorating breadth tape is a very
 * different trade than the same name during a thrust day. Score:
 *   thrust         long +6,   short -4
 *   expanding      long +4,   short -2
 *   neutral        0
 *   deteriorating  long -3,   short +2
 *   washout        long -4,   short +5  (oversold extreme also rewards bounces)
 *
 * The breadth.bias field is already a -10..+10 directional score; we
 * convert it directly so future regime tweaks flow through automatically.
 */
function scoreBreadthLayer(
  direction: "long" | "short",
  breadth: MarketBreadthSnapshot | null,
): ConvictionLayer | null {
  if (!breadth || breadth.sampleSize === 0) return null;

  const directional = direction === "long" ? breadth.bias : -breadth.bias;
  // Clamp to a sensible per-layer point budget so breadth can't dominate.
  const points = Math.max(-5, Math.min(6, Math.round(directional * 0.7)));
  if (points === 0) return null;

  return {
    kind: "breadth",
    label: "Breadth",
    points,
    why: breadth.interpretation,
    data: {
      regime: breadth.regime,
      advanceDeclineRatio: breadth.advanceDeclineRatio,
      percentAbove200MA: breadth.percentAbove200MA,
      percentAbove50MA: breadth.percentAbove50MA,
      newHighsLows: breadth.newHighsLows,
      sampleSize: breadth.sampleSize,
    },
  };
}

/**
 * Analyst confluence — rewards trades that align with sell-side consensus.
 * Yahoo's recommendationMean is 1.0 (strong buy) → 5.0 (sell). We pair
 * that with 12-month price target upside and require ≥3 analysts before
 * the layer fires (single-analyst targets are noise).
 *
 * Long trades:
 *   meanRec ≤ 1.8 + upside ≥ 15%   → +6   (strong buy + room)
 *   meanRec ≤ 2.3 + upside ≥ 8%    → +4   (buy)
 *   meanRec ≤ 2.7                  → +2   (mild buy)
 *   meanRec ≥ 3.5                  → -3   (sell-rated, headwind)
 *
 * Short trades flip the sign on meanRec / upside.
 */
function scoreAnalystLayer(
  snap: AnalystSnapshot | null,
  direction: "long" | "short",
  entryPrice: number,
  livePrice?: number,
): ConvictionLayer | null {
  if (!snap) return null;
  if ((snap.numberOfAnalysts ?? 0) < 3) return null;
  if (snap.recommendationMean === null && snap.targetMeanPrice === null) return null;

  const meanRec = snap.recommendationMean ?? 3;
  // Use live price for upside calc — entry price can be far from current
  // spot after a big move, inflating/deflating the upside unrealistically.
  const refPrice = (livePrice && livePrice > 0) ? livePrice : entryPrice;
  const upsidePct =
    snap.targetMeanPrice && refPrice > 0
      ? ((snap.targetMeanPrice - refPrice) / refPrice) * 100
      : null;

  const reasons: string[] = [];
  let points = 0;

  if (direction === "long") {
    if (meanRec <= 1.8 && (upsidePct ?? 0) >= 15) {
      points = 6;
      reasons.push(`Strong buy ${meanRec.toFixed(1)}/5`);
      if (upsidePct !== null) reasons.push(`+${upsidePct.toFixed(0)}% to target`);
    } else if (meanRec <= 2.3 && (upsidePct ?? 0) >= 8) {
      points = 4;
      reasons.push(`Buy ${meanRec.toFixed(1)}/5`);
      if (upsidePct !== null) reasons.push(`+${upsidePct.toFixed(0)}% to target`);
    } else if (meanRec <= 2.7) {
      points = 2;
      reasons.push(`Outperform ${meanRec.toFixed(1)}/5`);
    } else if (meanRec >= 3.5) {
      points = -3;
      reasons.push(`Sell-rated ${meanRec.toFixed(1)}/5`);
    }
  } else {
    // Short trades — invert
    if (meanRec >= 3.5 && (upsidePct ?? 0) <= -10) {
      points = 6;
      reasons.push(`Sell-rated ${meanRec.toFixed(1)}/5`);
      if (upsidePct !== null) reasons.push(`${upsidePct.toFixed(0)}% to target`);
    } else if (meanRec >= 3.0 && (upsidePct ?? 0) <= -5) {
      points = 4;
      reasons.push(`Underperform ${meanRec.toFixed(1)}/5`);
    } else if (meanRec >= 2.7) {
      points = 2;
      reasons.push(`Hold ${meanRec.toFixed(1)}/5`);
    } else if (meanRec <= 2.0) {
      points = -3;
      reasons.push(`Buy-rated ${meanRec.toFixed(1)}/5 (against trade)`);
    }
  }

  if (points === 0) return null;
  return {
    kind: "analyst",
    label: "Analyst",
    points,
    why: reasons.join(" · "),
    data: {
      recommendationKey: snap.recommendationKey,
      meanRec,
      targetMeanPrice: snap.targetMeanPrice,
      numberOfAnalysts: snap.numberOfAnalysts,
      upsidePct,
    },
  };
}

function scoreGeopoliticalLayer(
  symbol: string,
  sector: Sector,
  direction: "long" | "short",
  geo: { risk: string; activeScenarios: string[] },
): ConvictionLayer | null {
  const reasons: string[] = [];
  let points = 0;

  // Defense / energy / crypto names benefit from elevated risk regimes
  const benefitsFromRisk = sector === "energy" || sector === "crypto";
  const hurtByRisk = sector === "software" || sector === "fintech" || sector === "mega_tech";

  if (geo.risk === "ELEVATED") {
    if (direction === "long" && benefitsFromRisk) {
      points += 4;
      reasons.push(`${sector} benefits from elevated geopolitical risk`);
    } else if (direction === "long" && hurtByRisk) {
      points -= 3;
      reasons.push(`${sector} hurt by elevated risk`);
    } else if (direction === "short" && hurtByRisk) {
      points += 3;
      reasons.push(`${sector} weakness in risk-off tape`);
    }
  } else if (geo.risk === "LOW") {
    if (direction === "long" && hurtByRisk) {
      points += 2;
      reasons.push(`${sector} bid in low-risk regime`);
    }
  }

  // Active scenarios mention
  if (geo.activeScenarios.length > 0) {
    const scenarioList = geo.activeScenarios.slice(0, 2).join(", ");
    if (points !== 0) reasons.push(`Active: ${scenarioList}`);
  }

  if (points === 0 && reasons.length === 0) return null;
  return {
    kind: "geopolitical",
    label: "Geopolitical",
    points,
    why: reasons.length > 0 ? reasons.join(" · ") : `Risk ${geo.risk}`,
    data: { risk: geo.risk, sector, activeScenarios: geo.activeScenarios },
  };
}

/**
 * SECTOR ROTATION layer — the "follow the money flow" gate.
 *
 * This is the single most important sanity check on a directional idea:
 * you do not go long the sector money is fleeing, no matter how clean the
 * chart. We measure *relative* rotation (sector ETF vs SPY), so a broad
 * selloff doesn't punish everything — only the names underperforming the
 * tape, which is exactly the rotation signal.
 *
 * The penalty is deliberately HEAVY (up to ±14) — heavier than any single
 * bullish layer — so a long in a bleeding sector (e.g. semis −7% pre-market)
 * cannot survive in the ELITE band. That was the core defect: 15 chips shown
 * as ELITE BULLISH on the morning the whole group got wrecked.
 */
async function scoreSectorLayer(symbol: string, sector: Sector, direction: "long" | "short"): Promise<ConvictionLayer | null> {
  try {
    const { getRotationForSector } = await import("./sector-rotation");
    const sig = await getRotationForSector(sector);
    if (!sig || sig.etf === "SPY") return null;

    const rel = sig.relChange; // sector change minus SPY change, %
    let points = 0;
    let why = "";

    const relStr = `${rel >= 0 ? "+" : ""}${rel.toFixed(1)}% vs SPY`;
    const chgStr = `${sig.change >= 0 ? "+" : ""}${sig.change.toFixed(1)}%`;

    // HEADWIND vs TAILWIND, applied the same way on both sides.
    //
    // The asymmetry is deliberate and kept: trading against rotation is worse than
    // riding it, and the board runs heavily long, so a headwind is weighted harder
    // than an equivalent tailwind. What changed is the SHAPE.
    //
    // The old curve multiplied linearly and clipped at −14, which it reached at
    // −3.5% relative. Beyond that the layer stopped carrying information: a sector
    // down 3.5% against SPY and one down 10% both scored −14, so "leaning against
    // you" and "actively collapsing" were indistinguishable. It also fired at full
    // strength on a single −3.5% day that might be noise.
    //
    // A saturating curve keeps the same worst case but approaches it gradually, so
    // severity still registers all the way out and a marginal day no longer maxes
    // the penalty. The short side used a symmetric ±10 for no stated reason; one
    // philosophy now applies to both.
    const HEADWIND_MAX = 14;   // worst case against the position
    const TAILWIND_MAX = 8;    // best case for it — deliberately smaller
    const HALF = 2.0;          // % relative at which half the maximum is reached

    /**
     * Saturating magnitude — max * m/(m + HALF). Zero at zero, half of `max` at
     * HALF, and approaching `max` asymptotically without ever reaching it. That
     * last property is the point: the layer keeps distinguishing −5% from −12%
     * instead of clipping both to the same number, and no single day can max it.
     */
    const curve = (magnitude: number, max: number) =>
      Math.round(max * (magnitude / (magnitude + HALF)));

    const against = direction === "long" ? rel <= -INFLOW_GATE : rel >= INFLOW_GATE;
    const withUs = direction === "long" ? rel >= INFLOW_GATE : rel <= -INFLOW_GATE;
    const mag = Math.abs(rel);

    if (against) {
      points = -Math.min(HEADWIND_MAX, curve(mag, HEADWIND_MAX));
      why = direction === "long"
        ? `🩸 ${sig.name} ${chgStr} (${relStr}) — money rotating OUT, fading longs`
        : `${sig.name} ${chgStr} (${relStr}) — sector bid, fights short`;
    } else if (withUs) {
      points = Math.min(TAILWIND_MAX, curve(mag, TAILWIND_MAX));
      why = direction === "long"
        ? `${sig.name} ${chgStr} (${relStr}) — sector catching inflows`
        : `${sig.name} ${chgStr} (${relStr}) — sector bleeding, confirms short`;
    } else {
      return null;
    }

    if (points === 0) return null;

    return {
      kind: "sector",
      label: "Sector Rotation",
      points,
      why,
      data: {
        etf: sig.etf,
        name: sig.name,
        change: sig.change,
        relChange: sig.relChange,
        fiveDayChange: sig.fiveDayChange,
        state: sig.state,
      },
    };
  } catch {
    return null;
  }
}

// Minimum relative move (% vs SPY) to treat as a real inflow/outflow.
const INFLOW_GATE = 0.4;

/**
 * TA Confluence layer — folds the structured technical read (Fibonacci position,
 * candlestick patterns, market structure, EMA/RSI confluence) into the score.
 *
 * The existing "technical" layer scores RSI/MACD/trend off fields already on the
 * idea. THIS layer adds what those didn't have: price sitting at a key Fib, a
 * confirmed candlestick reversal/continuation, and market-structure (HH/HL).
 *
 * The TA engine returns a bias score on a −100..+100 scale (positive = bullish).
 * We align it to the trade's direction and compress to a modest ±8 layer weight
 * so it confirms/contradicts rather than dominates. Cached fetch → safe to run
 * across the whole shortlist. Returns null on no data (never fabricates).
 */
/**
 * Compression layer — Darvas-style consolidation + TTM Squeeze.
 *
 * "Consolidation creates opportunity because the market is storing energy." A tested,
 * tight range is a coiled spring with definable risk, and it's the setup that rewards
 * waiting rather than chasing. Compression is directionless, so this only pays out when
 * price is pressing the side that would CONFIRM the trade — and goes negative when the
 * name is coiled at the wrong end, because that breakout runs against us.
 *
 * Capped at ±6 so it supports a thesis instead of creating one. Null on thin data.
 */
async function scoreCompressionLayer(symbol: string, direction: "long" | "short"): Promise<ConvictionLayer | null> {
  try {
    const { analyzeCompression, compressionPoints } = await import("./compression-engine");
    const r = await fetch(
      `http://127.0.0.1:${process.env.PORT || 5000}/api/historical-prices/${encodeURIComponent(symbol)}?range=6mo&interval=1d`,
    );
    if (!r.ok) return null;
    const body = await r.json();
    const candles = body?.data ?? [];
    if (!Array.isArray(candles) || candles.length < 40) return null;

    const read = analyzeCompression(candles);
    const scored = compressionPoints(read, direction);
    if (!scored) return null;

    return {
      kind: "compression",
      label: "Compression",
      points: scored.points,
      why: scored.why,
      data: {
        quality: read.quality,
        boxHigh: read.boxHigh,
        boxLow: read.boxLow,
        boxWidthPct: read.boxWidthPct,
        squeezeBars: read.squeezeBars,
        positionInBox: read.positionInBox,
      },
    };
  } catch {
    return null;
  }
}

async function scoreTALayer(symbol: string, direction: "long" | "short"): Promise<ConvictionLayer | null> {
  try {
    const { getCachedTARead } = await import("./ta-engine");
    const ta = await getCachedTARead(symbol, "6mo", "1d");
    if (!ta) return null;

    // Align bias to the trade: a bullish read helps a long and hurts a short.
    const aligned = direction === "long" ? ta.bias.score : -ta.bias.score;
    const points = Math.round((aligned / 100) * 8);
    if (points === 0) return null;

    // The most relevant confluence reasons (cap to keep the why one-liner tight).
    const reasons = ta.bias.confluence.slice(0, 3).join(" · ");
    const verb = points > 0 ? "confirms" : "contradicts";
    const why = reasons
      ? `TA ${verb} ${direction}: ${reasons}`
      : `TA ${verb} ${direction} (bias ${ta.bias.score})`;

    return {
      kind: "ta",
      label: "TA Confluence",
      points,
      why,
      data: {
        biasScore: ta.bias.score,
        biasDirection: ta.bias.direction,
        fibZone: ta.fib?.currentZone ?? null,
        structure: ta.structure?.trend ?? null,
        patterns: ta.patterns.filter((p) => p.detected).map((p) => p.name),
      },
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Freshness + live re-validation
// ─────────────────────────────────────────────────────────────

/**
 * Convert an idea's `holdingPeriod` field into a hard maximum age (hours).
 * Day/intraday ideas decay fast — a "+5% intraday momentum" idea has no
 * business surviving 6 hours, let alone 56. Swing ideas get more rope.
 */
function maxAgeHoursForIdea(idea: any): number {
  const hp: string = (idea.holdingPeriod || idea.tradeType || "").toLowerCase();

  // Base caps (market-hours only logic)
  let cap: number;
  if (hp.includes("day") || hp.includes("intraday") || hp.includes("scalp")) cap = 6;
  else if (hp.includes("swing")) cap = 36;
  else if (hp.includes("position") || hp.includes("long")) cap = 96;
  else cap = 24; // unknown → swing default

  /**
   * The caps above are MARKET hours, and ideaAgeHours now measures market hours
   * too, so no weekend patch is needed here.
   *
   * The previous version added a +52h buffer only while the clock was inside a
   * weekend window — Sat, Sun, Friday after 8pm ET, or Monday before 4am ET.
   * The moment Monday passed 04:00 ET the buffer vanished, so Friday's swing
   * ideas (36h cap) were suddenly ~75h old and every one of them was culled
   * before Monday's open. Observed 2026-08-31 at 12:44 ET: "age cap removed 7
   * stale ideas (kept 1)", and the board rendered empty for the whole session
   * behind a message blaming an unrelated database migration.
   *
   * Counting only market hours makes the cap mean what it says: a 36h swing
   * idea survives roughly five trading sessions' worth of clock, and a weekend
   * costs it nothing, whatever day it is read on.
   */
  return cap;
}

/**
 * Hours elapsed between two instants, counting only Mon-Fri.
 *
 * A calendar hour over a weekend is not an hour of market exposure — nothing
 * can move against the idea while the market is shut — so ageing it by wall
 * clock punishes a Friday signal for the sole crime of being read on a Monday.
 * Weekday hours are counted whole (including overnight) because the caps were
 * written against that scale; only Saturday and Sunday are excluded.
 */
function marketHoursBetween(startMs: number, endMs: number): number {
  if (!(endMs > startMs)) return 0;

  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  // Walk day boundaries in ET so a weekend is identified by the market's
  // calendar, not the server's locale.
  const etDay = (ms: number): number =>
    new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();

  let hours = 0;
  let cursor = startMs;
  // Cap the walk so a corrupt timestamp cannot spin: 400 days is far past any
  // cap and still bounded.
  const limit = Math.min(endMs, startMs + 400 * DAY);

  while (cursor < limit) {
    const nextBoundary = Math.min(cursor + DAY, limit);
    const d = etDay(cursor);
    if (d !== 0 && d !== 6) {
      hours += (nextBoundary - cursor) / HOUR;
    }
    cursor = nextBoundary;
  }
  return hours;
}

/**
 * Compute idea age in hours from its timestamp.
 */
function ideaAgeHours(idea: any): number {
  const ts = idea.generationTimestamp || idea.timestamp;
  if (!ts) return 0;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return 0;
  // Market hours, not wall clock — see maxAgeHoursForIdea.
  return marketHoursBetween(t, Date.now());
}

/**
 * Sentiment-vs-direction sanity check. Catches the SHOP-style bug where
 * an idea is marked `direction: long` but the catalyst text says
 * "Bearish momentum (-2.8%)". One of the upstream scanners is mislabeling.
 */
function catalystContradictsDirection(idea: any, direction: "long" | "short"): boolean {
  const text = typeof idea.catalyst === "string" ? idea.catalyst.toLowerCase() : "";
  if (!text) return false;
  const bearishWords = /bearish|breakdown|downtrend|selloff|gap down|distribution|sell-off/;
  const bullishWords = /bullish|breakout|uptrend|surge|gap up|accumulation|rally/;
  if (direction === "long" && bearishWords.test(text) && !bullishWords.test(text)) return true;
  if (direction === "short" && bullishWords.test(text) && !bearishWords.test(text)) return true;
  return false;
}

/**
 * Pre-market layer — scores how the morning gap aligns with the trade direction.
 *
 * Logic: pre-market action is a leading signal for opening direction. A long
 * idea getting confirmed by an up-gap means the overnight tape agrees with
 * the thesis; a down-gap means overnight tape disagrees and the entry is
 * suspect.
 *
 *   Long  + gap up   ≥1%  → +4  ("pre-market confirming")
 *   Long  + gap up   ≥3%  → +5  ("pre-market strong confirming")
 *   Long  + gap down ≥1%  → −4  ("pre-market fading")
 *   Long  + gap down ≥3%  → −6  ("pre-market reversing")
 *   Short, inverse.
 *   Flat (|gap| <1%)      → no layer
 */
function scorePreMarketLayer(
  direction: "long" | "short",
  snap: PreMarketSnapshot | undefined,
): ConvictionLayer | null {
  if (!snap) return null;
  // When the market is closed (weekends / holidays) the "gap" is just
  // last session's return, not an actual pre-market signal.  Skip it —
  // the freshness layer already penalizes staleness.
  if (snap.phase === "closed") return null;
  const gap = snap.gapPct;
  if (!Number.isFinite(gap) || Math.abs(gap) < 1) return null;

  // Sign aligned with the trade direction
  const aligned = direction === "long" ? gap : -gap;
  let points = 0;
  let label: string;
  if (aligned >= 3) {
    points = 5;
    label = "Pre-market strong confirming";
  } else if (aligned >= 1) {
    points = 4;
    label = "Pre-market confirming";
  } else if (aligned <= -3) {
    points = -6;
    label = "Pre-market reversing";
  } else if (aligned <= -1) {
    points = -4;
    label = "Pre-market fading";
  } else {
    return null;
  }

  const sign = gap >= 0 ? "+" : "";
  return {
    kind: "premarket",
    label: "Pre-Market",
    points,
    why: `${label} (${sign}${gap.toFixed(2)}% gap, ${snap.phase.replace("_", "-")})`,
    data: {
      gapPct: Number(gap.toFixed(2)),
      direction: snap.gapDirection,
      phase: snap.phase,
      preMarketGapPct: snap.preMarketGapPct,
      openingGapPct: snap.openingGapPct,
    },
  };
}

/**
 * GEX confluence layer — gamma exposure as a directional confidence signal.
 *
 * The dealer-positioning lens:
 *   - **Positive gamma** (dealers long gamma): they hedge by selling rallies,
 *     buying dips → price tends to mean-revert toward max-gamma strike.
 *     A long entry below the flip = pinned, low conviction. Above the flip,
 *     rallying through a positive-gamma zone is *supported*.
 *   - **Negative gamma** (dealers short gamma): they hedge by chasing — sells
 *     beget more sells, rallies beget more buys → vol expands. A short under
 *     the flip is the high-conviction setup; a long above the flip rides the
 *     squeeze.
 *
 * Wall proximity adds a pin-risk modifier (within 1.5% of call wall caps long
 * upside; within 1.5% of put wall caps short downside).
 *
 *   Long  + above flip + positive gamma  →  +3  ("dealers support trend")
 *   Long  + above flip + negative gamma  →  +5  ("vol expansion in your direction")
 *   Long  + below flip + positive gamma  →  −2  ("pinned, dealer resistance")
 *   Long  + below flip + negative gamma  →  −5  ("vol expansion against you")
 *   Short, inverse.
 *   Within 1.5% of call wall (long)      →  −2 modifier
 *   Within 1.5% of put wall  (short)     →  −2 modifier
 *
 * Returns null when GEX data is unavailable or distance to flip is unknown.
 */
function scoreGexLayer(
  direction: "long" | "short",
  snap: GexSnapshot | undefined,
): ConvictionLayer | null {
  if (!snap || !snap.regime) return null;

  /**
   * A NULL FLIP IS A READING, NOT A GAP.
   *
   * This used to require flipDistancePct !== null and discard everything else.
   * But a symbol whose whole gamma curve sits on one side has no crossing —
   * measured on SPY: totalGEX −4.42B, regime negative_gamma, flip = null. That
   * is the most decisive negative-gamma book on the board, and it was the one
   * reading being thrown away.
   *
   * When there is no flip, "above/below flip" is answered by the regime itself:
   * an all-negative curve means spot is effectively below any flip that would
   * exist, and an all-positive curve means the opposite.
   */
  const aboveFlip = snap.flipDistancePct !== null
    ? snap.flipDistancePct < 0
    : snap.regime === 'positive_gamma';
  const isPositive = snap.regime === "positive_gamma";
  const isNegative = snap.regime === "negative_gamma";
  if (!isPositive && !isNegative) return null; // neutral / transitioning — skip

  // Wall-fade detection — when spot is pinned at the OPPOSING wall under
  // positive gamma, the trade is a mean-revert *fade* of dealer hedging at
  // that wall, NOT a fight against a generic dealer floor/ceiling. The base
  // sign needs to flip in that case, otherwise the grader contradicts the
  // wall-fade scanner that originated the idea.
  const callWallDistPct =
    snap.callWall && snap.spot > 0
      ? ((snap.callWall - snap.spot) / snap.spot) * 100
      : null;
  const putWallDistPct =
    snap.putWall && snap.spot > 0
      ? ((snap.spot - snap.putWall) / snap.spot) * 100
      : null;
  const isShortAtCallWall =
    direction === "short" &&
    isPositive &&
    callWallDistPct !== null &&
    callWallDistPct >= 0 &&
    callWallDistPct <= 1.5;
  const isLongAtPutWall =
    direction === "long" &&
    isPositive &&
    putWallDistPct !== null &&
    putWallDistPct >= 0 &&
    putWallDistPct <= 1.5;

  let points = 0;
  let label: string;

  if (direction === "long") {
    if (isLongAtPutWall) {
      points = 3;
      label = "Wall fade — dealers buy dips at put wall";
    } else if (aboveFlip && isPositive) {
      points = 3;
      label = "Dealers support uptrend";
    } else if (aboveFlip && isNegative) {
      points = 5;
      label = "Vol expansion in your direction";
    } else if (!aboveFlip && isPositive) {
      points = -2;
      label = "Pinned below flip (dealer resistance)";
    } else {
      points = -5;
      label = "Vol expansion against you";
    }
  } else {
    if (isShortAtCallWall) {
      points = 3;
      label = "Wall fade — dealers sell rallies at call wall";
    } else if (!aboveFlip && isPositive) {
      points = 3;
      label = "Dealers support downtrend";
    } else if (!aboveFlip && isNegative) {
      points = 5;
      label = "Vol expansion in your direction";
    } else if (aboveFlip && isPositive) {
      points = -2;
      label = "Pinned above flip (dealer floor)";
    } else {
      points = -5;
      label = "Vol expansion against you";
    }
  }

  // Wall proximity modifier — only applies when the wall is *against* you.
  // Skipped entirely when this is already a wall-fade (handled above).
  let wallMod = 0;
  let wallNote = "";
  if (
    !isLongAtPutWall &&
    direction === "long" &&
    callWallDistPct !== null &&
    callWallDistPct > 0 &&
    callWallDistPct <= 1.5
  ) {
    wallMod = -2;
    wallNote = `, near call wall ${snap.callWall!.toFixed(2)} (+${callWallDistPct.toFixed(1)}%)`;
  } else if (
    !isShortAtCallWall &&
    direction === "short" &&
    putWallDistPct !== null &&
    putWallDistPct > 0 &&
    putWallDistPct <= 1.5
  ) {
    wallMod = -2;
    wallNote = `, near put wall ${snap.putWall!.toFixed(2)} (-${putWallDistPct.toFixed(1)}%)`;
  } else if (isShortAtCallWall) {
    wallNote = `, fading call wall ${snap.callWall!.toFixed(2)} (+${callWallDistPct!.toFixed(1)}%)`;
  } else if (isLongAtPutWall) {
    wallNote = `, fading put wall ${snap.putWall!.toFixed(2)} (-${putWallDistPct!.toFixed(1)}%)`;
  }

  // VEX modifier — vol regime cross-check (small ±1 nudge)
  let vexMod = 0;
  if (snap.vexRegime === "vol_tailwind" && points > 0) vexMod = 1;
  else if (snap.vexRegime === "vol_headwind" && points > 0) vexMod = -1;

  const finalPoints = points + wallMod + vexMod;
  // With no flip there is no distance to quote — say "no flip in the chain"
  // rather than printing a fabricated 0.0%.
  const flipDir = aboveFlip ? "above flip" : "below flip";
  const flipPhrase = snap.flipDistancePct !== null
    ? `${flipDir} by ${Math.abs(snap.flipDistancePct).toFixed(1)}%`
    : "no flip in the chain — curve is one-sided";
  const why =
    `${label} (${snap.regime.replace("_", " ")}, ${flipPhrase}${wallNote})`;

  return {
    kind: "gex",
    label: "GEX",
    points: finalPoints,
    why,
    data: {
      regime: snap.regime,
      vexRegime: snap.vexRegime,
      flipPoint: snap.flipPoint,
      flipDistancePct: snap.flipDistancePct,
      callWall: snap.callWall,
      putWall: snap.putWall,
      aboveFlip,
    },
  };
}

/**
 * Freshness layer — penalizes stale ideas so users see WHY a 12h old
 * "intraday momentum" pick got dropped. Layer points scale with age and
 * with how far the live price has drifted from the original entry.
 *
 * **Pre-market rescue:** if an idea is stale but the pre-market gap aligns
 * with its direction by ≥1%, the staleness penalty is softened (a 24h-old
 * idea that's gapping in its favor this morning is suddenly relevant again).
 */
function scoreFreshnessLayer(
  idea: any,
  direction: "long" | "short",
  liveQuote: RealtimeQuote | undefined,
  preMarket?: PreMarketSnapshot,
): ConvictionLayer | null {
  const ageH = ideaAgeHours(idea);
  const reasons: string[] = [];
  let points = 0;

  // Freshness has to match the thesis horizon. The old fixed 2/6/12-hour
  // thresholds treated a five-day swing exactly like an intraday scalp, so a
  // sound Friday swing reopened Monday with a -6 "very stale" penalty before
  // the market had given it another tradable session. These are calendar-hour
  // guardrails; price revalidation below remains the authority on whether the
  // original entry has actually become invalid or chased.
  const horizon = `${idea.holdingPeriod ?? ""} ${idea.tradeType ?? ""} ${idea.researchHorizon ?? ""}`.toLowerCase();
  const [freshUntil, staleAt, veryStaleAt] =
    /position|leap|long|thematic|multi[_ -]?week|month/.test(horizon)
      ? [168, 504, 1080]
      : /swing|short[_ -]?swing/.test(horizon)
        ? [24, 72, 120]
        : /week-ending|overnight/.test(horizon)
          ? [12, 36, 96]
          : [2, 6, 12];

  // Age decay — pure time penalty
  if (ageH < freshUntil) {
    points += 0;
  } else if (ageH < staleAt) {
    points -= 2;
    reasons.push(`${ageH.toFixed(1)}h into ${idea.holdingPeriod ?? "trade"} horizon`);
  } else if (ageH < veryStaleAt) {
    points -= 4;
    reasons.push(`${ageH.toFixed(1)}h into ${idea.holdingPeriod ?? "trade"} horizon (stale)`);
  } else {
    points -= 6;
    reasons.push(`${ageH.toFixed(0)}h into ${idea.holdingPeriod ?? "trade"} horizon (very stale)`);
  }

  // Pre-market rescue — overnight tape agrees with the thesis, so the
  // staleness penalty is dialed back. We don't fully cancel because the
  // entry/target/stop levels may still be wrong, but a gapping confirmation
  // earns back most of the age penalty.
  if (preMarket && Number.isFinite(preMarket.gapPct)) {
    const aligned = direction === "long" ? preMarket.gapPct : -preMarket.gapPct;
    if (aligned >= 1 && points < 0) {
      const rescue = aligned >= 3 ? Math.abs(points) : Math.min(3, Math.abs(points));
      points += rescue;
      reasons.push(`pre-market rescue +${rescue} (gap ${preMarket.gapPct >= 0 ? "+" : ""}${preMarket.gapPct.toFixed(1)}%)`);
    }
  }

  // Drift penalty — how far has price moved away from the entry?
  const entry = typeof idea.entryPrice === "number" ? idea.entryPrice : null;
  if (liveQuote && entry && entry > 0 && Number.isFinite(liveQuote.price)) {
    const driftPct = ((liveQuote.price - entry) / entry) * 100;
    const adverseDrift =
      direction === "long" ? driftPct < 0 : driftPct > 0;
    if (Math.abs(driftPct) >= 3 && adverseDrift) {
      // Adverse move against the trade — additional penalty
      points -= 2;
      reasons.push(
        `price ${driftPct >= 0 ? "+" : ""}${driftPct.toFixed(1)}% from entry (against)`,
      );
    } else if (Math.abs(driftPct) >= 3 && !adverseDrift) {
      // Already ran in the trade direction — entry is now a chase
      reasons.push(
        `price ${driftPct >= 0 ? "+" : ""}${driftPct.toFixed(1)}% from entry (chase)`,
      );
    }
  }

  if (points === 0 && reasons.length === 0) return null;
  return {
    kind: "freshness",
    label: "Freshness",
    points,
    why: reasons.length > 0 ? reasons.join(" · ") : "Fresh",
    data: {
      ageHours: Number(ageH.toFixed(1)),
      livePrice: liveQuote?.price ?? null,
      entryPrice: entry,
    },
  };
}

interface RevalidationResult {
  /** Live quote if available. */
  quote: RealtimeQuote | undefined;
  /** True if the idea should be HARD REJECTED (already stopped, chased, or contradiction). */
  reject: boolean;
  /** Diagnostic reason if rejected. */
  rejectReason: string | null;
}

/**
 * Live price re-validation. Runs after the candidate filter, before scoring.
 *
 * Hard reject conditions:
 *   1. Direction contradicts catalyst sentiment (mislabeled idea)
 *   2. Live price has already broken the stop loss (idea is dead)
 *   3. Live price has run >50% of the way to target (entry is now a chase)
 *
 * Anything that survives gets the freshness layer applied during scoring.
 */
function revalidateOne(
  idea: any,
  direction: "long" | "short",
  quote: RealtimeQuote | undefined,
): RevalidationResult {
  // 0. Level coherence — reject geometrically impossible ideas outright.
  //
  // The write-time gate validates levels on CREATE, but rows can still end up
  // incoherent afterwards (entry refreshed against a stale target/stop, a scanner
  // writing from a snapshot whose spot disagrees with the stored entry). Live rows
  // exist with a LONG target BELOW entry and a stop ABOVE it — e.g. IBM entry
  // $236.72 / target $105 / stop $240, published with an R:R of 40. Those must never
  // reach a user, whatever wrote them, so the read path re-checks the geometry.
  {
    const e = Number(idea.entryPrice), t = Number(idea.targetPrice), st = Number(idea.stopLoss);
    if (Number.isFinite(e) && Number.isFinite(t) && Number.isFinite(st) && e > 0) {
      const wrongSide =
        direction === "long" ? (t <= e || st >= e) : (t >= e || st <= e);
      if (wrongSide) {
        return {
          quote,
          reject: true,
          rejectReason: `incoherent levels for ${direction}: entry ${e} target ${t} stop ${st}`,
        };
      }
      const rr = Math.abs(t - e) / Math.max(Math.abs(e - st), 1e-9);
      // An R:R this extreme means the levels disagree with each other, not that we
      // found a 40-bagger.
      if (rr > 15) {
        return { quote, reject: true, rejectReason: `implausible R:R ${rr.toFixed(1)} — levels disagree` };
      }
    }
  }

  // 1. Catalyst/direction contradiction — always reject
  if (catalystContradictsDirection(idea, direction)) {
    return {
      quote,
      reject: true,
      rejectReason: `direction=${direction} contradicts catalyst "${idea.catalyst}"`,
    };
  }

  // No live quote — keep the idea, freshness layer will still apply age penalty
  if (!quote || !Number.isFinite(quote.price)) {
    return { quote, reject: false, rejectReason: null };
  }

  const live = quote.price;
  const entry = typeof idea.entryPrice === "number" ? idea.entryPrice : null;
  const target = typeof idea.targetPrice === "number" ? idea.targetPrice : null;
  const stop = typeof idea.stopLoss === "number" ? idea.stopLoss : null;

  if (entry === null) return { quote, reject: false, rejectReason: null };

  // 2. Already stopped out
  if (stop !== null) {
    if (direction === "long" && live <= stop) {
      return { quote, reject: true, rejectReason: `live ${live} ≤ stop ${stop}` };
    }
    if (direction === "short" && live >= stop) {
      return { quote, reject: true, rejectReason: `live ${live} ≥ stop ${stop}` };
    }
  }

  // 3. Already chased (price ran >50% of the way to target)
  if (target !== null) {
    const totalMove = Math.abs(target - entry);
    const realized = direction === "long" ? live - entry : entry - live;
    if (totalMove > 0 && realized / totalMove >= 0.5) {
      return {
        quote,
        reject: true,
        rejectReason: `price ran ${((realized / totalMove) * 100).toFixed(0)}% to target — chase`,
      };
    }
  }

  return { quote, reject: false, rejectReason: null };
}

/**
 * Public batch revalidation — used by /api/trade-ideas/best-setups so that
 * the 12+ downstream consumers (Top Conviction widget, high-conviction-alert,
 * home, landing, stock-detail, etc.) all benefit from the same Phase 1
 * freshness checks the convictions engine applies.
 *
 * Steps:
 *   1. Hard age cap based on holding period
 *   2. Catalyst/direction contradiction reject
 *   3. Live price reject (already stopped, already chased)
 *   4. Annotate survivors with currentPrice + driftPct + ageHours +
 *      freshnessFlags so the UI can show "5h old, +2.1% drift" context.
 */
export interface RevalidatedBestSetup {
  // Mutated copy of the original idea with extra fields:
  // currentPrice, driftPct, ageHours, freshnessFlags
  [key: string]: unknown;
}

export interface RevalidationDiagnostics {
  rejected: Array<{ symbol: string; reason: string }>;
  ageRejected: number;
  liveRejected: number;
}

export async function revalidateBestSetups(
  ideas: any[],
): Promise<{ kept: any[]; diagnostics: RevalidationDiagnostics }> {
  const diagnostics: RevalidationDiagnostics = {
    rejected: [],
    ageRejected: 0,
    liveRejected: 0,
  };
  if (!Array.isArray(ideas) || ideas.length === 0) {
    return { kept: [], diagnostics };
  }

  // Age cap pass
  const ageGated: any[] = [];
  for (const idea of ideas) {
    const ageH = ideaAgeHours(idea);
    const cap = maxAgeHoursForIdea(idea);
    if (ageH > cap) {
      diagnostics.ageRejected++;
      diagnostics.rejected.push({
        symbol: idea.symbol,
        reason: `age ${ageH.toFixed(1)}h > cap ${cap}h`,
      });
      continue;
    }
    ageGated.push(idea);
  }

  if (ageGated.length === 0) return { kept: [], diagnostics };

  // Batch live quote fetch. Same mapping as the revalidation path below: an idea's
  // symbol is the underlying, so an "option" idea still needs the UNDERLYING quote —
  // asking for an option named "AMZN" resolves to nothing.
  const validAssetTypes = new Set(["stock", "crypto", "option", "futures"]);
  const quoteRequests = ageGated.map((idea: any) => {
    const at = typeof idea.assetType === "string" ? idea.assetType.toLowerCase() : "stock";
    const resolved = validAssetTypes.has(at) ? (at === "option" ? "stock" : at) : "stock";
    return {
      symbol: idea.symbol,
      assetType: resolved as "stock" | "crypto" | "option" | "futures",
    };
  });
  let quoteMap = new Map<string, RealtimeQuote>();
  try {
    quoteMap = await getRealtimeBatchQuotes(quoteRequests);
  } catch (err) {
    logger.warn("[BEST-SETUPS] live quote batch failed, keeping ideas without revalidation:", err);
  }

  // The batch quote service silently DROPS symbols when the upstream providers throttle,
  // and returns nothing at all outside regular hours. Every pick then came back with
  // currentPrice = null, which is why the board showed "+0.0% P&L" on all 54 signals and
  // looked frozen: with no live price, P&L is measured entry-vs-entry.
  //
  // Fall back to the chart endpoint used by extended-hours — it needs no auth, works
  // pre/post-market, and is already behind the provider cache.
  const missing = quoteRequests
    .map((r) => r.symbol)
    .filter((sym) => {
      const q = quoteMap.get(sym);
      return !q || !Number.isFinite(q.price) || !q.price;
    });

  if (missing.length > 0) {
    try {
      const { fetchExtendedQuote } = await import("./extended-hours");
      const CONC = 8;
      let recovered = 0;
      for (let i = 0; i < missing.length; i += CONC) {
        const slice = missing.slice(i, i + CONC);
        const rows = await Promise.all(slice.map((sym) => fetchExtendedQuote(sym)));
        for (const q of rows) {
          if (q && Number.isFinite(q.lastPrice) && q.lastPrice > 0) {
            quoteMap.set(q.symbol, {
              symbol: q.symbol,
              price: q.lastPrice,
              changePercent: q.changePct,
            } as RealtimeQuote);
            recovered++;
          }
        }
      }
      logger.info(`[BEST-SETUPS] quote fallback recovered ${recovered}/${missing.length} live prices`);
    } catch (err) {
      logger.warn("[BEST-SETUPS] extended-hours quote fallback failed:", err);
    }
  }

  // Per-idea revalidation + annotation
  const kept: any[] = [];
  for (const idea of ageGated) {
    const dir: "long" | "short" =
      typeof idea.targetPrice === "number" && typeof idea.entryPrice === "number"
        ? idea.targetPrice > idea.entryPrice
          ? "long"
          : "short"
        : ((idea.direction || "long") as string).toLowerCase() === "short"
          ? "short"
          : "long";
    const quote = quoteMap.get(idea.symbol);
    const result = revalidateOne(idea, dir, quote);
    if (result.reject) {
      diagnostics.liveRejected++;
      diagnostics.rejected.push({
        symbol: idea.symbol,
        reason: result.rejectReason || "rejected",
      });
      continue;
    }

    const ageH = ideaAgeHours(idea);
    const livePrice = quote && Number.isFinite(quote.price) ? quote.price : null;
    const entry = typeof idea.entryPrice === "number" ? idea.entryPrice : null;
    let driftPct: number | null = null;
    if (livePrice !== null && entry !== null && entry !== 0) {
      driftPct = ((livePrice - entry) / entry) * 100;
    }

    const flags: string[] = [];
    if (ageH > 2) flags.push("aged");
    if (ageH > 6) flags.push("stale");
    if (driftPct !== null) {
      // Drift "against" the trade
      const against = dir === "long" ? -driftPct : driftPct;
      if (against >= 1) flags.push("drift_against");
      if (against >= 2.5) flags.push("drift_significant");
    }

    kept.push({
      ...idea,
      currentPrice: livePrice,
      driftPct: driftPct !== null ? Math.round(driftPct * 100) / 100 : null,
      ageHours: Math.round(ageH * 10) / 10,
      freshnessFlags: flags,
    });
  }

  if (diagnostics.ageRejected + diagnostics.liveRejected > 0) {
    logger.info(
      `[BEST-SETUPS] revalidation: kept ${kept.length}, rejected ${diagnostics.ageRejected} (age) + ${diagnostics.liveRejected} (live)`,
    );
  }

  return { kept, diagnostics };
}

// ─────────────────────────────────────────────────────────────
// Module-level cache so /api/trade-ideas/best-setups can reuse the
// expensive convictions pass without paying for it on every request.
// 60s TTL — short enough that the desk's 30s polling sees fresh data
// every other tick, long enough to absorb a refresh storm.
// ─────────────────────────────────────────────────────────────

const _convictionsCache = new Map<string, { data: ConvictionsResponse; expiresAt: number }>();
/**
 * MUST exceed the build time. A measured cold build is ~137s, and this was set
 * to 60s — so the entry expired more than twice as fast as it could possibly be
 * regenerated, and the engine lived in permanent rebuild: every minute it went
 * stale, a 137s refresh started, and it was stale again before that refresh
 * landed. That burned CPU and Yahoo rate limit continuously and still left the
 * board reading "still warming up" to anyone who arrived on a cold process.
 *
 * Five minutes is comfortably longer than the build, so a refresh finishes and
 * the entry is genuinely fresh for a while afterwards.
 */
const CONVICTIONS_CACHE_TTL_MS = 5 * 60_000;
// How long a stale entry may still be served (instantly) while a fresh build
// runs in the background. Past this, the next request rebuilds synchronously.
const CONVICTIONS_STALE_MS = 10 * 60_000;
// One in-flight build per cache key — concurrent callers share it instead of
// each kicking off a full (rate-limited, CPU-heavy) rebuild. This is what kills
// the "cold load takes 10s under request contention" problem.
const _convictionsInflight = new Map<string, Promise<ConvictionsResponse>>();

/**
 * A lifecycle write (trigger, execution, close) changes the meaning of a card
 * immediately. Do not leave a five-minute scoring snapshot claiming
 * PENDING TRIGGER after the audit row has advanced to triggered.
 */
export function invalidateConvictionsCache(): void {
  _convictionsCache.clear();
}

/**
 * Returns a cached convictions snapshot (60s TTL) or builds a fresh one.
 * Used by best-setups + /api/convictions to share one expensive scoring
 * pass — eliminating the score mismatch between the two parallel pipelines.
 *
 * Cache is keyed by the option fingerprint (lookback / limit / watchlist /
 * minScore / weeklyUserId / weeklyOnly) so per-user weekly boosts are
 * preserved without cross-contamination.
 */
/**
 * Non-blocking read of the convictions cache. Returns whatever is already there —
 * fresh OR stale — and null when the cache is cold. Never triggers a build.
 *
 * Secondary surfaces (the catalyst board, anything that merely ANNOTATES the
 * picks) must use this rather than getCachedConvictions: on a cold cache the full
 * build takes minutes, and a tab that hangs for minutes is worse than a tab that
 * honestly says the board is still warming up. The Oracle tab drives the actual
 * build; everyone else rides its cache.
 */
export function peekConvictions(
  opts: BuildConvictionsOptions = {},
): { data: ConvictionsResponse; stale: boolean } | null {
  const merged: BuildConvictionsOptions = {
    lookbackHours: opts.lookbackHours ?? 96,
    limit: opts.limit ?? 500,
    watchlistOnly: opts.watchlistOnly ?? false,
    minScore: opts.minScore ?? 0,
    weeklyUserId: opts.weeklyUserId,
    weeklyOnly: opts.weeklyOnly ?? false,
  };
  const hit = _convictionsCache.get(JSON.stringify(merged));
  if (!hit) return null;
  return { data: hit.data, stale: hit.expiresAt <= Date.now() };
}

export async function getCachedConvictions(
  opts: BuildConvictionsOptions = {},
): Promise<ConvictionsResponse> {
  const merged: BuildConvictionsOptions = {
    lookbackHours: opts.lookbackHours ?? 96,
    limit: opts.limit ?? 500,
    watchlistOnly: opts.watchlistOnly ?? false,
    minScore: opts.minScore ?? 0,
    weeklyUserId: opts.weeklyUserId,
    weeklyOnly: opts.weeklyOnly ?? false,
  };
  const key = JSON.stringify(merged);
  const now = Date.now();
  const hit = _convictionsCache.get(key);

  // Fresh — serve immediately.
  if (hit && hit.expiresAt > now) {
    return hit.data;
  }

  // Build (deduped): all concurrent callers for the same key await one promise.
  const build = (): Promise<ConvictionsResponse> => {
    const existing = _convictionsInflight.get(key);
    if (existing) return existing;
    const p = buildConvictions(merged)
      .then((data) => {
        _convictionsCache.set(key, { data, expiresAt: Date.now() + CONVICTIONS_CACHE_TTL_MS });
        // Bound the cache so distinct option combos don't grow unbounded.
        if (_convictionsCache.size > 16) {
          const oldest = Array.from(_convictionsCache.entries()).sort(
            (a, b) => a[1].expiresAt - b[1].expiresAt,
          )[0];
          if (oldest) _convictionsCache.delete(oldest[0]);
        }
        return data;
      })
      .finally(() => { _convictionsInflight.delete(key); });
    _convictionsInflight.set(key, p);
    return p;
  };

  // Stale-but-recent — serve stale instantly, refresh in the background so the
  // NEXT caller gets fresh data and nobody waits on the cold rebuild.
  if (hit && now - hit.expiresAt < CONVICTIONS_STALE_MS) {
    void build().catch(() => { /* background refresh; stale already served */ });
    return hit.data;
  }

  // Cold (no entry, or too stale to trust) — must build synchronously.
  return build();
}


/**
 * Build the board once, ahead of anyone asking for it.
 *
 * The cold build takes over two minutes, so whoever arrives first on a fresh
 * process either waits that out or is told the signals are "still warming up".
 * Neither is acceptable as the normal experience, and both were: nothing
 * populated this cache on boot, so every restart put the platform back into that
 * state until a human happened to open the Oracle tab.
 *
 * Called at startup and on a schedule. Failures are logged and swallowed — a
 * warm-up that cannot complete must not prevent the process from serving.
 */
export async function warmConvictions(reason = 'scheduled'): Promise<number> {
  const t0 = Date.now();

  // WARM THE KEYS THE UI ACTUALLY ASKS FOR, not just the defaults.
  //
  // The cache is keyed on the full options fingerprint, and the first version of
  // this warmed getCachedConvictions() with no arguments — limit 500, minScore 0.
  // The Hunt cockpit requests limit=40&minScore=10, which is a DIFFERENT key, so
  // it still met a cold cache and sat on a spinner for the full two-minute build.
  // Warming the wrong key is indistinguishable from not warming at all.
  //
  // weeklyUserId is in the key too, so a logged-in user gets their own entry that
  // a generic warm can never fill. Each known user therefore gets their shape
  // warmed as well.
  const shapes: BuildConvictionsOptions[] = [
    {},                                                  // bot, alerts, catalyst board
    { limit: 40, minScore: 10, watchlistOnly: false },    // Hunt cockpit, logged out
  ];

  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    const r: any = await db.execute(sql`select id from users limit 5`);
    for (const u of (r.rows ?? r)) {
      shapes.push({ limit: 40, minScore: 10, watchlistOnly: false, weeklyUserId: String(u.id) });
    }
  } catch {
    // No user list is survivable; the logged-out shape still gets warmed.
  }

  let total = 0;
  for (const shape of shapes) {
    try {
      const data = await getCachedConvictions(shape);
      total += data?.picks?.length ?? 0;
    } catch (err: any) {
      logger.warn(`[CONVICTIONS] warm shape ${JSON.stringify(shape)} failed: ${err?.message ?? err}`);
    }
  }

  logger.info(
    `[CONVICTIONS] warm (${reason}): ${shapes.length} shapes, ${total} picks total, `
    + `${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  return total;
}

// ─────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────

export interface BuildConvictionsOptions {
  /** Lookback window in hours (default 96). */
  lookbackHours?: number;
  /** Maximum picks to return (default 25). */
  limit?: number;
  /** Filter to approved watchlist only (default true). */
  watchlistOnly?: boolean;
  /** Minimum conviction score floor (default 15). */
  minScore?: number;
  /** Disable live re-validation (for backtest replay). */
  skipLiveRevalidation?: boolean;
  /**
   * If set, prefer the user's weekly watchlist for the current week — these
   * symbols receive a +3 priority boost in scoring. When `weeklyOnly` is true,
   * we filter ideas down to weekly symbols only.
   */
  weeklyUserId?: string;
  /** Restrict candidates to weekly watchlist symbols only. */
  weeklyOnly?: boolean;
}

export async function buildConvictions(opts: BuildConvictionsOptions = {}): Promise<ConvictionsResponse> {
  // Recover legacy GEX rows before reading the candidate pool. A malformed
  // ladder is quarantined when it cannot be proven, but a structurally complete
  // row is repaired and allowed to face the same scoring gates as every other
  // thesis instead of being discarded solely because its publisher mixed
  // contract premium with underlying prices.
  if (!opts.skipLiveRevalidation) {
    try {
      const { repairMalformedOpenGexIdeas } = await import('./gex-level-repair');
      const repaired = await repairMalformedOpenGexIdeas();
      if (repaired > 0) logger.info(`[CONVICTIONS] repaired ${repaired} legacy GEX ladder${repaired === 1 ? '' : 's'} before scoring`);
    } catch (err) {
      logger.warn('[CONVICTIONS] GEX ladder repair unavailable; malformed rows remain quarantined:', err);
    }
  }
  // Wide lookback window — the per-idea age cap (holding-period aware:
  // intraday=6h, swing=36h, position=96h) does the real freshness filtering.
  const lookbackHours = opts.lookbackHours ?? 96;
  const limit = opts.limit ?? 25;
  const watchlistOnly = opts.watchlistOnly ?? true;
  const minScore = opts.minScore ?? 15;
  const skipLiveRevalidation = opts.skipLiveRevalidation ?? false;
  const weeklyUserId = opts.weeklyUserId;
  const weeklyOnly = opts.weeklyOnly ?? false;
  // The persisted Oracle plan is the source of truth. Live data enriches it;
  // it must never be allowed to turn a page load into a fan-out of hundreds of
  // provider calls.  Outside cash hours, stock/option quotes are either stale
  // or unavailable anyway, so retain the plan and label it with its recorded
  // timestamp instead of pretending a fully closed-session check is live.
  // Pre/post-market is different: the session-aware quote feed is live enough
  // to challenge a thesis even though it must not trigger an entry.
  const cashMarketOpen = isUSMarketOpen().isOpen;
  const marketPhase = currentMarketPhase();
  const liveSession = marketPhase !== "closed";
  const liveCandidateLimit = Math.max(limit * 2, 40);
  // Deep layers fan out to several third-party services per symbol. Enrich the
  // best names, but never make a large UI/debug limit turn into 100 concurrent
  // sector/analyst/TA/GEX requests. Base evidence is still scored for every
  // candidate; only the optional live context is capped here.
  const deepEnrichmentLimit = Math.min(Math.max(limit, 12), 16);

  // Pull this user's weekly watchlist set if requested. We use a Set for O(1)
  // membership checks during scoring + filtering.
  let weeklySymbols: Set<string> | null = null;
  if (weeklyUserId) {
    try {
      const { getWeeklyWatchlist } = await import("./weekly-watchlist-seeder");
      const items = await getWeeklyWatchlist(weeklyUserId);
      if (items.length > 0) {
        weeklySymbols = new Set(items.map((i: any) => i.symbol.toUpperCase()));
      }
    } catch (err) {
      logger.warn("[CONVICTIONS] weekly watchlist fetch failed:", err);
    }
  }

  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  // Fetch market context, geopolitical matrix, breadth, and recent ideas in parallel
  const [marketCtx, geoMatrix, breadth, rawIdeas] = await Promise.all([
    within(getMarketContext(), neutralMarketContext(cashMarketOpen)).catch((err) => {
      logger.warn("[CONVICTIONS] market context failed:", err);
      return neutralMarketContext(cashMarketOpen);
    }),
    within(getScenarioMatrix(), null).catch((err) => {
      logger.warn("[CONVICTIONS] geo matrix failed:", err);
      return null;
    }),
    within(getMarketBreadth(), null).catch((err) => {
      logger.warn("[CONVICTIONS] breadth failed:", err);
      return null;
    }),
    db
      .select()
      .from(tradeIdeas)
      .where(gte(tradeIdeas.timestamp, cutoff))
      .orderBy(desc(tradeIdeas.timestamp))
      // Backtest replay needs the full historical pool; live convictions
      // only ever look at the recent slice so 500 is plenty.
      .limit(skipLiveRevalidation ? 20000 : 500),
  ]);

  // An idea with a terminal outcome is historical evidence, not an active
  // candidate. Leaving hit_stop / expired rows in this pool allowed old setups
  // such as COHR to be rescored as "elite" merely because a new quote had not
  // crossed their stop a second time.
  const activeIdeas = rawIdeas.filter((idea: any) => {
    if (idea.outcomeStatus && idea.outcomeStatus !== "open") return false;

    // GEX scanner rows created before the level-space repair stored option
    // PREMIUM in entry/target/stop while the rest of the board treated those
    // fields as UNDERLYING prices. Do not let those legacy rows render as
    // impossible $2 share entries; newly generated GEX ideas preserve the
    // underlying ladder and keep premium in entryPremium.
    const isMalformedLegacyGexOption =
      idea.source === "gex_scanner" &&
      idea.optionType != null &&
      idea.strikePrice != null &&
      Number(idea.entryPrice) > 0 &&
      Number(idea.entryPrice) < Number(idea.strikePrice) * 0.5;
    if (isMalformedLegacyGexOption) return false;

    // Preserve old momentum rows as audit history, but do not let the legacy
    // quote-only publisher masquerade as an active Oracle plan. It had no
    // structural trigger/target model and can be recognised exactly by its
    // own catalyst text; real breakout/flag ideas are unaffected.
    const isLegacyMomentumPlaceholder =
      idea.source === "quant" &&
      typeof idea.catalyst === "string" &&
      idea.catalyst.startsWith("Bullish momentum scanner:") &&
      !idea.convergenceSignalsJson;
    return !isLegacyMomentumPlaceholder;
  });

  // Include ideas for approved tickers OR user watchlist symbols
  let userWatchlistSymbols: Set<string> | null = null;
  try {
    const { getScannerUniverse } = await import("./scanner-universe");
    const { watchlistSymbols: ws } = await getScannerUniverse();
    userWatchlistSymbols = ws;
  } catch {}
  // Measured detectors (tape, reversal, index/leader swing, premium discount,
  // crypto transmission) and benchmark-complex names earn board access on
  // their own evidence. Without this, a fresh account (empty personal
  // watchlist) saw only the hand-curated list — 4 cards where the engine had
  // 12 (2026-09-23, quantedgelabs.net).
  const MEASURED_PREFIXES = ['Aggressor tape:', 'Higher-Lows Base', 'V-Recovery', 'Leader swing:', 'Index swing discount:', 'Premium discount:', 'Crypto transmission:'];
  const isMeasured = (idea: any) => {
    if (idea.source === 'tradingview') return true;
    // Current index-scalp rows are measured, contract-backed intraday plans.
    // Requiring SPX/QQQ/IWM to also appear in a personal watchlist caused the
    // bot to publish a valid 0DTE plan that Cockpit could never display.
    if (
      idea.source === 'gex_scanner' &&
      String(idea.dataSourceUsed ?? '').startsWith('GEX_index_scalp_') &&
      idea.entryPremium != null
    ) return true;
    const c = String(idea.catalyst ?? '');
    return MEASURED_PREFIXES.some((p) => c.startsWith(p));
  };
  let watchlistFiltered = watchlistOnly
    ? activeIdeas.filter((idea: any) =>
        isApprovedTicker(idea.symbol) ||
        userWatchlistSymbols?.has(idea.symbol.toUpperCase()) ||
        isLeadershipName(idea.symbol) ||
        isMeasured(idea),
      )
    : activeIdeas;

  // Hard restrict to weekly watchlist tickers if requested
  if (weeklyOnly && weeklySymbols) {
    watchlistFiltered = watchlistFiltered.filter((idea: any) =>
      weeklySymbols!.has(idea.symbol.toUpperCase()),
    );
  }

  // Hard age cap based on the idea's holding period — kills "+5% intraday
  // momentum" ideas that have been sitting in the DB for 2 days.
  // Skipped in backtest replay so historical ideas aren't filtered out
  // by the simple fact that they're old.
  const ageGated = skipLiveRevalidation
    ? watchlistFiltered
    : watchlistFiltered.filter(
        (idea: any) => ideaAgeHours(idea) <= maxAgeHoursForIdea(idea),
      );
  if (!skipLiveRevalidation && watchlistFiltered.length !== ageGated.length) {
    logger.info(
      `[CONVICTIONS] age cap removed ${watchlistFiltered.length - ageGated.length} stale ideas (kept ${ageGated.length})`,
    );
  }

  // Live re-validation — fetch one batch quote pass for every surviving
  // candidate, then hard-reject contradictions / stopped-out / chase entries.
  const liveQuotes = new Map<string, RealtimeQuote>();
  // Choose the only candidates that could plausibly be returned before any
  // network work. This is intentionally deterministic: score, then recency.
  // It prevents a 500-name DB slice from becoming 500 quote/GEX requests.
  const rankedForLive = [...(ageGated as any[])].sort((a, b) => {
    const scoreDelta = Number(b.confidenceScore ?? 0) - Number(a.confidenceScore ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime();
  }).slice(0, liveCandidateLimit);
  // Backtest replay deliberately needs the entire historical pool; the cap is
  // a live-serving guard only.
  let revalidated = skipLiveRevalidation ? (ageGated as any[]) : rankedForLive;
  if (!skipLiveRevalidation && liveSession && rankedForLive.length > 0) {
    try {
      const validAssetTypes = new Set(["stock", "crypto", "option", "futures"]);
      // A trade idea's `symbol` is ALWAYS the underlying ("AMZN"), but `assetType` is
      // "option" whenever the idea is expressed as a contract. Passing both asked the
      // quote service for an option named "AMZN" — which is not an OCC symbol, so it
      // could never resolve, and a batch of 412 returned 1. Every options-based idea
      // therefore had no live price at all.
      //
      // The underlying quote is also the CORRECT one here: entry, stop and targets all
      // come from the level engine, which derives them from underlying candles. Contract
      // pricing is a separate concern (Contract Engine / paper positions), keyed by OCC
      // symbol. So options map to a stock quote; crypto and futures stay as they are.
      const quoteAssetType = (at: string) => (at === "option" ? "stock" : at);
      const quoteRequests = rankedForLive.map((idea: any) => {
        const at = typeof idea.assetType === "string" ? idea.assetType.toLowerCase() : "stock";
        const resolved = validAssetTypes.has(at) ? quoteAssetType(at) : "stock";
        return {
          symbol: idea.symbol,
          assetType: resolved as "stock" | "crypto" | "option" | "futures",
        };
      });
      if (marketPhase === "regular") {
        const quoteMap = await within(
          getRealtimeBatchQuotes(quoteRequests),
          new Map<string, RealtimeQuote>(),
          3_000,
        );
        quoteMap.forEach((q, sym) => liveQuotes.set(sym, q));
      } else {
        // During pre/post-market the regular quote service is commonly the
        // prior close. Use the session-aware snapshot as the primary mark so
        // overnight gaps can strengthen, challenge, or retire a thesis.
        const sessionQuotes = await within(
          getPreMarketBatch(quoteRequests.map((r) => r.symbol)),
          new Map<string, PreMarketSnapshot>(),
          3_000,
        );
        sessionQuotes.forEach((q, sym) => {
          if (Number.isFinite(q.price) && q.price > 0) {
            liveQuotes.set(sym, {
              symbol: sym,
              price: q.price,
              changePercent: q.gapPct,
            } as RealtimeQuote);
          }
        });
      }

      // The batch service silently DROPS symbols when providers throttle and returns
      // nothing outside regular hours, so every pick came back with currentPrice = null —
      // which is why the board read "+0.0% P&L" on every signal: with no live price, P&L
      // is entry measured against itself. Recover the gaps from the chart endpoint used by
      // extended-hours (no auth, works pre/post, already provider-cached).
      const missingSyms = quoteRequests
        .map((r) => r.symbol)
        .filter((sym) => {
          const q = liveQuotes.get(sym);
          return !q || !Number.isFinite(q.price) || !q.price;
        });

      if (missingSyms.length > 0) {
        try {
          const { fetchExtendedQuote } = await import("./extended-hours");
          const CONC = 8;
          let recovered = 0;
          for (let i = 0; i < missingSyms.length; i += CONC) {
            const slice = missingSyms.slice(i, i + CONC);
            const rows = await Promise.all(
              slice.map((sym) => within(fetchExtendedQuote(sym), null, 1_200)),
            );
            for (const q of rows) {
              if (q && Number.isFinite(q.lastPrice) && q.lastPrice > 0) {
                liveQuotes.set(q.symbol, {
                  symbol: q.symbol,
                  price: q.lastPrice,
                  changePercent: q.changePct,
                } as RealtimeQuote);
                recovered++;
              }
            }
          }
          logger.info(`[CONVICTIONS] quote fallback recovered ${recovered}/${missingSyms.length} live prices`);
        } catch (err) {
          logger.warn("[CONVICTIONS] extended-hours quote fallback failed:", err);
        }
      }

      const survivors: any[] = [];
      let rejectCount = 0;
      for (const idea of rankedForLive) {
        const dir: "long" | "short" =
          typeof idea.targetPrice === "number" && typeof idea.entryPrice === "number"
            ? idea.targetPrice > idea.entryPrice
              ? "long"
              : "short"
            : (idea.direction as "long" | "short") || "long";
        const result = revalidateOne(idea, dir, liveQuotes.get(idea.symbol));
        if (result.reject) {
          rejectCount++;
          logger.debug(
            `[CONVICTIONS] reject ${idea.symbol} (${dir}): ${result.rejectReason}`,
          );
          continue;
        }
        survivors.push(idea);
      }
      revalidated = survivors;
      if (rejectCount > 0) {
        logger.info(
          `[CONVICTIONS] live revalidation rejected ${rejectCount} ideas (kept ${survivors.length})`,
        );
      }
    } catch (err) {
      logger.warn("[CONVICTIONS] live revalidation failed, keeping all candidates:", err);
    }
  }

  const candidates = revalidated;

  // Pre-market snapshots — batch fetch for every surviving candidate so the
  // scoring loop has overnight gap data when applying the pre-market layer
  // and the freshness rescue. Skipped during backtest replay (historical
  // ideas can't be re-validated against today's pre-market tape).
  const preMarketBySymbol = new Map<string, PreMarketSnapshot>();
  const gexBySymbol = new Map<string, GexSnapshot>();
  if (!skipLiveRevalidation && candidates.length > 0) {
    const symbols = Array.from(
      new Set((candidates as any[]).slice(0, deepEnrichmentLimit).map((c) => c.symbol).filter(Boolean)),
    );
    // Run pre-market and GEX batches in parallel — both are independent.
    // GEX is the more expensive of the two (options-chain fetch per symbol),
    // so it gets a generous concurrency budget but is heavily cached (5min).
    //
    // These used to share one `cashMarketOpen` gate, which silenced GEX on every
    // pre-market, post-market and weekend board — precisely when the board is
    // consulted for planning. Only the pre-market snapshot actually needs the
    // session to be live; gamma exposure is computed from the option chain, and
    // the CBOE path resolves after hours. Split the gate so each keeps only the
    // condition it needs.
    const [pmRes, gexRes] = await Promise.allSettled([
      liveSession
        ? within(getPreMarketBatch(symbols), new Map<string, PreMarketSnapshot>(), 3_000)
        : Promise.resolve(new Map<string, PreMarketSnapshot>()),
      within(getGexSnapshotBatch(symbols), new Map<string, GexSnapshot>(), 4_000),
    ]);
    if (pmRes.status === "fulfilled") {
      pmRes.value.forEach((s, sym) => preMarketBySymbol.set(sym, s));
      if (pmRes.value.size > 0) {
        const gappers = Array.from(pmRes.value.values()).filter((s) => Math.abs(s.gapPct) >= 1).length;
        logger.info(
          `[CONVICTIONS] pre-market snapshots: ${pmRes.value.size} fetched, ${gappers} gappers ≥1%`,
        );
      }
    } else {
      logger.warn("[CONVICTIONS] pre-market batch fetch failed:", pmRes.reason);
    }
    if (gexRes.status === "fulfilled") {
      gexRes.value.forEach((s, sym) => gexBySymbol.set(sym, s));
      if (gexRes.value.size > 0) {
        const positives = Array.from(gexRes.value.values()).filter((s) => s.regime === "positive_gamma").length;
        const negatives = Array.from(gexRes.value.values()).filter((s) => s.regime === "negative_gamma").length;
        logger.info(
          `[CONVICTIONS] GEX snapshots: ${gexRes.value.size} fetched (${positives} positive, ${negatives} negative gamma)`,
        );
      }
    } else {
      logger.warn("[CONVICTIONS] GEX batch fetch failed:", gexRes.reason);
    }
  }

  const breadthResponse = breadth
    ? {
        regime: breadth.regime,
        bias: breadth.bias,
        advanceDeclineRatio: breadth.advanceDeclineRatio,
        percentAbove200MA: breadth.percentAbove200MA,
        percentAbove50MA: breadth.percentAbove50MA,
        newHighsLows: breadth.newHighsLows,
        sampleSize: breadth.sampleSize,
        interpretation: breadth.interpretation,
      }
    : null;

  const geo = {
    risk: geoMatrix?.currentConditions.geopoliticalRisk ?? "NORMAL",
    activeScenarios: geoMatrix?.currentConditions.activeScenarios ?? [],
  };

  // Short discipline at the LAST mile. The producers are gated, but this loop
  // re-scores STORED candidates every warm cycle — so a pre-gate short (or any
  // scanner that forgets the rule) resurfaces on the signals grid forever. The
  // engine is the door to the board; the door checks the rule itself. A row's
  // `catalyst` text never counts — generateCatalyst() always returns prose and
  // a bear-flag pattern is not an event — only an impact:'high' catalyst row
  // within the gate's window qualifies.
  let symbolsWithEvent = new Set<string>();
  try {
    const { isSubstantiveEventCatalyst } = await import("./short-discipline");
    const { storage } = await import("./storage");
    const activeCatalysts = await storage.getActiveCatalysts();
    symbolsWithEvent = new Set(
      activeCatalysts
        .filter((c: any) => isSubstantiveEventCatalyst(c))
        .map((c: any) => String(c.symbol ?? "").toUpperCase())
        .filter(Boolean),
    );
  } catch (err) {
    // Missing catalyst feed fails CLOSED for shorts — an empty set blocks them.
    logger.warn("[CONVICTIONS] catalyst feed unavailable — short discipline fails closed:", err);
  }
  const { passesShortDiscipline } = await import("./short-discipline");
  let disciplineDropped = 0;

  // Build picks (sector layer needs async fetches — Promise.all per pick)
  const picks: ConvictionPick[] = [];

  for (const idea of candidates as any[]) {
    const direction: "long" | "short" =
      typeof idea.targetPrice === "number" && typeof idea.entryPrice === "number"
        ? idea.targetPrice > idea.entryPrice
          ? "long"
          : "short"
        : (idea.direction as "long" | "short") || "long";

    if (direction === "short") {
      const allowed = passesShortDiscipline({
        symbol: idea.symbol,
        direction: "short",
        hasEventCatalyst: symbolsWithEvent.has(String(idea.symbol ?? "").toUpperCase()),
      });
      if (!allowed) {
        disciplineDropped++;
        // Shadow-track the block so the gate itself gets measured — is the
        // discipline saving money or costing money? One entry per symbol/day.
        try {
          const { recordBlockedShort } = await import("./discipline-ledger");
          void recordBlockedShort({
            symbol: idea.symbol,
            entryPrice: Number(idea.entryPrice) || 0,
            stopLoss: Number(idea.stopLoss) || 0,
            targetPrice: Number(idea.targetPrice) || 0,
            reason: "short without an event catalyst — technical pattern only",
            source: String(idea.source ?? "unknown"),
          });
        } catch { /* the ledger never blocks the build */ }
        continue;
      }
    }

    const sector = getSector(idea.symbol);
    const layers: ConvictionLayer[] = [];

    const technical = scoreTechnicalLayer(idea, direction);
    if (technical) layers.push(technical);

    const qualitySignals = scoreQualitySignalsLayer(idea, direction, !skipLiveRevalidation);
    if (qualitySignals) layers.push(qualitySignals);

    const measuredStructure = scoreMeasuredStructureLayer(idea, !skipLiveRevalidation);
    if (measuredStructure) layers.push(measuredStructure);

    const leadership = scoreLeadershipLayer(idea.symbol);
    if (leadership) layers.push(leadership);

    const tier = scoreTierLayer(idea.symbol, idea.riskRewardRatio);
    if (tier) layers.push(tier);

    const convergence = scoreConvergenceLayer(idea.convergenceSignalsJson, direction);
    if (convergence) layers.push(convergence);

    const catalyst = scoreCatalystLayer(idea, direction);
    if (catalyst) layers.push(catalyst);

    const regime = scoreRegimeLayer(direction, marketCtx);
    if (regime) layers.push(regime);

    const breadthLayer = scoreBreadthLayer(direction, breadth);
    if (breadthLayer) layers.push(breadthLayer);

    const geopolitical = scoreGeopoliticalLayer(idea.symbol, sector, direction, geo);
    if (geopolitical) layers.push(geopolitical);

    // Pre-market layer — overnight gap as a leading direction signal.
    // Skipped during backtest replay (historical pre-market data is not
    // re-fetchable through this code path).
    const preMarketSnap = preMarketBySymbol.get(idea.symbol.toUpperCase());
    if (!skipLiveRevalidation) {
      const preMarket = scorePreMarketLayer(direction, preMarketSnap);
      if (preMarket) layers.push(preMarket);
    }

    // GEX layer — dealer positioning as directional confluence.
    // Positive gamma above flip supports longs; negative gamma below flip
    // supports shorts via vol expansion. Skipped during backtest replay.
    const gexSnap = gexBySymbol.get(idea.symbol.toUpperCase());
    if (!skipLiveRevalidation) {
      const gex = scoreGexLayer(direction, gexSnap);
      if (gex) layers.push(gex);
    }

    // Freshness — penalizes stale ideas + adverse drift since entry.
    // Pre-market snapshot is passed in for the rescue path (a stale idea
    // gapping in its direction earns back most of the staleness penalty).
    // Skipped during backtest replay so historical scores aren't biased.
    if (!skipLiveRevalidation) {
      const freshness = scoreFreshnessLayer(
        idea,
        direction,
        liveQuotes.get(idea.symbol),
        preMarketSnap,
      );
      if (freshness) layers.push(freshness);
    }

    // Weekly priority — flat +3 boost for any symbol on the user's
    // weekly focus list. Encodes "this is what I'm watching this week."
    if (weeklySymbols && weeklySymbols.has(idea.symbol.toUpperCase())) {
      layers.push({
        kind: "weekly",
        label: "Weekly Focus",
        points: 3,
        why: "On your weekly watchlist",
      });
    }

    // Sector + analyst layers are async; only fetched for top candidates
    // after pre-rank (to avoid blasting Tradier/Yahoo with hundreds of
    // quote requests). We'll add them in a second pass below.

    const totalPoints = layers.reduce((s, l) => s + l.points, 0);
    // Second-pass layers can still rescue a borderline candidate:
    // sector ±4, analyst ±6, TA confluence ±8 → keep a 15pt buffer below minScore.
    if (totalPoints < minScore - 15) continue;

    picks.push({
      ideaId: idea.id,
      symbol: idea.symbol,
      sector,
      direction,
      assetType: idea.assetType,
      holdingPeriod: idea.holdingPeriod,
      tradeType: idea.tradeType ?? null,
      entryPrice: idea.entryPrice,
      targetPrice: idea.targetPrice,
      stopLoss: idea.stopLoss,
      riskRewardRatio: idea.riskRewardRatio,
      optionType: (idea.optionType as "call" | "put" | null) ?? null,
      strikePrice: idea.strikePrice ?? null,
      // Which instrument the entry/stop/target are priced in. Option ideas the
      // Contract Engine enriched carry PREMIUM levels (entry $2.10 on a $175
      // stock); rendering those unlabeled beside share-priced rows made a
      // routine +100% premium target read as an absurd chart call. Heuristic:
      // a strike far above the entry means the levels are the contract's.
      levelBasis:
        idea.strikePrice != null && idea.optionType != null &&
        Number(idea.entryPrice) > 0 && Number(idea.entryPrice) < Number(idea.strikePrice) * 0.5
          ? ("contract" as const)
          : ("underlying" as const),
      // The contract's premium. Without this the client cannot tell an option
      // signal from a stock one, so Position Size fell back to sizing SHARES on
      // option ideas — a BMY $65C read "76 shares, $5,128, 51.3% of account" for a
      // trade whose real cost is one contract. 449 of 534 option ideas already had
      // it stored; it simply was never serialised.
      entryPremium: idea.entryPremium != null ? Number(idea.entryPremium) : null,
      optionDte: idea.optionDte != null ? Number(idea.optionDte) : null,
      expiryDate: idea.expiryDate ?? null,
      convictionScore: 0, // filled below
      convictionBand: "C",
      layerCount: layers.length,
      layers,
      publishedConvictionScore:
        idea.genConvictionScore != null ? Number(idea.genConvictionScore) : null,
      publishedConvictionBand:
        idea.genConvictionBand === "S" || idea.genConvictionBand === "A" ||
        idea.genConvictionBand === "B" || idea.genConvictionBand === "C"
          ? idea.genConvictionBand
          : null,
      thesis: idea.convergenceSignalsJson?.primaryThesis ?? idea.analysis ?? idea.catalyst ?? "",
      catalyst: idea.catalyst ?? "",
      catalystSourceUrl: idea.catalystSourceUrl ?? null,
      generatedAt: idea.generationTimestamp ?? idea.timestamp,
      source: idea.source ?? "quant",
      // The live price was fetched for revalidation and then never serialised, so every
      // client computed P&L as entry-vs-entry and the whole board read "+0.0% P&L".
      currentPrice: liveQuotes.get(idea.symbol)?.price ?? idea.currentPrice ?? null,
      lifecycleState: readOracleExecutionAudit(idea.convergenceSignalsJson)?.state ?? "pending_trigger",
    });
  }

  // Dedupe by symbol+direction so the same name with multiple recent ideas
  // doesn't dominate the leaderboard. Keep the highest-scoring pick per key.
  const dedupMap = new Map<string, ConvictionPick>();
  for (const p of picks) {
    const key = `${p.symbol}::${p.direction}`;
    const existing = dedupMap.get(key);
    const sum = p.layers.reduce((s, l) => s + l.points, 0);
    if (!existing) {
      dedupMap.set(key, p);
    } else {
      const exSum = existing.layers.reduce((s, l) => s + l.points, 0);
      if (sum > exSum) dedupMap.set(key, p);
    }
  }
  if (disciplineDropped > 0) {
    logger.info(`[CONVICTIONS] short discipline dropped ${disciplineDropped} pattern-short candidate${disciplineDropped === 1 ? '' : 's'} (no impact:high event on file)`);
  }
  const deduped: ConvictionPick[] = Array.from(dedupMap.values());

  // Pre-rank by point sum so we only fetch sector quotes for the top N
  deduped.sort((a, b) => {
    const aSum = a.layers.reduce((s, l) => s + l.points, 0);
    const bSum = b.layers.reduce((s, l) => s + l.points, 0);
    return bSum - aSum;
  });
  const topForSector = deduped.slice(0, Math.min(deepEnrichmentLimit, deduped.length));

  // Sector + analyst enrichment (parallel, capped to top picks)
  if (!skipLiveRevalidation) {
    await Promise.all(
      topForSector.map(async (p) => {
      const [sectorLayer, analystSnap, taLayer, compressionLayer, tapeContradiction, pathLayer] = await Promise.all([
        within(scoreSectorLayer(p.symbol, p.sector, p.direction), null, 2_500),
        within(getAnalystSnapshot(p.symbol), null, 2_500),
        // TA confluence (Fib + candlesticks + structure). Skipped during backtest
        // replay since it reads live daily candles, not historical-as-of bars.
        within(scoreTALayer(p.symbol, p.direction), null, 2_500),
        // Darvas box + TTM squeeze. Same live-candle caveat as the TA layer.
        within(scoreCompressionLayer(p.symbol, p.direction), null, 2_500),
        // Opposing measured flow subtracts — see scoreTapeContradictionLayer.
        within(scoreTapeContradictionLayer(p.symbol, p.direction), null, 2_500),
        within(scorePathToStructureLayer(p), null, 2_500),
      ]);
      if (tapeContradiction) {
        p.layers.push(tapeContradiction);
      }
      if (pathLayer) {
        p.layers.push(pathLayer);
      }
      if (sectorLayer) {
        p.layers.push(sectorLayer);
      }
      if (taLayer) {
        p.layers.push(taLayer);
      }
      if (compressionLayer) {
        p.layers.push(compressionLayer);
      }
      // Analyst 12-month targets only matter for position / leap holds.
      // For day / swing trades they're noise — skip entirely.
      const hp = (p.holdingPeriod || p.tradeType || "").toLowerCase();
      const isLongHold = hp.includes("position") || hp.includes("long") || hp.includes("leap");
      if (isLongHold) {
        const liveQ = liveQuotes.get(p.symbol);
        const analystLayer = scoreAnalystLayer(analystSnap, p.direction, p.entryPrice, liveQ?.price);
        if (analystLayer) {
          p.layers.push(analystLayer);
        }
      }
      p.layerCount = p.layers.length;
      }),
    );
  }

  // Final scoring + band assignment. See BAND_CUTOFFS above.
  for (const p of deduped) {
    const total = p.layers.reduce((s, l) => s + l.points, 0);
    p.convictionScore = Math.max(0, Math.min(100, total));
    p.convictionBand =
bandFor(p.convictionScore);
  }

  // 🏦 CASH-GATE — "be cash before the print." When a HIGH-impact macro event
  // (FOMC/CPI/NFP/Powell) is imminent, dampen every grade so fewer/lower-conviction
  // setups clear the floor into a market-wide coin-flip. Runs before the sort +
  // minScore filter + instrumentation persist, so the dampening is what's stored.
  try {
    const { hasHighImpactEventSoon } = await import("./economic-calendar");
    const macro = hasHighImpactEventSoon(8);
    if (macro) {
      const DAMPEN = 0.65;
      for (const p of deduped) {
        p.convictionScore = Math.round(p.convictionScore * DAMPEN);
        p.convictionBand =
    bandFor(p.convictionScore);
        p.layers.push({
          kind: "macro",
          label: "Macro Risk",
          points: 0,
          why: `Cash-gate: ${macro.name} (${macro.time}) imminent — grade dampened ${Math.round((1 - DAMPEN) * 100)}%`,
        } as any);
      }
    }
  } catch {
    /* calendar unavailable — no dampening */
  }

  /**
   * ACTIVE-BOOK DIRECTION CONFLICTS
   *
   * Separate scanners can legitimately notice opposite possibilities in one
   * ticker (for example: an intact bear flag now, then a gap-fill reversal
   * later). They are not, however, two simultaneous active trades when they
   * share the same holding horizon. The old symbol+direction dedupe preserved
   * both and made the Oracle board say LONG and SHORT at once.
   *
   * Keep one direction per symbol+horizon: the stronger final evidence score.
   * A future reversal-state model can retain the loser as a developing thesis;
   * until then, presenting it as an equal active signal is less truthful than
   * omitting it from this execution board. Different horizons remain separate
   * so a short-term hedge can coexist with a genuine long-term position thesis.
   */
  const horizonWinners = new Map<string, ConvictionPick>();
  for (const pick of deduped) {
    const horizon = String(pick.holdingPeriod || pick.tradeType || 'swing').toLowerCase();
    const key = `${pick.symbol.toUpperCase()}::${horizon}`;
    const current = horizonWinners.get(key);
    if (!current || pick.convictionScore > current.convictionScore) {
      horizonWinners.set(key, pick);
    } else if (pick.convictionScore === current.convictionScore) {
      const pickTime = new Date(pick.generatedAt ?? 0).getTime();
      const currentTime = new Date(current.generatedAt ?? 0).getTime();
      if (pickTime > currentTime) horizonWinners.set(key, pick);
    }
  }
  const deconflicted = Array.from(horizonWinners.values());

  // Final sort + minScore floor + limit
  deconflicted.sort((a, b) => b.convictionScore - a.convictionScore);
  const filtered = deconflicted.filter((p) => p.convictionScore >= minScore).slice(0, limit);

  // 🧪 Persist the scoring breakdown for the surfaced picks so resolved ideas can
  // be attributed back to the layers that fired (grade-calibration + reweighting).
  // Fire-and-forget + non-fatal: pre-migration column absence or a transient write
  // error is swallowed — signal serving must never break over telemetry.
  void (async () => {
    try {
      const { storage } = await import("./storage");
      await Promise.allSettled(
        filtered.map((p) =>
          p.ideaId && p.publishedConvictionScore == null
            ? storage.updateTradeIdea(p.ideaId, {
                genConvictionScore: p.convictionScore,
                genConvictionBand: p.convictionBand,
                genScoringLayers: p.layers.map((l) => ({ kind: l.kind, points: l.points, why: l.why })),
              } as any)
            : Promise.resolve(),
        ),
      );
    } catch {
      /* non-fatal telemetry */
    }
  })();

  return {
    generatedAt: new Date().toISOString(),
    marketContext: {
      regime: marketCtx.regime,
      riskSentiment: marketCtx.riskSentiment,
      preferredDirection: marketCtx.preferredDirection,
      score: marketCtx.score,
      vixLevel: marketCtx.vixLevel,
      reasons: marketCtx.reasons,
    },
    breadth: breadthResponse,
    geopolitical: geo,
    totalCandidatesScanned: candidates.length,
    picks: filtered,
  };
}
