/**
 * Point-in-time grouped daily bars, cached to disk.
 *
 * Deliberately NOT server/massive-market-data.ts's fetchGroupedDaily: that one
 * walks back up to five days on a miss, so a 2023 holiday would return the
 * previous session's bars filed under the holiday's date — duplicated sessions
 * a backtest cannot see. Here an exact date returns that date or nothing.
 *
 * The other difference that matters over a thousand calls: a rate-limited or
 * failed request is retried and, if it keeps failing, THROWS. A backtest that
 * silently drops sessions is worse than one that refuses to run.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BASE = 'https://api.polygon.io';
// Overridable so a synthetic run can never be confused with real cached bars.
const CACHE_DIR = process.env.GROUPED_CACHE_DIR
  ? path.resolve(process.env.GROUPED_CACHE_DIR)
  : path.join(process.cwd(), 'server', 'data', 'grouped');

/** Tickers kept per session. Comfortably above any universe we rank into. */
const KEEP_PER_DAY = 4000;

export interface GBar { t: string; o: number; h: number; l: number; c: number; v: number }

/** A cached session: bars, or an explicit empty array meaning "no session that day". */
type Cached = GBar[];

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

function cachePath(day: string): string {
  return path.join(CACHE_DIR, `${day}.json.gz`);
}

function readCache(day: string): Cached | null {
  const p = cachePath(day);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8'));
  } catch {
    fs.unlinkSync(p); // a truncated write from an interrupted run
    return null;
  }
}

function writeCache(day: string, bars: Cached): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${cachePath(day)}.tmp`;
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(bars))));
  fs.renameSync(tmp, cachePath(day)); // atomic: never leave a half-file behind
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class NotEntitledError extends Error {}

/**
 * One session, exactly. Returns [] for a genuine non-trading day (Polygon
 * answers OK with no results), which is cached so we never ask again.
 * Throws on an entitlement problem or on repeated transport failure.
 */
export async function fetchExactDay(day: string, opts: { minMsBetween: number }): Promise<GBar[]> {
  const hit = readCache(day);
  if (hit) return hit;

  const key = process.env.POLYGON_API_KEY?.trim();
  if (!key) throw new Error('POLYGON_API_KEY is not set — this backtest needs real history, and will not invent it.');

  const url = `${BASE}/v2/aggs/grouped/locale/us/market/stocks/${day}?adjusted=true&apiKey=${key}`;

  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await sleep(Math.min(60_000, 2000 * 2 ** (attempt - 1)));
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      continue; // transport blip — retry
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 15_000);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new NotEntitledError(
        `Polygon refused ${day} with HTTP ${res.status}. The plan likely does not cover history this far back ` +
        `(the free tier stops at 2 years). Nothing was cached; fix the plan and re-run — cached days are kept.`,
      );
    }
    if (!res.ok) continue; // 5xx — retry

    const data: any = await res.json().catch(() => null);
    if (data?.status === 'NOT_AUTHORIZED') {
      throw new NotEntitledError(`Polygon: NOT_AUTHORIZED for ${day} — the plan does not cover this range.`);
    }
    if (!data) continue;

    const results: any[] = data.results ?? [];
    // Rank by dollar volume and keep the head; the tail is sub-penny noise that
    // no universe of ours would ever select.
    const bars: GBar[] = results
      .filter((b) => b?.T && b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0 && b.v > 0)
      .map((b) => ({ t: String(b.T).toUpperCase(), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
      .sort((a, b) => b.c * b.v - a.c * a.v)
      .slice(0, KEEP_PER_DAY);

    writeCache(day, bars); // [] is a real answer: a holiday. Cache it.
    await sleep(opts.minMsBetween);
    return bars;
  }

  throw new Error(`Gave up on ${day} after 6 attempts. Refusing to continue with a hole in the history.`);
}

/** Trading-day calendar (weekends removed; holidays discovered by asking). */
export function weekdaysBetween(fromDay: string, toDay: string): string[] {
  const days: string[] = [];
  for (const d = new Date(`${fromDay}T00:00:00Z`); isoDay(d) <= toDay; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(isoDay(d));
  }
  return days;
}

/**
 * Every session in [fromDay, toDay], oldest first, handed to `cb` one at a time
 * and then released. Streaming rather than returning an array: four years of
 * grouped bars is millions of objects, and nothing needs them all at once.
 * Weekends cost nothing; holidays cost one request each, once, then cache as [].
 */
export async function eachSession(
  fromDay: string,
  toDay: string,
  opts: { rpm: number; onProgress?: (done: number, total: number, day: string) => void },
  cb: (day: string, bars: GBar[]) => void,
): Promise<number> {
  const minMsBetween = opts.rpm > 0 ? Math.ceil(60_000 / opts.rpm) : 0;
  const days = weekdaysBetween(fromDay, toDay);
  let sessions = 0;
  for (let i = 0; i < days.length; i++) {
    const bars = await fetchExactDay(days[i], { minMsBetween });
    if (bars.length > 0) { cb(days[i], bars); sessions++; }
    opts.onProgress?.(i + 1, days.length, days[i]);
  }
  return sessions;
}
