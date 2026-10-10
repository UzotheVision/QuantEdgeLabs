/**
 * FINAL SIM — the calibrated config, in account terms.
 *
 * CONFIG (converged over optimize.ts → optimize2.ts → optimize3.ts)
 *   ENTRY  volume >= 2.5x 20d avg on an UP day
 *          AND close > 20d SMA  AND close > 50d SMA
 *          AND close < 90% of the 52-week high      ← the biggest single lever
 *          AND NOT a strong close (top 20% of bar)  ← keeps 5/5 slice stability
 *   EXIT   stop 3.0 x ATR(14), hold 3 bars, NO target
 *
 * HOW THE EXIT WAS SETTLED
 *   Ranked in R, a 1.0xATR stop looked best (+0.63R) — but won 28% of the time.
 *   R = profit/risk, so a tight stop shrinks the denominator and flatters itself.
 *   Ranked in PERCENT, 3.0xATR wins at 53-56%. No target configuration reached
 *   the top of any run, which matches the live book: trades that hit target
 *   averaged 1.60 R:R while trades that hit stop averaged 3.86.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CONVERGED RESULTS
 * ═══════════════════════════════════════════════════════════════════════════
 * FULL HISTORY (260 bars, 1959 names, 5 time slices) — the number to trust
 *   edge +2.67%  ·  expectancy +3.09%  ·  win 54%  ·  n=547  ·  5/5 slices
 *   per-slice: +5.5  +0.3  +0.7  +5.2  +1.6   (every slice positive)
 *
 * LAST 57 SESSIONS — flattering, do not quote this one
 *   expectancy +6.28% · win 63% · 3.2 signals/day · 49/57 sessions fired
 *   Higher because the recent window was strong, not because the rule improved.
 *
 * WHAT EACH FILTER CONTRIBUTES (edge over baseline, full history)
 *   thrust2.5 alone           +0.48%
 *   + above 20d SMA           +0.70%
 *   + below 90% of 52w high   +2.12%   ← biggest single lever, triples it
 *   + above 50d SMA           +2.61%
 *   + NOT strong close        +2.67%   ← buys 5/5 slice stability
 *
 * The near-high filter is the finding. Volume thrust pays on names with ROOM;
 * the same thrust into a name near its high scores +0.01 and fails a slice.
 *
 * KNOWN LIMITS
 *   • Every number is UNDERLYING. Option P&L is not modelled — the leverage and
 *     spread figures in the console output are assumptions, not measurements.
 *   • The edge is lumpy: two of five slices carry most of it.
 *   • Correlated duplicates exist but are rare — 8% of signals are crypto
 *     proxies, and only 1 session in 49 was majority-crypto. Worth a de-dup
 *     before sizing, not before shipping.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type B={o:number;h:number;l:number;c:number;v:number};
const sma=(a:number[],n:number,e:number)=>{if(e-n<0)return null;let s=0;for(let i=e-n;i<e;i++)s+=a[i];return s/n;};
const vt=(b:B[],i:number,x:number)=>{const av=sma(b.map(z=>z.v),20,i);return !!av&&av>0&&b[i].v>=av*x&&b[i].c>b[i-1].c;};
const mA=(b:B[],i:number,n:number)=>{const m=sma(b.map(z=>z.c),n,i+1);return !!m&&b[i].c>m;};
const hiF=(b:B[],i:number)=>{const hi=Math.max(...b.slice(Math.max(0,i-251),i+1).map(z=>z.h));return hi>0?b[i].c/hi:1;};
const sc=(b:B[],i:number)=>{const r=b[i].h-b[i].l;return r>0&&(b[i].c-b[i].l)/r>=0.8;};
const FIRE=(b:B[],i:number)=>vt(b,i,2.5)&&mA(b,i,20)&&mA(b,i,50)&&hiF(b,i)<0.90&&!sc(b,i);
function atr(b:B[],i:number,n=14){let s=0;for(let k=i-n+1;k<=i;k++)s+=Math.max(b[k].h-b[k].l,Math.abs(b[k].h-b[k-1].c),Math.abs(b[k].l-b[k-1].c));return s/n;}
function mark(b:B[],i:number){
  const e=b[i].c,a=atr(b,i),st=e-a*3.0; if(!(e-st>0)||e<=0)return null;
  const last=Math.min(i+3,b.length-1); if(last<=i)return null;
  for(let k=i+1;k<=last;k++) if(b[k].l<=st) return ((st-e)/e)*100;
  return ((b[last].c-e)/e)*100;
}

async function main(){
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const data:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=140) data[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(data); const START=60;

  const per:{sess:number;picks:{s:string;p:number}[]}[]=[];
  let all:number[]=[]; let baseAll:number[]=[];
  const maxLen=Math.max(...syms.map(s=>data[s].length));
  for(let back=4;back<=60;back++){
    const picks:{s:string;p:number}[]=[];
    for(const sym of syms){
      const b=data[sym]; const i=b.length-1-back;
      if(i<START||i+3>=b.length)continue;
      const p=mark(b,i); if(p==null)continue;
      baseAll.push(p);
      let f=false;try{f=FIRE(b,i);}catch{}
      if(f){picks.push({s:sym,p});all.push(p);}
    }
    per.push({sess:back,picks});
  }
  const avg=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
  const win=(a:number[])=>a.length?a.filter(v=>v>0).length/a.length*100:0;

  console.log(`CALIBRATED CONFIG — last 57 decidable sessions\n`);
  console.log(`  signals        ${all.length} over ${per.length} sessions  (${(all.length/per.length).toFixed(1)}/day)`);
  console.log(`  sessions w/ >=1 signal: ${per.filter(p=>p.picks.length>0).length}/${per.length}`);
  console.log(`  expectancy     ${avg(all)>=0?'+':''}${avg(all).toFixed(2)}%   win ${win(all).toFixed(0)}%`);
  console.log(`  baseline       ${avg(baseAll)>=0?'+':''}${avg(baseAll).toFixed(2)}%   win ${win(baseAll).toFixed(0)}%   n=${baseAll.length}`);
  console.log(`  EDGE           ${(avg(all)-avg(baseAll))>=0?'+':''}${(avg(all)-avg(baseAll)).toFixed(2)}% per trade\n`);

  // account translation — deliberately conservative
  const BUDGET=250, DELTA=0.65, SPREAD_COST=0.04;
  console.log(`  ACCOUNT TRANSLATION ($${BUDGET}/trade, ~${DELTA} delta, ${(SPREAD_COST*100).toFixed(0)}% round-trip spread)`);
  const und=avg(all);
  const optMove=und*(1/ (1-0.0)) * 0; // placeholder removed below
  // An option's % move ≈ underlying% * (spot/premium) * delta. spot/premium for a
  // ~0.65-delta contract is roughly 8-12x; use 9 as a mid estimate.
  const LEV=9;
  const gross=und*DELTA*LEV;
  const net=gross-(SPREAD_COST*100);
  console.log(`    underlying ${und.toFixed(2)}%  → option ~${gross.toFixed(1)}% gross  → ~${net.toFixed(1)}% after spread`);
  console.log(`    per $${BUDGET} trade: ~$${(BUDGET*net/100).toFixed(0)} expected`);
  console.log(`    at 2 trades/day x 20 sessions: ~$${(BUDGET*net/100*40).toFixed(0)}`);
  console.log(`\n  ⚠ leverage 9x and spread 4% are ASSUMPTIONS. Underlying numbers are measured; option numbers are not.`);

  const last=per.slice(0,6);
  console.log(`\n  most recent sessions:`);
  for(const d of last){
    const t=d.picks.length?`${d.picks.length} picks, avg ${avg(d.picks.map(p=>p.p))>=0?'+':''}${avg(d.picks.map(p=>p.p)).toFixed(2)}%  [${d.picks.slice(0,5).map(p=>p.s).join(' ')}]`:'no signal';
    console.log(`    T-${String(d.sess).padStart(2)}  ${t}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
