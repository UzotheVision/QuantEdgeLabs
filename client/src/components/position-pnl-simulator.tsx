import { useState, useMemo, useCallback, useRef } from 'react';
import { cn, formatCurrency, safeToFixed } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  TrendingUp,
  Crosshair,
  Target,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SimPosition {
  symbol: string;
  strikePrice: number;
  optionType: 'call' | 'put';
  direction: 'long' | 'short';
  quantity: number;
  avgCost: number; // cost per share (premium paid)
  expiryDate: string;
}

interface PositionPnLSimulatorProps {
  positions: SimPosition[];
  currentPrice?: number;
  symbol?: string;
}

// ─── Core P&L computation ───────────────────────────────────────────────────

/**
 * Compute aggregate at-expiry P&L for a set of option positions
 * at a given underlying price.
 */
export function computePositionPnL(
  positions: SimPosition[],
  underlyingPrice: number,
): number {
  let total = 0;
  for (const pos of positions) {
    const intrinsic =
      pos.optionType === 'call'
        ? Math.max(0, underlyingPrice - pos.strikePrice)
        : Math.max(0, pos.strikePrice - underlyingPrice);

    const pnlPerContract =
      (intrinsic - pos.avgCost) * 100; // 100 shares per contract

    const dirMultiplier = pos.direction === 'long' ? 1 : -1;
    total += pnlPerContract * pos.quantity * dirMultiplier;
  }
  return total;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function computePriceRange(positions: SimPosition[]): {
  min: number;
  max: number;
} {
  if (positions.length === 0) return { min: 80, max: 120 };
  const strikes = positions.map((p) => p.strikePrice);
  const lo = Math.min(...strikes);
  const hi = Math.max(...strikes);
  return { min: Math.floor(lo * 0.85), max: Math.ceil(hi * 1.15) };
}

function generateCurve(
  positions: SimPosition[],
  priceMin: number,
  priceMax: number,
  steps: number,
): { price: number; pnl: number }[] {
  const pts: { price: number; pnl: number }[] = [];
  const step = (priceMax - priceMin) / steps;
  for (let i = 0; i <= steps; i++) {
    const price = priceMin + step * i;
    pts.push({ price, pnl: computePositionPnL(positions, price) });
  }
  return pts;
}

function findBreakevens(
  curve: { price: number; pnl: number }[],
): number[] {
  const bkevens: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1];
    const curr = curve[i];
    // sign change across zero
    if (
      (prev.pnl <= 0 && curr.pnl >= 0) ||
      (prev.pnl >= 0 && curr.pnl <= 0)
    ) {
      // linear interpolation
      const denom = curr.pnl - prev.pnl;
      if (Math.abs(denom) < 0.001) continue;
      const t = (0 - prev.pnl) / denom;
      bkevens.push(prev.price + t * (curr.price - prev.price));
    }
  }
  return bkevens;
}

function computeMaxProfit(
  positions: SimPosition[],
  curve: { price: number; pnl: number }[],
): { value: number; isUnlimited: boolean } {
  // If any position is a short put or long call, profit can be unlimited
  // on the upside; if long put or short call, unbounded on downside.
  // For practical purposes we check whether the curve is still increasing
  // at the right edge or decreasing at the left edge.
  const last3 = curve.slice(-3);
  const first3 = curve.slice(0, 3);

  const risingAtMax =
    last3.length >= 2 &&
    last3[last3.length - 1].pnl > last3[last3.length - 2].pnl + 0.01;
  const risingAtMin =
    first3.length >= 2 && first3[0].pnl > first3[1].pnl + 0.01;

  if (risingAtMax || risingAtMin) {
    return { value: Math.max(...curve.map((p) => p.pnl)), isUnlimited: true };
  }

  return { value: Math.max(...curve.map((p) => p.pnl)), isUnlimited: false };
}

function computeMaxLoss(
  positions: SimPosition[],
  curve: { price: number; pnl: number }[],
): { value: number; isUnlimited: boolean } {
  const last3 = curve.slice(-3);
  const first3 = curve.slice(0, 3);

  const fallingAtMax =
    last3.length >= 2 &&
    last3[last3.length - 1].pnl < last3[last3.length - 2].pnl - 0.01;
  const fallingAtMin =
    first3.length >= 2 && first3[0].pnl < first3[1].pnl - 0.01;

  if (fallingAtMax || fallingAtMin) {
    return { value: Math.min(...curve.map((p) => p.pnl)), isUnlimited: true };
  }

  return { value: Math.min(...curve.map((p) => p.pnl)), isUnlimited: false };
}

