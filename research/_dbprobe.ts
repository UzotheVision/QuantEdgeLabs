import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  for (const tb of ['trade_ideas','signal_performance','trade_price_snapshots']) {
    try {
      const cols = await db.execute(sql.raw(`select column_name,data_type from information_schema.columns where table_name='${tb}' order by ordinal_position`));
      const names=(cols.rows||cols).map((r:any)=>r.column_name);
      const c = await db.execute(sql.raw(`select count(*)::int n from ${tb}`));
      console.log(`\n${tb}  n=${(c.rows||c)[0].n}`);
      console.log('  ', names.join(', ').slice(0,600));
    } catch(e:any){ console.log(tb,'ERR',e.message.slice(0,90)); }
  }
  process.exit(0);
})();
