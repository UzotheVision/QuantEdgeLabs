/**
 * QUANT BOT — paper-trades the platform's own signals, so the engine gets a track record.
 *
 * Everything upstream produces opinions; nothing was recording whether they worked. The
 * bot closes that loop: it takes the highest-conviction signals into a paper portfolio,
 * manages them against their own stop/target, and books the result. It is a paper-execution
 * ledger — one source of calibration evidence, never a replacement for the platform outcome
 * model or a signal's 0–100 evidence grade.
 *
 * Rules are deliberately mechanical. A bot that second-guesses the signal is no longer
 * measuring the signal.
 */
import { logger } from './logger';
import { storage } from './storage';
import { convictionDisplayPercent } from '@shared/conviction-display';
import {
  executeTradeIdea, checkStopsAndTargets, updatePositionPrices, closePosition,
  calculatePortfolioValue, recordEquitySnapshot,
  getOpenPositions, getClosedPositions,
} from './paper-trading-service';

// The 10K book could not buy ONE contract of the board it measures: at 1-2%
// risk its premium ceiling was ~$250 while MSFT's conservative call cost $655
// and LITE's $2,865 — every fill died at the position sizer after passing
// every other gate. Options are lumpy; the account must afford the lumps.
// New clean-era book at 100K (1% risk ≈ $1K → ceiling ~$2.5K covers the
// board's actual premiums). The old 'Quant Bot' 10K book stays in the DB
// untouched for audit; this name creates a fresh ledger aligned with
// OUTCOME_BASELINE_DATE.
const BOT_PORTFOLIO_NAME = 'Quant Bot · 100K';
const BOT_USER = 'system-quant-bot';

export interface BotConfig {
  minConviction: number;   // only take signals at/above this raw conviction score
  maxOpen: number;         // concurrent positions
  startingCapital: number;
  riskPerTradePct: number;
  /** refuse a signal that has already travelled this far entry -> T1 (chase guard) */
  maxProgressPct: number;
  /** Minimum reward/risk on the underlying thesis before choosing an option. */
  minUnderlyingRR: number;
  /** Maximum live bid/ask spread accepted for a paper fill. */
  maxOptionSpreadPct: number;
  /** Maximum debit committed to one trade as a fraction of current cash. */
  maxDebitPct: number;
  /** Absolute managed-loss ceiling for one trade, independent of paper equity. */
  maxRiskDollars: number;
  /** Absolute debit ceiling for one trade, independent of paper equity. */
  maxDebitDollars: number;
  /** Minimum modeled contract return when the underlying reaches T1. */
  minContractRoiAtT1Pct: number;
  /** Do not simulate delayed-quote fills before this New York minute. */
  delayedFillNotBeforeEtMinutes: number;
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  // convictionScore is a raw CONFLUENCE-POINT sum, not a percent: it tops out around the
  // high 20s and the bands are S>=30 / A>=22 / B>=15. A threshold of 25 therefore left
  // only 3 eligible names out of 52. 18 takes solid B/A-band setups without scraping the
  // bottom of the board.
  minConviction: 18,
  maxOpen: 10,
  startingCapital: 100_000,
  riskPerTradePct: 2,
  // Past ~35% of the way to T1 the remaining reward no longer justifies the same risk.
  maxProgressPct: 35,
  minUnderlyingRR: 1,
  maxOptionSpreadPct: 0.15,
  maxDebitPct: 0.03,
  maxRiskDollars: 250,
  maxDebitDollars: 300,
  minContractRoiAtT1Pct: 30,
  // Opening prints and delayed option chains are especially stale/wide. SNOW's
  // $420C was booked at 09:38 ET for $25.18 after being published near $15.78.
  delayedFillNotBeforeEtMinutes: 10 * 60,
};

