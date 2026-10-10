import { logger } from './logger';

export interface APIProviderStatus {
  name: string;
  displayName: string;
  status: 'healthy' | 'degraded' | 'rate_limited' | 'down' | 'unknown';
  statusReason?: string;
  lastSuccessAt?: Date;
  lastErrorAt?: Date;
  lastErrorMessage?: string;
  quota?: {
    period: string;
    limit: number;
    used: number;
    remaining: number;
    resetsAt?: Date;
  };
  rollingCounts: {
    success24h: number;
    error24h: number;
    rateLimitHits24h: number;
  };
}

interface APIEvent {
  timestamp: Date;
  type: 'success' | 'error' | 'rate_limit';
  message?: string;
}

interface ProviderTracker {
  name: string;
  displayName: string;
  events: APIEvent[];
  rateLimitUntil?: Date;
  quotaLimit?: number;
  quotaPeriod?: string;
  quotaUsed: number;
  quotaResetsAt?: Date;
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;

class MarketDataStatusService {
  private providers: Map<string, ProviderTracker> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    const defaultProviders = [
      { name: 'tradier', displayName: 'Tradier (Options)', quotaLimit: 120, quotaPeriod: 'per minute' },
      { name: 'yahoo_finance', displayName: 'Yahoo Finance (Quotes)', quotaLimit: 2000, quotaPeriod: 'per hour' },
      { name: 'alpha_vantage', displayName: 'Alpha Vantage (News)', quotaLimit: 25, quotaPeriod: 'per day' },
      { name: 'coingecko', displayName: 'CoinGecko (Crypto)', quotaLimit: 30, quotaPeriod: 'per minute' },
      { name: 'coinbase', displayName: 'Coinbase WebSocket', quotaLimit: undefined, quotaPeriod: undefined },
      { name: 'sec_edgar', displayName: 'SEC EDGAR (Filings)', quotaLimit: 10, quotaPeriod: 'per second' },
      { name: 'usaspending', displayName: 'USASpending (Contracts)', quotaLimit: 1000, quotaPeriod: 'per hour' },
    ];

    for (const p of defaultProviders) {
      this.providers.set(p.name, {
        name: p.name,
        displayName: p.displayName,
        events: [],
        quotaLimit: p.quotaLimit,
        quotaPeriod: p.quotaPeriod,
        quotaUsed: 0,
      });
    }
  }

  private cleanOldEvents(tracker: ProviderTracker) {
    const cutoff = Date.now() - TWENTY_FOUR_HOURS;
    tracker.events = tracker.events.filter(e => e.timestamp.getTime() > cutoff);
  }

  logSuccess(providerName: string, endpoint?: string) {
    const tracker = this.providers.get(providerName);
    if (!tracker) {
      logger.warn(`Unknown API provider: ${providerName}`);
      return;
    }
    this.cleanOldEvents(tracker);
    tracker.events.push({ timestamp: new Date(), type: 'success' });
    tracker.quotaUsed++;
    tracker.rateLimitUntil = undefined;
  }

  logError(providerName: string, message: string, isRateLimit: boolean = false) {
    const tracker = this.providers.get(providerName);
    if (!tracker) {
      logger.warn(`Unknown API provider: ${providerName}`);
      return;
    }
    this.cleanOldEvents(tracker);
    
    const eventType = isRateLimit ? 'rate_limit' : 'error';
    tracker.events.push({ timestamp: new Date(), type: eventType, message });
    
    if (isRateLimit) {
      const resetMinutes = providerName === 'alpha_vantage' ? 60 : 1;
      tracker.rateLimitUntil = new Date(Date.now() + resetMinutes * 60 * 1000);
      tracker.quotaResetsAt = tracker.rateLimitUntil;
    }
    
    logger.warn(`API ${isRateLimit ? 'rate limited' : 'error'}: ${providerName}`, { message });
  }

  resetQuota(providerName: string) {
    const tracker = this.providers.get(providerName);
    if (tracker) {
      tracker.quotaUsed = 0;
      tracker.rateLimitUntil = undefined;
      tracker.quotaResetsAt = undefined;
    }
  }

