import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn, safeToFixed } from "@/lib/utils";
import { useStockContext } from "@/contexts/stock-context";
import { 
  Search, 
  TrendingUp, 
  TrendingDown, 
  Target, 
  AlertTriangle,
  Activity,
  BarChart3,
  Clock,
  DollarSign,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  RefreshCw,
  ChevronRight,
  Flame,
  Star,
  CircleDollarSign,
  Layers,
  Calculator,
  Gauge,
  TrendingUpIcon,
  Settings2,
  Plus,
  Minus,
  Info
} from "lucide-react";

interface OptionContract {
  symbol: string;
  strike: number;
  optionType: 'call' | 'put';
  expiration: string;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  openInterest: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  inTheMoney: boolean;
}

interface Expiration {
  date: string;
  dte: number;
}

interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  vanna: number;
  volga: number;
  charm: number;
  color: number;
  speed: number;
  zomma: number;
}

interface BlackScholesResult {
  theoreticalPrice: number;
  intrinsicValue: number;
  timeValue: number;
  greeks: Greeks;
  inputs: {
    spotPrice: number;
    strikePrice: number;
    timeToExpiry: number;
    volatility: number;
    optionType: string;
    riskFreeRate: number;
  };
}

interface VolatilitySurface {
  spotPrice: number;
  strikes: number[];
  expiries: number[];
  ivMatrix: number[][];
  timestamp: string;
}

interface SkewMetrics {
  putCallSkew: number;
  atmVolatility: number;
  skewSlope: number;
  termStructureSlope: number;
  butterflySpread: number;
}

interface IVAnalysis {
  currentIV: number;
  ivRank: number;
  ivPercentile: number;
  ivHigh52Week: number;
  ivLow52Week: number;
  ivMean: number;
  ivStdDev: number;
  ivTrend: 'rising' | 'falling' | 'neutral';
  expectedMove: number;
  expectedMovePercent: number;
}

interface StrategyLeg {
  optionType: 'call' | 'put';
  strike: number;
  expiry: string;
  quantity: number;
  premium: number;
}

interface StrategyPayoff {
  name: string;
  legs: StrategyLeg[];
  maxProfit: number | string;
  maxLoss: number | string;
  breakEvenPoints: number[];
  probabilityOfProfit: number;
  expectedValue: number;
  payoffCurve: Array<{ price: number; pnl: number }>;
  greeksAggregate: Greeks;
}

interface MonteCarloResult {
  theoreticalPrice: number;
  confidence95: [number, number];
  confidence99: [number, number];
  paths: number;
  executionTimeMs: number;
}

interface DeepAnalysis {
  symbol: string;
  optionSymbol: string;
  optionType: 'call' | 'put';
  strike: number;
  expiration: string;
  daysToExpiry: number;
  currentPrice: number;
  bid: number;
  ask: number;
  midPrice: number;
  lastPrice: number;
  greeks: {
    delta: number;
    deltaInterpretation: string;
    gamma: number;
    gammaRisk: string;
    theta: number;
    thetaImpact: string;
    vega: number;
    vegaExposure: string;
  };
  iv: {
    currentIV: number;
    ivRank: number;
    ivPercentile: number;
    ivTrend: string;
    ivInterpretation: string;
    premiumAssessment: string;
    expectedMove: number;
    expectedMovePercent: number;
  };
  technical: {
    currentPrice: number;
    trend: string;
    trendStrength: number;
    support: number[];
    resistance: number[];
    atr: number;
    atrPercent: number;
    distanceToStrike: number;
    distanceToStrikePercent: number;
    breakEvenPrice: number;
    breakEvenMove: number;
  };
  volume: {
    optionVolume: number;
    openInterest: number;
    volumeOIRatio: number;
    unusualActivity: boolean;
    bidAskSpread: number;
    spreadPercent: number;
    liquidityScore: number;
    liquidityGrade: string;
  };
  probability: {
    probabilityOfProfit: number;
    probabilityITM: number;
    probabilityOTM: number;
    maxProfit: number;
    maxLoss: number;
    riskRewardRatio: number;
    breakEvenPrice: number;
    expectedValue: number;
  };
  scenarios: {
    bullCase: { price: number; pnl: number; pnlPercent: number };
    baseCase: { price: number; pnl: number; pnlPercent: number };
    bearCase: { price: number; pnl: number; pnlPercent: number };
    targetPrices: {
      doubler: number;
      tripler: number;
      fiveBagger: number;
      tenBagger: number;
    };
    priceLadder: Array<{
      price: number;
      priceChange: number;
      priceChangePercent: number;
      optionValue: number;
      pnl: number;
      pnlPercent: number;
      probability: number;
      label: string;
    }>;
    riskMetrics: {
      daysToBurn50Percent: number;
      priceFor50PercentLoss: number;
      safeExitPrice: number;
    };
  };
  overallScore: number;
  overallGrade: string;
  verdict: string;
  keyRisks: string[];
  keyEdges: string[];
  recommendation: string;
}

