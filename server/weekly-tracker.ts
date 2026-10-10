/**
 * WEEKLY TRACKER SERVICE
 * ======================
 * Polls live prices for every symbol on the current week's weekly watchlist
 * and pushes ticks over WebSocket (`/ws/weekly-watchlist`) so the UI can
 * update without polling.
 *
 * Cadence:
 *   - 5 seconds during market hours
 *   - 60 seconds outside market hours (so the panel still shows close prices
 *     when you check it on the weekend)
 *
 * Symbol set is refreshed from the database every 60s — when you add/remove
 * a ticker via the UI, the next refresh picks it up.
 */

import WebSocket, { WebSocketServer } from "ws";
import type { Server } from "http";
import { logger } from "./logger";
import { getCurrentWeekSymbols } from "./weekly-watchlist-seeder";
import { getRealtimeBatchQuotes } from "./realtime-pricing-service";
import { getPreMarketBatch, currentMarketPhase } from "./pre-market-service";

interface Tick {
  symbol: string;
  price: number;
  chgPct: number;
  ts: number;
}

let wss: WebSocketServer | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let symbolRefreshTimer: NodeJS.Timeout | null = null;
let cachedSymbols: string[] = [];
let lastSymbolRefresh = 0;

const MARKET_HOURS_MS = 5_000;
const OFF_HOURS_MS = 60_000;
const SYMBOL_REFRESH_MS = 60_000;
const GAP_CHECK_MS = 5 * 60 * 1000; // every 5 minutes during pre-market
const GAP_ALERT_THRESHOLD = 3; // ≥ 3% gap fires an alert
let gapAlertTimer: NodeJS.Timeout | null = null;
/** Symbols that have already alerted this session — reset at midnight ET. */
const alertedToday = new Map<string, { gapPct: number; alertedAt: number }>();
let alertResetMs = 0;

function isMarketHours(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  // 13:30–21:00 UTC ≈ 09:30–17:00 ET (incl. some extended hours)
  return minutes >= 13 * 60 + 30 && minutes <= 21 * 60;
}

async function refreshSymbols(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastSymbolRefresh < SYMBOL_REFRESH_MS) return;
  try {
    cachedSymbols = await getCurrentWeekSymbols();
    lastSymbolRefresh = now;
  } catch (err) {
    logger.warn("[WEEKLY-TRACKER] symbol refresh failed:", err);
  }
}

async function pollAndBroadcast(): Promise<void> {
  if (!wss || wss.clients.size === 0) return;
  await refreshSymbols();
  if (cachedSymbols.length === 0) return;

  try {
    const reqs = cachedSymbols.map((sym) => ({
      symbol: sym,
      assetType: "stock" as const,
    }));
    const quotes = await getRealtimeBatchQuotes(reqs);
    const ticks: Tick[] = [];
    quotes.forEach((q, sym) => {
      if (Number.isFinite(q.price)) {
        ticks.push({ symbol: sym, price: q.price, chgPct: q.changePercent, ts: Date.now() });
      }
    });
    if (ticks.length === 0) return;

    const payload = JSON.stringify({ type: "tick", symbols: ticks });
    let sent = 0;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
        sent++;
      }
    });
    logger.debug(
      `[WEEKLY-TRACKER] broadcast ${ticks.length} ticks to ${sent} clients`,
    );
  } catch (err) {
    logger.warn("[WEEKLY-TRACKER] poll failed:", err);
  }
}

/**
 * Pre-market gap watcher — checks weekly watchlist symbols every 5min during
 * pre-market and the first 30min after open. Symbols gapping ≥3% fire a
 * `gap_alert` over the WS so the UI can flash a notification. Alerts dedupe
 * per-symbol per-session (until next ET midnight).
 */
function shouldRunGapCheck(): boolean {
  const phase = currentMarketPhase();
  if (phase === "pre_market") return true;
  if (phase === "regular") {
    // First 30 minutes after open — opening gaps still relevant
    const now = new Date();
    const hm = now.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const [h, m] = hm.split(":").map(Number);
    return h * 60 + m < 10 * 60; // before 10:00 ET
  }
  return false;
}

function maybeResetAlertCache(): void {
  const now = new Date();
  const dayKey = now.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const dayMs = new Date(dayKey).getTime();
  if (dayMs !== alertResetMs) {
    alertedToday.clear();
    alertResetMs = dayMs;
  }
}

