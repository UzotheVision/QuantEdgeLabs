/**
 * CONTRACT ANALYZER — Bullflow-style terminal UI
 *
 * Drop this anywhere. Accepts either:
 *   - free-text input ("MU 415C 5/29 @ $5")
 *   - structured contract spec
 *
 * Renders:
 *   - terminal-style streaming status lines
 *   - per-signal graded cards (A+ to F pills)
 *   - "tempered by X" synthesis paragraph
 *   - trade plan + ROI scenarios
 *   - "Push to Trade Desk" button
 *
 * Visual aesthetic matches the Bullflow Agent screenshot:
 *   - monospace dark theme
 *   - "> " prefixed status lines in cyan
 *   - per-signal label + grade pill on right
 *   - final composite card with "tempered by X"
 */
import { useState } from 'react';
import { Loader2, Send, RefreshCw, X } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

interface SignalScore {
  label: string;
  grade: string;
  score: number;
  source: string;
  detail?: string;
}

interface ContractAnalysis {
  spec: {
    symbol: string;
    strike: number;
    expiry: string;
    optionType: 'call' | 'put';
    contracts?: number;
    fillPrice?: number;
  };
  spotAtAnalysis: number;
  contractMid?: number;
  contractBid?: number;
  contractAsk?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  signals: SignalScore[];
  finalGrade: string;
  finalScore: number;
  synthesis: string;
  statusLines: string[];
  plan: {
    t1: number;
    t2: number;
    invalidation: number;
    horizonDays: number;
  };
  roiScenarios: { stockPrice: number; contractValue: number; roi: number; pct: number }[];
  suggestions?: SuggestedContract[];
  suggestionNote?: string;
}

interface SuggestedContract {
  tier: 'conservative' | 'balanced' | 'aggressive';
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  dte: number;
  delta: number;
  entryPremium: number;
  roiAtT1Pct: number;
  roiAtT2Pct?: number;
  riskRewardRatio: number;
  breakeven: number;
  scaleReachable: boolean;
  score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  rationale: string;
  flags: string[];
}

interface ContractAnalyzerProps {
  /** Optional preset input (skip the input field, jump straight to analyzing) */
  initialInput?: string;
  /** Optional callback when "Push to Trade Desk" succeeds */
  onPushed?: (analysis: ContractAnalysis) => void;
  /** Optional close handler — renders an X button */
  onClose?: () => void;
  /** Compact mode — smaller fonts, less padding */
  compact?: boolean;
}

