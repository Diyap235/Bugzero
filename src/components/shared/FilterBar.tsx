"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface FilterOption {
  label: string;
  value: string;
  count?: number;
}

interface FilterBarProps {
  options: FilterOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
  title?: string;
  className?: string;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  options,
  selectedValue,
  onSelect,
  title,
  className,
}) => {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {title && <span className="text-xs font-semibold text-text-muted uppercase mr-2">{title}:</span>}
      {options.map((opt) => {
        const isSelected = selectedValue.toLowerCase() === opt.value.toLowerCase();
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 border",
              isSelected
                ? "bg-primary text-white border-primary shadow-xs font-semibold"
                : "bg-surface text-text-secondary border-border hover:border-border-strong hover:text-text-primary"
            )}
          >
            <span>{opt.label}</span>
            {typeof opt.count === "number" && (
              <span
                className={cn(
                  "px-1.5 py-0.2 text-[10px] rounded-full",
                  isSelected ? "bg-white/20 text-white" : "bg-card text-text-muted"
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
