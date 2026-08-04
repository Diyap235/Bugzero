"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Finding, FindingStatus, Review } from "@/types";
import { FindingsTable } from "@/components/findings/FindingsTable";
import { FindingDrawer } from "@/components/findings/FindingDrawer";
import { SearchBar } from "@/components/shared/SearchBar";
import { FilterBar } from "@/components/shared/FilterBar";
import { Toast, ToastMessage } from "@/components/shared/Toast";
import { findingService } from "@/services/finding.service";

interface FindingsTabProps {
  repoId: string;
  latestReview: Review | undefined;
  initialFindings: Finding[];
  isLoading: boolean;
  onFindingUpdated: () => void;
}

export const FindingsTab: React.FC<FindingsTabProps> = ({
  repoId,
  latestReview,
  initialFindings,
  isLoading,
  onFindingUpdated,
}) => {
  const [findings, setFindings] = useState<Finding[]>(initialFindings);
  const [filtered, setFiltered] = useState<Finding[]>(initialFindings);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("All");
  const [status, setStatus] = useState("All");
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // Sync when parent updates findings
  useEffect(() => {
    setFindings(initialFindings);
  }, [initialFindings]);

  // Filter findings client-side for instant UX
  useEffect(() => {
    let result = [...findings];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.file.toLowerCase().includes(q) ||
          f.summary.toLowerCase().includes(q)
      );
    }
    if (severity !== "All") {
      result = result.filter((f) => f.severity === severity.toLowerCase());
    }
    if (status !== "All") {
      result = result.filter((f) => f.status === status.toLowerCase());
    }
    setFiltered(result);
  }, [findings, search, severity, status]);

  const handleSelectFinding = (finding: Finding) => {
    setSelectedFinding(finding);
    setIsDrawerOpen(true);
  };

  const handleUpdateStatus = async (id: string, newStatus: FindingStatus) => {
    try {
      const updated = await findingService.updateFindingStatus(id, newStatus);
      setFindings((prev) => prev.map((f) => (f.id === id ? updated : f)));
      setSelectedFinding(updated);
      setToast({
        id: Date.now().toString(),
        type: "success",
        message: `Finding marked as ${newStatus}.`,
      });
      onFindingUpdated();
    } catch {
      setToast({
        id: Date.now().toString(),
        type: "danger",
        message: "Failed to update finding status.",
      });
    }
  };

  // Count by severity for filter badges
  const countBySeverity = (sev: string) =>
    findings.filter((f) => f.severity === sev.toLowerCase()).length;
  const countByStatus = (s: string) =>
    findings.filter((f) => f.status === s.toLowerCase()).length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4">
        <div className="flex-1 max-w-md">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search findings by title, file... (/)"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <FilterBar
            title="Severity"
            selectedValue={severity}
            onSelect={setSeverity}
            options={[
              { label: "All", value: "All", count: findings.length },
              { label: "Critical", value: "critical", count: countBySeverity("critical") },
              { label: "High", value: "high", count: countBySeverity("high") },
              { label: "Medium", value: "medium", count: countBySeverity("medium") },
              { label: "Low", value: "low", count: countBySeverity("low") },
            ]}
          />
          <FilterBar
            title="Status"
            selectedValue={status}
            onSelect={setStatus}
            options={[
              { label: "All", value: "All" },
              { label: "Open", value: "open", count: countByStatus("open") },
              { label: "Resolved", value: "resolved", count: countByStatus("resolved") },
              { label: "Ignored", value: "ignored", count: countByStatus("ignored") },
            ]}
          />
        </div>
      </div>

      {/* Review context info */}
      {latestReview && (
        <div className="flex items-center gap-3 text-xs text-text-muted px-1">
          <span className="font-mono">
            Review ID: <span className="text-primary">{latestReview.id}</span>
          </span>
          <span>•</span>
          <span>
            Completed in <span className="text-text-secondary font-semibold">{latestReview.duration}</span>
          </span>
          <span>•</span>
          <span>
            Analyzed by <span className="text-text-secondary font-semibold">{latestReview.reviewer}</span>
          </span>
        </div>
      )}

      {/* Findings Table */}
      <FindingsTable
        findings={filtered}
        onSelectFinding={handleSelectFinding}
        isLoading={isLoading}
      />

      {/* Finding Detail Drawer */}
      <FindingDrawer
        finding={selectedFinding}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onUpdateStatus={handleUpdateStatus}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
};
