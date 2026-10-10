import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select symbol,direction,source,entry_price ep,target_price tp,stop_loss sl,confidence_score cs
    from trade_ideas where (status='active' or outcome_status='open')`);
  const rows=(r.rows||r) as any[];
  let flip=0, agree=0, nulls=0;
  const bad:any[]=[];
  for(const x of rows){
    const ep=Number(x.ep),tp=Number(x.tp);
    if(!Number.isFinite(ep)||!Number.isFinite(tp)){nulls++;continue;}
    const inferred = tp>ep ? 'long':'short';
    const stored = String(x.direction);
    if(inferred!==stored){flip++;bad.push({...x,ep,tp,inferred,stored});}else agree++;
  }
  console.log(`open ideas ${rows.length}  ·  direction agrees ${agree}  ·  FLIPPED ${flip}  ·  unusable ${nulls}\n`);
  console.log(`${'sym'.padEnd(7)}${'stored'.padStart(7)}${'inferred'.padStart(10)}${'entry'.padStart(10)}${'target'.padStart(10)}   source`);
  bad.slice(0,14).forEach(x=>console.log(`${x.symbol.padEnd(7)}${x.stored.padStart(7)}${x.inferred.padStart(10)}${x.ep.toFixed(2).padStart(10)}${x.tp.toFixed(2).padStart(10)}   ${x.source}`));
  const shorts=rows.filter(x=>String(x.direction)==='short');
  const shortsFlipped=bad.filter(x=>x.stored==='short').length;
  console.log(`\nof ${shorts.length} stored SHORTS, ${shortsFlipped} get re-read as LONG by the inference`);
  process.exit(0);
})();
