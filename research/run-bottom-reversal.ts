/** Manual one-shot bottom-reversal sweep: npx tsx research/run-bottom-reversal.ts */
import 'dotenv/config';
import { warmLiquidUniverse, loadLiquidUniverseFromDisk } from '../server/liquid-universe';
import { runBottomReversalSweep } from '../server/bottom-reversal-scanner';

(async () => {
  await loadLiquidUniverseFromDisk().catch(() => {});
  await warmLiquidUniverse();
  const { hits, published } = await runBottomReversalSweep({ publish: true });
  console.log(`RESULT: ${published} published of ${hits.length} shapes; top: ${hits.slice(0, 8).map((h) => `${h.symbol}(${h.score})`).join(' ')}`);
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e?.message ?? e); process.exit(1); });
