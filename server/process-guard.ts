/**
 * PROCESS GUARD — the app must not die because a bill went unpaid.
 *
 * Node terminates the process on an unhandled promise rejection. Neither web.ts
 * nor worker.ts installed a handler, so any async path that threw without a
 * local catch took the whole thing down. The most common such path turned out
 * to be the cheapest to trigger: multi-llm-service throws 'All LLM providers
 * failed' the moment every configured key is out of credit, and a single
 * uncaught call from a cron tick was enough to kill a running dashboard.
 *
 * A research terminal that is up and missing its AI commentary is useful. One
 * that is down is not. So the rule here is: classify, log loudly, stay alive —
 * and keep a counter, because a fault that repeats forever is a different
 * problem from one that happened once and needs to be visible either way.
 *
 * The one thing that DOES warrant exiting is a fault storm: if the same class
 * of error fires faster than anything could be servicing it, the process is
 * wedged and PM2 restarting it is genuinely the better outcome.
 */
import { logger } from './logger';

export type FaultKind = 'credit' | 'ratelimit' | 'network' | 'database' | 'bug';

const STORM_WINDOW_MS = 60_000;
const STORM_THRESHOLD = 50;

const _counts = new Map<FaultKind, number>();
let _windowStart = Date.now();
let _windowCount = 0;

/** Best-effort classification from the error's own text. */
export function classifyFault(err: unknown): FaultKind {
  const msg = (
    err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err)
  ).toLowerCase();

  if (
    msg.includes('credit balance') || msg.includes('insufficient_quota') ||
    msg.includes('exceeded your current quota') || msg.includes('billing') ||
    msg.includes('payment required') || msg.includes('all llm providers failed') ||
    msg.includes('all llms failed')
  ) return 'credit';

  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'ratelimit';
  }
  if (
    msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('enotfound') ||
    msg.includes('socket hang up') || msg.includes('fetch failed') || msg.includes('econnrefused')
  ) return 'network';

  if (msg.includes('neon') || msg.includes('postgres') || msg.includes('connection terminated')) {
    return 'database';
  }
  return 'bug';
}

const ADVICE: Record<FaultKind, string> = {
  credit: 'An API key is out of credit. AI commentary degrades; prices, scans and the bot keep running.',
  ratelimit: 'Upstream is throttling. The throttler backs off on its own.',
  network: 'Transient upstream network failure. Next cycle retries.',
  database: 'Database connectivity problem — this one is worth looking at now.',
  bug: 'Unhandled programming error. This is a defect, not an outage; the stack is above.',
};

function record(kind: FaultKind): boolean {
  _counts.set(kind, (_counts.get(kind) ?? 0) + 1);

  const now = Date.now();
  if (now - _windowStart > STORM_WINDOW_MS) {
    _windowStart = now;
    _windowCount = 0;
  }
  _windowCount++;
  return _windowCount >= STORM_THRESHOLD;
}

/** Fault tallies since boot, for a health endpoint to surface. */
export function faultCounts(): Record<string, number> {
  return Object.fromEntries(_counts);
}

export function installProcessGuard(processName: string): void {
  // PM2/Railway can replace an exited process. The local preview launcher cannot:
  // exiting there makes the site disappear until somebody manually starts it again.
  const hasProcessSupervisor = Boolean(process.env.pm_id || process.env.PM2_HOME || process.env.RAILWAY_ENVIRONMENT);

  process.on('unhandledRejection', (reason: unknown) => {
    const kind = classifyFault(reason);
    const storm = record(kind);
    const msg = reason instanceof Error ? reason.message : String(reason);

    logger.error(`[GUARD:${processName}] unhandled rejection (${kind}): ${msg}`);
    logger.error(`[GUARD:${processName}] ${ADVICE[kind]}`);
    if (kind === 'bug' && reason instanceof Error && reason.stack) {
      logger.error(reason.stack);
    }
    if (storm && hasProcessSupervisor) {
      logger.error(`[GUARD:${processName}] ${STORM_THRESHOLD}+ faults in a minute — wedged, exiting for a clean restart.`);
      process.exit(1);
    } else if (storm) {
      logger.error(`[GUARD:${processName}] fault storm detected; local preview has no supervisor, so the process will stay alive.`);
    }
  });

  process.on('uncaughtException', (err: Error) => {
    const kind = classifyFault(err);
    const storm = record(kind);

    logger.error(`[GUARD:${processName}] uncaught exception (${kind}): ${err.message}`);
    logger.error(`[GUARD:${processName}] ${ADVICE[kind]}`);
    if (err.stack) logger.error(err.stack);

    // A credit or upstream fault leaves state intact — there is nothing to
    // recover from and staying up is strictly better. A genuine bug may have
    // left things inconsistent, but a trading dashboard that vanishes is worse
    // than one serving slightly stale data, so we stay up and make it loud.
    if (storm && hasProcessSupervisor) {
      logger.error(`[GUARD:${processName}] fault storm — exiting for a clean restart.`);
      process.exit(1);
    } else if (storm) {
      logger.error(`[GUARD:${processName}] fault storm detected; local preview has no supervisor, so the process will stay alive.`);
    }
  });

  logger.info(`[GUARD:${processName}] installed — credit and upstream faults will no longer kill this process`);
}
