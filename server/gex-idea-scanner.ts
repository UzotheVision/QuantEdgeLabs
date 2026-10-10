/**
 * GEX IDEA SCANNER
 * ================
 * Originates trade ideas from gamma-exposure setups (not just enriching
 * existing ones — that's what `scoreGexLayer` does in convictions-engine).
 *
 * Three setup archetypes:
 *
 *   1. **Flip Cross (highest priority)**
 *      Spot just crossed the gamma flip → regime change → directional thrust.
 *      - Spot ABOVE flip + negative gamma → vol expansion long
 *      - Spot BELOW flip + negative gamma → vol expansion short
 *      Reasoning: dealers are short gamma, must hedge in trend direction.
 *
 *   2. **Wall Pin Fade**
 *      Spot pinned at a major call/put wall under positive gamma → mean revert.
 *      - At call wall + positive gamma → fade short
 *      - At put wall + positive gamma → fade long
 *
 *   3. **Squeeze Setup**
 *      Spot inside flip/wall channel + negative gamma + tightening → break play
 *      towards whichever side the flip is closer to.
 *
 * Each candidate is written to `trade_ideas` with `source: 'gex_scanner'`,
 * `dataSourceUsed: 'GEX_<setup>'`, and `holdingPeriod: 'day' | 'swing'` so it
 * flows through the existing best-setups + convictions pipelines.
 *
 * Cadence: every 15 minutes during market hours via worker.
 */

import { logger } from "./logger";
import { storage } from "./storage";
import { getGexSnapshotBatch, type GexSnapshot } from "./gex-snapshot-service";
import { APPROVED_TICKERS, getSector } from "@shared/approved-tickers";
import { enrichOptionIdea } from "./options-enricher";
import type { AITradeIdea } from "./ai-service";

export type GexSetup = "flip_cross" | "wall_fade" | "squeeze_break";

export interface GexIdeaCandidate {
  symbol: string;
  setup: GexSetup;
  direction: "long" | "short";
  entry: number;
  target: number;
  stop: number;
  riskRewardRatio: number;
  confidence: number;
  thesis: string;
  flipPoint: number | null;
  callWall: number | null;
  putWall: number | null;
  regime: GexSnapshot["regime"];
}

const DUPE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const FLIP_PROXIMITY_PCT = 1.5; // within 1.5% of flip = "just crossed"
const WALL_PROXIMITY_PCT = 1.0; // within 1% of wall = "pinned"
const MIN_RR = 1.5;
// Wall-fade target sanity cap. When the flip is far from spot (>3%), the
// "mean revert all the way to flip" assumption is unrealistic in a single
// session — dealer hedging at the wall doesn't drag price 5%+ on its own.
// Cap target reach so R:R reflects realistic intraday-to-2-day mean revert.
const WALL_FADE_MAX_TARGET_PCT = 3.0;

/**
 * Build a candidate from a GEX snapshot using the three archetypes.
 * Returns null if no clean setup fires.
 */