async function checkGapAlerts(): Promise<void> {
  if (!wss || wss.clients.size === 0) return;
  if (!shouldRunGapCheck()) return;
  maybeResetAlertCache();

  await refreshSymbols();
  if (cachedSymbols.length === 0) return;

  try {
    const snaps = await getPreMarketBatch(cachedSymbols);
    const newAlerts: Array<{ symbol: string; gapPct: number; direction: string; phase: string }> = [];

    snaps.forEach((s, sym) => {
      if (!Number.isFinite(s.gapPct)) return;
      if (Math.abs(s.gapPct) < GAP_ALERT_THRESHOLD) return;

      const prior = alertedToday.get(sym);
      // Re-alert if the gap has *grown* by another 2%+ since last alert
      if (prior && Math.abs(s.gapPct) - Math.abs(prior.gapPct) < 2) return;

      alertedToday.set(sym, { gapPct: s.gapPct, alertedAt: Date.now() });
      newAlerts.push({
        symbol: sym,
        gapPct: Number(s.gapPct.toFixed(2)),
        direction: s.gapDirection,
        phase: s.phase,
      });
    });

    if (newAlerts.length === 0) return;

    const payload = JSON.stringify({
      type: "gap_alert",
      ts: Date.now(),
      alerts: newAlerts,
    });
    let sent = 0;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
        sent++;
      }
    });
    logger.info(
      `[WEEKLY-TRACKER] gap alerts: ${newAlerts.map((a) => `${a.symbol} ${a.gapPct >= 0 ? "+" : ""}${a.gapPct}%`).join(", ")} → ${sent} clients`,
    );
  } catch (err) {
    logger.warn("[WEEKLY-TRACKER] gap-alert check failed:", err);
  }
}

function scheduleNext(): void {
  if (pollTimer) clearTimeout(pollTimer);
  const interval = isMarketHours() ? MARKET_HOURS_MS : OFF_HOURS_MS;
  pollTimer = setTimeout(async () => {
    await pollAndBroadcast();
    scheduleNext();
  }, interval);
}

/**
 * Initialize the weekly-watchlist live tracker WebSocket on
 * `/ws/weekly-watchlist` and start the polling loop. Idempotent.
 */
export function initializeWeeklyTracker(httpServer: Server): void {
  if (wss) {
    logger.info("[WEEKLY-TRACKER] already initialized");
    return;
  }

  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
    if (pathname === "/ws/weekly-watchlist") {
      wss!.handleUpgrade(request, socket, head, (ws) => {
        wss!.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", async (ws) => {
    logger.info(
      `[WEEKLY-TRACKER] client connected (total: ${wss?.clients.size})`,
    );

    // Send a snapshot immediately so the UI doesn't have to wait for
    // the next poll cycle.
    try {
      await refreshSymbols(true);
      if (cachedSymbols.length > 0) {
        const reqs = cachedSymbols.map((sym) => ({
          symbol: sym,
          assetType: "stock" as const,
        }));
        const quotes = await getRealtimeBatchQuotes(reqs);
        const ticks: Tick[] = [];
        quotes.forEach((q, sym) => {
          if (Number.isFinite(q.price)) {
            ticks.push({ symbol: sym, price: q.price, chgPct: q.changePercent, ts: Date.now() });
          }
        });
        if (ticks.length > 0) {
          ws.send(JSON.stringify({ type: "snapshot", symbols: ticks }));
        }
      }
    } catch (err) {
      logger.warn("[WEEKLY-TRACKER] initial snapshot failed:", err);
    }

    ws.on("close", () => {
      logger.info(
        `[WEEKLY-TRACKER] client disconnected (total: ${wss?.clients.size})`,
      );
    });
    ws.on("error", (err) => {
      logger.warn("[WEEKLY-TRACKER] client error:", err);
    });
  });

  // Symbol-list refresh loop (independent of poll cadence)
  symbolRefreshTimer = setInterval(() => {
    refreshSymbols().catch(() => {});
  }, SYMBOL_REFRESH_MS);

  // Pre-market gap-alert loop — runs every 5min, only fires during pre-market
  // and the first 30min of regular hours.
  gapAlertTimer = setInterval(() => {
    checkGapAlerts().catch(() => {});
  }, GAP_CHECK_MS);
  // Kick off an immediate check so the first connect during pre-market hours
  // doesn't have to wait 5 minutes.
  checkGapAlerts().catch(() => {});

  scheduleNext();

  logger.info("[WEEKLY-TRACKER] initialized on /ws/weekly-watchlist");
}

export function shutdownWeeklyTracker(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (symbolRefreshTimer) {
    clearInterval(symbolRefreshTimer);
    symbolRefreshTimer = null;
  }
  if (gapAlertTimer) {
    clearInterval(gapAlertTimer);
    gapAlertTimer = null;
  }
  if (wss) {
    wss.close();
    wss = null;
  }
  logger.info("[WEEKLY-TRACKER] shut down");
}
