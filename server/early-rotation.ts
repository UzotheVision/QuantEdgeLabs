/**
 * EARLY ROTATION — catch the group while it's turning, not after it's run.
 *
 * The desk workflow is heatmap → leaders → flow → chart. But by the time a name is at the
 * top of the leaderboard the move is largely made; MRNA +151% is a headline, not an entry.
 * The trade worth having is the one where money is ALREADY rotating into the group and a
 * name inside it is still COILED — energy stored, breakout not yet taken.
 *
 * So this is a confluence, not a mover list. A candidate must satisfy all three:
 *   1. GROUP  — its sector is being bought relative to SPY (rotation in, decent breadth).
 *   2. COILED — the name is in a tested range or a squeeze (compression-engine).
 *   3. EARLY  — it has NOT already extended. A name up 12% today is not early, however
 *               good the sector looks; that is the chase the transcript warns about
 *               ("avoid chasing breakouts, let price confirm and use pullbacks").
 *
 * Names that pass are ranked by how much room is left, not by how much they've moved.
 */
import { logger } from './logger';
import { analyzeCompression, type Candle } from './compression-engine';

export interface EarlyCandidate {
  symbol: string;
  sector: string;
  sectorStrength: number;
  sectorMedianPct: number;
  changePct: number;
  score: number;
  coiled: 'strong' | 'developing';
  boxHigh: number | null;
  boxLow: number | null;
  positionInBox: number | null;
  squeezeBars: number;
  distanceToBreakoutPct: number | null;
  why: string;
}

export interface EarlyRotationResult {
  generatedAt: string;
  session: string;
  sectorsRotatingIn: { key: string; label: string; medianChangePct: number; breadthPct: number }[];
  candidates: EarlyCandidate[];
  interpretation: string;
}

/** A name that has already run today is not an early entry. */
const EXTENDED_PCT = 6;

export async function findEarlyRotation(
  leadership: any,
  fetchCandles: (symbol: string) => Promise<Candle[]>,
  opts: { maxCandidates?: number } = {},
): Promise<EarlyRotationResult> {
  const max = opts.maxCandidates ?? 12;
  const sectors: any[] = leadership?.sectors ?? [];

  // 1 — groups money is actually moving into: bid vs the benchmark, with participation
  //     rather than one name doing all the work.
  const bench = leadership?.benchmarkChangePct ?? 0;
  const rotatingIn = sectors.filter((s) =>
    s.medianChangePct > bench && s.breadthPct >= 55 && !s.isSkewed,
  );

  const candidates: EarlyCandidate[] = [];

  for (const sector of rotatingIn) {
    // look across the whole group, not just the leaders — the leaders are the ones that
    // already moved, and we're explicitly hunting the ones that haven't.
    // leaders and laggards overlap in small groups, so dedupe by symbol
    const seenSym = new Set<string>();
    const names = [...(sector.leaders ?? []), ...(sector.laggards ?? [])].filter((n: any) => {
      if (!n?.symbol || seenSym.has(n.symbol)) return false;
      seenSym.add(n.symbol);
      return true;
    });
    for (const n of names) {
      if (candidates.length >= max * 3) break;

      // 3 — early filter first; it's free and rejects most of the board
      if (n.changePct >= EXTENDED_PCT) continue;

      let candles: Candle[] = [];
      try { candles = await fetchCandles(n.symbol); } catch { continue; }
      if (candles.length < 45) continue;

      // 2 — coiled?
      const c = analyzeCompression(candles);
      if (c.quality === 'none' || c.positionInBox == null) continue;

      // room to the breakout: how far price sits below the ceiling it must clear
      const distanceToBreakoutPct =
        c.boxHigh && candles.length
          ? ((c.boxHigh - candles[candles.length - 1].close) / candles[candles.length - 1].close) * 100
          : null;

      // Rank by readiness, not by what already happened:
      //   sector strength (the tailwind) + coil quality + how close to the trigger it is,
      //   penalised for how much of today's move is already spent.
      const proximity = distanceToBreakoutPct != null
        ? Math.max(0, 20 - Math.abs(distanceToBreakoutPct) * 2)
        : 0;
      const coilScore = c.quality === 'strong' ? 25 : 14;
      const score = Math.round(
        sector.strength * 0.4 + coilScore + proximity + (c.squeezeBars >= 3 ? 8 : 0) - n.changePct * 1.5,
      );

      candidates.push({
        symbol: n.symbol,
        sector: sector.label,
        sectorStrength: sector.strength,
        sectorMedianPct: sector.medianChangePct,
        changePct: n.changePct,
        score,
        coiled: c.quality,
        boxHigh: c.boxHigh,
        boxLow: c.boxLow,
        positionInBox: c.positionInBox,
        squeezeBars: c.squeezeBars,
        distanceToBreakoutPct,
        why:
          `${sector.label} is being bought (${sector.medianChangePct >= 0 ? '+' : ''}${sector.medianChangePct.toFixed(2)}%, ` +
          `${sector.breadthPct.toFixed(0)}% green) and ${n.symbol} is still coiled — ${c.summary}` +
          (distanceToBreakoutPct != null ? ` · ${distanceToBreakoutPct.toFixed(1)}% to the ceiling` : '') +
          `. Only ${n.changePct >= 0 ? '+' : ''}${n.changePct.toFixed(1)}% today, so the move isn't spent.`,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, max);

  const interpretation = top.length
    ? `${rotatingIn.length} sector${rotatingIn.length === 1 ? '' : 's'} taking inflows. ` +
      `${top.length} name${top.length === 1 ? ' is' : 's are'} coiled inside them and haven't moved yet — ` +
      `led by ${top[0].symbol} (${top[0].sector}). These are setups, not triggers: wait for the range to break.`
    : rotatingIn.length
      ? `${rotatingIn.length} sector(s) taking inflows, but nothing inside them is both coiled and un-extended right now.`
      : 'No sector is taking clean inflows right now — nothing to front-run.';

  logger.info(`[EARLY-ROTATION] ${rotatingIn.length} sectors in, ${top.length} early candidates`);

  return {
    generatedAt: new Date().toISOString(),
    session: leadership?.session ?? 'unknown',
    sectorsRotatingIn: rotatingIn.map((s) => ({
      key: s.key, label: s.label, medianChangePct: s.medianChangePct, breadthPct: s.breadthPct,
    })),
    candidates: top,
    interpretation,
  };
}
