/**
 * CONVICTION BACKTEST
 * ===================
 * Replays historical trade ideas through the current convictions-engine
 * scoring and aggregates by band to answer: "would today's engine
 * correctly grade past winners?"
 *
 * Method:
 *   1. Score every idea in the past N days using the live convictions
 *      engine (skipLiveRevalidation=true so historical entries aren't
 *      filtered out by current price drift).
 *   2. Join scored picks against the actual outcomes stored in
 *      `trade_ideas.outcome_status / realized_pnl / percent_gain`.
 *   3. For ideas still `open`, use the live price as the unrealized P&L
 *      proxy (so the user sees the engine's current exposure, not just
 *      historical resolutions).
 *   4. Aggregate by conviction band and by source scanner.
 *
 * Cached at 1h since the replay is expensive (a full conviction build).
 */

import { and, gte, inArray } from "drizzle-orm";
import { db } from "./db";
import { tradeIdeas } from "@shared/schema";
import { logger } from "./logger";
import { buildConvictions } from "./convictions-engine";
import { getRealtimeBatchQuotes } from "./realtime-pricing-service";

export interface BandStats {
  band: "S" | "A" | "B" | "C";
  count: number;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number; // 0..1
  avgPercentGain: number; // closed + open
  avgRealizedGain: number; // closed only
  avgUnrealizedGain: number; // open only
  expectancyR: number; // expected return per dollar risked, in R-multiples
}

export interface SourceStats {
  source: string;
  count: number;
  winRate: number;
  avgPercentGain: number;
  expectancyR: number;
}

export interface BacktestReport {
  generatedAt: string;
  lookbackDays: number;
  totalIdeas: number;
  scoredIdeas: number;
  closedCount: number;
  openCount: number;
  bands: BandStats[];
  sources: SourceStats[];
  /** Pct of actual winners that today's engine grades A or S. */
  topGradeRecallPct: number;
  /** Worst graded actual winners (the engine missed them). */
  blindspots: Array<{
    symbol: string;
    score: number;
    band: string;
    actualPercentGain: number;
    direction: string;
    source: string;
  }>;
  /** Best graded actual losers (the engine over-promised). */
  overpromises: Array<{
    symbol: string;
    score: number;
    band: string;
    actualPercentGain: number;
    direction: string;
    source: string;
  }>;
}

