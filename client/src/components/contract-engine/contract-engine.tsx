/**
 * ContractEngine — 3-tier contract selector
 * ===============================================
 * On-demand surface over the canonical option-selection engine
 * (POST /api/options/select). Given a signal's price-action thesis, fetches up
 * to three risk-tiered contract picks — conservative / balanced / aggressive —
 * and lets the user choose. Premiums are live (never fabricated); empty/illiquid
 * results render an honest note instead of a fake strike.
 */
import { ContractPickerPanel } from "@/components/workup/contract-picker-panel";
import { parseMarketDate } from '@/lib/market-date';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useQuery } from '@tanstack/react-query';
import { ContractValuePanel } from './contract-value-panel';

type Tier = 'starter' | 'conservative' | 'balanced' | 'aggressive';

interface EnginePick {
  tier: Tier;
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  dte: number;
  // greeks + liquidity (engine returns the full chain row)
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  bid: number;
  ask: number;
  mid: number;
  spreadPct: number;
  openInterest: number;
  volume: number;
  entryPremium: number;
  projectedAtT1: number;
  projectedAtT2?: number;
  roiAtT1Pct: number;
  roiAtT2Pct?: number;
  riskRewardRatio: number;
  breakeven: number;
  scaleReachable: boolean;
  score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  rationale: string;
  flags: string[];
  riskPerContract?: number;
  maxContracts?: number | null;
  fitsAccount?: boolean;
}

interface EngineSelection {
  /** When the chain behind this selection was fetched (ISO). */
  asOf?: string;
  symbol: string;
  optionType: 'call' | 'put';
  spot: number;
  recommendedTier: Tier | null;
  dteWindow: { min: number; max: number };
  picks: EnginePick[];
  status: 'ok' | 'unavailable' | 'no_candidates';
  note?: string;
}

interface ContractRiskProfile {
  accountSize: number;
  riskBudgetDollars: number;
  maxDebitDollars: number;
}

interface Props {
  symbol: string;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  entry: number;
  stop: number;
  t1: number;
  t2?: number;
  holdPeriodLabel?: string;
  conviction?: number;
  /** Fetch contracts on mount instead of waiting for a button click. */
  autoLoad?: boolean;
  onSelect?: (pick: EnginePick) => void;
  /**
   * Fires whenever the ACTIVE pick changes — on resolve (with the engine's own
   * recommended tier) and on every user tier change after that.
   *
   * `onSelect` only fires on a click, so a caller wanting to show the trade
   * before the user touches anything had no way to learn what it is. That is
   * what left the cockpit's hero asserting the signal's stored strike while the
   * engine recommended a different one 1,190px below.
   */
  onResolve?: (pick: EnginePick | null) => void;
}

function labelToSetup(label?: string): 'scalp' | 'swing' | 'lotto' | 'position' {
  const l = (label ?? '').toUpperCase();
  if (l.includes('OVERNIGHT')) return 'scalp';
  if (l.includes('WEEK') || l.includes('MONTH') || l.includes('YEAR')) return 'position';
  const dayMatch = l.match(/(\d+)\s*DAY/);
  if (dayMatch) {
    const d = parseInt(dayMatch[1], 10);
    if (d <= 1) return 'scalp';
    if (d <= 5) return 'swing';
    return 'position';
  }
  return 'swing';
}

// Tier accent colors — drawn from the same QE design tokens the cockpit uses
// (bullish green / brand cyan / amber) so the contract engine matches every
// other panel instead of introducing a second palette.
const AMBER = '#f59e0b';
const TIER_STYLE: Record<Tier, { color: string; label: string }> = {
  // Muted violet — deliberately outside the bullish/cyan/amber trio, because
  // STARTER is an affordability answer, not a conviction level. It should not
  // read as "more aggressive than aggressive".
  starter: { color: '#a78bfa', label: 'STARTER' },
  conservative: { color: 'var(--trade-bullish)', label: 'CONSERVATIVE' },
  balanced: { color: 'var(--brand-cyan)', label: 'BALANCED' },
  aggressive: { color: AMBER, label: 'AGGRESSIVE' },
};

