/**
 * ViewModeToggle — switches between Trade Desk view modes
 * ========================================================
 * Cards    : 3-col band-tinted hero cards (default)
 * Compact  : 4-col denser cards with 1-line layer summary
 * Table    : single dense rows, ~50 names visible
 * Focus    : one big card center-screen, arrow keys to navigate
 */

import { LayoutGrid, Rows3, Table2, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewMode = "cards" | "compact" | "table" | "focus";

const MODES: { id: ViewMode; label: string; icon: React.ElementType }[] = [
  { id: "cards", label: "Cards", icon: LayoutGrid },
  { id: "compact", label: "Compact", icon: Rows3 },
  { id: "table", label: "Table", icon: Table2 },
  { id: "focus", label: "Focus", icon: Maximize2 },
];

interface Props {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}

export function ViewModeToggle({ value, onChange, className }: Props) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-foreground/10 bg-foreground/[0.02] p-0.5",
        className,
      )}
      role="radiogroup"
      aria-label="View mode"
    >
      {MODES.map((mode) => {
        const Icon = mode.icon;
        const isActive = value === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(mode.id)}
            data-testid={`view-mode-${mode.id}`}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-all",
              isActive
                ? "bg-sky-500/15 text-sky-300 border border-sky-500/30"
                : "text-muted-foreground hover:text-foreground hover:bg-foreground/5 border border-transparent",
            )}
          >
            <Icon className="w-3 h-3" />
            <span className="hidden sm:inline">{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}
