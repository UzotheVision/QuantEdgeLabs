import { storage } from "./storage";
import type { TradeIdea, InsertLossAnalysis, LossReasonCategory, LossSeverity } from "@shared/schema";
import { logger as mainLogger } from "./logger";

const logger = mainLogger.child({ module: "loss-analyzer" });

// Analyze a failed trade and determine the loss reason
export async function analyzeLoss(trade: TradeIdea): Promise<InsertLossAnalysis | null> {
  if (trade.outcomeStatus !== 'hit_stop') {
    logger.warn(`Trade ${trade.id} is not a loss, skipping analysis`);
    return null;
  }

  // Validate required fields are present
  if (!trade.id || !trade.symbol || !trade.entryPrice) {
    logger.warn(`Trade ${trade.id} missing required fields for loss analysis`);
    return null;
  }

  // Check if already analyzed
  try {
    const existing = await storage.getLossAnalysisByTradeId(trade.id);
    if (existing) {
      logger.info(`Trade ${trade.id} already has loss analysis`);
      return null;
    }
  } catch (err) {
    // If table doesn't exist yet, continue with analysis
    logger.debug(`Loss analysis check failed, continuing: ${err}`);
  }

  // Calculate exit price - use exitPrice if available, otherwise use stopLoss
  const exitPrice = trade.exitPrice ?? trade.stopLoss;
  if (!exitPrice) {
    logger.warn(`Trade ${trade.id} has no exit price or stop loss, skipping analysis`);
    return null;
  }

  // Calculate percent loss - use percentGain if available, otherwise calculate from prices
  let percentLoss = trade.percentGain ?? null;
  if (percentLoss === null && trade.entryPrice > 0) {
    percentLoss = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
  }
  if (percentLoss === null) {
    percentLoss = 0;
  }

  const holdingMinutes = trade.actualHoldingTimeMinutes ?? 0;
  
  // Determine loss severity
  let severity: LossSeverity = 'moderate';
  if (percentLoss >= -2) severity = 'minor';
  else if (percentLoss >= -5) severity = 'moderate';
  else if (percentLoss >= -10) severity = 'significant';
  else severity = 'severe';

  // Analyze what went wrong based on available context
  const lossReason = determineLossReason(trade);
  const whatWentWrong = generateWhatWentWrong(trade, lossReason);
  const lessonsLearned = generateLessonsLearned(lossReason, trade);
  const preventionStrategy = generatePreventionStrategy(lossReason);

  // Determine time of day - safely handle invalid timestamps
  let timeOfDay = 'mid-day';
  let dayOfWeek = 'Unknown';
  
  if (trade.timestamp) {
    const tradeTime = new Date(trade.timestamp);
    if (!isNaN(tradeTime.getTime())) {
      const hour = tradeTime.getHours();
      if (hour >= 9 && hour < 11) timeOfDay = 'opening';
      else if (hour >= 14) timeOfDay = 'closing';
      
      dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][tradeTime.getDay()] || 'Unknown';
    }
  }

  const analysis: InsertLossAnalysis = {
    tradeIdeaId: trade.id,
    symbol: trade.symbol,
    engine: trade.source || 'unknown',
    assetType: trade.assetType || 'stock',
    direction: trade.direction || 'long',
    confidenceScore: trade.confidenceScore ?? null,
    probabilityBand: trade.probabilityBand ?? null,
    entryPrice: trade.entryPrice,
    exitPrice,
    percentLoss,
    dollarLoss: null, // Position size not tracked
    holdingTimeMinutes: holdingMinutes,
    lossReason,
    severity,
    marketConditionAtEntry: null, // Could be enriched with market data
    vixLevelAtEntry: null,
    sectorPerformance: null,
    timeOfDay,
    dayOfWeek,
    whatWentWrong,
    lessonsLearned,
    preventionStrategy,
    isPatternMatch: false,
    patternType: null,
    similarLosses: null,
    aiAnalysis: null,
    aiRecommendations: null,
    analyzedBy: 'system',
    reviewedByUser: false,
  };

  logger.info(`📉 Loss analysis created for ${trade.symbol}: ${lossReason} (${severity})`);
  
  return analysis;
}

