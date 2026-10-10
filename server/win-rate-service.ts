/**
 * UNIFIED WIN RATE SERVICE
 * 
 * Single source of truth for ALL win rate calculations across the platform.
 * Every endpoint, widget, and report MUST use this service for consistency.
 * 
 * Key Principles:
 * 1. OPTIONS counted by REAL contract P&L (optionPercentGain = exit vs entry
 *    premium). Option ideas WITHOUT a captured contract P&L are still excluded
 *    (we can't measure them honestly) — but resolved option ideas now count.
 * 2. NEUTRAL trades excluded from win rate (expired, breakeven)
 * 3. A target/stop event is decisive; ±3% applies only when an outcome status is absent
 * 4. Tiered output: summary for users, detailed for admin
 */

import { TradeIdea } from '@shared/schema';
import { 
  isRealWin, 
  isRealLoss, 
  classifyTrade,
  isCurrentGenEngine,
  CANONICAL_WIN_THRESHOLD,
  CANONICAL_LOSS_THRESHOLD
} from '@shared/constants';

export interface WinRateFilters {
  startDate?: string;
  endDate?: string;
  source?: string;
  assetType?: string;
  includeOptions?: boolean;
  includeAllVersions?: boolean;
  excludeSources?: string[];
}

export interface WinRateResult {
  wins: number;
  losses: number;
  neutral: number;
  total: number;
  decided: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  expectancy: number;
}

export interface CategoryBreakdown {
  category: string;
  stats: WinRateResult;
}

export interface UnifiedWinRateStats {
  overall: WinRateResult;
  bySource: CategoryBreakdown[];
  byAssetType: CategoryBreakdown[];
  methodology: {
    winDefinition: string;
    lossDefinition: string;
    neutralDefinition: string;
    optionsIncluded: boolean;
    legacyIncluded: boolean;
  };
  dataQuality: {
    totalTrades: number;
    tradesWithPnL: number;
    optionsExcluded: number;
    legacyExcluded: number;
  };
}

export class WinRateService {
  
  /**
   * Calculate unified win rate stats from trade ideas
   * This is the CANONICAL function - use this everywhere
   */
  static calculate(ideas: TradeIdea[], filters: WinRateFilters = {}): UnifiedWinRateStats {
    let filtered = [...ideas];
    const originalCount = filtered.length;
    
    // 1. Exclude buggy/test trades
    filtered = filtered.filter(idea => !idea.excludeFromTraining);

    // 1b. Exclude rows whose own geometry is impossible.
    //
    // A GOOGL option idea was stored with entry $10.80, stop $9.90 (an 8% stop) and
    // target $45.36 — an R:R of 38:1 — and then scored hit_target with the exit
    // recorded at exactly the target. That is one fabricated win in the record. The
    // cause is mixed units: entry and stop written in contract premium while the
    // target was written against a different scale, which happened on 4 of 411
    // option ideas.
    //
    // Rather than trust outcome_status on a row that cannot be true, drop it. This
    // rewrites nothing in the database — it stops impossible geometry from being
    // counted as evidence either way, which is the conservative direction: a real
    // setup with a genuine 38:1 payoff does not exist, so nothing legitimate is lost.
    filtered = filtered.filter(idea => !this.hasImpossibleGeometry(idea));
    
    // 2. Date filtering
    if (filters.startDate || filters.endDate) {
      filtered = filtered.filter(idea => {
        const ideaDateStr = idea.timestamp.split('T')[0];
        if (filters.startDate && ideaDateStr < filters.startDate) return false;
        if (filters.endDate && ideaDateStr > filters.endDate) return false;
        return true;
      });
    }
    
    // 3. Source filter
    if (filters.source) {
      filtered = filtered.filter(idea => idea.source === filters.source);
    }
    
    // 4. Exclude specific sources
    if (filters.excludeSources && filters.excludeSources.length > 0) {
      filtered = filtered.filter(idea => !filters.excludeSources!.includes(idea.source || ''));
    }
    
    // 5. Engine version filter (exclude legacy by default)
    let legacyExcluded = 0;
    if (!filters.includeAllVersions) {
      const beforeFilter = filtered.length;
      filtered = filtered.filter(idea => isCurrentGenEngine(idea));
      legacyExcluded = beforeFilter - filtered.length;
    }
    
    // 6. OPTIONS FILTER
    // Options now count by REAL contract P&L (optionPercentGain). We keep option
    // (and flow/lotto) ideas only when they have a captured contract P&L — those
    // are the ones we can measure honestly. Option ideas without it (legacy, or
    // still-open) stay excluded. `includeOptions` forces ALL through (admin view).
    let optionsExcluded = 0;
    if (!filters.includeOptions) {
      const beforeFilter = filtered.length;
      filtered = filtered.filter(idea => {
        const isOptionish =
          idea.assetType === 'option' || idea.source === 'flow' || idea.source === 'lotto';
        if (!isOptionish) return true;
        // Keep only measurable option ideas (real captured contract P&L).
        return typeof idea.optionPercentGain === 'number';
      });
      optionsExcluded = beforeFilter - filtered.length;
    }
    
    // 7. Asset type filter
    if (filters.assetType) {
      filtered = filtered.filter(idea => idea.assetType === filters.assetType);
    }
    
    // Calculate stats
    const overall = this.calculateStats(filtered);
    
    // Group by source
    const sources = Array.from(new Set(filtered.map(i => i.source || 'unknown')));
    const bySource = sources.map(source => ({
      category: source,
      stats: this.calculateStats(filtered.filter(i => i.source === source))
    })).filter(s => s.stats.decided > 0)
      .sort((a, b) => b.stats.decided - a.stats.decided);
    
    // Group by asset type
    const assetTypes = Array.from(new Set(filtered.map(i => i.assetType || 'unknown')));
    const byAssetType = assetTypes.map(assetType => ({
      category: assetType,
      stats: this.calculateStats(filtered.filter(i => i.assetType === assetType))
    })).filter(s => s.stats.decided > 0)
      .sort((a, b) => b.stats.decided - a.stats.decided);
    
    return {
      overall,
      bySource,
      byAssetType,
      methodology: {
        winDefinition: `stocks: hit_target OR P&L >= +${CANONICAL_WIN_THRESHOLD}%; options: contract P&L >= +${CANONICAL_WIN_THRESHOLD}%`,
        lossDefinition: `stocks: hit_stop OR P&L <= -${CANONICAL_LOSS_THRESHOLD}% when no status exists; options: contract P&L <= -${CANONICAL_LOSS_THRESHOLD}%`,
        neutralDefinition: 'expired, manual_exit, status-less |P&L| < 3%, or option without captured contract P&L',
        optionsIncluded: true, // measured options (real contract P&L) always count now
        legacyIncluded: filters.includeAllVersions ?? false,
      },
      dataQuality: {
        totalTrades: originalCount,
        tradesWithPnL: filtered.filter(i => i.percentGain !== null).length,
        optionsExcluded,
        legacyExcluded,
      }
    };
  }
  
