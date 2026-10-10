import "dotenv/config";
import { runStartupCheck } from "./startup-check";

// Run environment check immediately after loading .env
runStartupCheck();

import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startWatchlistMonitor } from "./watchlist-monitor";
import { startWatchlistGradingScheduler } from "./watchlist-grading-service";
import { logger } from "./logger";
import { validateTradierAPI } from "./tradier-api";
import { deriveTimingWindows, verifyTimingUniqueness } from "./timing-intelligence";
import { initializeRealtimePrices, getRealtimeStatus } from "./realtime-price-service";
import { initializeBotNotificationService } from "./bot-notification-service";
import { initializeWeeklyTracker } from "./weekly-tracker";
import { reconcileOpenPaperExecutions, repairImpossibleRecentOutcomes, observeTriggeredIdeas, expireStaleIdeas } from "./oracle-lifecycle-reconciler";
import { acquireSchedulerLock, releaseSchedulerLock } from "./scheduler-lock";

/** Thrown to skip a leader-only block without dressing it up as an error. */
class SkipOnFollower extends Error {
  constructor() { super("follower — skipped"); this.name = "SkipOnFollower"; }
}
import { securityHeaders } from "./security";
import { csrfMiddleware, validateCSRF } from "./csrf";

const app = express();

// Trust proxy for accurate rate limiting (Replit sets X-Forwarded-For header)
app.set('trust proxy', true);

// Enable gzip compression for all responses (significant speed improvement)
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }}));

