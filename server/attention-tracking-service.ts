/**
 * Symbol Attention Tracker Service
 * 
 * Tracks how many times each symbol is flagged across all scanners and systems.
 * Convergence of multiple systems independently identifying the same symbol = strong signal.
 * 
 * Key insight: When OKLO, LUNR, ASTS keep appearing across pre-market surge detector,
 * bullish trend scanner, trade idea generator, etc. - that pattern itself is valuable.
 */

import { db } from './db';
import { 
  attentionEvents, 
  symbolHeatScores,
  type AttentionSource, 
  type AttentionEventType,
  type InsertAttentionEvent 
} from '@shared/schema';
import { eq, desc, sql, gte, and } from 'drizzle-orm';
import { logger } from './logger';

// Source weights - higher weight = more important signal
const SOURCE_WEIGHTS: Record<AttentionSource, number> = {
  pre_market_surge: 2.0,    // Early mover detection = high value
  best_setup: 1.8,          // Curated high-conviction picks
  trade_idea: 1.5,          // Quant engine signals
  catalyst_alert: 1.5,      // News/catalyst driven
  ml_signal: 1.4,           // ML predictions
  bullish_trend: 1.2,       // Trend following
  market_scanner: 1.0,      // General scanning
  watchlist_grade: 1.0,     // Grade changes
  mover_discovery: 0.8,     // General mover detection
  manual: 0.5,              // Manual additions
};

// Decay time constant (30 minutes in ms)
const DECAY_TAU = 30 * 60 * 1000;

// Alert thresholds
const CONVERGENCE_THRESHOLD = 3; // 3+ distinct sources = convergence
const HEAT_ALERT_THRESHOLD = 5.0; // Heat score to trigger Discord alert
const CONVERGENCE_WINDOW_MS = 30 * 60 * 1000; // 30 minute window for convergence

// In-memory buffer for batching writes
interface BufferedEvent {
  symbol: string;
  source: AttentionSource;
  eventType: AttentionEventType;
  eventData?: {
    price?: number;
    changePercent?: number;
    direction?: 'bullish' | 'bearish';
    confidence?: number;
    grade?: string;
    message?: string;
  };
  scoreWeight: number;
  occurredAt: Date;
}

const eventBuffer: BufferedEvent[] = [];
const FLUSH_INTERVAL = 5000; // Flush every 5 seconds

// Deduplication cache to prevent spam (symbol:source -> last event time)
const recentEvents = new Map<string, Date>();
const DEDUPE_COOLDOWN_MS = 60000; // 1 minute cooldown per symbol:source combo

/**
 * Record a symbol attention event from any scanner/system
 * This is the main entry point that all other services call
 */
export async function recordSymbolAttention(
  symbol: string,
  source: AttentionSource,
  eventType: AttentionEventType,
  eventData?: {
    price?: number;
    changePercent?: number;
    direction?: 'bullish' | 'bearish';
    confidence?: number;
    grade?: string;
    message?: string;
  }
): Promise<void> {
  const key = `${symbol}:${source}`;
  const now = new Date();
  
  // Check deduplication
  const lastEvent = recentEvents.get(key);
  if (lastEvent && (now.getTime() - lastEvent.getTime()) < DEDUPE_COOLDOWN_MS) {
    logger.debug(`[ATTENTION] Skipping duplicate ${symbol} from ${source} (cooldown)`);
    return;
  }
  
  recentEvents.set(key, now);
  
  // Add to buffer
  eventBuffer.push({
    symbol: symbol.toUpperCase(),
    source,
    eventType,
    eventData,
    scoreWeight: SOURCE_WEIGHTS[source] || 1.0,
    occurredAt: now,
  });
  
  logger.debug(`[ATTENTION] Buffered ${symbol} from ${source} (${eventType})`);
}

/**
 * Flush buffered events to database
 */
