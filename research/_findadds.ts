import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select symbol,source,direction,outcome_status os,status,entry_price ep,
           round(extract(epoch from (now()-timestamp::timestamptz))/60)::int min_ago
    from trade_ideas where upper(symbol) in ('ADSK','WDAY','AFRM')
    order by timestamp desc limit 12`);
  for(const x of (r.rows??r) as any[])
    console.log(`  ${String(x.symbol).padEnd(6)} src=${String(x.source).padEnd(15)} ${String(x.direction).padEnd(8)} os=${String(x.os).padEnd(10)} status=${String(x.status).padEnd(10)} $${Number(x.ep).toFixed(2).padStart(8)}  ${x.min_ago}m`);
  process.exit(0);
})();
