/**
 * GEX/VEX Projection Validator
 * =============================
 * Tracks projection accuracy over time by:
 *   1. Recording every GEX/VEX projection with metadata
 *   2. Validating outcomes after 1, 3, and 5 trading days
 *   3. Computing hit-rate metrics by target type, regime, and VIX level
 *
 * Storage: append-only JSON log at data/projection-history.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { safeQuote, getBestPrice } from './yahoo-finance-service';
import type { ProjectorResult, GammaRegime } from './gex-vex-projector';

// ─── Types ───────────────────────────────────────────────────

export interface ProjectionEntry {
  id: string;
  timestamp: string;
  symbol: string;
  spotPrice: number;
  vixLevel: number;
  regime: GammaRegime['type'];
  confidence: number;
  targets: {
    primaryUpside: number | null;
    primaryDownside: number | null;
    compositeTarget: number | null;
  };
  outcomes: {
    day1?: OutcomeCheck;
    day3?: OutcomeCheck;
    day5?: OutcomeCheck;
  };
  validated: boolean;
}

export interface OutcomeCheck {
  checkedAt: string;
  actualPrice: number;
  upsideHit: boolean;
  downsideHit: boolean;
  compositeHit: boolean;
  upsideDistancePct: number | null;
  downsideDistancePct: number | null;
  compositeDistancePct: number | null;
}

export interface AccuracyReport {
  totalProjections: number;
  validatedProjections: number;
  hitRateByTarget: {
    upside: { hits: number; total: number; rate: number };
    downside: { hits: number; total: number; rate: number };
    composite: { hits: number; total: number; rate: number };
  };
  hitRateByRegime: {
    POSITIVE: { hits: number; total: number; rate: number };
    NEGATIVE: { hits: number; total: number; rate: number };
    NEUTRAL: { hits: number; total: number; rate: number };
  };
  hitRateByVix: {
    low: { hits: number; total: number; rate: number };   // VIX < 15
    mid: { hits: number; total: number; rate: number };   // 15-25
    high: { hits: number; total: number; rate: number };  // > 25
  };
  avgMissDistance: {
    upside: number;
    downside: number;
    composite: number;
  };
  rolling30Day: {
    hits: number;
    total: number;
    rate: number;
  };
  symbol?: string;
}

// ─── Constants ───────────────────────────────────────────────

import { fileURLToPath } from 'url';
const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const DATA_DIR = path.resolve(__dirname_esm, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'projection-history.json');
const HIT_THRESHOLD_PCT = 0.5; // within 0.5% of target counts as hit
const TRADING_DAY_MS = 24 * 60 * 60 * 1000; // calendar day approx

// ─── Storage Helpers ─────────────────────────────────────────

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    logger.info('[PROJ-VALIDATOR] Created data/ directory');
  }
}

function loadHistory(): ProjectionEntry[] {
  ensureDataDir();
  if (!fs.existsSync(HISTORY_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(raw) as ProjectionEntry[];
  } catch (err: any) {
    logger.error(`[PROJ-VALIDATOR] Failed to read history: ${err.message}`);
    return [];
  }
}

function saveHistory(entries: ProjectionEntry[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (err: any) {
    logger.error(`[PROJ-VALIDATOR] Failed to write history: ${err.message}`);
  }
}

function generateId(symbol: string): string {
  return `${symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Core API ────────────────────────────────────────────────

/**
 * Record a new GEX/VEX projection for later validation.
 */
export function recordProjection(
  symbol: string,
  projection: ProjectorResult,
  spotPrice: number,
  vixLevel: number,
): ProjectionEntry {
  const entry: ProjectionEntry = {
    id: generateId(symbol),
    timestamp: new Date().toISOString(),
    symbol: symbol.toUpperCase(),
    spotPrice,
    vixLevel,
    regime: projection.regime.type,
    confidence: projection.confidence,
    targets: {
      primaryUpside: projection.targets.primaryUpside?.price ?? null,
      primaryDownside: projection.targets.primaryDownside?.price ?? null,
      compositeTarget: computeCompositeTarget(projection),
    },
    outcomes: {},
    validated: false,
  };

  const history = loadHistory();
  history.push(entry);
  saveHistory(history);

  logger.info(
    `[PROJ-VALIDATOR] Recorded projection for ${symbol}: ` +
    `up=${entry.targets.primaryUpside}, down=${entry.targets.primaryDownside}, ` +
    `composite=${entry.targets.compositeTarget}, regime=${entry.regime}, VIX=${vixLevel}`,
  );

  return entry;
}

