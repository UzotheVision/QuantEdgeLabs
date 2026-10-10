import 'dotenv/config';
(async()=>{
  const m = await import('../server/liquid-universe');
  await m.loadLiquidUniverseFromDisk();
  const syms = m.getLiquidSymbols();
  console.log(`getLiquidSymbols(): ${syms.length}`);
  // peek at the ranked rows themselves
  const anyM = m as any;
  const rows = anyM.getRankedRows?.() ?? null;
  if (!rows) {
    // reach through the disk file instead
    const fs = await import('fs/promises');
    const path = await import('path');
    const guess = ['data/liquid-universe.json','.cache/liquid-universe.json','liquid-universe.json'];
    for (const g of guess) {
      try {
        const raw = JSON.parse(await fs.readFile(path.resolve(process.cwd(), g),'utf8'));
        const r = raw.rows ?? [];
        console.log(`disk ${g}: ${r.length} rows, saved ${new Date(raw.at??0).toISOString()}`);
        const withChg = r.filter((x:any)=>x.changePct!=null);
        const withVol = r.filter((x:any)=>Number(x.dollarVolume)>=25e6);
        console.log(`  rows with changePct: ${withChg.length}`);
        console.log(`  rows with dollarVolume >= $25M: ${withVol.length}`);
        console.log(`  sample row:`, JSON.stringify(r[0]));
        break;
      } catch {}
    }
  }
  process.exit(0);
})();
