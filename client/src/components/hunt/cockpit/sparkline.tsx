/**
 * Sparkline — tiny real-data area line for list rows. Fetches 5d/1d closes.
 * Renders nothing (a thin dash) when there's no data — never a fake curve.
 */
import { Area, AreaChart, YAxis } from 'recharts';
import { usePriceHistory } from './use-price-history';
import { AnalyticsChart, AnalyticsGradient } from '@/components/ui/analytics-chart';

export function Sparkline({
  symbol,
  tone = 'bull',
  width = 96,
  height = 30,
}: {
  symbol: string;
  tone?: 'bull' | 'bear' | 'neutral';
  width?: number | string;
  height?: number;
}) {
  const { points } = usePriceHistory(symbol, '5d', '1d');
  const color =
    tone === 'bull' ? 'var(--trade-bullish)'
    : tone === 'bear' ? 'var(--trade-bearish)'
    : 'var(--brand-cyan)';

  if (points.length < 2) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-end"
      >
        <div className="w-full border-t border-dashed border-border/40" />
      </div>
    );
  }

  const gid = `spark-${symbol}-${tone}`;
  const lows = points.map((p) => p.close);
  const min = Math.min(...lows);
  const max = Math.max(...lows);

  return (
    <div style={{ width, height }}>
      <AnalyticsChart config={{}} className="h-full w-full">
        <AreaChart data={points} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <defs>
            <AnalyticsGradient id={gid} color={color} />
          </defs>
          <YAxis hide domain={[min, max]} />
          <Area
            type="monotone"
            dataKey="close"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gid})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </AnalyticsChart>
    </div>
  );
}
