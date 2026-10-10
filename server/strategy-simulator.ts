/**
 * STRATEGY SIMULATOR
 * ==================
 * Backtests the convergence engine against historical price data.
 * Answers: "Would my system have caught NOK / QCOM / ARM / AEHR?"
 *
 * For each ticker:
 *   1. Pull 1-year price history (weekly bars)
 *   2. At each weekly bar, compute the convergence score retroactively
 *   3. When score crosses threshold (>= 70), simulate entry
 *   4. Track outcome 30 days later (T1 hit / stopped / time expired)
 *   5. Return win rate, avg gain, avg loss, expectancy
 *
 * Lightweight version — uses simplified signals to avoid hammering APIs.
 */

import { logger } from './logger';

export interface SimulatedTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  scoreAtEntry: number;
  exitDate: string;
  exitPrice: number;
  exitReason: 'T1_HIT' | 'STOP_HIT' | 'TIME_EXPIRED';
  pnlPct: number;
  daysHeld: number;
}

export interface SimulationResult {
  symbol: string;
  scannedBars: number;
  signalsTriggered: number;
  trades: SimulatedTrade[];
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  expectancy: number;          // avg P&L per trade
  maxDrawdown: number;
  totalReturnPct: number;
}

export interface BacktestConfig {
  symbols: string[];
  scoreThreshold: number;       // default 70
  targetPct: number;            // default 10 (T1 = entry + 10%)
  stopPct: number;              // default -8
  holdMaxDays: number;          // default 30
}

// ═══════════════════════════════════════════════════════════════
// SIMPLIFIED CONVERGENCE SCORE (per weekly bar)
// ═══════════════════════════════════════════════════════════════

function computeRetroScore(
  closes: number[],
  highs: number[],
  lows: number[],
  i: number              // index of current bar
): number {
  if (i < 50) return 0;   // need lookback

  const window = closes.slice(Math.max(0, i - 52), i + 1);
  const last = closes[i];
  const lo52 = Math.min(...window);
  const hi52 = Math.max(...window);
  const range = ((hi52 - lo52) / lo52) * 100;
  const position = ((last - lo52) / (hi52 - lo52)) * 100;

  // BB squeeze on last 20 bars
  const bb = (slice: number[]) => {
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const v = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
    return (4 * Math.sqrt(v)) / mean;
  };
  const bbNow = bb(closes.slice(Math.max(0, i - 20), i + 1));
  let sumBB = 0, cnt = 0;
  for (let j = 20; j <= i; j++) {
    sumBB += bb(closes.slice(j - 20, j + 1));
    cnt++;
  }
  const sqRatio = cnt > 0 ? bbNow / (sumBB / cnt) : 1;

  // ADX-lite over 14
  let dmP = 0, dmN = 0, tr = 0;
  for (let j = Math.max(1, i - 13); j <= i; j++) {
    const up = highs[j] - highs[j - 1];
    const dn = lows[j - 1] - lows[j];
    dmP += (up > dn && up > 0) ? up : 0;
    dmN += (dn > up && dn > 0) ? dn : 0;
    tr += Math.max(highs[j] - lows[j], Math.abs(highs[j] - closes[j - 1]), Math.abs(lows[j] - closes[j - 1]));
  }
  const diP = tr > 0 ? (dmP / tr) * 100 : 0;
  const diN = tr > 0 ? (dmN / tr) * 100 : 0;
  const adx = (diP + diN) > 0 ? Math.abs(diP - diN) / (diP + diN) * 100 : 0;
  const bullish = diP > diN;

  const m4 = i >= 4 ? ((last - closes[i - 4]) / closes[i - 4]) * 100 : 0;

  // Composite (mirrors multi-signal-discovery weights)
  let score = 0;
  if (sqRatio < 0.7) score += 15;
  else if (sqRatio < 1) score += (1 - sqRatio) * 15;
  score += Math.max(0, 100 - Math.min(range, 100)) * 0.075;
  score += position * 0.075;
  if (bullish) score += adx * 0.15;
  if (m4 > 0 && m4 < 35) score += m4 * 0.4;

  return Math.round(Math.min(100, score));
}

// ═══════════════════════════════════════════════════════════════
// SIMULATION
// ═══════════════════════════════════════════════════════════════

