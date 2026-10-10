/**
 * MODEL VALIDATION HARNESS — SR 11-7-style validation of the QuantEdge models.
 *
 *   npx tsx research/model-validation.ts   → research/validation-results.json
 *
 * Pillars:
 *   A. Conceptual soundness — mock tests of the real model code on synthetic
 *      inputs with known answers, including negative controls.
 *   B. Outcomes analysis — every resolved idea in the database: hit rates,
 *      expectancy in R, by producer; discrimination of the conviction score.
 *   C. Benchmarking — each idea vs its own random-walk break-even rate
 *      (gambler's-ruin: P(target first) = risk / (risk + reward)); detector
 *      forward returns vs the whole liquid universe (walk-forward).
 *   D. Stability — chronological split (in-sample vs out-of-sample).
 *   E. Live paper book — realized P&L, win rate, profit factor, drawdown.
 */
import 'dotenv/config';
import fs from 'fs';
import pg from 'pg';
import { normCdf } from '../server/contract-picker';
import { detectBottomReversal } from '../server/bottom-reversal-scanner';
import { detectIndexPullback } from '../server/index-swing-scanner';
import { evaluateShortDiscipline } from '../server/short-discipline';
import { LEVERAGED_INVERSE_ETFS } from '../server/trade-idea-ingestion';
import { warmLiquidUniverse, loadLiquidUniverseFromDisk, getUniverseBars, type UBar } from '../server/liquid-universe';

type Test = { id: string; group: string; name: string; expected: string; actual: string; pass: boolean };
const tests: Test[] = [];
const t = (id: string, group: string, name: string, expected: string, actual: string, pass: boolean) =>
  tests.push({ id, group, name, expected, actual, pass });

// ── synthetic bar builders ───────────────────────────────────────────────
const DAY = 86400;
function barsFrom(closes: number[], opts: { vol?: number; wick?: number } = {}): UBar[] {
  const t0 = Math.floor(Date.UTC(2026, 0, 2) / 1000);
  return closes.map((c, i) => {
    const prev = i ? closes[i - 1] : c;
    const w = (opts.wick ?? 0.006) * c;
    return { time: t0 + i * DAY, open: prev, high: Math.max(prev, c) + w, low: Math.min(prev, c) - w, close: c, volume: opts.vol ?? 1e6 };
  });
}
const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

