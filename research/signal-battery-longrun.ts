/**
 * Signal battery — long run. The same hypotheses as rounds 1 and 2, measured
 * over years instead of three 5-session windows.
 *
 * Rounds 1 and 2 promoted `volume_thrust` on 20 sessions inside a single month,
 * with n=22 and n=17 in two of the three windows. Round 2's own note asked for
 * a re-test "when more history accumulates". This is that re-test.
 *
 * Three things this does that the short run did not have to care about:
 *
 *   1. POINT-IN-TIME UNIVERSE. Eligibility at bar i is decided by trailing
 *      20-session dollar volume as of i, not by what is liquid today. Testing
 *      today's liquid names backwards is survivorship bias, and over four years
 *      it flatters every long signal.
 *   2. EXACT SESSIONS. Bars come from research/_grouped-cache.ts, which refuses
 *      to substitute a nearby day for a missing one.
 *   3. ROLLING HIGHS. The short run took "the high" as the max over its whole
 *      70-bar window. Over four years that would mean an all-time high, which is
 *      a different hypothesis, so highs here are rolling over LOOKBACK sessions.
 *      Results are therefore comparable in spirit, not identical by construction.
 *
 * Usage:
 *   NODE_OPTIONS='--max-old-space-size=6144' npx tsx research/signal-battery-longrun.ts
 *   flags: --years 4  --horizon 5  --top 2000  --rpm 100  --to 2026-08-29
 */
import 'dotenv/config';
import { eachSession, isoDay, NotEntitledError } from './_grouped-cache';

