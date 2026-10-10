import { useTier } from "@/hooks/useTier";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, Crown, Zap } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

type Feature = 
  | 'ai-engine'
  | 'quant-engine'
  | 'flow-scanner'
  | 'performance'
  | 'advanced-analytics'
  | 'export-data'
  | 'chart-analysis';

interface TierGateProps {
  feature: Feature;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  blur?: boolean;
}

const featureConfig: Record<Feature, { 
  name: string; 
  requiredTier: 'advanced' | 'pro';
  checkAccess: (limits: { canAccessAIEngine: boolean; canAccessQuantEngine: boolean; canAccessFlowScanner: boolean; canAccessPerformance: boolean; canAccessAdvancedAnalytics: boolean; canExportData: boolean }) => boolean;
}> = {
  'ai-engine': {
    name: 'AI Trade Engine',
    requiredTier: 'advanced',
    checkAccess: (l) => l.canAccessAIEngine,
  },
  'quant-engine': {
    name: 'Quantitative Engine',
    requiredTier: 'advanced',
    checkAccess: (l) => l.canAccessQuantEngine,
  },
  'flow-scanner': {
    name: 'Options Flow Scanner',
    requiredTier: 'pro',
    checkAccess: (l) => l.canAccessFlowScanner,
  },
  'performance': {
    name: 'Performance Analytics',
    requiredTier: 'advanced',
    checkAccess: (l) => l.canAccessPerformance,
  },
  'advanced-analytics': {
    name: 'Advanced Analytics',
    requiredTier: 'pro',
    checkAccess: (l) => l.canAccessAdvancedAnalytics,
  },
  'export-data': {
    name: 'Data Export',
    requiredTier: 'pro',
    checkAccess: (l) => l.canExportData,
  },
  'chart-analysis': {
    name: 'AI Chart Analysis',
    requiredTier: 'advanced',
    checkAccess: (l) => l.canAccessAIEngine,
  },
};

export function TierGate({ feature, children, fallback, blur = false }: TierGateProps) {
  const { limits, isAdmin, tier, isLoading } = useTier();
  const [, setLocation] = useLocation();
  
  const config = featureConfig[feature];
  
  // If we have a fallback, render it immediately while loading
  // This allows public content to show while tier data loads
  if (isLoading && fallback) {
    return <>{fallback}</>;
  }
  
  // CRITICAL: Don't show upgrade prompt while tier data is still loading
  // This prevents the "flash" where users see upgrade then admin features
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }
  
  const hasAccess = isAdmin || config.checkAccess(limits);

  if (hasAccess) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (blur) {
    return (
      <div className="relative">
        <div className="blur-sm pointer-events-none opacity-50">
          {children}
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <UpgradePrompt 
            feature={config.name} 
            requiredTier={config.requiredTier}
            onUpgrade={() => setLocation('/pricing')}
          />
        </div>
      </div>
    );
  }

  return (
    <LockedFeatureCard 
      feature={config.name} 
      requiredTier={config.requiredTier}
      currentTier={tier}
      onUpgrade={() => setLocation('/pricing')}
    />
  );
}

interface UpgradePromptProps {
  feature: string;
  requiredTier: 'advanced' | 'pro';
  onUpgrade: () => void;
}

function UpgradePrompt({ feature, requiredTier, onUpgrade }: UpgradePromptProps) {
  return (
    <Card className="w-full max-w-md bg-background/95 backdrop-blur">
      <CardContent className="flex flex-col items-center justify-center p-6 text-center">
        <Lock className="h-8 w-8 text-muted-foreground mb-3" />
        <h3 className="font-semibold mb-1">{feature} Locked</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Upgrade to {requiredTier === 'pro' ? 'Pro' : 'Advanced'} to unlock this feature
        </p>
        <Button onClick={onUpgrade} data-testid={`button-upgrade-${feature.toLowerCase().replace(/\s+/g, '-')}`}>
          {requiredTier === 'pro' ? <Crown className="h-4 w-4 mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
          Upgrade Now
        </Button>
      </CardContent>
    </Card>
  );
}

interface LockedFeatureCardProps {
  feature: string;
  requiredTier: 'advanced' | 'pro';
  currentTier: string;
  onUpgrade: () => void;
}

function LockedFeatureCard({ feature, requiredTier, currentTier, onUpgrade }: LockedFeatureCardProps) {
  const tierLabels: Record<string, string> = {
    free: 'Free',
    advanced: 'Advanced',
    pro: 'Pro',
  };

  return (
    <Card className="border-dashed">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 p-3 rounded-full bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>
        <CardTitle className="text-lg">{feature}</CardTitle>
        <CardDescription>
          This feature requires {requiredTier === 'pro' ? 'Pro' : 'Advanced'} tier or higher
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        <p className="text-sm text-muted-foreground mb-4">
          You're currently on the <span className="font-medium">{tierLabels[currentTier] || 'Free'}</span> plan
        </p>
        <Button onClick={onUpgrade} data-testid={`button-upgrade-${feature.toLowerCase().replace(/\s+/g, '-')}`}>
          {requiredTier === 'pro' ? <Crown className="h-4 w-4 mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
          Upgrade to {requiredTier === 'pro' ? 'Pro' : 'Advanced'}
        </Button>
      </CardContent>
    </Card>
  );
}

export function UsageBadge({ className }: { className?: string }) {
  const { tier, usage, limits, isAdmin, getRemainingIdeas } = useTier();
  
  if (isAdmin) {
    return (
      <div className={cn("flex items-center gap-1 text-xs", className)}>
        <Crown className="h-3 w-3 text-[var(--trade-neutral)]" />
        <span className="text-[var(--trade-neutral)] font-medium">Admin</span>
      </div>
    );
  }

  if (tier === 'pro') {
    return (
      <div className={cn("flex items-center gap-1 text-xs", className)}>
        <Crown className="h-3 w-3 text-purple-500" />
        <span className="text-purple-500 font-medium">Pro</span>
      </div>
    );
  }

  const remaining = getRemainingIdeas();
  const isUnlimited = remaining === 'unlimited';

  return (
    <div className={cn("flex items-center gap-1 text-xs", className)}>
      {tier === 'advanced' ? (
        <Zap className="h-3 w-3 text-sky-500" />
      ) : (
        <span className="text-muted-foreground">Free</span>
      )}
      {!isUnlimited && (
        <span className={cn(
          "font-medium",
          remaining === 0 ? "text-destructive" : "text-muted-foreground"
        )}>
          {remaining}/{limits.tradeIdeasPerDay} ideas left
        </span>
      )}
    </div>
  );
}
