/**
 * THESIS RADAR — Live Scanner
 * =============================
 * The orchestrator. Runs all patterns in PATTERN_LIBRARY against the universe,
 * grades each match through the conviction agent, persists picks to the track
 * record, and pushes Discord alerts.
 *
 * Trigger schedule (handled by the cron caller, not this module):
 *   - 09:35 ET (5 min after open)        → quick scan, hot patterns only
 *   - 12:00 ET (lunch settle)            → full scan
 *   - 15:55 ET (5 min before close)      → full scan + EOD summary
 *   - 20:00 ET (post-market settled)     → resolve open picks
 *
 * Each scan run is idempotent within its window — duplicate matches on the
 * same ticker × pattern within a 4h window are deduped (no spam alerts).
 *
 * Hooks for the rest of the platform:
 *   - A+ grades auto-create Trade Desk ideas via universal-idea-generator
 *   - Forming alerts fire to Discord (await CONFIRMED to push idea)
 *   - Confirmed alerts fire to Discord + Trade Desk
 *   - Every pick is recorded for track-record / calibration
 */

import { logger } from '../logger';
import { listPatterns, patternsForOutput } from './pattern-library';
import { scanPattern } from './subset-engine';
import { gradeConviction } from './conviction-agent';
import { recordPick, resolveOpenPicks } from './track-record';
import { pushAlert, alertFromPick } from './discord-webhook';
import type { PatternSpec, RadarPick } from '@shared/thesis-radar-types';

// ─── Dedup window ───────────────────────────────────────────────────

const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours
const _firedRecently = new Map<string, number>(); // key: `${pattern}:${symbol}` → ts

function recentlyFired(patternId: string, symbol: string): boolean {
  const key = `${patternId}:${symbol}`;
  const last = _firedRecently.get(key);
  if (last == null) return false;
  return Date.now() - last < DEDUP_WINDOW_MS;
}

function markFired(patternId: string, symbol: string): void {
  _firedRecently.set(`${patternId}:${symbol}`, Date.now());
}

// ─── Run a single pattern ──────────────────────────────────────────

export interface ScanRunSummary {
  patternId: string;
  candidatesEvaluated: number;
  matches: number;
  graded: number;
  alerted: number;
  duplicatesSkipped: number;
}

export async function runPattern(pattern: PatternSpec): Promise<{
  summary: ScanRunSummary;
  picks: RadarPick[];
}> {
  const summary: ScanRunSummary = {
    patternId: pattern.id,
    candidatesEvaluated: 0,
    matches: 0,
    graded: 0,
    alerted: 0,
    duplicatesSkipped: 0,
  };

  logger.info(`[RADAR] Running pattern ${pattern.id}…`);

  let scanMatches: Awaited<ReturnType<typeof scanPattern>> = [];
  try {
    scanMatches = await scanPattern(pattern);
  } catch (e) {
    logger.warn(`[RADAR] scanPattern threw on ${pattern.id}: ${(e as Error).message}`);
    return { summary, picks: [] };
  }
  summary.candidatesEvaluated = scanMatches.length;
  summary.matches = scanMatches.length;

  const picks: RadarPick[] = [];

  for (const match of scanMatches) {
    if (recentlyFired(pattern.id, match.ticker.symbol)) {
      summary.duplicatesSkipped++;
      continue;
    }

    try {
      const { pick } = await gradeConviction(
        match.ticker.symbol,
        match.ticker.spot,
        pattern,
        match.data,
      );
      summary.graded++;

      // Only alert/record if grade clears the bar (>=B-)
      // Patterns can override this in a future v1.1 spec
      if (pick.finalScore < 70) {
        logger.info(
          `[RADAR] ${pick.symbol} matched ${pattern.id} but graded ${pick.finalGrade} (${pick.finalScore}) — below alert threshold`,
        );
        continue;
      }

      await recordPick(pick);
      picks.push(pick);
      markFired(pattern.id, pick.symbol);

      // Push alert
      const alertType =
        pattern.output === 'forming'
          ? 'forming'
          : pattern.output === 'confirmed'
          ? 'confirmed'
          : 'forming'; // 'preview' patterns also fire as 'forming' alerts

      const alert = alertFromPick(pick, alertType);
      const pushResult = await pushAlert(alert);
      if (pushResult.ok) summary.alerted++;
    } catch (e) {
      logger.warn(
        `[RADAR] Grading failed for ${match.ticker.symbol} × ${pattern.id}: ${(e as Error).message}`,
      );
    }
  }

  logger.info(
    `[RADAR] ${pattern.id} done — ${summary.matches} matches, ${summary.graded} graded, ${summary.alerted} alerted, ${summary.duplicatesSkipped} dedup`,
  );

  return { summary, picks };
}

// ─── Run all patterns (full scan) ──────────────────────────────────

export async function runFullScan(): Promise<{
  summaries: ScanRunSummary[];
  picks: RadarPick[];
}> {
  const patterns = listPatterns();
  const summaries: ScanRunSummary[] = [];
  const allPicks: RadarPick[] = [];

  for (const p of patterns) {
    const { summary, picks } = await runPattern(p);
    summaries.push(summary);
    allPicks.push(...picks);
  }

  logger.info(
    `[RADAR] Full scan complete — ${patterns.length} patterns, ${allPicks.length} total picks`,
  );

  return { summaries, picks: allPicks };
}

// ─── Run only "forming" patterns (intraday, lighter) ───────────────

export async function runFormingScan(): Promise<{
  summaries: ScanRunSummary[];
  picks: RadarPick[];
}> {
  const patterns = patternsForOutput('forming');
  const summaries: ScanRunSummary[] = [];
  const allPicks: RadarPick[] = [];

  for (const p of patterns) {
    const { summary, picks } = await runPattern(p);
    summaries.push(summary);
    allPicks.push(...picks);
  }

  return { summaries, picks: allPicks };
}

// ─── Resolve open picks (post-market cron) ─────────────────────────

export async function runResolvePass(getCurrentSpot: (sym: string) => Promise<number | null>): Promise<void> {
  await resolveOpenPicks({ getCurrentSpot });
}
