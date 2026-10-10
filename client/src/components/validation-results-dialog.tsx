import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, Clock, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { safeToFixed } from "@/lib/utils";

interface ValidationResult {
  id: string;
  symbol: string;
  assetType: string;
  direction: string;
  entryPrice: number;
  currentPrice: number;
  targetPrice: number;
  stopLoss: number;
  wasUpdated: boolean;
  newStatus?: string;
  reasoning: string;
  percentToTarget: number;
  percentToStop: number;
  timestamp: string;
}

interface ValidationResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: ValidationResult[];
  totalValidated: number;
  totalUpdated: number;
}

export function ValidationResultsDialog({
  open,
  onOpenChange,
  results,
  totalValidated,
  totalUpdated,
}: ValidationResultsDialogProps) {
  const getStatusIcon = (result: ValidationResult) => {
    if (result.wasUpdated) {
      if (result.newStatus === 'hit_target') {
        return <CheckCircle2 className="w-5 h-5 text-[var(--trade-bullish)]" />;
      }
      if (result.newStatus === 'hit_stop') {
        return <XCircle className="w-5 h-5 text-[var(--trade-bearish)]" />;
      }
    }
    return <Clock className="w-5 h-5 text-muted-foreground" />;
  };

  const getStatusBadge = (result: ValidationResult) => {
    if (result.wasUpdated) {
      if (result.newStatus === 'hit_target') {
        return <Badge className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/20">CLOSED - HIT TARGET</Badge>;
      }
      if (result.newStatus === 'hit_stop') {
        return <Badge className="bg-red-500/10 text-[var(--trade-bearish)] border-red-500/20">CLOSED - HIT STOP</Badge>;
      }
    }
    return <Badge variant="outline">STILL OPEN</Badge>;
  };

  const getPriceColor = (result: ValidationResult) => {
    if (result.direction === 'long') {
      if (result.currentPrice >= result.targetPrice) return 'text-[var(--trade-bullish)]';
      if (result.currentPrice <= result.stopLoss) return 'text-[var(--trade-bearish)]';
    } else {
      if (result.currentPrice <= result.targetPrice) return 'text-[var(--trade-bullish)]';
      if (result.currentPrice >= result.stopLoss) return 'text-[var(--trade-bearish)]';
    }
    return 'text-foreground';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="text-2xl">Validation Results</DialogTitle>
          <DialogDescription>
            Checked {totalValidated} open research briefs. {totalUpdated > 0 
              ? `${totalUpdated} ${totalUpdated === 1 ? 'brief' : 'briefs'} closed based on price action.`
              : 'All briefs still active.'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-4">
            {results.map((result, index) => (
              <div key={result.id} className="glass-card rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(result)}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg">{result.symbol}</h3>
                        <Badge variant={result.direction === 'long' ? 'default' : 'destructive'}>
                          {result.direction === 'long' ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                          {result.direction.toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className="capitalize">{result.assetType}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Checked {new Date(result.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {getStatusBadge(result)}
                </div>

                <Separator />

                <div className="grid grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Entry Price</p>
                    <p className="text-sm font-medium">${safeToFixed(result.entryPrice, 2)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Current Price</p>
                    <p className={`text-sm font-bold ${getPriceColor(result)}`}>
                      ${safeToFixed(result.currentPrice, 2)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Target Price</p>
                    <p className="text-sm font-medium text-[var(--trade-bullish)]">${safeToFixed(result.targetPrice, 2)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Stop Loss</p>
                    <p className="text-sm font-medium text-[var(--trade-bearish)]">${safeToFixed(result.stopLoss, 2)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="glass-card p-2 rounded">
                    <p className="text-xs text-muted-foreground mb-1">Distance to Target</p>
                    <p className={`text-sm font-bold ${Math.abs(result.percentToTarget) < 1 ? 'text-[var(--trade-bullish)]' : 'text-foreground'}`}>
                      {result.percentToTarget > 0 ? '+' : ''}{safeToFixed(result.percentToTarget, 2)}%
                    </p>
                  </div>
                  <div className="glass-card p-2 rounded">
                    <p className="text-xs text-muted-foreground mb-1">Distance to Stop</p>
                    <p className={`text-sm font-bold ${Math.abs(result.percentToStop) < 1 ? 'text-[var(--trade-bearish)]' : 'text-foreground'}`}>
                      {result.percentToStop > 0 ? '+' : ''}{safeToFixed(result.percentToStop, 2)}%
                    </p>
                  </div>
                </div>

                <div className="glass-card p-3 rounded border-l-4 border-primary/30">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-primary mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-primary mb-1">Validation Logic</p>
                      <p className="text-sm text-muted-foreground">{result.reasoning}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {results.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No research briefs to validate</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
