/**
 * usePriceHistory — real OHLC candles from /api/historical-prices/:symbol.
 * Shared by the big signal chart and the per-row sparklines. React Query
 * caches per (symbol, range) so list sparklines + the detail chart dedupe.
 *
 * Returns close-price points only (what both the area chart and sparkline draw).
 * Never fabricates: on error/empty, `points` is [] and callers show nothing.
 */
import { useQuery } from '@tanstack/react-query';

export interface PricePoint {
  time: number;   // unix seconds
  close: number;
}

interface HistoryResponse {
  symbol: string;
  range: string;
  data: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
}

export function usePriceHistory(symbol: string | undefined, range = '1mo', interval = '1d') {
  const query = useQuery<PricePoint[]>({
    queryKey: ['/api/historical-prices', symbol, range, interval],
    queryFn: async () => {
      const res = await fetch(
        `/api/historical-prices/${symbol}?range=${range}&interval=${interval}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('history failed');
      const body: (HistoryResponse & { error?: string }) = await res.json();
      // The endpoint sometimes 200s with an { error } body when the upstream
      // provider rate-limits (Tradier 429 → CBOE fallback race). Treat an
      // empty/errored payload as a failure so React Query retries instead of
      // caching a blank chart.
      const points = (body.data ?? []).map((d) => ({ time: d.time, close: d.close }));
      if (points.length < 2) throw new Error(body.error ?? 'history empty');
      return points;
    },
    enabled: !!symbol,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    // Upstream rate-limits are transient; back off and retry a few times before
    // showing the "unavailable" state so a single 429 doesn't blank the chart.
    retry: 3,
    retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 4000),
  });

  return {
    points: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
