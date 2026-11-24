"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Metric, PageHeading, ResourceState, StatusLabel, formatDuration, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { useWorkspaceState } from "@/hooks/useWorkspaceState";
import { bugzeroApi } from "@/lib/api-client";
import { loadRepositoryHistories } from "@/lib/repository-history";

function humanize(value: string | null | undefined): string {
  return value?.replaceAll("_", " ").toLowerCase().replace(/^\w/, (character) => character.toUpperCase()) ?? "Not reported";
}

function HistoryContent() {
  const params = useSearchParams();
  const initialRepositoryId = params.get("repositoryId") ?? "ALL";
  const [repositoryId, setRepositoryId] = useWorkspaceState(`history:${initialRepositoryId}:repository`, initialRepositoryId);
  const loadRepositories = useCallback(() => bugzeroApi.listRepositories(), []);
  const repositoryResource = useApiResource(loadRepositories, { key: "history-repository-list", staleTimeMs: 30_000 });
  const repositories = repositoryResource.data ?? [];
  const selectedId = repositories.some(({ id }) => id === repositoryId) ? repositoryId : "ALL";
  const load = useCallback(async () => {
    if (repositoryResource.data === null) return [];
    return loadRepositoryHistories(
      repositoryResource.data,
      (id) => bugzeroApi.getRepositoryHistory(id),
      selectedId,
    );
  }, [repositoryResource.data, selectedId]);
  const historyResource = useApiResource(load, {
    key: repositoryResource.data === null ? "history:initializing" : `history:${selectedId}`,
    staleTimeMs: 30_000,
  });
  const histories = useMemo(() => historyResource.data ?? [], [historyResource.data]);
  const runs = useMemo(() => histories
    .flatMap(({ repository, runs: items }) => items.map((entry) => ({ ...entry, repository })))
    .sort((left, right) => Date.parse(right.run.createdAt) - Date.parse(left.run.createdAt)), [histories]);
  const complete = runs.filter(({ run }) => run.status === "COMPLETED").length;
  const partial = runs.filter(({ run }) => run.status === "PARTIAL").length;
  const failed = runs.filter(({ run }) => run.status === "FAILED").length;

  return (
    <div className="space-y-5">
        <PageHeading eyebrow="Immutable analysis runs" title="Analysis history" description="Run status, stage, finding counts, health snapshot, and risk totals are derived from persisted records." />
        <ResourceState loading={repositoryResource.loading && repositoryResource.data === null} error={repositoryResource.error} refreshError={repositoryResource.refreshError} empty={repositoryResource.data !== null && repositories.length === 0} retry={repositoryResource.refresh} emptyTitle="No repositories are available" />
        {!repositoryResource.error && repositories.length > 0 && (
          <>
            <label className="block max-w-md text-[10px] uppercase tracking-wide text-text-muted">Repository<select value={selectedId} onChange={(event) => setRepositoryId(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-white"><option value="ALL">All repositories</option>{repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.fullName}</option>)}</select></label>
            <ResourceState loading={historyResource.loading && historyResource.data === null} error={historyResource.error} refreshError={historyResource.refreshError} empty={false} retry={historyResource.refresh} />
            {historyResource.data !== null && !historyResource.error && (
              <>
                <div className="grid gap-3 sm:grid-cols-3"><Metric label="Completed" value={complete} /><Metric label="Partial" value={partial} tone={partial ? "warning" : "neutral"} /><Metric label="Failed" value={failed} tone={failed ? "danger" : "neutral"} /></div>
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full min-w-[1050px] text-left">
                    <thead className="bg-surface text-[10px] uppercase tracking-wide text-text-muted"><tr>{["Repository / commit", "Started", "Status", "Stage", "Duration", "Findings", "Total risk", "Health", "Scope"].map((heading) => <th key={heading} className="px-4 py-3 font-medium">{heading}</th>)}</tr></thead>
                    <tbody className="divide-y divide-border">
                      {runs.map(({ run, job, findingCount, totalTechnicalRisk, healthScore, repository }) => (
                        <tr key={run.id} className="hover:bg-surface-hover">
                          <td className="px-4 py-3"><Link href={`/analysis/${run.id}`} className="block max-w-56 truncate text-xs font-medium text-white hover:text-primary">{repository.fullName}</Link><span className="mt-1 block font-mono text-[10px] text-text-muted">{run.commitSha ?? run.commitId}</span></td>
                          <td className="px-4 py-3 text-[10px] text-text-muted">{formatTimestamp(run.startedAt ?? run.createdAt)}</td>
                          <td className="px-4 py-3"><StatusLabel value={run.status} /></td>
                          <td className="px-4 py-3 text-[10px] text-text-secondary">{humanize(job?.stage)}</td>
                          <td className="px-4 py-3 font-mono text-[10px] text-text-secondary">{formatDuration(run.startedAt, run.completedAt)}</td>
                          <td className="px-4 py-3 font-mono text-xs text-white">{findingCount}</td>
                          <td className="px-4 py-3 font-mono text-xs text-white">{totalTechnicalRisk}</td>
                          <td className="px-4 py-3 font-mono text-xs text-white">{healthScore ?? "Unknown"}</td>
                          <td className="px-4 py-3 text-[10px] text-text-secondary">{humanize(run.scope)}</td>
                        </tr>
                      ))}
                      {runs.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-text-muted">No analysis runs are recorded for this selection.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] leading-5 text-text-muted">Finding counts and total risk summarize persisted occurrences and assessments linked to each run. Finding comparisons between runs are not included here.</p>
              </>
            )}
          </>
        )}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background p-8 text-sm text-text-muted">Preparing analysis history…</main>}>
      <HistoryContent />
    </Suspense>
  );
}
