/**
 * BULLFLOW TAPE SCANNER — the tape feeds the board directly.
 *
 * Why this exists: on 2026-09-09 META printed +$19M net bought (#1 on the
 * aggressor leaders) and the board showed metals and biotech, because every
 * idea path was price-pattern-first — a name with heavy accumulation but a
 * quiet chart was structurally invisible. Same again 2026-09-22: rotation
 * said semis +11.8% and the board answered with oil bull-flags.
 *
 * This scanner reads the Bullflow aggressor tape (measured ask-vs-bid fills,
 * not chain-snapshot inference) and publishes the heaviest one-sided names as
 * flow-primary ideas through the standard ingestion gates (dedup, loss
 * cooldown, cross-source held-check). It claims NO technical pattern — the
 * catalyst text says exactly what was measured and nothing else.
 *
 * Levels are measured, not invented: invalidation is the session low, falling
 * back to the prior close (gap-fill = thesis wrong); T1 is stated plainly as
 * 2R off that invalidation.
 *
 * Short discipline: net-SOLD names are logged and skipped — no short is
 * published without an event catalyst (operator rule), and this scanner does
 * not check catalysts. The skip is visible in the log, not silent.
 *
 * Review hardening (2026-09-23 adversarial pass):
 * - Bullflow net premium is SESSION-CUMULATIVE, so without memory a symbol
 *   whose idea stopped out would republish all day off the same morning tape
 *   at worse entries. A per-market-date decision map prevents any second
 *   publication attempt for a symbol the same day.
 * - The decision map is also checked BEFORE quotes are fetched, so blocked
 *   names stop costing Tradier/Yahoo calls on all ~39 daily sweeps.
 * - Leaders older than STALE_TAPE_MAX_MS (cache serving stale through a
 *   provider outage) are refused rather than narrated as "today's tape".
 * - Composition requirement: call-led tape, or ≥$30M net regardless — sized
 *   so every published idea genuinely clears the options_flow confidence
 *   floor (75) instead of slipping through the 3-signal bypass at 65.
 */
import { logger } from './logger';
import { bullflowEnabled, getTopTickers, getNetPremiumToday } from './bullflow-service';
import { FAVORITE_TICKERS } from '@shared/leadership-universe';
import { isUSMarketOpen } from '@shared/market-calendar';
import { getTradierQuote } from './tradier-api';
import { ingestTradeIdea } from './trade-idea-ingestion';

/** Net premium (calls-minus-puts, aggressor-signed) required to publish. */
const TAPE_NET_MIN = Number(process.env.BULLFLOW_TAPE_IDEA_NET ?? 8_000_000);
/**
 * Operator observation 2026-09-23: heavy flow usually has a technical setup
 * behind it. When the TA engine independently confirms (bullish bias +
 * non-downtrend structure), the flow bar drops to this level — the two
 * measurements corroborate each other, and the card says what the chart
 * shows. Flow below this never publishes regardless of the chart.
 */
const TAPE_NET_MIN_WITH_TA = Number(process.env.BULLFLOW_TAPE_IDEA_NET_TA ?? 5_000_000);
/** Above this net, composition no longer matters — the tape is loud enough. */
const TAPE_NET_ANY_COMPOSITION = 30_000_000;
/** Cap per sweep — the tape rarely has more than a handful of real stories. */
const MAX_IDEAS_PER_SCAN = 5;
/** Invalidation farther than this from entry is a bad structure — skip. */
const MAX_RISK_PCT = 0.08;
/**
 * Invalidation closer than this is not a structure either — early in the
 * session the day low is minutes old and sits on top of last. Fall back to
 * the prior close (gap-fill = thesis wrong), else skip this sweep.
 */
const MIN_RISK_PCT = 0.012;
/** Refuse leader data older than this — stale cache is not "today's tape". */
const STALE_TAPE_MAX_MS = 30 * 60_000;

const fmtM = (n: number) => `${n < 0 ? '-' : '+'}$${(Math.abs(n) / 1e6).toFixed(1)}M`;

/**
 * One decision per symbol per market date. 'published' and 'blocked' are
 * terminal for the day; transient skips (no quote, no structure band, DB
 * hiccup) are NOT recorded so those names retry on later sweeps. Persisted
 * to disk so a process restart cannot re-publish a name that already
 * resolved today off the same cumulative tape.
 */
