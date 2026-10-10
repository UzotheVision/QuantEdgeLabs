/**
 * BOTTOM-REVERSAL SCANNER — catches turns, not continuations.
 *
 * The Sep 10-22 2026 semis run exposed the board's blind spot: every price
 * detector we had (bull flag, breakout) requires an ESTABLISHED up-leg, so a
 * name turning off a bottom — NNE bottoming Sep 16, AVGO Sep 16, AFRM Sep 10
 * — was invisible until the move was mostly over. This scanner detects the
 * two earliest honest shapes:
 *
 *   HIGHER-LOWS BASE  a dated bottom, then a tightening base of ascending
 *                     session lows with price pressing the base ceiling.
 *   V-RECOVERY        a sharp decline, a dated bottom, then an immediate
 *                     >=45% retrace of the decline within a week.
 *
 * Everything is measured and stated: the bottom has a date and a price, the
 * stop is a session low that actually printed, T1 is declared as 2R, T2 is
 *  the pre-decline high when that is a real destination (else declared 3R).
 *
 * Flow is CONFIRMATION, not discovery: after the price pattern qualifies a
 * name, one Bullflow per-symbol read stamps the aggressor tape on the card
 * ("+$0.8M net, 100% call-weighted, lean LONG"). A tape leaning SHORT vetoes
 * publication — visibly, in the log. This is the BMT architecture: their
 * $544K flow footnotes are per-symbol confirmations on pattern candidates,
 * not leaderboard discoveries.
 *
 * The detector is a PURE function over daily bars so research/validate-
 * bottom-reversal.ts can replay it as-of any historical session — thresholds
 * here were sanity-checked against the Sep run's actual bars before shipping.
 * Walk-forward honesty (signal-lab law): patterns fitted to a remembered run
 * are hypotheses, not laws — outcome tracking scores them like everything
 * else.
 */
import { logger } from './logger';
import { getUniverseBars, liquidUniverseStatus, type UBar } from './liquid-universe';
import { ingestTradeIdea } from './trade-idea-ingestion';

const MIN_PRICE = 1.5;
const MIN_DECLINE = 0.10;      // the fall into the bottom must be a real decline
const BOTTOM_WINDOW = 15;      // sessions searched for the bottom
const PRE_WINDOW = 20;         // sessions before the bottom defining the prior high
const MAX_RISK_PCT = 0.10;
const MIN_RISK_PCT = 0.01;
const MAX_PUBLISH = 6;
const MAX_FLOW_READS = 10;     // per sweep — 30/min provider budget is shared
/** Raw shapes are common (~12% of the universe on a choppy day); only the
 *  strongest earn a card. Validation showed the Sep winners scored 66-80. */
const MIN_PUBLISH_SCORE = 70;
/**
 * Operator feedback 2026-09-23 ("idk these tickers"): the slate must be
 * recognizable names. Publish only names doing >= this in average daily
 * dollar volume over 20 sessions — computed from the bars already in hand,
 * zero extra API cost. Favorites bypass the floor entirely.
 */
const MIN_AVG_DOLLAR_VOL = Number(process.env.REVERSAL_MIN_DOLLAR_VOL ?? 150e6);
import { FAVORITE_TICKERS as FAVORITES } from '@shared/leadership-universe';

export interface ReversalHit {
  symbol: string;
  pattern: 'higher_lows_base' | 'v_recovery';
  bottomDate: string;
  bottomLow: number;
  declinePct: number;
  sessionsSinceBottom: number;
  lastClose: number;
  entryZoneLow: number;
  entryZoneHigh: number;
  stop: number;
  stopBasis: string;
  t1: number;
  t2: number;
  t2Basis: string;
  riskPct: number;
  volConfirm: boolean;
  score: number;
  reasons: string[];
}

const dateOf = (b: UBar) => new Date(b.time * 1000).toISOString().slice(0, 10);

// Shared with every scanner via the ingestion gate; imported here as well so
// blocked wrappers don't even reach detection.
import { LEVERAGED_INVERSE_ETFS as LEVERAGED_INVERSE } from './trade-idea-ingestion';

/**
 * Evaluate the last bar of `bars` (oldest→newest daily OHLC). Pure — no I/O —
 * so the validation harness can replay any as-of date with bars.slice(0, i).
 */
