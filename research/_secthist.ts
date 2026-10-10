import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const SEC:Record<string,string>={
  NET:'software',MDB:'software',SNOW:'software',SHOP:'software',NOW:'software',DDOG:'software',
  PANW:'cyber',ZS:'cyber',CRWD:'cyber',S:'cyber',
  BILL:'fintech',AFRM:'fintech',HOOD:'fintech',SOFI:'fintech',COIN:'crypto',
  MSTR:'crypto',MARA:'crypto',RIOT:'crypto',CLSK:'crypto',IREN:'crypto',CIFR:'crypto',BITU:'crypto',
  BITX:'crypto',FBTC:'crypto',GBTC:'crypto',ETHA:'crypto',FETH:'crypto',BTC:'crypto',ETH:'crypto',
  NVDA:'semis',AMD:'semis',MU:'semis',ARM:'semis',AVGO:'semis',SOXX:'semis',SMH:'semis',MRVL:'semis',
  LITE:'optics',AAOI:'optics',COHR:'optics',CIEN:'optics',IPGP:'optics',
  MRNA:'biotech',LLY:'pharma',JNJ:'pharma',
  AMZN:'megatech',MSFT:'megatech',META:'megatech',AAPL:'megatech',GOOGL:'megatech',TSLA:'megatech',
  ACHR:'ev',RIVN:'ev',OKLO:'nuclear',SMR:'nuclear',LEU:'nuclear',UEC:'nuclear',CCJ:'nuclear',
};
(async()=>{
  const r:any=await db.execute(sql`
    select symbol, to_char(timestamp::timestamptz,'YYYY-MM-DD') d, count(*)::int n
    from trade_ideas group by 1,2 order by 2`);
  const rows=(r.rows||r) as any[];
  const byDay:Record<string,Record<string,number>>={};
  for(const x of rows){
    const sec=SEC[String(x.symbol).toUpperCase()]; if(!sec) continue;
    byDay[x.d]=byDay[x.d]||{};
    byDay[x.d][sec]=(byDay[x.d][sec]??0)+Number(x.n);
  }
  console.log('what the platform was calling, by day (classified names only):\n');
  for(const d of Object.keys(byDay).sort()){
    const e=Object.entries(byDay[d]).sort((a,b)=>b[1]-a[1]);
    const tot=e.reduce((s,[,v])=>s+v,0);
    const dow=new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'});
    console.log(`${d} ${dow}  n=${String(tot).padStart(3)}   ${e.slice(0,5).map(([k,v])=>`${k} ${v}`).join(' · ')}`);
  }
  process.exit(0);
})();
