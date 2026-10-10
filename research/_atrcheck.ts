import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
type B={o:number;h:number;l:number;c:number;v:number};
const sma=(a:number[],n:number,e:number)=>{if(e-n<0)return null;let s=0;for(let i=e-n;i<e;i++)s+=a[i];return s/n;};
const vt=(b:B[],i:number,x:number)=>{const av=sma(b.map(z=>z.v),20,i);return !!av&&av>0&&b[i].v>=av*x&&b[i].c>b[i-1].c;};
const mA=(b:B[],i:number,n:number)=>{const m=sma(b.map(z=>z.c),n,i+1);return !!m&&b[i].c>m;};
const hiF=(b:B[],i:number)=>{const hi=Math.max(...b.slice(Math.max(0,i-251),i+1).map(z=>z.h));return hi>0?b[i].c/hi:1;};
const sc=(b:B[],i:number)=>{const r=b[i].h-b[i].l;return r>0&&(b[i].c-b[i].l)/r>=0.8;};
function atr(b:B[],i:number,n=14){let s=0;for(let k=i-n+1;k<=i;k++)s+=Math.max(b[k].h-b[k].l,Math.abs(b[k].h-b[k-1].c),Math.abs(b[k].l-b[k-1].c));return s/n;}
const avg=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
(async()=>{
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const d:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=140) d[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(d); const START=60,S=5;
  for(const MX of [2.5,3,3.5,4,5,99]){
    const sl:number[][]=Array.from({length:S},()=>[]);
    const names=new Set<string>();
    for(const sym of syms){const b=d[sym];const END=b.length-5;const span=END-START;if(span<S*5)continue;
      for(let i=START;i<=END;i++){
        let f=false;try{f=vt(b,i,2.5)&&mA(b,i,20)&&mA(b,i,50)&&hiF(b,i)<0.90&&!sc(b,i)&&(atr(b,i)/b[i].c)*100<=MX;}catch{}
        if(!f)continue;
        const e=b[i].c,last=Math.min(i+3,b.length-1);
        const und=((b[last].c-e)/e)*100;
        const prem=-4+und*0.65*7-1.0*3;
        sl[Math.min(S-1,Math.floor(((i-START)/span)*S))].push(prem);
        names.add(sym);
      }}
    const all=sl.flat();
    const pos=sl.filter(x=>x.length>=5&&avg(x)>0).length;
    console.log(`ATR<=${String(MX).padStart(3)}%  n=${String(all.length).padStart(4)}  names=${String(names.size).padStart(3)}  avg ${avg(all)>=0?'+':''}${avg(all).toFixed(1)}%  slices+ ${pos}/${S}  [${sl.map(x=>x.length?avg(x).toFixed(0):'—').join(' ')}]  n/slice [${sl.map(x=>x.length).join(' ')}]`);
  }
})();
