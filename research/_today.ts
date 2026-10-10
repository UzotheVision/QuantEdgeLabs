import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const K = process.env.FINNHUB_API_KEY ?? '';  // never hardcode — this repo is public
async function q(s:string){
  try{const r=await fetch(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${K}`);const d:any=await r.json();
    return (typeof d.c==='number'&&d.c>0)?{c:d.c,dp:d.dp,pc:d.pc}:null;}catch{return null;}
}
(async()=>{
  const r:any=await db.execute(sql`
    select distinct on (symbol) symbol,direction,entry_price ep,target_price tp,stop_loss sl,
           confidence_score cs, round(extract(epoch from (now()-timestamp::timestamptz))/3600)::int age_h
    from trade_ideas where outcome_status='open' order by symbol, timestamp desc`);
  const rows=(r.rows||r) as any[];
  console.log(`open book: ${rows.length} distinct symbols\n`);
  const out:any[]=[];
  for(const x of rows){
    const p=await q(x.symbol); await new Promise(z=>setTimeout(z,1100));
    if(!p) continue;
    const ep=Number(x.ep),tp=Number(x.tp),sl=Number(x.sl);
    const short=String(x.direction)==='short';
    const pnl = short ? (ep-p.c)/ep*100 : (p.c-ep)/ep*100;
    const hitT = short ? p.c<=tp : p.c>=tp;
    const hitS = short ? p.c>=sl : p.c<=sl;
    const prog = tp!==ep ? ((p.c-ep)/(tp-ep))*100 : 0;
    out.push({sym:x.symbol,dir:x.direction,ep,live:p.c,dayPct:p.dp,pnl,prog,hitT,hitS,age:x.age_h,cs:x.cs});
  }
  out.sort((a,b)=>b.pnl-a.pnl);
  console.log(`${'sym'.padEnd(7)}${'dir'.padEnd(6)}${'entry'.padStart(9)}${'live'.padStart(9)}${'today'.padStart(8)}${'vs entry'.padStart(10)}${'→T1'.padStart(8)}${'age'.padStart(6)}`);
  for(const o of out){
    const flag = o.hitT?' ★TARGET':o.hitS?' ✗STOP':'';
    console.log(`${o.sym.padEnd(7)}${o.dir.padEnd(6)}${o.ep.toFixed(2).padStart(9)}${o.live.toFixed(2).padStart(9)}${((o.dayPct>=0?'+':'')+o.dayPct.toFixed(1)+'%').padStart(8)}${((o.pnl>=0?'+':'')+o.pnl.toFixed(2)+'%').padStart(10)}${(o.prog.toFixed(0)+'%').padStart(8)}${(o.age+'h').padStart(6)}${flag}`);
  }
  const w=out.filter(o=>o.pnl>0).length;
  const avg=out.reduce((s,o)=>s+o.pnl,0)/Math.max(out.length,1);
  console.log(`\n  BOOK: ${w}/${out.length} green (${(w/Math.max(out.length,1)*100).toFixed(0)}%)   avg ${avg>=0?'+':''}${avg.toFixed(2)}% vs entry`);
  console.log(`  at target: ${out.filter(o=>o.hitT).length}   stopped: ${out.filter(o=>o.hitS).length}`);
  process.exit(0);
})();
