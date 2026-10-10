/**
 * SESSION BRIEF — "what do I go into today with?"
 *
 * The desk's morning workflow starts with sector leadership, not with a signal list:
 * see which groups are bid, then find the names carrying them, then go looking for flow.
 * The platform computed all of this and left it in an endpoint nobody surfaced, so at
 * 08:25 with the open an hour away the screen said nothing useful.
 *
 * Session-aware by design: a real pre/post tape is shown while it is active; after the
 * session closes the brief stays anchored to the last cash read instead of inventing a
 * weekend stock tape.
 */
import { useQuery } from '@tanstack/react-query';
import { Heartbeat } from '@/components/viz';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PanelFrame } from '@/components/oracle/panel-frame';
import { TC } from '@/lib/design-tokens';
import { DivergingBar, ParticipationStrip, robustMax } from '@/components/viz';
import { useRealtimeStatus } from '@/components/oracle/market-stream';

import { getOpexContext } from '@shared/opex-calendar';
interface LeaderName { symbol: string; changePct: number; isMega?: boolean }
interface SectorStrength {
  key: string; label: string; medianChangePct: number; breadthPct: number;
  strength: number; isSkewed?: boolean; leaders: LeaderName[]; laggards: LeaderName[];
  stance: 'leading' | 'improving' | 'weakening' | 'lagging';
}
interface Leadership {
  /** Server-side generation time; see viz/MOTION.md on why fetch time is not used. */
  generatedAt?: string;
  session: string; quoted: number; universeSize: number;
  benchmarkChangePct: number | null;
  sectors: SectorStrength[]; megaCaps: LeaderName[];
  interpretation: string;
}

interface MacroGate {
  level: 'clear' | 'watch' | 'cash' | 'unavailable';
  message: string;
  nextEvent: { name: string; date: string; time: string; hoursUntil: number | null; tradingImpact?: string } | null;
  calendar?: { current: boolean; lastDate: string | null };
}

interface RotationOpportunity {
  etf: string; name: string; rsRatio: number | null; rsMomentum: number | null;
  relChange: number; isStale?: boolean;
}
interface RotationBriefPayload { asOf?: string; isStale?: boolean; sessionLabel?: string; sectors?: RotationOpportunity[] }

// Liquid, optionable representatives. These are research candidates—not
// signals—and therefore never inherit a direction merely because their sector
// moved. The workup must still confirm the name's own tape and structure.
const ROTATION_CANDIDATES: Record<string, string[]> = {
  XLV: ['LLY', 'JNJ', 'UNH', 'MRK', 'ABBV'], XBI: ['VRTX', 'REGN', 'MRNA', 'GILD'],
  IGV: ['MSFT', 'NOW', 'CRM', 'ADBE', 'DDOG', 'NET'], XLK: ['AAPL', 'MSFT', 'ORCL', 'QCOM'],
  SMH: ['AMD', 'AVGO', 'MU', 'ARM', 'KLAC', 'LRCX'], XLF: ['JPM', 'GS', 'BAC', 'AFRM'],
  XLE: ['XOM', 'CVX', 'COP', 'SLB'], XLI: ['CAT', 'GE', 'BA', 'DE'],
  XLY: ['AMZN', 'TSLA', 'HD', 'NKE'], ITA: ['LMT', 'RTX', 'NOC', 'KTOS'],
};

const SESSION_LABEL: Record<string, string> = {
  pre: 'Pre-market', regular: 'Live session', post: 'After-hours', closed: 'Last cash close',
};

function cashHandoffCopy(session: string) {
  const eastern = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const weekend = eastern.getDay() === 0 || eastern.getDay() === 6;
  if (weekend) {
    return {
      label: 'Weekend handoff',
      text: `Cash equities are closed. ${SESSION_LABEL[session] ?? session} is the last stock-market reading; futures and crypto stay live without being blended into stock leadership.`,
    };
  }
  return {
    label: 'Cash equities closed',
    text: `${SESSION_LABEL[session] ?? session} is the latest cash-equity read. Rotation and sector leadership stay anchored to that session; live futures and crypto are shown in Market Pulse, not blended into stock rankings.`,
  };
}

