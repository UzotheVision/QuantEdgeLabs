/**
 * /slate — the daily slate: BMT-style evening watchlist cards built from the
 * platform's own measured ideas (aggressor tape, bottom reversals, crypto
 * transmissions). Presentation only — every number comes from the board.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import PreMarketGappersCard from "@/components/trade-desk/PreMarketGappersCard";

interface SlateCard {
  symbol: string;
  band: string | null;
  score: number | null;
  patternLabel: string;
  provenance: string;
  lastClose: number | null;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  stop: number | null;
  t1: number | null;
  t2: number | null;
  t2Basis: string;
  contract: string | null;
  flowNote: string;
}

interface SlateResponse {
  generatedAt: string;
  basis: string;
  cards: SlateCard[];
}

interface IndexQuote { price: number; changePercent: number }

const fmt = (n: number | null | undefined, dp = 2) =>
  n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export default function SlatePage() {
  const slateQ = useQuery<SlateResponse>({
    queryKey: ["/api/slate"],
    refetchInterval: 5 * 60_000,
  });
  const idxQ = useQuery<{ quotes: Record<string, IndexQuote> }>({
    queryKey: ["/api/quotes/batch/SPY,QQQ,IWM"],
    refetchInterval: 60_000,
  });

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York",
  });
  const cards = slateQ.data?.cards ?? [];
  const idx = idxQ.data?.quotes ?? {};

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "'JetBrains Mono', ui-monospace, monospace", padding: "clamp(16px, 4vw, 40px) clamp(16px, 4vw, 48px)" }}>
      <div style={{ maxWidth: 1500, margin: "0 auto" }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--text-mute)", marginBottom: 8 }}>
          <Link href="/t" style={{ color: "var(--text-mute)", textDecoration: "none" }}>← TERMINAL</Link>
          <span style={{ margin: "0 12px" }}>·</span>QUANTEDGE DAILY SLATE
        </div>
        <h1 style={{ fontSize: "clamp(26px, 6vw, 40px)", fontWeight: 700, margin: "0 0 6px", fontFamily: "inherit" }}>{today}</h1>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 28, minHeight: "2.8em" }}>
          {cards.length} setups · all measured · {slateQ.data?.basis ?? "loading…"}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 40px", borderTop: "1px solid var(--nx-border)", borderBottom: "1px solid var(--nx-border)", padding: "18px 0", marginBottom: 32 }}>
          {(["SPY", "QQQ", "IWM"] as const).map((s) => {
            const q = idx[s];
            const up = (q?.changePercent ?? 0) >= 0;
            return (
              <div key={s} style={{ minWidth: 96, flex: "1 1 96px", maxWidth: 200 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-dim)" }}>
                  <span>${s}</span>
                  <span style={{ color: up ? "var(--green)" : "var(--red)" }}>
                    {up ? "↑" : "↓"} {q ? Math.abs(q.changePercent).toFixed(2) : "—"}%
                  </span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{q ? fmt(q.price) : "—"}</div>
              </div>
            );
          })}
        </div>

        {/* Pre-market gappers moved here when the Trade Desk was retired
            (2026-09-24): it was the Desk's only surface not already on the
            board, and the gap is the leading read before the open. */}
        <div style={{ marginBottom: 28 }}>
          <PreMarketGappersCard defaultExpanded />
        </div>

        {slateQ.isLoading && <div style={{ color: "var(--text-dim)", fontSize: 13 }}>building slate from the board…</div>}
        {!slateQ.isLoading && cards.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
            No measured ideas qualify right now — measured-empty, not broken. The sweeps repopulate through the session.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(270px, 100%), 1fr))", gap: 16 }}>
          {cards.map((c) => (
            <Link key={c.symbol} href={`/r/${c.symbol}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ background: "var(--panel-solid)", border: "1px solid var(--nx-border)", borderLeft: "3px solid var(--green)", borderRadius: 8, padding: "20px 18px", cursor: "pointer", height: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 24, fontWeight: 700 }}>${c.symbol}</span>
                  <span style={{ fontSize: 13, color: "var(--green)", fontWeight: 700 }}>
                    {c.contract ? `▲ ${c.contract.split("·")[0].trim()}` : "▲ LONG"}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--fs-10-5, 10.5px)', color: "var(--text-mute)", marginTop: 4 }}>
                  {fmt(c.lastClose)} close{c.contract ? ` · ${c.contract.split("·").slice(1).join("·").trim()}` : " · no contract yet — engine picks at the open"}
                  {c.band ? ` · ${c.band}-band ${c.score ?? ""}` : ""}
                </div>

                <div style={{ marginTop: 16, fontSize: 11, letterSpacing: 1.2, color: "var(--green)", fontWeight: 700 }}>
                  ● {c.patternLabel}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text)", marginTop: 6, lineHeight: 1.5, minHeight: 34 }}>
                  {c.provenance}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 16, fontSize: 'var(--fs-10, 10px)' }}>
                  <div>
                    <div style={{ color: "var(--text-mute)", marginBottom: 3 }}>ENTRY</div>
                    <div style={{ fontWeight: 700, fontSize: 11 }}>
                      {c.entryZoneLow != null ? `${c.entryZoneLow.toFixed(2)}–${c.entryZoneHigh?.toFixed(2)}` : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "var(--text-mute)", marginBottom: 3 }}>STOP</div>
                    <div style={{ fontWeight: 700, fontSize: 12, color: "var(--red)" }}>{fmt(c.stop)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--text-mute)", marginBottom: 3 }}>TARGET 1</div>
                    <div style={{ fontWeight: 700, fontSize: 12 }}>{fmt(c.t1)}</div>
                  </div>
                  <div>
                    <div style={{ color: "var(--text-mute)", marginBottom: 3 }} title={c.t2Basis}>TARGET 2</div>
                    <div style={{ fontWeight: 700, fontSize: 12 }}>{fmt(c.t2)}</div>
                  </div>
                </div>

                <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--nx-border)", fontSize: 'var(--fs-10, 10px)', color: "var(--text-dim)" }}>
                  FLOW&nbsp;&nbsp;{c.flowNote}
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div style={{ marginTop: 36, fontSize: 'var(--fs-10-5, 10.5px)', color: "var(--text-mute)", textAlign: "center" }}>
          Setups derived from measured detectors (aggressor tape · bottom reversals · crypto transmission) ·
          T2 hover shows its basis · Re-validate at the open · Not financial advice
        </div>
      </div>
    </div>
  );
}
