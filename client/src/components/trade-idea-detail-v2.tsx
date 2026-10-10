/**
 * Trade Idea Detail Modal v2
 * ==========================
 * Shows TV vs QE scoring breakdown, trade levels,
 * scale-out plan, and strategy context.
 */

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";
import {
  ArrowUpRight, ArrowDownRight, X, ExternalLink,
  CheckCircle2, AlertTriangle, MinusCircle, Zap, Clock, Target,
  TrendingUp, Shield, BarChart3, Activity, Loader2,
} from "lucide-react";
import { cn, safeToFixed, formatRelativeTime } from "@/lib/utils";
import type { TradeIdea } from "@shared/schema";

interface Props {
  idea: TradeIdea | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Use shared utilities
const safeFixed = (n: number | null | undefined, d: number) => safeToFixed(n, d, '--');
const relativeTime = (iso: string) => formatRelativeTime(iso);

// Parse QE checks from the catalyst/analysis text
function parseQEChecks(text: string): { label: string; passed: boolean }[] {
  const checks: { label: string; passed: boolean }[] = [];
  if (!text) return checks;

  // Look for QE check patterns in the text
  const patterns = [
    { match: /Sector\s+(\w+)\s+aligned/i, label: (m: RegExpMatchArray) => `Sector ${m[1]} aligned`, passed: true },
    { match: /Sector\s+(\w+)\s+opposing/i, label: (m: RegExpMatchArray) => `Sector ${m[1]} opposing`, passed: false },
    { match: /High volume\s+([\d.]+)x/i, label: (m: RegExpMatchArray) => `High volume ${m[1]}x avg`, passed: true },
    { match: /Moderate volume\s+([\d.]+)x/i, label: (m: RegExpMatchArray) => `Moderate volume ${m[1]}x`, passed: true },
    { match: /Low volume\s+([\d.]+)x/i, label: (m: RegExpMatchArray) => `Low volume ${m[1]}x`, passed: false },
    { match: /Reversal setup\s*\(prev\s*([-\d.]+)%/i, label: (m: RegExpMatchArray) => `Reversal setup (prev ${m[1]}% red)`, passed: true },
    { match: /Breakdown setup/i, label: () => 'Breakdown setup confirmed', passed: true },
    { match: /Flow\s+(\w+)\s*\((\d+)%/i, label: (m: RegExpMatchArray) => `Flow ${m[1]} (${m[2]}% strength)`, passed: true },
  ];

  for (const p of patterns) {
    const m = text.match(p.match);
    if (m) checks.push({ label: p.label(m), passed: p.passed });
  }

  return checks;
}

// Extract TV and QE scores from analysis text
function parseScores(idea: TradeIdea): { tvScore: number | null; qeScore: number | null; qeVerdict: string | null } {
  const text = (idea as any).analysis || '';
  const tvMatch = text.match(/TV:(\d+)/);
  const qeMatch = text.match(/QE:(\d+)\((\w+)\)/);

  return {
    tvScore: tvMatch ? parseInt(tvMatch[1]) : null,
    qeScore: qeMatch ? parseInt(qeMatch[1]) : null,
    qeVerdict: qeMatch ? qeMatch[2] : null,
  };
}

export function TradeIdeaDetailV2({ idea, open, onOpenChange }: Props) {
  const [gexScanning, setGexScanning] = useState(false);
  const [gexResult, setGexResult] = useState<{
    candidate: {
      setup: string;
      direction: string;
      entry: number;
      target: number;
      stop: number;
      riskRewardRatio: number;
      confidence: number;
      thesis: string;
      regime: string;
      flipPoint: number | null;
      callWall: number | null;
      putWall: number | null;
    } | null;
    persisted: boolean;
  } | null>(null);

  const scanGex = async (symbol: string) => {
    setGexScanning(true);
    setGexResult(null);
    try {
      const res = await fetch('/api/gex-scanner/scan-ticker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      if (res.ok) {
        const data = await res.json();
        setGexResult(data);
      }
    } catch { /* silently fail */ }
    setGexScanning(false);
  };

  if (!idea) return null;

  const isLong = idea.direction === 'long' || idea.direction === 'LONG';
  const isTV = (idea as any).source === 'tradingview';
  const isOption = idea.assetType === 'option' || (idea as any).optionType;
  const optType = ((idea as any).optionType || '').toUpperCase();
  const strike = (idea as any).strikePrice;
  const expiry = (idea as any).expiryDate;
  const confidence = (idea as any).confidenceScore || 50;
  const grade = (idea as any).probabilityBand || (confidence >= 90 ? 'A+' : confidence >= 85 ? 'A' : confidence >= 80 ? 'B+' : confidence >= 70 ? 'B' : 'C');
  const rr = (idea as any).riskRewardRatio || 0;
  const contractCost = isOption && idea.entryPrice ? idea.entryPrice * 100 : null;
  const catalyst = idea.catalyst || '';
  const analysis = (idea as any).analysis || '';
  const session = (idea as any).sessionContext || '';
  const strategyName = isTV ? (session.includes('v15B') ? 'v15B (Swing 1H)' : session.includes('v15') ? 'v15 (Intraday 15min)' : 'TradingView') : 'AI Engine';

  // Parse dual scores
  const { tvScore, qeScore, qeVerdict } = parseScores(idea);
  const qeChecks = parseQEChecks(catalyst + ' ' + analysis);

  // Scale-out plan based on strategy rules
  const entryPrice = idea.entryPrice || 0;
  const scaleOut = isOption ? [
    { level: '+30%', price: +(entryPrice * 1.3).toFixed(2), action: 'Sell 1/3 — lock profit', cost: contractCost ? `$${(entryPrice * 1.3 * 100).toFixed(0)}` : null },
    { level: '+80%', price: +(entryPrice * 1.8).toFixed(2), action: 'Sell 1/3 — let rest run', cost: contractCost ? `$${(entryPrice * 1.8 * 100).toFixed(0)}` : null },
    { level: 'Trail', price: null, action: 'Trail final 1/3 at 25% from peak', cost: null },
  ] : [];

  const expiryFormatted = expiry
    ? new Date(expiry + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 bg-card border-border overflow-hidden">
        {/* Header */}
        <div className={cn(
          "px-5 pt-5 pb-4",
          isTV ? "bg-purple-500/5 border-b border-purple-500/20" : "border-b border-border"
        )}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm",
                isLong
                  ? "bg-emerald-500/20 text-[var(--trade-bullish)] border border-emerald-500/30"
                  : "bg-red-500/20 text-[var(--trade-bearish)] border border-red-500/30"
              )}>
                {idea.symbol.slice(0, 2)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-white">{idea.symbol}</span>
                  <Badge className={cn(
                    "text-[10px] border",
                    isLong ? "bg-emerald-500/15 text-[var(--trade-bullish)] border-emerald-500/30" : "bg-red-500/15 text-[var(--trade-bearish)] border-red-500/30"
                  )}>
                    {isLong ? 'LONG' : 'SHORT'}
                  </Badge>
                  {isTV && (
                    <Badge className="text-[10px] bg-purple-500/15 text-purple-400 border border-purple-500/30">
                      📺 {strategyName}
                    </Badge>
                  )}
                </div>
                {isOption && (
                  <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                    <span className="text-white font-mono">{optType} ${strike}</span>
                    {expiryFormatted && <span>exp {expiryFormatted}</span>}
                    {contractCost && <span className="text-muted-foreground">• ${contractCost.toFixed(0)}/ct</span>}
                  </div>
                )}
              </div>
            </div>
            <Badge className={cn(
              "text-lg font-bold px-3 py-1",
              grade.startsWith('A') ? "bg-amber-500/20 text-[var(--trade-neutral)] border border-amber-500/40" :
              grade.startsWith('B') ? "bg-emerald-500/15 text-[var(--trade-bullish)] border border-emerald-500/30" :
              "bg-muted-foreground/15 text-muted-foreground border border-muted-foreground/30"
            )}>
              {grade}
            </Badge>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* SCORES — TV vs QE */}
          {(tvScore || qeScore) && (
            <div>
              <h3 className="text-[10px] text-muted-foreground uppercase tracking-wide tracking-wider mb-2">Scores</h3>
              <div className="grid grid-cols-3 gap-2">
                {tvScore && (
                  <div className="text-center py-2 rounded-lg bg-purple-500/10 border border-purple-500/20">
                    <div className="text-[9px] text-purple-400/70 uppercase">TV Score</div>
                    <div className="text-xl font-bold font-mono text-purple-400">{tvScore}</div>
                  </div>
                )}
                {qeScore && (
                  <div className={cn(
                    "text-center py-2 rounded-lg border",
                    qeVerdict === 'CONFIRMED' ? "bg-emerald-500/10 border-emerald-500/20" :
                    qeVerdict === 'NEUTRAL' ? "bg-amber-500/10 border-amber-500/20" :
                    "bg-red-500/10 border-red-500/20"
                  )}>
                    <div className="text-[9px] text-muted-foreground uppercase">QE Score</div>
                    <div className={cn(
                      "text-xl font-bold font-mono",
                      qeVerdict === 'CONFIRMED' ? "text-[var(--trade-bullish)]" :
                      qeVerdict === 'NEUTRAL' ? "text-[var(--trade-neutral)]" : "text-[var(--trade-bearish)]"
                    )}>{qeScore}</div>
                    <div className={cn(
                      "text-[9px] font-medium",
                      qeVerdict === 'CONFIRMED' ? "text-[var(--trade-bullish)]/70" :
                      qeVerdict === 'NEUTRAL' ? "text-[var(--trade-neutral)]/70" : "text-[var(--trade-bearish)]/70"
                    )}>{qeVerdict}</div>
                  </div>
                )}
                <div className="text-center py-2 rounded-lg bg-white/5 border border-border/50">
                  <div className="text-[9px] text-muted-foreground uppercase">Combined</div>
                  <div className={cn(
                    "text-xl font-bold font-mono",
                    confidence >= 80 ? "text-[var(--trade-bullish)]" : confidence >= 65 ? "text-[var(--trade-neutral)]" : "text-[var(--trade-bearish)]"
                  )}>{Math.round(confidence)}</div>
                </div>
              </div>
            </div>
          )}

          {/* QE CHECKS */}
          {qeChecks.length > 0 && (
            <div>
              <h3 className="text-[10px] text-muted-foreground uppercase tracking-wide tracking-wider mb-2">QE Validation</h3>
              <div className="space-y-1.5">
                {qeChecks.map((check, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {check.passed
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-[var(--trade-bullish)] shrink-0" />
                      : <AlertTriangle className="w-3.5 h-3.5 text-[var(--trade-neutral)] shrink-0" />
                    }
                    <span className={check.passed ? "text-foreground/80" : "text-[var(--trade-neutral)]/80"}>
                      {check.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No scores for non-TV ideas — show signal strength only */}
          {!tvScore && !qeScore && (
            <div>
              <h3 className="text-[10px] text-muted-foreground uppercase tracking-wide tracking-wider mb-2">Signal Strength</h3>
              <div className="flex items-center gap-3">
                <div className={cn(
                  "text-2xl font-bold font-mono",
                  confidence >= 80 ? "text-[var(--trade-bullish)]" : confidence >= 65 ? "text-[var(--trade-neutral)]" : "text-muted-foreground"
                )}>
                  {Math.round(confidence)}pts
                </div>
                <span className="text-xs text-muted-foreground">from calibration engine (historical WR + R:R + signals)</span>
              </div>
            </div>
          )}

          <Separator className="bg-muted" />

          {/* TRADE LEVELS */}
          <div>
            <h3 className="text-[10px] text-muted-foreground uppercase tracking-wide tracking-wider mb-2">Trade Levels</h3>
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center py-2 rounded bg-muted/50">
                <div className="text-[9px] text-muted-foreground">Entry</div>
                <div className="text-sm font-bold font-mono text-white">${safeFixed(idea.entryPrice, 2)}</div>
              </div>
              <div className="text-center py-2 rounded bg-emerald-500/10">
                <div className="text-[9px] text-[var(--trade-bullish)]/70">Target</div>
                <div className="text-sm font-bold font-mono text-[var(--trade-bullish)]">${safeFixed(idea.targetPrice, 2)}</div>
              </div>
              <div className="text-center py-2 rounded bg-red-500/10">
                <div className="text-[9px] text-[var(--trade-bearish)]/70">Stop</div>
                <div className="text-sm font-bold font-mono text-[var(--trade-bearish)]">${safeFixed(idea.stopLoss, 2)}</div>
              </div>
              <div className="text-center py-2 rounded bg-sky-500/10">
                <div className="text-[9px] text-sky-400/70">R:R</div>
                <div className="text-sm font-bold font-mono text-sky-400">{Number(rr).toFixed(1)}:1</div>
              </div>
            </div>
          </div>

          {/* SCALE-OUT PLAN (options only) */}
          {scaleOut.length > 0 && (
            <div>
              <h3 className="text-[10px] text-muted-foreground uppercase tracking-wide tracking-wider mb-2">Scale-Out Plan</h3>
              <div className="space-y-1.5">
                {scaleOut.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-muted/30">
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--trade-bullish)] font-mono font-medium w-12">{s.level}</span>
                      <span className="text-muted-foreground">{s.action}</span>
                    </div>
                    {s.price && <span className="text-white font-mono">${s.price}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CATALYST */}
          {catalyst && (
            <div>
              <h3 className="text-[10px] text-muted-foreground uppercase tracking-wide tracking-wider mb-2">Catalyst</h3>
              <p className="text-xs text-foreground/80 leading-relaxed">
                <Zap className="w-3 h-3 text-[var(--trade-neutral)] inline mr-1" />
                {catalyst.split('|')[0].trim()}
              </p>
            </div>
          )}

          {/* STRATEGY CONTEXT */}
          <div>
            <h3 className="text-[10px] text-muted-foreground uppercase tracking-wide tracking-wider mb-2">Strategy</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{strategyName}</span>
              <span className="text-muted-foreground">|</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {relativeTime(idea.timestamp || '')}
              </span>
              <span className="text-muted-foreground">|</span>
              <span>{(idea as any).source || 'scanner'}</span>
            </div>
          </div>

          {/* ON-DEMAND GEX SCAN RESULT */}
          {gexResult && gexResult.candidate && (
            <div>
              <h3 className="text-[10px] text-muted-foreground uppercase tracking-wide tracking-wider mb-2">
                GEX Setup Found
              </h3>
              <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className="text-[10px] bg-sky-500/20 text-sky-400 border border-sky-500/30">
                    {gexResult.candidate.setup.replace('_', ' ').toUpperCase()}
                  </Badge>
                  <Badge className={cn(
                    "text-[10px] border",
                    gexResult.candidate.direction === 'long'
                      ? "bg-emerald-500/15 text-[var(--trade-bullish)] border-emerald-500/30"
                      : "bg-red-500/15 text-[var(--trade-bearish)] border-red-500/30"
                  )}>
                    {gexResult.candidate.direction.toUpperCase()}
                  </Badge>
                  <Badge className="text-[10px] bg-white/5 text-muted-foreground border border-border/50">
                    {gexResult.candidate.regime?.replace('_', ' ')}
                  </Badge>
                </div>
                <p className="text-xs text-foreground/70 leading-relaxed">{gexResult.candidate.thesis}</p>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="text-center">
                    <span className="text-muted-foreground block text-[9px]">Entry</span>
                    <span className="font-mono font-medium">${gexResult.candidate.entry.toFixed(2)}</span>
                  </div>
                  <div className="text-center">
                    <span className="text-[var(--trade-bullish)] block text-[9px]">Target</span>
                    <span className="font-mono text-[var(--trade-bullish)]">${gexResult.candidate.target.toFixed(2)}</span>
                  </div>
                  <div className="text-center">
                    <span className="text-[var(--trade-bearish)] block text-[9px]">Stop</span>
                    <span className="font-mono text-[var(--trade-bearish)]">${gexResult.candidate.stop.toFixed(2)}</span>
                  </div>
                  <div className="text-center">
                    <span className="text-sky-400 block text-[9px]">R:R</span>
                    <span className="font-mono text-sky-400">{gexResult.candidate.riskRewardRatio}:1</span>
                  </div>
                </div>
                {/* GEX Levels */}
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
                  {gexResult.candidate.flipPoint && (
                    <span>Flip: <span className="font-mono text-foreground/70">${gexResult.candidate.flipPoint.toFixed(2)}</span></span>
                  )}
                  {gexResult.candidate.callWall && (
                    <span>Call Wall: <span className="font-mono text-[var(--trade-bullish)]">${gexResult.candidate.callWall.toFixed(2)}</span></span>
                  )}
                  {gexResult.candidate.putWall && (
                    <span>Put Wall: <span className="font-mono text-[var(--trade-bearish)]">${gexResult.candidate.putWall.toFixed(2)}</span></span>
                  )}
                </div>
                {gexResult.persisted && (
                  <div className="text-[10px] text-[var(--trade-bullish)] flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Saved as trade idea
                  </div>
                )}
              </div>
            </div>
          )}
          {gexResult && !gexResult.candidate && (
            <div className="text-xs text-muted-foreground flex items-center gap-2 py-2">
              <Activity className="w-3 h-3" />
              No active GEX setup for {idea.symbol} right now (no flip cross, wall pin, or squeeze break)
            </div>
          )}

          {/* ACTIONS */}
          <div className="flex items-center gap-2 pt-2 flex-wrap">
            <Link href={`/r/${idea.symbol}`}>
              <Button variant="outline" size="sm" className="text-xs border-border hover:border-border">
                <ExternalLink className="w-3 h-3 mr-1.5" />
                Full Analysis
              </Button>
            </Link>
            <Link href={`/r/${idea.symbol}?tab=flow`}>
              <Button variant="outline" size="sm" className="text-xs border-border hover:border-border">
                <BarChart3 className="w-3 h-3 mr-1.5" />
                GEX Profile
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-sky-500/30 text-sky-400 hover:bg-sky-500/10 hover:border-sky-500/50"
              onClick={() => scanGex(idea.symbol)}
              disabled={gexScanning}
            >
              {gexScanning ? (
                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
              ) : (
                <Activity className="w-3 h-3 mr-1.5" />
              )}
              {gexScanning ? 'Scanning...' : 'Scan GEX'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
