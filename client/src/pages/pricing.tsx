import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Check, X, Crown, Zap, TrendingUp, Rocket, Clock, AlertTriangle, Loader2, FlaskConical } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { FloatingBubblesBackground } from "@/components/floating-bubbles-background";
import quantEdgeLogoUrl from "@assets/qe-mark.svg";

interface PlanFeature {
  name: string;
  included: boolean;
  comingSoon?: boolean;
}

interface PricingPlan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: PlanFeature[];
  icon: typeof Crown;
  popular?: boolean;
  currentPlan?: boolean;
  comingSoon?: boolean;
}

const plans: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    description: "Explore the research platform risk-free",
    monthlyPrice: 0,
    yearlyPrice: 0,
    icon: TrendingUp,
    currentPlan: true,
    features: [
      { name: "5 research briefs per day", included: true },
      { name: "Delayed market data (15min)", included: true },
      { name: "7-day performance history", included: true },
      { name: "Stocks & crypto only", included: true },
      { name: "3 watchlist items", included: true },
      { name: "Real-time market data", included: false },
      { name: "Chart analysis", included: false },
      { name: "Discord alerts", included: false },
      { name: "Advanced analytics", included: false },
    ],
  },
  {
    id: "advanced",
    name: "Advanced",
    description: "Full stock & crypto access for serious traders",
    monthlyPrice: 39,
    yearlyPrice: 349,
    icon: Zap,
    popular: true,
    features: [
      { name: "Unlimited research briefs", included: true },
      { name: "Real-time market data", included: true },
      { name: "Unlimited chart analyses", included: true },
      { name: "Unlimited AI generations", included: true },
      { name: "Full performance history", included: true },
      { name: "Discord alerts", included: true },
      { name: "Advanced analytics", included: true },
      { name: "Export data", included: true },
      { name: "50 watchlist items", included: true },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "For power users who need institutional-grade tools",
    monthlyPrice: 79,
    yearlyPrice: 699,
    icon: Rocket,
    comingSoon: true,
    features: [
      { name: "Everything in Advanced", included: true },
      { name: "Futures trading (NQ, ES, GC)", included: true, comingSoon: true },
      { name: "REST API access", included: true, comingSoon: true },
      { name: "White-label PDF reports", included: true, comingSoon: true },
      { name: "Pattern Scanner module", included: true, comingSoon: true },
      { name: "Custom webhooks (Slack, Telegram)", included: true, comingSoon: true },
      { name: "Portfolio correlation analytics", included: true, comingSoon: true },
      { name: "Priority idea generation", included: true, comingSoon: true },
      { name: "1-on-1 onboarding call", included: true, comingSoon: true },
      { name: "Private Discord channel", included: true, comingSoon: true },
    ],
  },
];

