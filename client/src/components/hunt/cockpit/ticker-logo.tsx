/**
 * TickerLogo — real company/crypto logo with graceful initials fallback.
 * Walks getLogoSources() (DuckDuckGo → Google faviconV2 → CoinGecko for crypto)
 * and only falls back to a tinted initials chip once every source 404s. This is
 * the "favicon" detail that makes rows feel premium.
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { getLogoSources, getSymbolInitials } from '@/lib/stock-logos';

const SIZE = {
  sm: 'w-6 h-6 text-[9px]',
  md: 'w-8 h-8 text-[11px]',
  lg: 'w-10 h-10 text-xs',
} as const;

export function TickerLogo({
  symbol,
  size = 'md',
  className,
}: {
  symbol: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const sources = getLogoSources(symbol);
  const [srcIdx, setSrcIdx] = useState(0);
  const sizeCls = SIZE[size];
  const exhausted = srcIdx >= sources.length;

  if (exhausted) {
    return (
      <div
        className={cn(
          'shrink-0 rounded-lg flex items-center justify-center font-mono font-bold',
          'bg-foreground/[0.06] text-foreground/70',
          sizeCls,
          className,
        )}
      >
        {getSymbolInitials(symbol)}
      </div>
    );
  }

  return (
    <img
      key={sources[srcIdx]}
      src={sources[srcIdx]}
      alt={symbol}
      className={cn('shrink-0 rounded-lg object-contain', sizeCls, className)}
      loading="lazy"
      onError={() => setSrcIdx((i) => i + 1)}
    />
  );
}
