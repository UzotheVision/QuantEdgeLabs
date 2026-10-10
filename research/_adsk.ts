import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
(async()=>{
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  for(const s of ['ADSK','WDAY','AFRM']){
    const b=raw.get(s); if(!b) { console.log(`${s}: no bars`); continue; }
    const g=b.map((x,i)=>i===0?null:({gap:((x.open-b[i-1].close)/b[i-1].close)*100,
      total:((x.close-b[i-1].close)/b[i-1].close)*100})).filter(Boolean) as any[];
    const big=g.filter(x=>Math.abs(x.gap)>=4).slice(-5);
    const tot=big.map(x=>x.total);
    const absT=tot.map(Math.abs);
    console.log(`${s.padEnd(6)} last ${big.length} earnings-size gaps · total move: ${tot.map(t=>(t>=0?'+':'')+t.toFixed(1)).join('  ')}`);
    if(absT.length) console.log(`       avg |move| ${(absT.reduce((a,c)=>a+c,0)/absT.length).toFixed(1)}%   max ${Math.max(...absT).toFixed(1)}%   positive ${tot.filter(t=>t>0).length}/${tot.length}`);
  }
  process.exit(0);
})();
