import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

(async () => {
  const r: any = await db.execute(sql`
    SELECT option_type, strike_price, expiry_date, entry_price, entry_premium,
           target_price, stop_loss, exit_price, exit_premium, outcome_status,
           realized_pnl, option_percent_gain, percent_gain, timestamp
    FROM trade_ideas
    WHERE upper(symbol)='AFRM' AND outcome_status IN ('hit_target','hit_stop')
    ORDER BY timestamp`);
  console.log('\n\n########## AFRM RESOLVED ##########');
  for (const x of ((r.rows ?? r) as any[])) {
    const k = Number(x.strike_price), paid = Number(x.entry_premium);
    const exitUnd = Number(x.exit_price);
    const intrinsic = String(x.option_type).toLowerCase().startsWith('c')
      ? Math.max(0, exitUnd - k) : Math.max(0, k - exitUnd);
    console.log(
      `\n  ${String(x.timestamp).slice(5,19)}  $${k} ${x.option_type} ${String(x.expiry_date).slice(0,10)}  → ${x.outcome_status}`);
    console.log(`    underlying ${x.entry_price} → ${exitUnd}   premium paid $${paid.toFixed(2)}`);
    console.log(`    intrinsic at exit $${intrinsic.toFixed(2)}  =>  ${intrinsic - paid >= 0 ? '+' : ''}$${((intrinsic - paid) * 100).toFixed(0)}/contract  (${(((intrinsic - paid) / paid) * 100).toFixed(0)}%)`);
    console.log(`    platform recorded: realized_pnl=${x.realized_pnl}  option_pct_gain=${x.option_percent_gain}  pct_gain=${x.percent_gain}`);
  }
  process.exit(0);
})();
