import rateLimit from 'express-rate-limit';
import { logger } from './logger';

// Skip rate limiting for localhost in development
const isLocalhost = (req: any): boolean => {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' ||
         process.env.NODE_ENV === 'development';
};

// General API rate limiter - 500 requests per 15 minutes (generous for dev)
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Increased from 100 to 500
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Disable validation warnings in Replit environment
  skip: isLocalhost, // Skip rate limiting for localhost
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'Too many requests',
      message: 'You have exceeded the rate limit. Please try again later.',
      retryAfter: Math.ceil(15 * 60 * 1000 / 1000), // seconds
    });
  },
});

// AI generation rate limiter - 50 requests per 15 minutes (generous for testing/development)
export const aiGenerationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50, // Increased from 10 to 50
  message: 'AI generation limit exceeded. Please wait before generating more ideas.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Disable validation warnings in Replit environment
  handler: (req, res) => {
    logger.warn('AI generation rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'You have generated too many AI ideas. Please wait a few minutes before trying again. (Limit: 50 per 15 minutes)',
      retryAfter: Math.ceil(15 * 60 * 1000 / 1000),
    });
  },
});

// Quant generation rate limiter - 100 requests per 15 minutes (generous for active trading)
export const quantGenerationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Increased from 20 to 100
  message: 'Quant generation limit exceeded. Please wait before generating more ideas.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Disable validation warnings in Replit environment
  handler: (req, res) => {
    logger.warn('Quant generation rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'You have generated too many quant/flow ideas. Please wait a few minutes before trying again. (Limit: 100 per 15 minutes)',
      retryAfter: Math.ceil(15 * 60 * 1000 / 1000),
    });
  },
});

// Market data rate limiter - 60 requests per minute (for real-time price updates)
export const marketDataLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: 'Market data request limit exceeded.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Disable validation warnings in Replit environment
  handler: (req, res) => {
    logger.warn('Market data rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'Market data limit exceeded',
      message: 'You have exceeded the market data request limit. Please wait before requesting more data.',
      retryAfter: 60,
    });
  },
});

// Research assistant rate limiter - 20 requests per 15 minutes
export const researchAssistantLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Research assistant limit exceeded. Please wait before asking more questions.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  handler: (req, res) => {
    logger.warn('Research assistant rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'Research assistant limit exceeded',
      message: 'You have exceeded the research assistant limit. Please wait before asking more questions.',
      retryAfter: Math.ceil(15 * 60 * 1000 / 1000),
    });
  },
});

// Admin endpoints rate limiter - 30 requests per 15 minutes
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Admin request limit exceeded.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Disable validation warnings in Replit environment
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    logger.warn('Admin rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'Admin limit exceeded',
      message: 'Too many admin requests. Please wait before trying again.',
      retryAfter: Math.ceil(15 * 60 * 1000 / 1000),
    });
  },
});

// On-demand idea generation limiter - 1 request per 5 minutes per user
export const ideaGenerationOnDemandLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 1,
  message: 'Idea generation limit exceeded. Please wait 5 minutes before generating again.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  handler: (req, res) => {
    logger.warn('On-demand idea generation rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'Generation limit exceeded',
      message: 'You can only generate ideas once every 5 minutes. Please wait and try again.',
      retryAfter: 5 * 60, // 5 minutes in seconds
    });
  },
});

// Auth rate limiter - Strict limits to prevent brute force attacks
// 5 login attempts per 15 minutes per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Too many login attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skipSuccessfulRequests: true, // Only count failed attempts
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded - potential brute force', {
      ip: req.ip,
      path: req.path,
      email: req.body?.email,
    });
    res.status(429).json({
      error: 'Too many login attempts',
      message: 'You have exceeded the login attempt limit. Please wait 15 minutes before trying again.',
      retryAfter: Math.ceil(15 * 60 * 1000 / 1000),
    });
  },
});

// Password reset rate limiter - 3 requests per hour to prevent abuse
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Too many password reset requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  handler: (req, res) => {
    logger.warn('Password reset rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
    });
    res.status(429).json({
      error: 'Too many reset requests',
      message: 'You have exceeded the password reset limit. Please try again in an hour.',
      retryAfter: Math.ceil(60 * 60 * 1000 / 1000),
    });
  },
});