/**
 * Validate past projections against actual prices from Yahoo Finance.
 * Checks entries that are 1, 3, or 5 trading days old and have not yet been validated for that window.
 */
export async function validateProjections(): Promise<{
  checked: number;
  updated: number;
  fullyValidated: number;
}> {
  const history = loadHistory();
  const now = Date.now();
  let checked = 0;
  let updated = 0;
  let fullyValidated = 0;

  // Group entries by symbol so we batch-fetch quotes
  const symbolsToCheck = new Set<string>();

  for (const entry of history) {
    if (entry.validated) continue;
    const ageMs = now - new Date(entry.timestamp).getTime();
    const ageDays = ageMs / TRADING_DAY_MS;

    // Determine which windows need checking
    if (
      (ageDays >= 1 && !entry.outcomes.day1) ||
      (ageDays >= 3 && !entry.outcomes.day3) ||
      (ageDays >= 5 && !entry.outcomes.day5)
    ) {
      symbolsToCheck.add(entry.symbol);
    }
  }

  if (symbolsToCheck.size === 0) {
    logger.debug('[PROJ-VALIDATOR] No projections need validation right now');
    return { checked: 0, updated: 0, fullyValidated: 0 };
  }

  // Fetch current prices for all symbols that need checking
  const priceMap: Record<string, number> = {};
  for (const sym of symbolsToCheck) {
    try {
      const quote = await safeQuote(sym);
      if (quote) {
        const price = getBestPrice(quote);
        if (price > 0) priceMap[sym] = price;
      }
    } catch (err: any) {
      logger.debug(`[PROJ-VALIDATOR] Could not fetch price for ${sym}: ${err.message}`);
    }
  }

  // Walk entries and fill in outcomes
  for (const entry of history) {
    if (entry.validated) continue;

    const currentPrice = priceMap[entry.symbol];
    if (!currentPrice) continue;

    const ageMs = now - new Date(entry.timestamp).getTime();
    const ageDays = ageMs / TRADING_DAY_MS;
    let didUpdate = false;

    if (ageDays >= 1 && !entry.outcomes.day1) {
      entry.outcomes.day1 = checkOutcome(entry, currentPrice);
      didUpdate = true;
    }
    if (ageDays >= 3 && !entry.outcomes.day3) {
      entry.outcomes.day3 = checkOutcome(entry, currentPrice);
      didUpdate = true;
    }
    if (ageDays >= 5 && !entry.outcomes.day5) {
      entry.outcomes.day5 = checkOutcome(entry, currentPrice);
      didUpdate = true;
    }

    if (didUpdate) {
      checked++;
      updated++;
    }

    // Mark fully validated when all three windows are filled
    if (entry.outcomes.day1 && entry.outcomes.day3 && entry.outcomes.day5) {
      entry.validated = true;
      fullyValidated++;
    }
  }

  if (updated > 0) {
    saveHistory(history);
    logger.info(
      `[PROJ-VALIDATOR] Validated ${updated} projection(s), ${fullyValidated} fully complete`,
    );
  }

  return { checked, updated, fullyValidated };
}

/**
 * Get an accuracy report, optionally filtered by symbol.
 */
