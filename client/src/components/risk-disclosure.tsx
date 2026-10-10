import { AlertTriangle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface RiskDisclosureProps {
  variant?: 'full' | 'compact' | 'banner' | 'micro';
  engineVersion?: string;
  className?: string;
}

export function RiskDisclosure({ variant = 'compact', engineVersion, className = '' }: RiskDisclosureProps) {
  if (variant === 'micro') {
    return (
      <div 
        className={`flex items-center gap-1.5 text-[10px] text-amber-200/70 ${className}`}
        data-testid="risk-disclosure-micro"
      >
        <AlertTriangle className="h-3 w-3 text-[var(--trade-neutral)] flex-shrink-0" />
        <span>Educational research only. Not financial advice.</span>
      </div>
    );
  }

  if (variant === 'banner') {
    return (
      <div 
        className={`bg-amber-500/5 border-b border-amber-500/20 py-2 px-4 ${className}`}
        data-testid="risk-disclosure-banner"
      >
        <div className="container mx-auto flex items-center justify-center gap-2 text-xs text-amber-200/80">
          <AlertTriangle className="h-4 w-4 text-[var(--trade-neutral)] flex-shrink-0" />
          <span>
            <strong>Educational research only.</strong> Not financial advice. Past performance does not guarantee future results.
          </span>
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <Alert className={`border-amber-500/30 bg-amber-500/5 ${className}`} data-testid="alert-risk-disclosure">
        <AlertTriangle className="h-4 w-4 text-[var(--trade-neutral)]" />
        <AlertDescription className="text-sm">
          <strong className="font-semibold">Educational Research Only:</strong> Pattern analysis and market research for educational purposes.{' '}
          <span className="text-muted-foreground">NOT financial advice. YOU decide your own entries, exits, and risk. Past patterns do not guarantee future results.</span>
          {engineVersion && (
            <Badge variant="outline" className="ml-2 text-xs">
              Engine: {engineVersion}
            </Badge>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className={`border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent ${className}`} data-testid="card-risk-disclosure">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-[var(--trade-neutral)]" />
          Risk Disclosure & Legal Notice
          {engineVersion && (
            <Badge variant="outline" className="ml-auto">
              Model: {engineVersion}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-sky-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-foreground">Educational Research Platform</p>
              <p className="text-muted-foreground">
                Quant Edge Labs is a market research and pattern analysis platform for educational purposes only.
                Research briefs highlight technical patterns and key levels—YOU interpret the data and make your own trading decisions.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-[var(--trade-neutral)] mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-foreground">Not Financial Advice</p>
              <p className="text-muted-foreground">
                This platform does NOT provide personalized investment advice or trading recommendations.
                All research is for informational purposes. You are solely responsible for your own trading decisions.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-[var(--trade-bearish)] mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-foreground">Risk Warning</p>
              <p className="text-muted-foreground">
                Trading stocks, options, and cryptocurrencies involves substantial risk of loss and is not suitable for all investors.
                Past performance is not indicative of future results. You may lose some or all of your invested capital.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-sky-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-foreground">Model Limitations & Data Quality</p>
              <p className="text-muted-foreground">
                Quantitative models have inherent limitations and assumptions. Historical data may be incomplete or delayed.
                Technical indicators can produce false signals. No model can predict market movements with certainty.
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-3 mt-3">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Recommendation:</strong> Always conduct your own due diligence, understand the risks involved,
            and consult with a licensed financial advisor or investment professional before making any trading decisions.
            Use proper position sizing and risk management techniques appropriate for your situation.
          </p>
        </div>

        <div className="bg-muted/30 border border-border/50 rounded-lg p-3 text-xs text-muted-foreground">
          <p className="font-mono">
            <strong className="text-foreground">Model Governance:</strong> All research briefs are generated with full audit trails including
            engine version, ML weights snapshot, and generation timestamps for research integrity and model risk management compliance.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
