import { marketDataStatus } from './market-data-status';
import { logger } from './logger';

interface ThrottleConfig {
  maxRequestsPerSecond: number;
  burstLimit: number;
}

interface RequestQueue {
  pending: Array<{
    resolve: (value: void) => void;
    reject: (error: Error) => void;
    timestamp: number;
  }>;
  lastRequest: number;
  tokens: number;
}

const THROTTLE_CONFIGS: Record<string, ThrottleConfig> = {
  tradier: { maxRequestsPerSecond: 2, burstLimit: 10 },
  yahoo_finance: { maxRequestsPerSecond: 1, burstLimit: 5 },
  alpha_vantage: { maxRequestsPerSecond: 0.4, burstLimit: 2 },
  coingecko: { maxRequestsPerSecond: 0.5, burstLimit: 5 },
  sec_edgar: { maxRequestsPerSecond: 8, burstLimit: 10 },
  usaspending: { maxRequestsPerSecond: 2, burstLimit: 10 },
};

class APIThrottle {
  private queues: Map<string, RequestQueue> = new Map();
  private refillInterval: NodeJS.Timeout;

  constructor() {
    this.refillInterval = setInterval(() => this.refillTokens(), 1000);
  }

  private getQueue(provider: string): RequestQueue {
    if (!this.queues.has(provider)) {
      const config = THROTTLE_CONFIGS[provider] || { maxRequestsPerSecond: 1, burstLimit: 5 };
      this.queues.set(provider, {
        pending: [],
        lastRequest: 0,
        tokens: config.burstLimit,
      });
    }
    return this.queues.get(provider)!;
  }

  private getConfig(provider: string): ThrottleConfig {
    return THROTTLE_CONFIGS[provider] || { maxRequestsPerSecond: 1, burstLimit: 5 };
  }

  private refillTokens(): void {
    const keys = Array.from(this.queues.keys());
    for (const provider of keys) {
      const queue = this.queues.get(provider)!;
      const config = this.getConfig(provider);
      
      queue.tokens = Math.min(config.burstLimit, queue.tokens + config.maxRequestsPerSecond);
      
      while (queue.pending.length > 0 && queue.tokens >= 1) {
        const request = queue.pending.shift()!;
        queue.tokens -= 1;
        queue.lastRequest = Date.now();
        request.resolve();
      }
    }
  }

  async throttle(provider: string): Promise<void> {
    const status = marketDataStatus.getProviderStatus(provider);
    if (status?.status === 'rate_limited') {
      const resetTime = status.quota?.resetsAt;
      if (resetTime && resetTime.getTime() > Date.now()) {
        const waitMs = resetTime.getTime() - Date.now();
        if (waitMs < 60000) {
          logger.info(`[THROTTLE] ${provider} rate limited, waiting ${Math.round(waitMs/1000)}s`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
        } else {
          throw new Error(`${provider} rate limited - retry after ${Math.round(waitMs/60000)} minutes`);
        }
      }
    }

    const queue = this.getQueue(provider);
    
    if (queue.tokens >= 1) {
      queue.tokens -= 1;
      queue.lastRequest = Date.now();
      return;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = queue.pending.findIndex(p => p.resolve === resolve);
        if (idx !== -1) {
          queue.pending.splice(idx, 1);
          reject(new Error(`Request timeout for ${provider}`));
        }
      }, 30000);

      queue.pending.push({
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject,
        timestamp: Date.now(),
      });
    });
  }

  getQueueStats(): Record<string, { pending: number; tokens: number }> {
    const stats: Record<string, { pending: number; tokens: number }> = {};
    const keys = Array.from(this.queues.keys());
    for (const provider of keys) {
      const queue = this.queues.get(provider)!;
      stats[provider] = { pending: queue.pending.length, tokens: Math.round(queue.tokens * 10) / 10 };
    }
    return stats;
  }
}

export const apiThrottle = new APIThrottle();

export async function withThrottle<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  await apiThrottle.throttle(provider);
  return fn();
}
