/**
 * DEEP RUN — the pre-registered signals from battery rounds 1-2, walked
 * forward across ~250 sessions of the whole liquid market (~45 independent
 * non-overlapping 5-session windows spanning multiple regimes).
 *
 * Method: fetch grouped-daily direct (one call per session, keeping only the
 * current top-2000 symbols' bars — the module cache would hold 250 full-market
 * days and OOM). For each window k: signal fires at session t, forward return
 * = close[t+5]/close[t]-1, excess = signal mean − window baseline mean.
 * Verdict per signal: how many windows it beat baseline in, average excess,
 * and a crude t-stat on the window-level excess series.
 *
 * Survivorship caveat, stated plainly: the symbol set is TODAY's top-2000 by
 * dollar volume, so names that died or faded out of liquidity are missing —
 * this biases baselines up but applies EQUALLY to signal and baseline within
 * each window; excess returns are the honest readout, absolute means are not.
 */
import 'dotenv/config';
import fs from 'fs';
import { loadLiquidUniverseFromDisk, getLiquidSymbols } from '../server/liquid-universe';

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

const KEY = process.env.POLYGON_API_KEY?.trim();
const SESSIONS = 250;

async function fetchDay(dateISO: string): Promise<Map<string, Bar> | null> {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${dateISO}?adjusted=true&apiKey=${KEY}`;
  try {
    const r = await fetch(url);
    const d: any = await r.json();
    const rows: any[] = d?.results ?? [];
    if (!rows.length) return null;
    const m = new Map<string, Bar>();
    for (const b of rows) {
      if (b.T && b.c > 0) m.set(String(b.T).toUpperCase(), { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 });
    }
    return m;
  } catch { return null; }
}

function sma(a: number[], n: number, end: number): number | null {
  if (end - n < 0) return null;
  let s = 0; for (let i = end - n; i < end; i++) s += a[i];
  return s / n;
}

async function main() {
  if (!KEY) { console.log('NO KEY'); process.exit(1); }
  await loadLiquidUniverseFromDisk();
  const want = new Set(getLiquidSymbols());
  console.log(`symbols: ${want.size} · target sessions: ${SESSIONS}`);

  // Walk back calendar days, newest first, collecting sessions.
  const days: Array<Map<string, Bar>> = [];
  let back = 1;
  while (days.length < SESSIONS && back < SESSIONS * 1.7 + 20) {
    const batch: Promise<{ iso: string; m: Map<string, Bar> | null }>[] = [];
    for (let j = 0; j < 4 && back + j < SESSIONS * 1.7 + 20; j++) {
      const d = new Date(Date.now() - (back + j) * 86_400_000);
      const dow = d.getUTCDay();
      const iso = d.toISOString().slice(0, 10);
      batch.push(dow === 0 || dow === 6 ? Promise.resolve({ iso, m: null }) : fetchDay(iso).then((m) => ({ iso, m })));
    }
    back += 4;
    for (const { m } of await Promise.all(batch)) {
      if (!m) continue;
      const kept = new Map<string, Bar>();
      for (const s of want) { const b = m.get(s); if (b) kept.set(s, b); }
      days.push(kept);
    }
    if (days.length % 40 < 4) console.log(`  ...${days.length} sessions collected`);
  }
  days.reverse(); // oldest → newest
  console.log(`sessions: ${days.length}`);

  // Assemble per-symbol series (aligned on session index; missing day = gap → drop symbol if too sparse)
  const series = new Map<string, Bar[]>();
  for (const s of want) {
    const arr: Bar[] = [];
    for (const d of days) { const b = d.get(s); if (b) arr.push(b); }
    if (arr.length >= days.length * 0.9) series.set(s, arr);
  }
  console.log(`usable symbols (>=90% coverage): ${series.size}`);

  type Sig = (b: Bar[], i: number) => boolean;
  const nr7at = (b: Bar[], i: number) => { const r = b.slice(i - 6, i + 1).map((x) => x.h - x.l); return r[6] > 0 && r[6] === Math.min(...r); };
  const SIGNALS: Record<string, Sig> = {
    thrust_2_5x: (b, i) => { const av = sma(b.map((q) => q.v), 20, i); return av != null && av > 0 && b[i].v >= av * 2.5 && b[i].c > b[i - 1].c; },
    thrust_3x: (b, i) => { const av = sma(b.map((q) => q.v), 20, i); return av != null && av > 0 && b[i].v >= av * 3 && b[i].c > b[i - 1].c; },
    nr7_all: (b, i) => nr7at(b, i),
    nr7_dn20_deep5: (b, i) => { const m = sma(b.map((q) => q.c), 20, i + 1); return m != null && b[i].c < m * 0.95 && nr7at(b, i); },
    prox_0_3: (b, i) => { const hi = Math.max(...b.slice(Math.max(0, i - 251), i + 1).map((x) => x.h)); return b[i].c >= hi * 0.97; },
    new_high: (b, i) => { const hi = Math.max(...b.slice(Math.max(0, i - 251), i).map((x) => x.h)); return b[i].h > hi; },
    gap5_chase: (b, i) => (b[i].c - b[i - 1].c) / b[i - 1].c >= 0.05,
    down3: (b, i) => b[i].c < b[i - 1].c && b[i - 1].c < b[i - 2].c && b[i - 2].c < b[i - 3].c,
  };

  // Non-overlapping windows: detection at i = 30, 35, 40, ... , len-6
  const winStats: Record<string, Array<{ n: number; mean: number; base: number }>> = {};
  const L = Math.min(...[...series.values()].map((a) => a.length));
  for (let i = 30; i <= L - 6; i += 5) {
    const cells: Record<string, { n: number; sum: number }> = {};
    let bn = 0, bsum = 0;
    for (const b of series.values()) {
      if (b.length < L) continue; // strict alignment: full-coverage names only
      const entry = b[i].c, exit = b[i + 5].c;
      if (!(entry > 0 && exit > 0)) continue;
      const fwd = ((exit - entry) / entry) * 100;
      bn++; bsum += fwd;
      for (const [name, fn] of Object.entries(SIGNALS)) {
        try { if (fn(b, i)) { const c = (cells[name] ||= { n: 0, sum: 0 }); c.n++; c.sum += fwd; } } catch { /* short */ }
      }
    }
    if (bn < 200) continue;
    const base = bsum / bn;
    for (const [name, c] of Object.entries(cells)) {
      if (c.n >= 5) (winStats[name] ||= []).push({ n: c.n, mean: c.sum / c.n, base });
    }
  }

  const lines: string[] = [];
  lines.push(`DEEP RUN · ${days.length} sessions · ${series.size} symbols · windows have n>=5 fires`);
  for (const [name, ws] of Object.entries(winStats)) {
    const k = ws.length;
    const ex = ws.map((w) => w.mean - w.base);
    const mean = ex.reduce((a, b) => a + b, 0) / k;
    const sd = Math.sqrt(ex.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, k - 1));
    const t = sd > 0 ? mean / (sd / Math.sqrt(k)) : 0;
    const beat = ex.filter((x) => x > 0).length;
    const totalN = ws.reduce((a, w) => a + w.n, 0);
    lines.push(`${name.padEnd(16)} windows:${String(k).padStart(3)}  beatBase:${String(beat).padStart(3)} (${(100 * beat / k).toFixed(0)}%)  avgExcess:${mean >= 0 ? '+' : ''}${mean.toFixed(2)}%  t≈${t.toFixed(2)}  fires:${totalN}`);
  }
  const out = lines.join('\n');
  console.log(out);
  fs.writeFileSync('research/deep-run-results.txt', out + '\n');
  process.exit(0);
}
main();
