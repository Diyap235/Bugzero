import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "sm" | "lg" | "icon";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "default",
      isLoading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium rounded-button transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:pointer-events-none select-none cursor-pointer";

    const variants = {
      primary: "bg-primary hover:bg-primary-hover active:bg-primary-active text-white shadow-sm",
      secondary: "border border-border hover:bg-surface-hover hover:border-border-strong text-text-primary",
      ghost: "hover:bg-surface-hover text-text-secondary hover:text-text-primary",
      danger: "bg-danger hover:bg-red-600 active:bg-red-700 text-white shadow-sm",
    };

    const sizes = {
      default: "h-[44px] px-6 py-2 text-base gap-2",
      sm: "h-9 px-4 text-sm gap-1.5",
      lg: "h-12 px-8 text-lg gap-2.5",
      icon: "h-[44px] w-[44px] p-0 flex items-center justify-center",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-current" /> : leftIcon}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = "Button";
