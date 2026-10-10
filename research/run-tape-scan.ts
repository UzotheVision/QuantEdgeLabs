/** Manual one-shot Bullflow tape sweep: npx tsx research/run-tape-scan.ts */
import 'dotenv/config';
import { runBullflowTapeScan } from '../server/bullflow-tape-scanner';

runBullflowTapeScan()
  .then((n) => { console.log('RESULT: published', n, 'tape ideas'); process.exit(0); })
  .catch((e) => { console.error('FAIL:', e?.message ?? e); process.exit(1); });
