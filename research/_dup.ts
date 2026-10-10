import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select symbol, count(*)::int n, count(distinct source)::int srcs,
           string_agg(distinct source,',') sources,
           min(timestamp)::text lo, max(timestamp)::text hi
    from trade_ideas where status='active' or outcome_status='open'
    group by symbol having count(*)>1 order by 2 desc limit 10`);
  console.log('sym    n  srcs  sources                                  window');
  for(const x of (r.rows||r)) console.log(`${x.symbol.padEnd(6)}${String(x.n).padStart(2)}${String(x.srcs).padStart(6)}  ${String(x.sources).slice(0,38).padEnd(40)}${String(x.lo).slice(11,16)}..${String(x.hi).slice(11,16)}`);
  process.exit(0);
})();
