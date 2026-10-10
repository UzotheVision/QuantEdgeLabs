import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

/**
 * Collapse duplicate OPEN rows: one position per (symbol, side).
 *
 * The book carried 129 open rows for far fewer actual ideas — AFRM 11 calls,
 * SNOW 8, AMZN 8, SHOP 8, PANW 7. Each producer deduped only against its own
 * source, so the bull-flag scanner, the quant generator and mover discovery
 * each entered the same setup blind to the others, and the scanners re-entered
 * on every scheduled run.
 *
 * That is one idea counted N times. It inflates any win-rate denominator,
 * breaks position sizing, and makes per-symbol concentration limits meaningless.
 *
 * KEEP: the earliest open row per (symbol, side) — the signal that actually
 * fired first. VOID: every later one, marked `expired` with a reason, so the
 * history stays auditable rather than deleted.
 *
 * Run with --apply to write. Default is a dry run.
 */
const APPLY = process.argv.includes('--apply');

const sideOf = (d: any) => (/bear|short|put|down/.test(String(d ?? '').toLowerCase()) ? 'short' : 'long');

(async () => {
  const r: any = await db.execute(sql`
    SELECT id, symbol, direction, source, option_type, strike_price, expiry_date,
           entry_price, entry_premium, timestamp
    FROM trade_ideas
    WHERE outcome_status = 'open'
    ORDER BY symbol, timestamp`);
  const rows = (r.rows ?? r) as any[];

  const groups = new Map<string, any[]>();
  for (const x of rows) {
    const k = `${x.symbol}:${sideOf(x.direction)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(x);
  }

  const toVoid: any[] = [];
  console.log(`\n\n########## COLLAPSE ${APPLY ? '(APPLYING)' : '(DRY RUN)'} ##########`);
  for (const [k, g] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    if (g.length < 2) continue;
    const keep = g[0];
    const drop = g.slice(1);
    console.log(`\n${k}  ${g.length} open → keeping 1`);
    console.log(`  KEEP  ${String(keep.option_type ?? 'stk').padEnd(4)} ${String(keep.strike_price ?? '').padStart(6)} ${String(keep.timestamp).slice(0,19)}  ${keep.source}`);
    for (const d of drop) {
      console.log(`  void  ${String(d.option_type ?? 'stk').padEnd(4)} ${String(d.strike_price ?? '').padStart(6)} ${String(d.timestamp).slice(0,19)}  ${d.source}`);
      toVoid.push(d);
    }
  }

  console.log(`\n  groups with duplicates: ${[...groups.values()].filter(g => g.length > 1).length}`);
  console.log(`  open rows now: ${rows.length}  →  after collapse: ${rows.length - toVoid.length}`);
  console.log(`  rows to void: ${toVoid.length}`);

  if (!APPLY) { console.log('\n  DRY RUN — rerun with --apply to write.'); process.exit(0); }

  let n = 0;
  for (const d of toVoid) {
    await db.execute(sql`
      UPDATE trade_ideas
      SET outcome_status = 'expired',
          resolution_reason = 'duplicate_collapsed',
          outcome_notes = ${'Collapsed as a duplicate open position — same symbol and side already held. Cross-source dedup added in trade-idea-ingestion.ts prevents recurrence.'},
          exclude_from_training = true
      WHERE id = ${d.id}`);
    n++;
  }
  console.log(`\n  voided ${n} rows.`);
  process.exit(0);
})();
