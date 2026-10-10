import 'dotenv/config';
(async()=>{
  const { storage } = await import('../server/storage');
  const { isSubstantiveEventCatalyst } = await import('../server/short-discipline');
  const cats:any[] = await storage.getActiveCatalysts().catch((e:any)=>{console.log('feed ERROR:',e.message.slice(0,80));return [];});
  console.log(`active catalysts: ${cats.length}`);
  const sub = cats.filter((c:any)=>{try{return isSubstantiveEventCatalyst(c);}catch{return false;}});
  console.log(`qualifying as substantive (impact:high in window): ${sub.length}`);
  if(sub.length) console.log('  symbols:', Array.from(new Set(sub.map((c:any)=>String(c.symbol||'').toUpperCase()))).slice(0,20).join(' '));
  const shorts=['SPY','SMH','NIO','META','SPX','IWM','QQQ','TSLA'];
  const ok=new Set(sub.map((c:any)=>String(c.symbol||'').toUpperCase()));
  console.log(`\n  of our 8 distinct stored shorts, how many have a qualifying event:`);
  shorts.forEach(s=>console.log(`    ${s.padEnd(6)} ${ok.has(s)?'HAS event → allowed':'no event → BLOCKED'}`));
  process.exit(0);
})();
