/**
 * EARNINGS → TRADE DESK BRIDGE
 * ============================
 * The missing link.
 *
 * The Earnings Hub (server/earnings-hub.ts) computes scored, ranked lottos
 * every 30 min. But until now those lottos lived in the UI only — they
 * never made it into the Trade Desk's actual idea database.
 *
 * This module fixes that. For any earnings-hub row (or batch of rows),
 * it builds a UniversalIdeaInput with full plan attached and persists
 * via createAndSaveUniversalIdea().
 *
 * Flow:
 *   Earnings Hub auto-rank
 *      ↓
 *   User clicks "+ Push to Desk" on a row
 *      OR cron auto-pushes S-tier lottos
 *      ↓
 *   POST /api/trade-desk/ideas/from-earnings
 *      ↓
 *   earningsRowToIdea(row) → IdeaInput
 *      ↓
 *   createAndSaveUniversalIdea() persists to tradeIdeas
 *      ↓
 *   Idea appears in Trade Desk UI
 *
 * Same pattern as gex-to-trade-desk.ts — earnings is the second source.
 */

import { logger } from './logger';
import {
  createAndSaveUniversalIdea,
  type UniversalIdeaInput,
  type IdeaSignal,
} from './universal-idea-generator';
import { buildEarningsHub, type EarningsRow } from './earnings-hub';

export type EarningsContractStyle = 'atm' | 'otm' | 'put';

export interface EarningsIdeaOptions {
  /** Which contract from the row to use — atm call default, otm for lottery, put for contrarian */
  contractStyle?: EarningsContractStyle;
  /** Override the default exit plan with custom T1/T2/stop */
  customPlan?: { t1?: number; t2?: number; stop?: number };
}

// ─── Build catalyst + signals from beat history + GEX implied move ──

function buildCatalyst(row: EarningsRow, contractStyle: EarningsContractStyle): string {
  const parts: string[] = [];
  parts.push(`EARNINGS ${row.date} ${row.time}`);
  if (row.beats) {
    parts.push(`${row.beats.beats}/${row.beats.total} beats avg ${row.beats.avgSurprisePct >= 0 ? '+' : ''}${row.beats.avgSurprisePct.toFixed(0)}%`);
  }
  parts.push(`IV ${row.ivPct.toFixed(0)}%`);
  parts.push(`iMove ±${row.impliedMovePct.toFixed(1)}%`);
  if (contractStyle === 'put') parts.push('CONTRARIAN PUT');
  else if (contractStyle === 'otm') parts.push('OTM LOTTERY');
  return parts.join(' · ');
}

function buildSignals(row: EarningsRow, contractStyle: EarningsContractStyle): IdeaSignal[] {
  const signals: IdeaSignal[] = [];

  // Beat track record
  if (row.beats) {
    const beatRate = row.beats.total > 0 ? row.beats.beats / row.beats.total : 0;
    const weight = beatRate >= 0.75 ? 18 : beatRate >= 0.5 ? 10 : 5;
    signals.push({
      type: 'earnings_beat_track',
      weight,
      description: `${row.beats.beats}/${row.beats.total} beats last 4Q (avg ${row.beats.avgSurprisePct >= 0 ? '+' : ''}${row.beats.avgSurprisePct.toFixed(0)}% surprise)`,
      data: row.beats,
    });
  }

  // Cost-to-implied-move ratio (cheaper = more asymmetric)
  if (row.costToMoveRatio < 0.5) {
    signals.push({
      type: 'earnings_iv_underpriced',
      weight: 14,
      description: `Option cost ${row.costToMoveRatio.toFixed(2)}x implied move — significantly underpriced for the expected reaction`,
      data: { costToMoveRatio: row.costToMoveRatio },
    });
  }

  // ROI at +1.5σ
  if (row.roiAt1_5Sigma >= 100) {
    signals.push({
      type: 'earnings_asymmetric_payoff',
      weight: 12,
      description: `+1.5σ move pays +${row.roiAt1_5Sigma.toFixed(0)}% on the contract`,
      data: { roi1_5: row.roiAt1_5Sigma, roi2: row.roiAt2Sigma },
    });
  }

  // Tier signal
  if (row.tier === 'S' || row.tier === 'A') {
    signals.push({
      type: 'earnings_tier',
      weight: row.tier === 'S' ? 10 : 6,
      description: `Tier-${row.tier} earnings setup (composite score ${row.lottoScore}/100)`,
      data: { tier: row.tier, score: row.lottoScore },
    });
  }

  // High IV magnitude (juiced premium = bigger spike potential)
  if (row.ivPct >= 80) {
    signals.push({
      type: 'earnings_iv_juiced',
      weight: 6,
      description: `IV ${row.ivPct.toFixed(0)}% — premium spike potential on direction surprise`,
    });
  }

  return signals;
}