function buildCandidate(snap: GexSnapshot): GexIdeaCandidate | null {
  if (!snap.flipPoint || !snap.regime || snap.spot <= 0) return null;
  const { spot, flipPoint, callWall, putWall, regime } = snap;
  const flipDist = ((flipPoint - spot) / spot) * 100; // signed
  const aboveFlip = flipDist < 0; // spot above flip → flip is below

  // ── Setup 1: Flip Cross — negative gamma + close to flip ──
  if (regime === "negative_gamma" && Math.abs(flipDist) <= FLIP_PROXIMITY_PCT) {
    const direction: "long" | "short" = aboveFlip ? "long" : "short";
    const target =
      direction === "long"
        ? callWall && callWall > spot
          ? callWall
          : spot * 1.025
        : putWall && putWall < spot
          ? putWall
          : spot * 0.975;
    const stop = direction === "long" ? Math.min(flipPoint, spot * 0.99) : Math.max(flipPoint, spot * 1.01);
    const risk = Math.abs(spot - stop);
    const reward = Math.abs(target - spot);
    if (risk <= 0 || reward / risk < MIN_RR) return null;
    return {
      symbol: snap.symbol,
      setup: "flip_cross",
      direction,
      entry: round(spot),
      target: round(target),
      stop: round(stop),
      riskRewardRatio: +(reward / risk).toFixed(2),
      confidence: 72,
      thesis: `Negative gamma flip cross — dealers must hedge ${direction === "long" ? "into rallies" : "into selloffs"}. Spot ${spot.toFixed(2)} just ${aboveFlip ? "above" : "below"} flip ${flipPoint.toFixed(2)}.`,
      flipPoint,
      callWall,
      putWall,
      regime,
    };
  }

  // ── Setup 2: Wall Pin Fade — positive gamma + at wall ──
  if (regime === "positive_gamma") {
    if (callWall && callWall > spot) {
      const distPct = ((callWall - spot) / spot) * 100;
      if (distPct <= WALL_PROXIMITY_PCT) {
        // Cap target distance so we don't claim 15× R:R on a flip that's
        // 14% below spot (single-session mean revert won't reach it).
        const cappedTarget = spot * (1 - WALL_FADE_MAX_TARGET_PCT / 100);
        const target = Math.max(flipPoint, cappedTarget);
        const stop = callWall * 1.005;
        const risk = stop - spot;
        const reward = spot - target;
        if (risk > 0 && reward / risk >= MIN_RR) {
          return {
            symbol: snap.symbol,
            setup: "wall_fade",
            direction: "short",
            entry: round(spot),
            target: round(target),
            stop: round(stop),
            riskRewardRatio: +(reward / risk).toFixed(2),
            confidence: 68,
            thesis: `Pinned at call wall ${callWall.toFixed(2)} under positive gamma. Dealers sell rallies, mean revert toward flip ${flipPoint.toFixed(2)}.`,
            flipPoint,
            callWall,
            putWall,
            regime,
          };
        }
      }
    }
    if (putWall && putWall < spot) {
      const distPct = ((spot - putWall) / spot) * 100;
      if (distPct <= WALL_PROXIMITY_PCT) {
        // Cap target distance so we don't claim a 15× R:R on a flip that's
        // 14% above spot (single-session mean revert won't reach it).
        const cappedTarget = spot * (1 + WALL_FADE_MAX_TARGET_PCT / 100);
        const target = Math.min(flipPoint, cappedTarget);
        const stop = putWall * 0.995;
        const risk = spot - stop;
        const reward = target - spot;
        if (risk > 0 && reward / risk >= MIN_RR) {
          return {
            symbol: snap.symbol,
            setup: "wall_fade",
            direction: "long",
            entry: round(spot),
            target: round(target),
            stop: round(stop),
            riskRewardRatio: +(reward / risk).toFixed(2),
            confidence: 68,
            thesis: `Pinned at put wall ${putWall.toFixed(2)} under positive gamma. Dealers buy dips, mean revert toward flip ${flipPoint.toFixed(2)}.`,
            flipPoint,
            callWall,
            putWall,
            regime,
          };
        }
      }
    }
  }

  // ── Setup 3: Squeeze Break — negative gamma + tight channel ──
  if (regime === "negative_gamma" && callWall && putWall && callWall > spot && putWall < spot) {
    const channelPct = ((callWall - putWall) / spot) * 100;
    if (channelPct <= 4 && Math.abs(flipDist) > FLIP_PROXIMITY_PCT) {
      // Channel is tight; bias toward the closer wall
      const callDist = callWall - spot;
      const putDist = spot - putWall;
      const direction: "long" | "short" = callDist < putDist ? "long" : "short";
      const target = direction === "long" ? callWall : putWall;
      const stop = direction === "long" ? putWall : callWall;
      const risk = Math.abs(spot - stop);
      const reward = Math.abs(target - spot);
      if (risk <= 0 || reward / risk < MIN_RR) return null;
      return {
        symbol: snap.symbol,
        setup: "squeeze_break",
        direction,
        entry: round(spot),
        target: round(target),
        stop: round(stop),
        riskRewardRatio: +(reward / risk).toFixed(2),
        confidence: 65,
        thesis: `Tight gamma channel ${channelPct.toFixed(1)}% wide under negative gamma — break setup toward ${direction === "long" ? "call" : "put"} wall.`,
        flipPoint,
        callWall,
        putWall,
        regime,
      };
    }
  }

  return null;
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}

async function isDuplicateRecent(
  symbol: string,
  setup: GexSetup,
  direction: "long" | "short",
): Promise<boolean> {
  try {
    const all = await storage.getAllTradeIdeas();
    const cutoff = Date.now() - DUPE_WINDOW_MS;
    return all.some(
      (i: any) =>
        i.symbol === symbol &&
        i.source === "gex_scanner" &&
        i.dataSourceUsed === `GEX_${setup}` &&
        (i.direction || "").toLowerCase() === direction &&
        new Date(i.timestamp).getTime() > cutoff,
    );
  } catch {
    return false;
  }
}

