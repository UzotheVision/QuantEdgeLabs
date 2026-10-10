/**
 * Monitoring Service - Track errors, warnings, and system health
 * Provides real-time alerts for admin dashboard
 */

import { marketDataStatus, isRateLimitError } from './market-data-status';

export interface SystemAlert {
  id: string;
  type: 'error' | 'warning' | 'info' | 'critical';
  category: 'api' | 'database' | 'discord' | 'ai_provider' | 'system';
  message: string;
  details?: string;
  timestamp: string;
  resolved: boolean;
}

export interface APIMetrics {
  endpoint: string;
  provider: string;
  lastSuccess: string | null;
  lastFailure: string | null;
  failureCount: number;
  successCount: number;
  avgResponseTime: number;
  rateLimitWarning: boolean;
}

class MonitoringService {
  private alerts: SystemAlert[] = [];
  private apiMetrics: Map<string, APIMetrics> = new Map();
  private maxAlerts = 100; // Keep last 100 alerts

  // Record an alert
  addAlert(
    type: SystemAlert['type'],
    category: SystemAlert['category'],
    message: string,
    details?: string
  ): void {
    const alert: SystemAlert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      category,
      message,
      details,
      timestamp: new Date().toISOString(),
      resolved: false,
    };

    this.alerts.unshift(alert);

    // Keep only last maxAlerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(0, this.maxAlerts);
    }

    // Log critical alerts
    if (type === 'critical' || type === 'error') {
      console.error(`[${type.toUpperCase()}] ${category}: ${message}`, details || '');
    }
  }

  // Track API call
  trackAPICall(
    endpoint: string,
    provider: string,
    success: boolean,
    responseTime?: number
  ): void {
    const key = `${provider}-${endpoint}`;
    let metrics = this.apiMetrics.get(key);

    if (!metrics) {
      metrics = {
        endpoint,
        provider,
        lastSuccess: null,
        lastFailure: null,
        failureCount: 0,
        successCount: 0,
        avgResponseTime: 0,
        rateLimitWarning: false,
      };
      this.apiMetrics.set(key, metrics);
    }

    const now = new Date().toISOString();

    if (success) {
      metrics.lastSuccess = now;
      metrics.successCount++;
      
      // Update average response time
      if (responseTime) {
        metrics.avgResponseTime = 
          (metrics.avgResponseTime * (metrics.successCount - 1) + responseTime) / metrics.successCount;
      }
    } else {
      metrics.lastFailure = now;
      metrics.failureCount++;

      // Create alert for failures
      if (metrics.failureCount % 3 === 0) {
        this.addAlert(
          'warning',
          'api',
          `${provider} API failing repeatedly`,
          `${endpoint} - ${metrics.failureCount} failures`
        );
      }
    }

    // Check for rate limit warnings (if >50 calls in last minute)
    if (metrics.successCount > 50) {
      metrics.rateLimitWarning = true;
      this.addAlert('warning', 'api', `${provider} approaching rate limits`, endpoint);
    }
  }

  // Get all alerts
  getAlerts(
    category?: SystemAlert['category'],
    type?: SystemAlert['type']
  ): SystemAlert[] {
    let filtered = this.alerts;

    if (category) {
      filtered = filtered.filter(a => a.category === category);
    }

    if (type) {
      filtered = filtered.filter(a => a.type === type);
    }

    return filtered;
  }

  // Get unresolved alerts
  getUnresolvedAlerts(): SystemAlert[] {
    return this.alerts.filter(a => !a.resolved);
  }

  // Get critical alerts
  getCriticalAlerts(): SystemAlert[] {
    return this.alerts.filter(a => a.type === 'critical' && !a.resolved);
  }

  // Resolve an alert
  resolveAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
    }
  }

  // Clear old resolved alerts
  clearResolvedAlerts(): void {
    this.alerts = this.alerts.filter(a => !a.resolved);
  }

  // Get API metrics
  getAPIMetrics(): APIMetrics[] {
    return Array.from(this.apiMetrics.values());
  }

  // Get metrics for specific provider
  getProviderMetrics(provider: string): APIMetrics[] {
    return Array.from(this.apiMetrics.values()).filter(m => m.provider === provider);
  }

  // Get summary statistics
  getSummary() {
    const unresolved = this.getUnresolvedAlerts();
    const critical = this.getCriticalAlerts();
    const apiMetrics = this.getAPIMetrics();
    
    const failingAPIs = apiMetrics.filter(m => m.failureCount > 0);
    const rateLimitWarnings = apiMetrics.filter(m => m.rateLimitWarning);

    return {
      totalAlerts: this.alerts.length,
      unresolvedAlerts: unresolved.length,
      criticalAlerts: critical.length,
      errorAlerts: unresolved.filter(a => a.type === 'error').length,
      warningAlerts: unresolved.filter(a => a.type === 'warning').length,
      failingAPIs: failingAPIs.length,
      rateLimitWarnings: rateLimitWarnings.length,
      totalAPIMetrics: apiMetrics.length,
    };
  }

  // Health check
  getSystemHealth() {
    const critical = this.getCriticalAlerts();
    const errors = this.alerts.filter(a => a.type === 'error' && !a.resolved);
    const warnings = this.alerts.filter(a => a.type === 'warning' && !a.resolved);

    if (critical.length > 0) {
      return { status: 'critical', message: `${critical.length} critical issues`, alerts: critical };
    }

    if (errors.length > 5) {
      return { status: 'degraded', message: `${errors.length} errors`, alerts: errors };
    }

    if (warnings.length > 10) {
      return { status: 'warning', message: `${warnings.length} warnings`, alerts: warnings };
    }

    return { status: 'healthy', message: 'All systems operational', alerts: [] };
  }
}