function easternMinutes(date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function easternDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Read the dedicated portfolio without changing account state. */
async function findBotPortfolio() {
  const all = await storage.getAllPaperPortfolios();
  const existing = Array.isArray(all) ? all.find((p: any) => p.name === BOT_PORTFOLIO_NAME) : null;
  return existing ?? null;
}

/** The bot trades one dedicated portfolio; create it only when a cycle is explicitly run. */
export async function getBotPortfolio(cfg: BotConfig = DEFAULT_BOT_CONFIG) {
  const existing = await findBotPortfolio();
  if (existing) return existing;

  return storage.createPaperPortfolio({
    userId: BOT_USER,
    name: BOT_PORTFOLIO_NAME,
    startingCapital: cfg.startingCapital,
    cashBalance: cfg.startingCapital,
    totalValue: cfg.startingCapital,
    // riskPerTrade is stored as a FRACTION (0.02 = 2%). Passing the percent value made
    // the sizer read 2 as 200% risk, which then hit the flat $5,000 position cap — two
    // trades consumed the entire $10k account. A bot that goes all-in on two names isn't
    // measuring signals.
    riskPerTrade: cfg.riskPerTradePct / 100,
    maxPositionSize: Math.round((cfg.startingCapital * 0.15)),
  } as any);
}

export interface BotRunResult {
  ranAt: string;
  portfolioId: string;
  opened: { symbol: string; reason: string }[];
  closed: { symbol: string; reason: string }[];
  skipped: number;
  openCount: number;
  /** Levels the bot exited on. A later fill clears the name for re-entry. */
  gapWatch: { symbol: string; level: number }[];
  error?: string;
}

/**
 * One bot cycle: mark positions to market, take exits the signal itself defined, then
 * fill any remaining slots with the best signals available.
 */

/**
 * Announce a closed position. Every exit route funnels through here — stop, target,
 * expiry settlement, gap magnet — so an exit reason can never be reported one way
 * in the log and another way in Discord. A notification failure must never roll
 * back a real close, hence the swallow.
 */
async function announceExit(pos: any, exitPrice: number, reason: string): Promise<void> {
  try {
    const { sendBotTradeExitToDiscord } = await import('./discord-service');
    const mult = pos.assetType === 'option' ? 100 : 1;
    const pnl = (exitPrice - Number(pos.entryPrice)) * Number(pos.quantity) * mult;
    await sendBotTradeExitToDiscord({
      symbol: pos.symbol,
      assetType: pos.assetType ?? 'option',
      optionType: pos.optionType ?? null,
      strikePrice: pos.strikePrice ?? null,
      entryPrice: Number(pos.entryPrice),
      exitPrice,
      quantity: Number(pos.quantity),
      realizedPnL: pnl,
      exitReason: reason,
      portfolio: 'Quant Bot',
      source: 'quant-bot',
    });
  } catch (err: any) {
    logger.warn(`[QUANT-BOT] exit alert failed for ${pos?.symbol}: ${err?.message ?? err}`);
  }
}

export async function runBotCycle(cfg: BotConfig = DEFAULT_BOT_CONFIG): Promise<BotRunResult> {
  const ranAt = new Date().toISOString();
  const opened: BotRunResult['opened'] = [];
  const closed: BotRunResult['closed'] = [];
  // Levels we exited on, so a later fill can flip the name back to a candidate.
  const gapWatch: { symbol: string; level: number }[] = [];
  let skipped = 0;

  const portfolio: any = await getBotPortfolio(cfg);
  if (!portfolio?.id) {
    return { ranAt, portfolioId: '', opened, closed, skipped, openCount: 0, gapWatch: [], error: 'no portfolio' };
  }

  // ── A cycle, concretely ──────────────────────────────────────────────────
  // For shares a "cycle" is just re-price and check levels. Options add a clock: every
  // contract has an expiry, and a position nobody settles would sit in the book forever
  // claiming value it no longer has. So a cycle is four steps, in this order:
  //   1. RE-PRICE every open contract from the live chain,
  //   2. SETTLE anything at or past expiry,
  //   3. EXIT on the premium stop / target,
  //   4. ENTER with whatever capacity is left.
  // Exits precede entries so a slot freed this cycle is reusable immediately.

  // 1 — re-price
  try {
    await updatePositionPrices(portfolio.id);
  } catch (err) {
    logger.warn('[QUANT-BOT] re-price failed:', err);
  }

  // 2 — settle expiries. An option is not a share: at expiry it either has intrinsic
  //     value or it is worth nothing, and either way it leaves the book.
  try {
    const open = await getOpenPositions(portfolio.id);
    const today = easternDateKey();
    const etMinute = easternMinutes();
    for (const pos of open as any[]) {
      if (!pos.expiryDate || !pos.optionType) continue;
      if (String(pos.expiryDate).slice(0, 10) > today) continue;

      // Same-day contracts are still alive during the cash session. The old
      // `expiry <= today` check liquidated every 0DTE position on the very next
      // bot cycle, which made an intraday strategy impossible. Flatten the
      // marked option shortly before the close; use intrinsic settlement only
      // after 16:00 ET (or on a later date).
      const expiryDay = String(pos.expiryDate).slice(0, 10);
      if (expiryDay === today && etMinute < 15 * 60 + 55) continue;
      if (expiryDay === today && etMinute < 16 * 60) {
        const markedExit = Number(pos.currentPrice ?? 0);
        await closePosition(pos.id, markedExit, '0dte_eod_exit');
        await announceExit(pos, markedExit, '0DTE time exit before close');
        closed.push({ symbol: pos.symbol, reason: '0DTE time exit before close' });
        continue;
      }

      // Intrinsic value at expiry — everything else (time value) is gone.
      const spot = Number(pos.underlyingPrice ?? pos.currentUnderlyingPrice ?? 0);
      const strike = Number(pos.strikePrice ?? 0);
      let settle = 0;
      if (spot > 0 && strike > 0) {
        settle = pos.optionType === 'call'
          ? Math.max(0, spot - strike)
          : Math.max(0, strike - spot);
      }
      const settlePx = Number(settle.toFixed(2));
      await closePosition(pos.id, settlePx, settle > 0 ? 'expired_itm' : 'expired_worthless');
      await announceExit(pos, settlePx, settle > 0 ? `expired ITM at $${settlePx.toFixed(2)}` : 'expired worthless');
      closed.push({ symbol: pos.symbol, reason: settle > 0 ? `expired ITM at $${settle.toFixed(2)}` : 'expired worthless' });
    }
  } catch (err) {
    logger.warn('[QUANT-BOT] expiry settlement failed:', err);
  }

  // Announce anything the board has newly published. Piggy-backs on the bot cycle
  // because it already holds a fresh conviction set; a separate cron would rebuild
  // the same expensive thing on its own schedule and drift out of step with it.
  try {
    const { alertNewSignals } = await import('./signal-alerts');
    // peekConvictions() is a CACHE-ONLY read that returns null on a cold cache and
    // never computes. Using it here meant alerts fired only if a human had loaded
    // the Oracle page in this same process since the last restart — otherwise this
    // block silently did nothing, with no error and no log. Signals scored 92 and
    // were never announced anywhere. getCachedConvictions() builds on a miss.
    const { getCachedConvictions } = await import('./convictions-engine');
    const board = await getCachedConvictions();
    const picks = board?.picks ?? [];
    if (picks.length) {
      const sent = await alertNewSignals(picks as any);
      logger.info(`[QUANT-BOT] board has ${picks.length} pick(s); announced ${sent}`);
    } else {
      // Silence has to be loud. An empty board is a real condition worth seeing.
      logger.warn('[QUANT-BOT] conviction board returned 0 picks — nothing to announce');
    }
  } catch (err) {
    logger.warn('[QUANT-BOT] signal alerts failed:', err);
  }

  // OPEX awareness. An IWM $296P was held into monthly expiration and settled
  // worthless because nothing in the cycle knew the date mattered. Contracts
  // expiring INTO the monthly are flagged before the roll/exit passes run, so the
  // decision is made with the calendar in view rather than after the fact.
  try {
    const { getOpexContext } = await import('@shared/opex-calendar');
    const opex = getOpexContext();
    if (opex.isOpexDay || opex.isOpexWeek) {
      const open = await getOpenPositions(portfolio.id);
      const atRisk = open.filter(
        (p: any) => p.assetType === 'option' && p.expiryDate && String(p.expiryDate).slice(0, 10) <= opex.thisMonth,
      );
      if (atRisk.length) {
        logger.warn(
          `[QUANT-BOT] ${opex.label}: ${atRisk.length} position(s) expire on or before ${opex.thisMonth} — ` +
          atRisk.map((p: any) => `${p.symbol} $${p.strikePrice}${String(p.optionType)[0].toUpperCase()}`).join(', '),
        );
      }
    }
  } catch (err) {
    logger.warn('[QUANT-BOT] opex check failed:', err);
  }

  // 3.5 — gap magnets. A static stop and target cannot see that the underlying has
  // a high-confidence unfilled gap sitting below a position that is well in profit.
  // MARA ran to +159% with a gap 12.4% under it on a name that has filled 100% of
  // 31 past gaps in a median of 3 sessions, and the bot held it back to +74%
  // because nothing consulted that. This banks the gain and records the level, so
  // the fill becomes a re-entry trigger rather than just a loss avoided.
  try {
    const { evaluateGapExit, describeGapExit } = await import('./gap-aware-exits');
    const { rateLimited } = await import('./provider-cache');
    const stillOpen = await getOpenPositions(portfolio.id);

    for (const pos of stillOpen) {
      if (pos.assetType !== 'option') continue;
      const cost = Number(pos.entryPrice) * Number(pos.quantity) * 100;
      const gainPct = cost > 0 ? (Number(pos.unrealizedPnL ?? 0) / cost) * 100 : 0;
      if (gainPct < 40) continue;   // cheap pre-filter before any network call

      const chart: any = await rateLimited('yahoo', 1200, async () => {
        const r = await fetch(
          `https://query2.finance.yahoo.com/v8/finance/chart/${pos.symbol}?range=2y&interval=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } },
        );
        return r.ok ? r.json() : null;
      });
      const res = chart?.chart?.result?.[0];
      const q = res?.indicators?.quote?.[0];
      if (!res || !q) continue;
      const bars = (res.timestamp || [])
        .map((t: number, i: number) => ({
          time: t, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i],
        }))
        .filter((b: any) => [b.open, b.high, b.low, b.close].every((v: any) => Number.isFinite(v)));

      // A long call is threatened by a gap below; a long put by one above.
      const dir = pos.optionType === 'put' ? 'short' : 'long';
      const signal = evaluateGapExit(bars, gainPct, dir as 'long' | 'short');
      if (signal.action !== 'scale_out') continue;

      logger.info(describeGapExit(pos.symbol, signal));
      const mark = Number(pos.currentPrice ?? pos.entryPrice);
      await closePosition(pos.id, mark, 'gap_magnet');
      await announceExit(pos, mark, `gap magnet at $${signal.gapLevel?.toFixed(2)} — banked +${gainPct.toFixed(0)}%`);
      closed.push({ symbol: pos.symbol, reason: `gap magnet at $${signal.gapLevel?.toFixed(2)} — banked +${gainPct.toFixed(0)}%` });
      gapWatch.push({ symbol: pos.symbol, level: signal.gapLevel ?? 0 });
    }
  } catch (err) {
    logger.warn('[QUANT-BOT] gap-exit check failed:', err);
  }

  // 3.7 — thesis check. The operator's rule, verbatim: "bot should be able to
  // take profit and switch thesis when the intelligence does." A bracket knows
  // two prices; it cannot know that the board now publishes the OPPOSITE
  // direction on a held name, or that the session's options tape turned
  // decisively against it. Two independent triggers, both evidence-gated:
  //   • BOARD FLIP — the conviction board's current pick on this symbol points
  //     the other way at or above the bot's own entry floor. The board is the
  //     strategy; holding against it measures nothing.
  //   • FLOW REVERSAL — >=$750k of dominant premium against the position at
  //     >=2:1 skew, with no tape-read contradiction (same honesty bar the
  //     generator's flow signal uses — skew alone can't tell buyer from seller,
  //     so the threshold is higher here than for entries).
  // Green positions bank the gain; red ones stop the bleeding. Either way the
  // exit reason names the evidence so the ledger can score this rule later.
  try {
    const { getCachedConvictions } = await import('./convictions-engine');
    const board = await getCachedConvictions();
    const byOppDir = new Map<string, any>();
    for (const p of board?.picks ?? []) byOppDir.set(`${p.symbol}:${p.direction}`, p);

    let flowAgainst: Map<string, { prem: number; skew: number }> | null = null;
    try {
      const { getTodayFlows } = await import('./options-flow-scanner');
      flowAgainst = new Map();
      const agg = new Map<string, { call: number; put: number; tapeNet: number }>();
      for (const f of getTodayFlows() as any[]) {
        const a = agg.get(f.symbol) ?? { call: 0, put: 0, tapeNet: 0 };
        // ×100 restores real dollars from the scanner's per-contract-price
        // units — without it the $750k reversal floor was effectively $75M
        // and this exit could never fire. (Unit bug, caught 2026-09-08.)
        const dollars = f.premium * 100;
        if (f.optionType === 'call') a.call += dollars; else a.put += dollars;
        if (f.biasBasis === 'tape') a.tapeNet += f.sentiment === 'bullish' ? 1 : f.sentiment === 'bearish' ? -1 : 0;
        agg.set(f.symbol, a);
      }
      for (const [sym, a] of agg) {
        const dom = a.call >= a.put ? 'call' : 'put';
        const domPrem = Math.max(a.call, a.put);
        const skew = Math.min(a.call, a.put) > 0 ? domPrem / Math.min(a.call, a.put) : Infinity;
        if (domPrem < 750_000 || skew < 2) continue;
        if (dom === 'call' && a.tapeNet < 0) continue;
        if (dom === 'put' && a.tapeNet > 0) continue;
        flowAgainst.set(`${sym}:${dom === 'call' ? 'long' : 'short'}`, { prem: domPrem, skew });
      }
    } catch { /* scanner cold — board flip still runs */ }

    const held = await getOpenPositions(portfolio.id);
    for (const pos of held as any[]) {
      const thesis = pos.optionType === 'put' ? 'short' : 'long';
      const opposite = thesis === 'long' ? 'short' : 'long';
      const mark = Number(pos.currentPrice ?? pos.entryPrice);
      if (!Number.isFinite(mark) || mark <= 0) continue;
      const cost = Number(pos.entryPrice) * Number(pos.quantity) * 100;
      const pnlPct = cost > 0 ? (Number(pos.unrealizedPnL ?? 0) / cost) * 100 : 0;
      const pnlWord = pnlPct >= 0 ? `banked +${pnlPct.toFixed(0)}%` : `cut at ${pnlPct.toFixed(0)}%`;

      const flip = byOppDir.get(`${pos.symbol}:${opposite}`);
      if (flip && flip.convictionScore >= cfg.minConviction) {
        await closePosition(pos.id, mark, 'thesis_flip');
        const why = `board flipped ${opposite.toUpperCase()} on ${pos.symbol} (score ${flip.convictionScore}) — ${pnlWord}`;
        await announceExit(pos, mark, why);
        closed.push({ symbol: pos.symbol, reason: why });
        continue;
      }

      // Flow-reversal exits are restricted to RED positions. The exit autopsy
      // replayed every green flow-reversal exit against the position's own
      // brackets: TSLA +364 would have been +2,696, AAPL −249 would have hit
      // target for +774. Opposing tape on a losing position is a cut signal;
      // on a winning one it is not evidence the brackets are wrong. (Board
      // FLIPS above still exit either way — a published opposite signal is a
      // stronger claim than tape skew.)
      const fx = flowAgainst?.get(`${pos.symbol}:${opposite}`);
      if (fx && (pos.unrealizedPnL ?? 0) < 0) {
        await closePosition(pos.id, mark, 'flow_reversal');
        const skewStr = fx.skew === Infinity ? 'one-sided' : `${fx.skew.toFixed(1)}:1`;
        const why = `options tape turned against it — $${(fx.prem / 1e6).toFixed(1)}M ${opposite === 'long' ? 'call' : 'put'} premium at ${skewStr} — ${pnlWord}`;
        await announceExit(pos, mark, why);
        closed.push({ symbol: pos.symbol, reason: why });
      }
    }
  } catch (err) {
    logger.warn('[QUANT-BOT] thesis check failed:', err);
  }

  // 3 — premium stop / target
  try {
    const exited = await checkStopsAndTargets(portfolio.id);
    for (const p of exited ?? []) {
      const reason = (p as any).exitReason ?? 'stop/target';
      closed.push({ symbol: p.symbol, reason });
      await announceExit(p, Number((p as any).exitPrice ?? 0), reason);
    }
  } catch (err) {
    logger.warn('[QUANT-BOT] exit check failed:', err);
  }

  // 2 — fill free slots with the best available signals
  try {
    const open = await getOpenPositions(portfolio.id);
    const slots = Math.max(0, cfg.maxOpen - open.length);

    if (slots > 0) {
      const { getCachedConvictions } = await import('./convictions-engine');
      const board = await getCachedConvictions({});
      const heldSymbols = new Set(open.map((p) => p.symbol));

      // ── Trade exactly what the board publishes, in the same order ────────────
      //
      // If the bot holds names the board isn't showing, the track record measures a
      // different strategy than the one on screen and proves nothing about the signals.
      // So: same list, same ranking, same rules the UI displays — plus the two gates the
      // board already shows and the bot was ignoring.
      const chaseGuard = (p: any) => {
        // How far price has already travelled entry -> T1. The board renders this as
        // "39% to T1". Entering there is the chase the desk warns about: the risk is the
        // same but most of the reward is gone, so the R:R the signal advertises is a lie
        // by the time we'd fill.
        const live = p.currentPrice;
        if (!live || !p.entryPrice || !p.targetPrice) return 0;
        const span = p.direction === 'long' ? p.targetPrice - p.entryPrice : p.entryPrice - p.targetPrice;
        const done = p.direction === 'long' ? live - p.entryPrice : p.entryPrice - live;
        return span > 0 ? (done / span) * 100 : 0;
      };

      const triggered = (p: any) => {
        // PENDING TRIGGER means price hasn't reached the entry yet. The board says so;
        // buying anyway means taking a trade the signal hasn't actually called.
        const live = p.currentPrice;
        if (!live || !p.entryPrice) return false;
        return p.direction === 'long' ? live >= p.entryPrice : live <= p.entryPrice;
      };

      const stoppedOut = (p: any) => {
        const live = p.currentPrice;
        if (!live || !p.stopLoss) return false;
        return p.direction === 'long' ? live <= p.stopLoss : live >= p.stopLoss;
      };

      // THE DAY IS A FILTER TOO. The board grades setups; nothing graded the tape,
      // so the bot would buy a conviction-30 call into a thin, negative-gamma OPEX
      // session and lose on direction, vol and chop at once — none of which the
      // setup's score knows about. Sitting in cash is a position, and this is the
      // only place the bot can take it.
      let tapeGate: { verdict: string; headline: string } | null = null;
      try {
        const { getTapeConditions } = await import('./tape-conditions');
        const tape = await getTapeConditions();
        tapeGate = { verdict: tape.verdict, headline: tape.headline };

        if (tape.verdict === 'sit_out') {
          logger.warn(`[QUANT-BOT] SIT OUT (tape ${tape.score}) — no entries this cycle. ${tape.headline}`);
          tape.signals.filter((x) => x.points < 0).forEach((x) => logger.warn(`  ${x.label}: ${x.detail}`));
          skipped += (board.picks ?? []).length;
          // openCount is computed after this block, so count the book directly.
          const held = await getOpenPositions(portfolio.id);
          return {
            ranAt, portfolioId: portfolio.id, opened, closed,
            skipped, openCount: held.length, gapWatch,
          };
        }
      } catch (err) {
        // A missing tape read must not stop the bot trading — it just loses the gate.
        logger.warn('[QUANT-BOT] tape read failed, proceeding without the gate:', err);
      }

      // A SELECTIVE tape used to raise the conviction floor 18 -> 26, which on a
      // board scoring 30/25/14/12 admitted exactly one name — a paper ledger
      // that exists to MEASURE signals was starving its own sample. Caution now
      // costs dollars instead of data: the floor stays put and position risk is
      // halved. Same respect for the tape read, twice the decided outcomes.
      const minConviction = cfg.minConviction;
      const riskFraction = tapeGate?.verdict === 'selective'
        ? (cfg.riskPerTradePct / 100) / 2
        : cfg.riskPerTradePct / 100;
      if (tapeGate?.verdict === 'selective') {
        logger.info(`[QUANT-BOT] selective tape — half size (${(riskFraction * 100).toFixed(1)}%/trade), floor unchanged at ${minConviction}`);
      }

      const candidates = (board.picks ?? [])
        .filter((p) => p.convictionScore >= minConviction)
        .filter((p) => !heldSymbols.has(p.symbol))
        .filter((p) => {
          if (!triggered(p)) { skipped++; return false; }          // pending trigger
          if (stoppedOut(p)) { skipped++; return false; }          // already invalidated
          if (chaseGuard(p) > cfg.maxProgressPct) { skipped++; return false; } // chasing
          return true;
        })
        .sort((a, b) => b.convictionScore - a.convictionScore)
        .slice(0, slots);

      for (const pick of candidates) {
        const idea: any = await storage.getTradeIdeaById(pick.ideaId).catch(() => null);
        if (!idea) { skipped++; continue; }

        // Most signals are tagged assetType 'option', but the platform stores the
        // UNDERLYING stock levels on them — the thesis is on the stock and the Contract
        // Engine picks the vehicle separately. Paper-trading them as options would need
        // live premium data, which we don't have (Tradier is unfunded/401). So the bot
        // trades the underlying against those same levels: it measures the SIGNAL, which
        // is the point, instead of failing to fill on a dead options feed.
        // ── Fill an actual CONTRACT, not the underlying ──────────────────────
        //
        // Options are the product. Trading the underlying as a proxy measures whether the
        // signal was directionally right, but not what the trade would have made — an idea
        // that's +3% on the stock can be +90% or -100% on the contract. So option ideas
        // fill on a real premium.
        //
        // Every option idea already carries a concrete contract (symbol / type / strike /
        // expiry). A delayed chain is useful research data, but it is not an executable
        // fill. New bot entries therefore require a non-delayed provider mark. Existing
        // delayed paper positions remain visible for audit, but the ledger cannot create
        // more false-precision entries while the realtime provider is unavailable.
        let tradeable: any;

        if (idea.assetType === 'option') {
          const underlyingEntry = Number(idea.entryPrice ?? pick.entryPrice);
          const underlyingStop = Number(idea.stopLoss ?? pick.stopLoss);
          const underlyingT1 = Number(idea.targetPrice ?? pick.targetPrice);
          const direction = idea.direction === 'short' || pick.direction === 'short' ? 'bearish' : 'bullish';
          const directionValid = direction === 'bullish'
            ? underlyingStop < underlyingEntry && underlyingT1 > underlyingEntry
            : underlyingStop > underlyingEntry && underlyingT1 < underlyingEntry;
          const underlyingRisk = Math.abs(underlyingEntry - underlyingStop);
          const underlyingReward = Math.abs(underlyingT1 - underlyingEntry);
          const underlyingRR = underlyingRisk > 0 ? underlyingReward / underlyingRisk : 0;

          if (!directionValid || underlyingRR < cfg.minUnderlyingRR) {
            skipped++;
            logger.warn(`[QUANT-BOT] skipped ${idea.symbol}: invalid/weak underlying plan (R:R ${underlyingRR.toFixed(2)}, minimum ${cfg.minUnderlyingRR.toFixed(2)})`);
            continue;
          }

          const cash = Number(portfolio.cashBalance ?? 0);
          const riskBudget = Math.min(cash * riskFraction, cfg.maxRiskDollars);
          const maxDebit = Math.min(cash * cfg.maxDebitPct, cfg.maxDebitDollars, riskBudget / 0.5);
          const isIndexScalp = idea.source === 'gex_scanner' &&
            String(idea.dataSourceUsed ?? '').startsWith('GEX_index_scalp_');

          // Index 0DTE is already contract-selected by the scalp engine. Keep
          // that exact account-fit vehicle so Cockpit and the paper bot execute
          // the same idea. Sending it through the swing selector again could
          // silently replace a $0.75 call with a different strike/expiry.
          if (isIndexScalp) {
            const expiry = String(idea.expiryDate ?? '').slice(0, 10);
            const today = easternDateKey();
            const selectedPremium = Number(idea.entryPremium ?? 0);
            const packageSignal = (Array.isArray(idea.qualitySignals) ? idea.qualitySignals : [])
              .find((signal: string) => signal.startsWith('package_qty:'));
            const packageQuantity = Math.max(1, Math.min(5, Number(String(packageSignal ?? '').split(':')[1]) || 1));
            if (!idea.optionType || !idea.strikePrice || expiry !== today || !(selectedPremium >= 0.20)) {
              skipped++;
              logger.warn(`[QUANT-BOT] skipped ${idea.symbol}: invalid or stale index-0DTE contract`);
              continue;
            }

            const { getOptionMark } = await import('./tradier-api');
            const q = await getOptionMark({
              underlying: idea.symbol,
              optionType: idea.optionType,
              strike: Number(idea.strikePrice),
              expiryDate: expiry,
            }).catch(() => null);
            if (!q || !(q.bid > 0 && q.ask > 0)) {
              skipped++;
              logger.warn(`[QUANT-BOT] skipped ${idea.symbol}: no executable quote for published 0DTE contract`);
              continue;
            }
            const spreadPct = q.mid > 0 ? (q.ask - q.bid) / q.mid : Number.POSITIVE_INFINITY;
            const totalDebit = q.ask * 100 * packageQuantity;
            if (spreadPct > cfg.maxOptionSpreadPct || totalDebit > 200) {
              skipped++;
              logger.warn(`[QUANT-BOT] skipped ${idea.symbol}: 0DTE spread/debit gate failed (${(spreadPct * 100).toFixed(1)}%, $${totalDebit.toFixed(0)})`);
              continue;
            }
            tradeable = {
              ...idea,
              catalyst: `[INDEX 0DTE · ${q.source}${q.delayed ? ' · delayed' : ''}] ${idea.catalyst ?? idea.analysis ?? ''}`,
              assetType: 'option',
              __maxContracts: packageQuantity,
              currentPrice: q.ask,
              entryPrice: q.ask,
              targetPrice: Number((q.ask * 2).toFixed(2)),
              stopLoss: Number((q.ask * 0.5).toFixed(2)),
            };
          } else {
          const holding = String(idea.holdingPeriod ?? pick.holdingPeriod ?? '').toLowerCase();
          const setup = holding.includes('day') ? 'scalp' : holding.includes('position') ? 'position' : 'swing';
          const { selectContracts } = await import('./option-selection-engine');
          const selection = await selectContracts({
            symbol: idea.symbol,
            direction,
            setup,
            entry: underlyingEntry,
            stop: underlyingStop,
            t1: underlyingT1,
            holdingDays: Number(pick.horizonDays ?? idea.horizonDays ?? 0) || undefined,
            conviction: convictionDisplayPercent(pick.convictionScore ?? 0),
            asOfSpot: Number(pick.currentPrice ?? 0) || undefined,
            accountSize: cash,
            riskBudgetDollars: riskBudget,
            maxDebitDollars: maxDebit,
            minRoiAtT1Pct: cfg.minContractRoiAtT1Pct,
          });
          const selected = selection.recommendedTier
            ? selection.picks.find((p) => p.tier === selection.recommendedTier)
            : null;
          if (!selected) {
            skipped++;
            logger.warn(`[QUANT-BOT] skipped ${idea.symbol}: ${selection.note ?? 'no contract clears reachability/account gates'}`);
            continue;
          }

          const { getOptionMark } = await import('./tradier-api');
          const q = await getOptionMark({
            underlying: idea.symbol,
            optionType: selected.optionType,
            strike: selected.strike,
            expiryDate: selected.expiry,
          }).catch(() => null);

          if (!q) {
            skipped++;
            logger.warn(`[QUANT-BOT] skipped ${idea.symbol}: no contract mark from any source`);
            continue;
          }
          const quoteMid = Number(q.mid ?? 0);
          const quoteBid = Number(q.bid ?? 0);
          const quoteAsk = Number(q.ask ?? 0);
          const spreadPct = quoteMid > 0 ? (quoteAsk - quoteBid) / quoteMid : Number.POSITIVE_INFINITY;
          if (!(quoteBid > 0 && quoteAsk > 0) || spreadPct > cfg.maxOptionSpreadPct) {
            skipped++;
            logger.warn(`[QUANT-BOT] skipped ${idea.symbol}: non-executable option market (spread ${(spreadPct * 100).toFixed(1)}%)`);
            continue;
          }
          if (q.delayed && easternMinutes() < cfg.delayedFillNotBeforeEtMinutes) {
            skipped++;
            logger.warn(`[QUANT-BOT] skipped ${idea.symbol}: delayed option quote during opening-price discovery`);
            continue;
          }

          // A long option crosses the spread. Filling at midpoint systematically
          // overstates performance, especially in thin contracts; paper execution
          // therefore pays the ask and records the delayed source explicitly.
          const premium = quoteAsk;
          // Premium-based management: a -50% premium stop and a +100% target are the
          // desk-standard bracket for a directional long option, and they're expressed in
          // the same units as the fill so P&L is coherent.
          tradeable = {
            ...idea,
            catalyst: `[${selection.recommendedTier} · ${selected.grade} · mark: ${q.source}${q.delayed ? ' · delayed' : ''}] ${selected.rationale}`,
            assetType: 'option',
            optionType: selected.optionType,
            strikePrice: selected.strike,
            expiryDate: selected.expiry,
            __maxContracts: selected.maxContracts ?? 1,
            currentPrice: premium,
            entryPrice: premium,
            targetPrice: Number((premium * 2).toFixed(2)),
            stopLoss: Number((premium * 0.5).toFixed(2)),
          };
          }
        } else {
          // OPTIONS ONLY. This used to fall back to buying the underlying as shares
          // whenever an idea lacked a concrete contract, which is how UEC (134 shares,
          // $1,494) and INTA (37 shares, $1,486) ended up as nearly a third of the
          // account. Shares measure a different thing: an idea that is +3% on the
          // stock can be +90% or -100% on the contract, so mixing the two makes the
          // bot's record meaningless for the question it exists to answer.
          //
          // A signal with no contract is simply not tradeable by this bot. Skip it.
          skipped++;
          continue;
        }

        const selectedMaxContracts = tradeable.assetType === 'option'
          ? Math.max(1, Number((tradeable as any).__maxContracts ?? 1))
          : undefined;
        const effectiveRiskFraction = Math.min(riskFraction, cfg.maxRiskDollars / Math.max(1, Number(portfolio.cashBalance ?? 0)));
        const res = await executeTradeIdea(portfolio.id, tradeable as any, {
          riskFraction: effectiveRiskFraction,
          maxQuantity: selectedMaxContracts,
        });
        if (res.success) {
          opened.push({
            symbol: pick.symbol,
            reason: `${pick.convictionBand}-band ${pick.convictionScore} · R:R 1:${(pick.riskRewardRatio ?? 0).toFixed(1)}`,
          });

          // Alert the entry. sendBotTradeEntryToDiscord has existed the whole time
          // and nothing ever called it from here, so the bot has been trading
          // silently — you only found out what it did by opening the page.
          // Never let a notification failure roll back a real fill.
          try {
            const { sendBotTradeEntryToDiscord } = await import('./discord-service');
            await sendBotTradeEntryToDiscord({
              symbol: pick.symbol,
              assetType: 'option',
              optionType: (tradeable as any).optionType ?? null,
              strikePrice: (tradeable as any).strikePrice ?? null,
              expiryDate: (tradeable as any).expiryDate ?? null,
              entryPrice: Number((tradeable as any).entryPrice ?? 0),
              quantity: Number(res.position?.quantity ?? 1),
              targetPrice: pick.targetPrice ?? null,
              stopLoss: pick.stopLoss ?? null,
              // Bot entry grades use the same 0–100 confidence index the
              // terminal displays, never the raw confluence-point total.
              confidence: convictionDisplayPercent(pick.convictionScore ?? 0),
              riskRewardRatio: pick.riskRewardRatio ?? null,
              analysis: pick.thesis ?? null,
              signals: (pick.layers ?? []).filter((l: any) => l.points > 0).slice(0, 4).map((l: any) => l.why).filter(Boolean),
              portfolio: 'Quant Bot',
              source: 'quant-bot',
            });
          } catch (err: any) {
            logger.warn(`[QUANT-BOT] entry alert failed for ${pick.symbol}: ${err?.message ?? err}`);
          }
        } else {
          skipped++;
          logger.debug(`[QUANT-BOT] skipped ${pick.symbol}: ${res.error ?? 'no fill'}`);
        }
      }
    }
  } catch (err) {
    logger.warn('[QUANT-BOT] entry pass failed:', err);
  }

  // 3 — snapshot the curve so performance is measurable over time
  try { await recordEquitySnapshot(portfolio.id); } catch { /* non-fatal */ }

  const openCount = (await getOpenPositions(portfolio.id)).length;
  logger.info(`[QUANT-BOT] cycle: +${opened.length} opened, -${closed.length} closed, ${openCount} open`);
  try {
    const { pulse } = await import('./system-pulse');
    if (opened.length || closed.length) {
      pulse('bot', `bot: ${opened.length ? `opened ${opened.map((o) => o.symbol).join(', ')}` : ''}${opened.length && closed.length ? ' · ' : ''}${closed.length ? `closed ${closed.map((c) => c.symbol).join(', ')}` : ''} — ${openCount} open`);
    } else {
      pulse('bot', `bot cycle: book re-priced, ${openCount} position(s) held, nothing new qualified`);
    }
  } catch { /* pulse is decoration */ }
  // Persist the levels we left on. A gap exit is only half the trade the bot was
  // missing — the other half is noticing when that gap fills, because at that point
  // the reason for leaving is gone. This does NOT re-enter on its own: the
  // conviction engine still has to publish a fresh signal. It only clears the block,
  // which is the difference between a rule and a hunch.
  if (gapWatch.length) {
    try {
      const { setBotGapWatch } = await import('./gap-aware-exits');
      await setBotGapWatch(gapWatch);
      logger.info(`[QUANT-BOT] watching ${gapWatch.length} gap level(s) for re-entry`);
    } catch (err) {
      logger.warn('[QUANT-BOT] could not persist gap watch:', err);
    }
  }

  return { ranAt, portfolioId: portfolio.id, opened, closed, skipped, openCount, gapWatch };
}

export interface BotStatus {
  portfolioId: string;
  name: string;
  startingCapital: number;
  cashBalance: number;
  totalValue: number;
  totalPnL: number;
  totalPnLPercent: number;
  /** All closed exits, before the UI limits the rendered history to 25 rows. */
  closedCount: number;
  openPositions: any[];
  closedPositions: any[];
  config: BotConfig;
}

export async function getBotStatus(cfg: BotConfig = DEFAULT_BOT_CONFIG): Promise<BotStatus | null> {
  // A GET must never create a portfolio or disguise a storage failure as an empty $10k book.
  // The explicit "Re-price & manage" cycle remains the only place that may create one.
  const portfolio: any = await findBotPortfolio();
  if (!portfolio?.id) return null;

  try { await updatePositionPrices(portfolio.id); } catch { /* stale marks are still usable */ }

  // These are the execution ledger. If any cannot be read, the caller must show an
  // unavailable state rather than inventing an empty portfolio from fallback values.
  const [open, closedAll, value] = await Promise.all([
    getOpenPositions(portfolio.id),
    getClosedPositions(portfolio.id),
    calculatePortfolioValue(portfolio.id),
  ]);

  const startingCapital = portfolio.startingCapital ?? cfg.startingCapital;
  const totalValue = value?.totalValue ?? portfolio.totalValue ?? startingCapital;

  return {
    portfolioId: portfolio.id,
    name: portfolio.name,
    startingCapital,
    cashBalance: value?.cashBalance ?? portfolio.cashBalance ?? 0,
    totalValue,
    // PortfolioValue reports UNREALISED only, so total P&L is measured against the
    // starting capital — that captures realised and unrealised together.
    totalPnL: totalValue - startingCapital,
    totalPnLPercent: startingCapital > 0 ? ((totalValue - startingCapital) / startingCapital) * 100 : 0,
    closedCount: closedAll.length,
    openPositions: open,
    // Newest exits first — the tab renders this as the win/loss history, and
    // an unsorted slice would show an arbitrary 25.
    closedPositions: [...closedAll]
      .sort((a: any, b: any) => Date.parse(b.exitTime ?? b.updatedAt ?? 0) - Date.parse(a.exitTime ?? a.updatedAt ?? 0))
      .slice(0, 40),
    config: cfg,
  };
}
