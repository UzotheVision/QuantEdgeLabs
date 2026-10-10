/**
 * BTC TRACKER — Trade Idea Generator
 * ====================================
 * Bridge: BTCSignal → UniversalIdeaInput → Trade Desk.
 *
 * Mirrors the pattern in earnings-to-trade-desk.ts and gex-to-trade-desk.ts:
 * each high-conviction signal becomes an actionable trade idea persisted in
 * tradeIdeas table, surfaced in Trade Desk UI, and pushed via universal-idea-generator.
 *
 * Conviction filter: only A-tier and above (score ≥ 80) gets auto-pushed.
 * Lower-grade signals stay in the BTC track record but don't spam the desk.
 */

import { logger } from '../logger';
import {
  createAndSaveUniversalIdea,
  type UniversalIdeaInput,
  type IdeaSignal,
} from '../universal-idea-generator';
import type { BTCSignal } from '@shared/btc-tracker-types';

// ─── BTC signal → UniversalIdeaInput ───────────────────────────────

export function btcSignalToIdea(signal: BTCSignal): UniversalIdeaInput {
  const isLong = signal.direction === 'long_call' || signal.direction === 'short_put';
  const isCall = signal.direction === 'long_call' || signal.direction === 'short_call';

  // Convert the BTCSignal's signals into IdeaSignal[] for universal-idea-generator
  const ideaSignals: IdeaSignal[] = signal.signals.map(s => ({
    type: `btc_${s.source}`,
    weight: Math.round(s.score / 10),
    description: s.label,
    data: { detail: s.detail, grade: s.grade },
  }));

  // Always include the BTC state as a primary signal
  ideaSignals.unshift({
    type: 'btc_state',
    weight: 15,
    description: `BTC $${signal.btcSnapshot.price.toFixed(0)} (${signal.btcSnapshot.change24h >= 0 ? '+' : ''}${signal.btcSnapshot.change24h.toFixed(2)}% 24h, ${signal.btcSnapshot.change1h >= 0 ? '+' : ''}${signal.btcSnapshot.change1h.toFixed(2)}% 1h)`,
    data: {
      price: signal.btcSnapshot.price,
      change24h: signal.btcSnapshot.change24h,
      realizedVol30d: signal.btcSnapshot.realizedVol30d,
      recentBreak: signal.btcSnapshot.recentBreak,
      breakStrength: signal.btcSnapshot.breakStrength,
    },
  });

  return {
    symbol: signal.symbol,
    source: 'btc_beta_tracker' as any,  // extends source enum if needed in upstream
    assetType: 'option',
    direction: isLong ? 'bullish' : 'bearish',
    currentPrice: signal.spotAtFire,
    targetPrice: signal.targets.t1,
    stopLoss: signal.invalidation,
    optionType: isCall ? 'call' : 'put',
    strikePrice: signal.suggestedStrike,
    expiryDate: signal.suggestedExpiry,
    signals: ideaSignals,
    holdingPeriod:
      signal.horizon === 'minutes' || signal.horizon === 'hours'
        ? 'day'
        : signal.horizon === 'days'
        ? 'swing'
        : 'position',
    catalyst: `BTC ${signal.btcSnapshot.recentBreak ?? 'state'} — pattern: ${signal.pattern}`,
    analysis: [
      `Auto-generated from BTC Beta Tracker at ${new Date().toISOString()}.`,
      `Pattern: ${signal.pattern}`,
      `Conviction: ${signal.finalGrade} (${signal.finalScore}/100)`,
      `Thesis: ${signal.thesis}`,
      `Plan: T1 $${signal.targets.t1.toFixed(2)}${signal.targets.t2 ? `, T2 $${signal.targets.t2.toFixed(2)}` : ''}, stop $${signal.invalidation.toFixed(2)}.`,
      `Horizon: ${signal.horizon}.`,
      `Sell triggers: trim 33% at +${(signal.sellTriggers.trim33At * 100).toFixed(0)}%, trim 50% at +${(signal.sellTriggers.trim50At * 100).toFixed(0)}%, exit runner at +${(signal.sellTriggers.runnerExitAt * 100).toFixed(0)}%.`,
    ].join('\n\n'),
    technicalSignals: [
      `${signal.symbol} ${isCall ? 'Call' : 'Put'} ${signal.suggestedStrike} ${signal.suggestedExpiry}`,
      `BTC β ≈ ${(signal.signals.find(s => s.label.includes('β'))?.detail ?? 'n/a')}`,
      `Final grade: ${signal.finalGrade}`,
    ],
  };
}

// ─── Push a single signal ──────────────────────────────────────────

export interface PushBTCSignalResult {
  ok: boolean;
  signalId: string;
  symbol: string;
  pattern: string;
  reason?: string;
}

export async function pushBTCSignalToDesk(signal: BTCSignal): Promise<PushBTCSignalResult> {
  // Conviction gate: only push signals with grade ≥ B+ (score ≥ 80)
  if (signal.finalScore < 80) {
    return {
      ok: false,
      signalId: signal.id,
      symbol: signal.symbol,
      pattern: signal.pattern,
      reason: `Grade ${signal.finalGrade} (${signal.finalScore}) below auto-push threshold (B+/80)`,
    };
  }

  const idea = btcSignalToIdea(signal);
  const success = await createAndSaveUniversalIdea(idea);

  if (success) {
    logger.info(
      `[BTC-DESK] ✅ Pushed ${signal.symbol} ${signal.direction} ${signal.suggestedStrike}C/${signal.suggestedExpiry} (grade ${signal.finalGrade})`,
    );
  } else {
    logger.warn(
      `[BTC-DESK] ❌ Idea creation rejected for ${signal.symbol} — likely dedup or below confidence`,
    );
  }

  return {
    ok: success,
    signalId: signal.id,
    symbol: signal.symbol,
    pattern: signal.pattern,
    reason: success ? undefined : 'Dedup or below confidence threshold',
  };
}

// ─── Bulk: push all qualifying signals from a scan ─────────────────

export async function pushAllBTCSignals(signals: BTCSignal[]): Promise<{
  pushed: PushBTCSignalResult[];
  failed: PushBTCSignalResult[];
}> {
  const pushed: PushBTCSignalResult[] = [];
  const failed: PushBTCSignalResult[] = [];

  for (const sig of signals) {
    const result = await pushBTCSignalToDesk(sig);
    if (result.ok) pushed.push(result);
    else failed.push(result);
  }

  logger.info(
    `[BTC-DESK] Bulk push — ${pushed.length} pushed, ${failed.length} skipped (low grade or dedup)`,
  );
  return { pushed, failed };
}
