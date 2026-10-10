/**
 * ACCURACY ATTRIBUTION — reverse-engineer why the platform's hit rate is what
 * it is. Companion to model-validation.ts (which measures *whether* there is
 * edge); this measures *where* edge is won and lost.
 *
 *   1. Data integrity    — does the stored excursion agree with the stored outcome?
 *   2. Excursions        — MFE / MAE in R: were the entries right and the exits wrong?
 *   3. Geometry          — realized hit rate vs each idea's own break-even, binned
 *   4. Exit counterfactual — walk-forward: choose target/stop on the first half,
 *                          score it on the second half (never on the data that chose it)
 *   5. Attribution       — every conviction layer, quality tag and feature vs outcome:
 *                          Spearman IC, bootstrap 95% CI, Benjamini–Hochberg FDR
 *   6. Uncertainty       — bootstrap CIs on expectancy, probabilistic Sharpe, power analysis
 *
 * Run: npx tsx research/accuracy-attribution.ts   → research/attribution-results.json
 */
import fs from 'fs';
import pg from 'pg';

interface Row {
  src: string; dir: 'long' | 'short'; hp: string; asset: string;
  entry: number; stop: number; target: number; exit: number | null;
  hi: number | null; lo: number | null;
  outcome: 'hit_target' | 'hit_stop' | 'expired';
  conv: number | null; conf: number | null; iv: number | null; dte: number | null;
  layers: Array<{ kind: string; points: number }> | null;
  tags: string[];
  ts: Date; exitTs: Date | null;
  reason: string; notes: string;
}

// ── stats ────────────────────────────────────────────────────────────────
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function normCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
const pTwo = (z: number) => 2 * (1 - normCdf(Math.abs(z)));
function ranks(a: number[]) {
  const idx = a.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; }
  return r as number[];
}
function pearson(x: number[], y: number[]) {
  const mx = mean(x), my = mean(y); let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return dx > 0 && dy > 0 ? n / Math.sqrt(dx * dy) : 0;
}
const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y));
// Seeded RNG so every run reproduces the same bootstrap.
let seed = 42; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function bootCI(n: number, stat: (idx: number[]) => number, B = 2000): [number, number] {
  const out: number[] = [];
  for (let b = 0; b < B; b++) { const idx = Array.from({ length: n }, () => Math.floor(rnd() * n)); const v = stat(idx); if (Number.isFinite(v)) out.push(v); }
  out.sort((a, b) => a - b);
  return [out[Math.floor(0.025 * out.length)], out[Math.floor(0.975 * out.length)]];
}
function bh(ps: number[]) { // Benjamini–Hochberg q-values
  const m = ps.length; const o = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const q = new Array(m); let prev = 1;
  for (let k = m - 1; k >= 0; k--) { prev = Math.min(prev, (o[k][0] * m) / (k + 1)); q[o[k][1]] = prev; }
  return q as number[];
}

// ── R-space helpers ──────────────────────────────────────────────────────
const risk = (r: Row) => Math.abs(r.entry - r.stop);
const rewardR = (r: Row) => Math.abs(r.target - r.entry) / risk(r);
const sgn = (r: Row) => (r.dir === 'long' ? 1 : -1);
function realizedR(r: Row): number | null {
  if (r.exit != null && r.exit > 0) return Math.max(-3, Math.min(6, (sgn(r) * (r.exit - r.entry)) / risk(r)));
  if (r.outcome === 'hit_target') return rewardR(r);
  if (r.outcome === 'hit_stop') return -1;
  return null;
}
const mfeR = (r: Row) => r.hi == null || r.lo == null ? null : (r.dir === 'long' ? r.hi - r.entry : r.entry - r.lo) / risk(r);
const maeR = (r: Row) => r.hi == null || r.lo == null ? null : (r.dir === 'long' ? r.entry - r.lo : r.hi - r.entry) / risk(r);

