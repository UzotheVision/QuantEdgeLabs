/**
 * ROTATION MAP (RRG) — sectors plotted on relative-strength (x) × momentum (y),
 * bubble-sized by magnitude, quadrant-coloured. Reads the live /api/sector-rotation
 * payload (already verified accurate). Motion comes entirely from @/lib/motion so
 * it moves like everything else in the redesigned Terminal.
 */
import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Heartbeat } from "@/components/viz";
import { cn } from "@/lib/utils";
import { EASE, SPRING, DUR } from "@/lib/motion";
import { TC } from "@/lib/design-tokens";
import { PanelFrame } from "@/components/oracle/panel-frame";

interface Sector {
  etf: string;
  name: string;
  relChange: number;
  fiveDayChange: number;
  state: string;
  rank: number;
  /** True RRG axes — see SectorFlow in server/sector-rotation.ts. */
  rsRatio: number | null;
  rsMomentum: number | null;
}
interface RotationData {
  sectors: Sector[];
  spyChange: number;
  sessionLabel: string;
  isStale: boolean;
  /** Server-side compute time. Heartbeat reads this, never the client fetch time. */
  asOf?: string;
}

interface Candle {
  time: number;
  close: number;
}

interface RotationTapeData {
  sector: Candle[];
  spy: Candle[];
}

interface RelativeTapePoint {
  at: number;
  relative: number;
  session: "POST" | "PRE" | "RTH";
}

function marketSession(at: number): RelativeTapePoint["session"] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(at * 1000));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );
  const minutes = hour * 60 + minute;
  if (minutes >= 570 && minutes < 960) return "RTH";
  if (minutes >= 240 && minutes < 570) return "PRE";
  return "POST";
}

/** Match the cash-market clock as a guard while clients may still be on an older API server. */
function cashTapeOpenNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  if (get("weekday") === "Sat" || get("weekday") === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 4 * 60 && minutes < 20 * 60;
}

/**
 * Real sector-versus-SPY tape. This deliberately aligns only prints we received
 * from both ETFs and never fills a missing bar—an interpolated overnight curve
 * would look smoother, but would be data we do not have.
 */
function relativeTape(data?: RotationTapeData): RelativeTapePoint[] {
  if (!data?.sector?.length || !data.spy?.length) return [];
  const spyByTime = new Map(data.spy.map((bar) => [bar.time, bar.close]));
  const shared = data.sector
    .map((bar) => ({ sector: bar, spy: spyByTime.get(bar.time) }))
    .filter(
      (row): row is { sector: Candle; spy: number } =>
        typeof row.spy === "number" &&
        Number.isFinite(row.spy) &&
        row.sector.close > 0,
    )
    .sort((a, b) => a.sector.time - b.sector.time);
  if (shared.length < 2) return [];

  const latest = shared[shared.length - 1].sector.time;
  const withinWindow = shared.filter(
    (row) => row.sector.time >= latest - 24 * 60 * 60,
  );
  const rows = withinWindow.length >= 2 ? withinWindow : shared.slice(-48);
  const base = rows[0];
  return rows.map((row) => ({
    at: row.sector.time,
    relative:
      (row.sector.close / base.sector.close - 1 - (row.spy / base.spy - 1)) *
      100,
    session: marketSession(row.sector.time),
  }));
}

function tapeDate(at?: number) {
  if (!at) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at * 1000));
}

const QUAD = {
  leading: {
    label: "LEADING",
    sub: "Strong momentum",
    color: "var(--trade-bullish, #22c55e)",
  },
  improving: {
    label: "IMPROVING",
    sub: "Momentum accelerating",
    color: "#2dd4bf",
  },
  weakening: { label: "WEAKENING", sub: "Momentum fading", color: "#d4a72c" },
  lagging: {
    label: "LAGGING",
    sub: "Weak momentum",
    color: "var(--trade-bearish, #ef4444)",
  },
} as const;

