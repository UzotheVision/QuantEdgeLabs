import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select id,symbol,entry_price ep,target_price tp,stop_loss sl,risk_reward_ratio rr,status,outcome_status os
    from trade_ideas where (status='active' or outcome_status='open')`);
  const rows=(r.rows||r) as any[];
  const bad=rows.map(x=>{
    const ep=Number(x.ep),tp=Number(x.tp),sl=Number(x.sl);
    const move=ep>0?((tp-ep)/ep)*100:0;
    const stopPct=ep>0?((ep-sl)/ep)*100:0;
    return {...x,ep,tp,sl,move,stopPct};
  }).filter(x=>Math.abs(x.move)>30 || x.stopPct>40 || x.stopPct<0);
  console.log(`open ideas: ${rows.length}`);
  console.log(`IMPOSSIBLE GEOMETRY (target >30% away, or stop >40% away, or stop above entry): ${bad.length}\n`);
  console.log(`${'sym'.padEnd(7)}${'entry'.padStart(10)}${'target'.padStart(10)}${'stop'.padStart(10)}${'move req'.padStart(11)}${'stop dist'.padStart(11)}`);
  bad.sort((a,z)=>Math.abs(z.move)-Math.abs(a.move)).slice(0,12).forEach(x=>
    console.log(`${x.symbol.padEnd(7)}${x.ep.toFixed(2).padStart(10)}${x.tp.toFixed(2).padStart(10)}${x.sl.toFixed(2).padStart(10)}${(x.move.toFixed(0)+'%').padStart(11)}${(x.stopPct.toFixed(0)+'%').padStart(11)}`));
  console.log(`\nthese are ${(bad.length/rows.length*100).toFixed(0)}% of the open book and are being displayed as tradeable`);
  process.exit(0);
})();
