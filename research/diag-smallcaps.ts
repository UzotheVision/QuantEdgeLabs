import 'dotenv/config';
(async () => {
  const YF = (await import('yahoo-finance2')).default as any;
  const yf = new YF({ suppressNotices: ['yahooSurvey'] });
  for (const sym of ['POET', 'NNE', 'VKTX', 'AVGO']) {
    const r: any = await yf.chart(sym, { period1: new Date(Date.now() - 100 * 86400000), interval: '1d' });
    const bars = (r.quotes as any[])
      .filter((q) => [q.open, q.high, q.low, q.close].every(Number.isFinite))
      .map((q) => ({ t: new Date(q.date).toISOString().slice(5, 10), o: q.open, h: q.high, l: q.low, c: q.close }));
    // as-of Sep 22 close (drop any Sep 23 partial)
    const upto = bars.filter((b) => b.t <= '09-22');
    const n = upto.length;
    // bottom in last 15, >=2 sessions ago
    let bi = -1;
    for (let i = n - 15; i < n - 2; i++) if (bi < 0 || upto[i].l < upto[bi].l) bi = i;
    const bottom = upto[bi];
    const since = upto.slice(bi + 1);
    let preHigh = 0;
    for (let i = bi - 20; i < bi; i++) preHigh = Math.max(preHigh, upto[i]?.h ?? 0);
    const decline = (preHigh - bottom.l) / preHigh;
    const last = upto[n - 1];
    const retrace = (last.c - bottom.l) / (preHigh - bottom.l);
    const baseHigh = Math.max(...since.map((b) => b.h));
    const rangePct = (baseHigh - bottom.l) / last.c;
    const pos = (last.c - bottom.l) / (baseHigh - bottom.l);
    const mid = Math.floor(since.length / 2);
    const f1 = Math.min(...since.slice(0, mid).map((b) => b.l));
    const f2 = Math.min(...since.slice(mid).map((b) => b.l));
    console.log(`${sym}: bottom ${bottom.t} $${bottom.l.toFixed(2)} (${n - 1 - bi} sessions ago) | preHigh $${preHigh.toFixed(2)} decline ${(decline * 100).toFixed(1)}% | retrace ${(retrace * 100).toFixed(0)}% | baseRange ${(rangePct * 100).toFixed(1)}% posInBase ${(pos * 100).toFixed(0)}% | floors ${f1.toFixed(2)}→${f2.toFixed(2)} ascending=${f2 > f1 && f1 > bottom.l} | last close $${last.c.toFixed(2)} > priorHigh $${upto[n - 2].h.toFixed(2)}? ${last.c > upto[n - 2].h}`);
  }
  process.exit(0);
})();
