/**
 * SIGNAL CARD — the "oracle spoke it" presentation.
 *
 * Renders a trade signal as a stylised terminal/code readout (INIT_SIGNAL(...),
 * monospace, syntax-highlighted fields) — MomoEdge's brand voice, over data
 * QuantEdge already generates. Pure presentation; no new intelligence. Entrance
 * uses the shared motion system so it reveals line-by-line like everything else.
 */
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { stagger, enter } from "@/lib/motion";

export interface SignalCardData {
  symbol: string;
  name?: string;
  direction: "long" | "short";
  band?: string;          // conviction band (S/A/B/C) → SIGNAL_CLASS
  confidence?: number;    // 0–100
  price?: number;
  entry: number;
  target: number;
  stop: number;
  triggerLow?: number;
  triggerHigh?: number;
  riskReward?: number;
  horizon?: string;
  setup?: string;         // structure / thesis one-liner
  technicals?: string[];  // layer reasons
  status?: string;
  optionType?: string | null;
  strike?: number | null;
}

/** Map a convictions-engine pick (or any signal-ish object) to the card. */
export function signalFromPick(p: any): SignalCardData {
  const layers: any[] = Array.isArray(p?.layers) ? p.layers : [];
  const conf =
    typeof p?.convictionScore === "number"
      ? Math.round(Math.min(100, p.convictionScore * 1.8))
      : typeof p?.confidenceScore === "number"
        ? Math.round(p.confidenceScore)
        : undefined;
  return {
    symbol: p?.symbol ?? "—",
    name: p?.sector || p?.name || undefined,
    direction: p?.direction === "short" ? "short" : "long",
    band: p?.convictionBand ?? p?.probabilityBand ?? undefined,
    confidence: conf,
    price: typeof p?.currentPrice === "number" ? p.currentPrice : undefined,
    entry: Number(p?.entryPrice ?? 0),
    target: Number(p?.targetPrice ?? 0),
    stop: Number(p?.stopLoss ?? 0),
    riskReward: typeof p?.riskRewardRatio === "number" ? p.riskRewardRatio : undefined,
    horizon: p?.holdingPeriod,
    setup: p?.thesis ? String(p.thesis).slice(0, 64) : undefined,
    technicals: layers
      .slice(0, 5)
      .map((l) => String(l?.label || l?.why || l?.kind || "").toUpperCase())
      .filter(Boolean),
    status: p?.convictionBand ? `${p.convictionBand}-BAND · ${layers.length} LAYERS` : undefined,
    optionType: p?.optionType ?? null,
    strike: p?.strikePrice ?? null,
  };
}

// token colours (dark-terminal palette)
const CKEY = "var(--muted, #8b98a8)";
const CSTR = "#e0a458";
const CNUM = "#7aa2f7";
const CFN = "var(--brand-cyan, #3b8cff)";

const K = (t: string) => <span style={{ color: CKEY }}>{t}</span>;
const S = (t: string | number) => <span style={{ color: CSTR }}>"{t}"</span>;
const N = (t: string | number) => <span style={{ color: CNUM }}>{t}</span>;

export function SignalCard({ d, className }: { d: SignalCardData; className?: string }) {
  const reduce = useReducedMotion();
  const dir = d.direction === "long" ? "LONG" : "SHORT";
  const sigName = `${d.symbol}_${(d.band || "SIGNAL").toUpperCase()}_${dir}`;
  const rr = d.riskReward ? `1:${d.riskReward.toFixed(1)}` : "—";

  const Line = ({ children }: { children?: ReactNode }) => (
    <motion.div variants={enter} className="whitespace-pre">{children ?? " "}</motion.div>
  );

  return (
    <motion.div
      variants={stagger}
      initial={reduce ? false : "hidden"}
      animate="show"
      className={cn("rounded-xl border border-card-border overflow-x-auto", className)}
      style={{ background: "#0b0f15" }}
    >
      <div className="px-4 py-3 font-mono text-[12px] leading-relaxed tabular-nums">
        <Line><span style={{ color: CFN }}>INIT_SIGNAL</span>(<span style={{ color: CSTR }}>"{sigName}"</span>):</Line>
        <Line />
        <Line>    {K("ASSET")} = {S(`${d.symbol}${d.name ? ` (${d.name})` : ""}`)}</Line>
        {d.price != null && <Line>    {K("CURRENT_PRICE")} = {N(d.price.toFixed(2))}</Line>}
        <Line>    {K("DIRECTION")} = {S(dir)}</Line>
        {d.triggerLow != null && d.triggerHigh != null && (
          <Line>    {K("TRIGGER_ZONE")} = {N(d.triggerLow.toFixed(2))} – {N(d.triggerHigh.toFixed(2))}</Line>
        )}
        {d.band && (
          <Line>    {K("SIGNAL_CLASS")} = {S(d.band)}{d.confidence != null ? <>   {K("SCORE")} = {N(`${d.confidence}/100`)}</> : null}</Line>
        )}
        {d.optionType && (
          <Line>    {K("CONTRACT")} = {S(`${String(d.optionType).toUpperCase()}${d.strike ? ` $${d.strike}` : ""}`)}</Line>
        )}
        {d.setup && <Line>    {K("STRUCTURE")} = {S(d.setup)}</Line>}
        {d.status && <Line>    {K("STATUS")} = {S(d.status)}</Line>}
        {d.technicals && d.technicals.length > 0 && (
          <>
            <Line />
            <Line>    {K("TECHNICAL_SIGNALS")} = {"{"}</Line>
            {d.technicals.map((t, i) => <Line key={i}>        {S(t)}</Line>)}
            <Line>    {"}"}</Line>
          </>
        )}
        <Line />
        <Line>    {K("TARGET_MODULE")} = {"{"}</Line>
        <Line>        {K("ENTRY")}     = {N(d.entry.toFixed(2))}</Line>
        <Line>        {K("T1")}        = {N(d.target.toFixed(2))}</Line>
        <Line>        {K("RISK_ZONE")}  = {"< "}{N(d.stop.toFixed(2))}</Line>
        <Line>        {K("R_R")}       = {N(rr)}</Line>
        {d.horizon && <Line>        {K("TIME_HORIZON")} = {S(d.horizon)}</Line>}
        <Line>    {"}"}</Line>
      </div>
    </motion.div>
  );
}
