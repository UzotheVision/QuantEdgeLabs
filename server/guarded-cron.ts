/**
 * GUARDED CRON — node-cron, but only the scheduler leader actually schedules.
 *
 * Drop-in for `await import('node-cron')`: same `.default.schedule(expr, fn)`
 * shape, so call sites do not change beyond the import specifier.
 *
 * A follower process registers nothing and logs once per job, so the reason its
 * crons are silent is visible in its own logs rather than looking like a
 * scheduling bug. See server/scheduler-lock.ts for why this exists — briefly:
 * eight background jobs write to one shared database, and any second process
 * (a rolling deploy overlap, a second instance, an orphaned `tsx watch`) would
 * otherwise run every one of them a second time and double-publish signals.
 *
 * The leader flag is read at REGISTRATION time. Leadership is decided once at
 * boot before any scheduling happens, so this is the correct moment; a process
 * that loses its lock connection later logs loudly (see scheduler-lock) rather
 * than silently continuing.
 */
import { isSchedulerLeader } from './scheduler-lock';
import { logger } from './logger';

type Task = { start: () => void; stop: () => void };

const NOOP_TASK: Task = { start: () => {}, stop: () => {} };

async function realCron() {
  return (await import('node-cron')).default;
}

export const schedule = async (expression: string, fn: () => void | Promise<void>, opts?: any): Promise<Task> => {
  if (!isSchedulerLeader()) {
    logger.info(`[GUARDED-CRON] follower — not scheduling "${expression}"`);
    return NOOP_TASK;
  }
  const cron = await realCron();
  return cron.schedule(expression, fn as any, opts) as unknown as Task;
};

/**
 * Mirrors node-cron's default export closely enough for existing call sites.
 * `schedule` here is intentionally synchronous-looking: node-cron's own
 * schedule() returns a task, and callers do not await it. The real registration
 * is kicked off immediately; a follower returns the no-op task directly.
 */
const guarded = {
  schedule(expression: string, fn: () => void | Promise<void>, opts?: any): Task {
    if (!isSchedulerLeader()) {
      logger.info(`[GUARDED-CRON] follower — not scheduling "${expression}"`);
      return NOOP_TASK;
    }
    // Registration is async only because node-cron is imported lazily. The
    // returned handle proxies start/stop once the real task exists.
    let real: Task | null = null;
    let stopped = false;
    void realCron().then((cron) => {
      if (stopped) return;
      real = cron.schedule(expression, fn as any, opts) as unknown as Task;
    }).catch((err) => {
      logger.error(`[GUARDED-CRON] failed to schedule "${expression}": ${err?.message ?? err}`);
    });
    return {
      start: () => real?.start(),
      stop: () => { stopped = true; real?.stop(); },
    };
  },
};

export default guarded;
