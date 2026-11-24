"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Download,
  FileDown,
  FileJson,
  FileText,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import type { ApiReport, ApiReportDocument, ApiRepository, RepositoryHistoryEntry } from "@/domains/product/types";
import { PageHeading, ResourceState, StatusLabel, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";
import { sortNewestFirst } from "@/lib/analysis-order";
import { reportFindingsCsv, reportPdfBlob } from "@/lib/report-export";

interface ReportsData {
  repositories: ApiRepository[];
  reports: ApiReport[];
}

const LATEST_ANALYSIS = "__latest__";

function downloadFile(filename: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function filenamePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "repository";
}

function FindingCard({ finding }: { finding: ApiReportDocument["findings"]["security"][number] }) {
  return (
    <article className="space-y-3 border-t border-border px-4 py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-white">{finding.title}</h4>
          <p className="mt-1 font-mono text-[10px] text-text-muted">{finding.ruleId} · {finding.findingId}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusLabel value={finding.severity} />
          <StatusLabel value={`${finding.confidence} confidence`} />
          <StatusLabel value={finding.lifecycle} />
          <StatusLabel value={finding.evidenceAuthority} />
          <StatusLabel value={finding.evidenceStatus} />
        </div>
      </div>
      <p className="text-xs leading-5 text-text-secondary">
        {finding.description ?? "Unknown — no finding description was persisted for this analysis."}
      </p>
      <p className="break-all font-mono text-[11px] text-text-muted">
        {finding.filePath ?? "Unknown location"}{finding.startLine ? `:${finding.startLine}` : ""}
        {finding.endLine && finding.endLine !== finding.startLine ? `–${finding.endLine}` : ""}
      </p>
      <div className="rounded-lg border border-border/70 bg-background/70 p-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Persisted evidence</p>
        <ul className="space-y-1 text-xs leading-5 text-text-secondary">
          {finding.evidence.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}
        </ul>
      </div>
      {finding.investigativeEstimate && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
            AI investigative estimate · {finding.investigativeEstimate.confidence} confidence
          </p>
          <p className="text-xs font-medium text-amber-100">{finding.investigativeEstimate.summary}</p>
          <p className="mt-1 text-xs leading-5 text-amber-100/80">{finding.investigativeEstimate.explanation}</p>
          <p className="mt-2 text-[10px] text-amber-200/70">
            Advisory only ({finding.investigativeEstimate.reasoningStatus.replaceAll("_", " ")}); does not alter the deterministic finding.
          </p>
        </div>
      )}
    </article>
  );
}

function ReportPreview({ report, onDownload }: {
  report: ApiReportDocument;
  onDownload(format: "pdf" | "json" | "csv"): void;
}) {
  const dimensions = [
    ["Code quality", report.results.quality],
    ["Maintainability", report.results.maintainability],
    ["Reliability", report.results.reliability],
    ["Dependencies", report.results.dependencies],
  ] as const;
  return (
    <section className="space-y-5" aria-labelledby="report-preview-heading">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Report preview</p>
          <h2 id="report-preview-heading" className="mt-1 text-lg font-semibold text-white">{report.repository.name}</h2>
          <p className="mt-1 text-xs text-text-muted">
            Analysis {formatTimestamp(report.analysis.completedAt ?? report.analysis.createdAt)}
            {" · "}{report.analysis.scope.replaceAll("_", " ")}
            {" · "}<StatusLabel value={report.analysis.status} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onDownload("pdf")} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-black hover:brightness-110">
            <FileDown className="h-4 w-4" aria-hidden="true" /> Download PDF
          </button>
          <button onClick={() => onDownload("json")} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-white hover:border-primary">
            <FileJson className="h-4 w-4" aria-hidden="true" /> JSON
          </button>
          <button onClick={() => onDownload("csv")} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-white hover:border-primary">
            <Download className="h-4 w-4" aria-hidden="true" /> Findings CSV
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-white">Executive summary</h3>
        <p className="mt-2 text-sm leading-6 text-text-secondary">{report.executiveSummary}</p>
        <p className="mt-3 text-xs text-text-muted">
          Commit: <span className="font-mono">{report.analysis.commitSha ?? "Unknown"}</span>
          {" · "}Coverage: <StatusLabel value={report.results.coverage.status} />
          {" · "}Findings: {report.findings.total}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dimensions.map(([label, result]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
            <p className="mt-2 font-mono text-xl text-white">{result.score === null ? "Unknown" : result.score}</p>
            <StatusLabel value={result.status} />
          </div>
        ))}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-wide text-text-muted">Coverage</p>
          <p className="mt-2 font-mono text-xl text-white">{report.results.coverage.status}</p>
          <p className="mt-1 text-xs text-text-muted">No percentage is inferred where the analysis did not persist one.</p>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Findings by severity</h3>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {Object.entries(report.findings.bySeverity).map(([severity, count]) => (
            <span key={severity} className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-secondary">
              {severity}: {count}
            </span>
          ))}
        </div>
        {report.findings.total === 0 && (
          <p className="border-t border-border px-4 py-6 text-sm text-text-muted">
            No findings were recorded for this analysis. This is not a guarantee of zero risk; review analysis coverage and status.
          </p>
        )}
        {report.findings.security.length > 0 && (
          <>
            <h4 className="border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary">Security</h4>
            {report.findings.security.map((finding) => <FindingCard key={finding.findingId} finding={finding} />)}
          </>
        )}
        {report.findings.codeQuality.length > 0 && (
          <>
            <h4 className="border-t border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary">Code quality and maintainability</h4>
            {report.findings.codeQuality.map((finding) => <FindingCard key={finding.findingId} finding={finding} />)}
          </>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-white">Recommendations grounded in findings</h3>
        </div>
        {report.recommendations.length === 0 ? (
          <p className="px-4 py-4 text-xs text-text-muted">No finding-based recommendations are available for this analysis.</p>
        ) : report.recommendations.map((recommendation, index) => (
          <article key={`${recommendation.basis}-${index}`} className="border-t border-border px-4 py-3 first:border-t-0">
            <p className="text-sm text-text-secondary">{recommendation.text}</p>
            <p className="mt-1 text-[10px] text-text-muted">
              Basis: {recommendation.basis} · {recommendation.authority}
            </p>
          </article>
        ))}
      </section>

      <section className="rounded-xl border border-border bg-background/70 p-4">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-white">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" /> Evidence and authority
        </h3>
        <p className="mt-2 text-xs leading-5 text-text-secondary">{report.evidencePolicy.authoritative}</p>
        <p className="mt-2 text-xs leading-5 text-text-muted">{report.evidencePolicy.investigative}</p>
      </section>
    </section>
  );
}

