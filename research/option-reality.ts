/**
 * OPTION REALITY — does the calibrated edge survive being traded as options?
 *
 * Everything in this folder so far measures the UNDERLYING. But this account
 * buys ~$250 of premium and runs a −50% premium stop, and those two facts may
 * be incompatible with the config the research chose:
 *
 *   the winning exit is a 3.0 x ATR stop
 *   if ATR is ~3% of price, that is a ~9% adverse move
 *   at ~0.65 delta and ~9x leverage, a 9% adverse move is ~−52% of premium
 *
 * i.e. the premium stop fires BEFORE the underlying stop is ever reached. If
 * that is true, the whole calibration was tuned for an exit this account cannot
 * actually run, and the honest answer is that we optimised the wrong thing.
 *
 * Modelled per trade: delta on the move, theta bleed per calendar day, and a
 * round-trip spread. Deliberately simple — the point is the ORDER of the
 * effects, not a pricing engine.
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

/** Option outcome under a −50% premium stop. LEV = spot/premium. */
function optTrade(b:B[],i:number,hold:number,delta:number,lev:number,thetaPerDay:number,spread:number){
  const e=b[i].c;
  const last=Math.min(i+hold,b.length-1); if(last<=i)return null;
  let premPct=-spread*100;                 // pay the spread on entry
  for(let k=i+1;k<=last;k++){
    const undMove=((b[k].l-e)/e)*100;      // worst point of the day
    const worst=premPct + undMove*delta*lev - thetaPerDay*(k-i);
    if(worst<=-50) return {pct:-50-spread*100, stopped:true};
    const closeMove=((b[k].c-e)/e)*100;
    premPct=-spread*100 + closeMove*delta*lev - thetaPerDay*(k-i);
  }
  return {pct:premPct, stopped:false};
}
/** Underlying outcome under the researched 3xATR stop, for comparison. */
function undTrade(b:B[],i:number,hold:number,stopMult:number){
  const e=b[i].c,a=atr(b,i),st=e-a*stopMult; if(!(e-st>0))return null;
  const last=Math.min(i+hold,b.length-1); if(last<=i)return null;
  for(let k=i+1;k<=last;k++) if(b[k].l<=st) return ((st-e)/e)*100;
  return ((b[last].c-e)/e)*100;
}

async function main(){
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const data:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=140) data[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(data); const START=60;

  // how wide is 3xATR in percent terms, on the names that actually fire?
  const atrPct:number[]=[];
  for(const sym of syms){const b=data[sym];
    for(let i=START;i<b.length-5;i++){ let f=false;try{f=FIRE(b,i);}catch{}
      if(f) atrPct.push((atr(b,i)/b[i].c)*100); }}
  atrPct.sort((a,z)=>a-z);
  const med=atrPct[Math.floor(atrPct.length/2)]??0;
  console.log(`on signal bars: median ATR = ${med.toFixed(2)}% of price  →  3xATR stop = ${(med*3).toFixed(1)}% adverse move`);
  console.log(`at 0.65 delta and 9x leverage that is ${(med*3*0.65*9).toFixed(0)}% of premium\n`);

  const SC=[
    {n:'30-45 DTE  (theta 1.0%/d, lev 7)', hold:3, delta:0.65, lev:7,  theta:1.0},
    {n:'14-21 DTE  (theta 2.5%/d, lev 9)', hold:3, delta:0.60, lev:9,  theta:2.5},
    {n:'7 DTE      (theta 6%/d,  lev 13)', hold:3, delta:0.55, lev:13, theta:6.0},
    {n:'30-45 DTE, hold 10                ', hold:10,delta:0.65, lev:7,  theta:1.0},
  ];
  const SPREAD=0.04;

  let uAll:number[]=[];
  for(const sym of syms){const b=data[sym];
    for(let i=START;i<b.length-11;i++){ let f=false;try{f=FIRE(b,i);}catch{} if(!f)continue;
      const u=undTrade(b,i,3,3.0); if(u!=null)uAll.push(u); }}
  const avg=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
  const win=(a:number[])=>a.length?a.filter(v=>v>0).length/a.length*100:0;
  console.log(`UNDERLYING (3xATR stop, hold 3):  ${avg(uAll)>=0?'+':''}${avg(uAll).toFixed(2)}%  win ${win(uAll).toFixed(0)}%  n=${uAll.length}\n`);

  console.log(`${'contract'.padEnd(36)}${'avg prem%'.padStart(11)}${'win'.padStart(7)}${'stopped'.padStart(9)}${'$ / $250'.padStart(10)}`);
  for(const s of SC){
    const r:number[]=[]; let stopped=0;
    for(const sym of syms){const b=data[sym];
      for(let i=START;i<b.length-s.hold-1;i++){ let f=false;try{f=FIRE(b,i);}catch{} if(!f)continue;
        const o=optTrade(b,i,s.hold,s.delta,s.lev,s.theta,SPREAD);
        if(o){r.push(o.pct); if(o.stopped)stopped++;} }}
    console.log(`${s.n.padEnd(36)}${`${avg(r)>=0?'+':''}${avg(r).toFixed(1)}%`.padStart(11)}${`${win(r).toFixed(0)}%`.padStart(7)}${`${(stopped/r.length*100).toFixed(0)}%`.padStart(9)}${`${avg(r)>=0?'+':''}$${(250*avg(r)/100).toFixed(0)}`.padStart(10)}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