// ─── Pick the right contract from the row ───────────────────────────

function pickContract(row: EarningsRow, style: EarningsContractStyle) {
  if (style === 'put') return row.otmPut;
  if (style === 'otm') return row.otmCall;
  return row.atmCall ?? row.otmCall;
}

// ─── Trade plan ─────────────────────────────────────────────────────

function buildPlan(
  row: EarningsRow,
  style: EarningsContractStyle,
): { entry: number; t1: number; t2: number; stop: number; confidence: number } {
  const spot = row.spot;
  const moveD = row.impliedMoveDollars;

  if (style === 'put') {
    return {
      entry: spot,
      t1: spot - moveD,            // -1σ
      t2: spot - 2 * moveD,        // -2σ
      stop: spot + 0.5 * moveD,    // tight stop on the upside
      confidence: 50,
    };
  }

  // call (atm or otm) — bullish plan
  return {
    entry: spot,
    t1: spot + moveD,              // +1σ
    t2: spot + 1.5 * moveD,        // +1.5σ
    stop: spot - moveD,            // -1σ stop = match risk
    confidence: row.tier === 'S' ? 75 : row.tier === 'A' ? 65 : 55,
  };
}

// ─── Main: row → trade idea ─────────────────────────────────────────

export function earningsRowToIdea(
  row: EarningsRow,
  opts: EarningsIdeaOptions = {},
): UniversalIdeaInput | null {
  const style = opts.contractStyle ?? 'atm';
  const contract = pickContract(row, style);
  if (!contract) {
    logger.warn(`[EARN→DESK] no contract available for ${row.symbol} (style=${style})`);
    return null;
  }

  const plan = opts.customPlan
    ? { ...buildPlan(row, style), ...opts.customPlan }
    : buildPlan(row, style);

  const direction: 'bullish' | 'bearish' | 'neutral' =
    style === 'put' ? 'bearish' : 'bullish';

  return {
    symbol: row.symbol,
    source: 'earnings_play',
    assetType: 'option',
    direction,
    currentPrice: row.spot,
    targetPrice: plan.t1,
    stopLoss: plan.stop,
    optionType: contract.type === 'PUT' ? 'put' : 'call',
    strikePrice: contract.strike,
    expiryDate: contract.expiry,
    signals: buildSignals(row, style),
    holdingPeriod: 'day',          // earnings = catalyst, exit at gap
    catalyst: buildCatalyst(row, style),
    analysis: [
      `Auto-generated from Earnings Hub at ${new Date().toISOString()}.`,
      `Contract: ${contract.strike} ${contract.type} exp ${contract.expiry} (${contract.dte} DTE) @ $${contract.mid.toFixed(2)} mid.`,
      `Spot $${row.spot.toFixed(2)} | IV ${row.ivPct.toFixed(0)}% | implied move ±${row.impliedMovePct.toFixed(1)}%.`,
      row.beats ? `Beat history: ${row.beats.beats}/${row.beats.total} avg ${row.beats.avgSurprisePct >= 0 ? '+' : ''}${row.beats.avgSurprisePct.toFixed(0)}% surprise.` : 'No beat history available.',
      `ROI scenarios: +1σ ${row.roiAt1Sigma >= 0 ? '+' : ''}${row.roiAt1Sigma.toFixed(0)}% · +1.5σ +${row.roiAt1_5Sigma.toFixed(0)}% · +2σ +${row.roiAt2Sigma.toFixed(0)}%.`,
      `Tier ${row.tier}, lotto score ${row.lottoScore}/100.`,
      `Plan: T1 $${plan.t1.toFixed(2)} (+1σ), T2 $${plan.t2.toFixed(2)}, stop $${plan.stop.toFixed(2)}.`,
      `Hold window: enter ${row.time === 'BMO' ? 'day BEFORE close' : 'day OF close'}, exit at next market open on the gap.`,
    ].join('\n\n'),
    technicalSignals: [
      row.thesis,
      `${contract.type} ${contract.strike} @ $${contract.mid.toFixed(2)}`,
      `Tier ${row.tier} score ${row.lottoScore}`,
    ],
  };
}

