import React from "react";
import { cn } from "@/lib/utils";

interface ConfidenceBadgeProps {
  confidence: number;
  className?: string;
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({ confidence, className }) => {
  const color =
    confidence >= 80
      ? "bg-[#4CAF50]/15 text-[#4CAF50] border-[#4CAF50]/30"
      : confidence >= 50
      ? "bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30"
      : "bg-[#7E8A84]/15 text-[#7E8A84] border-[#7E8A84]/30";

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-mono font-semibold border",
        color,
        className
      )}
      title={`Confidence: ${confidence}%`}
    >
      {confidence}%
    </span>
  );
};
