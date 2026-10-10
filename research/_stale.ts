import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select symbol, direction, source, count(*)::int n,
           min(timestamp)::text first_seen, max(timestamp)::text last_seen,
           round(extract(epoch from (now() - min(timestamp::timestamptz)))/3600)::int age_h,
           max(confidence_score)::int cs
    from trade_ideas where status='active' or outcome_status='open'
    group by symbol,direction,source order by age_h desc limit 16`);
  console.log(`${'sym'.padEnd(7)}${'dir'.padEnd(7)}${'src'.padEnd(14)}${'rows'.padStart(5)}${'age(h)'.padStart(8)}${'conf'.padStart(6)}   first seen`);
  for(const x of (r.rows||r)) console.log(`${String(x.symbol).padEnd(7)}${String(x.direction).padEnd(7)}${String(x.source).padEnd(14)}${String(x.n).padStart(5)}${String(x.age_h).padStart(8)}${String(x.cs).padStart(6)}   ${String(x.first_seen).slice(0,16)}`);
  const a:any=await db.execute(sql`
    select round(extract(epoch from (now()-min(timestamp::timestamptz)))/3600)::int age_h, count(*)::int n
    from trade_ideas where status='active' or outcome_status='open'
    group by symbol having count(*)>0 order by 1 desc`);
  const ages=(a.rows||a).map((x:any)=>Number(x.age_h));
  console.log(`\nage of oldest row per symbol: max ${Math.max(...ages)}h  median ${ages.sort((x:number,y:number)=>x-y)[Math.floor(ages.length/2)]}h`);
  console.log(`symbols older than 24h: ${ages.filter((x:number)=>x>24).length} of ${ages.length}`);
  process.exit(0);
})();
