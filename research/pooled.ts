/**
 * POOLED TEST — the same rules, but with enough n to mean something.
 *
 * WHY THIS EXISTS
 * The 3-window holdout gave volume_thrust n = 5, 5, 13. At n=5 a −8.54% mean is
 * one or two names, and so is the +10.55% that got the rule promoted. Neither
 * number is evidence. The window design was built for signals that fire on
 * hundreds of names; applied to a rule that fires on 0.3% of the universe it
 * measures nothing but luck.
 *
 * Fix: walk EVERY valid detection bar in the history rather than three of them,
 * and pool. Same forward horizon, same universe. Then split the pooled sample
 * in half by TIME — first half vs second half — as an honest out-of-sample
 * check that does not depend on which five days you happened to pick.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type B={o:number;h:number;l:number;c:number;v:number};
const sma=(a:number[],n:number,e:number)=>{if(e-n<0)return null;let s=0;for(let i=e-n;i<e;i++)s+=a[i];return s/n;};
const vt=(b:B[],i:number,x:number)=>{const av=sma(b.map(z=>z.v),20,i);return !!av&&av>0&&b[i].v>=av*x&&b[i].c>b[i-1].c;};
const gapUp=(b:B[],i:number)=>(b[i].c-b[i-1].c)/b[i-1].c>=0.05;
const a20=(b:B[],i:number)=>{const m=sma(b.map(z=>z.c),20,i+1);return !!m&&b[i].c>m;};
const dn3=(b:B[],i:number)=>b[i].c<b[i-1].c&&b[i-1].c<b[i-2].c&&b[i-2].c<b[i-3].c;
const up3=(b:B[],i:number)=>b[i].c>b[i-1].c&&b[i-1].c>b[i-2].c&&b[i-2].c>b[i-3].c;
const sc=(b:B[],i:number)=>{const r=b[i].h-b[i].l;return r>0&&(b[i].c-b[i].l)/r>=0.8;};
const inside=(b:B[],i:number)=>b[i].h<=b[i-1].h&&b[i].l>=b[i-1].l;

const R:Record<string,(b:B[],i:number)=>boolean>={
  'thrust_1.5x            ':(b,i)=>vt(b,i,1.5),
  'thrust_2.0x            ':(b,i)=>vt(b,i,2.0),
  'thrust_2.5x            ':(b,i)=>vt(b,i,2.5),
  'thrust_3.5x            ':(b,i)=>vt(b,i,3.5),
  'thrust_2.5x + NOTgapUp ':(b,i)=>vt(b,i,2.5)&&!gapUp(b,i),
  'thrust_2.5x + above20d ':(b,i)=>vt(b,i,2.5)&&a20(b,i),
  'thrust_2.5x + strongCl ':(b,i)=>vt(b,i,2.5)&&sc(b,i),
  'gap_up (chase)         ':(b,i)=>gapUp(b,i),
  'three_down             ':(b,i)=>dn3(b,i),
  'three_down + above20d  ':(b,i)=>dn3(b,i)&&a20(b,i),
  'three_up               ':(b,i)=>up3(b,i),
  'inside_day             ':(b,i)=>inside(b,i),
  'strong_close           ':(b,i)=>sc(b,i),
};

async function main(){
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const data:Record<string,B[]>={};
  // PER-SYMBOL indexing. The earlier version took Math.min across every name's
  // length, so a single short-history ticker capped the whole study at 12
  // detection bars while the median name carried 260. Every result before this
  // was measured on ~5% of the data that existed.
  for(const [s,v] of raw.entries()) if(v.length>=120) data[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(data);
  const FWD=5, START=25;

  type Acc={n:number;s:number;w:number};
  const mk=():Acc=>({n:0,s:0,w:0});
  const base={all:mk(),h1:mk(),h2:mk()};
  const acc:Record<string,{all:Acc;h1:Acc;h2:Acc}>={};
  Object.keys(R).forEach(k=>acc[k]={all:mk(),h1:mk(),h2:mk()});
  const add=(a:Acc,f:number)=>{a.n++;a.s+=f;if(f>0)a.w++;};

  // Split by position WITHIN each symbol's own history, so the halves are
  // chronological for every name regardless of how much history it has.
  for(const sym of syms){
    const b=data[sym];
    const END=b.length-FWD-1;
    const mid=Math.floor((START+END)/2);
    for(let i=START;i<=END;i++){
      const en=b[i].c, ex=b[i+FWD].c;
      if(!(en>0&&ex>0)) continue;
      const f=((ex-en)/en)*100;
      const half=i<=mid?'h1':'h2';
      add(base.all,f); add(base[half],f);
      for(const [k,fn] of Object.entries(R)){
        let hit=false;try{hit=fn(b,i);}catch{}
        if(hit){add(acc[k].all,f);add(acc[k][half],f);}
      }
    }
  }

  const st=(a:Acc)=>a.n?{avg:a.s/a.n,wr:(a.w/a.n)*100,n:a.n}:{avg:0,wr:0,n:0};
  const bA=st(base.all),b1=st(base.h1),b2=st(base.h2);
  const medLen=[...syms.map(s=>data[s].length)].sort((a,z)=>a-z)[Math.floor(syms.length/2)];
  console.log(`forward ${FWD}d  ·  ${syms.length} names  ·  median history ${medLen} bars`);
  console.log(`BASELINE  pooled ${bA.avg.toFixed(2)}%/${bA.wr.toFixed(0)}%  n=${bA.n}   |  H1 ${b1.avg.toFixed(2)}%  H2 ${b2.avg.toFixed(2)}%\n`);
  console.log(`${'rule'.padEnd(24)}${'POOLED avg/win/n'.padStart(24)}${'edge'.padStart(8)}${'H1 edge'.padStart(10)}${'H2 edge'.padStart(10)}   stable?`);
  const rows=Object.keys(R).map(k=>{
    const A=st(acc[k].all),H1=st(acc[k].h1),H2=st(acc[k].h2);
    return {k,A,e:A.avg-bA.avg,e1:H1.avg-b1.avg,e2:H2.avg-b2.avg,n1:H1.n,n2:H2.n};
  }).sort((x,z)=>z.e-x.e);
  for(const r of rows){
    const stable=r.A.n>=100 && r.e1>0 && r.e2>0 ? '★ both halves' : r.A.n<100 ? 'n too small' : (r.e1>0||r.e2>0)?'one half only':'neither half';
    console.log(`${r.k.padEnd(24)}${`${r.A.avg>=0?'+':''}${r.A.avg.toFixed(2)}%/${r.A.wr.toFixed(0)}%/${r.A.n}`.padStart(24)}${`${r.e>=0?'+':''}${r.e.toFixed(2)}`.padStart(8)}${`${r.e1>=0?'+':''}${r.e1.toFixed(2)}`.padStart(10)}${`${r.e2>=0?'+':''}${r.e2.toFixed(2)}`.padStart(10)}   ${stable}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
