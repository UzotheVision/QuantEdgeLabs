/**
 * DISCOVERY → TRADE DESK BRIDGE
 * ==============================
 * The missing link. When the multi-signal discovery engine
 * finds an A+/A tier setup (score >= 70), this auto-creates
 * a trade idea in the Trade Desk so the user sees actionable
 * picks WITHOUT having to manually scan Discovery.
 *
 * This is what was missing: Discovery FOUND NOK/QRVO/MP/CSCO
 * but Trade Desk never received them as suggestions.
 *
 * Pipeline:
 *   findEliteSetups()  →  filter by tier  →
 *   compute entry/target/stop from ATR  →
 *   createAndSaveUniversalIdea()  →
 *   shows up in Trade Desk + Discord push
 */

import { logger } from './logger';
import { findEliteSetups, type MultiSignalScore } from './multi-signal-discovery';
import { createAndSaveUniversalIdea, type UniversalIdeaInput } from './universal-idea-generator';
import { sendDiscordAlert } from './discord-service';

// ═══════════════════════════════════════════════════════════════
// TIER → IDEA TRANSLATION
// ═══════════════════════════════════════════════════════════════

interface PushResult {
  ticker: string;
  tier: string;
  score: number;
  pushed: boolean;
  reason?: string;
}

/**
 * Convert a discovery score into entry/target/stop levels.
 * Uses GEX call wall as target if present, otherwise % offsets.
 */
function computeTradeLevels(setup: MultiSignalScore): {
  entry: number;
  target: number;
  stop: number;
  rrRatio: number;
} {
  const spot = setup.spot;
  // Entry: current spot (adjust to limit at -1% if you want pullback)
  const entry = spot;

  // Target: prefer GEX call wall, fall back to 12% upside
  const target = setup.signals.gex.callWall && setup.signals.gex.callRoom && setup.signals.gex.callRoom > 5
    ? setup.signals.gex.callWall
    : spot * 1.12;

  // Stop: prefer 8% below or recent swing low
  const stop = spot * 0.92;

  const rrRatio = (target - entry) / (entry - stop);

  return { entry, target, stop, rrRatio };
}

/**
 * Translate a Discovery setup into a UniversalIdeaInput.
 */
