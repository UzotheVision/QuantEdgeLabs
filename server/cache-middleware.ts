/**
 * Request Caching Middleware
 * In-memory cache for API responses to reduce database load and improve response times
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number;
}

// In-memory cache store
const cache = new Map<string, CacheEntry>();

// Cache statistics
const stats = {
  hits: 0,
  misses: 0,
  size: 0,
};

// Default TTL values (in milliseconds)
export const CACHE_TTL = {
  MARKET_DATA: 60 * 1000,        // 1 minute for market data
  MARKET_BATCH: 30 * 1000,       // 30 seconds for batch quotes
  TRADE_IDEAS: 5 * 60 * 1000,    // 5 minutes for trade ideas
  MOVERS: 60 * 1000,             // 1 minute for top movers
  NEWS: 2 * 60 * 1000,           // 2 minutes for news
  BLOG: 10 * 60 * 1000,          // 10 minutes for blog posts
  STATIC: 30 * 60 * 1000,        // 30 minutes for static content
  USER_DATA: 30 * 1000,          // 30 seconds for user-specific data
  PERFORMANCE: 5 * 60 * 1000,    // 5 minutes for performance metrics
  WATCHLIST: 60 * 1000,          // 1 minute for watchlist data
};

/**
 * Generate cache key from request
 */
function generateCacheKey(req: Request): string {
  const userId = (req as any).user?.id || 'anonymous';
  return `${req.method}:${req.originalUrl}:${userId}`;
}

/**
 * Check if cache entry is still valid
 */
function isValid(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < entry.ttl;
}

/**
 * Clean up expired entries (run periodically)
 */
function cleanup(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp >= entry.ttl) {
      cache.delete(key);
      cleaned++;
    }
  }

  stats.size = cache.size;

  if (cleaned > 0) {
    logger.debug(`[CACHE] Cleaned ${cleaned} expired entries. Size: ${cache.size}`);
  }
}

// Run cleanup every 5 minutes
setInterval(cleanup, 5 * 60 * 1000);

/**
 * Cache middleware factory
 * @param ttl Time-to-live in milliseconds
 * @param keyGenerator Optional custom key generator
 */
export function cacheMiddleware(
  ttl: number,
  options: {
    keyGenerator?: (req: Request) => string;
    userSpecific?: boolean;
    skipCondition?: (req: Request) => boolean;
  } = {}
) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip caching for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip if condition is met
    if (options.skipCondition && options.skipCondition(req)) {
      return next();
    }

    const cacheKey = options.keyGenerator
      ? options.keyGenerator(req)
      : options.userSpecific
        ? generateCacheKey(req)
        : `${req.method}:${req.originalUrl}`;

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && isValid(cached)) {
      stats.hits++;
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-Age', Math.floor((Date.now() - cached.timestamp) / 1000));
      return res.json(cached.data);
    }

    stats.misses++;
    res.setHeader('X-Cache', 'MISS');

    // Override res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (data: any) => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(cacheKey, {
          data,
          timestamp: Date.now(),
          ttl,
        });
        stats.size = cache.size;
      }
      return originalJson(data);
    };

    next();
  };
}

/**
 * Invalidate cache entries matching a pattern
 */
export function invalidateCache(pattern: string | RegExp): number {
  let invalidated = 0;

  for (const key of cache.keys()) {
    if (typeof pattern === 'string' ? key.includes(pattern) : pattern.test(key)) {
      cache.delete(key);
      invalidated++;
    }
  }

  stats.size = cache.size;
  logger.debug(`[CACHE] Invalidated ${invalidated} entries matching pattern`);
  return invalidated;
}

/**
 * Clear entire cache
 */
export function clearCache(): void {
  cache.clear();
  stats.size = 0;
  logger.info('[CACHE] Cache cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
} {
  const total = stats.hits + stats.misses;
  return {
    ...stats,
    hitRate: total > 0 ? stats.hits / total : 0,
  };
}

/**
 * Preset cache middleware for common endpoints
 */
export const cachePresets = {
  marketData: cacheMiddleware(CACHE_TTL.MARKET_DATA),
  marketBatch: cacheMiddleware(CACHE_TTL.MARKET_BATCH),
  tradeIdeas: cacheMiddleware(CACHE_TTL.TRADE_IDEAS),
  movers: cacheMiddleware(CACHE_TTL.MOVERS),
  news: cacheMiddleware(CACHE_TTL.NEWS),
  blog: cacheMiddleware(CACHE_TTL.BLOG),
  static: cacheMiddleware(CACHE_TTL.STATIC),
  performance: cacheMiddleware(CACHE_TTL.PERFORMANCE),
  userSpecific: (ttl: number = CACHE_TTL.USER_DATA) =>
    cacheMiddleware(ttl, { userSpecific: true }),
};

export default {
  cacheMiddleware,
  cachePresets,
  invalidateCache,
  clearCache,
  getCacheStats,
  CACHE_TTL,
};
