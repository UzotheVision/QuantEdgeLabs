/**
 * Bollinger Squeeze Scanner
 * =========================
 * Scans the market for tickers with tightening Bollinger Bands.
 * Tight bands = coiling = explosive move coming.
 *
 * Runs every 30 min during market hours.
 * Returns top 50 tightest coils sorted by bandwidth.
 */

import { logger } from './logger';
import { classifySqueeze, type SqueezeResult } from './squeeze-detection';
import { getFullUniverse } from './ticker-universe';
import { isApprovedTicker } from '@shared/approved-tickers';

export interface SqueezeCandidate {
  symbol: string;
  price: number;
  squeeze: SqueezeResult;
  volume: number;
  avgVolume: number;
  changePct: number;
  onWatchlist: boolean;
}

// Cache
let squeezeCache: { data: SqueezeCandidate[]; ts: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 min

/**
 * Fetch OHLC data from Yahoo for a ticker
 */
async function fetchYahooOHLC(symbol: string): Promise<{ closes: number[]; price: number; volume: number; avgVolume: number; changePct: number } | null> {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=1mo&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const closes = (result.indicators?.quote?.[0]?.close || []).filter(Boolean) as number[];
    const volumes = (result.indicators?.quote?.[0]?.volume || []).filter(Boolean) as number[];
    const meta = result.meta || {};

    if (closes.length < 25) return null; // Need at least 25 bars for BB(20)

    const price = meta.regularMarketPrice || closes[closes.length - 1] || 0;
    const prevClose = closes.length >= 2 ? closes[closes.length - 2] : price;
    const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    const volume = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
    const avgVolume = volumes.length >= 10
      ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10
      : volume;

    return { closes, price, volume, avgVolume, changePct: +changePct.toFixed(2) };
  } catch {
    return null;
  }
}

/**
 * Scan a batch of tickers for squeezes
 */
async function scanBatch(symbols: string[]): Promise<SqueezeCandidate[]> {
  const results: SqueezeCandidate[] = [];

  for (const symbol of symbols) {
    try {
      const data = await fetchYahooOHLC(symbol);
      if (!data || data.price <= 0) continue;

      // Filter: price $5-2000, avg volume > 500K
      if (data.price < 5 || data.price > 2000) continue;
      if (data.avgVolume < 500000) continue;

      const squeeze = classifySqueeze(data.closes);
      if (squeeze.isSqueezing) {
        results.push({
          symbol,
          price: +data.price.toFixed(2),
          squeeze,
          volume: data.volume,
          avgVolume: data.avgVolume,
          changePct: data.changePct,
          onWatchlist: isApprovedTicker(symbol),
        });
      }
    } catch {
      // Skip failed tickers silently
    }
  }

  return results;
}

/**
 * Run the full squeeze scan
 */
export async function runSqueezeScan(): Promise<SqueezeCandidate[]> {
  // Check cache
  if (squeezeCache && Date.now() - squeezeCache.ts < CACHE_TTL) {
    return squeezeCache.data;
  }

  logger.info('[SQUEEZE-SCAN] Starting market-wide squeeze scan...');
  const startTime = Date.now();

  // Get tickers to scan — full universe + watchlist
  const universe = getFullUniverse();
  const allTickers = [...new Set(universe)]; // dedupe

  logger.info(`[SQUEEZE-SCAN] Scanning ${allTickers.length} tickers...`);

  // Process in batches of 15 with 500ms delay (rate limit Yahoo)
  const BATCH_SIZE = 15;
  const BATCH_DELAY = 500;
  const allResults: SqueezeCandidate[] = [];

  for (let i = 0; i < allTickers.length; i += BATCH_SIZE) {
    const batch = allTickers.slice(i, i + BATCH_SIZE);
    const batchResults = await scanBatch(batch);
    allResults.push(...batchResults);

    // Rate limit
    if (i + BATCH_SIZE < allTickers.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }

    // Log progress every 100 tickers
    if ((i + BATCH_SIZE) % 100 === 0 || i + BATCH_SIZE >= allTickers.length) {
      logger.info(`[SQUEEZE-SCAN] Progress: ${Math.min(i + BATCH_SIZE, allTickers.length)}/${allTickers.length} scanned, ${allResults.length} squeezes found`);
    }
  }

  // Sort by bandwidth (tightest first)
  allResults.sort((a, b) => a.squeeze.bandwidth - b.squeeze.bandwidth);

  // Take top 50
  const top = allResults.slice(0, 50);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(`[SQUEEZE-SCAN] Complete: ${allResults.length} squeezes found in ${elapsed}s. Top: ${top.slice(0, 5).map(t => `${t.symbol}(${t.squeeze.bandwidth}%)`).join(', ')}`);

  // Cache
  squeezeCache = { data: top, ts: Date.now() };

  return top;
}

/**
 * Get cached results (for API endpoint)
 */
export async function getSqueezeScanResults(): Promise<{
  squeezes: SqueezeCandidate[];
  watchlistSqueezes: SqueezeCandidate[];
  totalScanned: number;
  lastScanTime: string;
}> {
  const results = await runSqueezeScan();
  return {
    squeezes: results,
    watchlistSqueezes: results.filter(r => r.onWatchlist),
    totalScanned: getFullUniverse().length,
    lastScanTime: squeezeCache ? new Date(squeezeCache.ts).toISOString() : new Date().toISOString(),
  };
}

logger.info('[SQUEEZE-SCAN] Squeeze Scanner loaded');
