/**
 * API Retry Logic with Circuit Breaker Pattern
 * Provides resilient API calls with exponential backoff and failure tracking
 */

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,     // Open circuit after 5 consecutive failures
  resetTimeout: 60000,     // Try again after 60 seconds
  halfOpenRequests: 1,     // Allow 1 request in half-open state
};

/**
 * Get or create circuit breaker state for a service
 */
function getCircuitBreaker(serviceName: string): CircuitBreakerState {
  if (!circuitBreakers.has(serviceName)) {
    circuitBreakers.set(serviceName, {
      failures: 0,
      lastFailure: 0,
      isOpen: false,
    });
  }
  return circuitBreakers.get(serviceName)!;
}

/**
 * Check if circuit is open (blocking requests)
 */
function isCircuitOpen(serviceName: string): boolean {
  const breaker = getCircuitBreaker(serviceName);
  
  if (!breaker.isOpen) return false;
  
  // Check if we should try half-open state
  const timeSinceFailure = Date.now() - breaker.lastFailure;
  if (timeSinceFailure > CIRCUIT_BREAKER_CONFIG.resetTimeout) {
    return false; // Allow request in half-open state
  }
  
  return true;
}

/**
 * Record a successful request (reset failures)
 */
function recordSuccess(serviceName: string): void {
  const breaker = getCircuitBreaker(serviceName);
  breaker.failures = 0;
  breaker.isOpen = false;
}

/**
 * Record a failed request
 */
function recordFailure(serviceName: string): void {
  const breaker = getCircuitBreaker(serviceName);
  breaker.failures++;
  breaker.lastFailure = Date.now();
  
  if (breaker.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    breaker.isOpen = true;
    console.warn(`[CIRCUIT-BREAKER] ${serviceName} circuit OPENED after ${breaker.failures} failures`);
  }
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;      // Base delay in ms
  maxDelay?: number;       // Maximum delay in ms
  serviceName?: string;    // For circuit breaker tracking
  timeout?: number;        // Request timeout in ms
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  serviceName: 'default',
  timeout: 30000,
};

/**
 * Fetch with retry logic and circuit breaker
 * Uses exponential backoff with jitter
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const config = { ...DEFAULT_OPTIONS, ...retryOptions };
  
  // Check circuit breaker
  if (isCircuitOpen(config.serviceName)) {
    throw new Error(`[${config.serviceName}] Circuit breaker is OPEN - service temporarily unavailable`);
  }
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Add timeout using AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // Check for rate limiting (429) or server errors (5xx)
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Success - reset circuit breaker
      recordSuccess(config.serviceName);
      return response;
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on abort (timeout)
      if (lastError.name === 'AbortError') {
        console.warn(`[${config.serviceName}] Request timeout after ${config.timeout}ms`);
      }
      
      // Check if we should retry
      if (attempt < config.maxRetries) {
        // Exponential backoff with jitter
        const delay = Math.min(
          config.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
          config.maxDelay
        );
        
        console.log(`[${config.serviceName}] Retry ${attempt + 1}/${config.maxRetries} after ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  
  // All retries failed - record failure for circuit breaker
  recordFailure(config.serviceName);
  throw lastError || new Error('Request failed after all retries');
}

/**
 * Generic async function retry wrapper
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  
  if (isCircuitOpen(config.serviceName)) {
    throw new Error(`[${config.serviceName}] Circuit breaker is OPEN`);
  }
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await fn();
      recordSuccess(config.serviceName);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < config.maxRetries) {
        const delay = Math.min(
          config.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
          config.maxDelay
        );
        console.log(`[${config.serviceName}] Retry ${attempt + 1}/${config.maxRetries} after ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  
  recordFailure(config.serviceName);
  throw lastError || new Error('Operation failed after all retries');
}

/**
 * Get circuit breaker status for monitoring
 */
export function getCircuitBreakerStatus(): Record<string, { isOpen: boolean; failures: number }> {
  const status: Record<string, { isOpen: boolean; failures: number }> = {};
  
  circuitBreakers.forEach((state, name) => {
    status[name] = {
      isOpen: isCircuitOpen(name),
      failures: state.failures,
    };
  });
  
  return status;
}

/**
 * Reset a specific circuit breaker (for admin use)
 */
export function resetCircuitBreaker(serviceName: string): void {
  const breaker = circuitBreakers.get(serviceName);
  if (breaker) {
    breaker.failures = 0;
    breaker.isOpen = false;
    breaker.lastFailure = 0;
    console.log(`[CIRCUIT-BREAKER] ${serviceName} manually reset`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
