import 'dotenv/config';
import { warmLiquidUniverse, loadLiquidUniverseFromDisk, getUniverseBars } from '../server/liquid-universe';
import { quoteWithDayLow } from '../server/bullflow-tape-scanner';
(async () => {
  await loadLiquidUniverseFromDisk().catch(() => {});
  await warmLiquidUniverse();
  const bars = await getUniverseBars(70);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  for (const sym of ['SPY', 'QQQ', 'IWM', 'DIA', 'SMH', 'IGV', 'XBI']) {
    let series = bars.get(sym)!;
    const lq = await quoteWithDayLow(sym);
    const lastBarDate = new Date(series[series.length - 1].time * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (lq && lastBarDate !== today) {
      series = [...series, { time: Math.floor(Date.now() / 1000), open: lq.prevClose || lq.last, high: Math.max(lq.last, lq.prevClose || lq.last), low: lq.low, close: lq.last, volume: 0 }];
    }
    const n = series.length;
    const closes = series.map((b) => b.close);
    const last = series[n - 1];
    const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const sma50Prev = closes.slice(-60, -10).reduce((a, b) => a + b, 0) / 50;
    const high20 = Math.max(...series.slice(-20).map((b) => b.high));
    const pb = (high20 - last.close) / high20;
    const stop5 = Math.min(...series.slice(-5).map((b) => b.low));
    const risk5 = (last.close - stop5) / last.close;
    console.log(`${sym.padEnd(4)} close ${last.close.toFixed(2)} | sma50 ${sma50.toFixed(2)} rising=${sma50 > sma50Prev} above=${last.close > sma50} | 20dHigh ${high20.toFixed(2)} pb ${(pb * 100).toFixed(2)}% | stop5 ${stop5.toFixed(2)} risk ${(risk5 * 100).toFixed(2)}% | bars ${n} liveAug=${lastBarDate !== today}`);
  }
  process.exit(0);
})();
