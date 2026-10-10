import { useMemo } from "react";
import { getMarketStatus } from "@/lib/market-hours";
import { CACHE_TIMES } from "@/lib/queryClient";

/**
 * Returns a polling interval that respects market hours.
 * During market hours: uses the provided `openInterval`.
 * Outside market hours: uses `closedInterval` (defaults to 5 min).
 *
 * Usage:
 *   const interval = useMarketPoll(CACHE_TIMES.FAST);
 *   useQuery({ queryKey: [...], refetchInterval: interval });
 */
export function useMarketPoll(
  openInterval: number = CACHE_TIMES.FAST,
  closedInterval: number = CACHE_TIMES.STABLE,
): number {
  // Re-evaluate once per render — market status changes slowly so this is fine.
  // The React Query refetch itself keeps firing at whatever interval we return,
  // and on the next component render (triggered by that refetch) we'll re-check.
  const { isOpen } = getMarketStatus();
  return isOpen ? openInterval : closedInterval;
}

/**
 * Convenience presets for common data types.
 */
export const POLL = {
  /** Live prices — 10s open, 60s closed */
  PRICES: { open: CACHE_TIMES.REALTIME, closed: 60_000 },
  /** Scanner / trade ideas — 30s open, 5m closed */
  SCANNER: { open: CACHE_TIMES.FAST, closed: CACHE_TIMES.STABLE },
  /** Dashboard metrics — 60s open, 5m closed */
  METRICS: { open: 60_000, closed: CACHE_TIMES.STABLE },
  /** GEX / heavy compute — 2m open, 10m closed */
  HEAVY: { open: CACHE_TIMES.MEDIUM, closed: 10 * 60_000 },
  /** Mostly static — 5m always */
  SLOW: { open: CACHE_TIMES.SLOW, closed: CACHE_TIMES.SLOW },
} as const;
