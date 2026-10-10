import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select
      count(*)::int total,
      count(entry_valid_until)::int has_valid_until,
      count(exit_by)::int has_exit_by,
      count(*) filter (where entry_valid_until is not null and entry_valid_until::timestamptz < now())::int entry_window_passed,
      count(*) filter (where exit_by is not null and exit_by::timestamptz < now())::int exit_by_passed
    from trade_ideas where status='active' or outcome_status='open'`);
  const x=(r.rows||r)[0];
  console.log('OPEN ideas:', x.total);
  console.log(`  have entry_valid_until : ${x.has_valid_until}   of those, window PASSED: ${x.entry_window_passed}`);
  console.log(`  have exit_by           : ${x.has_exit_by}   of those, exit_by PASSED: ${x.exit_by_passed}`);
  const h:any=await db.execute(sql`
    select holding_period hp, count(*)::int n,
           round(avg(extract(epoch from (now()-timestamp::timestamptz))/3600))::int avg_age_h
    from trade_ideas where status='active' or outcome_status='open' group by 1 order by 2 desc`);
  console.log('\nby holding period:');
  for(const y of (h.rows||h)) console.log(`  ${String(y.hp).padEnd(12)} n=${String(y.n).padStart(4)}  avg age ${y.avg_age_h}h`);
  process.exit(0);
})();
