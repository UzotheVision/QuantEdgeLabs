import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, safeToFixed, safeNumber } from "@/lib/utils";
import { 
  Search, TrendingUp, TrendingDown, Activity, BarChart3, 
  Target, AlertTriangle, Loader2, RefreshCw
} from "lucide-react";
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineData, Time, CandlestickSeries, LineSeries } from "lightweight-charts";

interface PatternData {
  name: string;
  type: "bullish" | "bearish" | "neutral";
  strength: "strong" | "moderate" | "weak";
  detected: boolean;
}

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PatternResponse {
  symbol: string;
  currentPrice: number;
  priceChange: number;
  patterns: PatternData[];
  signalScore: {
    score: number;
    direction: "bullish" | "bearish" | "neutral";
    confidence: number;
    signals: string[];
  };
  indicators: {
    rsi: { value: number; period: number };
    rsi2: { value: number; period: number };
    macd: { macd: number; signal: number; histogram: number };
    bollingerBands: { upper: number; middle: number; lower: number };
    adx: { value: number; regime: string; suitableFor: string };
    stochRSI: { k: number; d: number } | null;
    ichimoku: { tenkan: number; kijun: number; senkouA: number; senkouB: number; chikou: number } | null;
  };
  dataPoints: number;
  candles: CandleData[];
  rsiSeries: Array<{ time: number; value: number }>;
  bbSeries: Array<{ time: number; upper: number; middle: number; lower: number }>;
}

function SignalBadge({ direction }: { direction: "bullish" | "bearish" | "neutral" }) {
  if (direction === "bullish") {
    return <Badge className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/30">Bullish</Badge>;
  }
  if (direction === "bearish") {
    return <Badge className="bg-red-500/10 text-[var(--trade-bearish)] border-red-500/30">Bearish</Badge>;
  }
  return <Badge className="bg-amber-500/10 text-[var(--trade-neutral)] border-amber-500/30">Neutral</Badge>;
}

function PatternBadge({ pattern }: { pattern: PatternData }) {
  const typeColors = {
    bullish: "bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/30",
    bearish: "bg-red-500/10 text-[var(--trade-bearish)] border-red-500/30",
    neutral: "bg-amber-500/10 text-[var(--trade-neutral)] border-amber-500/30",
  };
  
  return (
    <Badge className={cn("text-xs", typeColors[pattern.type])} data-testid={`badge-pattern-${pattern.name}`}>
      {pattern.name} ({pattern.strength})
    </Badge>
  );
}

