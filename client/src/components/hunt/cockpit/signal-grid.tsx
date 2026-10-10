/**
 * SIGNAL GRID — the whole book at once, filterable and sortable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A SECOND VIEW AT ALL
 * ═══════════════════════════════════════════════════════════════════════════
 * The cockpit is built around ONE selected signal — 244px rail, subject, right
 * rail — and it is very good at "tell me everything about HCA". It is bad at
 * "which of these 40 should I open", because the rail shows about six rows, so
 * comparing the book means scrolling a narrow column and holding the previous
 * rows in your head.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE FIRST VERSION GOT WRONG
 * ═══════════════════════════════════════════════════════════════════════════
 * It rendered 40 cards with no way to reduce them, which just moved the problem:
 * a wall of 40 is not more answerable than a column of 40, it is only wider. A
 * board view without filters is a screenshot.
 *
 * It also showed the signal's STATIC facts — entry, stop, T1, R:R — which are
 * fixed the moment the idea is published. The question you actually ask while
 * scanning is "is this one working", and that is a LIVE reading: how far it has
 * travelled toward T1, whether it triggered, how much of its time budget is
 * gone, and how deep it has been under water. All of that already exists in
 * `geometryFor`, which the rail uses and this view previously ignored.
 *
 * So every card now carries the same live geometry the rail computes, and the
 * filter bar reduces the set before you read any of it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COLOUR RULE
 * ═══════════════════════════════════════════════════════════════════════════
 * Direction sets card tone and nothing else may — a card tinted for "high
 * conviction" would spend the directional colours on a quality axis. The one
 * exception is deliberate: a layer arguing AGAINST the trade renders clay even
 * on a bullish card, because that disagreement is the most useful thing on the
 * card and must not be tinted away.
 */
import { useMemo, useState } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { useQuery } from '@tanstack/react-query';
import { openWorkup } from '@/lib/workup-bus';
import { RecordCard } from '@/components/templates/surfaces';
import { Distribution } from '@/components/templates/charts';
import { KeyValue, KeyValueRow, type Tone } from '@/components/templates/kit';
import type { ConvictionPick } from '@/lib/convictions';
import { geometryFor } from '@/components/oracle/signal-detail';
import { CONVICTION_LAYERS } from '@shared/conviction-layers';
import { Sparkline } from './sparkline';
import { tierColor } from '@/components/canon';
import { cn } from '@/lib/utils';

const dirTone = (d: string): Tone => (d === 'long' ? 'bull' : 'bear');
const shortFor = (kind: string) =>
  CONVICTION_LAYERS.find((l) => l.kind === kind)?.short ?? kind.slice(0, 3).toUpperCase();

