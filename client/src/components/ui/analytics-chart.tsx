/**
 * QuantEdge analytics charting standard.
 *
 * ONE standard, three lanes — do not add a fourth:
 *  - Price action  → <NexusPriceChart> (components/charting/nexus-price-chart.tsx),
 *    the bespoke canvas OHLCV engine. Already the unified price surface.
 *  - Analytics     → recharts behind the components in THIS file.
 *  - lightweight-charts → legacy, only in pages/backtest.tsx. Do not adopt elsewhere.
 *
 * Why this wrapper exists: the 12 recharts consumers each hand-styled colors
 * inline (raw hex, raw hsl, Tailwind cyan), so "brand cyan" rendered as three
 * different colors across the app. Everything below is wired to the token
 * store (index.css brand/trade vars), so a retheme in Phase 4 is a
 * token change, not a 12-file hunt.
 */

import * as React from "react";
import { CartesianGrid, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "./chart";

/** Semantic + categorical ramp, wired to the token store. */
export const CHART_COLORS = {
  /** Brand accent — the one cyan. */
  accent: "var(--brand-cyan, #3b8cff)",
  /** Directional up / healthy. Use ONLY for direction or P&L. */
  bull: "var(--trade-bullish, #6E9E7A)",
  /** Directional down / unhealthy. Use ONLY for direction or P&L. */
  bear: "var(--trade-bearish, #B5705F)",
  /** Neutral highlight / warning / "attention". */
  gold: "var(--trade-neutral, #F59E0B)",
  /** Categorical extras, in ramp order. */
  purple: "#A78BFA",
  blue: "#60A5FA",
  pink: "#EC4899",
  orange: "#F97316",
  /** De-emphasized / axis-adjacent. */
  slate: "var(--muted-foreground, #8B98A8)",
} as const;

/** Ordered ramp for multi-series / pie / donut charts. */
export const CHART_RAMP = [
  CHART_COLORS.accent,
  CHART_COLORS.gold,
  CHART_COLORS.purple,
  CHART_COLORS.blue,
  CHART_COLORS.pink,
  CHART_COLORS.orange,
  CHART_COLORS.bull,
  CHART_COLORS.bear,
] as const;

export type { ChartConfig };

/**
 * Themed recharts container. Thin layer over ui/chart's ChartContainer —
 * sizing comes from the caller's className (unchanged from before).
 */
export function AnalyticsChart({
  config,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  // Single chart element, matching ResponsiveContainer's children contract.
  children: React.ReactElement;
}) {
  return (
    <ChartContainer config={config} className={cn("w-full", className)} {...props}>
      {children}
    </ChartContainer>
  );
}

/** Themed tooltip — cursor and panel follow the app theme. */
export function AnalyticsTooltip(
  props: Omit<React.ComponentProps<typeof ChartTooltip>, "formatter"> & {
    // Recharts' Formatter<ValueType, NameType> generic doesn't survive
    // ComponentProps indirection; `any` keeps call-site formatters working.
    formatter?: (value: any, name: any, props: any) => React.ReactNode;
  }
) {
  return (
    <ChartTooltip
      cursor={{ stroke: "hsl(var(--border))" }}
      content={<ChartTooltipContent />}
      {...props}
    />
  );
}

/** Pre-styled axes: muted ticks, no tick lines, no axis line. */
export function AnalyticsXAxis(props: React.ComponentProps<typeof XAxis>) {
  return (
    <XAxis
      tickLine={false}
      axisLine={false}
      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
      dy={8}
      {...props}
    />
  );
}

export function AnalyticsYAxis(props: React.ComponentProps<typeof YAxis>) {
  return (
    <YAxis
      tickLine={false}
      axisLine={false}
      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
      width={44}
      {...props}
    />
  );
}

/** Horizontal-only grid on the border token. */
export function AnalyticsGrid(
  props: React.ComponentProps<typeof CartesianGrid>
) {
  return (
    <CartesianGrid
      stroke="hsl(var(--border))"
      strokeDasharray="3 3"
      vertical={false}
      {...props}
    />
  );
}

/**
 * Vertical fade for area charts. Render inside the chart's <defs>:
 *   <defs><AnalyticsGradient id="g" color={CHART_COLORS.accent} /></defs>
 * then fill={`url(#g)`} on the Area.
 */
export function AnalyticsGradient({
  id,
  color,
  from = 0.35,
  to = 0,
}: {
  id: string;
  color: string;
  from?: number;
  to?: number;
}) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={from} />
      <stop offset="100%" stopColor={color} stopOpacity={to} />
    </linearGradient>
  );
}