async function load(): Promise<Row[]> {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const { rows } = await c.query(`SELECT source, direction, holding_period, asset_type, entry_price, stop_loss, target_price, exit_price,
      highest_price_reached, lowest_price_reached, outcome_status, gen_conviction_score, confidence_score, option_iv, option_dte,
      gen_scoring_layers, quality_signals, timestamp, exit_date, resolution_reason, outcome_notes
    FROM trade_ideas WHERE outcome_status IN ('hit_target','hit_stop','expired') AND entry_price > 0 AND stop_loss > 0 AND target_price > 0
    ORDER BY timestamp`);
  await c.end();
  const num = (v: any) => (v == null || v === '' ? null : Number(v));
  return rows.map((r: any): Row => ({
    src: r.source ?? 'unknown', dir: /short|bear/i.test(r.direction) ? 'short' : 'long',
    hp: r.holding_period ?? 'unknown', asset: r.asset_type ?? 'unknown',
    entry: +r.entry_price, stop: +r.stop_loss, target: +r.target_price, exit: num(r.exit_price),
    hi: num(r.highest_price_reached), lo: num(r.lowest_price_reached), outcome: r.outcome_status,
    conv: num(r.gen_conviction_score), conf: num(r.confidence_score), iv: num(r.option_iv), dte: num(r.option_dte),
    layers: Array.isArray(r.gen_scoring_layers) ? r.gen_scoring_layers : null,
    tags: Array.isArray(r.quality_signals) ? r.quality_signals.map(String) : [],
    ts: new Date(r.timestamp), exitTs: r.exit_date ? new Date(r.exit_date) : null,
    reason: r.resolution_reason ?? '', notes: r.outcome_notes ?? '',
  })).filter((r) => {
    const rk = risk(r) / r.entry;
    // Same validity screen as model-validation.ts; also the stop and target must sit on the correct sides.
    const sidesOk = r.dir === 'long' ? r.stop < r.entry && r.target > r.entry : r.stop > r.entry && r.target < r.entry;
    return rk > 0 && rk < 0.5 && Math.abs(r.target - r.entry) / r.entry < 1 && sidesOk;
  });
}

// ── 1. integrity ─────────────────────────────────────────────────────────
function integrity(rows: Row[]) {
  const withX = rows.filter((r) => mfeR(r) != null);
  // A 'hit_target' idea must show MFE ≥ its target distance; a 'hit_stop' must show MAE ≥ 1R.
  const tgt = withX.filter((r) => r.outcome === 'hit_target');
  const stp = withX.filter((r) => r.outcome === 'hit_stop');
  const tol = 0.98;
  const badT = tgt.filter((r) => mfeR(r)! < rewardR(r) * tol);
  const badS = stp.filter((r) => maeR(r)! < tol);
  // An 'expired' idea whose excursion crossed its target (or stop) was mis-resolved.
  const exp = withX.filter((r) => r.outcome === 'expired');
  const expCrossT = exp.filter((r) => mfeR(r)! >= rewardR(r));
  const expCrossS = exp.filter((r) => maeR(r)! >= 1);
  return {
    withExcursion: withX.length, of: rows.length,
    targetsConsistent: tgt.length - badT.length, targets: tgt.length,
    stopsConsistent: stp.length - badS.length, stops: stp.length,
    expiredThatCrossedTarget: expCrossT.length, expiredThatCrossedStop: expCrossS.length, expired: exp.length,
    badTargetExamples: badT.slice(0, 4).map((r) => ({ src: r.src, entry: r.entry, target: r.target, hi: r.hi, lo: r.lo, dir: r.dir })),
    badStopExamples: badS.slice(0, 4).map((r) => ({ src: r.src, entry: r.entry, stop: r.stop, hi: r.hi, lo: r.lo, dir: r.dir })),
  };
}

// ── 2. excursions ────────────────────────────────────────────────────────
function excursions(rows: Row[]) {
  const x = rows.filter((r) => mfeR(r) != null);
  const q = (a: number[], p: number) => { const s = [...a].sort((u, v) => u - v); return s[Math.floor(p * (s.length - 1))]; };
  const group = (sub: Row[]) => {
    const mfe = sub.map((r) => mfeR(r)!), mae = sub.map((r) => maeR(r)!);
    return {
      n: sub.length,
      mfeMedian: q(mfe, 0.5), mfeP75: q(mfe, 0.75), maeMedian: q(mae, 0.5),
      reached05R: mfe.filter((v) => v >= 0.5).length / sub.length,
      reached1R: mfe.filter((v) => v >= 1).length / sub.length,
      medianTargetR: q(sub.map(rewardR), 0.5),
    };
  };
  const stops = x.filter((r) => r.outcome === 'hit_stop');
  const expired = x.filter((r) => r.outcome === 'expired');
  // MFE histogram for all ideas (0.25R bins to 3R)
  const bins = Array.from({ length: 13 }, (_, i) => i * 0.25);
  const hist = bins.map((b, i) => ({ from: b, n: x.filter((r) => { const m = Math.max(0, mfeR(r)!); return i === bins.length - 1 ? m >= b : m >= b && m < b + 0.25; }).length }));
  return {
    all: group(x), stops: group(stops), expired: group(expired), targets: group(x.filter((r) => r.outcome === 'hit_target')),
    stopsThatWereUp1RFirst: stops.filter((r) => mfeR(r)! >= 1).length,
    stopsThatWereUpHalfRFirst: stops.filter((r) => mfeR(r)! >= 0.5).length,
    expiredWithin80pctOfTarget: expired.filter((r) => mfeR(r)! >= 0.8 * rewardR(r)).length,
    mfeHistogram: hist,
  };
}

