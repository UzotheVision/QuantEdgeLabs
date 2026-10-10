import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export function ThemeToggle({ className, showLabel = false }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size={showLabel ? "sm" : "icon"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "relative group",
        "text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground",
        "hover:bg-gray-100 dark:hover:bg-muted",
        "transition-all duration-200",
        className
      )}
      data-testid="button-theme-toggle"
    >
      <Sun className={cn(
        "h-4 w-4 transition-all duration-300",
        isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
      )} />
      <Moon className={cn(
        "absolute h-4 w-4 transition-all duration-300",
        isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"
      )} />
      {showLabel && (
        <span className="ml-2 text-xs font-medium">
          {isDark ? "Dark" : "Light"}
        </span>
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

/**
 * Compact theme toggle for use in footers or secondary locations
 */
export function ThemeToggleCompact({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg",
        "bg-gray-100 dark:bg-card border border-gray-200 dark:border-border hover:border-gray-300 dark:hover:border-border",
        "text-xs text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground",
        "transition-all duration-200",
        className
      )}
    >
      {isDark ? (
        <>
          <Moon className="w-3.5 h-3.5" />
          <span className="font-medium">Dark</span>
        </>
      ) : (
        <>
          <Sun className="w-3.5 h-3.5" />
          <span className="font-medium">Light</span>
        </>
      )}
    </button>
  );
}

/**
 * Full theme selector with all options
 */
export function ThemeSelector({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={cn("flex items-center gap-1 p-1 bg-gray-100 dark:bg-[var(--surface-base)] rounded-lg border border-gray-200 dark:border-border", className)}>
      <button
        onClick={() => setTheme("light")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
          theme === "light"
            ? "bg-white dark:bg-white text-foreground shadow-sm"
            : "text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground hover:bg-gray-200 dark:hover:bg-muted"
        )}
      >
        <Sun className="w-3.5 h-3.5" />
        Light
      </button>
      <button
        onClick={() => setTheme("dark")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
          theme === "dark"
            ? "bg-gray-900 dark:bg-muted text-foreground shadow-sm"
            : "text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground hover:bg-gray-200 dark:hover:bg-muted"
        )}
      >
        <Moon className="w-3.5 h-3.5" />
        Dark
      </button>
      <button
        onClick={() => setTheme("system")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
          theme === "system"
            ? "bg-gray-900 dark:bg-muted text-foreground shadow-sm"
            : "text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground hover:bg-gray-200 dark:hover:bg-muted"
        )}
      >
        Auto
      </button>
    </div>
  );
}
