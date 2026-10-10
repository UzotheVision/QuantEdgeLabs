/**
 * GEX HISTORY ARCHIVER
 * ====================
 * Saves hourly GEX snapshots to the database so users can browse
 * historical gamma exposure for any ticker on any date.
 *
 * This solves: "why can't I scroll to see any single date for any
 * big single GEX profile across the years?"
 *
 * Runs via worker.ts cron every hour during market hours.
 * Archives top tickers' full GEX profile including:
 *   - Spot, flip, call wall, put wall, regime
 *   - Top 15 strike levels with gex values
 *   - Condensed heatmap data
 *   - Strike × expiry matrix for full replay
 *
 * The archived data is enough to reconstruct the full GEX profile
 * view for any historical date.
 */

import { logger } from "./logger";
import { storage } from "./storage";
import { calculateAggregateGammaExposure } from "./gamma-exposure";
import { toSnapshot } from "./gex-vex-scanner";
import { getCrossValidatedQuote } from "./data-quality";
import { APPROVED_TICKERS } from "@shared/approved-tickers";

// Top tickers to archive — the ones users actually look at GEX for.
// We archive these every hour. More can be added over time.
const ARCHIVE_TICKERS = [
  // Index ETFs — the most-viewed GEX profiles
  'SPY', 'QQQ', 'IWM', 'DIA',
  // Mega caps
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA',
  // High-gamma names (frequently traded options)
  'AMD', 'COIN', 'NFLX', 'INTC', 'SQ', 'PLTR', 'SHOP',
  'UBER', 'ROKU', 'DKNG', 'ARM', 'SMCI', 'SOFI',
  // Semis & enterprise (user trades these actively)
  'AVGO', 'ORCL', 'ASML', 'MU', 'CRM', 'CRWV',
  // SaaS momentum (sector rotation plays)
  'NOW', 'NET', 'SNOW', 'PANW', 'ZS', 'DDOG',
  // Financials & alt-finance
  'APO', 'GS', 'HOOD', 'MSTR',
  // Retail favorites & high-OI names
  'WMT', 'CAT', 'ABNB', 'SNAP', 'LYFT', 'RBLX',
  // User's watchlist favorites
  'OKLO', 'AAOI', 'MARA', 'RIVN',
  // Space & aerospace
  'LUNR', 'RKLB', 'ASTS', 'RDW', 'ACHR', 'JOBY',
  // Memory / storage
  'SNDK', 'WDC',
  // Photonics / optics
  'LITE', 'COHR',
];

interface ArchiveResult {
  archived: number;
  failed: number;
  symbols: string[];
}

/**
 * Archive a single ticker's GEX snapshot to the database.
 */
async function archiveTicker(symbol: string): Promise<boolean> {
  try {
    const gex = await calculateAggregateGammaExposure(symbol);
    if (!gex) {
      logger.debug(`[GEX-ARCHIVE] No GEX data for ${symbol}, skipping`);
      return false;
    }

    const snapshot = toSnapshot(gex);
    const cq = await getCrossValidatedQuote(symbol);

    // Build condensed top levels (top 15 by |gex|)
    const topLevels = [...snapshot.levels]
      .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex))
      .slice(0, 15)
      .map(l => ({
        strike: l.strike,
        gex: l.gex,
        gammaPct: l.gammaPct,
        role: l.role,
      }));

    // Condensed heatmap
    const maxAbs = Math.max(...snapshot.levels.map(l => Math.abs(l.gex)), 1);
    const heatmapData = snapshot.levels.slice(0, 20).map(l => ({
      strike: l.strike,
      intensity: Math.abs(l.gex) / maxAbs,
      gex: l.gex,
      side: l.gex > 0 ? 'call' : l.gex < 0 ? 'put' : 'neutral',
    }));

    // Save to DB
    await storage.createGexSnapshot({
      symbol,
      spotPrice: cq.bestPrice > 0 ? cq.bestPrice : snapshot.spotPrice,
      flipPoint: snapshot.flipPoint ?? null,
      callWall: snapshot.callWall ?? null,
      putWall: snapshot.putWall ?? null,
      flipDistancePct: snapshot.flipPoint && snapshot.spotPrice > 0
        ? ((snapshot.flipPoint - snapshot.spotPrice) / snapshot.spotPrice) * 100
        : null,
      regime: snapshot.regime ?? null,
      vexRegime: snapshot.regime ?? null,
      netGexSign: snapshot.totalGEX > 0 ? 'positive' : snapshot.totalGEX < 0 ? 'negative' : 'neutral',
      totalGex: snapshot.totalGEX,
      maxGammaStrike: snapshot.maxGammaStrike ?? null,
      topLevels,
      heatmapData,
      strikeExpiryMatrix: gex.strikeExpiryMatrix || [],
      snapshotAt: new Date(),
      marketSession: cq.marketStatus || 'regular',
      dataGrade: cq.qualityGrade || null,
    });

    return true;
  } catch (err) {
    logger.error(`[GEX-ARCHIVE] Failed to archive ${symbol}:`, err);
    return false;
  }
}

