/**
 * ConvictionBacktestCard
 * ======================
 * Calls /api/convictions/backtest and renders the band/source breakdown,
 * top-grade recall, and the engine's blindspots/overpromises. Lets the user
 * answer "is the convictions engine actually picking winners?".
 */

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface BandStats {
  band: "S" | "A" | "B" | "C";
  count: number;
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPercentGain: number;
  avgRealizedGain: number;
  avgUnrealizedGain: number;
  expectancyR: number;
}

interface SourceStats {
  source: string;
  count: number;
  winRate: number;
  avgPercentGain: number;
  expectancyR: number;
}

interface BacktestReport {
  generatedAt: string;
  lookbackDays: number;
  totalIdeas: number;
  scoredIdeas: number;
  closedCount: number;
  openCount: number;
  bands: BandStats[];
  sources: SourceStats[];
  topGradeRecallPct: number;
  blindspots: Array<{
    symbol: string;
    score: number;
    band: string;
    actualPercentGain: number;
    direction: string;
    source: string;
  }>;
  overpromises: Array<{
    symbol: string;
    score: number;
    band: string;
    actualPercentGain: number;
    direction: string;
    source: string;
  }>;
}

const BAND_COLOR: Record<BandStats["band"], string> = {
  S: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  A: "text-[var(--trade-bullish)] border-emerald-500/40 bg-emerald-500/10",
  B: "text-sky-300 border-sky-500/40 bg-sky-500/10",
  C: "text-rose-300 border-rose-500/40 bg-rose-500/10",
};

function pct(n: number): string {
  return `${(n >= 0 ? "+" : "")}${n.toFixed(1)}%`;
}

export default function ConvictionBacktestCard({
  lookbackDays = 90,
}: {
  lookbackDays?: number;
}) {
  const { data, isLoading, isError } = useQuery<BacktestReport>({
    queryKey: ["/api/convictions/backtest", lookbackDays],
    queryFn: async () => {
      const res = await fetch(
        `/api/convictions/backtest?lookbackDays=${lookbackDays}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 60 * 60 * 1000, // server caches 1h
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Replaying convictions engine over {lookbackDays} days…</span>
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-6 text-xs text-muted-foreground">
          Backtest unavailable.
        </CardContent>
      </Card>
    );
  }

  const orderedBands: BandStats[] = ["S", "A", "B", "C"]
    .map((b) => data.bands.find((x) => x.band === b))
    .filter(Boolean) as BandStats[];

  return (
    <Card data-testid="card-conviction-backtest">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Conviction Engine Backtest</span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {data.scoredIdeas} / {data.totalIdeas} ideas · {data.lookbackDays}d
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Headline */}
        <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Top-grade recall
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {data.topGradeRecallPct.toFixed(1)}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            Of actual winners, {data.topGradeRecallPct.toFixed(1)}% were graded A or S by today's
            engine. Higher = engine catches winners early.
          </div>
        </div>

        {/* Bands table */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
            By Conviction Band
          </div>
          <div className="rounded-lg border border-foreground/10 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-foreground/[0.04] text-[9px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-1.5">Band</th>
                  <th className="text-right px-2 py-1.5">N</th>
                  <th className="text-right px-2 py-1.5">Win %</th>
                  <th className="text-right px-2 py-1.5">Avg %Gain</th>
                  <th className="text-right px-2 py-1.5">Expectancy</th>
                </tr>
              </thead>
              <tbody>
                {orderedBands.map((b) => (
                  <tr
                    key={b.band}
                    className="border-t border-foreground/5"
                    data-testid={`backtest-band-${b.band}`}
                  >
                    <td className="px-2 py-1.5">
                      <Badge
                        variant="outline"
                        className={`px-1.5 py-0 font-mono font-bold ${BAND_COLOR[b.band]}`}
                      >
                        {b.band}
                      </Badge>
                    </td>
                    <td className="text-right tabular-nums px-2 py-1.5 font-mono">
                      {b.count}
                    </td>
                    <td className="text-right tabular-nums px-2 py-1.5 font-mono">
                      {(b.winRate * 100).toFixed(0)}%
                    </td>
                    <td
                      className={`text-right tabular-nums px-2 py-1.5 font-mono ${
                        b.avgPercentGain >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                      }`}
                    >
                      {pct(b.avgPercentGain)}
                    </td>
                    <td
                      className={`text-right tabular-nums px-2 py-1.5 font-mono ${
                        b.expectancyR >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                      }`}
                    >
                      {b.expectancyR >= 0 ? "+" : ""}
                      {b.expectancyR.toFixed(2)}R
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sources */}
        {data.sources.length > 0 && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
              By Source Scanner
            </div>
            <div className="rounded-lg border border-foreground/10 overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-foreground/[0.04] text-[9px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-2 py-1.5">Source</th>
                    <th className="text-right px-2 py-1.5">N</th>
                    <th className="text-right px-2 py-1.5">Win %</th>
                    <th className="text-right px-2 py-1.5">Avg %Gain</th>
                    <th className="text-right px-2 py-1.5">Exp</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sources.slice(0, 10).map((s) => (
                    <tr key={s.source} className="border-t border-foreground/5">
                      <td className="px-2 py-1.5 font-mono uppercase tracking-wider">
                        {s.source.replace(/_/g, " ")}
                      </td>
                      <td className="text-right tabular-nums px-2 py-1.5 font-mono">
                        {s.count}
                      </td>
                      <td className="text-right tabular-nums px-2 py-1.5 font-mono">
                        {(s.winRate * 100).toFixed(0)}%
                      </td>
                      <td
                        className={`text-right tabular-nums px-2 py-1.5 font-mono ${
                          s.avgPercentGain >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                        }`}
                      >
                        {pct(s.avgPercentGain)}
                      </td>
                      <td
                        className={`text-right tabular-nums px-2 py-1.5 font-mono ${
                          s.expectancyR >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                        }`}
                      >
                        {s.expectancyR.toFixed(2)}R
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Blindspots + overpromises */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.blindspots.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                Engine Blindspots (winners we under-graded)
              </div>
              <div className="space-y-1">
                {data.blindspots.slice(0, 5).map((b, i) => (
                  <div
                    key={`${b.symbol}-${i}`}
                    className="flex items-center justify-between text-[10px] px-2 py-1 rounded border border-foreground/10"
                  >
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="font-bold">{b.symbol}</span>
                      <Badge
                        variant="outline"
                        className={`px-1 py-0 text-[9px] ${BAND_COLOR[b.band as BandStats["band"]] ?? ""}`}
                      >
                        {b.band}
                      </Badge>
                    </div>
                    <span
                      className={`font-mono tabular-nums ${
                        b.actualPercentGain >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                      }`}
                    >
                      {pct(b.actualPercentGain)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.overpromises.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                Engine Overpromises (losers we over-graded)
              </div>
              <div className="space-y-1">
                {data.overpromises.slice(0, 5).map((b, i) => (
                  <div
                    key={`${b.symbol}-${i}`}
                    className="flex items-center justify-between text-[10px] px-2 py-1 rounded border border-foreground/10"
                  >
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="font-bold">{b.symbol}</span>
                      <Badge
                        variant="outline"
                        className={`px-1 py-0 text-[9px] ${BAND_COLOR[b.band as BandStats["band"]] ?? ""}`}
                      >
                        {b.band}
                      </Badge>
                    </div>
                    <span
                      className={`font-mono tabular-nums ${
                        b.actualPercentGain >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                      }`}
                    >
                      {pct(b.actualPercentGain)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
