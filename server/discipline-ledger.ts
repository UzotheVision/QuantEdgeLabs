/**
 * The discipline shadow ledger — what the short gate costs and saves.
 *
 * The gate blocks pattern-shorts without an event catalyst. That is process,
 * and process is a claim: "these trades lose money on average." META's
 * gap-and-fade (2026-08-26) is the counterexample that demands the claim be
 * measured — the blocked short would have printed. So every block is recorded
 * here as a SHADOW trade (never published, never in the book, never in the
 * win rate) and replayed against real bars, so /api/discipline/ledger can
 * answer: is the gate saving money or costing money?
 *
 * File-backed JSONL (survives restarts; the DB free tier is quota-bound and
 * these are not trade ideas). One entry per symbol per day — the engine
 * re-drops the same candidate every warm cycle and a ledger that counts one
 * decision fifty times measures nothing.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logger';

export interface BlockedShort {
  symbol: string;
  blockedAt: string;      // ISO
  entryPrice: number;     // candidate's entry at block time
  stopLoss: number;
  targetPrice: number;
  reason: string;
  source: string;         // which scanner fed the candidate
}

const LEDGER_DIR = path.join(process.cwd(), 'server', 'data');
const LEDGER_PATH = path.join(LEDGER_DIR, 'discipline-ledger.jsonl');

let loaded = false;
const seen = new Set<string>();          // `${symbol}:${YYYY-MM-DD}`
let entries: BlockedShort[] = [];

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(LEDGER_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as BlockedShort;
        entries.push(e);
        seen.add(`${e.symbol}:${e.blockedAt.slice(0, 10)}`);
      } catch { /* skip corrupt line, keep the rest */ }
    }
  } catch { /* no ledger yet */ }
}

export async function recordBlockedShort(e: Omit<BlockedShort, 'blockedAt'>): Promise<void> {
  await load();
  const blockedAt = new Date().toISOString();
  const key = `${e.symbol}:${blockedAt.slice(0, 10)}`;
  if (seen.has(key)) return;
  if (!(e.entryPrice > 0) || !(e.stopLoss > 0) || !(e.targetPrice > 0)) return; // unreplayable
  seen.add(key);
  const entry: BlockedShort = { ...e, blockedAt };
  entries.push(entry);
  try {
    await fs.mkdir(LEDGER_DIR, { recursive: true });
    await fs.appendFile(LEDGER_PATH, JSON.stringify(entry) + '\n', 'utf8');
    logger.info(`[DISCIPLINE-LEDGER] recorded blocked short ${e.symbol} @ ${e.entryPrice} (${e.reason})`);
    try {
      const { pulse } = await import('./system-pulse');
      pulse('gate', `gate blocked ${e.symbol} short — ${e.reason} (shadow ledger will score it)`);
    } catch { /* pulse is decoration */ }
  } catch (err) {
    logger.warn('[DISCIPLINE-LEDGER] append failed:', err);
  }
}

export async function getLedger(): Promise<BlockedShort[]> {
  await load();
  return [...entries];
}