// Singleton instance
export const monitoringService = new MonitoringService();

// Map provider names to market data status keys
const providerKeyMap: Record<string, string> = {
  'Tradier': 'tradier',
  'tradier': 'tradier',
  'Yahoo Finance': 'yahoo_finance',
  'yahoo_finance': 'yahoo_finance',
  'yahoo': 'yahoo_finance',
  'Alpha Vantage': 'alpha_vantage',
  'alpha_vantage': 'alpha_vantage',
  'CoinGecko': 'coingecko',
  'coingecko': 'coingecko',
  'Coinbase': 'coinbase',
  'coinbase': 'coinbase',
  'SEC EDGAR': 'sec_edgar',
  'sec_edgar': 'sec_edgar',
  'USASpending': 'usaspending',
  'usaspending': 'usaspending',
};

function getProviderKey(provider: string): string | null {
  return providerKeyMap[provider] || null;
}

// Helper functions for common alerts
export function logAPIError(provider: string, endpoint: string, error: any, statusCode?: number, body?: any): void {
  const errorMessage = error?.message || String(error);
  monitoringService.addAlert(
    'error',
    'api',
    `${provider} API error: ${endpoint}`,
    errorMessage
  );
  monitoringService.trackAPICall(endpoint, provider, false);
  
  // Track in market data status - check rate limit using error message as well
  const providerKey = getProviderKey(provider);
  if (providerKey) {
    const isRateLimit = isRateLimitError(providerKey, statusCode, body, errorMessage);
    marketDataStatus.logError(providerKey, errorMessage, isRateLimit);
  }
}

export function logAPISuccess(provider: string, endpoint: string, responseTime?: number): void {
  monitoringService.trackAPICall(endpoint, provider, true, responseTime);
  
  // Track in market data status
  const providerKey = getProviderKey(provider);
  if (providerKey) {
    marketDataStatus.logSuccess(providerKey, endpoint);
  }
}

export function logDiscordError(message: string, error: any): void {
  monitoringService.addAlert(
    'warning',
    'discord',
    `Discord webhook failed: ${message}`,
    error?.message || String(error)
  );
}

export function logDatabaseError(operation: string, error: any): void {
  monitoringService.addAlert(
    'error',
    'database',
    `Database error: ${operation}`,
    error?.message || String(error)
  );
}

export function logCriticalError(category: SystemAlert['category'], message: string, details?: string): void {
  monitoringService.addAlert('critical', category, message, details);
}
