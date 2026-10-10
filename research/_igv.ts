import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
(async()=>{
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(12);
  for(const s of ['IGV','SMH','XLK','FBTC','GBTC','SPY']){
    const b=raw.get(s); if(!b||b.length<6){console.log(`${s}: no bars`);continue;}
    const t=b.slice(-6);
    const chg=t.map((x,i,a)=>i===0?null:((x.close-a[i-1].close)/a[i-1].close*100)).slice(1);
    console.log(`${s.padEnd(5)} ${chg.map(c=>((c!>=0?'+':'')+c!.toFixed(1)+'%').padStart(7)).join('')}`);
  }
  console.log('\n        (oldest → newest, last 5 completed sessions)');
  process.exit(0);
})();