export function SignalGrid({
  picks, selectedId, onSelect, live,
}: {
  /** ALREADY FILTERED. The reduction lives in signal-filters.tsx and is shared
   *  with the rail, so this component renders exactly what it is handed. It used
   *  to own six pieces of filter state, which meant the same question had two
   *  answers depending on which view you were in. */
  picks: ConvictionPick[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  live?: Map<string, number>;
}) {
  // Bot's live book + config — powers the per-card "Bot?" verdict, which runs
  // the same rules the bot itself runs (floor, trigger, invalidation, chase)
  // and answers in one line instead of leaving absence a mystery.
  const { data: bot } = useQuery<{ openPositions?: { symbol: string }[]; config?: { minConviction?: number; maxProgressPct?: number } }>({
    queryKey: ['/api/quant-bot/status', 'grid'],
    queryFn: async () => {
      const r = await fetch('/api/quant-bot/status', { credentials: 'include' });
      if (!r.ok) throw new Error('bot status failed');
      return r.json();
    },
    staleTime: 60_000, retry: 1,
  });
  const held = useMemo(() => new Set((bot?.openPositions ?? []).map((p) => p.symbol)), [bot]);
  const [verdicts, setVerdicts] = useState<Record<string, string>>({});
  const [watched, setWatched] = useState<Record<string, string>>({});

  const botVerdict = (p: ConvictionPick, px: number, pending: boolean): string => {
    const floor = bot?.config?.minConviction ?? 18;
    const maxProg = bot?.config?.maxProgressPct ?? 35;
    if (held.has(p.symbol)) return 'held by the bot ✓';
    if ((p.convictionScore ?? 0) < floor) return `below bot floor (${p.convictionScore} < ${floor})`;
    if (pending) return 'pending trigger — bot won\'t front-run its own entry';
    if (p.direction === 'long' ? px <= (p.stopLoss ?? 0) : px >= (p.stopLoss ?? Infinity)) return 'invalidated — stop already traded';
    const span = p.direction === 'long' ? (p.targetPrice ?? 0) - (p.entryPrice ?? 0) : (p.entryPrice ?? 0) - (p.targetPrice ?? 0);
    const done = p.direction === 'long' ? px - (p.entryPrice ?? 0) : (p.entryPrice ?? 0) - px;
    const prog = span > 0 ? (done / span) * 100 : 0;
    if (prog > maxProg) return `chase guard (${prog.toFixed(0)}% to T1 gone > ${maxProg}%)`;
    return 'qualifies — fills on the next 10-min cycle (mark + sizing permitting)';
  };

  const addWatch = async (sym: string) => {
    setWatched((w) => ({ ...w, [sym]: '…' }));
    try {
      const r = await apiRequest('POST', '/api/watchlist', { symbol: sym });
      setWatched((w) => ({ ...w, [sym]: r.ok ? '✓' : '✗' }));
    } catch { setWatched((w) => ({ ...w, [sym]: '✗' })); }
  };

  // Geometry once per pick — the card and its progress bar need the same numbers.
  const filtered = useMemo(
    () =>
      picks.map((p) => {
        const px = live?.get(p.symbol) ?? p.currentPrice ?? p.entryPrice;
        return { p, g: geometryFor(p, px) };
      }),
    [picks, live],
  );

  return (
    <div className="space-y-3">
      {filtered.length === 0 ? (
        <p className="py-10 text-center font-mono text-[11px] text-muted-foreground">
          Nothing matches these filters.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map(({ p, g }) => {
            const pending = /pending|trigger/i.test(g.statusLabel ?? '');
            const against = (p.layers ?? []).filter((l) => l.points < 0);

            const contributing = (p.layers ?? [])
              .filter((l) => l.points !== 0)
              .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
              .slice(0, 4);

            return (
              <RecordCard
                key={p.ideaId}
                ticker={p.symbol}
                badge={`${p.convictionBand} · ${p.convictionScore > 0 ? '+' : ''}${p.convictionScore} evidence`}
                /* The badge carries BAND and CONVICTION — a quality axis. Moss
                   and clay are reserved for direction, so a confident short was
                   rendering clay and reading as a warning. Cyan is the
                   structural colour; the side is carried by the ▲BULL/▼BEAR line
                   and by P&L in the footer. */
                badgeTone="structural"
                tone={dirTone(p.direction)}
                id={`${p.direction === 'long' ? '▲ BULL' : '▼ BEAR'} · ${p.holdingPeriod}`}
                title={p.thesis?.split('.')[0] ?? p.symbol}
                className={cn('qe-sig-card', selectedId === p.ideaId && 'ring-1 ring-[color:var(--brand-cyan)]')}
                /* Edge stripe carries the quality axis (band → --grade-* token),
                   leaving moss/clay free to keep meaning direction. */
                style={{ ['--band-color' as string]: tierColor(p.convictionBand) }}
                onClick={() => onSelect(p.ideaId)}
                footLeft={pending
                  ? `${g.progressPct.toFixed(0)}% to trigger`
                  : `${g.pnlPct >= 0 ? '+' : ''}${g.pnlPct.toFixed(1)}% P&L`}
                footRight={p.optionDte != null ? `${p.optionDte}d` : 'no contract'}
              >
                {/* STATE — the live reading, which the static levels cannot give. */}
                <div className="mb-3 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider">
                  <span
                    className="rounded-[2px] px-1.5 py-0.5"
                    style={{
                      color: pending ? 'var(--brand-gold)' : 'var(--brand-cyan)',
                      background: `color-mix(in srgb, ${pending ? 'var(--brand-gold)' : 'var(--brand-cyan)'} 12%, transparent)`,
                    }}
                  >
                    {g.statusLabel}
                  </span>
                  <span className="text-muted-foreground">
                    {p.optionDte != null || p.expiryDate
                      ? `${g.horizonUsedPct.toFixed(0)}% of ${g.horizonDays}d used`
                      : 'timing pending contract'}
                  </span>
                </div>

                {/* Real 5d closes, the same Sparkline the rail lists use — the
                    reference card's mini chart, minus its Math.random() series.
                    Renders a quiet dash when history is missing, never a fake
                    curve. */}
                {/* QUICK ACTIONS — interaction reveals measured data: the Bot?
                    verdict runs the bot's own rules for THIS symbol right now. */}
                <div className="mb-2 flex items-center gap-1.5 font-mono text-[9px]" onClick={(e) => e.stopPropagation()}>
                  {([['Workup', () => openWorkup(p.symbol)], [watched[p.symbol] ? `Watch ${watched[p.symbol]}` : 'Watch', () => addWatch(p.symbol)], ['Bot?', () => setVerdicts((vv) => ({ ...vv, [p.ideaId]: vv[p.ideaId] ? '' : botVerdict(p, live?.get(p.symbol) ?? p.currentPrice ?? p.entryPrice ?? 0, pending) }))]] as const).map(([label, fn]) => (
                    <button key={label as string} onClick={fn as () => void}
                      className="rounded-[3px] border border-border/60 px-1.5 py-0.5 uppercase tracking-wider text-muted-foreground transition-colors hover:border-[color:var(--brand-cyan)] hover:text-foreground">
                      {label}
                    </button>
                  ))}
                  {verdicts[p.ideaId] && <span className="ml-1 normal-case tracking-normal text-[9px] text-[color:var(--brand-gold)]">{verdicts[p.ideaId]}</span>}
                </div>
                <div className="mb-3 h-9 overflow-hidden rounded-[3px] bg-black/20">
                  <Sparkline symbol={p.symbol} tone={p.direction === 'long' ? 'bull' : 'bear'} width="100%" height={36} />
                </div>

                {/* progress entry → T1, with drawdown shown against it */}
                <div>
                  <div className="mb-1 flex items-baseline justify-between font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    <span>{g.progressPct.toFixed(0)}% to T1</span>
                    {g.drawdownPct > 0 && (
                      <span style={{ color: 'var(--trade-bearish)' }}>{g.drawdownPct.toFixed(1)}% DD</span>
                    )}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-[1px] bg-foreground/[0.06]">
                    <div
                      className="h-full rounded-[1px] transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
                      style={{
                        width: `${Math.max(0, Math.min(100, g.progressPct))}%`,
                        background: 'var(--brand-cyan)',
                      }}
                    />
                  </div>
                </div>

                {contributing.length > 0 && (
                  <div className="mt-3">
                    <Distribution
                      items={contributing.map((l, index) => ({
                        id: `${l.kind}-${index}`,
                        label: shortFor(l.kind),
                        value: Math.abs(l.points),
                        tone: (l.points < 0 ? 'bear' : dirTone(p.direction)) as Tone,
                        note: `${l.points > 0 ? '+' : ''}${l.points}`,
                      }))}
                    />
                    <p className={cn(
                      'mt-1.5 font-mono text-[9px]',
                      against.length ? 'text-[color:var(--trade-bearish)]' : 'text-muted-foreground',
                    )}>
                      {against.length
                        ? `${against.length} layer${against.length > 1 ? 's' : ''} arguing against`
                        : 'nothing arguing against'}
                    </p>
                  </div>
                )}

                <KeyValueRow className="mt-4">
                  <KeyValue k="Entry" v={`$${p.entryPrice?.toFixed(2) ?? '—'}`} />
                  <KeyValue k="Stop" v={`$${p.stopLoss?.toFixed(2) ?? '—'}`} tone="bear" />
                  <KeyValue k="T1" v={`$${p.targetPrice?.toFixed(2) ?? '—'}`} tone="bull" />
                  <KeyValue
                    k="R:R"
                    v={p.riskRewardRatio ? `${p.riskRewardRatio.toFixed(1)}:1` : '—'}
                    /* Above 5R the target is essentially never reached — the
                       2.5R+ cohort measured +0.023R across 245 trades. Flagged
                       amber rather than celebrated as a big number. */
                    tone={p.riskRewardRatio && p.riskRewardRatio > 5 ? 'time' : undefined}
                  />
                </KeyValueRow>
              </RecordCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
