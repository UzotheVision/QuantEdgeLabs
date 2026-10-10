import 'dotenv/config';
/** Replay the reversal detector on curated small caps outside the liquid universe. */
import { detectBottomReversal } from '../server/bottom-reversal-scanner';
(async () => {
  const YF = (await import('yahoo-finance2')).default as any;
  const yf = new YF({ suppressNotices: ['yahooSurvey'] });
  for (const sym of ['POET', 'NNE']) {
    const r: any = await yf.chart(sym, { period1: new Date(Date.now() - 100 * 86400000), interval: '1d' });
    const bars = (r.quotes as any[])
      .filter((q) => [q.open, q.high, q.low, q.close].every(Number.isFinite))
      .map((q) => ({ time: Math.floor(new Date(q.date).getTime() / 1000), open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume || 0 }));
    let fired = false;
    for (let cut = 38; cut <= bars.length; cut++) {
      const hit = detectBottomReversal(sym, bars.slice(0, cut));
      if (hit) {
        const asOf = new Date(bars[cut - 1].time * 1000).toISOString().slice(0, 10);
        const after = bars.slice(cut);
        const peak = after.length ? Math.max(...after.map((b) => b.close)) : hit.lastClose;
        console.log(`${sym} FIRES ${asOf} ${hit.pattern} bottom $${hit.bottomLow.toFixed(2)} (${hit.bottomDate}) entry ~$${hit.entryZoneLow} stop $${hit.stop} → peak after: $${peak.toFixed(2)} (+${((peak / hit.lastClose - 1) * 100).toFixed(1)}%)`);
        fired = true; break;
      }
    }
    if (!fired) console.log(sym, 'never fires — pattern absent at our thresholds');
  }
  process.exit(0);
})();
