import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
(async()=>{
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  for(const s of ['WDAY','AFRM']){
    const b=raw.get(s); if(!b){console.log(`${s}: no bars`);continue;}
    // earnings reactions = the biggest overnight gaps in the series
    const gaps=b.map((x,i)=>i===0?null:({i,gap:((x.open-b[i-1].close)/b[i-1].close)*100,
      day:((x.close-x.open)/x.open)*100, full:((x.close-b[i-1].close)/b[i-1].close)*100,
      lo:((x.low-x.open)/x.open)*100, hi:((x.high-x.open)/x.open)*100}))
      .filter(Boolean) as any[];
    const big=gaps.filter(g=>Math.abs(g.gap)>=4).sort((a,z)=>z.i-a.i).slice(0,5);
    console.log(`\n${s}  (last ${b.length} sessions, gaps >=4% = likely earnings)`);
    console.log(`   ${'gap'.padStart(8)}${'open→close'.padStart(12)}${'total'.padStart(9)}${'worst intraday'.padStart(16)}`);
    for(const g of big) console.log(`   ${((g.gap>=0?'+':'')+g.gap.toFixed(1)+'%').padStart(8)}${((g.day>=0?'+':'')+g.day.toFixed(1)+'%').padStart(12)}${((g.full>=0?'+':'')+g.full.toFixed(1)+'%').padStart(9)}${(g.lo.toFixed(1)+'%').padStart(16)}`);
    if(!big.length) console.log('   none found');
    const abs=gaps.map(g=>Math.abs(g.gap)).sort((a,z)=>a-z);
    console.log(`   typical daily gap p50 ${abs[Math.floor(abs.length/2)].toFixed(2)}%  p95 ${abs[Math.floor(abs.length*0.95)].toFixed(2)}%`);
  }
  process.exit(0);
})();