export function getAccuracyReport(symbol?: string): AccuracyReport {
  const history = loadHistory();
  const entries = symbol
    ? history.filter((e) => e.symbol === symbol.toUpperCase())
    : history;

  const report: AccuracyReport = {
    totalProjections: entries.length,
    validatedProjections: 0,
    hitRateByTarget: {
      upside: { hits: 0, total: 0, rate: 0 },
      downside: { hits: 0, total: 0, rate: 0 },
      composite: { hits: 0, total: 0, rate: 0 },
    },
    hitRateByRegime: {
      POSITIVE: { hits: 0, total: 0, rate: 0 },
      NEGATIVE: { hits: 0, total: 0, rate: 0 },
      NEUTRAL: { hits: 0, total: 0, rate: 0 },
    },
    hitRateByVix: {
      low: { hits: 0, total: 0, rate: 0 },
      mid: { hits: 0, total: 0, rate: 0 },
      high: { hits: 0, total: 0, rate: 0 },
    },
    avgMissDistance: { upside: 0, downside: 0, composite: 0 },
    rolling30Day: { hits: 0, total: 0, rate: 0 },
    ...(symbol ? { symbol: symbol.toUpperCase() } : {}),
  };

  const missDistances = { upside: [] as number[], downside: [] as number[], composite: [] as number[] };
  const thirtyDaysAgo = Date.now() - 30 * TRADING_DAY_MS;

  for (const entry of entries) {
    // Use the best available outcome (longest window that exists)
    const outcome = entry.outcomes.day5 ?? entry.outcomes.day3 ?? entry.outcomes.day1;
    if (!outcome) continue;

    report.validatedProjections++;

    // Any hit across any window counts
    const anyUpsideHit = hitInAnyWindow(entry, 'upsideHit');
    const anyDownsideHit = hitInAnyWindow(entry, 'downsideHit');
    const anyCompositeHit = hitInAnyWindow(entry, 'compositeHit');
    const anyHit = anyUpsideHit || anyDownsideHit || anyCompositeHit;

    // -- By target type --
    if (entry.targets.primaryUpside !== null) {
      report.hitRateByTarget.upside.total++;
      if (anyUpsideHit) report.hitRateByTarget.upside.hits++;
      else if (outcome.upsideDistancePct !== null) missDistances.upside.push(outcome.upsideDistancePct);
    }
    if (entry.targets.primaryDownside !== null) {
      report.hitRateByTarget.downside.total++;
      if (anyDownsideHit) report.hitRateByTarget.downside.hits++;
      else if (outcome.downsideDistancePct !== null) missDistances.downside.push(outcome.downsideDistancePct);
    }
    if (entry.targets.compositeTarget !== null) {
      report.hitRateByTarget.composite.total++;
      if (anyCompositeHit) report.hitRateByTarget.composite.hits++;
      else if (outcome.compositeDistancePct !== null) missDistances.composite.push(outcome.compositeDistancePct);
    }

    // -- By regime --
    const regimeBucket = report.hitRateByRegime[entry.regime];
    if (regimeBucket) {
      regimeBucket.total++;
      if (anyHit) regimeBucket.hits++;
    }

    // -- By VIX level --
    const vixBucket = entry.vixLevel < 15 ? 'low' : entry.vixLevel <= 25 ? 'mid' : 'high';
    report.hitRateByVix[vixBucket].total++;
    if (anyHit) report.hitRateByVix[vixBucket].hits++;

    // -- Rolling 30-day --
    if (new Date(entry.timestamp).getTime() >= thirtyDaysAgo) {
      report.rolling30Day.total++;
      if (anyHit) report.rolling30Day.hits++;
    }
  }

  // Compute rates
  const calcRate = (b: { hits: number; total: number; rate: number }) => {
    b.rate = b.total > 0 ? Math.round((b.hits / b.total) * 10000) / 100 : 0;
  };

  calcRate(report.hitRateByTarget.upside);
  calcRate(report.hitRateByTarget.downside);
  calcRate(report.hitRateByTarget.composite);
  calcRate(report.hitRateByRegime.POSITIVE);
  calcRate(report.hitRateByRegime.NEGATIVE);
  calcRate(report.hitRateByRegime.NEUTRAL);
  calcRate(report.hitRateByVix.low);
  calcRate(report.hitRateByVix.mid);
  calcRate(report.hitRateByVix.high);
  calcRate(report.rolling30Day);

  // Average miss distances
  const avg = (arr: number[]) => arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : 0;
  report.avgMissDistance.upside = avg(missDistances.upside);
  report.avgMissDistance.downside = avg(missDistances.downside);
  report.avgMissDistance.composite = avg(missDistances.composite);

  return report;
}

