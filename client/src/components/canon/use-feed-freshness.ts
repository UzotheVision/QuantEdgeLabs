/**
 * CANON · FEED FRESHNESS
 *
 * Pulls the server's own timestamp out of a payload so a component can show how
 * old its data is in one line.
 *
 * This exists because of an adoption gap, not a design gap. viz/MOTION.md
 * defines Heartbeat as the Tier 1 primitive for "proof the screen is still
 * connected" and states that every polling surface should show, at minimum,
 * whether what you are looking at is current. Measured today: 117 components
 * pass refetchInterval and 6 show freshness. The primitive was never the
 * bottleneck — finding the right field on each of 117 differently-shaped
 * payloads was.
 *
 * MOTION.md's rule is enforced here rather than restated:
 *
 *   "Do NOT substitute the client's fetch time: a server-cached response can be
 *    hours old while the fetch is five seconds old, and a green dot in that
 *    situation is a false claim of freshness."
 *
 * So this only ever reads a timestamp the SERVER sent. When there is none it
 * returns null, Heartbeat renders "no data", and that is the correct outcome —
 * an unknown age must not be dressed as a fresh one. If a surface needs a real
 * age, the fix is for its endpoint to send one.
 */

/** Field names the server actually uses, in order of preference. */
const TIMESTAMP_FIELDS = [
  'generatedAt',
  'asOf',
  'calculatedAt',
  'scannedAt',
  'lastUpdate',
  'lastUpdated',
  'updatedAt',
  'timestamp',
  'fetchedAt',
] as const;

/**
 * The server-sent timestamp for a payload, or null.
 *
 * Checks the top level, then a `_meta` envelope (several routes wrap freshness
 * there as `_meta.cachedAt`). Deliberately shallow — a timestamp found deep
 * inside an arbitrary nested object is more likely to belong to one row than to
 * the response, and dating the panel by one row's clock is its own lie.
 */
export function feedTimestamp(payload: unknown): string | number | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;

  for (const key of TIMESTAMP_FIELDS) {
    const v = obj[key];
    if (typeof v === 'string' || typeof v === 'number') return v;
  }

  const meta = obj._meta;
  if (meta && typeof meta === 'object') {
    const m = meta as Record<string, unknown>;
    for (const key of ['cachedAt', ...TIMESTAMP_FIELDS] as const) {
      const v = m[key];
      if (typeof v === 'string' || typeof v === 'number') return v;
    }
  }

  return null;
}

/** True when a payload carries no server timestamp — worth surfacing in review. */
export function lacksTimestamp(payload: unknown): boolean {
  return feedTimestamp(payload) === null;
}