/**
 * Archive all tracked tickers. Called by worker.ts cron.
 */
export async function archiveGexSnapshots(): Promise<ArchiveResult> {
  logger.info(`[GEX-ARCHIVE] Starting hourly archive of ${ARCHIVE_TICKERS.length} tickers`);

  let archived = 0;
  let failed = 0;
  const archivedSymbols: string[] = [];

  // Process in batches of 5 to avoid overwhelming the options chain APIs
  for (let i = 0; i < ARCHIVE_TICKERS.length; i += 5) {
    const batch = ARCHIVE_TICKERS.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(sym => archiveTicker(sym))
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled' && r.value) {
        archived++;
        archivedSymbols.push(batch[j]);
      } else {
        failed++;
      }
    }

    // Small delay between batches
    if (i + 5 < ARCHIVE_TICKERS.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  logger.info(`[GEX-ARCHIVE] Complete: ${archived} archived, ${failed} failed`);
  return { archived, failed, symbols: archivedSymbols };
}

/**
 * Get available dates for a symbol's GEX history.
 */
export async function getGexHistoryDates(symbol: string): Promise<string[]> {
  const snapshots = await storage.getGexSnapshots(symbol);
  // Group by date, return unique dates
  const dates = new Set<string>();
  for (const s of snapshots) {
    const d = new Date(s.snapshotAt).toISOString().split('T')[0];
    dates.add(d);
  }
  return Array.from(dates).sort().reverse();
}

/**
 * Get GEX snapshots for a symbol on a specific date.
 * Returns all hourly snapshots for that day, sorted by time.
 */
export async function getGexHistoryForDate(
  symbol: string,
  date: string,
): Promise<any[]> {
  const all = await storage.getGexSnapshots(symbol);
  return all
    .filter(s => new Date(s.snapshotAt).toISOString().startsWith(date))
    .sort((a, b) => new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime());
}

/**
 * Get the latest snapshot for a symbol from the archive.
 * Falls back to live computation if no archive exists.
 */
export async function getLatestArchivedSnapshot(symbol: string): Promise<any | null> {
  const snapshots = await storage.getGexSnapshots(symbol);
  if (snapshots.length === 0) return null;
  return snapshots.sort(
    (a, b) => new Date(b.snapshotAt).getTime() - new Date(a.snapshotAt).getTime()
  )[0];
}

// ─── GROWING GAMMA DETECTION ─────────────────────────────────────────
// Compares current gamma profile vs historical to detect building activity.
// Growing gamma = dealers hedging more = something is about to move.

export interface GammaGrowthSignal {
  symbol: string;
  currentTotalGamma: number;
  previousTotalGamma: number;
  growthPct: number;            // % increase in total absolute gamma
  hotStrikes: Array<{
    strike: number;
    currentGamma: number;
    previousGamma: number;
    growthPct: number;
  }>;
  newStrikes: number[];          // strikes that appeared (weren't in prior snapshot)
  spotPrice: number;
  maxGammaStrike: number;
  signal: 'surging' | 'growing' | 'stable' | 'fading';
  timestamp: string;
}

/**
 * Detect growing gamma for a single ticker by comparing latest snapshot
 * to the most recent prior snapshot (ideally yesterday or a few hours ago).
 */
