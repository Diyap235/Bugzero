import React from "react";
import { HealthData } from "@/types";
import { DataTable, Column } from "../shared/DataTable";

interface WeakModulesTableProps {
  modules: HealthData["weakModules"];
}

export const WeakModulesTable: React.FC<WeakModulesTableProps> = ({ modules }) => {
  const columns: Column<HealthData["weakModules"][0]>[] = [
    {
      key: "module",
      header: "Module Path",
      render: (item) => <span className="font-mono text-xs text-text-primary font-semibold">{item.module}</span>,
    },
    {
      key: "health",
      header: "Health",
      render: (item) => (
        <span
          className={`font-mono text-xs font-bold ${
            item.health >= 80 ? "text-success" : item.health >= 65 ? "text-warning" : "text-danger"
          }`}
        >
          {item.health}%
        </span>
      ),
    },
    {
      key: "findings",
      header: "Open Findings",
      render: (item) => <span className="text-xs text-text-secondary">{item.findings} issues</span>,
    },
    {
      key: "risk",
      header: "Risk Level",
      render: (item) => (
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
            item.risk === "High" ? "bg-danger/20 text-danger" : "bg-warning/20 text-warning"
          }`}
        >
          {item.risk}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
        Weak Modules Needing Refactoring
      </h4>
      <DataTable columns={columns} data={modules} keyExtractor={(m) => m.module} />
    </div>
  );
};
