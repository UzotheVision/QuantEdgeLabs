/**
 * ORACLE MARKET PULSE
 *
 * The first Oracle decision is where participation is moving. This panel owns
 * that read; the RRG beside it owns the spatial explanation. Neither repeats
 * the other's information.
 */
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { CanonFreshness } from '@/components/canon';
import { PanelFrame } from '@/components/oracle/panel-frame';
import { TC } from '@/lib/design-tokens';
import { MarketStream, useRealtimeStatus } from '@/components/oracle/market-stream';

interface Sector {
  etf: string;
  name: string;
  change: number;
  relChange: number;
}

interface RotationFeed {
  sessionLabel: string;
  isStale: boolean;
  /** The server has always sent this; the interface just never declared it, so
      the panel could only render a stale/live boolean instead of a real age. */
  asOf?: string | null;
  spyChange: number;
  leaders: Sector[];
  laggards: Sector[];
}

interface AssetClass { key: string; label: string; changePct: number }
interface ExtendedFeed {
  assetClasses?: AssetClass[];
  interpretation?: string;
  session?: 'pre' | 'regular' | 'post' | 'closed';
  isStale?: boolean;
  asOf?: string | null;
  gainers?: Array<{ symbol: string; changePct: number; asOf: string; isCurrent: boolean }>;
  losers?: Array<{ symbol: string; changePct: number; asOf: string; isCurrent: boolean }>;
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/**
 * Same wording the server puts in `interpretation`, so the strip's heading cannot
 * disagree with the sentence printed directly beneath it. The heading used to be
 * hardcoded "Pre-market leaders", which read as pre-market data at 11:45 ET while
 * the line under it correctly said "Regular session".
 */
function sessionLeadersLabel(session: ExtendedFeed['session']) {
  switch (session) {
    case 'pre': return 'Pre-market leaders';
    case 'post': return 'After-hours leaders';
    case 'regular': return 'Session leaders';
    default: return 'Latest leaders';
  }
}

function marketRead(spyChange: number, assets: AssetClass[]) {
  const advancing = assets.filter((asset) => asset.changePct > 0).length;
  const declining = assets.filter((asset) => asset.changePct < 0).length;
  if (spyChange >= 0.25 && advancing >= declining) {
    return { label: 'Risk-on', detail: 'buyers in control', tone: TC.bull };
  }
  if (spyChange <= -0.25 && declining >= advancing) {
    return { label: 'Risk-off', detail: 'defense in control', tone: TC.bear };
  }
  return { label: 'Balanced', detail: 'no broad edge', tone: TC.warn };
}

/** A provider's session label is not enough: only show an extended tape when the US cash clock is open. */
function cashTapeOpenNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  if (get('weekday') === 'Sat' || get('weekday') === 'Sun') return false;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return minutes >= 4 * 60 && minutes < 20 * 60;
}

function AssetRow({ asset }: { asset: AssetClass }) {
  const tone = asset.changePct > 0 ? TC.bull : asset.changePct < 0 ? TC.bear : 'var(--muted-foreground)';
  const state = asset.changePct > 0.08 ? 'BULLISH' : asset.changePct < -0.08 ? 'BEARISH' : 'NEUTRAL';
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-2 border-b border-border/25 py-1.5 font-mono text-[10px] tabular-nums last:border-b-0">
      <span className="truncate uppercase tracking-[0.1em] text-muted-foreground">{asset.label}</span>
      <span className="font-semibold" style={{ color: tone }}>{signed(asset.changePct)}</span>
      <span className="text-[9px] font-bold tracking-[0.1em]" style={{ color: tone }}>{state}</span>
    </div>
  );
}

