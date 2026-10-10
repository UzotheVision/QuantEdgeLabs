import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select symbol,direction,outcome_status os,entry_price ep,target_price tp,stop_loss sl,
           exit_price xp,realized_pnl pnl,entry_premium prem,exit_premium xprem
    from trade_ideas where outcome_status in ('hit_target','hit_stop')`);
  const rows=(r.rows||r) as any[];
  let ok=0,bad=0; const problems:any[]=[];
  for(const x of rows){
    const ep=Number(x.ep),tp=Number(x.tp),sl=Number(x.sl),xp=Number(x.xp);
    const short=String(x.direction)==='short';
    if(!Number.isFinite(xp)||!Number.isFinite(ep)){bad++;problems.push({...x,why:'no exit/entry'});continue;}
    // does the recorded exit actually sit AT the level it claims to have hit?
    const near=(a:number,b:number)=>Math.abs(a-b)/Math.max(Math.abs(b),1e-9)<0.02;
    const claim=String(x.os);
    const matches = claim==='hit_target' ? near(xp,tp) : near(xp,sl);
    // and does the direction of the move agree with the claim?
    const moved = short ? (ep-xp) : (xp-ep);
    const dirOk = claim==='hit_target' ? moved>0 : moved<0;
    if(matches&&dirOk)ok++; else {bad++;problems.push({...x,why:!matches?`exit ${xp} not at ${claim==='hit_target'?'target '+tp:'stop '+sl}`:'move contradicts outcome'});}
  }
  console.log(`resolved trades: ${rows.length}`);
  console.log(`  outcome is INTERNALLY CONSISTENT : ${ok}`);
  console.log(`  outcome does NOT check out       : ${bad}\n`);
  problems.slice(0,10).forEach(x=>console.log(`  ${String(x.symbol).padEnd(6)} ${String(x.direction).padEnd(6)} ${String(x.os).padEnd(11)} entry ${Number(x.ep).toFixed(2)} exit ${Number(x.xp).toFixed(2)} tgt ${Number(x.tp).toFixed(2)} stop ${Number(x.sl).toFixed(2)}  → ${x.why}`));
  const w=rows.filter(x=>String(x.os)==='hit_target').length;
  console.log(`\n  claimed win rate: ${w}/${rows.length} = ${(w/rows.length*100).toFixed(0)}%`);
  const withPnl=rows.filter(x=>x.pnl!=null&&Number.isFinite(Number(x.pnl)));
  console.log(`  rows carrying realized_pnl: ${withPnl.length} of ${rows.length}`);
  process.exit(0);
})();
