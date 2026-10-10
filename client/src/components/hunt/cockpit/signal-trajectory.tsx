import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

type Snapshot = {
  id: string;
  eventType: string;
  eventTimestamp: string;
  currentPrice: number;
  pnlAtSnapshot: number | null;
  rawQuoteData?: { convictionScore?: number; convictionBand?: string } | null;
};

const EVENT_LABEL: Record<string, string> = {
  idea_published: 'Published',
  entry_window_open: 'Entry opened',
  entry_window_closed: 'Entry closed',
  validation_check: 'Scanner check',
  target_hit: 'T1 hit',
  stop_hit: 'Stop hit',
  expired: 'Expired',
  manual_close: 'Closed',
};

function ago(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * Compact, audit-backed history. It shows a line only after two stored points;
 * one point is evidence, not a trend. The separate live price bead belongs in
 * TradeVector, where it can move without pretending it was historically stored.
 */
export function SignalTrajectory({ ideaId, live, className }: { ideaId: string; live: number; className?: string }) {
  const reduce = useReducedMotion();
  const { data, isLoading } = useQuery<{ snapshots: Snapshot[] }>({
    queryKey: ['/api/convictions', ideaId, 'trajectory'],
    queryFn: async () => {
      const r = await fetch(`/api/convictions/${encodeURIComponent(ideaId)}/trajectory`, { credentials: 'include' });
      if (!r.ok) throw new Error('trajectory unavailable');
      return r.json();
    },
    enabled: !!ideaId,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 0,
  });

  const points = (data?.snapshots ?? []).filter((s) => Number.isFinite(s.currentPrice) && s.currentPrice > 0).slice(-24);
  const plot = useMemo(() => {
    if (points.length < 2) return null;
    const prices = points.map((p) => p.currentPrice);
    const lo = Math.min(...prices, live || Infinity);
    const hi = Math.max(...prices, live || -Infinity);
    const span = Math.max(hi - lo, Math.max(Math.abs(hi), 1) * 0.008);
    return points.map((point, index) => ({
      ...point,
      x: (index / Math.max(points.length - 1, 1)) * 100,
      y: 100 - ((point.currentPrice - lo) / span) * 100,
    }));
  }, [points, live]);

  const latest = points[points.length - 1];
  const line = plot?.map((p) => `${p.x},${p.y}`).join(' ');
  const tone = (latest?.pnlAtSnapshot ?? 0) >= 0 ? 'var(--trade-bullish)' : 'var(--trade-bearish)';

  return (
    <div className={cn('border-t border-border/35 pt-2.5', className)}>
      <div className="mb-1.5 flex items-center justify-between gap-3 font-mono text-[9px] uppercase tracking-[0.13em]">
        <span className="font-bold text-muted-foreground">Recorded path</span>
        <span className="text-muted-foreground">
          {isLoading ? 'loading audit…' : latest ? `${points.length} checks · ${EVENT_LABEL[latest.eventType] ?? latest.eventType} ${ago(latest.eventTimestamp)}` : 'waiting for first check'}
        </span>
      </div>
      {plot && line ? (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-10 w-full overflow-visible" aria-label="Recorded price trajectory">
          <defs>
            <linearGradient id={`trajectory-${ideaId}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor={tone} stopOpacity="0.22" />
              <stop offset="1" stopColor={tone} stopOpacity="1" />
            </linearGradient>
          </defs>
          <polyline points={line} fill="none" stroke={`url(#trajectory-${ideaId})`} strokeWidth="3" vectorEffect="non-scaling-stroke" />
          {plot.map((p, i) => (
            <circle key={p.id} cx={p.x} cy={p.y} r={i === plot.length - 1 ? 2.7 : 1.2} fill={i === plot.length - 1 ? tone : 'var(--muted-foreground)'} />
          ))}
        </svg>
      ) : (
        <div className="flex h-10 items-center gap-2 border border-dashed border-border/45 px-2.5 font-mono text-[9px] leading-relaxed text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-cyan)]" />
          No price trend yet — the next scanner checkpoint starts this audit trail.
        </div>
      )}
      {latest && (
        <div className="mt-1 flex items-center justify-between font-mono text-[9px] tabular-nums text-muted-foreground">
          <span>${latest.currentPrice.toFixed(2)} recorded</span>
          <motion.span
            key={latest.pnlAtSnapshot}
            initial={reduce ? false : { opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ color: tone }}
          >
            {latest.pnlAtSnapshot == null ? 'P&L unavailable' : `${latest.pnlAtSnapshot >= 0 ? '+' : ''}${latest.pnlAtSnapshot.toFixed(2)}% at check`}
          </motion.span>
        </div>
      )}
    </div>
  );
}