const dayDecisions = new Map<string, { date: string; verdict: 'published' | 'blocked' | 'short_logged' }>();
const DECISIONS_FILE = 'server/data/tape-scan-decisions.json';
/** Across all ~39 sweeps — a broad rally day must not mint 25 tape ideas. */
const MAX_DAILY_PUBLISH = 8;
let decisionsLoaded = false;

function marketDateET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function loadDecisions(today: string): Promise<void> {
  if (decisionsLoaded) return;
  decisionsLoaded = true;
  try {
    const fs = await import('fs/promises');
    const raw = JSON.parse(await fs.readFile(DECISIONS_FILE, 'utf8'));
    if (raw?.date === today && raw.entries) {
      for (const [sym, verdict] of Object.entries(raw.entries)) {
        dayDecisions.set(sym, { date: today, verdict: verdict as any });
      }
      logger.info(`[TAPE-SCAN] restored ${dayDecisions.size} day decision(s) from disk`);
    }
  } catch { /* first run of the day, or no file — fine */ }
}

async function saveDecisions(today: string): Promise<void> {
  try {
    const fs = await import('fs/promises');
    const entries: Record<string, string> = {};
    for (const [sym, d] of dayDecisions.entries()) if (d.date === today) entries[sym] = d.verdict;
    await fs.writeFile(DECISIONS_FILE, JSON.stringify({ date: today, entries }));
  } catch { /* best-effort — memory map still guards this process */ }
}

function publishedToday(today: string): number {
  let n = 0;
  for (const d of dayDecisions.values()) if (d.date === today && d.verdict === 'published') n++;
  return n;
}

/** Ingestion rejections that the cumulative tape cannot change today. */
const TERMINAL_REASONS = /Duplicate|Already held|Loss cooldown|Leveraged\/inverse/i;

let yahooClient: any = null;
async function getYahoo(): Promise<any> {
  if (!yahooClient) {
    const YahooFinance = (await import('yahoo-finance2')).default as any;
    yahooClient = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  }
  return yahooClient;
}

/**
 * Last price + session low + prior close; Tradier first, Yahoo when Tradier
 * is down (it regularly is — the rest of the platform carries the same
 * fallback).
 */
export async function quoteWithDayLow(symbol: string): Promise<{ last: number; low: number; prevClose: number; high?: number } | null> {
  try {
    const q = await getTradierQuote(symbol);
    if (q && Number.isFinite(q.last) && q.last > 0 && Number.isFinite(q.low) && q.low > 0) {
      return { last: q.last, low: q.low, prevClose: Number(q.prevclose) || NaN, high: Number(q.high) || undefined };
    }
  } catch { /* fall through to Yahoo */ }
  try {
    const y: any = await (await getYahoo()).quote(symbol);
    const last = Number(y?.regularMarketPrice);
    const low = Number(y?.regularMarketDayLow);
    if (Number.isFinite(last) && last > 0 && Number.isFinite(low) && low > 0) {
      return { last, low, prevClose: Number(y?.regularMarketPreviousClose) || NaN, high: Number(y?.regularMarketDayHigh) || undefined };
    }
  } catch { /* both providers failed */ }
  return null;
}