async function persistCandidate(c: GexIdeaCandidate): Promise<boolean> {
  if (await isDuplicateRecent(c.symbol, c.setup, c.direction)) return false;
  const sector = getSector(c.symbol);
  const holdingPeriod = c.setup === "flip_cross" ? ("day" as const) : ("swing" as const);

  // ── Try to enrich with real option contract (strike + expiry + premium) ──
  const aiShape: AITradeIdea = {
    symbol: c.symbol,
    assetType: "option",
    direction: c.direction,
    entryPrice: c.entry,
    targetPrice: c.target,
    stopLoss: c.stop,
    catalyst: `GEX ${c.setup.replace("_", " ")} setup`,
    analysis: c.thesis,
    sessionContext: "regular",
  };

  let tradeIdea: Record<string, any>;
  try {
    const enriched = await enrichOptionIdea(aiShape);
    if (enriched) {
      tradeIdea = {
        symbol: c.symbol,
        sector: sector ?? null,
        assetType: "option" as const,
        direction: c.direction,
        // The signal ladder is always expressed in UNDERLYING price space.
        // enrichOptionIdea returns premium-space levels; storing those here
        // made a $2.70 option premium look like PLTR's share entry and produced
        // impossible targets. Keep the contract mid in entryPremium and retain
        // the measured GEX share levels for entry/target/stop.
        entryPrice: c.entry,
        targetPrice: c.target,
        stopLoss: c.stop,
        riskRewardRatio: c.riskRewardRatio,
        entryPremium: enriched.entryPrice,
        optionType: enriched.optionType,
        strikePrice: enriched.strikePrice,
        expiryDate: enriched.expiryDate,
        catalyst: `GEX ${c.setup.replace("_", " ")} — ${enriched.optionType.toUpperCase()} $${enriched.strikePrice} exp ${enriched.expiryDate}`,
        analysis: enriched.analysis,
        source: "gex_scanner",
        dataSourceUsed: `GEX_${c.setup}`,
        sessionContext: "regular",
        timestamp: new Date().toISOString(),
        outcomeStatus: "open" as const,
        confidenceScore: c.confidence,
        holdingPeriod,
        qualitySignals: [
          `gamma_regime:${c.regime}`,
          `flip:${c.flipPoint?.toFixed(2)}`,
          c.callWall ? `call_wall:${c.callWall.toFixed(2)}` : "",
          c.putWall ? `put_wall:${c.putWall.toFixed(2)}` : "",
          `strike:${enriched.strikePrice}`,
          `expiry:${enriched.expiryDate}`,
          `premium:${enriched.entryPrice.toFixed(2)}`,
        ].filter(Boolean),
      };
      logger.info(
        `[GEX-SCANNER] 🎯 Enriched ${c.symbol} → ${enriched.optionType.toUpperCase()} $${enriched.strikePrice} exp ${enriched.expiryDate} @ $${enriched.entryPrice.toFixed(2)}`,
      );
    } else {
      throw new Error("enrichment returned null");
    }
  } catch {
    // Fallback: persist as stock-level idea when options chain unavailable
    tradeIdea = {
      symbol: c.symbol,
      sector: sector ?? null,
      assetType: "stock" as const,
      direction: c.direction,
      entryPrice: c.entry,
      targetPrice: c.target,
      stopLoss: c.stop,
      riskRewardRatio: c.riskRewardRatio,
      catalyst: `GEX ${c.setup.replace("_", " ")} setup`,
      analysis: c.thesis,
      source: "gex_scanner",
      dataSourceUsed: `GEX_${c.setup}`,
      sessionContext: "regular",
      timestamp: new Date().toISOString(),
      outcomeStatus: "open" as const,
      confidenceScore: c.confidence,
      holdingPeriod,
      qualitySignals: [
        `gamma_regime:${c.regime}`,
        `flip:${c.flipPoint?.toFixed(2)}`,
        c.callWall ? `call_wall:${c.callWall.toFixed(2)}` : "",
        c.putWall ? `put_wall:${c.putWall.toFixed(2)}` : "",
      ].filter(Boolean),
    };
  }

  try {
    await storage.createTradeIdea(tradeIdea as any);
    const label = tradeIdea.assetType === "option"
      ? `${tradeIdea.optionType?.toUpperCase()} $${tradeIdea.strikePrice} exp ${tradeIdea.expiryDate}`
      : `stock ${c.direction}`;
    logger.info(
      `[GEX-SCANNER] ✅ Persisted ${c.symbol} ${label} ${c.setup} R:R ${tradeIdea.riskRewardRatio}`,
    );
    return true;
  } catch (err) {
    logger.warn(`[GEX-SCANNER] persist failed for ${c.symbol}: ${(err as Error).message}`);
    return false;
  }
}

