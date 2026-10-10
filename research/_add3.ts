import 'dotenv/config';
(async()=>{
  const { ingestTradeIdea } = await import('../server/trade-idea-ingestion');
  const { getFinnhubQuote } = await import('../server/finnhub-adapter');
  const PLAN: any[] = [
    { sym:'AFRM', dir:'bullish', impl:0.112, sigs:[
      {type:'earnings_event',weight:14,description:'Earnings tonight AMC — EPS est 0.3504'},
      {type:'estimate_error',weight:15,description:'Analysts systematically low: beats +53.5%, +39.1%, +110.4%, +84.0% last 4 qtrs'},
      {type:'gap_history',weight:13,description:'4 of last 5 earnings gaps closed positive (avg +5.5%)'},
      {type:'iv_rich',weight:-8,description:'Implied ±11.2% vs realized avg 5.5% / max 8.7% — options 2.0x overpriced, IV 248%'},
    ]},
    { sym:'WDAY', dir:'bullish', impl:0.075, sigs:[
      {type:'earnings_event',weight:14,description:'Earnings tonight AMC — EPS est 2.6605'},
      {type:'beat_consistency',weight:12,description:'Beats ~4% every quarter: +4.0, +4.2, +4.1, +2.5 — priced in, guidance is the mover'},
      {type:'iv_fair',weight:10,description:'Implied ±7.5% vs realized max 9.0% — only one of the three not obviously rich'},
      {type:'gap_direction',weight:-10,description:'Only 1 of 5 earnings gaps closed positive — gaps down then grinds back'},
    ]},
    { sym:'ADSK', dir:'bullish', impl:0.079, sigs:[
      {type:'earnings_event',weight:14,description:'Earnings tonight AMC'},
      {type:'beat_consistency',weight:11,description:'Beats +3.1, +5.7, +4.8, +4.8 — steady, unremarkable'},
      {type:'iv_rich',weight:-12,description:'Implied ±7.9% vs realized avg 2.8% / max 4.8% — 2.8x overpriced, richest of the three'},
      {type:'gap_direction',weight:-6,description:'2 of 5 earnings gaps positive — no directional edge'},
    ]},
  ];
  for (const p of PLAN) {
    const q = await getFinnhubQuote(p.sym);
    if (!q) { console.log(`  ${p.sym}: no quote`); continue; }
    const r = await ingestTradeIdea({
      source:'manual', symbol:p.sym, assetType:'stock', direction:p.dir, holdingPeriod:'swing',
      currentPrice:q.price, signals:p.sigs,
      // LEVELS = the options market's own priced boundaries for tonight.
      // The generator refuses ideas without a structural target and
      // invalidation, correctly — and on an earnings night the implied move IS
      // the structure. Nothing else on the chart survives an 8pm print.
      targetPrice: Number((q.price*(1+p.impl)).toFixed(2)),
      stopLoss: Number((q.price*(1-p.impl)).toFixed(2)),
      catalyst:`Operator add · earnings tonight AMC · ${p.sigs[1].description.slice(0,90)}`,
      analysis:`Manually added at $${q.price.toFixed(2)} ahead of tonight's print. ${p.sigs.map((s:any)=>s.description).join(' | ')}`,
    } as any).catch((e:any)=>({success:false,reason:e?.message}));
    console.log(`  ${p.sym.padEnd(6)} $${q.price.toFixed(2).padStart(8)}  → ${r.success?'✅ ON THE BOARD':'blocked: '+String((r as any).reason).slice(0,72)}`);
    await new Promise(z=>setTimeout(z,1200));
  }
  process.exit(0);
})();
