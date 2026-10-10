/**
 * TradeFiltersBar — chip-based filter controls for Trade Desk
 * =============================================================
 * Single-tap chips, no dropdowns. Persists to localStorage.
 *
 * Categories:
 *   Band:    S | A+ | B+ | All     (default A+)
 *   Side:    Long | Short | Both   (default Both)
 *   Hold:    Day | Swing | Pos     (default All)
 *   Asset:   Stock | Option | Both (default Both)
 *   R:R:     1.5+ | 2+ | 3+ | Any  (default 2+)
 *   Source:  Squeeze | Breakout | Momentum | GEX | Earnings (multi-select, optional)
 */

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Search, X } from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Filter state shape
// ─────────────────────────────────────────────────────────────

export interface TradeFilters {
  band: "S" | "A+" | "B+" | "all";
  side: "long" | "short" | "both";
  hold: "day" | "swing" | "position" | "all";
  asset: "stock" | "option" | "both";
  rr: "1.5+" | "2+" | "3+" | "any";
  sources: string[];
  search: string;
}

export const DEFAULT_FILTERS: TradeFilters = {
  band: "A+",
  side: "both",
  hold: "all",
  asset: "both",
  rr: "2+",
  sources: [],
  search: "",
};

const STORAGE_KEY = "qe.tradedesk.filters.v2";

export function loadFilters(): TradeFilters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFilters(filters: TradeFilters): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // ignore
  }
}

// ─────────────────────────────────────────────────────────────
// Chip primitive
// ─────────────────────────────────────────────────────────────

function Chip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-all border",
        active
          ? "bg-sky-500/15 text-sky-300 border-sky-500/30"
          : "bg-foreground/[0.02] text-muted-foreground border-foreground/10 hover:text-foreground hover:border-foreground/20",
      )}
    >
      {children}
    </button>
  );
}

function ChipGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mr-0.5">
        {label}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

const SOURCE_OPTIONS = [
  { id: "squeeze", label: "Squeeze" },
  { id: "breakout", label: "Breakout" },
  { id: "momentum", label: "Momentum" },
  { id: "gex", label: "GEX" },
  { id: "earnings", label: "Earnings" },
];

interface Props {
  filters: TradeFilters;
  onChange: (next: TradeFilters) => void;
  resultCount?: number;
  totalCount?: number;
  className?: string;
}

