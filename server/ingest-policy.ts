/**
 * INGEST POLICY — how many setups reach the board, and on what terms.
 * ==================================================================
 * WHY THIS EXISTS
 * Each scanner hard-coded its own cut: bull-flag took `diversifyBySector(ranked, 18, 3)`
 * and dropped everything else. Measured on one live sweep 2026-08-31:
 *
 *   831  setups found
 *   570  eligible (score >= 65)
 *    18  ingested
 *   552  discarded — 229 of them S/A tier, 411 with R:R >= 2.0
 *
 * Named casualties from that single sweep: BKNG (score 91, R:R 12.75:1),
 * SLM (91, 8.52), U (92, 7.33), HPE (92, 6.83), W (92, 7.25).
 *
 * A flat top-N also flattens quality: eighteen slots filled strictly by score
 * means a run of 92s consumes the whole board and nothing else is ever seen,
 * however good its geometry. Tiers fix that — each band gets its own quota, so
 * the board is a cross-section rather than a leaderboard.
 *
 * EVERYTHING HERE IS CONFIGURABLE at runtime via env, because the right cut is
 * an operator decision that changes with the market, not a constant.
 */
import { logger } from './logger';

export interface Tier {
  name: 'S' | 'A' | 'B' | 'C';
  minScore: number;
  /** Max ideas this tier may contribute per sweep. */
  quota: number;
}

export interface IngestPolicy {
  tiers: Tier[];
  /** Max ideas from any one sector per sweep. 0 disables the cap. */
  maxPerSector: number;
  /**
   * Minimum reward:risk. Enforced ABOVE pattern score on purpose.
   *
   * The platform's own shadow ledger measured 175 resolved setups averaging
   * 0.71:1 — needing a 58.4% win rate to break even and delivering 42.3%,
   * for -1.52% expected value per trade. No pattern score rescues that. A
   * 92-scoring setup risking 5% to make 3% is still a losing trade.
   */
  minRiskReward: number;
  /** Hard ceiling per sweep, after every other rule. */
  maxPerSweep: number;
}

const num = (key: string, dflt: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
};

/**
 * Defaults sized from the live distribution above: 45 S, 202 A, 239 B, 84 C.
 * The quotas deliberately do NOT scale with supply — a day that produces 200
 * A-tier setups is not a day to take 200 trades. They answer "how many of each
 * quality band is worth surfacing", which is a constant of attention, not of
 * market breadth.
 */
export function getIngestPolicy(): IngestPolicy {
  return {
    tiers: [
      { name: 'S', minScore: num('INGEST_S_MIN', 90), quota: num('INGEST_S_QUOTA', 5) },
      { name: 'A', minScore: num('INGEST_A_MIN', 80), quota: num('INGEST_A_QUOTA', 12) },
      { name: 'B', minScore: num('INGEST_B_MIN', 70), quota: num('INGEST_B_QUOTA', 10) },
      { name: 'C', minScore: num('INGEST_C_MIN', 65), quota: num('INGEST_C_QUOTA', 5) },
    ],
    maxPerSector: num('INGEST_MAX_PER_SECTOR', 4),
    minRiskReward: num('INGEST_MIN_RR', 1.5),
    maxPerSweep: num('INGEST_MAX_PER_SWEEP', 32),
  };
}

export interface Selectable {
  symbol: string;
  score: number;
  currentPrice: number;
  targetPrice: number;
  stopLoss: number;
}

export function riskReward(s: Selectable): number {
  const risk = Math.abs(s.currentPrice - s.stopLoss);
  const reward = Math.abs(s.targetPrice - s.currentPrice);
  return risk > 0 ? reward / risk : 0;
}

/**
 * Apply the policy: R:R gate, then per-tier quotas with a per-sector cap.
 *
 * Returns the chosen setups plus a breakdown, so the caller can log WHAT was
 * dropped and why. Silent truncation is how 552 good setups disappeared every
 * sweep without anyone noticing.
 */
export function selectForIngest<T extends Selectable>(
  ranked: T[],
  sectorOf: (symbol: string) => string,
  policy: IngestPolicy = getIngestPolicy(),
): { picked: (T & { tier: string; rr: number })[]; report: string } {
  const withRR = ranked
    .map((s) => ({ ...s, rr: riskReward(s) }))
    .sort((a, b) => b.score - a.score);

  const rrRejected = withRR.filter((s) => s.rr < policy.minRiskReward).length;
  const passRR = withRR.filter((s) => s.rr >= policy.minRiskReward);

  const picked: (T & { tier: string; rr: number })[] = [];
  const perSector = new Map<string, number>();
  const perTier = new Map<string, number>();
  let sectorBlocked = 0;

  /**
   * Assign each setup to its TRUE tier by score, then fill that tier's quota.
   *
   * The first version looped tiers over the whole sorted list, so once S filled
   * its five slots the A loop restarted at the top and took the NEXT 95s. The
   * result labelled 95-scoring setups as "C" — the tag described which quota
   * slot a name fell into, not its quality, which is worse than no tag at all.
   *
   * A 95 is S-tier whether or not S has room. If the band is full the setup is
   * simply not taken this sweep; it is never demoted into a lower band.
   */
  const tierFor = (score: number): Tier | null => {
    for (const t of policy.tiers) if (score >= t.minScore) return t;
    return null;
  };

  for (const tier of policy.tiers) {
    const quota = tier.quota;
    if (quota <= 0) continue;
    for (const s of passRR) {
      if (picked.length >= policy.maxPerSweep) break;
      if ((perTier.get(tier.name) ?? 0) >= quota) break;
      // Belongs to THIS band, not merely at or above its floor.
      if (tierFor(s.score)?.name !== tier.name) continue;
      if (picked.some((p) => p.symbol === s.symbol)) continue;

      const sector = (() => { try { return sectorOf(s.symbol) || 'unknown'; } catch { return 'unknown'; } })();
      if (policy.maxPerSector > 0 && sector !== 'unknown') {
        if ((perSector.get(sector) ?? 0) >= policy.maxPerSector) { sectorBlocked++; continue; }
        perSector.set(sector, (perSector.get(sector) ?? 0) + 1);
      }
      perTier.set(tier.name, (perTier.get(tier.name) ?? 0) + 1);
      picked.push({ ...s, tier: tier.name });
    }
  }

  const tierCounts = policy.tiers.map((t) => `${t.name}:${perTier.get(t.name) ?? 0}/${t.quota}`).join(' ');
  const report =
    `${ranked.length} ranked → ${passRR.length} passed R:R>=${policy.minRiskReward} ` +
    `(${rrRejected} rejected on geometry) → ${picked.length} selected [${tierCounts}] ` +
    `· ${sectorBlocked} blocked by sector cap(${policy.maxPerSector}) ` +
    `· ${passRR.length - picked.length} not taken this sweep`;

  return { picked, report };
}

export function logPolicy(scanner: string): void {
  const p = getIngestPolicy();
  logger.info(
    `[${scanner}] policy: ` +
    p.tiers.map((t) => `${t.name}>=${t.minScore}x${t.quota}`).join(' ') +
    ` · minRR ${p.minRiskReward} · sectorCap ${p.maxPerSector} · sweepMax ${p.maxPerSweep}`,
  );
}