export function SessionBrief({
  onSelectSymbol,
  className,
  collapsedHeight,
  expanded = false,
  onFocus,
}: {
  onSelectSymbol?: (s: string) => void;
  className?: string;
  /** Lets the Oracle market stage align the tape with its neighbouring live views. */
  collapsedHeight?: number;
  expanded?: boolean;
  onFocus?: () => void;
}) {
  const { data, isLoading, isError } = useQuery<Leadership>({
    queryKey: ['/api/sector-leadership'],
    queryFn: async () => {
      const r = await fetch('/api/sector-leadership', { credentials: 'include' });
      if (!r.ok) throw new Error('leadership failed');
      return r.json();
    },
    staleTime: 30_000, refetchInterval: 60_000, retry: 1,
  });

  // This is a tape, not a summary card: render every group and let the compact
  // stage scroll through them. Full-card focus is the only expansion path.

  const opex = getOpexContext();
  const { data: realtime } = useRealtimeStatus();
  const macroGate = useQuery<MacroGate>({
    queryKey: ['/api/macro/cash-gate'],
    queryFn: async () => {
      const r = await fetch('/api/macro/cash-gate', { credentials: 'include' });
      if (!r.ok) throw new Error('cash gate failed');
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    retry: 1,
  });
  const rotation = useQuery<RotationBriefPayload>({
    queryKey: ['/api/sector-rotation', 'session-brief'],
    queryFn: async () => {
      const r = await fetch('/api/sector-rotation', { credentials: 'include' });
      if (!r.ok) throw new Error('rotation failed');
      return r.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const handoff = data ? cashHandoffCopy(data.session) : null;
  const sectors = data?.sectors ?? [];
  // Shared scale so every bar is comparable — but robust, not the raw max. One
  // outlier group (crypto routinely runs 10x the rest) was setting the axis and
  // flattening every other bar to an unreadable nub.
  const maxMove = robustMax(sectors.map((x) => x.medianChangePct));
  const strong = sectors.filter((x) => x.medianChangePct >= 0);
  const weak = sectors.filter((x) => x.medianChangePct < 0).reverse();
  const rotationResearch = (rotation.data?.sectors ?? [])
    .filter((sector) => sector.rsRatio != null && sector.rsMomentum != null && sector.rsMomentum > 0 && ROTATION_CANDIDATES[sector.etf])
    .map((sector) => ({ ...sector, phase: (sector.rsRatio ?? 0) >= 0 ? 'LEADING' : 'IMPROVING' as const }))
    .sort((a, b) => {
      // Improving groups are the earliest handoff; established leaders follow.
      if (a.phase !== b.phase) return a.phase === 'IMPROVING' ? -1 : 1;
      return (b.rsMomentum ?? 0) - (a.rsMomentum ?? 0);
    })
    .slice(0, 4);
  return (
    <PanelFrame
      title="Session Brief"
      className={className}
      collapsedHeight={collapsedHeight}
      forceExpanded={expanded}
      onFocus={onFocus}
      scrollable={!expanded}
      inlineToggle={false}
      right={
        <span className="flex items-center gap-2 text-label font-mono text-muted-foreground">
          {data && (
            <>
              <span style={{ color: data.session === 'regular' ? TC.bull : TC.warn }}>
                {SESSION_LABEL[data.session] ?? data.session}
              </span>
              <span>· {data.quoted}/{data.universeSize} names</span>
              {data.session === 'closed' ? (
                <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">cash closed</span>
              ) : (
                <Heartbeat since={data.generatedAt} staleAfterSec={900} className="ml-1" />
              )}
            </>
          )}
        </span>
      }
    >
      {isLoading ? (
        <div className="flex h-32 items-center justify-center gap-2 text-label font-mono uppercase tracking-widest text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading leadership…
        </div>
      ) : isError || sectors.length === 0 ? (
        <div className="px-6 py-8 text-center text-meta leading-relaxed text-muted-foreground">
          Leadership unavailable right now. It will refresh automatically.
        </div>
      ) : (
        <>
          {data && data.session !== 'regular' && (
            <div className="border-b border-border/30 px-4 py-2.5" style={{ background: `color-mix(in srgb, ${TC.info} 6%, transparent)` }}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-label ui-eyebrow" style={{ color: TC.info }}>{handoff?.label}</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                  {realtime?.futures?.connected ? `${realtime.futures.symbols ?? 0} futures streams` : 'futures unavailable'} · {realtime?.coinbase?.connected ? `${realtime.coinbase.symbols ?? 0} crypto streams` : 'crypto unavailable'}
                </span>
              </div>
              <p className="ui-prose mt-1 text-label leading-snug text-muted-foreground">
                {handoff?.text}
              </p>
            </div>
          )}
          {/* Expiration context sits ABOVE the interpretation. A monthly OPEX changes
              how every option on the board behaves, and the platform used to say
              nothing — an IWM put was held into one and settled worthless with no
              warning that the date mattered. */}
          {opex.label && (
            <div
              className="border-b border-border/30 px-4 py-2"
              style={{ background: `color-mix(in srgb, ${TC.warn} 8%, transparent)` }}
            >
              <div className="text-label ui-eyebrow" style={{ color: TC.warn }}>{opex.label}</div>
              {opex.note && (
                <p className="ui-prose mt-1 text-label leading-snug text-muted-foreground">{opex.note}</p>
              )}
            </div>
          )}

          {macroGate.data && <EventRiskLine gate={macroGate.data} />}

          {data?.interpretation && (
            <p className="ui-prose border-b border-border/30 px-4 py-2 text-body leading-snug text-foreground/85"
               title={data.interpretation}>
              {data.interpretation}
            </p>
          )}

          {rotationResearch.length > 0 && (
            <div className="border-b border-border/30 px-4 py-3" style={{ background: `color-mix(in srgb, ${TC.info} 5%, transparent)` }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-label ui-eyebrow" style={{ color: '#2dd4bf' }}>Rotation research queue</div>
                  <p className="ui-prose mt-1 text-label leading-snug text-muted-foreground">Improving groups are early handoffs; leading groups have established relative strength. The names below are next for interrogation—not automatic longs.</p>
                </div>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{rotation.data?.sessionLabel ?? 'rotation feed'}</span>
              </div>
              <div className="mt-2.5 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {rotationResearch.map((sector) => (
                  <div key={sector.etf} className="rounded border border-border/45 bg-background/20 px-2.5 py-2">
                    <div className="flex items-baseline justify-between gap-2 font-mono">
                      <b className="text-[10px] text-foreground">{sector.etf} · {sector.name}</b>
                      <span className="text-[8px] font-bold tracking-wide" style={{ color: sector.phase === 'IMPROVING' ? '#2dd4bf' : TC.bull }}>{sector.phase}</span>
                    </div>
                    <div className="mt-1 font-mono text-[8px] tabular-nums text-muted-foreground">RS {sector.rsRatio?.toFixed(2)} · momentum +{sector.rsMomentum?.toFixed(2)}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
                      {ROTATION_CANDIDATES[sector.etf].slice(0, 5).map((symbol) => (
                        <button key={symbol} onClick={() => onSelectSymbol?.(symbol)} className="cursor-pointer font-mono text-[9px] font-semibold text-muted-foreground transition-colors hover:text-foreground">{symbol}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 py-2.5">
            <div className="mb-1.5 text-label font-mono uppercase tracking-widest" style={{ color: TC.bull }}>
              Leading
            </div>
            <div className="space-y-2">
              {strong.map((s) => (
                <SectorRow key={s.key} s={s} names={s.leaders} onSelectSymbol={onSelectSymbol} maxMove={maxMove} />
              ))}
            </div>

            <div className="mb-1.5 mt-3 text-label font-mono uppercase tracking-widest" style={{ color: TC.bear }}>
              Under pressure
            </div>
            <div className="space-y-2">
              {weak.map((s) => (
                <SectorRow key={s.key} s={s} names={s.laggards} onSelectSymbol={onSelectSymbol} maxMove={maxMove} />
              ))}
            </div>

            {(data?.megaCaps?.length ?? 0) > 0 && (
              <div className="mt-3 border-t border-border/30 pt-2.5">
                <div className="mb-1 text-label font-mono uppercase tracking-widest text-muted-foreground">
                  Mega caps
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {data!.megaCaps.map((m) => (
                    <button key={m.symbol} onClick={() => onSelectSymbol?.(m.symbol)}
                      className="cursor-pointer text-label font-mono tabular-nums transition-opacity hover:opacity-70"
                      style={{ color: m.changePct >= 0 ? TC.bull : TC.bear }}>
                      {m.symbol} {m.changePct >= 0 ? '+' : ''}{m.changePct.toFixed(1)}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="ui-prose mt-3 text-label leading-relaxed text-muted-foreground">
              Trade continuation in the leaders, or look for reversals in the laggards. Confirm on the
              chart before acting — leadership says where to look, not what to buy.
            </p>
          </div>


        </>
      )}
    </PanelFrame>
  );
}

function EventRiskLine({ gate }: { gate: MacroGate }) {
  // A server that predates calendar coverage metadata is unverified too. Never
  // translate an absent check into green just because the old endpoint said clear.
  const unavailable = gate.level === 'unavailable' || !gate.calendar || gate.calendar.current === false;
  const cash = gate.level === 'cash';
  const watch = gate.level === 'watch';
  const tone = unavailable || watch ? TC.warn : cash ? TC.bear : TC.bull;
  const label = unavailable ? 'Macro coverage' : cash ? 'Cash-gate' : watch ? 'Event watch' : 'Event risk';
  const detail = unavailable
    ? `Calendar ends ${gate.calendar?.lastDate ?? 'before today'} — no all-clear implied.`
    : gate.nextEvent
      ? `${gate.nextEvent.name} · ${gate.nextEvent.time}`
      : 'No high-impact print is imminent.';

  return (
    <div
      className="flex items-start gap-2 border-b border-border/30 px-4 py-2"
      style={{ background: `color-mix(in srgb, ${tone} ${unavailable ? 8 : cash ? 12 : 5}%, transparent)` }}
      role={cash ? 'alert' : 'status'}
    >
      {unavailable || cash ? <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" style={{ color: tone }} /> : <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />}
      <div className="min-w-0">
        <div className="text-label ui-eyebrow" style={{ color: tone }}>{label}</div>
        <p className="ui-prose mt-0.5 text-label leading-snug text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function SectorRow({ s, names, onSelectSymbol, maxMove }: {
  s: SectorStrength; names: LeaderName[]; onSelectSymbol?: (sym: string) => void; maxMove: number;
}) {
  const up = s.medianChangePct >= 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-meta font-mono uppercase tracking-wider text-foreground/85">{s.label}</span>
        <span className="flex items-baseline gap-2 text-label font-mono tabular-nums">
          <span style={{ color: up ? TC.bull : TC.bear }}>
            {up ? '+' : ''}{s.medianChangePct.toFixed(2)}%
          </span>
          {s.isSkewed && <span style={{ color: TC.warn }} title="One name is carrying this group">thin</span>}
        </span>
      </div>

      {/* move vs the rest of the board, drawn from centre so direction reads instantly */}
      <div className="mt-1"><DivergingBar value={s.medianChangePct} max={maxMove} height={5} /></div>

      {/* Breadth — how much of the group is moving together, not just the average.
          A segmented strip rather than a second filled bar: it sits directly under
          the move bar, and two green bars of similar length meaning different things
          is unreadable no matter how correct the widths are. */}
      <div className="mt-1.5 flex items-center gap-2">
        <ParticipationStrip pct={s.breadthPct} className="flex-1 text-foreground" />
        <span className="shrink-0 text-label font-mono tabular-nums text-muted-foreground">
          {s.breadthPct.toFixed(0)}% of group
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
        {names.slice(0, 3).map((n) => (
          <button key={n.symbol} onClick={() => onSelectSymbol?.(n.symbol)}
            className="cursor-pointer text-label font-mono tabular-nums transition-opacity hover:opacity-70"
            style={{ color: n.changePct >= 0 ? TC.bull : TC.bear }}>
            {n.symbol} {n.changePct >= 0 ? '+' : ''}{n.changePct.toFixed(1)}%
          </button>
        ))}
      </div>
    </div>
  );
}
