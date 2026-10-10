/**
 * Broker Import Component
 *
 * Allows users to:
 * - Connect to brokers with API support (Tradier)
 * - Import positions via CSV (Webull, Robinhood, etc.)
 * - View unified portfolio across all brokers
 */

import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn, safeToFixed } from "@/lib/utils";
import {
  Upload,
  FileSpreadsheet,
  Check,
  AlertTriangle,
  RefreshCw,
  Link2,
  Link2Off,
  Wallet,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Info,
  Download,
  X,
  Camera,
  Sparkles,
  ShieldAlert,
  Lightbulb,
  Link as LinkIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Broker types matching backend
type BrokerType = 'tradier' | 'webull' | 'robinhood' | 'manual' | 'td_ameritrade' | 'schwab' | 'fidelity';

interface BrokerConfig {
  type: BrokerType;
  name: string;
  hasApi: boolean;
  csvImport: boolean;
  instructions: string;
  logo?: string;
  color: string;
}

const BROKERS: BrokerConfig[] = [
  {
    type: 'tradier',
    name: 'Tradier',
    hasApi: true,
    csvImport: false,
    instructions: 'Connect via API key from Tradier dashboard',
    color: 'bg-blue-500',
  },
  {
    type: 'webull',
    name: 'Webull',
    hasApi: false,
    csvImport: true,
    instructions: 'Export positions from Webull app: Menu > More > Statements & History > Export',
    color: 'bg-orange-500',
  },
  {
    type: 'robinhood',
    name: 'Robinhood',
    hasApi: false,
    csvImport: true,
    instructions: 'Export positions from Robinhood: Account > Statements > Download CSV',
    color: 'bg-emerald-500',
  },
  {
    type: 'td_ameritrade',
    name: 'TD/Schwab',
    hasApi: false,
    csvImport: true,
    instructions: 'Export from Schwab: Accounts > Positions > Export to CSV',
    color: 'bg-purple-500',
  },
  {
    type: 'fidelity',
    name: 'Fidelity',
    hasApi: false,
    csvImport: true,
    instructions: 'Export from Fidelity: Positions > Download',
    color: 'bg-green-600',
  },
  {
    type: 'manual',
    name: 'Manual',
    hasApi: false,
    csvImport: true,
    instructions: 'Upload CSV with columns: symbol, quantity, cost_basis',
    color: 'bg-muted-foreground',
  },
];

interface Position {
  symbol: string;
  quantity: number;
  costBasis: number;
  currentPrice?: number;
  currentValue?: number;
  unrealizedPL?: number;
  unrealizedPLPercent?: number;
  broker: BrokerType;
  isOption: boolean;
  optionDetails?: {
    underlying: string;
    optionType: 'call' | 'put';
    strike: number;
    expiry: string;
    daysToExpiry: number;
  };
}

interface Portfolio {
  broker: BrokerType;
  brokerName: string;
  positions: Position[];
  totalValue: number;
  totalCost: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  lastUpdated: string;
}

// Single Broker Card
function BrokerCard({
  broker,
  onImport,
  isConnected,
  positionCount,
}: {
  broker: BrokerConfig;
  onImport: (broker: BrokerType) => void;
  isConnected: boolean;
  positionCount: number;
}) {
  return (
    <Card className={cn(
      "p-4 transition-all cursor-pointer hover:border-border",
      isConnected ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/50 bg-card/40"
    )}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm",
            broker.color
          )}>
            {broker.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h3 className="font-semibold text-white">{broker.name}</h3>
            <p className="text-xs text-muted-foreground">
              {broker.hasApi ? 'API Connected' : 'CSV Import'}
            </p>
          </div>
        </div>
        {isConnected ? (
          <Badge className="bg-emerald-500/20 text-[var(--trade-bullish)] border-emerald-500/40">
            <Check className="w-3 h-3 mr-1" />
            {positionCount} positions
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Not connected
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
        {broker.instructions}
      </p>

      <Button
        size="sm"
        className={cn(
          "w-full",
          isConnected
            ? "bg-muted hover:bg-muted"
            : "bg-teal-600 hover:bg-teal-500"
        )}
        onClick={() => onImport(broker.type)}
      >
        {broker.hasApi ? (
          <>
            <Link2 className="w-4 h-4 mr-2" />
            {isConnected ? 'Reconnect' : 'Connect API'}
          </>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" />
            {isConnected ? 'Re-import' : 'Import CSV'}
          </>
        )}
      </Button>
    </Card>
  );
}

// CSV Import Dialog
function CSVImportDialog({
  broker,
  open,
  onOpenChange,
  onSuccess,
}: {
  broker: BrokerConfig | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [mode, setMode] = useState<'csv' | 'screenshot'>('csv');

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      setImporting(true);

      // Read file content
      const content = await file.text();

      const res = await fetch('/api/broker/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvContent: content,
          brokerType: broker?.type || 'manual',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Import failed');
      }

      return res.json();
    },
    onSuccess: (data) => {
      setImporting(false);
      toast({
        title: "Import Successful",
        description: `Imported ${data.positions?.length || 0} positions from ${broker?.name}`,
      });
      onSuccess();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setImporting(false);
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importImage = useMutation({
    mutationFn: async (file: File) => {
      setImporting(true);
      const formData = new FormData();
      formData.append('screenshot', file);
      formData.append('brokerType', broker?.type || 'manual');

      const res = await fetch('/api/broker/import-screenshot', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Could not read positions from screenshot');
      }

      return res.json();
    },
    onSuccess: (data) => {
      setImporting(false);
      toast({
        title: "Screenshot Imported",
        description: `Extracted ${data.positionCount || 0} positions from your screenshot`,
      });
      onSuccess();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setImporting(false);
      toast({
        title: "Screenshot Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast({
        title: "Invalid File",
        description: "Please upload a CSV file",
        variant: "destructive",
      });
      return;
    }
    importMutation.mutate(file);
  };

  const handleImageSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid File",
        description: "Please upload an image (PNG, JPG, WEBP)",
        variant: "destructive",
      });
      return;
    }
    importImage.mutate(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (mode === 'screenshot') handleImageSelect(file);
    else handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-teal-400" />
            Import from {broker?.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {broker?.instructions}
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle: CSV vs Screenshot */}
        <div className="flex items-center gap-2 p-1 rounded-lg bg-muted/40 border border-border/50">
          <button
            type="button"
            onClick={() => setMode('csv')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors",
              mode === 'csv' ? "bg-teal-600 text-white" : "text-muted-foreground hover:text-white"
            )}
          >
            <FileSpreadsheet className="w-4 h-4" />
            CSV File
          </button>
          <button
            type="button"
            onClick={() => setMode('screenshot')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors",
              mode === 'screenshot' ? "bg-teal-600 text-white" : "text-muted-foreground hover:text-white"
            )}
          >
            <Camera className="w-4 h-4" />
            Screenshot
          </button>
        </div>

        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-8 text-center transition-colors",
            dragOver
              ? "border-teal-400 bg-teal-500/10"
              : "border-border hover:border-border"
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {importing ? (
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-10 h-10 text-teal-400 animate-spin" />
              <p className="text-muted-foreground">
                {mode === 'screenshot' ? 'Reading positions from screenshot…' : 'Importing positions...'}
              </p>
            </div>
          ) : mode === 'screenshot' ? (
            <>
              <Camera className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-foreground/80 mb-2">
                Drag & drop a screenshot of your positions
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Any broker app — PNG, JPG, or WEBP
              </p>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageSelect(file);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => imageInputRef.current?.click()}
              >
                Select Screenshot
              </Button>
            </>
          ) : (
            <>
              <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-foreground/80 mb-2">
                Drag & drop your CSV file here
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                or click to browse
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Select CSV File
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
          <Info className="w-4 h-4" />
          <span>
            {mode === 'screenshot'
              ? 'We read only the numbers visible in your screenshot — nothing is guessed.'
              : 'Expected columns: symbol, quantity, cost_basis (or avg_cost)'}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Position Row
function PositionRow({ position }: { position: Position }) {
  const plColor = (position.unrealizedPLPercent || 0) >= 0
    ? "text-[var(--trade-bullish)]"
    : "text-[var(--trade-bearish)]";

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold",
          position.isOption ? "bg-purple-600" : "bg-muted"
        )}>
          {position.symbol.slice(0, 2)}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-white">
              {position.isOption && position.optionDetails
                ? position.optionDetails.underlying
                : position.symbol}
            </span>
            {position.isOption && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 text-purple-400">
                {position.optionDetails?.optionType?.toUpperCase()} ${position.optionDetails?.strike}
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {position.quantity} shares @ ${safeToFixed(position.costBasis / Math.abs(position.quantity) / (position.isOption ? 100 : 1), 2)}
          </span>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-white">
          ${safeToFixed(position.currentValue, 2, '—')}
        </div>
        <div className={cn("text-xs font-mono", plColor)}>
          {(position.unrealizedPLPercent || 0) >= 0 ? '+' : ''}
          {safeToFixed(position.unrealizedPLPercent, 1, '0')}%
        </div>
      </div>
    </div>
  );
}