export function TradeFiltersBar({
  filters,
  onChange,
  resultCount,
  totalCount,
  className,
}: Props) {
  // Persist on change
  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  const update = <K extends keyof TradeFilters>(key: K, value: TradeFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const toggleSource = (id: string) => {
    const next = filters.sources.includes(id)
      ? filters.sources.filter((s) => s !== id)
      : [...filters.sources, id];
    update("sources", next);
  };

  const isFiltered =
    JSON.stringify({ ...filters, search: "" }) !==
    JSON.stringify({ ...DEFAULT_FILTERS, search: "" });

  return (
    <div
      className={cn(
        "rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3",
        className,
      )}
    >
      {/* Top row: search + result count + clear */}
      <div className="flex items-center gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 rounded border border-foreground/10 bg-foreground/[0.02]">
          <Search className="w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search symbol..."
            value={filters.search}
            onChange={(e) => update("search", e.target.value.toUpperCase())}
            className="flex-1 bg-transparent text-[11px] font-mono outline-none placeholder:text-muted-foreground text-foreground"
            data-testid="filter-search"
          />
          {filters.search && (
            <button
              onClick={() => update("search", "")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {typeof resultCount === "number" && typeof totalCount === "number" && (
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums whitespace-nowrap">
            {resultCount} / {totalCount}
          </span>
        )}

        {isFiltered && (
          <button
            onClick={() => onChange({ ...DEFAULT_FILTERS, search: filters.search })}
            data-testid="filter-clear"
            className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-sky-300 px-2 py-1 border border-foreground/10 rounded hover:border-sky-500/30"
          >
            Clear
          </button>
        )}
      </div>

      {/* Chip rows */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ChipGroup label="Band">
          <Chip active={filters.band === "S"} onClick={() => update("band", "S")} testId="band-s">
            S
          </Chip>
          <Chip active={filters.band === "A+"} onClick={() => update("band", "A+")} testId="band-a">
            A+
          </Chip>
          <Chip active={filters.band === "B+"} onClick={() => update("band", "B+")} testId="band-b">
            B+
          </Chip>
          <Chip active={filters.band === "all"} onClick={() => update("band", "all")} testId="band-all">
            All
          </Chip>
        </ChipGroup>

        <ChipGroup label="Side">
          <Chip active={filters.side === "long"} onClick={() => update("side", "long")}>
            Long
          </Chip>
          <Chip active={filters.side === "short"} onClick={() => update("side", "short")}>
            Short
          </Chip>
          <Chip active={filters.side === "both"} onClick={() => update("side", "both")}>
            Both
          </Chip>
        </ChipGroup>

        <ChipGroup label="Hold">
          <Chip active={filters.hold === "day"} onClick={() => update("hold", "day")}>
            Day
          </Chip>
          <Chip active={filters.hold === "swing"} onClick={() => update("hold", "swing")}>
            Swing
          </Chip>
          <Chip active={filters.hold === "position"} onClick={() => update("hold", "position")}>
            Pos
          </Chip>
          <Chip active={filters.hold === "all"} onClick={() => update("hold", "all")}>
            All
          </Chip>
        </ChipGroup>

        <ChipGroup label="Asset">
          <Chip active={filters.asset === "stock"} onClick={() => update("asset", "stock")}>
            Stock
          </Chip>
          <Chip active={filters.asset === "option"} onClick={() => update("asset", "option")}>
            Option
          </Chip>
          <Chip active={filters.asset === "both"} onClick={() => update("asset", "both")}>
            Both
          </Chip>
        </ChipGroup>

        <ChipGroup label="R:R">
          <Chip active={filters.rr === "1.5+"} onClick={() => update("rr", "1.5+")}>
            1.5+
          </Chip>
          <Chip active={filters.rr === "2+"} onClick={() => update("rr", "2+")}>
            2+
          </Chip>
          <Chip active={filters.rr === "3+"} onClick={() => update("rr", "3+")}>
            3+
          </Chip>
          <Chip active={filters.rr === "any"} onClick={() => update("rr", "any")}>
            Any
          </Chip>
        </ChipGroup>

        <ChipGroup label="Source">
          {SOURCE_OPTIONS.map((src) => (
            <Chip
              key={src.id}
              active={filters.sources.includes(src.id)}
              onClick={() => toggleSource(src.id)}
            >
              {src.label}
            </Chip>
          ))}
        </ChipGroup>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Apply filters to a list of ideas
// ─────────────────────────────────────────────────────────────

export function applyFilters<
  T extends {
    symbol: string;
    direction: string;
    holdingPeriod?: string | null;
    optionType?: string | null;
    riskRewardRatio?: number | null;
    convictionBand?: "S" | "A" | "B" | "C" | null;
    probabilityBand?: string | null;
    source?: string | null;
  },
>(ideas: T[], filters: TradeFilters): T[] {
  return ideas.filter((idea) => {
    // Search
    if (filters.search && !idea.symbol.toUpperCase().includes(filters.search.toUpperCase())) {
      return false;
    }

    // Band
    if (filters.band !== "all") {
      const band =
        idea.convictionBand ??
        (idea.probabilityBand?.startsWith("A")
          ? "A"
          : idea.probabilityBand?.startsWith("B")
            ? "B"
            : idea.probabilityBand?.startsWith("C")
              ? "C"
              : null);
      if (filters.band === "S" && band !== "S") return false;
      if (filters.band === "A+" && band !== "S" && band !== "A") return false;
      if (filters.band === "B+" && band !== "S" && band !== "A" && band !== "B") return false;
    }

    // Side
    if (filters.side !== "both") {
      const dir = idea.direction.toLowerCase();
      const isLong = dir === "long" || dir === "buy" || dir === "call";
      if (filters.side === "long" && !isLong) return false;
      if (filters.side === "short" && isLong) return false;
    }

    // Hold
    if (filters.hold !== "all") {
      const hp = (idea.holdingPeriod ?? "").toLowerCase();
      if (filters.hold === "day" && hp !== "day") return false;
      if (filters.hold === "swing" && hp !== "swing") return false;
      if (filters.hold === "position" && hp !== "position") return false;
    }

    // Asset
    if (filters.asset !== "both") {
      const isOption = !!idea.optionType;
      if (filters.asset === "option" && !isOption) return false;
      if (filters.asset === "stock" && isOption) return false;
    }

    // R:R
    if (filters.rr !== "any") {
      const rr = idea.riskRewardRatio ?? 0;
      const min = filters.rr === "1.5+" ? 1.5 : filters.rr === "2+" ? 2.0 : 3.0;
      if (rr < min) return false;
    }

    // Source
    if (filters.sources.length > 0) {
      const src = (idea.source ?? "").toLowerCase();
      const matched = filters.sources.some((s) => src.includes(s));
      if (!matched) return false;
    }

    return true;
  });
}
