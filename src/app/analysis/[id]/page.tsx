"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Metric, PageHeading, ResourceState, StatusLabel, formatDuration, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";

const finalStates = new Set(["COMPLETED", "PARTIAL", "FAILED", "UNAVAILABLE"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (character) => character.toUpperCase());
}

function diagnostics(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

export default function AnalysisDetailPage() {
  const params = useParams<{ id: string }>();
  const load = useCallback(() => bugzeroApi.getAnalysisStatus(params.id), [params.id]);
  const resource = useApiResource(load);
  const status = resource.data;

  useEffect(() => {
    if (!status || finalStates.has(status.status)) return;
    const timer = setTimeout(resource.refresh, 1800);
    return () => clearTimeout(timer);
  }, [status, resource.refresh]);

  const metrics = status?.progress ?? {};
  const mlReport = asRecord(metrics.mlSignals);
  const aiReport = asRecord(metrics.aiInvestigation);
  const analyzerReports = Array.isArray(metrics.analyzers)
    ? metrics.analyzers.map(asRecord).filter((report): report is Record<string, unknown> => report !== null)
    : [];
  const diagnosticGroups = [
    { label: "Parsing", items: diagnostics(metrics.parseDiagnostics) },
    { label: "Resource budget", items: diagnostics(metrics.budgetDiagnostics) },
    ...analyzerReports.map((report, index) => ({
      label: `Analyzer ${index + 1}`,
      items: diagnostics(report.diagnostics),
    })),
  ].filter((group): group is { label: string; items: string[] } => group.items !== null);
  const reportedProgress = [
    ["Source files", metrics.sourceFiles],
    ["Parsed files", metrics.parsedFiles],
    ["Persisted entities", metrics.persistedEntities],
    ["IR entities", metrics.irEntityCount],
    ["IR relationships", metrics.irRelationshipCount],
    ["Persisted relationships", metrics.persistedRelationshipCount],
    ["Findings", metrics.findings],
  ] as const;
  const mlStatus = typeof mlReport?.status === "string" ? humanize(mlReport.status) : "Not reported";
  const aiStatus = typeof aiReport?.status === "string" ? humanize(aiReport.status) : "Not reported";
  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/history" className="inline-flex items-center gap-2 text-xs text-text-muted hover:text-white"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Analysis history</Link>
        <PageHeading eyebrow="Analysis run" title={params.id} description="Analysis status, workflow stage, and available progress details." action={status && !finalStates.has(status.status) ? <RefreshCw className="h-4 w-4 animate-spin text-primary" aria-label="Analysis is active" /> : undefined} />
        <ResourceState loading={resource.loading} error={resource.error} empty={!status} retry={resource.refresh} emptyTitle="Analysis run not found" />
        {status && !resource.error && (
          <>
            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4"><div><p className="text-xs text-text-muted">Run status</p><p className="mt-2 text-sm text-white">{humanize(status.status)}</p></div><StatusLabel value={status.status === "NOT_STARTED" && ["QUEUED", "RETRY"].includes(status.job?.status ?? "") ? "QUEUED" : status.status} /></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Job stage" value={status.job?.stage ? humanize(status.job.stage) : "Not reported"} />
              <Metric label="Job state" value={status.job?.status ? humanize(status.job.status) : "Not reported"} />
              <Metric label="Started" value={formatTimestamp(status.startedAt)} />
              <Metric label="Duration" value={formatDuration(status.startedAt, status.completedAt)} />
            </div>
            {status.failure && <div role="alert" className="rounded-lg border border-rose-800/60 bg-rose-950/20 p-4 text-sm text-rose-100">{status.failure}</div>}
            <section className="rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-white">Analysis output</h2><p className="mt-1 text-xs text-text-muted">Only values returned by the analysis pipeline are shown; unreported values remain explicit.</p></div>
              <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
                {reportedProgress.map(([label, value]) => <Metric key={label} label={label} value={value === undefined ? "Not reported" : String(value)} />)}
                <Metric label="Pipeline outcome" value={typeof metrics.status === "string" ? humanize(metrics.status) : "Not reported"} />
                <Metric label="ML inference" value={mlStatus} detail={mlReport ? "Status returned by this analysis." : "No ML status was returned by this analysis."} />
                <Metric label="AI investigation" value={aiStatus} detail={aiReport ? "Run-level investigation status; finding explanations are listed separately." : "No run-level AI investigation status was returned."} />
              </div>
            </section>
            {analyzerReports.length > 0 && (
              <section className="rounded-xl border border-border bg-card">
                <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-white">Analyzers</h2></div>
                <div className="divide-y divide-border">
                  {analyzerReports.map((report, index) => {
                    const analyzerDiagnostics = diagnostics(report.diagnostics) ?? [];
                    const analyzerMetrics = asRecord(report.metrics);
                    const metricsText = analyzerMetrics
                      ? Object.entries(analyzerMetrics)
                        .filter(([, value]) => typeof value !== "object" && value !== null)
                        .map(([key, value]) => `${humanize(key)}: ${String(value)}`)
                        .join(" · ")
                      : "Metrics not reported";
                    return <div key={index} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                      <div><p className="text-xs font-medium text-white">Analyzer {index + 1}</p><p className="mt-1 text-[10px] text-text-muted">{metricsText || "No scalar metrics reported"}</p></div>
                      <StatusLabel value={typeof report.status === "string" ? report.status : "UNKNOWN"} />
                      {analyzerDiagnostics.length > 0 && <ul className="w-full list-inside list-disc space-y-1 text-xs text-amber-200">{analyzerDiagnostics.map((diagnostic, diagnosticIndex) => <li key={`${index}-${diagnosticIndex}`}>{diagnostic}</li>)}</ul>}
                    </div>;
                  })}
                </div>
              </section>
            )}
            {diagnosticGroups.length > 0 ? (
              <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-white">Warnings and diagnostics</h2>
                {diagnosticGroups.every((group) => group.items.length === 0)
                  ? <p className="mt-2 text-xs text-text-muted">No diagnostics were reported by the available stages.</p>
                  : <div className="mt-3 space-y-3">{diagnosticGroups.filter((group) => group.items.length > 0).map((group) => (
                    <div key={group.label}><h3 className="text-xs font-medium text-text-secondary">{group.label}</h3><ul className="mt-1 list-inside list-disc space-y-1 text-xs leading-5 text-amber-200">{group.items.map((item, index) => <li key={`${group.label}-${index}`}>{item}</li>)}</ul></div>
                  ))}</div>}
              </section>
            ) : <p className="rounded-xl border border-border bg-card p-4 text-xs text-text-muted">Diagnostic details were not reported for this run.</p>}
            <p className="text-[10px] leading-5 text-text-muted">Analysis progress is represented by workflow stages rather than a percentage.</p>
          </>
        )}
      </div>
    </AppShell>
  );
}