// ════════════════════════════════════════════════════════════════════════
// A. CONCEPTUAL SOUNDNESS — mock tests
// ════════════════════════════════════════════════════════════════════════
function mockTests() {
  // A1 probability math
  const cases: Array<[number, number]> = [[0, 0.5], [1, 0.8413], [1.96, 0.975], [-1.645, 0.05], [3, 0.99865]];
  const maxErr = Math.max(...cases.map(([x, y]) => Math.abs(normCdf(x) - y)));
  t('A1', 'Probability math', 'Normal CDF vs published table values (5 points)', 'max error < 1e-4', `max error ${maxErr.toExponential(2)}`, maxErr < 1e-4);
  const sym = Math.abs(normCdf(1.3) + normCdf(-1.3) - 1);
  t('A2', 'Probability math', 'CDF symmetry Φ(x)+Φ(−x)=1', '< 1e-7', sym.toExponential(2), sym < 1e-7);
  // expected move: spot 100, IV 40%, 9 DTE → 100*0.4*sqrt(9/365) = 6.281
  const em = 100 * 0.4 * Math.sqrt(9 / 365);
  t('A3', 'Probability math', 'Expected move 1σ (spot 100, IV 40%, 9 DTE)', '$6.28', `$${em.toFixed(2)}`, Math.abs(em - 6.281) < 0.01);
  const touch = Math.min(1, 2 * (1 - normCdf(1)));
  t('A4', 'Probability math', 'Driftless touch odds at 1σ (reflection principle)', '≈ 31.7%', `${(touch * 100).toFixed(1)}%`, Math.abs(touch - 0.3173) < 0.002);

  // A5-A9 bottom-reversal detector
  const pre = linspace(100, 100, 25);
  const vShape = [...pre, ...linspace(100, 80, 8), ...linspace(81.5, 92, 4)]; // sharp drop, fast recovery
  const v = detectBottomReversal('SYNV', barsFrom(vShape, { vol: 1e6 }));
  t('A5', 'Bottom-reversal detector', 'Planted V-recovery (−20% then 55% retrace in 4 sessions)', 'fires as v_recovery', v ? v.pattern : 'no fire', v?.pattern === 'v_recovery');
  // A5b: a V that recovers over more sessions keeps the 3-session stop within the 10% risk cap.
  const vSlow = [...pre, ...linspace(100, 86, 7), 87.6, 89.0, 90.3, 91.8, 93.6];
  const vs = detectBottomReversal('SYNV2', barsFrom(vSlow, { wick: 0.003 }));
  t('A5b', 'Bottom-reversal detector', 'Planted V-recovery, moderate pace (−14% then 54% retrace over 5 sessions)', 'fires as v_recovery', vs ? vs.pattern : 'no fire', vs?.pattern === 'v_recovery');
  const base = [...pre, ...linspace(100, 84, 6), 85.5, 86.2, 86.0, 86.8, 87.1, 87.6, 87.4, 88.2, 88.6];
  const hl = detectBottomReversal('SYNB', barsFrom(base, { wick: 0.002 }));
  t('A6', 'Bottom-reversal detector', 'Planted higher-lows base (−16% then ascending floors)', 'fires as higher_lows_base', hl ? hl.pattern : 'no fire', hl?.pattern === 'higher_lows_base');
  const trend = linspace(60, 100, 45);
  const nt = detectBottomReversal('SYNT', barsFrom(trend));
  t('A7', 'Bottom-reversal detector', 'NEGATIVE CONTROL: steady uptrend, no bottom', 'no fire', nt ? nt.pattern : 'no fire', nt == null);
  const crash = [...pre, ...linspace(100, 60, 12)];
  const nc = detectBottomReversal('SYNC', barsFrom(crash));
  t('A8', 'Bottom-reversal detector', 'NEGATIVE CONTROL: ongoing crash, no recovery', 'no fire', nc ? nc.pattern : 'no fire', nc == null);
  if (v) {
    const ok = v.stop < v.lastClose && v.t1 > v.lastClose && v.t2 >= v.t1;
    t('A9', 'Bottom-reversal detector', 'Level ordering on a fired signal', 'stop < entry < T1 ≤ T2', `${v.stop.toFixed(2)} < ${v.lastClose.toFixed(2)} < ${v.t1} ≤ ${v.t2}`, ok);
    const rr = (v.t1 - v.lastClose) / (v.lastClose - v.stop);
    t('A10', 'Bottom-reversal detector', 'T1 is declared 2R', '2.00R ± 0.02', `${rr.toFixed(2)}R`, Math.abs(rr - 2) < 0.02);
  }

  // A11-A13 index pullback detector
  const upThenDip = [...linspace(90, 110, 58), 108.4, 107.6]; // rising 50d, ~2.2% off high
  const ip = detectIndexPullback('SYNI', barsFrom(upThenDip, { wick: 0.003 }));
  t('A11', 'Index-swing detector', 'Planted 2% pullback inside a rising trend', 'fires', ip ? `fires (${(ip.pullbackPct * 100).toFixed(1)}% pullback)` : 'no fire', ip != null);
  const down = linspace(110, 90, 60);
  const idn = detectIndexPullback('SYND', barsFrom(down));
  t('A12', 'Index-swing detector', 'NEGATIVE CONTROL: downtrend (no counter-trend longs)', 'no fire', idn ? 'fires' : 'no fire', idn == null);
  const atHigh = linspace(90, 110, 60);
  const ih = detectIndexPullback('SYNH', barsFrom(atHigh));
  t('A13', 'Index-swing detector', 'NEGATIVE CONTROL: at the high, no discount', 'no fire', ih ? 'fires' : 'no fire', ih == null);

  // A14-A17 discipline gates
  const s1 = evaluateShortDiscipline({ symbol: 'GOOG', direction: 'short', hasEventCatalyst: false });
  t('A14', 'Discipline gates', 'Short with measured evidence, no news event (policy 2026-09-24)', 'allowed', s1.allowed ? 'allowed' : `blocked: ${s1.reason}`, s1.allowed);
  const s2 = evaluateShortDiscipline({ symbol: 'MSTR', direction: 'short', hasEventCatalyst: true, btcChangePercent: 1.2 });
  t('A15', 'Discipline gates', 'BTC-proxy short while bitcoin is rising', 'blocked', s2.allowed ? 'allowed' : 'blocked', !s2.allowed);
  const s3 = evaluateShortDiscipline({ symbol: 'MSTR', direction: 'short', hasEventCatalyst: false, btcChangePercent: -2.4 });
  t('A16', 'Discipline gates', 'BTC-proxy short while bitcoin is falling', 'allowed', s3.allowed ? 'allowed' : 'blocked', s3.allowed);
  const lev = ['TQQQ', 'SOXL', 'UCO', 'SCO'].every((s) => LEVERAGED_INVERSE_ETFS.has(s)) && !['SPY', 'SMH', 'QQQ'].some((s) => LEVERAGED_INVERSE_ETFS.has(s));
  t('A17', 'Discipline gates', 'Leveraged/inverse wrappers blocked, sector ETFs allowed', 'TQQQ/SOXL/UCO/SCO blocked; SPY/SMH/QQQ allowed', lev ? 'as expected' : 'mismatch', lev);
}

