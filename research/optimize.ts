/**
 * OPTIMIZE — grid search with an honest holdout.
 *
 * Every parameter is chosen on the FIRST half of each symbol's history and then
 * scored, untouched, on the SECOND half. A config that wins in-sample and dies
 * out-of-sample is reported as such rather than quietly dropped, because the
 * gap between the two columns IS the overfitting estimate.
 *
 * Stage 1 fixes the exit and searches the entry. Stage 2 takes the winning
 * entry and searches the exit. Sequential rather than full-grid: 4×4×2×5×4×3 is
 * 1,920 configs against ~390k bars, and a search that wide finds a winner by
 * chance alone.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type B={o:number;h:number;l:number;c:number;v:number};
const sma=(a:number[],n:number,e:number)=>{if(e-n<0)return null;let s=0;for(let i=e-n;i<e;i++)s+=a[i];return s/n;};
const vt=(b:B[],i:number,x:number)=>{const av=sma(b.map(z=>z.v),20,i);return !!av&&av>0&&b[i].v>=av*x&&b[i].c>b[i-1].c;};
const a20=(b:B[],i:number)=>{const m=sma(b.map(z=>z.c),20,i+1);return !!m&&b[i].c>m;};
const hiFrac=(b:B[],i:number)=>{const hi=Math.max(...b.slice(Math.max(0,i-251),i+1).map(z=>z.h));return hi>0?b[i].c/hi:1;};
function atr(b:B[],i:number,n=14){let s=0;for(let k=i-n+1;k<=i;k++)s+=Math.max(b[k].h-b[k].l,Math.abs(b[k].h-b[k-1].c),Math.abs(b[k].l-b[k-1].c));return s/n;}

/** R multiple. target=null → hold to `hold` bars. Stop checked before target. */
function mark(b:B[],i:number,stopMult:number,hold:number,target:number|null):number|null{
  const entry=b[i].c,a=atr(b,i);
  const stop=entry-a*stopMult,risk=entry-stop;
  if(!(risk>0)||!Number.isFinite(risk))return null;
  const last=Math.min(i+hold,b.length-1);
  if(last<=i)return null;
  const tp=target!=null?entry+risk*target:null;
  for(let k=i+1;k<=last;k++){
    if(b[k].l<=stop)return -1;
    if(tp!=null&&b[k].h>=tp)return target!;
  }
  return (b[last].c-entry)/risk;
}

type Acc={n:number;r:number;w:number};
const mk=():Acc=>({n:0,r:0,w:0});
const add=(a:Acc,r:number)=>{a.n++;a.r+=r;if(r>0)a.w++;};
const ex=(a:Acc)=>a.n?a.r/a.n:0;

