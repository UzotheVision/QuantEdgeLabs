/**
 * CacheFreshnessIndicator — shows how stale GEX data is
 * Replaces "live" labels that lie when data is from cache.
 */

interface Props {
  asOf: string | number | Date;       // when data was computed
  cached?: boolean;                    // is this from cache?
  staleAfterMs?: number;               // when to flag as stale (default 5min)
  showLabel?: boolean;
}

export function CacheFreshnessIndicator({
  asOf,
  cached = false,
  staleAfterMs = 5 * 60 * 1000,
  showLabel = true
}: Props) {
  const ts = typeof asOf === 'string' ? new Date(asOf).getTime() :
             asOf instanceof Date ? asOf.getTime() :
             asOf;
  const ageMs = Date.now() - ts;
  const ageSec = Math.floor(ageMs / 1000);
  const ageMin = Math.floor(ageSec / 60);

  const isStale = ageMs > staleAfterMs;
  const isVeryStale = ageMs > staleAfterMs * 6; // 30 min default
  const isLive = !cached && ageMs < 60 * 1000;

  let dotColor = 'bg-emerald-500';
  let textColor = 'text-[var(--trade-bullish)]';
  let label = 'LIVE';

  if (isVeryStale) {
    dotColor = 'bg-red-500';
    textColor = 'text-[var(--trade-bearish)]';
    label = 'STALE';
  } else if (isStale || cached) {
    dotColor = 'bg-amber-500';
    textColor = 'text-amber-400';
    label = cached ? 'CACHED' : 'DELAYED';
  }

  const ageLabel =
    ageSec < 5 ? 'just now' :
    ageSec < 60 ? `${ageSec}s ago` :
    ageMin < 60 ? `${ageMin}m ago` :
    `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`;

  return (
    <div className="inline-flex items-center gap-1.5 text-xs">
      <div className={`w-1.5 h-1.5 rounded-full ${dotColor} ${isLive ? 'animate-pulse' : ''}`} />
      {showLabel && <span className={`font-mono font-bold ${textColor}`}>{label}</span>}
      <span className="text-zinc-500">{ageLabel}</span>
    </div>
  );
}