export function detectBottomReversal(symbol: string, bars: UBar[]): ReversalHit | null {
  const n = bars.length;
  if (n < PRE_WINDOW + BOTTOM_WINDOW + 2) return null;
  const last = bars[n - 1];
  if (!(last.close >= MIN_PRICE)) return null;

  // Bottom: lowest session low of the last BOTTOM_WINDOW sessions, at least
  // 2 sessions ago so a shape exists after it.
  let bi = -1;
  for (let i = n - BOTTOM_WINDOW; i < n - 2; i++) {
    if (bi < 0 || bars[i].low < bars[bi].low) bi = i;
  }
  if (bi < PRE_WINDOW) return null;
  const bottom = bars[bi];
  const sessionsSince = n - 1 - bi;

  // The decline into the bottom must be real.
  let preHigh = 0;
  for (let i = bi - PRE_WINDOW; i < bi; i++) preHigh = Math.max(preHigh, bars[i].high);
  const declinePct = (preHigh - bottom.low) / preHigh;
  if (declinePct < MIN_DECLINE) return null;

  const since = bars.slice(bi + 1);
  const vol20 = bars.slice(n - 21, n - 1).reduce((s, b) => s + b.volume, 0) / 20;
  const volConfirm = vol20 > 0 && last.volume >= 1.25 * vol20;

  const finish = (
    pattern: ReversalHit['pattern'],
    stop: number,
    stopBasis: string,
    baseScore: number,
    reasons: string[],
  ): ReversalHit | null => {
    const riskPct = (last.close - stop) / last.close;
    if (!(riskPct >= MIN_RISK_PCT && riskPct <= MAX_RISK_PCT)) return null;
    const risk = last.close - stop;
    const t1 = Number((last.close + 2 * risk).toFixed(2));
    const usePreHigh = preHigh > t1 * 1.01;
    const t2 = Number((usePreHigh ? preHigh : last.close + 3 * risk).toFixed(2));
    let score = baseScore;
    if (declinePct >= 0.15) { score += 10; reasons.push(`deep decline ${(declinePct * 100).toFixed(0)}%`); }
    if (volConfirm) { score += 10; reasons.push('volume 1.25x+ its 20d average'); }
    return {
      symbol, pattern,
      bottomDate: dateOf(bottom), bottomLow: bottom.low, declinePct,
      sessionsSinceBottom: sessionsSince, lastClose: last.close,
      entryZoneLow: Number(last.close.toFixed(2)),
      entryZoneHigh: Number((last.close * 1.012).toFixed(2)),
      stop: Number(stop.toFixed(2)), stopBasis,
      t1, t2, t2Basis: usePreHigh ? 'pre-decline high' : '3R (no structural level above T1)',
      riskPct, volConfirm, score: Math.min(100, score), reasons,
    };
  };

  // ── V-RECOVERY: 2-7 sessions off the bottom, >=45% of the decline retraced,
  // still igniting (last close takes out the prior session's high), not
  // already extended.
  if (sessionsSince >= 2 && sessionsSince <= 7) {
    const retrace = (last.close - bottom.low) / (preHigh - bottom.low);
    const green = since.filter((b) => b.close > b.open).length / since.length;
    const prior = bars[n - 2];
    const igniting = last.close > prior.high;
    const extended = last.close > bottom.low * 1.40;
    if (retrace >= 0.45 && green >= 0.5 && igniting && !extended) {
      // Structural stop first. On a fast V the 3-session window still holds the
      // capitulation bar, putting risk past the cap — validation test A5 showed
      // the sharpest recoveries could never qualify. Fall back to a volatility
      // stop (1.5× ATR14 under the close) when the structural one is too wide.
      let stop = Math.min(...bars.slice(n - 3).map((b) => b.low));
      let stopBasis = 'lowest low of the last 3 sessions';
      if ((last.close - stop) / last.close > MAX_RISK_PCT) {
        const tr = bars.slice(n - 15).map((b, i, a) => i === 0 ? b.high - b.low
          : Math.max(b.high - b.low, Math.abs(b.high - a[i - 1].close), Math.abs(b.low - a[i - 1].close)));
        const atr = tr.slice(1).reduce((x, y) => x + y, 0) / (tr.length - 1);
        stop = last.close - 1.5 * atr;
        stopBasis = '1.5× ATR(14) under the close (capitulation bar too far for a structural stop)';
      }
      const hit = finish(
        'v_recovery', stop, stopBasis,
        55 + Math.round(20 * Math.min(1, retrace)),
        [`bottomed $${bottom.low.toFixed(2)} on ${dateOf(bottom)}`,
         `${(retrace * 100).toFixed(0)}% of the decline retraced in ${sessionsSince} sessions`,
         `${(green * 100).toFixed(0)}% green sessions since the bottom`],
      );
      if (hit) return hit;
    }
  }

  // ── HIGHER-LOWS BASE: >=4 sessions off the bottom, lows ascending (first
  // half's floor below second half's floor, both above the bottom), a tight
  // base, price pressing the ceiling.
  if (sessionsSince >= 4) {
    const mid = Math.floor(since.length / 2);
    const firstFloor = Math.min(...since.slice(0, mid).map((b) => b.low));
    const secondFloor = Math.min(...since.slice(mid).map((b) => b.low));
    const ascending = firstFloor > bottom.low && secondFloor > firstFloor;
    const baseHigh = Math.max(...since.map((b) => b.high));
    const rangePct = (baseHigh - bottom.low) / last.close;
    const posInBase = (last.close - bottom.low) / (baseHigh - bottom.low);
    if (ascending && rangePct <= 0.14 && posInBase >= 0.6) {
      const hit = finish(
        'higher_lows_base', secondFloor * 0.997, 'most recent higher low',
        60 + (rangePct <= 0.10 ? 10 : 0),
        [`bottomed $${bottom.low.toFixed(2)} on ${dateOf(bottom)}`,
         `ascending session floors ($${firstFloor.toFixed(2)} → $${secondFloor.toFixed(2)})`,
         `pressing the top of a ${(rangePct * 100).toFixed(1)}% base`],
      );
      if (hit) return hit;
    }
  }

  return null;
}

