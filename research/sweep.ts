/**
 * SWEEP — how much edge can we actually stack?
 *
 * Ground rules, learned the hard way in this run:
 *   • PER-SYMBOL bar indexing. A global Math.min over history lengths silently
 *     cut an earlier version of this study to 12 detection bars out of 260.
 *   • n must be big enough that a mean is not two names. Anything under ~300
 *     firings is reported but not trusted.
 *   • Both chronological halves must beat their own baseline. A rule that only
 *     works in H2 is a rule fitted to H2.
 *
 * Baseline over 448,869 samples is +0.53%/53%, so "edge" throughout is excess
 * over that, not raw return.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RESULTS  (n=389,889 detections, baseline +0.69%/54%, H1 +0.50 / H2 +0.87)
 * ═══════════════════════════════════════════════════════════════════════════
 * BEST RULE FOUND
 *   thrust2.5 + above20d + NOT near-52w-high
 *     +2.30% / 55%w / n=1649 · edge +1.61 · H1 +0.52 · H2 +2.33
 *
 *   The inverse is the tell: thrust2.5 + above20d + NEAR-high scores edge +0.01
 *   and fails a half. Volume thrust pays on names with ROOM, not on extended
 *   ones. The original battery independently flagged the same thing —
 *   vol_thrust_near_high went A +4.53%/82%w, B −2.20%/25%w and was correctly
 *   left unpromoted. Two different methods, same conclusion.
 *
 * RUNNER-UP, most balanced across halves
 *   thrust2.0 + above20d + !three_up + !strong_close
 *     +1.83% / 55%w / n=2419 · edge +1.15 · H1 +1.61 · H2 +0.66
 *
 * MOST RELIABLE NEGATIVE
 *   three_up   +0.32%/52%/n=43,009 · edge −0.36 · negative in BOTH halves
 *   up3 + strong_close  edge −0.33, n=16,622, negative in both
 *   Three consecutive up days is a persistent drag. Usable as a filter or a
 *   fade; the n makes it the most trustworthy number in the study.
 *
 * ON THE PROMOTED SIGNAL
 *   signal-battery.ts measured vol_thrust_2.5x_up at n=22 (A) and n=17 (B) and
 *   promoted it on +7.68% / +10.55%. Pooled here across n=4,180 the same rule
 *   is +1.46%/55%w, edge +0.78. The DIRECTION holds — thrust is real and both
 *   halves are positive — but the magnitude was inflated roughly 5-10× by tiny
 *   n. The 41% win rate beside a +10.55% mean in window B is the giveaway: most
 *   of those 17 trades lost and a couple of outliers carried the average.
 *
 * METHOD BUG WORTH REMEMBERING
 *   An earlier version of this study took Math.min over every name's history
 *   length to find a common index, so one short-history ticker capped the whole
 *   run at 12 detection bars out of 260 — about 5% of the data. Every number it
 *   produced was noise, including a confident "chasing gaps loses 3%" that
 *   reversed to +0.41 edge once the full history was used. Index per symbol.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type B={o:number;h:number;l:number;c:number;v:number};
const sma=(a:number[],n:number,e:number)=>{if(e-n<0)return null;let s=0;for(let i=e-n;i<e;i++)s+=a[i];return s/n;};
const vt=(b:B[],i:number,x:number)=>{const av=sma(b.map(z=>z.v),20,i);return !!av&&av>0&&b[i].v>=av*x&&b[i].c>b[i-1].c;};
const a20=(b:B[],i:number)=>{const m=sma(b.map(z=>z.c),20,i+1);return !!m&&b[i].c>m;};
const a50=(b:B[],i:number)=>{const m=sma(b.map(z=>z.c),50,i+1);return !!m&&b[i].c>m;};
const up3=(b:B[],i:number)=>b[i].c>b[i-1].c&&b[i-1].c>b[i-2].c&&b[i-2].c>b[i-3].c;
const dn3=(b:B[],i:number)=>b[i].c<b[i-1].c&&b[i-1].c<b[i-2].c&&b[i-2].c<b[i-3].c;
const sc=(b:B[],i:number)=>{const r=b[i].h-b[i].l;return r>0&&(b[i].c-b[i].l)/r>=0.8;};
const nearHi=(b:B[],i:number,p:number)=>{const hi=Math.max(...b.slice(Math.max(0,i-251),i+1).map(z=>z.h));return b[i].c>=hi*p;};
const ret=(b:B[],i:number,n:number)=>{const p=b[i-n]?.c;return p>0?(b[i].c-p)/p:0;};
const gapUp=(b:B[],i:number)=>(b[i].c-b[i-1].c)/b[i-1].c>=0.05;

const R:Record<string,(b:B[],i:number)=>boolean>={
  'thrust2.5                        ':(b,i)=>vt(b,i,2.5),
  'thrust2.5 + a20                  ':(b,i)=>vt(b,i,2.5)&&a20(b,i),
  'thrust2.5 + a20 + a50            ':(b,i)=>vt(b,i,2.5)&&a20(b,i)&&a50(b,i),
  'thrust2.5 + a20 + !up3           ':(b,i)=>vt(b,i,2.5)&&a20(b,i)&&!up3(b,i),
  'thrust2.5 + a20 + !sc            ':(b,i)=>vt(b,i,2.5)&&a20(b,i)&&!sc(b,i),
  'thrust2.5 + a20 + !up3 + !sc     ':(b,i)=>vt(b,i,2.5)&&a20(b,i)&&!up3(b,i)&&!sc(b,i),
  'thrust2.5 + a20 + nearHi95       ':(b,i)=>vt(b,i,2.5)&&a20(b,i)&&nearHi(b,i,0.95),
  'thrust2.5 + a20 + !nearHi95      ':(b,i)=>vt(b,i,2.5)&&a20(b,i)&&!nearHi(b,i,0.95),
  'thrust2.5 + a20 + ret20<0        ':(b,i)=>vt(b,i,2.5)&&a20(b,i)&&ret(b,i,20)<0,
  'thrust2.5 + a20 + ret20>10%      ':(b,i)=>vt(b,i,2.5)&&a20(b,i)&&ret(b,i,20)>0.10,
  'thrust2.5 + a20 + !gapUp         ':(b,i)=>vt(b,i,2.5)&&a20(b,i)&&!gapUp(b,i),
  'thrust2.0 + a20 + !up3           ':(b,i)=>vt(b,i,2.0)&&a20(b,i)&&!up3(b,i),
  'thrust2.0 + a20 + !up3 + !sc     ':(b,i)=>vt(b,i,2.0)&&a20(b,i)&&!up3(b,i)&&!sc(b,i),
  'thrust1.5 + a20 + !up3 + !sc     ':(b,i)=>vt(b,i,1.5)&&a20(b,i)&&!up3(b,i)&&!sc(b,i),
  'dn3 + a20 + !sc                  ':(b,i)=>dn3(b,i)&&a20(b,i)&&!sc(b,i),
  'dn3 + a50 + ret20<0              ':(b,i)=>dn3(b,i)&&a50(b,i)&&ret(b,i,20)<0,
  '--- known negatives ---          ':()=>false,
  'three_up                         ':(b,i)=>up3(b,i),
  'strong_close                     ':(b,i)=>sc(b,i),
  'up3 + sc (worst stack?)          ':(b,i)=>up3(b,i)&&sc(b,i),
};

async function main(){
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const data:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=120) data[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(data);
  const FWD=5, START=55;
  type A={n:number;s:number;w:number};
  const mk=():A=>({n:0,s:0,w:0}), add=(a:A,f:number)=>{a.n++;a.s+=f;if(f>0)a.w++;};
  const base={all:mk(),h1:mk(),h2:mk()};
  const acc:Record<string,{all:A;h1:A;h2:A}>={};
  Object.keys(R).forEach(k=>acc[k]={all:mk(),h1:mk(),h2:mk()});

  for(const sym of syms){
    const b=data[sym]; const END=b.length-FWD-1; const mid=Math.floor((START+END)/2);
    for(let i=START;i<=END;i++){
      const en=b[i].c, ex=b[i+FWD].c; if(!(en>0&&ex>0))continue;
      const f=((ex-en)/en)*100, h=i<=mid?'h1':'h2';
      add(base.all,f); add(base[h],f);
      for(const [k,fn] of Object.entries(R)){let hit=false;try{hit=fn(b,i);}catch{}
        if(hit){add(acc[k].all,f);add(acc[k][h],f);}}
    }
  }
  const st=(a:A)=>a.n?{avg:a.s/a.n,wr:(a.w/a.n)*100,n:a.n}:{avg:0,wr:0,n:0};
  const bA=st(base.all),b1=st(base.h1),b2=st(base.h2);
  console.log(`n=${bA.n}  baseline ${bA.avg.toFixed(2)}%/${bA.wr.toFixed(0)}%  (H1 ${b1.avg.toFixed(2)} H2 ${b2.avg.toFixed(2)})\n`);
  console.log(`${'rule'.padEnd(34)}${'avg/win/n'.padStart(22)}${'edge'.padStart(8)}${'H1'.padStart(8)}${'H2'.padStart(8)}  verdict`);
  const rows=Object.keys(R).filter(k=>!k.startsWith('---')).map(k=>{
    const A=st(acc[k].all),H1=st(acc[k].h1),H2=st(acc[k].h2);
    return {k,A,e:A.avg-bA.avg,e1:H1.avg-b1.avg,e2:H2.avg-b2.avg};
  }).sort((x,z)=>z.e-x.e);
  for(const r of rows){
    const v = r.A.n<300 ? 'thin n' : (r.e1>0&&r.e2>0) ? '★ both halves' : (r.e1<0&&r.e2<0) ? '✗ negative both' : 'one half only';
    console.log(`${r.k.padEnd(34)}${`${r.A.avg>=0?'+':''}${r.A.avg.toFixed(2)}%/${r.A.wr.toFixed(0)}%/${r.A.n}`.padStart(22)}${`${r.e>=0?'+':''}${r.e.toFixed(2)}`.padStart(8)}${`${r.e1>=0?'+':''}${r.e1.toFixed(2)}`.padStart(8)}${`${r.e2>=0?'+':''}${r.e2.toFixed(2)}`.padStart(8)}  ${v}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