interface CacheEntry {
  report: BacktestReport;
  computedAt: number;
  lookbackDays: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

function isFresh(entry: CacheEntry | null, lookbackDays: number): boolean {
  if (!entry) return false;
  if (entry.lookbackDays !== lookbackDays) return false;
  return Date.now() - entry.computedAt < CACHE_TTL_MS;
}

function emptyBand(band: BandStats["band"]): BandStats {
  return {
    band,
    count: 0,
    closed: 0,
    open: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    avgPercentGain: 0,
    avgRealizedGain: 0,
    avgUnrealizedGain: 0,
    expectancyR: 0,
  };
}

/**
 * Compute per-idea unrealized %gain from a live quote against the entry price.
 * Long = (live - entry) / entry, Short = (entry - live) / entry.
 */
function computeUnrealizedPct(
  idea: any,
  livePrice: number,
  direction: "long" | "short",
): number {
  const entry = Number(idea.entryPrice);
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  const raw = ((livePrice - entry) / entry) * 100;
  const signed = direction === "long" ? raw : -raw;
  // Clamp to sane equity range — protects against options/leverage
  // entries where the entry price is wildly different from the live
  // underlying price.
  return Math.max(-100, Math.min(500, signed));
}

/**
 * Estimate R-multiple expectancy for a band:
 *   R = avgGain / avgRiskDistance
 * where avgRiskDistance is the |entry - stop| / entry as a percent.
 * Trades without stop-loss data are excluded from R calculation (not filled
 * with a fake 5% — that inflated R-multiples for incomplete data).
 */
function estimateExpectancy(gains: number[], riskPcts: number[]): number {
  if (gains.length === 0 || riskPcts.length === 0) return 0;
  const avgGain = gains.reduce((s, x) => s + x, 0) / gains.length;
  const avgRisk = riskPcts.reduce((s, x) => s + x, 0) / riskPcts.length;
  return avgRisk > 0 ? avgGain / avgRisk : 0;
}

export async function backtestConvictions(opts: { lookbackDays?: number } = {}): Promise<BacktestReport> {
  const lookbackDays = opts.lookbackDays ?? 90;

  if (isFresh(cache, lookbackDays)) {
    return cache!.report;
  }

  const startedAt = Date.now();
  logger.info(`[BACKTEST] starting replay over ${lookbackDays} days`);

  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  // 1. Score every idea using the live engine, with replay flags set.
  // We pass a very wide lookback so the engine considers everything in
  // the window, and we crank limit up so we get back the entire scored
  // pool (not just the top 25).
  const conv = await buildConvictions({
    lookbackHours: lookbackDays * 24,
    limit: 5000,
    minScore: 0,
    watchlistOnly: false,
    skipLiveRevalidation: true,
  });

  // Map of ideaId → pick for fast join
  const pickById = new Map<string, (typeof conv.picks)[number]>();
  for (const p of conv.picks) {
    pickById.set(p.ideaId, p);
  }

  // 2. Pull ALL trade ideas in the window (the engine returns scored
  // picks but we need outcomes for every idea, including ones the engine
  // dropped under minScore).
  const allIdeas = await db
    .select()
    .from(tradeIdeas)
    .where(gte(tradeIdeas.timestamp, cutoffIso));

  // 3. For open ideas in our scored set, fetch live quotes for unrealized P&L
  const openSymbols = new Set<string>();
  const openIdeas: any[] = [];
  for (const idea of allIdeas as any[]) {
    if (idea.outcomeStatus === "open" && pickById.has(idea.id)) {
      openSymbols.add(idea.symbol);
      openIdeas.push(idea);
    }
  }

  let liveQuoteMap = new Map<string, { price: number }>();
  if (openSymbols.size > 0) {
    try {
      const reqs = Array.from(openSymbols).map((sym) => ({
        symbol: sym,
        assetType: "stock" as const,
      }));
      const quotes = await getRealtimeBatchQuotes(reqs);
      quotes.forEach((q, sym) => {
        if (Number.isFinite(q.price)) {
          liveQuoteMap.set(sym, { price: q.price });
        }
      });
    } catch (err) {
      logger.warn("[BACKTEST] live quote fetch failed:", err);
    }
  }

  // 4. Aggregate by band
  const bands: Record<BandStats["band"], BandStats> = {
    S: emptyBand("S"),
    A: emptyBand("A"),
    B: emptyBand("B"),
    C: emptyBand("C"),
  };
  const bandGains: Record<string, number[]> = { S: [], A: [], B: [], C: [] };
  const bandRisks: Record<string, number[]> = { S: [], A: [], B: [], C: [] };
  const bandRealized: Record<string, number[]> = { S: [], A: [], B: [], C: [] };
  const bandUnrealized: Record<string, number[]> = { S: [], A: [], B: [], C: [] };

  // Aggregate by source
  const sourceMap = new Map<
    string,
    { count: number; wins: number; gains: number[]; risks: number[] }
  >();

  let scoredCount = 0;
  let closedCount = 0;
  let openCountResolved = 0;
  let actualWinnerCount = 0;
  let topGradedWinners = 0;

  type Row = {
    idea: any;
    pick: (typeof conv.picks)[number];
    pctGain: number;
    isClosed: boolean;
    isWin: boolean;
  };
  const rows: Row[] = [];

  for (const idea of allIdeas as any[]) {
    const pick = pickById.get(idea.id);
    if (!pick) continue; // engine dropped it (minScore=0 means it had no positive layers)
    scoredCount++;

    const direction = pick.direction;

    // Determine pctGain
    let pctGain: number;
    let isClosed = false;
    if (idea.outcomeStatus === "open") {
      const live = liveQuoteMap.get(idea.symbol);
      if (!live) continue; // no live price, can't proxy
      pctGain = computeUnrealizedPct(idea, live.price, direction);
      openCountResolved++;
    } else if (
      idea.outcomeStatus === "hit_target" ||
      idea.outcomeStatus === "hit_stop" ||
      idea.outcomeStatus === "manual_exit" ||
      idea.outcomeStatus === "expired"
    ) {
      isClosed = true;
      closedCount++;
      const stored = Number(idea.percentGain);
      if (Number.isFinite(stored)) {
        // Some legacy rows have percentGain stored as a multiplier (not a
        // percent), or as raw P&L dollars. Clamp to a sane equity range
        // so a single bad row doesn't poison the band averages.
        pctGain = Math.max(-100, Math.min(500, stored));
      } else {
        // Fallback: derive from realizedPnL if available
        pctGain = idea.outcomeStatus === "hit_target" ? 5 : -3;
      }
    } else {
      continue;
    }

    const isWin = pctGain > 0;
    if (isWin) actualWinnerCount++;
    if (isWin && (pick.convictionBand === "S" || pick.convictionBand === "A")) {
      topGradedWinners++;
    }

    rows.push({ idea, pick, pctGain, isClosed, isWin });

    // Per-band aggregation
    const bandKey = pick.convictionBand as BandStats["band"];
    const bandStats = bands[bandKey];
    bandStats.count++;
    if (isClosed) bandStats.closed++;
    else bandStats.open++;
    if (isWin) bandStats.wins++;
    else bandStats.losses++;
    bandGains[bandKey].push(pctGain);
    if (isClosed) bandRealized[bandKey].push(pctGain);
    else bandUnrealized[bandKey].push(pctGain);

    // Risk distance for R-expectancy
    const entry = Number(idea.entryPrice);
    const stop = Number(idea.stopLoss);
    if (Number.isFinite(entry) && Number.isFinite(stop) && entry > 0) {
      const riskPct = Math.abs((entry - stop) / entry) * 100;
      if (riskPct > 0) bandRisks[bandKey].push(riskPct);
    }

    // Per-source
    const source = idea.source || "unknown";
    if (!sourceMap.has(source)) {
      sourceMap.set(source, { count: 0, wins: 0, gains: [], risks: [] });
    }
    const srcStats = sourceMap.get(source)!;
    srcStats.count++;
    if (isWin) srcStats.wins++;
    srcStats.gains.push(pctGain);
    if (Number.isFinite(entry) && Number.isFinite(stop) && entry > 0) {
      srcStats.risks.push(Math.abs((entry - stop) / entry) * 100);
    }
  }

  // Finalize band stats
  for (const key of ["S", "A", "B", "C"] as const) {
    const b = bands[key];
    if (b.count > 0) {
      // Blended win rate (all ideas) — clearly labeled
      b.winRate = b.wins / b.count;
      // Closed-only (realized) win rate — the honest number
      const closedWins = bandRealized[key].filter(g => g > 0).length;
      const closedLosses = bandRealized[key].filter(g => g <= 0).length;
      (b as any).realizedWinRate = (closedWins + closedLosses) > 0
        ? closedWins / (closedWins + closedLosses) : null;
      (b as any).realizedSampleSize = closedWins + closedLosses;
      (b as any).unrealizedCount = bandUnrealized[key].length;
      b.avgPercentGain =
        bandGains[key].reduce((s, x) => s + x, 0) / bandGains[key].length;
      b.avgRealizedGain =
        bandRealized[key].length > 0
          ? bandRealized[key].reduce((s, x) => s + x, 0) / bandRealized[key].length
          : 0;
      b.avgUnrealizedGain =
        bandUnrealized[key].length > 0
          ? bandUnrealized[key].reduce((s, x) => s + x, 0) / bandUnrealized[key].length
          : 0;
      // Expectancy based on closed trades only (don't let unrealized inflate)
      b.expectancyR = bandRealized[key].length >= 3
        ? estimateExpectancy(bandRealized[key], bandRisks[key])
        : estimateExpectancy(bandGains[key], bandRisks[key]);
    }
  }

  // Finalize source stats
  const sources: SourceStats[] = [];
  sourceMap.forEach((stats, source) => {
    sources.push({
      source,
      count: stats.count,
      winRate: stats.count > 0 ? stats.wins / stats.count : 0,
      avgPercentGain:
        stats.gains.length > 0
          ? stats.gains.reduce((s, x) => s + x, 0) / stats.gains.length
          : 0,
      expectancyR: estimateExpectancy(stats.gains, stats.risks),
    });
  });
  sources.sort((a, b) => b.expectancyR - a.expectancyR);

  // Top-grade recall: of the actual winners, what % did the engine grade A or S?
  const topGradeRecallPct =
    actualWinnerCount > 0 ? (topGradedWinners / actualWinnerCount) * 100 : 0;

  // Blind spots: actual winners the engine graded C or low B
  const blindspots = rows
    .filter((r) => r.isWin && (r.pick.convictionBand === "C" || r.pick.convictionScore < 18))
    .sort((a, b) => b.pctGain - a.pctGain)
    .slice(0, 10)
    .map((r) => ({
      symbol: r.idea.symbol,
      score: r.pick.convictionScore,
      band: r.pick.convictionBand,
      actualPercentGain: r.pctGain,
      direction: r.pick.direction,
      source: r.idea.source || "unknown",
    }));

  // Overpromises: actual losers the engine graded A or S
  const overpromises = rows
    .filter((r) => !r.isWin && (r.pick.convictionBand === "S" || r.pick.convictionBand === "A"))
    .sort((a, b) => a.pctGain - b.pctGain)
    .slice(0, 10)
    .map((r) => ({
      symbol: r.idea.symbol,
      score: r.pick.convictionScore,
      band: r.pick.convictionBand,
      actualPercentGain: r.pctGain,
      direction: r.pick.direction,
      source: r.idea.source || "unknown",
    }));

  const report: BacktestReport = {
    generatedAt: new Date().toISOString(),
    lookbackDays,
    totalIdeas: allIdeas.length,
    scoredIdeas: scoredCount,
    closedCount,
    openCount: openCountResolved,
    bands: [bands.S, bands.A, bands.B, bands.C],
    sources,
    topGradeRecallPct,
    blindspots,
    overpromises,
  };

  const elapsedMs = Date.now() - startedAt;
  logger.info(
    `[BACKTEST] complete in ${elapsedMs}ms — total=${allIdeas.length} scored=${scoredCount} closed=${closedCount} open=${openCountResolved} topGradeRecall=${topGradeRecallPct.toFixed(0)}%`,
  );

  cache = { report, computedAt: Date.now(), lookbackDays };
  return report;
}

export function clearBacktestCache(): void {
  cache = null;
}
