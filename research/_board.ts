import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select symbol, direction, round(extract(epoch from (now()-timestamp::timestamptz))/60)::int min_ago
    from trade_ideas where outcome_status='open' order by timestamp desc limit 30`);
  const rows=(r.rows||r);
  const fresh=rows.filter((x:any)=>Number(x.min_ago)<20);
  console.log(`open ideas newest-first (${rows.length} shown), ${fresh.length} in the last 20 min:`);
  console.log('  ' + rows.map((x:any)=>`${x.symbol}${Number(x.min_ago)<20?'*':''}`).join(' '));
  console.log('\n  * = published in this session');
  process.exit(0);
})();
