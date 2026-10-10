import 'dotenv/config';
(async()=>{
  const { APPROVED_TICKERS } = await import('@shared/approved-tickers');
  for (const s of ['WDAY','ADSK','AFRM']) console.log(`  ${s.padEnd(6)} ${APPROVED_TICKERS.has(s)?'approved':'✗ NOT approved'}`);
})();