export function OracleMarketField({
  className,
  collapsedHeight,
  expanded = false,
  onFocus,
  onSelectSymbol,
}: {
  className?: string;
  collapsedHeight?: number;
  expanded?: boolean;
  /** Opens this reading in the screen-sized Oracle workbench. */
  onFocus?: () => void;
  onSelectSymbol?: (symbol: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const { data } = useQuery<RotationFeed>({
    queryKey: ['/api/sector-rotation', 'oracle-market-pulse'],
    queryFn: async () => {
      const response = await fetch('/api/sector-rotation', { credentials: 'include' });
      if (!response.ok) throw new Error('rotation unavailable');
      return response.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const { data: extended } = useQuery<ExtendedFeed>({
    queryKey: ['/api/extended-hours', 'oracle-tape'], // shared with the tape — was a 2nd identical request per board load
    queryFn: async () => {
      const response = await fetch('/api/extended-hours', { credentials: 'include' });
      if (!response.ok) throw new Error('extended-hours unavailable');
      return response.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const { data: realtime } = useRealtimeStatus();

  if (!data) return null;

  // Never blend a historic 1d Yahoo bar into a current cash-market verdict. The
  // server sends isStale too; the local clock is a belt-and-suspenders guard for
  // clients still talking to an older server during HMR.
  const extendedCurrent = !!extended && extended.session !== 'closed' && !extended.isStale && cashTapeOpenNow();
  const assets = extendedCurrent ? extended.assetClasses ?? [] : [];
  const read = data.isStale || !extendedCurrent
    ? { label: 'Last cash read', detail: `${data.sessionLabel} · cash market closed`, tone: TC.info }
    : marketRead(data.spyChange, assets);
  const destination = expanded ? data.leaders : data.leaders.slice(0, 2);
  const source = expanded ? data.laggards : data.laggards.slice(0, 2);
  // SPY remains an honest cash-equity close outside market hours. The cyan orbit
  // only wakes when the ES socket is genuinely fresh; it means the related index
  // future is streaming, not that Friday's SPY quote is ticking.
  const es = realtime?.prices?.futures?.ES;
  const esLive = !!es && es.ageSeconds <= 30;

  return (
    <PanelFrame
      title="Market Pulse"
      className={cn('h-full', className)}
      collapsedHeight={collapsedHeight}
      forceExpanded={expanded}
      onFocus={onFocus}
      right={
        <span className="inline-flex items-center gap-2 font-mono text-[10px] font-medium text-muted-foreground">
          {data.sessionLabel}
          {/* "· stale" told you the state but never how stale. Canon renders the
              actual age, which is the difference between a reader trusting the
              panel and a reader guessing. */}
          <CanonFreshness since={data.asOf ?? null} label={data.isStale ? "STALE" : "LIVE"} />
        </span>
      }
    >
      <div className="flex min-h-[350px] flex-col px-4 py-3">
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-border/35 pb-3">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: read.tone }}>{read.label}</div>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{read.detail}</p>
          </div>
          <motion.div
            aria-label={`SPY cash ${signed(data.spyChange)}${esLive ? `; ES futures live, ${es!.ageSeconds} seconds old` : ''}`}
            className="relative grid h-[84px] w-[84px] place-items-center rounded-full border font-mono tabular-nums"
            style={{ borderColor: `color-mix(in srgb, ${read.tone} 70%, transparent)`, background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${read.tone} 34%, transparent), color-mix(in srgb, ${read.tone} 8%, transparent) 58%, transparent 72%)`, boxShadow: `0 0 28px color-mix(in srgb, ${read.tone} 26%, transparent)` }}
            animate={reduceMotion ? undefined : { scale: [1, 1.025, 1] }}
            transition={reduceMotion ? undefined : { duration: 3.8, ease: 'easeInOut', repeat: Infinity }}
          >
            {esLive && !reduceMotion && (
              <>
                <motion.span
                  aria-hidden="true"
                  className="absolute -inset-2 rounded-full border border-[var(--brand-cyan)]/40"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, ease: 'linear', repeat: Infinity }}
                  style={{ borderStyle: 'dashed' }}
                />
                <motion.span
                  key={`es-pulse-${es!.price}`}
                  aria-hidden="true"
                  className="absolute -inset-3 rounded-full border border-[var(--brand-cyan)]"
                  initial={{ opacity: 0.7, scale: 0.72 }}
                  animate={{ opacity: 0, scale: 1.24 }}
                  transition={{ duration: 1.15, ease: 'easeOut' }}
                />
              </>
            )}
            {esLive && (
              <span className="absolute top-2 inline-flex items-center gap-1 text-[9px] font-bold tracking-[0.13em] text-[var(--brand-cyan)]">
                <span className="h-1 w-1 rounded-full bg-[var(--brand-cyan)]" /> ES LIVE
              </span>
            )}
            <span className="text-[17px] font-bold tracking-tight" style={{ color: read.tone }}>{signed(data.spyChange)}</span>
            <span className="absolute bottom-[13px] text-[9px] font-bold tracking-[0.14em] text-muted-foreground">SPY CASH</span>
          </motion.div>
        </div>

        {assets.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-x-5">
            {assets.map((asset) => <AssetRow key={asset.key} asset={asset} />)}
          </div>
        )}

        <MarketStream className="mt-3" />

        {extendedCurrent && ((extended?.gainers?.length ?? 0) > 0 || (extended?.losers?.length ?? 0) > 0) && (
          <div className="mt-3 border-y border-border/35 py-2">
            <div className="mb-1.5 flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
              <span>{sessionLeadersLabel(extended?.session)}</span>
              <span className="text-[var(--brand-cyan)]">live tape · not signals</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {[...(extended?.gainers ?? []).slice(0, 5), ...(extended?.losers ?? []).slice(0, 3)].map((quote) => (
                <button
                  type="button"
                  key={quote.symbol}
                  onClick={() => onSelectSymbol?.(quote.symbol)}
                  className="group flex shrink-0 items-center gap-2 border border-border/45 bg-foreground/[0.025] px-2 py-1.5 font-mono transition-colors hover:border-[var(--brand-cyan)]/55 hover:bg-[var(--brand-cyan)]/[0.06]"
                  title={`${quote.symbol} ${signed(quote.changePct)} ${extended?.session === 'regular' ? 'today' : extended?.session === 'post' ? 'after-hours' : 'pre-market'} · click to inspect`}
                >
                  <span className="text-[10px] font-bold tracking-[0.08em] text-foreground">{quote.symbol}</span>
                  <span className="text-[10px] font-semibold tabular-nums" style={{ color: quote.changePct >= 0 ? TC.bull : TC.bear }}>{signed(quote.changePct)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 border-t border-border/35 pt-3">
          <div className="mb-2 flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.14em]">
            <span className="text-muted-foreground">Cash rotation</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 font-mono text-[10px] leading-relaxed">
            <div className="min-w-0">
              <span className="block text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Out of</span>
              {source.map((sector) => (
                <span key={sector.etf} className="mr-2 inline-block font-semibold" style={{ color: TC.bear }} title={`${sector.name} · ${signed(sector.relChange)} vs SPY`}>{sector.name} {signed(sector.change)}</span>
              ))}
            </div>
            <span className="pt-3 text-muted-foreground">→</span>
            <div className="min-w-0 text-right">
              <span className="block text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Into</span>
              {destination.map((sector) => (
                <span key={sector.etf} className="ml-2 inline-block font-semibold" style={{ color: TC.bull }} title={`${sector.name} · ${signed(sector.relChange)} vs SPY`}>{sector.name} {signed(sector.change)}</span>
              ))}
            </div>
          </div>
          {extendedCurrent && extended?.interpretation && <p className="mt-2 line-clamp-2 font-mono text-[9px] leading-relaxed text-muted-foreground">{extended.interpretation}</p>}
        </div>
      </div>
    </PanelFrame>
  );
}