// ════════════════════════════════════════════════════════════════════════
// B/C/D. OUTCOMES, BENCHMARKS, STABILITY
// ════════════════════════════════════════════════════════════════════════
interface Resolved { src: string; dir: 'long' | 'short'; entry: number; stop: number; target: number; exit: number | null; outcome: string; conv: number | null; conf: number | null; ts: string }

function mean(a: number[]) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function sd(a: number[]) { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) : NaN; }
function spearman(x: number[], y: number[]) {
  const rank = (a: number[]) => { const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); idx.forEach(([, i], k) => (r[i] = k + 1)); return r; };
  const rx = rank(x), ry = rank(y); const mx = mean(rx), my = mean(ry);
  const num = rx.reduce((s, v, i) => s + (v - mx) * (ry[i] - my), 0);
  const den = Math.sqrt(rx.reduce((s, v) => s + (v - mx) ** 2, 0) * ry.reduce((s, v) => s + (v - my) ** 2, 0));
  return den ? num / den : NaN;
}
function auc(pos: number[], neg: number[]) {
  let s = 0; for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return pos.length && neg.length ? s / (pos.length * neg.length) : NaN;
}

function rOf(x: Resolved): number | null {
  const risk = Math.abs(x.entry - x.stop);
  if (!(risk > 0)) return null;
  const sgn = x.dir === 'long' ? 1 : -1;
  if (x.exit != null && x.exit > 0) return (sgn * (x.exit - x.entry)) / risk;
  if (x.outcome === 'hit_target') return Math.abs(x.target - x.entry) / risk;
  if (x.outcome === 'hit_stop') return -1;
  return null;
}

function summarize(rows: Resolved[]) {
  const decided = rows.filter((r) => r.outcome === 'hit_target' || r.outcome === 'hit_stop');
  const wins = decided.filter((r) => r.outcome === 'hit_target').length;
  const rs = rows.map(rOf).filter((v): v is number => v != null && Number.isFinite(v)).map((v) => Math.max(-3, Math.min(6, v)));
  // Random-walk break-even for each decided idea: P(target first) = risk/(risk+reward)
  const be = decided.map((r) => { const risk = Math.abs(r.entry - r.stop), rew = Math.abs(r.target - r.entry); return risk / (risk + rew); });
  const expectedWins = be.reduce((a, b) => a + b, 0);
  const varW = be.reduce((a, p) => a + p * (1 - p), 0);
  const z = varW > 0 ? (wins - expectedWins) / Math.sqrt(varW) : NaN;
  const m = mean(rs), s = sd(rs);
  return {
    n: rows.length, decided: decided.length, wins, stops: decided.length - wins,
    expired: rows.filter((r) => r.outcome === 'expired').length,
    hitRate: decided.length ? wins / decided.length : NaN,
    breakEvenRate: decided.length ? expectedWins / decided.length : NaN,
    zVsRandomWalk: z,
    expectancyR: m, sdR: s, nR: rs.length,
    tStat: rs.length > 1 ? m / (s / Math.sqrt(rs.length)) : NaN,
    profitFactor: (() => { const g = rs.filter((v) => v > 0).reduce((a, b) => a + b, 0); const l = -rs.filter((v) => v < 0).reduce((a, b) => a + b, 0); return l > 0 ? g / l : NaN; })(),
  };
}

