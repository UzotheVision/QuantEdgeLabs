/**
 * /alerts — dedicated alerts page.
 *
 * The full alerts management UI, reusing the terminal's alert engine verbatim:
 * the same `useSignalAlerts` hook, the same localStorage-backed prefs/feed, and
 * the same shared presentational pieces (AlertTypeToggles, AlertDeliveryRows,
 * AlertFeedItem) the terminal drawer renders. The convictions feed uses the
 * identical query key, so the page and the terminal share one cached fetch.
 *
 * Alerts are signal state changes detected locally against the live conviction
 * feed — they fire while you're in the platform, not while you're away.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Volume2, VolumeX, Trash2, Loader2, AlertTriangle, RotateCw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ConvictionsResponse } from '@/lib/convictions';
import {
  useSignalAlerts,
  AlertTypeToggles,
  AlertDeliveryRows,
  AlertFeedItem,
} from '@/components/terminal/terminal-alerts';
import { ALERT_LABELS, clearFeed, type AlertType } from '@/lib/alerts/alert-engine';

const FEED_CAP = 30;
const DAY_MS = 24 * 3600_000;

/** Plain-English descriptions of each alert type, matching lib/alerts/alert-engine. */
const ALERT_DESCRIPTIONS: Record<AlertType, string> = {
  new_signal: 'A fresh idea appeared on the board within the last 2 hours',
  trigger_confirmed: 'Price entered the entry zone — the idea is now in play',
  target_hit: 'Price reached the first target (T1)',
  danger_zone: 'Price is approaching the stop',
  invalidated: 'The stop was taken out — the setup no longer holds',
  rating_jump: "An idea's conviction score moved 5+ points",
  high_conviction: 'An idea scored 90 or above',
};

