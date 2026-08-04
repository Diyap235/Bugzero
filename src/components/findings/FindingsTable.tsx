"use client";

import React from "react";
import { Finding } from "@/types";
import { DataTable, Column } from "../shared/DataTable";
import { SeverityBadge } from "../shared/SeverityBadge";
import { ConfidenceBadge } from "../shared/ConfidenceBadge";

interface FindingsTableProps {
  findings: Finding[];
  onSelectFinding: (finding: Finding) => void;
  isLoading?: boolean;
}

export const FindingsTable: React.FC<FindingsTableProps> = ({
  findings,
  onSelectFinding,
  isLoading = false,
}) => {
  const columns: Column<Finding>[] = [
    {
      key: "severity",
      header: "Severity",
      sortable: true,
      render: (item) => <SeverityBadge severity={item.severity} />,
    },
    {
      key: "title",
      header: "Finding Title",
      sortable: true,
      render: (item) => (
        <div>
          <span className="font-semibold text-text-primary block hover:text-primary transition-colors">
            {item.title}
          </span>
          <span className="text-xs text-text-muted truncate max-w-xs block">{item.summary}</span>
        </div>
      ),
    },
    {
      key: "file",
      header: "File & Line",
      sortable: true,
      render: (item) => (
        <span className="font-mono text-xs text-text-secondary">
          {item.file}:{item.line}
        </span>
      ),
    },
    {
      key: "confidence",
      header: "Confidence",
      sortable: true,
      render: (item) => <ConfidenceBadge confidence={item.confidence} />,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (item) => (
        <span
          className={`text-xs font-semibold capitalize ${
            item.status === "resolved"
              ? "text-success"
              : item.status === "ignored"
              ? "text-text-muted"
              : "text-warning"
          }`}
        >
          {item.status}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={findings}
      onRowClick={onSelectFinding}
      isLoading={isLoading}
      keyExtractor={(item) => item.id}
      emptyTitle="No findings found"
      emptyDescription="No repository security or quality issues matched your current search filters."
    />
  );
};
