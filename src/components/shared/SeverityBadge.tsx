import React from "react";
import { Severity } from "@/types";
import { cn, getSeverityBadgeStyles } from "@/lib/utils";

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity, className }) => {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border capitalize",
        getSeverityBadgeStyles(severity),
        className
      )}
    >
      {severity}
    </span>
  );
};
