/**
 * useTabState — useState that's also synced to ?tab= in the URL.
 *
 *   const [tab, setTab] = useTabState<'a' | 'b' | 'c'>('a', ['a','b','c']);
 *
 * - Initial value: read from ?tab= if present and in `valid`, otherwise `defaultValue`.
 * - On change: replaces history state with new ?tab= (omits if equal to default).
 * - Changes from external navigation are NOT auto-pulled (kept simple).
 */
import { useEffect, useState, useCallback } from 'react';

export function useTabState<T extends string>(
  defaultValue: T,
  valid: readonly T[],
  paramName: string = 'tab',
): [T, (next: T) => void] {
  const initial = (() => {
    if (typeof window === 'undefined') return defaultValue;
    const q = new URLSearchParams(window.location.search).get(paramName) as T | null;
    return q && valid.includes(q) ? q : defaultValue;
  })();

  const [tab, setTabRaw] = useState<T>(initial);

  // Reflect tab in URL (use replaceState — we don't want a history entry per click)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (tab === defaultValue) url.searchParams.delete(paramName);
    else url.searchParams.set(paramName, tab);
    window.history.replaceState({}, '', url.toString());
  }, [tab, defaultValue, paramName]);

  const setTab = useCallback((next: T) => {
    if (valid.includes(next)) setTabRaw(next);
  }, [valid]);

  return [tab, setTab];
}
