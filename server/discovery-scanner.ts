/**
 * DISCOVERY SCANNER — find names nobody added to the list.
 *
 * Every scanner on this platform reads from a curated allowlist, so by
 * construction it can only re-rank names someone already thought of. That is why
 * the entire gold complex produced zero signals until it was added by hand, and
 * why BMNR and ASST were invisible while ASST ran 148% — both had full price
 * history available the whole time. The analysis was never the blocker. The
 * allowlist was.
 *
 * Adding those tickers by hand fixes those tickers and nothing else. The general
 * problem is that discovery has to start OUTSIDE the list, so this pulls
 * candidates from broad market screeners, drops anything already covered, and
 * makes the rest earn their way in through the same engines everything else is
 * judged by.
 *
 * The gate matters as much as the screen. A microcap that doubled on no volume
 * is not an opportunity for an options platform — there is no chain to trade and
 * no liquidity to get out through. So candidates clear price, volume and dollar-
 * volume floors BEFORE any clever analysis runs, because clever analysis on an
 * untradeable name is a waste of a scan and, worse, produces a signal that looks
 * actionable and is not.
 *
 * Nothing here auto-adds anything. It produces a ranked promotion list with the
 * evidence attached, and a human decides. A screen that silently rewrites its own
 * universe is a screen that cannot be audited.
 */
import { logger } from './logger';
import { yahooScreener, yahooChart } from './yahoo-client';
import { isApprovedTicker } from '@shared/approved-tickers';
import { findDivergences, type Bar } from '@shared/divergence-engine';
import { measureLeverage, isStale } from '@shared/theme-leverage';

/** Screeners to draw from. Deliberately mixed so this is not just a momentum list. */
export const CANDIDATE_SCREENS = [
  'most_actives',
  'day_gainers',
  'day_losers',
  'small_cap_gainers',
  'undervalued_growth_stocks',
] as const;

/** Below these a name is not tradeable as options, whatever the chart says. */
export const MIN_PRICE = 3;
export const MAX_PRICE = 600;
export const MIN_VOLUME = 500_000;
export const MIN_DOLLAR_VOLUME = 10_000_000;

export interface DiscoveryCandidate {
  symbol: string;
  price: number;
  changePct: number;
  volume: number;
  dollarVolume: number;
  foundVia: string[];
  /** Divergence evidence, when the chart shows any. */
  divergence: { kind: string; strength: number; barsAgo: number } | null;
  /** Relative strength against the broad market, in beta-adjusted points. */
  residualVsSpy: number | null;
  betaToSpy: number | null;
  /**
   * Which way the evidence points. 'watch' means it earned attention without the
   * chart taking a side — that is a real and common answer, not a missing one.
   */
  bias: 'long' | 'short' | 'watch';
  score: number;
  why: string;
}

function barsFrom(json: any): Bar[] {
  const q = json?.chart?.result?.[0]?.indicators?.quote?.[0];
  if (!q) return [];
  const out: Bar[] = [];
  for (let i = 0; i < (q.close?.length ?? 0); i++) {
    const h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if ([h, l, c].every((v) => Number.isFinite(v))) out.push({ high: h, low: l, close: c });
  }
  return out;
}

export interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
  /** Counts at each stage, so a silent zero is explainable rather than mysterious. */
  funnel: { pulled: number; novel: number; liquid: number; analysed: number; scored: number };
}

