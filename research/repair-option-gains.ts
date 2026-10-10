import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

/**
 * Re-derive option_percent_gain for resolved rows whose recorded exit premium
 * sits BELOW the contract's intrinsic value at its own exit price.
 *
 * A premium below intrinsic is arithmetically impossible in a live market, so
 * every such row was priced off a stale chain — typically the prior session's
 * close, since equity options stop trading at 16:15 ET and an overnight gap
 * leaves the whole chain behind the underlying.
 *
 * Run with --apply to write. Default is a dry run.
 */
const APPLY = process.argv.includes('--apply');

(async () => {
  const r: any = await db.execute(sql`
    SELECT id, symbol, option_type, strike_price, entry_premium, exit_premium,
           exit_price, option_percent_gain, outcome_status, timestamp
    FROM trade_ideas
    WHERE asset_type='option' AND option_percent_gain IS NOT NULL
      AND entry_premium IS NOT NULL AND exit_price IS NOT NULL
      AND strike_price IS NOT NULL
    ORDER BY timestamp DESC`);
  const rows = (r.rows ?? r) as any[];

  console.log(`\n\n########## OPTION GAIN REPAIR ${APPLY ? '(APPLYING)' : '(DRY RUN)'} ##########`);
  console.log(`scanned ${rows.length} resolved option rows\n`);

  const fixes: any[] = [];
  for (const x of rows) {
    const k = Number(x.strike_price);
    const und = Number(x.exit_price);
    const paid = Number(x.entry_premium);
    const quoted = x.exit_premium != null ? Number(x.exit_premium) : null;
    if (!Number.isFinite(k) || !Number.isFinite(und) || !(paid > 0)) continue;

    const isCall = String(x.option_type ?? '').toLowerCase().startsWith('c');
    const intrinsic = isCall ? Math.max(0, und - k) : Math.max(0, k - und);
    if (quoted == null || intrinsic <= quoted + 0.01) continue;

    const newPct = Math.round(((intrinsic - paid) / paid) * 100 * 100) / 100;
    fixes.push({ ...x, intrinsic, newPct });
    console.log(
      `  ${String(x.symbol).padEnd(6)} $${k} ${x.option_type} ${String(x.outcome_status).padEnd(10)}` +
      ` paid $${paid.toFixed(2)}  quoted exit $${quoted.toFixed(2)} → intrinsic $${intrinsic.toFixed(2)}` +
      `   recorded ${x.option_percent_gain}%  →  ${newPct}%`);
  }

  console.log(`\n  ${fixes.length} row(s) with an impossible exit premium`);
  if (!APPLY) { console.log('\n  DRY RUN — rerun with --apply to write.'); process.exit(0); }

  for (const f of fixes) {
    await db.execute(sql`
      UPDATE trade_ideas
      SET exit_premium = ${Math.round(f.intrinsic * 100) / 100},
          option_percent_gain = ${f.newPct},
          outcome_notes = COALESCE(outcome_notes, '') || ${' | exit premium repaired: quoted mark was below intrinsic (stale chain)'}
      WHERE id = ${f.id}`);
  }
  console.log(`\n  repaired ${fixes.length} row(s).`);
  process.exit(0);
})();
