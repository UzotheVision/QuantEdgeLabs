/**
 * QuantEdge Insight Service
 *
 * Provides contextual insights across the platform by synthesizing
 * data from existing analysis engines. Does NOT duplicate analysis -
 * purely synthesizes and contextualizes.
 *
 * Used by: Trade Desk, Charts, Search, Movers, Watchlist
 */

import { runResearchGradeEvaluation, type ResearchGradeReport } from './research-grade-evaluator';
import { classifyMarketRegime, runQuantitativeAnalysis, type RegimeClassification, type QuantAnalysisReport } from './quantitative-analysis-engine';
import { db } from './db';
import { tradeIdeas } from '../shared/schema';
import { desc, gte, isNotNull, and, eq } from 'drizzle-orm';

// Insight types
export interface ContextualInsight {
  text: string;
  type: 'info' | 'bullish' | 'bearish' | 'warning' | 'neutral';
  confidence?: number;
}

export interface MarketContext {
  regime: string;
  regimeLabel: string;
  riskLevel: 'low' | 'moderate' | 'elevated' | 'high' | 'extreme';
  bias: 'long' | 'short' | 'neutral';
  vix?: number;
}

export interface PlatformContext {
  topEngine: string | null;
  topEngineWinRate: number;
  recentPerformance: 'strong' | 'moderate' | 'weak';
  isStatisticallySignificant: boolean;
}

