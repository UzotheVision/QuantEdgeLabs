/**
 * PATH REPLAY — independent re-adjudication of every resolved idea from real
 * 5-minute bars, starting the minute it was published.
 *
 * Why: the outcome tracker judges barriers against stored extremes that are
 * (a) polled every 5 minutes and (b) since 2026-08-26 enriched with the WHOLE
 * day's bar — including the part of the session before the idea existed. A
 * stop sitting above a morning low can be "hit" by a price printed hours
 * before publication. Replay removes both problems and also resolves the
 * order question (which barrier was touched first) that extremes cannot.
 *
 * Rules (conservative, stated in the report):
 *   - regular session bars only (09:30–16:00 ET) — listed options don't trade outside it
 *   - path starts at the first bar that OPENS after the publish timestamp
 *   - a bar that gaps through a barrier fills at its open (slippage counted)
 *   - a bar that touches both barriers counts as the stop (worst case)
 *   - horizon: exit_by if stored, else day = that session, swing = 10 sessions, position = 20
 *   - neither barrier by the horizon = timeout, marked at the horizon close
 *
 * Run: npx tsx research/path-replay.ts   → research/replay-results.json
 */
import fs from 'fs';
import pg from 'pg';

type Bar = { t: number; o: number; h: number; l: number; c: number };
const YSYM: Record<string, string> = { SPX: '^GSPC', NDX: '^NDX', RUT: '^RUT', VIX: '^VIX', XSP: '^XSP', DJX: '^DJI' };
const CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'AVAX']);

