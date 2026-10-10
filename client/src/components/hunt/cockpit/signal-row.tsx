/**
 * SignalRow — one card in the ALERT STREAM.
 *
 * A signal is not a static score; it's a position moving through time. The rail is
 * deliberately a compact record, not a miniature version of the detail pane. It
 * shows only the facts needed to choose a name: direction, lifecycle, conviction,
 * and one live path from entry to T1.
 *
 * Colour discipline (lib/design-tokens): green/red mean direction and P&L
 * only. Progress and time are structural, so they use cyan/amber — otherwise a strong
 * BEARISH setup renders green and reads as bullish.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { TickerLogo } from './ticker-logo';
import { convictionPercent, type ConvictionPick } from '@/lib/convictions';
import { LivePnl } from './live-pnl';
import { geometryFor } from '@/components/oracle/signal-detail';
import { trackScore } from '@/lib/oracle/score-tracker';
import { TC, directionColor, pnlColor, statusColor, bandColor, confidenceFill } from '@/lib/design-tokens';
import { LiveValue } from '@/components/viz';

export function SignalRow({
  pick,
  selected,
  isNew = false,
  live,
  closed = false,
  onClick,
}: {
  pick: ConvictionPick;
  selected: boolean;
  isNew?: boolean;
  /** live price for P&L + progress; falls back to the pick's own price */
  live?: number;
  closed?: boolean;
  onClick: () => void;
}) {
  const color = directionColor(pick.direction);
  const dirWord = pick.direction === 'long' ? 'BULL' : 'BEAR';
  const conf = convictionPercent(pick.convictionScore);
  const px = live ?? pick.currentPrice ?? pick.entryPrice;
  const g = geometryFor(pick, px);
  // A pending plan has not entered. Its live price is useful only as a distance
  // to the trigger; presenting it as P&L or a "trade path" makes a watch look
  // like an open position (and was the source of the MSFT confusion).
  const awaitingTrigger = !closed && g.status === 'pending_trigger';
  const triggerDistancePct = pick.entryPrice > 0
    ? Math.abs(((px - pick.entryPrice) / pick.entryPrice) * 100)
    : 0;
  const triggerSide = pick.direction === 'long' ? 'below' : 'above';
  // Rank movement follows the raw signed evidence total. The old transformed
  // 0–99 display looked like a calibrated probability even though it was only a
  // band-normalisation. Keep that transform for colour interpolation, not copy.
  const rating = trackScore(pick.ideaId, pick.convictionScore);

  const reduce = useReducedMotion();
  const arrow = rating.direction === 'up' ? '▲' : rating.direction === 'down' ? '▼' : null;
  const arrowColor = rating.direction === 'up' ? TC.bull : TC.bear;

  return (
    /**
     * `layout` is what makes the board move.
     *
     * The rail is sorted by conviction (hunt-cockpit sorts on convictionScore, or on
     * progress in the other mode), so when a score updates a ticker genuinely changes
     * RANK — it climbs or falls past the names around it. Until now that reorder was
     * an instant swap between renders: the list was different, but nothing showed a
     * name moving, so the single most informative event on the board was invisible.
     *
     * With layout, a row animates from its old slot to its new one and you SEE the
     * climb. That pairs with the ▲/▼ this component already renders from trackScore —
     * the arrow says the rating changed, the movement shows what it cost or won in
     * rank. Tier 1 motion under viz/MOTION.md: it fires only because data changed.
     *
     * Off under prefers-reduced-motion — the reordered list is still correct, it just
     * arrives without the travel.
     */
    <motion.button
      layout={reduce ? false : 'position'}
      transition={{ layout: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } }}
      onClick={onClick}
      className={cn(
        'group relative w-full cursor-pointer overflow-hidden rounded-[4px] border px-3 py-3 text-left transition-[border-color,background-color,transform] duration-200',
        closed && 'opacity-60',
        selected
          ? 'border-l-[3px] bg-foreground/[0.06]'
          : isNew
            ? 'border-[var(--brand-cyan)]/45 bg-card hover:border-[var(--brand-cyan)]/70'
            : 'border-card-border bg-card hover:border-foreground/30 hover:bg-foreground/[0.025]',
      )}
      style={selected ? { borderColor: 'var(--card-border)', borderLeftColor: color, boxShadow: `inset 6px 0 16px -10px ${color}` } : undefined}
      data-testid={`signal-row-${pick.symbol}`}
    >
      {/* Identity, lifecycle and evidence are the scan line. The evidence band
          is structural—not direction—so a great short never turns green. */}
      <div className="flex items-start gap-2">
        <TickerLogo symbol={pick.symbol} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[14px] font-mono font-bold leading-none tracking-[0.08em] text-foreground">{pick.symbol}</span>
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.13em]" style={{ color }}>
              {pick.direction === 'long' ? '▲' : '▼'} {dirWord}
            </span>
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em]">
            <span className="truncate" style={{ color: closed ? TC.muted : statusColor(g.status) }}>
              {closed ? 'Closed' : g.statusLabel}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{pick.holdingPeriod}</span>
          </div>
        </div>

        {/*
          A held position shows P&L where a candidate shows its conviction band.
          It was never scored for entry, so printing a band here would invite a
          comparison against candidates that were — see server/bot-held-picks.ts.
        */}
        {pick.isBotHeld ? (
          <div className="shrink-0 border-l border-border/45 pl-2.5 text-right">
            <div className="font-mono text-[22px] font-bold leading-none">
              <LivePnl value={pick.unrealizedPnl ?? 0} />
            </div>
            <span
              className="mt-1 block font-mono text-[9px] font-bold uppercase tracking-[0.15em]"
              style={{ color: 'var(--brand-gold)' }}
              title={`Held by ${pick.botOwner ?? 'bot'}${pick.quantity ? ` · ${pick.quantity}x` : ''} — shown regardless of entry filters`}
            >
              BOT · {pick.quantity ?? 1}x
            </span>
          </div>
        ) : (
        <div className="shrink-0 border-l border-border/45 pl-2.5 text-right">
          <div className="flex items-baseline justify-end gap-1.5">
            <span className="font-mono text-[22px] font-bold leading-none" style={{ color: bandColor(pick.convictionBand) }}>{pick.convictionBand}</span>
            <span className="font-mono text-[9px] font-bold tabular-nums text-muted-foreground">+{pick.convictionScore}</span>
            {arrow && (
              <span className="font-mono text-[9px] font-bold tabular-nums" style={{ color: arrowColor }}
                    title={`Rating ${rating.direction === 'up' ? 'up' : 'down'} ${Math.abs(rating.delta)} since first seen ${rating.hoursTracked < 1 ? 'under an hour' : `${Math.round(rating.hoursTracked)}h`} ago`}>
                {arrow}{Math.abs(rating.delta)}
              </span>
            )}
          </div>
          <span className="mt-1 block font-mono text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: bandColor(pick.convictionBand) }}>
            evidence
          </span>
        </div>
        )}
      </div>

      {/* A pending signal is a PLAN, never P&L. Only an entered signal earns a
          moving trade path from entry to T1. */}
      <div className="mt-3 border-t border-border/45 pt-2.5">
        {/*
          A held position gets a POSITION panel, not entry geometry.
          The trade-path bar below measures progress from entryPrice toward T1
          using a live price — but for a bot-held option, entryPrice is the
          premium paid and the live price is the underlying. Those units do not
          compare, which is what produced "+10355.4% live" and a progress bar
          pinned at 100%. What matters for something you own is the contract,
          the size, and what it is worth now.
        */}
        {pick.isBotHeld ? (
          <>
            <div className="mb-1.5 flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <span>Position · held</span>
              <span style={{ color: 'var(--brand-gold)' }}>{pick.botOwner ?? 'bot'}</span>
            </div>
            <div className="flex items-baseline justify-between font-mono text-[10px]">
              <span className="text-foreground/85">
                {pick.strikePrice != null
                  ? `$${pick.strikePrice}${String(pick.optionType ?? '').charAt(0).toUpperCase()}`
                  : 'shares'}
                {pick.expiryDate ? ` · ${String(pick.expiryDate).slice(0, 10)}` : ''}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {pick.quantity ?? 1}x @ ${Number(pick.entryPremium ?? pick.entryPrice ?? 0).toFixed(2)}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between font-mono text-[9px] font-semibold uppercase tracking-[0.1em]">
              <span className="text-muted-foreground">
                {pick.currentPremium != null ? `bid $${Number(pick.currentPremium).toFixed(2)} · option P&L` : 'option P&L · mark unavailable'}
              </span>
              <span
                className="tabular-nums"
                style={{ color: (pick.unrealizedPnlPercent ?? 0) >= 0 ? 'var(--trade-bullish)' : 'var(--trade-bearish)' }}
              >
                {(pick.unrealizedPnlPercent ?? 0) >= 0 ? '+' : ''}
                {Number(pick.unrealizedPnlPercent ?? 0).toFixed(1)}%
              </span>
            </div>
          </>
        ) : awaitingTrigger ? (
          <>
            <div className="mb-2 flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <span>Entry gate · no position{(pick as any).levelBasis === 'contract' ? ' · PREM levels' : ''}</span>
              <span className="tabular-nums text-[var(--brand-gold)]">
                {triggerDistancePct.toFixed(1)}% {triggerSide} trigger
              </span>
            </div>
            <div className="grid grid-cols-2 gap-px border border-border/45 bg-border/45">
              <div className="bg-card px-2 py-1.5">
                <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">live</span>
                <span className="mt-0.5 block font-mono text-[10px] font-bold tabular-nums text-foreground">${px.toFixed(2)}</span>
              </div>
              <div className="bg-card px-2 py-1.5">
                <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">trigger</span>
                <span className="mt-0.5 block font-mono text-[10px] font-bold tabular-nums text-[var(--brand-cyan)]">${pick.entryPrice.toFixed(2)}</span>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between font-mono text-[9px] font-semibold uppercase tracking-[0.1em]">
              <span className="text-muted-foreground">T1 after entry</span>
              <span className="tabular-nums text-muted-foreground">R:R {(pick.riskRewardRatio ?? g.rr).toFixed(1)}</span>
              <span className="tabular-nums" style={{ color: g.horizonUsedPct >= 80 ? TC.bear : g.horizonUsedPct >= 50 ? TC.warn : TC.muted }}>
                {pick.optionDte != null || pick.expiryDate
                  ? `${g.daysHeld < 1 ? '<1' : Math.round(g.daysHeld)}/${g.horizonDays}d plan`
                  : 'timing pending'}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="mb-1.5 flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <span>Trade path · entered</span>
              <span style={{ color: pnlColor(g.pnlPct) }}>
                <LiveValue
                  value={g.pnlPct}
                  tween={false}
                  className="font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
                  format={(n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}% live`}
                />
              </span>
            </div>
            <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              <span>entry</span><span>T1</span>
            </div>
            <div className="relative h-[3px] bg-foreground/[0.09]">
              <motion.div
                className="absolute inset-y-0 left-0"
                animate={{ width: `${g.progressPct}%` }}
                transition={reduce ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                style={{ background: confidenceFill(conf) }}
              />
              <motion.span
                className="absolute top-1/2 block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background"
                animate={{ left: `${Math.max(1, Math.min(99, g.progressPct))}%` }}
                transition={reduce ? { duration: 0 } : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                style={{ background: confidenceFill(conf), boxShadow: `0 0 0 2px ${confidenceFill(conf)}33` }}
              />
              <span className="absolute right-0 top-1/2 h-2.5 w-px -translate-y-1/2 bg-foreground/65" />
            </div>
            <div className="mt-2 flex items-center justify-between font-mono text-[9px] font-semibold uppercase tracking-[0.1em]">
              <span className="tabular-nums text-muted-foreground">{g.progressPct.toFixed(0)}% to target</span>
              <span className="tabular-nums text-muted-foreground">R:R {(pick.riskRewardRatio ?? g.rr).toFixed(1)}</span>
              <span className="tabular-nums" style={{ color: g.horizonUsedPct >= 80 ? TC.bear : g.horizonUsedPct >= 50 ? TC.warn : TC.muted }}>
                {pick.optionDte != null || pick.expiryDate
                  ? `${g.daysHeld < 1 ? '<1' : Math.round(g.daysHeld)}/${g.horizonDays}d`
                  : 'timing pending'}
                {g.drawdownPct > 0.05 && <span className="ml-1">· {g.drawdownPct.toFixed(1)}% DD</span>}
              </span>
            </div>
          </>
        )}
      </div>
    </motion.button>
  );
}
