/**
 * Pre-Market Gappers Card
 * =======================
 * Surfaces overnight movers from the user's weekly watchlist + approved
 * tickers, sorted by absolute gap %. Used as a leading direction signal
 * before the open.
 *
 * Auto-refreshes every 60s. Shows weekly watchlist gappers with a star.
 *
 * Phase 4: data fetching extracted to usePremarketGappers so the Today's
 * Picks tabs can read the count without a second network call (same query
 * key → shared React Query cache). A `bare` prop renders the list without
 * the outer card / collapse toggle for embedding in tabs.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Star, Sparkles, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Gapper {
  symbol: string;
  price: number;
  previousClose: number;
  gapPct: number;
  direction: "up" | "down" | "flat";
  phase: "pre_market" | "regular" | "post_market" | "closed";
  isWeekly: boolean;
}

export interface GappersResponse {
  phase: "pre_market" | "regular" | "post_market" | "closed";
  scanned: number;
  gappers: Gapper[];
  generatedAt: string;
}

/** Shared fetch for pre-market gappers — same query key wherever used. */
export function usePremarketGappers() {
  return useQuery<GappersResponse>({
    queryKey: ["/api/premarket/gappers"],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

const PHASE_LABEL: Record<GappersResponse["phase"], string> = {
  pre_market: "Overnight Movers",
  regular: "Opening Gappers",
  post_market: "After-Hours Movers",
  closed: "Today's Biggest Movers",
};

const PHASE_HINT: Record<GappersResponse["phase"], string> = {
  pre_market: "Pre-market price vs. yesterday's close",
  regular: "Today's open vs. yesterday's close",
  post_market: "After-hours price vs. regular close",
  closed: "Most recent session change vs. prior close",
};

function GapperRow({ g }: { g: Gapper }) {
  const isUp = g.direction === "up";
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <Link href={`/r/${g.symbol}`}>
      <div
        className={cn(
          "flex items-center justify-between text-xs px-2 py-1.5 rounded border cursor-pointer transition-colors",
          g.isWeekly
            ? "bg-amber-500/5 border-amber-500/30 hover:bg-amber-500/10"
            : "border-border/40 hover:bg-muted/40",
        )}
        data-testid={`gapper-${g.symbol}`}
      >
        <div className="flex items-center gap-2">
          {g.isWeekly && (
            <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
          )}
          <span className="font-mono font-semibold">{g.symbol}</span>
          <span className="text-muted-foreground font-mono">
            ${g.price.toFixed(2)}
          </span>
        </div>
        <div
          className={cn(
            "flex items-center gap-1 font-mono font-semibold tabular-nums",
            isUp ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]",
          )}
        >
          <Icon className="h-3 w-3" />
          {g.gapPct >= 0 ? "+" : ""}
          {g.gapPct.toFixed(2)}%
        </div>
      </div>
    </Link>
  );
}

export default function PreMarketGappersCard({
  defaultExpanded = false,
  bare = false,
}: {
  defaultExpanded?: boolean;
  /** Render the list without the outer card / collapse toggle — for tabs. */
  bare?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(bare ? false : !defaultExpanded);
  const { data, isLoading, isError } = usePremarketGappers();

  if (isLoading) {
    const inner = <div className="text-xs text-muted-foreground">Loading pre-market gappers…</div>;
    return bare ? <div>{inner}</div> : <Card className="p-3">{inner}</Card>;
  }

  if (isError || !data) {
    const inner = <div className="text-xs text-muted-foreground">Pre-market data unavailable</div>;
    return bare ? <div>{inner}</div> : <Card className="p-3">{inner}</Card>;
  }

  const top = data.gappers.slice(0, 12);

  const headerRow = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-amber-400" />
        <h3
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          title={PHASE_HINT[data.phase]}
        >
          {PHASE_LABEL[data.phase]}
        </h3>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] h-5">
          {data.gappers.length} / {data.scanned}
        </Badge>
        {!bare && (
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", !collapsed && "rotate-180")} />
        )}
      </div>
    </div>
  );

  const list = top.length === 0 ? (
    <div className="text-xs text-muted-foreground py-2">
      No significant overnight gaps in your universe.
    </div>
  ) : (
    <div className="space-y-1">
      {top.map((g) => (
        <GapperRow key={g.symbol} g={g} />
      ))}
    </div>
  );

  if (bare) {
    return (
      <div className="space-y-2" data-testid="card-premarket-gappers">
        {headerRow}
        <div className="text-[10px] text-muted-foreground leading-tight">
          {PHASE_HINT[data.phase]}
        </div>
        {list}
      </div>
    );
  }

  return (
    <Card className="p-3 space-y-2" data-testid="card-premarket-gappers">
      <button
        className="flex items-center justify-between w-full text-left"
        onClick={() => setCollapsed(!collapsed)}
      >
        {headerRow}
      </button>

      {!collapsed && (
        <>
          <div className="text-[10px] text-muted-foreground leading-tight">
            {PHASE_HINT[data.phase]}
          </div>
          {list}
        </>
      )}
    </Card>
  );
}
