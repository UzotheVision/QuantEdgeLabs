/**
 * LIQUID REVERSAL PUBLISHER
 *
 * The index scalp engine can publish 0DTE plays, but it deliberately only
 * watches SPY/QQQ/IWM. This is the missing bridge for liquid single names:
 * an intraday reversal must be confirmed in price first, then matched to a
 * real, liquid CBOE same-day contract. No candle confirmation or no usable
 * contract means no idea is written.
 *
 * It is intentionally not a bot-execution source. A same-day option is an
 * alertable Oracle setup, never something the paper bot may enter unattended.
 */

import { logger } from './logger';
import { storage } from './storage';
import { getCBOEOptionsChain } from './cboe-options-fallback';
import { cachedFetch, rateLimited } from './provider-cache';
import type { InsertTradeIdea, TradeIdea } from '@shared/schema';

export const LIQUID_REVERSAL_UNIVERSE = [
  'TSLA', 'NVDA', 'AMD', 'META', 'AMZN', 'AAPL', 'MSFT', 'GOOGL', 'COIN', 'PLTR',
  // Commodity ETFs + high-liquidity weeklies — GLD and USO intraday moves were
  // structurally invisible (no intraday engine watched any commodity), and the
  // reversal logic needs nothing symbol-specific: liquid same-day contracts
  // exist for all of these. 16 names at a 5-minute cycle stays cheap.
  'GLD', 'SLV', 'USO', 'AVGO', 'NFLX', 'MU',
] as const;

type Direction = 'long' | 'short';

interface Bar {
  at: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ConfirmedReversal {
  symbol: string;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  riskRewardRatio: number;
  confidence: number;
  vwap: number;
  rsi14: number;
  atr: number;
  volumeRatio: number;
  thesis: string;
  qualitySignals: string[];
}

interface LiquidContract {
  optionType: 'call' | 'put';
  strike: number;
  expiryDate: string;
  premium: number;
  bid: number;
  ask: number;
  openInterest: number;
  volume: number;
  delta: number;
  iv: number;
}

export interface ReversalScanResult {
  marketOpen: boolean;
  scanned: number;
  confirmed: number;
  published: TradeIdea[];
  skipped: Array<{ symbol: string; reason: string }>;
}

const MINUTES = {
  open: 9 * 60 + 30,
  firstScan: 10 * 60,
  lastScan: 15 * 60 + 15,
  close: 16 * 60,
};

function easternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  return {
    dayOfWeek: new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay(),
    date: `${year}-${month}-${day}`,
    minuteOfDay: hour * 60 + minute,
  };
}

export function isLiquidReversalSession(now = new Date()): boolean {
  const et = easternParts(now);
  return et.dayOfWeek >= 1 && et.dayOfWeek <= 5 &&
    et.minuteOfDay >= MINUTES.firstScan && et.minuteOfDay < MINUTES.lastScan;
}

function etMinute(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return value('hour') * 60 + value('minute');
}

