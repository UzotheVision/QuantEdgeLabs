/**
 * BACKFILL LEVELS — recompute entry/stop/T1 on existing ideas using the level engine.
 *
 * Ideas written before level-engine.ts carry fixed percentages (target = entry × 1.08,
 * stop = entry × 0.965) — an identical R:R for every ticker, with the stop at an arbitrary
 * price rather than a level where the thesis is wrong. The generator is fixed, but existing
 * rows keep the levels they were written with, so the board still shows the old numbers.
 *
 * Run with --apply to write; default is a dry run.
 *
 *   npx tsx scripts/backfill-levels.ts            # dry run
 *   npx tsx scripts/backfill-levels.ts --apply    # write
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { deriveLevels, type Candle } from '../server/level-engine';

const APPLY = process.argv.includes('--apply');
const API = process.env.BACKFILL_API ?? 'http://localhost:3000';

async function candlesFor(symbol: string): Promise<Candle[]> {
  try {
    const r = await fetch(`${API}/api/historical-prices/${encodeURIComponent(symbol)}?range=6mo&interval=1d`);
    if (!r.ok) return [];
    const b = await r.json();
    return (b?.data ?? []) as Candle[];
  } catch { return []; }
}

/** Levels that look machine-generated from a constant rather than from a chart. */
function looksFlat(entry: number, target: number, stop: number, dir: string): boolean {
  if (!entry) return false;
  const t = Math.abs((target - entry) / entry) * 100;
  const s = Math.abs((entry - stop) / entry) * 100;
  const near = (v: number, x: number) => Math.abs(v - x) < 0.15;
  // the legacy constants: 8/12/25% targets against 3.5/4/5/6.25% stops
  return (near(t, 8) || near(t, 12) || near(t, 25) || near(t, 3) || near(t, 14.67))
      && (near(s, 3.5) || near(s, 4) || near(s, 5) || near(s, 6.25) || near(s, 2) || near(s, 2.34) || near(s, 5.87));
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows: any[] = await sql`
    SELECT id, symbol, direction, entry_price, target_price, stop_loss, risk_reward_ratio, source, asset_type
    FROM trade_ideas
    WHERE status = 'published' AND outcome_status = 'open'
  `;
  console.log(`${rows.length} open published ideas\n`);

  let changed = 0, skippedNoData = 0, skippedNotFlat = 0, rejected = 0;
  const preview: string[] = [];

  for (const r of rows) {
    const entry = Number(r.entry_price), target = Number(r.target_price), stop = Number(r.stop_loss);
    const dir: 'long' | 'short' = r.direction === 'short' ? 'short' : 'long';
    if (!entry || !target || !stop) { skippedNoData++; continue; }

    if (!looksFlat(entry, target, stop, dir)) { skippedNotFlat++; continue; }

    const candles = await candlesFor(r.symbol);
    if (candles.length < 30) { skippedNoData++; continue; }

    const spot = candles[candles.length - 1].close;
    const L = deriveLevels(candles, spot, dir, { assetType: r.asset_type });

    // never write something the read-path would reject
    const coherent = L.targetPrice != null && (dir === 'long'
      ? L.targetPrice > L.entryPrice && L.stopLoss < L.entryPrice
      : L.targetPrice < L.entryPrice && L.stopLoss > L.entryPrice);
    if (!coherent || !L.riskRewardRatio || L.riskRewardRatio > 15) { rejected++; continue; }

    const oldT = ((target - entry) / entry * 100).toFixed(1);
    const oldS = ((entry - stop) / entry * 100).toFixed(1);
    const newT = ((L.targetPrice - L.entryPrice) / L.entryPrice * 100).toFixed(1);
    const newS = ((L.entryPrice - L.stopLoss) / L.entryPrice * 100).toFixed(1);
    preview.push(
      `  ${String(r.symbol).padEnd(6)} ${dir.padEnd(5)} ` +
      `old T${oldT}%/S${oldS}% RR${Number(r.risk_reward_ratio).toFixed(1)}` +
      `  ->  new T${newT}%/S${newS}% RR${L.riskRewardRatio}  [${L.method}]`
    );

    if (APPLY) {
      await sql`
        UPDATE trade_ideas
        SET entry_price = ${L.entryPrice},
            target_price = ${L.targetPrice},
            stop_loss = ${L.stopLoss},
            risk_reward_ratio = ${L.riskRewardRatio}
        WHERE id = ${r.id}
      `;
    }
    changed++;
  }

  console.log(preview.slice(0, 25).join('\n'));
  if (preview.length > 25) console.log(`  … and ${preview.length - 25} more`);
  console.log(`\n${APPLY ? 'UPDATED' : 'WOULD UPDATE'}: ${changed}`);
  console.log(`skipped (already structure-based): ${skippedNotFlat}`);
  console.log(`skipped (no usable candles): ${skippedNoData}`);
  console.log(`rejected (incoherent result): ${rejected}`);
  if (!APPLY) console.log('\nDry run. Re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });
