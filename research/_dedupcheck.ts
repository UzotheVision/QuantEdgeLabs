import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  // exactly the query the new gate runs, for the worst offenders
  for (const [sym,src] of [['AFRM','quant'],['AMZN','quant'],['SNOW','quant'],['ZZZZ','quant']]) {
    const r:any=await db.execute(sql`
      select 1 from trade_ideas
      where upper(symbol)=${sym} and source=${src}
        and (status='active' or outcome_status='open') limit 1`);
    const blocked=((r.rows??r) as any[]).length>0;
    console.log(`  ${sym.padEnd(6)} source=${src.padEnd(6)} → ${blocked?'BLOCKED (already open)':'allowed'}`);
  }
  const t:any=await db.execute(sql`
    select count(*)::int total, count(distinct symbol||':'||source)::int distinct_pairs
    from trade_ideas where status='active' or outcome_status='open'`);
  const x=(t.rows??t)[0];
  console.log(`\n  open rows ${x.total}, distinct symbol+source pairs ${x.distinct_pairs}`);
  console.log(`  → gate would have prevented ${x.total-x.distinct_pairs} of the ${x.total} rows (${Math.round((x.total-x.distinct_pairs)/x.total*100)}%)`);
  process.exit(0);
})();
