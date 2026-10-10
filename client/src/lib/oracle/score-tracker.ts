/**
 * SCORE TRACKER — honest rating deltas.
 *
 * A conviction score that moved from 83 to 72 is a real signal: the setup is decaying
 * and the arrow should say so. We have no server-side score history per idea, so rather
 * than invent one we record what we actually observe: the first score we saw for an
 * idea, and when. The delta is therefore precisely "change since we started watching
 * it" — which is what we label it, no more.
 *
 * Stored in localStorage, pruned to 30 days so it can't grow without bound.
 */

const KEY = 'qe-score-history-v1';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

interface Entry { first: number; firstAt: number; last: number; lastAt: number }
type Store = Record<string, Entry>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const s = JSON.parse(raw) as Store;
    const cutoff = Date.now() - MAX_AGE_MS;
    let changed = false;
    for (const [k, v] of Object.entries(s)) {
      if (!v || v.lastAt < cutoff) { delete s[k]; changed = true; }
    }
    if (changed) write(s);
    return s;
  } catch { return {}; }
}

function write(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota — non-fatal */ }
}

export interface ScoreDelta {
  /** points changed since first observed (0 when this is the first sighting) */
  delta: number;
  direction: 'up' | 'down' | 'flat';
  /** how long we've been watching, in hours */
  hoursTracked: number;
  isFirstSighting: boolean;
}

/**
 * Record the current score for an idea and return how it has moved since we first saw it.
 * Call once per render pass per idea — it is idempotent within the same value.
 */
export function trackScore(ideaId: string, score: number): ScoreDelta {
  if (!ideaId || !Number.isFinite(score)) {
    return { delta: 0, direction: 'flat', hoursTracked: 0, isFirstSighting: true };
  }
  const store = read();
  const now = Date.now();
  const prev = store[ideaId];

  if (!prev) {
    store[ideaId] = { first: score, firstAt: now, last: score, lastAt: now };
    write(store);
    return { delta: 0, direction: 'flat', hoursTracked: 0, isFirstSighting: true };
  }

  if (prev.last !== score) {
    prev.last = score;
    prev.lastAt = now;
    write(store);
  }

  const delta = Math.round(score - prev.first);
  return {
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    hoursTracked: (now - prev.firstAt) / 3_600_000,
    isFirstSighting: false,
  };
}
