import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const K = process.env.FINNHUB_API_KEY ?? '';  // never hardcode — this repo is public
const q=async(s:string)=>{try{const r=await fetch(`https://finnhub.io/api/v1/quote?symbol=${s}&token=${K}`);const d:any=await r.json();return typeof d.c==='number'&&d.c>0?d.c:null;}catch{return null;}};
const APPLY = process.argv.includes('--apply');
(async()=>{
  const r:any=await db.execute(sql`
    select id,symbol,direction,entry_price ep,target_price tp,stop_loss sl,outcome_status os
    from trade_ideas where outcome_status='open'`);
  const rows=(r.rows||r) as any[];
  const syms=Array.from(new Set(rows.map(x=>String(x.symbol))));
  const px=new Map<string,number>();
  for(const s of syms){const p=await q(s); if(p)px.set(s,p); await new Promise(z=>setTimeout(z,1100));}
  const bad:any[]=[];
  for(const x of rows){
    const live=px.get(String(x.symbol)); if(!live) continue;
    const ep=Number(x.ep); if(!Number.isFinite(ep)||ep<=0) continue;
    const drift=Math.abs(live-ep)/live;
    if(drift>0.35) bad.push({...x,live,drift});
  }
  console.log(`open ${rows.length} · quoted ${px.size} · CORRUPT (entry off live by >35%): ${bad.length}\n`);
  console.log(`${'sym'.padEnd(7)}${'entry'.padStart(11)}${'live'.padStart(11)}${'off by'.padStart(9)}`);
  bad.sort((a,b)=>b.drift-a.drift).forEach(x=>
    console.log(`${String(x.symbol).padEnd(7)}${Number(x.ep).toFixed(2).padStart(11)}${x.live.toFixed(2).padStart(11)}${(x.drift*100).toFixed(0).padStart(8)}%`));
  if(!APPLY){ console.log('\n(dry run — pass --apply to write)'); process.exit(0); }
  for(const x of bad){
    await db.execute(sql`
      update trade_ideas
      set outcome_status='expired',
          analysis = coalesce(analysis,'') || ${'\n\n[VOIDED — CORRUPT ENTRY] stored entry $'+Number(x.ep).toFixed(2)+' vs live $'+x.live.toFixed(2)+' ('+(x.drift*100).toFixed(0)+'% off). Entry and target were written from different price sources; the levels never described a real trade. Voided so it cannot resolve into a fake win or loss.'}
      where id = ${x.id}`);
  }
  console.log(`\n✅ voided ${bad.length} corrupt rows (marked expired, not deleted)`);
  process.exit(0);
})();
