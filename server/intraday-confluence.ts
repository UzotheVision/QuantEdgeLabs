/**
 * INTRADAY CONFLUENCE — the 5-minute execution read. Operator 2026-09-23:
 * "work on the 5 min time frame and have all the indicators possible to make
 * the rightest confluence on entries and exits."
 *
 * Six independent 5m checks, each measured, each named on the card:
 *   1. price vs session VWAP        (institutions' average — the line)
 *   2. EMA9 vs EMA21 stack          (short trend)
 *   3. RSI(14) in the entry band    (40-70: moving but not chased)
 *   4. MACD histogram direction     (momentum building vs rolling)
 *   5. volume vs session average    (participation)
 *   6. structure: higher lows, last 3 bars
 *
 * A confluence COUNT is not a prediction — the verdict says how many
 * independent reads currently agree, nothing more. Exits get the mirror
 * warnings (VWAP loss, EMA cross-down, RSI>75 fading, MACD rolling).
 */
import { fetchCandles } from './historical-candles';

export interface ConfluenceCheck { name: string; pass: boolean; value: string }
export interface ConfluenceRead {
  symbol: string;
  asOf: string;
  barCount: number;
  price: number;
  vwap: number;
  score: number;           // 0-6 checks passing for a long entry
  verdict: 'enter-zone' | 'acceptable' | 'wait';
  checks: ConfluenceCheck[];
  exitWarnings: string[];  // for managing an open long
  note: string;
}

const ema = (vals: number[], p: number): number[] => {
  const k = 2 / (p + 1);
  const out: number[] = [];
  vals.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
};

function rsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let g = 0, l = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  if (g + l === 0) return 50;
  const rs = (g / 14) / Math.max(1e-9, l / 14);
  return 100 - 100 / (1 + rs);
}

export async function getIntradayConfluence(symbol: string): Promise<ConfluenceRead | null> {
  const bars = await fetchCandles(symbol, '1d', '5m');
  if (bars.length < 20) return null;
  const closes = bars.map((b) => b.close);
  const price = closes[closes.length - 1];

  // Session VWAP from typical price × volume
  let pv = 0, vv = 0;
  for (const b of bars) { const tp = (b.high + b.low + b.close) / 3; pv += tp * b.volume; vv += b.volume; }
  const vwap = vv > 0 ? pv / vv : price;

  const e9 = ema(closes, 9), e21 = ema(closes, 21);
  const rsi = rsi14(closes);
  const macdLine = ema(closes, 12).map((v, i) => v - ema(closes, 26)[i]);
  const signal = ema(macdLine, 9);
  const hist = macdLine.map((v, i) => v - signal[i]);
  const histRising = hist.length >= 3 && hist[hist.length - 1] > hist[hist.length - 2];

  const avgVol = bars.reduce((s, b) => s + b.volume, 0) / bars.length;
  const lastVol = bars[bars.length - 1].volume;
  const l3 = bars.slice(-3);
  const higherLows = l3.length === 3 && l3[1].low >= l3[0].low && l3[2].low >= l3[1].low;

  const checks: ConfluenceCheck[] = [
    { name: 'above VWAP', pass: price > vwap, value: `$${price.toFixed(2)} vs VWAP $${vwap.toFixed(2)}` },
    { name: 'EMA9 > EMA21', pass: e9[e9.length - 1] > e21[e21.length - 1], value: `${e9[e9.length - 1].toFixed(2)} / ${e21[e21.length - 1].toFixed(2)}` },
    { name: 'RSI 40-70', pass: rsi != null && rsi >= 40 && rsi <= 70, value: rsi != null ? rsi.toFixed(0) : 'n/a' },
    { name: 'MACD building', pass: histRising, value: `hist ${hist[hist.length - 1].toFixed(3)}` },
    { name: 'volume participating', pass: lastVol >= avgVol * 0.8, value: `${(lastVol / Math.max(1, avgVol)).toFixed(1)}x session avg` },
    { name: 'higher lows (3 bars)', pass: higherLows, value: l3.map((b) => b.low.toFixed(2)).join(' → ') },
  ];
  const score = checks.filter((c) => c.pass).length;

  const exitWarnings: string[] = [];
  if (price < vwap) exitWarnings.push('below VWAP — institutions are underwater on the session');
  if (e9[e9.length - 1] < e21[e21.length - 1]) exitWarnings.push('EMA9 crossed under EMA21 on 5m');
  if (rsi != null && rsi > 75) exitWarnings.push(`RSI ${rsi.toFixed(0)} — extended, fade risk`);
  if (!histRising && hist[hist.length - 1] < 0) exitWarnings.push('MACD momentum rolling over');

  return {
    symbol: symbol.toUpperCase(),
    asOf: new Date(bars[bars.length - 1].time * 1000).toISOString(),
    barCount: bars.length,
    price, vwap: Number(vwap.toFixed(2)),
    score,
    verdict: score >= 5 ? 'enter-zone' : score >= 4 ? 'acceptable' : 'wait',
    checks,
    exitWarnings,
    note: 'Confluence count on 5m bars — how many independent reads agree right now. Not a prediction.',
  };
}
