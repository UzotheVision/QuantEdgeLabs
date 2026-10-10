/** Manual leader-swing run: npx tsx research/run-leader-swing.ts */
import 'dotenv/config';
import { warmLiquidUniverse, loadLiquidUniverseFromDisk } from '../server/liquid-universe';
import { runLeaderSwingScan } from '../server/index-swing-scanner';
(async () => {
  await loadLiquidUniverseFromDisk().catch(() => {});
  await warmLiquidUniverse();
  const n = await runLeaderSwingScan();
  console.log('RESULT:', n, 'leader swing ideas'); process.exit(0);
})().catch((e) => { console.error('FAIL:', e?.message ?? e); process.exit(1); });