async function flushEventBuffer(): Promise<void> {
  if (eventBuffer.length === 0) return;
  
  const events = [...eventBuffer];
  eventBuffer.length = 0; // Clear buffer
  
  try {
    // Batch insert events
    await db.insert(attentionEvents).values(
      events.map(e => ({
        symbol: e.symbol,
        source: e.source,
        eventType: e.eventType,
        eventData: e.eventData,
        scoreWeight: e.scoreWeight,
        occurredAt: e.occurredAt,
      }))
    );
    
    logger.info(`[ATTENTION] Flushed ${events.length} events to database`);
    
    // Update heat scores for affected symbols
    const uniqueSymbols = Array.from(new Set(events.map(e => e.symbol)));
    for (const symbol of uniqueSymbols) {
      await updateHeatScore(symbol);
    }
  } catch (error) {
    logger.error('[ATTENTION] Failed to flush events:', error);
    // Put events back in buffer for retry
    eventBuffer.push(...events);
  }
}

/**
 * Calculate exponential decay weight based on time difference
 */
function calculateDecayWeight(eventTime: Date, now: Date): number {
  const deltaMs = now.getTime() - eventTime.getTime();
  return Math.exp(-deltaMs / DECAY_TAU);
}

/**
 * Update heat score for a single symbol
 */
async function updateHeatScore(symbol: string): Promise<void> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const convergenceWindowStart = new Date(now.getTime() - CONVERGENCE_WINDOW_MS);
  
  try {
    // Get all events for this symbol in last 24 hours
    const events = await db
      .select()
      .from(attentionEvents)
      .where(
        and(
          eq(attentionEvents.symbol, symbol),
          gte(attentionEvents.occurredAt, twentyFourHoursAgo)
        )
      )
      .orderBy(desc(attentionEvents.occurredAt));
    
    if (events.length === 0) return;
    
    // Calculate metrics
    let heatScore = 0;
    const sourceSet = new Set<AttentionSource>();
    const sourceCounts: Partial<Record<AttentionSource, number>> = {};
    let recentTouches1h = 0;
    let recentSources = new Set<AttentionSource>();
    
    for (const event of events) {
      const weight = (event.scoreWeight || 1.0) * calculateDecayWeight(event.occurredAt, now);
      heatScore += weight;
      
      sourceSet.add(event.source);
      sourceCounts[event.source] = (sourceCounts[event.source] || 0) + 1;
      
      if (event.occurredAt >= oneHourAgo) {
        recentTouches1h++;
      }
      
      if (event.occurredAt >= convergenceWindowStart) {
        recentSources.add(event.source);
      }
    }
    
    const latestEvent = events[0];
    const isConverging = recentSources.size >= CONVERGENCE_THRESHOLD;
    const convergenceLevel = Math.min(5, recentSources.size);
    
    // Upsert heat score
    await db
      .insert(symbolHeatScores)
      .values({
        symbol,
        heatScore: Math.round(heatScore * 100) / 100,
        rawTouchCount: events.length,
        distinctSources: sourceSet.size,
        recentTouches1h,
        recentTouches24h: events.length,
        sourceBreakdown: sourceCounts as Record<AttentionSource, number>,
        lastSource: latestEvent.source,
        lastEventType: latestEvent.eventType,
        lastPrice: latestEvent.eventData?.price,
        lastDirection: latestEvent.eventData?.direction,
        isConverging,
        convergenceLevel,
        firstTouchAt: events[events.length - 1].occurredAt,
        lastTouchAt: latestEvent.occurredAt,
      })
      .onConflictDoUpdate({
        target: symbolHeatScores.symbol,
        set: {
          heatScore: Math.round(heatScore * 100) / 100,
          rawTouchCount: events.length,
          distinctSources: sourceSet.size,
          recentTouches1h,
          recentTouches24h: events.length,
          sourceBreakdown: sourceCounts as Record<AttentionSource, number>,
          lastSource: latestEvent.source,
          lastEventType: latestEvent.eventType,
          lastPrice: latestEvent.eventData?.price,
          lastDirection: latestEvent.eventData?.direction,
          isConverging,
          convergenceLevel,
          lastTouchAt: latestEvent.occurredAt,
          updatedAt: now,
        },
      });
    
    // Log convergence events
    if (isConverging) {
      logger.info(`[ATTENTION] 🔥 CONVERGENCE: ${symbol} flagged by ${recentSources.size} sources: ${Array.from(recentSources).join(', ')}`);
    }
    
  } catch (error) {
    logger.error(`[ATTENTION] Failed to update heat score for ${symbol}:`, error);
  }
}

