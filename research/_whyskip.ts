import 'dotenv/config';
(async()=>{
  const { getTopBullFlagSetups } = await import('../server/bull-flag-scanner');
  const { ingestTradeIdea } = await import('../server/trade-idea-ingestion');
  const all = await getTopBullFlagSetups(60);
  const want = new Set(['W','ETSY','IRDM','ASML','S','LITE']);
  const picks = all.filter((s:any)=>want.has(s.symbol));
  console.log(`testing ${picks.length} of the new names\n`);
  for (const s of picks as any[]) {
    const r = await ingestTradeIdea({
      source:'market_scanner', symbol:s.symbol, assetType:'stock', direction:'bullish',
      signals:s.signals.map((x:string,i:number)=>({type:`bull_flag_${i}`,weight:10,description:x})),
      holdingPeriod:'swing', currentPrice:s.currentPrice, targetPrice:s.targetPrice, stopLoss:s.stopLoss,
      catalyst:`bull flag ${s.score}`, analysis:'probe',
    } as any).catch((e:any)=>({success:false,reason:e?.message??String(e)}));
    console.log(`  ${String(s.symbol).padEnd(6)} score ${String(s.score).padStart(3)}  px ${Number(s.currentPrice).toFixed(2).padStart(9)}  → ${r.success?'PUBLISHED':'blocked: '+String((r as any).reason).slice(0,80)}`);
  }
  process.exit(0);
})();
