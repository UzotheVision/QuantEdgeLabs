/**
 * GEX → TRADE DESK BRIDGE
 * =======================
 * One-click handoff from the GEX Hub / Terminal into a real trade idea.
 *
 * Pipeline:
 *   GEX Hub row click → POST /api/trade-desk/ideas/from-gex { symbol, workflow }
 *     → server fetches FRESH snapshot (never trust client levels)
 *     → snapshotToIdeaInput() builds entry/target/stop/catalyst from GEX walls + flip
 *     → createAndSaveUniversalIdea() persists it
 *     → idea shows up in Trade Desk with full GEX context attached
 *
 * Design decisions:
 *   - Server re-fetches snapshot to prevent client-side level tampering.
 *   - Bias auto-derives from regime + spot/flip relationship if not specified.
 *   - Levels: target = call wall, stop = put wall (or 8% / -8% fallback).
 *   - Suggested expiry = nearest expiry that contains the active workflow's bucket.
 *   - Idempotency: dedup by `${symbol}:gex:${workflow}` so spamming doesn't dupe.
 */

import { logger } from './logger';
import { calculateAggregateGammaExposure } from './gamma-exposure';
import { computeGEXFromCBOE } from './gex-cboe-fallback';
import { toSnapshot } from './gex-vex-scanner';
import {
  createAndSaveUniversalIdea,
  type UniversalIdeaInput,
  type IdeaSignal,
} from './universal-idea-generator';
import type { GEXSnapshot } from '../shared/gex-types';

export type GEXWorkflow = 'all' | 'today' | 'swing' | 'leaps' | 'flip' | 'posg' | 'negg';

export interface GEXIdeaOptions {
  workflow?: GEXWorkflow;
  /** Force a bias instead of auto-deriving */
  bias?: 'long' | 'short' | 'neutral' | 'auto';
}

// ─── Bias derivation ───────────────────────────────────────────

function deriveBias(snap: GEXSnapshot): 'long' | 'short' | 'neutral' {
  // Negative gamma + below flip = trending down → short
  // Negative gamma + above flip = trending up → long
  // Positive gamma below put wall = oversold pin → long bounce
  // Positive gamma above call wall = overbought pin → short fade
  // Otherwise: lean to whichever wall is closer
  const { regime, spotPrice, gammaFlipPrice, callWall, putWall } = snap;

  if (regime === 'negative_gamma' && gammaFlipPrice) {
    return spotPrice > gammaFlipPrice ? 'long' : 'short';
  }
  if (regime === 'positive_gamma') {
    if (callWall && spotPrice > callWall * 0.98) return 'short';      // at/above call wall → fade
    if (putWall && spotPrice < putWall * 1.02) return 'long';         // at/below put wall → bounce
    if (gammaFlipPrice && Math.abs(spotPrice - gammaFlipPrice) / spotPrice < 0.01) {
      return spotPrice > gammaFlipPrice ? 'long' : 'short';
    }
  }
  // Wall proximity tiebreak
  if (callWall && putWall) {
    const distCall = Math.abs(callWall - spotPrice) / spotPrice;
    const distPut = Math.abs(putWall - spotPrice) / spotPrice;
    if (distPut < distCall * 0.7) return 'long';   // closer to put wall → bounce
    if (distCall < distPut * 0.7) return 'short';  // closer to call wall → fade
  }
  return 'neutral';
}

// ─── Levels ────────────────────────────────────────────────────

function computeLevels(
  snap: GEXSnapshot,
  bias: 'long' | 'short' | 'neutral',
): { entry: number; target: number; stop: number } {
  const spot = snap.spotPrice;
  const cw = snap.callWall;
  const pw = snap.putWall;

  if (bias === 'long') {
    return {
      entry: spot,
      target: cw && cw > spot ? cw : spot * 1.05,
      stop: pw && pw < spot ? pw : spot * 0.96,
    };
  }
  if (bias === 'short') {
    return {
      entry: spot,
      target: pw && pw < spot ? pw : spot * 0.95,
      stop: cw && cw > spot ? cw : spot * 1.04,
    };
  }
  return { entry: spot, target: spot * 1.02, stop: spot * 0.98 };
}

