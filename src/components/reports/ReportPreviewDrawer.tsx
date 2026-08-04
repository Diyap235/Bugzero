"use client";

import React from "react";
import { Report } from "@/types";
import { Drawer } from "../shared/Drawer";
import { Button } from "../shared/Button";
import { Download, ShieldCheck, FileText, CheckCircle } from "lucide-react";
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

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <span>{report.reportName}</span>
        </div>
      }
      subtitle={`Repository: ${report.repositoryName} • Format: ${report.format}`}
      footer={
        <Button
          variant="primary"
          leftIcon={<Download className="w-4 h-4" />}
          onClick={() => alert(`Downloading ${report.reportName}...`)}
        >
          Download Report ({formatBytes(report.sizeBytes)})
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Report Overview Header */}
        <div className="bg-card p-4 border border-border rounded-lg space-y-2">
          <span className="text-xs font-semibold text-text-muted uppercase">Audit Summary</span>
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold font-mono text-success">{report.healthScore}% Overall Health</span>
            <span className="text-xs text-text-secondary">Generated {report.reviewDate}</span>
          </div>
        </div>

        {/* Audit Details */}
        <div className="space-y-3 text-xs">
          <h4 className="font-semibold text-text-muted uppercase tracking-wider">Report Contents</h4>
          <div className="bg-surface p-4 border border-border rounded-lg space-y-2 text-text-secondary">
            <div className="flex items-center gap-2 text-text-primary font-medium">
              <CheckCircle className="w-4 h-4 text-success" /> Static Analysis Results (Bandit & Pylint)
            </div>
            <div className="flex items-center gap-2 text-text-primary font-medium">
              <CheckCircle className="w-4 h-4 text-success" /> CodeBERT ML Confidence Classifications
            </div>
            <div className="flex items-center gap-2 text-text-primary font-medium">
              <CheckCircle className="w-4 h-4 text-success" /> Explainable AI Root Causes & Code Diffs
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  );
};
