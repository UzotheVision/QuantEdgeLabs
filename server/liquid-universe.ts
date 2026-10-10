/**
 * LIQUID UNIVERSE — the operator's "top 2000, universally, everywhere".
 *
 * One Massive grouped-daily call returns the ENTIRE US stock session (~12k
 * tickers, real OHLCV). This module ranks it by dollar volume and exposes:
 *
 *   getLiquidSymbols()        top-N by dollar volume (sync, from the warmed set)
 *   getLiquidMovers()         whole-market day movers above a liquidity floor —
 *                             the SNDK-class runners no curated list contained
 *   getUniverseBars(days)     per-symbol daily OHLC series for the whole
 *                             market, assembled from ~1 grouped call PER DAY
 *                             instead of one per-symbol call — the pattern
 *                             engine's 2000-name sweep costs ~70 requests, not
 *                             ~2800 Yahoo hits.
 *
 * Ranking snapshots persist to disk so a restart doesn't blind the platform
 * before the next warm. Nothing here fabricates: a cold, failed warm returns
 * an empty list and consumers fall back to their curated sets.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logger';
import { fetchGroupedDaily } from './massive-market-data';

const DISK = path.join(process.cwd(), 'server', 'data', 'liquid-universe.json');
const TOP_N = 2000;

interface RankedRow { symbol: string; dollarVolume: number; close: number; changePct: number | null }
let ranked: RankedRow[] = [];
let rankedAt = 0;

/** Junk filter: no dotted classes, no 5-char warrant/unit suffixes, sane price. */
function tradeable(sym: string, close: number): boolean {
  if (!sym || sym.includes('.') || sym.length > 5) return false;
  if (sym.length === 5 && /[WU]$/.test(sym)) return false;
  return close >= 1; // sub-$1 names are untradeable for the platform's option-centric flow
}

export async function warmLiquidUniverse(): Promise<number> {
  try {
    const today = await fetchGroupedDaily();
    if (today.size === 0) throw new Error('grouped daily empty');
    /**
     * Previous SESSION — not "yesterday".
     *
     * This used to be `new Date(Date.now() - 86_400_000)`, one calendar day
     * back. On a Monday that is Sunday, after a holiday it is the holiday, and
     * when the grouped endpoint snaps to the last available date it returns the
     * SAME session — in which case `pb.c !== c` is false and changePct is
     * written as null regardless.
     *
     * The result: every one of the 2000 cached rows carried changePct: null, so
     * getLiquidMovers() — which filters on `changePct != null` — returned ZERO
     * names at every threshold, including gap>=1%. The bull-flag scanner's
     * universe expansion therefore never ran once, and it fell back to the
     * hand-list on every scan. That list holds 17 software names, which is why
     * the board reads as a SaaS monoculture: the scanner was not finding
     * software, it was handed software.
     *
     * Walk back until a session with a genuinely different close set is found,
     * skipping weekends the same way getUniverseBars does below.
     */
    let prev: Map<string, any> = new Map();
    for (let back = 1; back <= 6 && prev.size === 0; back++) {
      const d = new Date(Date.now() - 86_400_000 * back);
      const dow = d.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      const candidate = await fetchGroupedDaily(d).catch(() => new Map());
      if (candidate.size === 0) continue;
      // Guard against the endpoint snapping to today's session.
      let differs = 0, checked = 0;
      for (const [sym, b] of today.entries()) {
        const pb: any = candidate.get(sym);
        if (!pb) continue;
        checked++;
        if (pb.c !== (b as any).c) differs++;
        if (checked >= 50) break;
      }
      if (checked > 0 && differs / checked < 0.5) continue; // same session, keep walking
      prev = candidate as Map<string, any>;
    }
    if (prev.size === 0) {
      logger.warn('[LIQUID-UNIVERSE] no prior session found — changePct will be null and movers will be empty');
    }
    const rows: RankedRow[] = [];
    for (const [sym, b] of today.entries()) {
      const c = (b as any).c ?? 0; const v = (b as any).v ?? 0;
      if (!tradeable(sym, c) || c * v <= 0) continue;
      const pb: any = prev.get(sym);
      const changePct = pb?.c > 0 && pb.c !== c ? ((c - pb.c) / pb.c) * 100 : null;
      rows.push({ symbol: sym, dollarVolume: c * v, close: c, changePct });
    }
    rows.sort((a, b) => b.dollarVolume - a.dollarVolume);
    ranked = rows.slice(0, TOP_N);
    rankedAt = Date.now();
    await fs.mkdir(path.dirname(DISK), { recursive: true }).catch(() => {});
    await fs.writeFile(DISK, JSON.stringify({ at: rankedAt, rows: ranked }), 'utf8').catch(() => {});
    await publishUniverseToApprovalGate();
    logger.info(`[LIQUID-UNIVERSE] ranked ${rows.length} tradeable names, kept top ${ranked.length} (floor $${(ranked[ranked.length - 1]?.dollarVolume / 1e6).toFixed(0)}M/day)`);
    try {
      const { pulse } = await import('./system-pulse');
      pulse('universe', `liquid universe refreshed: ${rows.length} names ranked, top ${ranked.length} kept`);
    } catch { /* pulse is decoration */ }
    return ranked.length;
  } catch (err: any) {
    logger.warn(`[LIQUID-UNIVERSE] warm failed: ${err?.message} — consumers fall back to curated sets`);
    return ranked.length;
  }
}

