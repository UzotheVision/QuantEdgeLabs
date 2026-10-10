/**
 * BOT-HELD POSITIONS AS COCKPIT PICKS
 * ===================================
 * Anything the bot actually bought appears on the board. Unconditionally.
 *
 * WHY
 * The cockpit reads /api/convictions, which reads `trade_ideas` and then
 * applies the entry gauntlet: holding-period age cap, live revalidation,
 * minScore, short discipline. The bot's real positions live in
 * `paper_positions`. Nothing joined the two.
 *
 * The result, measured 2026-08-31: the bot held 11 open positions and the
 * cockpit displayed 4 of them. Seven were invisible for two different reasons —
 * COPX, DKS and QCOM had no `trade_ideas` row at all, and JNJ, NET, PATH and
 * WDC had rows that the entry filters removed.
 *
 * The second reason is the design error. A position you already OWN is being
 * re-judged by the rules for OPENING one, so it vanishes from the screen the
 * moment it stops looking like a fresh entry — which is often the moment it
 * starts moving. NET was up $1,650, the single best position in the book, and
 * could not be seen.
 *
 * Held is held. These bypass every entry filter by construction: they are not
 * candidates, they are inventory, and the operator needs them on the screen to
 * manage them.
 */
import { db } from './db';
import { sql } from 'drizzle-orm';
import { logger } from './logger';

export interface BotHeldPick {
  ideaId: string;
  symbol: string;
  direction: 'long' | 'short';
  assetType: string;
  optionType: string | null;
  strikePrice: number | null;
  expiryDate: string | null;
  entryPremium: number | null;
  /** Latest premium mark stored by the position monitor (bid for long options). */
  currentPremium: number | null;
  premiumTarget: number | null;
  premiumStop: number | null;
  premiumMarkedAt: string | null;
  /** Underlying-space levels from the originating idea. Null when unknown. */
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  quantity: number;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  /** Marks the row as inventory rather than a candidate. The UI badges on this. */
  isBotHeld: true;
  botOwner: string;
  /** Portfolio provenance prevents old and current bot books looking identical. */
  botBookName: string;
  botBookLegacy: boolean;
  heldSince: string | null;
  convictionScore: number | null;
  convictionBand: string | null;
  lifecycleState: 'executed';
  layers: { kind: string; why: string; points: number }[];
}

