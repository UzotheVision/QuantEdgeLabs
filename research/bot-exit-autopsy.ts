/**
 * BOT EXIT AUTOPSY — replay every closed option trade on the contract's real
 * daily bars and score alternative exit rules.
 *
 * Two hypotheses, separated on purpose:
 *   H1 OUTAGE COST: the −93%/−95% bleeds all exited 2026-09-08 — the first
 *      day the server ran after ~Sep 2-7 dark. Rule R1 (the bot's OWN stored
 *      brackets, simply checked every session) isolates what daily management
 *      alone would have saved.
 *   H2 EXIT DESIGN: with daily management assumed, do tighter premium stops
 *      or time stops beat the stored brackets?
 *
 * Replay rules (all daily-bar granularity, both-touched ties go to the stop,
 * entry day excluded because intraday timing is unknown — stated caveat):
 *   R1 stored stop/target, checked daily
 *   R2 −35% premium stop, stored target
 *   R3 3-session time stop (exit close of 3rd session) + stored brackets
 *   R4 −50% stop + 5-session time stop
 * Fills are pessimistic: a gap through the stop fills at the OPEN, not the
 * stop price.
 */
import 'dotenv/config';
import fs from 'fs';

const KEY = process.env.POLYGON_API_KEY?.trim();

function occOf(sym: string, expiry: string, type: string, strike: number): string {
  const d = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  const k = String(Math.round(strike * 1000)).padStart(8, '0');
  return `O:${sym}${d}${type === 'put' ? 'P' : 'C'}${k}`;
}

