import 'dotenv/config';
(async()=>{
  const { scanBullFlagPullbacks } = await import('../server/bull-flag-scanner');
  const out = await scanBullFlagPullbacks();
  console.log(`\nbull-flag setups found: ${out.length}`);
  const SAAS=new Set(['CRM','NOW','SNOW','PLTR','DDOG','NET','CRWD','ZS','MDB','PANW','S','OKTA','HUBS','BILL','PCOR','CFLT','MNDY']);
  const saas=out.filter((x:any)=>SAAS.has(x.symbol));
  console.log(`  of which hand-list SaaS: ${saas.length}`);
  console.log(`  NEW (not in the old hand-list): ${out.filter((x:any)=>!SAAS.has(x.symbol)).length}`);
  out.slice(0,24).forEach((x:any)=>console.log(`   ${String(x.symbol).padEnd(6)} score ${String(x.score).padStart(3)} ${x.grade}  prior leg +${Number(x.priorLegPercent).toFixed(0)}%  pullback -${Number(x.pullbackPercent).toFixed(1)}%`));
  process.exit(0);
})();
