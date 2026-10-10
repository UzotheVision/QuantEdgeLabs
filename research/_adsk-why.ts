import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

(async () => {
  const r: any = await db.execute(sql`
    SELECT id, symbol, source, status, outcome_status, direction, trade_type,
           entry_price, target_price, stop_loss, confidence_score, option_type,
           strike_price, expiry_date, timestamp, catalyst, analysis,
           gen_conviction_score, gen_conviction_band, gen_scoring_layers,
           quality_signals, data_source_used, engine_version, holding_period
    FROM trade_ideas
    WHERE symbol IN ('ADSK','WDAY','AFRM')
    ORDER BY timestamp DESC
    LIMIT 25
  `);
  const rows = r.rows ?? r;
  console.log('\n\n########## ADSK/WDAY/AFRM BOOK ##########');
  console.log('rows:', rows.length);
  for (const x of rows) {
    console.log(`\n--- ${x.symbol} ${x.direction ?? ''} ${x.option_type ?? ''} ${x.strike_price ?? ''} ${x.expiry_date ?? ''}`);
    console.log(`    id=${x.id}  source=${x.source}  status=${x.status}/${x.outcome_status}  conf=${x.confidence_score} genConv=${x.gen_conviction_score}/${x.gen_conviction_band}`);
    console.log(`    entry=${x.entry_price} target=${x.target_price} stop=${x.stop_loss}  type=${x.trade_type} hold=${x.holding_period}`);
    console.log(`    created=${x.timestamp}  src_used=${x.data_source_used} eng=${x.engine_version}`);
    const t = [x.catalyst, x.analysis].filter(Boolean).join(' || ');
    if (t) console.log(`    thesis: ${t.slice(0, 500)}`);
    if (x.gen_scoring_layers) console.log(`    layers: ${JSON.stringify(x.gen_scoring_layers).slice(0, 400)}`);
    if (x.quality_signals) console.log(`    quality: ${JSON.stringify(x.quality_signals).slice(0, 300)}`);
  }
  process.exit(0);
})();
