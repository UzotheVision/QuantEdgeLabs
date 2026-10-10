/**
 * Expiry Pattern Analysis Service
 * Tracks weekly/monthly option expiry patterns to identify bullish/bearish signals
 * for specific time periods and improve price prediction
 */

import { db } from './db';
import { paperPositions, tradeIdeas } from '@shared/schema';
import { eq, and, gte, lte, sql, desc, isNotNull } from 'drizzle-orm';
import { logger } from './logger';

export interface ExpiryPattern {
  expiryDate: string;
  expiryType: 'weekly' | 'monthly' | 'leap';
  dayOfWeek: string;
  weekOfMonth: number;
  
  // Trade statistics
  totalTrades: number;
  callTrades: number;
  putTrades: number;
  callWinRate: number;
  putWinRate: number;
  
  // Sentiment signals
  callPutRatio: number;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentStrength: number; // 0-100
  
  // Performance metrics
  avgPnL: number;
  avgDTE: number;
  bestSymbols: string[];
  worstSymbols: string[];
}

export interface WeeklyPattern {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  year: number;
  
  // Aggregate signals
  dominantSentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number; // -100 (bearish) to +100 (bullish)
  
  // Trade breakdown
  totalCalls: number;
  totalPuts: number;
  callWinRate: number;
  putWinRate: number;
  
  // Price prediction signals
  priceDirection: 'up' | 'down' | 'sideways';
  confidenceLevel: number;
  keyLevels: { support: number; resistance: number }[];
}

export interface MonthlyPattern {
  month: string;
  year: number;
  
  // Monthly aggregates
  weeklyBreakdown: WeeklyPattern[];
  
  // Overall sentiment
  overallSentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number;
  
  // Performance
  totalTrades: number;
  winRate: number;
  avgPnL: number;
  
  // Key expiry dates performance
  monthlyExpiryPerformance: number;
  weeklyExpiryPerformance: number;
}

export interface ExpirySignal {
  symbol: string;
  expiryDate: string;
  expiryType: 'weekly' | 'monthly' | 'leap';
  daysToExpiry: number;
  
  // Signal details
  signalType: 'bullish' | 'bearish';
  signalStrength: number; // 0-100
  signalReason: string;
  
  // Historical context
  historicalWinRate: number;
  similarExpiryPatterns: ExpiryPattern[];
  
  // Price prediction
  predictedDirection: 'up' | 'down';
  predictedMovePercent: number;
  confidenceLevel: number;
}

/**
 * Classify expiry type based on days to expiration
 */
export function classifyExpiryType(daysToExpiry: number): 'weekly' | 'monthly' | 'leap' {
  if (daysToExpiry <= 7) return 'weekly';
  if (daysToExpiry <= 45) return 'monthly';
  return 'leap';
}

/**
 * Get day of week name
 */
