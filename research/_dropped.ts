import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
(async()=>{
  const r:any=await db.execute(sql`
    select symbol,direction,source,confidence_score cs,status,outcome_status os,asset_type at,
           entry_price ep,target_price tp,stop_loss sl,timestamp
    from trade_ideas where status='active' or outcome_status='open' order by timestamp desc`);
  const rows=(r.rows||r) as any[];
  console.log(`OPEN in table: ${rows.length}`);
  const bySrc:Record<string,{n:number;long:number;short:number;minCs:number;maxCs:number}>={};
  for(const x of rows){
    const s=String(x.source||'?');
    bySrc[s]=bySrc[s]||{n:0,long:0,short:0,minCs:999,maxCs:-1};
    const b=bySrc[s]; b.n++;
    if(String(x.direction)==='short')b.short++;else b.long++;
    const c=Number(x.cs); if(Number.isFinite(c)){b.minCs=Math.min(b.minCs,c);b.maxCs=Math.max(b.maxCs,c);}
  }
  console.log(`\n${'source'.padEnd(22)}${'n'.padStart(5)}${'long'.padStart(6)}${'short'.padStart(7)}${'conf range'.padStart(13)}`);
  Object.entries(bySrc).sort((a,z)=>z[1].n-a[1].n).forEach(([s,b])=>
    console.log(`${s.padEnd(22)}${String(b.n).padStart(5)}${String(b.long).padStart(6)}${String(b.short).padStart(7)}${`${b.minCs}..${b.maxCs}`.padStart(13)}`));
  const shorts=rows.filter(x=>String(x.direction)==='short');
  console.log(`\nSHORTS in table: ${shorts.length}`);
  shorts.slice(0,8).forEach(x=>console.log(`  ${String(x.symbol).padEnd(6)} ${String(x.source).padEnd(16)} conf ${x.cs} at=${x.at}`));
  const at:Record<string,number>={}; rows.forEach(x=>at[String(x.at)]=(at[String(x.at)]??0)+1);
  console.log('\nasset_type spread:',JSON.stringify(at));
  process.exit(0);
})();