function setupToIdeaInput(setup: MultiSignalScore): UniversalIdeaInput {
  const levels = computeTradeLevels(setup);
  const isOption = !!setup.bestContract && setup.bestContract.style !== ('shares_only' as any);

  // Build catalyst string from signals
  const catalystParts: string[] = [];
  if (setup.signals.squeeze.firing) catalystParts.push(`BB squeeze firing (${setup.signals.squeeze.ratio.toFixed(2)})`);
  if (setup.signals.range.position > 90) catalystParts.push('breaking 2yr highs');
  if (setup.signals.iv.cheap) catalystParts.push(`IV anomaly (${setup.signals.iv.atm?.toFixed(0)}%)`);
  if (setup.signals.gex.regime === 'SQUEEZE-RISK') catalystParts.push('negative GEX squeeze setup');
  if (setup.signals.gex.callRoom && setup.signals.gex.callRoom < 18 && setup.signals.gex.callRoom > 3) {
    catalystParts.push(`GEX call wall +${setup.signals.gex.callRoom.toFixed(1)}%`);
  }
  if (setup.signals.catalyst.proximityDays !== null && setup.signals.catalyst.proximityDays < 30) {
    catalystParts.push(`${setup.signals.catalyst.type} in ${setup.signals.catalyst.proximityDays}d`);
  }
  const catalyst = `Multi-signal convergence ${setup.setupTier}: ${catalystParts.join(' + ')}`;

  // Build signals array from convergence components (required by UniversalIdeaInput)
  const signals = [
    setup.signals.squeeze.firing && {
      type: 'bb_squeeze_firing',
      weight: 15,
      description: `BB squeeze ratio ${setup.signals.squeeze.ratio.toFixed(2)} (firing)`
    },
    setup.signals.range.position > 90 && {
      type: 'breakout_2yr_high',
      weight: 12,
      description: `Position ${setup.signals.range.position.toFixed(0)}% — breaking 2yr high`
    },
    setup.signals.iv.cheap && {
      type: 'iv_anomaly',
      weight: 18,
      description: `Cheap IV ${setup.signals.iv.atm?.toFixed(0)}%`
    },
    setup.signals.gex.regime === 'SQUEEZE-RISK' && {
      type: 'gex_squeeze_risk',
      weight: 15,
      description: 'Negative GEX — volatility expansion setup'
    },
    setup.signals.gex.callRoom && setup.signals.gex.callRoom < 18 && setup.signals.gex.callRoom > 3 && {
      type: 'gex_call_wall',
      weight: 10,
      description: `GEX call wall ${setup.signals.gex.callWall} (+${setup.signals.gex.callRoom.toFixed(1)}%)`
    },
    setup.signals.catalyst.proximityDays !== null && setup.signals.catalyst.proximityDays < 30 && {
      type: 'catalyst_proximity',
      weight: 10,
      description: `${setup.signals.catalyst.type} in ${setup.signals.catalyst.proximityDays}d`
    }
  ].filter(Boolean) as Array<{ type: string; weight: number; description: string }>;

  // Always include at least one signal so UniversalIdeaInput.signals is never empty
  if (signals.length === 0) {
    signals.push({
      type: 'convergence_score',
      weight: 10,
      description: `Convergence score ${setup.score} (${setup.setupTier})`
    });
  }

  const baseInput: UniversalIdeaInput = {
    symbol: setup.ticker,
    source: 'quant_signal',
    assetType: isOption ? 'option' : 'stock',
    direction: 'bullish',
    currentPrice: setup.spot,
    targetPrice: levels.target,
    stopLoss: levels.stop,
    signals
  };

  // Add option-specific fields if a contract was suggested
  if (isOption && setup.bestContract) {
    baseInput.optionType = 'call';
    baseInput.strikePrice = setup.bestContract.strike;
    baseInput.expiryDate = setup.bestContract.expiry;
  }

  // Attach analysis text via cast (UniversalIdeaInput has additional optional fields)
  (baseInput as any).analysis = setup.thesis;
  (baseInput as any).catalyst = catalyst;
  (baseInput as any).confidenceScore = setup.score;
  (baseInput as any).riskRewardRatio = levels.rrRatio;

  return baseInput;
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Push Elite Setups Into Trade Desk
// ═══════════════════════════════════════════════════════════════

export async function pushEliteSetupsToTradeDesk(opts: {
  minScore?: number;
  maxIdeas?: number;
  pingDiscord?: boolean;
} = {}): Promise<PushResult[]> {
  const minScore = opts.minScore ?? 70;
  const maxIdeas = opts.maxIdeas ?? 8;
  const pingDiscord = opts.pingDiscord ?? true;

  logger.info(`[DISCOVERY→TRADE-DESK] Starting auto-push (minScore=${minScore})`);

  let elite: MultiSignalScore[];
  try {
    elite = await findEliteSetups();
  } catch (err) {
    logger.error('[DISCOVERY→TRADE-DESK] Discovery failed:', err);
    return [];
  }

  const top = elite.filter(s => s.score >= minScore).slice(0, maxIdeas);
  logger.info(`[DISCOVERY→TRADE-DESK] ${top.length} setups qualify`);

  const results: PushResult[] = [];
  for (const setup of top) {
    try {
      const input = setupToIdeaInput(setup);
      const success = await createAndSaveUniversalIdea(input);
      results.push({
        ticker: setup.ticker,
        tier: setup.setupTier,
        score: setup.score,
        pushed: success,
        reason: success ? 'Created' : 'Filtered (duplicate/quality gate)'
      });
    } catch (err: any) {
      logger.warn(`[DISCOVERY→TRADE-DESK] ${setup.ticker} failed: ${err.message}`);
      results.push({
        ticker: setup.ticker,
        tier: setup.setupTier,
        score: setup.score,
        pushed: false,
        reason: err.message
      });
    }
  }

  // Discord summary push
  if (pingDiscord && results.some(r => r.pushed)) {
    const pushed = results.filter(r => r.pushed);
    const summary =
      `🎯 DISCOVERY → TRADE DESK\n` +
      `${pushed.length} elite setups pushed (score >= ${minScore}):\n` +
      pushed.map(r => `  • ${r.ticker} [${r.tier}] score ${r.score}`).join('\n');
    try {
      await sendDiscordAlert(summary, 'info');
    } catch (e) {
      // Discord failure shouldn't break the push
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// SINGLE-TICKER PUSH (for manual user-triggered)
// ═══════════════════════════════════════════════════════════════

export async function pushSingleTickerToTradeDesk(ticker: string): Promise<PushResult> {
  const { scoreSingleTicker } = await import('./multi-signal-discovery');
  const setup = await scoreSingleTicker(ticker);
  if (!setup) {
    return { ticker, tier: '-', score: 0, pushed: false, reason: 'No data for ticker' };
  }
  if (setup.score < 50) {
    return {
      ticker, tier: setup.setupTier, score: setup.score, pushed: false,
      reason: `Score ${setup.score} below quality threshold`
    };
  }
  const input = setupToIdeaInput(setup);
  const success = await createAndSaveUniversalIdea(input);
  return {
    ticker, tier: setup.setupTier, score: setup.score,
    pushed: success,
    reason: success ? 'Created' : 'Quality filter blocked'
  };
}
