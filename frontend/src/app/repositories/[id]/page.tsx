"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Activity, ArrowUpRight, Play, RefreshCw } from "lucide-react";
import { Metric, PageHeading, ResourceState, StatusLabel, UnknownValue, formatDuration, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { ApiError, bugzeroApi } from "@/lib/api-client";
import { getAnalysisActivityLabel } from "@/lib/analysis-status";
import type { AcceptedAnalysis, AnalysisRunStatusResponse } from "@/domains/product/types";

const terminalStatuses = new Set(["COMPLETED", "PARTIAL", "FAILED", "UNAVAILABLE"]);
const stageNames: Record<string, string> = {
  INGESTION: "Ingestion", PARSING: "Parsing", CODE_IR: "Code IR",
  INTELLIGENCE: "Repository intelligence", QUALITY_ANALYSIS: "Quality analysis",
  SECURITY_ANALYSIS: "Security analysis", EVIDENCE: "Evidence graph",
  RISK: "Risk assessment", AI_ENRICHMENT: "AI enrichment",
};
const timingNames: Record<string, string> = {
  databaseInputsMs: "Database input loading",
  sourceReadMs: "Source retrieval",
  parsingAndGraphWriteMs: "Parsing and graph writes",
  intelligenceMs: "Repository intelligence",
  deterministicAnalysisMs: "Deterministic analysis",
  healthAssessmentMs: "Health assessment",
  reviewContextBuildMs: "Review context preparation",
  aiRepositoryReviewMs: "NVIDIA repository review",
  healthSnapshotPersistenceMs: "Health snapshot persistence",
  mlSignalsMs: "ML signals",
  aiInvestigationMs: "AI investigation",
  endToEndMs: "Pipeline total",
};

export default function RepositoryDetailPage() {
  const params = useParams<{ id: string }>();
  const repositoryId = params.id;
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisRunStatusResponse | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [acceptedAnalysis, setAcceptedAnalysis] = useState<AcceptedAnalysis | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pollError, setPollError] = useState(false);
  const [pollRetry, setPollRetry] = useState(0);
  const load = useCallback(() => bugzeroApi.getRepository(repositoryId), [repositoryId]);
  const resource = useApiResource(load, { key: `repository:${repositoryId}`, staleTimeMs: 30_000 });
  const overview = resource.data;
  const refresh = resource.refresh;

  useEffect(() => {
    const latestRun = overview?.latestRun;
    if (!latestRun || activeRunId) return;
    if (analysisStatus?.analysisRunId === latestRun.id && terminalStatuses.has(analysisStatus.status)) return;
    setActiveRunId(latestRun.id);
  }, [activeRunId, analysisStatus?.analysisRunId, analysisStatus?.status, overview?.latestRun]);

  useEffect(() => {
    if (!activeRunId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await bugzeroApi.getAnalysisStatus(activeRunId);
        if (disposed) return;
        setAnalysisStatus(result);
        setPollError(false);
        if (terminalStatuses.has(result.status)) {
          setActiveRunId(null);
          refresh({ invalidate: false });
          return;
        }
        timer = setTimeout(poll, 1800);
      } catch {
        if (!disposed) {
          setPollError(true);
          setActiveRunId(null);
        }
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeRunId, pollRetry, refresh]);

  const startAnalysis = async () => {
    if (!overview?.latestCommit) {
      setRequestError("An indexed revision is needed before this repository can be analyzed.");
      return;
    }
    setRequestError(null);
    setRequesting(true);
    try {
      const accepted = await bugzeroApi.createAnalysis(repositoryId, overview.latestCommit.commitSha, "REPOSITORY");
      setAcceptedAnalysis(accepted);
      setAnalysisStatus(null);
      setPollError(false);
      setActiveRunId(accepted.analysisRunId);
    } catch (reason) {
      setRequestError(reason instanceof ApiError && reason.code === "FORBIDDEN"
        ? "Your account is not permitted to start an analysis."
        : reason instanceof ApiError && reason.code === "NOT_FOUND"
          ? "The repository or indexed commit is no longer available."
          : "Analysis couldn't be started right now. Please try again.");
    } finally {
      setRequesting(false);
    }
  };

  const error = resource.error;
  const health = overview?.latestHealth;
  const dimensions = health?.dimensions;
  const activeStatus = analysisStatus ?? null;
  const isAnalysisRunning = activeRunId !== null
    && !terminalStatuses.has(activeStatus?.status ?? overview?.latestRun?.status ?? "");
  const analysisActivityLabel = getAnalysisActivityLabel(
    activeStatus?.status ?? overview?.latestRun?.status ?? null,
    activeStatus?.job?.status ?? acceptedAnalysis?.status ?? null,
  );
  const rawTimings = activeStatus?.progress.timings;
  const timingEntries = typeof rawTimings === "object" && rawTimings !== null
    ? Object.entries(rawTimings).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0)
    : [];
  const rawReview = activeStatus?.progress.aiReview;
  const review = typeof rawReview === "object" && rawReview !== null && !Array.isArray(rawReview)
    ? rawReview as Record<string, unknown>
    : null;
  const reviewStatus = typeof review?.status === "string" ? review.status : null;
  const reviewErrorCode = typeof review?.errorCode === "string" ? review.errorCode : null;
  const reviewProviderStatus = typeof review?.providerStatus === "number" ? review.providerStatus : null;
  const reviewAttempts = typeof review?.attempts === "number" ? review.attempts : null;
  const reviewResult = typeof review?.result === "object" && review.result !== null
    ? review.result as Record<string, unknown>
    : null;
  const reviewDimensions = typeof reviewResult?.dimensions === "object" && reviewResult.dimensions !== null
    ? Object.values(reviewResult.dimensions).filter((dimension) =>
      typeof dimension === "object" && dimension !== null
      && typeof (dimension as Record<string, unknown>).score === "number").length
    : null;
  const reviewFindings = Array.isArray(reviewResult?.findings) ? reviewResult.findings.length : null;
  const state = (
    <ResourceState loading={resource.loading && resource.data === null} error={error} refreshError={resource.refreshError} empty={!overview} retry={resource.refresh} emptyTitle="Repository not found" />
  );

  return (
    <div className="space-y-6">
        {state}
        {overview && !error && (
          <>
            <PageHeading
              eyebrow={`${overview.repository.provider} repository`}
              title={overview.repository.fullName}
              description={`Default branch: ${overview.repository.defaultBranch} · ${formatTimestamp(overview.repository.createdAt)}`}
              action={
                <button onClick={startAnalysis} disabled={requesting || !overview.latestCommit || isAnalysisRunning} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  {requesting || isAnalysisRunning ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                  {isAnalysisRunning ? analysisActivityLabel : requesting ? "Starting…" : "Analyze repository"}
                </button>
              }
            />
            {!overview.latestCommit && <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-xs text-amber-100">An indexed revision is needed before this repository can be analyzed.</div>}
            {requestError && <div role="alert" className="rounded-lg border border-rose-800/60 bg-rose-950/20 p-3 text-sm text-rose-100">{requestError}</div>}

            {(activeRunId || activeStatus || acceptedAnalysis) && (
              <section aria-live="polite" className="rounded-xl border border-primary/40 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="text-sm font-semibold text-white">Analysis {activeStatus?.analysisRunId ?? acceptedAnalysis?.analysisRunId}</p><p className="mt-1 text-xs text-text-muted">Current workflow stage and recorded progress.</p></div>
                  <StatusLabel value={activeStatus?.status === "NOT_STARTED"
                    ? activeStatus.job?.status === "QUEUED" || activeStatus.job?.status === "RETRY" ? "QUEUED" : activeStatus.status
                    : activeStatus?.status ?? acceptedAnalysis?.status ?? "QUEUED"} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Metric label="Current stage" value={activeStatus?.job?.stage ? stageNames[activeStatus.job.stage] ?? activeStatus.job.stage : "Awaiting status response"} />
                  <Metric label="Run started" value={formatTimestamp(activeStatus?.startedAt)} />
                  <Metric label="Duration" value={formatDuration(activeStatus?.startedAt, activeStatus?.completedAt)} />
                </div>
                {activeStatus?.failure && <p className="mt-3 text-sm text-rose-200">{activeStatus.failure}</p>}
                {reviewStatus && (
                  <dl aria-label="NVIDIA repository review result" className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="flex justify-between gap-3 rounded bg-background/70 px-3 py-2">
                      <dt className="text-text-muted">NVIDIA repository review</dt>
                      <dd className="font-mono text-white">
                        {reviewStatus === "COMPLETED"
                          ? `COMPLETED · ${reviewDimensions ?? 0} estimated dimensions · ${reviewFindings ?? 0} findings`
                          : `${reviewStatus}${reviewProviderStatus === null ? "" : ` · HTTP ${reviewProviderStatus}`}${reviewErrorCode ? ` · ${reviewErrorCode}` : ""}`}
                      </dd>
                    </div>
                    {reviewAttempts !== null && (
                      <div className="flex justify-between gap-3 rounded bg-background/70 px-3 py-2">
                        <dt className="text-text-muted">Review attempts</dt>
                        <dd className="font-mono text-white">{reviewAttempts}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {pollError && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-xs text-amber-100"><span>Analysis status could not be refreshed. The job may still be running.</span><button onClick={() => { setPollError(false); setPollRetry((value) => value + 1); setActiveRunId(acceptedAnalysis?.analysisRunId ?? activeStatus?.analysisRunId ?? null); }} className="underline">Retry status</button></div>}
                {activeStatus?.progress && Object.keys(activeStatus.progress).length > 0 && (
                  <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                    {(["sourceFiles", "parsedFiles", "irEntityCount", "irRelationshipCount", "findings"] as const).map((key) => {
                      const value = activeStatus.progress[key];
                      return value === undefined ? null : <div key={key} className="flex justify-between gap-3 rounded bg-background/70 px-3 py-2"><dt className="text-text-muted">{key}</dt><dd className="font-mono text-white">{String(value)}</dd></div>;
                    })}
                  </dl>
                )}
                {terminalStatuses.has(activeStatus?.status ?? "") && timingEntries.length > 0 && (
                  <dl aria-label="Analysis stage timings" className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                    {timingEntries.map(([stage, durationMs]) => (
                      <div key={stage} className="flex justify-between gap-3 rounded bg-background/70 px-3 py-2">
                        <dt className="text-text-muted">{timingNames[stage] ?? stage}</dt>
                        <dd className="font-mono text-white">
                          {durationMs < 1_000 ? `${Math.round(durationMs)} ms` : `${(durationMs / 1_000).toFixed(1)} s`}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            )}
            {!activeStatus && (
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Current commit" value={overview.latestCommit?.commitSha.slice(0, 12) ?? "Not indexed"} detail={overview.latestCommit?.indexedAt ? `Indexed ${formatTimestamp(overview.latestCommit.indexedAt)}` : "No indexed revision yet"} />
                <Metric label="Latest analysis" value={overview.latestRun?.status ?? "Not run"} detail={formatTimestamp(overview.latestRun?.createdAt)} />
                <Metric label="Open findings" value={overview.findingCounts.open} tone={overview.findingCounts.open ? "warning" : "neutral"} />
                <Metric label="Critical / high risk" value={`${overview.findingCounts.critical} / ${overview.findingCounts.highRisk}`} tone={overview.findingCounts.critical ? "danger" : "neutral"} />
              </section>
            )}

            <div className="grid gap-5 xl:grid-cols-2">
              <section className="rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="text-sm font-semibold text-white">Repository health</h2><p className="mt-1 text-xs text-text-muted">Latest persisted snapshot only.</p></div><Link href={`/health?repositoryId=${repositoryId}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Details <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></div>
                {!health ? <p className="px-4 py-6 text-sm text-text-muted">No health snapshot has been recorded.</p> : (
                  <div className="p-4">
                    <div className="flex items-end gap-2"><span className="font-mono text-4xl font-semibold text-white">{health.overall_score ?? "Unknown"}</span>{health.overall_score !== null && <span className="pb-1 text-xs text-text-muted">/ 100</span>}<span className="ml-auto flex gap-2"><StatusLabel value={health.overall_status ?? "UNKNOWN"} /><StatusLabel value={health.coverage ?? "UNKNOWN"} /></span></div>
                    <p className="mt-2 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs leading-5 text-amber-100">{health.overall_score === null
                      ? "Health score unavailable; no numeric score is calculated."
                      : health.coverage === "PARTIAL" || health.coverage === "UNKNOWN"
                        ? "PARTIAL COVERAGE - the configured weighted dimensions scored, but other dimensions or inputs are unavailable."
                        : `Verified health score. Latest analysis: ${overview.latestRun?.status ?? "status unavailable"}.`}</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {(["security", "quality", "maintainability", "dependencies", "reliability"] as const).map((key) => {
                        const dimension = dimensions?.[key];
                        return <div key={key} className="flex min-w-0 items-center justify-between gap-3 border-t border-border pt-3"><span className="capitalize text-xs text-text-secondary">{key}</span>{dimension?.score === null || !dimension ? <UnknownValue explanation={dimension?.explanation ?? "No persisted dimension data."} /> : <span className="font-mono text-sm text-white">{dimension.score}</span>}</div>;
                      })}
                    </div>
                    <p className="mt-4 text-xs leading-5 text-text-muted">Security scores reflect findings from the security analyzers currently implemented. A score of 100 does not mean the repository is vulnerability-free; unsupported vulnerability classes are not included.</p>
                    <p className="mt-4 text-xs leading-5 text-text-muted">{health.explanation ?? "No explanation is available in this health snapshot."}</p>
                  </div>
                )}
              </section>
              <section className="rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="text-sm font-semibold text-white">Analysis and findings</h2><p className="mt-1 text-xs text-text-muted">Persisted records for this repository.</p></div><Activity className="h-4 w-4 text-primary" aria-hidden="true" /></div>
                <div className="grid gap-2 p-4 sm:grid-cols-2">
                  <Link href={`/findings?repositoryId=${repositoryId}`} className="rounded-lg border border-border p-4 hover:border-primary/50"><p className="text-xs text-text-muted">Findings</p><p className="mt-2 font-mono text-xl text-white">{overview.findingCounts.total}</p><p className="mt-1 text-xs text-primary">Open findings workspace →</p></Link>
                  <Link href={`/history?repositoryId=${repositoryId}`} className="rounded-lg border border-border p-4 hover:border-primary/50"><p className="text-xs text-text-muted">Latest run</p><p className="mt-2 truncate font-mono text-sm text-white">{overview.latestRun?.id ?? "No analysis run"}</p><p className="mt-1 text-xs text-primary">Open analysis history →</p></Link>
                </div>
              </section>
            </div>
          </>
        )}
    </div>
  );
}
