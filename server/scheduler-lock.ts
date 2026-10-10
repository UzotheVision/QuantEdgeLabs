/**
 * SCHEDULER LEADER LOCK
 * =====================
 * Only one process may run the background schedulers.
 *
 * WHY
 * server/index.ts starts eight scheduled jobs — scanners, the trigger observer,
 * the lifecycle reconciler, the FRED refresh — with no guard against a second
 * process doing the same. That is invisible on one laptop and breaks the moment
 * the app is hosted:
 *
 *   - Any platform that runs two instances (a rolling deploy, a second dyno,
 *     an autoscaler) runs every scanner twice against ONE shared database.
 *   - During a rolling deploy the old and new instance overlap, so even a
 *     single-instance service double-publishes for the length of the overlap.
 *   - `tsx watch` in development restarts on every file save, and an orphaned
 *     process keeps its crons — which is how three servers ended up scanning
 *     the same database earlier in this project's history.
 *
 * Duplicate scanners do not merely waste API quota. They publish the same setup
 * from the same source at nearly the same instant, which is exactly the race the
 * ingestion dedup cannot catch: both processes check for an existing row, both
 * see none, both insert.
 *
 * HOW
 * A Postgres session-level advisory lock. It is held by one connection for the
 * life of the process and released automatically if that process dies — no
 * heartbeat table, no stale-lock cleanup, no clock assumptions. A follower
 * simply serves HTTP and never schedules.
 *
 * The lock connection is held OUTSIDE the shared pool. Taking it from the pool
 * would permanently retire one client, and the pool is already sized against a
 * provider cap (see server/db.ts).
 */
import pg from 'pg';
import { logger } from './logger';

/** Arbitrary but fixed. Any other app on this database must not reuse it. */
const LOCK_KEY = 8_531_2026;

let holder: pg.Client | null = null;
let isLeader = false;

/**
 * Try to become the scheduler leader.
 *
 * Returns true if this process should run background jobs. Returns true and
 * logs a warning if the lock cannot be attempted at all (no database, driver
 * error) — a single-instance deployment must not silently lose its schedulers
 * because the lock itself failed.
 */
export async function acquireSchedulerLock(): Promise<boolean> {
  if (process.env.DISABLE_SCHEDULERS === 'true') {
    logger.info('[SCHEDULER-LOCK] DISABLE_SCHEDULERS=true — this process will not run background jobs');
    return false;
  }
  // An explicit opt-out of locking, for a deployment that guarantees one
  // instance and does not want an extra connection open.
  if (process.env.SCHEDULER_LOCK === 'off') {
    logger.warn('[SCHEDULER-LOCK] disabled by SCHEDULER_LOCK=off — duplicate schedulers are NOT prevented');
    return true;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.warn('[SCHEDULER-LOCK] no DATABASE_URL — running schedulers unguarded');
    return true;
  }

  try {
    const client = new pg.Client({
      connectionString,
      ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
    });
    await client.connect();

    const res = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    const ok = res.rows?.[0]?.ok === true;

    if (!ok) {
      await client.end().catch(() => {});
      logger.warn(
        '[SCHEDULER-LOCK] another process holds the scheduler lock — this instance serves HTTP only. ' +
        'If no other instance should be running, an orphaned process is still alive.',
      );
      isLeader = false;
      return false;
    }

    holder = client;
    isLeader = true;

    // If the lock connection drops, the lock is gone with it. Say so loudly
    // rather than continuing to behave as leader on a lock we no longer hold.
    client.on('error', (err) => {
      logger.error(`[SCHEDULER-LOCK] lock connection lost: ${err?.message ?? err}. Schedulers are now unguarded.`);
      isLeader = false;
    });

    logger.info('[SCHEDULER-LOCK] acquired — this instance runs the background schedulers');
    return true;
  } catch (err: any) {
    logger.warn(`[SCHEDULER-LOCK] could not acquire (${err?.message ?? err}) — running schedulers unguarded`);
    return true;
  }
}

export function isSchedulerLeader(): boolean {
  return isLeader;
}

/** Release on graceful shutdown. Postgres releases it anyway if we die. */
export async function releaseSchedulerLock(): Promise<void> {
  if (!holder) return;
  try {
    await holder.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    await holder.end();
  } catch { /* process is going away regardless */ }
  holder = null;
  isLeader = false;
}
