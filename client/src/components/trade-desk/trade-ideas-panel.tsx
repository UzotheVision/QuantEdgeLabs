/**
 * TradeIdeasPanel — the new Trade Desk grid
 * ==========================================
 * Combines:
 *   - TradePresets (one-tap loadouts)
 *   - TradeFiltersBar (chip-based filters)
 *   - ViewModeToggle (cards / compact / table / focus)
 *   - TradeIdeaCard (3 variants)
 *   - IdeaDetailDrawer (slide-out detail with Convictions tab)
 *
 * Data sources merged client-side:
 *   GET /api/trade-ideas/best-setups        — full idea list
 *   GET /api/convictions                    — confluence scores + layers + bands
 *
 * The merge attaches conviction enrichment to matching ideas by symbol+direction.
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Inbox, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

import {
  TradeIdeaCard,
  TradeIdeaCardData,
  TradeIdeaRowHeader,
} from "./trade-idea-card";
import { ViewModeToggle, ViewMode } from "./view-mode-toggle";
import {
  TradeFiltersBar,
  TradeFilters,
  loadFilters,
  applyFilters,
  DEFAULT_FILTERS,
} from "./trade-filters-bar";
import { TradePresets, TRADE_PRESETS, TradePreset } from "./trade-presets";
import { IdeaDetailDrawer } from "./idea-detail-drawer";
import {
  matchesAssetFilter,
  type PageAssetFilter,
} from "@/lib/trade-desk-filters";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface BestSetupsResponse {
  period: string;
  count: number;
  totalOpen: number;
  setups: any[];
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

export function normalizeIdea(raw: any): TradeIdeaCardData {
  const dir = (raw.direction ?? "").toString().toLowerCase();
  const isLong = dir === "long" || dir === "buy" || dir === "call";
  return {
    id: raw.id,
    symbol: raw.symbol,
    direction: isLong ? "long" : "short",
    entryPrice: Number(raw.entryPrice) || 0,
    targetPrice: Number(raw.targetPrice) || 0,
    stopLoss: Number(raw.stopLoss) || 0,
    riskRewardRatio: Number(raw.riskRewardRatio) || 0,
    confidenceScore: Number(raw.confidenceScore) || 0,
    probabilityBand: raw.probabilityBand,
    catalyst: raw.catalyst,
    source: raw.source ?? raw.dataSourceUsed,
    assetType: raw.assetType ?? null,
    holdingPeriod: raw.holdingPeriod,
    livePrice: raw.livePrice ?? null,
    priceStale: raw.priceStale,
    optionType: raw.optionType,
    strikePrice: raw.strikePrice ? Number(raw.strikePrice) : null,
    expiryDate: raw.expiryDate,
    entryPremium: raw.entryPremium != null ? Number(raw.entryPremium) : null,
    optionDelta: raw.optionDelta != null ? Number(raw.optionDelta) : null,
    optionGamma: raw.optionGamma != null ? Number(raw.optionGamma) : null,
    optionTheta: raw.optionTheta != null ? Number(raw.optionTheta) : null,
    optionVega: raw.optionVega != null ? Number(raw.optionVega) : null,
    optionIV: raw.optionIV != null ? Number(raw.optionIV) : null,
    optionOpenInterest: raw.optionOpenInterest != null ? Number(raw.optionOpenInterest) : null,
    optionVolume: raw.optionVolume != null ? Number(raw.optionVolume) : null,
    expiryTier: raw.expiryTier ?? null,
    optionDte: raw.optionDte != null ? Number(raw.optionDte) : null,
    generatedAt: raw.timestamp,
    sector: raw.sector,
    // Conviction enrichment (now populated server-side via best-setups H1+H7)
    convictionScore: typeof raw.convictionScore === "number" ? raw.convictionScore : undefined,
    convictionBand: raw.convictionBand ?? undefined,
    layers: Array.isArray(raw.layers) ? raw.layers : undefined,
    thesis: raw.thesis,
    // Phase 1 freshness annotations
    ageHours: typeof raw.ageHours === "number" ? raw.ageHours : null,
    driftPct: typeof raw.driftPct === "number" ? raw.driftPct : null,
    currentPrice: typeof raw.currentPrice === "number" ? raw.currentPrice : null,
    freshnessFlags: Array.isArray(raw.freshnessFlags) ? raw.freshnessFlags : [],
  };
}

function sortIdeas(ideas: TradeIdeaCardData[]): TradeIdeaCardData[] {
  return [...ideas].sort((a, b) => {
    const aScore = a.convictionScore ?? a.confidenceScore ?? 0;
    const bScore = b.convictionScore ?? b.confidenceScore ?? 0;
    return bScore - aScore;
  });
}

function readPresetFromUrl(search: string): TradePreset | null {
  const params = new URLSearchParams(search);
  const id = params.get("preset");
  if (!id) return null;
  return TRADE_PRESETS.find((p) => p.id === id) ?? null;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export function TradeIdeasPanel({
  className,
  drawerIdea: controlledDrawerIdea,
  drawerOpen: controlledDrawerOpen,
  onDrawerChange,
  externalAssetFilter,
  watchlistSymbols,
}: {
  className?: string;
  /**
   * Controlled drawer state. When onDrawerChange is provided (Trade Desk
   * page), the panel defers to it so the sidebar "Top Conviction" rows and
   * the Today's Picks "All" tab can open the SAME drawer — one detail
   * surface for the whole page. Without it the panel keeps internal state.
   */
  drawerIdea?: TradeIdeaCardData | null;
  drawerOpen?: boolean;
  onDrawerChange?: (idea: TradeIdeaCardData | null, open: boolean) => void;
  /** Page-level asset filter, applied on top of the panel's own filters. */
  externalAssetFilter?: PageAssetFilter;
  watchlistSymbols?: Set<string>;
}) {
  // ── State ──
  const [filters, setFilters] = useState<TradeFilters>(() => {
    if (typeof window !== "undefined") {
      const urlPreset = readPresetFromUrl(window.location.search);
      if (urlPreset) return urlPreset.filters;
    }
    return loadFilters();
  });
  const [activePresetId, setActivePresetId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const urlPreset = readPresetFromUrl(window.location.search);
      if (urlPreset) return urlPreset.id;
    }
    return null;
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // Phase 4: compact is the default grid density; a stored preference
    // still wins for returning users.
    if (typeof window === "undefined") return "compact";
    return (
      (window.localStorage.getItem("qe.tradedesk.viewMode") as ViewMode) ??
      "compact"
    );
  });
  const [internalSelectedIdea, setInternalSelectedIdea] =
    useState<TradeIdeaCardData | null>(null);
  const [internalDrawerOpen, setInternalDrawerOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  // Phase 4: one drawer for the page — controlled when the parent passes
  // onDrawerChange, internal otherwise.
  const isDrawerControlled = typeof onDrawerChange === "function";
  const selectedIdea = isDrawerControlled
    ? (controlledDrawerIdea ?? null)
    : internalSelectedIdea;
  const drawerOpen = isDrawerControlled
    ? (controlledDrawerOpen ?? false)
    : internalDrawerOpen;

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("qe.tradedesk.viewMode", viewMode);
    }
  }, [viewMode]);

  // Reset preset highlight when filters drift
  useEffect(() => {
    if (!activePresetId) return;
    const preset = TRADE_PRESETS.find((p) => p.id === activePresetId);
    if (!preset) return;
    const matches =
      JSON.stringify({ ...filters, search: "" }) ===
      JSON.stringify({ ...preset.filters, search: "" });
    if (!matches) setActivePresetId(null);
  }, [filters, activePresetId]);

  // ── Data fetching ──
  // Single source of truth: /api/trade-ideas/best-setups now returns ideas
  // already enriched with convictionScore / convictionBand / layers from
  // the shared convictions cache (see server/routes.ts H1+H7 fix). The
  // previous second fetch to /api/convictions was redundant — both
  // endpoints read from the same cached snapshot.
  const {
    data: setupsData,
    isLoading: setupsLoading,
  } = useQuery<BestSetupsResponse>({
    queryKey: ["/api/trade-ideas/best-setups", "weekly-all"],
    queryFn: async () => {
      // Use period=weekly (3-day window) instead of daily (24h). The 24h
      // window was cutting valid swing setups that the convictions engine
      // still considers active. Filtering for "today only" happens client-
      // side via the freshness layer + age penalties.
      const res = await fetch(
        "/api/trade-ideas/best-setups?period=weekly&limit=500&status=open&watchlistOnly=true",
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // ── Derived state ──
  const allIdeas = useMemo(() => {
    const raw = setupsData?.setups ?? [];
    const normalized = raw.map(normalizeIdea);
    return sortIdeas(normalized);
  }, [setupsData]);

  const filteredIdeas = useMemo(() => {
    const base = applyFilters(allIdeas as any, filters) as TradeIdeaCardData[];
    if (!externalAssetFilter || externalAssetFilter === "all") return base;
    return base.filter((idea) =>
      matchesAssetFilter(idea, externalAssetFilter, watchlistSymbols),
    );
  }, [allIdeas, filters, externalAssetFilter, watchlistSymbols]);

  // Phase 4: compact default grid is capped at ~30 visible with "Show more".
  const [visibleCount, setVisibleCount] = useState(30);
  useEffect(() => {
    setVisibleCount(30);
  }, [filters, externalAssetFilter]);
  const visibleIdeas = useMemo(
    () => filteredIdeas.slice(0, visibleCount),
    [filteredIdeas, visibleCount],
  );

  // ── Handlers ──
  const handlePresetSelect = (preset: TradePreset) => {
    setFilters(preset.filters);
    setActivePresetId(preset.id);
  };

  const handleCardClick = (idea: TradeIdeaCardData) => {
    if (isDrawerControlled) {
      onDrawerChange!(idea, true);
    } else {
      setInternalSelectedIdea(idea);
      setInternalDrawerOpen(true);
    }
  };

  const handleDrawerOpenChange = (open: boolean) => {
    if (isDrawerControlled) {
      onDrawerChange!(open ? selectedIdea : null, open);
    } else {
      setInternalDrawerOpen(open);
    }
  };

  // ── Focus mode keyboard nav ──
  useEffect(() => {
    if (viewMode !== "focus") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setFocusIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight")
        setFocusIndex((i) => Math.min(visibleIdeas.length - 1, i + 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode, visibleIdeas.length]);

  useEffect(() => {
    if (focusIndex >= visibleIdeas.length) setFocusIndex(0);
  }, [visibleIdeas.length, focusIndex]);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  return (
    <div className={cn("space-y-3", className)}>
      {/* Presets row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <TradePresets
          activePresetId={activePresetId}
          onSelect={handlePresetSelect}
        />
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </div>

      {/* Filters bar */}
      <TradeFiltersBar
        filters={filters}
        onChange={setFilters}
        resultCount={filteredIdeas.length}
        totalCount={allIdeas.length}
      />

      {/* Body */}
      {setupsLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-[11px] font-mono uppercase tracking-wider">
            Loading ideas
          </span>
        </div>
      ) : filteredIdeas.length === 0 ? (
        <EmptyState
          totalCount={allIdeas.length}
          allIdeas={allIdeas}
          filters={filters}
          onReset={() => setFilters(DEFAULT_FILTERS)}
          onRelax={(patch) => setFilters({ ...filters, ...patch })}
        />
      ) : (
        <>
          {viewMode === "cards" && <CardsGrid ideas={visibleIdeas} onClick={handleCardClick} />}
          {viewMode === "compact" && <CompactGrid ideas={visibleIdeas} onClick={handleCardClick} />}
          {viewMode === "table" && <TableView ideas={visibleIdeas} onClick={handleCardClick} />}
          {viewMode === "focus" && (
            <FocusView
              ideas={visibleIdeas}
              index={focusIndex}
              onIndexChange={setFocusIndex}
              onOpenDetail={handleCardClick}
            />
          )}
          {visibleCount < filteredIdeas.length && (
            <div className="flex justify-center pt-1">
              <button
                onClick={() => setVisibleCount((c) => c + 30)}
                className="px-4 py-1.5 rounded-md border border-foreground/10 text-muted-foreground hover:text-foreground hover:border-foreground/25 text-[10px] font-mono uppercase tracking-wider transition-colors"
              >
                Show more ({filteredIdeas.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}

      {/* Detail drawer. In controlled mode the parent (Trade Desk page)
          renders the single page-level drawer — the panel must not render a
          second one. Standalone use keeps its own internal drawer. */}
      {!isDrawerControlled && (
        <IdeaDetailDrawer
          idea={selectedIdea}
          open={drawerOpen}
          onOpenChange={handleDrawerOpenChange}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// View modes
// ─────────────────────────────────────────────────────────────

function CardsGrid({
  ideas,
  onClick,
}: {
  ideas: TradeIdeaCardData[];
  onClick: (idea: TradeIdeaCardData) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {ideas.map((idea) => (
        <TradeIdeaCard
          key={idea.id ?? `${idea.symbol}-${idea.direction}`}
          idea={idea}
          variant="full"
          onClick={() => onClick(idea)}
        />
      ))}
    </div>
  );
}

function CompactGrid({
  ideas,
  onClick,
}: {
  ideas: TradeIdeaCardData[];
  onClick: (idea: TradeIdeaCardData) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
      {ideas.map((idea) => (
        <TradeIdeaCard
          key={idea.id ?? `${idea.symbol}-${idea.direction}`}
          idea={idea}
          variant="compact"
          onClick={() => onClick(idea)}
        />
      ))}
    </div>
  );
}

function TableView({
  ideas,
  onClick,
}: {
  ideas: TradeIdeaCardData[];
  onClick: (idea: TradeIdeaCardData) => void;
}) {
  // Collapse duplicate-ticker rows: group by symbol, keep the leader (already
  // sorted best-first by sortIdeas), roll the rest into an expandable group.
  // A ticker can carry several confluent setups — one line proves there are
  // multiple, the chevron reveals each.
  const groups = useMemo(() => {
    const map = new Map<string, TradeIdeaCardData[]>();
    for (const idea of ideas) {
      const key = idea.symbol;
      const bucket = map.get(key);
      if (bucket) bucket.push(idea);
      else map.set(key, [idea]);
    }
    // Preserve the incoming (sorted) order via the first-seen leader.
    return Array.from(map.values());
  }, [ideas]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (sym: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });

  return (
    <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] overflow-hidden">
      <TradeIdeaRowHeader />
      <div className="divide-y divide-foreground/[0.04]">
        {groups.map((bucket) => {
          const leader = bucket[0];
          const extra = bucket.length - 1;
          const isOpen = expanded.has(leader.symbol);
          return (
            <div key={leader.symbol}>
              <TradeIdeaCard
                idea={leader}
                variant="row"
                onClick={() => onClick(leader)}
                groupCount={extra}
                expanded={isOpen}
                onToggleGroup={() => toggle(leader.symbol)}
                className="rounded-none border-0 border-b border-foreground/[0.04] last:border-b-0"
              />
              {isOpen &&
                bucket.slice(1).map((child) => (
                  <TradeIdeaCard
                    key={child.id ?? `${child.symbol}-${child.direction}-${child.entryPrice}`}
                    idea={child}
                    variant="row"
                    onClick={() => onClick(child)}
                    isChild
                    className="rounded-none border-0 border-b border-foreground/[0.04] last:border-b-0 bg-foreground/[0.015]"
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FocusView({
  ideas,
  index,
  onIndexChange,
  onOpenDetail,
}: {
  ideas: TradeIdeaCardData[];
  index: number;
  onIndexChange: (i: number) => void;
  onOpenDetail: (idea: TradeIdeaCardData) => void;
}) {
  const idea = ideas[index];
  if (!idea) return null;

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <span>
          {index + 1} / {ideas.length}
        </span>
        <span className="opacity-50">·</span>
        <span>← → to navigate</span>
      </div>

      <div className="flex items-center gap-3 w-full max-w-2xl">
        <button
          onClick={() => onIndexChange(Math.max(0, index - 1))}
          disabled={index === 0}
          className="p-2 rounded-md border border-foreground/10 text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-30"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex-1">
          <TradeIdeaCard idea={idea} variant="full" onClick={() => onOpenDetail(idea)} />
        </div>

        <button
          onClick={() => onIndexChange(Math.min(ideas.length - 1, index + 1))}
          disabled={index === ideas.length - 1}
          className="p-2 rounded-md border border-foreground/10 text-muted-foreground hover:text-foreground hover:border-foreground/20 disabled:opacity-30"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────

/**
 * Probe each filter dimension by relaxing it (one at a time, all others
 * unchanged) and counting how many ideas become visible. The dimension that
 * unlocks the most ideas is the bottleneck — show that as the suggestion.
 */
function diagnoseFilters(
  allIdeas: TradeIdeaCardData[],
  filters: TradeFilters,
): Array<{
  key: keyof TradeFilters;
  label: string;
  patch: Partial<TradeFilters>;
  unlocked: number;
}> {
  const probes: Array<{
    key: keyof TradeFilters;
    label: string;
    patch: Partial<TradeFilters>;
  }> = [
    { key: "band", label: "Band → All", patch: { band: "all" } },
    { key: "rr", label: "R:R → Any", patch: { rr: "any" } },
    { key: "hold", label: "Hold → All", patch: { hold: "all" } },
    { key: "side", label: "Side → Both", patch: { side: "both" } },
    { key: "asset", label: "Asset → Both", patch: { asset: "both" } },
  ];
  if (filters.sources.length > 0) {
    probes.push({ key: "sources", label: "Source → Clear", patch: { sources: [] } });
  }
  if (filters.search) {
    probes.push({ key: "search", label: "Clear Search", patch: { search: "" } });
  }

  const baseline = applyFilters(allIdeas as any, filters).length;
  return probes
    .map((p) => {
      const next = { ...filters, ...p.patch };
      const count = applyFilters(allIdeas as any, next).length;
      return { ...p, unlocked: Math.max(0, count - baseline) };
    })
    .filter((p) => p.unlocked > 0)
    .sort((a, b) => b.unlocked - a.unlocked);
}

function EmptyState({
  totalCount,
  allIdeas,
  filters,
  onReset,
  onRelax,
}: {
  totalCount: number;
  allIdeas: TradeIdeaCardData[];
  filters: TradeFilters;
  onReset: () => void;
  onRelax: (patch: Partial<TradeFilters>) => void;
}) {
  const suggestions = useMemo(
    () => diagnoseFilters(allIdeas, filters).slice(0, 3),
    [allIdeas, filters],
  );

  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Inbox className="w-10 h-10 mb-3 opacity-30" />
      <p className="text-[12px] font-mono uppercase tracking-wider">
        No ideas match your filters
      </p>
      {totalCount > 0 && (
        <p className="text-[10px] mt-1 opacity-70">
          {totalCount} ideas hidden
        </p>
      )}

      {suggestions.length > 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="text-[9px] font-mono uppercase tracking-wider opacity-60">
            Try relaxing one filter:
          </p>
          <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-md">
            {suggestions.map((s) => (
              <button
                key={s.key as string}
                onClick={() => onRelax(s.patch)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-500/30 text-[var(--trade-bullish)] hover:bg-emerald-500/10 text-[10px] font-mono uppercase tracking-wider"
                data-testid={`empty-relax-${s.key}`}
              >
                <span>{s.label}</span>
                <span className="opacity-60">+{s.unlocked}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[10px] mt-2 opacity-60">
          The data set itself is empty — generate fresh ideas above.
        </p>
      )}

      <button
        onClick={onReset}
        className="mt-4 px-3 py-1.5 rounded-md border border-sky-500/30 text-sky-300 hover:bg-sky-500/10 text-[10px] font-mono uppercase tracking-wider"
      >
        Reset All Filters
      </button>
    </div>
  );
}
