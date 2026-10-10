/**
 * TRADE ACTION ENGINE
 * ===================
 * Computes "What To Do Now" prompts for any open trade idea.
 *
 * Inspired by MomoEdge's Oracle Terminal action layer:
 *   ✓ T2 reached. Take second round of profit.
 *   ② Trail stop to T1. Close remaining.
 *   ◆ Oracle Option Pick: MRVL $125 CALL exp Jan 15 @ $6.34 premium
 *
 * Pulls from existing services:
 *   - tradeIdeas table (for entry/target/stop)
 *   - live price (Yahoo)
 *   - atr-targets.ts (for R-multiples)
 *   - market-pulse (for regime context)
 *
 * Each action has: priority, type, label, detail, ctaButton optional.
 */

import { logger } from './logger';
import { db } from './db';
import { tradeIdeas } from '@shared/schema';
import { eq } from 'drizzle-orm';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type ActionType =
  | 'T1_HIT_SCALE'         // T1 reached, take partial profit
  | 'T2_HIT_CLOSE'         // T2 reached, close remaining
  | 'TRAIL_STOP'           // Move stop to break-even or T1
  | 'STOP_TIGHTEN'         // Tighten stop based on volatility
  | 'STOP_LOSS_NEAR'       // Stop is being approached
  | 'THESIS_INVALIDATED'   // Stop hit, exit
  | 'TRIGGER_PENDING'      // Waiting for trigger price
  | 'TRIGGER_CONFIRMED'    // Just triggered, position now live
  | 'THETA_CRITICAL'       // Option theta burning fast (<14 DTE OTM)
  | 'IV_CRUSH_RISK'        // High IV before earnings, sell vs hold
  | 'RIDE_TREND'           // Strong trend, no action needed
  | 'WAIT'                 // No action — hold and observe
  | 'REGIME_CONFLICT';     // Market regime turned against trade

export interface TradeAction {
  type: ActionType;
  priority: 'critical' | 'high' | 'medium' | 'low';
  emoji: string;
  label: string;
  detail: string;
  cta?: { text: string; action: string };
}

interface TradeContext {
  symbol: string;
  direction: 'long' | 'short';
  entry: number;
  target: number;     // T1
  target2?: number;   // T2 (optional)
  stop: number;
  spot: number;
  daysActive: number;
  daysToExpiry?: number;     // for options
  isOption: boolean;
  status: string;
  marketRegime?: string;
  marketColor?: string;
}

// ═══════════════════════════════════════════════════════════════
// LIVE PRICE FETCHER
// ═══════════════════════════════════════════════════════════════

async function fetchSpot(symbol: string): Promise<number | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j: any = await r.json();
    const m = j?.chart?.result?.[0]?.meta;
    return m?.regularMarketPrice || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// ACTION RULES
// ═══════════════════════════════════════════════════════════════