  /**
   * Does this idea carry a REAL captured option contract P&L?
   * When true, win/loss is judged on the contract return (optionPercentGain),
   * not the underlying stock move (percentGain).
   */
  private static isOptionMeasured(idea: TradeIdea): boolean {
    return idea.assetType === 'option' && typeof idea.optionPercentGain === 'number';
  }

  /** The P&L figure that defines this idea's outcome (contract for options, stock otherwise). */
  private static outcomePnl(idea: TradeIdea): number | null {
    if (this.isOptionMeasured(idea)) return idea.optionPercentGain!;
    return idea.percentGain ?? null;
  }

  /** Win/loss/neutral using real contract P&L for measured options, else stock-level rules. */
  private static classifyIdea(idea: TradeIdea): 'win' | 'loss' | 'neutral' {
    if (this.isOptionMeasured(idea)) {
      const pnl = idea.optionPercentGain!;
      if (pnl >= CANONICAL_WIN_THRESHOLD) return 'win';
      if (pnl <= -CANONICAL_LOSS_THRESHOLD) return 'loss';
      return 'neutral';
    }
    if (isRealWin(idea)) return 'win';
    if (isRealLoss(idea)) return 'loss';
    return 'neutral';
  }

  /**
   * Calculate basic stats for a set of trades
   */

  /**
   * True when a row's entry/stop/target cannot describe a real trade.
   *
   * Two independent checks, because a unit mismatch can show up as either an
   * absurd payoff or an absurd target distance depending on which field was
   * written in the wrong scale.
   */
  private static hasImpossibleGeometry(idea: any): boolean {
    const entry = Number(idea.entryPrice);
    const target = Number(idea.targetPrice);
    const stop = Number(idea.stopLoss);
    if (!(entry > 0) || !(target > 0) || !(stop > 0)) return false; // nothing to judge

    const reward = Math.abs(target - entry);
    const risk = Math.abs(entry - stop);
    if (risk <= 0) return true; // a stop at the entry is not a stop

    // No listed setup pays 15:1 off a stop that tight. Beyond this the number is a
    // units bug, not an opportunity.
    if (reward / risk > 15) return true;

    // A target more than 3x the entry means the two fields are measured on
    // different scales — premium against underlying, almost always.
    if (target > entry * 3) return true;

    return false;
  }

