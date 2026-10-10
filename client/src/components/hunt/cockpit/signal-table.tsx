/**
 * SIGNAL SCANNER — dense comparison before deep analysis.
 *
 * A card grid is useful for visual triage; it is poor at comparing exact entry,
 * stop, target, contract and timing values across forty names. This table is the
 * missing middle lens between the Grid and the single-name Cockpit. It uses the
 * same filtered picks and live geometry as both, so switching views never
 * changes the answer.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { geometryFor } from '@/components/oracle/signal-detail';
import { convictionPercent, type ConvictionPick } from '@/lib/convictions';
import { cn } from '@/lib/utils';

const money = (value?: number | null) =>
  Number.isFinite(value) ? `$${Number(value).toFixed(2)}` : '—';

const signed = (value: number, digits = 1) =>
  `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;

function contractFor(pick: ConvictionPick) {
  if (pick.strikePrice == null || !pick.optionType) return '—';
  const side = pick.optionType.toLowerCase().startsWith('c') ? 'C' : 'P';
  return `$${Number(pick.strikePrice).toFixed(Number(pick.strikePrice) % 1 ? 1 : 0)}${side}`;
}

export function SignalTable({
  picks,
  selectedId,
  onSelect,
  live,
}: {
  picks: ConvictionPick[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  live?: Map<string, number>;
}) {
  const reduce = useReducedMotion();

  if (picks.length === 0) {
    return (
      <p className="py-12 text-center font-mono text-[11px] text-muted-foreground">
        Nothing matches these filters.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card shadow-[0_18px_60px_rgba(0,0,0,0.16)]">
      <div className="h-px bg-gradient-to-r from-[var(--trade-bearish)] via-[var(--brand-gold)] to-[var(--brand-cyan)] opacity-70" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] border-collapse text-left font-mono tabular-nums">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-xl">
            <tr className="border-b border-border/70 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              <th className="w-10 px-3 py-2 text-right">#</th>
              <th className="px-3 py-2">Ticker ↕</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Evidence ↓</th>
              <th className="px-3 py-2">Triggered</th>
              <th className="px-3 py-2 text-right">Live ↕</th>
              <th className="px-3 py-2 text-right">Entry</th>
              <th className="px-3 py-2 text-right">Stop</th>
              <th className="px-3 py-2 text-right">T1</th>
              <th className="px-3 py-2 text-right">To trigger / path</th>
              <th className="px-3 py-2 text-right">R:R</th>
              <th className="px-3 py-2">Contract</th>
              <th className="px-3 py-2 text-right">Horizon</th>
            </tr>
          </thead>
          <motion.tbody layout>
            {picks.map((pick, index) => {
              const px = live?.get(pick.symbol) ?? pick.currentPrice ?? pick.entryPrice;
              const g = geometryFor(pick, px);
              const pending = /pending|trigger/i.test(g.statusLabel ?? '');
              const bullish = pick.direction === 'long';
              const score = pick.convictionScore;
              const evidencePct = convictionPercent(score);

              return (
                <motion.tr
                  layout="position"
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 330, damping: 32 }}
                  key={pick.ideaId}
                  onClick={() => onSelect(pick.ideaId)}
                  className={cn(
                    'group cursor-pointer border-b border-border/30 text-[11px] text-foreground/85 transition-colors last:border-b-0 odd:bg-foreground/[0.008] hover:bg-foreground/[0.045]',
                    selectedId === pick.ideaId && 'bg-[var(--brand-cyan)]/[0.07]',
                  )}
                >
                  <td className="px-3 py-2 text-right text-muted-foreground">{index + 1}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-bold tracking-[0.04em] text-foreground">{pick.symbol}</span>
                      <span className="max-w-24 truncate text-[9px] uppercase tracking-wider text-muted-foreground">
                        {pick.sector || pick.tradeType || 'equity'}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span style={{ color: bullish ? 'var(--trade-bullish)' : 'var(--trade-bearish)' }}>
                      {bullish ? '▲ LONG' : '▼ SHORT'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-foreground/[0.08]">
                        <div className="h-full rounded-full bg-gradient-to-r from-[var(--trade-bullish)] to-[var(--brand-cyan)]" style={{ width: `${Math.max(5, evidencePct)}%` }} />
                      </div>
                      <span className="text-[12px] font-bold text-foreground">{evidencePct}</span>
                      <span className="text-[9px] text-muted-foreground">{pick.convictionBand} · {pick.layerCount}L</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-semibold" style={{ color: pending ? 'var(--brand-gold)' : 'var(--trade-bullish)', borderColor: `color-mix(in srgb, ${pending ? 'var(--brand-gold)' : 'var(--trade-bullish)'} 30%, transparent)`, background: `color-mix(in srgb, ${pending ? 'var(--brand-gold)' : 'var(--trade-bullish)'} 8%, transparent)` }}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />{pending ? 'PENDING' : 'TRIGGERED'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-foreground">{money(px)}</td>
                  <td className="px-3 py-2 text-right" title={(pick as any).levelBasis === 'contract' ? "Levels are the option contract's PREMIUM, not share prices" : undefined}>
                    {(pick as any).levelBasis === 'contract' && <span className="mr-1 text-[9px] font-bold tracking-wider" style={{ color: 'var(--brand-gold)' }}>PREM</span>}
                    {money(pick.entryPrice)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--trade-bearish)]">{money(pick.stopLoss)}</td>
                  <td className="px-3 py-2 text-right text-[var(--trade-bullish)]">{money(pick.targetPrice)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1 w-12 overflow-hidden rounded-full bg-foreground/[0.07]">
                        <div
                          className="h-full rounded-full bg-[var(--brand-cyan)] transition-[width] duration-500"
                          style={{ width: `${Math.max(0, Math.min(100, g.progressPct))}%` }}
                        />
                      </div>
                      <span className={g.pnlPct < 0 ? 'text-[var(--trade-bearish)]' : 'text-[var(--trade-bullish)]'}>
                        {pending ? `${g.progressPct.toFixed(0)}% trg` : signed(g.pnlPct)}
                      </span>
                    </div>
                  </td>
                  <td className={cn('px-3 py-2 text-right', (pick.riskRewardRatio ?? 0) > 5 && 'text-[var(--brand-gold)]')}>
                    {pick.riskRewardRatio ? `${pick.riskRewardRatio.toFixed(1)}:1` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-foreground">{contractFor(pick)}</span>
                      <span className="text-[9px] text-muted-foreground">
                        {pick.entryPremium != null ? money(pick.entryPremium) : ''}{pick.optionDte != null ? ` · ${pick.optionDte}d` : ''}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span style={{ color: g.horizonUsedPct > 70 ? 'var(--brand-gold)' : undefined }} title={g.horizonBasis}>
                      {pick.optionDte != null || pick.expiryDate
                        ? `${g.horizonUsedPct.toFixed(0)}% / ${g.horizonDays}d`
                        : 'pending contract'}
                    </span>
                  </td>
                </motion.tr>
              );
            })}
          </motion.tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border/50 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        <span>{picks.length} signals · click a row to open the cockpit</span>
        <span>live path · fixed published levels</span>
      </div>
    </div>
  );
}