function getDayOfWeek(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

/**
 * Get week of month (1-5)
 */
function getWeekOfMonth(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  return Math.ceil((date.getDate() + firstDay.getDay()) / 7);
}

/**
 * Calculate ISO week number
 */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Analyze expiry patterns from historical trades
 */
export async function analyzeExpiryPatterns(
  portfolioId?: string,
  lookbackDays: number = 90
): Promise<ExpiryPattern[]> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
    
    // Query closed positions with expiry data
    const conditions = [
      eq(paperPositions.status, 'closed'),
      isNotNull(paperPositions.expiryDate),
      isNotNull(paperPositions.optionType),
      gte(paperPositions.entryTime, cutoffDate.toISOString())
    ];
    
    if (portfolioId) {
      conditions.push(eq(paperPositions.portfolioId, portfolioId));
    }
    
    const trades = await db
      .select()
      .from(paperPositions)
      .where(and(...conditions))
      .orderBy(desc(paperPositions.entryTime));
    
    // Group by expiry date
    const expiryGroups = new Map<string, typeof trades>();
    
    for (const trade of trades) {
      const expiryDate = trade.expiryDate!;
      if (!expiryGroups.has(expiryDate)) {
        expiryGroups.set(expiryDate, []);
      }
      expiryGroups.get(expiryDate)!.push(trade);
    }
    
    // Analyze each expiry date
    const patterns: ExpiryPattern[] = [];
    
    for (const [expiryDate, groupTrades] of Array.from(expiryGroups.entries())) {
      const expDate = new Date(expiryDate);
      const entryDate = new Date(groupTrades[0].entryTime);
      const daysToExpiry = Math.ceil((expDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
      
      const calls = groupTrades.filter(t => t.optionType === 'call');
      const puts = groupTrades.filter(t => t.optionType === 'put');
      
      const callWins = calls.filter(t => (t.realizedPnL || 0) > 0).length;
      const putWins = puts.filter(t => (t.realizedPnL || 0) > 0).length;
      
      const callWinRate = calls.length > 0 ? (callWins / calls.length) * 100 : 0;
      const putWinRate = puts.length > 0 ? (putWins / puts.length) * 100 : 0;
      
      const callPutRatio = puts.length > 0 ? calls.length / puts.length : calls.length;
      
      // Determine sentiment
      let sentiment: 'bullish' | 'bearish' | 'neutral';
      let sentimentStrength: number;
      
      if (callPutRatio > 1.5 && callWinRate > putWinRate) {
        sentiment = 'bullish';
        sentimentStrength = Math.min(100, callPutRatio * 20 + (callWinRate - putWinRate));
      } else if (callPutRatio < 0.67 && putWinRate > callWinRate) {
        sentiment = 'bearish';
        sentimentStrength = Math.min(100, (1 / callPutRatio) * 20 + (putWinRate - callWinRate));
      } else {
        sentiment = 'neutral';
        sentimentStrength = 50 - Math.abs(callWinRate - putWinRate);
      }
      
      // Calculate average PnL
      const totalPnL = groupTrades.reduce((sum, t) => sum + (t.realizedPnL || 0), 0);
      const avgPnL = groupTrades.length > 0 ? totalPnL / groupTrades.length : 0;
      
      // Find best and worst performers
      const symbolPnL = new Map<string, number>();
      for (const trade of groupTrades) {
        const current = symbolPnL.get(trade.symbol) || 0;
        symbolPnL.set(trade.symbol, current + (trade.realizedPnL || 0));
      }
      
      const sortedSymbols = Array.from(symbolPnL.entries()).sort((a, b) => b[1] - a[1]);
      const bestSymbols = sortedSymbols.slice(0, 3).map(s => s[0]);
      const worstSymbols = sortedSymbols.slice(-3).reverse().map(s => s[0]);
      
      patterns.push({
        expiryDate,
        expiryType: classifyExpiryType(daysToExpiry),
        dayOfWeek: getDayOfWeek(expDate),
        weekOfMonth: getWeekOfMonth(expDate),
        totalTrades: groupTrades.length,
        callTrades: calls.length,
        putTrades: puts.length,
        callWinRate,
        putWinRate,
        callPutRatio,
        sentiment,
        sentimentStrength,
        avgPnL,
        avgDTE: daysToExpiry,
        bestSymbols,
        worstSymbols
      });
    }
    
    return patterns.sort((a, b) => new Date(b.expiryDate).getTime() - new Date(a.expiryDate).getTime());
    
  } catch (error) {
    logger.error('[EXPIRY-PATTERN] Error analyzing patterns:', error);
    return [];
  }
}

/**
 * Analyze weekly patterns for a given time range
 */
export async function analyzeWeeklyPatterns(
  portfolioId?: string,
  weeksBack: number = 12
): Promise<WeeklyPattern[]> {
  try {
    const patterns = await analyzeExpiryPatterns(portfolioId, weeksBack * 7);
    
    // Group patterns by ISO week
    const weekGroups = new Map<string, ExpiryPattern[]>();
    
    for (const pattern of patterns) {
      const expDate = new Date(pattern.expiryDate);
      const weekKey = `${expDate.getFullYear()}-W${getISOWeekNumber(expDate).toString().padStart(2, '0')}`;
      
      if (!weekGroups.has(weekKey)) {
        weekGroups.set(weekKey, []);
      }
      weekGroups.get(weekKey)!.push(pattern);
    }
    
    const weeklyPatterns: WeeklyPattern[] = [];
    
    for (const [weekKey, weekPatterns] of Array.from(weekGroups.entries())) {
      const [year, weekStr] = weekKey.split('-W');
      const weekNumber = parseInt(weekStr);
      
      // Calculate week start/end dates
      const jan1 = new Date(parseInt(year), 0, 1);
      const weekStart = new Date(jan1.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
      
      // Aggregate metrics
      const totalCalls = weekPatterns.reduce((sum, p) => sum + p.callTrades, 0);
      const totalPuts = weekPatterns.reduce((sum, p) => sum + p.putTrades, 0);
      
      const avgCallWinRate = weekPatterns.reduce((sum, p) => sum + p.callWinRate, 0) / weekPatterns.length;
      const avgPutWinRate = weekPatterns.reduce((sum, p) => sum + p.putWinRate, 0) / weekPatterns.length;
      
      // Calculate sentiment score (-100 to +100)
      const bullishPatterns = weekPatterns.filter(p => p.sentiment === 'bullish').length;
      const bearishPatterns = weekPatterns.filter(p => p.sentiment === 'bearish').length;
      const sentimentScore = ((bullishPatterns - bearishPatterns) / weekPatterns.length) * 100;
      
      let dominantSentiment: 'bullish' | 'bearish' | 'neutral';
      if (sentimentScore > 25) dominantSentiment = 'bullish';
      else if (sentimentScore < -25) dominantSentiment = 'bearish';
      else dominantSentiment = 'neutral';
      
      // Price direction prediction
      let priceDirection: 'up' | 'down' | 'sideways';
      if (totalCalls > totalPuts * 1.5 && avgCallWinRate > 50) priceDirection = 'up';
      else if (totalPuts > totalCalls * 1.5 && avgPutWinRate > 50) priceDirection = 'down';
      else priceDirection = 'sideways';
      
      const confidenceLevel = Math.min(100, Math.abs(sentimentScore) + (Math.max(avgCallWinRate, avgPutWinRate) - 50));
      
      weeklyPatterns.push({
        weekStart: weekStart.toISOString().split('T')[0],
        weekEnd: weekEnd.toISOString().split('T')[0],
        weekNumber,
        year: parseInt(year),
        dominantSentiment,
        sentimentScore,
        totalCalls,
        totalPuts,
        callWinRate: avgCallWinRate,
        putWinRate: avgPutWinRate,
        priceDirection,
        confidenceLevel,
        keyLevels: [] // Can be populated with actual price levels
      });
    }
    
    return weeklyPatterns.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.weekNumber - a.weekNumber;
    });
    
  } catch (error) {
    logger.error('[EXPIRY-PATTERN] Error analyzing weekly patterns:', error);
    return [];
  }
}

