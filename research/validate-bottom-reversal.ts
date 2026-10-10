/**
 * Replay the bottom-reversal detector as-of each session of the missed
 * Sep 10-22 2026 semis run: for every winner + every BMT watchlist name,
 * print the FIRST date the detector would have fired, the pattern, and the
 * levels it would have stated. Also a selectivity check: how many hits the
 * latest session produces across the whole liquid universe (a detector that
 * flags 400 names is noise, not signal).
 *
 *   npx tsx research/validate-bottom-reversal.ts
 */
import 'dotenv/config';
import { warmLiquidUniverse, loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
import { detectBottomReversal } from '../server/bottom-reversal-scanner';

const WINNERS = ['MU', 'SNDK', 'WDC', 'RMBS', 'AEHR', 'COHU', 'ENTG', 'AVGO', 'SMH'];
const BMT = ['NNE', 'AFRM', 'VKTX', 'POET'];

async function main() {
  await loadLiquidUniverseFromDisk().catch(() => {});
  await warmLiquidUniverse();
  const bars = await getUniverseBars(60);
  console.log(`bars for ${bars.size} names\n`);

  console.log('── as-of replay: first fire date per symbol ──');
  for (const sym of [...WINNERS, ...BMT]) {
    const series = bars.get(sym);
    if (!series || series.length < 40) { console.log(`${sym.padEnd(5)} no bars in liquid universe`); continue; }
    let fired = false;
    for (let cut = 38; cut <= series.length; cut++) {
      const hit = detectBottomReversal(sym, series.slice(0, cut));
      if (hit) {
        const asOf = new Date(series[cut - 1].time * 1000).toISOString().slice(0, 10);
        console.log(
          `${sym.padEnd(5)} FIRES ${asOf}  ${hit.pattern.padEnd(17)} bottom $${hit.bottomLow.toFixed(2)} (${hit.bottomDate})  ` +
          `entry ~$${hit.entryZoneLow} stop $${hit.stop} T1 $${hit.t1} T2 $${hit.t2} [${hit.t2Basis}] score ${hit.score}`,
        );
        // Where did it go afterwards? Peak close after the fire, for honesty.
        const after = series.slice(cut);
        if (after.length) {
          const peak = Math.max(...after.map((b) => b.close));
          console.log(`${''.padEnd(5)}  → peak close after fire: $${peak.toFixed(2)} (${(((peak - hit.lastClose) / hit.lastClose) * 100).toFixed(1)}% from entry)`);
        }
        fired = true;
        break;
      }
    }
    if (!fired) console.log(`${sym.padEnd(5)} never fires in the window`);
  }

  console.log('\n── selectivity: hits across the whole universe at the latest session ──');
  let count = 0;
  const sample: string[] = [];
  for (const [sym, series] of bars.entries()) {
    const hit = detectBottomReversal(sym, series);
    if (hit) { count++; if (sample.length < 25) sample.push(`${sym}(${hit.pattern === 'v_recovery' ? 'V' : 'HL'}/${hit.score})`); }
  }
  console.log(`${count} hits of ${bars.size} scanned`);
  console.log(sample.join(' '));
  process.exit(0);
}
main();