type QuadKey = keyof typeof QUAD;
function quadOf(x: number, y: number): QuadKey {
  if (x >= 0 && y >= 0) return "leading";
  if (x < 0 && y >= 0) return "improving";
  if (x >= 0 && y < 0) return "weakening";
  return "lagging";
}

export function RotationMap({
  className,
  collapsedHeight,
  expanded = false,
  onFocus,
}: {
  className?: string;
  /** Override the shared panel height. The landing page gives the plot full room;
      inside the Terminal it stays flush with the two panels beside it. */
  collapsedHeight?: number;
  /** Full-screen drilldown: use the available column instead of the compact cap. */
  expanded?: boolean;
  onFocus?: () => void;
}) {
  const reduce = useReducedMotion();
  const [selectedEtf, setSelectedEtf] = useState<string | null>(null);
  const [hoveredEtf, setHoveredEtf] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery<RotationData>({
    queryKey: ["/api/sector-rotation"],
    queryFn: async () => {
      const r = await fetch("/api/sector-rotation", { credentials: "include" });
      if (!r.ok) throw new Error("rotation failed");
      return r.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  // Rotation is computed on regular-session closes, so overnight it correctly reports
  // the last close. Rather than just labelling itself "stale", say WHICH session we're in
  // and when it refreshes — stale data with a clock is information; without one it looks broken.
  const { data: ext } = useQuery<{
    session: "pre" | "regular" | "post" | "closed";
    isStale?: boolean;
  }>({
    queryKey: ["/api/extended-hours", "rotation-session"],
    queryFn: async () => {
      const r = await fetch("/api/extended-hours?limit=1", {
        credentials: "include",
      });
      if (!r.ok) throw new Error("session failed");
      return r.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const session = ext?.session && ext.session !== "closed" && !ext.isStale && cashTapeOpenNow()
    ? ext.session
    : "closed";
  const sessionNote =
    session === "regular"
      ? "updating live"
      : session === "pre"
        ? "pre-market tape live"
        : session === "post"
          ? "after-hours tape live"
          : session === "closed"
            ? "last completed session"
            : null;

  // A single selected sector earns the second data request. The field itself
  // remains cheap; the tape is a drill-down, not 16 miniature charts hidden
  // behind every bubble.
  const { data: tapeData, isFetching: tapeLoading } =
    useQuery<RotationTapeData>({
      queryKey: ["/api/rotation-tape", selectedEtf],
      enabled: Boolean(selectedEtf),
      queryFn: async () => {
        const [sectorResponse, spyResponse] = await Promise.all([
          fetch(
            `/api/historical-prices/${encodeURIComponent(selectedEtf!)}?range=5d&interval=15m`,
            { credentials: "include" },
          ),
          fetch("/api/historical-prices/SPY?range=5d&interval=15m", {
            credentials: "include",
          }),
        ]);
        if (!sectorResponse.ok || !spyResponse.ok)
          throw new Error("rotation tape failed");
        const [sectorBody, spyBody] = await Promise.all([
          sectorResponse.json(),
          spyResponse.json(),
        ]);
        return { sector: sectorBody.data ?? [], spy: spyBody.data ?? [] };
      },
      staleTime: 60_000,
      refetchInterval: 120_000,
      retry: 1,
    });
  const tape = useMemo(() => relativeTape(tapeData), [tapeData]);

  // Plot only sectors we could compute true RRG coordinates for. The axes are
  // rsRatio (strength vs SPY relative to its own norm) and rsMomentum (whether that
  // strength is building). Plotting relChange vs fiveDayChange correlated at 0.998 —
  // the same number twice — which is why every sector used to sit on one diagonal.
  const sectors = (data?.sectors ?? []).filter(
    (s) => s.rsRatio != null && s.rsMomentum != null,
  );
  const rsX = (s: Sector) => s.rsRatio ?? 0;
  const rsY = (s: Sector) => s.rsMomentum ?? 0;
  const maxX = Math.max(0.5, ...sectors.map((s) => Math.abs(rsX(s))));
  const maxY = Math.max(0.5, ...sectors.map((s) => Math.abs(rsY(s))));
  const maxMag = Math.max(1, ...sectors.map((s) => Math.hypot(rsX(s), rsY(s))));
  // Every sector owns its bubble. Labels live inside those bubbles; no side lists
  // competing with the map and no connector-web trying to repair that mistake.
  const posX = (v: number) => 50 + (v / (maxX * 1.25)) * 50;
  const posY = (v: number) => 100 - (50 + (v / (maxY * 1.25)) * 50); // invert: +momentum = top
  // The expanded map is a reading surface, not simply the compact card made
  // wider. Fixed 14–34px dots become illegible across a 1,400px dialog, so it
  // earns its extra room with a genuinely larger interaction target.
  const size = (s: Sector) =>
    expanded
      ? 30 + (Math.hypot(rsX(s), rsY(s)) / maxMag) * 46
      : 20 + (Math.hypot(rsX(s), rsY(s)) / maxMag) * 22;

  const laidOut = sectors.map((s) => {
    return {
      etf: s.etf,
      x: posX(rsX(s)),
      y: posY(rsY(s)),
      quad: quadOf(rsX(s), rsY(s)),
      d: size(s),
      sector: s,
      rs: rsX(s),
      momentum: rsY(s),
      tooltip: `${s.name} (${s.etf}) · RS ${rsX(s) >= 0 ? "+" : ""}${rsX(s).toFixed(2)} vs its norm · momentum ${rsY(s) >= 0 ? "+" : ""}${rsY(s).toFixed(2)} · today ${s.relChange >= 0 ? "+" : ""}${s.relChange.toFixed(2)}% vs SPY`,
    };
  });
  // Hover is a temporary glance; click pins a sector so its full identity and
  // readout stay visible after the pointer leaves the dense plot.
  const activeEtf = hoveredEtf ?? selectedEtf;
  const selectedSector = selectedEtf
    ? laidOut.find((point) => point.etf === selectedEtf)
    : null;

  return (
    <PanelFrame
      title="Rotation Map"
      className={className}
      collapsedHeight={collapsedHeight}
      forceExpanded={expanded}
      onFocus={onFocus}
      right={
        <span className="text-label font-mono text-muted-foreground">
          x · rel strength&nbsp;&nbsp;y · building
          {data?.isStale ? " · stale" : ""}
        </span>
      }
    >
      {(data?.isStale || sessionNote) && (
        <div className="flex items-center justify-between border-b border-border/30 px-4 py-1.5">
          <span className="text-label font-mono uppercase tracking-wider text-muted-foreground">
            {data?.sessionLabel ?? "last close"}
          </span>
          <div className="flex items-center gap-3">
            {sessionNote && (
              <span
                className="text-label font-mono"
                style={{ color: session === "regular" ? TC.bull : TC.warn }}
              >
                {sessionNote}
              </span>
            )}
            <Heartbeat since={data?.asOf} staleAfterSec={900} />
          </div>
        </div>
      )}

      {/* A 1:1 plot is the tallest element on the page for no analytical gain — the axes
          are relative strength vs momentum, not a shared unit, so the aspect is free.
          Slightly wide keeps every bubble readable in far less vertical space. */}
      {/* The old 280px cap saved vertical space and cost readability: 15 labelled
          points on a correlated diagonal cannot fit in 280px. Fill the column. */}
      <div
        className="relative mx-auto w-full"
        style={{ aspectRatio: "16 / 10", maxWidth: expanded ? undefined : 560 }}
      >
        {isLoading && (
          <div className="absolute inset-0 grid place-items-center text-label font-mono uppercase tracking-widest text-muted-foreground">
            reading rotation…
          </div>
        )}
        {isError && (
          <div className="absolute inset-0 grid place-items-center text-label font-mono uppercase tracking-widest text-muted-foreground">
            rotation unavailable
          </div>
        )}
        {/* The plot needs ~50 daily closes per ETF to compute RS. If that history is
            missing the map would otherwise render as an empty grid, which looks like a
            calm market rather than absent data. */}
        {!isLoading && !isError && sectors.length === 0 && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <span className="text-label font-mono text-muted-foreground">
              Not enough daily history to compute relative strength yet — the
              map fills in once the ETF price history loads.
            </span>
          </div>
        )}

        {/* axes + faint field */}
        <div
          className="absolute inset-3 rounded-lg"
          style={{
            background:
              "radial-gradient(ellipse at center, color-mix(in srgb, var(--foreground) 4%, transparent), transparent 72%)",
          }}
        />
        <div className="absolute left-1/2 top-3 bottom-3 w-px bg-border/50" />
        <div className="absolute top-1/2 left-3 right-3 h-px bg-border/50" />

        {/* quadrant labels */}
        <QLabel pos="tl" q={QUAD.improving} />
        <QLabel pos="tr" q={QUAD.leading} />
        <QLabel pos="bl" q={QUAD.lagging} />
        <QLabel pos="br" q={QUAD.weakening} />

        {/* bubbles — position AND size animate live as the rotation data refetches,
            so sectors glide to their new RS/momentum spot every update, not just on mount. */}
        <div className="absolute inset-x-12 inset-y-6">
          {/* Tickers live inside their real positions. The map stays a field, not
              a list drawn around a field; hover or click supplies the full read. */}
          {laidOut.map((p, i) => {
            const c = QUAD[p.quad].color;
            const glide = reduce
              ? { duration: 0 }
              : { type: "spring" as const, stiffness: 120, damping: 22 };
            const isActive = activeEtf === p.etf;
            return (
              <motion.span
                key={`dot-${p.etf}`}
                className="absolute cursor-crosshair rounded-full"
                style={{ x: "-50%", y: "-50%" }}
                initial={reduce ? false : { opacity: 0, scale: 0.55 }}
                animate={{
                  opacity: activeEtf && !isActive ? 0.48 : 1,
                  scale: isActive ? 1.18 : 1,
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  width: p.d,
                  height: p.d,
                }}
                transition={{
                  opacity: {
                    duration: reduce ? 0 : DUR.base,
                    ease: EASE,
                    delay: reduce ? 0 : i * 0.04,
                  },
                  scale: reduce
                    ? { duration: 0 }
                    : { ...SPRING, delay: i * 0.04 },
                  left: glide,
                  top: glide,
                  width: glide,
                  height: glide,
                }}
                whileHover={reduce ? undefined : { scale: 1.15 }}
                onHoverStart={() => setHoveredEtf(p.etf)}
                onHoverEnd={() => setHoveredEtf(null)}
                onFocus={() => setHoveredEtf(p.etf)}
                onBlur={() => setHoveredEtf(null)}
                onClick={() =>
                  setSelectedEtf((current) =>
                    current === p.etf ? null : p.etf,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedEtf((current) =>
                      current === p.etf ? null : p.etf,
                    );
                  }
                }}
                title={p.tooltip}
                role="button"
                tabIndex={0}
                aria-label={p.tooltip}
              >
                {isActive && !reduce && (
                  <motion.span
                    className="absolute -inset-2 rounded-full border"
                    style={{ borderColor: c }}
                    initial={{ opacity: 0.65, scale: 0.65 }}
                    animate={{ opacity: 0, scale: 1.75 }}
                    transition={{ duration: 0.85, repeat: Infinity }}
                  />
                )}
                <span
                  className="block h-full w-full rounded-full"
                  style={{
                    background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${c} 80%, white), ${c})`,
                    boxShadow: `0 0 14px color-mix(in srgb, ${c} 45%, transparent)`,
                    transition: "background 400ms ease, box-shadow 400ms ease",
                  }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 grid place-items-center font-mono font-bold leading-none text-[var(--background)]"
                  style={{
                    fontSize: expanded
                      ? p.d >= 38
                        ? "12px"
                        : "11px"
                      : p.d >= 34
                        ? "11px"
                        : "10px",
                    textShadow: "0 1px 2px rgba(0,0,0,.65)",
                  }}
                >
                  {p.etf}
                </span>
              </motion.span>
            );
          })}

          {activeEtf &&
            (() => {
              const active = laidOut.find((p) => p.etf === activeEtf);
              if (!active) return null;
              const tone = QUAD[active.quad].color;
              return (
                <motion.div
                  initial={reduce ? false : { opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={
                    reduce ? { duration: 0 } : { duration: 0.16, ease: EASE }
                  }
                  className="pointer-events-none absolute bottom-3 right-3 z-10 min-w-[168px] rounded-md border border-card-border bg-card/95 px-3 py-2 shadow-xl backdrop-blur"
                  style={{
                    boxShadow: `0 8px 26px color-mix(in srgb, ${tone} 18%, transparent)`,
                  }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[12px] font-bold text-foreground">
                      {active.etf}
                    </span>
                    <span
                      className="font-mono text-[9px] uppercase tracking-wider"
                      style={{ color: tone }}
                    >
                      {QUAD[active.quad].label}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                    {active.sector.name}
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2 font-mono text-[9px] tabular-nums text-muted-foreground">
                    <span>
                      RS{" "}
                      <b className="font-semibold" style={{ color: tone }}>
                        {active.rs >= 0 ? "+" : ""}
                        {active.rs.toFixed(1)}
                      </b>
                    </span>
                    <span>
                      mom{" "}
                      <b className="font-semibold" style={{ color: tone }}>
                        {active.momentum >= 0 ? "+" : ""}
                        {active.momentum.toFixed(1)}
                      </b>
                    </span>
                    <span>
                      day{" "}
                      <b
                        className="font-semibold"
                        style={{
                          color:
                            active.sector.relChange >= 0 ? TC.bull : TC.bear,
                        }}
                      >
                        {active.sector.relChange >= 0 ? "+" : ""}
                        {active.sector.relChange.toFixed(1)}%
                      </b>
                    </span>
                  </div>
                </motion.div>
              );
            })()}
        </div>
      </div>

      {selectedSector && !expanded && (
        <div className="border-t border-border/40 px-4 py-2 font-mono text-[10px] text-muted-foreground">
          <span className="font-bold text-foreground">{selectedSector.etf}</span>
          <span className="mx-2 text-muted-foreground">·</span>
          {selectedSector.sector.name} vs SPY
          {tape.length > 1 && (
            <span className="ml-2 font-bold tabular-nums" style={{ color: tape[tape.length - 1].relative >= 0 ? TC.bull : TC.bear }}>
              {tape[tape.length - 1].relative >= 0 ? '+' : ''}{tape[tape.length - 1].relative.toFixed(2)}% relative
            </span>
          )}
          <span className="ml-2 text-muted-foreground">· expand map for last 24 tradable hours</span>
        </div>
      )}

      {selectedSector && expanded && (
        <RotationTape
          sector={selectedSector.sector}
          points={tape}
          loading={tapeLoading}
        />
      )}

      {/* legend */}
      <div className="flex items-center justify-center gap-4 py-2 border-t border-border/40 flex-wrap">
        {Object.values(QUAD).map((q) => (
          <span
            key={q.label}
            className="inline-flex items-center gap-1.5 text-label font-mono uppercase tracking-wider text-muted-foreground"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: q.color }}
            />{" "}
            {q.label}
          </span>
        ))}
      </div>
    </PanelFrame>
  );
}

function RotationTape({
  sector,
  points,
  loading,
}: {
  sector: Sector;
  points: RelativeTapePoint[];
  loading: boolean;
}) {
  const latest = points[points.length - 1];
  const delta = latest?.relative ?? 0;
  const tone = delta >= 0 ? TC.bull : TC.bear;
  const width = 760;
  const height = 94;
  const padX = 8;
  const padY = 18;
  const extent =
    Math.max(0.12, ...points.map((point) => Math.abs(point.relative))) * 1.18;
  const x = (index: number) =>
    points.length <= 1
      ? width / 2
      : padX + (index / (points.length - 1)) * (width - padX * 2);
  const y = (value: number) =>
    padY + ((extent - value) / (extent * 2)) * (height - padY * 2);
  const path = points
    .map(
      (point, index) =>
        `${index ? "L" : "M"} ${x(index).toFixed(1)} ${y(point.relative).toFixed(1)}`,
    )
    .join(" ");
  const sessions = points.reduce<
    { index: number; session: RelativeTapePoint["session"] }[]
  >((all, point, index) => {
    if (!index || point.session !== points[index - 1].session)
      all.push({ index, session: point.session });
    return all;
  }, []);

  return (
    <section className="border-t border-border/40 bg-card/20 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2 font-mono">
          <span className="text-[12px] font-bold text-foreground">
            {sector.etf}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {sector.name} vs SPY
          </span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            last 24 tradable h
          </span>
        </div>
        {points.length > 1 && (
          <span
            className="font-mono text-[11px] font-bold tabular-nums"
            style={{ color: tone }}
          >
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(2)}% relative
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-2 h-[94px] animate-pulse rounded bg-foreground/[0.035]" />
      ) : points.length < 2 ? (
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Extended-hours bars are unavailable for this sector right now. The map
          remains based on the latest verified rotation read.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="mt-2 h-[94px] w-full overflow-visible"
            role="img"
            aria-label={`${sector.etf} relative performance versus SPY over the last 24 tradable hours`}
          >
            <line
              x1={padX}
              x2={width - padX}
              y1={y(0)}
              y2={y(0)}
              stroke="var(--border)"
              strokeOpacity="0.75"
              strokeDasharray="2 4"
            />
            {sessions.slice(1).map(({ index, session }) => (
              <g key={`${session}-${index}`}>
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1={padY - 2}
                  y2={height - padY + 2}
                  stroke="var(--border)"
                  strokeOpacity="0.5"
                  strokeDasharray="2 4"
                />
                <text
                  x={x(index) + 4}
                  y={11}
                  fill="var(--muted-foreground)"
                  fontSize="8"
                  fontFamily="var(--font-mono)"
                >
                  {session}
                </text>
              </g>
            ))}
            <motion.path
              d={path}
              fill="none"
              stroke={tone}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.48, ease: EASE }}
            />
            <circle
              cx={x(points.length - 1)}
              cy={y(latest.relative)}
              r="3.25"
              fill={tone}
            />
          </svg>
          <div className="mt-1 flex items-center justify-between font-mono text-[9px] tabular-nums text-muted-foreground">
            <span>{tapeDate(points[0]?.at)}</span>
            <span>15m bars · includes post &amp; pre-market</span>
            <span>{tapeDate(latest?.at)}</span>
          </div>
        </>
      )}
    </section>
  );
}

function QLabel({
  pos,
  q,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  q: { label: string; sub: string; color: string };
}) {
  const place = {
    tl: "top-3 left-3 text-left",
    tr: "top-3 right-3 text-right",
    bl: "bottom-3 left-3 text-left",
    br: "bottom-3 right-3 text-right",
  }[pos];
  return (
    <div className={cn("absolute pointer-events-none", place)}>
      <div
        className="text-label font-mono font-bold uppercase tracking-widest"
        style={{ color: q.color }}
      >
        {q.label}
      </div>
      <div className="text-label font-mono uppercase tracking-wide text-muted-foreground">
        {q.sub}
      </div>
    </div>
  );
}
