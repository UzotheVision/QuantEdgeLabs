/**
 * GAP-FILL — is "short the overnight gap up into the fill" a real, universal edge?
 *
 * The operator's case: META gapped +3.55% on settlement news, flushed −4.8% off
 * the open into a full gap fill, then bounced +2.5% to close. Two trades in one
 * session, and on options that is the 3-4x they described.
 *
 * The platform had META stored as a SHORT and blocked it — short-discipline
 * requires an impact:'high' catalyst row and only 3 of 1,165 rows qualify. So a
 * short gated ON events missed an event-driven short.
 *
 * This asks whether the PATTERN pays without needing the news to be classified,
 * which is the whole argument for detecting it universally rather than
 * whitelisting catalysts.
 *
 * Trade modelled honestly: SHORT AT THE OPEN of the gap bar (that is the only
 * price a scanner could actually get), cover at whichever comes first —
 *   • the fill  (prior close), or
 *   • the close (if it never fills)
 * Stop = a further adverse move above the open.
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';

type B={o:number;h:number;l:number;c:number;v:number};
const S=5;

async function main(){
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const d:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=120) d[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(d);

  for(const GAP of [1.5,2.5,4.0]){
    for(const STOP of [2,3,5]){
      const sl:number[][]=Array.from({length:S},()=>[]);
      let fills=0,stops=0,n=0;
      for(const sym of syms){
        const b=d[sym]; const span=b.length-1;
        for(let i=1;i<b.length;i++){
          const p=b[i-1],c=b[i];
          if(p.c<=0||c.o<=0)continue;
          const gap=((c.o-p.c)/p.c)*100;
          if(gap<GAP)continue;
          n++;
          const stopPx=c.o*(1+STOP/100);
          let r:number;
          if(c.h>=stopPx){ r=-STOP; stops++; }              // stopped out above
          else if(c.l<=p.c){ r=((c.o-p.c)/c.o)*100; fills++; } // covered at the fill
          else { r=((c.o-c.c)/c.o)*100; }                    // covered at the close
          sl[Math.min(S-1,Math.floor((i/span)*S))].push(r);
        }
      }
      const all=sl.flat();
      const avg=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
      const pos=sl.filter(x=>x.length>=20&&avg(x)>0).length;
      const wr=all.filter(x=>x>0).length/Math.max(all.length,1)*100;
      console.log(`gap>=${GAP.toFixed(1)}% stop ${STOP}%  n=${String(all.length).padStart(5)}  avg ${(avg(all)>=0?'+':'')+avg(all).toFixed(2)}%  win ${wr.toFixed(0)}%  filled ${(fills/Math.max(n,1)*100).toFixed(0)}%  stopped ${(stops/Math.max(n,1)*100).toFixed(0)}%  slices+ ${pos}/${S}`);
    }
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
