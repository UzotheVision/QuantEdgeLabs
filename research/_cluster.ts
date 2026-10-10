import 'dotenv/config';
import { loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
type B={o:number;h:number;l:number;c:number;v:number};
const sma=(a:number[],n:number,e:number)=>{if(e-n<0)return null;let s=0;for(let i=e-n;i<e;i++)s+=a[i];return s/n;};
const vt=(b:B[],i:number,x:number)=>{const av=sma(b.map(z=>z.v),20,i);return !!av&&av>0&&b[i].v>=av*x&&b[i].c>b[i-1].c;};
const mA=(b:B[],i:number,n:number)=>{const m=sma(b.map(z=>z.c),n,i+1);return !!m&&b[i].c>m;};
const hiF=(b:B[],i:number)=>{const hi=Math.max(...b.slice(Math.max(0,i-251),i+1).map(z=>z.h));return hi>0?b[i].c/hi:1;};
const sc=(b:B[],i:number)=>{const r=b[i].h-b[i].l;return r>0&&(b[i].c-b[i].l)/r>=0.8;};
const F=(b:B[],i:number)=>vt(b,i,2.5)&&mA(b,i,20)&&mA(b,i,50)&&hiF(b,i)<0.90&&!sc(b,i);
const CRYPTO=/^(BITU|BITX|BITO|FBTC|GBTC|IBIT|ARKB|BTCO|HODL|BRRR|BTF|ETHA|FETH|ETHE|ETHW|ETH|BTC|MSTR|MARA|RIOT|CLSK|HUT|BITF|CIFR|WULF|IREN|CORZ|BTDR|SDIG|GREE|COIN)$/i;
(async()=>{
  await loadLiquidUniverseFromDisk();
  const raw=await getUniverseBars(260);
  const d:Record<string,B[]>={};
  for(const [s,v] of raw.entries()) if(v.length>=140) d[s]=v.map(b=>({o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}));
  const syms=Object.keys(d);
  let tot=0,cry=0; const days:number[]=[];
  for(let back=4;back<=60;back++){
    let n=0,c=0;
    for(const s of syms){const b=d[s];const i=b.length-1-back;if(i<60||i+3>=b.length)continue;
      let f=false;try{f=F(b,i);}catch{} if(f){n++;tot++;if(CRYPTO.test(s)){c++;cry++;}}}
    if(n>0)days.push(c/n);
  }
  console.log(`signals ${tot} · crypto-proxy ${cry} (${(cry/tot*100).toFixed(0)}%)`);
  console.log(`sessions where >50% of signals were crypto proxies: ${days.filter(x=>x>0.5).length}/${days.length}`);
})();