// ─── SVG Chart subcomponent ─────────────────────────────────────────────────

const CHART_STEPS = 200;

interface ChartProps {
  curve: { price: number; pnl: number }[];
  strikes: number[];
  breakevens: number[];
  priceMin: number;
  priceMax: number;
  currentPrice: number | null;
  onHoverPrice: (price: number | null) => void;
}

function PnLChart({
  curve,
  strikes,
  breakevens,
  priceMin,
  priceMax,
  currentPrice,
  onHoverPrice,
}: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Layout constants inside the viewBox
  const vbW = 800;
  const vbH = 400;
  const pad = { top: 24, right: 48, bottom: 44, left: 72 };
  const plotW = vbW - pad.left - pad.right;
  const plotH = vbH - pad.top - pad.bottom;

  // Scales
  const pnlValues = curve.map((d) => d.pnl);
  const pnlMin = Math.min(...pnlValues, 0);
  const pnlMax = Math.max(...pnlValues, 0);
  const pnlPad = Math.max(Math.abs(pnlMax - pnlMin) * 0.1, 10);

  const yDomainMin = pnlMin - pnlPad;
  const yDomainMax = pnlMax + pnlPad;

  const xScale = (price: number) =>
    pad.left + ((price - priceMin) / (priceMax - priceMin)) * plotW;
  const yScale = (pnl: number) =>
    pad.top + plotH - ((pnl - yDomainMin) / (yDomainMax - yDomainMin)) * plotH;

  // Build polyline path, splitting into profit/loss segments
  const pathSegments = useMemo(() => {
    // Build one continuous polyline per green/red segment
    const segments: {
      d: string;
      color: 'profit' | 'loss';
    }[] = [];

    if (curve.length < 2) return segments;

    // We render two filled areas: one for positive and one for negative,
    // both clipped to the zero line.
    const zeroY = yScale(0);

    // Full line path
    const lineParts = curve.map(
      (pt, i) =>
        `${i === 0 ? 'M' : 'L'}${xScale(pt.price).toFixed(2)},${yScale(pt.pnl).toFixed(2)}`,
    );
    const lineD = lineParts.join(' ');

    // Positive area (clipped above zero)
    const areaAbove = [...lineParts];
    areaAbove.push(
      `L${xScale(curve[curve.length - 1].price).toFixed(2)},${zeroY.toFixed(2)}`,
    );
    areaAbove.push(`L${xScale(curve[0].price).toFixed(2)},${zeroY.toFixed(2)}Z`);

    // Negative area (clipped below zero)
    const areaBelow = [...lineParts];
    areaBelow.push(
      `L${xScale(curve[curve.length - 1].price).toFixed(2)},${zeroY.toFixed(2)}`,
    );
    areaBelow.push(`L${xScale(curve[0].price).toFixed(2)},${zeroY.toFixed(2)}Z`);

    return {
      lineD,
      areaAboveD: areaAbove.join(' '),
      areaBelowD: areaBelow.join(' '),
      zeroY,
    };
  }, [curve, priceMin, priceMax, yDomainMin, yDomainMax]);

  // Y-axis ticks
  const yTicks = useMemo(() => {
    const count = 6;
    const ticks: number[] = [];
    const step = (yDomainMax - yDomainMin) / count;
    for (let i = 0; i <= count; i++) {
      ticks.push(yDomainMin + step * i);
    }
    return ticks;
  }, [yDomainMin, yDomainMax]);

  // X-axis ticks (use strikes + a few intermediate prices)
  const xTicks = useMemo(() => {
    const count = 8;
    const step = (priceMax - priceMin) / count;
    const ticks: number[] = [];
    for (let i = 0; i <= count; i++) {
      ticks.push(priceMin + step * i);
    }
    return ticks;
  }, [priceMin, priceMax]);

  // Hover handler
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const svgFrac = mouseX / rect.width;
      const svgX = svgFrac * vbW;
      // Convert svgX to price
      const price =
        priceMin + ((svgX - pad.left) / plotW) * (priceMax - priceMin);
      if (price >= priceMin && price <= priceMax) {
        onHoverPrice(price);
      } else {
        onHoverPrice(null);
      }
    },
    [priceMin, priceMax, onHoverPrice],
  );

  const handleMouseLeave = useCallback(() => {
    onHoverPrice(null);
  }, [onHoverPrice]);

  if (!pathSegments || typeof pathSegments === 'object' && !('lineD' in pathSegments)) {
    return null;
  }

  const { lineD, areaAboveD, areaBelowD, zeroY } = pathSegments;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${vbW} ${vbH}`}
      className="w-full h-auto select-none"
      preserveAspectRatio="xMidYMid meet"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <defs>
        {/* Clip to profit region (above zero) */}
        <clipPath id="clip-above-zero">
          <rect
            x={pad.left}
            y={pad.top}
            width={plotW}
            height={Math.max(0, zeroY - pad.top)}
          />
        </clipPath>
        {/* Clip to loss region (below zero) */}
        <clipPath id="clip-below-zero">
          <rect
            x={pad.left}
            y={zeroY}
            width={plotW}
            height={Math.max(0, pad.top + plotH - zeroY)}
          />
        </clipPath>
        {/* Plot area clip */}
        <clipPath id="clip-plot">
          <rect x={pad.left} y={pad.top} width={plotW} height={plotH} />
        </clipPath>
      </defs>

      {/* Background grid */}
      {yTicks.map((tick, i) => (
        <line
          key={`grid-y-${i}`}
          x1={pad.left}
          y1={yScale(tick)}
          x2={pad.left + plotW}
          y2={yScale(tick)}
          stroke="currentColor"
          className="text-border/30"
          strokeWidth={0.5}
        />
      ))}

      {/* Zero line (dashed) */}
      {yDomainMin <= 0 && yDomainMax >= 0 && (
        <line
          x1={pad.left}
          y1={zeroY}
          x2={pad.left + plotW}
          y2={zeroY}
          stroke="currentColor"
          className="text-muted-foreground"
          strokeWidth={1}
          strokeDasharray="6,4"
        />
      )}

      {/* Strike price vertical lines */}
      {strikes.map((strike, i) => {
        const sx = xScale(strike);
        if (sx < pad.left || sx > pad.left + plotW) return null;
        return (
          <g key={`strike-${i}`}>
            <line
              x1={sx}
              y1={pad.top}
              x2={sx}
              y2={pad.top + plotH}
              stroke="#a78bfa"
              strokeWidth={1}
              strokeDasharray="4,3"
              opacity={0.5}
            />
            <text
              x={sx}
              y={pad.top - 6}
              textAnchor="middle"
              fill="#a78bfa"
              fontSize={10}
              fontFamily="monospace"
            >
              ${strike}
            </text>
          </g>
        );
      })}

      {/* Current price vertical line */}
      {currentPrice !== null && currentPrice >= priceMin && currentPrice <= priceMax && (
        <g>
          <line
            x1={xScale(currentPrice)}
            y1={pad.top}
            x2={xScale(currentPrice)}
            y2={pad.top + plotH}
            stroke="#38bdf8"
            strokeWidth={1.5}
            strokeDasharray="6,3"
          />
          <text
            x={xScale(currentPrice)}
            y={pad.top + plotH + 28}
            textAnchor="middle"
            fill="#38bdf8"
            fontSize={10}
            fontWeight="bold"
            fontFamily="monospace"
          >
            Current ${safeToFixed(currentPrice, 2)}
          </text>
        </g>
      )}

      {/* Breakeven markers */}
      {breakevens.map((be, i) => {
        const bx = xScale(be);
        if (bx < pad.left || bx > pad.left + plotW) return null;
        return (
          <g key={`be-${i}`}>
            <line
              x1={bx}
              y1={pad.top}
              x2={bx}
              y2={pad.top + plotH}
              stroke="#fbbf24"
              strokeWidth={1}
              strokeDasharray="3,3"
              opacity={0.7}
            />
            <circle
              cx={bx}
              cy={zeroY}
              r={4}
              fill="#fbbf24"
              stroke="#1e1e2e"
              strokeWidth={1.5}
            />
            <text
              x={bx}
              y={pad.top - 6}
              textAnchor="middle"
              fill="#fbbf24"
              fontSize={9}
              fontFamily="monospace"
            >
              BE ${safeToFixed(be, 2)}
            </text>
          </g>
        );
      })}

      {/* Profit fill (green, clipped above zero) */}
      <path
        d={areaAboveD}
        clipPath="url(#clip-above-zero)"
        fill="#34d399"
        fillOpacity={0.10}
      />

      {/* Loss fill (red, clipped below zero) */}
      <path
        d={areaBelowD}
        clipPath="url(#clip-below-zero)"
        fill="#f87171"
        fillOpacity={0.10}
      />

      {/* Profit portion of line (clipped above zero) */}
      <path
        d={lineD}
        clipPath="url(#clip-above-zero)"
        fill="none"
        stroke="#34d399"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Loss portion of line (clipped below zero) */}
      <path
        d={lineD}
        clipPath="url(#clip-below-zero)"
        fill="none"
        stroke="#f87171"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Y-axis labels */}
      {yTicks.map((tick, i) => (
        <text
          key={`ylab-${i}`}
          x={pad.left - 8}
          y={yScale(tick) + 3}
          textAnchor="end"
          fill="currentColor"
          className="text-muted-foreground"
          fontSize={10}
          fontFamily="monospace"
        >
          {tick >= 0 ? '' : '-'}${Math.abs(Math.round(tick)).toLocaleString()}
        </text>
      ))}

      {/* X-axis labels */}
      {xTicks.map((tick, i) => (
        <text
          key={`xlab-${i}`}
          x={xScale(tick)}
          y={pad.top + plotH + 16}
          textAnchor="middle"
          fill="currentColor"
          className="text-muted-foreground"
          fontSize={10}
          fontFamily="monospace"
        >
          ${Math.round(tick)}
        </text>
      ))}

      {/* Axis borders */}
      <line
        x1={pad.left}
        y1={pad.top}
        x2={pad.left}
        y2={pad.top + plotH}
        stroke="currentColor"
        className="text-border/50"
        strokeWidth={1}
      />
      <line
        x1={pad.left}
        y1={pad.top + plotH}
        x2={pad.left + plotW}
        y2={pad.top + plotH}
        stroke="currentColor"
        className="text-border/50"
        strokeWidth={1}
      />

      {/* Invisible hover rect */}
      <rect
        x={pad.left}
        y={pad.top}
        width={plotW}
        height={plotH}
        fill="transparent"
        style={{ cursor: 'crosshair' }}
      />
    </svg>
  );
}

// ─── Hover tooltip overlay ──────────────────────────────────────────────────

interface HoverTooltipProps {
  hoverPrice: number | null;
  positions: SimPosition[];
  priceMin: number;
  priceMax: number;
}

function HoverTooltip({
  hoverPrice,
  positions,
  priceMin,
  priceMax,
}: HoverTooltipProps) {
  if (hoverPrice === null) return null;

  const pnl = computePositionPnL(positions, hoverPrice);
  const pct =
    ((hoverPrice - priceMin) / (priceMax - priceMin)) * 100;

  // Keep tooltip from going off-edge
  const leftPct = Math.max(8, Math.min(pct, 88));

  return (
    <div
      className="absolute top-0 pointer-events-none z-10"
      style={{ left: `${leftPct}%`, transform: 'translateX(-50%)' }}
    >
      <div className="bg-card border border-border/50 rounded-lg px-3 py-2 shadow-lg">
        <div className="text-xs text-muted-foreground tabular-nums">
          ${safeToFixed(hoverPrice, 2)}
        </div>
        <div
          className={cn(
            'text-sm font-bold tabular-nums font-mono',
            pnl >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]',
          )}
        >
          {pnl >= 0 ? '+' : ''}
          {formatCurrency(pnl)}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function PositionPnLSimulator({
  positions,
  currentPrice: propCurrentPrice,
  symbol,
}: PositionPnLSimulatorProps) {
  const [priceOverride, setPriceOverride] = useState<string>(
    propCurrentPrice ? String(propCurrentPrice) : '',
  );
  const [mode] = useState<'expiry' | 'before'>('expiry');
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);

  const effectivePrice = priceOverride
    ? parseFloat(priceOverride) || null
    : propCurrentPrice ?? null;

  // Derived data
  const priceRange = useMemo(() => computePriceRange(positions), [positions]);
  const curve = useMemo(
    () =>
      generateCurve(positions, priceRange.min, priceRange.max, CHART_STEPS),
    [positions, priceRange],
  );
  const breakevens = useMemo(() => findBreakevens(curve), [curve]);
  const strikes = useMemo(
    () => Array.from(new Set(positions.map((p) => p.strikePrice))).sort((a, b) => a - b),
    [positions],
  );
  const maxProfit = useMemo(
    () => computeMaxProfit(positions, curve),
    [positions, curve],
  );
  const maxLoss = useMemo(
    () => computeMaxLoss(positions, curve),
    [positions, curve],
  );
  const projectedPnL = useMemo(
    () =>
      effectivePrice !== null
        ? computePositionPnL(positions, effectivePrice)
        : null,
    [positions, effectivePrice],
  );

  // Quick-adjust buttons
  const handleQuickAdjust = useCallback(
    (pct: number) => {
      const base = effectivePrice ?? (priceRange.min + priceRange.max) / 2;
      const newPrice = base * (1 + pct / 100);
      setPriceOverride(safeToFixed(newPrice, 2));
    },
    [effectivePrice, priceRange],
  );

  const handleCurrentClick = useCallback(() => {
    if (propCurrentPrice) {
      setPriceOverride(safeToFixed(propCurrentPrice, 2));
    }
  }, [propCurrentPrice]);

  // Empty state
  if (positions.length === 0) {
    return (
      <Card className="bg-white/5 border border-border/30 rounded-xl">
        <CardContent className="p-8 text-center">
          <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Add option positions to visualize the P&L curve
          </p>
        </CardContent>
      </Card>
    );
  }

  const displaySymbol =
    symbol || positions[0]?.symbol || 'Underlying';

  return (
    <Card className="bg-white/5 border border-border/30 rounded-xl overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-purple-400" />
            P&L Simulator
            <Badge
              variant="outline"
              className="ml-1 text-[10px] border-purple-500/30 text-purple-400"
            >
              {displaySymbol}
            </Badge>
          </CardTitle>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px]',
              mode === 'expiry'
                ? 'border-emerald-500/30 text-[var(--trade-bullish)]'
                : 'border-amber-500/30 text-amber-400',
            )}
          >
            {mode === 'expiry' ? 'At Expiry' : 'Before Expiry'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Controls panel ────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[140px]">
            <Label
              htmlFor="sim-price"
              className="text-xs text-muted-foreground mb-1 block"
            >
              Underlying Price
            </Label>
            <Input
              id="sim-price"
              type="number"
              step="0.01"
              placeholder={
                propCurrentPrice
                  ? `Current: $${safeToFixed(propCurrentPrice, 2)}`
                  : 'Enter price...'
              }
              value={priceOverride}
              onChange={(e) => setPriceOverride(e.target.value)}
              className="font-mono tabular-nums h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-1">
            {[-10, -5].map((pct) => (
              <Button
                key={pct}
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs font-mono text-[var(--trade-bearish)] border-border/50 hover:border-red-500/40 hover:bg-red-500/10"
                onClick={() => handleQuickAdjust(pct)}
              >
                {pct}%
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs font-mono text-sky-400 border-border/50 hover:border-sky-500/40 hover:bg-sky-500/10"
              onClick={handleCurrentClick}
              disabled={!propCurrentPrice}
            >
              Current
            </Button>
            {[5, 10].map((pct) => (
              <Button
                key={pct}
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs font-mono text-[var(--trade-bullish)] border-border/50 hover:border-emerald-500/40 hover:bg-emerald-500/10"
                onClick={() => handleQuickAdjust(pct)}
              >
                +{pct}%
              </Button>
            ))}
          </div>
        </div>

        {/* ── SVG chart with hover overlay ──────────────────────────── */}
        <div className="relative rounded-lg bg-black/20 border border-border/20 p-2">
          <HoverTooltip
            hoverPrice={hoverPrice}
            positions={positions}
            priceMin={priceRange.min}
            priceMax={priceRange.max}
          />
          <PnLChart
            curve={curve}
            strikes={strikes}
            breakevens={breakevens}
            priceMin={priceRange.min}
            priceMax={priceRange.max}
            currentPrice={effectivePrice}
            onHoverPrice={setHoverPrice}
          />
          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-emerald-400 rounded" />
              Profit
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-red-400 rounded" />
              Loss
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-purple-400 rounded opacity-50" style={{ borderTop: '1px dashed' }} />
              Strikes
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
              Breakeven
            </span>
            {effectivePrice !== null && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-sky-400 rounded" />
                Current
              </span>
            )}
          </div>
        </div>

        {/* ── Summary cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {/* Max Profit */}
          <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
            <div className="flex items-center gap-1.5 mb-1">
              <ArrowUpRight className="h-3.5 w-3.5 text-[var(--trade-bullish)]" />
              <span className="text-xs text-muted-foreground">Max Profit</span>
            </div>
            <div className="text-sm font-bold font-mono tabular-nums text-[var(--trade-bullish)]">
              {maxProfit.isUnlimited ? (
                <span className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  Unlimited
                </span>
              ) : (
                `+${formatCurrency(maxProfit.value)}`
              )}
            </div>
          </div>

          {/* Max Loss */}
          <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
            <div className="flex items-center gap-1.5 mb-1">
              <ArrowDownRight className="h-3.5 w-3.5 text-[var(--trade-bearish)]" />
              <span className="text-xs text-muted-foreground">Max Loss</span>
            </div>
            <div className="text-sm font-bold font-mono tabular-nums text-[var(--trade-bearish)]">
              {maxLoss.isUnlimited ? (
                <span className="flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3" />
                  Unlimited
                </span>
              ) : (
                formatCurrency(maxLoss.value)
              )}
            </div>
          </div>

          {/* Breakeven */}
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <div className="flex items-center gap-1.5 mb-1">
              <Crosshair className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs text-muted-foreground">
                Breakeven{breakevens.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="text-sm font-bold font-mono tabular-nums text-amber-400">
              {breakevens.length === 0
                ? '--'
                : breakevens
                    .map((be) => `$${safeToFixed(be, 2)}`)
                    .join(', ')}
            </div>
          </div>

          {/* Projected P&L */}
          <div
            className={cn(
              'p-3 rounded-lg border',
              projectedPnL !== null && projectedPnL >= 0
                ? 'bg-emerald-500/5 border-emerald-500/20'
                : projectedPnL !== null
                  ? 'bg-red-500/5 border-red-500/20'
                  : 'bg-muted/5 border-border/30',
            )}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Target className="h-3.5 w-3.5 text-sky-400" />
              <span className="text-xs text-muted-foreground">
                Projected P&L
              </span>
            </div>
            <div
              className={cn(
                'text-sm font-bold font-mono tabular-nums',
                projectedPnL === null
                  ? 'text-muted-foreground'
                  : projectedPnL >= 0
                    ? 'text-[var(--trade-bullish)]'
                    : 'text-[var(--trade-bearish)]',
              )}
            >
              {projectedPnL === null ? (
                '--'
              ) : (
                <>
                  {projectedPnL >= 0 ? '+' : ''}
                  {formatCurrency(projectedPnL)}
                </>
              )}
            </div>
            {effectivePrice !== null && (
              <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                @ ${safeToFixed(effectivePrice, 2)}
              </div>
            )}
          </div>
        </div>

        {/* ── Position breakdown ────────────────────────────────────── */}
        <div className="rounded-lg border border-border/20 overflow-hidden">
          <div className="px-3 py-2 bg-muted/20 border-b border-border/20">
            <span className="text-xs font-medium text-muted-foreground">
              Positions ({positions.length})
            </span>
          </div>
          <div className="divide-y divide-border/10">
            {positions.map((pos, i) => {
              const perContractPnL =
                effectivePrice !== null
                  ? (() => {
                      const intrinsic =
                        pos.optionType === 'call'
                          ? Math.max(0, effectivePrice - pos.strikePrice)
                          : Math.max(0, pos.strikePrice - effectivePrice);
                      const raw = (intrinsic - pos.avgCost) * 100;
                      return raw * pos.quantity * (pos.direction === 'long' ? 1 : -1);
                    })()
                  : null;

              return (
                <div
                  key={i}
                  className="flex items-center justify-between px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] py-0 px-1.5',
                        pos.direction === 'long'
                          ? 'border-emerald-500/30 text-[var(--trade-bullish)]'
                          : 'border-red-500/30 text-[var(--trade-bearish)]',
                      )}
                    >
                      {pos.direction.toUpperCase()}
                    </Badge>
                    <span className="font-mono text-foreground">
                      {pos.quantity}x{' '}
                      <span className="text-muted-foreground">
                        ${pos.strikePrice}
                      </span>{' '}
                      <span
                        className={cn(
                          pos.optionType === 'call'
                            ? 'text-[var(--trade-bullish)]'
                            : 'text-[var(--trade-bearish)]',
                        )}
                      >
                        {pos.optionType.toUpperCase()}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      @ ${safeToFixed(pos.avgCost, 2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {pos.expiryDate}
                    </span>
                    {perContractPnL !== null && (
                      <span
                        className={cn(
                          'font-mono font-medium tabular-nums',
                          perContractPnL >= 0
                            ? 'text-[var(--trade-bullish)]'
                            : 'text-[var(--trade-bearish)]',
                        )}
                      >
                        {perContractPnL >= 0 ? '+' : ''}
                        {formatCurrency(perContractPnL)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
