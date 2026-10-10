/**
 * CRYPTO PROXY PROMOTER — the crypto tab stops at display; this is the half
 * that generates. 2026-09-22: BTC +13.7% and ETH +14.2% on the week, MSTR
 * printing 100-point days, and the board had zero crypto-transmission ideas
 * because nothing ever ASKED the proxies for their own evidence.
 *
 * The tab's printed rule stands and is enforced here, not bypassed: "no
 * proxy is graded as a trade solely because BTC or ETH moved." The underlying
 * move only OPENS the interrogation. Each proxy must then pass its own bar:
 * a bullish aggressor tape of its own (Bullflow per-symbol read) and a
 * measured invalidation on its own chart. No flow, no idea — logged, not
 * silent.
 *
 * Long-only: miners/treasury names are structurally long-biased proxies
 * (operator rule), and shorts require an event catalyst this module does not
 * check.
 */
import { logger } from './logger';
import { bullflowEnabled, getNetPremiumToday } from './bullflow-service';
import { quoteWithDayLow } from './bullflow-tape-scanner';
import { ingestTradeIdea } from './trade-idea-ingestion';

/** Weekly move on the underlying that opens the proxy interrogation. */
const UNDERLYING_7D_MIN = 0.06;
/** The proxy's own tape must be at least this bullish to publish. */
const PROXY_NET_MIN = 500_000;
const MAX_DAILY = 3;
const MIN_RISK_PCT = 0.012;
const MAX_RISK_PCT = 0.10;

const ROUTES: Record<string, { proxies: Array<{ symbol: string; route: string }> }> = {
  'BTC-USD': {
    proxies: [
      { symbol: 'IBIT', route: 'spot ETF — direct wrapper' },
      { symbol: 'MSTR', route: 'treasury — BTC balance-sheet leverage' },
      { symbol: 'COIN', route: 'exchange — volume-driven' },
      { symbol: 'CRCL', route: 'stablecoin rails — crypto activity, not direct BTC beta' },
      { symbol: 'MARA', route: 'miner — operating leverage' },
      { symbol: 'RIOT', route: 'miner — operating leverage' },
    ],
  },
  'ETH-USD': {
    proxies: [
      { symbol: 'ETHA', route: 'spot ETF — direct wrapper' },
      { symbol: 'COIN', route: 'exchange — volume-driven' },
      { symbol: 'HOOD', route: 'broker — retail participation' },
    ],
  },
};

const fmtM = (n: number) => `${n < 0 ? '-' : '+'}$${(Math.abs(n) / 1e6).toFixed(2)}M`;

const dayDone = new Map<string, string>(); // symbol -> market date
const marketDateET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const isCashSessionOpen = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = read('weekday');
  const minute = Number(read('hour')) * 60 + Number(read('minute'));
  return !['Sat', 'Sun'].includes(weekday) && minute >= 570 && minute < 960;
};

export interface CryptoProxyCandidate {
  underlying: string;
  underlying7d: number | null;
  underlyingGatePassed: boolean;
  symbol: string;
  route: string;
  proxyNet: number | null;
  tapeGatePassed: boolean;
  entry: number | null;
  invalidation: number | null;
  invalidationBasis: string | null;
  eligible: boolean;
  reason: string;
}

let readinessCache: { at: number; rows: CryptoProxyCandidate[] } | null = null;

async function weeklyMove(pair: string): Promise<number | null> {
  try {
    const YahooFinance = (await import('yahoo-finance2')).default as any;
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const r: any = await yf.chart(pair, {
      period1: new Date(Date.now() - 9 * 86_400_000), interval: '1d',
    });
    const closes: number[] = (r?.quotes ?? []).map((q: any) => q.close).filter((c: any) => Number.isFinite(c));
    if (closes.length < 6) return null;
    return closes[closes.length - 1] / closes[0] - 1;
  } catch {
    return null;
  }
}

/**
 * Read-only decision trace for the Crypto tab and Nexus. It runs the exact
 * evidence gates used by the publisher but never writes an idea. This closes
 * the prior audit gap where a scheduled promoter existed yet users could not
 * see which proxies were being considered or why they failed.
 */