/** Every open bot position, shaped like a conviction pick. */
export async function getBotHeldPicks(): Promise<BotHeldPick[]> {
  try {
    /**
     * Pull the UNDERLYING levels from the originating idea, not the position.
     *
     * paper_positions stores entry/target/stop as PREMIUM for an option row
     * ($3.03 / $6.06 / $1.51 on an AAPL call). Every consumer downstream —
     * signal geometry, the price ladder, the Contract Engine — treats those
     * fields as underlying prices and compares them against a live underlying
     * quote.
     *
     * The first version of this file put the premium in entryPrice. The result
     * on AAPL: "+10363.95% versus entry", a ladder reading AT TARGET, and the
     * Contract Engine correctly but uselessly reporting "Target $6.06 is on the
     * WRONG SIDE for a call from $317.05" while grading every tier F.
     *
     * The originating trade_idea holds the real underlying levels, so join to
     * it. When a position has no originating idea (the bot bought from a path
     * that never published one — COPX, DKS, QCOM), the level fields are left
     * NULL rather than filled with premium. A missing level renders as unknown;
     * a wrong one renders as a confident lie.
     */
    const r: any = await db.execute(sql`
      SELECT pp.id, pp.symbol, pp.asset_type, pp.direction, pp.option_type,
             pp.strike_price, pp.expiry_date, pp.entry_price, pp.current_price,
             pp.target_price AS position_target, pp.stop_loss AS position_stop,
             pp.last_price_update, pp.quantity,
             pp.unrealized_pnl, pp.unrealized_pnl_percent, pp.entry_time,
             pp.trade_idea_id, pp.portfolio_id,
             po.user_id AS bot_owner, po.name AS bot_book_name,
             EXISTS (
               SELECT 1
               FROM paper_portfolios newer
               WHERE newer.user_id = po.user_id
                 AND newer.name = po.name
                 AND newer.created_at > po.created_at
             ) AS bot_book_legacy,
             ti.entry_price  AS idea_entry,
             ti.target_price AS idea_target,
             ti.stop_loss    AS idea_stop
      FROM paper_positions pp
      JOIN paper_portfolios po ON po.id = pp.portfolio_id
      LEFT JOIN trade_ideas ti ON ti.id = pp.trade_idea_id
      WHERE pp.status = 'open'
        -- Inventory can remain marked open when the option-price reconciler
        -- cannot obtain a final expiration-day mark. It still belongs in the
        -- audit ledger, but an expired contract is not an active position and
        -- must not be promoted back onto today's Active Book.
        AND (
          COALESCE(pp.asset_type, '') <> 'option'
          OR pp.expiry_date IS NULL
          OR pp.expiry_date::date >= CURRENT_DATE
        )
      ORDER BY pp.symbol`);

    const rows = (r.rows ?? r) as any[];
    return rows.map((x) => {
      const isOption = !!x.option_type;
      const pnlPct = x.unrealized_pnl_percent != null ? Number(x.unrealized_pnl_percent) : null;
      return {
        // Prefer the originating idea's id so clicking through still resolves
        // to its evidence when one exists.
        ideaId: String(x.trade_idea_id ?? `bot-${x.id}`),
        symbol: String(x.symbol).toUpperCase(),
        direction: /short|bear|put/i.test(String(x.direction ?? '')) ? 'short' : 'long',
        assetType: String(x.asset_type ?? (isOption ? 'option' : 'stock')),
        optionType: x.option_type ?? null,
        strikePrice: x.strike_price != null ? Number(x.strike_price) : null,
        expiryDate: x.expiry_date ? String(x.expiry_date) : null,
        // The premium lives in its own field and never in a level field.
        entryPremium: isOption && x.entry_price != null ? Number(x.entry_price) : null,
        currentPremium: isOption && x.current_price != null ? Number(x.current_price) : null,
        premiumTarget: isOption && x.position_target != null ? Number(x.position_target) : null,
        premiumStop: isOption && x.position_stop != null ? Number(x.position_stop) : null,
        premiumMarkedAt: x.last_price_update ? new Date(x.last_price_update).toISOString() : null,
        // Levels are underlying-space, sourced from the originating idea. Null
        // when unknown — see the query comment.
        entryPrice: x.idea_entry != null ? Number(x.idea_entry) : (isOption ? null : Number(x.entry_price)),
        targetPrice: x.idea_target != null ? Number(x.idea_target) : null,
        stopLoss: x.idea_stop != null ? Number(x.idea_stop) : null,
        quantity: Number(x.quantity ?? 1),
        unrealizedPnl: x.unrealized_pnl != null ? Number(x.unrealized_pnl) : null,
        unrealizedPnlPercent: pnlPct,
        isBotHeld: true as const,
        botOwner: String(x.bot_owner ?? 'bot'),
        botBookName: String(x.bot_book_name ?? 'Bot book'),
        botBookLegacy: x.bot_book_legacy === true || String(x.bot_book_legacy) === 'true',
        heldSince: x.entry_time ? new Date(x.entry_time).toISOString() : null,
        // Held positions are not scored for entry. Showing a fabricated
        // conviction here would invite comparison against candidates that were
        // scored, so it is left null and the UI shows P&L in that slot instead.
        convictionScore: null,
        convictionBand: null,
        lifecycleState: 'executed' as const,
        layers: [{
          kind: 'position',
          why: `Held by ${String(x.bot_owner ?? 'bot')} — ${x.quantity}x` +
               (pnlPct != null ? ` · ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%` : ''),
          points: 0,
        }],
      };
    });
  } catch (err: any) {
    logger.warn(`[BOT-HELD] could not read positions: ${err?.message ?? err}`);
    return [];
  }
}

/**
 * Merge held positions into a picks list.
 *
 * Held rows go FIRST and win on collision: if a symbol is both a candidate and
 * something the bot owns, the owned view is the truthful one — the operator
 * needs the fill and the P&L, not the entry score it no longer qualifies for.
 */
export function mergeBotHeld<T extends { symbol: string; direction?: string }>(
  picks: T[],
  held: BotHeldPick[],
): (T | BotHeldPick)[] {
  if (held.length === 0) return picks;
  const key = (s: string, d?: string) =>
    `${s.toUpperCase()}:${/short|bear|put/i.test(String(d ?? '')) ? 'short' : 'long'}`;
  const heldKeys = new Set(held.map((h) => key(h.symbol, h.direction)));
  const rest = picks.filter((p) => !heldKeys.has(key(p.symbol, p.direction)));
  return [...held, ...rest];
}