interface SignalCorrelation {
  symbol: string;
  exposure: 'long' | 'short';
  ourDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
  alignment: 'agrees' | 'conflicts' | 'no_signal';
  ourConfidence?: number;
  note: string;
}

interface AnalyzeResult {
  deterministic: {
    riskScore: number;
    topRisks: string[];
    suggestions: string[];
    optionsExpiringThisWeek: number;
    biggestWinner: { symbol: string; plPercent: number } | null;
    biggestLoser: { symbol: string; plPercent: number } | null;
  };
  correlations: SignalCorrelation[];
  aiSummary: string;
  aiSuggestions: string[];
  isAI: boolean;
}

// AI Insights Panel — deterministic numbers + grounded LLM narrative + signal correlation
function PortfolioInsights({ broker }: { broker: BrokerType }) {
  const { toast } = useToast();

  const analyze = useMutation({
    mutationFn: async (): Promise<AnalyzeResult> => {
      const res = await fetch('/api/broker/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brokerType: broker }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Analysis failed');
      }
      return res.json();
    },
    onError: (error: Error) => {
      toast({ title: 'Analysis Failed', description: error.message, variant: 'destructive' });
    },
  });

  const result = analyze.data;
  const riskColor = (s: number) =>
    s >= 70 ? 'text-[var(--trade-bearish)]' : s >= 40 ? 'text-[var(--trade-neutral)]' : 'text-[var(--trade-bullish)]';

  return (
    <div className="border-t border-border pt-4 mt-2">
      {!result ? (
        <Button
          size="sm"
          className="w-full bg-gradient-to-r from-violet-600 to-teal-600 hover:from-violet-500 hover:to-teal-500"
          disabled={analyze.isPending}
          onClick={() => analyze.mutate()}
        >
          {analyze.isPending ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Analyzing portfolio…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Analyze with AI
            </>
          )}
        </Button>
      ) : (
        <div className="space-y-4">
          {/* Header: risk score + AI/deterministic badge */}
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              Portfolio Insights
              <Badge variant="outline" className="text-[9px] text-muted-foreground">
                {result.isAI ? 'AI + computed' : 'computed'}
              </Badge>
            </h4>
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground uppercase">Risk</div>
              <div className={cn('font-mono font-bold', riskColor(result.deterministic.riskScore))}>
                {result.deterministic.riskScore}/100
              </div>
            </div>
          </div>

          {/* Narrative summary */}
          {result.aiSummary && (
            <p className="text-sm text-foreground/80 leading-relaxed bg-muted/30 rounded-lg p-3">
              {result.aiSummary}
            </p>
          )}

          {/* Winner / Loser */}
          <div className="grid grid-cols-2 gap-2">
            {result.deterministic.biggestWinner && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2">
                <div className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Top winner
                </div>
                <div className="font-mono text-sm text-[var(--trade-bullish)]">
                  {result.deterministic.biggestWinner.symbol} +{safeToFixed(result.deterministic.biggestWinner.plPercent, 1)}%
                </div>
              </div>
            )}
            {result.deterministic.biggestLoser && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-2">
                <div className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" /> Top loser
                </div>
                <div className="font-mono text-sm text-[var(--trade-bearish)]">
                  {result.deterministic.biggestLoser.symbol} {safeToFixed(result.deterministic.biggestLoser.plPercent, 1)}%
                </div>
              </div>
            )}
          </div>

          {/* Signal correlation against our active ideas */}
          {result.correlations.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                <LinkIcon className="w-3 h-3" /> vs. our signals
              </h5>
              <div className="space-y-1.5">
                {result.correlations.map((c, idx) => (
                  <div key={`${c.symbol}-${idx}`} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/30">
                    <span className="font-mono font-bold text-white">{c.symbol}</span>
                    <span className="text-muted-foreground flex-1 px-2 truncate">{c.note}</span>
                    <Badge
                      className={cn(
                        'text-[9px]',
                        c.alignment === 'agrees' && 'bg-emerald-500/20 text-[var(--trade-bullish)]',
                        c.alignment === 'conflicts' && 'bg-red-500/20 text-[var(--trade-bearish)]',
                        c.alignment === 'no_signal' && 'bg-muted text-muted-foreground'
                      )}
                    >
                      {c.alignment === 'agrees' ? 'Agrees' : c.alignment === 'conflicts' ? 'Conflicts' : 'No signal'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top risks */}
          {result.deterministic.topRisks.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3 text-amber-400" /> Risks
              </h5>
              <ul className="space-y-1">
                {result.deterministic.topRisks.map((r, idx) => (
                  <li key={idx} className="text-xs text-foreground/70 flex items-start gap-2">
                    <span className="text-amber-400 mt-0.5">•</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggestions */}
          {result.aiSuggestions.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                <Lightbulb className="w-3 h-3 text-teal-400" /> Suggestions
              </h5>
              <ul className="space-y-1">
                {result.aiSuggestions.map((s, idx) => (
                  <li key={idx} className="text-xs text-foreground/70 flex items-start gap-2">
                    <span className="text-teal-400 mt-0.5">→</span> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={analyze.isPending}
            onClick={() => analyze.mutate()}
          >
            <RefreshCw className={cn('w-3 h-3 mr-2', analyze.isPending && 'animate-spin')} />
            Re-analyze
          </Button>
        </div>
      )}
    </div>
  );
}

// Portfolio Summary
function PortfolioSummary({ portfolio }: { portfolio: Portfolio }) {
  const [expanded, setExpanded] = useState(false);
  const plColor = portfolio.unrealizedPLPercent >= 0
    ? "text-[var(--trade-bullish)]"
    : "text-[var(--trade-bearish)]";

  const stockPositions = portfolio.positions.filter(p => !p.isOption);
  const optionPositions = portfolio.positions.filter(p => p.isOption);

  return (
    <Card className="bg-card/60 border-border/50 overflow-hidden">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <div className="p-4 cursor-pointer hover:bg-muted/40 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wallet className="w-5 h-5 text-teal-400" />
                <div>
                  <h3 className="font-semibold text-white">{portfolio.brokerName} Portfolio</h3>
                  <p className="text-xs text-muted-foreground">
                    {portfolio.positions.length} positions
                    {optionPositions.length > 0 && ` (${optionPositions.length} options)`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="font-mono text-lg text-white">
                    ${portfolio.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  <div className={cn("text-sm font-mono flex items-center gap-1 justify-end", plColor)}>
                    {portfolio.unrealizedPL >= 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {portfolio.unrealizedPL >= 0 ? '+' : ''}
                    ${Math.abs(portfolio.unrealizedPL).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    ({portfolio.unrealizedPLPercent >= 0 ? '+' : ''}{safeToFixed(portfolio.unrealizedPLPercent, 1)}%)
                  </div>
                </div>
                {expanded ? (
                  <ChevronUp className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-border p-4 space-y-4">
            {/* Stocks */}
            {stockPositions.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                  Stocks ({stockPositions.length})
                </h4>
                <div className="space-y-2">
                  {stockPositions.map((pos, idx) => (
                    <PositionRow key={`${pos.symbol}-${idx}`} position={pos} />
                  ))}
                </div>
              </div>
            )}

            {/* Options */}
            {optionPositions.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-purple-400 uppercase mb-2 flex items-center gap-2">
                  Options ({optionPositions.length})
                  {optionPositions.some(p => p.optionDetails && p.optionDetails.daysToExpiry <= 7) && (
                    <Badge className="bg-amber-500/20 text-[var(--trade-neutral)] text-[9px]">
                      <Clock className="w-3 h-3 mr-1" />
                      Expiring soon
                    </Badge>
                  )}
                </h4>
                <div className="space-y-2">
                  {optionPositions.map((pos, idx) => (
                    <PositionRow key={`${pos.symbol}-${idx}`} position={pos} />
                  ))}
                </div>
              </div>
            )}

            {/* AI insights + signal correlation */}
            <PortfolioInsights broker={portfolio.broker} />

            <div className="text-xs text-muted-foreground text-center">
              Last updated: {new Date(portfolio.lastUpdated).toLocaleString()}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// Main Broker Import Component
export default function BrokerImport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedBroker, setSelectedBroker] = useState<BrokerConfig | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Fetch supported brokers from backend
  const { data: supportedBrokers } = useQuery({
    queryKey: ['/api/broker/supported'],
    queryFn: async () => {
      const res = await fetch('/api/broker/supported');
      if (!res.ok) return BROKERS;
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch portfolio data for connected brokers
  const { data: portfolioData, isLoading: portfolioLoading, refetch: refetchPortfolio } = useQuery({
    queryKey: ['/api/broker/portfolio'],
    queryFn: async () => {
      // Try to get portfolio from each broker
      const portfolios: Portfolio[] = [];

      for (const broker of BROKERS) {
        try {
          const res = await fetch(`/api/broker/portfolio/${broker.type}`);
          if (res.ok) {
            const data = await res.json();
            if (data && data.positions && data.positions.length > 0) {
              portfolios.push(data);
            }
          }
        } catch (e) {
          // Broker not connected
        }
      }

      return portfolios;
    },
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // 5 minutes
  });

  const handleImport = (brokerType: BrokerType) => {
    const broker = BROKERS.find(b => b.type === brokerType);
    if (!broker) return;

    setSelectedBroker(broker);
    setImportDialogOpen(true);
  };

  const handleImportSuccess = () => {
    refetchPortfolio();
  };

  // Connected brokers
  const connectedBrokers = useMemo(() => {
    const connected = new Set<BrokerType>();
    portfolioData?.forEach(p => connected.add(p.broker));
    return connected;
  }, [portfolioData]);

  // Total portfolio value
  const totalValue = useMemo(() => {
    return portfolioData?.reduce((sum, p) => sum + p.totalValue, 0) || 0;
  }, [portfolioData]);

  const totalPL = useMemo(() => {
    return portfolioData?.reduce((sum, p) => sum + p.unrealizedPL, 0) || 0;
  }, [portfolioData]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-3">
            <Wallet className="w-6 h-6 text-teal-400" />
            Broker Connections
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Import positions from your brokers to track and analyze your portfolio
          </p>
        </div>
        {portfolioData && portfolioData.length > 0 && (
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Total Portfolio Value</div>
            <div className="text-2xl font-bold text-white font-mono">
              ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className={cn(
              "text-sm font-mono",
              totalPL >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
            )}>
              {totalPL >= 0 ? '+' : ''}${totalPL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
        )}
      </div>

      {/* Broker Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {BROKERS.map((broker) => (
          <BrokerCard
            key={broker.type}
            broker={broker}
            onImport={handleImport}
            isConnected={connectedBrokers.has(broker.type)}
            positionCount={
              portfolioData?.find(p => p.broker === broker.type)?.positions.length || 0
            }
          />
        ))}
      </div>

      {/* Connected Portfolios */}
      {portfolioData && portfolioData.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[var(--trade-bullish)]" />
            Your Portfolios
          </h3>
          {portfolioData.map((portfolio, idx) => (
            <PortfolioSummary key={`${portfolio.broker}-${idx}`} portfolio={portfolio} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {(!portfolioData || portfolioData.length === 0) && !portfolioLoading && (
        <Card className="bg-card/40 border-border/50 p-8 text-center">
          <Link2Off className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No Brokers Connected</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Connect your broker accounts to track positions, analyze performance, and get AI-powered insights on your portfolio.
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Info className="w-4 h-4" />
            <span>Your data is stored locally and never shared</span>
          </div>
        </Card>
      )}

      {/* CSV Import Dialog */}
      <CSVImportDialog
        broker={selectedBroker}
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}

// Export a compact version for use in sidebar/header
export function BrokerStatusBadge() {
  const { data: portfolioData } = useQuery({
    queryKey: ['/api/broker/portfolio'],
    queryFn: async () => {
      const portfolios: Portfolio[] = [];
      for (const broker of BROKERS) {
        try {
          const res = await fetch(`/api/broker/portfolio/${broker.type}`);
          if (res.ok) {
            const data = await res.json();
            if (data?.positions?.length > 0) {
              portfolios.push(data);
            }
          }
        } catch (e) {}
      }
      return portfolios;
    },
    staleTime: 60 * 1000,
  });

  const totalPositions = portfolioData?.reduce((sum, p) => sum + p.positions.length, 0) || 0;

  if (totalPositions === 0) return null;

  return (
    <Badge variant="outline" className="text-[var(--trade-bullish)] border-emerald-500/30">
      <Wallet className="w-3 h-3 mr-1" />
      {totalPositions} positions
    </Badge>
  );
}
