/**
 * YESTERDAY — what would the platform have done, and would it have made money?
 *
 * Simulates the decision, not the hypothesis. For each recent session we take
 * the bar the scanner would have closed on, apply a candidate rule, size the
 * position the way this account actually sizes ($250 options budget, −50%
 * premium stop), and mark it out on real forward bars.
 *
 * Compared head to head:
 *   RULE   thrust2.5 + above20d + NOT near-52w-high   (best from sweep.ts, edge +1.61)
 *   BASE   every liquid name that day                 (what "no selection" earns)
 *
 * Exits are modelled two ways because the live book's own numbers say the exit
 * rule is where the money goes: hit_target trades averaged RR 1.60 while
 * hit_stop trades averaged RR 3.86. Ambitious targets are not free — price
 * reaches the stop first. So we test a FIXED 5-day hold against a bracket that
 * takes 1.5R, and let the data say which the engine should be using.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type B={o:number;h:number;l:number;c:number;v:number};
const sma=(a:number[],n:number,e:number)=>{if(e-n<0)return null;let s=0;for(let i=e-n;i<e;i++)s+=a[i];return s/n;};
const vt=(b:B[],i:number,x:number)=>{const av=sma(b.map(z=>z.v),20,i);return !!av&&av>0&&b[i].v>=av*x&&b[i].c>b[i-1].c;};
const a20=(b:B[],i:number)=>{const m=sma(b.map(z=>z.c),20,i+1);return !!m&&b[i].c>m;};
const nearHi=(b:B[],i:number,p=0.95)=>{const hi=Math.max(...b.slice(Math.max(0,i-251),i+1).map(z=>z.h));return b[i].c>=hi*p;};
const RULE=(b:B[],i:number)=>vt(b,i,2.5)&&a20(b,i)&&!nearHi(b,i);

/** ATR-based stop, the way the level engine does it. */
function atr(b:B[],i:number,n=14){let s=0;for(let k=i-n+1;k<=i;k++){const tr=Math.max(b[k].h-b[k].l,Math.abs(b[k].h-b[k-1].c),Math.abs(b[k].l-b[k-1].c));s+=tr;}return s/n;}

/** Mark out a long from bar i. Returns R multiple. */
function markout(b:B[],i:number,mode:'hold5'|'bracket15',rMult=1.5){
  const entry=b[i].c, a=atr(b,i);
  const stop=entry-a*1.5, risk=entry-stop;
  if(!(risk>0))return null;
  const target=entry+risk*rMult;
  const last=Math.min(i+5,b.length-1);
  if(mode==='hold5'){ return (b[last].c-entry)/risk; }
  for(let k=i+1;k<=last;k++){
    if(b[k].l<=stop) return -1;           // stop first (conservative: same-bar stop wins)
    if(b[k].h>=target) return rMult;
  }
  return (b[last].c-entry)/risk;
}

async function main(){
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const data:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=120) data[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(data);
  const minLen=Math.min(...syms.map(s=>data[s].length));

  const BUDGET=250;        // per-trade options budget from prefs
  const PREMIUM_STOP=0.5;  // engine's own −50% premium stop
  const SESSIONS=20;       // last 20 decidable sessions

  for(const mode of ['hold5','bracket15'] as const){
    let rule={n:0,r:0,w:0}, base={n:0,r:0,w:0};
    const perDay:{d:number;n:number;r:number}[]=[];
    for(let s=6;s<6+SESSIONS;s++){
      const dayR:number[]=[];
      for(const sym of syms){
        const b=data[sym]; const i=b.length-1-s;
        if(i<60||i+5>=b.length)continue;
        const bm=markout(b,i,mode); if(bm==null)continue;
        base.n++; base.r+=bm; if(bm>0)base.w++;
        let hit=false; try{hit=RULE(b,i);}catch{}
        if(hit){ rule.n++; rule.r+=bm; if(bm>0)rule.w++; dayR.push(bm); }
      }
      perDay.push({d:s,n:dayR.length,r:dayR.reduce((x,y)=>x+y,0)});
    }
    const exp=(o:{n:number;r:number;w:number})=>o.n?{e:o.r/o.n,w:(o.w/o.n)*100,n:o.n}:{e:0,w:0,n:0};
    const R=exp(rule), Bs=exp(base);
    console.log(`\n=== EXIT MODE: ${mode==='hold5'?'fixed 5-day hold':'bracket, take 1.5R or stop'} ===`);
    console.log(`  RULE      expectancy ${R.e>=0?'+':''}${R.e.toFixed(3)}R   win ${R.w.toFixed(0)}%   n=${R.n}`);
    console.log(`  BASELINE  expectancy ${Bs.e>=0?'+':''}${Bs.e.toFixed(3)}R   win ${Bs.w.toFixed(0)}%   n=${Bs.n}`);
    console.log(`  edge      ${(R.e-Bs.e)>=0?'+':''}${(R.e-Bs.e).toFixed(3)}R per trade`);
    const dollarsPerR=BUDGET*PREMIUM_STOP;   // what 1R is worth in this account
    console.log(`  in dollars: 1R ≈ $${dollarsPerR.toFixed(0)} risked → ${R.e>=0?'+':''}$${(R.e*dollarsPerR).toFixed(0)} expected per trade`);
    const days=perDay.filter(d=>d.n>0);
    const avgSignalsPerDay=days.length? (perDay.reduce((s,d)=>s+d.n,0)/SESSIONS):0;
    console.log(`  fires on ${avgSignalsPerDay.toFixed(1)} names/day (${days.length}/${SESSIONS} sessions had at least one)`);
    if(mode==='bracket15'){
      console.log(`  → 20-session total if you took every one: ${(rule.r*dollarsPerR).toFixed(0)} dollars on ${rule.n} trades`);
    }
  }
  console.log(`\n(universe ${syms.length} names, shortest history ${minLen} bars)`);
}
main().catch(e=>{console.error(e);process.exit(1);});