// Determine the primary reason for the loss
function determineLossReason(trade: TradeIdea): LossReasonCategory {
  // Calculate percentLoss from exitPrice/stopLoss and entryPrice if not available
  let percentLoss = trade.percentGain ?? 0;
  if (percentLoss === 0 && trade.entryPrice > 0) {
    const exitPrice = trade.exitPrice ?? trade.stopLoss ?? trade.entryPrice;
    percentLoss = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
  }
  
  const holdingMinutes = trade.actualHoldingTimeMinutes ?? 0;
  const confidenceScore = trade.confidenceScore ?? 0;
  const assetType = trade.assetType || 'stock';
  const source = trade.source || 'unknown';

  // Options-specific issues
  if (assetType === 'option') {
    if (holdingMinutes > 360) { // Held options more than 6 hours
      return 'options_decay';
    }
    if (percentLoss < -50) { // Massive options loss
      return 'volatility_crush';
    }
  }

  // High confidence but still lost - overconfident signal
  if (confidenceScore >= 75) {
    return 'overconfident_signal';
  }

  // Very quick loss (within 30 minutes) - bad timing
  if (holdingMinutes < 30 && percentLoss < -3) {
    return 'bad_timing';
  }

  // Penny stocks / low volume
  if (trade.liquidityWarning) {
    return 'low_volume_trap';
  }

  // News-based trades that failed
  if (trade.catalyst && trade.catalyst.toLowerCase().includes('news')) {
    return 'news_catalyst_failed';
  }

  // Stop was very close to entry (within 2%) - only check if stopLoss is defined
  if (trade.stopLoss && trade.entryPrice > 0) {
    const stopDistance = Math.abs((trade.stopLoss - trade.entryPrice) / trade.entryPrice) * 100;
    if (stopDistance < 2 && !isNaN(stopDistance)) {
      return 'stop_too_tight';
    }
  }

  // Engine-specific patterns
  if (source === 'quant' && percentLoss < -5) {
    return 'technical_breakdown';
  }

  if (source === 'ai' && confidenceScore > 60) {
    return 'fundamental_miss';
  }

  // Default to market reversal for unexplained losses
  return 'market_reversal';
}

// Generate detailed explanation of what went wrong
function generateWhatWentWrong(trade: TradeIdea, reason: LossReasonCategory): string {
  const symbol = trade.symbol;
  const percentLoss = trade.percentGain?.toFixed(2) || '0';
  const confidence = trade.confidenceScore?.toFixed(0) || '0';
  const engine = trade.source?.toUpperCase() || 'UNKNOWN';

  const explanations: Record<LossReasonCategory, string> = {
    market_reversal: `${symbol} reversed against the ${trade.direction} position despite favorable setup. Entry at ${trade.entryPrice} but market turned and hit stop at ${trade.stopLoss}. Loss: ${percentLoss}%`,
    sector_weakness: `${symbol} was dragged down by sector-wide weakness. Even with good individual signals, the sector headwind was too strong.`,
    bad_timing: `Entry timing was poor for ${symbol}. The trade hit the stop within the first 30 minutes, suggesting the entry was at a local extreme.`,
    news_catalyst_failed: `The expected news catalyst for ${symbol} did not materialize or the market reaction was opposite to expectations.`,
    stop_too_tight: `Stop loss was set too tight for ${symbol}. Normal volatility triggered the stop before the trade idea could work.`,
    overconfident_signal: `${engine} engine gave ${confidence}% confidence but the trade still failed. High confidence ≠ guaranteed win. ${symbol} loss: ${percentLoss}%`,
    low_volume_trap: `${symbol} had liquidity warning. Got trapped in a low-volume name with wide spreads and difficulty exiting.`,
    gap_down_open: `${symbol} gapped down at open, blowing past the stop loss before any action could be taken.`,
    trend_exhaustion: `${symbol} was bought/sold at trend exhaustion. The move was already extended when the trade was entered.`,
    fundamental_miss: `AI analysis missed a fundamental red flag in ${symbol}. The fundamental thesis was incorrect.`,
    technical_breakdown: `Key technical level failed in ${symbol}. The expected support/resistance did not hold.`,
    options_decay: `Theta decay ate into the ${symbol} options position. Held too long without sufficient directional move.`,
    volatility_crush: `IV crush after the catalyst destroyed option premium in ${symbol}. Directional move wasn't enough to overcome IV drop.`,
    correlation_blindspot: `Did not account for ${symbol}'s correlation with other positions or market factors.`,
    unknown: `Unable to determine specific cause of loss in ${symbol}. Requires manual review.`,
  };

  return explanations[reason] || explanations.unknown;
}