export function ContractAnalyzer({ initialInput = '', onPushed, onClose, compact }: ContractAnalyzerProps) {
  const [input, setInput] = useState(initialInput);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<ContractAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<string | null>(null);

  const analyze = async (rawInput?: string) => {
    const i = rawInput ?? input;
    if (!i.trim()) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      // apiRequest auto-attaches the x-csrf-token header from cookies
      const res = await apiRequest('POST', '/api/contract/analyze', { input: i });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? 'Analysis failed');
      } else {
        setAnalysis(data.analysis);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  };

  // Auto-run if initialInput was provided
  useState(() => {
    if (initialInput) analyze(initialInput);
  });

  const pushToTradeDesk = async () => {
    if (!analysis) return;
    setPushing(true);
    setPushResult(null);
    try {
      const res = await apiRequest('POST', '/api/trade-desk/ideas/from-contract-analysis', { analysis });
      const data = await res.json();
      if (data.ok) {
        setPushResult('✓ Idea created in Trade Desk');
        onPushed?.(analysis);
      } else {
        setPushResult(data.reason ?? 'Push failed (may have been deduped)');
      }
    } catch (e: any) {
      setPushResult(`✗ ${e?.message ?? 'Network error'}`);
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className={`qe-card border border-border/40 rounded-md bg-background ${compact ? 'p-2' : 'p-3'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-border/30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Contract Analyzer
          </span>
          {analysis && (
            <span className="text-[11px] font-mono text-foreground">
              · <span className="font-bold">{analysis.spec.symbol}</span> trade analysis
            </span>
          )}
        </div>
        {onClose && (
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Input field (only show if not preset) */}
      {!initialInput && (
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            placeholder='Paste a trade: "QCOM 300C 1/27 @ $18.50 x 1"'
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyze()}
            className="flex-1 bg-muted/20 border border-border/40 rounded px-3 py-1.5 text-[11px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--brand-cyan)]/60"
          />
          <button
            onClick={() => analyze()}
            disabled={loading}
            className="text-[10px] font-mono px-3 py-1.5 rounded border border-[var(--brand-cyan)]/40 text-[var(--brand-cyan)] hover:bg-[var(--brand-cyan)]/10 disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Analyze
          </button>
        </div>
      )}

      {error && (
        <div className="text-[11px] font-mono text-rose-500 px-3 py-2 rounded bg-rose-500/10 border border-rose-500/30">
          ✗ {error}
        </div>
      )}

      {loading && !error && (
        <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--brand-cyan)] py-3">
          <Loader2 className="h-3 w-3 animate-spin" />
          Connected. Fetching chain + signals…
        </div>
      )}

      {analysis && (
        <div className="space-y-3">
          {/* Terminal-style status lines */}
          <div className="space-y-1 font-mono text-[10px]">
            {analysis.statusLines.map((line, i) => (
              <div key={i} className="text-[var(--brand-cyan)]/80">
                {'> '}<span className="text-muted-foreground">{line}</span>
              </div>
            ))}
          </div>

          {/* Header bar — spot, contract, Greeks summary */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px] font-mono px-2 py-2 rounded bg-muted/20 border border-border/20">
            <div>
              <div className="text-muted-foreground uppercase text-[9px]">Spot</div>
              <div className="text-foreground font-bold">${analysis.spotAtAnalysis.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase text-[9px]">Contract Mid</div>
              <div className="text-foreground font-bold">${analysis.contractMid?.toFixed(2) ?? '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase text-[9px]">Delta</div>
              <div className="text-foreground">{analysis.delta?.toFixed(2) ?? '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase text-[9px]">Theta/day</div>
              <div className="text-foreground">-${Math.abs(analysis.theta ?? 0).toFixed(3)}</div>
            </div>
            <div>
              <div className="text-muted-foreground uppercase text-[9px]">IV</div>
              <div className="text-foreground">{((analysis.iv ?? 0) * 100).toFixed(0)}%</div>
            </div>
          </div>

          {/* Per-signal rows */}
          <div className="space-y-1">
            {analysis.signals.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-2 py-1.5 rounded border-l-2 border-[var(--brand-cyan)]/40 bg-muted/10"
              >
                <div className="flex-1 text-[11px] font-mono text-[var(--brand-cyan)]">
                  {s.label}
                </div>
                <GradePill grade={s.grade} />
              </div>
            ))}
          </div>

          {/* Combining... line */}
          <div className="text-[10px] font-mono text-[var(--brand-cyan)]/80 pt-1">
            {'> '}<span className="text-muted-foreground">Combining individual tool analyses into final conviction</span>
          </div>

          {/* Final composite */}
          <div className="flex items-center gap-3 px-2 py-2 rounded border-l-2 border-emerald-500/60 bg-emerald-500/5">
            <div className="flex-1 text-[12px] font-mono text-foreground font-medium leading-relaxed">
              {analysis.synthesis}
            </div>
            <GradePill grade={analysis.finalGrade} large />
          </div>

          <div className="text-[10px] font-mono text-[var(--brand-cyan)]/80">
            {'> '}<span className="text-muted-foreground">Analysis complete · score {analysis.finalScore}/100</span>
          </div>

          {/* Trade plan */}
          <div className="grid grid-cols-4 gap-2 text-[10px] font-mono pt-2 border-t border-border/30">
            <PlanBox label="T1 Target" value={`$${analysis.plan.t1.toFixed(2)}`} color="emerald" />
            <PlanBox label="T2 Target" value={`$${analysis.plan.t2.toFixed(2)}`} color="emerald" />
            <PlanBox label="Invalidation" value={`$${analysis.plan.invalidation.toFixed(2)}`} color="rose" />
            <PlanBox label="DTE" value={`${analysis.plan.horizonDays}d`} color="muted" />
          </div>

          {/* ROI scenarios */}
          {analysis.roiScenarios && analysis.roiScenarios.length > 0 && (
            <details className="text-[10px] font-mono">
              <summary className="cursor-pointer text-[var(--brand-cyan)] hover:underline">
                ROI scenarios (click to expand)
              </summary>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                {analysis.roiScenarios.map((r, i) => (
                  <div key={i} className="px-2 py-1 rounded bg-muted/20 border border-border/20">
                    <div className="text-muted-foreground">
                      {r.pct === 0 ? 'flat' : `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(1)}σ`} → ${r.stockPrice.toFixed(2)}
                    </div>
                    <div className={`font-bold ${r.roi >= 0 ? 'text-[var(--trade-bullish)]' : 'text-rose-500'}`}>
                      {r.roi >= 0 ? '+' : ''}{(r.roi * 100).toFixed(0)}%
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Engine-picked stronger contracts (only when graded below B-) */}
          {analysis.suggestions && analysis.suggestions.length > 0 && (
            <div className="pt-3 border-t border-border/30 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--brand-cyan)]">
                  Oracle Upgrade
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {analysis.suggestionNote ?? 'Stronger contracts for the same thesis'}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {analysis.suggestions.map((s, i) => (
                  <SuggestionCard
                    key={i}
                    s={s}
                    symbol={analysis.spec.symbol}
                    onReanalyze={(inp) => { setInput(inp); analyze(inp); }}
                  />
                ))}
              </div>
            </div>
          )}
          {analysis.suggestions && analysis.suggestions.length === 0 && analysis.suggestionNote && (
            <div className="pt-3 border-t border-border/30">
              <div className="text-[10px] font-mono text-muted-foreground">
                {'> '}{analysis.suggestionNote}
              </div>
            </div>
          )}

          {/* Push to Trade Desk */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/30">
            {pushResult && (
              <div className="text-[10px] font-mono text-muted-foreground flex-1">{pushResult}</div>
            )}
            <button
              onClick={pushToTradeDesk}
              disabled={pushing}
              className="text-[10px] font-mono px-3 py-1.5 rounded border border-emerald-500/40 text-[var(--trade-bullish)] hover:bg-emerald-500/10 disabled:opacity-50 flex items-center gap-1.5"
            >
              {pushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Push to Trade Desk
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function GradePill({ grade, large }: { grade: string; large?: boolean }) {
  const color =
    grade.startsWith('S') ? 'bg-emerald-500/15 text-[var(--trade-bullish)] border-emerald-500/30' :
    grade.startsWith('A') ? 'bg-emerald-500/15 text-[var(--trade-bullish)] border-emerald-500/30' :
    grade.startsWith('B') ? 'bg-[var(--brand-cyan)]/15 text-[var(--brand-cyan)] border-[var(--brand-cyan)]/30' :
    grade.startsWith('C') ? 'bg-amber-500/15 text-amber-500 border-amber-500/30' :
    'bg-rose-500/15 text-rose-500 border-rose-500/30';
  return (
    <div className={`font-mono font-bold border rounded ${color} ${large ? 'text-[14px] px-3 py-1 min-w-[44px]' : 'text-[10px] px-1.5 py-0.5 min-w-[28px]'} text-center`}>
      {grade}
    </div>
  );
}

// Tier accent colors mirror the Oracle Option Pick card.
const TIER_STYLE: Record<SuggestedContract['tier'], { accent: string; border: string; bg: string; label: string }> = {
  conservative: { accent: 'text-[var(--trade-bullish)]', border: 'border-emerald-500/40', bg: 'bg-emerald-500/5', label: 'Conservative' },
  balanced:     { accent: 'text-[var(--brand-cyan)]', border: 'border-[var(--brand-cyan)]/40', bg: 'bg-[var(--brand-cyan)]/5', label: 'Balanced' },
  aggressive:   { accent: 'text-amber-500', border: 'border-amber-500/40', bg: 'bg-amber-500/5', label: 'Aggressive' },
};

function fmtExpiry(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SuggestionCard({ s, symbol, onReanalyze }: {
  s: SuggestedContract;
  symbol: string;
  onReanalyze: (input: string) => void;
}) {
  const t = TIER_STYLE[s.tier];
  const cp = s.optionType === 'call' ? 'C' : 'P';
  const reanalyzeInput = `${symbol} ${s.strike}${cp} ${fmtExpiry(s.expiry)}`;
  return (
    <button
      onClick={() => onReanalyze(reanalyzeInput)}
      title="Click to analyze this contract"
      className={`text-left w-full rounded-md border ${t.border} ${t.bg} p-2.5 hover:brightness-110 transition`}
    >
      {/* Tier + grade row */}
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-[9px] font-mono uppercase tracking-wider ${t.accent}`}>{t.label}</span>
        <GradePill grade={s.grade} />
      </div>
      {/* Strike · expiry · DTE · delta */}
      <div className="text-[13px] font-mono font-bold text-foreground">
        ${s.strike}{cp}
      </div>
      <div className="text-[9px] font-mono text-muted-foreground mb-2">
        {fmtExpiry(s.expiry)} · {s.dte}DTE · Δ{s.delta.toFixed(2)} · ${s.entryPremium.toFixed(2)}
      </div>
      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-1.5 text-[9px] font-mono">
        <div>
          <div className="text-muted-foreground uppercase text-[9px]">ROI@T1</div>
          <div className={`font-bold ${s.roiAtT1Pct >= 0 ? 'text-[var(--trade-bullish)]' : 'text-rose-500'}`}>
            {s.roiAtT1Pct >= 0 ? '+' : ''}{s.roiAtT1Pct.toFixed(0)}%
          </div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase text-[9px]">R:R</div>
          <div className="font-bold text-foreground">{s.riskRewardRatio.toFixed(1)}x</div>
        </div>
        <div>
          <div className="text-muted-foreground uppercase text-[9px]">BE</div>
          <div className="font-bold text-foreground">${s.breakeven.toFixed(2)}</div>
        </div>
      </div>
      {s.rationale && (
        <div className="mt-1.5 text-[9px] font-mono text-muted-foreground leading-snug line-clamp-2">
          {s.rationale}
        </div>
      )}
    </button>
  );
}

function PlanBox({ label, value, color }: { label: string; value: string; color: 'emerald' | 'rose' | 'muted' }) {
  const colorClass =
    color === 'emerald' ? 'text-[var(--trade-bullish)]' :
    color === 'rose' ? 'text-rose-500' :
    'text-foreground';
  return (
    <div className="px-2 py-1.5 rounded bg-muted/20 border border-border/20">
      <div className="text-[9px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className={`text-[11px] font-mono font-bold ${colorClass}`}>{value}</div>
    </div>
  );
}
