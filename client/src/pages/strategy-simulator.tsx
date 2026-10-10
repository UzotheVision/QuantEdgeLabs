/**
 * STRATEGY SIMULATOR PAGE
 * =======================
 * Backtests the convergence engine against historical price data.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────┐
 *   │  CONFIG PANEL: symbols, threshold, target, stop      │
 *   ├──────────────────────────────────────────────────────┤
 *   │  AGGREGATE: Win Rate, Expectancy, Total Trades       │
 *   ├──────────────────────────────────────────────────────┤
 *   │  PER-SYMBOL TABLE (sortable)                         │
 *   ├──────────────────────────────────────────────────────┤
 *   │  TRADE-BY-TRADE LOG (selectable symbol)              │
 *   └──────────────────────────────────────────────────────┘
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { componentStyles } from '@/lib/design-tokens';

interface SimulatedTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  scoreAtEntry: number;
  exitDate: string;
  exitPrice: number;
  exitReason: 'T1_HIT' | 'STOP_HIT' | 'TIME_EXPIRED';
  pnlPct: number;
  daysHeld: number;
}

interface SimulationResult {
  symbol: string;
  scannedBars: number;
  signalsTriggered: number;
  trades: SimulatedTrade[];
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  expectancy: number;
  maxDrawdown: number;
  totalReturnPct: number;
}

interface BacktestResponse {
  config: any;
  results: SimulationResult[];
  aggregate: {
    totalSymbols: number;
    totalTrades: number;
    overallWinRate: number;
    avgExpectancy: number;
    bestSymbol: string | null;
    worstSymbol: string | null;
  };
}

const PRESET_BASKETS = {
  'Khawatmi Wins': 'AEHR,SYNA,GNRC,TXN,INTC,QCOM,ARM',
  'Recent Setups': 'NOK,BB,MP,QRVO,CSCO,SOUN',
  'Mega Cap': 'NVDA,AMD,AVGO,MSFT,META,GOOGL,AAPL,AMZN',
  'Recovery Plays': 'SMCI,PLTR,COIN,RIVN,SNAP,HIMS',
  'Custom': ''
};

export default function StrategySimulatorPage() {
  const [symbolsInput, setSymbolsInput] = useState('NOK,BB,MP,QCOM,ARM,AEHR,SOUN,RGTI,HUT,BE');
  const [scoreThreshold, setScoreThreshold] = useState(70);
  const [targetPct, setTargetPct] = useState(10);
  const [stopPct, setStopPct] = useState(-8);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [preset, setPreset] = useState('Custom');

  const mutation = useMutation<BacktestResponse>({
    mutationFn: async () => {
      const symbols = symbolsInput.split(',').map(s => s.trim()).filter(Boolean);
      const res = await fetch('/api/strategy-simulator/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, scoreThreshold, targetPct, stopPct, holdMaxDays: 30 })
      });
      if (!res.ok) throw new Error('Backtest failed');
      return res.json();
    }
  });

  const data = mutation.data;
  const selectedResult = data?.results.find(r => r.symbol === selectedSymbol);

  const applyPreset = (name: string) => {
    setPreset(name);
    if (name !== 'Custom') {
      setSymbolsInput(PRESET_BASKETS[name as keyof typeof PRESET_BASKETS]);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">🔬 Strategy Simulator</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Backtest the convergence engine against 2 years of historical price data.
          </p>
        </div>

        {/* Config */}
        <div className={`${componentStyles.card.default} p-4 mb-6`}>
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">Configuration</h2>

          {/* Preset baskets */}
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.keys(PRESET_BASKETS).map(name => (
              <button
                key={name}
                onClick={() => applyPreset(name)}
                className={`text-xs px-3 py-1.5 rounded border ${
                  preset === name
                    ? 'bg-[var(--brand-cyan)]/20 border-[var(--brand-cyan)]/40 text-[var(--brand-cyan)]'
                    : 'bg-muted border-border text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {name}
              </button>
            ))}
          </div>

          {/* Symbols input */}
          <div className="mb-4">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Symbols (comma-separated)</label>
            <input
              type="text"
              value={symbolsInput}
              onChange={(e) => { setSymbolsInput(e.target.value); setPreset('Custom'); }}
              className={`${componentStyles.input.compact} w-full mt-1`}
              placeholder="NOK, QCOM, AEHR, ..."
            />
          </div>

          {/* Sliders */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Score Threshold: <span className="text-[var(--brand-cyan)] font-bold">{scoreThreshold}</span>
              </label>
              <input
                type="range"
                min={50}
                max={90}
                value={scoreThreshold}
                onChange={(e) => setScoreThreshold(Number(e.target.value))}
                className="w-full mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Target: <span className="text-[var(--trade-bullish)] font-bold">+{targetPct}%</span>
              </label>
              <input
                type="range"
                min={3}
                max={30}
                value={targetPct}
                onChange={(e) => setTargetPct(Number(e.target.value))}
                className="w-full mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Stop: <span className="text-[var(--trade-bearish)] font-bold">{stopPct}%</span>
              </label>
              <input
                type="range"
                min={-25}
                max={-3}
                value={stopPct}
                onChange={(e) => setStopPct(Number(e.target.value))}
                className="w-full mt-1"
              />
            </div>
          </div>

          {/* Run */}
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="mt-4 px-6 py-2.5 bg-[var(--brand-cyan)]/10 border border-[var(--brand-cyan)]/40 text-[var(--brand-cyan)] rounded font-bold hover:bg-[var(--brand-cyan)]/20 disabled:opacity-50"
          >
            {mutation.isPending ? '🔬 Running backtest...' : '▶ Run Backtest'}
          </button>
        </div>

        {/* Aggregate */}
        {data && (
          <>
            <div className={`${componentStyles.card.default} p-4 mb-6`}>
              <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">Aggregate Results</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <KPI label="Symbols" value={data.aggregate.totalSymbols.toString()} accent="cyan" />
                <KPI label="Total Trades" value={data.aggregate.totalTrades.toString()} accent="cyan" />
                <KPI
                  label="Win Rate"
                  value={`${data.aggregate.overallWinRate}%`}
                  accent={data.aggregate.overallWinRate >= 55 ? 'emerald' : data.aggregate.overallWinRate >= 45 ? 'amber' : 'red'}
                />
                <KPI
                  label="Expectancy"
                  value={`${data.aggregate.avgExpectancy >= 0 ? '+' : ''}${data.aggregate.avgExpectancy}%`}
                  sub="per trade"
                  accent={data.aggregate.avgExpectancy >= 0 ? 'emerald' : 'red'}
                />
                <div className="col-span-1 md:col-span-1">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Best vs Worst</div>
                  <div className="text-sm mt-1">
                    <span className="text-[var(--trade-bullish)] font-bold">{data.aggregate.bestSymbol || '—'}</span>
                    <span className="text-muted-foreground mx-2">vs</span>
                    <span className="text-[var(--trade-bearish)] font-bold">{data.aggregate.worstSymbol || '—'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Per-symbol results */}
            <div className={`${componentStyles.card.default} p-4 mb-6`}>
              <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">Per-Symbol Results</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-2 pr-3">Symbol</th>
                      <th className="py-2 pr-3 text-right">Trades</th>
                      <th className="py-2 pr-3 text-right">Win Rate</th>
                      <th className="py-2 pr-3 text-right">Avg Win</th>
                      <th className="py-2 pr-3 text-right">Avg Loss</th>
                      <th className="py-2 pr-3 text-right">Expectancy</th>
                      <th className="py-2 pr-3 text-right">Total Return</th>
                      <th className="py-2 pr-3 text-right">Max DD</th>
                      <th className="py-2 pr-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map(r => (
                      <tr
                        key={r.symbol}
                        className={`border-b border-border/50 hover:bg-muted/20 cursor-pointer ${selectedSymbol === r.symbol ? 'bg-[var(--brand-cyan)]/5' : ''}`}
                        onClick={() => setSelectedSymbol(r.symbol === selectedSymbol ? null : r.symbol)}
                      >
                        <td className="py-2 pr-3 font-bold">{r.symbol}</td>
                        <td className="py-2 pr-3 text-right">{r.trades.length}</td>
                        <td className={`py-2 pr-3 text-right font-mono ${r.winRate >= 55 ? 'text-[var(--trade-bullish)]' : r.winRate >= 45 ? 'text-[var(--trade-neutral)]' : 'text-[var(--trade-bearish)]'}`}>
                          {r.winRate}%
                        </td>
                        <td className="py-2 pr-3 text-right text-[var(--trade-bullish)] font-mono">+{r.avgWinPct}%</td>
                        <td className="py-2 pr-3 text-right text-[var(--trade-bearish)] font-mono">{r.avgLossPct}%</td>
                        <td className={`py-2 pr-3 text-right font-mono font-bold ${r.expectancy >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}`}>
                          {r.expectancy >= 0 ? '+' : ''}{r.expectancy}%
                        </td>
                        <td className={`py-2 pr-3 text-right font-mono ${r.totalReturnPct >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}`}>
                          {r.totalReturnPct >= 0 ? '+' : ''}{r.totalReturnPct}%
                        </td>
                        <td className="py-2 pr-3 text-right text-[var(--trade-bearish)] font-mono">{r.maxDrawdown}%</td>
                        <td className="py-2 pr-3 text-[var(--brand-cyan)] text-[10px]">{selectedSymbol === r.symbol ? 'expanded' : 'expand'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Selected symbol trade log */}
            {selectedResult && (
              <div className={`${componentStyles.card.default} p-4 mb-6`}>
                <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">
                  {selectedResult.symbol} — Trade Log ({selectedResult.trades.length} trades)
                </h2>
                {selectedResult.trades.length === 0 ? (
                  <div className="text-sm text-muted-foreground italic">No trades triggered at score ≥ {scoreThreshold}.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-muted-foreground border-b border-border">
                          <th className="py-2 pr-3">Entry Date</th>
                          <th className="py-2 pr-3 text-right">Entry $</th>
                          <th className="py-2 pr-3 text-right">Score</th>
                          <th className="py-2 pr-3">Exit Date</th>
                          <th className="py-2 pr-3 text-right">Exit $</th>
                          <th className="py-2 pr-3">Exit Reason</th>
                          <th className="py-2 pr-3 text-right">P&L %</th>
                          <th className="py-2 pr-3 text-right">Days</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedResult.trades.map((t, i) => (
                          <tr key={i} className="border-b border-border/50">
                            <td className="py-2 pr-3 font-mono">{t.entryDate}</td>
                            <td className="py-2 pr-3 text-right font-mono">${t.entryPrice}</td>
                            <td className="py-2 pr-3 text-right text-[var(--brand-cyan)] font-bold">{t.scoreAtEntry}</td>
                            <td className="py-2 pr-3 font-mono">{t.exitDate}</td>
                            <td className="py-2 pr-3 text-right font-mono">${t.exitPrice}</td>
                            <td className={`py-2 pr-3 ${
                              t.exitReason === 'T1_HIT' ? 'text-[var(--trade-bullish)]' :
                              t.exitReason === 'STOP_HIT' ? 'text-[var(--trade-bearish)]' :
                              'text-[var(--trade-neutral)]'
                            }`}>
                              {t.exitReason === 'T1_HIT' ? '🎯 T1' : t.exitReason === 'STOP_HIT' ? '🛑 STOP' : '⌛ TIME'}
                            </td>
                            <td className={`py-2 pr-3 text-right font-mono font-bold ${t.pnlPct >= 0 ? 'text-[var(--trade-bullish)]' : 'text-[var(--trade-bearish)]'}`}>
                              {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct}%
                            </td>
                            <td className="py-2 pr-3 text-right text-muted-foreground">{t.daysHeld}d</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!data && !mutation.isPending && (
          <div className={`${componentStyles.card.default} p-12 text-center`}>
            <div className="text-5xl mb-3">🔬</div>
            <div className="text-xl font-bold mb-2">Ready to backtest</div>
            <div className="text-sm text-muted-foreground">
              Configure parameters above and click "Run Backtest" to test the convergence engine
              against 2 years of historical data.
            </div>
          </div>
        )}
      </div>
      {/* EngineStatusFooter removed 2026-09-24: third status bar under the shell's own; fake uptime/engine labels */}
    </div>
  );
}

function KPI({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-[var(--trade-bullish)]',
    red: 'text-[var(--trade-bearish)]',
    cyan: 'text-[var(--brand-cyan)]',
    amber: 'text-[var(--trade-neutral)]'
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${accent ? colorMap[accent] || 'text-foreground' : 'text-foreground'}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
