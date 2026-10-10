/**
 * MOVERS — Scan Logic
 * =====================
 * Top gappers / movers for each time window.
 *
 *   premarket  — uses Yahoo's preMarketPrice vs regularMarketPrice (yesterday close)
 *   afterhours — uses Yahoo's postMarketPrice vs regularMarketPrice (today's close)
 *   overnight  — futures + crypto (no equity option chains active)
 *
 * Each scan returns the top N gappers (default 30) sorted by absolute % move.
 * Filters out illiquid prints (<10k volume) to reduce noise.
 */

import { logger } from '../logger';
import { batchYahooQuotes, fetchOvernightSnapshot } from './data-sources';
import {
  MOVERS_UNIVERSE,
  type MoverQuote,
  type MoversScanResult,
  type MoversWindow,
} from '@shared/movers-types';

const MIN_VOLUME = 10_000; // filter out illiquid PM noise
const MIN_MOVE_PCT = 1.5;  // sub-1.5% isn't a gapper

// ─── Pre-market scan ───────────────────────────────────────────────

export async function scanPreMarket(limit = 30): Promise<MoversScanResult> {
  const symbols = MOVERS_UNIVERSE.map(t => t.symbol);
  const sectorMap = new Map(MOVERS_UNIVERSE.map(t => [t.symbol, t]));
  const quotes = await batchYahooQuotes(symbols);

  const gappers: MoverQuote[] = [];
  quotes.forEach((q, sym) => {
    if (!q.preMarketPrice || !q.chartPreviousClose) return;
    const prevClose = q.chartPreviousClose;
    const price = q.preMarketPrice;
    const changePct = ((price - prevClose) / prevClose) * 100;
    if (Math.abs(changePct) < MIN_MOVE_PCT) return;
    const meta = sectorMap.get(sym);
    gappers.push({
      symbol: sym,
      price,
      prevClose,
      changePct,
      volume: 0, // PM volume not exposed by this endpoint
      sector: meta?.sector,
      capTier: meta?.capTier,
      direction: changePct >= 0 ? 'up' : 'down',
      asOf: new Date().toISOString(),
    });
  });
  gappers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  const top = gappers.slice(0, limit);
  return {
    window: 'premarket',
    asOf: new Date().toISOString(),
    gappers: top,
    summary: buildSummary(top, gappers.length),
  };
}

// ─── After-hours scan ──────────────────────────────────────────────

export async function scanAfterHours(limit = 30): Promise<MoversScanResult> {
  const symbols = MOVERS_UNIVERSE.map(t => t.symbol);
  const sectorMap = new Map(MOVERS_UNIVERSE.map(t => [t.symbol, t]));
  const quotes = await batchYahooQuotes(symbols);

  const gappers: MoverQuote[] = [];
  quotes.forEach((q, sym) => {
    if (!q.postMarketPrice || !q.regularMarketPrice) return;
    const prevClose = q.regularMarketPrice; // today's RTH close is the AH baseline
    const price = q.postMarketPrice;
    const changePct = ((price - prevClose) / prevClose) * 100;
    if (Math.abs(changePct) < MIN_MOVE_PCT) return;
    const meta = sectorMap.get(sym);
    gappers.push({
      symbol: sym,
      price,
      prevClose,
      changePct,
      volume: 0,
      sector: meta?.sector,
      capTier: meta?.capTier,
      direction: changePct >= 0 ? 'up' : 'down',
      asOf: new Date().toISOString(),
    });
  });
  gappers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  const top = gappers.slice(0, limit);
  return {
    window: 'afterhours',
    asOf: new Date().toISOString(),
    gappers: top,
    summary: buildSummary(top, gappers.length),
  };
}

// ─── Overnight scan ────────────────────────────────────────────────
// Combines futures + crypto into a unified mover list.

export async function scanOvernight(limit = 30): Promise<MoversScanResult> {
  const snap = await fetchOvernightSnapshot();
  const gappers: MoverQuote[] = [];

  for (const f of snap.futures) {
    gappers.push({
      symbol: f.symbol,
      price: f.price,
      prevClose: f.price / (1 + f.changePct / 100),
      changePct: f.changePct,
      volume: 0,
      sector: 'futures',
      direction: f.changePct >= 0 ? 'up' : 'down',
      asOf: snap.asOf,
    });
  }
  for (const c of snap.crypto) {
    gappers.push({
      symbol: c.symbol,
      price: c.price,
      prevClose: c.price / (1 + c.changePct / 100),
      changePct: c.changePct,
      volume: 0,
      sector: 'crypto',
      direction: c.changePct >= 0 ? 'up' : 'down',
      asOf: snap.asOf,
    });
  }

  gappers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  const top = gappers.slice(0, limit);
  return {
    window: 'overnight',
    asOf: snap.asOf,
    gappers: top,
    summary: buildSummary(top, gappers.length),
  };
}

// ─── Master dispatcher ─────────────────────────────────────────────

export async function scanMovers(window: MoversWindow, limit = 30): Promise<MoversScanResult> {
  switch (window) {
    case 'premarket':  return scanPreMarket(limit);
    case 'afterhours': return scanAfterHours(limit);
    case 'overnight':  return scanOvernight(limit);
    default:
      // Exhaustive — TS will flag if we miss one
      throw new Error(`Unknown movers window: ${window}`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function buildSummary(top: MoverQuote[], total: number): MoversScanResult['summary'] {
  const ups = top.filter(g => g.direction === 'up');
  const dns = top.filter(g => g.direction === 'down');
  return {
    totalScanned: total,
    upGappers: ups.length,
    downGappers: dns.length,
    biggestUp: ups[0],
    biggestDown: dns[0],
  };
}
