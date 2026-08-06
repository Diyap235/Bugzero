"use client";

import React from "react";
import { Report } from "@/types";
import { Drawer } from "../shared/Drawer";
import { Button } from "../shared/Button";
import { Download, FileText, CheckCircle2, BarChart3, ShieldCheck } from "lucide-react";
import { formatBytes } from "@/lib/utils";

interface ReportPreviewDrawerProps {
  report: Report | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ReportPreviewDrawer: React.FC<ReportPreviewDrawerProps> = ({
  report,
  isOpen,
  onClose,
}) => {
  if (!report) return null;

  const healthColor =
    report.healthScore >= 80 ? "text-success" :
    report.healthScore >= 60 ? "text-warning" : "text-danger";

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <span className="truncate">{report.reportName}</span>
        </div>
      }
      subtitle={`${report.repositoryName} · ${report.format} · ${formatBytes(report.sizeBytes)}`}
      footer={
        <Button
          variant="primary"
          leftIcon={<Download className="w-4 h-4" />}
          onClick={() => alert(`Downloading ${report.reportName}…`)}
        >
          Download ({formatBytes(report.sizeBytes)})
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Health summary */}
        <div className="bg-card p-5 border border-border rounded-xl space-y-3">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Review Summary</p>
          <div className="flex items-end justify-between">
            <div>
              <span className={`text-3xl font-bold font-mono ${healthColor}`}>
                {report.healthScore}%
              </span>
              <span className="text-sm text-text-muted ml-2">overall health</span>
            </div>
            <span className="text-xs text-text-muted">Generated {report.reviewDate}</span>
          </div>
          <div className="h-2 bg-surface rounded-full overflow-hidden border border-border">
            <div
              className={`h-full rounded-full transition-all ${
                report.healthScore >= 80 ? "bg-success" :
                report.healthScore >= 60 ? "bg-warning" : "bg-danger"
              }`}
              style={{ width: `${report.healthScore}%` }}
            />
          </div>
        </div>

        {/* Report contents */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Report Contents</p>
          <div className="bg-surface border border-border rounded-xl divide-y divide-border">
            {[
              { icon: ShieldCheck, label: "Security findings with severity ratings"        },
              { icon: BarChart3,   label: "Code quality analysis and metrics"              },
              { icon: CheckCircle2,label: "Suggested fixes with before/after code diffs"  },
              { icon: CheckCircle2,label: "Repository health trend data"                  },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 px-4 py-3 text-sm text-text-secondary">
                <Icon className="w-4 h-4 text-success shrink-0" />
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Meta */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          {[
            { label: "Repository",    val: report.repositoryName },
            { label: "Format",        val: report.format         },
            { label: "Generated",     val: report.reviewDate     },
            { label: "File Size",     val: formatBytes(report.sizeBytes) },
          ].map((m) => (
            <div key={m.label} className="bg-card border border-border rounded-xl p-3">
              <p className="text-text-muted mb-0.5">{m.label}</p>
              <p className="font-semibold text-text-primary font-mono">{m.val}</p>
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  );
};
