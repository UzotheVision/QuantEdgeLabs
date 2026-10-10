/**
 * PROVIDER CACHE — one guard in front of every rate-limited upstream.
 *
 * The platform makes ~72 distinct Yahoo calls plus CBOE chains, and on boot several
 * scanners request the SAME symbol at the same moment. The providers answer with 429s,
 * every retry queues, and unrelated endpoints (charts, convictions) stall behind the
 * storm — which reads to a user as "the app hangs".
 *
 * Two mechanisms, both cheap:
 *   • COALESCE — concurrent callers for an identical key share ONE in-flight request.
 *   • TTL CACHE — repeat calls inside the window are served from memory.
 *
 * Neither costs accuracy on delayed/daily data, and together they turn N duplicate
 * requests per symbol into one.
 */
import { logger } from './logger';

interface Entry<T> { data: T; expiresAt: number }

const _cache = new Map<string, Entry<any>>();
const _inflight = new Map<string, Promise<any>>();
const MAX_ENTRIES = 800;

function prune() {
  if (_cache.size <= MAX_ENTRIES) return;
  const sorted = Array.from(_cache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (let i = 0; i < Math.ceil(MAX_ENTRIES * 0.2); i++) {
    if (sorted[i]) _cache.delete(sorted[i][0]);
  }
}

/**
 * Run `fetcher` under the given cache key, coalescing concurrent callers.
 * A thrown fetcher error is NOT cached — failures must be retryable.
 */
export async function cachedFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();

  const hit = _cache.get(key);
  if (hit && hit.expiresAt > now) return hit.data as T;

  const inflight = _inflight.get(key);
  if (inflight) return inflight as Promise<T>;

  const p = fetcher()
    .then((data) => {
      _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
      prune();
      return data;
    })
    .finally(() => { _inflight.delete(key); });

  _inflight.set(key, p);
  return p;
}

/** Serve stale data rather than nothing when the upstream is rate-limiting us. */
export async function cachedFetchWithStale<T>(
  key: string, ttlMs: number, staleMs: number, fetcher: () => Promise<T>,
): Promise<T> {
  try {
    return await cachedFetch(key, ttlMs, fetcher);
  } catch (err) {
    const stale = _cache.get(key);
    if (stale && Date.now() - stale.expiresAt < staleMs) {
      logger.warn(`[PROVIDER-CACHE] ${key}: upstream failed, serving stale`);
      return stale.data as T;
    }
    throw err;
  }
}

export function providerCacheStats() {
  return { cached: _cache.size, inflight: _inflight.size };
}

/**
 * GLOBAL RATE LIMITER — one queue per upstream host.
 *
 * Coalescing stops N callers hitting the same URL at once, but it does nothing about the
 * platform asking a provider for 160 DIFFERENT symbols in a burst. CBOE answers that with
 * a blanket 429 on every subsequent request — which is why options pricing died even
 * though the endpoint works fine when approached at a sane pace.
 *
 * Each host gets a serialised queue with a minimum spacing between requests. Slower per
 * call, but it actually completes instead of being throttled to zero.
 */
const _queues = new Map<string, Promise<unknown>>();
const _lastCall = new Map<string, number>();

export async function rateLimited<T>(host: string, minIntervalMs: number, fn: () => Promise<T>): Promise<T> {
  const prev = _queues.get(host) ?? Promise.resolve();

  const next = prev.then(async () => {
    const since = Date.now() - (_lastCall.get(host) ?? 0);
    if (since < minIntervalMs) {
      await new Promise((r) => setTimeout(r, minIntervalMs - since));
    }
    _lastCall.set(host, Date.now());
    return fn();
  });

  // keep the chain alive even when a call rejects, so one failure can't wedge the queue
  _queues.set(host, next.then(() => undefined, () => undefined));
  return next;
}
