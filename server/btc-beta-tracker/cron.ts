/**
 * BTC TRACKER — Cron Scheduler
 * ==============================
 * Runs the BTC beta scan + auto-pushes A-tier signals to Trade Desk.
 *
 * Schedule (NY time, every weekday since BTC trades 24/7 but US options don't):
 *   09:35  — first scan after market open
 *   11:00  — mid-morning re-check
 *   13:00  — lunch settle
 *   15:00  — pre-close scan
 *   15:55  — last call (close approaching)
 *
 * Each run: fetch BTC state → compute betas → detect patterns → push A+ to desk.
 * Failures logged but never crash the cron.
 */

import cron from 'node-cron';
import { logger } from '../logger';
import { scanAllPatterns } from './signal-engine';
import { pushAllBTCSignals } from './trade-idea-generator';

let _scheduled = false;

export function scheduleBTCTrackerCrons(): void {
  if (_scheduled) {
    logger.warn('[BTC-CRON] Already scheduled — skipping duplicate registration');
    return;
  }
  _scheduled = true;

  const runScan = async (label: string) => {
    logger.info(`[BTC-CRON] ${label} starting`);
    try {
      const scan = await scanAllPatterns();
      if (scan.signals.length === 0) {
        logger.info(`[BTC-CRON] ${label} done — no signals fired`);
        return;
      }
      const push = await pushAllBTCSignals(scan.signals);
      logger.info(
        `[BTC-CRON] ${label} done — ${scan.signals.length} signals, ${push.pushed.length} pushed to desk`,
      );
    } catch (e) {
      logger.warn(`[BTC-CRON] ${label} threw: ${(e as Error).message}`);
    }
  };

  // Five intraday scans during market hours (NY tz)
  cron.schedule('35 9 * * 1-5', () => runScan('09:35 open scan'), { timezone: 'America/New_York' });
  cron.schedule('0 11 * * 1-5', () => runScan('11:00 morning recheck'), { timezone: 'America/New_York' });
  cron.schedule('0 13 * * 1-5', () => runScan('13:00 lunch settle'), { timezone: 'America/New_York' });
  cron.schedule('0 15 * * 1-5', () => runScan('15:00 pre-close'), { timezone: 'America/New_York' });
  cron.schedule('55 15 * * 1-5', () => runScan('15:55 last call'), { timezone: 'America/New_York' });

  logger.info(
    '[BTC-CRON] ✅ Scheduled 5 intraday scans: 09:35, 11:00, 13:00, 15:00, 15:55 (NY tz)',
  );
}
