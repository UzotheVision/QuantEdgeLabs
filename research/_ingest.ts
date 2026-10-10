import 'dotenv/config';
(async()=>{
  const { ingestBullFlagIdeas } = await import('../server/bull-flag-scanner');
  const n = await ingestBullFlagIdeas();
  console.log(`\ningested: ${n}`);
  const { db } = await import('../server/db');
  const { sql } = await import('drizzle-orm');
  const r:any = await db.execute(sql`
    select symbol, confidence_score cs, round(extract(epoch from (now()-timestamp::timestamptz))/60)::int min_ago
    from trade_ideas where outcome_status='open' and source='market_scanner'
    order by timestamp desc limit 20`);
  console.log('\nnewest market_scanner ideas:');
  for(const x of (r.rows||r)) console.log(`  ${String(x.symbol).padEnd(7)} conf ${String(x.cs).padStart(3)}  ${x.min_ago}m ago`);
  process.exit(0);
})();