const dayDecisions = new Map<string, string>(); // symbol -> marketDate published/blocked
const marketDateET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/**
 * Sweep the liquid universe, flow-annotate the best hits, publish the top.
 * `publish: false` returns hits without writing anything (used by research).
 */
export async function runBottomReversalSweep(opts: { publish?: boolean } = {}): Promise<{ hits: ReversalHit[]; published: number }> {
  const publish = opts.publish ?? true;
  const status = liquidUniverseStatus();
  if (status.size === 0) {
    logger.warn('[BOTTOM-REV] liquid universe not warmed — sweep skipped');
    return { hits: [], published: 0 };
  }

  const bars = await getUniverseBars(45);
  const hits: ReversalHit[] = [];
  for (const [symbol, series] of bars.entries()) {
    if (LEVERAGED_INVERSE.has(symbol)) continue;
    try {
      const isFavorite = FAVORITES.has(symbol);
      if (!isFavorite) {
        // Liquidity floor: 20-session average dollar volume from the bars in
        // hand. Keeps the slate to names a trader recognizes and can size in.
        const recent = series.slice(-20);
        const avgDollarVol = recent.reduce((s, b) => s + b.close * b.volume, 0) / Math.max(1, recent.length);
        if (avgDollarVol < MIN_AVG_DOLLAR_VOL) continue;
      }
      const hit = detectBottomReversal(symbol, series);
      if (hit) {
        if (isFavorite) { hit.score = Math.min(100, hit.score + 8); hit.reasons.push('operator favorite'); }
        hits.push(hit);
      }
    } catch { /* one bad series must not kill the sweep */ }
  }
  hits.sort((a, b) => b.score - a.score);
  logger.info(`[BOTTOM-REV] ${hits.length} reversal shape(s) across ${bars.size} names`);
  if (!publish || hits.length === 0) return { hits, published: 0 };

  const today = marketDateET();
  let published = 0;
  let flowReads = 0;

  for (const h of hits) {
    if (published >= MAX_PUBLISH) break;
    if (h.score < MIN_PUBLISH_SCORE) break; // sorted desc — nothing below qualifies
    if (dayDecisions.get(h.symbol) === today) continue;

    // Flow confirmation — one per-symbol Bullflow read, budget-capped.
    let flowSignal: { type: string; weight: number; description: string } | null = null;
    let flowNote = 'tape not read this sweep (budget)';
    if (flowReads < MAX_FLOW_READS) {
      flowReads++;
      try {
        const bf = await import('./bullflow-service');
        const read = bf.bullflowEnabled() ? await bf.getNetPremiumToday(h.symbol) : null;
        if (read) {
          const calls = Number((read as any).callsNetPremium ?? 0);
          const puts = Number((read as any).putsNetPremium ?? 0);
          const net = calls - puts;
          const gross = Math.abs(calls) + Math.abs(puts);
          const callShare = gross > 0 ? Math.round((Math.abs(calls) / gross) * 100) : 0;
          if (net <= -250_000) {
            dayDecisions.set(h.symbol, today);
            logger.info(`[BOTTOM-REV] ⛔ ${h.symbol} ${h.pattern} vetoed — aggressor tape leans SHORT (net -$${(Math.abs(net) / 1e6).toFixed(2)}M)`);
            continue;
          }
          if (net >= 250_000) {
            flowNote = `+$${(net / 1e6).toFixed(2)}M net bullish, ${callShare}% call-weighted`;
            flowSignal = { type: 'tape_confirmation', weight: 10, description: `aggressor tape confirms: ${flowNote}` };
          } else {
            flowNote = 'tape thin/neutral (<$0.25M net)';
          }
        }
      } catch { /* flow is confirmation — its absence never blocks the pattern */ }
    }

    const patternLabel = h.pattern === 'v_recovery' ? 'V-Recovery' : 'Higher-Lows Base';
    const signals = [
      { type: h.pattern, weight: 22, description: `${patternLabel}: ${h.reasons[0]}; ${h.reasons[1]}` },
      { type: 'measured_decline', weight: 8, description: `recovering a ${(h.declinePct * 100).toFixed(0)}% decline (prior high basis for T2)` },
      { type: 'measured_invalidation', weight: h.volConfirm ? 9 : 6, description: `stop at the ${h.stopBasis} $${h.stop} (${(h.riskPct * 100).toFixed(1)}% risk)${h.volConfirm ? ' · volume confirms' : ''}` },
      ...(flowSignal ? [flowSignal] : []),
    ];

    try {
      // The evening sweep runs after the close: publish the entry as a
      // TRIGGER just above the close (BMT-style pending card), never as an
      // already-entered position. Targets re-derive from the trigger.
      const trigger = Number((h.lastClose * 1.003).toFixed(2));
      const trigRisk = trigger - h.stop;
      const t1FromTrigger = Number((trigger + 2 * trigRisk).toFixed(2));
      const result = await ingestTradeIdea({
        source: 'market_scanner',
        symbol: h.symbol,
        assetType: 'stock',
        direction: 'bullish',
        signals,
        holdingPeriod: 'swing',
        currentPrice: trigger,
        targetPrice: t1FromTrigger,
        stopLoss: h.stop,
        catalyst: `${patternLabel} off the $${h.bottomLow.toFixed(2)} bottom (${h.bottomDate}) · flow: ${flowNote}`,
        analysis:
          `${patternLabel} detected on daily bars. ${h.reasons.join('; ')}. ` +
          `Entry zone $${h.entryZoneLow}–$${h.entryZoneHigh}, stop at the ${h.stopBasis} ($${h.stop}). ` +
          `T1 $${h.t1} is declared 2R; T2 $${h.t2} is the ${h.t2Basis}. ` +
          `Aggressor tape: ${flowNote}. Reversal patterns are early by design — the invalidation is the whole thesis.`,
        sourceMetadata: { scannerType: 'bottom_reversal', pattern: h.pattern, bottomDate: h.bottomDate, t2: h.t2, t2Basis: h.t2Basis, flowNote },
      });
      dayDecisions.set(h.symbol, today);
      if (result.success) {
        published++;
        logger.info(`[BOTTOM-REV] 📤 ${h.symbol} ${patternLabel} (score ${h.score}) — bottomed ${h.bottomDate}, ${flowNote}`);
      } else {
        logger.info(`[BOTTOM-REV] ${h.symbol} not published: ${result.reason}`);
      }
    } catch (err: any) {
      logger.warn(`[BOTTOM-REV] ${h.symbol} failed: ${err?.message ?? err}`);
    }
  }

  logger.info(`[BOTTOM-REV] sweep done — ${published} published of ${hits.length} shapes`);
  return { hits, published };
}
