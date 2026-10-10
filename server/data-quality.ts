/**
 * Data Quality Verification Layer
 * ================================
 * Cross-source spot validation + staleness detection for the "live and
 * consistently accurate" mandate.
 *
 * Design:
 *   - Query multiple quote sources in parallel (Schwab → Tradier → Yahoo chart → Yahoo quote)
 *   - Cross-check their prices
 *   - Flag stale / divergent / missing sources
 *   - Return a BEST price + quality score (0-100)
 *   - Track per-source health so dashboards can surface degradation
 *
 * Quality Score Components:
 *   - source count      (0-30)  — number of working sources
 *   - agreement         (0-30)  — how tightly sources agree (<0.2% spread = full marks)
 *   - freshness         (0-25)  — newest timestamp (< 10s = full marks)
 *   - market status     (0-15)  — intraday w/ live ticks > after-hours
 */

import { logger } from './logger';
import { getTradierQuote } from './tradier-api';
import { getChartLastPrice, safeQuote, getBestPrice } from './yahoo-finance-service';
import { getSchwabQuote, isSchwabConfigured } from './schwab-options-adapter';

// ─── Types ──────────────────────────────────────────────────

export type QuoteSource = 'schwab' | 'tradier' | 'yahoo_chart' | 'yahoo_quote';

export interface SourceQuote {
  source: QuoteSource;
  price: number;
  bid?: number;
  ask?: number;
  prevClose?: number;
  fetchedAt: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

export interface CrossValidatedQuote {
  symbol: string;
  bestPrice: number;
  bestSource: QuoteSource | 'none';
  prevClose: number | null;
  change: number;
  changePct: number;

  // All source results
  sources: SourceQuote[];

  // Quality metrics
  qualityScore: number;          // 0-100
  qualityGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  sourceCount: number;           // how many sources returned a price
  maxSpreadPct: number;          // largest disagreement between sources (percent)
  oldestAgeMs: number;
  newestAgeMs: number;

  // Flags
  isStale: boolean;              // oldest > STALE_THRESHOLD
  hasDisagreement: boolean;      // maxSpreadPct > DISAGREE_THRESHOLD
  hasFallback: boolean;          // using a non-primary source because primary failed
  marketStatus: 'live' | 'closed' | 'premarket' | 'afterhours';

