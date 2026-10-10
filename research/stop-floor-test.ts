/**
 * STOP-FLOOR COUNTERFACTUAL — test the #1 recommendation from the v2 report
 * (stop width is the strongest loss driver) BEFORE shipping it.
 *
 * For every resolved idea: ATR(14) from daily bars strictly before publication,
 * then the real 5-minute path from the publish minute (same rules as
 * path-replay.ts). Two interventions, each at floor k × ATR:
 *   A) WIDEN  — a stop tighter than k×ATR is moved out to k×ATR; target kept.
 *   B) REJECT — an idea whose stop is tighter than k×ATR is not published.
 * k is chosen on the first half (chronological) and scored ONLY on the second.
 * Expectancy is in R of the risk actually taken (constant dollar risk per trade).
 *
 * Run: npx tsx research/stop-floor-test.ts → research/stop-floor-results.json
 */
import fs from 'fs';
import pg from 'pg';

type Bar = { t: number; o: number; h: number; l: number; c: number };
const YSYM: Record<string, string> = { SPX: '^GSPC', NDX: '^NDX', RUT: '^RUT', VIX: '^VIX', XSP: '^XSP' };
const CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'DOGE', 'XRP']);
const cache = new Map<string, Promise<Bar[]>>();
function bars(symbol: string, interval: '5m' | '1d', days: number): Promise<Bar[]> {
  const ys = YSYM[symbol] ?? (CRYPTO.has(symbol) ? `${symbol}-USD` : symbol);
  const key = `${ys}:${interval}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const p2 = Math.floor(Date.now() / 1000), p1 = p2 - days * 86400;
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?period1=${p1}&period2=${p2}&interval=${interval}&includePrePost=false`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.status === 429) { await new Promise((s) => setTimeout(s, 2000 * (a + 1))); continue; }
        const j: any = await r.json(); const res = j?.chart?.result?.[0]; if (!res) return [];
        const q = res.indicators.quote[0];
        return (res.timestamp as number[]).map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter((b) => b.o != null && b.h != null && b.l != null && b.c != null);
      } catch { await new Promise((s) => setTimeout(s, 1000)); }
    }
    return [];
  })());
  return cache.get(key)!;
}
const etParts = (t: number) => {
  const s = new Date(t * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const [d, hm] = s.split(', '); const [h, m] = hm.split(':').map(Number); return { day: d, min: (h % 24) * 60 + m };
};
const rth = (b: Bar) => { const { min } = etParts(b.t); return min >= 570 && min < 960; };

interface Idea { id: string; src: string; sym: string; dir: 'long' | 'short'; hp: string; entry: number; stop: number; target: number; ts: Date; exitBy: Date | null }

function replay(i: Idea, path5: Bar[], stop: number): number | null {
  const start = i.ts.getTime() / 1000;
  const path = path5.filter((b) => b.t >= start && (CRYPTO.has(i.sym) || rth(b)));
  if (!path.length) return null;
  const sessions: string[] = [];
  for (const b of path) { const d = etParts(b.t).day; if (sessions[sessions.length - 1] !== d) sessions.push(d); }
  const nS = i.hp === 'day' ? 1 : i.hp === 'position' ? 20 : 10;
  const lastDay = sessions[Math.min(nS, sessions.length) - 1];
  let horizon = path.filter((b) => sessions.indexOf(etParts(b.t).day) <= sessions.indexOf(lastDay));
  if (i.exitBy) { const eb = i.exitBy.getTime() / 1000; const h2 = path.filter((b) => b.t <= eb); if (h2.length) horizon = h2; }
  const risk = Math.abs(i.entry - stop), L = i.dir === 'long';
  const R = (px: number) => ((L ? 1 : -1) * (px - i.entry)) / risk;
  for (const b of horizon) {
    const sh = L ? b.l <= stop : b.h >= stop, th = L ? b.h >= i.target : b.l <= i.target;
    if (sh) return Math.max(-3, R((L ? b.o <= stop : b.o >= stop) ? b.o : stop));
    if (th) return Math.min(6, R((L ? b.o >= i.target : b.o <= i.target) ? b.o : i.target));
  }
  return Math.max(-3, Math.min(6, R(horizon[horizon.length - 1].c)));
}
function atrAt(daily: Bar[], ts: Date): number | null {
  const before = daily.filter((b) => b.t * 1000 < ts.getTime() - 6 * 3600 * 1000).slice(-15);
  if (before.length < 15) return null;
  const tr = before.slice(1).map((b, k) => Math.max(b.h - b.l, Math.abs(b.h - before[k].c), Math.abs(b.l - before[k].c)));
  return tr.reduce((a, b) => a + b, 0) / tr.length;
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const stat = (rs: number[]) => ({ n: rs.length, expectancyR: mean(rs), t: rs.length > 1 ? mean(rs) / (sd(rs) / Math.sqrt(rs.length)) : NaN, hit: rs.filter((r) => r > 0).length / Math.max(1, rs.length), totalR: rs.reduce((a, b) => a + b, 0) });

(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const { rows } = await c.query(`SELECT id, source, symbol, direction, holding_period, entry_price, stop_loss, target_price, timestamp, exit_by, resolution_reason, outcome_notes
    FROM trade_ideas WHERE outcome_status IN ('hit_target','hit_stop','expired') AND entry_price > 0 AND stop_loss > 0 AND target_price > 0 ORDER BY timestamp`);
  await c.end();
  const ideas: Idea[] = rows.map((r: any) => ({ id: r.id, src: r.source ?? 'unknown', sym: String(r.symbol).toUpperCase(), dir: /short|bear/i.test(r.direction) ? 'short' as const : 'long' as const, hp: r.holding_period ?? 'swing', entry: +r.entry_price, stop: +r.stop_loss, target: +r.target_price, ts: new Date(r.timestamp), exitBy: r.exit_by && /^\d{4}-/.test(r.exit_by) ? new Date(r.exit_by) : null, _r: r } as any))
    .filter((i: any) => { const rk = Math.abs(i.entry - i.stop) / i.entry; const sides = i.dir === 'long' ? i.stop < i.entry && i.target > i.entry : i.stop > i.entry && i.target < i.entry; return rk > 0 && rk < 0.5 && Math.abs(i.target - i.entry) / i.entry < 1 && sides && i._r.resolution_reason !== 'duplicate_collapsed' && !/unit mismatch/i.test(i._r.outcome_notes ?? ''); });
  const syms = Array.from(new Set(ideas.map((i) => i.sym))); let k = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (k < syms.length) { const s = syms[k++]; await bars(s, '5m', 59); await bars(s, '1d', 200); } }));

  type Row = { i: Idea; atr: number; stopATR: number; base: number; widen: Record<string, number> };
  const KS = [0.25, 0.5, 0.75, 1.0, 1.25];
  const data: Row[] = [];
  for (const i of ideas) {
    const p5 = await bars(i.sym, '5m', 59), d1 = await bars(i.sym, '1d', 200);
    const ref = p5.find((x) => x.t >= i.ts.getTime() / 1000);
    if (!ref || Math.abs(ref.o / i.entry - 1) > 0.15) continue;
    const atr = atrAt(d1, i.ts); if (!atr) continue;
    const base = replay(i, p5, i.stop); if (base == null) continue;
    const dist = Math.abs(i.entry - i.stop);
    const widen: Record<string, number> = {};
    for (const kk of KS) {
      const floor = kk * atr;
      if (dist >= floor) { widen[kk] = base; continue; }
      const s2 = i.dir === 'long' ? i.entry - floor : i.entry + floor;
      // A widened stop must stay on the correct side and not swallow the target.
      const ok = i.dir === 'long' ? s2 > 0 : true;
      widen[kk] = ok ? (replay(i, p5, s2) ?? base) : base;
    }
    data.push({ i, atr, stopATR: dist / atr, base, widen });
  }
  const half = Math.floor(data.length / 2);
  const train = data.slice(0, half), test = data.slice(half);
  const evalA = (set: Row[], kk: number) => stat(set.map((d) => d.widen[kk]));
  const evalB = (set: Row[], kk: number) => stat(set.filter((d) => d.stopATR >= kk).map((d) => d.base));
  const grid = KS.map((kk) => ({ k: kk, trainWiden: evalA(train, kk), trainReject: evalB(train, kk), testWiden: evalA(test, kk), testReject: evalB(test, kk), shareBelowFloor: data.filter((d) => d.stopATR < kk).length / data.length }));
  const bestA = KS.reduce((b, kk) => (evalA(train, kk).expectancyR > evalA(train, b).expectancyR ? kk : b), KS[0]);
  const bestB = KS.reduce((b, kk) => (evalB(train, kk).expectancyR > evalB(train, b).expectancyR && evalB(train, kk).n >= 40 ? kk : b), KS[0]);
  const bySrc: any = {};
  for (const s of Array.from(new Set(data.map((d) => d.i.src)))) {
    const sub = data.filter((d) => d.i.src === s); if (sub.length < 20) continue;
    bySrc[s] = { n: sub.length, medianStopATR: [...sub.map((d) => d.stopATR)].sort((a, b) => a - b)[Math.floor(sub.length / 2)], base: stat(sub.map((d) => d.base)), widen075: stat(sub.map((d) => d.widen[0.75])), reject075: stat(sub.filter((d) => d.stopATR >= 0.75).map((d) => d.base)) };
  }
  const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  const res = {
    generatedAt: new Date().toISOString(), n: data.length, trainN: train.length, testN: test.length,
    stopATRquartiles: [0.25, 0.5, 0.75].map((p) => q(data.map((d) => d.stopATR), p)),
    baseline: { all: stat(data.map((d) => d.base)), train: stat(train.map((d) => d.base)), test: stat(test.map((d) => d.base)) },
    grid, chosen: { widenK: bestA, rejectK: bestB, testWiden: evalA(test, bestA), testReject: evalB(test, bestB), testBaseline: stat(test.map((d) => d.base)) },
    bySource: bySrc,
  };
  fs.writeFileSync('research/stop-floor-results.json', JSON.stringify(res, null, 2));
  console.log(JSON.stringify({ ...res, grid: res.grid.map((g) => ({ k: g.k, below: g.shareBelowFloor.toFixed(2), trW: g.trainWiden.expectancyR.toFixed(3), trRj: `${g.trainReject.expectancyR.toFixed(3)} n${g.trainReject.n}`, teW: g.testWiden.expectancyR.toFixed(3), teRj: `${g.testReject.expectancyR.toFixed(3)} n${g.testReject.n}` })) }, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