async function fetchHistory(symbol: string): Promise<{
  closes: number[]; highs: number[]; lows: number[]; timestamps: number[];
} | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1wk`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j: any = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const closes: number[] = (res.indicators?.quote?.[0]?.close || []).filter((c: any) => c != null);
    const highs: number[] = (res.indicators?.quote?.[0]?.high || []).filter((c: any) => c != null);
    const lows: number[] = (res.indicators?.quote?.[0]?.low || []).filter((c: any) => c != null);
    const timestamps: number[] = res.timestamp || [];
    if (closes.length < 50) return null;
    return { closes, highs, lows, timestamps };
  } catch (e) {
    return null;
  }
}

export async function simulateSymbol(symbol: string, cfg: BacktestConfig): Promise<SimulationResult | null> {
  const data = await fetchHistory(symbol);
  if (!data) return null;

  const { closes, highs, lows, timestamps } = data;
  const trades: SimulatedTrade[] = [];
  let signalsTriggered = 0;
  let inTrade = false;

  for (let i = 50; i < closes.length; i++) {
    if (inTrade) continue;
    const score = computeRetroScore(closes, highs, lows, i);
    if (score < cfg.scoreThreshold) continue;

    signalsTriggered++;
    const entryPrice = closes[i];
    const target = entryPrice * (1 + cfg.targetPct / 100);
    const stop = entryPrice * (1 + cfg.stopPct / 100);
    const entryDate = new Date((timestamps[i] || 0) * 1000).toISOString().slice(0, 10);

    // Look forward up to holdMaxDays
    const maxBars = Math.min(closes.length - 1, i + Math.ceil(cfg.holdMaxDays / 7));
    let exitPrice = closes[maxBars];
    let exitReason: SimulatedTrade['exitReason'] = 'TIME_EXPIRED';
    let exitIdx = maxBars;

    for (let k = i + 1; k <= maxBars; k++) {
      if (highs[k] >= target) { exitPrice = target; exitReason = 'T1_HIT'; exitIdx = k; break; }
      if (lows[k] <= stop) { exitPrice = stop; exitReason = 'STOP_HIT'; exitIdx = k; break; }
    }

    const exitDate = new Date((timestamps[exitIdx] || 0) * 1000).toISOString().slice(0, 10);
    const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    const daysHeld = Math.max(7, (exitIdx - i) * 7);

    trades.push({
      symbol,
      entryDate,
      entryPrice: +entryPrice.toFixed(2),
      scoreAtEntry: score,
      exitDate,
      exitPrice: +exitPrice.toFixed(2),
      exitReason,
      pnlPct: +pnlPct.toFixed(2),
      daysHeld
    });

    // Cooldown: skip 2 weeks before next signal
    i = exitIdx + 2;
  }

  if (!trades.length) {
    return {
      symbol,
      scannedBars: closes.length - 50,
      signalsTriggered,
      trades: [],
      winRate: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      expectancy: 0,
      maxDrawdown: 0,
      totalReturnPct: 0
    };
  }

  const wins = trades.filter(t => t.pnlPct > 0);
  const losses = trades.filter(t => t.pnlPct < 0);
  const winRate = (wins.length / trades.length) * 100;
  const avgWinPct = wins.length ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLossPct = losses.length ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const expectancy = trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length;
  const totalReturnPct = trades.reduce((s, t) => s + t.pnlPct, 0);

  // Max drawdown from running equity
  let peak = 0, drawdown = 0, equity = 0;
  for (const t of trades) {
    equity += t.pnlPct;
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, equity - peak);
  }

  return {
    symbol,
    scannedBars: closes.length - 50,
    signalsTriggered,
    trades,
    winRate: +winRate.toFixed(1),
    avgWinPct: +avgWinPct.toFixed(1),
    avgLossPct: +avgLossPct.toFixed(1),
    expectancy: +expectancy.toFixed(2),
    maxDrawdown: +drawdown.toFixed(1),
    totalReturnPct: +totalReturnPct.toFixed(1)
  };
}

export async function runBacktest(cfg: BacktestConfig): Promise<{
  config: BacktestConfig;
  results: SimulationResult[];
  aggregate: {
    totalSymbols: number;
    totalTrades: number;
    overallWinRate: number;
    avgExpectancy: number;
    bestSymbol: string | null;
    worstSymbol: string | null;
  };
}> {
  const results: SimulationResult[] = [];
  for (const symbol of cfg.symbols) {
    const r = await simulateSymbol(symbol, cfg);
    if (r) results.push(r);
  }

  const totalTrades = results.reduce((s, r) => s + r.trades.length, 0);
  const allTrades = results.flatMap(r => r.trades);
  const wins = allTrades.filter(t => t.pnlPct > 0).length;
  const overallWinRate = totalTrades ? (wins / totalTrades) * 100 : 0;
  const avgExpectancy = totalTrades
    ? allTrades.reduce((s, t) => s + t.pnlPct, 0) / totalTrades
    : 0;

  results.sort((a, b) => b.expectancy - a.expectancy);
  const bestSymbol = results[0]?.symbol || null;
  const worstSymbol = results[results.length - 1]?.symbol || null;

  return {
    config: cfg,
    results,
    aggregate: {
      totalSymbols: results.length,
      totalTrades,
      overallWinRate: +overallWinRate.toFixed(1),
      avgExpectancy: +avgExpectancy.toFixed(2),
      bestSymbol,
      worstSymbol
    }
  };
}