// ── 3. geometry: realized vs break-even, binned ──────────────────────────
function geometry(rows: Row[]) {
  const d = rows.filter((r) => r.outcome !== 'expired');
  const edges = [0, 0.2, 0.3, 0.4, 0.5, 1.01];
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    const sub = d.filter((r) => { const p = 1 / (1 + rewardR(r)); return p >= lo && p < hi; });
    const wins = sub.filter((r) => r.outcome === 'hit_target').length;
    const pBar = mean(sub.map((r) => 1 / (1 + rewardR(r))));
    const v = sub.reduce((s, r) => { const p = 1 / (1 + rewardR(r)); return s + p * (1 - p); }, 0);
    return { band: `${Math.round(lo * 100)}–${Math.round(Math.min(1, hi) * 100)}%`, n: sub.length, breakEven: pBar, realized: sub.length ? wins / sub.length : NaN, z: v > 0 ? (wins - pBar * sub.length) / Math.sqrt(v) : NaN, medianRewardR: sub.length ? [...sub.map(rewardR)].sort((a, b) => a - b)[Math.floor(sub.length / 2)] : NaN };
  }).filter((b) => b.n > 0);
}

// ── 4. exit counterfactual, walk-forward ─────────────────────────────────
// With only the path extremes stored, a path that touched both levels is
// ambiguous (order unknown). We score it both ways and report the bound; the
// *pessimistic* bound (stop first) is the one used to choose.
function exitGrid(rows: Row[]) {
  const x = rows.filter((r) => mfeR(r) != null);
  const Ks = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];
  const Ss = [0.5, 0.75, 1];
  const score = (sub: Row[], k: number, s: number) => {
    let lo = 0, hi = 0, amb = 0;
    for (const r of sub) {
      const up = mfeR(r)! >= k, dn = maeR(r)! >= s;
      if (up && !dn) { lo += k; hi += k; }
      else if (dn && !up) { lo -= s; hi -= s; }
      else if (up && dn) { lo -= s; hi += k; amb++; }
      else { const rr = realizedR(r); const v = rr == null ? 0 : Math.max(-s, Math.min(k, rr)); lo += v; hi += v; }
    }
    return { pessimistic: lo / sub.length, optimistic: hi / sub.length, ambiguousShare: amb / sub.length };
  };
  const grid: any[] = [];
  for (const s of Ss) for (const k of Ks) grid.push({ stopR: s, targetR: k, ...score(x, k, s) });
  const half = Math.floor(x.length / 2);
  const train = x.slice(0, half), test = x.slice(half);
  let best = { k: 1, s: 1, v: -Infinity };
  for (const s of Ss) for (const k of Ks) { const v = score(train, k, s).pessimistic; if (v > best.v) best = { k, s, v }; }
  const asPublished = (sub: Row[]) => mean(sub.map((r) => realizedR(r) ?? 0));
  return {
    n: x.length, grid,
    walkForward: {
      chosenOnFirstHalf: { targetR: best.k, stopR: best.s, trainPessimistic: best.v },
      testPessimistic: score(test, best.k, best.s).pessimistic,
      testOptimistic: score(test, best.k, best.s).optimistic,
      testAsPublished: asPublished(test),
      testN: test.length,
    },
  };
}