const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`;

export default function AlertsPage() {
  // Identical query key to the terminal shell — one cached fetch, shared.
  const { data: convictions, isLoading, isError, refetch } = useQuery<ConvictionsResponse>({
    queryKey: ['/api/convictions', 'alerts'],
    queryFn: async () => {
      const r = await fetch('/api/convictions', { credentials: 'include' });
      if (!r.ok) throw new Error('convictions failed');
      return r.json();
    },
    staleTime: 60_000, refetchInterval: 90_000, retry: 1,
  });
  const { prefs, update, feed, setFeed, unread, setUnread } = useSignalAlerts(convictions?.picks);
  const [showAll, setShowAll] = useState(false);

  // Opening the page marks alerts as seen, same as opening the terminal drawer.
  useEffect(() => { setUnread(0); }, [setUnread]);

  // Hero metric: alerts fired in the last 24h — the outcome that answers
  // "is my alert setup catching things?" Types armed is a setup stat and
  // unread is ephemeral; neither is the headline.
  const fired24h = feed.filter((a) => Date.now() - a.at < DAY_MS).length;
  const armedCount = (Object.keys(ALERT_LABELS) as AlertType[]).filter((t) => prefs.enabled[t]).length;
  const visible = showAll ? feed : feed.slice(0, FEED_CAP);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-slate-900/20">
      <div className="container max-w-[1600px] mx-auto py-4 px-3 sm:px-4 space-y-3">
        {/* Header + hero */}
        <div className="rounded-xl bg-card/60 backdrop-blur-md border border-border/50 p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--brand-cyan,#3b8cff)]/10 border border-[var(--brand-cyan,#3b8cff)]/20">
                  <Bell className="w-4 h-4 text-[var(--brand-cyan,#3b8cff)]" />
                </div>
                <h1 className="text-base font-semibold text-foreground" data-testid="text-page-title">
                  Alerts
                </h1>
              </div>
              <p className="text-muted-foreground text-[10px]">
                In-app alerts when a signal changes state — a trigger fills, T1 is hit, a stop
                comes into range. They fire while you&apos;re in the platform.
              </p>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-right" title="Signal state changes caught in the last 24 hours">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Alerts · 24h</span>
                <div className="text-xl font-bold font-mono text-foreground">
                  {isLoading ? <Loader2 className="ml-auto w-5 h-5 animate-spin text-muted-foreground" /> : fired24h}
                </div>
              </div>
              <div className="text-right" title="Alert types currently armed, out of 7">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Types armed</span>
                <div className="text-lg font-bold font-mono text-foreground">{armedCount} / 7</div>
              </div>
              <div className="text-right" title="Alerts you haven't opened yet">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Unread</span>
                <div className="text-lg font-bold font-mono text-foreground">{unread}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Live-detection error — honest state, not fake emptiness */}
        {isError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 sm:p-4 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
            <div className="flex-1">
              <div className="text-sm font-medium text-foreground">Live detection is paused</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Couldn&apos;t reach the signal feed, so new state changes won&apos;t fire until it
                reconnects. Your saved alerts and preferences below are unaffected.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="shrink-0">
              <RotateCw className="w-3.5 h-3.5 mr-1.5" /> Retry
            </Button>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Preferences */}
          <Card className="bg-card/60 backdrop-blur-md border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Alert preferences</CardTitle>
              <CardDescription className="text-[10px]">
                Which state changes fire, and where they reach you. Saved on this device.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              <AlertTypeToggles prefs={prefs} update={update} />
              <AlertDeliveryRows prefs={prefs} update={update} />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-label font-mono uppercase tracking-wider text-muted-foreground"
                      title="Play a short sound when an alert fires">
                  Alert sounds
                </span>
                <button
                  onClick={() => update({ ...prefs, sound: !prefs.sound })}
                  role="switch" aria-checked={prefs.sound} aria-label="Toggle alert sounds"
                  className={cn('relative h-5 w-9 cursor-pointer rounded-full transition-colors',
                    prefs.sound ? 'bg-[var(--brand-cyan,#3b8cff)]' : 'bg-foreground/15')}
                >
                  <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-background transition-all',
                    prefs.sound ? 'left-[18px]' : 'left-0.5')} />
                </button>
              </div>
              {armedCount === 0 && (
                <p className="pt-2 text-xs text-amber-400/90">
                  All alert types are off — arm at least one above to start receiving alerts.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Legend — what each alert type means */}
          <Card className="bg-card/60 backdrop-blur-md border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">What fires an alert</CardTitle>
              <CardDescription className="text-[10px]">
                Nothing fires just for existing — only state changes against the live board.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2">
                {(Object.keys(ALERT_LABELS) as AlertType[]).map((t) => (
                  <div key={t} className="flex items-baseline gap-2">
                    <dt className={cn(
                      'shrink-0 rounded px-2 py-0.5 text-label font-mono uppercase tracking-wider',
                      prefs.enabled[t]
                        ? 'bg-[var(--brand-cyan,#3b8cff)]/15 text-[var(--brand-cyan,#3b8cff)]'
                        : 'bg-foreground/5 text-muted-foreground'
                    )}>
                      {ALERT_LABELS[t]}
                    </dt>
                    <dd className="text-xs text-muted-foreground">{ALERT_DESCRIPTIONS[t]}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>

        {/* Feed */}
        <Card className="bg-card/60 backdrop-blur-md border-border/50">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm">Alert feed</CardTitle>
              <CardDescription className="text-[10px]">
                {isLoading ? 'Connecting to the live signal feed…' : 'Newest first · kept on this device'}
              </CardDescription>
            </div>
            {feed.length > 0 && (
              <Button
                variant="ghost" size="sm"
                onClick={() => { clearFeed(); setFeed([]); }}
                className="text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Clear
              </Button>
            )}
          </CardHeader>
          <CardContent className="px-0">
            {feed.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Bell className="mx-auto w-6 h-6 text-muted-foreground" />
                <div className="mt-3 text-meta font-mono uppercase tracking-widest text-foreground/80">No alerts yet</div>
                <p className="mx-auto mt-2 max-w-xs text-meta leading-relaxed text-muted-foreground">
                  Alerts fire when a signal actually changes state — a trigger fills, T1 is hit, a
                  stop comes into range. Keep the platform open and they&apos;ll land here.
                </p>
              </div>
            ) : (
              <>
                <div>
                  {visible.map((a) => <AlertFeedItem key={a.id} a={a} />)}
                </div>
                {feed.length > FEED_CAP && (
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className="w-full cursor-pointer py-2 text-label font-mono uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showAll ? 'Show less' : `Show all ${feed.length}`}
                  </button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
