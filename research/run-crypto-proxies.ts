/** Manual crypto-proxy promotion run: npx tsx research/run-crypto-proxies.ts */
import 'dotenv/config';
import { runCryptoProxyPromotion } from '../server/crypto-proxy-promoter';
runCryptoProxyPromotion()
  .then((n) => { console.log('RESULT:', n, 'proxy ideas published'); process.exit(0); })
  .catch((e) => { console.error('FAIL:', e?.message ?? e); process.exit(1); });
