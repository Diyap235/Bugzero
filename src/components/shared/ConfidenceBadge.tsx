import React from "react";
import { cn, getConfidenceBadgeStyles } from "@/lib/utils";

interface ConfidenceBadgeProps {
  confidence: number;
  className?: string;
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({ confidence, className }) => {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium border",
        getConfidenceBadgeStyles(confidence),
        className
      )}
      title={`AI Confidence Score: ${confidence}%`}
    >
      AI {confidence}%
    </span>
  );
};
