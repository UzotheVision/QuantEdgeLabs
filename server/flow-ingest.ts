/**
 * FLOW INGEST — manual Bullflow / options-flow bridge.
 * ====================================================
 * The $39.99 Bullflow consumer tier has NO API (the SSE alert stream + GEX
 * endpoints are gated behind the $1,188/yr API add-on). So instead of pulling
 * a feed we let the user PASTE the alerts they already see in the app, then we:
 *
 *   1. parse each line into a ContractSpec (reusing the Contract Analyzer parser)
 *   2. analyze it through the SAME engine that powers the Oracle Option Pick
 *   3. push ONLY contracts grading B- and up (finalScore >= 70) to the Trade Desk
 *      as caller-specified option ideas (real strike/expiry/greeks preserved).
 *
 * Nothing is fabricated: if a line can't be parsed or the chain has no live
 * quote, that line is reported as skipped with a reason — never invented.
 */
import { parseContractInput, type ContractSpec } from './contract-analyzer/parser';
import { analyzeContract } from './contract-analyzer/analyze';
import {
  createAndSaveUniversalIdea,
  type UniversalIdeaInput,
  type IdeaSignal,
} from './universal-idea-generator';

/** Grade gate: B- = 70 on the shared grading scale. */
export const FLOW_MIN_SCORE = 70;

export interface FlowIngestItem {
  raw: string;
  parsed: boolean;
  symbol?: string;
  contract?: string;        // "$200C 2026-06-20"
  grade?: string;
  score?: number;
  pushed: boolean;
  reason: string;
}

export interface FlowIngestResult {
  items: FlowIngestItem[];
  parsedCount: number;
  gradedCount: number;
  pushedCount: number;
  minScore: number;
}

/** Split a pasted blob into candidate alert lines (one contract per line). */
function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Convert the analyzer's signal breakdown into idea-pipeline signals so the
 * Trade Desk's confidence reflects the real grade we just computed (rather than
 * the bare options_flow base). Weight is scaled from each signal's 0-100 score.
 */
function toIdeaSignals(
  analysis: NonNullable<Awaited<ReturnType<typeof analyzeContract>>>,
): IdeaSignal[] {
  const top = [...analysis.signals]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map<IdeaSignal>((s) => ({
      type: 'CONTRACT_SIGNAL',
      weight: Math.max(4, Math.min(18, Math.round(s.score / 6))),
      description: `${s.label} (${s.grade})`,
      data: { source: s.source, score: s.score },
    }));
  // Carry the headline grade as a dominant signal.
  top.unshift({
    type: 'CONTRACT_GRADE',
    weight: Math.max(8, Math.min(20, Math.round(analysis.finalScore / 5))),
    description: `Contract grades ${analysis.finalGrade} (${analysis.finalScore}/100) on the option engine`,
    data: { grade: analysis.finalGrade, score: analysis.finalScore },
  });
  return top;
}

function fmtContract(spec: ContractSpec): string {
  return `$${spec.strike}${spec.optionType === 'call' ? 'C' : 'P'} ${spec.expiry}`;
}

/**
 * Ingest a blob of pasted flow alerts. Each line is parsed, analyzed, and (if it
 * grades >= FLOW_MIN_SCORE) pushed to the Trade Desk as an options idea.
 */
export async function ingestFlowText(raw: string): Promise<FlowIngestResult> {
  const lines = splitLines(raw);
  const items: FlowIngestItem[] = [];
  let parsedCount = 0;
  let gradedCount = 0;
  let pushedCount = 0;

  for (const line of lines) {
    const spec = parseContractInput(line);
    if (!spec) {
      items.push({ raw: line, parsed: false, pushed: false, reason: 'Could not parse a contract from this line.' });
      continue;
    }
    parsedCount++;

    let analysis: Awaited<ReturnType<typeof analyzeContract>> = null;
    try {
      analysis = await analyzeContract(spec);
    } catch {
      analysis = null;
    }
    if (!analysis) {
      items.push({
        raw: line,
        parsed: true,
        symbol: spec.symbol,
        contract: fmtContract(spec),
        pushed: false,
        reason: 'No live chain/quote for this contract — skipped (not fabricated).',
      });
      continue;
    }
    gradedCount++;

    const base: FlowIngestItem = {
      raw: line,
      parsed: true,
      symbol: spec.symbol,
      contract: fmtContract(spec),
      grade: analysis.finalGrade,
      score: analysis.finalScore,
      pushed: false,
      reason: '',
    };

    if (analysis.finalScore < FLOW_MIN_SCORE) {
      base.reason = `Below B- (${analysis.finalScore} < ${FLOW_MIN_SCORE}) — not pushed.`;
      items.push(base);
      continue;
    }

    const direction = spec.optionType === 'call' ? 'bullish' : 'bearish';
    const input: UniversalIdeaInput = {
      symbol: spec.symbol,
      source: 'options_flow',
      assetType: 'option',
      direction,
      currentPrice: analysis.spotAtAnalysis,
      targetPrice: analysis.plan.t1,
      stopLoss: analysis.plan.invalidation,
      optionType: spec.optionType,
      strikePrice: spec.strike,
      expiryDate: spec.expiry,
      signals: toIdeaSignals(analysis),
      sourceMetadata: {
        flowPremium: spec.fillPrice,
        unusualActivityScore: analysis.finalScore,
      },
      holdingPeriod: analysis.plan.horizonDays <= 1 ? 'day' : analysis.plan.horizonDays <= 5 ? 'swing' : 'position',
      catalyst: `Bullflow alert: ${spec.symbol} ${fmtContract(spec)}`,
      analysis: analysis.synthesis,
    };

    let saved = false;
    try {
      saved = await createAndSaveUniversalIdea(input);
    } catch {
      saved = false;
    }
    base.pushed = saved;
    base.reason = saved
      ? `Graded ${analysis.finalGrade} (${analysis.finalScore}) — pushed to Trade Desk.`
      : `Graded ${analysis.finalGrade} (${analysis.finalScore}) but Desk rejected (dedup, watchlist gate, or confidence threshold).`;
    if (saved) pushedCount++;
    items.push(base);
  }

  return { items, parsedCount, gradedCount, pushedCount, minScore: FLOW_MIN_SCORE };
}