async function fetchRthBars(symbol: string): Promise<Bar[]> {
  const cacheKey = `liquid-reversal-bars:${symbol}`;
  return cachedFetch(cacheKey, 90_000, async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`;
    const response = await rateLimited('yahoo', 900, () => fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }));
    if (!response.ok) throw new Error(`Yahoo ${response.status}`);
    const data = await response.json();
    const chart = data?.chart?.result?.[0];
    const quote = chart?.indicators?.quote?.[0];
    const timestamps: number[] = chart?.timestamp ?? [];
    if (!quote || !timestamps.length) return [];

    const today = easternParts().date;
    return timestamps.map((ts, i) => ({
      at: new Date(ts * 1000),
      open: Number(quote.open?.[i]), high: Number(quote.high?.[i]),
      low: Number(quote.low?.[i]), close: Number(quote.close?.[i]),
      volume: Number(quote.volume?.[i]) || 0,
    })).filter((bar) => {
      const minute = etMinute(bar.at);
      return easternParts(bar.at).date === today && minute >= MINUTES.open && minute < MINUTES.close &&
        Number.isFinite(bar.open) && Number.isFinite(bar.high) && Number.isFinite(bar.low) &&
        Number.isFinite(bar.close) && bar.close > 0;
    });
  });
}

function vwap(bars: Bar[]) {
  let numerator = 0;
  let denominator = 0;
  for (const bar of bars) {
    const volume = Math.max(0, bar.volume);
    numerator += ((bar.high + bar.low + bar.close) / 3) * volume;
    denominator += volume;
  }
  return denominator > 0 ? numerator / denominator : bars[bars.length - 1]?.close ?? 0;
}

function rsi(closes: number[], period = 14) {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function atr(bars: Bar[], period = 14) {
  const sample = bars.slice(-(period + 1));
  if (sample.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < sample.length; i++) {
    const previous = sample[i - 1].close;
    total += Math.max(sample[i].high - sample[i].low, Math.abs(sample[i].high - previous), Math.abs(sample[i].low - previous));
  }
  return total / (sample.length - 1);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function buildConfirmedReversal(symbol: string, bars: Bar[]): ConfirmedReversal | null {
  if (bars.length < 24) return null;
  const last = bars[bars.length - 1];
  const prior = bars.slice(-4, -1);
  const levelsVwap = vwap(bars);
  const sessionAtr = atr(bars);
  if (!levelsVwap || !sessionAtr) return null;

  const closes = bars.map((bar) => bar.close);
  const rsi14 = rsi(closes);
  const recentVolume = bars.slice(-11, -1).reduce((sum, bar) => sum + bar.volume, 0) / 10;
  const volumeRatio = recentVolume > 0 ? last.volume / recentVolume : 1;
  const low = bars.reduce((best, bar, index) => bar.low < best.bar.low ? { bar, index } : best, { bar: bars[0], index: 0 });
  const high = bars.reduce((best, bar, index) => bar.high > best.bar.high ? { bar, index } : best, { bar: bars[0], index: 0 });
  const priorHigh = Math.max(...prior.map((bar) => bar.high));
  const priorLow = Math.min(...prior.map((bar) => bar.low));
  const twoBarsUp = last.close > bars[bars.length - 2].close && bars[bars.length - 2].close >= bars[bars.length - 3].close;
  const twoBarsDown = last.close < bars[bars.length - 2].close && bars[bars.length - 2].close <= bars[bars.length - 3].close;
  const excursion = Math.max(sessionAtr * 0.9, levelsVwap * 0.004);

  const longConfirmed = low.index <= bars.length - 4 &&
    levelsVwap - low.bar.low >= excursion &&
    last.close > levelsVwap && last.high > priorHigh && twoBarsUp && rsi14 >= 50 && volumeRatio >= 0.8;
  if (longConfirmed) {
    const stop = Math.min(levelsVwap - sessionAtr * 0.2, Math.min(...bars.slice(-4).map((bar) => bar.low)) - sessionAtr * 0.1);
    const risk = last.close - stop;
    if (risk > 0) {
      const target = last.close + risk * 2;
      return {
        symbol, direction: 'long', entry: round(last.close), stop: round(stop), target: round(target),
        riskRewardRatio: 2, confidence: Math.min(86, Math.round(69 + (volumeRatio >= 1.2 ? 5 : 0) + (rsi14 >= 55 ? 4 : 0) + 4)),
        vwap: round(levelsVwap), rsi14: round(rsi14), atr: round(sessionAtr), volumeRatio: round(volumeRatio),
        qualitySignals: ['VWAP reclaimed after a confirmed sell excursion', '5-minute follow-through above local high', `RSI(14) ${rsi14.toFixed(0)}`, `Volume ${volumeRatio.toFixed(1)}× recent`],
        thesis: `${symbol} reversed from an intraday sell excursion, reclaimed VWAP $${levelsVwap.toFixed(2)}, and closed through the prior 15-minute high. This is a confirmed reclaim, not an oversold guess.`,
      };
    }
  }

  const shortConfirmed = high.index <= bars.length - 4 &&
    high.bar.high - levelsVwap >= excursion &&
    last.close < levelsVwap && last.low < priorLow && twoBarsDown && rsi14 <= 50 && volumeRatio >= 0.8;
  if (shortConfirmed) {
    const stop = Math.max(levelsVwap + sessionAtr * 0.2, Math.max(...bars.slice(-4).map((bar) => bar.high)) + sessionAtr * 0.1);
    const risk = stop - last.close;
    if (risk > 0) {
      const target = last.close - risk * 2;
      return {
        symbol, direction: 'short', entry: round(last.close), stop: round(stop), target: round(target),
        riskRewardRatio: 2, confidence: Math.min(86, Math.round(69 + (volumeRatio >= 1.2 ? 5 : 0) + (rsi14 <= 45 ? 4 : 0) + 4)),
        vwap: round(levelsVwap), rsi14: round(rsi14), atr: round(sessionAtr), volumeRatio: round(volumeRatio),
        qualitySignals: ['VWAP rejected after a confirmed buy excursion', '5-minute follow-through below local low', `RSI(14) ${rsi14.toFixed(0)}`, `Volume ${volumeRatio.toFixed(1)}× recent`],
        thesis: `${symbol} reversed from an intraday buy excursion, rejected VWAP $${levelsVwap.toFixed(2)}, and closed through the prior 15-minute low. This is a confirmed rejection, not an overbought guess.`,
      };
    }
  }
  return null;
}

async function selectSameDayContract(symbol: string, direction: Direction): Promise<LiquidContract | null> {
  // CBOE first (keyless), Yahoo second — on 2026-08-26 CBOE 429'd under load
  // during the exact window META printed a +539% reversal call, and a confirmed
  // reversal with no readable chain publishes nothing. One fallback is the
  // difference between "engine fired" and "engine watched".
  let chain = await getCBOEOptionsChain(symbol);
  if (!chain || !chain.options?.length) {
    try {
      const { getYahooOptionsChain } = await import('./yahoo-options-fallback');
      const { getRealtimeQuote } = await import('./realtime-pricing-service');
      const opts = await getYahooOptionsChain(symbol);
      const spotQ = await getRealtimeQuote(symbol, 'stock').catch(() => null);
      const spot = Number((spotQ as any)?.price);
      if (opts?.length && Number.isFinite(spot) && spot > 0) {
        chain = { options: opts as any[], spotPrice: spot } as any;
      }
    } catch { /* both sources down — honestly no contract */ }
  }
  if (!chain) return null;
  const expiryDate = easternParts().date;
  const optionType = direction === 'long' ? 'call' : 'put';
  const candidates = chain.options.filter((option: any) => {
    const bid = Number(option.bid) || 0;
    const ask = Number(option.ask) || 0;
    const spread = bid > 0 && ask > 0 ? (ask - bid) / ((ask + bid) / 2) : Infinity;
    return String(option.expiration_date).slice(0, 10) === expiryDate &&
      String(option.option_type).toLowerCase() === optionType &&
      bid > 0 && ask > 0 && spread <= 0.20 &&
      ((Number(option.open_interest) || 0) >= 100 || (Number(option.volume) || 0) >= 25);
  });
  if (!candidates.length) return null;
  const pick = candidates.sort((a: any, b: any) => {
    const score = (option: any) => {
      const bid = Number(option.bid), ask = Number(option.ask);
      const spread = (ask - bid) / ((ask + bid) / 2);
      const distance = Math.abs(Number(option.strike) - chain.spotPrice) / chain.spotPrice;
      return distance * 100 + spread * 3 - Math.min(2, Math.log10((Number(option.open_interest) || 0) + 1)) * 0.25 - Math.min(2, Math.log10((Number(option.volume) || 0) + 1)) * 0.15;
    };
    return score(a) - score(b);
  })[0];
  const bid = Number(pick.bid);
  const ask = Number(pick.ask);
  return {
    optionType, strike: Number(pick.strike), expiryDate, premium: round((bid + ask) / 2), bid, ask,
    openInterest: Number(pick.open_interest) || 0, volume: Number(pick.volume) || 0,
    delta: Number(pick.greeks?.delta) || 0, iv: Number(pick.greeks?.mid_iv) || 0,
  };
}

async function scanSymbol(symbol: string): Promise<{ idea?: TradeIdea; reason?: string; confirmed: boolean }> {
  const bars = await fetchRthBars(symbol);
  const reversal = buildConfirmedReversal(symbol, bars);
  if (!reversal) return { reason: 'no confirmed VWAP reversal', confirmed: false };

  const contract = await selectSameDayContract(symbol, reversal.direction);
  if (!contract) return { reason: 'no liquid same-day CBOE contract', confirmed: true };

  const idea: InsertTradeIdea = {
    symbol, assetType: 'option', direction: reversal.direction, holdingPeriod: 'day',
    entryPrice: reversal.entry, targetPrice: reversal.target, stopLoss: reversal.stop,
    riskRewardRatio: reversal.riskRewardRatio, catalyst: `${reversal.direction === 'long' ? 'Bullish' : 'Bearish'} VWAP reversal`,
    analysis: `${reversal.thesis} Contract quote is delayed CBOE data: $${contract.strike}${contract.optionType === 'call' ? 'C' : 'P'} ${contract.expiryDate} @ $${contract.premium.toFixed(2)}.`,
    sessionContext: 'intraday_vwap_reversal · confirmation required', timestamp: new Date().toISOString(),
    source: 'market_scanner', dataSourceUsed: 'LIQUID_INTRADAY_REVERSAL', confidenceScore: reversal.confidence,
    qualitySignals: reversal.qualitySignals, optionType: contract.optionType, strikePrice: contract.strike,
    expiryDate: contract.expiryDate, entryPremium: contract.premium, optionOpenInterest: contract.openInterest,
    optionVolume: contract.volume, optionDelta: contract.delta, optionIV: contract.iv * 100,
    expiryTier: '0DTE', optionDte: 0, tradeType: 'scalp', researchHorizon: 'intraday',
    riskProfile: 'aggressive', rsiValue: reversal.rsi14, volumeRatio: reversal.volumeRatio,
    sessionPhase: 'mid-day', entryWindowMinutes: 15, exitWindowMinutes: 90, timingConfidence: reversal.confidence,
    outcomeStatus: 'open',
  } as InsertTradeIdea;
  const saved = await storage.createTradeIdea(idea, { dedupWindowHours: 0.5 });
  return { idea: saved, confirmed: true };
}

export async function runLiquidReversalPublisher(symbols: readonly string[] = LIQUID_REVERSAL_UNIVERSE): Promise<ReversalScanResult> {
  if (!isLiquidReversalSession()) {
    return { marketOpen: false, scanned: 0, confirmed: 0, published: [], skipped: [{ symbol: 'market', reason: 'outside 10:00–15:15 ET weekday reversal window' }] };
  }
  const result: ReversalScanResult = { marketOpen: true, scanned: 0, confirmed: 0, published: [], skipped: [] };
  for (const rawSymbol of symbols) {
    const symbol = rawSymbol.toUpperCase();
    result.scanned++;
    try {
      const scan = await scanSymbol(symbol);
      if (scan.confirmed) result.confirmed++;
      if (scan.idea) result.published.push(scan.idea);
      else result.skipped.push({ symbol, reason: scan.reason ?? 'not published' });
    } catch (error: any) {
      logger.warn(`[LIQUID-REVERSAL] ${symbol} failed: ${error?.message ?? error}`);
      result.skipped.push({ symbol, reason: `data error: ${error?.message ?? 'unknown'}` });
    }
  }
  if (result.published.length) logger.info(`[LIQUID-REVERSAL] published ${result.published.length}/${result.scanned} confirmed reversal(s)`);
  return result;
}

let interval: ReturnType<typeof setInterval> | null = null;
let lastRunAt = 0;

export function startLiquidReversalPublisher(): void {
  if (interval) return;
  logger.info('[LIQUID-REVERSAL] scheduler started (5m, 10:00–15:15 ET)');
  interval = setInterval(async () => {
    if (!isLiquidReversalSession() || Date.now() - lastRunAt < 5 * 60_000) return;
    lastRunAt = Date.now();
    await runLiquidReversalPublisher().catch((error) => logger.warn(`[LIQUID-REVERSAL] cycle failed: ${(error as Error).message}`));
  }, 30_000);
}

export function stopLiquidReversalPublisher(): void {
  if (interval) clearInterval(interval);
  interval = null;
}
