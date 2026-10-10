/**
 * TodaysPicks — Phase 4: one "Today's Picks" surface.
 * ===================================================
 * Collapses the five stacked Trade Desk panels (Ideas, Discovery, Gappers,
 * GEX, Flow Import) into a single card with tabs — one tab per source plus
 * an "All" tab that merges the idea-bearing sources and dedupes cross-source
 * by symbol+assetType+optionType (the same grouping key trade-desk.tsx uses
 * in deduplicateOnly), keeping the highest-confidence entry.
 *
 * Data fetching is NOT rewritten: each tab renders the existing panel in
 * `bare` mode, and the fetch hooks are shared (same React Query keys), so
 * tabs and the All tab read from one cached result each.
 *
 * The "All" tab merges Ideas + Discovery. GEX Big Gainers is a track-record
 * surface (peak/realized gains, no confidence score or stop), Gappers are
 * movers without trade structure, and Flow Import is a tool — none of them
 * normalize honestly into a scored pick card, so they stay tab-only.
 *
 * One legend dialog on the card explains the grade / conviction-band / score
 * system using the canonical helpers from @/lib/conviction-display.
 * One detail surface: card clicks open the shared IdeaDetailDrawer via the
 * controlled drawer props (the drawer itself lives at page level).
 */

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { QETabs, type QETabItem } from "@/components/ui/qe-tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Info } from "lucide-react";
import type { TradeIdea } from "@shared/schema";

import { TradeIdeasPanel, normalizeIdea } from "./trade-ideas-panel";
import { TradeIdeaCard, type TradeIdeaCardData } from "./trade-idea-card";
import {
  DiscoveryPicksPanel,
  useDiscoveryPicks,
  type RawIdea,
} from "./DiscoveryPicksPanel";
import PreMarketGappersCard, { usePremarketGappers } from "./PreMarketGappersCard";
import { FlowImport } from "./flow-import";
import { GexBigGainers, useGexBigGainers } from "@/components/gex-big-gainers";
import {
  matchesAssetFilter,
  type PageAssetFilter,
} from "@/lib/trade-desk-filters";
import {
  gradeColorClass,
  type LetterGrade,
} from "@/lib/conviction-display";

export type PicksTabId = "all" | "ideas" | "discovery" | "gappers" | "gex" | "flow";

export interface TodaysPicksProps {
  /** Page-level deduplicated ideas (NOT asset-filtered — the card applies assetFilter itself). */
  ideas: TradeIdea[];
  assetFilter: PageAssetFilter;
  watchlistSymbols: Set<string>;
  /** Controlled drawer — shared with the page so sidebar "Top Conviction"
   *  rows and pick cards open the same drawer. */
  drawerIdea: TradeIdeaCardData | null;
  drawerOpen: boolean;
  onDrawerChange: (idea: TradeIdeaCardData | null, open: boolean) => void;
}

// ─────────────────────────────────────────────────────────────
// Normalization for the All tab
// ─────────────────────────────────────────────────────────────

function ideaScore(i: TradeIdeaCardData): number {
  return i.convictionScore ?? i.confidenceScore ?? 0;
}

function normalizeDiscoveryIdea(raw: RawIdea): TradeIdeaCardData {
  const dir = (raw.direction || "").toLowerCase();
  return {
    id: raw.id,
    symbol: raw.symbol,
    direction: dir === "short" ? "short" : "long",
    entryPrice: Number(raw.entryPrice) || 0,
    targetPrice: Number(raw.targetPrice) || 0,
    stopLoss: Number(raw.stopLoss) || 0,
    riskRewardRatio: Number(raw.riskRewardRatio) || 0,
    confidenceScore: Number(raw.confidenceScore) || 0,
    catalyst: raw.catalyst,
    source: raw.source || "quant_signal",
    assetType: raw.assetType || null,
    optionType: (raw.optionType as "call" | "put" | undefined) || null,
    strikePrice: raw.strikePrice ?? null,
    expiryDate: raw.expiryDate,
    generatedAt: raw.timestamp,
  };
}

// ─────────────────────────────────────────────────────────────
// Legend — one for the whole page, on the Today's Picks card
// ─────────────────────────────────────────────────────────────

const GRADE_ROWS: Array<{ grades: LetterGrade[]; cutoff: string; band: string }> = [
  { grades: ["A+", "A", "A-"], cutoff: "42+ · 36+ · 30+", band: "S" },
  { grades: ["B+", "B", "B-"], cutoff: "26+ · 22+ · 18+", band: "A" },
  { grades: ["C+", "C", "C-"], cutoff: "15+ · 12+ · 9+", band: "B" },
  { grades: ["D+", "D", "D-", "F"], cutoff: "6+ · 3+ · 1+ · 0", band: "C" },
];

function LegendDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title="How picks are scored"
        >
          <Info className="w-3.5 h-3.5" />
          <span className="text-[10px] font-mono uppercase tracking-wider hidden sm:inline">
            Legend
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">How picks are scored</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
          <p>
            <span className="text-foreground font-medium">Score</span> —{" "}
            <span className="font-mono text-[11px]">displayedScore</span>: the
            13-layer conviction score (0–60) when the idea is enriched by the
            convictions engine, otherwise the scanner&apos;s 0–100 confidence.
          </p>
          <p>
            <span className="text-foreground font-medium">Band</span> —{" "}
            <span className="font-mono text-[11px]">displayedBand</span>:
            engine cutoffs <span className="font-mono">S ≥ 30 · A ≥ 22 · B ≥ 15 · C &lt; 15</span>.
            Falls back to the legacy probability band (A+/A/A- → A, …).
          </p>
          <div>
            <p className="mb-1.5">
              <span className="text-foreground font-medium">Grade</span> —{" "}
              <span className="font-mono text-[11px]">displayedGrade</span>:
              letter grade cut from the same score the list sorts on.
            </p>
            <div className="space-y-1">
              {GRADE_ROWS.map((row) => (
                <div key={row.band} className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {row.grades.map((g) => (
                      <span
                        key={g}
                        className={`text-[10px] font-mono font-bold leading-none px-1 py-0.5 rounded border tabular-nums ${gradeColorClass(g)}`}
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                  <span className="font-mono text-[10px] tabular-nums">{row.cutoff}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {row.band} band
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p>
            <span className="text-foreground font-medium">Top Conviction</span> —{" "}
            <span className="font-mono text-[11px]">isHighConviction</span>: S/A
            band (or legacy A+/A/A-) feeds the sidebar&apos;s Top Conviction list.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

const ALL_TAB_CAP = 30;

export function TodaysPicks({
  ideas,
  assetFilter,
  watchlistSymbols,
  drawerIdea,
  drawerOpen,
  onDrawerChange,
}: TodaysPicksProps) {
  const [tab, setTab] = useState<PicksTabId>("all");

  // Shared fetches — same query keys the panels use, so no duplicate calls.
  const discovery = useDiscoveryPicks("quant_signal", 12);
  const gappers = usePremarketGappers();
  const gex = useGexBigGainers();

  // All tab: merge Ideas + Discovery, dedupe by symbol+assetType+optionType,
  // keep the highest-confidence entry, sort best-first.
  const mergedIdeas = useMemo(() => {
    const byKey = new Map<string, TradeIdeaCardData>();
    const consider = (idea: TradeIdeaCardData) => {
      const key = `${idea.symbol}:${idea.assetType || "stock"}:${idea.optionType || ""}`;
      const cur = byKey.get(key);
      if (!cur || ideaScore(idea) > ideaScore(cur)) byKey.set(key, idea);
    };
    ideas.forEach((raw) => consider(normalizeIdea(raw)));
    (discovery.data?.ideas ?? []).forEach((raw) => consider(normalizeDiscoveryIdea(raw)));
    return [...byKey.values()].sort((a, b) => ideaScore(b) - ideaScore(a));
  }, [ideas, discovery.data]);

  const visibleMerged = useMemo(
    () =>
      mergedIdeas.filter((i) => matchesAssetFilter(i, assetFilter, watchlistSymbols)),
    [mergedIdeas, assetFilter, watchlistSymbols],
  );

  const [allVisibleCount, setAllVisibleCount] = useState(ALL_TAB_CAP);
  useEffect(() => {
    setAllVisibleCount(ALL_TAB_CAP);
  }, [assetFilter, tab]);
  const shownAll = visibleMerged.slice(0, allVisibleCount);

  const tabItems: QETabItem<PicksTabId>[] = [
    {
      id: "all",
      label: "All",
      count: visibleMerged.length,
      hint: "Best picks across every engine, deduplicated",
    },
    {
      id: "ideas",
      label: "Ideas",
      hint: "Engine ideas — filters, presets and view modes",
    },
    {
      id: "discovery",
      label: "Discovery",
      count: discovery.data?.ideas?.length ?? 0,
      hint: "Auto-pushed from the convergence engine",
    },
    {
      id: "gappers",
      label: "Gappers",
      count: gappers.data?.gappers.length ?? 0,
      hint: "Overnight / session movers",
    },
    {
      id: "gex",
      label: "GEX",
      count: (gex.data?.live.length ?? 0) + (gex.data?.closed.length ?? 0),
      hint: "GEX scanner plays running hot",
    },
    {
      id: "flow",
      label: "Flow Import",
      hint: "Paste Bullflow alerts for engine grading",
    },
  ];

  return (
    <Card className="p-3 sm:p-4 space-y-3" data-testid="todays-picks">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-foreground tracking-tight">
          Today&apos;s Picks
        </h2>
        <QETabs<PicksTabId>
          items={tabItems}
          active={tab}
          onChange={setTab}
          variant="subtle"
          size="sm"
          rightSlot={<LegendDialog />}
        />
      </div>

      {tab === "all" && (
        <div className="space-y-2">
          {visibleMerged.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              No picks match the current filter.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {shownAll.map((idea) => (
                <TradeIdeaCard
                  key={idea.id ?? `${idea.symbol}-${idea.direction}-${idea.optionType || ""}`}
                  idea={idea}
                  variant="compact"
                  onClick={() => onDrawerChange(idea, true)}
                />
              ))}
            </div>
          )}
          {allVisibleCount < visibleMerged.length && (
            <div className="flex justify-center pt-1">
              <button
                onClick={() => setAllVisibleCount((c) => c + ALL_TAB_CAP)}
                className="px-4 py-1.5 rounded-md border border-foreground/10 text-muted-foreground hover:text-foreground hover:border-foreground/25 text-[10px] font-mono uppercase tracking-wider transition-colors"
              >
                Show more ({visibleMerged.length - allVisibleCount} remaining)
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "ideas" && (
        <TradeIdeasPanel
          drawerIdea={drawerIdea}
          drawerOpen={drawerOpen}
          onDrawerChange={onDrawerChange}
          externalAssetFilter={assetFilter}
          watchlistSymbols={watchlistSymbols}
        />
      )}

      {tab === "discovery" && (
        <DiscoveryPicksPanel
          bare
          maxItems={12}
          assetFilter={assetFilter}
          watchlistSymbols={watchlistSymbols}
        />
      )}

      {tab === "gappers" && <PreMarketGappersCard bare />}

      {tab === "gex" && <GexBigGainers bare compact />}

      {tab === "flow" && <FlowImport bare />}
    </Card>
  );
}
