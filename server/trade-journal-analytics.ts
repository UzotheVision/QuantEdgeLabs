/**
 * TRADE JOURNAL ANALYTICS ENGINE
 * ===============================
 * Analyzes trade history to surface behavioral patterns, performance metrics,
 * and personalized coaching insights. Powers the Trade Journal page.
 *
 * Insight categories:
 *   - Performance: P&L, win rate, profit factor, streaks, drawdown
 *   - Timing: best/worst hours, days, sessions
 *   - Behavior: overtrading, revenge trading, hold duration patterns
 *   - Ticker: which symbols/sectors perform best
 *   - Setup: which setups (GEX, AI, flow) deliver best results
 *   - Risk: position sizing patterns, R:R adherence
 *   - Coaching: personalized tips based on all of the above
 */

import { storage } from './storage';
import { logger } from './logger';

// ─── Types ──────────────────────────────────────────────────

export interface TradeRecord {
  id: string;
  symbol: string;
  direction: string;
  assetType: string;
  optionType?: string | null;
  strikePrice?: number | null;
  expiryDate?: string | null;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  exitPrice?: number | null;
  riskRewardRatio: number;
  realizedPnL?: number | null;
  percentGain?: number | null;
  outcomeStatus: string;
  source: string;
  holdingPeriod: string;
  timestamp: string;
  exitDate?: string | null;
  actualHoldingTimeMinutes?: number | null;
  sector?: string | null;
  catalyst?: string | null;
  emotion?: string | null;
  confidenceScore: number;
  dataSourceUsed?: string | null;
}

export interface PerformanceMetrics {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  winRate: number;             // 0-100%
  totalPnL: number;            // $ total
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;        // gross profit / gross loss
  avgRR: number;               // average realized R:R
  currentStreak: { type: 'win' | 'loss'; count: number };
  bestStreak: number;
  worstStreak: number;
  avgHoldMinutes: number;
  expectancy: number;          // avg $ per trade
}

export interface TimingInsight {
  label: string;
  trades: number;
  winRate: number;
  avgPnL: number;
  grade: 'hot' | 'warm' | 'neutral' | 'cold';
}

export interface BehaviorInsight {
  id: string;
  category: 'timing' | 'behavior' | 'risk' | 'ticker' | 'setup' | 'coaching';
  severity: 'positive' | 'neutral' | 'warning' | 'critical';
  title: string;
  description: string;
  metric?: string;
  suggestion?: string;
  icon: string;               // emoji
}

export interface TickerBreakdown {
  symbol: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
}

