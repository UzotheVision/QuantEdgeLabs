/**
 * BASE RECLAIM SCANNER — the setup a bull-flag scanner structurally cannot see.
 * ===========================================================================
 * A bull flag needs a STRONG PRIOR LEG UP followed by a shallow pullback. That
 * shape only exists in names already trending. Every name that sold off hard
 * and is now turning back up fails it by construction — not on merit, on shape.
 *
 * ORCL is the case that forced this. On 2026-08-31:
 *
 *   price $150.07   −40% from its $250.25 high   −29% over 60 sessions
 *   but  +5.3% over 5d, +5.8% over 20d, back above both SMA20 and SMA50
 *
 * That is a real, tradeable setup — a deep base being reclaimed — and the
 * platform had no scanner that could express it. Widening the universe made
 * ORCL visible; it still could not be MATCHED, because the pattern did not
 * exist in code.
 *
 * WHAT THIS LOOKS FOR
 *   1. A real drawdown       — well off the highs, so there is a base at all
 *   2. Downtrend exhausted   — the recent decline has stopped
 *   3. Reclaim confirmed     — price back above SMA20, and SMA20 turning up
 *   4. Structure rising      — a higher low versus the base low
 *   5. Volume participation  — the reclaim is not on air
 *
 * DELIBERATELY NOT A DIP BUYER. Condition 3 requires the reclaim to have
 * already happened. Buying a falling knife and buying a reclaimed base look
 * identical on a drawdown screen and behave nothing alike, so the reclaim is
 * required, not preferred.
 */
import { logger } from './logger';

export interface BaseReclaimSetup {
  symbol: string;
  score: number;
  currentPrice: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  drawdownPct: number;
  reclaimPct: number;
  baseLow: number;
  signals: string[];
}

const sma = (v: number[], n: number) =>
  v.length < n ? null : v.slice(-n).reduce((a, x) => a + x, 0) / n;

