import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

/**
 * Value the open earnings book at INTRINSIC against the live after-hours print.
 *
 * The CBOE option marks cannot be used tonight: equity options stop trading at
 * 16:15 ET, so every bid/ask/last in the chain is a pre-earnings quote, while
 * CBOE's `current_price` does track after-hours. Mixing them produced an AFRM
 * $77 call marked $5.22 with the stock at $83.64 — below its own $6.64
 * intrinsic, which is impossible in a live market. A "+$368 P&L" built from
 * those marks is an artefact.
 *
 * Intrinsic is the defensible floor: what the contract is worth if the stock
 * opens exactly here and every cent of time value is gone. Real marks will be
 * higher (8-22 DTE remains) but IV crush decides by how much, and that is not
 * knowable until the open.
 */
(async () => {
  const spots: Record<string, number> = {};
  const P = process.env.POLYGON_API_KEY;
  for (const s of ['AFRM', 'ADSK', 'WDAY']) {
    const r = await fetch(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${s}?apiKey=${P}`);
    const j: any = await r.json();
    spots[s] = j.ticker?.min?.c ?? j.ticker?.day?.c;
  }

  const r: any = await db.execute(sql`
    SELECT symbol, option_type, strike_price, expiry_date, entry_premium, entry_price, source
    FROM trade_ideas
    WHERE outcome_status='open' AND symbol IN ('AFRM','ADSK','WDAY')
      AND strike_price IS NOT NULL AND entry_premium IS NOT NULL
    ORDER BY symbol, strike_price`);
  const rows = (r.rows ?? r) as any[];

  console.log('\n\n########## INTRINSIC FLOOR AT AH PRINT ##########');
  for (const s of ['AFRM', 'ADSK', 'WDAY']) console.log(`  ${s} $${spots[s].toFixed(2)}`);
  console.log('');

  let cost = 0, floor = 0;
  for (const x of rows) {
    const spot = spots[x.symbol];
    const k = Number(x.strike_price);
    const isCall = String(x.option_type).toLowerCase().startsWith('c');
    const intrinsic = isCall ? Math.max(0, spot - k) : Math.max(0, k - spot);
    const paid = Number(x.entry_premium);
    const pnl = (intrinsic - paid) * 100;
    cost += paid * 100; floor += intrinsic * 100;
    const dte = Math.round((new Date(x.expiry_date).getTime() - Date.now()) / 86400000);
    console.log(
      `  ${x.symbol} ${String(x.option_type).padEnd(4)} ${String(k).padStart(6)} ${String(x.expiry_date).slice(0,10)} (${dte}d)` +
      `  paid $${paid.toFixed(2)}  intrinsic $${intrinsic.toFixed(2)}  ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}  ${intrinsic > 0 ? 'ITM' : 'OTM'}  ${x.source}`
    );
  }
  console.log(`\n  paid $${cost.toFixed(0)}   intrinsic floor $${floor.toFixed(0)}   ${floor - cost >= 0 ? '+' : ''}$${(floor - cost).toFixed(0)} (1 contract each)`);
  console.log('  NOTE: floor only. Time value on 8-22 DTE adds; IV crush subtracts. Real marks at the open.');
  process.exit(0);
})();
