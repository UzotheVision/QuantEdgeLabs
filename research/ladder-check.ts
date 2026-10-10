import 'dotenv/config';
import { buildTargetLadder } from '../server/target-ladder';
(async () => {
  for (const x of [
    { symbol: 'KEYS', direction: 'long' as const, entry: 354.42, stop: 335.43, publishedTarget: 392.4, holdingPeriod: 'swing' },
    { symbol: 'META', direction: 'long' as const, entry: 754.58, stop: 741, publishedTarget: 781, holdingPeriod: 'swing' },
    { symbol: 'GOOG', direction: 'short' as const, entry: 338, stop: 345, publishedTarget: 324, holdingPeriod: 'swing' },
  ]) {
    const l = await buildTargetLadder(x);
    console.log(`\n${x.symbol} ${x.direction} entry ${x.entry} stop ${x.stop} | ATR ${l?.atr} range(${l?.horizonDays}d) ±${l?.expectedRange}`);
    for (const r of l?.rungs ?? []) console.log(`  ${r.rung} $${r.price}  ${r.source}  ${r.rMultiple}R  ${r.rangeMultiple}×range  touch ${Math.round(r.probTouch * 100)}%`);
    console.log('  published:', l?.publishedTarget, '→', l?.publishedTargetNote);
  }
  process.exit(0);
})();
