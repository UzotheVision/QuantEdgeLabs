import 'dotenv/config';
(async()=>{
  const { getLiquidMovers, loadLiquidUniverseFromDisk } = await import('../server/liquid-universe');
  await loadLiquidUniverseFromDisk();
  for (const [g,v,d] of [[3,75e6,60],[2,50e6,60],[1,25e6,60]] as any[]) {
    let m:any[]=[];
    try{ m=getLiquidMovers(g,v,d); }catch(e:any){ console.log(`getLiquidMovers(${g},${v},${d}) THREW: ${e.message.slice(0,70)}`); continue; }
    console.log(`getLiquidMovers(gap>=${g}%, vol>=${v/1e6}M, ${d}d) → ${m.length} names`);
    if(m.length) console.log(`   ${m.slice(0,14).map((x:any)=>x.symbol).join(' ')}`);
  }
  const { getSectorTickers } = await import('../server/ticker-universe');
  for (const s of ['defense','nuclear','space','quantum']) {
    try{ const t=getSectorTickers(s); console.log(`sector "${s}" → ${t.length} names  ${t.slice(0,8).join(' ')}`); }
    catch(e:any){ console.log(`sector "${s}" THREW: ${e.message.slice(0,60)}`); }
  }
  process.exit(0);
})();