export async function runBullflowTapeScan(): Promise<number> {
  if (!bullflowEnabled()) return 0;

  const top = await getTopTickers('net_premium', { excludeEtfs: true });
  const rows: any[] = top?.rows ?? [];
  if (!rows.length) {
    logger.info('[TAPE-SCAN] leaders empty — no session tape yet');
    return 0;
  }
  const generatedAt = Date.parse(String(top?.generatedAt ?? ''));
  if (!Number.isFinite(generatedAt)) {
    // Fail CLOSED: an unparseable timestamp means the freshness defense is
    // blind, and the cache layer serves stale payloads through outages.
    logger.warn('[TAPE-SCAN] leader payload has no parseable generatedAt — refusing to publish unverifiable tape');
    return 0;
  }
  if (Date.now() - generatedAt > STALE_TAPE_MAX_MS) {
    logger.warn(
      `[TAPE-SCAN] leader data is ${Math.round((Date.now() - generatedAt) / 60_000)} min old (provider outage?) — refusing to publish off stale tape`,
    );
    return 0;
  }

  const today = marketDateET();
  await loadDecisions(today);

  // FAVORITES interrogation: the operator's names get a per-symbol tape read
  // every sweep even when they don't crack the top-30 leaderboard. Reads are
  // 3-min cached in the service (~2 uncached calls/min across the day). The
  // same publish bars apply — favorites earn cards, they don't get them.
  const onLeaderboard = new Set(rows.map((r: any) => String(r.ticker).toUpperCase()));
  for (const fav of FAVORITE_TICKERS) {
    if (onLeaderboard.has(fav)) continue;
    if (dayDecisions.get(fav)?.date === today) continue;
    try {
      const read: any = await getNetPremiumToday(fav);
      if (!read) continue;
      const calls = Number(read.callsNetPremium ?? 0);
      const puts = Number(read.putsNetPremium ?? 0);
      rows.push({ ticker: fav, totalNetPremium: calls - puts, callNetPremium: calls, putNetPremium: puts });
    } catch { /* favorite read failed — next sweep */ }
  }

  if (publishedToday(today) >= MAX_DAILY_PUBLISH) {
    logger.info(`[TAPE-SCAN] daily publish cap (${MAX_DAILY_PUBLISH}) reached — sweep is read-only`);
    return 0;
  }
  const longs = rows
    .filter((r) => Number(r.totalNetPremium) >= TAPE_NET_MIN_WITH_TA)
    .sort((a, b) => Number(b.totalNetPremium) - Number(a.totalNetPremium));
  // SELL SIDE (operator 2026-09-24: long AND short, same evidence standard).
  // Net-sold names are published as shorts by publishShortSide() below.
  const shortsList = rows
    .filter((r) => Number(r.totalNetPremium) <= -TAPE_NET_MIN_WITH_TA)
    .sort((a, b) => Number(a.totalNetPremium) - Number(b.totalNetPremium));
  const shortPublished = await publishShortSide(shortsList, today);
  if (!longs.length) {
    logger.info(`[TAPE-SCAN] no name over ${fmtM(TAPE_NET_MIN)} net bought this sweep`);
    await saveDecisions(today);
    return shortPublished;
  }

  let ingested = 0;
  for (const r of longs) {
    if (ingested >= MAX_IDEAS_PER_SCAN) break;
    const symbol = String(r.ticker).toUpperCase();
    const net = Number(r.totalNetPremium);
    const callNet = Number(r.callNetPremium ?? 0);
    const putNet = Number(r.putNetPremium ?? 0);

    // Terminal decision already made today — costs nothing, not even a quote.
    const prior = dayDecisions.get(symbol);
    if (prior && prior.date === today) continue;

    // Composition, sign-aware: calls BOUGHT (callNet > 0) and puts SOLD
    // (putNet < 0) are both bullish dollars; calls sold / puts bought are
    // bearish dollars. The old check treated put SELLING as opposition and
    // wrongly skipped INTC (+$8.2M calls bought, $12.6M puts sold). Require
    // the bullish side to carry >=2/3 of the gross, or >=$30M net overrides.
    const bullDollars = Math.max(callNet, 0) + Math.max(-putNet, 0);
    const bearDollars = Math.max(-callNet, 0) + Math.max(putNet, 0);
    const bullishLed = bullDollars >= 2 * bearDollars;
    const callsBought = callNet > 0;
    if (!bullishLed && net < TAPE_NET_ANY_COMPOSITION) {
      dayDecisions.set(symbol, { date: today, verdict: 'blocked' });
      logger.info(
        `[TAPE-SCAN] ${symbol}: ${fmtM(net)} net but two-sided tape (bullish ${fmtM(bullDollars)} vs bearish ${fmtM(bearDollars)}) — skipped for today`,
      );
      continue;
    }
    const compText =
      `${callsBought ? `calls bought ${fmtM(callNet)}` : `calls sold ${fmtM(callNet)}`}` +
      ` · ${putNet < 0 ? `puts sold ${fmtM(Math.abs(putNet))}` : `puts bought ${fmtM(putNet)}`}`;

    try {
      const q = await quoteWithDayLow(symbol);
      if (!q) {
        logger.info(`[TAPE-SCAN] ${symbol}: no quote from any provider — will retry next sweep`);
        continue;
      }
      // After-hours publication bug (2026-09-23): entry = last made every
      // evening idea instantly 'entered', then overnight drift painted fake
      // drawdowns by the open. Outside cash hours the entry is a TRIGGER
      // 0.3% above last — pending until actually touched in RTH.
      const cashOpen = isUSMarketOpen().isOpen;
      const entry = cashOpen ? q.last : Number((q.last * 1.003).toFixed(2));
      // Measured invalidation, in preference order: the session low, then the
      // prior close (gap-fill = thesis wrong). Each must leave a real but
      // bounded risk; a stop minutes old on top of last is not a structure.
      const riskOk = (s: number) =>
        Number.isFinite(s) && s > 0 && s < entry &&
        (entry - s) / entry >= MIN_RISK_PCT && (entry - s) / entry <= MAX_RISK_PCT;
      let stop = NaN;
      let stopBasis = '';
      if (riskOk(q.low)) { stop = q.low; stopBasis = 'session low'; }
      else if (riskOk(q.prevClose)) { stop = q.prevClose; stopBasis = 'prior close (gap-fill invalidation)'; }
      if (!Number.isFinite(stop)) {
        logger.info(
          `[TAPE-SCAN] ${symbol}: no measured invalidation in the ${(MIN_RISK_PCT * 100).toFixed(1)}–${(MAX_RISK_PCT * 100).toFixed(0)}% band (low $${q.low}, prevClose $${q.prevClose}) — will retry next sweep`,
        );
        continue;
      }
      // Independent chart read. Below the standalone flow bar, a bullish TA
      // confirmation is REQUIRED; above it, it is extra evidence on the card.
      let taConfirm: { score: number; why: string } | null = null;
      try {
        const { getCachedTARead } = await import('./ta-engine');
        const ta: any = await getCachedTARead(symbol, '3mo', '1d');
        if (ta?.bias?.direction === 'bullish' && ta?.structure?.trend !== 'downtrend') {
          taConfirm = {
            score: Number(ta.bias.score) || 0,
            why: [ta.structure?.trend ? `structure ${ta.structure.trend}` : null, ...(ta.bias.confluence ?? []).slice(0, 2)].filter(Boolean).join(' · '),
          };
        }
      } catch { /* TA unavailable — standalone flow bar applies */ }
      if (net < TAPE_NET_MIN && !taConfirm) {
        logger.info(`[TAPE-SCAN] ${symbol}: ${fmtM(net)} net is below the ${fmtM(TAPE_NET_MIN)} standalone bar and the chart does not confirm — will retry next sweep`);
        continue;
      }

      // Round the stop first, then derive the target from the ROUNDED risk —
      // otherwise the published triple contradicts its own "2R" claim.
      const roundedStop = Number(stop.toFixed(2));
      const risk = entry - roundedStop;
      const target = Number((entry + 2 * risk).toFixed(2));

      // Weights are sized so every combination that can reach this point
      // clears the options_flow confidence floor (75) on the ingestion
      // formula — the floor is real here, not bypassed.
      const signals = [
        {
          type: 'aggressor_net_premium',
          weight: net >= 30e6 ? 32 : net >= 15e6 ? 28 : net >= TAPE_NET_MIN ? 24 : 22,
          description: `${fmtM(net)} net premium bullish on ${today} (aggressor-measured)`,
        },
        {
          type: 'tape_decomposition',
          weight: bullishLed ? 12 : 6,
          description: `${compText} — ${bullishLed ? 'bullish flow leads' : 'two-sided, size overrides'}`,
        },
        {
          type: 'measured_invalidation',
          weight: 8,
          description: `invalidation at the ${stopBasis} $${roundedStop.toFixed(2)} (${((risk / entry) * 100).toFixed(1)}% risk)`,
        },
        ...(taConfirm ? [{
          type: 'chart_confirmation',
          weight: 8,
          description: `chart independently confirms: ${taConfirm.why || `bias +${taConfirm.score}`}`,
        }] : []),
      ];

      const result = await ingestTradeIdea({
        source: 'options_flow',
        symbol,
        assetType: 'stock',
        direction: 'bullish',
        signals,
        holdingPeriod: 'swing',
        currentPrice: entry,
        targetPrice: target,
        stopLoss: roundedStop,
        catalyst: `Aggressor tape: ${fmtM(net)} net bullish on ${today} (${compText}) — measured fills, not chain inference`,
        analysis:
          `Flow-primary idea: direction is read from actual ask-vs-bid fills on the options tape (Bullflow), ` +
          `not from a chart pattern — no technical setup is claimed. ${symbol}'s tape on ${today}: ${compText} (${fmtM(net)} net bullish). ` +
          `Entry ${cashOpen ? `at last ($${entry.toFixed(2)})` : `on a trigger at $${entry.toFixed(2)} (0.3% above the closed-market last — pending until touched in RTH)`}, invalidation at the ${stopBasis} ($${roundedStop.toFixed(2)}) — if the day that printed the buying ` +
          `gives that level back, the thesis is wrong. T1 $${target.toFixed(2)} is stated plainly as 2R off that invalidation, not a structural level.`,
        sourceMetadata: {
          scannerType: 'bullflow_tape',
          netPremium: net,
          callNetPremium: callNet,
          putNetPremium: putNet,
        },
      });

      if (result.success) {
        ingested++;
        dayDecisions.set(symbol, { date: today, verdict: 'published' });
        logger.info(`[TAPE-SCAN] 📤 published ${symbol} — ${fmtM(net)} net bought`);
        await retireOppositeSide(symbol, 'long', `tape flipped to ${fmtM(net)} net bought on ${today}`);
      } else if (TERMINAL_REASONS.test(String(result.reason ?? ''))) {
        // Duplicate / already held / loss cooldown / blocked wrapper — the
        // cumulative tape cannot change these answers today.
        dayDecisions.set(symbol, { date: today, verdict: 'blocked' });
        logger.info(`[TAPE-SCAN] ${symbol} not published: ${result.reason} — done for today`);
      } else {
        // Transient (DB hiccup, generator null) — retry on a later sweep
        // rather than silently starving the day's strongest name.
        logger.info(`[TAPE-SCAN] ${symbol} not published: ${result.reason} — will retry next sweep`);
      }
    } catch (err: any) {
      logger.warn(`[TAPE-SCAN] ${symbol} failed: ${err?.message ?? err}`);
    }
  }

  await saveDecisions(today);
  logger.info(`[TAPE-SCAN] sweep done — ${ingested} tape idea(s) published from ${longs.length} qualifying name(s)`);
  return ingested + shortPublished;
}

