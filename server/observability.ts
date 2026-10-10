/**
 * OBSERVABILITY — error reporting + outage alerting.
 *
 * Tries hard to deliver errors somewhere a human will see:
 *   1. If SENTRY_DSN is set AND @sentry/node is installed → Sentry
 *   2. Else if ERROR_WEBHOOK_URL is set → POST to Discord/Slack webhook
 *   3. Always: structured console.error (machine-parseable JSON)
 *
 * Public API mirrors Sentry's so swap-in is trivial:
 *   captureException(err, { context })
 *   captureMessage('outage', 'error')
 *   initObservability()  // call once at boot
 *
 * Wires:
 *   - process.on('uncaughtException', captureException)
 *   - process.on('unhandledRejection', captureException)
 *
 * Env:
 *   SENTRY_DSN              optional — full Sentry path
 *   ERROR_WEBHOOK_URL       optional — Discord/Slack incoming-webhook URL
 *   ERROR_WEBHOOK_RATE_MS   throttle (default 60_000 = 1 alert per error/min)
 */
import { logger } from './logger';

type Severity = 'fatal' | 'error' | 'warning' | 'info';

let sentry: any = null;
let initialized = false;
let webhookUrl: string | null = null;
const lastSentByKey = new Map<string, number>();
const RATE_MS = Number(process.env.ERROR_WEBHOOK_RATE_MS || 60_000);

// ─── Init ──────────────────────────────────────────────────────────

export async function initObservability(): Promise<void> {
  if (initialized) return;
  initialized = true;

  webhookUrl = process.env.ERROR_WEBHOOK_URL || null;

  // Try Sentry — wrapped because the package may not be installed
  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sentryModule = await import('@sentry/node' as any).catch(() => null);
      if (sentryModule?.init) {
        sentryModule.init({
          dsn,
          environment: process.env.NODE_ENV || 'development',
          release: process.env.GIT_SHA,
          tracesSampleRate: 0.1,
        });
        sentry = sentryModule;
        logger.info('[OBSERVABILITY] Sentry initialized');
      } else {
        logger.warn('[OBSERVABILITY] SENTRY_DSN set but @sentry/node not installed — install with: npm i @sentry/node');
      }
    } catch (e: any) {
      logger.warn(`[OBSERVABILITY] Sentry init failed: ${e?.message}`);
    }
  }

  if (webhookUrl) {
    logger.info('[OBSERVABILITY] Webhook alerts enabled');
  }

  // Last-resort error catchers — never let the process die silently
  process.on('uncaughtException', (err) => {
    captureException(err, { context: 'uncaughtException' });
  });
  process.on('unhandledRejection', (reason) => {
    captureException(reason instanceof Error ? reason : new Error(String(reason)), {
      context: 'unhandledRejection',
    });
  });
}

// ─── Public API (Sentry-compatible shape) ──────────────────────────

export function captureException(
  err: unknown,
  opts: { context?: string; tags?: Record<string, string>; extra?: Record<string, any> } = {},
): void {
  const error = err instanceof Error ? err : new Error(String(err));
  const payload = {
    level: 'error' as Severity,
    message: error.message,
    stack: error.stack,
    context: opts.context,
    tags: opts.tags,
    extra: opts.extra,
    timestamp: new Date().toISOString(),
  };

  // Always log structured
  console.error(JSON.stringify({ ...payload, channel: 'observability' }));

  // Sentry
  try { sentry?.captureException(error, { tags: opts.tags, extra: opts.extra }); }
  catch { /* ignore */ }

  // Webhook (rate-limited per error message)
  void postWebhook(payload);
}

export function captureMessage(
  message: string,
  level: Severity = 'info',
  opts: { tags?: Record<string, string>; extra?: Record<string, any> } = {},
): void {
  const payload = {
    level,
    message,
    tags: opts.tags,
    extra: opts.extra,
    timestamp: new Date().toISOString(),
  };

  if (level === 'error' || level === 'fatal') {
    console.error(JSON.stringify({ ...payload, channel: 'observability' }));
  } else {
    console.log(JSON.stringify({ ...payload, channel: 'observability' }));
  }

  try { sentry?.captureMessage(message, level); }
  catch { /* ignore */ }

  if (level === 'error' || level === 'fatal') {
    void postWebhook(payload);
  }
}

// ─── Webhook fan-out (Discord/Slack incoming-webhook compatible) ───

async function postWebhook(payload: any): Promise<void> {
  if (!webhookUrl) return;

  // Rate-limit: same message text within RATE_MS = drop
  const key = `${payload.level}::${payload.message?.slice(0, 100) || ''}`;
  const lastSent = lastSentByKey.get(key) || 0;
  if (Date.now() - lastSent < RATE_MS) return;
  lastSentByKey.set(key, Date.now());

  const isDiscord = webhookUrl.includes('discord');
  const isSlack = webhookUrl.includes('slack');

  const colorMap = { fatal: 0xff0000, error: 0xe11d48, warning: 0xf59e0b, info: 0x06b6d4 };
  const emoji = { fatal: '💀', error: '🚨', warning: '⚠️', info: 'ℹ️' }[payload.level as Severity] || '🔔';

  let body: any;
  if (isDiscord) {
    body = {
      embeds: [{
        title: `${emoji} ${payload.level.toUpperCase()} — QuantEdge`,
        description: payload.message,
        color: colorMap[payload.level as Severity] || 0x06b6d4,
        fields: [
          payload.context && { name: 'Context', value: String(payload.context).slice(0, 200), inline: true },
          payload.stack && { name: 'Stack', value: '```\n' + String(payload.stack).slice(0, 1000) + '\n```', inline: false },
        ].filter(Boolean),
        timestamp: payload.timestamp,
      }],
    };
  } else if (isSlack) {
    body = {
      text: `${emoji} *${payload.level.toUpperCase()}* — ${payload.message}\n${payload.stack ? '```' + String(payload.stack).slice(0, 1000) + '```' : ''}`,
    };
  } else {
    body = payload;
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // intentionally silent — observability must never throw
  }
}

// ─── Express middleware to wrap routes ─────────────────────────────

export function observabilityErrorMiddleware(
  err: any,
  req: any,
  _res: any,
  next: any,
): void {
  captureException(err, {
    context: `${req.method} ${req.originalUrl}`,
    tags: { method: req.method, path: req.route?.path || req.path },
    extra: { query: req.query, ip: req.ip },
  });
  next(err);
}