export default function Pricing() {
  const [isYearly, setIsYearly] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: userTier } = useQuery<{ tier: string; isAdmin?: boolean }>({
    queryKey: ['/api/user/tier'],
  });

  const checkoutMutation = useMutation({
    mutationFn: async (priceId: string) => {
      const response = await apiRequest('POST', '/api/billing/checkout', { priceId });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast({
        title: "Checkout Failed",
        description: error.message || "Unable to start checkout. Please try again.",
        variant: "destructive",
      });
      setCheckoutLoading(null);
    },
  });

  const handleUpgrade = (planId: string, priceIdMonthly?: string, priceIdYearly?: string) => {
    const priceId = isYearly ? priceIdYearly : priceIdMonthly;
    if (!priceId) {
      toast({
        title: "Not Available",
        description: "This plan is not yet available for purchase.",
        variant: "destructive",
      });
      return;
    }
    setCheckoutLoading(planId);
    checkoutMutation.mutate(priceId);
  };

  const formatPrice = (monthly: number, yearly: number) => {
    if (monthly === 0) return "$0";
    return isYearly ? `$${yearly}` : `$${monthly}`;
  };

  const getPeriod = (monthly: number) => {
    if (monthly === 0) return "/mo";
    return isYearly ? "/year" : "/mo";
  };

  const getYearlySavings = (monthly: number, yearly: number) => {
    if (monthly === 0) return null;
    const yearlyCost = monthly * 12;
    const savings = yearlyCost - yearly;
    const percent = Math.round((savings / yearlyCost) * 100);
    return percent;
  };

  const currentTier = userTier?.tier || 'free';

  return (
    <div className="min-h-screen bg-[var(--surface-base)] py-6 px-3 sm:px-4 lg:px-6">
      <SEOHead pageKey="pricing" />
      <FloatingBubblesBackground />
      
      {/* Header with Logo */}
      <div className="max-w-[1600px] mx-auto mb-4 relative z-10">
        <div className="flex items-center justify-center gap-3 mb-2">
          <Link href="/">
            <img src={quantEdgeLogoUrl} alt="Quant Edge Labs" className="h-12 w-12 object-contain drop-shadow-[0_0_15px_rgba(0,212,255,0.4)]" />
          </Link>
          <h2 className="text-xl font-bold text-foreground italic">
            Quant Edge Labs
          </h2>
        </div>
      </div>
      
      <div className="max-w-[1600px] mx-auto relative z-10">
        {/* Risk Acknowledgment */}
        <div className="max-w-3xl mx-auto mb-8" data-testid="risk-acknowledgment">
          <div className="glass-card rounded-xl p-4 border-l-2 border-l-amber-500">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-[var(--trade-neutral)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[var(--trade-neutral)] mb-1">
                  Research Platform Disclaimer
                </p>
                <p className="text-xs text-muted-foreground">
                  Quant Edge Labs provides educational trade research only—not financial advice. 
                  Past performance does not guarantee future results. You could lose your entire investment. 
                  We recommend paper trading to validate strategies before risking real capital.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Beta Access Banner */}
        <div className="max-w-3xl mx-auto mb-6" data-testid="banner-beta-access">
          <div className="glass-card rounded-xl p-4 border border-purple-500/30 bg-gradient-to-r from-purple-500/10 to-sky-500/10">
            <div className="flex items-center justify-center gap-3">
              <div className="h-8 w-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                <FlaskConical className="h-4 w-4 text-purple-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-purple-300">
                  Early Access Beta
                </p>
                <p className="text-xs text-muted-foreground">
                  You're getting exclusive early access to Quant Edge Labs. Some features are still in development.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Hero Header - Glassmorphism */}
        <div className="relative overflow-hidden rounded-xl bg-[#0a1525]/90 border border-white/10 backdrop-blur-xl p-6 sm:p-8 mb-12">
          <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 via-transparent to-sky-400/10" />
          <div className="relative z-10 text-center">
            <div className="flex items-center justify-center gap-2 mb-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">
                Research Platform
              </p>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30" data-testid="badge-beta">
                BETA
              </span>
            </div>
            <h1
              className="text-base sm:text-lg font-bold mb-2 text-foreground"
              data-testid="text-pricing-header"
            >
              Choose Your Plan
            </h1>
            <p
              className="text-xs text-muted-foreground max-w-2xl mx-auto leading-relaxed"
              data-testid="text-pricing-subtext"
            >
              Start with Free to explore the platform, then upgrade to Advanced for unlimited access and real-time data. Beta pricing - lock in these rates before launch.
            </p>
          </div>
        </div>

        {/* Annual Discount Banner */}
        {!isYearly && (
          <button
            onClick={() => setIsYearly(true)}
            className="w-full max-w-2xl mx-auto mb-6 p-3 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 hover:border-green-500/50 transition-colors cursor-pointer text-left"
            data-testid="banner-annual-discount"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-[var(--trade-bullish)]/20 flex items-center justify-center">
                  <Clock className="h-4 w-4 text-[var(--trade-bullish)]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--trade-bullish)]">
                    Save ~25% with annual billing
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Get 12 months for the price of 9. Click to switch to yearly.
                  </p>
                </div>
              </div>
              <span className="text-xs font-medium text-[var(--trade-bullish)] whitespace-nowrap">
                ~25% OFF
              </span>
            </div>
          </button>
        )}

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-4 mb-10">
          <span 
            className={`text-sm font-medium ${!isYearly ? 'text-foreground' : 'text-muted-foreground'}`}
            data-testid="text-monthly-label"
          >
            Monthly
          </span>
          <Switch
            checked={isYearly}
            onCheckedChange={setIsYearly}
            data-testid="switch-billing-toggle"
          />
          <span 
            className={`text-sm font-medium ${isYearly ? 'text-foreground' : 'text-muted-foreground'}`}
            data-testid="text-yearly-label"
          >
            Yearly
          </span>
          {isYearly && (
            <span className="glass-success rounded px-2 py-0.5 text-xs text-[var(--trade-bullish)]" data-testid="badge-yearly-savings">
              Save ~25%
            </span>
          )}
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 max-w-6xl mx-auto">
          {plans.map((plan) => {
            const Icon = plan.icon;
            const savings = getYearlySavings(plan.monthlyPrice, plan.yearlyPrice);
            
            return (
              <div 
                key={plan.id}
                className={`relative flex flex-col glass-card rounded-lg p-6 hover-elevate transition-all duration-200 ${
                  plan.popular 
                    ? 'border-l-2 border-l-cyan-500' 
                    : 'border border-border/50'
                }`}
                data-testid={`card-plan-${plan.id}`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span 
                      className="glass rounded px-3 py-1 text-xs font-medium text-sky-400 flex items-center gap-1"
                      data-testid="badge-most-popular"
                    >
                      <Crown className="w-3 h-3" />
                      Most Popular
                      <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/30 text-purple-300">
                        BETA
                      </span>
                    </span>
                  </div>
                )}
                {plan.comingSoon && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span 
                      className="glass-secondary rounded px-3 py-1 text-xs font-medium text-[var(--trade-neutral)] flex items-center gap-1"
                      data-testid="badge-coming-soon"
                    >
                      <Clock className="w-3 h-3" />
                      Coming Soon
                    </span>
                  </div>
                )}
                
                {/* Plan Header */}
                <div className="text-center pb-4 pt-2">
                  <div className={`mx-auto mb-3 h-12 w-12 rounded-lg flex items-center justify-center ${
                    plan.id === 'free' 
                      ? 'bg-gradient-to-br from-slate-500/20 to-slate-400/10' 
                      : plan.id === 'advanced'
                      ? 'bg-gradient-to-br from-sky-500/20 to-sky-400/10'
                      : 'bg-gradient-to-br from-purple-500/20 to-purple-400/10'
                  }`}>
                    <Icon className={`w-6 h-6 ${
                      plan.id === 'free' 
                        ? 'text-muted-foreground' 
                        : plan.id === 'advanced'
                        ? 'text-sky-400'
                        : 'text-purple-400'
                    }`} />
                  </div>
                  <h3 className={`text-xl font-semibold ${
                    plan.id === 'free' 
                      ? 'text-foreground' 
                      : plan.id === 'advanced'
                      ? 'text-sky-400'
                      : 'text-purple-400'
                  }`} data-testid={`text-plan-name-${plan.id}`}>
                    {plan.name}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1" data-testid={`text-plan-description-${plan.id}`}>
                    {plan.description}
                  </p>
                </div>
                
                {/* Pricing */}
                <div className="flex-1">
                  <div className="text-center mb-6">
                    <div className="flex items-baseline justify-center gap-1">
                      <span 
                        className="text-4xl font-bold font-mono tabular-nums text-foreground"
                        data-testid={`text-plan-price-${plan.id}`}
                      >
                        {formatPrice(plan.monthlyPrice, plan.yearlyPrice)}
                      </span>
                      <span className="text-muted-foreground text-sm font-mono">
                        {getPeriod(plan.monthlyPrice)}
                      </span>
                    </div>
                    {isYearly && savings && (
                      <p className="text-sm text-[var(--trade-bullish)] font-mono mt-1" data-testid={`text-savings-${plan.id}`}>
                        Save {savings}% vs monthly
                      </p>
                    )}
                  </div>
                  
                  {/* Features */}
                  <ul className="space-y-3">
                    {plan.features.map((feature, index) => (
                      <li 
                        key={index}
                        className="flex items-start gap-3 text-sm"
                        data-testid={`feature-${plan.id}-${index}`}
                      >
                        {feature.included ? (
                          <Check className="w-4 h-4 text-[var(--trade-bullish)] shrink-0 mt-0.5" />
                        ) : (
                          <X className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        )}
                        <span className={`flex items-center gap-2 ${feature.included ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {feature.name}
                          {feature.comingSoon && (
                            <span className="bg-amber-500/10 text-[var(--trade-neutral)] rounded px-1.5 py-0.5 text-[10px] font-medium">
                              Soon
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                
                {/* CTA Button */}
                <div className="pt-6">
                  {currentTier === plan.id ? (
                    <Button 
                      variant="glass-secondary" 
                      className="w-full" 
                      disabled
                      data-testid={`button-plan-${plan.id}`}
                    >
                      Current Plan
                    </Button>
                  ) : plan.id === 'free' ? (
                    <Link href="/">
                      <Button 
                        variant="glass-secondary"
                        className="w-full"
                        data-testid={`button-plan-${plan.id}`}
                      >
                        Join Waitlist
                      </Button>
                    </Link>
                  ) : plan.comingSoon ? (
                    <Button 
                      variant="glass-secondary"
                      className="w-full"
                      data-testid={`button-plan-${plan.id}`}
                    >
                      <Clock className="w-4 h-4 mr-2" />
                      Join Waitlist
                    </Button>
                  ) : (
                    <Button 
                      variant={plan.popular ? "glass" : "glass-secondary"}
                      className="w-full"
                      disabled={checkoutLoading === plan.id}
                      onClick={() => handleUpgrade(
                        plan.id,
                        plan.id === 'advanced' 
                          ? import.meta.env.VITE_STRIPE_PRICE_ADVANCED_MONTHLY 
                          : import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY,
                        plan.id === 'advanced' 
                          ? import.meta.env.VITE_STRIPE_PRICE_ADVANCED_YEARLY 
                          : import.meta.env.VITE_STRIPE_PRICE_PRO_YEARLY
                      )}
                      data-testid={`button-plan-${plan.id}`}
                    >
                      {checkoutLoading === plan.id ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Zap className="w-4 h-4 mr-2" />
                      )}
                      {checkoutLoading === plan.id ? 'Loading...' : `Upgrade to ${plan.name}`}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-12 text-center space-y-4">
          <p className="text-sm text-muted-foreground" data-testid="text-pricing-footer">
            All plans include access to our educational research platform. 
            Upgrade or downgrade at any time.
          </p>
          <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
            <span className="text-[var(--trade-bearish)] font-medium">NOT FINANCIAL ADVICE</span> • 
            Quant Edge Labs is for educational research purposes only. Trading involves substantial risk of loss.
          </p>
        </div>
      </div>
    </div>
  );
}
