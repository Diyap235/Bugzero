"use client";

import React from "react";
import { Review } from "@/types";
import { Dialog } from "../shared/Dialog";
import { ArrowRight, CheckCircle, ShieldCheck, AlertCircle } from "lucide-react";

interface CompareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  reviewA: Review;
  reviewB: Review;
}

export const CompareDialog: React.FC<CompareDialogProps> = ({
  isOpen,
  onClose,
  reviewA,
  reviewB,
}) => {
  const healthDiff = reviewA.healthScore - reviewB.healthScore;
  const findingsDiff = reviewA.findingsCount - reviewB.findingsCount;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Review Comparison"
      description={`Comparing latest review (${reviewA.id}) against baseline (${reviewB.id}).`}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-6">
        {/* Comparison Header Cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface p-4 border border-border rounded-lg space-y-1">
            <span className="text-xs font-semibold text-primary uppercase">Latest Review ({reviewA.id})</span>
            <div className="text-2xl font-bold font-mono text-text-primary">{reviewA.healthScore}% Health</div>
            <span className="text-xs text-text-muted">{reviewA.findingsCount} open findings</span>
          </div>

          <div className="bg-surface p-4 border border-border rounded-lg space-y-1">
            <span className="text-xs font-semibold text-text-muted uppercase">Baseline Review ({reviewB.id})</span>
            <div className="text-2xl font-bold font-mono text-text-primary">{reviewB.healthScore}% Health</div>
            <span className="text-xs text-text-muted">{reviewB.findingsCount} open findings</span>
          </div>
        </div>

        {/* Delta Metrics */}
        <div className="space-y-3 bg-card p-4 border border-border rounded-lg text-xs">
          <h4 className="font-semibold text-text-muted uppercase tracking-wider">Health Delta & Progress</h4>

          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-text-secondary">Health Score Change</span>
            <span
              className={`font-mono font-bold text-sm ${
                healthDiff >= 0 ? "text-success" : "text-danger"
              }`}
            >
              {healthDiff >= 0 ? `+${healthDiff}% Improvement` : `${healthDiff}% Regression`}
            </span>
          </div>

          <div className="flex items-center justify-between py-2 border-b border-border">
            <span className="text-text-secondary">Net Findings Resolved</span>
            <span className="font-mono font-bold text-sm text-success">
              {findingsDiff <= 0 ? `${Math.abs(findingsDiff)} resolved` : `${findingsDiff} new findings`}
            </span>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