/** Load the last persisted ranking so a restart isn't blind before the first warm. */
export async function loadLiquidUniverseFromDisk(): Promise<void> {
  if (ranked.length) return;
  try {
    const raw = JSON.parse(await fs.readFile(DISK, 'utf8'));
    if (Array.isArray(raw?.rows) && raw.rows.length) {
      ranked = raw.rows;
      rankedAt = raw.at ?? 0;
      await publishUniverseToApprovalGate();
      logger.info(`[LIQUID-UNIVERSE] loaded ${ranked.length} names from disk (as of ${new Date(rankedAt).toISOString()})`);
    }
  } catch { /* first boot — warm will populate */ }
}

/** Top-N liquid symbols. Sync read of the warmed set; [] when cold (never fabricated). */
export function getLiquidSymbols(n = TOP_N): string[] {
  return ranked.slice(0, n).map((r) => r.symbol);
}

/**
 * Publish the universe to the approval gate.
 *
 * shared/approved-tickers.ts is the final gate every producer passes through,
 * and it was a closed 197-symbol hand-list that blocked NVDA. It cannot import
 * server state (the client uses it too), so the universe is pushed in here
 * instead — called from both load paths below, so the gate widens the moment
 * the universe is warm and stays exactly as it was if it never is.
 */
async function publishUniverseToApprovalGate(): Promise<void> {
  try {
    /**
     * Dynamic ESM import, NOT require().
     *
     * The first version used require(), which under tsx resolves to a DIFFERENT
     * module instance than the ESM `import` every other file uses. The call
     * succeeded and logged "approval gate widened to 2000 liquid names" while
     * isApprovedTicker('NVDA') stayed false — the state landed on a copy nobody
     * reads. A log line is not proof the state took.
     */
    const mod = await import('@shared/approved-tickers');
    if (typeof (mod as any)?.setLiquidUniverse === 'function') {
      const syms = ranked.map((r) => r.symbol);
      (mod as any).setLiquidUniverse(syms);
      logger.info(`[LIQUID-UNIVERSE] approval gate widened to ${syms.length} liquid names`);
    }
  } catch (err: any) {
    logger.warn(`[LIQUID-UNIVERSE] could not widen approval gate: ${err?.message ?? err}`);
  }
}

export function liquidUniverseStatus(): { size: number; asOf: string | null } {
  return { size: ranked.length, asOf: rankedAt ? new Date(rankedAt).toISOString() : null };
}

/**
 * Instant symbol search over the ranked universe — prefix matches first
 * (ordered by liquidity), then substring matches. Carries the real session
 * change so search results can show live context, not bare letters.
 */
