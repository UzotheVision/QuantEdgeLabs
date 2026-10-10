/**
 * TradeIdeaCard — unified card for the new Trade Desk
 * ====================================================
 * Three variants render the same idea at different densities:
 *   - "full"    : convictions-style hero card (band-tinted, layer pills, option strip)
 *   - "compact" : 4-col grid card with 1-line layer summary
 *   - "row"     : single dense table row (50-names-in-30-seconds view)
 *
 * The card understands optional conviction enrichment (score, band, layers)
 * and falls back gracefully when those fields are missing — ideas from the
 * stock universe without confluence scoring still render cleanly as B/C tier.
 */

import {
  ArrowUpRight,
  ArrowDownRight,
  Target,
  Activity,
  ExternalLink,
  Crosshair,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { displayedScore, displayedGrade, gradeColorClass } from "@/lib/conviction-display";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type ConvictionLayerKind =
  | "technical"
  | "convergence"
  | "catalyst"
  | "regime"
  | "breadth"
  | "geopolitical"
  | "fundamental"
  | "analyst"
  | "sector"
  | "freshness"
  | "weekly"
  | "premarket"
  | "gex";

export interface ConvictionLayer {
  kind: ConvictionLayerKind;
  label: string;
  points: number;
  why: string;
}

export interface TradeIdeaCardData {
  id?: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  riskRewardRatio: number;
  confidenceScore: number;

  // Optional context
  probabilityBand?: string;
  catalyst?: string;
  source?: string;
  /** Asset class of the idea (stock | option | crypto | future | penny_stock). Used by the page-level asset filter. */
  assetType?: string | null;
  holdingPeriod?: string;
  livePrice?: number | null;
  priceStale?: boolean;

  // Options play — full contract readout (strike/expiry/premium/greeks/OI/vol)
  optionType?: "call" | "put" | null;
  strikePrice?: number | null;
  expiryDate?: string | null;
  entryPremium?: number | null;
  optionDelta?: number | null;
  optionGamma?: number | null;
  optionTheta?: number | null;
  optionVega?: number | null;
  optionIV?: number | null;
  optionOpenInterest?: number | null;
  optionVolume?: number | null;
  expiryTier?: "0DTE" | "DAILY" | "WEEKLY" | "MONTHLY" | "LEAP" | null;
  optionDte?: number | null;

  // Conviction enrichment (from /api/convictions or /api/trade-ideas?conviction=high)
  convictionScore?: number | null;
  convictionBand?: "S" | "A" | "B" | "C" | null;
  layers?: ConvictionLayer[];
  thesis?: string;

  // Phase 1 freshness annotations from /api/trade-ideas/best-setups
  // (server-side revalidation against live price + age caps)
  ageHours?: number | null;
  driftPct?: number | null;
  currentPrice?: number | null;
  freshnessFlags?: string[];

  // Meta
  generatedAt?: string;
  timestamp?: string;
  sector?: string;
}

export type TradeIdeaCardVariant = "full" | "compact" | "row";

export interface TradeIdeaCardProps {
  idea: TradeIdeaCardData;
  variant?: TradeIdeaCardVariant;
  onClick?: () => void;
  className?: string;
  "data-testid"?: string;
  /** Row-variant grouping: number of additional setups rolled up under this ticker (0 = none). */
  groupCount?: number;
  /** Whether this group is currently expanded (only meaningful when groupCount > 0). */
  expanded?: boolean;
  /** Toggle handler for the group chevron. When provided, clicking the chevron calls this instead of onClick. */
  onToggleGroup?: () => void;
  /** Marks this row as a child of an expanded group (indented, dimmer). */
  isChild?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Style tables
// ─────────────────────────────────────────────────────────────

export const LAYER_STYLES: Record<
  ConvictionLayerKind,
  { icon: string; color: string; bg: string; border: string }
> = {
  technical: {
    icon: "TECH",
    color: "text-sky-400",
    bg: "bg-sky-500/10",
    border: "border-sky-500/20",
  },
  convergence: {
    icon: "CONV",
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
  },
  catalyst: {
    icon: "CTLY",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  regime: {
    icon: "RGME",
    color: "text-[var(--trade-bullish)]",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  breadth: {
    icon: "BRDH",
    color: "text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/20",
  },
  geopolitical: {
    icon: "GEO",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
  },
  fundamental: {
    icon: "FUND",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  analyst: {
    icon: "ANLY",
    color: "text-indigo-400",
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/20",
  },
  sector: {
    icon: "SECT",
    color: "text-pink-400",
    bg: "bg-pink-500/10",
    border: "border-pink-500/20",
  },
  freshness: {
    icon: "FRSH",
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
  },
  weekly: {
    icon: "WEEK",
    color: "text-yellow-300",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
  },
  premarket: {
    icon: "PRE",
    color: "text-sky-300",
    bg: "bg-sky-500/10",
    border: "border-sky-500/20",
  },
  gex: {
    icon: "GEX",
    color: "text-fuchsia-300",
    bg: "bg-fuchsia-500/10",
    border: "border-fuchsia-500/20",
  },
};

const BAND_STYLES: Record<
  "S" | "A" | "B" | "C",
  { label: string; color: string; bg: string; border: string; glow: string }
> = {
  S: {
    label: "S",
    color: "text-amber-300",
    bg: "bg-gradient-to-br from-amber-500/20 to-orange-500/10",
    border: "border-amber-400/40",
    glow: "shadow-[0_0_20px_rgba(251,191,36,0.15)]",
  },
  A: {
    label: "A",
    color: "text-[var(--trade-bullish)]",
    bg: "bg-gradient-to-br from-emerald-500/15 to-sky-500/10",
    border: "border-emerald-400/30",
    glow: "shadow-[0_0_15px_rgba(52,211,153,0.1)]",
  },
  B: {
    label: "B",
    color: "text-sky-300",
    bg: "bg-sky-500/[0.06]",
    border: "border-sky-400/20",
    glow: "",
  },
  C: {
    label: "C",
    color: "text-muted-foreground",
    bg: "bg-foreground/[0.03]",
    border: "border-foreground/10",
    glow: "",
  },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

function humanHold(hp: string | undefined | null): string {
  const h = (hp || "").toLowerCase();
  if (h === "0dte" || h.includes("0dte")) return "0DTE";
  if (h === "1dte" || h.includes("1dte")) return "1DTE";
  if (h.includes("scalp")) return "0DTE";
  if (h.includes("intraday") || h === "day") return "1–2 days";
  if (h === "swing") return "1–2 weeks";
  if (h.includes("position")) return "4–8 weeks";
  if (h.includes("long") || h.includes("leap")) return "3+ months";
  if (!hp) return "";
  return hp.toUpperCase();
}

function bandFromIdea(idea: TradeIdeaCardData): "S" | "A" | "B" | "C" {
  if (idea.convictionBand) return idea.convictionBand;
  // fall back to probabilityBand
  const pb = idea.probabilityBand ?? "";
  if (pb.startsWith("A")) return "A";
  if (pb.startsWith("B")) return "B";
  if (pb.startsWith("C")) return "C";
  return "C";
}

/**
 * Compute live R:R from current price vs. the original trade plan.
 * Returns null when live price is unavailable or matches entry.
 */
function computeLiveRR(idea: TradeIdeaCardData): {
  liveRR: number;
  degraded: boolean;   // live R:R < 50% of original
  color: string;       // tailwind text color class
  label: string;       // formatted "1.2x"
} | null {
  const lp = idea.livePrice;
  if (lp == null || !Number.isFinite(lp)) return null;
  // Skip if live price essentially equals entry (within 0.1%)
  if (Math.abs(lp - idea.entryPrice) / idea.entryPrice < 0.001) return null;

  const isLong = idea.direction === "long";
  const upside = isLong ? idea.targetPrice - lp : lp - idea.targetPrice;
  const downside = isLong ? lp - idea.stopLoss : idea.stopLoss - lp;

  // If stop already breached, R:R is meaningless — flag as 0
  const liveRR = downside > 0 ? upside / downside : 0;
  const clampedRR = Math.max(0, liveRR);

  const degraded =
    idea.riskRewardRatio > 0 && clampedRR < idea.riskRewardRatio * 0.5;

  let color: string;
  if (clampedRR <= 0)       color = "text-[var(--trade-bearish)]";
  else if (clampedRR < 1.0) color = "text-[var(--trade-bearish)]";
  else if (clampedRR >= 1.5) color = "text-[var(--trade-bullish)]";
  else                       color = "text-muted-foreground";

  return {
    liveRR: clampedRR,
    degraded,
    color,
    label: `${clampedRR.toFixed(1)}×`,
  };
}

// ─────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────

function LayerPill({ layer }: { layer: ConvictionLayer }) {
  const style = LAYER_STYLES[layer.kind];
  const sign = layer.points > 0 ? "+" : "";
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1.5 flex items-start gap-2",
        style.bg,
        style.border,
      )}
    >
      <div
        className={cn(
          "text-[9px] font-mono font-bold tracking-wider px-1 py-0.5 rounded bg-black/30",
          style.color,
        )}
      >
        {style.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("text-[10px] font-semibold", style.color)}>
            {layer.label}
          </span>
          <span
            className={cn(
              "text-[10px] font-mono font-bold",
              layer.points > 0
                ? "text-[var(--trade-bullish)]"
                : layer.points < 0
                  ? "text-[var(--trade-bearish)]"
                  : "text-muted-foreground",
            )}
          >
            {sign}
            {layer.points}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/90 leading-tight mt-0.5 break-words line-clamp-2">
          {layer.why}
        </div>
      </div>
    </div>
  );
}

/**
 * FreshnessPill — surfaces the Phase 1 server-side revalidation diagnostics
 * (`ageHours`, `driftPct`, `freshnessFlags`) so the user sees at a glance
 * whether an idea is still actionable or has already drifted off the entry.
 *
 * Returns null when the idea is fresh enough that no warning is warranted.
 */
function FreshnessPill({ idea }: { idea: TradeIdeaCardData }) {
  const age = idea.ageHours;
  const drift = idea.driftPct;
  const flags = idea.freshnessFlags ?? [];
  const ts = idea.generatedAt || idea.timestamp;

  // Detect if idea is from a previous session (e.g., Friday's scan on weekend)
  const sessionLabel = (() => {
    if (!ts) return null;
    const ideaET = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    if (ideaET.toDateString() === nowET.toDateString()) return null;
    const ideaDay = ideaET.getDay();
    const nowDay = nowET.getDay();
    if (ideaDay === 5 && (nowDay === 0 || nowDay === 6 || nowDay === 1)) return 'FRI';
    const daysDiff = Math.floor((nowET.getTime() - ideaET.getTime()) / (24 * 60 * 60 * 1000));
    if (daysDiff >= 1) return `${daysDiff}D`;
    return null;
  })();

  if (age == null && drift == null && flags.length === 0 && !sessionLabel) return null;

  const isLong = idea.direction === "long";
  // "Against" the trade direction
  const driftAgainst = drift != null ? (isLong ? -drift : drift) : null;

  // Tone selection — green if fresh & moving with us, red if drift_against,
  // amber if just aged. Falls through to muted otherwise.
  let tone: "good" | "warn" | "bad" | "muted" = "muted";
  if (driftAgainst != null && driftAgainst >= 1) tone = "bad";
  else if (flags.includes("stale") || (age != null && age > 6)) tone = "warn";
  else if (drift != null && driftAgainst != null && driftAgainst < 0) tone = "good";

  const styles: Record<typeof tone, string> = {
    good: "bg-emerald-500/10 text-[var(--trade-bullish)] border-emerald-500/30",
    warn: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    bad: "bg-red-500/10 text-[var(--trade-bearish)] border-red-500/40",
    muted: "bg-foreground/5 text-muted-foreground border-foreground/10",
  };

  const ageLabel = age != null ? `${age < 1 ? "<1" : age.toFixed(0)}h` : null;
  const driftLabel =
    drift != null
      ? `${drift > 0 ? "+" : ""}${drift.toFixed(1)}%`
      : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border",
        styles[tone],
      )}
      title={
        flags.length
          ? `Freshness: ${flags.join(", ")}`
          : "Server-side freshness check"
      }
    >
      {sessionLabel && <span className="text-amber-300">{sessionLabel}</span>}
      {sessionLabel && (ageLabel || driftLabel) && <span className="opacity-50">·</span>}
      {ageLabel && <span>{ageLabel}</span>}
      {ageLabel && driftLabel && <span className="opacity-50">·</span>}
      {driftLabel && <span>{driftLabel}</span>}
    </span>
  );
}