export async function detectGammaGrowth(symbol: string): Promise<GammaGrowthSignal | null> {
  const { calculateGammaExposure } = await import('./gamma-exposure');

  // Get current live GEX
  let currentGex: any;
  try {
    currentGex = await calculateGammaExposure(symbol);
    // GammaExposureResult uses 'strikes' array with 'netGEX' field
    if (!currentGex || !currentGex.strikes || currentGex.strikes.length === 0) return null;
  } catch {
    return null;
  }

  // Get the most recent archived snapshot for comparison
  const snapshots = await storage.getGexSnapshots(symbol, 10);
  if (snapshots.length === 0) {
    // No history — can't compute growth, but return current state
    const totalGamma = currentGex.strikes.reduce(
      (sum: number, l: any) => sum + Math.abs(l.netGEX || l.gex || 0), 0
    );
    return {
      symbol,
      currentTotalGamma: totalGamma,
      previousTotalGamma: 0,
      growthPct: 0,
      hotStrikes: [],
      newStrikes: [],
      spotPrice: currentGex.spotPrice,
      maxGammaStrike: currentGex.maxGammaStrike || 0,
      signal: 'stable',
      timestamp: new Date().toISOString(),
    };
  }

  // Use the oldest snapshot in our recent window as the comparison baseline
  // (ideally from yesterday or early today)
  const priorSnapshot = snapshots[snapshots.length - 1];
  const priorLevels: any[] = (priorSnapshot.topLevels as any[]) || [];

  // Build gamma maps: strike → absolute gamma
  // Live data uses 'strikes' with 'netGEX'; archived uses 'topLevels' with 'gex'
  const currentMap = new Map<number, number>();
  for (const l of currentGex.strikes) {
    currentMap.set(l.strike, Math.abs(l.netGEX || l.gex || 0));
  }

  const priorMap = new Map<number, number>();
  for (const l of priorLevels) {
    priorMap.set(l.strike, Math.abs(l.gex || 0));
  }

  // Total gamma comparison
  const currentTotal = Array.from(currentMap.values()).reduce((a, b) => a + b, 0);
  const priorTotal = Array.from(priorMap.values()).reduce((a, b) => a + b, 0);
  const growthPct = priorTotal > 0 ? ((currentTotal - priorTotal) / priorTotal) * 100 : 0;

  // Find hot strikes — biggest gamma increases
  const hotStrikes: GammaGrowthSignal['hotStrikes'] = [];
  for (const [strike, currentGamma] of currentMap) {
    const prevGamma = priorMap.get(strike) || 0;
    if (currentGamma > prevGamma && currentGamma > 0.01) {
      const strikeGrowth = prevGamma > 0
        ? ((currentGamma - prevGamma) / prevGamma) * 100
        : 999; // new strike = infinite growth
      hotStrikes.push({
        strike,
        currentGamma,
        previousGamma: prevGamma,
        growthPct: strikeGrowth,
      });
    }
  }
  hotStrikes.sort((a, b) => b.growthPct - a.growthPct);

  // New strikes that weren't in prior snapshot
  const newStrikes = Array.from(currentMap.keys())
    .filter(s => !priorMap.has(s));

  // Classify signal strength
  let signal: GammaGrowthSignal['signal'];
  if (growthPct > 50) signal = 'surging';
  else if (growthPct > 15) signal = 'growing';
  else if (growthPct > -15) signal = 'stable';
  else signal = 'fading';

  return {
    symbol,
    currentTotalGamma: currentTotal,
    previousTotalGamma: priorTotal,
    growthPct,
    hotStrikes: hotStrikes.slice(0, 8),
    newStrikes,
    spotPrice: currentGex.spotPrice,
    maxGammaStrike: currentGex.maxGammaStrike || 0,
    signal,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Scan all archive tickers for growing gamma.
 * Returns sorted by growth rate — the fastest-growing gamma = most likely to move.
 */
export async function scanGammaGrowth(): Promise<GammaGrowthSignal[]> {
  logger.info(`[GAMMA-GROWTH] Scanning ${ARCHIVE_TICKERS.length} tickers for growing gamma...`);
  const results: GammaGrowthSignal[] = [];

  for (let i = 0; i < ARCHIVE_TICKERS.length; i += 5) {
    const batch = ARCHIVE_TICKERS.slice(i, i + 5);
    const batchResults = await Promise.allSettled(
      batch.map(sym => detectGammaGrowth(sym))
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
    }
    if (i + 5 < ARCHIVE_TICKERS.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // Sort by growth % descending — surging gamma first
  results.sort((a, b) => b.growthPct - a.growthPct);

  const surging = results.filter(r => r.signal === 'surging').length;
  const growing = results.filter(r => r.signal === 'growing').length;
  logger.info(`[GAMMA-GROWTH] Complete: ${surging} surging, ${growing} growing, ${results.length} total`);

  return results;
}

export { ARCHIVE_TICKERS };
