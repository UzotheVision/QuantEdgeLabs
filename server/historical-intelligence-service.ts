import { db } from './db';
import { 
  tradeIdeas, 
  symbolBehaviorProfiles, 
  symbolCatalystResponses, 
  confidenceCalibration,
  historicalIntelligenceSummary,
  type TradeIdea,
  type SymbolBehaviorProfile,
  type CatalystCategory,
  type OutcomeStatus
} from '@shared/schema';
import { eq, sql, desc, and, gte, isNotNull, ne } from 'drizzle-orm';
import { logger } from './logger';

// Catalyst keyword mappings for auto-categorization
const CATALYST_KEYWORDS: Record<CatalystCategory, string[]> = {
  earnings: ['earnings', 'eps', 'revenue', 'quarterly', 'annual report', 'guidance', 'beat', 'miss'],
  fda_approval: ['fda', 'approval', 'drug', 'clinical trial', 'phase', 'therapeutic'],
  government_contract: ['government', 'contract', 'dod', 'pentagon', 'defense', 'federal', 'military'],
  merger_acquisition: ['merger', 'acquisition', 'buyout', 'takeover', 'm&a', 'consolidation'],
  product_launch: ['launch', 'product', 'release', 'unveil', 'announcement', 'new product'],
  analyst_upgrade: ['upgrade', 'buy rating', 'outperform', 'price target raised'],
  analyst_downgrade: ['downgrade', 'sell rating', 'underperform', 'price target lowered'],
  insider_buying: ['insider buying', 'insider purchase', 'ceo bought', 'director bought'],
  insider_selling: ['insider selling', 'insider sale', 'ceo sold', 'director sold'],
  technical_breakout: ['breakout', 'resistance', 'support', 'technical', 'chart pattern', 'golden cross'],
  momentum_surge: ['momentum', 'surge', 'spike', 'volume spike', 'unusual volume', 'flow'],
  sector_rotation: ['sector', 'rotation', 'industry trend', 'sector momentum'],
  macro_event: ['fed', 'fomc', 'interest rate', 'inflation', 'cpi', 'jobs report', 'gdp'],
  ai_news: ['ai', 'artificial intelligence', 'machine learning', 'nvidia', 'gpu', 'data center'],
  quantum_news: ['quantum', 'qubit', 'ionq', 'rigetti', 'quantum computing'],
  crypto_news: ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'defi', 'nft'],
  other: []
};

export interface HistoricalPerformanceStats {
  overall: {
    totalIdeas: number;
    closedIdeas: number;
    wins: number;
    losses: number;
    breakevens: number;
    winRate: number;
    totalPnL: number;
    avgPnLPercent: number;
    profitFactor: number;
  };
  bySource: Record<string, { ideas: number; wins: number; winRate: number; pnl: number }>;
  byAssetType: Record<string, { ideas: number; wins: number; winRate: number; pnl: number }>;
  byDirection: Record<string, { ideas: number; wins: number; winRate: number; pnl: number }>;
  byCatalyst: { catalyst: string; ideas: number; wins: number; winRate: number; pnl: number }[];
  bySymbol: { symbol: string; ideas: number; wins: number; winRate: number; pnl: number; lastTrade: string }[];
  byConfidenceBand: { band: string; ideas: number; wins: number; expectedWinRate: number; actualWinRate: number; calibrationError: number }[];
  topPerformers: { symbol: string; winRate: number; trades: number; totalPnL: number }[];
  worstPerformers: { symbol: string; winRate: number; trades: number; totalPnL: number }[];
}

export interface SymbolIntelligence {
  symbol: string;
  profile: SymbolBehaviorProfile | null;
  recentTrades: TradeIdea[];
  bestCatalysts: { catalyst: string; winRate: number; trades: number }[];
  worstCatalysts: { catalyst: string; winRate: number; trades: number }[];
  recommendations: string[];
}

export class HistoricalIntelligenceService {
  
