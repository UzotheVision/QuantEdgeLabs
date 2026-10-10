import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import qeMark from "@assets/qe-mark.svg";

// ─────────────────────────────────────────────────────────────────────────
// Public, read-only watchlist — shareable with a trading group.
// No auth, no sidebar, no edit controls. Renders the same graded ranking the
// owner sees in the "Overview" tab, plus a NEW badge for fresh adds.
// ─────────────────────────────────────────────────────────────────────────

interface PublicItem {
  symbol: string;
  assetType: string;
  tier: string | null;
  gradeLetter: string | null;
  gradeScore: number | null;
  momentum5d: number | null;
  upside: number | null;
  topSignal: string | null;
  thesis: string | null;
  addedAt: string | null;
  currentPrice: number | null;
  lastEvaluatedAt: string | null;
}

interface PublicResponse {
  name: string;
  updatedAt: string | null;
  count: number;
  items: PublicItem[];
}

const TIER_STYLE: Record<string, string> = {
  S: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  A: "bg-emerald-500/20 text-[var(--trade-bullish)] border-emerald-500/40",
  B: "bg-emerald-500/15 text-[var(--trade-bullish)]/90 border-emerald-500/30",
  C: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  D: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  F: "bg-red-500/20 text-[var(--trade-bearish)] border-red-500/40",
};

function isNew(addedAt: string | null): boolean {
  if (!addedAt) return false;
  const t = new Date(addedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 1000 * 60 * 60 * 48; // added within last 48h
}

function fmtUpdated(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PublicWatchlist() {
  const { data, isLoading, isError } = useQuery<PublicResponse>({
    queryKey: ["/api/public/watchlist"],
    queryFn: async () => {
      const res = await fetch("/api/public/watchlist");
      if (!res.ok) throw new Error("Failed to load watchlist");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const items = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="min-h-screen bg-[#0a0d12] text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <img src={qeMark} alt="" width={22} height={22} className="h-[22px] w-[22px]" />
              <span className="text-lg font-bold tracking-tight text-sky-300">QuantEdge</span>
              <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                Shared · read-only
              </span>
            </div>
            <h1 className="mt-1 text-xl font-semibold sm:text-2xl">{data?.name ?? "Watchlist"}</h1>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>{data ? `${data.count} tickers` : "—"}</div>
            <div className="mt-0.5">Updated {fmtUpdated(data?.updatedAt ?? null)}</div>
          </div>
        </div>

        {/* States */}
        {/* Skeleton rows the height of real rows: the old one-line "Loading…"
            was swapped for the full list and shoved the page (CLS 0.25, "poor"). */}
        {isLoading && (
          <ul className="mt-3 divide-y divide-white/[0.06]" aria-busy="true" aria-label="Loading watchlist">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <span className="h-9 w-full animate-pulse rounded bg-white/[0.04]" />
              </li>
            ))}
          </ul>
        )}
        {isError && (
          <div className="py-16 text-center text-[var(--trade-bearish)]">Couldn't load the watchlist. Try refreshing.</div>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <div className="py-16 text-center text-slate-400">No tickers on the list yet.</div>
        )}

        {/* List */}
        {items.length > 0 && (
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {items.map((it, i) => {
              const tier = it.tier || "—";
              const tierStyle = TIER_STYLE[tier] || "bg-white/10 text-slate-300 border-white/20";
              const mom = it.momentum5d;
              const fresh = isNew(it.addedAt);
              return (
                <li key={it.symbol} className="flex items-center gap-3 py-3">
                  {/* Rank */}
                  <span className="w-6 shrink-0 text-right font-mono text-xs text-slate-500">
                    {i + 1}
                  </span>
                  {/* Tier chip */}
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-sm font-bold ${tierStyle}`}
                    title={`Tier ${tier}`}
                  >
                    {tier}
                  </span>
                  {/* Symbol + edge */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{it.symbol}</span>
                      {it.gradeLetter && (
                        <span className="font-mono text-xs text-slate-400">
                          {it.gradeLetter}
                          {it.gradeScore != null ? ` · ${Math.round(it.gradeScore)}` : ""}
                        </span>
                      )}
                      {fresh && (
                        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-300">
                          New
                        </span>
                      )}
                    </div>
                    {it.topSignal && (
                      <div className="truncate text-xs text-slate-400">{it.topSignal}</div>
                    )}
                  </div>
                  {/* Momentum */}
                  <div className="shrink-0 text-right">
                    {mom != null && (
                      <div
                        className={`font-mono text-sm ${
                          mom >= 0 ? "text-[var(--trade-bullish)]" : "text-[var(--trade-bearish)]"
                        }`}
                        title="5-day momentum"
                      >
                        {mom >= 0 ? "+" : ""}
                        {mom.toFixed(1)}%
                      </div>
                    )}
                    {it.upside != null && (
                      <div className="font-mono text-[11px] text-sky-400" title="Upside to target">
                        {it.upside >= 0 ? "+" : ""}
                        {Math.round(it.upside)}% tgt
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Footer */}
        <div className="mt-8 border-t border-white/10 pt-4 text-center text-[11px] leading-relaxed text-slate-500">
          Live grades from QuantEdge · technical + momentum scoring.
          <br />
          For informational purposes only — not financial advice.
        </div>
      </div>
    </div>
  );
}
