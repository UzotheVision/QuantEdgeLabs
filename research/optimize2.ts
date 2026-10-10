/**
 * OPTIMIZE v2 — same search, honest units, and stability across time slices.
 *
 * TWO CORRECTIONS TO v1
 *
 * 1. R IS NOT COMPARABLE ACROSS STOP WIDTHS. v1 ranked exits by expectancy in R
 *    and concluded a 1.0×ATR stop was best (+0.806R). But R = profit / risk, and
 *    a tighter stop shrinks the denominator — so any winner mechanically posts a
 *    bigger R. The win rate gave it away: that "best" config won 30% of the time.
 *    Ranking by R while varying the stop is a search for the smallest denominator,
 *    not the best trade. Everything here is measured in PERCENT RETURN, which is
 *    what the account actually receives, with R shown alongside for reference.
 *
 * 2. HALVES ARE NOT ENOUGH. v1 showed train edge +0.036 against test edge +0.412
 *    on the same rule. Test outperforming train by 10× is not overfitting, it is
 *    regime dependence — the rule works in one period and barely in the other.
 *    So this splits history into FIVE consecutive slices and requires an edge in
 *    most of them. A config that only pays in slice 5 is a config fitted to
 *    slice 5.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type B={o:number;h:number;l:number;c:number;v:number};
const sma=(a:number[],n:number,e:number)=>{if(e-n<0)return null;let s=0;for(let i=e-n;i<e;i++)s+=a[i];return s/n;};
const vt=(b:B[],i:number,x:number)=>{const av=sma(b.map(z=>z.v),20,i);return !!av&&av>0&&b[i].v>=av*x&&b[i].c>b[i-1].c;};
const a20=(b:B[],i:number)=>{const m=sma(b.map(z=>z.c),20,i+1);return !!m&&b[i].c>m;};
const hiFrac=(b:B[],i:number)=>{const hi=Math.max(...b.slice(Math.max(0,i-251),i+1).map(z=>z.h));return hi>0?b[i].c/hi:1;};
function atr(b:B[],i:number,n=14){let s=0;for(let k=i-n+1;k<=i;k++)s+=Math.max(b[k].h-b[k].l,Math.abs(b[k].h-b[k-1].c),Math.abs(b[k].l-b[k-1].c));return s/n;}

/** Returns PERCENT return and R, so ranking can use % and report R. */
function mark(b:B[],i:number,stopMult:number,hold:number,target:number|null){
  const entry=b[i].c,a=atr(b,i);
  const stop=entry-a*stopMult,risk=entry-stop;
  if(!(risk>0)||!Number.isFinite(risk)||entry<=0)return null;
  const last=Math.min(i+hold,b.length-1); if(last<=i)return null;
  const tp=target!=null?entry+risk*target:null;
  for(let k=i+1;k<=last;k++){
    if(b[k].l<=stop) return {pct:((stop-entry)/entry)*100,r:-1};
    if(tp!=null&&b[k].h>=tp) return {pct:((tp-entry)/entry)*100,r:target!};
  }
  return {pct:((b[last].c-entry)/entry)*100,r:(b[last].c-entry)/risk};
}

type Acc={n:number;p:number;r:number;w:number};
const mk=():Acc=>({n:0,p:0,r:0,w:0});
const add=(a:Acc,m:{pct:number;r:number})=>{a.n++;a.p+=m.pct;a.r+=m.r;if(m.pct>0)a.w++;};
const pAvg=(a:Acc)=>a.n?a.p/a.n:0, rAvg=(a:Acc)=>a.n?a.r/a.n:0;

const SLICES=5;

async function main(){
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const data:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=140) data[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(data);
  const START=60;

  const STOPS=[1.0,1.5,2.0,2.5,3.0], HOLDS=[3,5,8,13], TGTS:(number|null)[]=[null,2,3];
  type E={s:number;h:number;t:number|null};
  const cfg:E[]=[];STOPS.forEach(s=>HOLDS.forEach(h=>TGTS.forEach(t=>cfg.push({s,h,t}))));
  const sig=cfg.map(c=>({c,sl:Array.from({length:SLICES},mk),all:mk()}));
  const base:Record<string,{sl:Acc[];all:Acc}>={};
  cfg.forEach(c=>base[`${c.s}|${c.h}|${c.t}`]={sl:Array.from({length:SLICES},mk),all:mk()});

  for(const sym of syms){
    const b=data[sym];const END=b.length-16;
    const span=END-START; if(span<SLICES*5)continue;
    for(let i=START;i<=END;i++){
      const sl=Math.min(SLICES-1,Math.floor(((i-START)/span)*SLICES));
      const fire=vt(b,i,2.5)&&hiFrac(b,i)<0.90&&a20(b,i);
      for(const s of sig){
        const m=mark(b,i,s.c.s,s.c.h,s.c.t); if(!m)continue;
        const k=`${s.c.s}|${s.c.h}|${s.c.t}`;
        add(base[k].sl[sl],m); add(base[k].all,m);
        if(fire){add(s.sl[sl],m);add(s.all,m);}
      }
    }
  }

  console.log(`${syms.length} names · entry = thrust2.5 + above20d + below 90% of 52w high · ${SLICES} time slices\n`);
  console.log(`${'stop'.padStart(5)}${'hold'.padStart(6)}${'tgt'.padStart(6)}${'PCT edge'.padStart(11)}${'exp%'.padStart(9)}${'win'.padStart(6)}${'R'.padStart(7)}${'n'.padStart(7)}   slices+`);
  const rows=cfg.map(c=>{
    const k=`${c.s}|${c.h}|${c.t}`; const s=sig.find(x=>x.c===c)!;
    const edge=pAvg(s.all)-pAvg(base[k].all);
    let pos=0; for(let i=0;i<SLICES;i++) if(s.sl[i].n>=25 && pAvg(s.sl[i])>pAvg(base[k].sl[i])) pos++;
    return {c,edge,exp:pAvg(s.all),win:s.all.n?(s.all.w/s.all.n)*100:0,r:rAvg(s.all),n:s.all.n,pos};
  }).filter(r=>r.n>=250).sort((a,z)=>z.edge-a.edge);

  for(const r of rows.slice(0,14)){
    console.log(`${r.c.s.toFixed(1).padStart(5)}${String(r.c.h).padStart(6)}${(r.c.t==null?'—':r.c.t+'R').padStart(6)}`
      +`${`${r.edge>=0?'+':''}${r.edge.toFixed(2)}%`.padStart(11)}${`${r.exp>=0?'+':''}${r.exp.toFixed(2)}%`.padStart(9)}`
      +`${`${r.win.toFixed(0)}%`.padStart(6)}${`${r.r>=0?'+':''}${r.r.toFixed(2)}`.padStart(7)}${String(r.n).padStart(7)}   ${r.pos}/${SLICES}${r.pos>=4?' ★':''}`);
  }
  console.log(`\n(edge = percent return above the SAME exit applied to every name — so it isolates the ENTRY, not the exit's arithmetic)`);
}
main().catch(e=>{console.error(e);process.exit(1);});