  private static calculateStats(ideas: TradeIdea[]): WinRateResult {
    const wins = ideas.filter(i => this.classifyIdea(i) === 'win');
    const losses = ideas.filter(i => this.classifyIdea(i) === 'loss');
    const neutral = ideas.filter(i => this.classifyIdea(i) === 'neutral');

    const decided = wins.length + losses.length;
    const winRate = decided > 0 ? (wins.length / decided) * 100 : 0;

    // Calculate average win/loss sizes (uses contract P&L for measured options)
    const winGains = wins
      .map(i => this.outcomePnl(i))
      .filter((v): v is number => v !== null);
    const lossGains = losses
      .map(i => this.outcomePnl(i))
      .filter((v): v is number => v !== null)
      .map(v => Math.abs(v));
    
    const avgWinPct = winGains.length > 0 
      ? winGains.reduce((a, b) => a + b, 0) / winGains.length 
      : 0;
    const avgLossPct = lossGains.length > 0 
      ? lossGains.reduce((a, b) => a + b, 0) / lossGains.length 
      : 0;
    
    // Expectancy: (Win% × Avg Win) - (Loss% × Avg Loss)
    const winPct = decided > 0 ? wins.length / decided : 0;
    const lossPct = decided > 0 ? losses.length / decided : 0;
    const expectancy = (winPct * avgWinPct) - (lossPct * avgLossPct);
    
    return {
      wins: wins.length,
      losses: losses.length,
      neutral: neutral.length,
      total: ideas.length,
      decided,
      winRate: Math.round(winRate * 10) / 10,
      avgWinPct: Math.round(avgWinPct * 10) / 10,
      avgLossPct: Math.round(avgLossPct * 10) / 10,
      expectancy: Math.round(expectancy * 100) / 100,
    };
  }
  
  /**
   * Get summary stats for regular users (clean, simple)
   */
  static getSummary(ideas: TradeIdea[], filters: WinRateFilters = {}): {
    winRate: number;
    decided: number;
    wins: number;
    losses: number;
  } {
    const stats = this.calculate(ideas, filters);
    return {
      winRate: stats.overall.winRate,
      decided: stats.overall.decided,
      wins: stats.overall.wins,
      losses: stats.overall.losses,
    };
  }
  
  /**
   * Calculate win rate for paper trading positions (Auto-Lotto bot)
   * Uses consistent logic with trade ideas
   */
  static calculateBotStats(positions: Array<{
    status: string;
    realizedPnL?: number | null;
    realizedPnLPercent?: number | null;
    exitReason?: string | null;
  }>): WinRateResult {
    const closedPositions = positions.filter(p => 
      p.status === 'closed' || p.status === 'expired'
    );
    
    const wins = closedPositions.filter(p => {
      if (p.realizedPnLPercent !== null && p.realizedPnLPercent !== undefined) {
        return p.realizedPnLPercent >= CANONICAL_WIN_THRESHOLD;
      }
      if (p.realizedPnL !== null && p.realizedPnL !== undefined) {
        return p.realizedPnL > 0;
      }
      return false;
    });
    
    const losses = closedPositions.filter(p => {
      if (p.realizedPnLPercent !== null && p.realizedPnLPercent !== undefined) {
        return p.realizedPnLPercent <= -CANONICAL_LOSS_THRESHOLD;
      }
      if (p.realizedPnL !== null && p.realizedPnL !== undefined) {
        return p.realizedPnL < 0;
      }
      return false;
    });
    
    const neutral = closedPositions.filter(p => {
      const pnlPct = p.realizedPnLPercent;
      if (pnlPct !== null && pnlPct !== undefined) {
        return Math.abs(pnlPct) < CANONICAL_WIN_THRESHOLD;
      }
      return true;
    });
    
    const decided = wins.length + losses.length;
    const winRate = decided > 0 ? (wins.length / decided) * 100 : 0;
    
    const winPnls = wins
      .filter(p => p.realizedPnLPercent !== null)
      .map(p => p.realizedPnLPercent!);
    const lossPnls = losses
      .filter(p => p.realizedPnLPercent !== null)
      .map(p => Math.abs(p.realizedPnLPercent!));
    
    const avgWinPct = winPnls.length > 0 
      ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length 
      : 0;
    const avgLossPct = lossPnls.length > 0 
      ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length 
      : 0;
    
    const winPct = decided > 0 ? wins.length / decided : 0;
    const lossPct = decided > 0 ? losses.length / decided : 0;
    const expectancy = (winPct * avgWinPct) - (lossPct * avgLossPct);
    
    return {
      wins: wins.length,
      losses: losses.length,
      neutral: neutral.length,
      total: closedPositions.length,
      decided,
      winRate: Math.round(winRate * 10) / 10,
      avgWinPct: Math.round(avgWinPct * 10) / 10,
      avgLossPct: Math.round(avgLossPct * 10) / 10,
      expectancy: Math.round(expectancy * 100) / 100,
    };
  }
}

export default WinRateService;
