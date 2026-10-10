/**
 * When a signal fired, and whether that moment was tradeable.
 * Colour carries the standing so it reads at a glance in a dense board:
 * green = fired in live hours and nothing has closed since, amber = catchable
 * but needs an open, red = the market has moved on without you.
 */
import { signalTiming } from "@/lib/signal-timing";
import { TC } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

const STANDING_COLOR = {
  live: TC.bull,
  watch: TC.warn,
  stale: TC.bear,
} as const;

export function SignalTimingBadge({
  generatedAt,
  showCaveat = true,
  className,
}: {
  generatedAt: string | Date | null | undefined;
  /** Off in tight rows where only the clock fits. */
  showCaveat?: boolean;
  className?: string;
}) {
  const t = signalTiming(generatedAt);
  if (!t) return null;
  const color = STANDING_COLOR[t.standing];

  return (
    <span className={cn("inline-flex items-center gap-1.5 min-w-0", className)} title={t.caveat ?? t.label}>
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ background: color, boxShadow: `0 0 6px color-mix(in srgb, ${color} 60%, transparent)` }}
      />
      <span className="text-label font-mono whitespace-nowrap" style={{ color }}>
        {t.label}
      </span>
      {showCaveat && t.caveat && (
        <span className="text-label font-mono text-muted-foreground truncate">· {t.caveat}</span>
      )}
    </span>
  );
}

/**
 * Full-width banner for the detail view — a stale signal deserves more than a dot
 * when the user is one click from sizing a position off its entry price.
 */
export function SignalTimingNotice({ generatedAt }: { generatedAt: string | Date | null | undefined }) {
  const t = signalTiming(generatedAt);
  if (!t || !t.caveat) return null;
  const color = STANDING_COLOR[t.standing];

  return (
    <div
      className="flex items-start gap-2 rounded-lg px-3 py-2"
      style={{
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      <span className="mt-1 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      <div className="min-w-0">
        <div className="text-meta font-mono font-bold uppercase tracking-wider" style={{ color }}>
          {t.standing === "stale" ? "Stale signal" : "Not yet tradeable"}
        </div>
        <div className="text-meta text-muted-foreground mt-0.5">
          Published {t.label}. {t.caveat}.
        </div>
      </div>
    </div>
  );
}