  // Diagnostic
  fetchedAt: number;
  totalFetchMs: number;
}

// ─── Thresholds ─────────────────────────────────────────────

const STALE_THRESHOLD_MS = 30_000;      // 30s for live quotes
const DISAGREE_THRESHOLD_PCT = 0.5;     // 0.5% spread = disagreement
const FRESH_THRESHOLD_MS = 10_000;      // 10s for full freshness marks

// ─── Source Health Tracking ─────────────────────────────────

interface SourceHealth {
  source: QuoteSource;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastErrorMessage: string | null;
  totalAttempts: number;
  totalSuccesses: number;
  totalFailures: number;
  avgLatencyMs: number;
  _latencySamples: number[];
}

const sourceHealthMap = new Map<QuoteSource, SourceHealth>();

function updateHealth(source: QuoteSource, ok: boolean, latencyMs: number, error?: string) {
  let h = sourceHealthMap.get(source);
  if (!h) {
    h = {
      source,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorMessage: null,
      totalAttempts: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      avgLatencyMs: 0,
      _latencySamples: [],
    };
    sourceHealthMap.set(source, h);
  }
  h.totalAttempts++;
  if (ok) {
    h.totalSuccesses++;
    h.lastSuccessAt = Date.now();
  } else {
    h.totalFailures++;
    h.lastFailureAt = Date.now();
    h.lastErrorMessage = error || 'unknown';
  }
  h._latencySamples.push(latencyMs);
  if (h._latencySamples.length > 50) h._latencySamples.shift();
  h.avgLatencyMs = h._latencySamples.reduce((a, b) => a + b, 0) / h._latencySamples.length;
}

export function getSourceHealth(): Array<Omit<SourceHealth, '_latencySamples'> & { successRate: number }> {
  return Array.from(sourceHealthMap.values()).map((h) => ({
    source: h.source,
    lastSuccessAt: h.lastSuccessAt,
    lastFailureAt: h.lastFailureAt,
    lastErrorMessage: h.lastErrorMessage,
    totalAttempts: h.totalAttempts,
    totalSuccesses: h.totalSuccesses,
    totalFailures: h.totalFailures,
    avgLatencyMs: Math.round(h.avgLatencyMs),
    successRate: h.totalAttempts > 0 ? h.totalSuccesses / h.totalAttempts : 0,
  }));
}

// ─── Market Status ──────────────────────────────────────────

export function getMarketStatus(): CrossValidatedQuote['marketStatus'] {
  // US Eastern Time market hours
  const now = new Date();
  // Convert to ET — approximate (ignores DST edge cases)
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const hour = et.getHours();
  const min = et.getMinutes();
  const mins = hour * 60 + min;

  // Weekend
  if (day === 0 || day === 6) return 'closed';

  // 4:00 - 9:30 pre-market
  if (mins >= 240 && mins < 570) return 'premarket';
  // 9:30 - 16:00 live
  if (mins >= 570 && mins < 960) return 'live';
  // 16:00 - 20:00 after-hours
  if (mins >= 960 && mins < 1200) return 'afterhours';

  return 'closed';
}

// ─── Individual Source Fetchers (timed) ────────────────────

async function fetchSchwab(symbol: string): Promise<SourceQuote> {
  const start = Date.now();
  try {
    if (!isSchwabConfigured()) {
      return {
        source: 'schwab', price: 0, fetchedAt: Date.now(),
        latencyMs: 0, ok: false, error: 'not_configured',
      };
    }
    const q = await getSchwabQuote(symbol);
    const latencyMs = Date.now() - start;
    if (!q || q.last <= 0) {
      updateHealth('schwab', false, latencyMs, 'no_data');
      return { source: 'schwab', price: 0, fetchedAt: Date.now(), latencyMs, ok: false, error: 'no_data' };
    }
    updateHealth('schwab', true, latencyMs);
    return {
      source: 'schwab',
      price: q.last,
      bid: q.bid,
      ask: q.ask,
      prevClose: q.prevClose,
      fetchedAt: Date.now(),
      latencyMs,
      ok: true,
    };
  } catch (e: any) {
    const latencyMs = Date.now() - start;
    updateHealth('schwab', false, latencyMs, e.message);
    return { source: 'schwab', price: 0, fetchedAt: Date.now(), latencyMs, ok: false, error: e.message };
  }
}

async function fetchTradier(symbol: string): Promise<SourceQuote> {
  const start = Date.now();
  try {
    const q = await getTradierQuote(symbol);
    const latencyMs = Date.now() - start;
    const price = q?.last || q?.close || 0;
    if (price <= 0) {
      updateHealth('tradier', false, latencyMs, 'no_data');
      return { source: 'tradier', price: 0, fetchedAt: Date.now(), latencyMs, ok: false, error: 'no_data' };
    }
    updateHealth('tradier', true, latencyMs);
    return {
      source: 'tradier',
      price,
      bid: (q as any)?.bid,
      ask: (q as any)?.ask,
      prevClose: (q as any)?.prevclose || (q as any)?.close,
      fetchedAt: Date.now(),
      latencyMs,
      ok: true,
    };
  } catch (e: any) {
    const latencyMs = Date.now() - start;
    updateHealth('tradier', false, latencyMs, e.message);
    return { source: 'tradier', price: 0, fetchedAt: Date.now(), latencyMs, ok: false, error: e.message };
  }
}

async function fetchYahooChart(symbol: string): Promise<SourceQuote> {
  const start = Date.now();
  try {
    const price = await getChartLastPrice(symbol);
    const latencyMs = Date.now() - start;
    if (price <= 0) {
      updateHealth('yahoo_chart', false, latencyMs, 'no_data');
      return { source: 'yahoo_chart', price: 0, fetchedAt: Date.now(), latencyMs, ok: false, error: 'no_data' };
    }
    updateHealth('yahoo_chart', true, latencyMs);
    return { source: 'yahoo_chart', price, fetchedAt: Date.now(), latencyMs, ok: true };
  } catch (e: any) {
    const latencyMs = Date.now() - start;
    updateHealth('yahoo_chart', false, latencyMs, e.message);
    return { source: 'yahoo_chart', price: 0, fetchedAt: Date.now(), latencyMs, ok: false, error: e.message };
  }
}

async function fetchYahooQuote(symbol: string): Promise<SourceQuote> {
  const start = Date.now();
  try {
    const yq = await safeQuote(symbol);
    const price = getBestPrice(yq);
    const latencyMs = Date.now() - start;
    if (price <= 0) {
      updateHealth('yahoo_quote', false, latencyMs, 'no_data');
      return { source: 'yahoo_quote', price: 0, fetchedAt: Date.now(), latencyMs, ok: false, error: 'no_data' };
    }
    updateHealth('yahoo_quote', true, latencyMs);
    return {
      source: 'yahoo_quote',
      price,
      bid: (yq as any)?.bid,
      ask: (yq as any)?.ask,
      prevClose: (yq as any)?.regularMarketPreviousClose,
      fetchedAt: Date.now(),
      latencyMs,
      ok: true,
    };
  } catch (e: any) {
    const latencyMs = Date.now() - start;
    updateHealth('yahoo_quote', false, latencyMs, e.message);
    return { source: 'yahoo_quote', price: 0, fetchedAt: Date.now(), latencyMs, ok: false, error: e.message };
  }
}

// ─── Cross-Validated Quote ──────────────────────────────────

/**
 * Fetches quotes from all configured sources in parallel and returns a
 * cross-validated best price with quality metrics.
 *
 * Priority (for "bestPrice" selection):
 *   1. Schwab (live, exchange-direct)
 *   2. Tradier (live brokerage feed)
 *   3. Yahoo chart (1-min candle, usually <1 min delayed)
 *   4. Yahoo quote (regular market price, can be delayed 15m for some symbols)
 */
export async function getCrossValidatedQuote(symbol: string): Promise<CrossValidatedQuote> {
  const startedAt = Date.now();

  const [schwab, tradier, chart, yquote] = await Promise.all([
    fetchSchwab(symbol),
    fetchTradier(symbol),
    fetchYahooChart(symbol),
    fetchYahooQuote(symbol),
  ]);

  const sources: SourceQuote[] = [schwab, tradier, chart, yquote];
  const okSources = sources.filter((s) => s.ok && s.price > 0);

  // Priority-ordered best price selection
  const priority: QuoteSource[] = ['schwab', 'tradier', 'yahoo_chart', 'yahoo_quote'];
  let bestPrice = 0;
  let bestSource: QuoteSource | 'none' = 'none';
  for (const p of priority) {
    const match = okSources.find((s) => s.source === p);
    if (match) {
      bestPrice = match.price;
      bestSource = p;
      break;
    }
  }

  // Prev close (prefer the best source's prev close, then fallback)
  const prevClose =
    okSources.find((s) => s.source === bestSource)?.prevClose ||
    okSources.find((s) => s.prevClose && s.prevClose > 0)?.prevClose ||
    null;

  const change = prevClose ? bestPrice - prevClose : 0;
  const changePct = prevClose && prevClose > 0 ? (change / prevClose) * 100 : 0;

  // Compute max spread (disagreement) across successful sources
  let maxSpreadPct = 0;
  if (okSources.length >= 2 && bestPrice > 0) {
    const prices = okSources.map((s) => s.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    maxSpreadPct = ((max - min) / bestPrice) * 100;
  }

  // Freshness
  const now = Date.now();
  const ages = okSources.map((s) => now - s.fetchedAt);
  const oldestAgeMs = ages.length > 0 ? Math.max(...ages) : Number.POSITIVE_INFINITY;
  const newestAgeMs = ages.length > 0 ? Math.min(...ages) : Number.POSITIVE_INFINITY;

  // Flags
  const isStale = oldestAgeMs > STALE_THRESHOLD_MS;
  const hasDisagreement = maxSpreadPct > DISAGREE_THRESHOLD_PCT;
  const hasFallback = bestSource !== 'schwab' && schwab.ok === false && isSchwabConfigured();
  const marketStatus = getMarketStatus();

  // Quality score 0-100
  let qualityScore = 0;

  // Source count (0-30)
  if (okSources.length >= 3) qualityScore += 30;
  else if (okSources.length === 2) qualityScore += 22;
  else if (okSources.length === 1) qualityScore += 12;

  // Agreement (0-30)
  if (okSources.length >= 2) {
    if (maxSpreadPct < 0.1) qualityScore += 30;
    else if (maxSpreadPct < 0.25) qualityScore += 24;
    else if (maxSpreadPct < 0.5) qualityScore += 16;
    else if (maxSpreadPct < 1.0) qualityScore += 8;
  } else if (okSources.length === 1) {
    // Single source — partial credit (can't validate)
    qualityScore += 15;
  }

  // Freshness (0-25)
  if (newestAgeMs < FRESH_THRESHOLD_MS) qualityScore += 25;
  else if (newestAgeMs < 30_000) qualityScore += 18;
  else if (newestAgeMs < 60_000) qualityScore += 10;
  else if (newestAgeMs < 300_000) qualityScore += 4;

  // Market status (0-15)
  if (marketStatus === 'live') qualityScore += 15;
  else if (marketStatus === 'premarket' || marketStatus === 'afterhours') qualityScore += 10;
  else qualityScore += 5; // closed — limited but still usable

  const qualityGrade: CrossValidatedQuote['qualityGrade'] =
    qualityScore >= 90 ? 'A'
    : qualityScore >= 75 ? 'B'
    : qualityScore >= 60 ? 'C'
    : qualityScore >= 40 ? 'D'
    : 'F';

  const totalFetchMs = Date.now() - startedAt;

  const result: CrossValidatedQuote = {
    symbol,
    bestPrice,
    bestSource,
    prevClose,
    change,
    changePct,
    sources,
    qualityScore,
    qualityGrade,
    sourceCount: okSources.length,
    maxSpreadPct,
    oldestAgeMs,
    newestAgeMs,
    isStale,
    hasDisagreement,
    hasFallback,
    marketStatus,
    fetchedAt: Date.now(),
    totalFetchMs,
  };

  // Log summary — but only warn on quality issues
  if (okSources.length === 0) {
    logger.error(`[DQ] ${symbol}: NO SOURCES returned data. Fetched in ${totalFetchMs}ms`);
  } else if (hasDisagreement) {
    logger.warn(
      `[DQ] ${symbol}: DISAGREEMENT (${maxSpreadPct.toFixed(2)}%) grade=${qualityGrade} ` +
      `best=${bestSource}@$${bestPrice.toFixed(2)} sources=[${okSources.map((s) => `${s.source}:$${s.price.toFixed(2)}`).join(', ')}]`,
    );
  } else if (qualityScore < 60) {
    logger.warn(`[DQ] ${symbol}: low quality grade=${qualityGrade} score=${qualityScore} sources=${okSources.length}`);
  } else {
    logger.info(
      `[DQ] ${symbol}: grade=${qualityGrade}(${qualityScore}) best=${bestSource}@$${bestPrice.toFixed(2)} ` +
      `sources=${okSources.length} spread=${maxSpreadPct.toFixed(3)}% ${totalFetchMs}ms`,
    );
  }

  return result;
}

// ─── Batch ──────────────────────────────────────────────────

/**
 * Cross-validate a batch of symbols. Runs in parallel batches of 5 to respect
 * upstream rate limits.
 */
export async function getCrossValidatedQuoteBatch(
  symbols: string[],
  batchSize = 5,
): Promise<Map<string, CrossValidatedQuote>> {
  const results = new Map<string, CrossValidatedQuote>();
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((s) => getCrossValidatedQuote(s)));
    batch.forEach((sym, idx) => results.set(sym, batchResults[idx]));
  }
  return results;
}

