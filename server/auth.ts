import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

// Require JWT_SECRET - fail fast if not configured
function getJWTSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('CRITICAL: JWT_SECRET or SESSION_SECRET environment variable must be set for admin authentication');
  }
  return secret;
}

const JWT_SECRET = getJWTSecret();

const JWT_EXPIRES_IN = '7d'; // Admin sessions last 7 days for better cross-device persistence

export interface AdminTokenPayload {
  isAdmin: true;
  iat?: number;
  exp?: number;
}

// Generate JWT token for admin
export function generateAdminToken(): string {
  const payload: AdminTokenPayload = {
    isAdmin: true,
  };
  
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

// Verify JWT token
export function verifyAdminToken(token: string): AdminTokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AdminTokenPayload;
    return decoded;
  } catch (error) {
    logger.warn('Invalid JWT token', { error: error instanceof Error ? error.message : 'Unknown error' });
    return null;
  }
}

// Middleware to require admin authentication via JWT
export function requireAdminJWT(req: Request, res: Response, next: NextFunction) {
  // Check for JWT in cookie first (most secure)
  let token = req.cookies?.admin_token;
  
  // Fallback to Authorization header for API clients
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }
  
  if (!token) {
    logger.warn('Admin access denied - no token provided', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(401).json({ 
      error: 'Authentication required',
      message: 'Please log in to access admin features.'
    });
  }
  
  const decoded = verifyAdminToken(token);
  
  if (!decoded || !decoded.isAdmin) {
    logger.warn('Admin access denied - invalid token', {
      ip: req.ip,
      path: req.path,
    });
    return res.status(403).json({ 
      error: 'Access denied',
      message: 'Invalid or expired admin token.'
    });
  }
  
  // Token is valid - allow request
  next();
}

// Legacy middleware for backward compatibility (accepts password OR JWT)
export function requireAdmin(req: Request, res: Response, next: Function) {
  // Try JWT first
  const token = req.cookies?.admin_token || 
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7) : null);
  
  if (token) {
    const decoded = verifyAdminToken(token);
    if (decoded && decoded.isAdmin) {
      return next();
    }
  }
  
  // Fallback to password-based auth (legacy - will be deprecated)
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    logger.error('CRITICAL: ADMIN_PASSWORD environment variable not set');
    return res.status(500).json({ error: 'Server configuration error - admin authentication unavailable' });
  }
  
  const providedPassword = req.headers['x-admin-password'] || req.body?.password;
  
  if (providedPassword === adminPassword) {
    logger.info('Admin authenticated via legacy password method', {
      ip: req.ip,
      path: req.path,
    });
    return next();
  }
  
  logger.warn('Admin access denied', {
    ip: req.ip,
    path: req.path,
  });
  
  res.status(403).json({ error: "Admin access denied" });
}