export async function getCryptoProxyCandidates(force = false): Promise<CryptoProxyCandidate[]> {
  if (!force && readinessCache && Date.now() - readinessCache.at < 5 * 60_000) return readinessCache.rows;
  const rows: CryptoProxyCandidate[] = [];

  for (const [pair, cfg] of Object.entries(ROUTES)) {
    const move = await weeklyMove(pair);
    const underlying = pair.replace('-USD', '');
    const underlyingGatePassed = move != null && move >= UNDERLYING_7D_MIN;

    for (const proxy of cfg.proxies) {
      let net: number | null = null;
      let entry: number | null = null;
      let invalidation: number | null = null;
      let invalidationBasis: string | null = null;
      let reason = move == null
        ? `${underlying} history unavailable`
        : !underlyingGatePassed
          ? `${underlying} ${((move ?? 0) * 100).toFixed(1)}% over 7d is below the ${(UNDERLYING_7D_MIN * 100).toFixed(0)}% activation gate`
          : 'awaiting proxy evidence';

      if (underlyingGatePassed && bullflowEnabled() && isCashSessionOpen()) {
        try {
          const read: any = await getNetPremiumToday(proxy.symbol);
          net = Number(read?.callsNetPremium ?? 0) - Number(read?.putsNetPremium ?? 0);
          const quote = await quoteWithDayLow(proxy.symbol);
          if (quote) {
            entry = quote.last;
            const riskOk = (stop: number) => Number.isFinite(stop) && stop > 0 && stop < quote.last &&
              (quote.last - stop) / quote.last >= MIN_RISK_PCT && (quote.last - stop) / quote.last <= MAX_RISK_PCT;
            if (riskOk(quote.low)) { invalidation = Number(quote.low.toFixed(2)); invalidationBasis = 'session low'; }
            else if (riskOk(quote.prevClose)) { invalidation = Number(quote.prevClose.toFixed(2)); invalidationBasis = 'prior close'; }
          }
          reason = net < PROXY_NET_MIN
            ? `own tape ${fmtM(net)} is below ${fmtM(PROXY_NET_MIN)}`
            : invalidation == null
              ? 'own tape passed; no measured invalidation in the risk band'
              : 'underlying, own tape and measured invalidation all passed';
        } catch (error: any) {
          reason = `proxy evidence unavailable: ${error?.message ?? 'provider error'}`;
        }
      } else if (underlyingGatePassed && !isCashSessionOpen()) {
        reason = 'cash session closed; live proxy-tape gate is deferred, not failed';
      } else if (underlyingGatePassed) {
        reason = 'Bullflow is unavailable; proxy cannot be promoted from the coin move alone';
      }

      const tapeGatePassed = net != null && net >= PROXY_NET_MIN;
      rows.push({
        underlying, underlying7d: move, underlyingGatePassed,
        symbol: proxy.symbol, route: proxy.route, proxyNet: net, tapeGatePassed,
        entry, invalidation, invalidationBasis,
        eligible: underlyingGatePassed && tapeGatePassed && invalidation != null,
        reason,
      });
    }
  }

  readinessCache = { at: Date.now(), rows };
  return rows;
}

