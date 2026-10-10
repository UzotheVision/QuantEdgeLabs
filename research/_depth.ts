import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
(async()=>{
  await loadLiquidUniverseFromDisk();
  for (const d of [70,150,260]) {
    const raw = await getUniverseBars(d);
    const lens = [...raw.values()].map(v=>v.length).filter(n=>n>0).sort((a,b)=>a-b);
    console.log(`request ${d}d → names ${raw.size}  aligned(min) ${lens[0]??0}  median ${lens[Math.floor(lens.length/2)]??0}  max ${lens[lens.length-1]??0}`);
  }
})();
