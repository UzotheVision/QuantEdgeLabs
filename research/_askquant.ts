import 'dotenv/config';
(async()=>{
  const { universalEngine } = await import('../server/universal-analysis-engine');
  const r:any = await universalEngine.analyze('ADSK', {} as any).catch((e:any)=>({error:e?.message}));
  if (r?.error) { console.log('engine error:', r.error.slice(0,120)); process.exit(0); }
  console.log(`ADSK — ${r.name ?? ''}`);
  console.log(`  OVERALL  ${r.overall?.grade}  score ${r.overall?.score}  ${r.overall?.recommendation}  (${r.overall?.confidence})`);
  console.log(`\n  components:`);
  for (const [k,v] of Object.entries(r.components ?? {})) {
    const c:any = v;
    console.log(`    ${k.padEnd(14)} ${String(c.score).padStart(3)}  ${String(c.grade??'').padEnd(3)} w${c.weight ?? '—'}`);
    for (const b of (c.breakdown ?? []).slice(0,3))
      console.log(`        · ${String(b.category).padEnd(26)} ${String(b.value).padEnd(12)} ${String(b.interpretation ?? '').slice(0,70)}`);
  }
  process.exit(0);
})();