// ─── Options Staleness ──────────────────────────────────────

/**
 * Options chains have different staleness rules — OI updates once per day at
 * settlement, while bid/ask/IV updates intraday. This helper flags whether
 * an options snapshot's OI is fresh enough to be trusted.
 */
export function assessOptionsStaleness(expirationsUsed: string[], fetchedAt: number): {
  isFresh: boolean;
  ageMs: number;
  reason?: string;
} {
  const ageMs = Date.now() - fetchedAt;
  const marketStatus = getMarketStatus();

  // During live hours, options OI is stale from yesterday's settlement.
  // This is expected — we just warn if the SNAPSHOT itself is old.
  if (marketStatus === 'live' && ageMs > 5 * 60_000) {
    return { isFresh: false, ageMs, reason: 'snapshot_stale_live' };
  }
  if (ageMs > 15 * 60_000) {
    return { isFresh: false, ageMs, reason: 'snapshot_stale' };
  }
  if (expirationsUsed.length === 0) {
    return { isFresh: false, ageMs, reason: 'no_expirations' };
  }
  return { isFresh: true, ageMs };
}

// ─── Startup log ────────────────────────────────────────────

logger.info(
  `[DQ] Data-quality layer loaded. Sources: ${isSchwabConfigured() ? 'Schwab✓' : 'Schwab✗'} Tradier✓ Yahoo✓`,
);
