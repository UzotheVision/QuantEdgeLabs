/**
 * GAP SCANNER — which names have a magnet, and does that name honour magnets?
 *
 * The gap engine answers this for one ticker. Run across the universe it becomes
 * a screen, and the ranking is the whole point: an unfilled gap is only
 * interesting when the ticker has a HISTORY of filling them. MARA with 100% of 31
 * gaps filled and one open 12% below is a setup. A name with three prior gaps and
 * one open is noise wearing the same shape.
 *
 * So candidates are scored on evidence, not on the gap alone:
 *   fill rate      — does this name actually fill? (needs enough samples to mean it)
 *   proximity      — near enough to matter inside an option's life
 *   speed          — how fast it usually closes them
 *   sample size    — below ten completed gaps the rate is withheld entirely
 *
 * Sector ETFs are scanned alongside single names, because "does XLE fill its gaps"
 * is the same question and nobody asks it of a sector.
 */
import { logger } from './logger';
import { analyzeGaps, type Bar } from '@shared/gap-engine';
import { yahooChart } from './yahoo-client';
import { DISCOVERY_UNIVERSE } from './multi-signal-discovery';

/** Sectors get scanned as first-class tickers, not as an afterthought. */
const SECTOR_ETFS = ['XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE','XLC','SMH','IGV','XBI','ITA','KRE','XRT','JETS'];

export interface GapCandidate {
  symbol: string;
  kind: 'stock' | 'sector';
  spot: number;
  /** The price that first touches the gap. */
  edge: number;
  zoneLow: number;
  zoneHigh: number;
  direction: 'up' | 'down';
  /** Signed — negative means the magnet sits below. */
  distancePct: number;
  ageBars: number;
  fillRate: number;
  samples: number;
  medianSessions: number | null;
  /** Higher = better evidence AND better position, not just a bigger gap. */
  score: number;
  read: string;
}

/** Below this many completed gaps the fill rate is not evidence. */
const MIN_SAMPLES = 10;
/** A magnet further than this is not actionable inside a normal option's life. */
const MAX_DISTANCE_PCT = 20;

function scoreCandidate(fillRate: number, samples: number, distancePct: number, medianSessions: number | null): number {
  // Evidence first. A 100% rate on 12 samples should not outrank 90% on 40.
  const sampleWeight = Math.min(1, samples / 40);
  const evidence = fillRate * (0.55 + 0.45 * sampleWeight);

  // Nearer is better, but a gap sitting on top of price is already being filled.
  const d = Math.abs(distancePct);
  const proximity = d < 1 ? 0.35 : Math.max(0, 1 - d / MAX_DISTANCE_PCT);

  // A name that closes gaps in 3 sessions is more useful than one that takes 40.
  const speed = medianSessions == null ? 0.5 : Math.max(0.25, 1 - medianSessions / 30);

  return Math.round(evidence * 55 + proximity * 30 + speed * 15);
}

async function barsFor(symbol: string): Promise<Bar[]> {
  const j = await yahooChart(symbol, { range: '2y', interval: '1d' });
  const res = j?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0];
  if (!res || !q) return [];
  return (res.timestamp || [])
    .map((t: number, i: number) => ({
      time: t, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i],
    }))
    .filter((b: any) => [b.open, b.high, b.low, b.close].every((v: any) => Number.isFinite(v)));
}

let _cache: { at: number; results: GapCandidate[] } | null = null;
const CACHE_MS = 30 * 60 * 1000;

export async function scanGaps(opts: { force?: boolean; limit?: number } = {}): Promise<{
  candidates: GapCandidate[];
  scanned: number;
  skippedThinHistory: number;
  note: string;
}> {
  if (!opts.force && _cache && Date.now() - _cache.at < CACHE_MS) {
    return {
      candidates: _cache.results.slice(0, opts.limit ?? 40),
      scanned: _cache.results.length,
      skippedThinHistory: 0,
      note: 'Cached scan — gaps only change when a new daily bar prints.',
    };
  }

  const universe = new Set<string>(SECTOR_ETFS);
  for (const syms of Object.values(DISCOVERY_UNIVERSE as Record<string, readonly string[]>)) {
    for (const s of syms) universe.add(s);
  }

  const out: GapCandidate[] = [];
  let scanned = 0;
  let thin = 0;

  for (const symbol of universe) {
    const bars = await barsFor(symbol);
    if (bars.length < 120) continue;
    scanned++;

    const rep = analyzeGaps(bars, symbol);
    if (!rep) continue;

    // Refuse to rank on a rate that has not earned it.
    if (rep.stats.total < MIN_SAMPLES || rep.stats.fillRate == null) { thin++; continue; }
    if (rep.stats.fillRate < 0.6) continue;

    for (const g of rep.unfilled) {
      const dist = g.distancePct ?? 0;
      if (Math.abs(dist) > MAX_DISTANCE_PCT) continue;

      const score = scoreCandidate(rep.stats.fillRate, rep.stats.total, dist, rep.stats.medianBarsToFill);
      const below = dist < 0;
      out.push({
        symbol,
        kind: SECTOR_ETFS.includes(symbol) ? 'sector' : 'stock',
        spot: rep.spot,
        edge: g.nearEdge,
        zoneLow: Math.min(g.from, g.to),
        zoneHigh: Math.max(g.from, g.to),
        direction: g.direction,
        distancePct: dist,
        ageBars: g.ageBars,
        fillRate: rep.stats.fillRate,
        samples: rep.stats.total,
        medianSessions: rep.stats.medianBarsToFill,
        score,
        read:
          `$${g.nearEdge.toFixed(2)} sits ${Math.abs(dist).toFixed(1)}% ${below ? 'below' : 'above'} — ` +
          `${symbol} has filled ${(rep.stats.fillRate * 100).toFixed(0)}% of ${rep.stats.total} past gaps` +
          (rep.stats.medianBarsToFill != null ? `, median ${rep.stats.medianBarsToFill} sessions.` : '.') +
          ` Open ${g.ageBars} sessions.`,
      });
    }
  }

  out.sort((a, b) => b.score - a.score);
  _cache = { at: Date.now(), results: out };
  logger.info(`[GAP-SCAN] ${out.length} candidates across ${scanned} tickers (${thin} skipped for thin history)`);

  return {
    candidates: out.slice(0, opts.limit ?? 40),
    scanned,
    skippedThinHistory: thin,
    note:
      'Ranked on EVIDENCE, not gap size: a 100% fill rate on 12 samples does not outrank 90% on 40. Tickers with fewer than 10 completed gaps are excluded entirely rather than shown with a meaningless rate. A gap is a magnet, not a forecast — it says where price has unfinished business, not that it will go there.',
  };
}
