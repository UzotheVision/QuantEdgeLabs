/**
 * WATCHLIST PRIORITY SERVICE
 * 
 * Connects watchlist intelligence to trading bots by:
 * 1. Identifying S/A tier symbols for priority scanning
 * 2. Detecting cheap premium opportunities for entry timing
 * 3. Providing symbol-level insights for bot decisions
 * 
 * This is the bridge between analysis and action - making the platform "learn"
 */

import { storage } from './storage';
import { logger } from './logger';

export interface PrioritySymbol {
  symbol: string;
  assetType: 'stock' | 'crypto' | 'futures';
  grade: string;
  score: number;
  reasons: string[];
  premiumOpportunity: boolean;
  premiumPercentile: number | null;
  confidenceBoost: number;
}

export interface WatchlistInsights {
  prioritySymbols: PrioritySymbol[];
  eliteCount: number;
  cheapPremiumCount: number;
  lastUpdated: string;
}

let cachedInsights: WatchlistInsights | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get high-priority symbols from watchlist for bot scanning
 * Cached for 5 minutes to avoid repeated DB hits
 */
export async function getWatchlistPrioritySymbols(): Promise<PrioritySymbol[]> {
  const now = Date.now();
  
  if (cachedInsights && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedInsights.prioritySymbols;
  }
  
  try {
    const items = await storage.getAllWatchlist();
    const prioritySymbols: PrioritySymbol[] = [];
    
    for (const item of items) {
      const grade = item.gradeLetter || 'C';
      const score = item.gradeScore || 50;
      const isElite = ['S', 'A', 'A+', 'A-'].includes(grade);
      const isStrong = ['S', 'A', 'A+', 'A-', 'B', 'B+', 'B-'].includes(grade);
      
      // Calculate confidence boost based on grade
      let confidenceBoost = 0;
      if (grade === 'S') confidenceBoost = 15;
      else if (grade.startsWith('A')) confidenceBoost = 10;
      else if (grade.startsWith('B')) confidenceBoost = 5;
      else if (grade.startsWith('D')) confidenceBoost = -5;
      else if (grade === 'F') confidenceBoost = -15;
      
      // Check premium opportunity
      const premiumPercentile = item.premiumPercentile || null;
      const premiumOpportunity = premiumPercentile !== null && premiumPercentile < 25;
      
      // Add extra boost for cheap premium opportunities
      if (premiumOpportunity) {
        confidenceBoost += 10;
      }
      
      // Build reasons array
      const reasons: string[] = [];
      if (isElite) reasons.push(`${grade}-tier elite setup`);
      if (premiumOpportunity) reasons.push(`Cheap premium (${premiumPercentile}th percentile)`);
      if (score >= 80) reasons.push(`High score: ${score}/100`);
      if (item.notes && item.notes.includes('Breakout')) reasons.push('Breakout candidate');
      
      // Normalize grade letter to single letter for sorting
      const normalizedGrade = grade.charAt(0);
      
      // Only include symbols with positive potential
      if (isStrong || premiumOpportunity) {
        prioritySymbols.push({
          symbol: item.symbol,
          assetType: (item.assetType || 'stock') as 'stock' | 'crypto' | 'futures',
          grade: normalizedGrade,
          score,
          reasons,
          premiumOpportunity,
          premiumPercentile,
          confidenceBoost
        });
      }
    }
    
    // Sort by grade (S first) then by score
    prioritySymbols.sort((a, b) => {
      const gradeOrder: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, F: 5 };
      const gradeA = gradeOrder[a.grade] ?? 3;
      const gradeB = gradeOrder[b.grade] ?? 3;
      if (gradeA !== gradeB) return gradeA - gradeB;
      return b.score - a.score;
    });
    
    // Cache results
    cachedInsights = {
      prioritySymbols,
      eliteCount: prioritySymbols.filter(s => ['S', 'A'].includes(s.grade)).length,
      cheapPremiumCount: prioritySymbols.filter(s => s.premiumOpportunity).length,
      lastUpdated: new Date().toISOString()
    };
    cacheTimestamp = now;
    
    logger.info(`[WATCHLIST-PRIORITY] Loaded ${prioritySymbols.length} priority symbols (${cachedInsights.eliteCount} elite, ${cachedInsights.cheapPremiumCount} cheap premiums)`);
    
    return prioritySymbols;
  } catch (error) {
    logger.error('[WATCHLIST-PRIORITY] Failed to load priority symbols:', error);
    return [];
  }
}

/**
 * Get confidence boost for a symbol based on watchlist intelligence
 * Used by Auto-Lotto Bot to adjust confidence scores
 */
export async function getWatchlistConfidenceBoost(symbol: string): Promise<{
  boost: number;
  reasons: string[];
  isElite: boolean;
  isPremiumOpportunity: boolean;
}> {
  const priorities = await getWatchlistPrioritySymbols();
  const match = priorities.find(p => p.symbol.toUpperCase() === symbol.toUpperCase());
  
  if (!match) {
    return { boost: 0, reasons: [], isElite: false, isPremiumOpportunity: false };
  }
  
  return {
    boost: match.confidenceBoost,
    reasons: match.reasons,
    isElite: ['S', 'A'].includes(match.grade),
    isPremiumOpportunity: match.premiumOpportunity
  };
}

/**
 * Get elite symbols only (S and A tier) for priority scanning
 */
export async function getEliteSymbols(): Promise<string[]> {
  const priorities = await getWatchlistPrioritySymbols();
  return priorities
    .filter(p => ['S', 'A'].includes(p.grade))
    .map(p => p.symbol);
}

/**
 * Get symbols with cheap premium opportunities
 */
export async function getCheapPremiumSymbols(): Promise<PrioritySymbol[]> {
  const priorities = await getWatchlistPrioritySymbols();
  return priorities.filter(p => p.premiumOpportunity);
}

/**
 * Invalidate cache (call after watchlist updates)
 */
export function invalidateWatchlistCache(): void {
  cachedInsights = null;
  cacheTimestamp = 0;
  logger.debug('[WATCHLIST-PRIORITY] Cache invalidated');
}

/**
 * Get summary for logging/display
 */
export async function getWatchlistInsightsSummary(): Promise<WatchlistInsights> {
  await getWatchlistPrioritySymbols(); // Ensure cache is populated
  return cachedInsights!;
}
