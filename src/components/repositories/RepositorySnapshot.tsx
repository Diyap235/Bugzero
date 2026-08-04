import React from "react";
import { Card } from "../shared/Card";
import { Repository } from "@/types";

interface RepositorySnapshotProps {
  repository: Repository;
}

export const RepositorySnapshot: React.FC<RepositorySnapshotProps> = ({ repository }) => {
  const metrics = [
    { label: "Health Score", value: `${repository.healthScore}/100`, color: "text-success" },
    { label: "Open Findings", value: repository.openFindingsCount, color: "text-text-primary" },
    { label: "Critical Risk", value: repository.criticalFindingsCount, color: "text-danger" },
    { label: "Analyzed Files", value: repository.fileCount, color: "text-text-secondary" },
  ];

  return (
    <Card className="space-y-4">
      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Repository Snapshot</h4>
      <div className="grid grid-cols-2 gap-4">
        {metrics.map((m, idx) => (
          <div key={idx} className="bg-surface p-3 border border-border rounded-lg">
            <span className="text-[11px] text-text-muted block">{m.label}</span>
            <span className={`text-lg font-bold font-mono ${m.color}`}>{m.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};