const arg = (name: string, dflt: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const argS = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const YEARS = arg('years', 4);
const HORIZON = arg('horizon', 5);      // forward sessions, matching rounds 1-2
const TOP = arg('top', 2000);           // point-in-time universe size
const RPM = arg('rpm', 100);            // requests/min; free tier is 5
const LOOKBACK = 252;                   // rolling-high window, ~1 year
const WARMUP = LOOKBACK;                // bars needed before a signal may fire

const TO = argS('to', isoDay(new Date(Date.now() - 86_400_000)));
const FROM = isoDay(new Date(new Date(`${TO}T00:00:00Z`).getTime() - (YEARS * 365 + LOOKBACK * 1.5) * 86_400_000));

// ── signal definitions ───────────────────────────────────────────────────────
// Series are columnar: one Float64Array per field, indexed by session.
interface S { o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array; v: Float64Array;
              hi: Float64Array; sma20c: Float64Array; sma20v: Float64Array; dv20: Float64Array; ok: Uint8Array }

type Sig = (s: S, i: number) => boolean;

const SIGNALS: Record<string, Sig> = {
  'prox_0_1  (<=1% from high)': (s, i) => s.c[i] >= s.hi[i] * 0.99,
  'prox_1_3':                   (s, i) => s.c[i] < s.hi[i] * 0.99 && s.c[i] >= s.hi[i] * 0.97,
  'prox_3_8':                   (s, i) => s.c[i] < s.hi[i] * 0.97 && s.c[i] >= s.hi[i] * 0.92,
  'prox_15+  (deep below)':     (s, i) => s.c[i] < s.hi[i] * 0.85,
  'new_high_today':             (s, i) => s.h[i] > s.hi[i - 1],
  'nr7':                        (s, i) => nr7(s, i),
  'nr7_uptrend':                (s, i) => nr7(s, i) && s.c[i] > s.sma20c[i],
  'nr7_downtrend':              (s, i) => nr7(s, i) && s.c[i] < s.sma20c[i],
  'nr7_near_high':              (s, i) => nr7(s, i) && s.c[i] >= s.hi[i] * 0.95,
  'nr7_dn20_deep5':             (s, i) => nr7(s, i) && s.c[i] < s.sma20c[i] * 0.95,   // r2 near-miss
  'gap5_same_day (chase)':      (s, i) => (s.c[i] - s.c[i - 1]) / s.c[i - 1] >= 0.05,
  'gap5_next_day':              (s, i) => (s.c[i - 1] - s.c[i - 2]) / s.c[i - 2] >= 0.05,
  'gap5_2d_pullback':           (s, i) => (s.c[i - 2] - s.c[i - 3]) / s.c[i - 3] >= 0.05 && s.c[i] < s.c[i - 1],
  'vol_thrust_1.5x_up':         (s, i) => thrust(s, i, 1.5),
  'vol_thrust_2x_up':           (s, i) => thrust(s, i, 2.0),
  'vol_thrust_2.5x_up  *LIVE*': (s, i) => thrust(s, i, 2.5),   // promoted to the generator
  'vol_thrust_3x_up':           (s, i) => thrust(s, i, 3.0),
  'vol_thrust_3.5x_up':         (s, i) => thrust(s, i, 3.5),   // the generator's "strong" tier
  'vol_thrust_near_high':       (s, i) => thrust(s, i, 2.5) && s.c[i] >= s.hi[i] * 0.95,
  '3_down_days':                (s, i) => s.c[i] < s.c[i - 1] && s.c[i - 1] < s.c[i - 2] && s.c[i - 2] < s.c[i - 3],
  '3dn_above20d':               (s, i) => s.c[i] > s.sma20c[i] && s.c[i] < s.c[i - 1] && s.c[i - 1] < s.c[i - 2] && s.c[i - 2] < s.c[i - 3],
  'up_4of5_near_high':          (s, i) => { let u = 0; for (let k = i - 4; k <= i; k++) if (s.c[k] > s.c[k - 1]) u++;
                                            return u >= 4 && s.c[i] >= s.hi[i] * 0.95; },
};

function nr7(s: S, i: number): boolean {
  const r = s.h[i] - s.l[i];
  if (!(r > 0)) return false;
  for (let k = i - 6; k < i; k++) if (s.h[k] - s.l[k] <= r) return false;
  return true;
}
function thrust(s: S, i: number, mult: number): boolean {
  return s.sma20v[i] > 0 && s.v[i] >= s.sma20v[i] * mult && s.c[i] > s.c[i - 1];
}

// ── accumulators ─────────────────────────────────────────────────────────────
interface Cell { n: number; sum: number; sumsq: number; w: number }
const cell = (): Cell => ({ n: 0, sum: 0, sumsq: 0, w: 0 });
const add = (c: Cell, x: number) => { c.n++; c.sum += x; c.sumsq += x * x; if (x > 0) c.w++; };
const mean = (c: Cell) => (c.n ? c.sum / c.n : NaN);
const variance = (c: Cell) => (c.n > 1 ? Math.max(0, c.sumsq / c.n - (c.sum / c.n) ** 2) * (c.n / (c.n - 1)) : NaN);

/** Welch's t: is the signal's mean forward return distinguishable from baseline? */
function welch(a: Cell, b: Cell): number {
  if (a.n < 2 || b.n < 2) return NaN;
  const se = Math.sqrt(variance(a) / a.n + variance(b) / b.n);
  return se > 0 ? (mean(a) - mean(b)) / se : NaN;
}

async function main() {
  console.log(`\nSignal battery — long run`);
  console.log(`range ${FROM} .. ${TO}   horizon ${HORIZON}d   universe top-${TOP} point-in-time   rolling high ${LOOKBACK}d\n`);

  // ── pass 1: which symbols ever matter, and what the session calendar is ────
  const days: string[] = [];
  const seen = new Map<string, number>();
  const PAD = Math.round(TOP * 1.5);
  process.stdout.write('pass 1/2  building session calendar and symbol union\n');
  await eachSession(FROM, TO, {
    rpm: RPM,
    onProgress: (d, t, day) => { if (d % 50 === 0 || d === t) process.stdout.write(`\r  ${d}/${t} weekdays  (${day})   `); },
  }, (day, bars) => {
    days.push(day);
    for (let k = 0; k < Math.min(bars.length, PAD); k++) seen.set(bars[k].t, (seen.get(bars[k].t) ?? 0) + 1);
  });

  const S_ = days.length;
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  // A symbol needs enough bars to warm up and be measured at all.
  const symbols = [...seen.entries()].filter(([, n]) => n >= WARMUP + HORIZON + 1).map(([s]) => s);
  console.log(`\n  ${S_} sessions, ${seen.size} symbols seen, ${symbols.length} with enough history\n`);
  if (S_ < WARMUP + HORIZON + 20) throw new Error(`Only ${S_} sessions — not enough to warm up. Widen --years.`);

  // ── pass 2: fill columnar series (cache makes this a disk read) ───────────
  process.stdout.write('pass 2/2  filling series\n');
  const series = new Map<string, S>();
  const blank = (): S => ({
    o: new Float64Array(S_), h: new Float64Array(S_), l: new Float64Array(S_), c: new Float64Array(S_),
    v: new Float64Array(S_), hi: new Float64Array(S_), sma20c: new Float64Array(S_),
    sma20v: new Float64Array(S_), dv20: new Float64Array(S_), ok: new Uint8Array(S_),
  });
  for (const s of symbols) series.set(s, blank());

  await eachSession(FROM, TO, {
    rpm: RPM,
    onProgress: (d, t, day) => { if (d % 100 === 0 || d === t) process.stdout.write(`\r  ${d}/${t}  (${day})   `); },
  }, (day, bars) => {
    const i = dayIndex.get(day);
    if (i === undefined) return;
    for (const b of bars) {
      const s = series.get(b.t);
      if (!s) continue;
      s.o[i] = b.o; s.h[i] = b.h; s.l[i] = b.l; s.c[i] = b.c; s.v[i] = b.v; s.ok[i] = 1;
    }
  });
  console.log('\n');

  // ── derived columns ──────────────────────────────────────────────────────
  for (const s of series.values()) {
    let cSum = 0, vSum = 0, dSum = 0;
    for (let i = 0; i < S_; i++) {
      // A gap in a symbol's bars (halt, late listing) invalidates its windows.
      if (!s.ok[i]) { s.hi[i] = NaN; s.sma20c[i] = NaN; s.sma20v[i] = NaN; s.dv20[i] = NaN; continue; }
      cSum += s.c[i]; vSum += s.v[i]; dSum += s.c[i] * s.v[i];
      if (i >= 20) { cSum -= s.c[i - 20]; vSum -= s.v[i - 20]; dSum -= s.c[i - 20] * s.v[i - 20]; }
      const full20 = i >= 19;
      s.sma20c[i] = full20 ? cSum / 20 : NaN;
      s.sma20v[i] = full20 ? vSum / 20 : NaN;
      s.dv20[i] = full20 ? dSum / 20 : NaN;
      let hi = 0;
      for (let k = Math.max(0, i - LOOKBACK + 1); k <= i; k++) if (s.ok[k] && s.h[k] > hi) hi = s.h[k];
      s.hi[i] = hi;
    }
  }

  // ── walk forward ─────────────────────────────────────────────────────────
  const names = Object.keys(SIGNALS);
  const byYear = new Map<string, { base: Cell; sig: Map<string, Cell> }>();
  const bucket = (y: string) => {
    let b = byYear.get(y);
    if (!b) { b = { base: cell(), sig: new Map(names.map((n) => [n, cell()])) }; byYear.set(y, b); }
    return b;
  };

  const rank: Array<{ s: S; dv: number }> = [];
  for (let i = WARMUP; i + HORIZON < S_; i++) {
    rank.length = 0;
    for (const s of series.values()) {
      if (!s.ok[i] || !s.ok[i + HORIZON] || !(s.dv20[i] > 0)) continue;
      rank.push({ s, dv: s.dv20[i] });
    }
    if (rank.length === 0) continue;
    rank.sort((a, b) => b.dv - a.dv);
    const eligible = rank.slice(0, TOP);

    const year = days[i].slice(0, 4);
    const all = bucket('ALL'), yr = bucket(year);

    for (const { s } of eligible) {
      const entry = s.c[i], exit = s.c[i + HORIZON];
      if (!(entry > 0 && exit > 0)) continue;
      const fwd = ((exit - entry) / entry) * 100;
      add(all.base, fwd); add(yr.base, fwd);
      for (const name of names) {
        let fired = false;
        try { fired = SIGNALS[name](s, i); } catch { fired = false; }
        if (!fired) continue;
        add(all.sig.get(name)!, fwd); add(yr.sig.get(name)!, fwd);
      }
    }
    if ((i - WARMUP) % 100 === 0) process.stdout.write(`\r  evaluating ${days[i]}  (${i - WARMUP + 1}/${S_ - HORIZON - WARMUP})   `);
  }
  console.log('\n');

  // ── report ───────────────────────────────────────────────────────────────
  const years = [...byYear.keys()].filter((y) => y !== 'ALL').sort();
  const fmt = (c: Cell) => c.n === 0 ? '        —       '
    : `n=${String(c.n).padStart(6)} ${mean(c) >= 0 ? '+' : ''}${mean(c).toFixed(2)}% ${(100 * c.w / c.n).toFixed(0)}%w`;

  const all = byYear.get('ALL')!;
  console.log('═'.repeat(104));
  console.log(`WHOLE PERIOD   ${days[WARMUP]} .. ${days[S_ - HORIZON - 1]}   (${S_ - HORIZON - WARMUP} evaluated sessions)`);
  console.log('═'.repeat(104));
  console.log(`${'BASELINE (all eligible)'.padEnd(30)} ${fmt(all.base)}`);
  console.log('-'.repeat(104));
  console.log(`${'SIGNAL'.padEnd(30)} ${'FORWARD ' + HORIZON + 'd'.padEnd(16)}   ${'EDGE'.padStart(8)}  ${'t'.padStart(6)}  VERDICT`);
  console.log('-'.repeat(104));

  const rows = names.map((n) => ({ n, c: all.sig.get(n)!, t: welch(all.sig.get(n)!, all.base) }))
                    .sort((a, b) => (mean(b.c) || -99) - (mean(a.c) || -99));
  for (const r of rows) {
    if (r.c.n === 0) { console.log(`${r.n.padEnd(30)} ${fmt(r.c)}`); continue; }
    const edge = mean(r.c) - mean(all.base);
    // |t| > 3 is a deliberately strict bar: ~22 hypotheses are on trial here.
    const verdict = !isFinite(r.t) ? '' : Math.abs(r.t) > 3 ? (edge > 0 ? 'REAL EDGE' : 'REAL DRAG') : 'not distinguishable';
    console.log(`${r.n.padEnd(30)} ${fmt(r.c)}   ${(edge >= 0 ? '+' : '') + edge.toFixed(2)}%`.padEnd(72)
                + `${r.t.toFixed(1).padStart(6)}  ${verdict}`);
  }

  console.log(`\n${'═'.repeat(104)}\nPER YEAR — does it survive every regime?\n${'═'.repeat(104)}`);
  console.log(`${'SIGNAL'.padEnd(30)}` + years.map((y) => `${y} edge`.padStart(13)).join('') + '   YEARS+');
  console.log('-'.repeat(104));
  for (const r of rows) {
    if (r.c.n === 0) continue;
    let pos = 0, counted = 0;
    const cols = years.map((y) => {
      const b = byYear.get(y)!, sc = b.sig.get(r.n)!;
      if (sc.n < 30) return '   (thin)'.padStart(13);
      const e = mean(sc) - mean(b.base);
      counted++; if (e > 0) pos++;
      return `${(e >= 0 ? '+' : '') + e.toFixed(2)}%`.padStart(13);
    });
    console.log(`${r.n.padEnd(30)}${cols.join('')}   ${pos}/${counted}`);
  }
  console.log('\nEDGE = signal mean minus the baseline of every eligible name that same session.');
  console.log('t = Welch against that baseline. "(thin)" = fewer than 30 firings that year.\n');
}

main().catch((e) => {
  if (e instanceof NotEntitledError) { console.error(`\n${e.message}\n`); process.exit(2); }
  console.error(e); process.exit(1);
});

/* ── LONG-RUN RESULTS (run 2026-09-08 · 2023-08-30→2026-08-31 · 753 sessions ·
 *    point-in-time top-2000 · 1.51M observations · baseline +0.79%/53%w 5d fwd) ──
 *
 * NOTHING PASSED. Zero of 22 signals reached |t|>3; none is distinguishable
 * from baseline at the 5-day horizon.
 *
 *   vol_thrust_2.5x (LIVE)  edge −0.51%  t −1.4  1/4 years positive
 *     → rounds 1-2's promotion was a regime artifact of one month.
 *   prox_0_1 / new_high     edge −0.78% / −0.70%  0/4 years positive
 *     → 52w-high proximity shows NO 5-day edge here. This does not refute
 *       George & Hwang — theirs is a 6-12 MONTH effect; promoting it at a
 *       5-day horizon was a horizon mismatch. Short-term, highs mean chop.
 *   gap5 same/next day      edge +12.8%  t 1.3 — a 2023 outlier artifact
 *     (+104% year edge, 49% win rate = a handful of moonshots), not signal.
 *   prox_15+ deep below     +0.71%, 4/4 years positive, t 0.8 — the only
 *     consistently positive row: a mild short-horizon reversal tilt. Watch,
 *     don't trade.
 *
 * ACTIONS TAKEN: volume_thrust demoted 54/58→46/48, breakout_watch demoted
 * 54/58→48/50 with horizon-mismatch noted in prose, gap_continuation demoted
 * 52/58→48/52 (live cohort 0W-7L agrees). The lesson is now part of the lab:
 * two windows inside one month can promote noise; 753 sessions took it back.
 */
