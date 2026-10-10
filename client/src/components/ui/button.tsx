import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold tracking-tight transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.1)] hover:shadow-[0_2px_4px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)] active:shadow-[0_0px_1px_rgba(0,0,0,0.2)]",
        destructive:
          "bg-destructive text-destructive-foreground rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.1)] hover:shadow-[0_2px_4px_rgba(0,0,0,0.2)]",
        outline:
          "border-2 border-border/60 bg-transparent hover-elevate hover:border-border rounded-lg",
        secondary: 
          "bg-secondary text-secondary-foreground rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover-elevate",
        ghost: 
          "hover-elevate rounded-lg",
        success:
          "bg-green-600 text-white rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.1)] hover-elevate",
        glass:
          "glass text-white rounded-lg hover:translate-y-[-1px]",
        "glass-secondary":
          "glass-secondary text-white rounded-lg hover:translate-y-[-1px]",
        "glass-danger":
          "glass-danger text-white rounded-lg hover:translate-y-[-1px]",
        "glass-success":
          "glass-success text-white rounded-lg hover:translate-y-[-1px]",
      },
      size: {
        default: "min-h-9 px-5 py-2",
        sm: "min-h-8 px-3 text-xs rounded-md",
        lg: "min-h-10 px-8 text-base rounded-lg",
        icon: "h-9 w-9 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