// Generate lessons learned from this loss
function generateLessonsLearned(reason: LossReasonCategory, trade: TradeIdea): string {
  const lessons: Record<LossReasonCategory, string> = {
    market_reversal: "Check broader market trend before entry. Consider reducing position size when market is choppy.",
    sector_weakness: "Always check sector ETF performance before trading individual names in that sector.",
    bad_timing: "Wait for confirmation of direction before entering. Avoid chasing extended moves.",
    news_catalyst_failed: "News catalyst trades are binary - size accordingly. Consider using options to limit downside.",
    stop_too_tight: "Use ATR-based stops that account for normal volatility. Minimum stop should be 1-1.5 ATR.",
    overconfident_signal: "High confidence scores require extra validation. Never trust any single signal blindly.",
    low_volume_trap: "Avoid stocks with liquidity warnings. Check average volume before trading.",
    gap_down_open: "Use overnight stop limits or avoid holding positions overnight in volatile names.",
    trend_exhaustion: "Check RSI and momentum indicators before entry. Avoid buying at 52-week highs without consolidation.",
    fundamental_miss: "Verify AI analysis with independent fundamental research. Check for recent 8-K filings.",
    technical_breakdown: "Use multiple timeframes for support/resistance. Single timeframe analysis is insufficient.",
    options_decay: "Set strict time limits on options positions. Exit quickly if thesis isn't working.",
    volatility_crush: "Check IV percentile before buying options. Prefer selling premium when IV is elevated.",
    correlation_blindspot: "Track portfolio beta exposure. Avoid correlated positions that amplify drawdowns.",
    unknown: "Conduct thorough post-mortem to identify specific failure mode.",
  };

  return lessons[reason] || lessons.unknown;
}

// Generate prevention strategy
function generatePreventionStrategy(reason: LossReasonCategory): string {
  const strategies: Record<LossReasonCategory, string> = {
    market_reversal: "Add market regime filter: avoid new longs when SPY is below 20-day MA or VIX is above 25.",
    sector_weakness: "Require sector ETF to be above VWAP before taking sector-related trades.",
    bad_timing: "Wait 15 minutes after market open. Require 5-minute candle confirmation before entry.",
    news_catalyst_failed: "Limit news-catalyst position sizes to 50% normal. Use defined-risk options strategies.",
    stop_too_tight: "Minimum stop distance = 1.5x 14-period ATR. Recalculate position size accordingly.",
    overconfident_signal: "Cap effective confidence at 75% regardless of engine output. Always size for potential loss.",
    low_volume_trap: "Hard filter: no trades on stocks with avg volume < 500K or ADV < $5M.",
    gap_down_open: "Exit all positions before earnings/events. Use conditional orders for overnight protection.",
    trend_exhaustion: "Require RSI(14) < 70 for longs, > 30 for shorts. No entries at 20-day highs/lows.",
    fundamental_miss: "Cross-check AI analysis with recent SEC filings. Flag any recent insider selling.",
    technical_breakdown: "Require 3+ timeframe confluence. If only 1 timeframe shows level, skip trade.",
    options_decay: "Max options holding time: 2 days for weeklies, 5 days for monthlies without profit.",
    volatility_crush: "Only buy options when IV percentile < 30. Prefer spreads to limit vega exposure.",
    correlation_blindspot: "Track rolling 20-day correlation with SPY. Limit correlated positions.",
    unknown: "Flag for manual review. Add to analysis queue.",
  };

  return strategies[reason] || strategies.unknown;
}

