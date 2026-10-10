/**
 * Analysis Logger - Audit Trail System
 *
 * Logs every analysis performed by the Universal Engine
 * for reproducibility and verification
 */

import { logger } from './logger';
import { db } from './db';
import { analysisAuditLog } from '../shared/schema';

interface AnalysisLogEntry {
  auditId: string;
  symbol: string;
  timestamp: string;
  params: any;
  result: any;
  duration: number; // ms
}

class AnalysisLogger {
  /**
   * Log an analysis to the audit trail
   */
  async log(entry: AnalysisLogEntry): Promise<void> {
    try {
      // Log to database
      await this.logToDatabase(entry);

      // Also log summary to console
      logger.info(`[AUDIT] ${entry.symbol} analysis logged`, {
        auditId: entry.auditId,
        score: entry.result?.overall?.score,
        grade: entry.result?.overall?.grade,
        duration: entry.duration
      });

    } catch (error: any) {
      logger.error('[AUDIT] Failed to log analysis:', error);
      // Don't throw - logging failure shouldn't break analysis
    }
  }

  /**
   * Log to database
   */
  private async logToDatabase(entry: AnalysisLogEntry): Promise<void> {
    try {
      await db.insert(analysisAuditLog).values({
        auditId: entry.auditId,
        symbol: entry.symbol,
        timestamp: new Date(entry.timestamp),
        engineVersion: 'UniversalEngine_v1.0',
        params: entry.params,
        result: entry.result,
        duration: entry.duration,
        consumedBy: this.detectConsumer(entry.params)
      });
    } catch (error: any) {
      // If table doesn't exist, log to file instead
      logger.warn('[AUDIT] Database logging failed, using fallback:', error.message);
      await this.logToFile(entry);
    }
  }

  /**
   * Fallback: Log to file
   */
  private async logToFile(entry: AnalysisLogEntry): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');

    const logDir = path.join(process.cwd(), 'logs', 'audit');
    const logFile = path.join(logDir, `${entry.symbol}_${new Date().toISOString().split('T')[0]}.jsonl`);

    try {
      // Ensure directory exists
      await fs.mkdir(logDir, { recursive: true });

      // Append log entry as JSONL (one JSON object per line)
      const logLine = JSON.stringify({
        ...entry,
        loggedAt: new Date().toISOString()
      }) + '\n';

      await fs.appendFile(logFile, logLine, 'utf-8');

    } catch (error: any) {
      logger.error('[AUDIT] File logging also failed:', error);
    }
  }

  /**
   * Detect which page/component consumed this analysis
   */
  private detectConsumer(params: any): string {
    if (params.timeHorizon === 'SWING' && params.minScore) {
      return 'TradeDeskPage';
    } else if (params.focus === 'ALL') {
      return 'ResearchHub';
    } else if (params.includeBreakdown) {
      return 'StockDetailPage';
    } else if (params.timeHorizon === 'DAY') {
      return 'ChartAnalysis';
    } else {
      return 'Unknown';
    }
  }

  /**
   * Get analysis audit by ID
   */
  async getAudit(auditId: string): Promise<any | null> {
    try {
      const results = await db
        .select()
        .from(analysisAuditLog)
        .where(eq(analysisAuditLog.auditId, auditId))
        .limit(1);

      return results.length > 0 ? results[0] : null;

    } catch (error: any) {
      logger.error(`[AUDIT] Failed to retrieve audit ${auditId}:`, error);
      return null;
    }
  }

  /**
   * Get analysis history for a symbol
   */
  async getSymbolHistory(symbol: string, limit: number = 10): Promise<any[]> {
    try {
      const results = await db
        .select()
        .from(analysisAuditLog)
        .where(eq(analysisAuditLog.symbol, symbol.toUpperCase()))
        .orderBy(desc(analysisAuditLog.timestamp))
        .limit(limit);

      return results;

    } catch (error: any) {
      logger.error(`[AUDIT] Failed to retrieve history for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Compare two analyses
   */
  async compareAnalyses(symbol: string, fromDate: Date, toDate: Date): Promise<any> {
    try {
      const analyses = await db
        .select()
        .from(analysisAuditLog)
        .where(
          and(
            eq(analysisAuditLog.symbol, symbol.toUpperCase()),
            gte(analysisAuditLog.timestamp, fromDate),
            lte(analysisAuditLog.timestamp, toDate)
          )
        )
        .orderBy(asc(analysisAuditLog.timestamp));

      if (analyses.length < 2) {
        return {
          error: 'Not enough analyses in date range for comparison'
        };
      }

      const first = analyses[0];
      const last = analyses[analyses.length - 1];

      // Calculate score changes
      const scoreChange = last.result.overall.score - first.result.overall.score;
      const gradeChange = {
        from: first.result.overall.grade,
        to: last.result.overall.grade
      };

      // Component changes
      const componentChanges: any = {};
      Object.keys(first.result.components).forEach(key => {
        componentChanges[key] = {
          from: first.result.components[key].score,
          to: last.result.components[key].score,
          change: last.result.components[key].score - first.result.components[key].score
        };
      });

      return {
        symbol,
        period: {
          from: first.timestamp,
          to: last.timestamp
        },
        overallChange: {
          scoreChange,
          gradeChange
        },
        componentChanges,
        analysisCount: analyses.length
      };

    } catch (error: any) {
      logger.error(`[AUDIT] Failed to compare analyses for ${symbol}:`, error);
      return { error: error.message };
    }
  }

  /**
   * Check consistency across all analyses
   */
  async checkConsistency(): Promise<{
    consistent: boolean;
    issues: string[];
  }> {
    try {
      const recentAnalyses = await db
        .select()
        .from(analysisAuditLog)
        .orderBy(desc(analysisAuditLog.timestamp))
        .limit(100);

      const issues: string[] = [];

      // Check 1: All analyses use same engine version
      const versions = new Set(recentAnalyses.map(a => a.engineVersion));
      if (versions.size > 1) {
        issues.push(`Multiple engine versions detected: ${Array.from(versions).join(', ')}`);
      }

      // Check 2: Score calculations are consistent
      for (const analysis of recentAnalyses) {
        const result = analysis.result;
        if (!result?.components) continue;

        // Recalculate overall score
        const recalculated =
          result.components.technical.score * 0.25 +
          result.components.fundamental.score * 0.30 +
          result.components.quantitative.score * 0.15 +
          result.components.ml.score * 0.10 +
          result.components.orderFlow.score * 0.15 +
          result.components.sentiment.score * 0.10 +
          result.components.catalysts.score * 0.05;

        const diff = Math.abs(recalculated - result.overall.score);

        if (diff > 1) { // Allow 1 point rounding difference
          issues.push(`Inconsistent score calculation for ${analysis.symbol} (${analysis.auditId}): expected ${recalculated}, got ${result.overall.score}`);
        }
      }

      return {
        consistent: issues.length === 0,
        issues
      };

    } catch (error: any) {
      logger.error('[AUDIT] Consistency check failed:', error);
      return {
        consistent: false,
        issues: [`Consistency check failed: ${error.message}`]
      };
    }
  }
}

// Import missing helpers
import { eq, and, gte, lte, desc, asc } from 'drizzle-orm';

export const analysisLogger = new AnalysisLogger();