// ─── Catalyst + signals ────────────────────────────────────────

function buildCatalyst(snap: GEXSnapshot, workflow: GEXWorkflow, bias: string): string {
  const parts: string[] = [];
  parts.push(`GEX ${bias.toUpperCase()}`);
  if (workflow !== 'all') parts.push(`(${workflow.toUpperCase()})`);
  if (snap.gammaFlipPrice) {
    const dist = ((snap.gammaFlipPrice - snap.spotPrice) / snap.spotPrice * 100).toFixed(1);
    parts.push(`flip $${snap.gammaFlipPrice.toFixed(0)} (${dist}%)`);
  }
  if (snap.callWall) parts.push(`CW $${snap.callWall.toFixed(0)}`);
  if (snap.putWall) parts.push(`PW $${snap.putWall.toFixed(0)}`);
  parts.push(`regime ${snap.regime.replace('_gamma', 'γ')}`);
  return parts.join(' · ');
}

function buildSignals(snap: GEXSnapshot, workflow: GEXWorkflow): IdeaSignal[] {
  const signals: IdeaSignal[] = [];

  // Wall setup quality
  if (snap.callWall && snap.putWall) {
    const range = ((snap.callWall - snap.putWall) / snap.spotPrice * 100).toFixed(1);
    signals.push({
      type: 'gex_wall_bracket',
      weight: 14,
      description: `Spot bracketed by walls — CW $${snap.callWall.toFixed(0)} / PW $${snap.putWall.toFixed(0)} (range ${range}%)`,
      data: { callWall: snap.callWall, putWall: snap.putWall },
    });
  }

  // Flip proximity
  if (snap.gammaFlipPrice) {
    const distPct = Math.abs(snap.gammaFlipPrice - snap.spotPrice) / snap.spotPrice;
    if (distPct < 0.015) {
      signals.push({
        type: 'gex_flip_proximity',
        weight: 16,
        description: `Spot within ${(distPct * 100).toFixed(2)}% of gamma flip $${snap.gammaFlipPrice.toFixed(0)} — high-energy zone`,
        data: { flip: snap.gammaFlipPrice, distancePct: distPct },
      });
    }
  }

  // Regime
  if (snap.regime === 'negative_gamma') {
    signals.push({
      type: 'gex_negative_regime',
      weight: 12,
      description: 'Negative gamma — dealers amplify moves. Breakouts and trends extend.',
    });
  } else if (snap.regime === 'positive_gamma') {
    signals.push({
      type: 'gex_positive_regime',
      weight: 10,
      description: 'Positive gamma — dealers dampen moves. Mean-reversion to max-gamma strike.',
    });
  }

  // Dealer-flow magnitude (the actionable number)
  if (snap.dealerFlowPer1Pct && Math.abs(snap.dealerFlowPer1Pct) > 1e8) {
    const usd = snap.dealerFlowPer1Pct;
    signals.push({
      type: 'gex_dealer_flow',
      weight: 10,
      description: `Dealers must hedge $${(Math.abs(usd) / 1e9).toFixed(2)}B per 1% move (${usd >= 0 ? 'long' : 'short'} gamma)`,
      data: { dealerFlowPer1Pct: usd },
    });
  }

  // Workflow-specific bucket
  if (workflow !== 'all' && snap.byDte) {
    const bucket =
      workflow === 'today' ? snap.byDte.today
      : workflow === 'swing' ? snap.byDte.month
      : workflow === 'leaps' ? snap.byDte.leaps
      : null;
    if (bucket) {
      signals.push({
        type: `gex_bucket_${workflow}`,
        weight: 8,
        description: `${workflow.toUpperCase()} bucket: ${bucket.expirationsCount} exps, GEX ${bucket.totalGEX.toFixed(2)}B, ` +
          `${bucket.callWall ? `CW $${bucket.callWall.toFixed(0)}` : 'no CW'}, ${bucket.putWall ? `PW $${bucket.putWall.toFixed(0)}` : 'no PW'}`,
        data: bucket as any,
      });
    }
  }

  return signals;
}

// ─── Main: snapshot → idea input ───────────────────────────────

