/**
 * INDEX SWING SCANNER — SPX-complex pullback entries with the discount measured.
 *
 * Operator ask (2026-09-23): "find SPX discounts for swings... SPX QQQ IWM
 * SPY... a 1.0 can turn to 30." The honest version of that trade: buy index
 * premium when (a) the trend is up, (b) price has pulled back to a measured
 * level, and (c) premium is CHEAP (low VIX regime / chain IV near realized).
 * The $1→$30 outcome is a convexity tail, not a plan — cards say the 2R math
 * and let the tail be a bonus.
 *
 * Indices were structurally invisible before this: the tape leaderboard
 * excludes ETFs and the reversal scanner needs a 10% decline that index
 * products rarely print. This scanner owns the SPX complex directly.
 */
import { logger } from './logger';
import { getUniverseBars, liquidUniverseStatus, type UBar } from './liquid-universe';
import { ingestTradeIdea } from './trade-idea-ingestion';
import { quoteWithDayLow } from './bullflow-tape-scanner';

const INDEX_ETFS = ['SPY', 'QQQ', 'IWM', 'DIA', 'SMH', 'IGV', 'XBI'];
const MAX_PUBLISH = 2;
/** VIX below this = the cheap end of index premium (measured each run). */
const VIX_CHEAP = 16;

const dayDone = new Map<string, string>();
const marketDateET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

interface IndexSetup {
  symbol: string;
  lastClose: number;
  sma50: number;
  high20: number;
  pullbackPct: number;   // off the 20d high
  stop: number;
  stopBasis: string;
  t1: number;            // the 20d high — a real level
  t2: number;            // 2R beyond, declared
  riskPct: number;
  score: number;
  reasons: string[];
}

export function detectIndexPullback(
  symbol: string,
  bars: UBar[],
  opts: { pbMin?: number; pbMax?: number; riskMax?: number } = {},
): IndexSetup | null {
  const PB_MIN = opts.pbMin ?? 0.012;
  const PB_MAX = opts.pbMax ?? 0.06;
  const RISK_MAX = opts.riskMax ?? 0.045;
  const n = bars.length;
  if (n < 60) return null;
  const closes = bars.map((b) => b.close);
  const last = bars[n - 1];
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const sma50Prev = closes.slice(-60, -10).reduce((a, b) => a + b, 0) / 50;
  // Trend filter: above a RISING 50-session mean. Swing longs only (house
  // rule: no shorts without an event catalyst).
  if (!(last.close > sma50 && sma50 > sma50Prev)) return null;

  const last20 = bars.slice(-20);
  const high20 = Math.max(...last20.map((b) => b.high));
  const pullbackPct = (high20 - last.close) / high20;
  // The discount window: pulled back a real amount, but the trend intact.
  if (pullbackPct < PB_MIN || pullbackPct > PB_MAX) return null;

  // Pullback, not a crash: a single -3% index day IS the discount being
  // bought (XBI -3.2% on 2026-09-23 was the setup, not a disqualifier). What
  // disqualifies is persistent selling: any single session <= -3.5%, or the
  // last 3 sessions compounding to <= -5%.
  const last4 = bars.slice(-4);
  for (let k = 1; k < last4.length; k++) {
    if (last4[k].close / last4[k - 1].close - 1 <= -0.035) return null;
  }
  if (last4.length === 4 && last4[3].close / last4[0].close - 1 <= -0.05) return null;

  // Stop cascade, tightest printed low first: the pullback's own 3-session
  // floor is the natural invalidation; widen to 5 then 10 sessions only when
  // the tighter low leaves no room (<0.6%). A wide stop against a near
  // target is the R:R trap the storage gate rejects — tighter measured
  // stops fix the geometry honestly (IGV 2026-09-23: 3-session low made
  // R:R 1.3 where the 5-session low gave 0.49).
  let stop = NaN;
  let riskPct = NaN;
  for (const win of [3, 5, 10]) {
    const s2 = Math.min(...bars.slice(-win).map((b) => b.low));
    const r2 = (last.close - s2) / last.close;
    if (r2 >= 0.006 && r2 <= RISK_MAX) { stop = s2; riskPct = r2; break; }
  }
  if (!Number.isFinite(stop)) return null;

  const risk = last.close - stop;
  const t1 = Number(high20.toFixed(2));
  const t2 = Number((last.close + 2 * (t1 - last.close) + risk).toFixed(2));

  let score = 60;
  const reasons = [
    `uptrend: above a rising 50-session mean ($${sma50.toFixed(2)})`,
    `pulled back ${(pullbackPct * 100).toFixed(1)}% off the 20-session high $${high20.toFixed(2)}`,
    `invalidation at the 5-session low $${stop.toFixed(2)} (${(riskPct * 100).toFixed(1)}% risk)`,
  ];
  if (pullbackPct >= 0.025) { score += 8; reasons.push('deeper discount within the trend'); }
  const rr = (t1 - last.close) / risk;
  if (rr >= 1.5) { score += 8; reasons.push(`${rr.toFixed(1)}R just back to the prior high`); }

  return { symbol, lastClose: last.close, sma50, high20, pullbackPct, stop, stopBasis: '5-session low', t1, t2, riskPct, score, reasons };
}