export interface SetupBreakdown {
  source: string;
  label: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

export interface PnLPoint {
  date: string;
  cumulativePnL: number;
  tradePnL: number;
  symbol: string;
  outcome: string;
}

export interface DTEBreakdown {
  label: string;        // "0DTE", "1-3 DTE", "4-7 DTE", "8-30 DTE", "30+ DTE"
  trades: number;
  wins: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
}

export interface DayOfWeekPnL {
  day: string;          // "Monday", "Tuesday", etc.
  trades: number;
  wins: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  grade: 'hot' | 'warm' | 'neutral' | 'cold';
}

export interface TradeCountBucket {
  label: string;        // "1-2 trades", "3-5 trades", "6-8 trades", "9+ trades"
  days: number;
  avgPnL: number;
  totalPnL: number;
  winRate: number;
}

export interface WeeklyPnL {
  week: string;         // "2026-W15"
  startDate: string;
  endDate: string;
  trades: number;
  wins: number;
  totalPnL: number;
  cumulativePnL: number;
}

export interface DrawdownMetrics {
  maxDrawdown: number;          // deepest $ drop from peak
  maxDrawdownPercent: number;   // relative to peak equity
  currentDrawdown: number;      // current distance from peak
  peakEquity: number;
  recoveryTrades: number;       // trades to recover from deepest drawdown
  drawdownPeriods: { start: string; end: string; depth: number }[];
}

export interface EmotionAnalysis {
  emotion: string;
  trades: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

export interface JournalAnalytics {
  metrics: PerformanceMetrics;
  pnlCurve: PnLPoint[];
  timingByHour: TimingInsight[];
  timingByDay: TimingInsight[];
  timingBySession: TimingInsight[];
  tickerBreakdown: TickerBreakdown[];
  setupBreakdown: SetupBreakdown[];
  insights: BehaviorInsight[];
  recentTrades: TradeRecord[];
  dteBreakdown: DTEBreakdown[];
  dayOfWeekPnL: DayOfWeekPnL[];
  tradeCountOptimum: TradeCountBucket[];
  weeklyPnL: WeeklyPnL[];
  drawdown: DrawdownMetrics;
  emotionAnalysis: EmotionAnalysis[];
}

// ─── Analytics Computation ──────────────────────────────────

function getHour(ts: string): number {
  try {
    return new Date(ts).getHours();
  } catch { return 12; }
}

function getDayOfWeek(ts: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  try {
    return days[new Date(ts).getDay()];
  } catch { return 'Unknown'; }
}

function getSession(ts: string): string {
  const h = getHour(ts);
  if (h < 10) return 'Pre-Market';
  if (h < 12) return 'Morning (10-12)';
  if (h < 14) return 'Midday (12-2)';
  if (h < 15) return 'Afternoon (2-3)';
  if (h < 16) return 'Power Hour (3-4)';
  return 'After Hours';
}

function isWin(t: TradeRecord): boolean {
  return t.outcomeStatus === 'hit_target' || (t.realizedPnL != null && t.realizedPnL > 0);
}

function isLoss(t: TradeRecord): boolean {
  return t.outcomeStatus === 'hit_stop' || (t.realizedPnL != null && t.realizedPnL < 0);
}

function isClosed(t: TradeRecord): boolean {
  return t.outcomeStatus !== 'open';
}

function computeMetrics(trades: TradeRecord[]): PerformanceMetrics {
  const closed = trades.filter(isClosed);
  const open = trades.filter(t => t.outcomeStatus === 'open');
  const wins = closed.filter(isWin);
  const losses = closed.filter(isLoss);

  const winPnLs = wins.map(t => t.realizedPnL || 0);
  const lossPnLs = losses.map(t => Math.abs(t.realizedPnL || 0));
  const totalWinPnL = winPnLs.reduce((s, v) => s + v, 0);
  const totalLossPnL = lossPnLs.reduce((s, v) => s + v, 0);
  const totalPnL = closed.reduce((s, t) => s + (t.realizedPnL || 0), 0);

  // Streaks
  let currentStreak: { type: 'win' | 'loss'; count: number } = { type: 'win', count: 0 };
  let bestStreak = 0;
  let worstStreak = 0;
  let tempWin = 0;
  let tempLoss = 0;

  const sorted = [...closed].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  for (const t of sorted) {
    if (isWin(t)) {
      tempWin++;
      tempLoss = 0;
      if (tempWin > bestStreak) bestStreak = tempWin;
    } else {
      tempLoss++;
      tempWin = 0;
      if (tempLoss > worstStreak) worstStreak = tempLoss;
    }
  }
  if (sorted.length > 0) {
    const last = sorted[sorted.length - 1];
    if (isWin(last)) {
      currentStreak = { type: 'win', count: tempWin };
    } else {
      currentStreak = { type: 'loss', count: tempLoss };
    }
  }

  const holdTimes = closed
    .map(t => t.actualHoldingTimeMinutes || 0)
    .filter(m => m > 0);

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: open.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    totalPnL,
    avgWin: wins.length > 0 ? totalWinPnL / wins.length : 0,
    avgLoss: losses.length > 0 ? totalLossPnL / losses.length : 0,
    largestWin: winPnLs.length > 0 ? Math.max(...winPnLs) : 0,
    largestLoss: lossPnLs.length > 0 ? Math.max(...lossPnLs) : 0,
    profitFactor: totalLossPnL > 0 ? totalWinPnL / totalLossPnL : totalWinPnL > 0 ? Infinity : 0,
    avgRR: closed.length > 0
      ? closed.reduce((s, t) => s + (t.riskRewardRatio || 0), 0) / closed.length
      : 0,
    currentStreak,
    bestStreak,
    worstStreak,
    avgHoldMinutes: holdTimes.length > 0
      ? holdTimes.reduce((s, v) => s + v, 0) / holdTimes.length
      : 0,
    expectancy: closed.length > 0 ? totalPnL / closed.length : 0,
  };
}

function computePnLCurve(trades: TradeRecord[]): PnLPoint[] {
  const closed = trades
    .filter(isClosed)
    .sort((a, b) => new Date(a.exitDate || a.timestamp).getTime() - new Date(b.exitDate || b.timestamp).getTime());

  let cumulative = 0;
  return closed.map(t => {
    const pnl = t.realizedPnL || 0;
    cumulative += pnl;
    return {
      date: t.exitDate || t.timestamp,
      cumulativePnL: +cumulative.toFixed(2),
      tradePnL: +pnl.toFixed(2),
      symbol: t.symbol,
      outcome: t.outcomeStatus,
    };
  });
}

function computeTimingInsights(
  trades: TradeRecord[],
  keyFn: (t: TradeRecord) => string,
): TimingInsight[] {
  const closed = trades.filter(isClosed);
  const groups = new Map<string, TradeRecord[]>();
  for (const t of closed) {
    const key = keyFn(t);
    const arr = groups.get(key) || [];
    arr.push(t);
    groups.set(key, arr);
  }

  return Array.from(groups.entries()).map(([label, group]) => {
    const wins = group.filter(isWin).length;
    const winRate = group.length > 0 ? (wins / group.length) * 100 : 0;
    const avgPnL = group.reduce((s, t) => s + (t.realizedPnL || 0), 0) / (group.length || 1);
    let grade: TimingInsight['grade'] = 'neutral';
    if (winRate >= 65) grade = 'hot';
    else if (winRate >= 55) grade = 'warm';
    else if (winRate < 40) grade = 'cold';
    return { label, trades: group.length, winRate: +winRate.toFixed(1), avgPnL: +avgPnL.toFixed(2), grade };
  }).sort((a, b) => b.winRate - a.winRate);
}

function computeTickerBreakdown(trades: TradeRecord[]): TickerBreakdown[] {
  const closed = trades.filter(isClosed);
  const groups = new Map<string, TradeRecord[]>();
  for (const t of closed) {
    const arr = groups.get(t.symbol) || [];
    arr.push(t);
    groups.set(t.symbol, arr);
  }

  return Array.from(groups.entries())
    .map(([symbol, group]) => {
      const wins = group.filter(isWin).length;
      const totalPnL = group.reduce((s, t) => s + (t.realizedPnL || 0), 0);
      return {
        symbol,
        trades: group.length,
        wins,
        winRate: +(wins / group.length * 100).toFixed(1),
        totalPnL: +totalPnL.toFixed(2),
        avgPnL: +(totalPnL / group.length).toFixed(2),
      };
    })
    .sort((a, b) => b.totalPnL - a.totalPnL);
}

function computeSetupBreakdown(trades: TradeRecord[]): SetupBreakdown[] {
  const closed = trades.filter(isClosed);
  const groups = new Map<string, TradeRecord[]>();
  for (const t of closed) {
    const src = t.source || 'unknown';
    const arr = groups.get(src) || [];
    arr.push(t);
    groups.set(src, arr);
  }

  const labelMap: Record<string, string> = {
    ai: 'AI Analysis',
    quant: 'Quant Scanner',
    gex_scanner: 'GEX Scanner',
    flow: 'Options Flow',
    news: 'News Catalyst',
    chart_analysis: 'Chart Pattern',
    lotto: 'Lotto Play',
    manual: 'Manual Entry',
    hybrid: 'Hybrid',
  };

  return Array.from(groups.entries())
    .map(([source, group]) => {
      const wins = group.filter(isWin).length;
      const totalPnL = group.reduce((s, t) => s + (t.realizedPnL || 0), 0);
      return {
        source,
        label: labelMap[source] || source,
        trades: group.length,
        wins,
        winRate: +(wins / group.length * 100).toFixed(1),
        avgPnL: +(totalPnL / group.length).toFixed(2),
        totalPnL: +totalPnL.toFixed(2),
      };
    })
    .sort((a, b) => b.winRate - a.winRate);
}

// ─── DTE Breakdown ──────────────────────────────────────────

function computeDTEBreakdown(trades: TradeRecord[]): DTEBreakdown[] {
  const optionTrades = trades.filter(t => isClosed(t) && t.assetType === 'option' && t.expiryDate && t.timestamp);

  const buckets: { label: string; min: number; max: number }[] = [
    { label: '0DTE', min: 0, max: 0 },
    { label: '1-3 DTE', min: 1, max: 3 },
    { label: '4-7 DTE', min: 4, max: 7 },
    { label: '8-30 DTE', min: 8, max: 30 },
    { label: '30+ DTE', min: 31, max: Infinity },
  ];

  return buckets.map(bucket => {
    const group = optionTrades.filter(t => {
      try {
        const entryDate = new Date(t.timestamp);
        const expiryDate = new Date(t.expiryDate!);
        const dte = Math.max(0, Math.floor((expiryDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)));
        return dte >= bucket.min && dte <= bucket.max;
      } catch { return false; }
    });

    const wins = group.filter(isWin).length;
    const totalPnL = group.reduce((s, t) => s + (t.realizedPnL || 0), 0);
    return {
      label: bucket.label,
      trades: group.length,
      wins,
      winRate: group.length > 0 ? +((wins / group.length) * 100).toFixed(1) : 0,
      totalPnL: +totalPnL.toFixed(2),
      avgPnL: group.length > 0 ? +(totalPnL / group.length).toFixed(2) : 0,
    };
  });
}

// ─── Day of Week P&L ────────────────────────────────────────

function computeDayOfWeekPnL(trades: TradeRecord[]): DayOfWeekPnL[] {
  const closed = trades.filter(isClosed);
  const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const groups = new Map<string, TradeRecord[]>();

  for (const t of closed) {
    const day = getDayOfWeek(t.timestamp);
    const arr = groups.get(day) || [];
    arr.push(t);
    groups.set(day, arr);
  }

  return dayOrder
    .filter(day => groups.has(day))
    .map(day => {
      const group = groups.get(day)!;
      const wins = group.filter(isWin).length;
      const winRate = group.length > 0 ? (wins / group.length) * 100 : 0;
      const totalPnL = group.reduce((s, t) => s + (t.realizedPnL || 0), 0);
      const avgPnL = group.length > 0 ? totalPnL / group.length : 0;

      let grade: DayOfWeekPnL['grade'] = 'neutral';
      if (winRate >= 60 && avgPnL > 0) grade = 'hot';
      else if (winRate >= 50 || avgPnL > 0) grade = 'warm';
      else if (winRate < 40 && avgPnL < 0) grade = 'cold';

      return {
        day,
        trades: group.length,
        wins,
        winRate: +winRate.toFixed(1),
        totalPnL: +totalPnL.toFixed(2),
        avgPnL: +avgPnL.toFixed(2),
        grade,
      };
    });
}

// ─── Trade Count Optimum ────────────────────────────────────

function computeTradeCountOptimum(trades: TradeRecord[]): TradeCountBucket[] {
  const closed = trades.filter(isClosed);
  const dayGroups = new Map<string, TradeRecord[]>();

  for (const t of closed) {
    const day = t.timestamp.split('T')[0];
    const arr = dayGroups.get(day) || [];
    arr.push(t);
    dayGroups.set(day, arr);
  }

  const bucketDefs: { label: string; min: number; max: number }[] = [
    { label: '1-2 trades', min: 1, max: 2 },
    { label: '3-5 trades', min: 3, max: 5 },
    { label: '6-8 trades', min: 6, max: 8 },
    { label: '9+ trades', min: 9, max: Infinity },
  ];

  return bucketDefs.map(bucket => {
    const matchingDays = Array.from(dayGroups.entries())
      .filter(([, group]) => group.length >= bucket.min && group.length <= bucket.max);

    const allTradesInBucket = matchingDays.flatMap(([, group]) => group);
    const totalPnL = allTradesInBucket.reduce((s, t) => s + (t.realizedPnL || 0), 0);
    const dayCount = matchingDays.length;
    const wins = allTradesInBucket.filter(isWin).length;

    return {
      label: bucket.label,
      days: dayCount,
      avgPnL: dayCount > 0 ? +(totalPnL / dayCount).toFixed(2) : 0,
      totalPnL: +totalPnL.toFixed(2),
      winRate: allTradesInBucket.length > 0 ? +((wins / allTradesInBucket.length) * 100).toFixed(1) : 0,
    };
  });
}

// ─── Weekly P&L ─────────────────────────────────────────────

function getISOWeek(dateStr: string): { week: string; startDate: string; endDate: string } {
  try {
    const d = new Date(dateStr);
    // ISO week calculation: week starts on Monday
    const dayNum = d.getUTCDay() || 7; // Make Sunday = 7
    const thursday = new Date(d);
    thursday.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const weekStr = `${thursday.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;

    // Calculate Monday (start) and Friday (end) of this ISO week
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - dayNum + 1);
    const friday = new Date(monday);
    friday.setUTCDate(monday.getUTCDate() + 4);

    return {
      week: weekStr,
      startDate: monday.toISOString().split('T')[0],
      endDate: friday.toISOString().split('T')[0],
    };
  } catch {
    return { week: 'Unknown', startDate: '', endDate: '' };
  }
}

function computeWeeklyPnL(trades: TradeRecord[]): WeeklyPnL[] {
  const closed = trades
    .filter(isClosed)
    .sort((a, b) => new Date(a.exitDate || a.timestamp).getTime() - new Date(b.exitDate || b.timestamp).getTime());

  const weekGroups = new Map<string, { trades: TradeRecord[]; startDate: string; endDate: string }>();

  for (const t of closed) {
    const dateStr = t.exitDate || t.timestamp;
    const { week, startDate, endDate } = getISOWeek(dateStr);
    const existing = weekGroups.get(week);
    if (existing) {
      existing.trades.push(t);
    } else {
      weekGroups.set(week, { trades: [t], startDate, endDate });
    }
  }

  let cumulative = 0;
  return Array.from(weekGroups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, data]) => {
      const wins = data.trades.filter(isWin).length;
      const totalPnL = data.trades.reduce((s, t) => s + (t.realizedPnL || 0), 0);
      cumulative += totalPnL;
      return {
        week,
        startDate: data.startDate,
        endDate: data.endDate,
        trades: data.trades.length,
        wins,
        totalPnL: +totalPnL.toFixed(2),
        cumulativePnL: +cumulative.toFixed(2),
      };
    });
}

// ─── Drawdown Metrics ───────────────────────────────────────

function computeDrawdown(trades: TradeRecord[]): DrawdownMetrics {
  const closed = trades
    .filter(isClosed)
    .sort((a, b) => new Date(a.exitDate || a.timestamp).getTime() - new Date(b.exitDate || b.timestamp).getTime());

  if (closed.length === 0) {
    return {
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      currentDrawdown: 0,
      peakEquity: 0,
      recoveryTrades: 0,
      drawdownPeriods: [],
    };
  }

  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  let maxDDPercent = 0;
  let maxDDStartIdx = 0;
  let maxDDEndIdx = 0;

  // Track drawdown periods
  const drawdownPeriods: { start: string; end: string; depth: number }[] = [];
  let inDrawdown = false;
  let ddStart = '';
  let ddDepth = 0;

  // For recovery tracking
  let maxDDRecoveredAt = -1;
  let maxDDPeakIdx = 0;

  const equityCurve: number[] = [];

  for (let i = 0; i < closed.length; i++) {
    const pnl = closed[i].realizedPnL || 0;
    equity += pnl;
    equityCurve.push(equity);

    if (equity > peak) {
      // New peak — end any active drawdown period
      if (inDrawdown) {
        drawdownPeriods.push({
          start: ddStart,
          end: closed[i].exitDate || closed[i].timestamp,
          depth: +ddDepth.toFixed(2),
        });
        inDrawdown = false;
      }
      peak = equity;
      maxDDPeakIdx = i;
    }

    const currentDD = peak - equity;
    if (currentDD > 0) {
      if (!inDrawdown) {
        inDrawdown = true;
        ddStart = closed[i].exitDate || closed[i].timestamp;
        ddDepth = 0;
      }
      if (currentDD > ddDepth) {
        ddDepth = currentDD;
      }
    }

    if (currentDD > maxDD) {
      maxDD = currentDD;
      maxDDPercent = peak > 0 ? (currentDD / peak) * 100 : 0;
      maxDDStartIdx = maxDDPeakIdx;
      maxDDEndIdx = i;
      maxDDRecoveredAt = -1; // not yet recovered
    }

    // Check if we recovered from the max drawdown
    if (maxDDRecoveredAt === -1 && i > maxDDEndIdx && equity >= equityCurve[maxDDStartIdx]) {
      maxDDRecoveredAt = i;
    }
  }

  // Close any open drawdown period
  if (inDrawdown && closed.length > 0) {
    drawdownPeriods.push({
      start: ddStart,
      end: closed[closed.length - 1].exitDate || closed[closed.length - 1].timestamp,
      depth: +ddDepth.toFixed(2),
    });
  }

  const currentDrawdown = peak - equity;
  const recoveryTrades = maxDDRecoveredAt >= 0 ? maxDDRecoveredAt - maxDDEndIdx : 0;

  return {
    maxDrawdown: +maxDD.toFixed(2),
    maxDrawdownPercent: +maxDDPercent.toFixed(1),
    currentDrawdown: +currentDrawdown.toFixed(2),
    peakEquity: +peak.toFixed(2),
    recoveryTrades,
    drawdownPeriods,
  };
}

// ─── Emotion Analysis ───────────────────────────────────────

function computeEmotionAnalysis(trades: TradeRecord[]): EmotionAnalysis[] {
  const closed = trades.filter(isClosed);
  const groups = new Map<string, TradeRecord[]>();

  for (const t of closed) {
    const emotion = normalizeEmotion(t.emotion || t.catalyst);
    if (!emotion) continue;
    const arr = groups.get(emotion) || [];
    arr.push(t);
    groups.set(emotion, arr);
  }

  return Array.from(groups.entries())
    .map(([emotion, group]) => {
      const wins = group.filter(isWin).length;
      const totalPnL = group.reduce((s, t) => s + (t.realizedPnL || 0), 0);
      return {
        emotion,
        trades: group.length,
        winRate: +((wins / group.length) * 100).toFixed(1),
        avgPnL: +(totalPnL / group.length).toFixed(2),
        totalPnL: +totalPnL.toFixed(2),
      };
    })
    .sort((a, b) => b.totalPnL - a.totalPnL);
}

function normalizeEmotion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();

  // Direct emotion keywords
  const emotionMap: Record<string, string> = {
    confident: 'confident',
    confidence: 'confident',
    disciplined: 'disciplined',
    discipline: 'disciplined',
    patient: 'disciplined',
    neutral: 'neutral',
    calm: 'neutral',
    fearful: 'fearful',
    fear: 'fearful',
    scared: 'fearful',
    anxious: 'fearful',
    fomo: 'fomo',
    'fear of missing out': 'fomo',
    chasing: 'fomo',
    greedy: 'greedy',
    greed: 'greedy',
    revenge: 'revenge',
    'revenge trade': 'revenge',
    tilt: 'revenge',
    tilted: 'revenge',
    frustrated: 'revenge',
    excited: 'confident',
    hopeful: 'neutral',
  };

  // Check for keyword matches within the text
  for (const [keyword, emotion] of Object.entries(emotionMap)) {
    if (lower.includes(keyword)) return emotion;
  }

  return null;
}

// ─── Behavior Detection ─────────────────────────────────────

function detectBehaviors(trades: TradeRecord[], metrics: PerformanceMetrics): BehaviorInsight[] {
  const insights: BehaviorInsight[] = [];
  const closed = trades.filter(isClosed);

  // ── Win rate assessment ──
  if (metrics.winRate >= 60) {
    insights.push({
      id: 'win_rate_strong',
      category: 'coaching',
      severity: 'positive',
      title: 'Strong Win Rate',
      description: `Your ${metrics.winRate.toFixed(0)}% win rate is above the 55% benchmark. You're selecting setups well.`,
      metric: `${metrics.winRate.toFixed(0)}%`,
      icon: '🎯',
    });
  } else if (metrics.winRate < 45 && closed.length >= 5) {
    insights.push({
      id: 'win_rate_low',
      category: 'coaching',
      severity: 'warning',
      title: 'Win Rate Below Target',
      description: `${metrics.winRate.toFixed(0)}% win rate across ${closed.length} trades. Consider tightening entry criteria or waiting for higher-conviction setups.`,
      metric: `${metrics.winRate.toFixed(0)}%`,
      suggestion: 'Focus on A+ setups only. Quality over quantity.',
      icon: '⚠️',
    });
  }

  // ── Profit factor ──
  if (metrics.profitFactor >= 2.0 && closed.length >= 5) {
    insights.push({
      id: 'profit_factor_great',
      category: 'coaching',
      severity: 'positive',
      title: 'Excellent Profit Factor',
      description: `${metrics.profitFactor.toFixed(1)}x profit factor — your winners are significantly larger than losers.`,
      metric: `${metrics.profitFactor.toFixed(1)}x`,
      icon: '💰',
    });
  } else if (metrics.profitFactor < 1.0 && closed.length >= 5) {
    insights.push({
      id: 'profit_factor_low',
      category: 'risk',
      severity: 'critical',
      title: 'Negative Expectancy',
      description: `Profit factor ${metrics.profitFactor.toFixed(2)}x — you're losing more than you make. Cut losers faster or let winners run longer.`,
      metric: `${metrics.profitFactor.toFixed(2)}x`,
      suggestion: 'Enforce stop losses. Never move stops further from entry.',
      icon: '🚨',
    });
  }

  // ── Revenge trading detection ──
  const sorted = [...closed].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  let revengeTrades = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (isLoss(prev)) {
      const gap = (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 60000;
      if (gap < 15 && isLoss(curr)) {
        revengeTrades++;
      }
    }
  }
  if (revengeTrades >= 2) {
    insights.push({
      id: 'revenge_trading',
      category: 'behavior',
      severity: 'critical',
      title: 'Revenge Trading Detected',
      description: `${revengeTrades} times you entered a new trade within 15 minutes of a loss — and lost again. This pattern costs you money.`,
      metric: `${revengeTrades} instances`,
      suggestion: 'After a loss, wait 30 minutes before your next trade. Walk away from the screen.',
      icon: '🔥',
    });
  }

  // ── Overtrading detection ──
  const dayGroups = new Map<string, TradeRecord[]>();
  for (const t of closed) {
    const day = t.timestamp.split('T')[0];
    const arr = dayGroups.get(day) || [];
    arr.push(t);
    dayGroups.set(day, arr);
  }
  const overtradeDays = Array.from(dayGroups.entries()).filter(([, g]) => g.length > 8);
  if (overtradeDays.length > 0) {
    const avgPnlOvertrade = overtradeDays.reduce((s, [, g]) =>
      s + g.reduce((gs, t) => gs + (t.realizedPnL || 0), 0), 0) / overtradeDays.length;
    insights.push({
      id: 'overtrading',
      category: 'behavior',
      severity: avgPnlOvertrade < 0 ? 'warning' : 'neutral',
      title: 'Overtrading Pattern',
      description: `${overtradeDays.length} day(s) with 8+ trades. Average P&L on those days: $${avgPnlOvertrade.toFixed(0)}.`,
      metric: `${overtradeDays.length} days`,
      suggestion: avgPnlOvertrade < 0
        ? 'Cap yourself at 5 trades per day. Quality > quantity.'
        : 'High activity days are working for you — just ensure discipline holds.',
      icon: '📊',
    });
  }

  // ── Holding losers too long ──
  const longHoldLosses = closed.filter(t =>
    isLoss(t) && t.actualHoldingTimeMinutes && t.actualHoldingTimeMinutes > 240);
  const shortHoldWins = closed.filter(t =>
    isWin(t) && t.actualHoldingTimeMinutes && t.actualHoldingTimeMinutes < 30);

  if (longHoldLosses.length >= 3) {
    insights.push({
      id: 'holding_losers',
      category: 'behavior',
      severity: 'warning',
      title: 'Holding Losers Too Long',
      description: `${longHoldLosses.length} losing trades held for 4+ hours. Average loss: $${(longHoldLosses.reduce((s, t) => s + (t.realizedPnL || 0), 0) / longHoldLosses.length).toFixed(0)}`,
      suggestion: 'Set a time stop — if a day trade isn\'t working after 2 hours, cut it.',
      icon: '⏰',
    });
  }

  if (shortHoldWins.length >= 3 && metrics.avgWin < metrics.avgLoss * 0.8) {
    insights.push({
      id: 'cutting_winners',
      category: 'behavior',
      severity: 'warning',
      title: 'Cutting Winners Short',
      description: `${shortHoldWins.length} winning trades closed in under 30 minutes. Your avg win ($${metrics.avgWin.toFixed(0)}) is smaller than avg loss ($${metrics.avgLoss.toFixed(0)}).`,
      suggestion: 'Let winners breathe. Use trailing stops instead of fixed exits.',
      icon: '✂️',
    });
  }

  // ── Best/worst ticker ──
  const tickerGroups = computeTickerBreakdown(trades);
  const bestTicker = tickerGroups.find(t => t.trades >= 3 && t.winRate >= 70);
  const worstTicker = tickerGroups.find(t => t.trades >= 3 && t.winRate <= 30);

  if (bestTicker) {
    insights.push({
      id: 'best_ticker',
      category: 'ticker',
      severity: 'positive',
      title: `${bestTicker.symbol} Is Your Edge`,
      description: `${bestTicker.winRate}% win rate on ${bestTicker.symbol} across ${bestTicker.trades} trades (+$${bestTicker.totalPnL.toFixed(0)}). You read this name well.`,
      metric: `${bestTicker.winRate}% WR`,
      suggestion: `Size up on ${bestTicker.symbol} setups — you have an edge here.`,
      icon: '⭐',
    });
  }
  if (worstTicker) {
    insights.push({
      id: 'worst_ticker',
      category: 'ticker',
      severity: 'warning',
      title: `${worstTicker.symbol} Is Costing You`,
      description: `${worstTicker.winRate}% win rate on ${worstTicker.symbol} across ${worstTicker.trades} trades ($${worstTicker.totalPnL.toFixed(0)}). This name doesn't suit your style.`,
      metric: `${worstTicker.winRate}% WR`,
      suggestion: `Consider removing ${worstTicker.symbol} from your watchlist.`,
      icon: '🚫',
    });
  }

  // ── Loss streak warning ──
  if (metrics.worstStreak >= 4) {
    insights.push({
      id: 'loss_streak',
      category: 'behavior',
      severity: 'warning',
      title: `${metrics.worstStreak}-Trade Loss Streak`,
      description: `Your worst losing streak was ${metrics.worstStreak} trades in a row. Extended streaks often indicate tilt or forcing trades.`,
      suggestion: 'After 3 consecutive losses, stop trading for the day. Come back fresh tomorrow.',
      icon: '📉',
    });
  }

  // ── Options vs stock performance ──
  const optionTrades = closed.filter(t => t.assetType === 'option');
  const stockTrades = closed.filter(t => t.assetType === 'stock');
  if (optionTrades.length >= 3 && stockTrades.length >= 3) {
    const optWR = optionTrades.filter(isWin).length / optionTrades.length * 100;
    const stkWR = stockTrades.filter(isWin).length / stockTrades.length * 100;
    if (Math.abs(optWR - stkWR) > 15) {
      const better = optWR > stkWR ? 'options' : 'stocks';
      const betterWR = Math.max(optWR, stkWR);
      insights.push({
        id: 'asset_type_edge',
        category: 'setup',
        severity: 'positive',
        title: `You're Better With ${better === 'options' ? 'Options' : 'Stocks'}`,
        description: `${betterWR.toFixed(0)}% win rate on ${better} vs ${Math.min(optWR, stkWR).toFixed(0)}% on ${better === 'options' ? 'stocks' : 'options'}.`,
        suggestion: `Focus more capital on ${better} plays where you have the edge.`,
        icon: better === 'options' ? '🎰' : '📈',
      });
    }
  }

  // ── Long vs short edge ──
  // This turns the journal into an evidence check for the recurring question
  // "am I actually better at bullish or bearish setups?" instead of letting
  // the current board composition answer it by impression.
  const longTrades = closed.filter(t => t.direction === 'long');
  const shortTrades = closed.filter(t => t.direction === 'short');
  if (longTrades.length >= 3 && shortTrades.length >= 3) {
    const summarize = (group: TradeRecord[]) => {
      const pnl = group.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);
      return {
        winRate: group.filter(isWin).length / group.length * 100,
        expectancy: pnl / group.length,
      };
    };
    const longs = summarize(longTrades);
    const shorts = summarize(shortTrades);
    const better = longs.expectancy >= shorts.expectancy ? 'bullish' : 'bearish';
    const best = better === 'bullish' ? longs : shorts;
    const other = better === 'bullish' ? shorts : longs;
    insights.push({
      id: 'directional_edge',
      category: 'setup',
      severity: best.expectancy > 0 ? 'positive' : 'warning',
      title: `${better === 'bullish' ? 'Bullish' : 'Bearish'} Setups Lead Your Book`,
      description: `${better === 'bullish' ? 'Longs' : 'Shorts'} average $${best.expectancy.toFixed(0)}/trade (${best.winRate.toFixed(0)}% WR) versus $${other.expectancy.toFixed(0)}/trade on the other side.`,
      metric: `$${best.expectancy.toFixed(0)}/trade`,
      suggestion: 'Treat this as a sample result, not permission to size up. Re-check after every 20 closed trades and compare the same setup family and market regime.',
      icon: better === 'bullish' ? '↗️' : '↘️',
    });
  }

  // ── Current streak awareness ──
  if (metrics.currentStreak.type === 'win' && metrics.currentStreak.count >= 3) {
    insights.push({
      id: 'hot_streak',
      category: 'coaching',
      severity: 'positive',
      title: `🔥 ${metrics.currentStreak.count}-Trade Win Streak`,
      description: 'You\'re in the zone. Don\'t get overconfident — stick to your setups and position sizing.',
      icon: '🔥',
    });
  } else if (metrics.currentStreak.type === 'loss' && metrics.currentStreak.count >= 3) {
    insights.push({
      id: 'cold_streak',
      category: 'coaching',
      severity: 'critical',
      title: `❄️ ${metrics.currentStreak.count}-Trade Loss Streak`,
      description: 'Step back. Reduce size by 50% on your next trade or take the rest of the day off.',
      suggestion: 'Trade small until the streak breaks. Protect your capital.',
      icon: '❄️',
    });
  }

  // ── Expectancy coaching ──
  if (metrics.expectancy > 0 && closed.length >= 10) {
    insights.push({
      id: 'positive_expectancy',
      category: 'coaching',
      severity: 'positive',
      title: 'Positive Expectancy',
      description: `You make an average of $${metrics.expectancy.toFixed(0)} per trade. Over ${closed.length} trades, your system works. Keep executing.`,
      metric: `$${metrics.expectancy.toFixed(0)}/trade`,
      icon: '✅',
    });
  }

  // ── Big Win Curse ──
  // After a big win (>2x avgWin), do the next 3 trades lose?
  if (metrics.avgWin > 0) {
    let bigWinCurseCount = 0;
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      if (isWin(t) && (t.realizedPnL || 0) > metrics.avgWin * 2) {
        // Check next 3 trades
        const next3 = sorted.slice(i + 1, i + 4);
        if (next3.length >= 3) {
          const losseAfterBigWin = next3.filter(isLoss).length;
          if (losseAfterBigWin >= 2) bigWinCurseCount++;
        }
      }
    }
    if (bigWinCurseCount >= 1) {
      insights.push({
        id: 'big_win_curse',
        category: 'behavior',
        severity: 'warning',
        title: 'Big Win Curse',
        description: `${bigWinCurseCount} time(s) after a big win (>2x your avg), you lost 2+ of the next 3 trades. Big wins can cause overconfidence.`,
        metric: `${bigWinCurseCount} instances`,
        suggestion: 'After a big win, stick to your normal size and setups. Don\'t let euphoria inflate your risk.',
        icon: '🎲',
      });
    }
  }

  // ── 0DTE Warning ──
  const dteData = computeDTEBreakdown(trades);
  const zeroDTE = dteData.find(d => d.label === '0DTE');
  if (zeroDTE && zeroDTE.trades >= 3 && (zeroDTE.winRate < 40 || zeroDTE.totalPnL < 0)) {
    insights.push({
      id: '0dte_warning',
      category: 'risk',
      severity: 'warning',
      title: '0DTE Performance Warning',
      description: `Your 0DTE trades: ${zeroDTE.winRate}% win rate, $${zeroDTE.totalPnL.toFixed(0)} total P&L across ${zeroDTE.trades} trades. 0DTE is high-risk and it's costing you.`,
      metric: `${zeroDTE.winRate}% WR`,
      suggestion: 'Reduce 0DTE size or switch to 1-3 DTE for more time to be right.',
      icon: '⏱️',
    });
  }

  // ── Optimal Trade Count Insight ──
  const tradeCountData = computeTradeCountOptimum(trades);
  const activeBuckets = tradeCountData.filter(b => b.days > 0);
  if (activeBuckets.length >= 2) {
    const bestBucket = activeBuckets.reduce((best, b) => b.avgPnL > best.avgPnL ? b : best, activeBuckets[0]);
    const mostCommonBucket = activeBuckets.reduce((most, b) => b.days > most.days ? b : most, activeBuckets[0]);
    if (bestBucket.label !== mostCommonBucket.label && bestBucket.avgPnL > 0) {
      insights.push({
        id: 'optimal_trade_count',
        category: 'behavior',
        severity: 'neutral',
        title: 'Optimal Trade Count',
        description: `Your best daily P&L ($${bestBucket.avgPnL.toFixed(0)}/day) comes from ${bestBucket.label} days, but you most often trade ${mostCommonBucket.label} (${mostCommonBucket.days} days).`,
        metric: bestBucket.label,
        suggestion: `Try targeting ${bestBucket.label} per day — that's where your edge lives.`,
        icon: '🎯',
      });
    }
  }

  // ── Friday Fade Warning ──
  const dayPnLData = computeDayOfWeekPnL(trades);
  const fridayData = dayPnLData.find(d => d.day === 'Friday');
  if (fridayData && fridayData.trades >= 5 && fridayData.totalPnL < 0) {
    insights.push({
      id: 'friday_fade',
      category: 'timing',
      severity: 'warning',
      title: 'Friday Fade',
      description: `Fridays are costing you: $${fridayData.totalPnL.toFixed(0)} across ${fridayData.trades} trades (${fridayData.winRate}% WR). End-of-week theta decay and position unwinding may not suit your style.`,
      metric: `$${fridayData.totalPnL.toFixed(0)}`,
      suggestion: 'Consider reducing Friday activity or switching to stock-only plays on Fridays.',
      icon: '📅',
    });
  }

  // ── Emotion-Outcome Correlation ──
  const emotionData = computeEmotionAnalysis(trades);
  for (const e of emotionData) {
    if ((e.emotion === 'fomo' || e.emotion === 'revenge') && e.trades >= 2 && e.winRate < 30) {
      insights.push({
        id: `emotion_negative_${e.emotion}`,
        category: 'behavior',
        severity: 'critical',
        title: `${e.emotion.charAt(0).toUpperCase() + e.emotion.slice(1)} Trades Are Destroying P&L`,
        description: `Your "${e.emotion}" trades: ${e.winRate}% win rate, $${e.totalPnL.toFixed(0)} total. This emotional state is a direct leak.`,
        metric: `${e.winRate}% WR`,
        suggestion: `Recognize when you're in a "${e.emotion}" state and step away. No trade is better than a bad trade.`,
        icon: e.emotion === 'fomo' ? '🏃' : '💢',
      });
    }
    if ((e.emotion === 'disciplined' || e.emotion === 'confident') && e.trades >= 3 && e.winRate > 60) {
      insights.push({
        id: `emotion_positive_${e.emotion}`,
        category: 'coaching',
        severity: 'positive',
        title: `${e.emotion.charAt(0).toUpperCase() + e.emotion.slice(1)} Mindset = Edge`,
        description: `When you feel "${e.emotion}", you hit ${e.winRate}% win rate (+$${e.totalPnL.toFixed(0)}). Your best trading happens in this state.`,
        metric: `${e.winRate}% WR`,
        suggestion: `Only trade when you feel ${e.emotion}. Build a pre-trade routine to get into this state.`,
        icon: e.emotion === 'disciplined' ? '🧘' : '💪',
      });
    }
  }

  // ── Recovery Time Insight ──
  const ddData = computeDrawdown(trades);
  if (ddData.recoveryTrades > 15) {
    insights.push({
      id: 'slow_recovery',
      category: 'risk',
      severity: 'warning',
      title: 'Extended Drawdown Recovery',
      description: `It took ${ddData.recoveryTrades} trades to recover from your deepest drawdown ($${ddData.maxDrawdown.toFixed(0)}). Long recoveries drain mental capital.`,
      metric: `${ddData.recoveryTrades} trades`,
      suggestion: 'After a big drawdown, reduce size by 50% until you hit 3 consecutive wins. Rebuild confidence before rebuilding P&L.',
      icon: '🏥',
    });
  }

  return insights;
}

