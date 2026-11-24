"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Metric, PageHeading, ResourceState, StatusLabel, UnknownValue, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { useWorkspaceState } from "@/hooks/useWorkspaceState";
import { bugzeroApi } from "@/lib/api-client";

const EMPTY_REPOSITORIES: Awaited<ReturnType<typeof bugzeroApi.listRepositories>> = [];

function HealthContent() {
  const params = useSearchParams();
  const queryRepositoryId = params.get("repositoryId") ?? "";
  const [selectedId, setSelectedId] = useWorkspaceState(`health:${queryRepositoryId || "default"}:repository`, "");
  const loadRepositories = useCallback(() => bugzeroApi.listRepositories(), []);
  const repositoriesResource = useApiResource(loadRepositories, { key: "health-repository-list", staleTimeMs: 30_000 });
  const repositories = repositoriesResource.data ?? EMPTY_REPOSITORIES;
  const selection = selectedId || queryRepositoryId || repositories[0]?.id || "";
  const current = useMemo(() => repositories.find((repository) => repository.id === selection), [repositories, selection]);
  const loadHistory = useCallback(async () => selection
    ? bugzeroApi.getHealthHistory(selection)
    : [], [selection]);
  const historyResource = useApiResource(loadHistory, {
    key: `health:${selection || "none"}`,
    staleTimeMs: 30_000,
    revalidateIntervalMs: 30_000,
  });
  const snapshots = historyResource.data ?? [];
  const latest = snapshots[0]?.snapshot;
  const latestRunStatus = snapshots[0]?.analysisRunStatus ?? null;
  const dimensions = latest?.dimensions;
  const dimensionNames = ["security", "quality", "maintainability", "reliability", "dependencies"] as const;
  const supported = dimensionNames.filter((name) => dimensions?.[name]?.score !== null && dimensions?.[name]?.score !== undefined);
  const unknown = dimensionNames.filter((name) => dimensions?.[name]?.score == null);
  const aiEstimatedOverallScore = typeof latest?.calculation?.aiEstimatedOverallScore === "number"
    ? latest.calculation.aiEstimatedOverallScore
    : null;
  const aiReview = latest?.calculation?.aiReview && typeof latest.calculation.aiReview === "object"
    ? latest.calculation.aiReview as { status?: unknown; errorCode?: unknown; providerStatus?: unknown }
    : null;
  const sourceFileCoverage = latest?.calculation?.sourceFileCoverage
    && typeof latest.calculation.sourceFileCoverage === "object"
    ? latest.calculation.sourceFileCoverage as {
      parsedFileCount?: unknown;
      sourceFileCount?: unknown;
      coveragePercent?: unknown;
    }
    : null;
  const reviewMessage = aiReview?.status === "UNAVAILABLE" && aiReview.errorCode === "MISSING_CONFIGURATION"
    ? "Advisory source review is not configured. Deterministic results are retained; enable the optional backend review setting and rerun analysis to add estimates."
    : aiReview?.status === "FAILED"
      ? aiReview.errorCode === "RATE_LIMITED"
        ? "Advisory source review was temporarily rate-limited. Rerun analysis later; completed deterministic results are retained."
        : aiReview.errorCode === "CONTEXT_TOO_LARGE"
          ? "The selected source exceeded the advisory review limit. Deterministic results are retained; reduce the source scope and rerun analysis."
          : "Advisory source review could not be completed. Deterministic results are retained; rerun analysis to try again."
      : null;
  const suggestions = dimensionNames.flatMap((name) => (dimensions?.[name]?.aiFindings ?? [])
    .map((finding) => ({ ...finding, dimension: name })));
  const loading = (repositoriesResource.loading && repositoriesResource.data === null)
    || (selection !== "" && historyResource.loading && historyResource.data === null);
  const error = repositoriesResource.error ?? historyResource.error;
  const refreshError = repositoriesResource.refreshError ?? historyResource.refreshError;
  const refreshRepositories = repositoriesResource.refresh;
  const refreshHistory = historyResource.refresh;
  const refresh = useCallback(() => {
    refreshRepositories();
    if (selection) refreshHistory();
  }, [refreshHistory, refreshRepositories, selection]);

  return (
    <div className="space-y-6">
        <PageHeading eyebrow="Verified and estimated health" title="Repository health" description="Deterministic scores and advisory estimates are stored separately. Unknown dimensions are never treated as healthy." />
        <p className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-xs leading-5 text-amber-100">Verified security scores currently cover deterministic SQL Injection findings only. An advisory estimate is not a verified score, and a security score of 100 does not mean the repository is vulnerability-free.</p>
        <ResourceState loading={loading} error={error} refreshError={refreshError} empty={repositories.length === 0} retry={refresh} emptyTitle="No repositories are available" />
        {!error && repositories.length > 0 && (
          <>
            <label className="block max-w-lg text-[10px] uppercase tracking-wide text-text-muted">Repository<select value={selection} onChange={(event) => setSelectedId(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-white">{repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.fullName}</option>)}</select></label>
            {!latest ? <section className="rounded-xl border border-border bg-card p-6"><h2 className="text-sm font-semibold text-white">No health snapshot</h2><p className="mt-2 text-sm text-text-muted">No persisted health assessment is available for this repository.</p><Link href={current ? `/repositories/${current.id}` : "/repositories"} className="mt-4 inline-block text-xs text-primary hover:underline">Open repository →</Link></section> : (
              <>
                <section className="rounded-xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0"><p className="truncate text-xs text-text-muted">{current?.fullName}</p><div className="mt-2 flex items-baseline gap-2"><span className="font-mono text-5xl font-semibold text-white">{latest.overall_score ?? "Unknown"}</span>{latest.overall_score !== null && <span className="text-xs text-text-muted">/ 100</span>}</div><p className="mt-2 text-xs text-text-muted">{latest.coverage === "PARTIAL" ? latest.overall_score === null ? "Partial health coverage; overall score unavailable" : "Partial health coverage" : latest.coverage === "UNKNOWN" ? "Overall health unavailable" : "Verified overall health"} <StatusLabel value={latest.coverage === "PARTIAL" ? "PARTIAL" : latest.coverage === "UNKNOWN" ? "UNKNOWN" : latest.overall_status ?? "UNKNOWN"} /></p>{aiEstimatedOverallScore !== null && latest.coverage === "COMPLETE" && <p className="mt-3 text-xs text-text-secondary">Combined health (verified scores plus AI estimates for unknown dimensions) <span className="font-mono font-semibold text-white">{aiEstimatedOverallScore}/100</span></p>}</div>
                  <div className="flex flex-wrap gap-2"><StatusLabel value={latestRunStatus ?? "RUN_STATUS_UNKNOWN"} /><StatusLabel value={latest.overall_status ?? "UNKNOWN"} /><StatusLabel value={latest.coverage ?? "UNKNOWN"} /><StatusLabel value={latest.profile_id ? `${latest.profile_id} v${latest.profile_version}` : "LEGACY SNAPSHOT"} /></div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-amber-100">{latest.overall_score === null
                  ? "Health score unavailable; no numeric score is calculated."
                  : latestRunStatus === "PARTIAL" || latest.coverage === "PARTIAL"
                    ? "Analysis or health coverage is partial. The displayed score is preserved, but reflects only available dimensions and is not a complete assessment."
                    : latestRunStatus === "COMPLETED" && latest.coverage === "COMPLETE"
                      ? "Analysis completed and all health dimensions are covered for this snapshot."
                      : "Analysis completeness could not be verified; interpret this score cautiously."}</p>
                  {reviewMessage && <p role="status" className="mt-3 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">{reviewMessage}</p>}
                  <p className="mt-4 max-w-4xl text-sm leading-6 text-text-secondary">{latest.explanation ?? "No assessment explanation was recorded."}</p>
                  <p className="mt-2 text-[10px] text-text-muted">Snapshot from {formatTimestamp(latest.created_at)} · Commit {snapshots[0]?.commitSha ?? "unknown"}</p>
                </section>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {dimensionNames.map((name) => {
                    const dimension = dimensions?.[name];
                    return <section key={name} className="min-w-0 rounded-xl border border-border bg-card p-4">
                      <p className="capitalize text-[11px] font-medium text-text-muted">{name}</p>
                      {dimension?.score !== null && dimension?.score !== undefined
                        ? <p className="mt-3 text-xs text-text-muted">Verified <span className="ml-1 font-mono text-2xl font-semibold text-white">{dimension.score}</span></p>
                        : <div className="mt-3"><UnknownValue explanation={dimension?.explanation ?? "No verified score is present in this snapshot."} /></div>}
                      {dimension?.estimatedScore !== null && dimension?.estimatedScore !== undefined && <p className="mt-3 text-xs text-text-muted">AI-estimated <span className="ml-1 font-mono text-xl font-semibold text-white">{dimension.estimatedScore}</span>{dimension.estimateConfidence && <span className="ml-2">({dimension.estimateConfidence.toLowerCase()} confidence)</span>}</p>}
                      <div className="mt-3"><StatusLabel value={dimension?.coverage ?? "UNKNOWN"} /></div>
                      {dimension && <p className="mt-3 text-[10px] leading-5 text-text-muted">{dimension.explanation}</p>}
                      {dimension?.estimateExplanation && <p className="mt-2 text-[10px] leading-5 text-text-secondary">Estimate: {dimension.estimateExplanation}</p>}
                      {dimension?.estimateCoverage && <p className="mt-2 text-[10px] leading-5 text-text-muted">AI review input: {dimension.estimateCoverage.sourceFilesProvided}/{dimension.estimateCoverage.sourceFilesAvailable} source files supplied{dimension.estimateCoverage.sourceCoveragePercent === null ? "" : ` (${dimension.estimateCoverage.sourceCoveragePercent}%)`}; {dimension.estimateCoverage.dependencyManifestsProvided} dependency manifest(s) supplied.</p>}
                    </section>;
                  })}
                </div>
                {suggestions.length > 0 && <section className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-white">Advisory review suggestions</h2><p className="mt-1 text-xs text-text-muted">Suggestions are not verified findings. Review the cited source before acting.</p></div>
                  <div className="divide-y divide-border">{suggestions.map((finding, index) => <article key={`${finding.dimension}:${finding.filePath}:${finding.startLine}:${index}`} className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-xs font-semibold text-white">{finding.title}</h3><StatusLabel value={finding.severity} /><span className="capitalize text-[10px] text-text-muted">{finding.dimension}</span></div>
                    <p className="text-xs leading-5 text-text-secondary">{finding.explanation}</p>
                    <p className="font-mono text-[10px] text-text-muted">{finding.filePath}:{finding.startLine}{finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""}</p>
                    <p className="text-xs leading-5 text-text-muted">Suggested action: {finding.remediation}</p>
                  </article>)}</div>
                </section>}
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Analyzed capabilities" value={supported.length ? supported.join(", ") : "None reported"} detail="Based only on dimensions with persisted scores." />
                  <Metric label="Unknown capabilities" value={unknown.length ? unknown.join(", ") : "None"} detail="Unsupported or unavailable dimensions remain explicitly unknown." />
                  <Metric
                    label="Parser-inspected source files"
                    value={typeof sourceFileCoverage?.parsedFileCount === "number" && typeof sourceFileCoverage.sourceFileCount === "number"
                      ? `${sourceFileCoverage.parsedFileCount} / ${sourceFileCoverage.sourceFileCount}`
                      : "Unknown"}
                    detail={typeof sourceFileCoverage?.coveragePercent === "number"
                      ? `${sourceFileCoverage.coveragePercent}% of source files supplied to this analysis were passed through a supported parser.`
                      : "File counts come from this run's actual parser inputs; no repository-wide percentage is inferred."}
                  />
                </div>
                <section className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-white">Health history</h2><p className="mt-1 text-xs text-text-muted">{snapshots.length} persisted snapshots. Score changes compare adjacent returned snapshots only.</p></div>
                  {snapshots.length === 0 ? <p className="px-4 py-8 text-sm text-text-muted">No historical snapshots are available.</p> : (
                    <div className="divide-y divide-border">
                      {snapshots.map(({ snapshot, commitSha, analysisRunStatus }, index) => {
                        const previous = snapshots[index + 1]?.snapshot.overall_score;
                        const score = snapshot.overall_score;
                        const delta = score !== null && previous !== null && previous !== undefined ? score - previous : null;
                        return <div key={snapshot.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_140px_100px_100px_100px] sm:items-center">
                          <div className="min-w-0"><p className="truncate font-mono text-xs text-white">{commitSha ?? snapshot.commit_id}</p><p className="mt-1 text-[10px] text-text-muted">{formatTimestamp(snapshot.created_at)}</p></div>
                          <span className="font-mono text-xs text-text-secondary">{score ?? "Unknown"}</span>
                          <span className="text-xs text-text-secondary">{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}</span>
                          <div className="flex flex-wrap gap-1"><StatusLabel value={analysisRunStatus ?? "RUN_STATUS_UNKNOWN"} /><StatusLabel value={snapshot.coverage ?? "UNKNOWN"} /></div>
                          {snapshot.analysis_run_id ? <Link href={`/history?repositoryId=${snapshot.repository_id}`} className="text-xs text-primary hover:underline">Analysis run</Link> : <span className="text-xs text-text-muted">No run link</span>}
                        </div>;
                      })}
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
    </div>
  );
}

export default function HealthPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background p-8 text-sm text-text-muted">Preparing repository health…</main>}>
      <HealthContent />
    </Suspense>
  );
}
