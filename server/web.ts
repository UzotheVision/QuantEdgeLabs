/**
 * WEB PROCESS — Lightweight HTTP Server + WebSocket + SPX Scanners
 *
 * This is Process 1 of 2 in production. It serves:
 * - All 642 API routes (Express)
 * - WebSocket for real-time prices (Coinbase, DataBento)
 * - WebSocket for bot notifications
 * - SPX ORB Scanner + Session Scanner + Intelligence Service
 * - Watchlist monitor (lightweight price alerts)
 *
 * Expected memory: 500-800MB
 * Expected CPU: Low idle, moderate during SPX scans
 *
 * Process 2 (worker.ts) handles all heavy background services.
 * Both processes share the same Neon PostgreSQL database.
 */

import "dotenv/config";
import { acquireSchedulerLock, releaseSchedulerLock } from "./scheduler-lock";
import { runStartupCheck } from "./startup-check";
import { installProcessGuard } from "./process-guard";

// Before anything else can throw: an unpaid API bill must not take the app down.
installProcessGuard("web");

// Run environment check immediately after loading .env
runStartupCheck();

import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startWatchlistMonitor } from "./watchlist-monitor";
import { logger } from "./logger";
import { validateTradierAPI } from "./tradier-api";
import { initializeRealtimePrices, getRealtimeStatus } from "./realtime-price-service";
import { initializeBotNotificationService } from "./bot-notification-service";
import { initializeWeeklyTracker } from "./weekly-tracker";
import { securityHeaders } from "./security";
import { csrfMiddleware, validateCSRF } from "./csrf";

const app = express();

// Trust proxy for accurate rate limiting
app.set('trust proxy', true);

// Enable gzip compression for all responses
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }}));

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  const realtimeStatus = getRealtimeStatus();
  const overallStatus = realtimeStatus.isHealthy ? "OK" : "DEGRADED";
  // Railway needs process liveness, not a promise that every optional market
  // feed is currently perfect. Keep HTTP 200 while reporting feed quality in
  // the payload so the terminal can degrade honestly without being restarted.
  res.status(200).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    process: "web",
    realtimePrices: realtimeStatus,
    message: realtimeStatus.isHealthy ? "Server is healthy" : "Realtime price service is degraded",
  });
});

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());

app.use(securityHeaders);
app.use(csrfMiddleware);
app.use((req, res, next) => {
  if (/^(GET|HEAD|OPTIONS)$/i.test(req.method)) {
    return next();
  }
  validateCSRF(req, res, next);
});