/**
 * Get recent projection history for a symbol with outcomes.
 */
export function getProjectionHistory(
  symbol: string,
  days: number = 30,
): ProjectionEntry[] {
  const history = loadHistory();
  const cutoff = Date.now() - days * TRADING_DAY_MS;

  return history
    .filter(
      (e) =>
        e.symbol === symbol.toUpperCase() &&
        new Date(e.timestamp).getTime() >= cutoff,
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Auto-validation function intended to be called from the worker
 * on an hourly schedule during market hours.
 */
export async function runScheduledValidation(): Promise<void> {
  try {
    const now = new Date();
    const etHour = parseInt(
      now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }),
    );
    const dayOfWeek = new Date(
      now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
    ).getDay();

    // Only run Mon-Fri 9 AM - 5 PM ET
    if (dayOfWeek === 0 || dayOfWeek === 6) return;
    if (etHour < 9 || etHour > 17) return;

    logger.info('[PROJ-VALIDATOR] Running scheduled projection validation...');
    const result = await validateProjections();

    if (result.updated > 0) {
      const report = getAccuracyReport();
      logger.info(
        `[PROJ-VALIDATOR] Validation complete: ${result.updated} updated, ` +
        `${result.fullyValidated} fully validated. ` +
        `Rolling 30d accuracy: ${report.rolling30Day.rate}% ` +
        `(${report.rolling30Day.hits}/${report.rolling30Day.total})`,
      );
    }
  } catch (err: any) {
    logger.error(`[PROJ-VALIDATOR] Scheduled validation failed: ${err.message}`);
  }
}

// ─── Internal Helpers ────────────────────────────────────────

function computeCompositeTarget(projection: ProjectorResult): number | null {
  const up = projection.targets.primaryUpside?.price;
  const down = projection.targets.primaryDownside?.price;
  if (up && down) {
    // Weighted midpoint biased by regime
    const bias = projection.regime.type === 'POSITIVE' ? 0.6 : projection.regime.type === 'NEGATIVE' ? 0.4 : 0.5;
    return Math.round((up * bias + down * (1 - bias)) * 100) / 100;
  }
  return up ?? down ?? null;
}

function checkOutcome(entry: ProjectionEntry, actualPrice: number): OutcomeCheck {
  const { primaryUpside, primaryDownside, compositeTarget } = entry.targets;

  const upsideDistPct = primaryUpside !== null
    ? Math.abs((actualPrice - primaryUpside) / primaryUpside) * 100
    : null;
  const downsideDistPct = primaryDownside !== null
    ? Math.abs((actualPrice - primaryDownside) / primaryDownside) * 100
    : null;
  const compositeDistPct = compositeTarget !== null
    ? Math.abs((actualPrice - compositeTarget) / compositeTarget) * 100
    : null;

  return {
    checkedAt: new Date().toISOString(),
    actualPrice,
    upsideHit: upsideDistPct !== null && upsideDistPct <= HIT_THRESHOLD_PCT,
    downsideHit: downsideDistPct !== null && downsideDistPct <= HIT_THRESHOLD_PCT,
    compositeHit: compositeDistPct !== null && compositeDistPct <= HIT_THRESHOLD_PCT,
    upsideDistancePct: upsideDistPct !== null ? Math.round(upsideDistPct * 100) / 100 : null,
    downsideDistancePct: downsideDistPct !== null ? Math.round(downsideDistPct * 100) / 100 : null,
    compositeDistancePct: compositeDistPct !== null ? Math.round(compositeDistPct * 100) / 100 : null,
  };
}

function hitInAnyWindow(
  entry: ProjectionEntry,
  field: 'upsideHit' | 'downsideHit' | 'compositeHit',
): boolean {
  return (
    (entry.outcomes.day1?.[field] ?? false) ||
    (entry.outcomes.day3?.[field] ?? false) ||
    (entry.outcomes.day5?.[field] ?? false)
  );
}
