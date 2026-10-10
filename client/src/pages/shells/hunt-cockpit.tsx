/**
 * HUNT — Signals Cockpit (MOMO-style 3-zone template).
 *
 *   ┌─────────────┬───────────────────────────┬──────────────┐
 *   │ ACTIVE      │  SUBJECT                   │  ANALYTICS   │
 *   │ SIGNALS     │  header · chart · thesis   │  gauge ·     │
 *   │ (list)      │  · catalyst                │  components ·│
 *   │             │                            │  key levels  │
 *   └─────────────┴───────────────────────────┴──────────────┘
 *
 * Every cell binds to the real /api/convictions payload (ConvictionPick),
 * real OHLC (/api/historical-prices), real live quote (/api/quotes/batch),
 * and real company logos. Nothing is fabricated; missing data shows honest
 * empty states.
 */
import { PublishedContractLive } from "@/components/contract-engine/published-contract-live";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { EvidenceRail } from "@/components/evidence-rail";
import { Loader2, AlertTriangle, Camera } from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { QETabs } from "@/components/ui/qe-tabs";
import {
  COCKPIT_MODES,
  matchesMode,
  type CockpitMode,
} from "@/components/hunt/cockpit/cockpit-modes";

import { TickerLogo } from "@/components/hunt/cockpit/ticker-logo";
;
import { TASummary } from "@/components/hunt/cockpit/ta-summary";
import { SignalComponents } from "@/components/hunt/cockpit/signal-components";
;
import { SignalRow } from "@/components/hunt/cockpit/signal-row";
import { KpiStrip } from "@/components/hunt/cockpit/kpi-strip";
import { ContractEngine } from "@/components/contract-engine/contract-engine";
import {
  TradeStrip,
  type TradeStripPick,
} from "@/components/oracle/trade-strip";
import { SignalGrid } from "@/components/hunt/cockpit/signal-grid";
import { SignalTable } from "@/components/hunt/cockpit/signal-table";
import {
  useSignalFilters,
  applyFilters,
  SignalFilterBar,
} from "@/components/hunt/cockpit/signal-filters";
import { Segmented } from "@/components/templates/charts";
import { Readout, BandScale } from "@/components/templates/kit";
import {
  PriceLadder,
  ContextPanel,
  ProfitPlan,
  RiskPanel,
  geometryFor,
} from "@/components/oracle/signal-detail";
import {
  SignalTimingBadge,
  SignalTimingNotice,
} from "@/components/oracle/signal-timing-badge";
// The CHART tab's engine, everywhere a chart appears — one interactive chart.
import { NexusPriceChart } from "@/components/charting/nexus-price-chart";
import { bandColor } from "@/lib/design-tokens";
import { Heartbeat, LiveValue } from "@/components/viz";
import {
  tierLabel,
  directionTone,
  convictionPercent,
  clarifyOracleNarrative,
  LAYER_COLOR,
  LAYER_TAG,
  type ConvictionPick,
  type ConvictionsResponse,
} from "@/lib/convictions";
import { CONVICTION_FAMILIES } from "@shared/conviction-layers";

const RANGES = [
  { id: "5d", label: "1H", range: "5d", interval: "60m" },
  { id: "1mo", label: "1D", range: "1mo", interval: "1d" },
  { id: "3mo", label: "1W", range: "3mo", interval: "1d" },
  { id: "6mo", label: "1M", range: "6mo", interval: "1wk" },
] as const;

/** The on-demand analyser's real response. Unlike a published ConvictionPick it
 * has no scanner-owned entry/stop/target, so it must never be rendered as one. */
interface OnDemandAnalysis {
  symbol: string;
  name?: string;
  overall?: {
    grade?: string;
    score?: number;
    tier?: string;
    recommendation?: string;
    confidence?: string;
  };
  components?: Record<
    string,
    { score?: number; grade?: string; weight?: number }
  >;
  timeHorizons?: Record<
    string,
    {
      signal?: string;
      confidence?: number;
      timeframe?: string;
      entry?: number;
      exit?: number;
      targetPrice?: number;
    }
  >;
  insights?: {
    strengths?: string[];
    weaknesses?: string[];
    catalysts?: string[];
    risks?: string[];
  };
  /** Read-only, directional conditions for a searched ticker that has not
   * earned a scanner-published trade. */
  read?: {
    spot: number;
    asOf: string;
    dimensions: Array<{
      key: string;
      label: string;
      state: "bullish" | "bearish" | "neutral" | "caution" | "unknown";
      value: string;
      read: string;
    }>;
    cautions: string[];
    directional: {
      bias: "bullish" | "bearish" | "neutral";
      aligned: number;
      conflicting: number;
      assessed: number;
      status: "watch";
      tradeable: false;
      summary: string;
      nextCheck: string;
    };
  };
}

interface GradedTicker {
  symbol: string;
  text: string;
  grade?: string | null;
  score?: number | null;
  name?: string | null;
  analysis?: OnDemandAnalysis;
}

interface PublishedIdeaRow {
  id: string;
  symbol: string;
  direction: string;
  outcome: string;
  recordedOutcome?: string;
  contractExpired?: boolean;
  ageHours?: number | null;
  holdingPeriod?: string | null;
  archiveReason?: string;
  score?: number | null;
  riskRewardRatio?: number | null;
  optionType: 'call' | 'put' | null;
  strikePrice: number | null;
  expiryDate: string | null;
  entryPremium: number | null;
  exitPremium: number | null;
  optionPercentGain: number | null;
  realizedPnL: number | null;
  peakPremium?: number | null;
  peakOptionPercentGain?: number | null;
  markedPnlAtPeak?: number | null;
  outcomeNotes?: string | null;
  resolutionReason?: string | null;
  source: string | null;
  dataSourceUsed: string | null;
  contractSymbol?: string | null;
  at: string;
}

interface StrikeLadderResponse {
  fillBasis: string;
  summary: {
    requested: number;
    measured: number;
    cheapestStrike: number | null;
    cheapestEntryPremium: number | null;
    bestPeakPctStrike: number | null;
    bestPeakReturnPct: number | null;
  };
  ladder: Array<{
    strike: number;
    status: string;
    entryPremium: number | null;
    entryVolume: number | null;
    peakPremium: number | null;
    peakReturnPct: number | null;
    maxAdversePct: number | null;
    peakMarkedPnl: number | null;
  }>;
}