export default function BacktestPage() {
  const [symbol, setSymbol] = useState("");
  const [searchSymbol, setSearchSymbol] = useState("");
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMiddleRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  
  const { data: patternData, isLoading, error, refetch } = useQuery<PatternResponse>({
    queryKey: ['/api/patterns', searchSymbol],
    enabled: !!searchSymbol,
  });
  
  const handleSearch = () => {
    if (symbol.trim()) {
      setSearchSymbol(symbol.trim().toUpperCase());
    }
  };
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };
  
  useEffect(() => {
    if (!chartContainerRef.current || !patternData?.candles?.length) return;
    
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: "#334155",
      },
      timeScale: {
        borderColor: "#334155",
        timeVisible: true,
        secondsVisible: false,
      },
    });
    
    chartRef.current = chart;
    
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    candleSeriesRef.current = candleSeries;
    
    const candleData: CandlestickData[] = patternData.candles
      .filter((c) => c && c.time != null)
      .map((c) => ({
        time: c.time as Time,
        open: safeNumber(c.open, 100),
        high: safeNumber(c.high, 100),
        low: safeNumber(c.low, 100),
        close: safeNumber(c.close, 100),
      }));
    if (candleData.length > 0) candleSeries.setData(candleData);
    
    if (patternData.bbSeries?.length) {
      const bbUpper = chart.addSeries(LineSeries, {
        color: "#60a5fa",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbUpperRef.current = bbUpper;
      
      const bbMiddle = chart.addSeries(LineSeries, {
        color: "#94a3b8",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbMiddleRef.current = bbMiddle;
      
      const bbLower = chart.addSeries(LineSeries, {
        color: "#60a5fa",
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      bbLowerRef.current = bbLower;
      
      const validBBData = patternData.bbSeries.filter((b) => b && b.time != null);
      const upperData: LineData[] = validBBData.map((b) => ({
        time: b.time as Time,
        value: safeNumber(b.upper, 100),
      }));
      const middleData: LineData[] = validBBData.map((b) => ({
        time: b.time as Time,
        value: safeNumber(b.middle, 100),
      }));
      const lowerData: LineData[] = validBBData.map((b) => ({
        time: b.time as Time,
        value: safeNumber(b.lower, 100),
      }));

      if (upperData.length > 0) bbUpper.setData(upperData);
      if (middleData.length > 0) bbMiddle.setData(middleData);
      if (lowerData.length > 0) bbLower.setData(lowerData);
    }
    
    
    chart.timeScale().fitContent();
    
    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    
    window.addEventListener("resize", handleResize);
    
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [patternData]);
  
  useEffect(() => {
    if (!rsiChartContainerRef.current || !patternData?.rsiSeries?.length) return;
    
    if (rsiChartRef.current) {
      rsiChartRef.current.remove();
      rsiChartRef.current = null;
    }
    
    const chart = createChart(rsiChartContainerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      width: rsiChartContainerRef.current.clientWidth,
      height: 120,
      rightPriceScale: {
        borderColor: "#334155",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#334155",
        visible: false,
      },
    });
    
    rsiChartRef.current = chart;
    
    const rsiSeries = chart.addSeries(LineSeries, {
      color: "#8b5cf6",
      lineWidth: 2,
      priceLineVisible: false,
    });
    rsiSeriesRef.current = rsiSeries;
    
    const overboughtLine = chart.addSeries(LineSeries, {
      color: "#ef4444",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    
    const oversoldLine = chart.addSeries(LineSeries, {
      color: "#22c55e",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    
    const rsiData: LineData[] = patternData.rsiSeries
      .filter((r) => r && r.time != null && r.value != null)
      .map((r) => ({
        time: r.time as Time,
        value: safeNumber(r.value, 50),
      }));
    if (rsiData.length > 0) rsiSeries.setData(rsiData);
    
    const firstTime = patternData.rsiSeries[0]?.time;
    const lastTime = patternData.rsiSeries[patternData.rsiSeries.length - 1]?.time;
    if (firstTime && lastTime) {
      overboughtLine.setData([
        { time: firstTime as Time, value: 70 },
        { time: lastTime as Time, value: 70 },
      ]);
      oversoldLine.setData([
        { time: firstTime as Time, value: 30 },
        { time: lastTime as Time, value: 30 },
      ]);
    }
    
    chart.timeScale().fitContent();
    
    const handleResize = () => {
      if (rsiChartContainerRef.current && chart) {
        chart.applyOptions({ width: rsiChartContainerRef.current.clientWidth });
      }
    };
    
    window.addEventListener("resize", handleResize);
    
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [patternData]);
  
  return (
    <div className="container mx-auto p-3 sm:p-4 space-y-3">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <BarChart3 className="h-4 w-4 text-purple-400" />
            </div>
            Pattern Scanner
          </h1>
          <p className="text-[10px] text-muted-foreground mt-1">
            Analyze technical patterns and indicators for any symbol
          </p>
        </div>
      </div>
      
      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Enter symbol (e.g., AAPL, TSLA, NVDA)"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                onKeyDown={handleKeyPress}
                className="pl-10 font-mono"
                data-testid="input-symbol"
              />
            </div>
            <Button
              onClick={handleSearch}
              disabled={!symbol.trim() || isLoading}
              className="bg-sky-500 hover:bg-sky-400 text-foreground"
              data-testid="button-analyze"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Activity className="h-4 w-4 mr-2" />
              )}
              Analyze
            </Button>
            {searchSymbol && (
              <Button
                variant="outline"
                onClick={() => refetch()}
                disabled={isLoading}
                className="border-border"
                data-testid="button-refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      
      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-[var(--trade-bearish)]" />
            <span className="text-[var(--trade-bearish)]">
              Failed to fetch data. Please check the symbol and try again.
            </span>
          </CardContent>
        </Card>
      )}
      
      {patternData && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="glass-card">
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  Symbol
                </p>
                <p className="text-xl font-bold font-mono" data-testid="text-symbol">
                  {patternData.symbol}
                </p>
              </CardContent>
            </Card>
            
            <Card className="glass-card">
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  Current Price
                </p>
                <p className="text-xl font-bold font-mono tabular-nums" data-testid="text-price">
                  ${safeToFixed(patternData.currentPrice, 2)}
                </p>
              </CardContent>
            </Card>
            
            <Card className="glass-card">
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  Change
                </p>
                <p className={cn(
                  "text-xl font-bold font-mono tabular-nums flex items-center gap-1",
                  patternData.priceChange >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                )} data-testid="text-change">
                  {patternData.priceChange >= 0 ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  {patternData.priceChange >= 0 ? "+" : ""}{safeToFixed(patternData.priceChange, 2)}%
                </p>
              </CardContent>
            </Card>
            
            <Card className="glass-card">
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  Signal
                </p>
                <div className="flex items-center gap-2" data-testid="text-signal">
                  <SignalBadge direction={patternData.signalScore.direction} />
                  <span className="text-lg font-bold font-mono tabular-nums">{patternData.signalScore.score}</span>
                </div>
              </CardContent>
            </Card>
          </div>
          
          <Card className="glass-card overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5 text-[var(--trade-bullish)]" />
                Price Chart with Bollinger Bands
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div ref={chartContainerRef} className="w-full" data-testid="chart-candlestick" />
            </CardContent>
          </Card>
          
          <Card className="glass-card overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-purple-400" />
                RSI (14)
                <Badge variant="outline" className="ml-2 font-mono tabular-nums" data-testid="badge-rsi-value">
                  {safeToFixed(patternData.indicators.rsi.value, 1)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div ref={rsiChartContainerRef} className="w-full" data-testid="chart-rsi" />
            </CardContent>
          </Card>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg">Detected Patterns</CardTitle>
              </CardHeader>
              <CardContent>
                {patternData.patterns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No patterns detected in recent candles</p>
                ) : (
                  <div className="flex flex-wrap gap-2" data-testid="patterns-list">
                    {patternData.patterns.map((pattern, i) => (
                      <PatternBadge key={i} pattern={pattern} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg">Signal Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2" data-testid="signals-list">
                  {patternData.signalScore.signals.map((signal, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {signal}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Technical Indicators</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Indicator</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow data-testid="row-rsi">
                    <TableCell className="font-medium">RSI (14)</TableCell>
                    <TableCell className="font-mono tabular-nums">{safeToFixed(patternData.indicators.rsi.value, 2)}</TableCell>
                    <TableCell>
                      {patternData.indicators.rsi.value < 30 ? (
                        <Badge className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/30">Oversold</Badge>
                      ) : patternData.indicators.rsi.value > 70 ? (
                        <Badge className="bg-red-500/10 text-[var(--trade-bearish)] border-red-500/30">Overbought</Badge>
                      ) : (
                        <Badge variant="outline">Neutral</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow data-testid="row-rsi2">
                    <TableCell className="font-medium">RSI (2)</TableCell>
                    <TableCell className="font-mono tabular-nums">{safeToFixed(patternData.indicators.rsi2.value, 2)}</TableCell>
                    <TableCell>
                      {patternData.indicators.rsi2.value < 10 ? (
                        <Badge className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/30">Extreme Oversold</Badge>
                      ) : patternData.indicators.rsi2.value > 90 ? (
                        <Badge className="bg-red-500/10 text-[var(--trade-bearish)] border-red-500/30">Extreme Overbought</Badge>
                      ) : (
                        <Badge variant="outline">Normal</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow data-testid="row-macd">
                    <TableCell className="font-medium">MACD</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {safeToFixed(patternData.indicators.macd.macd, 4)} / {safeToFixed(patternData.indicators.macd.signal, 4)}
                    </TableCell>
                    <TableCell>
                      {patternData.indicators.macd.histogram > 0 ? (
                        <Badge className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/30">Bullish</Badge>
                      ) : (
                        <Badge className="bg-red-500/10 text-[var(--trade-bearish)] border-red-500/30">Bearish</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow data-testid="row-bb">
                    <TableCell className="font-medium">Bollinger Bands</TableCell>
                    <TableCell className="font-mono tabular-nums text-xs">
                      U: ${safeToFixed(patternData.indicators.bollingerBands.upper, 2)} |
                      M: ${safeToFixed(patternData.indicators.bollingerBands.middle, 2)} |
                      L: ${safeToFixed(patternData.indicators.bollingerBands.lower, 2)}
                    </TableCell>
                    <TableCell>
                      {patternData.currentPrice < patternData.indicators.bollingerBands.lower ? (
                        <Badge className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/30">Below Lower</Badge>
                      ) : patternData.currentPrice > patternData.indicators.bollingerBands.upper ? (
                        <Badge className="bg-red-500/10 text-[var(--trade-bearish)] border-red-500/30">Above Upper</Badge>
                      ) : (
                        <Badge variant="outline">Within Bands</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow data-testid="row-adx">
                    <TableCell className="font-medium">ADX</TableCell>
                    <TableCell className="font-mono tabular-nums">{safeToFixed(patternData.indicators.adx.value, 2)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {patternData.indicators.adx.regime} ({patternData.indicators.adx.suitableFor.replace("_", " ")})
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {patternData.indicators.stochRSI && (
                    <TableRow data-testid="row-stochrsi">
                      <TableCell className="font-medium">Stochastic RSI</TableCell>
                      <TableCell className="font-mono tabular-nums">
                        K: {safeToFixed(patternData.indicators.stochRSI.k, 2)} / D: {safeToFixed(patternData.indicators.stochRSI.d, 2)}
                      </TableCell>
                      <TableCell>
                        {patternData.indicators.stochRSI.k < 20 ? (
                          <Badge className="bg-[var(--trade-bullish)]/10 text-[var(--trade-bullish)] border-green-500/30">Oversold</Badge>
                        ) : patternData.indicators.stochRSI.k > 80 ? (
                          <Badge className="bg-red-500/10 text-[var(--trade-bearish)] border-red-500/30">Overbought</Badge>
                        ) : (
                          <Badge variant="outline">Neutral</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Pattern Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Data Points Analyzed</TableCell>
                    <TableCell className="font-mono tabular-nums" data-testid="text-datapoints">
                      {patternData.dataPoints} candles
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Patterns Detected</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {patternData.patterns.length}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Signal Score</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {patternData.signalScore.score} ({patternData.signalScore.confidence}pts signal strength)
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Market Regime</TableCell>
                    <TableCell className="capitalize">
                      {patternData.indicators.adx.regime}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Strategy Recommendation</TableCell>
                    <TableCell className="capitalize">
                      {patternData.indicators.adx.suitableFor.replace("_", " ")}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      
      {!patternData && !isLoading && !error && (
        <Card className="glass-card">
          <CardContent className="p-12 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Enter a Symbol to Analyze</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Search for any stock symbol to view technical patterns, indicators, and signal analysis
              with interactive charts powered by TradingView.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