export async function runDiscovery(opts: { limit?: number } = {}): Promise<DiscoveryResult> {
  const limit = opts.limit ?? 12;
  const funnel = { pulled: 0, novel: 0, liquid: 0, analysed: 0, scored: 0 };

  // 1. Pull from several screeners and remember which surfaced each name; a name
  //    appearing on more than one list is a stronger candidate than one that
  //    scraped onto a single leaderboard.
  const seen = new Map<string, DiscoveryCandidate>();
  for (const screen of CANDIDATE_SCREENS) {
    let rows: Awaited<ReturnType<typeof yahooScreener>> = [];
    try {
      rows = await yahooScreener(screen, 50);
    } catch (err: any) {
      logger.warn(`[DISCOVERY] screener ${screen} failed: ${err?.message ?? err}`);
      continue;
    }
    funnel.pulled += rows.length;

    for (const r of rows) {
      // 2. Already covered means it is not a discovery.
      if (isApprovedTicker(r.symbol)) continue;
      // Skip anything that is not an ordinary US listing — warrants, units,
      // foreign classes. They quote fine and cannot be traded the same way.
      if (!/^[A-Z]{1,5}$/.test(r.symbol)) continue;

      const existing = seen.get(r.symbol);
      if (existing) { existing.foundVia.push(screen); continue; }

      seen.set(r.symbol, {
        symbol: r.symbol, price: r.price, changePct: r.changePct, volume: r.volume,
        dollarVolume: r.price * r.volume, foundVia: [screen],
        divergence: null, residualVsSpy: null, betaToSpy: null,
        bias: 'watch', score: 0, why: '',
      });
    }
  }
  funnel.novel = seen.size;

  // 3. Tradeability gate, before any analysis is spent.
  const liquid = [...seen.values()].filter(
    (c) => c.price >= MIN_PRICE && c.price <= MAX_PRICE
      && c.volume >= MIN_VOLUME && c.dollarVolume >= MIN_DOLLAR_VOLUME,
  );
  funnel.liquid = liquid.length;

  // Rank by breadth of appearance then dollar volume, and analyse only the top
  // slice — each candidate costs a chart fetch, and the limiter is shared with
  // everything else running.
  liquid.sort((a, b) => (b.foundVia.length - a.foundVia.length) || (b.dollarVolume - a.dollarVolume));
  const shortlist = liquid.slice(0, Math.max(limit * 3, 24));

  const spyBars = barsFrom(await yahooChart('SPY', { range: '6mo', interval: '1d' }));
  const spyCloses = spyBars.map((b) => b.close);

  for (const c of shortlist) {
    const bars = barsFrom(await yahooChart(c.symbol, { range: '6mo', interval: '1d' }));
    if (bars.length < 60) continue;
    const closes = bars.map((b) => b.close);
    if (isStale(closes)) continue;
    funnel.analysed++;

    const divs = findDivergences(bars, 3, 14);
    if (divs.length) {
      const d = divs[0];
      c.divergence = { kind: d.kind, strength: d.strength, barsAgo: d.barsSincePivot };
    }

    if (spyCloses.length > 60) {
      const lev = measureLeverage(spyCloses, [{ symbol: c.symbol, closes }]);
      if (lev.length) {
        c.betaToSpy = lev[0].beta;
        c.residualVsSpy = lev[0].residualPct;
      }
    }

    // Score: a fresh bullish divergence is the strongest single read, breadth of
    // appearance is corroboration, and outperformance the market cannot explain
    // is the part that says this is the NAME rather than the tape.
    // Direction comes from the divergence when there is one, and the strength of
    // the read has to be measured on the side it actually points. Scoring only
    // bullish divergences meant a bearish name could still rank on breadth and
    // alpha alone, and then sit in a list that reads as buy candidates. A signal
    // whose direction is unstated is worse than no signal.
    c.bias = c.divergence?.kind === 'bullish' ? 'long'
      : c.divergence?.kind === 'bearish' ? 'short'
      : 'watch';

    const divScore = c.divergence?.strength ?? 0;
    const breadth = Math.min(1, (c.foundVia.length - 1) / 2) * 100;
    // Outperformance the market cannot explain supports a LONG. For a short it is
    // evidence against, so it is read with the sign the bias implies rather than
    // always counted as a positive.
    const alphaRaw = c.residualVsSpy ?? 0;
    const alpha = c.bias === 'short'
      ? Math.min(100, Math.max(0, -alphaRaw))
      : Math.min(100, Math.max(0, alphaRaw));
    c.score = Math.round(divScore * 0.45 + breadth * 0.2 + alpha * 0.35);

    const bits: string[] = [];
    if (c.divergence) bits.push(`${c.divergence.kind} divergence (${c.divergence.strength}) ${c.divergence.barsAgo} bars ago`);
    if (c.foundVia.length > 1) bits.push(`on ${c.foundVia.length} screens`);
    if (c.residualVsSpy != null && Math.abs(c.residualVsSpy) > 5) {
      // State plainly when the alpha cuts AGAINST the direction. It contributes
      // nothing to the score in that case, but printing "+47pts" beside a short
      // reads as supporting evidence for the exact opposite of the call.
      const supports = c.bias === 'short' ? c.residualVsSpy < 0 : c.residualVsSpy > 0;
      const sign = c.residualVsSpy > 0 ? '+' : '';
      bits.push(
        `${sign}${c.residualVsSpy.toFixed(0)}pts vs what SPY explains`
        + (c.bias !== 'watch' && !supports ? ' (cuts against the call)' : ''),
      );
    }
    bits.push(`$${(c.dollarVolume / 1e6).toFixed(0)}M traded`);
    c.why = bits.join(' · ');
  }

  const scored = shortlist.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  funnel.scored = scored.length;

  logger.info(
    `[DISCOVERY] ${funnel.pulled} pulled → ${funnel.novel} novel → ${funnel.liquid} liquid → `
    + `${funnel.analysed} analysed → ${funnel.scored} scored`,
  );

  return { candidates: scored.slice(0, limit), funnel };
}
