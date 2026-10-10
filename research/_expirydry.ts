import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const H:Record<string,number>={day:1,swing:5,'week-ending':5,position:30};
const cal=(s:number)=>s<=1?1:Math.ceil(s*1.45);
(async()=>{
  const r:any=await db.execute(sql`
    select id,symbol,holding_period hp,timestamp,convergence_signals_json csj,
           extract(epoch from (now()-timestamp::timestamptz))/86400 age_d
    from trade_ideas where outcome_status='open' and archived=false`);
  const rows=(r.rows||r) as any[];
  let exp=0, kept=0, live=0;
  const byHp:Record<string,{e:number;k:number}>={};
  const sample:any[]=[];
  for(const x of rows){
    const hp=String(x.hp??'').toLowerCase();
    const sess=H[hp]??10;
    const age=Number(x.age_d);
    byHp[hp||'(none)']=byHp[hp||'(none)']||{e:0,k:0};
    let state:string|undefined;
    try{ state=(typeof x.csj==='string'?JSON.parse(x.csj):x.csj)?.executionAudit?.state; }catch{}
    if(state==='executed'){live++;byHp[hp||'(none)'].k++;continue;}
    const dEnd=(a:number,b:number)=>new Date(a).toISOString().slice(0,10)!==new Date(b).toISOString().slice(0,10);
    const pub=Date.now()-age*86400000;
    const stale = hp==='day' ? dEnd(pub,Date.now()) : age>cal(sess);
    if(stale){exp++;byHp[hp||'(none)'].e++;if(sample.length<10)sample.push({s:x.symbol,hp,age:age.toFixed(1),lim:cal(sess)});}
    else {kept++;byHp[hp||'(none)'].k++;}
  }
  console.log(`open ${rows.length}  →  would EXPIRE ${exp}   keep ${kept}   skipped (executed) ${live}\n`);
  console.log(`${'holding'.padEnd(14)}${'expire'.padStart(8)}${'keep'.padStart(7)}${'limit(cal days)'.padStart(17)}`);
  Object.entries(byHp).forEach(([k,v])=>console.log(`${k.padEnd(14)}${String(v.e).padStart(8)}${String(v.k).padStart(7)}${String(cal(H[k]??10)).padStart(17)}`));
  console.log('\nsample of what would go:');
  sample.forEach(x=>console.log(`  ${x.s.padEnd(7)} ${x.hp.padEnd(10)} age ${x.age}d  > limit ${x.lim}d`));
  process.exit(0);
})();
