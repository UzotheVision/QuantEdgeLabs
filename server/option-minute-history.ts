import { logger } from './logger';

export interface OptionMinuteBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OptionMinuteSeries {
  occSymbol: string;
  source: 'yahoo-opr-trades';
  priceBasis: 'reported-trade-ohlcv';
  delayed: boolean;
  bars: OptionMinuteBar[];
}

export interface OptionStrikeReplay {
  strike: number;
  occSymbol: string;
  status: 'measured' | 'no_reported_trades' | 'no_entry_mark' | 'no_post_entry_path';
  source: OptionMinuteSeries['source'];
  priceBasis: OptionMinuteSeries['priceBasis'];
  delayed: boolean;
  entryAt: string | null;
  entryPremium: number | null;
  entryVolume: number | null;
  lastAt: string | null;
  lastPremium: number | null;
  peakAt: string | null;
  peakPremium: number | null;
  troughAt: string | null;
  troughPremium: number | null;
  peakReturnPct: number | null;
  maxAdversePct: number | null;
  peakMarkedPnl: number | null;
  barsObserved: number;
}

/** Yahoo's chart endpoint wants the compact OSI symbol without `O:` or spaces. */
export function normalizeYahooOptionSymbol(occSymbol: string): string {
  return occSymbol.trim().toUpperCase().replace(/^O:/, '').replace(/\s+/g, '');
}