// Analyze all unanalyzed losses in the database
export async function analyzeAllLosses(): Promise<number> {
  const allIdeas = await storage.getAllTradeIdeas();
  const losses = allIdeas.filter(t => t.outcomeStatus === 'hit_stop');
  
  let analyzed = 0;
  
  for (const trade of losses) {
    try {
      const analysis = await analyzeLoss(trade);
      if (analysis) {
        await storage.createLossAnalysis(analysis);
        analyzed++;
      }
    } catch (error) {
      logger.error(`Failed to analyze loss for trade ${trade.id}:`, error);
    }
  }
  
  logger.info(`📊 Analyzed ${analyzed} losses out of ${losses.length} total`);
  return analyzed;
}

// Get loss pattern summary
export async function getLossSummary(): Promise<{
  totalLosses: number;
  totalLossAmount: number;
  avgLoss: number;
  topReasons: { reason: string; count: number; avgLoss: number }[];
  worstSymbols: { symbol: string; count: number; totalLoss: number }[];
  engineBreakdown: { engine: string; count: number; avgLoss: number }[];
}> {
  const analyses = await storage.getAllLossAnalyses();
  
  if (analyses.length === 0) {
    return {
      totalLosses: 0,
      totalLossAmount: 0,
      avgLoss: 0,
      topReasons: [],
      worstSymbols: [],
      engineBreakdown: [],
    };
  }
  
  const totalLossAmount = analyses.reduce((sum, a) => sum + (a.percentLoss || 0), 0);
  
  // Group by reason
  const reasonMap = new Map<string, { count: number; totalLoss: number }>();
  analyses.forEach(a => {
    const reason = a.lossReason || 'unknown';
    const existing = reasonMap.get(reason) || { count: 0, totalLoss: 0 };
    existing.count++;
    existing.totalLoss += a.percentLoss || 0;
    reasonMap.set(reason, existing);
  });
  
  const topReasons = Array.from(reasonMap.entries())
    .map(([reason, data]) => ({
      reason,
      count: data.count,
      avgLoss: data.totalLoss / data.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  
  // Group by symbol
  const symbolMap = new Map<string, { count: number; totalLoss: number }>();
  analyses.forEach(a => {
    const existing = symbolMap.get(a.symbol) || { count: 0, totalLoss: 0 };
    existing.count++;
    existing.totalLoss += a.percentLoss || 0;
    symbolMap.set(a.symbol, existing);
  });
  
  const worstSymbols = Array.from(symbolMap.entries())
    .map(([symbol, data]) => ({
      symbol,
      count: data.count,
      totalLoss: data.totalLoss,
    }))
    .sort((a, b) => a.totalLoss - b.totalLoss) // Most negative first
    .slice(0, 10);
  
  // Group by engine
  const engineMap = new Map<string, { count: number; totalLoss: number }>();
  analyses.forEach(a => {
    const engine = a.engine || 'unknown';
    const existing = engineMap.get(engine) || { count: 0, totalLoss: 0 };
    existing.count++;
    existing.totalLoss += a.percentLoss || 0;
    engineMap.set(engine, existing);
  });
  
  const engineBreakdown = Array.from(engineMap.entries())
    .map(([engine, data]) => ({
      engine,
      count: data.count,
      avgLoss: data.totalLoss / data.count,
    }))
    .sort((a, b) => b.count - a.count);
  
  return {
    totalLosses: analyses.length,
    totalLossAmount,
    avgLoss: totalLossAmount / analyses.length,
    topReasons,
    worstSymbols,
    engineBreakdown,
  };
}
