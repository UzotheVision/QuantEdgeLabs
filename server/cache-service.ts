/**
 * Response Caching Service
 *
 * CRITICAL: Only caches NON-timing-sensitive data
 * - Admin dashboards
 * - Historical analytics
 * - Performance reports
 *
 * NEVER caches:
 * - Live prices
 * - Trade signals
 * - Entry/exit timing
 * - Market data
 */

import { logger } from './logger';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class CacheService {
  private cache = new Map<string, CacheEntry<any>>();
  private maxSize = 100; // Limit cache size to prevent memory issues

  /**
   * Get cached data if not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    if (age > entry.ttl) {
      // Expired - remove from cache
      this.cache.delete(key);
      return null;
    }

    logger.debug(`[CACHE] HIT: ${key} (age: ${Math.round(age / 1000)}s)`);
    return entry.data as T;
  }

  /**
   * Set cache entry with TTL
   */
  set<T>(key: string, data: T, ttlSeconds: number): void {
    // Enforce cache size limit (LRU-style)
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      logger.debug(`[CACHE] Evicted oldest entry: ${oldestKey}`);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlSeconds * 1000
    });

    logger.debug(`[CACHE] SET: ${key} (TTL: ${ttlSeconds}s)`);
  }

  /**
   * Invalidate specific cache key
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    logger.debug(`[CACHE] INVALIDATED: ${key}`);
  }

  /**
   * Invalidate all keys matching pattern
   */
  invalidatePattern(pattern: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      logger.debug(`[CACHE] INVALIDATED ${count} keys matching: ${pattern}`);
    }
    return count;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.info(`[CACHE] CLEARED ${size} entries`);
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      entries: Array.from(this.cache.keys())
    };
  }

  /**
   * Cleanup expired entries (run periodically)
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > entry.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug(`[CACHE] CLEANUP: Removed ${removed} expired entries`);
    }

    return removed;
  }
}

export const cacheService = new CacheService();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  cacheService.cleanup();
}, 5 * 60 * 1000);

/**
 * Cache TTL Constants
 *
 * STRICT RULES:
 * - Admin/historical data: 60-300 seconds OK
 * - User settings: 30-60 seconds OK
 * - NEVER cache live prices, signals, or market data
 */
export const CACHE_TTL = {
  ADMIN_STATS: 120,        // 2 minutes - admin dashboard stats
  ADMIN_USERS: 60,         // 1 minute - user list
  PERFORMANCE_REPORT: 300, // 5 minutes - historical performance
  USER_SETTINGS: 30,       // 30 seconds - user preferences
  ENGINE_HEALTH: 60,       // 1 minute - engine metrics (already aggregated)
} as const;
