/** How far are published targets vs each stock's own expected range? */
import 'dotenv/config';
import pg from 'pg';
import { fetchCandles } from '../server/historical-candles';
(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const q = await c.query(`SELECT symbol, direction, holding_period, entry_price, target_price, stop_loss, source
    FROM trade_ideas WHERE (outcome_status='open' OR outcome_status IS NULL) AND timestamp > '2026-09-20'
    AND entry_price > 5 ORDER BY timestamp DESC LIMIT 40`);
  const rows: any[] = [];
  for (const r of q.rows) {
    const bars = await fetchCandles(r.symbol, '3mo', '1d');
    if (bars.length < 20) continue;
    const trs = bars.slice(-15).map((b, i, a) => i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - a[i - 1].close), Math.abs(b.low - a[i - 1].close)));
    const atr = trs.slice(1).reduce((x, y) => x + y, 0) / 14;
    const horizon = r.holding_period === 'day' ? 1 : r.holding_period === 'position' ? 30 : 10;
    const expMove = atr * Math.sqrt(horizon);
    const dist = Math.abs(r.target_price - r.entry_price);
    const risk = Math.abs(r.entry_price - r.stop_loss);
    const hi60 = Math.max(...bars.slice(-60).map((b) => b.high));
    rows.push({ sym: r.symbol, src: r.source, rr: (dist / risk).toFixed(1), targetInSigma: (dist / expMove).toFixed(2), beyond60dHigh: r.direction === 'long' && r.target_price > hi60 ? 'YES' : '' });
  }
  rows.sort((a, b) => +b.targetInSigma - +a.targetInSigma);
  console.table(rows);
  const over = rows.filter((r) => +r.targetInSigma > 1.5).length;
  console.log(`${over}/${rows.length} targets sit beyond 1.5x the stock's own expected range for the holding period`);
  await c.end(); process.exit(0);
})();
