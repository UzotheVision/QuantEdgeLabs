import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

interface GlassToggleProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
  size?: "sm" | "default" | "lg";
  variant?: "cyan" | "green" | "amber";
}

const GlassToggle = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  GlassToggleProps
>(({ className, size = "default", variant = "cyan", ...props }, ref) => {
  const sizeClasses = {
    sm: { root: "min-h-4 w-7", thumb: "size-3 data-[state=checked]:translate-x-3" },
    default: { root: "min-h-5 w-9", thumb: "size-4 data-[state=checked]:translate-x-4" },
    lg: { root: "min-h-6 w-11", thumb: "size-5 data-[state=checked]:translate-x-5" },
  };

  const variantClasses = {
    cyan: "data-[state=checked]:bg-sky-500",
    green: "data-[state=checked]:bg-[var(--trade-bullish)]",
    amber: "data-[state=checked]:bg-amber-500",
  };

  return (
    <SwitchPrimitives.Root
      className={cn(
        "peer inline-flex shrink-0 cursor-pointer items-center rounded-full",
        "border border-border/60 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "bg-muted/70 backdrop-blur-sm",
        variantClasses[variant],
        sizeClasses[size].root,
        className
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none block rounded-full shadow-lg ring-0 transition-transform",
          "bg-muted data-[state=checked]:bg-white",
          sizeClasses[size].thumb
        )}
      />
    </SwitchPrimitives.Root>
  );
});
GlassToggle.displayName = "GlassToggle";

export { GlassToggle };
