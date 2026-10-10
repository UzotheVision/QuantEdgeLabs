import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const bear=/bearish|breakdown|downtrend|selloff|gap down|distribution|sell-off/;
const bull=/bullish|breakout|uptrend|surge|gap up|accumulation|rally/;
(async()=>{
  const r:any=await db.execute(sql`
    select symbol,direction,source,catalyst,entry_price ep,target_price tp,stop_loss sl,
           status,outcome_status os,timestamp
    from trade_ideas where direction='short' and (status='active' or outcome_status='open')`);
  const rows=(r.rows||r) as any[];
  console.log(`stored shorts (open): ${rows.length}\n`);
  for(const x of rows){
    const e=Number(x.ep),t=Number(x.tp),s=Number(x.sl);
    const reasons:string[]=[];
    // rule 0: level coherence for a short → target < entry < stop
    const wrongSide = !(t<e && s>e);
    if(wrongSide) reasons.push(`levels: need target<entry<stop, got t=${t} e=${e} s=${s}`);
    const rr = Math.abs(e-s)>0 ? Math.abs(t-e)/Math.abs(e-s) : 999;
    if(rr>15) reasons.push(`R:R ${rr.toFixed(1)} > 15`);
    const txt=String(x.catalyst||'').toLowerCase();
    if(txt && bull.test(txt) && !bear.test(txt)) reasons.push(`catalyst reads bullish: "${String(x.catalyst).slice(0,40)}"`);
    console.log(`${String(x.symbol).padEnd(6)} ${String(x.source).padEnd(14)} ${reasons.length?'REJECT → '+reasons.join(' | '):'PASSES all three rules'}`);
  }
  process.exit(0);
})();
