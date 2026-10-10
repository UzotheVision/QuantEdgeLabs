/**
 * Client-side observability — captures errors so we hear about them.
 *
 *   1. If VITE_SENTRY_DSN is set AND @sentry/react is installed → Sentry
 *   2. Always: console.error with structured payload
 *   3. Always: POST to /api/client-error so the server forwards to Sentry/webhook
 *
 * Same shape as Sentry — drop-in replacement when ready.
 */

let sentry: any = null;
let initialized = false;

export async function initClientObservability(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Capture global handlers — never lose an error
  window.addEventListener('error', (e) => {
    captureException(e.error || new Error(e.message), { context: 'window.error', extra: { filename: e.filename, lineno: e.lineno } });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
    captureException(reason, { context: 'unhandledrejection' });
  });

  // Try Sentry — wrapped because the package may not be installed.
  // The variable + /* @vite-ignore */ defeats Rollup's static-analysis;
  // without it the build fails when @sentry/react isn't in node_modules.
  const dsn = (import.meta as any).env?.VITE_SENTRY_DSN;
  if (dsn) {
    try {
      const sentryPkg = '@sentry/react';
      const sentryModule: any = await import(/* @vite-ignore */ sentryPkg).catch(() => null);
      if (sentryModule?.init) {
        sentryModule.init({
          dsn,
          environment: (import.meta as any).env?.MODE || 'development',
          release: (import.meta as any).env?.VITE_GIT_SHA,
          tracesSampleRate: 0.1,
        });
        sentry = sentryModule;
        console.info('[OBSERVABILITY] Sentry initialized');
      }
    } catch { /* silent */ }
  }
}

export function captureException(
  err: unknown,
  opts: { context?: string; tags?: Record<string, string>; extra?: Record<string, any> } = {},
): void {
  const error = err instanceof Error ? err : new Error(String(err));
  const payload = {
    level: 'error',
    message: error.message,
    stack: error.stack,
    context: opts.context,
    tags: opts.tags,
    extra: opts.extra,
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  };

  console.error('[client-error]', payload);

  try { sentry?.captureException(error, { tags: opts.tags, extra: opts.extra }); }
  catch { /* ignore */ }

  // Forward to server so it can hit the webhook even if Sentry isn't configured
  try {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* observability never throws */ });
  } catch { /* ignore */ }
}

export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' = 'info',
): void {
  const payload = { level, message, url: window.location.href, timestamp: new Date().toISOString() };
  if (level === 'error' || level === 'fatal') console.error('[client-message]', payload);
  else console.log('[client-message]', payload);
  try { sentry?.captureMessage(message, level); } catch { /* ignore */ }
}