function LayerChip({ layer }: { layer: ConvictionLayer }) {
  const style = LAYER_STYLES[layer.kind];
  const sign = layer.points > 0 ? "+" : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border",
        style.bg,
        style.border,
        style.color,
      )}
    >
      {style.icon} {sign}
      {layer.points}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// GEX-Suggested Contract — auto-picks strike + expiry from GEX levels
// ─────────────────────────────────────────────────────────────

export function GEXContractSuggestion({ idea }: { idea: TradeIdeaCardData }) {
  // Only suggest for stock ideas that don't already have an options play
  if (idea.optionType && idea.strikePrice) return null;

  const { data } = useQuery<{
    callWall?: number;
    putWall?: number;
    maxGammaStrike?: number;
    gammaFlipPrice?: number;
    spotPrice?: number;
    regime?: string;
    levels?: Array<{ strike: number; role: string; netGEX: number }>;
    strikeExpiryMatrix?: Array<{ strike: number; expiryLabel: string; dte: number; netGEX: number }>;
  }>({
    queryKey: [`/api/gex-vex/terminal/${idea.symbol}`, 'contract-hint'],
    queryFn: async () => {
      const res = await fetch(`/api/gex-vex/terminal/${idea.symbol}`, { credentials: 'include' });
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 5 * 60_000, // 5 min cache — GEX doesn't change fast
    retry: 0,
  });

  if (!data?.spotPrice || !data?.callWall) return null;

  const isLong = idea.direction === 'long';
  const optionType = isLong ? 'CALL' : 'PUT';

  // Strike selection logic based on GEX levels:
  // Long: pick slightly ITM or ATM strike near positive gamma support
  // Short: pick slightly ITM or ATM strike near negative gamma / put wall
  let suggestedStrike: number;
  const spot = data.spotPrice;

  if (isLong) {
    // For calls: go ATM or 1-2 strikes ITM for swing (delta ~0.55-0.65)
    // Use max gamma strike if it's near/below spot (support level)
    const anchor = data.maxGammaStrike && data.maxGammaStrike <= spot * 1.02
      ? data.maxGammaStrike
      : spot;
    // Round down to nearest $5 increment for cleaner strikes
    const increment = spot > 200 ? 10 : spot > 50 ? 5 : spot > 10 ? 2.5 : 1;
    suggestedStrike = Math.floor(anchor / increment) * increment;
  } else {
    // For puts: go ATM or 1-2 strikes ITM
    const anchor = data.maxGammaStrike && data.maxGammaStrike >= spot * 0.98
      ? data.maxGammaStrike
      : spot;
    const increment = spot > 200 ? 10 : spot > 50 ? 5 : spot > 10 ? 2.5 : 1;
    suggestedStrike = Math.ceil(anchor / increment) * increment;
  }

  // Expiry selection: 3-6 weeks out for swing trades, ~2 months for position
  const holdType = (idea.holdingPeriod || '').toLowerCase();
  let targetDTE: number;
  if (holdType.includes('day') || holdType.includes('scalp')) targetDTE = 14;
  else if (holdType.includes('swing')) targetDTE = 30;
  else if (holdType.includes('position') || holdType.includes('long') || holdType.includes('leap')) targetDTE = 120;
  else targetDTE = 30;

  // Extract unique expiries from the matrix, sorted by DTE
  const matrixCells = data.strikeExpiryMatrix || [];
  const expiryMap = new Map<string, number>();
  for (const cell of matrixCells) {
    if (cell.expiryLabel && !expiryMap.has(cell.expiryLabel)) {
      expiryMap.set(cell.expiryLabel, cell.dte);
    }
  }
  const sortedExpiries = [...expiryMap.entries()].sort((a, b) => a[1] - b[1]);

  let suggestedExpiry = '';
  if (sortedExpiries.length > 0) {
    // Pick the expiry closest to our targetDTE
    let bestMatch = sortedExpiries[0];
    let bestDiff = Math.abs(sortedExpiries[0][1] - targetDTE);
    for (const [label, dte] of sortedExpiries) {
      const diff = Math.abs(dte - targetDTE);
      if (diff < bestDiff) { bestDiff = diff; bestMatch = [label, dte]; }
    }
    suggestedExpiry = `${bestMatch[0]} (${bestMatch[1]}d)`;
  } else {
    // Fallback: compute a date ~targetDTE days out, round to nearest Friday
    const target = new Date();
    target.setDate(target.getDate() + targetDTE);
    // Round to Friday
    const dayOfWeek = target.getDay();
    const daysToFriday = (5 - dayOfWeek + 7) % 7;
    target.setDate(target.getDate() + daysToFriday);
    suggestedExpiry = target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }

  // GEX context label
  const gexContext = isLong
    ? data.callWall ? `Call wall $${data.callWall}` : ''
    : data.putWall ? `Put wall $${data.putWall}` : '';

  return (
    <div className="mb-3 px-2.5 py-2 rounded-md bg-sky-500/8 border border-sky-500/20">
      <div className="flex items-center gap-1.5 mb-1">
        <Crosshair className="w-3 h-3 text-sky-400" />
        <span className="text-[9px] font-mono uppercase tracking-wider text-sky-300/70">
          GEX-Suggested Contract
        </span>
      </div>
      <div className="flex items-center gap-3 text-[11px] font-mono">
        <span className="font-bold text-sky-300">{idea.symbol}</span>
        <span className="font-bold text-foreground">${suggestedStrike}</span>
        <span className={cn("font-bold uppercase", isLong ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]")}>
          {optionType}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground">{suggestedExpiry}</span>
        {gexContext && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-[9px] text-muted-foreground">{gexContext}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export function TradeIdeaCard({
  idea,
  variant = "full",
  onClick,
  className,
  "data-testid": testId,
  groupCount,
  expanded,
  onToggleGroup,
  isChild,
}: TradeIdeaCardProps) {
  if (variant === "row")
    return (
      <RowVariant
        idea={idea}
        onClick={onClick}
        className={className}
        testId={testId}
        groupCount={groupCount}
        expanded={expanded}
        onToggleGroup={onToggleGroup}
        isChild={isChild}
      />
    );
  if (variant === "compact") return <CompactVariant idea={idea} onClick={onClick} className={className} testId={testId} />;
  return <FullVariant idea={idea} onClick={onClick} className={className} testId={testId} />;
}

// ─────────────────────────────────────────────────────────────
// FULL variant — convictions-style hero card
// ─────────────────────────────────────────────────────────────

function FullVariant({
  idea,
  onClick,
  className,
  testId,
}: {
  idea: TradeIdeaCardData;
  onClick?: () => void;
  className?: string;
  testId?: string;
}) {
  const band = BAND_STYLES[bandFromIdea(idea)];
  const isLong = idea.direction === "long";
  const DirIcon = isLong ? ArrowUpRight : ArrowDownRight;
  const dirColor = isLong ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]";
  // H9: single source of truth for the displayed score.
  // U2: render grade as the headline; keep numeric score for tooltip.
  const score = displayedScore(idea);
  const grade = displayedGrade(idea);

  return (
    <div
      onClick={onClick}
      data-testid={testId ?? `trade-card-${idea.symbol}`}
      className={cn(
        "rounded-xl border p-4 relative overflow-hidden transition-all",
        band.bg,
        band.border,
        band.glow,
        "hover:border-foreground/20",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl font-bold font-mono text-foreground">
            {idea.symbol}
          </span>
          <div className={cn("flex items-center gap-0.5", dirColor)}>
            <DirIcon className="w-4 h-4" />
            <span className="text-[10px] font-mono uppercase font-bold">
              {idea.direction}
            </span>
          </div>
          {idea.sector && (
            <span className="text-[9px] font-mono uppercase text-muted-foreground truncate">
              {idea.sector.replace(/_/g, " ")}
            </span>
          )}
          <FreshnessPill idea={idea} />
        </div>
        <div
          className="text-right flex-shrink-0"
          title={`Conviction score ${score} (${grade})`}
        >
          <div
            className={cn(
              "px-2.5 py-1 text-lg font-bold font-mono leading-none rounded border tabular-nums",
              gradeColorClass(grade),
            )}
          >
            {grade}
          </div>
          <div className="text-[9px] font-mono text-muted-foreground mt-1 tabular-nums">
            {score}pts
          </div>
        </div>
      </div>

      {/* Trade plan strip */}
      {(() => {
        const live = computeLiveRR(idea);
        return (
          <div className="grid grid-cols-4 gap-2 mb-3 pb-3 border-b border-foreground/[0.06]">
            <PriceCell label="Entry" value={fmtPrice(idea.entryPrice)} tone="neutral" />
            <PriceCell label="Target" value={fmtPrice(idea.targetPrice)} tone="positive" />
            <PriceCell label="Stop" value={fmtPrice(idea.stopLoss)} tone="negative" />
            {live ? (
              <div>
                <div className="text-[9px] font-mono uppercase text-muted-foreground flex items-center gap-1">
                  Live R:R
                  {live.degraded && (
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                  )}
                </div>
                <div className={cn("text-sm font-mono font-semibold tabular-nums", live.color)}>
                  {live.label}
                </div>
                <div className="text-[9px] font-mono text-muted-foreground tabular-nums line-through">
                  {idea.riskRewardRatio.toFixed(1)}×
                </div>
              </div>
            ) : (
              <PriceCell label="R:R" value={`${idea.riskRewardRatio.toFixed(1)}×`} tone="cyan" />
            )}
          </div>
        );
      })()}

      {/* Current price strip */}
      {idea.livePrice != null && Number.isFinite(idea.livePrice) && (
        <div className="flex items-center justify-between mb-3 px-2 py-1.5 rounded bg-foreground/[0.03] border border-foreground/[0.08]">
          <div className="flex items-center gap-2">
            <Activity className="w-3 h-3 text-sky-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Current
            </span>
            <span className="font-mono font-bold text-sm text-foreground tabular-nums">
              {fmtPrice(idea.livePrice)}
            </span>
          </div>
          {idea.priceStale && (
            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">
              STALE
            </span>
          )}
        </div>
      )}

      {/* Option play — full contract readout */}
      {idea.optionType && idea.strikePrice && idea.expiryDate && (
        <div className="mb-3 px-2.5 py-2 rounded-md bg-violet-500/8 border border-violet-500/20">
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <Target className="w-3 h-3 text-violet-400" />
            <span className="font-bold text-violet-300 uppercase">{idea.optionType}</span>
            <span className="text-foreground">${idea.strikePrice}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{idea.expiryDate}</span>
            {idea.entryPremium != null && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-foreground">@ ${idea.entryPremium.toFixed(2)}</span>
              </>
            )}
            {idea.expiryTier && (
              <span className="ml-auto px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-200 font-bold uppercase tracking-wider text-[9px]">
                {idea.expiryTier}{idea.optionDte != null ? ` · ${idea.optionDte}DTE` : ""}
              </span>
            )}
          </div>
          {/* Greeks */}
          {(idea.optionDelta != null || idea.optionGamma != null || idea.optionTheta != null || idea.optionVega != null || idea.optionIV != null) && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] font-mono text-muted-foreground">
              {idea.optionDelta != null && <span>Δ {idea.optionDelta.toFixed(2)}</span>}
              {idea.optionGamma != null && <span>Γ {idea.optionGamma.toFixed(3)}</span>}
              {idea.optionTheta != null && <span>Θ {idea.optionTheta.toFixed(2)}</span>}
              {idea.optionVega != null && <span>V {idea.optionVega.toFixed(2)}</span>}
              {idea.optionIV != null && <span>IV {idea.optionIV.toFixed(0)}%</span>}
            </div>
          )}
          {/* Liquidity */}
          {(idea.optionOpenInterest != null || idea.optionVolume != null) && (
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[9px] font-mono text-muted-foreground">
              {idea.optionOpenInterest != null && <span>OI {idea.optionOpenInterest.toLocaleString()}</span>}
              {idea.optionVolume != null && <span>Vol {idea.optionVolume.toLocaleString()}</span>}
            </div>
          )}
          {/* Premium risk/reward bar */}
          <PremiumRiskRewardBar idea={idea} />
        </div>
      )}

      {/* GEX-suggested contract */}
      <GEXContractSuggestion idea={idea} />

      {/* Thesis / catalyst */}
      {(idea.thesis || idea.catalyst) && (
        <div className="mb-3 text-[11px] text-muted-foreground/90 italic leading-snug line-clamp-2">
          &ldquo;{idea.thesis || idea.catalyst}&rdquo;
        </div>
      )}

      {/* Layer breakdown */}
      {idea.layers && idea.layers.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 mb-2">
            <Activity className="w-3 h-3 text-muted-foreground" />
            <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
              {idea.layers.length} confluence layer{idea.layers.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {idea.layers.map((layer, i) => (
              <LayerPill key={i} layer={layer} />
            ))}
          </div>
        </>
      )}

      {/* Meta footer */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-foreground/[0.06] text-[10px] text-muted-foreground font-mono">
        <div className="flex items-center gap-2">
          {idea.holdingPeriod && (
            <span className="uppercase tracking-wider">{humanHold(idea.holdingPeriod)}</span>
          )}
          {idea.source && (
            <>
              <span className="opacity-40">·</span>
              <span className="uppercase tracking-wider truncate max-w-[100px]">
                {idea.source.replace(/_/g, " ")}
              </span>
            </>
          )}
        </div>
        <Link
          href={`/r/${idea.symbol}`}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-foreground/10 text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
        >
          Chart <ExternalLink className="w-2.5 h-2.5" />
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPACT variant — denser 4-col grid card
// ─────────────────────────────────────────────────────────────

function CompactVariant({
  idea,
  onClick,
  className,
  testId,
}: {
  idea: TradeIdeaCardData;
  onClick?: () => void;
  className?: string;
  testId?: string;
}) {
  const band = BAND_STYLES[bandFromIdea(idea)];
  const isLong = idea.direction === "long";
  const DirIcon = isLong ? ArrowUpRight : ArrowDownRight;
  const dirColor = isLong ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]";
  // H9: single source of truth for the displayed score.
  // U2: render grade as the headline; keep numeric score for tooltip.
  const score = displayedScore(idea);
  const grade = displayedGrade(idea);

  return (
    <div
      onClick={onClick}
      data-testid={testId ?? `trade-card-compact-${idea.symbol}`}
      className={cn(
        "rounded-lg border p-3 transition-all",
        band.bg,
        band.border,
        band.glow,
        "hover:border-foreground/20",
        onClick && "cursor-pointer",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base font-bold font-mono text-foreground">
            {idea.symbol}
          </span>
          <DirIcon className={cn("w-3.5 h-3.5", dirColor)} />
          <FreshnessPill idea={idea} />
        </div>
        <span
          className={cn(
            "px-1.5 py-0.5 rounded border text-xs font-bold font-mono leading-none flex-shrink-0",
            gradeColorClass(grade),
          )}
          title={`Conviction score ${score} (${grade})`}
        >
          {grade}
        </span>
      </div>

      {/* Mini trade plan */}
      {(() => {
        const live = computeLiveRR(idea);
        return (
          <div className="grid grid-cols-3 gap-1.5 mb-2 text-[10px] font-mono">
            <div>
              <div className="text-[9px] uppercase text-muted-foreground">Entry</div>
              <div className="text-foreground font-semibold">{fmtPrice(idea.entryPrice)}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-muted-foreground">Tgt</div>
              <div className="text-[var(--trade-bullish)] font-semibold">{fmtPrice(idea.targetPrice)}</div>
            </div>
            {live ? (
              <div>
                <div className="text-[9px] uppercase text-muted-foreground flex items-center gap-0.5">
                  Live R:R
                  {live.degraded && <AlertTriangle className="w-2 h-2 text-amber-400" />}
                </div>
                <div className={cn("font-semibold", live.color)}>
                  {live.label}
                </div>
              </div>
            ) : (
              <div>
                <div className="text-[9px] uppercase text-muted-foreground">R:R</div>
                <div className="text-sky-300 font-semibold">{idea.riskRewardRatio.toFixed(1)}×</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Layer chips row */}
      {idea.layers && idea.layers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {idea.layers.slice(0, 5).map((layer, i) => (
            <LayerChip key={i} layer={layer} />
          ))}
          {idea.layers.length > 5 && (
            <span className="text-[9px] text-muted-foreground font-mono px-1">
              +{idea.layers.length - 5}
            </span>
          )}
        </div>
      )}

      {/* Option play indicator */}
      {idea.optionType && idea.strikePrice && (
        <div className="mt-2 text-[9px] font-mono text-violet-300">
          {idea.optionType.toUpperCase()} ${idea.strikePrice} {idea.expiryDate ?? ""}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ROW variant — dense table row
// ─────────────────────────────────────────────────────────────

function RowVariant({
  idea,
  onClick,
  className,
  testId,
  groupCount = 0,
  expanded = false,
  onToggleGroup,
  isChild = false,
}: {
  idea: TradeIdeaCardData;
  onClick?: () => void;
  className?: string;
  testId?: string;
  groupCount?: number;
  expanded?: boolean;
  onToggleGroup?: () => void;
  isChild?: boolean;
}) {
  const band = BAND_STYLES[bandFromIdea(idea)];
  const isLong = idea.direction === "long";
  const dirColor = isLong ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]";
  // H9: single source of truth for the displayed score.
  // U2: render grade as the headline; keep numeric score for tooltip.
  const score = displayedScore(idea);
  const grade = displayedGrade(idea);

  // Option rows are denominated in PREMIUM, not stock price: what you actually
  // trade is the contract. This is also what differentiates two setups on the
  // same ticker (a weekly vs a leap share the stock thesis but differ by
  // strike/premium). Entry → premium paid, Target → delta-projected premium
  // (est.), Stop → -50% premium. Stock-only ideas keep stock prices.
  const isOption = !!(idea.optionType && idea.strikePrice != null);
  const prem = idea.entryPremium;
  const hasPrem = isOption && prem != null && Number.isFinite(prem) && prem > 0;
  const projTargetPrem =
    hasPrem && idea.optionDelta != null && Number.isFinite(idea.optionDelta)
      ? prem! + Math.abs(idea.optionDelta) * Math.abs(idea.targetPrice - idea.entryPrice)
      : null;
  const stopPrem = hasPrem ? prem! * 0.5 : null;
  const optTag = idea.optionType === "call" ? "C" : "P";

  return (
    <div
      onClick={onClick}
      data-testid={testId ?? `trade-row-${idea.symbol}`}
      className={cn(
        "grid grid-cols-[80px_50px_60px_80px_80px_80px_60px_1fr_60px] items-center gap-2 px-3 py-2 rounded-md border text-[11px] font-mono transition-all",
        band.bg,
        band.border,
        "hover:border-foreground/20",
        onClick && "cursor-pointer",
        isChild && "opacity-80",
        className,
      )}
    >
      <div className="font-bold text-foreground truncate flex items-center gap-1">
        {groupCount > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleGroup?.();
            }}
            title={expanded ? "Collapse setups" : `Show ${groupCount} more setup${groupCount > 1 ? "s" : ""}`}
            className="flex items-center gap-0.5 text-sky-300 hover:text-sky-200 shrink-0"
          >
            <ChevronRight className={cn("w-3 h-3 transition-transform", expanded && "rotate-90")} />
            <span className="text-[9px] font-bold tabular-nums">+{groupCount}</span>
          </button>
        ) : isChild ? (
          <span className="w-[22px] shrink-0 text-foreground/20 text-right pr-1">↳</span>
        ) : null}
        <span className={cn(isChild && "text-muted-foreground")}>{idea.symbol}</span>
        <FreshnessPill idea={idea} />
      </div>
      <div className={cn("uppercase text-[10px] font-bold", dirColor)}>
        {isLong ? "LONG" : "SHORT"}
      </div>
      <div
        className={cn("font-bold text-right text-[11px]", band.color)}
        title={`Conviction score ${score} (${grade})`}
      >
        {grade}
      </div>
      <div
        className={cn("tabular-nums text-right", hasPrem ? "text-violet-300" : "text-foreground")}
        title={
          hasPrem
            ? `Entry premium $${prem!.toFixed(2)} · ${idea.optionType?.toUpperCase()} $${idea.strikePrice}`
            : "Stock entry"
        }
      >
        {hasPrem ? `$${prem!.toFixed(2)}` : fmtPrice(idea.entryPrice)}
      </div>
      <div
        className="text-[var(--trade-bullish)] tabular-nums text-right"
        title={hasPrem ? `Projected premium at target (est., delta-based)` : "Stock target"}
      >
        {hasPrem
          ? projTargetPrem != null
            ? `$${projTargetPrem.toFixed(2)}`
            : "—"
          : fmtPrice(idea.targetPrice)}
      </div>
      <div
        className="text-[var(--trade-bearish)] tabular-nums text-right"
        title={hasPrem ? `-50% premium stop` : "Stock stop"}
      >
        {hasPrem ? `$${stopPrem!.toFixed(2)}` : fmtPrice(idea.stopLoss)}
      </div>
      {(() => {
        const live = computeLiveRR(idea);
        return live ? (
          <div
            className={cn("text-right flex items-center justify-end gap-0.5", live.color)}
            title={`Original R:R ${idea.riskRewardRatio.toFixed(1)}× → Live ${live.label}`}
          >
            {live.degraded && <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />}
            {live.label}
          </div>
        ) : (
          <div className="text-sky-300 text-right">{idea.riskRewardRatio.toFixed(1)}×</div>
        );
      })()}
      <div className="text-muted-foreground truncate">
        {isOption ? (
          <span className="flex items-center gap-1.5">
            <span className="text-violet-300 font-bold tabular-nums">
              ${idea.strikePrice}
              {optTag}
            </span>
            {idea.expiryTier && (
              <span className="px-1 py-px rounded bg-violet-500/15 text-violet-200 text-[9px] font-bold uppercase tracking-wider">
                {idea.expiryTier}
                {idea.optionDte != null ? ` ${idea.optionDte}D` : ""}
              </span>
            )}
            <span className="text-muted-foreground truncate">{idea.expiryDate ?? ""}</span>
          </span>
        ) : (
          idea.thesis || idea.catalyst || "—"
        )}
      </div>
      <div className="text-muted-foreground text-right text-[9px] uppercase">
        {humanHold(idea.holdingPeriod) || "—"}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────

/**
 * Premium risk/reward bar — visualizes the option premium journey on one axis:
 *   -50% premium stop (loss)  ←  entry premium  →  projected value at target.
 *
 * Projection is a first-order, delta-only estimate:
 *   ΔPremium ≈ |delta| × |target − entry|  (favorable direction, theta/vega ignored).
 * Labeled "est." so we never imply a guaranteed payout. Renders only when we
 * actually have an entry premium and a delta to project from.
 */
function PremiumRiskRewardBar({ idea }: { idea: TradeIdeaCardData }) {
  const entry = idea.entryPremium;
  const delta = idea.optionDelta;
  if (entry == null || !Number.isFinite(entry) || entry <= 0) return null;
  if (delta == null || !Number.isFinite(delta)) return null;

  const stockMove = Math.abs(idea.targetPrice - idea.entryPrice);
  const projTarget = entry + Math.abs(delta) * stockMove;
  const stopPrem = entry * 0.5; // -50% premium stop

  const targetGainPct = (projTarget / entry - 1) * 100;

  // Scale domain spans the stop (low) to projected target (high).
  const domainLo = stopPrem;
  const domainHi = Math.max(projTarget, entry * 1.05); // guard against flat bars
  const range = domainHi - domainLo || 1;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - domainLo) / range) * 100));
  const entryPct = pos(entry);

  return (
    <div className="mt-2 pt-2 border-t border-violet-500/15">
      <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
        <span>Premium R:R</span>
        <span className="opacity-60">est. · delta-based</span>
      </div>
      {/* Track */}
      <div className="relative h-2 rounded-full overflow-hidden bg-foreground/5">
        {/* loss zone: stop → entry */}
        <div
          className="absolute inset-y-0 left-0 bg-red-500/40"
          style={{ width: `${entryPct}%` }}
        />
        {/* gain zone: entry → target */}
        <div
          className="absolute inset-y-0 bg-emerald-500/45"
          style={{ left: `${entryPct}%`, right: 0 }}
        />
        {/* entry marker */}
        <div
          className="absolute inset-y-0 w-0.5 bg-foreground"
          style={{ left: `${entryPct}%` }}
          title={`Entry premium $${entry.toFixed(2)}`}
        />
      </div>
      {/* Labels */}
      <div className="mt-1 flex items-center justify-between text-[9px] font-mono tabular-nums">
        <span className="text-[var(--trade-bearish)]" title="-50% premium stop">
          ${stopPrem.toFixed(2)}
          <span className="text-muted-foreground"> stop</span>
        </span>
        <span className="text-foreground" title="Entry premium">
          ${entry.toFixed(2)}
          <span className="text-muted-foreground"> entry</span>
        </span>
        <span className="text-[var(--trade-bullish)]" title={`Projected at target (${fmtPrice(idea.targetPrice)})`}>
          ${projTarget.toFixed(2)}
          <span className="text-muted-foreground"> +{targetGainPct.toFixed(0)}%</span>
        </span>
      </div>
    </div>
  );
}

function PriceCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "negative" | "neutral" | "cyan";
}) {
  const toneColor =
    tone === "positive"
      ? "text-[var(--trade-bullish)]"
      : tone === "negative"
        ? "text-[var(--trade-bearish)]"
        : tone === "cyan"
          ? "text-sky-300"
          : "text-foreground";

  return (
    <div>
      <div className="text-[9px] font-mono uppercase text-muted-foreground">
        {label}
      </div>
      <div className={cn("text-sm font-mono font-semibold tabular-nums", toneColor)}>
        {value}
      </div>
    </div>
  );
}

// Header for table view
export function TradeIdeaRowHeader() {
  return (
    <div className="grid grid-cols-[80px_50px_60px_80px_80px_80px_60px_1fr_60px] items-center gap-2 px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-b border-foreground/[0.06]">
      <div>Symbol</div>
      <div>Side</div>
      <div className="text-right">Grade</div>
      <div className="text-right">Entry</div>
      <div className="text-right">Target</div>
      <div className="text-right">Stop</div>
      <div className="text-right">R:R</div>
      <div>Thesis / Option</div>
      <div className="text-right">Hold</div>
    </div>
  );
}