export function searchLiquid(q: string, limit = 8): Array<{ symbol: string; changePct: number | null; dollarVolume: number }> {
  const Q = q.toUpperCase();
  if (!Q) return [];
  const prefix: RankedRow[] = [];
  const infix: RankedRow[] = [];
  for (const r of ranked) {
    if (r.symbol.startsWith(Q)) prefix.push(r);
    else if (r.symbol.includes(Q)) infix.push(r);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...infix].slice(0, limit).map((r) => ({ symbol: r.symbol, changePct: r.changePct, dollarVolume: r.dollarVolume }));
}

/**
 * Whole-market movers: |day change| >= minChangePct with dollar volume >=
 * minDollarVol. This is where the missed runners live — computed from data
 * already in hand, zero extra quota.
 */
export function getLiquidMovers(minChangePct = 3, minDollarVol = 50e6, cap = 60): RankedRow[] {
  return ranked
    .filter((r) => r.dollarVolume >= minDollarVol && r.changePct != null && Math.abs(r.changePct) >= minChangePct)
    .sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!))
    .slice(0, cap);
}

/**
 * Daily OHLC series for every ranked symbol, assembled from one grouped call
 * per trading day. ~70 requests cover 2000+ names for a pattern sweep.
 * Weekends/holidays return empty maps and are skipped; the series carries
 * exactly the sessions that existed.
 */
export interface UBar { time: number; open: number; high: number; low: number; close: number; volume: number }

const UNIVERSE_BARS_TTL_MS = 15 * 60 * 1000;
let universeBarsCache: { days: number; at: number; bars: Map<string, UBar[]> } | null = null;
const universeBarsInflight = new Map<number, Promise<Map<string, UBar[]>>>();

function sliceUniverseBars(source: Map<string, UBar[]>, days: number): Map<string, UBar[]> {
  const out = new Map<string, UBar[]>();
  for (const [symbol, bars] of source) out.set(symbol, bars.slice(-days));
  return out;
}

export async function getUniverseBars(days = 70): Promise<Map<string, UBar[]>> {
  const cached = universeBarsCache;
  if (cached && Date.now() - cached.at < UNIVERSE_BARS_TTL_MS && cached.days >= days) {
    return cached.days === days ? cached.bars : sliceUniverseBars(cached.bars, days);
  }
  const running = universeBarsInflight.get(days);
  if (running) return running;

  const load = buildUniverseBars(days);
  universeBarsInflight.set(days, load);
  try {
    const bars = await load;
    if (!universeBarsCache || universeBarsCache.days <= days || Date.now() - universeBarsCache.at >= UNIVERSE_BARS_TTL_MS) {
      universeBarsCache = { days, at: Date.now(), bars };
    }
    return bars;
  } finally {
    universeBarsInflight.delete(days);
  }
}

async function buildUniverseBars(days: number): Promise<Map<string, UBar[]>> {
  const out = new Map<string, UBar[]>();
  const want = new Set(getLiquidSymbols());
  if (want.size === 0) return out;
  const seen: string[] = [];
  // Walk back calendar days until we have `days` sessions (or hit a sane cap).
  for (let back = 0, sessions = 0; sessions < days && back < days * 1.7 + 10; back++) {
    const date = new Date(Date.now() - back * 86_400_000);
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    try {
      const bars = await fetchGroupedDaily(date);
      if (bars.size === 0) continue;
      sessions++;
      const t = Math.floor(date.getTime() / 1000);
      for (const [sym, b] of bars.entries()) {
        if (!want.has(sym)) continue;
        const a: any = b;
        if (!(a.c > 0 && a.h > 0 && a.l > 0 && a.o > 0)) continue;
        let arr = out.get(sym);
        if (!arr) { arr = []; out.set(sym, arr); }
        arr.push({ time: t, open: a.o, high: a.h, low: a.l, close: a.c, volume: a.v ?? 0 });
      }
      seen.push(date.toISOString().slice(0, 10));
    } catch { /* a missing day is a skipped session, not a fabricated one */ }
  }
  // Grouped walks newest→oldest; series must be oldest→newest.
  for (const arr of out.values()) arr.reverse();
  logger.info(`[LIQUID-UNIVERSE] assembled bars for ${out.size} names across ${seen.length} sessions`);
  return out;
}
