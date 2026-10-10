import * as React from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

export interface GlassInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "glass" | "solid";
  inputSize?: "sm" | "default" | "lg";
  font?: "default" | "mono";
  iconLeft?: LucideIcon;
  iconRight?: LucideIcon;
  rightIcon?: React.ReactNode;
  error?: string;
  hint?: string;
}

const GlassInput = React.forwardRef<HTMLInputElement, GlassInputProps>(
  ({ 
    className, 
    type, 
    variant = "glass",
    inputSize = "default",
    font = "default",
    iconLeft: IconLeft,
    iconRight: IconRight,
    rightIcon,
    error,
    hint,
    disabled,
    ...props 
  }, ref) => {
    const hasRightContent = IconRight || rightIcon;
    const sizeClasses = {
      sm: "min-h-8 text-xs py-1.5",
      default: "min-h-9 text-sm py-2",
      lg: "min-h-10 text-base py-2.5",
    };

    const variantClasses = {
      glass: "bg-muted/50 backdrop-blur-md border-border/40 focus:border-sky-500/60 focus:ring-sky-500/20",
      solid: "bg-muted border-border focus:border-sky-500 focus:ring-sky-500/30",
    };

    return (
      <div className="space-y-1">
        <div className="relative">
          {IconLeft && (
            <IconLeft className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          )}
          <input
            type={type}
            className={cn(
              "flex w-full rounded-lg border",
              "text-foreground/90 placeholder:text-muted-foreground",
              "transition-colors duration-200",
              "focus:outline-none focus:ring-2 focus:ring-offset-0",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              variantClasses[variant],
              sizeClasses[inputSize],
              font === "mono" && "font-mono tabular-nums",
              IconLeft && "pl-10",
              hasRightContent && "pr-10",
              error && "border-red-500/60 focus:border-[var(--trade-bearish)] focus:ring-red-500/20",
              className
            )}
            ref={ref}
            disabled={disabled}
            {...props}
          />
          {IconRight && (
            <IconRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          )}
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {rightIcon}
            </div>
          )}
        </div>
        {hint && !error && (
          <p className="text-xs text-muted-foreground">{hint}</p>
        )}
        {error && (
          <p className="text-xs text-[var(--trade-bearish)]">{error}</p>
        )}
      </div>
    );
  }
);
GlassInput.displayName = "GlassInput";

export { GlassInput };
