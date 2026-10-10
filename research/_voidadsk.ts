import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any = await db.execute(sql`
    update trade_ideas
    set outcome_status='expired',
        analysis = coalesce(analysis,'') || ${'\n\n[VOIDED BY OPERATOR REVIEW] Published bullish, but the platform engine grades ADSK C/57 HOLD with a Death Cross (SMA50 9% under SMA200), and the stock ran +5.77% into tonight\'s print — consuming most of the ±7.9% implied move before the event. The ranking that produced this idea placed ADSK third of three and called it the richest premium with no directional edge; publishing it long contradicted that conclusion.'}
    where upper(symbol)='ADSK' and source='manual' and outcome_status='open'
    returning symbol`);
  console.log(`voided ${((r.rows??r) as any[]).length} ADSK manual row(s)`);
  const c:any = await db.execute(sql`
    select symbol, direction, entry_price ep, target_price tp, stop_loss sl
    from trade_ideas where source='manual' and outcome_status='open'`);
  console.log('\nmanual adds still live:');
  for (const x of (c.rows??c) as any[])
    console.log(`  ${x.symbol.padEnd(6)} ${x.direction.padEnd(8)} entry $${Number(x.ep).toFixed(2)}  T1 $${Number(x.tp).toFixed(2)}  stop $${Number(x.sl).toFixed(2)}`);
  process.exit(0);
})();
