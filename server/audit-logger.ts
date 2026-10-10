import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// AUDIT LOG INTERFACE
// ============================================================================

export interface AuditLog {
  id: string;
  timestamp: string;
  action: string;
  adminIp: string;
  userAgent: string;
  endpoint: string;
  method: string;
  requestBody: Record<string, unknown>;
  responseStatus: number;
  duration: number;
  metadata: Record<string, unknown>;
}

// ============================================================================
// SENSITIVE DATA SANITIZATION
// ============================================================================

const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'authorization',
  'auth',
  'credential',
  'credentials',
  'jwt',
  'bearer',
  'sessionId',
  'session_id',
  'cookie',
  'privateKey',
  'private_key',
  'ssn',
  'creditCard',
  'credit_card',
  'cardNumber',
  'card_number',
  'cvv',
  'pin',
];

function sanitizeValue(key: string, value: unknown): unknown {
  const lowerKey = key.toLowerCase();
  
  for (const sensitiveField of SENSITIVE_FIELDS) {
    if (lowerKey.includes(sensitiveField.toLowerCase())) {
      return '[REDACTED]';
    }
  }
  
  if (typeof value === 'object' && value !== null) {
    return sanitizeObject(value as Record<string, unknown>);
  }
  
  return value;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeValue(key, value);
  }
  
  return sanitized;
}

export function sanitizeRequestBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    return {};
  }
  
  return sanitizeObject(body as Record<string, unknown>);
}

// ============================================================================
// IN-MEMORY AUDIT LOG STORAGE
// ============================================================================

const MAX_AUDIT_LOGS = 1000;
const auditLogs: AuditLog[] = [];

function addAuditLog(log: AuditLog): void {
  auditLogs.unshift(log);
  
  if (auditLogs.length > MAX_AUDIT_LOGS) {
    auditLogs.pop();
  }
}

// ============================================================================
// FAILED LOGIN TRACKING (IP-based rate limiting)
// ============================================================================

interface FailedAttempt {
  count: number;
  firstAttempt: number;
  blockedUntil: number | null;
}

const failedLoginAttempts = new Map<string, FailedAttempt>();

const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const existing = failedLoginAttempts.get(ip);
  
  if (existing) {
    if (now - existing.firstAttempt > ATTEMPT_WINDOW_MS) {
      failedLoginAttempts.set(ip, {
        count: 1,
        firstAttempt: now,
        blockedUntil: null,
      });
    } else {
      existing.count++;
      
      if (existing.count >= MAX_FAILED_ATTEMPTS) {
        existing.blockedUntil = now + BLOCK_DURATION_MS;
        logger.warn(`IP ${ip} blocked due to ${MAX_FAILED_ATTEMPTS} failed login attempts`);
      }
      
      failedLoginAttempts.set(ip, existing);
    }
  } else {
    failedLoginAttempts.set(ip, {
      count: 1,
      firstAttempt: now,
      blockedUntil: null,
    });
  }
  
  logger.info(`Failed login attempt recorded`, { ip, attempts: failedLoginAttempts.get(ip)?.count });
}

export function recordSuccessfulLogin(ip: string): void {
  failedLoginAttempts.delete(ip);
  logger.info(`Successful login - cleared failed attempts`, { ip });
}

export function checkLoginBlock(ip: string): { blocked: boolean; remainingMs?: number; message?: string } {
  const existing = failedLoginAttempts.get(ip);
  
  if (!existing || !existing.blockedUntil) {
    return { blocked: false };
  }
  
  const now = Date.now();
  
  if (now >= existing.blockedUntil) {
    failedLoginAttempts.delete(ip);
    return { blocked: false };
  }
  
  const remainingMs = existing.blockedUntil - now;
  const remainingMinutes = Math.ceil(remainingMs / 60000);
  
  return {
    blocked: true,
    remainingMs,
    message: `Too many failed login attempts. Please try again in ${remainingMinutes} minute(s).`,
  };
}

// ============================================================================
// AUDIT LOGGING FUNCTIONS
// ============================================================================

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0];
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

export function logAdminAction(
  action: string,
  req: Request,
  res: Response,
  metadata: Record<string, unknown> = {}
): AuditLog {
  const log: AuditLog = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    action,
    adminIp: getClientIp(req),
    userAgent: req.headers['user-agent'] || 'unknown',
    endpoint: req.originalUrl || req.url,
    method: req.method,
    requestBody: sanitizeRequestBody(req.body),
    responseStatus: res.statusCode,
    duration: 0,
    metadata: sanitizeObject(metadata),
  };
  
  addAuditLog(log);
  
  logger.info(`[AUDIT] ${action}`, {
    id: log.id,
    ip: log.adminIp,
    endpoint: log.endpoint,
    method: log.method,
    status: log.responseStatus,
  });
  
  return log;
}