function computeActions(ctx: TradeContext): TradeAction[] {
  const actions: TradeAction[] = [];
  const { spot, entry, target, target2, stop, direction, daysToExpiry, isOption } = ctx;

  const isLong = direction === 'long';
  const t1Hit = isLong ? spot >= target : spot <= target;
  const t2Hit = target2 ? (isLong ? spot >= target2 : spot <= target2) : false;
  const stopHit = isLong ? spot <= stop : spot >= stop;
  const triggered = isLong ? spot >= entry : spot <= entry;

  // Compute R-multiples
  const totalR = Math.abs(target - entry);
  const currentMove = isLong ? spot - entry : entry - spot;
  const rMultiple = currentMove / Math.max(0.01, Math.abs(entry - stop));
  const stopDistanceR = Math.abs(spot - stop) / Math.max(0.01, Math.abs(entry - stop));

  // ───────────────────────────────────────────────────────
  // STATUS: Stopped out
  // ───────────────────────────────────────────────────────
  if (stopHit) {
    actions.push({
      type: 'THESIS_INVALIDATED',
      priority: 'critical',
      emoji: '🛑',
      label: 'STOP HIT — Exit',
      detail: `Spot $${spot.toFixed(2)} crossed stop $${stop.toFixed(2)}. Thesis invalidated. Close position.`,
      cta: { text: 'Mark as exited', action: 'exit_trade' }
    });
    return actions;
  }

  // ───────────────────────────────────────────────────────
  // STATUS: T2 reached
  // ───────────────────────────────────────────────────────
  if (t2Hit) {
    actions.push({
      type: 'T2_HIT_CLOSE',
      priority: 'critical',
      emoji: '✓',
      label: 'T2 reached. Take final profit.',
      detail: `Close remaining 60%. Total move ${rMultiple.toFixed(1)}R. Thesis fully played out.`,
      cta: { text: 'Close remaining', action: 'close_position' }
    });
    actions.push({
      type: 'TRAIL_STOP',
      priority: 'high',
      emoji: '②',
      label: 'Trail stop to T1.',
      detail: `If you keep a runner, trail stop to T1 ($${target.toFixed(2)}) to lock in 1R minimum.`
    });
    return actions;
  }

  // ───────────────────────────────────────────────────────
  // STATUS: T1 reached
  // ───────────────────────────────────────────────────────
  if (t1Hit && !t2Hit) {
    actions.push({
      type: 'T1_HIT_SCALE',
      priority: 'high',
      emoji: '✓',
      label: 'T1 reached. Take 40% off.',
      detail: target2
        ? `Scale 40%, trail stop to entry. Hold remainder for T2 ($${target2.toFixed(2)}).`
        : `T1 hit. Scale out 40-50% and trail stop to break-even.`,
      cta: { text: 'Scale 40%', action: 'partial_exit' }
    });
    actions.push({
      type: 'TRAIL_STOP',
      priority: 'medium',
      emoji: '②',
      label: 'Move stop to entry (break-even).',
      detail: `Lock in zero risk on remainder. Stop now at $${entry.toFixed(2)}.`
    });
    return actions;
  }

  // ───────────────────────────────────────────────────────
  // STATUS: Stop loss being approached
  // ───────────────────────────────────────────────────────
  if (stopDistanceR < 0.5) {
    actions.push({
      type: 'STOP_LOSS_NEAR',
      priority: 'critical',
      emoji: '⚠️',
      label: 'Stop loss within 0.5R',
      detail: `Spot $${spot.toFixed(2)} only $${Math.abs(spot - stop).toFixed(2)} from stop. Decide now: cut here or accept full stop.`
    });
  }

  // ───────────────────────────────────────────────────────
  // STATUS: Trigger pending (price hasn't reached entry)
  // ───────────────────────────────────────────────────────
  if (!triggered) {
    actions.push({
      type: 'TRIGGER_PENDING',
      priority: 'medium',
      emoji: '⏳',
      label: 'Trigger pending',
      detail: `Need ${isLong ? 'a move up to' : 'a drop to'} $${entry.toFixed(2)} to enter. Currently ${Math.abs(spot - entry) / entry * 100}% away.`
    });
    return actions;
  }

  // ───────────────────────────────────────────────────────
  // OPTION-SPECIFIC: Theta critical
  // ───────────────────────────────────────────────────────
  if (isOption && daysToExpiry !== undefined && daysToExpiry < 14) {
    const inProfit = (isLong && spot > entry) || (!isLong && spot < entry);
    actions.push({
      type: 'THETA_CRITICAL',
      priority: inProfit ? 'high' : 'critical',
      emoji: '⏰',
      label: 'Theta burning fast',
      detail: `Only ${daysToExpiry} DTE remaining. ${inProfit
        ? 'Consider rolling out OR taking profits.'
        : 'Cut and reload further-dated if thesis intact.'}`,
      cta: inProfit ? { text: 'Roll position', action: 'roll_option' } : { text: 'Cut + reload', action: 'cut_and_reload' }
    });
  }

  // ───────────────────────────────────────────────────────
  // STATUS: Riding strong trend (in profit)
  // ───────────────────────────────────────────────────────
  if (rMultiple > 0.5 && rMultiple < 1.0) {
    actions.push({
      type: 'RIDE_TREND',
      priority: 'low',
      emoji: '📈',
      label: 'Trade is working.',
      detail: `Up ${(rMultiple * 100).toFixed(0)}% of way to T1. Hold and let it work. Tighten stop on next push.`
    });
    return actions;
  }

  // ───────────────────────────────────────────────────────
  // STATUS: Recently entered, waiting
  // ───────────────────────────────────────────────────────
  if (Math.abs(rMultiple) < 0.2) {
    actions.push({
      type: 'WAIT',
      priority: 'low',
      emoji: '⌛',
      label: 'Wait for thesis to develop.',
      detail: 'No action needed. Trade just entered. Let setup work.'
    });
  }

  // ───────────────────────────────────────────────────────
  // OPTION: Always show Oracle Option pick suggestion
  // ───────────────────────────────────────────────────────
  if (!isOption) {
    actions.push({
      type: 'WAIT',
      priority: 'low',
      emoji: '◆',
      label: 'Consider option leverage',
      detail: `If thesis high-conviction, options ${isLong ? '$' + (entry * 1.05).toFixed(0) + ' calls' : '$' + (entry * 0.95).toFixed(0) + ' puts'} would 3-5x equity returns.`
    });
  }

  return actions;
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Get actions for a trade idea
// ═══════════════════════════════════════════════════════════════

export async function getActionsForTrade(tradeIdeaId: string): Promise<TradeAction[]> {
  try {
    const idea = await db.select().from(tradeIdeas).where(eq(tradeIdeas.id, tradeIdeaId)).limit(1);
    if (!idea.length) return [];
    const trade = idea[0];

    const spot = await fetchSpot(trade.symbol);
    if (!spot) {
      return [{
        type: 'WAIT',
        priority: 'low',
        emoji: '❓',
        label: 'Live price unavailable',
        detail: 'Cannot compute actions without live spot. Check broker.'
      }];
    }

    const issued = new Date(trade.timestamp);
    const daysActive = Math.floor((Date.now() - issued.getTime()) / 86400000);
    const isOption = trade.assetType === 'option';
    const daysToExpiry = trade.expiryDate
      ? Math.floor((new Date(trade.expiryDate).getTime() - Date.now()) / 86400000)
      : undefined;

    const ctx: TradeContext = {
      symbol: trade.symbol,
      direction: trade.direction === 'long' ? 'long' : 'short',
      entry: trade.entryPrice,
      target: trade.targetPrice,
      stop: trade.stopLoss,
      spot,
      daysActive,
      daysToExpiry,
      isOption,
      status: 'open'
    };

    return computeActions(ctx);
  } catch (e: any) {
    logger.error('[trade-action-engine] failed:', e);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// BULK: Get actions for all open trades
// ═══════════════════════════════════════════════════════════════

export async function getActionsForAllOpenTrades(userId: string): Promise<Array<{
  tradeId: string;
  symbol: string;
  actions: TradeAction[];
}>> {
  const open = await db.select().from(tradeIdeas).where(eq(tradeIdeas.userId, userId)).limit(50);
  const results = [];
  for (const trade of open) {
    const actions = await getActionsForTrade(trade.id);
    if (actions.length) {
      results.push({ tradeId: trade.id, symbol: trade.symbol, actions });
    }
  }
  return results;
}
