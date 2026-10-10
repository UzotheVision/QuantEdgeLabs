/**
 * Draggable column borders for the NEXUS-family layouts.
 *
 * The reference terminal's side rails are fixed-width columns; a working
 * terminal wants them draggable like an IDE split. One hook per rail:
 * drag the border to resize, double-click it to cycle default ↔ expanded,
 * width persisted per rail in localStorage so the desk layout survives
 * reloads. Pure pointer events — no drag library.
 */
import { useCallback, useRef, useState } from 'react';

export interface ColResize {
  width: number;
  /** Spread onto the handle element. */
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onDoubleClick: () => void;
  };
  dragging: boolean;
}

export function useColResize(
  storageKey: string,
  defaultWidth: number,
  opts: {
    min?: number;
    max?: number;
    /** Which way a rightward drag moves the width. A LEFT rail grows when the
     *  pointer moves right (+1); a RIGHT rail grows when it moves left (−1). */
    sign: 1 | -1;
    expanded?: number;
  },
): ColResize {
  const { min = 200, max = 640, sign, expanded = Math.round(defaultWidth * 1.55) } = opts;

  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved >= min && saved <= max) return saved;
    } catch { /* storage unavailable — default is fine */ }
    return defaultWidth;
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  const persist = (w: number) => {
    try { localStorage.setItem(storageKey, String(w)); } catch { /* ignore */ }
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startW: width };
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      if (!drag.current) return;
      const dx = (ev.clientX - drag.current.startX) * sign;
      setWidth(Math.max(min, Math.min(max, drag.current.startW + dx)));
    };
    const onUp = (ev: PointerEvent) => {
      if (drag.current) {
        const dx = (ev.clientX - drag.current.startX) * sign;
        persist(Math.max(min, Math.min(max, drag.current.startW + dx)));
      }
      drag.current = null;
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [width, min, max, sign, storageKey]);

  const onDoubleClick = useCallback(() => {
    setWidth((w) => {
      const next = Math.abs(w - defaultWidth) < 8 ? Math.min(max, expanded) : defaultWidth;
      persist(next);
      return next;
    });
  }, [defaultWidth, expanded, max, storageKey]);

  return { width, handleProps: { onPointerDown, onDoubleClick }, dragging };
}
