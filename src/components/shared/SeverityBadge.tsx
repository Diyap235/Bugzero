import React from "react";
import { Severity } from "@/types";
import { cn } from "@/lib/utils";

const SEVERITY_CONFIG: Record<Severity, { label: string; classes: string; dot: string }> = {
  critical: {
    label: "Critical",
    classes: "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/35 shadow-[0_0_8px_rgba(239,68,68,0.15)]",
    dot: "bg-[#EF4444]",
  },
  high: {
    label: "High",
    classes: "bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/35",
    dot: "bg-[#F59E0B]",
  },
  medium: {
    label: "Medium",
    classes: "bg-yellow-500/15 text-yellow-500 border-yellow-500/35",
    dot: "bg-yellow-500",
  },
  low: {
    label: "Low",
    classes: "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/35",
    dot: "bg-[#3B82F6]",
  },
  resolved: {
    label: "Resolved",
    classes: "bg-[#4CAF50]/15 text-[#4CAF50] border-[#4CAF50]/35",
    dot: "bg-[#4CAF50]",
  },
};

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity, className }) => {
  const config = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.low;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-all",
        config.classes,
        className
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", config.dot)} />
      {config.label}
    </span>
  );
};
