/**
 * USER PREFERENCES — the operator asked (2026-09-24) for "utmost power for
 * configurations, designing and arrangements, especially those cards,
 * collapsing features and more". One store, saved on the device, read by the
 * terminal, the NEXUS board and every page in the shared frame.
 *
 * Defaults are the calm, readable design; everything is reversible from the
 * Customize panel ("Reset to defaults").
 */
import { useSyncExternalStore } from 'react';

export type TextSize = 'm' | 'l' | 'xl';
export type Density = 'comfortable' | 'compact';
export type CardPart = 'thesis' | 'chart' | 'status' | 'actions' | 'progress' | 'evidence' | 'note' | 'levels' | 'foot';

export const CARD_PARTS: { id: CardPart; label: string; hint: string }[] = [
  { id: 'thesis',   label: 'Setup line',      hint: 'Direction, style and the one-line thesis' },
  { id: 'chart',    label: 'Mini chart',      hint: 'Recent price path' },
  { id: 'status',   label: 'Status',          hint: 'Pending trigger / live, and time used' },
  { id: 'actions',  label: 'Action buttons',  hint: 'Workup · Watch · Bot check' },
  { id: 'progress', label: 'Progress to T1',  hint: 'How far price has travelled toward the first target' },
  { id: 'evidence', label: 'Evidence chips',  hint: 'Points from each scoring layer' },
  { id: 'note',     label: 'Counter-evidence', hint: 'What argues against the idea' },
  { id: 'levels',   label: 'Levels',          hint: 'Entry · stop · T1 · R:R · P&L' },
  { id: 'foot',     label: 'Footer',          hint: 'Days to expiry and sector' },
];

/** Board rail panels, in their default order. */
export const LEFT_PANELS = [
  { id: 'radar', label: 'Pattern radar' }, { id: 'pulse', label: 'Market pulse' }, { id: 'quad', label: 'Rotation map' },
  { id: 'prints', label: 'Flow prints' }, { id: 'brief', label: 'Session brief' },
] as const;
export const RIGHT_PANELS = [
  { id: 'dev', label: 'Candidate field' }, { id: 'heat', label: 'Sector heatmap' }, { id: 'watch', label: 'Watchlist' },
] as const;

export interface BoardPrefs {
  calm: boolean;
  textSize: TextSize;
  density: Density;
  columns: 'auto' | '1' | '2' | '3';
  card: Record<CardPart, boolean>;
  phoneCount: number; // 0 = all
  order: { left: string[]; right: string[] };
}

export const DEFAULT_PREFS: BoardPrefs = {
  calm: true,
  textSize: 'm',
  density: 'comfortable',
  columns: 'auto',
  card: { thesis: true, chart: true, status: true, actions: true, progress: true, evidence: true, note: true, levels: true, foot: true },
  phoneCount: 6,
  order: { left: LEFT_PANELS.map((p) => p.id), right: RIGHT_PANELS.map((p) => p.id) },
};

const KEY = 'qe-board-prefs-v1';
function read(): BoardPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT_PREFS, ...raw, card: { ...DEFAULT_PREFS.card, ...(raw.card || {}) }, order: { ...DEFAULT_PREFS.order, ...(raw.order || {}) } };
  } catch { return DEFAULT_PREFS; }
}
let state: BoardPrefs = typeof window === 'undefined' ? DEFAULT_PREFS : read();
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); applyGlobal(state); }

export function setPrefs(patch: Partial<BoardPrefs> | ((p: BoardPrefs) => Partial<BoardPrefs>)) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
  emit();
}
export function resetPrefs() { state = DEFAULT_PREFS; try { localStorage.removeItem(KEY); } catch { /* */ } emit(); }

export function usePrefs(): BoardPrefs {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state, () => state);
}

/** Text size and calm mode apply to the whole app, so they live on <html>. */
export function applyGlobal(p: BoardPrefs = state) {
  if (typeof document === 'undefined') return;
  const h = document.documentElement;
  h.classList.toggle('qe-text-l', p.textSize === 'l');
  h.classList.toggle('qe-text-xl', p.textSize === 'xl');
  h.classList.toggle('qe-calm', p.calm);
}
if (typeof window !== 'undefined') applyGlobal(state);

/** Move a panel up/down within its rail. */
export function movePanel(rail: 'left' | 'right', id: string, dir: -1 | 1) {
  setPrefs((p) => {
    const arr = [...p.order[rail]];
    const i = arr.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return {};
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { order: { ...p.order, [rail]: arr } };
  });
}
export const orderOf = (p: BoardPrefs, rail: 'left' | 'right', id: string) => {
  const i = p.order[rail].indexOf(id); return i < 0 ? 50 : i;
};
