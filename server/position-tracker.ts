/**
 * Position Tracker - Validates confidence scores with real results
 * Tracks LEAPS positions from entry to exit and calculates win rates
 */

import type { TradeIdea } from '../shared/schema';
import { storage } from './storage';
import { logger } from './logger';

interface PositionPerformance {
  tradeIdeaId: string;
  symbol: string;
  assetType: string;
  confidenceScore: number;
  source: string;
  entryDate: Date;
  exitDate?: Date;
  entryPrice: number;
  exitPrice?: number;
  targetPrice: number;
  stopLoss: number;
  percentGain?: number;
  outcome: 'open' | 'won' | 'lost' | 'expired' | 'hit_stop';
  daysHeld?: number;
  actualVsPredicted?: {
    predictedConfidence: number;
    actualResult: 'win' | 'loss';
    confidenceBucket: string; // "90-100%", "80-89%", etc.
  };
}

interface ConfidenceValidation {
  bucket: string; // "90-100%", "80-89%", "70-79%", "60-69%", "50-59%"
  totalClosed: number;
  wins: number;
  losses: number;
  actualWinRate: number;
  expectedWinRate: number; // Based on confidence
  accuracy: number; // How close actual is to expected
  avgGain: number;
  avgLoss: number;
  expectancy: number;
}

class PositionTracker {
  private performanceData: Map<string, PositionPerformance> = new Map();

  /**
   * Track a new position when trade idea is created
   */
  async trackNewPosition(idea: TradeIdea): Promise<void> {
    if (!idea.id) return;

    const performance: PositionPerformance = {
      tradeIdeaId: idea.id,
      symbol: idea.symbol,
      assetType: idea.assetType || 'unknown',
      confidenceScore: idea.confidenceScore || 0,
      source: idea.source || 'unknown',
      entryDate: new Date(idea.timestamp),
      entryPrice: idea.entryPrice || 0,
      targetPrice: idea.targetPrice || 0,
      stopLoss: idea.stopLoss || 0,
      outcome: 'open'
    };

    this.performanceData.set(idea.id, performance);

    logger.info(`📊 [TRACKER] New position tracked: ${idea.symbol} (${idea.confidenceScore}% confidence)`);
  }