/** Build a compact OCC symbol without guessing an expiry or strike increment. */
export function buildOccOptionSymbol(
  root: string,
  expiry: string,
  optionType: 'call' | 'put',
  strike: number,
): string {
  const normalizedRoot = root.trim().toUpperCase().replace(/^O:/, '');
  if (!/^[A-Z.]{1,6}$/.test(normalizedRoot)) throw new Error('Invalid OCC root');
  const match = expiry.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('Invalid OCC expiry');
  if (!Number.isFinite(strike) || strike <= 0) throw new Error('Invalid OCC strike');
  const strikeCode = String(Math.round(strike * 1000)).padStart(8, '0');
  if (strikeCode.length !== 8) throw new Error('OCC strike is out of range');
  return `${normalizedRoot}${match[1].slice(2)}${match[2]}${match[3]}${optionType === 'call' ? 'C' : 'P'}${strikeCode}`;
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const nyMinuteFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function isRequestedRegularSession(timestampMs: number, requestedDate: string): boolean {
  const parts = Object.fromEntries(
    nyMinuteFormatter.formatToParts(new Date(timestampMs)).map((part) => [part.type, part.value]),
  );
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localMinute = Number(parts.hour) * 60 + Number(parts.minute);
  return localDate === requestedDate && localMinute >= 9 * 60 + 30 && localMinute < 16 * 60;
}

/**
 * Historical one-minute OPTION trades. These are reported OPR trade bars, not
 * reconstructed Greeks and not an underlying-price proxy. They are suitable
 * for an auditable mark-to-market replay. They are not NBBO, so a replay must
 * never call the close an executable bid/ask fill.
 */
export async function getHistoricalOptionMinutes(
  occSymbol: string,
  date: string,
): Promise<OptionMinuteSeries | null> {
  const symbol = normalizeYahooOptionSymbol(occSymbol);
  if (!/^[A-Z.]{1,6}\d{6}[CP]\d{8}$/.test(symbol)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const start = Math.floor(new Date(`${date}T00:00:00-04:00`).getTime() / 1000);
  const end = start + 36 * 60 * 60;
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('period1', String(start));
  url.searchParams.set('period2', String(end));
  url.searchParams.set('interval', '1m');
  url.searchParams.set('includePrePost', 'false');
  url.searchParams.set('events', 'div,splits');

  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 QuantEdge/1.0' } });
    if (!response.ok) {
      logger.warn(`[OPTION-HISTORY] ${symbol} HTTP ${response.status}`);
      return null;
    }
    const payload: any = await response.json();
    const result = payload?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const timestamps: number[] = result?.timestamp ?? [];
    if (!quote || timestamps.length === 0) return null;

    const byMinute = new Map<string, OptionMinuteBar>();
    for (let i = 0; i < timestamps.length; i++) {
      if (!isRequestedRegularSession(timestamps[i] * 1000, date)) continue;
      const open = finite(quote.open?.[i]);
      const high = finite(quote.high?.[i]);
      const low = finite(quote.low?.[i]);
      const close = finite(quote.close?.[i]);
      if (open == null || high == null || low == null || close == null) continue;
      const timestamp = new Date(timestamps[i] * 1000).toISOString();
      const bar = { timestamp, open, high, low, close, volume: Math.max(0, finite(quote.volume?.[i]) ?? 0) };
      const key = timestamp.slice(0, 16);
      const prior = byMinute.get(key);
      if (!prior || bar.volume >= prior.volume) byMinute.set(key, bar);
    }

    return {
      occSymbol: symbol,
      source: 'yahoo-opr-trades',
      priceBasis: 'reported-trade-ohlcv',
      delayed: true,
      bars: [...byMinute.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    };
  } catch (error) {
    logger.warn(`[OPTION-HISTORY] ${symbol} failed: ${error}`);
    return null;
  }
}

export function optionMarkAtOrAfter(bars: OptionMinuteBar[], at: string): OptionMinuteBar | null {
  const target = Date.parse(at);
  if (!Number.isFinite(target)) return null;
  return bars.find((bar) => Date.parse(bar.timestamp) >= target) ?? null;
}

export function replayOptionMarks(args: { series: OptionMinuteSeries; entryAt: string; exitAt: string }) {
  const entry = optionMarkAtOrAfter(args.series.bars, args.entryAt);
  const exit = optionMarkAtOrAfter(args.series.bars, args.exitAt);
  if (!entry || !exit || entry.close <= 0) return null;
  // Entry is the completed signal bar's close. Its earlier open/high/low all
  // happened before that decision and must not contaminate post-entry MFE/MAE.
  const postEntry = args.series.bars.filter((bar) => bar.timestamp > entry.timestamp && bar.timestamp <= exit.timestamp);
  const path = postEntry.length > 0 ? postEntry : [exit];
  const peak = path.reduce((best, bar) => bar.high > best.high ? bar : best, path[0]);
  const trough = path.reduce((worst, bar) => bar.low < worst.low ? bar : worst, path[0]);
  return {
    entry,
    exit,
    peak,
    trough,
    returnPct: ((exit.close / entry.close) - 1) * 100,
    peakReturnPct: ((peak.high / entry.close) - 1) * 100,
    maxAdversePct: ((trough.low / entry.close) - 1) * 100,
  };
}

/**
 * Audit every requested strike from the same decision timestamp through the
 * requested end (or the final reported regular-session trade). This is a
 * counterfactual contract comparison, not a claim that every contract could
 * have been filled at the printed high.
 */
export async function replayOptionStrikeLadder(args: {
  root: string;
  date: string;
  optionType: 'call' | 'put';
  strikes: number[];
  entryAt: string;
  exitAt?: string;
}): Promise<OptionStrikeReplay[]> {
  const entryMs = Date.parse(args.entryAt);
  const exitMs = args.exitAt ? Date.parse(args.exitAt) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(entryMs)) throw new Error('Invalid ladder entry timestamp');
  if (args.exitAt && !Number.isFinite(exitMs)) throw new Error('Invalid ladder exit timestamp');
  const uniqueStrikes = [...new Set(args.strikes.filter((strike) => Number.isFinite(strike) && strike > 0))]
    .sort((a, b) => a - b);
  if (uniqueStrikes.length === 0 || uniqueStrikes.length > 30) throw new Error('Strike ladder must contain 1-30 strikes');

  return Promise.all(uniqueStrikes.map(async (strike): Promise<OptionStrikeReplay> => {
    const occSymbol = buildOccOptionSymbol(args.root, args.date, args.optionType, strike);
    const empty = (status: OptionStrikeReplay['status']): OptionStrikeReplay => ({
      strike,
      occSymbol,
      status,
      source: 'yahoo-opr-trades',
      priceBasis: 'reported-trade-ohlcv',
      delayed: true,
      entryAt: null,
      entryPremium: null,
      entryVolume: null,
      lastAt: null,
      lastPremium: null,
      peakAt: null,
      peakPremium: null,
      troughAt: null,
      troughPremium: null,
      peakReturnPct: null,
      maxAdversePct: null,
      peakMarkedPnl: null,
      barsObserved: 0,
    });

    const series = await getHistoricalOptionMinutes(occSymbol, args.date);
    if (!series || series.bars.length === 0) return empty('no_reported_trades');
    const entry = optionMarkAtOrAfter(series.bars, args.entryAt);
    if (!entry || Date.parse(entry.timestamp) > exitMs || entry.close <= 0) return empty('no_entry_mark');
    const path = series.bars.filter((bar) => {
      const at = Date.parse(bar.timestamp);
      return at > Date.parse(entry.timestamp) && at <= exitMs;
    });
    if (path.length === 0) return { ...empty('no_post_entry_path'), entryAt: entry.timestamp, entryPremium: entry.close, entryVolume: entry.volume };

    const peak = path.reduce((best, bar) => bar.high > best.high ? bar : best, path[0]);
    const trough = path.reduce((worst, bar) => bar.low < worst.low ? bar : worst, path[0]);
    const last = path[path.length - 1];
    return {
      strike,
      occSymbol,
      status: 'measured',
      source: series.source,
      priceBasis: series.priceBasis,
      delayed: series.delayed,
      entryAt: entry.timestamp,
      entryPremium: Number(entry.close.toFixed(2)),
      entryVolume: entry.volume,
      lastAt: last.timestamp,
      lastPremium: Number(last.close.toFixed(2)),
      peakAt: peak.timestamp,
      peakPremium: Number(peak.high.toFixed(2)),
      troughAt: trough.timestamp,
      troughPremium: Number(trough.low.toFixed(2)),
      peakReturnPct: Number((((peak.high / entry.close) - 1) * 100).toFixed(2)),
      maxAdversePct: Number((((trough.low / entry.close) - 1) * 100).toFixed(2)),
      peakMarkedPnl: Number(((peak.high - entry.close) * 100).toFixed(2)),
      barsObserved: path.length,
    };
  }));
}
