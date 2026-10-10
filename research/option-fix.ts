/**
 * Can the edge be rescued for an option account? Three candidate fixes:
 *   A  drop the −50% premium stop, accept full premium risk, size smaller
 *   B  require LOW ATR names — the thrust filter selects 5.3% ATR, which is
 *      what makes the premium stop fire on noise
 *   C  longer-dated contracts, where theta and leverage are both gentler
 */
import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
type B={o:number;h:number;l:number;c:number;v:number};
const sma=(a:number[],n:number,e:number)=>{if(e-n<0)return null;let s=0;for(let i=e-n;i<e;i++)s+=a[i];return s/n;};
const vt=(b:B[],i:number,x:number)=>{const av=sma(b.map(z=>z.v),20,i);return !!av&&av>0&&b[i].v>=av*x&&b[i].c>b[i-1].c;};
const mA=(b:B[],i:number,n:number)=>{const m=sma(b.map(z=>z.c),n,i+1);return !!m&&b[i].c>m;};
const hiF=(b:B[],i:number)=>{const hi=Math.max(...b.slice(Math.max(0,i-251),i+1).map(z=>z.h));return hi>0?b[i].c/hi:1;};
const sc=(b:B[],i:number)=>{const r=b[i].h-b[i].l;return r>0&&(b[i].c-b[i].l)/r>=0.8;};
function atr(b:B[],i:number,n=14){let s=0;for(let k=i-n+1;k<=i;k++)s+=Math.max(b[k].h-b[k].l,Math.abs(b[k].h-b[k-1].c),Math.abs(b[k].l-b[k-1].c));return s/n;}
const FIRE=(b:B[],i:number,maxAtr=99)=>vt(b,i,2.5)&&mA(b,i,20)&&mA(b,i,50)&&hiF(b,i)<0.90&&!sc(b,i)&&(atr(b,i)/b[i].c)*100<=maxAtr;

function opt(b:B[],i:number,hold:number,delta:number,lev:number,theta:number,spread:number,premStop:number|null){
  const e=b[i].c; const last=Math.min(i+hold,b.length-1); if(last<=i)return null;
  let out=-spread*100;
  for(let k=i+1;k<=last;k++){
    if(premStop!=null){
      const worst=-spread*100+((b[k].l-e)/e)*100*delta*lev-theta*(k-i);
      if(worst<=premStop) return {pct:premStop-spread*100,stopped:true};
    }
    out=-spread*100+((b[k].c-e)/e)*100*delta*lev-theta*(k-i);
  }
  return {pct:Math.max(out,-100),stopped:false};
}
const avg=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const win=(a:number[])=>a.length?a.filter(v=>v>0).length/a.length*100:0;

async function main(){
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const d:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=140) d[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(d); const START=60, SPREAD=0.04;

  const VAR=[
    {n:'A  30-45DTE, NO premium stop     ',hold:3, dl:0.65,lev:7, th:1.0,ps:null as number|null,mx:99},
    {n:'A  30-45DTE, NO stop, hold 10    ',hold:10,dl:0.65,lev:7, th:1.0,ps:null,mx:99},
    {n:'B  ATR<3%, 30-45DTE, -50% stop   ',hold:3, dl:0.65,lev:7, th:1.0,ps:-50,mx:3},
    {n:'B  ATR<3%, 30-45DTE, NO stop     ',hold:3, dl:0.65,lev:7, th:1.0,ps:null,mx:3},
    {n:'B  ATR<2%, 30-45DTE, NO stop     ',hold:3, dl:0.65,lev:7, th:1.0,ps:null,mx:2},
    {n:'C  90DTE  (theta .35%/d, lev 4)  ',hold:10,dl:0.70,lev:4, th:0.35,ps:null,mx:99},
    {n:'C  90DTE, ATR<3%                 ',hold:10,dl:0.70,lev:4, th:0.35,ps:null,mx:3},
    {n:'C  LEAP ~1y (theta .12%/d, lev 3)',hold:20,dl:0.72,lev:3, th:0.12,ps:null,mx:99},
  ];
  console.log(`${'variant'.padEnd(36)}${'avg prem%'.padStart(11)}${'win'.padStart(7)}${'n'.padStart(7)}${'$ / $250'.padStart(10)}${'  stopped'}`);
  for(const v of VAR){
    const r:number[]=[]; let st=0;
    for(const sym of syms){const b=d[sym];
      for(let i=START;i<b.length-v.hold-1;i++){
        let f=false;try{f=FIRE(b,i,v.mx);}catch{} if(!f)continue;
        const o=opt(b,i,v.hold,v.dl,v.lev,v.th,SPREAD,v.ps);
        if(o){r.push(o.pct); if(o.stopped)st++;}}}
    console.log(`${v.n.padEnd(36)}${`${avg(r)>=0?'+':''}${avg(r).toFixed(1)}%`.padStart(11)}${`${win(r).toFixed(0)}%`.padStart(7)}${String(r.length).padStart(7)}${`${avg(r)>=0?'+':''}$${(250*avg(r)/100).toFixed(0)}`.padStart(10)}${v.ps==null?'      —':`   ${(st/Math.max(r.length,1)*100).toFixed(0)}%`}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1);});
