/**
 * OPTIMIZE v3 — final entry search, measured in percent, with the exit fixed at
 * what v2 proved: stop 3.0×ATR, hold 3, NO target.
 *
 * WHY THE EXIT IS SETTLED FIRST
 * v2 ranked exits in percent instead of R and the answer inverted. Ranked by R,
 * a 1.0×ATR stop looked best (+0.63R) — but it won only 28% of the time, and R
 * flatters tight stops because the stop distance IS the denominator. In percent,
 * 3.0×ATR wins (+2.20% vs +1.57%) at 53% rather than 44%.
 *
 * And no target configuration reached the top fourteen. That matches the live
 * book, where trades that hit target averaged 1.60 R:R while trades that hit
 * stop averaged 3.86 — the far target was never the problem, the exit was
 * cutting winners while the stop stayed where it was.
 *
 * Five time slices; a config must beat baseline in at least four to count.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type B={o:number;h:number;l:number;c:number;v:number};
const sma=(a:number[],n:number,e:number)=>{if(e-n<0)return null;let s=0;for(let i=e-n;i<e;i++)s+=a[i];return s/n;};
const vt=(b:B[],i:number,x:number)=>{const av=sma(b.map(z=>z.v),20,i);return !!av&&av>0&&b[i].v>=av*x&&b[i].c>b[i-1].c;};
const mAbove=(b:B[],i:number,n:number)=>{const m=sma(b.map(z=>z.c),n,i+1);return !!m&&b[i].c>m;};
const hiFrac=(b:B[],i:number)=>{const hi=Math.max(...b.slice(Math.max(0,i-251),i+1).map(z=>z.h));return hi>0?b[i].c/hi:1;};
const up3=(b:B[],i:number)=>b[i].c>b[i-1].c&&b[i-1].c>b[i-2].c&&b[i-2].c>b[i-3].c;
const sc=(b:B[],i:number)=>{const r=b[i].h-b[i].l;return r>0&&(b[i].c-b[i].l)/r>=0.8;};
const ret=(b:B[],i:number,n:number)=>{const p=b[i-n]?.c;return p>0?(b[i].c-p)/p:0;};
function atr(b:B[],i:number,n=14){let s=0;for(let k=i-n+1;k<=i;k++)s+=Math.max(b[k].h-b[k].l,Math.abs(b[k].h-b[k-1].c),Math.abs(b[k].l-b[k-1].c));return s/n;}
function mark(b:B[],i:number){
  const entry=b[i].c,a=atr(b,i),stop=entry-a*3.0,risk=entry-stop;
  if(!(risk>0)||entry<=0)return null;
  const last=Math.min(i+3,b.length-1); if(last<=i)return null;
  for(let k=i+1;k<=last;k++) if(b[k].l<=stop) return ((stop-entry)/entry)*100;
  return ((b[last].c-entry)/entry)*100;
}

const E:Record<string,(b:B[],i:number)=>boolean>={
  'BASE thrust2.5+a20+hi90          ':(b,i)=>vt(b,i,2.5)&&mAbove(b,i,20)&&hiFrac(b,i)<0.90,
  '+a50                             ':(b,i)=>vt(b,i,2.5)&&mAbove(b,i,20)&&hiFrac(b,i)<0.90&&mAbove(b,i,50),
  '+a50 +!sc                        ':(b,i)=>vt(b,i,2.5)&&mAbove(b,i,20)&&hiFrac(b,i)<0.90&&mAbove(b,i,50)&&!sc(b,i),
  '+a50 +!up3                       ':(b,i)=>vt(b,i,2.5)&&mAbove(b,i,20)&&hiFrac(b,i)<0.90&&mAbove(b,i,50)&&!up3(b,i),
  '+a50 +!sc +!up3                  ':(b,i)=>vt(b,i,2.5)&&mAbove(b,i,20)&&hiFrac(b,i)<0.90&&mAbove(b,i,50)&&!sc(b,i)&&!up3(b,i),
  '+a50 +r20>0                      ':(b,i)=>vt(b,i,2.5)&&mAbove(b,i,20)&&hiFrac(b,i)<0.90&&mAbove(b,i,50)&&ret(b,i,20)>0,
  '+a50 +!sc +r20>0                 ':(b,i)=>vt(b,i,2.5)&&mAbove(b,i,20)&&hiFrac(b,i)<0.90&&mAbove(b,i,50)&&!sc(b,i)&&ret(b,i,20)>0,
  '+a50 +hi<0.85                    ':(b,i)=>vt(b,i,2.5)&&mAbove(b,i,20)&&hiFrac(b,i)<0.85&&mAbove(b,i,50),
  '+a50 +!sc +hi<0.85               ':(b,i)=>vt(b,i,2.5)&&mAbove(b,i,20)&&hiFrac(b,i)<0.85&&mAbove(b,i,50)&&!sc(b,i),
  'thrust2.0 +a20+a50+hi90 +!sc     ':(b,i)=>vt(b,i,2.0)&&mAbove(b,i,20)&&hiFrac(b,i)<0.90&&mAbove(b,i,50)&&!sc(b,i),
  'thrust2.0 +a20+a50+hi90          ':(b,i)=>vt(b,i,2.0)&&mAbove(b,i,20)&&hiFrac(b,i)<0.90&&mAbove(b,i,50),
  'thrust3.0 +a20+a50+hi90          ':(b,i)=>vt(b,i,3.0)&&mAbove(b,i,20)&&hiFrac(b,i)<0.90&&mAbove(b,i,50),
};
const S=5;
type A={n:number;p:number;w:number};
const mk=():A=>({n:0,p:0,w:0}), add=(a:A,p:number)=>{a.n++;a.p+=p;if(p>0)a.w++;}, av=(a:A)=>a.n?a.p/a.n:0;

async function main(){
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const data:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=140) data[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(data); const START=60;
  const acc:Record<string,{sl:A[];all:A}>={}; Object.keys(E).forEach(k=>acc[k]={sl:Array.from({length:S},mk),all:mk()});
  const base={sl:Array.from({length:S},mk),all:mk()};

  for(const sym of syms){
    const b=data[sym]; const END=b.length-5; const span=END-START; if(span<S*5)continue;
    for(let i=START;i<=END;i++){
      const p=mark(b,i); if(p==null)continue;
      const sl=Math.min(S-1,Math.floor(((i-START)/span)*S));
      add(base.sl[sl],p); add(base.all,p);
      for(const [k,fn] of Object.entries(E)){ let h=false;try{h=fn(b,i);}catch{}
        if(h){add(acc[k].sl[sl],p);add(acc[k].all,p);} }
    }
  }
  console.log(`exit = stop 3.0xATR, hold 3, no target · baseline ${av(base.all).toFixed(2)}% n=${base.all.n}`);
  console.log(`slice baselines: ${base.sl.map(s=>av(s).toFixed(2)+'%').join('  ')}\n`);
  console.log(`${'entry'.padEnd(34)}${'edge'.padStart(9)}${'exp%'.padStart(9)}${'win'.padStart(6)}${'n'.padStart(7)}${'per-slice edge'.padStart(34)}  ok`);
  const rows=Object.keys(E).map(k=>{
    const a=acc[k]; const edge=av(a.all)-av(base.all);
    const per=a.sl.map((s,i)=>s.n>=20?av(s)-av(base.sl[i]):NaN);
    const ok=per.filter(x=>Number.isFinite(x)&&x>0).length;
    return {k,edge,exp:av(a.all),win:a.all.n?(a.all.w/a.all.n)*100:0,n:a.all.n,per,ok};
  }).filter(r=>r.n>=150).sort((x,z)=>z.edge-x.edge);
  for(const r of rows){
    const per=r.per.map(x=>Number.isFinite(x)?`${x>=0?'+':''}${x.toFixed(1)}`.padStart(6):'   —  ').join('');
    console.log(`${r.k.padEnd(34)}${`${r.edge>=0?'+':''}${r.edge.toFixed(2)}%`.padStart(9)}${`${r.exp>=0?'+':''}${r.exp.toFixed(2)}%`.padStart(9)}${`${r.win.toFixed(0)}%`.padStart(6)}${String(r.n).padStart(7)}${per.padStart(34)}  ${r.ok}/5${r.ok>=4?' ★':''}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
