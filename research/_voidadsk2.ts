import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any = await db.execute(sql`
    update trade_ideas
    set outcome_status='expired',
        analysis = coalesce(analysis,'') || ${'\n\n[VOIDED ON REVIEW] Published bullish in error. The platform engine grades ADSK C/57 HOLD on a Death Cross (SMA50 9% below SMA200), and the stock ran +5.77% into tonight\'s print, consuming most of the 7.9% implied move before the event. The ranking that produced this idea placed ADSK third of three — richest premium, no directional edge — so publishing it long contradicted its own conclusion.'}
    where upper(symbol)='ADSK' and outcome_status='open'
    returning symbol, entry_price`);
  const rows=(r.rows??r) as any[];
  console.log(`voided ${rows.length} ADSK row(s)`);
  const c:any = await db.execute(sql`
    select symbol,count(*)::int n from trade_ideas
    where outcome_status='open' and upper(symbol) in ('ADSK','WDAY','AFRM') group by 1`);
  console.log('\nstill open:');
  for (const x of (c.rows??c) as any[]) console.log(`  ${String(x.symbol).padEnd(6)} ${x.n} row(s)`);
  process.exit(0);
})();