/**
 * Get top hot symbols by heat score
 */
export async function getHotSymbols(limit: number = 20): Promise<Array<{
  symbol: string;
  heatScore: number;
  distinctSources: number;
  recentTouches1h: number;
  isConverging: boolean;
  convergenceLevel: number;
  lastSource: AttentionSource | null;
  lastDirection: string | null;
  sourceBreakdown: Record<string, number> | null;
  lastTouchAt: Date | null;
}>> {
  try {
    const results = await db
      .select({
        symbol: symbolHeatScores.symbol,
        heatScore: symbolHeatScores.heatScore,
        distinctSources: symbolHeatScores.distinctSources,
        recentTouches1h: symbolHeatScores.recentTouches1h,
        isConverging: symbolHeatScores.isConverging,
        convergenceLevel: symbolHeatScores.convergenceLevel,
        lastSource: symbolHeatScores.lastSource,
        lastDirection: symbolHeatScores.lastDirection,
        sourceBreakdown: symbolHeatScores.sourceBreakdown,
        lastTouchAt: symbolHeatScores.lastTouchAt,
      })
      .from(symbolHeatScores)
      .orderBy(desc(symbolHeatScores.heatScore))
      .limit(limit);
    
    // Map nullable values to defaults
    return results.map(r => ({
      symbol: r.symbol,
      heatScore: r.heatScore ?? 0,
      distinctSources: r.distinctSources ?? 0,
      recentTouches1h: r.recentTouches1h ?? 0,
      isConverging: r.isConverging ?? false,
      convergenceLevel: r.convergenceLevel ?? 0,
      lastSource: r.lastSource,
      lastDirection: r.lastDirection,
      sourceBreakdown: r.sourceBreakdown,
      lastTouchAt: r.lastTouchAt,
    }));
  } catch (error) {
    logger.error('[ATTENTION] Failed to get hot symbols:', error);
    return [];
  }
}

/**
 * Get attention history for a specific symbol
 */
export async function getSymbolAttentionHistory(
  symbol: string,
  hours: number = 24
): Promise<Array<{
  source: AttentionSource;
  eventType: AttentionEventType;
  eventData: any;
  occurredAt: Date;
}>> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  try {
    const events = await db
      .select({
        source: attentionEvents.source,
        eventType: attentionEvents.eventType,
        eventData: attentionEvents.eventData,
        occurredAt: attentionEvents.occurredAt,
      })
      .from(attentionEvents)
      .where(
        and(
          eq(attentionEvents.symbol, symbol.toUpperCase()),
          gte(attentionEvents.occurredAt, since)
        )
      )
      .orderBy(desc(attentionEvents.occurredAt));
    
    return events;
  } catch (error) {
    logger.error(`[ATTENTION] Failed to get history for ${symbol}:`, error);
    return [];
  }
}

/**
 * Clean up old events (run daily)
 */
async function cleanupOldEvents(): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
  
  try {
    const result = await db
      .delete(attentionEvents)
      .where(sql`${attentionEvents.occurredAt} < ${cutoff}`);
    
    logger.info('[ATTENTION] Cleaned up old attention events');
  } catch (error) {
    logger.error('[ATTENTION] Failed to cleanup old events:', error);
  }
}

// Flush interval
let flushInterval: NodeJS.Timeout | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the attention tracking service
 */
export function startAttentionTrackingService(): void {
  logger.info('[ATTENTION] Starting Symbol Attention Tracker...');
  
  // Flush buffer every 5 seconds
  flushInterval = setInterval(flushEventBuffer, FLUSH_INTERVAL);
  
  // Cleanup old events daily
  cleanupInterval = setInterval(cleanupOldEvents, 24 * 60 * 60 * 1000);
  
  logger.info('[ATTENTION] Symbol Attention Tracker started');
}

/**
 * Stop the attention tracking service
 */
export function stopAttentionTrackingService(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  
  // Final flush
  flushEventBuffer().catch(err => logger.error('[ATTENTION] Final flush failed:', err));
  
  logger.info('[ATTENTION] Symbol Attention Tracker stopped');
}