export function analyzeBaseReclaim(
  symbol: string,
  bars: { high: number; low: number; close: number; volume: number }[],
): BaseReclaimSetup | null {
  if (bars.length < 90) return null;

  const close = bars.map((b) => b.close);
  const last = close[close.length - 1];
  if (!Number.isFinite(last) || last <= 1) return null;

  const sma20 = sma(close, 20);
  const sma50 = sma(close, 50);
  const sma20Prev = sma(close.slice(0, -5), 20);
  if (sma20 == null || sma50 == null || sma20Prev == null) return null;

  const high = Math.max(...bars.map((b) => b.high));
  const drawdown = ((last - high) / high) * 100;

  // 1. There must be a base. Anything within 12% of its high is not basing,
  //    it is trending — bull-flag territory, not this scanner's.
  if (drawdown > -12) return null;
  // Below −65% is usually broken rather than basing; the reclaim rarely holds.
  if (drawdown < -65) return null;

  // 2. Locate the base low in the recent window, and require the low to be
  //    behind us rather than being printed right now.
  const recent = bars.slice(-60);
  const baseLow = Math.min(...recent.map((b) => b.low));
  const barsSinceLow = recent.length - 1 - recent.map((b) => b.low).lastIndexOf(baseLow);
  if (barsSinceLow < 5) return null; // still making lows

  // 3. Reclaim: price above SMA20, and SMA20 itself turning up.
  if (last < sma20) return null;
  if (sma20 <= sma20Prev) return null;

  const reclaimPct = ((last - baseLow) / baseLow) * 100;
  if (reclaimPct < 5) return null;   // not enough lift to call it reclaimed
  if (reclaimPct > 60) return null;  // the easy move is already gone

  const signals: string[] = [];
  let score = 45;

  signals.push(`${drawdown.toFixed(0)}% off highs — real base to reclaim`);
  signals.push(`+${reclaimPct.toFixed(1)}% off the base low, low is ${barsSinceLow} bars back`);
  signals.push('Price above SMA20 and SMA20 turning up');
  score += 12;

  if (last > sma50) { signals.push('Reclaimed SMA50 — the heavier level'); score += 14; }
  if (sma20 > sma50) { signals.push('SMA20 crossed back above SMA50'); score += 12; }

  // Higher low: the most recent swing low sits above the base low.
  const tail = bars.slice(-20);
  const tailLow = Math.min(...tail.map((b) => b.low));
  if (tailLow > baseLow * 1.02) { signals.push('Higher low vs the base'); score += 10; }

  // Volume must confirm. A reclaim on declining volume is drift, not demand.
  const vol = bars.map((b) => b.volume);
  const v10 = sma(vol, 10), v50 = sma(vol, 50);
  if (v10 && v50 && v50 > 0) {
    const ratio = v10 / v50;
    if (ratio >= 1.15) { signals.push(`Volume ${ratio.toFixed(2)}x its 50d — buyers present`); score += 12; }
    else if (ratio < 0.75) { score -= 10; signals.push(`Volume only ${ratio.toFixed(2)}x — thin reclaim`); }
  }

  // Momentum should be positive but not vertical.
  const r20 = ((last - close[close.length - 21]) / close[close.length - 21]) * 100;
  if (r20 > 0 && r20 < 25) { signals.push(`+${r20.toFixed(1)}% over 20d — steady, not vertical`); score += 8; }
  else if (r20 >= 25) { score -= 8; signals.push(`+${r20.toFixed(1)}% over 20d — extended, wait for a pullback`); }

  if (score < 60) return null;

  /**
   * Levels come from STRUCTURE, not from a fixed multiple.
   *
   * Stop sits just under the higher low — the price that invalidates the
   * reclaim thesis. Target is the next overhead supply shelf, capped so a name
   * 60% off its high does not advertise an unreachable target.
   */
  const stopLoss = Math.min(tailLow * 0.985, last * 0.94);
  const midRetrace = baseLow + (high - baseLow) * 0.5;
  const targetPrice = Math.min(midRetrace, last * 1.35);
  if (targetPrice <= last * 1.04) return null; // no room worth trading

  /**
   * Reject the setup on GEOMETRY, however good the pattern looks.
   *
   * This platform's own shadow ledger measured what happens without this gate:
   * across 175 resolved short setups the average risked 5.50% to make 3.91% —
   * 0.71:1 — which needs a 58.4% win rate to break even and delivered 42.3%.
   * Expected value −1.52% per trade. The patterns were not the problem; the
   * geometry was, and no pattern score can rescue a trade that has to be right
   * 58% of the time to lose nothing.
   *
   * At 1.5:1 the same trade only needs 40% to break even. The first pass of
   * this scanner returned MNDY at 0.35:1 and a row of gold ETFs near 0.68:1
   * with a perfect 100 pattern score, which is exactly the failure this stops.
   */
  const MIN_RR = 1.5;
  const risk = last - stopLoss;
  const reward = targetPrice - last;
  if (risk <= 0) return null;
  const rr = reward / risk;
  if (rr < MIN_RR) return null;

  // Geometry earns score rather than merely passing — a 3:1 setup is genuinely
  // better than a 1.5:1 one and should outrank it.
  score += Math.min(15, Math.round((rr - MIN_RR) * 10));
  signals.push(`R:R ${rr.toFixed(2)}:1 — needs ${(100 / (1 + rr)).toFixed(0)}% win rate to break even`);

  return {
    symbol,
    score: Math.max(0, Math.min(100, Math.round(score))),
    currentPrice: last,
    entryPrice: last,
    targetPrice,
    stopLoss,
    drawdownPct: drawdown,
    reclaimPct,
    baseLow,
    signals,
  };
}