// ─── Public: create idea from a single symbol (refresh hub if needed) ─

export interface CreateEarningsIdeaResult {
  ok: boolean;
  symbol: string;
  contractStyle: EarningsContractStyle;
  reason?: string;
}

export async function createIdeaFromEarnings(
  symbol: string,
  opts: EarningsIdeaOptions = {},
): Promise<CreateEarningsIdeaResult> {
  const sym = symbol.toUpperCase().trim();
  const style = opts.contractStyle ?? 'atm';

  // Pull the latest earnings hub data
  const hub = await buildEarningsHub();
  const row = hub.upcoming.find(r => r.symbol === sym);

  if (!row) {
    return {
      ok: false, symbol: sym, contractStyle: style,
      reason: `${sym} not in this week's earnings universe`,
    };
  }

  const idea = earningsRowToIdea(row, opts);
  if (!idea) {
    return {
      ok: false, symbol: sym, contractStyle: style,
      reason: `no ${style} contract available`,
    };
  }

  const success = await createAndSaveUniversalIdea(idea);
  if (success) {
    logger.info(`[EARN→DESK] ✅ Idea created for ${sym} (${style}) — strike ${idea.strikePrice} ${idea.optionType} exp ${idea.expiryDate}`);
  } else {
    logger.warn(`[EARN→DESK] ❌ Idea creation rejected for ${sym} — likely dedup or below confidence`);
  }

  return {
    ok: success,
    symbol: sym,
    contractStyle: style,
    reason: success ? undefined : 'Dedup or below confidence threshold',
  };
}

// ─── Bulk: push all S/A-tier lottos to Trade Desk ──────────────────

export async function pushAllTopLottosToDesk(opts: {
  minScore?: number;
  tiers?: ('S' | 'A' | 'B')[];
} = {}): Promise<{ pushed: string[]; failed: { symbol: string; reason: string }[] }> {
  const minScore = opts.minScore ?? 70;
  const allowedTiers = opts.tiers ?? ['S', 'A'];

  const hub = await buildEarningsHub();
  const targets = hub.lottos.filter(r =>
    r.lottoScore >= minScore && allowedTiers.includes(r.tier as any),
  );

  logger.info(`[EARN→DESK] bulk push — ${targets.length} qualifying lottos`);

  const pushed: string[] = [];
  const failed: { symbol: string; reason: string }[] = [];

  for (const row of targets) {
    // Push BOTH the ATM and OTM lottery contracts so user gets a ladder
    const atm = await createIdeaFromEarnings(row.symbol, { contractStyle: 'atm' });
    if (atm.ok) pushed.push(`${row.symbol}-ATM`);
    else failed.push({ symbol: `${row.symbol}-ATM`, reason: atm.reason ?? '?' });

    if (row.otmCall && row.otmCall.mid < 1.5) {
      const otm = await createIdeaFromEarnings(row.symbol, { contractStyle: 'otm' });
      if (otm.ok) pushed.push(`${row.symbol}-OTM`);
      else failed.push({ symbol: `${row.symbol}-OTM`, reason: otm.reason ?? '?' });
    }
  }

  return { pushed, failed };
}
