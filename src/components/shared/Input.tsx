import React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, leftIcon, rightIcon, error, ...props }, ref) => {
    return (
      <div className="w-full space-y-1">
        <div className="relative flex items-center w-full">
          {leftIcon && (
            <div className="absolute left-4 text-text-muted pointer-events-none flex items-center justify-center">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            className={cn(
              "w-full h-[48px] bg-surface border border-border rounded-input px-4 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-sm",
              leftIcon && "pl-11",
              rightIcon && "pr-11",
              error && "border-danger focus:border-danger focus:ring-danger",
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-4 text-text-muted flex items-center justify-center">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-danger font-medium pl-1">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
