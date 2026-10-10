/**
 * SCANNER UNIVERSE — single source of truth for "what symbols do we scan?"
 *
 * Before this file, each scanner maintained its own hardcoded watchlist:
 *   - bullish-trend-scanner: 67 symbols (nuclear/defense/space/crypto/AI/tech)
 *   - popular-tickers-scanner: 54 symbols (mega cap + popular + ETFs)
 *   - auto-idea-generator: S-tier + A-tier + index ETFs
 *
 * None of them included the user's personal watchlist. If you added DDOG
 * to your watchlist, the scanners wouldn't scan DDOG unless it happened
 * to be in one of the hardcoded lists.
 *
 * This module merges:
 *   1. The user's personal watchlist (from DB)
 *   2. The approved-tickers static universe (shared/approved-tickers.ts)
 *   3. Each scanner's domain-specific symbols
 *
 * User watchlist symbols are ALWAYS included and scanned first (priority).
 */

import { storage } from "./storage";
import { getAllApprovedSymbols } from "@shared/approved-tickers";
import { logger } from "./logger";

// Cache the merged universe for 5 minutes to avoid DB hits on every scan cycle
let _cachedUniverse: { symbols: string[]; watchlistSymbols: Set<string>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Returns the full scanner universe: user watchlist + approved tickers.
 * The watchlist symbols come first so scanners process them with priority.
 */
export async function getScannerUniverse(): Promise<{
  /** All symbols to scan, watchlist first */
  symbols: string[];
  /** Set of symbols that are on the user's watchlist (for priority tagging) */
  watchlistSymbols: Set<string>;
}> {
  const now = Date.now();
  if (_cachedUniverse && _cachedUniverse.expiresAt > now) {
    return _cachedUniverse;
  }

  // Fetch all watchlist items (across all users)
  let watchlistSymbols = new Set<string>();
  try {
    const items = await storage.getAllWatchlist();
    for (const item of items) {
      if (item.symbol) {
        watchlistSymbols.add(item.symbol.toUpperCase());
      }
    }
  } catch (err) {
    logger.warn("[SCANNER-UNIVERSE] Failed to fetch watchlist:", err);
  }

  // Get the static approved-tickers universe
  const approvedSymbols = getAllApprovedSymbols();

  // ── Dynamic discovery tier ────────────────────────────────────────────────
  // A static list can only ever find what we already knew to look for. The names
  // that actually pay — MRNA printing +177% on the most-active tape — are exactly
  // the ones nobody had on a list that morning. So the universe also absorbs today's
  // movers (most active / gainers / losers / trending) on every rebuild. Failure here
  // is non-fatal: we just fall back to the static universe.
  let moverSymbols: string[] = [];
  try {
    const { discoverMovers } = await import('./mover-discovery');
    const movers = await discoverMovers();
    moverSymbols = movers
      .map((m: any) => String(m.symbol || '').toUpperCase())
      .filter((sym) => sym && sym.length <= 6 && /^[A-Z.\-]+$/.test(sym));
  } catch (err) {
    logger.warn('[SCANNER-UNIVERSE] Mover discovery unavailable, using static universe:', err);
  }

  // Merge: watchlist first, then approved, deduped
  const seen = new Set<string>();
  const symbols: string[] = [];

  // Watchlist symbols get priority (scanned first)
  watchlistSymbols.forEach((sym) => {
    if (!seen.has(sym)) {
      seen.add(sym);
      symbols.push(sym);
    }
  });

  // Then approved tickers
  for (const sym of approvedSymbols) {
    if (!seen.has(sym)) {
      seen.add(sym);
      symbols.push(sym);
    }
  }

  // Then whatever the tape surfaced today
  let freshMovers = 0;
  for (const sym of moverSymbols) {
    if (!seen.has(sym)) {
      seen.add(sym);
      symbols.push(sym);
      freshMovers++;
    }
  }

  logger.info(
    `[SCANNER-UNIVERSE] Built universe: ${watchlistSymbols.size} watchlist + ${approvedSymbols.length} approved + ${freshMovers} new movers (${moverSymbols.length} seen) = ${symbols.length} total (deduped)`,
  );

  _cachedUniverse = { symbols, watchlistSymbols, expiresAt: now + CACHE_TTL_MS };
  return _cachedUniverse;
}

/** Force-refresh the cached universe (call after watchlist changes). */
export function invalidateScannerUniverse(): void {
  _cachedUniverse = null;
}