// ─── Main Export ─────────────────────────────────────────────

export async function getJournalAnalytics(userId?: string): Promise<JournalAnalytics> {
  try {
    // If userId provided, pull from personal journal trades
    // Otherwise fall back to platform trade ideas for demo
    let trades: TradeRecord[];

    if (userId) {
      const journalTrades = await storage.getJournalTrades(userId);
      trades = journalTrades.map((j: any) => ({
        id: j.id,
        symbol: j.symbol,
        direction: j.direction || 'long',
        assetType: j.assetType || 'stock',
        optionType: j.optionType || null,
        strikePrice: j.strikePrice || null,
        expiryDate: j.expiryDate || null,
        entryPrice: j.entryPrice,
        targetPrice: j.exitPrice || j.entryPrice,  // journal trades use exitPrice as effective target
        stopLoss: 0,
        exitPrice: j.exitPrice || null,
        riskRewardRatio: 0,
        realizedPnL: j.realizedPnL ?? null,
        percentGain: j.realizedPnLPercent ?? null,
        outcomeStatus: j.status === 'closed'
          ? (j.outcome === 'win' ? 'hit_target' : j.outcome === 'loss' ? 'hit_stop' : 'expired')
          : 'open',
        source: j.setupType || j.broker || 'manual',
        holdingPeriod: j.holdingMinutes && j.holdingMinutes < 390 ? 'day' : 'swing',
        timestamp: j.entryTime,
        exitDate: j.exitTime || null,
        actualHoldingTimeMinutes: j.holdingMinutes || null,
        sector: null,
        catalyst: j.notes || null,
        emotion: j.emotion || null,
        confidenceScore: (j.rating || 3) * 20,  // convert 1-5 rating to 0-100
        dataSourceUsed: j.broker || null,
      }));
    } else {
      // Fallback: platform trade ideas (demo mode, no userId)
      const allIdeas = await storage.getAllTradeIdeas();
      trades = allIdeas.map((i: any) => ({
        id: i.id,
        symbol: i.symbol,
        direction: i.direction,
        assetType: i.assetType,
        optionType: i.optionType || null,
        strikePrice: i.strikePrice || null,
        expiryDate: i.expiryDate || null,
        entryPrice: i.entryPrice,
        targetPrice: i.targetPrice,
        stopLoss: i.stopLoss,
        exitPrice: i.exitPrice || null,
        riskRewardRatio: i.riskRewardRatio || 0,
        realizedPnL: i.realizedPnL || null,
        percentGain: i.percentGain || null,
        outcomeStatus: i.outcomeStatus || 'open',
        source: i.source || 'unknown',
        holdingPeriod: i.holdingPeriod || 'day',
        timestamp: i.timestamp,
        exitDate: i.exitDate || null,
        actualHoldingTimeMinutes: i.actualHoldingTimeMinutes || null,
        sector: i.sector || null,
        catalyst: i.catalyst || null,
        emotion: i.emotion || null,
        confidenceScore: i.confidenceScore || 0,
        dataSourceUsed: i.dataSourceUsed || null,
      }));
    }

    const metrics = computeMetrics(trades);
    const pnlCurve = computePnLCurve(trades);
    const timingByHour = computeTimingInsights(trades, t => {
      const h = getHour(t.timestamp);
      return `${h}:00`;
    });
    const timingByDay = computeTimingInsights(trades, t => getDayOfWeek(t.timestamp));
    const timingBySession = computeTimingInsights(trades, t => getSession(t.timestamp));
    const tickerBreakdown = computeTickerBreakdown(trades);
    const setupBreakdown = computeSetupBreakdown(trades);
    const dteBreakdown = computeDTEBreakdown(trades);
    const dayOfWeekPnL = computeDayOfWeekPnL(trades);
    const tradeCountOptimum = computeTradeCountOptimum(trades);
    const weeklyPnL = computeWeeklyPnL(trades);
    const drawdown = computeDrawdown(trades);
    const emotionAnalysis = computeEmotionAnalysis(trades);
    const insights = detectBehaviors(trades, metrics);

    const recentTrades = [...trades]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 50);

    return {
      metrics,
      pnlCurve,
      timingByHour,
      timingByDay,
      timingBySession,
      tickerBreakdown,
      setupBreakdown,
      insights,
      recentTrades,
      dteBreakdown,
      dayOfWeekPnL,
      tradeCountOptimum,
      weeklyPnL,
      drawdown,
      emotionAnalysis,
    };
  } catch (err) {
    logger.error('[JOURNAL] Analytics computation failed:', err);
    return {
      metrics: computeMetrics([]),
      pnlCurve: [],
      timingByHour: [],
      timingByDay: [],
      timingBySession: [],
      tickerBreakdown: [],
      setupBreakdown: [],
      insights: [],
      recentTrades: [],
      dteBreakdown: [],
      dayOfWeekPnL: [],
      tradeCountOptimum: [],
      weeklyPnL: [],
      drawdown: {
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        currentDrawdown: 0,
        peakEquity: 0,
        recoveryTrades: 0,
        drawdownPeriods: [],
      },
      emotionAnalysis: [],
    };
  }
}