/** Scan the full liquid universe for base reclaims. */
export async function getTopBaseReclaimSetups(limit = 40): Promise<BaseReclaimSetup[]> {
  const { getUniverseBars, getLiquidSymbols, loadLiquidUniverseFromDisk } = await import('./liquid-universe');
  if (getLiquidSymbols().length === 0) await loadLiquidUniverseFromDisk();

  const all = await getUniverseBars(180);
  logger.info(`[BASE-RECLAIM] 🔄 Scanning ${all.size} tickers for base reclaims...`);

  const out: BaseReclaimSetup[] = [];
  for (const [symbol, bars] of Array.from(all.entries())) {
    try {
      const s = analyzeBaseReclaim(symbol, bars as any);
      if (s) out.push(s);
    } catch { /* one bad series must not stop the sweep */ }
  }
  out.sort((a, b) => b.score - a.score);
  logger.info(`[BASE-RECLAIM] ✅ Found ${out.length} base reclaim setups`);
  return out.slice(0, limit);
}

/**
 * Publish base reclaims into the book.
 *
 * Mirrors ingestBullFlagIdeas, and goes through ingestTradeIdea rather than
 * writing rows directly — that is the path carrying the cross-source "already
 * held" check, so this scanner cannot restack a name another producer owns.
 */
export async function ingestBaseReclaimIdeas(): Promise<number> {
  try {
    const setups = await getTopBaseReclaimSetups(25);
    if (setups.length === 0) return 0;

    // Cap per sector so one theme (gold, uranium, silver) cannot take the board.
    // The first pass returned nine precious-metal ETFs in the top twenty — one
    // trade wearing nine tickers.
    const { getSectorForSymbol } = await import('./ticker-universe').catch(() => ({ getSectorForSymbol: null } as any));
    const perSector = new Map<string, number>();
    const picked: BaseReclaimSetup[] = [];
    for (const s of setups) {
      let sector = 'unknown';
      try { if (getSectorForSymbol) sector = (getSectorForSymbol as any)(s.symbol) ?? 'unknown'; } catch { /* keep unknown */ }
      const n = perSector.get(sector) ?? 0;
      if (sector !== 'unknown' && n >= 3) continue;
      perSector.set(sector, n + 1);
      picked.push(s);
      if (picked.length >= 12) break;
    }

    logger.info(`[BASE-RECLAIM] ${setups.length} ranked → ${picked.length} for ingest (${picked.map((s) => s.symbol).join(' ')})`);

    const { ingestTradeIdea } = await import('./trade-idea-ingestion');
    let ingested = 0;

    for (const setup of picked) {
      const rr = (setup.targetPrice - setup.entryPrice) / (setup.entryPrice - setup.stopLoss);
      try {
        const result = await ingestTradeIdea({
          source: 'market_scanner',
          symbol: setup.symbol,
          assetType: 'stock',
          direction: 'bullish',
          signals: setup.signals.map((sig, i) => ({
            type: `base_reclaim_${i}`,
            weight: Math.min(15, Math.round(setup.score / 7)),
            description: sig,
          })),
          holdingPeriod: 'swing',
          currentPrice: setup.currentPrice,
          targetPrice: setup.targetPrice,
          stopLoss: setup.stopLoss,
          catalyst: `🔄 Base Reclaim · quality ${setup.score}/100 · R:R ${rr.toFixed(2)}:1. ` +
            `${setup.drawdownPct.toFixed(0)}% off highs, +${setup.reclaimPct.toFixed(0)}% off the base low.`,
          analysis: `Base reclaim: price reclaimed SMA20 with the moving average turning up, after a ` +
            `${Math.abs(setup.drawdownPct).toFixed(0)}% drawdown. Base low $${setup.baseLow.toFixed(2)}, ` +
            `now $${setup.currentPrice.toFixed(2)}. Stop sits under the higher low, target at the mid-retracement. ` +
            `Signals: ${setup.signals.join(', ')}`,
        } as any);
        if (result.success) ingested++;
      } catch { /* dedup gate blocked — expected */ }
    }

    if (ingested > 0) logger.info(`[BASE-RECLAIM] 📥 Ingested ${ingested} base reclaim idea(s)`);
    return ingested;
  } catch (err: any) {
    logger.error(`[BASE-RECLAIM] ingest failed: ${err?.message ?? err}`);
    return 0;
  }
}
