/**
 * MOVERS AUTOPSY — why did the winners win, why did the losers lose, and would
 * we have been there?
 *
 * Method
 * ------
 * For each of the last N completed sessions, rank the liquid universe by that
 * session's move. Take the top gainers and top losers. Then look ONLY at the
 * bar BEFORE the move — the last thing a scanner could have seen — and ask
 * which of our signals fired.
 *
 * The point is not "did the move happen". It is: was the setup visible in
 * advance, and if it was, does our battery contain a rule that names it?
 *
 * Two failure modes this separates, which a hit-rate alone conflates:
 *   MISSED    — a precursor was there and no rule of ours fires on it.
 *   UNKNOWABLE — nothing in price/volume distinguished it the day before.
 *                No amount of signal work recovers these; they are the ceiling.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type B = { o: number; h: number; l: number; c: number; v: number };

function sma(a: number[], n: number, end: number): number | null {
  if (end - n < 0) return null;
  let s = 0; for (let i = end - n; i < end; i++) s += a[i];
  return s / n;
}

/** Everything a scanner could have known at the CLOSE of bar i. */
const PRECURSORS: Record<string, (b: B[], i: number) => boolean> = {
  vol_thrust_2_5x:  (b, i) => { const av = sma(b.map(x=>x.v), 20, i); return !!av && av>0 && b[i].v >= av*2.5 && b[i].c > b[i-1].c; },
  vol_dry_up:       (b, i) => { const av = sma(b.map(x=>x.v), 20, i); return !!av && av>0 && b[i].v <= av*0.6; },
  nr7:              (b, i) => { const r = b.slice(i-6, i+1).map(x=>x.h-x.l); return r[6]>0 && r[6]===Math.min(...r); },
  near_52w_high:    (b, i) => { const hi = Math.max(...b.slice(0,i+1).map(x=>x.h)); return b[i].c >= hi*0.97; },
  deep_below_high:  (b, i) => { const hi = Math.max(...b.slice(0,i+1).map(x=>x.h)); return b[i].c < hi*0.85; },
  three_down_days:  (b, i) => b[i].c<b[i-1].c && b[i-1].c<b[i-2].c && b[i-2].c<b[i-3].c,
  three_up_days:    (b, i) => b[i].c>b[i-1].c && b[i-1].c>b[i-2].c && b[i-2].c>b[i-3].c,
  above_20d:        (b, i) => { const m = sma(b.map(x=>x.c), 20, i+1); return !!m && b[i].c > m; },
  below_20d:        (b, i) => { const m = sma(b.map(x=>x.c), 20, i+1); return !!m && b[i].c < m; },
  gap_up_prior:     (b, i) => (b[i].c - b[i-1].c)/b[i-1].c >= 0.05,
  gap_dn_prior:     (b, i) => (b[i].c - b[i-1].c)/b[i-1].c <= -0.05,
  inside_day:       (b, i) => b[i].h <= b[i-1].h && b[i].l >= b[i-1].l,
  wide_range:       (b, i) => { const rs = b.slice(i-20,i).map(x=>x.h-x.l); const av = rs.reduce((s,v)=>s+v,0)/rs.length; return av>0 && (b[i].h-b[i].l) >= av*2; },
  closed_strong:    (b, i) => { const r = b[i].h-b[i].l; return r>0 && (b[i].c-b[i].l)/r >= 0.8; },
  closed_weak:      (b, i) => { const r = b[i].h-b[i].l; return r>0 && (b[i].c-b[i].l)/r <= 0.2; },
};

async function main() {
  await loadLiquidUniverseFromDisk();
  const raw = await getUniverseBars(70);
  const data: Record<string, B[]> = {};
  for (const [sym, s] of raw.entries()) {
    if (s.length >= 40) data[sym] = s.map(b => ({ o:b.open, h:b.high, l:b.low, c:b.close, v:b.volume }));
  }
  const syms = Object.keys(data);
  const len = Math.min(...syms.map(s => data[s].length));
  console.log(`universe ${syms.length} names, ${len} aligned sessions\n`);

  const SESSIONS = 5;   // last 5 completed sessions
  const TOP = 25;       // top N each side

  const agg = {
    gain: { total: 0, anyFired: 0, byPrecursor: {} as Record<string, number> },
    loss: { total: 0, anyFired: 0, byPrecursor: {} as Record<string, number> },
  };
  const examples: any[] = [];

  for (let s = 0; s < SESSIONS; s++) {
    const moveIdx = len - 1 - s;       // the day that MOVED
    const seenIdx = moveIdx - 1;       // last bar a scanner could see
    if (seenIdx < 25) continue;

    const moves = syms.map(sym => {
      const b = data[sym];
      const prev = b[moveIdx-1].c, cur = b[moveIdx].c;
      return { sym, pct: prev>0 ? ((cur-prev)/prev)*100 : 0 };
    }).filter(m => Number.isFinite(m.pct));

    moves.sort((a,z) => z.pct - a.pct);
    const gainers = moves.slice(0, TOP);
    const losers  = moves.slice(-TOP);

    for (const [side, list] of [['gain', gainers], ['loss', losers]] as const) {
      for (const m of list) {
        const b = data[m.sym];
        const fired = Object.entries(PRECURSORS).filter(([, fn]) => { try { return fn(b, seenIdx); } catch { return false; } }).map(([k])=>k);
        agg[side].total++;
        if (fired.length) agg[side].anyFired++;
        for (const f of fired) agg[side].byPrecursor[f] = (agg[side].byPrecursor[f] ?? 0) + 1;
        if (s === 0 && (list.indexOf(m) < 6)) examples.push({ side, sym: m.sym, pct: m.pct, fired });
      }
    }
  }

  const pct = (a: number, b: number) => b ? `${((a/b)*100).toFixed(0)}%` : '—';
  console.log(`=== COVERAGE across ${SESSIONS} sessions, top ${TOP} each side ===`);
  console.log(`gainers: ${agg.gain.anyFired}/${agg.gain.total} had SOME precursor fire  (${pct(agg.gain.anyFired, agg.gain.total)})`);
  console.log(`losers : ${agg.loss.anyFired}/${agg.loss.total} had SOME precursor fire  (${pct(agg.loss.anyFired, agg.loss.total)})`);

  for (const side of ['gain','loss'] as const) {
    console.log(`\n--- ${side.toUpperCase()}ERS: which precursor was present (of ${agg[side].total}) ---`);
    Object.entries(agg[side].byPrecursor).sort((a,z)=>z[1]-a[1]).forEach(([k,v]) =>
      console.log(`  ${k.padEnd(18)} ${String(v).padStart(3)}  ${pct(v, agg[side].total)}`));
  }

  console.log(`\n--- most recent session, top 6 each side ---`);
  for (const e of examples) {
    console.log(`  ${e.side==='gain'?'▲':'▼'} ${e.sym.padEnd(6)} ${e.pct>=0?'+':''}${e.pct.toFixed(1)}%  ${e.fired.length? e.fired.join(', ') : '(nothing fired — unknowable from price/volume)'}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