export interface GexScanResult {
  scanned: number;
  candidates: number;
  persisted: number;
  setups: GexIdeaCandidate[];
}

/**
 * Run a single pass of the GEX idea scanner over the approved universe.
 * Reuses gex-snapshot-service so it shares the 5-min cache with the
 * convictions engine — no duplicate Tradier traffic.
 */
/**
 * On-demand single-ticker GEX idea scan.
 * Called when a user views a ticker on Trade Desk or GEX Terminal.
 * Reuses the 5-min GEX cache so there's no extra Tradier traffic
 * if the symbol was already fetched recently.
 *
 * Returns the candidate (or null) and whether it was persisted.
 */
export async function scanTickerForGexIdea(symbol: string): Promise<{
  candidate: GexIdeaCandidate | null;
  persisted: boolean;
  cached: boolean;
}> {
  const { getGexSnapshot } = await import("./gex-snapshot-service");
  const snap = await getGexSnapshot(symbol.toUpperCase());
  if (!snap) return { candidate: null, persisted: false, cached: false };

  const candidate = buildCandidate(snap);
  if (!candidate) return { candidate: null, persisted: false, cached: false };

  const persisted = await persistCandidate(candidate);
  if (persisted) {
    const { invalidateConvictionsCache } = await import('./convictions-engine');
    invalidateConvictionsCache();
  }
  return { candidate, persisted, cached: !persisted };
}

/**
 * On-demand multi-ticker GEX scan. Up to 15 symbols at once.
 * Useful for scanning a watchlist or sector on demand.
 */
export async function scanBatchForGexIdeas(symbols: string[]): Promise<GexScanResult> {
  const batch = symbols.slice(0, 15).map(s => s.toUpperCase());
  logger.info(`[GEX-SCANNER] on-demand batch scan: ${batch.join(', ')}`);

  const snaps = await getGexSnapshotBatch(batch);
  const candidates: GexIdeaCandidate[] = [];
  Array.from(snaps.values()).forEach((snap) => {
    const c = buildCandidate(snap);
    if (c) candidates.push(c);
  });

  let persisted = 0;
  for (const c of candidates) {
    if (await persistCandidate(c)) persisted++;
  }

  if (persisted > 0) {
    const { invalidateConvictionsCache } = await import('./convictions-engine');
    invalidateConvictionsCache();
  }

  return { scanned: snaps.size, candidates: candidates.length, persisted, setups: candidates };
}

/**
 * Run a single pass of the GEX idea scanner over the approved universe.
 * Reuses gex-snapshot-service so it shares the 5-min cache with the
 * convictions engine — no duplicate Tradier traffic.
 */
export async function runGexIdeaScanner(): Promise<GexScanResult> {
  const symbols = Array.from(APPROVED_TICKERS).filter((s) => !s.includes("="));
  // Cap to 60 symbols per pass to bound options-chain fetches (each is heavy).
  const batch = symbols.slice(0, 60);

  logger.info(`[GEX-SCANNER] starting scan over ${batch.length} symbols`);
  const snaps = await getGexSnapshotBatch(batch);

  const candidates: GexIdeaCandidate[] = [];
  Array.from(snaps.values()).forEach((snap) => {
    const c = buildCandidate(snap);
    if (c) candidates.push(c);
  });
  logger.info(`[GEX-SCANNER] ${candidates.length} candidates from ${snaps.size} snapshots`);

  let persisted = 0;
  for (const c of candidates) {
    if (await persistCandidate(c)) persisted++;
  }

  if (persisted > 0) {
    const { invalidateConvictionsCache } = await import('./convictions-engine');
    invalidateConvictionsCache();
  }

  return {
    scanned: snaps.size,
    candidates: candidates.length,
    persisted,
    setups: candidates,
  };
}
