/**
 * THESIS RADAR — Track Record
 * =============================
 * Every fired Radar pick gets logged here with spot, grade, targets, invalidation.
 * A daily roll-up cron checks each open pick and marks it: hit_t1 / hit_t2 /
 * invalidated / expired. Closed picks roll into per-pattern hit-rate aggregates.
 *
 * Mirrors the CRCL screenshot format:
 *   CRCL 2026-04-30
 *   Result: PICKED UP
 *   Status: ACTIONABLE
 *   Grade: A+
 *   Score: 96/100
 *   Setup: EARLY_MOMENTUM_IGNITION
 *   Spot: 90.83
 *   Invalidation: 89.10
 *   Short-term GEX target: 93
 *   Swing VEX targets: 120, 125, 130, 150
 *   VEX directional ratio: 99.0x
 *
 * The track record is the calibration loop:
 *   - Patterns that hit at >= targetHitRate stay live
 *   - Patterns that under-perform get flagged for re-spec
 *   - Per-pattern stats feed the conviction-agent's weights
 *
 * This is where QuantEdge differs from random screener tools — every call is
 * accountable. The Radar UI shows the full track record, not just winners.
 *
 * Storage:
 *   - In-memory ring buffer for hot picks (last 500)
 *   - Persistent: trade-radar-picks table (added in a follow-up migration)
 *   - For v1 we use a JSON file at data/radar-track.json so the feature ships
 *     without blocking on a schema migration
 */

import { logger } from '../logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { PatternId, RadarPick, TrackRecordEntry } from '@shared/thesis-radar-types';

const STORE_PATH = path.join(process.cwd(), 'data', 'radar-track.json');
const RING_BUFFER_SIZE = 500;

interface TrackStore {
  entries: TrackRecordEntry[];
  /** Most recent picks for fast UI access */
  recentPicks: RadarPick[];
}

// ─── Load / save (file-backed) ──────────────────────────────────────

let _cachedStore: TrackStore | null = null;

async function loadStore(): Promise<TrackStore> {
  if (_cachedStore) return _cachedStore;
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    _cachedStore = JSON.parse(raw) as TrackStore;
  } catch {
    _cachedStore = { entries: [], recentPicks: [] };
  }
  return _cachedStore;
}

