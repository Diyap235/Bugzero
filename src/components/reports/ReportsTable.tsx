"use client";

import React from "react";
import { Report } from "@/types";
import { DataTable, Column } from "../shared/DataTable";
import { Button } from "../shared/Button";
import { Download, Eye, Trash2, FileText } from "lucide-react";
import { formatBytes } from "@/lib/utils";

interface ReportsTableProps {
  reports: Report[];
  onPreview: (report: Report) => void;
  onDelete: (id: string) => void;
  isLoading?: boolean;
}

export const ReportsTable: React.FC<ReportsTableProps> = ({
  reports,
  onPreview,
  onDelete,
  isLoading = false,
}) => {
  const columns: Column<Report>[] = [
    {
      key: "reportName",
      header: "Report Name",
      sortable: true,
      render: (item) => (
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <span className="font-semibold text-text-primary truncate max-w-xs">{item.reportName}</span>
        </div>
      ),
    },
    {
      key: "repositoryName",
      header: "Repository",
      sortable: true,
      render: (item) => <span className="font-mono text-xs text-text-secondary">{item.repositoryName}</span>,
    },
    {
      key: "reviewDate",
      header: "Date",
      sortable: true,
      render: (item) => <span className="text-xs text-text-muted">{item.reviewDate}</span>,
    },
    {
      key: "healthScore",
      header: "Health",
      sortable: true,
      render: (item) => <span className="font-mono text-xs font-bold text-success">{item.healthScore}%</span>,
    },
    {
      key: "format",
      header: "Format",
      sortable: true,
      render: (item) => (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-surface border border-border text-text-secondary">
          {item.format} ({formatBytes(item.sizeBytes)})
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => onPreview(item)} title="Preview report">
            <Eye className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => alert(`Downloading ${item.reportName}...`)} title="Download report">
            <Download className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => onDelete(item.id)} title="Delete report">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={reports}
      onRowClick={onPreview}
      isLoading={isLoading}
      keyExtractor={(item) => item.id}
      emptyTitle="No reports found"
      emptyDescription="No exported repository review reports available yet."
    />
  );
};
