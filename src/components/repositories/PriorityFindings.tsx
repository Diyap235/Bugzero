"use client";

import React from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Finding } from "@/types";
import { Card, CardHeader, CardTitle } from "../shared/Card";
import { SeverityBadge } from "../shared/SeverityBadge";
import { ConfidenceBadge } from "../shared/ConfidenceBadge";

interface PriorityFindingsProps {
  findings: Finding[];
  onSelectFinding: (finding: Finding) => void;
}

export const PriorityFindings: React.FC<PriorityFindingsProps> = ({
  findings,
  onSelectFinding,
}) => {
  return (
    <Card className="space-y-4">
      <CardHeader className="mb-0">
        <CardTitle className="text-base">Priority Findings Needing Attention</CardTitle>
        <span className="text-xs text-text-muted">Top unresolved security & quality issues</span>
      </CardHeader>

      <div className="divide-y divide-border border border-border rounded-lg overflow-hidden bg-surface">
        {findings.slice(0, 5).map((item) => (
          <div
            key={item.id}
            onClick={() => onSelectFinding(item)}
            className="p-4 hover:bg-surface-hover transition-colors cursor-pointer flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              <SeverityBadge severity={item.severity} />
              <div className="truncate">
                <h5 className="text-sm font-semibold text-text-primary truncate">{item.title}</h5>
                <span className="text-xs text-text-muted font-mono">{item.file}:{item.line}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <ConfidenceBadge confidence={item.confidence} />
              <ChevronRight className="w-4 h-4 text-text-muted" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};
