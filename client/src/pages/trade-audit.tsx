import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft,
  Target,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  XCircle,
  FileText,
  Camera,
  Activity,
  Scale,
  Share2,
  RefreshCw,
  Zap,
  BarChart3,
  Brain,
} from "lucide-react";
import { SiDiscord } from "react-icons/si";
import { format, formatDistanceToNow } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { cn, safeToFixed, safeNumber } from "@/lib/utils";
import { getPnlColor, getTradeOutcomeStyle } from "@/lib/signal-grade";
import type { TradeIdea, TradePriceSnapshot } from "@shared/schema";

interface AuditTrailData {
  tradeIdea: TradeIdea;
  priceSnapshots: TradePriceSnapshot[];
}

const TIMEZONE = "America/Chicago";

function formatCT(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const zonedDate = toZonedTime(date, TIMEZONE);
  return format(zonedDate, "MMM d, h:mm a") + " CT";
}

function getOutcomeColor(status: string | null): string {
  switch (status) {
    case "hit_target": return "text-[var(--trade-bullish)]";
    case "hit_stop": return "text-[var(--trade-bearish)]";
    case "expired": return "text-[var(--trade-neutral)]";
    default: return "text-sky-400";
  }
}

function getOutcomeBadge(status: string | null) {
  switch (status) {
    case "hit_target":
      return <Badge className="bg-[var(--trade-bullish)]/20 text-[var(--trade-bullish)] border-green-500/30">Target Hit</Badge>;
    case "hit_stop":
      return <Badge className="bg-red-500/20 text-[var(--trade-bearish)] border-red-500/30">Stop Hit</Badge>;
    case "expired":
      return <Badge className="bg-amber-500/20 text-[var(--trade-neutral)] border-amber-500/30">Expired</Badge>;
    default:
      return <Badge className="bg-sky-500/20 text-sky-400 border-sky-500/30">Open</Badge>;
  }
}

function getEventIcon(eventType: string) {
  switch (eventType) {
    case "target_hit":
      return <CheckCircle className="h-4 w-4 text-[var(--trade-bullish)]" />;
    case "stop_hit":
      return <XCircle className="h-4 w-4 text-[var(--trade-bearish)]" />;
    case "expired":
      return <Clock className="h-4 w-4 text-[var(--trade-neutral)]" />;
    case "idea_published":
      return <FileText className="h-4 w-4 text-sky-400" />;
    case "validation_check":
      return <Activity className="h-4 w-4 text-blue-400" />;
    default:
      return <Camera className="h-4 w-4 text-muted-foreground" />;
  }
}

function getEventLabel(eventType: string): string {
  switch (eventType) {
    case "target_hit": return "Target Reached";
    case "stop_hit": return "Stop Triggered";
    case "expired": return "Trade Expired";
    case "idea_published": return "Idea Published";
    case "validation_check": return "Validation Check";
    default: return eventType;
  }
}

