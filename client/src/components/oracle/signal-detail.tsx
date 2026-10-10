/**
 * ORACLE signal detail — every panel is driven by lib/oracle/signal-geometry, so the
 * numbers on screen are derived once and stay consistent across panels.
 *
 *   PriceLadder    — STOP / ENTRY / LIVE / T1 / T2, each with $, signed %, and R away.
 *   ConfidenceBars — VALIDITY / PROGRESS / PACE / OVERLAY.
 *   RiskPanel      — size, R:R, level distances in R, and horizon spent, in one
 *                    card. Merged from three (Position Size / Trade Geometry /
 *                    Risk / Reward) that shared `geometryFor` and restated the
 *                    same ratio three ways across 649px.
 *   ProfitPlan     — the scale-out rungs (40% at T1 + trail to entry, 60% at T2).
 *   ContextPanel   — the interpreting sentence + what to do now.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { clarifyOracleNarrative, bandStrength, type ConvictionPick } from '@/lib/convictions';
import { computeGeometry, type SignalGeometry, type Level } from '@/lib/oracle/signal-geometry';
import { trackScore } from '@/lib/oracle/score-tracker';
import { useUserPrefs } from '@/components/terminal/terminal-settings';
import { TC, healthColor, statusColor } from '@/lib/design-tokens';
import { EASE, DUR } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Readout } from '@/components/templates/kit';
import { sizingFor } from '@shared/sizing';
import { LiveValue } from '@/components/viz';
import { GapMagnets } from './gap-magnets';
import { SignalTrajectory } from '@/components/hunt/cockpit/signal-trajectory';

const BULL = 'var(--trade-bullish,#22c55e)';
const BEAR = 'var(--trade-bearish,#ef4444)';
const CYAN = 'var(--brand-cyan,#3b8cff)';
const GOLD = '#e0a458';

const money = (n: number) => (n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toFixed(2));

function triggerRead(pick: ConvictionPick, live: number) {
  const distancePct = pick.entryPrice > 0
    ? Math.abs(((live - pick.entryPrice) / pick.entryPrice) * 100)
    : 0;
  const crossed = pick.direction === 'short' ? live <= pick.entryPrice : live >= pick.entryPrice;
  const side = live >= pick.entryPrice ? 'above' : 'below';
  return {
    distancePct,
    crossed,
    text: crossed
      ? `crossed by ${distancePct.toFixed(2)}% · observer pending`
      : `${distancePct.toFixed(2)}% ${side} trigger · no position`,
  };
}

/** Build geometry from a pick + live price. Shared by every panel below. */
export function geometryFor(pick: ConvictionPick, live: number): SignalGeometry {
  return computeGeometry({
    direction: pick.direction,
    entryPrice: pick.entryPrice,
    targetPrice: pick.targetPrice,
    stopLoss: pick.stopLoss,
    live: live || pick.currentPrice || pick.entryPrice,
    riskRewardRatio: pick.riskRewardRatio,
    holdingPeriod: pick.holdingPeriod,
    optionDte: pick.optionDte,
    expiryDate: pick.expiryDate,
    generatedAt: pick.generatedAt,
    convictionScore: pick.convictionScore,
    lifecycleState: pick.lifecycleState,
  });
}

const ROLE: Record<Level['key'], { color: string }> = {
  t2:    { color: BULL },
  t1:    { color: BULL },
  // ENTRY is the frozen, structural reference from the published signal.
  // Cyan is deliberately reserved for that reference throughout the terminal.
  live:  { color: CYAN },
  entry: { color: CYAN },
  stop:  { color: BEAR },
};

/**
 * The live trade read as one physical path: hard stop → entry → T1 → T2.
 * The bead is the only animated element because it is the only number that
 * changes. Recorded checkpoints below it are fetched from the audit trail,
 * so the page never turns one current quote into a fictional history.
 */
