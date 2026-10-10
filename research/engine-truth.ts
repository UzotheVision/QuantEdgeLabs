/**
 * ENGINE TRUTH — does our own conviction score predict money?
 *
 * Everything else in this folder tests hypotheses about the market. This tests
 * the PLATFORM: across 480 published ideas with recorded outcomes, does a higher
 * confidence_score actually produce a better result? If it does not, every
 * downstream ranking, band and filter is decoration.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

(async()=>{
  const r:any = await db.execute(sql`
    select symbol, direction, confidence_score cs, probability_band band, outcome_status os,
           entry_price ep, exit_price xp, target_price tp, stop_loss sl,
           realized_pnl pnl, entry_premium prem, status, timestamp
    from trade_ideas`);
  const rows = (r.rows||r) as any[];
  console.log(`total ideas: ${rows.length}`);

  const byOutcome:Record<string,number>={};
  rows.forEach(x=>{const k=x.os??'(null)';byOutcome[k]=(byOutcome[k]??0)+1;});
  console.log('outcome_status:', JSON.stringify(byOutcome));

  // Realised move on the UNDERLYING, direction-aware. Use exit vs entry where
  // both exist — that is the only ground truth in the table that is not derived.
  const done = rows.filter(x=>{
    const e=Number(x.ep), xx=Number(x.xp);
    return Number.isFinite(e)&&Number.isFinite(xx)&&e>0&&xx>0;
  }).map(x=>{
    const e=Number(x.ep), xx=Number(x.xp);
    const raw=((xx-e)/e)*100;
    const dir = String(x.direction||'').toLowerCase()==='short'?-1:1;
    const risk = Math.abs(e - Number(x.sl));
    const rmult = risk>0 ? (dir*(xx-e))/risk : null;
    return {...x, cs:Number(x.cs), move:raw*dir, rmult};
  });
  console.log(`ideas with entry AND exit: ${done.length}\n`);
  if(!done.length){console.log('no resolved ideas — cannot test');process.exit(0);}

  const csKnown = done.filter(d=>Number.isFinite(d.cs));
  console.log(`with confidence_score: ${csKnown.length}  range ${Math.min(...csKnown.map(d=>d.cs))}..${Math.max(...csKnown.map(d=>d.cs))}`);

  const bucket=(c:number)=> c>=85?'85+':c>=75?'75-84':c>=65?'65-74':c>=55?'55-64':'<55';
  const order=['85+','75-84','65-74','55-64','<55'];
  const agg:Record<string,{n:number;s:number;w:number;r:number;rn:number}>={};
  order.forEach(b=>agg[b]={n:0,s:0,w:0,r:0,rn:0});
  for(const d of csKnown){
    const b=bucket(d.cs), a=agg[b];
    a.n++; a.s+=d.move; if(d.move>0)a.w++;
    if(d.rmult!=null&&Number.isFinite(d.rmult)){a.r+=d.rmult;a.rn++;}
  }
  console.log(`\n${'confidence'.padEnd(12)}${'n'.padStart(6)}${'avg move'.padStart(11)}${'win%'.padStart(8)}${'avg R'.padStart(9)}`);
  for(const b of order){
    const a=agg[b]; if(!a.n)continue;
    console.log(`${b.padEnd(12)}${String(a.n).padStart(6)}${((a.s/a.n)>=0?'+':'')+(a.s/a.n).toFixed(2)+'%'.padStart(1)}`.padEnd(29)
      +`${((a.w/a.n)*100).toFixed(0)}%`.padStart(8)+`${a.rn?((a.r/a.rn)>=0?'+':'')+(a.r/a.rn).toFixed(2):'—'}`.padStart(9));
  }

  // Rank correlation: does higher score really mean better result?
  const xs=csKnown.map(d=>d.cs), ys=csKnown.map(d=>d.move);
  const rank=(v:number[])=>{const idx=v.map((x,i)=>[x,i]).sort((a,b)=>a[0]-b[0]);const rk=Array(v.length);idx.forEach(([,i],p)=>rk[i as number]=p+1);return rk as number[];};
  const rx=rank(xs), ry=rank(ys), n=xs.length;
  const mx=rx.reduce((s,v)=>s+v,0)/n, my=ry.reduce((s,v)=>s+v,0)/n;
  let num=0,dx=0,dy=0;
  for(let i=0;i<n;i++){num+=(rx[i]-mx)*(ry[i]-my);dx+=(rx[i]-mx)**2;dy+=(ry[i]-my)**2;}
  const rho=num/Math.sqrt(dx*dy);
  console.log(`\nSpearman rank correlation (confidence vs realised move): ${rho.toFixed(3)}  n=${n}`);
  console.log(rho>0.15?'  → score carries real ranking information'
    : rho<-0.15?'  → score is INVERTED — higher confidence did worse'
    : '  → NO monotone relationship. The score does not rank outcomes.');

  const all=csKnown;
  const avg=all.reduce((s,d)=>s+d.move,0)/all.length;
  const wr=all.filter(d=>d.move>0).length/all.length*100;
  const rr=all.filter(d=>d.rmult!=null);
  console.log(`\nWHOLE BOOK: avg move ${avg>=0?'+':''}${avg.toFixed(2)}%  win ${wr.toFixed(0)}%  avg R ${rr.length?(rr.reduce((s,d)=>s+d.rmult!,0)/rr.length).toFixed(2):'—'}  n=${all.length}`);
  process.exit(0);
})();
