import 'dotenv/config';
import { warmLiquidUniverse, loadLiquidUniverseFromDisk } from '../server/liquid-universe';
import { runPremiumDiscountScan } from '../server/index-swing-scanner';
(async () => { await loadLiquidUniverseFromDisk().catch(()=>{}); await warmLiquidUniverse(); const n = await runPremiumDiscountScan(); console.log('RESULT:', n); process.exit(0); })();