function gradeColor(grade: string): string {
  if (grade === 'S' || grade === 'A') return 'var(--trade-bullish)';
  if (grade === 'B') return 'var(--brand-cyan)';
  if (grade === 'C') return AMBER;
  return 'var(--trade-bearish)';
}

function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono font-bold tabular-nums" style={{ color: accent ?? 'var(--foreground)' }}>{value}</div>
    </div>
  );
}

function fmtExpiry(expiry: string): string {
  try {
    const d = parseMarketDate(expiry) ?? new Date(expiry);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {}
  return expiry;
}

/**
 * Daily closes for the underlying, used for the realized-vol comparison inside
 * ContractValuePanel. Fetched once per symbol and shared across all three tiers —
 * the alternative is three identical requests for the same history. Failure is
 * non-fatal: without it the panel drops the IV-vs-realized line and still shows
 * the priced-in-move comparison, which is the primary read.
 */
function useUnderlyingCloses(symbol: string) {
  const { data } = useQuery<number[]>({
    queryKey: ['/api/historical-prices', symbol, 'contract-value'],
    queryFn: async () => {
      const r = await fetch(`/api/historical-prices/${symbol}?range=3mo&interval=1d`, { credentials: 'include' });
      if (!r.ok) return [];
      const j = await r.json();
      const rows = Array.isArray(j) ? j : (j?.data ?? []);
      return rows
        .map((c: any) => Number(c?.close ?? c?.c ?? c))
        .filter((n: number) => Number.isFinite(n) && n > 0);
    },
    staleTime: 15 * 60_000,
    retry: 0,
    enabled: !!symbol,
  });
  return data ?? [];
}

export function ContractEngine({
  symbol, direction, entry, stop, t1, t2, holdPeriodLabel, conviction, autoLoad, onSelect, onResolve,
}: Props) {
  const [selection, setSelection] = useState<EngineSelection | null>(null);
  const [chosen, setChosen] = useState<Tier | null>(null);
  const [riskProfile, setRiskProfile] = useState<ContractRiskProfile>(() => {
    const fallback = { accountSize: 10_000, riskBudgetDollars: 250, maxDebitDollars: 300 };
    try {
      const saved = JSON.parse(localStorage.getItem('qe-contract-risk-profile') ?? 'null');
      return saved && typeof saved === 'object' ? { ...fallback, ...saved } : fallback;
    } catch { return fallback; }
  });
  /**
   * Which tiers are expanded.
   *
   * Four tiers of full detail is roughly 120 lines of numbers before you reach
   * anything else on the page, and three of them are alternatives you are not
   * taking. Collapsed rows keep the comparison that matters — strike, expiry,
   * premium, grade — and hide the greeks, liquidity and value blocks until
   * asked for.
   *
   * `null` means "not chosen yet": the recommended tier is open and the rest
   * are shut. Once the operator expands or collapses anything, their choice is
   * respected and the default stops applying.
   */
  const [expanded, setExpanded] = useState<Record<string, boolean> | null>(null);
  const isExpanded = (tier: Tier, recommended: boolean) =>
    expanded ? !!expanded[tier] : recommended;
  const toggleExpanded = (tier: Tier, recommended: boolean) =>
    setExpanded((prev) => {
      const base = prev ?? { [tier]: recommended };
      return { ...base, [tier]: !(prev ? !!prev[tier] : recommended) };
    });
  const closes = useUnderlyingCloses(symbol);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/options/select', {
        symbol,
        direction: direction === 'BEAR' ? 'bearish' : 'bullish',
        setup: labelToSetup(holdPeriodLabel),
        entry,
        stop,
        t1,
        t2,
        conviction,
        ...riskProfile,
        minRoiAtT1Pct: 30,
      });
      return (await res.json()) as EngineSelection;
    },
    onSuccess: (data) => {
      setSelection(data);
      setChosen(data.recommendedTier);
    },
  });

  // Report the ACTIVE pick upward. Runs on resolve (chosen defaults to the
  // engine's recommendedTier) and again whenever the user switches tier, so a
  // parent can show the live trade without duplicating the fetch.
  const activePick = selection?.picks.find((p) => p.tier === chosen) ?? null;
  useEffect(() => {
    onResolve?.(activePick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePick?.strike, activePick?.expiry, activePick?.tier]);

  const { mutate } = mutation;
  useEffect(() => {
    localStorage.setItem('qe-contract-risk-profile', JSON.stringify(riskProfile));
  }, [riskProfile]);
  // Auto-fetch contracts on mount / when the thesis changes (per-ticker reload).
  useEffect(() => {
    if (autoLoad && direction !== 'NEUTRAL') mutate();
    // Re-select every 3 minutes: a one-shot fetch left an open cockpit showing
    // hour-old premium, delta and ROI@T1 (audit 2026-09-24).
    if (!autoLoad || direction === 'NEUTRAL') return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') mutate(); }, 180_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, symbol, direction, entry, stop, t1, t2]);

  // No options thesis for neutral signals.
  if (direction === 'NEUTRAL') return null;

  if (!selection && !mutation.isPending && !autoLoad) {
    return (
      <button
        onClick={() => mutation.mutate()}
        className="w-full text-xs font-mono px-3 py-2.5 rounded-lg bg-card border border-[var(--brand-cyan)]/25 text-[var(--brand-cyan)] hover:bg-[var(--brand-cyan)]/10 hover:border-[var(--brand-cyan)]/40 transition-colors font-bold tracking-wide cursor-pointer"
        data-testid="button-find-contracts"
      >
        FIND BEST CONTRACTS · 3 TIERS
      </button>
    );
  }

  if ((!selection && !mutation.isPending) || mutation.isPending) {
    // autoLoad pending OR live scan in flight — same calm skeleton chrome.
    return (
      <div className="text-xs font-mono text-muted-foreground px-4 py-3 rounded-lg bg-card border border-card-border animate-pulse">
        {mutation.isPending
          ? `Scanning live chain for ${symbol} ${direction === 'BEAR' ? 'puts' : 'calls'}…`
          : `Loading contracts for ${symbol}…`}
      </div>
    );
  }

  if (mutation.isError) {
    return (
      <div className="text-xs font-mono text-[var(--trade-bearish)] px-4 py-3 rounded-lg bg-card border border-[var(--trade-bearish)]/25">
        Contract selection failed. <button onClick={() => mutation.mutate()} className="underline cursor-pointer">Retry</button>
      </div>
    );
  }

  if (!selection) return null;

  if (selection.status !== 'ok' || selection.picks.length === 0) {
    return (
      <div className="text-xs font-mono text-muted-foreground px-4 py-3 rounded-lg bg-card border border-card-border" data-testid="picker-empty">
        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Contract Engine · </span>
        {selection.note ?? 'No liquid contract available for this thesis.'}
        <ContractPickerPanel symbol={symbol} direction={direction === 'BEAR' ? 'short' : 'long'} target={t1} title="FIT MY BUDGET" />
      </div>
    );
  }

  return (
    <>
    <section className="rounded-lg border border-card-border bg-card overflow-hidden" data-testid="oracle-option-picker">
      <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/30">
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Contract Engine · Pick Tier
        </span>
        <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
          Spot ${selection.spot.toFixed(2)} · {selection.dteWindow.min}-{selection.dteWindow.max}DTE
          {selection.asOf ? ` · ${Math.max(0, Math.round((Date.now() - Date.parse(selection.asOf)) / 60000))}m old` : ''}
        </span>
      </header>

      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] gap-2 px-4 py-2.5 border-b border-border/30 bg-foreground/[0.015]">
        {([
          ['ACCOUNT', 'accountSize'],
          ['MAX LOSS', 'riskBudgetDollars'],
          ['MAX DEBIT', 'maxDebitDollars'],
        ] as const).map(([label, key]) => (
          <label key={key} className="min-w-0">
            <span className="block text-[8px] font-mono tracking-wider text-muted-foreground mb-1">{label}</span>
            <span className="flex items-center rounded border border-card-border bg-background/40 px-2">
              <span className="text-[10px] font-mono text-muted-foreground">$</span>
              <input
                type="number"
                min="1"
                step={key === 'accountSize' ? 1000 : 25}
                value={riskProfile[key]}
                onChange={(event) => setRiskProfile((current) => ({ ...current, [key]: Math.max(1, Number(event.target.value) || 1) }))}
                className="w-full bg-transparent px-1 py-1.5 text-[11px] font-mono tabular-nums text-foreground outline-none"
                aria-label={label.toLowerCase()}
              />
            </span>
          </label>
        ))}
        <button
          type="button"
          onClick={() => mutation.mutate()}
          className="self-end rounded border border-[var(--brand-cyan)]/30 px-2.5 py-1.5 text-[9px] font-mono font-bold tracking-wider text-[var(--brand-cyan)] hover:bg-[var(--brand-cyan)]/10"
        >
          REFIT
        </button>
      </div>

      <div className="p-4 grid grid-cols-1 gap-2">
        {selection.picks.map((p) => {
          const st = TIER_STYLE[p.tier];
          const isChosen = chosen === p.tier;
          const isRecommended = selection.recommendedTier === p.tier;
          const gc = gradeColor(p.grade);
          return (
            <button
              key={p.tier}
              onClick={() => { setChosen(p.tier); onSelect?.(p); }}
              data-testid={`tier-${p.tier}`}
              className="text-left rounded-md border p-2.5 transition-colors cursor-pointer bg-foreground/[0.02] hover:bg-foreground/[0.05]"
              style={{
                borderColor: isChosen ? st.color : 'var(--card-border)',
                boxShadow: isChosen ? `inset 3px 0 14px -8px ${st.color}` : undefined,
              }}
            >
              <div
                className="flex items-center justify-between mb-1.5"
                onClick={(e) => { e.stopPropagation(); toggleExpanded(p.tier, isRecommended); }}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded(p.tier, isRecommended)}
                aria-label={`${st.label} tier details`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault(); e.stopPropagation();
                    toggleExpanded(p.tier, isRecommended);
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="font-mono text-[9px] text-muted-foreground transition-transform"
                    style={{ transform: isExpanded(p.tier, isRecommended) ? 'rotate(90deg)' : 'none' }}
                  >
                    ▶
                  </span>
                  <span className="text-[10px] font-mono font-bold tracking-widest" style={{ color: st.color }}>{st.label}</span>
                  {isRecommended && (
                    <span
                      className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                      style={{ color: 'var(--brand-cyan)', background: 'color-mix(in srgb, var(--brand-cyan) 14%, transparent)' }}
                    >
                      Rec
                    </span>
                  )}
                </div>
                <span
                  className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded tabular-nums"
                  style={{ color: gc, background: `color-mix(in srgb, ${gc} 14%, transparent)` }}
                >
                  {p.grade} · {p.score}
                </span>
              </div>

              <div className="flex items-baseline justify-between">
                <span className="text-base font-mono font-bold text-foreground tabular-nums">
                  ${p.strike}{p.optionType === 'call' ? 'C' : 'P'}
                  <span className="text-[11px] font-normal text-muted-foreground ml-1.5">
                    {fmtExpiry(p.expiry)} · {p.dte}DTE
                  </span>
                </span>
                <span className="text-base font-mono font-bold tabular-nums" style={{ color: AMBER }}>${p.entryPremium.toFixed(2)}</span>
              </div>

              {/*
                Everything below is DETAIL — greeks, liquidity, contract value,
                rationale. Collapsed by default on every tier except the
                recommended one, so four tiers no longer push ~120 lines of
                numbers between the operator and the rest of the page. The
                identity row above (strike, expiry, premium, grade) always stays
                visible, because that is what the tiers are compared on.
              */}
              {isExpanded(p.tier, isRecommended) && (
                <>
              {/* Liquidity row — premium / OI / volume / IV.
                  Vol and OI side by side don't say much on their own; the RATIO does.
                  Volume above open interest means today's activity is NEW positioning
                  rather than trades against an existing book — which is the definition of
                  unusual flow, and it tells you whether this contract is where the money
                  actually went or just the strike our sizer happened to like. */}
              <div className="grid grid-cols-4 gap-1 mt-2 text-[11px]">
                <Stat label="Bid×Ask" value={`${p.bid.toFixed(2)}×${p.ask.toFixed(2)}`} />
                <Stat label="OI" value={fmtCompact(p.openInterest)} />
                <Stat label="Vol" value={fmtCompact(p.volume)} />
                <Stat label="IV" value={`${(p.iv * 100).toFixed(0)}%`} />
              </div>

              {(() => {
                const volOi = p.openInterest > 0 ? p.volume / p.openInterest : 0;
                const unusual = volOi >= 1;      // more traded today than is already open
                const heavy = volOi >= 2.5;
                const thin = p.openInterest < 100 || p.volume < 25;
                const color = heavy ? '#e0a458' : unusual ? 'var(--trade-bullish)' : 'var(--muted-foreground)';
                return (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Vol/OI</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                      <div className="h-full rounded-full transition-[width] duration-500"
                           style={{ width: `${Math.min(100, (volOi / 3) * 100)}%`, background: color }} />
                    </div>
                    <span className="text-[10px] font-mono tabular-nums" style={{ color }}>
                      {volOi.toFixed(1)}×
                    </span>
                    {heavy ? (
                      <span className="rounded border px-1 py-px text-[10px] font-mono font-bold tracking-wider"
                            style={{ color: '#e0a458', borderColor: '#e0a45855', background: '#e0a4581a' }}>
                        UNUSUAL
                      </span>
                    ) : thin ? (
                      <span className="rounded border px-1 py-px text-[10px] font-mono font-bold tracking-wider"
                            style={{ color: 'var(--trade-bearish)', borderColor: 'color-mix(in srgb, var(--trade-bearish) 35%, transparent)' }}
                            title="Low open interest or volume — expect a wide spread and poor fills">
                        THIN
                      </span>
                    ) : null}
                  </div>
                );
              })()}

              {/* Greeks row */}
              <div className="grid grid-cols-4 gap-1 mt-1.5 text-[11px]">
                <Stat label="Δ" value={p.delta.toFixed(2)} accent="var(--brand-cyan)" />
                <Stat label="Γ" value={p.gamma.toFixed(3)} />
                <Stat label="Θ" value={p.theta.toFixed(2)} />
                <Stat label="V" value={p.vega.toFixed(2)} />
              </div>

              {/* Trade math row — ROI / R:R / BE */}
              <div className="grid grid-cols-3 gap-1 mt-1.5 text-[11px]">
                <Stat
                  label="ROI @T1"
                  value={`${p.roiAtT1Pct >= 0 ? '+' : ''}${p.roiAtT1Pct.toFixed(0)}%`}
                  accent={p.roiAtT1Pct >= 0 ? 'var(--trade-bullish)' : 'var(--trade-bearish)'}
                />
                <Stat label="R:R" value={`${p.riskRewardRatio.toFixed(1)}:1`} />
                <Stat label="BE" value={`$${p.breakeven.toFixed(2)}`} />
              </div>

              {p.riskPerContract != null && (
                <div className="mt-1.5 text-[10px] font-mono text-muted-foreground">
                  Managed risk ${p.riskPerContract.toFixed(0)}/contract · {p.maxContracts == null ? 'research only' : `${p.maxContracts} fit current limits`}
                </div>
              )}

              {isChosen && (
                <>
                  {/* Only on the selected tier — this is the cost read for the contract
                      you're actually weighing, and showing it three times would bury it. */}
                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    <ContractValuePanel
                      spot={selection.spot}
                      strike={p.strike}
                      optionType={p.optionType}
                      iv={p.iv}
                      dte={p.dte}
                      bid={p.bid}
                      ask={p.ask}
                      mid={p.mid}
                      theta={p.theta}
                      targetPrice={t1}
                      closes={closes}
                    />
                  </div>
                  <p className="text-[10px] font-mono text-muted-foreground mt-2 leading-snug border-t border-border/30 pt-2">
                    {p.rationale}
                  </p>
                </>
              )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </section>
    <div className="rounded-lg border border-card-border bg-card px-4 pb-3 mt-2"><ContractPickerPanel symbol={symbol} direction={direction === 'BEAR' ? 'short' : 'long'} target={t1} title="FIT MY BUDGET" /></div>
    </>
  );
}