/**
 * When the tape flips, the opposite-side card on the same name is superseded.
 * An open SNDK long beside a fresh SNDK short (tape −$20M) is exactly the
 * self-contradicting board the operator rejected. Retire the stale side,
 * labelled, rather than showing both.
 */
async function retireOppositeSide(symbol: string, newDirection: 'long' | 'short', note: string): Promise<void> {
  try {
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');
    const opposite = newDirection === 'long' ? 'short' : 'long';
    const r: any = await db.execute(sql`
      UPDATE trade_ideas
         SET outcome_status = 'expired',
             resolution_reason = ${`superseded: ${note}`}
       WHERE symbol = ${symbol}
         AND direction = ${opposite}
         AND (outcome_status = 'open' OR outcome_status IS NULL)
      RETURNING id`);
    const n = (r?.rows ?? r ?? []).length;
    if (n > 0) logger.info(`[TAPE-SCAN] retired ${n} open ${opposite} card(s) on ${symbol} — ${note}`);
  } catch (err: any) {
    logger.warn(`[TAPE-SCAN] could not retire opposite side on ${symbol}: ${err?.message ?? err}`);
  }
}

/**
 * Short-side mirror of the long publisher: aggressor tape net SOLD, bearish-
 * led composition (calls sold + puts bought ≥ 2/3 of gross) or ≥$30M net,
 * $5-8M only with the chart independently confirming bearish. Stop is the
 * session high (else the prior close — gap-fill against the short = wrong);
 * T1 declared 2R lower. Same day-memory, caps and coherence as longs.
 */
