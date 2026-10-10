/**
 * useTA — structured technical read from /api/ta/:symbol.
 * Fib levels + candlestick patterns + support/resistance + net bias, all derived
 * server-side from real candles (the heavy `technicalindicators` lib stays off the
 * client bundle). Never fabricates: on error/empty, fields are null/[] and the
 * overlay simply renders nothing.
 */
import { useQuery } from '@tanstack/react-query';

export interface TAFibLevel {
  ratio: number;
  price: number;
  label: string;
  key: boolean;
}

export interface TAPattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak';
  detected: boolean;
}

export interface TARead {
  symbol: string;
  asOf: number;
  currentPrice: number;
  candleCount: number;
  fib: {
    swingHigh: number;
    swingLow: number;
    trend: 'uptrend' | 'downtrend';
    currentZone: string;
    levels: TAFibLevel[];
  } | null;
  patterns: TAPattern[];
  levels: {
    support: number[];
    resistance: number[];
    nearestSupport: number;
    nearestResistance: number;
    pricePosition: 'near_support' | 'near_resistance' | 'middle';
  } | null;
  structure: {
    trend: 'uptrend' | 'downtrend' | 'ranging';
    higherHighs: number;
    higherLows: number;
    lowerHighs: number;
    lowerLows: number;
    breakOfStructure: boolean;
  } | null;
  bias: {
    direction: 'bullish' | 'bearish' | 'neutral';
    score: number;
    confluence: string[];
  };
}

export function useTA(symbol: string | undefined, range = '6mo', interval = '1d', enabled = true) {
  const query = useQuery<TARead>({
    queryKey: ['/api/ta', symbol, range, interval],
    queryFn: async () => {
      const res = await fetch(`/api/ta/${symbol}?range=${range}&interval=${interval}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('ta failed');
      return res.json();
    },
    enabled: !!symbol && enabled,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 4000),
  });

  return {
    ta: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
