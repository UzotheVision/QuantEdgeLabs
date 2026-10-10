import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select outcome_status os, count(*)::int n from trade_ideas group by 1 order by 2 desc`);
  console.log('outcome_status now:');
  for(const x of (r.rows||r)) console.log(`  ${String(x.os).padEnd(12)} ${x.n}`);
  const e:any=await db.execute(sql`
    select symbol, holding_period hp, round(extract(epoch from (now()-timestamp::timestamptz))/3600)::int age_h
    from trade_ideas where outcome_status='expired' and analysis like '%HORIZON EXPIRY%' order by timestamp desc limit 8`);
  const rows=(e.rows||e);
  console.log(`\nexpired by the new horizon pass: ${rows.length}`);
  for(const x of rows) console.log(`  ${String(x.symbol).padEnd(7)} ${String(x.hp).padEnd(9)} ${x.age_h}h old`);
  process.exit(0);
})();