const barCache = new Map<string, Promise<Bar[]>>();
function bars5m(symbol: string): Promise<Bar[]> {
  const ys = YSYM[symbol] ?? (CRYPTO.has(symbol) ? `${symbol}-USD` : symbol);
  if (!barCache.has(ys)) barCache.set(ys, (async () => {
    const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 59 * 86400;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?period1=${p1}&period2=${p2}&interval=5m&includePrePost=false`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.status === 429) { await new Promise((s) => setTimeout(s, 2000 * (attempt + 1))); continue; }
        const j: any = await r.json(); const res = j?.chart?.result?.[0]; if (!res) return [];
        const q = res.indicators.quote[0];
        return (res.timestamp as number[]).map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] }))
          .filter((b) => b.o != null && b.h != null && b.l != null && b.c != null);
      } catch { await new Promise((s) => setTimeout(s, 1000)); }
    }
    return [];
  })());
  return barCache.get(ys)!;
}
const etParts = (t: number) => {
  const s = new Date(t * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const [d, hm] = s.split(', '); const [h, m] = hm.split(':').map(Number);
  return { day: d, min: (h % 24) * 60 + m };
};
const rth = (b: Bar) => { const { min } = etParts(b.t); return min >= 570 && min < 960; };

interface Idea { id: string; src: string; sym: string; dir: 'long' | 'short'; hp: string; entry: number; stop: number; target: number; ts: Date; exitBy: Date | null; outcome: string; reason: string; asset: string }
interface Verdict { id: string; src: string; dir: string; hp: string; recorded: string; replay: 'target' | 'stop' | 'timeout' | 'nodata'; r: number | null; gapFill: boolean; minutesToResolve: number | null; sameBarBoth: boolean }

function adjudicate(i: Idea, all: Bar[]): Verdict {
  const base = { id: i.id, src: i.src, dir: i.dir, hp: i.hp, recorded: i.outcome };
  const start = i.ts.getTime() / 1000;
  const path = all.filter((b) => b.t >= start && (CRYPTO.has(i.sym) || rth(b)));
  if (!path.length) return { ...base, replay: 'nodata', r: null, gapFill: false, minutesToResolve: null, sameBarBoth: false };
  // horizon in sessions
  const sessions: string[] = [];
  for (const b of path) { const d = etParts(b.t).day; if (sessions[sessions.length - 1] !== d) sessions.push(d); }
  const nSess = i.hp === 'day' ? 1 : i.hp === 'position' ? 20 : 10;
  const lastDay = sessions[Math.min(nSess, sessions.length) - 1];
  let horizon = path.filter((b) => sessions.indexOf(etParts(b.t).day) <= sessions.indexOf(lastDay));
  if (i.exitBy) { const eb = i.exitBy.getTime() / 1000; const h2 = path.filter((b) => b.t <= eb); if (h2.length) horizon = h2; }
  // Needs the full horizon to exist in the data, else the timeout mark is premature.
  const risk = Math.abs(i.entry - i.stop), L = i.dir === 'long';
  const R = (px: number) => ((L ? 1 : -1) * (px - i.entry)) / risk;
  for (const b of horizon) {
    const stopHit = L ? b.l <= i.stop : b.h >= i.stop;
    const tgtHit = L ? b.h >= i.target : b.l <= i.target;
    const mins = Math.round((b.t - start) / 60);
    if (stopHit) {
      const gap = L ? b.o <= i.stop : b.o >= i.stop;
      return { ...base, replay: 'stop', r: Math.max(-3, R(gap ? b.o : i.stop)), gapFill: gap, minutesToResolve: mins, sameBarBoth: tgtHit };
    }
    if (tgtHit) {
      const gap = L ? b.o >= i.target : b.o <= i.target;
      return { ...base, replay: 'target', r: Math.min(6, R(gap ? b.o : i.target)), gapFill: gap, minutesToResolve: mins, sameBarBoth: false };
    }
  }
  const last = horizon[horizon.length - 1];
  return { ...base, replay: 'timeout', r: Math.max(-3, Math.min(6, R(last.c))), gapFill: false, minutesToResolve: null, sameBarBoth: false };
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function book(v: Verdict[], ideas: Map<string, Idea>) {
  const ok = v.filter((x) => x.replay !== 'nodata');
  const dec = ok.filter((x) => x.replay === 'target' || x.replay === 'stop');
  const w = dec.filter((x) => x.replay === 'target').length;
  const be = dec.reduce((a, x) => { const i = ideas.get(x.id)!; const rr = Math.abs(i.target - i.entry) / Math.abs(i.entry - i.stop); return a + 1 / (1 + rr); }, 0);
  const vv = dec.reduce((a, x) => { const i = ideas.get(x.id)!; const p = 1 / (1 + Math.abs(i.target - i.entry) / Math.abs(i.entry - i.stop)); return a + p * (1 - p); }, 0);
  const rs = ok.map((x) => x.r!).filter(Number.isFinite);
  const g = rs.filter((x) => x > 0).reduce((a, b) => a + b, 0), l = -rs.filter((x) => x < 0).reduce((a, b) => a + b, 0);
  return { n: ok.length, decided: dec.length, timeouts: ok.length - dec.length, hitRate: w / Math.max(1, dec.length), breakEven: be / Math.max(1, dec.length), z: vv > 0 ? (w - be) / Math.sqrt(vv) : NaN, expectancyR: mean(rs), t: mean(rs) / (sd(rs) / Math.sqrt(rs.length)), profitFactor: l > 0 ? g / l : NaN };
}

(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const { rows } = await c.query(`SELECT id, source, symbol, direction, holding_period, asset_type, entry_price, stop_loss, target_price, timestamp, exit_by, outcome_status, resolution_reason, outcome_notes
    FROM trade_ideas WHERE outcome_status IN ('hit_target','hit_stop','expired') AND entry_price > 0 AND stop_loss > 0 AND target_price > 0 ORDER BY timestamp`);
  await c.end();
  const ideas: Idea[] = rows.map((r: any) => ({
    id: r.id, src: r.source ?? 'unknown', sym: String(r.symbol).toUpperCase(), dir: /short|bear/i.test(r.direction) ? 'short' : 'long',
    hp: r.holding_period ?? 'swing', asset: r.asset_type, entry: +r.entry_price, stop: +r.stop_loss, target: +r.target_price,
    ts: new Date(r.timestamp), exitBy: r.exit_by && /^\d{4}-/.test(r.exit_by) ? new Date(r.exit_by) : null,
    outcome: r.outcome_status, reason: r.resolution_reason ?? '',
    _notes: r.outcome_notes ?? '',
  } as any)).filter((i: any) => {
    const rk = Math.abs(i.entry - i.stop) / i.entry;
    const sides = i.dir === 'long' ? i.stop < i.entry && i.target > i.entry : i.stop > i.entry && i.target < i.entry;
    return rk > 0 && rk < 0.5 && Math.abs(i.target - i.entry) / i.entry < 1 && sides && i.reason !== 'duplicate_collapsed' && !/unit mismatch/i.test(i._notes);
  });
  // Levels must be in the underlying's units: an option idea whose entry is a premium can't be replayed on stock bars.
  const syms = Array.from(new Set(ideas.map((i) => i.sym)));
  console.log(`replaying ${ideas.length} ideas across ${syms.length} symbols`);
  const lim = 6; let k = 0;
  await Promise.all(Array.from({ length: lim }, async () => { while (k < syms.length) { const s = syms[k++]; await bars5m(s); } }));
  const verdicts: Verdict[] = [];
  let unitSkip = 0;
  for (const i of ideas) {
    const b = await bars5m(i.sym);
    const ref = b.find((x) => x.t >= i.ts.getTime() / 1000);
    if (ref && Math.abs(ref.o / i.entry - 1) > 0.15) { unitSkip++; continue; } // entry not in the underlying's units
    verdicts.push(adjudicate(i, b));
  }
  const byId = new Map(ideas.map((i) => [i.id, i]));
  const rec = (o: string) => (o === 'hit_target' ? 'target' : o === 'hit_stop' ? 'stop' : 'expired');
  const matrix: Record<string, Record<string, number>> = {};
  for (const v of verdicts) { const a = rec(v.recorded); matrix[a] ??= {}; matrix[a][v.replay] = (matrix[a][v.replay] ?? 0) + 1; }
  const decidedBoth = verdicts.filter((v) => v.replay !== 'nodata' && v.recorded !== 'expired' && (v.replay === 'target' || v.replay === 'stop'));
  const agree = decidedBoth.filter((v) => rec(v.recorded) === v.replay).length;
  const bySrc: any = {};
  for (const s of Array.from(new Set(verdicts.map((v) => v.src)))) { const sub = verdicts.filter((v) => v.src === s); if (sub.length >= 15) bySrc[s] = book(sub, byId); }
  const byDir = { long: book(verdicts.filter((v) => v.dir === 'long'), byId), short: book(verdicts.filter((v) => v.dir === 'short'), byId) };
  const byHp: any = {}; for (const h of ['day', 'swing', 'position']) { const sub = verdicts.filter((v) => v.hp === h); if (sub.length >= 15) byHp[h] = book(sub, byId); }
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const stopMins = verdicts.filter((v) => v.replay === 'stop' && v.minutesToResolve != null).map((v) => v.minutesToResolve!);
  const res = {
    generatedAt: new Date().toISOString(), ideas: ideas.length, unitSkipped: unitSkip, replayed: verdicts.length,
    noData: verdicts.filter((v) => v.replay === 'nodata').length,
    agreement: { decidedBoth: decidedBoth.length, agree, rate: agree / Math.max(1, decidedBoth.length) },
    // Recorded stop the replay never touched = a phantom loss; recorded target never touched = a phantom win.
    phantomStops: verdicts.filter((v) => v.recorded === 'hit_stop' && v.replay !== 'stop' && v.replay !== 'nodata').length,
    phantomTargets: verdicts.filter((v) => v.recorded === 'hit_target' && v.replay !== 'target' && v.replay !== 'nodata').length,
    matrix, overall: book(verdicts, byId), bySource: bySrc, byDir, byHoldingPeriod: byHp,
    gapFills: verdicts.filter((v) => v.gapFill).length, sameBarBoth: verdicts.filter((v) => v.sameBarBoth).length,
    stopMinutesMedian: med(stopMins), stopsWithin30min: stopMins.filter((m) => m <= 30).length, stops: stopMins.length,
    verdicts,
  };
  fs.writeFileSync('research/replay-results.json', JSON.stringify(res, null, 2));
  console.log(JSON.stringify({ ...res, verdicts: undefined }, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
