/**
 * Repairs open GEX ideas created by the legacy publisher that wrote option
 * premium into the underlying entry/target/stop fields.
 *
 * This is recovery, not signal generation: a row is repaired only when its
 * original audit payload contains both GEX walls and a live stock quote is
 * available. The thesis, timestamp, contract, and original premium survive.
 */
import { sql } from 'drizzle-orm';
import { db } from './db';
import { logger } from './logger';
import { getRealtimeBatchQuotes } from './realtime-pricing-service';

type BrokenGexRow = {
  id: string;
  symbol: string;
  direction: string;
  entry_price: number;
  entry_premium: number | null;
  quality_signals: string[] | null;
};

function level(signals: string[] | null, key: string): number | null {
  const raw = signals?.find((item) => item.startsWith(`${key}:`))?.slice(key.length + 1);
  const value = raw == null ? NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const round = (value: number) => Math.round(value * 100) / 100;

export async function repairMalformedOpenGexIdeas(): Promise<number> {
  // A legacy premium entry could also create a false trigger audit: a $192
  // stock quote trivially crossed a $2.70 "entry." Re-open only those repaired
  // rows whose recorded trigger level is provably in premium space and which
  // have no actual paper/broker execution attached.
  const resetResult: any = await db.execute(sql`
    UPDATE trade_ideas
    SET convergence_signals_json = jsonb_set(
      COALESCE(convergence_signals_json, '{}'::jsonb),
      '{executionAudit}',
      jsonb_build_object(
        'version', 1,
        'state', 'pending_trigger',
        'triggerType', 'market',
        'triggerPrice', entry_price
      ),
      true
    )
    WHERE outcome_status = 'open'
      AND source = 'gex_scanner'
      AND COALESCE(data_source_used, '') LIKE '%level_repair_v1%'
      AND convergence_signals_json->'executionAudit'->>'state' = 'triggered'
      AND convergence_signals_json->'executionAudit'->>'executionVenue' IS NULL
      AND NULLIF(convergence_signals_json->'executionAudit'->>'triggerPrice', '')::numeric < entry_price * 0.5
  `);
  const resetCount = Number(resetResult.rowCount ?? 0);
  if (resetCount > 0) logger.info(`[GEX-REPAIR] reset ${resetCount} false premium-space trigger audit${resetCount === 1 ? '' : 's'}`);

  const result: any = await db.execute(sql`
    SELECT id, symbol, direction, entry_price, entry_premium, quality_signals
    FROM trade_ideas
    WHERE outcome_status = 'open'
      AND source = 'gex_scanner'
      AND option_type IS NOT NULL
      AND strike_price IS NOT NULL
      AND entry_price > 0
      AND entry_price < strike_price * 0.5
      AND timestamp >= ${new Date(Date.now() - 7 * 86_400_000).toISOString()}
    ORDER BY timestamp DESC
    LIMIT 50
  `);
  const rows = (result.rows ?? result) as BrokenGexRow[];
  if (!rows.length) return 0;

  const quotes = await getRealtimeBatchQuotes(
    Array.from(new Set(rows.map((row) => row.symbol.toUpperCase())))
      .map((symbol) => ({ symbol, assetType: 'stock' as const })),
  );

  let repaired = 0;
  for (const row of rows) {
    const quote = quotes.get(row.symbol.toUpperCase());
    const callWall = level(row.quality_signals, 'call_wall');
    const putWall = level(row.quality_signals, 'put_wall');
    if (!quote || !(quote.price > 0) || callWall == null || putWall == null) continue;

    const entry = round(quote.price);
    const isShort = /short|bear|put/i.test(row.direction);
    const target = round(isShort ? putWall : callWall);
    const stop = round(isShort ? callWall : putWall);
    const geometryValid = isShort
      ? target < entry && stop > entry
      : target > entry && stop < entry;
    if (!geometryValid) continue;

    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    if (!(risk > 0) || !(reward > 0)) continue;

    const originalPremium = row.entry_premium ?? Number(row.entry_price);
    await db.execute(sql`
      UPDATE trade_ideas
      SET entry_price = ${entry},
          target_price = ${target},
          stop_loss = ${stop},
          risk_reward_ratio = ${round(reward / risk)},
          entry_premium = ${originalPremium},
          gen_conviction_score = NULL,
          gen_conviction_band = NULL,
          gen_scoring_layers = NULL,
          data_source_used = CASE
            WHEN COALESCE(data_source_used, '') LIKE '%level_repair_v1%' THEN data_source_used
            ELSE CONCAT_WS('|', NULLIF(data_source_used, ''), 'level_repair_v1')
          END
      WHERE id = ${row.id}
    `);
    repaired++;
    logger.info(
      `[GEX-REPAIR] ${row.symbol}: premium $${originalPremium.toFixed(2)} preserved; ` +
      `underlying ${entry} / ${target} / ${stop}`,
    );
  }

  return repaired;
}