export async function runCryptoProxyPromotion(): Promise<number> {
  if (!bullflowEnabled()) return 0;
  const today = marketDateET();
  let published = 0;

  for (const [pair, cfg] of Object.entries(ROUTES)) {
    const mv = await weeklyMove(pair);
    if (mv == null) { logger.warn(`[CRYPTO-PROXY] no ${pair} history — skipped`); continue; }
    if (mv < UNDERLYING_7D_MIN) {
      logger.info(`[CRYPTO-PROXY] ${pair} ${(mv * 100).toFixed(1)}% on 7d — below ${(UNDERLYING_7D_MIN * 100).toFixed(0)}% trigger, no interrogation`);
      continue;
    }
    logger.info(`[CRYPTO-PROXY] ${pair} +${(mv * 100).toFixed(1)}% on 7d — interrogating ${cfg.proxies.length} proxies on their own evidence`);

    for (const p of cfg.proxies) {
      if (published >= MAX_DAILY) break;
      if (dayDone.get(p.symbol) === today) continue;

      try {
        // The proxy's own bar #1: its own aggressor tape.
        const read: any = await getNetPremiumToday(p.symbol);
        const calls = Number(read?.callsNetPremium ?? 0);
        const puts = Number(read?.putsNetPremium ?? 0);
        const net = calls - puts;
        if (!(net >= PROXY_NET_MIN)) {
          logger.info(`[CRYPTO-PROXY] ${p.symbol}: own tape ${fmtM(net)} net — below ${fmtM(PROXY_NET_MIN)} bar, not promoted (underlying move alone is not evidence)`);
          continue;
        }

        // Bar #2: a measured invalidation on its own chart.
        const q = await quoteWithDayLow(p.symbol);
        if (!q) { logger.info(`[CRYPTO-PROXY] ${p.symbol}: no quote — skipped`); continue; }
        const entry = q.last;
        const riskOk = (s: number) =>
          Number.isFinite(s) && s > 0 && s < entry &&
          (entry - s) / entry >= MIN_RISK_PCT && (entry - s) / entry <= MAX_RISK_PCT;
        let stop = NaN, stopBasis = '';
        if (riskOk(q.low)) { stop = q.low; stopBasis = 'session low'; }
        else if (riskOk(q.prevClose)) { stop = q.prevClose; stopBasis = 'prior close (gap-fill invalidation)'; }
        if (!Number.isFinite(stop)) {
          logger.info(`[CRYPTO-PROXY] ${p.symbol}: no measured invalidation in band — skipped this run`);
          continue;
        }
        const roundedStop = Number(stop.toFixed(2));
        const risk = entry - roundedStop;
        const target = Number((entry + 2 * risk).toFixed(2));
        const und = pair.replace('-USD', '');

        const result = await ingestTradeIdea({
          source: 'options_flow',
          symbol: p.symbol,
          assetType: 'stock',
          direction: 'bullish',
          signals: [
            { type: 'crypto_regime', weight: mv >= 0.12 ? 26 : 22, description: `${und} +${(mv * 100).toFixed(1)}% on 7d — transmission via ${p.route}` },
            { type: 'own_tape', weight: net >= 3e6 ? 14 : 10, description: `proxy's OWN aggressor tape: ${fmtM(net)} net bullish (calls ${fmtM(calls)} / puts ${fmtM(puts)})` },
            { type: 'measured_invalidation', weight: 8, description: `invalidation at the ${stopBasis} $${roundedStop.toFixed(2)} (${((risk / entry) * 100).toFixed(1)}% risk)` },
          ],
          holdingPeriod: 'swing',
          currentPrice: entry,
          targetPrice: target,
          stopLoss: roundedStop,
          catalyst: `Crypto transmission: ${und} +${(mv * 100).toFixed(1)}% on 7d · ${p.symbol}'s own tape ${fmtM(net)} net bullish — passed its own evidence bar`,
          analysis:
            `Crypto-proxy idea, published under the crypto tab's own rule: the underlying move (${und} +${(mv * 100).toFixed(1)}% on 7d) ` +
            `only opened the interrogation — ${p.symbol} passed its OWN evidence bar: ${fmtM(net)} net bullish aggressor tape ` +
            `(calls ${fmtM(calls)} / puts ${fmtM(puts)}), route = ${p.route}. Entry at last ($${entry.toFixed(2)}), invalidation at ` +
            `the ${stopBasis} ($${roundedStop.toFixed(2)}), T1 $${target.toFixed(2)} declared as 2R. A proxy can diverge from its ` +
            `underlying — the invalidation is on the proxy's chart, not the coin's.`,
          sourceMetadata: { scannerType: 'crypto_proxy', underlying: und, underlying7d: mv, proxyNet: net, route: p.route },
        });

        dayDone.set(p.symbol, today);
        if (result.success) {
          published++;
          logger.info(`[CRYPTO-PROXY] 📤 ${p.symbol} promoted — ${und} +${(mv * 100).toFixed(1)}% 7d, own tape ${fmtM(net)}`);
        } else {
          logger.info(`[CRYPTO-PROXY] ${p.symbol} not published: ${result.reason}`);
        }
      } catch (err: any) {
        logger.warn(`[CRYPTO-PROXY] ${p.symbol} failed: ${err?.message ?? err}`);
      }
    }
  }

  logger.info(`[CRYPTO-PROXY] run done — ${published} proxy idea(s) published`);
  return published;
}
