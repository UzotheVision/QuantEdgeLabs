/**
 * REPEAT BUYERS — the same contract being added to, session after session.
 *
 * The card leads with the OI bar rather than the premium number on purpose. Our
 * flow rows are end-of-day chain aggregates, so premium is everything that traded
 * at that strike — a number that looks enormous whether someone accumulated a
 * position or day-traded it flat. Open interest is what survives the close, so
 * OI growth is the only honest evidence that somebody kept the position on.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Repeat, LogOut } from 'lucide-react';
import { EASE, DUR } from '@/lib/motion';
import { TC } from '@/lib/design-tokens';
import { useStockContext } from '@/contexts/stock-context';

interface RepeatDay { date: string; volume: number; openInterest: number; totalPremium: number }
interface RepeatContract {
  symbol: string; optionType: 'call' | 'put'; strike: number; expiry: string;
  daysSeen: number; consecutive: boolean; firstSeen: string; lastSeen: string;
  days: RepeatDay[]; oiChange: number; oiChangePct: number | null;
  totalPremium: number; read: 'accumulating' | 'churning' | 'unwinding'; why: string;
}
interface RepeatReport {
  contracts: RepeatContract[];
  coverage: { daysCaptured: number; dates: string[]; sufficient: boolean; current: boolean; latest: string | null; note: string };
}

const READ_COLOR = { accumulating: TC.bull, churning: TC.muted, unwinding: TC.bear } as const;

/** OI on the first day vs the last, on one axis — the growth IS the signal. */
function OiGrowth({ from, to }: { from: number; to: number }) {
  const max = Math.max(from, to, 1);
  const w = (v: number) => `${Math.max(2, (v / max) * 100)}%`;
  const grew = to > from;
  return (
    <div className="space-y-1">
      <Row label={from.toLocaleString()} width={w(from)} color={TC.muted} sub="first seen" />
      <Row label={to.toLocaleString()} width={w(to)} color={grew ? TC.bull : TC.bear} sub="latest" />
    </div>
  );
}
function Row({ label, width, color, sub }: { label: string; width: string; color: string; sub: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="w-16 shrink-0 text-label font-mono uppercase tracking-wider text-muted-foreground">{sub}</span>
      <div className="h-1.5 flex-1 min-w-[30px] overflow-hidden rounded-full bg-foreground/[0.07]">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width, background: color }} />
      </div>
      <span className="w-16 shrink-0 text-right text-label font-mono tabular-nums" style={{ color }}>{label}</span>
    </div>
  );
}

export function RepeatBuyers({ className }: { className?: string }) {
  const { setCurrentStock } = useStockContext();
  // Buyers and exits are the same open-interest read run in opposite directions,
  // so they belong in one card rather than two competing for the same space.
  const [mode, setMode] = useState<'buyers' | 'exits'>('buyers');

  const { data, isLoading, isError } = useQuery<RepeatReport>({
    queryKey: ['/api/flow', mode],
    queryFn: async () => {
      const url = mode === 'buyers'
        ? '/api/flow/repeats?minDays=2&limit=24'
        : '/api/flow/exits?limit=24';
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) throw new Error('flow read failed');
      const j = await r.json();
      return mode === 'buyers' ? j : { ...j, contracts: j.exits ?? [] };
    },
    staleTime: 300_000, refetchInterval: 600_000, retry: 1,
  });

  return (
    <div className={`rounded-xl border border-card-border bg-card overflow-hidden ${className ?? ''}`}>
      <div className="flex items-start gap-2.5 border-b border-border/40 px-4 py-2.5">
        {mode === 'buyers'
          ? <Repeat className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TC.info }} />
          : <LogOut className="mt-0.5 h-4 w-4 shrink-0" style={{ color: TC.bear }} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-meta font-mono font-bold uppercase tracking-widest text-foreground/80">
              {mode === 'buyers' ? 'Repeat Buyers' : 'Whale Exits'}
            </span>
            <span className="text-label font-mono tabular-nums text-muted-foreground">{data?.contracts.length ?? 0}</span>
            <div className="ml-auto flex items-center gap-1">
              {(['buyers', 'exits'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={
                    'cursor-pointer rounded px-1.5 py-0.5 text-label font-mono uppercase tracking-wider transition-colors ' +
                    (mode === m ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground')
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="text-label font-mono text-muted-foreground mt-0.5">
            {mode === 'buyers'
              ? 'Same strike and expiry added to across sessions — ranked by open interest, not premium'
              : 'Large positions being closed away from expiry — falling open interest, not falling premium'}
          </div>
        </div>
      </div>

      {/* Coverage is stated BEFORE the list. A repeat from an old pair is real, but
          it describes past positioning, and the rows alone cannot say which. */}
      {data && (!data.coverage.current || !data.coverage.sufficient) && (
        <div
          className="border-b border-border/30 px-4 py-2 ui-prose text-label leading-snug"
          style={{ color: TC.warn, background: `color-mix(in srgb, ${TC.warn} 8%, transparent)` }}
        >
          {data.coverage.note}
        </div>
      )}

      {isLoading ? (
        <div className="grid place-items-center py-10 text-label font-mono uppercase tracking-widest text-muted-foreground">
          reading repeat flow…
        </div>
      ) : isError || !data ? (
        <div className="grid place-items-center py-10 text-label font-mono uppercase tracking-widest text-muted-foreground">
          repeat flow unavailable
        </div>
      ) : data.contracts.length === 0 ? (
        <div className="px-4 py-8 text-center ui-prose text-label leading-relaxed text-muted-foreground">
          {mode === 'buyers'
            ? 'No contract has been bought on more than one captured session yet.'
            : 'No large position has been closed down across the captured sessions. Contracts near expiry are excluded — open interest collapses there regardless of conviction.'}
        </div>
      ) : (
        <div className="divide-y divide-border/25">
          {data.contracts.map((c, i) => {
            const color = READ_COLOR[c.read];
            const dir = c.optionType === 'call' ? TC.bull : TC.bear;
            return (
              <motion.button
                key={`${c.symbol}-${c.optionType}-${c.strike}-${c.expiry}`}
                onClick={() => setCurrentStock({ symbol: c.symbol })}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DUR.base, ease: EASE, delay: Math.min(i * 0.03, 0.3) }}
                className="w-full cursor-pointer px-4 py-2.5 text-left transition-colors hover:bg-foreground/[0.03]"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-body font-mono font-bold tracking-wide text-foreground">{c.symbol}</span>
                  <span className="text-label font-mono font-bold px-1.5 py-0.5 rounded"
                        style={{ color: dir, background: `color-mix(in srgb, ${dir} 12%, transparent)` }}>
                    ${c.strike} {c.optionType.toUpperCase()}
                  </span>
                  <span className="text-label font-mono text-muted-foreground">{c.expiry}</span>
                  <span className="text-label font-mono uppercase tracking-wider" style={{ color }}>
                    {c.read}
                  </span>
                  <span className="ml-auto text-label font-mono text-muted-foreground">
                    {c.daysSeen} sessions{c.consecutive ? ' · back-to-back' : ''}
                  </span>
                </div>

                <div className="mt-1.5">
                  <OiGrowth from={c.days[0].openInterest} to={c.days[c.days.length - 1].openInterest} />
                </div>

                <div className="mt-1 ui-prose text-label leading-snug text-muted-foreground">{c.why}</div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default RepeatBuyers;