function PlanCard({ idea }: { idea: TradeIdea }) {
  const isLong = idea.direction === "long";
  const safeEntry = safeNumber(idea.entryPrice, 1);
  const potentialGain = safeEntry > 0
    ? safeToFixed((safeNumber(idea.targetPrice) - safeEntry) / safeEntry * 100, 1)
    : '0.0';
  
  return (
    <Card className="glass-card">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-sky-500/10 flex items-center justify-center">
            <Target className="h-5 w-5 text-sky-400" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Original Plan</p>
            <CardTitle className="text-lg">Trade Plan</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={cn(
            isLong ? "border-green-500/50 text-[var(--trade-bullish)]" : "border-red-500/50 text-[var(--trade-bearish)]"
          )}>
            {isLong ? "LONG" : "SHORT"}
          </Badge>
          <span className="font-mono text-lg font-bold">{idea.symbol}</span>
          <Badge variant="secondary">{idea.assetType}</Badge>
          {idea.assetType === 'option' && idea.optionType && (
            <Badge variant="outline" className={cn(
              idea.optionType === 'call' ? "border-green-500/50 text-[var(--trade-bullish)]" : "border-red-500/50 text-[var(--trade-bearish)]"
            )}>
              {idea.optionType.toUpperCase()} ${idea.strikePrice} {idea.expiryDate}
            </Badge>
          )}
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="stat-glass rounded-lg p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Entry Price</p>
            <p className="font-mono text-lg font-bold tabular-nums">${safeToFixed(Number(idea.entryPrice), 2)}</p>
          </div>
          <div className="stat-glass rounded-lg p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Target Price</p>
            <p className="font-mono text-lg font-bold tabular-nums text-[var(--trade-bullish)]">
              ${safeToFixed(Number(idea.targetPrice), 2)}
              <span className="text-xs ml-1 opacity-70">+{potentialGain}%</span>
            </p>
          </div>
          <div className="stat-glass rounded-lg p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Stop Loss</p>
            <p className="font-mono text-lg font-bold tabular-nums text-[var(--trade-bearish)]">${safeToFixed(Number(idea.stopLoss), 2)}</p>
          </div>
          <div className="stat-glass rounded-lg p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Risk/Reward</p>
            <p className="font-mono text-lg font-bold tabular-nums">
              {idea.riskRewardRatio ? safeToFixed(Number(idea.riskRewardRatio), 2) + ":1" : "—"}
            </p>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4 pt-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Published</p>
            <p className="text-sm font-mono">{formatCT(idea.timestamp)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Exit By</p>
            <p className="text-sm font-mono">{formatCT(idea.exitBy)}</p>
          </div>
        </div>
        
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className="flex items-center gap-1">
            {idea.source === 'ai' ? <Brain className="h-3 w-3" /> : idea.source === 'quant' ? <Zap className="h-3 w-3" /> : <BarChart3 className="h-3 w-3" />}
            {idea.source}
          </Badge>
          {idea.confidenceScore && (
            <Badge variant="secondary">{idea.confidenceScore}pts signal strength</Badge>
          )}
          {idea.holdingPeriod && (
            <Badge variant="outline">{idea.holdingPeriod === 'day' ? 'Day Trade' : idea.holdingPeriod === 'swing' ? 'Swing' : 'Position'}</Badge>
          )}
          {idea.qualitySignals && idea.qualitySignals.length > 0 && (
            <Badge variant="secondary">{idea.qualitySignals.length}/5 signals</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function getLetterGrade(score: number): string {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 85) return 'B+';
  if (score >= 80) return 'B';
  if (score >= 75) return 'C+';
  if (score >= 70) return 'C';
  return 'D';
}

function getGradeColor(score: number): string {
  if (score >= 85) return 'text-[var(--trade-bullish)]';
  if (score >= 70) return 'text-[var(--trade-neutral)]';
  return 'text-[var(--trade-bearish)]';
}

function getSignalInfo(signal: string): { points: number; description: string; color: string } {
  const signalMap: Record<string, { points: number; description: string; color: string }> = {
    'Strong R:R (2:1+)': { points: 28, description: 'Risk/reward ratio of 2:1 or better', color: 'bg-[var(--trade-bullish)]' },
    'Good R:R (1.5:1+)': { points: 15, description: 'Risk/reward ratio of 1.5:1 or better', color: 'bg-[var(--trade-bullish)]' },
    'Acceptable R:R (1.2:1+)': { points: 8, description: 'Risk/reward ratio of 1.2:1 or better', color: 'bg-sky-400' },
    'Confirmed Volume': { points: 18, description: 'Volume 1.5x+ average, institutional interest', color: 'bg-sky-500' },
    'Strong Volume': { points: 12, description: 'Volume above average, adequate liquidity', color: 'bg-sky-400' },
    'Strong Signal': { points: 25, description: 'Multiple technical indicators aligned', color: 'bg-purple-500' },
    'Clear Signal': { points: 18, description: 'At least one strong technical indicator', color: 'bg-purple-400' },
    'Reversal Setup': { points: 20, description: 'RSI extreme - mean reversion likely', color: 'bg-amber-500' },
    'Trend Setup': { points: 15, description: 'Price aligned with prevailing trend', color: 'bg-amber-400' },
    'Breakout Setup': { points: 18, description: 'Breaking key resistance/support', color: 'bg-indigo-500' },
    'High Liquidity': { points: 5, description: 'High trading volume, easy entry/exit', color: 'bg-sky-500' },
    'Catalyst Present': { points: 10, description: 'News catalyst provides fundamental support', color: 'bg-pink-500' }
  };
  return signalMap[signal] || { points: 5, description: 'Quality signal detected', color: 'bg-white/10' };
}

function ConfidenceScoringCard({ idea }: { idea: TradeIdea }) {
  const score = idea.confidenceScore || 0;
  const grade = getLetterGrade(score);
  const signals = idea.qualitySignals || [];
  const totalPoints = signals.reduce((sum, s) => sum + getSignalInfo(s).points, 0);
  
  return (
    <Card className="glass-card">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
            <Scale className="h-5 w-5 text-[var(--trade-neutral)]" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Signal Strength Analysis</p>
            <CardTitle className="text-lg">Scoring Breakdown</CardTitle>
          </div>
          <div className="text-right">
            <div className={cn("text-3xl font-bold font-mono", getGradeColor(score))}>
              {grade}
            </div>
            <div className="text-xs text-muted-foreground">{score}pts</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Score Bar */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Signal Strength</span>
            <span className={cn("font-semibold", getGradeColor(score))}>{score}/100</span>
          </div>
          <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-500",
                score >= 85 ? "bg-[var(--trade-bullish)]" : score >= 70 ? "bg-amber-500" : "bg-red-500"
              )}
              style={{ width: `${score}%` }}
            />
          </div>
        </div>
        
        {/* Signal Breakdown */}
        {signals.length > 0 && (
          <div className="pt-3 border-t border-border/50">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
              Quality Signals ({signals.length}/5) • {totalPoints} pts
            </p>
            <div className="space-y-2">
              {signals.map((signal, idx) => {
                const info = getSignalInfo(signal);
                return (
                  <div key={idx} className="flex items-center gap-3 p-2 rounded-lg bg-background/50">
                    <div className={cn("w-1 h-8 rounded-full", info.color)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{signal}</p>
                      <p className="text-xs text-muted-foreground">{info.description}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">+{info.points}</Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {/* Quantitative Metrics */}
        {(idea.targetHitProbability || idea.timingConfidence || idea.volatilityRegime) && (
          <div className="pt-3 border-t border-border/50">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
              Quantitative Metrics
            </p>
            <div className="grid grid-cols-3 gap-3">
              {idea.targetHitProbability && (
                <div className="stat-glass rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Target Hit Prob</p>
                  <p className="font-mono font-bold text-[var(--trade-bullish)]">{safeToFixed(idea.targetHitProbability, 1)}%</p>
                </div>
              )}
              {idea.timingConfidence && (
                <div className="stat-glass rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Timing Conf</p>
                  <p className="font-mono font-bold text-sky-400">{safeToFixed(idea.timingConfidence, 0, '0')}%</p>
                </div>
              )}
              {idea.volatilityRegime && (
                <div className="stat-glass rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Volatility</p>
                  <p className="font-mono font-bold capitalize">{idea.volatilityRegime}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FullAnalysisCard({ idea }: { idea: TradeIdea }) {
  if (!idea.analysis && !idea.catalyst && !idea.sessionContext && (!idea.qualitySignals || idea.qualitySignals.length === 0)) {
    return null;
  }
  
  return (
    <Card className="glass-card">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Brain className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Research</p>
            <CardTitle className="text-lg">Full Analysis</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {idea.analysis && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Analysis Summary</p>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{idea.analysis}</p>
          </div>
        )}
        
        {idea.catalyst && (
          <div className="pt-3 border-t border-border/50">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <Zap className="h-3 w-3 text-[var(--trade-neutral)]" />
              Catalyst
            </p>
            <p className="text-sm leading-relaxed">{idea.catalyst}</p>
          </div>
        )}
        
        {idea.sessionContext && (
          <div className="pt-3 border-t border-border/50">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <Clock className="h-3 w-3 text-sky-400" />
              Market Session Context
            </p>
            <p className="text-sm leading-relaxed">{idea.sessionContext}</p>
          </div>
        )}
        
        {idea.qualitySignals && idea.qualitySignals.length > 0 && (
          <div className="pt-3 border-t border-border/50">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <BarChart3 className="h-3 w-3 text-purple-400" />
              Quality Signals ({idea.qualitySignals.length}/5)
            </p>
            <div className="flex flex-wrap gap-2">
              {idea.qualitySignals.map((signal, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {signal}
                </Badge>
              ))}
            </div>
          </div>
        )}
        
        {idea.dataSourceUsed && (
          <div className="pt-3 border-t border-border/50">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Data Source</p>
            <Badge variant={idea.dataSourceUsed !== 'estimated' ? 'default' : 'secondary'}>
              {idea.dataSourceUsed !== 'estimated' ? 'Real Market Data' : 'Simulated Data'}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OutcomeCard({ idea }: { idea: TradeIdea }) {
  const isResolved = idea.outcomeStatus && idea.outcomeStatus !== "open";
  const isWin = idea.outcomeStatus === "hit_target";
  const isLoss = idea.outcomeStatus === "hit_stop";
  
  return (
    <Card className="glass-card">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center",
            isWin ? "bg-[var(--trade-bullish)]/10" : isLoss ? "bg-red-500/10" : "bg-sky-500/10"
          )}>
            {isWin ? (
              <TrendingUp className="h-5 w-5 text-[var(--trade-bullish)]" />
            ) : isLoss ? (
              <TrendingDown className="h-5 w-5 text-[var(--trade-bearish)]" />
            ) : (
              <Activity className="h-5 w-5 text-sky-400" />
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Trade Result</p>
            <CardTitle className="text-lg">Outcome</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          {getOutcomeBadge(idea.outcomeStatus)}
          {idea.percentGain !== null && (
            <span className={cn(
              "font-mono text-2xl font-bold tabular-nums",
              getPnlColor(idea.outcomeStatus, Number(idea.percentGain))
            )}>
              {Number(idea.percentGain) >= 0 ? "+" : ""}{safeToFixed(Number(idea.percentGain), 2)}%
            </span>
          )}
        </div>
        
        {isResolved && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="stat-glass rounded-lg p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Exit Price</p>
                <p className="font-mono text-lg font-bold tabular-nums">${safeToFixed(Number(idea.exitPrice || 0), 2)}</p>
              </div>
              <div className="stat-glass rounded-lg p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Holding Time</p>
                <p className="font-mono text-lg font-bold tabular-nums">
                  {idea.actualHoldingTimeMinutes 
                    ? `${Math.round(idea.actualHoldingTimeMinutes)}m`
                    : "—"
                  }
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="stat-glass rounded-lg p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">High Reached</p>
                <p className="font-mono text-lg font-bold tabular-nums text-[var(--trade-bullish)]">
                  ${safeToFixed(Number(idea.highestPriceReached || 0), 2)}
                </p>
              </div>
              <div className="stat-glass rounded-lg p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Low Reached</p>
                <p className="font-mono text-lg font-bold tabular-nums text-[var(--trade-bearish)]">
                  ${safeToFixed(Number(idea.lowestPriceReached || 0), 2)}
                </p>
              </div>
            </div>
            
            {idea.resolutionReason && (
              <div className="pt-2 border-t border-border/50">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Resolution Reason</p>
                <p className="text-sm leading-relaxed">{idea.resolutionReason}</p>
              </div>
            )}
            
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">Exited At</p>
              <p className="text-sm font-mono">{formatCT(idea.exitDate)}</p>
            </div>
          </>
        )}
        
        {!isResolved && (
          <div className="text-center py-8">
            <div className="h-12 w-12 rounded-lg bg-sky-500/10 flex items-center justify-center mx-auto mb-3">
              <Activity className="h-6 w-6 text-sky-400 animate-pulse" />
            </div>
            <p className="text-muted-foreground">Trade in progress...</p>
            <p className="text-xs text-muted-foreground mt-1">
              Validation runs every 5 minutes
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PriceSnapshotTimeline({ snapshots }: { snapshots: TradePriceSnapshot[] }) {
  if (snapshots.length === 0) {
    return (
      <Card className="glass-card">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Camera className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Evidence Log</p>
              <CardTitle className="text-lg">Price Timeline</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="h-12 w-12 rounded-lg bg-muted/30 flex items-center justify-center mx-auto mb-3">
              <Camera className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">
              Price snapshots are captured when the trade reaches target/stop or expires
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="glass-card">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Camera className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Evidence Log</p>
            <CardTitle className="text-lg">Price Timeline</CardTitle>
          </div>
        </div>
        <CardDescription className="mt-2">
          {snapshots.length} price snapshot{snapshots.length !== 1 ? "s" : ""} recorded
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-border" />
          
          <div className="space-y-6">
            {snapshots.map((snapshot, index) => (
              <div key={snapshot.id} className="relative flex gap-4">
                <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background border border-border">
                  {getEventIcon(snapshot.eventType)}
                </div>
                
                <div className="flex-1 pb-4">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-medium">{getEventLabel(snapshot.eventType)}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {formatCT(snapshot.createdAt?.toISOString?.() || snapshot.eventTimestamp)}
                    </span>
                  </div>
                  
                  <div className="stat-glass rounded-lg p-4 space-y-3 hover-elevate transition-all">
                    <div className="flex items-center gap-4 flex-wrap">
                      <div>
                        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Price</span>
                        <p className="font-mono font-bold tabular-nums">
                          ${safeToFixed(Number(snapshot.currentPrice), 2)}
                        </p>
                      </div>
                      {snapshot.bidPrice && (
                        <div>
                          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Bid</span>
                          <p className="font-mono tabular-nums">${safeToFixed(Number(snapshot.bidPrice), 2)}</p>
                        </div>
                      )}
                      {snapshot.askPrice && (
                        <div>
                          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Ask</span>
                          <p className="font-mono tabular-nums">${safeToFixed(Number(snapshot.askPrice), 2)}</p>
                        </div>
                      )}
                    </div>
                    
                    {snapshot.distanceToTargetPercent !== null && (
                      <p className="text-xs text-muted-foreground">
                        Distance to target: <span className="font-mono">{safeToFixed(Number(snapshot.distanceToTargetPercent), 1)}%</span>
                      </p>
                    )}
                    
                    {snapshot.validatorVersion && (
                      <p className="text-xs text-muted-foreground">
                        Validator: <span className="font-mono">v{snapshot.validatorVersion}</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonCard({ idea }: { idea: TradeIdea }) {
  const isResolved = idea.outcomeStatus && idea.outcomeStatus !== "open";
  if (!isResolved) return null;
  
  const entryPrice = safeNumber(idea.entryPrice, 1);
  const targetPrice = safeNumber(idea.targetPrice, entryPrice * 1.05);
  const stopLoss = safeNumber(idea.stopLoss, entryPrice * 0.95);
  const exitPrice = safeNumber(idea.exitPrice, 0);

  const targetPct = entryPrice > 0 ? ((targetPrice - entryPrice) / entryPrice) * 100 : 0;
  const stopPct = entryPrice > 0 ? ((stopLoss - entryPrice) / entryPrice) * 100 : 0;
  const actualPct = Number(idea.percentGain || 0);
  
  return (
    <Card className="glass-card">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Scale className="h-5 w-5 text-[var(--trade-neutral)]" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Analysis</p>
            <CardTitle className="text-lg">Plan vs Reality</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="comparison-table">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Metric</th>
                <th className="text-right py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Planned</th>
                <th className="text-right py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Actual</th>
                <th className="text-right py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">Difference</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/30 hover-elevate">
                <td className="py-3">Target Price</td>
                <td className="text-right font-mono tabular-nums text-[var(--trade-bullish)]">${safeToFixed(targetPrice, 2)}</td>
                <td className="text-right font-mono tabular-nums">—</td>
                <td className="text-right font-mono tabular-nums">—</td>
              </tr>
              <tr className="border-b border-border/30 hover-elevate">
                <td className="py-3">Stop Loss</td>
                <td className="text-right font-mono tabular-nums text-[var(--trade-bearish)]">${safeToFixed(stopLoss, 2)}</td>
                <td className="text-right font-mono tabular-nums">—</td>
                <td className="text-right font-mono tabular-nums">—</td>
              </tr>
              <tr className="border-b border-border/30 hover-elevate">
                <td className="py-3">Exit Price</td>
                <td className="text-right font-mono tabular-nums">—</td>
                <td className="text-right font-mono tabular-nums">${safeToFixed(exitPrice, 2)}</td>
                <td className="text-right font-mono tabular-nums">
                  {(exitPrice - entryPrice >= 0 ? "+" : "") + safeToFixed(exitPrice - entryPrice, 2)}
                </td>
              </tr>
              <tr className="border-b border-border/30 hover-elevate">
                <td className="py-3">Max Upside</td>
                <td className="text-right font-mono tabular-nums text-[var(--trade-bullish)]">+{safeToFixed(targetPct, 1)}%</td>
                <td className={cn(
                  "text-right font-mono tabular-nums",
                  actualPct >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                )}>
                  {actualPct >= 0 ? "+" : ""}{safeToFixed(actualPct, 1)}%
                </td>
                <td className={cn(
                  "text-right font-mono tabular-nums",
                  actualPct >= targetPct ? "text-[var(--trade-bullish)]" : "text-[var(--trade-neutral)]"
                )}>
                  {safeToFixed(actualPct - targetPct, 1)}%
                </td>
              </tr>
              <tr className="hover-elevate">
                <td className="py-3">Max Risk</td>
                <td className="text-right font-mono tabular-nums text-[var(--trade-bearish)]">{safeToFixed(stopPct, 1)}%</td>
                <td className="text-right font-mono tabular-nums">
                  {idea.outcomeStatus === "hit_stop" ? `${safeToFixed(actualPct, 1)}%` : "—"}
                </td>
                <td className="text-right font-mono tabular-nums">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TradeAudit() {
  const params = useParams<{ id: string }>();
  const tradeId = params.id;
  const { toast } = useToast();
  
  // Main audit data with polling for open trades
  const { data, isLoading, error, refetch } = useQuery<AuditTrailData>({
    queryKey: ["/api/trade-ideas", tradeId, "audit"],
    enabled: !!tradeId,
    refetchInterval: (query) => {
      // Poll every 30 seconds if trade is still open
      const tradeData = query.state.data as AuditTrailData | undefined;
      if (tradeData?.tradeIdea?.outcomeStatus === 'open') {
        return 30000; // 30 seconds
      }
      return false; // Stop polling once resolved
    },
  });
  
  // Discord share mutation
  const shareToDiscord = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/trade-ideas/${tradeId}/share-discord`);
    },
    onSuccess: () => {
      toast({
        title: "Shared to Discord",
        description: `${data?.tradeIdea?.symbol} trade sent to Discord channel`,
      });
    },
    onError: () => {
      toast({
        title: "Share Failed",
        description: "Could not share to Discord. Please try again.",
        variant: "destructive",
      });
    },
  });
  
  if (isLoading) {
    return (
      <div className="p-3 sm:p-4 space-y-3 max-w-[1600px] mx-auto">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
        <Skeleton className="h-60" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  
  if (error || !data) {
    return (
      <div className="p-3 sm:p-4 space-y-3 max-w-[1600px] mx-auto">
        <Link href="/slate">
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Slate
          </Button>
        </Link>
        <Card className="glass-card">
          <CardContent className="py-12 text-center">
            <div className="h-12 w-12 rounded-lg bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="h-6 w-6 text-[var(--trade-neutral)]" />
            </div>
            <h2 className="text-xl font-bold mb-2">Trade Not Found</h2>
            <p className="text-muted-foreground">
              The trade idea you're looking for doesn't exist or has been removed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  const { tradeIdea, priceSnapshots } = data;
  
  const isOpen = tradeIdea.outcomeStatus === 'open';
  
  return (
    <div className="p-3 sm:p-4 space-y-3 max-w-[1600px] mx-auto" data-testid="trade-audit-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link href="/slate">
            <Button variant="ghost" size="sm" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <FileText className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Audit Trail</p>
              <h1 className="text-base font-semibold">
                {tradeIdea.symbol} <span className="text-muted-foreground font-mono text-base">• {formatCT(tradeIdea.timestamp)}</span>
              </h1>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          {isOpen && (
            <Badge variant="outline" className="flex items-center gap-1 text-sky-400 border-sky-500/30 animate-pulse">
              <Activity className="h-3 w-3" />
              Live - updates every 30s
            </Badge>
          )}
          {getOutcomeBadge(tradeIdea.outcomeStatus)}
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => refetch()}
            data-testid="button-refresh"
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button 
            variant="default" 
            size="sm"
            onClick={() => shareToDiscord.mutate()}
            disabled={shareToDiscord.isPending}
            className="bg-[#5865F2] hover:bg-[#4752C4] text-white"
            data-testid="button-share-discord"
          >
            <SiDiscord className="h-4 w-4 mr-1" />
            {shareToDiscord.isPending ? 'Sharing...' : 'Share to Discord'}
          </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PlanCard idea={tradeIdea} />
        <OutcomeCard idea={tradeIdea} />
      </div>
      
      {/* Confidence Scoring - Prominent Display */}
      <ConfidenceScoringCard idea={tradeIdea} />
      
      <FullAnalysisCard idea={tradeIdea} />
      
      <ComparisonCard idea={tradeIdea} />
      
      <PriceSnapshotTimeline snapshots={priceSnapshots} />
      
      <Card className="glass-card border-amber-500/20">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-4 w-4 text-[var(--trade-neutral)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--trade-neutral)]">Educational Disclaimer</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                This audit trail is provided for educational and research purposes only. 
                Past performance does not guarantee future results. All trade ideas are 
                research publications, not investment advice. You are solely responsible 
                for your own trading decisions.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
