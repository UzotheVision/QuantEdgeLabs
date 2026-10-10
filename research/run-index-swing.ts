/** Manual index-swing run: npx tsx research/run-index-swing.ts */
import 'dotenv/config';
import { warmLiquidUniverse, loadLiquidUniverseFromDisk } from '../server/liquid-universe';
import { runIndexSwingScan } from '../server/index-swing-scanner';
(async () => {
  await loadLiquidUniverseFromDisk().catch(() => {});
  await warmLiquidUniverse();
  const n = await runIndexSwingScan();
  console.log('RESULT:', n, 'index swing ideas'); process.exit(0);
})().catch((e) => { console.error('FAIL:', e?.message ?? e); process.exit(1); });
