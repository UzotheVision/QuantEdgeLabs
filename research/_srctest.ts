import 'dotenv/config';
(async()=>{
  const { ingestTradeIdea } = await import('../server/trade-idea-ingestion');
  const { getFinnhubQuote } = await import('../server/finnhub-adapter');
  const q = await getFinnhubQuote('ADSK');
  const r:any = await ingestTradeIdea({
    source:'manual', symbol:'ADSK', assetType:'stock', direction:'bearish', holdingPeriod:'swing',
    currentPrice:q!.price,
    targetPrice: Number((q!.price*0.921).toFixed(2)),
    stopLoss: Number((q!.price*1.079).toFixed(2)),
    signals:[
      {type:'engine_grade',weight:13,description:'Platform engine: C/57 HOLD — Death Cross, SMA50 9% below SMA200'},
      {type:'premium_rich',weight:14,description:'Implied ±7.9% vs realized avg 2.8% / max 4.8% — 2.8x overpriced'},
      {type:'exhaustion',weight:13,description:'Ran +5.77% into the print, consuming most of the implied move pre-event'},
      {type:'no_edge',weight:11,description:'Only 2 of 5 prior earnings gaps closed positive'},
    ],
    catalyst:'Operator add · ADSK short into earnings — richest premium of the three, no directional edge',
    analysis:`Re-added SHORT at $${q!.price.toFixed(2)} after the bullish version was voided on review.`,
  } as any).catch((e:any)=>({success:false,reason:e?.message}));
  console.log(`ADSK bearish → ${r.success?'✅ published':'blocked: '+String(r.reason).slice(0,70)}`);
  const { db } = await import('../server/db');
  const { sql } = await import('drizzle-orm');
  const c:any = await db.execute(sql`
    select symbol,source,direction,round(extract(epoch from (now()-timestamp::timestamptz))/60)::int m
    from trade_ideas order by timestamp desc limit 3`);
  console.log('\nnewest 3 rows:');
  for(const x of (c.rows??c) as any[]) console.log(`  ${String(x.symbol).padEnd(6)} source=${String(x.source).padEnd(10)} ${x.direction}  ${x.m}m ago`);
  process.exit(0);
})();
