/**
 * FLOW OUTCOME SCORER — grades earned from measured aftermath.
 *
 * Rival products stamp "Conviction: High" on prints and never look back. This
 * asks the only question that matters: what did prints of this class actually
 * DO? After each close, every persisted Bullflow print >= $250k gets a
 * peakReturn lookup (the contract's best price since the trade), and the
 * results accrue per alert class. Once a class has n >= MIN_REPORTABLE_SAMPLE
 * decided prints, its measured record can back (or replace) hand-set score
 * priors — until then it reports n and stays out of the scoring.
 */
import { logger } from './logger';
import { marketDateET } from '@shared/market-day';

export interface ScoredPrint {
  id: string;
  underlying: string;
  occ: string;
  optionType: 'call' | 'put';
  alertName: string;
  premium: number;
  fillPrice: number;
  at: string;
  peakPrice: number;
  peakPct: number;          // best % return since the print
  scoredAt: string;
}

const MIN_PREMIUM_TO_SCORE = 250_000;
const MAX_LOOKUPS_PER_RUN = 50;   // peakReturn is 60/min — stay under it

async function outcomesFile(): Promise<{ fs: typeof import('fs/promises'); file: string }> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const file = path.join(process.cwd(), 'server', 'data', 'bullflow-outcomes.jsonl');
  await fs.mkdir(path.dirname(file), { recursive: true }).catch(() => {});
  return { fs, file };
}

export async function readOutcomes(): Promise<ScoredPrint[]> {
  try {
    const { fs, file } = await outcomesFile();
    const raw = await fs.readFile(file, 'utf8');
    const out: ScoredPrint[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* skip corrupt */ }
    }
    return out;
  } catch { return []; }
}

/** Score today's (or a given ET date's) prints. Idempotent per print id. */
export async function scoreDayPrints(dateET = marketDateET()): Promise<{ scored: number; skipped: number }> {
  const { bullflowEnabled, readPersistedPrints, getPeakReturn } = await import('./bullflow-service');
  if (!bullflowEnabled()) return { scored: 0, skipped: 0 };

  const already = new Set((await readOutcomes()).map((o) => o.id));
  const candidates = (await readPersistedPrints(dateET))
    .filter((p) => p.premium >= MIN_PREMIUM_TO_SCORE && p.fillPrice > 0 && !already.has(p.id))
    .sort((a, b) => b.premium - a.premium)
    .slice(0, MAX_LOOKUPS_PER_RUN);

  const { fs, file } = await outcomesFile();
  let scored = 0, skipped = 0;
  for (const p of candidates) {
    const peak = await getPeakReturn(p.occ, p.fillPrice, Date.parse(p.at) / 1000);
    if (!peak) { skipped++; continue; }
    const row: ScoredPrint = {
      id: p.id, underlying: p.underlying, occ: p.occ, optionType: p.optionType,
      alertName: p.alertName, premium: p.premium, fillPrice: p.fillPrice, at: p.at,
      peakPrice: peak.peakPrice, peakPct: peak.peakPct, scoredAt: new Date().toISOString(),
    };
    await fs.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
    scored++;
    await new Promise((r) => setTimeout(r, 1100)); // ~55/min, under the 60/min cap
  }
  if (scored) {
    logger.info(`[FLOW-OUTCOMES] scored ${scored} print(s) for ${dateET} (${skipped} lookups failed)`);
    try {
      const { pulse } = await import('./system-pulse');
      pulse('flow', `print outcomes scored: ${scored} of today's $250k+ prints graded by measured peak return`);
    } catch { /* decoration */ }
  }
  return { scored, skipped };
}

/** Per-alert-class track record — the measured grade rivals can't print. */
export async function outcomesByClass(): Promise<Array<{ alertName: string; optionType: string; n: number; medianPeakPct: number; meanPeakPct: number; pctOver25: number }>> {
  const rows = await readOutcomes();
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.alertName}|${r.optionType}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r.peakPct);
  }
  const out: Array<{ alertName: string; optionType: string; n: number; medianPeakPct: number; meanPeakPct: number; pctOver25: number }> = [];
  for (const [k, peaks] of buckets) {
    const [alertName, optionType] = k.split('|');
    const sorted = [...peaks].sort((a, b) => a - b);
    out.push({
      alertName, optionType,
      n: peaks.length,
      medianPeakPct: Number(sorted[Math.floor(sorted.length / 2)].toFixed(1)),
      meanPeakPct: Number((peaks.reduce((s, x) => s + x, 0) / peaks.length).toFixed(1)),
      pctOver25: Number((100 * peaks.filter((x) => x >= 25).length / peaks.length).toFixed(0)),
    });
  }
  return out.sort((a, b) => b.n - a.n);
}
