import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
type B={o:number;h:number;l:number;c:number;v:number};
(async()=>{
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const d:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=120) d[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const r:number[]=[]; const flush:number[]=[];
  for(const sym of Object.keys(d)){const b=d[sym];
    for(let i=1;i<b.length;i++){const p=b[i-1],c=b[i];
      if(p.c<=0||c.o<=0)continue;
      const gap=((c.o-p.c)/p.c)*100; if(gap<4)continue;
      const stopPx=c.o*1.05;
      let x:number;
      if(c.h>=stopPx) x=-5;
      else if(c.l<=p.c) x=((c.o-p.c)/c.o)*100;
      else x=((c.o-c.c)/c.o)*100;
      r.push(x);
      flush.push(((c.o-c.l)/c.o)*100);   // max intraday flush from the open
    }}
  r.sort((a,b)=>a-b); flush.sort((a,b)=>a-b);
  const q=(a:number[],p:number)=>a[Math.floor(a.length*p)];
  const avg=(a:number[])=>a.reduce((x,y)=>x+y,0)/a.length;
  console.log(`gap>=4%, stop 5%, n=${r.length}`);
  console.log(`  realised short return  p10 ${q(r,.10).toFixed(1)}  p25 ${q(r,.25).toFixed(1)}  MED ${q(r,.5).toFixed(1)}  p75 ${q(r,.75).toFixed(1)}  p90 ${q(r,.90).toFixed(1)}  p99 ${q(r,.99).toFixed(1)}`);
  console.log(`  mean ${avg(r).toFixed(2)}%`);
  for(const t of [2,3,5,8]) console.log(`  trades returning >= +${t}% : ${(r.filter(x=>x>=t).length/r.length*100).toFixed(1)}%`);
  console.log(`\n  MAX INTRADAY FLUSH from the open (what a scalper could have caught):`);
  console.log(`  p25 ${q(flush,.25).toFixed(1)}%  MED ${q(flush,.5).toFixed(1)}%  p75 ${q(flush,.75).toFixed(1)}%  p90 ${q(flush,.90).toFixed(1)}%  p99 ${q(flush,.99).toFixed(1)}%`);
  console.log(`  flushed >=3% at some point: ${(flush.filter(x=>x>=3).length/flush.length*100).toFixed(0)}%   >=5%: ${(flush.filter(x=>x>=5).length/flush.length*100).toFixed(0)}%`);
})();