async function outcomes(client: pg.Client) {
  const { rows } = await client.query(`SELECT source, direction, entry_price, stop_loss, target_price, exit_price, outcome_status, gen_conviction_score, confidence_score, timestamp
    FROM trade_ideas WHERE outcome_status IN ('hit_target','hit_stop','expired') AND entry_price > 0 AND stop_loss > 0 AND target_price > 0 ORDER BY timestamp`);
  const data: Resolved[] = rows.map((r: any) => ({
    src: r.source, dir: /short|bear/i.test(r.direction) ? 'short' : 'long',
    entry: +r.entry_price, stop: +r.stop_loss, target: +r.target_price, exit: r.exit_price != null ? +r.exit_price : null,
    outcome: r.outcome_status, conv: r.gen_conviction_score != null ? +r.gen_conviction_score : null,
    conf: r.confidence_score != null ? +r.confidence_score : null, ts: r.timestamp,
  })).filter((r) => r.entry > 0 && Math.abs(r.entry - r.stop) / r.entry < 0.5 && Math.abs(r.target - r.entry) / r.entry < 1);

  const overall = summarize(data);
  const bySource: Record<string, any> = {};
  for (const s of Array.from(new Set(data.map((d) => d.src)))) {
    const sub = data.filter((d) => d.src === s);
    if (sub.length >= 10) bySource[s] = summarize(sub);
  }
  const byDir = { long: summarize(data.filter((d) => d.dir === 'long')), short: summarize(data.filter((d) => d.dir === 'short')) };

  // Discrimination of the conviction score
  const scored = data.filter((d) => d.conv != null && rOf(d) != null);
  const rho = spearman(scored.map((d) => d.conv!), scored.map((d) => rOf(d)!));
  const decidedScored = scored.filter((d) => d.outcome !== 'expired');
  const aucConv = auc(decidedScored.filter((d) => d.outcome === 'hit_target').map((d) => d.conv!), decidedScored.filter((d) => d.outcome === 'hit_stop').map((d) => d.conv!));
  const sorted = [...scored].sort((a, b) => a.conv! - b.conv!);
  const q = 5; const quint: any[] = [];
  for (let i = 0; i < q; i++) {
    const sl = sorted.slice(Math.floor((i * sorted.length) / q), Math.floor(((i + 1) * sorted.length) / q));
    const rs = sl.map((d) => rOf(d)!).map((v) => Math.max(-3, Math.min(6, v)));
    quint.push({ bucket: `Q${i + 1}`, scoreRange: sl.length ? `${sl[0].conv}–${sl[sl.length - 1].conv}` : '', n: sl.length, expectancyR: mean(rs) });
  }
  // Calibration of the stored confidence (does a '70' win 70%?)
  const calib: any[] = [];
  for (const [lo, hi] of [[0, 60], [60, 70], [70, 80], [80, 101]]) {
    const sub = data.filter((d) => d.conf != null && d.conf >= lo && d.conf < hi && d.outcome !== 'expired');
    if (!sub.length) continue;
    calib.push({ band: `${lo}–${hi === 101 ? 100 : hi}`, n: sub.length, meanConfidence: mean(sub.map((d) => d.conf!)) / 100, realizedHitRate: sub.filter((d) => d.outcome === 'hit_target').length / sub.length });
  }
  // Stability: chronological halves
  const half = Math.floor(data.length / 2);
  const stability = { firstHalf: summarize(data.slice(0, half)), secondHalf: summarize(data.slice(half)), splitAt: data[half]?.ts };
  return { overall, bySource, byDir, discrimination: { n: scored.length, spearmanRho: rho, aucTargetVsStop: aucConv, quintiles: quint }, calibration: calib, stability, window: { from: data[0]?.ts, to: data[data.length - 1]?.ts } };
}