export function getAuditLogs(limit: number = 50, offset: number = 0): {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
} {
  const paginatedLogs = auditLogs.slice(offset, offset + limit);
  
  return {
    logs: paginatedLogs,
    total: auditLogs.length,
    limit,
    offset,
  };
}

export function getSecurityStats(): {
  totalRequests: number;
  last24HoursRequests: number;
  failedAttempts: number;
  blockedIPs: number;
  uniqueIPs: number;
  requestsByEndpoint: Record<string, number>;
  requestsByMethod: Record<string, number>;
  statusCodeDistribution: Record<string, number>;
  topIPs: { ip: string; count: number }[];
  recentFailedLogins: { ip: string; count: number; blockedUntil: string | null }[];
} {
  const now = Date.now();
  const last24Hours = now - (24 * 60 * 60 * 1000);
  
  const recentLogs = auditLogs.filter(log => new Date(log.timestamp).getTime() > last24Hours);
  
  const uniqueIPs = new Set(auditLogs.map(log => log.adminIp));
  const ipCounts = new Map<string, number>();
  const endpointCounts: Record<string, number> = {};
  const methodCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  
  for (const log of auditLogs) {
    ipCounts.set(log.adminIp, (ipCounts.get(log.adminIp) || 0) + 1);
    endpointCounts[log.endpoint] = (endpointCounts[log.endpoint] || 0) + 1;
    methodCounts[log.method] = (methodCounts[log.method] || 0) + 1;
    
    const statusBucket = `${Math.floor(log.responseStatus / 100)}xx`;
    statusCounts[statusBucket] = (statusCounts[statusBucket] || 0) + 1;
  }
  
  const topIPs = Array.from(ipCounts.entries())
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  let blockedIPCount = 0;
  const recentFailedLogins: { ip: string; count: number; blockedUntil: string | null }[] = [];
  
  Array.from(failedLoginAttempts.entries()).forEach(([ip, data]) => {
    if (data.blockedUntil && data.blockedUntil > now) {
      blockedIPCount++;
    }
    
    if (data.count > 0) {
      recentFailedLogins.push({
        ip,
        count: data.count,
        blockedUntil: data.blockedUntil ? new Date(data.blockedUntil).toISOString() : null,
      });
    }
  });
  
  recentFailedLogins.sort((a, b) => b.count - a.count);
  
  return {
    totalRequests: auditLogs.length,
    last24HoursRequests: recentLogs.length,
    failedAttempts: Array.from(failedLoginAttempts.values()).reduce((sum, data) => sum + data.count, 0),
    blockedIPs: blockedIPCount,
    uniqueIPs: uniqueIPs.size,
    requestsByEndpoint: endpointCounts,
    requestsByMethod: methodCounts,
    statusCodeDistribution: statusCounts,
    topIPs,
    recentFailedLogins: recentFailedLogins.slice(0, 10),
  };
}

// ============================================================================
// AUDIT MIDDLEWARE
// ============================================================================

export function auditMiddleware(action?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const actionName = action || `${req.method} ${req.baseUrl || ''}${req.path}`;
    
    const originalEnd = res.end;
    const originalJson = res.json;
    
    let responseBody: unknown = null;
    
    res.json = function(body: unknown) {
      responseBody = body;
      return originalJson.call(this, body);
    };
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).end = function(this: Response, ...args: any[]) {
      const duration = Date.now() - startTime;
      
      const log: AuditLog = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        action: actionName,
        adminIp: getClientIp(req),
        userAgent: req.headers['user-agent'] || 'unknown',
        endpoint: req.originalUrl || req.url,
        method: req.method,
        requestBody: sanitizeRequestBody(req.body),
        responseStatus: res.statusCode,
        duration,
        metadata: {
          responseSize: typeof responseBody === 'object' ? JSON.stringify(responseBody).length : 0,
        },
      };
      
      addAuditLog(log);
      
      logger.info(`[AUDIT] ${actionName}`, {
        id: log.id,
        ip: log.adminIp,
        endpoint: log.endpoint,
        method: log.method,
        status: log.responseStatus,
        duration: `${duration}ms`,
      });
      
      return (originalEnd as Function).apply(this, args);
    };
    
    next();
  };
}

// ============================================================================
// UTILITY: Clear old failed attempts (run periodically)
// ============================================================================

export function cleanupFailedAttempts(): void {
  const now = Date.now();
  let cleaned = 0;
  
  Array.from(failedLoginAttempts.entries()).forEach(([ip, data]) => {
    const isExpired = now - data.firstAttempt > ATTEMPT_WINDOW_MS;
    const isUnblocked = data.blockedUntil && now >= data.blockedUntil;
    
    if (isExpired || isUnblocked) {
      failedLoginAttempts.delete(ip);
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    logger.info(`[AUDIT] Cleaned up ${cleaned} expired failed login records`);
  }
}

setInterval(cleanupFailedAttempts, 5 * 60 * 1000);
