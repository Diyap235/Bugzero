"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { Metric, PageHeading, ResourceState, StatusLabel, formatDuration, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";

function humanize(value: string | null | undefined): string {
  return value?.replaceAll("_", " ").toLowerCase().replace(/^\w/, (character) => character.toUpperCase()) ?? "Not reported";
}

function HistoryContent() {
  const params = useSearchParams();
  const initialRepositoryId = params.get("repositoryId") ?? "ALL";
  const [repositoryId, setRepositoryId] = useState(initialRepositoryId);
  const load = useCallback(async () => {
    const repositories = await bugzeroApi.listRepositories();
    const histories = await Promise.all(repositories.map(async (repository) => ({
      repository,
      runs: await bugzeroApi.getRepositoryHistory(repository.id),
    })));
    return histories;
  }, []);
  const resource = useApiResource(load);
  const all = useMemo(() => resource.data ?? [], [resource.data]);
  const selectedId = all.some(({ repository }) => repository.id === repositoryId) ? repositoryId : "ALL";
  const runs = useMemo(() => all.filter(({ repository }) => selectedId === "ALL" || repository.id === selectedId)
    .flatMap(({ repository, runs: items }) => items.map((entry) => ({ ...entry, repository })))
    .sort((left, right) => Date.parse(right.run.createdAt) - Date.parse(left.run.createdAt)), [all, selectedId]);
  const complete = runs.filter(({ run }) => run.status === "COMPLETED").length;
  const partial = runs.filter(({ run }) => run.status === "PARTIAL").length;
  const failed = runs.filter(({ run }) => run.status === "FAILED").length;

  return (
    <AppShell>
      <div className="space-y-5">
        <PageHeading eyebrow="Immutable analysis runs" title="Analysis history" description="Run status, stage, finding counts, health snapshot, and risk totals are derived from persisted records." />
        <ResourceState loading={resource.loading} error={resource.error} empty={all.length === 0} retry={resource.refresh} emptyTitle="No repositories are available" />
        {!resource.error && all.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-3"><Metric label="Completed" value={complete} /><Metric label="Partial" value={partial} tone={partial ? "warning" : "neutral"} /><Metric label="Failed" value={failed} tone={failed ? "danger" : "neutral"} /></div>
            <label className="block max-w-md text-[10px] uppercase tracking-wide text-text-muted">Repository<select value={selectedId} onChange={(event) => setRepositoryId(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-white"><option value="ALL">All repositories</option>{all.map(({ repository }) => <option key={repository.id} value={repository.id}>{repository.fullName}</option>)}</select></label>
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
      </div>
    </AppShell>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background p-8 text-sm text-text-muted">Preparing analysis history…</main>}>
      <HistoryContent />
    </Suspense>
  );
}
