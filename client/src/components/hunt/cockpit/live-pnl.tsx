/**
 * LivePnl — a P&L figure that visibly moves when it changes.
 *
 * The bot marks positions to market continuously (see paper-trading-service
 * updatePositionPrices), but the cockpit re-rendered the new number in place,
 * so a position going from −$50 to +$1,650 looked identical to one that had
 * not moved. The information was arriving and not landing.
 *
 * Two things make a change legible: the digits ROLL to the new value rather
 * than snapping, and the row flashes in the direction of travel — green up,
 * red down — then fades. Both are brief; this sits beside fifteen other rows
 * and must not become a light show.
 *
 * Honours prefers-reduced-motion: the value still updates, it just arrives
 * immediately with no roll and no flash.
 */
import { useEffect, useRef, useState } from 'react';

const REDUCED = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function LivePnl({ value, className = '' }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prev = useRef(value);
  const raf = useRef<number>();

  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = to;
    if (from === to) return;

    setFlash(to > from ? 'up' : 'down');
    const flashTimer = setTimeout(() => setFlash(null), 900);

    if (REDUCED) {
      setShown(to);
      return () => clearTimeout(flashTimer);
    }

    // Roll the digits over ~600ms, eased so it decelerates into the value.
    const start = performance.now();
    const DUR = 600;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DUR);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (to - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    return () => {
      clearTimeout(flashTimer);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value]);

  const positive = shown >= 0;
  const color = positive ? 'var(--trade-bullish)' : 'var(--trade-bearish)';

  return (
    <span
      className={`relative inline-block tabular-nums transition-colors duration-300 ${className}`}
      style={{
        color,
        // The flash tints the glyphs themselves rather than adding a
        // background, so the row's own surface stays quiet.
        textShadow: flash ? `0 0 12px ${flash === 'up' ? 'var(--trade-bullish)' : 'var(--trade-bearish)'}` : 'none',
      }}
      title={`${positive ? '+' : '−'}$${Math.abs(value).toFixed(2)} unrealised`}
    >
      {positive ? '+' : '−'}${Math.abs(Math.round(shown)).toLocaleString()}
      {flash && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-2.5 top-1/2 -translate-y-1/2 text-[9px] font-bold leading-none"
          style={{ color, opacity: 0.9 }}
        >
          {flash === 'up' ? '▲' : '▼'}
        </span>
      )}
    </span>
  );
}