/**
 * Generate expiry-based trading signals
 */
export async function generateExpirySignals(
  symbol: string,
  currentPrice: number
): Promise<ExpirySignal[]> {
  try {
    // Get historical patterns for this symbol
    const allPatterns = await analyzeExpiryPatterns(undefined, 90);
    
    // Filter patterns that include this symbol
    const symbolPatterns = allPatterns.filter(
      p => p.bestSymbols.includes(symbol) || p.worstSymbols.includes(symbol)
    );
    
    if (symbolPatterns.length === 0) {
      return [];
    }
    
    const signals: ExpirySignal[] = [];
    
    // Generate upcoming expiry predictions
    const today = new Date();
    
    // Next Friday (weekly expiry)
    const nextFriday = new Date(today);
    nextFriday.setDate(today.getDate() + ((5 - today.getDay() + 7) % 7) || 7);
    
    // Third Friday of current/next month (monthly expiry)
    const getThirdFriday = (date: Date): Date => {
      const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
      const firstFriday = new Date(firstDay);
      firstFriday.setDate(1 + ((5 - firstDay.getDay() + 7) % 7));
      return new Date(firstFriday.getFullYear(), firstFriday.getMonth(), firstFriday.getDate() + 14);
    };
    
    const monthlyExpiry = getThirdFriday(today);
    if (monthlyExpiry < today) {
      monthlyExpiry.setMonth(monthlyExpiry.getMonth() + 1);
    }
    
    // Analyze weekly expiry signal
    const weeklyPatterns = symbolPatterns.filter(p => p.expiryType === 'weekly');
    if (weeklyPatterns.length > 0) {
      const avgCallWinRate = weeklyPatterns.reduce((sum, p) => sum + p.callWinRate, 0) / weeklyPatterns.length;
      const avgPutWinRate = weeklyPatterns.reduce((sum, p) => sum + p.putWinRate, 0) / weeklyPatterns.length;
      
      const signalType = avgCallWinRate > avgPutWinRate ? 'bullish' : 'bearish';
      const historicalWinRate = Math.max(avgCallWinRate, avgPutWinRate);
      
      signals.push({
        symbol,
        expiryDate: nextFriday.toISOString().split('T')[0],
        expiryType: 'weekly',
        daysToExpiry: Math.ceil((nextFriday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
        signalType,
        signalStrength: Math.min(100, historicalWinRate * 1.5),
        signalReason: `${symbol} shows ${signalType} bias on weekly expiries (${historicalWinRate.toFixed(1)}% win rate on ${signalType === 'bullish' ? 'calls' : 'puts'})`,
        historicalWinRate,
        similarExpiryPatterns: weeklyPatterns,
        predictedDirection: signalType === 'bullish' ? 'up' : 'down',
        predictedMovePercent: signalType === 'bullish' ? 2.5 : -2.5,
        confidenceLevel: Math.min(100, historicalWinRate)
      });
    }
    
    // Analyze monthly expiry signal
    const monthlyPatterns = symbolPatterns.filter(p => p.expiryType === 'monthly');
    if (monthlyPatterns.length > 0) {
      const avgCallWinRate = monthlyPatterns.reduce((sum, p) => sum + p.callWinRate, 0) / monthlyPatterns.length;
      const avgPutWinRate = monthlyPatterns.reduce((sum, p) => sum + p.putWinRate, 0) / monthlyPatterns.length;
      
      const signalType = avgCallWinRate > avgPutWinRate ? 'bullish' : 'bearish';
      const historicalWinRate = Math.max(avgCallWinRate, avgPutWinRate);
      
      signals.push({
        symbol,
        expiryDate: monthlyExpiry.toISOString().split('T')[0],
        expiryType: 'monthly',
        daysToExpiry: Math.ceil((monthlyExpiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
        signalType,
        signalStrength: Math.min(100, historicalWinRate * 1.2),
        signalReason: `${symbol} shows ${signalType} pattern into monthly expiry (${historicalWinRate.toFixed(1)}% historical win rate)`,
        historicalWinRate,
        similarExpiryPatterns: monthlyPatterns,
        predictedDirection: signalType === 'bullish' ? 'up' : 'down',
        predictedMovePercent: signalType === 'bullish' ? 5.0 : -5.0,
        confidenceLevel: Math.min(100, historicalWinRate * 0.9)
      });
    }
    
    return signals;
    
  } catch (error) {
    logger.error('[EXPIRY-PATTERN] Error generating signals for', symbol, error);
    return [];
  }
}

/**
 * Get expiry pattern summary for dashboard display
 */
export async function getExpiryPatternSummary(portfolioId?: string): Promise<{
  totalPatterns: number;
  bullishExpiries: number;
  bearishExpiries: number;
  neutralExpiries: number;
  overallSentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number;
  topPerformingExpiry: ExpiryPattern | null;
  worstPerformingExpiry: ExpiryPattern | null;
  weeklyWinRate: number;
  monthlyWinRate: number;
  upcomingSignals: ExpirySignal[];
}> {
  const patterns = await analyzeExpiryPatterns(portfolioId, 90);
  
  if (patterns.length === 0) {
    return {
      totalPatterns: 0,
      bullishExpiries: 0,
      bearishExpiries: 0,
      neutralExpiries: 0,
      overallSentiment: 'neutral',
      sentimentScore: 0,
      topPerformingExpiry: null,
      worstPerformingExpiry: null,
      weeklyWinRate: 0,
      monthlyWinRate: 0,
      upcomingSignals: []
    };
  }
  
  const bullishExpiries = patterns.filter(p => p.sentiment === 'bullish').length;
  const bearishExpiries = patterns.filter(p => p.sentiment === 'bearish').length;
  const neutralExpiries = patterns.filter(p => p.sentiment === 'neutral').length;
  
  const sentimentScore = ((bullishExpiries - bearishExpiries) / patterns.length) * 100;
  
  let overallSentiment: 'bullish' | 'bearish' | 'neutral';
  if (sentimentScore > 20) overallSentiment = 'bullish';
  else if (sentimentScore < -20) overallSentiment = 'bearish';
  else overallSentiment = 'neutral';
  
  // Find top and worst performers
  const sortedByPnL = [...patterns].sort((a, b) => b.avgPnL - a.avgPnL);
  
  // Calculate win rates by expiry type
  const weeklyPatterns = patterns.filter(p => p.expiryType === 'weekly');
  const monthlyPatterns = patterns.filter(p => p.expiryType === 'monthly');
  
  const weeklyWinRate = weeklyPatterns.length > 0
    ? weeklyPatterns.reduce((sum, p) => sum + (p.callWinRate + p.putWinRate) / 2, 0) / weeklyPatterns.length
    : 0;
    
  const monthlyWinRate = monthlyPatterns.length > 0
    ? monthlyPatterns.reduce((sum, p) => sum + (p.callWinRate + p.putWinRate) / 2, 0) / monthlyPatterns.length
    : 0;
  
  return {
    totalPatterns: patterns.length,
    bullishExpiries,
    bearishExpiries,
    neutralExpiries,
    overallSentiment,
    sentimentScore,
    topPerformingExpiry: sortedByPnL[0] || null,
    worstPerformingExpiry: sortedByPnL[sortedByPnL.length - 1] || null,
    weeklyWinRate,
    monthlyWinRate,
    upcomingSignals: [] // Can be populated with actual upcoming signals
  };
}

/**
 * Get expiry calendar view with pattern insights
 */
export async function getExpiryCalendar(
  startDate: Date,
  endDate: Date,
  portfolioId?: string
): Promise<Map<string, ExpiryPattern[]>> {
  const patterns = await analyzeExpiryPatterns(portfolioId, 365);
  
  const calendar = new Map<string, ExpiryPattern[]>();
  
  for (const pattern of patterns) {
    const expDate = new Date(pattern.expiryDate);
    if (expDate >= startDate && expDate <= endDate) {
      const dateKey = pattern.expiryDate;
      if (!calendar.has(dateKey)) {
        calendar.set(dateKey, []);
      }
      calendar.get(dateKey)!.push(pattern);
    }
  }
  
  return calendar;
}

logger.info('[EXPIRY-PATTERN] Expiry Pattern Analysis Service initialized');
