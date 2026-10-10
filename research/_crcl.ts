import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
(async()=>{
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(90);
  const b=raw.get('CRCL');
  if(!b){console.log('no CRCL bars');process.exit(0);}
  const s=b.slice(-45);
  const hi=Math.max(...s.map(x=>x.high));
  const lo=Math.min(...s.map(x=>x.low));
  const hiI=s.findIndex(x=>x.high===hi), loI=s.findIndex(x=>x.low===lo);
  const live=89.91;
  console.log(`CRCL — last 45 sessions`);
  console.log(`  swing high  $${hi.toFixed(2)}  (${s.length-hiI} bars ago)`);
  console.log(`  swing low   $${lo.toFixed(2)}  (${s.length-loI} bars ago)`);
  console.log(`  live        $${live}`);
  const up = hiI > loI;   // low then high = up leg
  console.log(`  leg: ${up?'LOW → HIGH (retracement levels below)':'HIGH → LOW (extension levels above)'}\n`);
  const rng=hi-lo;
  console.log('  FIB RETRACEMENT of the up leg:');
  for(const f of [0,0.236,0.382,0.5,0.618,0.786,1]){
    const p=hi-rng*f;
    const tag = Math.abs(p-live)/live<0.015 ? '  ← LIVE IS HERE' : '';
    console.log(`    ${(f*100).toFixed(1).padStart(5)}%   $${p.toFixed(2)}${tag}`);
  }
  console.log('\n  FIB EXTENSION above the high (upside targets):');
  for(const f of [1.272,1.414,1.618]) console.log(`    ${(f*100).toFixed(1)}%   $${(lo+rng*f).toFixed(2)}`);
  console.log('\n  last 8 sessions:');
  console.log(`  ${'o'.padStart(9)}${'h'.padStart(9)}${'l'.padStart(9)}${'c'.padStart(9)}${'chg%'.padStart(8)}`);
  s.slice(-8).forEach((x,i,a)=>{
    const p=i>0?a[i-1].close:x.open;
    console.log(`  ${x.open.toFixed(2).padStart(9)}${x.high.toFixed(2).padStart(9)}${x.low.toFixed(2).padStart(9)}${x.close.toFixed(2).padStart(9)}${(((x.close-p)/p*100)>=0?'+':'')+((x.close-p)/p*100).toFixed(1)+'%'}`);
  });
  process.exit(0);
})();
