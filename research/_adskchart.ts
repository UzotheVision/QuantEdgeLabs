import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
(async()=>{
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const b=raw.get('ADSK'); if(!b){console.log('no bars');process.exit(0);}
  const c=b.map(x=>x.close);
  const sma=(n:number)=>c.slice(-n).reduce((s,v)=>s+v,0)/n;
  const last=c[c.length-1];
  const hi52=Math.max(...b.slice(-252).map(x=>x.high));
  const lo52=Math.min(...b.slice(-252).map(x=>x.low));
  console.log(`ADSK  $${last.toFixed(2)}`);
  console.log(`  SMA20  $${sma(20).toFixed(2)}   ${last>sma(20)?'above':'BELOW'}`);
  console.log(`  SMA50  $${sma(50).toFixed(2)}   ${last>sma(50)?'above':'BELOW'}`);
  console.log(`  SMA200 $${sma(200).toFixed(2)}  ${last>sma(200)?'above':'BELOW'}`);
  console.log(`  50 vs 200: ${sma(50)>sma(200)?'golden':'DEATH CROSS'}  (${((sma(50)-sma(200))/sma(200)*100).toFixed(1)}%)`);
  console.log(`  52w high $${hi52.toFixed(2)}  → ${((last-hi52)/hi52*100).toFixed(1)}% below`);
  console.log(`  52w low  $${lo52.toFixed(2)}  → ${((last-lo52)/lo52*100).toFixed(1)}% above`);
  const r=(n:number)=>((last-c[c.length-1-n])/c[c.length-1-n]*100);
  console.log(`\n  returns: 5d ${r(5)>=0?'+':''}${r(5).toFixed(1)}%   20d ${r(20)>=0?'+':''}${r(20).toFixed(1)}%   60d ${r(60)>=0?'+':''}${r(60).toFixed(1)}%   120d ${r(120)>=0?'+':''}${r(120).toFixed(1)}%`);
  console.log(`\n  last 10 closes:`);
  console.log('   ' + b.slice(-10).map(x=>x.close.toFixed(0)).join(' → '));
  process.exit(0);
})();