function IndexStrikeLadder({ row }: { row: PublishedIdeaRow }) {
  const [open, setOpen] = useState(false);
  const center = Number(row.strikePrice);
  const expiry = row.expiryDate?.slice(0, 10) || row.at.slice(0, 10);
  const root = row.contractSymbol?.match(/^([A-Z.]{1,6})\d{6}[CP]\d{8}$/)?.[1] || (row.symbol === 'SPX' ? 'SPXW' : row.symbol);
  const params = new URLSearchParams({
    root,
    date: expiry,
    type: row.optionType || 'call',
    entryAt: row.at,
    minStrike: String(center - 10),
    maxStrike: String(center + 15),
    step: '1',
  });
  const { data, isFetching, error } = useQuery<StrikeLadderResponse>({
    queryKey: ['/api/options/history-ladder', row.id],
    queryFn: async () => {
      const response = await fetch(`/api/options/history-ladder?${params.toString()}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Strike replay unavailable');
      return response.json();
    },
    enabled: open && Number.isFinite(center) && center > 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 0,
  });

  if (row.symbol !== 'SPX' || !row.optionType || !Number.isFinite(center)) return null;
  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="font-mono text-[9px] uppercase tracking-[0.13em] text-[var(--brand-cyan)] hover:underline"
      >
        {open ? 'Hide strike audit' : `Compare ${center - 10}–${center + 15} strikes`}
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto">
          {isFetching ? (
            <div className="font-mono text-[9px] text-muted-foreground">Loading reported one-minute contract paths…</div>
          ) : error ? (
            <div className="font-mono text-[9px] text-[var(--trade-bearish)]">Strike history is unavailable from the delayed source.</div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[8px] text-muted-foreground">
                <span>{data?.summary.requested ?? 0} strike values checked</span>
                <span>{data?.summary.measured ?? 0} listed/traded contracts</span>
                {data?.summary.cheapestStrike != null && <span>cheapest: {data.summary.cheapestStrike}C @ ${Number(data.summary.cheapestEntryPremium).toFixed(2)}</span>}
                {data?.summary.bestPeakPctStrike != null && <span className="text-[var(--brand-amber)]">largest peak %: {data.summary.bestPeakPctStrike}C · +{Number(data.summary.bestPeakReturnPct).toFixed(0)}%</span>}
              </div>
              <div className="grid min-w-[430px] grid-cols-[46px_repeat(5,minmax(64px,1fr))] gap-x-2 border-b border-border/40 pb-1 font-mono text-[8px] uppercase text-muted-foreground">
                <span>Strike</span><span>Entry</span><span>Peak</span><span>Peak %</span><span>Drawdown</span><span>Peak $</span>
              </div>
              {(data?.ladder ?? []).filter((contract) => contract.status === 'measured').map((contract) => (
                <div key={contract.strike} className={cn(
                  'grid min-w-[430px] grid-cols-[46px_repeat(5,minmax(64px,1fr))] gap-x-2 border-b border-border/25 py-1 font-mono text-[9px] tabular-nums',
                  contract.strike === center && 'bg-[var(--brand-cyan)]/[0.06]',
                )}>
                  <span className="font-semibold">{contract.strike}</span>
                  <>
                    <span>${Number(contract.entryPremium).toFixed(2)}</span>
                    <span>${Number(contract.peakPremium).toFixed(2)}</span>
                    <span className="text-[var(--trade-bullish)]">+{Number(contract.peakReturnPct).toFixed(0)}%</span>
                    <span className="text-[var(--trade-bearish)]">{Number(contract.maxAdversePct).toFixed(0)}%</span>
                    <span className="text-[var(--brand-amber)]">+${Number(contract.peakMarkedPnl).toFixed(0)}</span>
                  </>
                </div>
              ))}
              <div className="mt-1 font-mono text-[8px] leading-relaxed text-muted-foreground">Unlisted/no-history strike values are omitted from the rows. Reported trade highs are counterfactual marks—not NBBO fills. Drawdown shows the danger of the cheapest contracts.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function executionStateCopy(state: ConvictionPick["lifecycleState"]): string {
  switch (state) {
    case "executed": return "Execution recorded — manage the open plan against its stop and first objective.";
    case "triggered": return "Trigger observed — execution still needs to be recorded.";
    case "coverage": return "Coverage only — no trade plan has been published.";
    case "thesis": return "Thesis forming — wait for an entry, stop, and first objective.";
    case "closed": return "This plan is closed and belongs in the review record.";
    default: return "Trigger watch — no position is recorded until the entry condition is observed.";
  }
}

/**
 * A held option has two simultaneous truths: premium P&L on the exact contract
 * and directional progress on the underlying. Putting both on one unlabeled
 * ladder made a losing far-OTM call look like a winning position whenever the
 * stock approached T1. Keep the units and decisions visibly separate.
 */
function HeldPositionStrip({ pick, liveUnderlying }: { pick: ConvictionPick; liveUnderlying: number | null }) {
  const qty = Number(pick.quantity ?? 1);
  const pnl = pick.unrealizedPnl;
  const pnlPct = pick.unrealizedPnlPercent;
  const entry = Number(pick.entryPrice);
  const target = Number(pick.targetPrice);
  const hasUnderlyingPlan = Number.isFinite(entry) && entry > 0 && Number.isFinite(target) && target > 0;
  const span = hasUnderlyingPlan ? Math.abs(target - entry) : 0;
  const moved = liveUnderlying == null || !hasUnderlyingPlan
    ? null
    : pick.direction === 'short' ? entry - liveUnderlying : liveUnderlying - entry;
  const progress = moved != null && span > 0 ? Math.max(0, Math.min(100, (moved / span) * 100)) : null;
  const contract = pick.strikePrice != null && pick.optionType
    ? `$${pick.strikePrice}${pick.optionType === 'put' ? 'P' : 'C'}`
    : 'contract';

  return (
    <div className="rounded-lg border border-card-border bg-card px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--brand-cyan)]">Held position · manage existing</span>
        <span className="font-mono text-[10px] text-muted-foreground">{contract} · {qty} contract{qty === 1 ? '' : 's'} · {pick.expiryDate ? String(pick.expiryDate).slice(0, 10) : 'expiry unknown'}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border/50 bg-foreground/[0.02] p-3">
          <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Contract premium · executable mark</div>
          <div className="mt-2 grid grid-cols-3 gap-3 font-mono tabular-nums">
            <div><div className="text-[9px] text-muted-foreground">ENTRY</div><div className="text-sm font-bold">{pick.entryPremium != null ? `$${Number(pick.entryPremium).toFixed(2)}` : '—'}</div></div>
            <div><div className="text-[9px] text-muted-foreground">MARK</div><div className="text-sm font-bold">{pick.currentPremium != null ? `$${Number(pick.currentPremium).toFixed(2)}` : '—'}</div></div>
            <div><div className="text-[9px] text-muted-foreground">OPTION P&L</div><div className="text-sm font-bold" style={{ color: Number(pnl ?? 0) >= 0 ? 'var(--trade-bullish)' : 'var(--trade-bearish)' }}>{pnl != null ? `${Number(pnl) >= 0 ? '+' : '−'}$${Math.abs(Number(pnl)).toFixed(0)}` : '—'}{pnlPct != null ? ` · ${Number(pnlPct) >= 0 ? '+' : ''}${Number(pnlPct).toFixed(1)}%` : ''}</div></div>
          </div>
          <div className="mt-2 font-mono text-[9px] text-muted-foreground">Paper P&L uses the exact held contract’s bid. No nearby-strike substitution.</div>
        </div>
        <div className="rounded-md border border-border/50 bg-foreground/[0.02] p-3">
          <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Underlying thesis · {pick.symbol} shares</div>
          <div className="mt-2 grid grid-cols-3 gap-3 font-mono tabular-nums">
            <div><div className="text-[9px] text-muted-foreground">ENTRY</div><div className="text-sm font-bold">{hasUnderlyingPlan ? `$${entry.toFixed(2)}` : '—'}</div></div>
            <div><div className="text-[9px] text-muted-foreground">LIVE</div><div className="text-sm font-bold">{liveUnderlying != null ? `$${liveUnderlying.toFixed(2)}` : '—'}</div></div>
            <div><div className="text-[9px] text-muted-foreground">TO T1</div><div className="text-sm font-bold">{progress != null ? `${progress.toFixed(0)}%` : '—'}</div></div>
          </div>
          <div className="mt-2 font-mono text-[9px] text-muted-foreground">Share-price progress is not option profit. Strike distance, IV, theta and spread can make them diverge.</div>
        </div>
      </div>
    </div>
  );
}

function HeldManagementPanel({ pick }: { pick: ConvictionPick }) {
  return (
    <CockpitCard title="Position management" meta="premium bracket · recorded at entry">
      <div className="grid grid-cols-3 gap-3 font-mono tabular-nums">
        <div><div className="text-[9px] text-muted-foreground">PREMIUM STOP</div><div className="text-sm font-bold text-[var(--trade-bearish)]">{pick.premiumStop != null ? `$${Number(pick.premiumStop).toFixed(2)}` : '—'}</div></div>
        <div><div className="text-[9px] text-muted-foreground">PREMIUM ENTRY</div><div className="text-sm font-bold">{pick.entryPremium != null ? `$${Number(pick.entryPremium).toFixed(2)}` : '—'}</div></div>
        <div><div className="text-[9px] text-muted-foreground">PREMIUM TARGET</div><div className="text-sm font-bold text-[var(--trade-bullish)]">{pick.premiumTarget != null ? `$${Number(pick.premiumTarget).toFixed(2)}` : '—'}</div></div>
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">The share-price ladder beside this panel tracks whether the thesis is working. This premium bracket governs the paper option position.</p>
    </CockpitCard>
  );
}

/**
 * Unfilled gaps for the selected ticker, drawn on the chart as shaded bands.
 * Untraded zones act as magnets — nobody holds a position inside them, so there
 * is no supply or demand shelf to slow price down. Cached hard: gaps only change
 * when a new daily bar prints.
 */
function useGapZones(symbol: string) {
  const { data } = useQuery<{ unfilled: any[]; stats: any } | null>({
    queryKey: ["/api/gaps", symbol],
    queryFn: async () => {
      const r = await fetch(`/api/gaps/${symbol}?range=2y`, {
        credentials: "include",
      });
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 60 * 60_000,
    retry: 0,
    enabled: !!symbol,
  });

  const zones = (data?.unfilled ?? []).slice(0, 3).map((g: any) => ({
    from: Math.min(g.from, g.to),
    to: Math.max(g.from, g.to),
    color: g.direction === "up" ? "#22c55e" : "#ef4444",
    label: `GAP ${g.distancePct >= 0 ? "+" : ""}${Number(g.distancePct).toFixed(1)}%`,
  }));

  return { zones, stats: data?.stats ?? null };
}

export default function HuntCockpit({ initialView, lockedView }: { initialView?: "grid" | "scanner" | "cockpit"; lockedView?: boolean } = {}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rangeId, setRangeId] = useState<(typeof RANGES)[number]["id"]>("1mo");
  const [mode, setMode] = useState<CockpitMode>("all");
  // ONE reduction for both lenses. Previously the rail had a ticker box and
  // NEW/BEST/CONVICTION while the grid had side/band/state/sort — so switching
  // view discarded whatever the reader had narrowed to.
  const {
    filters,
    set: setFilter,
    reset: resetFilters,
    active: filtersActive,
  } = useSignalFilters();
  const [grading, setGrading] = useState<string | null>(null);
  const [graded, setGraded] = useState<GradedTicker | null>(null);
  // An arbitrary ticker can be genuinely analysed without being a scanner-
  // published trade. Keep that distinction in the data model, but give it the
  // same place in the active stream and the same centre-stage interaction.
  const [onDemandFocused, setOnDemandFocused] = useState(false);
  const [confidenceInfoOpen, setConfidenceInfoOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  /**
   * Read a ticker the book does not carry. The legacy universal analyzer emits
   * a generic 0–100 company score and fabricates percentage-based exits; that
   * is neither a Conviction score nor a tradable setup. Search instead returns
   * real directional conditions, keeps it visibly as a WATCH, and tells the
   * reader what still has to happen before publication.
   */
  /**
   * Put a graded off-book ticker on the watchlist.
   *
   * Grading answered "what does the platform think of NOK" but the answer
   * evaporated on the next keystroke. The watchlist is what the scanners read,
   * so adding it there is what actually makes the platform start tracking the
   * name — which is the point of having asked.
   *
   * The grade travels with it in `notes`, so the entry records what the read was
   * WHEN it was added rather than looking like an unexplained ticker later.
   */
  const addGradedToWatchlist = async () => {
    if (!graded) return;
    setAdding(true);
    try {
      // apiRequest, not raw fetch — every mutating endpoint here is CSRF-guarded
      // and a bare fetch is rejected with "CSRF validation failed".
      const r = await apiRequest("POST", "/api/watchlist", {
        symbol: graded.symbol,
        assetType: "stock",
        category: "active",
        notes:
          `Graded on demand ${new Date().toISOString().slice(0, 10)}: ` +
          `${graded.grade ?? "—"}${graded.score != null ? ` · ${graded.score}` : ""}`,
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        setAdded(
          b?.error
            ? `Couldn't add: ${b.error}`
            : `Couldn't add ${graded.symbol}.`,
        );
      } else {
        setAdded(
          `${graded.symbol} added to watchlist — scanners pick it up on the next run.`,
        );
      }
    } catch (e: any) {
      setAdded(
        `Couldn't add ${graded.symbol}: ${e?.message ?? "request failed"}`,
      );
    } finally {
      setAdding(false);
    }
  };

  const gradeTicker = async (symbol: string) => {
    setGrading(symbol);
    setGraded(null);
    setOnDemandFocused(false);
    setAdded(null);
    try {
      const r = await fetch(`/api/ticker/${encodeURIComponent(symbol)}/read`, {
        credentials: "include",
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Yahoo's crumb endpoint returns a raw provider error under load. That is
        // an infrastructure condition, not a verdict on the ticker; never make it
        // read like QuantEdge rejected the setup.
        const retryNote =
          r.status === 429
            ? "Market quote provider is rate-limited. This is not a grade — retry once the live quote refreshes."
            : null;
        setGraded({
          symbol,
          text:
            retryNote ||
            body?.details ||
            body?.error ||
            "Analysis unavailable.",
        });
      } else {
        const directional = body.directional ?? {};
        const bias = String(directional.bias ?? "neutral").toUpperCase();
        const aligned = Number(directional.aligned ?? 0);
        const assessed = Number(directional.assessed ?? 0);
        setGraded({
          symbol,
          grade: null,
          score: null,
          analysis: { symbol, read: body } as OnDemandAnalysis,
          text: `${symbol}: ${bias} WATCH · ${aligned}/${assessed} directional conditions align.`,
        });
        setSelectedId(null);
        setOnDemandFocused(true);
      }
    } catch (e: any) {
      setGraded({ symbol, text: e?.message ?? "Request failed." });
    } finally {
      setGrading(null);
    }
  };
  const [streamFilter, setStreamFilter] = useState<
    "new" | "best" | "conviction"
  >("conviction");
  // Cockpit is the live ranked stream; Grid is the comparison lens. This state
  // lives before the derived book so each lens can own its correct sort order.
  const [view, setView] = useState<"grid" | "scanner" | "cockpit">(initialView ?? "grid");
  // Two searches, two different verbs. The one in the terminal chrome LOADS and grades any
  // ticker; this one only FILTERS the signals already on the board. Conflating them made
  // searching feel broken — you'd type a name and not know which behaviour you'd get.
  const [sharingDiscord, setSharingDiscord] = useState(false);
  const subjectRef = useRef<HTMLElement>(null);

  // ── Shareable full-board screenshot ──────────────────────────────────────
  // Captures the entire Hunt board (signals list + selected subject + analytics)
  // to a PNG. Scroll/sticky containers are temporarily expanded so nothing is
  // clipped, then restored. Uses the native share sheet when the browser supports
  // sharing files (best for "send to people"); otherwise downloads the PNG.
  const captureRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);

  // High-priority index calls arrive over the same durable websocket used by
  // bot execution events. The toast is immediate; invalidating the book then
  // lets the canonical card appear as soon as persistence finishes.
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/bot`);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const symbol = String(message.symbol || "").toUpperCase();
          if (message.type !== "bot_event" || message.eventType !== "signal" || !["SPX", "SPY", "QQQ", "IWM"].includes(symbol)) return;
          const contract = message.optionType && message.strike != null
            ? `${message.strike}${message.optionType === "call" ? "C" : "P"}`
            : "index setup";
          const setup = String(message.reason || "").split("|")[0].replaceAll("_", " ");
          toast({
            title: `⚡ ${symbol} ${contract} called`,
            description: `${setup || "Index alert"}${message.price ? ` · $${Number(message.price).toFixed(2)}` : ""} · open Cockpit for trigger, stop and targets.`,
          });
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(`QuantEdge · ${symbol} ${contract}`, {
              body: `${setup || "Index alert"}${message.price ? ` at $${Number(message.price).toFixed(2)}` : ""}`,
              tag: `qe-index-${symbol}-${message.strike ?? "setup"}`,
            });
          }
          window.setTimeout(() => {
            void queryClient.invalidateQueries({ queryKey: ["/api/convictions"] });
            void queryClient.invalidateQueries({ queryKey: ["/api/ideas/ledger"] });
          }, 500);
        } catch {
          // Ignore non-JSON websocket frames; the price feed uses another path.
        }
      };
      socket.onclose = () => {
        if (!stopped) retry = setTimeout(connect, 3_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [queryClient, toast]);
  const railRef = useRef<HTMLElement>(null);
  const [capturing, setCapturing] = useState(false);

  // An analysed name is inserted at the top of this scroll rail. Without this,
  // a reader who had been deep in a 40-name stream would land on its evidence
  // canvas while the row that selected it stayed above the visible rail.
  useEffect(() => {
    if (onDemandFocused)
      listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [onDemandFocused]);

  const shareBoard = async () => {
    const node = captureRef.current;
    if (!node || capturing) return;
    setCapturing(true);

    const list = listRef.current;
    const rail = railRef.current;
    const prevList = list
      ? { maxHeight: list.style.maxHeight, overflow: list.style.overflow }
      : null;
    const prevRail = rail
      ? { position: rail.style.position, top: rail.style.top }
      : null;
    // Lift the scroll clip on the signals list + the sticky on the right rail so
    // the capture shows the full content, not just the viewport slice.
    if (list) {
      list.style.maxHeight = "none";
      list.style.overflow = "visible";
    }
    if (rail) {
      rail.style.position = "static";
      rail.style.top = "auto";
    }

    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(node, {
        backgroundColor: "#0a0a0a",
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: node.scrollWidth,
      });
      const fileName = `quantedge-hunt-${new Date().toISOString().slice(0, 10)}.png`;
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/png"),
      );

      // Prefer the native share sheet (mobile + some desktop) when it can take files.
      const file = blob
        ? new File([blob], fileName, { type: "image/png" })
        : null;
      const canShareFile =
        !!file &&
        typeof navigator.canShare === "function" &&
        (() => {
          try {
            return navigator.canShare({ files: [file] });
          } catch {
            return false;
          }
        })();

      if (canShareFile && file) {
        await navigator.share({
          files: [file],
          title: "QuantEdge Hunt",
          text: "My QuantEdge Hunt signals",
        });
      } else {
        const link = document.createElement("a");
        link.download = fileName;
        link.href = canvas.toDataURL("image/png");
        link.click();
        toast({ title: "Screenshot saved", description: fileName });
      }
    } catch (e) {
      // AbortError = user dismissed the share sheet; not an error worth surfacing.
      if ((e as Error)?.name !== "AbortError") {
        toast({
          title: "Capture failed",
          description: "Could not generate the screenshot.",
          variant: "destructive",
        });
      }
    } finally {
      if (list && prevList) {
        list.style.maxHeight = prevList.maxHeight;
        list.style.overflow = prevList.overflow;
      }
      if (rail && prevRail) {
        rail.style.position = prevRail.position;
        rail.style.top = prevRail.top;
      }
      setCapturing(false);
    }
  };

  // ── Share the selected setup to Discord (ported from the old Trade Desk) ──
  // Renders the center subject card to a PNG and posts it to the dedicated
  // Trade Desk card webhook via the existing /share-discord-card route.
  const shareToDiscord = async (pick: ConvictionPick) => {
    const node = subjectRef.current;
    if (!node || sharingDiscord) return;
    setSharingDiscord(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(node, {
        backgroundColor: "#0a0a0a",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/png"),
      );
      if (!blob) throw new Error("render failed");
      const form = new FormData();
      form.append("card", blob, `${pick.symbol}_${pick.direction}_card.png`);
      const res = await fetch(
        `/api/trade-ideas/${pick.ideaId}/share-discord-card`,
        {
          method: "POST",
          body: form,
          credentials: "include",
        },
      );
      if (!res.ok) throw new Error(`share failed (${res.status})`);
      toast({
        title: "Sent to Discord",
        description: `${pick.symbol} card posted.`,
      });
    } catch {
      toast({
        title: "Discord share failed",
        description: "Could not post the card.",
        variant: "destructive",
      });
    } finally {
      setSharingDiscord(false);
    }
  };

  // Widened pool (lower floor, higher limit) so the mode tabs — AI Picks / Flow /
  // Lotto / News / Manual — each have ideas to show, giving the cockpit the same
  // reach the standalone Trade Desk had.
  // EMBEDDED (lockedView, mounted under the NEXUS "ranked book" toggle) the
  // cockpit must show the SAME slice the grid shows — the operator caught grid
  // and cockpit disagreeing about "the book" because this query widened the
  // pool (floor 10, whole universe) while the grid asked for the watchlist
  // top-24. Two views of one book cannot have two definitions of the book.
  // STANDALONE keeps the widened pool so the mode tabs still have reach.
  const bookQuery = lockedView
    ? "/api/convictions?limit=24&minScore=0"
    : "/api/convictions?limit=40&minScore=10&watchlistOnly=false";
  const { data, isLoading, isError } = useQuery<ConvictionsResponse>({
    // Embedded, the key MUST match the grid's exactly — a cold rebuild of the
    // conviction board takes ~13s, and a cockpit with its own key sat on a
    // spinner for all of it while the grid's warm cache held the same data.
    queryKey: lockedView ? ["/api/convictions", "nexus"] : ["/api/convictions", bookQuery],
    queryFn: async () => {
      const res = await fetch(bookQuery, { credentials: "include" });
      if (!res.ok) throw new Error("convictions failed");
      return res.json();
    },
    /**
     * Poll fast enough that a moving position actually looks like it is moving.
     *
     * At a 60s interval with a 30s staleTime, a bot position that ran from
     * −$50 to +$1,650 arrived as a single silent re-render — the number was
     * correct and the change was invisible. 15s matches roughly how often the
     * mark-to-market job rewrites unrealized_pnl, so most polls carry real
     * movement rather than burning a request on identical data.
     *
     * refetchOnWindowFocus catches the common case of coming back to the tab
     * after a while and wanting the truth immediately.
     */
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  // Cockpit is the operational surface. Recently resolved calls stay visible
  // here after they leave the active-entry pool, so a target hit does not seem
  // to vanish into a separate audit page the moment it resolves.
  const { data: recentDecisionData } = useQuery<{
    ledger?: PublishedIdeaRow[];
  }>({
    queryKey: ['/api/ideas/ledger', 'cockpit-recent'],
    queryFn: async () => {
      const res = await fetch('/api/ideas/ledger?limit=200&sessions=10', { credentials: 'include' });
      if (!res.ok) throw new Error('recent decisions failed');
      return res.json();
    },
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 0,
  });
  const recentDecisions = useMemo(
    () => (recentDecisionData?.ledger ?? [])
      .filter((row) => row.outcome && row.outcome !== 'open')
      .filter((row) => !['SPX', 'SPY', 'QQQ', 'IWM'].includes(row.symbol.toUpperCase()))
      .slice(0, 4),
    [recentDecisionData],
  );
  const indexTrackRows = useMemo(
    () => (recentDecisionData?.ledger ?? [])
      .filter((row) => ['SPX', 'SPY', 'QQQ', 'IWM'].includes(row.symbol.toUpperCase()))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 6),
    [recentDecisionData],
  );

  // Held inventory is marked by the bot ledger, while entry candidates come
  // from the convictions snapshot. Overlay only contract/P&L fields here—never
  // put an option premium into `currentPrice`, which is underlying-space.
  const { data: liveBotBook } = useQuery<{
    openPositions?: Array<{
      symbol: string; currentPrice?: number | null; entryPrice?: number | null;
      unrealizedPnL?: number | null; unrealizedPnLPercent?: number | null;
      lastPriceUpdate?: string | null; highWaterMark?: number | null;
      quantity?: number | null; optionType?: string | null; strikePrice?: number | null;
    }>;
  }>({
    queryKey: ["/api/quant-bot/status", "nexus"],
    queryFn: async () => {
      const res = await fetch('/api/quant-bot/status', { credentials: 'include' });
      if (!res.ok) throw new Error('bot book failed');
      return res.json();
    },
    staleTime: 45_000,
    refetchInterval: 60_000,
    retry: 0,
  });
  const botMarks = useMemo(() => new Map(
    (liveBotBook?.openPositions ?? []).map((p) => [p.symbol.toUpperCase(), p]),
  ), [liveBotBook]);
  const bankablePositions = useMemo(() => (liveBotBook?.openPositions ?? [])
    .map((position) => {
      const entry = Number(position.entryPrice);
      const peak = Number(position.highWaterMark);
      const mfe = entry > 0 && peak > 0 ? (peak / entry - 1) * 100 : null;
      return { ...position, mfe };
    })
    .filter((position) => position.mfe != null && position.mfe >= 10)
    .sort((a, b) => Number(b.mfe) - Number(a.mfe)), [liveBotBook?.openPositions]);
  const allPicks = useMemo(() => (data?.picks ?? []).map((pick) => {
    if (!pick.isBotHeld) return pick;
    const mark = botMarks.get(pick.symbol.toUpperCase());
    if (!mark) return pick;
    return {
      ...pick,
      currentPremium: mark.currentPrice ?? pick.currentPremium,
      premiumMarkedAt: mark.lastPriceUpdate ?? pick.premiumMarkedAt,
      unrealizedPnl: mark.unrealizedPnL ?? pick.unrealizedPnl,
      unrealizedPnlPercent: mark.unrealizedPnLPercent ?? pick.unrealizedPnlPercent,
    };
  }), [data?.picks, botMarks]);
  const publishedAudit = useMemo(() => {
    const activeIds = new Set(allPicks.map((pick) => pick.ideaId));
    const heldSymbols = new Set(
      allPicks.filter((pick) => pick.isBotHeld).map((pick) => pick.symbol.toUpperCase()),
    );
    return (recentDecisionData?.ledger ?? []).map((row) => {
      const active = activeIds.has(row.id);
      const held = heldSymbols.has(row.symbol.toUpperCase());
      const state = active ? 'active' : held ? 'held' : row.outcome !== 'open' ? 'resolved' : 'archive';
      const rr = Number(row.riskRewardRatio);
      const reason = active
        ? Number.isFinite(rr) && rr < 1
          ? `live book warning: reward/risk ${rr.toFixed(2)} is below 1.0`
          : 'admitted to the live ranked book'
        : held
          ? 'managed as an open paper position'
          : row.archiveReason ?? 'published record; not in the current live book';
      return { ...row, state, reason };
    });
  }, [allPicks, recentDecisionData?.ledger]);
  const publishedAuditCounts = useMemo(() => ({
    active: publishedAudit.filter((row) => row.state === 'active').length,
    held: publishedAudit.filter((row) => row.state === 'held').length,
    resolved: publishedAudit.filter((row) => row.state === 'resolved').length,
    archive: publishedAudit.filter((row) => row.state === 'archive').length,
  }), [publishedAudit]);
  // One bounded quote stream for the entire 40-name book. Before this only the
  // selected subject had a quote, leaving the other 39 cards permanently static.
  const signalSymbols = useMemo(
    () =>
      [
        ...new Set(allPicks.map((p) => p.symbol.toUpperCase()).filter(Boolean)),
      ].slice(0, 50),
    [allPicks],
  );
  const { data: quoteBook, dataUpdatedAt: quoteBookUpdatedAt } = useQuery<{
    quotes?: Record<
      string,
      { price: number; change: number; changePercent: number; asOf?: string }
    >;
  }>({
    queryKey: ["/api/quotes/batch", "cockpit-book", signalSymbols.join(",")],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/batch/${signalSymbols.join(",")}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("book quotes failed");
      return res.json();
    },
    enabled: signalSymbols.length > 0,
    staleTime: 15_000,
    refetchInterval: 20_000,
    retry: 1,
  });
  const liveBySymbol = useMemo(
    () =>
      new Map(
        Object.entries(quoteBook?.quotes ?? {}).map(([symbol, q]) => [
          symbol.toUpperCase(),
          q.price,
        ]),
      ),
    [quoteBook],
  );
  const priceFor = (p: ConvictionPick) =>
    liveBySymbol.get(p.symbol.toUpperCase()) ?? p.currentPrice ?? p.entryPrice;
  // Per-mode counts for the tab badges.
  const modeCounts = useMemo(() => {
    const counts: Record<CockpitMode, number> = {
      all: 0,
      "ai-picks": 0,
      flow: 0,
      lotto: 0,
      news: 0,
      manual: 0,
    };
    for (const m of COCKPIT_MODES)
      counts[m.id] = allPicks.filter((p) => matchesMode(p, m.id)).length;
    return counts;
  }, [allPicks]);
  // Show "All" plus only the engines that actually have ideas right now.
  const visibleModes = useMemo(
    () => COCKPIT_MODES.filter((m) => m.id === "all" || modeCounts[m.id] > 0),
    [modeCounts],
  );
  // If the active mode lost its ideas (data refreshed), fall back to "All".
  const activeMode: CockpitMode = visibleModes.some((m) => m.id === mode)
    ? mode
    : "all";
  const picks = useMemo(
    () => allPicks.filter((p) => matchesMode(p, activeMode)),
    [allPicks, activeMode],
  );

  // ─── "What's new" ─────────────────────────────────────────────
  // Discord pings new ideas; the platform needs the same signal. Baseline = the
  // last time the user looked (localStorage); any pick generated after it is NEW.
  // Leaving the page marks everything seen, so the next visit only flags what
  // genuinely arrived since. First-ever visit shows nothing as new (no noise).
  const SEEN_KEY = "qe:aipicks:lastSeen";
  const [baselineSeen, setBaselineSeen] = useState<number>(() => {
    try {
      const v = localStorage.getItem(SEEN_KEY);
      return v ? new Date(v).getTime() : Date.now();
    } catch {
      return Date.now();
    }
  });
  const isNew = (p: ConvictionPick) => {
    const t = new Date(p.generatedAt).getTime();
    return Number.isFinite(t) && t > baselineSeen;
  };
  const newCount = useMemo(
    () => picks.filter(isNew).length,
    [picks, baselineSeen],
  );
  const markSeen = () => {
    const now = Date.now();
    try {
      localStorage.setItem(SEEN_KEY, new Date(now).toISOString());
    } catch {
      /* private mode */
    }
    setBaselineSeen(now);
    // Marking everything seen drops newCount to 0, so leaving the stream on 'new'
    // would strand the user on an empty list. Fall back to the default ranking.
    setStreamFilter("conviction");
  };
  useEffect(
    () => () => {
      try {
        localStorage.setItem(SEEN_KEY, new Date().toISOString());
      } catch {
        /* private mode */
      }
    },
    [],
  );
  // ALERT STREAM filter — the three reads the desk actually uses:
  //   NEW        = just fired, nothing else earned yet
  //   BEST       = furthest along toward T1 (already working)
  //   CONVICTION = highest rated regardless of progress
  // A signal is "closed" once price has resolved it — target reached or stop taken out.
  // The convictions feed only returns open ideas, so we classify by geometry rather than
  // inventing a status the backend doesn't track yet.
  /**
   * A position the bot HOLDS is never "closed today".
   *
   * Geometry is computed by comparing a live price against entryPrice. For a
   * bot-held option row those two are in DIFFERENT UNITS — entryPrice is the
   * premium paid ($9.70 for PANW), priceFor() returns the underlying (~$410) —
   * so progress came out at +3840%, tripped the >=95% at_target rule, and
   * eleven open positions rendered under "Closed today · 13" while the bot log
   * said "10 position(s) held". The same mismatch produced the +10355% and
   * +16249% figures, and the constant R:R 2.0 (paper targets are stored at 2x
   * premium, stops at 0.5x).
   *
   * Held rows carry their own truth — status is 'open' in paper_positions and
   * P&L is marked to market — so they are excluded from this derivation rather
   * than having their geometry patched. Entry geometry does not describe a
   * position you are already in.
   */
  const closedToday = picks.filter((p) => {
    if ((p as any).isBotHeld) return false;
    const st = geometryFor(p, priceFor(p)).status;
    return st === "at_target" || st === "invalidated";
  });
  const openPicks = picks.filter((p) => !closedToday.includes(p));

  // NEW stays a separate axis — it is a "since you last looked" flag, not a
  // property of the signal, so it does not belong in the shared filter model.
  const streamBase =
    streamFilter === "new" ? openPicks.filter(isNew) : openPicks;
  // BEST is now live progress, not a button that only changes its highlight.
  // Motion layout in SignalRow turns quote-driven sort changes into visible rank travel.
  const effectiveFilters =
    view === "cockpit"
      ? {
          ...filters,
          sort: (streamFilter === "best"
            ? "progress"
            : "conviction") as typeof filters.sort,
        }
      : filters;
  const shown = applyFilters(streamBase, effectiveFilters, (p) =>
    geometryFor(p, priceFor(p)),
  );

  const selected: ConvictionPick | undefined =
    shown.find((p) => p.ideaId === selectedId) ?? shown[0] ?? picks[0];
  const selectedIsIndexIntraday = Boolean(
    selected &&
    ["SPX", "SPY", "QQQ", "IWM"].includes(selected.symbol.toUpperCase()) &&
    (selected.holdingPeriod === "day" || selected.optionDte === 0),
  );
  const onDemand = onDemandFocused ? graded?.analysis : null;

  // Unfilled gaps for the selected ticker — drawn as bands on the chart below.
  const { zones: gapZones } = useGapZones(selected?.symbol ?? "");

  // Live quote for the selected ticker's header price.
  const { data: selectedQuote } = useQuery<{
    symbol: string;
    price: number;
    change: number;
    changePct: number;
    asOf?: string;
  }>({
    queryKey: ["/api/quotes/batch", selected?.symbol],
    queryFn: async () => {
      const res = await fetch(`/api/quotes/batch/${selected!.symbol}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("quote failed");
      const body = await res.json();
      const q = body?.quotes?.[selected!.symbol];
      if (!q) throw new Error("no quote");
      return {
        symbol: selected!.symbol.toUpperCase(),
        price: q.price,
        change: q.change,
        changePct: q.changePercent,
        asOf: q.asOf,
      };
    },
    enabled: !!selected?.symbol,
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });
  // TanStack keeps the prior query result during a key change. That is useful
  // for many lists, but fatal on a trade card: UEC must never briefly show
  // HCA's price while its own quote arrives. The live book quote is a correct
  // immediate fallback; the per-symbol quote only joins once its symbol agrees.
  // The whole-board stream gets a fresh pass every 20 seconds; prefer that
  // matching quote for the selected subject so the hero and its row move on the
  // same real print. The single-symbol request is the fallback, not a competing
  // stale source.
  const bookQuote = selected ? quoteBook?.quotes?.[selected.symbol.toUpperCase()] : undefined;
  const quote = bookQuote
    ? {
        symbol: selected!.symbol.toUpperCase(),
        price: bookQuote.price,
        change: bookQuote.change,
        changePct: bookQuote.changePercent,
        asOf: bookQuote.asOf,
      }
    : selectedQuote?.symbol === selected?.symbol.toUpperCase()
      ? selectedQuote
      : undefined;

  // The engine's active pick, lifted so the hero can show the trade without a
  // second fetch. Reset per signal — otherwise the previous ticker's contract
  // renders under the new one's header for as long as the refetch takes.
  // COCKPIT = one signal in depth. GRID = the whole book side by side. The rail
  // shows ~6 rows, so every comparative question about 40 signals was a scrolling
  // exercise; this is the same lens pair as LEAPS list/grid.
  const [enginePick, setEnginePick] = useState<TradeStripPick | null>(null);
  useEffect(() => {
    setEnginePick(null);
  }, [selectedId]);
  const engineRef = useRef<HTMLDivElement>(null);

  const kpis = useMemo(() => {
    const avg = picks.length
      ? picks.reduce((s, p) => s + p.convictionScore, 0) / picks.length
      : 0;
    const top = picks.length
      ? Math.max(...picks.map((p) => p.convictionScore))
      : 0;
    const longs = picks.filter((p) => p.direction === "long").length;
    return [
      {
        label: "Active Signals",
        value: String(picks.length),
        tone: "neutral" as const,
      },
      {
        label: "Avg Evidence",
        value: avg ? `${convictionPercent(avg)}/100` : "—",
        tone: "bull" as const,
      },
      {
        label: "Top Evidence",
        value: top ? `${convictionPercent(top)}/100` : "—",
        tone: "bull" as const,
      },
      {
        label: "Long / Short",
        value: `${longs} / ${picks.length - longs}`,
        tone: "muted" as const,
      },
      // Regime and VIX deliberately NOT here. This strip measures the BOOK — how
      // many signals, how confident, which way they lean — and every entry should
      // change when the book changes. Regime is a market fact: it was printing the
      // identical value the Market Context panel shows ~1,400px below, so the same
      // word appeared twice on one screen with nothing to say which was
      // authoritative. It reads once now, in the panel that explains it alongside
      // risk sentiment, bias, breadth and geopolitical risk.
    ];
  }, [picks]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--brand-cyan)]" />
      </div>
    );
  }

  if (isError || allPicks.length === 0) {
    return (
      <div className="px-4 py-3 space-y-3">
        <div className="flex flex-col items-center justify-center h-[40vh] gap-2 text-center">
          <AlertTriangle className="w-5 h-5 text-[var(--trade-neutral)]" />
          <p className="text-sm font-mono text-muted-foreground">
            {isError
              ? "Could not load signals right now."
              : "This signal book has no published records yet."}
          </p>
          {/*
            This used to assert that a Neon → Supabase migration had not run.
            That was a guess dressed as a diagnosis: the database holds 600
            ideas, and the real cause of an empty board is almost always that
            candidates aged out or no scan has published since boot. Naming a
            cause we have not checked sends the reader to fix the wrong thing.
            Say what is true — the board is empty — and why that can happen,
            without claiming to know which reason applies.
          */}
          <p className="text-[11px] font-mono text-muted-foreground">
            {isError
              ? "The signals endpoint did not respond. The book is unchanged — this is a display failure, not an empty book."
              : "Nothing has cleared the gate in this window. Scanners publish on a cycle and candidates retire at their holding-period age cap, so the board can be legitimately empty right after a restart or early in a session. We do not pad it with invented trades."}
          </p>
        </div>
      </div>
    );
  }

  const tone = selected ? directionTone(selected.direction) : "bull";
  // One live price for every geometry panel, so the ladder / geometry / R:R agree.
  const livePx = quote?.price ?? (selected ? priceFor(selected) : 0);

  // Headline numbers for the rail's Readout blocks. Net contribution is the
  // arithmetic behind the score: a 29 built on +36/−7 is a different trade from
  // a 29 with nothing against it, and only the net makes that visible up top.
  const netPoints = (selected?.layers ?? []).reduce(
    (n, l) => n + (l.points ?? 0),
    0,
  );
  const plusPoints = (selected?.layers ?? [])
    .filter((l) => (l.points ?? 0) > 0)
    .reduce((n, l) => n + l.points, 0);
  const minusPoints = (selected?.layers ?? [])
    .filter((l) => (l.points ?? 0) < 0)
    .reduce((n, l) => n + l.points, 0);
  const toneColor =
    tone === "bull" ? "var(--trade-bullish)" : "var(--trade-bearish)";
  const activeRange = RANGES.find((r) => r.id === rangeId)!;

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Single action bar: MODE engine tabs (left) share one row with the
          share actions (right). The shell already renders the "HUNT" title +
          tab strip above us, so we don't repeat a page header here.
          MODE tabs auto-hide engines with no live ideas, keeping it calm. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {visibleModes.length > 1 ? (
          <QETabs
            items={visibleModes.map((m) => ({
              id: m.id,
              label: m.label,
              hint: m.hint,
              count: modeCounts[m.id],
            }))}
            active={mode}
            onChange={(m) => {
              setMode(m);
              setSelectedId(null);
            }}
            prefixLabel="MODE"
            className="min-w-0"
          />
        ) : (
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Ranked Conviction Signals
          </span>
        )}
        <div className="flex items-center gap-2 shrink-0">
          {selected && (
            <button
              onClick={() => shareToDiscord(selected)}
              disabled={sharingDiscord}
              title="Post the selected setup card to Discord"
              className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1.5 rounded-md border border-[#5865F2]/40 bg-[#5865F2]/10 text-[#8b94f7] hover:bg-[#5865F2]/20 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
              data-testid="button-share-discord"
            >
              {sharingDiscord ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SiDiscord className="h-3.5 w-3.5" />
              )}
              {sharingDiscord ? "Posting…" : "Discord"}
            </button>
          )}
          <button
            onClick={shareBoard}
            disabled={capturing}
            title="Capture the full Hunt board as a shareable PNG"
            className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1.5 rounded-md border border-[var(--brand-cyan)]/30 bg-[var(--brand-cyan)]/10 text-[var(--brand-cyan)] hover:bg-[var(--brand-cyan)]/20 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            data-testid="button-share-board"
          >
            {capturing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
            {capturing ? "Capturing…" : "Share board"}
          </button>
        </div>
      </div>

      {indexTrackRows.length > 0 && (
        <section className="rounded-lg border border-[var(--brand-cyan)]/25 bg-[var(--brand-cyan)]/[0.025] px-3 py-2" aria-label="Index trade performance tracker">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--brand-cyan)]">
                Index performance tape
              </div>
              <div className="mt-0.5 text-[9px] font-mono text-muted-foreground">
                SPX · SPY · QQQ · IWM — signal → contract path → bankable marks
              </div>
            </div>
            <span className="text-[8px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              replay marks are not broker fills
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {indexTrackRows.map((row) => {
              const entry = row.entryPremium == null ? null : Number(row.entryPremium);
              const exit = row.exitPremium == null ? null : Number(row.exitPremium);
              const gain = row.optionPercentGain == null ? null : Number(row.optionPercentGain);
              const peak = row.peakPremium == null ? null : Number(row.peakPremium);
              const peakGain = row.peakOptionPercentGain == null ? null : Number(row.peakOptionPercentGain);
              const peakPnl = row.markedPnlAtPeak == null ? null : Number(row.markedPnlAtPeak);
              const markedPnl = row.realizedPnL == null ? null : Number(row.realizedPnL);
              const won = row.outcome === 'hit_target';
              const open = row.outcome === 'open';
              const contract = row.optionType && row.strikePrice != null
                ? `${Number(row.strikePrice)}${row.optionType === 'call' ? 'C' : 'P'}`
                : null;
              return (
                <article
                  key={`index-track-${row.id}`}
                  className={cn(
                    'rounded-md border px-3 py-2.5',
                    won
                      ? 'border-[var(--trade-bullish)]/35 bg-[var(--trade-bullish)]/[0.045]'
                      : open
                        ? 'border-[var(--brand-cyan)]/25 bg-background/50'
                        : 'border-border/50 bg-background/40',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-sm font-semibold text-foreground">
                        {row.symbol}{contract ? ` ${contract}` : ''}
                      </div>
                      <div className="mt-0.5 text-[9px] font-mono text-muted-foreground">
                        {row.source === 'tradingview' ? 'closing-drive alert' : row.source?.replaceAll('_', ' ') || 'index engine'}
                      </div>
                    </div>
                    <span className={cn(
                      'rounded border px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wide',
                      won
                        ? 'border-[var(--trade-bullish)]/35 text-[var(--trade-bullish)]'
                        : open
                          ? 'border-[var(--brand-cyan)]/30 text-[var(--brand-cyan)]'
                          : 'border-border text-muted-foreground',
                    )}>
                      {won ? 'T1 hit' : open ? 'tracking' : row.outcome.replaceAll('_', ' ')}
                    </span>
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border/40 pt-2 font-mono">
                    <div>
                      <div className="text-[8px] uppercase tracking-wide text-muted-foreground">Entry</div>
                      <div className="mt-0.5 text-[11px] text-foreground">{entry == null ? '—' : `$${entry.toFixed(2)}`}</div>
                    </div>
                    <div>
                      <div className="text-[8px] uppercase tracking-wide text-muted-foreground">T1 / exit</div>
                      <div className="mt-0.5 text-[11px] text-foreground">{exit == null ? '—' : `$${exit.toFixed(2)}`}</div>
                    </div>
                    <div>
                      <div className="text-[8px] uppercase tracking-wide text-muted-foreground">Peak mark</div>
                      <div className="mt-0.5 text-[11px] text-foreground">{peak == null ? '—' : `$${peak.toFixed(2)}`}</div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
                    {gain != null && (
                      <span className={gain >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}>
                        T1 {gain >= 0 ? '+' : ''}{gain.toFixed(1)}%
                      </span>
                    )}
                    {markedPnl != null && (
                      <span className={markedPnl >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}>
                        {markedPnl >= 0 ? '+' : '−'}${Math.abs(markedPnl).toFixed(0)} marked
                      </span>
                    )}
                    {peakGain != null && (
                      <span className="text-[var(--brand-amber)]">
                        peak +{peakGain.toFixed(0)}%{peakPnl != null ? ` · +$${peakPnl.toFixed(0)}/contract` : ''}
                      </span>
                    )}
                  </div>
                  <IndexStrikeLadder row={row} />
                </article>
              );
            })}
          </div>
        </section>
      )}

      {(recentDecisions.length > 0 || bankablePositions.length > 0) && (
        <section className="rounded-lg border border-border/60 bg-card/35 px-3 py-2" aria-label="Recent resolved calls">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Recent decisions · still visible in Cockpit
            </span>
            <span className="text-[9px] font-mono text-muted-foreground">realized exits + labeled replays + open-trade MFE</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {recentDecisions.map((row) => {
              const gain = row.optionPercentGain == null ? null : Number(row.optionPercentGain);
              const mfeMatch = row.outcomeNotes?.match(/peak \$[\d.]+ \(\+?([\d.]+)%\)/i);
              const pathMfe = mfeMatch ? Number(mfeMatch[1]) : null;
              const won = row.outcome === 'hit_target';
              const isReplay = row.dataSourceUsed === 'yahoo-opr-trades';
              const provenance = isReplay
                ? 'recorded replay'
                : row.source === 'quant-bot'
                  ? 'paper bot'
                  : 'engine outcome';
              const contract = row.optionType && row.strikePrice != null
                ? `${row.strikePrice}${row.optionType === 'call' ? 'C' : 'P'}`
                : null;
              return (
                <div key={row.id} className="rounded-md border border-border/50 bg-background/45 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{row.symbol}{contract ? ` ${contract}` : ''}</span>
                    <span className={cn(
                      'text-[9px] font-mono uppercase tracking-wide',
                      won ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]',
                    )}>
                      {won
                        ? 'contract target hit'
                        : pathMfe != null && pathMfe >= 10
                          ? `+${pathMfe.toFixed(0)}% MFE · ${row.outcome.replaceAll('_', ' ')}`
                          : row.outcome.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {row.entryPremium != null ? `$${Number(row.entryPremium).toFixed(2)}` : '—'}
                    {' → '}
                    {row.exitPremium != null ? `$${Number(row.exitPremium).toFixed(2)}` : '—'}
                    {gain != null && (
                      <span className={cn('ml-2', gain >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]')}>
                        {gain >= 0 ? '+' : ''}{gain.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[8px] font-mono uppercase tracking-[0.14em] text-muted-foreground/75">
                    {provenance}
                  </div>
                </div>
              );
            })}
            {bankablePositions.slice(0, 4).map((position) => {
              const contract = position.optionType && position.strikePrice != null
                ? `${Number(position.strikePrice)}${position.optionType === 'call' ? 'C' : 'P'}`
                : null;
              return (
                <div key={`mfe-${position.symbol}-${position.strikePrice ?? ''}`} className="rounded-md border border-[var(--trade-bullish)]/25 bg-[var(--trade-bullish)]/[0.035] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{position.symbol}{contract ? ` ${contract}` : ''}</span>
                    <span className="text-[9px] font-mono uppercase tracking-wide text-[var(--trade-bullish)]">
                      crossed +10%
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    Peak premium excursion
                    <span className="ml-2 text-[var(--trade-bullish)]">+{Number(position.mfe).toFixed(1)}%</span>
                  </div>
                  <div className="mt-1 text-[8px] font-mono uppercase tracking-[0.14em] text-muted-foreground/75">
                    open · bankable milestone, not realized win
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {publishedAudit.length > 0 && (
        <details className="group rounded-lg border border-border/60 bg-card/30" data-testid="published-72h-audit">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-3 py-2.5 hover:bg-foreground/[0.025]">
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-foreground">
                Published record · last 72h
              </div>
              <div className="mt-0.5 text-[9px] font-mono text-muted-foreground">
                Every published idea stays findable; only revalidated plans enter the live book.
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 text-[9px] font-mono uppercase tracking-wide">
              <span className="text-[var(--brand-cyan)]">{publishedAuditCounts.active} active</span>
              <span className="text-[var(--trade-bullish)]">{publishedAuditCounts.held} held</span>
              <span className="text-muted-foreground">{publishedAuditCounts.resolved} decided</span>
              <span className="text-[var(--trade-neutral)]">{publishedAuditCounts.archive} archive</span>
              <span className="text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
            </div>
          </summary>
          <div className="border-t border-border/50 px-2 pb-2 pt-1">
            <div className="max-h-[340px] overflow-auto">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[62px_82px_74px_72px_70px_minmax(260px,1fr)] gap-2 border-b border-border/40 px-2 py-1.5 text-[8px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                  <span>Time</span><span>Symbol</span><span>State</span><span>Score</span><span>R:R</span><span>Why</span>
                </div>
                {publishedAudit.map((row) => {
                  const active = row.state === 'active';
                  const held = row.state === 'held';
                  const timestamp = row.at ? new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => {
                        setOnDemandFocused(false);
                        setView('cockpit');
                        if (active) setSelectedId(row.id);
                        else void gradeTicker(row.symbol);
                      }}
                      className="grid w-full grid-cols-[62px_82px_74px_72px_70px_minmax(260px,1fr)] gap-2 border-b border-border/25 px-2 py-2 text-left font-mono text-[10px] transition-colors last:border-0 hover:bg-foreground/[0.035]"
                      title={active ? `Open ${row.symbol} in Cockpit` : `Run a current ${row.symbol} workup`}
                    >
                      <span className="text-muted-foreground">{timestamp}</span>
                      <span className={['bullish', 'long'].includes(row.direction) ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}>
                        {row.symbol} {['bullish', 'long'].includes(row.direction) ? '▲' : '▼'}
                      </span>
                      <span className={cn(
                        'uppercase',
                        active ? 'text-[var(--brand-cyan)]' : held ? 'text-[var(--trade-bullish)]' : 'text-muted-foreground',
                      )}>{row.state}</span>
                      <span>{row.score != null ? `${Math.round(Number(row.score))}/100` : '—'}</span>
                      <span className={Number(row.riskRewardRatio) >= 1 ? 'text-foreground' : 'text-[var(--trade-neutral)]'}>
                        {row.riskRewardRatio != null ? `${Number(row.riskRewardRatio).toFixed(2)}R` : '—'}
                      </span>
                      <span className="truncate text-muted-foreground">{row.reason}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="px-2 pt-2 text-[9px] font-mono text-muted-foreground">
              Click an active row to open it. Click an archive row to run a fresh current-state workup—archive status is never silently promoted.
            </div>
          </div>
        </details>
      )}

      {picks.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[32vh] gap-2 text-center">
          <AlertTriangle className="w-5 h-5 text-[var(--trade-neutral)]" />
          <p className="text-sm font-mono text-muted-foreground">
            No {COCKPIT_MODES.find((m) => m.id === mode)?.label} setups right
            now.
          </p>
          <p className="text-[11px] font-mono text-muted-foreground">
            Switch modes above — other engines may have live ideas.
          </p>
        </div>
      ) : (
        <div ref={captureRef} className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <KpiStrip items={kpis} boxed />
            </div>
            {signalSymbols.length > 0 && (
              <Heartbeat
                since={quoteBookUpdatedAt || null}
                staleAfterSec={45}
                label={
                  quoteBook
                    ? `QUOTES ${liveBySymbol.size}/${signalSymbols.length}`
                    : "QUOTE FEED"
                }
                className="shrink-0"
              />
            )}
            {/* When the NEXUS board's own toggle owns the view, a second one here
                just fights it — two controls, one state, endless confusion. */}
            {!lockedView && (
              <Segmented
                options={[
                  { value: "grid" as const, label: "Grid" },
                  { value: "scanner" as const, label: "Scanner" },
                  { value: "cockpit" as const, label: "Cockpit" },
                ]}
                value={view}
                onChange={setView}
              />
            )}
          </div>

          {view !== "cockpit" ? (
            <div className="space-y-3">
              <SignalFilterBar
                filters={filters}
                set={setFilter}
                reset={resetFilters}
                active={filtersActive}
                picks={openPicks}
                shownCount={shown.length}
                suggestFrom={allPicks}
                onGradeTicker={gradeTicker}
                grading={!!grading}
              />
              {graded && !graded.analysis && (
                <p className="px-1 font-mono text-[11px] text-[var(--brand-cyan)]">
                  {graded.text}
                </p>
              )}
              {view === "grid" ? (
                <SignalGrid
                  picks={shown}
                  selectedId={selectedId}
                  live={liveBySymbol}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setView("cockpit");
                  }}
                />
              ) : (
                <SignalTable
                  picks={shown}
                  selectedId={selectedId}
                  live={liveBySymbol}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setView("cockpit");
                  }}
                />
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
              {/* ─── LEFT: signal list ─────────────────────────────── */}
              {/* Sticky column, full viewport height, scrolls inside itself.
            Two wrong versions before this one. It was max-h-[44vh] — a stubby box
            that cut off mid-card. Removing the cap entirely was worse: 40 signal
            rows made the column taller than everything beside it and the page
            grew to its length, so the detail pane and analytics rail were
            stranded above acres of empty space.
            The list is a NAVIGATION rail, not page content — it should behave
            like one: pinned, as tall as the screen, never taller. */}
              <aside
                ref={listRef}
                className="space-y-2 pr-1 -mr-1 lg:sticky lg:top-3 lg:h-[calc(100vh-7.5rem)] lg:overflow-y-auto"
              >
                <div className="sticky top-0 z-10 -mx-1 px-2 py-1.5 bg-background/95 backdrop-blur flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Active Signals
                  </span>
                  {/* the NEW count now lives on the NEW tab of the stream filter below, so this
                row just carries the open count + mark-seen (no competing toggle). */}
                  <div className="flex items-center gap-1.5">
                    {newCount > 0 && (
                      <button
                        onClick={markSeen}
                        title="Mark all as seen"
                        className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                      >
                        seen
                      </button>
                    )}
                    <span className="text-[10px] font-mono text-[var(--brand-cyan)]">
                      {openPicks.length} open
                    </span>
                  </div>
                </div>
                {/* The same filter model the grid uses, stacked for a 244px column.
              The rail's lone ticker box is gone — it was one axis of a six-axis
              model, and having it here while side/band/state lived only on the
              grid is what made switching views throw the reduction away. */}
                <SignalFilterBar
                  compact
                  filters={filters}
                  set={setFilter}
                  reset={resetFilters}
                  active={filtersActive}
                  picks={openPicks}
                  shownCount={shown.length}
                  suggestFrom={allPicks}
                  onGradeTicker={gradeTicker}
                  grading={!!grading}
                />
                {graded?.analysis ? (
                  <AnalysedSignalRow
                    analysis={graded.analysis}
                    selected={!!onDemand}
                    onClick={() => {
                      setSelectedId(null);
                      setOnDemandFocused(true);
                    }}
                  />
                ) : graded ? (
                  <p className="px-1 pb-1 font-mono text-[10px] leading-relaxed text-[var(--brand-cyan)]">
                    {graded.text}
                  </p>
                ) : null}

                {/* NEW / BEST / CONVICTION */}
                <div className="mb-2 flex items-center gap-0.5 rounded bg-foreground/5 p-0.5">
                  {(
                    [
                      ["new", "NEW"],
                      ["best", "BEST"],
                      ["conviction", "CONVICTION"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setStreamFilter(id)}
                      className={cn(
                        "flex-1 cursor-pointer rounded px-2 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors",
                        streamFilter === id
                          ? "bg-foreground/10 text-[var(--brand-cyan)]"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      data-testid={`stream-filter-${id}`}
                    >
                      {label}
                      {id === "new" && newCount > 0 ? ` ${newCount}` : ""}
                    </button>
                  ))}
                </div>

                {shown.length === 0 ? (
                  <div className="px-2 py-6 text-center text-[10px] font-mono text-muted-foreground">
                    {streamFilter === "new" ? (
                      <>
                        No new signals right now —{" "}
                        <button
                          onClick={() => setStreamFilter("conviction")}
                          className="text-[var(--brand-cyan)] hover:underline"
                        >
                          show all {picks.length}
                        </button>
                      </>
                    ) : filters.query ? (
                      graded?.analysis ? (
                        `${filters.query.trim().toUpperCase()} has no published scanner signal. Its analysed record is above.`
                      ) : (
                        `No published ${filters.query.trim().toUpperCase()} signal in this book.`
                      )
                    ) : (
                      "No signals match."
                    )}
                  </div>
                ) : (
                  shown.map((p) => (
                    <SignalRow
                      key={p.ideaId}
                      pick={p}
                      live={priceFor(p)}
                      selected={selected?.ideaId === p.ideaId}
                      isNew={isNew(p)}
                      onClick={() => {
                        setOnDemandFocused(false);
                        setSelectedId(p.ideaId);
                      }}
                    />
                  ))
                )}

                {/* CLOSED TODAY — signals that already resolved, kept visible for the record */}
                {closedToday.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                      Closed today · {closedToday.length}
                    </div>
                    <div className="space-y-1.5">
                      {closedToday.map((p) => (
                        <SignalRow
                          key={p.ideaId}
                          pick={p}
                          live={priceFor(p)}
                          closed
                          selected={selected?.ideaId === p.ideaId}
                          onClick={() => {
                            setOnDemandFocused(false);
                            setSelectedId(p.ideaId);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </aside>

              {/* ─── CENTER: subject ───────────────────────────────── */}
              {onDemand && (
                <OnDemandSubject
                  analysis={onDemand}
                  onWatch={addGradedToWatchlist}
                  watching={adding}
                  watchStatus={added}
                />
              )}

              {!onDemand && selected && (
                <main ref={subjectRef} className="space-y-3 min-w-0">
                  {/* HERO — identity · live price · levels · chart in ONE card so the
                subject reads as a single unit instead of four stacked boxes. */}
                  <CockpitCard bodyClassName="space-y-4">
                    {/* identity + live price */}
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <TickerLogo symbol={selected.symbol} size="lg" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-2xl font-mono font-bold tracking-wide text-foreground">
                              {selected.symbol}
                            </h2>
                            {/* There is one authoritative quality label: the Conviction
                          band. A second B+/A- conversion of the same score made
                          an S-band / 89 signal look self-contradictory. */}
                            <span
                              title="Signal evidence band — combines the scored conviction layers, not the selected options contract."
                              className="rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.11em]"
                              style={{
                                color: bandColor(selected.convictionBand),
                                borderColor: `color-mix(in srgb, ${bandColor(selected.convictionBand)} 42%, transparent)`,
                                background: `color-mix(in srgb, ${bandColor(selected.convictionBand)} 10%, transparent)`,
                              }}
                            >
                              {selected.convictionBand} evidence · +{selected.convictionScore}
                            </span>
                            <span
                              className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                              style={{
                                color: toneColor,
                                background: `color-mix(in srgb, ${toneColor} 12%, transparent)`,
                              }}
                            >
                              {selected.direction === "long"
                                ? "▲ BULL"
                                : "▼ BEAR"}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-foreground/[0.05] text-muted-foreground capitalize">
                              {selected.holdingPeriod}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            <span className="text-meta font-mono text-muted-foreground capitalize truncate">
                              {selected.sector}
                              {selected.optionType
                                ? ` · ${selected.optionType.toUpperCase()}${selected.strikePrice ? ` $${selected.strikePrice}` : ""}`
                                : ""}
                            </span>
                            {/* When it fired matters as much as what it says — a call published
                          at 4:00pm ET can't be filled until the next open. */}
                            <SignalTimingBadge
                              generatedAt={selected.generatedAt}
                              showCaveat={false}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-2xl font-mono font-bold tabular-nums text-foreground leading-none">
                          {Number.isFinite(livePx) && livePx > 0 ? (
                            <LiveValue
                              key={selected.symbol}
                              value={livePx}
                              format={(n) => `$${n.toFixed(2)}`}
                            />
                          ) : (
                            "—"
                          )}
                        </div>
                        {quote && (
                          <div
                            className="text-xs font-mono font-medium tabular-nums mt-1"
                            style={{
                              color:
                                quote.change >= 0
                                  ? "var(--trade-bullish)"
                                  : "var(--trade-bearish)",
                            }}
                          >
                            {quote.change >= 0 ? "+" : ""}
                            {quote.change.toFixed(2)} (
                            {quote.changePct >= 0 ? "+" : ""}
                            {quote.changePct.toFixed(2)}%)
                          </div>
                        )}
                        {quote?.asOf && (
                          <div className="mt-1 flex justify-end">
                            <Heartbeat since={quote.asOf} label="QUOTE" staleAfterSec={45} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* THE TRADE — lifted out of the Contract Engine 1,190px below.
                  Two reasons: the most actionable fact on the page was under the
                  fold, and the header above was printing the idea's STORED strike
                  while the engine had re-selected a different one against the live
                  chain. The strip shows the live pick and names the disagreement
                  when there is one. See oracle/trade-strip.tsx. */}
                    {selected.isBotHeld ? (
                      <HeldPositionStrip pick={selected} liveUnderlying={livePx} />
                    ) : (selected.direction === "long" ||
                      selected.direction === "short") && (
                      <TradeStrip
                        pick={enginePick}
                        publishedStrike={selected.strikePrice}
                        publishedType={selected.optionType}
                        direction={selected.direction}
                        onJump={() =>
                          engineRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          })
                        }
                      />
                    )}

                    {/* Say it plainly before the user sizes a position off an entry the market
                  has already left behind. Renders nothing when the signal is clean. */}
                    <SignalTimingNotice generatedAt={selected.generatedAt} />

                    {/* One decision surface, ordered the way a trader actually decides:
                        premise → surrounding tape → execution gate.  This replaces a
                        prose thesis followed by a disconnected catalyst card below the
                        contract engine. */}
                    <CockpitCard
                      title="Decision brief"
                      meta={selected.lifecycleState.replace(/_/g, " ")}
                      bodyClassName="p-0"
                    >
                      <div className="grid divide-y divide-border/35 lg:grid-cols-[1.35fr_1fr_1fr] lg:divide-x lg:divide-y-0">
                        <div className="p-3.5">
                          <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--brand-cyan)]">Thesis</div>
                          <p className="text-[12px] leading-relaxed text-foreground/90">
                            {selected.thesis ? clarifyOracleNarrative(selected.thesis) : "No written thesis was returned."}
                          </p>
                          {selected.catalyst && selected.catalyst !== selected.thesis && (
                            <p className="mt-2 border-t border-border/30 pt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                              {clarifyOracleNarrative(selected.catalyst)}
                            </p>
                          )}
                        </div>
                        <div className="p-3.5">
                          <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--brand-cyan)]">Context now</div>
                          <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
                            {data?.marketContext?.regime?.replace(/_/g, " ") ?? "Context unavailable"} · {selected.sector}
                          </p>
                          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                            {data?.marketContext?.reasons?.[0] ?? "No fresh regime adjustment is available for this plan."}
                          </p>
                        </div>
                        <div className="p-3.5">
                          <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--brand-cyan)]">Execution gate</div>
                          <p className="font-mono text-[11px] font-semibold uppercase tracking-wide" style={{ color: toneColor }}>
                            {selected.lifecycleState.replace(/_/g, " ")}
                          </p>
                          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{executionStateCopy(selected.lifecycleState)}</p>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                            <span>ENTRY ${selected.entryPrice.toFixed(2)}</span>
                            <span style={{ color: "var(--trade-bearish)" }}>INVALID ${selected.stopLoss.toFixed(2)}</span>
                            <span style={{ color: "var(--trade-bullish)" }}>T1 ${selected.targetPrice.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    </CockpitCard>

                    {selectedIsIndexIntraday && (
                      <section className="overflow-hidden rounded-lg border border-[var(--brand-cyan)]/25 bg-[var(--brand-cyan)]/[0.035]" aria-label="Index execution playbook">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
                          <div>
                            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--brand-cyan)]">Index execution playbook</div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">One event · one card · chart levels update through the full lifecycle</div>
                          </div>
                          <span className="rounded border border-[var(--trade-neutral)]/30 bg-[var(--trade-neutral)]/10 px-2 py-1 font-mono text-[9px] uppercase tracking-wide text-[var(--trade-neutral)]">
                            force flat 3:57 ET if 0DTE
                          </span>
                        </div>
                        <div className="grid grid-cols-2 divide-x divide-y divide-border/35 sm:grid-cols-4 sm:divide-y-0">
                          <div className="px-3 py-2.5"><div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground">Trigger</div><div className="mt-1 font-mono text-sm tabular-nums">${selected.entryPrice.toFixed(2)}</div><div className="mt-0.5 text-[9px] text-muted-foreground">completed-bar reclaim / break</div></div>
                          <div className="px-3 py-2.5"><div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground">Invalidation</div><div className="mt-1 font-mono text-sm tabular-nums text-[var(--trade-bearish)]">${selected.stopLoss.toFixed(2)}</div><div className="mt-0.5 text-[9px] text-muted-foreground">thesis fails here</div></div>
                          <div className="px-3 py-2.5"><div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground">T1</div><div className="mt-1 font-mono text-sm tabular-nums text-[var(--trade-bullish)]">${selected.targetPrice.toFixed(2)}</div><div className="mt-0.5 text-[9px] text-muted-foreground">recover risk / trail runner</div></div>
                          <div className="px-3 py-2.5"><div className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground">Expression</div><div className="mt-1 font-mono text-sm tabular-nums">{selected.strikePrice != null ? `${selected.strikePrice}${selected.optionType === "put" ? "P" : "C"}` : "pending chain"}</div><div className="mt-0.5 text-[9px] text-muted-foreground">{selected.entryPremium != null ? `$${selected.entryPremium.toFixed(2)} at call` : "live executable mark required"}</div></div>
                        </div>
                      </section>
                    )}

                    {/* THE CHART is the focus of the analysis — prominent, right under the header.
                  One universal EpochChart (epoch-anchored, any ticker) with entry/stop/target. */}
                    <NexusPriceChart syncGroup="cockpit"
                      key={selected.ideaId}
                      symbol={selected.symbol}
                      initialTf={selectedIsIndexIntraday ? "1m" : "1D"}
                      height={340}
                      zones={gapZones}
                      levels={[
                        {
                          price: selected.entryPrice,
                          color: "#3b8cff",
                          label: "ENTRY",
                        },
                        {
                          price: selected.stopLoss,
                          color: "#ef4444",
                          label: "STOP",
                          dashed: true,
                        },
                        {
                          price: selected.targetPrice,
                          color: "#22c55e",
                          label: "T1",
                        },
                      ]}
                    />

                    {/* price ladder + interpretation. Confidence, components, and levels live in the
                  right rail — shown ONCE, not duplicated here. */}
                    {/* items-start, or the ladder stretches to match the taller Context+Plan
                  column beside it — that's why a 168px ladder was rendering 604px tall. */}
                    <div className="grid items-start gap-2 lg:grid-cols-2">
                      <PriceLadder pick={selected} live={livePx} />
                      <div className="space-y-2">
                        {selected.isBotHeld ? (
                          <HeldManagementPanel pick={selected} />
                        ) : (
                          <>
                            <ContextPanel
                              pick={selected}
                              live={livePx}
                              regime={data?.marketContext?.regime}
                              preferredDirection={
                                data?.marketContext?.preferredDirection
                              }
                            />
                            <ProfitPlan pick={selected} live={livePx} />
                          </>
                        )}
                      </div>
                    </div>

                    <TASummary symbol={selected.symbol} />
                  </CockpitCard>

                  {/* CONTRACT ENGINE — the actionable trade. Renders its own QE-styled
                card (same chrome as everything else now). */}
                  {(selected.direction === "long" ||
                    selected.direction === "short") && (
                    <div ref={engineRef}>
                      {(selected as any).strikePrice && (selected as any).optionType && (selected as any).expiryDate && (
                        <PublishedContractLive
                          symbol={selected.symbol}
                          optionType={String((selected as any).optionType)}
                          strike={Number((selected as any).strikePrice)}
                          expiry={String((selected as any).expiryDate)}
                          target={selected.targetPrice}
                          stop={selected.stopLoss}
                          entryPremium={(selected as any).entryPremium ?? null}
                        />
                      )}
                      {!selected.isBotHeld && (
                        <ContractEngine
                          key={selected.ideaId}
                          autoLoad
                          onResolve={(p) =>
                            setEnginePick(p as TradeStripPick | null)
                          }
                          symbol={selected.symbol}
                          direction={
                            selected.direction === "long" ? "BULL" : "BEAR"
                          }
                          entry={selected.entryPrice}
                          stop={selected.stopLoss}
                          t1={selected.targetPrice}
                          holdPeriodLabel={selected.holdingPeriod}
                          conviction={selected.convictionScore}
                        />
                      )}
                    </div>
                  )}

                  {/* Was a single link to the chart tab — the only bridge from a signal
                to the evidence for it. Now every evidence surface, symbol-bound,
                so validating a call does not mean leaving it and retyping the
                ticker. See components/evidence-rail.tsx. */}
                  <EvidenceRail symbol={selected.symbol} className="pt-1" />
                </main>
              )}

              {/* ─── RIGHT: analytics ──────────────────────────────── */}
              {/* Four panels, ONE block. The cockpit was rendering 55 panels across 15
            distinct footprints while the grid rendered 40 cards across 1 — and
            that difference, not styling, is why the grid reads faster. Repeating
            units teach the eye once; unique shapes make it re-learn at every
            panel. See templates/kit.tsx → Readout.

            The frame and grammar are shared (header · headline value · bars ·
            detail · one line of prose). The DETAIL stays bespoke, because
            flattening Signal Components into "big number + bars" would delete
            its per-layer explanations, which are the best writing here. */}
              {onDemand ? (
                <OnDemandEvidenceRail analysis={onDemand} />
              ) : (
                selected && (
                  <aside
                    ref={railRef}
                    className="space-y-3 lg:sticky lg:top-3 self-start"
                  >
                    <Readout
                      title="Evidence grade"
                      meta={
                        <span className="text-[var(--brand-cyan)]">
                          {selected.currentPrice != null ? "Market price" : "Recorded"}
                        </span>
                      }
                      value={selected.convictionBand}
                      qualifier={tierLabel(selected)}
                      /* CYAN, not the direction colour. Moss and clay mean DIRECTION —
                 "direction without the casino" / "a fault light". Conviction is a
                 quality reading on a different axis entirely, so tinting it by
                 side made a well-evidenced short render clay, which reads as
                 "this is bad" when it means "we are very sure about this". The
                 side is already stated by the ▲BULL chip and the P&L. */
                      valueTone="structural"
                      note={`+${plusPoints} support · ${minusPoints || 0} challenge · ${selected.layerCount} active layers · S starts at +25${selected.publishedConvictionScore != null ? ` · published +${selected.publishedConvictionScore}` : ""}`}
                    >
                      {/* Was a radial gauge drawing the same number stated 40px above it,
                  under four stacked glow filters. This shows what the numeral
                  cannot: distance to the next band. Floors mirror
                  lib/convictions.ts → convictionPercent, which is itself pinned
                  to BAND_CUTOFFS on the server. */}
                      <BandScale
                        value={convictionPercent(selected.convictionScore)}
                        bands={[
                          { label: "C", floor: 0 },
                          { label: "B", floor: 58 },
                          { label: "A", floor: 72 },
                          { label: "S", floor: 86 },
                        ]}
                        tone="structural"
                      />
                      <div className="border-t border-border/45 pt-2">
                        <button
                          type="button"
                          onClick={() => setConfidenceInfoOpen((open) => !open)}
                          className="flex w-full items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-[var(--brand-cyan)]"
                          aria-expanded={confidenceInfoOpen}
                        >
                          <span>How this grade works</span>
                          <span
                            aria-hidden
                            className="text-[var(--brand-cyan)]"
                          >
                            {confidenceInfoOpen ? "−" : "+"}
                          </span>
                        </button>
                        {confidenceInfoOpen && (
                          <div className="mt-2 grid gap-px border border-border/45 bg-border/45">
                            <p className="bg-card px-2.5 py-2 font-mono text-[10px] font-medium leading-relaxed text-muted-foreground">
                              <b className="text-foreground">
                                {selected.convictionBand} is the live evidence band, not a probability of profit.
                              </b>{" "}
                              The board ranks the signed raw total: supporting evidence minus challenges. Trigger, geometry, liquidity, and execution remain separate decisions.
                            </p>
                            {selected.publishedConvictionScore != null && (
                              <p className="bg-card px-2.5 py-2 font-mono text-[10px] font-medium leading-relaxed text-muted-foreground">
                                <b className="text-foreground">Published +{selected.publishedConvictionScore} ({selected.publishedConvictionBand ?? "—"} band).</b>{" "}
                                That frozen grade describes the setup when it entered the book. Live evidence can move as price, regime, freshness, and confirmation change; it does not rewrite the original call.
                              </p>
                            )}
                            <p className="bg-card px-2.5 py-2 font-mono text-[10px] font-medium leading-relaxed text-muted-foreground">
                              <b className="text-foreground">+{selected.convictionScore} is the raw evidence total.</b>{" "}
                              It adds supporting layers and subtracts challenging ones. Bands use raw points: C &lt;+13 · B +13–18 · A +19–24 · S +25+.
                            </p>
                            <div className="bg-card px-2.5 py-2">
                              <p className="mb-2 font-mono text-[10px] font-medium leading-relaxed text-muted-foreground">
                                There is no honest fixed “out of” denominator: layers are conditional. This plan is {selected.convictionScore >= 25 ? `${selected.convictionScore - 25} points into S` : `${25 - selected.convictionScore} points from S`}. The four evidence families below show what was available and what actually fired.
                              </p>
                              <div className="grid gap-px border border-border/45 bg-border/45 sm:grid-cols-2">
                                {CONVICTION_FAMILIES.map((family) => {
                                  const active = selected.layers.filter((layer) =>
                                    (family.kinds as readonly string[]).includes(layer.kind),
                                  );
                                  return (
                                    <div key={family.id} className="bg-card px-2 py-2">
                                      <div className="flex items-baseline justify-between gap-2 font-mono">
                                        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--brand-cyan)]">{family.tag} · {family.label}</span>
                                        <span className="text-[9px] tabular-nums text-muted-foreground">{active.length}/{family.kinds.length} active</span>
                                      </div>
                                      <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">{family.question}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </Readout>

                    <Readout
                      title="Signal Components"
                      meta={`${selected.layerCount} layers`}
                      value={
                        netPoints >= 0 ? `+${netPoints}` : String(netPoints)
                      }
                      qualifier={
                        minusPoints
                          ? `+${plusPoints} support · ${minusPoints} challenge`
                          : `+${plusPoints} support · no challenge`
                      }
                      valueTone="structural"
                      /* No `note` here on purpose: SignalComponents already ends with
                 this exact sentence, and its version NAMES the dissenting
                 layers — strictly more useful than the count. Two copies of one
                 sentence 600px apart is the duplication this refactor exists to
                 remove, not to introduce. */
                    >
                      <SignalComponents
                        layers={selected.layers}
                        showSummary={false}
                      />
                    </Readout>

                    {/* Was three cards — Position Size, Trade Geometry, Risk/Reward —
                totalling 649px to answer one question, with the 2.00 ratio
                printed three separate ways. See signal-detail.tsx → RiskPanel. */}
                    <RiskPanel pick={selected} live={livePx} />

                    {data?.marketContext && (
                      <Readout
                        title="Market Context"
                        value={data.marketContext.regime?.toUpperCase() ?? "—"}
                        qualifier="regime"
                        valueTone="structural"
                        note={data.breadth?.interpretation}
                      >
                        <div className="space-y-2">
                          <ContextRow
                            label="Risk"
                            value={
                              data.marketContext.riskSentiment?.toUpperCase() ??
                              "—"
                            }
                          />
                          <ContextRow
                            label="Bias"
                            value={
                              data.marketContext.preferredDirection?.toUpperCase() ??
                              "—"
                            }
                            tone={
                              data.marketContext.preferredDirection === "long"
                                ? "bull"
                                : data.marketContext.preferredDirection ===
                                    "short"
                                  ? "bear"
                                  : undefined
                            }
                          />
                          {typeof data.marketContext.vixLevel === "number" && (
                            <ContextRow
                              label="VIX"
                              value={data.marketContext.vixLevel.toFixed(1)}
                            />
                          )}
                          {data.breadth && (
                            <ContextRow
                              label="Breadth"
                              value={data.breadth.regime?.toUpperCase() ?? "—"}
                            />
                          )}
                          {data.geopolitical?.risk && (
                            <ContextRow
                              label="Geo Risk"
                              value={data.geopolitical.risk.toUpperCase()}
                              tone={
                                /high|elevated/i.test(data.geopolitical.risk)
                                  ? "bear"
                                  : undefined
                              }
                            />
                          )}
                        </div>
                      </Readout>
                    )}
                  </aside>
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── small inline pieces ────────────────────────────────────────────────────

/**
 * An analysed ticker belongs in the same stream as published signals. It is not
 * a trade row in disguise: it deliberately has no Entry → T1 path because the
 * universal analyser did not publish one. Clicking it opens the evidence canvas.
 */
function AnalysedSignalRow({
  analysis,
  selected,
  onClick,
}: {
  analysis: OnDemandAnalysis;
  selected: boolean;
  onClick: () => void;
}) {
  const read = analysis.read;
  if (read) {
    const direction = read.directional.bias;
    const tone = direction === "bullish"
      ? "var(--trade-bullish)"
      : direction === "bearish"
        ? "var(--trade-bearish)"
        : "var(--brand-cyan)";
    const arrow = direction === "bullish" ? "▲" : direction === "bearish" ? "▼" : "•";
    const state = direction === "neutral" ? "NEUTRAL WATCH" : `${direction.toUpperCase()} WATCH`;

    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group relative w-full overflow-hidden rounded-[4px] border px-3 py-3 text-left transition-[border-color,background-color] duration-200",
          selected
            ? "border-l-[3px] border-[var(--brand-cyan)] bg-[var(--brand-cyan)]/[0.08]"
            : "border-[var(--brand-cyan)]/45 bg-card hover:border-[var(--brand-cyan)]/75 hover:bg-[var(--brand-cyan)]/[0.045]",
        )}
        data-testid={`on-demand-read-${analysis.symbol}`}
      >
        <div className="flex items-start gap-2">
          <TickerLogo symbol={analysis.symbol} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[14px] font-bold tracking-[0.08em] text-foreground">
                {analysis.symbol}
              </span>
              <span className="font-mono text-[9px] font-bold tracking-[0.12em]" style={{ color: tone }}>
                {arrow} {state}
              </span>
            </div>
            <p className="mt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              no published entry · evidence only
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[16px] font-bold leading-none tabular-nums" style={{ color: tone }}>
              {read.directional.aligned}/{read.directional.assessed || "—"}
            </p>
            <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              conditions
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_auto] gap-3 border-t border-border/45 pt-2">
          <p className="min-w-0 font-mono text-[9px] leading-relaxed text-muted-foreground">
            {read.directional.summary}
          </p>
          <span className="font-mono text-[10px] font-bold tabular-nums text-foreground">
            ${read.spot.toFixed(2)}
          </span>
        </div>
      </button>
    );
  }

  const overall = analysis.overall ?? {};
  const grade = overall.grade ?? overall.tier ?? "—";
  const score = overall.score;
  const gradeTone = gradeToneFor(grade);
  const components = Object.entries(analysis.components ?? {})
    .filter(([, component]) => typeof component?.score === "number")
    .sort(([, a], [, b]) => (b.score ?? 0) - (a.score ?? 0));
  const recommendation =
    overall.recommendation?.replace(/_/g, " ") ?? "ANALYSED";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative w-full overflow-hidden rounded-[4px] border px-3 py-3 text-left transition-[border-color,background-color] duration-200",
        selected
          ? "border-l-[3px] border-[var(--brand-cyan)] bg-[var(--brand-cyan)]/[0.08]"
          : "border-[var(--brand-cyan)]/45 bg-card hover:border-[var(--brand-cyan)]/75 hover:bg-[var(--brand-cyan)]/[0.045]",
      )}
      data-testid={`on-demand-read-${analysis.symbol}`}
    >
      <div className="flex items-start gap-2">
        <TickerLogo symbol={analysis.symbol} size="sm" />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[14px] font-bold tracking-[0.08em] text-foreground">
              {analysis.symbol}
            </span>
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--brand-cyan)]">
              Analysed
            </span>
          </div>
          <p className="mt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {recommendation} · {overall.confidence?.toLowerCase() ?? "unrated"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className="font-mono text-[22px] font-bold leading-none tabular-nums"
            style={{ color: gradeTone }}
          >
            {score ?? "—"}
          </p>
          <p
            className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.15em]"
            style={{ color: gradeTone }}
          >
            {grade} grade
          </p>
        </div>
      </div>

      <div className="mt-3 border-t border-border/45 pt-2">
        <div
          className="flex items-center gap-1"
          aria-label="Seven analysis dimensions"
        >
          {components.slice(0, 7).map(([key, component]) => {
            const value = Math.max(0, Math.min(100, component.score ?? 0));
            return (
              <span
                key={key}
                title={`${componentLabel(key)} ${Math.round(value)}`}
                className="h-[3px] flex-1 bg-foreground/[0.08]"
              >
                <span
                  className="block h-full bg-[var(--brand-cyan)]"
                  style={{ width: `${value}%` }}
                />
              </span>
            );
          })}
        </div>
        <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          {components.length} evidence dimensions · open analysis →
        </p>
      </div>
    </button>
  );
}

function OnDemandSubject({
  analysis,
  onWatch,
  watching,
  watchStatus,
}: {
  analysis: OnDemandAnalysis;
  onWatch: () => void;
  watching: boolean;
  watchStatus: string | null;
}) {
  if (analysis.read) {
    return (
      <TickerReadSubject
        analysis={analysis}
        onWatch={onWatch}
        watching={watching}
        watchStatus={watchStatus}
      />
    );
  }

  const overall = analysis.overall ?? {};
  const components = Object.entries(analysis.components ?? {})
    .filter(([, value]) => typeof value?.score === "number")
    .sort(([, a], [, b]) => (b.score ?? 0) - (a.score ?? 0));
  const horizons = Object.entries(analysis.timeHorizons ?? {});
  const insights = analysis.insights ?? {};
  const positives = [
    ...(insights.strengths ?? []),
    ...(insights.catalysts ?? []),
  ].slice(0, 4);
  const risks = [
    ...(insights.weaknesses ?? []),
    ...(insights.risks ?? []),
  ].slice(0, 4);

  return (
    <main className="min-w-0 space-y-3">
      <CockpitCard bodyClassName="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <TickerLogo symbol={analysis.symbol} size="lg" />
            <div>
              <div className="flex items-baseline gap-2">
                <h2 className="font-mono text-2xl font-bold tracking-wide text-foreground">
                  {analysis.symbol}
                </h2>
                <span className="border border-[var(--brand-cyan)]/45 bg-[var(--brand-cyan)]/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--brand-cyan)]">
                  Analysed
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground">
                {overall.recommendation?.replace(/_/g, " ") ??
                  "No directional call"}{" "}
                · {overall.confidence?.toLowerCase() ?? "unrated"} confidence
              </p>
            </div>
          </div>
          <div className="text-right">
            <p
              className="font-mono text-3xl font-bold leading-none tabular-nums"
              style={{
                color: gradeToneFor(overall.grade ?? overall.tier ?? ""),
              }}
            >
              {overall.score ?? "—"}
            </p>
            <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
              {overall.grade ?? overall.tier ?? "—"} grade
            </p>
          </div>
        </div>

        <NexusPriceChart syncGroup="cockpit" symbol={analysis.symbol} initialTf="1D" height={340} />

        <div className="grid gap-px border border-border/45 bg-border/45 sm:grid-cols-3">
          {horizons.length > 0 ? (
            horizons.map(([key, horizon]) => (
              <div key={key} className="bg-card px-3 py-3">
                <p className="font-mono text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--brand-cyan)]">
                  {key}
                </p>
                <p className="mt-1 font-mono text-[12px] font-bold uppercase text-foreground">
                  {horizon.signal ?? "No call"}
                </p>
                <p className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {typeof horizon.confidence === "number"
                    ? `${Math.round(horizon.confidence)} confidence`
                    : (horizon.timeframe ?? "Timeframe unavailable")}
                </p>
              </div>
            ))
          ) : (
            <p className="bg-card px-3 py-3 font-mono text-[11px] text-muted-foreground">
              The analysis returned no horizon calls.
            </p>
          )}
        </div>
      </CockpitCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <CockpitCard
          title="Evidence distribution"
          meta={`${components.length} dimensions`}
        >
          <div className="space-y-3">
            {components.map(([key, component]) => {
              const score = Math.max(0, Math.min(100, component.score ?? 0));
              return (
                <div
                  key={key}
                  className="grid grid-cols-[82px_minmax(0,1fr)_30px] items-center gap-3"
                >
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                    {componentLabel(key)}
                  </span>
                  <span className="h-[4px] bg-foreground/[0.08]">
                    <span
                      className="block h-full bg-[var(--brand-cyan)]"
                      style={{ width: `${score}%` }}
                    />
                  </span>
                  <span className="text-right font-mono text-[11px] font-bold tabular-nums text-foreground">
                    {Math.round(score)}
                  </span>
                </div>
              );
            })}
          </div>
        </CockpitCard>
        <CockpitCard
          title="What changed the grade"
          meta="Actual analysis output"
        >
          <div className="space-y-3">
            {positives.length > 0 && (
              <InsightList title="Supporting" items={positives} tone="bull" />
            )}
            {risks.length > 0 && (
              <InsightList title="Against" items={risks} tone="bear" />
            )}
            {positives.length === 0 && risks.length === 0 && (
              <p className="font-mono text-[11px] text-muted-foreground">
                No written insights returned for this analysis.
              </p>
            )}
          </div>
          <div className="mt-4 border-t border-border/45 pt-3">
            <button
              type="button"
              onClick={onWatch}
              disabled={watching || !!watchStatus}
              className="border border-[var(--brand-cyan)]/45 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand-cyan)] transition-colors hover:bg-[var(--brand-cyan)]/10 disabled:opacity-60"
            >
              {watching
                ? "Adding…"
                : watchStatus
                  ? "Watching"
                  : "+ Add to watchlist"}
            </button>
            {watchStatus && (
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {watchStatus}
              </p>
            )}
          </div>
        </CockpitCard>
      </div>
    </main>
  );
}

/** A searched symbol is a directional WATCH until it has a verified trigger,
 * invalidation and structural target. It intentionally does not mimic a signal
 * detail card's Entry/T1/contract fields. */
function TickerReadSubject({
  analysis,
  onWatch,
  watching,
  watchStatus,
}: {
  analysis: OnDemandAnalysis;
  onWatch: () => void;
  watching: boolean;
  watchStatus: string | null;
}) {
  const read = analysis.read!;
  const direction = read.directional.bias;
  const tone = direction === "bullish" ? "bull" : direction === "bearish" ? "bear" : "structural";
  const color = direction === "bullish"
    ? "var(--trade-bullish)"
    : direction === "bearish"
      ? "var(--trade-bearish)"
      : "var(--brand-cyan)";
  const label = direction === "neutral" ? "NEUTRAL WATCH" : `${direction.toUpperCase()} WATCH`;

  return (
    <main className="min-w-0 space-y-3">
      <CockpitCard bodyClassName="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <TickerLogo symbol={analysis.symbol} size="lg" />
            <div>
              <div className="flex items-baseline gap-2">
                <h2 className="font-mono text-2xl font-bold tracking-wide text-foreground">{analysis.symbol}</h2>
                <span
                  className="border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]"
                  style={{ color, borderColor: `${color}66`, background: `${color}12` }}
                >
                  {label}
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground">
                conditions read · not an active trade
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-3xl font-bold leading-none tabular-nums" style={{ color }}>
              ${read.spot.toFixed(2)}
            </p>
            <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
              latest close
            </p>
          </div>
        </div>

        <NexusPriceChart syncGroup="cockpit" symbol={analysis.symbol} initialTf="1D" height={340} />

        <div className="grid gap-px border border-border/45 bg-border/45 sm:grid-cols-3">
          <div className="bg-card px-3 py-3">
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Directional evidence</p>
            <p className="mt-1 font-mono text-[18px] font-bold tabular-nums" style={{ color }}>
              {read.directional.aligned}/{read.directional.assessed || "—"}
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">conditions align</p>
          </div>
          <div className="bg-card px-3 py-3">
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Conflict</p>
            <p className="mt-1 font-mono text-[18px] font-bold tabular-nums text-foreground">{read.directional.conflicting}</p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">conditions disagree</p>
          </div>
          <div className="bg-card px-3 py-3">
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Status</p>
            <p className="mt-1 font-mono text-[12px] font-bold uppercase" style={{ color }}>watch</p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">no entry published</p>
          </div>
        </div>
      </CockpitCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <CockpitCard title="Directional conditions" meta={`${read.dimensions.length} live dimensions`}>
          <div className="divide-y divide-border/45">
            {read.dimensions.map((dimension) => {
              const stateColor = dimension.state === "bullish"
                ? "var(--trade-bullish)"
                : dimension.state === "bearish"
                  ? "var(--trade-bearish)"
                  : dimension.state === "caution"
                    ? "var(--brand-gold)"
                    : "var(--muted-foreground)";
              return (
                <div key={dimension.key} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">{dimension.label}</span>
                    <span className="text-right font-mono text-[10px] font-bold tabular-nums" style={{ color: stateColor }}>{dimension.value}</span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">{dimension.read}</p>
                </div>
              );
            })}
          </div>
        </CockpitCard>
        <CockpitCard title="Publication gate" meta="What is missing">
          <p className="font-mono text-[11px] leading-relaxed text-foreground/85">{read.directional.summary}</p>
          <p className="mt-3 border-t border-border/45 pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">{read.directional.nextCheck}</p>
          {read.cautions.length > 0 && (
            <div className="mt-3 border-t border-border/45 pt-3">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--brand-gold)]">Caution</p>
              {read.cautions.map((caution) => <p key={caution} className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">{caution}</p>)}
            </div>
          )}
          <div className="mt-4 border-t border-border/45 pt-3">
            <button
              type="button"
              onClick={onWatch}
              disabled={watching || !!watchStatus}
              className="border border-[var(--brand-cyan)]/45 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand-cyan)] transition-colors hover:bg-[var(--brand-cyan)]/10 disabled:opacity-60"
            >
              {watching ? "Adding…" : watchStatus ? "Watching" : "+ Add to watchlist"}
            </button>
            {watchStatus && <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">{watchStatus}</p>}
          </div>
        </CockpitCard>
      </div>
    </main>
  );
}

function OnDemandEvidenceRail({ analysis }: { analysis: OnDemandAnalysis }) {
  if (analysis.read) {
    const read = analysis.read;
    const tone = read.directional.bias === "bullish" ? "bull" : read.directional.bias === "bearish" ? "bear" : "structural";
    return (
      <aside className="space-y-3 self-start lg:sticky lg:top-3">
        <Readout
          title="Directional watch"
          meta={<span className="text-[var(--brand-cyan)]">On demand</span>}
          value={`${read.directional.aligned}/${read.directional.assessed || "—"}`}
          qualifier={`${read.directional.bias.toUpperCase()} · WATCH`}
          valueTone={tone}
          note="This is evidence coverage, not a Conviction score or probability of profit."
        />
        <Readout
          title="Publication"
          value="WAIT"
          qualifier="no entry / target / contract"
          valueTone="time"
          note="A trigger, invalidation and structural destination must all be verified before this becomes an Active Signal."
        />
      </aside>
    );
  }

  const overall = analysis.overall ?? {};
  const score = Math.max(0, Math.min(100, overall.score ?? 0));
  const components = Object.entries(analysis.components ?? {}).filter(
    ([, value]) => typeof value?.score === "number",
  );
  return (
    <aside className="space-y-3 self-start lg:sticky lg:top-3">
      <Readout
        title="Analysis grade"
        meta={<span className="text-[var(--brand-cyan)]">On demand</span>}
        value={score}
        qualifier={`${overall.grade ?? overall.tier ?? "—"} · ${overall.recommendation?.replace(/_/g, " ") ?? "ANALYSED"}`}
        valueTone="structural"
        note="Evidence index, not a probability of profit."
      >
        <BandScale
          value={score}
          bands={[
            { label: "D", floor: 0 },
            { label: "C", floor: 50 },
            { label: "B", floor: 60 },
            { label: "A", floor: 70 },
            { label: "S", floor: 85 },
          ]}
          tone="structural"
        />
      </Readout>
      <Readout
        title="Coverage"
        value={components.length}
        qualifier="dimensions returned"
        valueTone="structural"
        note="No scanner entry, target, contract, or rank has been fabricated for this read."
      />
    </aside>
  );
}

function InsightList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "bull" | "bear";
}) {
  const color =
    tone === "bull" ? "var(--trade-bullish)" : "var(--trade-bearish)";
  return (
    <div>
      <p
        className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.13em]"
        style={{ color }}
      >
        {title}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li
            key={`${item}-${i}`}
            className="font-mono text-[10px] leading-relaxed text-muted-foreground"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function componentLabel(key: string) {
  return key === "ml" ? "ML" : key === "orderFlow" ? "Flow" : key;
}

function gradeToneFor(grade: string) {
  return /^S/i.test(grade)
    ? "#e0a458"
    : /^A/i.test(grade)
      ? "var(--brand-cyan)"
      : /^B/i.test(grade)
        ? "#7aa2f7"
        : "var(--muted-foreground)";
}

const STAT_TONE: Record<string, string> = {
  cyan: "var(--brand-cyan)",
  bull: "var(--trade-bullish)",
  bear: "var(--trade-bearish)",
};

/**
 * CockpitCard — the ONE card primitive for the whole cockpit. Uniform chrome
 * (border + radius + bg) and a consistent titled header strip so every panel
 * reads as part of the same system instead of ad-hoc stacked boxes.
 */
function CockpitCard({
  title,
  meta,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-card-border bg-card overflow-hidden",
        className,
      )}
    >
      {(title || meta) && (
        <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/30">
          {title && (
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              {title}
            </span>
          )}
          {meta && (
            <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
              {meta}
            </span>
          )}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A single labelled metric tile — used in the hero's uniform levels grid. */
function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  const color = tone
    ? (STAT_TONE[tone] ?? "var(--foreground)")
    : "var(--foreground)";
  return (
    <div className="rounded-md border border-border/30 bg-foreground/[0.02] px-2.5 py-2">
      <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className="text-base font-mono font-bold tabular-nums mt-0.5"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

function ContextRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear";
}) {
  const color =
    tone === "bull"
      ? "var(--trade-bullish)"
      : tone === "bear"
        ? "var(--trade-bearish)"
        : "var(--foreground)";
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className="text-[11px] font-mono font-bold tabular-nums"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}

function fmt(n: number | null | undefined): string {
  return typeof n === "number" && isFinite(n) ? `$${n.toFixed(2)}` : "—";
}
