/**
 * TERMINAL ALERTS — the bell, the feed, and what fires it.
 *
 * In-app alerts on signal state changes: trigger confirmed, target hit, danger zone,
 * invalidation, rating moves, high conviction. Each is a TRANSITION detected by
 * lib/alerts/alert-engine against the geometry the platform already computes, so nothing
 * new is inferred — we just stopped throwing the changes away.
 *
 * Sound reuses the existing Web Audio beeps rather than shipping an audio library.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Bell, X, Trash2, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';
import { EASE, DUR } from '@/lib/motion';
import { TC } from '@/lib/design-tokens';
import { AlertSounds } from '@/components/sound-alert-toggle';
import type { ConvictionPick } from '@/lib/convictions';
import {
  detectAlerts, loadAlertPrefs, saveAlertPrefs, loadFeed, clearFeed,
  ALERT_LABELS, type AlertEvent, type AlertPrefs, type AlertType,
} from '@/lib/alerts/alert-engine';

/** Watches the live picks and fires alerts on state changes. */
export function useSignalAlerts(picks: ConvictionPick[] | undefined) {
  const [prefs, setPrefs] = useState<AlertPrefs>(() => loadAlertPrefs());
  const [feed, setFeed] = useState<AlertEvent[]>(() => loadFeed());
  const [unread, setUnread] = useState(0);
  const firstRun = useRef(true);

  useEffect(() => {
    if (!picks?.length) return;
    const fired = detectAlerts(picks, prefs);
    if (fired.length === 0) return;

    setFeed(loadFeed());
    setUnread((n) => n + fired.length);

    // Push the same events to Discord when enabled — the bell only works while you're
    // looking at the terminal, which is exactly when you least need telling.
    if (prefs.discord) {
      apiRequest('POST', '/api/alerts/relay', { events: fired }).catch(() => { /* non-fatal */ });
    }

    if (prefs.sound) {
      // one sound per batch, chosen by the most urgent event in it
      const worst = fired.some((f) => f.tone === 'bad') ? 'bad'
                  : fired.some((f) => f.type === 'target_hit') ? 'target' : 'info';
      try {
        if (worst === 'bad') AlertSounds.stopWarning();
        else if (worst === 'target') AlertSounds.t1Hit();
        else AlertSounds.newSetup();
      } catch { /* audio blocked until user interacts — non-fatal */ }
    }
    firstRun.current = false;
  }, [picks, prefs]);

  const update = (p: AlertPrefs) => { setPrefs(p); saveAlertPrefs(p); };
  return { prefs, update, feed, setFeed, unread, setUnread };
}

/** Shared presentational pieces — used by the terminal drawer and the /alerts page. */

export const alertToneColor = (t: AlertEvent['tone']) =>
  (t === 'good' ? TC.bull : t === 'bad' ? TC.bear : TC.info);

export const alertAgo = (ms: number) => {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
};