async function saveStore(store: TrackStore): Promise<void> {
  _cachedStore = store;
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

// ─── Record a fired pick ────────────────────────────────────────────

export async function recordPick(pick: RadarPick): Promise<void> {
  const store = await loadStore();

  // Append to recent picks ring buffer
  store.recentPicks.unshift(pick);
  if (store.recentPicks.length > RING_BUFFER_SIZE) {
    store.recentPicks.length = RING_BUFFER_SIZE;
  }

  // Add tracking entry (resolved later by daily cron)
  const entry: TrackRecordEntry = {
    pickId: pick.id,
    patternId: pick.patternId,
    symbol: pick.symbol,
    firedAt: pick.firedAt,
    spotAtFire: pick.spotAtFire,
    finalGrade: pick.finalGrade,
  };
  store.entries.unshift(entry);

  await saveStore(store);
  logger.info(`[TRACK] Recorded pick ${pick.symbol} ${pick.finalGrade} (${pick.id})`);
}

// ─── Resolve open picks (run by daily cron) ────────────────────────

export interface ResolveContext {
  /** Caller provides current spot + targets so this module stays decoupled from data fetchers */
  getCurrentSpot: (symbol: string) => Promise<number | null>;
  /** Optional override for "expired" threshold in days */
  expireAfterDays?: number;
}

export async function resolveOpenPicks(ctx: ResolveContext): Promise<{
  resolved: number;
  hits: number;
  invalidations: number;
  expirations: number;
}> {
  const store = await loadStore();
  const expireAfterDays = ctx.expireAfterDays ?? 60;
  const nowMs = Date.now();

  let resolved = 0;
  let hits = 0;
  let invalidations = 0;
  let expirations = 0;

  for (const entry of store.entries) {
    if (entry.resolvedAt) continue; // already closed

    const pick = store.recentPicks.find(p => p.id === entry.pickId);
    if (!pick) continue; // pick rolled out of buffer; can't resolve without targets

    const currentSpot = await ctx.getCurrentSpot(entry.symbol);
    if (currentSpot == null) continue;

    const ageDays = (nowMs - new Date(entry.firedAt).getTime()) / 86400000;
    let resolvedThisPass = false;

    // Hit T2?
    if (pick.targets?.t2 != null && currentSpot >= pick.targets.t2) {
      entry.hitT1 = true;
      entry.hitT2 = true;
      entry.resolvedAt = new Date().toISOString();
      entry.outcomePrice = currentSpot;
      entry.outcomePct = ((currentSpot - entry.spotAtFire) / entry.spotAtFire) * 100;
      entry.daysToResolve = ageDays;
      hits++;
      resolvedThisPass = true;
    }
    // Hit T1?
    else if (pick.targets?.t1 != null && currentSpot >= pick.targets.t1) {
      entry.hitT1 = true;
      entry.resolvedAt = new Date().toISOString();
      entry.outcomePrice = currentSpot;
      entry.outcomePct = ((currentSpot - entry.spotAtFire) / entry.spotAtFire) * 100;
      entry.daysToResolve = ageDays;
      hits++;
      resolvedThisPass = true;
    }
    // Invalidated?
    else if (pick.invalidation != null && currentSpot <= pick.invalidation) {
      entry.invalidated = true;
      entry.resolvedAt = new Date().toISOString();
      entry.outcomePrice = currentSpot;
      entry.outcomePct = ((currentSpot - entry.spotAtFire) / entry.spotAtFire) * 100;
      entry.daysToResolve = ageDays;
      invalidations++;
      resolvedThisPass = true;
    }
    // Expired?
    else if (ageDays >= expireAfterDays) {
      entry.resolvedAt = new Date().toISOString();
      entry.outcomePrice = currentSpot;
      entry.outcomePct = ((currentSpot - entry.spotAtFire) / entry.spotAtFire) * 100;
      entry.daysToResolve = ageDays;
      expirations++;
      resolvedThisPass = true;
    }

    if (resolvedThisPass) resolved++;
  }

  await saveStore(store);
  logger.info(
    `[TRACK] Resolve pass: ${resolved} resolved (${hits} hit, ${invalidations} stopped, ${expirations} expired)`,
  );
  return { resolved, hits, invalidations, expirations };
}

// ─── Read APIs (for the Radar UI) ──────────────────────────────────

export async function getRecentPicks(limit = 50): Promise<RadarPick[]> {
  const store = await loadStore();
  return store.recentPicks.slice(0, limit);
}

export async function getTrackRecord(filter?: {
  patternId?: PatternId;
  resolvedOnly?: boolean;
  limit?: number;
}): Promise<TrackRecordEntry[]> {
  const store = await loadStore();
  let entries = store.entries;
  if (filter?.patternId) entries = entries.filter(e => e.patternId === filter.patternId);
  if (filter?.resolvedOnly) entries = entries.filter(e => !!e.resolvedAt);
  return entries.slice(0, filter?.limit ?? 200);
}

// ─── Per-pattern aggregate stats ───────────────────────────────────

export interface PatternStats {
  patternId: PatternId;
  totalPicks: number;
  resolved: number;
  hits: number;
  hitRate: number;
  avgOutcomePct: number;
  avgDaysToResolve: number;
}

export async function getPatternStats(patternId?: PatternId): Promise<PatternStats[]> {
  const store = await loadStore();

  const byPattern: Record<string, TrackRecordEntry[]> = {};
  for (const e of store.entries) {
    if (patternId && e.patternId !== patternId) continue;
    const list = byPattern[e.patternId] ?? [];
    list.push(e);
    byPattern[e.patternId] = list;
  }

  const stats: PatternStats[] = [];
  for (const pid of Object.keys(byPattern)) {
    const entries: TrackRecordEntry[] = byPattern[pid];
    const resolved = entries.filter((e: TrackRecordEntry) => !!e.resolvedAt);
    const hits = resolved.filter((e: TrackRecordEntry) => e.hitT1 || e.hitT2);
    const avgPct = resolved.length
      ? resolved.reduce((a: number, e: TrackRecordEntry) => a + (e.outcomePct ?? 0), 0) / resolved.length
      : 0;
    const avgDays = resolved.length
      ? resolved.reduce((a: number, e: TrackRecordEntry) => a + (e.daysToResolve ?? 0), 0) / resolved.length
      : 0;

    stats.push({
      patternId: pid as PatternId,
      totalPicks: entries.length,
      resolved: resolved.length,
      hits: hits.length,
      hitRate: resolved.length ? hits.length / resolved.length : 0,
      avgOutcomePct: avgPct,
      avgDaysToResolve: avgDays,
    });
  }

  return stats.sort((a, b) => b.hitRate - a.hitRate);
}
