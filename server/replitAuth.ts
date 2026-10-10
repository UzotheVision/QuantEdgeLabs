// Replit Auth Integration using OpenID Connect
// Reference: blueprint:javascript_log_in_with_replit

import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { pool } from "./db";
import { storage } from "./storage";
import { logger, logError } from "./logger";

// Check if Replit Auth is available (has required environment variables)
export function isReplitAuthAvailable(): boolean {
  return !!(process.env.REPL_ID && process.env.REPL_ID.trim());
}

// Lazy OIDC config - only called when Replit Auth is actually needed
const getOidcConfig = memoize(
  async () => {
    // Double-check availability before attempting discovery
    const replId = process.env.REPL_ID;
    if (!replId || !replId.trim()) {
      throw new Error('Replit Auth not available - REPL_ID environment variable is missing or empty');
    }
    // Use default Replit OIDC URL if not specified
    const issuerUrl = process.env.ISSUER_URL || "https://replit.com/oidc";
    logger.info('Initializing Replit OIDC with issuer:', issuerUrl);
    return await client.discovery(
      new URL(issuerUrl),
      replId
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    // Do not create connect-pg-simple's own default 15-connection pool. The
    // hosted Supabase pool is capped at 15, so a second pool exhausted all
    // clients and made normal login/page requests fail.
    pool,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(
  claims: any,
) {
  try {
    // Check if user already exists to avoid overwriting their beta access
    const existingUser = await storage.getUser(claims["sub"]);
    
    if (existingUser) {
      // User exists - only update profile info, NOT hasBetaAccess
      await storage.updateUser(claims["sub"], {
        email: claims["email"],
        firstName: claims["first_name"],
        lastName: claims["last_name"],
        profileImageUrl: claims["profile_image_url"],
      });
      logger.info('Existing user updated from Replit Auth (preserved beta access)', { 
        userId: claims["sub"], 
        email: claims["email"],
        hasBetaAccess: existingUser.hasBetaAccess 
      });
    } else {
      // New user - create with hasBetaAccess: false (must redeem invite code)
      await storage.upsertUser({
        id: claims["sub"],
        email: claims["email"],
        firstName: claims["first_name"],
        lastName: claims["last_name"],
        profileImageUrl: claims["profile_image_url"],
        hasBetaAccess: false,
      });
      logger.info('New user created from Replit Auth (beta access pending)', { 
        userId: claims["sub"], 
        email: claims["email"] 
      });
    }
  } catch (error) {
    logError(error as Error, { context: 'upsertUser', userId: claims["sub"] });
  }
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  const sessionMiddleware = getSession();
  // A bad/stale session row must never turn a normal page navigation into a raw
  // 500 response. This can happen when a browser presents an old connect.sid
  // while the session store is briefly unavailable; a clean request then works,
  // which is an especially confusing failure for the person already signed in.
  // Continue as anonymous for this request. Protected routes still require a
  // real userId and will return 401; we do not grant access or invent a session.
  app.use((req, res, next) => {
    sessionMiddleware(req, res, (error?: unknown) => {
      if (!error) return next();
      logger.error('Session store unavailable; serving request anonymously', {
        error: error instanceof Error ? error.message : String(error),
      });
      // express-session may have already begun writing response headers before
      // its backing store reports a pool error. Passing that response on to
      // Vite made Vite try to set CORS headers a second time, which crashed the
      // dev server with "Cannot set headers after they are sent". End this one
      // failed request cleanly; the next request can use the anonymous path.
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
      }
      (req as any).session = {};
      (req as any).sessionID = undefined;
      return next();
    });
  });
  app.use(passport.initialize());
  app.use(passport.session());

  // Check if Replit Auth is available FIRST before any OIDC operations
  const replitAuthAvailable = isReplitAuthAvailable();
  logger.info(`Replit Auth check: REPL_ID="${process.env.REPL_ID || '(not set)'}", available=${replitAuthAvailable}`);

  // Skip Replit Auth setup if REPL_ID is not configured (e.g., on Render, Vercel, etc.)
  if (!replitAuthAvailable) {
    logger.warn('Replit Auth not available - REPL_ID not configured. Skipping Replit OIDC setup.');
    
    // Legacy links and old browser tabs may still point at the former Replit
    // entry point. A JSON 503 leaves a person stranded on an error page even
    // though this deployment has working Google + email authentication.
    app.get("/api/login", (_req, res) => res.redirect('/login'));
    
    app.get("/api/callback", (req, res) => {
      res.redirect('/signup?error=replit_auth_unavailable');
    });
    
    app.get("/api/logout", (req, res) => {
      req.logout(() => {
        res.redirect('/');
      });
    });
    
    return; // Skip the rest of Replit Auth setup
  }

  // Wrap OIDC setup in try-catch to prevent server crash on misconfigured environments
  let config: Awaited<ReturnType<typeof getOidcConfig>>;
  try {
    config = await getOidcConfig();
  } catch (error) {
    logger.error('Failed to initialize Replit OIDC - server will continue without Replit Auth', { 
      error: (error as Error).message 
    });
    
    // Do not surface provider setup failure as a raw API response to users.
    app.get("/api/login", (_req, res) => res.redirect('/login'));
    app.get("/api/callback", (req, res) => res.redirect('/signup?error=replit_auth_failed'));
    app.get("/api/logout", (req, res) => req.logout(() => res.redirect('/')));
    return;
  }

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify,
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
      logger.info(`Registered Replit Auth strategy for domain: ${domain}`);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    // Use REPLIT_DEV_DOMAIN for correct callback URL in development
    const domain = process.env.REPLIT_DEV_DOMAIN || req.hostname;
    ensureStrategy(domain);
    logger.info('Login initiated', { 
      ip: req.ip, 
      hostname: req.hostname, 
      domain,
      replitDevDomain: process.env.REPLIT_DEV_DOMAIN 
    });
    passport.authenticate(`replitauth:${domain}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    const domain = process.env.REPLIT_DEV_DOMAIN || req.hostname;
    logger.info('Callback received', { ip: req.ip, hostname: req.hostname, domain, query: req.query });
    ensureStrategy(domain);
    passport.authenticate(`replitauth:${domain}`, (err: any, user: any, info: any) => {
      if (err) {
        logger.error('OAuth callback error', { error: err.message, stack: err.stack });
        return res.redirect('/signup?error=auth_failed');
      }
      if (!user) {
        logger.warn('OAuth callback: no user returned', { info });
        return res.redirect('/signup?error=no_user');
      }
      
      req.logIn(user, async (loginErr) => {
        if (loginErr) {
          logger.error('OAuth login error', { error: loginErr.message });
          return res.redirect('/signup?error=login_failed');
        }
        
        // Ensure user has beta access + pro tier immediately after login
        try {
          if (user.claims?.sub) {
            await storage.updateUser(user.claims.sub, { hasBetaAccess: true, subscriptionTier: 'pro' });
            logger.info('Granted beta access + pro tier to Replit user on login', { userId: user.claims.sub });
          }
        } catch (e) {
          logger.error('Failed to grant beta access on login', { error: (e as Error).message });
        }
        
        logger.info('OAuth login successful', { userId: user.claims?.sub });
        return res.redirect('/trade-desk');
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    logger.info('Logout initiated', { ip: req.ip });
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user?.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    logger.info('Token refreshed successfully');
    return next();
  } catch (error) {
    logError(error as Error, { context: 'token refresh' });
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