// Detector benchmark: bottom-reversal fires vs universe, walk-forward
async function detectorBenchmark() {
  await loadLiquidUniverseFromDisk().catch(() => {});
  await warmLiquidUniverse();
  const bars = await getUniverseBars(110);
  const H = 10;
  const fireRets: number[] = [], univRets: number[] = [];
  let fires = 0;
  for (const [sym, series] of bars.entries()) {
    if (series.length < 60) continue;
    for (let cut = 45; cut <= series.length - H; cut += 3) {
      const entry = series[cut - 1].close, fwd = series[cut - 1 + H].close;
      const ret = fwd / entry - 1;
      if (!Number.isFinite(ret)) continue;
      univRets.push(ret);
      const hit = detectBottomReversal(sym, series.slice(0, cut));
      if (hit && hit.score >= 70) { fires++; fireRets.push(ret); }
    }
  }
  const hitPos = (a: number[]) => a.filter((v) => v > 0).length / a.length;
  const m1 = mean(fireRets), m0 = mean(univRets);
  const se = Math.sqrt(sd(fireRets) ** 2 / fireRets.length + sd(univRets) ** 2 / univRets.length);
  return { horizonSessions: H, universeSamples: univRets.length, fires, fireMeanRet: m1, universeMeanRet: m0, excess: m1 - m0, tStat: (m1 - m0) / se, fireHitPositive: hitPos(fireRets), universeHitPositive: hitPos(univRets), fireMedian: [...fireRets].sort((a, b) => a - b)[Math.floor(fireRets.length / 2)] };
}

async function paperBook(client: pg.Client) {
  const { rows } = await client.query(`SELECT realized_pnl, exit_time, entry_time FROM paper_positions WHERE status='closed' AND realized_pnl IS NOT NULL ORDER BY exit_time`);
  const p = rows.map((r: any) => +r.realized_pnl);
  let eq = 0, peak = 0, dd = 0; const curve: number[] = [];
  for (const v of p) { eq += v; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); curve.push(eq); }
  const g = p.filter((v) => v > 0).reduce((a, b) => a + b, 0), l = -p.filter((v) => v < 0).reduce((a, b) => a + b, 0);
  return { trades: p.length, net: eq, winRate: p.filter((v) => v > 0).length / p.length, avgWin: g / Math.max(1, p.filter((v) => v > 0).length), avgLoss: -l / Math.max(1, p.filter((v) => v < 0).length), profitFactor: l > 0 ? g / l : NaN, maxDrawdown: dd, curve };
}

(async () => {
  const started = new Date().toISOString();
  mockTests();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const out = await outcomes(client);
  const book = await paperBook(client);
  await client.end();
  const det = await detectorBenchmark();
  const res = { generatedAt: started, mockTests: tests, outcomes: out, detectorBenchmark: det, paperBook: book };
  fs.writeFileSync('research/validation-results.json', JSON.stringify(res, null, 2));
  const pass = tests.filter((x) => x.pass).length;
  console.log(`MOCK: ${pass}/${tests.length} passed`);
  for (const x of tests.filter((y) => !y.pass)) console.log(`  FAIL ${x.id} ${x.name}: expected ${x.expected}, got ${x.actual}`);
  console.log('OVERALL:', JSON.stringify(out.overall));
  console.log('DISCRIM:', JSON.stringify(out.discrimination));
  console.log('DETECTOR:', JSON.stringify(det));
  console.log('BOOK:', JSON.stringify({ ...book, curve: undefined }));
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