// Add a simple health check endpoint
app.get("/health", (req: Request, res: Response) => {
  const realtimeStatus = getRealtimeStatus();
  const overallStatus = realtimeStatus.isHealthy ? "OK" : "DEGRADED";
  // This is a liveness endpoint, not a claim that every market-data vendor is
  // available. Returning 503 here made the preview/deployment layer treat a
  // fully serving terminal as offline whenever one optional stock feed was
  // degraded. The payload still exposes the source-quality truth to clients.
  res.status(200).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
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

// SECURITY: Safe logging middleware - prevents sensitive data leakage
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // SECURITY: Only log request method, path, status, and duration
      // NEVER log request bodies (could contain passwords) or response bodies (could contain tokens/keys)
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      
      // Add safe metadata only (no sensitive data)
      if (res.statusCode >= 400) {
        logLine += ` [ERROR]`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize observability FIRST so we capture boot-time errors
  const { initObservability, captureException } = await import('./observability');
  await initObservability();

  const server = await registerRoutes(app);

  // SECURITY: Sanitized error handler - prevents stack trace and internal detail exposure
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    // Log full error server-side
    import('./logger').then(({ logger }) => {
      logger.error('Express error handler:', err);
    });
    // Forward to observability (Sentry / webhook / structured log)
    if (status >= 500) {
      captureException(err, {
        context: `${req.method} ${req.originalUrl}`,
        tags: { method: req.method, status: String(status) },
      });
    }

    // Send sanitized message to client (never expose stack traces or internal details)
    res.status(status).json({ 
      error: status >= 500 ? 'Internal server error' : (err.message || 'Request failed')
    });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  const host = process.env.HOST || "127.0.0.1";
  server.listen({
    port,
    host,
  }, async () => {
    log(`serving on port ${port}`);

    // Warm the two slowest shared reads (21 s / 8 s cold, measured 2026-09-24)
    // so the first visitor after a deploy gets the cached answer, then keep
    // them warm — both routes are stale-while-revalidate.
    const warm = () => {
      for (const path of ['/api/market-pulse', '/api/extended-hours']) {
        fetch(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}${path}`).catch(() => {});
      }
    };
    setTimeout(warm, 5_000);
    setInterval(warm, 60_000).unref?.();

    /**
     * Decide leadership BEFORE anything schedules or reconciles.
     *
     * Every background job below writes to one shared database. A second
     * process running them — a rolling-deploy overlap, a second instance, an
     * orphaned `tsx watch` — publishes the same signals twice, and two
     * processes racing the ingestion dedup both see "no existing row" and both
     * insert. Followers serve HTTP and nothing else.
     *
     * See server/scheduler-lock.ts. A single-instance deployment is unaffected:
     * it simply wins the lock.
     */
    const isLeader = await acquireSchedulerLock();
    if (!isLeader) {
      log('👥 Follower instance — serving HTTP only, background jobs belong to the leader');
    }

    // Make the execution ledger authoritative before any price validator runs.
    // A paper position proves a fill; a published signal alone never does.
    // Leader-only: these mutate shared rows, so two processes doing it race.
    try {
      if (!isLeader) throw new SkipOnFollower();
      await reconcileOpenPaperExecutions();
      await repairImpossibleRecentOutcomes();
      await observeTriggeredIdeas();
      // Retire ideas past their own stated horizon — see expireStaleIdeas.
      await expireStaleIdeas();
    } catch (error) {
      if (!(error instanceof SkipOnFollower)) {
        logger.error("[ORACLE LIFECYCLE] Execution reconciliation failed", error);
      }
    }

    // News → catalysts. The catalysts table this fills had ZERO rows, which made
    // hasEventCatalyst permanently false, left short-discipline unable to ever
    // see the event a short requires, and gave the convictions catalyst layer
    // nothing to score. The platform's own catalyst producer writes a different
    // table (catalyst_events) than the one consumers read, so it could never
    // fill. Massive's ticker-news endpoint is on the free tier and carries
    // per-ticker sentiment. Runs every 30 minutes on weekdays.
    try {
      const newsCron = await import('./guarded-cron');
      const runNewsIngest = async () => {
        try {
          const { ingestNewsCatalysts } = await import('./polygon-news-service');
          const { USER_CORE_WATCHLIST, PREMIUM_WATCHLIST } = await import('./ticker-universe');
          // Free tier is ~5 req/min, so take a rotating slice rather than the
          // whole list on every pass. LIQUID MOVERS join the pool: without
          // them, impact:high rows were never written for ~1,900 of the 2,000
          // universe names, so the short gate could NEVER open on them — a
          // legitimate post-event short on an unlisted name was blocked
          // forever, not until its event landed. Movers are exactly where
          // events live, so they earn the news slots first.
          let moverSyms: string[] = [];
          try {
            const { getLiquidMovers } = await import('./liquid-universe');
            moverSyms = getLiquidMovers(4, 100e6, 24).map((m) => m.symbol);
          } catch { /* universe cold — curated pool alone */ }
          const pool = Array.from(new Set([...moverSyms, ...USER_CORE_WATCHLIST, ...PREMIUM_WATCHLIST]));
          const slice = 12;
          const offset = Math.floor(Date.now() / (30 * 60 * 1000)) % Math.max(1, Math.ceil(pool.length / slice));
          await ingestNewsCatalysts(pool.slice(offset * slice, offset * slice + slice));
        } catch (error) {
          logger.error('[NEWS] catalyst ingest failed', error);
        }
      };
      void runNewsIngest();
      newsCron.default.schedule('*/30 * * * 1-5', () => { void runNewsIngest(); });
      log('📰 News catalyst ingest started — rotating watchlist slice every 30 min');

      // Liquid universe — top-2000 by dollar volume from ONE grouped-daily
      // call. Disk snapshot loads immediately so a restart isn't blind; the
      // fresh warm lands before the first pattern sweep, and a daily refresh
      // keeps the ranking current. The operator's rule: top-2000, everywhere.
      void import('./liquid-universe').then(async (lu) => {
        await lu.loadLiquidUniverseFromDisk();
        setTimeout(() => { void lu.warmLiquidUniverse(); }, 45 * 1000);
        setInterval(() => { void lu.warmLiquidUniverse(); }, 24 * 60 * 60 * 1000);
      }).catch(() => {});
      void import('./system-pulse').then((sp) => sp.pulse('system', 'engines online — publisher, pattern sweep, flow scan, bot, alerts all scheduled')).catch(() => {});

      // Bullflow live tape — real print stream + aggressor-inferred direction.
      // Self-gating: without BULLFLOW_API_KEY the start is a no-op and every
      // consumer falls back to chain-snapshot flows.
      void import('./bullflow-service').then((bf) => {
        if (bf.bullflowEnabled()) {
          bf.startBullflowStream();
          bf.startBullflowGexStream();
          log('🐂 Bullflow tape + GEX setup streams connecting');
        }
      }).catch(() => {});

      // Flow cluster sentry — the push channel the META miss exposed. Every
      // 5 min in cash hours: same-name premium clusters (>=$5M, >=3 prints)
      // fire ONCE per tier to the Pulse + Discord with the aggressor lean.
      // Bearish reads are delivered as reads even when the gate blocks trades.
      setInterval(() => {
        const nowCT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const h = nowCT.getHours(); const m = nowCT.getMinutes(); const dow = nowCT.getDay();
        const cash = dow >= 1 && dow <= 5 && (h > 8 || (h === 8 && m >= 30)) && h < 15;
        if (!cash) return;
        void import('./flow-cluster-sentry').then((s) => s.runFlowClusterSweep()).catch(() => {});
      }, 5 * 60 * 1000);
      log('🐋 Flow cluster sentry scheduled (5m, cash hours) — findings get a mouth');

      // Print-outcome scorer — 35 min after the close, every $250k+ print of
      // the day gets a measured peak-return grade. The per-class track record
      // is what eventually replaces hand-set score priors.
      newsCron.default.schedule('35 15 * * 1-5', () => {
        void import('./flow-outcome-scorer').then((s) => s.scoreDayPrints()).catch(() => {});
      }, { timezone: 'America/Chicago' } as any);
      log('📏 Flow outcome scorer scheduled (15:35 CT) — prints graded by measured aftermath');

      // Full-universe pattern sweep — daily bars, so twice a day is plenty.
      // First sweep 3 min after boot (let quotes/candles warm), then every 12h.
      setTimeout(() => {
        void import('./pattern-engine').then(m => m.scanUniversePatterns()).catch(() => {});
      }, 3 * 60 * 1000);
      setInterval(() => {
        void import('./pattern-engine').then(m => m.scanUniversePatterns()).catch(() => {});
      }, 12 * 60 * 60 * 1000);
      log('📐 Pattern engine scheduled — full-universe sweep on real OHLC');

      // Level-cross alert sweep — every 3 min during cash hours. Quotes come
      // from the same realtime service everything else uses; a cross fires
      // once and converts to triggered.
      setInterval(() => {
        const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const mins = et.getHours() * 60 + et.getMinutes();
        const wd = et.getDay();
        if (wd === 0 || wd === 6 || mins < 9 * 60 + 30 || mins > 16 * 60) return;
        void import('./price-alerts').then(m => m.checkAlerts()).catch(() => {});
      }, 3 * 60 * 1000);
      log('🔔 Level-cross alert sweep scheduled (3m, cash hours)');
    } catch (error) {
      logger.error('[NEWS] could not schedule catalyst ingest', error);
    }

    // The economic calendar was a hand-typed array whose last entry was
    // 2026-04-10, so the cash gate had run blind since April. FRED publishes
    // forward release dates for CPI, payrolls, PCE, PPI, GDP, retail sales,
    // JOLTS and industrial production, free and public-domain. Warm it at boot
    // and refresh twice a day — release schedules move rarely, and the fetch
    // falls back to the curated array if it fails.
    try {
      const { refreshFredCalendar } = await import('./economic-calendar');
      await refreshFredCalendar(true);
      const econCron = await import('./guarded-cron');
      econCron.default.schedule('0 5,17 * * *', () => {
        void refreshFredCalendar(true).catch((error) =>
          logger.error('[ECON-CAL] scheduled FRED refresh failed', error));
      });
    } catch (error) {
      logger.error('[ECON-CAL] FRED calendar init failed — curated calendar remains in use', error);
    }

    // A trigger is only useful if it is noticed while it matters. Every two
    // minutes on weekdays, compare open setups against live price and advance
    // the ones whose entry has actually traded.
    try {
      const triggerCron = await import('./guarded-cron');
      triggerCron.default.schedule('*/2 * * * 1-5', async () => {
        try {
          await observeTriggeredIdeas();
          await expireStaleIdeas();
        } catch (error) {
          logger.error("[ORACLE LIFECYCLE] Trigger observation failed", error);
        }
      });
      log('🎯 Trigger observer started — open setups checked against live price every 2 min');
    } catch (error) {
      logger.error("[ORACLE LIFECYCLE] Could not schedule trigger observer", error);
    }

    // ========================================================================
    // MARKET-HOURS-AWARE SERVICE MANAGEMENT
    // Problem: 20+ background services consume 2.2GB RAM + 118% CPU, blocking
    // the event loop so HTTP requests time out (site shows loading spinner).
    // Fix: Only start heavy services during market hours. Off-hours, only
    // essential services run (HTTP server, realtime prices, cron schedulers).
    // ========================================================================
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // Helper: Check if US stock market is currently open (or within 30min pre/post)
    function isMarketCurrentlyOpen(): boolean {
      const now = new Date();
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hour = et.getHours();
      const minute = et.getMinutes();
      const day = et.getDay(); // 0=Sun, 6=Sat
      const isWeekday = day >= 1 && day <= 5;
      // Extended window: 9:00 AM - 4:30 PM ET (30 min buffer each side)
      const timeInMinutes = hour * 60 + minute;
      const isExtendedHours = timeInMinutes >= 540 && timeInMinutes <= 990; // 9:00 AM - 4:30 PM
      return isWeekday && isExtendedHours;
    }

    // Validate Tradier API on startup
    await validateTradierAPI();

    // ── Essential services (ALWAYS run, market open or closed) ───────────
    // Real-time price feeds (needed for all pages)
    initializeRealtimePrices(server);
    log('📡 Real-time price feeds initialized');

    // Bot notification WebSocket
    initializeBotNotificationService(server);
    log('🤖 Bot notification service initialized');

    // Weekly watchlist live tracker (5s polling + WS push)
    initializeWeeklyTracker(server);
    log('📅 Weekly watchlist tracker initialized');

    // Watchlist monitor (lightweight, just checks price alerts)
    startWatchlistMonitor(5);
    log('🔔 Watchlist Monitor started');

    // Do not scan the full GEX universe at boot. It says "fire and forget",
    // but 136 option-chain fetches still saturate Node's request work and make
    // the Oracle board time out before its persisted signals can render. The
    // GEX endpoint owns its own cache warm-up on first use; startup must make
    // the actual terminal usable first, especially off-hours.
    log('🧊 GEX universe warm-up deferred until the GEX view is requested');

    // ── Heavy services: ONLY during market hours ─────────────────────────
    // These 20+ services consume massive CPU/memory. They are pointless when
    // the market is closed (no price movement, no volume, no flow).
    let heavyServicesStarted = false;

    async function startHeavyServices() {
      if (heavyServicesStarted) return;
      heavyServicesStarted = true;
      log('🚀 Starting heavy services (market is open)...');

      try {
        startWatchlistGradingScheduler();
        log('📊 Watchlist Grading Scheduler started');

        await delay(2000);

        const { autoIdeaGenerator } = await import('./auto-idea-generator');
        autoIdeaGenerator.start();
        log('🤖 Auto Idea Generator started');

        const { performanceValidationService } = await import('./performance-validation-service');
        performanceValidationService.start();

        const { pennyScanner } = await import('./penny-scanner');
        pennyScanner.start();
        log('🚀 Penny Moonshot Scanner started');

        await delay(3000);

        const { startBullishTrendScanner } = await import('./bullish-trend-scanner');
        startBullishTrendScanner();
        log('📈 Bullish Trend Scanner started');


        const { startMorningPreviewScheduler } = await import('./morning-preview-service');
        startMorningPreviewScheduler();
        log('☀️ Morning Preview Scheduler started');

        const { startIndexScalpScheduler } = await import('./index-scalp-engine');
        startIndexScalpScheduler();
        log('🎯 Index Scalp Scheduler started (SPX/SPY/QQQ/IWM 0DTE)');

        // TSLA/NVDA/etc. are deliberately separate from the index scalp engine:
        // they need a confirmed intraday price reversal plus a real liquid same-day
        // contract, rather than an index gamma-level proxy.
        const { startLiquidReversalPublisher } = await import('./liquid-reversal-publisher');
        startLiquidReversalPublisher();
        log('↩️ Liquid-name Reversal Publisher started (confirmed VWAP + real 0DTE contract)');

        const { startAttentionTrackingService } = await import('./attention-tracking-service');
        startAttentionTrackingService();
        log('🔥 Symbol Attention Tracker started');

        await delay(3000);

        const { startDetectionEngine } = await import('./surge-detection-engine');
        startDetectionEngine(60000);
        log('🎯 Surge Detection Engine started');

        const { startPreMarketSurgeDetector } = await import('./pre-market-surge-detector');
        startPreMarketSurgeDetector();
        log('🌅 Pre-Market Surge Detector started');

        await delay(5000);

        const { startCatalystPolling } = await import('./catalyst-intelligence-service');
        startCatalystPolling(30);
        log('📋 Catalyst Intelligence polling started');

        const { startPreMoveScanner } = await import('./pre-move-detection-service');
        startPreMoveScanner();
        log('🔮 Pre-Move Detection Scanner started');

        await delay(5000);

        const { selfLearning } = await import('./self-learning-service');
        selfLearning.start();
        log('🧠 Self-Learning Service started');

        // Trade Desk Executor (Alpaca auto-trading)
        const { startTradeExecutor, isExecutorActive } = await import('./trade-desk-executor');
        const { isAlpacaConfigured, initializeAlpaca } = await import('./alpaca-trading');
        if (isAlpacaConfigured()) {
          const alpacaReady = await initializeAlpaca();
          if (alpacaReady) {
            await startTradeExecutor();
            log('🤖 Trade Desk Executor started');
            const { startIntelligentMonitoring } = await import('./position-manager');
            await startIntelligentMonitoring();
            log('🧠 Intelligent Position Manager started');
          }
        }

        await delay(5000);

        // SPX scanners
        const { startORBScanner } = await import('./spx-orb-scanner');
        const { startSessionScanner } = await import('./spx-session-scanner');
        startORBScanner(60000);
        startSessionScanner(30000);
        log('📊 SPX ORB + Session scanners started');

        const { startSPXIntelligenceService } = await import('./spx-intelligence-service');
        startSPXIntelligenceService();
        log('🧠 SPX Intelligence Service started');

        const { startConvergenceEngine } = await import('./convergence-engine');
        startConvergenceEngine();
        log('🎯 Convergence Engine started');

        await delay(5000);

        const { startNewsOptionsPipeline } = await import('./news-options-pipeline');
        startNewsOptionsPipeline();
        log('📰 News→Options Pipeline started');

        const { startPopularTickersScanner } = await import('./popular-tickers-scanner');
        startPopularTickersScanner();
        log('🌟 Popular Tickers Scanner started');

        log('✅ All heavy services started (staggered over ~30s)');
      } catch (err) {
        logger.error('❌ Error starting heavy services:', err);
      }
    }

    // Check if market is currently open — if so, start heavy services after a 10s delay
    if (isMarketCurrentlyOpen()) {
      log('📈 Market is OPEN — starting heavy services in 10s...');
      setTimeout(() => startHeavyServices(), 10000);
    } else {
      log('🌙 Market is CLOSED — running in lightweight mode (HTTP + prices only)');
      log('🌙 Heavy services will auto-start at 9:25 AM ET on next market day');
    }

    // ── FLAG INGEST — bull + bear flag setups into the convictions feed ──
    // Registered here, NOT inside startHeavyServices(), and deliberately not
    // gated on market hours.
    //
    // Two separate reasons this was invisible before:
    //   1. ingestBullFlagIdeas / ingestBearFlagIdeas are called only in
    //      worker.ts, and `npm run dev` never starts that process.
    //   2. Everything else here hangs off startHeavyServices(), which only runs
    //      while the market is open — so on a weekend nothing even schedules.
    //
    // Symptom: a conviction board reading 40 LONG / 0 SHORT, which looks like a
    // market read but is really "the only short-side source never runs". Called
    // directly, bear-flag returned 20 setups (RBLX 92, QCOM 83, KLAC 80).
    //
    // Weekends are allowed on purpose. These scanners score DAILY bars — a bear
    // flag is the same shape on Saturday as it was at Friday's close — so there
    // is nothing about a closed market that makes the setup invalid. Blocking
    // weekend generation only meant you could not prepare before Monday.
    //
    // Off in production, where worker.ts already schedules these: the ingestion
    // dedupe cache is an in-process Map, so two processes would not dedupe
    // against each other. This has to be either/or, never a race.
    const FLAG_INGEST_IN_WEB =
      process.env.FLAG_INGEST_IN_WEB === 'true' ||
      (process.env.FLAG_INGEST_IN_WEB !== 'false' && process.env.NODE_ENV !== 'production');

    if (FLAG_INGEST_IN_WEB) {
      const flagCron = await import('./guarded-cron');

      flagCron.default.schedule('5,35 * * * *', async () => {
        try {
          const { ingestBullFlagIdeas } = await import('./bull-flag-scanner');
          const n = await ingestBullFlagIdeas();
          if (n > 0) log(`🚩 Bull flag: ingested ${n}`);
        } catch (e) { logger.error('Bull flag ingest failed', e as Error); }
      });

      flagCron.default.schedule('10,40 * * * *', async () => {
        try {
          const { ingestBearFlagIdeas } = await import('./bear-flag-scanner');
          const n = await ingestBearFlagIdeas();
          if (n > 0) log(`🐻 Bear flag: ingested ${n} — the short side of the board`);
        } catch (e) { logger.error('Bear flag ingest failed', e as Error); }
      });


      /**
       * Base reclaims — the setup a flag scanner structurally cannot see.
       *
       * A bull flag requires a strong prior leg UP, so every name that sold off
       * hard and is now turning back up fails it by shape, not on merit. ORCL
       * sat on the core watchlist with 180 sessions of bars and had produced
       * zero ideas in the platform's history for exactly that reason.
       * See server/base-reclaim-scanner.ts.
       *
       * Offset from the flag scans so the three sweeps do not collide.
       */
      flagCron.default.schedule('20,50 * * * *', async () => {
        try {
          const { ingestBaseReclaimIdeas } = await import('./base-reclaim-scanner');
          const n = await ingestBaseReclaimIdeas();
          if (n > 0) log(`🔄 Base reclaim: ingested ${n}`);
        } catch (e) { logger.error('Base reclaim ingest failed', e as Error); }
      });

      log('🚩🐻🔄 Flag + base-reclaim ingest scheduled (weekends included — daily-bar setups do not expire at the close)');
    }

    // ── Cron: Start heavy services at market open (9:25 AM ET weekdays) ──
    const cron = await import('./guarded-cron');
    cron.default.schedule('25 9 * * 1-5', () => {
      log('⏰ Market open cron triggered — starting heavy services...');
      startHeavyServices();
    }, { timezone: 'America/New_York' });

    // ── Boot cycle: the bot checks its book the MOMENT it wakes ───────────
    // The exit autopsy's dominant loss driver was the Sep 2-7 outage: MDB bled
    // to −95% and AAPL filled 59% below its own trailing stop because nobody
    // looked until the next cron tick after a week dark. A woken bot's first
    // act is now to re-price and run exits — during market hours, immediately;
    // off-hours the re-price still refreshes marks and expiry settlement.
    setTimeout(() => {
      void import('./quant-bot').then(async (m) => {
        const r = await m.runBotCycle();
        if (r.closed.length) log(`🤖 [QUANT-BOT] wake-up cycle closed ${r.closed.length} position(s) — see exit reasons`);
      }).catch((err) => logger.error('[QUANT-BOT] wake-up cycle failed:', err));
    }, 90 * 1000);

    // ── Cron: Quant Bot cycle (every 10 min, market hours) ────────────────
    // Takes the best signals into a paper portfolio and manages them against their own
    // stop/target. This is what turns the engine's opinions into a measurable record.
    cron.default.schedule('*/10 9-16 * * 1-5', async () => {
      try {
        const { runBotCycle } = await import('./quant-bot');
        const r = await runBotCycle();
        if (r.opened.length || r.closed.length) {
          log(`🤖 [QUANT-BOT] +${r.opened.length} opened, -${r.closed.length} closed, ${r.openCount} open`);
        }
      } catch (err) {
        logger.error('[QUANT-BOT] scheduled cycle failed:', err);
      }
    }, { timezone: 'America/New_York' });

    // ── Cron: Options-flow scan (every 15 min, market hours) ─────────────
    // Mirrors the worker's schedule so flow also accumulates in dev (this single
    // process is web + worker locally; prod runs server/worker.ts instead).
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

    // ── Cron: Restart process at market close to free all memory ──────────
    // At 4:10 PM ET, we gracefully exit. PM2 auto-restarts the process,
    // which comes back up in lightweight mode (no heavy services).
    cron.default.schedule('10 16 * * 1-5', () => {
      const hasProcessSupervisor = Boolean(process.env.pm_id || process.env.PM2_HOME || process.env.RAILWAY_ENVIRONMENT);
      if (!hasProcessSupervisor) {
        log('🌙 Market closed — keeping local preview alive (no process supervisor detected).');
        return;
      }
      log('🌙 Market closed — restarting process to free memory...');
      // Stop SPX scanners gracefully first
      import('./spx-orb-scanner').then(m => m.stopORBScanner()).catch(() => {});
      import('./spx-session-scanner').then(m => m.stopSessionScanner()).catch(() => {});
      import('./liquid-reversal-publisher').then(m => m.stopLiquidReversalPublisher()).catch(() => {});
      // Give 5s for graceful shutdown, then exit (PM2 will restart)
      setTimeout(() => {
        log('🔄 Exiting for PM2 restart (lightweight mode)...');
        process.exit(0);
      }, 5000);
    }, { timezone: 'America/New_York' });

    // ── Generator resilience: evening playbook + boot catch-up ────────────
    // The auto-idea-generator's 5-min interval lives inside startHeavyServices()
    // (market hours only), and the process drops to lightweight mode at the 4:10
    // PM ET restart. Two silent gaps this heals:
    //   1. The 8:30 PM CT "Tomorrow's Playbook" window could NEVER fire — the
    //      generator isn't running in lightweight mode — so next-day/swing setups
    //      were never generated in the evening.
    //   2. Any day the process wasn't alive during a window (sleep/redeploy) was
    //      silently skipped, leaving the board empty for days (the "stalled since
    //      <date>" gap).
    // Both guards are conditional — they never reintroduce unconditional heavy
    // generation on every boot (removed earlier for CPU), only when there's a real gap.
    try {
      const { autoIdeaGenerator } = await import('./auto-idea-generator');
      const ctOf = (d: Date) => new Date(d.toLocaleString('en-US', { timeZone: 'America/Chicago' }));

      // (1) Evening "Tomorrow's Playbook" — lightweight-safe, weekdays 8:30 PM CT.
      cron.default.schedule('30 20 * * 1-5', () => {
        log("🌙 Evening playbook cron — generating tomorrow's ideas (relaxed)...");
        autoIdeaGenerator.forceGenerate(true, true)
          .then((n) => log(`🌙 Evening playbook: generated ${n} ideas`))
          .catch((err) => logger.error('❌ Evening playbook generation failed:', err));
      }, { timezone: 'America/Chicago' });
      log('🌙 Evening playbook cron scheduled (8:30 PM CT weekdays, lightweight-safe)');

      // (2) Boot catch-up — only when the market is CLOSED (heavy services cover
      //     the open case), it's a weekday, the first generation window has passed,
      //     and NOTHING was generated today. One pass so a missed window doesn't
      //     leave the board dark all day.
      if (!isMarketCurrentlyOpen()) {
        const ctNow = ctOf(new Date());
        const dow = ctNow.getDay();
        const minutesCT = ctNow.getHours() * 60 + ctNow.getMinutes();
        const FIRST_WINDOW_MIN = 9 * 60 + 35; // just after the 9:30 AM CT open window
        if (dow >= 1 && dow <= 5 && minutesCT >= FIRST_WINDOW_MIN) {
          const { storage } = await import('./storage');
          const hoursSinceMidnight = Math.ceil(ctNow.getHours() + ctNow.getMinutes() / 60) + 1;
          const recent = await storage.getRecentTradeIdeas(hoursSinceMidnight, 50);
          const sameCtDay = (t: Date) =>
            t.getFullYear() === ctNow.getFullYear() &&
            t.getMonth() === ctNow.getMonth() &&
            t.getDate() === ctNow.getDate();
          const generatedToday = recent.some((i) => sameCtDay(ctOf(new Date(i.timestamp))));
          if (!generatedToday) {
            log('🔧 Catch-up: no ideas generated today — running one pass to un-stall the board...');
            autoIdeaGenerator.forceGenerate(false, false)
              .then((n) => log(`🔧 Catch-up: generated ${n} ideas`))
              .catch((err) => logger.error('❌ Catch-up generation failed:', err));
          } else {
            log('✅ Catch-up check: ideas already exist for today — no action needed');
          }
        }
      }
    } catch (e) {
      logger.error(`⚠ Generator resilience setup failed: ${(e as Error).message}`);
    }

    // Start ML Retraining Service (self-improving models)
    // TODO: Implement ML retraining service
    // const { startMLRetrainingService } = await import('./ml-retraining-service');
    // startMLRetrainingService();
    // log('🧠 ML Retraining Service started - auto-improving models at 3 AM daily, weight updates every 4 hours');
    
    // 🌙 EVENING STARTUP: Moved to cron-only (no immediate execution on boot)
    // Tomorrow's Playbook generation happens via the autoIdeaGenerator cron schedule
    // Immediate startup generation was consuming too much CPU/memory on boot
    log('🌙 Evening playbook generation deferred to cron schedule (not run on boot)');

    // 📡 THESIS RADAR — schedule scan + resolve crons (09:35 / 12:00 / 15:55 / 20:00 NY)
    try {
      const { scheduleRadarCrons } = await import('./thesis-radar/cron');
      scheduleRadarCrons();
      log('📡 Thesis Radar crons scheduled (09:35 forming, 12:00 + 15:55 full, 20:00 resolve)');
    } catch (e) {
      log(`⚠ Thesis Radar cron registration failed: ${(e as Error).message}`);
    }

    // 🪙 BTC BETA TRACKER — 5 intraday scans (09:35 / 11:00 / 13:00 / 15:00 / 15:55 NY)
    try {
      const { scheduleBTCTrackerCrons } = await import('./btc-beta-tracker/cron');
      scheduleBTCTrackerCrons();
      log('🪙 BTC Beta Tracker crons scheduled (09:35 / 11:00 / 13:00 / 15:00 / 15:55)');
    } catch (e) {
      log(`⚠ BTC Beta Tracker cron registration failed: ${(e as Error).message}`);
    }
    
    // Start automated hybrid idea generation (9:45 AM CT on weekdays - 15 min after AI/Quant)
    // (cron already imported above)
    let lastHybridRunDate: string | null = null;
    let isHybridGenerating = false;
    
    // Check every 5 minutes for 9:45 AM CT window
    cron.default.schedule('*/5 * * * *', async () => {
      try {
        // Prevent concurrent generations
        if (isHybridGenerating) {
          return;
        }
        
        const now = new Date();
        const nowCT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        
        // Extract CT time components
        const hour = nowCT.getHours();
        const minute = nowCT.getMinutes();
        const dayOfWeek = nowCT.getDay(); // 0 = Sunday, 6 = Saturday
        const dateKey = nowCT.toISOString().split('T')[0]; // YYYY-MM-DD
        
        // Skip weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          return;
        }
        
        // Check if it's 9:45 AM CT (hour = 9, minute = 45-49 to catch the window)
        const isHybridTime = hour === 9 && minute >= 45 && minute < 50;
        
        if (!isHybridTime) {
          return;
        }
        
        // Check if we already ran today
        if (lastHybridRunDate === dateKey) {
          return; // Already ran today
        }
        
        isHybridGenerating = true;
        lastHybridRunDate = dateKey;
        
        logger.info(`🔀 [HYBRID-CRON] Starting automated hybrid generation at 9:45 AM CT`);
        
        // 🚫 DEDUPLICATION: Check PAPER_POSITIONS (actual trades) not trade_ideas (3,453+ open)
        // CRITICAL FIX: Previously blocked all symbols that had any trade idea
        const existingOpenSymbols = new Set<string>();
        try {
          const portfolios = await storage.getAllPaperPortfolios();
          const quantPortfolio = portfolios.find((p: any) => p.name === 'Quant Bot Auto-Trader');
          if (quantPortfolio) {
            const positions = await storage.getPaperPositionsByPortfolio(quantPortfolio.id);
            positions.filter((p: any) => p.status === 'open').forEach((p: any) => existingOpenSymbols.add(p.symbol.toUpperCase()));
          }
          logger.info(`🚫 [HYBRID-CRON] Dedup: ${existingOpenSymbols.size} symbols have open paper positions`);
        } catch (e) {
          logger.info(`⚠️ [HYBRID-CRON] Could not fetch paper positions - allowing all symbols`);
        }
        
        // Generate hybrid ideas
        const { generateHybridIdeas } = await import('./ai-service');
        const { validateTradeRisk } = await import('./ai-service');
        const { validateAndLog: validateTradeStructure } = await import('./trade-validation');
        const hybridIdeas = await generateHybridIdeas("Market open conditions with quant + AI fusion");
        
        // 🔍 SHADOW MODE: Log candidates BEFORE validation
        logger.info(`🔀 [HYBRID-SHADOW] Generated ${hybridIdeas.length} candidate trades BEFORE validation`);
        for (const idea of hybridIdeas) {
          logger.info(`🔀 [HYBRID-SHADOW] Candidate: ${idea.symbol} ${idea.assetType} ${idea.direction} Entry:$${idea.entryPrice} Target:$${idea.targetPrice} Stop:$${idea.stopLoss}`);
        }
        
        // 🛡️ Apply strict risk validation to all hybrid ideas
        const savedIdeas = [];
        const rejectedIdeas: Array<{symbol: string, reason: string}> = [];
        
        // 📊 SHADOW MODE: Initialize rejection tracking metrics
        const metrics = {
          candidatesGenerated: hybridIdeas.length,
          dedupedCount: 0,
          earningsBlockedCount: 0,
          optionsQuarantinedCount: 0,
          structuralFailCount: 0,
          riskFailCount: 0,
          passedCount: 0
        };
        
        for (const hybridIdea of hybridIdeas) {
          // 🚫 Skip if symbol already has an open trade
          if (existingOpenSymbols.has(hybridIdea.symbol.toUpperCase())) {
            logger.info(`⏭️  [HYBRID-CRON] Skipped ${hybridIdea.symbol} - already has open trade`);
            metrics.dedupedCount++;
            continue;
          }
          
          // 📅 Check earnings calendar (block if earnings within 2 days, unless it's a news catalyst)
          if (hybridIdea.assetType === 'stock' || hybridIdea.assetType === 'option') {
            const { shouldBlockSymbol } = await import('./earnings-service');
            const isBlocked = await shouldBlockSymbol(hybridIdea.symbol, false);
            if (isBlocked) {
              logger.warn(`📅 [HYBRID-CRON] Skipped ${hybridIdea.symbol} - earnings within 2 days`);
              rejectedIdeas.push({ symbol: hybridIdea.symbol, reason: 'Earnings within 2 days' });
              metrics.earningsBlockedCount++;
              continue;
            }
          }
          
          // 🔧 OPTIONS PRICING FIX: Convert stock prices to option premiums
          if (hybridIdea.assetType === 'option') {
            try {
              const { findOptimalStrike } = await import('./tradier-api');
              const stockPrice = hybridIdea.entryPrice; // AI provides stock price, not premium
              
              const optimalStrike = await findOptimalStrike(
                hybridIdea.symbol, 
                stockPrice,
                hybridIdea.direction,
                process.env.TRADIER_API_KEY
              );
              
              if (optimalStrike && optimalStrike.lastPrice) {
                // Override AI prices with real option premium math
                // MINIMUM 50-75% gain targets - options are risky, need real upside!
                const optionPremium = optimalStrike.lastPrice;
                const expDate = hybridIdea.expiryDate;
                const daysToExpiry = expDate 
                  ? Math.max(1, Math.ceil((new Date(expDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                  : 7; // default to weekly if unknown
                let targetMult = daysToExpiry <= 3 ? 2.0 : daysToExpiry <= 7 ? 1.75 : daysToExpiry <= 14 ? 1.60 : 1.50;
                
                hybridIdea.entryPrice = optionPremium;
                hybridIdea.targetPrice = optionPremium * targetMult; // 50-100% gain based on DTE
                hybridIdea.stopLoss = optionPremium * 0.50; // 50% max loss on premium
                
                const gainPct = Math.round((targetMult - 1) * 100);
                logger.info(`[HYBRID-CRON] ${hybridIdea.symbol} option pricing - Stock:$${stockPrice} -> Premium:$${optionPremium} (Target:$${hybridIdea.targetPrice.toFixed(2)} +${gainPct}%, Stop:$${hybridIdea.stopLoss.toFixed(2)})`);
              } else {
                // Fallback: estimate premium as ~5% of stock price
                // Use 75% target for estimated premiums (moderate aggression)
                const estimatedPremium = stockPrice * 0.05;
                hybridIdea.entryPrice = estimatedPremium;
                hybridIdea.targetPrice = estimatedPremium * 1.75; // +75% gain
                hybridIdea.stopLoss = estimatedPremium * 0.50; // 50% max loss
                
                logger.warn(`[HYBRID-CRON] ${hybridIdea.symbol} using estimated premium (~5% of stock) - Premium:$${estimatedPremium.toFixed(2)}, Target:+75%`);
              }
            } catch (error) {
              logger.error(`❌ [HYBRID-CRON] ${hybridIdea.symbol} option pricing failed:`, error);
              rejectedIdeas.push({ symbol: hybridIdea.symbol, reason: 'Failed to fetch option premium' });
              metrics.optionsQuarantinedCount++;
              continue;
            }
          }
          
          // 🛡️ LAYER 1: Structural validation
          const structureValid = validateTradeStructure({
            symbol: hybridIdea.symbol,
            assetType: hybridIdea.assetType,
            direction: hybridIdea.direction,
            entryPrice: hybridIdea.entryPrice,
            targetPrice: hybridIdea.targetPrice,
            stopLoss: hybridIdea.stopLoss
          }, 'Hybrid-Cron');
          
          if (!structureValid) {
            rejectedIdeas.push({ symbol: hybridIdea.symbol, reason: 'Structural validation failed' });
            metrics.structuralFailCount++;
            continue;
          }
          
          // 🛡️ LAYER 2: Risk guardrails
          const validation = validateTradeRisk(hybridIdea);
          
          if (!validation.isValid) {
            logger.warn(`🚫 [HYBRID-CRON] REJECTED ${hybridIdea.symbol} - ${validation.reason}`);
            rejectedIdeas.push({ symbol: hybridIdea.symbol, reason: validation.reason || 'Unknown' });
            metrics.riskFailCount++;
            continue;
          }
          
          // ✅ Trade passes validation - save
          logger.info(`✅ [HYBRID-CRON] ${hybridIdea.symbol} passed validation - Loss:${validation.metrics?.maxLossPercent.toFixed(2)}% R:R:${validation.metrics?.riskRewardRatio.toFixed(2)}:1`);
          
          const { entryPrice, targetPrice, stopLoss } = hybridIdea;
          const riskRewardRatio = (targetPrice - entryPrice) / (entryPrice - stopLoss);
          
          // 📊 Calculate confidence score (simplified for CRON - use base 55 for hybrid)
          const confidenceScore = 55 + (validation.metrics?.riskRewardRatio ? Math.min(10, validation.metrics.riskRewardRatio * 5) : 0);
          
          // 📊 BUILD QUALITY SIGNALS based on validations
          const qualitySignals: string[] = [];
          qualitySignals.push('Hybrid (AI+Quant)'); // Always present
          if (riskRewardRatio >= 2.0) {
            qualitySignals.push(`R:R ${riskRewardRatio.toFixed(1)}:1`);
          }
          // Copy any existing signals from the hybrid idea
          if ((hybridIdea as any).qualitySignals?.length) {
            qualitySignals.push(...(hybridIdea as any).qualitySignals.slice(0, 3));
          }
          
          // 🕐 TIMING INTELLIGENCE: Derive trade-specific timing windows
          const timingWindows = deriveTimingWindows({
            symbol: hybridIdea.symbol,
            assetType: hybridIdea.assetType,
            direction: hybridIdea.direction,
            entryPrice,
            targetPrice,
            stopLoss,
            analysis: hybridIdea.analysis,
            catalyst: hybridIdea.catalyst,
            confidenceScore,
            riskRewardRatio,
          });
          
          const tradeIdea = await storage.createTradeIdea({
            symbol: hybridIdea.symbol,
            assetType: hybridIdea.assetType,
            direction: hybridIdea.direction,
            holdingPeriod: timingWindows.holdingPeriodType,
            entryPrice,
            targetPrice,
            stopLoss,
            riskRewardRatio: Math.round(riskRewardRatio * 10) / 10,
            catalyst: hybridIdea.catalyst,
            analysis: hybridIdea.analysis,
            liquidityWarning: hybridIdea.entryPrice < 5,
            sessionContext: hybridIdea.sessionContext,
            timestamp: new Date().toISOString(),
            entryValidUntil: timingWindows.entryValidUntil,
            exitBy: timingWindows.exitBy,
            expiryDate: hybridIdea.expiryDate || null,
            strikePrice: hybridIdea.assetType === 'option' ? ((hybridIdea as any).strikePrice || hybridIdea.entryPrice * (hybridIdea.direction === 'long' ? 1.02 : 0.98)) : null,
            optionType: hybridIdea.assetType === 'option' ? ((hybridIdea as any).optionType || (hybridIdea.direction === 'long' ? 'call' : 'put')) : null,
            source: 'hybrid',
            confidenceScore,
            qualitySignals, // Array of verified signal labels
            volatilityRegime: timingWindows.volatilityRegime,
            sessionPhase: timingWindows.sessionPhase,
            trendStrength: timingWindows.trendStrength,
            entryWindowMinutes: timingWindows.entryWindowMinutes,
            exitWindowMinutes: timingWindows.exitWindowMinutes,
            timingConfidence: timingWindows.timingConfidence,
            targetHitProbability: timingWindows.targetHitProbability,
            isLottoPlay: (hybridIdea as any).isLottoPlay || false,
          });
          savedIdeas.push(tradeIdea);
          metrics.passedCount++;
        }
        
        // 🔍 TIMING VERIFICATION: Ensure timing windows are unique across batch
        if (savedIdeas.length > 0) {
          verifyTimingUniqueness(savedIdeas.map((idea: any) => ({
            symbol: idea.symbol,
            entryValidUntil: idea.entryValidUntil || '',
            exitBy: idea.exitBy || ''
          })));
        }
        
        // 📊 SHADOW MODE: Log detailed metrics breakdown
        metrics.passedCount = savedIdeas.length; // Ensure count matches actual saved ideas
        logger.info(`🛡️ [HYBRID-SHADOW] Rejection breakdown: ${metrics.dedupedCount} dedupe, ${metrics.earningsBlockedCount} earnings, ${metrics.optionsQuarantinedCount} options, ${metrics.structuralFailCount} structural, ${metrics.riskFailCount} risk`);
        
        if (metrics.candidatesGenerated > 0) {
          const passRate = ((metrics.passedCount / metrics.candidatesGenerated) * 100).toFixed(1);
          logger.info(`🔀 [HYBRID-SHADOW] Validation Funnel: ${metrics.candidatesGenerated} → ${metrics.passedCount} (${passRate}% pass rate)`);
        } else {
          logger.warn(`🔀 [HYBRID-SHADOW] No candidates generated by AI - check generateHybridIdeas() output`);
        }
        
        // Send Discord notification for batch
        if (savedIdeas.length > 0) {
          const { sendBatchSummaryToDiscord } = await import('./discord-service');
          sendBatchSummaryToDiscord(savedIdeas, 'hybrid').catch(err => 
            logger.error('[HYBRID-CRON] Discord notification failed:', err)
          );
        }
        
        // Log summary
        if (rejectedIdeas.length > 0) {
          logger.warn(`🛡️ [HYBRID-CRON] Risk Validation Summary: ${rejectedIdeas.length} rejected, ${savedIdeas.length} passed`);
        }
        
        if (savedIdeas.length > 0) {
          logger.info(`✅ [HYBRID-CRON] Successfully generated ${savedIdeas.length} hybrid trade ideas`);
        } else {
          logger.warn('⚠️  [HYBRID-CRON] No ideas generated - all rejected or AI unavailable');
        }
        
      } catch (error: any) {
        logger.error('🔀 [HYBRID-CRON] Hybrid generation failed:', error);
      } finally {
        isHybridGenerating = false;
      }
    });
    
    log('🔀 Hybrid Generator started - will generate ideas at 9:45 AM CT weekdays (15 min after AI/Quant)');
    
    // Rolling quant idea generation — every 15 minutes across the session.
    let lastQuantRunAt = 0;
    let isQuantGenerating = false;
    
    cron.default.schedule('*/5 * * * *', async () => {
      try {
        if (isQuantGenerating) {
          return;
        }
        
        const now = new Date();
        const nowCT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        
        const hour = nowCT.getHours();
        const minute = nowCT.getMinutes();
        const dayOfWeek = nowCT.getDay();
        const dateKey = nowCT.toISOString().split('T')[0];

        // Saturday is the only dead zone; Sunday evening onward is next-session prep.
        if (dayOfWeek === 6 || (dayOfWeek === 0 && hour < 15)) {
          return;
        }

        // ROLLING, not windowed. The windows (originally two, briefly four)
        // existed because continuous generation once sprayed near-duplicates —
        // a dedup problem treated as a cadence law. Dedup is real now
        // (findSimilarTradeIdea, open-position skip, intra-batch symbol set),
        // so time-gating is pure lag: the operator watched a 9:58 ET setup
        // print +539% while the board waited for its 10:35 window. The
        // publisher now sweeps every 15 minutes from 8:35 CT (5 min after the
        // 8:30 CT open — 9:35 ET) to 14:55 CT — and
        // OFF-HOURS it keeps working at a 2-hour cadence ("signals can be
        // generated overnight"): curated quotes resolve after hours, an
        // after-hours earnings blast shows up in changePercent, and an
        // overnight idea publishes as PENDING TRIGGER for the next session.
        // Every gate (dedup, chase guard, short discipline) applies unchanged.
        // NOTE: hour/minute here are CT. The window previously started at
        // 9:35 CT — an ET value pasted into CT math — which re-created the
        // exact 10:35 ET lag this comment says was fixed, and left the first
        // 65 minutes of tape (where the aggressor flow prints) driving nothing.
        const sinceOpen = (hour > 8 || (hour === 8 && minute >= 35)) && (hour < 14 || (hour === 14 && minute <= 55));
        const minGapMs = sinceOpen ? 14 * 60 * 1000 : 2 * 60 * 60 * 1000;
        if (Date.now() - lastQuantRunAt < minGapMs) {
          return;
        }
        if (!sinceOpen) {
          logger.info('🌙 [QUANT-CRON] overnight prep sweep — next-session board, pending triggers');
        }

        isQuantGenerating = true;
        lastQuantRunAt = Date.now();
        
        logger.info(`📊 [QUANT-CRON] Starting automated quant generation at ${hour}:${minute.toString().padStart(2, '0')} CT`);
        
        const { generateQuantIdeas } = await import('./quant-ideas-generator');
        const marketData = await storage.getAllMarketData();
        const catalysts = await storage.getActiveCatalysts();
        
        // Generate 10 quant ideas across different sectors
        const quantIdeas = await generateQuantIdeas(marketData, catalysts, 10, storage, true);
        
        const savedIdeas = [];
        
        // 🔧 FIX: Check OPEN paper_positions (actual trades), NOT trade_ideas (52k+ research entries)
        const { getOptionsPortfolio } = await import('./auto-lotto-trader');
        const portfolio = await getOptionsPortfolio();
        const openPositionKeys = new Set<string>();
        
        if (portfolio) {
          const openPositions = await storage.getPaperPositionsByPortfolio(portfolio.id);
          for (const pos of openPositions) {
            if (pos.status === 'open') {
              const key = `${pos.symbol}:${pos.optionType || ''}:${pos.strikePrice || ''}`.toUpperCase();
              openPositionKeys.add(key);
            }
          }
          logger.info(`🔍 [QUANT-CRON] Open positions to avoid duplicates: ${openPositionKeys.size}`);
        }
        
        for (const idea of quantIdeas) {
          // Skip only if we already have an OPEN POSITION for this exact option
          const ideaKey = `${idea.symbol}:${idea.optionType || ''}:${idea.strikePrice || ''}`.toUpperCase();
          if (openPositionKeys.has(ideaKey)) {
            logger.info(`⏭️  [QUANT-CRON] Skipped ${idea.symbol} ${idea.optionType || ''} $${idea.strikePrice || ''} - already have open position`);
            continue;
          }
          
          const saved = await storage.createTradeIdea({
            ...idea,
            source: 'quant',
            status: 'published',
          });
          savedIdeas.push(saved);
        }
        
        if (savedIdeas.length > 0) {
          logger.info(`✅ [QUANT-CRON] Generated ${savedIdeas.length} quant trade ideas`);
          try {
            const { pulse } = await import('./system-pulse');
            pulse('quant', `${sinceOpen ? 'sweep' : '🌙 overnight sweep'} published ${savedIdeas.length} idea(s): ${savedIdeas.slice(0, 5).map((s: any) => s.symbol).join(', ')}${savedIdeas.length > 5 ? '…' : ''}`);
          } catch { /* pulse is decoration */ }
          const { sendBatchSummaryToDiscord, sendPremiumOptionsAlertToDiscord } = await import('./discord-service');
          
          // 🚀 AUTO-EXECUTE: Actually enter trades, not just generate ideas!
          const { getOptionsPortfolio } = await import('./auto-lotto-trader');
          const { executeTradeIdea } = await import('./paper-trading-service');
          const portfolio = await getOptionsPortfolio();
          
          if (portfolio) {
            let tradesExecuted = 0;
            for (const idea of savedIdeas) {
              // Execute options trades (the ones that have option details)
              if (idea.assetType === 'option' && idea.strikePrice && idea.optionType) {
                try {
                  const result = await executeTradeIdea(portfolio.id, idea);
                  if (result.success && result.position) {
                    tradesExecuted++;
                    logger.info(`🚀 [QUANT-CRON] AUTO-EXECUTED: ${idea.symbol} ${idea.optionType?.toUpperCase()} $${idea.strikePrice} @ $${idea.entryPrice?.toFixed(2)} x${result.position.quantity}`);
                  } else {
                    logger.warn(`⚠️ [QUANT-CRON] Execution failed for ${idea.symbol}: ${result.error}`);
                  }
                } catch (execErr) {
                  logger.error(`[QUANT-CRON] Trade execution error for ${idea.symbol}:`, execErr);
                }
              }
            }
            logger.info(`🎯 [QUANT-CRON] AUTO-EXECUTED ${tradesExecuted}/${savedIdeas.length} trades into paper portfolio`);
          } else {
            logger.warn(`⚠️ [QUANT-CRON] No portfolio available - trades saved but NOT executed`);
          }
          
          // 🎯 Send premium A/A+ alerts for options
          for (const idea of savedIdeas) {
            const grade = idea.probabilityBand || '';
            if (['A+', 'A'].includes(grade) && idea.assetType === 'option') {
              const dte = idea.expiryDate 
                ? Math.ceil((new Date(idea.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : undefined;
              sendPremiumOptionsAlertToDiscord({
                symbol: idea.symbol,
                optionType: (idea.optionType as 'call' | 'put') || 'call',
                strikePrice: idea.strikePrice || 0,
                expiryDate: idea.expiryDate || '',
                entryPrice: idea.entryPrice || 0,
                targetPrice: idea.targetPrice || 0,
                stopLoss: idea.stopLoss || 0,
                confidence: (idea as any).confidenceScore || 90,
                grade,
                delta: (idea as any).delta,
                dte,
                tradeType: dte && dte <= 1 ? 'day' : dte && dte <= 7 ? 'swing' : 'swing',
                signals: (idea as any).signals || [],
                source: 'quant'
              }).catch(err => logger.error(`[QUANT-CRON] Premium alert failed for ${idea.symbol}:`, err));
              logger.info(`📣 [QUANT-CRON] Premium A/A+ alert sent: ${idea.symbol} [${grade}]`);
            }
          }
          
          sendBatchSummaryToDiscord(savedIdeas, 'quant').catch(err => 
            logger.error('[QUANT-CRON] Discord notification failed:', err)
          );
        } else {
          logger.warn('⚠️  [QUANT-CRON] No quant ideas generated');
        }
        
      } catch (error: any) {
        logger.error('📊 [QUANT-CRON] Quant generation failed:', error);
      } finally {
        isQuantGenerating = false;
      }
    });
    
    log('📊 Quant Generator started - will generate ideas at 9:35 AM CT + 1:00 PM CT weekdays');

    // Bullflow tape scanner — the aggressor tape publishes ideas DIRECTLY,
    // no longer waiting for a price pattern to form. Every 10 minutes across
    // the session (effective 8:40–15:00 CT on the */10 grid). See
    // server/bullflow-tape-scanner.ts for why (META 2026-09-09, semis 2026-09-22).
    let isTapeScanning = false;
    cron.default.schedule('*/10 * * * 1-5', async () => {
      if (isTapeScanning) return;
      const nowCT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      const h = nowCT.getHours(), m = nowCT.getMinutes();
      const inSession = (h > 8 || (h === 8 && m >= 35)) && (h < 15 || (h === 15 && m <= 5));
      if (!inSession) return;
      isTapeScanning = true;
      try {
        const { runBullflowTapeScan } = await import('./bullflow-tape-scanner');
        await runBullflowTapeScan();
      } catch (err) {
        logger.error('[TAPE-SCAN] cron failed:', err);
      } finally {
        isTapeScanning = false;
      }
    });
    log('🎯 Bullflow tape scanner started - aggressor tape publishes ideas every 10 min, 8:40-15:00 CT');

    // Bottom-reversal sweep — catches TURNS (higher-lows base, V-recovery)
    // instead of waiting for a continuation pattern. Runs each evening off
    // completed daily bars, publishing tomorrow's reversal slate with a
    // Bullflow confirmation footnote per name. Validated against the Sep
    // 10-22 semis run: MU fires Sep 2 (+14.7% follow-through), SNDK Sep 3
    // (+21.4%). See server/bottom-reversal-scanner.ts.
    cron.default.schedule('40 20 * * 1-5', async () => {
      try {
        const { runBottomReversalSweep } = await import('./bottom-reversal-scanner');
        await runBottomReversalSweep({ publish: true });
      } catch (err) {
        logger.error('[BOTTOM-REV] evening sweep failed:', err);
      }
    }, { timezone: 'America/Chicago' });
    log('🔄 Bottom-reversal scanner started - evening sweep 8:40 PM CT publishes tomorrow\'s reversal slate');

    // Crypto proxy promoter — when BTC/ETH print a qualifying weekly move,
    // interrogate the equity proxies on their OWN evidence (their own tape,
    // their own invalidation) and publish the ones that pass. Twice a day.
    cron.default.schedule('45 8,12 * * 1-5', async () => {
      try {
        const { runCryptoProxyPromotion } = await import('./crypto-proxy-promoter');
        await runCryptoProxyPromotion();
      } catch (err) {
        logger.error('[CRYPTO-PROXY] run failed:', err);
      }
    }, { timezone: 'America/Chicago' });
    log('₿ Crypto proxy promoter started - 8:45 AM + 12:45 PM CT, proxies must pass their own evidence bar');

    // Index swing scanner — SPX-complex pullback entries with the premium
    // discount measured (VIX regime). Twice a day: after the open settles
    // and at midday. See server/index-swing-scanner.ts.
    cron.default.schedule('55 8,12 * * 1-5', async () => {
      try {
        const { runIndexSwingScan } = await import('./index-swing-scanner');
        await runIndexSwingScan();
      } catch (err) {
        logger.error('[INDEX-SWING] run failed:', err);
      }
    }, { timezone: 'America/Chicago' });
    log('📈 Index swing scanner started - 8:55 AM + 12:55 PM CT, SPX-complex pullback discounts');

    // Leader swing scanner — the same pullback discipline on the single-name
    // leadership universe (FTNT/NET/MRVL class), flow-confirmed per candidate.
    cron.default.schedule('5 9,13 * * 1-5', async () => {
      try {
        const { runLeaderSwingScan } = await import('./index-swing-scanner');
        await runLeaderSwingScan();
      } catch (err) {
        logger.error('[LEADER-SWING] run failed:', err);
      }
    }, { timezone: 'America/Chicago' });
    log('🎯 Leader swing scanner started - 9:05 AM + 1:05 PM CT over the leadership universe');

    // Premium-discount scan — weekly ATM IV vs realized on SPY/QQQ. The
    // modern index discounts in PREMIUM, not price. With the index runs.
    cron.default.schedule('58 8,12 * * 1-5', async () => {
      try {
        const { runPremiumDiscountScan } = await import('./index-swing-scanner');
        await runPremiumDiscountScan();
      } catch (err) { logger.error('[PREMIUM-DISC] run failed:', err); }
    }, { timezone: 'America/Chicago' });

    // Extended-hours favorites watch — post-close and pre-open sweeps.
    cron.default.schedule('15 17 * * 1-5', async () => {
      try { const { runExtendedHoursSweep } = await import('./extended-hours-watch'); await runExtendedHoursSweep(); }
      catch (err) { logger.error('[EXT-HOURS] run failed:', err); }
    }, { timezone: 'America/Chicago' });
    cron.default.schedule('45 7 * * 1-5', async () => {
      try { const { runExtendedHoursSweep } = await import('./extended-hours-watch'); await runExtendedHoursSweep(); }
      catch (err) { logger.error('[EXT-HOURS] run failed:', err); }
    }, { timezone: 'America/Chicago' });
    log('\u23f0 Premium-discount (8:58a/12:58p) + extended-hours favorites watch (7:45a/5:15p CT) started');

    // The board is persisted. Starting a server is not evidence for a new trade,
    // so startup never publishes another round of quant ideas. Use the explicit
    // scanner endpoint when a deliberate manual scan is needed.
    const SKIP_STARTUP_SCANS = true;

    if (SKIP_STARTUP_SCANS) {
      logger.info('🚀 [QUANT-STARTUP] Skipping startup publication; persisted signals remain the source of truth');
    }

    (async () => {
      if (SKIP_STARTUP_SCANS) return; // Skip heavy startup operations in production

      try {
        logger.info('🚀 [QUANT-STARTUP] Running one-time quant generation on server startup...');

        const { generateQuantIdeas } = await import('./quant-ideas-generator');
        const { storage: quantStorage } = await import('./storage');
        const marketData = await quantStorage.getAllMarketData();
        const catalysts = await quantStorage.getActiveCatalysts();
        
        // Generate 15 quant ideas across different sectors
        const quantIdeas = await generateQuantIdeas(marketData, catalysts, 15, quantStorage, true);
        
        const savedIdeas = [];
        
        // 🔧 FIX: Check OPEN paper_positions (actual trades), NOT trade_ideas (52k+ research entries)
        // This was causing ALL ideas to be skipped as "duplicates" even though no trades were entered
        const { getOptionsPortfolio } = await import('./auto-lotto-trader');
        const portfolio = await getOptionsPortfolio();
        const openPositionKeys = new Set<string>();
        
        if (portfolio) {
          const openPositions = await quantStorage.getPaperPositionsByPortfolio(portfolio.id);
          for (const pos of openPositions) {
            if (pos.status === 'open') {
              const key = `${pos.symbol}:${pos.optionType || ''}:${pos.strikePrice || ''}`.toUpperCase();
              openPositionKeys.add(key);
            }
          }
          logger.info(`🔍 [QUANT-STARTUP] Open positions to avoid duplicates: ${openPositionKeys.size}`);
        }
        
        for (const idea of quantIdeas) {
          // Skip only if we already have an OPEN POSITION for this exact option
          const ideaKey = `${idea.symbol}:${idea.optionType || ''}:${idea.strikePrice || ''}`.toUpperCase();
          if (openPositionKeys.has(ideaKey)) {
            logger.info(`⏭️  [QUANT-STARTUP] Skipped ${idea.symbol} ${idea.optionType || ''} $${idea.strikePrice || ''} - already have open position`);
            continue;
          }
          
          // Options now allowed - direction bug fixed (was marking puts as 'short' instead of 'long')
          // All options are now LONG (bought) positions with correct P&L calculation
          
          const saved = await quantStorage.createTradeIdea({
            ...idea,
            source: 'quant',
            status: 'published', // Content status (published/draft), not trade outcome
          });
          savedIdeas.push(saved);
        }
        
        if (savedIdeas.length > 0) {
          logger.info(`✅ [QUANT-STARTUP] Generated ${savedIdeas.length} fresh quant trade ideas on startup`);
          const { sendBatchSummaryToDiscord, sendPremiumOptionsAlertToDiscord } = await import('./discord-service');
          
          // 🚀 AUTO-EXECUTE: Actually enter trades, not just generate ideas!
          const { getOptionsPortfolio } = await import('./auto-lotto-trader');
          const { executeTradeIdea } = await import('./paper-trading-service');
          const portfolio = await getOptionsPortfolio();
          
          if (portfolio) {
            let tradesExecuted = 0;
            for (const idea of savedIdeas) {
              // Execute options trades (the ones that have option details)
              if (idea.assetType === 'option' && idea.strikePrice && idea.optionType) {
                try {
                  const result = await executeTradeIdea(portfolio.id, idea);
                  if (result.success && result.position) {
                    tradesExecuted++;
                    logger.info(`🚀 [QUANT-STARTUP] AUTO-EXECUTED: ${idea.symbol} ${idea.optionType?.toUpperCase()} $${idea.strikePrice} @ $${idea.entryPrice?.toFixed(2)} x${result.position.quantity}`);
                  } else {
                    logger.warn(`⚠️ [QUANT-STARTUP] Execution failed for ${idea.symbol}: ${result.error}`);
                  }
                } catch (execErr) {
                  logger.error(`[QUANT-STARTUP] Trade execution error for ${idea.symbol}:`, execErr);
                }
              }
            }
            logger.info(`🎯 [QUANT-STARTUP] AUTO-EXECUTED ${tradesExecuted}/${savedIdeas.length} trades into paper portfolio`);
          } else {
            logger.warn(`⚠️ [QUANT-STARTUP] No portfolio available - trades saved but NOT executed`);
          }
          
          // 🎯 Send premium A/A+ alerts for options
          for (const idea of savedIdeas) {
            const grade = idea.probabilityBand || '';
            if (['A+', 'A'].includes(grade) && idea.assetType === 'option') {
              const dte = idea.expiryDate 
                ? Math.ceil((new Date(idea.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : undefined;
              sendPremiumOptionsAlertToDiscord({
                symbol: idea.symbol,
                optionType: (idea.optionType as 'call' | 'put') || 'call',
                strikePrice: idea.strikePrice || 0,
                expiryDate: idea.expiryDate || '',
                entryPrice: idea.entryPrice || 0,
                targetPrice: idea.targetPrice || 0,
                stopLoss: idea.stopLoss || 0,
                confidence: (idea as any).confidenceScore || 90,
                grade,
                delta: (idea as any).delta,
                dte,
                tradeType: dte && dte <= 1 ? 'day' : dte && dte <= 7 ? 'swing' : 'swing',
                signals: (idea as any).signals || [],
                source: 'quant'
              }).catch(err => logger.error(`[QUANT-STARTUP] Premium alert failed for ${idea.symbol}:`, err));
              logger.info(`📣 [QUANT-STARTUP] Premium A/A+ alert sent: ${idea.symbol} [${grade}]`);
            }
          }
          
          sendBatchSummaryToDiscord(savedIdeas, 'quant').catch(err => 
            logger.error('[QUANT-STARTUP] Discord notification failed:', err)
          );
        } else {
          logger.warn('⚠️  [QUANT-STARTUP] No new quant ideas generated (may be filtered or duplicates)');
        }
        
        // STARTUP TRIGGER: Send weekly picks to Discord for immediate viewing
        try {
          const { generateNextWeekPicks, getNextWeekRange } = await import('./weekly-picks-generator');
          const { sendNextWeekPicksToDiscord } = await import('./discord-service');
          
          const picks = await generateNextWeekPicks();
          const weekRange = getNextWeekRange();
          
          if (picks.length > 0) {
            await sendNextWeekPicksToDiscord(picks, weekRange);
            logger.info(`🎯 [STARTUP] Sent ${picks.length} weekly premium picks to Discord (${weekRange.start} - ${weekRange.end})`);
          } else {
            logger.warn('⚠️  [STARTUP] No weekly picks generated');
          }
        } catch (err: any) {
          logger.error('🎯 [STARTUP] Weekly picks failed:', err);
        }
        
        // STARTUP TRIGGER: Run autonomous bot scan immediately
        try {
          logger.info('🤖 [BOT-STARTUP] Running autonomous options scan on startup...');
          const { runAutonomousBotScan } = await import('./auto-lotto-trader');
          await runAutonomousBotScan();
          logger.info('🤖 [BOT-STARTUP] Autonomous options scan complete');
        } catch (err: any) {
          logger.error('🤖 [BOT-STARTUP] Autonomous scan failed:', err);
        }
        
      } catch (error: any) {
        logger.error('🚀 [QUANT-STARTUP] Startup quant generation failed:', error);
      }
    })();
    
    // Start automated news-driven trade generation (every 15 minutes during market hours)
    const { fetchBreakingNews, getNewsServiceStatus } = await import('./news-service');
    const { generateTradeIdeasFromNews } = await import('./ai-service');
    const { storage } = await import('./storage');
    
    // Schedule news fetching every 15 minutes
    cron.default.schedule('*/15 * * * *', async () => {
      try {
        // Check if market is open or in extended hours (08:00-20:00 ET Mon-Fri)
        const now = new Date();
        const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const hour = nyTime.getHours();
        const dayOfWeek = nyTime.getDay(); // 0 = Sunday, 6 = Saturday
        
        // Skip weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          return;
        }
        
        // Only run during extended market hours: 08:00-20:00 ET (pre-market to after-hours)
        if (hour < 8 || hour >= 20) {
          return;
        }
        
        // Check API quota status
        const status = getNewsServiceStatus();
        if (!status.isHealthy || status.quotaRemaining < 10) {
          logger.warn(`📰 [NEWS-CRON] Skipping news fetch - quota low: ${status.quotaRemaining}/500 remaining`);
          return;
        }
        
        logger.info(`📰 [NEWS-CRON] Fetching breaking news (${hour}:${nyTime.getMinutes().toString().padStart(2, '0')} ET)`);
        
        // Fetch breaking news (limit to 20 articles to conserve quota)
        const breakingNews = await fetchBreakingNews(undefined, undefined, 20);
        
        if (breakingNews.length === 0) {
          logger.info('📰 [NEWS-CRON] No breaking news found');
          return;
        }
        
        logger.info(`📰 [NEWS-CRON] Found ${breakingNews.length} breaking news articles`);
        
        // 🚫 DEDUPLICATION: Check PAPER_POSITIONS (actual trades) not trade_ideas
        // CRITICAL FIX: Previously blocked all symbols with any trade idea (3,453+)
        const existingOpenSymbols = new Set<string>();
        try {
          const portfolios = await storage.getAllPaperPortfolios();
          const quantPortfolio = portfolios.find((p: any) => p.name === 'Quant Bot Auto-Trader');
          if (quantPortfolio) {
            const positions = await storage.getPaperPositionsByPortfolio(quantPortfolio.id);
            positions.filter((p: any) => p.status === 'open').forEach((p: any) => existingOpenSymbols.add(p.symbol.toUpperCase()));
          }
        } catch (e) { /* Allow all if error */ }
        
        // Generate trade ideas from breaking news (limit to top 3 to avoid spam)
        let generatedCount = 0;
        let skippedCount = 0;
        
        for (const article of breakingNews.slice(0, 3)) {
          try {
            // Skip if we already have an open trade for this ticker
            if (existingOpenSymbols.has(article.primaryTicker.toUpperCase())) {
              logger.info(`📰 [NEWS-CRON] Skipped ${article.primaryTicker} - already has open trade`);
              skippedCount++;
              continue;
            }
            
            // Generate trade idea from news
            const aiIdea = await generateTradeIdeasFromNews(article);
            
            if (!aiIdea) {
              logger.warn(`📰 [NEWS-CRON] Failed to generate valid trade from "${article.title}"`);
              continue;
            }
            
            // Save trade idea
            const { entryPrice, targetPrice, stopLoss } = aiIdea;
            const riskRewardRatio = aiIdea.direction === 'long'
              ? (targetPrice - entryPrice) / (entryPrice - stopLoss)
              : (entryPrice - targetPrice) / (stopLoss - entryPrice);
            
            const tradeIdea = await storage.createTradeIdea({
              symbol: aiIdea.symbol,
              assetType: aiIdea.assetType,
              direction: aiIdea.direction,
              holdingPeriod: 'day',
              entryPrice,
              targetPrice,
              stopLoss,
              riskRewardRatio: Math.round(riskRewardRatio * 10) / 10,
              catalyst: aiIdea.catalyst,
              catalystSourceUrl: article.url, // Store news URL
              analysis: aiIdea.analysis,
              liquidityWarning: aiIdea.entryPrice < 5,
              sessionContext: aiIdea.sessionContext,
              timestamp: new Date().toISOString(),
              source: 'news',
              isNewsCatalyst: true,
              expiryDate: aiIdea.expiryDate || null,
              strikePrice: (aiIdea as any).strikePrice || null,
              optionType: (aiIdea as any).optionType || null,
              isLottoPlay: (aiIdea as any).isLottoPlay || false,
            });
            
            generatedCount++;
            logger.info(`✅ [NEWS-CRON] Created news-driven trade: ${tradeIdea.symbol} ${tradeIdea.direction.toUpperCase()} from "${article.title}"`);
            
            // Send Discord notification for news-driven trade
            const { sendBatchSummaryToDiscord } = await import('./discord-service');
            sendBatchSummaryToDiscord([tradeIdea], 'news').catch(err => 
              logger.error('[NEWS-CRON] Discord notification failed:', err)
            );
          } catch (error: any) {
            logger.error(`📰 [NEWS-CRON] Failed to process article "${article.title}":`, error);
          }
        }
        
        if (generatedCount > 0) {
          logger.info(`📰 [NEWS-CRON] Generated ${generatedCount} news-driven trades (${skippedCount} skipped - duplicates)`);
        } else {
          logger.info(`📰 [NEWS-CRON] No trades generated from ${breakingNews.length} breaking news articles`);
        }
        
        // Log quota status
        const updatedStatus = getNewsServiceStatus();
        logger.info(`📰 [NEWS-CRON] API quota: ${updatedStatus.quotaUsed}/500 used, ${updatedStatus.quotaRemaining} remaining`);
      } catch (error: any) {
        logger.error('📰 [NEWS-CRON] News processing failed:', error);
      }
    });
    
    log('📰 News Monitor started - fetching breaking news every 15 minutes during market hours (08:00-20:00 ET)');
    
    // Start automated unusual options flow scanner (every 15 minutes during market hours)
    const { scanUnusualOptionsFlow, isMarketHoursForFlow } = await import('./flow-scanner');
    const { validateAndLog: validateTradeStructure } = await import('./trade-validation');
    
    // Schedule flow scanning every 15 minutes
    cron.default.schedule('*/15 * * * *', async () => {
      try {
        // Check if market is open (9:30 AM - 4:00 PM ET, Mon-Fri)
        if (!isMarketHoursForFlow()) {
          return;
        }
        
        logger.info('📊 [FLOW-CRON] Starting automated flow scan...');
        
        // Scan for unusual options flow
        const flowIdeas = await scanUnusualOptionsFlow();
        
        if (flowIdeas.length === 0) {
          logger.info('📊 [FLOW-CRON] No unusual flow detected');
          return;
        }
        
        logger.info(`📊 [FLOW-CRON] Found ${flowIdeas.length} flow signals, validating...`);
        
        // 🚫 DEDUPLICATION: Check PAPER_POSITIONS (actual trades) not trade_ideas
        // CRITICAL FIX: Previously blocked all symbols with any trade idea (3,453+)
        const existingOpenSymbols = new Set<string>();
        try {
          const portfolios = await storage.getAllPaperPortfolios();
          const quantPortfolio = portfolios.find((p: any) => p.name === 'Quant Bot Auto-Trader');
          if (quantPortfolio) {
            const positions = await storage.getPaperPositionsByPortfolio(quantPortfolio.id);
            positions.filter((p: any) => p.status === 'open').forEach((p: any) => existingOpenSymbols.add(p.symbol.toUpperCase()));
          }
        } catch (e) { /* Allow all if error */ }
        
        // Validate and save flow trades
        let savedCount = 0;
        let rejectedCount = 0;
        let duplicateCount = 0;
        const savedIdeas = [];
        
        for (const idea of flowIdeas) {
          try {
            // Skip duplicates
            if (existingOpenSymbols.has(idea.symbol.toUpperCase())) {
              logger.info(`📊 [FLOW-CRON] Skipped ${idea.symbol} - already has open trade`);
              duplicateCount++;
              continue;
            }
            
            // 🛡️ LAYER 1: Structural validation (with options fields)
            const structureValid = validateTradeStructure({
              symbol: idea.symbol,
              assetType: idea.assetType as 'stock' | 'option' | 'crypto',
              direction: idea.direction as 'long' | 'short',
              entryPrice: idea.entryPrice,
              targetPrice: idea.targetPrice,
              stopLoss: idea.stopLoss,
              // Options-specific fields (required for option validation)
              strikePrice: idea.strikePrice ?? undefined,
              expiryDate: idea.expiryDate ?? undefined,
              optionType: idea.optionType as 'call' | 'put' | undefined
            }, 'Flow-Cron');
            
            if (!structureValid) {
              rejectedCount++;
              continue;
            }
            
            // 🛡️ LAYER 2: Risk validation
            const { validateTradeRisk } = await import('./ai-service');
            const validation = validateTradeRisk({
              symbol: idea.symbol,
              assetType: idea.assetType as 'stock' | 'option' | 'crypto',
              direction: idea.direction as 'long' | 'short',
              entryPrice: idea.entryPrice,
              targetPrice: idea.targetPrice,
              stopLoss: idea.stopLoss,
              catalyst: idea.catalyst || '',
              analysis: idea.analysis || '',
              sessionContext: idea.sessionContext || ''
            });
            
            if (!validation.isValid) {
              logger.warn(`📊 [FLOW-CRON] REJECTED ${idea.symbol} - ${validation.reason}`);
              rejectedCount++;
              continue;
            }
            
            // Save trade idea
            const tradeIdea = await storage.createTradeIdea(idea);
            savedIdeas.push(tradeIdea);
            savedCount++;

            logger.info(`✅ [FLOW-CRON] Created flow trade: ${tradeIdea.symbol} ${tradeIdea.direction.toUpperCase()} - Entry=$${tradeIdea.entryPrice}, Target=$${tradeIdea.targetPrice}, R:R=${tradeIdea.riskRewardRatio.toFixed(2)}:1`);

            // 🐋 WHALE FLOW DETECTION - Check if this is institutional-level flow
            const totalPremium = (tradeIdea.entryPrice || 0) * 100; // Premium per contract * 100 shares
            const isWhaleFlow = totalPremium >= 10000; // $10k+ per contract = whale territory
            const isMegaWhale = totalPremium >= 50000; // $50k+ per contract = mega whale

            // 📣 Send individual Discord alert AFTER successful save (prevents ghost alerts)
            const grade = tradeIdea.probabilityBand || '';
            const entryPrice = tradeIdea.entryPrice || 0;
            const DISCORD_ALERT_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-'];
            const isValidGrade = DISCORD_ALERT_GRADES.includes(grade);
            const maxPremiumFor5Contracts = 2.00; // $1000 budget / 5 contracts / 100 shares
            const isAffordable = entryPrice <= maxPremiumFor5Contracts;

            // 🐋 WHALE FLOW ALERT - Send regardless of affordability
            if (isWhaleFlow || isMegaWhale) {
              // Save whale flow to database for tracking
              try {
                await storage.createWhaleFlow({
                  symbol: tradeIdea.symbol,
                  optionType: (tradeIdea.optionType as 'call' | 'put') || 'call',
                  strikePrice: tradeIdea.strikePrice || 0,
                  expiryDate: tradeIdea.expiryDate || '',
                  entryPrice: entryPrice,
                  targetPrice: tradeIdea.targetPrice || 0,
                  stopLoss: tradeIdea.stopLoss || 0,
                  premiumPerContract: totalPremium,
                  isMegaWhale,
                  flowSize: isMegaWhale ? 'mega_whale' : 'whale',
                  grade,
                  confidenceScore: tradeIdea.confidenceScore || 0,
                  direction: tradeIdea.direction as 'long' | 'short',
                  outcomeStatus: 'open',
                  discordNotified: false,
                  tradeIdeaId: tradeIdea.id,
                });
                logger.info(`🐋 [WHALE-DB] Saved whale flow to database: ${tradeIdea.symbol}`);
              } catch (err) {
                logger.error(`🐋 [WHALE-DB] Failed to save whale flow: ${err}`);
              }

              // Send Discord alert
              const { sendWhaleFlowAlertToDiscord } = await import('./discord-service');
              sendWhaleFlowAlertToDiscord({
                symbol: tradeIdea.symbol,
                optionType: (tradeIdea.optionType as 'call' | 'put') || 'call',
                strikePrice: tradeIdea.strikePrice || 0,
                expiryDate: tradeIdea.expiryDate || '',
                entryPrice: entryPrice,
                targetPrice: tradeIdea.targetPrice || 0,
                stopLoss: tradeIdea.stopLoss || 0,
                grade,
                premiumPerContract: totalPremium,
                isMegaWhale,
                direction: tradeIdea.direction as 'long' | 'short',
                confidenceScore: tradeIdea.confidenceScore || 0
              }).catch(err => logger.error(`🐋 [FLOW-CRON] Whale alert failed for ${tradeIdea.symbol}:`, err));
              logger.warn(`🐋 [WHALE-ALERT] ${isMegaWhale ? 'MEGA ' : ''}WHALE FLOW: ${tradeIdea.symbol} ${tradeIdea.optionType?.toUpperCase()} $${tradeIdea.strikePrice} - $${(totalPremium / 1000).toFixed(1)}k premium per contract`);
            }

            // 📣 REGULAR AFFORDABILITY-BASED ALERTS
            if (isValidGrade && isAffordable) {
              const { sendFlowAlertToDiscord, sendPremiumOptionsAlertToDiscord } = await import('./discord-service');
              const targetPercent = tradeIdea.targetPrice && entryPrice 
                ? ((tradeIdea.targetPrice - entryPrice) / entryPrice * 100).toFixed(0)
                : '?';
              const rr = tradeIdea.riskRewardRatio?.toFixed(1) || '?';
              
              // 🎯 PREMIUM A/A+ FORMAT - Use premium template for high-conviction options
              if (['A+', 'A'].includes(grade) && tradeIdea.assetType === 'option') {
                const dte = tradeIdea.expiryDate 
                  ? Math.ceil((new Date(tradeIdea.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                  : undefined;
                sendPremiumOptionsAlertToDiscord({
                  symbol: tradeIdea.symbol,
                  optionType: (tradeIdea.optionType as 'call' | 'put') || 'call',
                  strikePrice: tradeIdea.strikePrice || 0,
                  expiryDate: tradeIdea.expiryDate || '',
                  entryPrice: entryPrice,
                  targetPrice: tradeIdea.targetPrice || 0,
                  stopLoss: tradeIdea.stopLoss || 0,
                  confidence: tradeIdea.confidenceScore || 90,
                  grade,
                  delta: (tradeIdea as any).delta,
                  dte,
                  tradeType: dte && dte <= 1 ? 'day' : dte && dte <= 7 ? 'swing' : 'swing',
                  signals: (tradeIdea as any).signals || [],
                  source: 'flow'
                }).catch(err => logger.error(`📊 [FLOW-CRON] Premium alert failed for ${tradeIdea.symbol}:`, err));
                logger.info(`📣 [FLOW-CRON] Premium A/A+ alert sent: ${tradeIdea.symbol} ${tradeIdea.optionType?.toUpperCase()} $${tradeIdea.strikePrice} [${grade}]`);
              } else {
                // Standard format for B+ and below
                sendFlowAlertToDiscord({
                  symbol: tradeIdea.symbol,
                  optionType: tradeIdea.optionType || 'call',
                  strikePrice: tradeIdea.strikePrice || 0,
                  expiryDate: tradeIdea.expiryDate || '',
                  entryPrice: entryPrice,
                  targetPrice: tradeIdea.targetPrice || 0,
                  targetPercent,
                  grade,
                  riskReward: rr,
                  isLotto: (tradeIdea as any).isLottoPlay || false
                }).catch(err => logger.error(`📊 [FLOW-CRON] Discord alert failed for ${tradeIdea.symbol}:`, err));
                logger.info(`📣 [FLOW-CRON] Discord alert sent: ${tradeIdea.symbol} ${tradeIdea.optionType?.toUpperCase()} $${tradeIdea.strikePrice} (${grade})`);
              }
            }
            
          } catch (error: any) {
            logger.error(`📊 [FLOW-CRON] Failed to process ${idea.symbol}:`, error);
            rejectedCount++;
          }
        }
        
        // Send Discord notification for batch
        if (savedCount > 0) {
          const { sendBatchSummaryToDiscord } = await import('./discord-service');
          sendBatchSummaryToDiscord(savedIdeas, 'flow').catch(err => 
            logger.error('[FLOW-CRON] Discord notification failed:', err)
          );
        }
        
        logger.info(`📊 [FLOW-CRON] Complete: ${savedCount} trades created, ${rejectedCount} rejected, ${duplicateCount} duplicates skipped`);
        
      } catch (error: any) {
        logger.error('📊 [FLOW-CRON] Flow scan failed:', error);
      }
    });
    
    log('📊 Flow Scanner started - scanning unusual options every 15 minutes during market hours (9:30 AM-4:00 PM ET)');
    
    // CONSOLIDATED BOT SCANNING - Fast opportunistic scanning every 3 minutes
    // DISABLED IN PRODUCTION to prevent memory exhaustion on Render
    // Single unified scan loop that checks for opportunities then monitors positions
    const lastScanTime: Record<string, number> = {};
    const SCAN_COOLDOWN_MS = 6 * 60 * 1000; // 6 minute cooldown between full scans (every other cycle)
    const POSITION_CHECK_MS = 3 * 60 * 1000; // 3 minute cooldown for position monitoring

    // Unified options bot - 6-minute scanning cycle during market hours
    // RE-ENABLED: Now with proper rate limiting and memory optimizations
    cron.default.schedule('*/6 * * * *', async () => {
      try {
        if (!isMarketHoursForFlow()) {
          return;
        }

        const now = Date.now();
        const lastOptionsScan = lastScanTime['options'] || 0;
        const { runAutonomousBotScan, monitorLottoPositions } = await import('./auto-lotto-trader');

        // Always monitor existing positions (quick check)
        await monitorLottoPositions();

        // Only do full scan if cooldown has passed (prevents redundant scanning)
        if (now - lastOptionsScan >= SCAN_COOLDOWN_MS) {
          logger.info('🤖 [UNIFIED-BOT] Running opportunistic OPTIONS scan...');
          await runAutonomousBotScan();
          lastScanTime['options'] = now;

          // 🎰 LOTTO SCANNER - Generate and auto-execute lotto plays
          try {
            const { runLottoScanner } = await import('./lotto-scanner');
            logger.info('🎰 [LOTTO-SCANNER] Running lotto scanner for cheap far-OTM plays...');
            await runLottoScanner();
          } catch (lottoError: any) {
            logger.error('🎰 [LOTTO-SCANNER] Lotto scan failed:', lottoError);
          }
        }

      } catch (error: any) {
        logger.error('🤖 [UNIFIED-BOT] Options scan failed:', error);
      }
    });

    log('🤖 Unified Options Bot ENABLED - 6-minute scanning cycle (9:30 AM-4:00 PM ET)');
    log('🎰 Lotto Scanner ENABLED - hunts cheap far-OTM weeklies during market hours');

    // Crypto Bot - 10-minute scanning cycle (24/7 since crypto markets never close)
    // RE-ENABLED: Staggered 2 minutes after options bot to prevent memory spikes
    cron.default.schedule('2,12,22,32,42,52 * * * *', async () => {
      try {
        const now = Date.now();
        const lastCryptoScan = lastScanTime['crypto'] || 0;

        // Only scan if cooldown has passed
        if (now - lastCryptoScan >= 10 * 60 * 1000) {
          const { runCryptoBotScan, monitorCryptoPositions } = await import('./auto-lotto-trader');

          logger.info('🪙 [CRYPTO-BOT] Running crypto scan...');
          await runCryptoBotScan();
          await monitorCryptoPositions();
          lastScanTime['crypto'] = now;
        }
      } catch (error: any) {
        logger.error('🪙 [CRYPTO-BOT] Scan failed:', error);
      }
    });

    log('🪙 Crypto Bot ENABLED - 10-minute scanning cycle (24/7)');

    // Futures Bot - 10-minute scanning cycle during CME market hours
    // RE-ENABLED: Staggered 4 minutes after options bot
    cron.default.schedule('4,14,24,34,44,54 * * * *', async () => {
      try {
        const now = Date.now();
        const lastFuturesScan = lastScanTime['futures'] || 0;

        // Only scan if cooldown has passed
        if (now - lastFuturesScan >= 10 * 60 * 1000) {
          const { runFuturesBotScan, monitorFuturesPositions } = await import('./auto-lotto-trader');

          logger.info('📈 [FUTURES-BOT] Running futures scan...');
          await runFuturesBotScan();
          await monitorFuturesPositions();
          lastScanTime['futures'] = now;
        }
      } catch (error: any) {
        logger.error('📈 [FUTURES-BOT] Scan failed:', error);
      }
    });

    log('📈 Futures Bot ENABLED - 10-minute scanning cycle (during CME hours)');

    // Prediction Market Scanner - Polymarket arbitrage opportunities every 30 minutes
    cron.default.schedule('*/30 * * * *', async () => {
      try {
        const { runPredictionMarketScan } = await import('./polymarket-service');
        logger.info('[POLYMARKET] Starting prediction market scan...');
        await runPredictionMarketScan();
      } catch (error: any) {
        logger.error('[POLYMARKET] Scan failed:', error);
      }
    });
    
    log('[POLYMARKET] Prediction Market Scanner started - scanning Polymarket every 30 minutes');
    
    // Watchlist Grading - Re-grade all watchlist items every 15 minutes during market hours
    cron.default.schedule('*/15 * * * *', async () => {
      try {
        const now = new Date();
        const nowCT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const hour = nowCT.getHours();
        const dayOfWeek = nowCT.getDay();
        
        // Only grade during market hours (8 AM - 4 PM CT on weekdays)
        if (dayOfWeek === 0 || dayOfWeek === 6 || hour < 8 || hour >= 16) {
          return; // Silent skip outside market hours
        }
        
        const { gradeAllWatchlistItems } = await import('./watchlist-grading-service');
        logger.info('[GRADE] Starting scheduled watchlist grading...');
        const result = await gradeAllWatchlistItems();
        logger.info(`[GRADE] Graded ${result.graded}/${result.total} items`);
      } catch (error: any) {
        logger.error('[GRADE] Scheduled grading failed:', error);
      }
    });
    
    log('📊 Watchlist Grading started - re-grading every 15 minutes during market hours');

    // Earnings Trade Scanner - Scan for earnings plays every hour during market hours
    cron.default.schedule('0 * * * *', async () => {
      try {
        const now = new Date();
        const nowCT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const hour = nowCT.getHours();
        const dayOfWeek = nowCT.getDay();

        // Only scan during market hours (8 AM - 4 PM CT on weekdays)
        if (dayOfWeek === 0 || dayOfWeek === 6 || hour < 8 || hour >= 16) {
          return; // Silent skip outside market hours
        }

        const { scanEarningsOpportunities } = await import('./earnings-trade-scanner');
        logger.info('[EARNINGS] Starting scheduled earnings opportunity scan...');
        const ideasGenerated = await scanEarningsOpportunities();
        logger.info(`[EARNINGS] Scan complete: ${ideasGenerated} trade ideas generated`);
      } catch (error: any) {
        logger.error('[EARNINGS] Scheduled scan failed:', error);
      }
    });

    log('📅 Earnings Trade Scanner started - scanning for earnings plays every hour during market hours');

    // Daily summary to Discord at 8:00 AM CT (before market open)
    let lastDailySummaryDate: string | null = null;
    
    cron.default.schedule('*/5 * * * *', async () => {
      try {
        const now = new Date();
        const nowCT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        
        const hour = nowCT.getHours();
        const minute = nowCT.getMinutes();
        const dayOfWeek = nowCT.getDay();
        const dateKey = nowCT.toISOString().split('T')[0];
        
        // Skip weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          return;
        }
        
        // Check if it's 8:30 AM CT (hour = 8, minute = 30-34 to catch the window)
        const isDailySummaryTime = hour === 8 && minute >= 30 && minute < 35;
        
        if (!isDailySummaryTime) {
          return;
        }
        
        // Check if we already sent today
        if (lastDailySummaryDate === dateKey) {
          return;
        }
        
        lastDailySummaryDate = dateKey;

        logger.info('📨 [DAILY-PREVIEW] Sending 8:30 AM trading preview to Discord...');

        // Send daily preview with market movers and breakouts
        const { sendDailyPreview } = await import('./discord-service');
        const result = await sendDailyPreview();

        if (result.success) {
          logger.info(`📨 [DAILY-PREVIEW] ${result.message}`);
        } else {
          logger.error(`📨 [DAILY-PREVIEW] Failed: ${result.message}`);
        }
        
      } catch (error: any) {
        logger.error('📨 [DAILY-SUMMARY] Failed to send daily summary:', error);
      }
    });
    
    log('📨 Daily Summary started - sending top ideas to Discord at 8:30 AM CT weekdays');
    
    // Next Week Premium Picks to Discord on Sunday at 5:00 PM CT (1 hour before regular watchlist)
    let lastNextWeekPicksDate = '';
    cron.default.schedule('*/5 * * * *', async () => {
      try {
        const ctTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const dayOfWeek = ctTime.getDay(); // 0 = Sunday
        const hour = ctTime.getHours();
        const minute = ctTime.getMinutes();
        const dateKey = ctTime.toISOString().split('T')[0];
        
        // Check if it's Sunday 5:00 PM CT
        const isPremiumPicksTime = dayOfWeek === 0 && hour === 17 && minute >= 0 && minute < 5;
        
        if (!isPremiumPicksTime) {
          return;
        }
        
        // Check if we already sent this week
        if (lastNextWeekPicksDate === dateKey) {
          return;
        }
        
        lastNextWeekPicksDate = dateKey;
        
        logger.info('🎯 [NEXT-WEEK-PICKS] Generating premium picks for next week...');
        
        // Generate picks and send to Discord
        const { generateNextWeekPicks, getNextWeekRange } = await import('./weekly-picks-generator');
        const { sendNextWeekPicksToDiscord } = await import('./discord-service');
        
        const picks = await generateNextWeekPicks();
        const weekRange = getNextWeekRange();
        
        await sendNextWeekPicksToDiscord(picks, weekRange);
        
        logger.info(`🎯 [NEXT-WEEK-PICKS] Sent ${picks.length} premium picks to Discord`);
        
      } catch (error: any) {
        logger.error('🎯 [NEXT-WEEK-PICKS] Failed to generate picks:', error);
      }
    });
    
    log('🎯 Next Week Picks started - sending premium plays to Discord every Sunday at 5:00 PM CT');
    
    // Weekly watchlist summary to Discord on Sunday at 6:00 PM CT
    let lastWeeklyWatchlistDate = '';
    cron.default.schedule('*/5 * * * *', async () => {
      try {
        const ctTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const dayOfWeek = ctTime.getDay(); // 0 = Sunday
        const hour = ctTime.getHours();
        const minute = ctTime.getMinutes();
        const dateKey = ctTime.toISOString().split('T')[0];
        
        // Check if it's Sunday 6:00 PM CT
        const isWeeklyTime = dayOfWeek === 0 && hour === 18 && minute >= 0 && minute < 5;
        
        if (!isWeeklyTime) {
          return;
        }
        
        // Check if we already sent this week
        if (lastWeeklyWatchlistDate === dateKey) {
          return;
        }
        
        lastWeeklyWatchlistDate = dateKey;
        
        logger.info('📋 [WEEKLY-WATCHLIST] Sending weekly watchlist to Discord...');
        
        // Get all watchlist items
        const { db } = await import('./db');
        const { watchlist } = await import('@shared/schema');
        const watchlistItems = await db.select().from(watchlist);
        
        // Send weekly summary
        const { sendWeeklyWatchlistToDiscord } = await import('./discord-service');
        await sendWeeklyWatchlistToDiscord(watchlistItems);
        
        logger.info('📋 [WEEKLY-WATCHLIST] Weekly watchlist sent successfully');
        
      } catch (error: any) {
        logger.error('📋 [WEEKLY-WATCHLIST] Failed to send weekly watchlist:', error);
      }
    });
    
    log('📋 Weekly Watchlist started - sending to Discord every Sunday at 6:00 PM CT');
    
    // ============================================================================
    // PLATFORM REPORT GENERATOR CRON JOBS
    // ============================================================================
    
    // Daily Report: 5:00 PM CT (after market close) on weekdays
    let lastDailyReportDate = '';
    cron.default.schedule('*/5 * * * *', async () => {
      try {
        const ctTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const dayOfWeek = ctTime.getDay(); // 0 = Sunday, 6 = Saturday
        const hour = ctTime.getHours();
        const minute = ctTime.getMinutes();
        const dateKey = ctTime.toISOString().split('T')[0];
        
        // Check if it's weekday 5:00 PM CT (hour = 17, minute = 0-4)
        const isDailyReportTime = dayOfWeek >= 1 && dayOfWeek <= 5 && hour === 17 && minute >= 0 && minute < 5;
        
        if (!isDailyReportTime) {
          return;
        }
        
        // Check if we already generated today
        if (lastDailyReportDate === dateKey) {
          return;
        }
        
        lastDailyReportDate = dateKey;
        
        logger.info('📊 [DAILY-REPORT] Generating end-of-day platform report...');
        
        const { generateDailyReport } = await import('./report-generator');
        const report = await generateDailyReport();
        
        logger.info(`📊 [DAILY-REPORT] Report generated successfully: ${report.id} (${report.totalIdeasGenerated} ideas, ${report.overallWinRate?.toFixed(1)}% win rate)`);
        
      } catch (error: any) {
        logger.error('📊 [DAILY-REPORT] Failed to generate daily report:', error);
      }
    });
    
    log('📊 Daily Report Generator started - generating at 5:00 PM CT weekdays');
    
    // Weekly Report: Sunday 11:59 PM CT
    let lastWeeklyReportDate = '';
    cron.default.schedule('*/5 * * * *', async () => {
      try {
        const ctTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const dayOfWeek = ctTime.getDay(); // 0 = Sunday
        const hour = ctTime.getHours();
        const minute = ctTime.getMinutes();
        const dateKey = ctTime.toISOString().split('T')[0];
        
        // Check if it's Sunday 11:55-11:59 PM CT (hour = 23, minute = 55-59)
        const isWeeklyReportTime = dayOfWeek === 0 && hour === 23 && minute >= 55 && minute <= 59;
        
        if (!isWeeklyReportTime) {
          return;
        }
        
        // Check if we already generated this week
        if (lastWeeklyReportDate === dateKey) {
          return;
        }
        
        lastWeeklyReportDate = dateKey;
        
        logger.info('📈 [WEEKLY-REPORT] Generating weekly platform report...');
        
        const { generateWeeklyReport } = await import('./report-generator');
        const report = await generateWeeklyReport();
        
        logger.info(`📈 [WEEKLY-REPORT] Report generated successfully: ${report.id} (${report.totalIdeasGenerated} ideas, ${report.overallWinRate?.toFixed(1)}% win rate)`);
        
      } catch (error: any) {
        logger.error('📈 [WEEKLY-REPORT] Failed to generate weekly report:', error);
      }
    });
    
    log('📈 Weekly Report Generator started - generating Sundays at 11:59 PM CT');
    
    // Monthly Report: 1st of each month at 12:01 AM CT
    let lastMonthlyReportMonth = '';
    cron.default.schedule('*/5 * * * *', async () => {
      try {
        const ctTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const day = ctTime.getDate();
        const hour = ctTime.getHours();
        const minute = ctTime.getMinutes();
        const monthKey = `${ctTime.getFullYear()}-${String(ctTime.getMonth() + 1).padStart(2, '0')}`;
        
        // Check if it's 1st of month at 12:00-12:05 AM CT
        const isMonthlyReportTime = day === 1 && hour === 0 && minute >= 0 && minute < 5;
        
        if (!isMonthlyReportTime) {
          return;
        }
        
        // Check if we already generated for this month
        if (lastMonthlyReportMonth === monthKey) {
          return;
        }
        
        lastMonthlyReportMonth = monthKey;
        
        // Generate report for previous month
        const prevMonth = ctTime.getMonth() === 0 ? 12 : ctTime.getMonth();
        const prevYear = ctTime.getMonth() === 0 ? ctTime.getFullYear() - 1 : ctTime.getFullYear();
        
        logger.info(`📅 [MONTHLY-REPORT] Generating monthly platform report for ${prevYear}-${String(prevMonth).padStart(2, '0')}...`);
        
        const { generateMonthlyReport } = await import('./report-generator');
        const report = await generateMonthlyReport(prevYear, prevMonth);
        
        logger.info(`📅 [MONTHLY-REPORT] Report generated successfully: ${report.id} (${report.totalIdeasGenerated} ideas, ${report.overallWinRate?.toFixed(1)}% win rate)`);
        
      } catch (error: any) {
        logger.error('📅 [MONTHLY-REPORT] Failed to generate monthly report:', error);
      }
    });
    
    log('📅 Monthly Report Generator started - generating 1st of month at 12:01 AM CT');
    
    // ============================================================================
    // DAILY PREMIUM TRACKING - Track option premiums for watchlist items
    // Runs at 4:30 PM CT (after market close) on weekdays
    // ============================================================================
    let lastPremiumTrackingDate = '';
    cron.default.schedule('*/5 * * * *', async () => {
      try {
        const ctTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const dayOfWeek = ctTime.getDay(); // 0 = Sunday, 6 = Saturday
        const hour = ctTime.getHours();
        const minute = ctTime.getMinutes();
        const dateKey = ctTime.toISOString().split('T')[0];
        
        // Skip weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          return;
        }
        
        // Check if it's 4:30-4:35 PM CT (after market close)
        const isPremiumTrackingTime = hour === 16 && minute >= 30 && minute < 35;
        
        if (!isPremiumTrackingTime) {
          return;
        }
        
        // Check if we already tracked today
        if (lastPremiumTrackingDate === dateKey) {
          return;
        }
        
        lastPremiumTrackingDate = dateKey;
        
        logger.info('💰 [PREMIUM-TRACKER] Starting daily premium tracking for watchlist items...');
        
        const { trackAllPremiums } = await import('./premium-tracking-service');
        const result = await trackAllPremiums();
        
        logger.info(`💰 [PREMIUM-TRACKER] Completed: ${result.tracked} items tracked, ${result.failed} failed`);
        
        // Check for premium opportunities and send alerts
        const { checkPremiumOpportunities } = await import('./premium-tracking-service');
        await checkPremiumOpportunities();
        
      } catch (error: any) {
        logger.error('💰 [PREMIUM-TRACKER] Failed to track premiums:', error);
      }
    });
    
    log('💰 Premium Tracker started - tracking option premiums at 4:30 PM CT weekdays');
    
    // ============================================================================
    // DYNAMIC MOVER DISCOVERY - Find stocks NOT in static universe that are moving
    // Runs every 15 minutes during market hours to catch emerging movers
    // ============================================================================
    cron.default.schedule('*/15 * * * *', async () => {
      try {
        const ctTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const dayOfWeek = ctTime.getDay();
        const hour = ctTime.getHours();
        
        // Skip weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          return;
        }
        
        // Only run during extended market hours (8 AM - 5 PM CT)
        if (hour < 8 || hour > 17) {
          return;
        }
        
        logger.info('🔍 [MOVER-DISCOVERY] Running dynamic mover discovery scan...');
        
        const { runMoverDiscovery } = await import('./market-scanner');
        const result = await runMoverDiscovery();
        
        if (result.newMovers.length > 0) {
          logger.info(`🔍 [MOVER-DISCOVERY] Found ${result.newMovers.length} new movers not in static universe`);
        }
        
      } catch (error: any) {
        logger.error('🔍 [MOVER-DISCOVERY] Failed to run mover discovery:', error);
      }
    });
    
    log('🔍 Mover Discovery started - scanning for emerging movers every 15 min during market hours');
    
    // ============================================================================
    // BULLISH TREND SCANNER - Track momentum stocks and breakouts
    // Runs every 30 minutes during market hours + initial scan on startup
    // ============================================================================
    
    // Initial scan REMOVED — heavy services handle this during market hours
    // via startBullishTrendScanner() in startHeavyServices()

    // Schedule regular scans every 30 minutes (only runs during market hours)
    cron.default.schedule('*/30 * * * *', async () => {
      try {
        const ctTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const dayOfWeek = ctTime.getDay();
        const hour = ctTime.getHours();
        
        // Skip weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          return;
        }
        
        // Only run during market hours (8 AM - 5 PM CT)
        if (hour < 8 || hour > 17) {
          return;
        }
        
        logger.info('📈 [BULLISH-TRENDS] Running scheduled bullish trend scan...');
        
        const { scanBullishTrends, ingestBullishTrendsToTradeDesk } = await import('./bullish-trend-scanner');
        const results = await scanBullishTrends();
        
        logger.info(`📈 [BULLISH-TRENDS] Scan complete: ${results.length} stocks analyzed`);
        
        // Ingest strong trends to Trade Desk
        const ingestionResult = await ingestBullishTrendsToTradeDesk();
        logger.info(`📈 [BULLISH-TRENDS] Ingested ${ingestionResult.ingested} ideas to Trade Desk (${ingestionResult.skipped} skipped)`);
        
      } catch (error: any) {
        logger.error('📈 [BULLISH-TRENDS] Scheduled scan failed:', error);
      }
    });
    
    log('📈 Bullish Trend Scanner started - analyzing momentum stocks every 30 min during market hours');

    // ============================================================================
    // AUTO-CLEANUP - Remove stale/expired trades to free memory
    // Runs every hour to keep Trade Desk showing only RELEVANT opportunities
    // ============================================================================
    cron.default.schedule('0 * * * *', async () => {
      try {
        const { storage } = await import('./storage');
        const deletedCount = await storage.cleanupStaleTradeIdeas();
        if (deletedCount > 0) {
          logger.info(`🧹 [AUTO-CLEANUP] Removed ${deletedCount} stale/expired trades from memory`);
        }
      } catch (error: any) {
        logger.error('🧹 [AUTO-CLEANUP] Cleanup failed:', error);
      }
    });

    log('🧹 Auto-Cleanup started - removing stale trades every hour to free memory');

    // Warm the conviction board immediately, then keep it warm.
    //
    // A cold build takes over two minutes, so without this the first person to
    // load the platform after any restart either waits it out or is told the
    // signals are "still warming up". That WAS the normal experience: nothing
    // populated the cache on boot, so it only ever filled when a human happened
    // to open the Oracle tab, and every restart put it back to cold.
    //
    // Deliberately not awaited — the process serves immediately and the board
    // arrives when it arrives.
    void (async () => {
      try {
        const { warmConvictions } = await import("./convictions-engine");
        await warmConvictions("boot");
        // early-rotation measured 13.8s cold and is the slowest thing on the
        // first page load. Warming it here means the first visitor after a
        // restart gets the cached answer instead of paying for it.
        void fetch(`http://127.0.0.1:${process.env.PORT || 5000}/api/early-rotation`)
          .then(() => log("🔥 early-rotation cache warmed"))
          .catch(() => { /* best effort; the route still works cold */ });
        // Refresh ahead of the 5-minute TTL so the entry is replaced before it
        // can expire and nobody ever meets a cold cache.
        setInterval(() => { void warmConvictions("interval"); }, 4 * 60_000);
      } catch (err) {
        log("⚠️  Conviction warm-up failed to start: " + String(err));
      }
    })();

  });
})();

/**
 * Hand the scheduler lock back on a clean shutdown.
 *
 * Postgres releases a session advisory lock when the connection dies anyway, so
 * this is not required for correctness — but on a rolling deploy it lets the
 * incoming instance take over immediately instead of idling as a follower until
 * the old connection is reaped.
 */
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    void releaseSchedulerLock().finally(() => process.exit(0));
  });
}
