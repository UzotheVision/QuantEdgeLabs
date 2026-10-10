/**
 * LIVE MARKET STREAM
 *
 * This is not an animated placeholder. It reads the server's actual Coinbase and
 * futures sockets: crypto and index futures keep moving while cash equities are
 * closed, so the Terminal can be genuinely alive on a Sunday night without
 * pretending Friday's stock close is a live quote.
 */
import { useQuery } from '@tanstack/react-query';
import { LiveValue } from '@/components/viz';
import { cn } from '@/lib/utils';
import { TC } from '@/lib/design-tokens';

export interface StreamQuote { price: number; ageSeconds: number }
export interface RealtimeStatus {
  coinbase?: { connected?: boolean; symbols?: number; lastUpdate?: string };
  futures?: { connected?: boolean; symbols?: number; lastUpdate?: string };
  prices?: { crypto?: Record<string, StreamQuote>; futures?: Record<string, StreamQuote> };
}

export function useRealtimeStatus() {
  return useQuery<RealtimeStatus>({
    queryKey: ['/api/realtime-status'],
    queryFn: async () => {
      const response = await fetch('/api/realtime-status', { credentials: 'include' });
      if (!response.ok) throw new Error('stream unavailable');
      return response.json();
    },
    staleTime: 2_000,
    refetchInterval: 3_000,
    retry: 1,
  });
}

const formatPrice = (symbol: string, value: number) => {
  if (symbol === 'BTC') return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (symbol === 'ETH') return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (value >= 1_000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toFixed(2);
};

export function MarketStream({ className }: { className?: string }) {
  const { data } = useRealtimeStatus();
  const quotes = [
    ['ES', data?.prices?.futures?.ES],
    ['NQ', data?.prices?.futures?.NQ],
    ['CL', data?.prices?.futures?.CL],
    ['BTC', data?.prices?.crypto?.BTC],
    ['ETH', data?.prices?.crypto?.ETH],
  ] as const;
  const active = quotes.filter(([, quote]) => quote && quote.ageSeconds <= 30).length;

  if (!data) return null;

  return (
    <section className={cn('border-y border-border/35 py-2', className)} aria-label="Live overnight market stream">
      <div className="mb-1.5 flex items-center justify-between gap-3 font-mono text-[9px] uppercase tracking-[0.13em]">
        <span className="inline-flex items-center gap-1.5 text-[var(--brand-cyan)]">
          <span className="relative flex h-1.5 w-1.5">
            {active > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--brand-cyan)] opacity-65" />}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--brand-cyan)]" />
          </span>
          Overnight stream
        </span>
        <span className="tabular-nums text-muted-foreground">{active}/{quotes.length} fresh</span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {quotes.map(([symbol, quote]) => {
          const fresh = quote && quote.ageSeconds <= 30;
          return (
            <div key={symbol} className="min-w-0 font-mono tabular-nums">
              <div className="flex items-center gap-1 text-[9px] font-bold tracking-[0.13em] text-muted-foreground">
                <span className="h-1 w-1 rounded-full" style={{ background: fresh ? TC.bull : TC.warn }} /> {symbol}
              </div>
              {quote ? (
                <LiveValue
                  value={quote.price}
                  format={(value) => formatPrice(symbol, value)}
                  className="mt-0.5 block max-w-full truncate px-0 text-[10px] font-semibold text-foreground"
                />
              ) : <span className="text-[10px] text-muted-foreground">—</span>}
              <div className="mt-0.5 text-[9px] text-muted-foreground">{quote ? `${quote.ageSeconds}s` : 'no feed'}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
