/** Retire open reversal rows published before the $150M liquidity floor. */
import 'dotenv/config';
import { warmLiquidUniverse, loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
import pg from 'pg';

(async () => {
  await loadLiquidUniverseFromDisk().catch(() => {});
  await warmLiquidUniverse();
  const bars = await getUniverseBars(25);
  const FLOOR = 150e6;
  const candidates = ['CVCO','ULS','BOOT','CBRL','FRSH','UUUU','VFC','ALB','ETSY','DIOD'];
  const under: string[] = [];
  for (const s of candidates) {
    const series = bars.get(s);
    if (!series || !series.length) { under.push(s); continue; }
    const recent = series.slice(-20);
    const adv = recent.reduce((a, b) => a + b.close * b.volume, 0) / recent.length;
    console.log(s.padEnd(6), '$' + (adv / 1e6).toFixed(0) + 'M/day', adv < FLOOR ? '→ RETIRE' : '→ keeps its card');
    if (adv < FLOOR) under.push(s);
  }
  if (under.length) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    const r = await c.query(
      `UPDATE trade_ideas SET outcome_status='expired', resolution_reason='retired 2026-09-23: below the $150M/day liquidity floor adopted after publication'
       WHERE symbol = ANY($1) AND source='market_scanner' AND catalyst LIKE 'Higher-Lows Base%' AND (outcome_status='open' OR outcome_status IS NULL)
       RETURNING symbol`, [under]);
    console.log('retired rows:', r.rows.map((x) => x.symbol).join(', ') || 'none');
    await c.end();
  }
  process.exit(0);
})();
