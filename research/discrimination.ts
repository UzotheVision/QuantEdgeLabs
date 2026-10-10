/**
 * DISCRIMINATION — which precursors actually separate winners from losers?
 *
 * The autopsy showed 100% "coverage" on both sides, which is worthless: the
 * common precursors (deep_below_high 69% of gainers / 76% of losers) fire on
 * everything. Presence is not evidence. What matters is LIFT over the base
 * rate, and whether a precursor leans to one side.
 *
 *   base       P(precursor) across the whole universe on that bar
 *   lift_gain  P(precursor | top-25 gainer) / base      >1 = over-represented
 *   lift_loss  P(precursor | top-25 loser)  / base
 *   skew       lift_gain / lift_loss                    >1 = leans bullish
 *
 * A precursor with lift ≈ 1 on both sides is describing the market. Only skew
 * away from 1 is information.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type B = { o: number; h: number; l: number; c: number; v: number };
const sma = (a: number[], n: number, end: number) => {
  if (end - n < 0) return null;
  let s = 0; for (let i = end - n; i < end; i++) s += a[i];
  return s / n;
};

const P: Record<string, (b: B[], i: number) => boolean> = {
  vol_thrust_2_5x: (b,i)=>{const av=sma(b.map(x=>x.v),20,i);return !!av&&av>0&&b[i].v>=av*2.5&&b[i].c>b[i-1].c;},
  vol_dry_up:      (b,i)=>{const av=sma(b.map(x=>x.v),20,i);return !!av&&av>0&&b[i].v<=av*0.6;},
  nr7:             (b,i)=>{const r=b.slice(i-6,i+1).map(x=>x.h-x.l);return r[6]>0&&r[6]===Math.min(...r);},
  near_52w_high:   (b,i)=>{const hi=Math.max(...b.slice(0,i+1).map(x=>x.h));return b[i].c>=hi*0.97;},
  deep_below_high: (b,i)=>{const hi=Math.max(...b.slice(0,i+1).map(x=>x.h));return b[i].c<hi*0.85;},
  three_down_days: (b,i)=>b[i].c<b[i-1].c&&b[i-1].c<b[i-2].c&&b[i-2].c<b[i-3].c,
  three_up_days:   (b,i)=>b[i].c>b[i-1].c&&b[i-1].c>b[i-2].c&&b[i-2].c>b[i-3].c,
  above_20d:       (b,i)=>{const m=sma(b.map(x=>x.c),20,i+1);return !!m&&b[i].c>m;},
  below_20d:       (b,i)=>{const m=sma(b.map(x=>x.c),20,i+1);return !!m&&b[i].c<m;},
  gap_up_prior:    (b,i)=>(b[i].c-b[i-1].c)/b[i-1].c>=0.05,
  gap_dn_prior:    (b,i)=>(b[i].c-b[i-1].c)/b[i-1].c<=-0.05,
  inside_day:      (b,i)=>b[i].h<=b[i-1].h&&b[i].l>=b[i-1].l,
  wide_range:      (b,i)=>{const rs=b.slice(i-20,i).map(x=>x.h-x.l);const av=rs.reduce((s,v)=>s+v,0)/rs.length;return av>0&&(b[i].h-b[i].l)>=av*2;},
  closed_strong:   (b,i)=>{const r=b[i].h-b[i].l;return r>0&&(b[i].c-b[i].l)/r>=0.8;},
  closed_weak:     (b,i)=>{const r=b[i].h-b[i].l;return r>0&&(b[i].c-b[i].l)/r<=0.2;},
};

async function main() {
  await loadLiquidUniverseFromDisk();
  const raw = await getUniverseBars(70);
  const data: Record<string, B[]> = {};
  for (const [s, v] of raw.entries()) if (v.length >= 40) data[s] = v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms = Object.keys(data);
  const len = Math.min(...syms.map(s=>data[s].length));

  const SESSIONS = 8, TOP = 25;
  const keys = Object.keys(P);
  const cnt = { uni: {} as Record<string,number>, gain: {} as Record<string,number>, loss: {} as Record<string,number> };
  keys.forEach(k => { cnt.uni[k]=0; cnt.gain[k]=0; cnt.loss[k]=0; });
  let nUni=0, nGain=0, nLoss=0;

  for (let s=0; s<SESSIONS; s++) {
    const mv = len-1-s, seen = mv-1;
    if (seen < 25) continue;
    const moves = syms.map(sym=>{const b=data[sym];const p=b[mv-1].c,c=b[mv].c;return {sym,pct:p>0?((c-p)/p)*100:0};})
      .filter(m=>Number.isFinite(m.pct));
    moves.sort((a,z)=>z.pct-a.pct);
    const set = { gain: new Set(moves.slice(0,TOP).map(m=>m.sym)), loss: new Set(moves.slice(-TOP).map(m=>m.sym)) };

    for (const sym of syms) {
      const b = data[sym];
      nUni++;
      if (set.gain.has(sym)) nGain++;
      if (set.loss.has(sym)) nLoss++;
      for (const k of keys) {
        let hit=false; try { hit = P[k](b, seen); } catch {}
        if (!hit) continue;
        cnt.uni[k]++;
        if (set.gain.has(sym)) cnt.gain[k]++;
        if (set.loss.has(sym)) cnt.loss[k]++;
      }
    }
  }

  console.log(`sessions ${SESSIONS} · universe-bars ${nUni} · gainer-slots ${nGain} · loser-slots ${nLoss}\n`);
  console.log(`${'precursor'.padEnd(18)}${'base'.padStart(7)}${'liftG'.padStart(8)}${'liftL'.padStart(8)}${'skew'.padStart(8)}   read`);
  const rows = keys.map(k => {
    const base = cnt.uni[k]/nUni;
    const lg = base>0 ? (cnt.gain[k]/nGain)/base : 0;
    const ll = base>0 ? (cnt.loss[k]/nLoss)/base : 0;
    return { k, base, lg, ll, skew: ll>0 ? lg/ll : (lg>0?99:1), n: cnt.uni[k] };
  }).sort((a,z)=>z.skew-a.skew);

  for (const r of rows) {
    const read = r.skew>1.35 ? 'leans GAINER' : r.skew<0.75 ? 'leans LOSER' : '— no edge';
    console.log(`${r.k.padEnd(18)}${(r.base*100).toFixed(1).padStart(6)}%${r.lg.toFixed(2).padStart(8)}${r.ll.toFixed(2).padStart(8)}${r.skew.toFixed(2).padStart(8)}   ${read}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