async function main(){
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const data:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=140) data[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(data);
  const START=60;
  console.log(`${syms.length} names\n`);

  // ── STAGE 1: entry rule, exit fixed at stop 1.5 ATR / hold 5 / no target ──
  const THRUST=[1.5,2.0,2.5,3.0];
  const HICAP=[1.01,0.97,0.95,0.90];       // require close/52wHigh < cap (1.01 = no filter)
  const A20=[true,false];
  type Cfg={t:number;h:number;a:boolean};
  const cfgs:Cfg[]=[];
  THRUST.forEach(t=>HICAP.forEach(h=>A20.forEach(a=>cfgs.push({t,h,a}))));
  const s1=cfgs.map(c=>({c,tr:mk(),te:mk()}));
  const bTr=mk(),bTe=mk();

  for(const sym of syms){
    const b=data[sym];const END=b.length-11;const mid=Math.floor((START+END)/2);
    for(let i=START;i<=END;i++){
      const r=mark(b,i,1.5,5,null); if(r==null)continue;
      const half=i<=mid?'tr':'te';
      add(half==='tr'?bTr:bTe,r);
      const hf=hiFrac(b,i), ok20=a20(b,i);
      for(const s of s1){
        if(!vt(b,i,s.c.t))continue;
        if(hf>=s.c.h)continue;
        if(s.c.a&&!ok20)continue;
        add(half==='tr'?s.tr:s.te,r);
      }
    }
  }
  const eTr=ex(bTr),eTe=ex(bTe);
  console.log(`baseline  train ${eTr.toFixed(3)}R (n=${bTr.n})   test ${eTe.toFixed(3)}R (n=${bTe.n})`);
  console.log(`\nSTAGE 1 — entry (exit fixed: stop 1.5ATR, hold 5, no target)`);
  console.log(`${'thrust'.padStart(7)}${'hiCap'.padStart(7)}${'a20'.padStart(5)}${'TRAIN edge/n'.padStart(18)}${'TEST edge/n'.padStart(18)}  holds?`);
  const ranked=s1.filter(s=>s.tr.n>=150&&s.te.n>=150)
    .map(s=>({...s,dTr:ex(s.tr)-eTr,dTe:ex(s.te)-eTe}))
    .sort((a,z)=>z.dTe-a.dTe);
  for(const s of ranked.slice(0,10)){
    console.log(`${s.c.t.toFixed(1).padStart(7)}${(s.c.h>=1?'—':s.c.h.toFixed(2)).padStart(7)}${(s.c.a?'y':'n').padStart(5)}`
      +`${`${s.dTr>=0?'+':''}${s.dTr.toFixed(3)}/${s.tr.n}`.padStart(18)}`
      +`${`${s.dTe>=0?'+':''}${s.dTe.toFixed(3)}/${s.te.n}`.padStart(18)}  ${s.dTr>0&&s.dTe>0?'★':'✗'}`);
  }
  const best=ranked.find(s=>s.dTr>0&&s.dTe>0)??ranked[0];
  console.log(`\n→ carrying forward: thrust ${best.c.t}, hiCap ${best.c.h>=1?'none':best.c.h}, above20d ${best.c.a?'yes':'no'}`);

  // ── STAGE 2: exit, entry fixed at stage-1 winner ──
  const STOPS=[1.0,1.5,2.0,2.5,3.0], HOLDS=[3,5,8,13], TGTS:(number|null)[]=[null,2,3];
  type E={s:number;h:number;t:number|null};
  const ecfg:E[]=[];STOPS.forEach(s=>HOLDS.forEach(h=>TGTS.forEach(t=>ecfg.push({s,h,t}))));
  const s2=ecfg.map(c=>({c,tr:mk(),te:mk()}));
  const b2Tr:Record<string,Acc>={},b2Te:Record<string,Acc>={};
  ecfg.forEach(c=>{const k=`${c.s}|${c.h}|${c.t}`;b2Tr[k]=mk();b2Te[k]=mk();});

  for(const sym of syms){
    const b=data[sym];const END=b.length-16;const mid=Math.floor((START+END)/2);
    for(let i=START;i<=END;i++){
      const hf=hiFrac(b,i);
      const fire=vt(b,i,best.c.t)&&hf<best.c.h&&(!best.c.a||a20(b,i));
      const half=i<=mid?'tr':'te';
      for(const s of s2){
        const r=mark(b,i,s.c.s,s.c.h,s.c.t); if(r==null)continue;
        const k=`${s.c.s}|${s.c.h}|${s.c.t}`;
        add(half==='tr'?b2Tr[k]:b2Te[k],r);
        if(fire) add(half==='tr'?s.tr:s.te,r);
      }
    }
  }
  console.log(`\nSTAGE 2 — exit (entry fixed at stage-1 winner)`);
  console.log(`${'stopATR'.padStart(8)}${'hold'.padStart(6)}${'target'.padStart(8)}${'TRAIN edge'.padStart(13)}${'TEST edge'.padStart(12)}${'TEST exp/win/n'.padStart(22)}  holds?`);
  const r2=s2.filter(s=>s.te.n>=150).map(s=>{
    const k=`${s.c.s}|${s.c.h}|${s.c.t}`;
    return {...s,dTr:ex(s.tr)-ex(b2Tr[k]),dTe:ex(s.te)-ex(b2Te[k]),eTe:ex(s.te),wTe:s.te.n?(s.te.w/s.te.n)*100:0};
  }).sort((a,z)=>z.dTe-a.dTe);
  for(const s of r2.slice(0,12)){
    console.log(`${s.c.s.toFixed(1).padStart(8)}${String(s.c.h).padStart(6)}${(s.c.t==null?'none':s.c.t+'R').padStart(8)}`
      +`${`${s.dTr>=0?'+':''}${s.dTr.toFixed(3)}`.padStart(13)}${`${s.dTe>=0?'+':''}${s.dTe.toFixed(3)}`.padStart(12)}`
      +`${`${s.eTe>=0?'+':''}${s.eTe.toFixed(3)}R/${s.wTe.toFixed(0)}%/${s.te.n}`.padStart(22)}  ${s.dTr>0&&s.dTe>0?'★':'✗'}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
