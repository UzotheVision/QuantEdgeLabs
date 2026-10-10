import { marketDataStatus } from './market-data-status';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  provider: string;
}

interface CacheConfig {
  maxAge: number;
  staleAge: number;
}

const CACHE_CONFIGS: Record<string, CacheConfig> = {
  quote: { maxAge: 30 * 1000, staleAge: 5 * 60 * 1000 },
  optionsChain: { maxAge: 60 * 1000, staleAge: 10 * 60 * 1000 },
  news: { maxAge: 5 * 60 * 1000, staleAge: 30 * 60 * 1000 },
  historical: { maxAge: 60 * 60 * 1000, staleAge: 24 * 60 * 60 * 1000 },
};

class APICache {
  private cache = new Map<string, CacheEntry<any>>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  private getCacheKey(type: string, ...args: string[]): string {
    return `${type}:${args.join(':')}`;
  }

  private getConfig(type: string): CacheConfig {
    return CACHE_CONFIGS[type] || { maxAge: 60 * 1000, staleAge: 5 * 60 * 1000 };
  }

  set<T>(type: string, key: string, data: T, provider: string): void {
    const cacheKey = this.getCacheKey(type, key);
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
      provider,
    });
  }

  get<T>(type: string, key: string): { data: T; isStale: boolean; age: number; provider: string } | null {
    const cacheKey = this.getCacheKey(type, key);
    const entry = this.cache.get(cacheKey);
    
    if (!entry) return null;
    
    const config = this.getConfig(type);
    const age = Date.now() - entry.timestamp;
    
    if (age > config.staleAge) {
      this.cache.delete(cacheKey);
      return null;
    }
    
    return {
      data: entry.data as T,
      isStale: age > config.maxAge,
      age,
      provider: entry.provider,
    };
  }

  getWithFallback<T>(
    type: string,
    key: string,
    provider: string,
    fetchFn: () => Promise<T>
  ): Promise<{ data: T; fromCache: boolean; isStale: boolean; cacheAge?: number }> {
    return this.getWithFallbackAndStatus(type, key, provider, fetchFn);
  }

  async getWithFallbackAndStatus<T>(
    type: string,
    key: string,
    provider: string,
    fetchFn: () => Promise<T>
  ): Promise<{ data: T; fromCache: boolean; isStale: boolean; cacheAge?: number }> {
    const providerStatus = marketDataStatus.getProviderStatus(provider);
    const isProviderHealthy = providerStatus?.status === 'healthy' || providerStatus?.status === 'unknown';
    
    const cached = this.get<T>(type, key);
    
    if (cached && !cached.isStale && isProviderHealthy) {
      return { data: cached.data, fromCache: true, isStale: false, cacheAge: cached.age };
    }
    
    if (isProviderHealthy || !cached) {
      try {
        const data = await fetchFn();
        this.set(type, key, data, provider);
        return { data, fromCache: false, isStale: false };
      } catch (error) {
        if (cached) {
          console.log(`[CACHE] Serving stale ${type} for ${key} due to fetch error`);
          return { data: cached.data, fromCache: true, isStale: true, cacheAge: cached.age };
        }
        throw error;
      }
    }
    
    if (cached) {
      console.log(`[CACHE] Serving ${cached.isStale ? 'stale' : 'fresh'} ${type} for ${key} - provider ${provider} unhealthy`);
      return { data: cached.data, fromCache: true, isStale: cached.isStale, cacheAge: cached.age };
    }
    
    const data = await fetchFn();
    this.set(type, key, data, provider);
    return { data, fromCache: false, isStale: false };
  }

  private cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      const type = key.split(':')[0];
      const config = this.getConfig(type);
      if (now - entry.timestamp > config.staleAge) {
        this.cache.delete(key);
      }
    }
  }

  getStats(): { entries: number; types: Record<string, number> } {
    const types: Record<string, number> = {};
    const keys = Array.from(this.cache.keys());
    for (const key of keys) {
      const type = key.split(':')[0];
      types[type] = (types[type] || 0) + 1;
    }
    return { entries: this.cache.size, types };
  }

  clear(): void {
    this.cache.clear();
  }
}

export const apiCache = new APICache();

export function formatCacheAge(ageMs: number): string {
  if (ageMs < 60 * 1000) {
    return `${Math.round(ageMs / 1000)}s ago`;
  } else if (ageMs < 60 * 60 * 1000) {
    return `${Math.round(ageMs / 60000)}m ago`;
  } else {
    return `${Math.round(ageMs / 3600000)}h ago`;
  }
}
