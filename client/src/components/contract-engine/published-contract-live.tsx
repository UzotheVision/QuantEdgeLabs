/**
 * "Your contract, now" — the idea's PUBLISHED contract repriced from the
 * current chain. Replaces carried-forward publish-time greeks/IV/ROI with
 * live ones, and states the odds of T1 against the market's own expected
 * move. Refreshes every 2 minutes; every number is stamped with its age.
 */
import { useQuery } from "@tanstack/react-query";

interface Live {
  asOf: string; found: boolean; label: string; spot: number; dte: number;
  mid: number | null; delta: number | null; iv: number | null; thetaPerDayPct: number | null;
  expectedMove: number | null; targetMove: number | null; targetSigma: number | null;
  probFinishBeyondT1: number | null; probTouchT1: number | null;
  roiIfT1Today: number | null; valueAtStopToday: number | null;
  premiumChangeSincePublish: number | null; breakevenAtExpiry: number | null; flags: string[];
}

const pct = (v: number | null, dp = 0) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`);

export function PublishedContractLive(props: {
  symbol: string; optionType: string; strike: number; expiry: string;
  target?: number; stop?: number; entryPremium?: number | null;
}) {
  const qs = new URLSearchParams({
    type: props.optionType, strike: String(props.strike), expiry: String(props.expiry).slice(0, 10),
    ...(props.target ? { target: String(props.target) } : {}),
    ...(props.stop ? { stop: String(props.stop) } : {}),
    ...(props.entryPremium ? { entryPremium: String(props.entryPremium) } : {}),
  });
  const q = useQuery<Live>({
    queryKey: [`/api/contract-live/${props.symbol}?${qs.toString()}`],
    refetchInterval: 120_000, staleTime: 60_000, retry: 0,
  });
  const d = q.data;
  const cell = (k: string, v: string, tone?: string) => (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={{ fontSize: 'var(--fs-9, 9.5px)', letterSpacing: 1, color: "var(--text-dim, #6b7482)" }}>{k}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: tone ?? "inherit", fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );
  const ageMin = d ? Math.max(0, Math.round((Date.now() - Date.parse(d.asOf)) / 60000)) : null;

  return (
    <section className="rounded-lg border border-card-border bg-card px-4 py-3 mb-2" style={{ fontFamily: "'JetBrains Mono', monospace" }} data-testid="published-contract-live">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 'var(--fs-10, 10px)', letterSpacing: 1.5, color: "var(--text-dim, #6b7482)", fontWeight: 700 }}>YOUR CONTRACT · REPRICED NOW</span>
        <span style={{ fontSize: 'var(--fs-9, 9.5px)', color: "var(--text-dim, #6b7482)" }}>
          {d ? `${d.label} · CBOE delayed · ${ageMin === 0 ? "just now" : `${ageMin}m ago`}` : q.isLoading ? "reading the chain…" : "no chain"}
        </span>
      </div>
      {d && d.found && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 10 }}>
            {cell("MID PREMIUM", d.mid != null ? `$${d.mid.toFixed(2)}` : "—")}
            {cell("VS ENTRY · MID", pct(d.premiumChangeSincePublish), (d.premiumChangeSincePublish ?? 0) >= 0 ? "var(--green, #6ee7b7)" : "var(--red, #ff6b3d)")}
            {cell("DELTA", d.delta != null ? Math.abs(d.delta).toFixed(2) : "—")}
            {cell("IV", d.iv != null ? `${(d.iv * 100).toFixed(1)}%` : "—")}
            {cell("θ / DAY", d.thetaPerDayPct != null ? `${(d.thetaPerDayPct * 100).toFixed(1)}%` : "—")}
            {cell("EXPECTED MOVE", d.expectedMove != null ? `±$${d.expectedMove.toFixed(2)}` : "—")}
            {cell("T1 DISTANCE", d.targetSigma != null ? `${d.targetSigma.toFixed(2)}σ` : "—", d.targetSigma != null && d.targetSigma > 1 ? "var(--amber, #e8b34b)" : undefined)}
            {cell("ODDS TOUCH T1", d.probTouchT1 != null ? `${Math.round(d.probTouchT1 * 100)}%` : "—")}
            {cell("IF T1 TODAY", pct(d.roiIfT1Today), "var(--green, #6ee7b7)")}
            {cell("AT STOP TODAY", d.valueAtStopToday != null ? `$${d.valueAtStopToday.toFixed(2)}` : "—", "var(--red, #ff6b3d)")}
            {cell("BREAKEVEN @EXP", d.breakevenAtExpiry != null ? `$${d.breakevenAtExpiry.toFixed(2)}` : "—")}
          </div>
          <p style={{ fontSize: 'var(--fs-10, 10px)', color: "var(--text-dim, #6b7482)", margin: "10px 0 0", lineHeight: 1.5 }}>
            Research values use the bid/ask midpoint. Held-position P&amp;L uses the bid—the price a long contract could actually exit near. Odds are risk-neutral and driftless, not a forecast.
          </p>
        </>
      )}
      {d && d.flags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
          {d.flags.map((f) => (
            <span key={f} style={{ fontSize: 'var(--fs-9, 9.5px)', padding: "2px 7px", borderRadius: 3, background: "rgba(232,179,75,0.08)", border: "1px solid rgba(232,179,75,0.28)", color: "#e8b34b" }}>⚠ {f}</span>
          ))}
        </div>
      )}
    </section>
  );
}