// Tracking/analytics rate limiter - 120 requests per minute per IP
// Allows normal page navigation but prevents abuse from CSRF-exempt endpoints
export const trackingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 2 requests per second on average
  message: 'Tracking request limit exceeded.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  handler: (req, res) => {
    logger.warn('Tracking rate limit exceeded - potential abuse', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json({
      error: 'Tracking limit exceeded',
      message: 'Too many tracking requests.',
      retryAfter: 60,
    });
  },
});

// ============================================
// INTERNAL API RATE LIMITERS
// For outgoing calls to Yahoo Finance, CoinGecko, etc.
// ============================================

interface InternalRateLimiterConfig {
  maxRequestsPerSecond: number;
  maxConcurrent: number;
}

interface QueuedRequest<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  priority: number;
}

class InternalRateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;
  private queue: QueuedRequest<any>[] = [];
  private activeRequests: number = 0;
  private maxConcurrent: number;
  private processing: boolean = false;

  constructor(config: InternalRateLimiterConfig) {
    this.maxTokens = config.maxRequestsPerSecond;
    this.tokens = this.maxTokens;
    this.refillRate = config.maxRequestsPerSecond / 1000;
    this.lastRefill = Date.now();
    this.maxConcurrent = config.maxConcurrent;
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      this.refillTokens();

      if (this.tokens < 1 || this.activeRequests >= this.maxConcurrent) {
        await new Promise(resolve => setTimeout(resolve, 200));
        continue;
      }

      this.queue.sort((a, b) => b.priority - a.priority);
      const request = this.queue.shift();
      if (!request) continue;

      this.tokens -= 1;
      this.activeRequests += 1;

      request.fn()
        .then(result => {
          this.activeRequests -= 1;
          request.resolve(result);
        })
        .catch(error => {
          this.activeRequests -= 1;
          request.reject(error);
        });
    }

    this.processing = false;
  }

  async execute<T>(fn: () => Promise<T>, priority: number = 0): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject, priority });
      this.processQueue();
    });
  }

  getStats(): { queueLength: number; activeRequests: number; tokens: number } {
    this.refillTokens();
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      tokens: Math.floor(this.tokens),
    };
  }
}

// Global rate limiters for external APIs
const yahooFinanceLimiter = new InternalRateLimiter({
  maxRequestsPerSecond: 2, // Conservative - Yahoo is strict
  maxConcurrent: 2,
});

const coinGeckoLimiter = new InternalRateLimiter({
  maxRequestsPerSecond: 1, // CoinGecko free tier is very strict
  maxConcurrent: 1,
});

/**
 * Execute a Yahoo Finance API call with rate limiting
 */
export async function rateLimitedYahooCall<T>(
  fn: () => Promise<T>,
  priority: number = 0
): Promise<T> {
  return yahooFinanceLimiter.execute(fn, priority);
}

/**
 * Execute a CoinGecko API call with rate limiting
 */
export async function rateLimitedCoinGeckoCall<T>(
  fn: () => Promise<T>,
  priority: number = 0
): Promise<T> {
  return coinGeckoLimiter.execute(fn, priority);
}

/**
 * Batch execute with delays between batches
 */
export async function batchExecute<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize: number = 5,
  delayBetweenBatchesMs: number = 1500
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(item => fn(item)));

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }

    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatchesMs));
    }
  }

  return results;
}

/**
 * Get rate limiter statistics
 */
export function getInternalRateLimiterStats(): {
  yahooFinance: { queueLength: number; activeRequests: number; tokens: number };
  coinGecko: { queueLength: number; activeRequests: number; tokens: number };
} {
  return {
    yahooFinance: yahooFinanceLimiter.getStats(),
    coinGecko: coinGeckoLimiter.getStats(),
  };
}

/**
 * Check if we're in production environment
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if current time is during US market hours
 */
export function isMarketHours(): boolean {
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = etTime.getDay();
  const hour = etTime.getHours();
  const minute = etTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  if (day === 0 || day === 6) return false;
  return timeInMinutes >= 570 && timeInMinutes < 960;
}

/**
 * Sleep with random jitter
 */
export function sleepWithJitter(baseMs: number, maxJitterMs: number = 500): Promise<void> {
  const jitter = Math.random() * maxJitterMs;
  return new Promise(resolve => setTimeout(resolve, baseMs + jitter));
}

logger.info('[RATE-LIMITER] Internal API rate limiters initialized');
