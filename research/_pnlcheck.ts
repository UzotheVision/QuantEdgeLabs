import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { computeRealisedPnl } from '../server/performance-validator';
(async()=>{
  const r:any=await db.execute(sql`
    select symbol,direction,outcome_status os,entry_price ep,exit_price xp,
           entry_premium eprem,exit_premium xprem,option_type ot,strike_price sp,asset_type at
    from trade_ideas where outcome_status in ('hit_target','hit_stop') limit 400`);
  const rows=(r.rows||r) as any[];
  let sum=0,n=0; const byBasis:Record<string,{n:number;s:number}>={};
  const sample:any[]=[];
  for(const x of rows){
    const idea={entryPrice:Number(x.ep),direction:x.direction,entryPremium:Number(x.eprem),
      exitPremium:Number(x.xprem),optionType:x.ot,strikePrice:Number(x.sp),assetType:x.at};
    const out=computeRealisedPnl(idea, Number(x.xp));
    if(!out) continue;
    n++; sum+=out.pnl;
    byBasis[out.basis]=byBasis[out.basis]||{n:0,s:0};
    byBasis[out.basis].n++; byBasis[out.basis].s+=out.pnl;
    if(sample.length<8) sample.push({sym:x.symbol,os:x.os,pnl:out.pnl,basis:out.basis,eprem:x.eprem});
  }
  console.log(`priced ${n} of ${rows.length} resolved trades\n`);
  console.log(`${'basis'.padEnd(18)}${'n'.padStart(6)}${'total $'.padStart(12)}${'avg $'.padStart(11)}`);
  Object.entries(byBasis).forEach(([k,v])=>
    console.log(`${k.padEnd(18)}${String(v.n).padStart(6)}${('$'+v.s.toFixed(0)).padStart(12)}${('$'+(v.s/v.n).toFixed(0)).padStart(11)}`));
  console.log(`\nBOOK TOTAL (1 contract each): ${sum>=0?'+':''}$${sum.toFixed(0)}   avg ${sum/n>=0?'+':''}$${(sum/n).toFixed(0)}/trade`);
  console.log('\nsamples:');
  sample.forEach(x=>console.log(`  ${String(x.sym).padEnd(6)} ${String(x.os).padEnd(11)} ${x.pnl>=0?'+':''}$${x.pnl.toFixed(0)}  (${x.basis}${x.eprem?`, prem $${Number(x.eprem).toFixed(2)}`:''})`));
  process.exit(0);
})();