function TradeVector({ pick, live }: { pick: ConvictionPick; live: number }) {
  const reduce = useReducedMotion();
  const g = geometryFor(pick, live);
  const awaitingTrigger = g.status === 'pending_trigger';
  const trigger = triggerRead(pick, live);
  const levelPrices = [pick.stopLoss, pick.entryPrice, pick.targetPrice, ...(g.t2 != null ? [g.t2] : [])];
  const min = Math.min(...levelPrices);
  const max = Math.max(...levelPrices);
  const span = Math.max(max - min, Math.abs(max) * 0.01, 0.01);
  const x = (price: number) => Math.max(1, Math.min(99, ((price - min) / span) * 100));
  const points = [
    { label: 'STOP', price: pick.stopLoss, color: BEAR },
    { label: awaitingTrigger ? 'TRIGGER' : 'ENTRY', price: pick.entryPrice, color: CYAN },
    { label: 'T1', price: pick.targetPrice, color: BULL },
    ...(g.t2 != null ? [{ label: 'T2', price: g.t2, color: BULL }] : []),
  ];
  const liveColor = g.pnlPct > 0.001 ? BULL : g.pnlPct < -0.001 ? BEAR : CYAN;

  return (
    <div className="border-t border-border/30 px-4 py-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {awaitingTrigger ? 'Entry trigger watch' : 'Live trade vector'}
        </span>
        <span className="font-mono text-[10px] tabular-nums" style={{ color: awaitingTrigger ? GOLD : g.pnlPct >= 0 ? BULL : BEAR }}>
          {awaitingTrigger
            ? trigger.text
            : `${g.pnlPct >= 0 ? '+' : ''}${g.pnlPct.toFixed(2)}% from entry`}
        </span>
      </div>
      <div className="relative h-12">
        <div className="absolute left-0 right-0 top-5 h-px bg-border/70" />
        <div
          className="absolute top-5 h-px"
          style={{
            background: liveColor,
            left: `${Math.min(x(pick.entryPrice), x(live))}%`,
            width: `${Math.abs(x(live) - x(pick.entryPrice))}%`,
            opacity: 0.7,
          }}
        />
        {points.map((point) => (
          <div key={point.label} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${x(point.price)}%` }}>
            <span className="block h-3 w-px mx-auto" style={{ background: point.color }} />
            <span className="mt-1 block font-mono text-[9px] font-bold uppercase tracking-[0.11em]" style={{ color: point.color }}>{point.label}</span>
            <span className="block font-mono text-[9px] tabular-nums text-muted-foreground">${money(point.price)}</span>
          </div>
        ))}
        <motion.span
          className="absolute top-[15px] block h-3 w-3 -translate-x-1/2 rounded-full border-2 border-card"
          animate={{ left: `${x(live)}%` }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 175, damping: 22 }}
          style={{ background: liveColor, boxShadow: `0 0 0 3px color-mix(in srgb, ${liveColor} 18%, transparent), 0 0 12px color-mix(in srgb, ${liveColor} 46%, transparent)` }}
          title={`Live $${money(live)}`}
        />
      </div>
      <SignalTrajectory ideaId={pick.ideaId} live={live} />
    </div>
  );
}

function Card({ title, meta, children, className }: { title: string; meta?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-card-border bg-card overflow-hidden', className)}>
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
        <span className="text-meta font-mono font-bold uppercase tracking-widest text-foreground/80">{title}</span>
        {meta && <span className="text-label font-mono text-muted-foreground">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── PriceLadder ──

export function PriceLadder({ pick, live, className }: { pick: ConvictionPick; live: number; className?: string }) {
  const reduce = useReducedMotion();
  const g = geometryFor(pick, live);
  const awaitingTrigger = g.status === 'pending_trigger';
  const trigger = triggerRead(pick, live || pick.entryPrice);
  const liveColor = g.pnlPct > 0.001 ? BULL : g.pnlPct < -0.001 ? BEAR : CYAN;
  const atEntry = Math.abs((live || pick.entryPrice) - pick.entryPrice) <= Math.max(Math.abs(pick.entryPrice) * 0.0001, 0.01);
  const planLevels = g.levels.filter((level) => level.key !== 'live');

  // Laid out in normal flow, not absolutely positioned inside a fixed-height box.
  // The old version placed each rung by price within a set height, so squeezing the card
  // clipped ENTRY and STOP straight off the bottom — the two levels you least want hidden.
  // Flow layout can't clip: the card is exactly as tall as its rungs need.
  return (
    <Card title="Price Ladder" meta={<span style={{ color: statusColor(g.status) }}>{g.statusLabel}</span>} className={className}>
      {/* LIVE is a changing quote. Before the gate fires, the cyan level is a
          TRIGGER—not an executed entry. Keeping this distinction explicit stops
          an unfilled plan being read as a position. */}
      <div className="flex items-center justify-between gap-3 border-b border-border/35 bg-foreground/[0.025] px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-label font-mono font-bold uppercase tracking-[0.13em]" style={{ color: liveColor }}>
            <span className="relative h-1.5 w-1.5 rounded-full" style={{ background: liveColor }}>
              {!reduce && <motion.span className="absolute inset-0 rounded-full" style={{ background: liveColor }} animate={{ scale: [1, 2.5, 1], opacity: [0.7, 0, 0.7] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }} />}
            </span>
            Live quote
          </div>
          <div className="mt-0.5 text-label font-mono text-muted-foreground">
            {awaitingTrigger
              ? trigger.text.replace('no position', 'not entered')
              : atEntry ? 'At recorded entry' : `${g.pnlPct >= 0 ? '+' : ''}${g.pnlPct.toFixed(2)}% versus entry`}
          </div>
        </div>
        <div className="text-right">
          <div className="text-value font-mono font-bold tabular-nums" style={{ color: liveColor }}><LiveValue value={live || pick.entryPrice} format={(n) => `$${money(n)}`} /></div>
          <div className="text-label font-mono tabular-nums text-muted-foreground">{awaitingTrigger ? 'TRIGGER' : 'ENTRY'} ${money(pick.entryPrice)} · fixed</div>
        </div>
      </div>
      <div className="divide-y divide-border/20">
        {planLevels.map((l) => {
          const c = ROLE[l.key].color;
          const favorableFromLive = pick.direction === 'short' ? l.price <= (live || pick.entryPrice) : l.price >= (live || pick.entryPrice);
          return (
            /* `layout` is the whole point of this rung being a motion element.
               levels are sorted by price (signal-geometry.ts), so when price
               crosses T1 or breaks ENTRY the LIVE rung genuinely changes index —
               it climbs or falls through the ladder. Without layout that reorder
               was an instant swap and the single most meaningful event on the
               card passed unseen. With it, LIVE slides between rungs and the
               move reads as a move.

               This is Tier 1 motion under viz/MOTION.md: it fires because the
               data changed, and it encodes WHICH WAY. Off under reduced motion,
               where the reordered list still tells the truth, just without the
               travel. */
            <motion.div
              key={l.key}
              layout={!reduce}
              className={cn('flex items-center gap-3 px-4 py-1.5', l.key === 'entry' && 'bg-[var(--brand-cyan)]/[0.035]')}
              initial={reduce ? false : { opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: DUR.base, ease: EASE, layout: { duration: 0.45, ease: EASE } }}
            >
              <span className="relative grid w-4 shrink-0 place-items-center">
                <span className="h-2 w-2 rounded-full" style={{ background: c, boxShadow: `0 0 8px color-mix(in srgb, ${c} 55%, transparent)` }} />
              </span>

              <span className="w-12 shrink-0 text-label font-mono font-bold uppercase tracking-wider" style={{ color: c }}>
                {l.key === 'entry' && awaitingTrigger ? 'TRIGGER' : l.label}
              </span>

              <span className="text-value font-mono font-bold tabular-nums text-foreground">
                ${money(l.price)}
              </span>

              <span className="ml-auto text-right text-label font-mono tabular-nums">
                <>
                  <span style={{ color: l.key === 'entry' ? CYAN : favorableFromLive ? BULL : BEAR }}>
                    {l.key === 'entry'
                      ? awaitingTrigger ? 'Waiting' : 'Recorded'
                      : `${l.pctFromLive >= 0 ? '+' : ''}${l.pctFromLive.toFixed(2)}%`}
                  </span>
                  <span className="text-muted-foreground"> · {l.key === 'entry' ? '0.0' : l.rAway.toFixed(1)}R</span>
                </>
              </span>
            </motion.div>
          );
        })}
      </div>

      <TradeVector pick={pick} live={live || pick.entryPrice} />

      {/* Market structure, kept below the plan levels rather than mixed into them.
          See gap-magnets.tsx for why they are not rungs. */}
      <GapMagnets symbol={pick.symbol} />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────── ConfidenceBars ──

export function ConfidenceBars({ pick, live, className }: { pick: ConvictionPick; live: number; className?: string }) {
  const reduce = useReducedMotion();
  const g = geometryFor(pick, live);
  const rating = trackScore(pick.ideaId, pick.convictionScore);
  const arrow = rating.direction === 'up' ? '▲' : rating.direction === 'down' ? '▼' : null;
  const [showMath, setShowMath] = useState(false);

  // The confluence layers ARE the score — this is the arithmetic behind the number.
  // Sorted by absolute impact so the layers that actually decided it read first, and
  // split into what helped vs what hurt, because a 34 built on +41/−7 is a different
  // trade from a 34 built on +34/0.
  const layers = [...(pick.layers ?? [])].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const helped = layers.filter((l) => l.points > 0);
  const hurt = layers.filter((l) => l.points < 0);
  const plus = helped.reduce((s, l) => s + l.points, 0);
  const minus = hurt.reduce((s, l) => s + l.points, 0);

  return (
    <Card
      title="Evidence grade"
      meta={
        <span className="flex items-baseline gap-1">
          <span className="text-value font-bold" style={{ color: TC.info }}>{pick.convictionBand}</span>
          {arrow && (
            <span
              className="text-label font-mono font-bold tabular-nums"
              style={{ color: rating.direction === 'up' ? TC.bull : TC.bear }}
              title={`Rating ${rating.direction} ${Math.abs(rating.delta)} pts since first seen ${rating.hoursTracked < 1 ? 'under an hour' : `${Math.round(rating.hoursTracked)}h`} ago`}
            >
              {arrow}{Math.abs(rating.delta)}
            </span>
          )}
        </span>
      }
      className={className}
    >
      <div className="px-4 py-3 space-y-2.5">
        <div className="text-label font-mono uppercase tracking-wider text-muted-foreground">
          +{pick.convictionScore} net evidence · {bandStrength(pick.convictionBand)} · {pick.layerCount ?? pick.layers?.length ?? 0} active layers
        </div>
        {/* how the score was built */}
        <button
          onClick={() => setShowMath((v) => !v)}
          className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-border/40 bg-foreground/[0.03] px-3 py-2 transition-colors hover:bg-foreground/[0.06]"
          aria-expanded={showMath}
        >
          <span className="text-label font-mono uppercase tracking-widest text-muted-foreground">
            How this score was built
          </span>
          <span className="flex items-baseline gap-1.5 font-mono tabular-nums">
            <span className="text-meta" style={{ color: TC.bull }}>+{plus}</span>
            {minus < 0 && <span className="text-meta" style={{ color: TC.bear }}>{minus}</span>}
            <span className="text-label text-muted-foreground">= {pick.convictionScore}</span>
            <span className="text-label text-muted-foreground">{showMath ? '▲' : '▼'}</span>
          </span>
        </button>

        {showMath && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            transition={{ duration: DUR.base, ease: EASE }}
            className="space-y-2 overflow-hidden"
          >
            {helped.length > 0 && (
              <div>
                <div className="mb-1 text-label font-mono uppercase tracking-widest" style={{ color: TC.bull }}>
                  Supporting · +{plus}
                </div>
                <div className="space-y-1">
                  {helped.map((l, i) => <LayerRow key={`h${i}`} layer={l} />)}
                </div>
              </div>
            )}
            {hurt.length > 0 && (
              <div>
                <div className="mb-1 text-label font-mono uppercase tracking-widest" style={{ color: TC.bear }}>
                  Working against · {minus}
                </div>
                <div className="space-y-1">
                  {hurt.map((l, i) => <LayerRow key={`x${i}`} layer={l} />)}
                </div>
              </div>
            )}
            <p className="text-label leading-relaxed text-muted-foreground">
              {hurt.length === 0
                ? 'Nothing is currently arguing against this setup.'
                : `${hurt.length} layer${hurt.length > 1 ? 's are' : ' is'} arguing against it — read those before sizing up.`}
            </p>
          </motion.div>
        )}

        {g.components.map((c) => (
          <div key={c.key}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-label font-mono uppercase tracking-wider text-muted-foreground">{c.label}</span>
              <span className="text-label font-mono tabular-nums" style={{ color: healthColor(c.value) }}>{c.value}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-foreground/8">
              <motion.div className="h-full rounded-full"
                style={{ background: healthColor(c.value) }}
                initial={reduce ? false : { width: 0 }} animate={{ width: `${c.value}%` }}
                transition={{ duration: DUR.slow, ease: EASE }} />
            </div>
            <div className="mt-0.5 text-label font-mono text-muted-foreground">{c.why}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────── RiskPanel ──

/**
 * RISK PANEL — position size, geometry and reward in ONE card.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS REPLACES, AND WHY
 * ═══════════════════════════════════════════════════════════════════════════
 * The cockpit's right column carried three separate cards — Position Size (296px),
 * Trade Geometry (160px) and Risk / Reward (193px) — 649px answering one
 * question: how much do I put on, and what do I get for it.
 *
 * They all read the same `geometryFor(pick, live)`, and the overlap was literal
 * rather than thematic. Measured on HCA:
 *
 *     Risk / Reward     "2.00 : 1"
 *     Trade Geometry    "T1 target — 2.0R away"     ← the same number, restated
 *     Position Size     "Risking $0 / Reward at T1" ← the same ratio × units
 *
 * A reader who notices they are the same wonders which one is authoritative. A
 * reader who does not notice believes there is more evidence here than there is.
 * Three cards also implies three subjects, so the eye searches for a distinction
 * that was never there.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ORDER IS THE QUESTION ORDER
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. how many can I take        → size, or the reason it is zero
 *   2. what do I risk and make    → per unit, then for this position
 *   3. where are the levels       → stop / T1 / T2 as R
 *   4. how long have I got        → horizon consumed
 *
 * Nothing is dropped. Every number the three cards showed is here, each stated
 * exactly once, including the zero-size explanation — which is the most valuable
 * copy in the old set and the easiest thing to lose in a merge.
 */
export function RiskPanel({ pick, live, className }: { pick: ConvictionPick; live: number; className?: string }) {
  const g = geometryFor(pick, live);
  const { data: prefs } = useUserPrefs();

  const account = prefs?.accountSize ?? 0;
  /**
   * Budget and stop rule come from the DTE ladder rather than one flat 2%. A
   * 0DTE and a 390-day LEAP were sized by the same rule, which made every
   * long-dated contract read "too big for this account" — arithmetically right,
   * practically useless. See shared/sizing.ts.
   */
  // DTE from the expiry date, never the value stored at publish (audit 2026-09-24).
  const expiry = (pick as any).expiryDate ? String((pick as any).expiryDate).slice(0, 10) : null;
  const liveDte = expiry
    ? Math.max(0, Math.ceil((new Date(expiry + 'T20:00:00Z').getTime() - Date.now()) / 86_400_000))
    : (pick as any).optionDte;
  const rule = sizingFor(liveDte, prefs as any);
  const riskBudget = rule.budget;

  // Size off the contract's premium NOW. Sizing off the publish-time premium
  // buys double the intended risk if the premium has doubled since.
  const liveContractQ = useQuery<{ found: boolean; mid: number | null; asOf: string }>({
    queryKey: [
      `/api/contract-live/${pick.symbol}?type=${pick.optionType ?? 'call'}&strike=${pick.strikePrice ?? ''}&expiry=${expiry ?? ''}`,
    ],
    enabled: !!(pick.optionType && pick.strikePrice && expiry),
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: 0,
  });

  const byKey = (k: Level['key']) => g.levels.find((l) => l.key === k);
  const riskShare = (g.risk / (g.risk + g.reward)) * 100;

  // Is this signal expressed as a contract? Then size contracts, not shares.
  const publishedPremium = Number((pick as any).entryPremium ?? (pick as any).contractPrice ?? 0);
  const livePremium = liveContractQ.data?.found && liveContractQ.data.mid ? liveContractQ.data.mid : null;
  const premium = livePremium ?? publishedPremium;
  const premiumIsLive = livePremium != null;
  const isOption = !!(pick.optionType && pick.strikePrice && premium > 0);

  // Short-dated: risk is the premium under the −50% stop. Long-dated: the
  // ladder returns null because a LEAP is managed on the underlying's level, so
  // the whole premium is the exposure and no stop is invented for it.
  const riskPerUnit = isOption
    ? (rule.premiumStopPct != null ? premium * rule.premiumStopPct * 100 : premium * 100)
    : g.risk;
  const costPerUnit = isOption ? premium * 100 : (live || pick.entryPrice);

  const sized = account > 0 && g.risk > 0;
  const units = sized ? Math.max(0, Math.floor(riskBudget / Math.max(riskPerUnit, 0.01))) : 0;
  const cost = units * costPerUnit;
  const pctOfAccount = account > 0 ? (cost / account) * 100 : 0;

  const projectedAtT1 = Number((pick as any).projectedAtT1 ?? 0);
  const rewardAtT1 = isOption
    ? (projectedAtT1 > 0 ? (projectedAtT1 - premium) * 100 * units : 0)
    : units * g.reward;

  const overAllocated = pctOfAccount > 100;
  const unitLabel = isOption ? (units === 1 ? 'contract' : 'contracts') : 'shares';

  // Rendered through the shared Readout so the whole rail is one block repeated,
  // not four bespoke panels — see templates/kit.tsx for why that is the actual
  // difference between this rail and the signal grid.
  return (
    <Readout
      title="Risk & Size"
      meta={sized ? (rule.basis === 'allocation' ? 'allocation' : 'risk budget') : 'at entry'}
      value={sized ? units : g.rr.toFixed(2)}
      qualifier={sized ? `${unitLabel} · ${g.rr.toFixed(2)}:1` : ': 1 — set account size to size it'}
      valueTone={sized && units === 0 ? 'time' : 'structural'}
      className={className}
    >
      <div className="space-y-3">

        {/* the split bar — the one thing in the old Risk/Reward card that was
            genuinely visual rather than another restatement of the ratio */}
        <div>
          <div className="flex h-1.5 overflow-hidden rounded-full">
            <div style={{ width: `${riskShare}%`, background: BEAR }} />
            <div style={{ width: `${100 - riskShare}%`, background: CYAN }} />
          </div>
          <div className="mt-1 flex justify-between text-label font-mono uppercase tracking-wider text-muted-foreground">
            <span>◀ risk</span><span>reward ▶</span>
          </div>
        </div>

        {/* 2 · WHAT IT COSTS — per unit always; for the position only once sized */}
        <div className="grid grid-cols-2 gap-2 border-t border-border/30 pt-2.5">
          <Mini label="Risk to stop" value={`−$${g.risk.toFixed(2)}`} color={TC.bear} />
          <Mini label="Reward to T1" value={`+$${g.reward.toFixed(2)}`} color={TC.bull} />
          {sized && units > 0 && (
            <>
              <Mini label="Position cost" value={`$${cost.toFixed(0)}`} />
              <Mini label="Of account" value={`${pctOfAccount.toFixed(1)}%`} color={overAllocated ? TC.bear : undefined} />
              <Mini label="Risking" value={`$${Math.min(riskBudget, units * riskPerUnit).toFixed(0)}`} color={TC.bear} />
              <Mini label="Reward at T1" value={rewardAtT1 > 0 ? `+$${rewardAtT1.toFixed(0)}` : '—'} color={TC.bull} />
            </>
          )}
        </div>

        {/* 3 · THE LEVELS — as R, which is the only notation that survives a
               change of instrument */}
        <div className={cn(
          "grid gap-2 border-t border-border/30 pt-2.5",
          g.t2 != null ? "grid-cols-3" : "grid-cols-2",
        )}>
          <Mini label="Stop" value={`${byKey('stop')?.rAway.toFixed(1)}R`} color={BEAR} />
          <Mini label="T1" value={`${byKey('t1')?.rAway.toFixed(1)}R`} color={BULL} />
          {g.t2 != null && (
            <Mini label="T2" value={`${byKey('t2')?.rAway.toFixed(1)}R`} color={BULL} />
          )}
        </div>

        {/* 4 · TIME */}
        <div className="flex items-baseline justify-between gap-2 border-t border-border/30 pt-2.5">
          <span className="text-label font-mono uppercase tracking-wider text-muted-foreground">Horizon</span>
          <span className="text-right text-meta font-mono tabular-nums text-foreground" title={`Management window derived from ${g.horizonBasis}`}>
            {g.horizonUsedPct.toFixed(0)}% used · {g.daysHeld.toFixed(1)}/{g.horizonDays}d
            <span className="ml-1 text-[9px] text-muted-foreground">({g.horizonBasis})</span>
          </span>
        </div>

        {/* The zero is a real answer, not a blank — and the amount it is out by is
            the useful part, because it says how far off the account is. Carried
            over verbatim from PositionSize; losing it in the merge would have been
            the one genuine regression available here. */}
        {sized && (units === 0 || overAllocated) && (
          <p className="text-label leading-relaxed text-muted-foreground border-t border-border/30 pt-2.5">
            {units === 0 && isOption
              ? `Too big for this account. One contract costs $${costPerUnit.toFixed(0)} and commits $${riskPerUnit.toFixed(0)} — ${(riskPerUnit / Math.max(riskBudget, 0.01)).toFixed(1)}× your $${riskBudget.toFixed(0)} ${rule.basis === 'allocation' ? 'per-idea capital' : 'options budget'}. Look at a cheaper strike or further expiry.`
              : units === 0
                ? `Too big for this account. One share risks $${riskPerUnit.toFixed(2)} against a $${riskBudget.toFixed(0)} budget.`
                : `This size costs more than your whole account — scale down.`}
          </p>
        )}

        {sized && units > 0 && !overAllocated && (
          <p className="text-label leading-relaxed text-muted-foreground border-t border-border/30 pt-2.5">
            {isOption
              ? `${units} ${unitLabel} at $${premium.toFixed(2)} (${premiumIsLive ? "live premium" : "premium at publish — live chain unavailable"}). ${rule.why}`
              : `Sized against your $${account.toLocaleString()} account.`}
          </p>
        )}
      </div>
    </Readout>
  );
}

function LayerRow({ layer }: { layer: { label?: string; kind?: string; points: number; why?: string } }) {
  const pos = layer.points >= 0;
  return (
    <div className="flex items-start gap-2">
      <span className="w-7 shrink-0 text-right text-meta font-mono font-bold tabular-nums"
            style={{ color: pos ? TC.bull : TC.bear }}>
        {pos ? '+' : ''}{layer.points}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-label font-mono uppercase tracking-wider text-foreground/80">
          {layer.label ?? layer.kind}
        </span>
        {layer.why && (
          <span className="block text-label leading-relaxed text-muted-foreground">{layer.why}</span>
        )}
      </span>
    </div>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded border border-border/40 px-2 py-1">
      <div className="text-label font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-body font-mono font-bold tabular-nums" style={{ color: color ?? 'var(--foreground)' }}>{value}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────── ProfitPlan ──

export function ProfitPlan({ pick, live, className }: { pick: ConvictionPick; live: number; className?: string }) {
  const g = geometryFor(pick, live);
  // Context ladder: T1-T3 from real levels (structure, dealer walls, prior
  // swings) with reach odds — replaces formula-only targets (2026-09-24).
  const ladderQ = useQuery<{
    rungs: Array<{ rung: string; price: number; source: string; rMultiple: number; probTouch: number; structural: boolean }>;
    expectedRange: number; horizonDays: number; publishedTargetNote: string | null; note: string;
  }>({
    queryKey: [`/api/target-ladder/${pick.symbol}?direction=${pick.direction}&entry=${pick.entryPrice}&stop=${pick.stopLoss}&hp=${pick.holdingPeriod ?? ''}&target=${pick.targetPrice ?? ''}`],
    enabled: !!(pick.entryPrice && pick.stopLoss) && (pick as any).levelBasis !== 'contract',
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const lad = ladderQ.data;
  const hitIdx = lad ? lad.rungs.filter((r) => (pick.direction === 'long' ? live >= r.price : live <= r.price)).length : 0;
  return (
    <Card title="Profit Taking Plan" meta={lad ? `levels from structure · ±$${lad.expectedRange.toFixed(2)} range over ${lad.horizonDays}d` : undefined} className={className}>
      {lad && lad.rungs.length > 0 ? (
        <div className="divide-y divide-border/30">
          {lad.rungs.map((r, i) => (
            <div key={r.rung} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-6 shrink-0 text-label font-mono font-bold tracking-wider" style={{ color: CYAN }}>{r.rung}</span>
              <div className="min-w-0 flex-1">
                <div className="text-value font-mono font-bold tabular-nums text-foreground">
                  ${money(r.price)} <span className="text-label font-normal text-muted-foreground">· {r.rMultiple.toFixed(1)}R · {Math.round(r.probTouch * 100)}% reach</span>
                </div>
                <div className="text-label font-mono" style={{ color: r.structural ? 'var(--foreground)' : 'var(--amber, #e8b34b)', opacity: 0.75 }}>
                  {r.source}{i === 0 ? ' — take partial, move stop to entry' : i === lad.rungs.length - 1 ? ' — runner exit' : ' — scale again'}
                </div>
              </div>
              <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-label font-mono uppercase tracking-wider',
                i < hitIdx ? 'border-[var(--brand-cyan,#3b8cff)]/40 text-[var(--brand-cyan,#3b8cff)]' : 'border-border/50 text-muted-foreground')}>
                {i < hitIdx ? 'Hit' : i === hitIdx ? 'Next' : 'Pending'}
              </span>
            </div>
          ))}
          {lad.publishedTargetNote && (
            <div className="px-4 py-2 text-label font-mono text-muted-foreground">Card's original target: {lad.publishedTargetNote}.</div>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {g.plan.map((p) => (
            <div key={p.rung} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-6 shrink-0 text-label font-mono font-bold tracking-wider" style={{ color: CYAN }}>{p.rung}</span>
              <div className="min-w-0 flex-1">
                <div className="text-value font-mono font-bold tabular-nums text-foreground">${money(p.price)}</div>
                <div className="text-label font-mono text-muted-foreground">{ladderQ.isLoading ? 'mapping real levels…' : p.action}</div>
              </div>
              <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-label font-mono uppercase tracking-wider',
                p.active ? 'border-[var(--brand-cyan,#3b8cff)]/40 text-[var(--brand-cyan,#3b8cff)]' : 'border-border/50 text-muted-foreground')}>
                {p.active ? 'Active' : 'Pending'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── ContextPanel ──

export function ContextPanel({
  pick, live, regime, preferredDirection, className,
}: { pick: ConvictionPick; live: number; regime?: string; preferredDirection?: string; className?: string }) {
  const g = geometryFor(pick, live);
  const dir = pick.direction === 'long' ? 'Long' : 'Short';
  const aligns = preferredDirection ? preferredDirection.toLowerCase().includes(pick.direction) : undefined;

  const todo = (() => {
    switch (g.status) {
      case 'invalidated': return 'Stop is hit — the thesis is broken. Stand down.';
      case 'near_stop':   return `Near invalidation — only ${g.levels.find(l => l.key === 'stop')?.rAway.toFixed(1)}R from the stop.`;
      case 'pending_trigger': {
        const e = g.levels.find(l => l.key === 'entry');
        return `Waiting for entry — ${Math.abs(e?.pctFromLive ?? 0).toFixed(1)}% away at $${money(pick.entryPrice)}.`;
      }
      case 'at_target':   return 'At T1 — structural milestone reached. Reassess the thesis; this is not an automatic partial fill.';
      default:            return `In play — ${g.progressPct.toFixed(0)}% of the way to T1, ${g.horizonUsedPct.toFixed(0)}% of the horizon spent.`;
    }
  })();

  return (
    <Card title="Context" meta="what it means" className={className}>
      <div className="space-y-2 px-4 py-2.5">
        <p className="text-body leading-snug text-foreground/85">
          <span className="font-mono font-bold" style={{ color: pick.direction === 'long' ? BULL : BEAR }}>{dir} {pick.symbol}</span>
          {' '}— {pick.convictionBand}-band ({bandStrength(pick.convictionBand)}), {pick.layerCount ?? pick.layers?.length ?? 0} layers.
          {' '}R:R 1:{g.rr.toFixed(1)}, risking ${g.risk.toFixed(2)} to make ${g.reward.toFixed(2)} per share.
          {aligns !== undefined && regime && <> {regime} regime {aligns ? 'favors' : 'works against'} {pick.direction}s.</>}
        </p>
        {pick.thesis && <p className="text-meta leading-relaxed text-muted-foreground">{clarifyOracleNarrative(pick.thesis)}</p>}
        <div className="rounded-lg border border-border/40 bg-foreground/[0.03] px-3 py-2">
          <div className="mb-0.5 text-label font-mono uppercase tracking-widest" style={{ color: CYAN }}>What to do now</div>
          <div className="text-meta font-mono text-foreground/85">{todo}</div>
        </div>
      </div>
    </Card>
  );
}