async function contractBars(occ: string, from: string, to: string): Promise<Array<{ date: string; o: number; h: number; l: number; c: number }>> {
  const url = `https://api.polygon.io/v2/aggs/ticker/${occ}/range/1/day/${from}/${to}?adjusted=true&apiKey=${KEY}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      const d: any = await r.json();
      if (Array.isArray(d?.results) && d.results.length) {
        return d.results.map((b: any) => ({
          date: new Date(b.t).toISOString().slice(0, 10), o: b.o, h: b.h, l: b.l, c: b.c,
        }));
      }
      // A genuinely bar-less contract answers OK/DELAYED with count 0 — accept.
      if ((d?.status === 'OK' || d?.status === 'DELAYED') && (d?.resultsCount ?? 0) === 0) return [];
      console.log(`  retry ${occ}: ${d?.status ?? r.status} — backing off 70s`);
    } catch (e: any) {
      console.log(`  retry ${occ}: ${e?.message} — backing off 70s`);
    }
    await new Promise((res) => setTimeout(res, 70_000));
  }
  return [];
}

interface Trade {
  symbol: string; optionType: string; strikePrice: number; expiryDate: string;
  entryPrice: number; exitPrice: number; quantity: number; realizedPnL: number;
  entryTime: string; exitTime: string; exitReason: string;
  targetPrice?: number | null; stopLoss?: number | null;
}

function replay(bars: Array<{ date: string; o: number; h: number; l: number; c: number }>, entry: number, entryDate: string, stopPx: number, targetPx: number | null, maxSessions: number | null): { exit: number; date: string; how: string } | null {
  let n = 0;
  for (const b of bars) {
    if (b.date <= entryDate) continue;   // entry day excluded — intraday timing unknown
    n++;
    // Gap through the stop → pessimistic open fill.
    if (b.o <= stopPx) return { exit: b.o, date: b.date, how: 'gap-stop' };
    const hitStop = b.l <= stopPx;
    const hitTarget = targetPx != null && b.h >= targetPx;
    if (hitStop) return { exit: stopPx, date: b.date, how: hitTarget ? 'both→stop' : 'stop' };
    if (hitTarget) return { exit: targetPx!, date: b.date, how: 'target' };
    if (maxSessions != null && n >= maxSessions) return { exit: b.c, date: b.date, how: `time(${maxSessions})` };
  }
  const last = bars[bars.length - 1];
  return last ? { exit: last.c, date: last.date, how: 'held-to-end' } : null;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(process.argv[2] ?? '/tmp/bot.json', 'utf8'));
  const trades: Trade[] = (raw.closedPositions ?? []).filter((r: any) => r.assetType === 'option' && r.strikePrice);
  console.log(`replaying ${trades.length} closed option trades on real contract bars\n`);

  const RULES = [
    { name: 'R1 stored brackets, daily', stop: (t: Trade) => t.stopLoss ?? t.entryPrice * 0.5, time: null as number | null },
    { name: 'R2 −35% stop', stop: (t: Trade) => t.entryPrice * 0.65, time: null },
    { name: 'R3 stored + 3-day time', stop: (t: Trade) => t.stopLoss ?? t.entryPrice * 0.5, time: 3 },
    { name: 'R4 −50% + 5-day time', stop: (t: Trade) => t.entryPrice * 0.5, time: 5 },
  ];

  const totals: Record<string, number> = { actual: 0, actualReplayed: 0 };
  for (const r of RULES) totals[r.name] = 0;
  const rows: string[] = [];

  for (const t of trades) {
    const occ = occOf(t.symbol, String(t.expiryDate).slice(0, 10), t.optionType, t.strikePrice);
    const entryDate = String(t.entryTime).slice(0, 10);
    const endDate = String(t.expiryDate).slice(0, 10);
    const bars = await contractBars(occ, entryDate, endDate);
    totals.actual += t.realizedPnL ?? 0;
    if (bars.length === 0) { rows.push(`${t.symbol.padEnd(6)} no bars — excluded from comparison`); continue; }
    totals.actualReplayed += t.realizedPnL ?? 0;

    const cells: string[] = [];
    for (const r of RULES) {
      const target = t.targetPrice ?? null;
      const res = replay(bars, t.entryPrice, entryDate, r.stop(t), target, r.time);
      const pnl = res ? (res.exit - t.entryPrice) * 100 * (t.quantity ?? 1) : (t.realizedPnL ?? 0);
      totals[r.name] += pnl;
      cells.push(`${r.name.split(' ')[0]}:${pnl >= 0 ? '+' : ''}${Math.round(pnl)}${res ? `(${res.how})` : ''}`);
    }
    rows.push(`${t.symbol.padEnd(6)} actual ${String(Math.round(t.realizedPnL ?? 0)).padStart(6)} (${t.exitReason.slice(0, 22)}) · ${cells.join(' ')}`);
    await new Promise((r) => setTimeout(r, 13_000)); // free options tier ≈5/min — pace hard
  }

  console.log(rows.join('\n'));
  console.log('\n════ TOTALS across the book ════');
  console.log(`ACTUAL all 24:                 ${totals.actual >= 0 ? '+' : ''}$${Math.round(totals.actual)}`);
  console.log(`ACTUAL on replayed subset:     ${totals.actualReplayed >= 0 ? '+' : ''}$${Math.round(totals.actualReplayed)}`);
  for (const r of RULES) {
    const d = totals[r.name] - totals.actualReplayed;
    console.log(`${r.name.padEnd(30)} ${totals[r.name] >= 0 ? '+' : ''}$${Math.round(totals[r.name])}  (${d >= 0 ? '+' : ''}$${Math.round(d)} vs actual)`);
  }
  console.log('\nCaveats: daily-bar granularity; entry day excluded; gap-through-stop fills at the open (pessimistic); n=24 — direction of evidence, not proof.');
  process.exit(0);
}
main();

/* ── RESULTS (run 2026-09-09, all 24 closed option trades, real contract bars) ──
 *
 *   ACTUAL (what happened):        −$873
 *   R1 own brackets, checked daily +$3,159   ← +$4,032 vs actual
 *   R2 −35% tight premium stop     −$6,192   ← tight stops chop winners; DO NOT
 *   R3 stored + 3-day time stop    −$1,736
 *   R4 −50% + 5-day time stop      +$1,083
 *
 * DIAGNOSIS (three findings, three fixes shipped same night):
 * 1. THE OUTAGE WAS THE KILLER, not the exit design. Sep 2-7 dark: MDB bled
 *    to −95%, AAPL filled 59% BELOW its own trailing stop, labels claimed
 *    "locked_64pct" on a −32% fill. → Boot cycle: the bot re-prices and runs
 *    exits 90s after every wake. → Labels now say trailing_stop_gapped_-32pct
 *    _vs_64pct_lock when the fill deviates >10% from the trigger.
 * 2. FLOW-REVERSAL EXITS ON GREEN POSITIONS COST MONEY (TSLA +364 → would-be
 *    +2,696; AAPL −249 → would-be +774). → Restricted to red positions;
 *    board flips still exit either way.
 * 3. TIGHT PREMIUM STOPS (R2) are independently harmful — consistent with the
 *    long-run lab's lesson about noise. The stored bracket geometry is fine;
 *    it just needs to actually be WATCHED.
 * The structural fix remains ops: a bot that lives on a laptop sleeps when
 * the laptop does. Deploy or keep the machine awake through sessions.
 * Caveats: n=24, daily bars, pessimistic gap fills — direction, not proof.
 */