async function vixNow(): Promise<number | null> {
  try {
    const YahooFinance = (await import('yahoo-finance2')).default as any;
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const q: any = await yf.quote('^VIX');
    const v = Number(q?.regularMarketPrice);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

export async function runIndexSwingScan(): Promise<number> {
  if (liquidUniverseStatus().size === 0) {
    logger.warn('[INDEX-SWING] liquid universe not warmed — skipped');
    return 0;
  }
  const bars = await getUniverseBars(70);
  const vix = await vixNow();
  const today = marketDateET();
  let published = 0;

  for (const sym of INDEX_ETFS) {
    if (published >= MAX_PUBLISH) break;
    if (dayDone.get(sym) === today) continue;
    let series = bars.get(sym);
    if (!series) continue;
    // Grouped daily bars end at the PRIOR close; the pullback being hunted is
    // usually happening TODAY. Append a live synthetic bar so the detector
    // sees the current session (volume unknown — set 0, never fabricated).
    try {
      const lq = await quoteWithDayLow(sym);
      if (lq) {
        const lastBarDate = new Date(series[series.length - 1].time * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        if (lastBarDate !== today) {
          series = [...series, {
            time: Math.floor(Date.now() / 1000),
            open: Number.isFinite(lq.prevClose) ? lq.prevClose : lq.last,
            high: Math.max(lq.last, Number.isFinite(lq.prevClose) ? lq.prevClose : lq.last),
            low: lq.low,
            close: lq.last,
            volume: 0,
          }];
        }
      }
    } catch { /* live augmentation is best-effort */ }
    const setup = detectIndexPullback(sym, series);
    if (!setup) { logger.info(`[INDEX-SWING] ${sym}: no qualifying pullback (trend/depth/risk gates)`); continue; }

    // The discount half: cheap index premium regime, measured not vibed.
    const cheap = vix != null && vix < VIX_CHEAP;
    const vixNote = vix != null
      ? `VIX ${vix.toFixed(1)} — ${cheap ? 'cheap end of index premium' : 'premium not at a discount'}`
      : 'VIX unavailable';

    // Convexity contract note from the picker (best-effort decoration).
    let contractNote = '';
    try {
      const { pickContracts } = await import('./contract-picker');
      const picked = await pickContracts(sym, { direction: 'long', dteMin: 7, dteMax: 21 });
      const c = picked?.candidates?.[0];
      if (c && c.delta != null) {
        const moveToT1 = setup.t1 - setup.lastClose;
        const roiT1 = (c.delta * moveToT1 * 100) / c.costPerContract;
        contractNote = ` Convexity read: ${c.label} @ $${c.mid} — delta-approx ${(roiT1 * 100).toFixed(0)}% on premium at T1 (approximation, not a promise; the $1→$30 story is a tail outcome, not the plan).`;
      }
    } catch { /* decoration only */ }

    const signals = [
      { type: 'index_trend_pullback', weight: 22, description: setup.reasons.slice(0, 2).join('; ') },
      { type: 'measured_invalidation', weight: 8, description: setup.reasons[2] },
      { type: 'premium_regime', weight: cheap ? 8 : 3, description: vixNote },
    ];

    try {
      const result = await ingestTradeIdea({
        source: 'market_scanner',
        symbol: sym,
        assetType: 'stock',
        direction: 'bullish',
        signals,
        holdingPeriod: 'swing',
        currentPrice: setup.lastClose,
        targetPrice: setup.t1,
        stopLoss: Number(setup.stop.toFixed(2)),
        catalyst: `Index swing discount: ${(setup.pullbackPct * 100).toFixed(1)}% pullback in an uptrend · ${vixNote}`,
        analysis:
          `Index-swing entry on the ${sym} complex: ${setup.reasons.join('; ')}. ` +
          `T1 $${setup.t1} is the prior 20-session high (a real level); T2 $${setup.t2} is declared as trend extension beyond it. ` +
          `${vixNote}.${contractNote}`,
        sourceMetadata: { scannerType: 'index_swing', vix, pullbackPct: setup.pullbackPct, t2: setup.t2 },
      });
      dayDone.set(sym, today);
      if (result.success) {
        published++;
        logger.info(`[INDEX-SWING] 📤 ${sym} — ${(setup.pullbackPct * 100).toFixed(1)}% pullback, ${vixNote}`);
      } else {
        logger.info(`[INDEX-SWING] ${sym} not published: ${result.reason}`);
      }
    } catch (err: any) {
      logger.warn(`[INDEX-SWING] ${sym} failed: ${err?.message ?? err}`);
    }
  }

  logger.info(`[INDEX-SWING] run done — ${published} published`);
  return published;
}

/**
 * LEADER SWING SCAN — the same trend-pullback discipline applied to the
 * single-name leadership universe (FTNT/NET/MRVL class). Operator 2026-09-23:
 * "trade ideas are only SPY and IWM when u can be catching FTNT, NET, MRVL".
 * Flow-confirmed like the reversal slate: the candidate's own aggressor tape
 * can veto (net sold) or boost (net bought) — one per-symbol read each.
 */
export async function runLeaderSwingScan(): Promise<number> {
  if (liquidUniverseStatus().size === 0) {
    logger.warn('[LEADER-SWING] liquid universe not warmed — skipped');
    return 0;
  }
  const { LEADERSHIP_UNIVERSE } = await import('@shared/leadership-universe');
  const { isUSMarketOpen } = await import('@shared/market-calendar');
  const bars = await getUniverseBars(70);
  const today = marketDateET();
  const cashOpen = isUSMarketOpen().isOpen;

  // Detect across every leadership single name with bars (ETFs are the other
  // scan's job). Single names breathe harder than indices: wider windows.
  const hits: Array<{ sym: string; setup: IndexSetup }> = [];
  for (const sym of LEADERSHIP_UNIVERSE) {
    if (INDEX_ETFS.includes(sym)) continue;
    if (dayDone.get(sym) === today) continue;
    const series = bars.get(sym);
    if (!series) continue;
    const setup = detectIndexPullback(sym, series, { pbMin: 0.02, pbMax: 0.09, riskMax: 0.06 });
    if (setup) hits.push({ sym, setup });
  }
  hits.sort((a, b) => b.setup.score - a.setup.score);
  logger.info(`[LEADER-SWING] ${hits.length} leadership pullback(s) qualify structurally`);

  let published = 0;
  let flowReads = 0;
  for (const { sym, setup } of hits) {
    if (published >= 3 || flowReads >= 10) break;

    // Flow confirmation — same discipline as the reversal slate.
    let flowNote = 'tape not read (budget)';
    let flowSignal: { type: string; weight: number; description: string } | null = null;
    try {
      const bf = await import('./bullflow-service');
      if (bf.bullflowEnabled()) {
        flowReads++;
        const read: any = await bf.getNetPremiumToday(sym);
        if (read) {
          const net = Number(read.callsNetPremium ?? 0) - Number(read.putsNetPremium ?? 0);
          if (net <= -500_000) {
            dayDone.set(sym, today);
            logger.info(`[LEADER-SWING] \u26d4 ${sym} vetoed — aggressor tape net sold $${(Math.abs(net) / 1e6).toFixed(1)}M into the pullback`);
            continue;
          }
          if (net >= 250_000) {
            flowNote = `+$${(net / 1e6).toFixed(2)}M net bullish tape`;
            flowSignal = { type: 'tape_confirmation', weight: 10, description: `aggressor tape confirms: ${flowNote}` };
          } else flowNote = 'tape thin/neutral';
        }
      }
    } catch { /* flow is confirmation, never a blocker when absent */ }

    // After hours: publish as a trigger above the close, never instant-entered.
    const entry = cashOpen ? setup.lastClose : Number((setup.lastClose * 1.003).toFixed(2));
    const risk = entry - setup.stop;
    const t1 = Number((Math.max(setup.t1, entry + 1.2 * risk)).toFixed(2));

    try {
      const result = await ingestTradeIdea({
        source: 'market_scanner',
        symbol: sym,
        assetType: 'stock',
        direction: 'bullish',
        signals: [
          { type: 'leader_trend_pullback', weight: 22, description: setup.reasons.slice(0, 2).join('; ') },
          { type: 'measured_invalidation', weight: 8, description: setup.reasons[2] },
          ...(flowSignal ? [flowSignal] : [{ type: 'benchmark_member', weight: 4, description: 'leadership-universe name — liquid options, institutional participation' }]),
        ],
        holdingPeriod: 'swing',
        currentPrice: entry,
        targetPrice: t1,
        stopLoss: Number(setup.stop.toFixed(2)),
        catalyst: `Leader swing: ${(setup.pullbackPct * 100).toFixed(1)}% pullback in an uptrend \u00b7 flow: ${flowNote}`,
        analysis:
          `Leadership-name swing entry: ${setup.reasons.join('; ')}. ` +
          `${cashOpen ? `Entry at last ($${entry.toFixed(2)})` : `Entry on a trigger at $${entry.toFixed(2)} (0.3% above the closed-market last \u2014 pending until touched in RTH)`}, ` +
          `T1 $${t1} (prior 20-session high or 1.2R minimum, whichever is higher). Aggressor tape: ${flowNote}.`,
        sourceMetadata: { scannerType: 'leader_swing', pullbackPct: setup.pullbackPct, flowNote },
      });
      dayDone.set(sym, today);
      if (result.success) {
        published++;
        logger.info(`[LEADER-SWING] \ud83d\udce4 ${sym} \u2014 ${(setup.pullbackPct * 100).toFixed(1)}% pullback, ${flowNote}`);
      } else {
        logger.info(`[LEADER-SWING] ${sym} not published: ${result.reason}`);
      }
    } catch (err: any) {
      logger.warn(`[LEADER-SWING] ${sym} failed: ${err?.message ?? err}`);
    }
  }
  logger.info(`[LEADER-SWING] run done \u2014 ${published} published of ${hits.length} structural hits`);
  return published;
}

/**
 * PREMIUM DISCOUNT SCAN — the operator's real SPX ask (2026-09-23): "spy qqq
 * discounts i mean for PREMIUMS not spy itself — it's hard, they get 1%
 * drawdowns these days." Correct: the modern index rarely discounts in
 * PRICE; it discounts in PREMIUM. Measured as weekly ATM implied vol vs the
 * index's own 20-session realized vol — when IV/RV <= 0.95, movement is
 * being sold below its recent actual cost, and with-trend weekly calls are
 * structurally cheap. No pullback required.
 */
export async function runPremiumDiscountScan(): Promise<number> {
  if (liquidUniverseStatus().size === 0) return 0;
  const bars = await getUniverseBars(30);
  const today = marketDateET();
  let published = 0;

  for (const sym of ['SPY', 'QQQ']) {
    if (dayDone.get('PD:' + sym) === today) continue;
    const series = bars.get(sym);
    if (!series || series.length < 22) continue;

    // Realized vol: 20-session close-to-close, annualized.
    const closes = series.map((b) => b.close);
    const rets: number[] = [];
    for (let i = closes.length - 20; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const rv = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);

    // Weekly ATM implied vol from the delayed chain.
    let iv: number | null = null;
    let atmLabel = '';
    try {
      const { fetchCboeChain } = await import('./contract-analyzer/cboe-chain');
      const chain = await fetchCboeChain(sym);
      if (chain && chain.spot > 0) {
        const dteOf = (e: string) => Math.max(0, Math.round((new Date(e + 'T21:00:00Z').getTime() - Date.now()) / 86_400_000));
        let best: any = null;
        for (const o of chain.rawChain) {
          if (String(o.option_type).toLowerCase() !== 'call') continue;
          const dte = dteOf(o.expiration_date);
          if (dte < 3 || dte > 9) continue;
          const miv = o.greeks?.mid_iv;
          if (miv == null || !(miv > 0)) continue;
          const dist = Math.abs(o.strike - chain.spot);
          if (!best || dist < best.dist) best = { dist, iv: Number(miv), strike: o.strike, exp: o.expiration_date, dte };
        }
        if (best) { iv = best.iv; atmLabel = `$${best.strike}C ${best.exp.slice(5)} (${best.dte} DTE)`; }
      }
    } catch { /* chain unavailable — no fabricated IV */ }
    if (iv == null) { logger.info(`[PREMIUM-DISC] ${sym}: no ATM IV from the chain — no read`); continue; }

    const ratio = iv / rv;
    const last = series[series.length - 1];
    const sma50src = closes.slice(-Math.min(50, closes.length));
    const sma = sma50src.reduce((a, b) => a + b, 0) / sma50src.length;
    const uptrend = last.close > sma;
    logger.info(`[PREMIUM-DISC] ${sym}: weekly ATM IV ${(iv * 100).toFixed(1)}% vs realized ${(rv * 100).toFixed(1)}% — ratio ${ratio.toFixed(2)}${uptrend ? '' : ' (no uptrend)'}`);
    if (!(ratio <= 0.95 && uptrend)) continue;

    const stop = Math.min(...series.slice(-3).map((b) => b.low));
    const risk = last.close - stop;
    if (!(risk / last.close >= 0.004 && risk / last.close <= 0.03)) continue;
    const t1 = Number((last.close + 2 * risk).toFixed(2));

    try {
      const result = await ingestTradeIdea({
        source: 'market_scanner',
        symbol: sym,
        assetType: 'stock',
        direction: 'bullish',
        signals: [
          { type: 'premium_discount', weight: 24, description: `weekly ATM IV ${(iv * 100).toFixed(1)}% vs realized ${(rv * 100).toFixed(1)}% (ratio ${ratio.toFixed(2)}) — movement priced below its recent actual cost` },
          { type: 'trend_alignment', weight: 8, description: 'with-trend: above the 50-session mean' },
          { type: 'measured_invalidation', weight: 8, description: `stop at the 3-session low $${stop.toFixed(2)}` },
        ],
        holdingPeriod: 'swing',
        currentPrice: last.close,
        targetPrice: t1,
        stopLoss: Number(stop.toFixed(2)),
        catalyst: `Premium discount: ${sym} weekly ATM IV ${(iv * 100).toFixed(1)}% vs realized ${(rv * 100).toFixed(1)}% (ratio ${ratio.toFixed(2)}) \u00b7 ${atmLabel}`,
        analysis:
          `Premium-discount read on ${sym}: the weekly ATM option (${atmLabel}) implies ${(iv * 100).toFixed(1)}% annualized movement while ` +
          `the index actually realized ${(rv * 100).toFixed(1)}% over 20 sessions \u2014 buyers of this premium pay ${ratio.toFixed(2)}x its recent ` +
          `actual cost. With-trend long expression; stop at the 3-session low. IV from the DELAYED chain \u2014 renew Tradier for live.`,
        sourceMetadata: { scannerType: 'premium_discount', iv, rv, ratio },
      });
      dayDone.set('PD:' + sym, today);
      if (result.success) { published++; logger.info(`[PREMIUM-DISC] \ud83d\udce4 ${sym} \u2014 ratio ${ratio.toFixed(2)}`); }
      else logger.info(`[PREMIUM-DISC] ${sym} not published: ${result.reason}`);
    } catch (err: any) {
      logger.warn(`[PREMIUM-DISC] ${sym} failed: ${err?.message ?? err}`);
    }
  }
  return published;
}