/** "Alert me on" chips — which state changes fire an alert. */
export function AlertTypeToggles({ prefs, update }: { prefs: AlertPrefs; update: (p: AlertPrefs) => void }) {
  return (
    <div>
      <div className="mb-2 text-label font-mono uppercase tracking-widest text-muted-foreground">Alert me on</div>
      <div className="flex flex-wrap gap-1">
        {(Object.keys(ALERT_LABELS) as AlertType[]).map((t) => {
          const on = prefs.enabled[t];
          return (
            <button key={t}
              onClick={() => update({ ...prefs, enabled: { ...prefs.enabled, [t]: !on } })}
              className={cn('cursor-pointer rounded px-2 py-1 text-label font-mono uppercase tracking-wider transition-colors',
                on ? 'bg-[var(--brand-cyan,#3b8cff)]/15 text-[var(--brand-cyan,#3b8cff)]' : 'bg-foreground/5 text-muted-foreground hover:text-foreground')}
            >
              {ALERT_LABELS[t]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Delivery rows — Discord relay and quiet hours. */
export function AlertDeliveryRows({ prefs, update }: { prefs: AlertPrefs; update: (p: AlertPrefs) => void }) {
  return (
    <>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-label font-mono uppercase tracking-wider text-muted-foreground">Send to Discord</span>
        <button
          onClick={() => update({ ...prefs, discord: !prefs.discord })}
          role="switch" aria-checked={prefs.discord} aria-label="Send alerts to Discord"
          className={cn('relative h-5 w-9 cursor-pointer rounded-full transition-colors',
            prefs.discord ? 'bg-[var(--brand-cyan,#3b8cff)]' : 'bg-foreground/15')}
        >
          <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-background transition-all',
            prefs.discord ? 'left-[18px]' : 'left-0.5')} />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-label font-mono uppercase tracking-wider text-muted-foreground">Quiet hours</span>
        <span className="flex items-center gap-2">
          {prefs.quietHours.on && (
            <span className="text-label font-mono tabular-nums text-muted-foreground">
              {String(prefs.quietHours.start).padStart(2, '0')}:00–{String(prefs.quietHours.end).padStart(2, '0')}:00
            </span>
          )}
          <button
            onClick={() => update({ ...prefs, quietHours: { ...prefs.quietHours, on: !prefs.quietHours.on } })}
            role="switch" aria-checked={prefs.quietHours.on} aria-label="Toggle quiet hours"
            className={cn('relative h-5 w-9 cursor-pointer rounded-full transition-colors',
              prefs.quietHours.on ? 'bg-[var(--brand-cyan,#3b8cff)]' : 'bg-foreground/15')}
          >
            <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-background transition-all',
              prefs.quietHours.on ? 'left-[18px]' : 'left-0.5')} />
          </button>
        </span>
      </div>
    </>
  );
}

/** One row of the alert feed. */
export function AlertFeedItem({ a }: { a: AlertEvent }) {
  return (
    <div className="border-b border-border/25 px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: alertToneColor(a.tone) }} />
        <span className="text-meta font-mono font-bold text-foreground">{a.title}</span>
        <span className="ml-auto shrink-0 text-label font-mono text-muted-foreground">{alertAgo(a.at)}</span>
      </div>
      <div className="mt-0.5 pl-3.5 text-label font-mono text-muted-foreground">
        {ALERT_LABELS[a.type]} · {a.detail}
      </div>
    </div>
  );
}

export function TerminalAlerts({
  open, onClose, feed, setFeed, prefs, update,
}: {
  open: boolean;
  onClose: () => void;
  feed: AlertEvent[];
  setFeed: (f: AlertEvent[]) => void;
  prefs: AlertPrefs;
  update: (p: AlertPrefs) => void;
}) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const ago = alertAgo;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: DUR.fast }} onClick={onClose} />
          <motion.aside
            className="fixed right-0 top-0 bottom-0 z-50 flex w-full max-w-md flex-col border-l border-border/60 bg-card"
            initial={reduce ? false : { x: '100%' }} animate={{ x: 0 }} exit={reduce ? undefined : { x: '100%' }}
            transition={{ duration: DUR.base, ease: EASE }}
            role="dialog" aria-label="Alerts"
          >
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <div>
                <div className="text-meta font-mono font-bold uppercase tracking-widest text-foreground">Alerts</div>
                <div className="text-label font-mono text-muted-foreground">fires while you're in the platform</div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => update({ ...prefs, sound: !prefs.sound })}
                  aria-label={prefs.sound ? 'Mute alert sounds' : 'Unmute alert sounds'}
                  title={prefs.sound ? 'Sound on' : 'Sound off'}
                  className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {prefs.sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
                <button onClick={onClose} aria-label="Close alerts"
                  className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* which alerts fire */}
            <div className="border-b border-border/40 px-4 py-3">
              <AlertTypeToggles prefs={prefs} update={update} />
              <AlertDeliveryRows prefs={prefs} update={update} />
            </div>

            {/* the feed */}
            <div className="flex-1 overflow-y-auto">
              {feed.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <div className="text-meta font-mono uppercase tracking-widest text-foreground/80">No alerts yet</div>
                  <p className="mx-auto mt-2 max-w-xs text-meta leading-relaxed text-muted-foreground">
                    Alerts fire when a signal actually changes state — a trigger fills, T1 is hit, a
                    stop comes into range. Nothing fires just for existing.
                  </p>
                </div>
              ) : (
                feed.map((a) => <AlertFeedItem key={a.id} a={a} />)
              )}
            </div>

            {feed.length > 0 && (
              <button
                onClick={() => { clearFeed(); setFeed([]); }}
                className="flex cursor-pointer items-center justify-center gap-1.5 border-t border-border/40 py-2 text-label font-mono uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                <Trash2 className="h-3 w-3" /> Clear
              </button>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** The bell in the terminal chrome. */
export function AlertBell({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={unread > 0 ? `Alerts (${unread} new)` : 'Alerts'}
      className="relative inline-flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground"
    >
      <Bell className="h-3.5 w-3.5" />
      {unread > 0 && (
        <span className="absolute -right-1.5 -top-1.5 grid h-3.5 min-w-[14px] place-items-center rounded-full px-1 text-label font-mono font-bold text-background"
              style={{ background: TC.info }}>
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}
