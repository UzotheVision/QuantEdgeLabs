import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select symbol,direction,catalyst,confidence_score cs,risk_reward_ratio rr,
           entry_price ep,target_price tp,stop_loss sl,status,outcome_status os,timestamp
    from trade_ideas where status='active' or outcome_status='open' order by timestamp desc`);
  const rows=(r.rows||r) as any[];
  console.log(`OPEN BOOK: ${rows.length} ideas\n`);

  const dir:Record<string,number>={};rows.forEach(x=>dir[x.direction]=(dir[x.direction]??0)+1);
  console.log('direction:',JSON.stringify(dir));

  const dup:Record<string,number>={};rows.forEach(x=>dup[x.symbol]=(dup[x.symbol]??0)+1);
  const repeats=Object.entries(dup).filter(([,n])=>n>1).sort((a,z)=>z[1]-a[1]);
  console.log(`\nDUPLICATES: ${repeats.length} symbols appear more than once`);
  console.log('  ',repeats.slice(0,12).map(([s,n])=>`${s}x${n}`).join('  '));
  console.log(`  total duplicate rows: ${repeats.reduce((s,[,n])=>s+n-1,0)} of ${rows.length}`);

  const cat:Record<string,number>={};
  rows.forEach(x=>{const k=String(x.catalyst||'').replace(/\([^)]*\)/,'').trim().slice(0,34)||'(none)';cat[k]=(cat[k]??0)+1;});
  console.log('\nCATALYST CONCENTRATION:');
  Object.entries(cat).sort((a,z)=>z[1]-a[1]).slice(0,8).forEach(([k,n])=>console.log(`  ${String(n).padStart(4)}  ${k}`));

  const cs=rows.map(x=>Number(x.cs)).filter(Number.isFinite).sort((a,b)=>a-b);
  console.log(`\nCONFIDENCE: min ${cs[0]} p50 ${cs[Math.floor(cs.length/2)]} max ${cs[cs.length-1]}`);
  const band:Record<string,number>={};cs.forEach(v=>{const k=v>=90?'90+':v>=80?'80s':v>=70?'70s':v>=60?'60s':'<60';band[k]=(band[k]??0)+1;});
  console.log('  spread:',JSON.stringify(band));

  const rr=rows.map(x=>({s:x.symbol,rr:Number(x.rr),ep:Number(x.ep),tp:Number(x.tp),sl:Number(x.sl)}))
    .filter(x=>Number.isFinite(x.rr));
  const big=rr.filter(x=>x.rr>5).sort((a,z)=>z.rr-a.rr);
  console.log(`\nR:R > 5 : ${big.length} of ${rr.length} ideas`);
  big.slice(0,8).forEach(x=>{
    const movePct=x.ep>0?((x.tp-x.ep)/x.ep)*100:0;
    console.log(`  ${x.s.padEnd(6)} ${x.rr.toFixed(2)}R  entry ${x.ep.toFixed(2)} → target ${x.tp.toFixed(2)}  (${movePct>=0?'+':''}${movePct.toFixed(1)}% move required)`);
  });
  process.exit(0);
})();
