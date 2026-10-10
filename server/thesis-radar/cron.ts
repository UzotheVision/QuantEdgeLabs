/**
 * THESIS RADAR — Cron Scheduler
 * ===============================
 * Wires the Radar pipeline to the scheduler. Single export `scheduleRadarCrons()`
 * which is called once from server/index.ts during startup.
 *
 * Schedule (all NY time, weekdays only):
 *   09:35 — light "forming" scan (5 min after open, intraday-cheap patterns)
 *   12:00 — full scan (lunch settle, all 5 patterns)
 *   15:55 — full scan + EOD prep (5 min before close)
 *   20:00 — resolve pass (mark hits/invalidations from today's close)
 *
 * Resolve pass uses Tradier last-close as the spot for each open pick.
 * If Tradier fails, the pick stays open until the next pass succeeds — we never
 * incorrectly mark a pick as hit/invalidated based on a missing quote.
 *
 * The cron is fire-and-forget — failures are logged but don't take down the
 * server. Each scan run is wrapped in try/catch.
 */

import cron from 'node-cron';
import { logger } from '../logger';
import { runFullScan, runFormingScan, runResolvePass } from './live-scanner';
import { getTradierQuote } from '../tradier-api';

let _scheduled = false;

export function scheduleRadarCrons(): void {
  if (_scheduled) {
    logger.warn('[RADAR-CRON] Already scheduled — skipping duplicate registration');
    return;
  }
  _scheduled = true;

  // 09:35 ET — forming scan (light, intraday)
  cron.schedule(
    '35 9 * * 1-5',
    async () => {
      logger.info('[RADAR-CRON] 09:35 forming scan starting');
      try {
        const result = await runFormingScan();
        logger.info(
          `[RADAR-CRON] 09:35 done — ${result.picks.length} picks across ${result.summaries.length} forming patterns`,
        );
      } catch (e) {
        logger.warn(`[RADAR-CRON] 09:35 scan threw: ${(e as Error).message}`);
      }
    },
    { timezone: 'America/New_York' },
  );

  // 12:00 ET — full scan (lunch settle)
  cron.schedule(
    '0 12 * * 1-5',
    async () => {
      logger.info('[RADAR-CRON] 12:00 full scan starting');
      try {
        const result = await runFullScan();
        logger.info(
          `[RADAR-CRON] 12:00 done — ${result.picks.length} picks across ${result.summaries.length} patterns`,
        );
      } catch (e) {
        logger.warn(`[RADAR-CRON] 12:00 scan threw: ${(e as Error).message}`);
      }
    },
    { timezone: 'America/New_York' },
  );

  // 15:55 ET — full scan (5 min before close)
  cron.schedule(
    '55 15 * * 1-5',
    async () => {
      logger.info('[RADAR-CRON] 15:55 full scan starting');
      try {
        const result = await runFullScan();
        logger.info(
          `[RADAR-CRON] 15:55 done — ${result.picks.length} picks across ${result.summaries.length} patterns`,
        );
      } catch (e) {
        logger.warn(`[RADAR-CRON] 15:55 scan threw: ${(e as Error).message}`);
      }
    },
    { timezone: 'America/New_York' },
  );

  // 20:00 ET — resolve pass (post-market settled)
  cron.schedule(
    '0 20 * * 1-5',
    async () => {
      logger.info('[RADAR-CRON] 20:00 resolve pass starting');
      try {
        await runResolvePass(async (sym: string) => {
          try {
            const q = await getTradierQuote(sym);
            return q?.last ?? null;
          } catch {
            return null;
          }
        });
        logger.info('[RADAR-CRON] 20:00 resolve pass done');
      } catch (e) {
        logger.warn(`[RADAR-CRON] 20:00 resolve threw: ${(e as Error).message}`);
      }
    },
    { timezone: 'America/New_York' },
  );

  logger.info('[RADAR-CRON] ✅ Scheduled 4 jobs: 09:35 forming, 12:00 full, 15:55 full, 20:00 resolve (NY tz)');
}
