import 'dotenv/config';
(async()=>{
  const m = await import('../server/liquid-universe');
  const n = await m.warmLiquidUniverse();
  console.log(`warmed ${n}`);
  for (const [g,v] of [[3,75e6],[2,50e6],[1,25e6]] as any[]) {
    const mv = m.getLiquidMovers(g, v, 60);
    console.log(`  movers gap>=${g}% vol>=$${v/1e6}M → ${mv.length}`);
    if (mv.length) console.log(`    ${mv.slice(0,16).map((x:any)=>`${x.symbol}${x.changePct>=0?'+':''}${x.changePct.toFixed(1)}%`).join(' ')}`);
  }
  process.exit(0);
})();