// Cache for expensive computations (5 min TTL)
let cachedMarketContext: { data: MarketContext; timestamp: number } | null = null;
let cachedPlatformContext: { data: PlatformContext; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get current market context (regime, risk, bias)
 */
export async function getMarketContext(): Promise<MarketContext> {
  const now = Date.now();
  if (cachedMarketContext && now - cachedMarketContext.timestamp < CACHE_TTL) {
    return cachedMarketContext.data;
  }

  try {
    const regimeData = await classifyMarketRegime();
    const currentRegime = regimeData.current;

    // Determine risk level from regime
    let riskLevel: MarketContext['riskLevel'] = 'moderate';
    if (currentRegime === 'CRISIS' || currentRegime === 'HIGH_VOLATILITY') {
      riskLevel = 'high';
    } else if (currentRegime === 'STRONG_DOWNTREND') {
      riskLevel = 'elevated';
    } else if (currentRegime === 'LOW_VOLATILITY' || currentRegime === 'STRONG_UPTREND') {
      riskLevel = 'low';
    }

    // Determine bias from regime
    let bias: MarketContext['bias'] = 'neutral';
    if (currentRegime.includes('UPTREND')) {
      bias = 'long';
    } else if (currentRegime.includes('DOWNTREND')) {
      bias = 'short';
    }

    // Friendly regime labels
    const regimeLabels: Record<string, string> = {
      'STRONG_UPTREND': 'Strong Uptrend',
      'WEAK_UPTREND': 'Mild Uptrend',
      'STRONG_DOWNTREND': 'Strong Downtrend',
      'WEAK_DOWNTREND': 'Mild Downtrend',
      'RANGING_HIGH_VOL': 'Volatile Range',
      'RANGING_LOW_VOL': 'Quiet Range',
      'HIGH_VOLATILITY': 'High Volatility',
      'LOW_VOLATILITY': 'Low Volatility',
      'CRISIS': 'Crisis Mode',
      'UNKNOWN': 'Unclear',
    };

    const context: MarketContext = {
      regime: currentRegime,
      regimeLabel: regimeLabels[currentRegime] || currentRegime,
      riskLevel,
      bias,
      vix: regimeData.indicators?.vix,
    };

    cachedMarketContext = { data: context, timestamp: now };
    return context;
  } catch (e) {
    console.error('Failed to get market context:', e);
    return {
      regime: 'UNKNOWN',
      regimeLabel: 'Unknown',
      riskLevel: 'moderate',
      bias: 'neutral',
    };
  }
}

/**
 * Get platform performance context
 */
export async function getPlatformContext(): Promise<PlatformContext> {
  const now = Date.now();
  if (cachedPlatformContext && now - cachedPlatformContext.timestamp < CACHE_TTL) {
    return cachedPlatformContext.data;
  }

  try {
    const researchEval = await runResearchGradeEvaluation(30);

    // Calculate engine performance
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const decidedTrades = await db
      .select()
      .from(tradeIdeas)
      .where(
        and(
          gte(tradeIdeas.timestamp, startDate.toISOString()),
          isNotNull(tradeIdeas.outcomeStatus)
        )
      );

    // Group by engine
    const engineStats: Record<string, { wins: number; total: number }> = {};
    for (const trade of decidedTrades) {
      const engine = trade.source || 'unknown';
      if (!engineStats[engine]) {
        engineStats[engine] = { wins: 0, total: 0 };
      }
      engineStats[engine].total++;
      if (trade.outcomeStatus === 'hit_target') {
        engineStats[engine].wins++;
      }
    }

    // Find top engine
    let topEngine: string | null = null;
    let topEngineWinRate = 0;
    for (const [engine, stats] of Object.entries(engineStats)) {
      if (stats.total >= 5) {
        const winRate = (stats.wins / stats.total) * 100;
        if (winRate > topEngineWinRate) {
          topEngineWinRate = winRate;
          topEngine = engine;
        }
      }
    }

    // Determine recent performance
    const overallWinRate = researchEval?.winRate || 0;
    let recentPerformance: PlatformContext['recentPerformance'] = 'moderate';
    if (overallWinRate >= 60) recentPerformance = 'strong';
    else if (overallWinRate < 45) recentPerformance = 'weak';

    const context: PlatformContext = {
      topEngine,
      topEngineWinRate: Math.round(topEngineWinRate),
      recentPerformance,
      isStatisticallySignificant:
        researchEval?.statistics?.sampleSizeAdequate === true &&
        (researchEval?.statistics?.winRatePValue || 1) < 0.05,
    };

    cachedPlatformContext = { data: context, timestamp: now };
    return context;
  } catch (e) {
    console.error('Failed to get platform context:', e);
    return {
      topEngine: null,
      topEngineWinRate: 0,
      recentPerformance: 'moderate',
      isStatisticallySignificant: false,
    };
  }
}

/**
 * Get contextual insights for Trade Desk
 */
export async function getTradeDeskInsights(): Promise<ContextualInsight[]> {
  const insights: ContextualInsight[] = [];

  const [market, platform] = await Promise.all([
    getMarketContext(),
    getPlatformContext(),
  ]);

  // Market regime insight
  if (market.regime !== 'UNKNOWN') {
    insights.push({
      text: `${market.regimeLabel} regime`,
      type: market.bias === 'long' ? 'bullish' : market.bias === 'short' ? 'bearish' : 'neutral',
    });
  }

  // Bias insight
  if (market.bias !== 'neutral') {
    insights.push({
      text: market.bias === 'long' ? 'Favor long setups' : 'Favor short setups',
      type: market.bias === 'long' ? 'bullish' : 'bearish',
    });
  }

  // Top engine insight
  if (platform.topEngine && platform.topEngineWinRate >= 55) {
    insights.push({
      text: `${platform.topEngine} engine: ${platform.topEngineWinRate}% win rate`,
      type: 'info',
      confidence: platform.topEngineWinRate,
    });
  }

  // Risk warning
  if (market.riskLevel === 'high' || market.riskLevel === 'extreme') {
    insights.push({
      text: 'Elevated risk environment',
      type: 'warning',
    });
  }

  return insights.slice(0, 3); // Max 3 insights
}

/**
 * Get contextual insights for a specific stock
 */
export async function getStockInsights(symbol: string): Promise<ContextualInsight[]> {
  const insights: ContextualInsight[] = [];
  const market = await getMarketContext();

  // Check if we have trade ideas for this symbol
  const recentIdeas = await db
    .select()
    .from(tradeIdeas)
    .where(eq(tradeIdeas.symbol, symbol.toUpperCase()))
    .orderBy(desc(tradeIdeas.timestamp))
    .limit(5);

  if (recentIdeas.length > 0) {
    const latestIdea = recentIdeas[0];
    insights.push({
      text: `${latestIdea.direction.toUpperCase()} idea: ${latestIdea.confidenceScore}% confidence`,
      type: latestIdea.direction === 'long' ? 'bullish' : 'bearish',
      confidence: latestIdea.confidenceScore,
    });

    // Check if direction aligns with market
    if (market.bias !== 'neutral') {
      const aligned =
        (market.bias === 'long' && latestIdea.direction === 'long') ||
        (market.bias === 'short' && latestIdea.direction === 'short');

      if (aligned) {
        insights.push({
          text: 'Aligns with market regime',
          type: 'bullish',
        });
      } else {
        insights.push({
          text: 'Counter to market regime',
          type: 'warning',
        });
      }
    }
  }

  // Check historical performance on this symbol
  const decidedTrades = recentIdeas.filter(t => t.outcomeStatus);
  if (decidedTrades.length >= 3) {
    const wins = decidedTrades.filter(t => t.outcomeStatus === 'hit_target').length;
    const winRate = Math.round((wins / decidedTrades.length) * 100);
    insights.push({
      text: `${winRate}% historical accuracy on ${symbol}`,
      type: winRate >= 60 ? 'bullish' : winRate < 40 ? 'bearish' : 'neutral',
    });
  }

  return insights.slice(0, 3);
}

/**
 * Get contextual insights for movers/trending
 */
export async function getMoversInsights(): Promise<ContextualInsight[]> {
  const insights: ContextualInsight[] = [];
  const market = await getMarketContext();

  insights.push({
    text: `Market: ${market.regimeLabel}`,
    type: market.bias === 'long' ? 'bullish' : market.bias === 'short' ? 'bearish' : 'neutral',
  });

  if (market.riskLevel === 'high' || market.riskLevel === 'extreme') {
    insights.push({
      text: 'High volatility - size positions carefully',
      type: 'warning',
    });
  } else if (market.riskLevel === 'low') {
    insights.push({
      text: 'Low volatility environment',
      type: 'info',
    });
  }

  return insights;
}

/**
 * Get insights for search results
 */
export async function getSearchInsights(symbols: string[]): Promise<ContextualInsight[]> {
  const insights: ContextualInsight[] = [];

  if (symbols.length === 0) return insights;

  // Check how many have active (open) ideas
  const activeIdeas = await db
    .select()
    .from(tradeIdeas)
    .where(eq(tradeIdeas.outcomeStatus, 'open'));

  const symbolsWithIdeas = new Set(activeIdeas.map(i => i.symbol));
  const matchCount = symbols.filter(s => symbolsWithIdeas.has(s.toUpperCase())).length;

  if (matchCount > 0) {
    insights.push({
      text: `${matchCount} result${matchCount > 1 ? 's have' : ' has'} active trade ideas`,
      type: 'info',
    });
  }

  return insights;
}

/**
 * Get a quick market summary (for headers/status bars)
 */
export async function getQuickSummary(): Promise<{
  regime: string;
  bias: string;
  risk: string;
}> {
  const market = await getMarketContext();
  return {
    regime: market.regimeLabel,
    bias: market.bias === 'long' ? 'Long' : market.bias === 'short' ? 'Short' : 'Neutral',
    risk: market.riskLevel.charAt(0).toUpperCase() + market.riskLevel.slice(1),
  };
}
