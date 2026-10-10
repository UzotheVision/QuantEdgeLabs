import 'dotenv/config';
process.env.LOG_LEVEL = 'debug';
import { buildConvictions } from '../server/convictions-engine';

(async () => {
  const r = await buildConvictions({ limit: 40, minScore: 10 } as any);
  console.log('\n\n########## CONVICTIONS BUILD ##########');
  console.log('  scanned:', r.totalCandidatesScanned);
  console.log('  picks:', r.picks?.length ?? 0);
  for (const p of (r.picks ?? []).slice(0, 10)) {
    console.log(`   ${p.symbol} conv=${(p as any).convictionScore} state=${(p as any).lifecycleState}`);
  }
  process.exit(0);
})();