  /**
   * Categorize a catalyst text into a CatalystCategory
   */
  categorizeCatalyst(catalystText: string): CatalystCategory {
    const lowerText = catalystText.toLowerCase();
    
    for (const [category, keywords] of Object.entries(CATALYST_KEYWORDS)) {
      if (category === 'other') continue;
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          return category as CatalystCategory;
        }
      }
    }
    return 'other';
  }

  /**
   * Calculate comprehensive historical performance stats
   */
  async calculatePerformanceStats(): Promise<HistoricalPerformanceStats> {
    logger.info('[HIST-INTEL] Calculating comprehensive performance stats...');
    
    // Get all closed trade ideas (exclude open and training-excluded)
    const allIdeas = await db.select().from(tradeIdeas).where(
      and(
        ne(tradeIdeas.outcomeStatus, 'open'),
        isNotNull(tradeIdeas.outcomeStatus),
        eq(tradeIdeas.excludeFromTraining, false)
      )
    );
    
    const closedIdeas = allIdeas.filter(i => 
      ['hit_target', 'hit_stop', 'manual_exit', 'expired'].includes(i.outcomeStatus || '')
    );
    
    // Calculate overall stats
    const wins = closedIdeas.filter(i => i.outcomeStatus === 'hit_target' || 
      (i.outcomeStatus === 'manual_exit' && (i.realizedPnL || 0) > 0)).length;
    const losses = closedIdeas.filter(i => i.outcomeStatus === 'hit_stop' || 
      (i.outcomeStatus === 'manual_exit' && (i.realizedPnL || 0) < 0) ||
      i.outcomeStatus === 'expired').length;
    const breakevens = closedIdeas.length - wins - losses;
    
    const totalPnL = closedIdeas.reduce((sum, i) => sum + (i.realizedPnL || 0), 0);
    const avgPnLPercent = closedIdeas.length > 0 
      ? closedIdeas.reduce((sum, i) => sum + (i.percentGain || 0), 0) / closedIdeas.length 
      : 0;
    
    const totalWins = closedIdeas.filter(i => (i.realizedPnL || 0) > 0).reduce((sum, i) => sum + (i.realizedPnL || 0), 0);
    const totalLosses = Math.abs(closedIdeas.filter(i => (i.realizedPnL || 0) < 0).reduce((sum, i) => sum + (i.realizedPnL || 0), 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;
    
    // Group by source
    const bySource: Record<string, { ideas: number; wins: number; winRate: number; pnl: number }> = {};
    for (const idea of closedIdeas) {
      const source = idea.source || 'unknown';
      if (!bySource[source]) bySource[source] = { ideas: 0, wins: 0, winRate: 0, pnl: 0 };
      bySource[source].ideas++;
      if (idea.outcomeStatus === 'hit_target' || (idea.outcomeStatus === 'manual_exit' && (idea.realizedPnL || 0) > 0)) {
        bySource[source].wins++;
      }
      bySource[source].pnl += idea.realizedPnL || 0;
    }
    for (const source of Object.keys(bySource)) {
      bySource[source].winRate = bySource[source].ideas > 0 
        ? (bySource[source].wins / bySource[source].ideas) * 100 
        : 0;
    }
    
    // Group by asset type
    const byAssetType: Record<string, { ideas: number; wins: number; winRate: number; pnl: number }> = {};
    for (const idea of closedIdeas) {
      const assetType = idea.assetType || 'unknown';
      if (!byAssetType[assetType]) byAssetType[assetType] = { ideas: 0, wins: 0, winRate: 0, pnl: 0 };
      byAssetType[assetType].ideas++;
      if (idea.outcomeStatus === 'hit_target' || (idea.outcomeStatus === 'manual_exit' && (idea.realizedPnL || 0) > 0)) {
        byAssetType[assetType].wins++;
      }
      byAssetType[assetType].pnl += idea.realizedPnL || 0;
    }
    for (const assetType of Object.keys(byAssetType)) {
      byAssetType[assetType].winRate = byAssetType[assetType].ideas > 0 
        ? (byAssetType[assetType].wins / byAssetType[assetType].ideas) * 100 
        : 0;
    }
    
    // Group by direction
    const byDirection: Record<string, { ideas: number; wins: number; winRate: number; pnl: number }> = {};
    for (const idea of closedIdeas) {
      const direction = idea.direction || 'unknown';
      if (!byDirection[direction]) byDirection[direction] = { ideas: 0, wins: 0, winRate: 0, pnl: 0 };
      byDirection[direction].ideas++;
      if (idea.outcomeStatus === 'hit_target' || (idea.outcomeStatus === 'manual_exit' && (idea.realizedPnL || 0) > 0)) {
        byDirection[direction].wins++;
      }
      byDirection[direction].pnl += idea.realizedPnL || 0;
    }
    for (const direction of Object.keys(byDirection)) {
      byDirection[direction].winRate = byDirection[direction].ideas > 0 
        ? (byDirection[direction].wins / byDirection[direction].ideas) * 100 
        : 0;
    }
    
    // Group by catalyst category
    const catalystMap: Record<string, { ideas: number; wins: number; pnl: number }> = {};
    for (const idea of closedIdeas) {
      const category = this.categorizeCatalyst(idea.catalyst || '');
      if (!catalystMap[category]) catalystMap[category] = { ideas: 0, wins: 0, pnl: 0 };
      catalystMap[category].ideas++;
      if (idea.outcomeStatus === 'hit_target' || (idea.outcomeStatus === 'manual_exit' && (idea.realizedPnL || 0) > 0)) {
        catalystMap[category].wins++;
      }
      catalystMap[category].pnl += idea.realizedPnL || 0;
    }
    const byCatalyst = Object.entries(catalystMap)
      .map(([catalyst, data]) => ({
        catalyst,
        ideas: data.ideas,
        wins: data.wins,
        winRate: data.ideas > 0 ? (data.wins / data.ideas) * 100 : 0,
        pnl: data.pnl
      }))
      .sort((a, b) => b.winRate - a.winRate);
    
    // Group by symbol
    const symbolMap: Record<string, { ideas: number; wins: number; pnl: number; lastTrade: string }> = {};
    for (const idea of closedIdeas) {
      const symbol = idea.symbol;
      if (!symbolMap[symbol]) symbolMap[symbol] = { ideas: 0, wins: 0, pnl: 0, lastTrade: '' };
      symbolMap[symbol].ideas++;
      if (idea.outcomeStatus === 'hit_target' || (idea.outcomeStatus === 'manual_exit' && (idea.realizedPnL || 0) > 0)) {
        symbolMap[symbol].wins++;
      }
      symbolMap[symbol].pnl += idea.realizedPnL || 0;
      if (!symbolMap[symbol].lastTrade || idea.timestamp > symbolMap[symbol].lastTrade) {
        symbolMap[symbol].lastTrade = idea.timestamp;
      }
    }
    const bySymbol = Object.entries(symbolMap)
      .map(([symbol, data]) => ({
        symbol,
        ideas: data.ideas,
        wins: data.wins,
        winRate: data.ideas > 0 ? (data.wins / data.ideas) * 100 : 0,
        pnl: data.pnl,
        lastTrade: data.lastTrade
      }))
      .sort((a, b) => b.ideas - a.ideas);
    
    // Confidence calibration
    const confidenceBands = [
      { min: 90, max: 100, label: '90-100' },
      { min: 80, max: 90, label: '80-90' },
      { min: 70, max: 80, label: '70-80' },
      { min: 60, max: 70, label: '60-70' },
      { min: 0, max: 60, label: '0-60' }
    ];
    
    const byConfidenceBand = confidenceBands.map(band => {
      const bandIdeas = closedIdeas.filter(i => 
        (i.confidenceScore || 0) >= band.min && (i.confidenceScore || 0) < band.max
      );
      const bandWins = bandIdeas.filter(i => 
        i.outcomeStatus === 'hit_target' || 
        (i.outcomeStatus === 'manual_exit' && (i.realizedPnL || 0) > 0)
      ).length;
      const actualWinRate = bandIdeas.length > 0 ? (bandWins / bandIdeas.length) * 100 : 0;
      const expectedWinRate = (band.min + band.max) / 2; // Midpoint of band
      
      return {
        band: band.label,
        ideas: bandIdeas.length,
        wins: bandWins,
        expectedWinRate,
        actualWinRate,
        calibrationError: actualWinRate - expectedWinRate
      };
    });
    
    // Top and worst performers (min 3 trades)
    const qualifiedSymbols = bySymbol.filter(s => s.ideas >= 3);
    const topPerformers = [...qualifiedSymbols]
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 10)
      .map(s => ({ symbol: s.symbol, winRate: s.winRate, trades: s.ideas, totalPnL: s.pnl }));
    const worstPerformers = [...qualifiedSymbols]
      .sort((a, b) => a.winRate - b.winRate)
      .slice(0, 10)
      .map(s => ({ symbol: s.symbol, winRate: s.winRate, trades: s.ideas, totalPnL: s.pnl }));
    
    logger.info(`[HIST-INTEL] Stats calculated: ${closedIdeas.length} closed ideas, ${wins} wins, ${losses} losses`);
    
    return {
      overall: {
        totalIdeas: allIdeas.length,
        closedIdeas: closedIdeas.length,
        wins,
        losses,
        breakevens,
        winRate: closedIdeas.length > 0 ? (wins / closedIdeas.length) * 100 : 0,
        totalPnL,
        avgPnLPercent,
        profitFactor
      },
      bySource,
      byAssetType,
      byDirection,
      byCatalyst,
      bySymbol,
      byConfidenceBand,
      topPerformers,
      worstPerformers
    };
  }

  /**
   * Build or update symbol behavior profile from historical data
   */
  async updateSymbolProfile(symbol: string): Promise<SymbolBehaviorProfile | null> {
    logger.info(`[HIST-INTEL] Updating symbol profile for ${symbol}...`);
    
    // Get all closed trades for this symbol
    const symbolIdeas = await db.select().from(tradeIdeas).where(
      and(
        eq(tradeIdeas.symbol, symbol),
        isNotNull(tradeIdeas.outcomeStatus),
        eq(tradeIdeas.excludeFromTraining, false)
      )
    );
    
    if (symbolIdeas.length === 0) {
      logger.info(`[HIST-INTEL] No trades found for ${symbol}`);
      return null;
    }
    
    const closedIdeas = symbolIdeas.filter(i => 
      ['hit_target', 'hit_stop', 'manual_exit', 'expired'].includes(i.outcomeStatus || '')
    );
    
    // Calculate stats
    const wins = closedIdeas.filter(i => 
      i.outcomeStatus === 'hit_target' || 
      (i.outcomeStatus === 'manual_exit' && (i.realizedPnL || 0) > 0)
    );
    const losses = closedIdeas.filter(i => 
      i.outcomeStatus === 'hit_stop' || 
      i.outcomeStatus === 'expired' ||
      (i.outcomeStatus === 'manual_exit' && (i.realizedPnL || 0) < 0)
    );
    
    const longIdeas = closedIdeas.filter(i => i.direction === 'long');
    const shortIdeas = closedIdeas.filter(i => i.direction === 'short');
    const optionIdeas = closedIdeas.filter(i => i.assetType === 'option');
    
    const longWins = longIdeas.filter(i => 
      i.outcomeStatus === 'hit_target' || (i.outcomeStatus === 'manual_exit' && (i.realizedPnL || 0) > 0)
    ).length;
    const shortWins = shortIdeas.filter(i => 
      i.outcomeStatus === 'hit_target' || (i.outcomeStatus === 'manual_exit' && (i.realizedPnL || 0) > 0)
    ).length;
    const optionWins = optionIdeas.filter(i => 
      i.outcomeStatus === 'hit_target' || (i.outcomeStatus === 'manual_exit' && (i.realizedPnL || 0) > 0)
    ).length;
    
    // Calculate profit metrics
    const totalPnL = closedIdeas.reduce((sum, i) => sum + (i.realizedPnL || 0), 0);
    const winAmounts = wins.map(i => i.realizedPnL || 0);
    const lossAmounts = losses.map(i => Math.abs(i.realizedPnL || 0));
    const winPercents = wins.map(i => i.percentGain || 0);
    const lossPercents = losses.map(i => Math.abs(i.percentGain || 0));
    
    const avgWinAmount = winAmounts.length > 0 ? winAmounts.reduce((a, b) => a + b, 0) / winAmounts.length : 0;
    const avgLossAmount = lossAmounts.length > 0 ? lossAmounts.reduce((a, b) => a + b, 0) / lossAmounts.length : 0;
    const avgWinPercent = winPercents.length > 0 ? winPercents.reduce((a, b) => a + b, 0) / winPercents.length : 0;
    const avgLossPercent = lossPercents.length > 0 ? lossPercents.reduce((a, b) => a + b, 0) / lossPercents.length : 0;
    
    const totalWinDollars = winAmounts.reduce((a, b) => a + b, 0);
    const totalLossDollars = lossAmounts.reduce((a, b) => a + b, 0);
    const profitFactor = totalLossDollars > 0 ? totalWinDollars / totalLossDollars : totalWinDollars > 0 ? 999 : 0;
    
    // Confidence calibration
    const avgConfidence = closedIdeas.reduce((sum, i) => sum + (i.confidenceScore || 0), 0) / closedIdeas.length;
    const actualWinRate = closedIdeas.length > 0 ? (wins.length / closedIdeas.length) * 100 : 0;
    const calibration = avgConfidence > 0 ? (actualWinRate / avgConfidence) * 100 : 0;
    
    // Best/worst catalyst
    const catalystStats: Record<string, { wins: number; total: number }> = {};
    for (const idea of closedIdeas) {
      const category = this.categorizeCatalyst(idea.catalyst || '');
      if (!catalystStats[category]) catalystStats[category] = { wins: 0, total: 0 };
      catalystStats[category].total++;
      if (idea.outcomeStatus === 'hit_target' || (idea.outcomeStatus === 'manual_exit' && (idea.realizedPnL || 0) > 0)) {
        catalystStats[category].wins++;
      }
    }
    
    const catalystRankings = Object.entries(catalystStats)
      .filter(([_, data]) => data.total >= 2)
      .map(([catalyst, data]) => ({
        catalyst,
        winRate: (data.wins / data.total) * 100
      }))
      .sort((a, b) => b.winRate - a.winRate);
    
    const bestCatalyst = catalystRankings[0];
    const worstCatalyst = catalystRankings[catalystRankings.length - 1];
    
    // Session/volatility performance
    const sessionStats: Record<string, { wins: number; total: number }> = {};
    const volatilityStats: Record<string, { wins: number; total: number }> = {};
    
    for (const idea of closedIdeas) {
      const session = idea.sessionPhase || 'unknown';
      const volatility = idea.volatilityRegime || 'unknown';
      
      if (!sessionStats[session]) sessionStats[session] = { wins: 0, total: 0 };
      if (!volatilityStats[volatility]) volatilityStats[volatility] = { wins: 0, total: 0 };
      
      sessionStats[session].total++;
      volatilityStats[volatility].total++;
      
      if (idea.outcomeStatus === 'hit_target' || (idea.outcomeStatus === 'manual_exit' && (idea.realizedPnL || 0) > 0)) {
        sessionStats[session].wins++;
        volatilityStats[volatility].wins++;
      }
    }
    
    const bestSession = Object.entries(sessionStats)
      .filter(([_, data]) => data.total >= 2)
      .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total))[0];
    
    const bestVolatility = Object.entries(volatilityStats)
      .filter(([_, data]) => data.total >= 2)
      .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total))[0];
    
    // Last trade date
    const lastTrade = symbolIdeas.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
    
    // Upsert profile
    const profileData = {
      symbol,
      totalIdeas: symbolIdeas.length,
      closedIdeas: closedIdeas.length,
      wins: wins.length,
      losses: losses.length,
      breakevens: closedIdeas.length - wins.length - losses.length,
      overallWinRate: actualWinRate,
      longWinRate: longIdeas.length > 0 ? (longWins / longIdeas.length) * 100 : 0,
      shortWinRate: shortIdeas.length > 0 ? (shortWins / shortIdeas.length) * 100 : 0,
      optionsWinRate: optionIdeas.length > 0 ? (optionWins / optionIdeas.length) * 100 : 0,
      totalPnL,
      avgWinAmount,
      avgLossAmount,
      avgWinPercent,
      avgLossPercent,
      profitFactor,
      avgConfidenceScore: avgConfidence,
      actualWinRateVsPredicted: calibration,
      bestCatalystType: bestCatalyst?.catalyst as CatalystCategory || null,
      bestCatalystWinRate: bestCatalyst?.winRate || 0,
      worstCatalystType: worstCatalyst?.catalyst as CatalystCategory || null,
      worstCatalystWinRate: worstCatalyst?.winRate || 0,
      bestSessionPhase: bestSession?.[0] as any || null,
      bestSessionWinRate: bestSession ? (bestSession[1].wins / bestSession[1].total) * 100 : 0,
      bestVolatilityRegime: bestVolatility?.[0] as any || null,
      bestVolatilityWinRate: bestVolatility ? (bestVolatility[1].wins / bestVolatility[1].total) * 100 : 0,
      lastTradeDate: lastTrade ? new Date(lastTrade.timestamp) : null,
      profileUpdatedAt: new Date()
    };
    
    // Check if profile exists
    const existing = await db.select().from(symbolBehaviorProfiles).where(eq(symbolBehaviorProfiles.symbol, symbol));
    
    if (existing.length > 0) {
      await db.update(symbolBehaviorProfiles)
        .set(profileData)
        .where(eq(symbolBehaviorProfiles.symbol, symbol));
    } else {
      await db.insert(symbolBehaviorProfiles).values(profileData);
    }
    
    const updated = await db.select().from(symbolBehaviorProfiles).where(eq(symbolBehaviorProfiles.symbol, symbol));
    logger.info(`[HIST-INTEL] Profile updated for ${symbol}: ${wins.length}W/${losses.length}L (${actualWinRate.toFixed(1)}%)`);
    
    return updated[0] || null;
  }

  /**
   * Rebuild all symbol profiles from historical data
   */
  async rebuildAllProfiles(): Promise<{ updated: number; symbols: string[] }> {
    logger.info('[HIST-INTEL] Rebuilding all symbol profiles...');
    
    // Get unique symbols from trade ideas
    const symbols = await db.selectDistinct({ symbol: tradeIdeas.symbol }).from(tradeIdeas);
    const uniqueSymbols = symbols.map(s => s.symbol);
    
    let updated = 0;
    const updatedSymbols: string[] = [];
    
    for (const symbol of uniqueSymbols) {
      try {
        const profile = await this.updateSymbolProfile(symbol);
        if (profile) {
          updated++;
          updatedSymbols.push(symbol);
        }
      } catch (error) {
        logger.error(`[HIST-INTEL] Error updating profile for ${symbol}:`, error);
      }
    }
    
    logger.info(`[HIST-INTEL] Rebuilt ${updated} symbol profiles`);
    return { updated, symbols: updatedSymbols };
  }

  /**
   * Get symbol intelligence with recommendations
   */
  async getSymbolIntelligence(symbol: string): Promise<SymbolIntelligence> {
    // Get or create profile
    let profile: SymbolBehaviorProfile | null = await db.select().from(symbolBehaviorProfiles)
      .where(eq(symbolBehaviorProfiles.symbol, symbol))
      .then(rows => rows[0] || null);
    
    if (!profile) {
      profile = await this.updateSymbolProfile(symbol);
    }
    
    // Get recent trades
    const recentTrades = await db.select().from(tradeIdeas)
      .where(eq(tradeIdeas.symbol, symbol))
      .orderBy(desc(tradeIdeas.timestamp))
      .limit(10);
    
    // Build recommendations
    const recommendations: string[] = [];
    
    if (profile) {
      if (profile.overallWinRate && profile.overallWinRate >= 70 && profile.closedIdeas >= 5) {
        recommendations.push(`🎯 High performer: ${profile.overallWinRate.toFixed(0)}% win rate across ${profile.closedIdeas} trades`);
      }
      
      if (profile.overallWinRate && profile.overallWinRate < 40 && profile.closedIdeas >= 5) {
        recommendations.push(`⚠️ Low win rate (${profile.overallWinRate.toFixed(0)}%) - consider avoiding or reducing position size`);
      }
      
      if (profile.longWinRate && profile.shortWinRate && Math.abs(profile.longWinRate - profile.shortWinRate) > 20) {
        if (profile.longWinRate > profile.shortWinRate) {
          recommendations.push(`📈 Long bias: ${profile.longWinRate.toFixed(0)}% win rate long vs ${profile.shortWinRate.toFixed(0)}% short`);
        } else {
          recommendations.push(`📉 Short bias: ${profile.shortWinRate.toFixed(0)}% win rate short vs ${profile.longWinRate.toFixed(0)}% long`);
        }
      }
      
      if (profile.bestCatalystType && profile.bestCatalystWinRate && profile.bestCatalystWinRate >= 60) {
        recommendations.push(`🔥 Best catalyst: ${profile.bestCatalystType} (${profile.bestCatalystWinRate.toFixed(0)}% win rate)`);
      }
      
      if (profile.worstCatalystType && profile.worstCatalystWinRate !== null && profile.worstCatalystWinRate < 40) {
        recommendations.push(`❌ Avoid catalyst: ${profile.worstCatalystType} (${profile.worstCatalystWinRate.toFixed(0)}% win rate)`);
      }
      
      if (profile.actualWinRateVsPredicted && profile.actualWinRateVsPredicted < 80) {
        recommendations.push(`📊 Confidence overestimated - actual performance is ${(100 - profile.actualWinRateVsPredicted).toFixed(0)}% below predicted`);
      }
      
      if (profile.profitFactor && profile.profitFactor >= 2) {
        recommendations.push(`💰 Excellent profit factor: ${profile.profitFactor.toFixed(1)}x (total wins / total losses)`);
      }
    }
    
    // Catalyst breakdown
    const catalystBreakdown = recentTrades.reduce((acc, trade) => {
      const cat = this.categorizeCatalyst(trade.catalyst || '');
      if (!acc[cat]) acc[cat] = { wins: 0, total: 0 };
      acc[cat].total++;
      if (trade.outcomeStatus === 'hit_target' || (trade.outcomeStatus === 'manual_exit' && (trade.realizedPnL || 0) > 0)) {
        acc[cat].wins++;
      }
      return acc;
    }, {} as Record<string, { wins: number; total: number }>);
    
    const catalystRankings = Object.entries(catalystBreakdown)
      .filter(([_, data]) => data.total >= 1)
      .map(([catalyst, data]) => ({
        catalyst,
        winRate: data.total > 0 ? (data.wins / data.total) * 100 : 0,
        trades: data.total
      }))
      .sort((a, b) => b.winRate - a.winRate);
    
    return {
      symbol,
      profile,
      recentTrades,
      bestCatalysts: catalystRankings.slice(0, 3),
      worstCatalysts: catalystRankings.slice(-3).reverse(),
      recommendations
    };
  }

  /**
   * Update confidence calibration table
   */
  async updateConfidenceCalibration(): Promise<void> {
    logger.info('[HIST-INTEL] Updating confidence calibration...');
    
    const bands = [
      { min: 90, max: 100, label: '90-100' },
      { min: 80, max: 90, label: '80-90' },
      { min: 70, max: 80, label: '70-80' },
      { min: 60, max: 70, label: '60-70' },
      { min: 50, max: 60, label: '50-60' },
      { min: 0, max: 50, label: '0-50' }
    ];
    
    const closedIdeas = await db.select().from(tradeIdeas).where(
      and(
        isNotNull(tradeIdeas.outcomeStatus),
        ne(tradeIdeas.outcomeStatus, 'open'),
        eq(tradeIdeas.excludeFromTraining, false)
      )
    );
    
    for (const band of bands) {
      const bandIdeas = closedIdeas.filter(i => 
        (i.confidenceScore || 0) >= band.min && (i.confidenceScore || 0) < band.max
      );
      
      const aiIdeas = bandIdeas.filter(i => i.source === 'ai');
      const quantIdeas = bandIdeas.filter(i => i.source === 'quant');
      
      const wins = bandIdeas.filter(i => 
        i.outcomeStatus === 'hit_target' || 
        (i.outcomeStatus === 'manual_exit' && (i.realizedPnL || 0) > 0)
      );
      const aiWins = aiIdeas.filter(i => 
        i.outcomeStatus === 'hit_target' || 
        (i.outcomeStatus === 'manual_exit' && (i.realizedPnL || 0) > 0)
      );
      const quantWins = quantIdeas.filter(i => 
        i.outcomeStatus === 'hit_target' || 
        (i.outcomeStatus === 'manual_exit' && (i.realizedPnL || 0) > 0)
      );
      
      const actualWinRate = bandIdeas.length > 0 ? (wins.length / bandIdeas.length) * 100 : 0;
      const expectedWinRate = (band.min + band.max) / 2;
      const calibrationError = actualWinRate - expectedWinRate;
      
      const avgPnLPercent = bandIdeas.length > 0 
        ? bandIdeas.reduce((sum, i) => sum + (i.percentGain || 0), 0) / bandIdeas.length 
        : 0;
      const avgPnLDollars = bandIdeas.length > 0 
        ? bandIdeas.reduce((sum, i) => sum + (i.realizedPnL || 0), 0) / bandIdeas.length 
        : 0;
      
      const calibrationData = {
        confidenceBandMin: band.min,
        confidenceBandMax: band.max,
        bandLabel: band.label,
        totalPredictions: bandIdeas.length,
        closedPredictions: bandIdeas.length,
        correctPredictions: wins.length,
        actualWinRate,
        expectedWinRate,
        calibrationError,
        avgPnLPercent,
        avgPnLDollars,
        aiPredictions: aiIdeas.length,
        aiWinRate: aiIdeas.length > 0 ? (aiWins.length / aiIdeas.length) * 100 : 0,
        quantPredictions: quantIdeas.length,
        quantWinRate: quantIdeas.length > 0 ? (quantWins.length / quantIdeas.length) * 100 : 0,
        lastUpdated: new Date()
      };
      
      // Upsert
      const existing = await db.select().from(confidenceCalibration)
        .where(eq(confidenceCalibration.bandLabel, band.label));
      
      if (existing.length > 0) {
        await db.update(confidenceCalibration)
          .set(calibrationData)
          .where(eq(confidenceCalibration.bandLabel, band.label));
      } else {
        await db.insert(confidenceCalibration).values(calibrationData);
      }
    }
    
    logger.info('[HIST-INTEL] Confidence calibration updated');
  }

  /**
   * Update overall intelligence summary
   */
  async updateIntelligenceSummary(): Promise<void> {
    logger.info('[HIST-INTEL] Updating intelligence summary...');
    
    const stats = await this.calculatePerformanceStats();
    
    const summaryData = {
      totalIdeasGenerated: stats.overall.totalIdeas,
      totalIdeasClosed: stats.overall.closedIdeas,
      overallWinRate: stats.overall.winRate,
      overallProfitFactor: stats.overall.profitFactor,
      totalRealizedPnL: stats.overall.totalPnL,
      aiIdeas: stats.bySource.ai?.ideas || 0,
      aiWinRate: stats.bySource.ai?.winRate || 0,
      quantIdeas: stats.bySource.quant?.ideas || 0,
      quantWinRate: stats.bySource.quant?.winRate || 0,
      flowIdeas: stats.bySource.flow?.ideas || 0,
      flowWinRate: stats.bySource.flow?.winRate || 0,
      stockWinRate: stats.byAssetType.stock?.winRate || 0,
      optionsWinRate: stats.byAssetType.option?.winRate || 0,
      cryptoWinRate: stats.byAssetType.crypto?.winRate || 0,
      futuresWinRate: stats.byAssetType.future?.winRate || 0,
      longWinRate: stats.byDirection.long?.winRate || 0,
      shortWinRate: stats.byDirection.short?.winRate || 0,
      topSymbolsByWinRate: stats.topPerformers,
      topCatalystsByWinRate: stats.byCatalyst.slice(0, 5).map(c => ({
        catalyst: c.catalyst,
        winRate: c.winRate,
        trades: c.ideas
      })),
      confidenceCalibrationScore: Math.max(0, 100 - Math.abs(
        stats.byConfidenceBand.reduce((sum, b) => sum + Math.abs(b.calibrationError), 0) / stats.byConfidenceBand.length
      )),
      avgOverconfidence: stats.byConfidenceBand.reduce((sum, b) => sum - b.calibrationError, 0) / stats.byConfidenceBand.length,
      dataRangeEnd: new Date(),
      lastUpdated: new Date()
    };
    
    // Upsert (only one summary row)
    const existing = await db.select().from(historicalIntelligenceSummary);
    
    if (existing.length > 0) {
      await db.update(historicalIntelligenceSummary)
        .set(summaryData)
        .where(eq(historicalIntelligenceSummary.id, existing[0].id));
    } else {
      await db.insert(historicalIntelligenceSummary).values(summaryData);
    }
    
    logger.info('[HIST-INTEL] Intelligence summary updated');
  }

  /**
   * Full refresh of all historical intelligence
   */
  async fullRefresh(): Promise<{
    profilesUpdated: number;
    calibrationUpdated: boolean;
    summaryUpdated: boolean;
  }> {
    logger.info('[HIST-INTEL] Starting full intelligence refresh...');
    
    const profileResult = await this.rebuildAllProfiles();
    await this.updateConfidenceCalibration();
    await this.updateIntelligenceSummary();
    
    logger.info('[HIST-INTEL] Full refresh complete');
    
    return {
      profilesUpdated: profileResult.updated,
      calibrationUpdated: true,
      summaryUpdated: true
    };
  }

  /**
   * Get confidence adjustment for a new trade idea based on historical performance
   */
  async getConfidenceAdjustment(symbol: string, catalyst: string, direction: string): Promise<{
    adjustment: number;
    reason: string;
    symbolWinRate: number | null;
    catalystWinRate: number | null;
  }> {
    const profile = await db.select().from(symbolBehaviorProfiles)
      .where(eq(symbolBehaviorProfiles.symbol, symbol))
      .then(rows => rows[0] || null);
    
    let adjustment = 0;
    const reasons: string[] = [];
    let symbolWinRate: number | null = null;
    let catalystWinRate: number | null = null;
    
    if (profile && profile.closedIdeas >= 5) {
      symbolWinRate = profile.overallWinRate;
      
      // Adjust based on symbol performance
      if (profile.overallWinRate && profile.overallWinRate >= 70) {
        adjustment += 10;
        reasons.push(`+10: ${symbol} historical win rate ${profile.overallWinRate.toFixed(0)}%`);
      } else if (profile.overallWinRate && profile.overallWinRate < 40) {
        adjustment -= 15;
        reasons.push(`-15: ${symbol} low win rate ${profile.overallWinRate.toFixed(0)}%`);
      }
      
      // Adjust based on direction bias
      if (direction === 'long' && profile.longWinRate && profile.shortWinRate) {
        if (profile.longWinRate > profile.shortWinRate + 15) {
          adjustment += 5;
          reasons.push(`+5: ${symbol} long bias confirmed`);
        } else if (profile.longWinRate < profile.shortWinRate - 15) {
          adjustment -= 5;
          reasons.push(`-5: ${symbol} performs better short`);
        }
      } else if (direction === 'short' && profile.longWinRate && profile.shortWinRate) {
        if (profile.shortWinRate > profile.longWinRate + 15) {
          adjustment += 5;
          reasons.push(`+5: ${symbol} short bias confirmed`);
        } else if (profile.shortWinRate < profile.longWinRate - 15) {
          adjustment -= 5;
          reasons.push(`-5: ${symbol} performs better long`);
        }
      }
      
      // Adjust based on catalyst
      const category = this.categorizeCatalyst(catalyst);
      if (profile.bestCatalystType === category && profile.bestCatalystWinRate && profile.bestCatalystWinRate >= 60) {
        adjustment += 8;
        catalystWinRate = profile.bestCatalystWinRate;
        reasons.push(`+8: ${category} is best catalyst for ${symbol}`);
      } else if (profile.worstCatalystType === category && profile.worstCatalystWinRate !== null && profile.worstCatalystWinRate < 40) {
        adjustment -= 10;
        catalystWinRate = profile.worstCatalystWinRate;
        reasons.push(`-10: ${category} is worst catalyst for ${symbol}`);
      }
    }
    
    return {
      adjustment,
      reason: reasons.join('; ') || 'No historical data',
      symbolWinRate,
      catalystWinRate
    };
  }
}

export const historicalIntelligenceService = new HistoricalIntelligenceService();
