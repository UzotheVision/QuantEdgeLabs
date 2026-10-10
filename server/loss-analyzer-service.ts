import { storage } from "./storage";
import { 
  TradeDiagnostics, 
  InsertTradeDiagnostics, 
  LossCategory, 
  BotLearningState,
  PaperPosition
} from "@shared/schema";
import { getMarketContext } from "./market-context-service";
import { logger } from "./logger";

const BOT_LEARNING_ID = "bot-learning-state-v1";

interface TradeAnalysis {
  categories: LossCategory[];
  primaryCause: LossCategory;
  analysisNotes: string;
  remediationActions: {
    adjustStopMultiplier?: number;
    adjustConfidenceThreshold?: number;
    avoidSymbol?: boolean;
    avoidPattern?: string;
    reducePositionSize?: number;
  };
}

export async function analyzeTrade(position: PaperPosition): Promise<TradeDiagnostics | null> {
  try {
    if (!position.exitReason || position.status !== 'closed') {
      logger.debug(`[LOSS-ANALYZER] Skipping analysis for non-closed position ${position.id}`);
      return null;
    }

    const pnlPercent = position.realizedPnLPercent || 0;
    const pnlDollars = position.realizedPnL || 0;
    const outcome = pnlPercent >= 3 ? 'win' : (pnlPercent <= -3 ? 'loss' : 'breakeven');
    
    const marketContext = await getMarketContext();
    
    const entryDate = new Date(position.entryTime);
    const exitDate = position.exitTime ? new Date(position.exitTime) : new Date();
    const daysHeld = Math.ceil((exitDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
    
    let daysToExpiry = 0;
    if (position.expiryDate) {
      const expiry = new Date(position.expiryDate);
      daysToExpiry = Math.max(0, Math.ceil((expiry.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)));
    }
    
    const spyChange = marketContext.spyData?.change || 0;
    
    const entrySnapshot = {
      marketRegime: marketContext.regime || 'unknown',
      spyChange: spyChange,
      volumeRatio: 1.0,
      ivRank: undefined,
      daysToExpiry: daysToExpiry > 0 ? daysToExpiry : undefined,
      confidenceScore: (position as any).confidenceScore || 70,
      signalCount: 3,
      entryReason: (position as any).entryReason || 'bot_signal',
    };
    
    const peakPnL = (position as any).peakPnLPercent || Math.max(pnlPercent, 0);
    const drawdownFromPeak = peakPnL > 0 ? peakPnL - pnlPercent : 0;
    
    const exitTrigger = extractExitTrigger(position.exitReason || 'unknown');
    
    const exitSnapshot = {
      marketRegime: marketContext.regime || 'unknown',
      spyChange: spyChange,
      exitReason: position.exitReason || 'unknown',
      exitTrigger,
      daysHeld,
      maxProfitReached: peakPnL,
      drawdownFromPeak,
    };
    
    let analysis: TradeAnalysis;
    if (outcome === 'loss') {
      analysis = classifyLoss(position, entrySnapshot, exitSnapshot);
    } else if (outcome === 'win') {
      analysis = {
        categories: [],
        primaryCause: 'unknown',
        analysisNotes: `Win trade: +${pnlPercent.toFixed(1)}%. ${exitTrigger === 'hit_target' ? 'Target reached.' : 'Exited on ' + exitTrigger}`,
        remediationActions: {},
      };
    } else {
      analysis = {
        categories: [],
        primaryCause: 'unknown',
        analysisNotes: `Breakeven trade: ${pnlPercent.toFixed(1)}%. Minimal P&L.`,
        remediationActions: {},
      };
    }
    
    const patternHash = generatePatternHash(position, entrySnapshot);
    const similarLossCount = await countSimilarLosses(patternHash);
    
    const diagnostics: InsertTradeDiagnostics = {
      tradeId: position.id,
      tradeSource: 'bot',
      symbol: position.symbol,
      outcome,
      pnlPercent,
      pnlDollars,
      entrySnapshot,
      exitSnapshot,
      lossCategories: analysis.categories,
      primaryCause: analysis.primaryCause,
      analysisNotes: analysis.analysisNotes,
      remediationActions: analysis.remediationActions,
      patternHash,
      similarLossCount,
      reviewStatus: 'pending',
    };
    
    const saved = await storage.createTradeDiagnostics(diagnostics);
    
    if (outcome === 'loss') {
      await applyRemediationToLearningState(analysis, position.symbol, pnlPercent);
      
      if (similarLossCount >= 2) {
        await sendLossPatternAlert(position, analysis, similarLossCount);
      }
    }
    
    logger.info(`[LOSS-ANALYZER] Analyzed ${position.symbol}: ${outcome.toUpperCase()} (${pnlPercent.toFixed(1)}%) - Primary cause: ${analysis.primaryCause}`);
    
    return saved;
  } catch (error) {
    logger.error(`[LOSS-ANALYZER] Error analyzing trade:`, error);
    return null;
  }
}

function extractExitTrigger(exitReason: string): string {
  const lowerReason = exitReason.toLowerCase();
  if (lowerReason.includes('hit_stop') || lowerReason.includes('stop_loss')) return 'stop_loss';
  if (lowerReason.includes('hit_target') || lowerReason.includes('target')) return 'target';
  if (lowerReason.includes('trailing')) return 'trailing_stop';
  if (lowerReason.includes('expir')) return 'expiry';
  if (lowerReason.includes('manual')) return 'manual';
  if (lowerReason.includes('regime')) return 'regime_stop';
  if (lowerReason.includes('time')) return 'time_stop';
  // New classifications for bot exit reasons
  if (lowerReason.includes('momentum_fade')) return 'momentum_fade';
  if (lowerReason.includes('confluence exit')) return 'confluence_exit';
  if (lowerReason.includes('underwater')) return 'underwater_exit';
  if (lowerReason.includes('0dte') || lowerReason.includes('dte')) return 'dte_exit';
  if (lowerReason.includes('significant loss') || lowerReason.includes('mandatory exit')) return 'forced_exit';
  if (lowerReason.includes('neutral') || lowerReason.includes('mixed signal')) return 'mixed_signals';
  return 'unknown';
}

function classifyLoss(
  position: PaperPosition,
  entrySnapshot: any,
  exitSnapshot: any
): TradeAnalysis {
  const categories: LossCategory[] = [];
  let primaryCause: LossCategory = 'unknown';
  const notes: string[] = [];
  const remediation: TradeAnalysis['remediationActions'] = {};
  
  const exitTrigger = exitSnapshot.exitTrigger;
  const pnlPercent = position.realizedPnLPercent || 0;
  const daysHeld = exitSnapshot.daysHeld;
  const daysToExpiry = entrySnapshot.daysToExpiry || 99;
  const peakPnL = exitSnapshot.maxProfitReached || 0;
  const drawdown = exitSnapshot.drawdownFromPeak || 0;
  
  if (exitTrigger === 'stop_loss' && pnlPercent < -30) {
    categories.push('stop_too_loose');
    notes.push(`Large loss (${pnlPercent.toFixed(1)}%) suggests stop was too loose`);
    remediation.adjustStopMultiplier = 0.85;
  }
  
  if (exitTrigger === 'stop_loss' && peakPnL > 20 && pnlPercent < 0) {
    categories.push('stop_too_loose');
    notes.push(`Was up ${peakPnL.toFixed(1)}% but gave it all back - needed tighter trailing stop`);
    remediation.adjustStopMultiplier = 0.9;
  }
  
  if (exitTrigger === 'stop_loss' && Math.abs(pnlPercent) < 15 && daysHeld < 1) {
    // Regime-aware stop adjustment for quick stop-outs
    // Use market regime from snapshot or infer from regime name
    const regime = exitSnapshot.marketRegime || entrySnapshot.marketRegime || 'ranging';
    const isTrending = regime === 'trending_up' || regime === 'trending_down';
    const isRanging = regime === 'ranging';
    
    if (isRanging) {
      // Ranging market - stop was genuinely too tight
      categories.push('stop_too_tight');
      notes.push(`Quick stop-out in ranging market (regime: ${regime}) - stop was too tight`);
      remediation.adjustStopMultiplier = 1.1; // Loosen by 10%
    } else if (isTrending) {
      // Trending market - don't fight the trend, be more selective
      categories.push('direction_wrong');
      notes.push(`Quick stop-out in trending market (regime: ${regime}) - wrong side of trend`);
      remediation.adjustConfidenceThreshold = 15; // Much more selective
      remediation.adjustStopMultiplier = 0.95; // Actually tighten
    } else {
      // Transitional/volatile regime
      categories.push('stop_too_tight');
      notes.push(`Quick stop-out in volatile/transitional market (regime: ${regime})`);
      remediation.adjustConfidenceThreshold = 5;
    }
  }
  
  if (position.optionType && daysToExpiry <= 3 && pnlPercent < -15) {
    categories.push('theta_decay');
    notes.push(`Option lost significant value with ${daysToExpiry} DTE - theta decay likely factor`);
    remediation.avoidPattern = 'short_dte_hold';
  }
  
  const direction = position.direction || 'long';
  const spyChange = exitSnapshot.spyChange || 0;
  if ((direction === 'long' && spyChange < -1.5) || (direction === 'short' && spyChange > 1.5)) {
    categories.push('direction_wrong');
    notes.push(`Market moved ${spyChange > 0 ? '+' : ''}${spyChange.toFixed(1)}% against ${direction} position`);
    remediation.adjustConfidenceThreshold = 5;
  }
  
  const regime = exitSnapshot.marketRegime;
  const entryRegime = entrySnapshot.marketRegime;
  if (entryRegime !== regime) {
    categories.push('regime_shift');
    notes.push(`Market regime shifted from ${entryRegime} to ${regime} during trade`);
  }
  
  if (daysHeld === 0 && Math.abs(pnlPercent) > 20) {
    categories.push('timing_late');
    notes.push(`Large same-day loss suggests entered after move already happened`);
    remediation.adjustConfidenceThreshold = 10;
  }
  
  if (daysHeld > 5 && peakPnL < 10) {
    categories.push('timing_early');
    notes.push(`Held ${daysHeld} days but never saw significant profit - may have entered too early`);
  }
  
  if (entrySnapshot.confidenceScore < 65) {
    categories.push('chasing_entry');
    notes.push(`Low confidence entry (${entrySnapshot.confidenceScore}) - may have been chasing`);
    remediation.adjustConfidenceThreshold = 10;
  }
  
  // Handle bot-specific exit triggers for better classification
  if (exitTrigger === 'momentum_fade') {
    categories.push('direction_wrong');
    notes.push(`Momentum faded against position - market moved opposite to trade thesis`);
    remediation.adjustConfidenceThreshold = 10;
  }
  
  if (exitTrigger === 'confluence_exit' || exitTrigger === 'mixed_signals') {
    categories.push('timing_early');
    notes.push(`Confluence signals triggered early exit - entry may have been premature`);
    remediation.adjustConfidenceThreshold = 5;
  }
  
  if (exitTrigger === 'underwater_exit' || exitTrigger === 'dte_exit') {
    categories.push('theta_decay');
    notes.push(`Option went underwater near expiry - theta/time decay was primary factor`);
    remediation.avoidPattern = 'short_dte_hold';
  }
  
  if (exitTrigger === 'forced_exit') {
    categories.push('stop_too_loose');
    notes.push(`Forced exit due to significant loss - stop loss should have been tighter`);
    remediation.adjustStopMultiplier = 0.8;
  }
  
  // Check if confidence was below the recommended 80% threshold
  if (entrySnapshot.confidenceScore < 80 && entrySnapshot.confidenceScore >= 65) {
    categories.push('chasing_entry');
    notes.push(`Entry confidence ${entrySnapshot.confidenceScore}% below recommended 80% minimum`);
    remediation.adjustConfidenceThreshold = 10;
  }
  
  if (categories.length === 0) {
    categories.push('unknown');
    notes.push(`Loss cause unclear - needs manual review`);
  }
  
  const causeWeights: Record<LossCategory, number> = {
    'direction_wrong': 100,
    'regime_shift': 90,
    'theta_decay': 85,
    'iv_crush': 85,
    'stop_too_loose': 80,
    'timing_late': 75,
    'chasing_entry': 75,
    'timing_early': 70,
    'stop_too_tight': 65,
    'catalyst_failed': 60,
    'liquidity_issue': 50,
    'oversized_position': 40,
    'unknown': 0,
  };
  
  primaryCause = categories.reduce((prev, curr) => 
    (causeWeights[curr] > causeWeights[prev]) ? curr : prev
  , categories[0]);
  
  return {
    categories,
    primaryCause,
    analysisNotes: notes.join(' | '),
    remediationActions: remediation,
  };
}

function generatePatternHash(position: PaperPosition, entrySnapshot: any): string {
  const components = [
    entrySnapshot.marketRegime,
    position.optionType || 'stock',
    position.direction || 'long',
    Math.round((entrySnapshot.daysToExpiry || 0) / 3) * 3,
    entrySnapshot.confidenceScore > 80 ? 'high_conf' : 'normal_conf',
  ];
  return components.join('_');
}

async function countSimilarLosses(patternHash: string): Promise<number> {
  try {
    const diagnostics = await storage.getTradeDiagnosticsByPatternHash(patternHash);
    return diagnostics.filter(d => d.outcome === 'loss').length;
  } catch (error) {
    return 0;
  }
}

async function applyRemediationToLearningState(
  analysis: TradeAnalysis,
  symbol: string,
  pnlPercent: number = 0
): Promise<void> {
  try {
    let learningState = await storage.getBotLearningState(BOT_LEARNING_ID);
    
    if (!learningState) {
      learningState = await storage.createBotLearningState({
        confidenceThreshold: 50, // Lowered from 65 to allow more trades
        stopLossMultiplier: 1.0,
        positionSizeMultiplier: 1.0,
        symbolAdjustments: {},
        patternAdjustments: {},
        totalAnalyzed: 0,
        totalWins: 0,
        totalLosses: 0,
        adaptationsApplied: 0,
      });
    }
    
    const updates: Partial<BotLearningState> = {
      totalAnalyzed: (learningState.totalAnalyzed || 0) + 1,
      totalLosses: (learningState.totalLosses || 0) + 1,
    };
    
    if (analysis.remediationActions.adjustConfidenceThreshold) {
      const currentThreshold = learningState.confidenceThreshold || 50;
      updates.confidenceThreshold = Math.min(85, currentThreshold + 
        (analysis.remediationActions.adjustConfidenceThreshold * 0.3));
      updates.adaptationsApplied = (learningState.adaptationsApplied || 0) + 1;
    }
    
    if (analysis.remediationActions.adjustStopMultiplier) {
      const currentMultiplier = learningState.stopLossMultiplier || 1.0;
      const change = (analysis.remediationActions.adjustStopMultiplier - 1.0) * 0.2;
      updates.stopLossMultiplier = Math.max(0.7, Math.min(1.3, currentMultiplier + change));
      updates.adaptationsApplied = (learningState.adaptationsApplied || 0) + 1;
    }
    
    const symbolAdj = { ...(learningState.symbolAdjustments || {}) };
    if (!symbolAdj[symbol]) {
      symbolAdj[symbol] = {
        confidenceBoost: 0,
        lossStreak: 0,
        winRate: 50,
        recentLossMagnitudes: [],
      };
    }
    symbolAdj[symbol].lossStreak = (symbolAdj[symbol].lossStreak || 0) + 1;
    symbolAdj[symbol].confidenceBoost = Math.max(-20, (symbolAdj[symbol].confidenceBoost || 0) - 3);
    
    // Track recent loss magnitudes for dynamic cooldown
    const recentLosses = symbolAdj[symbol].recentLossMagnitudes || [];
    recentLosses.push(pnlPercent);
    if (recentLosses.length > 5) recentLosses.shift(); // Keep last 5
    symbolAdj[symbol].recentLossMagnitudes = recentLosses;
    
    // Dynamic cooldown based on loss magnitude
    if (symbolAdj[symbol].lossStreak >= 3) {
      const avgLossMagnitude = recentLosses.reduce((a: number, b: number) => a + b, 0) / recentLosses.length;
      const avoidUntil = new Date();
      
      let cooldownDays: number;
      if (avgLossMagnitude <= -15) {
        // Severe losses (avg > 15% loss) - 3 day cooldown
        cooldownDays = 3;
        logger.info(`[LOSS-ANALYZER] 🚫 SEVERE: Avoiding ${symbol} for 3 days (avg loss: ${avgLossMagnitude.toFixed(1)}%)`);
      } else if (avgLossMagnitude <= -8) {
        // Moderate losses (avg 8-15% loss) - 1 day cooldown
        cooldownDays = 1;
        logger.info(`[LOSS-ANALYZER] ⚠️ MODERATE: Avoiding ${symbol} for 1 day (avg loss: ${avgLossMagnitude.toFixed(1)}%)`);
      } else {
        // Small losses (avg < 8% loss) - no cooldown, just confidence penalty
        cooldownDays = 0;
        logger.info(`[LOSS-ANALYZER] 📉 MINOR: ${symbol} had 3 small losses (avg: ${avgLossMagnitude.toFixed(1)}%) - confidence penalty only`);
      }
      
      if (cooldownDays > 0) {
        avoidUntil.setDate(avoidUntil.getDate() + cooldownDays);
        symbolAdj[symbol].avoidUntil = avoidUntil.toISOString();
      }
    }
    
    updates.symbolAdjustments = symbolAdj;
    
    await storage.updateBotLearningState(BOT_LEARNING_ID, updates);
    
    logger.info(`[LOSS-ANALYZER] Applied remediation - Confidence threshold: ${updates.confidenceThreshold?.toFixed(1) || 'unchanged'}, Stop multiplier: ${updates.stopLossMultiplier?.toFixed(2) || 'unchanged'}`);
  } catch (error) {
    logger.error(`[LOSS-ANALYZER] Error applying remediation:`, error);
  }
}

export async function recordWin(position: PaperPosition): Promise<void> {
  try {
    let learningState = await storage.getBotLearningState(BOT_LEARNING_ID);
    
    if (!learningState) return;
    
    const symbol = position.symbol;
    const symbolAdj = { ...(learningState.symbolAdjustments || {}) };
    
    if (symbolAdj[symbol]) {
      symbolAdj[symbol].lossStreak = 0;
      symbolAdj[symbol].confidenceBoost = Math.min(10, (symbolAdj[symbol].confidenceBoost || 0) + 1);
      delete symbolAdj[symbol].avoidUntil;
    }
    
    await storage.updateBotLearningState(BOT_LEARNING_ID, {
      totalAnalyzed: (learningState.totalAnalyzed || 0) + 1,
      totalWins: (learningState.totalWins || 0) + 1,
      symbolAdjustments: symbolAdj,
    });
  } catch (error) {
    logger.error(`[LOSS-ANALYZER] Error recording win:`, error);
  }
}

async function sendLossPatternAlert(
  position: PaperPosition,
  analysis: TradeAnalysis,
  similarCount: number
): Promise<void> {
  try {
    const message = [
      `⚠️ [LOSS-ANALYZER] Recurring Loss Pattern Detected`,
      `Symbol: ${position.symbol}`,
      `Loss: ${(position.realizedPnLPercent || 0).toFixed(1)}%`,
      `Primary Cause: ${analysis.primaryCause.replace(/_/g, ' ')}`,
      `Similar Losses: ${similarCount} previous trades with same pattern`,
      `Analysis: ${analysis.analysisNotes}`,
      `Remediation Applied: ${Object.entries(analysis.remediationActions).map(([key, val]) => `${key}: ${val}`).join(', ')}`,
    ].join(' | ');
    
    logger.warn(message);
  } catch (error) {
    logger.error(`[LOSS-ANALYZER] Error sending loss pattern alert:`, error);
  }
}

export async function getLearningState(): Promise<BotLearningState | null> {
  return storage.getBotLearningState(BOT_LEARNING_ID);
}

export async function getSymbolAdjustment(symbol: string): Promise<{
  confidenceBoost: number;
  shouldAvoid: boolean;
  lossStreak: number;
  watchlistGrade?: string;
  isEliteSetup?: boolean;
  isPremiumOpportunity?: boolean;
}> {
  try {
    const state = await storage.getBotLearningState(BOT_LEARNING_ID);
    
    let baseBoost = 0;
    let shouldAvoid = false;
    let lossStreak = 0;
    
    if (state?.symbolAdjustments) {
      const adj = state.symbolAdjustments[symbol];
      if (adj) {
        baseBoost = adj.confidenceBoost || 0;
        shouldAvoid = adj.avoidUntil ? new Date(adj.avoidUntil) > new Date() : false;
        lossStreak = adj.lossStreak || 0;
      }
    }
    
    // 📊 WATCHLIST INTELLIGENCE: Apply confidence boost from watchlist grading
    let watchlistGrade: string | undefined;
    let isEliteSetup = false;
    let isPremiumOpportunity = false;
    
    try {
      const { getWatchlistConfidenceBoost } = await import('./watchlist-priority-service');
      const watchlistInsight = await getWatchlistConfidenceBoost(symbol);
      
      if (watchlistInsight.boost !== 0) {
        baseBoost += watchlistInsight.boost;
        watchlistGrade = watchlistInsight.isElite ? 'Elite' : undefined;
        isEliteSetup = watchlistInsight.isElite;
        isPremiumOpportunity = watchlistInsight.isPremiumOpportunity;
        
        if (watchlistInsight.reasons.length > 0) {
          logger.debug(`[LEARNING] ${symbol}: Watchlist boost +${watchlistInsight.boost} (${watchlistInsight.reasons.join(', ')})`);
        }
      }
    } catch (watchlistError) {
      // Watchlist intelligence is optional - continue without it
    }
    
    return {
      confidenceBoost: baseBoost,
      shouldAvoid,
      lossStreak,
      watchlistGrade,
      isEliteSetup,
      isPremiumOpportunity,
    };
  } catch (error) {
    return { confidenceBoost: 0, shouldAvoid: false, lossStreak: 0 };
  }
}

export async function getAdaptiveParameters(): Promise<{
  confidenceThreshold: number;
  stopLossMultiplier: number;
  positionSizeMultiplier: number;
}> {
  // STRICT A-GRADE MINIMUM: Never go below 75% confidence (restored Jan 2026 after losses)
  const MIN_CONFIDENCE_FLOOR = 75;
  const MAX_CONFIDENCE_REDUCTION = 5; // Cap adaptive reduction to -5 max
  
  try {
    const state = await storage.getBotLearningState(BOT_LEARNING_ID);
    
    // Start at A-grade floor (75%), adaptive can only adjust within limits
    let threshold = MIN_CONFIDENCE_FLOOR;
    if (state?.confidenceThreshold) {
      // Cap how much adaptive learning can LOWER the threshold
      const reduction = MIN_CONFIDENCE_FLOOR - state.confidenceThreshold;
      if (reduction > MAX_CONFIDENCE_REDUCTION) {
        threshold = MIN_CONFIDENCE_FLOOR; // Don't allow more than -5 reduction
      } else {
        threshold = Math.max(MIN_CONFIDENCE_FLOOR, state.confidenceThreshold);
      }
    }
    
    return {
      confidenceThreshold: threshold,
      stopLossMultiplier: Math.min(state?.stopLossMultiplier || 1.0, 1.2), // Cap stop widening at 1.2x
      positionSizeMultiplier: state?.positionSizeMultiplier || 1.0,
    };
  } catch (error) {
    return {
      confidenceThreshold: MIN_CONFIDENCE_FLOOR, // A-grade minimum
      stopLossMultiplier: 1.0,
      positionSizeMultiplier: 1.0,
    };
  }
}

export async function analyzeClosedTrades(limit: number = 50): Promise<{
  analyzed: number;
  wins: number;
  losses: number;
  breakeven: number;
  topLossCategories: { category: string; count: number }[];
}> {
  try {
    const recentTrades = await storage.getRecentClosedPositions(limit);
    
    let analyzed = 0;
    let wins = 0;
    let losses = 0;
    let breakeven = 0;
    const categoryCount: Record<string, number> = {};
    
    for (const trade of recentTrades) {
      const existing = await storage.getTradeDiagnosticsByTradeId(trade.id);
      if (existing) continue;
      
      const diagnostics = await analyzeTrade(trade);
      if (diagnostics) {
        analyzed++;
        if (diagnostics.outcome === 'win') wins++;
        else if (diagnostics.outcome === 'loss') losses++;
        else breakeven++;
        
        if (diagnostics.primaryCause) {
          categoryCount[diagnostics.primaryCause] = (categoryCount[diagnostics.primaryCause] || 0) + 1;
        }
      }
    }
    
    const topLossCategories = Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));
    
    return { analyzed, wins, losses, breakeven, topLossCategories };
  } catch (error) {
    logger.error(`[LOSS-ANALYZER] Error in batch analysis:`, error);
    return { analyzed: 0, wins: 0, losses: 0, breakeven: 0, topLossCategories: [] };
  }
}