export default function ReportsPage() {
  const load = useCallback(async (): Promise<ReportsData> => {
    const repositories = await bugzeroApi.listRepositories();
    const reportsByRepository = await Promise.all(
      repositories.map((repository) => bugzeroApi.getRepositoryReports(repository.id)),
    );
    return {
      repositories,
      reports: reportsByRepository.flat().sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)),
    };
  }, []);
  const resource = useApiResource(load, { key: "reports", staleTimeMs: 30_000 });
  const [repositoryId, setRepositoryId] = useState("");
  const [analysisChoice, setAnalysisChoice] = useState(LATEST_ANALYSIS);
  const [report, setReport] = useState<ApiReportDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const data = resource.data;
  const selectedRepositoryId = data?.repositories.some((repository) => repository.id === repositoryId)
    ? repositoryId
    : data?.repositories[0]?.id ?? "";
  const selectedRepository = data?.repositories.find((repository) => repository.id === selectedRepositoryId);
  const loadHistory = useCallback(
    () => selectedRepositoryId
      ? bugzeroApi.getRepositoryHistory(selectedRepositoryId)
      : Promise.resolve([] as RepositoryHistoryEntry[]),
    [selectedRepositoryId],
  );
  const historyResource = useApiResource(loadHistory, {
    key: selectedRepositoryId ? `reports-history:${selectedRepositoryId}` : "reports-history:none",
    staleTimeMs: 30_000,
  });
  const completedAnalyses = useMemo(
    () => sortNewestFirst(
      (historyResource.data ?? []).filter(({ run }) => run.status === "COMPLETED" || run.status === "PARTIAL"),
      ({ run }) => run.completedAt ?? run.createdAt,
    ),
    [historyResource.data],
  );
  const selectedAnalysis = analysisChoice === LATEST_ANALYSIS
    ? completedAnalyses[0]?.run ?? null
    : completedAnalyses.find(({ run }) => run.id === analysisChoice)?.run ?? null;

  const showReport = async (reportId: string) => {
    setBusy(true);
    setActionError(null);
    try {
      setReport(await bugzeroApi.getReport(reportId));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The report could not be loaded.");
    } finally {
      setBusy(false);
    }
  };

  const generateReport = async () => {
    if (!selectedRepositoryId || !selectedAnalysis) return;
    setBusy(true);
    setActionError(null);
    try {
      const generated = await bugzeroApi.generateRepositoryReport(selectedRepositoryId, selectedAnalysis.id);
      setReport(generated);
      resource.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The report could not be generated.");
    } finally {
      setBusy(false);
    }
  };

  const exportReport = (format: "pdf" | "json" | "csv") => {
    if (!report) return;
    const base = `${filenamePart(report.repository.name)}-${report.analysis.runId}`;
    if (format === "pdf") downloadFile(`${base}.pdf`, reportPdfBlob(report), "application/pdf");
    if (format === "json") downloadFile(`${base}.json`, JSON.stringify(report, null, 2), "application/json;charset=utf-8");
    if (format === "csv") downloadFile(`${base}-findings.csv`, reportFindingsCsv(report), "text/csv;charset=utf-8");
  };

  const summaries = data?.reports ?? [];
  const repositoryNames = new Map((data?.repositories ?? []).map(({ id, fullName }) => [id, fullName]));

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Persisted analysis report"
        title="Reports"
        description="Generate an evidence-based report from a completed BugZero analysis, preview it, and export the same persisted report."
        action={(
          <button
            onClick={generateReport}
            disabled={!selectedAnalysis || busy || resource.loading || historyResource.loading}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
            Generate Report
          </button>
        )}
      />

      <ResourceState
        loading={resource.loading && resource.data === null}
        error={resource.error}
        refreshError={resource.refreshError}
        empty={false}
        retry={resource.refresh}
      />
      {data && selectedRepositoryId && (
        <ResourceState
          loading={historyResource.loading && historyResource.data === null}
          error={historyResource.error}
          refreshError={historyResource.refreshError}
          empty={false}
          retry={historyResource.refresh}
        />
      )}

      {data && !resource.error && (
        <>
          {data.repositories.length === 0 ? (
            <section className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-sm font-semibold text-white">No repositories available</h2>
              <p className="mt-2 text-sm text-text-muted">Add a repository and run an analysis before generating a report.</p>
              <Link href="/repositories" className="mt-4 inline-flex text-xs text-primary hover:underline">Explore repositories →</Link>
            </section>
          ) : (
            <section className="grid gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <label className="block text-xs text-text-secondary">
                Repository
                <select
                  value={selectedRepositoryId}
                  onChange={(event) => {
                    setRepositoryId(event.target.value);
                    setAnalysisChoice(LATEST_ANALYSIS);
                    setReport(null);
                    setActionError(null);
                  }}
                  className="mt-2 block min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-white focus:border-primary focus:outline-none"
                >
                  {data.repositories.map((repository) => (
                    <option key={repository.id} value={repository.id}>{repository.fullName}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-text-secondary">
                Analysis
                <select
                  value={analysisChoice}
                  onChange={(event) => {
                    setAnalysisChoice(event.target.value);
                    setReport(null);
                    setActionError(null);
                  }}
                  disabled={completedAnalyses.length === 0}
                  className="mt-2 block min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-white focus:border-primary focus:outline-none disabled:opacity-50"
                >
                  <option value={LATEST_ANALYSIS}>Latest completed analysis</option>
                  {completedAnalyses.map(({ run }) => (
                    <option key={run.id} value={run.id}>
                      {run.status} · {formatTimestamp(run.completedAt ?? run.createdAt)} · {run.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-text-muted">
                {selectedAnalysis
                  ? `${selectedAnalysis.status} analysis · ${selectedAnalysis.id}`
                  : "No completed analysis is available."}
              </p>
            </section>
          )}

          {data.repositories.length > 0
            && completedAnalyses.length === 0
            && !historyResource.loading
            && !historyResource.error
            && !historyResource.refreshError && (
            <section className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4">
              <h2 className="text-sm font-semibold text-amber-100">Run an analysis first</h2>
              <p className="mt-1 text-xs leading-5 text-amber-100/75">
                There is no completed or partial analysis for {selectedRepository?.fullName ?? "this repository"} yet.
                Generate a report after an analysis finishes.
              </p>
              {selectedRepository && (
                <Link href={`/repositories/${selectedRepository.id}`} className="mt-3 inline-flex text-xs font-medium text-primary hover:underline">
                  Open repository →
                </Link>
              )}
            </section>
          )}

          {actionError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-900/70 bg-rose-950/30 px-4 py-3 text-xs text-rose-100">
              <span>{actionError}</span>
              {report && <button onClick={() => showReport(report.id)} className="underline">Retry</button>}
            </div>
          )}

          {summaries.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-white">Report history</h2>
              </div>
              <div className="divide-y divide-border">
                {summaries.map((summary) => (
                  <article key={summary.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{repositoryNames.get(summary.repositoryId) ?? "Repository unavailable"}</p>
                      <p className="mt-1 break-all font-mono text-[10px] text-text-muted">Analysis {summary.analysisRunId}</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-secondary">
                      <span>{formatTimestamp(summary.createdAt)}</span>
                      <button
                        onClick={() => showReport(summary.id)}
                        disabled={busy}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-white hover:border-primary disabled:opacity-50"
                      >
                        View report
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {busy && !report && <p role="status" className="text-xs text-text-muted">Loading report…</p>}
      {report && <ReportPreview report={report} onDownload={exportReport} />}
    </div>
  );
}
