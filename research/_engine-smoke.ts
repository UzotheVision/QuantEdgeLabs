import 'dotenv/config';
import { universalEngine } from '../server/universal-analysis-engine';

const SYMS = ['NVDA','AMD','TSLA','AAPL','CRCL','PLTR','SMCI','MU','AVGO','SOFI','HOOD','COIN'];
const CATS = ['technical','fundamental','quantitative','ml','orderFlow','sentiment','catalysts'];

(async () => {
  const out: string[] = [];
  const liveCount: Record<string, number> = {};
  for (const c of CATS) liveCount[c] = 0;
  let ok = 0;

  for (const s of SYMS) {
    try {
      const r: any = await universalEngine.analyze(s);
      const c = r.components ?? {};
      const cells = CATS.map((k) => {
        const v = c[k];
        const sc = v?.score;
        const bd = v?.breakdown ?? [];
        const live = bd.length > 0 && !bd.every((b: any) =>
          b?.category === 'Error' || b?.value === 'N/A' || b?.value === 'Unknown') && v?.available !== false;
        if (live) liveCount[k]++;
        return `${String(sc).padStart(3)}${live ? ' ' : '*'}`;
      }).join(' ');
      out.push(`${s.padEnd(6)} ${String(r.overall?.score).padStart(3)} ${(r.overall?.grade ?? '').padEnd(3)} ${(r.overall?.recommendation ?? '').padEnd(4)} | ${cells}`);
      ok++;
    } catch (e: any) {
      out.push(`${s.padEnd(6)} FAILED ${e?.message}`);
    }
  }

  console.log('\n\n########## SMOKE ##########');
  console.log(`sym     scr gr  rec  | ${CATS.map(c => c.slice(0,4).padEnd(4)).join(' ')}   (* = no data)`);
  console.log(out.join('\n'));
  console.log(`\nanalysed ${ok}/${SYMS.length} without error`);
  console.log('live coverage per scorer:');
  for (const c of CATS) console.log(`  ${c.padEnd(14)} ${liveCount[c]}/${ok}`);
})();
