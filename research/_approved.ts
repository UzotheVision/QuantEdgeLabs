import 'dotenv/config';
(async()=>{
  const { APPROVED_TICKERS, getAllApprovedSymbols } = await import('@shared/approved-tickers');
  const all = getAllApprovedSymbols();
  console.log(`approved universe: ${all.length} symbols`);
  for (const s of ['W','ETSY','IRDM','ASML','S','LITE','NET','MDB','SHOP','SNOW','ACHR']) {
    console.log(`  ${s.padEnd(6)} ${APPROVED_TICKERS.has(s) ? 'APPROVED' : '✗ NOT APPROVED'}`);
  }
  process.exit(0);
})();