  /**
   * Update position when outcome changes
   */
  async updatePosition(
    tradeIdeaId: string,
    updates: {
      outcome?: 'won' | 'lost' | 'expired' | 'hit_stop';
      exitPrice?: number;
      percentGain?: number;
    }
  ): Promise<void> {
    const position = this.performanceData.get(tradeIdeaId);
    if (!position) {
      logger.warn(`[TRACKER] Position not found: ${tradeIdeaId}`);
      return;
    }

    if (updates.outcome) position.outcome = updates.outcome;
    if (updates.exitPrice) position.exitPrice = updates.exitPrice;
    if (updates.percentGain !== undefined) position.percentGain = updates.percentGain;

    if (updates.outcome && updates.outcome !== 'open') {
      position.exitDate = new Date();
      position.daysHeld = Math.floor(
        (position.exitDate.getTime() - position.entryDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Calculate actual vs predicted
      const actualResult = updates.outcome === 'won' ? 'win' : 'loss';
      position.actualVsPredicted = {
        predictedConfidence: position.confidenceScore,
        actualResult,
        confidenceBucket: this.getConfidenceBucket(position.confidenceScore)
      };

      logger.info(
        `📊 [TRACKER] Position closed: ${position.symbol} - ` +
        `${updates.outcome.toUpperCase()} (${position.percentGain?.toFixed(2)}%) - ` +
        `Predicted: ${position.confidenceScore}%, Actual: ${actualResult}`
      );
    }

    this.performanceData.set(tradeIdeaId, position);
  }

  /**
   * Get confidence bucket for grouping
   */
  private getConfidenceBucket(score: number): string {
    if (score >= 90) return '90-100%';
    if (score >= 80) return '80-89%';
    if (score >= 70) return '70-79%';
    if (score >= 60) return '60-69%';
    return '50-59%';
  }

  /**
   * Calculate validation metrics for each confidence bucket
   */
  async validateConfidenceScores(): Promise<ConfidenceValidation[]> {
    const buckets: Map<string, ConfidenceValidation> = new Map();

    // Initialize buckets
    ['90-100%', '80-89%', '70-79%', '60-69%', '50-59%'].forEach(bucket => {
      const expectedWinRate = parseInt(bucket.split('-')[0]);
      buckets.set(bucket, {
        bucket,
        totalClosed: 0,
        wins: 0,
        losses: 0,
        actualWinRate: 0,
        expectedWinRate,
        accuracy: 0,
        avgGain: 0,
        avgLoss: 0,
        expectancy: 0
      });
    });

    // Aggregate closed positions
    const closedPositions = Array.from(this.performanceData.values()).filter(
      p => p.outcome !== 'open' && p.actualVsPredicted
    );

    for (const position of closedPositions) {
      const bucket = position.actualVsPredicted!.confidenceBucket;
      const validation = buckets.get(bucket)!;

      validation.totalClosed++;

      if (position.actualVsPredicted!.actualResult === 'win') {
        validation.wins++;
        if (position.percentGain) {
          validation.avgGain += position.percentGain;
        }
      } else {
        validation.losses++;
        if (position.percentGain) {
          validation.avgLoss += position.percentGain;
        }
      }
    }

    // Calculate final metrics
    buckets.forEach(validation => {
      if (validation.totalClosed > 0) {
        validation.actualWinRate = (validation.wins / validation.totalClosed) * 100;
        validation.accuracy = 100 - Math.abs(validation.actualWinRate - validation.expectedWinRate);

        if (validation.wins > 0) {
          validation.avgGain = validation.avgGain / validation.wins;
        }
        if (validation.losses > 0) {
          validation.avgLoss = validation.avgLoss / validation.losses;
        }

        validation.expectancy =
          (validation.avgGain * (validation.wins / validation.totalClosed)) +
          (validation.avgLoss * (validation.losses / validation.totalClosed));
      }
    });

    return Array.from(buckets.values()).filter(v => v.totalClosed > 0);
  }

  /**
   * Get performance summary
   */
  async getPerformanceSummary(filters?: {
    source?: string;
    assetType?: string;
    minConfidence?: number;
  }): Promise<{
    totalTracked: number;
    open: number;
    closed: number;
    winRate: number;
    avgGain: number;
    avgLoss: number;
    expectancy: number;
    bySource: Map<string, { wins: number; losses: number; winRate: number }>;
  }> {
    let positions = Array.from(this.performanceData.values());

    // Apply filters
    if (filters?.source) {
      positions = positions.filter(p => p.source === filters.source);
    }
    if (filters?.assetType) {
      positions = positions.filter(p => p.assetType === filters.assetType);
    }
    if (filters?.minConfidence) {
      positions = positions.filter(p => p.confidenceScore >= filters.minConfidence);
    }

    const closed = positions.filter(p => p.outcome !== 'open');
    const open = positions.filter(p => p.outcome === 'open');
    const won = closed.filter(p => p.outcome === 'won');
    const lost = closed.filter(p => p.outcome === 'lost' || p.outcome === 'hit_stop' || p.outcome === 'expired');

    const winRate = closed.length > 0 ? (won.length / closed.length) * 100 : 0;
    const avgGain = won.length > 0
      ? won.reduce((sum, p) => sum + (p.percentGain || 0), 0) / won.length
      : 0;
    const avgLoss = lost.length > 0
      ? lost.reduce((sum, p) => sum + (p.percentGain || 0), 0) / lost.length
      : 0;
    const expectancy = closed.length > 0
      ? (avgGain * (won.length / closed.length)) + (avgLoss * (lost.length / closed.length))
      : 0;

    // Calculate by source
    const bySource = new Map<string, { wins: number; losses: number; winRate: number }>();
    const sources = new Set(positions.map(p => p.source));

    sources.forEach(source => {
      const sourcePositions = closed.filter(p => p.source === source);
      const sourceWins = sourcePositions.filter(p => p.outcome === 'won').length;
      const sourceLosses = sourcePositions.filter(p => p.outcome !== 'won').length;
      const sourceWinRate = sourcePositions.length > 0
        ? (sourceWins / sourcePositions.length) * 100
        : 0;

      bySource.set(source, {
        wins: sourceWins,
        losses: sourceLosses,
        winRate: sourceWinRate
      });
    });

    return {
      totalTracked: positions.length,
      open: open.length,
      closed: closed.length,
      winRate,
      avgGain,
      avgLoss,
      expectancy,
      bySource
    };
  }

  /**
   * Auto-check positions that may have reached targets/stops
   */
  async checkOpenPositions(currentPrices: Map<string, number>): Promise<void> {
    const openPositions = Array.from(this.performanceData.values()).filter(
      p => p.outcome === 'open'
    );

    for (const position of openPositions) {
      const currentPrice = currentPrices.get(position.symbol);
      if (!currentPrice) continue;

      // Check if target hit
      if (currentPrice >= position.targetPrice) {
        const percentGain = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        await this.updatePosition(position.tradeIdeaId, {
          outcome: 'won',
          exitPrice: currentPrice,
          percentGain
        });

        // Update in storage
        await storage.updateTradeIdea(position.tradeIdeaId, {
          outcomeStatus: 'won',
          exitPrice: currentPrice,
          percentGain
        });
      }
      // Check if stop hit
      else if (currentPrice <= position.stopLoss) {
        const percentGain = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        await this.updatePosition(position.tradeIdeaId, {
          outcome: 'hit_stop',
          exitPrice: currentPrice,
          percentGain
        });

        // Update in storage
        await storage.updateTradeIdea(position.tradeIdeaId, {
          outcomeStatus: 'hit_stop',
          exitPrice: currentPrice,
          percentGain
        });
      }
    }
  }

  /**
   * Export validation report
   */
  async generateValidationReport(): Promise<string> {
    const validations = await this.validateConfidenceScores();
    const summary = await getPerformanceSummary();

    let report = '# CONFIDENCE SCORE VALIDATION REPORT\n\n';
    report += `Generated: ${new Date().toLocaleString()}\n\n`;
    report += '## Overall Performance\n\n';
    report += `- Total Tracked: ${summary.totalTracked}\n`;
    report += `- Open Positions: ${summary.open}\n`;
    report += `- Closed Positions: ${summary.closed}\n`;
    report += `- Win Rate: ${summary.winRate.toFixed(1)}%\n`;
    report += `- Avg Win: +${summary.avgGain.toFixed(2)}%\n`;
    report += `- Avg Loss: ${summary.avgLoss.toFixed(2)}%\n`;
    report += `- Expectancy: ${summary.expectancy.toFixed(2)}%\n\n`;

    report += '## By Source\n\n';
    summary.bySource.forEach((stats, source) => {
      report += `### ${source}\n`;
      report += `- Wins: ${stats.wins} | Losses: ${stats.losses}\n`;
      report += `- Win Rate: ${stats.winRate.toFixed(1)}%\n\n`;
    });

    report += '## Confidence Score Accuracy\n\n';
    report += '| Bucket | Closed | Wins | Losses | Expected WR | Actual WR | Accuracy | Expectancy |\n';
    report += '|--------|--------|------|--------|-------------|-----------|----------|------------|\n';

    validations.forEach(v => {
      report += `| ${v.bucket} | ${v.totalClosed} | ${v.wins} | ${v.losses} | `;
      report += `${v.expectedWinRate}% | ${v.actualWinRate.toFixed(1)}% | `;
      report += `${v.accuracy.toFixed(1)}% | ${v.expectancy.toFixed(2)}% |\n`;
    });

    return report;
  }
}

// Singleton instance
export const positionTracker = new PositionTracker();

// Helper function for outside access
export async function getPerformanceSummary(filters?: any) {
  return positionTracker.getPerformanceSummary(filters);
}

export async function generateValidationReport(): Promise<string> {
  return positionTracker.generateValidationReport();
}
