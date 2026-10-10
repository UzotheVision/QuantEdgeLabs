import { cn } from "@/lib/utils"

/**
 * QuantEdge Skeleton System
 * =========================
 * Base Skeleton + composable presets for consistent loading states.
 * Uses skeleton-shimmer keyframes from index.css for a professional sweep effect.
 */

// Base skeleton — shimmering placeholder bar
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md bg-white/[0.04] skeleton-native",
        className
      )}
      {...props}
    />
  )
}

// Multiple text lines with decreasing widths
function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  const widths = ["100%", "85%", "60%", "75%", "50%"];
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: widths[i % widths.length] }}
        />
      ))}
    </div>
  );
}

// Card-shaped skeleton matching QEPanel dark surface
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg bg-[#0c1219]/80 border border-white/[0.06] p-4 space-y-3",
        className
      )}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
      {/* Body lines */}
      <div className="space-y-2">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-3/4" />
      </div>
      {/* Footer stat row */}
      <div className="flex items-center gap-3 pt-1">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-12" />
        <Skeleton className="h-2.5 w-20" />
      </div>
    </div>
  );
}

// Single stat metric skeleton (label + large value + subtitle)
function SkeletonStat({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Skeleton className="h-2.5 w-16" />
      <Skeleton className="h-6 w-24" />
      <Skeleton className="h-2 w-12" />
    </div>
  );
}

// Table skeleton with header + body rows
function SkeletonTable({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {/* Header */}
      <div className="flex items-center gap-4 pb-2 border-b border-white/[0.06]">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1" />
        ))}
      </div>
      {/* Body rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-4 py-1.5">
          {Array.from({ length: cols }).map((_, col) => (
            <Skeleton
              key={col}
              className="h-3 flex-1"
              style={{ opacity: 0.7 + (row % 3) * 0.1 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Trade idea card skeleton (matches trade-desk card layout)
function SkeletonTradeIdea({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg bg-[#0c1219]/80 border border-white/[0.06] p-3.5 space-y-2.5",
        className
      )}
    >
      {/* Symbol + direction badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-14 rounded" />
          <Skeleton className="h-5 w-10 rounded-full" />
        </div>
        <Skeleton className="h-5 w-5 rounded-sm" />
      </div>
      {/* Confidence bar */}
      <Skeleton className="h-1.5 w-full rounded-full" />
      {/* Price levels */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-16" />
      </div>
    </div>
  );
}

// Market ticker item skeleton
function SkeletonTicker({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Skeleton className="h-3.5 w-10" />
      <Skeleton className="h-3.5 w-16" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

export {
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonStat,
  SkeletonTable,
  SkeletonTradeIdea,
  SkeletonTicker,
}
