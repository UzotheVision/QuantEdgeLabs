import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
(async()=>{
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(20);
  const b=raw.get('META');
  if(!b){console.log('META not in universe bars');process.exit(0);}
  console.log(`META — last ${Math.min(10,b.length)} sessions\n`);
  console.log(`${'#'.padStart(3)}${'open'.padStart(9)}${'high'.padStart(9)}${'low'.padStart(9)}${'close'.padStart(9)}${'gap%'.padStart(8)}${'hi-lo%'.padStart(8)}${'close vs open'.padStart(14)}`);
  const s=b.slice(-10);
  for(let i=1;i<s.length;i++){
    const p=s[i-1],c=s[i];
    const gap=((c.open-p.close)/p.close)*100;
    const range=((c.high-c.low)/c.low)*100;
    const body=((c.close-c.open)/c.open)*100;
    console.log(`${String(i).padStart(3)}${c.open.toFixed(2).padStart(9)}${c.high.toFixed(2).padStart(9)}${c.low.toFixed(2).padStart(9)}${c.close.toFixed(2).padStart(9)}${(gap>=0?'+':'')+gap.toFixed(2)+'%'}`.padEnd(0)
      +`${((range).toFixed(1)+'%').padStart(8)}${((body>=0?'+':'')+body.toFixed(2)+'%').padStart(14)}`);
  }
  // gap-fill test: did any recent gap up get filled intraday?
  console.log(`\ngap-up-then-fill scan (gap >= +1.5%, then low <= prior close):`);
  let found=0;
  for(let i=1;i<b.length;i++){
    const p=b[i-1],c=b[i];
    const gap=((c.open-p.close)/p.close)*100;
    if(gap>=1.5){
      const filled=c.low<=p.close;
      const flushPct=((c.low-c.open)/c.open)*100;
      const bouncePct=((c.close-c.low)/c.low)*100;
      console.log(`  bar ${i}: gap +${gap.toFixed(2)}%  open ${c.open.toFixed(2)} → low ${c.low.toFixed(2)} (${flushPct.toFixed(1)}%)  ${filled?'FILLED':'not filled'}  then +${bouncePct.toFixed(1)}% off the low to ${c.close.toFixed(2)}`);
      found++;
    }
  }
  if(!found) console.log('  none in window');
  process.exit(0);
})();