// ── 5. attribution ───────────────────────────────────────────────────────
interface Feat { name: string; group: string; get: (r: Row) => number | null }
function attribution(rows: Row[]) {
  const layerKinds = Array.from(new Set(rows.flatMap((r) => (r.layers ?? []).map((l) => l.kind))));
  const etHour = (d: Date) => Number(d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
  const feats: Feat[] = [
    ...layerKinds.map((k): Feat => ({ name: `layer: ${k}`, group: 'Conviction layer', get: (r) => (r.layers ? r.layers.filter((l) => l.kind === k).reduce((s, l) => s + (+l.points || 0), 0) : null) })),
    { name: 'conviction total', group: 'Score', get: (r) => r.conv },
    { name: 'stated confidence', group: 'Score', get: (r) => r.conf },
    { name: 'reward:risk (target R)', group: 'Geometry', get: (r) => rewardR(r) },
    { name: 'stop distance %', group: 'Geometry', get: (r) => (risk(r) / r.entry) * 100 },
    { name: 'target distance %', group: 'Geometry', get: (r) => (Math.abs(r.target - r.entry) / r.entry) * 100 },
    { name: 'hour published (ET)', group: 'Timing', get: (r) => etHour(r.ts) },
    { name: 'option IV', group: 'Option', get: (r) => r.iv },
    { name: 'option DTE', group: 'Option', get: (r) => r.dte },
    { name: 'short side (1) vs long (0)', group: 'Side', get: (r) => (r.dir === 'short' ? 1 : 0) },
    { name: 'day trade (1) vs longer (0)', group: 'Horizon', get: (r) => (r.hp === 'day' ? 1 : 0) },
  ];
  // Quality tags as binary features (normalised: strip $numbers so "$770 Strike key level" pools)
  const norm = (t: string) => t.replace(/\$?\d[\d,.]*/g, '#').replace(/\s+/g, ' ').trim();
  const tagCount = new Map<string, number>();
  for (const r of rows) for (const t of new Set(r.tags.map(norm))) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  for (const [t, c] of tagCount) if (c >= 25 && c <= rows.length - 25) feats.push({ name: `tag: ${t}`, group: 'Quality tag', get: (r) => (r.tags.map(norm).includes(t) ? 1 : 0) });

  const out = feats.map((f) => {
    const sub = rows.map((r) => ({ x: f.get(r), y: realizedR(r), r })).filter((o) => o.x != null && Number.isFinite(o.x) && o.y != null) as Array<{ x: number; y: number; r: Row }>;
    if (sub.length < 30 || new Set(sub.map((o) => o.x)).size < 2) return null;
    const xs = sub.map((o) => o.x), ys = sub.map((o) => o.y);
    const ic = spearman(xs, ys);
    const z = ic * Math.sqrt(sub.length - 1);
    const ci = bootCI(sub.length, (idx) => spearman(idx.map((i) => xs[i]), idx.map((i) => ys[i])), 800);
    const binary = new Set(xs).size === 2;
    const extra = binary ? (() => { const a = sub.filter((o) => o.x === 1).map((o) => o.y), b = sub.filter((o) => o.x === 0).map((o) => o.y); return { withN: a.length, withR: mean(a), withoutR: mean(b) }; })() : {};
    return { feature: f.name, group: f.group, n: sub.length, ic, ci, p: pTwo(z), ...extra };
  }).filter(Boolean) as any[];
  const q = bh(out.map((o) => o.p));
  out.forEach((o, i) => { o.q = q[i]; });
  return out.sort((a, b) => a.p - b.p);
}

// ── 6. uncertainty ───────────────────────────────────────────────────────
function uncertainty(rows: Row[]) {
  const bySrc: any[] = [];
  for (const s of Array.from(new Set(rows.map((r) => r.src)))) {
    const rs = rows.filter((r) => r.src === s).map(realizedR).filter((v): v is number => v != null);
    if (rs.length < 20) continue;
    bySrc.push({ source: s, n: rs.length, expectancyR: mean(rs), ci: bootCI(rs.length, (idx) => mean(idx.map((i) => rs[i]))) });
  }
  const all = rows.map(realizedR).filter((v): v is number => v != null);
  // Probabilistic Sharpe (Bailey & López de Prado): P(true per-trade SR > 0)
  const m = mean(all), s = sd(all), n = all.length, sr = m / s;
  const sk = mean(all.map((v) => ((v - m) / s) ** 3)), ku = mean(all.map((v) => ((v - m) / s) ** 4));
  const psr = normCdf((sr * Math.sqrt(n - 1)) / Math.sqrt(1 - sk * sr + ((ku - 1) / 4) * sr * sr));
  // Power: trades needed to detect an edge of e R (two-sided 5%, 80% power) at this dispersion
  const need = (e: number) => Math.ceil(((1.96 + 0.8416) * s / e) ** 2);
  return {
    bySource: bySrc, overall: { n, expectancyR: m, sdR: s, perTradeSharpe: sr, skew: sk, kurtosis: ku, probabilisticSharpe: psr, ci: bootCI(n, (idx) => mean(idx.map((i) => all[i]))) },
    power: [0.05, 0.1, 0.2, 0.3].map((e) => ({ edgeR: e, tradesNeeded: need(e) })),
  };
}

function resolutionTime(rows: Row[]) {
  const hrs = (r: Row) => (r.exitTs ? (r.exitTs.getTime() - r.ts.getTime()) / 3.6e6 : null);
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const g = (o: Row['outcome']) => rows.filter((r) => r.outcome === o).map(hrs).filter((v): v is number => v != null && v >= 0);
  return { targetMedianHours: med(g('hit_target')), stopMedianHours: med(g('hit_stop')), expiredMedianHours: med(g('expired')), nTarget: g('hit_target').length, nStop: g('hit_stop').length };
}

// ── 0. record reconstruction ─────────────────────────────────────────────
// The recorded book and the true book differ in three measurable ways:
//   - duplicate_collapsed rows are restatements of an idea already on the book,
//     not independent ideas — counting them as 0R trades dilutes every number;
//   - gex_scanner rows reopened for a premium-vs-underlying unit mismatch carry
//     excursions in a different unit from their levels — unusable;
//   - 'expired' ideas whose stored path crossed exactly one barrier resolved in
//     fact; they are re-scored at that barrier (both crossed = order unknown,
//     left expired and counted in the ambiguity figure).
function reconstruct(raw: Row[]) {
  const dup = raw.filter((r) => r.reason === 'duplicate_collapsed');
  const unit = raw.filter((r) => /unit mismatch/i.test(r.notes));
  const kept = raw.filter((r) => r.reason !== 'duplicate_collapsed' && !/unit mismatch/i.test(r.notes));
  let toStop = 0, toTarget = 0, ambiguous = 0;
  const rebuilt = kept.map((r): Row => {
    if (r.outcome !== 'expired' || mfeR(r) == null) return r;
    const t = mfeR(r)! >= rewardR(r), s = maeR(r)! >= 1;
    if (t && s) { ambiguous++; return r; }
    if (s) { toStop++; return { ...r, outcome: 'hit_stop', exit: r.stop }; }
    if (t) { toTarget++; return { ...r, outcome: 'hit_target', exit: r.target }; }
    return r;
  });
  return { rebuilt, audit: { raw: raw.length, duplicatesRemoved: dup.length, unitMismatchRemoved: unit.length, expiredRescoredToStop: toStop, expiredRescoredToTarget: toTarget, expiredBothCrossedAmbiguous: ambiguous, kept: rebuilt.length } };
}
function bookStats(rows: Row[]) {
  const dec = rows.filter((r) => r.outcome !== 'expired');
  const w = dec.filter((r) => r.outcome === 'hit_target').length;
  const rs = rows.map(realizedR).filter((v): v is number => v != null);
  const be = dec.reduce((a, r) => a + 1 / (1 + rewardR(r)), 0);
  const v = dec.reduce((a, r) => { const p = 1 / (1 + rewardR(r)); return a + p * (1 - p); }, 0);
  return { n: rows.length, decided: dec.length, hitRate: w / Math.max(1, dec.length), breakEven: be / Math.max(1, dec.length), z: v > 0 ? (w - be) / Math.sqrt(v) : NaN, expectancyR: mean(rs), nR: rs.length, t: mean(rs) / (sd(rs) / Math.sqrt(rs.length)) };
}

(async () => {
  const raw = await load();
  const { rebuilt: rows, audit } = reconstruct(raw);
  const bySrcBooks: any = {};
  for (const s of Array.from(new Set(raw.map((r) => r.src)))) {
    const a = raw.filter((r) => r.src === s), b = rows.filter((r) => r.src === s);
    if (a.length >= 20) bySrcBooks[s] = { recorded: bookStats(a), reconstructed: bookStats(b) };
  }
  const record = { audit, recorded: bookStats(raw), reconstructed: bookStats(rows), bySource: bySrcBooks };
  const res = {
    generatedAt: new Date().toISOString(), n: rows.length, record,
    integrityRaw: integrity(raw),
    integrity: integrity(rows), excursions: excursions(rows), geometry: geometry(rows),
    exitCounterfactual: exitGrid(rows), attribution: attribution(rows), uncertainty: uncertainty(rows),
    resolutionTime: resolutionTime(rows),
  };
  fs.writeFileSync('research/attribution-results.json', JSON.stringify(res, null, 2));
  console.log(JSON.stringify({ ...res, attribution: res.attribution.slice(0, 14), exitCounterfactual: { ...res.exitCounterfactual, grid: undefined } }, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
