import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

(async () => {
  const r: any = await db.execute(sql`
    SELECT source, COUNT(*) n,
           SUM(CASE WHEN outcome_status='open' THEN 1 ELSE 0 END) opn
    FROM trade_ideas
    WHERE timestamp::timestamptz > NOW() - INTERVAL '24 hours'
    GROUP BY source ORDER BY n DESC`);
  console.log('\n### last 24h by source ###');
  for (const x of (r.rows ?? r)) console.log(`  ${String(x.source).padEnd(18)} ${x.n} rows, ${x.opn} open`);

  const a: any = await db.execute(sql`
    SELECT symbol, option_type, COUNT(*) n FROM trade_ideas
    WHERE outcome_status='open'
    GROUP BY symbol, option_type HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 15`);
  console.log('\n### duplicate OPEN positions ###');
  for (const x of (a.rows ?? a)) console.log(`  ${String(x.symbol).padEnd(8)} ${String(x.option_type).padEnd(6)} ${x.n} open rows`);

  const t: any = await db.execute(sql`
    SELECT COUNT(*) n FROM trade_ideas WHERE outcome_status='open'`);
  console.log(`\ntotal open: ${(t.rows ?? t)[0].n}`);
  process.exit(0);
})();