export function snapshotToIdeaInput(
  snap: GEXSnapshot,
  opts: GEXIdeaOptions = {},
): UniversalIdeaInput {
  const workflow = opts.workflow ?? 'all';
  const bias = opts.bias && opts.bias !== 'auto' ? opts.bias : deriveBias(snap);
  const direction: 'bullish' | 'bearish' | 'neutral' =
    bias === 'long' ? 'bullish' : bias === 'short' ? 'bearish' : 'neutral';
  const levels = computeLevels(snap, bias);
  const signals = buildSignals(snap, workflow);
  const catalyst = buildCatalyst(snap, workflow, bias);

  // NOTE: We deliberately do NOT specify optionType/strike/expiry here.
  // Previously this guessed an ATM strike (round(spot)) and an arbitrary
  // calendar expiry (today + N days) — a contract that often isn't even
  // listed. Instead we hand the thesis (direction + levels + horizon) to the
  // universal pipeline, whose attachOptionContract() runs the canonical
  // option-selection engine against the REAL CBOE chain and picks the optimal
  // listed strike/expiry with live greeks + entry premium. Single source of
  // truth for contract selection — no more guessing.
  return {
    symbol: snap.symbol,
    source: 'quant_signal',          // closest existing IdeaSource for GEX-derived ideas
    assetType: 'option',             // GEX is options-driven (engine attaches the real contract)
    direction,
    currentPrice: snap.spotPrice,
    targetPrice: levels.target,
    stopLoss: levels.stop,
    signals,
    holdingPeriod: workflow === 'today' ? 'day' : workflow === 'leaps' ? 'position' : 'swing',
    catalyst,
    analysis: `Auto-generated from GEX Hub (${workflow.toUpperCase()} workflow) at ${new Date().toISOString()}. ` +
      `Spot $${snap.spotPrice.toFixed(2)} | Flip $${snap.gammaFlipPrice?.toFixed(0) ?? '—'} | ` +
      `CW $${snap.callWall?.toFixed(0) ?? '—'} | PW $${snap.putWall?.toFixed(0) ?? '—'} | ` +
      `Regime ${snap.regime} | Dealer flow $${((snap.dealerFlowPer1Pct ?? 0) / 1e9).toFixed(2)}B/1%.`,
    technicalSignals: signals.map(s => s.description),
  };
}

// ─── Public entry: re-fetch + create idea ──────────────────────

export interface CreateGEXIdeaResult {
  ok: boolean;
  symbol: string;
  workflow: GEXWorkflow;
  bias: 'long' | 'short' | 'neutral';
  reason?: string;
}

export async function createIdeaFromGEX(
  symbol: string,
  opts: GEXIdeaOptions = {},
): Promise<CreateGEXIdeaResult> {
  const sym = symbol.toUpperCase().trim();
  const workflow = opts.workflow ?? 'all';

  // Always re-fetch — never trust client-supplied levels
  let snap: GEXSnapshot | null = null;
  try {
    const result = await calculateAggregateGammaExposure(sym);
    if (result) snap = toSnapshot(result);
  } catch (e) {
    logger.warn(`[GEX→DESK] Tradier path failed for ${sym}: ${(e as Error).message}`);
  }
  if (!snap) {
    snap = await computeGEXFromCBOE(sym);
  }

  if (!snap) {
    return { ok: false, symbol: sym, workflow, bias: 'neutral', reason: 'No GEX snapshot available' };
  }

  const input = snapshotToIdeaInput(snap, opts);
  const success = await createAndSaveUniversalIdea(input);

  const bias = (input.direction === 'bullish' ? 'long' : input.direction === 'bearish' ? 'short' : 'neutral') as
    'long' | 'short' | 'neutral';

  if (success) {
    logger.info(`[GEX→DESK] ✅ Idea created for ${sym} (${workflow}/${bias}) — target $${input.targetPrice?.toFixed(2)} stop $${input.stopLoss?.toFixed(2)}`);
  } else {
    logger.warn(`[GEX→DESK] ❌ Idea creation rejected for ${sym} — likely dedup or low confidence`);
  }

  return {
    ok: success,
    symbol: sym,
    workflow,
    bias,
    reason: success ? undefined : 'Dedup or below confidence threshold',
  };
}