// SECURITY: Safe logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (res.statusCode >= 400) {
        logLine += ` [ERROR]`;
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // Sanitized error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    import('./logger').then(({ logger }) => {
      logger.error('Express error handler:', err);
    });
    res.status(status).json({
      error: status >= 500 ? 'Internal server error' : (err.message || 'Request failed')
    });
  });

  // Serve frontend
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, async () => {
    log(`[WEB] serving on port ${port}`);

    // ====================================================================
    // WEB PROCESS SERVICES — Lightweight, always-on
    // ====================================================================

    // Validate Tradier API
    await validateTradierAPI();

    // ── Essential services (ALWAYS run) ──────────────────────────────────
    initializeRealtimePrices(server);
    log('📡 Real-time price feeds initialized');

    initializeBotNotificationService(server);
    log('🤖 Bot notification service initialized');

    initializeWeeklyTracker(server);
    log('📅 Weekly watchlist tracker initialized');

    startWatchlistMonitor(5);
    log('🔔 Watchlist Monitor started');

    // ── SPX Scanners (market hours only) ─────────────────────────────────
    function isMarketCurrentlyOpen(): boolean {
      const now = new Date();
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hour = et.getHours();
      const minute = et.getMinutes();
      const day = et.getDay();
      const isWeekday = day >= 1 && day <= 5;
      const timeInMinutes = hour * 60 + minute;
      // 9:00 AM - 4:30 PM ET
      return isWeekday && timeInMinutes >= 540 && timeInMinutes <= 990;
    }

    let spxStarted = false;

    async function startSPXScanners() {
      if (spxStarted) return;
      spxStarted = true;
      log('🚀 Starting SPX scanners...');

      try {
        const { startORBScanner } = await import('./spx-orb-scanner');
        const { startSessionScanner } = await import('./spx-session-scanner');
        startORBScanner(60000);
        startSessionScanner(30000);
        log('📊 SPX ORB + Session scanners started');

        const { startSPXIntelligenceService } = await import('./spx-intelligence-service');
        startSPXIntelligenceService();
        log('🧠 SPX Intelligence Service started');

        const { startSwingCatcher } = await import('./spx-swing-catcher');
        startSwingCatcher(120000); // 2-min interval
        log('🎯 SPX Swing Catcher started');
      } catch (err) {
        logger.error('❌ Error starting SPX scanners:', err);
      }
    }

    // Always start SPX scanners (swing catcher runs 24/7)
    log('📈 Starting SPX scanners in 5s...');
    setTimeout(() => startSPXScanners(), 5000);

    /**
     * The web tier schedules only when there is no worker tier.
     *
     * The comment further down explains why worker jobs were copied here at
     * all: production started dist/web.js only, so the worker's jobs never ran.
     * That workaround is correct while web is the only process — and wrong the
     * moment a worker is actually deployed, because then both tiers run the
     * three schedules they share — market-open, the quarter-hourly market-hours
     * sweep, and the hourly archive — and everything they produce lands twice.
     *
     * WORKER_ENABLED=true on the web service means "a worker owns the jobs" and
     * web schedules nothing. Left unset, web takes the scheduler lock instead,
     * which preserves today's single-process behaviour while still stopping a
     * SECOND web instance from duplicating the work.
     */
    const workerTierRuns = process.env.WORKER_ENABLED === 'true';
    if (workerTierRuns) {
      log('👥 WORKER_ENABLED=true — background jobs belong to the worker tier, web schedules nothing');
    } else {
      const webIsLeader = await acquireSchedulerLock();
      if (!webIsLeader) {
        log('👥 Another instance holds the scheduler lock — this web process schedules nothing');
      }
    }

    // Cron: Start SPX scanners at market open
    const cron = await import('./guarded-cron');
    cron.default.schedule('25 9 * * 1-5', () => {
      log('⏰ Market open — starting SPX scanners...');
      startSPXScanners();
    }, { timezone: 'America/New_York' });

    // Cron: Stop SPX scanners at market close
    cron.default.schedule('5 16 * * 1-5', () => {
      log('🌙 Market closed — stopping SPX scanners...');
      import('./spx-orb-scanner').then(m => m.stopORBScanner()).catch(() => {});
      import('./spx-session-scanner').then(m => m.stopSessionScanner()).catch(() => {});
      // Swing catcher stays running 24/7
      spxStarted = false;
    }, { timezone: 'America/New_York' });

    // ── Cron: Options-flow scan (every 15 min, market hours) ──────────────
    //
    // This belongs to worker.ts, which owns all background jobs. But railway.json
    // sets startCommand to `npm run start` — i.e. dist/web.js ONLY — so the worker
    // process the Procfile declares is never actually started in production. The
    // result was that flow accumulated solely when someone happened to be running
    // the dev server: 3 captured sessions across six months, which in turn left the
    // repeat-buyer tracker with almost nothing to compare.
    //
    // Rather than silently depend on a second process that isn't running, the web
    // process scans too. If a real worker service is ever added, set
    // DISABLE_WEB_FLOW_CRON=1 here so the two don't both scan the same window.
    if (process.env.DISABLE_WEB_FLOW_CRON !== '1') {
      cron.default.schedule('*/15 9-15 * * 1-5', async () => {
        try {
          const { scanOptionsFlow, setOptionsFlowActive, getOptionsFlowStatus } = await import('./options-flow-scanner');
          if (!getOptionsFlowStatus().isActive) setOptionsFlowActive(true);
          const flows = await scanOptionsFlow();
          log(`💸 [FLOW] scan complete — ${flows.length} qualifying prints`);
        } catch (err) {
          logger.error('[FLOW] Scheduled scan failed:', err);
        }
      }, { timezone: 'America/New_York' });
      log('💸 [WEB] Options-flow scan scheduled (every 15m, market hours)');

      // GEX history archiver — same story as the flow scan: it is scheduled only in
      // worker.ts, which production never starts, so gex_snapshots has sat at 0 rows
      // and there is no history to browse or to measure levels against. Hourly,
      // market hours, matching the worker's cadence.
      cron.default.schedule('0 * * * *', async () => {
        try {
          const nowEt = Number(
            new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })
              .format(new Date()),
          );
          if (nowEt < 9 || nowEt > 16) return;
          const { archiveGexSnapshots } = await import('./gex-history-archiver');
          const result = await archiveGexSnapshots();
          logger.info(`📸 [GEX-ARCHIVE] Hourly snapshot: ${result.archived} symbols archived`);
        } catch (err) {
          logger.error('[GEX-ARCHIVE] Scheduled archive failed:', err);
        }
      }, { timezone: 'America/New_York' });
      log('📸 [WEB] GEX history archiver scheduled (hourly, market hours)');
    }

    // Warm the conviction board immediately, then keep it warm.
    //
    // A cold build takes over two minutes, so without this the first person to
    // load the platform after any restart either waits it out or is told the
    // signals are "still warming up". That was the normal experience, because
    // nothing populated the cache on boot — it only filled when a human happened
    // to open the Oracle tab, and every restart reset it.
    //
    // Deliberately not awaited: the process must serve immediately, and the
    // board arrives when it arrives.
    void (async () => {
      try {
        const { warmConvictions } = await import('./convictions-engine');
        await warmConvictions('boot');
        // Refresh ahead of the 5-minute TTL so the entry is replaced before it
        // can expire, and nobody ever meets a cold cache.
        setInterval(() => { void warmConvictions('interval'); }, 4 * 60_000);
      } catch (err) {
        logger.warn('[WEB] conviction warm-up failed to start:', err);
      }
    })();

    log('✅ [WEB] Process ready — serving HTTP + WebSocket + SPX scanners');
  });
})();

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => { void releaseSchedulerLock().finally(() => process.exit(0)); });
}
