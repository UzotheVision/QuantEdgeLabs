/**
 * IdeaDetailDrawer — slide-out detail for a single trade idea
 * ============================================================
 * Two tabs:
 *   1. Trade Desk : the trade plan, live price, levels, option play, actions
 *   2. Convictions: the layered confluence breakdown for this symbol (from /api/convictions)
 *
 * Opens from the right side over the trade desk grid.
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Target,
  Shield,
  TrendingUp,
  ExternalLink,
  Loader2,
  Layers,
  ListChecks,
} from "lucide-react";
import {
  TradeIdeaCardData,
  ConvictionLayer,
  LAYER_STYLES,
  GEXContractSuggestion,
} from "./trade-idea-card";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ConvictionsApiResponse {
  picks: Array<{
    ideaId: string;
    symbol: string;
    sector: string;
    direction: "long" | "short";
    convictionScore: number;
    convictionBand: "S" | "A" | "B" | "C";
    layers: ConvictionLayer[];
    thesis: string;
    entryPrice: number;
    targetPrice: number;
    stopLoss: number;
    riskRewardRatio: number;
  }>;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

/** Map generic hold period to human-readable DTE label */
function humanHoldLabel(hp: string): string {
  const h = (hp || "").toLowerCase();
  if (h === "0dte" || h.includes("0dte")) return "0DTE";
  if (h === "1dte" || h.includes("1dte")) return "1DTE";
  if (h.includes("scalp")) return "0DTE";
  if (h.includes("intraday") || h === "day") return "1–2 days";
  if (h === "swing") return "1–2 weeks";
  if (h.includes("position")) return "4–8 weeks";
  if (h.includes("long") || h.includes("leap")) return "3+ months";
  return hp.toUpperCase();
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

interface Props {
  idea: TradeIdeaCardData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IdeaDetailDrawer({ idea, open, onOpenChange }: Props) {
  const [tab, setTab] = useState<"trade" | "conviction">("trade");

  // Fetch convictions for this specific symbol if not already enriched.
  // Uses the new ?symbol= server-side filter so we transfer one pick instead
  // of the full 100-pick payload.
  const needsConvictionFetch = !!idea && (!idea.layers || idea.layers.length === 0);
  const { data: convData, isLoading: convLoading } = useQuery<ConvictionsApiResponse>({
    queryKey: ["/api/convictions", { symbol: idea?.symbol, direction: idea?.direction, lookbackHours: 168 }],
    queryFn: async () => {
      const params = new URLSearchParams({
        symbol: idea!.symbol,
        direction: idea!.direction,
        lookbackHours: "168",
      });
      const res = await fetch(`/api/convictions?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: open && needsConvictionFetch,
    staleTime: 60_000,
  });

  // Find the matching pick for this symbol
  const enrichedPick = idea
    ? convData?.picks.find(
        (p) => p.symbol === idea.symbol && p.direction === idea.direction,
      ) ?? convData?.picks.find((p) => p.symbol === idea.symbol)
    : null;

  const layers: ConvictionLayer[] =
    idea?.layers && idea.layers.length > 0
      ? idea.layers
      : enrichedPick?.layers ?? [];
  const score = idea?.convictionScore ?? enrichedPick?.convictionScore ?? null;
  const band = idea?.convictionBand ?? enrichedPick?.convictionBand ?? null;
  const thesis = idea?.thesis ?? enrichedPick?.thesis ?? idea?.catalyst ?? "";

  if (!idea) return null;

  const isLong = idea.direction === "long";
  const DirIcon = isLong ? ArrowUpRight : ArrowDownRight;
  const dirColor = isLong ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md md:max-w-lg lg:max-w-xl bg-background border-l border-foreground/10 p-0 overflow-y-auto"
      >
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-foreground/10">
          <SheetTitle className="flex items-center gap-3">
            <span className="text-2xl font-mono font-bold text-foreground">
              {idea.symbol}
            </span>
            {band && (
              <span
                className={cn(
                  "px-2 py-1 rounded border text-xs font-mono font-bold",
                  band === "S"
                    ? "text-amber-300 border-amber-400/40 bg-amber-500/10"
                    : band === "A"
                      ? "text-[var(--trade-bullish)] border-emerald-400/30 bg-emerald-500/10"
                      : band === "B"
                        ? "text-sky-300 border-sky-400/20 bg-sky-500/10"
                        : "text-muted-foreground border-foreground/10",
                )}
              >
                {band}
              </span>
            )}
            <div className={cn("flex items-center gap-1", dirColor)}>
              <DirIcon className="w-4 h-4" />
              <span className="text-xs font-mono uppercase font-bold">
                {idea.direction}
              </span>
            </div>
            {score != null && (
              <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                {score}pts
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        {/* Tab strip */}
        <div className="flex items-center border-b border-foreground/10 px-5">
          <TabButton
            active={tab === "trade"}
            onClick={() => setTab("trade")}
            icon={<ListChecks className="w-3.5 h-3.5" />}
            label="Trade Desk"
          />
          <TabButton
            active={tab === "conviction"}
            onClick={() => setTab("conviction")}
            icon={<Layers className="w-3.5 h-3.5" />}
            label="Convictions"
            count={layers.length || undefined}
          />
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {tab === "trade" && <TradeTab idea={idea} />}
          {tab === "conviction" && (
            <ConvictionTab
              layers={layers}
              loading={convLoading && needsConvictionFetch}
              thesis={thesis}
              score={score}
              band={band}
            />
          )}
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 left-0 right-0 px-5 py-3 border-t border-foreground/10 bg-background flex items-center gap-2">
          <Link
            href={`/r/${idea.symbol}`}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-sky-500/30 text-sky-300 hover:bg-sky-500/10 transition-colors text-[11px] font-mono uppercase tracking-wider"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Open Chart
            <ExternalLink className="w-3 h-3" />
          </Link>
          {/* The per-idea audit trail (/trade-ideas/:id/audit) was routed but had
              no link anywhere — every recorded outcome was unauditable from the UI. */}
          {idea.id && (
            <Link
              href={`/trade-ideas/${idea.id}/audit`}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-foreground/15 text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors text-[11px] font-mono uppercase tracking-wider"
            >
              Audit trail
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              const text = `${idea.symbol} ${idea.direction.toUpperCase()} @ ${fmtPrice(idea.entryPrice)} → ${fmtPrice(idea.targetPrice)} stop ${fmtPrice(idea.stopLoss)} (R:R ${idea.riskRewardRatio.toFixed(1)}×)`;
              navigator.clipboard?.writeText(text);
            }}
            className="px-3 py-2 rounded-md border border-foreground/10 text-muted-foreground hover:text-foreground hover:border-foreground/20 text-[11px] font-mono uppercase tracking-wider"
          >
            Copy Ticket
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab content
// ─────────────────────────────────────────────────────────────

function TradeTab({ idea }: { idea: TradeIdeaCardData }) {
  return (
    <div className="space-y-4">
      {/* Current price strip */}
      {idea.livePrice != null && Number.isFinite(idea.livePrice) && (
        <div className="flex items-center justify-between px-3 py-2 rounded-md bg-foreground/[0.03] border border-foreground/[0.08]">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Current
            </span>
            <span className="font-mono font-bold text-base text-foreground tabular-nums">
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

      {/* Trade plan grid */}
      <div className="grid grid-cols-3 gap-2">
        <BigCell label="Entry" value={fmtPrice(idea.entryPrice)} icon={<Activity className="w-3 h-3" />} tone="neutral" />
        <BigCell label="Target" value={fmtPrice(idea.targetPrice)} icon={<Target className="w-3 h-3" />} tone="positive" />
        <BigCell label="Stop" value={fmtPrice(idea.stopLoss)} icon={<Shield className="w-3 h-3" />} tone="negative" />
      </div>

      {/* R:R + meta */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-foreground/[0.02] border border-foreground/[0.06] text-[11px] font-mono">
        <div>
          <div className="text-[9px] uppercase text-muted-foreground">R:R</div>
          <div className="text-sky-300 font-bold text-sm">
            {idea.riskRewardRatio.toFixed(2)}×
          </div>
        </div>
        {idea.holdingPeriod && (
          <div>
            <div className="text-[9px] uppercase text-muted-foreground">Hold</div>
            <div className="text-foreground font-bold text-sm uppercase">
              {humanHoldLabel(idea.holdingPeriod)}
            </div>
          </div>
        )}
        {idea.source && (
          <div>
            <div className="text-[9px] uppercase text-muted-foreground">Source</div>
            <div className="text-foreground font-bold text-sm uppercase">
              {idea.source.replace(/_/g, " ")}
            </div>
          </div>
        )}
      </div>

      {/* Option play */}
      {idea.optionType && idea.strikePrice && idea.expiryDate && (
        <div className="px-3 py-2.5 rounded-md bg-violet-500/8 border border-violet-500/20">
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-violet-300">
              Option Play
            </span>
            {idea.expiryTier && (
              <span className="ml-auto px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-200 font-bold uppercase tracking-wider text-[9px] font-mono">
                {idea.expiryTier}{idea.optionDte != null ? ` · ${idea.optionDte}DTE` : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm font-mono">
            <span className="font-bold text-violet-200 uppercase">
              {idea.optionType}
            </span>
            <span className="text-foreground">${idea.strikePrice}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{idea.expiryDate}</span>
            {idea.entryPremium != null && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-foreground">@ ${idea.entryPremium.toFixed(2)}</span>
              </>
            )}
          </div>
          {/* Greeks */}
          {(idea.optionDelta != null || idea.optionGamma != null || idea.optionTheta != null || idea.optionVega != null || idea.optionIV != null) && (
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {idea.optionDelta != null && (
                <div className="text-center">
                  <div className="text-[9px] font-mono uppercase text-muted-foreground">Delta</div>
                  <div className="text-[11px] font-mono text-foreground">{idea.optionDelta.toFixed(2)}</div>
                </div>
              )}
              {idea.optionGamma != null && (
                <div className="text-center">
                  <div className="text-[9px] font-mono uppercase text-muted-foreground">Gamma</div>
                  <div className="text-[11px] font-mono text-foreground">{idea.optionGamma.toFixed(3)}</div>
                </div>
              )}
              {idea.optionTheta != null && (
                <div className="text-center">
                  <div className="text-[9px] font-mono uppercase text-muted-foreground">Theta</div>
                  <div className="text-[11px] font-mono text-foreground">{idea.optionTheta.toFixed(2)}</div>
                </div>
              )}
              {idea.optionVega != null && (
                <div className="text-center">
                  <div className="text-[9px] font-mono uppercase text-muted-foreground">Vega</div>
                  <div className="text-[11px] font-mono text-foreground">{idea.optionVega.toFixed(2)}</div>
                </div>
              )}
              {idea.optionIV != null && (
                <div className="text-center">
                  <div className="text-[9px] font-mono uppercase text-muted-foreground">IV</div>
                  <div className="text-[11px] font-mono text-foreground">{idea.optionIV.toFixed(0)}%</div>
                </div>
              )}
            </div>
          )}
          {/* Liquidity */}
          {(idea.optionOpenInterest != null || idea.optionVolume != null) && (
            <div className="mt-2 flex items-center gap-4 text-[10px] font-mono text-muted-foreground border-t border-violet-500/15 pt-1.5">
              {idea.optionOpenInterest != null && (
                <span>OI <span className="text-foreground">{idea.optionOpenInterest.toLocaleString()}</span></span>
              )}
              {idea.optionVolume != null && (
                <span>Vol <span className="text-foreground">{idea.optionVolume.toLocaleString()}</span></span>
              )}
            </div>
          )}
        </div>
      )}

      {/* GEX-suggested contract (when no explicit option play exists) */}
      <GEXContractSuggestion idea={idea} />

      {/* Catalyst / thesis */}
      {(idea.catalyst || idea.thesis) && (
        <div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
            Thesis
          </div>
          <div className="text-[12px] text-foreground/90 italic leading-relaxed">
            &ldquo;{idea.thesis || idea.catalyst}&rdquo;
          </div>
        </div>
      )}
    </div>
  );
}

function ConvictionTab({
  layers,
  loading,
  thesis,
  score,
  band,
}: {
  layers: ConvictionLayer[];
  loading: boolean;
  thesis?: string;
  score: number | null;
  band: "S" | "A" | "B" | "C" | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-[11px] font-mono uppercase tracking-wider">
          Loading layers
        </span>
      </div>
    );
  }

  if (layers.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Layers className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-[11px] font-mono uppercase tracking-wider">
          No conviction layers found
        </p>
        <p className="text-[10px] mt-1">
          This idea was generated without confluence enrichment.
        </p>
      </div>
    );
  }

  // Group by sign
  const positives = layers.filter((l) => l.points > 0);
  const negatives = layers.filter((l) => l.points < 0);
  const totalPos = positives.reduce((s, l) => s + l.points, 0);
  const totalNeg = negatives.reduce((s, l) => s + l.points, 0);

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-2 px-3 py-2.5 rounded-md bg-foreground/[0.02] border border-foreground/[0.06]">
        <div>
          <div className="text-[9px] font-mono uppercase text-muted-foreground">
            Score
          </div>
          <div
            className={cn(
              "text-xl font-mono font-bold leading-none",
              band === "S"
                ? "text-amber-300"
                : band === "A"
                  ? "text-[var(--trade-bullish)]"
                  : band === "B"
                    ? "text-sky-300"
                    : "text-muted-foreground",
            )}
          >
            {score ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-mono uppercase text-muted-foreground">
            Supports
          </div>
          <div className="text-xl font-mono font-bold leading-none text-[var(--trade-bullish)]">
            +{totalPos}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-mono uppercase text-muted-foreground">
            Opposes
          </div>
          <div className="text-xl font-mono font-bold leading-none text-[var(--trade-bearish)]">
            {totalNeg}
          </div>
        </div>
      </div>

      {thesis && (
        <div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
            Thesis
          </div>
          <div className="text-[12px] text-foreground/90 italic leading-relaxed">
            &ldquo;{thesis}&rdquo;
          </div>
        </div>
      )}

      <div>
        <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          {layers.length} Confluence Layer{layers.length === 1 ? "" : "s"}
        </div>
        <div className="space-y-2">
          {layers.map((layer, i) => (
            <DetailLayerRow key={i} layer={layer} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-mono uppercase tracking-wider transition-colors border-b-2",
        active
          ? "text-sky-300 border-sky-400"
          : "text-muted-foreground border-transparent hover:text-foreground",
      )}
    >
      {icon}
      {label}
      {count != null && (
        <span
          className={cn(
            "ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold",
            active ? "bg-sky-500/20 text-sky-200" : "bg-foreground/10 text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function BigCell({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "positive" | "negative" | "neutral";
}) {
  const toneColor =
    tone === "positive"
      ? "text-[var(--trade-bullish)]"
      : tone === "negative"
        ? "text-[var(--trade-bearish)]"
        : "text-foreground";

  return (
    <div className="px-3 py-2.5 rounded-md bg-foreground/[0.03] border border-foreground/[0.08]">
      <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className={cn("text-base font-mono font-bold tabular-nums", toneColor)}>
        {value}
      </div>
    </div>
  );
}

function DetailLayerRow({ layer }: { layer: ConvictionLayer }) {
  const style = LAYER_STYLES[layer.kind];
  const sign = layer.points > 0 ? "+" : "";
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2.5 flex items-start gap-3",
        style.bg,
        style.border,
      )}
    >
      <div
        className={cn(
          "text-[9px] font-mono font-bold tracking-wider px-1.5 py-1 rounded bg-black/30 flex-shrink-0",
          style.color,
        )}
      >
        {style.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className={cn("text-[11px] font-semibold", style.color)}>
            {layer.label}
          </span>
          <span
            className={cn(
              "text-[11px] font-mono font-bold",
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
        <div className="text-[11px] text-muted-foreground/90 leading-snug">
          {layer.why}
        </div>
      </div>
    </div>
  );
}
