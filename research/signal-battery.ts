/**
 * Signal battery — round 1. Every hypothesis scored on TWO non-overlapping
 * 5-session holdouts (A = last 5, B = the 5 before) across ~2000 liquid names.
 * A signal only advances if it beats baseline in BOTH windows. Multiple-
 * comparison risk is real: consistency across windows + n is the filter.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type Sig = (b: { o: number; h: number; l: number; c: number; v: number }[], i: number) => boolean;

function sma(a: number[], n: number, end: number): number | null {
  if (end - n < 0) return null;
  let s = 0; for (let i = end - n; i < end; i++) s += a[i];
  return s / n;
}

async function main() {
  await loadLiquidUniverseFromDisk();
  const raw = await getUniverseBars(70);
  const data: Record<string, { o: number; h: number; l: number; c: number; v: number }[]> = {};
  for (const [sym, series] of raw.entries()) {
    if (series.length >= 66) data[sym] = series.map((b) => ({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
  }

  const SIGNALS: Record<string, Sig> = {
    'prox_0_1  (≤1% from high)': (b, i) => { const hi = Math.max(...b.slice(0, i + 1).map((x) => x.h)); return b[i].c >= hi * 0.99; },
    'prox_1_3': (b, i) => { const hi = Math.max(...b.slice(0, i + 1).map((x) => x.h)); return b[i].c < hi * 0.99 && b[i].c >= hi * 0.97; },
    'prox_3_8': (b, i) => { const hi = Math.max(...b.slice(0, i + 1).map((x) => x.h)); return b[i].c < hi * 0.97 && b[i].c >= hi * 0.92; },
    'prox_15+ (deep below)': (b, i) => { const hi = Math.max(...b.slice(0, i + 1).map((x) => x.h)); return b[i].c < hi * 0.85; },
    'new_high_today': (b, i) => { const hi = Math.max(...b.slice(0, i).map((x) => x.h)); return b[i].h > hi; },
    'nr7': (b, i) => { const r = b.slice(i - 6, i + 1).map((x) => x.h - x.l); return r[6] > 0 && r[6] === Math.min(...r); },
    'nr7_uptrend': (b, i) => { const r = b.slice(i - 6, i + 1).map((x) => x.h - x.l); const m = sma(b.map((x) => x.c), 20, i + 1); return r[6] > 0 && r[6] === Math.min(...r) && m != null && b[i].c > m; },
    'nr7_downtrend': (b, i) => { const r = b.slice(i - 6, i + 1).map((x) => x.h - x.l); const m = sma(b.map((x) => x.c), 20, i + 1); return r[6] > 0 && r[6] === Math.min(...r) && m != null && b[i].c < m; },
    'nr7_near_high': (b, i) => { const r = b.slice(i - 6, i + 1).map((x) => x.h - x.l); const hi = Math.max(...b.slice(0, i + 1).map((x) => x.h)); return r[6] > 0 && r[6] === Math.min(...r) && b[i].c >= hi * 0.95; },
    'gap5_same_day (chase)': (b, i) => (b[i].c - b[i - 1].c) / b[i - 1].c >= 0.05,
    'gap5_next_day': (b, i) => (b[i - 1].c - b[i - 2].c) / b[i - 2].c >= 0.05,
    'gap5_2d_pullback': (b, i) => (b[i - 2].c - b[i - 3].c) / b[i - 3].c >= 0.05 && b[i].c < b[i - 1].c,
    'vol_thrust_2.5x_up': (b, i) => { const av = sma(b.map((x) => x.v), 20, i); return av != null && av > 0 && b[i].v >= av * 2.5 && b[i].c > b[i - 1].c; },
    'vol_thrust_near_high': (b, i) => { const av = sma(b.map((x) => x.v), 20, i); const hi = Math.max(...b.slice(0, i + 1).map((x) => x.h)); return av != null && av > 0 && b[i].v >= av * 2.5 && b[i].c > b[i - 1].c && b[i].c >= hi * 0.95; },
    '3_down_days (rsi2ish)': (b, i) => b[i].c < b[i - 1].c && b[i - 1].c < b[i - 2].c && b[i - 2].c < b[i - 3].c,
    '3dn_above20d': (b, i) => { const m = sma(b.map((x) => x.c), 20, i + 1); return m != null && b[i].c > m && b[i].c < b[i - 1].c && b[i - 1].c < b[i - 2].c && b[i - 2].c < b[i - 3].c; },
    'up_4of5_near_high': (b, i) => { let u = 0; for (let k = i - 4; k <= i; k++) if (b[k].c > b[k - 1].c) u++; const hi = Math.max(...b.slice(0, i + 1).map((x) => x.h)); return u >= 4 && b[i].c >= hi * 0.95; },
  };

  const windows = [ { name: 'A', detEnd: (n: number) => n - 6 }, { name: 'B', detEnd: (n: number) => n - 11 } ];
  const out: Record<string, Record<string, { n: number; sum: number; w: number }>> = {};
  const base: Record<string, { n: number; sum: number; w: number }> = { A: { n: 0, sum: 0, w: 0 }, B: { n: 0, sum: 0, w: 0 } };

  for (const series of Object.values(data)) {
    const n = series.length;
    for (const win of windows) {
      const i = win.detEnd(n);
      if (i < 25) continue;
      const entry = series[i].c;
      const exit = series[i + 5].c;
      if (!(entry > 0 && exit > 0)) continue;
      const fwd = ((exit - entry) / entry) * 100;
      base[win.name].n++; base[win.name].sum += fwd; if (fwd > 0) base[win.name].w++;
      for (const [name, fn] of Object.entries(SIGNALS)) {
        try {
          if (fn(series, i)) {
            const cell = ((out[name] ||= {})[win.name] ||= { n: 0, sum: 0, w: 0 });
            cell.n++; cell.sum += fwd; if (fwd > 0) cell.w++;
          }
        } catch { /* insufficient history for this signal at i */ }
      }
    }
  }

  const f = (c?: { n: number; sum: number; w: number }) =>
    !c || !c.n ? '      —        ' : `n=${String(c.n).padStart(4)} ${(c.sum / c.n) >= 0 ? '+' : ''}${(c.sum / c.n).toFixed(2)}% ${(100 * c.w / c.n).toFixed(0)}%w`;
  console.log(`BASELINE            A: ${f(base.A)}   B: ${f(base.B)}`);
  const bA = base.A.sum / base.A.n, bB = base.B.sum / base.B.n;
  for (const [name, cells] of Object.entries(out)) {
    const mA = cells.A ? cells.A.sum / cells.A.n : null;
    const mB = cells.B ? cells.B.sum / cells.B.n : null;
    const beats = mA != null && mB != null && mA > bA && mB > bB ? ' ◀ CONSISTENT' : '';
    console.log(`${name.padEnd(22)} A: ${f(cells.A)}   B: ${f(cells.B)}${beats}`);
  }
  process.exit(0);
}
main();

/* ── ROUND 1 RESULTS (recorded 2026-08-27, windows: A = last 5 sessions
 *    (strong up-tape, baseline +1.55%/63%w), B = prior 5 (down-tape,
 *    baseline −0.68%/36%w), n=1977 liquid names) ──
 *
 * CONSISTENT (beat baseline in BOTH regimes):
 *   vol_thrust_2.5x_up   A +7.68%/86%w (n=22)  B +10.55%/41%w (n=17)  ← small n, huge means
 *   nr7_downtrend        A +8.80%/57%w (n=136) B +1.65%/33%w (n=132)  ← compression in downtrends snaps back
 *   nr7 (all)            A +4.55%      B +0.21%
 *
 * REGIME-DEPENDENT (A only — died in the down-tape):
 *   gap5 same-day/next-day, prox_0_3 bands, new_high_today, vol_thrust_near_high
 *   → high-proximity/gap classes are up-tape signals; entries need a regime gate.
 *
 * FAILED BOTH: gap5_2d_pullback (−1%, −9.19%) — the pullback entry is a trap.
 */