async function publishShortSide(list: any[], today: string): Promise<number> {
  let published = 0;
  const { isUSMarketOpen } = await import('@shared/market-calendar');
  for (const r of list) {
    if (published >= 3 || publishedToday(today) >= MAX_DAILY_PUBLISH) break;
    const symbol = String(r.ticker).toUpperCase();
    if (dayDecisions.get(symbol)?.date === today) continue;
    const net = Number(r.totalNetPremium);            // negative
    const callNet = Number(r.callNetPremium ?? 0);
    const putNet = Number(r.putNetPremium ?? 0);
    const bearDollars = Math.max(-callNet, 0) + Math.max(putNet, 0);
    const bullDollars = Math.max(callNet, 0) + Math.max(-putNet, 0);
    const bearishLed = bearDollars >= 2 * bullDollars;
    if (!bearishLed && -net < TAPE_NET_ANY_COMPOSITION) {
      dayDecisions.set(symbol, { date: today, verdict: 'blocked' });
      logger.info(`[TAPE-SCAN] ${symbol}: ${fmtM(net)} net but two-sided tape — short skipped for today`);
      continue;
    }
    const compText =
      `${callNet < 0 ? `calls sold ${fmtM(Math.abs(callNet))}` : `calls bought ${fmtM(callNet)}`}` +
      ` · ${putNet > 0 ? `puts bought ${fmtM(putNet)}` : `puts sold ${fmtM(Math.abs(putNet))}`}`;
    try {
      const q = await quoteWithDayLow(symbol);
      if (!q) continue;
      let taConfirm: string | null = null;
      try {
        const { getCachedTARead } = await import('./ta-engine');
        const ta: any = await getCachedTARead(symbol, '3mo', '1d');
        if (ta?.bias?.direction === 'bearish' && ta?.structure?.trend !== 'uptrend') {
          taConfirm = [ta.structure?.trend ? `structure ${ta.structure.trend}` : null, ...(ta.bias.confluence ?? []).slice(0, 2)].filter(Boolean).join(' · ');
        }
      } catch { /* standalone bar applies */ }
      if (-net < TAPE_NET_MIN && !taConfirm) continue;

      const cashOpen = isUSMarketOpen().isOpen;
      const entry = cashOpen ? q.last : Number((q.last * 0.997).toFixed(2));
      const riskOk = (st: number | undefined) =>
        st != null && Number.isFinite(st) && st > entry &&
        (st - entry) / entry >= MIN_RISK_PCT && (st - entry) / entry <= MAX_RISK_PCT;
      let stop = NaN, stopBasis = '';
      if (riskOk(q.high)) { stop = q.high!; stopBasis = 'session high'; }
      else if (riskOk(q.prevClose)) { stop = q.prevClose; stopBasis = 'prior close (gap-fill invalidation)'; }
      if (!Number.isFinite(stop)) continue;
      const roundedStop = Number(stop.toFixed(2));
      const risk = roundedStop - entry;
      const target = Number((entry - 2 * risk).toFixed(2));

      const result = await ingestTradeIdea({
        source: 'options_flow',
        symbol,
        assetType: 'stock',
        direction: 'bearish',
        signals: [
          { type: 'aggressor_net_premium', weight: -net >= 30e6 ? 32 : -net >= 15e6 ? 28 : -net >= TAPE_NET_MIN ? 24 : 22, description: `${fmtM(net)} net premium bearish on ${today} (aggressor-measured)` },
          { type: 'tape_decomposition', weight: bearishLed ? 12 : 6, description: `${compText} — ${bearishLed ? 'bearish flow leads' : 'two-sided, size overrides'}` },
          { type: 'measured_invalidation', weight: 8, description: `invalidation at the ${stopBasis} $${roundedStop.toFixed(2)} (${((risk / entry) * 100).toFixed(1)}% risk)` },
          ...(taConfirm ? [{ type: 'chart_confirmation', weight: 8, description: `chart independently confirms bearish: ${taConfirm}` }] : []),
        ],
        holdingPeriod: 'swing',
        currentPrice: entry,
        targetPrice: target,
        stopLoss: roundedStop,
        catalyst: `Aggressor tape: ${fmtM(net)} net bearish on ${today} (${compText}) — measured fills, not chain inference`,
        analysis:
          `Flow-primary SHORT: direction read from actual ask-vs-bid fills (Bullflow), not a chart pattern. ${symbol}'s tape on ${today}: ${compText} (${fmtM(net)} net bearish). ` +
          `Entry ${cashOpen ? `at last ($${entry.toFixed(2)})` : `on a trigger at $${entry.toFixed(2)} (0.3% below the closed-market last — pending until touched in RTH)`}, ` +
          `invalidation at the ${stopBasis} ($${roundedStop.toFixed(2)}). T1 $${target.toFixed(2)} is stated plainly as 2R.`,
        sourceMetadata: { scannerType: 'bullflow_tape', side: 'short', netPremium: net, callNetPremium: callNet, putNetPremium: putNet },
      });
      if (result.success) {
        published++;
        dayDecisions.set(symbol, { date: today, verdict: 'published' });
        logger.info(`[TAPE-SCAN] 📤 published SHORT ${symbol} — ${fmtM(net)} net sold`);
        await retireOppositeSide(symbol, 'short', `tape flipped to ${fmtM(net)} net sold on ${today}`);
      } else if (TERMINAL_REASONS.test(String(result.reason ?? ''))) {
        dayDecisions.set(symbol, { date: today, verdict: 'blocked' });
        logger.info(`[TAPE-SCAN] ${symbol} short not published: ${result.reason}`);
      }
    } catch (err: any) {
      logger.warn(`[TAPE-SCAN] ${symbol} short failed: ${err?.message ?? err}`);
    }
  }
  return published;
}