export default function OptionsAnalyzer() {
  const { toast } = useToast();
  const searchParams = useSearch();
  const { currentStock, setCurrentStock } = useStockContext();

  // Initialize from stock context or URL params
  const initialSymbol = new URLSearchParams(searchParams).get('symbol') || currentStock?.symbol || "";

  const [symbol, setSymbol] = useState(initialSymbol);
  const [searchedSymbol, setSearchedSymbol] = useState(initialSymbol);
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);
  const [optionTypeFilter, setOptionTypeFilter] = useState<'all' | 'call' | 'put'>('all');
  const [selectedOption, setSelectedOption] = useState<OptionContract | null>(null);
  const [analysisResult, setAnalysisResult] = useState<DeepAnalysis | null>(null);
  const [activeTab, setActiveTab] = useState<'chain' | 'surface' | 'pricing' | 'strategy'>('chain');

  // Update when stock context changes
  useEffect(() => {
    if (currentStock?.symbol && currentStock.symbol !== searchedSymbol) {
      setSymbol(currentStock.symbol);
      setSearchedSymbol(currentStock.symbol);
    }
  }, [currentStock]);
  
  const [pricingInputs, setPricingInputs] = useState({
    spotPrice: 100,
    strikePrice: 100,
    timeToExpiry: 30,
    volatility: 30,
    optionType: 'call' as 'call' | 'put',
    riskFreeRate: 5
  });
  
  const [strategyLegs, setStrategyLegs] = useState<StrategyLeg[]>([]);

  const handleSearch = () => {
    if (!symbol.trim()) {
      toast({ title: "Enter a ticker symbol", variant: "destructive" });
      return;
    }
    const upperSymbol = symbol.toUpperCase();
    setSearchedSymbol(upperSymbol);
    setSelectedExpiration(null);
    setSelectedOption(null);
    setAnalysisResult(null);

    // Update stock context
    setCurrentStock({ symbol: upperSymbol });
  };

  const { data: expirationsData, isLoading: loadingExpirations, isError: expirationsError } = useQuery<{ symbol: string; expirations: Expiration[] }>({
    queryKey: ['/api/options-analyzer/expirations', searchedSymbol],
    enabled: !!searchedSymbol,
  });

  interface ChainResponse {
    symbol: string;
    stockPrice: number;
    stockChange: number;
    stockChangePercent: number;
    chain: OptionContract[];
  }
  
  const { data: chainData, isLoading: loadingChain, isError: chainError } = useQuery<ChainResponse>({
    queryKey: ['/api/options-analyzer/chain', searchedSymbol, selectedExpiration],
    queryFn: async () => {
      const url = selectedExpiration 
        ? `/api/options-analyzer/chain/${searchedSymbol}?expiration=${selectedExpiration}`
        : `/api/options-analyzer/chain/${searchedSymbol}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    enabled: !!searchedSymbol,
    retry: 1,
  });

  const deepAnalysisMutation = useMutation({
    mutationFn: async (option: OptionContract) => {
      const res = await apiRequest('POST', '/api/options-analyzer/deep-analysis', {
        symbol: searchedSymbol,
        strike: option.strike,
        expiration: option.expiration,
        optionType: option.optionType
      });
      return res.json();
    },
    onSuccess: (data) => {
      setAnalysisResult(data.analysis);
      toast({ title: "Analysis Complete", description: `Deep analysis for ${data.analysis.optionSymbol}` });
    },
    onError: () => {
      toast({ title: "Analysis Failed", variant: "destructive" });
    }
  });

  const { data: volSurfaceData, isLoading: loadingVolSurface, isError: volSurfaceError, refetch: refetchVolSurface } = useQuery<{
    symbol: string;
    spotPrice: number;
    surface: VolatilitySurface;
    skew: SkewMetrics;
  }>({
    queryKey: ['/api/options-quant/surface', searchedSymbol],
    queryFn: async () => {
      const res = await apiRequest('POST', '/api/options-quant/surface', { symbol: searchedSymbol });
      return res.json();
    },
    enabled: !!searchedSymbol && activeTab === 'surface',
    retry: 1,
  });

  const blackScholesMutation = useMutation({
    mutationFn: async (inputs: typeof pricingInputs) => {
      const res = await apiRequest('POST', '/api/options-quant/price', {
        spotPrice: inputs.spotPrice,
        strikePrice: inputs.strikePrice,
        timeToExpiry: inputs.timeToExpiry / 365,
        volatility: inputs.volatility / 100,
        optionType: inputs.optionType,
        riskFreeRate: inputs.riskFreeRate / 100
      });
      return res.json() as Promise<BlackScholesResult>;
    }
  });

  const monteCarloMutation = useMutation({
    mutationFn: async (inputs: typeof pricingInputs) => {
      const res = await apiRequest('POST', '/api/options-quant/monte-carlo', {
        spotPrice: inputs.spotPrice,
        strikePrice: inputs.strikePrice,
        timeToExpiry: inputs.timeToExpiry / 365,
        volatility: inputs.volatility / 100,
        optionType: inputs.optionType,
        riskFreeRate: inputs.riskFreeRate / 100,
        numPaths: 10000
      });
      return res.json();
    }
  });

  const strategyMutation = useMutation({
    mutationFn: async (params: { legs: StrategyLeg[], spotPrice: number }) => {
      const res = await apiRequest('POST', '/api/options-quant/strategy', {
        legs: params.legs,
        spotPrice: params.spotPrice,
        volatility: 0.3
      });
      return res.json() as Promise<StrategyPayoff>;
    }
  });

  const runPricing = () => {
    blackScholesMutation.mutate(pricingInputs);
    monteCarloMutation.mutate(pricingInputs);
  };

  const addStrategyLeg = (optionType: 'call' | 'put', quantity: number) => {
    if (!chainData?.stockPrice) return;
    const newLeg: StrategyLeg = {
      optionType,
      strike: chainData.stockPrice,
      expiry: selectedExpiration || new Date().toISOString().split('T')[0],
      quantity,
      premium: 1.00
    };
    setStrategyLegs([...strategyLegs, newLeg]);
  };

  const removeStrategyLeg = (index: number) => {
    setStrategyLegs(strategyLegs.filter((_, i) => i !== index));
  };

  const analyzeStrategy = () => {
    if (!chainData?.stockPrice || strategyLegs.length === 0) return;
    strategyMutation.mutate({ legs: strategyLegs, spotPrice: chainData.stockPrice });
  };

  const handleAnalyzeOption = (option: OptionContract) => {
    setSelectedOption(option);
    deepAnalysisMutation.mutate(option);
  };

  const filteredChain = chainData?.chain?.filter((opt: OptionContract) => {
    if (optionTypeFilter === 'all') return true;
    return opt.optionType === optionTypeFilter;
  }) || [];

  const calls = filteredChain.filter((opt: OptionContract) => opt.optionType === 'call');
  const puts = filteredChain.filter((opt: OptionContract) => opt.optionType === 'put');

  const getVerdictColor = (verdict: string) => {
    switch (verdict) {
      case 'STRONG_BUY': return 'bg-[var(--trade-bullish)]/20 text-[var(--trade-bullish)] border-green-500/30';
      case 'BUY': return 'bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/20';
      case 'HOLD': return 'bg-amber-500/10 text-[var(--trade-neutral)] border-amber-500/20';
      case 'AVOID': return 'bg-red-500/10 text-[var(--trade-bearish)] border-red-500/20';
      case 'STRONG_AVOID': return 'bg-red-500/20 text-[var(--trade-bearish)] border-red-500/30';
      default: return 'bg-muted/10 text-muted-foreground';
    }
  };

  const getGradeColor = (grade: string) => {
    if (grade.startsWith('A')) return 'text-[var(--trade-bullish)]';
    if (grade.startsWith('B')) return 'text-[var(--trade-bullish)]';
    if (grade.startsWith('C')) return 'text-[var(--trade-neutral)]';
    if (grade.startsWith('D')) return 'text-orange-400';
    return 'text-[var(--trade-bearish)]';
  };

  return (
    <div className="min-h-screen bg-background page-atmosphere">
      <div className="max-w-[1600px] mx-auto p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-base font-bold flex items-center gap-2" data-testid="text-page-title">
              <Activity className="h-4 w-4 text-[var(--trade-bullish)]" />
              Options Analyzer
            </h1>
            <p className="text-[10px] text-muted-foreground">Chains, greeks, vol surface, pricing</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
          <TabsList className="grid w-full max-w-lg grid-cols-4 mb-3">
            <TabsTrigger value="chain" className="flex items-center gap-1 text-[10px] font-mono" data-testid="tab-chain">
              <Layers className="h-3 w-3" />
              Chain
            </TabsTrigger>
            <TabsTrigger value="surface" className="flex items-center gap-1 text-[10px] font-mono" data-testid="tab-surface">
              <BarChart3 className="h-3 w-3" />
              Vol Surf
            </TabsTrigger>
            <TabsTrigger value="pricing" className="flex items-center gap-1 text-[10px] font-mono" data-testid="tab-pricing">
              <Calculator className="h-3 w-3" />
              Pricing
            </TabsTrigger>
            <TabsTrigger value="strategy" className="flex items-center gap-1 text-[10px] font-mono" data-testid="tab-strategy">
              <Settings2 className="h-3 w-3" />
              Strategy
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chain" className="mt-0">

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Enter ticker symbol (e.g., SPY, AAPL, NVDA)"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="pl-10"
                  data-testid="input-symbol"
                />
              </div>
              <Button onClick={handleSearch} disabled={loadingExpirations} data-testid="button-search">
                {loadingExpirations ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </Button>
            </div>

            {expirationsData?.expirations && (
              <div className="mt-4 flex flex-wrap gap-2 items-center">
                <span className="text-sm text-muted-foreground">Expirations:</span>
                <ScrollArea className="flex-1">
                  <div className="flex gap-2 pb-2">
                    {(expirationsData.expirations as Expiration[]).slice(0, 12).map((exp) => (
                      <Button
                        key={exp.date}
                        variant={selectedExpiration === exp.date ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedExpiration(exp.date)}
                        className="shrink-0"
                        data-testid={`button-expiration-${exp.date}`}
                      >
                        {exp.date} ({exp.dte}d)
                      </Button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </CardContent>
        </Card>

        {searchedSymbol && loadingChain && !chainData && !chainError && (
          <Card>
            <CardContent className="p-12 text-center">
              <Loader2 className="h-12 w-12 mx-auto text-[var(--trade-bullish)] animate-spin mb-4" />
              <p className="text-muted-foreground">Loading options chain for {searchedSymbol}...</p>
            </CardContent>
          </Card>
        )}

        {searchedSymbol && (expirationsError || chainError) && !loadingChain && (
          <Card>
            <CardContent className="p-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto text-[var(--trade-neutral)] mb-4" />
              <h3 className="font-semibold text-lg mb-2">Data Temporarily Unavailable</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                Options data for {searchedSymbol} couldn't be loaded. This is usually due to market data provider rate limits.
              </p>
              <Button variant="outline" onClick={() => setSearchedSymbol(searchedSymbol)} data-testid="button-retry">
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {searchedSymbol && chainData && chainData.stockPrice && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-lg">{searchedSymbol}</CardTitle>
                      <span className="text-2xl font-bold font-mono" data-testid="text-stock-price">
                        ${safeToFixed(chainData.stockPrice, 2)}
                      </span>
                      <Badge variant={chainData.stockChange >= 0 ? "default" : "destructive"} className={cn(
                        "text-xs",
                        chainData.stockChange >= 0 ? "bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)]" : "bg-red-500/10 text-[var(--trade-bearish)]"
                      )}>
                        {chainData.stockChange >= 0 ? <ArrowUpRight className="h-3 w-3 mr-1" /> : <ArrowDownRight className="h-3 w-3 mr-1" />}
                        {safeToFixed(chainData.stockChangePercent, 2)}%
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={optionTypeFilter} onValueChange={(v) => setOptionTypeFilter(v as any)}>
                        <SelectTrigger className="w-[100px]" data-testid="select-option-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="call">Calls</SelectItem>
                          <SelectItem value="put">Puts</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => setSearchedSymbol(searchedSymbol)}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {loadingChain ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <Tabs defaultValue="calls" className="w-full">
                      <TabsList className="w-full justify-start px-4 bg-transparent border-b rounded-none">
                        <TabsTrigger value="calls" className="data-[state=active]:bg-[var(--trade-bullish)]/10">
                          <TrendingUp className="h-4 w-4 mr-1 text-[var(--trade-bullish)]" />
                          Calls ({calls.length})
                        </TabsTrigger>
                        <TabsTrigger value="puts" className="data-[state=active]:bg-red-500/10">
                          <TrendingDown className="h-4 w-4 mr-1 text-[var(--trade-bearish)]" />
                          Puts ({puts.length})
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="calls" className="m-0">
                        <OptionsChainTable 
                          options={calls} 
                          stockPrice={chainData.stockPrice}
                          onAnalyze={handleAnalyzeOption}
                          selectedOption={selectedOption}
                          isAnalyzing={deepAnalysisMutation.isPending}
                        />
                      </TabsContent>
                      <TabsContent value="puts" className="m-0">
                        <OptionsChainTable 
                          options={puts} 
                          stockPrice={chainData.stockPrice}
                          onAnalyze={handleAnalyzeOption}
                          selectedOption={selectedOption}
                          isAnalyzing={deepAnalysisMutation.isPending}
                        />
                      </TabsContent>
                    </Tabs>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              {analysisResult ? (
                <DeepAnalysisPanel analysis={analysisResult} />
              ) : (
                <Card>
                  <CardContent className="p-8 text-center">
                    <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">Select an Option</h3>
                    <p className="text-sm text-muted-foreground">
                      Click "Analyze" on any option to see deep analysis including Greeks, IV metrics, price scenarios, and risk/reward scoring.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {!searchedSymbol && (
          <Card>
            <CardContent className="p-12 text-center">
              <Activity className="h-16 w-16 mx-auto text-[var(--trade-bullish)]/50 mb-6" />
              <h2 className="text-xl font-semibold mb-3">Enter a Symbol to Start</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Search for any optionable stock to view the options chain, run deep analysis on specific strikes, 
                and see price ladder scenarios with 2x, 3x, 5x, and 10x target prices.
              </p>
            </CardContent>
          </Card>
        )}
          </TabsContent>

          <TabsContent value="surface" className="mt-0">
            {volSurfaceError ? (
              <Card>
                <CardContent className="p-12 text-center">
                  <AlertTriangle className="h-12 w-12 mx-auto text-[var(--trade-neutral)] mb-4" />
                  <h3 className="font-semibold text-lg mb-2">Volatility Surface Unavailable</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                    Unable to calculate volatility surface. Try searching for a symbol with active options chains.
                  </p>
                  <Button variant="outline" onClick={() => refetchVolSurface()} data-testid="button-retry-vol">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <VolatilitySurfacePanel
                symbol={searchedSymbol}
                data={volSurfaceData}
                isLoading={loadingVolSurface}
                onRefresh={() => refetchVolSurface()}
              />
            )}
          </TabsContent>

          <TabsContent value="pricing" className="mt-0">
            <PricingLabPanel
              inputs={pricingInputs}
              setInputs={setPricingInputs}
              bsResult={blackScholesMutation.data}
              mcResult={monteCarloMutation.data}
              isLoading={blackScholesMutation.isPending || monteCarloMutation.isPending}
              onCalculate={runPricing}
              stockPrice={chainData?.stockPrice}
            />
          </TabsContent>

          <TabsContent value="strategy" className="mt-0">
            <StrategyLabPanel
              legs={strategyLegs}
              stockPrice={chainData?.stockPrice || 100}
              onAddLeg={addStrategyLeg}
              onRemoveLeg={removeStrategyLeg}
              onUpdateLeg={(idx, leg) => {
                const newLegs = [...strategyLegs];
                newLegs[idx] = leg;
                setStrategyLegs(newLegs);
              }}
              strategyResult={strategyMutation.data}
              isLoading={strategyMutation.isPending}
              onAnalyze={analyzeStrategy}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function OptionsChainTable({ 
  options, 
  stockPrice, 
  onAnalyze, 
  selectedOption,
  isAnalyzing
}: { 
  options: OptionContract[];
  stockPrice: number;
  onAnalyze: (opt: OptionContract) => void;
  selectedOption: OptionContract | null;
  isAnalyzing: boolean;
}) {
  if (options.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No options for this expiry — try another date
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card border-b">
          <tr className="text-left text-muted-foreground">
            <th className="p-2">Strike</th>
            <th className="p-2 text-right">Bid</th>
            <th className="p-2 text-right">Ask</th>
            <th className="p-2 text-right">Last</th>
            <th className="p-2 text-right">Vol</th>
            <th className="p-2 text-right">OI</th>
            <th className="p-2 text-right">Delta</th>
            <th className="p-2 text-right">IV</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {options.map((opt, idx) => {
            const isSelected = selectedOption?.symbol === opt.symbol;
            const isITM = opt.inTheMoney;
            const isATM = Math.abs(opt.strike - stockPrice) / stockPrice < 0.02;
            
            return (
              <tr 
                key={opt.symbol || idx}
                className={cn(
                  "border-b border-border/50 hover-elevate cursor-pointer",
                  isSelected && "bg-emerald-500/10",
                  isITM && "bg-muted/30",
                  isATM && "bg-amber-500/5 border-l-2 border-l-amber-500"
                )}
                onClick={() => onAnalyze(opt)}
                data-testid={`row-option-${opt.strike}-${opt.optionType}`}
              >
                <td className="p-2 font-mono font-medium">
                  <div className="flex items-center gap-2">
                    ${safeToFixed(opt.strike, 2)}
                    {isATM && <Badge variant="secondary" className="text-[9px] py-0">ATM</Badge>}
                    {isITM && <Badge variant="secondary" className="text-[9px] py-0 bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)]">ITM</Badge>}
                  </div>
                </td>
                <td className="p-2 text-right font-mono">${safeToFixed(opt.bid, 2)}</td>
                <td className="p-2 text-right font-mono">${safeToFixed(opt.ask, 2)}</td>
                <td className="p-2 text-right font-mono">${safeToFixed(opt.last, 2)}</td>
                <td className="p-2 text-right font-mono">{opt.volume.toLocaleString()}</td>
                <td className="p-2 text-right font-mono">{opt.openInterest.toLocaleString()}</td>
                <td className="p-2 text-right font-mono">
                  <span className={opt.delta > 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"}>
                    {safeToFixed(opt.delta, 2)}
                  </span>
                </td>
                <td className="p-2 text-right font-mono">{safeToFixed(opt.iv, 1)}%</td>
                <td className="p-2">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    disabled={isAnalyzing && isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAnalyze(opt);
                    }}
                    data-testid={`button-analyze-${opt.strike}`}
                  >
                    {isAnalyzing && isSelected ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>Analyze <ChevronRight className="h-4 w-4 ml-1" /></>
                    )}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollArea>
  );
}

function DeepAnalysisPanel({ analysis }: { analysis: DeepAnalysis }) {
  return (
    <div className="space-y-4">
      <Card className="border-l-4 border-l-cyan-500">
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-mono">{analysis.optionSymbol}</CardTitle>
              <p className="text-sm text-muted-foreground">
                ${analysis.strike} {analysis.optionType.toUpperCase()} • {analysis.daysToExpiry} DTE
              </p>
            </div>
            <Badge className={cn("text-sm", getVerdictBadgeColor(analysis.verdict))}>
              {analysis.verdict.replace(/_/g, ' ')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className={cn("text-3xl font-bold", getGradeTextColor(analysis.overallGrade))} data-testid="text-overall-grade">
                {analysis.overallGrade}
              </div>
              <p className="text-xs text-muted-foreground">Grade</p>
            </div>
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-1">
                <span>Score</span>
                <span className="font-mono">{analysis.overallScore}/100</span>
              </div>
              <Progress value={analysis.overallScore} className="h-2" />
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">Mid Price</p>
              <p className="text-lg font-bold font-mono tabular-nums">${safeToFixed(analysis.midPrice, 2)}</p>
              <p className="text-xs text-muted-foreground">${safeToFixed(analysis.midPrice * 100, 0)} / contract</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">Break Even</p>
              <p className="text-lg font-bold font-mono tabular-nums">${safeToFixed(analysis.probability.breakEvenPrice, 2)}</p>
              <p className="text-xs text-muted-foreground">
                {analysis.technical.breakEvenMove > 0 ? '+' : ''}{safeToFixed(analysis.technical.breakEvenMove, 1)}% move
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--trade-bullish)]" />
            Greeks
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Delta</span>
                <span className="font-mono">{safeToFixed(analysis.greeks.delta, 3)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{analysis.greeks.deltaInterpretation}</p>
            </div>
            <div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Gamma</span>
                <span className="font-mono">{safeToFixed(analysis.greeks.gamma, 4)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{analysis.greeks.gammaRisk}</p>
            </div>
            <div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Theta</span>
                <span className="font-mono text-[var(--trade-bearish)]">{safeToFixed(analysis.greeks.theta, 3)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{analysis.greeks.thetaImpact}</p>
            </div>
            <div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vega</span>
                <span className="font-mono">{safeToFixed(analysis.greeks.vega, 3)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{analysis.greeks.vegaExposure}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-purple-500" />
            IV Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Current IV</span>
            <span className="font-mono font-medium">{safeToFixed(analysis.iv.currentIV, 1)}%</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">IV Rank</span>
            <div className="flex items-center gap-2">
              <Progress value={analysis.iv.ivRank} className="w-20 h-2" />
              <span className="font-mono">{safeToFixed(analysis.iv.ivRank, 0)}%</span>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Premium</span>
            <Badge variant="secondary" className={cn(
              "text-xs",
              analysis.iv.premiumAssessment === 'cheap' && "bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)]",
              analysis.iv.premiumAssessment === 'fair' && "bg-amber-500/10 text-[var(--trade-neutral)]",
              analysis.iv.premiumAssessment === 'expensive' && "bg-orange-500/10 text-orange-500",
              analysis.iv.premiumAssessment === 'extreme' && "bg-red-500/10 text-[var(--trade-bearish)]",
            )}>
              {analysis.iv.premiumAssessment.toUpperCase()}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{analysis.iv.ivInterpretation}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4 text-[var(--trade-bullish)]" />
            Price Ladder (Bagger Targets)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="space-y-2">
            <div className="flex items-center justify-between p-2 rounded bg-[var(--trade-bullish)]/10">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-[var(--trade-bullish)]" />
                <span className="text-sm font-medium">2x (Doubler)</span>
              </div>
              <span className="font-mono font-bold text-[var(--trade-bullish)]" data-testid="text-target-2x">
                ${safeToFixed(analysis.scenarios.targetPrices.doubler, 2)}
              </span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-emerald-500/10">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-[var(--trade-bullish)]" />
                <span className="text-sm font-medium">3x (Tripler)</span>
              </div>
              <span className="font-mono font-bold text-[var(--trade-bullish)]" data-testid="text-target-3x">
                ${safeToFixed(analysis.scenarios.targetPrices.tripler, 2)}
              </span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-purple-500/10">
              <div className="flex items-center gap-2">
                <CircleDollarSign className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium">5x (Five Bagger)</span>
              </div>
              <span className="font-mono font-bold text-purple-500" data-testid="text-target-5x">
                ${safeToFixed(analysis.scenarios.targetPrices.fiveBagger, 2)}
              </span>
            </div>
            <div className="flex items-center justify-between p-2 rounded bg-amber-500/10">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-[var(--trade-neutral)]" />
                <span className="text-sm font-medium">10x (Ten Bagger)</span>
              </div>
              <span className="font-mono font-bold text-[var(--trade-neutral)]" data-testid="text-target-10x">
                ${safeToFixed(analysis.scenarios.targetPrices.tenBagger, 2)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[var(--trade-neutral)]" />
            Risk Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 rounded bg-[var(--trade-bullish)]/10">
              <p className="text-xs text-muted-foreground">Max Profit</p>
              <p className="font-mono text-[var(--trade-bullish)]">${safeToFixed(analysis.probability.maxProfit, 0)}</p>
            </div>
            <div className="p-2 rounded bg-red-500/10">
              <p className="text-xs text-muted-foreground">Max Loss</p>
              <p className="font-mono text-[var(--trade-bearish)]">${safeToFixed(analysis.probability.maxLoss, 0)}</p>
            </div>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Prob. of Profit</span>
            <span className="font-mono">{safeToFixed(analysis.probability.probabilityOfProfit, 1)}%</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">R:R Ratio</span>
            <span className="font-mono">{safeToFixed(analysis.probability.riskRewardRatio, 2)}:1</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Days to 50% Decay</span>
            <span className="font-mono">{analysis.scenarios.riskMetrics.daysToBurn50Percent}d</span>
          </div>
        </CardContent>
      </Card>

      {(analysis.keyEdges.length > 0 || analysis.keyRisks.length > 0) && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {analysis.keyEdges.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-[var(--trade-bullish)] mb-2 flex items-center gap-1">
                  <ArrowUpRight className="h-4 w-4" />
                  Edges
                </h4>
                <ul className="text-xs space-y-1">
                  {analysis.keyEdges.map((edge, i) => (
                    <li key={i} className="text-muted-foreground">• {edge}</li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.keyRisks.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-[var(--trade-bearish)] mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  Risks
                </h4>
                <ul className="text-xs space-y-1">
                  {analysis.keyRisks.map((risk, i) => (
                    <li key={i} className="text-muted-foreground">• {risk}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <p className="text-sm">{analysis.recommendation}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function getVerdictBadgeColor(verdict: string): string {
  switch (verdict) {
    case 'STRONG_BUY': return 'bg-[var(--trade-bullish)]/20 text-[var(--trade-bullish)] border-green-500/30';
    case 'BUY': return 'bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/20';
    case 'HOLD': return 'bg-amber-500/10 text-[var(--trade-neutral)] border-amber-500/20';
    case 'AVOID': return 'bg-red-500/10 text-[var(--trade-bearish)] border-red-500/20';
    case 'STRONG_AVOID': return 'bg-red-500/20 text-[var(--trade-bearish)] border-red-500/30';
    default: return 'bg-muted/10 text-muted-foreground';
  }
}

function getGradeTextColor(grade: string): string {
  if (grade.startsWith('A')) return 'text-[var(--trade-bullish)]';
  if (grade.startsWith('B')) return 'text-[var(--trade-bullish)]';
  if (grade.startsWith('C')) return 'text-[var(--trade-neutral)]';
  if (grade.startsWith('D')) return 'text-orange-400';
  return 'text-[var(--trade-bearish)]';
}

function VolatilitySurfacePanel({
  symbol,
  data,
  isLoading,
  onRefresh
}: {
  symbol: string;
  data?: { symbol: string; spotPrice: number; surface: VolatilitySurface; skew: SkewMetrics };
  isLoading: boolean;
  onRefresh: () => void;
}) {
  if (!symbol) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <BarChart3 className="h-16 w-16 mx-auto text-muted-foreground mb-6" />
          <h2 className="text-xl font-semibold mb-3">Enter a Symbol First</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Search for a symbol in the Options Chain tab to view its volatility surface.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Loader2 className="h-12 w-12 mx-auto text-[var(--trade-bullish)] animate-spin mb-4" />
          <p className="text-muted-foreground">Loading volatility surface for {symbol}...</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-[var(--trade-neutral)] mb-4" />
          <p className="text-muted-foreground">Failed to load volatility surface. Please try again.</p>
          <Button onClick={onRefresh} className="mt-4" data-testid="button-retry-surface">
            <RefreshCw className="h-4 w-4 mr-2" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { surface, skew, spotPrice } = data;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-[var(--trade-bullish)]" />
                Volatility Surface - {symbol}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={onRefresh} data-testid="button-refresh-surface">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <div className="bg-muted/30 rounded-lg p-4">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <h4 className="text-sm font-medium mb-3 text-muted-foreground">IV by Strike (Near-Term Expiry)</h4>
                  <div className="h-40 flex items-end justify-around gap-1">
                    {surface.strikes.slice(0, 20).map((strike, idx) => {
                      const iv = surface.ivMatrix[0]?.[idx] || 0;
                      const normalizedIv = Math.min(100, iv * 100);
                      const isAtm = Math.abs(strike - spotPrice) < spotPrice * 0.02;
                      return (
                        <Tooltip key={strike}>
                          <TooltipTrigger asChild>
                            <div 
                              className={cn(
                                "w-full rounded-t transition-all hover:opacity-80",
                                isAtm ? "bg-[var(--trade-neutral)]" : strike < spotPrice ? "bg-red-500/70" : "bg-[var(--trade-bullish)]/70"
                              )}
                              style={{ height: `${normalizedIv}%` }}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-mono text-xs">
                              ${safeToFixed(strike, 0)} | IV: {safeToFixed(iv * 100, 1)}%
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-2">
                    <span>OTM Puts</span>
                    <span>ATM</span>
                    <span>OTM Calls</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="h-4 w-4 text-purple-500" />
              Term Structure
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-2">
              {surface.expiries.slice(0, 6).map((exp, idx) => {
                const atmIdx = Math.floor(surface.strikes.length / 2);
                const iv = surface.ivMatrix[idx]?.[atmIdx] || 0;
                return (
                  <div key={exp} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-16">{exp}d</span>
                    <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-emerald-500 to-purple-500 rounded-full"
                        style={{ width: `${Math.min(100, iv * 100)}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs w-12 text-right">{safeToFixed(iv * 100, 1)}%</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="border-l-4 border-l-purple-500">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Skew Metrics</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">ATM Volatility</span>
              <span className="font-mono font-medium">{safeToFixed(skew.atmVolatility * 100, 1)}%</span>
            </div>
            <Separator />
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Put/Call Skew</span>
              <Badge variant={skew.putCallSkew > 0 ? "destructive" : "default"} className="font-mono">
                {skew.putCallSkew > 0 ? '+' : ''}{safeToFixed(skew.putCallSkew, 2)} pts
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Skew Slope</span>
              <span className="font-mono text-sm">{safeToFixed(skew.skewSlope, 3)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Term Slope</span>
              <Badge variant={skew.termStructureSlope > 0 ? "default" : "secondary"} className="font-mono">
                {skew.termStructureSlope > 0 ? '+' : ''}{safeToFixed(skew.termStructureSlope, 2)} pts
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Butterfly</span>
              <span className="font-mono text-sm">{safeToFixed(skew.butterflySpread, 2)} pts</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-[var(--trade-bullish)] shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Interpreting Skew</p>
                <p>Positive put/call skew indicates demand for downside protection (bearish sentiment). Steep term structure suggests near-term uncertainty.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PricingLabPanel({
  inputs,
  setInputs,
  bsResult,
  mcResult,
  isLoading,
  onCalculate,
  stockPrice
}: {
  inputs: { spotPrice: number; strikePrice: number; timeToExpiry: number; volatility: number; optionType: 'call' | 'put'; riskFreeRate: number };
  setInputs: (inputs: any) => void;
  bsResult?: BlackScholesResult;
  mcResult?: { monteCarlo: MonteCarloResult; blackScholes: number; difference: number; differencePercent: number };
  isLoading: boolean;
  onCalculate: () => void;
  stockPrice?: number;
}) {
  const updateInput = (field: string, value: number | string) => {
    setInputs({ ...inputs, [field]: value });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calculator className="h-5 w-5 text-[var(--trade-bullish)]" />
            Black-Scholes Pricing
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Spot Price ($)</label>
              <Input
                type="number"
                value={inputs.spotPrice}
                onChange={(e) => updateInput('spotPrice', parseFloat(e.target.value) || 0)}
                className="mt-1"
                data-testid="input-spot-price"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Strike Price ($)</label>
              <Input
                type="number"
                value={inputs.strikePrice}
                onChange={(e) => updateInput('strikePrice', parseFloat(e.target.value) || 0)}
                className="mt-1"
                data-testid="input-strike-price"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Days to Expiry</label>
              <Input
                type="number"
                value={inputs.timeToExpiry}
                onChange={(e) => updateInput('timeToExpiry', parseFloat(e.target.value) || 1)}
                className="mt-1"
                data-testid="input-dte"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Volatility (%)</label>
              <Input
                type="number"
                value={inputs.volatility}
                onChange={(e) => updateInput('volatility', parseFloat(e.target.value) || 1)}
                className="mt-1"
                data-testid="input-volatility"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Option Type</label>
              <Select value={inputs.optionType} onValueChange={(v) => updateInput('optionType', v)}>
                <SelectTrigger className="mt-1" data-testid="select-option-type-pricing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="put">Put</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Risk-Free Rate (%)</label>
              <Input
                type="number"
                value={inputs.riskFreeRate}
                onChange={(e) => updateInput('riskFreeRate', parseFloat(e.target.value) || 0)}
                className="mt-1"
                data-testid="input-risk-free"
              />
            </div>
          </div>

          {stockPrice && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setInputs({ ...inputs, spotPrice: stockPrice, strikePrice: stockPrice })}
              data-testid="button-use-current-price"
            >
              Use Current Price (${safeToFixed(stockPrice, 2)})
            </Button>
          )}

          <Button onClick={onCalculate} disabled={isLoading} className="w-full" data-testid="button-calculate-price">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Calculator className="h-4 w-4 mr-2" />}
            Calculate Prices
          </Button>
        </CardContent>
      </Card>

      {bsResult && (
        <div className="space-y-4">
          <Card className="border-l-4 border-l-cyan-500">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Theoretical Price</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-3xl font-bold font-mono text-[var(--trade-bullish)]" data-testid="text-bs-price">
                ${safeToFixed(bsResult.theoreticalPrice, 4)}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Intrinsic</span>
                  <span className="font-mono ml-2">${safeToFixed(bsResult.intrinsicValue, 2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Time Value</span>
                  <span className="font-mono ml-2">${safeToFixed(bsResult.timeValue, 2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-purple-500" />
                Full Greeks (1st & 2nd Order)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-2 rounded bg-muted/30">
                  <span className="text-muted-foreground block text-xs">Delta (Δ)</span>
                  <span className="font-mono font-medium">{safeToFixed(bsResult.greeks.delta, 4)}</span>
                </div>
                <div className="p-2 rounded bg-muted/30">
                  <span className="text-muted-foreground block text-xs">Gamma (Γ)</span>
                  <span className="font-mono font-medium">{safeToFixed(bsResult.greeks.gamma, 6)}</span>
                </div>
                <div className="p-2 rounded bg-muted/30">
                  <span className="text-muted-foreground block text-xs">Theta (Θ)/day</span>
                  <span className="font-mono font-medium text-[var(--trade-bearish)]">{safeToFixed(bsResult.greeks.theta, 4)}</span>
                </div>
                <div className="p-2 rounded bg-muted/30">
                  <span className="text-muted-foreground block text-xs">Vega (ν)/1%</span>
                  <span className="font-mono font-medium">{safeToFixed(bsResult.greeks.vega, 4)}</span>
                </div>
                <div className="p-2 rounded bg-muted/30">
                  <span className="text-muted-foreground block text-xs">Rho (ρ)/1%</span>
                  <span className="font-mono font-medium">{safeToFixed(bsResult.greeks.rho, 4)}</span>
                </div>
                <div className="p-2 rounded bg-muted/30">
                  <span className="text-muted-foreground block text-xs">Vanna</span>
                  <span className="font-mono font-medium">{safeToFixed(bsResult.greeks.vanna, 6)}</span>
                </div>
                <div className="p-2 rounded bg-muted/30">
                  <span className="text-muted-foreground block text-xs">Volga (Vomma)</span>
                  <span className="font-mono font-medium">{safeToFixed(bsResult.greeks.volga, 6)}</span>
                </div>
                <div className="p-2 rounded bg-muted/30">
                  <span className="text-muted-foreground block text-xs">Charm</span>
                  <span className="font-mono font-medium">{safeToFixed(bsResult.greeks.charm, 6)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {mcResult && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-[var(--trade-neutral)]" />
                  Monte Carlo Comparison ({mcResult.monteCarlo.paths.toLocaleString()} paths)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">MC Price</span>
                  <span className="font-mono font-medium">${safeToFixed(mcResult.monteCarlo.theoreticalPrice, 4)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">95% CI</span>
                  <span className="font-mono text-xs">
                    [${safeToFixed(mcResult.monteCarlo.confidence95[0], 2)}, ${safeToFixed(mcResult.monteCarlo.confidence95[1], 2)}]
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">BS vs MC Diff</span>
                  <Badge variant="secondary" className="font-mono">
                    {safeToFixed(mcResult.differencePercent, 2)}%
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Execution</span>
                  <span className="font-mono text-xs">{mcResult.monteCarlo.executionTimeMs}ms</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function StrategyLabPanel({
  legs,
  stockPrice,
  onAddLeg,
  onRemoveLeg,
  onUpdateLeg,
  strategyResult,
  isLoading,
  onAnalyze
}: {
  legs: StrategyLeg[];
  stockPrice: number;
  onAddLeg: (optionType: 'call' | 'put', quantity: number) => void;
  onRemoveLeg: (index: number) => void;
  onUpdateLeg: (index: number, leg: StrategyLeg) => void;
  strategyResult?: StrategyPayoff;
  isLoading: boolean;
  onAnalyze: () => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-purple-500" />
            Strategy Builder
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onAddLeg('call', 1)} data-testid="button-add-long-call">
              <Plus className="h-3 w-3 mr-1" /> Long Call
            </Button>
            <Button variant="outline" size="sm" onClick={() => onAddLeg('put', 1)} data-testid="button-add-long-put">
              <Plus className="h-3 w-3 mr-1" /> Long Put
            </Button>
            <Button variant="outline" size="sm" onClick={() => onAddLeg('call', -1)} data-testid="button-add-short-call">
              <Minus className="h-3 w-3 mr-1" /> Short Call
            </Button>
            <Button variant="outline" size="sm" onClick={() => onAddLeg('put', -1)} data-testid="button-add-short-put">
              <Minus className="h-3 w-3 mr-1" /> Short Put
            </Button>
          </div>

          {legs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Settings2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Add option legs to build your strategy</p>
              <p className="text-xs mt-1">Support for spreads, straddles, condors, and more</p>
            </div>
          ) : (
            <div className="space-y-2">
              {legs.map((leg, idx) => (
                <div key={idx} className="flex items-center gap-2 p-2 rounded bg-muted/30">
                  <Badge variant={leg.quantity > 0 ? "default" : "destructive"} className="shrink-0">
                    {leg.quantity > 0 ? 'LONG' : 'SHORT'}
                  </Badge>
                  <span className="text-sm font-medium capitalize">{leg.optionType}</span>
                  <Input
                    type="number"
                    value={leg.strike}
                    onChange={(e) => onUpdateLeg(idx, { ...leg, strike: parseFloat(e.target.value) || stockPrice })}
                    className="w-20 h-8 text-xs"
                    data-testid={`input-leg-strike-${idx}`}
                  />
                  <span className="text-xs text-muted-foreground">strike</span>
                  <Input
                    type="number"
                    value={leg.premium}
                    onChange={(e) => onUpdateLeg(idx, { ...leg, premium: parseFloat(e.target.value) || 0 })}
                    className="w-16 h-8 text-xs"
                    data-testid={`input-leg-premium-${idx}`}
                  />
                  <span className="text-xs text-muted-foreground">prem</span>
                  <Button variant="ghost" size="sm" className="ml-auto h-6 w-6 p-0" onClick={() => onRemoveLeg(idx)} data-testid={`button-remove-leg-${idx}`}>
                    <Minus className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {legs.length > 0 && (
            <Button onClick={onAnalyze} disabled={isLoading} className="w-full" data-testid="button-analyze-strategy">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <BarChart3 className="h-4 w-4 mr-2" />}
              Analyze Strategy
            </Button>
          )}
        </CardContent>
      </Card>

      {strategyResult && (
        <div className="space-y-4">
          <Card className="border-l-4 border-l-purple-500">
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{strategyResult.name}</CardTitle>
                <Badge variant="secondary">{strategyResult.legs.length} legs</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 rounded bg-[var(--trade-bullish)]/10">
                  <p className="text-xs text-muted-foreground">Max Profit</p>
                  <p className="font-mono font-bold text-[var(--trade-bullish)]" data-testid="text-strategy-max-profit">
                    {typeof strategyResult.maxProfit === 'number' ? `$${safeToFixed(strategyResult.maxProfit, 0)}` : strategyResult.maxProfit}
                  </p>
                </div>
                <div className="p-3 rounded bg-red-500/10">
                  <p className="text-xs text-muted-foreground">Max Loss</p>
                  <p className="font-mono font-bold text-[var(--trade-bearish)]" data-testid="text-strategy-max-loss">
                    {typeof strategyResult.maxLoss === 'number' ? `$${safeToFixed(strategyResult.maxLoss, 0)}` : strategyResult.maxLoss}
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Prob. of Profit</span>
                  <span className="font-mono">{safeToFixed(strategyResult.probabilityOfProfit, 1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expected Value</span>
                  <span className="font-mono">${safeToFixed(strategyResult.expectedValue, 2)}</span>
                </div>
                {strategyResult.breakEvenPoints.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Breakeven</span>
                    <span className="font-mono text-xs">
                      {strategyResult.breakEvenPoints.map(b => `$${safeToFixed(b, 2)}`).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Payoff Diagram</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="h-40 flex items-center justify-around gap-0.5">
                {strategyResult.payoffCurve.slice(0, 40).map((point, idx) => {
                  const maxPnl = Math.max(...strategyResult.payoffCurve.map(p => Math.abs(p.pnl)));
                  const normalizedHeight = Math.abs(point.pnl) / (maxPnl || 1) * 70;
                  const isPositive = point.pnl >= 0;
                  return (
                    <Tooltip key={idx}>
                      <TooltipTrigger asChild>
                        <div 
                          className={cn(
                            "w-full transition-all",
                            isPositive ? "bg-[var(--trade-bullish)]" : "bg-[var(--trade-bearish)]",
                            isPositive ? "self-end" : "self-start"
                          )}
                          style={{ 
                            height: `${normalizedHeight}%`,
                            marginTop: isPositive ? 'auto' : 0,
                            marginBottom: isPositive ? 0 : 'auto',
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-mono text-xs">
                          ${safeToFixed(point.price, 0)} → {point.pnl >= 0 ? '+' : ''}${safeToFixed(point.pnl, 0)}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                <span>${safeToFixed(stockPrice * 0.8, 0)}</span>
                <span>${safeToFixed(stockPrice, 0)} (current)</span>
                <span>${safeToFixed(stockPrice * 1.2, 0)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Aggregate Greeks
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="text-center p-2 rounded bg-muted/30">
                  <span className="text-xs text-muted-foreground block">Delta</span>
                  <span className="font-mono">{safeToFixed(strategyResult.greeksAggregate.delta, 3)}</span>
                </div>
                <div className="text-center p-2 rounded bg-muted/30">
                  <span className="text-xs text-muted-foreground block">Gamma</span>
                  <span className="font-mono">{safeToFixed(strategyResult.greeksAggregate.gamma, 4)}</span>
                </div>
                <div className="text-center p-2 rounded bg-muted/30">
                  <span className="text-xs text-muted-foreground block">Theta</span>
                  <span className="font-mono text-[var(--trade-bearish)]">{safeToFixed(strategyResult.greeksAggregate.theta, 3)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}