  getProviderStatus(providerName: string): APIProviderStatus | null {
    const tracker = this.providers.get(providerName);
    if (!tracker) return null;
    
    this.cleanOldEvents(tracker);
    
    const now = Date.now();
    const successEvents = tracker.events.filter(e => e.type === 'success');
    const errorEvents = tracker.events.filter(e => e.type === 'error');
    const rateLimitEvents = tracker.events.filter(e => e.type === 'rate_limit');
    
    const lastSuccess = successEvents.length > 0 ? successEvents[successEvents.length - 1] : null;
    const lastError = errorEvents.length > 0 || rateLimitEvents.length > 0 
      ? [...errorEvents, ...rateLimitEvents].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0]
      : null;
    
    let status: APIProviderStatus['status'] = 'unknown';
    let statusReason: string | undefined;
    
    if (tracker.rateLimitUntil && tracker.rateLimitUntil.getTime() > now) {
      status = 'rate_limited';
      statusReason = `Rate limited until ${tracker.rateLimitUntil.toLocaleTimeString()}`;
    } else if (lastSuccess && (!lastError || lastSuccess.timestamp > lastError.timestamp)) {
      if (lastSuccess.timestamp.getTime() > now - FIVE_MINUTES) {
        status = 'healthy';
      } else {
        status = 'unknown';
        statusReason = 'No recent activity';
      }
    } else if (lastError) {
      if (lastError.type === 'rate_limit') {
        status = 'rate_limited';
        statusReason = lastError.message || 'Rate limit exceeded';
      } else {
        status = errorEvents.length >= 3 ? 'down' : 'degraded';
        statusReason = lastError.message || 'API errors detected';
      }
    }
    
    // Derive quota usage from rolling window events based on quota period
    let periodUsed = 0;
    if (tracker.quotaLimit && tracker.quotaPeriod) {
      const now = Date.now();
      let periodMs = TWENTY_FOUR_HOURS;
      if (tracker.quotaPeriod.includes('minute')) periodMs = 60 * 1000;
      else if (tracker.quotaPeriod.includes('hour')) periodMs = 60 * 60 * 1000;
      else if (tracker.quotaPeriod.includes('second')) periodMs = 1000;
      
      const periodStart = now - periodMs;
      periodUsed = tracker.events.filter(e => 
        e.type === 'success' && e.timestamp.getTime() > periodStart
      ).length;
    }
    
    const remaining = tracker.quotaLimit 
      ? Math.max(0, tracker.quotaLimit - periodUsed)
      : undefined;
    
    return {
      name: tracker.name,
      displayName: tracker.displayName,
      status,
      statusReason,
      lastSuccessAt: lastSuccess?.timestamp,
      lastErrorAt: lastError?.timestamp,
      lastErrorMessage: lastError?.message,
      quota: tracker.quotaLimit ? {
        period: tracker.quotaPeriod || 'unknown',
        limit: tracker.quotaLimit,
        used: periodUsed,
        remaining: remaining ?? 0,
        resetsAt: tracker.quotaResetsAt,
      } : undefined,
      rollingCounts: {
        success24h: successEvents.length,
        error24h: errorEvents.length,
        rateLimitHits24h: rateLimitEvents.length,
      },
    };
  }

  getAllStatuses(): APIProviderStatus[] {
    const statuses: APIProviderStatus[] = [];
    const keys = Array.from(this.providers.keys());
    for (const name of keys) {
      const status = this.getProviderStatus(name);
      if (status) statuses.push(status);
    }
    return statuses;
  }
}

export const marketDataStatus = new MarketDataStatusService();

export function isRateLimitError(providerName: string, statusCode?: number, body?: any, errorMessage?: string): boolean {
  if (statusCode === 429) return true;
  
  const errMsg = (errorMessage || '').toLowerCase();
  const bodyStr = typeof body === 'string' ? body.toLowerCase() : JSON.stringify(body || {}).toLowerCase();
  
  const rateLimitKeywords = ['rate limit', 'quota', 'too many requests', 'exceeded', 'throttle'];
  const hasRateLimitKeyword = rateLimitKeywords.some(keyword => 
    errMsg.includes(keyword) || bodyStr.includes(keyword)
  );
  
  if (hasRateLimitKeyword) return true;
  
  switch (providerName) {
    case 'tradier':
      return bodyStr.includes('quota violation') ||
             (statusCode === 400 && bodyStr.includes('quota'));
    case 'alpha_vantage':
      return bodyStr.includes('call frequency') ||
             bodyStr.includes('api call volume');
    case 'coingecko':
      return bodyStr.includes('rate limit');
    default:
      return false;
  }
}
