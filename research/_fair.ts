import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select outcome_status os, count(*)::int n,
           count(exit_price)::int with_exit,
           avg(confidence_score)::numeric(6,1) avg_cs,
           min(timestamp)::text lo, max(timestamp)::text hi
    from trade_ideas group by 1 order by 2 desc`);
  console.log('outcome            n  w/exit  avg_cs   window');
  for(const x of (r.rows||r)) console.log(`${String(x.os).padEnd(12)}${String(x.n).padStart(5)}${String(x.with_exit).padStart(8)}${String(x.avg_cs).padStart(8)}   ${String(x.lo).slice(0,10)}..${String(x.hi).slice(0,10)}`);
  // are hit_target and hit_stop scored differently?
  const b:any=await db.execute(sql`
    select outcome_status os, avg(confidence_score)::numeric(6,1) cs, avg(risk_reward_ratio)::numeric(6,2) rr, count(*)::int n
    from trade_ideas where outcome_status in ('hit_target','hit_stop') group by 1`);
  console.log('\nscore/RR by resolution:');
  for(const x of (b.rows||b)) console.log(`  ${String(x.os).padEnd(11)} n=${String(x.n).padStart(4)}  avg_conf ${x.cs}  avg_RR ${x.rr}`);
  process.exit(0);
})();