export async function getLossPatternSummary(): Promise<{
  totalLosses: number;
  topPatterns: { pattern: string; count: number; avgLoss: number }[];
  symbolPerformance: { symbol: string; wins: number; losses: number; winRate: number }[];
  recentAdaptations: string[];
}> {
  try {
    const diagnostics = await storage.getAllTradeDiagnostics();
    const losses = diagnostics.filter(d => d.outcome === 'loss');
    
    const patternCounts: Record<string, { count: number; totalLoss: number }> = {};
    for (const loss of losses) {
      const pattern = loss.primaryCause || 'unknown';
      if (!patternCounts[pattern]) {
        patternCounts[pattern] = { count: 0, totalLoss: 0 };
      }
      patternCounts[pattern].count++;
      patternCounts[pattern].totalLoss += loss.pnlPercent;
    }
    
    const topPatterns = Object.entries(patternCounts)
      .map(([pattern, data]) => ({
        pattern,
        count: data.count,
        avgLoss: data.count > 0 ? data.totalLoss / data.count : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    const symbolStats: Record<string, { wins: number; losses: number }> = {};
    for (const d of diagnostics) {
      if (!symbolStats[d.symbol]) {
        symbolStats[d.symbol] = { wins: 0, losses: 0 };
      }
      if (d.outcome === 'win') symbolStats[d.symbol].wins++;
      else if (d.outcome === 'loss') symbolStats[d.symbol].losses++;
    }
    
    const symbolPerformance = Object.entries(symbolStats)
      .map(([symbol, stats]) => ({
        symbol,
        wins: stats.wins,
        losses: stats.losses,
        winRate: stats.wins + stats.losses > 0 
          ? (stats.wins / (stats.wins + stats.losses)) * 100 
          : 0,
      }))
      .filter(s => s.wins + s.losses >= 3)
      .sort((a, b) => b.winRate - a.winRate);
    
    const state = await storage.getBotLearningState(BOT_LEARNING_ID);
    const recentAdaptations: string[] = [];
    
    if (state) {
      if (state.confidenceThreshold && state.confidenceThreshold !== 50) {
        recentAdaptations.push(`Confidence threshold adjusted to ${state.confidenceThreshold.toFixed(1)}%`);
      }
      if (state.stopLossMultiplier && state.stopLossMultiplier !== 1.0) {
        recentAdaptations.push(`Stop loss multiplier adjusted to ${state.stopLossMultiplier.toFixed(2)}x`);
      }
      
      if (state.symbolAdjustments) {
        for (const [symbol, adj] of Object.entries(state.symbolAdjustments)) {
          if (adj.avoidUntil && new Date(adj.avoidUntil) > new Date()) {
            recentAdaptations.push(`Avoiding ${symbol} until ${adj.avoidUntil.split('T')[0]}`);
          }
        }
      }
    }
    
    return {
      totalLosses: losses.length,
      topPatterns,
      symbolPerformance,
      recentAdaptations,
    };
  } catch (error) {
    logger.error(`[LOSS-ANALYZER] Error getting loss summary:`, error);
    return {
      totalLosses: 0,
      topPatterns: [],
      symbolPerformance: [],
      recentAdaptations: [],
    };
  }
}
