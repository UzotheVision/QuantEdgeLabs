/**
 * COMBINATION TEST — do the discriminators pay, and does stacking them help?
 *
 * From discrimination.ts, only three precursors skew away from 1:
 *   vol_thrust_2_5x   skew 2.00   (liftG 8.70 vs liftL 4.35)
 *   three_down_days   skew 1.44
 *   gap_up_prior      skew 0.58   ← leans LOSER, so it is a FILTER or a short
 *
 * And the headline negative result worth keeping: deep_below_high runs
 * liftG 2.66 / liftL 2.68. It is over-represented among extreme movers on BOTH
 * sides by the same amount — it selects VOLATILITY, not direction. Most of our
 * "coverage" was that: catching movers by catching volatile names.
 *
 * Rules: three non-overlapping 5-session holdouts. A combo advances only if it
 * beats its own window's baseline in ALL THREE. n is reported because a combo
 * that fires 4 times is noise regardless of its mean.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type B = { o:number;h:number;l:number;c:number;v:number };
const sma=(a:number[],n:number,e:number)=>{if(e-n<0)return null;let s=0;for(let i=e-n;i<e;i++)s+=a[i];return s/n;};

const vol_thrust=(b:B[],i:number,x=2.5)=>{const av=sma(b.map(z=>z.v),20,i);return !!av&&av>0&&b[i].v>=av*x&&b[i].c>b[i-1].c;};
const gap_up=(b:B[],i:number)=>(b[i].c-b[i-1].c)/b[i-1].c>=0.05;
const three_dn=(b:B[],i:number)=>b[i].c<b[i-1].c&&b[i-1].c<b[i-2].c&&b[i-2].c<b[i-3].c;
const three_up=(b:B[],i:number)=>b[i].c>b[i-1].c&&b[i-1].c>b[i-2].c&&b[i-2].c>b[i-3].c;
const above20=(b:B[],i:number)=>{const m=sma(b.map(z=>z.c),20,i+1);return !!m&&b[i].c>m;};
const near_hi=(b:B[],i:number)=>{const hi=Math.max(...b.slice(0,i+1).map(z=>z.h));return b[i].c>=hi*0.97;};
const inside=(b:B[],i:number)=>b[i].h<=b[i-1].h&&b[i].l>=b[i-1].l;
const strong_close=(b:B[],i:number)=>{const r=b[i].h-b[i].l;return r>0&&(b[i].c-b[i].l)/r>=0.8;};

const COMBOS: Record<string,(b:B[],i:number)=>boolean> = {
  'thrust_2.5x                    ': (b,i)=>vol_thrust(b,i),
  'thrust_2.5x + NOT gap_up       ': (b,i)=>vol_thrust(b,i)&&!gap_up(b,i),
  'thrust_2.5x + above20d         ': (b,i)=>vol_thrust(b,i)&&above20(b,i),
  'thrust_2.5x + strong_close     ': (b,i)=>vol_thrust(b,i)&&strong_close(b,i),
  'thrust_2.5x + NOTgap + above20 ': (b,i)=>vol_thrust(b,i)&&!gap_up(b,i)&&above20(b,i),
  'thrust_3.5x                    ': (b,i)=>vol_thrust(b,i,3.5),
  'thrust_3.5x + NOT gap_up       ': (b,i)=>vol_thrust(b,i,3.5)&&!gap_up(b,i),
  'three_down_days                ': (b,i)=>three_dn(b,i),
  'three_down + above20d          ': (b,i)=>three_dn(b,i)&&above20(b,i),
  'three_down + near_high         ': (b,i)=>three_dn(b,i)&&near_hi(b,i),
  'three_down + thrust            ': (b,i)=>three_dn(b,i)&&vol_thrust(b,i),
  'gap_up (the chase — expect BAD)': (b,i)=>gap_up(b,i),
  'three_up (expect BAD)          ': (b,i)=>three_up(b,i),
  'inside_day (expect BAD)        ': (b,i)=>inside(b,i),
};

async function main(){
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(70);
  const data:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=40) data[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(data);
  const len=Math.min(...syms.map(s=>data[s].length));

  // three NON-OVERLAPPING 5-session holdouts
  const W=[{n:'A',d:len-6},{n:'B',d:len-11},{n:'C',d:len-16}];
  const base:Record<string,{n:number;s:number;w:number}>={};
  const res:Record<string,Record<string,{n:number;s:number;w:number}>>={};
  W.forEach(w=>{base[w.n]={n:0,s:0,w:0};});
  Object.keys(COMBOS).forEach(k=>{res[k]={};W.forEach(w=>{res[k][w.n]={n:0,s:0,w:0};});});

  for(const sym of syms){
    const b=data[sym];
    for(const w of W){
      const i=w.d; if(i<25||i+5>=b.length) continue;
      const en=b[i].c, ex=b[i+5].c; if(!(en>0&&ex>0)) continue;
      const f=((ex-en)/en)*100;
      base[w.n].n++;base[w.n].s+=f;if(f>0)base[w.n].w++;
      for(const [k,fn] of Object.entries(COMBOS)){
        let hit=false; try{hit=fn(b,i);}catch{}
        if(hit){const r=res[k][w.n];r.n++;r.s+=f;if(f>0)r.w++;}
      }
    }
  }

  const m=(o:{n:number;s:number;w:number})=>o.n?{avg:o.s/o.n,wr:(o.w/o.n)*100,n:o.n}:{avg:0,wr:0,n:0};
  console.log('BASELINE (5-session forward return, whole universe)');
  W.forEach(w=>{const x=m(base[w.n]);console.log(`  ${w.n}: ${x.avg>=0?'+':''}${x.avg.toFixed(2)}%  win ${x.wr.toFixed(0)}%  n=${x.n}`);});

  console.log(`\n${'combo'.padEnd(33)}${'A'.padStart(16)}${'B'.padStart(16)}${'C'.padStart(16)}   verdict`);
  for(const k of Object.keys(COMBOS)){
    const cells=W.map(w=>{const x=m(res[k][w.n]);const bs=m(base[w.n]);return {x,beat:x.n>=5&&x.avg>bs.avg};});
    const line=cells.map(c=>`${(c.x.avg>=0?'+':'')+c.x.avg.toFixed(2)}%/${c.x.wr.toFixed(0)}%/${c.x.n}`.padStart(16)).join('');
    const all=cells.every(c=>c.beat);
    const minN=Math.min(...cells.map(c=>c.x.n));
    const verdict=all?(minN>=20?'★ PASS 3/3':'PASS 3/3 (thin n)'):`${cells.filter(c=>c.beat).length}/3`;
    console.log(`${k}${line}   ${verdict}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
